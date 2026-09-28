# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-28 03:07Z — **NO LIVE CANARY. Fleet on `80b3bbd+8b910b`, ONE version, 80 bots.** `main` is
`9b339fd` and its `bots/src` is BYTE-IDENTICAL to the deployed sha. Nothing is at risk unattended._

> **THIS FILE NOW EXISTS ON `main`.** For weeks it did not, and an external reviewer reading the
> fleet's own sha was blind to a whole day of measurements as a result. `bots/test/nothing-important-is-orphaned.test.mjs`
> asserts it stays there, along with the replay harness and the checkers. If that test fails,
> something has been orphaned again.

---

## THE ONE THING WAITING, AND IT IS DELIBERATE

**The tool-keeper canary is built, tested, pushed, and NOT LAUNCHED.** Branch `tool-keeper`, one
commit above the deployed sha. It needs a registration and a read script, and the read is **26
hours** because deposits succeed only **0.151/bot-h** — a 3-hour read yields ~2 events per arm and is
guaranteed INCONCLUSIVE, which would burn the single canary slot.

    pool      hive-a   (drawn by sha256 of "<pool>+2026-09-27+toolkeeper" among TEN ELIGIBLE pools)
    eligible  a pool needs >=3 bots holding 2+ pickaxes whose best copy is at or below the fleet
              median. hive-a has 5 of 5. Eligibility was fixed BEFORE the draw.
    never     the four reseeded worlds -- fresh median 98.4 items/bot-h against control 33.8
    gates     REVERT on gather_ratio < 0.43 of control, or death_ratio > 1.25 with >=2 canary deaths,
              or any deposit where the surviving copy was not the max-remaining copy.
              KEEP needs DiD on median best-held-pickaxe uses >= 3x control, both placebo anchors
              within +-25%, and >=20 deposit successes per arm.
    anchors   crafting_table/furnace copies held (same code path, NOT durability-selected) and
              cobblestone held (the scaffold reserve, untouched). A source-verified causal chain died
              today at 3.7% against a 3.2% anchor; the anchor is what caught it.

**Launch it in the morning, not at 03:00** — a 26-hour read started now lands at 05:00.

## FLEET, at 2026-09-28 03:07Z
| | |
|---|---|
| sha | `80b3bbd+8b910b`, ONE version, 80 bots, all `mcbot@*` active |
| manifest | `run_id pin-20260927`, `canary_pool` empty |
| `main` | `9b339fd`, `bots/src` identical to the deployed sha |
| fresh worlds | `hive-c` `board-b` `hive-d` `placebo-d` — reseeded 2026-09-27 ~13:00-14:00Z |
| controls | the other 12, still seed `1239381899`, town 355,73,147 |

    FRESH(4) vs CONTROL(12), 3 h to 03:07Z      items/bot-h  98.4 vs 33.8  = 2.91x
                                             decisions    44.4 vs 41.0  = 1.08x
                                             deaths       0.05 vs 0.00  (3 deaths / 180 bot-h)

**2.91x is thirteen hours in and unchanged from the 3.0x first read. DO NOT BANK IT** — the 19 Sep
pools fell 63.4 -> 20.8 items/bot-h in six days.

## PLANTING: the loop closed, and it is nearly self-sustaining
    24 h:  3,263 saplings PLANTED   2,488 ACQUIRED   net -775   stock 6,224 (~8 days runway)
           9,474 plant_spot scans, 44.4% found a spot

**Re-reading the first cohort a day later shows the whole cycle:**

    at +7h    grew 289   still sapling 121   gone 297
    at +21h   grew  86   still sapling  18   gone 421
    harvest-immune grew/(grew+sapling): 72.1% -> 82.7%

**The trees grew and then were chopped down.** That is the loop working, not a regression.

**CORRECTION carried forward: sapling acquisition is 2,488/day, not the 485/day I quoted all day.**
The 485 came from a report I cited instead of measuring. It changes the conclusion: planting is
draining stock slowly, not collapsing, and harvesting planted trees should raise acquisition further.

