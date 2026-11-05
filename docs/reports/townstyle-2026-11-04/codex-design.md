# Codex independent design (codex exec, read-only, 2026-11-04; prompt: /private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/townstyle/codex-design-prompt.md reproduced in the design doc's section 3)

**Start with a timber cottage: a genuine pitched roof, one-block eaves, framed windows, and a small porch.** Build a reusable style library around that proven example.

Code inspection confirms the state-handling gap in `buildsite.mjs`, `buildrun.mjs`, `buildbot.mjs`, and `shopconform.py`. One correction: the quoted dimensions include the pad; house walls/roof occupy 5×5 inside its 7×7 pad. Yards have no roofs. No files were changed.

**1. Style vocabulary**

Use a coherent timber-and-stone town palette:

- **House:** front gable, plank infill, vertical corner posts, contrasting stone foundation, framed windows, slab sills, small entrance canopy.
- **Workshop:** longer gable, broad work-door awning, cobblestone chimney.
- **Copper hall:** monumental longitudinal gable initially; preserve copper accents. A hipped roof is a later variant.
- **Storage hall:** long barn roof, repeated window bays, restrained entrance canopy.
- **Enchanting workshop:** gable with one decorative dormer later.
- **Storehouse:** compact gable preserving container access.
- **Yards:** remain open; later add freestanding market awnings. Well, tower, shrine, and wall retain module-specific silhouettes.

Use bottom stairs for slopes, slabs for ridge caps, filled triangular gable ends, and one-block eaves. Begin with torches; hanging lanterns require a separately proven actuator. Chimneys are unlit masonry initially.

Seed choices from `(world, town, building-key, style-version)`. Choose among validated combinations of roof direction, wood species, framing rhythm, porch side, and accent placement. Persist the resolved design and palette in the record; repairs never reroll. Variety must preserve entrances, workstations, paths, and reserved space.

**2. State-bearing records**

Example local cell:

```json
{"u":0,"v":2,"y":3,"role":"roof-stair","seg":"roof-low",
 "state":{"facing":"+u","half":"bottom","waterlogged":false},
 "derived":{"shape":"straight"},"closesInterior":true}
```

Rotate directions through the existing `townplan.rot`, whose identity orientation is **E**. Rotate horizontal log axes similarly; vertical axes, halves, and slab types remain unchanged. Rotation preserves stair left/right handedness. Compile final neighbour-dependent shapes separately.

Carry these fields through `placeBlueprint`, `proveSite`, records, intents, and visits: currently the proof rebuilds cells and would drop new metadata.

Read canonical block properties plus name and collision shapes. Completion requires the permitted name **and every specified property**. Validate derived stair shapes after their neighbourhood is complete. Missing observations remain unknown.

A wrong-state block is incomplete, but cannot simply receive another placement: repair must authorize its removal, confirm air, and replace it. Never “repair” a slab by doubling it accidentally.

Log project, record generation/hash, cell, operation, desired/resolved name and properties, observed properties, support, face, cursor, yaw/pitch, sequence, connection, and outcome. An acknowledgement alone is not success.

**3. Orientation actuator**

Extend `stepFor` to solve **stand + actual hit point + look + resulting state**, rather than selecting the nearest face centre.

| State | Placement constraint |
|---|---|
| Stair facing | Stand/look toward the required horizontal direction, safely inside its quadrant; aim at a valid support hit point. |
| Bottom stair/slab | Click UP, or a side below midpoint, e.g. cursor Y=0.25. |
| Top stair/slab | Click DOWN, or a side above midpoint, e.g. Y=0.75. |
| Log axis | Click a face normal parallel to the requested axis. |
| Closed trapdoor | Solve side face, half, and facing together; verify `open=false`. |
| Hanging lantern | Click a valid underside; requires adding above-support candidates. |

Yaw and sight line must be jointly feasible; setting arbitrary yaw after aiming is insufficient.

Stop movement and competing look controllers. Equip, aim, then await an **outgoing rotation-bearing movement packet** containing the intended rotation. `await lookAt(..., true)` currently returns before that transmission; a fixed 50 ms sleep is insufficient.

After barrier waits, repeat the pose proof and rotation wait. Recheck position, hand, support, target, ownership, and generation; retain synchronous fence-to-send. Await sequence acknowledgement **and server block-state evidence**, then neighbourhood settling.

Refuse unknown geometry, obstructed rays, unreachable stands, interactive supports, occupied targets, unintended waterlogging, incompatible states, or unresolved look interference.

