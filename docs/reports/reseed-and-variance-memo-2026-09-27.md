# Two questions: is it time to reseed, and why did one world grow 68% while another grew 8%

_written 2026-09-27 12:13Z (date -u). Owner asked four things; these are the two that need review._

## MEASURED SINCE THE LAST MEMO — the planting deploy is real and read

`268c074+b4d009` fleet-wide, ONE version, 80 bots, declared `plant-20260927` at
**2026-09-27T06:22:00Z**. Contains: the place read-back, the planting obligation, the MEASURED
sapling clearance, the cooldown fix both engines caught, and `plant_spot` with the coordinate.

### Placement
```
plant_spot scans          2,687 on 80 of 80 bots (7h window)
  found a plantable spot  1,178   43.8%
  no spot in reach        1,509   56.2%
  order issued            1,150   42.8%
sapling place attempts    1,034
  success                 1,033   99.9%   (one no_space)
```
The `learned_avoid` key-collapse hazard I flagged and did not fix **did not bite**: 1,150 orders
produced 1,034 attempts, so ~90% reached the skill. Success keeps `priorFails` at 0.

### Growth, read block-by-block by RCON in all 16 worlds (763 saplings older than 90 min)
```
GREW into a log     289   37.9%
still a sapling     121   15.9%
gone                297   38.9%   replaced by: air 240, dirt 37, grass_block 20
unidentifiable       56    7.3%
```
**37.9% is a FLOOR, not the growth rate.** I cannot distinguish "grew then was harvested" (a
success, and harvesting a trunk leaves air) from "sapling destroyed" inside the 38.9%.

### THE VARIANCE THE OWNER IS ASKING ABOUT
```
world        n   GREW  sapling  gone  unknown   grew%
placebo-b   62     42        2    17        1   67.7%   <- best
isolated-b  56     32        7    15        2   57.1%
hive-c      46     23        9    10        4   50.0%
hive-b      46     22        1    12       11   47.8%
isolated-a  52     21       10    21        0   40.4%
isolated-d  56     20       13    22        1   35.7%
board-b     72     26       10    28        8   36.1%
isolated-c  47     17        7    22        1   36.2%
board-c     51     17        8    23        3   33.3%
hive-d      41     15        7    12        7   36.6%
placebo-d   55     13       11    28        3   23.6%
hive-a      42     12       12     9        9   28.6%
placebo-a   40     11        8    20        1   27.5%
placebo-c   45     10        5    29        1   22.2%
board-a     16      5        2     5        4   31.3%
board-d     36      3        9    24        0    8.3%   <- worst
```
Same code, same 90-minute maturity cut. **placebo-b is 8.1x board-d.**

Note what is NOT obviously the story: `placebo-b` was reseeded 19 Sep (fresh-ish world, seed
`7843072457371465157`) and is best — but `placebo-a` was reseeded the same week and is 27.5%,
below the fleet mean. And the arms do not separate: isolated is 35-57%, board is 8-36%, hive is
28-50%, placebo is 22-68%.

### What the earlier measurements already established, for your ranking
- Sandbox, rtick 2000, open sky: oak 0/3 with a ceiling at +2..+5, **3/3 at +6**; birch 0/3 at
  +6, 3/3 at +7; unceilinged control 6/6. So oak needs 5 air blocks, birch 6.
- Shaft widths 1x1, 3x3, 5x5 with 12 air above and the columns VERIFIED by read-back: **2/2 grew
  in every width**, control 2/2. Room is purely vertical; canopy width is not required.
- All 16 worlds, live RCON, own passwords: `randomTickSpeed` **3**, `doDaylightCycle` **true**,
  16 of 16. `spigot.yml sapling-modifier: 100` (all 23 modifiers 100).
- `server.properties`: **`simulation-distance=6`** (= 96 blocks), `view-distance=8`. No
  forceload on any fleet world (`world/data/` holds chunks.dat only).
- The last review raised chunk ticking: random ticks only in chunks near a player, and spawn
  chunks were removed in 1.21.9. **My sandbox growth tests all used `forceload`, so they prove
  the mechanics and say NOTHING about proximity.** This is the leading untested hypothesis.

---

## QUESTION 1: WHY THE 8x SPREAD? Design the diagnosis, and say what tooling is MISSING.

Candidate causes I can name. Rank them, say which the existing telemetry can already settle, and
which need a new instrument:

1. **Ticking exposure.** A sapling more than ~96 blocks from every bot receives no random tick.
   Bots roam: `explore` displaces 60 blocks a call. Available data: `raw.bot.pos` on every row,
   and the planted coordinate in the `place` detail and in `plant_spot`. So a per-sapling
   "fraction of the window within 96 blocks of some bot" is computable TODAY with no new logging.
   Is that the right statistic? What is the right denominator — bot-seconds, or chunk-ticks?
