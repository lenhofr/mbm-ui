import os
import json
import boto3
import importlib.util
from moto import mock_aws


def load_module(path):
    spec = importlib.util.spec_from_file_location('app_module', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@mock_aws()
def test_get_presigned_url(monkeypatch):
    s3 = boto3.client('s3', region_name='us-east-1')
    bucket = 'mbm-site-images-test'
    s3.create_bucket(Bucket=bucket)

    monkeypatch.setenv('IMAGES_BUCKET', bucket)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    module_path = os.path.join(repo_root, 'images', 'app.py')
    images_app = load_module(module_path)

    event = {'requestContext': {'http': {'method': 'GET'}}, 'rawPath': '/images'}
    res = images_app.handler(event, None)
    assert res['statusCode'] == 200
    body = json.loads(res['body'])
    assert 'uploadUrl' in body
    assert 'key' in body
