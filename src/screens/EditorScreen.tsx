import React, { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, useRecipe } from '../state/AppContext'
import { Icon } from '../icons/Icons'
import { Stepper } from '../components/ui'
import ConfirmDialog from '../components/ConfirmDialog'
import { blankDraft, draftFromRecipe, normalizeTag } from '../lib/draft'
import { isHeic, resizeDishPhoto, resolveImageUrl } from '../lib/images'
import type { Draft, DraftRow, Flag } from '../types'
import './EditorScreen.css'

/** /recipe/:id/edit */
export function EditRecipeScreen() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  const app = useApp()
  if (!recipe) return app.loading ? <div className="screen" /> : <Navigate to="/" replace />
  if (!app.auth.loading && !app.auth.isAuthed) return <Navigate to={`/recipe/${encodeURIComponent(recipe.id)}`} replace />
  return <Editor key={recipe.id} initial={draftFromRecipe(recipe)} />
}

/** /new — blank, or the draft an import just produced. */
export function NewRecipeScreen() {
  const app = useApp()
  const [initial] = useState<Draft>(() => app.pendingDraft ?? blankDraft())
  useEffect(() => () => app.setPendingDraft(null), [])  // eslint-disable-line react-hooks/exhaustive-deps
  return <Editor initial={initial} />
}

const HEADINGS: Record<Draft['source'], string> = {
  scan: 'Check recipe', link: 'Check recipe', text: 'Check recipe', screenshot: 'Check recipe', manual: 'New recipe', edit: 'Edit recipe',
}

function FlagBox({ flag, onPick }: { flag: Flag; onPick: (text: string) => void }) {
  return (
    <div className="flag">
      <div className="flag-q"><Icon name="alert" size={17} />{flag.q}</div>
      <div className="flag-opts">
        {flag.opts.map(([text, label]) => (
          <button type="button" key={label} className="flag-opt" onClick={() => onPick(text)}>{label}</button>
        ))}
      </div>
    </div>
  )
}

type ListKey = 'ingredients' | 'steps'

