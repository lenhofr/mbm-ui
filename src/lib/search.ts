// Recipe search: Fuse.js full-text plus scoped `tag:` and `ing:` tokens.
import Fuse from 'fuse.js'
import type { Recipe } from '../types'

type Rec = Recipe & { ingredientsText: string; instructionsText: string }

export function buildIndex(recipes: Recipe[]) {
  const records: Rec[] = recipes.map(r => ({
    ...r,
    ingredientsText: (r.ingredients || []).map(i => `${i.amount ?? ''} ${i.name}`).join('\n'),
    instructionsText: (r.instructions || []).join('\n'),
  }))
  const fuse = new Fuse<Rec>(records, {
    keys: ['title', 'description', 'tags', 'ingredientsText', 'instructionsText'],
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
    } else {
      res = fuse.search(token).map(x => x.item)
    }
    return new Set(res.map(r => r.id))
  })
  return sets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))))
}

/** Tags across all recipes, lowercased, most used first. */
export function topTags(recipes: Recipe[], limit = 8): string[] {
  const counts = new Map<string, number>()
  recipes.forEach(r => new Set((r.tags || []).map(t => t.toLowerCase())).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)))
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([t]) => t)
}

export function relativeTime(ts?: number): string {
  if (!ts) return ''
  const days = Math.round((Date.now() - ts * 1000) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
