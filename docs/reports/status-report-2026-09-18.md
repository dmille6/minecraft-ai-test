# Status — 2026-09-18 (daily operator session)

_All times UTC. Clock from `date -u`._

## What happened before I arrived

The canary loop reverted **falls-01** at 04:39:10 and tore it down at 04:42:45, on its own,
correctly recording the decision. The ledger was clean, the manifest empty, one version live,
80 bots healthy. There was no open loop to close.

## The revert was a false positive, and it cost the instrument

falls-01 was a **report-only instrument**: it writes a `fall_path` row when a bot falls and
changes no behaviour. The death gate reverted it on two canary deaths.

Both deaths were **idle**, one drowning and one unknown cause, and **neither was a fall**. In
the same 2.4-hour window the **three control deaths were all idle drownings** — the identical
background mechanism the fleet has had for weeks. Denominators: canary 2 deaths in 23.9 bot-h
(0.084/bh), control 3 in 168 bot-h (0.018/bh). The point ratio is 4.7x, which cleared the
1.25x test; the one-sided 95% lower bound of that ratio is **0.58x**.

Positive control for the read: 321,773 rows, 80 bots, 111 row kinds over the 620-minute walk,
16 death rows within it.

## What the instrument found before it died

31 `fall_path` rows (placebo-a 19, placebo-b 12), all candidate injuries, **zero fall deaths**.

- **The liquid-dropdown hypothesis is dead.** `liqdrop=true` on all 31 rows, but the planner's
  landing cell is water on exactly **one**.
- **29 of 31 are the planner's own 4-5-block drops**, costing 1-2 hp. Damage-implied height is
  `damage + 3`; the `fell N` peak-to-here figure overstates, as corrected yesterday. These are
  policy (`maxDropDown` 6), not a defect.
- **One overshoot**: placebo-b-Comet 03:49:24, planned max 5.3, hp **-9** — about 12 blocks
  actually fallen. The body keeps momentum past the predicted block (pathfinder issue #31).
- **One genuine infinite-liquid dropdown**: placebo-b-Echo 03:14:22, planned max **49** with one
  drop beyond `mdd=6`, landing in water, costing 2 hp. The mechanism is real, rare, and harmless
  when the water is actually there.
- **The fatal 35-block class is still unmeasured.** It needs a fall *death*, and 2.4 hours on 10
  bots produced none. **A report-only instrument belongs fleet-wide, not in a canary** — that is
  now queued as falls-02.

## The instrument that reads the fleet was refusing every query

`Events.load()` — the library CLAUDE.md requires every telemetry query to go through — raised
`WalkTooWide` on **every call**, `since_minutes=30` included. The OOM guard summed the whole
glob before the window was applied, so 1124 rotated generations (0.44 GB on disk, counted at
25x) estimated 11.4 GB against 1.9 GB actually there. It crossed the cap between 04:39 and
11:10 today and will never recover on its own, because rotation only accumulates.

It took `fallread`, `deathread`, `canary-report` and `verdict.py`'s evidence objects with it.
The next canary's reads would have failed outright.

Fixed in c79d57b: one `predates_window()` shared by the estimate and the walk, one frozen glob
for both, a runtime decompressed-byte budget, `WalkTooWide` re-raised rather than swallowed,
and — the one that matters most here — **one bad line now costs a line instead of the rest of
the file**. Codex reproduced valid row / `[]` / valid row returning ONE row: a mid-file
exception reached the per-*file* handler and skipped to the next file. That is a short walk
that looks complete, which is this project's most expensive shape of bug.

16 behavioural cases, six mutants killed. Two of the tests were caught passing for the wrong
reason by their own mutants before they were trusted.

## Two rules changed, both prospective

**v21 — the death gate's 1.25x test now runs on the lower bound of the rate ratio.** The
owner's two-death floor is untouched. The gate is polled every five minutes for up to nine
hours — about 108 looks at an event whose null expectation over a whole canary is under one
death — so the point ratio clears 1.25x on ordinary Poisson noise. Calibrated before it was
allowed to decide anything:

| true canary harm | old gate | v21 |
|---|---|---|
| none | **43.7%** | **5.0%** |
| 2x | 81.4% | 22.5% |
| 3x | 95.0% | 51.1% |
| 5x | 99.9% | 88.6% |
| 10x (swim_to scale) | 100.0% | 99.9% |

The 43.7% is the positive control: it reproduces the 46% false-revert rate measured directly on
2026-09-13, which is what says the simulated process matches the fleet's. The cost is real and
stated — at a true 2x the gate now catches 22% where it caught 81% — but that 81% came with a
44% false-revert rate, a detection-to-false ratio of 1.9:1, which is barely a gate.

I considered and rejected excusing a canary death whose cause class also appears among control
deaths. It would have excused `swim_to`, which tripled drowning deaths while the control fleet
was also drowning. The defect is small-number arithmetic, so the fix belongs there.

**The analysis library is no longer the deploy tree's to own.** Every read does
`sys.path.insert(0, '/opt/minecraft-ai/scripts')`, but `/opt/minecraft-ai` is a deploy artefact:
`fleet-deploy` checks out the deployed sha and `deploy-fleet.sh` git-resets the same tree. So the
library silently becomes whatever version the last canary happened to carry — which is also why
the host was missing a fix the scripts branch had had since 16 Sep. I hit this live: deploying
owner-01 reverted the telemetry fix I had installed forty minutes earlier and would have broken
owner-01's own +30 read. The golden copy now lives in `~/mcai-analysis/lib/` and `fleet-deploy`
restores it after every deploy.

## Today's canary: owner-01 (aa44514), movement owner step 1

Deployed 11:25:22 on **hive-b,hive-c**, drawn at deploy, one pool per inference half. Suite
192/192. Pre-deploy change-row check passed: `escape_rung` and `safe_hold` are both silent on
the baseline.

Before deploying I amended its registration: `final_on_zero_exposure` **KEEP_ON_SAFETY ->
INCONCLUSIVE**, the same correction made to -13c. The exposure interlock says zero exposure is
never a KEEP, and KEEP_ON_SAFETY is the older rule it supersedes. Prospective; no read had been
taken.

Reads at 11:55, 12:55, 14:25, 17:25, extension 20:25 and 23:25, deadline 00:25 on 19 Sep. The
loop reads, decides, promotes or tears down on its own.

## What I deliberately did not do

- **I did not run the seed canary today.** It re-seeds two pools, and re-seeded pools would sit
  inside owner-01's difference-in-differences control arm for its whole run. It is next, after
  owner-01's verdict.
- **I did not re-run the falls instrument as a canary.** Its own harvest says a 10-bot pool
  cannot reach the events it exists to catch.
- **I did not wire in the `drawexposure` guard.** Still one refusal, one false positive, still
  uncalibrated. Harmless today: owner-01 declares no `draw_exposure`, so the draw fell back to
  the v8 filter.
