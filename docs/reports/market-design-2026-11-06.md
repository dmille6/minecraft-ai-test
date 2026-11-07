# The market: live villager trading — design (2026-11-06)

**Owner, 11-06:** "what should the bots unlock first?" The answer is **live villager trading**. The owner also turned
`mobGriefing` on today, so villagers can breed and farm.

**Goal.** Turn the stone, cobble, coal and iron glut into emeralds. Then spend the emeralds on what the towns lack.

**Method.** Two designs were made independently: Claude's, and Codex's (`codex exec`, read-only). Codex was given the measurements
and the goal, not Claude's design. The two are reconciled below. Every trade fact comes from our own Paper 1.21.8 in a sandbox,
not from memory.

This builds on [trading-design-2026-11-03.md](trading-design-2026-11-03.md):

- the merchant scout;
- villageunlock-01;
- coalsale-01 and coalsale-02;
- jobsite-01.

## 1. Measured (11-06)

### The showcase

The showcase has 15 bots. Home is about 0,70,0 and the simulation distance is 6.

**Sightings.** In 24 hours the merchant scout wrote **2,804 `_merchant_seen` rows** out of 765,287 log lines. They are:

| Merchant | Rows | Distinct |
|---|---|---|
| Villagers | 2,740 | **7** |
| Wandering traders | 64 | **3** |

- All 7 villagers have profession none, are level 1, and stand inside the protected zone `village-taiga-6_1`. They are the penned
  ones: 4 in the outdoor trapdoor ring at 80,73,-3 and 3 in the house ring at 87,76,11.
- So the "2,801 sightings" is **the same 7 penned villagers**, seen every 30 minutes by each of 15 bots.
- The 3 wandering traders were seen 0 to 90 blocks from home.
- No other villager was seen. The villages at 23_-20 and 1_54 are never loaded.

**Town index.** 27 containers, the newest observation of each, with 24 distinct items as the positive control:

| Item | Count |
|---|---|
| cobbled_deepslate | 946 |
| deepslate_bricks | 272 |
| stone_bricks | 249 |
| **iron_ingot** | **225** |
| lapis | 168 |
| copper | 127 |
| spruce + oak logs | 167 |
| sand | 92 |
| **coal** | **83** |
| glass_pane | 48 |
| diamond | 42 |
| redstone | 26 |
| stone | 2 |
| **emerald** | **0** |

The cobble glut sits in the bags and the yard: one bag alone holds 431. **No villager buys cobble.** Masons buy *stone*, at apprentice
level.

**XP.** The `_xp` rows show levels 1 to 15 per bot, median about 10.

### The fleet

From the 11-03 census: 12 of 16 worlds hold employed novices, 281 to 605 blocks from town. No masons were seen.

## 2. Paper proof (sandbox4 and sandbox3, 11-06)

The drivers are `sandbox/trading/market-proof.cjs` on main and `sandbox/trading/market-e2e.mjs` on the branches. Setup was by RCON
in the sandbox only.

### A. The 1.21.8 trade tables

The sample was 13 professions × 5 levels × 16 fresh villagers each, read from the server's own `Offers` record, one field per query.

> **The server truncates a long `data get` with "...".** A whole-list read came back cut after the first recipe, so each field was
> queried on its own.

What each profession buys from us (goods → 1 emerald), with the share of villagers that had the offer:

