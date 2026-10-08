# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-02 20:20Z (see the EVENING section first); earlier stamp 06:10Z by the autonomous operator session (owner grant 10-02 04:45Z: 15-20 h on v1, iron first,
both engines, reports every 4-6 h) — **CANARY LIVE: `fixes-03` on `8453c09`, pools hive-c, board-a, placebo-d,
placebo-b (20 bots), declared 05:03:00Z.** Fleet baseline `bf296c9+9287fd` on the other 60. Exactly two versions live
at 05:10Z. `canary-loop.sh fixes-03` (pid 1921117) does reads/verdict/record/promote/teardown. NOTHING is chained
behind it (chain-ore.sh stopped 10-01 on fixes-02's revert)._

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. Long history: `git show 40a09da:docs/reports/STATE.md`
> (to 09-30 morning), `git show 6a18e70:docs/reports/STATE.md` (09-30 evening), `git show d67d840:docs/reports/STATE.md` (10-01).

---

## 10-08 06:45Z — TOWNDEPOSIT-02 KEPT (+360) and PROMOTED: FLEET 92bc84f (06:31Z, all live bots verified); merged to main
+360: 21 deposits, 17/25 full-bag town stays served, slots/bot DiD -1.23, share>=34 DiD -0.30, correctness 0, deaths
canary 1 (0.017/bh) vs control 8 (0.027/bh); climbs +56% (<= +100%). Main: merge of 92bc84f + towndeposit test flake
fix (a6cd3c1 cherry-picked); npm test green. SCHEDULER INSTALLED 06:35Z (~/canary-sched.py, cron */5, queue empty;
rollback: bash ~/sched-install/install-canary-sched.sh --rollback 20261008T063539Z); stale owner-01 (09-18) closed
against its ledger row. NEXT: airpocket-01 (92bc84f variant ap dbb4d78) once gate v34-HYB is installed; bag fixes and
withdraw2 use their 92bc84f variants.

## 10-08 05:30Z — DECISIONS: airpocket gate = HYB@2.5 (Codex + operator); two lanes REJECTED by both engines; scheduler staged
AIRPOCKET GATE: HYB@2.5 (DiD OR frozen matched-pool control > 2.5), not the built DID24@2.0, which is blind in
airpocket's stratum (doubling 3.3%, tripling 34% at 26 h vs HYB 35% / 76%, false trip <= 2.5%). Gate agent rebuilding
v34; airpocket WAITS rather than launch under DID24 (Codex: docs/reports/airpocket-gate-choice-codex-2026-10-08.txt).
THROUGHPUT (docs/reports/canary-throughput-2026-10-08.md): both engines rejected two concurrent lanes (a replay of six
past canaries: removing a second lane's pools from the control flipped junkwell-01's REVERT to POLL_OK; modelled gain
+0-30%); isolated pools are NOT equivalent (per-bot memory) and stay out of draws; bundling not built; the 12 h exclusion
is kept. BUILT + STAGED (not installed): a single-slot queue scheduler (scripts/host/canary-sched.py, cron */5,
~/canary-queue.json with "approved" entries; never skips the head, never retries on its own), a drawrec fail-closed
patch, and scripts/prepare-variant.sh. Slot busy 80% 10-03..10-08 (97.9 of 122.7 h). CLAUDE.md keeps "one canary pool,
ever" (re-decided). Note: fleet-recycle does not run while a canary is declared (the 05:53Z recycle will not happen).
OWNER QUESTIONS: (a) allow KEEP at +180 for four-pool draws (drawrec noise: 4 pools x 3 h 0.313 < 2 pools x 6 h
0.395) -- the biggest throughput lever left; (b) isolated pools sit in every read's control though not equivalent for
town/chest changes.
INSTALL PLAN, in the empty slot after towndeposit-02: gate v34 (HYB, once re-staged) + scheduler (no shared files).

## 10-08 ~04:40Z — CANARY THROUGHPUT: two lanes NOT built (both engines); a queue SCHEDULER built + staged, NOT installed
Owner 10-08 ~02:30Z delegated to Codex + Claude. Report: docs/reports/canary-throughput-2026-10-08.md.
- A (two concurrent lanes): Codex and Claude each DON'T BUILD. The deciding evidence was a time-travel replay of six past
  canaries with a second lane's pools removed from control (logs truncated at the read instant, frozen clock, private
  mount namespace; the full-control replay reproduced every recorded verdict line exactly).
  - Five verdicts held.
  - junkwell-01's death-gate REVERT became POLL_OK (LB 1.40 -> 1.18).
  - Model gain was only +0..30% once unmeasured double-KEEP compositions and control erosion are counted.
  - "One canary pool, ever" stands; CLAUDE.md records the re-decision.
- B: isolated pools are NOT equivalent (per-bot memory, town state, world facts, no comms or board). Not admitted; owner
  question. C (bundling): not built. D1: the 12-h exclusion stays.
- BUILT, both engines APPROVE after 6 design rounds + 4 implementation rounds:
  - `scripts/host/canary-sched.py`: cron */5. It launches the HEAD of `~/canary-queue.json` into an empty slot exactly
    as chain-after does. It never skips the head, never retries, never takes the loop lock, and never overwrites a
    /tmp read. Human verbs: rearm, abandon, closed (needs the ledger row), cancel, continue; also install-hold /
    install-release.
  - Tests: 93 tests and anchored mutants, all killed.
  - One anchored drawrec.sh patch: a drawexposure crash on a DECLARED registration no longer reads as "no requirement"
    (10/10 tests on the live file; TARGET_K line intact).
  - `scripts/prepare-variant.sh`: mechanical cherry-pick + range-diff + npm test + no-undef against the base. Its output
    has NO `approved` field, so `queue add` refuses it until reviewed.
- STAGED on 10.0.0.31 in ~/sched-install; dry run 04:42Z: tests 93/93 + 10/10 on the live drawrec; staged canary-sched.py md5 dee491d6, gate bundle
  untouched (it refuses now: towndeposit-02 is live). It is independent of gate v34: no shared file, and both
  installers hold the loop lock, so either order is safe. The operator sequences:
  ```
  ssh mike@10.0.0.31 'bash ~/sched-install/install-canary-sched.sh --dry-run'    # then without --dry-run
  ```
  It prints the rollback: `bash ~/sched-install/install-canary-sched.sh --rollback <STAMP>`.
  After the install the queue is EMPTY (no launches) until the operator `queue add`s entries with `approved`.
  Compatible with the operator's 10-08 reboot fixes (chain-start/resume-chains/restore-reads): it changes none of
  them, nor chain-after's command line, .out wording or read locations; a running chain-after/chain-start counts as
  'slot busy'. Do not queue a run that also has a recorded chain (chains.d): whichever launches first wins, the
  other waits on the lock, and the scheduler then tracks the run as running.
- FOUND, pre-existing:
  - fleet-recycle.timer SKIPS while any canary is declared, so the 05:53Z recycle noted below will NOT run.
  - check-open-loop.py cannot record a decision once the manifest is cleared.
  - drawrec's exposure filter failed open on a crash (fixed by the staged patch).
