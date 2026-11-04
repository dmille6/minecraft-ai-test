# Villager trading in peaceful — design (2026-11-03)

Owner 11-03: "yes design all using both claude and codex, put them in the queue and implement and deploy where you feel is
right". Item: villager trading. Claude's design and Codex's independent design (`codex exec`, read-only, given the
measurements and the goal, not Claude's design) are both below, then the reconciliation.

## 1. Measurements (11-03 ~20:45Z, read-only copies)

Method: a stdlib NBT reader (`sandbox/trading/census/villagers.py`, `poi.py`) over **copies** of each world's `entities/`,
`poi/` and `playerdata/` folders (copied to /tmp on the host, never the live files), plus the town index and the bot rows.
A saved entity file holds only chunks that were generated and saved; the counts are of those chunks.

**Showcase** (10 bots, home 0,70,0, simulation-distance 6, peaceful, `mobGriefing=false`, `keepInventory=true`, daylight on,
`doTraderSpawning=true`, Paper 1.21.8-60):

| | |
|---|---|
| Villagers in 1,569 saved entity chunks | **63** in 7 villages |
| Employed (profession other than none/nitwit) | **0 of 63** (58 none, 5 nitwit) |
| Villager trade offers | **0** |
| Positive control (same parser) | 9 offers on 1 wandering trader at -70,63,-65; 13-23 employed villagers per fleet world |
| Villager deaths in 18 server logs (`log-villager-deaths: true`) | 0 lines mentioning a villager (no positive control: no death to see) |

- **village-taiga-6_1** (protected box x49..157 z-59..45, ~85 blocks E of home, inside the simulation distance): 7 villagers,
  all unemployed. 4 stand at 80.3,73,-3.7 inside a ring of spruce trapdoors; 3 at 87-89,76,12 inside a trapdoor ring in the
  leatherworker house. Their brains hold `last_worked_at_poi` up to tick 14.3 M (world tick now 24.6 M, about 6 days ago) and
  `potential_job_site` on the cauldrons 3.7 blocks away. Free job sites: fletcher 109,76,11; weaponsmith 122,64,-13 / -15.
  These villagers are **physically stuck**; freeing them means breaking village blocks, which the owner forbids.
- **village-taiga-23_-20** (~500 blocks NE): 8 villagers (2 nitwit). Job sites cleric 1, librarian 2, shepherd 2, toolsmith 1,
  weaponsmith 5, most with free tickets. **village-snowy-1_54** (~860 blocks S): 13, all unemployed, several holding
  `potential_job_site` memories: they were loaded briefly by a passing expedition and unloaded before they reached a job.
- Showcase bots' XP (playerdata copies): **levels 6-11 on all 10 bots** (XpTotal 91-210). XP is not in the bot telemetry.
- Showcase surplus: town chests (18 containers, last observation of each) coal **112**, iron_ingot 140, lapis 196. Bags
  (10 bots): coal 0, sticks 11, wheat 0, paper 0, emerald 0; every bot holds a bucket; cobble is abundant.

**Fleet** (80 bots, 16 worlds, peaceful): employed villagers in every world that has villagers in its explored chunks
(4 worlds have none: board-b, hive-d, placebo-a, placebo-d). **All employed villagers are level 1** (no one has ever traded).

| Pool(s) | Town | Villagers / employed | Nearest employed from the town |
|---|---|---|---|
| board-a,c,d, hive-a,b, isolated-a..d, placebo-c (11 pools) | 355,73,147 | 33-56 / 12-23 each | **554-605 blocks** |
| hive-c | -68,68,-68 | 6 / 2 | librarian 281, farmer 300 |
| placebo-b | 282,65,-388 | 19 / 12 | leatherworker 288, librarian 293, armorer 321 |
| board-b, hive-d, placebo-a, placebo-d | | 0 / 0 | none in explored chunks |

Novice offers seen (4 worlds): farmer wheat 20 / carrot 22 / potato 26 / beetroot 15 -> 1 emerald; 1 emerald -> 6 bread;
armorer, toolsmith, weaponsmith coal 15 -> 1 (fisherman coal 10); cartographer, librarian paper 24 -> 1; cleric rotten flesh
32 -> 1, 1 emerald -> 2 redstone; leatherworker leather 6 -> 1; mason clay 10 -> 1. Fleet town chests (461 containers, last
observation each): **coal 4,619**, lapis 4,377, iron 1,125, wheat 15, sticks 18. Bags (80 bots): coal 26 total, 0 emerald.

