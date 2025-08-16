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


def _get_table(name, dynamodb):
    if not name:
        raise ValueError('Table name not set in environment')
    return dynamodb.Table(name)


def handler(event, context):
    # HTTP API v2 routing
    method = event.get('requestContext', {}).get('http', {}).get('method')
    raw_path = event.get('rawPath', '')
    query = event.get('queryStringParameters') or {}

    # Quick auth: require shared secret in header to reduce public abuse.
    # TODO: Replace with proper JWT/Cognito/Lambda authorizer in medium-term plan.
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    secret = os.environ.get('API_SHARED_SECRET')
    if secret:
        if headers.get('x-api-key') != secret:
            return response(401, {'message': 'unauthorized'})

    # Recipes routes
    if raw_path.startswith('/recipes'):
        table = _get_table(RECIPES_TABLE, get_dynamodb())

        # GET /recipes -> scan
        if method == 'GET' and raw_path == '/recipes':
            try:
                res = table.scan()
                items = res.get('Items', [])
                return response(200, items)
            except ClientError as e:
                return response(500, {'error': str(e)})

        # GET /recipes/{id}
        if method == 'GET' and raw_path.startswith('/recipes/'):
            recipe_id = raw_path.split('/')[-1]
            try:
                res = table.get_item(Key={'recipeId': recipe_id})
                item = res.get('Item')
                if not item:
                    return response(404, {'message': 'Not found'})
                return response(200, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        # POST /recipes -> create
        if method == 'POST' and raw_path == '/recipes':
            try:
                body = json.loads(event.get('body') or '{}')
                recipe_id = str(uuid.uuid4())
                item = {'recipeId': recipe_id, **body}
                table.put_item(Item=item)
                return response(201, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        # PUT /recipes/{id} -> update (full replace)
        if method == 'PUT' and raw_path.startswith('/recipes/'):
            recipe_id = raw_path.split('/')[-1]
            try:
                body = json.loads(event.get('body') or '{}')
                item = {'recipeId': recipe_id, **body}
                table.put_item(Item=item)
                return response(200, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        # DELETE /recipes/{id}
        if method == 'DELETE' and raw_path.startswith('/recipes/'):
            recipe_id = raw_path.split('/')[-1]
            try:
                table.delete_item(Key={'recipeId': recipe_id})
                return response(204, {})
            except ClientError as e:
                return response(500, {'error': str(e)})

    # Ratings routes (handled by same lambda)
    if raw_path.startswith('/ratings'):
        table = _get_table(RATINGS_TABLE, get_dynamodb())

        # POST /ratings -> create rating
        if method == 'POST' and raw_path == '/ratings':
            try:
                body = json.loads(event.get('body') or '{}')
                rating_id = str(uuid.uuid4())
                item = {'ratingId': rating_id, **body}
                table.put_item(Item=item)
                return response(201, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        # GET /ratings -> optionally filter by recipeId (scan + filter)
        if method == 'GET' and raw_path == '/ratings':
            try:
                if 'recipeId' in query:
                    # DynamoDB doesn't have a GSI here; use scan with FilterExpression
                    from boto3.dynamodb.conditions import Attr

                    res = table.scan(FilterExpression=Attr('recipeId').eq(query['recipeId']))
                else:
                    res = table.scan()
                return response(200, res.get('Items', []))
            except ClientError as e:
                return response(500, {'error': str(e)})

    return response(400, {'message': 'Unsupported operation'})
