# Trunk merge (consolidation C1): the showcase line into main

Branch `trunk-showcase-into-main`. **Work in progress: not reviewed, not on main.**

- Merged: main and the live showcase release `6ed264b9` (branch `planvalid-01show-on-projturn`), on the owner's word of
  2026-11-16 and the control session's choice of sha. Not in it: tidyflow, minecrew, airroute.
- A plain merge conflicts in 122 files. They were resolved by rule, by the scripts in this folder, run in this order
  from the merge worktree with a scratch folder holding `protected_main.py` (a copy of `scripts/lib/protected.py`)
  and `conflicts.txt` (the conflicted paths):
  1. `resolve.py` — line merge of every conflicted file; writes `ledgers/merge-ledger.json`.
  2. `symmerge.py <scratch> <file>` on each conflicted `bots/src/*.mjs` — the declaration-level merge that replaces
     step 1's result for those files; writes `ledgers/symledger-<file>.json`.
  3. `fiximports.py <file>` after each — folds duplicate imports.
  4. `impcheck.py` from `bots/` — every named local import resolves to an export (it reports four that do resolve:
     it does not read `export async function*` or multi-line forms).
- The rule: protected scope (`config/protected-paths.txt`) takes the fleet side where both sides changed the same
  declaration and the line merge inside it conflicts; everything else in `bots/` takes the showcase side; tooling
  outside `bots/` takes main. A declaration changed on one side only takes that side; one that only one side has is kept.
- `ledgers/review-worklist.json` is what a person still has to read: 33 declarations where the fleet side was picked
  (showcase changes there are set aside and may need re-applying) and 239 where the showcase side was picked (fleet
  changes there are set aside). 189 declarations only the fleet has were kept and may now be unused.
