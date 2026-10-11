import os
import json
import boto3
import importlib.util
import pytest
from moto import mock_aws


def load_module(path):
    spec = importlib.util.spec_from_file_location('app_module', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@mock_aws()
def test_create_and_get_recipe(tmp_path, monkeypatch):
    # Setup DynamoDB table
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    table = dynamodb.create_table(
        TableName='mbm-recipes',
        KeySchema=[{'AttributeName': 'recipeId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'recipeId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST'
    )
    table.wait_until_exists()

    monkeypatch.setenv('RECIPES_TABLE', 'mbm-recipes')

    # Load handler module by path
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    module_path = os.path.join(repo_root, 'recipes', 'app.py')
    recipes_app = load_module(module_path)

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



@mock_aws()
def test_update_clears_fields_left_out_of_the_body(monkeypatch):
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    dynamodb.create_table(
        TableName='mbm-recipes',
        KeySchema=[{'AttributeName': 'recipeId', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'recipeId', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST'
    ).wait_until_exists()
    monkeypatch.setenv('RECIPES_TABLE', 'mbm-recipes')
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    recipes_app = load_module(os.path.join(repo_root, 'recipes', 'app.py'))

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
