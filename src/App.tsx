import React, { useMemo, useState, useEffect } from 'react'
import RecipeList from './components/RecipeList'
import RecipeForm from './components/RecipeForm'
import DetailsModal from './components/DetailsModal'
import ConfirmDialog from './components/ConfirmDialog'
import CookModal from './components/CookModal'
import Fuse from 'fuse.js'
import { storage } from './lib/storage'
import { isAuthenticated, login, logout } from './lib/auth'

export type Recipe = {
  id: string
  title: string
  description?: string
  image?: string
  tags?: string[]
  ingredients?: { name: string; amount?: string }[]
  servings?: string
  instructions?: string[]
}

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([])

  // Load initial recipes from storage on mount
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const items = await storage.listRecipes()
        if (mounted && items && items.length) setRecipes(items)
        // If storage is empty, we could seed with defaults; keep empty for now
      } catch (e) {
        // ignore and leave recipes empty
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function addRecipe(r: Omit<Recipe, 'id'>) {
    const created = await storage.createRecipe(r)
    setRecipes(s => [created, ...s])
  }

  const [editing, setEditing] = useState<Recipe | null>(null)

  async function updateRecipe(r: Omit<Recipe, 'id'>, id?: string) {
    if (!id) return
    try {
      const updated = await storage.updateRecipe(id, r)
      setRecipes(s => s.map(item => (item.id === id ? updated : item)))
      setEditing(null)
    } catch (e) {
      // handle error (e.g., show toast). For now, ignore
    }
  }

  function startEdit(recipe: Recipe) {
    setEditing(recipe)
  }

  const [viewing, setViewing] = useState<Recipe | null>(null)

  function startView(recipe: Recipe) {
    setViewing(recipe)
  }

  const [deleting, setDeleting] = useState<Recipe | null>(null)

  function requestDelete(recipe: Recipe) {
    setDeleting(recipe)
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await storage.deleteRecipe(deleting.id)
      setRecipes(s => s.filter(r => r.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      // ignore for now
    }
  }

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0)

  // debounce the query for performance (200ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  // all unique tags
  const allTags = useMemo(() => Array.from(new Set(recipes.flatMap(r => r.tags || []))), [recipes])

  // focus shortcut: Ctrl/Cmd+K to focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const el = document.getElementById('recipe-search') as HTMLInputElement | null
        el?.focus()
        el?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const q = debouncedQuery
    // If no query and no tag filters, short-circuit
    if (!q && selectedTags.length === 0) return recipes

    type Rec = Recipe & { ingredientsText: string; instructionsText: string }
    const records: Rec[] = recipes.map(r => ({
      ...r,
      ingredientsText: (r.ingredients || []).map(i => `${i.amount ?? ''} ${i.name}`).join('\n'),
      instructionsText: (r.instructions || []).join('\n'),
    }))

    // Build a small Fuse index
    const fuse = new Fuse<Rec>(records, {
      keys: [
        'title',
        'description',
        'tags',
        'ingredientsText',
        'instructionsText',
      ],
      includeMatches: true,
      threshold: 0.4,
      ignoreLocation: true,
    })

    // parse tokens (support tag: and ing:)
  const tokens = (q || '').match(/(-?\w+:"[^"]+"|-?\w+:\S+|"[^"]+"|\S+)/g)?.map(t => t.replace(/^"|"$/g, '')) || []

    // For each token, run Fuse scoped appropriately and collect ids
    let resultSets: Array<Set<string>> = []
    if (tokens.length === 0) {
      // if only tag filters
      resultSets = [new Set(records.map(r => r.id))]
    } else {
      tokens.forEach(token => {
        const m = token.match(/^(\w+):(.*)$/)
        let res: any[] = []
        if (m) {
          const field = m[1].toLowerCase()
          const val = m[2]
          if (field === 'tag' || field === 't') {
            res = records.filter(r => (r.tags || []).some((tg: string) => tg.toLowerCase().includes(val.toLowerCase())))
          } else if (field === 'ing' || field === 'ingredient') {
            res = records.filter(r => r.ingredientsText.toLowerCase().includes(val.toLowerCase()))
          } else {
            // fallback to global
            res = fuse.search(token).map(x => x.item)
          }
        } else {
          res = fuse.search(token).map(x => x.item)
        }
        resultSets.push(new Set(res.map((r: any) => r.id)))
      })
    }

    // intersect result sets
    const intersection = resultSets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))), resultSets[0] || new Set())
    let result = recipes.filter(r => intersection.has(r.id))

    // apply selected tag filters (AND semantics)
    if (selectedTags.length) {
      result = result.filter(r => selectedTags.every(t => (r.tags || []).includes(t)))
    }

    return result
  }, [recipes, debouncedQuery, selectedTags])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Meals by Maggie</h1>
        <p className="subtitle">A cozy place to collect your favorite recipes</p>
        <div style={{ position: 'absolute', right: 20, top: 20 }}>
          {isAuthenticated() ? (
            <button className="btn-ghost" onClick={() => logout()}>Log out</button>
          ) : (
            <button className="btn-ghost" onClick={() => login()}>Log in</button>
          )}
        </div>
      </header>

      {/* Search bar placed under the tagline */}
  <div style={{maxWidth:1040, margin:'0 auto 16px', padding:'0 20px'}}>
        <label style={{display:'block', marginBottom:8, color:'var(--muted)'}} htmlFor="recipe-search">Search recipes</label>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{position:'relative',flex:1}}>
            <input
              id="recipe-search"
              className="search-input"
              placeholder="Search by title, tag, ingredient or instruction..."
              value={query}
              onChange={(e) => {
                const v = e.target.value
                setQuery(v)
                // show tag suggestions if user typed tag:<partial>
                const m = v.match(/tag:(\S*)$/)
                if (m) {
                  setShowTagSuggestions(true)
                  setTagSuggestionIndex(0)
                } else {
                  setShowTagSuggestions(false)
                }
              }}
              onKeyDown={(e) => {
                if (!showTagSuggestions) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setTagSuggestionIndex(i => Math.min(i+1, Math.max(0, allTags.length-1))) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setTagSuggestionIndex(i => Math.max(i-1, 0)) }
                if (e.key === 'Enter') {
                  const matches = query.match(/tag:(\S*)$/)
                  if (matches) {
                    const partial = matches[1]
                    const candidate = allTags.filter(t => t.toLowerCase().includes(partial.toLowerCase()))[tagSuggestionIndex]
                    if (candidate) {
                      setQuery(q => q.replace(/tag:\S*$/, `tag:${candidate} `))
                    }
                    setShowTagSuggestions(false)
                    e.preventDefault()
                  }
                }
                if (e.key === 'Escape') setShowTagSuggestions(false)
              }}
              aria-label="Search recipes"
            />
            {query && (
              <button aria-label="Clear search" className="search-clear" onClick={() => setQuery('')}>×</button>
            )}

            {showTagSuggestions && (
              <div className="tag-suggestions" role="listbox">
                {allTags.filter(t => {
                  const m = query.match(/tag:(\S*)$/)
                  if (!m) return true
                  const partial = m[1].toLowerCase()
                  return t.toLowerCase().includes(partial)
                }).map((t, idx) => (
                  <div key={t} role="option" aria-selected={idx === tagSuggestionIndex} className={`tag-suggestion ${idx === tagSuggestionIndex ? 'active' : ''}`} onMouseDown={() => {
                    setQuery(q => q.replace(/tag:\S*$/, `tag:${t} `))
                    setShowTagSuggestions(false)
                  }}>{t}</div>
                ))}
              </div>
            )}
          </div>
        </div>
  </div>

  <main>
        <section className="left">
          <RecipeForm onAdd={addRecipe} />
        </section>
        <section className="right">
          <RecipeList
            recipes={filtered}
            onEdit={isAuthenticated() ? startEdit : undefined}
            onDelete={isAuthenticated() ? requestDelete : undefined}
            onView={startView}
            query={debouncedQuery}
          />
        </section>
      </main>

      {editing && (
  <DetailsModal visible={true} onClose={() => setEditing(null)} onSave={updateRecipe} initialRecipe={editing} onCook={startView} />
      )}

      <ConfirmDialog visible={!!deleting} title="Delete recipe" message={`Delete "${deleting?.title}"?`} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />

  {viewing && <CookModal visible={!!viewing} onClose={() => setViewing(null)} recipe={viewing} />}

      <footer className="app-footer">Built with ❤️ — local UI scaffold</footer>
    </div>
  )
}
