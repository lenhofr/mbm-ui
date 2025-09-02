import React, { useEffect, useMemo, useState } from 'react'

// Minimal, localStorage-backed install hint banner for PWA
// - Chrome/Edge: uses beforeinstallprompt
// - iOS Safari: shows A2HS instructions

function isStandalone(): boolean {
  // iOS Safari exposes navigator.standalone; others rely on display-mode media
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = navigator
  const media = window.matchMedia('(display-mode: standalone)').matches
  return !!nav.standalone || media
}

function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) && !/Windows/i.test(ua)
}

const DISMISS_KEY = 'installPromptDismissedAt'
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [mode, setMode] = useState<'native' | 'ios' | null>(null)
  const [deferred, setDeferred] = useState<any>(null)

  const dismissedRecently = useMemo(() => {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return ts && Date.now() - ts < DISMISS_FOR_MS
  }, [])

  useEffect(() => {
    if (isStandalone() || dismissedRecently) return

    let cleanup = () => {}

    // Android/Chrome and also desktop Chrome
    function onBIP(e: any) {
      e.preventDefault()
      setDeferred(e)
      setMode('native')
      setShow(true)
    }

    window.addEventListener('beforeinstallprompt', onBIP as any)
    cleanup = () => window.removeEventListener('beforeinstallprompt', onBIP as any)

    // iOS has no beforeinstallprompt
    if (isIOS()) {
      // delay a bit to avoid flashing on first paint
      const t = setTimeout(() => {
        if (!isStandalone() && !dismissedRecently) {
          setMode('ios')
          setShow(true)
        }
      }, 600)
      return () => {
        cleanup()
        clearTimeout(t)
      }
    }

    return cleanup
  }, [dismissedRecently])

  if (!show || !mode) return null

  return (
    <div className="install-banner" role="dialog" aria-label="Install app" aria-modal={false}>
      <div className="install-banner__content">
        <div className="install-banner__text">
          <strong>Install Meals?</strong>
          <div className="install-banner__sub">Faster access and full-screen on your phone.</div>
        </div>
        {mode === 'native' ? (
          <button
            className="primary"
            onClick={async () => {
              try {
                await deferred?.prompt?.()
                await deferred?.userChoice
              } finally {
                setShow(false)
              }
            }}
          >Install</button>
        ) : (
          <details className="install-banner__ios">
            <summary className="primary">How to install</summary>
            <div className="install-banner__steps">
              <ol>
                <li>Tap the Share button in Safari (square with arrow up).</li>
                <li>Choose "Add to Home Screen".</li>
                <li>Confirm the name and tap Add.</li>
              </ol>
            </div>
          </details>
        )}
        <button
          className="btn-ghost install-banner__dismiss"
          aria-label="Dismiss install hint"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, String(Date.now()))
            setShow(false)
          }}
        >Not now</button>
      </div>
    </div>
  )
}
