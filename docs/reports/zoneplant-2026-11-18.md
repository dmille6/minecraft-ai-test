# zoneplant-01show: nothing is planted or placed in a protected zone (2026-11-18)

## The trip
S4 BREACH on village-taiga-6_1 at 15:13:54Z, all 13 bots stopped. Alpha (b6b83327), marooned at 123,68,-6 inside the
village, had its survival pillar refused (a baseline cell, `struct=1`). At 13:19:51 the plant work order found 121,67,-8 and
placed a spruce_sapling there. Alpha's `_protect_zone` row for 13:19:27-13:20:27 reads `place=2 survival_allowed=5`
(every other row from 13:10 to 13:28 reads 0/0): the sapling went through the guard as a **survival** placement.
The reason is `digPurpose`: while a reflex holds the body, any call, a skill's included, is `survival`, and the zone
let `dig`, `place` and `use` through for survival. The tree grew at 13:59; its leaves over 120..122,68,-6 turned the
dirt_path under them to dirt, and S4 counted 4 cells removed.

## The fix
1. **The planner.** `plantableSpotNear` skips any cell in a zone's box grown by `GROWTH_MARGIN = 8` on x and z (zones run
   bedrock to sky, so only sideways reach counts). Why 8: a spruce's leaves reach 2-3 from the trunk. A 2x2 tree (big
   spruce, dark oak, mega jungle) grows from the sapling's corner, so trunk +1 plus a canopy radius of about 4-5. An acacia
   leans up to about 4, then adds a canopy of 2-3 (about 6). A cherry branches out about 4, then adds a canopy of about 4
   (about 8). The 2x2 depends on saplings beside this one that the planter does not control, so one bound covers every
   kind: the widest. The cost is a ring of 8 blocks around the village with no planting.
2. **The guard.** `place` is removed from `SURVIVAL_OPS`. A placement inside a zone is refused **whatever its purpose**.
   That covers saplings, seeds and pillar blocks. A survival `use` passes only with a hand that cannot change the block:
   empty, a pickaxe, a sword or a stick (`USE_SAFE_HELD`). With bone meal, a sapling, seeds, a block, a hoe, a shovel, an axe, a
   bucket or flint in hand, use-item-on places or converts, so it is refused.
   The refusal's remedy names a `goto` 4 blocks past the nearest side (`zoneRemedy`, unchanged).
   The deep exemption is unchanged: a bot already under `floor_y` may still place below it.
   **Air first** (Claude review r1): a survival placement inside the zone still passes **while the bot needs air**, meaning
   oxygen below 20 or water in its feet or head cell (`needsAir`). It never passes for anything that grows (`GROWS`:
   saplings, seeds, propagules, bone meal, crops, vines and so on). That keeps the drowning air pocket and a wet plug.
   **The walk-out's bridge** (Codex review r1): `zoneWalkTry` runs its bridge placement inside `zoneEscapePlace`, an
   AsyncLocalStorage mark. A survival placement made under that mark passes, and only for ordinary ground (never anything that
   grows). The flood escape's plug (`plugFaces`, Codex review r2) carries the same mark. A skill that merely runs while a reflex holds the body (the 11-18 sapling) carries no mark and stays refused.
3. **The chain** (test/zoneplant.test.mjs). A bot marooned in the zone with a sapling in hand:
   - The place is refused, and the remedy's goto ends outside the box.
   - A survival dig still passes, so the marooned ramp and the air stay open.
   - An empty-handed use (a door) still passes.
   - The planner never offers the spot.
   - Three anchored mutants are killed: `place` back in SURVIVAL_OPS, no held-item check, and no planner check.

**What this costs the escape (to-do item 7, not solved here): nothing the reflexes had.** Review rounds 1-3 each found
one more of the reflexes' own placements: the air pocket, the walk-out's bridge, the flood plug and the side-exit seal. So
the rule is drawn at the code, not at the purpose. **Every placement made by reflex.mjs or airpocket.mjs runs inside
`zoneEscapePlace`.** That covers the pillar, the step, the fill, the seal, the plug, the bridge and the air pocket. The ladder (ladder.mjs) and the lava mover's seal (lavastepmove.mjs) are marked too. **Any placement made inside the reflex tick** passes the same way (Claude r4/r5). The tick runs in `digScoped({ purpose: 'survival', by: 'reflex' })`, and everything its handlers await inherits that scope, so the ride-down in skills.mjs counts as well (`reflexTickScope`). A skill's own chain never carries that scope. The 11-18 sapling's survival purpose came from the holder, not from the tick. A
survival placement under that mark passes inside a zone, but never of a thing that grows, never on a baseline cell and
never over a path. `test/zoneplant.test.mjs` asserts that no placement call in those two files is unmarked, with a
mutant. What is refused is any placement by any other code: a skill, a work order, the planner, the pathfinder. That holds
even while a reflex holds the body, which is the 11-18 hole. This is narrower than "any placement whatever the purpose".
The difference is deliberate: refusing the reflexes' own blocks would have made new dead ends (drowning, flooded pockets,
gaps) that item 7 has not yet replaced.

