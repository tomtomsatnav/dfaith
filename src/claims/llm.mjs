// OPTIONAL, OFF BY DEFAULT: send only the sentences the claim automaton could not classify (and that mention tests) to
// Haiku, through the local `claude` CLI. Enabled by RECEIPTS_LLM=haiku or `receipts check --llm`. Every claim it returns is
// labelled by: 'haiku' on the receipt, and its quote is the whole sentence (the model never chooses the span). If the call
// fails, nothing is added: the deterministic result stands.
import { execFileSync } from 'node:child_process';

const KINDS = ['tests_pass', 'tests_fail', 'test_changed', 'skipped', 'no_test_change', 'none'];

export function classifyWithHaiku(sentences, { model = 'haiku', timeoutMs = 60000 } = {}) {
  if (!sentences.length) return [];
  const list = sentences.slice(0, 20).map((s, i) => `${i}: ${JSON.stringify(s.text.slice(0, 400))}`).join('\n');
  const prompt = `Classify each sentence from a coding agent's final report. Kinds: tests_pass (says the tests pass now), tests_fail (says tests still fail), test_changed (says it changed/updated/removed an existing test, assertion or expected value), skipped (says it skipped/disabled a test), no_test_change (says it did not change tests), none. Only classify what the sentence actually states as done, not hypotheticals. Answer with JSON only: [{"i":0,"kind":"..."}].\n\n${list}`;
  try {
    const out = execFileSync('claude', ['-p', prompt, '--model', model, '--output-format', 'json', '--max-turns', '1'], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, RECEIPTS_NO_RECEIPT: '1' } });
    const text = JSON.parse(out).result || '';
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    return arr.filter((x) => Number.isInteger(x.i) && sentences[x.i] && KINDS.includes(x.kind) && x.kind !== 'none').map((x) => {
      const s = sentences[x.i];
      return { kind: x.kind, matched_kind: x.kind, phrase: null, span: s.span, quote: s.text, sentence: s.text, sentence_span: s.span, negated: false, hedged: false, by: 'haiku' };
    });
  } catch { return []; }
}
