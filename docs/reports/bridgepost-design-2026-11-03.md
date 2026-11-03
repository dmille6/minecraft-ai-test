# bridgepost: bridges at refused crossings, then outposts at turn points (2026-11-03)

Owner decisions:

- 11-01: water, boats and **bridges** are allowed. Pathfinder scaffold-bridging stays off; bridges are designed structures.
- 10-27: expeditions need breadcrumbs AND markers. Reliability over speed.
- 11-03: "design all using both claude and codex, put them in the queue and implement and deploy where you feel is right".

The item has two parts:

- **(A)** cobble bridges over water that expeditions cannot swim. They are sited from logged crossings, paid for with surplus
  cobble, and walkable both ways with rails.
- **(B)** outposts at expedition turn points: a small shelter, a chest and a marker, where bots restock and go further.

The design follows on from [`expwater-design-2026-11-03.md`](expwater-design-2026-11-03.md) and
[`wholemap-expeditions-design-2026-11-01.md`](wholemap-expeditions-design-2026-11-01.md) sections S2, S3 and 6.

Code: branch `bridgepost-01-show-on-cbd2f51b`, on the live showcase release `cbd2f51b`. Paper driver: `sandbox/bridge/`. Kill
switch: `EXPEDITION_BRIDGE=off`.

## 1. What was measured

**Live, since expwater-01 went live (showcase cbd2f51b, released 18:38Z, read to 20:45Z).** 5 trips started.

- **Bearing 2:** 2 trips, 2 swims each (13 and 11 wet columns). All 4 crossings `dry=1`. Both trips reached 289-308 blocks and
  felled 4 logs.
- **Bearing 4:** reached 312 blocks, dry.
- **Bearing 5:** turned at 215. Its reason was `water` because the bot was in the water (-157,62,-146) after a dry leg. That is
  not a width refusal.
- **0 `swim_wide:` rows live.** Positive control: the same grep over the same files finds the 4 `op=cross` rows and the water
  turns.
- **Before the release** (adbf9e41, 6 h): water turns at 150 on bearing 5, at 164 on bearing 2, and at 273 on bearing 3 (3 trips).

**Offline: the real planner on a copy of the world.** The copy is `townplan_blockdump.py` over the timelapse mirror, x/z +-400,
y 52-90, 25.0 M cells, protected-zones.json applied. The planner was replayed from home on all 8 bearings with swims allowed:

- **6 bearings** reach 343-359 blocks.
- **Bearing 3** is refused at 275 (`swim_wide:22`).
- **Bearing 5** is refused at 174 (`swim_wide:17`).

**The water there is not one wide lake.** It is open water between ice sheets. The live b3 turn point (-210,63,175) stands on a
frozen lake's ice, with open water ahead along the bearing. The **narrowest crossing that opens the way is off the spoke**:

| refusal | site (axis-aligned, within 20 of the turn) | width | cobble | the planner gets past its landing |
|---|---|---|---|---|
| b3 at 275 | near -199,63,170, along +z | **12** | 60 | +61; with it built, b3 reaches 401 |
| b5 at 174 | near -93,63,-149, along -z | **2** | 10 | +43; with it built, b5 reaches 409 |
| live b3 turn (-210,63,175) | near -191,63,172, along +z | 6 | 30 | +61 |

With those two bridges built in the replay, **all 8 bearings reach the dump's edge (383-409)**. The design's 17-32 widths are not
needed at these sites. The cap stays at 32 for other worlds.

**What a naive rule would have done.** The narrowest span by width alone was a 1-wide gap between two ice sheets with more water
behind it (13 such dead ends at b3). Near ends on an ice sheet across open water from the bot were sited and never reached (51
`no_ref` before ice counted as ground). Both are now refused. A site must open at least 30 blocks (`beyond`) and be reached dry
(`reach`).

**Material.** Showcase bags hold 458-540 cobblestone each (5 of the 10 bots read; the other 5 rows carried no inventory). A
32-wide bridge is 160 cobble. The bag pays first. When the bag is short, the town draw honours the reserve (matsWithdraw).

## 2. The Paper proof

The proof ran on sandbox2, lock taken and released. It used bare mineflayer with the **shipped** `bridge.mjs` + `bridgeio.mjs`,
the bots' walk prices and the bots' `watermoves` shore egress. The arena was a sealed stone shell, so there was no way round the
lake.

