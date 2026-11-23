# 7. Deaths and danger (pre-project analysis)

Data: skill/event stream on 10.0.0.45, fleet `mcai-skill-agents` 2026-08-05..11-18 (118.8 M rows, 95 bots) and
showcase `mcai-skill-showcase` 10-20..11-22 (7.6 M rows, 16 bots); 2026-10-07 skipped. LLM decisions parquet
(15.6 M rows, 110 bots) for decision timing. Scripts: `infra/analysis/pre-project/7_extract_slim.py` (slim per-day
parquet), `7_deaths.py` (all tables below), `7_followup.py`. Read-only on the data; outputs in `~/mcai/work7/`.

## Headline

| | fleet (agents) | showcase |
|---|---|---|
| deaths (deduplicated) | **6,110** | **29** |
| bot-hours | 169,224 | 8,011 |
| **deaths / 1,000 bot-hours** | **36.1** (Aug 107 -> Nov 8.3) | **3.6** (Nov: 4.3) |
| mob deaths | **0** | **0** |
| starvation deaths | 0 (hunger is 20 at every death) | 0 |

- Four causes are everything: **drowning 56%, fall 22%, lava 19%, suffocation 2%** (fleet). Showcase: drowning 41%,
  fall 38%, lava 14%, suffocation 7%.
- The fleet rate fell 13x from August to November (535 -> ~8 per 1,000 bh by week), as reflexes were added. The
  showcase runs at roughly half the late fleet rate, but its weekly rate is **rising** (2.3 -> 4.9 -> 6.1).
- **Peaceful is confirmed**: 0 of 6,139 death messages are mob kills ("slain/shot/blown up" matched nothing);
  hunger is 20.0 at every death; every logged `difficulty=` value (65,928 rows, 10-08 onward) is `peaceful`.
  The stack has never been tested against a hostile mob. Everything about easy/normal below is a projection.

## Method, denominators, controls

- **Death event**: `skill.name = '_death'`, `trigger = 'death'`. Positive control: the name scan finds it with
  6,185 rows next to 90 other danger-named events (e.g. `_drowning_up` 1.1 M, `_entombed` 0.92 M). There is no
  respawn event (only `_respawnfall_mode`, a reflex mode), so `_death` is the one record per death.
- **Duplicates**: 6,185 rows, 6,185 distinct `_id`, but 44 same-bot same-timestamp pairs and 46 within 10 s of
  the previous death of the same bot. These are treated as duplicates (a bot cannot die twice in 10 s); **6,139**
  deaths remain. Within 60 s: 56 (the extra 10 are left in; real respawn-and-die-again is possible).
- **Bot-hour denominator**: distinct (bot, clock-hour) with at least one event. Fleet 169,224; showcase 8,011.
  Cross-check: active minutes / 60 = 167,212 and 7,801 (within 3%), so a bot-hour is essentially a fully active
  hour. Bots emit ~700 events/hour, so a silent bot-hour is a bot that is not running.
- **Cause** from the Minecraft death message in `skill.detail` (fail_class agrees: `drowning` 3,419 vs 3,419;
  fail_class `other` hides 246 stalagmite/stalactite falls that are reclassed as fall).
- **Preceding events**: all events for the same bot in the 2 min before death; 6,126 of 6,139 deaths have some.
- **Time since last decision**: latest decision row for the bot within 6 h before death (found for 6,050).

## By time, code and pool

| month | src | deaths | bot-hours | per 1,000 bh | drown | fall | lava | suff |
|---|---|---|---|---|---|---|---|---|
| 2026-08 | fleet | 2,176 | 20,410 | 106.6 | 1,593 | 410 | 160 | 5 |
| 2026-09 | fleet | 2,416 | 57,600 | 41.9 | 1,251 | 475 | 627 | 15 |
| 2026-10 | fleet | 1,239 | 57,520 | 21.5 | 503 | 328 | 303 | 105 |
| 2026-11 | fleet | 279 | 33,694 | 8.3 | 60 | 126 | 79 | 14 |
| 2026-11 | showcase | 29 | 6,760 | 4.3 | 12 | 11 | 4 | 2 |

- Drowning was the August problem (73% of deaths) and was pushed down 27x by November (60). **In November, fall and
  lava are the leading causes** (126 + 79 of 279). Suffocation peaked in October (105), i.e. after the dig-out
  reflexes made bots dig more.
- Code versions range from 2.9 (aea8370, 1,700 bh) to 71.8 (8a2964a, 3,651 bh) per 1,000 bh; the best November
  builds sit at 3-11.
- Pools (fleet): hive 43.3, self-isolated a-d 36-45, board 29.7, placebo 26.8, isolated 13.3; early unnamed pools
  (August, 709 bh) 484; solo/scout pools 121-320. Pool differences are mostly era differences (when they ran).
- Concentration: top bots Gather01 202, Miner01 181, Gather02 172 (August-era bots). **504 deaths (8%) were within
  8 blocks of the same bot's own death in the previous 24 h** (repeat traps).

## Situation at death

