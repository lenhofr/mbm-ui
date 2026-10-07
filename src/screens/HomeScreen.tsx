import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { RecipeThumb } from '../components/ui'
import Sheet from '../components/ui/Sheet'
import CookSpinner from '../components/CookSpinner'
import { buildIndex, searchRecipes, topTags } from '../lib/search'
import type { Recipe } from '../types'
import './HomeScreen.css'

type Layout = 'grid' | 'list'
const LAYOUT_KEY = 'mbm:layout'

function readLayout(): Layout {
  try { return window.localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

function meta(r: Recipe) {
  return [r.cookTime, r.tags?.[0]?.toLowerCase()].filter(Boolean).join(' · ')
}

export default function HomeScreen({ favoritesOnly }: { favoritesOnly?: boolean }) {
  const app = useApp()
  const { recipes, favorites, toggleFavorite, loading, loadError } = app
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tag, setTag] = useState('all')
  const [layout, setLayout] = useState<Layout>(readLayout)
  const [account, setAccount] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  const index = useMemo(() => buildIndex(recipes), [recipes])
  const tags = useMemo(() => ['all', ...topTags(recipes)], [recipes])

  const list = useMemo(() => {
    const hits = debounced ? searchRecipes(index, debounced) : null
    return recipes.filter(r =>
      (!favoritesOnly || favorites.has(r.id)) &&
      (tag === 'all' || (r.tags || []).some(t => t.toLowerCase() === tag)) &&
      (!hits || hits.has(r.id)))
  }, [recipes, index, debounced, tag, favoritesOnly, favorites])

  function toggleLayout() {
    const next = layout === 'grid' ? 'list' : 'grid'
    setLayout(next)
    try { window.localStorage.setItem(LAYOUT_KEY, next) } catch {}
  }

  const open = (r: Recipe) => navigate(`/recipe/${encodeURIComponent(r.id)}`)
  const initial = (app.displayName || app.auth.user?.email || '?').charAt(0).toUpperCase()

  return (
    <div className="screen home">
      <div className="scroll">
        <header className="home-head">
          {favoritesOnly ? <h1 className="h-title">Favorites</h1> : <h1 className="logo">Meals by Maggie</h1>}
          {app.auth.isAuthed ? (
            <button type="button" className="avatar" onClick={() => setAccount(true)} aria-label="Account">{initial}</button>
          ) : (
            <button type="button" className="avatar" onClick={() => app.setShowLogin(true)} aria-label="Log in">
              <Icon name="signin" size={20} />
            </button>
          )}
        </header>

        <label className="search">
          <Icon name="search" size={19} />
          <span className="sr-only">Search recipes</span>
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title, tag or ingredient"
          />
          {query && (
            <button type="button" className="search-x" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="close" size={14} weight="bold" />
            </button>
          )}
        </label>

        {tags.length > 1 && (
          <div className="chips-row" role="group" aria-label="Filter by tag">
            {tags.map(t => (
              <button key={t} type="button" className={'chip' + (tag === t ? ' on' : '')} aria-pressed={tag === t} onClick={() => setTag(t)}>
                {t === 'all' ? 'All' : t}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="home-loading"><CookSpinner size={40} /><p>Simmering…</p></div>
        ) : loadError ? (
          <div className="empty" role="alert">
            <p>{loadError}</p>
            <button type="button" className="btn soft" onClick={app.reload}>Try again</button>
          </div>
        ) : (
          <>
            <div className="count-row">
              <span className="count">{list.length} {list.length === 1 ? 'recipe' : 'recipes'}</span>
              <button type="button" className="layout-btn" onClick={toggleLayout} aria-label={layout === 'grid' ? 'Show as list' : 'Show as grid'}>
                <Icon name={layout === 'grid' ? 'list' : 'grid'} size={20} />
              </button>
            </div>
            {list.length === 0 ? (
              <div className="empty">
                <p>
                  {favoritesOnly && !debounced && tag === 'all'
                    ? 'Tap the heart on a recipe to keep it here.'
                    : `Nothing matches${query.trim() ? ` “${query.trim()}”` : ''}.`}
                </p>
                {!favoritesOnly && (
                  <button type="button" className="btn primary" onClick={() => app.requireLogin() && app.setSheet('add')}>
                    <Icon name="plus" size={18} weight="bold" />Add a recipe
                  </button>
                )}
              </div>
            ) : layout === 'list' ? (
              <div className="rlist">
                {list.map(r => (
                  <button type="button" key={r.id} className="rrow" onClick={() => open(r)}>
                    <RecipeThumb title={r.title} image={r.image} className="sq" />
                    <div className="rrow-body">
                      <div className="rtitle">{r.title}</div>
                      {r.description && <div className="rdesc">{r.description}</div>}
                      <div className="rmeta">{meta(r)}</div>
                    </div>
                    {favorites.has(r.id) && <Icon name="heart" size={16} filled color="var(--pink)" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rgrid">
                {list.map(r => (
                  <div key={r.id} className="rcard">
                    <div className="rcard-img">
                      <button type="button" className="rcard-open" onClick={() => open(r)} aria-label={r.title}>
                        <RecipeThumb title={r.title} image={r.image} />
                      </button>
                      <button
                        type="button"
                        className={'fav-dot' + (favorites.has(r.id) ? ' on' : '')}
                        onClick={() => toggleFavorite(r.id)}
                        aria-label={favorites.has(r.id) ? 'Remove from favorites' : 'Add to favorites'}
                        aria-pressed={favorites.has(r.id)}
                      >
                        <Icon name="heart" size={16} filled={favorites.has(r.id)} weight="bold" />
                      </button>
                    </div>
                    <div className="rtitle" onClick={() => open(r)}>{r.title}</div>
                    <div className="rmeta">{meta(r)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="tabbar-spacer" />
      </div>

      <Sheet open={account} onClose={() => setAccount(false)} label="Account">
        <h2 className="sheet-title">{app.displayName ? `Hi ${app.displayName}!` : 'Your account'}</h2>
        {app.auth.user?.email && <p className="sheet-sub">{app.auth.user.email}</p>}
        <button type="button" className="btn soft block" onClick={() => { setAccount(false); app.auth.signOut() }}>
          <Icon name="signout" size={18} />Log out
        </button>
      </Sheet>
    </div>
  )
}
