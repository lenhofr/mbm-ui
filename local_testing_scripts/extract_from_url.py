#!/usr/bin/env python3
"""
Extract a recipe from a webpage URL using AWS Bedrock (boto3 converse API).

Setup:
    source /Users/robl/dev/ai/bedrock/.venv/bin/activate
    pip install boto3
    export AWS_ACCESS_KEY_ID=...
    export AWS_SECRET_ACCESS_KEY=...
    export AWS_DEFAULT_REGION=us-east-1   # or your region

Usage:
    python extract_from_url.py <url> [model-id]

Output: JSON matching the mbm-ui Recipe schema (ready to POST to /recipes).
"""

import json
import sys
import urllib.request
from html.parser import HTMLParser

# Claude Sonnet 4.6 gives excellent recipe extraction quality at ~$0.02-0.03/call.
# For a ~10x cost reduction with slightly lower quality, switch to: us.anthropic.claude-haiku-4-5
DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

SYSTEM_PROMPT = """You are a recipe extraction assistant. Given the text content of a recipe webpage,
extract the recipe and return ONLY a JSON object.

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
- Ignore ads, navigation, comments, and unrelated page content.
- If no recipe is present, return {"error": "no recipe found"}."""


class TextExtractor(HTMLParser):
    """Strips HTML tags and returns visible text, skipping script/style blocks."""

    SKIP_TAGS = {"script", "style", "noscript", "head", "meta", "link"}

    def __init__(self):
        super().__init__()
        self._skip = 0
        self.chunks: list[str] = []

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

    def get_text(self) -> str:
        return "\n".join(self.chunks)


def fetch_page_text(url: str, char_limit: int = 20_000) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    parser = TextExtractor()
    parser.feed(html)
    text = parser.get_text()

    if len(text) > char_limit:
        text = text[:char_limit] + "\n...[truncated]"
    return text


def extract_recipe(url: str, model: str = DEFAULT_MODEL) -> dict:
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 not found — install it first:\n  pip install boto3")

    import os
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")

    print(f"[info] Fetching {url}...", file=sys.stderr)
    try:
        page_text = fetch_page_text(url)
    except Exception as e:
        sys.exit(f"Failed to fetch URL: {e}")

    print(f"[info] Extracted {len(page_text)} chars. Sending to {model}...", file=sys.stderr)

    client = boto3.client("bedrock-runtime", region_name=region)

    try:
        response = client.converse(
            modelId=model,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": f"URL: {url}\n\n---\n{page_text}"}],
                }
            ],
            inferenceConfig={"maxTokens": 2048},
        )
    except Exception as e:
        sys.exit(f"Bedrock API error: {e}")

    raw = response["output"]["message"]["content"][0]["text"]
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "model returned non-JSON", "raw": raw}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Extract a recipe from a webpage URL via AWS Bedrock.")
    parser.add_argument("url", help="URL of the recipe page")
    parser.add_argument("--model", default=DEFAULT_MODEL, metavar="MODEL_ID", help="Bedrock model ID")
    args = parser.parse_args()

    result = extract_recipe(args.url, model=args.model)
    print(json.dumps(result, indent=2))
