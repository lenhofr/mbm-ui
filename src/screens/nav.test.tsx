import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import App from '../App'

// Signed in, so the Edit button shows and saving isn't blocked by the login prompt.
vi.mock('../hooks/useCognitoAuth', () => ({
  useCognitoAuth: () => ({
    isAuthed: true, loading: false, user: { sub: 'u1' }, authHeader: () => ({}),
    signIn: vi.fn(), signOut: vi.fn(), signUp: vi.fn(), confirmSignUp: vi.fn(), refresh: vi.fn(),
  }),
}))

const RECIPES = [{
  id: 'cookies', title: 'Choco Chip Cookies', servings: '24',
  ingredients: [{ amount: '2', name: 'large eggs' }],
  instructions: ['Preheat oven.', 'Bake 10 minutes.'],
}]

async function openRecipeFromHome() {
  window.history.pushState({}, '', '/')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choco Chip Cookies' }))
  await waitFor(() => expect(window.location.pathname).toBe('/recipe/cookies'))
}

async function backOnceGoesHome() {
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
}

describe('back navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('mbm:recipes', JSON.stringify(RECIPES))
  })

  it('after saving an edit, one Back returns Home', async () => {
    await openRecipeFromHome()
    fireEvent.click(screen.getByRole('button', { name: 'Edit recipe' }))
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Best Cookies' } })
    // (The mocked user has no nickname, so the profile prompt adds its own Save button.)
    fireEvent.click(within(document.querySelector('.nav-bar') as HTMLElement).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Best Cookies' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/recipe/cookies'))
    await backOnceGoesHome()
  })

  it('after closing cook mode, one Back returns Home', async () => {
    await openRecipeFromHome()
    fireEvent.click(screen.getByRole('button', { name: /start cooking/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Exit cook mode' }))
    await waitFor(() => expect(window.location.pathname).toBe('/recipe/cookies'))
    await screen.findByRole('button', { name: 'Back' })
    await backOnceGoesHome()
  })
})
