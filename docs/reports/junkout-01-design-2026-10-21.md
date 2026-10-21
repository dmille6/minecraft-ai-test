# junkout-01 — junk out at every town visit, and a slim bag allowance (design) — 2026-10-21 (r1)

OWNER 2026-10-21 ~20:30Z: "yes build it, i approve of your recommendations". Base: the fleet sha `34d3e5e9` (toolkit-03,
manifest declared_code_version 10-21 18:05Z). Branch `junkout-on-34d3e5e`. A variant on homefix-02's canary `d014ec2c` if
it is cheap.

## 1. Measurement (files on 10.0.0.31, FULL walk, read-only; `~/mcai-analysis/junkoutmeasure.py`)

Window 10-20 21:00Z -> 10-21 20:19Z (23.3 h): **1,454,453 rows, 80 bots**. Positive controls in the same walk: 160
`dispose_well`, 129 `_well_dispose`, 88 `compost`, 175 `town_deposit` rows. The lists were dumped from the bots' own modules
(`isWellJunk`, `isCompostJunk`, `PEACEFUL_COMPOST`), not retyped. Slots are estimated from each newest `bot.inventory` as
ceil(count / stack size): a LOWER bound (bagbudget-01 checked the same estimate against `items().length`: never above).

**Bags (newest snapshot per bot; denominator 80 bags, 2,462 slots used; 9 at >= 34):**

| what | slots | bots holding | where it goes today | junkout-01 |
|---|---|---|---|---|
| listed well junk (flint 21, pointed_dripstone 16, ink_sac 10, egg 9, brown_egg 8, glass 5, lead 4, ...) | **85** | 35 | the well, only at >= 34 slots | the well at every town visit |
| compost junk (leaf_litter, seeds, grass, flowers) | 49 | 37 | the composter, only at >= 34 | the composter at every town visit |
| peaceful plants (mushrooms, melon, kelp, flowers ...; the switch is on in every fleet world) | 17 | 13 | the composter, only at >= 34 | the same |
| bone_meal (2,281 items) | **83** | 77 | nowhere (bankable `not_wanted`) | a town chest (keep 0) |
| torch (672 items) | **72** | 68 | nowhere | a town chest (keep 0) |
| stations: chest 644 items / 67 bots, crafting_table 177 / 76, furnace 80 / 72, bucket 93 / 79 | **0 second stacks** | -- | stay | one of each kept; a second stack would go (none exists) |
| stone pickaxes: 172 copies in 77 bags; **25 beyond the best working pickaxe + 2 spares, in 19 bags -- ALL 25 spent (1 use)**; 0 usable, 0 worn beyond | 25 | 19 | wear_out at >= 34 (keeps 3 for last-swing) | usable spares beyond -> chest (0 today); spent ones are not a chest's (sections 3, 9) |
| saplings above the composter's peaceful reserve (oak/birch 16, others 0) | 18 items | -- | the composter at >= 34 | the composter at every visit |

**The owner's 98 listed slots** included `stone_bricks 14`: stone_bricks has been OFF the well list since OWNER D8 10-15
(building material, `well.mjs BUILDING_STONES` + `NEVER_DISPOSE`). Listed well junk is 85 slots today.

**Town visits (the exposure).** A visit = a run of rows within 48 blocks horizontally of the bot's home (the well's and the
composter's `TOWN_RADIUS`), split by a gap of > 120 s. 5,907 visits by 73 bots; **2,373 visits (by 68 bots) held >= 1
whole stack of listed well junk at < 34 slots** -- 1.27 per bot-hour; 3,096 held compost junk or peaceful plants at < 34.
553 visits reached >= 34 at some row. At 20 canary bots that is ~76 exposure visits in a 180-min read.

## 2. The list additions (part 3): the consumer check -- NOTHING is added

