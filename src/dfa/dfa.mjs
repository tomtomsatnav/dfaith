// A deterministic finite automaton with output (a Moore machine): the transition table is plain data, never if-chains.
//   dfa = { name, states: [id...], alphabet: [symbol...], start: id, delta: { [state]: { [symbol]: state } },
//           output: { [state]: outputClass }, labels?: { [state]: 'plain English' }, symbolLabels?: { [symbol]: '...' } }
// Every verdict a DFA produces carries the full path of transitions that led to it, so a flag can always be explained.

/** Throws unless the table is well formed and TOTAL: every state has exactly one transition for every symbol, to a known state. */
export function assertTotal(dfa) {
  const problems = totalityProblems(dfa);
  if (problems.length) throw new Error(`${dfa.name}: not a total DFA:\n  ${problems.slice(0, 20).join('\n  ')}`);
  return true;
}

export function totalityProblems(dfa) {
  const out = [];
  const S = new Set(dfa.states);
  if (S.size !== dfa.states.length) out.push('duplicate state ids');
  if (new Set(dfa.alphabet).size !== dfa.alphabet.length) out.push('duplicate symbols');
  if (!S.has(dfa.start)) out.push(`start state ${dfa.start} is not a state`);
  for (const s of dfa.states) {
    const row = dfa.delta[s];
    if (!row) { out.push(`state ${s} has no row`); continue; }
    for (const a of dfa.alphabet) {
      if (!(a in row)) out.push(`(${s}, ${a}) has no transition`);
      else if (!S.has(row[a])) out.push(`(${s}, ${a}) -> ${row[a]} is not a state`);
    }
    for (const a of Object.keys(row)) if (!dfa.alphabet.includes(a)) out.push(`(${s}, ${a}) uses a symbol outside the alphabet`);
    if (!(s in (dfa.output || {}))) out.push(`state ${s} has no output class`);
  }
  for (const s of Object.keys(dfa.delta)) if (!S.has(s)) out.push(`row for unknown state ${s}`);
  return out;
}

export const step = (dfa, state, symbol) => {
  const next = dfa.delta[state]?.[symbol];
  if (next === undefined) throw new Error(`${dfa.name}: no transition from ${state} on ${symbol}`);
  return next;
};

/**
 * A stepping run that records every transition. `events` are {symbol, evidence?}.
 * Returns {state, output, path: [{i, from, symbol, to, output, evidence}]}.
 */
export function createRun(dfa, start = dfa.start) {
  const path = [];
  let state = start;
  return {
    get state() { return state; },
    get output() { return dfa.output[state]; },
    path,
    feed(symbol, evidence = null) {
      const from = state; state = step(dfa, state, symbol);
      const t = { i: path.length, from, symbol, to: state, output: dfa.output[state], evidence };
      path.push(t);
      return t;
    },
  };
}

export function run(dfa, events) {
  const r = createRun(dfa);
  for (const e of events) typeof e === 'string' ? r.feed(e) : r.feed(e.symbol, e.evidence ?? null);
  return { state: r.state, output: r.output, path: r.path };
}

/**
 * The shortest suffix of a path that explains how the current state was reached from a state with a "neutral" output.
 * Used to cite "the exact transition path that produced the flag": everything after the last neutral state.
 */
export function citePath(dfa, path, neutral = (o) => o === 'none') {
  let k = path.length - 1;
  while (k >= 0 && !neutral(dfa.output[path[k].from])) k--;
  return path.slice(Math.max(k, 0)).filter((t) => t.from !== t.to);
}

/** States reachable from start. */
export function reachable(dfa) {
  const seen = new Set([dfa.start]); const q = [dfa.start];
  while (q.length) { const s = q.shift(); for (const a of dfa.alphabet) { const t = dfa.delta[s][a]; if (!seen.has(t)) { seen.add(t); q.push(t); } } }
  return seen;
}

/**
 * Moore-machine minimisation (Hopcroft's partition refinement, initial partition = output classes).
 * Returns {blocks: [[state...]...], blockOf: {state: index}}. A table is minimal iff every reachable state is alone in its block.
 */
