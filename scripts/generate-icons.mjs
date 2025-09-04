#!/usr/bin/env node
// Generate PWA icons from public/icons/mbm-icon.svg using sharp
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const sharpPath = path.join(root, 'node_modules', 'sharp')

async function ensureSharp() {
  try {
    await import('sharp')
  } catch (e) {
    console.error('Sharp not installed. Run `npm i -D sharp` and retry.')
    process.exit(1)
  }
}

async function main() {
  await ensureSharp()
  const sharp = (await import('sharp')).default

  const src = path.join(root, 'public', 'icons', 'mbm-icon.svg')
  const outDir = path.join(root, 'public', 'icons')
  if (!fs.existsSync(src)) {
    console.error('Missing', src)
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })

  const targets = [
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
    { name: 'apple-touch-icon-180.png', size: 180 },
    { name: 'favicon-16.png', size: 16 },
    { name: 'favicon-32.png', size: 32 },
    { name: 'icon-48.png', size: 48 },
  ]

  for (const t of targets) {
    const buf = await sharp(src).resize(t.size, t.size).png({ compressionLevel: 9 }).toBuffer()
    const out = path.join(outDir, t.name)
    fs.writeFileSync(out, buf)
    console.log('Wrote', out)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
