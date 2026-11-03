# expwater-01: expeditions cross narrow water (2026-11-03)

Owner decisions: 11-01 "water/boats/bridges OK" (supersedes the 10-27 no-water-bridging rule), 10-27 expeditions
(return home, breadcrumbs AND markers, reliability over speed), 11-03 "i agree to all those things, do it". This is
stage S1b of [`wholemap-expeditions-design-2026-11-01.md`](wholemap-expeditions-design-2026-11-01.md) (the swim leg),
measured again and narrowed by a Paper repro.

Code: branch `expwater-01-show-on-adbf9e41`, built on the live showcase release `adbf9e41`. Kill switch
`EXPEDITION_SWIM=off`. An operator can narrow the width with `EXPEDITION_SWIM=8`.

## 1. What was measured (showcase, 11-03, release adbf9e41)

**The trips.** The current planner made 35 trips in 24 h and hauled 0 items. In the last 6 h, `build_shop` returned
"every bearing is blocked by water or a zone for today" 12 times.

**Why every bearing was blocked.** The dead-bearing set was replayed from the town's trip log:

| when | blocked by a refused walk under 40 blocks (the town exit) | blocked by water (two turns) | blocked by a refused walk at 112 |
|---|---|---|---|
| 12:10Z | 1, 4, 5, 6, 7 | 2 (164), 3 (273) | 0 |
| 15:40Z | 4, 6, 7 | 2 (164), 3 (273), 5 (150) | |

Water accounts for 2 or 3 of the 8 dead bearings. The near-town 'blocked' turns (the leg's goto moved less than 4
blocks, twice) account for 3 to 5.

**Why the haul is zero.** Of the 35 trips, the multi-call trips (every trip once the ring passes 225) skipped the
gather by construction. The spare time was `deadline - now - max(20 s, 1.2 x outTook)` with 0.6 of the call spent
going out, which is always negative. Of the 31 turn rows in 24 h, 29 show `rej=not_run`.

**The water itself.** The measure ran on a copy of the world: `townplan_blockdump.py` over the timelapse mirror, then
`bots/scripts/expwater-offline.mjs`, which uses `expedition.mjs` `surfaceAt` itself. It measured the crossing ahead of
each live water turn point, per direction within plus or minus 60 degrees:

| turn point | bearing | narrowest crossing | dry way round within 150 |
|---|---|---|---|
| -88,63,-121 | 5 | 1-2 (a stream) | yes, 57 steps |
| -8,65,172 | 2 | 10 at +60, 13-16 at +-35..55, 30 straight on | **no** |
| -210,63,175 | 3 | 1 at +20 (behind a bank 3 above the water) | yes, 83 steps |
| 36,68,-68 | 6/7 | 1-5 | yes |

The water surface is at y 62 everywhere, and most shores stand at 63, level with it.

## 2. The Paper repro (sandbox3, `sandbox/swim/swim.mjs`)

The driver is bare mineflayer-pathfinder with the bots' walk prices from `index.mjs` (liquidCost 2, +1 to enter water,
no parkour, no towers, no bridging, maxDropDown 6) and the bots' own `watermoves.mjs` `installShoreEgress`. The lake is
4 deep, inside a sealed stone shell, so there is no way round. Each crossing is retried once.

| shores | width | crossings arrived |
|---|---|---|
| level (stand = water block + 1) | 8 | **20/20** |
| level | 14 | **19/20** |
| level | 20 | **18/20** (the misses: 'No path' mid-lake after the bot sank about 1 block) |
| far shore one block up (stand = water + 2) | 20 | **0/10** exits planned |

There were 0 deaths and 0 damage in about 90 crossings. Without the shore egress, no exit plans at all (the earlier
runs).

## 3. Method chosen, and why

| water | method | why |
|---|---|---|
| **<= 16 wet columns, both shores level with the water** | **swim** (this piece) | The pathfinder already swims (water is terrain). Paper: 19/20 at 14. It opens the bearing-2 lake, which has no dry way round. |
| wider than 16, or a bank above the water | **turn**, logging `swim_wide:N` / the bank refusal | That log is the siting evidence for the next piece. |
| 17-32, at the busiest crossing | **bridge** (next piece, tier 3) | Codex and Claude agree. It uses surplus cobble, which is also a stone sink. A moving stand over water is unproven, so it needs Paper first. |
| open water > 32 | **boat** (S2, parked) | mineflayer sends no `vehicle_move`. The client simulates its own boat, so a bot in a boat goes nowhere without our own driver. `moveVehicle` sends only `player_input` on 1.21.3+ (mineflayer 4.37.1, `lib/plugins/entities.js`). Issue #3615 (rider position) is also open. |

