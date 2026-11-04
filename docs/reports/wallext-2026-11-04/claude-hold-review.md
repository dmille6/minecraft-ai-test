# The demolition hold, review (Claude, independent subagent, 2026-11-04)

r1 (6aff6710): 2 BLOCKERS -- (1) tidyAvoid returns its FIRST reason: on held columns beside kept wall cells that was the wall's own
`project:wall` zone, which BUILD_WHY reads as a build, so the access stairs (and litter cuts) still went there; fix: the hold as the
tidy's `reserved` (checked first); (2) a failed release was never retried (a complete walldemo is never picked again: no cells to
read damaged); fix: the hold is live only while the demolition head is open (projectHeads -> wallAsHeld). The reader change correct.
r2 (4a19d97f): **APPROVE, no blockers**. Notes: with WALLDEMO=off the demolition head left projectHeads, so a live hold would stay --
fixed in d745913a (walldemo always guarded); the "complete retries the release" wiring line describes a path the picker never takes
(harmless: the release is cleanup) -- renamed.
