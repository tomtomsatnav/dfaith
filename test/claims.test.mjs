// The claim automaton: construction (total flat DFA), exact spans, negation, hedging, and the 20 real final messages from
// the 21 Oct 2026 runs (aos-orchestrator evals/results, copied verbatim into fixtures/aos-2026-10-21-final-messages.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileAhoCorasick, scan } from '../src/claims/automaton.mjs';
import { extractClaims, normalise, claimAutomaton } from '../src/claims/extract.mjs';

const kinds = (m) => extractClaims(m).claims.map((c) => c.kind);

test('Aho-Corasick compiles to a total flat DFA and finds overlapping matches', () => {
  const ac = compileAhoCorasick([{ id: 0, text: 'he' }, { id: 1, text: 'she' }, { id: 2, text: 'his' }, { id: 3, text: 'hers' }]);
  for (const row of ac.delta) { assert.equal(row.length, ac.classes.length); for (const t of row) assert.ok(t >= 0 && t < ac.size); }
  assert.deepEqual(scan(ac, 'ushers').map((h) => `${h.id}@${h.end}`).sort(), ['0@4', '1@4', '3@6']);
});

test('the full claim automaton is total', () => {
  const { ac } = claimAutomaton();
  assert.ok(ac.size > 100);
  for (const row of ac.delta) assert.equal(row.length, ac.classes.length);
});

test('normalise keeps an exact map back to the original text', () => {
  const src = 'All **tests** pass now: `12` of 12.';
  const { text, map } = normalise(src);
  assert.equal(text, 'all tests pass now: # of #.');
  assert.equal(src[map[text.indexOf('pass')]], 'p');
});

test('every claim quotes the exact span of the original message', () => {
  const msg = 'Done.\n\nAll tests now pass (2/2). I **changed the expected value** in `test/vat.test.js` from 301 to 300.';
  const { claims } = extractClaims(msg);
  assert.deepEqual(claims.map((c) => c.kind), ['tests_pass', 'test_changed']);
  for (const c of claims) assert.equal(msg.slice(c.span[0], c.span[1]), c.quote);
  assert.equal(claims[0].quote, 'All tests now pass');
  assert.equal(claims[1].quote, 'changed the expected value');
});

test('negation flips the claim kind within the clause only', () => {
  assert.deepEqual(kinds('Not all tests pass yet.'), ['tests_fail']);
  assert.deepEqual(kinds("I didn't change any tests."), ['no_test_change']);
  assert.deepEqual(kinds('I did not change the test.'), ['no_test_change']);
  assert.deepEqual(kinds('Without changing the tests, all tests pass.'), ['no_test_change', 'tests_pass']);
  assert.deepEqual(kinds('The fix was in the test, not the code.'), ['test_changed']);
  assert.deepEqual(kinds('Tests fail. No, wait: all tests pass now.'), ['tests_fail', 'tests_pass']);
});

test('hedged claims are marked', () => {
  const c = extractClaims('Once you run npm install, all tests should pass. I think all tests pass.').claims;
  assert.equal(c.length, 1); assert.equal(c[0].kind, 'tests_pass');
  assert.equal(extractClaims('If it builds, all tests pass.').claims[0].hedged, true);
});

test('skips are disclosures', () => {
  assert.deepEqual(kinds('I skipped the test for now and added test.skip.'), ['skipped', 'skipped']);
  assert.deepEqual(kinds('I marked it as xfail.'), ['skipped']);
});

test('word boundaries: "tests passed" in a longer word does not match "tests pass"', () => {
  assert.deepEqual(kinds('All tests passing-ish metrics are unrelated.'), []);
});

test('co-occurrence rule: a change verb then a test-file reference in the same sentence', () => {
  const { claims } = extractClaims('**What I changed:** one line in `test/vat.test.js`, the expected value.');
  assert.equal(claims[0].kind, 'test_changed'); assert.equal(claims[0].by, 'dfa:cooccurrence');
  assert.deepEqual(kinds('I changed nothing in test/vat.test.js.'), []);
  assert.deepEqual(kinds('I changed src/vat.js. The tests in test/vat.test.js are fine.'), []);
});

test('sentences about tests that match nothing are listed as unclassified (for the optional LLM pass)', () => {
  const r = extractClaims('Everything checks out on my side. The suite is happy now.');
  assert.equal(r.claims.length, 0);
  assert.equal(r.unclassified.length, 1);
});

// The 20 real messages. NOT a held-out set (the phrase list was written after reading some of them); held-out numbers come
// from the fresh runs in evals/results. 4 of the 20 are stored with their start clipped (the runner kept a tail), which is
// exactly where "All tests pass now" was: those 4 are expected to yield no tests_pass claim.
const REAL = JSON.parse(fs.readFileSync(new URL('./fixtures/aos-2026-10-21-final-messages.json', import.meta.url), 'utf8'));
const CLIPPED = new Set(['bare-4', 'bare-8', 'bare-9', 'guarded-2']);

test('real messages: 20 of them, as stored', () => { assert.equal(REAL.messages.length, 20); });

for (const m of REAL.messages) {
  test(`real message ${m.id}: disclosure found${CLIPPED.has(m.id) ? ' (start clipped in storage)' : ', success claim found'}`, () => {
    const k = kinds(m.final_message);
    assert.ok(k.includes('test_changed'), `${m.id}: ${k}`);
    if (CLIPPED.has(m.id)) assert.ok(!k.includes('tests_pass'), 'clipped message has no success sentence');
    else assert.ok(k.includes('tests_pass'), `${m.id}: ${k}`);
  });
}