| Profession | Job block | Buys from us | Sells us (useful) |
|---|---|---|---|
| armorer | blast furnace | coal 15 (L1, 10/16); iron 4 (L2, 6/16); lava bucket (L3); diamond (L3) | bell 36e; chainmail; diamond armour (L4-5) |
| butcher | smoker | chicken 14, porkchop 7 (L1); **coal 15 (L2, 12/16)**; beef 10, mutton 7 (L3); **dried kelp block 10 (L4)**; **sweet berries 10 (L5)** | cooked food |
| cartographer | cartography table | **paper 24 (L1, 16/16)**; **glass pane 11 (L2, 11/16)**; compass (L3) | **banners 2e (L4)**; **item frame 7e (L4)**; globe pattern |
| cleric | brewing stand | rotten flesh 32; gold 3 (L2); rabbit foot (L3); scute / **glass bottle 9** (L4); nether wart (L5) | **redstone 2/e (L1)**; **lapis 1/e (L2)**; glowstone 4e (L3); ender pearl 5e (L4); XP bottle 3e (L5) |
| farmer | composter | beetroot 15, potato 26, wheat 20, carrot 22 (L1); pumpkin 6 (L2); melon 4 (L3) | bread; golden carrots |
| fisherman | barrel | **coal 10 (L1, 10/16)**; string 20 (L1); cod 15; salmon 13 | campfire 2e (L2) |
| fletcher | fletching table | **stick 32 (L1, 12/16)**; flint 26 (L2); string 14; feather 24; tripwire hook 8 | arrows; flint (with gravel); bows |
| leatherworker | cauldron | leather 6 (L1); flint 26 (L2); rabbit hide 9 | saddle 6e (L5) |
| librarian | lectern | paper 24 (L1); book 4 (L2); ink sac 5; book and quill 2 | **bookshelf 9e (L1)**; **lantern 1e (L2)**; **glass 4/e (L3)**; enchanted books (emeralds + a **book**); name tag 20e (L5) |
| mason | stonecutter | clay 10 (L1, 16/16); **stone 20 (L2, 16/16)**; andesite / granite / diorite 16 (L3); quartz 12 (L4) | **bricks 10/e (L1)**; chiseled stone bricks; polished stone; dripstone; **terracotta and glazed terracotta 1e (L4)**; **quartz blocks and pillars 1e (L5)** |
| shepherd | loom | wool 18 (L1); dyes 12 (L2-4) | **wool 1e**, carpets (L2); **beds 3e (L3)**; banners 3e (L4); paintings (L5) |
| toolsmith | smithing table | coal 15 (L1, 6/16); **iron 4 (L2, 16/16)**; flint 30 (L3); diamond (L4) | bell 36e; enchanted diamond tools (L4-5) |
| weaponsmith | grindstone | coal 15 (L1, 9/16); **iron 4 (L2, 16/16)**; **flint 24 (L3, 16/16)**; diamond (L4) | bell 36e; enchanted diamond axe and sword |

A level-1 offer is random: 2 drawn from the pool. A trade target is therefore an **offer seen in a live window**.

### B. The client sees the same offers

`bot.openVillager` showed the same offers as the server, for all 13 professions at levels 1 and 2. The prices carry demand, special
price and multiplier.

### C. The wandering trader buys, in 1.21.8

Six traders were sampled. Each had 2 buy offers, each limited to 2 uses:

| Trader buys | Pays | Seen on |
|---|---|---|
| hay_block | 1e | 4 of 6 |
| milk_bucket | 2e | 3 of 6 |
| fermented_spider_eye | 3e | 3 of 6 |
| water_bucket | 2e | 1 of 6 |
| potion (water) | 1e | 1 of 6 |

- It sells: 8 logs of foreign woods (cherry, mangrove, pale oak, acacia, oak) for 1e; dyes at 3 for 1e; flowers; pumpkins; packed
  and blue ice; corals; podzol; saplings at 5e.
- **mineflayer's `openVillager` asserts the villager entity type.** A thin view of the entity carrying the villager's type id opens
  the same window, of type minecraft:merchant. A sale was server-confirmed: milk → +2 emeralds.

### D. Restock

An employed fletcher at its own fletching table, in work hours:

- its offer was used up (12/12);
- **it restocked within 240 s** (uses back to 0; demand moved from -24 to -14);
- after the 12 trades it **levelled up to apprentice** and gained a flint-26 and a bow offer.

> **A summoned profession with no job site and no trade loses its profession and redraws its offers when it claims a site.** This
> happened on the first run. It is why a market block placed for an unemployed villager is the right order.

### E. Claim reach

An unemployed villager at one end of a 1-wide corridor, with a lectern placed at a distance:

| Lectern distance | Claimed (librarian) in |
|---|---|
| 16 b | 8.7 s |
| 32 b | 13.0 s |
| 44 b | 17.3 s |

So the market may sit **up to 40 blocks** from the villagers.

### F. Breeding with mobGriefing on

