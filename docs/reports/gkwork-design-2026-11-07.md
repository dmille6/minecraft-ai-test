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

## gklease-02 (coordinator question 11-07: does gklease-01's fit rule starve towns?)

Measured fleet 11-06 12Z..11-07 06Z (full walk, 1,647,278 skill rows, 80 bots, 16 towns): tidy places 916/h (17-22Z) ->
485/491/477/286/198 (23-03Z). Keeper lease held 959 of 960 town-minutes an hour before the promotion, 428-649 after; takes 13-24/h ->
52-116/h; underground releases 0-5/h -> 33-77/h. **But the collapse is not keeper starvation.** The towns that stopped (hive-d,
isolated-a, board-c, placebo-c, hive-b) had ZERO tidy visits by ANY bot, keeper or crew, for ~6 h, each right after one STALLED visit
(stuck_on_cell, nothing else open) wrote the town's 6-h tidy stuck stamp (stamps on disk: hive-d 22:17Z, isolated-a 22:38Z, then
6-h cycles: placebo-c 04:38Z, board-c 04:16Z). The stamp held although its cells were waived: `recordCellDone` read a waived paths or
wall cell done, never a waived tidy cell. Positive control: towns with no stamp kept or raised their tidy visits across the same hour
(board-a 7 -> 197 in 4 h, isolated-c 84 -> 176, placebo-a 0 -> 114, board-d 151 -> 233). The fit rule's own cost is churn: 141 of
392 underground releases were 9-12 below a plinth-high home (y 73) under open sky (board-c-Alpha afloat in a lake at y 62).
stations-01: 1,868 failed sweep tries on 342 strays 06-14Z (179 successes), board-a strays 54-58 tries each; the give-up was per bot.
Branch `gklease-02-on-45defefa` @ bce7d783 (tier 2, rollback GKLEASE2=0): a waived tidy cell is done for the stamp; open sky is the
surface down to 24 below; the sweep give-up is the town's. gkwork-01 is complementary: its stall waiver past the tenth needs this rule
to lift the stamp; this rule alone lifts it only where the ordinary waiver still had room. Not fixed: stations hoarded in bags
(220 -> 539; the town deposit's bank of spares does not keep up) -- not small.

## gkroom-01show (bagfull-01 piece 2) and the showcase checks (11-07)

The showcase keeper's grounds order was skipped for room: since 06:40Z, 0 keeper tidy visits; 16 keeper `_shop_skip why=room` rows
(rate-limited 30 min a bot) 06:40-15:01Z, every one with 2-7 free slots. The keeper's order leads with the forest (needs 8 free); the
tidy needs 2. bagfull-01show (dd0a4489, live 15:01Z) banks the stacks no build needs first; `gkroom-01show` @ 835e493b on it (ci2 462/463, the known bagdiet orphan): when that
finds nothing to bank, the KEEPER (the lease itself) with 2-7 free slots and a tidy open or due (not quiet) is ordered the TIDY, and the
visit's reserve/draw/bag reads name the tidy while it runs (Codex r1 blocker, fixed). Rollback GKROOM=0.
gklease-02's rules are not needed on the showcase now: all 15 tidy stuck-stamp files have no stamp (stuckAt none), 1 tidy stuck_on_cell
visit in 2 days, 0 `_station_swept` rows (stations-01 is fleet-only).
Station hoarding in bags (fleet 220 -> 539): `bankable.mjs` KEEP_ONE keeps one table/furnace and the town deposit banks spares only at a
34+ bag. The fix is a spare-station bank on every town visit (junkout-style, or a bagfull room-bank kind): about 40-80 lines in
towndeposit/stations + one test file, tier 2 if it stays out of bankable.mjs's protected scaffoldKeep/isScaffoldItem/SCAFFOLD_SET.

## gkclear-01show (11-07, roughground's 2-h read: the stage held `clears:11`)

Live 191445b8, 19:43-21:53Z: the inwall tidy stage (g91, sited 11-05, 48 plot-prep trunk/leaf clears) is held by 11 standing clears.
buildrun.mjs clears() skips a log no stand reaches without counting it (0 clear rows today; the replants of X2/X4/X5 are settled, so it
is not the sapling wait). The per-bot clears give-up (5 same-bot visits) never trips under rotation, so only gkwork-01's town strikes close
it -- and they need keeper tidy visits: ONE in 2 h (Lumen 21:07Z, strike 1/3). Lumen released `no_work_visit` 21:11Z; the next keeper had
no per-bot `gkwPending`, its order led with the forest (forest first while it wants work), and the tidy never came back. With no completion
there is no next stage, and the rough survey's inside-the-wall re-survey runs only when a next stage is sited (inwallFirst), so the rough
work stayed 0. Helpers' tidy visits never strike (they cannot complete). Fix `gkclear-01show` @ 01c6debf (on 191445b8; ci2 467/468, the known bagdiet orphan): the TOWN's strikes (60-min
window) say the stage is closing; while 1-2 are in, the keeper's order leads with the tidy and its tidy order is never quieted. Codex: no
blockers. Not done: counting no-stand clears per cell town-wide (a cleaner signal than strikes), and a rough re-survey that does not wait
for the stage to close.

## gkclear-02show (11-08: the stale-strike deadlock)

Live gkclear-01show 23:55-00:31Z: 0 tidy visits. Its closing read counted strikes < 60 min old; the only strike was 3 h old, so the keeper
kept the forest first and no tidy visit laid a fresh strike. `gkclear-02show` @ d7306d0d (on dc293197; ci2 467/470: craftsync and lavastep
flakes pass alone, the bagdiet orphan): the closing read counts the whole strike window (6 h); each keeper's tidy-first is bounded by its
own retry stamp (taken at its tidy visit's start): unchanged town count -> the forest's turn for 30 min; a visit that laid a strike ->
the tidy again at once. Codex: no blockers. Not built: counting unreachable clears per cell town-wide (it needs the same keeper tidy
visits; the strike close already lets the clears give way after 3).

## gkleft-01show (11-08: the stage still not closed under gkclear-02)

Live 01:54-04:34Z: the keeper's visits WORKED (Onyx felled 2 logs 03:50Z, laid 3 floor fills 04:05Z -- each resets gkwork's strikes),
then ended `complete; fills left 1/1372` with trunk clears standing (04:16Z): never empty, so never a strike. Its 2 aborted visits were
the stuck reflex. `gkleft-01show` @ a3d6b03d (on 81d1894f; ci2 471/472, the bagdiet orphan): per cell, every visit that ran out of work
(stop `complete`, any bot) stamps the fills and clears it left open and READ in its own file; a cell the town left 3 times (24 h, each
visit's stamp expiring on its own) is waived by the next keeper visit that still reads it open (<= 12 a visit, <= 25% of the stage); a
waived clear is never dug again and no longer counts as left. Codex r1: 2 blockers fixed, r2 fixed.
