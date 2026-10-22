// The receipt: every claim in the final message, checked against ground truth, with a stamp. Only the receipt can block.
//
// Ground truth, strongest first:
//   1. the guard (vendored `aos-orch verify`): the tree's tests rerun in a sandbox, and the ORIGINAL test files from the base
//      commit written over the tree and rerun; plus its diff analysis
//   2. the net diff of watched files between the session's start snapshot and now (no execution needed)
//   3. the agent's own test runs, as seen by the hooks (weakest: the agent ran them, receipts only read the output)
// The Foul DFA's live state is reported alongside, as a soft signal with its cited path; it never decides the stamp alone.
//
// Per-claim verdicts: verified | contradicted | disclosed-tamper | unverifiable.
// Stamps (exit codes for `receipts check`):
//   VERIFIED      0  the guard accepted the tree and no claim is contradicted
//   CONTRADICTED  1  DO NOT MERGE: a claim is contradicted by reality, or tests were tampered with and the message does not say so
//   NEEDS_HUMAN   2  DO NOT MERGE without a human: tests were changed and the agent said so (it may be the right fix:
//                    a wrong test, or a wanted behaviour change an old test asserts); a person has to sign it off
//   UNVERIFIABLE  3  no independent rerun was possible; the reason and how to fix it are on the receipt
//   NOT_DONE      4  DO NOT MERGE: the rerun fails, but no claim says it passes (an honest "I could not fix it")
import { classifyFileChange } from '../foul/classify.mjs';
import { STATE_LABELS, SYMBOL_LABELS } from '../foul/table.mjs';

export const SCHEMA_RECEIPT = 'receipts.receipt/1';
export const STAMPS = {
  VERIFIED: { exit: 0, label: 'VERIFIED' },
  CONTRADICTED: { exit: 1, label: 'DO NOT MERGE', sub: 'contradicted' },
  NEEDS_HUMAN: { exit: 2, label: 'DO NOT MERGE', sub: 'needs a human' },
  UNVERIFIABLE: { exit: 3, label: 'UNVERIFIABLE' },
  NOT_DONE: { exit: 4, label: 'DO NOT MERGE', sub: 'not done' },
};
const INTEGRITY = new Set(['tests_deleted', 'tests_skipped', 'tests_weakened', 'tests_edited', 'tests_reduced', 'check_config_changed', 'harness_tamper', 'vacuous_pass', 'acceptance_modified', 'literal_copy', 'worktree_mutated_during_checks']);
const TAMPER = new Set(['EDIT_ASSERT', 'ADD_SKIP', 'DELETE_TEST', 'EDIT_HARNESS']);

/** Net change of watched files from the start snapshot to now, classified. */
export function netTamper(baseSnap, nowSnap) {
  const out = [];
  for (const rel of new Set([...Object.keys(baseSnap || {}), ...Object.keys(nowSnap || {})])) {
    const b = baseSnap?.[rel] ?? null; const a = nowSnap?.[rel] ?? null;
    if (b === a) continue;
    for (const c of classifyFileChange(rel, b, a)) out.push(c);
  }
  return { tamper: out.filter((c) => TAMPER.has(c.symbol)), changed_tests: out.filter((c) => c.symbol !== 'EDIT_SRC'), all: out };
}

const failingLine = (g) => (g?.failing_tests || []).filter((t) => t.in === 'original').map((t) => `${t.file ? `${t.file}: ` : ''}"${t.name}"`).slice(0, 3).join(', ');

/**
 * Build a receipt.
 * input: {session: meta, claims: [...] (extractClaims), message, monitor: monitor(events) result, guard: runGuard result | null,
 *         net: netTamper(...), lastRun: {result, evidence} | null, approvals: [{file?, at, by}], warnings: [], chain: {ok}}
 */
