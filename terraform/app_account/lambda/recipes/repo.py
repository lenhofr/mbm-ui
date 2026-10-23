"""DynamoDB access for the recipes Lambda: tables, paginated reads, serialization.

Table names come from the environment when they're used, not at import, so tests can
set them before or after loading the module.
"""
import os
import time
from decimal import Decimal
import boto3

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
    unique = list(dict.fromkeys(ids))
    resource = get_dynamodb()
    items = []
    for start in range(0, len(unique), BATCH_GET_MAX):
        request = {tbl.name: {'Keys': [{key_name: i} for i in unique[start:start + BATCH_GET_MAX]]}}
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
