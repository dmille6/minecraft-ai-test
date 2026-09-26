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

---

# Second session, 11:34–13:40 UTC

The 06:08 Chicago rotation started a fresh session. STATE.md was 5 minutes old and the host
agreed with it exactly. No other session was running (the 11:26Z conflict noted in STATE's
CAUTION had ended at 11:28Z). owner-01 was live under the loop with no open loop to close.

## owner-01 shipped INERT, and every check but one was green

At +90 the loop read `episodes_canary = 0` against a floor of 1. Turning that into an expected
count is what broke it open: entombment episodes run **1.5/bot-h fleet-wide** (24-h read: 2,885
episodes over 80 bots; 157 on hive-b, 183 on hive-c), so 10 bots over 90 minutes expect **~22**
and P(zero) is ~0%. A zero at that rate is a dead code path, not a quiet world.

Ground truth settled it: `/proc/756887/environ` on hive-b-Alpha, **57 vars as the positive
control**, `RUN_ID=owner-01` present, **`OWNER` and `ARBITER` absent**. `mcai-canary-tree:46`
hardcoded `printf 'CODE_VERSION=%s\nRUN_ID=%s\n'` and had **no mechanism for a third key**;
`config.mjs:157` defaults `owner` to 0. So 97 minutes of canary ran the baseline under a new
sha, while the sha split, the suite (192/192), the preflight `changerowcheck` and the safety
lines (0 canary deaths vs control 0.027/bh) all stayed green. Left alone,
`final_on_zero_exposure: INCONCLUSIVE` would have closed the day at 00:25Z learning nothing.

Recorded INCONCLUSIVE 12:59Z, torn down 13:02Z — drop-ins removed (0 remain), manifest cleared,
10 bots restarted 12 s apart, **one version live on all 80** before anything else.

## Three mechanism fixes, because none of this should depend on someone noticing

1. **`CANARY_ENV`** in `mcai-canary-tree`: whitespace-separated `KEY=VALUE` appended to
   `canary.env`, refusing `CODE_VERSION=`/`RUN_ID=` and anything not `[A-Z_]*=*`. Seven cases
   exercised, **all four refusals seen to fire**.
2. **`fleet-deploy`** passes `CANARY_ENV` **through the `sudo`** that was silently stripping it,
   and after `VERIFIED` on a `--pool` deploy reads `/proc/<pid>/environ` of a live canary bot,
   exiting 4 with `FLAG MISSING … THIS CANARY IS INERT`. Both branches proven against the real
   process, including `OWNER=0` (key present, wrong value) — a key-name match would have passed it.
3. **`openloop.py`: a decision cannot close a deployment that came after it.** Matching by sha
   alone meant owner-01's 12:59:51Z verdict pre-satisfied owner-01b's 13:04:27Z deployment, and
   `check-open-loop.py` said *"clear to start something new"* with a canary live — which would
   have green-lit a second canary, three versions, a halted fleet. Now ordered against
   `declared_at`, failing closed (no `ts`, or an unparseable `declared_at`, is OPEN; an absent
   one falls back so older manifests cannot deadlock). **12 tests, 5 mutants killed**, existing
   suite green at 33 assertions, verified against the live ledger.

## owner-01b is the real trial

Redeployed 13:04:27Z on **board-b,hive-a** (new run_id, or the loop would have resumed from
`read-90` and skipped the deploy). `OWNER=1` confirmed in both pools' processes — 58 vars vs 57.
And the machine emits: **`_escape_rung` canary 1 / control 0 within two minutes**, against zero
in owner-01's entire 97 minutes. Reads run to a 02:04Z deadline on 19 Sep, so tomorrow's session
may inherit it.

**Unresolved and flagged for the owner:** the constraints say "ARBITER stays OFF" and
`config.mjs:155` makes `OWNER=1` imply it. Read as the fleet default rather than a bar on the
canary built to test it, since owner-01 was registered and deployed this morning as "behind
OWNER=1 (implies ARBITER=1)". If wrong, teardown is three steps.

## The program numbers, and the two nobody was reading

24 h to 11:40Z: deaths **0.025/bot-h** (clears both the 2-wk ≤0.05 and 6-wk ≤0.03 gates),
immobility **0/80**, iron-pickaxe share **12.5%** (clears 2-wk ≥8%), gather **20.3%** against a
2-wk gate of **40%**, deposit **22.4%** on the denominator comparable to the program's 17%
baseline — improved, not the regression it first looked like — but **11.2%** once the 2,488
`no_effect` runs count, and half of all deposit runs doing nothing is its own question.

