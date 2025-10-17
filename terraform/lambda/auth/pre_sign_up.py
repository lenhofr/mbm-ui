import os, time, json, boto3
from botocore.exceptions import ClientError

TABLE = os.environ.get('INVITES_TABLE')
dynamodb = boto3.resource('dynamodb')

def handler(event, _ctx):
    # minimal safe placeholder: deny missing code, allow if exists and mark used
    attrs = (event.get('request') or {}).get('userAttributes') or {}
    email = attrs.get('email') or ''
    code  = attrs.get('custom:invite')
    if not code:
        raise Exception(json.dumps({'message': 'Missing invite code'}))

    table = dynamodb.Table(TABLE)
    now = int(time.time())
    try:
        table.update_item(
            Key={'code': code},
            UpdateExpression="SET #u = :true, usedAt = :ts, usedBy = :email",
            ConditionExpression=(
                "attribute_exists(code) AND "
                "(attribute_not_exists(revoked) OR revoked = :false) AND "
                "(attribute_not_exists(used) OR #u = :false) AND "
                "(attribute_not_exists(expiresAt) OR expiresAt > :ts)"
            ),
            ExpressionAttributeNames={'#u': 'used'},
            ExpressionAttributeValues={':true': True, ':false': False, ':ts': now, ':email': email},
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise Exception(json.dumps({'message': 'Invalid, revoked, expired, or already used invite code'}))
        raise

    event.setdefault('response', {})
    return event
