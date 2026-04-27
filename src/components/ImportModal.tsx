import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../hooks/useScrollLock'
import { getApiBase } from '../lib/env'
import LoadingSpinner from './LoadingSpinner'
import type { Recipe } from '../App'

type Mode = 'url' | 'image'

type Props = {
  visible: boolean
  authHeader: (prefer?: 'id' | 'access') => Record<string, string | undefined>
  onClose: () => void
  onImported: (recipe: Omit<Recipe, 'id'>) => void
}

const SUPPORTED_TYPES: Record<string, boolean> = {
  'image/jpeg': true,
  'image/png': true,
  'image/gif': true,
  'image/webp': true,
}

const MAX_BYTES = 2_500_000
const MAX_DIMENSION = 1568

function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      for (const quality of [0.85, 0.75, 0.60, 0.45]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const base64 = dataUrl.split(',')[1]
        if (base64.length * 0.75 <= MAX_BYTES) {
          resolve({ base64, mediaType: 'image/jpeg' })
          return
        }
      }
      reject(new Error('Could not compress image under 2.5MB'))
    }
    img.onerror = reject
    img.src = url
  })
}

export default function ImportModal({ visible, authHeader, onClose, onImported }: Props) {
  useScrollLock(visible)
  const [mode, setMode] = useState<Mode>('image')
  const [url, setUrl] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setUrl('')
      setImageFiles([])
      setPreviews([])
      setError(null)
      setMode('image')
    }
  }, [visible])

  useEffect(() => {
    if (visible && mode === 'url') {
      setTimeout(() => urlInputRef.current?.focus(), 50)
    }
  }, [visible, mode])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const valid = files.filter(f => SUPPORTED_TYPES[f.type])
    if (valid.length < files.length) {
      setError('Some files were skipped — only JPEG, PNG, GIF, and WebP are supported.')
    } else {
      setError(null)
    }
    if (valid.length === 0) return
    setImageFiles(prev => [...prev, ...valid])
    setPreviews(prev => [...prev, ...valid.map(f => URL.createObjectURL(f))])
    e.target.value = ''
  }

  function removeImage(idx: number) {
    URL.revokeObjectURL(previews[idx])
    setImageFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      let body: object
      if (mode === 'url') {
        if (!url.trim()) return
        body = { type: 'url', url: url.trim() }
      } else {
        if (imageFiles.length === 0) return
        const compressed = await Promise.all(imageFiles.map(compressImage))
        body = { type: 'image', images: compressed.map(({ base64, mediaType }) => ({ data: base64, mediaType })) }
      }

      const res = await fetch(`${getApiBase()}/ai/extract-recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result?.error || result?.message || `HTTP ${res.status}`)
      if (result?.error) throw new Error(result.error)
      onImported(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = !loading && (mode === 'url' ? !!url.trim() : imageFiles.length > 0)

  const modalRoot = typeof document !== 'undefined' ? document.getElementById('modal-root') : null
  if (!visible || !modalRoot) return null

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import recipe" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Import Recipe</h2>
          <button className="close-btn" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto' }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #e0e0e0)' }}>
          {(['image', 'url'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null) }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: 'none',
                border: 'none',
                borderBottom: mode === m ? '2px solid var(--primary, #c0392b)' : '2px solid transparent',
                fontWeight: mode === m ? 600 : 400,
                cursor: 'pointer',
                color: mode === m ? 'var(--primary, #c0392b)' : 'var(--muted, #666)',
                fontSize: '0.95rem',
              }}
            >
              {m === 'url' ? 'From URL' : 'From Image'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          {mode === 'url' ? (
            <>
              <label htmlFor="import-url" style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                Recipe page URL
              </label>
              <input
                ref={urlInputRef}
                id="import-url"
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.allrecipes.com/recipe/..."
                required
                disabled={loading}
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
              />
            </>
          ) : (
            <>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                Recipe image{imageFiles.length !== 1 ? 's' : ''}{' '}
                <span style={{ fontWeight: 400, color: 'var(--muted, #666)', fontSize: '0.85rem' }}>
                  (add front &amp; back of a recipe card)
                </span>
              </label>

              {previews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {previews.map((src, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={src} alt={`Image ${i + 1}`} style={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        aria-label={`Remove image ${i + 1}`}
                        style={{
                          position: 'absolute', top: -6, right: -6,
                          background: 'var(--primary, #c0392b)', color: '#fff',
                          border: 'none', borderRadius: '50%',
                          width: 20, height: 20, fontSize: 12, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="secondary"
                style={{ width: '100%', marginBottom: 12 }}
              >
                {imageFiles.length === 0 ? 'Choose photo(s)' : 'Add another photo'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onChange={handleFileChange}
                disabled={loading}
                style={{ display: 'none' }}
              />
            </>
          )}

          {error && (
            <p style={{ color: 'var(--error, #c00)', marginBottom: 16, fontSize: '0.9rem' }}>{error}</p>
          )}

          {loading ? (
            <LoadingSpinner message="Simmering…" size={40} />
          ) : (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary" disabled={!canSubmit}>Import</button>
            </div>
          )}
        </form>
      </div>
    </div>,
    modalRoot
  )
}
