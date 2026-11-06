# idlework-01 — productive work instead of the patrol lap; an unsited project yields its turn (2026-11-06)

Fleet piece, P lane. Branch `idlework-01` on the fleet base `4f3b0f5c` (dropdig-01). Tier 2 (`protected.py`: not protected).

## Measured (fleet, 11-05 01:00Z – 11-06 01:00Z, 80/80 bots, 1,906 bot-h of decision time)

Sources: the control session's audit walk (`walk.json`, `walk2.json`: every llm row, gap to the bot's next call capped 120 s)
and this piece's own `lib.telemetry` full walk of the skill files (1,512,073 rows, 80 bots) plus the project record heads in
`/var/lib/mcai/_pool-*/`.

**The lap.** After dirtrung-01 (11-04 21:22Z) stopped the dirt rung re-opening every lap, every rung before `patrol` was met for
most bots, so SUSTAINING became patrol → deposit_surplus (vacuously done 80 blocks out: no chest within 48) → return → re-enter:

| milestone (decision bot-h) | 11-04 (1,878) | 11-05/06 (1,906) |
|---|---|---|
| patrol | 413 | 963 |
| return | 455 | 474 |
| deposit_surplus | 127 | 116 |
| idle | 77 | 57 |
| **idle lap total** | **1,072 (57%)** | **1,610 (84%)** |
| gather_dirt_16 | 449 | 15 |

Model choice by decision bot-h: explore 342 → 760, gather 578 → 136. Value per bot-h 16.14 → 9.90. A live prompt
(board-a-Alpha, `patrol#3506` — the chain had re-entered 3,506 times): explore 75 → "now: Return home" → goto home → "now:
Nothing to do" → explore 76 → explore 94 → Return home → home → Nothing to do. That bot held 217 cobble/deepslate, 17 logs and
a diamond pickaxe. Repeat-loop vetoes 261 bot-h, mostly `explore` repeated on this rung.

**The towns with no open project (7 of 16).** The town plans' outer plots read "planned" in every town, even where the monument
is complete, so the plan's state is not the truth; the record heads and the build_shop rows are (W24, 3,934 build_shop rows,
1,791 `_shop_skip` rows):

| town | records | why nothing is open |
|---|---|---|
| board-b, hive-b, placebo-a | every fleet project complete (shop, shaft, house1, monument, wall, tidy; paths no_site) | nothing left in `PROJECTS`; gate/pavilion have no fleet blueprint, the tree farm is showcase-only |
| board-a | shop, shaft, house1 complete | monument: "no ziggurat site" 41 visits, 217 `no_site` skips (furniture 190 / avoid:project 126 rejects) — paths, wall, tidy never reached |
| placebo-d | shop, shaft, house1 complete | monument: "no ziggurat site" 57 visits, 180 skips (liquid / no_ground / furniture) |
| hive-c | shop complete, shaft no_site | house1: "no proven site" 23 visits, 189 skips — monument and tidy never reached |
| board-c | none | the workshop: "no proven site" 31 visits, 146 skips — the stair and the tidy (no `after`) never reached |

Cause for the four: `shop.mjs activeProject` returns the first open project whose `after` is complete, sitable or not, and
`buildOrder` then holds every bot 24 h on **its own** last stop (`state.lastStop === 'no_site'`), whichever project is next.

**Confound named.** The patrol share is highest on the eight 4B pools (placebo-b 85%, board-b 72%, placebo-a 65%, board-a 57%,
hive-b 54%, hive-a 53%, isolated-a 53%); q7 pools 21–37%, including the projectless board-c (34%) and placebo-d (30%). The rung
is the ladder's (deterministic); the model decides how long a lap takes. A canary read must stratify by model.

## Design — Claude

- **A. `idle_work` replaces `patrol` (IDLEWORK=0 rollback).** Each lap asks for ONE bounded batch, *gained since the rung
  opened* (holding is not gathering): iron 6 (raw_iron/ingot; needs a trip pickaxe), logs 16, coal 8 (any pickaxe); rotation
  by chain cycle `iron, logs, iron, coal, logs, iron, coal, scout` (one scout lap in eight keeps the deposit sightings). Never
  cobble (towns at the 1,000 cap; 38% of new cobble went down the well). A controller skip (45 min no serving progress / 25
  failures / 3 h) bars the **kind** 3 h, never the rung (`noBar` + `onSkip`); the exhausted chain re-enters for it (`reopens`);
  every kind barred → scout → `none` (vacuously done, no re-entry, no cycle spin). `wants`/`wantsAny`/`hint` are the batch's,
  so the value classifier and the milestone-critical exemption see the real target; `servesRung` routes the scout lap to MOVE.
