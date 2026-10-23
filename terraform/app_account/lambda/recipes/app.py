import os
import json
import uuid
import time
import sys
import urllib.error
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Make sibling modules importable when this file is loaded by path (tests).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_extract  # noqa: E402
import authz  # noqa: E402
import repo  # noqa: E402
import router  # noqa: E402
from recipe_input import EDITABLE_FIELDS, BadRequest, parse_recipe_body, parse_sharing, parse_version  # noqa: E402

# Cognito group whose members can read and delete any recipe (aws_cognito_user_group.admins).
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


# Stored for the indexes and authz, never sent to clients (docs/recipe-circles.md §7.4).
_INTERNAL = ('publicPk', 'circleIds', 'schemaV')


def map_recipe_out(item: dict | None, caller: authz.Caller | None = None) -> dict | None:
    """API shape of a stored recipe: isPublic instead of publicPk, and sharedIn (the
    circles the caller may see) instead of circleIds, when there's a signed-in caller.

    createdBySub/updatedBySub stay in public responses for now: both clients decide
    whether to show Delete from createdBySub until they read `access` (§11.4, Phase 3).
    """
    if not item:
        return None
    out = {k: v for k, v in item.items() if k not in _INTERNAL}
    rid = out.get('recipeId')
    if rid is not None:
        # Keep both for backward compatibility
        out['id'] = rid
        out['recipeId'] = rid
    out['isPublic'] = item.get('publicPk') == 'PUBLIC'
    if caller is not None and not caller.is_anon:
        out['sharedIn'] = authz.visible_circle_ids(caller, item)
        out['access'] = authz.recipe_access(caller, item).to_json()
    return out


def build_content_update(fields: dict, ident: dict, now: int):
    """UpdateItem parts for a PUT: SET the editable fields in the body, REMOVE the rest.

    Every attribute name goes through ExpressionAttributeNames, so DynamoDB reserved
    words never matter. createdAt is backfilled for recipes saved before it existed,
    and version goes up by one on every edit (optimistic locking, §6.2).
    """
    sets, removes, names = [], [], {}
    values = {':now': now, ':usub': ident.get('sub'), ':uname': ident.get('name'), ':one': 1}
    for i, field in enumerate(EDITABLE_FIELDS):
        names[f'#f{i}'] = field
        if field in fields:
            sets.append(f'#f{i} = :f{i}')
            values[f':f{i}'] = fields[field]
        else:
            removes.append(f'#f{i}')
    names.update({'#ua': 'updatedAt', '#ubs': 'updatedBySub', '#ubn': 'updatedByName', '#ca': 'createdAt',
                  '#ver': 'version'})
    sets += ['#ua = :now', '#ubs = :usub', '#ubn = :uname', '#ca = if_not_exists(#ca, :now)']
    expr = 'SET ' + ', '.join(sets)
    if removes:
        expr += ' REMOVE ' + ', '.join(removes)
    expr += ' ADD #ver :one'
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


def load_caller(event) -> authz.Caller:
    """The signed-in caller with their circle roles, or anonymous (§5 "Loading the caller").

    Memberships of circles being deleted are left out, so they grant nothing. Loaded on
    every request, never cached: a removed member loses access immediately.
    """
    ident = get_identity(event)
    sub = ident.get('sub')
    if not sub:
        return authz.ANONYMOUS
    circles = repo.circles_table()
    rows = repo.query_all(circles, IndexName='gsi1',
                          KeyConditionExpression=Key('gsi1pk').eq(f'USER#{sub}') & Key('gsi1sk').begins_with('CIRCLE#'))
    roles = {r['gsi1sk'][len('CIRCLE#'):]: r.get('role') for r in rows}
    if roles:
        metas = repo.batch_get_keys(circles, [{'pk': f'CIRCLE#{cid}', 'sk': 'META'} for cid in roles])
        live = {m['pk'][len('CIRCLE#'):] for m in metas if not m.get('deleting')}
        roles = {cid: role for cid, role in roles.items() if cid in live}
    return authz.Caller(sub, ident.get('name'), roles, is_admin=ADMIN_GROUP in ident.get('groups', []))


def _is_public(item) -> bool:
    return bool(item) and item.get('publicPk') == 'PUBLIC'


