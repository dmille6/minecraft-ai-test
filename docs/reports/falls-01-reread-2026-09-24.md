# fc28885 (falls-01) re-read: the revert was rule-compliant and wrong

Read 2026-09-24 with the fleet unchanged (`9b572aa`, 80 bots, no canary). All fleet work
read-only. Nothing deployed, declared or restored.

Window read from the ledger, never typed: declared `2026-09-18T02:19:40.201667Z` → REVERT
`04:39:10.154216Z` (2.325 h), pools `placebo-a,placebo-b`, baseline `b1659c0`.

**The window is still fully readable.** Positive control on the read itself: 161,451 rows /
80 bots / 109 event kinds, first row 0.0 s after `since`, last 0.1 s before `until`, two
builds present (`b1659c0+ab74e7` 154,005 rows, `fc28885+848415` 7,446), all 10 canary bots
on the canary build.

## 1. Observability-only: TRUE (source-verified)

Scope correction: the deployed canary was the whole stack `b1659c0..fc28885` — **3 commits,
146 net src lines** — not the single diff the first audit read. Tracing the full stack does
not change the answer.

| symbol | every consumer in the sha's tree | sink |
|---|---|---|
| `pathDropProfile` + `waterLandings`/`lavaLandings` | `index.mjs:824` → `lastPlannedPath.drops` | log string |
| `LAVA` regex narrowed | `pathDropProfile` only | log string |
| `describeFallPath` | `composeFallRow` only | log string |
| `composeFallRow`, `ROW_BUDGET` | `index.mjs:113` → `detail` | `logEvent({kind:'fall_path'})` |
| `markPathEnded` | `index.mjs:788,789,791`; assigns `active/endedBy/endedAt`, calls nothing | record field |
| `lastPlannedPath`, `.active` | `index.mjs:113` (log arg), `:873` (`descentOnset.pathActive`) | log string |
| `descentOnset` | declared `:53`, written `:869,:873`, cleared `:119,:1021`, read once at `:114` | log string |
| `bot.movementProfile` | 9 label writes beside existing `setMovements`; read once at `:822` | log string |
| `peakY` restructure | arithmetic identical | — |
| `fallRecord` | `:958`, `:974`-area, both pre-existing call sites | `logEvent` |

`logEvent` (`logger.mjs:102-148`) writes one JSONL line and returns. It does **not** touch
`memory.events`, which feeds RECENT EVENTS in the prompt (`prompt.mjs:712`) — that channel
is `cognitive.notify()`, which `fallRecord` never calls. **The rows do not reach the model
either.**

Structural-invariant test per CLAUDE.md: comments stripped with a quote-aware scanner,
anchors asserted present AND unique, **4/4 mutants killed**, each for its intended reason
(a reflex reading `.active` to cancel a runner; `markPathEnded` calling
`bot.pathfinder.stop()`; `descentOnset.pathActive` gating `setGoal(null)`; the row pushed
via `cognitive?.notify`).

**Honest caveat, source-verified:** there is a COST channel, not a control-flow one.
`pathDropProfile` runs `bot.blockAt()` per >1-block drop node on every accepted
`path_update`. It cannot change a decision. Observed paths carried 0-4 such drops.

## 2. What actually killed the two bots (measured)

| bot | time | cause | state | mechanism |
|---|---|---|---|---|
| `placebo-a-Alpha` | 04:27:40 | drowned | **idle** | 145 s sealed pocket at 510,53,183: `_drowning_ceiling_no_air` x4 ("sealed, no route up or out"), `_flooded_pocket_rung` refused, `_drowning_rescue_yielded` x2. **The same bot drowned the same way at 01:39:59 in the PRE window on baseline `b1659c0`** — a chronic emitter. |
| `placebo-b-Echo` | 04:36:46 | "unknown" | **idle** | marooned underground: `_marooned_needs_pickaxe`, `_reflex_danger_block lava` x2, `_lava_corridor` "lava beside at 558,39,400", `_reflex_low_health health 6`, died at 558.4,**40.5**,400.5 — adjacent to that lava. |

Neither is a fall. Neither had a planned path executing. Both are the unrelated-death
patterns already named in the owner's own two-death decision ("a lava swim during explore,
a drowning while idle"). The canary code fires only on `path_update`, the 1 Hz peak sampler
and the fall record — none of which was in play.

