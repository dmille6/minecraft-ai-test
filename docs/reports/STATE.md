# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-21 12:05 UTC — **NO LIVE CANARY; 80 bots on `cfc1c58+e1d1b2`, one version, ledger clear (56 decisions).**
Today took no new ground: it tested the two claims the overnight session handed over and **corrected both.**
The change the handoff named as "THE NEXT CHANGE" would have covered 1.5% of its population — do not build it.
Read `starvation-corrections-2026-09-21.md` before touching the tool/craft thread._

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls back
> to the repo copy. **If the two disagree, take the later `_updated` stamp, not the documented order.** They
> diverged on 20 Sep and again on 21 Sep (the overnight session wrote only the repo copy, on branch
> `veto-feedback`, and left the lower half of that file stale). Both copies are written together today.
> **The overnight session's reports live in the REPO tree, not this docs worktree** —
> `tool-starvation-2026-09-21.md`, `needsdrop-01-premise-refuted-2026-09-21.md`.

## Fleet
- 80 bots / 16 Peaceful worlds. **`cfc1c58` fleet-wide, ONE version on all 80 (`cfc1c58+e1d1b2`)**, verified
  11:15Z today by a version census over a 30-min telemetry walk (80/80 bots, one string). `main` = cfc1c58.
  Previous mains: main-pre-2026-09-20 (b1659c0), main-pre-2026-09-17 (1d6c97d), main-pre-2026-09-16b (08a3da2).
- Fleet gather success **23.1%** over 8,791 runs / 360 min (committed 2-week gate is ≥40%). Deaths ~0.012/bot-h.
- **5 bots pinned ≥ 4 h** (`stuckwatch`): board-a-Alpha, hive-b-Comet, hive-d-Delta, isolated-d-Alpha,
  isolated-d-Echo. An operations alarm about individual bots — **not a fleet mechanism and not a canary endpoint.**
- **keepInventory=true and doImmediateRespawn=true on every world** (deliberate, place-town.py). Owner 18 Sep:
  it stays ON through the seed canary's 72 h, then goes OFF fleet-wide as its own registered program change
  (a world rule, never a canary) — queue item 8, after 27 Sep.

## No live code canary — the slot is FREE and the ledger is closed
Verified today at 11:12Z: `check-open-loop.py` says "no open canary"; `canary_pool` empty; no `canary-loop`
process (anchored `pgrep -af "canary-loop[.]sh"`, which does NOT self-match); ledger holds **56** decisions.
Last decisions: **needsdrop-01 REVERT** 21 Sep 10:28:16Z (recorded). **digwatch-02 KEEP / PROMOTED** 20 Sep
11:26Z. **digwatch-01 INCONCLUSIVE** 19 Sep. **leaf-01 REVERT** 19 Sep.
- **Gap worth knowing**: needsdrop-01 is in the LEDGER but appears in neither `~/canary-journal.jsonl` nor
  `~/digest/page.jsonl` — the overnight session read it by hand with a detached script, and only the ledger
  write is on that path. **The journal is not a complete record of decisions; the ledger is.**

## TODAY'S CORRECTIONS — both of the overnight handoff's forward claims
Full read, with denominators and positive controls: **`starvation-corrections-2026-09-21.md`**.
Scripts `equipblind.py`, `craftwhy.py`, `craftadvice.py`, `gout.py`, `birch.py` — saved to `~/mcai-analysis`
on **this Mac and on .31** (not left in /tmp).

### 1. "Stop swallowing the equip error at `skills.mjs:1185`" — DO NOT BUILD. 1.5% of its population.
`bestTool` → `applyToolPolicy` → `toolFor`, and `toolFor` filters on `remaining(it) > HARD_STOP` with
`HARD_STOP = 1` (`toolfor.mjs:15,51`). A pickaxe at 130/131 used has `remaining == 1`, so `eligible` is empty,
stone is not hand-harvestable, and `toolFor` returns `{item: null, reason: 'none'}` — **`if (tool)` is false and
the equip line never runs.** Measured at the nearest tools snapshot (median gap 1.0 s, p90 3.9 s):
**denominator 327 watchDigging collisions / 360 min — 321 (98.2%) had every pickaxe at remaining ≤ 1 so the
equip was NEVER REACHED; 5 (1.5%) had a swingable pickaxe and are a real, different bug; 1 no snapshot.**
- **"The remedy was in the bot's pocket" is now retired in BOTH forms.** Corrected once overnight (the claim
  never read durability) and again today (the line that would use a remedy is not on the path).
