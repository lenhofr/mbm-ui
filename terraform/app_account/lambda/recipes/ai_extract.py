"""AI recipe extraction: images (scanned cards / screenshots), URLs and pasted text.

The model is forced to answer through a tool call so the output is structured JSON.
Everything it returns is validated and normalized here before reaching the client:
uncertain fields carry a `flag` ({q, opts:[[replacementText, label], ...]}) and
`readable: false` means the photo/text couldn't be read at all.

For URLs, schema.org `Recipe` JSON-LD embedded in the page is used when present
(fast and exact); the model is only a fallback.
"""
import base64
import json
import re
import urllib.request
from html.parser import HTMLParser

MAX_TAGS = 5
MAX_FLAG_OPTS = 2
MAX_TEXT_CHARS = 20000

SYSTEM_PROMPT = """You turn recipes into structured data for a family recipe box.

Call the save_recipe tool exactly once. Rules:
- Copy the recipe faithfully. Do not invent ingredients, quantities, times or steps.
- One ingredient per entry, written as it would appear on a card: quantity, unit, item, preparation (e.g. "1/4 cup butter, melted"). Use plain fractions like 1/2, not ½.
- One step per entry, in order, without numbering.
- servings is a number when one is given; cookTime is total time as short text like "35 min" or "1 hr 10 min".
- tags: up to 5 short lowercase tags. Prefer the user's existing tags when they fit.
- Ignore ads, navigation, comments, life stories and anything that isn't the recipe.

Uncertainty (handwriting, smudges, blur, cut-off text):
- Only when you genuinely can't tell between readings of a specific ingredient or step, add a `flag` to that entry.
- flag.q is a short, friendly question naming what's unclear, e.g. "This part is smudged. Is it tbsp or tsp?".
- flag.opts has exactly 2 options. Each option is [full replacement text for the whole entry, short label], e.g. [["1 tbsp baking powder", "tbsp"], ["1 tsp baking powder", "tsp"]].
- The entry's `text` must be your best guess and must equal the text of one of the options.
- Flag at most a handful of entries. Never flag things you can read.

If there is no recipe, or the image is too blurry/dark to read most of it, set readable to false and leave the other fields empty."""

_FLAG_SCHEMA = {
    "type": "object",
    "properties": {
        "q": {"type": "string"},
        "opts": {
            "type": "array",
            "items": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
            "minItems": 2,
            "maxItems": 2,
        },
    },
    "required": ["q", "opts"],
}
_ENTRY_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "flag": _FLAG_SCHEMA},
    "required": ["text"],
}
TOOL = {
    "toolSpec": {
        "name": "save_recipe",
        "description": "Save the extracted recipe.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "readable": {"type": "boolean", "description": "False if there's no recipe or it can't be read."},
                    "title": {"type": "string"},
                    "description": {"type": "string", "description": "One short sentence, or empty."},
                    "servings": {"type": "integer"},
                    "cookTime": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "ingredients": {"type": "array", "items": _ENTRY_SCHEMA},
                    "instructions": {"type": "array", "items": _ENTRY_SCHEMA},
                },
                "required": ["readable", "title", "ingredients", "instructions"],
            }
        },
    }
}


class ExtractError(Exception):
    """Raised for input problems the client should see (400)."""


# ── Normalization ────────────────────────────────────────────────────────────

def _clean_str(v, limit=2000):
    if not isinstance(v, str):
        return ""
    return re.sub(r"\s+", " ", v).strip()[:limit]


def _clean_flag(flag, text):
    if not isinstance(flag, dict):
        return None
    q = _clean_str(flag.get("q"), 300)
    opts = []
    for o in flag.get("opts") or []:
        if isinstance(o, (list, tuple)) and len(o) == 2:
            full, label = _clean_str(o[0]), _clean_str(o[1], 40)
            if full and label and all(full != x[0] for x in opts):
                opts.append([full, label])
    opts = opts[:MAX_FLAG_OPTS]
    if not q or len(opts) < 2:
        return None
    # The shown text must be one of the choices; otherwise the flag is incoherent.
    if text not in (o[0] for o in opts):
        return None
    return {"q": q, "opts": opts}


