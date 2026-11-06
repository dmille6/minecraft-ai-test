# Code evaluation: SURVIVAL (reflexes and movement), 2026-11-06

Read-only. Code: origin/main `bd2c308f` (worktree `/Users/darrellmiller/Documents/.wt-eval-survival`). Fleet live `4f3b0f5c`.
Measurements: full walks of the skill files on .31 (80 bots) and .40 (15 showcase bots), using `telemetry.stream_rows`
(rotation-aware). Window **10-29 14:30Z to 11-06 02:30Z (7.5 d)**. The temp scripts and outputs on the hosts were removed afterwards.
Codex: `codex exec -s read-only`, given the area, the files, the incidents and the 5 questions, but none of my conclusions.
Its output is `codeeval/survival-codex-out.txt`.

## (a) Summary

1. **Bots get pinned when correct guards compose into dead ends, and nothing acts on a pin.** Fleet: 191 pins of 1 h or more =
   **549 of 14,400 online bot-h (3.8%)**, and the rate is rising (22 to 33 bot-h/day on 10-29..11-01, 91 to 103 on 11-03..11-05).
   **57% of pinned time (316 bot-h)** has the climb-flood guard or the stranded ladder refusing. stuckwatch has listed
   isolated-d Delta and Echo every 30 min since 11-02 (about 93 h each). Nobody has acted.
2. **The pin fix shipped and missed its target.** swimunder-01 was KEPT on board-a and board-c, but the trapped bots are in
   isolated-d. Since promotion: **186 `_swim_under_refused` on the 3 target bots, 2 successes elsewhere, 0 target bots freed.**
   It has no effect target. The read said "goal-unverified, keep the goal open", and nothing kept it open.
3. **The 11-05 death drop is exposure, not convergence.** Deaths went 18 to 7, but the share of time below y=55 fell from
   58% to 23.5% the same day (dirtrung-01 patrol laps). Deaths per underground bot-h: 11-05 **0.016**, the same as
   11-01..11-04 (0.016-0.019). There was real improvement from late October (~0.035 on 10-23..10-28 to ~0.017), about -50%.
4. **Structure:** `reflex.mjs` grew 2,605 to 7,337 lines since 09-01. It has one 1,900-line tick and about 68 mutable closure
   flags. Four body-ownership mechanisms coexist, one of them dead (the arbiter throws if enabled). There are 17 survival
   kill switches, and about 30 survival canaries in Oct-Nov, each adding a rung for one topology.
   **`lint:movement` fails on main** and only ratchets "no worse".
5. **Verdict: PARTIAL refactor.** Keep the primitives, the pure planners and the bounded rungs. Replace the rung-per-trap
   orchestration with one escape-episode controller and one usable-tool predicate. First, ship 3 targeted fixes for the
   measured pins (S-M each).

## (b) Findings, ranked by impact on "bots keep working"

