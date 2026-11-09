# villagecon: the villager economy — bread, beds, pens and a herd (design, 2026-11-09)

**Owner 11-09 ~12:45Z, "i want all of those things done".** This covers two items:

1. Expand the crop farm and add animal pens: a sheep pen for wool and a cow pen, both bred with wheat, with bread for the villagers.
2. Upgrade the village near town: beds and job blocks the freed villagers can reach, and food so they breed.

The goals are employed villagers, births and trades. The showcase goes first, then a fleet port. Ledger row `villagecon-1109`.

**Built:**
- `villagefeed-01show`: bread for villagers, and beds where a cluster has none. Branch `villagefeed-01show` @ `c404c0e0` on showcase `b9fa002e`.
- `pens-01show` + `herd-01`: two fence pens near town, and a herd that is fetched with a wheat lure, bred and sheared. Branch `pens-01show` @ `f8bcf531`, stacked on villagefeed.
- Fleet port of the feed: `villagefeed-01-on-f9d70a5` @ `08c5b154`, on the trade chain's market-03.
  - Registration and a draft entry are on the canary host, **held**.

Neither showcase piece is staged.

**Pictures:**
- [`v61-before.png`](villagecon-2026-11-09/v61-before.png) and [`v61-after.png`](villagecon-2026-11-09/v61-after.png): village 6_1 and the town's east edge from above, drawn from a read-only copy of the world.
  - Beds are red: white outline = a free POI ticket, dark = claimed.
  - Villagers are blue. Job sites are orange and the bell is yellow.
  - The zone box is magenta; the thin line is its +3 pad.
  - *After* adds the beds the feed run brings (pink, outside the pad; illustrative cells, since the live choice is `bedCells` at the click) and the fed adults (green rings).
- [`pens-layout.png`](villagecon-2026-11-09/pens-layout.png): the two pens from above, with the gates in the wall facing home, the walkway between the rings, a sheared sheep, a lamb and two cows.

## 1. Measured (showcase world copy 11-09 12:40Z, read-only; telemetry via `scripts/lib/telemetry.py`)

| What | Number | Denominator / control |
|---|---|---|
| Villagers in the world | 63, **0 employed** (58 none + 5 nitwit) | 1,592 entity chunks |
| Villager inventories | **63 of 63 empty** | Every villager has `CanPickUpLoot 1b` (positive control for pickup) |
| Village 6_1 | 7 adults, all penned. POI: 5 homes (3 tickets free), 2 weaponsmith, 2 leatherworker, 1 fletcher, the bell | Births in 3 days of mobGriefing: 0 |
| Sheep within 100 / 200 / 400 b of home | 1 / 9 / 68 | cows 0 / 22 / 53, pigs 1 / 35 / 64, chickens 1 / 7 / 47 |
| Town containers within 120 b | wheat 195; seeds, bread, carrots, potatoes, wool, string, leather, fences: 0 | 360 containers; spruce logs 546, iron 177, coal 112 |
| Crop farm (cropfarm-01show) | 20 cells; 192 wheat harvest digs in 96 h | **9 of 47 visits on 11-09 stopped `harvested_0 (town_cap)`**: the 128 cap binds, so the wheat needs a use |
| Market | 0 trades in 40 h | 457 runs and 7 trader windows in 48 h |
| Fleet villagers (merchant census, employed) | nearest **282–301 b** from home (hive-c, placebo-b); 554–747 b elsewhere | 16 pools, 0 within 160 b |

## 2. What decides a birth (measured, not assumed)

