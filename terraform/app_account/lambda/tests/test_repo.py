import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'recipes'))
import repo  # noqa: E402


def test_tables_come_from_the_environment_when_used(ddb, monkeypatch):
    assert repo.recipes_table().name == 'mbm-recipes'
    assert repo.circles_table().name == 'mbm-circles'
    monkeypatch.delenv('CIRCLES_TABLE')
    try:
        repo.circles_table()
        assert False, 'expected ValueError'
    except ValueError as e:
        assert 'CIRCLES_TABLE' in str(e)


def test_query_all_follows_pages_on_the_owner_index(ddb):
    tbl = repo.recipes_table()
    with tbl.batch_writer() as w:
        for i in range(25):
            w.put_item(Item={'recipeId': f'r{i}', 'ownerSub': 'cook-a', 'updatedAt': i})
        w.put_item(Item={'recipeId': 'other', 'ownerSub': 'cook-b', 'updatedAt': 1})
        w.put_item(Item={'recipeId': 'unowned', 'updatedAt': 1})
    items = repo.query_all(tbl, IndexName='gsi_owner', Limit=4, ScanIndexForward=False,
                           KeyConditionExpression='ownerSub = :s', ExpressionAttributeValues={':s': 'cook-a'})
    assert [i['recipeId'] for i in items] == [f'r{i}' for i in range(24, -1, -1)]


def test_public_index_is_sparse(ddb):
    tbl = repo.recipes_table()
    tbl.put_item(Item={'recipeId': 'pub', 'publicPk': 'PUBLIC', 'updatedAt': 2})
    tbl.put_item(Item={'recipeId': 'priv', 'updatedAt': 3})
    items = repo.query_all(tbl, IndexName='gsi_public', KeyConditionExpression='publicPk = :p',
                           ExpressionAttributeValues={':p': 'PUBLIC'})
    assert [i['recipeId'] for i in items] == ['pub']


def test_circles_inverted_index_lists_a_users_circles(ddb):
    tbl = repo.circles_table()
    tbl.put_item(Item={'pk': 'CIRCLE#c1', 'sk': 'META', 'name': 'Kitchen'})
    for cid in ('c1', 'c2'):
        tbl.put_item(Item={'pk': f'CIRCLE#{cid}', 'sk': 'MEMBER#u1', 'gsi1pk': 'USER#u1',
                           'gsi1sk': f'CIRCLE#{cid}', 'role': 'editor'})
    tbl.put_item(Item={'pk': 'CIRCLE#c1', 'sk': 'RECIPE#r1', 'sharedBySub': 'u1'})
    mine = repo.query_all(tbl, IndexName='gsi1', KeyConditionExpression='gsi1pk = :u AND begins_with(gsi1sk, :c)',
                          ExpressionAttributeValues={':u': 'USER#u1', ':c': 'CIRCLE#'})
    assert sorted(i['pk'] for i in mine) == ['CIRCLE#c1', 'CIRCLE#c2']
    whole = repo.query_all(tbl, KeyConditionExpression='pk = :p', ExpressionAttributeValues={':p': 'CIRCLE#c1'})
    assert sorted(i['sk'] for i in whole) == ['MEMBER#u1', 'META', 'RECIPE#r1']


def test_batch_get_chunks_dedupes_and_skips_missing(ddb, monkeypatch):
    tbl = repo.recipes_table()
    with tbl.batch_writer() as w:
        for i in range(230):
            w.put_item(Item={'recipeId': f'r{i}'})
    calls = []
    real = repo.get_dynamodb

    class Spy:
        def __init__(self):
            self._r = real()

        def batch_get_item(self, **kw):
            calls.append(len(kw['RequestItems']['mbm-recipes']['Keys']))
            return self._r.batch_get_item(**kw)

    monkeypatch.setattr(repo, 'get_dynamodb', Spy)
    ids = [f'r{i}' for i in range(230)] + ['r0', 'missing']
    items = repo.batch_get(tbl, 'recipeId', ids)
    assert sorted(i['recipeId'] for i in items) == sorted(f'r{i}' for i in range(230))
    assert calls == [100, 100, 31]


def test_batch_get_retries_unprocessed_keys(ddb, monkeypatch):
    tbl = repo.recipes_table()
    tbl.put_item(Item={'recipeId': 'a'})
    tbl.put_item(Item={'recipeId': 'b'})
    real = repo.get_dynamodb()
    first = {'done': False}

    class Flaky:
        def batch_get_item(self, RequestItems):
            if not first['done']:
                first['done'] = True
                keys = RequestItems['mbm-recipes']['Keys']
                got = real.batch_get_item(RequestItems={'mbm-recipes': {'Keys': keys[:1]}})
                got['UnprocessedKeys'] = {'mbm-recipes': {'Keys': keys[1:]}}
                return got
            return real.batch_get_item(RequestItems=RequestItems)

    monkeypatch.setattr(repo, 'get_dynamodb', Flaky)
    monkeypatch.setattr(repo.time, 'sleep', lambda s: None)
    assert sorted(i['recipeId'] for i in repo.batch_get(tbl, 'recipeId', ['a', 'b'])) == ['a', 'b']


def test_to_jsonable():
    assert repo.to_jsonable({'n': Decimal('3'), 'f': Decimal('1.5'), 'l': [Decimal('2')], 's': {'b', 'a'}}) == \
        {'n': 3, 'f': 1.5, 'l': [2], 's': ['a', 'b']}
