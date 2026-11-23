# 1. Skill reliability audit (pre-project)

Data: `mcai-skill-agents` (fleet) 2026-08-05 21:47Z .. 11-18 13:01Z, and `mcai-skill-showcase` 10-20 .. 11-22 16:14Z,
10-07 excluded (duplicate docs). Scripts: `infra/analysis/pre-project/skillrel_build.py` (raw zst -> Parquet,
`~/mcai/parquet/skills/` on 10.0.0.45) and `skillrel_analyze.py` (CSVs in `~/mcai/out/skillrel/`).

## Denominators

| source | rows | internal `_` rows | real skill rows | bots | bot-hours (distinct bot x clock hour with any row) |
|---|---|---|---|---|---|
| fleet | 118,757,314 | 109,632,459 | 9,124,855 | 95 | 169,224 |
| showcase | 7,606,016 | 7,125,298 | 480,718 | 16 | 8,011 |

Status values on real skills (fleet, of 9,124,855): success 3,963,561 (43.4%), failed 3,316,863 (36.3%),
aborted 786,424 (8.6%), unknown 567,677 (6.2%), no_effect 490,330 (5.4%). Showcase (of 480,718): success 52.9%,
no_effect 15.6%, failed 15.2%, aborted 10.4%, unknown 5.7%.
No `refused`, `unverified`, `no_measurable_change` or `interrupted` status exists in either source (positive control:
the same GROUP BY returns the five values above). "Never verified" is therefore the `unknown` status, whose detail
reads "...but nothing changed that X exists to change (expected ...); cannot tell whether it worked".
`skill.fail_class` is null on all rows extracted (it is not populated in these indices); the fail mix below is from
`skill.detail`, digits normalised to `#`.

**Caveat: intent vs outcome.** `success` is the skill's own claim plus the post-check; `unknown` means the post-check
saw no state change. Both are rows, not world outcomes.

## Who aborts: controller vs world

Every `aborted` real-skill row carries a `trigger`. Fleet aborts (786,424) by detail: entombed 320,113 (+40,751 with a
GoalChanged throw), stagnation 172,990, drowning 129,774, stuck 76,218, suffocating 9,940, timeout 8,805,
danger_block 3,773, low_health 2,101, death 1,005. Trigger is `interrupt:<reflex>` for nearly all of them.

So **aborts are the controller's reflex layer preempting the skill**. The reflex fires on a world reading
(walled in, no air, no movement), but whether that reading was true is not in the row. One data point says it often
isn't: from 11-01, when `_entombed_declined` began to be logged, 52,004 entombed detections out of 271,364 that month
(19%) were declined with "the walk back is open; not entombed". Before November that check did not exist (0 rows
Aug-Oct, same query finds 52,004 in Nov), so up to ~1 in 5 entombed aborts before then may have been false.
`GoalChanged: The goal was changed before it could be completed!` (~56k fleet failures/aborts) is also the controller
replacing a pathfinder goal, not a skill fault.

## Per-skill table (fleet; showcase in brackets where it differs materially)

p50/p95 duration in seconds; "moved" = share with distance_moved > 0. Fail-repeat = of this skill's non-success rows,
share whose previous row for that bot was the same skill also not succeeding (a loop signal).

