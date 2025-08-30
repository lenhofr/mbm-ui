import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function ConfirmDialog({
  visible,
  title = 'Are you sure?',
  message,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  title?: string
  message?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const root = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    if (visible) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onCancel])

  if (!visible || !root) return null

  return createPortal(
    <div className="modal-backdrop" role="alertdialog" aria-modal="true">
      <div className="modal small bg-gradient-card border-none shadow-card">
        <h3 className="text-primary">{title}</h3>
        {message && <p style={{color:'#544'}}>{message}</p>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    root
  )
}