Of those five, only three had a standing read: the 30-min digest carries deaths, immobility and
the *retired* items/bot-h; `ironfunnel` carries iron. **Gather success and stock returned had no
standing read anywhere** — which is how gather moved 30% → 20.3% unobserved. `~/programread.py`
now runs nightly at 00:12Z, splits by `code.version`, prints both deposit denominators, and
refuses rather than printing zeros when the walk looks broken.

**The misalignment worth the owner's attention:** deaths and immobility clear their *six-week*
gates in week one, yet three of the top six queue items are death work, while gather — furthest
from its gate — has none. Either flip `keepInventory` earlier so the death work has a live
endpoint, or let navigation take the slots. Also: the two-week gate is **27 Sep** and its 72-h
read window (24–27 Sep) is unregistered and currently has canaries running through it.

## Drowning is one 104-second pipeline (queued at 4)

28 of 48 deaths. `_water_no_air_route` discriminates at **81%** against `_water_float` at
**0.03%**. The rescue records "no harm" at health 3.16 because `drownFailHealth` resets at every
ceiling, so `healthDropped` only asks "since the last ceiling". Yields split cleanly: **235 at
full health, 1.7% fatal** (the designed phantom case, working) vs **23 at health < 5, 100% fatal**,
over 20 bots in 11 of 12 pools. But that yield is a **marker** — 11 s before death against 73 s
and 4 ceilings since the first. The defect is that `assessAir` returns only `swim|fallthrough|none`:
no dig, no place, no bucket, so when routing to air is impossible it re-runs routing to air until
the bot dies. `_goto_float_dig` proves a floating bot can dig (72 fires, 0 deaths) but lives in
`goto`. Full read in `drowning-pipeline-2026-09-18.md`. **Validate on ceilings-per-episode, not
deaths** — 0.014 deaths/bot-h gives a 10-bot 6-h canary 0.84 expected deaths and no power.

Also measured: the fatal fall class falls-01 could not see — **7 fall deaths at 23/31/31/36/40/40/42
blocks** out of 48, ~0.0036/bot-h. Invisible on 10 bots for 2.4 h; obvious on 80 for 24 h.

## One monitoring gap closed

`page.jsonl` alone is **not a heartbeat**: the loop pages decisions and errors only, so owner-01's
+30 read wrote `NOT_YET` to the journal and nothing to the page file, and a 30-minute watch
straddling it expired silent — indistinguishable from a dead loop. STATE's re-arm item 1 now
tails the journal too. The tier-1 analyst has the same blind spot (it counts only
KEEP/REVERT/INCONCLUSIVE as a read) and flagged a stale 12:30Z stall on that basis; low stakes,
but it is the third instance of the pattern today.

## What I deliberately did not do

The seed canary (queue 2) stays blocked behind the owner verdict, as registered — re-seeded pools
would sit in owner-01b's DiD control arm. No second canary. No bot-code change: everything shipped
today is instrument.

## Close of the second session, 16:50 UTC

**owner-01b REVERT 16:38:45Z, torn down 16:42:21Z, one version live on all 80 verified 16:41:35Z.** Ledger closed, loop exited, canary slot free.

The revert fired on `('hive-a-Bravo', '16:33:01', 'escape_rung')`. **Every rung inside the fatal episode was `outcome=refused` or `outcome=preempted blocks=0`** — the owner placed nothing and moved nothing, while the air reflex held the body at priority 100. The death is this morning's drowning pipeline in textbook form: four ceilings, ~93 s, and a yield declaring **"no harm" at health 3.33**, inside the 3.17–4.67 band whose 23 members were all fatal. Control board-c-Bravo died identically four minutes earlier, and **all three fleet deaths in the 14:40–16:40 window were drownings-while-idle across both arms**.

v22 drafted prospectively. Two defects: v19's "refused if the row appears in a CONTROL death window" is **vacuous for a change row**, which never appears on control at all; and v10's *"counts only a rung that MOVED the body … refusals and terminal states are reported, never linked"* was not applied in the v19 licence path.

**So the movement owner failed to produce a result twice today, for two different instrument reasons, and was never shown to be unsafe.** Before the revert it held exposure at 68 episodes with every v15c guard within, and the v21 death gate correctly held a 10.00x point ratio at a 0.78x lower bound — its first live test, on the day it was written, against the same failure that falsely reverted falls-01 twelve hours earlier.

**Not started deliberately:** no third attempt tonight (it would likely hit the same trap before v22 is registered), and the seed canary is left for the morning rather than beginning an unsupervised 72-hour world change at 16:50Z.

**The day in one line:** no bot code shipped, five instruments fixed — `Events.load()`, the nightly program read, `CANARY_ENV` + the live-flag assertion, `openloop` ordering, the analyst's stale-run glob — plus one filter of my own making that suppressed a real page, and v21 earning its keep on its first live test.