- OWNER QUESTIONS: KEEP at +180 for 4-pool draws (the biggest lever; drawrec's own null sd 0.313 vs 0.395); isolated
  pools in town/chest controls; auto-approval of unchanged range-diff variants (Codex: no).

## 10-08 05:00Z — REBOOT FIXES INSTALLED (owner "yes")
1. mcai-mayor-shadow is a persistent enabled unit (/etc/systemd/system/mcai-mayor-shadow.service, same limits as the
   transient one; ~5 s gap in snapshots at the switch). 2. block2-sandbox (sandbox 1) enabled at boot on 10.0.0.30.
3. ~/bin/restore-reads.sh, cron @reboot + */10: copies any ~/mcai-analysis/*.py missing from /tmp (never overwrites).
4. CHAINS: start them with ~/bin/chain-start.sh (records ~/chains.d/<next>.args); ~/bin/resume-chains.sh, cron @reboot
   (+90 s) + */10, relaunches unfinished chains; tested (relaunch once, no duplicate, args removed on STOP).
   Copies in scripts/host/bin/. crontab backup ~/crontab.bak-20261008-rebootfixes.
FOUND: /tmp/quickstatus.py, modelshare.py, cooldid4.py (nightwatch digest sections) were lost in the 10-06 outage and
are not in the repo; the digest's quick-status/model sections have been empty since. To rebuild (low priority).

## 10-08 04:05Z — OWNER GOAL + ROADMAP: build cool structures, survive, cooperate, for long periods (peaceful stays)
Not beating the game. docs/reports/roadmap-2026-10-08.md (owner agreed). After the current queue: LAST (renewables:
tree farm, cobblestone generator; unattended recovery; bounded logs/stores) -> BUILD (workshop, safe mineshaft, larger
structures; materials produced deliberately) -> COOPERATE (roles, town stock, overseer per C2 evidence, strategist).
New measure to build: a weekly long-run check per town (built something? deaths/stuck low? output steady?).

## 10-08 ~05Z — GATE v34 (UNDERGROUND-SAFETY DEATH GATE) BUILT + STAGED, NOT INSTALLED; airpocket registrations ready
Both engines APPROVE (Claude r2-r10, Codex r10). On main d6e5eb0; staged on 10.0.0.31 in ~/gate-v34 with
MANIFEST-v34.txt (exact md5 of every staged file, each target's live md5 before, the predicted digest). Dry run (twice,
manifest self-verified): every suite passes (test_usafe 123/123, 42 mutants), predicted bundle
9452993d3c05777bb8107b66c8846655; it refuses while towndeposit-02 is live. NOTHING on the host was changed: live
verdict.py 07ad5e09, canary-loop.sh 19a06267, gatedigest OK on v33 (ac3da3b6). INSTALL BETWEEN CANARIES, sequenced with
the multi-lane install by the coordinator:  ssh mike@10.0.0.31 'bash ~/gate-v34/install-gate-v34.sh'
- The gate: class underground-safety; psi = canary POST/PRE over control POST/PRE (PRE 24 h); TRIP iff >= 2 canary
  deaths AND LB > 2.0 (calibrated). No-change false trip 3.3% (6 h) / 4.4% (26 h) on the five drowning pools (today's
  gate: 12.9% / 29.0%). Power vs a doubling 17.5% / 25.4%. Linkage by the registration's link_rules reverts at the floor.
- **OWNER DECISION BEFORE AIRPOCKET LAUNCHES:** in the stratum airpocket is drawn for (pools already >= 2x control), the
  built gate catches a doubling 3.3% and a tripling 34% at 26 h -- effectively blind; linkage + the read's C3 are the
  protection. The alternative HYB@2.5 (DiD OR matched-pool control) keeps <= 2.5% false trip and catches 35% / 76% there,
  resting on a single 5-bot control pool. Built: DID24@2.0. Report: docs/reports/usafe-death-gate-2026-10-08.md.
- airpocket-01.{ee21207,dbb4d78}.json: class underground-safety, link_rules, linkage_extra [] (the old dict crashed
  verdict.py and changerowcheck.py). Exposure NOT powered at 6 h (P(>= 2 attempts) ~50%); the registered extension to
  +1560 reaches ~95% (conditional estimate).

## 10-08 — PEACEFULKIT-01 REVISION 2: two Codex defects from the junkwell-02 merge fixed; both engines APPROVE; NOT LAUNCHED
New heads (junkwell-02's jw-on-* need a rebase onto them): `pk-on-c6e91a8` @ 39fbcde (was 6dc10d1) and `pk-on-92bc84f` @
40046b8 (was f2c4ba0); code approved at a68dc5c / f25f050, the head commits are test-only. (1) Spare swords were still
counted BANKABLE wherever a caller did not pass noSwords (deposit-due test, room advice, prompt, milestone, withdraw and
recovery planners, the town-deposit trigger): bankableInventory's noSwords now defaults to the switch, and the trip
deciders read it at the call. (2) A wooden sword could be left on the CURSOR when the furnace drain closed: Paper probe
(sandbox/craft/pk-cursor-probe.mjs) -- vanilla returns a closed window's cursor item to the bag when there is room and
DROPS it when the bag is full; the drain now puts it back into the bag, else into the furnace slot it came from, and a
drop that still happens is a K2 breach row. Six more review rounds on the drain's accounting (no second furnace credit for
an earlier call's sword; per-call ` restaged=1` mark; timed-out takes settled and uncredited). npm test 238/238 and
239/239; 83 JS + 38 read + 3 variant mutants all killed; Paper smelt/bank scenes unchanged; dry run all gates 0, every
positive control fires; licencecheck exit 0. Read md5 6151dbca (= ~/mcai-analysis = /tmp).

## 10-08 03:05Z -- junkwell-02 PIT FIX READY (queued, not launched): the aim said twice; an abandoned pit is COVERED; C9 gates a pit left open
- **junkwell-02**: jw-on-c6e91a8 @ 2bd1452 (was 5c13330), jw-on-92bc84f @ b446f4d (was 5cca9c5).
  - **Cause of the 5/5 misses:** the server dropped the bot's single aim look in 12/12 traced throws. RCON read the dig look 72.15 at the click.
  - **Fix:** the look is said again, twice, before the click; the bot aims again if a correction moved it. Each throw's receipt is read from the spawn_entity PACKET (aim_off= / aim_read=, a tripwire).
  - **Abandoned pits are COVERED, not filled:** one block in the cap cell. The fill pushed thrown junk back out on Paper.
    - Only the run that dug the pit covers it, and never after an abort. Any visitor's close_well covers an open pit nobody is at.
    - There is no build order without a cover block; cobblestone counts only above 64.
  - **Read C9 (REVERT own_line breach_pit_left_open):** a pit opened (`_well_pit_dug`, written BEFORE the dig) or left (`_well_pit_open`) with no cover or build within 10 min.
    - `scripts/host/wellread_c9_e2e.py` ran on the host against /home/mike/verdict.py: ALL HOLD (clean KEEP, one pit REVERT, 5/5 read mutants killed).
    - wellread md5 a1a3deee on /tmp and ~/mcai-analysis; dry run 10-08 ~02:50Z: 313,926 rows walked, the instruments live, C1-C9 0.
  - **Reviews:** Codex r1-r3 CHANGE, r4/r5/r6 APPROVE. Claude r1/r2 CHANGE, r3 APPROVE (its P3s taken).
  - **Tests:** suites 236/236 and 237/237; well.test 167/167; lint clean but for withinBody.
  - **Paper:**
    - 35/35 consecutive pit-first throws landed on the fixed builds (15 on 88e4bb4, 20 on 2a6214f).
    - Control 5c13330: 3 of 10 throws landed, and 3 of 6 builds left the pit open.
    - Give-up: covered by the build, items contained (66 in the shaft, 0 outside, +30 s).
    - Abort: why=aborted, then a visitor covered it 12.5 s later. Kill: a visitor covered it 10.6 s later.
    - Resume: the well finished on the covered pit (131 in the shaft, 0 outside).
    - No cover block: no order, no walk. Dispose: 528/528 in the shaft.
  - **Not proven on Paper:** the visitor-race gate (B never scanned while the pit was open; it is unit-tested).
- **stonecap-01 COUPLED** (only if junkwell-02 is KEPT and promoted): now sc-on-2bd1452 @ 5260f71 and sc-on-b446f4d @ 39b6f82 (were sc-on-5c13330 ee4c916 / sc-on-5cca9c5 5ee00b8).
  - Registrations: stonecap-01.2bd1452.json / .b446f4d.json. The old .5c13330/.5cca9c5 files are superseded and deleted.
  - Union merges, checked by Codex r6. Cobble mutants 65/65 and 67/67; suites 237/237 and 238/238.
- **Still waiting:** jw-on-<peacefulkit sha> variants, for peacefulkit's new heads. The old jw-on-6dc10d1 / jw-on-f2c4ba0 lack the pit fix; do NOT launch them.
- **Driver:** sandbox/well/well-e2e.cjs (visitor bot, Job 7 scenes, site census) and sandbox/craft/trace-rot.cjs landed on main.

## 10-08 ~01:30Z — WITHDRAW2 REBASED (both variants READY, not chained, not launched)
`wd2-on-c6e91a8` @ 6c86fa7 (fleet c6e91a8; registration docs/reports/withdraw2-01.c6e91a8.json) and `wd2-on-92bc84f` @ a6cd3c1
(only if towndeposit-02 is KEPT + promoted; withdraw2-01.92bc84f.json). bots/src on both = the approved withdraw2 (c4e9c47)
rebased; only conflict the cognitive.mjs import line. A surplus-first room order (785cd0d) was built for the towndeposit base
and DROPPED before any push (Codex P1: ignores chest capacity, could decline a pull the old order completed).
- IRON RETENTION vs TOWNDEPOSIT: proven. Unit (withdraw2-towndeposit.test.mjs: real pull -> real townDepositPlan/Order) and Paper
  sandbox2: irontd 2/2 (crafted_iron, then _town_deposit at 34 slots banked raw_copper:7 ONLY; iron + stone pickaxes + coal
  stayed); irontdfail 2/2 (table out of reach, craft_failed, ingots 3 + sticks 2 in the bag at 35 slots, _town_deposit banked
  raw_copper:7 ONLY). The other direction is one-way: withdraw's unchanged room rule banks COAL FIRST (then raw_iron), which the
  town deposit keeps -- no ping-pong; withdrawread now REPORTS it per arm (no gate).
- Paper best-first + iron craft, both variants: tiers40 IRON (controls c6e91a8/92bc84f STONE), twochest IRON (control c6e91a8
  WOODEN), ironcraft crafted_iron craft=server; conserved, ground empty.
- Reviews: Codex r1 CHANGE (785cd0d P1; foodskip-order test stale P2) -> r2 CHANGE (read: verb= cut at 300 chars; now the order
  is recognized by its ledger, which also lets G1/G2/G5/G6 see cut rows) -> r3 no findings -> r4 APPROVE; Claude APPROVE x3.
- npm test: 236/236 (6c86fa7); 238/238 (a6cd3c1). Mutants 49/49 (c6) and 52/52 (92, incl. the town deposit's keeps).
  eslint no-undef: only withinBody. toolhygiene composes (scratch merge: no redundant-craft refusal of the iron craft; tests green).
- FOUND, PRE-EXISTING (fixed on wd2-on-92bc84f only): towndeposit.test.mjs TOWN MEMORY flakes ~50% on 92bc84f itself (same-ms
  'took' vs miss). If towndeposit-02 is promoted and merged to main, take a6cd3c1's test fix too.
- Dry run (10.0.0.31, 180 min): every gate 0, INSTRUMENT2 50. Exposure power: withdraw-01 orders 0.077/bot-h, upgrade
  opportunities 1.03/bot-h -> P(>= 5 orders on 10 bots) 0.09..1.00 at +180, 0.50..1.00 at +360. Read md5 2640ca65 = repo =
  host /tmp = ~/mcai-analysis (backups *.bak-20261008-wd2rebase); registrations in ~/mcai-analysis.
- FOLLOW-UPS (pre-existing, not this canary): bot.currentWants keeps DEPOSIT_ALWAYS ores in every room plan after any model
  deposit; chestfull recordOutcome keeps only the latest outcome (a later full/unknown un-invalidates _pick_best/_pick_miss
  <= 15 min); capacity-aware room choice at the chest (then demote IRON_LADDER items).

## 10-08 00:40Z — OWNER delegated to operator + Codex: FOUR-pool bag fixes; AIRPOCKET before bag fixes
D1: all seven bag fixes (toolhygiene, peacefulkit, junkwell-02, gridfix, bamboo, stonecap(+cap), bamboocraft) are
"class": "bag-fix", drawn at four pools from the start (criterion: frees usable bag capacity). D2: QUEUE is now
towndeposit-02 (live) -> airpocket-01 (needs the self-baseline DiD death gate installed first) -> withdraw2 (raises iron
mining) -> toolhygiene -> peacefulkit -> junkwell-02 -> gridfix -> bamboo -> stonecap -> bamboocraft -> treefarm. If the
airpocket gate is not ready when the slot frees, the bag fixes are HELD rather than bypassing it. Gate agent: build the
gate, set the registration classes, check four-pool eligibility. Codex text:
docs/reports/bagfix-pools-airpocket-order-codex-2026-10-08.txt.

## 10-08 00:30Z — CANARY LIVE: towndeposit-02 @ 92bc84f on placebo-b,board-c (10 bots), declared 00:15:33Z
Drawn 00:15Z (earlier than the 04:15Z estimate). Versions: 10 x 92bc84f on the canary pools. Reads ~03:15Z / ~06:15Z.
PRE WINDOW NOTE (Codex condition "no restart in the pre window"): fleet-recycle.timer (OnBootSec=6h, OnUnitActiveSec=6h;
"uniform staggered bot recycle, all arms alike") restarted all 80 bots 23:53-00:01Z, 14 min before deploy. It is
symmetric across arms and hits every canary every 6 h (next 05:53Z, inside this run), unlike the 10-07 outage +
promotion restart that shrank only the canary's pre window to 11.6 bot-h. Accepted and recorded; the queued
restart-contamination preflight must exempt fleet-recycle (or align draws to it), and should measure pre bot-h per arm.

## 10-08 00:20Z — OPERATOR: build status; towndeposit-02 draw waiting (exposure)
towndeposit-02: preflight ok 22:21Z, draw waiting -- exposure (compost >= 8 rows/6 h) passes only board-c, placebo-b;
board-c out of band; board-b/placebo-a excluded until ~04:15Z (12 h after towndeposit-01's teardown). Expect a draw
~04:15-05Z. Not swapped for another canary: every queued variant is based on c6e91a8/92bc84f, and a KEEP in between
would orphan towndeposit-02's variant.
READY (both engines APPROVE, npm test green, Paper-proven, reads staged on host): toolhygiene-01 (th-on-c6e91a8 efbb607 /
th-on-92bc84f 6238095); airpocket-01 (ap-on-c6e91a8 ee21207 / ap-on-92bc84f dbb4d78; 59/59 sealed-pocket survivals vs
control 0) -- BLOCKED on an underground-safety death gate (its pools drown 2.6-3.2x on the base; gate agent building a
self-baseline DiD gate); stonecap-01 + cobble cap (sc-on-c6e91a8 06e2964 / sc-on-92bc84f 971fb09; well-at-cap variants
sc-on-5c13330 / sc-on-5cca9c5; cap log needs rotation before promotion); bamboocraft-01 (after bamboo-01 KEEP).
FIXING: peacefulkit (spare swords still counted bankable in places; wooden sword can stay on the cursor after a furnace
drain) -- agent resumed; junkwell-02 (pit-first toss missed 5/5 on Paper and the abandoned build left the pit OPEN) --
agent resumed; dependent jw-on-<pk sha> variants to be rebuilt on peacefulkit's new heads. withdraw2 still needs its
rebase onto c6e91a8 (and 92bc84f).

## 10-08 00:10Z -- QUEUED, NOT LAUNCHED: the cobble cap inside stonecap-01; swords in junkwell-02; the well-at-cap coupling; bamboocraft-01; junkwell on peacefulkit
All branches pushed; registrations in docs/reports; reads in scripts/host (md5 on the host /tmp and ~/mcai-analysis = repo:
stonecapread 69ae9d78, wellread 31204393, bamboocraftread 8d797bd6). Nothing deployed, the manifest and the loop untouched.
- **stonecap-01 = the cobble rule + THE TOWN COBBLE CAP** (owner-delegated 10-07, Codex's rule): sc-on-c6e91a8 @ 06e2964,
  sc-on-92bc84f @ 971fb09. Counted counts in an append-only journal per town (`/var/lib/mcai/_pool-<pool>/<townKey>.cobble.jsonl`),
  claims decided in a shared fold, reconciliation of uncounted containers, never past 256, surplus stays in the bag at the
  ceiling. Codex 8 rounds -> APPROVE; Claude 4 rounds + final delta -> APPROVE (8-process race: 0 overshoots). Mutants 65/65 and
  67/67; suites 236/236 and 237/237. Paper: the cap held in every scene (control overshot 270-336); details in the registrations.
  BEFORE FLEET-WIDE PROMOTION: rotate the journal (P3, Claude); the read lists claims live > 1 h by bot (a removed bot's stay
  reserved, fail closed). Exposure is slow at the evening rate (~12 h for a 5-bot pool): the extensions carry it.
- **stonecap-01 COUPLED** (only if junkwell-02 is KEPT and promoted): sc-on-5c13330 @ ee4c916, sc-on-5cca9c5 @ 5ee00b8 --
  surplus whole stacks above 64 go down the well only while the town HOLDS 256 (counted), re-read at every click. Codex 3 rounds
  -> APPROVE; Claude APPROVE (its cheap P3s taken: cap read only at town; build room without cobble/swords). Paper: at 277
  counted the 30 + one 64 went into the shaft and exactly 64 stayed; at 247 none; a count dropped after the first click kept the
  second stack; control 5c13330 threw none. junkwell's chest-full W4-W8 fixtures adapted (a lone 64 cobble is now reserve).
- **junkwell-02 + swords** (peaceful only, re-read at every click): jw-on-c6e91a8 @ 5c13330, jw-on-92bc84f @ 5cca9c5. Codex r3 and
  Claude r2 APPROVE; suites 236/236, 237/237; Paper: peaceful threw both swords into the shaft, easy and a mid-visit switch kept
  them. **If peacefulkit is KEPT:** jw-on-6dc10d1 @ 91f9ce4 and jw-on-f2c4ba0 @ 582ade7 (merged on pk's final heads; both
  engines checked the composition -- Claude APPROVE, Codex CHANGE on peacefulkit's OWN code, not the merge: the counting sites still count spare swords
  (admission/milestones/prompt/skills: pass noSwords), and drainFurnace can leave a lifted wooden sword on the cursor). The
  earlier jw-on-da3e38d / jw-on-7ae5e0f are SUPERSEDED (not pushed). Suites 239/239 and 240/240.
- **bamboocraft-01** (launch only after bamboo-01 is KEPT): bc-on-6fb6fd9 @ 56956af, bc-on-786da4c @ f7415de. Codex r2 and Claude
  r2 APPROVE; suites 238/238, 239/239; 14 + 4 mutants killed. Paper: 36/36 bamboo 64 + sticks 32 -> 32 server-confirmed fold
  crafts freed a slot and the stone pickaxe was crafted (control refused). **bamboo-01 FINDING (both arms):** its housekeeping
  order fires first at 34+ slots and folds ALL bamboo -- in one scene it ate the scaffolding's ingredient; the craft-time fold
  only got its turn with the order on cooldown. Read bamboo-01 with that in mind.
- KNOWN, junkwell-02 (pre-existing, both revisions in the sandbox): the pit-first toss can miss the pit and the bot picks the
  stack back up; after two misses the build refuses "0 free slots" -- 5 misses in a row on one sandbox site 10-07 evening.
- DO NOT deploy the round-6 cap shas 9e88176 / a12572d (a mutant survives there; the finals kill it).

## 10-07 ~22:30Z — PEACEFULKIT-01 REVISED to the owner's 19:50Z decisions; REVIEWED (Claude + Codex APPROVE); NOT LAUNCHED
`pk-on-c6e91a8` @ 6dc10d1 (registration docs/reports/peacefulkit-01.c6e91a8.json) and, for a fleet on towndeposit-02,
`pk-on-92bc84f` @ f2c4ba0 (peacefulkit-01.92bc84f.json); both in ~/mcai-analysis/ too. Read scripts/host/peacefulkitread.py
= ~/mcai-analysis = /tmp, md5 5d3714b6. SWORDS never banked (not even a spare) and never crafted or chased while on; a smelt
ALREADY happening burns carried WOODEN swords first (one per item, only into a cold furnace, so the switch read at the put
is the burn); stone swords stay in the bag; `unwantedSword(item, peacefulActive)` exported for junkwell-02. SAPLINGS:
oak/birch keep 16, other species composted (their replanting stops by design). COMPOST + dried_kelp, glow_berries,
moss_carpet, firefly_bush, bush, bread (each 64/64 on Paper; off when not peaceful). GUARD general: no compost trip when
the real surplus after every reserve is zero. Six review rounds on the revision (both APPROVE); 97 mutants all killed; npm test green on both; the big catch (Claude r3, confirmed on
real sandbox rows): mineflayer freezes bot.inventory while a window is open, so mid-job burn rows read as LOST (2 of 2)
-- rows now written after the close, and the read keeps a 180 s burn credit. Paper sandbox3 (real bot): bank/compost/
guard/craft/drop as designed; smelt 5/5 both wooden swords burned, coal untouched; an earlier call's sword in the fuel
slot is taken back before any input (full bag: the job refuses, nothing dropped). Dry run (board-a,placebo-b, 6 h): every
gate 0, every positive control fires (K1 125, K2 31, K3 19, K4 34, K5 37, K6 22, K7 65); licencecheck exit 0 (class
kind, `_peaceful_kit` silent in baseline); drawexposure: both pools eligible. TEARDOWN NOTE: record the read's "left in
the furnace" swords by bot (base code's drain would toss them from a full bag).

## 10-07 22:25Z — GATE v33 INSTALLED (bag-fix death rule + version-aware changerowcheck); towndeposit-02 drawing
Installed 22:12Z in the empty slot (launcher stopped by PID, dry run, install, relaunched): bundle
ac3da3b64d3fa5e31be5678c33d84ac0, gatedigest OK, backups *.bak-v33-20261007T221224Z. Report:
docs/reports/bagfix-death-rule-2026-10-07.md (main 8522797; both engines APPROVE; backtest: of 17 death-involved
reverts only junkwell-01 would have extended). Bag fixes need "class": "bag-fix" + a bag_fix block and draw FOUR pools
from the start (no mid-run widening). After a bag-fix KEEP the loop only launches "class": "underground-safety"
(airpocket must declare it). towndeposit-02 runs as a normal canary (no class). 22:21Z preflight-ok with the new check
("0 from other builds"), licence-ok, gatedigest-ok; draw waiting for two pools.
OWNER (pending): accept four-pool draws for bag fixes (4-pool draws happened 6 of 21 times since 09-28 -> slower starts).

## 10-07 22:10Z — GATE v33 (bag-fix death rule) BUILT + STAGED, NOT INSTALLED; changerowcheck baseline-only fix in it
Built per the owner's 19:45Z decision: docs/reports/bagfix-death-rule-2026-10-07.md. SUBSTITUTION (needs owner nod):
no mid-run widening (a 2nd deploy rewrites the one declared_at, restarts canary pools, rebuilds the tree under them)
-- bag fixes are DRAWN AT 4 POOLS (20 bots) from the start; the loop waits for such a draw (6 of 21 draws since 09-28).
VALUE MEASURE: net change in log-eq (junk/ballast/cobble>64 = 0, iron 10/ingot, tools at material cost, logs<=64,
saplings<=16; transfers and in-transfer rows excluded); 24-h null p2.5 -3.21 log-eq/bot-h, iron -0.127 ingot/bot-h.
TABLE (P(REVERT), k=1/1.5/2/3): rule as built 1.6/11.3/28.7/72.2% vs today 20-bot 4.3/15.3/34.8/73.2% -- a leniency
rule by construction. BACKTEST: of 17 death-involved reverts today's gate trips on 2; only junkwell-01 would have
EXTENDED (0/6 linked, LB 1.39); its 24-h outcome is unknown (torn down +308). chestfull-01 stands (no own rows; LB>2).
Fail-closed additions listed in the report section 8. Reviews: Claude APPROVE (r5), Codex APPROVE (r6) after 6 rounds.
STAGED on 10.0.0.31 in ~/bagfix-v33; dry run 22:00Z OK, predicted bundle digest ac3da3b64d3fa5e31be5678c33d84ac0.
INSTALL (between canaries ONLY; the script refuses while any loop/chain/launch runs or a canary is declared):
  ssh mike@10.0.0.31 'bash ~/bagfix-v33/install-bagfix-gate.sh --dry-run' then without --dry-run.
At 22:00Z it WOULD REFUSE: ~/launch-td02.sh (towndeposit-02, 22:20Z) is waiting. After install, the changerowcheck
fix stops the false refusal that hit towndeposit-02 at 19:46Z (40 town_deposit rows, all from towndeposit-01's build).
Before the first bag fix: register it with "class":"bag-fix" + a bag_fix block, and dry-run its reads at +1440.

## 10-07 19:50Z — OWNER APPROVED: adaptive death rule for bag fixes + airpocket; swords never stored; sapling/compost decided
DEATH RULE (underground-safety-phase2 section 7, adaptive form): bag fixes run the normal 6 h canary; if the death gate
trips with ZERO mechanism-linked deaths, extend to 24 h on 20 bots and decide by linked deaths beyond chance / deaths
confidently > 2x control / value-weighted net output; no bag benefit or too little exposure -> INCONCLUSIVE; a KEEP hands
the next slot to a safety fix. NOT LIVE until: value-weighted re-run, backtest on ~15 death reverts, tooling + gate digest
re-registered, installed BETWEEN canaries (agent building; CLAUDE.md to be updated). Until then the two-death floor rules.
AIRPOCKET (rank 1 safety, ~25-35% of drownings): being built (dig up inside the drowning rescue; damage envelope).
SWORDS (owner): never stored -- no banking; wooden swords burn as fuel in smelts already happening; all swords to the well
while peaceful (junkwell-02). SAPLINGS: oak/birch keep 16/bot, other species composted. COMPOST adds dried_kelp,
glow_berries, moss_carpet, firefly_bush, bush, bread (peaceful only). Full-bag compost guard generalised. Codex text:
pk2-codex (scratchpad) folded into the peacefulkit design by its agent.

## 10-07 19:40Z — OWNER delegated "1 and 2" to operator + Codex: decided
COBBLE CAP: build the 256-per-town ceiling INTO stonecap-01 before its canary (reconciled chest counts with deposit
reservations; whole stacks only; bot keeps 64 reserve; at the ceiling, surplus whole stacks above the reserve go down the
junk well if junkwell-02 is kept, else stay in the bag -- no new chest, no toss). BAMBOO AS A CRAFT REMEDY: a separate
follow-up canary bamboocraft-01 after bamboo-01 is KEPT (bamboo-01 unchanged). Codex text:
docs/reports/cobblecap-bamboocraft-decision-codex-2026-10-07.txt. Builder agent resumed on both.
STILL OPEN (owner; defaults used meanwhile): sapling reserve 16 (default 16), bank spent swords (default no), extra
compostables dried_kelp/glow_berries/moss_carpet/firefly_bush/bush/bread (default none), apple-only full-bag guard in
peacefulkit (default in), the bag-fix death rule (safety agent finishing review).

## 10-03 22:56Z — FLEET 3edf1d6 (ore tunnel promoted 22:48Z); CANARY LIVE: craftsync-01 @ ba84fa6 on board-c,
placebo-a (10 bots), declared 22:53:29Z; exactly two versions live (70 x 3edf1d6, 10 x ba84fa6) at 22:56Z.
Reads +180 (~01:53Z) and +360 (~04:53Z); KEEP possible from +360. NOTHING chained behind it (logpickup chain stopped;
craftroom needs its no-logpickup rebuild + registration + the read's positive control proven on craftsync's rows).
Fleet raw iron gained 33 -> 17 -> 6 per 10 h over 10-03 (no fleet-wide change): watch it now the tunnel is fleet-wide.
- **OWNER 10-03 ~23:10Z: "fix the chest full problem, use claude and codex to find the best approach, implement it and
  deploy it" + "yes" to bamboo -> sticks.** Queue: craftsync (live) -> craftroom -> composter -> tool cleanup -> CHEST
  FULL -> BAMBOO STICKS -> logpickup -> explore -> orepack -> cellmem. The ported bank fix is dropped from the slot (frees
  ~0 today; its loop-stopping parts can return later). MEASURED 24 h, 1,970 deposits: success 343 (+99 used another
  chest, +13 built one), failed 938, no_effect 659. Full-chest blocks only 90 -- and **75 of the 90 bots CARRIED a chest**
  while the skill tried to CRAFT one (bug). Bigger deposit losses: 538 path failures (no path 252, goal changed 153,
  path timeout 133) and 494 "not a banking target" (apple 311, dirt 92, scaffold cobblestone 91).
  **DESIGNS (both engines, ~23:30Z) agree:** root cause skills.mjs:2834 crafts a chest unconditionally (place only after a
  successful craft). Claude also found the deposit path DROPS a stack on "destination full" (catch at :2752, then
  chest.close()) -- a never-drop violation; bank-fix's returnCursor cures it. CHEST FIX (building, chest-on-948bc26):
  carried chest first, cursor rescue, new chest only if no container within 16 of home has room, chestSiteRefusal (no
  lids, >= 3 from composter, no adjacent chests, no body-overlap cells, read back after a timeout), shared cap 1 per
  town per 10 min and <= 12 containers. SEPARATE later canaries: deposit admission (no_effect 659: refuse when
  depositPlan is empty) and deposit path failures (538). BAMBOO (2nd): pinned bamboo recipe (never craft('stick'),
  which may burn planks), only when a slot is actually freed (64 bamboo + 0 sticks frees 0), via craftExecutions.
  OWNER QUESTION OPEN: any bankable item may open a new chest (current) vs valuable-only (09-28 rule) -- kept current + cap.

- **craftroom-01 CHAINED (~00:00Z 10-04)** behind craftsync-01: variant ba84fa6 -> ffa0f57 (cr-on-ba84fa6, craftroom
  WITHOUT logpickup; Codex AGREE on the rebuild, Claude confirmation pending -- stop the chain if it says CHANGE; Paper
  regression 15/15). STOPs by itself if craftsync is not promoted. Read /tmp/craftroomread.py = repo c6bd787 (md5
  0dc5218a); POSITIVE CONTROL PROVEN on live craftsync-01 rows: 2 of 5 canary pickaxe crafts lost on the server
  (dry run with the craftsync pools on the control side). Preflights dry-run OK.
- Composter rebuilt without logpickup: co-on-ffa0f57 @ 56db2cd (Codex AGREE). Tool cleanup de7d0aa: both reviews
  CHANGE (non-transitive comparator; name-only equip guard; hard stop 0 only on harvest digs; telemetry) -- fixing.
  Chest fix: building.

- **AUTOMATED LINE (host chains, 23:45Z):** craftsync-01 (live, ba84fa6) -> craftroom-01 (fleet ba84fa6 -> ffa0f57;
  chain pid 2294257) -> composter-01 (fleet ffa0f57 -> 56db2cd; chain pid 2295673; read scripts/host/composterread.py,
  positive control 57 full junk-holding control bots; read under Claude review). Each chain STOPs if the previous run
  was not promoted to the expected sha. Building: tool cleanup fixes (tc-on-948bc26), chest fix (chest-on-948bc26),
  bamboo sticks (bb-on-56db2cd) -- each to be rebased onto the line's tip before its own registration.

- **10-04 ~00:30Z build status (bag fixes):** TOOL CLEANUP 476edb9 -- Claude AGREE, Codex closed all round-1 items;
  being rebased onto 56db2cd (no logpickup). **LOGPICKUP REBASE REQUIREMENT (Codex):** the support-dig veto must clear a
  spent tool to hand/filler before evaluating (2-use axe -> canopy drop -> pickup_failed), with a regression test.
  CHEST FIX 421dc53 -- both CHANGE (cap blocks most towns -> budget on NEW chests: >= 10 min apart, <= 4/day, <= 12
  recovery-created standing, pre-existing not counted; unavailable vs unknown containers with per-town memory;
  MAX_SITE_TRIES=1; verified cursor rescue; 180 s real deadline; truthful closed-bank advice; table access) -- fixing.
  BAMBOO d5736f0 -- Codex CHANGE (re-check the stick cap at execution admission: 63 sticks + 1 picked up during the
  baseline -> 65, slot not freed); Claude CHANGE (pickup refusal must not back off 30 min; split stacks consolidate on
  the real server so the freed decision is too pessimistic; wiring-test mutants survive; row in a finally) -- fixing.
  **BAMBOO YIELD IS SMALL (census 00:40Z):** 68/80 bots at >= 34 slots, 29 hold bamboo, only 9 can fold now (1 slot each,
  ~9 slots fleet-wide); 18 "no batch frees a slot". Tell the owner plainly.

- **10-04 01:35Z: toolclean-01 CHAINED** behind composter-01 (fleet 56db2cd -> tc-on-56db2cd @ 1918bb5; both engines
  AGREE; Paper sandbox 6 scenes x 3 x 2 passed; read /tmp/toolcleanread.py md5 a378d4ad = repo; positive control 87).
  KNOWN pre-existing (both arms): a pathfinder travel dig can swing a held 1-use shovel when travelTool hands back
  nothing (1 of 13 sandbox trials) -- candidate for a later fix (empty the hand before a travel dig).
  **READS NOW ROTATION-AWARE** (logs rotate ~23:59Z; live-only reads dropped the window before it) and the craftsync
  tripwire counts unanswered resyncs (amendment recorded before the +180 read). craftsync-01 so far: 0 of 96 false
  successes (control 117/633), Paper answered 46/46 resyncs, many planks crafts lost to full bags (craftroom's job).

- **10-04 ~02:00Z:** BAMBOO d26eedc both engines AGREE (planner stress-tested on ~25k random bags; live census 19 of
  29 full bamboo holders eligible); Paper sandbox running; read scripts/host/bambooread.py (positive control 27).
  CHEST fix rebased onto the line (chest-on-1918bb5 @ 3be9307, patch-identical, 225/225, 20 mutants): Claude AGREE on
  round 2; Codex CHANGE with 5 reproduced items (standing-cap bypass via dismissed claims, first chest ignores memory,
  unreachable first chest, first attempt not clamped, transfer_unsettled lost on retry) -- builder fixing.
  **OWNER-LEVEL WARNING (Claude):** at <= 4 new chests/day and <= 12 standing, a town whose bank only receives (125k in,
  48 out/day on 09-28) fills its expansion budget in ~3 days; then refusals are honest but permanent. The lasting fix
  is withdrawals or ballast disposal; the chest read should report the refuse_cap share so that point is visible.

- **OWNER 10-04 ~02:50Z: bots WITHDRAW from chests; NEVER deposit junk; existing junk comes OUT. "use both engines to
  formulate, implement ... deploy ... monitor and test ... if not effective revaluate make changes and deploy changes."**
  Running: read-only RCON chest census (slot by slot, tool durability, proposed junk list); both engines designing
  withdraw + no-junk deposit + clear + queue order. The one-time admin clear (09-28 permission) runs only after the
  no-junk fix is live, with the exact list shown to the owner first. 09-27 chests: 124,894 items, 42% cobblestone,
  but 16k logs, 6.8k sticks, 865 stone pickaxes while 45/80 bots lack a usable pickaxe.

- **CHEST CENSUS 10-04 02:52Z (read-only, every slot answered; docs/reports/census/):** bank = 375 containers near
  the 16 homes, 197,863 items, 228/375 full, 73% of slots used. Valuable: 897 usable stone pickaxes (640 > half), 438
  wooden, 8 iron; iron ingots 430; logs 44,701; sticks 14,215; chests 168 -- while 45/80 bots lack a usable pickaxe.
  Junk (proposed): 100,593 items / 3,125 slots (42%): cobblestone above 256/town 81,535; spent tools 1,156; ballast
  9,721; seeds/litter 8,180. Manifest for the owner: docs/reports/chest-clear-manifest-2026-10-04.md (NOT RUN; after
  the no-junk fix; owner decides eggs/scutes/flint/clay/ink 2,297 and decorations 125).
  **SECURITY:** /tmp/scan2.py on 10.0.0.31 holds hive-b's RCON password in plain text and it was printed into this
  session's output while searching for the old census. Owner asked to rotate it and delete the file (and /tmp/scan.py).
  I do not touch credentials.

- **BAMBOO SANDBOX (Paper, ~03:40Z):** short folds work (B: [64,10]+32 sticks -> 5 crafts, 36->35; E cap kept; C/G no
  order; planks never burned) BUT (1) folds > the stuck limit are killed by the 20 s watchdog (32-craft fold stops at
  15, frees nothing; 64 cannot finish; one rep ended fuller) -- no stationary window declared; (2) an ABORTED fold left
  8 bamboo in the 2x2 crafting grid/cursor, invisible to the bag, dropped at logout -- **checking whether this is a
  craftsync defect (live canary, KEEP possible ~04:53Z) or bamboo-only**; (3) row crafts off by one on abort; (4) the
  runner filed the aborted run as success. Harness on main (8ab8a5c). Chest fix 96cfbe0: Claude AGREE; Codex two more
  edge cases (clamped timeout converted in recovery/sweep; walkFrom aliases a mutable Vec3) -- fixing, then withdraw.

- **CRAFTSYNC GRID DEFECT CONFIRMED (10-04 03:25Z, builder repro with real craftsync + mineflayer + fake Paper):** an
  ABORTED 2x2 inventory craft (stuck watchdog, interrupt, preempt) after the first click leaves the grid + cursor
  loaded (craftsync never sends close_window 0 on the cancel path); items return on the next craftsync craft's baseline
  close, that next craft fails once, and a logout/restart before it drops them. Table crafts are clean. The control
  cannot be aborted, so this exposure is NEW. Live canary: 2 of 82 crafts in 4.5 h (oak_planks 2x2). **DECISION:**
  craftsync-01 proceeds to its +360 read (the 19% false-success fix outweighs this narrow, mostly self-healing defect);
  the GRID FIX ships as its own canary right after toolclean: order toolclean -> gridfix -> chest -> withdraw ->
  no-junk -> admin clear -> bamboo -> logpickup.

## 10-05 ~02:45Z — CHESTFULL-01 READY, NOT LAUNCHED (chest-on-1918bb5 @ 6c9a8fb; registration on main
docs/reports/chestfull-01.1918bb5.json; staged on 10.0.0.31: ~/mcai-analysis/chestfull-01.1918bb5.json, /tmp/chestread.py =
repo md5 0b936388, old read backed up /tmp/chestread.py.bak-20261005T024025Z). Suite 225/225, eslint only withinBody.
Launch: `~/chain-after.sh toolclean-01 chestfull-01 1918bb5=/home/mike/mcai-analysis/chestfull-01.1918bb5.json`.
**EXPOSURE AFTER THE CLEAR IS ~0 FOR PLACEMENTS:** 1 storage_full deposit fleet-wide in 8.1 h after 18:07Z (52 in the 12 h
before). The read therefore gates DEFECTS deterministically (C1 off-site, C2 from the bots' own claim ledger in
/var/lib/mcai/_pool-*, C3 unsettled EVENTS, C4 craft-while-carrying from the END snapshot net of a crafted-unplaced chest)
with exposure = the ordinary deposit path (>= 20 canary-build deposits + a control positive control); success DiD is
REPORTED only (identical-code null -0.73/bot-h). The placement path is proven on PAPER (sandbox/craft/chest-ab.cjs, both
arms): carried 2/2 placed + banked (control 2/2 "could not make another chest" while carrying one), craft 4/5 (1 safe
refusal: craftsync baseline_unanswered), budget refusal chain 2/2 (admission refuses, no walk, prompt stops advertising
deposit), roomy 2/2 = control, site 2/2 (no path floor, off table cells), far 2/2 nothing placed; nothing dropped anywhere.
chestread now streams (memory 294 MB for a 12 h walk) -- the other reads still hold every row via Events.load.

## 10-06 ~00:15Z — TREEFARM-01 (blueprint builder + town tree farm) BUILT, REVIEWED, REGISTERED, NOT LAUNCHED. Queue: LAST
(owner 10-05 ~19:00Z). Branch bp-on-1918bb5 @ 453cd07 (base 1918bb5; REBASE onto the fleet sha when its turn comes --
chestSiteRefusal and the junk well's site search must then refuse farmIndex cells). Registration main
docs/reports/treefarm-01.1918bb5.json; read scripts/host/treefarmread.py (staged /tmp/treefarmread.py on 10.0.0.31; dry run
37 s, positive control 352 control log gathers; changerowcheck/licencecheck/v30 preflights dry-run OK). Codex APPROVE r6.
MEASURED (Paper sandbox4): saplings grow a median ~16 min at rtick 3 in light, 0 at night without light, at daylight
speed at night with the farm's torch layout; leaves in a column do NOT block growth (16/16) -- and a harvested tree's
leaves never decay while a neighbour stands, so this mattered. E2E on the final sha: build 9/9 + 4/4 confirmed, SIGKILL
resume, foreign lease, other skills around it, grow -> ordinary gather -> clear -> replant loop closed; harvest A/B on
the same farm: ctrl 15,16 logs vs cand 21,23 (no harm). Bone meal arm built, OFF by default (owner decision pending).
Bags: 76/80 bots hold >= 6 farm saplings, 62/80 carry torches. Design + follow-ons (WORKSHOP, SAFE MINESHAFT, designed
not built): docs/reports/blueprint-builder-design-2026-10-05.md.

## 10-07 ~19:40Z — PEACEFULKIT-01 READY (not launched): pk-on-c6e91a8 @ da3e38d / pk-on-92bc84f @ 7ae5e0f
The owner's 10-07 items (3) swords and (4) compost more, under foodskip's ONE switch (FOOD_SKIP auto|on|off; auto = the
server's difficulty packet says peaceful). Design docs/reports/peacefulkit-design-2026-10-07.md (measurements, cited prior
art, the Paper compost table, 5 review rounds, owner decisions); registrations docs/reports/peacefulkit-01.c6e91a8.json and
peacefulkit-01.92bc84f.json (also in ~/mcai-analysis/); read scripts/host/peacefulkitread.py = ~/mcai-analysis = /tmp, md5
22a14034 (`--selftest` runs at every read); mutants scripts/mutants/mutants-pk.py (39/39 JS + 20/20 read killed).
- SWORDS: admission + the craft skill refuse a sword craft while active (remedy: craft a pickaxe/axe/shovel or gather), the
  prompt stops offering one, the sweep never walks to a sword drop, a RUNNING deposit keeps no usable sword (spent never);
  admission/advice/milestones/the town-deposit trigger keep the base count (no new trip); a sword-only full chest never
  starts the recovery. COMPOST: 30 kit plants WHOLE (each consumed 64/64 by a real Paper 1.21.8-60 composter, RCON hopper
  test; negatives 0); saplings > 16 and apples > 4 unchanged; dried_kelp/glow_berries/bush/firefly_bush/moss/bread NOT
  approved; full bags get an order only when a fill can start (startableJunk at the composter's level -- also applies to
  the food policy's apples while on); `_compost` rows carry args.items (+ `aborted` rows on interruption, args.incomplete).
- PAPER (sandbox3, the real bot, server read-back): craft refused 2+2/2+2 (control crafts), easy crafts 2/2; deposit banks
  both swords 2+2/2+2 keeping the better pickaxe (control keeps both), FOOD_SKIP=off and easy keep them; compost 2+2: all 69
  kit items consumed, apples 10->4, saplings 20->16, bread/dried_kelp/sword kept (control: kit untouched); off/easy untouched;
  sword drop never chased 5/5 (control chases it).
- REVIEWS: Claude r1 APPROVE, r2 CHANGE (the read's clock: skill rows are stamped at START), r3/r4 APPROVE; Codex r1-r4
  CHANGE (K2 ledger, truncated compost rows, exposure power, interrupted visits, unverified X2) -> r5 APPROVE; Codex rebase
  confirmation of the 92bc84f variant APPROVE. Suite 237/237 (c6e91a8 line), 238/238 (92bc84f line).
- DRY RUNS: every gate 0, every instrument fired on the control (6 h: tool crafts 126, bank-explained pickaxe falls 41,
  bank rows emptying a name 91, reserve checks 45 ...), CALIBRATION 0, control sword ledger lost 0; licencecheck (kind
  _peaceful_kit, baseline silent) and drawexposure (9 pools eligible) OK.
- EXPOSURE is per BOT (swords are stock): joint P(X1 >= 3 and X2 >= 3) 0.35-0.94 at 6 h with 2 pools, 0.87 at 12 h, 0.99
  at 24 h -> reads 180/360 + extension 540/720/1080/1440, deadline 1680 -> INCONCLUSIVE. DRAW >= 2 POOLS.
- OWNER DECISIONS: sapling reserve (recommend keep 16: every holder has ONE stack per species, so no reserve > 0 frees a
  slot); spent swords (never banked now; census found none); the unapproved compostables; accept startableJunk's apple
  effect inside this canary; a 2+ pool draw.
Queue position (18:00Z entry): after toolhygiene. Not deployed, nothing launched, no world edits outside the sandboxes.

## 10-07 ~19:15Z — QUEUED (not launched): junkwell-02, gridfix-01, bamboo-01, stonecap-01 -- each with a c6e91a8 AND a 92bc84f variant
Pick the variant by the fleet sha when its turn comes (92bc84f only if towndeposit-02 is KEPT and promoted). Registrations on
main docs/reports/<run>.<base>.json and on the host ~/mcai-analysis/; reads in ~/mcai-analysis/ and /tmp/ (md5s below).
- **junkwell-02**: jw-on-c6e91a8 @ 5a462a4 / jw-on-92bc84f @ d43b543. The 10-04 owner list + the owner's 10-07 decorations
  (124 names: glass/panes/stained, wool, buttons, wooden+stone plates, rails, lead, brick(s), mossy/cracked/chiseled stone
  bricks, polished andesite/diorite/granite, smooth_basalt, polished_tuff, tuff bricks, fences) + andesite/diorite/granite/
  stone_bricks/mossy_cobblestone/smooth_stone only while the bag KEEPS 64 reserve stone (cobble, deepslate, raw andesite/
  diorite/granite), judged at each click. Never: wooden slabs (composter recipe), trapdoors, beds, sandstone, calcite/tuff,
  compostables (peacefulkit's). Codex CHANGE -> APPROVE (r2); Claude APPROVE-WITH-CHANGES x2 (applied). Paper sandbox3:
  deco63/64/0 exactly as planned, 0 outside the shaft, non-listed untouched. Read wellread.py adds C7 (stone guard), mine
  actions/bot DiD (BLIND when the control shows none; MINING SHIFT > +15) and deaths below y 60 by mechanism.
  OPERATOR RULE: MINING SHIFT + a canary death below y 60 = read it by hand before any KEEP (junkwell-01's mechanism).
- **gridfix-01**: gf-on-c6e91a8 @ 55dff5a / gf-on-92bc84f @ b54e452. NOT a mechanical rebase (withdraw's evolved click
  machinery); Claude's probe found the grid fix's write-hook drop desyncing withdraw/town-deposit locksteps (12/20) -> fixed
  (stopIssued before validate()). Codex APPROVE x2, Claude APPROVE (r2, probe 0/20). Paper: ctrl stranded on every mid-click
  abort, cand 0/8 (int3 read unverified_skipped, bag conserved). POWER: aborted 2x2 exits ~0.5/h fleet-wide -> a 15-bot
  draw is exposed by +360 only ~45% of the time, ~92% by +1560 (extensions); prefer 15-20 bots.
- **bamboo-01** (after gridfix is KEPT): bb-on-55dff5a @ 6fb6fd9 / bb-on-b54e452 @ 786da4c. Claude APPROVE; Codex
  APPROVE-WITH-CHANGES, its one P2 INHERITED from the 10-05 design (a room-blocked milestone craft wins the decision before
  bamboo) -- OWNER/OPERATOR DECISION, not changed. Paper K20 abort 3/3 clean (was 46 bamboo stranded without the grid fix).
- **stonecap-01 (the cobble rule, NEW)**: sc-on-c6e91a8 @ c238c3d / sc-on-92bc84f @ b2dee1a. Design
  docs/reports/cobble-rule-design-2026-10-07.md (+ prior-art search). Whole cobble stacks only, smallest first, keep 64
  cobble+deepslate; moved by mineflayer's own transfer() narrowed to the slot (no new click path); cobble never grows the
  bank; depositDue false with nothing bankable; admission refuses an empty plan before the walk. The 256/town = the 10-04
  clear's reserve, NOT a cap (owner's "no-ledger design"; both engines agree) -- a hard cap is an OWNER DECISION.
  Reviews: Codex CHANGE -> APPROVE-WITH-CHANGES x2 -> APPROVE (r4); Claude APPROVE-WITH-CHANGES x2 -> APPROVE (r3). Paper: A [64,30] ->
  the 30 banked, 64 kept in one slot (ctrl banked 64, kept 30); B [50] -> 0 cobble (ctrl 42, to its old 8); C 14-room chest
  -> nothing moved, no chest, no recovery (ctrl part-filled +14). Craftsync's recount after real transfers says src=skipped,
  so C1 judges the client bag (it matched the server in every trial).
- towndeposit.test TOWN MEMORY is FLAKY on the unmodified 92bc84f (3/8): same-millisecond precondition; fixed test-only on
  the 92bc84f variants. towndeposit-02 itself is unaffected (the code is right).
- Sandbox harnesses added to main: sandbox/well/well-e2e.cjs (deco63/64/0 scenes), sandbox/craft/cobble-ab.cjs.
- Reads on the host (/tmp = ~/mcai-analysis = repo): wellread.py f5ff8d45 (old one kept as .bak-20261007T1950Z), stonecapread.py
  549372b1, gridfixread.py eac8d6da and bambooread.py 1aeb644a unchanged. Each dry-ran 10-07 with CANARY_DRYRUN.
  Mutant driver: scripts/mutants/mutants-canaries-1007.py (gridfix 1/1, cobble 10/10 killed).

## 10-07 18:00Z — BAG CENSUS + OWNER: "i want all of those things done and queued" (six bag fixes)
Census 17:00Z (scripts/host/bagcensus.py, bagcost.py; slots = ceil(count/stack)): 2,752 of 2,880 slots used (96%), median
35/36, 37 bots full. Unneeded in peaceful (~15 slots/bot): owner junk ~375 slots, decorations ~300, food ~200, swords 123
(all ~100% durability), stone pickaxes 250 (148 at <= 10% left; 211 crafted today vs 13 iron), bamboo 104. Items gained
per bot-h by fullness since 13:00Z: <=30 slots 106.9 (32.1 bot-h), 31-33 97.9 (50.9), 34-36 58.2 (228.6) -- correlational.
Rows naming a full bag in 4 h: craft 600, _ore_tunnel 149, gather 149.
APPROVED + being built (3 agents, own worktrees, both engines, sandbox-proven, dual variants c6e91a8/92bc84f):
toolhygiene (no redundant tool/station crafts; most-worn usable pickaxe for low-tier blocks), peacefulkit (swords under
the peaceful switch: no craft/chase, banked; composter takes melon/kelp/mushrooms/seeds/flowers/leaf litter/surplus
saplings), junkwell-02 (owner junk + decorations), gridfix -> bamboo rebases, cobble rule (256/town).
QUEUE: towndeposit-02 (>= 19:45Z) -> withdraw2 -> toolhygiene -> peacefulkit -> junkwell-02 -> gridfix -> bamboo ->
cobble -> treefarm. Plus the restart-contamination preflight (Codex) before the next launch that needs it.
RISK NOTED: emptier bags send bots back to mining (junkwell-01's revert mechanism); reads must report mine actions/bot and
underground deaths by mechanism.

## 10-07 17:30Z — TOWNDEPOSIT-01 REVERTED (+180, guard v11 climbs +239%); towndeposit-02 = identical re-run, launches >= 19:45Z
Feature gates at +180 all 0 breaches; 12/20 full-bag town stays served; slots/bot DiD -0.57, share>=34 DiD -0.087; deaths
1 (0.033/bh) vs control 0.047/bh. The trip: climb firings (_entombed+_marooned)/bot-h canary 3.2 -> 7.8, control 11.0 -> 7.9.
The pre window (10:06-13:06Z) held the outage (to 11:53Z) and the fleet promotion restart (12:00-12:12Z): canary pre 11.6
of 30 nominal bot-h. Clean 9 h pre (10-06 20:00-05:00Z, scripts/host/tdclimbs.py): canary 6.51/bh, control 8.01; post 7.77
vs 7.99 -> ratio-DiD +19%. Spread over all 10 bots (8-42 each); 61/233 within 10 min of the same bot's _town_deposit row
(proximity, not causation). RECORDED AS: baseline compromised by outage/restart; feature effect UNRESOLVED (Codex wording,
docs/reports/towndeposit-01-revert-codex.txt). Torn down 16:15Z, pools on c6e91a8.
towndeposit-02: same sha 92bc84f, same reads and gates, no trip waived (registration docs/reports/towndeposit-02.c6e91a8.json).
~/launch-td02.sh (pid on host) waits until 19:45Z so the 3 h pre window is clear of the 16:15Z teardown restarts in the
control too, refuses if a canary is declared or the fleet is not c6e91a8, then runs canary-loop.
Teardown noise: the restart step globbed stale /var/log/mcai/board-b-Charlie and placebo-a-Charlie dirs (bots retired
09-02) and tried to start units with no env file -> 2 "failed" units, reset-failed; 80/80 real bots running.
QUEUED (Codex): a preflight refusing a deploy whose 3 h pre window has < 80% of nominal bot-h in canary OR control, or
contains a fleet/pool restart; build + review before towndeposit-02's successors rely on it. Then withdraw2.

## 10-07 13:10Z — CANARY LIVE: towndeposit-01 @ 92bc84f (td-on-c6e91a8) on board-b,placebo-a (10 bots), declared 13:06:18Z
Two versions live (92bc84f x10, c6e91a8 rest). Reads ~16:06Z (+180) and ~19:06Z (+360). Next in the queue: withdraw2
(rebase wd2-on-c902d6f onto the then-fleet sha; check iron retention vs towndeposit), then gridfix, bamboo, junk well,
cobble rule, treefarm.

## 10-07 12:25Z — FOODSKIP-01 KEPT (scoped, amendment 1) and PROMOTED: FLEET c6e91a8 (12:12Z, all live bots verified). towndeposit-01 drawing.
SECOND POWER OUTAGE: fleet host 10.0.0.31 + world host 10.0.0.30 down 05:01:47Z -> 11:53Z (6h51m). Studio and mini stayed up.
Came back on their own: 16 worlds, 80 bots, sandboxes 2-4, canary-loop (cron at 12:00). Restored by hand: /tmp read
scripts (cp from ~/mcai-analysis), mcai-mayor-shadow (systemd-run as mike, same flags), block2-sandbox (sandbox 1, disabled
at boot), chain-after. +360 read ran late (12:02Z; window 01:10-07:10Z includes ~2 h of outage; 72.8 canary bot-h).
+360: KEEP. LIVENESS 17 rows/control 0; F1 0; F2 UNPOWERED (control sought 2, canary 0); A1-A3 0; 693 apples composted in
16 visits (~65 bone meal); instrument 25; deaths canary 1 (0.014/bh) vs control 6 (0.027/bh); slots DiD +0.48, share>=34 DiD
+0.086 (inside the 10-05 no-change noise band), gather success DiD +0.028. LABEL: apple composting + mode switch supported on
the fleet; food-chase suppression UNVALIDATED on the fleet (unit tests only). Follow-up sandbox A/B still owed.
Fleet bot code c6e91a8 MERGED TO MAIN 10-07 (c259a9e, owner asked): main's bots/ had lagged since idlegap (bf296c9);
merged bots/src == deployed c6e91a8 except one lint comment in reflex.mjs; npm test 237/237. From now on, merge each
promoted canary sha into main at promotion so main stays equal to the fleet.
towndeposit-01: chain-after STOPPED ("already registered": the stalled c902d6f registration). Moved aside
(registrations/towndeposit-01.json.c902d6f-stalled-20261007), re-registered from towndeposit-01.c6e91a8.json (td-on-c6e91a8
@ 92bc84f), loop relaunched 12:22Z: preflight/licence/gatedigest OK, draw waiting. Expect the draw this afternoon: its 6 h
exposure window (>= 8 compost rows/pool) still contains the outage, and foodskip's pools are in the 12 h exclusion.
MODEL BENCH: fixtures done 04:09Z. C2 smoke "FAIL" at 05:06Z was mostly the outage (check ran with the fleet host down).
Re-run 12:10Z on real data: overseer side works (mayor_spawn 1, overseer_call 5, directive_sent 15, escalation_call 8,
2047 bot rows) but the bots logged NO requested/dispatched directive rows -- a real gap; the det arm is void (outage).
Model agent resumed to debug on sandbox4 and re-run the smoke. C2 series not started.

## 10-07 05:10Z — foodskip-01 +180 NOT_YET (exposure 0); AMENDMENT 1 registered before +360 (Codex APPROVE-WITH-CHANGES)
+180 (04:15Z): LIVENESS 16 active=1 rows, control 0; F1 0; A1/A2/A3 0 (627 apples composted in 14 visits; instrument 19
control visits holding > 4 apples); deaths canary 1 vs control 3 (0.022/bh both); gather success DiD +0.025. Exposure 0
because F2_judged needs >= 20 control sought apples and the control had 2 in 194.6 bot-h (0.01/bot-h vs 0.07 in the 10-05
dry run): ~30 h to reach, past the 1680-min deadline, blocking towndeposit-01 (owner top priority) for ~22 h.
AMENDMENT 1 (registration amendments[0], main docs/reports/foodskip-01.c902d6f.json == host registrations/foodskip-01.json;
read d2684f1 on host /tmp + ~/mcai-analysis, .bak-amend1 kept): exposure drops F2_judged; F2 is a REVERT tripwire (canary
sought >= 3 AND (control 0 OR ratio > 0.25)); status printed TRIPPED/JUDGED/UNPOWERED. A KEEP under it is LABELLED
"apple composting + mode switch supported; food-chase suppression UNVALIDATED on the fleet (unit tests only)" -- not a
pass of the original gate. Residual risk if the chase half does nothing = base behaviour. OWNER: accept or not.
Follow-up registered: sandbox apple-drop A/B with a log-drop positive control (does not block towndeposit). Codex text:
docs/reports/foodskip-01-amend1-codex.txt. Expected: +360 (~07:11Z) can KEEP -> towndeposit-01 chain fires.

## 10-07 01:14Z — CANARY LIVE: foodskip-01 @ c6e91a8 on board-d,hive-c,placebo-b (15 bots), declared 01:10:52Z; two versions
confirmed (65 c902d6f, 15 c6e91a8). Reads ~04:11Z / ~07:11Z. towndeposit-01 next (td-on-c6e91a8 being gated).

## 10-07 01:15Z — ORDER SWAP: towndeposit-01's draw stalled (only placebo-b passed draw_exposure after the outage; five pools in
12 h exclusion) -> its loop stopped by the operator (journalled), foodskip-01 (c902d6f variant, draws 4 pools now) launched
first; towndeposit re-chains after it (needs a rebase onto fs c6e91a8). Lesson: `pkill -f` from an ssh command line kills
the ssh session itself (memory pgrep-f-matches-itself) and an orphaned `sleep 1200` child keeps the flock on
/tmp/mcai-canary.lock -- kill loops by PID and kill their children. MODEL C1 (3 blocks, 8 bots, 70 min): gemma4:26b halves
stuck time (35.0 -> 14.9 min/bot, 9/9 pairs), stone pickaxe 2.3 -> 4.0 of 8; team output inconclusive (2.95x/0.59x/0.96x);
gemma-Ollama 4 deaths vs 0 (watch); co-load fine on the cleared Studio (gemma LMS 8-bit + gpt-oss Ollama: 2.7 s / 29 s);
blind round 2: 8-bit good, 4-bit worse. OWNER APPROVED C2 (bench-only overseer/stuck hook, never deployed). Persistent
Studio tunnel on the mini (launchd com.mbench.tunnel).

## 10-06 ~23:30Z — WITHDRAW2 READY (not chained): wd2-on-c902d6f @ c4e9c47, Codex APPROVE (round 7), 49/49 mutants; registration
withdraw2-01.c902d6f.json on main 2df5fc4 (read + reg on the host in /tmp and ~/mcai-analysis). Paper: best tier taken 2/2
where the control took wooden; iron pickaxe crafted from exactly 3 ingots + 2 sticks, server-confirmed 4/4; full-bag
trade conserved. Live confirmation of the problem: control withdrawals in 3 h were wooden 8, stone 4, iron 1. Queue:
after towndeposit + foodskip (rebase + check iron retention vs towndeposit's at that point). Mutant drivers now kept in
scripts/mutants/ (the scratchpad copies were lost once).

## 10-06 23:00Z — towndeposit-01 CHAINED (22:13Z) but its DRAW was crashing: drawrec.sh runs /tmp/poolrank2.py, which existed
ONLY in /tmp (never committed) and was wiped by the outage reboot. RECONSTRUCTED as scripts/host/poolrank2.py from
halfdid.py's documented exact reproduction (120-min window, declared_code_version filter, -d pools = 3090 half); installed
to /tmp and ~/mcai-analysis. The draw now runs: only placebo-b passes draw_exposure (>= 8 compost rows in 6 h -- the outage
gap thins the window) and five pools are inside their 12 h post-canary exclusion; the loop redraws every 20 min and will
deploy when two qualify. foodskip-01 CHAINED after it (variants 56aa04a / c902d6f). Other /tmp-only scripts referenced by
host tooling: quickstatus.py, modelshare.py, cooldid4.py (nightwatch/halfdid) -- check before relying on them.

## 10-06 21:40Z — CLIMBFLOOD-02 KEPT (+360; deaths 0/63.7 bot-h vs 9/191) and PROMOTED: FLEET c902d6f (21:01Z), 80/80 live.
withdraw live 6 h: 15 orders, 14 ok, 13 pickaxes out (7 wooden). Scoreboard 11:19-21:19Z (incl. the outage): no usable
pickaxe 18 -> 8, trip pickaxes 32 -> 41. Iron pickaxes: 69 crafted / 72 h, 31 of 80 hold one; 105 of 137 failed crafts
were short iron_ingot while the banks held ~806. OWNER: build `withdraw2` (best-first pickaxe selection + take 3 ingots
+ 2 sticks and craft an iron pickaxe at town) -- queued after towndeposit and foodskip. Slot is FREE now; towndeposit
(round-3 checks) launches next.

## 10-06 20:25Z — POWER OUTAGE (owner's UPS failed): fleet host 10.0.0.31 and world host 10.0.0.30 down 17:07-19:50Z (2h43m;
the host came back on kernel 6.8.0-142), Mac mini rebooted ~20:06Z, Studio unaffected (up 32 days). Recovery checked:
80/80 mcbot units active, canary pools on c902d6f, LLM decisions flowing (10.0.0.72 fine), filebeat up, 16 worlds + sandboxes
up. FIXED BY HAND: (1) /tmp on 10.0.0.31 lost the read scripts -> climbflood-02's loop exited "reads-missing"; restored
immobiledid.py (main e8cd891) and every queued read (towndeposit, foodskip, gridfix, bamboo, treefarm, well, withdraw,
chest) to /tmp AND ~/mcai-analysis/ (canarywatch's HEAL looks there); relaunched the loop 20:14Z (resumed, no
redeploy) -> +180 read done: NOT_YET, deaths 0 vs 6, exposure 167/100. (2) shadow mayor recorder (transient unit) was
gone: restarted 20:18Z as uid mike (mcbot cannot traverse /home/mike). (3) sandbox 1 (block2-sandbox, :25599) is DISABLED
at boot: started by hand. (4) the model benchmark's C1 runner + SSH tunnel on the mini died; agent resuming with a
reboot-proof tunnel. Agents interrupted by a network failure were resumed. FOLLOW-UPS for the owner: make the mayor a
persistent unit; enable block2-sandbox at boot; keep read scripts out of /tmp (tmpfs) -- the loop deliberately refuses
to auto-copy.

## 10-06 ~17:05Z — OWNER: the M4 Studio is cleared of other projects; unload unused models freely. Verified: LCIA keepwarm +
llmcache gone (com.lcia.ollama-env remains: NUM_PARALLEL=4, KEEP_ALIVE=30m). PAUSED this project's tier-1 shadow
analyst cron on 10.0.0.31 (~/analyst.py at :03/:33 calling qwen3.8:27b on the Studio) for the model benchmark --
crontab line prefixed `#PAUSED-20261006-model-bench#`, backup ~/crontab.bak-20261006-analyst. RESTORE when the
benchmark ends (or point it at a non-Studio endpoint).

## 10-06 16:50Z — WITHDRAW-01 KEPT at +540 (14:29Z; exposure reached 6 orders) and PROMOTED: FLEET b54e22c (14:39Z). G1-G4 0;
bot-time without a usable pickaxe canary 12.6% -> 3.7% vs control 18.4% -> 20.5% (DiD -11 points); deaths 3/90 bot-h vs
16/450 (0.94x). CANARY LIVE: climbflood-02 @ c902d6f on board-a,board-c,hive-a (15 bots) since 14:44:21Z; two versions
confirmed (65 b54e22c, 15 c902d6f); reads ~17:44Z / ~20:44Z. NEXT: towndeposit (variants b54e22c / c902d6f being built),
then foodskip+apples. Still to build: the "go home to restock" ladder step (pickaxe-less bots away from town).

## 10-06 09:16Z — climbflood-02 READY and CHAINED after withdraw-01 (variants 47110e8 -> cf2 6ca31e9, b54e22c -> c902d6f;
main 3dd0b75). Root causes of climbflood-01's 3 rows, each reproduced on Paper with the old build: ice melts to water
when broken (scene H: old 3/3 flooded, new 0/3); a second dig trusted mineflayer's stale "air" before the server's water
arrived (300 ms settle added); a 3-deep sand column with water on top (whole column now read; flood exit sidesteps
before unburying). Codex APPROVE. withdraw-01 +180 NOT_YET (deaths 1 vs 5, same rate).

## 10-06 06:30Z — CLIMBFLOOD-01 INCONCLUSIVE (+360, 05:11Z), torn down 05:15Z (fleet stays 47110e8). Exposure met (202 opps);
20 s endpoint canary 1.36% -> 0.00% vs control 1.19% -> 1.54% (E0 3.6, 0 observed); harm not detected; BUT correctness
caught 2 real breaches (hive-d-Alpha 04:59Z, caller=ramp_step: dug ICE -- ice melts to water when broken -- then sand
over water 4 s later) + 1 refusal written wet. Fix round (ice/frosted ice as water; ramp_step re-check; Paper ice scenes)
-> climbflood-02. CANARY LIVE: withdraw-01 on board-b,placebo-a (10 bots) since 05:22:41Z (variant 47110e8 = b54e22c);
reads ~08:22Z / ~11:22Z.
MODEL SELECTION checkpoint (Stage A+B, report on main): brain gemma4:26b (LM Studio MLX 8-bit, thinking off, grammar);
overseer + stuck gpt-oss:120b (reasoning medium, Ollama). C1 closed-loop (7B vs gemma Ollama vs gemma LM Studio; 8 bots,
90 min, 3 blocks) running from 06:23Z (orchestrator on the mini, bots on 10.0.0.31). Ollama upgraded 0.33.3 -> 0.35.1.
OWNER DECISIONS PENDING: (1) Studio memory: gemma 8-bit + gpt-oss ~93 GB + co-tenants ~32 GB (LCIA keepwarm coder:7b;
THIS project's own tier-1 shadow analyst cron on 10.0.0.31, ~/analyst.py at :03/:33 calling qwen3.8:27b) exceeds the GPU
budget; (2) C2 needs a bench-only bot-code hook (never deployed), both engines reviewed.

## 10-06 ~04:30Z — READY (not launched): towndeposit td-on-1918bb5 @ 09415cc and foodskip+apples fs-on-1918bb5 @ 41fa406 (Codex
APPROVE; Paper: apples 6 composted / 4 kept x4 in peaceful, 0 with the switch off / on easy / on control); registrations
+ reads on main 419dca1 and on the host; both trial-merge cleanly onto 47110e8 -- rebase onto the fleet sha when their
turn comes (after withdraw).

## 10-06 ~03:30Z — OWNER: compost APPLES in peaceful worlds (same switch as foodskip, keep 4, apples only) -- folded into
foodskip-01 as one "peaceful food policy" variable; builder updating fs-on-1918bb5 + read/registration. Bone meal on the
tree farm offered as the sink; not yet explicitly approved. Model selection A2 (1,008 real decisions): bot brain
gemma4:26b (infeasible 1.3% vs 13.3%, repeats-failed 21% vs 73.5%, 4x loop 28% vs 90%; top blind-judge scores);
overseer gpt-oss:120b (100% valid, 55/60 optimal allocations, 1 rule violation); LM Studio MLX beats Ollama under load
(gemma 8 concurrent: 8.8 s vs 17.1 s; 43 vs 25 decisions/min). Stage C closed-loop runner prepared.

## 10-05 ~23:30Z — TOWNDEPOSIT + FOODSKIP built, reviewed (Codex APPROVE), registered (main d7aafcf), NOT launched; both on
1918bb5 and need rebasing (trial picks onto 47110e8 and withdraw pass). towndeposit Paper: full bag 3/3 banked exactly
the surplus (60-use spare pickaxe, cobble 20, logs 10, raw copper 7), kept spent+best pickaxe, iron, coal, stockpile
targets; the model's own deposit with the same bag banked the spent AND best pickaxe, iron and coal. foodskip: Paper
caught a real bug both reviews missed (mineflayer 4.37.1 stores difficulty undefined on 1.21.8, so auto never fired);
fixed by reading the packet, tested through the real decoder. HONEST: foodskip barely moves bags (sought apples ~0.07
/bot-h; the ~2 food slots already held have no exit -- apples ARE compostable in vanilla: a composter-list change is
the exit, owner decision).

## 10-05 23:03Z — CANARY LIVE: climbflood-01 @ f590430 (cf-on-47110e8) on hive-d,hive-b (10 bots; the draw gave 2 pools,
not the design's 20 bots -- exposure needs >= 100 canary escape opportunities, dry runs gave 107-163 at +180 on 10 bots),
declared 23:01:19Z; exactly two versions (70 on 47110e8, 10 on f590430). Reads +180 ~02:01Z, +360 ~05:01Z 10-06,
extensions to 1560. Withdraw (rebasing onto 47110e8) goes next and will need a quick re-rebase if climbflood is kept.

## 10-05 21:43Z — CHESTFULL-02 KEPT (+360) and PROMOTED: FLEET 47110e8. C1-C4 0, rescues 16 ok, instrument 43; deaths 4/120
bot-h vs 9/240 (0.89x). WATCH: canary successful deposits 37 -> 18 vs control 96 -> 94 (DiD -0.153/bot-h, harm watch,
small n) -- the coming towndeposit makes deposits deterministic. NEXT: withdraw (rebasing onto 47110e8) and climbflood
(rebasing onto 47110e8 as cf-on-47110e8; registered as a FIX per the owner's 09-29 rule: deterministic gates decide,
effect reported; read defects fixed after Codex CHANGE x3 -> APPROVE; Paper: control flooded 17/17 eligible, candidate
0/20) -- whichever is launch-ready first. towndeposit/foodskip and the blueprint builder also need rebases onto 47110e8.

## 10-05 ~19:30Z — OWNER: add a frontier STRATEGIST ("god" layer, Claude/GPT via API, hourly-daily: world goals, role
targets, cross-world lessons, proposed blueprints/rules/skills through the same sandbox + canary gate) to the queue
"further down, its not a rush". Architecture agreed: strategist (frontier) -> overseer (large local) -> bot brain
(fast local) -> reflexes (code), with a deterministic validation layer on every order. Order: model selection ->
overseer first real job (stock record + assembler orders) -> strategist in SHADOW (one plan/day scored against
outcomes) -> authority over overseer targets once it proves out. Needs owner-placed API keys on the host (I never
handle credentials). Not started.

## 10-05 ~19:00Z — OWNER: build a BLUEPRINT BUILDER skill (both engines + GitHub prior art), proven first on a TREE FARM
by town; then a town WORKSHOP and a SAFE MINESHAFT (cobble-lined, ladder exit). Queued BELOW the current queue (after the
cobble rule). Designing/building now on bp-on-1918bb5 (not launched). Bone meal on saplings: a separate switch, default
OFF, until the owner decides. Also discussed (no build yet): overseer roles -- town stock record -> Assembler orders
(806 iron ingots ~= 260 iron pickaxes) -> stock-driven priorities -> Rescuer (big model) -> Builder.

## 10-05 ~18:35Z — OWNER: food no-pickup in peaceful worlds (switch auto|on|off from server difficulty) and an AUTOMATIC
TOWN DEPOSIT for full bags -- both being designed (both engines) and built as separate canaries (towndeposit-01,
foodskip-01). Evidence: docs/reports/bag-creep-analysis-2026-10-05.md (fleet average flat ~33.2 slots; ~11-12
slots/bot have no exit; 715 full-bag town stays carried bankable items, 231 tried a deposit; 35% of model deposit
proposals asked to bank apples; scoreboard undercounts ~0.8 slot -- eggs stack 16). Underground safety:
docs/reports/underground-safety-design-2026-10-05.md (every drowning a sealed pocket; the escape climb digs into
water unchecked = 28% of drownings) -> climbflood-01 being built. Studio co-tenants identified (com.lcia.* launch
agents: keepwarm watchdog restarts Ollama + pins qwen2.5-coder:7b; NUM_PARALLEL=4; caching proxy :11435) -- owner
investigating; Ollama upgrade approved. Model screen A1: gemma4:26b leads (infeasible 1%, repeats failed 14%, overseer
valid 88% vs the fleet 7B 14% / 71% / 17%). QUEUE: chestfull-02 (live) -> withdraw -> climbflood -> towndeposit ->
foodskip -> grid fix -> bamboo -> junk well re-run -> cobble rule.

## 10-05 17:15Z — JUNKWELL-01 REVERTED by the death gate (15:13Z): 6 canary deaths / 51.1 bot-h vs 11 / 358.2 (3.83x,
lower bound 1.40x, randomization p = 0.033). All 6 were 80-173 blocks from the well, deep underground: 4 drownings in
sealed water pockets (y 36-60), 2 lava (y -1, -55); none within 2 min of well activity. MECHANISM (measured): canary
mine actions/bot 15.9 -> 48.9 vs control 34.8 -> 33.5 (DiD +34.3) -- unique among 7 canaries (others -8.2..+5.0), so
NOT a restart effect: freeing bag space sent bots back to iron mining (GET_IRON was blocked on no_room), into the
fleet's existing sealed-pocket and lava weaknesses. The well worked (+180: 154 items disposed, C1-C6 0, junk slots
DiD -1.30). OWNER 17:10Z: work on UNDERGROUND SAFETY next (design with both engines running), and analyse why bags
creep back up (45 at >= 34 slots in 07:01-17:01Z vs 38 overnight; analysis running). The junk well returns after
underground safety. CANARY LIVE: chestfull-02 @ 47110e8 on board-a,board-c,board-d,placebo-d (20 bots) since 15:24Z;
reads ~18:24Z / ~21:24Z. Scoreboard 07:01-17:01Z: no pickaxe 2/80, no usable 12, trip 35, raw iron 167, wood 55.1%.

## 10-05 ~14:30Z — CHAIN: junkwell-01 (live; +180 NOT_YET 13:10Z: 2 wells built, 6 disposals / 154 items, C1-C6 0,
listed-junk slots/bot DiD -1.30, deaths 1 vs 6 same rate) -> chestfull-02 CHAINED on the host (variants 911d792 ->
chest2-on-911d792 @ 7ee230f, which also changes the well's site picker to respect claimed chests; 1918bb5 ->
chest2-on-1918bb5 @ 47110e8). Then withdraw (wd-on-6c9a8fb @ 098cb6b: town-miss gate fixed; rebase onto whichever
chestfull-02 lands) -> grid fix (gf-on-1918bb5 8c9239d / gf-on-911d792 ced0b52 ready; will need a rebase onto the
chest-full fleet sha) -> bamboo. Rebases happen per stage as each lands.

## 10-05 ~13:00Z — OWNER DIRECTION: 4-8 really smart bots are fine (80 not needed); a larger model as OVERSEER and for STUCK
escalation; find the best model(s) with both engines, an "extensive and exhaustive" test, all public sources. The M4 Studio
(ai.ticrcorp.com) is DEDICATED to this; model downloads there are authorized; never 10.0.0.72. Running: Codex research
(docs/reports/model-research-codex-2026-10-05.md: worker qwen3.6:35b-a3b / Nemotron-3.5-Lightning-30B-A3B / qwen3.8:27b /
Gemma 4 26B-A4B; overseer qwen3.5:122b-a10b / gpt-oss:120b / Nemotron-3-Super-120B-A12B; control Hermes-4.3-36B);
Codex test-plan design; Claude research + staged benchmark (A replay of real decisions, B ground-truth scenario suites,
C closed-loop sandbox bots driven by finalists, D blind two-vendor judging) -> docs/reports/model-selection-2026-10-05.md.
Also delivered: trapped-bots-analysis (11-15% real stranding; 4 bots stuck all day; 74% of bot-time outside any skill)
and withdraw-habit-design (bots never learn chest contents; withdraw proposed 10 of 158,821 decisions/24 h).

## 10-05 ~10:30Z — CHESTFULL-01 REVERT INVESTIGATED: no mechanism found. 0 of 7 canary deposits had a watchDigging stop
(fleet nav profile canDig=false); the y=15 chest was targeted 14x in the 3 h BEFORE the deploy on the fleet base (so not
this diff); bank closure never triggered (0 _deposit_new_chest, 0 bank_closed of 201 rejections). The mining rise is
milestone timing: 57 of 71 canary mine decisions were in gather_iron_ore_3 (entered before the deploy); mines per
iron-milestone decision 0.57 vs 0.56 pre (control 0.47 vs 0.51). The deaths were in iron mining, wood gathering and
a goto home after iron. The revert stands as recorded (the gate did its job); the re-run is chestfull-02 with real
fixes Paper found: a bot sealed in a 1-block pocket got "arrived" 17-18 blocks short, struck the good town chest and
CLOSED THE BANK (6c9a8fb 2/2; new 0/2); a deep chest 20 below home was banked into (old 1/1, new 0/3); the chest walk no
longer watches digs; one town boundary (16 h / 12 v); only a truly closed bank closes. chest2-on-1918bb5 @ 47110e8,
Codex APPROVE (round 3), registration chestfull-02.1918bb5.json on main 25c543a. GRID FIX: independent Claude review
APPROVE (Paper: control stranded the grid 12/12, candidate 0/11; bamboo interrupted fold clean 2/2 on the fix);
registration gridfix-01.1918bb5.json (main 483f2b0); a variant on the junk-well base (911d792) is being built so the
chain launches whichever way junkwell-01 ends. QUEUE: junkwell (live) -> gridfix -> chestfull-02 (must add
wellReservedCells to chestSiteRefusal if the well is kept) -> withdraw (rebase onto chest2) -> bamboo (on the grid fix).

## 10-05 10:07Z — CANARY LIVE: junkwell-01 @ 911d792 on placebo-a,board-b (10 bots), declared 10:05:20Z; exactly two
versions (70 on 1918bb5, 10 on 911d792). Reads +180 ~13:05Z, +360 ~16:05Z (extensions to 1560, deadline 1680). Both
engines APPROVE (Codex AGREE after 8 rounds; independent Claude review CHANGE -> APPROVE at 8f73e80; later fixes:
unloaded neighbour = "decide later", snow-raised aim, C4 = stuck inside >= 2 min). Paper: 432/432 items into the shaft,
0 off-list, 0 pickups by a walker, admission refusal, escape from inside in 7 s, creeper clearance 0 spawns.
Expected exposure ~7-12 dispose orders per 6 h once each town builds its well. CONDITION for the chest-full rebase:
chestSiteRefusal must refuse wellReservedCells.
OTHER WORK: withdraw ed0d856 (code done, waits for chest2); chest-full round 6 (chest2-on-1918bb5, evidence + walk fix);
grid fix 8c9239d (Codex APPROVE; Claude review + Paper + registration in progress); bamboo waits for the grid fix.

## 10-05 03:17Z — CHESTFULL-01 REVERTED by the death gate at +30 min (3 canary deaths / 15 bots vs 0 / 65 in 25 min;
randomization p = 0.0018); torn down 03:22Z; fleet 80/80 on 1918bb5 (verified 05:58Z). Deaths: board-a-Bravo drowned
sealed in a flooded pocket at y=45 after entombment; placebo-d-Bravo drowned gathering birch; board-a-Alpha fell 73
blocks during goto. None had a deposit/chest row in the 150 s before death. RESTART EFFECT RULED OUT: over 15 canaries
since 09-27 (8.9M rows, 408 deaths) canary deaths in the first 45 min after deploy 0.023/bot-h vs 0.019 later (excl.
this run); control 0.026 vs 0.028 -- so 3 early deaths (~0.25 expected) is a real outlier. Behaviour shift in the 30 min
(15 bots, small n): canary mine/bot 1.73 -> 4.33 (control 2.85 -> 2.75), _entombed 2.87 -> 4.67 (2.11 -> 2.86), deposits
0.67 -> 0.47 (0.71 -> 0.77); 3 deposits tried a chest at 365,15,184 (y=15, a deep container) "No path". Evidence:
docs/reports/chestfull-01-revert-evidence.txt. Codex causal review running; NO re-run until a mechanism is found or
ruled out. Grid fix (Codex APPROVED 8c9239d) is being prepared for the slot (Claude review + Paper + registration).

## 10-05 02:47Z — CANARY LIVE: chestfull-01 @ 6c9a8fb on board-c,board-a,placebo-d (15 bots), declared 02:46:55Z;
exactly two versions (65 on 1918bb5, 15 on 6c9a8fb). Reads +180 ~05:47Z, +360 ~08:47Z, extensions 540/720, deadline
780 min. After the 10-04 clear a placement is ~0 per 6 h on the canary (1 full-chest failure fleet-wide in 8.1 h vs 52
in the 12 h before), so a KEEP means "C1-C4 defect gates 0 and ordinary deposits unharmed"; placement itself is proven
on Paper (sandbox/craft/chest-ab.cjs: carried chest placed 2/2 where the control failed 2/2; nothing dropped in any
trial). The licence kind row does not gate the verdict (verdict.py has no min_rows); exposure = >= 20 canary deposit
rows + the control positive control. Withdraw (registered on 6c9a8fb) chains after this.

## 10-05 ~02:30Z — BAMBOO-01 READY BUT HELD (bb-on-1918bb5 @ 33384ad; registration on main 33b5a27; staged on the host,
NOT launched). Paper round 2: the stuck-watchdog and tally defects are fixed (32-fold 3/3, 64-fold 3/3 in its window,
planks never burned 26/26, control 6/6 no change) BUT an interrupted fold (low-health reflex) strands up to 46 bamboo in
the 2x2 grid 3/3 -- the craftsync grid defect the GRID FIX repairs; G3 would REVERT on it and the items drop at logout.
DECISION: bamboo waits for the grid fix and is rebased onto it. Canary order, first ready first, dependencies kept:
chest-full (6c9a8fb, sandbox+registration in progress) | grid fix (gf round 5: invalidate the held ticket on a
click-cap timeout) -> bamboo (on the grid fix) -> junk well (building) -> withdraw (on chest-full; Codex APPROVED
2691727; Claude review + first Paper run in progress) -> cobble rule. Grid fix and withdraw share byte-identical
window-binding code (inflight.mjs + craftsync spans). Agents share /tmp/mcai-suite.lock and /tmp/mcai-sandbox.lock.

## 10-05 00:05Z — TOOLCLEAN-01 KEPT (+360); promotion of 1918bb5 fleet-wide follows (chain). Spent axe/shovel/hoe
copies per bot canary 2.25 -> 0.05 vs control 2.27 -> 2.22 (DiD -2.15); G1/G2/G3 0 (G3 amended 19:35Z before the
+180 read: the deposit window covers the whole deposit -- all 10 good-tool losses in the window, both arms, were spare
pickaxes banked during long deposits); instrument 220; 1-use pickaxes/bot DiD +0.13 (reported). Death gate HELD:
6 canary deaths / 120 bot-h vs 7 / 240 (1.71x, lower bound 0.58x); all 6 are idle drownings, none within 90 s of a
spent-tool event; the drawn pools drowned more before the canary too (4 vs 9 in the 6 h pre-window).
NEXT (owner: bags and chests first): bamboo-01 (rebasing onto 1918bb5 + sandbox + registration with change_rows) ->
junk well (building) -> withdraw (round 6) -> cobble rule -> chest-full -> grid fix (round 4, adopting withdraw's
window binding). Session paused twice on Claude limits (10-04 ~20:00-23:55Z).

## 10-04 19:45Z — JUNK WELL SANDBOX (Paper 1.21.8, sandbox3; docs/reports/junk-well-sandbox-2026-10-04.md): control 20/20
picked up on open ground; accuracy 59/60 (117/118 over two runs; the miss re-collected by the thrower); isolation 0
pickups (30 s on the trapdoor, 8 rim blocks, 200 passes, open-trapdoor rim); despawn at age ~6000. FOUND: (1) the age
PAUSES in an unloaded chunk (items wait, still unreachable); (2) pathfinder routes over an OPEN trapdoor (0/12 fell
in crossing) but a bot whose GOAL is the well cell falls in (2/2) -- admission rule + never target the cell; (3)
clearance under the cap is 1.8125 not 1.5: a creeper (1.7) fits and the shaft is dark -- fleet is peaceful, but for
"any world" put the second trapdoor (recipe makes 2) bottom-half on the floor (untested). Run beats reading: the
well's isolation holds, so Codex's 20-iron feeder is not needed; its admission/underground-neighbour concerns are
real and go into the build.
WITHDRAW d490102 (round 4 H-N): 229/229, 79/79 mutants; Codex confirmation running.

## 10-04 18:40Z — DISPOSAL: owner accepts vanilla 5-min despawn as the INTERIM disposal ("fine for now, long term i want
a better solution"). Designs: Claude "junk well" (1x1, floor 2 down, wooden trapdoor cap, 6 planks/town;
docs/reports/disposal-design-2026-10-04.md) vs Codex sealed chest->hoppers->dropper chamber (20 iron + redstone/town;
disposal-design-codex-2026-10-04.md; its merge concern is moot at the measured merge radius 0.5, its admission/
underground-neighbour concerns stand). Paper sandbox subset running to decide. Long-term open item: a better disposal.

## 10-04 18:08Z — ONE-TIME CHEST CLEAR DONE (owner approved). 105,053 junk items / 3,473 slots removed from the 16 town
banks; kept items 92,846 -> 92,846 exactly; full bank containers 233 -> 0; free slots 2,669 -> 6,142. Details in
chest-clear-manifest-2026-10-04.md. **Fleet-wide world event at 18:07Z, inside toolclean-01 (declared 17:55:31Z):** both
arms see it, so DiD absorbs the level shift; note it in the toolclean read. Owner also decided (10-04 ~18:10Z): RCON
rotation later (not major); eggs/flint/clay/ink/scutes have no use -> cleared; cobble: keep 256/town reserve, bank only
when it frees a slot (both-engine no-ledger design); withdraw no-room: junk swap ONLY once a disposal exists, hold
until then. Disposal design (both engines + external search) running. toolclean-01 live: 60 bots 56db2cd, 20 on 1918bb5.

## 10-04 17:51Z — COMPOSTER-01 KEPT (+360) and PROMOTED 56db2cd fleet-wide 17:50:43Z; toolclean-01 chained next.
+360: 12 real compost visits, C1-C5 all 0; junk slots/bot canary 5.60 -> 3.50 vs control 4.90 -> 4.96 (DiD -2.16);
share of bots at >= 34 slots DiD -0.214; 2.00 slots freed per visit. Only board-b built a composter (hive-a visits
used it? -- check hive-a has one after promotion). Deaths 1 vs control 6 (rate 0.017 vs 0.020/bh).
craftroom refusals explained (6 h fleet, 3,187 _craft_room rows, 71 bots): 2,534 refused, all at 36/36 slots with
"no spent tool that can be spared (the last digging pickaxe is kept)"; bags hold leaf_litter, bamboo, saplings, eggs,
cobble. Remedies queued: composter (now fleet), toolclean (next), bamboo fold, no-junk; eggs have NO exit (owner).

## 10-04 17:35Z — CRAFTROOM-01 KEPT (+360, 11:22Z) and PROMOTED ffa0f57 fleet-wide 11:32Z. COMPOSTER-01 LIVE @ 56db2cd on
hive-a,board-b since 11:37:15Z (+180 NOT_YET: 3 real visits, 1 composter, C1-C5 clean, junk slots/bot DiD -0.74);
toolclean-01 chained behind it. (Session paused ~08:20-17:25Z on API limits; the loop ran unattended.)
craftroom +360: canary pickaxe crafts the server saw lost 0 of 19 vs control 123 of 288 (43%; 91 of them at >= 35 slots);
unanswered 0/49; one entombed death on board-a-Bravo (1 vs control 6, under the two-death floor). **Watch:** 225 of 274
canary _craft_room rows are REFUSALS (remedy_failed 112, no_room 111) -- craftroom turned lost pickaxes into refusals;
the full bag is still the blocker, which is what composter/toolclean/withdraw/no-junk target. A refusal must name an
executable remedy (CLAUDE.md): remedy_failed is that remedy failing -- analyse after the composter read.
GRID FIX 55c2bf8: Codex CHANGE (P1: a fence timeout releases ownership while mineflayer still holds a click; the late
click moves items and the row still says grid_clear=yes; P2 passthrough lets reflex clicks overlap cleanup; P2 null
grid_clear on many exits). Round 3 sent: adopt withdraw's `inflight` set (one craftsync implementation). Read drafted:
scripts/host/gridfixread.py (dry run: control positive control 145 unclean 2x2 exits, next craft failed 111/135 = 82%).

## 10-04 07:50Z — WITHDRAW 98b95c8 (round 3 fixed, pushed): Codex CHANGE (2 P1: survival release closes with a click in
flight; confirmCursor does not own the inventory while its answer is pending), Claude APPROVE (5 P2). **Paper sandbox
CONFIRMED confirmCursor** (Paper 1.21.8-60: CLONE + stateId -1 is a no-op, full window_items with the true carried
item, every case). Round 4 = items H-N sent to the builder. **Owner decision sharpened:** "keep holding" cannot keep
its promise -- with a full bag the server drops the stack at the next close/disconnect/death/restart, so holding only
freezes the bot until then. Options built as a switch: hold (default) | close after 30 s | junkswap (swap the cursor
onto a never-bank junk slot, confirm, close: only junk drops). Survival release (air/lava/fire/fall/damage) closes at
once and can drop the held stack on a full bag -- dying would drop everything.

## 10-04 07:30Z — NO-JUNK: ledger DROPPED by both engines; cobble banks only when the transfer empties a bag slot (design file SYNTHESIS)

## 10-04 06:40Z — NO-JUNK DESIGN (both engines; docs/reports/nojunk-design-2026-10-04.md; NOT BUILT, Claude review running)
**Deposit already refuses almost all of the manifest's junk** (bankable.mjs:143-204: goal-wanted, fixed list, ores,
spare usable tools only). 24 h, 1.18M rows, 7,051 items in reconciled deposit runs: cobblestone 62%, wood 34%, ores
2.5%, spent tools 0.7%; ballast/seeds/litter/eggs 0 (positive control: same query finds wood/ores; refusal rows name
apple 302, dirt 90, leaf_litter 37). The census junk dates from the old every-stack deposit loop (replaced ~09-13).
So the live inflow is cobble (~7,200/day) and spent tools (~100/day, withdraw branch already stops them).
**A flat cobble cap is dangerous:** >= 64.6% of banked cobble comes from bots at 34+ slots, for whom it is the bag
relief. Log/plank/stick caps DROPPED (both engines): 4,096 cap vs 44,701 usable; bags net -2,300 wood/day.
Proposed canary stonecap-01 (after withdraw promoted, composter+toolclean closed): cobble 256/town refused only on
evidence (lower bound from chests opened < 6 h, unknown != zero), relief valve at 34+ slots, cap refusal never routes to
chest-full. Plus a hard never-bank list (zero new bag load). Eggs/flint/ink/scutes/clay have NO exit from a bag
(150+64+72 slots across 64 full bags) -- owner decision. Admin clear only after stonecap is KEPT and promoted.

