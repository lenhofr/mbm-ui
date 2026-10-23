import os
import json
import importlib.util
import pytest


def load_module(path):
    spec = importlib.util.spec_from_file_location('app_module', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_app():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    return load_module(os.path.join(repo_root, 'recipes', 'app.py'))


def _setup(ddb):
    return ddb.Table('mbm-recipes'), load_app()


def _as(sub, groups=None):
    """requestContext claims as API Gateway's JWT authorizer passes them."""
    claims = {'sub': sub}
    if groups is not None:
        claims['cognito:groups'] = groups
    return {'authorizer': {'jwt': {'claims': claims}}}


def _call(app, method, path, ctx=None, body=None, rid=None):
    event = {'requestContext': {'http': {'method': method}, **(ctx or {})}, 'rawPath': path}
    if body is not None:
        event['body'] = body if isinstance(body, str) else json.dumps(body)
    if rid is not None:
        event['pathParameters'] = {'id': rid}
    res = app.handler(event, None)
    res['json'] = json.loads(res['body']) if res.get('body') else None
    return res


def _post(app, body, ctx=None):
    return _call(app, 'POST', '/recipes', ctx, body)


def _put(app, rid, body, ctx=None):
    return _call(app, 'PUT', f'/recipes/{rid}', ctx, body, rid)


def _delete(app, rid, ctx=None):
    return _call(app, 'DELETE', f'/recipes/{rid}', ctx, rid=rid)


def _get(app, rid):
    return _call(app, 'GET', f'/recipes/{rid}')


def _list(app):
    return _call(app, 'GET', '/recipes')


def brigade(ddb, cid, members, deleting=False):
    """Seed a circle: META plus a MEMBER row per {sub: role}."""
    circles = ddb.Table('mbm-circles')
    meta = {'pk': f'CIRCLE#{cid}', 'sk': 'META', 'name': cid, 'memberCount': len(members),
            'ownerCount': sum(r == 'owner' for r in members.values())}
    if deleting:
        meta['deleting'] = True
    circles.put_item(Item=meta)
    for sub, role in members.items():
        circles.put_item(Item={'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{sub}', 'gsi1pk': f'USER#{sub}',
                               'gsi1sk': f'CIRCLE#{cid}', 'role': role, 'circleName': cid})


def edges(ddb, cid):
    rows = ddb.Table('mbm-circles').query(
        KeyConditionExpression='pk = :p AND begins_with(sk, :r)',
        ExpressionAttributeValues={':p': f'CIRCLE#{cid}', ':r': 'RECIPE#'})['Items']
    return sorted(r['sk'][len('RECIPE#'):] for r in rows)


def stored(table, rid):
    return table.get_item(Key={'recipeId': rid}).get('Item')


def migrated(table, rid, owner, circles=(), public=True, **extra):
    """A recipe as it looks after scripts/migrate-circles.mjs."""
    item = {'recipeId': rid, 'title': 'Soup', 'ownerSub': owner, 'createdBySub': owner,
            'updatedAt': 1, 'version': 1, 'schemaV': 2, **extra}
    if public:
        item['publicPk'] = 'PUBLIC'
    if circles:
        item['circleIds'] = set(circles)
    table.put_item(Item=item)
    return item


# --- create ---------------------------------------------------------------

def test_create_and_get_recipe(ddb):
    table, app = _setup(ddb)
    res = _post(app, {'title': 'Test Recipe'}, _as('cook-a'))
    assert res['statusCode'] == 201
    created = res['json']
    assert created['title'] == 'Test Recipe'
    assert created['isPublic'] is True
    assert created['sharedIn'] == []
    assert created['access']['relation'] == 'owner'
    for k in ('publicPk', 'circleIds', 'schemaV'):
        assert k not in created

    item = stored(table, created['recipeId'])
    assert item['ownerSub'] == 'cook-a'
    assert item['publicPk'] == 'PUBLIC'
    assert item['version'] == 1
    assert item['schemaV'] == 2

    got = _get(app, created['recipeId'])
    assert got['statusCode'] == 200
    assert got['json']['recipeId'] == created['recipeId']
    assert got['json']['isPublic'] is True
    assert 'access' not in got['json']


def test_create_needs_a_signed_in_cook(ddb):
    table, app = _setup(ddb)
    assert _post(app, {'title': 'Soup'})['statusCode'] == 401
    assert table.scan()['Count'] == 0


def test_create_private_and_shared_into_a_brigade(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'editor'})
    res = _post(app, {'title': 'Secret sauce', 'sharing': {'isPublic': False, 'circleIds': ['fam', 'fam']}}, _as('cook-a'))
    assert res['statusCode'] == 201
    rid = res['json']['recipeId']
    assert res['json']['isPublic'] is False
    assert res['json']['sharedIn'] == ['fam']
    item = stored(table, rid)
    assert 'publicPk' not in item
    assert item['circleIds'] == {'fam'}
    assert edges(ddb, 'fam') == [rid]
    # Not on the public site.
    assert _get(app, rid)['statusCode'] == 404
    assert _list(app)['json'] == []