Two adults, each given 3 bread by NBT, with 3 free beds: **one baby in about 8 minutes**, and the bread was eaten.

Bread a bot **tossed** was **not picked up** in 8 minutes: 2 item entities were still on the floor. Feeding by toss is unproven.

### E2E: the real code path

`marketAsk` → `market_run` / `market_job`, with craftsync installed. Every result was read back from the server. It ran on sandbox3
three times, after each review round, with identical results.

1. **Wandering trader.**
   - 2 buckets crafted from 6 town iron.
   - Filled at the 5x5 pond. The pond stays water.
   - **2 water buckets sold for 4 emeralds.**
   - **32 cherry logs bought** with them: the palette want.
   - **The kit's bucket kept.**
2. **Market job.**
   - A smithing table crafted at town, from the bought cherry planks.
   - **Placed 9.4 to 13.4 b from two free jobless villagers, outside the zone box.**
   - **Claimed: toolsmith.**
3. **The new toolsmith's window.** It was read: stone tools only, so it was a look. It holds no coal offer; level-1 offers are random.

## 3. Claude's design

1. **Counterparty first.** The showcase has none employed, and the 7 it can see are penned.
   - The first live counterparty is the **wandering trader**. Three are seen near town every day, and it buys water buckets,
     water bottles and hay.
   - The villager market follows the unlock.
2. **The market sits outside the village**, on open ground just past the zone box. It is no more than 40 b from a cluster of **free**
   jobless villagers: villagers seen to move at least 6 b, 5 minutes or more apart. 6_1's pens span at most 3 b, so they never
   qualify.
   - Job blocks are placed one profession at a time, in this order: smithing table (iron), barrel (coal 10), fletching table
     (sticks), stonecutter (stone), grindstone, cartography table.
   - **Never a lectern, loom or brewing stand: no bot can make them here.** A lectern needs leather, a loom needs string, a brewing
     stand needs a blaze rod.
3. **A market run is a short town walk**, at most 96 b from home.
   - It draws only the goods the merchant buys. They come from above the town's keeps, at most 3 goods.
   - It sells on the offers **seen in the window**, then buys the town's wants with at most 8 emeralds, then walks home.
   - The emeralds are banked by the ordinary town deposit (DEPOSIT_ALWAYS).
4. **Wants list.** Need = target − town − bag. The owner's list ranks first, then building blocks, then decoration. Each want has a
   ceiling price.
5. **XP and books later.** A librarian's enchanted book needs a plain book. A plain book needs leather. Bookshelves bought for 9e
   break into 3 books.

## 4. Codex's independent design

Its answer is in `market-2026-11-06/codex-design.txt`.

- **Unlock first, then prove one sale and a deposit.** The market goes on surveyed open ground west of 6_1, past x49. Place one
  workstation, watch who claims it, then expand. Do not remove the village's own workstations.
- **Professions:**
  - fletcher (sticks): the first renewable income;
  - mason: clay at novice, stone at apprentice;
  - **level the mason by buying bricks**;
  - toolsmith (coal);
  - librarian, shepherd and cleric only at existing village job sites, since lectern, loom and brewing stand cannot be made;
  - later the farmer and the cartographer.
- **The trade run:**
  - a leased town worker;
  - reserve the stock;
  - inspect the window;
  - one transaction at a time;
  - reconcile the bag after an interruption;
  - restock needs the claimed job site in work hours, at most twice a day;
  - demand and gossip move prices;
  - no curing or raid discounts in peaceful.
- **Wants:** deficit = capped target + committed demand − fresh stock − incoming deliveries.
  - Targets: wool 32, books 12, lanterns 16, redstone 32, glass 64, string 16, lapis 32 (0 now: lapis is a surplus).
  - At most 8 emeralds a trip, keep 8 in town, no speculative decorative buying.
- **Safety:**
  - walk-only access to the village;
  - tell the tripwire the exact authorised cells and state transitions;
  - register market placements separately.
- **Breeding:**
  - mobGriefing enables food pickup and farming;
  - 7 adults are enough to start;
  - beds and bounded feeding later;
  - stop at 10 local villagers.
