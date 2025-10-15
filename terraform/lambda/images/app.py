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


def _extract_request(event: dict):
    """Extract method, path, route_key, and body text from either HTTP API v2.0 or v1.0/REST events."""
    rc = event.get('requestContext', {}) or {}
    version = event.get('version') or rc.get('version') or ''
    method = None
    route_key = rc.get('routeKey') or ''
    # Path sources (ordered by confidence)
    routed_path = None
    raw_path = None
    top_path = event.get('path')

    http_ctx = rc.get('http') or {}
    if http_ctx:  # HTTP API v2.0
        method = http_ctx.get('method')
        routed_path = http_ctx.get('path')
        raw_path = event.get('rawPath')
    else:  # v1.0 or REST proxy
        method = event.get('httpMethod') or rc.get('httpMethod')
        # v1.0 puts the request path at top-level 'path'
        routed_path = None
        raw_path = None
        if not route_key and method and top_path:
            route_key = f"{method} {top_path}"

    path_source = routed_path or raw_path or top_path or ''
    path = (path_source.rstrip('/') or '/') if path_source else '/'

    # Body (handle base64 flag)
    body_text = event.get('body')
    if body_text and event.get('isBase64Encoded'):
        try:
            import base64
            body_text = base64.b64decode(body_text).decode('utf-8', errors='replace')
        except Exception:
            pass

    return {
        'version': version,
        'method': method,
        'path': path,
        'route_key': route_key,
        'body_text': body_text or ''
    }


def handler(event, context):
    # Support two operations:
    # POST /images -> returns { uploadUrl, key }
    # GET /images/{key} -> returns { url }
    info = _extract_request(event)
    method = info['method']
    path = info['path']
    route_key = info['route_key']
    # Use print to ensure visibility at default logging level
    print(f"images lambda: method={method} route_key={route_key} path={path}")

    try:
        # Presign request for uploads: POST /images (support base path mappings)
        is_post_images = (method == 'POST') and (
            path == '/images' or path.endswith('/images') or route_key.startswith('POST /images')
        )
        if is_post_images:
            try:
                body = json.loads(info['body_text'] or '{}')
            except Exception:
                body = {}
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
                        'Cache-Control': 'public, max-age=31536000, immutable',
                    },
                    Conditions=[
                        ["starts-with", "$Content-Type", "image/"],
                        {"key": key},
                        ["content-length-range", 0, 26214400],  # up to 25MB
                        ["starts-with", "$Cache-Control", "public"],
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
        is_get_image = (method == 'GET') and (
            path.startswith('/images/') or '/images/' in path or route_key.startswith('GET /images')
        )
        if is_get_image:
            # Extract key component after the first occurrence of /images/
            if '/images/' in path:
                key = path.split('/images/', 1)[1]
            else:
                # Fallback: nothing to extract
                return response(400, {'message': 'Missing image key in path', 'path': path})
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
