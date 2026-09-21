# Status — Monday 21 September 2026 (daily operator session)

_Session opened 11:08 UTC, closed ~12:10 UTC. Fleet `cfc1c58+e1d1b2`, 80 bots, one version.
No canary was deployed today and the slot was free the whole session._

## What the day produced, stated plainly

**No code shipped today.** What shipped is two corrections, and one of them stopped a canary that
was about to be built on a claim that does not hold. That is a legitimate close under CLAUDE.md's
"every negative claim carries a positive control", but it is not progress on the endpoint, and the
queue is one day older. Naming that rather than dressing it up.

The day's full read is **`starvation-corrections-2026-09-21.md`**.

## START checks — what the host said vs what STATE.md expected

STATE.md had diverged again: the repo copy (11:00Z today) was newer than the docs-worktree copy
(20 Sep 12:20Z), because the overnight session wrote only the repo copy, on branch `veto-feedback`,
and left the lower half of that file stale. Took the later stamp, as the file's own rule says.

Everything the overnight session claimed about the fleet checked out:

| check | result |
|---|---|
| `check-open-loop.py` | "no open canary — clear to start something new" |
| manifest | `canary_pool` empty, `declared_code_version` cfc1c58, run_id `needsdrop-01-reverted` |
| canary loop | none (anchored `pgrep -af "canary-loop[.]sh"` — the naive pattern self-matches) |
| ledger `/var/log/mcai/_canary-decisions.jsonl` | 56 decisions; **needsdrop-01 REVERT recorded 10:28:16Z** |
| versions live | **one version on all 80 bots** (`cfc1c58+e1d1b2`), 30-min telemetry census |
| analysis library | 19,249 rows / 80 bots over 30 min — survived the teardown |
| `canarywatch` / `stuckwatch` | both healthy; 5 bots pinned ≥ 4 h (operations alarm, not a mechanism) |
| RULE.md / RULES-IN-FORCE.md | both md5-match their sources; no rule changed today |

**One real gap found:** needsdrop-01's REVERT is in the ledger but in **neither** `~/canary-journal.jsonl`
**nor** `~/digest/page.jsonl`. The overnight session read it by hand with a detached script, and only the
ledger write sits on that path. The journal is not a complete record of decisions; the ledger is. Recorded
in STATE.md's re-arm list, because the re-arm text tells the next session to treat the journal as the
heartbeat.

## Two pieces of apparatus left armed after their canary died — both cleared

1. **`run-needsdrop-reads.sh` was still running at 11:12Z**, with reads queued for 13:24Z and 16:24Z, against
   a canary reverted at 10:28Z and torn down at 10:39Z. It would have appended confident-looking readings of
   a fleet with no canary in it to `~/digest/needsdrop-01-reads.txt`. Killed.
2. **`~/MANUAL-READS-UNTIL` still held `2026-09-21T18:30:00Z`.** That stamp is what lets `fleet-deploy --pool`
   proceed without a live reader — the guard built last night precisely because a hand deploy had left
   digwatch-02 unread for 15 fleet-hours. Left behind after teardown, it is a loaded gun: the next `--pool`
   deploy today would have passed the reader check while having no reader. Moved to
   `~/MANUAL-READS-UNTIL.expired-2026-09-21`.

Both belong in teardown and are now queue items 18 and 19. This is the "instruments outlive their world"
pattern for the third time this week.

## Correction 1 — the change the handoff called "THE NEXT CHANGE" covers 1.5% of its population

The overnight handoff argued that a `watchDigging` cancel at `skills.mjs:1195` *proves* the equip three lines
above failed, so the first step is to stop swallowing its error. The code refutes the premise without needing
data: `bestTool` → `applyToolPolicy` → `toolFor`, and `toolFor` filters on `remaining(it) > HARD_STOP` with
`HARD_STOP = 1`. A pickaxe at 130/131 used has `remaining == 1`, so nothing is eligible, stone is not
hand-harvestable, `toolFor` returns `{item: null, reason: 'none'}` — **and `if (tool)` never fires.**

