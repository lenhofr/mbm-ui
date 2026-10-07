// Quick tips: short, bundled answers to common cooking questions. Shipped with the SPA
// (works offline via the service worker), visible signed in or out.
//
// TODO(content): these 12 tips are DRAFTS written from the original starter list in
// docs/quick-tips.md, because proto/tips.jsx from design update 002 wasn't available.
// Replace them with the prototype's TIPS verbatim, and have Maggie check every time/temp.
// The "Safe internal temps" values follow the USDA FSIS Safe Minimum Internal Temperature
// Chart as listed in the spec (checked 2026-10-07).

export type TipCategory = 'Eggs & poultry' | 'Vegetables' | 'Grains & pasta' | 'Meat & fish' | 'Temps & conversions'

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
export const TIP_CATEGORIES: TipCategory[] = ['Eggs & poultry', 'Vegetables', 'Grains & pasta', 'Meat & fish', 'Temps & conversions']

export const TIPS: QuickTip[] = [
  {
    id: 'boiled-eggs',
    category: 'Eggs & poultry',
    title: 'Boiled eggs',
    text: 'Lower cold eggs into boiling water, then move them to an ice bath for 2 minutes.',
    rows: [['Soft (runny yolk)', '6 min'], ['Jammy', '7 min'], ['Medium', '9 min'], ['Hard', '11–12 min']],
    keywords: ['egg', 'eggs', 'boiled', 'hard boiled', 'soft boiled', 'jammy'],
  },
  {
    id: 'poached-chicken',
    category: 'Eggs & poultry',
    title: 'Boiled or poached chicken',
    text: 'Cover with cold salted water or broth, bring to a gentle simmer, and cook until done.',
    rows: [['Boneless breasts', '12–15 min'], ['Boneless thighs', '15–20 min'], ['Bone-in pieces', '25–30 min']],
    note: 'Done at 165°F in the thickest part.',
    keywords: ['chicken', 'poached', 'boiled chicken', 'shredded chicken', 'breast', 'thighs', 'poultry'],
  },
  {
    id: 'roast-chicken',
    category: 'Eggs & poultry',
    title: 'Roast chicken',
    rows: [['Whole (about 4 lb), 425°F', '60–75 min'], ['Bone-in thighs or legs, 425°F', '35–45 min'], ['Boneless breasts, 400°F', '20–25 min']],
    note: '165°F in the thickest part. Rest 10 minutes before carving.',
    keywords: ['chicken', 'roast', 'roasted', 'whole chicken', 'thighs', 'legs', 'breast', 'oven', 'poultry'],
  },
  {
    id: 'roasted-vegetables',
    category: 'Vegetables',
    title: 'Roasted vegetables',
    text: '425°F. Toss with oil and salt, spread in a single layer, and flip halfway.',
    rows: [['Carrots', '25–30 min'], ['Potatoes, 1-inch cubes', '30–40 min'], ['Broccoli', '15–20 min'], ['Brussels sprouts, halved', '20–25 min'], ['Butternut squash, cubed', '25–35 min']],
    keywords: ['vegetables', 'roasted', 'roast', 'carrots', 'potatoes', 'broccoli', 'brussels', 'sprouts', 'squash'],
  },
  {
    id: 'baked-potatoes',
    category: 'Vegetables',
    title: 'Baked potatoes',
    text: 'Prick russets with a fork, rub with oil and salt, and bake right on the rack at 425°F for 45–60 minutes, until a knife slides in easily.',
    keywords: ['potato', 'potatoes', 'baked potato', 'russet', 'jacket'],
  },
  {
    id: 'rice-grains',
    category: 'Grains & pasta',
    title: 'Rice & grains',
    rows: [['White rice, 1 : 1½', '18 min'], ['Jasmine or basmati, 1 : 1¼', '15 min'], ['Brown rice, 1 : 2', '40–45 min'], ['Quinoa, 1 : 2', '15 min']],
    note: 'Grain : water. Simmer covered, then rest 5–10 minutes off the heat before fluffing.',
    keywords: ['rice', 'grains', 'quinoa', 'brown rice', 'white rice', 'jasmine', 'basmati', 'ratio'],
  },
  {
    id: 'pasta',
    category: 'Grains & pasta',
    title: 'Pasta',
    text: 'Use a big pot of well-salted water (about 1 Tbsp salt per 4 quarts). Start tasting 2 minutes before the box time, and save a cup of pasta water before draining.',
    keywords: ['pasta', 'spaghetti', 'noodles', 'penne', 'macaroni', 'al dente'],
  },
  {
    id: 'steak-doneness',
    category: 'Meat & fish',
    title: 'Steak doneness',
    rows: [['Rare', '125°F'], ['Medium-rare', '130–135°F'], ['Medium', '140–145°F'], ['Medium-well', '150°F'], ['Well done', '160°F']],
    note: 'Pull it about 5°F early; it keeps rising while it rests. These are for taste: the USDA safe minimum for steaks is 145°F plus a 3-minute rest.',
    keywords: ['steak', 'beef', 'doneness', 'rare', 'medium rare', 'medium', 'well done', 'temp', 'temperature'],
  },
  {
    id: 'fish-fillets',
    category: 'Meat & fish',
    title: 'Salmon & white fish',
    text: 'Bake at 400°F until it flakes easily with a fork: about 12–15 minutes for 1-inch salmon fillets, 10–12 minutes for thinner white fish like cod or tilapia.',
    note: 'Safe at 145°F.',
    keywords: ['salmon', 'fish', 'cod', 'tilapia', 'halibut', 'fillet', 'baked fish', 'seafood'],
  },
  {
    id: 'oven-bacon',
    category: 'Meat & fish',
    title: 'Oven bacon',
    text: 'Lay strips on a foil-lined sheet pan and bake at 400°F for 15–20 minutes, until crisp. Thick-cut takes a few minutes longer.',
    keywords: ['bacon', 'oven bacon', 'crispy', 'breakfast'],
  },
  {
    id: 'safe-temps',
    category: 'Temps & conversions',
    title: 'Safe internal temps',
    rows: [
      ['All poultry', '165°F'],
      ['Ground beef, pork, lamb', '160°F'],
      ['Beef, pork, lamb steaks, chops, roasts', '145°F + 3 min rest'],
      ['Fish & shellfish', '145°F'],
      ['Egg dishes', '160°F'],
      ['Leftovers & casseroles', '165°F'],
    ],
    note: 'USDA FSIS safe minimum internal temperatures. Check the thickest part with a thermometer.',
    keywords: ['temp', 'temps', 'temperature', 'safe', 'internal', 'done', 'thermometer', 'chicken', 'poultry', 'pork', 'beef', 'ground', 'fish', 'leftovers'],
  },
  {
    id: 'conversions',
    category: 'Temps & conversions',
    title: 'Common conversions',
    rows: [
      ['3 tsp', '1 Tbsp'],
      ['16 Tbsp', '1 cup'],
      ['1 cup', '8 fl oz'],
      ['1 oz', '28 g'],
      ['1 lb', '454 g'],
      ['350°F', '175°C'],
      ['400°F', '200°C'],
      ['425°F', '220°C'],
    ],
    keywords: ['convert', 'conversion', 'conversions', 'tsp', 'tbsp', 'teaspoon', 'tablespoon', 'cup', 'ounce', 'ounces', 'grams', 'celsius', 'fahrenheit', 'measure'],
  },
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
