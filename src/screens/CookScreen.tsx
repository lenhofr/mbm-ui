import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, useRecipe } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton } from '../components/ui'
import { useWakeLock } from '../hooks/useWakeLock'
import { detectTimerMinutes, ingredientText, ingredientsUsedInStep } from '../lib/quantity'
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

type TimerState = { step: number; total: number; endAt: number | null; pausedLeft: number }

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

function Cook({ r }: { r: Recipe }) {
  const navigate = useNavigate()
  const location = useLocation()
  const mult = (location.state as { mult?: number } | null)?.mult ?? 1
  const steps = r.instructions || []
  const ingredients = r.ingredients || []
  const n = steps.length
  const [i, setI] = useState(0)
  const [done, setDone] = useState(false)
  const [timer, setTimer] = useState<TimerState | null>(null)
  const [, setTick] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const chimed = useRef(false)
  const wake = useWakeLock(!done)

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

  const exit = () => navigate(`/recipe/${encodeURIComponent(r.id)}`, { replace: true })
  const go = (d: number) => {
    if (i + d >= n) { setDone(true); return }
    setI(Math.max(0, Math.min(n - 1, i + d)))
  }
  const startTimer = (minutes: number) => {
    unlockAudio()
    chimed.current = false
    setTimer({ step: i, total: minutes * 60, endAt: Date.now() + minutes * 60000, pausedLeft: minutes * 60 })
  }
  const togglePause = () => {
    if (!timer) return
    unlockAudio()
    setTimer(timer.endAt ? { ...timer, endAt: null, pausedLeft: left } : { ...timer, endAt: Date.now() + timer.pausedLeft * 1000 })
  }

  if (done) {
    return (
      <div className="screen cook rise">
        <div className="cook-done">
          <div className="done-ring"><Icon name="check" size={40} weight="bold" /></div>
          <h1>Nice work</h1>
          <p>Enjoy your {r.title}.</p>
          <button type="button" className="btn primary block lg" onClick={exit}>Back to recipe</button>
          <button type="button" className="btn ghost block" onClick={() => { setDone(false); setI(0) }}>Start over</button>
        </div>
      </div>
    )
  }

  const text = steps[i]
  const minutes = detectTimerMinutes(text)
  const uses = ingredientsUsedInStep(text, ingredients).map(k => ingredients[k])

  return (
    <div className="screen cook rise">
      <header className="cook-head">
        <GlassButton icon="close" onClick={exit} label="Exit cook mode" />
        <div className="cook-count" aria-live="polite">Step {i + 1} <span>of {n}</span></div>
        <div className={'awake' + (wake.isActive ? ' on' : '')} title={wake.isSupported ? undefined : 'Not supported on this device'}>
          <Icon name="sun" size={15} weight="bold" />Screen on
        </div>
      </header>
      <div className="cook-progress">
        {steps.map((_, k) => <button type="button" key={k} className={k <= i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Go to step ${k + 1}`} />)}
      </div>
      {timer && timer.step !== i && (
        <button type="button" className={'timer-float' + (left === 0 ? ' ring' : '')} onClick={() => setI(timer.step)}>
          <Icon name="timer" size={16} weight="bold" />{left === 0 ? 'Timer done' : fmtClock(left)}<small>step {timer.step + 1}</small>
        </button>
      )}
      <div
        className="cook-body"
        key={i}
        onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={e => {
          const s = start.current
          start.current = null
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
        onPointerCancel={() => { start.current = null }}
      >
        <div className="cook-eyebrow">{r.title}</div>
        <p className={'cook-text' + (text.length > 170 ? ' long' : '')}>{text}</p>
        {uses.length > 0 && (
          <div className="cook-uses">
            <div className="sec-label">You’ll need</div>
            <ul>{uses.map((u, k) => <li key={k}>{ingredientText(u, mult)}</li>)}</ul>
          </div>
        )}
        {!!minutes && (timer && timer.step === i ? (
          <div className={'timer-card' + (left === 0 ? ' ring' : '')}>
            <div className="timer-num" role="timer">{left === 0 ? 'Done!' : fmtClock(left)}</div>
            <div className="timer-btns">
              {left > 0 && (
                <button type="button" className="round-btn" onClick={togglePause} aria-label={running ? 'Pause timer' : 'Resume timer'}>
                  <Icon name={running ? 'pause' : 'play'} size={20} weight={running ? 'bold' : 'fill'} />
                </button>
              )}
              <button type="button" className="round-btn" onClick={() => setTimer(null)} aria-label="Reset timer">
                <Icon name="reset" size={20} weight="bold" />
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn soft block timer-start" onClick={() => startTimer(minutes)}>
            <Icon name="timer" size={20} />Start {fmtDuration(minutes)} timer
          </button>
        ))}
      </div>
      <div className="cook-nav">
        <button type="button" className="btn soft lg" disabled={i === 0} onClick={() => go(-1)}>
          <Icon name="back" size={20} weight="bold" />Back
        </button>
        <button type="button" className="btn primary lg grow" onClick={() => go(1)}>
          {i === n - 1 ? 'Finish' : <>Next step<Icon name="chev" size={20} weight="bold" /></>}
        </button>
      </div>
    </div>
  )
}
