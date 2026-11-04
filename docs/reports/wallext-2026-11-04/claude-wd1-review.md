# WD1 review (Claude, independent subagent, 2026-11-04)

r1: 3 BLOCKERS -- (1) the reader trusted the demolition record's own line/cols (a wrong inward sign, another side, a corner column
would pass): now the line, span and inward come from the WALLEXT record's join + side, the column must be a built line column in the
old wall's own cols, strictly inside the span, 0..3 in; (2) foundations (`base`) were not excluded: now they are; (3) tidy_guard
reserved retired cells forever (the groundskeeper's levelling would read `guarded`): now reserved until the generation's retiredAt.
r2 (after the fixes): **APPROVE, no blockers** (selftest ok, 136/136 mutants). Notes: the `u|` key frees the cell for every guard
source (a later marker on a retired cell would be freed too; implausible today); demo_line_of reads the newest extension generation
with a join (a re-sited extension would flag digs against an older line); a `settling` demolition must stay offered (it does: the
record is open until complete, so the order keeps offering it).
