// Quantity parsing, formatting and scaling for ingredient strings.

const UNICODE_FRACS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}
const DISPLAY_FRACS: [number, string][] = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']]

export type Qty = { q: number | null; rest: string }

/**
 * Split a leading quantity off a string: "2 1/4 cups flour" → {q: 2.25, rest: "cups flour"}.
 * Handles whole numbers, decimals, simple fractions, mixed numbers and unicode fractions.
 * A range like "4-6" or "9 to 11" keeps only the first number as q.
 */
export function splitQty(input: string): Qty {
  const s = input.trim()
  // mixed "2 1/4" | fraction "1/2" | number with optional unicode fraction "1½" | unicode "½"
  const m = s.match(/^(?:(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞])?|([¼½¾⅓⅔⅛⅜⅝⅞]))/)
  if (!m) return { q: null, rest: s }
  let q: number
  if (m[1]) q = Number(m[1]) + Number(m[2]) / Number(m[3])
  else if (m[4]) q = Number(m[4]) / Number(m[5])
  else if (m[6]) q = Number(m[6]) + (m[7] ? UNICODE_FRACS[m[7]] : 0)
  else q = UNICODE_FRACS[m[8]]
  if (!isFinite(q) || q === 0) return { q: null, rest: s }
  let rest = s.slice(m[0].length).trim()
  // Drop the upper end of a range ("-6", "to 11") so it doesn't read as part of the unit.
  rest = rest.replace(/^(?:-|–|to)\s*\d+(?:\.\d+)?(?:\/\d+)?\s*/i, '')
  return { q, rest }
}

export function formatQty(n: number): string {
  const whole = Math.floor(n + 0.01)
  const rem = n - whole
  if (rem < 0.06) return String(whole)
  let best = DISPLAY_FRACS[0]
  let d = Infinity
  for (const f of DISPLAY_FRACS) {
    const dd = Math.abs(f[0] - rem)
    if (dd < d) { d = dd; best = f }
  }
  if (d > 0.06) return String(Math.round(n * 10) / 10)
  return (whole ? String(whole) : '') + best[1]
}

/** Scale an amount string like "1 1/2 cups" by mult. Non-numeric amounts are returned unchanged. */
export function scaleAmount(amount: string | undefined, mult: number): string {
  if (!amount) return ''
  if (mult === 1) return amount
  const { q, rest } = splitQty(amount)
  if (q == null) return amount
  return [formatQty(q * mult), rest].filter(Boolean).join(' ')
}

export function ingredientText(ing: { name: string; amount?: string }, mult = 1): string {
  return [scaleAmount(ing.amount, mult), ing.name].filter(Boolean).join(' ')
}

const UNITS = /^(cups?|c\.|tbsps?|tbs|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|cans?|packets?|pkgs?|packages?|sticks?|cloves?|pinch(?:es)?|dash(?:es)?|quarts?|qts?|pints?|pts?|slices?|sprigs?|bunch(?:es)?|large|medium|small)\b\.?/i

/**
 * Parse a free-text ingredient line into the persisted {amount, name} shape.
 * "2 1/4 cups all-purpose flour" → {amount: "2 1/4 cups", name: "all-purpose flour"}.
 */
export function parseIngredientLine(line: string): { name: string; amount?: string } {
  const s = line.trim()
  const { q, rest } = splitQty(s)
  if (q == null) return { name: s }
  const qtyPart = s.slice(0, s.length - rest.length).trim()
  const um = rest.match(UNITS)
  // Size words ("large eggs") read better as part of the name.
  if (um && !/^(large|medium|small)$/i.test(um[1])) {
    const unit = um[0]
    return { amount: `${qtyPart} ${unit}`.trim(), name: rest.slice(unit.length).trim() || rest }
  }
  return { amount: qtyPart, name: rest || s }
}

/** First number of minutes mentioned in a step, e.g. "Bake 9 to 11 minutes" → 9, "1 hour" → 60. */
export function detectTimerMinutes(text: string): number | undefined {
  const min = text.match(/(\d+)\s*(?:(?:-|–|to)\s*\d+\s*)?(?:minutes?|mins?)\b/i)
  if (min) return Number(min[1])
  const hr = text.match(/(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*\d+\s*)?(?:hours?|hrs?)\b/i)
  if (hr) return Math.round(Number(hr[1]) * 60)
  return undefined
}

/** Leading integer of a servings string ("4-6" → 4). */
export function parseServings(s: string | undefined): number | undefined {
  const m = (s || '').match(/\d+/)
  const n = m ? Number(m[0]) : NaN
  return n > 0 ? n : undefined
}

const STOP = new Set(['and', 'the', 'for', 'with', 'into', 'large', 'small', 'medium', 'fresh', 'chopped', 'diced', 'sliced', 'softened', 'melted', 'packed', 'ground', 'cup', 'cups'])

function keyword(name: string): string | undefined {
  const core = name.replace(/\([^)]*\)/g, ' ').split(',')[0]
  const words = core.toLowerCase().match(/[a-zà-ÿ]+/g)?.filter(w => w.length > 2 && !STOP.has(w)) || []
  return words[words.length - 1]
}

/** Indexes of ingredients whose main noun appears in a step's text (cook-mode "You'll need"). */
export function ingredientsUsedInStep(step: string, ingredients: { name: string }[]): number[] {
  const text = step.toLowerCase()
  const out: number[] = []
  ingredients.forEach((ing, i) => {
    const k = keyword(ing.name)
    if (!k) return
    const stem = k.replace(/(es|s)$/, '')
    if (stem.length > 2 && new RegExp(`\\b${stem}`, 'i').test(text)) out.push(i)
  })
  return out
}