**Y band** (overworld; share of all events as an exposure proxy):

| y | % of time | % of deaths | drown | fall | lava | suff |
|---|---|---|---|---|---|---|
| < 0 | 4.0 | 8.7 | 13 | 337 | 168 | 6 |
| 0-39 | 16.3 | 23.0 | 288 | 625 | 424 | 37 |
| 40-55 | 16.1 | 28.7 | 1,521 | 103 | 91 | 46 |
| 56-62 | 22.2 | 29.2 | 1,597 | 17 | 135 | 39 |
| 63-79 | 39.3 | 9.3 | 0 | 205 | 350 | 12 |
| 80+ | 2.1 | 1.1 | 60 fall, 5 lava |

Underground (y < 40) is 20% of time and 32% of deaths (fall + lava dominate there, ~2x the surface rate per hour).
Drowning lives at y 40-62: underwater and sea-floor/flooded-cave depths (the surface is ~63). Surface (y 63-79)
is 39% of time and only 9% of deaths.

- **Skill running at death: 75% "idle"** (4,619 of 6,139): the bot was between skills, i.e. a reflex or the
  interrupt machinery owned the body. Drowning: 92% idle. Falls are the exception: explore 429, gather 305, goto
  142 of 1,350 (movement kills).
- **Damage window**: drowning, lava and suffocation kill fast: median 2-3 s from the last health reading
  (drowning starts from 1.7 hp, i.e. air had already run out; 3,413 of 3,419 under 5 s). Falls are one-hit
  (hp 20 at last reading in the median).
- **Water/lava nearby** (at the last LLM decision within 10 min, counts of visible blocks): water seen before 86%
  of drownings, **lava seen before 92% of lava deaths (1,067 of 1,155)**, and before 42% of falls.
- **Time since last LLM decision**: median 16-24 s (p90 33-68 s) for all main causes. The LLM had just been asked;
  the deaths happen faster than a decision cycle can react.
- **Dimension**: all 6,139 in the overworld.

## Did reflexes fire? (2 min before death)

| cause | deaths | air/drown reflex | escape/entomb | lava/danger reflex | low-health reflex |
|---|---|---|---|---|---|
| drowning | 3,419 | 3,073 (90%) | 1,468 | 129 | 2,981 (87%) |
| fall | 1,350 | 70 | 464 | 30 | 42 (3%) |
| lava/fire | 1,173 | 114 | 406 | 1,030 (88%) | 1,123 (96%) |
| suffocation | 141 | 4 | 103 (73%) | 0 | 141 (100%) |

Reflexes fire before almost every drowning, lava and suffocation death: **the problem is not detection, it is
that the reflexes fire and fail.** Typical drowning tail: `_drowning_route` (48% of deaths), `_drowning_up` 39%,
`_oxygen_critical_state` 40%, `_drowning_ceiling_no_air` 28%, `_water_no_air_route` 22%,
`_drowning_rescue_yielded` 23% (a rescue that gave up control). `_reflex_low_health` is in 70% of all deaths but
fires at ~2 s to go, too late. Falls get no reflex at all (3% low-health); they are a path-planning failure (no
pre-move check of the drop; 187 stalagmite impalements).

## Near misses and exposure

- Danger reflex events run at enormous rates (fleet, per 1,000 bh): `_drowning_up` 6,501, `_drowning_route` 6,175,
  `_entombed` 5,228, `_reflex_drowning` 3,977, `_lava_corridor` 1,162, `_drowning_to_air` 722 (completed
  rescues), `_drowning_escaped` 708. Completed air rescues (122 k) outnumber drowning deaths (3.4 k) ~36:1.
- **Low health is nearly terminal**: of 9,913 fleet episodes where health crossed from >6 to <=6, **72% ended in
  death within 5 min** (showcase 40 of 54, 74%). In peaceful, health regenerates, so low health only happens in
  air/lava/wall emergencies that the bot is already losing.
- 36,000 fleet health drops of >=4 hp between consecutive events; 4,367 went to zero.
- Showcase: entombed 4,752 / 1,000 bh, `_reflex_stuck` 3,013, lava step/target modes ~900; drowning rows only ~55.

## Items lost

5,536 deaths with inventory: **1.90 M items, median 300 per death** (dropped items despawn after 5 min unless
recovered). Top: cobblestone 439 k, bamboo 301 k, oak_log 177 k, leaf litter 176 k, saplings 119 k. Valuable:
stone pickaxe 9,521 (3,573 deaths), wooden pickaxe 17,637, iron pickaxe 1,637 (1,107 deaths), buckets 2,795,
iron ingots 2,664, torches 19,433, chests 14,554, **diamond pickaxes 87**, diamonds 91. Bots carry far more than
they need (median 300 items), which makes every death expensive.

## Top death scenarios

1. **Underwater with no air route, reflex runs and loses** (drowning, idle, y 40-62): 2,865 deaths, 47%.
   `_drowning_route`/`_drowning_up` fire, `_drowning_ceiling_no_air`/`_water_no_air_route` follow; death in ~3 s
   from 1.7 hp. Cause known from earlier work: the air-route scan was axis-only and rescues yielded control.
