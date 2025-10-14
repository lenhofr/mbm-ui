import os
import json
import boto3
from botocore.exceptions import ClientError
import logging

s3 = boto3.client('s3')
IMAGES_BUCKET = os.environ.get('IMAGES_BUCKET')


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(body),
        'headers': {'Content-Type': 'application/json'}
    }


def redirect(location: str, status: int = 302):
    return {
        'statusCode': status,
        'headers': {
            'Location': location,
            # Avoid default JSON header on redirects
            'Cache-Control': 'private, max-age=300'
        },
        'body': ''
    }


def handler(event, context):
    # Support two operations:
    # POST /images -> returns { uploadUrl, key }
    # GET /images/{key} -> returns { url }
    http_ctx = event.get('requestContext', {}).get('http', {})
    method = http_ctx.get('method')
    raw_path = event.get('rawPath', '') or http_ctx.get('path', '') or ''
    # Normalize path to avoid trailing slash mismatches
    path = raw_path.rstrip('/') or '/'
    logging.info("images lambda: method=%s raw_path=%s path=%s", method, raw_path, path)

    try:
        # Presign request for uploads: POST /images (accept with or without trailing slash)
        if method == 'POST' and path == '/images':
            body = json.loads(event.get('body') or '{}')
            filename = body.get('filename') or 'upload'
            content_type = body.get('type') or 'image/jpeg'
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
            # Generate a presigned POST as a more compatible path for some mobile browsers
            # Use a starts-with policy for Content-Type to allow any image/* subtype
            try:
                post = s3.generate_presigned_post(
                    Bucket=IMAGES_BUCKET,
                    Key=key,
                    Fields={
                        'Content-Type': content_type,
                    },
                    Conditions=[
                        ["starts-with", "$Content-Type", "image/"],
                        {"key": key},
                        ["content-length-range", 0, 26214400],  # up to 25MB
                    ],
                    ExpiresIn=300,
                )
                post_url = post.get('url')
                post_fields = post.get('fields')
            except ClientError as _e:
                # If POST presign fails for any reason, fall back to only PUT
                post_url = None
                post_fields = None
            # Also provide a presigned GET URL for convenience
            get_url = s3.generate_presigned_url(
                ClientMethod='get_object',
                Params={'Bucket': IMAGES_BUCKET, 'Key': key},
                ExpiresIn=300
            )
            return response(200, {
                'uploadUrl': upload_url,
                'postUrl': post_url,
                'fields': post_fields,
                'key': key,
                'url': get_url
            })

        # GET presigned view URL: /images/{key}
        if method == 'GET' and path.startswith('/images/'):
            key = path.split('/images/', 1)[1]
            # decode if needed
            from urllib.parse import unquote
            key = unquote(key)
            url = s3.generate_presigned_url(
                ClientMethod='get_object',
                Params={'Bucket': IMAGES_BUCKET, 'Key': key},
                ExpiresIn=3600
            )
            # Redirect to the signed URL so <img src> works directly
            return redirect(url, 302)

        # Default if nothing matched
        return response(400, {'message': 'Unsupported operation', 'method': method, 'path': path})
    except ClientError as e:
        logging.exception("ClientError while handling request")
        return response(500, {'error': str(e)})
    except Exception as e:
        logging.exception("Unhandled error while handling request")
        return response(500, {'error': 'Internal server error'})
