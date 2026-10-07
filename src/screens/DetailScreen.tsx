import React, { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, useRecipe } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton, RecipeThumb, Stepper } from '../components/ui'
import { parseServings } from '../lib/quantity'
import IngredientChecklist, { toggleIn } from '../components/IngredientChecklist'
import { relativeTime } from '../lib/search'
import { DEFAULT_SERVINGS } from '../lib/draft'
import type { Recipe } from '../types'
import './DetailScreen.css'

function byline(r: Recipe, currentUserSub?: string, currentUserName?: string) {
  const name = (n?: string, sub?: string) => {
    if (n && n.toLowerCase() !== 'user') return n
    if (currentUserSub && sub === currentUserSub) return currentUserName
    return undefined
  }
  const by = name(r.createdByName, r.createdBySub)
  const when = r.updatedAt && r.updatedAt !== r.createdAt ? `updated ${relativeTime(r.updatedAt)}` : r.createdAt ? `added ${relativeTime(r.createdAt)}` : ''
  return [by && `By ${by}`, when].filter(Boolean).join(' · ')
}

export default function DetailScreen() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  const app = useApp()
  if (!recipe) return app.loading ? <div className="screen" /> : <Navigate to="/" replace />
  return <Detail key={recipe.id} r={recipe} />
}

function Detail({ r }: { r: Recipe }) {
  const app = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const base = parseServings(r.servings)
  const [servings, setServings] = useState(base ?? DEFAULT_SERVINGS)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const mult = base ? servings / base : 1
  const fav = app.favorites.has(r.id)
  const by = byline(r, app.userSub, app.displayName)
  const ingredients = r.ingredients || []
  const steps = r.instructions || []

  return (
    <div className="screen detail enter">
      <div className="scroll">
        <div className="d-hero"><RecipeThumb title={r.title} image={r.image} /></div>
        <div className="d-body">
          <h1 className="d-title">{r.title}</h1>
          {r.description && <p className="d-desc">{r.description}</p>}
          {by && <div className="d-by">{by}</div>}
          {!!r.tags?.length && <div className="d-tags">{r.tags.map(t => <span key={t} className="chip on">{t.toLowerCase()}</span>)}</div>}

          <div className="d-meta">
            <div className="meta-cell">
              <Icon name="clock" size={20} />
              <div><small>Time</small><b>{r.cookTime || '—'}</b></div>
            </div>
            <div className="meta-cell">
              <Icon name="people" size={20} />
              <div>
                <small>Servings{mult !== 1 && <em> · scaled</em>}</small>
                {base ? <Stepper small value={servings} onChange={setServings} label="Servings" /> : <b>{r.servings || '—'}</b>}
              </div>
            </div>
          </div>

          {ingredients.length > 0 && (
            <>
              <h2 className="d-h2">Ingredients</h2>
              <IngredientChecklist ingredients={ingredients} checked={checked} onToggle={i => setChecked(c => toggleIn(c, i))} mult={mult} />
            </>
          )}

          {steps.length > 0 && (
            <>
              <h2 className="d-h2">Instructions</h2>
              <ol className="step-list">
                {steps.map((s, i) => <li key={i}><span className="step-n">{i + 1}</span><p>{s}</p></li>)}
              </ol>
            </>
          )}
          <div style={{ height: steps.length ? 120 : 40 }} />
        </div>
      </div>

      <div className="hero-btns">
        <GlassButton icon="back" onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/'))} label="Back" />
        <div className="hero-btns-right">
          <GlassButton icon="heart" filled={fav} active={fav} onClick={() => app.toggleFavorite(r.id)} label={fav ? 'Remove from favorites' : 'Add to favorites'} />
          {app.auth.isAuthed && <GlassButton icon="pencil" onClick={() => navigate(`/recipe/${encodeURIComponent(r.id)}/edit`, { state: { fromDetail: true } })} label="Edit recipe" />}
        </div>
      </div>

      {steps.length > 0 && (
        <div className="bottom-cta">
          <button type="button" className="btn primary block lg" onClick={() => navigate(`/recipe/${encodeURIComponent(r.id)}/cook`, { state: { mult, fromDetail: true } })}>
            <Icon name="play" size={18} filled />Start cooking
          </button>
        </div>
      )}
    </div>
  )
}
