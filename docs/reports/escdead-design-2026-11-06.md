# escdead-01: break the escape dead ends (phase 2.3), 2026-11-06

Owner (11-06): phase 2 of the code evaluation ([codeeval README](codeeval-2026-11-06/README.md), [survival.md](codeeval-2026-11-06/survival.md)
S1/S4/S5). PROTECTED scope (reflex.mjs, poolescape.mjs, exit-contract.mjs, protectzone.mjs): tier 3, two engines, Paper.
Branch `escdead-01`, built on gkforever-01 `9e9284d7` (decbundle-01 on idlework-01 `cab8abcf`, the live fleet) with
handcap-01 (`601fe6a3..f78e08b6`, queued) cherry-picked under it, byte-identical diff: escdead composes with handcap rather
than racing it.

## 1. Measurement (denominators)

**Pins, fleet, 7 d** (10-30 11:00Z .. 11-06 11:00Z; full rotation-aware walk of every skill file, 80 bots, 8,765,313
positioned rows, 13,409.4 online bot-h; a pin = the body inside one 3-block box for >= 1 h, gaps > 10 min break it):

| | pins | bot-h | share of pinned |
|---|---|---|---|
| all pins >= 1 h | 124 | 457.1 (3.4% of online) | 100% |
| climb-flood chain in the pin's rows (`_climb_flood_guard` / `_climb_flood_refused`) | 34 | **335.7** | **73%** |
| isolated-d-Delta + -Echo at 358,58,180 (ongoing) | 2+ | 205.6 | 45% |
| isolated-c-Bravo 355,48,187 (ended 11-05) | 2 | 60.2 | 13% |
| hive-c-Bravo 124,52,64 -> 127,52,65 (ongoing) | 2 | 16.1 | 3.5% |

Per day: 23-25 bot-h 10-30..11-01, then 65.1 / 95.8 / 99.4 / 86.2 on 11-02..11-05. failmine (3 d to the 11-06 03:16Z
backup; 5,662,744 docs, 5,773.3 positioned bot-h, still spells >= 30 min = 387.8 bot-h on 73 bots): cluster #1 isolated-d
358,58,181 = 144.0 bot-h (37%), 2 bots ongoing; #4 hive-c 124,52,64 7.4 h ongoing.

**Today's rows** (11-06 00:00-11:31Z, 80 bots, ~920 bot-h): `_climb_flood_refused` 460 rows on 31 bots; `_swim_under_refused`
60 on 3 bots (the three targets); `_swim_under` **0** fleet-wide; positive control `_climb_flood_guard` 1,975 on 36 bots.

**The compositions, from live rows and a fresh cut** (failmine `cut` of the 11-06 03:16Z backup's region copy, read-only):
- *isolated-d 358,58,180* (Delta, Echo): feet water, below water to y54, head air, roof granite y60, **one** water source at
  y61 closed by dirt y62 (diorite 63, three bot-placed cobblestone 64-66, air 67). Feet level N furnace, S crafting table,
  E water, **W stone** -- on the 11-03 cut W was water: that is swimunder-01's 7-cell way out (Paper 6/6 on 11-03), now
  closed. Live: `_swim_under_refused "no way out within 4 cells (12 water cells searched)"`, the flood guard, plugcut "0,3,0",
  `sealed_in_liquid`. Both hold stone/iron pickaxes with uses: not a tool problem.
- *hive-c-Bravo*: a dry pocket (feet/head air, sand walls) at 124,52,64 under **dirt y54 and a lake** (8 water sources
  y55-62, open air y63+). Two iron_pickaxes at 249/250, bag 36/36, `_craft_room refused` x72 "no spent tool that can be spared
  (the last digging pickaxe is kept)" while making planks for a wooden pickaxe; `_climb_flood_guard` (shaft_ascend).
- *showcase-Gale* (.40): still at 64.5,58,38.5, 613 `_protect_zone_refused` today (op=place purpose=other by=place:crafting_table,
  surface purpose=transit), iron_pickaxe 249/250. handcap-01 is not live there (0 `_handcap_mode` rows).
- **Pickaxe census** (last row per fleet bot, 80): 53 hold >= 2 usable copies, 0 exactly one, 2 only 1-use copies
  (hive-c-Bravo, hive-d-Echo), 34 hold at least one 1-use copy, 25 report none.
- **Fleet zones**: 13 pools carry a fixture zone (floor_y 61-71); 60 `_protect_zone_refused` today, 52 of them deep_mine
  planning; no fleet pin involves a zone. (c) is a showcase lever.

## 2. Design (Claude), Codex's independent design, reconciliation

Claude's design (before Codex's): one pin clock; the wide swim on a long pin; the breach only when the water over the roof
is open to air; one pickaxe predicate in toolfor.mjs with a pinned exception; terrain depth in the zone guard.

