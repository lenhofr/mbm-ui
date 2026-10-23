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


def test_create_and_get_recipe(ddb):
    recipes_app = load_app()

    # Create event
    body = {'title': 'Test Recipe'}
    event = {
        'requestContext': {'http': {'method': 'POST'}},
        'rawPath': '/recipes',
        'body': json.dumps(body)
    }

    res = recipes_app.handler(event, None)
    assert res['statusCode'] == 201
    created = json.loads(res['body'])
    assert created['title'] == 'Test Recipe'
    assert 'recipeId' in created

    # Now get the recipe
    recipe_id = created['recipeId']
    event_get = {
        'requestContext': {'http': {'method': 'GET'}},
        'rawPath': f'/recipes/{recipe_id}'
    }
    res_get = recipes_app.handler(event_get, None)
    assert res_get['statusCode'] == 200
    got = json.loads(res_get['body'])
    assert got['recipeId'] == recipe_id
    # End of test_create_and_get_recipe



def test_update_clears_fields_left_out_of_the_body(ddb):
    recipes_app = load_app()

    created = json.loads(recipes_app.handler({
        'requestContext': {'http': {'method': 'POST'}},
        'rawPath': '/recipes',
        'body': json.dumps({'title': 'Soup', 'description': 'Hearty', 'cookTime': '1 hr', 'image': 'uploads/a.jpeg', 'servings': '4'}),
    }, None)['body'])
    recipe_id = created['recipeId']

    # The editor cleared the description and photo, so they're absent from the full-recipe PUT.
    res = recipes_app.handler({
        'requestContext': {'http': {'method': 'PUT'}},
        'rawPath': f'/recipes/{recipe_id}',
        'pathParameters': {'id': recipe_id},
        'body': json.dumps({'title': 'Soup', 'cookTime': '1 hr', 'servings': '6'}),
    }, None)
    assert res['statusCode'] == 200
    updated = json.loads(res['body'])
    assert updated['servings'] == '6'
    assert updated['cookTime'] == '1 hr'
    assert 'description' not in updated
    assert 'image' not in updated
    # Creation metadata survives the update.
    assert updated['createdAt'] == created['createdAt']


def _as(sub, groups=None):
    """requestContext claims as API Gateway's JWT authorizer passes them."""
    claims = {'sub': sub}
    if groups is not None:
        claims['cognito:groups'] = groups
    return {'authorizer': {'jwt': {'claims': claims}}}


def _delete(app, recipe_id, ctx):
    return app.handler({
        'requestContext': {'http': {'method': 'DELETE'}, **ctx},
        'rawPath': f'/recipes/{recipe_id}',
        'pathParameters': {'id': recipe_id},
    }, None)


def test_only_the_creator_or_an_admin_can_delete(ddb):
    table, recipes_app = _setup(ddb)

    def create(ctx):
        return json.loads(recipes_app.handler({
            'requestContext': {'http': {'method': 'POST'}, **ctx},
            'rawPath': '/recipes',
            'body': json.dumps({'title': 'Soup'}),
        }, None)['body'])['recipeId']

    # Someone else can't delete it, even though anyone can edit.
    mine = create(_as('cook-a'))
    assert _delete(recipes_app, mine, _as('cook-b'))['statusCode'] == 403
    assert 'Item' in table.get_item(Key={'recipeId': mine})
    assert _delete(recipes_app, mine, _as('cook-a'))['statusCode'] == 204
    assert 'Item' not in table.get_item(Key={'recipeId': mine})

    # Admins can delete anyone's recipe; the authorizer sends groups as "[admins]".
    theirs = create(_as('cook-a'))
    assert _delete(recipes_app, theirs, _as('cook-b', '[admins]'))['statusCode'] == 204

    # Recipes saved before attribution have no creator: admin-only.
    table.put_item(Item={'recipeId': 'old', 'title': 'Old'})
    assert _delete(recipes_app, 'old', _as('cook-a'))['statusCode'] == 403
    assert _delete(recipes_app, 'old', _as('cook-a', ['admins']))['statusCode'] == 204


def _setup(ddb):
    return ddb.Table('mbm-recipes'), load_app()


def _post(app, body, ctx=None):
    raw = body if isinstance(body, str) else json.dumps(body)
    return app.handler({
        'requestContext': {'http': {'method': 'POST'}, **(ctx or {})},
        'rawPath': '/recipes',
        'body': raw,
    }, None)


def _put(app, recipe_id, body, ctx=None):
    return app.handler({
        'requestContext': {'http': {'method': 'PUT'}, **(ctx or {})},
        'rawPath': f'/recipes/{recipe_id}',
        'pathParameters': {'id': recipe_id},
        'body': json.dumps(body),
    }, None)


