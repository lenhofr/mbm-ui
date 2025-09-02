import React from 'react'

export default function Hero({ onAdd, authControl }: { onAdd?: () => void; authControl?: React.ReactNode }) {
  return (
    <div className="hero-card">
      <div className="hero-inner">
        {authControl ? (
          <div className="hero-top">
            {authControl}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 24, lineHeight: 1 }}>💕</div>
        </div>
        <h1 className="hero-title">Meals by Maggie</h1>
        <p className="hero-tagline">A cozy place to collect your favorite recipes</p>
        {onAdd && (
          <button className="btn-ghost hero-cta-ghost" onClick={onAdd} aria-label="Add recipe">
            <span className="hero-emoji">✨</span>
            Add Your First Recipe
          </button>
        )}
      </div>
    </div>
  )
}