**The packet** (Codex reviews r4 and r5): mineflayer's `_genericPlace` and `activateBlock` await a look after the guard
has judged them, and a skill can equip something else in that gap. So `bot._client.write` is wrapped as the last word.
A `block_place` (a placement or a use-item-on) at or onto a zone cell is sent only in two cases:
- the hand holds something that cannot change the block (`useHeldSafe`), or
- the escape's own code sends it (marked, the reflex tick, or a survival bot that needs air) holding something that does
  not grow.

Anything else is dropped. A click on a block that always opens (a chest, a barrel, a furnace, a wooden door, trapdoor or gate; never an iron door, Codex r7) judges only that block's cell, not the cell its face points to (Claude r6), so a chest just outside a zone still opens with a block in hand. That holds only while the bot is not sneaking (Codex r6), because a sneaking click places the block.

## Every op the zone rule judges (the `_protect_zone` row's counters)
| op | wrapped call | inside a zone, today (after this change) |
|---|---|---|
| dig | `bot.dig` | refused. Survival passes, except on a baseline cell or its support (S_CELL/S_SUPPORT). |
| place | `bot._genericPlace` (placeBlock, placeEntity) | **refused for every purpose**, with three exceptions. A survival placement passes while the bot needs air, or when a reflex's own escape code makes it (`zoneEscapePlace`); neither ever places a thing that grows. Below `floor_y`, a deep bot passes. Neither exception reaches a baseline cell or a path's cover. |
| use | `bot.activateBlock` | refused. Survival passes **only with an empty hand, a pickaxe, a sword or a stick**. A use inside an approved open, sleep or craft passes. |
| open | `bot.openBlock` | refused, survival included |
| sleep | `bot.sleep` | refused, survival included |
| craft | `bot.craft` with a table | refused, survival included |
| pour | `bot.activateItem` with a liquid in hand | refused when the traced flow could reach a baseline cell (liquid_refused) |
| find | `bot.findBlocks` | never returns a zone cell (find_filtered) |
| pathfinder | exclusionAreasBreak/Place | cost 100 inside (no dig, no scaffold). Walking is free. |
| mine | zoneKeepOut | no stair through a zone (mine_refused / mine_step_refused / mine_walkout) |
| bucket skill | bucket.mjs | no scoop or pour within 6 of a zone (bucket_refused) |

**Why `use` stays allowed for survival (narrowed).** A reflex inside a village must still be able to open a door or a
trapdoor to get out. With an empty hand that changes only the block's open state, which is not a breach. With anything
else in hand, the same packet places or converts.

**Raw `block_place` packets** skip the wrapper. Both senders check first: `bridgeio.mjs` (aimed designed steps) runs
`placeBlocked`, and `buildbot.mjs` runs `cellZone` (zonesite-01show).

**Other ways a zone can change** that no wrapper sees:
- A tree planted **outside** that grows in. This change closes that with GROWTH_MARGIN, for bot plantings only.
- Natural saplings dropping from leaf decay inside the village. Paper does this, not the bots.
- Liquid flow from a pour farther than the traced reach.
- Mob griefing (creepers, endermen; mobGriefing is on).
- Fire spread.
- A bot's drop onto farmland (trampling; the walk prices farmland out, the guard cannot refuse it).
- Falling sand or gravel after a legal dig below.
- Entity interactions (`activateEntity`, attacking villagers): not block changes and not guarded.

## Tripwire selftest
`infra/showcase/showcase_trip.py selftest` (the tripwire lives in infra/showcase/, not scripts/) gains a planted-growth
line. A dirt_path under new leaves reads REMOVED (a breach), while the tree's own log and leaves over air read ADDED only.
