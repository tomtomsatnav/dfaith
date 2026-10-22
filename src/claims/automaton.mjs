// Aho-Corasick, compiled into ONE flat DFA: delta[state][charClass] -> state, with no failure links left at run time.
// Scanning a message is a single left-to-right table walk, one lookup per character, deterministic and linear in its length.
//
// The input alphabet is the set of characters used by the patterns plus one OTHER class for every other character, so the
// table is total by construction (every state x every class has exactly one entry; checked in test/claims.test.mjs).

export const OTHER = '\u0000other';

/** patterns: [{id, text}] (text already normalised). Returns {classes, classOf(ch), delta, out, size}. */
export function compileAhoCorasick(patterns) {
  const chars = new Set(); for (const p of patterns) for (const ch of p.text) chars.add(ch);
  const classes = [...[...chars].sort(), OTHER];
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  const classOf = (ch) => classIndex.get(ch) ?? classIndex.get(OTHER);
  // 1. trie
  const goto = [new Map()]; const out = [[]]; const depth = [0];
  for (const p of patterns) {
    let s = 0;
    for (const ch of p.text) {
      const c = classOf(ch);
      if (!goto[s].has(c)) { goto.push(new Map()); out.push([]); depth.push(depth[s] + 1); goto[s].set(c, goto.length - 1); }
      s = goto[s].get(c);
    }
    out[s].push(p.id);
  }
  // 2. failure links (BFS), then 3. flatten into a total delta table
  const n = goto.length; const fail = new Array(n).fill(0); const delta = Array.from({ length: n }, () => new Array(classes.length).fill(0));
  const order = [];
  for (let c = 0; c < classes.length; c++) { const t = goto[0].get(c); if (t !== undefined) { delta[0][c] = t; fail[t] = 0; order.push(t); } else delta[0][c] = 0; }
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    out[s] = [...new Set([...out[s], ...out[fail[s]]])];
    for (let c = 0; c < classes.length; c++) {
      const t = goto[s].get(c);
      if (t !== undefined) { fail[t] = delta[fail[s]][c]; delta[s][c] = t; order.push(t); } else delta[s][c] = delta[fail[s]][c];
    }
  }
  return { classes, classOf, delta, out, depth, size: n };
}

/** All matches: [{id, end}] where end is the exclusive end index in `text`. */
export function scan(ac, text) {
  const hits = []; let s = 0;
  for (let i = 0; i < text.length; i++) {
    s = ac.delta[s][ac.classOf(text[i])];
    for (const id of ac.out[s]) hits.push({ id, end: i + 1 });
  }
  return hits;
}
