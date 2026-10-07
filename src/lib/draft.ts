// Conversions between persisted recipes, AI extract results and the editor draft.
import type { Draft, DraftRow, DraftSource, Flag, Recipe, RecipeInput } from '../types'
import { ingredientText, parseIngredientLine, parseServings } from './quantity'

export const DEFAULT_SERVINGS = 4

export function blankDraft(): Draft {
  return { source: 'manual', title: '', description: '', cookTime: '', servings: DEFAULT_SERVINGS, tags: [], ingredients: [{ text: '' }], steps: [{ text: '' }] }
}

export function draftFromRecipe(r: Recipe): Draft {
  return {
    source: 'edit',
    id: r.id,
    title: r.title,
    description: r.description || '',
    cookTime: r.cookTime || '',
    servings: parseServings(r.servings) ?? DEFAULT_SERVINGS,
    image: r.image,
    tags: (r.tags || []).map(t => ({ t })),
    ingredients: (r.ingredients || []).map(i => ({ text: ingredientText(i) })),
    steps: (r.instructions || []).map(text => ({ text })),
  }
}

export function normalizeTag(t: string) {
  return t.trim().toLowerCase()
}

/** Build the persisted recipe. `image` must already be the stored key/URL (uploads happen first). */
export function recipeFromDraft(d: Draft, image: string | undefined): RecipeInput {
  const tags = Array.from(new Set(d.tags.map(t => normalizeTag(t.t)).filter(Boolean)))
  const ingredients = d.ingredients.map(i => i.text.trim()).filter(Boolean).map(parseIngredientLine)
  const instructions = d.steps.map(s => s.text.trim()).filter(Boolean)
  return {
    title: d.title.trim(),
    description: d.description.trim() || undefined,
    cookTime: d.cookTime.trim() || undefined,
    servings: String(d.servings),
    image: image || undefined,
    tags: tags.length ? tags : undefined,
    ingredients: ingredients.length ? ingredients : undefined,
    instructions: instructions.length ? instructions : undefined,
  }
}

function isFlag(f: unknown): f is Flag {
  const x = f as Flag
  return !!x && typeof x.q === 'string' && Array.isArray(x.opts) && x.opts.every(o => Array.isArray(o) && o.length === 2)
}

type ExtractIngredient = { name?: string; amount?: string; text?: string; flag?: unknown }
type ExtractStep = string | { text?: string; flag?: unknown }

/** Shape returned by POST /ai/extract-recipe. Flag fields are optional and only present when the model is unsure. */
export type ExtractResult = {
  title?: string
  description?: string
  tags?: string[]
  ingredients?: ExtractIngredient[]
  instructions?: ExtractStep[]
  servings?: string | number
  cookTime?: string
  readable?: boolean
  error?: string
}

export function draftFromExtract(res: ExtractResult, source: DraftSource, sourceLabel?: string, originals?: string[]): Draft {
  const ingredients: DraftRow[] = (res.ingredients || []).map(i => {
    const text = i.text || [i.amount, i.name].filter(Boolean).join(' ')
    return isFlag(i.flag) ? { text, flag: i.flag } : { text }
  })
  const steps: DraftRow[] = (res.instructions || []).map(s => {
    if (typeof s === 'string') return { text: s }
    return isFlag(s.flag) ? { text: s.text || '', flag: s.flag } : { text: s.text || '' }
  })
  return {
    source,
    sourceLabel,
    originals,
    title: res.title || '',
    description: res.description || '',
    cookTime: res.cookTime || '',
    servings: parseServings(String(res.servings ?? '')) ?? DEFAULT_SERVINGS,
    tags: Array.from(new Set((res.tags || []).map(normalizeTag).filter(Boolean))).map(t => ({ t, ai: true })),
    ingredients: ingredients.length ? ingredients : [{ text: '' }],
    steps: steps.length ? steps : [{ text: '' }],
  }
}
