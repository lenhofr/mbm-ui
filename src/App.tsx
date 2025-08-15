import React, { useState } from 'react'
import RecipeList from './components/RecipeList'
import RecipeForm from './components/RecipeForm'
import DetailsModal from './components/DetailsModal'
import ConfirmDialog from './components/ConfirmDialog'
import CookModal from './components/CookModal'

export type Recipe = {
  id: string
  title: string
  description?: string
  image?: string
  tags?: string[]
  ingredients?: { name: string; amount?: string }[]
  servings?: string
  instructions?: string[]
}

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([
    { id: '1', title: 'Spaghetti Bolognese', description: 'Classic Italian pasta.' },
    { id: '2', title: 'Roast Chicken', description: 'Crispy skin, juicy meat.' },
  ])

  function addRecipe(r: Omit<Recipe, 'id'>) {
    setRecipes(s => [{ id: String(Date.now()), ...r }, ...s])
  }

  const [editing, setEditing] = useState<Recipe | null>(null)

  function updateRecipe(r: Omit<Recipe, 'id'>, id?: string) {
    if (!id) return
    setRecipes(s => s.map(item => (item.id === id ? { ...item, ...r } : item)))
    setEditing(null)
  }

  function startEdit(recipe: Recipe) {
    setEditing(recipe)
  }

  const [viewing, setViewing] = useState<Recipe | null>(null)

  function startView(recipe: Recipe) {
    setViewing(recipe)
  }

  const [deleting, setDeleting] = useState<Recipe | null>(null)

  function requestDelete(recipe: Recipe) {
    setDeleting(recipe)
  }

  function confirmDelete() {
    if (!deleting) return
    setRecipes(s => s.filter(r => r.id !== deleting.id))
    setDeleting(null)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Meals by Maggie</h1>
        <p className="subtitle">A cozy place to collect your favorite recipes</p>
      </header>

      <main>
        <section className="left">
          <RecipeForm onAdd={addRecipe} />
        </section>
        <section className="right">
          <RecipeList recipes={recipes} onEdit={startEdit} onDelete={requestDelete} onView={startView} />
        </section>
      </main>

      {editing && (
        <DetailsModal visible={true} onClose={() => setEditing(null)} onSave={updateRecipe} initialRecipe={editing} />
      )}

      <ConfirmDialog visible={!!deleting} title="Delete recipe" message={`Delete "${deleting?.title}"?`} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />

  {viewing && <CookModal visible={!!viewing} onClose={() => setViewing(null)} recipe={viewing} />}

      <footer className="app-footer">Built with ❤️ — local UI scaffold</footer>
    </div>
  )
}
