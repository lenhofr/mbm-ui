"""Phase 2 routes: the signed-in feed, sharing, and brigades (docs/recipe-circles.md §6.3, §6.5, §7)."""
import json

import pytest

from test_recipes import _as, _setup, brigade, edges, migrated, stored


def call(app, method, path, sub=None, body=None, query=None, groups=None):
    event = {'requestContext': {'http': {'method': method}, **(_as(sub, groups) if sub else {})}, 'rawPath': path}
    if body is not None:
        event['body'] = json.dumps(body)
    if query:
        event['queryStringParameters'] = query
    res = app.handler(event, None)
    res['json'] = json.loads(res['body']) if res.get('body') else None
    return res


def ids(res):
    return [r['recipeId'] for r in res['json']]


def meta(ddb, cid):
    return ddb.Table('mbm-circles').get_item(Key={'pk': f'CIRCLE#{cid}', 'sk': 'META'}).get('Item')


def member(ddb, cid, sub):
    return ddb.Table('mbm-circles').get_item(Key={'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{sub}'}).get('Item')


def share(ddb, table, rid, owner, circles, public=True, updated=1, **extra):
    """A migrated recipe shared into circles, edges included (I1)."""
    migrated(table, rid, owner, circles, public, updatedAt=updated, **extra)
    for cid in circles:
        ddb.Table('mbm-circles').put_item(Item={'pk': f'CIRCLE#{cid}', 'sk': f'RECIPE#{rid}', 'sharedBySub': owner})


# --- feed -------------------------------------------------------------------

def test_feed_is_mine_plus_my_brigades_deduped_newest_first(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'b': 'editor'})
    brigade(ddb, 'work', {'c': 'editor'})
    share(ddb, table, 'mine-private', 'a', [], public=False, updated=5)
    share(ddb, table, 'mine-shared', 'a', ['fam'], updated=4)
    share(ddb, table, 'theirs-fam', 'b', ['fam'], public=False, updated=6)
    share(ddb, table, 'theirs-work', 'c', ['work'], public=False, updated=7)
    share(ddb, table, 'public-stranger', 'c', [], updated=8)

    res = call(app, 'GET', '/me/recipes', 'a')
    assert res['statusCode'] == 200
    assert ids(res) == ['theirs-fam', 'mine-private', 'mine-shared']
    by_id = {r['recipeId']: r for r in res['json']}
    assert by_id['theirs-fam']['access']['relation'] == 'circle-editor'
    assert by_id['mine-private']['isPublic'] is False
    assert by_id['mine-shared']['sharedIn'] == ['fam']

    with_public = call(app, 'GET', '/me/recipes', 'a', query={'includePublic': '1'})
    assert ids(with_public) == ['public-stranger', 'theirs-fam', 'mine-private', 'mine-shared']


def test_feed_scopes(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'member', 'b': 'editor'})
    brigade(ddb, 'work', {'c': 'editor'})
    share(ddb, table, 'mine', 'a', [], public=False, updated=1)
    share(ddb, table, 'fam-1', 'b', ['fam'], public=False, updated=2)
    share(ddb, table, 'pub', 'c', ['work'], updated=3)

    assert ids(call(app, 'GET', '/me/recipes', 'a', query={'scope': 'mine'})) == ['mine']
    assert ids(call(app, 'GET', '/me/recipes', 'a', query={'scope': 'circle', 'circleId': 'fam'})) == ['fam-1']
    assert ids(call(app, 'GET', '/me/recipes', 'a', query={'scope': 'public'})) == ['pub']
    # Not a member: the brigade doesn't exist as far as they know.
    assert call(app, 'GET', '/me/recipes', 'a', query={'scope': 'circle', 'circleId': 'work'})['statusCode'] == 404
    assert call(app, 'GET', '/me/recipes', 'a', query={'scope': 'nope'})['statusCode'] == 400


def test_feed_hides_brigades_you_cannot_see_and_skips_dangling_edges(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'b': 'editor'})
    brigade(ddb, 'work', {'b': 'editor'})
    brigade(ddb, 'gone', {'a': 'editor'}, deleting=True)
    share(ddb, table, 'r1', 'b', ['fam', 'work'], public=False)
    share(ddb, table, 'r-gone', 'b', ['gone'], public=False)
    ddb.Table('mbm-circles').put_item(Item={'pk': 'CIRCLE#fam', 'sk': 'RECIPE#deleted-recipe'})

    res = call(app, 'GET', '/me/recipes', 'a')
    assert ids(res) == ['r1']
    assert res['json'][0]['sharedIn'] == ['fam']   # not 'work' (I6)


