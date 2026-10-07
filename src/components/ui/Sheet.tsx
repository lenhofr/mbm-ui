import React, { useEffect, useRef, useState } from 'react'
import './ui.css'

/** Bottom sheet: slides up over a scrim; tapping the scrim or swiping down dismisses. */
export default function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
    setDrag(0)
    const t = setTimeout(() => setMounted(false), 340)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null
  return (
    <div className={'sheet-wrap' + (shown ? ' shown' : '')}>
      <div className="sheet-scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        className={'sheet' + (drag ? ' dragging' : '')}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onTouchStart={e => {
          // Only start a dismiss drag when the sheet's own content is scrolled to the top.
          startY.current = (sheetRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null
        }}
        onTouchMove={e => {
          if (startY.current == null) return
          setDrag(Math.max(0, e.touches[0].clientY - startY.current))
        }}
        onTouchEnd={() => {
          if (startY.current != null && drag > 90) onClose()
          else setDrag(0)
          startY.current = null
        }}
        onTouchCancel={() => { startY.current = null; setDrag(0) }}
      >
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  )
}