@pytest.mark.parametrize('circles', [{}, {'other': 'owner'}])
def test_create_cannot_share_into_a_brigade_you_are_not_in(ddb, circles):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-b': 'owner'})
    for cid, role in circles.items():
        brigade(ddb, cid, {'cook-a': role})
    res = _post(app, {'title': 'Soup', 'sharing': {'isPublic': True, 'circleIds': ['fam']}}, _as('cook-a'))
    assert res['statusCode'] == 400
    assert res['json']['circleIds'] == ['fam']
    assert table.scan()['Count'] == 0
    assert edges(ddb, 'fam') == []


def test_create_cannot_share_into_a_brigade_being_deleted(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'gone', {'cook-a': 'owner'}, deleting=True)
    res = _post(app, {'title': 'Soup', 'sharing': {'circleIds': ['gone']}}, _as('cook-a'))
    assert res['statusCode'] == 400
    assert table.scan()['Count'] == 0


@pytest.mark.parametrize('sharing, message', [
    ('public', 'sharing must be an object'),
    ({'isPublic': 'yes'}, 'isPublic'),
    ({'circleIds': 'fam'}, 'circleIds'),
    ({'circleIds': [1]}, 'circleIds'),
    ({'circleIds': [f'c{i}' for i in range(21)]}, 'too many'),
])
def test_create_rejects_bad_sharing(ddb, sharing, message):
    table, app = _setup(ddb)
    res = _post(app, {'title': 'Soup', 'sharing': sharing}, _as('cook-a'))
    assert res['statusCode'] == 400
    assert message in res['json']['message']


def test_old_clients_share_into_the_founding_brigade(ddb, monkeypatch):
    table, app = _setup(ddb)
    monkeypatch.setenv('FOUNDING_CIRCLE_ID', 'kitchen')
    monkeypatch.setenv('LEGACY_DEFAULT_SHARE', 'founding')
    brigade(ddb, 'kitchen', {'cook-a': 'editor'})

    # A member (everyone after the migration): public and in the founding brigade.
    rid = _post(app, {'title': 'Soup'}, _as('cook-a'))['json']['recipeId']
    assert stored(table, rid)['circleIds'] == {'kitchen'}
    assert stored(table, rid)['publicPk'] == 'PUBLIC'
    assert edges(ddb, 'kitchen') == [rid]

    # Not a member: still public, but no brigade (I2).
    other = _post(app, {'title': 'Pie'}, _as('stranger'))['json']['recipeId']
    assert 'circleIds' not in stored(table, other)
    assert stored(table, other)['publicPk'] == 'PUBLIC'

    # New clients send sharing, which wins over the legacy default.
    mine = _post(app, {'title': 'Tea', 'sharing': {'isPublic': False}}, _as('cook-a'))['json']['recipeId']
    assert 'circleIds' not in stored(table, mine)
    assert 'publicPk' not in stored(table, mine)


