import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import { fill, talk } from '../lib/kitchenTalk'

/** Matches any line of a copy bank (after filling placeholders) as the element's full text. */
const oneOf = (bank: readonly string[], vars: Record<string, string> = {}) => {
  const lines = bank.map(l => fill(l, vars))
  return (_: string, el: Element | null) => !!el && lines.includes(el.textContent?.trim() ?? '') && !Array.from(el.children).some(c => lines.includes(c.textContent?.trim() ?? ''))
}

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

  it('cook mode is one page: tap steps to mark done, no step timers', async () => {
    window.sessionStorage.clear()
    at('/recipe/cookies/cook')
    expect(await screen.findByText('0 of 3 steps done')).toBeInTheDocument()
    expect(screen.getByText('2 1/4 cups all-purpose flour')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next step/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Step 1' }))
    expect(screen.getByText('1 of 3 steps done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Step 1, done' })).toBeInTheDocument()
    // Step 3 bakes for 9 minutes, but timers were removed from cook mode.
    expect(screen.queryByRole('button', { name: /timer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Step 3' })).toBeInTheDocument()
    // Ticking every step swaps the counter for a nudge to finish.
    fireEvent.click(screen.getByRole('button', { name: 'Step 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Step 3' }))
    expect(screen.getByText(talk.cookAllDone)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText(oneOf(talk.cookDoneTitle))).toBeInTheDocument()
    expect(screen.getByText(oneOf(talk.cookDoneSub, { title: 'Choco Chip Cookies' }))).toBeInTheDocument()
  })

  it('cook page reflects servings scaled on the recipe page', async () => {
    at('/recipe/cookies')
    await screen.findByText('2 1/4 cups all-purpose flour')
    for (let k = 0; k < 24; k++) fireEvent.click(screen.getByRole('button', { name: 'More servings' }))
    fireEvent.click(screen.getByRole('button', { name: /start cooking/i }))
    expect(await screen.findByText('4½ cups all-purpose flour')).toBeInTheDocument()
    expect(screen.getByText(/serves 48/)).toBeInTheDocument()
    expect(screen.getByText('· scaled')).toBeInTheDocument()
  })

  it('ingredient link opens the quick view without navigating', async () => {
    at('/')
    fireEvent.click(await screen.findByRole('button', { name: '2 ingredients' }))
    expect(window.location.pathname).toBe('/')
    expect(screen.getByText('Tap what you already have')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('2 large eggs'))
    expect(screen.getByText(/Missing 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('2 1/4 cups all-purpose flour'))
    expect(screen.getByText(talk.haveEverything)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }))
    expect(window.location.pathname).toBe('/recipe/cookies')
  })

  it('long-press opens the quick view and swallows the click; a quick tap still opens the recipe', async () => {
    at('/')
    const card = (await screen.findByRole('button', { name: 'Choco Chip Cookies' })).closest('.rcard')!
    const img = screen.getByRole('button', { name: 'Choco Chip Cookies' })
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(card)
      vi.advanceTimersByTime(300)
      fireEvent.pointerUp(card)
      vi.advanceTimersByTime(500)
      expect(screen.queryByText('Tap what you already have')).not.toBeInTheDocument()

      fireEvent.pointerDown(card)
      vi.advanceTimersByTime(460)
      fireEvent.pointerUp(card)
      fireEvent.click(img)
    } finally {
      vi.useRealTimers()
    }
    expect(screen.getByText('Tap what you already have')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')

    fireEvent.click(img)
    expect(window.location.pathname).toBe('/recipe/cookies')
  })

  it('Home search shows matching quick tips inline from 3 characters', async () => {
    at('/')
    const search = await screen.findByPlaceholderText('Search title, tag or ingredient')
    fireEvent.change(search, { target: { value: 'eg' } })
    await new Promise(r => setTimeout(r, 300))
    expect(screen.queryByText('Quick tip')).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'egg' } })
    expect(await screen.findByText('Quick tip')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Boiled eggs' })).toBeInTheDocument()
    // No recipe matches "egg" by title, but the cookies use eggs: count + grid stay as before.
    expect(screen.getByText(/1 recipe/)).toBeInTheDocument()
  })

  it('a tip match shows alongside the empty state when no recipe matches', async () => {
    at('/')
    fireEvent.change(await screen.findByPlaceholderText('Search title, tag or ingredient'), { target: { value: 'bacon' } })
    expect(await screen.findByRole('heading', { name: 'Oven bacon' })).toBeInTheDocument()
    expect(screen.getByText(oneOf(talk.noMatch, { q: 'bacon' }))).toBeInTheDocument()
  })

  it('Quick tips sheet groups tips and filters them', async () => {
    at('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Quick tips' }))
    const filter = screen.getByPlaceholderText('Filter tips')
    expect(filter).not.toHaveFocus()
    expect(screen.getByRole('region', { name: 'Temps & conversions' })).toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'chicken' } })
    expect(screen.getByRole('region', { name: 'Eggs & poultry' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Vegetables' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Boiled eggs' })).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText(fill(talk.tipsEmpty, { q: 'zzz' }))).toBeInTheDocument()
  })

  it('Favorites has no Quick tips link', async () => {
    at('/favorites')
    await screen.findByText(/recipes?$/)
    expect(screen.queryByRole('button', { name: 'Quick tips' })).not.toBeInTheDocument()
  })

  it('new recipe save is disabled until there is a title', async () => {
    at('/new')
    const save = await screen.findByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Toast' } })
    await waitFor(() => expect(save).not.toBeDisabled())
  })
})
