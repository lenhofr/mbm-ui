// Scan + import flow: camera capture, processing, and the "couldn't read it" screen.
import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp, type ImportJob } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton } from '../components/ui'
import CameraInput, { toPage } from '../components/CameraInput'
import { UnreadableError, extractRecipe, hostOf } from '../lib/extract'
import { draftFromExtract } from '../lib/draft'
import { topTags } from '../lib/search'
import { talk, usePick, usePickSteps } from '../lib/kitchenTalk'
import type { DraftSource } from '../types'
import './ImportScreens.css'

const MAX_PAGES = 2

/** /scan: shown after the native camera returns a photo. Add the back, retake, or start reading. */
export function ScanReviewScreen() {
  const app = useApp()
  const navigate = useNavigate()
  const pages = app.scanPages
  const cameraRef = useRef<HTMLInputElement>(null)
  // Which page the next capture replaces: null appends (back of card).
  const replacing = useRef<number | null>(null)

  if (!pages.length) return <Navigate to="/" replace />

  const capture = (index: number | null) => {
    replacing.current = index
    cameraRef.current?.click()
  }
  const onFile = (f: File) => {
    const i = replacing.current
    const next = i == null ? [...pages, toPage(f)].slice(0, MAX_PAGES) : pages.map((p, k) => (k === i ? toPage(f) : p))
    app.setScanPages(next)
  }
  const close = () => {
    app.setScanPages([])
    navigate('/', { replace: true })
  }
  const read = () => {
    if (!app.requireLogin()) return
    app.setImportJob({ kind: 'scan', files: pages.map(p => p.file), originals: pages.map(p => p.url) })
    // Don't clear scanPages here: this screen would re-render with no pages and its
    // redirect to Home would beat the (transition-wrapped) navigation to /import.
    // The Processing screen clears them once it has taken the job.
    navigate('/import', { replace: true })
  }

  const n = pages.length
  return (
    <div className="screen scan-review rise">
      <div className="cam-top">
        <GlassButton icon="close" dark onClick={close} label="Close" />
        <div className="cam-pill">{n === 1 ? 'Front of card' : 'Front and back'}</div>
        <div style={{ width: 44 }} />
      </div>
      <div className={'scan-pages' + (n > 1 ? ' two' : '')}>
        {pages.map((p, k) => (
          <figure key={p.url}>
            <img src={p.url} alt={k === 0 ? 'Front of card' : 'Back of card'} />
            {n > 1 && <figcaption>{k === 0 ? 'Front' : 'Back'}</figcaption>}
          </figure>
        ))}
      </div>
      <div className="cam-hint">
        {n === 1 ? 'If the recipe continues on the back, add a photo of it too.' : 'Both sides are ready.'}
      </div>
      <div className="scan-actions">
        <div className="scan-row">
          <button type="button" className="btn dark-soft" onClick={() => capture(n - 1)}>
            <Icon name="reset" size={18} />{n === 1 ? 'Retake' : 'Retake back'}
          </button>
          {n < MAX_PAGES && (
            <button type="button" className="btn dark-soft" onClick={() => capture(null)}>
              <Icon name="camera" size={18} />Add back of card
            </button>
          )}
        </div>
        <button type="button" className="btn primary block lg" onClick={read}>
          <Icon name="spark" size={18} />Read recipe
        </button>
      </div>
      <CameraInput ref={cameraRef} onFile={onFile} />
    </div>
  )
}


/** /import — runs the queued job, or one from ?url= / ?text= (Shortcuts, bookmarklets, share target). */
export function ProcessingScreen() {
  const app = useApp()
  const [params] = useSearchParams()
  const [job] = useState<ImportJob | null>(() => {
    if (app.importJob) return app.importJob
    const url = params.get('url')?.trim()
    const text = [params.get('title'), params.get('text')].filter(Boolean).join('\n').trim()
    // Share targets often put the link in `text`.
    const linkInText = text.match(/https?:\/\/\S+/)?.[0]
    if (url || linkInText) return { kind: 'link', url: (url || linkInText)! }
    if (text) return { kind: 'text', text }
    return null
  })
  if (!job) return <Navigate to="/" replace />
  return <Processing job={job} />
}

