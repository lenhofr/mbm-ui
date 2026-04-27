import React, { useState, useRef, useEffect } from 'react'
import { useScrollLock } from '../hooks/useScrollLock'
import { getApiBase } from '../lib/env'
import type { Recipe } from '../App'

type Props = {
  visible: boolean
  authHeader: () => Record<string, string>
  onClose: () => void
  onImported: (recipe: Omit<Recipe, 'id'>) => void
}

export default function ImportModal({ visible, authHeader, onClose, onImported }: Props) {
  useScrollLock(visible)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setUrl('')
      setError(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [visible])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBase()}/ai/extract-recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ type: 'url', url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      if (data?.error) throw new Error(data.error)
      onImported(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!visible) return null

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Import recipe from URL" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Import Recipe from URL</h2>
          <button className="close-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <label htmlFor="import-url" style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
            Recipe page URL
          </label>
          <input
            ref={inputRef}
            id="import-url"
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://www.allrecipes.com/recipe/..."
            required
            disabled={loading}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
          />
          {error && (
            <p style={{ color: 'var(--error, #c00)', marginBottom: 16, fontSize: '0.9rem' }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="primary" disabled={loading || !url.trim()}>
              {loading ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
