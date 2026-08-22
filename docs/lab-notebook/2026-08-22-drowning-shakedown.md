# 2026-08-22 — drowning rescue: the radius was the bug

## What I tried

Raised the shore scan from radius 10 to 24, ring-ordered with an exact stopping
rule; split the release into three outcomes; unified the two 20s deadlines into
one progress-sensitive ceiling capped at 45s; added a reentry counter.

Committed `7d1611b`, deployed to the 40-bot Block 2 fleet as run
`block2-shakedown-drown-01`.

## Expected

`_drowning_no_shore` collapses, escape rate rises from 18.5% toward the 50% gate.

## What happened

### The fleet was running three different vintages

Before any of this: `/opt/minecraft-ai` on 10.0.0.31 was **not a git repository**,
and the deployed tree was a blend.

| file | host vintage | missing |
|---|---|---|
| `reflex.mjs` | `d41b828` / `8938fb9` (current) | — |
| `index.mjs`  | pre-`fee480d` | the ArrayBuffer leak fix |
| `skills.mjs` | pre-`a9ba5cd` | the siting change |

All of it stamped `CODE_VERSION=d41b828`. That is failure modes #1 and #2 from
`deploy-fleet.sh`'s own header — the ones it was written to prevent — running
live and unnoticed, because `deploy-fleet.sh` was never the tool that put Block 2
there. `bootstrap-block2-bots.sh` copied a tree; nothing ever reconciled it.

The stamp was honest *for reflex.mjs*, which is the only reason the drowning
baseline below is attributable at all. Had the question been about `index.mjs`,
the label would have been evidence for a commit that was never running.

Fixed by making `/opt/minecraft-ai` a real checkout (backup at
`/root/opt-minecraft-ai-pre-git-20260822T200654Z.tgz`, 97M) and deploying through
`deploy-fleet.sh`. Fleet converged: 40/40 active, 0 failed, one `CODE_VERSION`.

### Baseline, last 6h on the blend (reflex.mjs at d41b828)

```
  5068  _drowning_up
  3856  _drowning_no_shore          <-- largest failure kind
  3152  _drowning_route
  2553  _drowning_released_timeout
  1620  _drowning_to_shore
   579  _drowning_escaped
   120  _drowning_to_air

  escape rate = 579 / (579+2553) = 18.5%   (gate needs >=50%)
```

`no_shore` at 3,856 is the whole argument for the radius change: it never meant
"there is no shore", only "none within ten blocks".

### First ~6 minutes on 7d1611b — NOT YET AN IMPROVEMENT

```
   104  _drowning_up
    74  _drowning_route
    71  _drowning_no_shore
    47  _drowning_reentry            <-- new
    44  _drowning_to_shore
    36  _drowning_surfaced_stranded  <-- new
    24  _drowning_released_timeout
    15  _drowning_to_air
    11  _drowning_escaped
```

Both new kinds fire, so the code path is live and wired — the thing GPT-5.5
caught as dead code is not dead.

But the numbers do not yet show the fix working, and it would be wrong to say
they do:

- escape rate on the comparable denominator is `11/(11+24+36)` = **15.5%**,
  against a baseline of 18.5%. Lower, not higher.
- `_drowning_no_shore` is running at ~710/hr against a baseline of ~643/hr.
  **The radius change has not visibly reduced it.**

Six minutes immediately after a 40-bot rolling restart is not a measurement —
every bot is re-pathing and the arms are not in steady state. But the honest
reading right now is "no effect demonstrated", not "too early to tell, but
looking good".

## Learned

1. **A version stamp is only as good as the deploy that wrote it.** The fleet
   carried one label across three vintages for days. `run-receipt.py` asks the
   server rather than the config precisely for this, and it would have caught it
   if it had been pointed at the harness tree instead of the world state.

2. **`_drowning_reentry` at 47 against 71 releases is the most interesting number
   here.** Releases are not holding. That counter exists to stop a reclassified
   outcome from passing as a fixed one, and on its first run it is already saying
   the releases are not real — regardless of which kind they are logged under.