- The 98.2% is three correct policies composing: `toolFor` refuses a hard-stopped tool → `applyToolPolicy`
  deliberately puts a non-tool in the hand → `watchDigging` correctly cancels, because dirt cannot harvest
  stone. **The asymmetry that makes it a bug: `FLOOR` has an escape hatch (`reserved_required`); `HARD_STOP`
  has none, and `reason: 'none'` names no remedy the bot can perform from where it is.**
- **Raising `HARD_STOP` is still not the fix, and nor is a last-resort rung**: 261 dead stubs × 1 use = 261
  blocks once, fleet-wide. The ceiling is too small to canary.
- Fleet tool state, denominator 80 bots reporting: **18** can mine, **62** hold only dead stubs, **0** hold no
  pickaxe; **261 dead stubs** fleet-wide (board-a-Alpha holds six stone pickaxes, all at 130/131).

### 2. "The root is wood at 10%" — that is oak only; the fleet gathers at 23.1%
My first attempt to reproduce it matched substrings in `skill.detail` and returned **0.0% success for every
target** — a uniform answer, the signature of a blind detector. **The outcome is a field: `skill.status` /
`skill.fail_class`.** Corrected, denominator 8,791 gather runs / 360 min / 80 bots:
`oak_log` **12.1%** of 3,483 · dirt 55.6% of 2,313 · sand 14.0% · iron_ore 0.9% · cobblestone 10.9% ·
stone 19.9% · **birch_log 34.9% of 83** · oak_sapling 0.0% of 60 · **ALL TARGETS 23.1%**.
- **`oak_log` is 39.5% of every gather the fleet makes and is among its worst woods.**
- **The overnight session's central claim REPLICATES**: starvation is downstream, not causal — wood success
  **12.4%** on starved bots (2,767 runs) vs **13.5%** on healthy (800).
- Oak's largest failure is `no_safe_target` (1,244 of 3,483), text: *"found but all 10 candidates are beside
  water or under falling blocks — digging them would flood or bury this spot [liquid:10]"*. **This is direct
  support for queue item 3's leading hypothesis** (the bots flood their own surroundings) and it is the
  component the seed canary's fresh terrain cut by 69%.
- **The oak/birch gap is a HYPOTHESIS, not a finding.** The within-bot control is **n=1** (placebo-b-Alpha:
  oak 29/78 = 37.2%, birch 15/16 = 93.8%) and that bot is in a re-seeded pool. Selection is the live rival:
  oak is asked everywhere, birch only where birch is visible. Source: `milestones.mjs:184` is
  `M.gather('oak_log', 8, …)` while the counter was already widened to any log (`:563` "WOOD IS WOOD") and the
  hint at `:583` already says "or any other _log you can see". The fleet targets oak over birch **42:1**.

### 3. A refusal naming an unreachable remedy — real, and measurably INERT
84.2% of craft rows are refusals (896 of 1,064 / 360 min). Of **396** stone-pickaxe refusals naming a gather
target: **245 send the bot for `cobbled_deepslate`** (generates only below y≈0), 161 oak_log, 74 bamboo
(jungle only), and only **23 name `cobblestone`** — the one tag member available at the surface.
**Bot y at the refusal: median 68; 2 of 396 are below y=0.**
- **The check is NOT wrong**: 0 of 396 held ≥3 of the tag and were refused anyway. Advice only.
- **And the advice is inert: ZERO gather runs fleet-wide target `cobbled_deepslate`** (positive control: the
  same query resolves targets for 12 other blocks in the window, bamboo 91 and cobblestone 580 among them).
- **Therefore fixing the advice is predicted null and must NOT take the slot.** Its deterministic form is the
  missing `craft → gather` edge already on record — a design change, dual review first.

### 4. Materials (latest inventory snapshot; starved 62 / healthy 18)
cobblestone **27% vs 100%** · sticks 61% vs 67% · logs 23% vs 39% · crafting table 89% vs 83% ·
**can craft a stone pickaxe right now 5% vs 44%**. **Cobblestone is reverse-caused** — healthy bots hold it
*because* they can mine — so it is not evidence that cobble is the upstream constraint. The route that needs
no pickaxe is the wooden one, and only 5% of starved bots hold its materials while 23% hold ≥2 logs.