**The reconcile.** Codex's independent design was given the measurements and the Paper result, not this code. It
proposed:

- swim at most 8 wide, with level shores only
- bridges for 9-32, and no boats yet
- the crossing as a gate on the way home
- legacy rows ignored
- the gather fixed

All of it was taken except the width. Offline, 8 opens 1 of the refused points where 16 opens more, and Paper at 14 was
19/20. So 16 stays, with `EXPEDITION_SWIM=8` as the narrower setting if live crossings strand (`op=cross dry=0`).

## 4. What changed (expedition.mjs pure, skills.mjs visit)

- **`lineClear(..., { swim })`** reads a swim line every block. It allows only water (kelp and seagrass count as
  water; lava and bubble columns never do). The water must not be a plunge below the bank. It allows at most `swim` wet
  columns in the leg. Each run's near bank and its far shore must be exactly the water block + 1, and the line must not
  end in the water. It returns the far shore's first dry column.
- **`swimLeg`** is tried only after every dry bend has failed. It searches the finer bends 0 to +-65 and takes the
  narrowest crossing. The target is `SHORE_INLAND` 3 past the far shore's first dry column, dry and standable. When the
  water starts more than 8 ahead, a dry leg to the near shore comes first, so the two shore crumbs are one swim apart.
- **Breadcrumbs and markers.** `crumbDue({ shore })` keeps both shores as crumbs. The far shore's index becomes a
  **gate**: `nextCrumb` never hops past a gate, and from a gate the next hop is its near shore. `heldGate` holds a dry
  bot to a crossing it has not swum back. It retries the crossing twice, then leaves the trail open for `home`. A wet bot
  may take any way out of the water. Markers are unchanged: they are placed by distance and are the fallback after the
  crumbs.
- **`deadBearings`.** A 'blocked' turn under 40 blocks blocks its bearing for 3 h, not the day. `PLANNER_V` is now 3,
  so the v2 planner's water turns no longer block.
- **`gatherSpare`.** A multi-call trip keeps 20 s for its way back in this call (its trail home finishes next call), so
  it gathers.
- **Rows.** `_expedition op=cross` (wet, bend, from, to, dry, moved). The turn and trip rows carry `cross=N`.
  `_expedition_mode` carries `swim=N`.

## 5. Offline result (the real planner, replayed from the live turn points)

The swim made no difference at the two points the dry planner already passes offline (-88,-121 and 36,-68). At the 6
points it refuses for water:

- **The 2 on bearing 2** (the lake at 164, where all 3 of today's bearing-2 water turns happened) now reach the 300
  ring: swim 16, then swim 11-12.
- **The other 4 stay refused.** Three show `swim_wide:17`: water 17 or more wide, or a bank 3 above the water. The fourth
  is a bank above the water. These are bridge candidates.
- An earlier count of "3 to 4 opened" read kelp as lake-bed ground. The kelp fix (Claude review r1) removed those false
  shores.

## 6. Reviews

| reviewer | round | verdict |
|---|---|---|
| Claude, independent, blockers only | r1 | BLOCK: kelp read as ground, so a swim could aim at the sea floor. Fixed. |
| Codex, blockers only | r1 | BLOCK: a range-2 arrival could stop the bot wet; a failed gate hop fell through to a direct walk across unchecked water. Both fixed. |
| both | r2 | Re-check only: see the branch's last commit message. |

## 7. Tier

`python3 scripts/lib/protected.py` reports "not protected": the change touches only `expedition.mjs` and the
expedition visit. It is still handled as S1b was: two engines, the search, a Paper repro. It rests on pathfinder water
behaviour that the repro has now seen work (level shores) and fail (a one-block-up shore).

## 8. Release

See the ledger row `expedition-water` in `config/owner-commitments.json`, and the branch's last commit message.

Read after release, over 2 h:

- `_expedition op=cross` rows with `dry=1` against `dry=0`
- the trip rows' `cross=`
- bearings 2, 3 and 5 trips past 164, 273 and 150
- `build_shop` "every bearing is blocked" count, which should fall
- hauls greater than 0
- drowning deaths: the default two-death gate applies

If `dry=0` is 10% or more of crossings, set `EXPEDITION_SWIM=8`.
