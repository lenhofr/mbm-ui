import os
import json
from decimal import Decimal
import uuid
import time
import base64
import urllib.request
from html.parser import HTMLParser
import boto3
from botocore.exceptions import ClientError

RECIPES_TABLE = os.environ.get('RECIPES_TABLE')
RATINGS_TABLE = os.environ.get('RATINGS_TABLE')

BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6"
# For ~10x cost reduction with slightly lower quality, switch to: us.anthropic.claude-haiku-4-5

_bedrock = None
_bedrock_expiry = 0  # epoch seconds; 0 means never set

def get_bedrock():
    global _bedrock, _bedrock_expiry
    region = os.environ.get("AWS_REGION", "us-east-1")
    role_arn = os.environ.get("BEDROCK_ROLE_ARN")
    if role_arn:
        # Refresh assumed-role credentials when they're within 5 minutes of expiry
        if _bedrock is None or time.time() > _bedrock_expiry - 300:
            sts = boto3.client("sts")
            assumed = sts.assume_role(
                RoleArn=role_arn,
                RoleSessionName="mbm-recipes-bedrock",
            )
            creds = assumed["Credentials"]
            _bedrock_expiry = int(assumed["Credentials"]["Expiration"].timestamp())
            _bedrock = boto3.client(
                "bedrock-runtime",
                region_name=region,
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
            )
    elif _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=region)
    return _bedrock


AI_SYSTEM_PROMPT = """You are a recipe extraction assistant. Extract recipe information and return ONLY a JSON object.

Return a JSON object with these fields (omit any you cannot determine):
{
  "title": "string (required)",
  "description": "short summary string",
  "tags": ["category", "strings"],
  "ingredients": [{"name": "string", "amount": "string"}],
  "servings": "string e.g. '4' or '4-6'",
  "cookTime": "string e.g. '30 minutes'",
  "instructions": ["step 1", "step 2"]
}

Rules:
- Return ONLY valid JSON. No markdown fences, no explanation.
- ingredients[].amount is quantity+unit as a string (e.g. "1 cup", "200g"), omit if unknown.
- instructions are ordered plain strings with no numbering prefix.
- tags are concise descriptors like ["italian", "pasta", "vegetarian"].
- Ignore ads, navigation, comments, and unrelated content.
- If no recipe is present, return {"error": "no recipe found"}."""


class _TextExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "head", "meta", "link"}

    def __init__(self):
        super().__init__()
        self._skip = 0
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.SKIP_TAGS:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag.lower() in self.SKIP_TAGS:
            self._skip = max(0, self._skip - 1)

    def handle_data(self, data):
        if self._skip == 0:
            text = data.strip()
            if text:
                self.chunks.append(text)

    def get_text(self):
        return "\n".join(self.chunks)


def _parse_bedrock_json(raw):
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "model returned non-JSON", "raw": raw}


def _extract_from_image(data_b64, media_type):
    image_bytes = base64.b64decode(data_b64)
    fmt = media_type.split("/")[-1].lower()
    if fmt == "jpg":
        fmt = "jpeg"
    resp = get_bedrock().converse(
        modelId=BEDROCK_MODEL,
        system=[{"text": AI_SYSTEM_PROMPT}],
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": fmt, "source": {"bytes": image_bytes}}},
                {"text": "Extract the recipe from this image."},
            ],
        }],
        inferenceConfig={"maxTokens": 2048},
    )
    return _parse_bedrock_json(resp["output"]["message"]["content"][0]["text"])


def _extract_from_url(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    })
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode("utf-8", errors="replace")
    parser = _TextExtractor()
    parser.feed(html)
    text = parser.get_text()[:20000]
    resp = get_bedrock().converse(
        modelId=BEDROCK_MODEL,
        system=[{"text": AI_SYSTEM_PROMPT}],
        messages=[{
            "role": "user",
            "content": [{"text": f"URL: {url}\n\n---\n{text}"}],
        }],
        inferenceConfig={"maxTokens": 2048},
    )
    return _parse_bedrock_json(resp["output"]["message"]["content"][0]["text"])


def get_dynamodb():
    region = os.environ.get('AWS_REGION', 'us-east-1')
    return boto3.resource('dynamodb', region_name=region)


def _to_jsonable(obj):
    """Recursively convert DynamoDB Decimals and nested structures to JSON-serializable types."""
    if isinstance(obj, Decimal):
        # Preserve integers as int, otherwise use float
        try:
            return int(obj) if obj % 1 == 0 else float(obj)
        except Exception:
            return float(obj)
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    return obj


def response(status_code, body):
    return {
        'statusCode': status_code,
        'body': json.dumps(_to_jsonable(body)),
        'headers': {'Content-Type': 'application/json'}
    }


