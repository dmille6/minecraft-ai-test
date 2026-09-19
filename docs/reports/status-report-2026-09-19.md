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

---

## Afternoon: v23's acceptance suite, and the bug it found

Queue item 2. v23 itself has been live in the verdict path since `a67a387`; what was missing was the suite. Two
things came out of building it that matter more than the suite.

### The repo's `verdict.py` could not run at all
`scripts/singledeath.py` was never committed. `scripts/verdict.py` has therefore carried an unsatisfiable import
since v23 landed, with `scripts/test_singledeath.py` sitting beside it testing a module that was not there.
Yesterday's note that "the two `verdict.py` copies are reconciled" was true of the text and false of the thing
you can run — and it is only true of the text because the file that makes the repo copy executable was absent.
Committed, and the `sys.path` line now also takes the file's own directory.

### A NaN endpoint still reverted — the owner-01b incident, live in the code
`verdict.py` treated `None` as a missing endpoint and everything else as a value to compare. **A NaN is
neither.** Every comparison against NaN is False, so an `own_lines` entry reads "fails <= 0" and an
`on_fail: REVERT` endpoint **reverts on an arithmetic hole**.

That is exactly owner-01b: its draw took board-b and hive-a at a **0.0% immobile pre-share** — you cannot reduce
immobility from zero — so the primary ratio-DiD divided by zero and the read printed `+nan% FAIL`. Yesterday
that was written up as a *draw* problem and queued as item 8 (the non-degenerate pre-period check). **The
verdict-path half of it was missed and was still there this morning.**

Registered as **v24**, prospective: a registered own-line value that is `None`, NaN, `+inf` or `-inf` yields
UNREADABLE and names the value. This is a clarification rather than an amendment needing calibration — the
registered rule already said a missing own-line value is UNREADABLE, and a NaN is missing-ness arriving as a
float. It is prospective regardless, because no canary was live when it landed.

**It was found by a Codex pass, not by me, and the way it was found is the point:** the pass observed that my
own case for this incident used `None`, so it tested missing data rather than the incident it named.

### The suite, and what the mutants were for
Sixteen cases, each a replay of something on record, driving the **real** `verdict.py` through four environment
overrides production never sets — and passing equally against `~/verdict.py` on .31, which is the copy that
decides. A positive control runs first: a clean canary must reach KEEP, or a harness that could only say
UNREADABLE would pass most of the rest.

Eleven mutants, each restoring one rule to the way it behaved when it made a real mistake, each asserting its
anchor is present and unique, each applied to a **copy**. They earned their keep immediately — **two survived
the first run, and both were defects in my own cases**:

- `one canary death` was green **with no logs at all**. The linkage rules do not read the evidence objects;
  `verdict.py` rescans the pools' own logs since `declared_at`. So the case never reached the v23 branch and was
  really testing "one death and no rung rows keeps". It now writes the shape of 18 Sep 16:33-16:38Z.
- the registration-sha mutant survived **behind the manifest-binding check one line above it**. Two guards, one
  case. Split into the redeploy case — evidence that matches the live canary perfectly and describes a different
  registered build, which only the registration check catches. owner-01 and owner-01b shared a sha, so this is
  routine, not exotic.

Two Codex passes then folded ten more, most of the same shape — a case green for a reason other than the rule it
names. The **v19 rung-linkage branch was entirely unexercised** while the suite claimed "no single death reverts
by ANY path"; the 21x regression case passes a threshold quietly raised to 5; the fixture stated bot-hours twice
and disagreed with itself; only the stdout token was checked, so a stub printing the right word would have
passed. A kill now requires the **whole** baseline to pass, the case to **move**, and to land on the predicted
verdict. The runner refuses to score on a host where `/home/mike/mcai-analysis` exists, because `verdict.py` puts
that directory ahead of its own on `sys.path` and would silently shadow a mutated helper.

**Pinned and deliberately not fixed:** when control reports no rate, the gate assumes
`control_bot_h = canary_bot_h * 7` and reverts on 3 deaths against an **assumed** 0. A guess standing where a
measurement should be — the exact class of defect this project keeps finding — but changing a gate is an
amendment, and amendments are prospective and calibrated first. Queued. The case pins the current outcome (not
the multiplier: 3x or 8x would revert too) so the change cannot happen silently.

### And one more instrument reading a dead world
Syncing v23 to `~/digest/RULE.md` revealed the host copy was **last synced 18 Sep 11:27Z and predated v23** — the
analyst had been judging against a rule set missing the rule that is live. Syncing it then exposed a second
defect: `analyst.py` slices `rule[-20000:]` off a document that is now 93 KB, and after the sync that tail
reached back only as far as **v21**. v12, v14c, v15c, v16, v17, v18, v19 and v20 were simply not in the prompt.
Nothing reports this, and the window shrinks by itself every time a rule is registered.

Widening it back is not the fix — it was cut to 20 KB on 16 Sep precisely because the full document overflowed
the context and the analyst judged against a rule frozen on 09-13. So the tail is now a convenience and
`~/digest/RULES-IN-FORCE.md` is authoritative: one paragraph, synced beside RULE.md, naming every rule in force
and — which a tail can never express — which registered rules are **withdrawn**. v22 sits in the document and is
not in force.

**That is five instruments in two days found answering confidently about a world that no longer exists**, and
the shape has been identical every time: a field, a glob, a file or a window that was true when it was written
and is not updated when it stops being true.