def test_get_mine_reads_private_recipes_you_can_see(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'b': 'member'})
    share(ddb, table, 'r1', 'a', ['fam'], public=False)

    got = call(app, 'GET', '/me/recipes/r1', 'b')
    assert got['statusCode'] == 200
    assert got['json']['access'] == {'canRead': True, 'canEdit': False, 'canDelete': False,
                                     'canShare': False, 'relation': 'circle-member'}
    assert call(app, 'GET', '/me/recipes/r1', 'stranger')['statusCode'] == 404
    assert call(app, 'GET', '/me/recipes/missing', 'a')['statusCode'] == 404
    # The public route still hides it.
    assert call(app, 'GET', '/recipes/r1')['statusCode'] == 404


# --- sharing ----------------------------------------------------------------

def test_owner_changes_sharing_and_edges_follow(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor'})
    brigade(ddb, 'work', {'a': 'member'})
    share(ddb, table, 'r1', 'a', ['fam'], updated=10)

    res = call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': False, 'circleIds': ['work']})
    assert res['statusCode'] == 200
    assert res['json']['isPublic'] is False
    assert res['json']['sharedIn'] == ['work']
    item = stored(table, 'r1')
    assert item['circleIds'] == {'work'}
    assert 'publicPk' not in item
    assert item['version'] == 2
    assert item['updatedAt'] == 10     # sharing isn't an edit
    assert edges(ddb, 'fam') == [] and edges(ddb, 'work') == ['r1']
    assert call(app, 'GET', '/recipes')['json'] == []

    # Only me, then public again: no circles left means no circleIds attribute.
    res = call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': True, 'circleIds': []})
    assert res['statusCode'] == 200
    assert 'circleIds' not in stored(table, 'r1')
    assert edges(ddb, 'work') == []
    assert ids(call(app, 'GET', '/recipes')) == ['r1']


@pytest.mark.parametrize('who, status', [('editor', 403), ('stranger', 404)])
def test_only_the_owner_changes_sharing(ddb, who, status):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'editor': 'owner'})
    share(ddb, table, 'r1', 'a', ['fam'], public=False)
    res = call(app, 'PUT', '/recipes/r1/sharing', who, {'isPublic': True, 'circleIds': ['fam']})
    assert res['statusCode'] == status
    assert 'publicPk' not in stored(table, 'r1')


def test_sharing_into_a_brigade_you_are_not_in_is_400(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor'})
    brigade(ddb, 'other', {'b': 'editor'})
    share(ddb, table, 'r1', 'a', ['fam'])
    res = call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': True, 'circleIds': ['fam', 'other']})
    assert res['statusCode'] == 400
    assert res['json']['circleIds'] == ['other']
    assert stored(table, 'r1')['circleIds'] == {'fam'}


def test_owner_keeps_a_share_after_leaving_and_can_still_remove_it(ddb):
    # I2 applies only when adding: a brigade you left can stay, and you can take it out.
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'b': 'owner'})
    share(ddb, table, 'r1', 'a', ['fam'])
    assert call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': True, 'circleIds': ['fam']})['statusCode'] == 200
    assert call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': True, 'circleIds': []})['statusCode'] == 200
    assert edges(ddb, 'fam') == []


def test_sharing_with_a_stale_version_is_409(ddb):
    table, app = _setup(ddb)
    share(ddb, table, 'r1', 'a', [])
    table.update_item(Key={'recipeId': 'r1'}, UpdateExpression='SET version = :v', ExpressionAttributeValues={':v': 3})
    res = call(app, 'PUT', '/recipes/r1/sharing', 'a', {'isPublic': False, 'circleIds': [], 'version': 2})
    assert res['statusCode'] == 409
    assert res['json']['recipe']['version'] == 3
    assert stored(table, 'r1')['publicPk'] == 'PUBLIC'


@pytest.mark.parametrize('body', [{'isPublic': True}, {'circleIds': []}, {'isPublic': 'yes', 'circleIds': []},
                                  {'isPublic': True, 'circleIds': 'fam'}])
