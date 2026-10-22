// What counts as a test file, a test harness / config file, and a test command. Plain predicates, shared by the classifier
// and the receipt.

const TEST_PATH = [
  /(^|\/)(test|tests|__tests__|spec|specs)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.(py|go)$/,
  /(^|\/)[^/]*Test\.(java|kt)$/,
  /_spec\.rb$/,
];
const HARNESS_PATH = [
  /(^|\/)package\.json$/,
  /(^|\/)(jest|vitest|vite|karma|playwright|cypress|ava|babel)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.mocharc(\.[a-z]+)?$/,
  /(^|\/)(pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|conftest\.py|noxfile\.py)$/,
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/,
];

export const isHarnessPath = (p) => HARNESS_PATH.some((r) => r.test(p));
export const isTestPath = (p) => !isHarnessPath(p) && TEST_PATH.some((r) => r.test(p)) && !/(^|\/)(node_modules|\.git|fixtures?)\//.test(p);
export const isWatchedPath = (p) => isTestPath(p) || isHarnessPath(p);

/** package.json changes only matter when they touch how tests run. */
export function packageJsonTestKeys(text) {
  try {
    const j = JSON.parse(text);
    return JSON.stringify({ scripts: Object.fromEntries(Object.entries(j.scripts || {}).filter(([k]) => /test|pretest|posttest/.test(k))), jest: j.jest, mocha: j.mocha, ava: j.ava, vitest: j.vitest });
  } catch { return null; }
}

const TEST_CMD = /(^|[\s;&|(])((npm|pnpm|yarn|bun)\s+(run\s+)?test\b|npm\s+t\b|node\s+(--[\w-]+\s+)*--test\b|(npx\s+|bunx\s+)?(jest|vitest|mocha|ava|tap|playwright\s+test)\b|(python[\d.]*\s+-m\s+)?pytest\b|python[\d.]*\s+-m\s+unittest\b|go\s+test\b|cargo\s+test\b|make\s+(test|check)\b|tox\b|phpunit\b|rspec\b|deno\s+test\b)/;
export const isTestCommand = (cmd) => TEST_CMD.test(String(cmd || ''));

const ASSERT_TOKEN = /\b(assert\w*|expect\s*\(|should\b|\.to(Be|Equal|StrictEqual|Match|Throw|Have\w*|Contain\w*)\b|self\.assert\w*|t\.(is|deepEqual|true|false|equal|same)\b|require\.(Equal|True|NoError)|assert_eq!|assert!|EXPECT_\w+|ASSERT_\w+|===|!==)/;
export const isAssertionLine = (l) => ASSERT_TOKEN.test(l);

const SKIP_TOKEN = /(\b(it|test|describe|suite|context)\.(skip|only|todo)\s*\(|\bx(it|describe|test)\s*\(|\{\s*skip\s*:\s*true|@pytest\.mark\.(skip|skipif|xfail)\b|\bpytest\.(skip|xfail)\s*\(|@unittest\.(skip|expectedFailure)\w*|\bt\.Skip\w*\s*\(|#\[ignore\]|@Disabled\b|@Ignore\b|\bpending\s*\()/;
export const hasSkipMarker = (l) => SKIP_TOKEN.test(l);
