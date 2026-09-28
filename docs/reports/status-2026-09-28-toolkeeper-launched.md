# 2026-09-28 — The tool-keeper canary is live, and the version built last night would have lied

_written 2026-09-28 ~12:10Z (`date -u` on the mini). Baseline `80b3bbd+8b910b` on 60 bots; canary
`toolkeeper-01` on `4320136` on 20._

**The short version.** Last night's session built a fix so that a bot banking spare tools keeps its
BEST pickaxe instead of its most worn one. The fleet today holds pickaxes at a median 1.7% durability
while the chests hold them at 48%. It was "built, tested, pushed" and left for a morning launch. Both
independent reviews said do not launch, for the same reason, and the sandbox server confirmed it:
**the fix moved the wrong inventory slots. On a real server it banked zero pickaxes while logging that
it had banked two, and the canary's own correctness gate could not have seen it.** Fixed, proven on the
sandbox, reviewed twice more, and deployed at **12:02:07Z** to placebo-a, placebo-b, board-d and board-c.

## 1. What was wrong, and how it was caught
| defect | how it was found | status |
|---|---|---|
| the keeper passed `bot.inventory` slot numbers (9-44) to a click on the OPEN CHEST window (player range 27-62) | Claude and Codex reviews, independently; sandbox proof | **fixed** in `4320136` |
| the only test of it was a text match that asserted the bug was present | Claude review | replaced by a behaviour test on a real chest window |
| no `evidence` class on the correctness gate, so under verdict.py v25 a wrong keep could only block KEEP, never revert | my reading of verdict.py | fixed |
| the correctness parse skipped `Infinity`, partial and truncated rows and read them as correct | leftover probes from last night + Codex | fixed; self-test on known-bad rows runs first |
| the dedupe compared `id()` across separate loads and never matched | both reviews | fixed |
| the registration described a pool draw nothing enforces | reading the canary loop | corrected in the registration |
| the branch was not descended from the fleet sha, so the deploy refused it | `fleet-deploy` | re-parented; code tree verified identical |

**The sandbox proof** (Paper, 10.0.0.30:25599, same stage both times, bot holding stone pickaxes with 1,
29 and 129 uses left):

    904cedb (last night)   log: keep=slot38 bank=slot37,slot39   "deposited 74 items"
                           chest: logs + cobblestone, ZERO pickaxes   bot: still holds all three
    e71e6a1 (today)        log: keep=slot56/129uses bank=slot55/1uses,slot57/31uses
                           chest: exactly the damage-130 and damage-100 pickaxes   bot: keeps the 129-use one

## 2. The canary
- **Reads:** +360 min at **18:02Z today**, correctness and liveness only. +1560 min at **2026-09-29
  14:02Z** is the verdict. Deadline 16:02Z tomorrow.
- **What can revert it:** only `bad_keeps > 0`, a deterministic check that every keep kept the fullest
  copy. Too little data, arms mixed up, or an unreadable row blocks KEEP instead. Harm gates are
  unchanged: two canary deaths and > 1.25x control, or gather below 0.43 of control.
- **What it cannot tell you:** whether bots end up holding better pickaxes. At this fleet size that
  effect is inside the noise, so it is reported with its null beside it and not gated. A KEEP here means
  the change does on the fleet what it did on the sandbox, and harmed nothing detectable.
- **Promotion is `none`.** A KEEP will be recorded and torn down. Promoting it will be a separate decision.

## 3. Found in passing: a bug that drops death records
While the sandbox bot reconnected, it crashed in the death handler. `index.mjs` reads `cause` five
lines before declaring it, so **any death after a fall of more than 3 blocks throws before the death is
recorded.** Live since 2026-09-17. On the fleet: 1 hit in 7 days across the 4 bots sampled. It is rare,
but the death gate counts deaths. It is queued as the next canary, not bundled into this one. A task
has been filed with the full brief.

## 4. Still waiting on you (unchanged)
The 24–27 Sep window restart, the v21 death-gate bound, the revert audit's 7 confirmed-false reverts,
the "OWNER DECISION" commits without artefacts, and whether to re-draw `vetob2-01` off the hive pools.
See STATE.md.