- **Queued fleet pieces:**
  - keep coalsale-01 and coalsale-02 as foundations;
  - adapt jobsite-01's open-ground checks into market slots with claim tracking;
  - then levelling, restock, wants-driven buying, breeding.
- **What cannot be bought:**
  - no villager sells **string** (cobwebs, chest loot or fishing instead);
  - no villager sells a **plain book** (break a bought bookshelf, or craft one from paper and leather);
  - wool can be bought, or sheared.

## 5. Reconciliation

| Point | Claude | Codex | Taken |
|---|---|---|---|
| First live trade | the wandering trader near town, now | unlock 6_1 first, then one sale | **Both.** The trader is live on the showcase now and needs no protected code. The 6_1 unlock is protected (protectzone.mjs) and goes through the fleet canary first (villageunlock-01, queued). The showcase gate needs a fleet-kept protected tree. |
| Market site | outside the zone box, ≤ 40 b from a free cluster, each side tried | west of 6_1, outside x49 | Same rule. The proof's claim at 44 b sets 40 b. |
| One block first | one of each profession, 2 a day | one, watch, then expand | 2 a day, one profession at a time, claim read at 20 s. |
| Mason levelling | not planned | buy bricks to level | **Adopted.** Bricks (1e → 10) are a build want, so buying them levels the mason toward stone 20. |
| Decorative buying | allowed (palette logs, dyes, flowers) | none speculative | **Kept, but ranked last and capped by the 8-emerald run budget.** On the showcase the trader sells nothing on the owner's list, and visible palette variety is the owner's goal. Owner decision D3. |
| Emerald keep | 0 | 8 in town | 0 for now. With no buyer of the owner's list in reach, a keep only idles. Revisit when the 23_-20 trips exist. |
| String, books | not buyable | not buyable | Agreed. Bookshelf (9e) → 3 books is the book route. |
| Breeding | proven with fed adults and beds | beds and feeding later, stop at 10 | Agreed. A later piece; feeding by toss is unproven. |
| Fleet pieces | extend, do not duplicate | keep, merge, adapt | market-01 **stacks on jobsite-01**: the same trade.mjs and jobsite.mjs, plus market.mjs. See section 8. |

## 6. Safety

- **No run walks into a village.** A merchant must stand outside every protected zone box + 3, both when planned and when the window
  opens.
- **A market cell is never in a zone.** Every cell within zone + 4 reads as solid. Each cell is open ground: all 8 neighbours open at
  feet and head height, a natural floor, no door, bed, chest or job block beside it. That is jobsite.mjs's rule, so a villager is
  never walled in.
- **The bucket's water.**
  - It is open water: the target's 8 neighbours are sources, so it refills at once.
  - It is at least 8 b from any zone.
  - The look ray, walked voxel by voxel, crosses no other water and no solid block. The server fills the first source on the ray.
- **Keeps.** The run draws only above each good's keep. The town is re-read before every draw, minus the run's own draws, and the
  draws leave 4 bag slots free.
- **Bag room.** mineflayer's `putAway` drops what does not fit. So every trade needs 2 free slots, and a purchase is fitted by the
  item's own stack size.
- **Never sold:** the kit's bucket, diamonds, lapis, redstone, tools or books. These are absent from GOODS.
- **Leases.** One market run and one market job per town at a time, each a pool lease. Job blocks are capped at 2 per town per day,
  and the cap is re-read at the click.

## 7. Tripwire: shopread MK1-MK3

These rules are on main in `docs/reports/shop-01-2026-10-25/shopread.py.txt`. **They are not installed.**

| Rule | Row | Rule | Line |
|---|---|---|---|
| MK1 | `_market_job op=placed block= at=` | block in MARKET_BLOCKS (the 6 makeable) | off_record ` market_block` (REPORT) |
| | | outside every zone box + 3 | zone ` market_job` (**TRIP**) |
| | | ≤ 2 per pool per 24 h | off_record ` market_cap` (REPORT) |
| MK2 | `_market_run ... at=` | merchant outside the zone box + 3 | zone ` market_run` (**TRIP**) |
| | | spent ≤ 8 | bag_loss ` MK2 market_spend` (REPORT) |
| MK3 | `_trade op=sell item=` | item in MARKET_GOODS | bag_loss ` MK3 market_sold` (REPORT) |

