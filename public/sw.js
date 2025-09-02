self.addEventListener('install', (event) => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const CACHE = 'mbm-ui-sw-v1'
self.addEventListener('fetch', (event) => {
  const req = event.request
  try {
    const url = new URL(req.url)
    if (req.method !== 'GET' || url.origin !== location.origin) return
  } catch (_) {
    return
  }
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
