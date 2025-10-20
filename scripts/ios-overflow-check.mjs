#!/usr/bin/env node
import { webkit, devices } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

// Tiny static server to serve the built app from dist/
async function startServer(rootDir, port = 4173) {
  const server = http.createServer(async (req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/' || p === '') p = '/index.html';
    const filePath = path.join(rootDir, p);
    try {
      const data = await readFile(filePath);
      res.statusCode = 200;
      if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
      if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
      res.end(data);
    } catch (e) {
      // SPA fallback
      try {
        const data = await readFile(path.join(rootDir, 'index.html'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(data);
      } catch (err) {
        res.statusCode = 404;
        res.end('Not found');
      }
    }
  });
  await new Promise(resolve => server.listen(port, resolve));
  return server;
}

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const docOverflow = doc.scrollWidth > doc.clientWidth;
    const bodyOverflow = body.scrollWidth > body.clientWidth;
    const offenders = [...document.querySelectorAll('*')]
      .filter(el => el.scrollWidth > el.clientWidth)
      .slice(0, 20)
      .map(el => {
        const rect = el.getBoundingClientRect();
        const classes = el.className && typeof el.className === 'string' ? el.className : '';
        const tag = el.tagName.toLowerCase();
        return { tag, classes: classes.slice(0, 80), width: el.scrollWidth, clientWidth: el.clientWidth, rect: { x: rect.x, width: rect.width } };
      });
    return { docOverflow, bodyOverflow, offenders };
  });
  console.log(`[${label}] Horizontal overflow?`, overflow);
  return overflow;
}

async function tryInteractions(page) {
  // Try opening first recipe card to show modal, then cook mode if available
  try {
    await page.waitForSelector('.recipe-card', { timeout: 1000 });
    const card = await page.$('.recipe-card');
    if (card) {
      await card.click();
      // small wait for modal animation
      await page.waitForTimeout(150);
      // try cook mode toggle
      const cookBtn = await page.$('.cook-mode-btn');
      if (cookBtn) {
        await cookBtn.click();
        await page.waitForTimeout(150);
      }
    }
  } catch {}
}

async function main() {
  const distDir = path.resolve(process.cwd(), 'dist');
  const server = await startServer(distDir, 5173);
  const browser = await webkit.launch();

  const scenarios = [
    { device: devices['iPhone 12'], label: 'iPhone 12 portrait' },
    { device: { ...devices['iPhone 12'], screen: { ...devices['iPhone 12'].screen, width: devices['iPhone 12'].screen.height, height: devices['iPhone 12'].screen.width } }, label: 'iPhone 12 landscape' },
    { device: devices['iPhone SE'], label: 'iPhone SE portrait' }
  ];

  let exitCode = 0;

  for (const s of scenarios) {
    const context = await browser.newContext({ ...s.device });
    const page = await context.newPage();
    await page.goto('http://localhost:5173/');

    const base = await checkOverflow(page, `${s.label} - base`);
    if (base.docOverflow || base.bodyOverflow) exitCode = 1;

    await tryInteractions(page);
    const after = await checkOverflow(page, `${s.label} - after interactions`);
    if (after.docOverflow || after.bodyOverflow) exitCode = 1;

    await context.close();
  }

  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (exitCode) process.exit(exitCode);
}

main().catch(err => { console.error(err); process.exit(1); });
