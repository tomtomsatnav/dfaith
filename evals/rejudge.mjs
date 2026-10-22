#!/usr/bin/env node
// Re-judge recorded runs with the CURRENT claim automaton and receipt logic, without re-running anything: the recorded
// hook events, the guard's result and the tamper facts are taken from the run folder as they were written at the time.
// Used to show a claim-DFA fix honestly: the original (held-out) receipt and the re-judged one side by side.
//   node evals/rejudge.mjs [--prefix 2026-10-22T00-34] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractClaims } from '../src/claims/extract.mjs';
import { buildReceipt } from '../src/receipt/receipt.mjs';
import { monitor } from '../src/foul/monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(root, 'evals', 'results', 'runs');
const args = process.argv.slice(2); const prefix = args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : '';
const read = (d, f) => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { return null; } };

export function rejudge(dir) {
  const old = JSON.parse(read(dir, 'receipt.json'));
  const events = (read(dir, 'events.jsonl') || '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const message = JSON.parse(read(dir, 'message.json') || '{}').message ?? old.message ?? '';
  const { claims } = extractClaims(message);
  const net = { tamper: (old.tamper || []).map((t) => ({ symbol: t.symbol, evidence: { file: t.file, removed: t.removed, added: t.added } })), changed_tests: (old.tamper || []).map((t) => ({ evidence: { file: t.file } })) };
  const lastRunEv = [...events].reverse().find((e) => e.symbol === 'RUN_PASS' || e.symbol === 'RUN_FAIL');
  const fresh = buildReceipt({ session: { session_id: old.session_id, repo_name: old.repo_name, base: old.base }, claims, monitor: monitor(events), guard: old.guard, net,
    lastRun: lastRunEv ? { result: lastRunEv.symbol === 'RUN_PASS' ? 'pass' : 'fail' } : null, approvals: old.approvals || [], warnings: old.warnings || [], chain: { ok: old.chain_ok !== false } });
  return { old, fresh, grade: JSON.parse(read(dir, 'grade.json') || 'null') };
}

if (process.argv[1] && process.argv[1].endsWith('rejudge.mjs')) {
  const rows = [];
  for (const name of fs.readdirSync(RUNS).filter((n) => n.startsWith(prefix)).sort()) {
    const { old, fresh, grade } = rejudge(path.join(RUNS, name));
    rows.push({ run: name, grade: grade?.outcome, old_stamp: old.stamp, new_stamp: fresh.stamp, old_claims: old.claims.map((c) => `${c.kind}:${c.verdict}`).join(','), new_claims: fresh.claims.map((c) => `${c.kind}:${c.verdict}`).join(','), foul: fresh.foul?.state });
  }
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.run.padEnd(45)} ${String(r.grade).padEnd(15)} ${r.old_stamp.padEnd(13)} -> ${r.new_stamp.padEnd(13)} ${r.foul}  ${r.new_claims}`);
}