export function minimise(dfa) {
  const states = [...reachable(dfa)];
  const byOut = new Map();
  for (const s of states) { const o = dfa.output[s]; if (!byOut.has(o)) byOut.set(o, []); byOut.get(o).push(s); }
  let P = [...byOut.values()].map((b) => new Set(b));
  const W = P.map((b) => new Set(b));
  const inv = {}; // inv[a][t] = states s with delta(s,a)=t
  for (const a of dfa.alphabet) { inv[a] = {}; for (const s of states) (inv[a][dfa.delta[s][a]] ||= []).push(s); }
  while (W.length) {
    const A = W.pop();
    for (const a of dfa.alphabet) {
      const X = new Set(); for (const t of A) for (const s of inv[a][t] || []) X.add(s);
      if (!X.size) continue;
      const next = [];
      for (const Y of P) {
        const i = [...Y].filter((s) => X.has(s)); const d = [...Y].filter((s) => !X.has(s));
        if (i.length && d.length) {
          const I = new Set(i); const D = new Set(d); next.push(I, D);
          const wi = W.findIndex((w) => w.size === Y.size && [...Y].every((s) => w.has(s)));
          if (wi >= 0) W.splice(wi, 1, I, D); else W.push(I.size <= D.size ? I : D);
        } else next.push(Y);
      }
      P = next;
    }
  }
  const blocks = P.map((b) => [...b].sort((x, y) => states.indexOf(x) - states.indexOf(y)));
  const blockOf = {}; blocks.forEach((b, i) => b.forEach((s) => { blockOf[s] = i; }));
  return { blocks, blockOf };
}

export const isMinimal = (dfa) => { const { blocks } = minimise(dfa); return blocks.every((b) => b.length === 1) && blocks.length === dfa.states.length; };

/**
 * Equivalence of two Moore machines over the same alphabet (product BFS from the start pair; outputs must agree everywhere).
 * Returns null if equivalent, else a shortest distinguishing word {word, a, b}.
 */
export function difference(m1, m2) {
  if (m1.alphabet.length !== m2.alphabet.length || m1.alphabet.some((a) => !m2.alphabet.includes(a))) return { word: null, reason: 'different alphabets' };
  const key = (p, q) => `${p}\u0000${q}`;
  const seen = new Map([[key(m1.start, m2.start), []]]); const q = [[m1.start, m2.start]];
  while (q.length) {
    const [p, r] = q.shift(); const w = seen.get(key(p, r));
    if (m1.output[p] !== m2.output[r]) return { word: w, a: { state: p, output: m1.output[p] }, b: { state: r, output: m2.output[r] } };
    for (const a of m1.alphabet) {
      const np = m1.delta[p][a]; const nr = m2.delta[r][a]; const k = key(np, nr);
      if (!seen.has(k)) { seen.set(k, [...w, a]); q.push([np, nr]); }
    }
  }
  return null;
}

/** Group a state's transitions by target, so exports stay readable: {to: [symbols]}. */
function grouped(dfa, s) {
  const g = new Map();
  for (const a of dfa.alphabet) { const t = dfa.delta[s][a]; if (!g.has(t)) g.set(t, []); g.get(t).push(a); }
  return g;
}

const dotEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Graphviz DOT. Self-loops are drawn too, so the picture is the whole (total) table. */
export function toDot(dfa, { colors = {} } = {}) {
  const L = [`digraph "${dotEsc(dfa.name)}" {`, '  rankdir=LR; node [shape=box, style="rounded,filled", fontname="Helvetica", fillcolor="#ffffff"];', '  __start [shape=point];', `  __start -> "${dotEsc(dfa.start)}";`];
  for (const s of dfa.states) {
    const label = dfa.labels?.[s] ? `${s}\\n${dotEsc(dfa.labels[s])}` : s;
    const fill = colors[dfa.output[s]];
    L.push(`  "${dotEsc(s)}" [label="${label}"${fill ? `, fillcolor="${fill}"` : ''}${dfa.output[s] === 'foul' ? ', peripheries=2' : ''}];`);
  }
  for (const s of dfa.states) for (const [t, syms] of grouped(dfa, s)) L.push(`  "${dotEsc(s)}" -> "${dotEsc(t)}" [label="${dotEsc(syms.join(', '))}"];`);
  L.push('}');
  return L.join('\n');
}

/** Mermaid stateDiagram-v2. */
export function toMermaid(dfa) {
  const id = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const L = ['stateDiagram-v2', `  [*] --> ${id(dfa.start)}`];
  for (const s of dfa.states) if (dfa.labels?.[s]) L.push(`  ${id(s)} : ${s} — ${dfa.labels[s].replace(/:/g, ' ')}`);
  for (const s of dfa.states) for (const [t, syms] of grouped(dfa, s)) L.push(`  ${id(s)} --> ${id(t)} : ${syms.join(', ')}`);
  for (const s of dfa.states) if (dfa.output[s] === 'foul') L.push(`  classDef foul fill:#d7263d,color:#fff`, `  class ${id(s)} foul`);
  return [...new Set(L)].join('\n');
}

/** A markdown table of the whole transition function (rows = states, columns = symbols). */
export function toMarkdownTable(dfa) {
  const head = `| state (output) | ${dfa.alphabet.join(' | ')} |`;
  const sep = `|---|${dfa.alphabet.map(() => '---').join('|')}|`;
  const rows = dfa.states.map((s) => `| **${s}** (${dfa.output[s]}) | ${dfa.alphabet.map((a) => dfa.delta[s][a]).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}
