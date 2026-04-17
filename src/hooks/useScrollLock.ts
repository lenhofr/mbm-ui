import { useEffect } from 'react'

// Global counter so nested modals don't fight over scroll lock state.
// Uses window properties to share state across component instances.
declare global {
  interface Window {
    __modalCount?: number
    __scrollYBeforeModal?: number
  }
}

function lockScroll() {
  if (typeof window === 'undefined') return
  window.__modalCount = (window.__modalCount ?? 0) + 1
  if (window.__modalCount === 1) {
    const y = window.scrollY || document.documentElement.scrollTop || 0
    window.__scrollYBeforeModal = y
    document.documentElement.classList.add('modal-open')
    document.body.classList.add('modal-open')
    // Fixed-body technique prevents background scroll in iOS Safari / PWA
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
  }
}

function unlockScroll() {
  if (typeof window === 'undefined') return
  window.__modalCount = Math.max(0, (window.__modalCount ?? 0) - 1)
  if (window.__modalCount === 0) {
    document.documentElement.classList.remove('modal-open')
    document.body.classList.remove('modal-open')
    const y =
      typeof window.__scrollYBeforeModal === 'number'
        ? window.__scrollYBeforeModal
        : Math.max(0, -(parseInt(document.body.style.top || '0', 10) || 0))
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.left = ''
    document.body.style.right = ''
    document.body.style.width = ''
    window.scrollTo(0, y)
    window.__scrollYBeforeModal = undefined
  }
}

/**
 * Locks body scroll while `active` is true; restores it on cleanup.
 * Supports nested modals via a shared counter on `window`.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    lockScroll()
    return () => unlockScroll()
  }, [active])
}
