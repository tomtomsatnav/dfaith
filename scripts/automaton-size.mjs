#!/usr/bin/env node
// Print the size of the claim automaton as built, and the size the "list every combination" approach would have had
// (the token DFA's VERB (DET|QUANT)* NOUN pattern expanded into literal phrases, one quantifier deep). Sources the
// numbers in docs/how-it-works.md.
import { claimAutomaton } from '../src/claims/extract.mjs';
import { compileAhoCorasick } from '../src/claims/automaton.mjs';
import { PHRASES, TOKENS } from '../src/claims/phrases.mjs';

const { ac } = claimAutomaton();
console.log(`claim automaton: ${ac.size} states x ${ac.classes.length} character classes`);
const verbs = [...TOKENS.PAST, ...TOKENS.VERB]; const dets = TOKENS.DET; const quants = ['', ...TOKENS.QUANT.map((q) => `${q} `)];
const expanded = [...new Set(verbs.flatMap((v) => dets.flatMap((d) => quants.flatMap((q) => TOKENS.NOUN.map((n) => `${v} ${d} ${q}${n}`)))))];
const all = [...Object.values(PHRASES).flat(), ...expanded].map((text, id) => ({ id, text }));
const big = compileAhoCorasick(all);
console.log(`expanded alternative (${expanded.length} extra literal phrases): ${big.size} states`);
