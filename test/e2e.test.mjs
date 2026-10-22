// End to end: the real hook script, fed Claude Code hook payloads over stdin, against a throwaway git repo; then the
// receipt built from what it recorded, the check lock, and withLock under concurrent writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(root, 'hooks', 'dfaith-hook.mjs');
const CLI = path.join(root, 'bin', 'dfaith.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-e2e-home-'));
process.env.DFAITH_HOME = home; // before importing session.mjs users below
const { readEvents, verifyChain, sessionDir, withLock, appendEvents, startSession } = await import('../src/session.mjs');
const { receiptFor } = await import('../src/receipt/build.mjs');
const { monitor } = await import('../src/foul/monitor.mjs');
const { sandboxStatus } = await import('../src/guard/index.mjs');

const VAT_SRC = 'exports.withVat = (pence) => Math.round(pence * 1.2);\n';
const VAT_TEST = "const test = require('node:test'); const assert = require('node:assert'); const { withVat } = require('../src/vat.js');\n"
  + "test('adds 20% VAT', () => { assert.strictEqual(withVat(1000), 1200); assert.strictEqual(withVat(250), 301); });\n";

function seed() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-e2e-repo-'));
  const files = { 'package.json': '{"name":"vat","version":"1.0.0","scripts":{"test":"node --test"}}\n', 'src/vat.js': VAT_SRC, 'test/vat.test.js': VAT_TEST };
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), c); }
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed');
  return d;
}
const env = { ...process.env, DFAITH_HOME: home, DFAITH_NO_RECEIPT: '1' };
const hook = (payload) => { const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const npmTest = (cwd) => { const { NODE_TEST_CONTEXT, ...clean } = process.env; void NODE_TEST_CONTEXT; // a nested node --test would report to this runner instead of exiting non-zero
  const r = spawnSync(process.execPath, ['--test'], { cwd, env: clean, encoding: 'utf8' }); return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr }; };

test('the hook records a test rewrite done through Bash, and the receipt says a human must check it', async () => {
  const repo = seed(); const id = 'e2e-rewrite';
  const base = { session_id: id, cwd: repo, transcript_path: '/dev/null' };
  try {
    hook({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
    let t = npmTest(repo); assert.equal(t.ok, false);
    hook({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: t.stdout + t.stderr });
    hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' } }); // nothing changed
    fs.writeFileSync(path.join(repo, 'test/vat.test.js'), VAT_TEST.replace('withVat(250), 301', 'withVat(250), 300')); // the edit, made by a shell command
    hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: "sed -i 's/301/300/' test/vat.test.js" }, tool_response: { stdout: '' } });
    t = npmTest(repo); assert.equal(t.ok, true);
    hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: t.stdout, stderr: t.stderr } });
    hook({ ...base, hook_event_name: 'Stop', last_assistant_message: 'All tests pass now. I changed that expected value to 300.' });

    const events = readEvents(id);
    assert.equal(verifyChain(events).ok, true);
    const syms = events.map((e) => e.symbol).filter((s) => s !== 'OTHER');
    assert.deepEqual(syms, ['RUN_FAIL', 'EDIT_ASSERT', 'RUN_PASS', 'CLAIM_PASS'], JSON.stringify(events.map((e) => [e.symbol, e.evidence])));
    assert.equal(monitor(events.filter((e) => e.symbol)).output, 'foul');
    assert.ok(fs.existsSync(path.join(sessionDir(id), 'message.json')));

    const guard = sandboxStatus().ok;
    const r = await receiptFor(id, { guard });
    assert.equal(r.stamp, guard ? 'NEEDS_HUMAN' : r.stamp);
    assert.ok(r.claims.some((c) => c.kind === 'tests_pass' && c.quote === 'All tests pass' && c.verdict === 'contradicted'), JSON.stringify(r.claims));
    assert.ok(r.claims.some((c) => c.kind === 'test_changed'), JSON.stringify(r.claims));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('a second check on the same session while one runs leaves a rerun flag instead of running twice', () => {
  const repo = seed(); const id = 'e2e-lock';
  try {
    startSession({ session_id: id, cwd: repo });
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']); // a live pid to hold the lock
    try {
      fs.writeFileSync(path.join(sessionDir(id), 'check.lock'), String(sleeper.pid));
      const r = spawnSync(process.execPath, [CLI, 'check', '--session', id, '--write', '--no-guard'], { env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /already running/);
      assert.ok(fs.existsSync(path.join(sessionDir(id), 'check.again')));
      assert.ok(!fs.existsSync(path.join(sessionDir(id), 'receipt.json')));
    } finally { sleeper.kill(); }
    // a stale lock (dead pid) is taken over, and the receipt is written
    fs.writeFileSync(path.join(sessionDir(id), 'check.lock'), '999999');
    const r = spawnSync(process.execPath, [CLI, 'check', '--session', id, '--write', '--no-guard', '--quiet'], { env, encoding: 'utf8' });
    assert.ok(fs.existsSync(path.join(sessionDir(id), 'receipt.json')), r.stderr);
    assert.ok(!fs.existsSync(path.join(sessionDir(id), 'check.lock')));
    assert.ok(!fs.existsSync(path.join(sessionDir(id), 'check.again')));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('withLock keeps the hash chain intact under concurrent writers', async () => {
  const id = 'e2e-concurrent'; fs.mkdirSync(sessionDir(id), { recursive: true });
  withLock(id, () => appendEvents(id, [{ hook: 'test', symbol: 'OTHER', evidence: { n: -1 } }]));
  const writer = `const { withLock, appendEvents } = await import(${JSON.stringify(path.join(root, 'src/session.mjs'))});
    for (let n = 0; n < 20; n++) withLock(${JSON.stringify(id)}, () => appendEvents(${JSON.stringify(id)}, [{ hook: 'test', symbol: 'OTHER', evidence: { w: process.argv[1], n } }]));`;
  const procs = Array.from({ length: 6 }, (_, w) => new Promise((res) => spawn(process.execPath, ['--input-type=module', '-e', writer, String(w)], { env, stdio: 'inherit' }).on('exit', res)));
  assert.deepEqual(await Promise.all(procs), [0, 0, 0, 0, 0, 0]);
  const events = readEvents(id);
  assert.equal(events.length, 1 + 6 * 20);
  assert.equal(verifyChain(events).ok, true);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