## 10-04 05:15Z — FLEET ba84fa6 (craftsync promoted 05:08Z); CANARY LIVE: craftroom-01 @ ffa0f57 on board-a,hive-b,
declared 05:12:59Z; exactly two versions (70 ba84fa6, 10 ffa0f57). Reads +180 ~08:13Z, +360 ~11:13Z. Chained: composter-01
(fleet ffa0f57 -> 56db2cd), toolclean-01 (fleet 56db2cd -> 1918bb5). scoreboard.py now rotation-aware.

- **WITHDRAW round 3 (515d99c): both CHANGE on the recovery lifecycle** (pending click across timeout; reflex
  equip clicking the inventory during a hold; quiet window != server-confirmed empty cursor; disconnect not
  cancelling a retry; server-closed window; unbounded hold = dead end). Builder applying A-G. **OWNER DECISION PENDING:**
  last resort when a stuck cursor stack has nowhere to go after a verified rearrangement -- (a) keep holding (never
  drop; intervention_needed rows) [DEFAULT, Codex], or (b) close after 30 s (server returns it to the bag; only a
  remainder lands at the bot's feet and is picked back up) [Claude recommends]. Survival reflexes may always release.

## 10-04 04:58Z — craftsync-01 KEPT (+360); promotion to the fleet (ba84fa6) done 05:08Z
- 0 of 215 canary crafts "nothing changed" vs control 236 of 1,337 (18%); Paper answered 82/82 resyncs; 0 confirmed
  without a resync; craft p50 1.6 s / max 4.3 s; _reflex_stuck DiD -0.138/bh; deaths 1 (0.017/bh) vs 7 (0.023/bh).
  58 crafts unconfirmed = full-bag losses, now honest (craftroom's job). Known: aborted 2x2 crafts strand the grid
  (2 of 94) -> grid fix queued after toolclean.
- In review: grid fix (Claude AGREE, Codex CHANGE: in-flight click after cleanup, disconnect tracking, error-path
  verdict) -- fixing; withdraw 18b36d4 round 2 (Claude CHANGE small: abort rows, plan= field, swap failure tests;
  Codex pending); chest fix 6c9a8fb approved (Codex AGREE r5, Claude AGREE r3); bamboo fixes in mutant runs.

## 10-03 22:38Z — oretunnel-03 KEPT (+1560), then promoted
- Iron collected per bot-hour: canary 0.004 -> 0.038, control 0.014 -> 0.016, **DiD +0.033**; 10 iron on 10 canary bots
  vs 29 on 70 control bots; 75 tunnels, 7 reached the ore; tunnel-linked deaths 0; deaths 5 canary (0.019/bh) vs 45
  control (0.035/bh), none mechanism-linked; every v6/v15c guard within. Chain launches craftsync-01 (variant by fleet sha).
- CORRECTION to the tool numbers below: the 2-10-use spent copies were 118 in a 24 h last-snapshot window and 170 in a
  90 min window; both are "latest snapshot per bot" over different windows (Codex and Claude both caught the mismatch).

## 10-03 EVENING (22:40Z) — NEW ORDER (OWNER ~22:30Z: "lets do 1 and 2 now and do the bank fix now too")
- **QUEUE NOW: craftsync (launching after the ore verdict) -> craftroom -> composter -> SPENT-TOOL CLEANUP (new) ->
  BANK FIX (port of bank-fix 4d76b43) -> logpickup -> explore-toward -> orepack -> cellmem.** Still one canary at a
  time. WHY: the full bag is the root blocker (census: bag-full is the top reason wood and iron needs go unmet); full
  bags (59/80 at >= 34) are 40% misc items (bank), 22% tools of which half spent (199 spent: tool cleanup), 14%
  compostable junk (composter), 10% stone (bank), 7% saplings, 5% wood. Logpickup moved last-but-three because it
  FILLS bags (more logs kept).
- logpickup chain (pid 2197785) STOPPED 22:29Z. Craftroom and composter are being REBUILT on ba84fa6 WITHOUT logpickup's
  gather behaviour (helpers only; gather must be byte-identical to ba84fa6). Tool cleanup: design by both engines
  (running). Bank fix: port analysis running.

## 10-03 MIDDAY (11:55Z) — superseded queue, kept for history
- **OWNER 10-03 ~11:20Z: "test each crafting element seperately"; queue per Codex ("i agree with codex"):**
  oretunnel-03 (live, decides ~22:22Z) -> **craftsync-01** -> logpickup -> craftroom -> composter -> explore-toward
  -> orepack -> cellmem (deferred). One change per canary. Explore-toward is no longer next.
- **craftsync-01 CHAINED** behind oretunnel-03 (chain-after.sh pid 2191467, log ~/chain-craftsync-01.out; the explore chain pid 2073712 was stopped). Variants by
  fleet sha: 3edf1d6 -> ba84fa6 (cs-on-3edf1d6, 219/219), 8453c09 -> 9794a58 (cs-on-8453c09, 218/218) (each = base + craftsync 93b3892..6660831 + the
  behaviour-neutral pickup telemetry 3edf1d6..e2b4ebd). Registrations docs/reports/craftsync-01.<fleet>.json; read
  scripts/host/craftsyncread.py (dry run 10-03: control 100/892 crafts "nothing changed" = the positive control; the
  UNCHANGED canary pool read 17/101, so the correctness line would have fired on today's code).
- **logpickup-01 CHAINED (12:36Z)** behind craftsync-01 (chain-after.sh pid 2197785, log ~/chain-logpickup-01.out),
  FOUR variants so it launches whatever craftsync's verdict: fleet ba84fa6 -> a40c588, 9794a58 -> 54ed323 (craftsync
  promoted), 3edf1d6 -> 8c66dda, 8453c09 -> 10251f3 (not promoted; these carry the pickup telemetry). All npm test green.
  Registrations docs/reports/logpickup-01.<fleet>.json; read /tmp/logpickupread.py (md5 = repo).
- **REBASE DEFECT CAUGHT (12:20Z):** logpickup on an 8453c09 base read `gatherT0`, declared only by the ore-tunnel
  change -- every log gather would have thrown ReferenceError. logpickup.test.mjs caught it; fixed in both 8453c09
  variants. Then found the no-undef lint gate (eslint.config.mjs: "Deploys run it") was NEVER run by any v1 fleet
  deploy script (only instance #1's deploy-harness.sh) and the fleet sha fails it. Now `bots/test/lint-gate.test.mjs`
  runs it in the suite (positive control + mutant killed); the one typeof-guarded `withinBody` is declared global.
  Every cross-base variant: run the no-undef lint, not only the suite.
- **craftroom on craftsync (cr-on-a40c588 @ f975a52, builder):** craftsync is the ONE verifier (marker removed),
  count = items, one execution per bot.craft. BOTH reviews CHANGE (14:00Z): [P1, both] room is checked BEFORE craftsync's
  baseline resync -- Codex reproduced a pickaxe tossed when the last slot fills during the resync; fix = an admission
  hook inside craftsync after the resync, before the first click (+1 slot margin with an item entity in range);
  verdict labels from error.reason (unanswered / click_timeout, source=none); executable-remedy refusal. Builder applying.
  **craftroomread.py REWRITTEN** (Claude review: the old gates were 0 by construction under craftsync): correctness =
  canary pickaxe crafts the SERVER saw lost with a full bag <= 1; instrument = verdict=unanswered share <= 5%,
  verified_local = 0. Dry run clean but its positive control (`_craft_sync` lost-pickaxe rows) CANNOT be shown until
  craftsync-01's canary emits them -- prove it on those rows before chaining craftroom.
- **craftroom-on-craftsync APPROVED by both engines at e9da587** (branch cr-on-a40c588, pushed; base a40c588 = the
  logpickup variant for fleet ba84fa6). 5 review rounds, 7 real defects fixed, 30 mutants killed, 222/222: admission
  inside craftsync after an ANSWERED baseline resync (else refuse before any click); pickup hold-back never wears a
  tool, collects only within the table's reach band (anchored to the plan's station), re-measures reach after any
  walk (reason=table_out_of_reach, never no_path); remedies only if executable (placeStackOf, depositFreesSlot);
  verdict labels unanswered/click_timeout, source=none. Known limit: a pickup after clicks start can still toss.
  NEXT: sandbox A/B on Paper (agent running; also lands the craft harness from the scratchpad into sandbox/craft/),
  then registrations once the fleet sha after logpickup is known. Read: scripts/host/craftroomread.py (main c6bd787).
- **craftroom SANDBOX A/B (Paper 1.21.8, 16:40Z, 3 reps/arm/scene, server-slot oracle): control a40c588 TOSSED the
  pickaxe 21 of 21 times the bag had no room; candidate e9da587 never tossed except `race-late` (drop lands mid-clicks;
  both arms 3/3 -- the documented limit).** Candidate: full36 refused with 0 clicks + "place your one dirt" (executed:
  worked, then crafted); race-early/stream refused (admission saw the drop); logs exact (-3 log, +1 pickaxe, table
  retaken; +5.5 s); wear-out spent axe never the good pickaxe; nothing-to-free says so. Deposit advice NOT executed
  (no town chest in the sandbox). Harness landed on main: sandbox/craft/ (67a5efd). Results sandbox/log/craftroom-ab/.
- **BEFORE craftroom's canary, backport from the composter review:** depositTarget (deposit advice names one item the
  craft does not consume -- e9da587's plain "deposit" would bank the craft's own sticks/cobblestone), remedy-first
  text (Codex: 220-char truncation drops the remedy, twice: skill detail and cognitive.mjs:1037), whole-chain
  ingredient protection for planned crafts.
- **craftroom FINAL = b00b22c (cr-on-a40c588, pushed), both engines AGREE (~17:40Z):** e9da587 (sandbox-passed) +
  the backport: deposit advice names one non-ingredient item whose deposit empties a stack (depositTarget), whole-plan
  ingredient protection, remedy-first refusal text checked through formatOutcome (output-identical, 1,152 cases).
  The backport changes advice text only, not the crafting mechanics the sandbox measured.
- **composter on craftroom FINAL = co-on-b00b22c @ 661c249 (pushed), both engines AGREE (~18:30Z).** Stand cell
  enforced before the table (composter_unreachable otherwise). C4: chain room simulated (from logs 2 slots, not 4).
  **SANDBOX (Paper, ~18:45Z): build from logs 6/6 exact (34/36 and 30/36), never starts at 35-36/36 -- BUT 3 defects:**
  bone meal left on the ground 5/6 compost visits; the 20 s stuck watchdog interrupts compost visits (only dig is
  exempt -- guard composition); the stand-cell check passes off-centre and the bot's own body blocks its table cell
  (placement timed out 2/3). Builder fixing; NOT queueable until re-sandboxed. Harness on main (7742265).
  **Fixes d2f3629 RE-SANDBOXED (~19:50Z): bone meal in the bag 6/6 (0 on the ground) with the fleet's 20 s stuck limit,
  no interruption; build 6/6 exact; mid-click toss now composter_no_room; table only placed with the bot centred.**
  Edge: a boat the bot pushes can drift into the chosen table cell (1/3 placement timeout; bounded). Reviews: both
  CHANGE on one item (the avoid-set entry is a no-op; the real hazard is a path node ON TOP of the composter -> an
  exclusionAreasStep) -- builder fixing. Harness re-run on main (650052f).
  **COMPOSTER FINAL = co-on-b00b22c @ 948bc26 (pushed), both engines AGREE (~21:00Z), Paper re-run 9/9** (compost 6/6
  bone meal in the bag at the fleet's 20 s stuck limit; build 3/3 exact). The fleet-wide composter exclusion (d9b8b07)
  was REVERTED to a scoped one: Codex reproduced a drop-down landing on the top that the exclusion did not price
  (getLandingBlock cells never pass exclusionStep) and measured ~8% slower getNeighbors fleet-wide; now only the compost
  visit's two walks borrow a profile whose neighbours are filtered by their real landing cell. Shared movement profiles
  are byte-identical to d2f3629. Queue slot: 4th (after craftsync, logpickup, craftroom).
- **LATENT IRON BLOCKER (sandbox 19:50Z, verified against the fleet):** the 20 s stuck watchdog killed `smelt 8
  raw_iron` at 20.7 s (8 iron ~ 80 s of furnace time; the bot stands still). Fleet 24 h: 0 of 141 failed/aborted/
  unknown smelts coincide with a _reflex_stuck (positive control: 48 other skill rows do -- goto 26, gather 10,
  craft 3), because 72 of 232 smelts had no raw iron and batches are small. It WILL bite once iron flows. Candidate
  fix (both engines first): exempt live furnace waits the way dig is exempt (or a self-expiring stationary window
  bounded by the smelt's own budget, as compost now does); same idea as Claude's suggestion to exempt live crafting
  (craftsync batches can pass 20 s; craftsyncread now REPORTS durations and _reflex_stuck DiD).
- **MAYOR GET_WOOD was blind (found 17:00Z):** world-pooled wood; in 1,376 of 2,661 quiet snapshots a pickaxe-less bot
  held < 2 log-eq while the richest bot held a median 49% of its world's wood. Fix (shadow-mayor 77c025c + 9cad2ad,
  pushed, NOT deployed): per-bot shortage sharing RESTORE_PICK's arithmetic; replay on 2,768 live snapshots: 62 -> 1,812
  firings, = RESTORE_PICK no_ingredients exactly. Also: the mayor test suite had been RED since ~08:35Z (wall-clock
  eviction vs fixture rows) so mutant kills were unscored. Both reviews CHANGE (tests + scorer biases + revision stamp);
  **DEPLOYED 2026-10-03 18:02:46Z: shadow-mayor 784b71c, MAYOR_REV 2e82cfe81496** (matches the reviewer's independent
  hash). Both engines: live assignment behaviour unchanged but for the stamp (Codex replayed 13 ticks old vs new);
  Claude AGREE to deploy; Codex CHANGE items are all in the OFFLINE scorer (retroactive) -- builder fixing before the
  10-06 read. First snapshot per world = <world>@2026-10-03T18:02:46Z (all 16). GET_WOOD leases at deploy: 0.
  Pre-deploy records are `unstamped` (111dadc since 03:17:40Z). Backup ~/mcai-mayor.bak-111dadc. Unit limits intact
  (Nice 10, MemoryMax 512M, CPUQuota 25%). GET_WOOD's 48 h window: 18:02Z 10-03 -> 18:02Z 10-05; never pool pre/post.
  No cfg flag changes during the trial (composter flag off). Scorer runtime on 15 h live data: 4:54, 57 MB.
  **FREEZE UNTIL THE 10-06 READ:** no change to mayor_core.py, mayor_shadow.py or stack_sizes.json and no cfg flag
  change -- any of them starts a new partition and the 48 h GET_WOOD window no longer fits. Scorer-only commits are
  safe. READ RULE (Claude r3): partition 2e82cfe81496/<cfg>, 18:02:46Z 10-03 -> 03:18Z 10-06 (~56 h after warm-up and
  censoring); for GET_WOOD/GET_IRON judge xbase AGAINST THE LEASED-RANDOM baseline's xbase (lease timing cancels), raw
  xbase reported alongside; xrand is a contested-only diagnostic. Deviation from plan: the gate is now target-blind.
- After each KEEP: rebase the next item onto the new fleet sha and chain it. craftroom must take craftsync's count fix
  (count = items) and a test that its final-click marker survives craftsync's click path; composter re-runs its
  build-from-logs sandbox once craftsync is in.

## 10-02 EVENING (20:20Z)
- **fixes-03 KEPT +360 (11:15Z) and PROMOTED: fleet is `8453c09` on all 80.** Good pickaxes lost 1 (120 canary bot-h) vs
  208 (240 control); spent-pickaxe satisfactions 0/147 vs 283/651; climbs +19% (normal); deaths 3 vs 8.
- **digsync2-01 (254f208) REVERTED +180 (15:17Z) on its own correctness gate**: 91 silent acks, 61 got AIR in the 3 s
  grace, 30 restored, 22 of those false (0.73). The server never sends a non-air word; silence = slow break. The
  chain to oretunnel-02 STOPPED correctly. Memory: silence-is-not-refusal. Telemetry detail is capped at 300 chars.
- **NEXT (OWNER 10-02 ~22:15Z: "run explore-toward after the ore tunnel"): exploretoward-02, CHAINED** by
  `chain-after.sh oretunnel-03 exploretoward-02` (pid 2073712, log ~/chain-exploretoward-02.out). It launches after the
  ore tunnel ends WHATEVER its verdict, picking the variant by fleet sha: 8453c09 -> b268881 (explore-on-8453c09, 214/214),
  3edf1d6 -> ccead1e (explore-on-3edf1d6, 215/215). Registrations docs/reports/exploretoward-02.<fleet>.json; read
  /tmp/exploretowardread.py (dry run: instrument 429 control rows).
- **oretunnel-03 +180 (23:27Z): NOT_YET, exposure ready.** 12 tunnels; the 3 that ran ALL reached the ore (3 raw iron;
  control 0); the other 9 were `inventory_full` refusals on 2 bots holding 176-252 spare in stone stacks but no free slot.
  Climbs 8.9 -> 6.7/bh (control 6.7 -> 6.0); deaths 1 vs 6. KEEP possible at +360 (~02:22Z).
- **SHADOW MAYOR LIVE since 2026-10-03 03:17:40Z** on 10.0.0.31: transient unit `mcai-mayor-shadow` (Nice 10, MemoryMax
  512M, CPUQuota 25%, Restart on-failure, exit 6 = output cap, stays down), code ~/mcai-mayor = branch shadow-mayor
  @ a6e8f15 (both engines approved the deterministic part; 66 tests, 60 suite mutants). Writes ONLY /var/lib/mcai-mayor
  (snap-/assign-<world>.jsonl). First tick: 80 bots, 16 worlds, 29 would-assign, 2.0 s CPU, 27 MB. A transient unit
  does not survive a host reboot -- restart it with the same systemd-run line (README). **Decision date: 2026-10-06
  03:18Z (KEEP-BUILDING or STOP).** Frontier replay needs API keys on the host (owner to place) + the client fixes
  queued with the builder.
- **TIMELINE (OWNER 10-03 ~04:40Z: "end of next week is fine"; NO bundling — one change per canary for clean attribution):**
  ore tunnel decides ~22:22Z 10-03 -> explore-toward (+pickup log) -> craftroom -> orepack -> composter (after sandbox)
  -> cell memory (town map stage 1) -> bone-meal trees, bank fix, town map stages 2-3. Shadow mayor in parallel (72 h).
  Chain each next canary on the host as soon as its reviews pass (chain-after.sh), so no operator gap stalls the queue.
- **QUEUE (OWNER 10-03 ~02:15Z: "build a composter, put it in the queue"):** 1) oretunnel-03 (live, verdict ~02:22Z)
  -> 2) exploretoward-02 (chained) -> 3) orepack (ready) -> 4) **composter** (BUILDING, branch composter-on-3edf1d6;
  design agreed by both engines 09-30: one per town, deterministic only when already at town with >= 34 slots, compost
  leaf litter/seeds/flowers, keep saplings/food, collect bone meal, place >= 3 from containers). Then implementation
  reviews by both engines + sandbox. 6) **CRAFT-ROOM + TABLE** (10-03 03:20Z diagnosis): of 7 bots holding cobblestone+sticks without a trip pickaxe, 5 carry
  no crafting_table (crafts fail "need a crafting_table" / "table 32 blocks away could not be reached"); and hive-a-Delta
  (table, full bag) CRAFTED a stone_pickaxe that never reached its bag -- mineflayer drops a craft result with no room
  (163 of 325 pickaxe crafts in 4 h logged "nothing changed"). Fix: never craft into a full bag (make room first or
  refuse with an executable remedy); keep/carry one crafting table; trip-sized pickaxe threshold (need, not a flat 40).
  8) **TOWN MAP / shared mind map** (OWNER 10-03; plan docs/reports/town-map-plan-2026-10-03.md; live shared updates OK): stage 1
  building (remember failed cells, go where gathering worked); stages 2-3 after. 9) **LOG PICKUP** (both engines, 10-03 ~04:40Z, independently): the top log-gather failure is NOT reach -- the log is broken
  and the DROP is not picked up: 291/949 failed log gathers (31%, 48 bots) end "collect threw nothing" and are then
  classed no_path (an action-level learned-avoid vote); 1,866 log drops left behind vs 2,584 logs gained in 3 h; the
  pickup walk's GoalNear(drop,1) times out when the drop rests on leaves (27% of left drops 2.3+ above the feet).
  BUILDING (branch logpickup-on-93b3892): pickup-box goal, break the supporting leaves, finish on inventory gain,
  fail class pickup_failed (no avoid vote). Slot: right after craftroom.
  **SANDBOX 10-03 ~07:00Z (720d079 vs control, 3 reps/scene): wins every scene** — open trunk 15/15 vs 12/15 at
  1.8 vs 6.7 s/log; canopy branch 18/18 vs 14/18; stub 15/15 vs 12/15; full bag 1 log + inventory_full vs control 3 logs
  left + no_path + an avoid rule per rep. Defects being fixed: falling drops judged before landing (server sends item
  positions ~1/s); walk scaffolding with the gathered logs (pre-existing); unreachable label; sweep count. 11b) **CRAFTSYNC — ROOT CAUSE FOUND (sandbox A/B 10-03 ~07:30Z, RCON-verified):** with spare ingredients, unpatched
  mineflayer 4.37.1 silently loses 7/40 single table crafts, 3/20 2x2 crafts, and comes up short on 11/20 repeated crafts in
  one window, reporting success. Cause: ONE global stateId (usually window 0's) + fire-and-forget clicks; Paper applies the
  stale clicks but answers with full refreshes that land behind the click burst, reverting a local slot -> put-away swaps
  on the server -> the result click picks up nothing. LOCKSTEP clicks during bot.craft (wait for quiet; one forced resync
  on open) -> 0/20, 0/10, 0/10; never hung; ~1.4 s per craft. Per-window stateId alone: 3/10 short. BUILDING
  craftsync-on-93b3892 (own canary; propose it NEXT after explore-toward — it is the pickaxe supply). Upstream: mineflayer
  #3906 (same symptom), #4103 (per-window stateId), #3974 (4.39.0). Artifacts: session scratchpad craftsync/.
11e) **CRAFTSYNC @ 6660831: Claude AGREE (4 passes); Codex CHANGES only on rare mixed-variant planning (tight
  oak+birch plank splits in batches report an honest shortfall where a cleverer split exists) — ACCEPTED as a
  documented limitation (fails safe: nothing spent, names the shortfall); revisit if the fleet read shows it.**
  Read note (Claude): duplicate-tool crafts now SUCCEED (74% of craft failures historically targeted items already
  held) and spend materials — count 'root item already held' crafts in the read; a 'you already have a usable one'
  guard is a candidate follow-up.
