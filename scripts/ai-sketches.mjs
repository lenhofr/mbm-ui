#!/usr/bin/env node
/**
 * Line-drawing placeholder images for recipes that have no photo.
 *
 * The sketches are deliberately obviously-not-a-photo (simple black line drawings) and
 * live under the ai-sketches/ S3 prefix, which is what makes the web and iOS apps show
 * the "AI sketch" tag (isAiSketch in src/lib/images.ts, Recipe.isAiSketch on iOS).
 * Uploading a real photo replaces the key with uploads/…, so the tag goes away by itself.
 *
 * Two steps, so you can look at every sketch before anything goes live:
 *
 *   1. generate — reads recipes from the public API, draws a sketch for each one without
 *      an image via a Stability AI model on Bedrock, and saves them to tmp_artifacts/ai-sketches/
 *      with a contact sheet (index.html). Needs credentials for the Bedrock (AI) account.
 *
 *        AWS_PROFILE=mbm-ai API_BASE=https://….execute-api.us-east-1.amazonaws.com \
 *          node scripts/ai-sketches.mjs generate [--limit=3] [--ids=a,b] [--force]
 *
 *      Don't like one? Delete its .webp and run generate again with --ids=<id> (new seed).
 *
 *   2. apply — uploads the sketches still in the folder and points each recipe at its
 *      sketch. Writes DynamoDB directly so updatedAt/updatedByName aren't touched, and only
 *      fills recipes that still have no image (or an older sketch). Needs app-account creds.
 *
 *        AWS_PROFILE=mbm-app IMAGES_BUCKET=mbm-site-images-… DDB_TABLE=mbm-recipes \
 *          node scripts/ai-sketches.mjs apply [--dry-run]
 *
 * Env: AWS_REGION (S3/DynamoDB, default us-east-1), BEDROCK_REGION (default us-west-2, where
 * Bedrock hosts the Stability models), MODEL_ID (default stability.stable-image-core-v1:1;
 * stability.sd3-5-large-v1:0 or stability.stable-image-ultra-v1:1 also take the same request).
 * List what the account can use: aws bedrock list-foundation-models --region us-west-2 --by-output-modality IMAGE
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import sharp from 'sharp'

const [cmd, ...rest] = process.argv.slice(2)
const args = Object.fromEntries(rest.map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? true] : [a, true]
}))

const REGION = process.env.AWS_REGION || 'us-east-1'
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-west-2'
const MODEL_ID = process.env.MODEL_ID || 'stability.stable-image-core-v1:1'
const PREFIX = 'ai-sketches/'
const OUT_DIR = path.resolve('tmp_artifacts/ai-sketches')
const MANIFEST = path.join(OUT_DIR, 'manifest.json')

// Simple black line drawing on plain white (coloring-book / doodle level of detail). Don't
// mention paper or pencils: the model then draws a photo of a sketchbook instead.
const STYLE =
  'Simple minimalist line drawing, a few bold uniform black outlines, no shading, no hatching, ' +
  'coloring book style doodle, just the dish on a plain plate, centered, flat pure white background, ' +
  'lots of empty space, black lines on white only.'
const NEGATIVE =
  'photo, photograph, photorealistic, realistic, detailed, intricate, fine detail, hatching, cross-hatching, ' +
  'stippling, engraving, shading, shadows, gradients, texture, 3d render, color, grayscale, ' +
  'paper, sketchbook, notebook, pencil, pen, table, cutlery, fork, spoon, napkin, jars, props, background scene, ' +
  'text, letters, words, signature, handwriting, watermark, logo, hands, people'

function promptFor(r) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim()
  const ingredients = (r.ingredients || [])
    // "jar marinara sauce" otherwise gets drawn as jars on the table
    .map(i => clean(i.name).replace(/\(.*?\)|,.*$/g, '').replace(/\b(jars?|cans?|box(es)?|bottles?|packages?|packets?|bags?|cartons?) (of )?/gi, '').trim())
    .filter(n => n && n.length <= 40)
    .slice(0, 5)
  // Just the dish and a few ingredients; long descriptions pull the model toward food photography.
  const title = clean(r.title).replace(/\s+-\s+.*$/, '')
  let dish = `Simple line drawing of a plate of ${title}`
  if (ingredients.length) dish += ` (${ingredients.join(', ')})`
  return `${dish}. ${STYLE}`
}

async function readManifest() {
  try { return JSON.parse(await fs.readFile(MANIFEST, 'utf8')) } catch { return {} }
}

async function generate() {
  const apiBase = (process.env.API_BASE || '').replace(/\/$/, '')
  if (!apiBase) throw new Error('API_BASE is required (the VITE_API_BASE value)')
  const res = await fetch(`${apiBase}/recipes`)
  if (!res.ok) throw new Error(`GET /recipes failed: ${res.status}`)
  const recipes = await res.json()

  const ids = args.ids ? new Set(String(args.ids).split(',')) : null
  const manifest = await readManifest()
  let todo = recipes.filter(r => (ids ? ids.has(r.id) : !r.image))
  if (!args.force && !ids) todo = todo.filter(r => !manifest[r.id])
  if (args.limit) todo = todo.slice(0, Number(args.limit))
  console.log(`${recipes.length} recipes, ${recipes.filter(r => !r.image).length} without an image, drawing ${todo.length}`)

  await fs.mkdir(OUT_DIR, { recursive: true })
  const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION })
  for (const r of todo) {
    const prompt = promptFor(r)
    const seed = Math.floor(Math.random() * 4_294_967_295)
    try {
      const out = await bedrock.send(new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ prompt, negative_prompt: NEGATIVE, aspect_ratio: '1:1', output_format: 'png', seed }),
      }))
      const body = JSON.parse(new TextDecoder().decode(out.body))
      if (body.finish_reasons?.[0]) throw new Error(`model refused: ${body.finish_reasons[0]}`)
      const png = Buffer.from(body.images[0], 'base64')
      // Force true grayscale so a stray tint never makes a sketch pass for a photo.
      const webp = await sharp(png).grayscale().webp({ quality: 80 }).toBuffer()
      // Seed in the name: S3 objects are cached as immutable, so a redraw needs a new key.
      const file = `${r.id}-${seed}.webp`
      if (manifest[r.id]) await fs.rm(path.join(OUT_DIR, manifest[r.id].file), { force: true })
      await fs.writeFile(path.join(OUT_DIR, file), webp)
      manifest[r.id] = { file, title: r.title, prompt, seed }
      await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))
      console.log(`✓ ${r.title} → ${file}`)
    } catch (e) {
      console.error(`✗ ${r.title}: ${e.message}`)
    }
  }
  await writeContactSheet(manifest)
  console.log(`\nReview: open ${path.join(OUT_DIR, 'index.html')}`)
}

async function writeContactSheet(manifest) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const cards = Object.entries(manifest).map(([id, m]) =>
    `<figure><img src="${esc(m.file)}" alt=""><figcaption><b>${esc(m.title)}</b><br><code>${esc(id)}</code></figcaption></figure>`).join('\n')
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>AI sketches</title>
<style>body{font:14px system-ui;margin:24px;background:#fcf5f8}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
figure{margin:0;background:#fff;border-radius:12px;padding:8px}img{width:100%;border-radius:8px;display:block}figcaption{padding:6px 2px}code{color:#7d6872;font-size:11px}</style>
<h1>AI sketches (${Object.keys(manifest).length})</h1><p>Delete any .webp you don't like, then rerun generate with --ids=&lt;id&gt;, or just skip it.</p><main>${cards}</main>`)
}

async function apply() {
  const bucket = process.env.IMAGES_BUCKET
  const table = process.env.DDB_TABLE
  if (!bucket || !table) throw new Error('IMAGES_BUCKET and DDB_TABLE are required')
  const dry = !!args['dry-run']
  const manifest = await readManifest()
  const s3 = new S3Client({ region: REGION })
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

  for (const [id, m] of Object.entries(manifest)) {
    const local = path.join(OUT_DIR, m.file)
    const body = await fs.readFile(local).catch(() => null)
    if (!body) { console.log(`- ${m.title}: no file (deleted in review), skipping`); continue }
    const key = PREFIX + m.file
    if (dry) { console.log(`[dry-run] ${m.title} → ${key}`); continue }
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    try {
      // Never overwrite a real photo someone added since the sketches were drawn.
      await ddb.send(new UpdateCommand({
        TableName: table,
        Key: { recipeId: id },
        UpdateExpression: 'SET #img = :key',
        ConditionExpression: 'attribute_exists(recipeId) AND (attribute_not_exists(#img) OR #img = :empty OR begins_with(#img, :prefix))',
        ExpressionAttributeNames: { '#img': 'image' },
        ExpressionAttributeValues: { ':key': key, ':empty': '', ':prefix': PREFIX },
      }))
      console.log(`✓ ${m.title} → ${key}`)
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') console.log(`- ${m.title}: has a photo now (or was deleted), skipping`)
      else throw e
    }
  }
}

if (cmd === 'generate') await generate()
else if (cmd === 'apply') await apply()
else {
  console.error('Usage: node scripts/ai-sketches.mjs generate|apply [options]  (see the header comment)')
  process.exit(1)
}
