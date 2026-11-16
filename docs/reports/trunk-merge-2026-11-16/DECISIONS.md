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
| tidydead | gkunblock-01 `341510d5a` | yes |
| stuckclose | tidyrefresh-01show `7a4930d10` | yes |
| stuckfleet | cap: coverdig-01 `005e29324`; light: gkleft `a6042d12a`; the held cell needs #5 | the road-light half is a judgement call |
| stuckfleet02 | fillcolumn-01 `0c142ae69` | yes |
| gkforever | gkhelpers `a3fed85e0`, country `8db58556b`, roughground `44e3717ac` | yes |
| shop S1 idlework-01 B (one assertion) | sinkfix-03 `305057d03` (row 2 above) | yes |
| junkout (one assertion) | bagroom-01 (row 3 above) | yes |

Also noted, not contradictions:
- `TOWNMINE_DEFAULT_POOLS` is the showcase's `'showcase'`; the fleet's `'*'` was set aside by the first pass. As it
  stands, fleet pools get no town-mine slots by default.
- `buildShopOn` (247 lines, fleet-only, no caller) was removed; fleet stuckcells-01's shop wiring lived only in it.
- The workboard's `boardPick` pin was moved into the one project picker (`shopActive`); the fleet picker's other marks
  (unsited, buildnext, starve) are not carried over yet.
