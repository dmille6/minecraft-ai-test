# Status — 2026-09-19 (daily operator session)
_written 2026-09-19 11:30 UTC; every clock label from `date -u` on this Mac_

## Where the day started
No open loop. `check-open-loop.py` said "no open canary", the manifest's `canary_pool` was null, no canary loop was
running, and the journal ended cleanly at owner-01b's teardown (16:42:21Z on 18 Sep). Fleet: **80 bots, one version
`b1659c0+ab74e7`, 3 deaths in the 2-h digest window (0.019/bot-h), 3 immobile.** Nothing from overnight contradicted
STATE.md. Step A of the daily task had nothing to close.

One thing did happen overnight, and it was an instrument, not the fleet — see "The analyst paged six times at a free
slot" below.

## Done today

### 1. The seed canary is fully deployed — both pools, and the 72-h windows clear 24 Sep
**Pool one (placebo-a) was verified before pool two started**, which is the owner's protocol and the reason the check
existed. At +11 h: 5/5 bots alive, 24,165 rows, all five ranging x[72,478] y[25,85] z[-279,29] around the new town at
249,-144, and **1 death in 55 bot-h (0.018/bot-h) against the fleet's 19 in 880 (0.022/bot-h)** — at or below fleet.
Positive control for that walk, stated because every number above is a comparison against it: 343,216 rows, 80 bots,
110 distinct event kinds.

**Pool two (placebo-b) is live at 11:25:23Z**, `level-seed=7843072457371465157`, town at 282,65,-388, 5/5 confirmed
in-world by RCON. Draw exclusion stamped to 2026-09-22T11:25:23Z. Pool one's window closes 22 Sep 00:00Z and pool
two's 22 Sep 11:25Z — **both clear of the 24-27 Sep program read**, which is what made today's timing load-bearing.

It took two seeds, and the reason is registered rather than filed as an ops annoyance. See section 4.

### 2. The program's own stock number was not the program's stock number
The reliability program commits to **items/bot-h returned to stock, ≥20 at two weeks and ≥30 at six**. `programread.py`
— the nightly job built on 18 Sep precisely because this metric had no standing read — reported a **deposit success
rate**. A percentage cannot be compared to an items/bot-h gate in either direction, so the line that judges the
program on 27 Sep was unreadable. Fixed today, five days before the window opens.

The quantity is the negative side of `inventory_delta` on a deposit row: what left the bot and went into a chest. Two
things that gets right which counting `status == success` does not:

- **A row that ends `failed` or `no_effect` can still have moved items.** Measured over 24 h: **755 items on 138
  `failed` rows** (the chest filled mid-transfer) and **398 on 136 `no_effect` rows** — 1,153 units, **10.8% of the
  total**, demonstrably in a chest and silently discarded by a success-only count.
- **The row's own prose undercounts.** `detail` says "deposited N items" for the named item only. It disagreed with the
  delta on **222 of 397 successes**: "deposited 1 items" for `{iron_ingot: -1, stone_pickaxe: -1}`.

**The number, said with its denominator: 10,421 items net into chests over 1,920 bot-h = 5.43/bot-h, against a ≥20
two-week gate.** It fails by a factor of 3.7. The composition is printed beside it because it changes what the number
means: **cobblestone 6,077, oak_log 1,297, dirt 837** — 58% cobblestone, 8% dirt. The old deposit percentage is kept
on its own line, relabelled an OUTCOME RATE and explicitly not the program's stock number.

Not claimed: that stock returned has fallen. The 12-14 Sep report quotes "14.7 of ~70 items per bot-hour", but that
figure was derived differently and I have not re-derived it under today's definition. Gross items/bot-h has fallen
over the same period, so part of any gap is that. Comparing them would be the error this whole section is about.

### 3. Throughput now has a standing read — and it says the opposite of the complaint
Queue item 10, one line in the nightly job, from the decisions ledger (the only record that a canary was *closed*
rather than merely analysed):

```
throughput    51 decisions in 14 d = 3.64/day; of these 35 are results (KEEP 14, REVERT 21) = 2.50/day,
              and 16 INCONCLUSIVE (a close, not a result)
              last 7 d: 27 decisions = 3.86/day, 20 results = 2.86/day (KEEP 6, REVERT 14, INCONCLUSIVE 7)
```

The 7-day figure sits beside the 14-day on purpose: a fortnight average hides a slowdown, and the ledger really did
run 13 decisions on 09-11 against 2-4/day since. **"Two canaries, zero results" is a statement about yesterday, not
about the fortnight.** What the line does expose is the shape of the output: **14 REVERTs against 6 KEEPs in seven
days**, and several of those reverts were the harness's own instrument rather than the change — falls-01 (report-only,
reverted on two background drownings), owner-01b (reverted on a row every rung of which was `refused` or
`preempted blocks=0`), -13 and -13b (UNREADABLE). That ratio is the throughput problem, and until today nothing
printed it. Both refusal branches (ledger absent, ledger empty) were exercised, not asserted.

### 4. A random seed can have no town, and that left five bots down
Pool two's first draw, `2308430494737375791`, was rejected at **every** candidate on place-town.py's spiral —
"platform relief 43 > 3", "centre is water", "24% of columns within 32 are water", "water inside the platform at 6,0".
The script stopped exactly there, correctly refusing to replay a placement (place-town refuses a second stamp), and
left placebo-b with its five bots stopped, its state archived and a reseeded, townless world. Recovery was hand work.

