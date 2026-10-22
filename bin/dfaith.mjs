#!/usr/bin/env node
// dfaith CLI.
//   dfaith check   [--session ID | --latest] [--no-guard] [--unsandboxed] [--llm] [--json] [--write] [--quiet]   build the receipt; exit code = stamp
//                  (no --session: the most recent session; --llm: also send unclassified sentences to Haiku, see src/claims/llm.mjs)
//   dfaith approve [--session ID | --latest] [--file PATH] [--by NAME]                                     a human approves the test change
//   dfaith serve   [--port 4320]                                                                           live automaton + receipts in the browser
//   dfaith dfa     [--format md|dot|mermaid|json]                                                          export the Foul DFA
//   dfaith claims  <file|->                                                                                run the claim DFA on a message
//   dfaith list                                                                                            recent sessions
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readMeta, listSessions, sessionDir, withLock, appendEvents, home } from '../src/session.mjs';
import { extractClaims } from '../src/claims/extract.mjs';
import { receiptFor } from '../src/receipt/build.mjs';
import { renderReceipt } from '../src/receipt/render.mjs';
import { FOUL_DFA } from '../src/foul/table.mjs';
import { toDot, toMermaid, toMarkdownTable } from '../src/dfa/dfa.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

function pickSession() {
  const id = opt('session') || listSessions()[0]?.id;
  if (!id) { console.error('no dfaith session found (is the plugin installed, and has a session run?)'); process.exit(64); }
  if (!opt('session') && !flag('latest') && !flag('quiet')) console.error(`(no --session given: using the most recent session, ${id})`);
  return id;
}

function writeReceipt(id, r) {
  const f = path.join(sessionDir(id), 'receipt.json'); fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(r, null, 2)); fs.renameSync(`${f}.${process.pid}.tmp`, f); // atomic: readers never see half a receipt
  // also an aos.verdict/1-shaped record, so the AOS dashboard's Guard view can show the stamp (opt-in: DFAITH_AOS_ORCH_DIR)
  const orch = process.env.DFAITH_AOS_ORCH_DIR;
  if (orch && r.guard?.ran) {
    const d = new Date(); const vid = `v-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}-${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
    const rec = { schema: 'aos.verdict/1', id: vid, created_at: d.toISOString(), repo: readMeta(id)?.repo, repo_name: r.repo_name, base: r.base, base_ref: null, tree: 'working', accepted: r.stamp === 'VERIFIED', integrity: r.tamper.length > 0,
      rejections: r.stamp === 'VERIFIED' ? [] : [{ kind: `dfaith_${r.stamp.toLowerCase()}`, detail: r.why.slice(0, 300) }], warnings: r.notes.slice(0, 20).map((n) => n.slice(0, 200)), failing_tests: (r.guard.failing_tests || []).slice(0, 20).map((t) => `${t.file ? `${t.file}: ` : ''}${t.name}`.slice(0, 200)),
      checks: (r.guard.checks || []).map((c) => ({ argv: String(c.argv).slice(0, 200), ok: !!c.ok, exit_code: null, duration_ms: 0 })), duration_ms: r.guard.duration_ms || 0, source: 'hook', session_id: id.slice(0, 64), tool_version: 'dfaith/0.1.0' };
    fs.mkdirSync(path.join(orch, 'verdicts'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(orch, 'verdicts', `${vid}.json`), JSON.stringify(rec, null, 2), { mode: 0o600 });
  }
}

async function main() {
  switch (cmd) {
    case 'check': {
      const id = pickSession();
      // one check per session at a time: Stop fires every turn, and a sandboxed rerun can take a minute. A check that finds
      // another one running asks it to run once more when it finishes (so the newest turn is always judged), then exits.
      const lockFile = path.join(sessionDir(id), 'check.lock'); const again = path.join(sessionDir(id), 'check.again');
      if (flag('write')) {
        try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); } catch {
          let alive = false; try { process.kill(Number(fs.readFileSync(lockFile, 'utf8')), 0); alive = true; } catch { /* stale */ }
          if (alive) { fs.writeFileSync(again, '1'); if (!flag('quiet')) console.error('a check for this session is already running; it will run again when it finishes'); break; }
          fs.writeFileSync(lockFile, String(process.pid));
        }
      }
      let r;
      try {
        do { try { fs.rmSync(again, { force: true }); } catch { /* none */ }
          r = await receiptFor(id, { guard: !flag('no-guard'), unsandboxed: flag('unsandboxed'), llm: flag('llm') || undefined });
          if (flag('write')) writeReceipt(id, r);
        } while (flag('write') && fs.existsSync(again));
      } finally { if (flag('write')) fs.rmSync(lockFile, { force: true }); }
      if (!flag('quiet')) console.log(flag('json') ? JSON.stringify(r, null, 2) : renderReceipt(r));
      process.exitCode = r.exit_code;
      break;
    }
    case 'approve': {
      const id = pickSession(); const file = opt('file');
      withLock(id, () => appendEvents(id, [{ hook: 'dfaith-approve', symbol: 'APPROVE', evidence: { file, by: opt('by') || os.userInfo().username, via: 'cli' } }]));
      const r = await receiptFor(id); writeReceipt(id, r);
      console.log(renderReceipt(r)); process.exitCode = r.exit_code;
      break;
    }
    case 'serve': {
      const { serve } = await import('../viewer/server.mjs');
      await serve({ port: Number(opt('port', '4320')) });
      break;
    }
    case 'dfa': {
      const f = opt('format', 'md');
      console.log(f === 'dot' ? toDot(FOUL_DFA, { colors: { foul: '#f6c1c7', tamper: '#fde2c4', ok: '#cdeccf' } }) : f === 'mermaid' ? toMermaid(FOUL_DFA) : f === 'json' ? JSON.stringify(FOUL_DFA, null, 2) : toMarkdownTable(FOUL_DFA));
      break;
    }
    case 'claims': {
      const src = argv[1] && argv[1] !== '-' ? fs.readFileSync(argv[1], 'utf8') : fs.readFileSync(0, 'utf8');
      console.log(JSON.stringify(extractClaims(src), null, 2));
      break;
    }
    case 'list': {
      for (const s of listSessions().slice(0, 20)) { const m = readMeta(s.id); let st = '-'; try { st = JSON.parse(fs.readFileSync(path.join(sessionDir(s.id), 'receipt.json'), 'utf8')).stamp; } catch { /* none */ } console.log(`${s.id}  ${m?.repo_name ?? '?'}  ${m?.started_at ?? ''}  ${st}`); }
      console.log(`(${home()})`);
      break;
    }
    default:
      console.log('usage: dfaith check|approve|serve|dfa|claims|list  (see bin/dfaith.mjs)'); process.exitCode = cmd ? 64 : 0;
  }
}

main().catch((e) => { console.error(e?.stack || e); process.exit(70); });
