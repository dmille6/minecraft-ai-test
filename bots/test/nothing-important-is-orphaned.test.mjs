// WORK KEPT LANDING ON BRANCHES THAT MAIN NEVER SAW, AND MAIN IS THE BRANCH THAT TRACKS THE FLEET.
//
// Three instances in one day, all with the same shape:
//   * STATE.md -- the file the memory index says to read FIRST -- did not exist at the sha the fleet
//     runs. An external reviewer read the repo at that sha and was blind to a full day of
//     measurements. It looked like the reviewer's failure; it was ours.
//   * sandbox/run-corpus.sh and the whole episode-replay harness lived only on `scene-harness`.
//     Both review engines cited it the same day as the gate that proves a candidate before a canary.
//     main had ZERO sandbox files.
//   * scripts/ops/arbiterpreflight.py -- a checker that detects the exact ARBITER=1 startup crash
//     found today -- lived only on `veto-feedback`, and nothing called it. Second instance of that
//     class after licencecheck.py promised a launch refusal the canary loop never invoked.
//
// And 42 files were sitting UNTRACKED in the working checkout, one `git clean` from gone.
//
// This is the mechanism, and it lives in bots/test/ on purpose: the test suite is the one thing that
// always runs. A check in scripts/ that nobody wires is the defect it is trying to prevent.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })

// THE MANIFEST. Every path here is load-bearing for operating or measuring the fleet, and every one
// of them has either gone missing from main or been cited by a review as missing. Adding to this
// list is how you stop the next thing being orphaned; it is deliberately explicit rather than a
// pattern, so a rename is a decision and not an accident.
const REQUIRED = [
  // monument-01 (10-29): the ziggurat's site, offline, by the bots' own functions (the fleet canary's per-world siting), and the
  // shop read that judges every project's record (the showcase tripwire's S6)
  'bots/scripts/zigsite-offline.mjs',
  // paths-01 (10-30): the town's paths sited and laid offline on a copy of the world, by the bots' own functions
  'bots/src/paths.mjs',
  'bots/scripts/pathsite-offline.mjs',
  'bots/scripts/pathsbuild-offline.mjs',
  // pathsclose-01 (10-30): the overburden on a path cell dug; a cell the visit may never lay deferred, then waived
  'bots/test/pathsclose.test.mjs',
  // wall-01 (10-30): the town wall sited, built and walk-proven offline on a copy of the world, by the bots' own functions
  'bots/src/wall.mjs',
  'bots/scripts/wall-offline.mjs',
  'bots/src/treefarm.mjs',
  'bots/scripts/treefarm-offline.mjs',
  'bots/test/treefarm.test.mjs',
  'bots/src/expedition.mjs',
  'bots/test/expedition.test.mjs',
  // voidfill-01 (10-30): a sealed void in a project record repaired from inside; its test reproduces the showcase ziggurat's
  // own geometry from the fixture (the record's cells and a read-only scan of the world)
  'bots/src/voidfill.mjs',
  'bots/test/voidfill.test.mjs',
  'bots/test/fixtures/voidfill-showcase-ziggurat-1030.json',
  // wallstuck-01 (10-30): the wall's last cells -- a sealed column dug from its top, a dug-out floor given back, the waiver; the
  // test reads the showcase wall's own geometry from the fixture
  'bots/test/wallstuck.test.mjs',
  'bots/test/fixtures/wallstuck-showcase-wall-1030.json',
  'docs/reports/shop-01-2026-10-25/shopread.py.txt',
  // the operator's state file -- the one the memory index says to read first
  'docs/reports/STATE.md',
  // the process the owner set on 2026-10-28; CLAUDE.md points every session at it
  'docs/PROCESS-fun-mode.md',
  // fun-mode tier 3: the protected list and its one decider, which both gates call (W1, 10-28)
  'config/protected-paths.txt',
  'scripts/lib/protected.py',
  // the town's projects: build_shop loads these by id at runtime (house-01, 10-29)
  'bots/src/blueprints/workshop@1.json',
  'bots/src/blueprints/house@1.json',
  'scripts/test_protected.py',
  // CLAUDE.md's and STATE.md's history, moved out when both were cut to the active rules (10-28)
  'docs/archive/CLAUDE-history-2026-10-28.md',
  'docs/archive/STATE-history-to-2026-10-28.md',
  // the episode replay harness: the gate that proves a candidate before it reaches a canary
  'sandbox/run-corpus.sh',
  'sandbox/run-scenario.sh',
  'sandbox/score-run.py',
  'sandbox/sandbox-scenario.py',
  'sandbox/corpus.tsv',
  // the scripts run-scenario.sh drives the sandbox bot with
  'bots/scripts/sandbox-say.mjs',
  // the checker for the ARBITER=1 startup crash, which existed and was called by nothing
  'scripts/ops/arbiterpreflight.py',
  // the deploy wrapper that refuses a canary with no reader
  'scripts/ops/fleet-deploy',
  // the telemetry library CLAUDE.md forbids hand-rolling a query instead of
  'scripts/lib/telemetry.py',
  // its Elasticsearch counterpart, the default for wide windows (OWNER 10-14), and its tests
  'scripts/lib/estelemetry.py',
  'scripts/test_estelemetry.py',
  'scripts/test_estelemetry_mutants.py',
  // the 3 h / 24 h / 7 d fleet status built on it (replaces the lost quickstatus.py)
  'scripts/host/fleetstatus.py',
  'scripts/test_fleetstatus.py',
  // the movement-writer ratchet, wired into package.json and the deploy
  'bots/scripts/check-movement-writers.mjs',
]