| skill | runs | success | failed | aborted | no_effect | unknown | p50 / p95 s | moved | fail-repeat |
|---|---|---|---|---|---|---|---|---|---|
| gather | 2,673,379 | 31.7% | 58.1% | 9.5% | 0 | 0.6% | 6.7 / 89.6 | 58% | 34% |
| goto | 1,779,060 | 46.7% | 28.6% | 9.6% | 0 | 15.1% | 13.3 / 46.5 | 72% | 27% |
| explore | 1,719,544 | 64.8% | 18.9% | 11.0% | 5.2% | 0 | 19.9 / 63.8 | 85% | 33% |
| mine | 960,323 | 57.7% | 25.6% | 0.7% | 0 | 15.9% | 3.1 / 32.2 | 73% | 18% |
| craft | 365,998 | 25.4% | 65.8% | 5.1% | 0 | 3.7% | 0.8 / 20.2 | 39% | 28% |
| home | 214,552 | 37.6% | 16.8% | 17.0% | 0 | 28.6% | 10.7 / 71.6 | 64% | 17% |
| deposit | 185,825 | 24.7% | 42.9% | 2.0% | 30.4% | 0.1% | 1.5 / 43.7 | 47% | 26% |
| surface | 169,505 | 27.7% | 33.7% | 20.1% | 0 | 18.5% | 9.4 / 120.3 | 65% | 9% |
| place | 133,550 | 74.0% | 25.8% | 0.2% | 0 | 0 | 0.4 / 5.2 | 2% | 16% |
| bucket | 110,341 [282] | **0.0%** | **100%** | 0 | 0 | 0 | 0.3 / 0.9 | 0% | 16% |
| deep_mine | 108,127 | 35.9% | 0.3% | 2.9% | 59.3% | 1.7% | 3.1 / 63.4 | 53% | **80%** |
| build_shop | 98,853 | 14.0% | 0.0% | 14.2% | 60.9% | 10.9% | 61.8 / 147 | 79% | 5% |
| swim_to | 88,528 | 6.2% | 46.6% | 40.2% | 0 | 7.1% | 4.4 / 37.2 | 62% | 30% |
| make_material | 66,226 | 58.5% | 0.0% | 4.8% | 36.7% | 0 | 5.6 / 44.4 | 80% | 0.2% |
| smelt | 62,951 | 51.3% | 31.5% | 10.2% | 2.4% | 4.6% | 10.7 / 32.3 | 52% | 8% |
| smelt_town | 61,531 | 27.7% | 5.2% | 5.5% | 61.5% | 0.1% | 17.4 / 118.7 | 89% | 0.4% |
| status | 52,812 | 0.2% | 0 | 0 | 99.8% | 0 | 0.3 / 0.8 | 0% | 9% |
| furnace_drain | 46,466 | 0.4% | 28.7% | 6.1% | 64.8% | 0.0% | 9.1 / 38.8 | 93% | 0.4% |
| town_deposit | 45,604 | 46.7% | 29.8% | 0.5% | 23.0% | 0.0% | 1.4 / 19.5 | 49% | 0.2% |
| dispose_well | 37,257 | 75.2% | 19.3% | 1.1% | 4.4% | 0 | 9.6 / 23.5 | 93% | - |
| count_town | 28,603 | 13.2% | 0.0% | 0.3% | 86.5% | 0.0% | 0.5 / 12.6 | 20% | 0.2% |
| board | 19,907 | 82.4% | 8.8% | 0.9% | 0 | 7.8% | 0.5 / 25.7 | 21% | - |
| toolkit | 18,686 | 61.0% | 36.8% | 2.2% | 0 | 0.0% | 9.5 / 36.9 | 89% | - |
| mats_return | 13,438 | 2.9% | 0 | 2.1% | 95.0% | 0.0% | 0.8 / 50.0 | 41% | - |
| build_well | 13,043 | 0.5% | 1.1% | 0.0% | 98.4% | 0 | 0.3 / 0.9 | 1% | - |
| withdraw_pick | 9,624 | 47.3% | 29.3% | 4.4% | 18.8% | 0.2% | 9.3 / 70.8 | 88% | - |
| withdraw | 9,523 | 40.0% | 55.3% | 4.7% | 0 | 0 | 3.5 / 49.9 | 51% | - |
| compost | 9,057 | 90.5% | 7.4% | 0.8% | 1.4% | 0.0% | 4.1 / 25.2 | 82% | - |
| wear_out | 8,477 | 52.1% | 47.5% | 0.3% | 0 | 0 | 1.4 / 8.3 | 6% | - |
| eat | 7,456 | 2.0% | 0 | 0 | 98.0% | 0 | 0.3 / 0.8 | 0% | - |
| prune_town | 2,824 | 10.7% | 28.8% | 3.7% | 56.6% | 0.2% | 6.8 / 31.1 | 83% | - |
| build | 1,795 | 5.7% | **89.0%** | 3.4% | 0 | 1.8% | 0.6 / 42.6 | 35% | - |
| build_plinth | 637 | 44.4% | 25.7% | 0.9% | 27.3% | 1.6% | 8.4 / 28.9 | 63% | - |
| sleep | 624 | 0.0% | 91.0% | 8.7% | 0 | 0.3% | 1.1 / 51.6 | 22% | - |
| sky_descend | 470 | 82.8% | 4.9% | 0 | 0 | 12.3% | - | - | - |
| keepout_exit | 140 | 68.6% | 1.4% | 8.6% | 8.6% | 12.9% | - | - | - |
| follow / come | 20 / 10 | 0% | 100% | 0 | 0 | 0 | - | - | - |
| found_work, close_well, tend_farm, bamboo_sticks, build_composter, found_store | 1-28 each | | | | | | | | too few to judge |

