// Recipe image helpers: URL resolution, client-side resizing and S3 upload via presign.
import { getApiBase } from './env'

/**
 * Turn a stored image value into a displayable URL. Stored values are usually S3 keys,
 * which are proxied through the API for a fresh redirect. Legacy presigned S3 URLs are
 * converted back to keys the same way.
 */
export function resolveImageUrl(img: string | undefined): string | undefined {
  if (!img) return undefined
  const apiBase = getApiBase()
  if (/^(data:|blob:)/i.test(img)) return img
  if (!/^https?:/i.test(img)) return apiBase ? `${apiBase}/images/${encodeURIComponent(img)}` : img
  try {
    const u = new URL(img)
    const host = u.hostname
    if (apiBase && /amazonaws\.com$/i.test(host) && u.search.includes('X-Amz-')) {
      let key = u.pathname.replace(/^\//, '')
      // path-style: s3.amazonaws.com/bucket/key → drop the bucket segment
      if (/^s3[.-]([^/]+\.)?amazonaws\.com$/i.test(host)) {
        const firstSlash = key.indexOf('/')
        if (firstSlash > 0) key = key.slice(firstSlash + 1)
      }
      return `${apiBase}/images/${encodeURIComponent(key)}`
    }
  } catch {}
  return img
}

/** Convert an API-proxied image URL back into its stored key before saving. */
export function toStoredImage(img: string | undefined): string | undefined {
  if (!img) return undefined
  const apiBase = getApiBase()
  if (apiBase && /^https?:\/\//i.test(img)) {
    const prefix = `${apiBase.replace(/\/$/, '')}/images/`
    if (img.startsWith(prefix)) return decodeURIComponent(img.slice(prefix.length))
  }
  return img
}

function decodeToImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
    i.onerror = e => { URL.revokeObjectURL(url); reject(e) }
    i.src = url
  })
}

function drawScaled(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  let { width, height } = img
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D not available')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

/** Resize a dish photo for upload: WebP when supported, else JPEG, max 1024px. */
export async function resizeDishPhoto(file: File): Promise<File> {
  const canvas = drawScaled(await decodeToImage(file), 1024)
  let canWebp = false
  try { canWebp = canvas.toDataURL('image/webp').startsWith('data:image/webp') } catch {}
  const type = canWebp ? 'image/webp' : 'image/jpeg'
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, canWebp ? 0.8 : 0.78))
  const base = file.name.replace(/\.[a-z0-9]+$/i, '') || 'photo'
  return new File([blob], `${base}.${canWebp ? 'webp' : 'jpeg'}`, { type })
}

const MAX_EXTRACT_BYTES = 2_500_000

/** Compress a scanned page / screenshot to base64 JPEG for the AI extract endpoint. */
export async function compressForExtract(file: Blob, maxDim = 1568): Promise<{ data: string; mediaType: string }> {
  const canvas = drawScaled(await decodeToImage(file), maxDim)
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1]
    if (data.length * 0.75 <= MAX_EXTRACT_BYTES) return { data, mediaType: 'image/jpeg' }
  }
  throw new Error('Could not compress image under 2.5MB')
}

export function isHeic(file: File) {
  const t = (file.type || '').toLowerCase()
  const n = (file.name || '').toLowerCase()
  return t === 'image/heic' || t === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif')
}

/** Upload via presigned POST (better iOS Safari compatibility), falling back to PUT. Returns the S3 key. */
export async function uploadImage(file: File, authHeaders: Record<string, string | undefined>): Promise<string> {
  const apiBase = getApiBase()
  const resp = await fetch(`${apiBase}/images`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, type: file.type || 'image/jpeg' }),
    headers: { ...(authHeaders as Record<string, string>), 'Content-Type': 'application/json' },
  })
  if (!resp.ok) throw new Error(`presign failed: ${resp.status}`)
  const data = await resp.json()
  const put = async () => {
    const r = await fetch(data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' } })
    if (!r.ok) throw new Error(`PUT upload failed: ${r.status}`)
  }
  if (data.postUrl && data.fields) {
    const form = new FormData()
    Object.entries(data.fields as Record<string, string>).forEach(([k, v]) => form.append(k, v))
    form.append('file', file)
    const r = await fetch(data.postUrl, { method: 'POST', body: form })
    if (!r.ok) await put()
  } else {
    await put()
  }
  return data.key
}