## SHIPPED 2026-09-28 (all fleet-wide, all read or runtime-no-op)
1. **Planting + the measured clearance** (`268c074`) — oak needs 5 air blocks above, birch 6,
   measured on the sandbox rig with an unceilinged control at 6/6. 1,033 of 1,034 placements.
2. **Dependency pin + ARBITER containment** (`80b3bbd`) — the fleet was unpinned and safe only
   because of a lockfile left in the runtime dir on 2026-08-20 that the deploy never copied. The
   deploy now copies it AND refuses on drift; PINNED/DRIFT/NOPIN all exercised. `ARBITER=1` crashed
   every bot (a cherry-picked caller whose callee was in the source branch's base) and now REFUSES
   loudly, because the arbiter is half-wired and a grant would confer no ownership.
3. **Four worlds reseeded**, twelve kept as simultaneous controls.
4. **241 paths consolidated onto main** + a wired anti-orphan test.

---
## THREE DEFECTS FOUND TODAY BY RUNNING THE THING, all live for weeks

1. **`isPlantable` asked for ONE air block above a sapling. Oak needs 5, birch 6.** Measured on the
   sandbox rig (rcon 25699) under open sky at randomTickSpeed 2000: with a stone ceiling at +2..+5
   oak grew **0/3** every time and at +6 **3/3**; birch 0/3 at +6 and 3/3 at +7; the unceilinged
   control grew **6/6**. A second run proved the room is purely VERTICAL — 1x1, 3x3 and 5x5 stone
   tubes with 12 air above all grew 2/2, every column verified by read-back. The old predicate
   would have planted into every dirt-floored tunnel on the fleet, and a sapling that cannot grow
   occupies that ground for good, because `isPlantable` rejects a cell already holding one.
2. **The planting cooldown was never charged unless a spot was found.** `if (order)
   this.lastPlantedAt = ...` leaves the clock untouched when the sweep returns null, and a bot
   standing on stone never gets an order — so it re-ran a 72-cell sweep on EVERY decision, for
   ever. Both review engines found it independently. It is the same bug the block's own comment
   claimed to have fixed one review earlier, moved one line down.
3. **`reseed-pool.sh --new-seed` had NEVER worked.** Two literal newlines where `\n` was meant made
   its journal rewrite an unterminated string literal, so it raised SyntaxError every time, the
   journal kept the old seed, and four "retries" re-ran the SAME rejected seed — four identical
   banners in the log. Fixed (`fa3ca7c` in mcai-rl02), verified against a COPY of the real journal
   before going live. **Seed rejection is far commoner than the runbook's "1 in 2": nine seeds were
   rejected for four pools today (board-b 2 draws, hive-d 4, placebo-d 4).**

### AND ONE CAUSED AN OUTAGE — place-town.py cannot see a world mid-reseed
`_discover_worlds()` recognises a fleet world by the presence of `TOWN-PLACED.json`, which is
exactly the file `reseed-pool.sh` archives away before asking it to stamp a new town. argparse
rejected `hive-c` by `choices`, and **hive-c was left regenerated, townless, with its five bots
down for about 20 minutes.** Patched on the host to accept an archived
`TOWN-PLACED.pre-reseed-*.json`; verified it then discovers all 16 with ports matching every live
`TOWN-PLACED.json`, and still excludes `sandbox*` and `template`. **This would have hit all 16
worlds identically — the argument for having started with one.**

## OPEN: PLACE-TOWN.PY HAS DIVERGED AND NEITHER COPY IS BETTER
`~/scripts/place-town.py` on 10.0.0.30 (29,545 b) and `mcai-rl02/scripts/place-town.py` (31,421 b)
differ on **different axes**, so copying either way loses something:
- the **HOST** has derived world discovery (`_discover_worlds()`, all 16 read from disk, no
  hand-kept list) **plus today's mid-reseed patch**. It is what placed four towns today.
- the **REPO** has the `probe.py` import and `classify_execute_if`, which handle the
  "That position is not loaded" reply properly — the trap `lib/telemetry.py` documents.

**This needs a real merge, not a copy.** Backup on the host:
`place-town.py.bak-20260927T125559Z`. Until merged, **run the HOST copy**; it is the one that works.

## MY OWN ERRORS TODAY, recorded because two of them repeated
- **I said `scripts/reseed-pool.sh` does not exist. It does**, in `mcai-rl02` on branch
  `recovery-ladder-03`. There is already a commit titled *"reseed-pool.sh exists, I said it did
  not, and I built a duplicate of it"*. **The scripts live on a different branch from the code**,
  so a `find` in the code checkout will keep answering wrongly.
- **I twice misreported `place-town.py`'s world list as 8.** That list is a LOUD FALLBACK used only
  when discovery finds nothing; under sudo it discovers 16. On the strength of that misreading I
  was about to overwrite the newer host copy with the older repo one.
- **My RCON probes bucketed unloaded chunks as "unidentifiable"** — the exact trap
  `lib/telemetry.py:28-31` documents, which already cost this project an entire ocean survey.
  41 of 763 saplings sit in unloaded chunks and therefore cannot grow: a MEASUREMENT of ticking
  deprivation, not instrument noise.
- **I wrote "NO HARM" of the `859af48` promotion.** Correct wording, per review: *no aggregate harm
  signal detected in this window.* 6 vs 7 deaths cannot establish safety.
- Cleared 5 orphan `*-Charlie` units (a standing queue item): all `failed`, all already
  `disabled`, **no env file at all**, and **zero telemetry rows in 24 h** against a positive
  control of 9,651 rows from `board-b-Alpha` in the same pool. `reset-failed` only; nothing
  deleted, nothing disabled that was not already disabled.

---

## OWNER CALLS WAITING
0. **RESOLVED 2026-09-27:** owner approved **4 fresh worlds, not 16**, after being shown that reseeding
   all sixteen makes every measurement for a week a fleet-wide before/after — the one thing
   CLAUDE.md forbids by name. Four are done; twelve are controls.
1. **The 24–27 Sep program window.** Ended early by the 25 Sep fleet-wide promotion of `efa2853`.
   Rule 1 said the window restarts if that happens. **Restart from 25 Sep, or abandon?**
2. **The v21 death-gate lower bound** — trips on 0 of 15 death-involved reverts. A question about
   the **bound**, not the p.
3. **The audit (`8019b1d`) finds 7 of 23 reverts CONFIRMED FALSE and 5 more suspect.**
4. **Commits headed "OWNER DECISION"** with no artefact recording one — three over 24–25 Sep.
5. **`vetob2-01` (`efabf13`) is still KEPT and unpromoted.** The gate KEEP was "nothing objected";
   my own effect read was INCONCLUSIVE. I recommend re-drawing it off the hive pools.

## QUEUE
- **Re-read the planting cohort at +24 h and +7 d** against the twelve controls. The open question
  is not whether saplings grow — answered, 72.1% — but whether the trees change the DEPLETION
  CURVE. The 19 Sep evidence says a fresh world ALONE buys about a week.
- **`gather` logs what it collected but not WHERE** (`collected 2 oak_log`), so a harvest cannot be
  matched to a specific planted tree. The leaf test worked around it once. One new EVENT carrying a
  coordinate would close it — never a new field, the ELK templates are `dynamic:strict`.
- **Merge the two `place-town.py` copies** (above).
- `PLANT_RESERVE = 8` is **per species**, so birch (575 across 80 bots) and jungle (15) are excluded
  and planting is oak-only. Oak is 94% of holdings, so fine now and wrong long-term.
- **`place` declares only `args: ['item']`**, so every sapling planting collapses onto one
  `learned_avoid` key — the key-collapse the code's own comment at `skills.mjs:6931` documents for
  `explore`. It did not bite today (90% of orders reached the skill) because success keeps
  `priorFails` at 0. Measured, not fixed.
- **`skills.mjs:2759` `.sort()` is alphabetical**, so 1,415 bots/day are told to gather
  `cobbled_deepslate` (0 ever obtained) over `cobblestone` (7.3% of 2,723). UNBUILT.
- `container_open` 446/4,160 uncharacterised; consolidate the two schedule guards in `verdict.py`.

---
