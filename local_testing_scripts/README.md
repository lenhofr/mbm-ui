# local_testing_scripts

Scripts for testing recipe extraction via AWS Bedrock before wiring it into the app.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Export AWS credentials with access to Bedrock in your target region:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

---

## extract_from_image.py

Sends one or more local image files to Claude via Bedrock and returns a recipe JSON.

### Single image (one-sided card)

```bash
python extract_from_image.py lasagna.jpg
```

### Two images (front + back of a recipe card)

```bash
python extract_from_image.py card_front.jpg card_back.jpg
```

Claude receives both images in a single call and merges them into one complete recipe. Useful when the title/ingredients are on the front and the instructions are on the back.

### More than two images

```bash
python extract_from_image.py page1.png page2.png page3.png
```

### Override the model

```bash
python extract_from_image.py card_front.jpg card_back.jpg --model us.anthropic.claude-haiku-4-5
```

Default model: `us.anthropic.claude-sonnet-4-6` (~$0.01–0.02/call).  
Budget option: `us.anthropic.claude-haiku-4-5` (~10× cheaper, slightly lower quality).

### Image size handling

Bedrock has a ~2.8 MB per-image limit. The script automatically:
- Resizes images wider/taller than 1568px (Claude's recommended max)
- Converts to JPEG and reduces quality in steps until under the limit

Large phone photos (10–15 MB PNGs) are handled transparently.

### Supported input formats

`jpg`, `jpeg`, `png`, `gif`, `webp`

### Output

Prints a JSON object to stdout matching the mbm-ui Recipe schema:

```json
{
  "title": "Grandma's Lasagna",
  "description": "Classic layered lasagna with ricotta and meat sauce.",
  "tags": ["italian", "pasta", "comfort food"],
  "ingredients": [
    {"name": "lasagna noodles", "amount": "12"},
    {"name": "ricotta cheese", "amount": "2 cups"}
  ],
  "servings": "8",
  "cookTime": "1 hour 15 minutes",
  "instructions": [
    "Preheat oven to 375°F.",
    "Cook noodles according to package directions.",
    "..."
  ]
}
```

Progress/debug info is written to stderr so you can pipe stdout cleanly:

```bash
python extract_from_image.py front.jpg back.jpg > recipe.json
```

---

## extract_from_url.py

Fetches a recipe webpage, strips the HTML, and sends the text to Claude.

```bash
python extract_from_url.py https://example.com/some-recipe
```

Override the model:

```bash
python extract_from_url.py https://example.com/some-recipe --model us.anthropic.claude-haiku-4-5
```

Output format is the same JSON schema as above.
