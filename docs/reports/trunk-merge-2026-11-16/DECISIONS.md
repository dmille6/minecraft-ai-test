# Trunk merge: where the two lines truly disagree, and what was chosen

A failing test that could not be repaired without breaking a test of the other line is listed here. Nothing in this file
is settled until the two-engine review and, for anything that changes what the showcase does, the showcase's control
session. "Chosen" is the working choice on the branch.

| # | Where | Fleet says | Showcase says | Chosen on the branch | Why | Fleet switch |
|---|---|---|---|---|---|---|
| 1 | `escapeguard.mjs` `guardOf` (protected) | Below a zone floor a bot digs out through any block (the deep exemption) | Zone-walk: a STRUCTURE block is the zone's at every depth; ordinary rock stays open (escdead-01show, `317b9c5ff`) | Showcase: `ZONEWALK` defaults on. `escapeguard.test.mjs` is the showcase's copy, which asserts both settings | zonewalk and zoneguard tests need it; the fleet behaviour is kept whole behind the switch | `ZONEWALK=off` on fleet pools restores the fleet behaviour |
| 2 | `shop.mjs` sink turn (`shop.test.mjs` S1 idlework-01 B) | idlework-01's rule B for the same inputs | sinkfix-03 (`305057d03`); `sinkfix3.test.mjs` asserts the opposite | Showcase. The fleet assertion is still RED on the branch | Outside protected scope the showcase is the product | none found yet |
| 3 | junk well (`junkout.test.mjs`, 1 assertion) | The fleet band well ("the fleet half of bagroom-01's WELL") | bagroom-01's own well; restoring the fleet band breaks two `bagroom.test.mjs` assertions | Showcase. The fleet assertion is still RED | The showcase has the whole piece the fleet had half of | none |
| 4 | `craftroom.mjs` `craftRoomRemedy` (`craft-room.test.mjs`, 5 assertions) | escdead-01 (b): with only 1-use pickaxes, every craft may wear one while another copy stays | The showcase's rebuild rule for the same bag | NOT chosen: the function carries both parameters and the fleet's rule; the five showcase-side assertions are RED | Letting the showcase rule decide breaks `escdead.test.mjs`. Needs a person | `ESCDEAD=0` exists, but it switches the whole of escdead-01 |

| 5 | `buildrun.mjs` default deferral (`buildretry.test.mjs`, and the one failing assertion of `buildrun-r2b.test.mjs`) | buildretry-01: a failed cell is deferred by default (fleet commit `eddc6b8b6`, which had to edit the wall, wallstuck, zigbamboo, zigsealed and groundskeeper tests) | Five showcase tests pin the stops that default flips | NOT chosen: the showcase's default stands and the fleet tests are RED. Inferred from the fleet commit, not run | A person, with #6 | none |
| 6 | the in-visit waiver (`monustuck.test.mjs` last subtest, `stuckfleet03.test.mjs`, part of `stuckcells.test.mjs`) | A stuck cell is waived inside the visit | sealedcore-01 (`6793332c5`) waives air hollows only; tempstand (`e7bf89c25`) gives a stand instead | NOT chosen: RED | Same family as #5: how a build visit treats a cell it cannot place | none |

**Rows 5 and 6 are SETTLED (control session, 2026-11-16):** both fleet behaviours are in the trunk behind switches,
off when the pool is the showcase and on for every other pool, so the fleet keeps what it has and the showcase behaves
as today. `BUILDRETRY` (`buildretry.mjs buildRetryOn`) and `VISIT_WAIVER` (`stuckcells.mjs visitWaiverOn`); an env value
overrides either way. The test runner sets both `off` by default (the suite runs with no pool, which would otherwise read
as a fleet pool), and the five fleet tests set their switch at the top. buildretry, buildrun-r2b, monustuck and
stuckfleet03 pass. Reason given for the showcase default: its line already defers a cell and goes on, and a general
waiver would hide the cells planvalid and tidyflow are meant to repair; the waiver may be tried there later as an
experiment with its own read.

**Rows 2, 3 and 4 are SETTLED the same way (pool differences as flags, the plan's C1 wording):** `UNSITEDWAIT`
(`shop.mjs unsitedWaitOn`, row 2), `IDLEWORK_WELL` (`well.mjs wellBandOn`, row 3) and the new `CRAFTSPARE`
(`craftroom.mjs craftSpareOn`, row 4): off in the showcase pool, on elsewhere, an env value overrides. shop 82/82,
sinkfix3, junkout 29/29, bagroom, craft-room 112/112 and escdead 33/33 pass. Compared against the showcase sha's own
functions in the showcase pool: 0 of 80,000 `craftRoomRemedy` calls and 0 of 60,000 `buildOrder` calls differ.
Not whole on the fleet side: row 2 carries only the ORDER's part of the fleet rule (the stamp writer and the picker mark
are not on the branch), so a fleet pool is better on `UNSITEDWAIT=off` until they are; `disposeWell`'s visit-side band
is still missing (one subtest of `idlework2.test.mjs`).

