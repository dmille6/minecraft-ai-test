# The telemetry walk-cap fix is not on the deployed line, and today's promotion overwrote the host with the broken copy (22 Sep 05:30 UTC)

Read-only finding, nothing changed. **Not a canary or fleet risk** -- the blast radius is ad-hoc analysis. Filing it
because it silently un-fixes a bug that was already fixed, and it will keep happening on every promotion.

## What happened

`c79d57b` (18 Sep, "telemetry: price the window the caller asked for") fixed `Events.load`'s size cap: the estimate
priced EVERY matched file, including rotated `.gz` generations the walk then skipped on mtime, with `.gz` counted at
25x. The commit's own measurement: 1124 rotated generations totalling 0.44 GB priced at 11.4 GB against 1.9 GB on
disk, so every call raised, `since_minutes=30` included. The fix is a single frozen glob shared by the estimate and
the walk, behind one `predates_window()` predicate, so the two cannot drift apart again.

**That commit lives on `recovery-ladder-03` and is not an ancestor of the deployed sha.** The leaf-02 promotion wrote
`/opt/minecraft-ai` from `9fc3968` at 04:43:48Z, and the host's copy of the library now has no `predates_window` at
all -- its cap loop is `for f in glob.glob(paths)` again. I hit it minutes later: a **four-minute** window refused as
"~10.8 GB", against 1.4 GB actually on disk.

The message still says *"Narrow the window with `since_minutes=`"*, and on the host copy narrowing changes the
estimate not at all. A refusal naming a remedy the caller cannot perform is the failure this repo has a rule about.

## Blast radius, measured rather than assumed

| caller | state |
|---|---|
| `leafbread`, `ownerread`, `immobiledid`, `deathread`, `fallread` | **safe** -- each passes `paths='/var/log/mcai/*/skill-*.jsonl'`, no trailing `*`, so no `.gz` is priced |
| `canary-report.py`, `verdict.py` | **safe** -- neither calls `Events.load` |
| every ad-hoc read using the default glob | **broken** on the host right now |

So the canary loop keeps working, which is also why this can go unnoticed: the thing that breaks is exactly the
investigation someone reaches for when a canary reads oddly.

## What would fix it

The library is read from the deploy tree, and `/opt` is rewritten by every promotion
([[analysis-lib-lives-in-the-deploy-tree]] in the session memory), so the fix has to ride a promoted sha. Either
cherry-pick `c79d57b` onto the next candidate, or accept that `/opt`'s copy is whatever the last canary carried and
stop treating it as the shared library.

## A note on how I found it, which is the more useful part

I rediscovered this bug from scratch, wrote my own fix and my own test, and only then found that both already existed
on another branch -- and that the existing fix is better than mine, because it shares one frozen file list between
the estimate and the walk where mine kept two globs that could still disagree. I discarded my version rather than
commit a worse duplicate. The lesson for the next session is cheap: **before fixing shared tooling, `git log` the
file across every branch.** Two checkouts of this project have diverged copies of `scripts/lib/`, and the primary
working directory holds the stale one.
