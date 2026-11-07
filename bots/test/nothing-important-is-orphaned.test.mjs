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
  // tidydead-01 (11-05): the tidy's hard cells (a block no stand reaches, a fill no click lands on) are deferred so its waiver names them
  'bots/test/gkstay.test.mjs',   // gkstay-01 (11-07): the keeper lease stays with a holder on the surface (no churn)
  'bots/test/gklease2.test.mjs',   // gklease-02 (11-07): the stale tidy stamp, open sky, the town's sweep give-up
  'bots/src/gkwork.mjs',   // gkwork-01 (11-07): the groundskeeper always has work, or lets the lease go
  'bots/test/gkwork.test.mjs',   // gkwork-01 (11-07)
  'bots/test/gklease.test.mjs',   // gklease-01 (11-06): a grounds lease is held only by a bot that can work the grounds
  'bots/test/tidydead.test.mjs',
  'bots/src/stuckclose.mjs',   // stuckclose-01 (11-08): a tidy stage whose last cuts the town cannot reach closes
  'bots/test/stuckclose.test.mjs',   // stuckclose-01 (11-08)
  // stuckproj-01 (11-05): canopy-01 (a tree grown on a build is cut back so a stand sees the cell) + starve-01 (a starved open project gets a builder)
  'bots/src/canopy.mjs',
  'bots/test/stuckproj.test.mjs',
  'bots/test/hivedrop.test.mjs',          // hivedrop-01: the canopy re-plan + loop yields (keepalive), the evictor's end stop
  // dirtrung-01 (11-04): the dirt rung is met by a stack of dirt + stone family (gather_dirt_16 held 22.8% of decisions)
  'bots/test/dirtrung.test.mjs',
  // sandrung-01 (11-07): the gatherer chain's sand rung retired (7.5% of fleet time, gather sand 11.7% ok, no sand reached a town)
  'bots/src/sandrung.mjs',
  'bots/test/sandrung.test.mjs',
  // gathermem-01 (11-07): per-bot memory of failed gather targets + same-spot refusal (93.7 bot-h/24 h of same-spot repeats)
  'bots/src/gathermem.mjs',
  'bots/test/gathermem.test.mjs',
  'sandbox/gathermem/gathermem-e2e.mjs',
  // repeatwork-01 (11-04): the repeat window does not refuse a gather whose last run on the rung gained a wanted item
  'bots/src/repeatwork.mjs',
  'bots/test/repeatwork.test.mjs',
  // shaft-02 (10-30): the town stair's converged design (both engines) and its Paper driver
  'docs/reports/mineshaft-2026-10-30/design.md',
  'sandbox/stair/stair-e2e.mjs',
  // dropanddig-01 (11-04): the air pocket is dug STANDING over a floor within 2 (the time-budget drownings)
  // idlework-01 (11-06): the idle rung (need-driven batches, not the 80-block patrol) and the unsited-project wait
  'bots/src/idlework.mjs',
  'bots/test/idlework.test.mjs',
  'bots/test/idlework-sites.test.mjs',
  'docs/reports/idlework-design-2026-11-06.md',
  // idlework-02 (11-06): the bag stop, the 29-33 band dispose, the depth-aware iron/coal hint
  'bots/test/idlework2.test.mjs',
  'docs/reports/idlework2-design-2026-11-06.md',
  'bots/src/dropdig.mjs',
  'bots/test/dropdig.test.mjs',
  'bots/test/fixtures/dropdig-cuts.json',
  'docs/reports/dropdig-01-2026-11-04.md',
  // swimcentre-01 (11-03): a rising body is centred under the column it rises through (the y N.2 drownings)
  'bots/src/swimcentre.mjs',
  'bots/test/swimcentre.test.mjs',
  'docs/reports/swimcentre-01-2026-11-03.md',
  // escapeguard-01 (10-31): a trapped bot's escape never digs a build record or a protected zone's structure
  // serving D (owner 11-01): fewer LLM decisions -- pausewait, vetoskip, continue
  'bots/src/fewerdec.mjs',
  'bots/test/fewerdec.test.mjs',
  'bots/src/vetoremedy.mjs',
  'bots/test/vetoremedy.test.mjs',
  'bots/src/escapeguard.mjs',
  'bots/test/escapeguard.test.mjs',
  // shaft-02 (10-30): the town stair -- its geometry/survey/record and its visit (the Paper driver runs the same code)
  // deepminer-01 (11-01): the town deep miner (the trip, the branch layout, the way back) and its Paper driver
  'bots/src/deepmine.mjs',
  'bots/test/deepmine.test.mjs',
  'sandbox/deepmine/deepmine-e2e.mjs',
  'docs/reports/deepminer-2026-11-01.md',
  'bots/src/shaftgeom.mjs',
  'bots/src/shaftvisit.mjs',
  'bots/test/town-stair.test.mjs',
  'bots/test/town-stair-wiring.test.mjs',
  'bots/test/town-stair-stuck.test.mjs',
  'bots/test/stair-egress.test.mjs',   // shafttrap-01: a stair visit ends at the collar
  'bots/test/stair-handoff.test.mjs',   // shafttrap-02: the reflexes hand a bot on the town stair to the egress first
  'sandbox/shafttrap/egress-e2e.mjs',  // shafttrap-01: its Paper driver
  'sandbox/shafttrap/handoff-e2e.mjs',  // shafttrap-02: the whole bot idle on the stair (Paper driver)
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
  'bots/src/handcap.mjs',  // handcap-01 (11-06): a shaft cap the bare hand breaks is a climb, not a pickaxe ask
  'bots/test/handcap.test.mjs',
  'bots/src/escdead.mjs',  // escdead-01 (11-06): the wide swim, the flood-in breach, the pin clock (phase 2.3)
  'bots/test/escdead.test.mjs',
  'bots/test/escpocket.test.mjs',
  'bots/test/fixtures/escpocket-isolated-d-358_58_180-1107.json',
  'bots/test/fixtures/escdead-isolated-d-358_58_180-1106.json',
  'bots/test/fixtures/escdead-hive-c-124_52_64-1106.json',
  'docs/reports/escdead-design-2026-11-06.md',
  'bots/test/copperrun02-fleet.test.mjs',  // copperrun-02's protected part on the fleet (inert there: no copper hall)
  // voidfill-01 (10-30): a sealed void in a project record repaired from inside; its test reproduces the showcase ziggurat's
  // own geometry from the fixture (the record's cells and a read-only scan of the world)
  'bots/src/voidfill.mjs',
  'bots/test/voidfill.test.mjs',
  'bots/test/fixtures/voidfill-showcase-ziggurat-1030.json',
  // wallstuck-01 (10-30): the wall's last cells -- a sealed column dug from its top, a dug-out floor given back, the waiver; the
  // test reads the showcase wall's own geometry from the fixture
  'bots/test/wallstuck.test.mjs',
  'bots/test/fixtures/wallstuck-showcase-wall-1030.json',
  // furnaceseen-01 (cooperation B3, re-stacked 10-31 into zigfleet-02): the drain skips a furnace a townmate found empty
  'bots/test/furnaceseen.test.mjs',
  'bots/test/fixtures/seenskip-golden.json',
  // zigsealed-01 (11-01): the ziggurat's sealed skin column -- open cells of the waiting segments dug with the column
  'bots/test/zigsealed.test.mjs',
  'bots/test/fixtures/zigsealed-showcase-1101.json',
  // fleetpaths-01 (11-01): a destination inside the plaza is served by it; a fleet town's unroutable paths write a no-site record
  'bots/test/fleetpaths.test.mjs',
  // zigbamboo (fleetbuild-01, 11-01): bamboo grown into open ziggurat foundation cells is dug
  'bots/test/zigbamboo.test.mjs',
  // tidy-01 (11-01): the town-ground tidy (pillars, pits, the paths' corridors graded) and its offline proof on region copies
  'bots/src/tidy.mjs',
  'bots/test/tidy.test.mjs',
  // groundskeeper-01 (owner 11-02, groundskeeper-1102): the land plan, the keeper lease, the offline proof
  'bots/src/landplan.mjs',
  'bots/src/groundskeeper.mjs',
  'bots/test/groundskeeper.test.mjs',
  'bots/scripts/landplan-offline.mjs',
  // gkforever-01 (owner 11-06): the grounds never run out (clock, dead carry, level, crew, the grounds lap)
  'bots/src/gkforever.mjs',
  'bots/test/gkforever.test.mjs',
  'docs/reports/gkforever-design-2026-11-06.md',
  // stations-01 (owner 11-06): the town's tables and furnaces (take-back, the groundskeepers' sweep, town stations, chest first, spare fuel)
  'bots/src/stations.mjs',
  'bots/test/stations.test.mjs',
  'docs/reports/stations-design-2026-11-06.md',
  'docs/reports/stations-2026-11-06/codex-design.txt',
  'docs/reports/stations-2026-11-06/scan.py',
  'docs/reports/stations-2026-11-06/m1.py',
  // phase 2 (codeeval 11-06): buildretry-01 the build retry hole; buildnext-01 never idle on a blocked project; buildwait-01 the engine's intended waits
  'bots/src/buildretry.mjs',
  'bots/test/buildretry.test.mjs',
  'bots/test/buildnext.test.mjs',
  'bots/test/buildwait.test.mjs',
  'docs/reports/phase2-build-design-2026-11-06.md',
  'docs/reports/groundskeeper-2026-11-02.md',
  'bots/scripts/tidy-offline.mjs',
  'docs/reports/tidy-01-2026-11-01.md',
  // stuckcells-01 (11-01): the cells every project waits on (snow read, sealed pocket, waiver, blocked deferral, stair support chain)
  'bots/src/stuckcells.mjs',
  'bots/test/stuckcells.test.mjs',
  'bots/scripts/stuckcells-offline.mjs',
  'bots/scripts/stairstuck-offline.mjs',
  'docs/reports/stuckcells-01-2026-11-01.md',
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
  // the model-env canary's read and stall poll, and the loop v38 installer (qwen35-01, 10-30)
  'scripts/host/modelread.py',
  'scripts/host/install-loop-v38.sh',
  // the staged model rollout after a model-env KEEP, and what it runs (OWNER 10-31 "roll out in stages 20 bots at a time")
  'scripts/host/modelrollout.py',
  'scripts/host/test_modelrollout.py',
  'scripts/host/modelcompare.py',
  'scripts/host/test_modelcompare.py',
  'scripts/host/holdtoken.py',
  'scripts/host/qwen35load.mjs',
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
  // drainpick-01 (11-01): the drain not offered where it cannot help; withdraw_pick crafts the stone pickaxe from the bag
  'bots/test/drainpick.test.mjs',
  'bots/test/pickcraft.test.mjs',
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
  // cooldown15-01 (11-01): the decision cooldown cap (30 s env -> 15 s) and its one-number rollback
  'bots/test/cooldown-cap.test.mjs',
  // the learning loop's nightly archive (M1): logs on .31 rotate after 14 days, this is the only long-term copy
  'scripts/learnloop/extract_triples.py',
  'scripts/learnloop/nightly.py',
  'scripts/learnloop/nas-relay.sh',
  'scripts/learnloop/test_learnloop.py',
  'scripts/learnloop/build_clean.py',
  'scripts/learnloop/test_build_clean.py',
  'scripts/learnloop/teacher/teacher_pilot.py',
  'scripts/learnloop/teacher/pilot_agreement.py',
  'scripts/learnloop/train/train_sft.py',
  'scripts/learnloop/train/run_c2.sh',
  'scripts/learnloop/train/bar_c2.py',
  'scripts/learnloop/c2host/eval_c2.sh',
  'scripts/learnloop/prompt_transform.mjs',
  'bots/test/promptcache.test.mjs',
  // M2b: removes 10.0.0.16 from every bot endpoint list before training
  'scripts/host/drop16.sh',
  // the movement-writer ratchet, wired into package.json and the deploy
  'bots/scripts/check-movement-writers.mjs',
  // logsurface-01: the real-case columns cut from the region copies of failed log gathers (10-28), and their suite
  'bots/test/fixtures/logsurface-columns.json',
  'bots/test/logsurface.test.mjs',
  // swimunder-01 (11-03): a bot pinned in a wet-ceiling pocket swims out under the wall; its real-site fixtures and offline coverage
  'bots/src/swimunder.mjs',
  'bots/test/swimunder.test.mjs',
  'bots/test/fixtures/swimunder-isolated-d-358_58_180.json',
  'bots/test/fixtures/swimunder-isolated-c-355_47_186.json',
  'bots/test/fixtures/swimunder-hive-d-100_54_149.json',
  'bots/scripts/swimunder-offline.mjs',
  // tombexit-01 (10-31): the entombed arm's walk-back decline and the in-wall dig
  'bots/src/tombexit.mjs',
  'bots/test/tombexit.test.mjs',
  // lavatarget-01 (10-31): explore never heads for a sighting beside lava the bot has seen
  'bots/src/lavatarget.mjs',
  'bots/test/lavatarget.test.mjs',
  // leasegen-01 (11-05): the 35k-file town directory's lookup budget, the lease sweep, the per-connection timers
  'bots/test/leasegen.test.mjs',
  // depositoffer-01 (11-04): deposit leaves the per-call skill enum when the gate would refuse it; the deposit rung's floor
  'bots/src/depositoffer.mjs',
  'bots/test/depositoffer.test.mjs',
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
