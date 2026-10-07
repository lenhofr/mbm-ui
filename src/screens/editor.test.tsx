import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../state/AppContext'
import { Editor } from './EditorScreen'
import { draftFromExtract } from '../lib/draft'

const flagged = draftFromExtract({
  readable: true,
  title: "Gram's Cornbread",
  tags: ['bread'],
  ingredients: [
    { text: '1 cup cornmeal' },
    { text: '1 tbsp baking powder', flag: { q: 'Is it tbsp or tsp?', opts: [['1 tbsp baking powder', 'tbsp'], ['1 tsp baking powder', 'tsp']] } },
  ],
  instructions: [{ text: 'Bake 25 minutes.', flag: { q: '20 or 25?', opts: [['Bake 20 minutes.', '20 min'], ['Bake 25 minutes.', '25 min']] } }],
}, 'screenshot')

function renderEditor() {
  return render(<MemoryRouter><AppProvider><Editor initial={flagged} /></AppProvider></MemoryRouter>)
}

describe('editor flags', () => {
  it('counts open flags and resolves them by pill or by hand', () => {
    renderEditor()
    expect(screen.getByText('2 things to check')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'tsp' }))
    expect(screen.getByLabelText('Ingredient 2')).toHaveValue('1 tsp baking powder')
    expect(screen.getByText('1 thing to check')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Step 1'), { target: { value: 'Bake 22 minutes.' } })
    expect(screen.getByText('All checked')).toBeInTheDocument()
    expect(screen.queryByText('20 or 25?')).not.toBeInTheDocument()
  })
})
