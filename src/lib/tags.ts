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
