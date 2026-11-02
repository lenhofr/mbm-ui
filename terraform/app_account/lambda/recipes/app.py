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
from api import get_identity, load_caller, map_recipe_out, response  # noqa: E402
import circle_routes  # noqa: E402
import feed  # noqa: E402
import invite_routes  # noqa: E402
from recipe_input import (EDITABLE_FIELDS, BadRequest, parse_recipe_body, parse_sharing,  # noqa: E402
                          parse_sharing_state, parse_version)

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


def set_sharing(event, params):
    """PUT /recipes/{id}/sharing {isPublic, circleIds, version?}: the owner sets who sees a
    recipe (§6.3). The body is the full desired state, so repeating it changes nothing.

    updatedAt is left alone: sharing isn't an edit, and it shouldn't move the recipe up
    the list or show as "updated" on its page.
    """
    recipe_id = params['id']
    try:
        raw = event.get('body')
        desired = parse_sharing_state(raw)
        version = parse_version(raw)
        caller = load_caller(event)
        recipes, circles = repo.recipes_table(), repo.circles_table()
        existing = recipes.get_item(Key={'recipeId': recipe_id}).get('Item')
        access = authz.recipe_access(caller, existing) if existing else authz.NONE
        if not access.can_read:
            return response(404, {'message': 'Not found'})
        if not access.can_share:
            return response(403, {'message': 'Only the cook who added this recipe can change who sees it'})

        current, wanted = set(existing.get('circleIds') or ()), set(desired['circleIds'])
        to_add, to_remove = sorted(wanted - current), sorted(current - wanted)
        not_mine = [cid for cid in to_add if not authz.can_share_into(caller, cid)]
        if not_mine:
            return response(400, {'message': "You can only share into brigades you're in", 'circleIds': not_mine})

        sets, removes = [], []
        names = {'#ver': 'version', '#c': 'circleIds', '#pub': 'publicPk', '#owner': 'ownerSub'}
        values = {':one': 1, ':sub': caller.sub}
        if wanted:
            sets.append('#c = :cids')
            values[':cids'] = wanted
        else:
            removes.append('#c')
        if desired['isPublic']:
            sets.append('#pub = :pub')
            values[':pub'] = 'PUBLIC'
        else:
            removes.append('#pub')
        expr = (f'SET {", ".join(sets)} ' if sets else '') + (f'REMOVE {", ".join(removes)} ' if removes else '')
        cond = '#owner = :sub'
        if version is not None:
            cond += ' AND #ver = :v'
            values[':v'] = version
        now = int(time.time())
        actions = [{'Update': {'TableName': recipes, 'Key': {'recipeId': recipe_id},
                               'UpdateExpression': expr + 'ADD #ver :one', 'ConditionExpression': cond,
                               'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}}]
        for cid in to_add:
            actions += _share_edge_actions(circles, cid, recipe_id, caller.sub, now)
        for cid in to_remove:
            # The owner may always unshare; no condition, so a retry is harmless.
            actions.append({'Delete': {'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': f'RECIPE#{recipe_id}'}}})
        try:
            repo.transact(actions)
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'TransactionCanceledException':
                raise
            if repo.cancellation_codes(e)[0] != 'ConditionalCheckFailed':
                # A membership or circle check failed: left or deleted since load_caller.
                return response(400, {'message': "You can only share into brigades you're in"})
            current_item = recipes.get_item(Key={'recipeId': recipe_id}).get('Item')
            now_access = authz.recipe_access(caller, current_item) if current_item else authz.NONE
            if not now_access.can_read:
                return response(404, {'message': 'Not found'})
            if not now_access.can_share:
                return response(403, {'message': 'Only the cook who added this recipe can change who sees it'})
            return response(409, {'message': 'Someone else just changed this recipe',
                                  'recipe': map_recipe_out(current_item, caller)})

        item = {k: v for k, v in existing.items() if k not in ('circleIds', 'publicPk')}
        item['version'] = existing.get('version', 0) + 1
        if wanted:
            item['circleIds'] = wanted
        if desired['isPublic']:
            item['publicPk'] = 'PUBLIC'
        return response(200, map_recipe_out(item, caller))
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


def _copy_image(image: str | None) -> str | None:
    """A copy of the recipe's photo under a new key in the same folder (uploads/ or
    ai-sketches/, which is how the clients tell sketches from photos), so each recipe owns
    its image (§6.7 option A). Web URLs are kept as they are. If the copy fails, the copy
    points at the original image rather than losing it."""
    bucket = os.environ.get('IMAGES_BUCKET')
    if not image or '://' in image or '/' not in image or not bucket:
        return image
    folder, name = image.rsplit('/', 1)
    ext = os.path.splitext(name)[1]
    key = f'{folder}/{uuid.uuid4()}{ext}'
    try:
        s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
        s3.copy_object(Bucket=bucket, Key=key, CopySource={'Bucket': bucket, 'Key': image})
        return key
    except ClientError as e:
        print(f'copy image {image}: {e}')
        return image


def copy_recipe(event, params):
    """POST /recipes/{id}/copy: "Save to my recipes". Any recipe the caller can read becomes
    a new private recipe they own, remembering where it came from (§6.7)."""
    try:
        caller = load_caller(event)
        if caller.is_anon:
            return response(401, {'message': 'Sign in to save a recipe'})
        table = repo.recipes_table()
        source = table.get_item(Key={'recipeId': params['id']}).get('Item')
        if not source or not authz.recipe_access(caller, source).can_read:
            return response(404, {'message': 'Not found'})

        ident = get_identity(event)
        now = int(time.time())
        item = {f: source[f] for f in EDITABLE_FIELDS if f in source}
        if item.get('image'):
            item['image'] = _copy_image(item['image'])
        item.update({
            'recipeId': str(uuid.uuid4()),
            'ownerSub': caller.sub,
            'ownerName': ident.get('name'),
            'createdAt': now,
            'createdBySub': caller.sub,
            'createdByName': ident.get('name'),
            'updatedAt': now,
            'updatedBySub': caller.sub,
            'updatedByName': ident.get('name'),
            'version': 1,
            'schemaV': 2,
            'sourceRecipeId': source['recipeId'],
        })
        source_owner = source.get('ownerName') or source.get('createdByName')
        if source_owner:
            item['sourceOwnerName'] = source_owner
        table.put_item(Item=item, ConditionExpression='attribute_not_exists(recipeId)')
        return response(201, map_recipe_out(item, caller))
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
    'PUT /recipes/{id}/sharing': set_sharing,
    'POST /recipes/{id}/copy': copy_recipe,
    'GET /me/recipes': feed.list_feed,
    'GET /me/recipes/{id}': feed.get_mine,
    'GET /me/circles': circle_routes.list_mine,
    'POST /circles': circle_routes.create,
    'GET /circles/{cid}': circle_routes.get,
    'PATCH /circles/{cid}': circle_routes.update,
    'DELETE /circles/{cid}': circle_routes.delete,
    'PUT /circles/{cid}/members/{sub}': circle_routes.set_role,
    'DELETE /circles/{cid}/members/{sub}': circle_routes.remove_member,
    'DELETE /circles/{cid}/recipes/{rid}': circle_routes.unshare_recipe,
    'POST /circles/{cid}/invites': invite_routes.create,
    'GET /circles/{cid}/invites': invite_routes.list_codes,
    'DELETE /circles/{cid}/invites/{code}': invite_routes.revoke,
    'POST /circles/join': invite_routes.join,
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