2. **Lava contact underground or on the surface** (lava, idle, y < 40 and 63-79): ~730. Lava was visible at the
   last decision 92% of the time; `_lava_corridor`/`_reflex_danger_block` fire; death in 2 s.
3. **Falls during movement** (explore/gather/goto, y < 40 mostly): ~800, plus ~360 idle falls (e.g. after an
   escape dig). One-hit, no reflex.
4. **Suffocation while entombed** (y 40-62): 141, all with the low-health reflex, 73% with an entombed/escape event.
5. **Repeat trap**: 8% die again within 8 blocks inside 24 h.

## Requirements for the new platform's reflex layer

1. **A survival layer below the planner, with its own tick (<= 250 ms) and authority to pre-empt any skill.** The
   LLM's last decision is 16-24 s old at death; the kill takes 2-3 s. No LLM-mediated response can work.
2. **Air budget, not air alarm.** Track oxygen (300 ticks) and compute a *verified* path to breathable air
   (full 3D BFS over known blocks, including dig-up and place-block-to-make-pocket options) **before** entering
   water or flooded caves, and keep it continuously. Trigger escape at a margin (time to air * 1.5 > remaining
   air), not at critical state. Rescues must never yield control while air is falling.
3. **Lava as a hard path constraint.** The pathfinder must treat lava and lava-adjacent cells (and blocks whose
   removal exposes lava/flowing lava) as forbidden; carry and auto-use a water bucket or blocks to seal lava; never
   dig the block under or beside you if the cell beyond is unknown/lava.
4. **Fall-safe movement.** Every move/dig checks the drop (max 3 blocks without water/hay), refuses digging
   straight down, checks dripstone below; explore/gather/goto are where falls happen.
5. **Suffocation/entombed**: a deterministic dig-out (pickaxe-aware) that always ends in air; never place or fall
   into a 1x1.
6. **Low-health means retreat early**: act at <= 10 hp with the cause known, not at 2-3 hp.
7. **Death memory**: record death sites and refuse plans through them (the 8% repeat rate); recover drops within
   5 min when the cause is gone.
8. **Carry less**: bank at a threshold so a death costs tens of items, not 300; keep tools in a chest copy.
9. Instrument the reflex layer so each emergency logs start, chosen remedy, outcome (survived/died) in one row:
   the current stream needs 2-min windows and regexes to reconstruct that.

## Moving peaceful -> easy -> normal

Nothing in these 6,139 deaths tests mobs, hunger or night. Easy/normal add: hostile mobs at night and in caves
(zombie, skeleton, creeper, spider), hunger drain and starvation damage (easy stops at 10 hp, normal at 1 hp),
and creepers that destroy built work.

**Must exist before easy** (gate: each tested on a test world with mobs, not peaceful):
- Hunger: food acquisition (farm/animals/cooking) and eat-at-threshold reflex. The current `_food_skip` and
  `_peaceful_kit` (no swords, no food) must be switched off; today bots *burn wooden swords* and skip food.
- Combat reflex: equip best weapon, face and strike nearest hostile, retreat below a health threshold; shield or
  block wall. Skeleton/creeper specific responses (close distance / back off from a hissing creeper).
- Night/shelter: be in a lit, enclosed space or a bed at night; place torches (since 1.18 hostiles spawn only at
  block light 0, so any torch light in a space prevents spawns there) in mines and around the town.
- Armour crafting and wearing (iron by default).
- Regeneration waits: do not resume risky work below ~14 hp.

**Must exist before normal**: full starvation handling, creeper-proof building or repair, multi-mob retreat,
cave-mining under torchlight only, zombie-door awareness.

**Death rates to beat** (per 1,000 bot-hours; one bot-hour = one fully active bot hour):

| stage | target | basis |
|---|---|---|
| new platform, peaceful | **<= 3** (all causes) | current showcase 3.6, best fleet builds 3-11 |
| peaceful environmental only (drown+lava+fall+suff) | **<= 2** | Nov fleet 8.3; showcase 3.6 |
| easy | **<= 5** total, mob deaths <= 2 | peaceful baseline plus a small mob share |
| normal | **<= 8** total, starvation 0 | no worse than the November fleet on peaceful |

A promotion gate between difficulties should need >= 1,000 bot-hours (so a rate of 3 shows as ~3 deaths, and a
doubling is visible) with **zero** deaths of a class the reflex layer claims to handle, and the low-health
episode death share (now 72%) below 25%.

## Caveats

- Y-band exposure uses event counts, not time; events are dense (~12/min) and roughly uniform, but reflex storms
  inflate the event share of danger zones, so the per-hour risk ratio for y < 40 is if anything understated.
- "Water/lava seen" comes from the decision snapshot counts, not the exact death cell.
- Deaths before 10-08 cannot be checked against a logged difficulty; 0 mob deaths and constant hunger 20 make
  peaceful the only consistent reading.
- Death-message inventory lists only the top 6 drops; item totals use the full `bot.inventory` at death.
