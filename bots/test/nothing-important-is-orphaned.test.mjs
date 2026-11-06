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
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

// GIT CONTEXT (phase 1 item 3, 11-06): on a tree shipped without .git (suite-run --no-git) the existence checks still run;
// the checks that need `git ls-files` / `git status` print `SKIP (...)` and the file exits 77, which run-tests.mjs reports
// as SKIPPED -- never as a pass. suite-run ships a real checkout by default, so they run there too.
const { gitContext } = await import('../scripts/test-result.mjs')
const CTX = await gitContext(fileURLToPath(new URL('.', import.meta.url)))
const ROOT = CTX.ok ? CTX.root : join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })
let skipped = 0
const tGit = (n, f) => { if (CTX.ok) return t(n, f); skipped++; console.log(`  SKIP  ${n} (${CTX.why})`) }

// THE MANIFEST. Every path here is load-bearing for operating or measuring the fleet, and every one
// of them has either gone missing from main or been cited by a review as missing. Adding to this
// list is how you stop the next thing being orphaned; it is deliberately explicit rather than a
// pattern, so a rename is a decision and not an accident.
const REQUIRED = [
  'scripts/host/indexsearch2read.py',   // storehub piece C's watch read
  // wholemap-s0 (11-01): the whole-map coverage instrument (seen% / stood% / reach / tiles), its BlueMap route layer + installer
  'infra/showcase/wholemap.py',
  'infra/showcase/test_wholemap.py',
  'infra/showcase/install-wholemap.sh',
  // visuals-1105 (11-05): Chunky nightly hero renders (ci2), the skin generator + SkinsRestorer install/apply scripts
  'infra/showcase/visuals/chunky-render-nightly.sh',
  'infra/showcase/visuals/chunky_scenes.py',
  'infra/showcase/visuals/make_skins.py',
  'infra/showcase/visuals/apply-skins.sh',
  'infra/showcase/visuals/restart-sr.sh',
  'bots/test/wholemap.test.mjs',
  // B5 (10-31): the cooperation tier's role leases (bot side), the host assigner, the spend guard + caller, the Paper arms
  'bots/src/roles.mjs',
  'bots/test/roles.test.mjs',
  'bots/test/assign.test.mjs',
  'scripts/overseer/assign.mjs',
  'scripts/overseer/spendguard.py',
  'scripts/overseer/test_spendguard.py',
  'scripts/overseer/caller.py',
  'scripts/overseer/system_prompt.txt',
  'sandbox/coop/arms-e2e.cjs',
  'sandbox/coop/arms-batch.cjs',
  'sandbox/coop/arms-read.py',
  'docs/reports/coop-b5-2026-10-31.md',
  // dirtrung-01 (11-04): the dirt rung is met by a stack of dirt + stone family (gather_dirt_16 held 22.8% of decisions)
  'bots/test/dirtrung.test.mjs',
  // shaft-02 (10-30): the town stair's converged design (both engines) and its Paper driver
  'docs/reports/mineshaft-2026-10-30/design.md',
  'sandbox/stair/stair-e2e.mjs',
  // dropanddig-01 (11-04): the air pocket is dug STANDING over a floor within 2 (the time-budget drownings)
  // idlework-01 (11-06): the design (the code is on branch idlework-01 until it promotes)
  'docs/reports/idlework-design-2026-11-06.md',
  'docs/reports/gkforever-design-2026-11-06.md',   // gkforever-1106: the grounds never run out (design; the code is on branch gkforever-01)
  // treefarm-05 (11-06): the idle towns' farm + hub design and the run's registration (the code is on branch treefarm05-on-4f3b0f5)
  'docs/reports/idletowns-farm-hub-design-2026-11-06.md',
  'docs/reports/treefarm-05/treefarm-05.946c8aaa.json',
  'docs/reports/treefarm-05/treefarm-05.queue-entry.json',
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
  'bots/src/storehouse.mjs',
  'bots/test/storehouse.test.mjs',
  // showchat-01 (11-01): the showcase's templated chat announcements (comms stage 2) + the timelapse captions
  'bots/src/showchat.mjs',
  'bots/test/showchat.test.mjs',
  // sortstore-01 (11-01): the sorted storehouse, its labels' Paper proof and the showcase fixture its tests read
  'bots/src/sortstore.mjs',
  'bots/test/sortstore.test.mjs',
  'bots/test/fixtures/sortstore-showcase-1101.json',
  'sandbox/sortstore/sign-proof.cjs',
  'bots/src/shopchest.mjs',
  'bots/test/shopchest.test.mjs',
  'bots/src/expedition.mjs',
  'bots/test/expedition.test.mjs',
  'bots/test/expwater.test.mjs',
  'bots/scripts/expwater-offline.mjs',
  'sandbox/swim/swim.mjs',
  'sandbox/swim/swimrelay.py',
  // bridgepost-01 (11-03): the design and the Paper driver (the bot code lands with the showcase fold: add bots/src/bridge.mjs, bridgeio.mjs, test/bridgepost.test.mjs then)
  'docs/reports/bridgepost-design-2026-11-03.md',
  'sandbox/bridge/bridge.mjs',
  'sandbox/bridge/bridgerelay.py',
  'bots/test/showcase-on-fleet.test.mjs',
  // bagdiet-01 (11-02): the light projects' visit hold, their bank-back gate, the craft's table candidates
  'bots/test/bagdiet.test.mjs',
  // stockyard-01 (11-02): the town stockpile yard, its blueprint, its generator and its test
  'bots/src/yard.mjs',
  'bots/src/blueprints/yard@1.json',
  'docs/reports/stockyard-2026-11-02/make_yard.py',
  'bots/test/yard.test.mjs',
  // picker-01 (11-03): the town sinks' reconciled design (Claude + Codex); the code is on branch picker-01show until it lands
  'docs/reports/picker-sinks-2026-11-03.md',
  // towndress-01 (11-03): lights, signs, docks, museum, bees -- the reconciled design (Claude + Codex); the code is on branch towndress-01show
  'docs/reports/towndress-design-2026-11-03.md',
  // storehub (11-03): the storage hub's reconciled design (Claude + Codex) and its appendix; design only, no code yet
  'docs/reports/storehub-design-2026-11-03.md',
  // storehub pieces A + B (11-04): the build notes and the hall's generator (the code is branch storehub-ab-show's until it lands)
  'docs/reports/storehub-ab-2026-11-04.md',
  'docs/reports/storehub-ab-2026-11-04/make_storehub.py',
  'docs/reports/storehub-design-2026-11-03/codex-design.md',
  // yardsite-01 (11-03): the yard beyond the town ring, the 2x yard, its offline proof and its test
  'bots/src/blueprints/yard@2.json',
  'bots/scripts/yard-offline.mjs',
  'bots/test/yardsite.test.mjs',
  // yarduse-01 (11-04): why the stock yard stood unused, and the fix (showcase piece)
  'docs/reports/yarduse-design-2026-11-04.md',
  // wallext-01 (11-04): the wall extension round the storage hall -- design, Codex design + review, the offline record and map (the
  // code is branch wallext-show's until it lands)
  'docs/reports/wallext-design-2026-11-04.md',
  // decorator-01 (11-04): the decorator -- the reconciled design (Claude + Codex) and its picture; the code is on branch decorator-01show
  'docs/reports/decorator-design-2026-11-04.md',
  'docs/reports/decorator-design-2026-11-04/decorated-town.png',
  'docs/reports/decorator-design-2026-11-04/decorated-town.txt',
  'docs/reports/decorator-design-2026-11-04/decorated-town-02.png',
  'docs/reports/decorator-design-2026-11-04/decorated-town-02.txt',
  'docs/reports/decorator-design-2026-11-04/decorated-town-03.png',
  'docs/reports/decorator-design-2026-11-04/decorated-town-03.txt',
  'docs/reports/wallext-2026-11-04/codex-design.md',
  'docs/reports/wallext-2026-11-04/offline-record-showcase-1104.json',
  'docs/reports/wallext-2026-11-04/offline-demolition-showcase-1104.json',
  'docs/reports/wallext-2026-11-04/offline-record-showcase-1104-r3.json',
  'docs/reports/wallext-2026-11-04/offline-demolition-showcase-1104-r3.json',
  'docs/reports/wallext-2026-11-04/offline-record-showcase-1105-r4.json',
  // enchantshop-01 (11-04): the enchanting + anvil workshop -- design, Codex design + reviews, the generator, the offline siting
  // (the code is branch enchantshop-show-wx's until it lands)
  'docs/reports/enchantshop-design-2026-11-04.md',
  'docs/reports/enchantshop-2026-11-04/codex-design.md',
  'docs/reports/enchantshop-2026-11-04/make_enchantshop.py',
  'docs/reports/enchantshop-2026-11-04/offline-siting-showcase-1104.json',
  // obsidian-01 / bucketfix-01 (11-04): the obsidian design, the Paper proof driver, the bucketfix registration
  'docs/reports/obsidian-design-2026-11-04.md',
  // townstyle-01 (11-04): pitched roofs -- the design, Codex's design, the reviews, the Paper records, the pictures (the code is branch
  // townstyle-01show's until it lands; the tripwire rule RO1 is in docs/reports/shop-01-2026-10-25/shopread.py.txt)
  'docs/reports/townstyle-design-2026-11-04.md',
  'docs/reports/townstyle-2026-11-04/codex-design.md',
  'docs/reports/townstyle-2026-11-04/reviews.md',
  'docs/reports/townstyle-2026-11-04/paper-orient.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-blind.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-cottage.jsonl',
  'docs/reports/townstyle-2026-11-04/townstyle-sheet.png',
  'docs/reports/townstyle-2026-11-04/cottage-elevations.txt',
  'docs/reports/townstyle-2026-11-04/paper-cottage-skill.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-townstyle02.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-reroof.jsonl',
  'scripts/host/test_shopconform_states.py',
  'sandbox/enchant/obsidian-proof.cjs',
  'docs/reports/obsidian-2026-11-04/bucketfix-01.88c981a1.json',
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
  // g3-standing (11-01): the tripwire's G3 judges the bots' LATEST audits; the storehouse-01 false trip's real rows and geometry
  'infra/showcase/test_trip_g3_standing.py',
  'infra/showcase/fixtures/g3-storehouse-01-20261101.jsonl',
  'bots/test/townplan-storehouse-geometry.test.mjs',
  'bots/test/fixtures/storehouse-01-mirror-20261101.json',
  // fleetpaths-01 (11-01): a destination inside the plaza is served by it; a fleet town's unroutable paths write a no-site record
  'bots/test/fleetpaths.test.mjs',
  // zigbamboo (fleetbuild-01, 11-01): bamboo grown into open ziggurat foundation cells is dug
  'bots/test/zigbamboo.test.mjs',
  // tidy-01 (11-01): the town-ground tidy (pillars, pits, the paths' corridors graded) and its offline proof on region copies
  'bots/src/tidy.mjs',
  'bots/test/tidy.test.mjs',
  'bots/scripts/tidy-offline.mjs',
  'docs/reports/tidy-01-2026-11-01.md',
  // stuckcells-01 (11-01): the cells every project waits on (snow read, sealed pocket, waiver, blocked deferral, stair support chain)
  'bots/src/stuckcells.mjs',
  'bots/test/stuckcells.test.mjs',
  'bots/scripts/stuckcells-offline.mjs',
  'bots/scripts/stairstuck-offline.mjs',
  'docs/reports/stuckcells-01-2026-11-01.md',
  // monustuck-01 (11-03): the stuck fleet ziggurats (bamboo stalk felled at its foot, waiver beside a sealed cell, dig-walk bans)
  'docs/reports/monustuck-design-2026-11-03.md',
  'docs/reports/stuckproj-design-2026-11-05.md',   // stuckproj-01 (11-05): starved walls, tree-occluded cells, tidy dead cells
  'docs/reports/shafttrap-design-2026-11-03.md',   // shafttrap-1103: the town stair trap (design + Codex reconciliation)
  'docs/reports/shafttrap-02-design-2026-11-03.md',   // shafttrap-02: the fleet hand-over (design, reviews, Paper)
  'docs/reports/shafttrap-02.queue-entry.json',   // shafttrap-02: the draft queue entry
  'docs/reports/shafttrap-02.5159b315.json',   // shafttrap-02: the registration

  // promomerge (11-02, audit 11-01 flag 4): every fleet promotion merged into main mechanically, or it pages
  'scripts/host/promomerge.py',
  'scripts/host/test_promomerge.py',
  'scripts/host/install-promomerge.sh',
  'scripts/mac/promomerge.sh',
  'bots/test/promomerge.test.mjs',
  'docs/reports/shop-01-2026-10-25/shopread.py.txt',
  // ci2 (11-03, owner "build the 2nd test suite on pve3"): the full-suite dispatcher over ci2 (10.0.0.34) and .30
  'scripts/host/suite-run.py',
  // the operator's state file -- the one the memory index says to read first
  'docs/reports/STATE.md',
  // STATE is generated (11-02, Codex ops audit HIGH 1): the generator, its tests and the Mac relay that commits it
  'scripts/host/stategen.py',
  'scripts/host/test_stategen.py',
  'scripts/mac/state-relay.sh',
  // the showcase restack after each fleet promotion (11-02, audit MEDIUM 3): prep job, record-compat harness, installer
  'infra/showcase/restack_prep.py',
  'infra/showcase/test_restack_prep.py',
  'infra/showcase/recordcompat.mjs',
  'infra/showcase/install-restack.sh',
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
  // serving option A (OWNER 11-01): the llama-server control script, the load tool and the oai+ client tests.
  'scripts/host/servea-llama.sh',
  'scripts/host/batchload.mjs',
  'bots/test/llm-oai.test.mjs',
  'scripts/host/servea-waiter.sh',
  'scripts/host/servea-install.sh',
  'scripts/host/servea-check.sh',
  'scripts/host/servea-q.py',
  'scripts/host/test_servea_q.py',
  'scripts/host/test_modelcompare.py',
  'scripts/host/fixtures/ab2-stall-20261101-1615-1640.jsonl',
  // canary-sched v39 launch-time autorebase: its tests, installer and the Mac push relay (11-01)
  'scripts/host/canary-sched.py',
  'scripts/host/test_autorebase.py',
  'scripts/host/install-autorebase.sh',
  'scripts/host/install-autorebase-v40.sh',
  'scripts/host/install-sched-v41.sh',   // v41 bundles + fast read plan (11-03)
  'scripts/host/autorebase-relay.sh',
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
  // the owner-commitments ledger and the hourly stall check (OWNER 10-31: 13 approved items had silently stopped)
  'config/owner-commitments.json',
  'config/monitors.json',
  'scripts/host/stallcheck.py',
  'scripts/host/test_stallcheck.py',
  'scripts/host/install-stallcheck.sh',
  'bots/test/stallcheck.test.mjs',
  'scripts/lib/alarmhead.py',
  // flowledger-01 (resource-model-1102 s.9): per-town stock + flow, bags counted, alarms in the fleetstatus header
  'scripts/host/flowledger.py',
  'scripts/host/flowstock.mjs',
  'scripts/host/test_flowledger.py',
  'scripts/host/install-flowledger.sh',
  'bots/test/flowledger.test.mjs',
  // effectwatch-01 (OWNER 11-03 items 1 + 6): post-promotion effect reads and fleet busy time, alarms in the fleetstatus header
  'scripts/host/effectwatch.py',
  'scripts/host/effectcache.py',
  'scripts/host/test_effectwatch.py',
  'scripts/host/install-effectwatch.sh',
  'scripts/lib/busytime.py',
  'scripts/lib/effectmetrics.py',
  'config/effect-targets.json',
  'bots/test/effectwatch.test.mjs',
  // jobshadow-01 (job-assigner-2026-11-03 stage 1): the rule-based town job assigner, shadow only (host, log only)
  'scripts/lib/jobrules.py',
  'scripts/host/jobshadow.py',
  'scripts/host/jobfacts.mjs',
  'scripts/host/test_jobshadow.py',
  'scripts/host/install-jobshadow.sh',
  'bots/test/jobshadow.test.mjs',
  'docs/reports/job-assigner-2026-11-03.md',
  // comms stage 3 (requests): the design + Codex's independent design and the reconciliation (11-03)
  'docs/reports/requests-design-2026-11-03.md',
  // farms (11-03): crop farms, bakery, animal pens -- the design (Codex + reconciliation) and its Paper proof
  'docs/reports/farms-design-2026-11-03.md',
  'sandbox/farms/farm-proof.cjs',
  'docs/reports/stoneworks-design-2026-11-05.md',
  'sandbox/stoneworks/fuel-proof.cjs',
  'sandbox/stoneworks/fuel-proof.jsonl',
  'sandbox/stoneworks/parts-proof.cjs',
  'sandbox/stoneworks/parts-proof.jsonl',
  'sandbox/farms/farm-proof.jsonl',
  // villager trading (11-03): the design + Codex's independent design, the Paper sandbox proofs and the read-only census helpers
  'docs/reports/trading-design-2026-11-03.md',
  // idlegap (owner 11-03 item 6): what fills the between time, vetoremedy-01's registration and queue entry
  'docs/reports/idlegap-design-2026-11-03.md',
  'docs/reports/idlegap-2026-11-03/gap.py.txt',
  'docs/reports/idlegap-2026-11-03/vetoremedy-01.0556ddfa.json',
  'sandbox/trading/trade-proof.cjs',
  'sandbox/trading/scout-proof.cjs',
  'sandbox/trading/anvil-proof.cjs',
  'docs/reports/anvilproof-2026-11-03.md',
  'docs/reports/anvilapply-enchant-2026-11-04.md',
  'sandbox/trading/census/villagers.py',
  'sandbox/trading/census/poi.py',
  'sandbox/trading/census/vdump.py',
  'sandbox/trading/census/blocks.py',
  'sandbox/trading/unlock-proof.cjs',
  'sandbox/trading/unlock-e2e.mjs',
  'infra/showcase/test_trip_unlock_mutants.py',
  'sandbox/trading/coalsale-e2e.mjs',
  'sandbox/trading/jobsite-e2e.mjs',
  'scripts/mac/opsaudit.sh',
  // cooldown15-01 (11-01): the decision cooldown cap (30 s env -> 15 s) and its one-number rollback
  'bots/test/cooldown-cap.test.mjs',
  // the learning loop's nightly archive (M1): logs on .31 rotate after 14 days, this is the only long-term copy
  'scripts/learnloop/extract_triples.py',
  'scripts/learnloop/nightly.py',
  'scripts/learnloop/nas-relay.sh',
  'scripts/learnloop/test_learnloop.py',
  'scripts/learnloop/build_clean.py',
  'scripts/learnloop/weekly/weekly.py',
  'scripts/learnloop/weekly/llgpu.sh',
  'scripts/learnloop/weekly/export_lora_gguf.py',
  'scripts/learnloop/weekly/referee.py',
  'scripts/learnloop/weekly/card_rates.py',
  'scripts/learnloop/weekly/install-weekly.sh',
  'scripts/learnloop/weekly/test_weekly.py',
  'scripts/learnloop/weekly/evalset.py',
  'docs/reports/learnloop-evalv1-2026-11-06/m3-eval.v1.MANIFEST.json',
  'docs/reports/learnloop-evalv1-2026-11-06/rescore-v1-scores.json',
  'config/learnloop-weekly.json',
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
  // dropdig (11-03): the next survival fixes after swimcentre-01 (swimunder-01, drop-and-dig-01), measured and reconciled with Codex
  'docs/reports/dropdig-design-2026-11-03.md',
  // leasegen-01 (11-05): the 35k-file town directory's lookup budget, the lease sweep, the per-connection timers
  'bots/test/leasegen.test.mjs',
  // codeeval (11-06): the six-area code evaluation (Claude + Codex) and its synthesis
  'docs/reports/codeeval-2026-11-06/README.md',
  // decbundle-01 (11-06): vetoremedy+repeatwork+depositoffer+#N fix as one canary; registration, draft queue entry, supersede note
  'docs/reports/decbundle-01/decbundle-01.3690e867.json',
  'docs/reports/decbundle-01/decbundle-01.queue-entry.json',
  'docs/reports/decbundle-01/SUPERSEDES.md',
  // phase 1 (11-06): the autopilot and the pager -- tiers/acks/delivery, the page relay, hourly checks, suite-run git context
  'docs/reports/phase1-autopilot-design-2026-11-06.md',
  'scripts/host/pager.py',
  'scripts/host/hourwatch.py',
  'scripts/host/test_pager.py',
  'scripts/host/test_union_merge.py',
  'scripts/host/test_suite_run.py',
  'bots/scripts/test-result.mjs',
  'bots/test/test-result.test.mjs',
  '.gitattributes',
]

t('every load-bearing path exists in the working tree', () => {
  const gone = REQUIRED.filter(p => !existsSync(join(ROOT, p)))
  assert.deepEqual(gone, [], `missing from this tree: ${gone.join(', ')}`)
})

tGit('and every one of them is TRACKED, not sitting untracked on disk', () => {
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

tGit('no untracked files are accumulating in the directories that carry evidence or tooling', () => {
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

tGit('nothing under bots/node_modules is tracked -- not a directory, and not a symlink either', () => {
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

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`)
if (!fail && skipped) console.log(`SKIP (${CTX.why}: ${skipped} git check(s) not run)`)
process.exit(fail ? 1 : skipped ? 77 : 0)
