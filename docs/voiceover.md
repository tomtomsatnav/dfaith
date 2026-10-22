# Voice-over (optional)

The demo is designed to work with the sound off, because LinkedIn and most other feeds autoplay muted. A voiced cut is
an extra. `scripts/voiceover.mjs` makes it with ElevenLabs, using any voice in your account, including your own.

## Using your own voice

1. **Clone your voice.** In ElevenLabs, go to **Voices → Add a new voice → Instant Voice Clone** and upload 1–2 minutes
   of clean speech: one speaker, little background noise, at your normal pace. Reading this README aloud works.
   - Professional Voice Cloning gives a closer match but needs about 30 minutes of audio and a paid plan.
   - ElevenLabs asks you to confirm you have the right to the voice. For your own voice, you do.
2. **Copy the voice ID** (Voices → your voice → ID) and an **API key** (Profile → API keys).
3. **Run, from the repo root:**

   ```sh
   node scripts/voiceover.mjs --dry-run            # shows each line, when it starts and how long it has
   ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node scripts/voiceover.mjs --format 45
   ```

   The result is `docs/demo-4x5-voiced.mp4`. Use `--format 169` for the 16:9 cut.

## How the timing works

Each line is spoken at the start of the caption it belongs to. The timings come from `docs/demo*.cues.json`, which
`scripts/record-demo.mjs` writes during recording. If a line is too long for its beat, the script speeds it up by at
most 12%. Beyond that it stops and tells you which line to shorten; it never lets two lines overlap. The lines are at
the top of `scripts/voiceover.mjs`.

Keep the API key out of the repo and out of chat. Set it as an environment variable or an environment secret.
