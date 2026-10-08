// Quick tips: short, bundled answers to common cooking questions. Shipped with the SPA
// (works offline via the service worker), visible signed in or out.
//
// Content is verbatim from the design prototype (proto/tips.jsx, design update 002).
// Food-safety numbers follow the USDA FSIS Safe Minimum Internal Temperature Chart
// (checked 2026-10-07). Times are typical ranges; Maggie should give them a once-over.

export type TipCategory = 'Eggs & poultry' | 'Vegetables' | 'Meat & fish' | 'Temps & conversions'

export interface QuickTip {
  id: string
  category: TipCategory
  title: string
  text?: string
  rows?: [string, string][]
  note?: string
  keywords: string[]
}

/** Display order of the sheet's groups. */
export const TIP_CATEGORIES: TipCategory[] = ['Eggs & poultry', 'Vegetables', 'Meat & fish', 'Temps & conversions']

export const TIPS: QuickTip[] = [
  { id: 'eggs', category: 'Eggs & poultry', title: 'Boiled eggs', text: 'Lower cold eggs into boiling water, then keep it at a gentle boil. Straight into an ice bath after.', rows: [['Soft', '6 min'], ['Jammy', '7 min'], ['Hard', '10–12 min']], keywords: ['egg', 'eggs', 'hard boiled', 'soft boiled', 'jammy'] },
  { id: 'poach-chicken', category: 'Eggs & poultry', title: 'Boiled / poached chicken', text: 'Cover with cold salted water, bring to a simmer, then keep it gentle. Done at 165°F in the thickest part.', rows: [['Breasts', '12–15 min'], ['Boneless thighs', '15–20 min']], keywords: ['chicken', 'breast', 'thigh', 'poach', 'boil', 'shredded'] },
  { id: 'roast-veg', category: 'Vegetables', title: 'Roasted vegetables', text: '425°F. Toss with oil and salt, spread in one layer, flip halfway.', rows: [['Broccoli florets', '15–20 min'], ['Brussels sprouts, halved', '20–25 min'], ['Carrots, 1" pieces', '25–30 min'], ['Squash, 1" cubes', '25–35 min'], ['Potatoes, 1" cubes', '30–40 min']], keywords: ['vegetables', 'veg', 'carrot', 'carrots', 'broccoli', 'brussels', 'sprouts', 'potato', 'potatoes', 'squash', 'roast', 'oven'] },
  { id: 'baked-potato', category: 'Vegetables', title: 'Baked potatoes', text: 'Russets, scrubbed and poked with a fork, rubbed with oil and salt. 400°F right on the rack for 50–60 min, until a knife slides in easily.', keywords: ['potato', 'potatoes', 'baked', 'russet', 'jacket'] },
  { id: 'boiled-carrots', category: 'Vegetables', title: 'Boiled baby carrots', text: 'Into salted boiling water, then simmer until a fork slides in. Drain and toss with butter and salt.', rows: [['Crisp-tender', '6–8 min'], ['Tender', '10–12 min']], keywords: ['carrot', 'carrots', 'baby carrots', 'boiled carrots'] },
  { id: 'corn', category: 'Vegetables', title: 'Corn on the cob', text: 'Shuck, drop into a big pot of boiling water, and cover. Done when the kernels are bright and tender.', rows: [['Fresh', '3–5 min'], ['Frozen cobs', '5–8 min']], keywords: ['corn', 'cob', 'corn on the cob', 'sweet corn'] },
  { id: 'fish', category: 'Meat & fish', title: 'Salmon & white fish', text: '400°F for 12–15 min per inch of thickness. Done at 145°F, or when it flakes easily with a fork.', keywords: ['fish', 'salmon', 'cod', 'tilapia', 'halibut', 'fillet', 'bake'] },
  { id: 'bacon', category: 'Meat & fish', title: 'Oven bacon', text: '400°F on a foil-lined sheet pan, no flipping. 15–20 min regular, 20–25 min thick-cut.', keywords: ['bacon', 'oven', 'sheet pan'] },
  { id: 'steak', category: 'Meat & fish', title: 'Steak doneness', text: 'Final temp after resting. Pull it off about 5°F early.', rows: [['Rare', '125°F'], ['Medium-rare', '130–135°F'], ['Medium', '140–145°F'], ['Medium-well', '150–155°F'], ['Well done', '160°F']], note: 'USDA safe minimum: 145°F with a 3-minute rest.', keywords: ['steak', 'beef', 'doneness', 'medium rare', 'rare', 'temp'] },
  { id: 'safe-temps', category: 'Temps & conversions', title: 'Safe internal temps', text: 'Measure at the thickest part with a food thermometer.', rows: [['Poultry, any cut or ground', '165°F'], ['Ground beef, pork, lamb', '160°F'], ['Steaks, chops, roasts', '145°F + 3 min rest'], ['Fish & shellfish', '145°F'], ['Egg dishes', '160°F'], ['Leftovers & casseroles', '165°F']], note: 'Source: USDA FSIS', keywords: ['safe', 'temperature', 'temp', 'internal', 'chicken', 'pork', 'beef', 'fish', 'ground', 'usda', 'done'] },
  { id: 'conversions', category: 'Temps & conversions', title: 'Common conversions', rows: [['3 tsp', '1 tbsp'], ['16 tbsp', '1 cup'], ['1 cup', '8 fl oz'], ['1 oz', '28 g'], ['1 lb', '454 g'], ['350°F', '≈ 175°C'], ['400°F', '≈ 200°C'], ['425°F', '≈ 220°C']], keywords: ['convert', 'conversion', 'tsp', 'tbsp', 'cup', 'oz', 'gram', 'grams', 'celsius', 'fahrenheit', 'measure'] },
]

/**
 * `q` is trimmed + lowercased. Matches title or keyword substrings; for queries over
 * 3 characters, also when the query contains a keyword ("boiled eggs" → "eggs").
 */
export function matchTip(tip: QuickTip, q: string): boolean {
  if (!q) return true
  if (tip.title.toLowerCase().includes(q)) return true
  return tip.keywords.some(k => k.includes(q) || (q.length > 3 && q.includes(k)))
}

export function searchTips(q: string): QuickTip[] {
  const query = q.trim().toLowerCase()
  return TIPS.filter(t => matchTip(t, query))
}
