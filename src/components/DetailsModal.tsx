import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'
import { useCognitoAuth } from '../hooks/useCognitoAuth'
import { IconClose } from '../icons/Icons'

// Replaced file content with a clean, minimal DetailsModal implementation
export default function DetailsModal({
  visible,
  onClose,
  onSave,
  initialRecipe,
  onCook,
  onLogin,
}: {
  visible: boolean
  onClose: () => void
  onSave: (r: Omit<Recipe, 'id'>, id?: string) => void
  initialRecipe?: Partial<Recipe> | null
  onCook?: (r: Recipe) => void
  onLogin?: () => void
}) {
  const auth = useCognitoAuth()
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(initialRecipe?.image ?? null)
  const [servings, setServings] = useState(initialRecipe?.servings ?? '')
  const [tags, setTags] = useState<string[]>(initialRecipe?.tags ?? [])
  const [title, setTitle] = useState(initialRecipe?.title ?? '')
  const [description, setDescription] = useState(initialRecipe?.description ?? '')
  const [cookTime, setCookTime] = useState(initialRecipe?.cookTime ?? '')
  const [tagInput, setTagInput] = useState('')
  const [ingredientsText, setIngredientsText] = useState(initialRecipe?.ingredients?.map(i => (i.amount ? i.amount + ' ' + i.name : i.name)).join('\n') ?? '')
  const [instructionsText, setInstructionsText] = useState(initialRecipe?.instructions?.join('\n') ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Force redeploy 1
  const modalRoot = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  const modalRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const touchStart = useRef<{ x: number; y: number; scrollTop: number } | null>(null)
  const shouldClose = useRef(false)
  const maxFollow = 40

  function setTranslate(y: number) {
    if (!modalRef.current) return
    modalRef.current.style.transform = y ? `translateY(${y}px)` : ''
    if (y) modalRef.current.style.willChange = 'transform'
  }
  function snapBack() {
    if (!modalRef.current) return
    modalRef.current.style.transition = 'transform 160ms ease'
    modalRef.current.style.transform = ''
    const el = modalRef.current
    setTimeout(() => { if (el) el.style.transition = '' }, 180)
  }

  // Manage scroll locking with a simple global counter to support multiple modals
  function lockScroll() {
    if (typeof window === 'undefined') return
    const w = window as any
    w.__modalCount = (w.__modalCount || 0) + 1
    if (w.__modalCount === 1) {
      document.documentElement.classList.add('modal-open')
      document.body.classList.add('modal-open')
    }
  }
  function unlockScroll() {
    if (typeof window === 'undefined') return
    const w = window as any
    w.__modalCount = Math.max(0, (w.__modalCount || 0) - 1)
    if (w.__modalCount === 0) {
      document.documentElement.classList.remove('modal-open')
      document.body.classList.remove('modal-open')
    }
  }

  useEffect(() => {
    if (!imageFile) return
    const reader = new FileReader()
    reader.onload = () => setImagePreview(String(reader.result))
    reader.readAsDataURL(imageFile)
  }, [imageFile])

  useEffect(() => {
    setImagePreview(initialRecipe?.image ?? null)
    setServings(initialRecipe?.servings ?? '')
    setCookTime(initialRecipe?.cookTime ?? '')
    setTags(initialRecipe?.tags ?? [])
    setIngredientsText(initialRecipe?.ingredients?.map(i => (i.amount ? i.amount + ' ' + i.name : i.name)).join('\n') ?? '')
    setInstructionsText(initialRecipe?.instructions?.join('\n') ?? '')
    setErrors({})
    setTitle(initialRecipe?.title ?? '')
    setDescription(initialRecipe?.description ?? '')
    setImageFile(null)
    if (visible) {
      lockScroll()
      lastFocused.current = document.activeElement as HTMLElement | null
      // Focus the modal container to avoid auto-opening the keyboard on iOS
      setTimeout(() => modalRef.current?.focus(), 0)
    } else {
      unlockScroll()
      setTimeout(() => lastFocused.current?.focus?.(), 0)
    }
  }, [visible, initialRecipe])

  // Keyboard handling: Escape to close and focus trap within the modal when visible
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!visible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>('a[href], button, textarea, input, select')
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  function parseIngredients(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const re = /^([\d/.]+\s*[a-zA-Z%\u00b0]*)\s+(.*)$/
    return lines.map(line => {
      const m = line.match(re)
      if (m) return { amount: m[1], name: m[2] }
      const [first, ...rest] = line.split(' ')
      return { amount: /\d/.test(first) ? first : undefined, name: rest.length ? rest.join(' ') : line }
    })
  }

  function parseInstructions(text: string) {
    return text.split('\n').map(l => l.trim()).filter(Boolean)
  }

  function addTagFromInput() {
    const v = tagInput.trim()
    if (!v) return
    if (!tags.includes(v)) setTags(s => [...s, v])
    setTagInput('')
  }

  function removeTag(t: string) {
    setTags(s => s.filter(x => x !== t))
  }

  function validate() {
    const e: Record<string, string> = {}
    if (!title || !title.trim()) e.title = 'Title is required'
    if (servings && isNaN(Number(servings))) e.servings = 'Servings must be a number'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
  if (!auth.isAuthed) { onLogin?.(); return }
    if (!validate()) return
    const ingredients = parseIngredients(ingredientsText)
    const instructions = parseInstructions(instructionsText)
    let imageUrl = imagePreview
    const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
    const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
    const apiBase = (viteBase || legacyBase || '').trim()
    if (imageFile && apiBase) {
      try {
  const authHeaders = auth.authHeader()
  const resp = await fetch(`${apiBase}/images`, { method: 'POST', body: JSON.stringify({ filename: imageFile.name }), headers: { ...(authHeaders as Record<string, string>), 'Content-Type': 'application/json' } })
        if (resp.ok) {
          const data = await resp.json()
          await fetch(data.uploadUrl, { method: 'PUT', body: imageFile, headers: { 'Content-Type': imageFile.type } })
          imageUrl = data.key
        }
      } catch (e) { console.warn('image upload failed', e) }
    }
    if (!imageFile && apiBase && imageUrl && /^https?:\/\//i.test(imageUrl)) {
      try { const base = apiBase.replace(/\/$/, ''); const prefix = `${base}/images/`; if (imageUrl.startsWith(prefix)) imageUrl = decodeURIComponent(imageUrl.slice(prefix.length)) } catch {}
    }
    onSave({
      title,
      description,
      cookTime: cookTime || undefined,
      image: imageUrl || undefined,
      tags: tags.length ? tags : undefined,
      ingredients: ingredients.length ? ingredients : undefined,
      instructions: instructions.length ? instructions : undefined,
      servings: servings || undefined,
    }, (initialRecipe as any)?.id)
    onClose()
  }

  useEffect(() => {
    return () => {
      // ensure scroll unlock on unmount
      unlockScroll()
    }
  }, [])

  if (!visible || !modalRoot) return null

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="modal bg-gradient-card border-none shadow-floating"
        ref={modalRef}
  tabIndex={-1}
  onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (!t || !modalRef.current) return
          touchStart.current = { x: t.clientX, y: t.clientY, scrollTop: modalRef.current.scrollTop }
          shouldClose.current = false
        }}
        onTouchMove={(e) => {
          const start = touchStart.current
          const t = e.touches[0]
          if (!start || !t || !modalRef.current) return
          const dx = t.clientX - start.x
          const dy = t.clientY - start.y
          const atTop = start.scrollTop <= 0
          const verticalDominant = Math.abs(dy) > Math.abs(dx) * 2.0
          const draggingDown = dy > 0
          const threshold = Math.max(200, Math.min(300, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.30))
          shouldClose.current = atTop && draggingDown && verticalDominant && dy > threshold
          if (atTop && draggingDown && verticalDominant) {
            const follow = Math.max(0, Math.min(maxFollow, dy))
            setTranslate(follow)
          } else {
            setTranslate(0)
          }
        }}
        onTouchEnd={() => {
          if (shouldClose.current) {
            shouldClose.current = false
            touchStart.current = null
            setTranslate(0)
            onClose()
          } else {
            touchStart.current = null
            snapBack()
          }
        }}
        onTouchCancel={() => { touchStart.current = null; shouldClose.current = false; snapBack() }}
      >
  {/* grabber removed per design */}
        <button className="modal-close" aria-label="Close" onClick={onClose}><IconClose size={20} /></button>
        <div className="modal-header"><h3 className="text-primary">Recipe details</h3></div>
        {errors.title && <div className="error">{errors.title}</div>}

        <label className="form-field">
          <span className="form-label">Recipe Title <span aria-hidden="true" className="required-asterisk">*</span></span>
          <input required ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Chocolate Cake" />
        </label>

        <label className="form-field">
          <span className="form-label">Description</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </label>

        <label className="form-field">
          <span className="form-label">Tags</span>
          <div className="tag-input-row">
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagFromInput() } }} placeholder="Type tag and press Enter" />
            <button type="button" className="btn-ghost" onClick={addTagFromInput}>Add</button>
          </div>
          <div className="tag-list">
            {tags.map(t => (
              <div key={t} className="tag">
                <span>{t}</span>
                <button type="button" className="btn-ghost" onClick={() => removeTag(t)}><IconClose size={14} /></button>
              </div>
            ))}
          </div>
        </label>

        <label className="form-field">
          <span className="form-label">Image (upload)</span>
          <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] ?? null)} />
        </label>
        {imagePreview && (
          <div className="image-preview-wrap">
            <img
              src={((): string => {
                const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
                const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
                const apiBase = (viteBase || legacyBase || '').trim()
                if (!/^(https?:|data:|blob:)/i.test(imagePreview || '') && apiBase) return `${apiBase}/images/${encodeURIComponent(imagePreview)}`
                return imagePreview || ''
              })()}
              alt="preview"
              className="modal-image-preview"
            />
          </div>
        )}

        <label className="form-field">
          <span className="form-label">Cook Time</span>
          <input value={cookTime} onChange={e => setCookTime(e.target.value)} placeholder="e.g., 30 minutes" />
        </label>
        <label className="form-field">
          <span className="form-label">Servings</span>
          <input value={servings} onChange={e => setServings(e.target.value)} placeholder="e.g., 4" />
          {errors.servings && <small className="error">{errors.servings}</small>}
        </label>

        

        <label className="form-field">
          <span className="form-label">Ingredients (one per line, include amount if available)</span>
          <textarea value={ingredientsText} onChange={e => setIngredientsText(e.target.value)} placeholder={`e.g.\n1 cup flour\n200g sugar`} />
        </label>

        <label className="form-field">
          <span className="form-label">Instructions (one step per line)</span>
          <textarea value={instructionsText} onChange={e => setInstructionsText(e.target.value)} placeholder={`e.g.\nPreheat oven to 180\u00b0C\nMix dry ingredients\nBake 25-30 minutes`} />
        </label>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={() => save()} disabled={!auth.isAuthed} title={!auth.isAuthed ? 'Log in to save' : undefined}>Save recipe</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    modalRoot
  )
}