def test_sharing_body_must_be_the_full_state(ddb, body):
    table, app = _setup(ddb)
    share(ddb, table, 'r1', 'a', [])
    assert call(app, 'PUT', '/recipes/r1/sharing', 'a', body)['statusCode'] == 400


def test_content_edits_leave_sharing_alone(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'b': 'editor'})
    share(ddb, table, 'r1', 'a', ['fam'], public=False)
    res = call(app, 'PUT', '/recipes/r1', 'b', {'title': 'Better soup', 'isPublic': True, 'circleIds': []})
    assert res['statusCode'] == 200
    item = stored(table, 'r1')
    assert item['circleIds'] == {'fam'} and 'publicPk' not in item


# --- unshare from a brigade -------------------------------------------------

@pytest.mark.parametrize('who, status', [('a', 204), ('sous', 204), ('chef', 204), ('commis', 403), ('stranger', 404)])
def test_who_can_take_a_recipe_out_of_a_brigade(ddb, who, status):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'sous': 'editor', 'chef': 'owner', 'commis': 'member'})
    brigade(ddb, 'work', {'a': 'editor'})
    share(ddb, table, 'r1', 'a', ['fam', 'work'], public=False)

    assert call(app, 'DELETE', '/circles/fam/recipes/r1', who)['statusCode'] == status
    left = stored(table, 'r1')['circleIds']
    if status == 204:
        assert left == {'work'} and edges(ddb, 'fam') == []
    else:
        assert left == {'fam', 'work'} and edges(ddb, 'fam') == ['r1']


def test_unsharing_the_last_brigade_removes_the_attribute_and_is_idempotent(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'a': 'editor', 'b': 'editor'})
    share(ddb, table, 'r1', 'a', ['fam'])
    assert call(app, 'DELETE', '/circles/fam/recipes/r1', 'b')['statusCode'] == 204
    assert 'circleIds' not in stored(table, 'r1')
    # Still public, so b can still read it; a second unshare changes nothing.
    assert call(app, 'DELETE', '/circles/fam/recipes/r1', 'b')['statusCode'] == 204


# --- brigades ---------------------------------------------------------------

def test_create_list_and_get_a_brigade(ddb):
    _, app = _setup(ddb)
    res = call(app, 'POST', '/circles', 'a', {'name': '  Lenhof Family ', 'emoji': '🍝'})
    assert res['statusCode'] == 201
    circle = res['json']
    assert circle['name'] == 'Lenhof Family' and circle['emoji'] == '🍝' and circle['role'] == 'owner'
    assert circle['memberCount'] == 1 and circle['ownerCount'] == 1 and circle['recipeCount'] == 0
    assert circle['members'] == [{'sub': 'a', 'displayName': 'a', 'role': 'owner', 'joinedAt': circle['members'][0]['joinedAt']}]
    cid = circle['id']
    assert member(ddb, cid, 'a')['gsi1pk'] == 'USER#a'

    brigade(ddb, 'zz', {'a': 'editor'})
    mine = call(app, 'GET', '/me/circles', 'a')['json']
    assert [(c['name'], c['role']) for c in mine] == [('Lenhof Family', 'owner'), ('zz', 'editor')]
    assert call(app, 'GET', '/me/circles', 'nobody')['json'] == []

    assert call(app, 'GET', f'/circles/{cid}', 'a')['statusCode'] == 200
    assert call(app, 'GET', f'/circles/{cid}', 'stranger')['statusCode'] == 404


@pytest.mark.parametrize('body', [{}, {'name': '   '}, {'name': 'x' * 61}, {'name': 3}])
def test_a_brigade_needs_a_name(ddb, body):
    _, app = _setup(ddb)
    assert call(app, 'POST', '/circles', 'a', body)['statusCode'] == 400


def test_brigades_per_cook_are_capped(ddb, monkeypatch):
    _, app = _setup(ddb)
    import circle_routes
    monkeypatch.setattr(circle_routes, 'MAX_CIRCLES_PER_USER', 2)
    brigade(ddb, 'one', {'a': 'editor'})
    brigade(ddb, 'two', {'a': 'editor'})
    assert call(app, 'POST', '/circles', 'a', {'name': 'Three'})['statusCode'] == 400


