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
  // shaft-02 (10-30): the town stair's converged design (both engines) and its Paper driver
  'docs/reports/mineshaft-2026-10-30/design.md',
  'sandbox/stair/stair-e2e.mjs',
  // escapeguard-01 (10-31): a trapped bot's escape never digs a build record or a protected zone's structure
  // serving D (owner 11-01): fewer LLM decisions -- pausewait, vetoskip, continue
  'bots/src/fewerdec.mjs',
  'bots/test/fewerdec.test.mjs',
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
  'sandbox/shafttrap/egress-e2e.mjs',  // shafttrap-01: its Paper driver
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
  'bots/src/storehouse.mjs',
  'bots/test/storehouse.test.mjs',
  // showchat-01 (11-01): the showcase's templated chat announcements (comms stage 2) + the timelapse captions
  'bots/src/showchat.mjs',
  'bots/test/showchat.test.mjs',
  // requests-01 (11-03): the town's requests board (comms stage 3 piece 1) + its 11-01..03 replay fixture
  'bots/src/requests.mjs',
  'bots/test/requests.test.mjs',
  'bots/test/fixtures/requests-showcase-1101-1103.jsonl',
  // sortstore-01 (11-01): the sorted storehouse, its labels' Paper proof and the showcase fixture its tests read
  'bots/src/sortstore.mjs',
  'bots/src/indexsearch2.mjs',        // indexsearch-02 = storehub piece C
  'bots/test/indexsearch2.test.mjs',
  'bots/test/sortstore.test.mjs',
  'bots/test/fixtures/sortstore-showcase-1101.json',
  'sandbox/sortstore/sign-proof.cjs',
  'bots/src/shopchest.mjs',
  'bots/test/shopchest.test.mjs',
  'bots/src/expedition.mjs',
  'bots/test/expedition.test.mjs',
  // showcase batch 2 (11-04): the crop farm (cropfarm-01show) and the expedition bridges (bridgepost-01)
  'bots/src/cropfarm.mjs',
  'bots/src/cropkeep.mjs',
  'bots/test/cropfarm.test.mjs',
  'bots/src/bridge.mjs',
  'bots/src/bridgeio.mjs',
  'bots/test/bridgepost.test.mjs',
  'bots/test/expwater.test.mjs',
  'bots/scripts/expwater-offline.mjs',
  'sandbox/swim/swim.mjs',
  'sandbox/swim/swimrelay.py',
  'bots/test/showcase-on-fleet.test.mjs',
  // bagdiet-01 (11-02): the light projects' visit hold, their bank-back gate, the craft's table candidates
  'bots/test/bagdiet.test.mjs',
  // stockyard-01 (11-02): the town stockpile yard, its blueprint, its generator and its test
  'bots/src/yard.mjs',
  'bots/src/blueprints/yard@1.json',
  'docs/reports/stockyard-2026-11-02/make_yard.py',
  'bots/test/yard.test.mjs',
  // storehub-01 pieces A + B (11-04): the sorted hall, its blueprint, its generator, its offline siting, its test, the build notes
  'bots/src/storehub.mjs',
  'bots/src/blueprints/storehub@1.json',
  'docs/reports/storehub-ab-2026-11-04/make_storehub.py',
  'bots/scripts/storehub-offline.mjs',
  'bots/test/storehub.test.mjs',
  // wallext-01 (11-04): the wall extension round the storage hall and its test (the design is main's: docs/reports/wallext-design-2026-11-04.md)
  'bots/test/wallext.test.mjs',
  // enchantshop-01 (11-04): the enchanting + anvil workshop, its blueprint and generator, its offline siting, its test (the design is main's)
  'bots/src/enchantshop.mjs',
  'bots/src/blueprints/enchantshop@1.json',
  'docs/reports/enchantshop-2026-11-04/make_enchantshop.py',
  'bots/scripts/enchantshop-offline.mjs',
  'bots/test/enchantshop.test.mjs',
  // canefarm-01 (11-04, owner E1): the sugar cane bed for the workshop's books
  'bots/src/canefarm.mjs',
  'bots/scripts/canefarm-offline.mjs',
  'bots/test/canefarm.test.mjs',
  // picker-01 (11-03): the town sinks (roads, wall towers, ziggurat growth), their offline siting and their test
  'bots/src/sinks.mjs',
  'bots/scripts/sinks-offline.mjs',
  'bots/test/sinks.test.mjs',
  // sinkfix-01 (11-03): a project that changed nothing yields to a wanted sink (the live 0-sited reproduction)
  'bots/test/sinkfix.test.mjs',
  // sinkfix-02 (11-04): sinks that placed ~0 live (aborted road, a tower's spent proofs, dress held back) reproduced
  'bots/test/sinkfix2.test.mjs',
  // sinkfix-03 (11-04): one plot's failed siting no longer quiets every build order for a day
  'bots/test/sinkfix3.test.mjs',
  // sinkfix-04 (11-04): one town-wide no-site stamp a kind; a quiet grounds order after a no-effect grounds visit
  'bots/test/sinkfix4.test.mjs',
  // yarduse-01 (11-04): the yard before the well, the bays' clutter, the sinks' and the tidy's bills drawn from the yard
  'bots/test/yarduse.test.mjs',
  'docs/reports/yarduse-design-2026-11-04.md',
  // siteprep-01 (11-04): the groundskeeper prepares a plot when a sink finds no site
  'bots/test/siteprep.test.mjs',
  // siteprep-02 (11-04): the live SP1 stall reproduced on the showcase's own blocks
  'bots/test/siteprep-sp1.test.mjs',
  'bots/test/fixtures/siteprep-sp1-1104.json',
  // siteprep-03 (11-04): the live SP1 overlap reproduced on the showcase's own blocks and records
  'bots/test/siteprep-overlap.test.mjs',
  'bots/test/fixtures/siteprep-sp1-overlap-1104.json',
  'bots/test/siteprepcursor.test.mjs',   // the siteprep-02 fold: a cursor of an older screen restarts
  'bots/test/gkaccessfold.test.mjs',   // the gkaccess fold: no stair across the storage hall's way in
  'bots/test/wallaccessfold.test.mjs',   // the wallext + access fold: ids namespaced, the extension no footprint
  'bots/test/gkstagefold.test.mjs',   // the gkstage fold: inwall never cuts a site-prep reservation
  'bots/test/siteprepfold.test.mjs',   // the fold's prepared-claim bypass (Codex fold BLOCKER)
  'bots/src/siteprep.mjs',
  'docs/reports/siteprep-design-2026-11-04.md',
  // towndress-01 (11-03): the town's lights and signs (the `dress` sink), its offline siting and its test
  'bots/src/towndress.mjs',
  'bots/scripts/dress-offline.mjs',
  'bots/test/towndress.test.mjs',
  // yardsite-01 (11-03): the yard beyond the town ring, the 2x yard, its offline proof and its test
  'bots/src/blueprints/yard@2.json',
  'bots/scripts/yard-offline.mjs',
  'bots/test/yardsite.test.mjs',
  // copperhall-01 (11-02): the showcase copper hall, its blueprint and its test over the showcase terrace's own region export
  'bots/src/copperhall.mjs',
  'bots/src/blueprints/hall@1.json',
  'bots/test/copperhall.test.mjs',
  // copperrun-01 (11-03): the waiting hall's bill drives a copper gather (copperhall.mjs copperRunOrder; shop.mjs buildOrder's ask)
  'bots/test/copperrun.test.mjs',
  'bots/test/fixtures/copperhall-01-terrain-20261102.json',
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
  'docs/reports/groundskeeper-2026-11-02.md',
  'bots/scripts/tidy-offline.mjs',
  // townterrace-01 (owner 11-03, townterrace-1103): the terrace stage, the park, its offline proof and its report
  'bots/src/terrace.mjs',
  'bots/src/park.mjs',
  'bots/test/terrace.test.mjs',
  'bots/test/gkhelpers.test.mjs',   // gkhelpers-01: the grounds crew, the storehouse floor, the park gather
  'bots/test/access.test.mjs',   // access-01: proper stairs where bots climbed (groundskeeper piece 3)
  'bots/test/fixtures/gkstage-tidy-g20-20261104.json',   // gkstage-01: the LIVE tidy record the floor-only stall ran on
  'bots/scripts/inwall-offline.mjs',   // gkstage-01: the inside-the-wall stage on region copies
  // placeaudit-01 (owner 11-04 groundskeeper piece 2): who places blocks in town, why, where
  'bots/src/placeaudit.mjs',
  'bots/test/placeaudit.test.mjs',
  // anvilapply-01 + enchant-01 (owner 11-04): the anvil / enchanting-table skills, their test, the Paper e2e
  'bots/src/enchant.mjs',
  'bots/test/enchant.test.mjs',
  'sandbox/trading/enchant-e2e.mjs',
  'bots/scripts/terrace-offline.mjs',
  'docs/reports/townterrace-2026-11-03.md',
  'docs/reports/tidy-01-2026-11-01.md',
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
  // tombexit-01 (10-31): the entombed arm's walk-back decline and the in-wall dig
  'bots/src/tombexit.mjs',
  'bots/test/tombexit.test.mjs',
  // lavatarget-01 (10-31): explore never heads for a sighting beside lava the bot has seen
  'bots/src/lavatarget.mjs',
  'bots/test/lavatarget.test.mjs',
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