def list_recipes(event, params):
    # Public recipes only, newest first (gsi_public is sparse: private recipes aren't in it).
    # Never reads the Authorization header (I5).
    try:
        items = repo.query_all(repo.recipes_table(), IndexName='gsi_public', ScanIndexForward=False,
                               KeyConditionExpression=Key('publicPk').eq('PUBLIC'))
        return response(200, [map_recipe_out(i) for i in items])
    except ClientError as e:
        return response(500, {'error': str(e)})


def get_recipe(event, params):
    try:
        item = repo.recipes_table().get_item(Key={'recipeId': params['id']}).get('Item')
        # A private recipe looks exactly like a missing one here (§5 status codes).
        if not _is_public(item):
            return response(404, {'message': 'Not found'})
        return response(200, map_recipe_out(item))
    except ClientError as e:
        return response(500, {'error': str(e)})


def _default_sharing(caller: authz.Caller) -> dict:
    """Sharing for a create without a "sharing" key (§6.1, §8.1): public, plus the founding
    circle while old clients are around (LEGACY_DEFAULT_SHARE=founding) and the caller is in it."""
    circle_ids = []
    founding = os.environ.get('FOUNDING_CIRCLE_ID')
    if os.environ.get('LEGACY_DEFAULT_SHARE') == 'founding' and founding and caller.role_in(founding):
        circle_ids.append(founding)
    return {'isPublic': True, 'circleIds': circle_ids}


def _share_edge_actions(circles, cid: str, rid: str, sub: str, now: int) -> list[dict]:
    """Share a recipe into cid, restating the authz facts (I2, not deleting) as conditions."""
    pk = f'CIRCLE#{cid}'
    return [
        {'ConditionCheck': {'TableName': circles, 'Key': {'pk': pk, 'sk': f'MEMBER#{sub}'},
                            'ConditionExpression': 'attribute_exists(sk)'}},
        {'ConditionCheck': {'TableName': circles, 'Key': {'pk': pk, 'sk': 'META'},
                            'ConditionExpression': 'attribute_exists(pk) AND attribute_not_exists(deleting)'}},
        {'Put': {'TableName': circles, 'Item': {'pk': pk, 'sk': f'RECIPE#{rid}', 'sharedBySub': sub, 'sharedAt': now}}},
    ]


def create_recipe(event, params):
    try:
        # Only editable fields are taken from the body (recipe_input.py); ids, ownership,
        # sharing state, attribution and timestamps are always set here.
        raw = event.get('body')
        fields = parse_recipe_body(raw)
        sharing = parse_sharing(raw)
        caller = load_caller(event)
        if caller.is_anon:
            return response(401, {'message': 'Sign in to add a recipe'})
        if sharing is None:
            sharing = _default_sharing(caller)
        not_mine = [cid for cid in sharing['circleIds'] if not authz.can_share_into(caller, cid)]
        if not_mine:
            return response(400, {'message': "You can only share into brigades you're in", 'circleIds': not_mine})

        recipe_id = str(uuid.uuid4())
        ident = get_identity(event)
        now = int(time.time())
        item = {
            'recipeId': recipe_id,
            **fields,
            'ownerSub': caller.sub,
            'ownerName': ident.get('name'),
            'createdAt': now,
            'createdBySub': ident.get('sub'),
            'createdByName': ident.get('name'),
            'updatedAt': now,
            'updatedBySub': ident.get('sub'),
            'updatedByName': ident.get('name'),
            'version': 1,
            'schemaV': 2,
        }
        if sharing['isPublic']:
            item['publicPk'] = 'PUBLIC'
        if sharing['circleIds']:
            item['circleIds'] = set(sharing['circleIds'])
        recipes, circles = repo.recipes_table(), repo.circles_table()
        actions = [{'Put': {'TableName': recipes, 'Item': item,
                            'ConditionExpression': 'attribute_not_exists(recipeId)'}}]
        for cid in sharing['circleIds']:
            actions += _share_edge_actions(circles, cid, recipe_id, caller.sub, now)
        try:
            repo.transact(actions)
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') == 'TransactionCanceledException':
                # A membership or circle check failed: left or deleted since load_caller.
                return response(400, {'message': "You can only share into brigades you're in"})
            raise
        return response(201, map_recipe_out(item, caller))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def _access_condition(caller: authz.Caller, access: authz.Access, recipe: dict, version):
    """ConditionExpression parts for an edit, restating why it was allowed (§6.2)."""
    cond, names, values = ['attribute_exists(recipeId)'], {}, {}
    if version is not None:
        cond.append('#ver = :v')
        names['#ver'] = 'version'
        values[':v'] = version
    if access.relation != 'owner':
        # Access came from circles: the recipe must still be in one of them, so an
        # unshare between the read and the write fails instead of slipping through.
        granting = sorted(c for c in (recipe.get('circleIds') or ())
                          if authz.ROLE_RANK.get(caller.role_in(c) or '', 0) >= authz.ROLE_RANK['editor'])[:10]
        names['#cids'] = 'circleIds'
        ors = []
        for i, cid in enumerate(granting):
            ors.append(f'contains(#cids, :g{i})')
            values[f':g{i}'] = cid
        cond.append('(' + ' OR '.join(ors) + ')')
    return ' AND '.join(cond), names, values


