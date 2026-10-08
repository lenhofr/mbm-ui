import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './ui/Sheet'
import { RecipeThumb } from './ui'
import IngredientChecklist, { toggleIn } from './IngredientChecklist'
import { Icon } from '../icons/Icons'
import type { Recipe } from '../types'
import { talk } from '../lib/kitchenTalk'
import './QuickView.css'

/** Pantry check: tick the ingredients you already have, without opening the recipe. */
export default function QuickView({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const navigate = useNavigate()
  const [have, setHave] = useState<Set<number>>(() => new Set())
  // Keep showing the last recipe while the sheet animates closed.
  const [shown, setShown] = useState<Recipe | null>(recipe)

  useEffect(() => {
    if (!recipe) return
    setShown(recipe)
    setHave(new Set())
  }, [recipe])

  const r = shown
  const ingredients = r?.ingredients || []
  const total = ingredients.length
  const missing = total - have.size
  const meta = r ? [r.cookTime, r.servings && `serves ${r.servings}`].filter(Boolean).join(' · ') : ''
  const go = (path: string, state?: object) => { onClose(); navigate(path, state ? { state } : undefined) }

  return (
    <Sheet open={!!recipe} onClose={onClose} label={r ? `${r.title} ingredients` : 'Ingredients'}>
      {r && (
        <>
          <div className="qv-head">
            <RecipeThumb title={r.title} image={r.image} className="qv-thumb" />
            <div>
              <h2 className="qv-title">{r.title}</h2>
              {meta && <div className="qv-meta">{meta}</div>}
            </div>
          </div>

          <div className={'qv-summary' + (total > 0 && missing === 0 ? ' all' : '')} aria-live="polite">
            {have.size === 0
              ? 'Tap what you already have'
              : missing === 0
                ? <><Icon name="check" size={16} weight="bold" />{talk.haveEverything}</>
                : <><b>Missing {missing}</b>&nbsp;of {total}</>}
          </div>

          <IngredientChecklist ingredients={ingredients} checked={have} onToggle={i => setHave(h => toggleIn(h, i))} variant="have" />

          <div className="qv-actions">
            <button type="button" className="btn soft lg" onClick={() => go(`/recipe/${encodeURIComponent(r.id)}`)}>Open recipe</button>
            {!!r.instructions?.length && (
              <button type="button" className="btn primary lg" onClick={() => go(`/recipe/${encodeURIComponent(r.id)}/cook`, { mult: 1 })}>
                <Icon name="play" size={16} filled />Start cooking
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
