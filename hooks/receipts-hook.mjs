#!/usr/bin/env node
// Claude Code hook entry point for receipts. Registered for SessionStart, PostToolUse / PostToolUseFailure (Bash and the
// edit tools) and Stop. It records what happened as Foul-DFA symbols in ~/.receipts/sessions/<id>/events.jsonl and, at
// Stop, starts the receipt in the background. It never edits the conversation, never blocks the agent, and always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSession, readMeta, readSnapshot, writeSnapshot, withLock, appendEvents, listWatched, readText, sessionDir } from '../src/session.mjs';
import { classifyHookEvent } from '../src/foul/classify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  let raw = ''; for await (const c of process.stdin) raw += c;
  const p = JSON.parse(raw || '{}');
  const id = p.session_id; if (!id) return;
  const ev = p.hook_event_name;
  if (process.env.RECEIPTS_RAW_LOG) fs.appendFileSync(process.env.RECEIPTS_RAW_LOG, `${raw.replace(/\n/g, ' ')}\n`);
  let meta = readMeta(id);
  if (!meta) {
    meta = startSession({ session_id: id, cwd: p.cwd || process.cwd() });
    if (ev !== 'SessionStart') { meta.late_start = true; fs.writeFileSync(path.join(sessionDir(id), 'meta.json'), JSON.stringify(meta, null, 2)); }
  }
  if (ev === 'SessionStart') { withLock(id, () => appendEvents(id, [{ hook: ev, symbol: 'OTHER', evidence: { source: p.source ?? null } }])); return; }
  const root = meta.repo;
  const result = withLock(id, () => {
    const snapshot = readSnapshot(id);
    const r = classifyHookEvent(p, { root, snapshot, listWatched: () => (root ? listWatched(root) : []), readText: (rel) => (root ? readText(root, rel) : null) });
    writeSnapshot(id, snapshot);
    const recs = r.symbols.map((s) => ({ hook: ev, tool: p.tool_name ?? null, tool_use_id: p.tool_use_id ?? null, symbol: s.symbol, evidence: s.evidence }));
    for (const w of r.warnings) recs.push({ hook: ev, tool: p.tool_name ?? null, symbol: 'OTHER', evidence: { warning: w } });
    appendEvents(id, recs);
    return r;
  });
  if (ev === 'Stop') {
    fs.writeFileSync(path.join(sessionDir(id), 'message.json'), JSON.stringify({ at: new Date().toISOString(), message: result.message ?? '', claims: result.claims ?? [] }, null, 2));
    if (process.env.RECEIPTS_NO_RECEIPT === '1') return;
    // the receipt (with the sandboxed rerun) runs detached so the agent is never delayed
    const child = spawn(process.execPath, [path.join(here, '..', 'bin', 'receipts.mjs'), 'check', '--session', id, '--write', '--quiet'], { detached: true, stdio: 'ignore', cwd: sessionDir(id) });
    child.unref();
  }
}

main().catch((e) => { try { fs.appendFileSync(path.join(process.env.RECEIPTS_HOME || path.join(process.env.HOME || '/tmp', '.receipts'), 'hook-errors.log'), `${new Date().toISOString()} ${String(e?.stack || e).slice(0, 2000)}\n`); } catch { /* nothing */ } }).finally(() => process.exit(0));
