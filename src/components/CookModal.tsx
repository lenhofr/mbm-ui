import React, { useState, useEffect } from 'react'
import * as Phosphor from 'phosphor-react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'

export default function CookModal({ visible, onClose, recipe, onEdit }: { visible: boolean; onClose: () => void; recipe?: Recipe | null; onEdit?: (r: Recipe) => void }) {
  const root = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  const [fontSize/*, setFontSize*/] = useState<'small' | 'medium' | 'large'>('medium')
  // font size controls removed from initial view; keep state placeholder for compatibility
  const [cookMode, setCookMode] = useState(false)
  // Images displayed by default in cook view
  const modalRef = React.useRef<HTMLDivElement | null>(null)
  const lastFocused = React.useRef<HTMLElement | null>(null)
  const touchStart = React.useRef<{ x: number; y: number; scrollTop: number } | null>(null)

  // Manage scroll locking with a simple global counter to support multiple modals safely
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
    if (visible) {
      lockScroll()
      // reset preferences when opening; save focus and move focus into modal
      lastFocused.current = document.activeElement as HTMLElement | null
      setTimeout(() => {
        const el = modalRef.current?.querySelector('button, [href], input, textarea, select') as HTMLElement | null
        el?.focus()
      }, 0)
    } else {
      // when hidden, release scroll lock
      unlockScroll()
    }
  }, [visible])

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

  useEffect(() => {
    return () => {
      // restore focus when modal unmounts
      setTimeout(() => lastFocused.current?.focus?.(), 0)
  // ensure scroll is unlocked if unmounting while visible
  unlockScroll()
    }
  }, [])

  if (!visible || !root || !recipe) return null

  function handlePrint() {
    // For print we hide the toolbar via CSS @media print rules
    if (typeof window !== 'undefined' && window.print) window.print()
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div
      className={`modal cook-modal cook-fullscreen ${cookMode ? 'cook-mode-active' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        aria-labelledby="cook-title"
        ref={modalRef}
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (!t || !modalRef.current) return
          touchStart.current = { x: t.clientX, y: t.clientY, scrollTop: modalRef.current.scrollTop }
        }}
        onTouchMove={(e) => {
          const start = touchStart.current
          const t = e.touches[0]
          if (!start || !t || !modalRef.current) return
          const dx = t.clientX - start.x
          const dy = t.clientY - start.y
          // Only when scrolled to top, and a mostly vertical downward swipe beyond threshold
          if (start.scrollTop <= 0 && dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5) {
            touchStart.current = null
            onClose()
          }
        }}
      >
        {/* Mobile-friendly always-visible close button */}
  <button className="cook-close-fab" aria-label="Close cook view" onClick={onClose}>✕</button>
  {/* Cook-mode toggle always present; edit button only when onEdit provided */}
  <button className="cook-mode-btn" title="Toggle cook mode" aria-label="Toggle cook mode" onClick={() => setCookMode(s => !s)}>
  {Phosphor?.ForkKnife ? <Phosphor.ForkKnife size={18} weight="duotone" /> : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 8v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 13h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )}
  </button>
  {onEdit && (
    <button className="cook-edit-btn" title="Edit recipe" aria-label="Edit recipe" onClick={() => onEdit(recipe as Recipe)}>
      {Phosphor?.Pencil ? <Phosphor.Pencil size={18} weight="regular" /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 21v-3.6a2.4 2.4 0 0 1 .7-1.7L14.2 5.2a2 2 0 0 1 2.8 0l1.8 1.8a2 2 0 0 1 0 2.8L7.3 21.3A2.4 2.4 0 0 1 5.6 22H3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.7 6.3l2.9 2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )}
    </button>
  )}
  {/* Read controls removed from initial view modal per design — cook mode toggle and edit remain */}

  <div className="cook-content">
          <div className="cook-header">
            {recipe.image ? <img className="cook-image" src={((): string => {
              const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
              const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
              const apiBase = (viteBase || legacyBase || '').trim()
              if (!/^(https?:|data:|blob:)/i.test(recipe.image || '') && apiBase) return `${apiBase}/images/${encodeURIComponent(recipe.image as string)}`
              return recipe.image as string
            })()} alt={recipe.title} /> : null}

            <div style={{flex:1}}>
              <header style={{display:'flex',gap:12,alignItems:'center',marginBottom:6}}>
                <h2 id="cook-title" style={{margin:0}}>{recipe.title}</h2>
                <div className="cook-meta">{recipe.servings ? `${recipe.servings} servings` : ''}{recipe.cookTime ? ` • ${recipe.cookTime}` : ''}</div>
              </header>
              {recipe.description ? <p style={{marginTop:6,marginBottom:6}}>{recipe.description}</p> : null}
              {recipe.tags?.length ? <div className="cook-tags">{recipe.tags.map(t => <span key={t} className="tag">{t}</span>)}</div> : null}
            </div>
          </div>

          <section style={{marginBottom:12}}>
            <h3>Ingredients</h3>
            <ul>
              {recipe.ingredients?.map((ing, idx) => (
                <li key={idx}>{ing.amount ? `${ing.amount} ` : ''}{ing.name}</li>
              ))}
            </ul>
          </section>

          {recipe.instructions?.length ? (
            <section>
              <h3>Instructions</h3>
              <ol className="cook-instructions">
                {recipe.instructions.map((step, i) => (
                  <li key={i} style={{marginBottom:12}}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

      </div>
    </div>,
    root
  )
}
