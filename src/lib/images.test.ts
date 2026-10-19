import { describe, it, expect } from 'vitest'
import { isAiSketch } from './images'

describe('isAiSketch', () => {
  it('is true only for keys under ai-sketches/', () => {
    expect(isAiSketch('ai-sketches/abc.png')).toBe(true)
    expect(isAiSketch('uploads/abc.webp')).toBe(false)
    expect(isAiSketch('data:image/png;base64,xyz')).toBe(false)
    expect(isAiSketch(undefined)).toBe(false)
  })
})
