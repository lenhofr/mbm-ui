import os, time, json, boto3
from botocore.exceptions import ClientError

TABLE = os.environ.get('INVITES_TABLE')
ddb = boto3.client('dynamodb')

def handler(event, _ctx):
    # minimal safe placeholder: deny missing code, allow if exists and mark used
    attrs = (event.get('request') or {}).get('userAttributes') or {}
    email = attrs.get('email') or ''
    code  = attrs.get('custom:invite')
    if not code:
        raise Exception(json.dumps({'message': 'Missing invite code'}))

    now = int(time.time())
    used_at_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))

    meta_key = {"code": {"S": code}, "sk": {"S": "META"}}
    use_item = {
        "code":         {"S": code},
        "sk":           {"S": f"USE#{used_at_iso}#{email}"},
        "email":        {"S": email},
        "usedAt":       {"N": str(now)}
    }

    update_expr = "SET lastUsedAt=:ts, lastUsedBy=:email, #used=:true ADD uses :one"
    cond_expr = (
        "attribute_exists(code) AND attribute_exists(sk) AND sk = :meta AND "
        "(attribute_not_exists(revoked) OR revoked = :false) AND "
        "(attribute_not_exists(expiresAt) OR expiresAt > :ts) AND ("
          "(attribute_exists(unlimited) AND unlimited = :true) OR "
          "(attribute_exists(maxUses) AND (attribute_not_exists(uses) OR uses < maxUses)) OR "
          "(attribute_not_exists(maxUses) AND (attribute_not_exists(#used) OR #used = :false))"
        ")"
    )

    try:
        ddb.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": TABLE,
                        "Key": meta_key,
                        "UpdateExpression": update_expr,
                        "ConditionExpression": cond_expr,
                        "ExpressionAttributeNames": {"#used": "used"},
                        "ExpressionAttributeValues": {
                            ":ts":    {"N": str(now)},
                            ":email": {"S": email},
                            ":true":  {"BOOL": True},
                            ":false": {"BOOL": False},
                            ":one":   {"N": "1"},
                            ":meta":  {"S": "META"},
                        }
                    }
                },
                {
                    "Put": {
                        "TableName": TABLE,
                        "Item": use_item,
                        "ConditionExpression": "attribute_not_exists(code) AND attribute_not_exists(sk)"
                    }
                }
            ]
        )
    except ClientError as e:
        code_str = e.response.get("Error", {}).get("Code", "")
        if code_str in ("ConditionalCheckFailedException", "TransactionCanceledException"):
            raise Exception(json.dumps({'message': 'Invalid, expired, revoked, or exhausted invite code'}))
        raise

    event.setdefault('response', {})
    return event
