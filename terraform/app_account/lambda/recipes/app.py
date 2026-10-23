import os
import json
import uuid
import time
import sys
import urllib.error
import boto3
from botocore.exceptions import ClientError

# Make sibling modules importable when this file is loaded by path (tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_extract  # noqa: E402
import repo  # noqa: E402
import router  # noqa: E402
from recipe_input import EDITABLE_FIELDS, BadRequest, parse_recipe_body  # noqa: E402

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


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(repo.to_jsonable(body)),
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


def get_identity(event):
    """The caller's sub, email, display name and Cognito groups from the verified JWT claims."""
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


def list_recipes(event, params):
    try:
        items = repo.scan_all(repo.recipes_table())
        return response(200, [map_recipe_out(i) for i in items])
    except ClientError as e:
        return response(500, {'error': str(e)})


def get_recipe(event, params):
    try:
        item = repo.recipes_table().get_item(Key={'recipeId': params['id']}).get('Item')
        if not item:
            return response(404, {'message': 'Not found'})
        return response(200, map_recipe_out(item))
    except ClientError as e:
        return response(500, {'error': str(e)})


def create_recipe(event, params):
    try:
        # Only editable fields are taken from the body (recipe_input.py); ids,
        # attribution and timestamps are always set here.
        fields = parse_recipe_body(event.get('body'))
        recipe_id = str(uuid.uuid4())
        ident = get_identity(event)
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
        repo.recipes_table().put_item(Item=item, ConditionExpression='attribute_not_exists(recipeId)')
        return response(201, map_recipe_out(item))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def update_recipe(event, params):
    try:
        fields = parse_recipe_body(event.get('body'))
        ident = get_identity(event)
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
        res = repo.recipes_table().update_item(
            Key={'recipeId': params['id']},
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


def delete_recipe(event, params):
    recipe_id = params['id']
    try:
        # Only the cook who added a recipe, or an admin, can delete it (anyone
        # signed in can edit). Recipes saved before attribution are admin-only.
        table = repo.recipes_table()
        existing = table.get_item(Key={'recipeId': recipe_id}).get('Item')
        if not existing:
            return response(204, {})
        ident = get_identity(event)
        is_owner = bool(ident.get('sub')) and existing.get('createdBySub') == ident.get('sub')
        if not (is_owner or ADMIN_GROUP in ident.get('groups', [])):
            return response(403, {'message': 'Only the cook who added this recipe can delete it'})
        table.delete_item(Key={'recipeId': recipe_id})
        return response(204, {})
    except ClientError as e:
        return response(500, {'error': str(e)})


def extract_recipe(event, params):
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


# Route key (as in the aws_apigatewayv2_route resources) -> handler(event, path_params).
ROUTES = {
    'GET /recipes': list_recipes,
    'GET /recipes/{id}': get_recipe,
    'POST /recipes': create_recipe,
    'PUT /recipes/{id}': update_recipe,
    'DELETE /recipes/{id}': delete_recipe,
    'POST /ai/extract-recipe': extract_recipe,
}


def handler(event, context):
    route_key, params = router.resolve(event, ROUTES)

    # Emit a lightweight log line for quick diagnostics in CloudWatch
    try:
        print(f"recipes lambda: method={router.method_of(event)} route_key={route_key} "
              f"raw_path={event.get('rawPath')} table={os.environ.get('RECIPES_TABLE')} "
              f"region={os.environ.get('AWS_REGION', 'us-east-1')}")
    except Exception:
        pass

    if not route_key:
        return response(400, {'message': 'Unsupported operation'})
    return ROUTES[route_key](event, params)