Showcase-only: village_feed 76 (6.6% success, 82.9% no_effect), market_trip 53 (11.3% / 73.6%), market_run 39,
crew_up 680 (22.6% / 65.1%). Showcase explore 71.8% success, home 66.3%, gather 42.4%, goto 53.2%.

## Top failure details (fleet, digits as #)

- **gather failed** (1,554k): "dirt found but unreachable after # attempts [probe: success, slate #, A* reached a candidate] [collect threw nothing -- it returned without gathering]" **141,858**; "*_log found but every candidate is buried" 67,888; "no *_log within # blocks" 60,587; "dirt ... buried ... you are # below sea level" 47,377. The first one is a **mechanics bug**: probe succeeds, A* reaches, collect returns with nothing. Also 77,771 *successes* carry the same "unreachable" text after a partial collect.
- **goto failed** (509k): "no route exists toward #,# ... still # short" 200,952; "pathfinder returned an empty path ... even with digging allowed" 114,800; "path was stopped" 62,425; "a competing goal replaced the route" 55,116 (controller). **goto unknown**: "arrived at #,#,# — but nothing changed (expected position)" **174,829**: of 1,047,819 rows starting "arrived", 181,027 (17.3%) are `unknown`. This is the verifier misreading arrival (most likely already at the target), not a goto failure.
- **craft failed** (241k): "no slot can be freed from here" 12,090; "no recipe available for wooden_pickaxe; place the crafting_table first" 12,035; "crafting_table is # blocks away and could not be reached" 7,358 + 5,672. **craft unknown**: "crafted #x stone_pickaxe/crafting_table/wooden_pickaxe — but nothing changed (expected inventory_gain)" ~9,650: of 107,325 "crafted..." rows, 12,578 (11.7%) are not success. Either the craft lied or the inventory diff is read too early.
- **mine failed**: "stopped at y=# to keep an exit: # pickaxe swings left" 102,767; "will not dig down within # blocks of home" 43,456 + 27,509 (a guard the LLM keeps hitting); **mine unknown** "cut a step but could not stand in it (moved #, wrong cell)" 98,117; "reached y=# — but nothing changed" 54,618.
- **explore failed**: "could not explore: explored # blocks ... in # legs" 227,300 — a failure with movement in the text; 77,776 more with "No path" legs.
- **bucket failed** (110,621 of 110,623 ever; 2 unknown, 0 success in any month or era): "nothing within reach to fill from [not water (air) | not water (cobblestone)...]" ~105k; "fill failed: undefined" 4,793. 105,265 of the calls are `llm:idle` picks. The LLM calls it without water in reach and the skill has no walk-to-water step.
- **deposit**: "deposited # items — nothing matching, or the chest was full" 11,239 (failed with zero items is not actionable); no_effect "nothing matching apple" 13,399 + "apple is not a banking target" 9,518.
- **swim_to failed**: "target is #b away — that is not a crossing" 18,816 (LLM misuse); "stalled #b out" 14,368; aborted 40% (33,286 drowning interrupts).
- **surface failed**: "already at y=#, at or above sea level" 18,113 (LLM misuse); GoalChanged 16,205 (controller); water beside shaft 7,678. unknown "no altitude gained ... you need blocks to pillar / needs a pickaxe" ~17.5k.
- **sleep failed**: walk to bed failed 350 of 568; "can only sleep at night" 152.
- **build failed**: "pillar at ...: #/# in place (# failed)" + "cobblestone/dirt in the way" + "placing exceeded #ms" (1,598 failed of 1,795).
- **status / eat / count_town / build_well / mats_return**: 86-100% `no_effect` by design ("hp # food #", "already full", "no valid cell for a well near home" 11,354 of 13,043 build_well).

