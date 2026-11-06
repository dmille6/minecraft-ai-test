# Code evaluation: AREA = skills (what bots DO once they've decided)

_Read-only, 2026-11-06 ~02:30-03:10Z. Code: origin/main `bd2c308f` (worktree `/Users/darrellmiller/Documents/.wt-eval-skills`).
Measurements: `scripts/lib/telemetry.py` full 24 h walks, nice 19, on the fleet host (.31: 1,513,505 rows, 80 bots, 24.0 h span
= 1,920 bot-h) and the showcase VM (.40: 332,708 rows, 15 bots, 24.0 h = 360 bot-h). Scripts and raw output:
`scratchpad/codeeval/bvread*.py`, `fleet-bv*.txt`, `show-bv*.txt`, `fleet-skills.txt`. Codex: `codex-skills-out.txt`._

## (a) Summary

1. Building is **2.8 % of fleet bot time** (build_shop 54.6 of 1,920 bot-h; explore is 372.9, goto 203.0). Of the 54.3 bot-h
   inside build visits, **41.7 bot-h (77 %) are visits that placed nothing**; 3,541 of 3,999 fleet visits and 1,067 of 1,218
   showcase visits placed 0 blocks.
2. The single biggest stall is a **retry hole**: a tree/leaf (or other diggable) clear that has no stand fails `clear_failed`
   every visit but never enters the cross-visit stuck map, so it is never waived or backed off. 7,750 of 7,775 fleet
   `clear_failed` rows hit 7 oak_leaves cells; isolated-c's monument burned **20.7 bot-h in 464 visits, 0 placed**
   (goalwatch STUCK since 11-02 04:00Z, still open).
3. The **picker/order is one-project-per-town**: the first open project wins (`shop.mjs:146`), and a no_site / stuck project
   makes the order return *nothing* (`shop.mjs:611-618`) for 24 h / 6 h instead of moving to the next project. Four towns' build
   pipelines are only `no_site` rows; their bots fall through to the patrol.
4. The engine (`buildrun.mjs` + `buildproj.mjs`) is good and shared; the **project lifecycle around it is not**: 9 copies of
   the visit/out/site/publish scaffolding in skills.mjs (12 on the showcase fork), remedies opt-in per project, so each new kind
   re-hits old stalls and gets a bespoke fix (fell, zigsealed, wallstuck, stuckcells, monustuck, tidydead...).
5. Verdict: **partial refactor**. Two targeted fixes first (days, ~20+ bot-h/day and multi-day project stalls); then extract a
   project-kind lifecycle module out of skills.mjs incrementally. No big-bang split of skills.mjs.

## Fleet build visits, 24 h (denominators)

| outcome | visits (of 3,999) | bot-h (of 54.3) | of which 0 placed, bot-h |
|---|---|---|---|
| deadline | 693 | 29.3 | **22.8** (isolated-c monument 20.7) |
| aborted | 638 | 9.1 | 8.7 (481/638 have `_reflex_stuck` in the 4 s before) |
| no_material | 703 | 7.4 | 3.6 |
| walk_failed (stair) | 146 | 2.2 | 2.1 (all "stair is blocked above") |
| complete | 203 | 2.1 | 1.4 |
| attempts_spent | 458 | 1.4 | 0.8 (hive-d tidy 428) |
| blocked | 638 | 1.1 | 1.1 (placebo-b tidy 555) |
| deps_open | 271 | 0.9 | 0.7 |
| no_site | 162 (+2 paths) | 0.05 | - (placebo-d 59, board-a 44, board-c 32 shop, hive-c 27 house1) |
| stuck_on_cell | 27 | 0.24 | - |

By project: monument 2,546 visits / 47.6 bot-h / 5,704 placed; tidy 1,110 / 2.9 / 349; shaft 211 / 2.9 / 117; wall 35 / 0.5 / 95.
2,386 of 4,004 visits were zero-placed and identical (project, outcome, why) to the same bot's previous visit.
Showcase (19 project kinds): aborted 227 visits / 7.6 bot-h (storehub 119 / 5.9 bot-h), tidy `helper_idle` 224, deadline 145 / 5.1.
Positive controls: `_build op=place` 6,544 rows in the same walk; `build_shop` 2,519 rows on 11-01 (for the `build` zero below).

## (b) Findings, ranked by impact on "bots keep working / progress keeps moving"

