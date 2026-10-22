// The Foul DFA's meaning, written as past-time temporal logic (ptLTL) and compiled to a DFA.
// The tests assert that this compiled machine and the hand-written table (table.mjs) are equivalent Moore machines,
// so every cell of the table is justified by the four formulas below rather than by trust.
//
//   tamper    := EDIT_ASSERT | ADD_SKIP | DELETE_TEST | EDIT_HARNESS
//   T  (tamper outstanding)  := !APPROVE S tamper
//   G  (green since)         := !(RUN_FAIL | EDIT_SRC | ADD_TEST | tamper) S RUN_PASS
//   R  (red since)           := !(RUN_PASS | EDIT_SRC | ADD_TEST | tamper) S RUN_FAIL
//   C  (claimed since)       := !(RUN_PASS | RUN_FAIL | EDIT_SRC | ADD_TEST | tamper) S CLAIM_PASS
//
//   output := C & T -> foul | C & G -> ok | C & R -> false_claim | C -> unwitnessed | T -> tamper | none
//
// ptLTL "p S q" (p since q) holds now iff q holds now, or p holds now and p S q held one step ago. On the empty trace every
// S-formula is false. A monitor for ptLTL needs only the current truth value of each S-formula, so its state space is the
// reachable set of 4-bit vectors; that set is explored here and becomes the compiled DFA (Havelund & Rosu's construction).
import { ALPHABET, TAMPER_SYMBOLS } from './table.mjs';

const is = (...names) => (a) => names.includes(a);
const isTamper = (a) => TAMPER_SYMBOLS.has(a);
const or = (...fs) => (a) => fs.some((f) => f(a));
const not = (f) => (a) => !f(a);

/** Each formula is p S q with p, q predicates over the current symbol. Order fixes the bit vector layout. */
export const FORMULAS = [
  { name: 'T', p: not(is('APPROVE')), q: isTamper },
  { name: 'G', p: not(or(is('RUN_FAIL', 'EDIT_SRC', 'ADD_TEST'), isTamper)), q: is('RUN_PASS') },
  { name: 'R', p: not(or(is('RUN_PASS', 'EDIT_SRC', 'ADD_TEST'), isTamper)), q: is('RUN_FAIL') },
  { name: 'C', p: not(or(is('RUN_PASS', 'RUN_FAIL', 'EDIT_SRC', 'ADD_TEST'), isTamper)), q: is('CLAIM_PASS') },
];

export const outputOf = ({ T, G, R, C }) => (C && T ? 'foul' : C && G ? 'ok' : C && R ? 'false_claim' : C ? 'unwitnessed' : T ? 'tamper' : 'none');

const keyOf = (v) => FORMULAS.map((f) => (v[f.name] ? 1 : 0)).join('');

/** Compile the spec to a Moore machine whose states are named by their bit vectors (e.g. "1010" = T and R hold). */
export function compileSpec() {
  const start = Object.fromEntries(FORMULAS.map((f) => [f.name, false]));
  const states = []; const delta = {}; const output = {}; const vec = {};
  const q = [start]; const seen = new Set([keyOf(start)]);
  while (q.length) {
    const v = q.shift(); const k = keyOf(v);
    states.push(k); vec[k] = v; output[k] = outputOf(v); delta[k] = {};
    for (const a of ALPHABET) {
      const n = Object.fromEntries(FORMULAS.map((f) => [f.name, f.q(a) || (f.p(a) && v[f.name])]));
      const nk = keyOf(n); delta[k][a] = nk;
      if (!seen.has(nk)) { seen.add(nk); q.push(n); }
    }
  }
  return { name: 'foul-spec', states, alphabet: ALPHABET, start: keyOf(start), delta, output, vectors: vec };
}