def _clean_entries(items):
    out = []
    for it in items or []:
        if isinstance(it, str):
            it = {"text": it}
        if not isinstance(it, dict):
            continue
        text = _clean_str(it.get("text"))
        text = re.sub(r"^(?:step\s*)?\d+[.)]\s+", "", text, flags=re.I)  # drop "1. " numbering
        if not text:
            continue
        entry = {"text": text}
        flag = _clean_flag(it.get("flag"), text)
        if flag:
            entry["flag"] = flag
        out.append(entry)
    return out


def normalize(raw):
    """Validate model/JSON-LD output into the shape the client expects."""
    if not isinstance(raw, dict):
        return {"readable": False}
    ingredients = _clean_entries(raw.get("ingredients"))
    instructions = _clean_entries(raw.get("instructions"))
    title = _clean_str(raw.get("title"), 200)
    readable = raw.get("readable") is not False and bool(title or ingredients or instructions)
    if not readable:
        return {"readable": False}
    result = {
        "readable": True,
        "title": title,
        "description": _clean_str(raw.get("description"), 500),
        "cookTime": _clean_str(raw.get("cookTime"), 40),
        "tags": [],
        "ingredients": ingredients,
        "instructions": instructions,
    }
    servings = raw.get("servings")
    if isinstance(servings, str):
        m = re.search(r"\d+", servings)
        servings = int(m.group()) if m else None
    if isinstance(servings, (int, float)) and 0 < servings < 1000:
        result["servings"] = int(servings)
    seen = set()
    for t in raw.get("tags") or []:
        t = _clean_str(t, 30).lower()
        if t and t not in seen:
            seen.add(t)
            result["tags"].append(t)
    result["tags"] = result["tags"][:MAX_TAGS]
    return result


# ── Model call ───────────────────────────────────────────────────────────────

def _call_model(bedrock, model_id, content, known_tags):
    if known_tags:
        content = content + [{"text": "The user's existing tags: " + ", ".join(known_tags[:30])}]
    resp = bedrock.converse(
        modelId=model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": content}],
        toolConfig={"tools": [TOOL], "toolChoice": {"tool": {"name": "save_recipe"}}},
        inferenceConfig={"maxTokens": 4096, "temperature": 0},
    )
    for block in resp["output"]["message"]["content"]:
        if "toolUse" in block:
            return block["toolUse"].get("input") or {}
    # Shouldn't happen with a forced tool choice; treat as unreadable rather than crashing.
    return {"readable": False}


def extract_from_images(bedrock, model_id, images, source="scan", known_tags=None):
    """images: [{"data": base64, "mediaType": "image/jpeg"}]"""
    if not images or len(images) > 4:
        raise ExtractError("Send between 1 and 4 images")
    content = []
    for img in images:
        fmt = str(img.get("mediaType", "image/jpeg")).split("/")[-1].lower()
        fmt = "jpeg" if fmt == "jpg" else fmt
        if fmt not in ("jpeg", "png", "gif", "webp"):
            raise ExtractError(f"Unsupported image type: {fmt}")
        try:
            data = base64.b64decode(img["data"], validate=True)
        except Exception:
            raise ExtractError("Image data must be base64")
        content.append({"image": {"format": fmt, "source": {"bytes": data}}})
    what = "a screenshot of a recipe" if source == "screenshot" else (
        "the front and back of a recipe card" if len(images) > 1 else "a photo of a recipe card or cookbook page")
    content.append({"text": f"These images are {what}. Extract the recipe."})
    return normalize(_call_model(bedrock, model_id, content, known_tags))


def extract_from_text(bedrock, model_id, text, known_tags=None):
    text = (text or "").strip()
    if not text:
        raise ExtractError("Missing text")
    content = [{"text": f"Recipe text pasted by the user:\n\n---\n{text[:MAX_TEXT_CHARS]}"}]
    return normalize(_call_model(bedrock, model_id, content, known_tags))


# ── URLs ─────────────────────────────────────────────────────────────────────

