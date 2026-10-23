import boto3
import pytest
from moto import mock_aws


def _gsi(name, hash_key, range_key):
    return {
        'IndexName': name,
        'KeySchema': [{'AttributeName': hash_key, 'KeyType': 'HASH'},
                      {'AttributeName': range_key, 'KeyType': 'RANGE'}],
        'Projection': {'ProjectionType': 'ALL'},
    }


@pytest.fixture
def ddb(monkeypatch):
    """The recipes, circles and invites tables with their GSIs, as in backend_api.tf."""
    with mock_aws():
        c = boto3.client('dynamodb', region_name='us-east-1')
        c.create_table(
            TableName='mbm-recipes', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'recipeId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': n, 'AttributeType': t} for n, t in
                                  [('recipeId', 'S'), ('ownerSub', 'S'), ('publicPk', 'S'), ('updatedAt', 'N')]],
            GlobalSecondaryIndexes=[_gsi('gsi_owner', 'ownerSub', 'updatedAt'),
                                    _gsi('gsi_public', 'publicPk', 'updatedAt')])
        c.create_table(
            TableName='mbm-circles', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': n, 'AttributeType': 'S'} for n in ('pk', 'sk', 'gsi1pk', 'gsi1sk')],
            GlobalSecondaryIndexes=[_gsi('gsi1', 'gsi1pk', 'gsi1sk')])
        c.create_table(
            TableName='mbm-invites', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'code', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': n, 'AttributeType': t} for n, t in
                                  [('code', 'S'), ('sk', 'S'), ('email', 'S'), ('usedAt', 'N')]],
            GlobalSecondaryIndexes=[_gsi('gsi_email', 'email', 'usedAt')])
        for k, v in dict(RECIPES_TABLE='mbm-recipes', CIRCLES_TABLE='mbm-circles',
                         INVITES_TABLE='mbm-invites', AWS_REGION='us-east-1').items():
            monkeypatch.setenv(k, v)
        yield boto3.resource('dynamodb', region_name='us-east-1')
