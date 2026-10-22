// Ground truth for a finished session: wraps the vendored aos-orchestrator guard (vendor/guard.mjs verifyTree).
// It reruns the ORIGINAL tests of the base commit (sandboxed) against the working tree and runs the anti-cheat diff analysis.
// runGuard never throws: when it cannot judge, it returns {ran: false, reason, hint}.
import { execFile } from 'node:child_process';
import { verifyTree, defaultChecks } from './vendor/guard.mjs';
import { sandboxAvailable, DEFAULT_SANDBOX_BIN } from './vendor/sandbox.mjs';

const SANDBOX_HINT = process.platform === 'darwin'
  ? 'macOS ships /usr/bin/sandbox-exec; check that it runs (sandbox-exec -p "(version 1)(allow default)" /usr/bin/true)'
  : process.platform === 'linux'
    ? 'install bubblewrap (sudo apt install bubblewrap) and make sure unprivileged user namespaces are allowed'
    : `no supported OS sandbox on ${process.platform} (Linux bubblewrap or macOS sandbox-exec)`;

// verifyTree rejections that mean "could not judge" rather than "the work is bad"
const CANNOT_JUDGE = {
  sandbox_unavailable: SANDBOX_HINT,
  bad_base: 'pass a base that exists in the repo (a commit sha, branch or tag), e.g. the HEAD recorded at session start',
  tree_unreadable: 'the tree is too large, unreadable, or has a symlink pointing outside it',
};

const notRan = (reason, hint) => ({ ran: false, reason, hint });

const isGitRepo = (repo) => new Promise((resolve) => execFile('git', ['-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree'], { cwd: repo, timeout: 20000 }, (err, out) => resolve(!err && String(out).trim() === 'true')));

/** Is the OS sandbox usable here? -> {ok, bin, reason?, hint?} */
export function sandboxStatus({ sandboxBin } = {}) {
  const bin = sandboxBin || DEFAULT_SANDBOX_BIN;
  try {
    const r = sandboxAvailable({ bin });
    return r.ok ? { ok: true, bin } : { ok: false, bin, reason: r.reason, hint: SANDBOX_HINT };
  } catch (e) {
    return { ok: false, bin, reason: String(e?.message || e), hint: SANDBOX_HINT };
  }
}

/**
 * Judge the working tree of `repo` against `base`. `sandboxBin` (optional) overrides the sandbox binary.
 * -> {ran: true, accepted, integrity, rejections, failing_tests, protected, checks, files, warnings, sandboxed, duration_ms} | {ran: false, reason, hint}
 */
export async function runGuard({ repo, base, checks = null, profile = 'node-library', unsandboxed = false, timeoutMs = 300000, sandboxBin } = {}) {
  const t0 = Date.now();
  try {
    if (!repo || !(await isGitRepo(repo))) return notRan(`not a git repository: ${repo}`, 'run receipts inside a git working tree');
    if (!base) return notRan('no base commit given', 'record the HEAD sha at session start and pass it as base');
    if (!unsandboxed) {
      const sb = sandboxStatus({ sandboxBin });
      if (!sb.ok) return notRan(`OS sandbox unavailable: ${sb.reason}`, sb.hint);
    }
    if (!checks || !checks.length) {
      let derived;
      try { derived = await defaultChecks(repo, base, profile); } catch (e) { return notRan(`cannot derive a test command: ${String(e?.message || e).slice(0, 200)}`, CANNOT_JUDGE.bad_base); }
      if (!derived.length) return notRan('no test command derivable at the base commit (needs a package.json or node test files; other languages are not supported)', 'pass checks: [{argv: [...], timeout_s}] explicitly');
      checks = derived;
    }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); timer.unref?.(); });
    const r = await Promise.race([verifyTree({ repo, base, tree: null, checks, profile, unsandboxed, ...(sandboxBin ? { sandboxBin } : {}) }), timeout]).finally(() => clearTimeout(timer));
    if (!r) return notRan(`guard timed out after ${timeoutMs} ms`, 'raise timeoutMs, or pass a narrower test command in checks');
    const stop = r.rejections.find((x) => x.kind in CANNOT_JUDGE);
    if (stop) return notRan(`${stop.kind}: ${stop.detail}`, CANNOT_JUDGE[stop.kind]);
    const p = r.protected;
    return {
      ran: true,
      accepted: r.accepted,
      integrity: r.integrity,
      rejections: r.rejections,
      failing_tests: r.failing_tests,
      protected: p ? { ok: p.ok, tests: p.tests ?? null, pass: p.pass ?? null, failing: p.failing ?? null, files: p.files } : null,
      checks: r.checks.map((c) => ({ argv: c.argv, ok: c.ok, tests: c.tests ?? null, pass: c.pass ?? null, baseline: c.baseline ?? null })),
      files: r.files.map((f) => ({ path: f.path, status: f.status })),
      warnings: r.anticheat.warnings,
      sandboxed: r.sandboxed,
      duration_ms: Date.now() - t0,
    };
  } catch (e) {
    return notRan(`guard error: ${String(e?.message || e).slice(0, 300)}`, 'this is a bug or an environment problem (git/tar missing?); the session was not judged');
  }
}
