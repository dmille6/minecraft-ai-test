# townstyle-01 reviews (fun mode: one round, blockers only; two engines because the piece writes a tripwire rule)

## Codex r1 (codex exec, read-only; the code at b77a5f9c + the RO1 tripwire diff)
BLOCKER 1: shopread.py.txt RO1 accepted any oriented block at any state-bearing cell, without checking its role/palette (a spruce_log
post cell also authorized digging oak_trapdoor, dark_oak_stairs or a lantern). Fix: resolve the cell's role against that generation's
palette and require the dug block to match; wrong-family and wrong-species negative tests.
-> FIXED on main: reorient_ok requires the dug block to be one of the cell's role names in that generation's own palette ($role
expanded, $planks the planks wildcard); a generation without a palette authorizes nothing. Tests: wrong family, wrong species, no
palette, a stateless cell whose block is a log, a non-oriented block on a state cell. Mutants 162/162 killed.

## Claude r1 (an independent general-purpose subagent; the same diff and the RO1 diff)
NO BLOCKERS. Checked: existing buildings unchanged (every new branch gated on st/ws/blind; planReader only adds properties); no endless
reorient loop (BUILD_ATTEMPTS bounds it per visit; every reader carries properties); the wood-parts craft accounting balances (drawn into
tookAll before preCraft, crafted inside the booked try/finally); siting races safe (publishRecord only when no record; site_taken
re-check); RO1 no false trip for the cottage's rows.
Notes: (1) a placement that LANDS in the wrong state returned `refused` -> not tallied -> a G8 bag_loss TRIP on one bad click -> FIXED
973222c9 (`misplaced`: booked as placed, one attempt, then reoriented; test + anchored mutant); (2) the contrast roof wood at exactly 20
logs could stall the roof -> the margin raised to 32 (the roof takes ~18); (3) the cottage always retries the FIRST free house plot ->
named in the design section 8 (the enchanting workshop's pattern).

## Codex r2 (the RO1 fix + 973222c9)
NO BLOCKERS.

## Codex r3 (937226c4: the skill-wrapper fixes) -- NO BLOCKERS.

## Codex r4 (townstyle-02/03 code + RT1 + H8)
BLOCKER 1: the retrofit proof kept the full original interior but carried only the added roof cells: existing furniture read as
unreachable floor (workshop 12/15, storehub 87/105, hall 95/99, enchantshop 89/91); the planner retried the workshop for good. Fix:
exclude preserved furniture and the enchanting workshop's fit slots. -> FIXED aa6e85ac (reroofProofBlueprint).

## Claude r1, second engine (townstyle-02/03 + RT1 + H8)
BLOCKER 1: the same as Codex r4's (it reproduced it: house1 ok, the four others failed) -> FIXED aa6e85ac.
BLOCKER 2: the planner's 30-min wait after a failed proof was not a wait in shopActive (an always-free open project ahead of the upkeeps,
the yard, the sinks; the canefarm-01 r1 pattern) -> FIXED aa6e85ac (waiting during siteWaitUntil; wiring test).
Confirmed: the slab-merge guard matches vanilla SlabBlock.canBeReplaced; RT1/G1 against the head record; H8 never trips (exposure only).
Notes taken: (1) a retrofit generation stays COMPLETE (open records switch off stations, the clerk, the fitter, `after` projects) --
its open roof reads as damage, repaired first; (2) H8's exposure dips during a workshop retrofit (fail-closed, expected);
(3) a building whose proof keeps failing is passed over after 3 (named).

## Codex r5 (aa6e85ac) -- NO BLOCKERS.
