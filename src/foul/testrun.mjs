// Parse the result of a test command from its captured output. Exit codes are not reliable here: agents pipe test output
// through head/grep/tail, which turns a failing run into exit 0 (seen in the very first probe run). So the output decides.
// Returns {result: 'pass'|'fail'|'unknown', runner, counts?, failing_files: [path], detail}.

const rel = (p, cwd) => { let s = String(p).replace(/^file:\/\//, ''); if (cwd && s.startsWith(`${cwd}/`)) s = s.slice(cwd.length + 1); return s; };

export function parseTestRun(output, { cwd = '', failed = false } = {}) {
  const out = String(output || '');
  const failing = new Set();
  // node --test (TAP and spec reporters)
  for (const m of out.matchAll(/location:\s*'([^':]+):\d+:\d+'/g)) failing.add(rel(m[1], cwd));
  let m = /^#\s*fail\s+(\d+)/m.exec(out) || /^ℹ\s*fail\s+(\d+)/m.exec(out);
  if (m) {
    const pass = (/^#\s*pass\s+(\d+)/m.exec(out) || /^ℹ\s*pass\s+(\d+)/m.exec(out) || [])[1];
    const tests = (/^#\s*tests\s+(\d+)/m.exec(out) || /^ℹ\s*tests\s+(\d+)/m.exec(out) || [])[1];
    const fail = Number(m[1]);
    if (fail === 0 && Number(tests) === 0) return { result: 'unknown', runner: 'node', detail: 'zero tests ran' };
    return { result: fail > 0 ? 'fail' : 'pass', runner: 'node', counts: { tests: Number(tests ?? NaN), pass: Number(pass ?? NaN), fail }, failing_files: fail > 0 ? [...failing] : [], detail: `${fail} failing` };
  }
  // jest / vitest
  m = /^\s*Tests:\s+(.*)$/m.exec(out) || /^\s*Tests\s{2,}(.*)$/m.exec(out);
  if (m) {
    for (const f of out.matchAll(/^\s*(?:FAIL|❯|×)\s+(\S+\.[cm]?[jt]sx?)/gm)) failing.add(rel(f[1], cwd));
    const fail = Number((/(\d+)\s+failed/.exec(m[1]) || [0, 0])[1]); const pass = Number((/(\d+)\s+passed/.exec(m[1]) || [0, 0])[1]);
    if (!fail && !pass) return { result: 'unknown', runner: 'jest', detail: m[1] };
    return { result: fail > 0 ? 'fail' : 'pass', runner: 'jest/vitest', counts: { tests: fail + pass, pass, fail }, failing_files: [...failing], detail: m[1].trim() };
  }
  // pytest summary line: "==== 1 failed, 2 passed in 0.12s ===="
  m = /^=+\s*(.*?\b(passed|failed|error|errors|no tests ran)\b.*?)\s+in\s+[\d.]+s\b.*=+\s*$/m.exec(out);
  if (m) {
    for (const f of out.matchAll(/^(?:FAILED|ERROR)\s+([^\s:]+)::/gm)) failing.add(rel(f[1], cwd));
    const fail = Number((/(\d+)\s+failed/.exec(m[1]) || [0, 0])[1]) + Number((/(\d+)\s+errors?/.exec(m[1]) || [0, 0])[1]);
    const pass = Number((/(\d+)\s+passed/.exec(m[1]) || [0, 0])[1]);
    if (!fail && !pass) return { result: 'unknown', runner: 'pytest', detail: m[1] };
    return { result: fail > 0 ? 'fail' : 'pass', runner: 'pytest', counts: { tests: fail + pass, pass, fail }, failing_files: [...failing], detail: m[1] };
  }
  // cargo
  m = /test result:\s*(ok|FAILED)\.\s*(\d+) passed;\s*(\d+) failed/.exec(out);
  if (m) return { result: m[1] === 'ok' && m[3] === '0' ? 'pass' : 'fail', runner: 'cargo', counts: { pass: Number(m[2]), fail: Number(m[3]) }, failing_files: [], detail: m[0] };
  // go
  if (/^(--- FAIL|FAIL\s)/m.test(out)) return { result: 'fail', runner: 'go', failing_files: [], detail: 'FAIL' };
  if (/^ok\s+\S+\s+[\d.]+s/m.test(out) && !/FAIL/.test(out)) return { result: 'pass', runner: 'go', failing_files: [], detail: 'ok' };
  // bare TAP
  if (/^not ok \d+/m.test(out)) return { result: 'fail', runner: 'tap', failing_files: [...failing], detail: 'not ok' };
  if (failed) return { result: 'fail', runner: 'unknown', failing_files: [], detail: 'the command exited non-zero' };
  return { result: 'unknown', runner: 'unknown', detail: 'no recognisable test summary in the output' };
}
