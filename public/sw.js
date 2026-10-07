const CACHE = 'mbm-ui-sw-v3'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Delete any old caches from previous versions so stale assets don't linger
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  try {
    const url = new URL(req.url)
    if (req.method !== 'GET' || url.origin !== location.origin) return
  } catch (_) {
    return
  }
  // Page loads: network-first so a deploy shows up on the next launch of the
  // home-screen app; fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put('/index.html', copy))
        }
        return res
      }).catch(() => caches.match('/index.html'))
    )
    return
  }
  // Hashed assets, fonts, icons: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req)
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone())
        return res
      }).catch(() => cached)
      return cached || fetchPromise
    })
  )
})
