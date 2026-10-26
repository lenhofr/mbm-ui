import os
import sys
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


def _auth_module(name):
    auth_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'auth'))
    if auth_dir not in sys.path:
        sys.path.insert(0, auth_dir)   # post_confirmation imports pre_sign_up
    return load_module(os.path.join(auth_dir, f'{name}.py'))


@pytest.fixture
def auth(ddb, monkeypatch):
    monkeypatch.setenv('AWS_DEFAULT_REGION', 'us-east-1')
    sys.modules.pop('pre_sign_up', None)   # it reads INVITES_TABLE at import
    return ddb.Table('mbm-invites'), _auth_module('pre_sign_up')


@pytest.mark.parametrize('extra, ok', [
    ({}, True),                                         # older codes with no kind
    ({'kind': 'signup', 'allowSignup': True}, True),    # admin sign-up codes
    ({'kind': 'circle', 'circleId': 'fam'}, False),     # brigade codes never create accounts
    ({'kind': 'circle', 'circleId': 'fam', 'allowSignup': False}, False),
])
def test_only_sign_up_codes_create_accounts(auth, extra, ok):
    invites, app = auth
    invites.put_item(Item={'code': 'C-ABC', 'sk': 'META', 'maxUses': 5, 'uses': 0, **extra})
    if ok:
        sign_up(app, 'C-ABC')
        assert invites.get_item(Key={'code': 'C-ABC', 'sk': 'META'})['Item']['uses'] == 1
    else:
        with pytest.raises(Exception):
            sign_up(app, 'C-ABC')
        assert invites.get_item(Key={'code': 'C-ABC', 'sk': 'META'})['Item']['uses'] == 0


def confirmed(code, source='PostConfirmation_ConfirmSignUp', nickname=None):
    attrs = {'sub': 'new-cook', 'email': 'cook@example.com', 'custom:invite': code}
    if nickname:
        attrs['nickname'] = nickname
    return {'triggerSource': source, 'request': {'userAttributes': attrs}}


@pytest.fixture
def post(auth):
    invites, _ = auth
    return invites, _auth_module('post_confirmation')


def _brigade(ddb, cid='fam', **meta):
    ddb.Table('mbm-circles').put_item(Item={'pk': f'CIRCLE#{cid}', 'sk': 'META', 'name': 'Lenhofs',
                                            'memberCount': 1, 'ownerCount': 1, **meta})


def _member(ddb, cid='fam', sub='new-cook'):
    return ddb.Table('mbm-circles').get_item(Key={'pk': f'CIRCLE#{cid}', 'sk': f'MEMBER#{sub}'}).get('Item')


def test_new_cook_joins_the_brigade_on_their_code(ddb, post):
    invites, app = post
    _brigade(ddb)
    invites.put_item(Item={'code': 'NANA', 'sk': 'META', 'unlimited': True, 'kind': 'signup',
                           'allowSignup': True, 'circleId': 'fam', 'circleRole': 'editor', 'createdBySub': 'rob'})
    event = confirmed('nana')
    assert app.handler(event, None) is event
    row = _member(ddb)
    assert row['role'] == 'editor' and row['displayName'] == 'cook' and row['circleName'] == 'Lenhofs'
    assert row['gsi1pk'] == 'USER#new-cook' and row['invitedBy'] == 'rob' and row['inviteCode'] == 'NANA'
    # Cognito may run the trigger again: still one membership.
    app.handler(confirmed('NANA'), None)
    meta = ddb.Table('mbm-circles').get_item(Key={'pk': 'CIRCLE#fam', 'sk': 'META'})['Item']
    assert meta['memberCount'] == 2


@pytest.mark.parametrize('case', ['forgot-password', 'no-circle', 'unknown-code', 'deleting', 'tables-missing'])
def test_post_confirmation_never_fails_a_sign_up(ddb, post, monkeypatch, case):
    invites, app = post
    _brigade(ddb, deleting=True) if case == 'deleting' else _brigade(ddb)
    invites.put_item(Item={'code': 'FAM', 'sk': 'META', 'unlimited': True,
                           **({} if case == 'no-circle' else {'circleId': 'fam'})})
    event = {'forgot-password': confirmed('FAM', 'PostConfirmation_ConfirmForgotPassword'),
             'unknown-code': confirmed('NOPE')}.get(case, confirmed('FAM'))
    if case == 'tables-missing':
        monkeypatch.setenv('CIRCLES_TABLE', 'no-such-table')
    assert app.handler(event, None) is event
    assert _member(ddb) is None