## Trends

Fleet success by month (Aug / Sep / Oct / Nov): gather 15/23/42/39%, goto 34/54/45/45%, mine 49/40/69/64%,
craft 19/24/26/43%, deposit 13/11/26/61%, place 12/66/95/74%, home 4/19/31/41%, surface 20/25/20/39%, smelt -/28/57/61%,
swim_to 7/6/-/- (last rows 09-xx). Bucket 0% every month (Sep 37,511, Oct 4,690, Nov 68,140 calls; usage *grew*).
Code-version eras (6 equal-count buckets of 9-char version prefixes by first-seen date): gather 10 -> 15 -> 29 -> 44 -> 43 -> 34%
(era 6 from 11-09 is down); craft 13 -> 21 -> 22 -> 33 -> 51 -> 39%; mine 26 -> 41 -> 47 -> 71 -> 66 -> 63%. Era 6 is
33 bots vs 106 in era 3, so mix changes as well as code.

## Internal `_` events: stuck/loop signals (fleet, per bot-hour, denominator 169,224 bot-hours)

| event | rows | per bot-hour | bot-hours with >=1 | note |
|---|---|---|---|---|
| _path_reset | 21,756,370 | 128.6 | 156,293 | pathfinder churn (showcase 165.6/bot-h) |
| _path_noPath | 7,435,345 | 43.9 | 122,363 | Aug 36.4, Sep 30.4, Oct 54.7, Nov 53.3 /bot-h |
| _path_timeout | 2,921,627 | 17.3 | 143,087 | |
| _path_no_legal_move | 2,226,804 | 13.2 | 79,595 | 989,840 (44%) are "sealed_in_liquid" |
| _oxygen_critical_state | 1,672,866 | 9.9 | 39,584 | |
| _livelock_not_fixated / _livelock_escape | 1,047,366 / 592,532 | 6.2 / 3.5 | | escape: Aug 7.7 -> Nov 2.0 /bot-h |
| _drowning_up / _drowning_route / _reflex_drowning | 1.10M / 1.04M / 0.67M | 6.5 / 6.2 / 4.0 | | |
| _entombed | 884,624 | 5.2 | 126,215 | Aug 3.0, Sep 3.2, Oct 6.4, Nov 8.1 /bot-h (rising) |
| _entombed_unrecoverable | 73,741 | 0.44 | | "gave up after # escape attempts" |
| _watchdog_rescue | 437,319 | 2.6 | 43,695 | logged from 10-xx only (0 Aug-Sep, 185,693 Oct); rows are attempt stages, not rescues |
| _marooned | 430,926 | 2.5 | 91,068 | |
| _stagnation | 418,951 | 2.5 | 126,440 | |
| _loop_restart | 134,118 | 0.79 | | "cognitive loop produced no decision for #s" (controller hang) |
| _reflex_stuck | 122,760 | 0.73 | | "no movement for #s"; Aug 0.63 -> Nov 1.22 /bot-h |

Positive control for the rates: the same query returns 5,932,572 `_reach_probe` and 15.5M `_affordance_scan` rows
(non-stuck events), so missing rows are not a load failure.

## Verdicts (ranked by fleet runs x damage)

