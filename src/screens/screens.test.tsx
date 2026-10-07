import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

const RECIPES = [
  {
    id: 'cookies', title: 'Choco Chip Cookies', description: 'Secret recipe', tags: ['Dessert'], servings: '24', cookTime: '22 min',
    ingredients: [{ amount: '2 1/4 cups', name: 'all-purpose flour' }, { amount: '2', name: 'large eggs' }],
    instructions: ['Preheat oven to 375° F.', 'Beat in eggs, then flour.', 'Bake for 9 to 11 minutes.'],
  },
  { id: 'chili', title: "Nana's Chili", tags: ['dinner'], servings: '8' },
]

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('mobile screens', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('mbm:recipes', JSON.stringify(RECIPES))
  })

  it('home lists recipes, filters by lowercase tag and favorites', async () => {
    at('/')
    expect(await screen.findByText('Choco Chip Cookies')).toBeInTheDocument()
    expect(screen.getByText('2 recipes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'dessert' }))
    expect(screen.getByText('1 recipe')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to favorites' })[1])
    fireEvent.click(screen.getByRole('link', { name: /favorites/i }))
    expect(await screen.findByText("Nana's Chili")).toBeInTheDocument()
    expect(screen.queryByText('Choco Chip Cookies')).not.toBeInTheDocument()
  })

  it('detail scales ingredients with the servings stepper', async () => {
    at('/recipe/cookies')
    expect(await screen.findByText('2 1/4 cups all-purpose flour')).toBeInTheDocument()
    for (let k = 0; k < 24; k++) fireEvent.click(screen.getByRole('button', { name: 'More servings' }))
    expect(screen.getByText('4½ cups all-purpose flour')).toBeInTheDocument()
    expect(screen.getByText('· scaled')).toBeInTheDocument()
  })

  it('cook mode steps through, shows used ingredients and a timer', async () => {
    at('/recipe/cookies/cook')
    expect(await screen.findByText('Preheat oven to 375° F.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next step/i }))
    expect(screen.getByText('2 large eggs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next step/i }))
    expect(screen.getByRole('button', { name: /start 9 min timer/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Nice work')).toBeInTheDocument()
  })

  it('new recipe save is disabled until there is a title', async () => {
    at('/new')
    const save = await screen.findByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Toast' } })
    await waitFor(() => expect(save).not.toBeDisabled())
  })
})
