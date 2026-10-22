// Second stage of the claim automaton: a token-level DFA over the word-adjacent tokens found by the character-level
// Aho-Corasick automaton, written as an explicit, total table. It accepts
//   active:      (VERB | PAST) (DET | QUANT)* NOUN   "changed that one assertion", "updating the expected values"
//   passive:     NOUN AUX+ PAST                      "the expected values are updated", "the test was rewritten"
//   intransitive:  NOUN PAST                           "the expected values changed to match"
// PAST = past forms (changed, updated, ...); VERB = base and -ing forms, which only start the active form.
// GAP is anything else between two tokens (another word, punctuation): it resets the machine.
export const TOKEN_DFA = Object.freeze({
  name: 'claim-tokens',
  states: ['S', 'V', 'D', 'N', 'A', 'ACCEPT'],
  alphabet: ['VERB', 'PAST', 'DET', 'QUANT', 'NOUN', 'AUX', 'GAP'],
  start: 'S',
  delta: {
    S: { VERB: 'V', PAST: 'V', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'S', GAP: 'S' },
    V: { VERB: 'V', PAST: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', AUX: 'S', GAP: 'S' },
    D: { VERB: 'V', PAST: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', AUX: 'S', GAP: 'S' },
    N: { VERB: 'V', PAST: 'ACCEPT', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'A', GAP: 'S' },
    A: { VERB: 'S', PAST: 'ACCEPT', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'A', GAP: 'S' },
    ACCEPT: { VERB: 'V', PAST: 'V', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'S', GAP: 'S' },
  },
  output: { S: 'none', V: 'none', D: 'none', N: 'none', A: 'none', ACCEPT: 'match' },
});

/** tokens: [{cls, start, end}] sorted and non-overlapping. Returns [{start, end, form: 'active'|'passive'}]. */
export function runTokenDfa(tokens, text) {
  const out = []; let s = TOKEN_DFA.start; let vStart = -1; let nStart = -1; let prevEnd = -1;
  for (const t of tokens) {
    if (prevEnd >= 0 && text.slice(prevEnd, t.start).trim() !== '') s = TOKEN_DFA.delta[s].GAP;
    const from = s; s = TOKEN_DFA.delta[s][t.cls];
    if (s === 'V' && (t.cls === 'VERB' || t.cls === 'PAST')) vStart = t.start;
    if (s === 'N' && from !== 'N') nStart = t.start;
    if (s === 'ACCEPT') out.push(from === 'A' || from === 'N' ? { start: nStart, end: t.end, form: 'passive' } : { start: vStart, end: t.end, form: 'active' });
    prevEnd = t.end;
  }
  return out;
}
