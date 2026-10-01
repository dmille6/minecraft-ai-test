# Status 2026-10-01 — daily operator session (12:05Z–13:40Z)

**Fleet:** `bf296c9` (idlegap-01 KEPT +360, promoted 11:38Z). **Canary:** `fixes-02` on `f5609af`, board-a + hive-c,
declared 13:28:21Z; reads +180 16:28Z, +360 19:28Z; deadline 10-02 17:48Z. **Next:** oretunnel-01 (49096f4) chained.

## Overnight (host loop, no human)
- hygiene-01 KEEP (01:47Z), promoted.
- fixes-01 REVERT at +180 (05:10Z). **False revert.** The single failing row on `prequsableread.spent_satisfied_judged`
  was placebo-a-Comet at 02:03:06Z on the OLD build adc7658 — logged between declared_at (02:02:10Z) and the end of the
  pool restart (02:05:30Z). Of 45 canary-build pickaxe satisfactions, 0 used spent copies; control 101 of 212.
- idlegap-01 drew placebo-b + placebo-d, KEEP at +360 (deaths 0 vs control 9), promoted fleet-wide.

## Today
1. Merged bf296c9 into `main` (a2b5d36; `main-pre-20261001b`), 208/208.
2. Read fix (e8cd891): prequsableread, toolsaferead and immobiledid's death count now skip post-cutoff canary rows
   from a known other build (non-empty version not matching CV). Positive control for the instrument: control still
   shows 101 spent-satisfied rows; empty versions: 0 of 450,482 rows in 10 h. Codex 2 passes (CHANGES → APPROVE).
3. fixes-02 = the same seven members on f5609af (214/214), registered with deadline 1700, launched 12:21Z, drew
   board-a + hive-c at 13:28Z. Two versions live, 80 bots.
4. ore-on-f5609af (49096f4, 215/215) built and registered; `chain-ore.sh` launches it if fixes-02 is promoted.

## For the owner
- This is a second mechanism for false reverts (after the 8019b1d audit): rows from the restart window. Any new
  read must filter by build on its gate lines, not only on its liveness lines.
