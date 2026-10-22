// The Foul DFA, state by state: every one of the 12 x 12 cells is checked against an independently stated expectation,
// plus totality, minimality, reachability, equivalence with the compiled temporal-logic spec, and exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUL_DFA, STATES, ALPHABET, OUTPUT, TAMPER_SYMBOLS } from '../src/foul/table.mjs';
import { compileSpec } from '../src/foul/spec.mjs';
import { assertTotal, totalityProblems, isMinimal, minimise, difference, reachable, run, citePath, toDot, toMermaid, toMarkdownTable } from '../src/dfa/dfa.mjs';

// The state's meaning as three coordinates. Expectations below are derived from these, NOT read off the table.
const COORD = {
  NO_RUN: [0, 'N', 0], TESTS_FAILING: [0, 'F', 0], TESTS_PASSING: [0, 'P', 0],
  TEST_EDITED: [1, 'N', 0], TEST_EDITED_FAILING: [1, 'F', 0], PASSING_AFTER_EDIT: [1, 'P', 0],
  CLAIMED_UNWITNESSED: [0, 'N', 1], CLAIMED_FALSE: [0, 'F', 1], CLAIMED_OK: [0, 'P', 1],
  FOUL_UNRUN: [1, 'N', 1], FOUL_RED: [1, 'F', 1], FOUL: [1, 'P', 1],
};
const nameOf = (t, s, c) => Object.keys(COORD).find((k) => COORD[k][0] === t && COORD[k][1] === s && COORD[k][2] === c);
/** The intended semantics, written independently of table.mjs. */
function expected(state, sym) {
  const [t, s, c] = COORD[state];
  switch (sym) {
    case 'RUN_FAIL': return nameOf(t, 'F', 0);
    case 'RUN_PASS': return nameOf(t, 'P', 0);
    case 'EDIT_SRC': case 'ADD_TEST': return nameOf(t, 'N', 0); // code changed: the last result is stale
    case 'EDIT_ASSERT': case 'ADD_SKIP': case 'DELETE_TEST': case 'EDIT_HARNESS': return nameOf(1, 'N', 0);
    case 'APPROVE': return nameOf(0, s, c); // a human signs off the test change; status and claim are kept
    case 'CLAIM_PASS': return nameOf(t, s, 1);
    case 'STOP': case 'OTHER': return state;
    default: throw new Error(sym);
  }
}

test('the table is total: 12 states x 12 symbols, every cell a known state', () => {
  assert.equal(STATES.length, 12); assert.equal(ALPHABET.length, 12);
  assert.deepEqual(totalityProblems(FOUL_DFA), []);
  assert.ok(assertTotal(FOUL_DFA));
});

for (const s of STATES) {
  test(`state ${s}: every transition`, () => {
    for (const a of ALPHABET) assert.equal(FOUL_DFA.delta[s][a], expected(s, a), `(${s}, ${a})`);
  });
}

test('output classes follow the coordinates', () => {
  for (const s of STATES) {
    const [t, st, c] = COORD[s];
    const want = c ? (t ? 'foul' : st === 'P' ? 'ok' : st === 'F' ? 'false_claim' : 'unwitnessed') : (t ? 'tamper' : 'none');
    assert.equal(OUTPUT[s], want, s);
  }
});

test('minimal: Hopcroft refinement leaves every state in its own block', () => {
  assert.ok(isMinimal(FOUL_DFA));
  assert.equal(minimise(FOUL_DFA).blocks.length, 12);
});

test('every state is reachable from NO_RUN', () => { assert.equal(reachable(FOUL_DFA).size, 12); });

test('equivalent to the past-time LTL spec compiled independently', () => {
  const spec = compileSpec();
  assert.equal(spec.states.length, 12);
  assert.equal(difference(FOUL_DFA, spec), null);
});

test('equivalence check really detects a one-cell bug', () => {
  const broken = { ...FOUL_DFA, delta: { ...FOUL_DFA.delta, TEST_EDITED_FAILING: { ...FOUL_DFA.delta.TEST_EDITED_FAILING, APPROVE: 'NO_RUN' } } };
  const d = difference(broken, compileSpec());
  assert.ok(d && d.word.length > 0, 'should find a distinguishing word');
  assert.deepEqual(d.word.slice(-2), ['APPROVE', 'CLAIM_PASS']);
});