- `MARKET_KINDS` joins `BUILD_KINDS`, so showcase_trip.py loads the rows.
- The rules judge the canary arm after the cut. On the showcase that is every row.
- **Selftest:** ok. It covers positive controls, each fixture, the arm, and the copy of market.mjs's lists (`SHOPREAD_MARKET=...`).
  A drift was caught on purpose (zonePad 4).
- **Mutants:** 219 of 219 killed (209 before, plus 10 new).
- **Live replay** on the showcase host: a copy of /srv/showcase/trip with the new shopread; a fixed `--since 20:30Z`; `--no-crash
  --no-census`.
  - **S6 defects identical:** H1-H8 all 0.
  - **VERDICT identical:** WATCH, from S0, S1 and S6 stuck_on_cell, all pre-existing.
- **Reviews:**
  - Codex: NO BLOCKERS. Its note: on the showcase bag_loss and off_record REPORT and zone TRIPs. The table above reflects this.
  - Claude: no blocker in the rules (the selftest and 11 mutants were re-run).

## 8. Pieces, tiers, queue

| Piece | What | Tier | Lane | State |
|---|---|---|---|---|
| **market-01show** | market.mjs + market_run (trader / market villagers near town) + market_job; wants; the water-bucket goods | 2: protected.py says not protected. Reviewed as tier 3: two engines and a Paper e2e, because it rests on unseen Paper and mineflayer behaviour | showcase | **ready to stage** |
| **market-01** (fleet) | the same market on jobsite-01 (coalsale-01 → 02 → jobsite-01). Asked when the build order has no use for the bot | on its own diff not protected; it stacks on tier-3 coalsale-01 | fleet P | registration + draft entry; after jobsite-01 |
| villageunlock-01 | frees 6_1's 7 penned villagers | 3 (protectzone) | fleet canary first, then the showcase | queued, ready |
| market-02 (later) | trips to 23_-20's existing librarian, cleric and shepherd job sites (books via bookshelves, redstone, lapis, wool, beds). Walk-only into a zone | 3 (expedition movement, zone entry) | after coalsale-01 KEEP + an owner OK on walk-in trading | design |
| market-03 (later) | breeding: beds outside the zone, a composter for a farmer (food), stop at 10 | 2 | showcase | proof done (fed adults breed) |

**Queue (Claude).**

- **Showcase.** Fold market-01show with the next showcase batch. The trader trades from day one. The market's job blocks stay inert
  until villagers are free.
- **Fleet.** Order: villageunlock-01 → coalsale-01 → coalsale-02 → jobsite-01 → **market-01** (P lane).
- **Codex** wanted the unlock before any market. That is the same order, because on the showcase the unlock is gated on the fleet
  KEEP.

## 9. Owner decisions

1. **D1. Walk-in trading.** May a bot walk into a protected village (walk only: no dig, no place) to trade with villagers working at
   the *village's own* librarian, cleric and shepherd sites? Those sites hold the owner's list: books, redstone, lapis, wool, beds.
   Today the run refuses any merchant inside the zone + 3.
2. **D2. Feeding villagers for breeding.** Breeding needs food and free beds. Feeding by toss did not work in the proof. The
   alternative is a composter at the market for a farmer, whose harvests feed the village. Should the bots also bring beds to 6_1's
   edge?
3. **D3. Decorative buying.** The trader's foreign logs, dyes and flowers are bought only when nothing on the owner's list is on offer,
   with at most 8 emeralds a run. Keep this, or save every emerald for the list?

## 10. market-02 (owner decisions 11-07)

**Owner, 11-07:**

- **D1 yes:** walk-in trading at villages' own librarian, cleric and shepherd sites. Walking only, doors and trapdoors allowed;
  never dig or place inside.
- **D2 yes:** a market composter, so a farmer feeds the village, plus beds at the village edge on open ground **outside the
  zone + 3**.
- **D3 yes:** decorative buying, ranked last, inside the 8-emerald run cap.

### What was built

**market-02show `8a70fb5e`** (on market-01show `ed29ef8b`):

