import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'

export default function CookModal({ visible, onClose, recipe }: { visible: boolean; onClose: () => void; recipe?: Recipe | null }) {
  const root = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [highContrast, setHighContrast] = useState(false)
  // Start with images hidden by default for print-preview friendliness
  const [showImages, setShowImages] = useState(false)
  const modalRef = React.useRef<HTMLDivElement | null>(null)
  const lastFocused = React.useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (visible) {
      // reset preferences when opening
      setFontSize('medium')
      setHighContrast(false)
      setShowImages(false)
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
        className={`modal cook-modal cook-fullscreen ${fontSize} ${highContrast ? 'high-contrast' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        aria-labelledby="cook-title"
        ref={modalRef}
      >
        <div className="cook-toolbar" role="toolbar" aria-label="Cook view controls">
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn-ghost" onClick={onClose} aria-label="Close cook view">Close</button>
            <button className="btn-ghost" onClick={handlePrint} aria-label="Print recipe">Print</button>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <label style={{display:'flex',alignItems:'center',gap:6}}>
              <span className="sr-only">Font size</span>
              <button className="btn-ghost" onClick={() => setFontSize(s => s === 'small' ? 'small' : s === 'medium' ? 'small' : 'medium')} aria-label="Decrease font size">A−</button>
            </label>
            <label style={{display:'flex',alignItems:'center',gap:6}}>
              <button className="btn-ghost" onClick={() => setFontSize(s => s === 'large' ? 'large' : s === 'medium' ? 'large' : 'medium')} aria-label="Increase font size">A+</button>
            </label>
            <button className="btn-ghost" onClick={() => setHighContrast(h => !h)} aria-pressed={highContrast} aria-label="Toggle high contrast">Contrast</button>
            <button className="btn-ghost" onClick={() => setShowImages(i => !i)} aria-pressed={!showImages} aria-label="Toggle images for print">Images</button>
          </div>
        </div>

        <div className="cook-content" style={{paddingTop:12}}>
          <header style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
            <h2 id="cook-title" style={{margin:0}}>{recipe.title}</h2>
            <div style={{marginLeft:'auto',color:'#8b6b7a'}}>{recipe.servings ? `${recipe.servings} servings` : ''}</div>
          </header>

          {showImages && recipe.image && (
            <div style={{marginBottom:12}}>
              <img src={(() => {
                const viteBase = (import.meta as any).env?.VITE_API_BASE as string | undefined
                const legacyBase = (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE) as string | undefined
                const apiBase = (viteBase || legacyBase || '').trim()
                if (!/^(https?:|data:|blob:)/i.test(recipe.image || '') && apiBase) {
                  return `${apiBase}/images/${encodeURIComponent(recipe.image)}`
                }
                return recipe.image
              })()} alt={recipe.title} style={{width:'100%',borderRadius:8,maxHeight:'40vh',objectFit:'cover'}}/>
            </div>
          )}

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
