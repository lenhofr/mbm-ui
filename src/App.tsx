import React, { useMemo, useState, useEffect } from 'react'
import RecipeList from './components/RecipeList'
import DetailsModal from './components/DetailsModal'
import ConfirmDialog from './components/ConfirmDialog'
import CookModal from './components/CookModal'
import Hero from './components/Hero'
import Fuse from 'fuse.js'
import { storage } from './lib/storage'
import LoginModal from './components/LoginModal'
import { IconSignIn, IconSignOut, IconPlus } from './icons/Icons'
import { useCognitoAuth } from './hooks/useCognitoAuth'
import InstallPrompt from './components/InstallPrompt'
import CompleteProfile from './components/CompleteProfile'

export type Recipe = {
  id: string
  title: string
  description?: string
  image?: string
  tags?: string[]
  ingredients?: { name: string; amount?: string }[]
  servings?: string
  cookTime?: string
  instructions?: string[]
}

export default function App() {
  const auth = useCognitoAuth()
  const authed = auth.isAuthed
  const displayName = ((): string | undefined => {
    try {
      // nickname should be present in ID token payload after update
      const token = (auth as any).idToken as string | undefined
      if (!token) return undefined
      const payload = JSON.parse(atob(token.split('.')[1] || ''))
      return payload?.nickname as string | undefined
    } catch { return undefined }
  })()
  const [showLogin, setShowLogin] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
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

  // Prompt to complete profile if signed in and no display name
  useEffect(() => {
    if (authed && !displayName) {
      setShowProfile(true)
    } else {
      setShowProfile(false)
    }
  }, [authed, displayName])

  async function addRecipe(r: Omit<Recipe, 'id'>) {
    const created = await storage.createRecipe({
      ...r,
      // capture attribution locally for now (remote API can also stamp server-side)
      tags: r.tags,
      description: r.description,
      title: r.title,
    })
    setRecipes(s => [created, ...s])
  }

  const [editing, setEditing] = useState<Recipe | null>(null)

  async function updateRecipe(r: Omit<Recipe, 'id'>, id?: string) {
    if (!id) return
    try {
      const updated = await storage.updateRecipe(id, {
        ...r,
      })
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

  const [showAddModal, setShowAddModal] = useState(false)

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

  // Precompute records and Fuse index based on recipes for better mobile perf
  type Rec = Recipe & { ingredientsText: string; instructionsText: string }
  const records = useMemo<Rec[]>(
    () =>
      recipes.map(r => ({
        ...r,
        ingredientsText: (r.ingredients || []).map(i => `${i.amount ?? ''} ${i.name}`).join('\n'),
        instructionsText: (r.instructions || []).join('\n'),
      })),
    [recipes]
  )

  const fuse = useMemo(
    () =>
      new Fuse<Rec>(records, {
        keys: ['title', 'description', 'tags', 'ingredientsText', 'instructionsText'],
        includeMatches: true,
        threshold: 0.2,
        ignoreLocation: true,
      }),
    [records]
  )

  const filtered = useMemo(() => {
    const q = debouncedQuery
    // If no query and no tag filters, short-circuit
    if (!q && selectedTags.length === 0) return recipes

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
      <Hero
        onAdd={authed && recipes.length === 0 ? () => setShowAddModal(true) : undefined}
      />

  <InstallPrompt />

  {/* Search bar placed under the hero */}
  <div style={{maxWidth:1040, margin:'0 auto 16px', padding:'0 20px'}}>
        <label style={{display:'block', marginBottom:8, color:'var(--muted)'}} htmlFor="recipe-search">Recipe Collection</label>
        <div style={{display:'flex',gap:12,alignItems:'center', flexWrap:'wrap'}}>
          <div style={{position:'relative',flex:1, minWidth:0}}>
            <span className="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            <input
              id="recipe-search"
              className="search-input"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
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
                  <div
                    key={t}
                    role="option"
                    aria-selected={idx === tagSuggestionIndex}
                    className={`tag-suggestion ${idx === tagSuggestionIndex ? 'active' : ''}`}
                    onPointerDown={() => {
                      setQuery(q => q.replace(/tag:\S*$/, `tag:${t} `))
                      setShowTagSuggestions(false)
                    }}
                  >{t}</div>
                ))}
              </div>
            )}
          </div>

          {/* Inline New Recipe button */}
                    {/* Inline New Recipe button */}
          <div style={{ display: 'flex', gap: 12 }}>
            {authed && (
              <button type="button" className="primary" onClick={() => setShowAddModal(true)}>
                <span aria-hidden style={{display:'inline-flex',alignItems:'center',marginRight:8}}>
                  <IconPlus size={18} weight="regular" />
                </span>
                New Recipe
              </button>
            )}
            {authed ? null : (
              <button className="auth-cta" onClick={() => setShowLogin(true)} aria-label="Log in">
                <span className="auth-icon" aria-hidden><IconSignIn size={18} weight="regular" /></span>
              </button>
            )}
          </div>

        </div>
  </div>
      {/* Complete profile prompt when missing nickname */}
      <CompleteProfile
        visible={!!showProfile}
        onClose={() => setShowProfile(false)}
        onSaved={() => {
          // refresh auth to get updated ID token with nickname
          auth.refresh()
        }}
      />

  <main>
        <section className="right" style={{width:'100%'}}>
          <RecipeList
            recipes={filtered}
            onEdit={authed ? startEdit : undefined}
            onDelete={authed ? requestDelete : undefined}
            onView={startView}
            query={debouncedQuery}
            authed={authed}
            onLogin={() => setShowLogin(true)}
          />
        </section>
      </main>

    {editing && (
  <DetailsModal visible={true} onClose={() => setEditing(null)} onSave={updateRecipe} initialRecipe={editing} onCook={startView} onLogin={() => setShowLogin(true)} />
    )}

      {showAddModal && (
        <DetailsModal
          visible={true}
          onClose={() => setShowAddModal(false)}
          onSave={(r) => { addRecipe(r); setShowAddModal(false) }}
          initialRecipe={{ title: '', description: '' }}
          onLogin={() => setShowLogin(true)}
        />
      )}

      <ConfirmDialog visible={!!deleting} title="Delete recipe" message={`Delete "${deleting?.title}"?`} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />

  {viewing && (
        <CookModal
          visible={!!viewing}
          onClose={() => setViewing(null)}
          recipe={viewing}
      onEdit={authed ? (r) => { setEditing(r); setViewing(null) } : undefined}
        />
      )}

    {showLogin && !authed ? (
      <LoginModal visible={true} onClose={() => setShowLogin(false)} />
    ) : null}

  <footer className="app-footer">
    <span>Built with ❤️ — RobWare</span>
    {authed && (
      <>
        <span aria-hidden>{' '}·{' '}</span>
        <button className="footer-link" onClick={() => auth.signOut()} aria-label="Log out">Logout</button>
      </>
    )}
  </footer>
    </div>
  )
}