| id | finding | evidence | impact (numbers) | rec | effort | risk |
|---|---|---|---|---|---|---|
| S1 | **Failed diggable clears never reach the stuck map.** The F4 map counts only placement cells "no stand reaches" (`deferredCells`). A tree clear with `no_stand` goes to plain `clear_failed` (`buildrun.mjs:1064`); the sealed-column path excludes trees (`kind !== 'tree'`, `buildrun.mjs:1037`); `blockedDefers` deliberately keeps "a diggable foreign block whose dig failed" as `blocked`, "the next visit retries it at once" (`buildrun.mjs:1254-1259`, from Codex r1 BLOCK in `1b05c924`, 11-01). `bump()` is per-visit only (`:451`). Result: no stuck_on_cell, no waiver, no back-off, forever. | 7,750/7,775 clear_failed on 7 leaf cells, ~1,290 each/24 h; isolated-c monument L02-N leaves 312-313,73,102-104 (1,350 rows since 00:56Z alone); placebo-b tidy T-05-5 leaves 271,64,-370 (555 `blocked` visits); hive-d tidy `attempts_spent` 428 (fill never placeable, same family) | **~22 bot-h/day** direct (20.7 + 1.0 + 1.1) plus 3 projects frozen for days and their towns' later projects starved; isolated-c monument STUCK alarmed since 11-02 | **FIX**: any cell that fails (clear or place) on N visits enters the same persistent stuck map with its reason; after N, defer/waive it (or for leaves: fell from a pad / allow `no_stand` leaves to be waived, they decay or are cosmetic). One rule in buildrun, default ON for every project; a multi-visit regression test per failure kind. | S-M | M (a waiver that is too eager leaves holes; the shopread oracle must accept waived cells) |
| S2 | **The order idles instead of moving on.** `activeProject` returns the first open project with a free slot, else `open[0]` even when full (`shop.mjs:146`). `buildOrder` then returns `order: null` for: no_site (24 h, `SHOP_SITE_RETRY_MS`, `shop.mjs:245,611`), the project's stuck stamp (`:616`), the bot's own stuck_on_cell (`:621`), slots_full (`:622`). None of these tries the town's *next* project. | 4 towns whose only build rows are no_site: board-c 32/32 visits `shop no_site`, hive-c 27/27 `house1 no_site`, placebo-d 59/88, board-a 44/55 `monument no_site`. Brief: 7/16 towns with no open project, patrol 51-84 % of bot time, value/bot-h -39 % on 11-05. Memory stuckprojects-1104: monument held all 3 slots, wall got 3 visits of 407 | The largest lever in this area: building is 2.8 % of bot time while explore is 19.4 %. Every town that can build but is blocked (4 towns, ~20 bots) falls to the patrol; upper bound tens of bot-h/day of *useful* work restored | **FIX** now (S): on no_site / stuck / slots_full skip to the next eligible project in the same call. **REFACTOR** later (M-L): choose among eligible projects by readiness (site known, bill in town, free slot, recent progress) with aging; per-project not per-bot back-off. Two-engine review (design change). | S then M-L | M (changes which project every bot works on; the showcase must re-check its tripwire rules) |
| S3 | **Build visits are cut by the stuck reflex.** 481/638 fleet aborted visits (75 %) follow `_reflex_stuck` (35 s no movement while busy, `reflex.mjs:3770-3783`, `STUCK_SECONDS` 35). buildrun/buildbot never declare `bot.stationaryUntil` (0 setters; well/plinth/composter/compost do, `skills.mjs:8232,9822,10125,10709`), while the engine has stationary waits: `BARRIER_WAIT_MS` 60 s, `BODY_WAITS`, intent settle. Some are genuine walk wedges (isolated-b monument 357 aborted). Codex notes `buildbot.mjs:219` swallows path failures and returns true, so a failed walk is only found later. | aborted 8.7 bot-h zero-placed (fleet), 7.3 (showcase, of 15.9) | ~8-9 bot-h/day fleet + ~7 on the showcase (2 % of showcase bot time) | **FIX**: declare stationary windows inside runVisit waits; return a real walk outcome from buildbot and ban the stand at once; check proximity correlation per cause before building (row-proximity is not causation). | S-M | M (movement tier: protected.py check; the stuck reflex is a survival guard) |
| S4 | **`deps_open` returns at the first unmet dependency** (`buildrun.mjs:969`: `return out`), so a later independent segment is never tried in that visit; a leased upstream segment ends every other builder's visit. | 271 visits, 0.9 bot-h; isolated-c 166 `L02-N waits for L01-N` etc. | <1 bot-h/day, but amplifies S1 (the stuck layer blocks all layers above with no deferral) | **FIX** (`continue` to the next segment; keep the stop only when nothing else is workable) | S | L |
| S5 | **No project lifecycle abstraction; remedies are opt-in per project.** `buildShop` dispatches by plot to 7 bespoke visit functions (`skills.mjs:18578-18591`), then branches again per plot for siting (shopchest/store/hall/yard...). 9 copies of the `out()` row closure on main (`skills.mjs:18593,18856,19731,19968,20155,20324,20566...`), 12 on enchantshop-show; 30 `publishRecord(`, 28 `recordHead(dir, key)`, 9 `no_site` returns. runVisit takes 31 option keys; stall remedies differ per caller: monument `sealed+access`, wall `sealed+footing+stuckStalledOnly` (`skills.mjs:20147`), tidy `stuckStalledOnly` only, paths `overburden`, shop `waive` only. Three more engines exist beside runVisit: well/plinth/composter/found_* (own placement loops in skills.mjs), the stair (shaftvisit.mjs), the yard's sub-visits. | Git: 7 fix families in 3 weeks for the same "cell can never be done" class (fell-01, zigsealed-01, wallstuck-01, stuckcells-01, monustuck-01, tidydead-01 built not shipped, stuckproj-01 queued). Showcase tripwire stopped twice by a new `_build` kind / record change (brief) | Each new project re-discovers S1-class stalls; every fix lands in one or two projects only | **REFACTOR (incremental)**: a `projects/` registry: each kind supplies `site()`, `record()`, `visitPlan()`; one lifecycle owns order, row emission, bag/draw, publish, completion, the stuck map and all remedies (default ON). Move one kind at a time behind tests; record/row schema versioned so the showcase oracle is updated from the same registry. | L | M-H if wholesale; M per kind |
| S6 | **skills.mjs size cost.** 22,286 lines (showcase fork 26,366), 503 functions, 283 exports, 126 import lines from 91 modules, 33 % comment lines (7,396). Biggest: gatherRun 812, mine 805, deposit 536, craftLevel 493, gotoLegs 469, smeltInner 451, buildPlinth 394, buildWell 323. | 211 of the commits since 10-20 that touch bots/src touch skills.mjs (next: reflex 56, shop 54); 74 commit messages since 10-15 name a skills.mjs conflict (showcase folds: `b4c89685`, `9fb97917`); 57 test files read its source text (70 `readFileSync`), pinning names/sequences (Codex: `shop.test.mjs:245`, `shopchest.test.mjs:116`) | Not bot-hours directly: hours per fold/restack/review, and fixes delayed (the 19 h promotion lag was the orphan-list test, a similar shared-edit point) | **REFACTOR, incremental, by seam**: move build visits (~4,000 lines, 17,400-20,700) out first (S5), then craft/smelt, then mining. Convert source-grep tests to behaviour tests as each block moves. Not a mechanical split. | L | M (import cycles; text-pinning tests break on every move, by design) |
| S7 | **Detection alarms into nothing.** The visit knows (`_build_visit` outcome + `why`), goalwatch knows after 3 h (cron */15), STATE.md lists 6 stuck goals, but nothing acts: ALARMS.log has 414 goalwatch lines; isolated-c/monument first alarmed 11-02 04:00Z, still open 11-06. goalwatch reads only published records, so no_site towns (no record) are invisible (Codex). In-bot there is no "N identical zero visits -> change project" rule. | 2,386/4,004 zero visits identical to the previous one | All of S1/S2's hours ran days before a human read them | **FIX**: in-bot breaker: K identical zero-placed outcomes on one project -> project-level back-off + next project (closes S1/S2 even for an unknown cause); goalwatch adds "town has no workable project" and pages once with the remedy name. | S-M | L |
| S8 | **Dead / unreachable skills.** `build` (generic plan builder, 112-line fn + plans) 0 rows in 24 h, 0 on 11-01 and 10-25 (control: build_shop 2,519 on 11-01). `come`/`follow`/`sleep` 0 (operator/chatOnly by design). `build_composter`, `close_well`, `found_store`, `found_work` 0 in 24 h (one-shot town lifecycle: keep). | `skills.mjs:22231` | maintenance only | **DELETE** `build` + its plans after one ES check over 30 d; keep the lifecycle one-shots | S | L |
| S9 | **Stair walk_failed loops.** 146 visits "did not reach ... the stair is blocked above", 2.2 bot-h, board-b 52, hive-b 30, placebo-d 27. | `_build_visit project=shaft` | ~2 bot-h/day | **FIX** via S7's breaker; root cause belongs to the shaft owner (shafttrap-02 is built) | S | L |