class _PageParser(HTMLParser):
    """Collects readable text and the contents of <script type="application/ld+json">."""
    SKIP = {"script", "style", "noscript", "head", "nav", "footer", "svg", "form"}

    def __init__(self):
        super().__init__()
        self._skip = 0
        self._ld = None
        self.chunks = []
        self.ld_json = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "script" and any(k == "type" and (v or "").lower().strip() == "application/ld+json" for k, v in attrs):
            self._ld = []
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "script" and self._ld is not None:
            self.ld_json.append("".join(self._ld))
            self._ld = None
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)

    def handle_data(self, data):
        if self._ld is not None:
            self._ld.append(data)
        elif self._skip == 0:
            text = data.strip()
            if text:
                self.chunks.append(text)


def _is_recipe(node):
    t = node.get("@type") if isinstance(node, dict) else None
    return t == "Recipe" or (isinstance(t, list) and "Recipe" in t)


def find_ld_recipe(blobs):
    """Find the first schema.org Recipe in a list of JSON-LD strings (handles @graph and arrays)."""
    stack = []
    for blob in blobs:
        try:
            stack.append(json.loads(blob))
        except (ValueError, TypeError):
            continue
    while stack:
        node = stack.pop(0)
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            if _is_recipe(node):
                return node
            if "@graph" in node:
                stack.append(node["@graph"])
            if isinstance(node.get("mainEntity"), (dict, list)):
                stack.append(node["mainEntity"])
    return None


def iso_duration(s):
    """'PT1H5M' → '1 hr 5 min'."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?", (s or "").strip())
    if not m or not any(m.groups()):
        return ""
    days, hours, mins = (int(x or 0) for x in m.groups())
    hours += days * 24
    hours, mins = hours + mins // 60, mins % 60
    parts = ([f"{hours} hr"] if hours else []) + ([f"{mins} min"] if mins else [])
    return " ".join(parts)


def _text(v):
    if isinstance(v, str):
        return re.sub(r"<[^>]+>", " ", v)
    if isinstance(v, dict):
        return _text(v.get("text") or v.get("name") or "")
    return ""


def _ld_steps(v):
    if isinstance(v, str):
        return [s for s in re.split(r"\n+", _text(v)) if s.strip()]
    out = []
    for item in v if isinstance(v, list) else [v]:
        if isinstance(item, dict) and item.get("@type") == "HowToSection":
            out.extend(_ld_steps(item.get("itemListElement") or []))
        elif isinstance(item, (dict, str)):
            t = _text(item)
            if t.strip():
                out.append(t)
    return out


def recipe_from_ld(ld):
    yield_ = ld.get("recipeYield")
    if isinstance(yield_, list):
        yield_ = next((y for y in yield_ if isinstance(y, (int, float)) or re.search(r"\d", str(y))), None)
    tags = []
    for key in ("recipeCategory", "recipeCuisine"):
        v = ld.get(key)
        tags.extend(v if isinstance(v, list) else [v] if v else [])
    if isinstance(ld.get("keywords"), str):
        tags.extend(k for k in ld["keywords"].split(",") if len(k.strip()) <= 20)
    return normalize({
        "readable": True,
        "title": _text(ld.get("name")),
        "description": _text(ld.get("description")).split(". ")[0],
        "servings": yield_,
        "cookTime": iso_duration(ld.get("totalTime") or ld.get("cookTime") or ""),
        "tags": [t for t in tags if isinstance(t, str)],
        "ingredients": [_text(i) for i in ld.get("recipeIngredient") or []],
        "instructions": _ld_steps(ld.get("recipeInstructions") or []),
    })


def fetch_page(url):
    if not re.match(r"^https?://", url or "", re.I):
        raise ExtractError("URL must start with http:// or https://")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    })
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read(3_000_000).decode("utf-8", errors="replace")


def extract_from_url(bedrock, model_id, url, known_tags=None, fetch=fetch_page):
    parser = _PageParser()
    parser.feed(fetch(url))
    ld = find_ld_recipe(parser.ld_json)
    if ld:
        result = recipe_from_ld(ld)
        if result.get("readable") and result["ingredients"] and result["instructions"]:
            return result
    text = "\n".join(parser.chunks)[:MAX_TEXT_CHARS]
    content = [{"text": f"Web page: {url}\n\n---\n{text}"}]
    return normalize(_call_model(bedrock, model_id, content, known_tags))