| asked | finding | decision |
|---|---|---|
| `leaf_litter` -> well | ALREADY junk, the composter's: `composter.mjs COMPOST_CHANCE` 0.3 (wiki Java table: 30%) and `hygiene NEVER_KEEP`, so `isCompostJunk` is true. `isWellJunk` refuses everything the composter takes (`!isCompostJunk`) -- a well-list entry would be INERT. Its bags hold it because the composter only runs at >= 34. | not added; the composter's visit order (section 3, B) takes it at every visit |
| `dripstone_block` -> well | HAS CONSUMERS: `reflex.mjs PLACEABLE` (the pillar / rescue reflex's blocks), `well.mjs PILLAR_EXTRA` (counted in the escape reserve STOCK_SCAFFOLD_MIN), and `well.mjs PIT_COVER_BLOCKS` (the FIRST-choice cover for an abandoned well pit; `pitCoverItem` relies on "never junk the well throws": a pit-first throw of it would change the cover answer mid-build). Not compostable (wiki). | KEPT OFF. (A guarded entry -- goes only above a pillar reserve -- is possible but changes the pit cover order: a separate, reviewed change.) |
| `gravel` -> well | HAS CONSUMERS: `exit-contract.mjs SCAFFOLD` (counted as climb-out scaffold), `reflex.mjs PLACEABLE` and both rescue block lists (reflex.mjs ~400 and ~4942), `toolfor.mjs`'s fill-site order, `cognitive.mjs` placeable count, and `milestones.mjs` (gravel -> flint gather source). It is ALSO already a well exit: `stocktarget.mjs` group `gravel` target 0, so at a full bag whole gravel stacks above the keeps and the 64-block pillar reserve go down the well. | KEPT OFF (it is a placeable rescue block) |
| `smooth_basalt` -> well | ALREADY in `well.mjs DECORATIONS` (OWNER 10-07; `isWellJunk('smooth_basalt')` is true; 1 slot fleet-wide). | nothing to do |
| `brown_mushroom`, `red_mushroom` -> composter | ALREADY composted whenever the peaceful switch is on (`peacefulkit.mjs PEACEFUL_COMPOST` 0.65, Paper 1.21.8 hopper test 64/64 on 10-07; wiki Java table 65%). Every fleet world is peaceful (owner 10-08). Moving them to the unconditional list would compost food in a world with hunger (mushroom stew). | not added; the composter's visit order takes them at every visit |
| magma_block, dirt, slabs, diorite/andesite/granite | owner: keep off | untouched |

So part 3 is not a constant change and there is nothing to ship on the setting fast path. What the owner wanted from it
(leaf litter and mushrooms out of the bags) is delivered by the composter's visit order below.

## 3. The design

### A. The well at every town visit (`well.mjs wellOrder`)
Today `dispose_well` is ordered only at `slots >= TRIGGER_SLOTS (34)`. Added beside it, a **visit order**:
- at town (`distHome <= TOWN_RADIUS` 48, the well order's own test), **slots < 34** (>= 34 is the full-bag order, unchanged),
  and the bag holds **>= JUNK_VISIT_MIN_STACKS (1) whole stack of LISTED junk** (`disposePlan(items).junkStacks` with no
  options: `isWellJunk` names, the guarded raw stones only above STONE_GUARD -- never swords, cobble at the cap or at-target
  stock surplus);
- **once per visit**: a latch charged when the order is ISSUED; re-armed only after >= JUNK_VISIT_REARM_OUTSIDE_MS (60 s)
  of decisions outside TOWN_RADIUS, or JUNK_VISIT_STAY_MS (20 min) after the issue while the bot stays in town; plus the
  well's own 3-min `DISPOSE_COOLDOWN_MS` and 15-min failure backoff (shared with the full-bag order);
- order `dispose_well {visit: true}`. The skill runs the SAME path (stand, admission, sealed re-read at the stand and at
  every click, close in a finally, misses retaken, server-verified account), with **`listedOnly`**: its throw plan is
  `disposePlan(bag)` with swords, cobble-at-cap and stock surplus switched off, so only listed junk moves ("nothing else
  changes"). Every existing gate holds it: no well -> skip (the build order builds one, plinth-first); breached / unknown
  / player near / inside a well -> skip; deeper than the walk's reach of the stand -> HELD at no cost (wellcare-01).
- A runner decline (busy, paused, body held) un-latches the visit (it never ran), as the town deposit does.

### B. The composter at every town visit (`composter.mjs townOrder`)
The owner's "the composter for compostables" and part 3's leaf litter and mushrooms. Beside the 34-slot `compost` order:
- at town, slots < 34, a composter in town, and **>= 1 stack the composter's allowance would empty WHOLE**
  (`compostVisitStacks`: compost junk, the peaceful plants under the switch, a sapling or apple stack wholly above its
  reserve) -- a few saplings over the reserve never start a walk;
- once per visit (the same latch rule as A, its own state), the composter's own cooldown and backoff;
- order `compost {visit: true}`; the skill is unchanged (a not-full bag always has room for the bone meal, so
  `fillDecision` only inserts / ripens / harvests). The composter's reserves are unchanged (saplings: oak/birch 16, others 0
  under the switch; apples 4).

### C. The slim bag allowance at the town deposit (bagbudget-02's tail; `towndeposit.mjs`, `bagallowance.mjs`)
bagbudget-01's whole-stack allowance planner, reused with the owner's rows, **at any bag size**:

| row | kept in the bag | surplus goes to |
|---|---|---|
| K stations: crafting_table, furnace, blast_furnace, smoker, chest, barrel, composter, bucket (+ water/lava/milk bucket) | 1 of each | a town chest -- WHOLE stacks only, so only a SECOND stack moves (none exists today; section 9) |
| T torch | 0 | a town chest |
| B bone_meal | 0 | a town chest |
| P stone_pickaxe | the best working pickaxe of any tier (> FLOOR 10 uses) + the 2 best stone copies | USABLE copies (> 10 uses) beyond them, to a chest, under the town's stone_pickaxe target (depositPlan's own tool cap; the bank click's stock claim re-checks it). Worn (2-10) and spent copies are never a chest's (today's tool rule). |

bagbudget-01's rules kept: **junk is never a chest's** (`notForChest`: the bank's ballast, the well's list, compost inputs,
the peaceful plants and apples under the switch, every sapling, bamboo); a name another layer owns is never this table's
(`bankOwned`: other tools, targeted groups, the iron ladder, the bank's standing targets); the goal's keeps win
(`max(row, townKeeps floor)`: wanted 64, stockpile, scaffold, ironKeeps); a withdraw hold covers its name; a pillar-capable
name keeps STOCK_SCAFFOLD_MIN; ladders are on NO row here (every ladder stays: the >= 26 escape rule holds trivially);
iron pickaxes are never on a row (ironpick-01's toolkit flow untouched); whole stacks, smallest first; the visit's
CREDIT_CAP per name; `BAG_ALLOWANCE=off` is the rollback. Not ported (outside "exactly this"): bagbudget's ladder, food and
building-stone rows, row P's last-swing change, its deletion-first wait (not needed: A and B now run below 34, so banking a
torch that takes a bag from 34 to 33 no longer stops the well -- the visit order takes over) and its keep-constant
consolidation.

Where it runs:
- **full bag (>= 34)**: the existing town deposit (ahead of the milestone order, as today) plans its base steps THEN the
  rows' steps (base first in the container, bagbudget's order).
- **not full**: a new **tail order** (`tailOrder`) issues `town_deposit {tail: true}` -- in the town deposit's zone (16 h /
  12 v) with a town container within STORAGE_REACH, once per stay (the town deposit's latch rules: 60 s outside / 15 min in
  town, 5-min cooldown, 15-min backoff on failure, its own state). It is a FREE-DECISION order: placed after the milestone
  order, the town deposit, wear_out, the composter's and the well's orders and chest pruning, so it never displaces a
  ready milestone step or a deletion. The skill plans **only** the rows' steps (no base plan, no count step, no valve).
- The allowance never enters `depositPlan` (the deposit verb, its walks, its new-chest recovery and the CARRYING prompt
  line never see it): never the reason for a trip or a new chest.

### D. Rows
- `_junkout_mode` once per spawn (the licence; only this build writes it): `phase=mode visit=1 allowance=1 ...`.
- `_junkout phase=well` per visit dispose: `v= dh= slots=a->b listed= n= stop=` (dh = the horizontal distance from home
  when the ORDER was issued).
- `_junkout phase=compost` per visit compost: `dh= slots=a->b n=`.
- `_junkout phase=bank` per tail/allowance run, COMPLETE in parts (bagbudget's `part=i/n`, `v=` visit id): every
  planned row name `allow=name=start:banked`, every other banked name `other=name:n`, `keep_picks=` (the stone copies the
  plan kept), `mode=tail|full`, `peaceful=`.

## 4. Composition: the dead-end table (every refusal names a move the bot can make from where it stands)

| situation | what happens | remedy the bot can perform from here |
|---|---|---|
| visit dispose, no well in town | skip (no_effect, free); the latch is spent for this visit | the build order (plinth-first) builds one at the next town decision that qualifies; nothing waits on it |
| visit dispose, well breached / unknown cell / player within 5 | skip, free | the next visit; a breached well is rebuilt by the build order |
| visit dispose, bot deeper than the stand's reach | HELD, no cooldown, no latch | the first decision within reach |
| visit dispose throws, some miss | misses retaken with the cap closed (existing) | -- |
| visit dispose fails (unreachable stand, unverified bag) | 15-min dispose backoff (shared) | the next visit after the backoff |
| visit compost, no composter | no order (needs a composter in town); build_composter is the existing order | the build order |
| visit compost, composter ripe | harvest first (a not-full bag has room) | -- |
| tail order, no container in reach | no order | the next stay near a chest |
| tail run, chests full | `town_storage_full`, 15-min backoff, detail "waits for a town chest with room -- keep working" (bagbudget's text) | none needed: nothing is lost, the bag keeps it |
| tail row P, town at its stone_pickaxe target | the copy stays (no step) | -- (it is usable; the valve / later visits) |
| withdraw hold on a row name | that name stays for the hold | -- |
| tail banks a torch from a 34-slot bag to 33 | full-bag well order stops | the VISIT order (A) takes the junk the same visit unless latched; else the next visit |
| treefarm (queued, NOT on this base) wants bag bone meal / torches | its bone-meal / torch step skips `not_held` (tf-on-adbec4f skills.mjs) | its own design: withdraw from the town chest, or raise the keep (a constant) |
| toolkit / ironpick: iron pickaxe, the stone spare toolkit keeps | never on a row; 2 stone spares kept >= toolkit's 1 | -- |
| planting needs > 8 saplings of a species | the composter keeps 16 oak/birch (unchanged) | -- |

THE CHAINS, TESTED THROUGH THE REAL CognitiveLoop: (1) not-full bag with listed junk at town -> dispose_well {visit} ->
the next decisions in the same visit issue no second visit order; leaving town for 60 s re-arms; (2) the same with a
breached well -> skip -> no loop; (3) torch + bone meal at town, not full -> after every other order -> town_deposit {tail}
-> the latch holds for the stay; (4) a 34-slot bag with junk + torch -> town deposit (base + rows) -> 33 -> the visit
dispose follows in the same visit.

## 5. Expected (measured bags, section 1; whole stacks only)
Per newest bag, the slots these exits would free at the next town visit: well junk 85 + compost/peaceful 66 + torch 72 +
bone meal 83 = **~306 of 2,462 slots (12.4%)**, ~3.8 per bag (denominator 80 bags). Stations 0, stone pickaxes 0 (the 25
beyond are spent), saplings < 1 slot. The 12-of-80 full bags are not the target: the target is the HEADROOM a bag leaves
town with, because a full bag's gather succeeds 4.8% vs 52.2% with room (hygiene.mjs, 09-28). Town chests: one-time
~155 slots of torch + bone meal across 16 towns (~10 per town), then torch 0.79 + bone meal 0.56 items per bot-day
(bagbudget-01's inflow) -- under 2 slots a day fleet-wide.

## 6. Read and registration
`scripts/host/junkoutread.py` (files; DiD canary vs control; denominators and positive controls first):
- LICENCE `_junkout_mode`.
- DEFECTS (deterministic, each REVERT evidence=defect, each with a failing fixture in `--selftest`):
  J1 `breach_junk_chest`: a canary `_junkout phase=bank` row banked a junk name (the read's lists held to the bots' by
     `JS_CHECK`); `j1_incomplete` (a run whose parts are not all present) BLOCKS KEEP.
  J2 `breach_below_allowance`: a bank row leaves a station below 1, or `stone_pickaxe` copies below min(start, keep_picks).
  J3 `breach_dedicated_trip`: a canary visit order (well or compost) whose `dh` > 48 (impossible by construction).
  J4 `breach_visit_offlist`: a canary visit `_well_dispose` (paired by bot and second) that threw anything but listed
     junk (offlist, swords, cobble or stock > 0).
  J5 `breach_loop`: a canary bot with >= 4 junkout visit/tail orders inside any 30 min that freed 0 slots in all.
- EXPOSURE (declared, tier 2): canary visits with listed junk at < 34 (snapshot walk, as section 1) >= 20 AND canary
  `_junkout phase=well` rows with n > 0 >= 10 AND canary `phase=bank` rows that banked >= 3.
- PRIMARY (DiD, reported): slots per bot; listed-junk slots per bag; torch + bone meal slots per bag; share at >= 34;
  gather success; `town_storage_full` per bot-h (reported; >= 3 and > 2x control is a HARM line).
- POSITIVE CONTROLS: control `dispose_well` >= 1, control town visits with junk >= 1, control `town_deposit` >= 1.
TIER 2 (`"tier": 2`, no class): deterministic gates on rows the change writes and Paper scenes base vs candidate.
`change_rows` without a leading underscore (`junkout`, `well_dispose`, `town_deposit`, `compost`).

## 7. Prior art (searched 2026-10-21)
- Client "inventory cleaner" mods (Modrinth Inventory Cleaner, CurseForge Cleanventory / Inventory Filter): a user list of
  junk is thrown out automatically on pickup or on a key, without waiting for a full inventory -- the same "every
  opportunity, listed only" rule; they drop items on the ground, which this fleet cannot (the server hands them back:
  hygiene.mjs, owner 09-29), hence the well.
- mineflayer `tossStack`/`toss`: the primitive; same pile problem.
- Voyager (curriculum: deposit useless items at >= 33 slots, LLM-chosen), Mosfet (cache all but NEEDED at >= 27 slots,
  one stack of each WANTED), mineflayer-collectblock (deposit when full) -- all full-bag triggers. bagbudget-01 section 7
  has the detail. None runs disposal below a full bag at a known safe place, and none separates "delete" from "bank".

## 8. Interaction with queued work
- homefix-02 (live canary d014ec2c): touches cognitive.mjs, skills.mjs, composter/towndeposit (RUNNER_DECLINED import).
  A variant `junkout-on-d014ec2` is the same commits cherry-picked.
- ironpick-01 (ironpick-on-34d3e5e): composter.mjs `townOrder` signature (`pickDefer`) -- a textual neighbour of B; no
  behaviour overlap (iron pickaxes are never on a row).
- bamboo-03: bamboo stays junk here (never a chest's, not on the well list); no overlap in the fold.

## 9. What it does not do, said plainly
- **Stations**: "6-13 chests" is ONE slot. The bank moves whole stacks (two clicks into an empty slot: the reviewed,
  server-verifiable move), so keeping 1 of a single stack of 8 moves nothing. A partial move frees no slot and needs a new
  click path; not built. If the owner wants the counts down anyway, that is a separate actuator change.
- **Spare stone pickaxes**: every copy beyond best + 2 is SPENT. A 1-use pickaxe is not a chest's (today's tool rule;
  it would be junk in a chest), and wearing it out at town would dig the town's ground (wear_out does not read
  townground's zone). The full-bag wear_out keeps doing it (keeps 3 for last-swing). bagbudget-01's reviewed row P (keep 0
  spent while the bag holds a stone pickaxe's stone) is the ready fix if wanted -- not included ("exactly this").
- **Torch / bone meal "capped"**: the cap is 0. A bag holds one stack of each, and a whole-stack bank with a cap above 0
  keeps that slot (~10 slots fleet-wide instead of ~155). The numbers are constants (`ALLOWANCE.torch`, `.boneMeal`).
- No trip, no new chest, no world edit, no change to the deposit verb, the lists, the cobble cap or any stock target.

## 10. Reviews
(filled in below as they land)