function Processing({ job }: { job: ImportJob }) {
  const app = useApp()
  const navigate = useNavigate()
  const kind = job.kind === 'text' ? 'link' : job.kind
  const steps = usePickSteps(kind === 'scan' ? talk.scanSteps : kind === 'screenshot' ? talk.screenshotSteps : talk.linkSteps)
  const scanTitle = usePick(job.kind === 'scan' && job.files.length > 1 ? talk.scanTitleTwo : talk.scanTitle)
  const importTitle = usePick(talk.importTitle)
  const failTitle = usePick(talk.importFailTitle)
  const [i, setI] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const authed = app.auth.isAuthed

  useEffect(() => { app.setImportJob(null); app.setScanPages([]) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!app.auth.loading && !authed) app.setShowLogin(true) }, [app.auth.loading, authed])  // eslint-disable-line react-hooks/exhaustive-deps

  // The API doesn't stream progress, so advance on a timer and hold on the last step.
  useEffect(() => {
    if (error || i >= steps.length - 1) return
    const t = setTimeout(() => setI(x => x + 1), 1400)
    return () => clearTimeout(t)
  }, [i, error, steps.length])

  useEffect(() => {
    if (!authed) return
    const ctrl = new AbortController()
    const source: DraftSource = job.kind
    const label = job.kind === 'link' ? hostOf(job.url) : undefined
    extractRecipe(job, app.auth.authHeader(), { knownTags: topTags(app.recipes, 30), signal: ctrl.signal })
      .then(res => {
        app.setPendingDraft(draftFromExtract(res, source, label, job.originals))
        navigate('/new', { replace: true })
      })
      .catch(e => {
        if (ctrl.signal.aborted) return
        if (e instanceof UnreadableError && job.kind === 'scan') {
          navigate('/import/failed', { replace: true })
          return
        }
        console.error('extract failed', e)
        setError(e instanceof UnreadableError
          ? 'We couldn’t find a recipe in that. Try another link, or type it in.'
          : 'Something boiled over on our end. Give it another try in a moment.')
      })
    return () => ctrl.abort()
  }, [authed, attempt])  // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => navigate('/', { replace: true })
  const title = error ? failTitle : job.kind === 'scan' ? scanTitle : importTitle

  return (
    <div className="screen processing rise">
      <div className="proc-top"><button type="button" className="link-btn" onClick={cancel}>Cancel</button></div>
      <div className="proc-visual">
        {job.kind === 'scan' && job.originals?.[0] ? (
          <div className="proc-card"><img src={job.originals[0]} alt="" />{!error && <div className="scanline" />}</div>
        ) : (
          <div className="proc-link">
            <Icon name={job.kind === 'screenshot' ? 'photo' : job.kind === 'text' ? 'text' : 'link'} size={30} />
            <span>{job.kind === 'link' ? hostOf(job.url) : job.kind === 'screenshot' ? 'Screenshot' : 'Recipe text'}</span>
            {!error && <div className="scanline" />}
          </div>
        )}
      </div>
      <h2 className="proc-title" aria-live="polite">{title}</h2>
      {error ? (
        <>
          <p className="fail-sub">{error}</p>
          <div className="fail-actions">
            <button type="button" className="btn primary block" onClick={() => { setError(null); setI(0); setAttempt(a => a + 1) }}>Try again</button>
            <button type="button" className="btn ghost block" onClick={() => { app.setPendingDraft(null); navigate('/new', { replace: true }) }}>Type it in instead</button>
          </div>
        </>
      ) : (
        <ul className="proc-steps">
          {steps.map((s, k) => (
            <li key={k} className={k < i ? 'done' : k === i ? 'now' : ''}>
              <span className="ps-dot">{k < i && <Icon name="check" size={14} weight="bold" />}</span>{s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ScanFailedScreen() {
  const app = useApp()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const title = usePick(talk.scanFailTitle)
  return (
    <div className="screen failed rise">
      <div className="proc-top"><GlassButton icon="close" onClick={() => navigate('/', { replace: true })} label="Close" /></div>
      <div className="proc-visual"><div className="proc-blur"><Icon name="photo" size={48} /></div></div>
      <h2 className="proc-title">{title}</h2>
      <p className="fail-sub">The photo is too blurry to make out the words. A few things that help:</p>
      <ul className="fail-tips">
        <li><Icon name="sun" size={20} />Use more light, and avoid glare from the flash</li>
        <li><Icon name="camera" size={20} />Fill the frame with just the card</li>
        <li><Icon name="clock" size={20} />Hold still for a second after tapping</li>
      </ul>
      <div className="fail-actions">
        <button type="button" className="btn primary block" onClick={() => cameraRef.current?.click()}><Icon name="camera" size={18} />Retake photo</button>
        <button type="button" className="btn ghost block" onClick={() => { app.setPendingDraft(null); navigate('/new', { replace: true }) }}>Type it in instead</button>
      </div>
      <CameraInput ref={cameraRef} onFile={f => { app.setScanPages([toPage(f)]); navigate('/scan', { replace: true }) }} />
    </div>
  )
}
