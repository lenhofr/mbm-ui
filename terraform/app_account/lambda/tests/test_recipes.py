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

