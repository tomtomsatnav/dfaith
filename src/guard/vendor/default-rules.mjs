// receipts: stand-in for orchestrator/lib/rules.mjs, which vendored guard.mjs imports only for DEFAULT_RULES.checks.
// The `checks` object is copied verbatim from https://github.com/tomtomsatnav/aos-orchestrator
// path: orchestrator/lib/rules.mjs (DEFAULT_RULES.checks) @ 4ac965e6e5d82d58e915d379058744de8126f524
// MIT License, Copyright (c) 2026 Tom Mitchell (see NOTICE.md).
export const DEFAULT_RULES = Object.freeze({
  checks: { allowlist: [], max_timeout_s: 3600, sandbox: 'required', localhost_ports: [], allow_loopback: false, protect_existing_tests: true, acceptance_first: false, acceptance_dispute: true, literal_copy: 'warn', harness_tamper: 'fail' },
});
