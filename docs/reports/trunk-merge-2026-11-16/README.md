# Trunk merge (consolidation C1): the showcase line into main

Branch `trunk-showcase-into-main`. **Work in progress: not reviewed, not on main.**

**State at 5e90ddce1 (2026-11-17 00:25Z):** fifth suite on ci3: 590 of 603 test files pass, 10 are skipped with a written
reason, 3 are red (lavastep, plinth-skill, well) and all three are red on the showcase build `6ed264b9` alone on the same
kind of host (`suite/showcase-baseline-ci4.log`: 528 of 534, six red). Suites in order: 526, 574, 586, 586, 590.
Read next: `DECISIONS.md` (what the two lines disagreed on and how each was settled), `SHOWCASE-NEW.md` and
`showcase-pool-off.env` (what the trunk would newly switch on for the showcase, and the block that switches it off).
**State at 9571abad8 (2026-11-17 01:20Z), with origin/main and the showcase's bagfix-01show `0e33aa99` merged in:** sixth
suite on ci3: 591 of 605 pass, 11 skipped with a written reason, 3 red: plinth-skill and well (red on the showcase build
alone) and protected-paths, which fails the same way in the showcase baseline log, passed in suites 2 to 5 and passes
when run alone (its Python wrapper under load). The items "merging in what both lines have landed since" below are done
for those two; the showcase's bag and chest release 2 is not out yet.

**Still owed before this is a trunk:** the hand read of the 33 protected declarations where the fleet's version stands
(`ledgers/review-worklist.json`, key `fleet`); the two-engine tier-3 review; merging in what both lines have landed since
(main's tooling commits; the showcase's bagfix-01show `0e33aa99`, live 11-16 23:03Z, which reads `CHESTCARRY`, a name the
fleet's chestcarry-01 also reads); and the release path for each world, which belongs to the showcase's control session.

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
