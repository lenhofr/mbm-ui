"""DynamoDB access for the recipes Lambda: tables, paginated reads, serialization.

Table names come from the environment when they're used, not at import, so tests can
set them before or after loading the module.
"""
import os
import time
from decimal import Decimal
import boto3
from boto3.dynamodb.types import TypeSerializer

# BatchGetItem takes at most 100 keys per call.
BATCH_GET_MAX = 100


def get_dynamodb():
    region = os.environ.get('AWS_REGION', 'us-east-1')
    return boto3.resource('dynamodb', region_name=region)


def table(env_var: str):
    name = os.environ.get(env_var)
    if not name:
        raise ValueError(f'{env_var} not set in environment')
    return get_dynamodb().Table(name)


def recipes_table():
    return table('RECIPES_TABLE')


def circles_table():
    return table('CIRCLES_TABLE')


def scan_all(tbl, **kwargs) -> list[dict]:
    """Every item in the table. Scan returns at most 1 MB per call, so follow LastEvaluatedKey."""
    items = []
    while True:
        res = tbl.scan(**kwargs)
        items.extend(res.get('Items', []))
        if 'LastEvaluatedKey' not in res:
            return items
        kwargs['ExclusiveStartKey'] = res['LastEvaluatedKey']


def query_all(tbl, **kwargs) -> list[dict]:
    """Every item a Query matches, across pages."""
    items = []
    while True:
        res = tbl.query(**kwargs)
        items.extend(res.get('Items', []))
        if 'LastEvaluatedKey' not in res:
            return items
        kwargs['ExclusiveStartKey'] = res['LastEvaluatedKey']


def batch_get(tbl, key_name: str, ids, retries: int = 5) -> list[dict]:
    """Items for ids (deduped, missing ones skipped), in chunks of 100, retrying UnprocessedKeys.

    Order isn't preserved: BatchGetItem returns items in any order.
    """
    return batch_get_keys(tbl, [{key_name: i} for i in ids], retries)


def batch_get_keys(tbl, keys, retries: int = 5) -> list[dict]:
    """batch_get for full keys (e.g. {'pk': ..., 'sk': ...}) on tables with a sort key."""
    unique = list({tuple(sorted(k.items())): k for k in keys}.values())
    resource = get_dynamodb()
    items = []
    for start in range(0, len(unique), BATCH_GET_MAX):
        request = {tbl.name: {'Keys': unique[start:start + BATCH_GET_MAX]}}
        for attempt in range(retries + 1):
            res = resource.batch_get_item(RequestItems=request)
            items.extend(res.get('Responses', {}).get(tbl.name, []))
            request = res.get('UnprocessedKeys') or {}
            if not request:
                break
            if attempt == retries:
                raise RuntimeError(f'batch_get: keys still unprocessed after {retries} retries')
            time.sleep(0.05 * 2 ** attempt)
    return items


_serializer = TypeSerializer()
_MARSHALLED = ('Item', 'Key', 'ExpressionAttributeValues')


def get_client():
    region = os.environ.get('AWS_REGION', 'us-east-1')
    return boto3.client('dynamodb', region_name=region)


def transact(actions: list[dict]):
    """TransactWriteItems with plain Python values in Item, Key and ExpressionAttributeValues.

    Each action is {'Put' | 'Update' | 'Delete' | 'ConditionCheck': {...}} as for the
    low-level client, with Table objects or names in TableName.
    """
    out = []
    for action in actions:
        (kind, params), = action.items()
        params = dict(params)
        if not isinstance(params['TableName'], str):
            params['TableName'] = params['TableName'].name
        for field in _MARSHALLED:
            if field in params:
                params[field] = {k: _serializer.serialize(v) for k, v in params[field].items()}
        out.append({kind: params})
    return get_client().transact_write_items(TransactItems=out)


def cancellation_codes(err) -> list[str]:
    """Per-action reason codes ('None', 'ConditionalCheckFailed', ...) of a cancelled transaction."""
    return [r.get('Code', 'None') for r in err.response.get('CancellationReasons', [])]


def to_jsonable(obj):
    """Recursively convert DynamoDB Decimals and sets to JSON-serializable types."""
    if isinstance(obj, Decimal):
        # Preserve integers as int, otherwise use float
        try:
            return int(obj) if obj % 1 == 0 else float(obj)
        except Exception:
            return float(obj)
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, set):
        return sorted(to_jsonable(v) for v in obj)
    return obj
