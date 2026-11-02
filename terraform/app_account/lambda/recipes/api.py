"""Shared request plumbing for the recipes Lambda: JSON responses, the caller's identity
and brigades, and the API shape of a recipe (docs/recipe-circles.md §5, §7.4).
"""
import json
from boto3.dynamodb.conditions import Key

import authz
import repo

# Cognito group whose members can read and delete any recipe (aws_cognito_user_group.admins).
ADMIN_GROUP = 'admins'


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
        'nickname': nickname,
        'groups': list(groups),
    }


def _refresh_display_name(circles, rows, nickname):
    """Copy a changed kitchen nickname onto the caller's memberships, so brigade member
    lists follow it. New cooks join (post-confirmation trigger) before they pick one.
    Only a real nickname claim counts, never a fallback; a failure here never fails the request.
    """
    if not nickname:
        return
    for row in rows:
        if row.get('displayName') == nickname:
            continue
        try:
            circles.update_item(Key={'pk': row['pk'], 'sk': row['sk']}, UpdateExpression='SET displayName = :n',
                                ConditionExpression='attribute_exists(sk)', ExpressionAttributeValues={':n': nickname})
        except Exception as e:  # noqa: BLE001
            print(f'refresh displayName {row.get("pk")}: {e}')


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
    _refresh_display_name(circles, rows, ident.get('nickname'))
    if roles:
        metas = repo.batch_get_keys(circles, [{'pk': f'CIRCLE#{cid}', 'sk': 'META'} for cid in roles])
        live = {m['pk'][len('CIRCLE#'):] for m in metas if not m.get('deleting')}
        roles = {cid: role for cid, role in roles.items() if cid in live}
    return authz.Caller(sub, ident.get('name'), roles, is_admin=ADMIN_GROUP in ident.get('groups', []))
