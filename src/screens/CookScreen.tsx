import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, useRecipe } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton } from '../components/ui'
import { useWakeLock } from '../hooks/useWakeLock'
import { detectTimerMinutes, parseServings } from '../lib/quantity'
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

type TimerState = { step: number; endAt: number | null; pausedLeft: number }

function fmtClock(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(sec).padStart(2, '0')
}

function fmtDuration(min: number) {
  return min >= 60 ? `${Math.round(min / 6) / 10} hr` : `${min} min`
}

// iOS only lets audio start from a user tap, so the context is created/resumed when
// the timer is started and reused when it rings. iOS has no Vibration API.
let audioCtx: AudioContext | null = null

function unlockAudio() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = audioCtx || new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  } catch {}
}

function chime() {
  try { navigator.vibrate?.([300, 150, 300, 150, 300]) } catch {}
  const ctx = audioCtx
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') ctx.resume()
    ;[0, 0.35, 0.7].forEach(t => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.32)
    })
  } catch {}
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

/** Distance from the top of the scroll area to leave above a step brought into view (clears the timer pill). */
const SCROLL_OFFSET = 56

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
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [, setTick] = useState(0)
  const chimed = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  const wake = useWakeLock(!finished)

  const left = timer ? (timer.endAt ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)) : timer.pausedLeft) : 0
  const running = !!timer?.endAt && left > 0

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick(x => x + 1), 250)
    return () => clearInterval(t)
  }, [running])

  useEffect(() => {
    if (timer && left === 0 && !chimed.current) { chimed.current = true; chime() }
  }, [timer, left])

  useEffect(() => {
    saveProgress(r.id, { ingredients: [...checked], steps: [...doneSteps] })
  }, [r.id, checked, doneSteps])

  // Opened from the recipe page: go back to it rather than pushing a second copy onto history.
  const exit = () => (nav?.fromDetail ? navigate(-1) : navigate(`/recipe/${encodeURIComponent(r.id)}`, { replace: true }))

  const startTimer = (step: number, minutes: number) => {
    unlockAudio()
    chimed.current = false
    setTimer({ step, endAt: Date.now() + minutes * 60000, pausedLeft: minutes * 60 })
  }
  const togglePause = () => {
    if (!timer) return
    unlockAudio()
    setTimer(timer.endAt ? { ...timer, endAt: null, pausedLeft: left } : { ...timer, endAt: Date.now() + timer.pausedLeft * 1000 })
  }
  const scrollToStep = (i: number) => {
    const el = stepRefs.current[i]
    const box = scrollRef.current
    if (el && box) box.scrollTo({ top: Math.max(0, el.offsetTop - SCROLL_OFFSET), behavior: 'smooth' })
  }
  const finish = () => {
    try { window.sessionStorage.removeItem(`mbm:cook:${r.id}`) } catch {}
    setFinished(true)
  }
  const startOver = () => {
    setChecked(new Set())
    setDoneSteps(new Set())
    setTimer(null)
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
      {timer && (
        <button type="button" className={'timer-float' + (left === 0 ? ' ring' : '')} onClick={() => scrollToStep(timer.step)}>
          <Icon name="timer" size={16} weight="bold" />{left === 0 ? 'Timer done' : fmtClock(left)}<small>step {timer.step + 1}</small>
        </button>
      )}
      <div className="cook-scroll" ref={scrollRef}>
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
            const minutes = detectTimerMinutes(text)
            const mine = timer?.step === i
            const toggle = () => setDoneSteps(d => toggleIn(d, i))
            return (
              <div
                key={i}
                ref={el => { stepRefs.current[i] = el }}
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
                  {!!minutes && (
                    <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      {mine ? (
                        <div className={'timer-card' + (left === 0 ? ' ring' : '')}>
                          <div className="timer-num" role="timer">{left === 0 ? 'Done!' : fmtClock(left)}</div>
                          <div className="timer-btns">
                            {left > 0 && (
                              <button type="button" className="round-btn" onClick={togglePause} aria-label={running ? 'Pause timer' : 'Resume timer'}>
                                <Icon name={running ? 'pause' : 'play'} size={18} weight={running ? 'bold' : 'fill'} />
                              </button>
                            )}
                            <button type="button" className="round-btn" onClick={() => setTimer(null)} aria-label="Reset timer">
                              <Icon name="reset" size={18} weight="bold" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="timer-start" onClick={() => startTimer(i, minutes)}>
                          <Icon name="timer" size={18} />Start {fmtDuration(minutes)} timer
                        </button>
                      )}
                    </div>
                  )}
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
