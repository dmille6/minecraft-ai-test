# idlework-02 — bags after idle work (2026-11-06)

Base: gkforever-01 `9e9284d7` (branch `gkforever-01-on-47b8342d`: decbundle-01 `47b8342d` on idlework-01 `cab8abcf`). Built there
because gkforever-01 changes `bots/src/idlework.mjs` (the grounds lap, `idleStep`'s `now`, `idleMet`'s grounds rule) — the same
functions this change edits. Branch `idlework-02`.

## The metric that alerts

Grafana "Many bags full" (folder Minecraft AI, uid `mcai-bags-full`, read anonymously from `/api/prometheus/grafana/api/v1/rules`):
`sum(mcai_bots_bag_full{scope="fleet"}) > 15` for 1 h. `mcai_bots_bag_full` = bots whose newest body row has **>= 34 of 36
estimated slots**, estimate = `sum(ceil(count / stack size))` (`infra/dashboard/agent/mcai-dash-agent.py slots_used`). Pending
13:11:20Z; live 19 (13:20Z), 24 (13:35Z). Flowledger's bags line (departures, 6 h): `at>=34` 52-64 before idlework-01, 110 at 13:05Z
(p50 28, p75 30 unchanged). The bot's own slot count (`items().length`) is >= the estimate (partial stacks), so the bot-side
thresholds below are in real slots.

## Measured (fleet, 80 bots; telemetry full walks on .31, positive control = 80 of 80 bots with body rows at every snapshot)

| snapshot | >= 34 | >= 30 | >= 30 kinds | by-products / bot (items, slots) | cobble slots (all) |
|---|---|---|---|---|---|
| 11-05 10:25Z | 4 | 27 | 1 | 11.9, 0.86 | 253 |
| 11-05 13:20Z | 4 | 29 | 2 | 13.5, 0.94 | 239 |
| 11-06 10:25Z (idlework fleet-wide 10:30Z) | 9 | 34 | 5 | 13.9, 1.02 | 238 |
| 11-06 13:20Z | 18 | 46 | 9 | 21.5, 1.86 | 283 |

(by-products = granite, diorite, andesite, tuff, calcite, clay_ball, moss_block, dirt.)

13:35Z, the 24 bots at >= 34: cobble + deepslate 5.96 slots each, **3.62 of them whole stacks above the bot's 64 reserve**; listed
by-products (granite/diorite/andesite/clay) 2.21 slots; tuff/calcite/dirt 0.75; moss 0.25; 28.5 distinct kinds. **22 of 24 were in
the field** (current skill mine 6, goto 7, gather 4, deep_mine 2, craft 3, home 1): the bag fills during the batch.

Per idle batch (open -> next open, net bag rise; 09:36-13:30Z, 622 opens): iron 154 batches, median 51 min, 115 met — cobble +52,
deepslate +13, raw_iron +3.0, granite 1.9, andesite 1.6, dirt 1.6, diorite 1.3, raw_copper 1.3, tuff 1.2, clay 1.0. coal 95 (21 min):
cobble +24, copper_ingot 4.9, coal 3.0. logs 110 (14 min): cobble 6.5, deepslate 4.9, oak_log 3.8. scout 263 (0.2 min): ~0.

Pickups (`_pickups` rows, 05:30-10:36Z vs 10:36-13:30Z): stone by-products are ~100% **passive** (the server hands a dug block's drop
over): granite 0 sought / 2,185 passive after, andesite 14/2,229, diorite 2/1,935, tuff 1/870, cobble 470/18,905 (passive cobble
1,810/h -> 6,520/h). "Never chase" already holds for them; not collecting them is not available to a bot that digs.

Town visits 10:36-13:30Z: 570 departures (end of deposit / town_deposit rows); **215 in the 29-33 band** (under the 34-slot dispose),
42 at >= 34. Band departures carry 267 cobble + deepslate above the 64 reserve on average (**794 whole stacks in 3 h**) and 7.4 listed
by-products. Towns at the cobble cap: `_stock_refused` 256/h. well_dispose 25/h -> 68/h (10,179 cobble thrown in 3 h), junkout visit
orders 98/h -> 142/h (listed junk only).

Value-weighted intake (valuescore.py, 3 h windows): 11-05 10:40-13:40Z 7.57/bot-h; 11-06 07:30-10:30Z 17.85; **11-06 10:40-13:40Z 68.14**
(cobble weighs 0.25, raw_iron 8). The guard: not worse.

### The coordinator's item: `mine` bad_args

