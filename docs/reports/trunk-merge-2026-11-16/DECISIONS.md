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

Also noted, not contradictions:
- `TOWNMINE_DEFAULT_POOLS` is the showcase's `'showcase'`; the fleet's `'*'` was set aside by the first pass. As it
  stands, fleet pools get no town-mine slots by default.
- `buildShopOn` (247 lines, fleet-only, no caller) was removed; fleet stuckcells-01's shop wiring lived only in it.
- The workboard's `boardPick` pin was moved into the one project picker (`shopActive`); the fleet picker's other marks
  (unsited, buildnext, starve) are not carried over yet.
