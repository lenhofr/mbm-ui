#!/usr/bin/env node
import fs from 'node:fs'
import https from 'node:https'

const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l && l[0] !== '#').map(l=>{ const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1)]; }))
const base = (env.VITE_API_BASE || '').trim()
if (!base) { console.error('no VITE_API_BASE'); process.exit(2) }
const url = base + '/images/test-key'
https.request(url, { method: 'HEAD' }, res => {
  console.log('HEAD', url, '->', res.statusCode)
  process.exit((res.statusCode >= 200 && res.statusCode < 400) ? 0 : 1)
}).on('error', e => { console.error(e.message || e); process.exit(1) }).end()
