"""Brigade invite codes, joining, and copying a recipe (docs/recipe-circles.md §6.7, §6.8)."""
import boto3
import pytest

from test_circle_routes import call, member, meta, share
from test_recipes import _setup, brigade, stored


def invites(ddb):
    return ddb.Table('mbm-invites')


def mint(app, cid, sub, **body):
    return call(app, 'POST', f'/circles/{cid}/invites', sub, body)


# --- minting, listing, revoking ---------------------------------------------

def test_sous_chef_mints_a_code_that_cannot_create_an_account(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'sous': 'editor'})
    res = mint(app, 'fam', 'sous')
    assert res['statusCode'] == 201
    code = res['json']['code']
    assert code.startswith('C-') and code == code.upper() and len(code) == 16
    assert res['json']['url'] == f'https://mealsbymaggie.com/join?code={code}'
    assert res['json']['role'] == 'editor' and res['json']['maxUses'] == 10 and res['json']['active'] is True

    stored_invite = invites(ddb).get_item(Key={'code': code, 'sk': 'META'})['Item']
    assert stored_invite['kind'] == 'circle' and stored_invite['circleId'] == 'fam'
    assert 'allowSignup' not in stored_invite
    assert ddb.Table('mbm-circles').get_item(Key={'pk': 'CIRCLE#fam', 'sk': f'INVITE#{code}'}).get('Item')


@pytest.mark.parametrize('who, status', [('commis', 403), ('stranger', 404)])
def test_who_cannot_mint(ddb, who, status):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'commis': 'member'})
    assert mint(app, 'fam', who)['statusCode'] == status


@pytest.mark.parametrize('body', [{'role': 'owner'}, {'maxUses': 0}, {'maxUses': 101}, {'ttlDays': 91},
                                  {'maxUses': True}, {'ttlDays': '7'}])
def test_bad_invite_options(ddb, body):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner'})
    assert mint(app, 'fam', 'chef', **body)['statusCode'] == 400


def test_open_codes_are_capped_and_listed_newest_first(ddb, monkeypatch):
    _, app = _setup(ddb)
    import invite_routes
    monkeypatch.setattr(invite_routes, 'MAX_ACTIVE_INVITES', 2)
    brigade(ddb, 'fam', {'chef': 'owner', 'sous': 'editor'})
    first = mint(app, 'fam', 'chef')['json']['code']
    invites(ddb).update_item(Key={'code': first, 'sk': 'META'}, UpdateExpression='SET issuedAt = :t',
                             ExpressionAttributeValues={':t': 1})
    second = mint(app, 'fam', 'chef', role='member', maxUses=1)['json']['code']
    assert mint(app, 'fam', 'chef')['statusCode'] == 400

    listed = call(app, 'GET', '/circles/fam/invites', 'sous')['json']
    assert [i['code'] for i in listed] == [second, first]
    assert listed[0]['role'] == 'member'

    # Revoking one makes room, and it drops off the list.
    assert call(app, 'DELETE', f'/circles/fam/invites/{first}', 'sous')['statusCode'] == 204
    assert [i['code'] for i in call(app, 'GET', '/circles/fam/invites', 'chef')['json']] == [second]
    assert mint(app, 'fam', 'chef')['statusCode'] == 201


