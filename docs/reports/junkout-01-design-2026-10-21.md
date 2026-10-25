# junkout-01 — junk out at every town visit, and a slim bag allowance (design) — 2026-10-21 (r3)

OWNER 2026-10-21 ~20:30Z: "yes build it, i approve of your recommendations". Base: the fleet sha `34d3e5e9` (toolkit-03,
manifest declared_code_version 10-21 18:05Z). Branch `junkout-on-34d3e5e`. A variant on homefix-02's canary `d014ec2c` if
it is cheap.

## 1. Measurement (files on 10.0.0.31, FULL walk, read-only; `~/mcai-analysis/junkoutmeasure.py`)

**r2 re-measure (Claude r1 P2-4, P2-1; the numbers the design now uses):** 10-20 21:00Z -> 10-21 20:37Z, 1,472,987 rows, 80
bots (positive controls: 164 `dispose_well`, 132 `_well_dispose`, 89 `compost`, 179 `town_deposit`). Visits now = rows in
the TOWN DEPOSIT ZONE (16 h / 12 v of home), split by > 120 s: **4,734 visits by 71 bots; 3,392 held >= 1 whole stack the
visit dispose would take, at < 34 slots (1.79 per bot-hour)**; 2,514 held compost junk or peaceful plants (saplings not
counted). Listed well junk in the newest bags, counting the guarded raw stones (andesite / diorite / granite / mossy
cobblestone) whole stacks above the 64-stone guard as the well does: **151 slots on 57 bots** (85 + 66 guarded). Filled
buckets held twice: 0. Stone pickaxes: 168 copies; beyond best + 2: 25 copies in 18 bags, all spent. The r1 tables below
are kept for the record; where they differ, these numbers win.

**r3 reach check (Claude r2 P3-2):** the same walk, 10-20 21:00Z -> 10-21 20:46Z (1,481,043 rows, 80 bots): of 3,421 zone
visits with listed junk below 34, **3,366 (by 71 bots, 1.77 per bot-hour) had a row within 20 blocks of a spot where a bot
of that pool stood to dispose** (16 pools have one) -- the well reach gate costs ~2% of the exposure; 2,535 compost-junk
visits all had a row within 20 of a spot where a bot composted (16 pools).

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

**Town visits (the exposure, r1 definition).** A visit = a run of rows within 48 blocks horizontally of the bot's home (the well's and the
composter's `TOWN_RADIUS`), split by a gap of > 120 s. 5,907 visits by 73 bots; **2,373 visits (by 68 bots) held >= 1
whole stack of listed well junk at < 34 slots** -- 1.27 per bot-hour; 3,096 held compost junk or peaceful plants at < 34.
553 visits reached >= 34 at some row. At 20 canary bots that is ~76 exposure visits in a 180-min read.

## 2. The list additions (part 3): the consumer check -- NOTHING is added