3. **A budget-exhausted scan currently reports as `no_shore`.** `shoreRoute`
   returns `partial: true` with `dir: null`, and `drowningControls` cannot tell
   that from a completed scan that found nothing. If open water is hitting
   `SHORE_MAX_READS` (~5,430 reads for an all-water radius-24 sweep, against a
   6,000 cap — uncomfortably close), then `no_shore` is partly measuring the
   budget and not the world. **This is the first thing to check** before
   concluding the radius did not help.

## Next

- Let it run to a real window (hours, steady state) before judging.
- Separate `no_shore` into "scan completed, nothing there" vs "scan ran out of
  budget". They are different failures and are currently fused — the same mistake
  the three-way release just fixed one level up.
- `deploy-fleet.sh` hardcodes `"trial": "instance-1"` in the manifest; Block 2 is
  now declaring itself as instance 1.

---

## Result at 20:22 UTC — the fix works on the cases it can, and that is half the problem

Rates, not raw counts, because the windows differ by 30x:

| | baseline, 6.12h (245 bot-h) | after fix, 0.21h (8 bot-h) |
|---|---|---|
| releases / bot-hour | 13.05 | 12.81 |
| escape rate, all | 18.4% | 19.4% |
| **escape rate, winnable (excl. stranded)** | **18.4%** | **37.5%** |
| reentry | 0 (kind did not exist) | 74 |

**The budget hypothesis from this morning's entry is wrong.** An all-water
radius-24 sweep costs 5,376 reads against the 6,000 cap and returns
`partial: false`. `no_shore` is not measuring the budget. Ruled out offline in
one command rather than by staring at the fleet.

### Where the drowning actually is

`no_shore` events since the restart, by position: **81 of 88 at y=62-63** — the
water surface, not the depths — and **every one of them 1,200-1,600 blocks from
town**. Three bots produced 81 of the 88.

Median distance from town, for every bot with any drowning at all, in BOTH
windows: **1,100-1,600 blocks.** The one bot operating within 400 blocks of town
in the post-fix window escaped. In the baseline window, the nine bots within 400
blocks escaped at **48.1%** — against 10-20% for the far ones.

So drowning is not a fleet-wide rescue-capability failure. It is what happens to
bots that have walked 1,500 blocks from town into an ocean. `board-b-Comet` (23
routes, 100% stranded, median 1,238 blocks out) and `placebo-b-Delta` (22 routes,
21 stranded, 1,452 out) are marooned at sea. For them `surfaced_stranded` is the
CORRECT verdict: there is genuinely no shore. Radius 24, 48 or 480 changes
nothing when land is several hundred blocks away.

### What this means

1. **The reflex fix did what a reflex fix can.** On cases where a shore exists,
   escape roughly doubled, 18.4% -> 37.5%. Still under the 50% gate, and on 8
   bot-hours and 21 escapes, so this needs hours before it is a number worth
   quoting.

2. **It did not move the volume at all** (13.05 -> 12.81 releases/bot-hour) and
   barely moved the headline rate (18.4% -> 19.4%), because roughly half of all
   drowning is now correctly identified as unwinnable-at-sea. Splitting the
   outcome did not fix that; it revealed it.

3. **The remaining problem is a travel problem, not a water problem.** The
   question worth answering is not "why can't the reflex get them out" but "why
   are bots 1,500 blocks from town in an ocean". That is planner/admission
   territory, and it is where the arm asymmetry probably lives too: placebo and
   board dominate the far-travel drowning in both windows.

4. **reentry = 74 against 108 releases.** Concentrated in the stranded
   population, which is expected — a marooned bot is released, drowns, is
   released again. It is doing its job: it says plainly that these releases do
   not hold, whatever kind they are logged under.

### Still open