def test_revoke_only_touches_this_brigades_codes(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner'})
    brigade(ddb, 'other', {'boss': 'owner'})
    code = mint(app, 'other', 'boss')['json']['code']
    assert call(app, 'DELETE', f'/circles/fam/invites/{code}', 'chef')['statusCode'] == 204
    assert 'revoked' not in invites(ddb).get_item(Key={'code': code, 'sk': 'META'})['Item']


# --- joining ----------------------------------------------------------------

def test_join_with_a_code(ddb):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner'})
    share(ddb, table, 'r1', 'chef', ['fam'], public=False)
    code = mint(app, 'fam', 'chef', maxUses=2)['json']['code']

    res = call(app, 'POST', '/circles/join', 'new', {'code': f'  {code.lower()} '})
    assert res['statusCode'] == 200
    assert res['json'] == {'id': 'fam', 'name': 'fam', 'role': 'editor', 'memberCount': 2}
    row = member(ddb, 'fam', 'new')
    assert row['role'] == 'editor' and row['invitedBy'] == 'chef' and row['inviteCode'] == code
    assert row['gsi1pk'] == 'USER#new' and row['circleName'] == 'fam'
    assert meta(ddb, 'fam')['memberCount'] == 2
    assert invites(ddb).get_item(Key={'code': code, 'sk': 'META'})['Item']['uses'] == 1
    # Straight into the brigade's recipes.
    assert call(app, 'GET', '/me/recipes/r1', 'new')['statusCode'] == 200

    # Joining again is a no-op that doesn't use up the code.
    assert call(app, 'POST', '/circles/join', 'new', {'code': code})['statusCode'] == 200
    assert invites(ddb).get_item(Key={'code': code, 'sk': 'META'})['Item']['uses'] == 1


def test_codes_run_out_expire_and_can_be_revoked(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner'})
    once = mint(app, 'fam', 'chef', maxUses=1)['json']['code']
    assert call(app, 'POST', '/circles/join', 'a', {'code': once})['statusCode'] == 200
    assert call(app, 'POST', '/circles/join', 'b', {'code': once})['statusCode'] == 400

    expired = mint(app, 'fam', 'chef')['json']['code']
    invites(ddb).update_item(Key={'code': expired, 'sk': 'META'}, UpdateExpression='SET expiresAt = :t',
                             ExpressionAttributeValues={':t': 1})
    assert call(app, 'POST', '/circles/join', 'b', {'code': expired})['statusCode'] == 400

    revoked = mint(app, 'fam', 'chef')['json']['code']
    call(app, 'DELETE', f'/circles/fam/invites/{revoked}', 'chef')
    assert call(app, 'POST', '/circles/join', 'b', {'code': revoked})['statusCode'] == 400

    assert call(app, 'POST', '/circles/join', 'b', {'code': 'C-NOPE'})['statusCode'] == 400
    assert call(app, 'POST', '/circles/join', 'b', {'code': ''})['statusCode'] == 400
    assert member(ddb, 'fam', 'b') is None


def test_a_signup_code_pointing_at_a_brigade_also_adds_existing_users(ddb):
    # The migration pointed the open sign-up codes at the founding brigade.
    _, app = _setup(ddb)
    brigade(ddb, 'kitchen', {'maggie': 'owner'})
    invites(ddb).put_item(Item={'code': 'Family2024', 'sk': 'META', 'unlimited': True, 'kind': 'signup',
                                'allowSignup': True, 'circleId': 'kitchen', 'circleRole': 'editor'})
    assert call(app, 'POST', '/circles/join', 'nana', {'code': 'Family2024'})['statusCode'] == 200
    assert member(ddb, 'kitchen', 'nana')['role'] == 'editor'


def test_cannot_join_a_full_or_deleted_brigade(ddb, monkeypatch):
    _, app = _setup(ddb)
    import invite_routes
    monkeypatch.setattr(invite_routes, 'MAX_MEMBERS', 1)
    brigade(ddb, 'fam', {'chef': 'owner'})
    code = mint(app, 'fam', 'chef')['json']['code']
    res = call(app, 'POST', '/circles/join', 'b', {'code': code})
    assert res['statusCode'] == 400 and 'full' in res['json']['message']
    assert invites(ddb).get_item(Key={'code': code, 'sk': 'META'})['Item']['uses'] == 0

    monkeypatch.setattr(invite_routes, 'MAX_MEMBERS', 200)
    call(app, 'DELETE', '/circles/fam', 'chef')
    assert call(app, 'POST', '/circles/join', 'b', {'code': code})['statusCode'] == 400


def test_new_members_names_follow_their_nickname(ddb):
    _, app = _setup(ddb)
    brigade(ddb, 'fam', {'chef': 'owner', 'b': 'editor'})
    event = {'requestContext': {'http': {'method': 'GET'},
                                'authorizer': {'jwt': {'claims': {'sub': 'b', 'nickname': 'Gram'}}}},
             'rawPath': '/me/circles'}
    app.handler(event, None)
    assert member(ddb, 'fam', 'b')['displayName'] == 'Gram'


# --- copy -------------------------------------------------------------------

@pytest.fixture
def bucket(ddb, monkeypatch):
    s3 = boto3.client('s3', region_name='us-east-1')
    s3.create_bucket(Bucket='mbm-images')
    monkeypatch.setenv('IMAGES_BUCKET', 'mbm-images')
    return s3


def test_copy_makes_a_private_recipe_of_your_own(ddb, bucket):
    table, app = _setup(ddb)
    brigade(ddb, 'fam', {'gran': 'editor', 'me': 'member'})
    bucket.put_object(Bucket='mbm-images', Key='uploads/pie.jpeg', Body=b'pie')
    share(ddb, table, 'pie', 'gran', ['fam'], public=False, ownerName='Gran')
    table.update_item(Key={'recipeId': 'pie'}, UpdateExpression='SET image = :i, tags = :t',
                      ExpressionAttributeValues={':i': 'uploads/pie.jpeg', ':t': ['dessert']})

    res = call(app, 'POST', '/recipes/pie/copy', 'me')
    assert res['statusCode'] == 201
    copy = res['json']
    assert copy['recipeId'] != 'pie' and copy['title'] == 'Soup' and copy['tags'] == ['dessert']
    assert copy['sourceRecipeId'] == 'pie' and copy['sourceOwnerName'] == 'Gran'
    assert copy['isPublic'] is False and copy['sharedIn'] == [] and copy['access']['relation'] == 'owner'
    item = stored(table, copy['recipeId'])
    assert item['ownerSub'] == 'me' and 'circleIds' not in item and 'publicPk' not in item
    # Its own photo, in the same folder.
    assert item['image'].startswith('uploads/') and item['image'] != 'uploads/pie.jpeg'
    assert bucket.get_object(Bucket='mbm-images', Key=item['image'])['Body'].read() == b'pie'


def test_copy_keeps_sketches_in_their_folder_and_web_images_as_they_are(ddb, bucket):
    table, app = _setup(ddb)
    bucket.put_object(Bucket='mbm-images', Key='ai-sketches/soup.png', Body=b'x')
    share(ddb, table, 'sketch', 'gran', [], image='ai-sketches/soup.png')
    share(ddb, table, 'web', 'gran', [], image='https://example.com/soup.jpg')
    share(ddb, table, 'missing', 'gran', [], image='uploads/gone.jpeg')

    assert call(app, 'POST', '/recipes/sketch/copy', 'me')['json']['image'].startswith('ai-sketches/')
    assert call(app, 'POST', '/recipes/web/copy', 'me')['json']['image'] == 'https://example.com/soup.jpg'
    # A copy that can't copy the photo still points at the original rather than losing it.
    assert call(app, 'POST', '/recipes/missing/copy', 'me')['json']['image'] == 'uploads/gone.jpeg'


def test_cannot_copy_what_you_cannot_read(ddb):
    table, app = _setup(ddb)
    share(ddb, table, 'secret', 'gran', [], public=False)
    assert call(app, 'POST', '/recipes/secret/copy', 'me')['statusCode'] == 404
    assert call(app, 'POST', '/recipes/missing/copy', 'me')['statusCode'] == 404
