import { describe, it, expect } from 'vitest'
import { splitQty, formatQty, scaleAmount, parseIngredientLine, parseServings, ingredientsUsedInStep } from './quantity'

describe('splitQty', () => {
  it.each([
    ['2 cups', 2, 'cups'],
    ['1/2 tsp', 0.5, 'tsp'],
    ['2 1/4 cups', 2.25, 'cups'],
    ['1½ cups', 1.5, 'cups'],
    ['¾ cup', 0.75, 'cup'],
    ['0.5 lb', 0.5, 'lb'],
    ['4-6', 4, ''],
    ['200g', 200, 'g'],
  ])('%s', (input, q, rest) => {
    expect(splitQty(input)).toEqual({ q, rest })
  })

  it('returns null for non-numeric amounts', () => {
    expect(splitQty('a pinch').q).toBeNull()
  })
})

describe('formatQty', () => {
  it('renders unicode fractions', () => {
    expect(formatQty(0.5)).toBe('½')
    expect(formatQty(1.75)).toBe('1¾')
    expect(formatQty(1 / 3)).toBe('⅓')
    expect(formatQty(3)).toBe('3')
  })
})

describe('scaleAmount', () => {
  it('scales and keeps the unit', () => {
    expect(scaleAmount('1 1/2 cups', 2)).toBe('3 cups')
    expect(scaleAmount('1 cup', 0.5)).toBe('½ cup')
    expect(scaleAmount('pinch', 2)).toBe('pinch')
  })
})

describe('parseIngredientLine', () => {
  it('splits amount, unit and name', () => {
    expect(parseIngredientLine('2 1/4 cups all-purpose flour')).toEqual({ amount: '2 1/4 cups', name: 'all-purpose flour' })
    expect(parseIngredientLine('2 large eggs')).toEqual({ amount: '2', name: 'large eggs' })
    expect(parseIngredientLine('salt to taste')).toEqual({ name: 'salt to taste' })
  })
})

describe('parseServings', () => {
  it('reads the leading integer', () => {
    expect(parseServings('4-6')).toBe(4)
    expect(parseServings('')).toBeUndefined()
  })
})

describe('ingredientsUsedInStep', () => {
  it('matches main nouns', () => {
    const ings = [{ name: 'all-purpose flour' }, { name: 'large eggs' }, { name: '(2 sticks) butter, softened' }, { name: 'vanilla extract' }]
    expect(ingredientsUsedInStep('Beat butter and sugar. Add eggs, then flour.', ings)).toEqual([0, 1, 2])
  })
})
