// Second stage of the claim automaton: a token-level DFA, VERB (DET | QUANT)* NOUN => test_changed, written as an explicit,
// total table. Its input is the sequence of word-adjacent tokens found by the character-level Aho-Corasick automaton;
// anything else between two tokens (another word, punctuation) is the symbol GAP.
export const TOKEN_DFA = Object.freeze({
  name: 'claim-tokens',
  states: ['S', 'V', 'D', 'ACCEPT'],
  alphabet: ['VERB', 'DET', 'QUANT', 'NOUN', 'GAP'],
  start: 'S',
  delta: {
    S: { VERB: 'V', DET: 'S', QUANT: 'S', NOUN: 'S', GAP: 'S' },
    V: { VERB: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', GAP: 'S' },
    D: { VERB: 'V', DET: 'D', QUANT: 'D', NOUN: 'ACCEPT', GAP: 'S' },
    ACCEPT: { VERB: 'V', DET: 'S', QUANT: 'S', NOUN: 'S', GAP: 'S' },
  },
  output: { S: 'none', V: 'none', D: 'none', ACCEPT: 'match' },
});

/**
 * tokens: [{cls, start, end}] sorted, non-overlapping (positions in the normalised text). Returns [{start, end}] matches
 * (start of the VERB, end of the NOUN). Longest NOUN wins because tokens are leftmost-longest already.
 */
export function runTokenDfa(tokens, text) {
  const out = []; let s = TOKEN_DFA.start; let vStart = -1; let prevEnd = -1;
  for (const t of tokens) {
    if (prevEnd >= 0 && text.slice(prevEnd, t.start).trim() !== '') s = TOKEN_DFA.delta[s].GAP;
    s = TOKEN_DFA.delta[s][t.cls];
    if (s === 'V' && t.cls === 'VERB') vStart = t.start;
    if (s === 'ACCEPT') out.push({ start: vStart, end: t.end });
    prevEnd = t.end;
  }
  return out;
}
