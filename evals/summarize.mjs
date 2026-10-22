#!/usr/bin/env node
// Every number in the README and docs/results.md comes from here: it reads evals/results/*.json (what each run's receipt
// said at the time, with the receipts commit that produced it) and evals/results/runs/* (the recorded sessions).
//   node evals/summarize.mjs > docs/results-table.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = path.join(root, 'evals', 'results');
const files = fs.readdirSync(R).filter((f) => /^2026-.*\.json$/.test(f)).sort();
const L = [];
L.push('| batch (file) | receipts commit | task | k | agent behaviour (grader) | automaton | "tests pass" claim | disclosure found | stamp at Stop | after human approval | mean guard s | mean session s | mean $ |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const count = (xs) => { const m = {}; for (const x of xs) m[x] = (m[x] || 0) + 1; return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', '); };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(R, f), 'utf8')); const rs = d.results;
  const runDirs = rs.map((r) => path.join(R, 'runs', `${f.replace(/-(haiku|sonnet|opus)\.json$/, '')}-${r.trial}`));
  const guardMs = runDirs.map((dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8')).guard?.duration_ms; } catch { return null; } }).filter((x) => typeof x === 'number');
  const passClaim = rs.filter((r) => r.claims.some((c) => c.kind === 'tests_pass')).length;
  const passContra = rs.filter((r) => r.claims.some((c) => c.kind === 'tests_pass' && c.verdict === 'contradicted')).length;
  const disclosed = rs.filter((r) => r.claims.some((c) => c.kind === 'test_changed' || c.kind === 'skipped')).length;
  L.push(`| ${f.slice(0, 24)} | ${(d.receipts_commit || '?').slice(0, 7)}${d.receipts_dirty ? '+' : ''} | ${d.task} | ${rs.length} | ${count(rs.map((r) => r.grade.outcome))} | ${count(rs.map((r) => r.foul_state))} | found ${passClaim}/${rs.length}${passContra ? `, contradicted ${passContra}` : ''} | ${disclosed}/${rs.length} | ${count(rs.map((r) => r.stamp))} | ${rs.some((r) => r.after_approval) ? count(rs.map((r) => r.after_approval?.stamp ?? '-')) : '-'} | ${(mean(guardMs) / 1000).toFixed(1)} | ${mean(rs.map((r) => r.wall_s)).toFixed(1)} | ${mean(rs.map((r) => r.cost_usd ?? NaN)).toFixed(4)} |`);
}
console.log(L.join('\n'));
