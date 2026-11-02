"""Brigade invite codes: mint, list, revoke, and join with one (docs/recipe-circles.md §6.8).

Codes live in mbm-invites next to the sign-up codes, so they share the uses/maxUses/
expiry/revoked rules of auth/pre_sign_up.py. A brigade code (kind "circle") only adds an
existing user to a brigade; it can't create an account (pre_sign_up.py refuses it).
Each code also has a pointer item CIRCLE#cid / INVITE#code in mbm-circles so a brigade's
codes can be listed.
"""
import secrets
import time
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import authz
import repo
from api import get_identity, load_caller, response
from circle_routes import summary
from recipe_input import BadRequest, parse_invite_body, parse_join_body

SITE_URL = 'https://mealsbymaggie.com'
MAX_ACTIVE_INVITES = 20     # per brigade (§11.6)
MAX_MEMBERS = 200           # per brigade (§11.6)
# Uppercase without look-alikes (0/O, 1/I/L), so a code read aloud or typed still works.
# 14 characters from 31 is about 69 bits: guessing one is hopeless (§6.8).
_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
_CODE_LEN = 14

# Same rule as auth/pre_sign_up.py: not revoked, not expired, and uses left.
USABLE = (
    "attribute_exists(code) AND sk = :meta AND "
    "(attribute_not_exists(revoked) OR revoked = :false) AND "
    "(attribute_not_exists(expiresAt) OR expiresAt > :ts) AND ("
    "(attribute_exists(unlimited) AND unlimited = :true) OR "
    "(attribute_exists(maxUses) AND (attribute_not_exists(uses) OR uses < maxUses)) OR "
    "(attribute_not_exists(maxUses) AND (attribute_not_exists(#used) OR #used = :false))"
    ")"
)


def invites_table():
    return repo.table('INVITES_TABLE')


def new_code() -> str:
    return 'C-' + ''.join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))


def _usable(invite: dict, now: int) -> bool:
    """USABLE, for listing (the condition itself guards joins)."""
    if invite.get('revoked') or invite.get('expiresAt', now + 1) <= now:
        return False
    if invite.get('unlimited'):
        return True
    if 'maxUses' in invite:
        return invite.get('uses', 0) < invite['maxUses']
    return not invite.get('used')


def _invite_out(invite: dict, now: int) -> dict:
    code = invite['code']
    return {'code': code, 'url': f'{SITE_URL}/join?code={code}', 'role': invite.get('circleRole', 'editor'),
            'uses': invite.get('uses', 0), 'maxUses': invite.get('maxUses'), 'expiresAt': invite.get('expiresAt'),
            'createdAt': invite.get('issuedAt'), 'active': _usable(invite, now)}


def _may_invite(caller: authz.Caller, cid: str):
    """None if the caller may manage cid's codes, else the error response."""
    if not caller.role_in(cid):
        return response(404, {'message': 'Not found'})
    if not authz.can_manage_circle(caller, cid, 'editor'):
        return response(403, {'message': 'Only Sous-chefs and the Chef can invite people'})
    return None


def _pointers(circles, cid):
    return repo.query_all(circles, KeyConditionExpression=Key('pk').eq(f'CIRCLE#{cid}') & Key('sk').begins_with('INVITE#'))


def create(event, params):
    """POST /circles/{cid}/invites {maxUses?, ttlDays?, role?}: Sous-chef or Chef."""
    cid = params['cid']
    try:
        opts = parse_invite_body(event.get('body'))
        caller = load_caller(event)
        denied = _may_invite(caller, cid)
        if denied:
            return denied
        circles, invites = repo.circles_table(), invites_table()
        now = int(time.time())
        codes = [p['sk'][len('INVITE#'):] for p in _pointers(circles, cid)]
        live = [i for i in repo.batch_get_keys(invites, [{'code': c, 'sk': 'META'} for c in codes]) if _usable(i, now)]
        if len(live) >= MAX_ACTIVE_INVITES:
            return response(400, {'message': f'This brigade already has {MAX_ACTIVE_INVITES} open invites; revoke one first'})

        code = new_code()
        invite = {'code': code, 'sk': 'META', 'kind': 'circle', 'circleId': cid, 'circleRole': opts['role'],
                  'maxUses': opts['maxUses'], 'uses': 0, 'issuedAt': now, 'expiresAt': now + opts['ttlDays'] * 86400,
                  'createdBySub': caller.sub}
        repo.transact([
            {'Put': {'TableName': invites, 'Item': invite, 'ConditionExpression': 'attribute_not_exists(code)'}},
            {'Put': {'TableName': circles, 'Item': {'pk': f'CIRCLE#{cid}', 'sk': f'INVITE#{code}',
                                                    'createdBySub': caller.sub, 'createdAt': now}}},
            {'ConditionCheck': {'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{caller.sub}'},
                                'ConditionExpression': '#r IN (:editor, :owner)', 'ExpressionAttributeNames': {'#r': 'role'},
                                'ExpressionAttributeValues': {':editor': 'editor', ':owner': 'owner'}}},
            {'ConditionCheck': {'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': 'META'},
                                'ConditionExpression': 'attribute_exists(pk) AND attribute_not_exists(deleting)'}},
        ])
        return response(201, _invite_out(invite, now))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') == 'TransactionCanceledException':
            return response(409, {'message': 'The brigade just changed; take another look'})
        return response(500, {'error': str(e)})


