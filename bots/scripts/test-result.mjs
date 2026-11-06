// test-result.mjs -- how run-tests.mjs reads one test file's ending (phase 1 item 3, 11-06). PURE.
//
// SKIP: a file that cannot run its checks where it runs -- the git-only tests (ceilescape's base traces,
// nothing-important-is-orphaned, protected-paths) on a tree shipped without .git -- exits SKIP_CODE after printing a
// line `SKIP (<why>)`. run-tests.mjs then reports it SKIPPED: neither a pass nor a failure, named in its own summary line.
// BOTH halves are required (a bare exit 77 is a failure), and a FAIL line or a timeout always wins: a skip can never hide a
// failed check.

export const SKIP_CODE = 77
const FAIL_LINE = /^  FAIL[ \t]|^FAILED/m

export function isSkip (code, out, timedOut) {
  return !timedOut && code === SKIP_CODE && /^SKIP \(/m.test(out || '') && !FAIL_LINE.test(out || '')
}

/** The git context a git-only test needs, or why it is absent. -> { ok: true, root } | { ok: false, why } */
export async function gitContext (cwd, needCommit) {
  const { execFileSync } = await import('node:child_process')
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (needCommit) execFileSync('git', ['cat-file', '-e', `${needCommit}^{commit}`], { cwd, stdio: 'ignore' })
    return { ok: true, root }
  } catch (e) {
    return { ok: false, why: needCommit ? `no git checkout with commit ${needCommit} here` : 'no git checkout here' }
  }
}