def map_recipe_out(item: dict | None) -> dict | None:
    if not item:
        return None
    out = dict(item)
    rid = out.get('recipeId')
    if rid is not None:
        # Keep both for backward compatibility
        out['id'] = rid
        out['recipeId'] = rid
    return out


def _get_table(name, dynamodb):
    if not name:
        raise ValueError('Table name not set in environment')
    return dynamodb.Table(name)


def handler(event, context):
    rc = event.get('requestContext', {})
    http = rc.get('http', {})
    # Support v2.0 and 1.0 payloads
    raw_path = event.get('rawPath') or event.get('path') or ''
    # Method from multiple potential locations
    method = (http.get('method') or rc.get('httpMethod') or event.get('httpMethod') or '').upper()
    route_key = rc.get('routeKey', '')  # e.g., "POST /recipes"
    path_params = event.get('pathParameters') or {}
    query = event.get('queryStringParameters') or {}

    # Fallback for local tests or environments that don't set routeKey
    if not route_key:
        # Normalize trailing slash
        path = raw_path[:-1] if raw_path and raw_path.endswith('/') and raw_path != '/' else raw_path
        if method and path:
            # Map concrete path to templated route where possible
            if path == '/recipes' and method in ('GET', 'POST'):
                route_key = f'{method} /recipes'
            elif path.startswith('/recipes/') and method in ('GET', 'PUT', 'DELETE'):
                route_key = f'{method} /recipes/{{id}}'
            elif path == '/ratings' and method in ('GET', 'POST'):
                route_key = f'{method} /ratings'

    # If route_key provided but unexpected (e.g., path has trailing slash), re-derive a normalized key
    expected = {
        'GET /recipes',
        'GET /recipes/{id}',
        'POST /recipes',
        'PUT /recipes/{id}',
        'DELETE /recipes/{id}',
        'GET /ratings',
        'POST /ratings',
        'POST /ai/extract-recipe',
    }
    if route_key and route_key not in expected:
        # Normalize raw_path: strip trailing slashes (except root) and collapse duplicate slashes
        path = raw_path or ''
        while '//' in path:
            path = path.replace('//', '/')
        if path.endswith('/') and path != '/':
            path = path.rstrip('/')
        if method and path:
            if path == '/recipes' and method in ('GET', 'POST'):
                route_key = f'{method} /recipes'
            elif path.startswith('/recipes/') and method in ('GET', 'PUT', 'DELETE'):
                route_key = f'{method} /recipes/{{id}}'
            elif path == '/ratings' and method in ('GET', 'POST'):
                route_key = f'{method} /ratings'

    # Normalize path for method+path matching
    norm_path = raw_path or ''
    while '//' in norm_path:
        norm_path = norm_path.replace('//', '/')
    if norm_path.endswith('/') and norm_path != '/':
        norm_path = norm_path.rstrip('/')

    # Emit a lightweight log line for quick diagnostics in CloudWatch
    try:
        region = os.environ.get('AWS_REGION', 'us-east-1')
        print(f"recipes lambda: method={method} route_key={route_key} raw_path={raw_path} table={RECIPES_TABLE} region={region}")
    except Exception:
        pass

    # Helper: extract identity from Cognito JWT claims (via API Gateway HTTP API authorizer)
    def get_identity():
        rc = (event or {}).get('requestContext') or {}
        auth_ctx = (rc.get('authorizer') or {})
        claims = (auth_ctx.get('jwt') or {}).get('claims') or auth_ctx.get('claims') or {}

        # Fallback: decode JWT from Authorization header without verification.
        # API Gateway already enforced the JWT authorizer for protected routes, so we only use this
        # to extract display attributes (nickname/email/etc.).
        if not claims:
            try:
                authz = (event.get('headers') or {}).get('authorization') or (event.get('headers') or {}).get('Authorization')
                if authz and isinstance(authz, str) and authz.lower().startswith('bearer '):
                    token = authz.split(' ', 1)[1].strip()
                    parts = token.split('.')
                    if len(parts) == 3:
                        payload_b64 = parts[1]
                        # Base64url decode
                        rem = len(payload_b64) % 4
                        if rem:
                            payload_b64 += '=' * (4 - rem)
                        payload_json = base64.urlsafe_b64decode(payload_b64.encode('utf-8')).decode('utf-8')
                        claims = json.loads(payload_json)
            except Exception:
                # Ignore failures; we'll fall back to defaults
                pass

        # Pull out common user identifiers from either ID or Access token
        sub = (claims.get('sub')
               or claims.get('cognito:username')
               or claims.get('username'))
        email = claims.get('email')

        # Prefer friendly names if present
        nickname = (claims.get('nickname')
                    or claims.get('preferred_username')
                    or claims.get('name'))
        given = claims.get('given_name')
        family = claims.get('family_name')

        friendly_from_email = None
        if email and isinstance(email, str) and '@' in email:
            friendly_from_email = email.split('@')[0]

        # Derive display name by precedence
        name = (
            nickname
            or (f"{given} {family}".strip() if given or family else None)
            or friendly_from_email
            or (claims.get('cognito:username') or claims.get('username'))
            or sub
            or 'user'
        )

        return {
            'sub': sub,
            'email': email,
            'name': name,
        }

    # Recipes
    if route_key in (
        'GET /recipes',
        'GET /recipes/{id}',
        'POST /recipes',
        'PUT /recipes/{id}',
        'DELETE /recipes/{id}',
    ) or (method == 'GET' and (norm_path == '/recipes' or norm_path.startswith('/recipes/'))):
        table = _get_table(RECIPES_TABLE, get_dynamodb())

        if route_key == 'GET /recipes' or (method == 'GET' and norm_path == '/recipes'):
            try:
                res = table.scan()
                items = res.get('Items', [])
                return response(200, [map_recipe_out(i) for i in items])
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'GET /recipes/{id}' or (method == 'GET' and norm_path.startswith('/recipes/')):
            recipe_id = path_params.get('id') or (norm_path.split('/')[-1] if norm_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                res = table.get_item(Key={'recipeId': recipe_id})
                item = res.get('Item')
                if not item:
                    return response(404, {'message': 'Not found'})
                return response(200, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'POST /recipes':
            try:
                body = json.loads(event.get('body') or '{}')
                recipe_id = str(uuid.uuid4())
                ident = get_identity()
                now = int(time.time())
                # Stamp attribution and timestamps
                item = {
                    'recipeId': recipe_id,
                    **body,
                    'createdAt': now,
                    'createdBySub': ident.get('sub'),
                    'createdByName': ident.get('name'),
                    'updatedAt': now,
                    'updatedBySub': ident.get('sub'),
                    'updatedByName': ident.get('name'),
                }
                table.put_item(Item=item)
                return response(201, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'PUT /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                body = json.loads(event.get('body') or '{}')
                ident = get_identity()
                now = int(time.time())

                # Load existing to preserve created* fields if present
                existing = table.get_item(Key={'recipeId': recipe_id}).get('Item') or {}
                created_at = existing.get('createdAt') or now
                created_by_sub = existing.get('createdBySub')
                created_by_name = existing.get('createdByName')

                item = {
                    'recipeId': recipe_id,
                    **existing,
                    **body,
                    # preserve original creation metadata
                    'createdAt': created_at,
                    'createdBySub': created_by_sub,
                    'createdByName': created_by_name,
                    # update modification metadata
                    'updatedAt': now,
                    'updatedBySub': ident.get('sub'),
                    'updatedByName': ident.get('name'),
                }
                table.put_item(Item=item)
                return response(200, map_recipe_out(item))
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'DELETE /recipes/{id}':
            recipe_id = path_params.get('id') or (raw_path.split('/')[-1] if raw_path else None)
            if not recipe_id:
                return response(400, {'message': 'Missing id'})
            try:
                table.delete_item(Key={'recipeId': recipe_id})
                return response(204, {})
            except ClientError as e:
                return response(500, {'error': str(e)})

    # Ratings
    if route_key in ('POST /ratings', 'GET /ratings'):
        table = _get_table(RATINGS_TABLE, get_dynamodb())

        if route_key == 'POST /ratings':
            try:
                body = json.loads(event.get('body') or '{}')
                rating_id = str(uuid.uuid4())
                item = {'ratingId': rating_id, **body}
                table.put_item(Item=item)
                return response(201, item)
            except ClientError as e:
                return response(500, {'error': str(e)})

        if route_key == 'GET /ratings':
            try:
                res = table.scan()
                items = res.get('Items', [])
                if 'recipeId' in query:
                    items = [i for i in items if i.get('recipeId') == query['recipeId']]
                return response(200, items)
            except ClientError as e:
                return response(500, {'error': str(e)})

    # AI recipe extraction
    if route_key == 'POST /ai/extract-recipe':
        try:
            body = json.loads(event.get('body') or '{}')
            extract_type = body.get('type')
            if extract_type == 'image':
                data = body.get('data')
                media_type = body.get('mediaType', 'image/jpeg')
                if not data:
                    return response(400, {'error': 'Missing data field for image extraction'})
                result = _extract_from_image(data, media_type)
            elif extract_type == 'url':
                url = body.get('url', '').strip()
                if not url:
                    return response(400, {'error': 'Missing url field for URL extraction'})
                result = _extract_from_url(url)
            else:
                return response(400, {'error': 'type must be "image" or "url"'})
            return response(200, result)
        except ClientError as e:
            print(f"Bedrock error: {e}")
            return response(502, {'error': 'AI service error', 'detail': str(e)})
        except Exception as e:
            print(f"extract-recipe error: {e}")
            return response(500, {'error': str(e)})

    return response(400, {'message': 'Unsupported operation'})