- **A2. Return before deposit (IDLEWORK_RETURNFIRST=0).** The note on `deposit_surplus` already says "Placed AFTER return on
  purpose"; the list had it before. With the bot at the chest, `deposit_surplus` is also met when the deposit's own plan
  (`depositPlan`, admission's judge) moves nothing — so the reorder cannot turn admission's `deposit_nothing_to_bank` into a
  45-minute wait every lap (the composition test).
- **B. An unsited project yields its turn (UNSITEDWAIT=0).** A visit that ends `no_site` with no record stamps the PROJECT
  (`<key>.unsited.json`, the town's file, plus the bot's memory if the write fails); inside 24 h it is not `free`, so
  activeProject takes the next open project (as `stuckBackoff` does for a stuck one); the order's no-site day reads the active
  project's stamp, not the bot's last stop. All open projects unsited → the first is still returned and its stamp holds the
  order (no visit storm). Expected: board-a/placebo-d → paths → wall → tidy; hive-c → monument; board-c → the stair, the tidy.

## Design — Codex (independent, `codex exec` read-only, given the measurements and the goal, not this design)

Three reversible changes: (1) `SUSTAIN_NEEDS_V1`: replace patrol with need-driven batches — select a need → acquire one bounded
batch → return → deliver → reassess; needs computed from fresh town stock, project bills and claims; at the cobble cap consume
before gathering; "never request material the bank will reject"; completion is the bot's finite batch, not "the town reaches
target". (2) `PROJECT_DISPATCH_V1`: the selector exists; "dispatch the next runnable candidate when another is backed off";
"persist siting retries by world/pool/home/plot … not the current bot-global shopState, whose no_site cooldown can spill
across projects". Completed catalogs need new blueprint-backed projects later. (3) `RETURN_BEFORE_BANK_V1`: yes, reorder;
deposit disposition from actual transferable surplus; never wait indefinitely; test the guard composition.

## Reconciliation

Agree on all three shapes, the batch-not-target completion, cobble excluded, the per-project (not per-bot) siting back-off and
the composition tests. **Difference:** Codex computes needs from the town's stock, bills and claims; this piece uses a fixed,
bag-measured rotation of materials that are always useful (iron for the ~440 iron pickaxes worn out a day, logs the town banks up
to 4,000 a type, coal for every furnace). Why: the town index read is async and stale-prone, and the measured loss is the
walk, not a wrong material — every batch here is banked (`depositPlan` banks raw_iron, coal and logs) or used. Town-demand
picking (project bills first) is the named next piece (idlework-02), after this one's read. Codex's per-batch claims across
five bots are deferred with it.

## What it does not fix

board-b, hive-b and placebo-a have built every fleet project: they need new projects (towngate-01 is queued; the tree farm is
showcase-only — rolling it to the fleet is a setting/owner decision; stoneworks-01 adds a sink). The stuck open projects
(placebo-b tidy 43 h, isolated-a wall, hive-d monument …) are stuckproj-01's.

## Read (+90/+180, canary pools vs control, stratified by model)

**Model change 11-06 01:33Z (coordinator, owner OK):** the 4B was removed from board-a, board-b, placebo-a and placebo-b (back on
qwen2.5:7b); hive-a, hive-b, hive-c, isolated-a stay on the 4B. Those four towns' value from 01:33Z on is partly the model, so
they are neither drawn nor used as control. **Draw: board-c and placebo-d** (q7 throughout, both projectless: board-c's workshop
and placebo-d's monument are the B case; patrol share 34% / 30%). **Control: the q7 pools with no model change** (board-d,
hive-d, isolated-b, isolated-c, isolated-d, placebo-c); the 4B pools are reported as their own stratum, never pooled.

Effect (declared): **value per bot-h up** (scoreboard) and **patrol+explore share of decision bot-h down** (llm rows: milestone
`patrol`/`idle_work` scout, skill `explore`). Mechanism (defect if absent): `_idlework` open rows on the canary bots with kinds
iron/logs/coal ≥ 70% of opens; `idle_work` met rows > 0. Guardrails: deaths (generic gate), `deposit_nothing_to_bank` bot-h
not up, the chain never idle > 10% of canary decision time, `project_unsited` rows only for towns with a measured no_site.
B's own line: a new record (paths/wall/monument/shaft/tidy) published in board-a, placebo-d, hive-c or board-c within 24 h of
the rollout — only readable if the canary pool contains one of them (it should: draw board-a or board-c).

## Review (fun mode: tier 2, one engine, one round, blockers only)

Codex r1 on 6f738f88: two BLOCKERS, both fixed in r1 —
1. a six-iron batch at the chest reaches `deposit_surplus`, whose plan is non-empty, but admission's `depositDue` refuses under
   12 bankable (and < 30 slots): a 45-min wait. Fix: `depositRefused(items)` = plan empty OR not due; the rung is met then
   (test: 6 raw_iron met, 14 not).
2. a `noBar` skip leaves `skipped` alone, and cognitive.mjs (protected, unchanged) reports `skipped.at(-1)` unreachable to peers
   when the reason is `attempts` -- an older, unrelated goal. Fix: the noBar skip's `lastSkip.reason` is `kind_attempts`, so
   the peer report cannot fire (test with an older entry on the list).
