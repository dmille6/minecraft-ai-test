# escdead-01show: an escape from under a protected zone leaves by a non-zone route, 2026-11-07

Coordinator 11-07 (after escdead-01 read KEEP on the fleet): showcase-Alpha (05:39Z) and showcase-Nova (11-06, twice) touched
village-taiga-6_1 while escaping; a second Alpha breach = quarantine. Build on the live showcase line (d8dbd32a,
showcase-batch20-on-af3b9a8b) so an escape under a zone never digs zone blocks: route around/down, leave a move the bot can do,
say plainly where no exit exists. PROTECTED scope (reflex.mjs; escapeguard.mjs): two engines + Paper. Stops at ready to stage.

## 1. What happened (CoreProtect + rows; 6_1 box x 49..157, y -64..90, z -59..45, floor_y 54)

- **Nova 11-06 15:00-16:06Z**: entombed at 70,36,-9 (deep), the marooned/entombed climbs pillared up a natural shaft through
  ordinary rock (`_escape_guard ordinary=N`) to y 70, under a house's spruce_planks floor at 79,72,-10. Every ramp bearing
  refused (planks/logs), `needs_rescue` at 2 min, the LAST RESORT opened at 10 min: 79,72,-10 plank (15:18Z), later
  80,77,-8 log. Owner repairs + quarantine. The cause is not one bad dig: correct rungs composed into a climb INTO the village.
- **Alpha 11-07 05:37-05:39Z** (CoreProtect, every Alpha block change in the box, 00:07Z..08:27Z): 24 breaks + 5 places, ALL
  deep (y 12-34): dirt, andesite, clay, 2 rails and 3 oak_planks at 55,18..20,29 -- an abandoned mineshaft under the village.
  The zone's deep exemption let them through (legal by the zone file: the tripwire reported "S3 DEEP below a village floor
  (legal ground)"). Alpha then left the box at x 46-48 and surfaced outside it.
- Other bots in the box today: Echo 28 / Maple 184 / Onyx 17 deep changes; Onyx 16 breaks ABOVE the floor at 56,54..59,14 --
  natural stone, a pillar escape (ordinary). No village structure block was touched today.

## 2. The change (ZONEWALK=off restores the base)

1. **A structure block is the zone's at every depth** (escapeguard `zoneStructureAt`, asked before records): above the floor,
   every non-ordinary block (as before); below the floor, every non-ordinary block except an allow-list of natural cave blocks
   and the bots' own pillar blocks (cobblestone, cobbled deepslate, sculk, dripstone, amethyst, obsidian, lichen, roots, cave
   plants). Mineshaft planks and rails, copper, bars, bricks are guarded deep too. Deep ordinary rock stays open.
2. **The last resort never digs a zone's structure** (escapeDigDecision); a build record keeps its last resort; AIR FIRST
   unchanged (suffocating/drowning: anything).
3. **The climb gate** (zonewalk `zoneColumnHit`): inside a zone's box, a pillar climb whose OWN column holds a structure block
   up to the box top is refused before it starts AND at every step of the climb (pillarOut's `alive`) -> ESCAPE_GUARDED.
4. **The walk-out** (zonewalk `zoneWalkOut`, guardBranch's first move; and the marooned non-climb states' first move, Gale's
   need_pickaxe): from above a VILLAGE's floor, down through ordinary rock; then a straight 2-high tunnel through ordinary rock
   to the nearest footprint side, then the next. A bearing ends at a structure block, any liquid or lava on a face, a block
   standing on/hanging from the cut (rail, torch, door ...), a falling block over the head, a missing floor it cannot bridge
   with an ORDINARY block (verified in the hand). Re-read after every dig; ownership checked after every await. Progress =
   nearer the side than the best this episode reached (carried across firings). Rows: `_zone_climb_refused`, `_zone_walk`.
5. **The case with no exit, said plainly**: a bot sealed on four sides and below by structure blocks, liquid or lava inside a
   zone -- e.g. already inside a closed house -- has no move that does not touch the village. It holds a dry cell, writes
   `_zone_walk outcome=no_exit` + `needs_rescue`, the guard's wait runs on without a zone last resort, and the showcase
   quarantines it (owner rule). The gate is what keeps bots out of that case: they no longer climb into villages.

Not in this piece: the showcase line has NO swimunder/escdead-01 wide swim or breach (the showcase is 8 fleet KEEPs behind;
codeeval phase 3 item 4), so the "dead-end breaker" here is the walk-out. Gale's own tool trap (a 1-use iron pickaxe under an
andesite cap) is handcap-01's (showcase variant built, ready to stage): after the walk-out Gale is out of the zone and still
asks for a pickaxe. Prevention of falls into caves under villages (expedition detours) is unchanged.

## 3. Paper (sandbox5/7/8, failmine scene driver, the 6_1 zone file installed translated: FM_ZONES)

