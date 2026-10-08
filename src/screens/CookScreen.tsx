import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, useRecipe } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton } from '../components/ui'
import { useWakeLock } from '../hooks/useWakeLock'
import { parseServings } from '../lib/quantity'
import IngredientChecklist, { toggleIn } from '../components/IngredientChecklist'
import type { Recipe } from '../types'
import './CookScreen.css'

export default function CookScreen() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  const app = useApp()
  if (!recipe) return app.loading ? <div className="screen" /> : <Navigate to="/" replace />
  if (!recipe.instructions?.length) return <Navigate to={`/recipe/${encodeURIComponent(recipe.id)}`} replace />
  return <Cook r={recipe} />
}

type Progress = { ingredients: number[]; steps: number[] }

/** Checked ingredients + done steps survive an accidental close for this browser session. */
function loadProgress(id: string): Progress | null {
  try {
    const raw = window.sessionStorage.getItem(`mbm:cook:${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProgress(id: string, p: Progress) {
  try { window.sessionStorage.setItem(`mbm:cook:${id}`, JSON.stringify(p)) } catch {}
}

function Cook({ r }: { r: Recipe }) {
  const navigate = useNavigate()
  const location = useLocation()
  const nav = location.state as { mult?: number; fromDetail?: boolean } | null
  const mult = nav?.mult ?? 1
  const steps = r.instructions || []
  const ingredients = r.ingredients || []
  const base = parseServings(r.servings)
  const saved = useRef(loadProgress(r.id))
  const [checked, setChecked] = useState<Set<number>>(() => new Set(saved.current?.ingredients))
  const [doneSteps, setDoneSteps] = useState<Set<number>>(() => new Set(saved.current?.steps))
  const [finished, setFinished] = useState(false)
  const wake = useWakeLock(!finished)

  useEffect(() => {
    saveProgress(r.id, { ingredients: [...checked], steps: [...doneSteps] })
  }, [r.id, checked, doneSteps])

  // Opened from the recipe page: go back to it rather than pushing a second copy onto history.
  const exit = () => (nav?.fromDetail ? navigate(-1) : navigate(`/recipe/${encodeURIComponent(r.id)}`, { replace: true }))

  const finish = () => {
    try { window.sessionStorage.removeItem(`mbm:cook:${r.id}`) } catch {}
    setFinished(true)
  }
  const startOver = () => {
    setChecked(new Set())
    setDoneSteps(new Set())
    setFinished(false)
  }

  if (finished) {
    return (
      <div className="screen cook rise">
        <div className="cook-done">
          <div className="done-ring"><Icon name="check" size={40} weight="bold" /></div>
          <h1>Nice work</h1>
          <p>Enjoy your {r.title}.</p>
          <button type="button" className="btn primary block lg" onClick={exit}>Back to recipe</button>
          <button type="button" className="btn ghost block" onClick={startOver}>Start over</button>
        </div>
      </div>
    )
  }

  const current = steps.findIndex((_, i) => !doneSteps.has(i))
  const serves = base ? Math.round(base * mult) : undefined
  const meta = [r.cookTime, serves && `serves ${serves}`].filter(Boolean).join(' · ')

  return (
    <div className="screen cook rise">
      <header className="cook-head">
        <GlassButton icon="close" onClick={exit} label="Exit cook mode" />
        <div className="cook-count" aria-live="polite">{doneSteps.size} of {steps.length} steps done</div>
        <div className={'awake' + (wake.isActive ? ' on' : '')} title={wake.isSupported ? undefined : 'Not supported on this device'}>
          <Icon name="sun" size={15} weight="bold" />Screen on
        </div>
      </header>

      <div className="cook-main">
      <div className="cook-scroll">
        <h1 className="cook-title">{r.title}</h1>
        {(meta || mult !== 1) && (
          <div className="cook-meta">{meta}{mult !== 1 && <em> · scaled</em>}</div>
        )}

        {ingredients.length > 0 && (
          <>
            <div className="sec-label">Ingredients</div>
            <IngredientChecklist ingredients={ingredients} checked={checked} onToggle={i => setChecked(c => toggleIn(c, i))} mult={mult} large />
          </>
        )}

        <div className="sec-label">Steps<span className="sec-hint">tap a step when it’s done</span></div>
        <div className="cook-steps">
          {steps.map((text, i) => {
            const done = doneSteps.has(i)
            const toggle = () => setDoneSteps(d => toggleIn(d, i))
            return (
              <div
                key={i}
                className={'step-card' + (done ? ' done' : '') + (i === current ? ' current' : '')}
                role="button"
                tabIndex={0}
                aria-pressed={done}
                aria-label={`Step ${i + 1}${done ? ', done' : ''}`}
                onClick={toggle}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } }}
              >
                <span className="step-badge" aria-hidden>{done ? <Icon name="check" size={16} weight="bold" /> : i + 1}</span>
                <div className="step-body">
                  <p>{text}</p>
                </div>
              </div>
            )
          })}
        </div>

        <button type="button" className="btn primary block lg cook-finish" onClick={finish}>Finish</button>
        <div style={{ height: 'calc(20px + var(--safe-b))' }} />
      </div>
      </div>
    </div>
  )
}
