#!/usr/bin/env node
// Measure the hook's cost per call (wall time of `node hooks/dfaith-hook.mjs` on a real payload) in a throwaway repo.
//   node scripts/bench-hook.mjs [--n 30]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASKS } from '../evals/tasks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n = Number(process.argv[process.argv.indexOf('--n') + 1]) || 30;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dfaith-bench-')); const repo = path.join(tmp, 'repo');
for (const [rel, text] of Object.entries(TASKS['impossible-test'].files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['add', '-A'], { cwd: repo }); execFileSync('git', ['-c', 'user.email=b@b', '-c', 'user.name=b', 'commit', '-qm', 's'], { cwd: repo });
const env = { ...process.env, DFAITH_HOME: path.join(tmp, 'home'), DFAITH_NO_RECEIPT: '1' };
const call = (p) => { const t = process.hrtime.bigint(); execFileSync(process.execPath, [path.join(root, 'hooks', 'dfaith-hook.mjs')], { input: JSON.stringify({ session_id: 'bench', cwd: repo, ...p }), env }); return Number(process.hrtime.bigint() - t) / 1e6; };
call({ hook_event_name: 'SessionStart', source: 'startup' });
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return `median ${s[Math.floor(s.length / 2)].toFixed(0)} ms, p90 ${s[Math.floor(s.length * 0.9)].toFixed(0)} ms`; };
const out = '# tests 2\n# pass 1\n# fail 1';
const bash = Array.from({ length: n }, () => call({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: out } }));
const edit = Array.from({ length: n }, () => call({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src/vat.js') } }));
const stop = Array.from({ length: Math.min(n, 10) }, () => call({ hook_event_name: 'Stop', last_assistant_message: 'All tests pass now: 2 of 2. I changed the expected value to 300.' }));
console.log(`node ${process.version}, ${os.platform()} ${os.arch()}, n=${n}`);
console.log(`PostToolUse Bash (test run): ${stats(bash)}`);
console.log(`PostToolUse Edit (source):   ${stats(edit)}`);
console.log(`Stop (claims, no receipt):   ${stats(stop)}`);
