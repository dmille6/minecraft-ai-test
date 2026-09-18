# Concurrent canaries — design and blast radius (18 September 2026, 23:42 UTC)

**Owner approved the build 18 Sep.** Claude's review raised it as the only change on the table that moves throughput by a *multiple*: `CLAUDE.md`'s "One canary pool, ever" is justified by *"the tripper matches `canary_pool` literally; two canaries means three versions means a halted fleet"* — an **implementation limit, not a statistical one**. With 80 bots over 16 pools, 2–3 disjoint canaries can run at once.

**This design is written before the patch, and the patch is not written tonight.** It touches the mechanism that stops the fleet, across seven files and two classifiers that have already disagreed with each other once on a live fleet. Section 6 says why that wait is the right call.

## 1. What the tripper guarantees today

`canary_split_ok(seen, declared, canary_version, canary_pool)` in `/usr/local/bin/mcai-tripper` (repo: `infra/guard/death-tripper.py`), four invariants, every one earned from a live incident:

1. the manifest names the canary pool **and** its version, in advance;
2. **exactly two** distinct builds are running, no more;
3. every bot on the canary version is **in** the pool;
4. every bot in the pool is **on** the canary version.

Membership is exact **in both directions** — the comment says the fourth clause "is the one that matters and it is easy to leave out", because without it any split containing the canary version is excused, including a failed rollout that stranded four random bots on new code.

**The digest is never stripped.** `base` once compared bare shas, so a control that restarted onto canary source reported `16e7e77+71154f` and collapsed to a clean baseline sha. Observed 2026-08-30: board-d-Bravo ran canary code as a control for hours while this returned ok. Full strings are compared now, and that must survive the generalisation unchanged.

## 2. The generalisation

The manifest gains a list. Each entry is one canary: `{run_id, code_version, pool}`. The invariants become:

1. every declared canary names its pool **and** version in advance;
2. **exactly 1 + N** distinct builds are running — baseline plus one per declared canary — no more;
3. every bot on canary *i*'s version is in pool *i*;
4. every bot in pool *i* is on canary *i*'s version;
5. **NEW — pools are pairwise disjoint.** A bot in two pools has no defined correct version, and its control arm is another canary's treatment.
6. **NEW — canary versions are pairwise distinct.** Two canaries on the same sha are indistinguishable by version, so membership cannot be attributed and neither can a verdict. This is the same defect the `openloop` identity fix closed today, one layer down: owner-01 and owner-01b shared a sha and only differing pools saved the ledger.

Invariants 5 and 6 are the price of the feature, and both must **fail closed**: an undeclared overlap or a shared sha is a halt, not a warning. N is capped (**3**) so a mistake cannot declare the whole fleet a canary and switch the rule off entirely.

## 3. Blast radius — 7 files, 39 references, and two structural blockers

| file | refs | what assumes one canary |
|---|---:|---|
| `mcai-tripper` | 15 | `canary_split_ok` + `_classify_versions`; the "exactly two" rule |
| `openloop.py` | 11 | one `canary_sha` / one `canary_pool` per manifest |
| `canary-loop.sh` | 5 | **`flock` — one loop may ever run**; one `$RUN`, one read schedule |
| `mcai-canary-tree` | 2 | **one tree at `/srv/mcbots/harness-canary`**, one `canary.env` |
| `verdict.py` | 2 | reads the manifest's scalar pool |
| `drawrec.sh` | 2 | draws against one declared canary; exclusions assume one |
| `deploy-fleet.sh` | 2 | declares the split; the verifier expects two digests |

**Two structural blockers, not mere refactors:**

- **One canary tree.** `mcai-canary-tree` stages `$C=/srv/mcbots/harness-canary` and points the drop-ins at it. Two canaries on different shas need **per-run trees** (`harness-canary-<run_id>`) and per-run `canary.env`. The teardown path, the `CANARY_ENV` work done today, and the `node_modules` symlink all follow the tree.
- **One loop.** `canary-loop.sh` takes a `flock`, deliberately: it is what guarantees a single decision-maker. Concurrency needs either N loops with **per-run** locks (and a shared lock only around manifest mutation, which is the actual race) or one supervisor running N schedules. **Per-run locks with a manifest mutex is the smaller change** and keeps each run's journal independent.

There is also a **second classifier**: `scripts/lib/version_split.py` (`classify`, with `ALL_UNDECLARED`, `CANARY_OUTSIDE_POOL`, `POOL_NOT_CANARY`, `CONTAMINATION`) is the tested one, while `canary_split_ok` lives inline in the tripper. The tripper's own comments record that duplicating a rule across both **made the same state trip twice, once correctly and once as `("ALL", ...)` which would have stopped eighty bots to correct two.** Generalising one and not the other repeats exactly that. **Consolidate first, generalise second** — that ordering is not optional.

## 4. Migration, so nothing breaks at once

The manifest keeps the scalar keys **and** gains the list; readers prefer the list and fall back:

```
canaries: [ {run_id, code_version, pool}, ... ]     # new, authoritative when present
canary_pool: "board-b,hive-a"                        # kept: the single-canary case, mirrored
canary_code_version: "aa44514"                       # kept: ditto
```

While exactly one canary is declared, both shapes describe it and every existing reader keeps working unchanged. The scalars are written **only** when `len(canaries) == 1`, and are **cleared when N > 1** so a stale reader sees "no canary" rather than a plausible wrong one — failing closed, the convention `openloop.py` already documents. Retire the scalars only once every reader in §3 reads the list.

## 5. Order of work (est. 1.5–2 days, matching Claude's estimate)

1. **Consolidate the two classifiers** into `scripts/lib/version_split.py`; the tripper calls it. No behaviour change; the existing 12 cases must stay green. *(This is the risky half and it is separable — do it alone, prove it inert, ship it alone.)*
2. Generalise the consolidated classifier to N canaries + invariants 5 and 6, pure, with tests and mutants including **every** existing regression case re-expressed for N=1.
3. Per-run canary trees and per-run `canary.env`; teardown per run.
4. Per-run loop locks, manifest mutex.
5. `openloop`, `verdict`, `drawrec` read the list; draws must additionally refuse a pool already claimed by a live canary.
6. Two Codex passes on the applied diff, then a smaller patch, no third pass.
7. **Prove it inert first:** deploy with `canaries` holding exactly ONE entry and confirm the fleet behaves exactly as today — same tripper verdicts, same reads — before any second canary is declared.

## 6. Why the patch is not written tonight

It is 23:42 UTC. This change edits the thing that halts the fleet, and its failure mode is **silent**: a tripper that is too permissive does not alarm, it simply stops noticing an undeclared split — the exact fault it exists to catch, and the fault that ran board-d-Bravo on canary code as a control for hours before anyone saw it.

Today produced six instruments that could not fail. Writing a seventh at midnight, solo, into halt protection, would be the same mistake with a larger blast radius. The design above is the hard half and it is done; step 1 is separable and inert and is the right first commit of a fresh session.

**Nothing about this blocks tomorrow's queue:** items 1–3 (seed canary, v23 in the verdict path, navigation/gather) need only one canary slot each and can proceed while this is built.
