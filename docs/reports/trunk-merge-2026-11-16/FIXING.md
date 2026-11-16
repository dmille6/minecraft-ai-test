# Fixing the first pass: rules for whoever repairs a failing test on this branch

State after the rule-based first pass (4bd76a26c): the suite on ci3 passes 526 of 601 test files; the live showcase build
`6ed264b9` passes 528 of 534 on ci4. Four files fail on both (plinth-skill, protected-paths, well, townstyle-slab): leave
them. The other 71 are new and are assertion failures, mostly one to five per file; none is a load error. Logs:
`suite/pass1-ci3.log` (failing detail per file after a line `--- <file> (exit 1) ---`) and `suite/showcase-baseline-ci4.log`.

The three sides, for `git show <ref>:<path>` and `git diff`:
- fleet / main: `origin/main`
- showcase: `6ed264b92811c20b24ba9e1f55119dca19a16a9f`
- their common ancestor: `0fb6c0b7c`

What the first pass did to a file is in `ledgers/symledger-<file>.json` (one row per top-level declaration: which side
it took and why) and `ledgers/review-worklist.json`.

Run ONE test file at a time, from `bots/`, on this Mac: `node scripts/run-tests.mjs <substring-of-the-file-name>`
(the runner sets the environment the tests need; exit code 0 is a pass). Never the whole suite here: this Mac is a
controller. `npx eslint src/*.mjs` must stay at exit 0, and `node --check` on every file you touch.

How to decide a fix, in this order:
1. **The showcase is the product.** A test that came from the showcase line (it exists at the showcase sha) must pass
   with the behaviour the showcase has. Find what the merge changed under it and put the showcase behaviour back.
2. **Protected scope is the exception** (`python3 scripts/lib/protected.py --files <path>`; per-symbol for skills.mjs):
   there the fleet version of a declaration was kept. Re-apply the showcase's change ON TOP of the fleet version so that
   the fleet's tests and the showcase's tests both pass. If they truly contradict (one behaviour cannot satisfy both),
   STOP on that test and report it: that is a decision for the showcase's control session, not for you.
3. **A fleet-only test** (exists on origin/main, not at the showcase sha): the fleet feature should keep working in the
   trunk wherever it does not contradict showcase behaviour. Usually the merge took the showcase version of a
   declaration and lost the fleet's addition inside it: put the addition back, merged with the showcase's code. If the
   showcase line deliberately replaced that feature with its own version (find the commit), do not resurrect it: report
   it as superseded and leave the test failing.
4. **A source-text assertion** (a test that greps the source) that fails only because a declaration moved or an import
   was re-wrapped: prefer restoring the shape of the code; edit the assertion only when the code is right and the
   anchor is simply elsewhere, and say so.

Never weaken, skip or delete a test to make it pass. Never change behaviour that no failing test asked for. Keep each
fix as small as the failure. Every fix names, in the commit message, the test it repairs and which rule above it used.