export function Editor({ initial }: { initial: Draft }) {
  const app = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [d, setD] = useState<Draft>(initial)
  const [tagInput, setTagInput] = useState('')
  const [showOrig, setShowOrig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const focusNew = useRef<string | null>(null)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))
  const setRow = (list: ListKey, i: number, patch: Partial<DraftRow>) =>
    setD(p => ({ ...p, [list]: p[list].map((r, k) => (k === i ? { ...r, ...patch } : r)) }))
  const delRow = (list: ListKey, i: number) => setD(p => ({ ...p, [list]: p[list].filter((_, k) => k !== i) }))
  const addRow = (list: ListKey) => {
    focusNew.current = `${list}-${d[list].length}`
    setD(p => ({ ...p, [list]: [...p[list], { text: '' }] }))
  }

  useEffect(() => {
    if (!focusNew.current) return
    document.getElementById(focusNew.current)?.focus()
    focusNew.current = null
  })

  const open = [...d.ingredients, ...d.steps].filter(r => r.flag && !r.ok).length
  const totalFlags = [...initial.ingredients, ...initial.steps].filter(r => r.flag).length
  const isEdit = d.source === 'edit'
  const isAi = d.source !== 'edit' && d.source !== 'manual'

  const cancel = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate(isEdit && d.id ? `/recipe/${encodeURIComponent(d.id)}` : '/', { replace: true })
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(null)
    try {
      const small = await resizeDishPhoto(f)
      const preview = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(small) })
      setD(p => ({ ...p, imageFile: small, image: preview }))
    } catch {
      setError(isHeic(f)
        ? 'This photo is HEIC, which most browsers can’t read. Choose a JPEG/PNG, or set iOS Camera to “Most Compatible”.'
        : 'We couldn’t read that photo. Try a different one.')
    }
  }

  function addTag() {
    const t = normalizeTag(tagInput)
    if (t && !d.tags.some(x => x.t === t)) set('tags', [...d.tags, { t }])
    setTagInput('')
  }

  async function save() {
    if (!app.requireLogin()) return
    setSaving(true)
    setError(null)
    try {
      const saved = await app.saveDraft(d)
      app.toast(isEdit ? 'Changes saved' : 'Saved to your recipe box')
      // Editing from the recipe page: go back to it (it re-renders with the saved data)
      // rather than pushing a second copy of it onto history.
      if (isEdit && (location.state as { fromDetail?: boolean } | null)?.fromDetail) navigate(-1)
      else navigate(`/recipe/${encodeURIComponent(saved.id)}`, { replace: true })
    } catch (e) {
      console.error('Failed to save recipe', e)
      setError('The oven door’s stuck — we couldn’t save that. Try again in a moment.')
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!d.id) return
    try {
      await app.deleteRecipe(d.id)
      app.toast('Recipe 86’d')
      navigate('/', { replace: true })
    } catch (e) {
      console.error('Failed to delete recipe', e)
      setConfirmDelete(false)
      setError('That one’s stuck to the pan — we couldn’t delete it. Try again.')
    }
  }

  const photo = resolveImageUrl(d.image)

  return (
    <div className="screen review rise">
      <header className="nav-bar">
        <button type="button" className="link-btn" onClick={cancel}>Cancel</button>
        <b>{HEADINGS[d.source]}</b>
        <button type="button" className="link-btn strong" disabled={!d.title.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="scroll">
        {isAi && (open || totalFlags > 0 || d.source === 'scan') ? (
          <div className={'ai-banner' + (open ? ' warn' : ' ok')}>
            <Icon name={open ? 'spark' : 'check'} size={18} weight={open ? 'regular' : 'bold'} />
            <div>
              <b>{open ? `${open} ${open === 1 ? 'thing' : 'things'} to check` : totalFlags ? 'All checked' : 'Read from your card'}</b>
              <small>{open ? 'We weren’t sure about a few words. Everything else is ready.' : 'Looks good. Save whenever you’re ready.'}</small>
            </div>
            {!!d.originals?.length && (
              <button type="button" className="orig-btn" onClick={() => setShowOrig(true)}>
                <img src={d.originals[0]} alt="" />
                <span>Original</span>
              </button>
            )}
          </div>
        ) : isAi ? (
          <div className="ai-banner ok">
            <Icon name="spark" size={18} />
            <div>
              <b>{d.source === 'link' ? `Imported from ${d.sourceLabel}` : d.source === 'screenshot' ? 'Read from your screenshot' : 'Read from your text'}</b>
              <small>{d.source === 'link' ? 'We kept the recipe and skipped the rest of the page.' : 'Review it below, then save.'}</small>
            </div>
          </div>
        ) : null}

        {error && <div className="editor-error" role="alert">{error}</div>}

        <button
          type="button"
          className={'photo-slot' + (photo ? ' has' : '')}
          style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
          onClick={() => fileRef.current?.click()}
        >
          {photo
            ? <span className="photo-change"><Icon name="camera" size={16} />Change photo</span>
            : <><Icon name="camera" size={24} /><span>Add a photo of the dish</span></>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />

        <div className="field">
          <label htmlFor="ed-title">Title</label>
          <input id="ed-title" className="inp title" value={d.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Chocolate Cake" />
        </div>
        <div className="field">
          <label htmlFor="ed-desc">Description</label>
          <input id="ed-desc" className="inp" value={d.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ed-time">Time</label>
            <input id="ed-time" className="inp" value={d.cookTime} onChange={e => set('cookTime', e.target.value)} placeholder="30 min" />
          </div>
          <div className="field">
            <label>Servings</label>
            <Stepper value={d.servings} onChange={n => set('servings', n)} label="Servings" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ed-tag">
            Tags
            {d.tags.some(t => t.ai) && <span className="ai-note"><Icon name="spark" size={13} />suggested</span>}
          </label>
          <div className="tag-edit">
            {d.tags.map(t => (
              <span key={t.t} className={'chip on' + (t.ai ? ' ai' : '')}>
                {t.t}
                <button type="button" onClick={() => set('tags', d.tags.filter(x => x.t !== t.t))} aria-label={`Remove tag ${t.t}`}>
                  <Icon name="close" size={12} weight="bold" />
                </button>
              </span>
            ))}
            <input
              id="ed-tag"
              className="tag-inp"
              value={tagInput}
              autoCapitalize="off"
              enterKeyHint="done"
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
              onBlur={addTag}
              placeholder="+ tag"
            />
          </div>
        </div>

        <div className="sec-label">Ingredients</div>
        <div className="rows">
          {d.ingredients.map((r, i) => (
            <div key={i} className={'erow' + (r.flag && !r.ok ? ' flagged' : '') + (r.ok ? ' fixed' : '')}>
              <div className="erow-main">
                <input
                  id={`ingredients-${i}`}
                  className="inp bare"
                  value={r.text}
                  placeholder="1 cup flour"
                  aria-label={`Ingredient ${i + 1}`}
                  onChange={e => setRow('ingredients', i, { text: e.target.value, ...(r.flag ? { ok: true } : {}) })}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow('ingredients') } }}
                />
                {r.ok && <Icon name="check" size={16} weight="bold" color="var(--ok)" />}
                <button type="button" className="row-x" onClick={() => delRow('ingredients', i)} aria-label={`Remove ingredient ${i + 1}`}>
                  <Icon name="close" size={14} weight="bold" />
                </button>
              </div>
              {r.flag && !r.ok && <FlagBox flag={r.flag} onPick={text => setRow('ingredients', i, { text, ok: true })} />}
            </div>
          ))}
          <button type="button" className="add-row" onClick={() => addRow('ingredients')}>
            <Icon name="plus" size={16} weight="bold" />Add ingredient
          </button>
        </div>

        <div className="sec-label">Steps</div>
        <div className="rows">
          {d.steps.map((r, i) => (
            <div key={i} className={'erow step' + (r.flag && !r.ok ? ' flagged' : '') + (r.ok ? ' fixed' : '')}>
              <div className="erow-main">
                <span className="step-n">{i + 1}</span>
                <AutoTextarea
                  id={`steps-${i}`}
                  value={r.text}
                  placeholder="Describe this step"
                  aria-label={`Step ${i + 1}`}
                  onChange={text => setRow('steps', i, { text, ...(r.flag ? { ok: true } : {}) })}
                />
                {r.ok && <Icon name="check" size={16} weight="bold" color="var(--ok)" className="step-ok" />}
                <button type="button" className="row-x" onClick={() => delRow('steps', i)} aria-label={`Remove step ${i + 1}`}>
                  <Icon name="close" size={14} weight="bold" />
                </button>
              </div>
              {r.flag && !r.ok && <FlagBox flag={r.flag} onPick={text => setRow('steps', i, { text, ok: true })} />}
            </div>
          ))}
          <button type="button" className="add-row" onClick={() => addRow('steps')}>
            <Icon name="plus" size={16} weight="bold" />Add step
          </button>
        </div>

        {isEdit && (
          <button type="button" className="btn ghost block delete-btn" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={18} />Delete recipe
          </button>
        )}
        <div style={{ height: 'calc(60px + var(--safe-b))' }} />
      </div>

      {showOrig && d.originals && (
        <div className="orig-view" onClick={() => setShowOrig(false)} role="dialog" aria-label="Original photos">
          <div className="orig-cards">{d.originals.map((src, k) => <img key={k} src={src} alt={`Page ${k + 1}`} />)}</div>
          <button type="button" className="btn soft">Close</button>
        </div>
      )}

      <ConfirmDialog
        visible={confirmDelete}
        title="Are you sure you want to 86 this recipe?"
        message={`Delete "${d.title}"?`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function AutoTextarea({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; id: string; placeholder: string; 'aria-label': string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} className="inp bare" rows={1} value={value} onChange={e => onChange(e.target.value)} {...rest} />
}