- Needs a multi-hour window before any of the above is more than a strong hint.
- `no_shore` still fuses "scan completed, nothing there" with nothing else now
  that the budget is ruled out — that is fine, but the event should carry the
  scan's `scanned` count so this is checkable from telemetry instead of by
  re-deriving it offline.
- `deploy-fleet.sh` hardcodes `"trial": "instance-1"`; Block 2 declares itself
  instance 1.

---

## The reframe: water is terrain, and the platform was built not to believe it

The lab owner pushed back on the whole framing: *"isnt the solution teaching them
to swim and travel in water? there is something across the ocean? isnt part of
minecraft swimming or traveling on or in water? why are we ignoring that?"*

He was right, and the assumption was written down in our own source:

> "The bots do not need to cross water; they need to stop volunteering for it."
> — `bots/src/index.mjs`

A correct patch for Block 1, where drowning was the top death cause. It hardened
into a platform-level decision: a wet step priced at ~86 against ~1 on land,
fifteen `cost > 100` guards deleting wet neighbours, zero occurrences of "boat"
in the entire agent source, and "swim" existing only as an emergency verb.

### What the evidence actually said

Chasing individual bots rather than aggregates:

| bot | observed | nearest land |
|---|---|---|
| `board-b-Comet` | (1544,425) -> (1556,473), ~50b, while logging 90 `no_shore` | 24b+ (genuinely open water) |
| `placebo-b-Delta` | (1728,335) -> (1852,334) | reached land unaided |
| `placebo-a-Echo` | moved to y=65 | reached land unaided |

All three at y~62.7, oxygen full, health 20. **They were swimming.** The reflex
held each at `forward:false, jump:true` waiting for a shore outside its scan
radius, released at the ceiling, re-seized on the next submersion.
`drowning_reentry` at 74/108 was measuring that livelock, not rescue quality.

### Result after shipping water competence (f43f49f, 7aee92e, a769e73)

| | before | after |
|---|---|---|
| escape rate, all | 18.4% | **23.1%** |
| escape rate, winnable | 18.4% | **85.7%** |
| `released_timeout` | 64 | **2** |
| `surfaced_stranded` | 112 | **38** |
| `reentry` | 128 | **39** |
| `no_shore` | 111 | **44** |

And the thing that matters most, a real crossing:

```
21:37:34 placebo-a-Delta _swim_started  | crossing 1378b to 355,147
21:37:35 placebo-a-Delta _drowning_yielded_to_swim | oxygen 20, health 20
21:39:22 placebo-a-Delta _swim_ended    | 429 strokes over 108s
21:40:37 placebo-a-Delta _swim_started  | crossing 1101b to 355,147
```

~277 blocks of open ocean closed, deliberately, toward town, with the reflex
standing down instead of fighting it.

### Learned

1. **An instruction the model cannot act on reads as a skill failure.** swim_to
   shipped telling the model to use it "when you are ALREADY IN WATER" — to a
   model whose observation never said which medium it was in. Then it shipped
   saying "swim to where you want to be" — to a bot that by definition does not
   know where land is. It answered with 0b and 1b "crossings". Both times the
   logs blamed the skill.

2. **Three detectors of mine returned uniform negatives and I nearly believed
   all three.** Unloaded chunks answer `"That position is not loaded"`, which
   `"passed" in resp` scores as False; a measurement window set two minutes in
   the future; and a `forceload` that had not finished loading. The fix each time
   was a control probe against a known-good block first.

3. **A mutation that does not mutate proves the opposite of what it looks like.**
   One "NOT CAUGHT" was a `.replace()` whose anchor was split across a template
   concatenation. Another was real: `SURFACE_MS = 0` passed a test that only
   asserted ordering. Check that the mutant actually changed the file.

### Next

- Boats. Deliberately held back: both models agreed a boat skill added before
  the reflex-ownership fix just gets interrupted by a "rescue" while it floats.
- `surfaced_stranded` at 38 and reentry at 39 are still the bots to chase.
- Longer window before any of these numbers is quotable — this is 8 minutes.
