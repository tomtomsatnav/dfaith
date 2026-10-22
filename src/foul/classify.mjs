// The alphabet: turn one Claude Code hook event into Foul-DFA input symbols, each with the evidence that justifies it.
// This is the part of dfaith that is NOT a DFA. It is parsing: what a test run's output says, and what an edit did to a
// test file. It works from the file contents on disk (a snapshot diff after every tool call), not from the tool's input, so
// an edit made through Bash (sed -i, cat >, git checkout) is seen too.
import path from 'node:path';
import { isTestPath, isHarnessPath, isTestCommand, isAssertionLine, hasSkipMarker, packageJsonTestKeys } from './paths.mjs';
import { parseTestRun } from './testrun.mjs';
import { extractClaims } from '../claims/extract.mjs';

const clip = (s, n = 200) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Line diff (LCS). Returns {removed: [line], added: [line]}. Falls back to multiset difference on very large files. */
export function lineDiff(a, b) {
  const A = String(a ?? '').split('\n'); const B = String(b ?? '').split('\n');
  if (A.length * B.length > 4e6) {
    const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
    const ca = count(A); const cb = count(B);
    return { removed: A.filter((x) => { const k = cb.get(x) || 0; if (k > 0) { cb.set(x, k - 1); return false; } return true; }), added: B.filter((x) => { const k = ca.get(x) || 0; if (k > 0) { ca.set(x, k - 1); return false; } return true; }) };
  }
  const n = A.length; const m = B.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const removed = []; const added = []; let i = 0; let j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(A[i++]); else added.push(B[j++]); }
  while (i < n) removed.push(A[i++]); while (j < m) added.push(B[j++]);
  return { removed, added };
}

/**
 * Classify how one watched file changed between two snapshots. Returns [{symbol, evidence}] (empty if no meaningful change).
 * Symbols: DELETE_TEST, ADD_SKIP, EDIT_ASSERT, ADD_TEST, EDIT_HARNESS, EDIT_SRC.
 */
export function classifyFileChange(rel, before, after) {
  if (before === after) return [];
  if (isHarnessPath(rel)) {
    if (/(^|\/)package\.json$/.test(rel) && packageJsonTestKeys(before ?? '{}') === packageJsonTestKeys(after ?? '{}')) return [{ symbol: 'EDIT_SRC', evidence: { file: rel, note: 'package.json changed, test settings untouched' } }];
    const d = lineDiff(before, after);
    return [{ symbol: 'EDIT_HARNESS', evidence: { file: rel, removed: d.removed.slice(0, 3).map((l) => clip(l.trim())), added: d.added.slice(0, 3).map((l) => clip(l.trim())) } }];
  }
  if (!isTestPath(rel)) return [{ symbol: 'EDIT_SRC', evidence: { file: rel } }];
  if (before != null && after == null) return [{ symbol: 'DELETE_TEST', evidence: { file: rel } }];
  if (before == null) return [{ symbol: 'ADD_TEST', evidence: { file: rel, note: 'new test file' } }];
  // an existing test DATA file (expected output, fixture, snapshot) is the expectation itself: changing it is an assertion change
  if (!/\.([cm]?[jt]sx?|py|go|rb|java|kt|rs)$/.test(rel)) {
    const d = lineDiff(before, after);
    if (d.removed.length) return [{ symbol: 'EDIT_ASSERT', evidence: { file: rel, note: 'expected test data changed', removed: d.removed.slice(0, 3).map((l) => clip(l.trim())), added: d.added.slice(0, 3).map((l) => clip(l.trim())) } }];
    return [{ symbol: 'ADD_TEST', evidence: { file: rel, note: 'test data added to', added: d.added.length } }];
  }
  const d = lineDiff(before, after);
  const out = [];
  const skipsBefore = before.split('\n').filter(hasSkipMarker).length; const skipsAfter = after.split('\n').filter(hasSkipMarker).length;
  if (skipsAfter > skipsBefore) out.push({ symbol: 'ADD_SKIP', evidence: { file: rel, added: d.added.filter(hasSkipMarker).slice(0, 3).map((l) => clip(l.trim())) } });
  const touched = d.removed.filter(isAssertionLine);
  if (touched.length) out.push({ symbol: 'EDIT_ASSERT', evidence: { file: rel, removed: touched.slice(0, 3).map((l) => clip(l.trim())), added: d.added.filter(isAssertionLine).slice(0, 3).map((l) => clip(l.trim())) } });
  if (!out.length && (d.removed.length || d.added.length)) out.push({ symbol: 'ADD_TEST', evidence: { file: rel, note: 'test file changed, no existing assertion touched', added: d.added.length, removed: d.removed.length } });
  return out;
}