2. **Light.** Growth needs light >= 9 checked at the block ABOVE the sapling; at night surface sky
   light reads 4 and growth pauses. A sapling in a cave or under dense canopy never qualifies.
   The clearance check does not measure light. Worlds run independent day clocks — measured
   `time query daytime` spanned 1,974 to 20,411 across the 16 at one instant. **Could the spread
   just be which worlds were in daylight during the window?** How would you test that cheaply?
3. **Terrain.** 14 of 16 worlds share seed `1239381899` and the town at 355,73,147, so terrain is
   nearly identical across those 14 — which argues terrain is NOT the cause, and `board-d` (8.3%)
   is one of the 14. Does that kill the terrain hypothesis or not?
4. **Where bots stand.** Depleted worlds may push bots underground; a sapling planted in a dirt
   tunnel now passes the 5-block clearance test only if the tunnel is 6 tall.
5. **Harvest.** A high "gone" share could mean MORE success, not less. `placebo-c` is 29 gone of
   45 (64%) with only 10 grown. Is that a world that grows and harvests fast, or one that destroys
   saplings? What distinguishes them in data we already have?

**The specific thing I want from you: a ranked diagnosis plan where every step names the field or
the RCON command it reads, and flags any step that needs code.** I would rather add one instrument
once than guess twice.

## QUESTION 2: IS IT TIME TO RESEED ALL 16 WORLDS, AND WHAT IS THE RUNBOOK?

Owner has asked for fresh worlds twice and is asking again. The reason I held it is gone: the
saplings are now becoming trees, so the "reseeding wipes the 10,125 saplings" objection has been
partly spent by converting them.

**Facts about the reseed, verified:**
- `scripts/reseed-pool.sh`, documented at `docs/reports/seed-canary-registration.md:11` as the
  one-command reseeder, **does not exist** in the repo or on either host. Positive control: the
  same `find` located `place-town.py`, `pregen-world.py`, `backup-world.sh`, `world-health.py`.
- `scripts/place-town.py` in the REPO has all sixteen worlds in `ARMS`. **The copy on the world
  host (`/home/mike/scripts/place-town.py`) is a DIFFERENT FILE** — md5 `c8a6165b...` against the
  repo's `bc9d1cd5...` — and the host copy's `ARMS` lists only EIGHT. A reseed run with the host
  copy would stamp towns using an 8-world map. **I corrected a wrong claim in the last memo here:
  I had said the repo was stale; it is the host that is stale.**
- Bot inventories live in `world/playerdata/*.dat` (4 files + `_old`, 44 K, board-a), INSIDE the
  directory the reseed archives. So a reseed empties every bot unless playerdata is carried over,
  and carrying it over risks spawning a bot at a stale position inside new terrain.
- Worlds are `block2@<pool>.service` on 10.0.0.30, `/srv/block2/<pool>/`. 348 G free, 16 worlds
  total ~2.6 G.
- Verified RCON ports, read from each world's own `TOWN-PLACED.json` rather than derived:
  hive a/b/c/d 25670,25671,25678,25679 · board 25672,25673,25680,25681 ·
  isolated 25674,25675,25682,25683 · placebo 25676,25677,25684,25685.
- 14 of 16 share seed `1239381899` and town 355,73,147. placebo-a `8948499624371160708` town
  249,75,-144; placebo-b `7843072457371465157` town 282,65,-388.
- The 19 Sep reseed evidence: log-gather 4.9% -> 57.6% in two days on a world swap while the worn
  70 sat at 7.0-7.9%, then the fresh pools fell 63.43 -> 20.79 items/bot-h in six days.

**What I want:**
1. **Go or no-go, today, and say what it costs if you are wrong.** The owner has asked three times.
2. **The runbook, ordered, with the failure mode of each step and its rollback.** I intend:
   stop the 5 bots -> stop the server -> archive `world` and `TOWN-PLACED.json` -> new
   `level-seed` -> start and generate -> `pregen-world.py` -> `place-town.py <pool>` -> rewrite
   `HOME_*`/`BOARD_*` in the 5 env files at `/srv/mcbots/harness/env/` -> clear bot state
   uniformly -> start bots staggered 12 s -> RCON-confirm 5/5 in world.
3. **Playerdata: carry it forward or not?** Name the failure mode of each choice.
4. **One pool first, or all 16?** And what exactly must pass on pool one before pool two.
5. **Does the reseed have to wait for the variance diagnosis?** A fresh world changes light,
   canopy and where bots stand — three of the five candidate causes. Say plainly whether
   reseeding first destroys the ability to answer question 1, and if so whether that matters.
6. **What must NOT be done today.**

## Rules
- Every negative claim carries a positive control. `file:line` or the exact command for everything.
- Distinguish measured / source-verified / inferred / external-Minecraft-behaviour.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: the single most valuable next action, and the one query that would tell us
  within 6 hours whether it worked.
