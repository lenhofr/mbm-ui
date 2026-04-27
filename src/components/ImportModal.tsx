import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '../hooks/useScrollLock'
import { getApiBase } from '../lib/env'
import type { Recipe } from '../App'

type Mode = 'url' | 'image'

type Props = {
  visible: boolean
  authHeader: () => Record<string, string>
  onClose: () => void
  onImported: (recipe: Omit<Recipe, 'id'>) => void
}

const SUPPORTED_TYPES: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ImportModal({ visible, authHeader, onClose, onImported }: Props) {
  useScrollLock(visible)
  const [mode, setMode] = useState<Mode>('url')
  const [url, setUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setUrl('')
      setImageFile(null)
      setImagePreview(null)
      setError(null)
      setMode('url')
    }
  }, [visible])

  useEffect(() => {
    if (visible && mode === 'url') {
      setTimeout(() => urlInputRef.current?.focus(), 50)
    }
  }, [visible, mode])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (!file) return
    if (!SUPPORTED_TYPES[file.type]) {
      setError('Unsupported file type. Please use JPEG, PNG, GIF, or WebP.')
      return
    }
    setError(null)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
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
        if (!imageFile) return
        const data = await fileToBase64(imageFile)
        body = { type: 'image', data, mediaType: imageFile.type }
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

  const canSubmit = !loading && (mode === 'url' ? !!url.trim() : !!imageFile)

  const modalRoot = typeof document !== 'undefined' ? document.getElementById('modal-root') : null
  if (!visible || !modalRoot) return null

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Import recipe" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Import Recipe</h2>
          <button className="close-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #e0e0e0)' }}>
          {(['url', 'image'] as Mode[]).map(m => (
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
                Recipe image
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed var(--border, #ccc)',
                  borderRadius: 8,
                  padding: 20,
                  textAlign: 'center',
                  cursor: 'pointer',
                  marginBottom: 16,
                  background: 'var(--surface, #fafafa)',
                }}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 4 }} />
                ) : (
                  <p style={{ margin: 0, color: 'var(--muted, #666)', fontSize: '0.9rem' }}>
                    Tap to choose a photo (JPEG, PNG, WebP, GIF)
                  </p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileChange}
                disabled={loading}
                style={{ display: 'none' }}
              />
              {imageFile && (
                <p style={{ fontSize: '0.85rem', color: 'var(--muted, #666)', marginBottom: 16 }}>
                  {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
                </p>
              )}
            </>
          )}

          {error && (
            <p style={{ color: 'var(--error, #c00)', marginBottom: 16, fontSize: '0.9rem' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="primary" disabled={!canSubmit}>
              {loading ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    modalRoot
  )
}
