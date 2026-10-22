#!/usr/bin/env node
// Measure how long each caption is actually on screen in the video replay (real time, as recorded), and flag any caption
// shorter than a reading-time budget of 1.2 s + 0.3 s per word (minimum 2.5 s).
//   node scripts/caption-timing.mjs --run <evals/results/runs/NAME> [--v45]
import path from 'node:path';
import { createServer } from '../viewer/server.mjs';

const args = process.argv.slice(2); const run = args[args.indexOf('--run') + 1];
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: args.includes('--v45') ? { width: 1080, height: 1350 } : { width: 1280, height: 720 }, colorScheme: 'dark' });
await page.addInitScript(() => {
  window.__caps = []; const t0 = performance.now();
  new MutationObserver(() => { const c = document.getElementById('capbar'); if (!c) return; const on = c.classList.contains('on'); const text = on ? c.textContent : ''; const last = window.__caps[window.__caps.length - 1]; if (!last || last.text !== text) window.__caps.push({ text, t: (performance.now() - t0) / 1000 }); })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
await page.goto(`http://127.0.0.1:${server.address().port}/?replay=${encodeURIComponent(run)}&video=1&theme=dark${args.includes('--v45') ? '&v45=1' : ''}`);
await page.waitForFunction(() => document.title.endsWith('· done'), null, { timeout: 120000 });
const caps = await page.evaluate(() => window.__caps); const end = await page.evaluate(() => performance.now() / 1000);
await browser.close(); server.close();
let bad = 0;
for (let i = 0; i < caps.length; i++) {
  const c = caps[i]; if (!c.text) continue;
  const dur = (caps[i + 1]?.t ?? end) - c.t; const words = c.text.replace(/^\d\s*/, '').split(/\s+/).filter(Boolean).length; const need = Math.max(2.5, 1.2 + 0.3 * words);
  const ok = dur >= need; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'SHORT'} ${dur.toFixed(1).padStart(4)} s on screen, needs ${need.toFixed(1)} s (${words} words): ${c.text.slice(0, 70)}`);
}
console.log(bad ? `${bad} caption(s) too short` : 'every caption meets the reading-time budget');
process.exitCode = bad ? 1 : 0;
