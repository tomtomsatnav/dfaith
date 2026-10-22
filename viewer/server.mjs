// receipts viewer: a local, read-only web page that shows the Foul DFA live (states light up as the agent moves, the foul
// states turn red) and the receipt card. Zero dependencies. Binds to 127.0.0.1 only.
//   GET /                      the page
//   GET /api/dfa               the Foul DFA (table, labels, layout)
//   GET /api/sessions          recent sessions with their stamp
//   GET /api/session/:id       events + receipt + final message of one session
//   GET /api/stream/:id        server-sent events: new automaton events and the receipt as they are written
//   GET /api/runs              recorded eval runs (evals/results/runs/*) for replay and the runs grid
//   GET /api/run/:name         one recorded run
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOUL_DFA } from '../src/foul/table.mjs';
import { listSessions, readMeta, readEvents, sessionDir } from '../src/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(here, '..', 'evals', 'results', 'runs');
const NAME = /^[A-Za-z0-9_.-]{1,200}$/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
/** What the page needs from an event (no raw tool output ever leaves the session folder). */
const slim = (e) => ({ i: e.i, t: e.t, hook: e.hook, tool: e.tool, symbol: e.symbol, evidence: e.evidence });

function sessionPayload(id) {
  const dir = sessionDir(id);
  return { id, meta: readMeta(id), events: readEvents(id).map(slim), message: readJson(path.join(dir, 'message.json')), receipt: readJson(path.join(dir, 'receipt.json')) };
}
function runPayload(name) {
  const dir = path.join(RUNS, name);
  return { id: name, meta: readJson(path.join(dir, 'meta.json')), events: readJsonl(path.join(dir, 'events.jsonl')).map(slim), message: readJson(path.join(dir, 'message.json')), receipt: readJson(path.join(dir, 'receipt.json')), grade: readJson(path.join(dir, 'grade.json')) };
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

export function createServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    try {
      if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(here, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      if (p === '/api/dfa') return send(res, 200, FOUL_DFA);
      if (p === '/api/sessions') return send(res, 200, listSessions().slice(0, 50).map((s) => { const r = readJson(path.join(sessionDir(s.id), 'receipt.json')); const m = readMeta(s.id); return { id: s.id, repo_name: m?.repo_name ?? null, started_at: m?.started_at ?? null, stamp: r?.stamp ?? null }; }));
      let m = /^\/api\/session\/([A-Za-z0-9_-]{1,128})$/.exec(p);
      if (m) return send(res, 200, sessionPayload(m[1]));
      if (p === '/api/runs') { let names = []; try { names = fs.readdirSync(RUNS).filter((n) => NAME.test(n)).sort(); } catch { /* none */ } return send(res, 200, names.map((n) => { const r = readJson(path.join(RUNS, n, 'receipt.json')); return { id: n, stamp: r?.stamp ?? null, foul: r?.foul?.state ?? null, grade: readJson(path.join(RUNS, n, 'grade.json')) }; })); }
      m = /^\/api\/run\/([A-Za-z0-9_.-]{1,200})$/.exec(p);
      if (m && !m[1].includes('..')) return send(res, 200, runPayload(m[1]));
      m = /^\/api\/stream\/([A-Za-z0-9_-]{1,128})$/.exec(p);
      if (m) {
        const id = m[1]; const file = path.join(sessionDir(id), 'events.jsonl'); const rfile = path.join(sessionDir(id), 'receipt.json');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        let sent = 0; let receiptMtime = 0;
        const tick = () => {
          const evs = readEvents(id);
          for (; sent < evs.length; sent++) res.write(`event: ev\ndata: ${JSON.stringify(slim(evs[sent]))}\n\n`);
          try { const mt = fs.statSync(rfile).mtimeMs; if (mt !== receiptMtime) { receiptMtime = mt; res.write(`event: receipt\ndata: ${JSON.stringify({ receipt: readJson(rfile), message: readJson(path.join(sessionDir(id), 'message.json')) })}\n\n`); } } catch { /* not yet */ }
        };
        tick(); const iv = setInterval(tick, 300); void file;
        req.on('close', () => clearInterval(iv));
        return undefined;
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 500, { error: String(e?.message || e).slice(0, 200) }); }
  });
}

export function serve({ port = 4320, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(port, host, () => { console.log(`receipts viewer: http://${host}:${port}`); resolve(s); });
  });
}
