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
  // sched-v44 (11-13): canary-sched looks three entries ahead, a held entry can be passed; its installer
  'scripts/host/install-sched-v44.sh',
  // voyager-01 (11-06): the creative-bot pilot -- design, the sandbox and its adversarial tests, the proxy, watcher, plugin, units
  'docs/reports/voyager-01-design-2026-11-06.md',
  'docs/reports/effect-audit-2026-11-07.md',
  'docs/reports/queue-plan-2026-11-07.md',
  'docs/reports/parked-work-2026-11-16.md',       // owner 11-16: the parked fleet queue and ledger rows, so nothing is lost
  'voyager/src/sandbox.mjs',
  'voyager/src/facade.mjs',
  'voyager/src/loop.mjs',
  'voyager/src/entry.mjs',
  'voyager/test/sandbox-adversarial.test.mjs',
  // harness 2 (11-12): pins the harness-1 prompts (stages 3, 3b, 4 are compared on them) and drives the real proxy process
  'voyager/test/harness2.test.mjs',
  'voyager/test/proxy-live.test.mjs',
  // the Blackwell guard as it actually ran for 3b (11-10 owner limits); until 11-12 it existed only in a session scratchpad
  'voyager/watch/bw-guard.sh',
  'voyager/watch/blackwell_probe.py',
  'voyager/src/prompts.mjs',
  'voyager/src/library.mjs',
  'voyager/test/host-probe.mjs',
  'voyager/test/cmd-probe.mjs',
  'voyager/proxy/proxy.mjs',
  'voyager/watch/voyager_watch.py',
  'voyager/plugin/src/main/java/ai/mcai/voyager/VoyagerGuard.java',
  'voyager/infra/voyager-bot@.service',
  'voyager/infra/setup.sh',
  'scripts/host/indexsearch2read.py',   // storehub piece C's watch read
  // wholemap-s0 (11-01): the whole-map coverage instrument (seen% / stood% / reach / tiles), its BlueMap route layer + installer
  // phase1 item 4 (11-06): the showcase stops only for harm -- the pre-activation replay gate and the 14-day history replay
  'infra/showcase/replaygate.py',
  'infra/showcase/trip_replay.py',
  'docs/reports/phase1-showcase-design-2026-11-06.md',
  'infra/showcase/wholemap.py',
  'infra/showcase/test_wholemap.py',
  'infra/showcase/install-wholemap.sh',
  // visuals-1105 (11-05): Chunky nightly hero renders (ci2), the skin generator + SkinsRestorer install/apply scripts
  'infra/showcase/visuals/chunky-render-nightly.sh',
  'infra/showcase/visuals/chunky_scenes.py',
  'infra/showcase/visuals/make_skins.py',
  'infra/showcase/visuals/apply-skins.sh',
  'infra/showcase/visuals/restart-sr.sh',
  'infra/showcase/visuals/enable-sr.sh',
  'infra/showcase/visuals/rollback-sr-q.sh',
  'infra/showcase/visuals/livewatch.sh',
  'infra/showcase/visuals/skinprobe.mjs',
  // tlpolish-1106 (11-07): nightly Chunky golden-hour beauty renders on .30 + the tracked live tl.conf
  'infra/showcase/visuals/chunky_beauty.py',
  'infra/showcase/tl_event.py',
  'infra/showcase/tl_extract.py',
  'infra/showcase/test_tl2.py',
  // camdirector-01 (11-16): the waste that stops, the activity director, the scene videos
  'infra/showcase/test_director.py',
  'infra/showcase/tl_director.py',
  'infra/showcase/fixtures/director-pos-20261116.json',
  'infra/showcase/fixtures/plan-director-off-c75a5e51d.json',
  'infra/showcase/tl2/tl2.py',
  'infra/showcase/tl2/tl2trails.py',
  'infra/showcase/tl2/tl2run.py',
  // camunder-01 (11-16): the underground pictures (side cut, roof off, depth trails) + their tests and mutants; not wired
  'infra/showcase/tl_under.py',
  'infra/showcase/tl_region.py',          // the region-file reader `tl_under.py slot` reads its block boxes with
  'infra/showcase/test_tl_under.py',
  'infra/showcase/test_tl_under_mutants.py',
  'infra/showcase/files/nas-sync.sh',
  'infra/showcase/files/showcase-tl-event.service',
  'infra/showcase/files/showcase-tl-event.timer',
  'infra/showcase/files/showcase-tl-under.service',
  'infra/showcase/files/showcase-tl-extract.service',
  'infra/showcase/files/showcase-tl-extract.timer',
  'infra/showcase/visuals/chunky-beauty-nightly.sh',
  'infra/showcase/visuals/test_chunky_beauty.py',
  'infra/showcase/files/tl.conf',
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
  // tidydead-01 (11-05): the tidy's hard cells (a block no stand reaches, a fill no click lands on) are deferred so its waiver names them
  'bots/test/gkstay.test.mjs',   // gkstay-01 (11-07): the keeper lease stays with a holder on the surface (no churn)
  'bots/test/gklease2.test.mjs',   // gklease-02 (11-07): the stale tidy stamp, open sky, the town's sweep give-up
  'bots/src/gkwork.mjs',   // gkwork-01 (11-07): the groundskeeper always has work, or lets the lease go
  'bots/test/gkwork.test.mjs',   // gkwork-01 (11-07)
  'bots/src/stuckfleet.mjs',   // stuckfleet-01 (11-08): road lights, held monument cells and capped cells no remedy reached
  'bots/test/stuckfleet02.test.mjs', 'bots/test/fixtures/stuckfleet02-boardc.json',  // stuckfleet-02 (11-08): a cell orphaned by the waiver below it
  'bots/test/stuckfleet.test.mjs',   // stuckfleet-01 (11-08)
  'bots/test/stuckfleet03.test.mjs',   // stuckfleet-03 (11-10): a sealed foundation cell already holding solid ground is waivable
  'bots/test/gklease.test.mjs',   // gklease-01 (11-06): a grounds lease is held only by a bot that can work the grounds
  'bots/test/tidydead.test.mjs',
  'bots/src/stuckclose.mjs',   // stuckclose-01 (11-08): a tidy stage whose last cuts the town cannot reach closes
  'bots/test/stuckclose.test.mjs',   // stuckclose-01 (11-08)
  'bots/test/cobbleroom.test.mjs',   // cobbleroom-01 (11-09): cobble below the cap with no room to bank it goes down the well
  'bots/test/chestcarry.test.mjs',   // chestcarry-01 (11-09): a carried chest is placed past the 4-a-day new-chest budget
  // stuckproj-01 (11-05): canopy-01 (a tree grown on a build is cut back so a stand sees the cell) + starve-01 (a starved open project gets a builder)
  'bots/src/canopy.mjs',
  'bots/test/stuckproj.test.mjs',
  'bots/test/hivedrop.test.mjs',          // hivedrop-01: the canopy re-plan + loop yields (keepalive), the evictor's end stop
  'bots/test/plankeep.test.mjs',          // hivedrop-02: the walk plan kept across a yield (monument/tidy start interruptions)
  // dirtrung-01 (11-04): the dirt rung is met by a stack of dirt + stone family (gather_dirt_16 held 22.8% of decisions)
  'bots/test/dirtrung.test.mjs',
  // sandrung-01 (11-07): the gatherer chain's sand rung retired (7.5% of fleet time, gather sand 11.7% ok, no sand reached a town)
  'bots/src/sandrung.mjs',
  'bots/test/sandrung.test.mjs',
  // logcap-02 (11-08): the town log gathering cap (owner: logs 60k in town chests, 15,985 banked in a day)
  'bots/src/logcap.mjs',
  'bots/test/logcap2.test.mjs',
  // ironchain-01 (11-09): the ore tunnel aims only at ore gather may take (184 of 246 'tunnelled, still buried' were the town stair's lining)
  'bots/src/ironchain.mjs',
  'bots/test/ironchain.test.mjs',
  'sandbox/ironchain/lining-e2e.mjs',
  // gathermem-01 (11-07): per-bot memory of failed gather targets + same-spot refusal (93.7 bot-h/24 h of same-spot repeats)
  'bots/src/gathermem.mjs',
  'bots/test/gathermem.test.mjs',
  'sandbox/gathermem/gathermem-e2e.mjs',
  // ironchain-02 (11-09): an iron pickaxe asked only for swings, with no iron in the bag, is a stone one (95 of 110 short-ingot crafts)
  'bots/src/pickswings.mjs',
  'bots/test/pickswings.test.mjs',
  // repeatwork-01 (11-04): the repeat window does not refuse a gather whose last run on the rung gained a wanted item
  'bots/src/repeatwork.mjs',
  'bots/test/repeatwork.test.mjs',
  // shaft-02 (10-30): the town stair's converged design (both engines) and its Paper driver
  'docs/reports/mineshaft-2026-10-30/design.md',
  'sandbox/stair/stair-e2e.mjs',
  // dropanddig-01 (11-04): the air pocket is dug STANDING over a floor within 2 (the time-budget drownings)
  // idlework-01 (11-06): the design (the code is on branch idlework-01 until it promotes)
  'docs/reports/idlework-design-2026-11-06.md',
  'docs/reports/scaffold-design-2026-11-07.md',   // scaftown-01 (11-07): who places the scaffold, and the town price
  'docs/reports/roughground-design-2026-11-07.md',   // roughground-01 (11-07): the owner's circled rough ground, mapped + the fix
  'docs/reports/logs-design-2026-11-08.md',   // logcap-02 (11-08): the town log gathering cap; charcoal designed, not built
  'docs/reports/bagfull-design-2026-11-07.md',   // bagfull-01 (11-07): full bags block showcase build orders; the room bank
  'docs/reports/flowers-design-2026-11-07.md',   // flowers-01 (11-07): the flower supply + the border upgrade (code on branch flowers-01show)
  'sandbox/flowers/flower-proof.cjs',   // flowers-01: the Paper proofs (bone meal in taiga, the composter, a fern cell replaced)
  'sandbox/flowers/flower-proof2.cjs',
  'sandbox/flowers/flower-proof3.cjs',   // flowers-02: the lawn density proof
  'docs/reports/woodworks-design-2026-11-08.md',   // woodworks-1108: fences, gates, wooden bridges (code on fences-01show / boardwalk-01show)
  'sandbox/woodworks/fence-proof.cjs',   // fences-01: the Paper ring/walk/gate proof
  'sandbox/woodworks/boardwalk-proof.cjs',   // boardwalk-01: the Paper wooden-bridge proof
  'sandbox/bridges/design-proof.cjs',   // bridges-01: the Paper designed-bridge proof (every style)
  'docs/reports/bridges-design-2026-11-08.md',   // bridges-01: the design, measurements and pictures
  'scripts/host/waterstrays.py',   // boardwalk-03: the genesis evidence of the bots' blocks standing in water (bots/src/waterstrays/*.json)
  'sandbox/woodworks/boardwalk3-proof.cjs',   // boardwalk-03: the Paper walkway-in-place / removal proof
  'docs/reports/boardwalk-03-2026-11-08.md',   // boardwalk-03: the design, the evidence and the pieces
  'docs/reports/tidyrefresh-2026-11-10.md',   // tidyrefresh-1110: the open tidy record re-surveyed hourly + town cut give-up + cap paging (code on tidyrefresh-01show / tidyrefresh-01show-on-bw3)
  'docs/reports/tidyrefresh-2026-11-10/replay-20261110T0152Z.jsonl',   // tidyrefresh-1110: the offline replay on the 11-10 01:52Z showcase copy
  'docs/reports/citywall-design-2026-11-09.md',   // citywall-1109: the wall upgrade + the landmarks (code on citywall-01show / citywall-01-on-bcdba35f)
  'docs/reports/roads-design-2026-11-09.md',   // roads-1109: traffic-routed stone roads + lantern posts (code on roads-01show / roads-01-on-bcdba35f)
  'docs/reports/sinkturn-2026-11-10.md',   // sinkturn-1110: the sinks' own turn, a blocked sink yields, a torch no stand reaches is waived (code on sinkturn-01show-on-citywall)
  'docs/reports/stallfixes-2026-11-10.md',   // tidygrow-1110 / cwstall-1110 / pathsmem-1110 (code on stallfix-01show-on-keeperstall)
  'docs/reports/villagecon-design-2026-11-09.md',   // villagecon-1109: bread for villagers, beds, pens + herd (code on villagefeed-01show / pens-01show / villagefeed-01-on-f9d70a5)
  'docs/reports/villagecon-2026-11-09/codex-design.txt',
  'docs/reports/villagecon-2026-11-09/render.py.txt',
  'docs/reports/villagecon-2026-11-09/render-pens.py.txt',
  'scripts/host/roadtraffic.py',   // roads-01: the traffic report the bots' road siting reads (roadtraffic-<home>.json in the pool dir)
  'sandbox/roads/roads-e2e.mjs',   // roads-01: the Paper road proof (sited, built, server-read, walked)
  'docs/reports/glass-2026-11-08.md',   // glass-1108: sand -> glass -> windows (code on glass-01show / glass-01-on-1e593b9b)
  'sandbox/glass/glass-proof.mjs',   // glass-01: the Paper proof (the bot's own sandDigs / glazeCells)
  'sandbox/glass/glass-proof.jsonl',
  'scripts/host/sandsurvey.py',   // glass-01: the read-only sand survey (region files)
  'docs/reports/market-design-2026-11-06.md',   // market-1106: live villager trading (code on branches market-01show / market-01)
  'docs/reports/market-2026-11-06/codex-design.txt',
  'docs/reports/market-2026-11-06/trade-tables-1.21.8.txt',
  'docs/reports/forest-design-2026-11-06.md',   // forest-1106: the managed forest outside the walls; the in-wall farm retired (code on branches forest-01show / forest-01-on-9e9284d7)
  'docs/reports/forest-2026-11-06/codex-design.txt',
  'docs/reports/gkforever-design-2026-11-06.md',   // gkforever-1106: the grounds never run out (design; the code is on branch gkforever-01)
  'docs/reports/phase2-build-design-2026-11-06.md',   // phase2-build-1106: codeeval phase 2.1/2.2/2.4 (design; the code is on branch buildhole-01)
  'docs/reports/escdead-design-2026-11-06.md',   // escdead-1106: codeeval phase 2.3 escape dead ends (design; the code is on branch escdead-01)
  'docs/reports/stations-design-2026-11-06.md',   // stations-1106: tables and furnaces (design; the code is on branch stations-01)
  // shaftpath-1106: the common mineshaft used and the town paths laid (design + registrations + drafts; code on branches stairuse-01-on-47b8342 / pathsfix-01-on-47b8342)
  'docs/reports/shaftpath-design-2026-11-06.md',
  'docs/reports/shaftpath-2026-11-06/stairuse-01.2a88212b.json',
  'docs/reports/shaftpath-2026-11-06/stairuse-01.queue-entry.draft.json',
  'docs/reports/shaftpath-2026-11-06/pathsfix-01.f733b368.json',
  'docs/reports/shaftpath-2026-11-06/pathsfix-01.queue-entry.draft.json',
  'scripts/host/test_goalwatch_unsited.py',
  'docs/reports/stations-2026-11-06/stations-01.registration.json',
  // treefarm-05 (11-06): the idle towns' farm + hub design and the run's registration (the code is on branch treefarm05-on-4f3b0f5)
  'docs/reports/idletowns-farm-hub-design-2026-11-06.md',
  'docs/reports/treefarm-05/treefarm-05.946c8aaa.json',
  'docs/reports/treefarm-05/treefarm-05.queue-entry.json',
  // workboard-01 (11-08): the town work board, phase A (design + registration + draft entry; code on branches workboard-01 / workboard-01show)
  'docs/reports/workboard-design-2026-11-08.md',
  'docs/reports/pipeline-design-2026-11-09.md',   // pipeline-01 (landscape idea #1): the gap measurement + design
  'docs/reports/workboard-01/workboard-01.fcc3e2c0.json',
  'docs/reports/workboard-01/workboard-01.queue-entry.draft.json',
  // idlework-02 (11-06): bag stop, 29-33 band dispose, depth-aware iron hint (design + registration; code on branch idlework-02-on-9e9284d7)
  'docs/reports/idlework2-design-2026-11-06.md',
  'docs/reports/idlework-02/idlework-02.ed2cc02b.json',
  'docs/reports/idlework-02/idlework-02.queue-entry.draft.json',
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
  // bamboowalk-01 (11-04): the client's bamboo collision post is where the server's is (the board-d wedge)
  'bots/src/bamboowalk.mjs',
  'bots/test/bamboowalk.test.mjs',
  'bots/test/fixtures/bamboowalk-boardd-1103.json',
  // swimcentre-01 (11-03): a rising body is centred under the column it rises through (the y N.2 drownings)
  'bots/src/swimcentre.mjs',
  'bots/test/swimcentre.test.mjs',
  'docs/reports/swimcentre-01-2026-11-03.md',
  // escapeguard-01 (10-31): a trapped bot's escape never digs a build record or a protected zone's structure
  // serving D (owner 11-01): fewer LLM decisions -- pausewait, vetoskip, continue
  'bots/src/fewerdec.mjs',
  'bots/test/fewerdec.test.mjs',
  'bots/src/pipeline.mjs',          // pipeline-01: pipelined decisions (PIPELINE=off|shadow|on)
  'bots/test/pipeline.test.mjs',
  'docs/reports/pipeline-design-2026-11-09.md',
  'bots/src/vetoremedy.mjs',
  'bots/test/vetoremedy.test.mjs',
  // projturn-01 (11-15): the open projects take turns, a no-progress visit backs its project off for the pool, a stuck bot is held
  // off that project only (PROJTURN=off|on)
  'bots/src/projturn.mjs',
  'bots/test/projturn.test.mjs',
  // topdown-01 / landprev-01show (owner 11-15): gather takes ground only from the top; cobblestone before dirt in the escape
  'bots/src/topdown.mjs',
  'bots/test/topdown.test.mjs',
  // cleanzone-01 (11-13): no route places a block in the town or its margin; the valve lets a trapped bot out and writes where
  'bots/src/cleanzone.mjs',
  'bots/test/cleanzone.test.mjs',
  // cleanzone-02 (11-13): gather does not take the ground inside the clean zone; it walks out and searches again
  'bots/test/gatherzone.test.mjs',
  // wellstep-01 (11-13): the junk well's stand is reached again -- the failed walk is tried once more with a pass for that goal
  'bots/test/wellstep.test.mjs',
  // roofclimb-01 (11-14, owner "Yes, fix it"): surface climbs out from under a ground roof above sea level
  'bots/test/roofclimb.test.mjs',
  // zonesite-01show (11-15): a sink never stands in a protected zone -- the siting guard, the builder's click, the retirement
  'bots/test/zonesite.test.mjs',
  // shaft-02 (10-30): the town stair's converged design (both engines) and its Paper driver
  'docs/reports/mineshaft-2026-10-30/design.md',
  'sandbox/stair/stair-e2e.mjs',
  // escapeguard-01 (10-31): a trapped bot's escape never digs a build record or a protected zone's structure
  // serving D (owner 11-01): fewer LLM decisions -- pausewait, vetoskip, continue
  'bots/src/zonewalk.mjs',  // escdead-01show (11-07): an escape under a protected zone walks out under its side
  'bots/test/zonewalk.test.mjs',
  'bots/test/zoneguard.test.mjs',  // zoneguard-01show (11-09): no bot dig or placement changes a cell the tripwire's S4 compares
  'bots/src/fewerdec.mjs',
  'bots/test/gkstay.test.mjs',   // gkstay-01 (11-07): the keeper lease stays with a holder on the surface (no churn)
  'bots/test/gkleft.test.mjs',   // gkleft-01 (11-08): a cell nobody can work is waived by the town
  'bots/test/gkcrewcut.test.mjs',   // gkcrewcut-01 (11-08): helpers dig the tidy's cuts too
  'bots/test/fillshare.test.mjs',   // fillshare-01 (11-09): a helper fills first while the fills are behind the cuts
  'bots/test/gkcrew4.test.mjs',   // gkcrew4-01 (11-08, owner: up to 4 helpers while > 500 open cells)
  'bots/src/planahead.mjs',   // planahead-01 (11-09, owner: plan the town ahead -- plan-time reach, stand claims)
  'bots/test/planahead.test.mjs',   // planahead-01
  'bots/scripts/planahead-offline.mjs',   // planahead-01: the offline check on region copies
  'bots/test/civicvisit.test.mjs',   // civicvisit-01show (11-15): a landmark's visit stands where its siting stood
  'bots/test/steprefusal.test.mjs',   // stepclass-01 (11-15): why a cell has no step, on the deferral row
  'bots/scripts/standreplay-offline.mjs',   // stepclass-01: the stand replay over a block dump (the acceptance check for stuck cells)
  'bots/test/standreplay.test.mjs',   // stepclass-01
  'scripts/host/standprep.py',   // stepclass-01: the replay's input from a pool's stuck files
  'bots/test/gkclear.test.mjs',   // gkclear-01 (11-07): the town's strikes say a tidy stage is closing
  'bots/test/gkroom.test.mjs',   // gkroom-01 (11-07): the keeper refused the forest for room works the tidy
  'bots/src/gkwork.mjs',   // gkwork-01 (11-07): the groundskeeper always has work, or lets the lease go
  'bots/test/gkwork.test.mjs',   // gkwork-01 (11-07)
  'bots/src/roughground.mjs',   // roughground-01 (11-07): the ground the inside-the-wall rules miss + the bots' scaffold taken back
  'bots/test/roughground.test.mjs',   // roughground-01 (11-07)
  'bots/src/regrade.mjs',   // roughground-4 (11-07): the wide-area regrade
  'bots/test/regrade.test.mjs',   // roughground-4 (11-07)
  'sandbox/roughground/rough-proof.mjs',   // roughground-1b/1c/2 (11-07): the Paper proofs
  'bots/src/landmark.mjs',   // roughground-3 (11-07): the town's landmark mound
  'bots/test/landmark.test.mjs',   // roughground-3 (11-07)
  'bots/test/gklease.test.mjs',   // gklease-01 (11-06): a grounds lease is held only by a bot that can work the grounds
  'bots/test/fewerdec.test.mjs',
  'bots/test/standcache.test.mjs',   // standcache-01 (11-12): the visit's kept walk (STANDCACHE=off|on), buildsite.mjs walkAgain
  'bots/scripts/standbench.mjs',     // standcache-01: the measurement (one walk's cost through the bot's block read; walks a tidy visit)
  'bots/src/pipeline.mjs',          // pipeline-01: pipelined decisions (PIPELINE=off|shadow|on)
  'bots/test/pipeline.test.mjs',
  'docs/reports/pipeline-design-2026-11-09.md',
  'bots/src/tempstand.mjs', 'bots/test/tempstand.test.mjs',   // tempstand-01 (11-12): a cell no stand reaches is clicked from a temporary pillar, taken down in the same visit (TEMPSTAND=off|on)
  'bots/test/mineorder.test.mjs',   // mineorder-01 (11-13): no build order to a bot deep in the mine (MINEORDER=off)
  'bots/src/escapeguard.mjs',
  'bots/test/escapeguard.test.mjs',
  // shaft-02 (10-30): the town stair -- its geometry/survey/record and its visit (the Paper driver runs the same code)
  // deepminer-01 (11-01): the town deep miner (the trip, the branch layout, the way back) and its Paper driver
  'bots/src/deepmine.mjs',
  'bots/test/deepmine.test.mjs',
  // townmine-01 (11-09, owner "i want all of those things done"): the town mine -- the stair extended to -53, bays, hall, galleries
  'bots/src/townmine.mjs',
  'bots/test/townmine.test.mjs',
  'bots/scripts/townmine-render.mjs',   // townmine-01: its pictures, drawn from the bots' own plan
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
  // forest-01 (11-06): the managed forest outside the walls, its tests and its Paper proofs
  'bots/src/forest.mjs',
  'bots/test/forest.test.mjs',
  'bots/scripts/forest-offline.mjs',   // forest-02: the forest's siting on copies of a world
  'sandbox/forest/forest-proof.cjs',
  'sandbox/forest/forest-proof2.cjs',
  'sandbox/forest/forest-proof3.cjs',
  'bots/src/storehouse.mjs',
  'bots/test/storehouse.test.mjs',
  // showchat-01 (11-01): the showcase's templated chat announcements (comms stage 2) + the timelapse captions
  'bots/src/showchat.mjs',
  'bots/test/showchat.test.mjs',
  // sortstore-01 (11-01): the sorted storehouse, its labels' Paper proof and the showcase fixture its tests read
  'bots/src/sortstore.mjs',
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
  // bridges-01show (11-08): designed bridges (arch, covered, trestle, footbridge), the traffic sites, the Paper proof, the pictures
  'bots/src/bridgedesign.mjs',
  'bots/test/bridges-design.test.mjs',
  'bots/scripts/bridges-render.mjs',
  'sandbox/bridges/design-proof.cjs',
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
  // storehub-01 pieces A + B (11-04): the sorted hall, its blueprint, its generator, its offline siting, its test, the build notes
  'bots/src/storehub.mjs',
  'bots/src/blueprints/storehub@1.json',
  'docs/reports/storehub-ab-2026-11-04/make_storehub.py',
  'bots/scripts/storehub-offline.mjs',
  'bots/test/storehub.test.mjs',
  // wallext-01 (11-04): the wall extension round the storage hall and its test (the design is main's: docs/reports/wallext-design-2026-11-04.md)
  'bots/test/wallext.test.mjs',
  // cottage2-01 (11-08, owner "charm and uniqueness ... chests and beds"): the generated cottage family, its tests, the Paper proofs and
  // their records, the design note
  'bots/src/cottage2.mjs',
  'bots/test/cottage2.test.mjs',
  'bots/test/cottagepost.test.mjs',
  'bots/test/projfix.test.mjs',
  'bots/src/takeback.mjs', 'bots/test/takeback.test.mjs',
  // litter-01 (11-13): what a walk could not take back is handed to the cleanup crew -- the rules, the sink, and their test
  'bots/src/litter.mjs', 'bots/test/litter.test.mjs',
  // homes-01show (11-13, owner: the approved layout's eight homes as cottage projects): the layout's data, its rules, their test
  'bots/src/townlayout.json', 'bots/src/homeplots.mjs', 'bots/test/homeplots.test.mjs',
  // homes-02show (11-13): the search that resumes, the kept walk, unfinished roads yield -- its test
  'bots/test/homesearch.test.mjs',
  // grounds-01 (11-12, owner "is there a better approach to grounds keeping"): cleanup as ordinary, funded project work -- the pure rules and their test
  'bots/src/grounds2.mjs', 'bots/test/grounds2.test.mjs',
  'sandbox/cottage2/furnish-proof.mjs',
  'sandbox/cottage2/furnish-proof.jsonl',
  'sandbox/cottage2/shear-e2e.mjs',
  'sandbox/cottage2/shear-e2e.jsonl',
  'sandbox/cottage2/paper-cottage2.jsonl',
  'docs/reports/cottage2-design-2026-11-08.md',
  // townstyle-01 (11-04): the style library, the cottage and its blueprints + generator, the renderer, the Paper orientation proof and its
  // record, the test (the design and the tripwire rule are main's)
  'bots/src/townstyle.mjs',
  'bots/src/cottage.mjs',
  'bots/src/blueprints/cottage@1s.json',
  'bots/src/blueprints/cottage@1f.json',
  'bots/scripts/make-cottage.mjs',
  'bots/scripts/render-townstyle.mjs',
  'sandbox/townstyle/orient-proof.mjs',
  'docs/reports/townstyle-2026-11-04/paper-orient.jsonl',
  'bots/test/townstyle.test.mjs',
  'bots/test/townstyle-build.test.mjs',
  'bots/test/townstyle-slab.test.mjs',
  'bots/test/helpers/townstylefake.mjs',
  'sandbox/townstyle/cottage-e2e.mjs',
  'sandbox/townstyle/cottage-skill-e2e.mjs',
  // townstyle-02 (11-05): the re-roofed generations, the town hall, their generator, the Paper build records
  'bots/src/townhall.mjs',
  'bots/src/ordernowait.mjs',   // ordernowait-01 (11-06): the hall and the cottage stop waiting for the workshop
  'bots/test/ordernowait.test.mjs',
  'bots/src/reroof.mjs',
  'bots/test/townstyle-reroof.test.mjs',
  'bots/scripts/make-townstyle.mjs',
  'bots/src/blueprints/workshop@2.json',
  'bots/src/blueprints/hall@2.json',
  'bots/src/blueprints/storehub@2.json',
  'bots/src/blueprints/enchantshop@2.json',
  'bots/src/blueprints/townhall@1.json',
  'docs/reports/townstyle-2026-11-04/paper-townstyle02.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-reroof.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-cottage-skill.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-blind.jsonl',
  'docs/reports/townstyle-2026-11-04/paper-cottage.jsonl',
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
  // stepwell-01 (11-05, owner "Yes"): the town stepwell -- the landmark tank and the miners' shared descent (design on main)
  'bots/src/stepwell.mjs',
  'bots/src/stepwellvisit.mjs',
  'bots/scripts/stepwell-offline.mjs',
  'bots/scripts/stepwell-landmap.mjs',
  'bots/test/stepwell.test.mjs',
  // townmine-01 (11-09, owner "i want all of those things done"): the town mine -- the stair extended to -53, bays, hall, galleries
  'bots/src/townmine.mjs',
  'bots/test/townmine.test.mjs',
  'bots/test/fixtures/townmine-showcase-1109.json',   // townmine-01: the showcase stair + stepwell records the no-overlap test reads
  'bots/scripts/townmine-render.mjs',   // townmine-01: its pictures, drawn from the bots' own plan
  'sandbox/stepwell/stepwell-e2e.mjs',  // stepwell-01: its Paper driver
  'bots/test/plotprep03.test.mjs',
  'bots/test/levelfall.test.mjs',
  'bots/test/gkmarker.test.mjs',
  'bots/test/claim.test.mjs',  // claim-01 (11-08): a sited town hall / cottage owns its volume; the tidy yields it
  'bots/test/thprep.test.mjs',  // thprep-01 (11-08): the town hall's volume (leaves, slope within its cut) and the built reach
  'bots/test/reroof4.test.mjs', 'bots/test/fixtures/reroof4-hall-1108.json', 'sandbox/townstyle/reroof4-e2e.mjs',  // reroof-04 (11-08): roof access -- slab floors, door-side eave notch, a temporary stair torn down
  'bots/src/citywall.mjs', 'bots/test/citywall.test.mjs', 'bots/scripts/citywall-offline.mjs', 'sandbox/citywall/wall-e2e.mjs',  // citywall-01 (11-09): the wall upgrade -- courses swapped in place, towers, a gatehouse, lamps
  'bots/src/civic.mjs', 'bots/test/civic.test.mjs', 'bots/scripts/civic-offline.mjs', 'bots/scripts/render-civic.mjs', 'bots/scripts/civic-render.mjs', 'sandbox/civic/civic-e2e.mjs',  // civic-01 (11-09): the landmarks catalogue
  'docs/reports/citywall-design-2026-11-09.md',  // citywall-01 + civic-01 (11-09): the design, the pictures, the Paper proofs
  'bots/test/reroof3.test.mjs',  // reroof-03 (11-08): roof trees and floating remains dug; digs reached from the new roof's own cells
  'bots/src/sitecanopy.mjs', 'bots/test/sitecanopy.test.mjs',  // sitecanopy-01 (11-08): a styled building's site lists the natural leaves in its own cells
  'bots/src/leaffell.mjs', 'bots/test/leaffell.test.mjs',  // leaffell-01show (11-12): an unreached natural leaf asks for its trunk, not a stand
  'bots/test/leaffell-res.test.mjs',  // leaffell-01show r2: the trunk guard's reservations are read strictly (absent is not unreadable)
  'bots/src/fellcanopy.mjs', 'bots/test/fellcanopy.test.mjs',  // fellcanopy-01 (11-08): a felling log no stand sees gets its natural canopy listed
  'bots/src/felldone.mjs', 'bots/test/felldone.test.mjs',  // felldone-01 (11-15): a felling stair whose tree is gone is done (FELLDONE=off|on)
  'bots/src/sealedcore.mjs', 'bots/test/sealedcore.test.mjs',  // sealedcore-01 (11-15): a monument core cell sealed inside its own finished body is waived (SEALEDCORE=off|on)
  'bots/test/fellfirst.test.mjs',  // fellfirst-01 (11-06): a tree with no sapling of its kind anywhere is felled first  // gkmarker-01 (11-06): the groundskeeper never plans a cut on an expedition marker  // levelfall-01 + stationzone-01 (11-05): the workshop's floor fallback; no village station
  'bots/test/fixtures/levelfall-x1-1105.json',  // plotprep-03 (11-05): a plot's trees fall once their own saplings are settled
  'bots/test/stepwell03.test.mjs',  // stepwell-03 (11-05): the siting reaches its site (reservations first, the wall's gap)
  'bots/src/bagroom.mjs',  // bagroom-01 (11-06): the build's room -- the well's band dispose, the share bank
  'bots/test/bagroom.test.mjs',
  'bots/src/handcap.mjs',  // handcap-01 (11-06): a shaft cap the bare hand breaks is a climb, not a pickaxe ask
  'bots/test/handcap.test.mjs',
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
  'bots/test/sinkwaive.test.mjs',   // sinkwaive-01 (11-06): the stone sinks' stuck-cell waiver (the tower's crown 43,78,-11)
  // sinkturn-01show (11-10): the sinks' own turn after 4 finite visits, a blocked sink yields, a torch no stand reaches is waived
  'bots/test/sinkturn.test.mjs',
  'docs/reports/sinkturn-2026-11-10.md',
  // tidygrow-01show (11-10): one tidy refresh is one record generation (the claim retirement rides in it)
  'bots/test/tidygrow.test.mjs',
  // fillcolumn-01 (11-15): no tidy fill planned in mid-air -- the refresh extends a dug-out column or leaves it out (FILLCOLUMN=off|on)
  'bots/src/fillcolumn.mjs', 'bots/test/fillcolumn.test.mjs',
  'bots/src/waiveroom.mjs',   // fillcolumn-01 r2: the stuck waiver's room, counted apart from the column repair's omissions
  'bots/test/fillcolumn-inputs.test.mjs',   // fillcolumn-01 r5: the keep-out's readers and zone builders name what they leave out (one path, one report)
  // cwstall-01show (11-10): the citywall design visit breathes; the escape proof's walks are sliced
  'bots/test/cwstall.test.mjs',
  'bots/scripts/citywall-stall-offline.mjs',
  // pathsmem-01show (11-10): the paths extension's clock and unrouted waits outlive a reconnect
  'bots/test/pathsmem.test.mjs',
  'docs/reports/stallfixes-2026-11-10.md',
  'bots/src/prodserve.mjs',   // prodserve-01 (11-06): finished production projects served on their own schedule
  'bots/test/prodserve.test.mjs',   // prodserve-01 (11-06): the service tier, the stamps, the dress host-gone waiver
  'bots/test/stepwell05.test.mjs',   // stepwell-05 (11-06): the tank's crew (two builders by sector once the felling is done)
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
  'bots/test/plotledgerfold.test.mjs',   // the plotprep + access-02 fold: no ledger stair across a reserved plot
  // atlas-01 (11-04): the bots' shared exploration map
  'bots/src/atlas.mjs',
  'bots/test/atlas.test.mjs',
  'bots/test/decorholdfold.test.mjs',   // the atlas+decorator fold: the decorator keeps off the demolition's hold
  'bots/test/cutterfold.test.mjs',   // the batch fold: the stonecutter keeps off the town's reservations
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
  // decorator-01 (11-04): the decorator (the `decor` sink: flower borders, door pots, the bone-meal nursery), its offline siting and its test
  'bots/src/decorator.mjs',
  'bots/scripts/decor-offline.mjs',
  'bots/test/decorator.test.mjs',
  // flowers-01 (11-07): the flower supply + the border upgrade, its test and its Paper proofs
  'bots/test/flowers.test.mjs',
  'sandbox/flowers/flower-proof.cjs',
  'sandbox/flowers/flower-proof2.cjs',
  'sandbox/flowers/flower-proof3.cjs',   // flowers-02: the lawn density proof
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
  // obsidian-01 (11-07, owner "Both at once"): the cast's whole-bot Paper driver, its registration and draft queue entry
  'sandbox/enchant/obsidian-e2e.mjs',
  'docs/reports/obsidian-2026-11-04/obsidian-01.c5a33c08.json',
  'docs/reports/obsidian-2026-11-04/obsidian-01.entry.draft.json',
  // copperhall-01 (11-02): the showcase copper hall, its blueprint and its test over the showcase terrace's own region export
  'bots/src/copperhall.mjs',
  'bots/src/blueprints/hall@1.json',
  'bots/test/copperhall.test.mjs',
  // copperrun-01 (11-03): the waiting hall's bill drives a copper gather (copperhall.mjs copperRunOrder; shop.mjs buildOrder's ask)
  'bots/test/copperrun.test.mjs',
  'bots/test/fixtures/copperhall-01-terrain-20261102.json',
  'bots/src/handcap.mjs',  // handcap-01 (11-06): a shaft cap the bare hand breaks is a climb, not a pickaxe ask
  'bots/test/handcap.test.mjs',
  'bots/src/escdead.mjs',  // escdead-01 (11-06): the wide swim, the flood-in breach, the pin clock (phase 2.3)
  'bots/test/escdead.test.mjs',
  'bots/test/escpocket.test.mjs',
  'bots/test/seapocket.test.mjs',
  'bots/test/fixtures/seapocket-placebo-d-46_59_69-1109.json',
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
  // g3-standing (11-01): the tripwire's G3 judges the bots' LATEST audits; the storehouse-01 false trip's real rows and geometry
  'infra/showcase/test_trip_g3_standing.py',
  'infra/showcase/fixtures/g3-storehouse-01-20261101.jsonl',
  'bots/test/townplan-storehouse-geometry.test.mjs',
  'bots/test/fixtures/storehouse-01-mirror-20261101.json',
  // coverdig-01 (11-05): the copper hall's pad base sealed by a waiting segment's grass -- the cover dug, the segment read again
  'bots/test/coverdig.test.mjs',
  'bots/test/fixtures/coverdig-hall-1105.json',
  // fleetpaths-01 (11-01): a destination inside the plaza is served by it; a fleet town's unroutable paths write a no-site record
  'bots/test/fleetpaths.test.mjs',
  // zigbamboo (fleetbuild-01, 11-01): bamboo grown into open ziggurat foundation cells is dug
  'bots/test/zigbamboo.test.mjs',
  // tidy-01 (11-01): the town-ground tidy (pillars, pits, the paths' corridors graded) and its offline proof on region copies
  'bots/test/loggate.test.mjs',   // loggate-01 (11-12): the town log limit refuses at admission
  'bots/src/tidy.mjs',
  'bots/test/tidy.test.mjs',
  // groundskeeper-01 (owner 11-02, groundskeeper-1102): the land plan, the keeper lease, the offline proof
  'bots/src/landplan.mjs',
  'bots/src/groundskeeper.mjs',
  'bots/test/groundskeeper.test.mjs',
  'bots/scripts/landplan-offline.mjs',
  // gkforever-01 (owner 11-06): the grounds never run out (clock, dead carry, level, crew, the grounds lap)
  'bots/src/gkforever.mjs',
  'bots/src/roughground.mjs',   // roughground-01 (11-07)
  'bots/test/roughground.test.mjs',   // roughground-01 (11-07)
  'bots/src/regrade.mjs',   // roughground-4 (11-07): the wide-area regrade
  'bots/test/regrade.test.mjs',   // roughground-4 (11-07)
  'bots/test/gkforever.test.mjs',
  'bots/test/chestcarry.test.mjs',   // chestcarry-01 (11-09): a carried chest is placed past the 4-a-day new-chest budget
  'docs/reports/gkforever-design-2026-11-06.md',
  // stations-01 (owner 11-06): the town's tables and furnaces (take-back, the groundskeepers' sweep, town stations, chest first, spare fuel)
  // toolrank-01 (11-09, owner-approved): no lower-tier tool beside a working better one (other tools + the pickaxe pair)
  'bots/test/toolrank.test.mjs',
  'bots/src/stations.mjs',
  'bots/test/stations.test.mjs',
  // stationsback-01 (11-09): a dug station reaches the bag (the drop chased over time, a reflex-cancelled dig retried once)
  'bots/src/stationsback.mjs',
  'bots/test/stationsback.test.mjs',
  'docs/reports/stations-design-2026-11-06.md',
  'docs/reports/stations-2026-11-06/codex-design.txt',
  'docs/reports/stations-2026-11-06/scan.py',
  'docs/reports/stations-2026-11-06/m1.py',
  // phase 2 (codeeval 11-06): buildretry-01 the build retry hole; buildnext-01 never idle on a blocked project; buildwait-01 the engine's intended waits
  'bots/src/buildretry.mjs',
  'bots/test/buildretry.test.mjs',
  'bots/test/buildnext.test.mjs',
  'bots/test/buildwait.test.mjs',
  // one trunk (11-16): the two visit switches that default by pool (BUILDRETRY, VISIT_WAIVER)
  'bots/test/visitswitch.test.mjs',
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
  'docs/reports/groundskeeper-2026-11-02.md',
  'bots/scripts/tidy-offline.mjs',
  // townterrace-01 (owner 11-03, townterrace-1103): the terrace stage, the park, its offline proof and its report
  'bots/src/terrace.mjs',
  'bots/src/park.mjs',
  'bots/test/terrace.test.mjs',
  'bots/test/gkhelpers.test.mjs',   // gkhelpers-01: the grounds crew, the storehouse floor, the park gather
  'bots/test/plotprep.test.mjs',   // plotprep-01: the extension's plots readied (trees felled from a stand, replanted, levelled)
  'bots/test/access.test.mjs',   // access-01: proper stairs where bots climbed (groundskeeper piece 3)
  'bots/test/fixtures/gkstage-tidy-g20-20261104.json',   // gkstage-01: the LIVE tidy record the floor-only stall ran on
  'bots/scripts/inwall-offline.mjs',   // gkstage-01: the inside-the-wall stage on region copies
  // placeaudit-01 (owner 11-04 groundskeeper piece 2): who places blocks in town, why, where
  'bots/src/placeaudit.mjs',
  'bots/test/placeaudit.test.mjs',
  'bots/test/gkunblock.test.mjs',   // gkunblock-01: a tidy segment held by snow (or any block it may not dig) never ends every crew visit
  // gksweep-01 (owner 11-04 groundskeeper piece 6): the keeper picks up what lies inside the walls
  'bots/src/gksweep.mjs',
  'bots/test/gksweep.test.mjs',
  'bots/test/outbands.test.mjs',   // outbands-01: the groundskeeper outside the walls, band by band (piece 5)
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
  // STATE is generated (11-02, Codex ops audit HIGH 1): the generator, its tests and the Mac relay that commits it
  'scripts/host/stategen.py',
  'scripts/host/test_stategen.py',
  // the owner's status report 4x a day (11-06) and the dashboard it is served from (live since 11-04)
  'scripts/host/statusreport.py',
  'scripts/host/test_statusreport.py',
  'scripts/host/install-statusreport.sh',
  'scripts/host/headline.py',
  'scripts/host/test_headline.py',
  'scripts/host/finishline.py',
  'scripts/host/test_finishline.py',
  'docs/reports/finish-line-2026-11-09.md',
  'infra/dashboard/agent/mcai-dash-agent.py',
  'infra/dashboard/test_dash_agent.py',
  'infra/dashboard/build_dashboards.py',
  'infra/dashboard/deploy.sh',
  'infra/dashboard/stack/nginx/default.conf',
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
  'scripts/host/install-sched-v43.sh',   // v43 (11-12): path-list context, two more skippable blocks, the effectfix-01 hook
  'scripts/host/autorebase-relay.sh',
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
  'sandbox/trading/market-proof.cjs',   // market-1106: the 1.21.8 trade tables, trader, restock, claim reach, breeding (sandbox4 11-06)
  'sandbox/trading/unlock-e2e.mjs',
  'infra/showcase/test_trip_unlock_mutants.py',
  'sandbox/trading/coalsale-e2e.mjs',
  'sandbox/trading/jobsite-e2e.mjs',
  'scripts/mac/opsaudit.sh',
  // cooldown15-01 (11-01): the decision cooldown cap (30 s env -> 15 s) and its one-number rollback
  'bots/test/cooldown-cap.test.mjs',
  // pause30-01 (11-04): the runner failure pause 120 s -> 30 s default and its one-number rollback
  'bots/test/pause-recovery.test.mjs',
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
  // stopwatch (11-14, owner "clean up this test, implement, stage, queue, fix loop"): what worked yesterday and does not work now
  // soakgate (11-14): the release tool's own tests run from npm test
  'bots/test/showcase-ops.test.mjs',
  // routewatch (11-14): can the bots still walk to the town's services -- the real A* over the saved ground, hourly
  'scripts/host/routewatch.py',
  'scripts/host/routereplay.mjs',
  'scripts/host/regiondump.py',
  'scripts/host/test_routewatch.py',
  'bots/test/routewatch.test.mjs',
  'scripts/host/stopwatch.py',
  'scripts/host/test_stopwatch.py',
  'bots/test/stopwatch.test.mjs',
  // brainwatch (11-14): the model-dark alarm -- the bots run but no model answers
  'scripts/host/brainwatch.py',
  'scripts/host/test_brainwatch.py',
  'bots/test/brainwatch.test.mjs',
  // fresh-world rehearsal (11-14, owner "Yes, start both"): the run manifest -- world, code, roster, rules, daily card, open questions
  'infra/freshworld/rehearsal-0.json',
  'infra/freshworld/rehearsal-0.town-site.json',
  'infra/freshworld/setup-rehearsal.sh',
  'infra/freshworld/make_rehearsal_env.py',
  'infra/freshworld/files/rehearsal-paper.service',
  'infra/freshworld/files/rhbot@.service',
  'scripts/host/rehearsalcard.py',
  'scripts/host/test_rehearsalcard.py',
  'bots/test/rehearsalcard.test.mjs',
  'scripts/host/test_pager.py',
  'scripts/host/test_union_merge.py',
  'scripts/host/test_suite_run.py',
  'bots/scripts/test-result.mjs',
  'bots/test/test-result.test.mjs',
  '.gitattributes',
  'scripts/host/autorebase-suite-relay.py',
  // projectaudit (11-06, OWNER: "check if projects are effective and useful"): the registry, the daily audit, its tests
  'docs/reports/projectaudit-design-2026-11-06.md',
  'config/projectaudit-registry.json',
  'scripts/host/projectaudit.py',
  'scripts/host/test_projectaudit.py',
  // freshworld (11-06, OWNER: plan fresh worlds, keep the current one): the playbook design, Codex's design, the measurements
  'docs/reports/freshworld-playbook-design-2026-11-06.md',
  'docs/reports/freshworld-playbook-2026-11-06/codex-design.txt',
  'docs/reports/freshworld-playbook-2026-11-06/measure.py.txt',
  // planahead-01 (11-09, owner: plan the town ahead): the design, both engines' designs, the offline numbers and the map
  'docs/reports/planahead-design-2026-11-09.md',
  'docs/reports/planahead-2026-11-09/codex-design.txt',
  'docs/reports/planahead-2026-11-09/claude-design.md',
  'docs/reports/planahead-2026-11-09/offline-reach.json',
  'docs/reports/planahead-2026-11-09/tidy-stage-reach.png',
  // country-01 + upkeep-01 (11-09): the countryside lane + the upkeep crew (design, pictures, measures, the fleet registration and draft
  // entry, the Paper proof; code on branches countryside-01show / upkeep-01-on-bcdba35f; the tripwire's CO1 + UK1 in shopread.py.txt)
  'docs/reports/country-design-2026-11-09.md',
  'docs/reports/country-design-2026-11-09/country-sheet.png',
  'docs/reports/country-design-2026-11-09/country-upkeep.png',
  'docs/reports/country-design-2026-11-09/fleet-hive-a-upkeep.png',
  'docs/reports/country-design-2026-11-09/country-run.mjs',
  'docs/reports/country-design-2026-11-09/upkeep-fleet.mjs',
  'docs/reports/country-design-2026-11-09/upkeep-01/upkeep-01.35215b53.json',
  'docs/reports/country-design-2026-11-09/upkeep-01/upkeep-01.queue-entry.draft.json',
  'sandbox/country/country-proof.cjs',
  'sandbox/country/country-proof.jsonl',
  // pinned draw (11-06): draw_pin_pools + draw_pin_owner_ok, honoured in fun mode (escdead-01, treefarm-05)
  'scripts/drawpin.py',
  'scripts/test_drawpin.py',
  // depositoffer-01 (11-04): deposit leaves the per-call skill enum when the gate would refuse it; the deposit rung's floor
  'bots/src/depositoffer.mjs',
  'bots/test/depositoffer.test.mjs',
  'bots/src/planahead.mjs',   // planahead-01 (11-09, owner: plan the town ahead -- plan-time reach, stand claims)
  'bots/test/planahead.test.mjs',   // planahead-01
  'bots/scripts/planahead-offline.mjs',   // planahead-01: the offline check on region copies
  'docs/decisions/consolidation-2026-11-14.md',   // owner 11-14: the consolidation plan of record (two worlds, 5080 + 3090 only, steps C0-C5)
  'infra/capsule/README-capsule-20261114T1550Z.md',   // owner 11-14: the showcase time capsule's restore notes (the archive is on the NAS)
  'infra/capsule/scorecard/pitmap.py',   // time capsule: the pit and hollow measure, paths by CAPSULE_REGION / CAPSULE_POOL
  'infra/capsule/scorecard/projects.py',   // time capsule: one row per town project
  'infra/capsule/scorecard/pitmap-baseline.txt',   // time capsule: baseline of 2026-11-14T15:50:17Z
  'infra/capsule/scorecard/projects-baseline.json',
  'scripts/host/groundledger.py',   // owner 11-14, step N1: what was done to a world's ground since it was untouched, column by column
  'scripts/host/test_groundledger.py',
  'bots/test/groundledger.test.mjs',
  'docs/reports/land-eval-2026-11-14/ledger-first-run.md',
  'scripts/host/groundplan.py',   // owner 11-15, step N3 (offline half): the ledger's damage turned into fill, cut and pick-up jobs under the dirt-cap rule
  'scripts/host/test_groundplan.py',
  'bots/test/groundplan.test.mjs',
  'docs/reports/land-eval-2026-11-14/plan-first-run.md',
  'docs/reports/land-eval-2026-11-14/stair-spots.md',   // owner 11-15 (stairs, not junk dirt piles): where the showcase bots keep climbing and escaping
  'docs/reports/land-eval-2026-11-14/showcase-whole-map.md',   // owner 11-15: the showcase's ground listed over the whole map
  'docs/reports/land-eval-2026-11-14/dirt-loop.md',   // why the bots hollow out the ground, what the 11-13 rule moved, what would stop it
  'docs/reports/land-eval-2026-11-14/RECOMMENDATION.md',   // owner 11-14: keep / restructure / start fresh for the land cleanup code: both engines say restructure around a new core
  'docs/reports/land-eval-2026-11-14/QUESTION.md',   // the brief both evaluators got
  'docs/reports/land-eval-2026-11-14/evidence.md',   // the evidence pack both evaluators got
  'docs/reports/land-eval-2026-11-14/claude-eval.md',
  'docs/reports/land-eval-2026-11-14/codex-eval.md',
  'infra/freshworld/worldrec.sh',   // owner 11-14: read-only copy of a world's region files every 15 minutes (rehearsal-0 recorder)
  'docs/reports/camera-design-2026-11-14.md',   // owner 11-14: cameras from a world's first moment, project cameras that stop, isometric + 4K (design, not built)
  // bucketfix-01 (11-04): the bucket's aims as Vec3 (every pour and scoop threw point.minus on mineflayer 4.37)
  'bots/test/bucket-aim.test.mjs',
  // obsidian-01 (11-07): the deep miner's cast (a basin, one bucket in turn, the lake's lava, the diamond pickaxe)
  'bots/test/obsidian.test.mjs',
  // showdrop-01show (11-08): one listing a stretch, the order primer, the pool prune; the evictor's end stop
  'bots/test/showdrop.test.mjs',
  // keeperstall-01show (11-10): the visit breathes, an ended connection aborts it, the keeper's clocks and give-ups outlive a reconnect
  'bots/src/procmem.mjs',
  'bots/test/keeperstall.test.mjs',
  'docs/reports/keeperstall-2026-11-10.md',
  // reccache-01show (11-10): recordHead keeps per-file facts of the generations it has read; the walk is made again every call
  'bots/test/reccache.test.mjs',
  // spentpick-01show (11-16): a placement never clicks a block that opens (Frost's table); the rebuild rule is in craftroom.mjs
  'bots/src/placeref.mjs',
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
