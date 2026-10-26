import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'recipes'))
import router  # noqa: E402

ROUTES = ('GET /recipes', 'GET /recipes/{id}', 'POST /recipes', 'PUT /recipes/{id}',
          'DELETE /recipes/{id}', 'POST /ai/extract-recipe')


def ev(method, path, route_key=None, path_params=None):
    rc = {'http': {'method': method}}
    if route_key:
        rc['routeKey'] = route_key
    e = {'requestContext': rc, 'rawPath': path}
    if path_params is not None:
        e['pathParameters'] = path_params
    return e


@pytest.mark.parametrize('method, path, expected', [
    ('GET', '/recipes', ('GET /recipes', {})),
    ('GET', '/recipes/', ('GET /recipes', {})),
    ('POST', '//recipes', ('POST /recipes', {})),
    ('GET', '/recipes/r1', ('GET /recipes/{id}', {'id': 'r1'})),
    ('PUT', '/recipes/r1/', ('PUT /recipes/{id}', {'id': 'r1'})),
    ('DELETE', '/recipes//r1', ('DELETE /recipes/{id}', {'id': 'r1'})),
    ('POST', '/ai/extract-recipe', ('POST /ai/extract-recipe', {})),
    ('PATCH', '/recipes/r1', (None, {})),
    ('POST', '/recipes/r1', (None, {})),
    ('GET', '/ratings', (None, {})),
    ('GET', '/recipes/r1/extra', (None, {})),
])
def test_path_fallback_without_a_route_key(method, path, expected):
    assert router.resolve(ev(method, path), ROUTES) == expected


def test_route_key_and_path_params_from_api_gateway_win():
    e = ev('PUT', '/recipes/r1', 'PUT /recipes/{id}', {'id': 'from-gateway'})
    assert router.resolve(e, ROUTES) == ('PUT /recipes/{id}', {'id': 'from-gateway'})


def test_known_route_key_fills_missing_path_params_from_the_path():
    assert router.resolve(ev('GET', '/recipes/r1', 'GET /recipes/{id}'), ROUTES) == ('GET /recipes/{id}', {'id': 'r1'})


def test_unknown_route_key_falls_back_to_the_path():
    assert router.resolve(ev('GET', '/recipes/', 'GET /recipes/'), ROUTES) == ('GET /recipes', {})
    assert router.resolve(ev('GET', '/nope', '$default'), ROUTES) == (None, {})


def test_v1_payload_method():
    e = {'httpMethod': 'GET', 'path': '/recipes/r1', 'requestContext': {}}
    assert router.resolve(e, ROUTES) == ('GET /recipes/{id}', {'id': 'r1'})


def test_every_api_gateway_route_has_a_handler_and_back():
    # A route in backend_api.tf without a handler is a 400; a handler without a route is unreachable.
    import re
    from test_recipes import load_app
    tf = open(os.path.join(os.path.dirname(__file__), '..', '..', 'backend_api.tf')).read()
    keys = set(re.findall(r'"((?:GET|POST|PUT|PATCH|DELETE) /[^"]*)"', tf))
    keys = {k for k in keys if not k.split(' ', 1)[1].startswith('/images')}
    assert keys == set(load_app().ROUTES)