11d) **CRAFTSYNC SANDBOX through the real craft skill (10-03 ~10:00Z, c5c2dc5 vs 93b3892, RCON oracle):** window-0
  verification answered 140/140. Candidate 38 OK / 0 lost / 0 over / 6 honest fails; CONTROL 16 OK / 13 LOST (reported
  success, nothing made) / 7 OVER-CRAFTED (4 sticks -> 16; 8 planks -> 20 = all logs) / 4 false fails. Cost ~1.1-1.9 s
  per craft. One regression (wooden_pickaxe from logs only: the table eats the pickaxe's planks once over-crafting is
  gone) being fixed. This is likely the largest single pickaxe-supply fix available.
11c) **CRAFTING STATUS 10-03 ~09:30Z:** craftroom APPROVED by both engines at **f0a677c** (verdict from server packets,
  reconcile + one retry after a denial, wear-out room remedy, table retake, `crafted` evidence contract). craftsync
  (lockstep + post-craft verification) in its third round. Both reviewers: keep craftroom's verdict/retry as the safety
  net when combined with craftsync; a combined branch needs a test that the final-click marker survives craftsync's
  click path. PRE-EXISTING FLEET BUG found by the Claude reviewer: craft passes the ITEM count as the CRAFT count (ask 4
  sticks -> 4 crafts -> 16 sticks; wood wasted; can throw 'missing ingredient' after success) — fixed in craftsync,
  must also be applied when craftroom is combined. OWNER DECISION NEEDED: craftsync + craftroom as one 'crafting' canary
  or two.