t('every load-bearing path exists in the working tree', () => {
  const gone = REQUIRED.filter(p => !existsSync(join(ROOT, p)))
  assert.deepEqual(gone, [], `missing from this tree: ${gone.join(', ')}`)
})

t('and every one of them is TRACKED, not sitting untracked on disk', () => {
  // existsSync is not enough: 42 files were present on disk and in no commit at all, which is
  // indistinguishable from healthy until someone clones the repo or runs git clean.
  const tracked = new Set(git('ls-files').split('\n').filter(Boolean))
  const untracked = REQUIRED.filter(p => !tracked.has(p))
  assert.deepEqual(untracked, [], `present on disk but NOT IN GIT: ${untracked.join(', ')}`)
})

t('the manifest itself is not vacuous', () => {
  // POSITIVE CONTROL. Without this, deleting the list would make both tests above pass forever --
  // which is exactly how an absence reads as health.
  assert.ok(REQUIRED.length >= 10, `the manifest has shrunk to ${REQUIRED.length} entries`)
  assert.ok(REQUIRED.includes('docs/reports/STATE.md'), 'STATE.md must stay in the manifest')
  assert.ok(REQUIRED.some(p => p.startsWith('sandbox/')), 'the replay harness must stay in the manifest')
})

t('no untracked files are accumulating in the directories that carry evidence or tooling', () => {
  // The other half of the failure: work that never got committed anywhere. Reports and scripts are
  // where it lands, because they are not what `npm test` or a deploy would notice.
  const WATCH = ['docs/reports/', 'scripts/', 'sandbox/', 'infra/', 'bots/scripts/']
  const untracked = git('status', '--porcelain', '--untracked-files=all')
    .split('\n').filter(l => l.startsWith('?? '))
    .map(l => l.slice(3).trim())
    .filter(p => WATCH.some(w => p.startsWith(w)))
  assert.deepEqual(untracked, [],
    `untracked and one \`git clean\` from gone:\n        ${untracked.join('\n        ')}`)
})

t('nothing under bots/node_modules is tracked -- not a directory, and not a symlink either', () => {
  // 9b339fd committed a SYMLINK at bots/node_modules (-> an absolute path on one machine) because
  // .gitignore's `node_modules/` matches directories only. Checking out main then made the link
  // point at itself and every test run failed with ERR_MODULE_NOT_FOUND.
  const tracked = git('ls-files', '--', 'bots/node_modules').split('\n').filter(Boolean)
  assert.deepEqual(tracked, [], `tracked under bots/node_modules: ${tracked.join(', ')}`)
})

// ---- prove the check can fail, for the intended reason ----
t('MUTANT KILLED: a required path going missing is caught', () => {
  const victim = join(ROOT, 'scripts/ops/arbiterpreflight.py')
  const saved = readFileSync(victim)
  try {
    unlinkSync(victim)
    const gone = REQUIRED.filter(p => !existsSync(join(ROOT, p)))
    assert.ok(gone.includes('scripts/ops/arbiterpreflight.py'),
      'removing a required file did not make the existence check notice; the check is inert')
  } finally {
    writeFileSync(victim, saved)
  }
  assert.ok(existsSync(victim), 'the mutant must restore the file it removed')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
