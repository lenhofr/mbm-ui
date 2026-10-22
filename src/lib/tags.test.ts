import { describe, expect, it } from 'vitest'
import { CHIP_TAGS, TAG_ALIASES, chipTags, recipeTags } from './tags'
import { SEARCH_FIXTURE } from './search.fixture'

describe('tags', () => {
  it('adds an alias main tag and keeps the original', () => {
    expect(recipeTags({ id: 'a', title: 'A', tags: ['Slow Cooker', 'Dinner', 'crockpot', ' vegan '] }))
      .toEqual(['slow cooker', 'crockpot', 'dinner', 'vegan', 'vegetarian'])
  })

  it('chips keep their fixed order and skip ones no recipe has', () => {
    expect(chipTags(SEARCH_FIXTURE)).toEqual(['dinner', 'crockpot', 'quick & easy', 'pasta', 'vegetarian', 'dessert'])
    expect(chipTags([])).toEqual([])
  })

  it('aliases point at lowercase main tags, never at another alias', () => {
    for (const [from, to] of Object.entries(TAG_ALIASES)) {
      expect(from).toBe(from.toLowerCase())
      expect(TAG_ALIASES[to]).toBeUndefined()
    }
    expect(CHIP_TAGS.every(t => !TAG_ALIASES[t])).toBe(true)
  })
})