def update_recipe(event, params):
    recipe_id = params['id']
    try:
        raw = event.get('body')
        fields = parse_recipe_body(raw)
        version = parse_version(raw)
        caller = load_caller(event)
        table = repo.recipes_table()
        existing = table.get_item(Key={'recipeId': recipe_id}).get('Item')
        access = authz.recipe_access(caller, existing) if existing else authz.NONE
        if not access.can_read:
            return response(404, {'message': 'Not found'})
        if not access.can_edit:
            return response(403, {'message': "That's not your recipe to change"})

        # Clients send the whole recipe and leave out empty fields, so an editable
        # field missing from the body was cleared in the editor: REMOVE it. Update
        # only the editable fields, updated* and version, so ownership, sharing and
        # anything else stored on the item is left alone.
        ident = get_identity(event)
        expr, names, values = build_content_update(fields, ident, int(time.time()))
        cond, cond_names, cond_values = _access_condition(caller, access, existing, version)
        try:
            res = table.update_item(
                Key={'recipeId': recipe_id},
                UpdateExpression=expr,
                ConditionExpression=cond,
                ExpressionAttributeNames={**names, **cond_names},
                ExpressionAttributeValues={**values, **cond_values},
                ReturnValues='ALL_NEW',
            )
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise
            # Something changed since the read: say what.
            current = table.get_item(Key={'recipeId': recipe_id}).get('Item')
            now_access = authz.recipe_access(caller, current) if current else authz.NONE
            if not now_access.can_read:
                return response(404, {'message': 'Not found'})
            if not now_access.can_edit:
                return response(403, {'message': "That's not your recipe to change"})
            return response(409, {'message': 'Someone else just changed this recipe',
                                  'recipe': map_recipe_out(current, caller)})
        return response(200, map_recipe_out(res.get('Attributes'), caller))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def delete_recipe(event, params):
    recipe_id = params['id']
    try:
        table = repo.recipes_table()
        existing = table.get_item(Key={'recipeId': recipe_id}).get('Item')
        if not existing:
            return response(204, {})
        caller = load_caller(event)
        access = authz.recipe_access(caller, existing)
        if not access.can_read:
            return response(404, {'message': 'Not found'})
        if not access.can_delete:
            return response(403, {'message': 'Only the cook who added this recipe can delete it'})

        # The delete's condition restates why it was allowed (§6.4): the owner still owns
        # it; a circle owner still runs every circle it's in and it hasn't been shared
        # anywhere else since the read; an admin needs nothing more.
        circle_ids = set(existing.get('circleIds') or ())
        recipes, circles = repo.recipes_table(), repo.circles_table()
        delete = {'TableName': recipes, 'Key': {'recipeId': recipe_id}}
        checks = []
        if access.relation == 'owner':
            delete.update(ConditionExpression='ownerSub = :sub', ExpressionAttributeValues={':sub': caller.sub})
        elif caller.is_admin:
            delete.update(ConditionExpression='attribute_exists(recipeId)')
        else:
            delete.update(ConditionExpression='circleIds = :seen', ExpressionAttributeValues={':seen': circle_ids})
            for cid in sorted(circle_ids):
                checks.append({'ConditionCheck': {
                    'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{caller.sub}'},
                    'ConditionExpression': '#r = :owner',
                    'ExpressionAttributeNames': {'#r': 'role'},
                    'ExpressionAttributeValues': {':owner': 'owner'}}})
        edges = [{'Delete': {'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': f'RECIPE#{recipe_id}'}}}
                 for cid in sorted(circle_ids)]
        try:
            repo.transact([{'Delete': delete}, *checks, *edges])
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') == 'TransactionCanceledException':
                return response(409, {'message': 'This recipe just changed; take another look before deleting it'})
            raise
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