## 3. Recomputed verdict

80 bots, 16 worlds, 185.40 bot-h post; **5 deaths across 5 DISTINCT pools** — maximal
dispersion, no clustering.

| | deaths | bot-h | rate |
|---|---|---|---|
| canary (10 bots) | 2 | 23.17 | 0.0863/bot-h |
| control (70 bots) | 3 | 162.23 | 0.0185/bot-h |
| ratio | | | **4.67x** (the loop said 6.6x) |

**The owner's gate as written (>=2 deaths AND >1.25x) DOES trip. The revert followed the
rule. The rule is what is wrong.**

In-window randomization over all **C(16,2)=120** same-shape assignments:

| quantity | value |
|---|---|
| P(>=2 canary deaths) | **10/120 = 0.083** |
| P(full owner gate trips) | **10/120 = 0.083** — the gate's false-revert rate in this window |
| smallest attainable p | 1/120 = 0.0083 |

**Corrected rule (>=2 deaths AND >1.25x AND in-window p <= 0.05): NO REVERT.**

## 4. Positive controls, both directions

**(i) The instruments find real harm.** Same scan on `aa44514` owner-01b, which the audit
calls a correct revert: 7 deaths, 3 canary / 4 control (0.0842 vs 0.0160/bot-h); licensing
row `_escape_rung` **240 canary rows against 0 in 249.5 control bot-h**; and the rows sit
INSIDE the death windows — `hive-a-Bravo` @16:33:01 had 7 in the preceding 600 s, the last
three `outcome=preempted blocks=0` at -51 s, -31 s, -10 s. Its randomization p = **5/120 =
0.042 <= 0.05**, so the corrected rule STILL REVERTS owner-01b, on real data, nothing
injected.

**(ii) Not a KEEP-machine.** Injecting 2 extra canary deaths into the falls-01 window
(seeded RNG): 4 vs 3, 0.1727 vs 0.0185/bot-h, 9.34x, **p = 1/120 = 0.0083 → REVERT**.

## 5. Disposition: restore to `main` after 27 Sep. Not a re-canary.

| | value |
|---|---|
| `_fall_path` measured | 31 rows / 23.17 canary bot-h = **1.338/bot-h**, 9 of 10 bots, mean 1,612 B |
| control (positive control on the zero) | **0** in 162.23 bot-h — the same scan found 31 in canary |
| 80-bot projection | 2,569 rows/day, **4.14 MB/day raw** |
| against fleet skill-log volume (720 MB/day) | **0.58%** |
| against the retained store (1.3 GB / 14 d) | **0.169%** |

- It cannot affect behaviour, mutant-proven, and it already ran 2.3 h on 10 live bots
  without incident. A canary slot buys nothing for a change with no behavioural surface,
  and would re-expose it to a gate measured at 8.3% false-revert in this very window.
- **The merge is clean.** `git merge-tree origin/main fc28885` → exit 0, no conflicts; the
  materialised tree runs `npm test` **198/198**. An earlier claim in this project's notes
  that it conflicts four ways was wrong: that came from CHERRY-PICKING `fc28885` alone,
  which is the TIP of a 3-commit stack (`bcbb302` -> `8f1e037` -> `fc28885`) whose first
  commit creates `fallpath.mjs`. Merge the branch; never cherry-pick the tip.
- It is still the gap: `fallpath.mjs` is absent from `origin/main` and from the deployed
  `9b572aa`, nothing replaced it, and the falls analysis has been blind since 18 Sep.
- Promotions are forbidden until 27 Sep, so this is a QUEUED restore, not an action now.

## 6. What this says about the death gate — an owner decision

Adding `in-window p <= 0.05` to the death gate would not have reverted falls-01 (p=0.083)
and would still have reverted owner-01b (p=0.042). The two-death floor is owner-set
(2026-09-11) and an attribution amendment was rejected once already, so this is raised, not
taken.

Provenance: window bounds, exposure, death counts and causes, `_fall_path` volume, build
split, log sizes, the owner-01b control and all p-values are **measured**; the
observability trace, merge cleanliness and the `logEvent`-does-not-reach-the-prompt finding
are **source-verified**. Nothing load-bearing is inferred. One unresolved item: the loop
reported 2 control deaths where a full walk finds 3 (0.013 vs 0.0185/bot-h). Both exceed
1.25x, so it changes no conclusion.