| 7 | snow on a build cell (`stuckcells.test.mjs`) | A cell under snow is "blocked without properties" | gkunblock-01 digs snow (`snow` in the visit's default foreign list) | SETTLED as a pool switch: `SNOWKEEP` (`buildrun.mjs snowKeepOn`), off in the showcase pool, on elsewhere. It moves the visit's default list only; overburden, cover and chest-litter defaults still dig snow in every pool. The wiring subtest now accepts either line's read and proves a snow layer's `layers` is seen through the trunk's (the showcase's lazy read, which carries every block's properties; the fleet's `readBlock` carried snow's only) | pattern of rows 2-6 | `SNOWKEEP=off` |

## Fleet tests the showcase line has replaced with its own piece

Each of these is a fleet-only test whose feature the showcase rebuilt in its own way. The fleet code was not put back
(FIXING.md rule 3) and the test is still RED on the branch. A trunk cannot carry red tests: each must be retired by a
commit that names the showcase piece, or shown not to be covered after all. None is retired yet.

| Fleet test | Showcase piece that covers it (commit on the showcase line) | Sure? |
|---|---|---|
| buildnext | projturn-01show `24cc654f6` | yes |
| stuckproj | starve: projturn-01show `24cc654f6`; canopy: leaffell-01show `e81ff36a5` | the canopy half is a judgement call |
| idlework-sites | sinkfix-03 `305057d03`, projturn-01show `24cc654f6` | yes |
| idlework2 | bagroom-01 `f345094fa` | yes |
| plankeep | standcache-01show `1394d8acd` | yes |
| hivedrop | keeperstall-01show `fb4a50335` | yes |
| tidydead | gkunblock-01 `341510d5a` | KEPT, skipped with a reason (exit 77), until tidyflow-01show has landed and been read (control session) |
| stuckclose | tidyrefresh-01show `7a4930d10` | KEPT, skipped with a reason, same condition |
| stuckfleet | cap: coverdig-01 `005e29324`; light: gkleft `a6042d12a`; the held cell needs #5 | the road-light half is a judgement call |
| stuckfleet02 | fillcolumn-01 `0c142ae69` | yes |
| gkforever | gkhelpers `a3fed85e0`, country `8db58556b`, roughground `44e3717ac` | KEPT, skipped with a reason, same condition |
| shop S1 idlework-01 B (one assertion) | sinkfix-03 `305057d03` (row 2 above) | yes |
| junkout (one assertion) | bagroom-01 (row 3 above) | yes |

**Also settled in the last round:** `disposeWell`'s visit-side band is back behind `IDLEWORK_WELL` (never for a hall
clerk's throw); `stuckfleet.test.mjs` keeps its ten live subtests and the four that test the fleet's cap and light waiver
(not in the trunk; coverdig-01 `005e29324`, gkleft `a6042d12a`) moved unchanged to `stuckfleet-cap.test.mjs`, skipped
with that reason.

## THE LARGEST OPEN QUESTION: what the trunk newly turns ON for the showcase

The merge keeps every fleet-only change that did not conflict. So the trunk, run in the showcase pool, is the showcase's
code PLUS every fleet piece promoted since the two lines parted that the showcase never had, each at its own default.
Example found by accident: escdead-01 (`ESCDEAD_ON` in `toolfor.mjs`: 8 lines on main, 0 at the showcase sha), whose
pinned last swing is on in the showcase pool on this branch. Nobody has listed these yet. Until each is either defaulted
off for the showcase pool or accepted by the control session, releasing the trunk to the showcase is not one change, it
is all of them at once, which the showcase's one-change-at-a-time rule forbids. This list is owed before any release.

**The list now exists:** `SHOWCASE-NEW.md` (63 new switches, 41 on by default with a live caller, about 40 fleet pieces)
and `showcase-pool-off.env` (48 lines that turn them off for the showcase; 47 proven by running each switch's own reader
with and without the block). What the block does not cover is listed at the top of that file.

Also noted, not contradictions:
- `TOWNMINE_DEFAULT_POOLS` is the showcase's `'showcase'`; the fleet's `'*'` was set aside by the first pass. As it
  stands, fleet pools get no town-mine slots by default.
- `buildShopOn` (247 lines, fleet-only, no caller) was removed; fleet stuckcells-01's shop wiring lived only in it.
- The workboard's `boardPick` pin was moved into the one project picker (`shopActive`); the fleet picker's other marks
  (unsited, buildnext, starve) are not carried over yet.