def test_without_the_legacy_flag_creates_are_public_with_no_brigade(ddb, monkeypatch):
    table, app = _setup(ddb)
    monkeypatch.setenv('FOUNDING_CIRCLE_ID', 'kitchen')
    brigade(ddb, 'kitchen', {'cook-a': 'editor'})
    rid = _post(app, {'title': 'Soup'}, _as('cook-a'))['json']['recipeId']
    assert 'circleIds' not in stored(table, rid)
    assert stored(table, rid)['publicPk'] == 'PUBLIC'


def test_create_ignores_server_owned_and_unknown_fields(ddb):
    table, app = _setup(ddb)
    res = _post(app, {
        'title': '  Soup  ',
        'recipeId': 'chosen-by-client',
        'createdBySub': 'someone-else',
        'createdByName': 'Impostor',
        'updatedAt': 1,
        'ownerSub': 'x', 'publicPk': 'PUBLIC', 'circleIds': ['c'], 'version': 9, 'schemaV': 1,
        'isAdmin': True, 'junk': 'y',
        'servings': 4,
        'ingredients': [{'name': 'salt', 'amount': '1 tsp', 'evil': 'z'}, {'name': '  '}],
        'tags': ['soup', 'soup', 'easy'],
    }, _as('cook-a'))
    assert res['statusCode'] == 201
    item = stored(table, res['json']['recipeId'])
    assert res['json']['recipeId'] != 'chosen-by-client'
    assert item['title'] == 'Soup'
    assert item['createdBySub'] == 'cook-a'
    assert item['createdByName'] == 'cook-a'
    assert item['ownerSub'] == 'cook-a'
    assert item['updatedAt'] != 1
    assert item['version'] == 1
    assert item['schemaV'] == 2
    assert 'circleIds' not in item
    for k in ('isAdmin', 'junk'):
        assert k not in item
    assert item['servings'] == '4'
    assert item['ingredients'] == [{'name': 'salt', 'amount': '1 tsp'}]
    assert item['tags'] == ['soup', 'easy']


@pytest.mark.parametrize('body, message', [
    ('not json', 'JSON'),
    ('[1, 2]', 'object'),
    ({'description': 'no title'}, 'title'),
    ({'title': '   '}, 'title'),
    ({'title': 'x' * 201}, 'title'),
    ({'title': 'Soup', 'tags': 'soup'}, 'tags'),
    ({'title': 'Soup', 'ingredients': ['salt']}, 'ingredient'),
    ({'title': 'Soup', 'instructions': [{'text': 'stir'}]}, 'instructions'),
    ({'title': 'Soup', 'image': 'javascript:alert(1)'}, 'image'),
    ({'title': 'Soup', 'image': 'data:image/png;base64,AAAA'}, 'image'),
    ({'title': 'Soup', 'servings': True}, 'servings'),
    ({'title': 'Soup', 'description': 'x' * (300 * 1024)}, 'too big'),
])
def test_invalid_bodies_are_rejected(ddb, body, message):
    table, app = _setup(ddb)
    res = _post(app, body, _as('cook-a'))
    assert res['statusCode'] == 400
    assert message in res['json']['message']
    assert table.scan()['Count'] == 0


def test_images_keep_working(ddb):
    table, app = _setup(ddb)
    for image in ('uploads/abc123.jpeg', 'https://example.com/pie.jpg'):
        res = _post(app, {'title': 'Pie', 'image': image}, _as('cook-a'))
        assert res['statusCode'] == 201
        assert res['json']['image'] == image


# --- public reads -----------------------------------------------------------

def test_list_is_public_recipes_only_newest_first(ddb):
    table, app = _setup(ddb)
    migrated(table, 'old', 'cook-a', updatedAt=1)
    migrated(table, 'new', 'cook-a', updatedAt=5)
    migrated(table, 'private', 'cook-a', ['fam'], public=False, updatedAt=9)
    table.put_item(Item={'recipeId': 'unmigrated', 'title': 'Not yet'})
    res = _list(app)
    assert res['statusCode'] == 200
    assert [r['recipeId'] for r in res['json']] == ['new', 'old']
    assert all(r['isPublic'] and 'circleIds' not in r and 'sharedIn' not in r for r in res['json'])


