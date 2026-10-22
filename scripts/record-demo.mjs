#!/usr/bin/env node
// Record the demo video from a REAL recorded run: the viewer replays that run's hook events, final message and receipt
// (time-compressed, labelled as a replay on screen), Playwright records the page, ffmpeg makes the mp4 and the GIF.
//   node scripts/record-demo.mjs --run <evals/results/runs/NAME> [--out docs]
// Needs: playwright (with Chromium) and ffmpeg on PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../viewer/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); if (!run) throw new Error('--run NAME required');
const out = path.resolve(opt('out', path.join(root, 'docs')));
const v45 = opt('format', '169') === '45'; // 45 = 4:5 vertical feed cut (1080x1350), 169 = 16:9 (1280x720)
const W = v45 ? 1080 : 1280; const H = v45 ? 1350 : 720; const scale = 1; const suffix = v45 ? '-4x5' : ''; // the 4:5 page lays out at 864x1080 CSS px and is zoomed 1.25x (video recording ignores deviceScaleFactor) const suffix = v45 ? '-4x5' : '';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));

const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-video-'));
const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } : {});
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: W, height: H }, deviceScaleFactor: scale, recordVideo: { dir: tmp, size: { width: Math.round(W * scale), height: Math.round(H * scale) } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?replay=${encodeURIComponent(run)}&video=1&theme=dark${v45 ? '&v45=1' : ''}`);
await page.waitForFunction(() => document.title === 'dfaith · done', null, { timeout: 90000 });
await page.waitForTimeout(1800); // hold the install line
await ctx.close(); await browser.close(); server.close();
const webm = fs.readdirSync(tmp).find((f) => f.endsWith('.webm'));
console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)} s`);
fs.mkdirSync(out, { recursive: true });
const mp4 = path.join(out, `demo${suffix}.mp4`); const gif = path.join(out, `demo${suffix}.gif`);
// trim the first 0.4 s (page load), h264 for LinkedIn/GitHub, then a palette GIF at 960 px / 12 fps
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.4', '-i', path.join(tmp, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `fps=12,scale=${v45 ? 720 : 960}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).trim();
console.log(`wrote ${path.relative(root, mp4)} (${Number(dur).toFixed(1)} s) and ${path.relative(root, gif)} (${(fs.statSync(gif).size / 1e6).toFixed(1)} MB)`);
fs.writeFileSync(path.join(out, 'demo-source.json'), JSON.stringify({ run, recorded_at: new Date().toISOString(), note: 'replay of a real recorded run (evals/results/runs/<run>), time-compressed; nothing on screen is mocked' }, null, 2));