Codex (`codex exec -s read-only`, given the measurements and the goal, not this design; 66k tokens) converged on the same
three moves and the same ranking ((a) >> (b) > (c)), and said explicitly: isolated-d is freed by the WIDE SWIM, not the
breach ("the y61 water cell capped at y62 is not an ascent"); hive-c is the breach case; Gale is handcap's.

| point | Claude | Codex | built |
|---|---|---|---|
| wide search | radius 8, descent 4, ascent 8, length 28 | radius 8, descent 4, **ascent 6, length 14** ("widen geometry, not breath") | **Codex**: `SU_WIDE = {radius 8, maxDown 4}` |
| narrow no-plan back-off | kept | invalidate on the tier change | **Codex**: an entry earned by the narrow search does not hold the wide one |
| breach water depth | <= 10 cells | a 12-cell feet ascent + a tick budget | **both**: <= 8 water cells AND Codex's budget (20 launch + 30 per flooded cell + 20 per still cell <= 240 of 300 ticks; hive-c's rise = 240). Prismarine sim of hive-c: 73-97 ticks |
| stall during the rise | stop and clear controls | "never clear the controls under water" | **Codex**: a stall is counted, the rise goes on to the budget, and a failed rise leaves jump held for the float hold / rescue |
| full air | oxygen 20, or null with the head in air (swimunder's Paper finding) | raw 300 ticks or 100 ticks of verified air | **Claude**, bounded: the breach also needs 30 min pinned with the head in air now; rounded 20 = >= 293 ticks |
| two bots in one pocket | not handled | require companion readiness or do not breach | **Codex, simplified**: any player within 2.5 blocks refuses the breach |
| pickaxe rule | one predicate in toolfor.mjs, a `pinned` flag from the reflex's own pin clock | a separate `pickcap.mjs` with per-dig allocation (`digSpendPlan`) and a scoped grant; quarantine a copy after its last swing | **Claude** for the shape (toolfor.mjs already holds HARD_STOP/FLOOR; the grant is scoped by construction: only reflex.mjs's escape digs read the pin); Codex's per-dig allocation and quarantine are NOT built (a phantom 1-use copy digs at hand speed server-side: slower, not harmful) |
| craft room | wear a 1-use copy while another copy with a use stays, any craft ('spare') | the same arithmetic ([1,1] = two swings, one may go) but propagate the final craft goal through makeCraftRoom | **Claude** (no goal threading through skills.mjs); Codex's "escape before craft" holds anyway: the breach is a reflex and needs no slot |
| zone depth | the live column: >= 2 natural blocks over the cell before any other block | a frozen per-column surface map, 8-block thickness, all planners and the chokepoint agree, and outside->deep mining opens | **Claude**, narrowed: the chokepoint only (dig/place/use/craft); planners keep floor_y. A frozen surface map is a world-file job and out of scope; noted for phase 3 |
| rollback | ESCDEAD=0 | one switch (ESCAPE_PHASE23=off) | ESCDEAD=0 turns all three off; a breach already open keeps its rise |
| nondominated swim states | - | keep several states per cell (wet run vs wet total) | not built (the live route is found without it); noted |

## 3. What is built (bots/src/escdead.mjs, toolfor.mjs, reflex.mjs, poolescape.mjs, exit-contract.mjs, craftroom.mjs, protectzone.mjs)

**(a) Pin clock + wide swim + flood-in breach.**
- `pinStep` / `pinnedFor`: the body in one 3-block box (failmine's still box); a new body (death, respawn, reconnect) starts a
  new clock. The reflex tick steps it (`pinTick`, inside a try).
- `swimSearchFor(pinnedMs)`: `{}` under 30 min, `{radius 8, maxDown 4}` from 30 min. swimUnderTry passes it; its rows say
  `wide=1`.
- `breachPlan({at, feet})`: head cell air; roof (feet+2) solid and breakable (not bedrock/obsidian/barrier/portal/spawner...);
  1..8 water cells over it the body fits; then two cells of air (an open surface); no lava within 4 of the pocket or the column;
  every cell loaded; the breath budget. `breachAdmit`: pinned >= 30 min (`ESCDEAD_PIN_MS` overrides it for the sandbox
  only), the head in air, air 20 (or unreported with the head in air), health >= 18, nobody else within 2.5 blocks, ESCDEAD on.
- `floodBreachTry` (reflex.mjs) runs after the flood refusal and a swim-under that did not get out, in BOTH arms (marooned and
  entombed); swimunder's ownership pattern (float hold stands aside, a `floodbreach` reservation renewed every 5 s, the
  drowning rescue and danger moves pre-empt every tick); the roof dig goes through the escape guard (`guardMay`), the escape
  tool policy (pinned: the last swing is open) and `digBounded` (12 s). `floodBreach` re-reads the roof and the water, digs,
  confirms the roof is gone, then rises with swimunder's vertical controller (centre, jump held) until the eye is out at the
  surface. Rows: `_flood_breach_start`, `_flood_breach` (outcome, water, rose, dig_ms, min_air, hp), `_flood_breach_refused`
  (once per place per 10 min, with the reason). A roof that can never be breached backs off 10 min; a failed breach 30/60 min.