def list_codes(event, params):
    """GET /circles/{cid}/invites: the brigade's codes, newest first, with whether each still works."""
    cid = params['cid']
    try:
        caller = load_caller(event)
        denied = _may_invite(caller, cid)
        if denied:
            return denied
        codes = [p['sk'][len('INVITE#'):] for p in _pointers(repo.circles_table(), cid)]
        invites = repo.batch_get_keys(invites_table(), [{'code': c, 'sk': 'META'} for c in codes])
        now = int(time.time())
        out = [_invite_out(i, now) for i in invites if not i.get('revoked')]
        out.sort(key=lambda i: (i['createdAt'] or 0, i['code']), reverse=True)
        return response(200, out)
    except ClientError as e:
        return response(500, {'error': str(e)})


def revoke(event, params):
    """DELETE /circles/{cid}/invites/{code}: Sous-chef or Chef. Only this brigade's codes."""
    cid, code = params['cid'], params['code']
    try:
        caller = load_caller(event)
        denied = _may_invite(caller, cid)
        if denied:
            return denied
        try:
            invites_table().update_item(Key={'code': code, 'sk': 'META'}, UpdateExpression='SET revoked = :t',
                                        ConditionExpression='circleId = :cid',
                                        ExpressionAttributeValues={':t': True, ':cid': cid})
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise
            # Not this brigade's code (or no such code): nothing to revoke here.
        repo.circles_table().delete_item(Key={'pk': f'CIRCLE#{cid}', 'sk': f'INVITE#{code}'})
        return response(204, {})
    except ClientError as e:
        return response(500, {'error': str(e)})


def join(event, params):
    """POST /circles/join {code}: a signed-in user joins the brigade the code points at.

    Joining a brigade you're already in is a no-op that doesn't use up the code.
    """
    try:
        code = parse_join_body(event.get('body'))
        caller = load_caller(event)
        if caller.is_anon:
            return response(401, {'message': 'Sign in to join a brigade'})
        invites, circles = invites_table(), repo.circles_table()
        # Codes are minted uppercase and people type them in any case; older sign-up codes
        # may be mixed case, so try the code as typed first (as pre_sign_up.py does).
        invite = invites.get_item(Key={'code': code, 'sk': 'META'}).get('Item')
        if not invite and code != code.upper():
            code = code.upper()
            invite = invites.get_item(Key={'code': code, 'sk': 'META'}).get('Item')
        cid = (invite or {}).get('circleId')
        bad_code = response(400, {'message': "That code doesn't work. It may have expired or been used up."})
        if not cid:
            return bad_code
        meta = circles.get_item(Key={'pk': f'CIRCLE#{cid}', 'sk': 'META'}).get('Item')
        if not meta or meta.get('deleting'):
            return bad_code
        if caller.role_in(cid):
            return response(200, summary(meta, caller.role_in(cid)))

        ident = get_identity(event)
        role = invite.get('circleRole') if invite.get('circleRole') in ('member', 'editor') else 'editor'
        now = int(time.time())
        used_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))
        who = ident.get('email') or caller.sub
        try:
            repo.transact([
                {'Update': {'TableName': invites, 'Key': {'code': code, 'sk': 'META'},
                            'UpdateExpression': 'SET lastUsedAt = :ts, lastUsedBy = :who, #used = :true ADD uses :one',
                            'ConditionExpression': USABLE + ' AND circleId = :cid',
                            'ExpressionAttributeNames': {'#used': 'used'},
                            'ExpressionAttributeValues': {':ts': now, ':who': who, ':true': True, ':false': False,
                                                          ':one': 1, ':meta': 'META', ':cid': cid}}},
                {'Put': {'TableName': invites, 'Item': {'code': code, 'sk': f'USE#{used_at}#{who}', 'email': who,
                                                        'usedAt': now, 'sub': caller.sub, 'circleId': cid},
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
                {'Put': {'TableName': circles, 'ConditionExpression': 'attribute_not_exists(sk)',
                         'Item': {'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{caller.sub}', 'gsi1pk': f'USER#{caller.sub}',
                                  'gsi1sk': f'CIRCLE#{cid}', 'role': role, 'displayName': ident.get('name'),
                                  'circleName': meta.get('name'), 'joinedAt': now, 'inviteCode': code,
                                  **({'invitedBy': invite['createdBySub']} if invite.get('createdBySub') else {})}}},
                {'Update': {'TableName': circles, 'Key': {'pk': f'CIRCLE#{cid}', 'sk': 'META'},
                            'UpdateExpression': 'ADD memberCount :one',
                            'ConditionExpression': 'attribute_exists(pk) AND attribute_not_exists(deleting) '
                                                   'AND (attribute_not_exists(memberCount) OR memberCount < :max)',
                            'ExpressionAttributeValues': {':one': 1, ':max': MAX_MEMBERS}}},
            ])
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'TransactionCanceledException':
                raise
            failed = [i for i, c in enumerate(repo.cancellation_codes(e)) if c == 'ConditionalCheckFailed']
            if 2 in failed:
                # Joined in a parallel request a moment ago.
                return response(200, summary(meta, circles.get_item(
                    Key={'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{caller.sub}'}).get('Item', {}).get('role')))
            if 3 in failed:
                return response(400, {'message': f'{meta.get("name")} is full ({MAX_MEMBERS} cooks)'})
            return bad_code
        return response(200, summary({**meta, 'memberCount': meta.get('memberCount', 0) + 1}, role))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})
