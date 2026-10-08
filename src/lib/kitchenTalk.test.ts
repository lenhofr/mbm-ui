import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fill, pick, talk, usePick, usePickSteps } from './kitchenTalk'

describe('kitchen talk banks', () => {
  it('every bank has lines and only uses known placeholders', () => {
    const lines: string[] = []
    Object.values(talk).forEach(v => {
      if (typeof v === 'string') lines.push(v)
      else v.forEach((x: string | readonly string[]) => (typeof x === 'string' ? lines.push(x) : lines.push(...x)))
      if (Array.isArray(v)) expect(v.length).toBeGreaterThan(0)
    })
    lines.forEach(l => {
      expect(l.trim()).not.toBe('')
      for (const m of l.matchAll(/\{(\w+)\}/g)) expect(['title', 'q', 'name']).toContain(m[1])
    })
  })

  it('import step banks have 4 steps each', () => {
    expect(talk.scanSteps).toHaveLength(4)
    expect(talk.linkSteps).toHaveLength(4)
    expect(talk.screenshotSteps).toHaveLength(4)
  })
})

describe('pick / fill', () => {
  it('pick stays in range for any random value', () => {
    expect(pick(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pick(['a', 'b', 'c'], () => 0.999)).toBe('c')
    expect(pick(['a', 'b', 'c'], () => 1)).toBe('a')
  })

  it('fill replaces known vars and leaves unknown ones', () => {
    expect(fill('Enjoy your {title}.', { title: 'Chili' })).toBe('Enjoy your Chili.')
    expect(fill('Hi {name}', {})).toBe('Hi {name}')
  })

  it('usePick / usePickSteps keep their choice across re-renders', () => {
    const { result, rerender } = renderHook(() => [usePick(talk.loading), usePickSteps(talk.linkSteps).join('|')])
    const first = result.current
    for (let k = 0; k < 10; k++) rerender()
    expect(result.current).toEqual(first)
    expect(talk.loading).toContain(first[0])
  })
})