| Fact | Evidence |
|---|---|
| A tossed loaf **is** picked up by a real villager | `sandbox/econ/feed-proof.cjs` (sandbox7): picked up from 1.5, 5 and 7 b (missed once at 3 b), and over an OPEN-trapdoor ring from 3 b outside (6_1's pen shape). The client sees it: `playerCollect`, collector = the villager. |
| The 11-06 "tossed bread never picked up" was a **sandbox artefact** | `pickup-debug.cjs`: `summon villager ~ ~ ~ {nbt}` skips finalizeSpawn, so the villager has `CanPickUpLoot 0b`. With 0b: no pickup in 18 s beside the loaf. Set to 1b: picked up within 6 s. All 63 real villagers have 1b. |
| **Beds limit births** | Feed-proof B: two adults fed 3 loaves each, with 2 beds for the 2 of them, ate the bread and made **no baby** (vanilla digests the food, then looks for a vacant bed). With 3 beds: a baby in ~100 s. Every adult claims a bed, so a cluster has room only while beds outnumber villagers. 6_1 has 5 beds for 7. |
| A jobless villager never shares food | `share-proof.cjs`: 8 bread held 160 s beside an empty neighbour, nothing thrown. So bread must reach each parent. |
| The nearest villager takes a loaf | Across 22 recorded e2e runs, 67 loaves: 33 to the target, 21 to a neighbour, 13 to nobody. Two jobless adults huddled in a 45 b box is the worst case. |

## 3. The designs (Claude + Codex + an independent Claude), reconciled

Codex's design is in [`villagecon-2026-11-09/codex-design.txt`](villagecon-2026-11-09/codex-design.txt). The independent Claude design is summarised in the reconciliation below.

| Point | Claude (this session) | Codex | Independent Claude | Taken |
|---|---|---|---|---|
| First piece | bread delivery | farm budget, then the unlock | proof first (toss unproven) | **Proof first, then the feed.** The toss is proven, and the old failure is explained (CanPickUpLoot). |
| Beds | 3 free tickets suffice | "tickets are candidates, not proof" | **beds are the limiter** once freed (7 adults, 5 beds) | **The bed-room rule.** Feed only where beds > villagers. Otherwise bring beds from the town's wool. |
| Wool source | shear what the cottages see | herd: lure, breed, shear | pens + herd (tier 3) | **pens-01 + herd-01.** |
| Job blocks | new piece | coordinate with jobsite / market | composter first | **No new piece.** `market_job` already places smithing table / composter / barrel / fletching / stonecutter / grindstone / cartography beside free jobless villagers. It waits on villageunlock (fleet KEEP first). |
| Carrots / potatoes | village farms | village crops or shipwreck / outpost chests; never wandering traders | census first; protected village crops need an allowance | **Not built.** No source near the showcase town, and 6_1 has no farm. The wheat cap binds first, so more wheat would only wait. |
| Pens | shared middle wall | two 7x7 pens, two-gate vestibules | 9x9, a vestibule | **Two separate 9x9 rings, a walkway between, one gate each.** Every fence is reachable from outside. The gate protocol is: open, through, closed behind, read back. |
| Animal pens' tier | 3 | 3 (sandbox success does not downgrade) | 3 | **3:** two engines plus a search (section 6). |

## 4. villagefeed-01show (tier 2; `VILLAGEFEED=off` rolls it back)

`bots/src/villagefeed.mjs` (pure) and the skill `village_feed`, asked by `marketAsk` after the market run and the job block, before the walk-in trip.

- **Every ask notes the villagers the bot sees.** These go into the town file `villagefeed-<hk>.json`, under a mutex, at most once a minute per bot.
  - A baby first seen within 24 b of a fed adult logs **`_villagefeed op=birth fed=1`**, and clears the adults beside it to be fed again.
  - A baby seen elsewhere logs `fed=0`. This is the control.
- **The run:**
  1. Make bread at the town table from wheat above a keep of 48 (bag bread first).
  2. Walk in legs to the hungriest cluster of at least 2 adults within 160 b.
  3. Count the **bed room**: bed feet within 48 b, against villagers within 48 b.
     - **No room:** place the beds this run crafted from town wool (the market's `mkPlaceBed`: outside the zone + pad, 2 a day), then count again. Still no room: nothing is tossed, the count is noted, and the cluster is not visited for 6 h unless the town has wool.
     - **Room:** toss one loaf at a time from ≤ 2 b, standing on the far side of the target from its nearest neighbour, with clear targets first. Each loaf is credited to the villager whose `playerCollect` took it.
  4. Walk home.
- **Bounds:**
  - 3 loaves per adult, fed again only after a birth beside it.
  - At most 24 loaves a town per day.
  - One run per bot per 45 min.
  - One run per town at a time (a lease).

**Proofs (`sandbox/econ/feed-e2e.mjs`, the real `marketAsk` → `SKILLS.village_feed.run`):**

| Mode | Result |
|---|---|
| default (3 beds) | 6 loaves made, 6 tossed, 6 taken by the targets; a baby 17 s later; the next note logs `op=birth fed=1` |
| noroom (1 bed, 2 adults) | nothing tossed; `room=-1` noted |
| beds (1 bed + 6 wool in town) | run 1: no room. Run 2: 2 beds crafted and placed, `room=1`, fed 6/6, a baby 43 s later |

**Tests:** `villagefeed.test.mjs` 23/23. They include a two-process test of the town file's mutex, which **fails** with the mutex disabled (40+40 updates, fewer in the file).

**Reviews:** Codex r1–r4, blockers fixed:
- lost ledger updates (a mutex was added);
- the day cap was ignored in the toss loop;
- an unlocked fallback write;
- a kit bed of another colour could be placed.

## 5. pens-01show + herd-01 (tier 3 for the entity behaviour; `PENS=off` rolls it back)

- **`pens.mjs`: the layout.** Two 9x9 fence rings with a 1-wide walkway between them; every fence sits on a ring's outside edge.
  - **Gates:** one in each ring's front wall, the wall facing home. `ws` = facing into the pen, closed. `townstyle.mjs orientAim` aims a gate like a stair: its yaw from the floor's top face.
  - **Level:** the 19x9 box is levelled to L. A bump is cut and a dip is filled. A fence on a lower column is half a block high from inside.
  - **Siting:**
    - ≥ 30 grass on the sheep floor;
    - the farms zone first, then the town ring;
    - 12–48 b from home, inside Paper's 32 b animal activation range of the bots' rounds;
    - the stands' domain keeps the builder off both floors.
  - **Order:** a project after the crop farm.
- **The pens' visit (`buildPens`).** Fences and gates are crafted from the town's plentiful wood and built by `runVisit`. Then upkeep runs `herdVisit`, chosen by `herd.mjs` in this order:
  1. **Shear:** a woolly adult, town wool under 64, shears made from 2 town iron.
  2. **Breed:** ≥ 2 adults, fewer than 6 per pen, 6 min between breedings, wheat above a keep of 32.
  3. **Fetch:** for a pen short of 2 adults, the nearest wild animal remembered within 160 b. Any bot near the pens notes sightings.
     - It is lured with wheat in legs of ≤ 5 b, and tempted again when it lags.
     - It is led deep into the pen through the open gate. The wheat is put away, the bot walks out, and the gate is closed.
     - A fetch cut short by the clock is resumed; one that made no progress counts as failed.
- **The herd's walks never use `goto`'s dig-assisted retry.** That retry would dig a gate or fence. The bot never steps at a gate that is still closed. A bot left inside a pen is due `exit` and leaves by the gate first.

**Proofs:**
- **`herd-proof.cjs`** (raw mineflayer + the bots' Movements), 4/4:
  - lure 50 b, twice (42 / 45 s);
  - breed inside (+1 in 9 s);
  - shear inside (5 wool);
  - gates.
- **`pens-e2e.mjs`** (the bots' own code):
  - **Build:** `sitePens` → `runVisit`: **64/64 cells read by the server**; both gates `spruce_fence_gate[facing=north,open=false]`.
  - **Herd:** `herdVisit` visit after visit: fetch (both sheep penned in visit 1), shear (2 sheared, 5 wool), breed (+1 lamb). The gate ends closed and the bot outside.
  - **Fixes it drove:**
    - the lure's arrival radius (it had re-legged 337 times beside the gate);
    - the deep entry (sheep stopped in the gateway);
    - the re-tempt (a sheep stopped following);
    - the wool pickup range.

**Tests:** `pens.test.mjs` 15/15, with 3 mutants and the wiring. House, shop and showcase-on-fleet were updated for the new project.

## 6. Reviews and the search (tier 3)

- **Codex r1 BLOCKERS:**
  - the abort or exception path inside a pen;
  - `hdGoto` inherited goto's dig retry;
  - the wool range clamp;
  - the floor palette was dirt only.
- **Claude r1 BLOCKER:** the dig retry through a gate that failed to open.

Fixes are in `pens-01show` r1. **r2 from both: FIXED.**

The search, done by the Claude reviewer:
- mineflayer-pathfinder treats an open gate as a 0-height solid (not "safe"), and only opens gates with `canOpenDoors`, which defaults to off ([movements.js](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/lib/movements.js), [PR #372](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/372)). With `canDig` on, it would dig a gate.
- TemptGoal stops at 2.5 b and calms down for 100 ticks. Tempted animals path through open gates only ([TemptGoal](https://github.com/Renekovski/26.2-mcp/blob/main/src/net/minecraft/world/entity/ai/goal/TemptGoal.java), [Attribute tempt_range](https://minecraft.wiki/w/Attribute)).

These match the code's 10 b `lost` distance, the deep entry and the re-tempt.

## 7. Effect metrics (owner rule 11-06)

| Piece | Metric | Direction |
|---|---|---|
| villagefeed | `_villagefeed op=birth fed=1` per day (control: `fed=0`) | 0 → > 0 once a cluster has room |
| villagefeed | loaves taken by the target ÷ loaves tossed | ≥ 0.5 |
| pens | `_structure_complete project=pens` | 0 → 1 |
| herd | wool banked per day (`_herd op=shear wool=`); animals in pens | 0 → > 0; 0 → 4–12 |
| herd | lambs and calves (`_herd op=breed` success) | > 0 |

## 8. Order, staging and what the showcase needs to see

1. **Stage `villagefeed-01show` (c404c0e0) first.** On 6_1 it should log `no_bed_room` (5 beds, 7 villagers) until beds come. That is correct, and it spends no wheat there.
   - With **villageunlock-02show** staged (it waits on the fleet KEEP of villageunlock-01), the freed villagers claim all 5 beds. Births then need beds from the town's wool.
2. **Stage `pens-01show` (f8bcf531) next.**
   - **Watch:** `_build project=pens op=sited`, then the rings; `_herd` rows (`op=fetch stop=penned`, `op=shear wool=`, `op=breed`); G1/G2 = 0.
   - **The chain to watch:** pens, then wool, then feed-run beds at 6_1 (2 a day), then `room > 0`, then bread, then `op=birth fed=1`.
3. **No new tripwire rule.** Pen fences, gates, fills and cuts are ordinary record cells and clears (G1, G2, G3). The herd changes no block: gate toggles are state changes, and shearing and breeding are entity actions.

**Risks:**
- an animal escaping through an open gate (the gate is open for seconds only);
- a bot whose exit gate will not open (it stays inside; the next visit retries, and it never digs);
- far sheep: the showcase has 9 within 200 b, and a fetch walks at most ~60 s out.

## 9. Fleet port

- **villagefeed-01:**
  - Port `villagefeed-01-on-f9d70a5` @ `08c5b154` rides after market-03.
  - Registration `~/mcai-analysis/villagefeed-01.08c5b154.json` is **valid**. The draft `villagefeed-01.queue-entry.draft.json` is **HELD** and not queued.
  - Exposure today is ~0: the nearest fleet villagers are 282 b from home, beyond the 160 b radius. It is worth queueing with a trip version (the market walk-in reaches 200 b) or once the showcase shows births.
- **pens / herd:** no fleet port yet. Pens follow the crop farm, which is showcase-only (`CROPFARM_POOLS`). A fleet pen needs a fleet crop farm first. Cows reach 5% of near-town rows in 5 of 16 towns, sheep in 1.

## 10. Not built, and why

- **Carrots and potatoes:** no source near the showcase town (6_1 has no farm; the other villages are 480+ b out). The wheat already sits at its cap.
- **More wheat rows:** the farm stops at its 128 cap. Bread and breeding are the use; expand once harvests stop hitting the cap.
- **Leather / cow culling:** owner-approved 11-03 (keep 2 breeders) but not asked for today. The cow pen fills by fetch and breeding first.
- **A vestibule (two gates):** proof runs saw no escape. Revisit if `_herd` shows pens losing animals.
