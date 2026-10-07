import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './ui/Sheet'
import { Icon } from '../icons/Icons'
import { useApp } from '../state/AppContext'
import { detectPaste } from '../lib/extract'
import CameraInput, { toPage } from './CameraInput'
import './AddSheets.css'

export function AddSheet() {
  const app = useApp()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const close = () => app.setSheet(null)
  return (
    <Sheet open={app.sheet === 'add'} onClose={close} label="Add a recipe">
      <h2 className="sheet-title">Add a recipe</h2>
      {/* Opens the native camera directly; the sheet stays open until a photo comes back. */}
      <button type="button" className="add-opt hero" onClick={() => cameraRef.current?.click()}>
        <span className="add-ic"><Icon name="camera" size={26} /></span>
        <span className="add-txt"><b>Scan a recipe card</b><small>Handwritten, printed or a cookbook page</small></span>
        <Icon name="chev" size={18} />
      </button>
      <button type="button" className="add-opt" onClick={() => app.setSheet('paste')}>
        <span className="add-ic"><Icon name="paste" size={24} /></span>
        <span className="add-txt"><b>Paste a link, text or screenshot</b><small>We’ll work out which it is</small></span>
        <Icon name="chev" size={18} />
      </button>
      <button type="button" className="add-opt" onClick={() => { close(); app.setPendingDraft(null); navigate('/new') }}>
        <span className="add-ic"><Icon name="pencil" size={22} /></span>
        <span className="add-txt"><b>Type it yourself</b><small>Start from a blank recipe</small></span>
        <Icon name="chev" size={18} />
      </button>
      <CameraInput ref={cameraRef} onFile={f => { app.setScanPages([toPage(f)]); close(); navigate('/scan') }} />
    </Sheet>
  )
}

export function PasteSheet() {
  const app = useApp()
  const navigate = useNavigate()
  const open = app.sheet === 'paste'
  const [val, setVal] = useState('')
  const [shot, setShot] = useState<{ file: Blob; url: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    setVal('')
    setShot(null)
    setNote(null)
  }, [open])

  const det = shot ? { kind: 'screenshot' as const, label: 'Screenshot', detail: 'Image from your clipboard' } : detectPaste(val)

  async function pasteFromClipboard() {
    setNote(null)
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'))
          if (imgType) {
            const blob = await item.getType(imgType)
            setShot({ file: blob, url: URL.createObjectURL(blob) })
            return
          }
          if (item.types.includes('text/plain')) {
            setVal(await (await item.getType('text/plain')).text())
            return
          }
        }
      } else if (navigator.clipboard?.readText) {
        setVal(await navigator.clipboard.readText())
        return
      }
      setNote('Your clipboard is empty. Copy a link, some recipe text or a screenshot first.')
    } catch {
      setNote('We couldn’t read the clipboard. Long-press the box above and tap Paste.')
    }
  }

  function chooseShot(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setShot({ file: f, url: URL.createObjectURL(f) })
  }

  function start() {
    if (!det) return
    if (det.kind === 'screenshot' && shot) app.setImportJob({ kind: 'screenshot', files: [shot.file] })
    else if (det.kind === 'link') app.setImportJob({ kind: 'link', url: val.trim() })
    else app.setImportJob({ kind: 'text', text: val.trim() })
    app.setSheet(null)
    navigate('/import')
  }

  return (
    <Sheet open={open} onClose={() => app.setSheet(null)} label="Paste anything">
      <h2 className="sheet-title">Paste anything</h2>
      <p className="sheet-sub">A recipe link, the recipe text itself, or a screenshot.</p>
      {shot ? (
        <div className="paste-box shot">
          <img className="shot-thumb" src={shot.url} alt="Screenshot to import" />
          <button type="button" className="link-btn" onClick={() => setShot(null)}>Remove</button>
        </div>
      ) : (
        <textarea className="paste-box" value={val} onChange={e => setVal(e.target.value)} placeholder="Paste here…" rows={4} aria-label="Link, recipe text" />
      )}
      {!val && !shot && (
        <div className="paste-actions">
          <button type="button" className="btn soft" onClick={pasteFromClipboard}><Icon name="paste" size={18} />Paste from clipboard</button>
          <button type="button" className="btn soft" onClick={() => fileRef.current?.click()}><Icon name="photo" size={18} />Choose screenshot</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={chooseShot} />
      {note && <p className="paste-note">{note}</p>}
      {det && (
        <div className="detect">
          <Icon name={det.kind === 'link' ? 'link' : det.kind === 'screenshot' ? 'photo' : 'text'} size={18} />
          <span><b>{det.label}</b> · {det.detail}</span>
          <Icon name="check" size={18} weight="bold" color="var(--ok)" style={{ marginLeft: 'auto' }} />
        </div>
      )}
      <button type="button" className="btn primary block import-btn" disabled={!det} onClick={start}>
        <Icon name="spark" size={18} />Import recipe
      </button>
    </Sheet>
  )
}
