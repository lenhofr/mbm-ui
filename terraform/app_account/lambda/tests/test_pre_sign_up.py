import os
import json
import boto3
import importlib.util
import pytest
from moto import mock_aws


def load_module(path):
    spec = importlib.util.spec_from_file_location('pre_sign_up_module', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sign_up(app, code):
    return app.handler({'request': {'userAttributes': {'email': 'cook@example.com', 'custom:invite': code}}}, None)


@mock_aws()
def test_invite_codes_ignore_case(monkeypatch):
    monkeypatch.setenv('AWS_DEFAULT_REGION', 'us-east-1')
    monkeypatch.setenv('INVITES_TABLE', 'mbm-invites')
    ddb = boto3.client('dynamodb', region_name='us-east-1')
    ddb.create_table(
        TableName='mbm-invites',
        KeySchema=[{'AttributeName': 'code', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
        AttributeDefinitions=[{'AttributeName': 'code', 'AttributeType': 'S'}, {'AttributeName': 'sk', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST',
    )
    for code in ('ABC123', 'Family2024'):
        ddb.put_item(TableName='mbm-invites', Item={'code': {'S': code}, 'sk': {'S': 'META'}, 'unlimited': {'BOOL': True}})
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    app = load_module(os.path.join(repo_root, 'auth', 'pre_sign_up.py'))

    # Generated codes are uppercase; lowercase typing (and stray spaces) still works.
    sign_up(app, ' abc123 ')
    # An older mixed-case code still works exactly as written.
    sign_up(app, 'Family2024')
    with pytest.raises(Exception):
        sign_up(app, 'nope')
