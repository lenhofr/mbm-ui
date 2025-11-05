#!/usr/bin/env node
/*
 Launch WebKit with iPhone device settings and emulate PWA standalone mode.
 Usage:
  - npm run browser:install-webkit   # one-time
  - npm run dev                      # in another terminal
  - npm run ios:open:pwa             # opens WebKit emulating iPhone 15 Pro

 Env overrides:
  - DEVICE="iPhone 15 Pro Max" npm run ios:open:pwa
  - URL="http://localhost:4173" npm run ios:open:pwa
*/
import { webkit, devices } from 'playwright'

const DEVICE_NAME = process.env.DEVICE || 'iPhone 15 Pro'
const URL = process.env.URL || 'http://localhost:5173'
const device = devices[DEVICE_NAME]

if (!device) {
  const names = Object.keys(devices).filter(n => /iPhone/i.test(n))
  console.error(`Unknown device "${DEVICE_NAME}". Known iPhone devices:\n- ${names.join('\n- ')}`)
  process.exit(1)
}

;(async () => {
  const browser = await webkit.launch({ headless: false })
  const context = await browser.newContext({
    ...device,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow'
  })

  // Emulate PWA standalone before any app scripts execute
  await context.addInitScript(() => {
    try {
      // 1) navigator.standalone like iOS PWA
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })

      // 2) display-mode: standalone media query
      const realMatchMedia = window.matchMedia
      window.matchMedia = (query) => {
        if (typeof query === 'string' && /display-mode\s*:\s*standalone/.test(query)) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
          }
        }
        return realMatchMedia(query)
      }

      // 3) Ensure viewport-fit=cover & Apple PWA meta
      const injectHeadBits = () => {
        const head = document.head || document.getElementsByTagName('head')[0]

        // viewport-fit=cover for safe-area insets
        let vp = head.querySelector('meta[name="viewport"]')
        if (!vp) {
          vp = document.createElement('meta')
          vp.name = 'viewport'
          vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover'
          head.appendChild(vp)
        } else if (!/viewport-fit=cover/.test(vp.content)) {
          vp.content = `${vp.content}, viewport-fit=cover`
        }

        // Apple web app capable
        if (!head.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
          const m = document.createElement('meta')
          m.name = 'apple-mobile-web-app-capable'
          m.content = 'yes'
          head.appendChild(m)
        }
        if (!head.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
          const m = document.createElement('meta')
          m.name = 'apple-mobile-web-app-status-bar-style'
          m.content = 'default' // or 'black-translucent' to test translucent look
          head.appendChild(m)
        }

        document.documentElement.classList.add('pwa-standalone')
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHeadBits, { once: true })
      } else {
        injectHeadBits()
      }
    } catch (e) {
      console.warn('PWA emulation init script error:', e)
    }
  })

  const page = await context.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  console.log(`Opened ${URL} in WebKit as "${DEVICE_NAME}" with PWA standalone emulation.`)
  console.log('Press Ctrl+C to exit.')
})()