def test_chef_renames_and_the_name_reaches_every_membership(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    assert call(app, 'PATCH', '/circles/fam', 'b', {'name': 'Mine now'})['statusCode'] == 403
    assert call(app, 'PATCH', '/circles/fam', 'stranger', {'name': 'x'})['statusCode'] == 404
    assert call(app, 'PATCH', '/circles/fam', 'chef', {})['statusCode'] == 400

    res = call(app, 'PATCH', '/circles/fam', 'chef', {'name': 'The Lenhofs', 'emoji': '🥘'})
    assert res['statusCode'] == 200 and res['json']['name'] == 'The Lenhofs'
    assert member(ddb, 'fam', 'b')['circleName'] == 'The Lenhofs'
    assert meta(ddb, 'fam')['emoji'] == '🥘'
    # An emoji of null removes it and leaves the name alone.
    res = call(app, 'PATCH', '/circles/fam', 'chef', {'emoji': None})
    assert 'emoji' not in meta(ddb, 'fam') and res['json']['name'] == 'The Lenhofs'


def test_roles_and_the_last_chef(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    assert call(app, 'PUT', '/circles/fam/members/chef', 'b', {'role': 'editor'})['statusCode'] == 403
    assert call(app, 'PUT', '/circles/fam/members/b', 'chef', {'role': 'boss'})['statusCode'] == 400
    assert call(app, 'PUT', '/circles/fam/members/nobody', 'chef', {'role': 'editor'})['statusCode'] == 404

    # The only Chef can't step down (I3).
    res = call(app, 'PUT', '/circles/fam/members/chef', 'chef', {'role': 'editor'})
    assert res['statusCode'] == 400 and 'needs a Chef' in res['json']['message']
    assert member(ddb, 'fam', 'chef')['role'] == 'owner'

    assert call(app, 'PUT', '/circles/fam/members/b', 'chef', {'role': 'owner'})['json']['role'] == 'owner'
    assert meta(ddb, 'fam')['ownerCount'] == 2
    # With another Chef, stepping down works and the count follows.
    assert call(app, 'PUT', '/circles/fam/members/chef', 'chef', {'role': 'editor'})['statusCode'] == 200
    assert meta(ddb, 'fam')['ownerCount'] == 1
    assert member(ddb, 'fam', 'chef')['role'] == 'editor'


def test_leaving_keeps_your_recipes_in_the_brigade(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'gran': 'editor'})
    share(ddb, table, 'grans-pie', 'gran', ['fam'], public=False)
    share(ddb, table, 'chefs-soup', 'chef', ['fam'], public=False)

    assert call(app, 'DELETE', '/circles/fam/members/gran', 'gran')['statusCode'] == 204
    assert member(ddb, 'fam', 'gran') is None
    assert meta(ddb, 'fam')['memberCount'] == 1
    # No cascade (§14.6): the brigade keeps the pie, and gran keeps editing it.
    assert edges(ddb, 'fam') == ['chefs-soup', 'grans-pie']
    assert set(ids(call(app, 'GET', '/me/recipes', 'chef'))) == {'grans-pie', 'chefs-soup'}
    assert ids(call(app, 'GET', '/me/recipes', 'gran')) == ['grans-pie']
    assert call(app, 'PUT', '/recipes/grans-pie', 'gran', {'title': 'Pie'})['statusCode'] == 200
    assert call(app, 'GET', '/me/recipes/chefs-soup', 'gran')['statusCode'] == 404
    # Leaving twice is fine; she just isn't a member any more.
    assert call(app, 'DELETE', '/circles/fam/members/gran', 'gran')['statusCode'] == 404


def test_the_last_chef_cannot_leave(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    res = call(app, 'DELETE', '/circles/fam/members/chef', 'chef')
    assert res['statusCode'] == 400 and 'needs a Chef' in res['json']['message']
    assert member(ddb, 'fam', 'chef') is not None and meta(ddb, 'fam')['memberCount'] == 2


def test_only_the_chef_removes_other_people(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor', 'c': 'editor'})
    assert call(app, 'DELETE', '/circles/fam/members/c', 'b')['statusCode'] == 403
    assert call(app, 'DELETE', '/circles/fam/members/c', 'stranger')['statusCode'] == 404
    assert call(app, 'DELETE', '/circles/fam/members/c', 'chef')['statusCode'] == 204
    assert member(ddb, 'fam', 'c') is None
    assert meta(ddb, 'fam')['memberCount'] == 2
    assert call(app, 'DELETE', '/circles/fam/members/c', 'chef')['statusCode'] == 204


def test_removed_cook_loses_access_at_once(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    share(ddb, table, 'r1', 'chef', ['fam'], public=False)
    assert call(app, 'PUT', '/recipes/r1', 'b', {'title': 'Mine'})['statusCode'] == 200
    call(app, 'DELETE', '/circles/fam/members/b', 'chef')
    assert call(app, 'PUT', '/recipes/r1', 'b', {'title': 'Mine'})['statusCode'] == 404


def test_delete_brigade_unshares_everything_and_keeps_the_recipes(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    brigade(ddb, 'work', {'b': 'editor'})
    share(ddb, table, 'r1', 'b', ['fam', 'work'], public=False)
    share(ddb, table, 'r2', 'chef', ['fam'], public=False)
    ddb.Table('mbm-circles').put_item(Item={'pk': 'CIRCLE#fam', 'sk': 'RECIPE#already-deleted'})

    assert call(app, 'DELETE', '/circles/fam', 'b')['statusCode'] == 403
    assert call(app, 'DELETE', '/circles/fam', 'stranger')['statusCode'] == 404
    assert call(app, 'DELETE', '/circles/fam', 'chef')['statusCode'] == 204

    rows = ddb.Table('mbm-circles').query(KeyConditionExpression='pk = :p',
                                          ExpressionAttributeValues={':p': 'CIRCLE#fam'})['Items']
    assert rows == []
    assert stored(table, 'r1')['circleIds'] == {'work'}
    assert 'circleIds' not in stored(table, 'r2')
    assert stored(table, 'already-deleted') is None    # no ghost recipe from the update
    assert call(app, 'GET', '/me/circles', 'b')['json'][0]['id'] == 'work'


def test_an_interrupted_delete_can_be_retried(ddb, monkeypatch):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    share(ddb, table, 'r1', 'chef', ['fam'])
    share(ddb, table, 'r2', 'chef', ['fam'])
    import circle_routes
    real = circle_routes._drop_share
    calls = []

    def flaky(*args):
        calls.append(args)
        if len(calls) == 2:
            raise RuntimeError('Lambda timed out')
        return real(*args)
    monkeypatch.setattr(circle_routes, '_drop_share', flaky)
    with pytest.raises(RuntimeError):
        call(app, 'DELETE', '/circles/fam', 'chef')

    # Half done: the brigade is marked deleting, so it already grants nothing.
    assert meta(ddb, 'fam')['deleting'] is True
    assert call(app, 'GET', '/me/circles', 'b')['json'] == []
    assert call(app, 'GET', '/circles/fam', 'chef')['statusCode'] == 404

    monkeypatch.setattr(circle_routes, '_drop_share', real)
    assert call(app, 'DELETE', '/circles/fam', 'chef')['statusCode'] == 204
    assert meta(ddb, 'fam') is None
    assert 'circleIds' not in stored(table, 'r1') and 'circleIds' not in stored(table, 'r2')


def test_delete_keeps_the_chef_and_meta_until_the_end(ddb, monkeypatch):
    # The Chef's own membership and META go last, so a delete that fails late can still be retried.
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    import repo
    real_table = repo.circles_table

    class FailOnChef:
        def __init__(self, t):
            self._t = t

        def __getattr__(self, name):
            return getattr(self._t, name)

        def delete_item(self, Key, **kw):
            if Key['sk'] == 'MEMBER#chef':
                raise RuntimeError('Lambda timed out')
            return self._t.delete_item(Key=Key, **kw)
    monkeypatch.setattr(repo, 'circles_table', lambda: FailOnChef(real_table()))
    with pytest.raises(RuntimeError):
        call(app, 'DELETE', '/circles/fam', 'chef')
    assert member(ddb, 'fam', 'b') is None
    assert meta(ddb, 'fam')['deleting'] is True

    monkeypatch.setattr(repo, 'circles_table', real_table)
    assert call(app, 'DELETE', '/circles/fam', 'chef')['statusCode'] == 204
    assert meta(ddb, 'fam') is None and member(ddb, 'fam', 'chef') is None
