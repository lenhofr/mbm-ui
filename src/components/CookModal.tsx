import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'

export default function CookModal({ visible, onClose, recipe }: { visible: boolean; onClose: () => void; recipe?: Recipe | null }) {
  const root = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium')
  // Images displayed by default in cook view
  const modalRef = React.useRef<HTMLDivElement | null>(null)
  const lastFocused = React.useRef<HTMLElement | null>(null)
  const touchStart = React.useRef<{ x: number; y: number; scrollTop: number } | null>(null)

  useEffect(() => {
    if (visible) {
      // reset preferences when opening
  setFontSize('medium')
      // save focus and move focus into modal
      lastFocused.current = document.activeElement as HTMLElement | null
      setTimeout(() => {
        const el = modalRef.current?.querySelector('button, [href], input, textarea, select') as HTMLElement | null
        el?.focus()
      }, 0)
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
      className={`modal cook-modal cook-fullscreen ${fontSize}`}
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
        <button className="cook-close-fab" aria-label="Close" onClick={onClose}>✕</button>
        <div className="cook-toolbar" role="toolbar" aria-label="Cook view controls">
          <div className="cook-actions">
            <div className="icon-group" role="group" aria-label="Reading controls">
              <button
                className="icon-btn"
                onClick={() => setFontSize(s => s === 'small' ? 'small' : s === 'medium' ? 'small' : 'medium')}
                aria-label="Decrease font size"
                title="Decrease font size"
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M6 12.75h12v-1.5H6v1.5Z"/>
                </svg>
              </button>
              <button
                className="icon-btn"
                onClick={() => setFontSize(s => s === 'large' ? 'large' : s === 'medium' ? 'large' : 'medium')}
                aria-label="Increase font size"
                title="Increase font size"
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M11.25 6v5.25H6v1.5h5.25V18h1.5v-5.25H18v-1.5h-5.25V6h-1.5Z"/>
                </svg>
              </button>
              <button
                className="icon-btn icon-btn-print"
                onClick={handlePrint}
                aria-label="Print recipe"
                title="Print"
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M6 8V4h12v4h-2V6H8v2H6Zm12 3h2a2 2 0 0 1 2 2v5h-4v2H6v-2H2v-5a2 2 0 0 1 2-2h2v2H4v3h16v-3h-2v-2Zm-2 9v-6H8v6h8Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="cook-content" style={{paddingTop:12}}>
          <header style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
            <h2 id="cook-title" style={{margin:0}}>{recipe.title}</h2>
            <div style={{marginLeft:'auto',color:'#8b6b7a'}}>{recipe.servings ? `${recipe.servings} servings` : ''}</div>
          </header>

          {/* Intentionally no image in cook view for focus and simplicity */}

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
