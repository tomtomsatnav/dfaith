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
const W = v45 ? 1080 : 1280; const H = v45 ? 1350 : 720; const scale = 1; const suffix = (v45 ? '-4x5' : '') + (opt('suffix', '') ? `-${opt('suffix')}` : '');
// the 4:5 page lays out at 864x1080 CSS px and is zoomed 1.25x (video recording ignores deviceScaleFactor)
const beats = opt('beats') ? fs.readFileSync(opt('beats'), 'utf8') : ''; // per-beat durations (ms) for a voiced cut
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));

const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-video-'));
const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } : {});
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: W, height: H }, deviceScaleFactor: scale, recordVideo: { dir: tmp, size: { width: Math.round(W * scale), height: Math.round(H * scale) } } });
const page = await ctx.newPage();
// log every caption / overlay change with its time since the page (and so the recording) started, for subtitles and voice-over
await page.addInitScript(() => {
  window.__cues = []; const t0 = performance.now();
  const snap = () => { const c = document.getElementById('capbar'); const g = document.getElementById('gridov'); const i = document.getElementById('installov');
    return c?.classList.contains('on') ? `cap:${c.querySelector('.n')?.textContent || '0'}|${c.textContent.replace(/^\d/, '').trim()}` : g?.classList.contains('on') ? 'grid|' : i?.classList.contains('on') ? 'install|' : 'none|'; };
  new MutationObserver(() => { const k = snap(); const last = window.__cues[window.__cues.length - 1]; if (!last || last.k !== k) window.__cues.push({ k, t: (performance.now() - t0) / 1000 }); })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?replay=${encodeURIComponent(run)}&video=1&theme=dark${v45 ? '&v45=1' : ''}${beats ? `&beats=${encodeURIComponent(beats)}` : ''}`);
await page.waitForFunction(() => document.title === 'dfaith · done', null, { timeout: 90000 });
await page.waitForTimeout(beats ? Math.max(1800, Number(JSON.parse(beats).install) || 0) : 1800); // hold the install line
const cues = await page.evaluate(() => window.__cues); const endT = await page.evaluate(() => performance.now() / 1000);
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
// cues -> demo<suffix>.cues.json (for scripts/voiceover.mjs) and demo<suffix>.srt (LinkedIn and YouTube accept SRT captions)
const TRIM = 0.4; const list = [];
for (let i = 0; i < cues.length; i++) { const [kind, text] = cues[i].k.split('|'); if (kind === 'none') continue; list.push({ id: kind.startsWith('cap:') ? `cap${kind.slice(4)}` : kind, text: text || '', start: Math.max(0, cues[i].t - TRIM), end: (cues[i + 1]?.t ?? endT) - TRIM }); }
fs.writeFileSync(path.join(out, `demo${suffix}.cues.json`), JSON.stringify(list, null, 2));
const ts = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const sec = Math.floor((ms % 60000) / 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
fs.writeFileSync(path.join(out, `demo${suffix}.srt`), list.filter((c) => c.text).map((c, n) => `${n + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n'));
console.log(`wrote demo${suffix}.cues.json and demo${suffix}.srt (${list.filter((c) => c.text).length} captions)`);