**(b) One usable-pickaxe rule** (toolfor.mjs `usablePickaxes`, `swingsLeft`, `hardStopFor(..., {pinned})`, `escDeadOn`):
a copy is usable while it has more than HARD_STOP (1) uses left, unknown durability = full; a PINNED escape (the reflex's
own escape digs, the body pinned >= 30 min) may swing the last use and is not bound by the reserve. Every module now asks it:
- `mayDigForEscape(items, block, {pinned})`: unpinned = the base (refuse at exactly one usable); pinned = allowed.
- `poolToolOk(tool, items, n, {pinned})`: unpinned = the base; pinned = the copy may go to its last use.
- `toolFor(block, items, {pinned})`: a 1-use pickaxe becomes eligible but stays RESERVED (<= FLOOR): it digs only what the hand
  cannot harvest (stone, ores) -- never instead of the hand.
- `pickaxeUses` (exit contract): uses - HARD_STOP per copy, numerically the base; a descent is never pinned.
- `craftRoomRemedy`: a 1-use copy may be worn out for ANY craft while another pickaxe copy with >= 1 use stays (`spare`);
  a sole 1-use copy is never worn (it is the pinned last swing). ESCDEAD=0: the base (>= 2 uses survivor, pickaxe crafts only).

**(c) Terrain depth** (protectzone.mjs `terrainDeep`, `blockedIn(..., deep)`): a cell is in a zone's deep part when below
floor_y OR under >= 2 blocks of natural ground (stone family, dirt, gravel, sand, clay, ores...) before any other block
(planks, cobblestone, logs, sandstone, terracotta... are village blocks) within 24 cells; the bot's feet likewise. Only the
chokepoint (`attachProtectZone`'s gate, memo 5 s) passes `deep`; the pathfinder price, findBlocks and mine's keep-out keep
floor_y. On the showcase this opens Gale's shaft (transit places, the table and its craft) only when the shaft is under two
blocks of ground; handcap-01's survival climb is the main fix there.

**Licence row** `_escdead_mode on=1 pin_min=30 wide=r8/d4 breach_water<=8 hp>=18 pinned_last_swing=1 zone_depth=terrain`
(features.mjs, once per spawn). **Rollback**: `ESCDEAD=0` in the env (every call site then runs the base line).

## 4. Facts the design rests on, and what Paper must show

- Water: a source over a broken block flows into it as falling water within 5 ticks; falling water beside solid faces pushes
  an entity DOWN (vanilla FlowingFluid.getFlow adds (0,-6,0); prismarine-physics `getFlow` does the same, normalised, x0.014
  per tick) against the swim-up's +0.04 per tick (1.21 water gravity 0.005): net rise ~1.6 b/s in the falling cells, ~2.7 b/s
  in still water (the sim's 73-97 ticks for 10 cells agree).
- Breath: 300 ticks; the server sends `air_supply` only on a change, so a breathing bot reads null (swimunder Paper 11-03).
- A pickaxe at 1 use breaks one block and the drop survives (toolfor last_swing, proved on the sandbox 09-28); the client
  shows a broken copy at 1 use until the slot update lands (> 1.5 s): a phantom swing digs at hand speed server-side.
- Mineflayer movement is client-side physics (prismarine-physics) checked by Paper's movement rules; the rise is a held jump,
  the same input swimunder's rise uses (Paper 6/6 on 11-03).

Paper (section 5) shows: the base pinned in both scenes; the candidate out of isolated-d by the wide swim; the candidate out
of hive-c's pocket by the breach.

## 5. Paper proof (sandbox5 + sandbox6, 11-06 11:30-12:30Z, failmine's scene driver, per-server `failmine` locks taken and released)

Scenes cut by failmine from the **11-06 03:16Z** backup's region copy (read-only). Driver `sandbox/failmine/scene-e2e.mjs`
(driver_sha256 b548743b...), the whole bot (`src/index.mjs`, model off), fidelity 296/296 and 468/468 probes. Base =
`a625ecc3` (gkforever-01 + handcap-01, the fleet's next tip); candidate = `8f719091` (WIP) and `9ad677ef` (r1). The candidate
runs set `ESCDEAD_PIN_MS=60000` (a 1-minute pin instead of 30, so a 9-16 min scene reaches the long-pin moves; said in every
`_escdead_mode` row: `pin_min=1`). Oracle `escape`: alive, >= 2 blocks from the start (or 2 up), held 20 s.

| scene | build | runs | outcome | how |
|---|---|---|---|---|
| isolated-d 358,58,180 (Delta/Echo, 11-06 cut) | base a625ecc3 | 1 | **stayed** 9 min, HP 20, matched the fleet chain | `_entombed`, `_climb_flood_refused`, plugcut, `_swim_under_refused` "no way out within 4 cells (12 water cells searched)" |
| isolated-d | cand 8f719091, 9 min | 1 | stayed (time) | the wide swim started at 8:45 into the run and the run ended mid-swim at y53: a no-plan back-off from an early "below=stone" read; rerun at 16 min |
| isolated-d | **cand 9ad677ef, 16 min** | **3** | **escaped 3/3**, HP 20 -> 20 | the 3rd flood refusal (~1.3 min): `_swim_under_start wide=1 exit=dry cells=10 wet=6 run=4`, `_swim_under success cells=10/10 min_air=17 hp=20->20 ms=8,248-8,310`; end 356,55,177 (the planned dry exit), held 23.8 s; the breach correctly refused every time: "closed by dirt at y=62" |
| hive-c 124,52,64 (Bravo, 11-06 cut + the lake surface y63-72 from the same region copy) | base, cand 8f719091 | 1 + 1 | stayed, **no rows**: the reflex's higher-ground probe (`isEntombed`) reads a pocket under an open lake as "not a hole" (water is not ground), so no escape arm fires -- the live bot reached the entombed arm only after it dug into 127,52,65 | - |
| hive-c + a SYNTHETIC stone pillar at 128,52..57,64 (4 east, in the lake) so `isEntombed` fires as it does live | base a625ecc3, 12 min | 1 | **stayed**, HP 20, the fleet chain | `_entombed` x9, `_climb_flood_guard` x18, `_climb_flood_refused` x9, `_plugcut` x6 |
| (same) | **cand 9ad677ef** | **3** | **escaped 3/3**, HP 20 -> 20 | 3rd refusal: `_flood_breach_start roof=dirt water=8`, dig 672-1,008 ms, `_flood_breach success outcome=out rose=9.9 min_air=16 hp=20->20 ms=3,716-4,173`, then `_water_float` at the surface; held 23.9 s |

What Paper showed that the unit tests could not: the server accepts the rise through the falling column (9.9 blocks in 3.7 s,
16 of 20 air left), the water arrives as modelled, and nothing else in the reflex fights the rise. **Open for the read:**
the dry pocket under an OPEN lake (hive-c's 03:16Z position) is not seen by `isEntombed` at all, so neither base nor this
build acts there; the live bot is in the entombed shape now (127,52,65). Not widened here (isEntombed is the entry of every
escape; changing it is its own change). Codex's further gates (30 repeats, two bots in one pocket, lag) were not run: one
bot per scene, 3 + 3 candidate runs.

## 6. Tests

`bots/test/escdead.test.mjs` (`node scripts/run-tests.mjs escdead`): the pin clock; the wide search on the live 11-06
isolated-d cut (no exit at radius 4 with exactly the live "12 water cells", a 10-cell dry exit at radius 8 / descent 4, wet
run 4) with the 11-03 cut as the positive control; the breach refused at isolated-d ("closed by dirt at y=62") and planned at
hive-c (roof dirt y54, 8 water, top 124,62,64, 240 ticks); the breach negatives (head wet, bedrock, no water, 9 cells, a cap,
lava within 4, unloaded); the admission matrix (29:59 vs 30:00, HP 17/18, air 19/20/null, head wet, another bot, off); the
COMPOSED chains on both real cuts (flood guard -> swim-under -> wide swim / breach); the rise in prismarine-physics from
three starting offsets (out, health 20, air never under 10); the rise negatives (failed dig, roof gone, yield); the one
pickaxe rule over [], [0], [1], [1,1], [2], [2,1], unknown durability in all five modules, pinned and ESCDEAD=0; the craft
room on hive-c-Bravo's bag; terrain depth on a Gale-shaped zone and its negatives; wiring (structural, comments stripped);
11 anchored mutants. Existing tests re-anchored (behaviour unchanged): toolfor-spent (2 mutants on hardStopFor),
toolfor-wired (reflex bestTool forwards the pin), poolescape (the reserve mutant).