| # | skill | verdict |
|---|---|---|
| 1 | gather | **FIX**: collect returns without gathering after a successful probe (141,858); refuse below sea level for surface-only items instead of searching; buried candidates -> hand to mine deterministically. |
| 2 | goto | **FIX verifier**: "arrived" scored unknown 181,027 times; separate already-there (success) from noPath; 55k "competing goal replaced" is controller preemption, count it as aborted. |
| 3 | explore | FIX (minor): "could not explore" fails 227k rows that moved; define success as >= N blocks of new ground. |
| 4 | mine | FIX: the step-cut "wrong cell" path (98k unknown); the home-radius refusal must name a target cell (it is hit 71k times). |
| 5 | craft | FIX: verify by reading inventory after the window closes (11.7% of "crafted" rows are not success); auto-place/walk to table instead of "move to #,# first". |
| 6 | home | FIX verifier: 58,531 "home ... nothing changed" unknown (already home = success). |
| 7 | deposit | FIX: "deposited 0 items" must be no_effect, not failed; banking-target refusals belong in the planner menu, not a call. |
| 8 | surface | FIX: refuse at/above sea level before the call (18k); pillar-block shortage should trigger gather, not unknown. |
| 9 | place | KEEP (95% Oct); fix "placing exceeded #ms"/blockUpdate timeouts (~10k). |
| 10 | bucket | **DROP from the LLM menu** (0 of 110,623 succeeded, ever): re-add only as fill-at-water with walk-to-water. |
| 11 | deep_mine | FIX: 80% fail-repeat; "no ore in reach (nothing_found)" 20,899 repeats at the same y. Back off by location. |
| 12 | build_shop | FIX verifier: 61% no_effect + 11% unknown on 62-147 s runs; it reports progress text, not a checked delta. |
| 13 | swim_to | DROP as LLM skill (6.2% success, 40% aborted by drowning); keep swimming inside goto. |
| 14 | make_material, smelt, smelt_town, town_deposit, toolkit, withdraw_pick, dispose_well, compost, board | KEEP AS-IS (low repeat; no_effect is honest "nothing to do"). |
| 15 | furnace_drain | KEEP, FIX reach ("furnace # blocks away could not be reached" 13,357). |
| 16 | status, eat, count_town, mats_return, build_well | Not actions: move to observation / scheduled checks; eat should only be offered when hungry (98% "already full"). |
| 17 | build | DROP/REPLACE (89% failed on 1,795; superseded by build_shop). |
| 18 | sleep | FIX or DROP (0 successes in 624; 91% failed). |
| 19 | follow, come | DROP ("cannot see undefined", 30 of 30 failed — broken arg). |
| 20 | wear_out, withdraw, prune_town | FIX reach/targets (47-55% failed), low priority. |

## Contracts first, for a survive-and-recover loop

Each needs pre-conditions checked before the call, a measured post-condition, and a typed failure that names a remedy
executable from where the bot stands.

1. **goto** (post: within r of target; already-there = success; typed noPath / preempted)
2. **surface** (pre: below sea level; post: y gained / sky visible; remedy: blocks or pickaxe)
3. **entombed escape** (`_entombed` reflex + pillar/ramp; pre: confirm walk-back closed, which 19% of Nov detections failed)
4. **drowning / get-air reflex** (`_drowning_route`, `_reflex_drowning`, swim inside goto)
5. **gather** (post: inventory gain; typed unreachable/buried/below-surface)
6. **mine** (post: inventory or y change; exit-reserve refusal with remedy)
7. **craft** (post: read-back inventory; table walk/place inside)
8. **place** (post: block at cell, read back)
9. **home** (post: inside home radius)
10. **eat** (pre: food < threshold)
11. **deposit / town_deposit** (post: inventory loss; 0 items = no_effect)
12. **withdraw_pick / toolkit** (post: usable pickaxe in bag; recovery depends on it)
13. **explore** (post: new ground covered)
14. **sleep** (pre: night + bed reachable)
15. **smelt** (post: output in bag)

## Limits

- `fail_class` is unpopulated; `interrupted` is not a status here (aborted + trigger carries it).
- Abort cause is the reflex's reading; its truth is checked only from November (`_entombed_declined`).
- Fleet pools ran experiments (arms, memory scopes); per-skill rates mix arms. Era 6 has 33 bots vs 106 in era 3.
- Fleet data ends 11-18 13:01Z; showcase to 11-22.
