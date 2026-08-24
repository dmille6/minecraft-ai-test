# Canary deploys, and two things that were never running

**2026-08-25.** No bot behaviour changed. `bots/src` is byte-identical
throughout.

## Why

The previous day cost roughly **80 bot-hours** of degraded fleet across six
fleet-wide deploys and two reverts. Two of those changes looked correct, passed
a full suite, and one was validated offline against a recorded packet trace
before it shipped. Neither was catchable by inspection; both were obvious within
twenty minutes of telemetry.

Eight independent pools already exist in eight identical worlds. Sending a
change to one of them costs under two bot-hours to be wrong — about **47×**
cheaper — and gives a control running the *same minutes*, which is the part that
matters most: every comparison made yesterday was against a baseline measured
hours earlier on a differently-settled fleet after a different number of
restarts.

```
scripts/deploy-fleet.sh <sha> <run> [notes] --pool hive-a
scripts/canary-report.py --pool hive-a --minutes 20
```

## The tripper had to learn it first

The disagreement rule exists to catch half a fleet quietly on old code, and it
tolerated a split only while a declaration was fresh — a rolling restart is over
in a minute, a canary runs for hours.

`canary_split_ok` accepts a split only when the manifest named the pool and the
version **in advance**, exactly two versions are running, and membership matches
in **both directions**: nobody outside the pool on the canary version, nobody
inside it left behind on the baseline. The second direction is the one that is
easy to omit and the one that matters — without it, a canary declaration would
excuse a failed rollout that stranded four random bots on new code.

A canary whose membership does not check out is *also* still undeclared code.
One bad declaration must not open two holes.

## Episodes, not events

`canary-report.py` counts contiguous episodes of water trouble, not transitions.
Yesterday two water changes were judged on event rates, `drowning_reentry` read
4.9× baseline, and both were reverted. A truthful sensor produces more
transitions per incident *by construction*, so a rise in transition counts can
be the same incidents logged in more detail. 34,190 drowning events could be
34,190 small observations or 500 long traps, and a count cannot tell you which.

Gates are declared in the file, before the change: land-release rate, re-entry
gap, reflex-owned share of exposure, harvest retained against the concurrent
control, deaths.

Its tests are the two shapes that misled me — a change that **triples** event
volume while reaching land more often must pass; one that quietly **halves** the
harvest must fail. Ten mutations, ten caught, including a fixture bug where
exposure was derived from event density. That is the same confound the script
exists to prevent, reproduced inside its own test.

## Two things that were never running

**The deploy verifier has been blind for the whole of Block 2.** It read
`/srv/mcbots/logs/skill-*.jsonl` — instance #1's layout. Block 2 writes to
`LOG_DIR` from each env file. The glob matched nothing, so every deploy printed
`40 bot(s) have not logged since the restart yet` and exited 2. I read past that
line six times in one day because I was checking convergence by hand afterwards.
Same stale path that had `fleet-status` printing `?` in its MOVED column for
forty bots.

**The death tripper is installed but not scheduled.** No timer, no cron, no
journal entries on the Block 2 host — `journalctl -t mcai-tripper` is empty. It
runs only when `deploy-fleet.sh` invokes it at the end, in dry-run. The safety
net that stops the fleet on a death spiral or a partial deploy has never been
armed here.

Deliberately **not** fixed in this pass. Arming a supervisor that has never run
against this fleet, on rules tuned for an eight-bot instance, risks halting forty
bots on a threshold nobody has checked against Block 2's actual rates. That is a
decision to make on purpose, with the thresholds reviewed, not a box to tick
while doing something else.

## A gotcha worth writing down

`deploy-fleet.sh` git-resets the repository — including itself — as its first
action. A change to the deploy script therefore takes effect on the **next**
invocation, not the current one. The first canary attempt silently ran the old
script, which does not know `--pool`, and deployed to all forty bots. Harmless
here only because `bots/src` was unchanged.
