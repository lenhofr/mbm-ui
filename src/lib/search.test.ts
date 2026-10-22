import { describe, expect, it } from 'vitest'
import { buildIndex, searchRecipes } from './search'
import { SEARCH_CASES, SEARCH_FIXTURE } from './search.fixture'

describe('searchRecipes', () => {
  const index = buildIndex(SEARCH_FIXTURE)
  it.each(SEARCH_CASES)('%s', (query, ids) => {
    expect([...searchRecipes(index, query)].sort()).toEqual([...ids].sort())
  })

  it('empty query returns everything', () => {
    expect(searchRecipes(index, '  ').size).toBe(SEARCH_FIXTURE.length)
  })
})
