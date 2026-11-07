# gkwork-01 — the groundskeeper always has work, or lets the lease go (2026-11-07)

Owner goal: groundskeepers always have work and make the town beautiful, clean and level inside the walls, then the
countryside. Ledger row `gkwork-1107`. Code: `bots/src/gkwork.mjs` (pure rules + per-holder strike files),
`bots/test/gkwork.test.mjs`. Branches `gkwork-01show` @ 72cdeb60 (on the live showcase release af3b9a8b; ci2 458/459, the known bagdiet orphan) and
`gkwork-01-on-63d28320` @ d37319a5 (on the live fleet gkstay-01; ci2 409/410, well.test fails on the base too). Tier 2 (`protected.py`: not protected). Rollback `GKWORK=0`.

## Measured (scripts/lib/telemetry.py, full walks, rotated logs loaded)

Time inside a keeper term (take -> release). Skill rows are stamped at their start; a row's `[t, t+duration]` is clipped
to the term. "Between decisions" is time with no skill running (LLM latency + the loop's gap; fleet baseline ~54% for all bots).

| | showcase 24 h (11-06 04:45Z..11-07 04:50Z) | showcase release window 01:56-04:45Z | fleet gkstay 63d28320, 02:50-04:52Z |
|---|---|---|---|
| rows / bots | 273,065 / 15 | 41,323 / 13 | 73,471 / 80 (version-filtered) |
| terms / keeper-h | 29 / 25.9 | 8 / 2.79 | 42 / 8.28 |
| releases | no_work_visit 15, underground 11, away 1, open 2 | no_work_visit 7, open 1 | underground 12, stuck 11, no_work_visit 5, away 2, open 12 |
| between decisions | 63.5% | 58.4% | 55.6% |
| walking (explore/goto/home) | 22.5% | 26.0% | 10.5% |
| underground (mine/deep_mine, gather below y-8) | 5.7% | 3.2% | 8.7% |
| gather (surface) | 2.3% | 0.2% | 12.5% |
| town jobs (make_material, smelt, deposit...) | 2.3% | 6.8% | 3.3% |
| other projects' visits | 2.2% | 0.0% | 2.0% |
| **grounds visits** | **1.4%** | **5.4%** | **7.3%** |
| position samples > 8 below the ground | 38.2% of 16,749 | 18.2% of 1,609 | 31.0% of 4,529 |
| grounds visits (success) | 17 (1) | 7 (0) | 34 tidy (8) |

Showcase decision path inside the 29 terms: 70 `build_shop` work orders, most to OTHER projects (expedition 13, paths 9,
stepwell 6, townhall 4, ...); make_material 51, gather 42, deep_mine 25, town_deposit 19. `_shop_skip why=room` seen in 13
of 29 terms (a rate-limited row: at least once). The tidy is the keeper's first project only when it reads open/due, and
every empty keeper visit marks it idle for that bot for an hour (`shop.mjs noteIdle`, sinkfix-04), so after one visit the
keeper's turn falls through to the town jobs, sinks, and the model's patrol milestone ("Scout terrain away from home").

Is there grounds work? Showcase: NO executable work, by a bug. The interior stage (tidy g88, stage 1 `inwall`,
1,331 cells / 77 cuts, `structure_complete: false`) has read "complete; cuts left 0/77, fills left 0/1323(1331)" on ~30
keeper visits by 13 bots since 11-06 05:36Z, placed 0, and never completed, so the land plan never moved to the next band.
Its completion waits on PER-BOT counters (`bot.gkClears`: 5 same-bot visits with nothing cleared, 48 `clear` entries incl.
kept logs; `bot.gkParkWait`: 6) while the lease rotates every ~20 min and each release restarts the bots. Positive control:
`op=clears_given_up` fired 11 times up to 11-03, 0 since the rotation. Forest visits: 8 in terms, all "felled 0 logs ...
deadline" (`off_stand` / `site_failed` stands; forest-01's job). Fleet: work exists (15 of 16 towns have an open tidy stage,
4-445 cells; 3,220 tidy visits / ~9,350 placed in 24 h by all bots) but STALLED stages dead-end: board-b 78 of 156 visits
`stuck_on_cell` "3 cell(s) no stand has reached in 3+ visits (15 open cell(s) wait on it); nothing else is open" with the
waiver room (max(12, a tenth)) spent (12 of 69 waived); placebo-b 44/87, placebo-d 28/127; board-d 509 of 584 `blocked`.
Each keeper takes, sticks, releases `why=stuck`, rests; the next one does the same.

