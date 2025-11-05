import React from 'react'
import { IconCookMode } from '../icons/Icons'
import './CookSpinner.css'

export default function CookSpinner({ size = 32, label = 'Loading image…' }: { size?: number; label?: string }) {
  return (
    <div className="cook-spinner" role="status" aria-label={label}>
      <div className="cook-spinner-pot">
        <IconCookMode size={size} weight="regular" />
      </div>
    </div>
  )
}
