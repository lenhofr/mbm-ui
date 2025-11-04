#!/usr/bin/env node
/**
 * Optimize existing S3 images in place (resize + compress).
 *
 * Requirements:
 * - AWS creds configured (env or shared config)
 * - Env: IMAGES_BUCKET (required), AWS_REGION (default: us-east-1)
 * - Optional env: PREFIX (default: 'uploads/')
 *
 * Options:
 *   --format=webp|jpeg   Output format (default: webp)
 *   --maxDim=1024        Max width/height (default: 1024)
 *   --quality=0.8        Quality (0..1 or 1..100; default: 0.8)
 *   --prefix=uploads/    Key prefix to scan (default: env PREFIX or uploads/)
 *   --dryRun             Analyze only; no writes
 *   --backup             Write originals to originals/<key>
 *   --minBytes=51200     Skip objects smaller than this (default: 50KB)
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { Readable } from 'node:stream'

// ---- args/env ----
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (!m) return [a, true]
  return [m[1], m[2] ?? true]
}))

const BUCKET = process.env.IMAGES_BUCKET
const REGION = process.env.AWS_REGION || 'us-east-1'
const PREFIX = String(args.prefix || process.env.PREFIX || 'uploads/')
if (!BUCKET) {
  console.error('IMAGES_BUCKET is required (export IMAGES_BUCKET=your-bucket)')
  process.exit(1)
}

const FORMAT = String(args.format || 'webp').toLowerCase() // 'webp' | 'jpeg'
const MAX_DIM = Number(args.maxDim || 1024)
let QUALITY = Number(args.quality ?? 0.8)
QUALITY = QUALITY <= 1 ? Math.round(QUALITY * 100) : Math.min(100, Math.max(1, QUALITY))
const DRY_RUN = !!args.dryRun
const BACKUP = !!args.backup
const MIN_BYTES = Number(args.minBytes || 51200)

const s3 = new S3Client({ region: REGION })

function isImageKey(key) {
  return /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(key)
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function* listObjects(prefix) {
  let ContinuationToken
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }))
    for (const it of (res.Contents || [])) {
      if (it.Key) yield it
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
}

async function optimizeBuffer(inputBuf, format, maxDim, quality) {
  let img = sharp(inputBuf, { failOn: 'error' }).rotate()
  const meta = await img.metadata()
  if (!meta || (!meta.width && !meta.height)) throw new Error('Unreadable image')
  img = img.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
  if (format === 'jpeg') {
    const out = await img.jpeg({ quality, mozjpeg: true }).toBuffer()
    return { buffer: out, contentType: 'image/jpeg' }
  } else {
    const out = await img.webp({ quality }).toBuffer()
    return { buffer: out, contentType: 'image/webp' }
  }
}

async function run() {
  console.log(`Bucket=${BUCKET} Region=${REGION} Prefix=${PREFIX} Format=${FORMAT} MaxDim=${MAX_DIM} Quality=${QUALITY} DryRun=${DRY_RUN} Backup=${BACKUP} MinBytes=${MIN_BYTES}`)

  let total = 0, optimized = 0, skippedSmall = 0, skippedBigger = 0, failed = 0

  for await (const obj of listObjects(PREFIX)) {
    const key = obj.Key
    const size = obj.Size || 0
    if (!key || key.endsWith('/') || !isImageKey(key)) continue
    total++
    try {
      if (size && size < MIN_BYTES) { skippedSmall++; continue }

      const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
      const original = await streamToBuffer(getRes.Body)
      if (original.length < MIN_BYTES) { skippedSmall++; continue }

      const { buffer: out, contentType } = await optimizeBuffer(original, FORMAT, MAX_DIM, QUALITY)
      if (!out || !out.length) { continue }
      if (out.length >= original.length) { skippedBigger++; continue }

      console.log(`${DRY_RUN ? '[dry]' : '[write]'} ${key}: ${Math.round(original.length/1024)}KB -> ${Math.round(out.length/1024)}KB (${((1 - out.length/original.length)*100).toFixed(1)}% saved)`) 

      if (!DRY_RUN) {
        if (BACKUP) {
          const bkey = `originals/${key}`
          await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: bkey, Body: original, ContentType: 'application/octet-stream', CacheControl: 'no-cache' }))
        }
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: out,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable'
        }))
      }
      optimized++
    } catch (e) {
      failed++
      console.error(`Error processing ${key}:`, e?.message || e)
    }
  }

  console.log(`Done. total=${total} optimized=${optimized} skippedSmall=${skippedSmall} skippedBigger=${skippedBigger} failed=${failed}`)
}

run().catch(err => { console.error(err); process.exit(1) })
