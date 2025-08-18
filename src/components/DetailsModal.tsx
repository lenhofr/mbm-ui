import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'
import { authHeader, isAuthenticated, login } from '../lib/auth'

export default function DetailsModal({
  visible,
  onClose,
  onSave,
  initialRecipe,
  onCook,
}: {
  visible: boolean
  onClose: () => void
  onSave: (r: Omit<Recipe, 'id'>, id?: string) => void
  initialRecipe?: Partial<Recipe> | null
  onCook?: (r: Recipe) => void
}) {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(initialRecipe?.image ?? null)
  const [servings, setServings] = useState(initialRecipe?.servings ?? '')
  const [tags, setTags] = useState<string[]>(initialRecipe?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [ingredientsText, setIngredientsText] = useState(
    initialRecipe?.ingredients?.map(i => (i.amount ? i.amount + ' ' + i.name : i.name)).join('\n') ?? ''
  )
  const [instructionsText, setInstructionsText] = useState(initialRecipe?.instructions?.join('\n') ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const modalRoot = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  const modalRef = useRef<HTMLDivElement | null>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!imageFile) return
    const reader = new FileReader()
    reader.onload = () => setImagePreview(String(reader.result))
    reader.readAsDataURL(imageFile)
  }, [imageFile])

  useEffect(() => {
    // reset when opening/closing or changing initialRecipe
    setImagePreview(initialRecipe?.image ?? null)
    setServings(initialRecipe?.servings ?? '')
    setTags(initialRecipe?.tags ?? [])
    setIngredientsText(initialRecipe?.ingredients?.map(i => (i.amount ? i.amount + ' ' + i.name : i.name)).join('\n') ?? '')
  setInstructionsText(initialRecipe?.instructions?.join('\n') ?? '')
    setErrors({})
    setImageFile(null)
    if (visible) {
      // save focus and move into modal
      lastFocused.current = document.activeElement as HTMLElement | null
      setTimeout(() => {
        const el = modalRef.current?.querySelector('input, textarea, button') as HTMLElement | null
        el?.focus()
      }, 0)
    } else {
      // restore focus
      setTimeout(() => lastFocused.current?.focus?.(), 0)
    }
  }, [visible, initialRecipe])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      // simple focus trap: Tab cycles within modal
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
    if (visible) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  function parseIngredients(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const re = /^([\d/.]+\s*[a-zA-Z%°]*)\s+(.*)$/
    return lines.map(line => {
      const m = line.match(re)
      if (m) return { amount: m[1], name: m[2] }
      const [first, ...rest] = line.split(' ')
      return { amount: /\d/.test(first) ? first : undefined, name: rest.length ? rest.join(' ') : line }
    })
  }

  function parseInstructions(text: string) {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
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
    if (servings && isNaN(Number(servings))) e.servings = 'Servings must be a number'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function save() {
    // Guard: writes require auth
    if (!isAuthenticated()) {
      // Optionally take user to login
      login()
      return
    }
    if (!validate()) return
    const ingredients = parseIngredients(ingredientsText)
  const instructions = parseInstructions(instructionsText)
    ;(async () => {
      let imageUrl = imagePreview
      // If a file was selected and an API base is configured, upload via presigned URL flow
  const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
  const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
  const apiBase = (viteBase || legacyBase || '').trim()
      if (imageFile && apiBase) {
        try {
          // Request presigned URL
          const resp = await fetch(`${apiBase}/images`, { method: 'POST', body: JSON.stringify({ filename: imageFile.name }), headers: { 'Content-Type': 'application/json', ...authHeader() } })
          if (resp.ok) {
            const data = await resp.json()
            const uploadUrl = data.uploadUrl
            const key = data.key
            // upload file directly to S3
            await fetch(uploadUrl, { method: 'PUT', body: imageFile })
            // Store the durable key rather than a short-lived presigned URL
            imageUrl = key
          }
        } catch (e) {
          // ignore upload error for now; fallback to data URL preview
          console.warn('image upload failed', e)
        }
      }

      // If no new upload occurred, but the image is an API URL like `${apiBase}/images/{key}`
      // normalize it back to just the key so renders stay fresh via redirect.
      if (!imageFile && apiBase && imageUrl && /^https?:\/\//i.test(imageUrl)) {
        try {
          const base = apiBase.replace(/\/$/, '')
          const prefix = `${base}/images/`
          if (imageUrl.startsWith(prefix)) {
            const raw = imageUrl.slice(prefix.length)
            imageUrl = decodeURIComponent(raw)
          }
        } catch {}
      }

      onSave(
        {
          title: initialRecipe?.title ?? '',
          description: initialRecipe?.description ?? '',
          image: imageUrl || undefined,
          tags: tags.length ? tags : undefined,
          ingredients: ingredients.length ? ingredients : undefined,
      instructions: instructions.length ? instructions : undefined,
          servings: servings || undefined,
        },
        // pass id through if editing
        (initialRecipe as any)?.id
      )
      onClose()
    })()
  }

  function handleCookPreview() {
    const recipePreview: Recipe = {
      id: (initialRecipe as any)?.id ?? String(Date.now()),
      title: initialRecipe?.title ?? '',
      description: initialRecipe?.description ?? '',
      image: imagePreview || undefined,
      tags: tags.length ? tags : undefined,
      ingredients: parseIngredients(ingredientsText),
      instructions: parseInstructions(instructionsText),
      servings: servings || undefined,
    }
    onCook?.(recipePreview)
  }

  if (!visible || !modalRoot) return null

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // close when clicking on backdrop (outside modal)
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" ref={modalRef} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Recipe details</h3>
        {errors.title && <div className="error">{errors.title}</div>}
        <label>
          Image (upload)
          <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] ?? null)} />
        </label>
        {imagePreview && (
          <div style={{marginBottom:8}}>
            <img
              src={(() => {
                const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
                const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
                const apiBase = (viteBase || legacyBase || '').trim()
                if (!/^https?:\/\//i.test(imagePreview || '') && apiBase) {
                  return `${apiBase}/images/${encodeURIComponent(imagePreview)}`
                }
                return imagePreview
              })()}
              alt="preview"
              className="modal-image-preview"
            />
          </div>
        )}
        <label>
          Servings
          <input value={servings} onChange={e => setServings(e.target.value)} placeholder="e.g., 4" />
          {errors.servings && <small className="error">{errors.servings}</small>}
        </label>

        <label>
          Tags
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagFromInput() } }} placeholder="Type tag and press Enter" />
            <button type="button" className="btn-ghost" onClick={addTagFromInput}>Add</button>
          </div>
          <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
            {tags.map(t => (
              <div key={t} className="tag" style={{display:'inline-flex',alignItems:'center',gap:6}}>
                <span>{t}</span>
                <button type="button" className="btn-ghost" onClick={() => removeTag(t)}>✕</button>
              </div>
            ))}
          </div>
        </label>

        <label>
          Ingredients (one per line, include amount if available)
          <textarea value={ingredientsText} onChange={e => setIngredientsText(e.target.value)} placeholder={`e.g.\n1 cup flour\n200g sugar`} />
        </label>

        <label>
          Instructions (one step per line)
          <textarea value={instructionsText} onChange={e => setInstructionsText(e.target.value)} placeholder={`e.g.\nPreheat oven to 180°C\nMix dry ingredients\nBake 25-30 minutes`} />
        </label>

        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-ghost" onClick={handleCookPreview}>Cook</button>
          <button type="button" className="primary" onClick={save} disabled={!isAuthenticated()} title={!isAuthenticated() ? 'Log in to save' : undefined}>Save recipe</button>
        </div>
      </div>
    </div>,
    modalRoot
  )
}