Measured, denominator **327** watchDigging collisions over a 360-minute walk, against the nearest tools
snapshot (median gap 1.0 s):

- **321 (98.2%)** — every pickaxe at remaining ≤ 1, so **the equip was never reached**
- **5 (1.5%)** — a swingable pickaxe existed; these are a real and different bug
- 1 — no snapshot

An instrument on that line would have seen 5 events of 327. `digwatch-01` was closed INCONCLUSIVE nine days
ago for being blind in exactly this way.

**"The remedy was in the bot's pocket" is now retired in both its forms** — corrected once overnight (the
claim never read durability) and again today (the line that would use a remedy is not on the path). The
mechanism is three correct policies composing, and the asymmetry that makes it a bug is that `FLOOR` has an
escape hatch (`reserved_required`) while `HARD_STOP` has none. **Raising `HARD_STOP` is still not the fix**:
261 dead stubs × 1 use = 261 blocks, once, fleet-wide.

Fleet tool state, denominator 80 bots: **18 can mine, 62 hold only dead stubs, 0 hold no pickaxe.**

## Correction 2 — "wood at 10%" is oak only; the fleet gathers at 23.1%

My first attempt to reproduce the overnight wood number matched substrings in `skill.detail` and returned
**0.0% success for every target**. A per-target success column that is uniform is a blind detector, not a
result — I caught it on the uniformity, not on the number. The outcome is a field: `skill.status` /
`skill.fail_class`. Corrected, denominator 8,791 gather runs / 360 min / 80 bots:

`oak_log` **12.1%** of 3,483 · dirt 55.6% · sand 14.0% · iron_ore 0.9% · cobblestone 10.9% · stone 19.9% ·
**birch_log 34.9% of 83** · oak_sapling 0.0% of 60 · **ALL TARGETS 23.1%**.

- **The overnight session's central claim replicates**: starvation is downstream, not causal — wood success
  12.4% on starved bots (2,767 runs) vs 13.5% on healthy (800).
- **`oak_log` is 39.5% of every gather the fleet makes and is among its worst woods.**
- Oak's largest failure class is `no_safe_target` (1,244 of 3,483) and its text names liquid. **This is direct
  support for queue item 3's hypothesis that the bots flood their own surroundings** — and it is the component
  the seed canary's fresh terrain cut by 69%.
- **The oak/birch gap is a hypothesis, not a finding.** The within-bot control is **n = 1**. Registered as
  such rather than scored.

## A refusal that names an unreachable remedy — real, and measurably inert

Of 396 stone-pickaxe craft refusals naming a gather target, **245 send the bot for `cobbled_deepslate`**
(below y≈0 only) and 74 for `bamboo` (jungle only), while only 23 name `cobblestone`. **Median bot y at the
refusal is 68; 2 of 396 are below y=0.** The check is not wrong — 0 of 396 held the material and were refused
anyway — so this is advice, and the advice names a remedy the bot cannot perform from where it is.

**And it is inert: zero gather runs fleet-wide target `cobbled_deepslate`**, with the same query resolving
targets for 12 other blocks in the window. Fixing it is therefore predicted null and **must not take the
canary slot.** Its deterministic form is the missing `craft → gather` edge already on record.

## Seed canary

`placebo-b +48 h` was taken today at 11:26Z by the detached reader scheduled overnight
(`~/digest/seed-placebo-b-48h.txt`). Both **+72 h** reads — the registered discriminators — are scheduled
detached on the host (`run-seed-72h.sh`, pid verified alive) for 22 Sep 00:00Z and 11:25Z, clear of the
24–27 Sep program window.

**A rival nobody has ruled out, and today's tool census sharpens it:** a reseed resets bot state, which
includes handing bots working tools. With 62 of 80 bots fleet-wide holding only dead pickaxe stubs, the
re-seeded pools may simply be the bots with live pickaxes. This bears directly on the week's biggest number
(+29 to +32 pp) and is cheap to check — `equipblind.py` prints tool state by pool. **Added to the +72 h read.**

