import React from 'react'
import { Icon } from '../icons/Icons'
import { ingredientText } from '../lib/quantity'
import './IngredientChecklist.css'

/**
 * Tappable ingredient rows. `used` (recipe + cook pages): plum check + strikethrough.
 * `have` (pantry quick view): green check + muted text, no strikethrough.
 */
export default function IngredientChecklist({
  ingredients,
  checked,
  onToggle,
  mult = 1,
  variant = 'used',
  large,
}: {
  ingredients: { name: string; amount?: string }[]
  checked: Set<number>
  onToggle: (i: number) => void
  mult?: number
  variant?: 'used' | 'have'
  large?: boolean
}) {
  return (
    <ul className={`ing-list ${variant}` + (large ? ' lg' : '')}>
      {ingredients.map((ing, i) => (
        <li key={i} className={checked.has(i) ? 'done' : ''}>
          <label>
            <input type="checkbox" className="sr-only" checked={checked.has(i)} onChange={() => onToggle(i)} />
            <span className="cbox" aria-hidden>{checked.has(i) && <Icon name="check" size={14} weight="bold" />}</span>
            <span className="ing-text">{ingredientText(ing, mult)}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

export function toggleIn(set: Set<number>, i: number): Set<number> {
  const next = new Set(set)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}