Before shipping, test Paper 1.21.8 with Mineflayer 4.37.1 in survival: every rotation, both halves, relevant support faces, stair neighbours/corners, overhangs, full roofs, interrupted visits, wrong-state repairs, reconnects, delayed ticks, and concurrent bots. Include stale-yaw, wrong-cursor, missing-support, and changed-generation negative controls.

Require exact settled states, zero unauthorized mutations, no trapped bots, and successful restart/repair runs. Use repeated trials per actuator case and independent region-file inspection. RCON may prepare sandbox scenes only.

**4. Build order and supports**

Stairs need a clickable neighbour **during placement**, not permanent gravity support. Full-block wall tops, beams, gable infill, or verified exposed faces of existing stairs can serve. A stair’s nominal cube is not proof of a usable face.

Build foundation → walls/frame → gable infill/support beams → successive slope courses → ridge → decoration. Extend the planner’s overlay and ray tests to real stair/slab collision geometry.

Record temporary exterior staging blocks and their removal operations. Prove placement **and dismantling** before starting. Reserve the overhang, staging footprint, headroom, and escape route.

Replace `CLOSER_SEGS`’ two-name whitelist with explicit closure metadata. Every roof course over the interior participates in the existing barrier protocol. Builders need reachable exterior stands; never assume they can stand underneath a low eave or walk on an unfinished slope.

**5. Materials**

For a concrete baseline, extend each existing roof one block on every side, use 45° gables, and run the ridge along the longer dimension.

Counts below include filled gables and a full-block ridge beam. Logs are **roof-only**, rounded through crafting batches: six planks → four stairs; three → six slabs; one log → four planks.

| Building | Roof footprint | Stairs | Ridge slabs | Gable + beam planks | Logs |
|---|---:|---:|---:|---:|---:|
| House | 7×7 | 42 | 7 | 25 | 25 |
| Workshop | 9×7 | 54 | 9 | 27 | 30 |
| Copper hall | 15×13 | 180 | 15 | 87 | 92 |
| Storage hall | 19×11 | 190 | 19 | 69 | 93 |
| Enchanting workshop | 17×11 | 170 | 17 | 67 | 84 |
| Storehouse | 9×9 | 72 | 9 | 41 | 39 |

These six roofs consume approximately **363 logs** before framing, porches, staging, or furniture. Therefore 400 logs do not justify a town-wide batch.

For new construction, retained masonry excluding old roof trim is 72/89/275/311/281 blocks respectively for house/workshop/hall/storage/enchanting. Those five total 1,028: substantial against 930 cobble + 340 stone bricks, with palette restrictions still applying. Existing buildings retain their masonry.

Generate the complete cell-level bill, including decorations and temporary works, before admission. Reserve materials centrally across 15 bots; credit salvaged roofing only after collection.

**6. Tripwire and retrofit**

Deploy readers before writers. G1/G2—surfaced as H1/H2 in S6—must validate operation-specific authorization against the generation in force when the mutation occurred.

State-bearing records need immutable palette resolution, desired properties, derived-state expectations, explicit repair permissions, and temporary-cell lifecycles. Preserve historical generations; a newer record cannot retroactively authorize an earlier action.

H8 must decode NBT properties, report state mismatches, and cover every styled project. Keep existing legacy scoring, but require **zero specified-state mismatches** for styled completion; the current 0.98 name-based F1 can conceal reversed stairs.

For storehouse, house1, copper hall, and storage hall:

1. Survey actual roofs, contents, doors, lights, and access clearances.
2. Publish a linked generation containing retained cells, the new roof, staging, and an exact old-roof clear list with expected preimages.
3. Fence old-generation builders; evacuate the work envelope.
4. Remove only listed roof cells, confirming each removal; build and dismantle staging.
5. Complete only after state and access surveys pass.

Clearing must be resumable and distinguish old roofing from newly placed replacements. Never reuse the current name-only clear test where it could erase completed work.

Accept authorized retrofit clears and replacement placements without suppressing unrelated defects. Reset completion evidence for the new generation; require fresh matching surveys.

**7. Rollout and limits**

First shippable release: **small style library plus `house@2`**, with one pitched roof, simple framing, proven staging, and state-aware repair/conformance.

Next: workshop and storage variants; then one occupied-building retrofit at a time; finally hips, dormers, trapdoors, and hanging lanterns.

Principal risks are rotation timing, partial-block collision modelling, staging reachability, concurrent closures, and destructive replay of retrofit clears.

Do not ship cosmetic JSON alone, random per-cell wood mixes, blanket tripwire exemptions, mass retrofits, or real-world administrative edits.
tokens used
