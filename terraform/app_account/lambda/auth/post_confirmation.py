"""Cognito post-confirmation trigger: a new cook whose sign-up code points at a brigade
joins it (docs/recipe-circles.md §6.9).

pre_sign_up.py already checked and used up the code, so this only reads it. Joining is
idempotent (the membership is only written if it doesn't exist), and this never raises:
the account is confirmed either way, and an error here would only show the new cook a
failure for a sign-up that worked. Anything missed can be fixed by hand or with a
brigade code.
"""
import os
import time
import boto3
from boto3.dynamodb.types import TypeSerializer

from pre_sign_up import _stored_code

_ser = TypeSerializer()


def _m(item):
    return {k: _ser.serialize(v) for k, v in item.items()}


def display_name(attrs):
    """Same order as scripts/lib/circles.mjs displayName: nickname, else the email's local part."""
    email = attrs.get('email') or ''
    return (attrs.get('nickname') or attrs.get('preferred_username') or attrs.get('name')
            or (email.split('@')[0] if '@' in email else None) or attrs.get('sub') or 'cook')


def add_member(ddb, circles, cid, sub, role, name, invited_by, code, now):
    """MEMBER row plus memberCount, together; False if they're already a member or the brigade is gone."""
    member = {'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{sub}', 'gsi1pk': f'USER#{sub}', 'gsi1sk': f'CIRCLE#{cid}',
              'role': role, 'displayName': name, 'joinedAt': now, 'inviteCode': code}
    if invited_by:
        member['invitedBy'] = invited_by
    meta_key = {'pk': {'S': f'CIRCLE#{cid}'}, 'sk': {'S': 'META'}}
    meta = ddb.get_item(TableName=circles, Key=meta_key).get('Item') or {}
    if not meta or 'deleting' in meta:
        return False
    member['circleName'] = meta.get('name', {}).get('S')
    try:
        ddb.transact_write_items(TransactItems=[
            {'Put': {'TableName': circles, 'Item': _m(member), 'ConditionExpression': 'attribute_not_exists(sk)'}},
            {'Update': {'TableName': circles, 'Key': meta_key, 'UpdateExpression': 'ADD memberCount :one',
                        'ConditionExpression': 'attribute_exists(pk) AND attribute_not_exists(deleting)',
                        'ExpressionAttributeValues': {':one': {'N': '1'}}}},
        ])
    except ddb.exceptions.TransactionCanceledException:
        return False
    return True


def handler(event, _ctx):
    try:
        if event.get('triggerSource') != 'PostConfirmation_ConfirmSignUp':
            return event                    # e.g. a forgot-password confirmation
        attrs = (event.get('request') or {}).get('userAttributes') or {}
        sub, code = attrs.get('sub'), (attrs.get('custom:invite') or '').strip()
        if not sub or not code:
            return event
        ddb = boto3.client('dynamodb')
        code = _stored_code(code)
        meta = ddb.get_item(TableName=os.environ['INVITES_TABLE'],
                            Key={'code': {'S': code}, 'sk': {'S': 'META'}}).get('Item') or {}
        cid = meta.get('circleId', {}).get('S')
        if not cid:
            return event
        role = meta.get('circleRole', {}).get('S')
        added = add_member(ddb, os.environ['CIRCLES_TABLE'], cid, sub,
                           role if role in ('member', 'editor') else 'editor',
                           display_name(attrs), meta.get('createdBySub', {}).get('S'), code, int(time.time()))
        print(f'post-confirmation: {sub} {"joined" if added else "already in or gone"} {cid}')
    except Exception as e:  # noqa: BLE001
        print(f'post-confirmation failed: {e}')
    return event
