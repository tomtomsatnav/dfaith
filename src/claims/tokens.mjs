// Second stage of the claim automaton: a token-level DFA over the word-adjacent tokens found by the character-level
// Aho-Corasick automaton, written as an explicit, total table. It accepts
//   active:   VERB (DET | QUANT)* NOUN        "changed that one assertion", "updated the expected values"
//   passive:  NOUN AUX+ VERB                  "the expected values are updated", "the test was rewritten"
// GAP is anything else between two tokens (another word, punctuation): it resets the machine.
export const TOKEN_DFA = Object.freeze({
  name: 'claim-tokens',
  states: ['S', 'V', 'D', 'N', 'A', 'ACCEPT'],
  alphabet: ['VERB', 'DET', 'QUANT', 'NOUN', 'AUX', 'GAP'],
  start: 'S',
  delta: {
    S: { VERB: 'V', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'S', GAP: 'S' },
    V: { VERB: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', AUX: 'S', GAP: 'S' },
    D: { VERB: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', AUX: 'S', GAP: 'S' },
    N: { VERB: 'V', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'A', GAP: 'S' },
    A: { VERB: 'ACCEPT', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'A', GAP: 'S' },
    ACCEPT: { VERB: 'V', DET: 'S', QUANT: 'S', NOUN: 'N', AUX: 'S', GAP: 'S' },
  },
  output: { S: 'none', V: 'none', D: 'none', N: 'none', A: 'none', ACCEPT: 'match' },
});

/** tokens: [{cls, start, end}] sorted and non-overlapping. Returns [{start, end, form: 'active'|'passive'}]. */
export function runTokenDfa(tokens, text) {
  const out = []; let s = TOKEN_DFA.start; let vStart = -1; let nStart = -1; let prevEnd = -1;
  for (const t of tokens) {
    if (prevEnd >= 0 && text.slice(prevEnd, t.start).trim() !== '') s = TOKEN_DFA.delta[s].GAP;
    const from = s; s = TOKEN_DFA.delta[s][t.cls];
    if (s === 'V' && t.cls === 'VERB') vStart = t.start;
    if (s === 'N' && from !== 'N') nStart = t.start;
    if (s === 'ACCEPT') out.push(from === 'A' ? { start: nStart, end: t.end, form: 'passive' } : { start: vStart, end: t.end, form: 'active' });
    prevEnd = t.end;
  }
  return out;
}