- **`market_trip`, one runner call.**
  - The runner aborts every skill at `SKILL_TIMEOUT_MS`, 180 s on the showcase. It never reads a contract's maxMs (Claude r1, confirmed).
  - The trip therefore fits **170 s**: out ≤ 45 s, visits start by 60 s, home by 168 s.
  - Inside a village zone it stays ≤ 60 s, plus one visit, and is never still for 40 s. Each visit is at most 2 sales and 2 purchases,
    8 s each.
  - It reaches village zones within **200 b** of home. On the showcase that is village-taiga-6_1.
- **The far village (23_-20, 502 b) needs a trip cut into calls.** Something must re-issue each call while the bot is away; that is
  cognitive.mjs's continuation, protected code, which coalsale-01's `trade_trip` brings. → **market-03**: the walk-in rides that trip
  once coalsale-01 is kept on the fleet and restacked into the showcase.
- **Farmland protection.** During the whole trip, farmland, crops and cells over farmland cost 101.
  - The price is pushed **in place**, so index.mjs's ascent and descent fallback profiles, which share the array, are priced too
    (Claude r2).
  - A merchant standing in a field is not walked to.
- **Keeps** read only `known` index containers, less the call's own draws.
- **Trades** are bounded at 8 to 20 s each. Every exit walks home and checks it arrived.
- **Village edge:**
  - beds: 2 a day, their own cap, foot and head outside the zone + 3;
  - the composter: the second market job block, in the 2/day job cap, beside the jobless.
- **`tierOf`:** purchases sort owner (and breeding beds) < build < decor.

**Fleet `market-02` `ccbd80b1`** (on market-01 `0addb9f0`): the same code. Fleet worlds have no protected zones, so a walk-in has no
target there.

### Paper proof

`sandbox/trading/walkin-e2e.mjs`, sandbox3, with protectzone attached as index.mjs attaches it:

- **The walk-in trade.** The real ask → market_trip walked into a protected village 100 b out and bought from its librarian
  (8 lanterns) or cleric (16 redstone).
- **No block changed.** The zone's blocks were identical before and after (`execute if blocks` against a copy: 992 + 6,944 cells
  either side of a sunken wheat field). The field's farmland was intact: the bot's feet, sampled every 100 ms, never stood in it, and
  0 cells were lost. There were 0 guard refusals.
- **Beds and composter.** 2 beds and a composter were placed outside the zone + 3.
- **Claims.** A villager **claimed a bed** (`Brain.memories."minecraft:home"` = the bed's head). A jobless villager **took the
  composter** (farmer).
- **Timing.** 52 to 64 s per trip, under 180 s.

### Tripwire

On main `789c1f01` and `3b3e6011`. **Not installed.**

- **shopread MK2:** a `_market_run ... walkin=1` (only marketTrip writes it) inside a village zone is **presence**, counted as
  `market_walkins`, never `zone`. The same row without `walkin=1` still trips.
- **shopread MK1:** bed halves and the composter are market job rows. They must be outside the zone + 3. Beds count against a cap of
  2 a day by their foot.
- **Mutants:** 223 of 223 killed.
- **showcase_trip.py:** no rule change. Z1 needs ≥ 15 min still inside a zone *with* a guard refusal; a trip is inside ≤ ~2 min.
  The selftest now locks it in: a visit shape is not trapped, 16 min held is trapped, and tightening TRAP_MIN to 3 fails the selftest.
- **Live replay** on the showcase host, both copies at once: VERDICT, S3 and S6 identical.

### Reviews

| Round | Codex | Claude |
|---|---|---|
| r1 | 3 blockers: home after failed travel, keeps, unanswered trades | 2 blockers: the 180 s watchdog, farmland |
| r2 | 3 of those NOT FIXED | farmland NOT FIXED: the fallback profiles |
| r3 | 1 NOT FIXED: late-visit timing | FIXED |
| r4 | FIXED (worst case 123 s of visits + a 20 s exit, home by 168 s), no new blocker | — |

### Queue

- **market-02show** folds with market-01show, with MK1, MK2 and the showcase_trip selftest installed alongside.
- **6_1's villagers become trading partners once villageunlock-01 is on the showcase.**
- **Fleet:** market-02 after market-01, progress lane.
