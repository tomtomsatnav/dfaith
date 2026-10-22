#!/usr/bin/env node
// Real runs: a fresh seed repo per trial, a real `claude -p --model haiku` session with dfaith loaded as a plugin, then
// the receipt the plugin wrote at Stop. Nothing here is simulated. Usage:
//   node evals/run.mjs --task impossible-test --k 10 [--model haiku] [--out evals/results]
// Each trial's session folder (events.jsonl, message.json, receipt.json, meta.json) is copied to evals/results/runs/ with
// machine paths replaced by <tmp>, so the golden tests can replay exactly what happened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const taskId = opt('task', 'impossible-test'); const k = Number(opt('k', '5')); const model = opt('model', 'haiku');
const outDir = path.resolve(opt('out', path.join(root, 'evals', 'results')));
const task = TASKS[taskId]; if (!task) throw new Error(`unknown task ${taskId}; have ${Object.keys(TASKS).join(', ')}`);

const git = (cwd, a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function claude(cwd, env, sessionId) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('claude', ['-p', task.prompt, '--model', model, '--plugin-dir', root, '--session-id', sessionId, '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash Edit Write Read Glob Grep', '--output-format', 'json'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), Number(opt('timeout-min', '20')) * 60000);
    p.on('close', (code) => { clearTimeout(timer); let j = null; try { j = JSON.parse(out); } catch { /* not json */ } resolve({ code, json: j, stderr: err.slice(-2000), wall_s: (Date.now() - t0) / 1000 }); });
  });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-eval-'));
const home = path.join(tmpRoot, 'home');
fs.mkdirSync(path.join(outDir, 'runs'), { recursive: true });
const results = [];
const parallel = Math.max(1, Number(opt('parallel', '1')));
async function trial(t) {
  const repo = path.join(tmpRoot, `${taskId}-${t}`); fs.mkdirSync(repo);
  for (const [rel, text] of Object.entries(task.files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
  git(repo, ['init', '-q']); git(repo, ['add', '-A']); git(repo, ['-c', 'user.email=eval@dfaith', '-c', 'user.name=eval', 'commit', '-qm', 'seed']);
  const sessionId = crypto.randomUUID();
  const env = { ...process.env, DFAITH_HOME: home }; delete env.CLAUDE_CODE_SESSION_ID;
  const r = await claude(repo, env, sessionId);
  // the receipt is written by a detached process after Stop: wait for it
  const sdir = path.join(home, 'sessions', sessionId); let receipt = null;
  for (let w = 0; w < 1800 && !receipt; w++) { try { receipt = JSON.parse(fs.readFileSync(path.join(sdir, 'receipt.json'), 'utf8')); } catch { await sleep(500); } }
  const grade = task.grade(repo);
  let approved = null;
  if (args.includes('--approve') && receipt) { // a human signs off the test change, then the receipt is rebuilt
    try { execFileSync(process.execPath, [path.join(root, 'bin', 'dfaith.mjs'), 'approve', '--session', sessionId, '--by', 'eval-harness (standing in for a human)'], { env, stdio: 'ignore' }); } catch { /* exit code = stamp */ }
    approved = JSON.parse(fs.readFileSync(path.join(sdir, 'receipt.json'), 'utf8'));
  }
  const row = { task: taskId, trial: t, model, session_id: sessionId, claude_exit: r.code, wall_s: r.wall_s, cost_usd: r.json?.total_cost_usd ?? null, num_turns: r.json?.num_turns ?? null,
    grade, stamp: receipt?.stamp ?? null, exit_code: receipt?.exit_code ?? null, why: receipt?.why ?? null,
    claims: (receipt?.claims || []).map((c) => ({ kind: c.kind, verdict: c.verdict, quote: c.quote, span: c.span })),
    foul_state: receipt?.foul?.state ?? null, foul_path: receipt?.foul?.cited?.map((x) => `${x.from}-${x.symbol}->${x.to}`) ?? null,
    guard: receipt?.guard ? { ran: receipt.guard.ran, accepted: receipt.guard.accepted ?? null, rejections: (receipt.guard.rejections || []).map((x) => x.kind), reason: receipt.guard.reason ?? null } : null,
    after_approval: approved ? { stamp: approved.stamp, foul_state: approved.foul?.state, claims: approved.claims.map((c) => ({ kind: c.kind, verdict: c.verdict })) } : undefined,
    final_message: receipt?.message ?? r.json?.result ?? null, stderr: r.code ? r.stderr : undefined };
  results.push(row);
  console.log(`${taskId} ${t}/${k}: grade=${grade.outcome} stamp=${row.stamp}${approved ? ` approved->${approved.stamp}/${approved.foul?.state}` : ''} foul=${row.foul_state} claims=${row.claims.map((c) => `${c.kind}:${c.verdict}`).join(',')} ${row.wall_s}s`);
  // keep the session for golden replay, with machine paths redacted
  if (fs.existsSync(sdir)) {
    const dest = path.join(outDir, 'runs', `${stamp}-${taskId}-${t}`); fs.mkdirSync(dest, { recursive: true });
    for (const f of ['events.jsonl', 'message.json', 'receipt.json', 'meta.json']) if (fs.existsSync(path.join(sdir, f))) fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(sdir, f), 'utf8').split(tmpRoot).join('<tmp>').split(os.tmpdir()).join('<tmpdir>'));
    fs.writeFileSync(path.join(dest, 'grade.json'), JSON.stringify(grade, null, 2));
  }
}
// trials run `parallel` at a time (each has its own seed repo and session); results are kept in trial order
const queue = Array.from({ length: k }, (_, i) => i + 1);
await Promise.all(Array.from({ length: Math.min(parallel, k) }, async () => { for (let t = queue.shift(); t; t = queue.shift()) await trial(t); }));
results.sort((a, b) => a.trial - b.trial);
const file = path.join(outDir, `${stamp}-${taskId}-${model}.json`);
fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), dfaith_commit: git(root, ['rev-parse', 'HEAD']), dfaith_dirty: git(root, ['status', '--porcelain']).length > 0, claude_version: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), task: taskId, model, k, prompt: task.prompt, results }, null, 2));
console.log(`wrote ${path.relative(root, file)}`);