## SEED CANARY — the last registered discriminators land tomorrow
- **placebo-a +48 h DONE** (20 Sep, taken ~06:2xZ, 6 h late): gather DiD **+29.1 pp**; with the six
  canary-contaminated control pools dropped, **+32.1 pp** — contamination was *diluting* the effect.
  **Still not attributable to the seed**: the reseed-plus-reset confound has not washed out at 48 h, and the
  avoid-rule discriminator found **zero** `learned_avoid` rows in either arm, so that hypothesis is UNTESTED,
  not refuted.
- **placebo-b +48 h DONE today 11:26Z** → `~/digest/seed-placebo-b-48h.txt`. **Gather DiD +32.8 pp**
  (treatment 10.0% → 45.9%, control 18.5% → 21.6%); stock +18.84/bot-h; iron-pick share +30.8 pp; immobile
  −3.2 pp; deaths −0.010/bot-h **[5 bots cannot resolve a rate this rare — a tripwire, not a result]**.
  **Agrees with placebo-a within ~3 pp.** Positive control 2,420,762 rows / 80 bots / 127 kinds / 73.5 h.
- **THE REGISTERED REGRESSION-TO-THE-MEAN DISCRIMINATOR IS SATISFIED.** The registration declared in advance
  that placebo-b was the worst pool in the fleet (11.1% vs 19.4%) and set the test: *"If placebo-b improves
  and placebo-a does not, that is regression to the mean and not terrain."* **Both improved.** The pools were
  drawn **deterministically** (lowest SHA-256 of `<pool>+2026-09-18-seed-canary` per inference half), so
  "picked because they were doing badly" is not available as a rival.
- **INSTRUMENT DEFECT — do not use the read's CONTAMINATION block to choose the exclusion set.** It lists the
  treatment pool itself, and lists `b1659c0` and `cfc1c58` against every pool; those are **fleet-wide mains,
  not canary builds**. The real canary shas in the window are 2850cde, 1457f3a, b72781e. The
  `SEED_CONTROL_EXCLUDE` list actually used is hardcoded and does match the real canary pools, so no read was
  harmed — but the block reads like evidence and is not.
- **⚠ THE "CLEAN CONTROLS" ARM IS ONE POOL (five bots), AND NOTHING PRINTS THAT.** placebo-b's clean arm reads
  **+38.4 pp** — but its `control/pre` is **125 bot-h, identical to the five-bot treatment**.
  `seedread.py:90` drops every `isolated*`/`self-*` pool from **both** arms unconditionally (4 pools / 20
  bots), leaving 10 control pools = 1,250 bot-h; `SEED_CONTROL_EXCLUDE` then drops **nine of the ten**,
  leaving **placebo-c alone**. The header says what it dropped and never what remains.
  **This inverts the overnight reading**: that session treated placebo-a's clean `+32.1 pp` as the
  better-controlled figure, but at this fleet's measured noise floor (null sd **0.608 at k=5** vs 0.313 at
  k=20) **a single-pool control is the noisiest comparator available.** Neither arm is clean — all-controls
  (50 bots) carries real canary exposure, clean-controls has n=1 pool. **The sign and size are not in doubt**
  (+32.8 / +38.4 / placebo-a agreeing); the precision is.
- **CANDIDATE FIX — the `isolated*` pools, and the reason they are excluded is REAL but is about DRAWING.**
  `seedread.py:90` drops them from both arms with no comment. The draw ban exists because **there are no
  `_pool-isolated-*` state dirs on .31** (verified 21 Sep: `_pool-` dirs exist for board-a..d, hive-a..d,
  placebo-a..d and nothing else), so a canary cannot be deployed to them — **and that is exactly what makes
  them structurally incapable of contamination.** They are 20 active bots (isolated-a/b each have a stale
  sixth state dir, `Charlie`, which does not report).
  **Evidence the `:90` line is a slip, not a policy**: the comment immediately above it counts *"six of
  FOURTEEN controls"*, which only holds if `isolated` counts (16 pools less the two re-seeded); and
  `placebo-c`, under the same draw ban, IS admitted three lines down.
  **NOT YET ACTED ON, and deliberately so** — changing the comparator mid-series makes the +72 h read
  incomparable to the +48 h ones, and doing it after seeing +38.4 pp is choosing the comparator on the
  answer. **Register it as a proposal for a future read; do not slip it into tomorrow's.**
