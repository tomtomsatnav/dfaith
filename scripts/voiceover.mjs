#!/usr/bin/env node
// Optional voice-over for the demo video, made with ElevenLabs. It works with any voice in your ElevenLabs account,
// including a clone of your own voice (Instant Voice Cloning needs about a minute of clean audio of you; see
// docs/voiceover.md). It needs your API key; nothing is sent anywhere unless you run it.
//
//   ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node scripts/voiceover.mjs [--format 45|169] [--dry-run]
//
// Each line below is spoken at the start of its cue. The cue times come from docs/demo<suffix>.cues.json, written by
// scripts/record-demo.mjs, so the voice lands on the same beat as the caption. A line longer than its window is sped up
// by at most 12%; beyond that the script stops and says which line to shorten, rather than letting lines overlap.
// Output: docs/demo<suffix>-voice.mp4 (the silent cut is kept as it is; captions stay, since most feeds autoplay muted).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const suffix = opt('format', '45') === '45' ? '-4x5' : '';
const dry = args.includes('--dry-run');

// What is said. "dfaith" is spelled out phonetically for the speech engine.
export const LINES = {
  cap0: 'The AI said: all tests pass. That was not true.',
  cap1: 'The task: make the tests pass. But the test is wrong.',
  cap2: 'The tests fail.',
  cap3: 'So it edits the test, not the code.',
  cap4: 'Now they pass.',
  cap5: 'Its report: all tests pass.',
  cap6: 'Dee-faith reruns the original tests. They fail.',
  cap7: 'Do not merge. A human checks that edit.',
  grid: 'Ten runs. Ten rewrites. Every one stamped.',
  install: 'Dee-faith. One line to install.',
};

const cues = JSON.parse(fs.readFileSync(path.join(root, 'docs', `demo${suffix}.cues.json`), 'utf8'));
const video = path.join(root, 'docs', `demo${suffix}.mp4`);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const videoDur = dur(video);
const plan = cues.filter((c) => LINES[c.id]).map((c) => ({ ...c, say: LINES[c.id], window: c.end - c.start }));
const missing = Object.keys(LINES).filter((k) => !plan.some((p) => p.id === k));
if (missing.length) console.log(`note: no cue in the recording for ${missing.join(', ')} (re-record with scripts/record-demo.mjs)`);
for (const p of plan) console.log(`${p.start.toFixed(1).padStart(5)} s  [${p.window.toFixed(1)} s]  ${p.say}`);
if (dry) process.exit(0);

const key = process.env.ELEVENLABS_API_KEY; const voice = process.env.ELEVENLABS_VOICE_ID;
if (!key || !voice) { console.error('set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (see docs/voiceover.md)'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-voice-'));
const parts = [];
for (const [i, p] of plan.entries()) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: p.say, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
  });
  if (!res.ok) { console.error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const f = path.join(tmp, `${i}.mp3`); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  const d = dur(f); const room = p.window - 0.15; const tempo = d > room ? d / room : 1;
  if (tempo > 1.12) { console.error(`"${p.say}" takes ${d.toFixed(1)} s but its cue is ${p.window.toFixed(1)} s: shorten the line or lengthen the beat`); process.exit(1); }
  parts.push({ f, at: p.start + 0.1, tempo });
  console.log(`voiced ${p.id}: ${d.toFixed(1)} s${tempo > 1 ? ` (x${tempo.toFixed(2)})` : ''}`);
}
const inputs = parts.flatMap((p) => ['-i', p.f]);
const chains = parts.map((p, i) => `[${i + 1}:a]${p.tempo > 1 ? `atempo=${p.tempo.toFixed(3)},` : ''}adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[a${i}]`);
const mix = `${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,apad,atrim=0:${videoDur.toFixed(2)},loudnorm=I=-16:TP=-1.5[aout]`;
const outFile = path.join(root, 'docs', `demo${suffix}-voice.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, ...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', outFile]);
console.log(`wrote ${path.relative(root, outFile)}`);
