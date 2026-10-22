// Tag clean-up for the Home filter chips and `tag:` search. Recipes keep the tags they were
// saved with; an alias only adds its main tag, so a "slow cooker" recipe also counts as
// "crockpot" and a "vegan" one as "vegetarian". Ported to iOS in Tags.swift (keep in step;
// its tests use results from here).
import type { Recipe } from '../types'

/** Other spellings and narrower words → the tag they also count as. Keys are lowercase. */
export const TAG_ALIASES: Record<string, string> = {
  'slow cooker': 'crockpot',
  'slow-cooker': 'crockpot',
  'crock pot': 'crockpot',
  'crock-pot': 'crockpot',
  'easy': 'quick & easy',
  'quick': 'quick & easy',
  'weeknight dinner': 'dinner',
  'appetizers': 'appetizer',
  'finger food': 'appetizer',
  'desserts': 'dessert',
  'vegan': 'vegetarian',
  'keto': 'low carb',
  'low-carb': 'low carb',
}

/**
 * The Home chip row, in this order: a fixed list (not "most used") so each chip always
 * means the same thing. A chip only shows when some recipe has it.
 */
export const CHIP_TAGS = ['dinner', 'chicken', 'crockpot', 'quick & easy', 'pasta', 'vegetarian', 'appetizer', 'dessert']

/** A recipe's tags, lowercased, plus the main tag of any alias among them. */
export function recipeTags(r: Recipe): string[] {
  const out: string[] = []
  for (const t of r.tags || []) {
    const tag = t.trim().toLowerCase()
    for (const x of [tag, TAG_ALIASES[tag]]) if (x && !out.includes(x)) out.push(x)
  }
  return out
}

/** The chips to show for these recipes ('all' is added by the screen). */
export function chipTags(recipes: Recipe[]): string[] {
  const present = new Set(recipes.flatMap(recipeTags))
  return CHIP_TAGS.filter(t => present.has(t))
}

/** Tags across all recipes, lowercased, most used first. */
export function topTags(recipes: Recipe[], limit = 8): string[] {
  const counts = new Map<string, number>()
  recipes.forEach(r => new Set((r.tags || []).map(t => t.trim().toLowerCase())).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)))
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([t]) => t)
}

/**
 * Tags sent to the AI importer so new recipes reuse the box's words: the chip tags as main
 * tags, then the most-used others. Alias spellings are left out so it says "crockpot",
 * not "slow cooker". The Lambda accepts up to 30 in all.
 */
export function importerTags(recipes: Recipe[]): { mainTags: string[]; knownTags: string[] } {
  const others = topTags(recipes, Infinity).filter(t => !TAG_ALIASES[t] && !CHIP_TAGS.includes(t))
  return { mainTags: CHIP_TAGS, knownTags: others.slice(0, 30 - CHIP_TAGS.length) }
}
