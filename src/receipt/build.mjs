// Gather a session's evidence and build its receipt (shared by the CLI, the Stop hook's background run and the viewer).
import fs from 'node:fs';
import path from 'node:path';
import { readMeta, readEvents, readSnapshot, sessionDir, verifyChain, listWatched, readText } from '../session.mjs';
import { monitor } from '../foul/monitor.mjs';
import { extractClaims } from '../claims/extract.mjs';
import { buildReceipt, netTamper } from './receipt.mjs';

/** Everything needed for a receipt, from the session folder plus the repo as it is now. */
export async function receiptFor(id, { guard = true, unsandboxed = false } = {}) {
  const meta = readMeta(id); if (!meta) throw new Error(`no session ${id}`);
  const events = readEvents(id);
  const chain = verifyChain(events);
  let msg = { message: '', claims: [] };
  try { msg = JSON.parse(fs.readFileSync(path.join(sessionDir(id), 'message.json'), 'utf8')); } catch { /* no Stop yet */ }
  const { claims, unclassified } = extractClaims(msg.message);
  const mon = monitor(events.filter((e) => e.symbol));
  const baseSnap = readSnapshot(id, undefined, 'base-snapshot.json');
  const now = {};
  if (meta.repo) for (const rel of new Set([...Object.keys(baseSnap), ...listWatched(meta.repo)])) { const t = readText(meta.repo, rel); if (t != null) now[rel] = t; }
  const net = netTamper(baseSnap, now);
  const lastRunEv = [...events].reverse().find((e) => e.symbol === 'RUN_PASS' || e.symbol === 'RUN_FAIL');
  const lastRun = lastRunEv ? { result: lastRunEv.symbol === 'RUN_PASS' ? 'pass' : 'fail', i: lastRunEv.i, evidence: lastRunEv.evidence } : null;
  const approvals = events.filter((e) => e.symbol === 'APPROVE').map((e) => ({ at: e.t, file: e.evidence?.file ?? null, by: e.evidence?.by ?? null }));
  const warnings = events.filter((e) => e.evidence?.warning).map((e) => e.evidence.warning);
  let g = null;
  if (guard) { const { runGuard } = await import('../guard/index.mjs'); g = await runGuard({ repo: meta.repo, base: meta.base, unsandboxed }); }
  const receipt = buildReceipt({ session: meta, claims, monitor: mon, guard: g, net, lastRun, approvals, warnings, chain });
  receipt.message = msg.message; receipt.unclassified = unclassified;
  return receipt;
}

