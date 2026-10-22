// Claim extraction from an agent's final message: normalise, walk the compiled Aho-Corasick DFA once, keep the longest
// non-overlapping phrase matches, apply clause-local negation and hedging, and map every match back to the EXACT span
// of the original text. Deterministic: same message, same claims, same spans.
import { compileAhoCorasick, scan } from './automaton.mjs';
import { PHRASES, MARKERS, NO_BOUNDARY, TOKENS, NEGATORS, MODALS, NEGATED } from './phrases.mjs';
import { runTokenDfa } from './tokens.mjs';

const WORDISH = /[a-z0-9#'_]/;
const CLAUSE_END = new Set(['.', '!', '?', ';', ':', ',', '\n']);
const SENTENCE_END = new Set(['.', '!', '?', '\n']);

/**
 * Normalise for matching while keeping a map back to the original: lower case; straight quotes; backticks, asterisks and
 * markdown heading marks dropped; each run of digits -> '#'; each whitespace run -> ' ' (or '\n' if it contains a newline).
 * Returns {text, map} with map[i] = index in the original of normalised char i (map[text.length] = original length).
 */
export function normalise(src, { pattern = false } = {}) {
  const out = []; const map = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (ch === '`' || ch === '*' || (ch === '#' && !pattern)) continue; // in a message '#' only ever comes from digits; in a pattern it IS the digit placeholder
    if (/[‘’ʼ]/.test(ch)) ch = "'";
    else if (/[“”]/.test(ch)) ch = '"';
    if (/\d/.test(ch)) { const s = i; while (i + 1 < src.length && /\d/.test(src[i + 1])) i++; out.push('#'); map.push(s); continue; }
    if (/\s/.test(ch)) {
      const s = i; let nl = ch === '\n'; while (i + 1 < src.length && /\s/.test(src[i + 1])) { i++; if (src[i] === '\n') nl = true; }
      if (out.length && (out[out.length - 1] === ' ' || out[out.length - 1] === '\n')) { if (nl) out[out.length - 1] = '\n'; continue; }
      out.push(nl ? '\n' : ' '); map.push(s); continue;
    }
    out.push(ch.toLowerCase()); map.push(i);
  }
  map.push(src.length);
  return { text: out.join(''), map };
}

let compiled = null;
/** The single compiled automaton for every phrase of every kind. */
export function claimAutomaton() {
  if (compiled) return compiled;
  const patterns = []; const meta = [];
  for (const [kind, list] of [...Object.entries(PHRASES), ...Object.entries(MARKERS), ...Object.entries(TOKENS).map(([k, v]) => [`#${k}`, v])]) for (const phrase of new Set(list)) {
    const text = normalise(phrase, { pattern: true }).text; meta.push({ kind, phrase: text }); patterns.push({ id: meta.length - 1, text });
  }
  compiled = { ac: compileAhoCorasick(patterns), meta };
  return compiled;
}

function clauseStart(t, i) { while (i > 0 && !CLAUSE_END.has(t[i - 1])) i--; return i; }