- **REMAINING: placebo-a +72 h 22 Sep 00:00Z, placebo-b +72 h 22 Sep 11:25Z** → outputs
  `~/digest/seed-placebo-{a,b}-72h.txt`. KEEP/REVERT do not apply (no code change). Both close clear of the
  24–27 Sep program window.
- **⚠ THE +72 h READER WAS BROKEN AND WAS REPLACED TODAY (prospectively, 11:45Z).** v1's `CLEAN` list
  excluded **placebo-c as well**, i.e. ten of the ten eligible control pools — **verified** by running v1's
  exact list against the closed +48 h window, which printed `control/pre 0 NO DATA -- refusing to report
  this cell as zero` and **no DiD block at all**. Both +72 h clean arms would have come back empty, and the
  +72 h read cannot be retaken. (The script's refusal is v24 working: no wrong number would have been
  published.) **Fix: drop `placebo-c` from the exclusion so the +72 h clean arm matches the one the +48 h
  reads used** — comparability preserved, not changed.
  v1 was **killed, not edited** (byte-offset re-read); v2 is `~/mcai-analysis/run-seed-72h-v2.sh`, running
  from a copy at `~/.run-seed-72h-live.sh`, **PPID 1, in its wait loop, due in 738 / 1,423 min** — and the
  new list is **proven** non-empty (control 125 / 245 bot-h). Full amendment in
  `seed-canary-registration.md`.
- **The tooling rival is TESTED and it does NOT explain the effect** (21 Sep, `seedtools.py`). The overnight
  session asked whether the re-seeded pools were simply the bots with live pickaxes. **The exposure half is
  true** — live-pickaxe share is **5/10 (50.0%) in the re-seeded pools vs 13/70 (18.6%) everywhere else**
  (five pools sit at 0/5). **But stratifying on tool state removes the rival:**

  | gather success | has a live pickaxe | only dead stubs |
  |---|---:|---:|
  | re-seeded | **50.5%** of 457 | **43.4%** of 541 |
  | all other pools | 18.4% of 1,262 | 20.1% of 6,520 |

  The seed gap is **+32.1 pp among tooled bots and +23.3 pp among starved bots** — it survives inside both
  strata. **The same table independently re-confirms starvation is downstream**: in the control pools a live
  pickaxe is worth 18.4% vs 20.1%, i.e. flat. Limitation: each bot is stratified by its *latest* snapshot, so
  a bot that wore out its last pickaxe mid-window has all its runs counted as starved; that blurs the strata,
  and it is two pools / ten bots treated. **This narrows the rival; the +72 h reads still decide.**
- Sample caveat (amendment 19 Sep): the population is **seeds on which the town SITES** — flat, dry, low
  relief. A later null is weaker than it looks.

## Queue
1. **Seed canary — +72 h reads only.** Scheduled detached (above). Add the live-pickaxe-by-pool check.
2. **v23 suite — what remains**: make uncalibrated linkage WATCH-only (v19 already demoted rung-linkage;
   confirm no other uncalibrated path can revert), and **calibrate or amend the invented 7× control
   denominator** (item 16). The 16-case / 11-mutant suite itself is DONE.
3. **NAVIGATION / GATHER — the only failing committed metric, and TODAY'S EVIDENCE STRENGTHENS IT.**
   `no_safe_target` is 1,759 of 6,265 gather failures fleet-wide and 1,244 of oak_log's 3,483 runs, with the
   refusal text naming liquid. The seed canary cut it 69% with fresh terrain. **Leading hypothesis: the bots
   excavate and flood their own surroundings and the safety check correctly refuses targets in it.**
   **This is the next canary and it needs the registered dual review (Claude + ChatGPT + an open-source
   search) before a build is proposed.** Read it on **acquired wood**, never on refusals avoided — `leaf-01`
   halved `unreachable` and the freed attempts became `no_safe_target` and `no_path`, not successes.
4. ~~The watchDigging equip remedy~~ **DEAD TWICE OVER.** The overnight session killed "equip rather than
   abort" (both review engines refused it); today kills "instrument the equip" at 1.5% coverage. Dig ownership
   belongs in the arbiter, i.e. inside owner-01c. **Do not revive this as a standalone change.**
