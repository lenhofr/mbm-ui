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


@mock_aws()
def test_get_image_redirect(monkeypatch):
    s3 = boto3.client('s3', region_name='us-east-1')
    bucket = 'mbm-site-images-test'
    s3.create_bucket(Bucket=bucket)

    monkeypatch.setenv('IMAGES_BUCKET', bucket)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    module_path = os.path.join(repo_root, 'images', 'app.py')
    images_app = load_module(module_path)

    # Seed an object (key presence is not strictly required for presign, but good sanity)
    s3.put_object(Bucket=bucket, Key='uploads/test.jpg', Body=b'data')

    event = {'requestContext': {'http': {'method': 'GET'}}, 'rawPath': '/images/uploads/test.jpg'}
    res = images_app.handler(event, None)
    assert res['statusCode'] in (301, 302, 303, 307, 308)
    # Must have Location header pointing at s3 presigned url
    assert 'headers' in res and 'Location' in res['headers']
    assert res['headers']['Location'].startswith('https://')
