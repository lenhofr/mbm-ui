import React from 'react'
import type { Recipe } from '../App'
import { IconEdit, IconDelete } from '../icons/Icons'

function highlight(text: string | undefined, q: string | undefined) {
  if (!text) return null
  if (!q) return text
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
  const parts = text.split(re)
  return parts.map((p, i) => (re.test(p) ? <mark key={i} className="search-highlight">{p}</mark> : <span key={i}>{p}</span>))
}

export default function RecipeList({ recipes, onEdit, onDelete, onView, query, authed, onLogin }: { recipes: Recipe[]; onEdit?: (r: Recipe) => void; onDelete?: (r: Recipe) => void; onView?: (r: Recipe) => void; query?: string; authed?: boolean; onLogin?: () => void }) {
  if (recipes.length === 0) return (
    <div>
      No recipes yet — add one!
    {!authed && (
        <div style={{marginTop:8}}>
      <button className="btn-ghost" onClick={onLogin}>Log in to add</button>
        </div>
      )}
    </div>
  )

  return (
    <div className="recipe-list">
      {recipes.map(r => (
        <article key={r.id} className="recipe-card bg-gradient-card border-none shadow-card" onClick={(e) => {
          // prevent clicks from buttons/menus from opening view
          const target = e.target as HTMLElement
          if (target.closest('button') || target.closest('a')) return
          onView && onView(r)
        }}>
          <div className="recipe-image">{
              r.image ? <img src={(() => {
              const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
              const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
              const apiBase = (viteBase || legacyBase || '').trim()
              const img = r.image as string
              // If stored value is a key (no scheme), proxy through API to get a fresh redirect
              if (!/^(https?:|data:|blob:)/i.test(img || '') && apiBase) {
                return `${apiBase}/images/${encodeURIComponent(img)}`
              }
              // If it's a presigned S3 URL, try to extract the key and use API route
              try {
                const u = new URL(img)
                const host = u.hostname
                const isAws = /amazonaws\.com$/i.test(host)
                const hasSig = u.search.includes('X-Amz-')
                if (apiBase && isAws && hasSig) {
                  let key = u.pathname.replace(/^\//, '')
                  // path-style: s3.amazonaws.com/bucket/key -> drop first segment
                  if (/^s3[.-]([^/]+\.)?amazonaws\.com$/i.test(host)) {
                    const firstSlash = key.indexOf('/')
                    if (firstSlash > 0) key = key.slice(firstSlash + 1)
                  }
                  return `${apiBase}/images/${encodeURIComponent(key)}`
                }
              } catch {}
              return img
            })()} alt={r.title} /> : <div className="placeholder">No Image</div>}</div>
            <div className="recipe-body">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
              <h3>{highlight(r.title, query)}</h3>
              <div className="recipe-card-actions">
                {authed && onEdit && <button onClick={() => onEdit(r)} className="btn-ghost" aria-label="Edit"><IconEdit /></button>}
                {authed && onDelete && <button onClick={() => onDelete(r)} className="btn-ghost" aria-label="Delete"><IconDelete /></button>}
              </div>
            </div>
            <p>{highlight(r.description, query) || r.description}</p>
            {r.tags?.length ? (
              <div className="tag-list">
                {r.tags.map(t => (
                  <span key={t} className="tag">{t}</span>
                ))}
              </div>
            ) : null}
            {r.ingredients?.length ? (
              <details style={{marginTop:8}} onClick={(e) => e.stopPropagation()}>
                <summary style={{cursor:'pointer',color:'var(--muted)'}}>Show ingredients</summary>
                <ul style={{marginTop:8}}>
                  {r.ingredients.map((ing, idx) => (
                    <li key={idx}>{ing.amount ? `${ing.amount} ` : ''}{ing.name}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}
