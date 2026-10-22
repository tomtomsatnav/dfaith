// Per-session storage under DFAITH_HOME (default ~/.dfaith): meta.json, a hash-chained events.jsonl, the snapshot of
// watched (test + harness) files, and receipt.json. Nothing is ever written into the repo the agent works on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isWatchedPath } from './foul/paths.mjs';

export const SCHEMA_SESSION = 'dfaith.session/1';
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_WATCHED = 2000;

export const home = (env = process.env) => env.DFAITH_HOME || path.join(os.homedir(), '.dfaith');
const SID = /^[A-Za-z0-9_-]{1,128}$/;
export function sessionDir(id, env = process.env) {
  if (!SID.test(String(id))) throw new Error(`invalid session id ${JSON.stringify(String(id).slice(0, 40))}`);
  return path.join(home(env), 'sessions', id);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// git in the agent's repo: its config is writable by the agent, so ignore global/system config, hooks and fsmonitor
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
export function git(cwd, args, { timeout = 5000 } = {}) {
  try { return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).trim(); } catch { return null; }
}

export function repoRoot(cwd) { return git(cwd, ['rev-parse', '--show-toplevel']); }

/** Watched files in the repo (tracked + untracked, not ignored). */
export function listWatched(root) {
  const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (out == null) return [];
  return out.split('\0').filter(Boolean).filter(isWatchedPath).slice(0, MAX_WATCHED);
}

export function readText(root, rel) {
  try { const abs = path.join(root, rel); const st = fs.statSync(abs); if (!st.isFile() || st.size > MAX_FILE_BYTES) return null; return fs.readFileSync(abs, 'utf8'); } catch { return null; }
}

/** Start (or resume) a session: records the base commit and a snapshot of every watched file. Idempotent: the first record wins. */
export function startSession({ session_id, cwd }, env = process.env) {
  const dir = sessionDir(session_id, env);
  const metaFile = path.join(dir, 'meta.json');
  if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const root = repoRoot(cwd);
  // base = the working tree as it was at session start (git stash create captures uncommitted tracked changes without
  // touching the tree or any ref); falls back to HEAD on a clean tree
  const head = root ? git(root, ['rev-parse', '--verify', 'HEAD']) : null;
  const stash = root ? git(root, ['stash', 'create']) : null;
  const base = /^[0-9a-f]{40}$/.test(stash || '') ? stash : /^[0-9a-f]{40}$/.test(head || '') ? head : null;
  const snapshot = {};
  if (root) for (const rel of listWatched(root)) { const t = readText(root, rel); if (t != null) snapshot[rel] = t; }
  const meta = { schema: SCHEMA_SESSION, session_id, repo: root, repo_name: root ? path.basename(root) : null, cwd, base, head, base_dirty: !!stash, started_at: new Date().toISOString(), watched_at_start: Object.keys(snapshot).length };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(dir, 'base-snapshot.json'), JSON.stringify(snapshot));
  return meta;
}

export const readMeta = (id, env) => { try { return JSON.parse(fs.readFileSync(path.join(sessionDir(id, env), 'meta.json'), 'utf8')); } catch { return null; } };
export const readSnapshot = (id, env, name = 'snapshot.json') => { try { return JSON.parse(fs.readFileSync(path.join(sessionDir(id, env), name), 'utf8')); } catch { return {}; } };
export const writeSnapshot = (id, snap, env) => fs.writeFileSync(path.join(sessionDir(id, env), 'snapshot.json'), JSON.stringify(snap));

/** Exclusive lock around a read-modify-write of the session (parallel tool calls fire hooks concurrently). */
export function withLock(id, fn, env = process.env) {
  const lock = path.join(sessionDir(id, env), '.lock');
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch { /* raced */ }
      if (Date.now() - t0 > 8000) throw new Error('session lock timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

/** Append events (hash-chained: each carries prev and its own hash over its content). Call inside withLock. */
export function appendEvents(id, events, env = process.env) {
  const file = path.join(sessionDir(id, env), 'events.jsonl');
  const existing = readEvents(id, env);
  let prev = existing.length ? existing[existing.length - 1].hash : '0'.repeat(64);
  let i = existing.length;
  const out = [];
  for (const e of events) {
    const body = { i: i++, t: new Date().toISOString(), ...e, prev };
    const rec = { ...body, hash: sha(prev + JSON.stringify(body)) };
    out.push(rec); prev = rec.hash;
  }
  if (out.length) fs.appendFileSync(file, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return out;
}

export function readEvents(id, env = process.env) {
  try { return fs.readFileSync(path.join(sessionDir(id, env), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** Verify the hash chain. Returns {ok, broken_at}. */
export function verifyChain(events) {
  let prev = '0'.repeat(64);
  for (const e of events) {
    const { hash, ...body } = e;
    if (body.prev !== prev || sha(prev + JSON.stringify(body)) !== hash) return { ok: false, broken_at: e.i };
    prev = hash;
  }
  return { ok: true, broken_at: null };
}

export function listSessions(env = process.env) {
  const d = path.join(home(env), 'sessions');
  try { return fs.readdirSync(d).filter((n) => SID.test(n)).map((n) => ({ id: n, mtime: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.mtime - a.mtime); } catch { return []; }
}
