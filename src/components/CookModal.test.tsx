/// <reference types="vitest" />
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CookModal from './CookModal'

const sampleRecipe = {
  id: 'r1',
  title: 'Test Pancakes',
  servings: '2',
  ingredients: [{ name: 'Flour', amount: '1 cup' }, { name: 'Milk' }],
  instructions: ['Mix ingredients', 'Cook on skillet']
}

describe('CookModal', () => {
  beforeEach(() => {
    // ensure modal root exists
    const root = document.createElement('div')
    root.id = 'modal-root'
    document.body.appendChild(root)
  })
  afterEach(() => {
    const root = document.getElementById('modal-root')
    root?.remove()
    vi.restoreAllMocks()
  })

  it('renders recipe and calls print and close', () => {
  const onClose = vi.fn()
  const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

    render(<CookModal visible={true} onClose={onClose} recipe={sampleRecipe as any} />)

    expect(screen.getByRole('heading', { name: /test pancakes/i })).toBeInTheDocument()
  expect(screen.getByText(/flour/i)).toBeInTheDocument()
    expect(screen.getByText(/mix ingredients/i)).toBeInTheDocument()

    const printBtn = screen.getByRole('button', { name: /print recipe/i })
    fireEvent.click(printBtn)
    expect(printSpy).toHaveBeenCalled()

    const closeBtn = screen.getByRole('button', { name: /close cook view/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })
})
