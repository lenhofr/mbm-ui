import base64
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'recipes'))
import ai_extract  # noqa: E402


class FakeBedrock:
    """Records the converse() call and answers with a fixed tool input."""

    def __init__(self, tool_input):
        self.tool_input = tool_input
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {'output': {'message': {'content': [{'toolUse': {'name': 'save_recipe', 'input': self.tool_input}}]}}}


SCAN = {
    'readable': True,
    'title': "Gram's Cornbread",
    'servings': 9,
    'cookTime': '35 min',
    'tags': ['Bread', 'side', 'bread'],
    'ingredients': [
        {'text': '1 cup cornmeal'},
        {'text': '1 tbsp baking powder', 'flag': {'q': 'Smudged. tbsp or tsp?', 'opts': [['1 tbsp baking powder', 'tbsp'], ['1 tsp baking powder', 'tsp']]}},
        {'text': '2 eggs', 'flag': {'q': 'Incoherent', 'opts': [['3 eggs', '3'], ['4 eggs', '4']]}},
        {'text': '1 cup milk', 'flag': {'q': 'One option', 'opts': [['1 cup milk', 'milk']]}},
        {'text': '   '},
    ],
    'instructions': [{'text': '1. Mix the dry ingredients.'}, {'text': 'Bake at 425°F for 25 minutes.'}],
}


def test_normalize_keeps_valid_flags_and_drops_bad_ones():
    out = ai_extract.normalize(SCAN)
    assert out['readable'] is True
    assert out['tags'] == ['bread', 'side']
    assert [i['text'] for i in out['ingredients']] == ['1 cup cornmeal', '1 tbsp baking powder', '2 eggs', '1 cup milk']
    assert out['ingredients'][1]['flag']['opts'] == [['1 tbsp baking powder', 'tbsp'], ['1 tsp baking powder', 'tsp']]
    assert 'flag' not in out['ingredients'][2]  # text isn't one of the options
    assert 'flag' not in out['ingredients'][3]  # fewer than 2 options
    assert out['instructions'][0]['text'] == 'Mix the dry ingredients.'
    assert out['servings'] == 9


def test_normalize_unreadable():
    assert ai_extract.normalize({'readable': False, 'title': 'x'}) == {'readable': False}
    assert ai_extract.normalize({'readable': True, 'title': '', 'ingredients': [], 'instructions': []}) == {'readable': False}
    assert ai_extract.normalize('nope') == {'readable': False}


def test_images_forces_tool_and_passes_known_tags():
    bedrock = FakeBedrock(SCAN)
    img = {'data': base64.b64encode(b'fake').decode(), 'mediaType': 'image/jpg'}
    out = ai_extract.extract_from_images(bedrock, 'model', [img, img], known_tags=['dinner', 'dessert'])
    call = bedrock.calls[0]
    assert call['toolConfig']['toolChoice'] == {'tool': {'name': 'save_recipe'}}
    content = call['messages'][0]['content']
    assert content[0]['image']['format'] == 'jpeg'
    assert 'front and back' in content[2]['text']
    assert 'dinner, dessert' in content[3]['text']
    assert out['title'] == "Gram's Cornbread"


def test_images_rejects_bad_input():
    with pytest.raises(ai_extract.ExtractError):
        ai_extract.extract_from_images(FakeBedrock(SCAN), 'm', [])
    with pytest.raises(ai_extract.ExtractError):
        ai_extract.extract_from_images(FakeBedrock(SCAN), 'm', [{'data': 'x', 'mediaType': 'image/tiff'}])


LD_PAGE = """<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
 {"@type":["Recipe"],"name":"Crispy Potato Galette","description":"Thin potatoes baked crisp. Great with eggs.",
  "recipeYield":["4","4 servings"],"totalTime":"PT1H5M","recipeCategory":"Side Dish","keywords":"potatoes, make-ahead",
  "recipeIngredient":["2 lb Yukon Gold potatoes","4 tbsp butter, melted"],
  "recipeInstructions":[{"@type":"HowToSection","name":"Prep","itemListElement":[{"@type":"HowToStep","text":"Heat oven to 425°F."}]},
                        {"@type":"HowToStep","text":"Bake 45 minutes."}]}]}
</script></head><body><p>My life story...</p></body></html>"""


def test_url_prefers_json_ld_without_calling_model():
    bedrock = FakeBedrock(SCAN)
    out = ai_extract.extract_from_url(bedrock, 'm', 'https://example.com/x', fetch=lambda u: LD_PAGE)
    assert bedrock.calls == []
    assert out['title'] == 'Crispy Potato Galette'
    assert out['description'] == 'Thin potatoes baked crisp'
    assert out['servings'] == 4
    assert out['cookTime'] == '1 hr 5 min'
    assert out['tags'] == ['side dish', 'potatoes', 'make-ahead']
    assert [s['text'] for s in out['instructions']] == ['Heat oven to 425°F.', 'Bake 45 minutes.']


def test_url_falls_back_to_model_with_page_text():
    bedrock = FakeBedrock(SCAN)
    page = '<html><body><nav>Menu</nav><h1>Cornbread</h1><p>1 cup cornmeal</p><script>var x=1</script></body></html>'
    ai_extract.extract_from_url(bedrock, 'm', 'https://example.com/x', fetch=lambda u: page)
    text = bedrock.calls[0]['messages'][0]['content'][0]['text']
    assert 'Cornbread' in text and '1 cup cornmeal' in text
    assert 'Menu' not in text and 'var x' not in text


def test_url_rejects_non_http():
    with pytest.raises(ai_extract.ExtractError):
        ai_extract.extract_from_url(FakeBedrock(SCAN), 'm', 'file:///etc/passwd')


def test_iso_duration():
    assert ai_extract.iso_duration('PT45M') == '45 min'
    assert ai_extract.iso_duration('PT90M') == '1 hr 30 min'
    assert ai_extract.iso_duration('') == ''


def test_handler_routes_extract(monkeypatch):
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'recipes'))
    import app
    monkeypatch.setattr(app, 'get_bedrock', lambda: FakeBedrock(SCAN))
    event = {
        'requestContext': {'http': {'method': 'POST'}, 'routeKey': 'POST /ai/extract-recipe'},
        'rawPath': '/ai/extract-recipe',
        'body': json.dumps({'type': 'text', 'text': 'Cornbread: 1 cup cornmeal...', 'knownTags': ['dinner']}),
    }
    res = app.handler(event, None)
    assert res['statusCode'] == 200
    assert json.loads(res['body'])['ingredients'][1]['flag']['q'] == 'Smudged. tbsp or tsp?'

    event['body'] = json.dumps({'type': 'image', 'images': []})
    assert app.handler(event, None)['statusCode'] == 400
