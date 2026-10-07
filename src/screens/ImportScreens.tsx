// Scan + import flow: camera capture, processing, and the "couldn't read it" screen.
import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp, type ImportJob } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { GlassButton } from '../components/ui'
import { UnreadableError, extractRecipe, hostOf } from '../lib/extract'
import { draftFromExtract } from '../lib/draft'
import type { DraftSource } from '../types'
import './ImportScreens.css'

const MAX_PAGES = 2

export function CameraScreen() {
  const app = useApp()
  const navigate = useNavigate()
  const [pages, setPages] = useState<{ file: File; url: string }[]>([])
  const [flash, setFlash] = useState(false)
  const shutterRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!app.auth.loading) app.requireLogin() }, [app.auth.loading])  // eslint-disable-line react-hooks/exhaustive-deps

  function add(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    e.target.value = ''
    if (!files.length) return
    setFlash(true)
    setTimeout(() => setFlash(false), 200)
    setPages(p => [...p, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PAGES))
  }

  function done(list = pages) {
    if (!list.length) return
    app.setImportJob({ kind: 'scan', files: list.map(p => p.file), originals: list.map(p => p.url) })
    navigate('/import', { replace: true })
  }

  const n = pages.length
  const last = pages[n - 1]

  return (
    <div className="screen camera rise">
      <div className="cam-top">
        <GlassButton icon="close" dark onClick={() => navigate('/', { replace: true })} label="Close" />
        <div className="cam-pill">{n === 0 ? 'Front of card' : n === 1 ? 'Back of card (optional)' : '2 pages'}</div>
        <div style={{ width: 44 }} />
      </div>
      <button type="button" className="viewfinder" onClick={() => n < MAX_PAGES && shutterRef.current?.click()} aria-label="Take photo">
        {last ? <img className="vf-shot" src={last.url} alt="" /> : <span className="vf-empty"><Icon name="camera" size={40} /></span>}
        {['tl', 'tr', 'bl', 'br'].map(c => <i key={c} className={'vf-corner ' + c} />)}
        {flash && <div className="vf-flash" />}
      </button>
      <div className="cam-hint">
        {n === 0 ? 'Fit the whole card inside the corners' : n === 1 ? 'Got the front. Flip it over for the back, or tap Done.' : 'Both sides captured.'}
      </div>
      <div className="cam-bar">
        <div className="cam-thumbs">
          {n === 0 ? (
            <button type="button" className="cam-lib" onClick={() => libraryRef.current?.click()} aria-label="Choose from photo library">
              <Icon name="photo" size={24} />
            </button>
          ) : (
            <div className="cam-stack" aria-label={`${n} ${n === 1 ? 'page' : 'pages'} captured`}>
              {pages.map((p, k) => <img key={k} className="cam-mini" src={p.url} alt="" style={{ transform: `rotate(${k ? 6 : -4}deg)` }} />)}
              <b>{n}</b>
            </div>
          )}
        </div>
        <button type="button" className="shutter" onClick={() => shutterRef.current?.click()} disabled={n >= MAX_PAGES} aria-label="Take photo"><span /></button>
        <div className="cam-thumbs right">
          {n > 0 && <button type="button" className="btn done" onClick={() => done()}>Done</button>}
        </div>
      </div>
      <input ref={shutterRef} type="file" accept="image/*" capture="environment" hidden onChange={add} />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={add} />
    </div>
  )
}

const STEPS: Record<'scan' | 'link' | 'screenshot', string[]> = {
  scan: ['Reading the handwriting', 'Finding ingredients', 'Writing out the steps', 'Suggesting tags'],
  link: ['Opening the page', 'Skipping the life story', 'Finding ingredients', 'Writing out the steps'],
  screenshot: ['Reading the screenshot', 'Finding ingredients', 'Writing out the steps', 'Suggesting tags'],
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
  const steps = STEPS[kind]
  const [i, setI] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const authed = app.auth.isAuthed

  useEffect(() => { app.setImportJob(null) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
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
    extractRecipe(job, app.auth.authHeader(), ctrl.signal)
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
  const title = error ? 'That didn’t work' : job.kind === 'scan' ? `Reading your card${job.files.length > 1 ? 's' : ''}…` : 'Importing…'

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
            <li key={s} className={k < i ? 'done' : k === i ? 'now' : ''}>
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
  return (
    <div className="screen failed rise">
      <div className="proc-top"><GlassButton icon="close" onClick={() => navigate('/', { replace: true })} label="Close" /></div>
      <div className="proc-visual"><div className="proc-blur"><Icon name="photo" size={48} /></div></div>
      <h2 className="proc-title">We couldn’t read this one</h2>
      <p className="fail-sub">The photo is too blurry to make out the words. A few things that help:</p>
      <ul className="fail-tips">
        <li><Icon name="sun" size={20} />Use more light, and avoid glare from the flash</li>
        <li><Icon name="camera" size={20} />Fill the frame with just the card</li>
        <li><Icon name="clock" size={20} />Hold still for a second after tapping</li>
      </ul>
      <div className="fail-actions">
        <button type="button" className="btn primary block" onClick={() => navigate('/scan', { replace: true })}><Icon name="camera" size={18} />Retake photo</button>
        <button type="button" className="btn ghost block" onClick={() => { app.setPendingDraft(null); navigate('/new', { replace: true }) }}>Type it in instead</button>
      </div>
    </div>
  )
}