| asked | finding | decision |
|---|---|---|
| `leaf_litter` -> well | ALREADY junk, the composter's: `composter.mjs COMPOST_CHANCE` 0.3 (wiki Java table: 30%) and `hygiene NEVER_KEEP`, so `isCompostJunk` is true. `isWellJunk` refuses everything the composter takes (`!isCompostJunk`) -- a well-list entry would be INERT. Its bags hold it because the composter only runs at >= 34. | not added; the composter's visit order (section 3, B) takes it at every visit |
| `dripstone_block` -> well | HAS CONSUMERS: `reflex.mjs PLACEABLE` (the pillar / rescue reflex's blocks), `well.mjs PILLAR_EXTRA` (counted in the escape reserve STOCK_SCAFFOLD_MIN), and `well.mjs PIT_COVER_BLOCKS` (the THIRD-choice cover, after coarse and rooted dirt for an abandoned well pit; `pitCoverItem` relies on "never junk the well throws": a pit-first throw of it would change the cover answer mid-build). Not compostable (wiki). | KEPT OFF. (A guarded entry -- goes only above a pillar reserve -- is possible but changes the pit cover order: a separate, reviewed change.) |
| `gravel` -> well | HAS CONSUMERS: `exit-contract.mjs SCAFFOLD` (counted as climb-out scaffold), `reflex.mjs PLACEABLE` and both rescue block lists (reflex.mjs ~400 and ~4942), `toolfor.mjs`'s fill-site order, `cognitive.mjs` placeable count, and `milestones.mjs` (gravel -> flint gather source). It is ALSO already a well exit: `stocktarget.mjs` group `gravel` target 0, so at a full bag whole gravel stacks above the keeps and the 64-block pillar reserve go down the well. | KEPT OFF (it is a placeable rescue block) |
| `smooth_basalt` -> well | ALREADY in `well.mjs DECORATIONS` (OWNER 10-07; `isWellJunk('smooth_basalt')` is true; 1 slot fleet-wide). | nothing to do |
| `brown_mushroom`, `red_mushroom` -> composter | ALREADY composted whenever the peaceful switch is on (`peacefulkit.mjs PEACEFUL_COMPOST` 0.65, Paper 1.21.8 hopper test 64/64 on 10-07; wiki Java table 65%). Every fleet world is peaceful (owner 10-08). Moving them to the unconditional list would compost food in a world with hunger (mushroom stew). | not added; the composter's visit order takes them at every visit |
| magma_block, dirt, slabs, diorite/andesite/granite | owner: keep off | untouched |

So part 3 is not a constant change and there is nothing to ship on the setting fast path. What the owner wanted from it
(leaf litter and mushrooms out of the bags) is delivered by the composter's visit order below.


## 3. The design (r2; r3 changes marked)

Three VISIT orders and one change to the full-bag rules. Each visit order is ONCE PER VISIT: a latch charged when the order
is ISSUED (a skip or a failure spends the visit too: no loop), re-armed only after >= 60 s of decisions outside the town
deposit zone or after the stay window (20 min well / composter, 15 min tail: the town deposit's TD_STAY_REARM_MS). The latch
is TICKED ON EVERY DECISION by cognitive.mjs (Codex r1 P1-1: an order that never gets a turn must still see the bot leave).
A runner decline (busy, paused, body held: it never ran) un-latches. The latch records WHY it is open (`armed`: `first` --
nothing issued yet in this process; `out:<first>-<last>` -- the outside decisions that re-armed it, ms in base 36; `stay`),
every visit order carries it, and a decline restores the reason that armed the declined order (r3, Claude r2 P2-1). Each
visit order keeps its OWN scan stamp (30 s), separate from wellOrder's and townOrder's, so a visit scan never delays a
full-bag order's scan (Claude r2 P3-3). The tail order needs a rows-only plan that frees >= 1 slot before it issues, so a
stay's latch is never spent on a no-op plan (Claude r2 P3-5). Switches: `JUNK_VISIT=off` turns A and B off,
`BAG_ALLOWANCE=off` turns C and D off; both default on; the licence row says which.

WHERE THEY RUN IN THE DECISION (Codex r1 P1-1): after the plinth order, the full-bag town deposit and the town recount, and
AHEAD of the milestone's work order -- a craft-ready rung re-issues its craft every decision and would otherwise hold the
cleanup off for the whole visit (the town deposit's own reason for going first). The cost is bounded: at most one well, one
compost and one tail run per visit (each <= 45-120 s, on its own cooldown), and a visit order never displaces the plinth
build, the full-bag deposit or a recount.

### A. The well at every visit (`well.mjs wellVisitOrder`)
- the bot is in the TOWN DEPOSIT ZONE (16 h / 12 v of home: Claude r1 P2-1 -- the 48-block TOWN_RADIUS would make it a walk
  across town) AND within VISIT_WELL_REACH (20, horizontal) of the well's cap; below 34 slots (>= 34 is the full-bag order,
  unchanged); >= JUNK_VISIT_MIN_STACKS (1) whole stack of LISTED junk (`disposePlan(items).junkStacks`, no options: the
  owner's list and decorations, the guarded raw stones only above STONE_GUARD 64 -- never swords, cobble at the cap or
  at-target stock) that the active goal does not want (Claude r1 P3-6: a wanted name never goes);
- the well usable (not breached, not open: an open well is close_well's), the bot not inside a well, and within the walk's
  vertical reach of the stand (wellcare-01: otherwise HELD at no cost); the well's own 3-min cooldown and 15-min failure
  backoff, shared with the full-bag order;
- order `dispose_well {visit, dh, dw, vid}`. The skill is the same path (stand, admission, sealed re-read at the stand and
  at every click, close in a finally, misses retaken, server-verified account) with `listedOnly`: its throw plan switches
  off swords, cobble-at-cap and stock surplus and skips wanted names, so only listed junk moves.

### B. The composter at every visit (`composter.mjs compostVisitOrder`)
- in the zone, a town composter and storage within 16 (townOrder's own readings), below 34, and >= 1 stack the fill would
  empty WHOLE -- compost junk (leaf litter, seeds, grass, flowers), and under the peaceful switch its plants (mushrooms,
  melon, kelp ...) and apples above APPLE_RESERVE;
- **saplings are NOT part of the visit** (Claude r1 P2-5: under the switch every species but oak and birch keeps 0, and
  planting needs > 8 of one species -- composting them every visit would stop those species' planting); the skill runs with
  `saplings: false` for a visit; saplings still go at 34+ exactly as today;
- the bot within VISIT_COMPOST_REACH (20, horizontal) of the town composter (r3, Claude r2 P3-1: a composter within 16 of
  home and a bot within 16 of home can be 32 apart);
- order `compost {visit, armed, dh, dy, dc, vid}`; a not-full bag always has room for the bone meal (`fillDecision` only inserts, ripens,
  harvests).

### C. The slim bag allowance (bagbudget-02's tail; `bagallowance.mjs`, `towndeposit.mjs`)
bagbudget-01's whole-stack planner with the owner's rows:

| row | kept in the bag | surplus goes to |
|---|---|---|
| K stations: crafting_table, furnace, blast_furnace, smoker, chest, barrel, composter, bucket, water/lava/milk bucket | 1 of each | a town chest, WHOLE stacks only (a second stack, or a second filled bucket: they do not stack) |
| T torch | 0 | a town chest |
| B bone_meal | 0 | a town chest |
| P stone_pickaxe | the best working pickaxe of any tier (> FLOOR 10 uses) + the 2 stone copies with the most uses | USABLE copies (> 10) beyond them, under the town's stone_pickaxe target (depositPlan's tool cap; the bank click's stock claim re-checks) |

bagbudget-01's rules kept: junk is never a chest's (`notForChest`: the bank's ballast, the well's list, NEVER_KEEP, compost
inputs, the peaceful plants and apples under the switch, every sapling, bamboo); a name another layer owns is never a row's
(`bankOwned`); the goal's keeps win (`max(row, townKeeps floor)`); a withdraw hold covers its name; whole stacks, smallest
first; the visit's CREDIT_CAP; ladders are on no row (every ladder stays); iron pickaxes are on no row (ironpick-01's toolkit
flow); `BAG_ALLOWANCE=off` is the rollback. Not ported: bagbudget's ladder, food and building-stone rows, its deletion-first
wait (A and B now run below 34, so banking a torch that takes a bag from 34 to 33 no longer strands the junk: the visit
order takes it) and its keep-constant consolidation.
- **full bag (>= 34)**: the existing town deposit plans its base steps THEN the rows' steps (base first in the container). A
  rows-only plan still takes the count step (bagbudget). As in bagbudget, a full bag holding only torches now gets a town
  deposit ahead of a ready milestone step (Claude r1 P3-8: said). At a full bag the BASE tool rule (best usable copy stays,
  usable spares bank under the target) is unchanged and is stricter than row P (Codex r1 P1-3): "at most 2 spares" is a
  ceiling; row P's floor is judged on the tail runs.
- **not full**: `tailOrder` issues `town_deposit {tail, dh, vid}` (the zone, a town container within STORAGE_REACH 16, once
  per stay, the town deposit's 5-min cooldown and 15-min backoff in ITS OWN state: the outcome is routed by `args.tail`,
  Claude r1 P2-2). The skill plans the rows ONLY (no base plan, no count, no valve) in every plan of the run, `bankInto`'s
  window re-plan included; the order sets the run's goal wants (Claude r1 P2-3).
- The rows never enter `depositPlan`: the deposit verb, its walks, its new-chest recovery and the CARRYING line never see
  them.

### D. Spare spent pickaxes at the wear-out (`hygiene.mjs wearOutPlan`; Claude r1 P2-6)
last-swing keeps up to 3 spent pickaxes for good (SPENT_PICKAXES_KEPT), which is how a bag holds best + 2 stone + 3 spent.
Under the allowance, WITH A WORKING PICKAXE (> FLOOR uses, any tier) in the bag, the spent copies last-swing keeps count
against the owner's 2 spares: kept spent = min(3, max(0, 2 - the stone copies with >= 2 uses other than the best working
pickaxe)). WITHOUT a working pickaxe the three stay (r3, Codex r2 P2-1: three last swings are the recovery's material for the
next stone pickaxe; `hygiene.mjs spentKeptUnderSpares`). Only at the wear-out's own trigger (>= 34 slots,
anywhere -- the existing order; never at town for its own sake, because wear_out digs the natural block beside the bot and
does not read the town-ground zone). The toolkit's rule (none kept beside a usable iron + stone spare) is unchanged and
runs first. The craft's make-room remedy reads the same plan (as in bagbudget-01). `_junkout phase=wear` names the copies
listed only because of this rule.

### E. Rows
- `_junkout_mode` once per spawn (the licence; only this build writes it): `phase=mode visit= allowance= rows=...`.
- `_junkout phase=well|compost` per visit run, once, whatever the ending: `vid dh dw offlist swords cobble stock slots
  listed n status stop` -- what the throws were AS THE SERVER NAMED THEM, on the row itself (no pairing by time: Codex r1
  P2-6, Claude r1 P3-3).
- `_junkout phase=bank` for EVERY town-deposit run that planned a row or banked anything (so J1 sees every name a town
  deposit put in a chest), complete in parts (`part=i/n`, `v=`): `mode=tail|full dh keep_picks allow=name=start:banked
  other=name:n`.
- `_junkout phase=wear` when D listed a copy.

## 4. Composition: the dead-end table

| situation | what happens | remedy the bot can perform from here |
|---|---|---|
| no well in town | no visit dispose is issued (the order needs a usable well); the build order runs as today (plinth-first) | the build order |
| well breached / unknown cell / player within 5 | skip, free; the latch is spent for this visit | the next visit; a breached well is rebuilt by the build order |
| bot deeper than the stand's reach | HELD, no cooldown, no latch | the first decision within reach |
| bot in the zone but > 20 from the well | no order | none needed: the bag keeps its junk to the next visit near the well (never a walk across town) |
| visit dispose fails (stand unreachable, unverified bag) | the well's 15-min dispose backoff (shared: the full-bag order waits too) | the next visit after the backoff |
| no composter in town | no visit compost; build_composter is the existing order | the build order |
| tail order, no container in reach | no order | the next stay near a chest |
| tail run, chests full | `town_storage_full`, 15-min backoff of the TAIL state only; "waits for a town chest with room -- keep working" | none needed: nothing is lost |
| row P, the town at its stone_pickaxe target | the copy stays | -- |
| withdraw hold on a row name | it stays for the hold | -- |
| a bank takes the bag from 34 to 33 | the full-bag well order stops | the visit order takes the junk in the same visit unless latched; else the next |
| a ready milestone rung | the visit orders go ahead of it, once each per visit | the rung gets every other decision |
| treefarm (queued, NOT on this base) wants bag bone meal / torches | its bone-meal / torch steps skip `not_held` (tf-on-adbec4f) | its own design: withdraw from the town chest, or raise the keep |
| toolkit / ironpick | iron pickaxes on no row; 2 stone spares >= the toolkit's 1 | -- |
| planting | saplings never in a visit run or a chest; the 34-slot compost unchanged | -- |
| the model's `deposit` verb | UNCHANGED, and not this change's: it banks what the goal wants (Codex r1 P1-2) | -- |

REQUIRED CHAIN TESTS (through the real CognitiveLoop, before the code review): (1) a not-full bag with listed junk in town
-> dispose_well {visit} -> no second visit order in the same visit, also with a ready milestone rung; 60 s out of the zone
re-arms; out of the zone or > 20 from the well -> no order; (2) the same with a breached well -> skip -> no loop; (3) torch +
bone meal at town, not full -> town_deposit {tail} -> the latch holds for the stay -> a `town_storage_full` lands in the
tail state, not the full-bag deposit's; (4) a 34-slot bag with junk + torch -> town deposit (base + rows) -> 33 -> the
visit dispose follows in the same visit; (5) leaf litter + saplings, not full -> compost {visit} -> the saplings stay.

## 5. Expected (r2 numbers; whole stacks only; denominator 80 newest bags, 2,445 slots)
At the next town visit near the well / composter / a chest: listed well junk 151 + compost junk 49 + peaceful plants 17 +
torch 72 + bone meal 83 = **~372 slots (15.2%)**, ~4.7 per bag. Stations 0 (no second stacks), row P 0 (the 25 beyond are
spent: D wears out the ones above the spares at 34+), saplings 0 by design. The target is the HEADROOM a bag leaves town with:
a full bag's gather succeeds 4.8% vs 52.2% with room (composter.mjs header, 09-28). Town chests: once ~155 slots of torch +
bone meal across 16 towns, then torch 0.79 + bone meal 0.56 items per bot-day (bagbudget-01's inflow).

## 6. Read, registration, Paper
`scripts/host/junkoutread.py` (files; DiD canary vs control; denominators and positive controls first):
- LICENCE `_junkout_mode`.
- DEFECTS (deterministic, REVERT evidence=defect, each with a failing fixture and a passing legitimate fixture in
  `--selftest`):
  J1 `breach_junk_chest`: a canary `_junkout phase=bank` row banked a junk name (the read's lists held to the bots' by
     `JS_CHECK`); `j1_incomplete` (a run whose parts are not all present) BLOCKS KEEP. The same check on the CONTROL's
     town_deposit details is printed as a null; a base-equal pattern in that null (a goal-wanted listed name the base plan
     banks) is not a defect (Claude r2 P3-4).
  J2 `breach_below_allowance`: a bank row leaves a station below 1, or (mode=tail) stone_pickaxe below min(start,
     keep_picks).
  J3 `breach_dedicated_trip`: a canary visit row with dh > 16 or |dy| > 12 (well, compost, tail: the ISSUE-time position,
     carried in the order's args -- r3, Codex r2 P2-3) or dw > 20 (well).
  J4 `breach_visit_offlist`: a canary `phase=well` row with offlist, swords, cobble or stock > 0.
  J5 `breach_reissue` (Codex r1 P2-5 / r2 P2-2, Claude r1 P1-2 / r2 P2-1): consecutive canary visit RUNS of the SAME kind
     by one bot (`_junkout` rows only: a declined order never ran and writes none), timed by their ISSUE times (carried in
     the `vid` / `v` id), less than the stay window apart (20 min well/compost, 15 tail). The second run's `armed` must
     explain its re-arm: `first` only with a `_junkout_mode` row (a process start) between the two issues; `stay` never
     (impossible inside the window); `out:a-b` only with first issue < a, b < second issue, b - a >= 55 s, and at least one
     position sample OUT of the zone inside [a - 10 s, b + 10 s] -- event rows at their own time, skill rows at
     `@timestamp + duration_ms` (a skill row is stamped at its START with the END position: Claude r2 P2-1). Anything else
     trips. Selftest fixtures that must NOT trip: a legitimate crossing in the start-stamp/end-position shape, a restart
     between, a decline then a retry, a re-issue after the stay window; and fixtures that must trip: a re-issue with
     `armed=first` and no restart, an `out:` claim with no out-of-zone sample.
- EXPOSURE (declared): canary `phase=well` runs with n > 0 >= 10, canary `phase=compost` runs with n > 0 >= 3, canary
  `phase=bank mode=tail` runs (unique `v=`) with banked > 0 >= 3; plus canary zone visits with listed junk >= 20.
- PRIMARY (DiD, reported): slots per bot; listed-junk slots per bag; torch + bone meal slots per bag; share at >= 34;
  gather success; `town_storage_full` per bot-h (HARM: >= 3 and > 2x control).
- POSITIVE CONTROLS: control `dispose_well` >= 1, control `town_deposit` >= 1, control zone visits with junk >= 1.
- `change_rows`: `junkout` ONLY (Claude r1 P1-1: gate v36.1 refuses a change row the baseline already emits).
TIER 2 (`"tier": 2`, no class), on the Paper scenes below (base vs candidate, sandbox); a run missing any early-KEEP
condition reads on as tier 3. Section 3 D (the wear-out spares cap) has no Paper scene: its unit and chain tests are its
evidence (a pure plan over the bag; the wear-out skill is unchanged) -- said here as a tier-2 condition (Claude r2 P3-6).
PAPER SCENES: (S1) a not-full bag with listed junk passing town at a well: junk to the well,
nothing else changes; (S2) 8 chests + 3 tables + 4 spare pickaxes (+ torches, bone meal) at the town deposit: banks down to
the allowance, no junk in the chest; (S3) mushrooms + leaf litter go to the composter, saplings stay; plus the candidate
with `JUNK_VISIT=off BAG_ALLOWANCE=off` shows the base shape.

## 7. Prior art (searched 2026-10-21)
- Client "inventory cleaner" mods (Modrinth Inventory Cleaner, CurseForge Cleanventory / Inventory Filter): a user list of
  junk thrown out automatically on pickup or on a key, without waiting for a full inventory -- the same "every
  opportunity, listed only" rule; they drop items on the ground, which this fleet cannot (the server hands them back:
  hygiene.mjs, owner 09-29), hence the well.
- mineflayer `tossStack`/`toss`: the primitive; same pile problem.
- Voyager (deposit useless items at >= 33 slots, LLM-chosen), Mosfet (cache all but NEEDED at >= 27 slots, one stack of each
  WANTED), mineflayer-collectblock (deposit when full): all full-bag triggers (bagbudget-01 section 7). None runs disposal
  below a full bag at a known safe place, and none separates "delete" from "bank".

## 8. Interaction with queued work
- homefix-02 (live canary d014ec2c): touches cognitive.mjs, skills.mjs, composter/towndeposit (RUNNER_DECLINED import). A
  variant `junkout-on-d014ec2` is the same commits cherry-picked.
- ironpick-01 (ironpick-on-34d3e5e): composter.mjs `townOrder` signature (`pickDefer`), a textual neighbour; no behaviour
  overlap (iron pickaxes on no row).
- bamboo-03: bamboo stays junk (never a chest's, not the well's); no overlap in the fold.

## 9. Deviations from the owner's wording -- UNRESOLVED, the owner's call (Codex r1 P2-4)
- **Stations, "one of each"**: kept as one STACK (whole-stack banking). "6-13 chests" is one slot; a partial move frees no
  slot and needs a new click path. Not built.
- **"At most 2 spare stone pickaxes"**: met at the wear-out (D, >= 34) and for usable copies at the town deposit (C row P);
  in a NOT-full bag spent copies above the spares stay until the bag fills (they cost no headroom until then, and wearing them
  out at town would dig the town's ground).
- **Torch / bone meal "capped"**: the cap is 0 (a cap above 0 keeps the one slot). Constants `ALLOWANCE.torch`, `.boneMeal`.
- **Saplings "capped"**: by the composter's reserves at 34+, unchanged; never a chest's (bagbudget's rule) and never a visit
  compost (planting).
- **List additions**: none made (section 2).

## 10. Reviews
**Design r1 (66b85cda).** Codex CHANGE: P1 visit cleanup starves behind a ready rung and its latch misses departures; P1 junk
into chests on other deposit paths; P1 row P vs the base tool rule at a full bag; P2 owner wording silently weakened; P2 J5
false-REVERT; P2 J3/J4 coverage, run ids; P2 tier-2 evidence (compost exposure, unique runs, scenes); P3 dripstone is third,
not first, in PIT_COVER_BLOCKS. Claude CHANGE: P1 change_rows must be `junkout` only (v36.1); P1 J5 false trips; P2 the 48
radius makes a cross-town walk; P2 tail outcome routing; P2 stale wants in the tail run; P2 the measure left out the guarded
stones; P2 visit composting saplings stops planting; P2 last-swing's spent keeps break "at most 2 spare"; P2 tier 2 needs
named scenes; P3 the no-well row, the switch name, J4 pairing, a J1 null, the tail slot, wanted names, filled buckets, cites.
**Design r2 (5e5073cc), Claude CHANGE:** P2 J5's position test could trip on a legitimate re-arm (skill rows are stamped at
the start with the end position); P2 D could leave a bot with no working pickaxe two last swings (the same point as Codex
P2-1); P3 the composter reach, the exposure by the well reach, separate scan stamps, J1's base-equal null, the tail's
freed >= 1, D's evidence. ALL TAKEN in r3 (the `armed` reason and the end-time sampling; the working-pickaxe condition;
VISIT_COMPOST_REACH 20; the r3 reach check above; sections 3, 6).
**Design r2 (5e5073cc), Codex CHANGE:** P2 D's formula took the third last-swing copy with no working pickaxe; P2 J5 counted
declined orders and process restarts; P2 J3 did not see the vertical zone bound. ALL TAKEN in r3 (sections 3 D, 6).
Round-1: ALL TAKEN in r2 except: Codex P1-2 is answered (the model's deposit verb is unchanged and banks only what the goal wants;
J1 covers every town-deposit chest admission, and a control null), and Codex P1-3 is answered as a ceiling (section 3 C).

**Design r3 (3e5ee66f): Codex APPROVE, Claude APPROVE.** Claude's P3s, taken in the code: `first` means a CONNECT (the mode
row and the latch are per connection, index.mjs); a low-durability iron pickaxe (11 uses) beside healthy stone copies is pinned
by a test (junkout.test.mjs row P: the iron is the best, the two stone copies with most uses are the spares). Not taken (P3):
the decision log's snapshots as J5 position samples -- the read uses the skill and event rows (a decision that runs no skill
writes neither); a J5 trip names the missing sample, and the selftest's must-not-trip fixture is the start-stamp/end-position
shape the reviewer named.
