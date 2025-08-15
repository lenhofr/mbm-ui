import React from 'react'
import { createPortal } from 'react-dom'
import type { Recipe } from '../App'

export default function CookModal({ visible, onClose, recipe }: { visible: boolean; onClose: () => void; recipe?: Recipe | null }) {
  const root = (typeof document !== 'undefined' && document.getElementById('modal-root')) || null
  if (!visible || !root || !recipe) return null

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cook-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
          <h2 style={{margin:0}}>{recipe.title}</h2>
          <div style={{marginLeft:'auto',color:'#8b6b7a'}}>{recipe.servings ? `${recipe.servings} servings` : ''}</div>
        </header>
        {recipe.image && <div style={{marginBottom:12}}><img src={recipe.image} alt={recipe.title} style={{width:'100%',borderRadius:8,maxHeight:'40vh',objectFit:'cover'}}/></div>}
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
            <ol>
              {recipe.instructions.map((step, i) => (
                <li key={i} style={{marginBottom:8}}>{step}</li>
              ))}
            </ol>
          </section>
        ) : null}

        <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    root
  )
}