def test_create_ignores_server_owned_and_unknown_fields(ddb):
    table, app = _setup(ddb)
    res = _post(app, {
        'title': '  Soup  ',
        'recipeId': 'chosen-by-client',
        'createdBySub': 'someone-else',
        'createdByName': 'Impostor',
        'updatedAt': 1,
        'ownerSub': 'x', 'publicPk': 'PUBLIC', 'isAdmin': True, 'junk': 'y',
        'servings': 4,
        'ingredients': [{'name': 'salt', 'amount': '1 tsp', 'evil': 'z'}, {'name': '  '}],
        'tags': ['soup', 'soup', 'easy'],
    }, _as('cook-a'))
    assert res['statusCode'] == 201
    created = json.loads(res['body'])
    stored = table.get_item(Key={'recipeId': created['recipeId']})['Item']
    assert created['recipeId'] != 'chosen-by-client'
    assert stored['title'] == 'Soup'
    assert stored['createdBySub'] == 'cook-a'
    assert stored['createdByName'] == 'cook-a'
    assert stored['updatedAt'] != 1
    for k in ('ownerSub', 'publicPk', 'isAdmin', 'junk'):
        assert k not in stored
    assert stored['servings'] == '4'
    assert stored['ingredients'] == [{'name': 'salt', 'amount': '1 tsp'}]
    assert stored['tags'] == ['soup', 'easy']


def test_update_keeps_attribution_and_ignores_server_owned_fields(ddb):
    table, app = _setup(ddb)
    rid = json.loads(_post(app, {'title': 'Soup'}, _as('cook-a'))['body'])['recipeId']
    # Something stored outside the editor's fields survives an edit.
    table.update_item(Key={'recipeId': rid}, UpdateExpression='SET sourceNote = :n',
                      ExpressionAttributeValues={':n': 'from a card'})

    res = _put(app, rid, {'title': 'Better soup', 'createdBySub': 'cook-b', 'createdAt': 1, 'junk': 'y'}, _as('cook-b'))
    assert res['statusCode'] == 200
    stored = table.get_item(Key={'recipeId': rid})['Item']
    assert stored['title'] == 'Better soup'
    assert stored['createdBySub'] == 'cook-a'
    assert stored['createdAt'] != 1
    assert stored['updatedBySub'] == 'cook-b'
    assert stored['sourceNote'] == 'from a card'
    assert 'junk' not in stored


def test_update_of_a_missing_recipe_is_404_not_a_create(ddb):
    table, app = _setup(ddb)
    assert _put(app, 'made-up-id', {'title': 'Soup'}, _as('cook-a'))['statusCode'] == 404
    assert 'Item' not in table.get_item(Key={'recipeId': 'made-up-id'})


def test_update_backfills_created_at_on_old_recipes(ddb):
    table, app = _setup(ddb)
    table.put_item(Item={'recipeId': 'old', 'title': 'Old'})
    res = _put(app, 'old', {'title': 'Old, fixed'}, _as('cook-a'))
    assert res['statusCode'] == 200
    stored = table.get_item(Key={'recipeId': 'old'})['Item']
    assert stored['createdAt'] == stored['updatedAt']
    assert 'createdBySub' not in stored  # still admin-only to delete


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
    assert message in json.loads(res['body'])['message']
    assert table.scan()['Count'] == 0


def test_images_keep_working(ddb):
    table, app = _setup(ddb)
    for image in ('uploads/abc123.jpeg', 'https://example.com/pie.jpg'):
        res = _post(app, {'title': 'Pie', 'image': image}, _as('cook-a'))
        assert res['statusCode'] == 201
        assert json.loads(res['body'])['image'] == image


def test_list_follows_pagination(ddb, monkeypatch):
    table, app = _setup(ddb)
    with table.batch_writer() as w:
        for i in range(30):
            w.put_item(Item={'recipeId': f'r{i}', 'title': f'Recipe {i}'})

    real_scan = table.scan
    calls = []

    def small_pages(**kwargs):
        calls.append(kwargs)
        return real_scan(Limit=7, **kwargs)

    class Wrapped:
        def __getattr__(self, name):
            return small_pages if name == 'scan' else getattr(table, name)

    monkeypatch.setattr(app.repo, 'recipes_table', lambda: Wrapped())
    res = app.handler({'requestContext': {'http': {'method': 'GET'}}, 'rawPath': '/recipes'}, None)
    assert res['statusCode'] == 200
    assert len(json.loads(res['body'])) == 30
    assert len(calls) >= 5


def test_identity_never_comes_from_an_unverified_header(ddb):
    import base64 as b64
    table, app = _setup(ddb)
    table.put_item(Item={'recipeId': 'r1', 'title': 'Soup', 'createdBySub': 'cook-a'})
    fake = b64.urlsafe_b64encode(json.dumps({'sub': 'cook-a', 'cognito:groups': ['admins']}).encode()).decode().rstrip('=')
    res = app.handler({
        'requestContext': {'http': {'method': 'DELETE'}},
        'rawPath': '/recipes/r1',
        'pathParameters': {'id': 'r1'},
        'headers': {'authorization': f'Bearer x.{fake}.y'},
    }, None)
    assert res['statusCode'] == 403
    assert 'Item' in table.get_item(Key={'recipeId': 'r1'})


def test_ratings_routes_are_gone(ddb):
    table, app = _setup(ddb)
    for method in ('GET', 'POST'):
        res = app.handler({'requestContext': {'http': {'method': method}}, 'rawPath': '/ratings', 'body': '{}'}, None)
        assert res['statusCode'] == 400