def test_list_follows_pagination(ddb, monkeypatch):
    table, app = _setup(ddb)
    with table.batch_writer() as w:
        for i in range(30):
            w.put_item(Item={'recipeId': f'r{i}', 'title': f'Recipe {i}', 'publicPk': 'PUBLIC', 'updatedAt': i})

    real_query = table.query
    calls = []

    def small_pages(**kwargs):
        calls.append(kwargs)
        return real_query(Limit=7, **kwargs)

    class Wrapped:
        def __getattr__(self, name):
            return small_pages if name == 'query' else getattr(table, name)

    monkeypatch.setattr(app.repo, 'recipes_table', lambda: Wrapped())
    res = _list(app)
    assert res['statusCode'] == 200
    assert len(res['json']) == 30
    assert len(calls) >= 5


def test_private_recipes_are_hidden_from_the_public_get_even_with_a_token(ddb):
    table, app = _setup(ddb)
    migrated(table, 'secret', 'cook-a', ['fam'], public=False)
    res = app.handler({'requestContext': {'http': {'method': 'GET'}, **_as('cook-a')},
                       'rawPath': '/recipes/secret', 'headers': {'authorization': 'Bearer x.y.z'}}, None)
    assert res['statusCode'] == 404
    assert json.loads(res['body']) == json.loads(_get(app, 'missing')['body'])


# --- edit -------------------------------------------------------------------

def test_update_clears_fields_left_out_of_the_body(ddb):
    table, app = _setup(ddb)
    created = _post(app, {'title': 'Soup', 'description': 'Hearty', 'cookTime': '1 hr',
                          'image': 'uploads/a.jpeg', 'servings': '4'}, _as('cook-a'))['json']
    rid = created['recipeId']

    # The editor cleared the description and photo, so they're absent from the full-recipe PUT.
    res = _put(app, rid, {'title': 'Soup', 'cookTime': '1 hr', 'servings': '6'}, _as('cook-a'))
    assert res['statusCode'] == 200
    updated = res['json']
    assert updated['servings'] == '6'
    assert updated['cookTime'] == '1 hr'
    assert 'description' not in updated
    assert 'image' not in updated
    # Creation metadata survives the update.
    assert updated['createdAt'] == created['createdAt']


def test_brigade_editors_edit_each_others_recipes(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'editor', 'cook-b': 'editor'})
    migrated(table, 'r1', 'cook-a', ['fam'], createdByName='A')
    table.update_item(Key={'recipeId': 'r1'}, UpdateExpression='SET sourceNote = :n',
                      ExpressionAttributeValues={':n': 'from a card'})

    res = _put(app, 'r1', {'title': 'Better soup', 'createdBySub': 'cook-b', 'createdAt': 1, 'ownerSub': 'cook-b',
                           'circleIds': [], 'publicPk': None, 'junk': 'y'}, _as('cook-b'))
    assert res['statusCode'] == 200
    assert res['json']['access']['relation'] == 'circle-editor'
    assert res['json']['sharedIn'] == ['fam']
    item = stored(table, 'r1')
    assert item['title'] == 'Better soup'
    assert item['createdBySub'] == 'cook-a'
    assert item['ownerSub'] == 'cook-a'
    assert item['circleIds'] == {'fam'}
    assert item['publicPk'] == 'PUBLIC'
    assert item['createdAt'] != 1
    assert item['updatedBySub'] == 'cook-b'
    assert item['sourceNote'] == 'from a card'
    assert item['version'] == 2
    assert 'junk' not in item