5. **owner-01c — the movement owner, third attempt.** Never failed a guard; failed the apparatus twice.
   **Pre-flight landmine, verified**: `index.mjs:259` calls `runner.arb.installActuatorGate(...)` guarded only
   by `runner?.arb` existing, but **`installActuatorGate` does not exist in cfc1c58's `arbiter.mjs`** (it is
   only on `movement-owner-1`). With `ARBITER=1` on today's main that is a TypeError mid-spawn. Assert the
   method exists and `bot.dig.__arbiterGated` is true before declaring attempt three. **ARBITER is authorised
   for owner-01c only** (owner 18 Sep) — do not re-ask.
6. **DROWNING — demoted.** Do the one-hour read of the interrupt tax before spending a slot. Deaths cost 0.04%
   of bot-h. The health floor is **"not at full health", NOT "below 5"**. `floatDigTargets()` returns `[]`
   without a pathfinder plan, so the remedy is new code. **Do not bundle the floor with the dig.**
7. **falls-02 — the falls instrument FLEET-WIDE.** Behaviour-inert, needs no slot. Worktree `mcai-falls`
   (fc28885), rebase onto cfc1c58. **The cheapest thing on this queue; take it when a session has a spare
   hour it can watch to completion.**
8. **`keepInventory` OFF — after 27 Sep**, as a registered program change, never a canary.
9. **Extend `drawexposure.py` — two checks, NOT a new script.** (a) a non-degenerate pre-period on the primary
   metric; (b) exposure against the MDE-implied n. REPORT-only until calibrated against draws whose outcome is
   known (-13b, -13c, 1011b).
10. ~~Concurrent canaries~~ **DROPPED on engineering cost** (overnight, two-engine review): ~2% worse SD for
    twice the experiments, while raising k from 5 to 20 bought a 1.9× SD improvement for free. The *old*
    argument against it ("concurrency shrinks the canary") was wrong and stays retracted. Step 1 is already
    merged on `recovery-ladder-03` (`scripts/lib/version_split.py`, 20 tests, 5 mutants dead) and is harmless.
11. Pocket-rung block floor (need+4 with 5 held). **12.** Pooling rule -12 (iron).
14. **Teach the analyst the two-part OpenLoop test.** **TRAP: `pgrep -f canary-loop` SELF-MATCHES** — any
    command line containing the string, including the check itself and any `ssh host '... pgrep ...'`, so the
    naive test returns "loop alive" unconditionally and suppresses exactly the alarm it exists for. Use
    `pgrep -af "canary-loop[.]sh"` (verified today: correctly returns NONE with no loop running) and **prove
    the detector reports DEAD before trusting it.** `canarywatch.py` (cron */10) now covers STALE and
    ORPHANED and has been seen to fire on both.
15. **CLAUDE.md's byte-offset rule is under-scoped** — it names `deploy-fleet.sh`; the hazard is any
    long-running shell script edited in place. Run them from a copy.
16. **The death gate's invented control denominator**: `control_bot_h = canary_bot_h * 7` when control reports
    no rate, reverting on 3 deaths against an assumed 0. Calibrate or amend to UNREADABLE; prospective,
    pinned by `test_verdict_acceptance.py`.
17. **Keep RULE.md and RULES-IN-FORCE.md synced on every rule change** — two `scp`s, part of step D.
18. **A hand deploy leaves no loop — FIXED and seen to work.** `fleet-deploy --pool` now REFUSES unless a
    reader exists (`canary-loop.sh` alive, anchored, or `~/MANUAL-READS-UNTIL` holding a future UTC stamp);
    `READER_OK=1` overrides and must be typed. It fired correctly on its first real use. **NOTE, 21 Sep: the
    stamp is a loaded gun once its canary is closed** — needsdrop-01 left `MANUAL-READS-UNTIL=18:30Z` behind
    after teardown, which would have let the next `--pool` deploy through with no reader. **Cleared today
    (moved to `~/MANUAL-READS-UNTIL.expired-2026-09-21`). Clearing it belongs in teardown.**
