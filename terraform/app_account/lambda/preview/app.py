"""Lambda@Edge (origin-request) for /recipe/*: per-recipe link previews.

Link-preview crawlers (Messages, Slack, ...) don't run JavaScript, so every
recipe URL used to show the same generic card. This serves the SPA's normal
index.html with the recipe's title, description and photo filled into the
block between <!-- og:start --> and <!-- og:end --> (see index.html).
Browsers get the same page and bundles as before.

Any problem (unknown id, API error, timeout) falls back to the plain
index.html from S3, i.e. exactly what the site served before this existed.

Lambda@Edge has no environment variables, so Terraform packages config.json
next to this file (link_previews.tf).
"""
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
try:
    with open(_CONFIG_PATH) as f:
        _CONFIG = json.load(f)
except (OSError, ValueError):
    _CONFIG = {}

API_BASE = _CONFIG.get('api_base', '').rstrip('/')
SITE_ORIGIN = _CONFIG.get('site_origin', 'https://mealsbymaggie.com').rstrip('/')
TIMEOUT = 5  # the recipes Lambda can take a few seconds on a cold start
FALLBACK_IMAGE = '/icons/icon-512.png'
DESCRIPTION_MAX = 200

_ID_RE = re.compile(r'^[A-Za-z0-9._~-]{1,128}$')
_OG_BLOCK_RE = re.compile(r'<!-- og:start -->.*?<!-- og:end -->', re.S)
_TITLE_RE = re.compile(r'<title>.*?</title>', re.S)


def recipe_id_from_uri(uri: str):
    """/recipe/<id>[/cook|/edit...] -> id, or None (same routes as App.tsx)."""
    parts = uri.split('/')
    if len(parts) < 3 or parts[1] != 'recipe':
        return None
    rid = urllib.parse.unquote(parts[2])
    return rid if _ID_RE.match(rid) else None


def _get(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'mbm-link-preview'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return res.read().decode('utf-8')


def image_url(img):
    """Absolute og:image URL for a stored image value (resolveImageUrl in src/lib/images.ts)."""
    if not img or img.startswith(('data:', 'blob:')):
        return SITE_ORIGIN + FALLBACK_IMAGE
    if not re.match(r'^https?:', img, re.I):
        return f"{API_BASE}/images/{urllib.parse.quote(img, safe='')}"
    u = urllib.parse.urlparse(img)
    if u.hostname and u.hostname.endswith('amazonaws.com') and 'X-Amz-' in u.query:
        # Legacy presigned S3 URL: proxy its key through the API for a fresh one.
        key = u.path.lstrip('/')
        if re.match(r'^s3[.-]([^/]+\.)?amazonaws\.com$', u.hostname, re.I) and '/' in key:
            key = key.split('/', 1)[1]  # path-style: drop the bucket segment
        return f"{API_BASE}/images/{urllib.parse.quote(key, safe='')}"
    return img


def preview_tags(recipe: dict, rid: str) -> str:
    esc = lambda s: html.escape(s, quote=True)
    title = recipe['title'].strip()
    desc = ' '.join((recipe.get('description') or '').split())
    if len(desc) > DESCRIPTION_MAX:
        desc = desc[:DESCRIPTION_MAX - 1].rstrip() + '…'
    if not desc:
        desc = 'A recipe from Meals by Maggie.'
    has_image = bool(recipe.get('image'))
    url = f"{SITE_ORIGIN}/recipe/{urllib.parse.quote(rid, safe='')}"
    lines = [
        '<!-- og:start -->',
        '<meta property="og:type" content="article" />',
        '<meta property="og:site_name" content="Meals by Maggie" />',
        f'<meta property="og:title" content="{esc(title)}" />',
        f'<meta property="og:description" content="{esc(desc)}" />',
        f'<meta property="og:url" content="{esc(url)}" />',
        f'<meta property="og:image" content="{esc(image_url(recipe.get("image")))}" />',
        f'<meta name="twitter:card" content="{"summary_large_image" if has_image else "summary"}" />',
        f'<meta name="description" content="{esc(desc)}" />',
        '<!-- og:end -->',
    ]
    return '\n    '.join(lines)


def render(index_html: str, recipe: dict, rid: str) -> str:
    tags = preview_tags(recipe, rid)
    if _OG_BLOCK_RE.search(index_html):
        out = _OG_BLOCK_RE.sub(lambda _: tags, index_html, count=1)
    else:
        out = index_html.replace('</head>', f'    {tags}\n  </head>', 1)
    title = html.escape(f"{recipe['title'].strip()} · Meals by Maggie", quote=False)
    return _TITLE_RE.sub(lambda _: f'<title>{title}</title>', out, count=1)


def _fallback(request: dict, reason: str):
    print(json.dumps({'fallback': reason, 'uri': request.get('uri')}))
    request['uri'] = '/index.html'
    return request


def handler(event, context):
    request = event['Records'][0]['cf']['request']
    rid = recipe_id_from_uri(request.get('uri', ''))
    if not rid:
        return _fallback(request, 'bad-id')
    try:
        recipe = json.loads(_get(f"{API_BASE}/recipes/{urllib.parse.quote(rid, safe='')}"))
        if not isinstance(recipe, dict) or not (recipe.get('title') or '').strip():
            return _fallback(request, 'no-title')
        index_html = _get(f"{SITE_ORIGIN}/index.html")
    except urllib.error.HTTPError as e:
        return _fallback(request, f'http-{e.code}')
    except Exception as e:  # timeouts, bad JSON, DNS...
        return _fallback(request, type(e).__name__)
    return {
        'status': '200',
        'statusDescription': 'OK',
        'headers': {
            'content-type': [{'key': 'Content-Type', 'value': 'text/html; charset=utf-8'}],
            # Browsers revalidate (like index.html); CloudFront keeps it 5 minutes.
            'cache-control': [{'key': 'Cache-Control', 'value': 'max-age=0, s-maxage=300'}],
        },
        'body': render(index_html, recipe, rid),
    }