`scripts/reseed-pool.sh` now has a guarded `--new-seed` that does it in one command. **Four refusals, each seen to
fire:** no `--go`; nothing journaled — and the journal it would complain about is no longer created first, because the
guard was moved ahead of `mark seed`; the pool already re-seeded and running; the original world not archived under
this run's timestamp. The fifth (a town IS placed) was verified at its predicate against placebo-b rather than
end-to-end, because end-to-end means aiming a destructive path at a live pool. The timestamp is deliberately not
redrawn on a retry: every archive is named for it.

**The part that matters is the amendment, and it is prospective.** The seed canary's treatment population is not
"random seeds". It is **random seeds on which the standard town sites** — flat, dry, low relief. That filter removes
exactly the mountainous and flooded terrain a terrain experiment would most want in its sample, it removes it
*silently* (a rejected seed leaves no trace in the read), and **1 of the 2 seeds drawn today hit it**; pool one's own
log records 47 candidates rejected before one was accepted. So a null result at 72 h is weaker than it looks: one
live explanation would be that the siting filter made all sixteen worlds locally similar where the bots actually
stand. Rejected seeds are journaled now instead of vanishing. The siting criteria were **not** relaxed — changing them
between the two pools would put a second variable in a two-pool experiment.

### 5. The analyst paged six times overnight at a free canary slot
Of the twelve tier-1 verdicts between 05:30Z and 11:00Z, **six carried `page_claude: true`**, all of them about
owner-01b — a canary torn down at 16:42Z the previous afternoon. The 11:00Z one is representative: *"Stall/Loop
Failure: the canary passed its deadline (+780 min) but no verdict read is present... the loop reports 'no open canary'
while the manifest declares an active run."*

It is a manifest-shape bug with two doors, and both are now shut:

- **The digest header.** The three-step teardown clears `canary_pool` and `canary_code_version` but **not** `run_id` or
  `declared_at`. `nightwatch.sh` printed those unconditionally with an elapsed clock, so the header named a dead run
  and a `+1315 min` that reads as a live deadline — three lines above its own "no open canary". The header now
  distinguishes a LIVE CANARY from history, and says in the closed case that no deadline is running and no read is
  due. Both branches exercised; the live branch reproduces the old line exactly, so nothing is lost when a canary
  really is running.
- **The read glob.** `analyst.py` was fixed on 18 Sep to scope "latest canary reads" to the manifest's `run_id`, after
  it spent two days serving reads from finished trials. The same defect came straight back through the other door: a
  closed canary keeps its `run_id`, so the glob happily served **owner-01b's nine reads** under that heading beside a
  header saying the slot was free. **`run_id` does not mean a canary is live; `canary_pool` does.** Six branches
  exercised — positive control first (a live canary with reads on disk really does find them, or every "shows nothing"
  below it would pass for the wrong reason), then closed-with-reads, empty string, whitespace-only pool, live-without-
  reads, and an unreadable manifest, which fails closed. A **behavioural mutant** against the pre-fix copy served 2
  reads from the closed run, so the test is not passing by accident.

It remains SHADOW — it never decides — so this was noise, not risk. But it is the fourth instrument in two days found
answering confidently about a world that no longer exists, and the shape is always the same: **a field that was true
when it was written and is not cleared when it stops being true.**

## An error I made, and what it generalises
I edited `scripts/reseed-pool.sh` **while the reseed was running from it**, and bash re-read the file at the old byte
offset. The town for pool two had just been placed and journaled; the next line the shell read was fragment, and the
run died with `line 133: now: command not found`. Nothing was lost — the script is resumable by design and the resume
completed the remaining stages — but it cost a restart and it was entirely self-inflicted.

CLAUDE.md warns about exactly this, for `deploy-fleet.sh`: *"run the deploy script from a copy outside the repo — it
`git reset`s the tree it lives in, and bash re-reads a running script by byte offset."* I read the rule as being about
the deploy script. **The byte-offset half of it is about any long-running shell script edited in place**, and
`reseed-pool.sh` — minutes long, run from the worktree, and the thing I was actively improving — is the same trap. The
repo rule should say so; the mechanical version is to run these from a copy, the same as the deploy script.

## Fleet at the close
80 bots, **one version `b1659c0+ab74e7`**, no code canary, ledger clear. Two pools re-seeded and excluded from the
draw until 22 Sep. Ten pools remain eligible for a code canary.

## The number that is not moving
Gather success read **19.0%** today against a **≥40% two-week gate** (6,298 of 33,104 terminal; unreachable 10,502,
no_safe_target 8,175, no_path 4,848). It was 19.5% yesterday and 20.3% on 18 Sep. Navigation is queue item 3, promoted
there by both review engines on the arithmetic that a 10-bot 6-h canary sees ~455 navigation-class events against
drowning's ~12. **No canary ran against it today** — the day went to the seed canary's window, which was
time-critical, and to three instruments that would have misreported the 24-27 Sep read. That is the honest accounting:
the metric that is failing is still untouched, and it is first in the queue that is not blocked.
