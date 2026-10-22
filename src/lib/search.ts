// Recipe search: Fuse.js full-text plus scoped `tag:`, `ing:` and `chef:` tokens.
// Ported to iOS in RecipeSearch.swift; keep the two in step (its tests use results from here).
import Fuse from 'fuse.js'
import type { Recipe } from '../types'
import { recipeTags } from './tags'

type Rec = Recipe & { ingredientsText: string; instructionsText: string; chef: string }

/** The kitchen nickname of whoever added the recipe; old records say "user", which isn't one. */
function chefName(r: Recipe): string {
  const n = (r.createdByName || '').trim()
  return n.toLowerCase() === 'user' ? '' : n
}

export function buildIndex(recipes: Recipe[]) {
  const records: Rec[] = recipes.map(r => ({
    ...r,
    // With alias main tags added, so "crockpot" also finds the "slow cooker" recipes (tags.ts).
    tags: recipeTags(r),
    ingredientsText: (r.ingredients || []).map(i => `${i.amount ?? ''} ${i.name}`).join('\n'),
    instructionsText: (r.instructions || []).join('\n'),
    chef: chefName(r),
  }))
  const fuse = new Fuse<Rec>(records, {
    // chef: who added it ("By Nana" on the recipe page), so "mike" finds Chef Mike's recipes.
    keys: ['title', 'description', 'tags', 'ingredientsText', 'instructionsText', 'chef'],
    threshold: 0.2,
    ignoreLocation: true,
  })
  return { records, fuse }
}

export function searchRecipes(index: ReturnType<typeof buildIndex>, query: string): Set<string> {
  const { records, fuse } = index
  const tokens = query.match(/(-?\w+:"[^"]+"|-?\w+:\S+|"[^"]+"|\S+)/g)?.map(t => t.replace(/"/g, '')) || []
  if (!tokens.length) return new Set(records.map(r => r.id))
  const sets = tokens.map(token => {
    const m = token.match(/^(\w+):(.*)$/)
    let res: Rec[]
    if (m && (m[1] === 'tag' || m[1] === 't')) {
      const v = m[2].toLowerCase()
      res = records.filter(r => (r.tags || []).some(t => t.toLowerCase().includes(v)))
    } else if (m && (m[1] === 'ing' || m[1] === 'ingredient')) {
      const v = m[2].toLowerCase()
      res = records.filter(r => r.ingredientsText.toLowerCase().includes(v))
    } else if (m && (m[1] === 'chef' || m[1] === 'by')) {
      const v = m[2].toLowerCase()
      res = records.filter(r => r.chef.toLowerCase().includes(v))
    } else {
      res = fuse.search(token).map(x => x.item)
    }
    return new Set(res.map(r => r.id))
  })
  return sets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))))
}

export function relativeTime(ts?: number): string {
  if (!ts) return ''
  const days = Math.round((Date.now() - ts * 1000) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