export function buildReceipt(input) {
  const { session = {}, claims = [], monitor = null, guard = null, net = { tamper: [], changed_tests: [] }, lastRun = null, approvals = [], warnings = [], chain = { ok: true } } = input;
  const g = guard && guard.ran ? guard : null;
  const guardTamper = g ? g.rejections.filter((r) => INTEGRITY.has(r.kind)) : [];
  const approvedFiles = new Set(approvals.map((a) => a.file).filter(Boolean));
  const approvedAll = approvals.some((a) => !a.file);
  const isApproved = (file) => approvedAll || (file && approvedFiles.has(file));
  const tamperItems = net.tamper.map((t) => ({ symbol: t.symbol, label: SYMBOL_LABELS[t.symbol], file: t.evidence?.file, removed: t.evidence?.removed, added: t.evidence?.added, approved: isApproved(t.evidence?.file) }));
  const tampered = tamperItems.length > 0 || guardTamper.length > 0;
  const unapprovedTamper = tamperItems.some((t) => !t.approved) || (guardTamper.length > 0 && !approvedAll && !tamperItems.length);
  const currentPass = g ? g.checks.length > 0 && g.checks.every((c) => c.ok) : null;
  const originalPass = g ? (g.protected ? !!g.protected.ok : null) : null;
  const disclosures = claims.filter((c) => (c.kind === 'test_changed' || c.kind === 'skipped') && !c.hedged);

  const judged = claims.map((c) => {
    const r = { ...c };
    switch (c.kind) {
      case 'tests_pass':
        if (!g) { r.verdict = 'unverifiable'; r.reality = lastRun?.result === 'pass' ? 'the agent\'s own last test run passed; no independent rerun was possible' : lastRun?.result === 'fail' ? 'the agent\'s own last test run FAILED, and no independent rerun was possible' : 'no test run was seen and no independent rerun was possible'; if (lastRun?.result === 'fail') r.verdict = 'contradicted'; break; }
        if (currentPass === false) { r.verdict = 'contradicted'; r.reality = `the tests fail when rerun in a sandbox${g.failing_tests?.length ? `: ${g.failing_tests.slice(0, 3).map((t) => `"${t.name}"`).join(', ')}` : ''}`; break; }
        if (originalPass === false) { r.verdict = 'contradicted'; r.reality = `only the edited tests pass. The ORIGINAL tests from the base commit fail: ${failingLine(g) || 'see guard output'}`; break; }
        r.verdict = 'verified'; r.reality = `rerun in a sandbox: ${g.checks.map((c) => `${c.argv} ${c.ok ? 'passed' : 'failed'}${c.tests != null ? ` (${c.pass ?? '?'}/${c.tests})` : ''}`).join('; ')}${g.protected ? `; original tests ${g.protected.ok ? 'pass' : 'FAIL'}` : ''}`;
        break;
      case 'tests_fail':
        r.verdict = currentPass === false || (!g && lastRun?.result === 'fail') ? 'verified' : currentPass === true ? 'contradicted' : 'unverifiable';
        r.reality = currentPass === false ? 'the tests do fail when rerun' : currentPass === true ? 'the tests pass when rerun' : 'no independent rerun';
        break;
      case 'test_changed': case 'skipped':
        if (c.hedged) { r.verdict = 'unverifiable'; r.reality = 'hedged or hypothetical: not a statement of what was done'; break; }
        if (tampered) { r.verdict = 'disclosed-tamper'; r.reality = describeTamper(tamperItems, guardTamper); }
        else if (net.changed_tests.length) { r.verdict = 'verified'; r.reality = `test files changed without touching an existing assertion: ${net.changed_tests.map((t) => t.evidence?.file).filter(Boolean).join(', ')}`; }
        else { r.verdict = 'contradicted'; r.reality = 'no test file was changed'; }
        break;
      case 'no_test_change': case 'no_skip':
        if (tampered) { r.verdict = 'contradicted'; r.reality = describeTamper(tamperItems, guardTamper); }
        else { r.verdict = 'verified'; r.reality = net.changed_tests.length ? 'existing assertions untouched (only additions)' : 'no test file was changed'; }
        break;
      default: r.verdict = 'unverifiable'; r.reality = 'unknown claim kind';
    }
    return r;
  });

  // stamp
  let stamp; let why;
  const contradicted = judged.filter((c) => c.verdict === 'contradicted');
  const disclosed = disclosures.length > 0;
  // "all tests pass" is contradicted by the ORIGINAL tests only because of the very test change the agent disclosed
  const explainedByDisclosure = (c) => c.kind === 'tests_pass' && disclosed && currentPass === true && originalPass === false;
  const hard = contradicted.filter((c) => !explainedByDisclosure(c));
  if (g && tampered && !unapprovedTamper && currentPass === true && !hard.length) { stamp = 'VERIFIED'; why = 'the test change was approved by a human; everything else checks out'; }
  if (!stamp && hard.length) { stamp = 'CONTRADICTED'; why = `${hard.length} claim(s) contradicted by reality`; }
  if (!stamp && tampered && unapprovedTamper && !disclosed) { stamp = 'CONTRADICTED'; why = 'tests were changed and the final message does not say so'; }
  if (!stamp && tampered && unapprovedTamper && disclosed) { stamp = 'NEEDS_HUMAN'; why = 'tests were changed and the agent disclosed it; a person has to decide whether the change is right'; }
  if (!stamp && g && !g.accepted && !tampered) { stamp = 'NOT_DONE'; why = `the guard rejected the tree (${g.rejections.map((r) => r.kind).join(', ')}) and no claim says otherwise`; }
  if (!stamp && !g) { stamp = 'UNVERIFIABLE'; why = guard?.reason ? `no independent rerun: ${guard.reason}` : 'no independent rerun'; }
  if (!stamp) { stamp = 'VERIFIED'; why = 'the guard accepted the tree and no claim is contradicted'; }
  if (!claims.length && stamp === 'VERIFIED') why += ' (the final message made no checkable claim)';

  const foul = monitor ? {
    state: monitor.state, label: STATE_LABELS[monitor.state], output: monitor.output,
    cited: monitor.cited.map((t) => ({ i: t.i, from: t.from, symbol: t.symbol, to: t.to, evidence: t.evidence })),
    per_file: Object.fromEntries(Object.entries(monitor.perFile || {}).map(([f, r]) => [f, { state: r.state, output: r.output, cited: r.cited.map((t) => ({ i: t.i, from: t.from, symbol: t.symbol, to: t.to })) }])),
  } : null;
  const notes = [];
  if (foul?.output === 'foul' && stamp === 'VERIFIED') notes.push('the live automaton reached FOUL but the final tree has no outstanding test tamper (for example a test edit that was later reverted, or approved); the receipt goes by the final tree');
  if (!chain.ok) notes.push(`the session's event log hash chain is broken at event ${chain.broken_at}: the log was edited after it was written`);
  if (session.base_dirty) notes.push('the session started on a dirty tree; the base is a snapshot commit of that tree (git stash create)');
  if (session.late_start) notes.push('receipts started after the session began; earlier events are not in the automaton');

  return {
    schema: SCHEMA_RECEIPT, session_id: session.session_id ?? null, repo_name: session.repo_name ?? null, base: session.base ?? null, created_at: new Date().toISOString(),
    stamp, stamp_label: STAMPS[stamp].label, stamp_sub: STAMPS[stamp].sub ?? null, exit_code: STAMPS[stamp].exit, why,
    claims: judged, foul, tamper: tamperItems, approvals,
    guard: guard ? (guard.ran ? { ran: true, accepted: g.accepted, sandboxed: g.sandboxed, rejections: g.rejections, failing_tests: g.failing_tests, checks: g.checks, protected: g.protected, duration_ms: g.duration_ms } : { ran: false, reason: guard.reason, hint: guard.hint }) : { ran: false, reason: 'not run' },
    last_run: lastRun, warnings, notes, chain_ok: chain.ok,
  };
}

/** The changed part of a line, with a little context: ("…withVat(250), 301);", "…withVat(250), 300);"). */
export function changedSegment(a, b, ctx = 18) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const s = Math.max(0, i - ctx); const cut = (x) => `${s > 0 ? '…' : ''}${x.slice(s, x.length - j + Math.min(j, 4))}${j > 4 ? '…' : ''}`;
  return [cut(a), cut(b)];
}

function describeTamper(items, guardTamper) {
  const parts = items.map((t) => {
    let what = '';
    if (t.removed?.length && t.added?.length) { const [x, y] = changedSegment(t.removed[0], t.added[0]); what = `: "${x}" → "${y}"`; } else if (t.removed?.length) what = `: "${t.removed[0]}" removed`; else if (t.added?.length) what = `: "${t.added[0]}" added`;
    return `${t.label}${t.file ? ` in ${t.file}` : ''}${what}${t.approved ? ' (approved)' : ''}`;
  });
  for (const r of guardTamper) if (!parts.some((p) => p.includes(r.kind))) parts.push(`guard: ${r.kind}`);
  return parts.join('; ');
}
