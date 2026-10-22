import { describe, expect, it } from 'vitest'
import { CHIP_TAGS, TAG_ALIASES, chipTags, importerTags, recipeTags } from './tags'
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

  it('importer gets the chips as main tags, then other tags without alias spellings', () => {
    const r = (id: string, tags: string[]) => ({ id, title: id, tags })
    const { mainTags, knownTags } = importerTags([
      r('a', ['Slow Cooker', 'soup', 'Dinner']),
      r('b', ['soup', 'beef', 'easy']),
      r('c', ['beef', 'Soup ']),
    ])
    expect(mainTags).toEqual(CHIP_TAGS)
    expect(knownTags).toEqual(['soup', 'beef'])
    const many = importerTags([r('x', Array.from({ length: 40 }, (_, i) => `tag ${i}`))])
    expect(many.mainTags.length + many.knownTags.length).toBe(30)
  })
})
