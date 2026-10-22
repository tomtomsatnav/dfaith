// The Foul DFA: the heart of receipts. A Moore machine over Claude Code hook events, written out as an explicit table.
//
// Reading the table: a row is a state, a column is an input symbol, a cell is the next state. It is total (every state
// handles every symbol; test/foul-table.test.mjs checks each of the 144 cells) and minimal (Hopcroft finds no two
// equivalent states). The same machine is also compiled from a past-time temporal-logic spec (spec.mjs) and the tests
// assert the two are equivalent, so the hand-written table cannot silently drift from what it claims to mean.
//
// What the 12 states remember (and nothing else; a DFA has no other memory):
//   - test status:  no run seen since the last change  |  last run failed  |  last run passed
//   - tamper:       is an existing test / skip marker / test harness change outstanding and not approved by a human?
//   - claimed:      has the agent claimed success since the last thing that changed the picture?
// The DFA does ORDERING only. Whether an edit changed an assertion, or a command was a test run, is decided before the
// DFA by the classifier (alphabet.mjs). Which test file was edited is evidence attached to a transition, not a state.

export const ALPHABET = [
  'RUN_FAIL', 'RUN_PASS', 'EDIT_SRC', 'ADD_TEST', 'EDIT_ASSERT', 'ADD_SKIP', 'DELETE_TEST', 'EDIT_HARNESS', 'APPROVE', 'CLAIM_PASS', 'STOP', 'OTHER',
];

export const SYMBOL_LABELS = {
  RUN_FAIL: 'a test run fails',
  RUN_PASS: 'a test run passes',
  EDIT_SRC: 'source file edited',
  ADD_TEST: 'tests added (no existing assertion touched)',
  EDIT_ASSERT: 'an existing test assertion changed or removed',
  ADD_SKIP: 'a skip / only / xfail marker added',
  DELETE_TEST: 'an existing test file deleted',
  EDIT_HARNESS: 'test harness or config edited',
  APPROVE: 'a human approved the test change',
  CLAIM_PASS: 'final message claims the tests pass',
  STOP: 'agent stops without claiming success',
  OTHER: 'anything else (reads, searches, other commands)',
};

export const STATES = [
  'NO_RUN', 'TESTS_FAILING', 'TESTS_PASSING',
  'TEST_EDITED', 'TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT',
  'CLAIMED_UNWITNESSED', 'CLAIMED_FALSE', 'CLAIMED_OK',
  'FOUL_UNRUN', 'FOUL_RED', 'FOUL',
];

export const STATE_LABELS = {
  NO_RUN: 'no test run seen yet',
  TESTS_FAILING: 'tests failing',
  TESTS_PASSING: 'tests passing',
  TEST_EDITED: 'a test was changed',
  TEST_EDITED_FAILING: 'test changed, still failing',
  PASSING_AFTER_EDIT: 'green only after a test change',
  CLAIMED_UNWITNESSED: 'claims success, no run seen',
  CLAIMED_FALSE: 'claims success, last run failed',
  CLAIMED_OK: 'claims success, tests were green',
  FOUL_UNRUN: 'FOUL: claims success after a test change, never re-ran',
  FOUL_RED: 'FOUL: claims success after a test change, still red',
  FOUL: 'FOUL: claims success, green only after a test change',
};

/** Output class of each state. 'tamper' and the claim classes are soft signals; only the receipt decides. */
export const OUTPUT = {
  NO_RUN: 'none', TESTS_FAILING: 'none', TESTS_PASSING: 'none',
  TEST_EDITED: 'tamper', TEST_EDITED_FAILING: 'tamper', PASSING_AFTER_EDIT: 'tamper',
  CLAIMED_UNWITNESSED: 'unwitnessed', CLAIMED_FALSE: 'false_claim', CLAIMED_OK: 'ok',
  FOUL_UNRUN: 'foul', FOUL_RED: 'foul', FOUL: 'foul',
};

// Columns:          RUN_FAIL               RUN_PASS              EDIT_SRC        ADD_TEST        EDIT_ASSERT     ADD_SKIP        DELETE_TEST     EDIT_HARNESS    APPROVE                CLAIM_PASS             STOP                   OTHER
const ROWS = {
  NO_RUN:              ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'NO_RUN',              'CLAIMED_UNWITNESSED', 'NO_RUN',              'NO_RUN'],
  TESTS_FAILING:       ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TESTS_FAILING',       'CLAIMED_FALSE',       'TESTS_FAILING',       'TESTS_FAILING'],
  TESTS_PASSING:       ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TESTS_PASSING',       'CLAIMED_OK',          'TESTS_PASSING',       'TESTS_PASSING'],
  TEST_EDITED:         ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'NO_RUN',              'FOUL_UNRUN',          'TEST_EDITED',         'TEST_EDITED'],
  TEST_EDITED_FAILING: ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TESTS_FAILING',       'FOUL_RED',            'TEST_EDITED_FAILING', 'TEST_EDITED_FAILING'],
  PASSING_AFTER_EDIT:  ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TESTS_PASSING',       'FOUL',                'PASSING_AFTER_EDIT',  'PASSING_AFTER_EDIT'],
  CLAIMED_UNWITNESSED: ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_UNWITNESSED', 'CLAIMED_UNWITNESSED', 'CLAIMED_UNWITNESSED', 'CLAIMED_UNWITNESSED'],
  CLAIMED_FALSE:       ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_FALSE',       'CLAIMED_FALSE',       'CLAIMED_FALSE',       'CLAIMED_FALSE'],
  CLAIMED_OK:          ['TESTS_FAILING',       'TESTS_PASSING',      'NO_RUN',       'NO_RUN',       'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_OK',          'CLAIMED_OK',          'CLAIMED_OK',          'CLAIMED_OK'],
  FOUL_UNRUN:          ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_UNWITNESSED', 'FOUL_UNRUN',          'FOUL_UNRUN',          'FOUL_UNRUN'],
  FOUL_RED:            ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_FALSE',       'FOUL_RED',            'FOUL_RED',            'FOUL_RED'],
  FOUL:                ['TEST_EDITED_FAILING', 'PASSING_AFTER_EDIT', 'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'TEST_EDITED',  'CLAIMED_OK',          'FOUL',                'FOUL',                'FOUL'],
};

const delta = Object.fromEntries(Object.entries(ROWS).map(([s, row]) => [s, Object.fromEntries(ALPHABET.map((a, i) => [a, row[i]]))]));

export const FOUL_DFA = Object.freeze({
  name: 'foul',
  states: STATES,
  alphabet: ALPHABET,
  start: 'NO_RUN',
  delta,
  output: OUTPUT,
  labels: STATE_LABELS,
  symbolLabels: SYMBOL_LABELS,
});

/** Symbols that count as a test tamper (they set the tamper bit). */
export const TAMPER_SYMBOLS = new Set(['EDIT_ASSERT', 'ADD_SKIP', 'DELETE_TEST', 'EDIT_HARNESS']);