19. **NEW — detached readers outlive their canary.** `run-needsdrop-reads.sh` was still running at 11:12Z
    today with reads queued for 13:24Z and 16:24Z against a canary reverted at 10:28Z and torn down at 10:39Z.
    Killed. **Detached readers are a good pattern and must be killed in teardown like the drop-ins.**

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24** (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE. **v23** (no single
canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE in the verdict path. v22
WITHDRAWN unregistered. v12 linkage, v14c, v15c movement guards (calibrated 2% false-revert / 97% detection),
v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint
changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE — `changerowcheck.py` pre-deploy,
`license_change_rows()` at read time), **v21** (the death gate on the LOWER BOUND of the rate ratio), the
owner's floor of **two** canary deaths, draws at deploy (12-h ledger exclusions, ±25% then ±40%, the inference
half an unadjusted covariate, never placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not descending
from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ` assertion so a flagged canary cannot
ship inert, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS NOW FOUR POOLS / 20 BOTS** (overnight, measured over 300 random splits per cell): null sd of
  the pool-mean ratio-DiD on items/bot-h is 0.313 at k=20/3 h vs 0.608 at k=5/3 h. **k=20 at 3 h beats k=5 at
  24 h at one eighth the wall clock**; past k=20 the control set shrinks and the gain stalls. At k=5 the floor
  is sd 0.262 — MDE ~51% at ANY window — so a five-bot draw, not a short read, is what made the committed
  endpoint unreadable. `drawrec.sh` degrades 4 → 3 → 2 and says which. **CLAUDE.md still says "randomize five
  bots"; this is the registered change to it**, and the DiD rigor it protects is untouched.

## RETRACTIONS still in force — read before using any 19 Sep noise number
From `endpoint-noise-floor-2026-09-19.md`; Codex refuted four of five conclusions and a positive control.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f). Every
  "planted +30% → +30.0% ok" from `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not evidence.
  Replacement `scripts/analysis/realcontrol2.py` must SCATTER (sd 0.303). **Its own v1 reproduced the same
  tautology.** Twice in one session a control was built from the quantity it was meant to test.
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430` preserves preference order). Treat it
  as an UNADJUSTED covariate. The draw no longer holds it constant; the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED.** `decisions/bot-hour` is not cooldown-pinned, but its
  direction is ambiguous — an operational breakage guard only, never a success criterion.
- **`items/bot-hour` survives as very dispersed.** See the k=20 draw change above, which is the response.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed −0.650 against a −0.5 gate. Scored on "refusals avoided" it would have been promoted
  while making the fleet gather less.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md` are current** against
  `recovery-ladder-registration.md` and the paragraph above. Both verified current 20 Sep by md5; **no rule
  changed today, so no re-sync was needed.**
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` OFF the bots host (`/home/mike/mcai-analysis` shadows a mutated helper).
- **Nightly 00:12Z `~/programread.py 24` → `~/digest/programread.log`**; nightly 00:07Z iron-funnel
  (`~/digest/ironfunnel.log`). Last iron line: 25 raw iron / 42 ingots / 3 picks crafted, 11 gone, share 18.0%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.
  `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- `canarywatch.py` cron */10 (STALE + ORPHANED); `stuckwatch.py` cron :17/:47 (bots pinned ≥ 4 h).
- **Declare the two-week program read window: 72 h continuous, 24–27 Sep**, and keep promotions out of it.
  The two-week gate is 27 Sep. A registration draft exists at `program-read-registration-2026-09-24.md`
  (repo tree). **CONFIRM IT IS REGISTERED BEFORE 24 SEP.** Note there that the two re-seeded pools are a
  world-level confound whose 72 h closes 22 Sep, so they are clear.
- **Seed +72 h reads: placebo-a 22 Sep 00:00Z, placebo-b 22 Sep 11:25Z — both already scheduled detached.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is the **anchored** `pgrep -af "canary-loop[.]sh"`
**plus** the deadline: OpenLoop with no loop running, or past `deadline_min`, is real.

## Daily session rotation
- Desktop task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC). It reads this
  file first, closes any open canary (**check the LEDGER and the journal and the anchored pgrep**), re-arms
  below, does the queue, rewrites this file to BOTH copies.