| scene | build | outcome |
|---|---|---|
| Nova shape in the real 6_1 box (synthetic cells: a shaft 79,36..71,-10 under a spruce_planks floor at y 72) | base d8dbd32a, 16 min | pillared to y 70, 8 guard refusals, `needs_rescue` 2 min, **last resort 10 min: dug spruce_planks 79,72,-10** (= the 11-06 breach) |
| same | cand 1f4399ac x2 | gate at y 36, **walk-out west 31 cells, 62 digs all ordinary, out at x 48**, held 23.9 s, hp 20, no plank/log gained |
| same (oracle: >= 30 out or 40 up) | cand ff8a969f x1 | (final sha; see the commit) |
| Gale, real cut of the 06:41Z snapshot (64,58,38: shaft, stone cap, village spruce above) | base d8dbd32a, 12 min | stayed; `_marooned_needs_pickaxe` x6 |
| same | cand 1f4399ac x2 | gate (spruce leaves @72), **walk-out south 8 cells, out of the footprint at z 46**, then `_marooned_needs_pickaxe` (andesite cap, 1-use pickaxe): handcap's trap, outside the zone |

## 4. Reviews

Codex r1: 7 blockers (bridge material, record overlap, water faces, falling blocks, sealed-corridor progress, 48-cell scan,
ownership mid-step), all fixed with tests; r2: 5 fixed, 2 partly + 1 new (deep palette missed copper/bars) -> r3 fixes.
Claude independent (claude -p) r1: 1 blocker (attached blocks on a cut) fixed; notes taken (deep allow-list, village-only
down step, hook before need_scaffold). Tests: `bots/test/zonewalk.test.mjs` 20/20 incl. 5 anchored mutants; escapeguard
re-anchored (the deep plank case is now the zone's under ZONEWALK on, the base under off).

## 5. Tripwire

No shopread / showcase_trip rule needed: no new `_build` kind or record; the walk-out digs only ordinary rock (the same class
escapeguard's `ordinary` survival digs already produce). New rows: `_zone_climb_refused`, `_zone_walk`, `_needs_rescue
arm=zone_walk` (a needs_rescue row the tripwire's Z1 already reads).

## 6. escdead-02show (11-07, on showcase-batch21a c35b5675): the gate stops at a side exit -- Codex fold blocker with handcap-01show

**Blocker** (Codex, fold of escdead-01show + handcap-01show 116f5350): handcap turns Gale's "need a pickaxe" into a climb; the
gate scanned the column to the box top (y 90), so a roof far above the cap refused a climb whose cap break would reach a side
exit. **Fix** (zonewalk `zoneColumnHit`): walk up the bot's own column; at each level a structure block refuses FIRST; the scan
stops (climb allowed) at the first level with a walkable side exit -- a neighbour with open feet + head over a solid dry floor
that LEADS somewhere (`exitLeads`: a bounded walk reaching out of the footprint or open sky; a sealed alcove or a sealed cave of
any size is not an exit). Never past a structure block. Tests: zonewalk 27/27 incl. the composed chain (handcap's answer ->
maroonState 'climb' -> the gate admits it to the cave) and anchored mutants (no side-exit stop; the exit asked before the
structure test; no exitLeads).

**Reviews**: Codex r1 1 blocker (a sealed alcove counted as an exit) -> exitLeads; r1 re-check 1 new (a sealed 8x6 cave reached
the 48-cell clause) -> out-of-footprint or sky only; r2 re-check: fixed, no new blocker. Claude independent r1: no blockers
(note taken: the duplicate step-up check removed); r1 re-check: fixed, no new blocker. **Suite** ci2 72cdf589: 460/461, the one
failure the line's known missing bagdiet.test.mjs.

**Paper** (sandbox5/7/8, Gale's real 06:41Z cut, a 1-use iron pickaxe, MAROON_HANDCAP=on, both arms carry handcap-01show):

| scene | before = c35b5675 + handcap | after = escdead-02show + handcap |
|---|---|---|
| Gale real cut (village spruce at y 72 straight above; no side exit under it) | handcap climb -> gate refused (leaves @72) -> walk-out south 8 cells, out of the footprint at z 46 in ~2 min | the same (3 runs), and once a climb in the next column to open sky at 66,71,38 -- nothing dug but ordinary rock and ground |
| Gale cut + a synthetic cave at the cap's top running south past z 45, goal `goto 68,67,50` | refused -> tunnelled out at y 58 (escaped) | **the climb is admitted through the cap to the cave level (y 67), stops there (`pillar_out_step` at the exit level), and the goto walks out through the cave to 68,67,48** (3 runs) |

The fold blocker's "sits in the zone past 15 min" was not reproduced on Paper with c35b5675 + handcap in Gale's cut: the walk-out
took the bot out in ~2 min both before and after. With a reachable side exit the fix lets the climb use it instead of tunnelling.
**Tripwire Z1G** (main a032d241: 15 min in a zone box with `_needs_rescue` / `_zone_climb_refused` rows -> quarantine): a long
hand-dug walk-out (no pickaxe, ~50 cells of stone at 7.5 s a cell twice) can run past 15 min while still making progress
(`_zone_walk outcome=progress` rows) -- worth Z1G discounting a bot whose `_zone_walk` rows show progress.