## 2. Paper sandbox proof (sandbox4, 11-03, `sandbox/trading/trade-proof.cjs`, `scout-proof.cjs`)

Setup by RCON on a floating glass-walled arena (sandbox only): summoned unemployed villagers, `give`, `tp`, `xp`.

| Fact | Result |
|---|---|
| A bot-placed job site (survival `placeBlock`) is claimed by an unemployed villager in a loaded daytime chunk | **YES, 5.5 s** (smithing table -> toolsmith; fletching table -> fletcher) |
| ... with `mobGriefing=false` (the showcase's value) | **YES, 5.5 s**. The gamerule is not why the showcase has no jobs |
| `bot.openVillager` parses the 1.21.8 trade list | **YES**: inputs, outputs, uses/max, realPrice, xp |
| `villager.trade(i, 1)` SELL, server-confirmed (`clear <bot> <item> 0`) | **YES**: coal 40 -> 25, emerald 10 -> 11 |
| `villager.trade(i, 1)` BUY, server-confirmed | **YES**: emerald 11 -> 10, stone shovel / hoe / pickaxe 0 -> 1 |
| Villager health after trades | 20.0 before and after; villager Xp 0 -> 3 |
| Novice offers are random per villager | **YES**: three toolsmiths, two had coal -> emerald, one did not. A target must be an OBSERVED offer |
| Client sees a villager's profession without trading | **YES**: metadata 18 = {villagerType, villagerProfession (registry id), level}; ids matched the server census |
| `bot.experience` | {level, points, progress} |
| Anvil: `anvil.combine(pick, mending book)` | **NO**: refuses "Not anvil-able" (prismarine-item prices with pre-1.20.5 NBT); a hand-driven window got no result. UNPROVEN |
| Enchanting table (`openEnchantmentTable`, `putTargetItem`) | **NO**: "invalid operation". UNPROVEN |
| `bot.openVillager` on a wandering trader | not tried; the plugin asserts the villager entity type (Codex). Needs its own opener |

## 3. Claude's design

1. **Counterparties first.** The showcase has none, so trading starts as an instrument: every bot logs the merchants it can
   see and its XP (`_merchant_seen`, `_xp`; piece T1). Within days that answers which villagers are employed and where, on
   both worlds, from the bots' own eyes rather than from region files.
2. **Sell what is surplus and renewable, buy what builds.** Sell coal (fleet chests 4,619) to armorer/toolsmith/weaponsmith/
   fisherman novices; later stone/cobble-derived goods to masons (stone 20 -> 1 at apprentice) and sticks to fletchers.
   Buy decorative blocks (mason: bricks, then terracotta / quartz at higher levels) and tools only when a town ask names them.
   Food is worthless in peaceful (no hunger drain), so no bread purchases.
3. **Trade where it is legal.** Fleet worlds have no village zones: a trade visit is an expedition with a destination.
   Showcase villages are protected boxes; a bot may only walk (no dig, no place, no scaffold, no door/trapdoor use) and stand
   within 3 blocks of a villager. 6_1's villagers are stuck behind village blocks and are out of reach for good.
4. **Make showcase villagers employable without touching the village.** A bot that parks for ~10 minutes in daylight within
   96 blocks (simulation distance) of 23_-20 or 1_54 keeps the chunks ticking; the sandbox shows a reachable free job site
   is claimed in seconds. The scout's rows then show `changed ... toolsmith`.
5. **XP use later.** Levels 6-11 exist; anvil and enchanting-table automation are unproven on 1.21.8 and wait for their own
   sandbox proof.

## 4. Codex's independent design (summary of its answer, 11-03)

- A shared **merchant catalogue** (world, UUID, last position, observed offers, prices, stock, route); saved entities and POIs
  are scouting candidates only, **only a live merchant window establishes an executable trade**.
- **Sell coal first**, behind reserves for fuel, torches and committed builds; per-town surplus, not fleet totals. Later
  renewable sticks/paper/crops. Do not assume lapis or cobble has a buyer; no hostile-drop plans in peaceful.
- **Buy against town requests** with price ceilings: building materials, equipment, exact enchanted books (Efficiency,
  Unbreaking, later Mending). Advanced stock is unproven (all novices).
- Trips chosen by return per round-trip minute; **one merchant worker per town**, leased; initially **one surveyed route
  <= 650 blocks**, 10-min trip budget, 2-min dwell, return reserved; one attempt per town-hour; cooldown on failure. Existing
  expeditions use spokes, avoid protected villages and cap at 300 blocks, so a targeted destination is new work.
- Showcase: never touch trapdoor rings, cauldrons, any village block; never push, transport, trap, attack villagers. Bounded
  daytime visits may let remote villagers claim existing workstations, but never promise employment; entry needs a proven
  walk-only approach. The protectzone survival/deep exemptions are not this feature's safety argument.
- The **wandering trader** is a separate showcase bridge (water bottles -> emeralds since 1.21.5), needs its own opener.
- Add XP telemetry; anvil and enchanting later, proven separately.
- **First piece: fleet**, board-a: withdraw surplus coal, visit one confirmed coal buyer, up to four sales, return, deposit
  emeralds. Tier 3 (unproven Paper/mineflayer behaviour): two engines, sandbox proof, the one canary slot.

## 5. Reconciliation

| Point | Claude | Codex | Taken |
|---|---|---|---|
| First piece | T1 scout (read-only, showcase first) | fleet coal pilot (tier 3) | **Both, in order.** T1 ships now (tier 1, no behaviour); the coal pilot is T2 and needs T1's rows to pick its villager and route |
| Catalogue | scout rows | catalogue incl. offers | Scout rows (profession/level/position) now; **offers** join when T2 opens a window (only a live window is truth) |
| Trading tier | tier 2 outside protected scope | tier 3 (unseen behaviour) | **Tier 3 for T2**: the trade itself is now proven in Paper, but a 550-600-block targeted walk is movement (expedition code, `goto` legs); the trade module stays non-protected |
| Showcase | park near 23_-20 to employ villagers | same, never promise | Agreed; T3, after T1 shows whether anyone is employed |
| Sell list | coal, then mason stone, fletcher sticks | coal; no lapis/cobble buyer assumed | Coal first; mason stone only once a mason is observed |
| Wandering trader | not planned | separate bridge | Kept as an option (T5), needs its own opener and the trader despawns |
| Food | none (peaceful) | not raised | none |
| XP | later | later, telemetry now | `_xp` in T1; anvil/table after their own proof (both failed in the sandbox today) |

## 6. Pieces and tiers

| Piece | What | Tier | Lane |
|---|---|---|---|
| **T1 trading-scout-01** | `_merchant_seen` + `_xp` rows, read-only (BUILT: branch `trading-scout-01` on the showcase release) | 1 | showcase, then fleet owner-direct |
| T2 coalsale-01 | one bot per town, a surveyed route to one observed coal buyer (<= 650 blocks), up to 4 sales, deposit emeralds; `trade.mjs` (pure offer choice + server-confirmed executor) | 3 (route), trade module non-protected | fleet canary (P) |
| T3 villagevisit-01 | showcase: a daylight wait of ~10 min within 96 blocks of 23_-20 / 1_54, outside the zone box; scout rows decide | 2 (no new movement primitive if it reuses expedition legs; else 3) | showcase |
| T4 buy-01 | spend emeralds on town asks (mason blocks for monuments; books when a librarian is observed) | 2 | fleet, then showcase |
| T5 trader-01 | wandering trader: water bottles / baked potatoes -> emeralds; own opener | 2 | showcase |
| T6 enchant-01 | anvil + enchanting table with the bots' levels; sandbox proof first (both failed on 1.21.8 today) | 2 | after its proof |

## 7. Queue placement

- **T1 on the showcase** with the next fold (it is read-only; it only adds rows). Claude: fold with the next showcase
  release, before the 10 -> 15 bot step (more bots = more sightings). Codex: XP telemetry first, no objection to the scout
  as a separate increment. Then a tier-1 owner-direct fleet rollout with a 60-min tripwire when the slot is free.
- **T2 in the fleet lane as a P item**, after T1 has ~24 h of fleet sightings (it needs a confirmed buyer per town) and
  behind bagdiet-01 / swimcentre-01 / bundle-1103a. Codex: same, tier 3, do not bypass the blocked head.
- T3 on the showcase after T1's first 24 h, only if T1 shows a reachable unemployed villager beside a free job site.

## 8. Owner decisions needed

1. ~~Showcase village 6_1 is a dead end~~ ANSWERED 11-03: bots may open doors/trapdoors; T3a villageunlock-01 (section 9).
2. ~~How far may a trade trip go?~~ ANSWERED 11-03: no fixed budget; expedition guardrails + a 45-min stranded cap (section 9).
3. ~~What to buy~~ ANSWERED 11-03: mason building blocks first; books after the anvil proof (T6).

## 9. Owner answers 11-03 ~21:45Z and what changed

1. **"we can edit the world when it comes to opening doors etc, that is fine."** Read (control session): bots may open or remove
   village doors / trapdoors / fences to free villagers; still no admin commands. **New piece T3a villageunlock-01, built.**
2. **"why do we need a 10 min budget on trading? why not let the bots roam?"** T2 is redesigned below without a fixed trip
   budget.
3. Mason building blocks first stays; books wait for the anvil proof (T6).

### T3a villageunlock-01 (showcase, tier 3: it adds one allowance to `protectzone.mjs`)

**Facts it rests on (region copy 11-03).** The 6_1 rings are OPEN bottom spruce trapdoors facing outward:
- 79..84,73,-5..-3 holds 4 villagers in 3 walkable cells (the 4th cell has leaves at head height).
- 86..89,76,10..12, in the leatherworker house, holds 3 villagers in 2 cells. Only its north side opens onto the house floor;
  the other 4 trapdoors back onto cobble walls with panes above.

**Sandbox4 proof** (`sandbox/trading/unlock-proof.cjs`, a replica of the outdoor ring):

| Step | Result |
|---|---|
| Control: ring intact, 90 s | still jobless |
| One side (4 trapdoors) closed, 90 s | still jobless |
| Whole ring closed | a job in 5.7 s |

The bot toggled each trapdoor with a survival `activateBlock`. All 10 trapdoors stayed in place (a state change only), and the
villager kept health 20.

**Design.**
- `bots/src/villageunlock.mjs` `penAround` floods the feet level from the villager (at most 12 cells).
- It collects only barriers that are a real way out: an OPEN **bottom-half** wooden trapdoor with a solid block under it and
  room above it, or a CLOSED fence gate. The cell beyond it must be standable: level, one step down or one step up.
- A drop or a step-up inside the pen means the villager is not penned. A pen with nothing to toggle is `walled` and is left
  alone. Nothing is ever broken or placed, and doors, beds, job sites and chests are never touched.
- The candidate is a jobless adult villager seen in the same cell for at least 20 min, by sightings less than 10 min apart and
  the newest less than 5 min old. It is fed from the merchant scout.
- The ask runs first in `buildOrder`'s idle branch. Limits: one try per villager per 6 h, one per bot per 30 min, and one bot
  per pen through a pool lease file.
- The skill walks there, then re-checks two things: the villager (by uuid) is still there, jobless and penned, and each barrier,
  right before its click.
- The one guard change: `protectzone.mjs` lets `activateBlock` through only for a wooden trapdoor or fence gate whose exact
  cell the running unlock named (`withUnlockScope`). Every other op and block stays refused.

**On the real fixture** it collects 7 trapdoors for the outdoor ring and 2 for the house ring (the 2 onto the house floor).

**End-to-end on this code** (`sandbox/trading/unlock-e2e.mjs`, sandbox4, a protected zone over the arena):

| | Outdoor-ring replica | House-ring replica |
|---|---|---|
| Plain `activateBlock` without the scope | refused | refused |
| Trapdoors toggled | 10 | 4 (6 left open) |
| Trapdoors still in place | all | all |
| Villager job after the run | toolsmith | toolsmith |
| Next ask | null | null |

**Tripwire.**
- S4 compares block NAMES, so a toggle is INTACT. Main's `showcase_trip.py` `canon()` now cuts a `[state]` suffix from
  trapdoor and fence-gate names only. A removed or different block is still a BREACH.
- The selftest gains 5 assertions. `infra/showcase/test_trip_unlock_mutants.py` kills 4 of 4 mutants, and the S6 suite still
  kills 17 of 17.
- S6 H3 needs no change: it counts `_build` place/clear/replant rows only.
- **Not installed.**

**Reviews (two engines).**
- Round 1: Codex raised 3 blockers: a two-bot re-open, shutters and hole covers being collected, and a stale sighting.
  Claude (an independent subagent) found none.
- r1 fixed all three. The re-check found the stale-lease takeover still racy.
- r2 fixed it with `takeLease`: announce then check over per-slot O_EXCL files. Codex: FIXED, no new blocker.
- The tripwire rule had no blocker from either engine. Both asked for a narrower state strip; r1 did that.
- Branch `villageunlock-01` = `982db9e6`.

### T2 coalsale-01, redesigned without a fixed trip budget

**Measured** from the showcase expeditions (196 trips in the logs):
- Round-trip speed is a median **2.95 blocks/s** (p10 2.02, p90 4.09).
- The longest trip went 313 blocks out. 56 of 196 stopped on their own time cap, and 35 of 196 visits ended "still on the way
  home".

**Travel time.** A 600-block trade trip is 1,200 blocks of walking:
- about **6.8 min** at the median speed;
- about **10 min** at p10, before any dwell.

A fixed 10-minute budget would cut many trips off before the villager.

**Guardrails (expedition-style).**
- One trip per bot at a time.
- Breadcrumbs and markers both ways, reusing `expedition.mjs` `nextCrumb` / `markerHome`.
- Town reserves are left alone: only coal above the town's own reserve and fuel need is carried, and at most 4 trades' worth
  (60 coal).

**Turning home.** The bot turns home for a reason, not on a timer:
- every carried coal is sold;
- the buyer's coal offer is used up (`nbTradeUses == maximumNbTradeUses`) and no other buyer is known;
- 4 emeralds are earned;
- night falls (a trade needs an awake villager);
- health is at or below 10;
- the bag is full.

**Roaming.** When the known buyer has nothing, the bot roams for more buyers:
- legs of about 64 blocks in a spiral around the village;
- the scout logs every villager it sees (`_merchant_seen ... trades=yes`), and an offer is only trusted once a live window
  shows it;
- at most 3 legs per trip.

**Safety cap: 45 min**, only for a stranded or lost bot, never as a work budget.
- It is about 4.4x the slow (p10) round trip at 600 blocks.
- At the cap the bot walks home over its breadcrumbs and writes `stop=stranded`.

**Where.**
- First the pools whose nearest employed villager is within reach. Measured 11-03: hive-c (librarian 281) and placebo-b
  (leatherworker 288, librarian 293, armorer 321).
- Then the 11 shared-seed pools, at 554-605 blocks.
- A per-town "known buyer" comes from 24 h of scout rows.

**Tier 3:** a targeted long walk uses `goto` legs and expedition code. The trade executor itself (`openVillager` + `trade`,
server-confirmed) is proven in sandbox4. It is not built yet.

### Queue (updated)

- T1 trading-scout-01 and T3a villageunlock-01 go to the showcase **together**; T3a builds on T1's branch.
- Then read the 6_1 villagers' jobs over the next 24 h on the showcase. The scout rows say `changed ... <profession>`.
- T2 in the fleet lane after T1's fleet sightings, as a P item behind bagdiet-01 / swimcentre-01 / bundle-1103a.
- The showcase trade visit (selling to the freed 6_1 villagers, about 85 blocks from home) becomes the simplest T2 test
  ground once one is employed.

## 10. T2 coalsale-01 + T4 built (11-04, OWNER "do 1 and 2")

**Branch and base.** Branch `coalsale-01` on fleet `704acf91`. Tier 3: `cognitive.mjs` and `admission.mjs` change.
Registration `~/mcai-analysis/coalsale-01.<sha8>.json` (effectwatch: valid) and a draft entry, `.entry.draft.json`, both on the
canary host. Not queued.

**Buyer list.** The census (`bots/src/merchantcensus.json`): employed villagers per pool, read-only, 11-04. Every window's
offers are logged as `_trade_seen`, and every villager met on a trip as `_merchant_seen via=trade_trip`. That is what the merchant
scout would confirm.

**Trip, in phases.** One `trade_trip` call per phase step, each inside the runner's 180 s:
1. **stock:** one draw per trip, recomputed at the draw; only coal above a town keep of 64, at most 60 carried.
2. **out:** walk to the destination, a breadcrumb every 24 b.
3. **trade:** coal buyers first. Coal is sold only on offers seen in the window. Then mason building blocks, and one wanted
   book once one is offered.
4. **roam:** 3 legs of 64 b round the village when nobody buys.
5. **home:** the breadcrumbs back, nearest first.

**Turning home.** For a reason: sold, goal, night, health, bag full, no coal, a trade error. There is no work timer: 45 min is
the stranded-only cap, and at 60 min the trip is dropped. A death ends the trip.

**Admission.** The gate admits each call like `deep_mine`. Without that, the 5th identical call was refused and the bot was
stranded (both engines found it).

**Proven, sandbox4 E2E** (`sandbox/trading/coalsale-e2e.mjs`):
- 60 coal -> 4 emeralds -> 40 bricks, then home over the crumbs; server-confirmed.
- BOOK=1: 60 coal -> 4 emeralds -> a Mending book, decoded as `minecraft:mending`.

**Not proven:** a 600 b walk, roaming, the night turn-home, and the draw from a town chest.

**Showcase variant.** Later, once village-taiga-6_1's villagers have jobs (villageunlock-01 kept and promoted). On the showcase
the trade must stand inside the village box with no dig and no place. That needs a walk-only approach into a protected zone,
which is another protected-scope review.

