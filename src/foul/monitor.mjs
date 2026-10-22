// Replay a session's recorded symbols through the Foul DFA: one session-wide run plus one run per test file that was
// tampered with. A DFA cannot bind variables, so "the edited test file is the one that was failing" is answered by
// running a separate instance per file over a per-file projection of the same event stream, not by adding states.
import { FOUL_DFA, TAMPER_SYMBOLS } from './table.mjs';
import { createRun, citePath } from '../dfa/dfa.mjs';

/** events: [{i, symbol, evidence}] in order. */
export function monitor(events) {
  const session = createRun(FOUL_DFA);
  for (const e of events) session.feed(e.symbol, { i: e.i, ...(e.evidence || {}) });
  const files = [...new Set(events.filter((e) => TAMPER_SYMBOLS.has(e.symbol) && e.evidence?.file).map((e) => e.evidence.file))];
  const perFile = {};
  for (const f of files) {
    const r = createRun(FOUL_DFA);
    for (const e of events) r.feed(project(e, f), { i: e.i, ...(e.evidence || {}), projected_from: e.symbol });
    perFile[f] = { state: r.state, output: r.output, path: r.path, cited: citePath(FOUL_DFA, r.path) };
  }
  return { state: session.state, output: session.output, path: session.path, cited: citePath(FOUL_DFA, session.path), perFile };
}

/** The symbol an event means for the instance watching test file f. */
export function project(e, f) {
  const ev = e.evidence || {};
  if (TAMPER_SYMBOLS.has(e.symbol) && e.symbol !== 'EDIT_HARNESS' && ev.file && ev.file !== f) return 'EDIT_SRC'; // another file's tamper: f's status is stale, f is not tampered
  if (e.symbol === 'RUN_FAIL' && Array.isArray(ev.failing_files) && ev.failing_files.length && !ev.failing_files.includes(f)) return 'RUN_PASS'; // f was not among the failures
  return e.symbol;
}
