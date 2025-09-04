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
  const shouldClose = React.useRef(false)
  const maxFollow = 40 // px of visual follow before we consider dismissal

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
    // cleanup transition after it runs
    setTimeout(() => { if (el) el.style.transition = '' }, 180)
  }

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
      // save last focus and move focus to the dialog container (avoid focusing toolbar buttons)
      lastFocused.current = document.activeElement as HTMLElement | null
      setTimeout(() => { modalRef.current?.focus() }, 0)
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
        tabIndex={-1}
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
          // Only when scrolled to top, and a mostly vertical downward swipe beyond threshold
          const atTop = start.scrollTop <= 0
          const verticalDominant = Math.abs(dy) > Math.abs(dx) * 1.6
          const draggingDown = dy > 0
          const threshold = Math.max(140, Math.min(220, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.22))
          if (atTop && draggingDown && verticalDominant && dy > threshold) {
            shouldClose.current = true
          } else {
            shouldClose.current = false
          }
          // Apply a subtle follow effect for the first ~40px when dragging down at top
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
        {/* Small centered grabber to hint drag-to-close */}
        <div className="modal-grabber-wrap" aria-hidden="true">
          <div className="modal-grabber" />
        </div>
        {/* Sticky actions only (top-right); title/meta move into scrollable content */}
        <div className="cook-actions-sticky" aria-label="Recipe actions">
          <div className="cook-toolbar-actions">
            <button className="cook-mode-btn" title="Toggle cook mode" aria-label="Toggle cook mode" onClick={() => setCookMode(s => !s)}>
              {Phosphor?.CookingPot ? <Phosphor.CookingPot size={20} weight="regular" /> : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 10h20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
            {onEdit && (
              <button className="cook-edit-btn" title="Edit recipe" aria-label="Edit recipe" onClick={() => onEdit(recipe as Recipe)}>
                {Phosphor?.Pencil ? <Phosphor.Pencil size={20} weight="regular" /> : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 21v-3.6a2.4 2.4 0 0 1 .7-1.7L14.2 5.2a2 2 0 0 1 2.8 0l1.8 1.8a2 2 0 0 1 0 2.8L7.3 21.3A2.4 2.4 0 0 1 5.6 22H3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.7 6.3l2.9 2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </button>
            )}
            <button className="cook-close-fab" aria-label="Close cook view" onClick={onClose}>
              {Phosphor?.X ? <Phosphor.X size={20} weight="regular" /> : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          </div>
        </div>
  {/* Read controls removed from initial view modal per design — cook mode toggle and edit remain */}

          <div className="cook-content">
          <div className="cook-header">
            <h2 id="cook-title" className="cook-title" title={recipe.title}>{recipe.title}</h2>
            <div className="cook-meta">{recipe.servings ? `${recipe.servings} servings` : ''}{recipe.cookTime ? ` • ${recipe.cookTime}` : ''}</div>
            <div className="cook-summary-row">
            {recipe.image ? <img className="cook-image" src={((): string => {
              const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
              const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
              const apiBase = (viteBase || legacyBase || '').trim()
              if (!/^(https?:|data:|blob:)/i.test(recipe.image || '') && apiBase) return `${apiBase}/images/${encodeURIComponent(recipe.image as string)}`
              return recipe.image as string
            })()} alt={recipe.title} /> : null}

            <div className="cook-summary">
              {recipe.description ? <p style={{marginTop:6,marginBottom:6}}>{recipe.description}</p> : null}
              {recipe.tags?.length ? <div className="cook-tags">{recipe.tags.map(t => <span key={t} className="tag">{t}</span>)}</div> : null}
            </div>
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
