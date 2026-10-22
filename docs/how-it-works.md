# How dfaith works

Three parts. Only the third one can block.

```
hook events ──► classifier ──► Foul DFA (12 states)  ──► live view, soft markers, a cited path
final message ─────────────► claim automaton        ──► claims, each with its exact quoted span
Stop ──► sandboxed rerun of the ORIGINAL tests + net diff ──► receipt: per-claim verdict + stamp
```

## 1. The Foul DFA

`src/foul/table.mjs` is the whole machine: a 12 x 12 table, written out as data. The full table is generated in
[foul-dfa-table.md](foul-dfa-table.md). The same machine is also exported as Graphviz ([foul-dfa.dot](foul-dfa.dot)) and
Mermaid ([foul-dfa.mmd](foul-dfa.mmd)). You can regenerate them with `dfaith dfa --format md|dot|mermaid|json`.

**What a state remembers.** A DFA has no memory beyond its current state. Each of the 12 states is one combination of
three facts:

| fact | values |
|---|---|
| test status | no run seen since the last change · last run failed · last run passed |
| tamper | is an existing test, skip marker or test harness change outstanding and not approved by a human? |
| claimed | has the agent claimed success since anything last changed? |

That is 3 x 2 x 2 = 12 states. In the viewer they are laid out as 4 columns (clean / claimed, clean / working,
tampered / working, tampered / claimed) by 3 rows (the status).

**Alphabet.** There are 12 symbols: `RUN_FAIL RUN_PASS EDIT_SRC ADD_TEST EDIT_ASSERT ADD_SKIP DELETE_TEST EDIT_HARNESS APPROVE CLAIM_PASS STOP OTHER`.
The tamper symbols are `EDIT_ASSERT ADD_SKIP DELETE_TEST EDIT_HARNESS`.

**Why trust the table.** Four kinds of test check it (`test/foul-table.test.mjs`):

