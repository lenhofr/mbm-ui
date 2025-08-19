import React from 'react'
import heroImage from '../assets/recipe-hero.jpg'

export default function Hero({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="hero" style={{ backgroundImage: `var(--gradient-hero), url(${heroImage})`, backgroundBlendMode: 'overlay' }}>
      <div className="hero-inner">
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 36 }}>💕</div>
        </div>
        <h1 className="hero-title">Meals by Maggie</h1>
        <p className="hero-tagline">A cozy place to collect your favorite recipes</p>
        {onAdd && (
          <button className="hero-cta" onClick={onAdd} aria-label="Add recipe">
            <span className="hero-emoji">✨</span>
            Add Your First Recipe
          </button>
        )}
      </div>
    </div>
  )
}
