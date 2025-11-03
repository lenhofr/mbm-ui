import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import LoadingSpinner from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with default message', () => {
    render(<LoadingSpinner />)
    expect(screen.getByText(/Loading.../i)).toBeTruthy()
  })

  it('renders with custom message', () => {
    render(<LoadingSpinner message="Loading recipes..." />)
    expect(screen.getByText(/Loading recipes.../i)).toBeTruthy()
  })

  it('renders without message when not provided', () => {
    render(<LoadingSpinner message="" />)
    expect(screen.queryByText(/Loading/i)).toBeNull()
  })
})