Who interrupts tidy visits: the reflexes. 24 h aborted `build_shop` (all projects): fleet 834 (stuck 382, entombed 334,
stagnation 95, timeout 22), showcase 86 (stuck 34, entombed 24, timeout 22, stagnation 6). Juno's two `interrupted` tidy
visits were the entombed reflex on the walk. Protected scope (reflexes/movement): named, not changed here.

## Root cause

Two correct guards composing into a dead end, twice: (showcase) per-bot completion counters x a 20-min rotating lease =
a stage that can never complete, plus a 1-h quiet per empty visit = a keeper with nothing to do that holds the lease until
`no_work_visit`; (fleet) the waiver cap x the stuck release = a stalled stage every keeper bounces off.

## Design (Claude), reconciled with Codex

1. **The town counts the empty visits** (both). A tidy visit by a bot that may complete, that read every cell, found no
   cut or fill left and changed nothing, writes a strike to its own file `<key>.gkwork.<holder>.json` (no write race). A
   visit that worked clears the strikes before it town-wide. 3 strikes inside 6 h (stage identity = sitedAt|stage|cells|cuts,
   not the generation): the soft holds (clears wait, park crew wait) give way and the stage completes -> next band
   (showcase gkStageDue/nextStageCycle, fleet GKF clock). Hard holds (unread, prep request, felling stand up) never give way.
   Every empty visit logs `_build op=stage_held|stage_close kind=<what held it> n=<strikes> visits=3`.
2. **No quiet while closing** (showcase): `tidyQuiet({..., closing})` - the keeper collecting strikes gets its tidy order
   back at GK.cooldownMs (2 min), so a stage closes in minutes.
3. **Release at once when nothing is workable** (both): an empty keeper visit whose stage did not complete although the
   strikes are in releases `keeper_release why=no_work_now` and rests GK_FIT.restMs (instead of 20 min idle).
4. **A stalled stage gets its stuck cells waived past the tenth** (both): when the visit is STALLED and the ordinary
   waiver gave nothing, the cells the town's stuck map counted 3+ visits are waived (why `stalled:<why>`), at most 6 a visit
   and a quarter of the stage in all, so the cells waiting on them become work. Fleet waived cells are carried 24 h and
   retried (gkfDeadCarry).

Codex (independent, given the measurements and goal only) proposed: town-persisted, stage-scoped clear/park outcomes (=1);
keeper-specific task-scoped back-off instead of the 1-h quiet (=2); every refusal ends in work or release, with a 30-s
assignment supervisor in features.mjs and a structured keeper assignment shared by keeperOrder/takeKeeper/buildOrder;
`tidyStallDecision` that keeps the waiver limits and defers the blocked group into a remediation backlog carried by
gkfDeadCarry; holders never falling through to logs/scouting; kept trees excluded from tidyClearsLeft; report every
completion blocker; showcase's `completed = true` on a rejected publish is a bug.
Reconciled: adopted 1, 2, 3, the blocker report (`stage_held kind=`), and unread-is-not-evidence. Differences: (a) the
assignment supervisor / structured assignment is the right long-term shape but rewrites the order path across keeperOrder,
buildOrder and features.mjs; deferred to a follow-up because the measured loss is the missing WORK, not the dispatch.
(b) Stall: Codex keeps the cap and defers the group to a backlog; this waives only the stuck cells (bounded to a quarter,
retried in 24 h) so the 15 dependents are worked now - a stalled stage has no independent work to select. (c) Kept-tree
exclusion from tidyClearsLeft not done: the strikes close the stage whichever soft hold it is; `stage_held kind=` will say.
(d) The completed-on-rejected-publish bug, the forest off_stand failures, the reflex interrupts and the bag-room skip are
named follow-ups.

## Read after release

Showcase: `stage_close` within ~10 min of release, `structure_complete` on the inwall stage, the next band sited, keeper
grounds-visit share of term time (from 1.4% / 5.4%) and placed per keeper-h (from 0), `no_work_visit` releases (from 15/24 h),
`no_work_now` releases named. Fleet: `why=stuck` releases (from 11 of 42 terms), board-b/placebo-b/placebo-d stuck_on_cell
visits, `op=waived why=stalled:*` counts, tidy placed per bot-h no worse.