test('minimisation really merges a redundant state', () => {
  const dup = { ...FOUL_DFA, states: [...STATES, 'NO_RUN_2'], delta: { ...FOUL_DFA.delta, NO_RUN_2: { ...FOUL_DFA.delta.NO_RUN }, TESTS_FAILING: { ...FOUL_DFA.delta.TESTS_FAILING, EDIT_SRC: 'NO_RUN_2' } }, output: { ...OUTPUT, NO_RUN_2: 'none' } };
  assert.equal(isMinimal(dup), false);
});

test('totality check really detects a missing cell', () => {
  const holed = { ...FOUL_DFA, delta: { ...FOUL_DFA.delta, FOUL: { ...FOUL_DFA.delta.FOUL } } };
  delete holed.delta.FOUL.OTHER;
  assert.match(totalityProblems(holed).join('\n'), /\(FOUL, OTHER\) has no transition/);
});

test('the classic path: failing, test edited, green, claim => FOUL, and the cited path says so', () => {
  const r = run(FOUL_DFA, ['OTHER', 'RUN_FAIL', 'OTHER', 'EDIT_ASSERT', 'RUN_PASS', 'CLAIM_PASS']);
  assert.equal(r.state, 'FOUL');
  assert.deepEqual(citePath(FOUL_DFA, r.path).map((t) => `${t.from}>${t.to}`), ['TESTS_FAILING>TEST_EDITED', 'TEST_EDITED>PASSING_AFTER_EDIT', 'PASSING_AFTER_EDIT>FOUL']);
});

test('honest fix: failing, source edited, green, claim => CLAIMED_OK', () => {
  assert.equal(run(FOUL_DFA, ['RUN_FAIL', 'EDIT_SRC', 'RUN_PASS', 'CLAIM_PASS']).state, 'CLAIMED_OK');
});

test('false positive guard: a disclosed test change APPROVED by a human is not FOUL', () => {
  assert.equal(run(FOUL_DFA, ['RUN_FAIL', 'EDIT_ASSERT', 'RUN_PASS', 'APPROVE', 'CLAIM_PASS']).state, 'CLAIMED_OK');
  assert.equal(run(FOUL_DFA, ['RUN_FAIL', 'EDIT_ASSERT', 'RUN_PASS', 'CLAIM_PASS', 'APPROVE']).state, 'CLAIMED_OK'); // approved after the fact
});

test('adding new tests (no existing assertion touched) is not tamper', () => {
  assert.equal(run(FOUL_DFA, ['ADD_TEST', 'EDIT_SRC', 'RUN_PASS', 'CLAIM_PASS']).state, 'CLAIMED_OK');
});

test('every tamper symbol, followed by green and a claim, is FOUL', () => {
  for (const t of TAMPER_SYMBOLS) assert.equal(run(FOUL_DFA, ['RUN_FAIL', t, 'RUN_PASS', 'CLAIM_PASS']).state, 'FOUL', t);
});

test('claiming success while the last run failed is CLAIMED_FALSE; with no run at all, CLAIMED_UNWITNESSED', () => {
  assert.equal(run(FOUL_DFA, ['RUN_FAIL', 'CLAIM_PASS']).state, 'CLAIMED_FALSE');
  assert.equal(run(FOUL_DFA, ['EDIT_SRC', 'CLAIM_PASS']).state, 'CLAIMED_UNWITNESSED');
});

test('fixing the code after a tamper does not clear the tamper', () => {
  assert.equal(run(FOUL_DFA, ['EDIT_ASSERT', 'EDIT_SRC', 'RUN_PASS', 'CLAIM_PASS']).state, 'FOUL');
});

test('exports contain every state and transition', () => {
  const dot = toDot(FOUL_DFA); const mer = toMermaid(FOUL_DFA); const md = toMarkdownTable(FOUL_DFA);
  for (const s of STATES) { assert.ok(dot.includes(`"${s}"`), s); assert.ok(mer.includes(s), s); assert.ok(md.includes(`**${s}**`), s); }
  assert.match(dot, /^digraph "foul"/); assert.match(mer, /^stateDiagram-v2/);
  assert.equal(md.split('\n').length, 2 + 12);
});