| run | width | far shore | builds (stop, placed, ms) | misses | crossings | wet ticks (build/walk) | deaths |
|---|---|---|---|---|---|---|---|
| r12 | 12 | level | done 62, 21.0 s | 4 place_timeout | 10/10 | 0/0 | 0 |
| r12c | 12 | level | done 62, **7.2 s** | 0 | 2/2 | 0/0 | 0 |
| r20 | 20 | +1 | time 20 (interrupted at 10 s), done 83 | 7 | 20/20 | 0/0 | 0 |
| r20b | 20 | +1 | time 68 (8 s), done 35 | 1 | 20/20 | 0/0 | 0 |
| r32 | 32 | level | time 119 (15 s), done 45 | 2 | 20/20 | 0/0 | 0 |
| r32b | 32 | +1 | time 104 (12 s), done 60 (**18.7 s total**) | 0 | 20/20 | 0/0 | 0 |
| r12s | 12 | level, squid in a deck cell | place_failed 11 (the squid's cell), done 51 after it left | 2 (`body:squid`) | 4/4 | 0/0 | 0 |

Totals: **7 bridges built intact, 96/96 crossings both ways arrived dry, 0 wet ticks while building, 0 deaths.**

**Facts this rests on, now seen working on Paper 1.21.8:**

- A block clicked onto the **side face** of the deck block the bot stands over, while the bot stands centred on it, lands in the
  water cell ahead. Vanilla replaces the water, and Paper does not check whether the face is visible.
- Rails clicked onto the top face of the side deck work.
- `placeBlock` resolves on the server's blockUpdate.

**Found by the proof, and fixed:**

- **r12 and r20:** about one rail in three timed out on the first click. One tick of settle after the look (`LOOK_SETTLE_MS` 60)
  fixed it: 0 misses in r12c and r32b.
- **r32 and r20b:** an empty hand after a used-up stack gave "must be holding an item to place". The actuator now re-equips the
  next stack and clicks again.

**Not proved:**

- two builders (a one-builder lease prevents it)
- a chunk unload mid-build (the read-back and the world-read resume cover it)

An earlier attempt ran briefly against sandbox3 while another agent's lock was held. It is reported in §9.

## 3. The design (A): bridges

**Shape:**

- **Axis-aligned**, because a diagonal deck joins only at corners and a walker cannot cross it.
- **Deck 3 wide AT the water's surface block (y = W).** The walkway then stands at W + 1, level with a level shore, so a bridge is
  land to every walker. The expedition's own surface read sees it as dry ground.
- **Rails** 1 high on the two outer deck columns over every water row. The walkway is 1 wide and walled, so a walker cannot step
  off sideways.
- **Ends** are the shores, at W + 1 or W + 2. A higher bank is refused and logged. A stair abutment is a later piece.
- **A torch on a rail every 8 rows**, only where no ice is within 3. Ice is accepted as ground (the showcase's lakes are frozen at
  their edges) because only block light melts it.

**The build:**

- Row i's centre is clicked onto the +axis face of row i-1's centre. For row 0 it is the near shore's ground block.
- Its two sides are clicked onto the centre's side faces. Its two rails are clicked onto the sides' tops.
- All of this happens **standing on row i-1**. The builder steps onto row i only when that row's rails stand.
- So the cell it stands on always has rails beside it, and the water is only ever ahead.
- Progress is read from the world, never stored. A half-built bridge resumes from what stands.
- The builder stops when:
  - it is wet (it swims out; the next trip resumes)
  - a body is in the cell
  - a step fails twice
  - the call is ending (12 s are kept)
  - it runs out of cobble

**Siting from logged crossings:**

1. A dry bot that turned because a leg was refused for water (`swim_wide`, a bank, or water) runs `bridgeSite` where it stands. It
   looks for the narrowest span within 20 blocks that it reaches dry and that opens the way (≥ 30 blocks).
2. The result is logged as `_expedition op=bridge_site` and appended to the town's `expedition-<home>.bridges.jsonl` as a `sight`
   line.
3. Sightings on the same axis within 8 blocks are one site.
4. A site is built once **2 distinct trips** have sighted it.

**Who builds it, and when:**

- When a site is due and the bag holds the cobble, the next trip is a bridge trip on that site's bearing. The cobble is drawn
  above the reserve if the bag is short.
- One builder at a time: the `expedition-<home>.bridge` lease.
- A bridge trip walks out with 85% of the call, builds to the call's end, and `home` follows the trail next call.
- A bridge trip that never reaches its site writes a failed visit. Three failed visits in 24 h rest the site.

**Using it:**

- A finished bridge is a leg (`bridgeLeg`), tried after every dry bend and before any swim:
  - from within 28 blocks, a leg to the near end
  - at the near end (within 3.5), a leg along the deck to 3 past the far end
- The far end is a **gate**, as a swim's far shore is, so the way home walks back over the bridge.
- A bridge is never taken back from its far side.
- A bridge whose cells are in sight but not intact is marked broken (`complete: false`), and the next bridge trip repairs it.

**Reservations.** Every site's footprint is kept off by:

- the tidy and the land plan (townMarkerZones)
- the tidy's dig guard (bridgeCellKeys)
- expedition markers and felling (markerOff)

**Rows:**

- `_expedition op=bridge_site|bridge_pick|bridge_place|bridge_build|bridge_done|bridge_broken`
- `op=cross via=bridge`
- the trip row's `br=<stop>:<placed>`
- the licence row's `bridge=1`

## 4. The design (B): outposts (not built in this piece)

Claude and Codex agree on the shape and on what must not happen:

- **The shell.** A 5 x 5 cobble pad. Two-high walls with a 2-wide doorway facing home. A roof. A chest with clear lid space. A
  crafting table. A torch inside. A 5-high beacon pillar (cobble + torch) outside the door.
  - About 75 cobble, 8 planks and a table.
  - Sited on dry, flat, non-ice ground, outside every zone and project.
- **Where.** A dry turn point reached by ≥ 2 trips that came home. The first candidate is bearing 4 (reached 312 dry,
  repeatedly), at 250-300 blocks.
- **The cache.**
  - Stock: 32 cobble, 16 torches, 8 logs (and a spare stone axe in Codex's version).
  - Valuables gathered far out are banked there when a bag is full, and carried home by a later trip.
- **No beds, no spawn change.** Home stays the town.

**Restock and go further.** A cache does not lengthen today's trips by itself. One call is 165 s, and 270 blocks of walking
takes ~90 s. A **journey** with persisted phases is needed:

`transit -> restock -> explore -> return-to-node -> return-to-town`

- Rings are measured from the outpost.
- Hops are split by the measured walking time (≤ 200-250 blocks a call).
- Cooldown applies between journeys, not between calls of one journey.
- `home` always ends at the town, and a restart resumes the saved phase.

This changes how a trip is scheduled across calls (the runner's `home` and the order). It is the biggest piece, and the
riskiest.

## 5. Codex's independent design and the reconcile

Codex was given the measurements and the goal, not this design. Saved as `codex-design.final.txt` in the session scratch.

| point | Codex | Claude | taken |
|---|---|---|---|
| deck height | D = max(W+1, shore feet - 1): one block ABOVE the water, a step up from a level shore, approaches built on land | AT the water surface: flush with a level shore, no approach; a fallen walker climbs back onto the deck end (a level shore, Paper 11-03) | **Claude**: it needs no approach ramps, the planner reads it as ground, and Paper proved it 96/96 |
| width / rails | 3-wide deck, walls on the outer lanes, 1 clear lane | same | both |
| how blocks are placed | ref = the deck behind, face = the axis; sneak to the edge until the face is visible | ref and face the same; **no sneak**, stand centred (the face is not visible from there) | **Claude**: Paper does not check visibility; 0 wet ticks; sneaking to an edge is the one way to fall in |
| siting | log refusals; survey within 32; build only a 17-32 span with no workable nearby dry or swim route | log refusals; site the narrowest span within 20 that is reached dry and opens >= 30 | **Claude, with Codex's "no workable route" idea kept as `beyond`**: the measured sites are 2 and 12 wide, off the spoke; a 17-32-only rule builds nothing here |
| promote | 2 independent refusals + a fresh survey | 2 distinct trips' sightings | both (same rule) |
| progress | world reads, never a counter | same | both |
| partial bridges | closed to travellers | only `complete` sites are legs; a broken one is marked and repaired | both |
| arrival at the gate | tight 3-D checks | goto range 2 + BRIDGE_ON 3.5 (a review blocker found the 2.0 too tight) | Claude |
| outposts first? | yes: a dry outpost shell and cache first (tier 2), then journeys, then a bridge after a Paper proof **and a fleet canary**, and ten live uses before a second bridge | bridges first: the two refused bearings need 70 cobble of bridge in total; an outpost without journeys restocks nothing | **Claude for the order. Codex's "10 live uses before another bridge" is kept as the read** |

**Why bridges first.** The only two bearings still closed after expwater-01 need a 12- and a 2-wide bridge, and with both built
the replay reaches the map's edge on all 8 bearings. An outpost needs the journey piece before it does anything for range. The
fleet canary Codex asks for buys nothing: expeditions run only on the showcase (`EXPEDITION_POOLS` defaults to 'showcase'), so
no fleet bot would ever build a bridge.

## 6. Reviews (fun mode: protected.py "not protected"; it rested on unseen Paper behaviour, so two engines)

| reviewer | round | verdict |
|---|---|---|
| Claude, independent (subagent) | r1 | BLOCK: a bot that `goto` (range 2) left 2.1 out read `bridge_in` again, moved 0, and turned 'blocked' at the bridge. Notes: an unreached site could hold a slot; an unloaded bridge could read broken. All fixed in r1. |
| Codex | r1 | BLOCK: the same arrival blocker, and a marker due mid-bridge pillared the walkway. Both fixed in r1 (BRIDGE_ON 3.5; markerOff). |
| Claude | r2 | APPROVE (both fixes close their blockers; no new failure) |
| Codex | r2 | APPROVE (reproduced both old failures in synthetic worlds; both closed) |

## 7. The pieces, their tiers and the queue

| piece | what | tier | lane | Claude | Codex |
|---|---|---|---|---|---|
| **bridgepost-01** | bridges (this branch) | 2 by protected.py; handled as 3 (unseen Paper behaviour, now proven) | **showcase** | after the copper hall finish + signs, before 10 -> 15 bots (it reopens b3 and b5 for the 15-bot step's expeditions) | a showcase bridge only after a fleet canary |
| outpost-01 | the shell + cache at a dry b4 turn point, filled by passing trips | 2 | showcase | after the 15-bot step, with or after storehub | **first** |
| journey-01 | multi-call journeys through outposts | 3 if it touches `home`'s scheduling (skills.mjs `home` is not listed; the runner's order is) | showcase, then the fleet when expeditions go to the fleet | after outpost-01 | same |
| bridge-02 | stair abutments for banks 3+ above the water | 2 | showcase | after 10 live uses of bridgepost-01 | same |

**Reconciled placement.** bridgepost-01 goes in the **showcase lane**, after the copper hall finish + signs and before the
10 -> 15 step.

**Showcase tripwire.** `shopread.py` gains `read_bridges`. Every planned block of every sighted site joins the markers' guard, so
a tidy cut of a bridge cell trips G2 `clear_outside`. Its selftest (ok) and mutants (86/86 killed) are on main; reviews: Claude r1 BLOCK (merge kept the later time; guard wider than the bot's plan), Codex r1 BLOCK (the same, and malformed spans raised), all fixed; both r2 APPROVE
(`docs/reports/shop-01-2026-10-25/shopread.py.txt`). It is **not installed**. Install it before the release. Expedition
placements write `_expedition` rows, which shopread does not judge, as for markers today.

## 8. Release and read

**Release:** record, stage and activate. That is the control session's job.

**Read at +2 h, and again at +24 h:**

- `op=bridge_site ok=1` rows, with sites and their widths.
- A `bridge_pick` and `bridge_build` / `bridge_done` per site.
- `bridge_place ok=0` against `ok=1`. More than 10% `ok=0` is a defect.
- `op=cross via=bridge dry=1`.
- Trips on b3 past 275 and on b5 past 174.
- "every bearing is blocked" falling.
- Deaths and drownings: the default gate.
- Tripwire S6.

**Effect.** At least 1 bridge built and crossed ≥ 10 times within 72 h of release. b3 and b5 trips beyond their old turns.

## 9. A sandbox incident

The first run of the Paper driver took `sandbox3` while it was **held by another agent** (`farms`, farms-01 Paper proof, since
20:58:36Z). `sbxlock.sh take` printed HELD, and the driver was started anyway.

What it did to sandbox3 at 21:04:25Z:

- `difficulty peaceful`
- `forceload add 880 880 960 940`, which it never removed: the driver died before its cleanup
- fills in x 895..945, y 30..55, z 899..917: a stone shell, a lake and grass

What it did not do: no player joined.

All later runs used sandbox2 under its own lock, which was released at 21:21Z. The farms agent should check whether its arena
overlaps that box, and run `forceload remove 880 880 960 940` on sandbox3 when it is done.
