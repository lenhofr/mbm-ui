import React, { useState } from 'react'
import type { Recipe } from '../App'
import { isAuthenticated, login } from '../lib/auth'

function CardMenu({ recipe, onEdit, onDelete, onView }: { recipe: Recipe; onEdit?: (r: Recipe) => void; onDelete?: (r: Recipe) => void; onView?: (r: Recipe) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  return (
    <div style={{position:'relative'}} ref={rootRef}>
      <button className="btn-ghost" aria-haspopup="menu" aria-expanded={open} aria-label="More options" onClick={() => setOpen(s => !s)}>⋯</button>
      {open && (
        <div style={{position:'absolute',right:0,top:28,background:'white',boxShadow:'0 6px 18px rgba(0,0,0,0.08)',borderRadius:8,padding:8,zIndex:30}}>
          {onView && <div><button className="btn-ghost" onClick={() => { onView(recipe); setOpen(false)} }>Cook</button></div>}
          {onEdit && <div><button className="btn-ghost" onClick={() => { onEdit(recipe); setOpen(false)} }>Edit</button></div>}
          {onDelete && <div><button className="btn-ghost" onClick={() => { onDelete(recipe); setOpen(false)} }>Delete</button></div>}
        </div>
      )}
    </div>
  )
}

function highlight(text: string | undefined, q: string | undefined) {
  if (!text) return null
  if (!q) return text
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
  const parts = text.split(re)
  return parts.map((p, i) => (re.test(p) ? <mark key={i} className="search-highlight">{p}</mark> : <span key={i}>{p}</span>))
}

export default function RecipeList({ recipes, onEdit, onDelete, onView, query }: { recipes: Recipe[]; onEdit?: (r: Recipe) => void; onDelete?: (r: Recipe) => void; onView?: (r: Recipe) => void; query?: string }) {
  const authed = isAuthenticated()
  if (recipes.length === 0) return (
    <div>
      No recipes yet — add one!
      {!authed && (
        <div style={{marginTop:8}}>
          <button className="btn-ghost" onClick={() => login()}>Log in to add</button>
        </div>
      )}
    </div>
  )

  return (
    <div className="recipe-list">
      {recipes.map(r => (
        <article key={r.id} className="recipe-card" onClick={(e) => {
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
              // if image looks like a key (no scheme) and API base is configured, use API proxy
              if (!/^https?:\/\//i.test(r.image || '') && apiBase) {
                return `${apiBase}/images/${encodeURIComponent(r.image as string)}`
              }
              return r.image as string
            })()} alt={r.title} /> : <div className="placeholder">No Image</div>}</div>
            <div className="recipe-body">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
              <h3>{highlight(r.title, query)}</h3>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <small style={{color:'#d36b96',fontWeight:600}}>{r.servings ? `${r.servings} ppl` : ''}</small>
                {(onEdit || onDelete || onView) && authed && (
                  <CardMenu recipe={r} onEdit={onEdit} onDelete={onDelete} onView={onView} />
                )}
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
