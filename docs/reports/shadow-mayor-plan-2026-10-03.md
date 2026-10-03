# Shadow mayor / overseer — two-engine plan, 2026-10-03

Owner (10-03 ~02:30Z): "draft [a shadow-mode mayor/overseer] and add it to our queue ... use both engines to find the
best approach and implement it." He wants to know whether Claude and/or GPT could manage and direct the 80 bots.

Claude and Codex designed it independently (read-only, grounded in the live telemetry). They converge; this merges them.

## Decision
**A host-side, observe-only mayor on 10.0.0.31** (both engines). It rebuilds a per-world roster from the telemetry the
bots already write, and logs which temporary duties a DETERMINISTIC mayor would assign. The same immutable snapshots are
later given to Claude and to GPT, whose proposals are validated and scored by the same scorer. No bot code changes, no
canary slot, no command channel to the bots. The in-bot mayor of the 09-29 spec (option A) is NOT built yet.

**Where they differed:** Codex: run Claude/GPT live every 15 min from day one (~$31-38 per vendor per day). Claude: score
them on REPLAYED snapshots first (~$38 per vendor, once), live only if the replay shows they add value beyond the
deterministic mayor. **Taken: Claude's order** (same question answered for ~1/10 of the cost; the deterministic mayor
collects snapshots meanwhile). Both engines expect the frontier to add little while the bottlenecks are physical.

## v1 duties (the real bottlenecks, 10-02)
| Duty | Shortage | Eligible (executable from where the bot is) |
|---|---|---|
| FREE_BAG | est. slots >= 34 | junk it can dispose of (composter when it ships); never "deposit" into chests known full |
| GET_WOOD | **per bot** (amended 10-03): no usable pickaxe (none or <= 10%) AND its own wood cannot craft one -- the same arithmetic as RESTORE_PICK's `no_ingredients` (`mayor_core.pick_ingredients`). Was: world wood-equivalent < 2 x (bots without a pickaxe) + 1, which fired in 59 of 2,720 live snapshots because bots cannot share wood | that bot only; an observed log resource within 64 h / 10 v blocks, seen within 6 h; >= 3 free slots; not trapped in last 5 min |
| RESTORE_PICK | best pickaxe <= 10% or none | ingredients held (or a later verified retrieval); a table in reach or craftable |
| GET_IRON | iron held+banked short | stone+ pickaxe with trip uses; observed iron_ore within 96 blocks; room (orepack rule) |
No smelter / quartermaster / delivery duties yet: there is no chest ledger (missing bank contents are UNKNOWN, never 0).

## Deterministic rule
Hard executability filter (stale > 5 min, trapped, missing prerequisites excluded) -> rank by bottleneck relief (bag,
then pick prerequisites, then iron), distance, tool uses, free room, filler/idle rung first, stable tie-break -> caps
<= 2 per duty, <= 2-3 of 5 bots per world, no duplicate targets -> simulated lease (hold 10 min unless done/failed,
15 min cooldown after abandon). Every shortage nobody can staff is logged `unstaffed` with its reason.

## Data (verified in live rows)
World = `exp.pool` (isolated pools: strip the bot suffix). Per bot (latest row): name, pos, health, hunger, held,
dimension, code.version, timestamp (stale > 5 min), inventory, tools[{used,max}], last skills/outcomes, trap rows
(`_entombed`, `_marooned`), milestone from `_milestone_*` detail. Places ONLY from
`/var/lib/mcai/_pool-<pool>/world-facts-<pool>.json` resources (sightings, not reachability; capped at 200).
Slots are ESTIMATED from counts and stack sizes and labelled so.

## Frontier overseer (replay first)
Input: the snapshot with ids (bots, resources R1..Rn, candidate duties). Output, strict JSON: assignments by
candidate_id with reason + evidence ids + confidence, unmet_needs, or abstain. Validator rejects unknown ids, invented
places, broken caps; invalid rate is a metric. Temperature 0; both vendors on the same snapshots; half the calls see the
deterministic mayor's answer, half blind (measures anchoring); 10% re-asks (self-consistency).

## Scoring (it measures prediction, not effect)
Per proposal: executable now (re-checked); need persisted at 30/60 min (self-clearing shortages are false alarms);
CONCORDANCE (the bot did it anyway within 30 min = the mayor is redundant); UNFORCED GAP (not done, need persisted,
bot eligible: the only place a mayor can add value), in bot-hours per world-day; downstream success near the target vs
the fleet base rate. Baselines: random eligible bot, nearest bot, deterministic mayor. Every zero carries a positive
control on the same snapshots.

## When a duty may act (owner gate)
After >= 48 h: unforced gap >= 20 bot-h/day fleet-wide for that duty, executability >= 80%, downstream success >= 1.5x
base, and the duty's refusal chain tested (a refused duty hands back a legal move). Then ONE duty in ONE world as a
correctness canary; effect needs >= 4 worlds, world-level DiD. A frontier-DIRECTED duty also needs frontier > deterministic
beyond its own run-to-run disagreement and < 2% invalid output; otherwise the frontier's job is auditor.
**Decision date: 72 h after the shadow starts — record KEEP-BUILDING or STOP (no open loop).**

## Not built
In-bot mayor, SQLite leases, permanent jobs, chest ledger/quartermaster before withdraw works, prompt "advice",
a frontier call per bot, live frontier calls before the replay result, new telemetry fields.