@pytest.mark.parametrize('who, members, public, status', [
    ('cook-b', {'cook-b': 'member'}, True, 403),    # Commis: read-only
    ('cook-b', {}, True, 403),                      # stranger, public recipe
    ('cook-b', {}, False, 404),                     # stranger, private recipe
    ('admin', {}, False, 403),                      # super admins can read it, but don't edit
])
def test_who_cannot_edit(ddb, who, members, public, status):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'owner', **members})
    migrated(table, 'r1', 'cook-a', ['fam'], public=public)
    groups = ['admins'] if who == 'admin' else None
    res = _put(app, 'r1', {'title': 'Mine now'}, _as(who, groups))
    assert res['statusCode'] == status
    assert stored(table, 'r1')['title'] == 'Soup'


def test_update_of_a_missing_recipe_is_404_not_a_create(ddb):
    table, app = _setup(ddb)
    assert _put(app, 'made-up-id', {'title': 'Soup'}, _as('cook-a'))['statusCode'] == 404
    assert stored(table, 'made-up-id') is None


def test_stale_version_is_a_conflict(ddb):
    table, app = _setup(ddb)
    migrated(table, 'r1', 'cook-a', version=3)
    res = _put(app, 'r1', {'title': 'Old edit', 'version': 2}, _as('cook-a'))
    assert res['statusCode'] == 409
    assert res['json']['recipe']['version'] == 3
    assert res['json']['recipe']['title'] == 'Soup'
    res = _put(app, 'r1', {'title': 'Fresh edit', 'version': 3}, _as('cook-a'))
    assert res['statusCode'] == 200
    assert res['json']['version'] == 4
    # Old clients send no version: last writer wins, as before.
    assert _put(app, 'r1', {'title': 'Legacy edit'}, _as('cook-a'))['json']['version'] == 5


def test_bad_version_is_rejected(ddb):
    table, app = _setup(ddb)
    migrated(table, 'r1', 'cook-a')
    for v in ('2', 0, True, 1.5):
        assert _put(app, 'r1', {'title': 'x', 'version': v}, _as('cook-a'))['statusCode'] == 400


def test_unshared_between_read_and_write_is_403(ddb, monkeypatch):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'owner', 'cook-b': 'editor'})
    seen = migrated(table, 'r1', 'cook-a', ['fam'])
    # The owner takes it out of the brigade after cook-b's handler has read it.
    table.update_item(Key={'recipeId': 'r1'}, UpdateExpression='REMOVE circleIds')
    reads = []

    class StaleFirstRead:
        def get_item(self, **kw):
            reads.append(kw)
            return {'Item': seen} if len(reads) == 1 else table.get_item(**kw)

        def __getattr__(self, name):
            return getattr(table, name)

    monkeypatch.setattr(app.repo, 'recipes_table', lambda: StaleFirstRead())
    res = _put(app, 'r1', {'title': 'Sneaky'}, _as('cook-b'))
    assert res['statusCode'] == 403
    assert stored(table, 'r1')['title'] == 'Soup'


def test_update_backfills_created_at_on_old_recipes(ddb):
    table, app = _setup(ddb)
    table.put_item(Item={'recipeId': 'old', 'title': 'Old', 'ownerSub': 'cook-a', 'publicPk': 'PUBLIC'})
    res = _put(app, 'old', {'title': 'Old, fixed'}, _as('cook-a'))
    assert res['statusCode'] == 200
    item = stored(table, 'old')
    assert item['createdAt'] == item['updatedAt']
    assert item['version'] == 1


def test_identity_never_comes_from_an_unverified_header(ddb):
    import base64 as b64
    table, app = _setup(ddb)
    migrated(table, 'r1', 'cook-a')
    fake = b64.urlsafe_b64encode(json.dumps({'sub': 'cook-a', 'cognito:groups': ['admins']}).encode()).decode().rstrip('=')
    for method in ('PUT', 'DELETE'):
        res = app.handler({
            'requestContext': {'http': {'method': method}},
            'rawPath': '/recipes/r1',
            'pathParameters': {'id': 'r1'},
            'headers': {'authorization': f'Bearer x.{fake}.y'},
            'body': json.dumps({'title': 'Hacked'}),
        }, None)
        assert res['statusCode'] == 403
    assert stored(table, 'r1')['title'] == 'Soup'


