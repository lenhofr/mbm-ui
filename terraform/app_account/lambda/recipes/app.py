import os
import json
from decimal import Decimal
import uuid
import time
import sys
import urllib.error
import boto3
from botocore.exceptions import ClientError

# Make sibling modules importable when this file is loaded by path (tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_extract  # noqa: E402
from recipe_input import EDITABLE_FIELDS, BadRequest, parse_recipe_body  # noqa: E402

RECIPES_TABLE = os.environ.get('RECIPES_TABLE')
# Cognito group whose members can delete any recipe (aws_cognito_user_group.admins).
ADMIN_GROUP = 'admins'

BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6"
# For ~10x cost reduction with slightly lower quality, switch to: us.anthropic.claude-haiku-4-5

_bedrock = None
_bedrock_expiry = 0  # epoch seconds; 0 means never set

def get_bedrock():
    global _bedrock, _bedrock_expiry
    region = os.environ.get("AWS_REGION", "us-east-1")
    role_arn = os.environ.get("BEDROCK_ROLE_ARN")
    if role_arn:
        # Refresh assumed-role credentials when they're within 5 minutes of expiry
        if _bedrock is None or time.time() > _bedrock_expiry - 300:
            sts = boto3.client("sts")
            assumed = sts.assume_role(
                RoleArn=role_arn,
                RoleSessionName="mbm-recipes-bedrock",
            )
            creds = assumed["Credentials"]
            _bedrock_expiry = int(assumed["Credentials"]["Expiration"].timestamp())
            _bedrock = boto3.client(
                "bedrock-runtime",
                region_name=region,
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
    elif _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=region)
    return _bedrock


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


