#!/usr/bin/env node
// receipts CLI.
//   receipts check   [--session ID | --latest] [--no-guard] [--unsandboxed] [--json] [--write] [--quiet]   build the receipt; exit code = stamp
//   receipts approve [--session ID | --latest] [--file PATH] [--by NAME]                                     a human approves the test change
//   receipts serve   [--port 4320]                                                                           live automaton + receipts in the browser
//   receipts dfa     [--format md|dot|mermaid|json]                                                          export the Foul DFA
//   receipts claims  <file|->                                                                                run the claim DFA on a message
//   receipts list                                                                                            recent sessions
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
  const id = opt('session') || (flag('latest') || !opt('session') ? listSessions()[0]?.id : null);
  if (!id) { console.error('no receipts session found (is the plugin installed, and has a session run?)'); process.exit(64); }
  return id;
}

function writeReceipt(id, r) {
  fs.writeFileSync(path.join(sessionDir(id), 'receipt.json'), JSON.stringify(r, null, 2));
  // also an aos.verdict/1-shaped record, so the AOS dashboard's Guard view can show the stamp (opt-in: RECEIPTS_AOS_ORCH_DIR)
  const orch = process.env.RECEIPTS_AOS_ORCH_DIR;
  if (orch && r.guard?.ran) {
    const d = new Date(); const vid = `v-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}-${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
    const rec = { schema: 'aos.verdict/1', id: vid, created_at: d.toISOString(), repo: readMeta(id)?.repo, repo_name: r.repo_name, base: r.base, base_ref: null, tree: 'working', accepted: r.stamp === 'VERIFIED', integrity: r.tamper.length > 0,
      rejections: r.stamp === 'VERIFIED' ? [] : [{ kind: `receipts_${r.stamp.toLowerCase()}`, detail: r.why.slice(0, 300) }], warnings: r.notes.slice(0, 20).map((n) => n.slice(0, 200)), failing_tests: (r.guard.failing_tests || []).slice(0, 20).map((t) => `${t.file ? `${t.file}: ` : ''}${t.name}`.slice(0, 200)),
      checks: (r.guard.checks || []).map((c) => ({ argv: String(c.argv).slice(0, 200), ok: !!c.ok, exit_code: null, duration_ms: 0 })), duration_ms: r.guard.duration_ms || 0, source: 'hook', session_id: id.slice(0, 64), tool_version: 'receipts/0.1.0' };
    fs.mkdirSync(path.join(orch, 'verdicts'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(orch, 'verdicts', `${vid}.json`), JSON.stringify(rec, null, 2), { mode: 0o600 });
  }
}

async function main() {
  switch (cmd) {
    case 'check': {
      const id = pickSession();
      const r = await receiptFor(id, { guard: !flag('no-guard'), unsandboxed: flag('unsandboxed') });
      if (flag('write')) writeReceipt(id, r);
      if (!flag('quiet')) console.log(flag('json') ? JSON.stringify(r, null, 2) : renderReceipt(r));
      process.exitCode = r.exit_code;
      break;
    }
    case 'approve': {
      const id = pickSession(); const file = opt('file');
      withLock(id, () => appendEvents(id, [{ hook: 'receipts-approve', symbol: 'APPROVE', evidence: { file, by: opt('by') || os.userInfo().username, via: 'cli' } }]));
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
      console.log('usage: receipts check|approve|serve|dfa|claims|list  (see bin/receipts.mjs)'); process.exitCode = cmd ? 64 : 0;
  }
}

main().catch((e) => { console.error(e?.stack || e); process.exit(70); });
