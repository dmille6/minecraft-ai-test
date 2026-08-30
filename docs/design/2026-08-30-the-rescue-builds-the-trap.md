# The escape reflex is what builds the trap

**Status:** finding + first fix, 2026-08-30. Guards built and tested, NOT deployed.

37.5% of the fleet is permanently immobile and the rate has tripled in four days
with no reversal at any sample point. The cause is not terrain. It is our own
rescue.

## The machine

Full walk, 84 files, 6,262,866 records, 12-hour window:

- **23 of 26** permanently-stuck bots emitted a `_marooned` / `_entombed` /
  `_trapped_in_canopy` event **within fifteen minutes of going still**
- **20 of 26 GAINED ALTITUDE at onset**

The sequence is identical every time. The bot cannot travel → the marooned
reflex seizes the body and pillars up → it runs out of material partway → it is
sealed in the column it just dug, higher than it started, holding nothing.

`board-a-Echo`, now stuck 92 hours with an empty inventory, climbing y=30→54 in
four minutes:

```
goto failed/stranded    "empty path from 395,12,187 — no route out of here
                         even with digging allowed"
_entombed               "walled in at y=37"
surface failed          "climbed 7 blocks to y=50, still 13 below sea level —
                         this stone needs a pickaxe"
_inventory_mutation     "cause=entombed_escape  wooden_pickaxe -1"   <- last tool
_marooned_needs_pickaxe "column above is capped by stone, no usable tool"
_entombed               "walled in at y=54"
```

`board-c-Delta` is the same machine run to the ceiling: y=77→221 in five
minutes, spending 85 oak_log to `cause=maroon_escape`, ending at
`_marooned_stranded_high` y=221 holding 11 items and no scaffold.

**Fleet-wide cost of the rescue machinery:** 32,162 marooned climbs, 44,224
escape-attributed inventory mutations, 68,457 oak_log, 35,580 sand, 34,932
cobblestone, 22,471 dirt — and **434 pickaxes destroyed across 574 events.**

It spends the exit in order to escape, and then cannot escape.

## Why they cannot recover afterwards

**Entrapment is total, not partial.** In 12 hours the 26 stuck bots made 10,278
world-affecting attempts — `gather` 4,368, `goto` 2,562, `surface` 1,254,
`place` 818, `swim_to` 348, `mine` 61 — with **zero successes in every verb**.
Treated as a suspect zero and re-run with the other 58 bots as a known-positive
control on the same code path in the same window: `goto` 3,440/6,687, `explore`
5,941/8,777, `mine` 1,679/2,851. The zero is real.

**Self-sourcing cannot work bare-handed.** `harvestAdjacent` succeeds
131/21,675 = **0.60%**. The detail reads "self-sourcing failed (0/8 dug)" —
eight adjacent placeable blocks found, none breakable, because the walls are
stone and **24 of 26 stuck bots hold zero pickaxes**.

**The verb that would free them is never chosen for that.** 96.2% of all 6,771
`place` calls fleet-wide are `place crafting_table`, succeeding 11.4%.
Scaffold-class placements are 3.5% of calls and succeed **95.3%** (gravel
205/206). Among the stuck 26, **all 818 `place` calls were crafting tables**.
`hive-c-Delta` carries 41 scaffold against a requirement of 24 — it can pillar
out right now — and has made 190 crafting-table placements and zero cobblestone
placements.

## The fix in this commit: stop manufacturing traps

Neither guard rescues anybody. They stop the rescue from converting a bad state
into an unrecoverable one.

**`canFinishClimb()` — a climb you cannot finish is worse than no climb.** It
costs the material AND raises the bot further from the ground it needs. The
climb is now all-or-nothing: refusing to start leaves the bot where it was,
holding its blocks, which is recoverable. One spare block is required because
the top placement often mistimes against the jump. Running out mid-climb no
longer falls through to digging up — it stops and logs
`maroon_climb_exhausted`.

**`mayDigForEscape()` — the last pickaxe is not spendable.** Breaking it ends
every future escape the bot could make, and drops it straight into the 0.6%
self-sourcing case. A tool with one swing left counts as already gone, because
durability metadata lags a tick. Unknown durability counts as FULL, not spent —
assuming otherwise would refuse every escape on a server that does not report
durability, which is a different total outage arriving through the safety guard.

The `PLACEABLE` regex also gained `sandstone`, `red_sandstone`,
`dripstone_block`, `tuff`, `netherrack`, `coarse_dirt`, `rooted_dirt` — blocks
`RESCUE_BLOCK` already accepts. Two stuck bots carry 40 sandstone each and are
being told "no placeable blocks".

## What this does NOT fix

The 26 already-stuck bots. They cannot self-recover and nothing here reaches
them. Escape probability collapses with duration — 98.3% at 1–2h, 92.9% at
2–6h, 86.5% at 6–12h, **43.6% beyond 12h** — and of 227 escapes from episodes
≥2h, **120 were restarts** from the 6-hourly `fleet-recycle`, 30 were deaths,
and only 76 were genuine in-place recoveries.

That last number is the one worth sitting with. The survey of prior art
independently recommended **uniform periodic reset** as the only recovery that
is arm-neutral by construction — and the fleet's existing recycle is already the
dominant escape mechanism. It is simply clearing traps slower than this reflex
manufactures them.

## Still open

- **`placebo-b-Bravo` is misdiagnosed by its own reflex.** At y=106 — 43 blocks
  ABOVE sea level — it has emitted `_marooned_needs_scaffold` 349 times in 12h,
  told to gather blocks to climb while `canContinueDescent` computes its debt as
  0. `CLIMB_CEILING = 200` gates `stranded_high`. Stuck 131.8 hours.
- **`rideFloorDown` cannot descend a pillar.** 117 calls across the three
  highest bots, every one returning "descended 0 blocks from y=221 using 0
  placed block(s) — stopped: solid below". It is standing on the pillar it
  built, which is the one case that routine refuses.
- **The pickaxe deadlock is closed-form:** `surface` says "this stone needs a
  pickaxe: gather wood, craft a pickaxe, then run surface again"; `craft` says
  "gather oak_log first … you are 12 blocks below sea level; wood only exists
  above ground, so run surface first". The goal layer adopts the prerequisite 92
  times and abandons it 42 times at "had 0/1 after 920s".
- **Pickaxe durability is absent from telemetry entirely** — inventory is
  `{name: count}`. `pickaxeUses()` at onset is unmeasurable from the logs.