- **The ledger is `/var/log/mcai/_canary-decisions.jsonl`** (not under /srv/mcbots, and not in `~/mcai-analysis`).
  `check-open-loop.py` lives at **`/opt/minecraft-ai/scripts/check-open-loop.py` on .31** and needs sudo.
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`, where
  the read scripts clamp `W = min(elapsed, M)` — so a missed read can be taken late at its registered minute.
- **Telemetry row shape, because two reads got it wrong this week**: `Events.load()` rows are FLATTENED to
  `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), the event kind is `r['name']`
  (with a leading underscore for `logEvent` kinds), and everything else is under `r['raw']` —
  `raw.bot.tools` (per-tool `{slot, used, max}`, **the only place durability lives**),
  `raw.bot.inventory` (name→count, **no durability**), `raw.bot.pos`, `raw.code.version`,
  `raw.skill.{status, fail_class, detail, args, duration_ms}`.
  **A gather outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`.**

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or revert
  and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599 only; the seed canary is the registered exception —
  the world IS the treatment). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never
  disable rpcbind; never touch the apt timer. One code canary at a time (a bundle counts as one). Teardown is
  THREE steps **plus killing the detached readers and clearing `~/MANUAL-READS-UNTIL`** (both bit us today).
  Deploy only via `~/bin/fleet-deploy`. Commit with `git commit -F -` heredocs. Two Codex passes per patch,
  then a smaller patch. Never share a live canary's inference endpoint/model; ARBITER stays OFF as the fleet
  default (authorised for owner-01c only). Never `git add -A bots` in a worktree with a node_modules symlink.
  Readers include rotated `.gz` generations. Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds); the
  lab key on the mini is `~/.ssh/id_ed25519`. Status reports live in docs/reports. Use `date -u` for clocks.
- Independent Claude **and** ChatGPT review, plus a real search of open source, issues and forums, before
  proposing to build — scoped to design changes, new research claims and deploy-impacting conclusions.
- **And one the repo should adopt:** run any long-running shell script from a copy outside the tree you may
  edit. CLAUDE.md says this of `deploy-fleet.sh`; bash re-reads by byte offset for all of them.

## Worktrees
`mcai-digwatch` (dig-collision, cfc1c58 = NOW MAIN), mcai-owner (movement-owner-1, aa44514 — reverted twice,
rebase for owner-01c), mcai-falls (falls-path-log, fc28885 — rebase for falls-02), mcai-owner-f (3b9ff25,
unused), mcai-deathsites (b1659c0 = old main), **mcai-rl02 (recovery-ladder-03 = docs/scripts branch)**,
mcai-recovery (iron tools), mcai-rllava, mcai-rliron, mcai-rl10, mcai-canopy, mcai-scene (sandbox harness).
**The main repo checkout is on branch `veto-feedback`**, which is where the overnight session committed.
Scripts: `~/mcai-analysis` on this Mac. On .31 `~/mcai-analysis` holds drawrec.sh, changerowcheck.py,
drawexposure.py, deathgate.py, singledeath.py, collisions.py, seedread.py / seedtraj.py / seedfails.py,
run-seed-72h.sh, **equipblind.py / craftwhy.py / craftadvice.py / gout.py / birch.py (new 21 Sep)**,
registrations, and **`lib/` — the golden analysis library restored after every deploy**.

## Re-arm on a fresh session (monitors are session-local)
0. **No code canary is live, so items 1–4 do not apply** until one is deployed.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and
   `~/canary-journal.jsonl`** on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|phase`, **new lines only**
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT** — the loop pages decisions and errors only.
   The journal is the heartbeat. **And neither is complete: needsdrop-01's REVERT reached the LEDGER and
   neither file.** Treat silence as a reason to run the anchored pgrep.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER IT ON MESSAGE TEXT** —
   a filter added 18 Sep suppressed a verdict carrying `page_claude: True`.
   **⚠ CORRECTED 21 Sep — IT IS AN ALARM, NOT A HEARTBEAT, and the old text here implied otherwise**
   ("~20 lines over a canary's life", which reads as periodic output). `analystwatch.sh` polls for a new
   `*.verdict.json` every 300 s and pipes it to `analystflag.py`, **which prints NOTHING when there is
   nothing to flag** — verified by running it by hand on `20260921T1130.verdict.json`: no output, exit 0.
   So a 30-minute watch that delivers zero events is indistinguishable from a dead `analystwatch.sh`.
   **That happened today**: the monitor expired silent while the analyst had in fact produced 11:00 and
   11:30 verdicts normally. **Confirm the analyst is alive from `ls -t ~/digest/*.verdict.json`, never from
   the monitor being quiet** — the same defect as `page.jsonl` in item 1.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT, so monitor 1
   covers it — **only if the loop is actually alive.** Verify with the anchored pgrep, do not assume.
4. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest,
   then promote or tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
5. **After any deploy, check the analysis library survived** —
   `python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   on .31. Verified today: 19,249 rows / 80 bots over 30 min. `fleet-deploy` restores it; nothing else will.
6. **The seed canary needs no monitor** — both +72 h reads are scheduled detached on the host and the
   telemetry walk is retrospective, so a missed read is recoverable.
