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
