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
    if (!repo || !(await isGitRepo(repo))) return notRan(`not a git repository: ${repo}`, 'run dfaith inside a git working tree');
    if (!base) return notRan('no base commit given', 'record the HEAD sha at session start and pass it as base');
    if (!unsandboxed) {
      const sb = sandboxStatus({ sandboxBin });
      if (!sb.ok) return notRan(`OS sandbox unavailable: ${sb.reason}`, sb.hint);
    }
    const unsupported = !checks?.length ? await unsupportedRunner(repo, base) : null;
    if (unsupported) return notRan(unsupported, 'dfaith 0.1 reruns tests only for projects whose tests run with plain `node --test` and no installed dependencies (the sandboxed copy has no node_modules). Python, Go and Rust are not supported yet. The automaton and the claims still work.');
    if (!checks || !checks.length) {
      let derived;
      try { derived = await defaultChecks(repo, base, profile); } catch (e) { return notRan(`cannot derive a test command: ${String(e?.message || e).slice(0, 200)}`, CANNOT_JUDGE.bad_base); }
      if (!derived.length) return notRan('no test command derivable at the base commit (needs a package.json or node test files)', 'dfaith 0.1 supports JavaScript projects tested with `node --test`; Python, Go and Rust are not supported yet');
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

/**
 * Why the sandboxed rerun would give a WRONG answer for this repo, or null if it can run. The sandboxed copy of the tree has
 * no node_modules, so a test command that needs installed packages would fail for reasons that have nothing to do with the
 * agent's change, and a false "tests fail" is worse than "unverifiable".
 */
export async function unsupportedRunner(repo, base) {
  const { execFile } = await import('node:child_process');
  const pkgText = await new Promise((resolve) => execFile('git', ['-c', 'core.hooksPath=/dev/null', 'show', `${base}:package.json`], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, timeout: 5000 }, (e, out) => resolve(e ? null : out)));
  if (pkgText == null) return null; // no package.json: the guard derives `node --test` from the test files, or nothing
  let pkg; try { pkg = JSON.parse(pkgText); } catch { return 'package.json at the base commit is not valid JSON'; }
  const script = pkg?.scripts?.test;
  if (typeof script === 'string' && !/^\s*node\s+(--[\w=.-]+\s+)*--test(\s|$)/.test(script)) return `the test script \`${script.slice(0, 80)}\` is not plain \`node --test\` (it would need installed packages)`;
  const deps = Object.keys(pkg?.dependencies || {});
  if (deps.length) return `the package has runtime dependencies (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''}) that the sandboxed copy would not have`;
  return null;
}
