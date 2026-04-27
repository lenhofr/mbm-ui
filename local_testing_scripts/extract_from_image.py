#!/usr/bin/env python3
"""
Extract a recipe from one or more image files using AWS Bedrock (boto3 converse API).

Setup:
    source /Users/robl/dev/ai/bedrock/.venv/bin/activate
    pip install boto3
    export AWS_ACCESS_KEY_ID=...
    export AWS_SECRET_ACCESS_KEY=...
    export AWS_DEFAULT_REGION=us-east-1   # or your region

Usage:
    python extract_from_image.py <image1> [image2 ...] [--model MODEL_ID]

Output: JSON matching the mbm-ui Recipe schema (ready to POST to /recipes).
"""

import io
import json
import sys
from pathlib import Path

# Claude Sonnet 4.6 gives excellent recipe extraction quality at ~$0.01-0.02/call.
# For a ~10x cost reduction with slightly lower quality, switch to: us.anthropic.claude-haiku-4-5
DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

SYSTEM_PROMPT = """You are a recipe extraction assistant. Given one or more images of a recipe card, handwritten note,
cookbook page, or plated dish, extract as much recipe information as you can and return ONLY a JSON object.
If multiple images are provided they may show different sides or sections of the same recipe — combine them into one complete result.

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
- If no recipe is visible, return {"error": "no recipe found"}."""


SUPPORTED_FORMATS = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}

# Bedrock hard limit is ~2.8 MB raw per image. Stay comfortably under it.
MAX_BYTES = 2_500_000
MAX_DIMENSION = 1568  # Claude's recommended max for vision quality


def get_image_format(path: Path) -> str:
    ext = path.suffix.lstrip(".").lower()
    fmt = SUPPORTED_FORMATS.get(ext)
    if not fmt:
        sys.exit(f"Unsupported image format: {ext!r}. Supported: {', '.join(SUPPORTED_FORMATS)}")
    return fmt


def prepare_image(path: Path) -> tuple[bytes, str]:
    """Return (bytes, bedrock_format), resizing and converting to JPEG if needed."""
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow not found — install it first:\n  pip install Pillow")

    with Image.open(path) as img:
        # Convert palette/transparency modes so JPEG save works
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Downscale if either dimension exceeds the max
        w, h = img.size
        if w > MAX_DIMENSION or h > MAX_DIMENSION:
            img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)
            print(f"[info]   resized {w}×{h} → {img.size[0]}×{img.size[1]}", file=sys.stderr)

        # Encode as JPEG, reducing quality until under the byte limit
        for quality in (85, 75, 60, 45):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if len(data) <= MAX_BYTES:
                return data, "jpeg"

        sys.exit(f"Could not compress {path.name} under {MAX_BYTES // 1024}KB even at minimum quality.")


def extract_recipe(image_paths: list[str], model: str = DEFAULT_MODEL) -> dict:
    try:
        import boto3
    except ImportError:
        sys.exit("boto3 not found — install it first:\n  pip install boto3")

    import os
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")

    paths = []
    for p in image_paths:
        path = Path(p).expanduser()
        if not path.exists():
            sys.exit(f"File not found: {p}")
        paths.append(path)

    content = []
    for path in paths:
        raw_kb = path.stat().st_size // 1024
        print(f"[info] Preparing {path.name} ({raw_kb}KB)...", file=sys.stderr)
        image_bytes, image_format = prepare_image(path)
        print(f"[info]   → {image_format}, {len(image_bytes) // 1024}KB after compression", file=sys.stderr)
        content.append({"image": {"format": image_format, "source": {"bytes": image_bytes}}})

    noun = "these images" if len(paths) > 1 else "this image"
    content.append({"text": f"Extract the recipe from {noun}."})

    print(f"[info] Sending {len(paths)} image(s) to {model}...", file=sys.stderr)

    client = boto3.client("bedrock-runtime", region_name=region)

    try:
        response = client.converse(
            modelId=model,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": content}],
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

    parser = argparse.ArgumentParser(description="Extract a recipe from one or more image files via AWS Bedrock.")
    parser.add_argument("images", nargs="+", metavar="IMAGE", help="Path(s) to image file(s)")
    parser.add_argument("--model", default=DEFAULT_MODEL, metavar="MODEL_ID", help="Bedrock model ID")
    args = parser.parse_args()

    result = extract_recipe(args.images, model=args.model)
    print(json.dumps(result, indent=2))
