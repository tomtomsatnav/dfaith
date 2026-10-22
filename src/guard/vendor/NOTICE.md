# Vendored code: aos-orchestrator guard

The files in this directory are copied from **aos-orchestrator**
(https://github.com/tomtomsatnav/aos-orchestrator), `orchestrator/lib/`, at commit
`4ac965e6e5d82d58e915d379058744de8126f524`. They are the dependency closure of
`guard.mjs` (`verifyTree`, the engine behind `aos-orch verify`).

| File | Upstream path | Changes |
|---|---|---|
| guard.mjs | orchestrator/lib/guard.mjs | 1 line: imports `DEFAULT_RULES` from `./default-rules.mjs` instead of `./rules.mjs` (marked `// dfaith:`) |
| git.mjs | orchestrator/lib/git.mjs | none |
| checks.mjs | orchestrator/lib/checks.mjs | none |
| sandbox.mjs | orchestrator/lib/sandbox.mjs | none |
| protect.mjs | orchestrator/lib/protect.mjs | none |
| anticheat.mjs | orchestrator/lib/anticheat.mjs | none |
| harness-guard.mjs | orchestrator/lib/harness-guard.mjs | none |
| harness-preload.mjs | orchestrator/lib/harness-preload.mjs | none (read from disk by harness-guard.mjs, not imported) |
| harness-reporter.mjs | orchestrator/lib/harness-reporter.mjs | none (read from disk by harness-guard.mjs, not imported) |
| profiles.mjs | orchestrator/lib/profiles.mjs | none |
| glob.mjs | orchestrator/lib/glob.mjs | none |
| shell.mjs | orchestrator/lib/shell.mjs | none |
| default-rules.mjs | (new) | `DEFAULT_RULES.checks` copied verbatim from orchestrator/lib/rules.mjs, so the rules.mjs closure (schema, ctrl, policy, plan, state, selfcheck) is not vendored |

Every file starts with a 3-line attribution header; apart from that and the line above, the code is byte-identical to upstream.

## License

MIT License

Copyright (c) 2026 Tom Mitchell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