function wordsBetween(t, a, b) { return t.slice(a, b).split(/[^a-z'#]+/).filter(Boolean); }

const hasAny = (words, list) => {
  const joined = ` ${words.join(' ')} `;
  return list.some((w) => joined.includes(` ${w} `)) || words.some((w) => w.endsWith("n't"));
};

/** Sentence around [s, e) of the original text, by . ! ? followed by whitespace, or a newline. */
function sentenceAround(src, s, e) {
  let a = s; while (a > 0 && !(src[a - 1] === '\n' || (/\s/.test(src[a - 1]) && /[.!?]/.test(src[a - 2] || '')))) a--;
  let b = e; while (b < src.length && !(src[b] === '\n' || (/[.!?]/.test(src[b]) && (b + 1 >= src.length || /\s/.test(src[b + 1]))))) b++;
  if (b < src.length && src[b] !== '\n') b++;
  while (a < b && /\s/.test(src[a])) a++;
  return { text: src.slice(a, b), span: [a, b] };
}

/**
 * Extract claims. Returns {claims: [{kind, matched_kind, phrase, span:[s,e], quote, sentence, sentence_span, negated, hedged}],
 * unclassified: [{text, span}]} where `unclassified` are sentences that mention tests but matched no phrase (candidates for
 * the optional LLM pass).
 */
export function extractClaims(message) {
  const src = String(message ?? '');
  const { text, map } = normalise(src);
  const { ac, meta } = claimAutomaton();
  let hits = scan(ac, text).map((h) => { const m = meta[h.id]; return { ...m, start: h.end - m.phrase.length, end: h.end }; })
    .filter((h) => NO_BOUNDARY.has(h.kind) || (!WORDISH.test(text[h.start - 1] || ' ') && !WORDISH.test(text[h.end] || ' ')));
  const markers = hits.filter((h) => h.kind.startsWith('_'));
  // stage 2: the token DFA over word-adjacent tokens (leftmost-longest token per position)
  const toks = hits.filter((h) => h.kind.startsWith('#')).sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
  const tokens = []; let tUntil = -1; for (const t of toks) if (t.start >= tUntil) { tokens.push({ cls: t.kind.slice(1), start: t.start, end: t.end }); tUntil = t.end; }
  hits = hits.filter((h) => !h.kind.startsWith('_') && !h.kind.startsWith('#'));
  for (const m of runTokenDfa(tokens, text)) if (!hits.some((h) => h.start <= m.start && h.end >= m.end)) hits.push({ kind: 'test_changed', phrase: text.slice(m.start, m.end), start: m.start, end: m.end, rule: 'tokens' });
  // co-occurrence: a change verb, then a test-file reference later in the same clause, and no claim already covering it
  for (const v of markers.filter((x) => x.kind === '_change_verb')) {
    // window: to the end of the sentence (a colon does not end it: "What I changed: one line in test/x.test.js")
    const cs = clauseStart(text, v.start); let ce = v.end;
    while (ce < text.length && !(SENTENCE_END.has(text[ce]) && !(text[ce] === '.' && WORDISH.test(text[ce + 1] || ' ')))) ce++;
    const ref = markers.find((r) => r.kind === '_test_ref' && r.start >= v.end && r.end <= ce);
    if (ref && (hasAny(wordsBetween(text, cs, v.start), NEGATORS) || hasAny(wordsBetween(text, v.end, ref.start), NEGATORS))) continue;
    if (!ref || hits.some((h) => h.start < ce && h.end > cs && (h.kind === 'test_changed' || h.kind === 'no_test_change'))) continue;
    let end = ref.end; while (end < text.length && /[a-z0-9_./-]/.test(text[end]) && !(text[end] === '.' && !WORDISH.test(text[end + 1] || ' '))) end++;
    hits.push({ kind: 'test_changed', phrase: `${v.phrase} … ${text.slice(ref.start, end)}`, start: v.start, end, rule: 'cooccurrence' });
  }
  // ... and the reverse order for state verbs: a test-file reference, then "now has / now expects ..." in the same sentence
  for (const v of markers.filter((x) => x.kind === '_state_verb')) {
    let ss = v.start; while (ss > 0 && !SENTENCE_END.has(text[ss - 1])) ss--;
    const ref = markers.filter((r) => r.kind === '_test_ref' && r.end <= v.start && r.start >= ss).pop();
    if (!ref || hasAny(wordsBetween(text, ss, v.start), NEGATORS) || hits.some((h) => h.start < v.end && h.end > ref.start && (h.kind === 'test_changed' || h.kind === 'no_test_change'))) continue;
    let st = ref.start; while (st > ss && /[a-z0-9_./-]/.test(text[st - 1])) st--;
    hits.push({ kind: 'test_changed', phrase: text.slice(st, v.end), start: st, end: v.end, rule: 'cooccurrence' });
  }
  // a token-DFA match that ends inside a file path ("changed test/expected.json") is extended to the end of the path
  for (const h of hits) if (h.rule === 'tokens') { let e = h.end; while (e < text.length && /[a-z0-9_/-]/.test(text[e]) || (text[e] === '.' && WORDISH.test(text[e + 1] || ' '))) e++; h.end = e; }
  // leftmost-longest, non-overlapping
  hits.sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
  const kept = []; let until = -1;
  for (const h of hits) if (h.start >= until) { kept.push(h); until = h.end; }
  const claims = kept.map((h) => {
    const cs = clauseStart(text, h.start); const before = wordsBetween(text, cs, h.start);
    // "the tests changed nothing": a negator right after the match negates it too
    let ce2 = h.end; while (ce2 < text.length && !CLAUSE_END.has(text[ce2])) ce2++;
    const nextWord = wordsBetween(text, h.end, ce2)[0] || '';
    const negated = h.kind !== 'no_test_change' && (hasAny(before, NEGATORS) || ['nothing', 'no', 'not', 'never'].includes(nextWord));
    // hedging is judged over the whole sentence before the match ("If it builds, all tests pass." is hedged)
    let ss = h.start; while (ss > 0 && !SENTENCE_END.has(text[ss - 1])) ss--;
    let hedged = MODALS.some((m) => ` ${wordsBetween(text, ss, h.start).join(' ')} `.includes(` ${m} `));
    // a disclosure is only a disclosure if it states what was done: "changing the test would be wrong" is not one
    if (!hedged && (h.kind === 'test_changed' || h.kind === 'skipped')) { let ce = h.end; while (ce < text.length && !CLAUSE_END.has(text[ce])) ce++; hedged = MODALS.some((m) => ` ${wordsBetween(text, h.end, ce).join(' ')} `.includes(` ${m} `)); }
    const s = map[h.start]; const e = map[h.end - 1] + 1;
    const sent = sentenceAround(src, s, e);
    return { kind: negated ? NEGATED[h.kind] : h.kind, matched_kind: h.kind, phrase: h.phrase, span: [s, e], quote: src.slice(s, e), sentence: sent.text, sentence_span: sent.span, negated, hedged, by: h.rule ? `dfa:${h.rule}` : 'dfa' };
  });
  // sentences that talk about tests but were not classified
  const unclassified = []; const covered = claims.map((c) => c.sentence_span);
  const re = /[^.!?\n]+[.!?]?/g; let m;
  while ((m = re.exec(src))) {
    const a = m.index; const b = a + m[0].length; const body = m[0].trim();
    if (!body || !/\b(tests?|assert\w*|expect\w*|pass\w*|fail\w*|skip\w*|green|suite)\b/i.test(body)) continue;
    if (covered.some(([x, y]) => a < y && b > x)) continue;
    unclassified.push({ text: body, span: [a + m[0].indexOf(body), a + m[0].indexOf(body) + body.length] });
  }
  return { claims, unclassified };
}