## What the next session should pick up

1. **Queue item 3 (navigation / gather) is the next canary** and today's read strengthens it: `no_safe_target`
   is 1,759 of 6,265 gather failures fleet-wide, its text names liquid, and fresh terrain cut it 69%. It needs
   the registered dual review (Claude + ChatGPT + an open-source search) **before** a build is proposed.
2. **Queue item 4 is dead twice over** — do not revive "the watchDigging equip remedy" as a standalone change.
3. **Queue item 7 (`falls-02`) is the cheapest thing on the board** — behaviour-inert, needs no canary slot.
   Take it when a session has a spare hour it can watch to completion.
4. **Confirm the 24–27 Sep program read window is registered before 24 Sep.** A draft exists in the repo tree;
   it was flagged "STILL NOT REGISTERED" yesterday and I did not close that today.

---

## Seed canary — placebo-b +48 h, taken 11:26Z (ALL-controls arm)

Positive control: 2,420,762 rows, 80 bots, 127 distinct kinds, walk spans 73.5 h.
T0 2026-09-19 11:25:23Z; control = every pool except placebo-a and placebo-b (the other re-seeded
pool is held out of both arms).

| arm/era | bot-h | deaths | /bot-h | immob% | **gather%** | stock/bh | iron% |
|---|---:|---:|---:|---:|---:|---:|---:|
| treatment/pre | 125 | 2 | 0.0160 | 2.4 | **10.0** | 1.40 | 0.0 |
| treatment/post | 245 | 3 | 0.0122 | 0.0 | **45.9** | 19.62 | 32.7 |
| control/pre | 1,250 | 29 | 0.0232 | 7.0 | 18.5 | 5.11 | 19.4 |
| control/post | 2,450 | 71 | 0.0290 | 7.9 | 21.6 | 4.49 | 21.3 |

**DiD: gather success +32.8 pp** (terminal rows 1,885→3,884 vs 20,613→41,324), stock **+18.84/bot-h**,
iron-pick share **+30.8 pp**, immobile **−3.2 pp**, deaths −0.010/bot-h **[5 bots cannot resolve a rate
this rare — a tripwire, not a result]**. Death classes on the new seed: drown 1, other 1, fall 1.

**placebo-b agrees with placebo-a within ~3 pp** (+32.8 vs +29.1 all-controls / +32.1 clean). Two seeds,
two pools, two inference halves.

### The registered regression-to-the-mean discriminator is SATISFIED
The registration named this prospectively, before either read opened:

> **placebo-b was the worst pool in the fleet before it was touched** … a pool that starts at 11.1% against
> a fleet at 19.4% has room to improve that has nothing to do with terrain … **If placebo-b improves and
> placebo-a does not, that is regression to the mean and not terrain.**

**Both improved.** That is the registered test being honoured rather than reinterpreted after the fact, and
it is the strongest thing the seed canary has going for it. It does not make the effect attributable — the
reseed-plus-reset confound is separate and only the +72 h reads address it.

The pools were **drawn deterministically** (lowest SHA-256 of `<pool>+2026-09-18-seed-canary` per inference
half, after the 12-h ledger exclusions and the standing bans), so "the pools were picked because they were
doing badly" is not available as a rival. placebo-b's low baseline is chance, and it was declared in advance.

### An instrument defect in the contamination list — it flags fleet-wide promotions as canary contamination
The read's CONTAMINATION block lists **placebo-b itself**, i.e. the treatment pool, among "control pools that
ran a canary build inside the post window", and lists `b1659c0` and `cfc1c58` against every pool. Those two
are **fleet-wide mains, not canary builds**. The genuine canary shas in the window are `2850cde` (leaf-01),
`1457f3a` (digwatch-01) and `b72781e` (needsdrop-01). As written the block cannot discriminate a canary from
an ordinary promotion, so **it must not be used to choose the exclusion set.** The `SEED_CONTROL_EXCLUDE`
list actually used is hardcoded and does correspond to the real canary pools, so no read has been harmed —
but the block reads like evidence and is not.

