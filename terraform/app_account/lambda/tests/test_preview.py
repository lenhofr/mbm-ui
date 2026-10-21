import os
import io
import json
import socket
import urllib.error
import importlib.util

import pytest


INDEX = """<!doctype html>
<html lang="en">
  <head>
  <title>Meals by Maggie</title>
    <!-- og:start -->
    <meta property="og:title" content="Meals by Maggie" />
    <!-- og:end -->
  </head>
  <body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body>
</html>"""

API = 'https://api.example.com'


def load_module():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    spec = importlib.util.spec_from_file_location('preview_app', os.path.join(repo_root, 'preview', 'app.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.API_BASE = API
    mod.SITE_ORIGIN = 'https://mealsbymaggie.com'
    return mod


def event(uri):
    return {'Records': [{'cf': {'request': {'uri': uri, 'method': 'GET', 'headers': {}}}}]}


@pytest.fixture
def app(monkeypatch):
    mod = load_module()
    calls = []
    responses = {}

    def fake_get(url):
        calls.append(url)
        r = responses.get(url)
        if isinstance(r, Exception):
            raise r
        if r is None:
            raise urllib.error.HTTPError(url, 404, 'Not Found', {}, io.BytesIO(b''))
        return r

    monkeypatch.setattr(mod, '_get', fake_get)
    mod.responses = responses
    mod.calls = calls
    return mod


def test_recipe_page_gets_recipe_tags(app):
    app.responses[f'{API}/recipes/abc-123'] = json.dumps({
        'id': 'abc-123', 'title': 'Mac & "Cheese"', 'description': 'Creamy <b>baked</b> pasta.',
        'image': 'uploads/abc 1.webp',
    })
    app.responses['https://mealsbymaggie.com/index.html'] = INDEX
    res = app.handler(event('/recipe/abc-123'), None)
    assert res['status'] == '200'
    body = res['body']
    assert '<title>Mac &amp; "Cheese" · Meals by Maggie</title>' in body
    assert 'og:title" content="Mac &amp; &quot;Cheese&quot;"' in body
    assert 'content="Creamy &lt;b&gt;baked&lt;/b&gt; pasta."' in body
    assert f'og:image" content="{API}/images/uploads%2Fabc%201.webp"' in body
    assert 'og:url" content="https://mealsbymaggie.com/recipe/abc-123"' in body
    assert 'summary_large_image' in body
    # Generic block replaced, not duplicated; the SPA itself is untouched.
    assert body.count('og:title') == 1
    assert '<script type="module" src="/assets/index-abc.js"></script>' in body
    assert res['headers']['content-type'][0]['value'].startswith('text/html')


def test_cook_route_uses_same_recipe(app):
    app.responses[f'{API}/recipes/abc'] = json.dumps({'title': 'Soup'})
    app.responses['https://mealsbymaggie.com/index.html'] = INDEX
    res = app.handler(event('/recipe/abc/cook'), None)
    assert res['status'] == '200'
    assert 'og:title" content="Soup"' in res['body']
    # No photo: site icon and the small card.
    assert 'og:image" content="https://mealsbymaggie.com/icons/icon-512.png"' in res['body']
    assert 'twitter:card" content="summary"' in res['body']
    assert 'A recipe from Meals by Maggie.' in res['body']


def test_long_description_truncated(app):
    app.responses[f'{API}/recipes/abc'] = json.dumps({'title': 'Soup', 'description': 'word ' * 100})
    app.responses['https://mealsbymaggie.com/index.html'] = INDEX
    body = app.handler(event('/recipe/abc'), None)['body']
    desc = body.split('og:description" content="')[1].split('"')[0]
    assert len(desc) <= 200 and desc.endswith('…')


def test_no_markers_inserts_before_head_close(app):
    app.responses[f'{API}/recipes/abc'] = json.dumps({'title': 'Soup'})
    app.responses['https://mealsbymaggie.com/index.html'] = '<html><head><title>x</title></head><body></body></html>'
    body = app.handler(event('/recipe/abc'), None)['body']
    assert body.index('og:title') < body.index('</head>')


def test_unknown_recipe_falls_back_to_index(app):
    req = app.handler(event('/recipe/missing'), None)
    assert req['uri'] == '/index.html'
    assert 'status' not in req


@pytest.mark.parametrize('error', [socket.timeout('timed out'), urllib.error.URLError('dns'), ValueError('x')])
def test_api_errors_fall_back(app, error):
    app.responses[f'{API}/recipes/abc'] = error
    assert app.handler(event('/recipe/abc'), None)['uri'] == '/index.html'


def test_bad_json_or_no_title_falls_back(app):
    app.responses[f'{API}/recipes/abc'] = 'not json'
    assert app.handler(event('/recipe/abc'), None)['uri'] == '/index.html'
    app.responses[f'{API}/recipes/abc'] = json.dumps({'title': '  '})
    assert app.handler(event('/recipe/abc'), None)['uri'] == '/index.html'


def test_index_fetch_failure_falls_back(app):
    app.responses[f'{API}/recipes/abc'] = json.dumps({'title': 'Soup'})
    app.responses['https://mealsbymaggie.com/index.html'] = urllib.error.URLError('down')
    assert app.handler(event('/recipe/abc'), None)['uri'] == '/index.html'


@pytest.mark.parametrize('uri', ['/recipe/', '/recipe/..%2F..%2Fx', '/recipe/a%20b', '/other/abc'])
def test_odd_ids_never_call_api(app, uri):
    assert app.handler(event(uri), None)['uri'] == '/index.html'
    assert app.calls == []


def test_legacy_presigned_image(app):
    url = 'https://s3.amazonaws.com/bucket/uploads/a.jpg?X-Amz-Signature=1'
    assert app.image_url(url) == f'{API}/images/uploads%2Fa.jpg'
    assert app.image_url('https://example.com/a.jpg') == 'https://example.com/a.jpg'
