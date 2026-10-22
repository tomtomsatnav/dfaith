#!/usr/bin/env node
// Pick up receipts that were written after evals/run.mjs stopped waiting (the guard can take minutes on a big suite under
// load). For each result row with stamp null, read the session's receipt.json from the trial's temp folder (still on disk),
// update the row, and copy the session into evals/results/runs. Nothing is re-run or re-judged.
//   node evals/collect.mjs evals/results/<file>.json <tmpRoot>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [file, tmpRoot] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8')); const stamp = path.basename(file).replace(/-(haiku|sonnet|opus)\.json$/, '');
let fixed = 0;
for (const row of d.results) {
  if (row.stamp) continue;
  const sdir = path.join(tmpRoot, 'home', 'sessions', row.session_id);
  let receipt; try { receipt = JSON.parse(fs.readFileSync(path.join(sdir, 'receipt.json'), 'utf8')); } catch { console.log(`trial ${row.trial}: still no receipt`); continue; }
  Object.assign(row, { stamp: receipt.stamp, exit_code: receipt.exit_code, why: receipt.why, claims: receipt.claims.map((c) => ({ kind: c.kind, verdict: c.verdict, quote: c.quote, span: c.span })),
    foul_state: receipt.foul?.state ?? null, foul_path: receipt.foul?.cited?.map((x) => `${x.from}-${x.symbol}->${x.to}`) ?? null,
    guard: { ran: receipt.guard.ran, accepted: receipt.guard.accepted ?? null, rejections: (receipt.guard.rejections || []).map((x) => x.kind), reason: receipt.guard.reason ?? null },
    final_message: receipt.message ?? row.final_message, collected_late: true });
  const dest = path.join(path.dirname(file), 'runs', `${stamp}-${d.task}-${row.trial}`); fs.mkdirSync(dest, { recursive: true });
  for (const f of ['events.jsonl', 'message.json', 'receipt.json', 'meta.json']) if (fs.existsSync(path.join(sdir, f))) fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(sdir, f), 'utf8').split(tmpRoot).join('<tmp>').split(os.tmpdir()).join('<tmpdir>'));
  fixed++; console.log(`trial ${row.trial}: ${receipt.stamp} (${receipt.foul?.state})`);
}
fs.writeFileSync(file, JSON.stringify(d, null, 2));
console.log(`collected ${fixed}`);
