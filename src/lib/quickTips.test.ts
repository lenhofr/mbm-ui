import { describe, it, expect } from 'vitest'
import { TIPS, TIP_CATEGORIES, matchTip, searchTips } from './quickTips'

const egg = TIPS.find(t => t.id === 'eggs')!

describe('quick tips data', () => {
  it('has 12 tips with unique ids in known categories', () => {
    expect(TIPS).toHaveLength(12)
    expect(new Set(TIPS.map(t => t.id)).size).toBe(12)
    TIPS.forEach(t => expect(TIP_CATEGORIES).toContain(t.category))
  })

  it('keeps the USDA safe temps from the spec', () => {
    const rows = Object.fromEntries(TIPS.find(t => t.id === 'safe-temps')!.rows!)
    expect(rows['Poultry, any cut or ground']).toBe('165°F')
    expect(rows['Ground beef, pork, lamb']).toBe('160°F')
    expect(rows['Steaks, chops, roasts']).toBe('145°F + 3 min rest')
    expect(rows['Fish & shellfish']).toBe('145°F')
    expect(rows['Egg dishes']).toBe('160°F')
    expect(rows['Leftovers & casseroles']).toBe('165°F')
  })
})

describe('tip lineup', () => {
  it('includes boiled baby carrots and corn on the cob', () => {
    expect(searchTips('baby carrots').map(t => t.id)).toContain('boiled-carrots')
    expect(searchTips('corn on the cob').map(t => t.id)).toEqual(['corn'])
  })

  it('no longer has roast chicken or pasta', () => {
    const ids = TIPS.map(t => t.id)
    expect(ids).not.toContain('roast-chicken')
    expect(ids).not.toContain('pasta')
  })
})

describe('matchTip', () => {
  it('matches title and keyword substrings', () => {
    expect(matchTip(egg, 'boiled')).toBe(true)
    expect(matchTip(egg, 'egg')).toBe(true)
    expect(matchTip(egg, 'pasta')).toBe(false)
  })

  it('matches a longer query that contains a keyword', () => {
    expect(matchTip(egg, 'boiled eggs')).toBe(true)
    expect(matchTip(egg, 'how long to boil eggs')).toBe(true)
  })

  it('"egg" only finds the eggs tip', () => {
    expect(searchTips('egg').map(t => t.id)).toEqual(['eggs'])
  })

  it('searchTips trims and lowercases', () => {
    expect(searchTips('  EGG ').map(t => t.id)).toContain('eggs')
    expect(searchTips('')).toHaveLength(12)
  })
})
