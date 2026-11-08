# Town work board (codeeval phase 3 item 1): design and phase A, 2026-11-08

OWNER 11-08: "do all your recommendations now". Recommendation 1 is the town work board, item 1 of phase 3 in
[codeeval-2026-11-06](codeeval-2026-11-06/README.md). Ledger row `workboard-1108`.

**Status: built, not queued, not released.**
- Fleet: branch `workboard-01` @ `141b975a`, on the live fleet `1e593b9b`. Registration and draft queue entry are in
  [workboard-01/](workboard-01/); the registration is installed at `~/mcai-analysis/workboard-01.141b975a.json` on .31 and
  `effectwatch validate` reports `valid`.
- Showcase: branch `workboard-01show` @ `c8540eef`, on the live showcase release `63bc4795` (sitecanopy-01show). Ready to stage.
- Tier 3: `protected.py` flags `bots/src/cognitive.mjs`.

## 1. Where the 54% goes (measured)

Method: full walks with `lib.telemetry.stream_rows` (rotation-aware) and `lib.busytime.classify`. Every second gets one class,
and the classes sum to the window. Each decision row (a model call or a work order) opens a slice that runs to the next decision
row. Scripts are on .31 at `~/workboard-1108/` (`wbmeasure.py`, `wbsupply.py`, `wbvisits.py`, `wbgrounds.py`).

**Fleet window:** 11-07 20:00Z to 11-08 20:00Z.
- 80 of 80 bots; 1,920.0 bot-h observed, 0 unobserved.
- 2,322,677 skill rows and 210,798 llm rows (165,943 model calls, 44,855 work-order rows).
- Positive control: the slices sum to the whole-window classes (543 productive bot-h attributed, against 28.3% of 1,920).

| Class | Share of 1,920 bot-h | Bot-h |
|---|---|---|
| productive | 28.3% | 543 |
| walking | 13.5% | 259 |
| **decision** | **54.3%** | **1,042** |
| of which llm_wait (the model call itself) | 4.7% | 90 |
| of which runner failure pause | 11.9% | 228 |
| of which `between` (cooldown and tick gaps) | 37.7% | 724 |
| idle | 4.0% | 76 |

**LLM latency is not the problem.**
- Mean 1.95 s, p50 1.85 s, p90 3.19 s, p99 4.37 s.
- 86.4 calls per bot-h.
- The model call itself is 8.6% of decision time.

| What preceded the decision time | Decision bot-h | Share of 1,042 |
|---|---|---|
| an admitted model decision | 655 | 62.8% (208 h of it is the pause after a failed skill; `model:failed:gather`, 18,278 calls, holds 155 h) |
| a veto, 55,764 of 165,943 calls (33.6%) | 294 | 28.2% (repeat_loop 96, cooldown 83, bad_args 59, learned_avoid 22, unreachable_elevation 16, deposit_nothing_to_bank 13) |
| a work order (21% of decisions) | 80 | 7.7% (orders yield 218 productive bot-h, against 282 for 110k model decisions) |
| a continuation | 13 | 1.2% |

**By rung.**

| Rung | Share of all time | Share of decision time |
|---|---|---|
| `idle_work` | 50.4% | 51.8% |
| gather_iron_ore | 19.3% | 21.9% |
| return | 9.3% | 8.2% |
| gather_dirt | 6.1% | 4.0% |
| gather_sand | 4.5% | 5.5% |
| deposit_surplus | 4.0% | 4.0% |

**The idle laps: the grounds lap is the hole.** Measured on the live files, 11-08 00:00-20:30Z:
- Idle batches took 765 bot-h. Grounds batches were 2,911 of the batches and 395.8 of those bot-h.
- **2,613 grounds batches (354 bot-h, 89%) ended with zero visits that changed the ground.**
- Of 3,099 grounds batches, 82% opened within 48 blocks of the town (median 19 blocks), yet only 30% held any build visit.
- Inside those batches the model ran explore 5,144 times, goto 4,520, place 4,091, home 4,016, gather 3,797 and bucket
  3,509, against 1,568 build_shop orders.
- The cause: the workshop order is the chain's last town slot. It needs the bot within 48 blocks of town at that tick and waits a
  per-bot cooldown. The model, told to "stay at town", has already wandered off.

**Supply** (jobshadow: 144 ticks x 16 towns = 2,304 town-ticks):
- A builder need was open in 62% of town-ticks (monument 1,296, shop 144), and a groundskeeper need in 83%.
- While a builder need was open, only 35% of that town's bot-ticks were at town, and the town's bots spent 14% of their minutes
  on builder work.