### What is GOOD (keep)

- **buildrun.mjs is the right core**: effect-injected (the sandbox runs the same loop as the bots), world-re-read each step,
  the send protocol with fsynced intents + fences + barriers (`buildrun.mjs:20-27`, `buildproj.mjs` fence ~`:546`), pure
  helpers (`stuckAfter`, `foreignKind`, `stalkFell`, `sealedAbove`, `footingBelow`) that are tested by behaviour.
- **Every visit emits one `_build_visit` row with outcome + why + counts** (`shop.mjs:678`). This evaluation was possible in
  three walks because of it. Keep the schema; version it.
- Records/leases/slots in buildproj.mjs work across 95 bots without a coordinator; mutation safety held (no double-place
  incidents found in this window).
- Multi-visit composition tests exist (`bots/test/buildrun-stuck3.test.mjs`); the pattern is right, it needs one per failure kind.
- Monument progress is real: 5,704 blocks placed in 24 h, most of all fleet building.

## (c) Codex's independent evaluation and reconciliation

Codex (`codex exec -s read-only`, given the area, files, incident evidence and the 5 questions, not these conclusions; full
output `codex-skills-out.txt`, 77k tokens) found, ranked:
1. Failed clears bypass persistent stuck handling; traced the `blockedDefers` exclusion to `1b05c924` (11-01 review fix). FIX M.
2. Picker chooses priority and capacity, not executable work; no aging, readiness or unsitable exclusion. REFACTOR L.
3. no_site cooldown suppresses the order instead of selecting another project (24 h). (in its #2)
4. `deps_open` returns at the first unmet dependency (`buildrun.mjs:967`). FIX M.
5. buildbot swallows path failures (`buildbot.mjs:219`); stuck reflex interrupts the whole visit. FIX M.
6. Tidy's last-cell handling diverges from the shared waiver.
7. Detection: goalwatch alarms after 3 h but nothing acts; unsited goals invisible; alarm delivery return codes unchecked
   (`alarm.py:90,137`).
8. A framework exists (buildproj/buildsite/buildrun/shop); the missing abstraction is the lifecycle; remedies opt-in. REFACTOR L.
9. The shopread oracle independently encodes each project's semantics -> showcase trips. FIX: compatibility fixtures pre-release.
10. 205/473 test files reference skills.mjs; text-pinning tests; orphan-list shared edit point.
Top 3: close the failed-clear hole; project-specific eligibility + move to another project; goal alarms to an accountable
responder incl. never-sited goals. Verdict: **partial**.

**Agree** on all of 1-5, 7, 8 and the verdict. Two of its findings I verified in code: `buildrun.mjs:969` (`return out` on the
first unmet dep) and `buildrun.mjs:1254-1259` (the "retries it at once" comment). Our top 3 match in substance.

**Differences:**
- Codex worked from the supplied counts only; I measured bot-time, which re-ranks: S1 is ~22 bot-h/day concentrated in one
  town (isolated-c), and zero-placed `deadline` (22.8 bot-h) is the largest bucket, not `no_material`/`blocked` (counts mislead:
  638 `blocked` visits cost only 1.1 bot-h).
- Codex rates the leaf fix M; I rate it S-M because the stuck map, waiver and back-off already exist (`stuckAfter`,
  `buildrun.mjs:56`) and only need the failing-clear path to feed them. The risk is the oracle, not the code.
- Codex treats the 75 % `_reflex_stuck` proximity cautiously; I add a concrete mechanism (no `stationaryUntil` in the engine
  vs 60 s barrier waits) but agree it must be checked per cause before building.
- Codex adds alarm-delivery (`alarm.py`) and the oracle coupling; outside this area's code but real, passed to the pipeline area.
- I add the in-bot breaker (S7) as the cheapest general net, the dead `build` skill (S8) and the size numbers by function.

## (d) Top 3 to do first in this area

1. **Close the clear-failed retry hole (S1)** - every repeated failing cell (clear or place, any reason) feeds the persistent
   stuck map and reaches defer/waive/back-off; default on for all projects; multi-visit regression for leaves, a diggable block
   with no stand, and a never-placeable fill. Supersedes tidydead-01 and covers isolated-c. Gain ~22 bot-h/day + 3 stuck projects.
2. **Never idle on a blocked project (S2 quick part + S7 breaker)** - when the active project is no_site / stuck / full / K
   identical zero visits, take the next eligible project in the same order call. Gain: 4 blocked towns build again; the patrol
   loses its biggest feeder.
3. **Stop the engine being killed by the stuck reflex (S3)** - declare stationary windows in runVisit's waits, return real walk
   outcomes from buildbot. Gain ~8-9 fleet bot-h/day + ~7 showcase.
(Then S4 deps_open `continue`, S, low risk, as a rider on 1.)

## (e) Refactor verdict: PARTIAL

- **No** to a big-bang rewrite or a mechanical split of skills.mjs: the engine and record/lease layer are sound and the
  stalls are in policy (retry, eligibility), which a split would not touch.
- **Yes** to one module redesign: a **project lifecycle registry** (S5) that owns ordering, rows, remedies and completion for
  every project kind, moving the ~4,000 build-visit lines out of skills.mjs one kind at a time, with the showcase oracle fed from
  the same registry. That is what makes the next project kind cost geometry only, and makes S1-class fixes land once.
- Do the three targeted fixes first (days); start the registry only after they read KEEP, so it is measured against a fleet
  that is no longer stalling.
