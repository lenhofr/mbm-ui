import React, { useState } from 'react'
import DetailsModal from './DetailsModal'
import type { Recipe } from '../App'

export default function RecipeForm({ onAdd, authed, onLogin }: { onAdd: (r: Omit<Recipe, 'id'>) => void; authed: boolean; onLogin: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  function quickAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    // open details modal to collect more info
    setModalOpen(true)
  }

  function onSave(details: Omit<Recipe, 'id'>) {
    onAdd(details)
    setTitle('')
    setDescription('')
  }

  return (
    <>
      {authed ? (
        <>
          <form className="recipe-form bg-gradient-card border-none shadow-card" onSubmit={quickAdd}>
            <h2>✨ Add Recipe</h2>
            <label>
              Title
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Chocolate Cake" />
            </label>
            <label>
              Description
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
            </label>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button type="submit" className="primary">Add</button>
            </div>
          </form>

          <DetailsModal
            visible={modalOpen}
            onClose={() => setModalOpen(false)}
            onSave={(r) => onSave(r)}
            initialRecipe={{ title, description }}
          />
        </>
      ) : (
  <div className="recipe-form bg-gradient-card border-none shadow-card" style={{opacity:0.9}}>
          <h2>✨ Add Recipe</h2>
          <p style={{color:'var(--muted)', marginBottom:12}}>Log in to add, edit, or delete recipes.</p>
          <button type="button" className="primary" onClick={onLogin}>Log in</button>
        </div>
      )}
    </>
  )
}
