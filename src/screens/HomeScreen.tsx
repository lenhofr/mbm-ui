import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { RecipeThumb } from '../components/ui'
import Sheet from '../components/ui/Sheet'
import QuickView from '../components/QuickView'
import CookSpinner from '../components/CookSpinner'
import { buildIndex, searchRecipes, topTags } from '../lib/search'
import type { Recipe } from '../types'
import './HomeScreen.css'

const LONG_PRESS_MS = 450

function RecipeCard({ r, fav, onOpen, onQuickView, onToggleFav }: {
  r: Recipe
  fav: boolean
  onOpen: () => void
  onQuickView: () => void
  onToggleFav: () => void
}) {
  const [pressing, setPressing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const count = r.ingredients?.length ?? 0

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
    setPressing(false)
  }
  useEffect(() => cancel, [])
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div
      className={'rcard' + (pressing ? ' pressing' : '')}
      onPointerDown={e => {
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        setPressing(true)
        timer.current = setTimeout(() => {
          fired.current = true
          timer.current = null
          setPressing(false)
          onQuickView()
        }, LONG_PRESS_MS)
      }}
      onPointerMove={e => {
        // A finger drifting more than a few px is a scroll, not a press.
        const s0 = start.current
        if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) cancel()
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
      onClickCapture={e => {
        // Swallow the click that follows a long-press so it doesn't navigate.
        if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false }
      }}
    >
      <div className="rcard-img">
        <button type="button" className="rcard-open" onClick={onOpen} aria-label={r.title}>
          <RecipeThumb title={r.title} image={r.image} />
        </button>
        <button
          type="button"
          className={'fav-dot' + (fav ? ' on' : '')}
          onPointerDown={stop}
          onClick={onToggleFav}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={fav}
        >
          <Icon name="heart" size={16} filled={fav} weight="bold" />
        </button>
      </div>
      <div className="rtitle" onClick={onOpen}>{r.title}</div>
      <div className="rmeta">
        {r.cookTime}
        {r.cookTime && count > 0 && ' · '}
        {count > 0 && (
          <button
            type="button"
            className="ing-link"
            onPointerDown={stop}
            onClick={e => { e.stopPropagation(); onQuickView() }}
          >
            {count} {count === 1 ? 'ingredient' : 'ingredients'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function HomeScreen({ favoritesOnly }: { favoritesOnly?: boolean }) {
  const app = useApp()
  const { recipes, favorites, toggleFavorite, loading, loadError } = app
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tag, setTag] = useState('all')
  const [account, setAccount] = useState(false)
  const [quick, setQuick] = useState<Recipe | null>(null)

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
            <div className="count">{list.length} {list.length === 1 ? 'recipe' : 'recipes'}</div>
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
            ) : (
              <div className="rgrid">
                {list.map(r => (
                  <RecipeCard
                    key={r.id}
                    r={r}
                    fav={favorites.has(r.id)}
                    onOpen={() => open(r)}
                    onQuickView={() => setQuick(r)}
                    onToggleFav={() => toggleFavorite(r.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
        <div className="tabbar-spacer" />
      </div>

      <QuickView recipe={quick} onClose={() => setQuick(null)} />

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
