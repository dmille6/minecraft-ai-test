# WX1 review r1 (Claude, independent subagent, 2026-11-04): APPROVE, no blockers

- Selftest ok; the 4 new mutants and every existing one killed; control ok.
- No other wall special case: `plot == 'wall'` appeared only at the two changed lines; REC_RE / LEASE_RE take `wallext`; the
  groundskeeper's guard (tidy_guard) already reserves the extension's cells (it walks every other plot's chain).
- Footing and cap cannot reach an old wall cell: both accept only cells in a column of the extension's own record, and siteWallExt
  refuses the old wall's cell columns (`old_wall` gap: no wall, step or light cells; lane clears skip them; felling never crosses into
  them; join columns build nothing). An extension placement onto / dig of an old cell stays off_record / clear_outside.
- Legitimate rows pass: placements, footings, clear-list digs, foreign digs of its own cells, caps over a step (any_role); tree
  felling with replant [] -> saplings=0/0 judged; waived / sited / complete rows are not G1/G2's.

Notes (not blockers): (1) the read never checks the two records are disjoint -- a one-line report of extension cells in the wall
chain would make "never the old wall's" mechanical; (2) oldCols is the wall's head only (a re-sited wall's earlier generation is not
refused; bot side); (3) two negatives (xp('5,67,5'), xc('5,68,5','leaves')) score 1 with or without WX1 -- the -25 rows test the
change; (4) a footing under a light cell is accepted as for the old wall (unchanged).