# --- delete -------------------------------------------------------------------

def test_owner_deletes_and_share_edges_go_too(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'editor'})
    rid = _post(app, {'title': 'Soup', 'sharing': {'isPublic': True, 'circleIds': ['fam']}}, _as('cook-a'))['json']['recipeId']
    assert edges(ddb, 'fam') == [rid]
    assert _delete(app, rid, _as('cook-a'))['statusCode'] == 204
    assert stored(table, rid) is None
    assert edges(ddb, 'fam') == []
    # Already gone: still 204.
    assert _delete(app, rid, _as('cook-a'))['statusCode'] == 204


@pytest.mark.parametrize('who, groups, members, circles, public, status', [
    # Super admins delete anything, private or ownerless.
    ('boss', '[admins]', {}, ['fam'], False, 204),
    # A Chef de cuisine deletes what lives only in brigades they run...
    ('chef', None, {'chef': 'owner'}, ['fam'], True, 204),
    ('chef', None, {'chef': 'owner'}, ['fam', 'fam2'], True, 204),
    # ...but not a recipe that's also in someone else's brigade, or one they only edit.
    ('chef', None, {'chef': 'owner'}, ['fam', 'other'], True, 403),
    ('chef', None, {'chef': 'editor'}, ['fam'], True, 403),
    ('cook-b', None, {'cook-b': 'editor'}, ['fam'], True, 403),
    ('cook-b', None, {}, [], True, 403),            # stranger, public
    ('cook-b', None, {}, ['fam'], False, 404),      # stranger, private
])
def test_who_can_delete(ddb, who, groups, members, circles, public, status):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'cook-a': 'editor', **members})
    brigade(ddb, 'fam2', {'cook-a': 'editor', **{s: r for s, r in members.items() if r == 'owner'}})
    brigade(ddb, 'other', {'cook-a': 'owner'})
    migrated(table, 'r1', 'cook-a', circles, public=public)
    for cid in circles:
        ddb.Table('mbm-circles').put_item(Item={'pk': f'CIRCLE#{cid}', 'sk': 'RECIPE#r1'})
    res = _delete(app, 'r1', _as(who, groups))
    assert res['statusCode'] == status
    if status == 204:
        assert stored(table, 'r1') is None
        assert all(edges(ddb, cid) == [] for cid in circles)
    else:
        assert stored(table, 'r1') is not None


def test_chef_delete_fails_if_shared_elsewhere_since_the_read(ddb, monkeypatch):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'cook-a': 'editor'})
    brigade(ddb, 'other', {'cook-a': 'owner'})
    seen = migrated(table, 'r1', 'cook-a', ['fam'])
    table.update_item(Key={'recipeId': 'r1'}, UpdateExpression='ADD circleIds :o', ExpressionAttributeValues={':o': {'other'}})
    monkeypatch.setattr(app.repo, 'recipes_table', lambda: type('T', (), {
        'get_item': lambda self, **kw: {'Item': seen}, 'name': 'mbm-recipes'})())
    assert _delete(app, 'r1', _as('chef'))['statusCode'] == 409
    assert stored(table, 'r1') is not None


def test_unmigrated_recipes_are_admin_only_to_delete(ddb):
    table, app = _setup(ddb)
    table.put_item(Item={'recipeId': 'old', 'title': 'Old', 'createdBySub': 'cook-a'})
    assert _delete(app, 'old', _as('cook-a'))['statusCode'] == 404   # no ownerSub, not public
    assert _delete(app, 'old', _as('cook-a', ['admins']))['statusCode'] == 204


def test_ratings_routes_are_gone(ddb):
    table, app = _setup(ddb)
    for method in ('GET', 'POST'):
        res = app.handler({'requestContext': {'http': {'method': method}}, 'rawPath': '/ratings', 'body': '{}'}, None)
        assert res['statusCode'] == 400
