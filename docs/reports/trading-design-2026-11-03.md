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

1. **Showcase village 6_1 is a dead end.** Its 7 villagers are stuck inside village-built trapdoor rings; freeing them would
   break village blocks. Leave it (recommended), or a one-off owner world fix (open one trapdoor), logged.
2. **How far may a trade trip go?** Fleet buyers are 554-605 blocks out; expeditions today stop at 300. Recommended: one
   surveyed route <= 650 blocks per town, 10-minute trip budget.
3. **What to buy.** Recommended: building blocks for monuments first (mason), books only when a librarian is seen.
