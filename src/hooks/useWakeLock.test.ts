/// <reference types="vitest" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWakeLock } from './useWakeLock'

describe('useWakeLock', () => {
  let mockWakeLock: any
  let mockWakeLockSentinel: any

  beforeEach(() => {
    // Mock wake lock sentinel
    mockWakeLockSentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    // Mock navigator.wakeLock
    mockWakeLock = {
      request: vi.fn().mockResolvedValue(mockWakeLockSentinel),
    }

    Object.defineProperty(navigator, 'wakeLock', {
      writable: true,
      configurable: true,
      value: mockWakeLock,
    })

    // Mock document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      writable: true,
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not request wake lock when active is false', () => {
    renderHook(() => useWakeLock(false))
    expect(mockWakeLock.request).not.toHaveBeenCalled()
  })

  it('should request wake lock when active is true', async () => {
    renderHook(() => useWakeLock(true))
    
    // Give the async request time to complete
    await new Promise(resolve => setTimeout(resolve, 0))
    
    expect(mockWakeLock.request).toHaveBeenCalledWith('screen')
  })

  it('should release wake lock when active changes from true to false', async () => {
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    })

    // Give the async request time to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockWakeLock.request).toHaveBeenCalledWith('screen')

    // Change to inactive
    rerender({ active: false })

    // Give the async release time to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockWakeLockSentinel.release).toHaveBeenCalled()
  })

  it('should return isSupported true when wake lock API is available', () => {
    const { result } = renderHook(() => useWakeLock(false))
    expect(result.current.isSupported).toBe(true)
  })

  it('should return isSupported false when wake lock API is not available', () => {
    // Remove wake lock from navigator before rendering
    const originalWakeLock = (navigator as any).wakeLock
    delete (navigator as any).wakeLock

    const { result } = renderHook(() => useWakeLock(false))
    expect(result.current.isSupported).toBe(false)

    // Restore for other tests
    ;(navigator as any).wakeLock = originalWakeLock
  })

  it('should handle wake lock request failure gracefully', async () => {
    // Mock console.warn to avoid noise in test output
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    // Make request fail
    mockWakeLock.request.mockRejectedValue(new Error('Wake lock denied'))

    renderHook(() => useWakeLock(true))

    // Give the async request time to complete
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(warnSpy).toHaveBeenCalledWith(
      'Wake Lock request failed:',
      expect.any(Error)
    )

    warnSpy.mockRestore()
  })

  it('should clean up wake lock on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))

    // Give the async request time to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    unmount()

    // Give the async release time to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockWakeLockSentinel.release).toHaveBeenCalled()
  })
})
