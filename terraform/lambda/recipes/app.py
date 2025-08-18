import os
import json
import uuid
import boto3
from botocore.exceptions import ClientError

RECIPES_TABLE = os.environ.get('RECIPES_TABLE')
RATINGS_TABLE = os.environ.get('RATINGS_TABLE')


def get_dynamodb():
    region = os.environ.get('AWS_REGION', 'us-east-1')
    return boto3.resource('dynamodb', region_name=region)


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
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
                item = {'recipeId': recipe_id, **body}
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
                item = {'recipeId': recipe_id, **body}
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