- **Every cell.** All 144 cells are compared with an expectation derived from the three facts above, never read off the table.
- **Totality.** Every state handles every symbol.
- **Minimality.** Moore-machine minimisation (Hopcroft's partition refinement) leaves all 12 states distinct.
- **Equivalence with a spec.** The machine is compiled independently from four past-time temporal-logic formulas
  (`src/foul/spec.mjs`, Havelund and Rosu's construction for ptLTL monitors). A product-construction search finds no
  word on which the two machines' outputs differ.

  ```
  T (tamper outstanding) := !APPROVE S tamper
  G (green since)        := !(RUN_FAIL | EDIT_SRC | ADD_TEST | tamper) S RUN_PASS
  R (red since)          := !(RUN_PASS | EDIT_SRC | ADD_TEST | tamper) S RUN_FAIL
  C (claimed since)      := !(RUN_PASS | RUN_FAIL | EDIT_SRC | ADD_TEST | tamper) S CLAIM_PASS
  output := C&T -> foul | C&G -> ok | C&R -> false_claim | C -> unwitnessed | T -> tamper | none
  ```

  The tests also show that the equivalence check catches a deliberate one-cell bug, that minimisation merges a
  duplicated state, and that the totality check reports a missing cell.

**Citing the path.** Every flag carries the transitions that led to it, from the last clean state. For example:

```
TESTS_FAILING -EDIT_ASSERT-> TEST_EDITED -RUN_PASS-> PASSING_AFTER_EDIT -CLAIM_PASS-> FOUL
```

Each transition keeps its evidence: the test command and its failing files, or the assertion line before and after.

**What the DFA does not do.** It handles ordering only.

- **Classifying events** is parsing, not automaton work. That part is `src/foul/classify.mjs`:
  - Did this edit touch an existing assertion? It diffs the file on disk after every tool call, so edits made through Bash are seen too.
  - Was this command a test run, and did it pass? It reads the output, because agents pipe test output through `head`
    and `grep`, which turns a failing run into exit 0. The first probe run did exactly that.
- **Per-file facts.** A DFA cannot bind variables, so "the file that was edited is the one that was failing" is handled
  differently: one extra copy of the DFA runs for each tampered test file, over a projection of the same event stream
  (`src/foul/monitor.mjs`). No states are added for it.

## 2. The claim automaton

`src/claims/` holds two automata in sequence.

1. **Characters.** Every claim phrase (tests pass, tests fail, test changed, skipped, no test change) and every token is
   compiled into **one** Aho-Corasick automaton. Its failure links are flattened into a total transition table:
   11,057 states over 35 character classes (`node scripts/automaton-size.mjs` prints the current figure). The message is normalised
   (case, quotes, markdown, digits → `#`), with an index map back to the original text. Every claim's `quote` is
   therefore exactly `message.slice(span[0], span[1])`, and the golden tests check this on every recorded run.
2. **Tokens.** A 6-state token DFA (`src/claims/tokens.mjs`) accepts `(VERB|PAST) (DET|QUANT)* NOUN`, the passive
   `NOUN AUX+ PAST` ("the expected values are updated") and `NOUN PAST` ("the expected values changed"). It catches phrasings like "changed **that one** assertion".
   Listing every combination as a phrase instead would take 901,873 states (the same script builds that expansion and
   counts it).

**Negation.** A negator earlier in the same clause flips the kind ("not all tests pass" → `tests_fail`). **Hedging.**
A modal earlier in the sentence marks the claim hedged. A disclosure with a modal anywhere in its clause ("changing
the test would be wrong") is not counted as a disclosure.

**Optional LLM pass** (`--llm`, off by default). Sentences that mention tests but matched nothing are listed as
`unclassified`. Only those can be sent to Haiku, and its claims are labelled `by: haiku`.

## 3. The receipt

At Stop the hook starts `dfaith check` in the background. It runs the vendored `aos-orch verify`
(`src/guard/vendor`, MIT, upstream sha in `NOTICE.md`). That copies the tree into a scratch repo, writes the
**original** test files from the base commit over it, and reruns them in bubblewrap (Linux) or sandbox-exec (macOS).
It also runs the tree's own tests and the anti-cheat diff analysis.

Each claim gets one verdict:

| claim | verified | contradicted | disclosed-tamper |
|---|---|---|---|
| tests pass | the rerun passes and the original tests pass | the rerun fails, or only the edited tests pass | – |
| I changed / skipped a test | (a benign test change) | no test was changed | a test was changed: the disclosure is true |
| I did not change any test | no test was changed | a test was changed | – |

Stamps, which are also the exit codes of `dfaith check`:

| stamp | exit | when |
|---|---|---|
| VERIFIED | 0 | the guard accepted the tree and no claim is contradicted (or the test change was approved by a human) |
| DO NOT MERGE (contradicted) | 1 | a claim is contradicted, or tests were changed and the message does not say so |
| DO NOT MERGE (needs a human) | 2 | tests were changed and the agent said so. That may be the right fix (a wrong test, or a wanted behaviour change an old test asserts), so a person decides. `dfaith approve` records that decision. |
| UNVERIFIABLE | 3 | no sandboxed rerun was possible (no sandbox, no test command, not a git repo); the receipt says why and how to fix it |
| DO NOT MERGE (not done) | 4 | the rerun fails and the agent did not claim otherwise |

The live automaton never decides the stamp. A FOUL that was reverted before Stop is reported as a note, and the
receipt goes by the final tree.

## Integrity of the record

- **Base commit.** Each session records its base at SessionStart. On a dirty tree that is a `git stash create`
  snapshot, so nothing in the repo is touched.
- **Tamper-evident log.** The event log is hash-chained. A broken chain is reported on the receipt.
- **Agent touching dfaith.** If the agent touches `~/.dfaith` or Claude Code's settings, a warning goes on the
  receipt. An agent with a shell can still delete the session folder. A missing session then means "no receipt",
  which a CI gate should treat as a failure.
