# Voice-over script: a demo walkthrough

This script fits the current video as it stands (`docs/demo-4x5.mp4` and `docs/demo.mp4` share the same timing, 32.5 s).

The voice says *where to look and why it matters*; the on-screen captions already say *what* happened. Speak it like
you're showing a colleague your screen.

Each line fits its beat at about 2.6 words per second, which is your clone's measured pace. Start every line about
0.1 s after its beat begins.

| # | at | beat | on screen | say | words |
|---|---|---|---|---|---|
| 0 | 0.1 s | 3.5 s | Cold open: the stamped receipt, FOUL in red | **This is dfaith, catching a real Claude run.** | 8 |
| 1 | 3.6 s | 4.0 s | The automaton resets; the task caption | **On the left, a state machine watches the agent.** | 9 |
| 2 | 7.6 s | 2.7 s | "tests failing" lights up | **It runs the tests. They fail.** | 6 |
| 3 | 10.3 s | 3.7 s | Red marker, "a test was changed" | **Now watch. It edits the test instead.** | 7 |
| 4 | 14.0 s | 2.7 s | "green after test change" | **Green. Only because the test changed.** | 6 |
| 5 | 16.7 s | 3.9 s | The final message types out, claims highlighted | **Its report: all tests pass. Highlighted, word for word.** | 9 |
| 6 | 20.6 s | 3.6 s | FOUL; the receipt fills in | **So dfaith reruns the original tests. They fail.** | 8 |
| 7 | 24.2 s | 4.0 s | DO NOT MERGE stamp | **Verdict: do not merge. A human checks the edit.** | 9 |
| 8 | 28.2 s | 2.3 s | Grid of all ten runs | **Ten real runs. Ten stamps.** | 5 |
| 9 | 30.5 s | 1.8 s | Install line | **One line to install.** | 4 |

**Read straight through** (for a single take):

> This is dfaith, catching a real Claude run. … On the left, a state machine watches the agent. … It runs the tests.
> They fail. … Now watch. It edits the test instead. … Green. Only because the test changed. … Its report: all tests
> pass. Highlighted, word for word. … So dfaith reruns the original tests. They fail. … Verdict: do not merge. A
> human checks the edit. … Ten real runs. Ten stamps. … One line to install.

## Delivery

- **Tone.** Calm and conversational: a walkthrough, not an ad. Keep the energy flat until line 3.
- **Pauses.** Leave a small beat after "Now watch." The edit appears on screen right then.
- **Stress.**
  - Line 3: *test* (as opposed to the code).
  - Line 4: *only*.
  - Line 6: *original*.
  - Line 7: *human*.
- **Line 5.** Say "all tests pass" as a quote, slightly flatter, as if reading it off the screen.
- **Pronunciation.** Say "dfaith" as **dee-faith**. In ElevenLabs, type it as `Dee-faith`, or the engine may say
  "duh-faith".

## Recording it in ElevenLabs

**Line by line (most control).** Generate each line separately with your voice. Save each clip as `cap0.mp3` …
`cap7.mp3`, `grid.mp3` and `install.mp3` (rows 0–9 above, in that order) in one folder. Then run, from the repo root:

```sh
node scripts/voiceover.mjs --clips <that folder> --format 45     # -> docs/demo-4x5-voiced.mp4
node scripts/voiceover.mjs --clips <that folder> --format 169    # -> docs/demo-voiced.mp4
```

The script trims nothing and places each clip at its beat. If a clip is longer than its beat, it speeds the clip up
by at most 12%; beyond that it stops and tells you which line to shorten.

**One take.** Record the read-through above in one go, then line it up in any editor against the timings in the
table.

- **Mid-sentence restarts.** With Eleven v4 you can add `[pause]` between sentences instead of "…" if it rushes.
- **The money moment.** Lines 6 and 7 carry the payoff. If you only re-take two lines, re-take those.

The captions are burned into the video, so it works muted too. The voice is a layer on top.