11-06 10:40-13:40Z (live llm files, 28,638 model calls): 2,132 `bad_args`, **2,028 of them `mine`** (of 6,936 mine calls); 1,993
"mine only digs DOWNWARD" (args.y - feet y: -1 620, 0 584, +1..+13 ~600; i.e. y at or above the gate's ceiling `ceil(y-2)`), 35 below
bedrock. By milestone: idle_work 1,540 (task iron 1,377, coal 161), gather_iron_ore_3 468. The prompt's ELEVATION line already names the
ceiling ("pass y=14 or lower"), but the iron batch's HINT said "if none is in sight, mine down to y=16 and look again", and the bot was
usually at the town stair's landing at y=16 (LAST ACTION "reached the town stair's landing at y=16"): the hint's literal 16 out-voted
the ceiling. The gate is right (the skill cannot act there); the cause is the hint.

## Design (Claude)

1. **Band dispose** (`well.mjs wellBandDue`, `IDLEWORK_WELL`): the town dispose order is also due at **29-33 slots** with the same
   plan the 34-slot order throws (`disposePlan`: listed junk incl. granite/diorite/andesite/clay_ball above the 64-stone guard,
   peaceful swords, cobble + deepslate **only with the town proven at its cap, the bot keeping 64**, target-0 / at-target stock —
   tuff, calcite, gravel, dirt above its 16 keep — above the 64 pillar reserve). The junkout VISIT dispose in the band throws the same
   whole plan (`skills.mjs disposeWell`: `band`), the goal's wanted names still kept. No new list. The owner's 10-16 overflow rule.
   Default on; **off in the showcase pool** (the coordinator turned bagroom-01's band well off there for stoneworks); the fleet's
   towns keep their own 1,000 in chests, which is what stoneworks-01 draws from.
2. **Bag stop** (`idlework.mjs idleBagMeans / idleBagFull`, `IDLEWORK_BAGSTOP`): a bag batch (iron/logs/coal) is met once THIS batch
   raised the bag to **30** real slots; no bag batch opens above **28** (the lap is a grounds or scout lap: no bag gain, never a batch
   met at open, so no spin). The stop is a completion, never a skip: it bars nothing. The met row carries `reason=bag_stop`.
3. **Depth-aware hint** (`idlework.mjs idleDepthHint`, `milestones.mjs hintOf` / `hintFor`): at or below y=18 the iron hint names
   `mine with y=<min(ceiling, y-8), >= -50>` (always a target `mining.mjs mineTargetOk` accepts — tested for every half-block from -58
   to 18) and the ceiling itself; near bedrock it names surface. The coal hint below y=40 says coal is scarce there and names surface.
   The iron ladder rung `gather_iron_ore_3` reads depth the same way.

Not done here (and why): a demand-ranked kind picker (needs town readings per kind; the measured gains are net of banking, and iron/coal
have no town targets to rank against) — a separate piece; field tossing (owner 09-29); new junk lists; changes to cognitive.mjs or
admission.mjs (protected, tier 3).

## Codex (independent, read-only, given the measurements and the goal, not this design)

Ship order: arrival cleanup first, field stopping second, demand selection third.
1. Arrival cleanup **regardless of slot count**: an idle-return marker in `milestones.mjs`, scheduled from `cognitive.mjs #visitOrder`
   after the deposit; `wellVisitOrder` gets an idle-return mode using `disposePlan` / `cobbleWellStacks` / `stockWellStacks`;
   `disposeWell` changes BOTH its entry plan and `throwPhase`'s `listedOnly`. Bank accepted cobble first; keep the 64 combined reserve,
   not another stack for stoneworks; dispose only when `cobbleWellCap()` proves overflow; keep STONE_GUARD, STOCK_SCAFFOLD_MIN, wants,
   holds. No NEVER_KEEP expansion, no new list. "Merely restoring f345094f's 29-33 trigger misses returning bots below 29."
2. Stop acquisition: open only at **<= 28** occupied slots, stop at **>= 30** (hysteresis: 8 free at launch = the build-room rule, six
   left for passive pickups and escape work); real slots for control, log the estimate. Pressure ends the batch for its cycle without
   barring the material. Also check inside long mine loops in skills.mjs.
3. Demand: rank by uncovered demand in batches (bills, stoneworks inputs, reserves minus stock and committed batches); copper at 8 only
   for explicit copper demand; with unknown demand keep the rotation. Not value/time (net deltas include banking; copper has no weight).
4. Pool-scoped flags `IDLEWORK_ARRIVAL` / `_BAGSTOP` / `_DEMAND`; do not re-enable showcase bagroom globally; 6 h then 24 h on whole
   towns; >= 25% relative drops in both pressure bands and in carried by-products, no value decline.

## Reconciliation

- **Agreed**: shed at town through the existing well plan (cobble only at the proven cap, 64 kept, guards intact, no new list, no
  NEVER_KEEP change); both `disposeWell`'s entry plan and `throwPhase` must change (built that way); the stop bars nothing; demand
  ranking is a later piece; showcase untouched.
- **Thresholds**: Codex's hysteresis adopted (open <= 28, stop >= 30; my first draft was a single 31).
- **Arrival cleanup at any slot count (Codex) vs the 29-33 band (built)**: the band needs no change to `cognitive.mjs` (protected,
  tier 3) and covers the alert's population — the 215 band departures (38%) carrying 794 whole stacks. Below 29 the bag is not the
  build's problem. Codex's marker is the follow-up if the read shows bots dropping just under 29 and refilling. Recorded, not built.
- **In-skill stop inside mine loops (Codex)**: not built; mine/deep_mine are bounded skills and the rung is re-read between skills.
  The read reports the time from `bag_stop` to the next town arrival; if it is long, that is the next piece.

## Facts this rests on (seen work here, no new Paper behaviour)

The well's throw, the at-cap cobble plan and the stock plan are the 34-slot order's, live fleet-wide since junkwell-02 / cobblekeep-01 /
stocktarget-01; the band only moves when it is issued (bagroom-01 did the same on the showcase, f345094f). The hint changes text only.
No Paper sandbox proof is needed (no new world interaction).

## Read (effect)

Mechanism: `_idlework phase=met reason=bag_stop` rows > 0 on canary bots; `_well_dispose` rows with slotsBefore 29-33 > 0; `mine`
bad_args "only digs DOWNWARD" per mine call down. Effect: bots >= 30 and >= 34 (time-weighted, estimate as the dashboard) down;
by-product items per bot down; cobble + deepslate whole stacks above 64 at departure down. Guards: value-weighted intake per bot-h
not worse; deaths (the death gate); `_junkout` offlist throws unchanged (cobble/stock throws are named on their own fields).