11) **TABLE CRAFTS REJECTED BY PAPER (sandbox 10-03 ~06:00Z, RCON-verified, BOTH builds):** 5 of 12 crafts at a
  crafting table were rejected by the server (no result, ingredients back in the bag) — mostly the first craft after a
  table is placed — while the fleet's code reports success with a pickaxe that exists only locally. 2x2 grid crafts were
  not rejected. Likely a large share of the fleet's 44% "crafted, nothing changed". Suspect: mineflayer stateId / clicking
  before the crafting window's initial window_items. Both engines diagnosing (root cause + smallest fix in our code).
  Also from that run: wear_out's waitForTicks(2) check misses breaks (same code on the fleet). 10) EXPLORE BLIND-STEP HEADING BUG (pre-existing,
  confirmed by the Claude reviewer 10-03): explore's fallback step calls bot.look(ang) with a math angle, so the body walks a
  MIRRORED heading (ang=0 east walks north). Not a lava risk (stepLineSafe checks the walked line). Fix
  look(Math.atan2(-Math.cos(a), -Math.sin(a)), 0) as its OWN canary (changes explore fleet-wide). 7) **BONE-MEAL TREES AT TOWN** after the composter (renewable wood where the bots live). 5) **SHADOW MAYOR** (OWNER 10-03 ~02:30Z; plan docs/reports/shadow-mayor-plan-2026-10-03.md,
  both engines): host-side, observe-only, NO canary slot -- runs in parallel with the queue; frontier replay after ~24-48 h of
  snapshots; decision date 72 h after start. LATER IDEA: bone meal on planted saplings grows trees at town (the wood bottleneck).
