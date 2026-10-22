// Plain-text rendering of a receipt for the terminal.
import { STATE_LABELS } from '../foul/table.mjs';

const MARK = { verified: '✓', contradicted: '✗', 'disclosed-tamper': '!', unverifiable: '?' };

export function renderReceipt(r) {
  const L = [];
  L.push(`RECEIPT  ${r.repo_name ?? ''}  session ${String(r.session_id ?? '').slice(0, 8)}  base ${String(r.base ?? '').slice(0, 10)}`);
  L.push(`STAMP    ${r.stamp_label}${r.stamp_sub ? ` (${r.stamp_sub})` : ''}  [exit ${r.exit_code}]  ${r.why}`);
  L.push('');
  if (!r.claims.length) L.push('  (no checkable claim found in the final message)');
  for (const c of r.claims) {
    L.push(`  ${MARK[c.verdict] ?? '?'} ${c.verdict.toUpperCase().padEnd(16)} "${c.quote}"   [${c.kind}${c.hedged ? ', hedged' : ''}${c.by !== 'dfa' ? `, ${c.by}` : ''}, chars ${c.span[0]}-${c.span[1]}]`);
    L.push(`      reality: ${c.reality}`);
  }
  if (r.foul) {
    L.push('');
    L.push(`  automaton: ${r.foul.state} (${STATE_LABELS[r.foul.state]})`);
    if (r.foul.cited.length) L.push(`  path:      ${[r.foul.cited[0].from, ...r.foul.cited.map((t) => `-${t.symbol}-> ${t.to}`)].join(' ')}`);
    for (const [f, x] of Object.entries(r.foul.per_file || {})) if (x.cited.length) L.push(`  ${f}: ${[x.cited[0].from, ...x.cited.map((t) => `-${t.symbol}-> ${t.to}`)].join(' ')}`);
  }
  if (r.guard) L.push('', `  guard: ${r.guard.ran ? `${r.guard.accepted ? 'accepted' : 'rejected'}${r.guard.sandboxed ? ' (sandboxed)' : ' (UNSANDBOXED)'}${r.guard.rejections?.length ? `: ${r.guard.rejections.map((x) => x.kind).join(', ')}` : ''}` : `did not run: ${r.guard.reason}${r.guard.hint ? `\n  hint: ${r.guard.hint}` : ''}`}`);
  for (const n of r.notes || []) L.push(`  note: ${n}`);
  for (const w of r.warnings || []) L.push(`  warning: ${w}`);
  return L.join('\n');
}
