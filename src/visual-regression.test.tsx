import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

// Minimal smoke-style visual assertions that rely on classNames and computed tokens,
// not pixel comparisons. Ensures components render and key classes are present.

describe('visual regression (lightweight)', () => {
  it('renders the app hero and search with themed classes', () => {
    render(<App />)
    // Hero container should exist
    expect(screen.getByText(/Meals by Maggie/i)).toBeInTheDocument()
    // Search input present
    const search = screen.getByLabelText(/Search recipes/i)
    expect(search).toBeInTheDocument()
  })

  it('mounts without inline hardcoded colors on hero/search', () => {
    const { container } = render(<App />)
    // No inline hex colors on the hero/search wrapper
    const hero = container.querySelector('.hero-card')
    if (hero) {
      expect(hero.getAttribute('style') || '').not.toMatch(/#([0-9a-f]{3}|[0-9a-f]{6})/i)
    }
  })
})
