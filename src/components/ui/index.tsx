import React, { useState } from 'react'
import { Icon, type IconName } from '../../icons/Icons'
import { resolveImageUrl } from '../../lib/images'
import './ui.css'

export function GlassButton({ icon, onClick, label, active, dark, filled }: { icon: IconName; onClick: () => void; label: string; active?: boolean; dark?: boolean; filled?: boolean }) {
  return (
    <button type="button" className={'glass-btn' + (dark ? ' dark' : '') + (active ? ' active' : '')} onClick={onClick} aria-label={label} aria-pressed={active}>
      <Icon name={icon} size={20} filled={filled} weight="bold" />
    </button>
  )
}

export function Toast({ msg }: { msg: { text: string; k: number } | null }) {
  if (!msg) return null
  return (
    <div className="toast" key={msg.k} role="status">
      <Icon name="check" size={18} weight="bold" />
      {msg.text}
    </div>
  )
}

/** Recipe image with a striped monogram fallback when there's no photo (or it fails to load). */
export function RecipeThumb({ title, image, className }: { title: string; image?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = resolveImageUrl(image)
  if (!src || failed) {
    return (
      <div className={'rimg noimg ' + (className || '')} aria-hidden>
        <span>{(title || '?').charAt(0)}</span>
      </div>
    )
  }
  return (
    <div className={'rimg ' + (className || '')}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, small, label }: { value: number; onChange: (n: number) => void; min?: number; small?: boolean; label: string }) {
  return (
    <div className={'stepper' + (small ? ' sm' : '')} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer ${label.toLowerCase()}`}>
        <Icon name="minus" size={small ? 16 : 18} weight="bold" />
      </button>
      <b aria-live="polite">{value}</b>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`More ${label.toLowerCase()}`}>
        <Icon name="plus" size={small ? 16 : 18} weight="bold" />
      </button>
    </div>
  )
}
