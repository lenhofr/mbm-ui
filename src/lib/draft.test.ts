import { describe, it, expect } from 'vitest'
import { draftFromExtract, draftFromRecipe, recipeFromDraft } from './draft'

describe('draft conversions', () => {
  it('round-trips a recipe and lowercases tags on save', () => {
    const d = draftFromRecipe({
      id: 'r1', title: 'Chili', servings: '8', tags: ['Dinner', 'dinner', 'Packable'],
      ingredients: [{ amount: '2 lb', name: 'ground beef' }, { name: 'salt' }],
      instructions: ['Brown beef.', ''],
    })
    expect(d.source).toBe('edit')
    expect(d.ingredients.map(i => i.text)).toEqual(['2 lb ground beef', 'salt'])
    const out = recipeFromDraft(d, 'images/x.jpg')
    expect(out.tags).toEqual(['dinner', 'packable'])
    expect(out.ingredients).toEqual([{ amount: '2 lb', name: 'ground beef' }, { name: 'salt' }])
    expect(out.instructions).toEqual(['Brown beef.'])
    expect(out.servings).toBe('8')
    expect(out.image).toBe('images/x.jpg')
  })

  it('maps an extract result, marking tags as AI-suggested and keeping valid flags', () => {
    const flag = { q: 'tbsp or tsp?', opts: [['1 tbsp baking powder', 'tbsp'], ['1 tsp baking powder', 'tsp']] }
    const d = draftFromExtract({
      title: "Gram's Cornbread", servings: '9', tags: ['Bread'],
      ingredients: [{ amount: '1 cup', name: 'cornmeal' }, { text: '1 tbsp baking powder', flag }, { name: 'eggs', flag: { bogus: true } }],
      instructions: ['Mix.', { text: 'Bake 25 minutes.' }],
    }, 'scan')
    expect(d.tags).toEqual([{ t: 'bread', ai: true }])
    expect(d.servings).toBe(9)
    expect(d.ingredients[0]).toEqual({ text: '1 cup cornmeal' })
    expect(d.ingredients[1].flag).toEqual(flag)
    expect(d.ingredients[2].flag).toBeUndefined()
    expect(d.steps.map(s => s.text)).toEqual(['Mix.', 'Bake 25 minutes.'])
  })
})