| id | finding | evidence | impact (numbers, denominators) | rec | effort | risk |
|---|---|---|---|---|---|---|
| S1 | **Wet-ceiling dead end: the flood guard plus the pathfinder plus plugcut plus swimunder's radius 4.** Every rung refuses correctly. The remedy the refusal names, "goto away", is the pathfinder that just refused (`sealed_in_liquid visited=1`). The owner rule is that water is terrain and swimming is travel. Yet the guard refuses to let water in over a bot whose head is in air, at 20 HP and full air. | Delta's live rows: `_climb_flood_guard` "liquid above the block overhead" x178, `_climb_flood_refused` "remedy: leave this cell sideways or downward (mine or goto away)" x42, `_plugcut` "wet face 0,3,0" x36, `_swim_under_refused` "no way out within 4 cells" x10, `_path_no_legal_move sealed_in_liquid` x332 (today's live file). reflex.mjs:6301-6460 (floodBranch/guardBranch), 3137/3655 (ramps), swimunder.mjs | **316 bot-h / 7.5 d** (39 pins). Delta 95.3 h, Echo 91.6 h, isolated-c-Bravo 54.5 h (+4.6 h): **~42 bot-h/day** | FIX: give the guard a pinned-episode exception. After 30 min pinned, with head in air, air full, HP >= 18 and no lava, admit one "flood-in and swim up" breach (the drowning rescue stays the backstop). Also widen the swimunder search on a long pin (radius 4 to 8, descent 2 to 4). Paper repro on the isolated-d cut before the canary. | M | med (tier 3; Paper first) |
| S2 | **Nothing ACTS on a pinned bot.** stuckwatch (cron :17/:47 since 09-21) writes a log and a header line, and nobody owns it. stallcheck has no pinned-bot detector; it covers projects, the queue and branches. On the bot, the livelock ladder ends in `recovery_exhausted`, "TERMINAL ... a state a person reads in the digest" (cognitive.mjs:604-623). `_entombed_unrecoverable` (reflex.mjs:3521) hands a prerequisite to the goal layer, which abandons it after about 1,000 s (Gale `_prereq_abandoned` "had 0/2 after 1006s"). | `~/digest/stuckwatch.log`: Delta has been listed in 179 consecutive half-hour samples since 11-02 08:47Z. There are 1,937 PINNED blocks in the log. Survival effect targets cover death rates only. swimunder-01, dropdig-01, poolescape-01, ceilescape-01, plugcut-01 and cavefall-01 have **no** entry in `config/effect-targets.json`. | All pinned time (549 bot-h) goes undetected-in-practice: hours to days | FIX: (1) a stallcheck detector "bot pinned >= 4 h with no ledger row" that pages through the same ntfy path as the death breaker; (2) every survival fix gets a `pinned_bot_h` effect target; (3) a bot-side pinned-episode clock (no movement over 3 blocks and no successful work for 30 min) that walks a fixed ladder and records which rung refused. | S (1,2) / M (3) | low |
| S3 | **The canary pool missed the target population.** CLAUDE.md says "A canary pool must contain the population the fix targets". swimunder-01 drew board-a and board-c, but the targets were in isolated-d and isolated-c. The memory row even said "Draw isolated-d/isolated-c if allowed". The read said KEEP "goal-unverified". | journal 11-04 14:28Z drawn `board-a,board-c`. Since promotion 17:43Z, `_swim_under` fired 3 times fleet-wide (2 out, 1 failed, all hive-a/b), and `_swim_under_refused` fired 188 times (69 Delta, 69 Echo, 48 isolated-c-Bravo). Paper: 6/6 escapes on a cut; live: 0/138 on the same 2 bots. | The fix built for ~120 bot-h/72 h freed **0** of 3 target bots. **~84 bot-h** since the KEEP | FIX (tooling): a registration field `target_bots`/`target_pools`. The draw must include one, or the read is INCONCLUSIVE rather than KEEP. | S | low |
| S4 | **Showcase Gale, 22 h: protect zone plus tool reserve plus the "transit" purpose.** Gale is underground at y 58-60, inside the taiga village box (y -64..90, floor_y 54), so the deep exemption does not apply. Its feet are 4 above floor_y. The `surface` pillar is purpose=transit, so the zone refuses the place. `mine` is refused as protected_zone. The marooned arm treats the iron pickaxe with 1 use left (249/250) as gone. It asks for 2 pickaxes, but the crafting table cannot be placed: "no solid block with a free space above it" / zone. It holds 540 cobblestone and 5 sticks. | `.40` rows 11-05: `_protect_zone_refused op=place purpose=transit by=surface` x125, `_marooned_needs_pickaxe` x57, `mine reason=protected_zone` x9, `_tool_broke` x2 on the climb (shaft ascent from y 13). protectzone.mjs:110-126, 239-243; zone file `/srv/showcase/ops/protected-zones.json`. | 22.2 h, 1 of 15 showcase bots. Showcase pins total 38 of 1,880 bot-h (2.0%) | FIX: (a) a bot whose FEET are below the terrain surface inside a zone counts as deep (compute from the column, not a fixed floor_y), or (b) a marooned/surface climb gets purpose=survival. Plus S5. | S | low-med |
| S5 | **There are 5+ definitions of "usable pickaxe", and they disagree.** `mayDigForEscape`: usable = left > 1; exactly 1 refuses, 0 is allowed (reflex.mjs:4069-4131). `poolToolOk`: usable <= 1 refuses, so 0 refuses too (poolescape.mjs:268-276). `toolFor` allows the last swing only for HARVEST digs, and escape digs keep HARD_STOP (toolfor.mjs:127-153). `pickaxeUses` counts uses minus 1 per copy (exit-contract.mjs:79-89). craftroom never wears "the last digging pickaxe" (skills.mjs:6239-6251). A pickaxe at 249/250 is never spent, so it never breaks, so it lives forever as "gone" to the escape and "the last pickaxe" to craft room. | hive-c-Bravo, pinned now (6.7 h): two iron_pickaxe at 249/250, bag 36/36, `_craft_room refused "no spent tool that can be spared (the last digging pickaxe is kept)"` x72, `craft iron_pickaxe short 3x iron_ingot` x49 while holding 317 cobblestone (a stone pickaxe was craftable), and the pillar blocked by the flood guard. Gale: the same 249/250 state. | ~29 bot-h measured (Gale 22 + hive-c-Bravo 6.7), plus an unknown share of the 69 "other no-path" pins (97 bot-h) | FIX: one `usablePickaxes(items, purpose)` in toolfor.mjs used by all five. An escape dig may spend the last swing when the bot is pinned. Craft room may wear a 1-use copy. The pickaxe prerequisite asks for the cheapest craftable tier (stone when cobblestone is held). A property test composes the reserve, the craft room and the prerequisite. | S-M | med (tier 3) |
| S6 | **Movement and body ownership is four mechanisms, one dead.** (1) The arbiter: `config.reflex.arbiter` throws if ARBITER=1 (config.mjs:166-186), so grants are always null, but 5 code paths still branch on it. (2) `runner.bodyClaim`. (3) `runner.reserve()` plus 5-s renew loops, duplicated in poolescape (reflex.mjs:1780-1830) and swimunder (1846-1902). (4) Closure booleans and counters checked through `yieldTo` callbacks (rescuing 25 refs, escaping 23, pocketing 17, poolEscaping, airPocketing, strandedRunning, swimmingUnder ...). `activeReflexOf` (pickuplog.mjs:85) knows 5 of about 12 owners. | 68 `let` flags in `startReflexes` before the tick (reflex.mjs:1239-1941). The tick runs from 1942 to 3790 with about 12 early returns. 98 inline review-round references (`Codex r4 P2` etc.) in reflex.mjs. | Indirect: every new rung adds a flag and N yield checks. The 10-22 poolescape/stranded double-steer (r5) is that class. | REFACTOR (part of the verdict): one `BodyLease` (priority, generation, renew, release) used by reflex rungs, the runner and lavastep. Delete the arbiter shim or finish it. | L | high |
| S7 | **One escape planner per topology, not one escape planner.** Pillar, ramp/escapeStairUp, digStraightUp, plugcut, ceilescape, poolescape, swimunder (its own uniform-cost search), dropdig, airpocket (pocketPlanFor), tombexit, cavefall, respawnfall, and lavastep/lavastepmove. Each has its own admission, pricing, cooldown, rows and kill switch. A new trap means a new module, plus reflex hooks, plus tests that pin the order. | 21 survival modules created since 10-01. About 30 survival canaries in Oct-Nov (journal), 1 survival REVERT (homefix-01). 157 commits on the survival files since 10-01 (Codex: 126 Oct, 31 Nov). 17 survival env kill switches (124 env flags in all of src). Event kinds in src: 99 (10-01) to 352 (11-06); in reflex.mjs: 39 to 65. | Convergence on DEATHS yes (about -50% per underground bot-h). On PINS no: pinned bot-h/day rose to 91-103. Each fix covers one geometry, and the next pin is a new geometry. | REFACTOR (partial): one escape-episode controller. It runs a bounded search over the actions the bot can take now (walk, swim, dig with any tool incl. last swing, place, pillar, let water in), with one cost model (air, HP, tool uses, blocks). The existing pure planners become its move generators. | L | high |
| S8 | **`lint:movement` fails on main and sees too little.** Its regex matches only `bot.pathfinder.(setGoal\|setMovements\|stop)(`. It misses `?.` (bucket.mjs:169, cognitive.mjs:572), `pathfinder.goto` (48 lines, 5 files), and `setControlState` (103 lines, 8 files), which is how the reflex rungs actually steer. Right now it FAILs: buildbot.mjs (since shop-01, 10-25), test/pathhalt, test/pickuplog-review. canary-sched only requires "no worse than the base" (canary-sched.py:2423), so the violations are frozen in. | `node scripts/check-movement-writers.mjs` gives exit 1, "7 file(s) steer; baseline allows 4" | Low direct. It gives false assurance that movement has one owner. | FIX: make it syntax-aware, include controls and goto, and enforce the BodyLease boundary once S6 exists. Until then, rename it so it is not called a single-writer check. | S | low |
| S9 | **Detector bugs and noise.** stuckwatch loads only live files (`skill-*.jsonl`), so the 00:17 run after rotation sees 18 min, which yields false "PINNED" bots daily (about 15 of the 23 bots listed in 7 d appear only in 00:17 runs). `_path_reset` is **2.67 M of 13.9 M rows (19%)**. `_watchdog_rescue` fired 127,776 times (213 per bot per day), `_livelock_escape` 45,602 times and `_entombed_unrecoverable` 10,672 times: rescues that fire but do not resolve the pin. | pinwalk kinds_day; stuckwatch.log | Analysis cost and alarm fatigue: stallcheck shows 53 "STALLED" items, and the survival lane has been "nothing runnable 48 h". | FIX: stuckwatch must use rotation-aware `stream_rows`. Sample `_path_reset`. Rate-limit the watchdog rows per episode. | S | low |
| S10 | **Tests pin text and layout.** About 50 tests read the reflex source; about 775 match/includes assertions sit in tests that read source. Most check reason prose (`assert.match(d.reason, /no affordable ramp exit: stone 187\.5s .../)`), and some check source windows. Codex: dig-hand.test.mjs:150 searches the next 2,600 characters, and 3a7badea moved logic to fit that window. | bots/test: airpocket 70, ceilescape 57, climb-flood-chain 33, entombed-escape 31 | Slows every survival change. Each rung needs Codex+Claude rounds (reflex.mjs has 98 review-round comments). | FIX: move the assertions to reason CODES (enums) and composed behaviour. Keep the mutant-backed structural checks. | M | low |

**Keep (good, and it works):**
- The pure, exported decision functions with real tests: `stuckDecision`, `refusalEscalation`, `canFinishClimb`, `pocketPlanFor`, `dropAdmission`, `swimUnderPlan`, `zoneDecision`.
- Measured, server-confirmed digs (dropdig's ground guard, which caught a real ghost-air case on Paper).
- The reflex-layer-down escalation (reflex.mjs:3790-3812).
- `haltPath`, the watchdog rescue reservations, the exit contract, and per-rung kill switches with exact-base restore.
- Telemetry rich enough that a pin can be explained from the rows alone, as every case in this report was.
- Death-rate convergence is real: drowning, fire and fall all came down from the October levels.

## (c) Codex (independent) and reconciliation

Codex's verdict was **"partial: redesign recovery coordination and movement ownership; keep the tested safety rules and
escape primitives."** Its ranked findings:
1. Correct refusals compose into non-executable recovery (358,58,180). It recommended REFACTOR into one recovery episode
   with elapsed blocked time and attempted remedies, rated L.
2. Movement ownership is not enforced: the arbiter is unsupported, hard stops leave the old promise alive, and pool and swim
   add renewal loops. Its recommendation: one generation-scoped movement executor (L).
3. The watchdog is blind to work that never starts. Chronic stranding covers only y<50, so it misses the y=58 pocket, and
   `stranded_unrecoverable` only logs (watchdog.mjs:328, 465). FIX, M.
4. Single-cell geometry and dig pricing (y=N.2, 25x floating dig price) need shared body/eye/landing observations.
5. "Get a pickaxe" is advisory, and the prerequisite is abandoned after 15 min. Codex believed the one-use trap was
   "addressed by usable-tool counting and last-swing harvesting" (toolfor.mjs:140).
6. reflex.mjs is the integration bottleneck (+40% since October). Poolescape and swimunder duplicate the reservation logic.
7. Tests dictate layout (dig-hand's 2,600-character window).
8. The movement lint misses `?.`, goto and controls. `waterMovements` is built but unused (index.mjs:920).
9. Keep: the rescue reservations, the hard-stop bounds, the exit reserve, `haltPath`.

Codex also found no convergence: 126 commits in October and 31 in November on the survival files, plus 5 new fix families
in November.

**Agree:** S1 is Codex 1. S6 is Codex 2. S7 is Codex 1+6. S8 is Codex 8. S10 is Codex 7. On what to keep, both evaluations
match. Both reach the same verdict, partial, and the same order: make stalls actionable first, redesign second.

**Differ, and why:**
- **The one-use pickaxe trap is NOT fixed.** Codex read the code; I read live rows. toolfor's last swing applies only to
  harvest digs on the stone family, while escape and travel digs keep HARD_STOP (toolfor.mjs:144-147), and craft room
  refuses to wear the "last digging pickaxe". hive-c-Bravo (two copies at 249/250, pinned now) and Gale (22 h) are live
  counter-examples, so S5 stays a top fix.
- **Ranking: targeted fixes before the L refactor.** Codex ranks the episode refactor first. The measurements show 3 pins
  holding 44% of all pinned time (241 of 549 bot-h) and 1 composed guard (flood) behind 57%. S1, S4 and S5 address most of
  it in days. The refactor (S6/S7) is what stops the *next* geometry, and it should follow.
- **Codex's #3 (watchdog y<50 gap) is valid, but the bottleneck is acting, not seeing.** stuckwatch does see these pins
  within 4 h. The gap is that nothing owns the alarm (S2), and the bot-side terminal states are designed to wait for a person.
- **Codex had no telemetry.** It could not see the canary-pool mismatch (S3), that the death drop is an exposure effect,
  the stuckwatch rotation bug (S9), or the protect-zone composition behind Gale (S4).

## (d) Top 3 to do first in this area

1. **Close the loop on pins (S2 + S3), S, tooling only, no bot risk.** stallcheck pages on any bot pinned 4 h or more with
   no ledger row. stuckwatch becomes rotation-aware. Every survival registration declares `target_bots` and a
   `pinned_bot_h` effect, and a draw without a target bot is not KEEP. Expected effect: a pin is seen and owned within
   about 4 h, not 4 days. The swimunder miss would have been visible at the +180 read.
2. **Break the two measured compositions (S1 + S4/S5), M, tier 3, Paper first.**
   - (a) After 30 min pinned with head in air, full air and HP 18 or more, allow one flood-in-and-swim-up breach, and widen
     the swimunder radius on a long pin.
   - (b) Use one `usablePickaxes(purpose)`; a pinned escape may spend the last swing; craft room may wear a 1-use copy; the
     pickaxe prerequisite asks for the cheapest craftable tier.
   - (c) A protect zone treats a bot below the terrain column as deep, or gives the surface/maroon climb survival purpose.
   - Expected gain: about 35-45 bot-h/day on the fleet (the 3 long pins plus the flood class) and about 3 bot-h/day on the
     showcase.
3. **Start the partial refactor with the body lease (S6), then the episode controller (S7), L.**
   - One `BodyLease` replaces the arbiter shim, the closure booleans and the renew loops.
   - Then one escape-episode controller, with the existing pure planners as move generators and one cost model, owning the
     "pinned for N min" clock and the ladder.
   - Gain: new traps become new move generators, not new modules plus reflex hooks plus a canary, and refusals compose by
     construction.

## (e) Refactor verdict: PARTIAL

**Yes** for coordination: who owns the body, and how an escape episode chooses, escalates and ends. That layer has been
hand-composed, one trap at a time, for 30 canaries. Deaths per underground hour halved, but pinned bot-hours tripled, and
every long pin in the window is a composition of correct guards.

**No** for the primitives: physics-aware moves, pure planners, server-confirmed digs, telemetry and kill switches. They are
the tested, working part. A rewrite of them would reset 2 months of Paper-proven edge cases.

The order: tooling first (S2/S3, days, no bot risk), then targeted fixes for the measured pins (S1/S4/S5), then the lease and
episode controller behind a kill switch, canaried on pools that contain trapped bots.
