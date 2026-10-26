"""Validate the body of POST /recipes and PUT /recipes/{id}.

Only the editable recipe fields are accepted; everything else in the body
(attribution, ids, timestamps, unknown keys) is dropped, so clients can't
write server-owned attributes. Empty values ("", [], null) count as absent,
which is how the web and iOS editors say a field was cleared.

Shapes match what both clients send (src/lib/draft.ts recipeFromDraft,
ios/MealsByMaggie/RecipeAPI.swift RecipeInput).
"""
import json

# Recipe fields the web and iOS editors own; PUT replaces these as a set.
EDITABLE_FIELDS = ('title', 'description', 'image', 'tags', 'ingredients', 'instructions', 'servings', 'cookTime')

MAX_BODY_BYTES = 256 * 1024

# Generous limits: they stop abuse, not real recipes.
MAX_TITLE = 200
MAX_DESCRIPTION = 5000
MAX_SHORT = 100          # servings, cookTime, ingredient amount
MAX_IMAGE = 1024
MAX_TAGS = 50
MAX_TAG = 60
MAX_LINES = 300          # ingredients, instructions
MAX_INGREDIENT_NAME = 500
MAX_STEP = 5000
MAX_CIRCLES = 20         # brigades one recipe can be shared into (docs/recipe-circles.md §11.6)
MAX_CIRCLE_ID = 64


class BadRequest(Exception):
    """The body can't be saved; the message is safe to show to the client."""


def _empty(v):
    return v is None or v == '' or v == [] or v == {}


def _text(field, v, limit):
    if not isinstance(v, str):
        raise BadRequest(f'{field} must be text')
    v = v.strip()
    if len(v) > limit:
        raise BadRequest(f'{field} is too long (max {limit} characters)')
    return v


def _list(field, v, limit):
    if not isinstance(v, list):
        raise BadRequest(f'{field} must be a list')
    if len(v) > limit:
        raise BadRequest(f'{field} has too many entries (max {limit})')
    return v


def _image(v):
    v = _text('image', v, MAX_IMAGE)
    # Stored values are S3 keys ("uploads/abc.jpeg") or http(s) URLs (src/lib/images.ts).
    # Anything else with a scheme (javascript:, data:) is refused.
    if ':' in v and not v.lower().startswith(('https://', 'http://')):
        raise BadRequest('image must be an uploaded image or a web address')
    return v


def _servings(v):
    # Both clients send a string; accept a bare number too.
    if isinstance(v, bool):
        raise BadRequest('servings must be text')
    if isinstance(v, (int, float)):
        v = str(int(v)) if float(v).is_integer() else str(v)
    return _text('servings', v, MAX_SHORT)


def _tags(v):
    out = []
    for t in _list('tags', v, MAX_TAGS):
        t = _text('tags', t, MAX_TAG)
        if t and t not in out:
            out.append(t)
    return out


def _ingredients(v):
    out = []
    for i in _list('ingredients', v, MAX_LINES):
        if not isinstance(i, dict):
            raise BadRequest('each ingredient must have a name')
        name = _text('ingredient name', i.get('name', ''), MAX_INGREDIENT_NAME)
        if not name:
            continue
        item = {'name': name}
        amount = i.get('amount')
        if not _empty(amount):
            amount = _text('ingredient amount', amount, MAX_SHORT)
            if amount:
                item['amount'] = amount
        out.append(item)
    return out


def _instructions(v):
    out = []
    for s in _list('instructions', v, MAX_LINES):
        s = _text('instructions', s, MAX_STEP)
        if s:
            out.append(s)
    return out


_PARSERS = {
    'title': lambda v: _text('title', v, MAX_TITLE),
    'description': lambda v: _text('description', v, MAX_DESCRIPTION),
    'cookTime': lambda v: _text('cookTime', v, MAX_SHORT),
    'servings': _servings,
    'image': _image,
    'tags': _tags,
    'ingredients': _ingredients,
    'instructions': _instructions,
}
assert set(_PARSERS) == set(EDITABLE_FIELDS)


def _load(raw):
    raw = raw or '{}'
    if len(raw.encode('utf-8')) > MAX_BODY_BYTES:
        raise BadRequest('That recipe is too big to save')
    try:
        body = json.loads(raw)
    except ValueError:
        raise BadRequest('Body must be JSON')
    if not isinstance(body, dict):
        raise BadRequest('Body must be a JSON object')
    return body


def parse_recipe_body(raw):
    """Return {field: value} for the editable fields present and non-empty in the body.

    `raw` is the request body string (or None). Raises BadRequest on invalid JSON,
    a non-object body, an oversized body, a bad field, or a missing title.
    """
    body = _load(raw)
    out = {}
    for field in EDITABLE_FIELDS:
        v = body.get(field)
        if _empty(v):
            continue
        v = _PARSERS[field](v)
        if not _empty(v):
            out[field] = v
    if not out.get('title'):
        raise BadRequest('title is required')
    return out


def parse_sharing(raw):
    """The optional "sharing" object of POST /recipes: {isPublic, circleIds} or None if absent.

    circleIds are de-duplicated; whether the caller may share into them is checked by
    the handler (authz.can_share_into).
    """
    sharing = _load(raw).get('sharing')
    if sharing is None:
        return None
    if not isinstance(sharing, dict):
        raise BadRequest('sharing must be an object')
    is_public = sharing.get('isPublic', False)
    if not isinstance(is_public, bool):
        raise BadRequest('sharing.isPublic must be true or false')
    circle_ids = []
    for cid in _list('sharing.circleIds', sharing.get('circleIds') or [], MAX_CIRCLES):
        if not isinstance(cid, str) or not cid.strip() or len(cid) > MAX_CIRCLE_ID:
            raise BadRequest('sharing.circleIds must be brigade ids')
        if cid not in circle_ids:
            circle_ids.append(cid)
    return {'isPublic': is_public, 'circleIds': circle_ids}


def parse_version(raw):
    """The optional "version" a client read the recipe at (optimistic locking), or None."""
    v = _load(raw).get('version')
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise BadRequest('version must be a positive whole number')
    return v