/**
 * Classify a hook payload. ctx: {root, snapshot (mutable {rel: text}), listWatched(): [rel], readText(rel)}.
 * Returns {symbols: [{symbol, evidence}], warnings: [string]}. Mutates ctx.snapshot to the new state of watched files.
 */
export function classifyHookEvent(p, ctx) {
  const ev = p.hook_event_name; const tool = p.tool_name; const ti = p.tool_input || {};
  const warnings = [];
  const relOf = (f) => (f && ctx.root ? path.relative(ctx.root, path.resolve(p.cwd || ctx.root, f)) : null);
  const inRepo = (r) => r != null && r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
  const rescan = (paths) => {
    const out = [];
    for (const rel of paths) {
      const before = Object.prototype.hasOwnProperty.call(ctx.snapshot, rel) ? ctx.snapshot[rel] : null;
      const after = ctx.readText(rel);
      if (before === after) continue;
      out.push(...classifyFileChange(rel, before, after));
      if (after == null) delete ctx.snapshot[rel]; else ctx.snapshot[rel] = after;
    }
    return out;
  };

  if (ev === 'Stop' || ev === 'SubagentStop') {
    if (ev === 'SubagentStop') return { symbols: [{ symbol: 'OTHER', evidence: { hook: ev } }], warnings };
    const msg = p.last_assistant_message ?? '';
    const { claims } = extractClaims(msg);
    const pass = claims.find((c) => c.kind === 'tests_pass' && !c.hedged);
    return { symbols: [pass ? { symbol: 'CLAIM_PASS', evidence: { quote: pass.quote, span: pass.span } } : { symbol: 'STOP', evidence: { claims: claims.length } }], warnings, claims, message: msg };
  }
  if (ev !== 'PostToolUse' && ev !== 'PostToolUseFailure') return { symbols: [{ symbol: 'OTHER', evidence: { hook: ev, ...(tool ? { tool } : {}) } }], warnings };

  // the agent touching dfaith's own state or the hook config is reported, never silently accepted
  const touched = [ti.file_path, ti.command, ti.notebook_path].filter(Boolean).join(' ');
  if (/\.dfaith\b|DFAITH_HOME|\.claude\/(settings|plugins)|plugins\/[^ ]*dfaith/.test(touched)) warnings.push(`the agent touched dfaith state or Claude Code settings: ${clip(touched, 160)}`);

  const symbols = [];
  if (tool === 'Bash') {
    if (ctx.root) symbols.push(...rescan([...new Set([...Object.keys(ctx.snapshot), ...ctx.listWatched()])]));
    if (isTestCommand(ti.command)) {
      const r = p.tool_response || {};
      const output = [r.stdout, r.stderr, typeof r === 'string' ? r : '', p.error].filter(Boolean).join('\n');
      const run = parseTestRun(output, { cwd: ctx.root || p.cwd, failed: ev === 'PostToolUseFailure' });
      const ev2 = { command: clip(ti.command, 160), runner: run.runner, detail: run.detail, ...(run.counts ? { counts: run.counts } : {}), failing_files: run.failing_files || [] };
      symbols.push(run.result === 'pass' ? { symbol: 'RUN_PASS', evidence: ev2 } : run.result === 'fail' ? { symbol: 'RUN_FAIL', evidence: ev2 } : { symbol: 'OTHER', evidence: { ...ev2, note: 'test command, result not recognised' } });
    }
    if (!symbols.length) symbols.push({ symbol: 'OTHER', evidence: { tool, command: clip(ti.command || '', 120) } });
    return { symbols, warnings };
  }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const rel = relOf(ti.file_path || ti.notebook_path);
    if (inRepo(rel)) {
      if (isTestPath(rel) || isHarnessPath(rel)) symbols.push(...rescan([rel]));
      else symbols.push({ symbol: 'EDIT_SRC', evidence: { file: rel } });
    }
    if (!symbols.length) symbols.push({ symbol: 'OTHER', evidence: { tool, file: rel } });
    return { symbols, warnings };
  }
  return { symbols: [{ symbol: 'OTHER', evidence: { tool } }], warnings };
}