def build_content_update(fields: dict, ident: dict, now: int):
    """UpdateItem parts for a PUT: SET the editable fields in the body, REMOVE the rest.

    Every attribute name goes through ExpressionAttributeNames, so DynamoDB reserved
    words never matter. createdAt is backfilled for recipes saved before it existed.
    """
    sets, removes, names = [], [], {}
    values = {':now': now, ':usub': ident.get('sub'), ':uname': ident.get('name')}
    for i, field in enumerate(EDITABLE_FIELDS):
        names[f'#f{i}'] = field
        if field in fields:
            sets.append(f'#f{i} = :f{i}')
            values[f':f{i}'] = fields[field]
        else:
            removes.append(f'#f{i}')
    names.update({'#ua': 'updatedAt', '#ubs': 'updatedBySub', '#ubn': 'updatedByName', '#ca': 'createdAt'})
    sets += ['#ua = :now', '#ubs = :usub', '#ubn = :uname', '#ca = if_not_exists(#ca, :now)']
    expr = 'SET ' + ', '.join(sets)
    if removes:
        expr += ' REMOVE ' + ', '.join(removes)
    return expr, names, values


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
            elif path == '/ai/extract-recipe' and method == 'POST':
                route_key = 'POST /ai/extract-recipe'

    # If route_key provided but unexpected (e.g., path has trailing slash), re-derive a normalized key
    expected = {
        'GET /recipes',
        'GET /recipes/{id}',
        'POST /recipes',
        'PUT /recipes/{id}',
        'DELETE /recipes/{id}',
        'POST /ai/extract-recipe',
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
        rc = (event or {}).get('requestContext') or {}
        auth_ctx = (rc.get('authorizer') or {})
        claims = (auth_ctx.get('jwt') or {}).get('claims') or auth_ctx.get('claims') or {}

        # Identity comes only from claims the API Gateway JWT authorizer verified. Never
        # decode the Authorization header here: on a route without the authorizer that
        # token is unverified, and anyone could put any sub or group in it.

        # Pull out common user identifiers from either ID or Access token
        sub = (claims.get('sub')
               or claims.get('cognito:username')
               or claims.get('username'))
        email = claims.get('email')

        # Prefer friendly names if present
        nickname = (claims.get('nickname')
                    or claims.get('preferred_username')
                    or claims.get('name'))
        given = claims.get('given_name')
        family = claims.get('family_name')

        friendly_from_email = None
        if email and isinstance(email, str) and '@' in email:
            friendly_from_email = email.split('@')[0]

        # Derive display name by precedence
        name = (
            nickname
            or (f"{given} {family}".strip() if given or family else None)
            or friendly_from_email
            or (claims.get('cognito:username') or claims.get('username'))
            or sub
            or 'user'
        )

        # Cognito groups: a list in a decoded token; API Gateway's JWT authorizer
        # passes list claims as a string like "[admins]".
        groups = claims.get('cognito:groups') or []
        if isinstance(groups, str):
            groups = groups.strip('[]').replace(',', ' ').split()

        return {
            'sub': sub,
            'email': email,
            'name': name,
            'groups': list(groups),
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
                # Scan returns at most 1 MB per call; follow LastEvaluatedKey so a growing
                # recipe box doesn't silently lose its oldest recipes.
                items, kwargs = [], {}
                while True:
                    res = table.scan(**kwargs)
                    items.extend(res.get('Items', []))
                    if 'LastEvaluatedKey' not in res:
                        break
                    kwargs['ExclusiveStartKey'] = res['LastEvaluatedKey']
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
                # Only editable fields are taken from the body (recipe_input.py); ids,
                # attribution and timestamps are always set here.
                fields = parse_recipe_body(event.get('body'))
                recipe_id = str(uuid.uuid4())
                ident = get_identity()
                now = int(time.time())
                item = {
                    'recipeId': recipe_id,
                    **fields,
                    'createdAt': now,
                    'createdBySub': ident.get('sub'),
                    'createdByName': ident.get('name'),
                    'updatedAt': now,
                    'updatedBySub': ident.get('sub'),
                    'updatedByName': ident.get('name'),
                }
                table.put_item(Item=item, ConditionExpression='attribute_not_exists(recipeId)')
                return response(201, map_recipe_out(item))
            except BadRequest as e:
                return response(400, {'message': str(e)})
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'PUT /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                fields = parse_recipe_body(event.get('body'))
                ident = get_identity()
                now = int(time.time())
                # Anyone signed in can edit (only deletes are limited); per-recipe edit
                # rights arrive with brigades (docs/recipe-circles.md).
                #
                # Clients send the whole recipe and leave out empty fields, so an editable
                # field missing from the body was cleared in the editor: REMOVE it. Update
                # only the editable fields and updated*, so attribution and anything else
                # stored on the item is left alone. The condition stops PUT from creating
                # a recipe under an id the client made up.
                expr, names, values = build_content_update(fields, ident, now)
                res = table.update_item(
                    Key={'recipeId': recipe_id},
                    UpdateExpression=expr,
                    ConditionExpression='attribute_exists(recipeId)',
                    ExpressionAttributeNames=names,
                    ExpressionAttributeValues=values,
                    ReturnValues='ALL_NEW',
                )
                return response(200, map_recipe_out(res.get('Attributes')))
            except BadRequest as e:
                return response(400, {'message': str(e)})
            except ClientError as e:
                if e.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                    return response(404, {'message': 'Not found'})
                return response(500, {'error': str(e)})

        if route_key == 'DELETE /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                # Only the cook who added a recipe, or an admin, can delete it (anyone
                # signed in can edit). Recipes saved before attribution are admin-only.
                existing = table.get_item(Key={'recipeId': recipe_id}).get('Item')
                if not existing:
                    return response(204, {})
                ident = get_identity()
                is_owner = bool(ident.get('sub')) and existing.get('createdBySub') == ident.get('sub')
                if not (is_owner or ADMIN_GROUP in ident.get('groups', [])):
                    return response(403, {'message': 'Only the cook who added this recipe can delete it'})
                table.delete_item(Key={'recipeId': recipe_id})
                return response(204, {})
            except ClientError as e:
                return response(500, {'error': str(e)})
    # AI recipe extraction
    if route_key == 'POST /ai/extract-recipe':
        try:
            body = json.loads(event.get('body') or '{}')
            known_tags = [t for t in (body.get('knownTags') or []) if isinstance(t, str)][:30]
            main_tags = [t for t in (body.get('mainTags') or []) if isinstance(t, str)][:30]
            tags = {'known_tags': known_tags, 'main_tags': main_tags}
            extract_type = body.get('type')
            if extract_type == 'image':
                result = ai_extract.extract_from_images(get_bedrock(), BEDROCK_MODEL, body.get('images') or [],
                                                        source=body.get('source') or 'scan', **tags)
            elif extract_type == 'url':
                result = ai_extract.extract_from_url(get_bedrock(), BEDROCK_MODEL, (body.get('url') or '').strip(), **tags)
            elif extract_type == 'text':
                result = ai_extract.extract_from_text(get_bedrock(), BEDROCK_MODEL, body.get('text') or '', **tags)
            else:
                return response(400, {'error': 'type must be "image", "url" or "text"'})
            return response(200, result)
        except ai_extract.ExtractError as e:
            return response(400, {'error': str(e)})
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"extract-recipe fetch error: {e}")
            return response(502, {'error': "We couldn't open that page"})
        except ClientError as e:
            print(f"Bedrock error: {e}")
            return response(502, {'error': 'AI service error'})
        except Exception as e:
            print(f"extract-recipe error: {e}")
            return response(500, {'error': 'Extraction failed'})

    return response(400, {'message': 'Unsupported operation'})
