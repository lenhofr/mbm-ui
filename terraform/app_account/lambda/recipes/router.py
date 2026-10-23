"""Match an API Gateway event to one of the Lambda's route templates.

API Gateway (HTTP API, payload v2.0) sets requestContext.routeKey, e.g. "PUT /recipes/{id}".
Tests and other callers often send only the method and rawPath, so when the route key is
missing or isn't one of ours, the path is matched against the templates instead.
"""


def normalize_path(path: str) -> str:
    """Collapse duplicate slashes and drop a trailing slash (except on the root)."""
    path = path or ''
    while '//' in path:
        path = path.replace('//', '/')
    if path.endswith('/') and path != '/':
        path = path.rstrip('/')
    return path


def _match_template(template: str, path: str) -> dict | None:
    """Path params if path fits template ("/recipes/{id}"), else None. Params are one segment."""
    t_parts, p_parts = template.split('/'), path.split('/')
    if len(t_parts) != len(p_parts):
        return None
    params = {}
    for t, p in zip(t_parts, p_parts):
        if t.startswith('{') and t.endswith('}'):
            if not p:
                return None
            params[t[1:-1]] = p
        elif t != p:
            return None
    return params


def method_of(event: dict) -> str:
    rc = event.get('requestContext') or {}
    http = rc.get('http') or {}
    # v2.0 payloads put it under http; v1.0 at the top level.
    return (http.get('method') or rc.get('httpMethod') or event.get('httpMethod') or '').upper()


def resolve(event: dict, route_keys) -> tuple[str | None, dict]:
    """(route_key, path_params) for the event, or (None, {}) when nothing matches."""
    rc = event.get('requestContext') or {}
    method = method_of(event)
    path = normalize_path(event.get('rawPath') or event.get('path') or '')
    route_key = rc.get('routeKey') or ''

    if route_key in route_keys:
        params = dict(event.get('pathParameters') or {})
        template = route_key.split(' ', 1)[1]
        # Fill in anything API Gateway didn't pass (tests usually don't).
        for k, v in (_match_template(template, path) or {}).items():
            params.setdefault(k, v)
        return route_key, params

    for key in route_keys:
        key_method, template = key.split(' ', 1)
        if key_method != method:
            continue
        params = _match_template(template, path)
        if params is not None:
            return key, {**params, **(event.get('pathParameters') or {})}
    return None, {}
