#!/usr/bin/env node
// Verifies that images resolve via the configured backend.
// - Reads .env.local for VITE_API_BASE (if present)
// - Falls back to import.meta.env style replacement when run as part of Vite preview
// - Fetches /recipes and then attempts to load a representative image URL

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'

function readDotEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return {}
  const text = fs.readFileSync(p, 'utf8')
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()
    out[k] = v
  }
  return out
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.request(url, { method: 'GET', ...opts }, res => {
      const { statusCode } = res
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        if (statusCode && statusCode >= 200 && statusCode < 300) {
          try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) }
        } else {
          reject(new Error(`HTTP ${statusCode}: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function head(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.request(url, { method: 'HEAD' }, res => {
      resolve({ statusCode: res.statusCode, headers: res.headers })
    })
    req.on('error', reject)
    req.end()
  })
}

function pickImageUrl(apiBase, recipe) {
  const img = recipe?.image
  if (!img) return null
  if (/^(https?:|data:|blob:)/i.test(img)) {
    try {
      const u = new URL(img)
      const isAws = /amazonaws\.com$/i.test(u.hostname)
      const hasSig = u.search.includes('X-Amz-')
      if (apiBase && isAws && hasSig) {
        // Prefer proxying via the API route using the key
        let key = u.pathname.replace(/^\//, '')
        if (/^s3[.-]([^/]+\.)?amazonaws\.com$/i.test(u.hostname)) {
          const firstSlash = key.indexOf('/')
          if (firstSlash > 0) key = key.slice(firstSlash + 1)
        }
        return `${apiBase}/images/${encodeURIComponent(key)}`
      }
      return img
    } catch {
      return img
    }
  }
  return apiBase ? `${apiBase}/images/${encodeURIComponent(img)}` : null
}

async function main() {
  const env = readDotEnvLocal()
  const apiBase = (env.VITE_API_BASE || '').trim()
  if (!apiBase) {
    console.warn('[verify-images] VITE_API_BASE missing in .env.local; cannot verify server images. Set it and re-run.')
    process.exit(2)
  }
  console.log(`[verify-images] Using API base: ${apiBase}`)

  // 1) fetch recipes
  const recipes = await fetchJson(`${apiBase}/recipes`)
  if (!Array.isArray(recipes) || recipes.length === 0) {
    console.warn('[verify-images] No recipes returned; cannot verify images.')
    process.exit(3)
  }
  const withImage = recipes.find(r => r.image)
  if (!withImage) {
    console.warn('[verify-images] Recipes contain no images; cannot verify images.')
    process.exit(4)
  }
  const url = pickImageUrl(apiBase, withImage)
  if (!url) {
    console.warn('[verify-images] Could not construct image URL from recipe. Skipping.')
    process.exit(5)
  }

  // 2) HEAD request to image url (should 200 or 302 -> 200)
  const res = await head(url)
  const code = res.statusCode || 0
  console.log(`[verify-images] HEAD ${url} -> ${code}`)
  if (code >= 200 && code < 400) {
    console.log('[verify-images] PASS: image endpoint is responding.')
    return
  }
  throw new Error(`Image endpoint returned status ${code}`)
}

main().catch(err => {
  console.error('[verify-images] FAIL:', err?.message || err)
  process.exit(1)
})