**Build visits** (24 h): 5,550 in total.
- tidy 2,941 (60.6 visit-h, 4,733 blocks placed)
- monument 2,239 (51.5 visit-h, 1,836 placed)
- shaft 236

Visit stops: complete 1,564, deadline 1,422, aborted 1,138, no_material 520, deps_open 340, stuck_on_cell 104.

**Showcase window:** the same 24 h, 14 of 16 bots, 334.1 bot-h.
- Decision time is also 54.3%: between 47.8%, llm_wait 4.7% (p50 2.59 s).
- The **patrol** rung holds 51.8% of all time and 50.0% of decision time. The showcase has no idle_work rung.
- Model `explore` calls (6,073) hold 30.7% of decision time, and `veto:deposit_nothing_to_bank` holds 16.4%.

## 2. The design, reconciled

Two engines designed it independently from the same brief: Claude in a subagent, and Codex with `codex exec` (read-only).
The Claude engine also searched open source and forums. They agreed on every structural point.

| Question | Claude | Codex | Chosen |
|---|---|---|---|
| What a job is, and who writes it | Computed on read, bot-side, from records + leases + the existing back-offs. No host writer; jobshadow stays the shadow | Same: "no host writer or authoritative duplicate board file" | **Computed on read.** The job is `shopActive`'s pick when that pick is workable. One rule, no second picker |
| Claim | The project's own admission slot (`takeSlot`), taken before the walk; the visit's `takeSlot` renews it in place | Same; existing TTL, bounded travel | `takeSlot`, TTL 5 min (`home` maxMs 240 s + 60 s) |
| Binding the visit to the job | `bot.boardPick`, honoured like `starvePick` | "Essential": bind execution to the claimed project | The pin, honoured for the claim TTL while the job is still workable |
| Population | Grounds laps only (an iron lap's batch would never be met) | Grounds batches, shared towns only | **Grounds laps** (fleet); the **patrol** rung (showcase) |
| Pacing | Chain after a visit that worked; keep the cooldown after an empty one | 30 s after verified work; escalating holds | Worked visit: next at once (the gate's repeat window, 4 in 8, is the cap). Empty visits: 2 / 10 / 30 min per (bot, job) |
| repeat_loop on `build_shop:{}` | Blocker; wanted a tier-3 admission exemption | No exemption: never vary args to evade it; hold the action key | **No admission change.** `memoryRefuses` is asked before an order is issued; a refusal yields to the model. The cap is measured (`op=yield why=refused:repeat_loop`) |
| Room window (29-33 slots vs the 8-free rule) | Remedy: `town_deposit` | Never add deposit loops in phase A | **Ineligible up front** (light 2 / heavy 8 free). No new refusal, no remedy loop |
| Switch | `WORKBOARD=1`, plus sub-switches | `off\|shadow\|on` | `WORKBOARD=on\|shadow\|off` (on is the variant's default; off is the rollback) |
| Is phase A the right first step? | Right for the ask; the failed-gather pause (155 h) and the post-admit gap are levers of similar size | Supports a narrow grounds intervention, not a fleet-wide promise | Agreed. Phase A targets the 354 empty grounds bot-h; the pause and veto levers stay their own changes |

**Prior art** (from the Claude engine's search):
- **MineColonies' request system.** A resolver that accepted requests it could never fulfil left workers stuck. Lesson: check
  feasibility at the claim, not on arrival.
- **Dwarf Fortress job cancels.** Lesson: back off the one instance and keep the job; pre-empting a job must release or refund it.
- **RimWorld.** Pawns search for work themselves, and mods exist because pawns walk too far. Lesson: cap the distance.
- **Voyager.** Lesson: retry failed tasks later. A back-off, not a ban.
- **mineflayer-pathfinder.** `setGoal` mid-path switches only at the next node; `goto` can hang on GoalNear at a partial block.
  Lesson: the board never touches the pathfinder. Travel is only the `home` skill, inside the runner's one slot.

## 3. What phase A changes

**`bots/src/townwork.mjs` (new, pure):**
- `workboardMode`: the switch.
- `jobBlocked` and `boardJob`: complete, stuck, unsited, held, full and the stair are not jobs. In the showcase, also `waiting`,
  a planner that is not due, and sinkfix `idle`.
- `boardEligible`: a grounds lap, no milestone holds, health above 10, bag room, `|dy|` of 24 or less, 128 blocks or less, and
  the walk back-off.
- `boardStep`: returns the order (or none) and whether the board owns the turn.
- `boardAfter`: the back-offs.
- `boardDetail` and `rowDue`: the rows.

**`bots/src/skills.mjs`** (unprotected parts):
- `shopActiveAll` returns `{pick, states}`; `shopActive` returns its pick.
- The pin.
- `boardJobNow`, `boardClaim`, `boardRelease`, `boardPin`, `boardLight`.

**`bots/src/cognitive.mjs`** (protected):
- `#boardOrder` runs before the workshop step. When the board owns the turn, the step stands down.
- A refused order and an order's outcome both reach `#boardAfter`.
- A walk's claim rides on its `build_shop`, and is given back at the next board turn if nothing uses it.

**Showcase difference.** There, `buildOrder` carries the showcase's own asks (enchant, copper run, market, expedition, room
remedies). So the board orders only the walk to town (`travelOnly`). At town, the workshop step issues its order as before, but
its cooldown is lifted for 10 min after a plain build visit that worked (`boardChains`). The lift applies only while the gate's
memory would admit the order, and a refused `build_shop` ends it.

**Rows:** `_workboard` with `op=issue | yield | shadow | end | chain`. The `yield` and `shadow` rows are written at most once per
reason per 10 min per bot.

**Reviews:**
- Design: two engines plus the open-source search, reconciled as above.
- Fleet code: Claude r1 found 1 blocker (owning the stair pick starved the stair's order), and Codex r1 found 1 blocker (an
  arrived walk's claim leaked to its TTL). Both were fixed in `0360f43e`; r2 from both engines: NO BLOCKERS.
- Showcase code: Codex r1 NO BLOCKERS. Claude r1 found 1 blocker (the lifted cooldown re-issued a `build_shop` the gate kept
  refusing for repeat_loop), fixed in `675c3a7f`; Claude r2 NO BLOCKERS.
- Then `141b975a` (fleet) and `c8540eef` (showcase) keep two existing tests' anchored `build_shop` `finally` lines intact
  (stuckproj.test, gklease.test); the pin is cleared in its own statement.

**Tests:** `bots/test/townwork.test.mjs` passes 22/22 on the fleet (6 anchored mutants) and 25/25 on the showcase (7 mutants).
It covers behaviour, the chain on real record and lease files (claims fill slots so the next bot moves on, the pin, a release
after renewal is a no-op), the refusal chain, and the wiring.

## 4. Expected effect

The denominator is the grounds-lap bot-h: about 460 a day (395.8 in 20.5 h). Of that, 354 bot-h ended with zero changed ground.

- **Target: 50-150 bot-h a day move from model wandering to build visits.**
  - That is 5-14% of the 1,042 decision bot-h, or 2.5-8 percentage points of fleet time.
  - It also means grounds batches with at least one build visit go from 30% to 60% or more.
  - The registered primary is `_build_visit` per bot-h, up at least 15%; it was 2.9 per bot-h.
- **What makes it zero:**
  - the visits themselves are empty (stuck cells; the 22 stuck-goal alarms);
  - the crew caps fill (2 per town);
  - `groundsMeans` stays false;
  - the gate's 4-in-8 repeat cap;
  - walks home that fail.

  The `end` and `yield` rows name each of these.
- **Guards:** items per bot-h, which iron, logs and coal laps keep earning; drowning deaths; and the productive share.

## 5. Later phases (sketch, not built)

- **B:** material supply jobs from a project's bill (haul, or gather X for project Y), using the same job id. The room remedy
  and an admission progress exemption for `build_shop`, which is tier 3, go here.
- **C:** smelt and repair jobs; the `if (!order)` town-job slots fold into board jobs one at a time; board steps chain without
  the decision cooldown.
- **D:** jobshadow becomes the concordance check (did the board's pick match `jobrules`?), and a mayor may weight priorities.

## 6. The read

At +90 and +180 min, the generic gate plus these lines:
- **Mechanism:** `op=issue` and `op=end worked=yes` rows are greater than 0 on canary bots. The base cannot write either.
- **Effect:** `_build_visit` per bot-h, and the decision share, as a ratio difference-in-differences against control.
- **Guards:** the `yield` reasons (refused:repeat_loop, claim_failed, no_job:*), `slots_full` skips, items per bot-h, and deaths.

The draw must be shared pools: grounds laps need gkforever's crew.