### And a defect in my own waiting, worth writing down
I armed the wait for this read on `grep -q "CLEAN controls"` — which matches the **header line the script
echoes before running the second read**, not its output. So I read the file, found the clean-controls section
empty, and briefly treated a still-running job as a silent failure. **A wait condition that can be satisfied
without the result existing is the same defect as a detector that answers uniformly**, and that is three of
these in one day (the 0.0%-everywhere gather parse, the self-matching `pgrep`, and this).

### The "CLEAN controls" arm is ONE POOL, and nothing says so

`placebo-b +48 h`, clean-controls arm: **gather DiD +38.4 pp** (treatment 10.0% → 45.9%, control
18.6% → **16.1%**), stock +21.87/bot-h, iron-pick share +32.7 pp, immobile −2.5 pp. Larger than the
all-controls +32.8 pp, and presented as the better-controlled number.

**It is not.** Read the exposure column: **control/pre 125 bot-h, control/post 245 — identical to the
five-bot treatment pool.** The control arm is five bots.

The arithmetic, from `seedread.py`:
- **`:90` drops every `isolated*` and `self-*` pool from BOTH arms, unconditionally** — that is 4 pools /
  20 bots gone before any exclusion is applied.
- The remaining universe is board-a/b/c/d, hive-a/b/c/d, placebo-a/b/c/d = 12 pools; placebo-a and
  placebo-b are treatment, leaving **10 control pools = 1,250 bot-h pre**, which is exactly what the
  all-controls arm reports.
- `SEED_CONTROL_EXCLUDE` then drops board-a/b/c/d, hive-a/b/c/d and placebo-d — **nine of the ten** —
  leaving **placebo-c alone**.

The header prints `CONTROL ARM RESTRICTED: dropping <nine pools>`. **It never prints what is left.**

**Consequence, and it inverts the overnight session's reading.** That session reported placebo-a's clean
arm as *"+32.1 pp … contamination was diluting the effect, not creating it"* and treated it as the more
trustworthy figure. By this fleet's own measured noise floor — null sd of the pool-mean ratio-DiD is
**0.608 at k=5** against 0.313 at k=20 (measured overnight, 300 splits per cell) — **a single-pool control
is the noisiest comparator available.** The "clean" numbers are *less* reliable than the all-controls ones,
not more.

Neither arm is clean, and that should be said plainly rather than resolved by preference:
- **all-controls** (10 pools / 50 bots) genuinely contains canary exposure — `2850cde` leaf-01,
  `1457f3a` digwatch-01, `b72781e` needsdrop-01 ran on board-\* and hive-\*;
- **clean-controls** has no canary exposure but n = 1 pool;
- and the clean arm's own contamination block still flags placebo-c for `b1659c0`/`cfc1c58`, which are
  fleet-wide mains — so even "clean" is not clean by the script's own (unreliable) test.

**What the +72 h read should do instead:** the four `isolated*` pools are 20 bots that ran **no canary in
the window** and are currently discarded at `:90` for a draw-eligibility reason that has nothing to do with
being a control. Admitting them would give a 5-pool / 25-bot uncontaminated control arm — k=25, comfortably
past the k=20 knee — in place of choosing between 50 contaminated bots and 5 clean ones. **This is the single
highest-value change to the seed canary's read and it is a one-line condition.** It must be made
**prospectively, before the +72 h reads open**, and recorded in the registration; making it after seeing
+38.4 pp would be choosing the comparator on the answer.

**The direction of the effect does not depend on any of this** — +32.8 pp against 50 bots and +38.4 pp
against 5 agree in sign and rough size, and placebo-a agrees with both. What changes is how much of the
precision is real.