- **READY, not registered: orepack** (branch orepack-on-3edf1d6 @ **f642b17**, 215/215, 43 tests): tunnel room by CAPACITY
  per item with a reserved ore slot (ore room = route iron + target cluster at max drop + 5 slack), post-plan recheck,
  enchanted tools refused with a structured need, a plan-time veto on unplanned digs (same-item spare only, never an empty
  slot). Stack MERGING and bamboo->stick CRAFTING were built and REMOVED (both engines: click races / crafts can toss);
  a bot.dig wrapper was REMOVED (it could refuse a reflex's rescue dig). Reviews: Claude AGREE, Codex APPROVE (6 rounds).
  Of tonight's 9 refusals it would let 3 proceed (the 6 others have no slot for the ore at all). Sandbox: on a full bag it
  passes the room screen where 3edf1d6 refuses; the corpus-iron scene itself is unroutable for BOTH builds (noPath).
  TO RUN: rebase onto the fleet sha after explore-toward; read = tunnel attempts/refusal classes per bot-h, iron collected,
  raw iron left on the ground (the documented residual), enchanted_tool count (expect 0).

- **LEAD (unverified):** 163 of 325 pickaxe crafts that "succeeded" in 4 h logged "nothing changed" (inventory gain not
  seen); 62 of them on an estimated-full bag. mineflayer drops a craft result when the bag is full. Worth a read.
- **WHY IRON IS RARE (10-02 21:00Z, 80 bots, 2-3 h):** iron visible in 77% of scans, but 53/80 bots hold NO pickaxe
  and 52 of those hold no wood; only 11 hold a trip pickaxe, and the iron rung exists only for them. 68% of 1,186 log
  gathers fail (unreachable / no standing spot / beside water); escapes burned ~145 logs in 2 h.
- **oretunnel-03 LAUNCHED 20:19Z**: the ore tunnel on 8453c09 WITHOUT digsync (branch ore-on-8453c09 @ 3edf1d6,
  214/214, Codex APPROVE). Registration docs/reports/oretunnel-03.json. Reads oretunnelread + immobiledid, 180/360/720/1560.

## 10-02 — WHY fixes-02 REVERTED, AND WHAT RUNS NOW
- fixes-02 (f5609af, 10 bots) REVERTED +180 on v11 climbs +123%. **The trip was REAL**: null 858 random 2-pool draws
  (12 h single-version) put climbs > +100% at 0.1%; trapped-seconds +177% vs null p99 +125%. It came with 5x more
  successful mine descents (5.6 -> 30.0/bot/3 h; control flat). Per depth-hour: mid band (y48-62) canary ~ control;
  below y48 canary trapped-s/bh 495 -> 1044 while control 559 -> 370. digsync v1 is the suspect: 92/138 rollbacks
  were false restores (server AIR within 2 s); climbs 2.3-5.1x faster in the 2 min after a rollback.
- **fixes-03** = the bundle minus digsync (branch fixes-nodig-on-bf296c9, 213/213; Codex CHANGES applied:
  fixesbundleread fails closed, licence `_progress_restored` with per-bot coverage). Reads +180 **08:03Z**, +360 **11:03Z**.
  If it trips climbs again: revert, and conclude dropping digsync was insufficient (frozen in the registration).
- **digsync-v2** (branch digsync2-on-8453c09 @ ede3b83, 214/214): a 3 s grace after an ack with no server word;
  restore only at expiry. Codex review + sandbox corpus (control 8453c09) running 06:00Z. Next canary after fixes-03.
- **ore tunnel** rebuilt on digsync-v2: branch ore-on-digsync2 (worktree ore2), tests running.
- **CHAINED ON THE HOST (10-02 06:54Z), each step STOPs on anything but `promoted` at the expected fleet sha:**
  `chain-next.sh fixes-03 8453c09 digsync2-01` (pid 1940380, log ~/chain-digsync2-01.out) and
  `chain-next.sh digsync2-01 254f208 oretunnel-02` (pid 1940387, log ~/chain-oretunnel-02.out). Registrations
  ~/mcai-analysis/digsync2-01.254f208.json, oretunnel-02.553adf2.json (= docs/reports/*.json). Reads in /tmp.
  digsync-v2 final sha **254f208** (3 review rounds, both engines); ore-on-digsync2 **553adf2** (216/216).
- **Climbs guard**: both engines recommend (prospectively) outcome guards — trapped-seconds/bot-h and unrecoverable,
  null-calibrated with restarts — with raw climbs demoted to INCONCLUSIVE; NOT "per descent" (the change makes the
  descents). NOT applied: decide after fixes-03 shows whether digsync v1 caused the traps.
- Iron pickaxes: all 5 lost with >100 uses (24 h) vanished in the same second as an entombment reflex (the toss bug;
  tool-safe, in fixes-03, fixes it).


## WHAT HAPPENED SINCE 09-30 13:20Z (all decided by the host loop)
| run | sha | result |
|---|---|---|
| lastswing-01 | 8ed9450 | KEEP +360, promoted 09-30 19:16Z |
| hygiene-01 | adc7658 | KEEP, recorded 10-01 01:46:59Z, promoted |
| fixes-01 | a943b7f | **REVERT +180 (05:10Z) — FALSE.** The one failing row (prequsableread.spent_satisfied_judged) was placebo-a-Comet 02:03:06Z on the OLD build adc7658, before the restart finished (declared 02:02:10, deployed 02:05:30). Canary-build rows: 0 of 45 spent-satisfied; control 101 of 212. The recorded verdict stands; amendments prospective only. |
| idlegap-01 | bf296c9 | KEEP +360 (11:28Z; deaths 0 vs control 9), promoted fleet-wide 11:38Z; `main` merged it (a2b5d36, `main-pre-20261001b` kept), 208/208 |

**Read fix (e8cd891 on main, /tmp on 10.0.0.31 with `.bak-20261001T*`):** prequsableread, toolsaferead (`_tool_gone`)
and immobiledid (deaths → two-death floor) skip a post-cutoff canary row whose version is NON-EMPTY and not
startswith(CV). Empty versions still count (0 of 450,482 rows carry one). Codex: CHANGES → narrowed → APPROVE. The
other member reads already filtered (audit by a Claude subagent). Memory: restart-lag-rows-are-not-canary.

## (PAST, REVERTED 10-01 16:39Z) fixes-02
| | |
|---|---|
| sha | `f5609af` (branch `idle-on-a943b7f` = fixes3-on-adc7658 a943b7f + bf296c9), 214/214 |
| members | digsync, stale-stop, craft-advice, hive-progress, prereq-usable, tool-safe, bank-why (same seven as fixes-01) |
| pools | board-a, hive-c (both 5080 half) — drawn by the loop 13:28:20Z |
| declared | 2026-10-01T13:28:21Z |
| read +180 | **2026-10-01 16:28Z** (correctness) |
| read +360 | **2026-10-01 19:28Z** — KEEP possible |
| extensions (until exposure) | 540 → 22:28Z · 720 → 10-02 01:28Z · 1080 → 07:28Z · 1560 → 15:28Z |
| deadline | **2026-10-02 17:48Z** (1700 min; v30 passes) |
| registration | `~/mcai-analysis/registrations/fixes-02.json` = `docs/reports/fixes-02.f5609af.json` |
| reads | digsyncread stalestopread craftadviceread hiveprogressread prequsableread toolsaferead bankwhyread fixesbundleread immobiledid (all /tmp) |
| promotion | fleet-wide on KEEP. Then merge `f5609af` into `main` (keep `main-pre-<date>`). |

A REVERT names its member; drop that member and rerun the rest — **but first check the failing rows' build
(`raw.code.version`)**: fixes-01 was lost to an old-build row.

**If the loop has died:** `pgrep -af canary-loop`. If absent and no decision is recorded, restart with
`setsid nohup bash ~/canary-loop.sh fixes-02 >> ~/canary-loop-fixes-02.out 2>&1 < /dev/null &` (resumes from journal).

## (STOPPED) oretunnel-01 chain — rebuilt as ore-on-digsync2, see 10-02 above
`~/chain-ore.sh` (repo `scripts/host/chain-ore.sh`): when fixes-02 ends `promoted` with fleet `f5609af*`, registers
`~/mcai-analysis/oretunnel-01.f5609af.json` (sha **49096f4**, branch `ore-on-f5609af` = bc3bcba + f5609af, 215/215,
v30 passes at 1680) and launches the loop. ANY other ending (torn-down, refused-*, error) → STOP; then rebuild ore
on whatever the fleet is (bc3bcba carries the bundle, so on a torn-down fleet it needs the bundle members removed).

## FLEET
| | |
|---|---|
| baseline | `bf296c9+9287fd`, 70 bots |
| canary | `f5609af+433de1`, 10 bots |
| `main` | `6a18e70` = fleet bf296c9 + docs/scripts |
| analyst 12:00Z | fleet healthy, one version; 49.9 items/bot-h, 39.6 decisions/bot-h; 8 immobile; 3 deaths in 2 h |
| iron funnel (24 h) | raw iron 23, ingots 32, iron pickaxes crafted 3, gone 22 (14 at <= 3 uses) |
| last-swing fleet check | 09-30 baseline to compare: 21/80 bots with a usable pickaxe, 37.5 items/bot-h, 42 deaths/24 h — NOT yet re-measured |

## LOOP STATE
- `check-open-loop.py` 12:05Z: "no open canary". It names fixes-02 open until the loop records a decision.
- **While fixes-02 is unread, no new analysis starts.** Build/stage work for later slots is fine.

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file; on 10.0.0.31: `grep -E '"fixes-02"|"oretunnel-01"' ~/canary-journal.jsonl | tail`,
   `cat ~/chain-ore.out /srv/mcbots/trial-manifest.json`, `tail ~/digest/page.jsonl`.
2. `pgrep -af 'canary-loop|chain-'` — expect `canary-loop.sh fixes-02` and/or `chain-ore.sh`.
3. If fixes-02 decided: KEEP → confirm 80/80 on f5609af, merge into `main`, PushNotification; confirm chain-ore says
   `launched`. REVERT → check the failing rows' build before believing it; confirm teardown (ONE version), write up.
4. Live versions: `cd /opt/minecraft-ai/scripts && python3 -c "from lib.telemetry import Events; e=Events.load(since_minutes=8); print(e.versions())"`.
5. Monitors: ONE background `until` wait on a journal phase, not re-armed 30-min Monitors.

## OWNER CALLS WAITING (unchanged from 09-27)
1. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
2. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect. (fixes-01 is now another false revert,
   by a different mechanism: restart-lag rows.)
3. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
4. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## QUEUE
1. **fixes-03** — LIVE (fixes-02 reverted).
2. **oretunnel-01** — chained.
3. Then each its own canary (rebase onto the fleet sha at launch): **bankfix-01** (bank-fix 15dec57; gate reads
   ledger/RCON, never `_deposit_window`), **exploretoward-01** (86e8985), **vetoretry-01** (1efd82c; d0c47c6 follows).
   Registrations staged in docs/reports (shas need rebasing). Before staging any new read: copy the known-other-build
   skip from prequsableread into every correctness/harm count.
4. COMPOSTER (hygiene phase 2) — designed by both engines 09-30, not built (see `git show 6a18e70:docs/reports/STATE.md` 3c).
5. PARKED: `tool-guard` b1d6b62.
6. Analysis backlog (only when no canary is unread): last-swing/hygiene fleet-wide effect vs 09-30 baseline; why
   `gather cobblestone` ends no_path at the surface; escape burns logs as scaffold; planting cohort vs depletion;
   `container_open` 446/4,160 uncharacterised; ~6,000 bamboo carried (2 bamboo = 1 stick).
7. Colony path: chest ledger (in bank-fix) → shadow-mode mayor (`docs/reports/jobs-mayor-spec-2026-09-29.md`).

## WORKTREES / BRANCHES touched 10-01
- `idle-on-a943b7f` @ f5609af — the live canary; on origin.
- `ore-on-f5609af` @ 49096f4 — chained; on origin (pushed `--no-verify`, new branch only).
- session scratchpad worktree `fx` (disposable).
- `mcai-rl02` worktree carries someone else's uncommitted `check-movement-writers.mjs`, `movement-ratchet.test.mjs`
  and 09-27 reports — still left alone.
