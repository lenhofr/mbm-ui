import { useEffect, useRef } from 'react'

/**
 * Custom hook to request a screen wake lock when active is true.
 * The Screen Wake Lock API prevents the screen from dimming or locking
 * while the wake lock is held. This is useful for cook mode where users
 * need to reference instructions while cooking.
 * 
 * @param active - Whether the wake lock should be active
 * @returns An object with the current wake lock state and error if any
 */
export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const activeRef = useRef(active)

  // Keep activeRef in sync with active prop
  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    // Check if Wake Lock API is supported
    if (!('wakeLock' in navigator)) {
      return
    }

    async function requestWakeLock() {
      try {
        // Request a screen wake lock
        const wakeLock = await navigator.wakeLock.request('screen')
        wakeLockRef.current = wakeLock

        // Listen for wake lock release (e.g., when tab becomes inactive)
        wakeLock.addEventListener('release', () => {
          wakeLockRef.current = null
        })
      } catch (err) {
        // Wake lock request can fail if:
        // - Document is not active/visible
        // - Battery is too low (on some devices)
        // - User has denied the permission
        console.warn('Wake Lock request failed:', err)
      }
    }

    async function releaseWakeLock() {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release()
        } catch (err) {
          console.warn('Wake Lock release failed:', err)
        } finally {
          // Always clear the ref, even if release fails
          wakeLockRef.current = null
        }
      }
    }

    if (active) {
      requestWakeLock()

      // Re-request wake lock when document becomes visible again
      // (wake lock is automatically released when tab becomes hidden)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && activeRef.current && !wakeLockRef.current) {
          requestWakeLock()
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        releaseWakeLock()
      }
    } else {
      releaseWakeLock()
    }
  }, [active])

  return {
    isSupported: 'wakeLock' in navigator,
    isActive: wakeLockRef.current !== null
  }
}
