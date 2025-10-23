import os
import json
from decimal import Decimal
import uuid
import time
import boto3
from botocore.exceptions import ClientError

RECIPES_TABLE = os.environ.get('RECIPES_TABLE')
RATINGS_TABLE = os.environ.get('RATINGS_TABLE')


def get_dynamodb():
    region = os.environ.get('AWS_REGION', 'us-east-1')
    return boto3.resource('dynamodb', region_name=region)


def _to_jsonable(obj):
    """Recursively convert DynamoDB Decimals and nested structures to JSON-serializable types."""
    if isinstance(obj, Decimal):
        # Preserve integers as int, otherwise use float
        try:
            return int(obj) if obj % 1 == 0 else float(obj)
        except Exception:
            return float(obj)
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    return obj


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(_to_jsonable(body)),
        'headers': {'Content-Type': 'application/json'}
    }


def map_recipe_out(item: dict | None) -> dict | None:
    if not item:
        return None
    out = dict(item)
    rid = out.get('recipeId')
    if rid is not None:
        # Keep both for backward compatibility
        out['id'] = rid
        out['recipeId'] = rid
    return out


def _get_table(name, dynamodb):
    if not name:
        raise ValueError('Table name not set in environment')
    return dynamodb.Table(name)


def handler(event, context):
    rc = event.get('requestContext', {})
    http = rc.get('http', {})
    # Support v2.0 and 1.0 payloads
    raw_path = event.get('rawPath') or event.get('path') or ''
    # Method from multiple potential locations
    method = (http.get('method') or rc.get('httpMethod') or event.get('httpMethod') or '').upper()
    route_key = rc.get('routeKey', '')  # e.g., "POST /recipes"
    path_params = event.get('pathParameters') or {}
    query = event.get('queryStringParameters') or {}

    # Fallback for local tests or environments that don't set routeKey
    if not route_key:
        # Normalize trailing slash
        path = raw_path[:-1] if raw_path and raw_path.endswith('/') and raw_path != '/' else raw_path
        if method and path:
            # Map concrete path to templated route where possible
            if path == '/recipes' and method in ('GET', 'POST'):
                route_key = f'{method} /recipes'
            elif path.startswith('/recipes/') and method in ('GET', 'PUT', 'DELETE'):
                route_key = f'{method} /recipes/{{id}}'
            elif path == '/ratings' and method in ('GET', 'POST'):
                route_key = f'{method} /ratings'

    # If route_key provided but unexpected (e.g., path has trailing slash), re-derive a normalized key
    expected = {
        'GET /recipes',
        'GET /recipes/{id}',
        'POST /recipes',
        'PUT /recipes/{id}',
        'DELETE /recipes/{id}',
        'GET /ratings',
        'POST /ratings',
    }
    if route_key and route_key not in expected:
        # Normalize raw_path: strip trailing slashes (except root) and collapse duplicate slashes
        path = raw_path or ''
        while '//' in path:
            path = path.replace('//', '/')
        if path.endswith('/') and path != '/':
            path = path.rstrip('/')
        if method and path:
            if path == '/recipes' and method in ('GET', 'POST'):
                route_key = f'{method} /recipes'
            elif path.startswith('/recipes/') and method in ('GET', 'PUT', 'DELETE'):
                route_key = f'{method} /recipes/{{id}}'
            elif path == '/ratings' and method in ('GET', 'POST'):
                route_key = f'{method} /ratings'

    # Normalize path for method+path matching
    norm_path = raw_path or ''
    while '//' in norm_path:
        norm_path = norm_path.replace('//', '/')
    if norm_path.endswith('/') and norm_path != '/':
        norm_path = norm_path.rstrip('/')

    # Emit a lightweight log line for quick diagnostics in CloudWatch
    try:
        region = os.environ.get('AWS_REGION', 'us-east-1')
        print(f"recipes lambda: method={method} route_key={route_key} raw_path={raw_path} table={RECIPES_TABLE} region={region}")
    except Exception:
        pass

    # Helper: extract identity from Cognito JWT claims (via API Gateway HTTP API authorizer)
    def get_identity():
        claims = (((event or {}).get('requestContext') or {}).get('authorizer') or {}).get('jwt', {}).get('claims', {})
        sub = claims.get('sub') or claims.get('cognito:username')
        email = claims.get('email')
        nickname = claims.get('nickname')
        # Derive a friendly display name
        name = nickname or ((email.split('@')[0]) if email and '@' in email else None) or sub or 'user'
        return {
            'sub': sub,
            'email': email,
            'name': name,
        }

    # Recipes
    if route_key in (
        'GET /recipes',
        'GET /recipes/{id}',
        'POST /recipes',
        'PUT /recipes/{id}',
        'DELETE /recipes/{id}',
    ) or (method == 'GET' and (norm_path == '/recipes' or norm_path.startswith('/recipes/'))):
        table = _get_table(RECIPES_TABLE, get_dynamodb())

        if route_key == 'GET /recipes' or (method == 'GET' and norm_path == '/recipes'):
            try:
                res = table.scan()
                items = res.get('Items', [])
                return response(200, [map_recipe_out(i) for i in items])
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'GET /recipes/{id}' or (method == 'GET' and norm_path.startswith('/recipes/')):
            recipe_id = path_params.get('id') or (norm_path.split('/')[-1] if norm_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                res = table.get_item(Key={'recipeId': recipe_id})
                item = res.get('Item')
                if not item:
                    return response(404, {'message': 'Not found'})
                return response(200, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'POST /recipes':
            try:
                body = json.loads(event.get('body') or '{}')
                recipe_id = str(uuid.uuid4())
                ident = get_identity()
                now = int(time.time())
                # Stamp attribution and timestamps
                item = {
                    'recipeId': recipe_id,
                    **body,
                    'createdAt': now,
                    'createdBySub': ident.get('sub'),
                    'createdByName': ident.get('name'),
                    'updatedAt': now,
                    'updatedBySub': ident.get('sub'),
                    'updatedByName': ident.get('name'),
                }
                table.put_item(Item=item)
                return response(201, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'PUT /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                body = json.loads(event.get('body') or '{}')
                ident = get_identity()
                now = int(time.time())

                # Load existing to preserve created* fields if present
                existing = table.get_item(Key={'recipeId': recipe_id}).get('Item') or {}
                created_at = existing.get('createdAt') or now
                created_by_sub = existing.get('createdBySub')
                created_by_name = existing.get('createdByName')

                item = {
                    'recipeId': recipe_id,
                    **existing,
                    **body,
                    # preserve original creation metadata
                    'createdAt': created_at,
                    'createdBySub': created_by_sub,
                    'createdByName': created_by_name,
                    # update modification metadata
                    'updatedAt': now,
                    'updatedBySub': ident.get('sub'),
                    'updatedByName': ident.get('name'),
                }
                table.put_item(Item=item)
                return response(200, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'DELETE /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                table.delete_item(Key={'recipeId': recipe_id})
                return response(204, {})
            except ClientError as e:
                return response(500, {'error': str(e)})

    # Ratings
    if route_key in ('POST /ratings', 'GET /ratings'):
        table = _get_table(RATINGS_TABLE, get_dynamodb())

        if route_key == 'POST /ratings':
            try:
                body = json.loads(event.get('body') or '{}')
                rating_id = str(uuid.uuid4())
                item = {'ratingId': rating_id, **body}
                table.put_item(Item=item)
                return response(201, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'GET /ratings':
            try:
                res = table.scan()
                items = res.get('Items', [])
                if 'recipeId' in query:
                    items = [i for i in items if i.get('recipeId') == query['recipeId']]
                return response(200, items)
            except ClientError as e:
                return response(500, {'error': str(e)})

    return response(400, {'message': 'Unsupported operation'})
