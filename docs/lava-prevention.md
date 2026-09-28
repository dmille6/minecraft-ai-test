# Lava prevention — v2 (pass 1 folded in: corridor, swept footprint, verified retreat, work-position exception)

## The three guards, revised
1. **Corridor guard for walk legs** (explore, relocation walks, goto legs started by our code): sample the straight
   line from the feet to the target every 1.0 block. At each sample the landing must be SUPPORTED (a solid block
   within 3 below the sample's feet cell, none of the cells between being lava) and LAVA-SAFE (no lava within 1
   block horizontally at feet level, none within 3 below). An UNKNOWN cell (unloaded) is unsafe. Any failing sample
   refuses the leg with `lava_corridor` at the sample's coordinates; explore re-picks a bearing (it already does
   on refusal). Pure: `corridorSafe(blockAt, from, to) -> { safe, at, why }`. Cost: ~30 blockAt reads per leg.
2. **Water hold, swept footprint**: before setting `forward` toward the air target, check the footprint the bot
   will sweep: feet-level cells at +1 and +2 along the push direction with lateral offsets -1, 0, +1 (six cells) and
   the cell below each (drift in water stops within ~1 block, so +2 covers it). Any lava -> `holdForwardSafe` is
   false: the hold EXPLICITLY sets forward=false (not merely refrains), keeps jump, and logs `hold_lava_ahead` once
   per 10 s. Pure: `holdForwardSafe(blockAt, feet, dir) -> { safe, cell }`.
3. **Stand-off with a verified retreat**: fires only when no skill runs, no body claim or grant is held, no dig or
   place happened in the last 20 s (the miner beside a lava lake keeps its position), and lava lies within 1 block
   horizontally of the feet or directly under the ledge the feet stand on. It picks the retreat cell among the four
   horizontal neighbours that is passable (feet and head), supported (solid directly below) and itself lava-safe by
   rule 1's test; if none exists it does nothing and logs `lava_adjacent_no_retreat`. The step uses POSITION
   FEEDBACK: forward toward the cell until the feet cell changes or 1.5 s, then forward=false; once per 10 s.
   Pure: `lavaStandOff(blockAt, feet) -> { move: [dx, dz] | null, why }`.

## Stranding, answered
A bot legitimately beside lava is never moved while working (rule 3's exceptions) and never refused a leg whose
corridor is safe; the corridor guard refuses only legs that cross unsupported or lava-adjacent cells. A bot that
stands on a one-block island in lava has no safe retreat and is left alone (logged), which is the honest outcome.

## Proof
Sandbox fixtures: ledge-over-lava (walk leg across a 3-wide lava gap with a ledge), lava-edge water (floating next
to lava with the air target across it), lava-adjacent idle (standing one block from lava with a safe cell behind).
Control = promoted code; outcome = deaths and the new rows. Fleet: one two-pool canary under rule v12.

## Question for the reviewer (second and final pass)
Are the revised guards sound? Name at most three defects with a one-line remedy each.

## v3 — the final pass's three defects, folded in (design closed at two passes; build tomorrow, sandbox first)
1. **Validate the executed route, not a straight line.** The guard runs on the pathfinder's own `path_update`
   nodes: for every consecutive node pair, the swept footprint (the 3x3 feet-level cells around the segment,
   sampled every 0.5 block, and the cells 1-3 below each) must be known, supported and lava-free; a failing segment
   refuses the leg before the first step and again on every `path_update` (replan). Explore's blind step after a
   failed leg gets the same check on its one-block target.
2. **The water hold rejects UNKNOWN cells and sweeps the body**: the check covers the 3-wide body through +3 cells
   along the push direction (a conservative stopping distance for water drift), feet level and one below; any lava
   OR unknown cell refuses and forward is explicitly cleared.
3. **The retreat is validated as a sweep and ends inside the destination**: the swept 3-wide footprint from the
   current cell to the retreat cell must be supported and lava-free; the step ends when the body centre is within
   0.3 block of the destination cell's centre (not at the first cell change), or after 1.5 s, and forward is then
   cleared; if the sweep fails, no move (logged).
