# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-27 14:10Z — **NO LIVE CANARY.** Fleet on **`268c074+b4d009`, ONE version, 80 bots.**
`main` fast-forwarded to `268c074` (13 commits of drift closed; main tracks the fleet).
**THE PLANTING OBLIGATION IS LIVE AND READ: 1,033 of 1,034 sapling placements succeeded and
72.1% of placed saplings became trees.** **FOUR WORLDS RESEEDED** on owner approval
(`hive-c`, `board-b`, `hive-d`, `placebo-d`); the other twelve kept as simultaneous controls._

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and
> falls back to the repo copy. **If they disagree, take the later `_updated` stamp.**

---

## WHAT IS LIVE RIGHT NOW (2026-09-27 14:10Z)

| | |
|---|---|
| fleet sha | `268c074+b4d009`, ONE version, 80 bots, all `mcbot@*` active |
| manifest | `run_id plant-20260927`, `declared_code_version 268c074`, `canary_pool` empty |
| `main` | `268c074` — matches the fleet |
| fresh worlds | `hive-c` 4394143238757369828 town -68,68,-68 · `board-b` 6443945553241215903 town -249,65,144 · `hive-d` 4534598234323719516 town 68,65,68 · `placebo-d` 2021899648305791853 town 177,75,73 |
| controls | the other 12, untouched, still seed `1239381899` town 355,73,147 (14 of 16 shared it before today) |

### THE PLANTING RESULT — the first time this project has put wood back into a world
Deployed 06:22Z. Read block-by-block by RCON in all 16 worlds over 763 saplings older than 90 min:

    GREW into a log     289  37.9%      still a sapling  121  15.9%
    gone                297  38.9%      chunk NOT LOADED  41   5.4%     other 83

- **`grew / (grew + still_sapling)` = 282/391 = 72.1%** — the rate that harvesting cannot distort,
  because a harvested tree leaves neither.
- **"Gone" is mostly HARVEST.** Leaf evidence with both controls: sites with a standing trunk carry
  leaves **98.2%** of the time (the method's ceiling, so it is not blind); sites known NOT to have
  grown carry them **22.0%** (natural-forest background); gone sites **51.8%**. Scaling between the
  two controls, **~39% of the gone saplings had grown into trees before they vanished.**
- Placement: 2,687 `plant_spot` scans on 80 of 80 bots, 43.8% found a spot, **1,033 of 1,034
  sapling placements succeeded (99.9%)**. The `learned_avoid` key-collapse hazard did NOT bite —
  1,150 orders produced 1,034 attempts.
- **The clearance rule is holding:** 104 of 113 standing saplings have the room their species needs.
  Of the 9 short, **7 were grown over by a NEIGHBOUR'S canopy after planting** (oak_leaves or
  oak_log directly above) — not a predicate defect, and no pre-placement check can prevent it. The
  other 2 are one dirt and one oak_planks: a bot built over them.

### THE 8x PER-WORLD SPREAD WAS MOSTLY A MEASUREMENT ARTEFACT
`grew%` counts **trunks standing at one instant** — a stock, not a flow — so a world that grows
trees and chops them down fast reads as a failure. On the harvest-immune metric the spread falls
from **8.1x to 4.3x** (hive-b 96.0% down to board-d 22.2%), close to this fleet's own documented
2.36x between-pool band. **REFUTED as causes, each with a measurement:**

| candidate | verdict |
|---|---|
| headroom / tunnels | 92% have their clearance; the 8% short were grown over afterwards |
| daylight / clock phase | arithmetic: a Minecraft day is 20 real min, so all 16 worlds cycled ~19x in the window |
| bot proximity (ticking) | corr(grew%, exposure) = **-0.192**; the WORST world has the 3rd HIGHEST exposure |
| forceload extent | corr = **-0.176**; only 15.4% of plantings sit inside a forceloaded chunk |
| world terrain | 14 of 16 shared one seed and town, and `board-d` is one of them |

### FRESH vs CONTROL, first read — HOURS OLD, DO NOT BANK IT
    FRESH    n=4 worlds   median 95.7 items/bot-h   (range 53.5 - 135.4)
    CONTROL  n=12 worlds  median 31.9 items/bot-h   (range  5.8 -  76.1)
    ratio of medians 3.0x
The 19 Sep fresh pools went 63.4 -> 20.8 items/bot-h in six days. Exposures here are 0.03-1.15 h
and unequal. **Re-read at +24 h and +7 d against the same twelve controls.**

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
