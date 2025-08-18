import os
import json
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client('s3')
IMAGES_BUCKET = os.environ.get('IMAGES_BUCKET')


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
        'headers': {'Content-Type': 'application/json'}
    }


def handler(event, context):
    # Support two operations:
    # POST /images -> returns { uploadUrl, key }
    # GET /images/{key} -> returns { url }
    method = event.get('requestContext', {}).get('http', {}).get('method')
    raw_path = event.get('rawPath', '')

    try:
        if raw_path == '/images' and method in ('POST', 'GET'):
            body = json.loads(event.get('body') or '{}')
            filename = body.get('filename') or 'upload'
            # preserve extension if present
            ext = ''
            if '.' in filename:
                ext = '.' + filename.split('.')[-1]
            import uuid
            key = f'uploads/{uuid.uuid4().hex}{ext}'
            # Shorter presign TTL to limit exposure (was 3600s)
            upload_url = s3.generate_presigned_url(
                ClientMethod='put_object',
                Params={'Bucket': IMAGES_BUCKET, 'Key': key},
                ExpiresIn=300
            )
            # Also provide a presigned GET URL for convenience
            get_url = s3.generate_presigned_url(
                ClientMethod='get_object',
                Params={'Bucket': IMAGES_BUCKET, 'Key': key},
                ExpiresIn=300
            )
            return response(200, {'uploadUrl': upload_url, 'key': key, 'url': get_url})

        # GET presigned view URL: /images/{key}
        if method == 'GET' and raw_path.startswith('/images/'):
            key = raw_path.split('/images/', 1)[1]
            # decode if needed
            from urllib.parse import unquote
            key = unquote(key)
            url = s3.generate_presigned_url(
                ClientMethod='get_object',
                Params={'Bucket': IMAGES_BUCKET, 'Key': key},
                ExpiresIn=3600
            )
            return response(200, {'url': url})

        return response(400, {'message': 'Unsupported operation'})
    except ClientError as e:
        return response(500, {'error': str(e)})
