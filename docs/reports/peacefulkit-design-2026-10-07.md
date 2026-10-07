# peacefulkit — swords banked and never made, more plants composted, under the peaceful switch (design, 2026-10-07)

Owner approval 2026-10-07: "(3) SWORDS ... never craft a sword; the pickup sweep does not walk to a sword drop ...
swords the bot carries are BANKED into a town chest at the next town deposit or bank visit ... Never toss or drop.
(4) COMPOST MORE ... the plant items that are useless in a peaceful world". One switch with foodskip.

Status: BUILT, REVIEWED (Claude APPROVE, Codex APPROVE), REGISTERED, NOT LAUNCHED. `pk-on-c6e91a8` @ da3e38d (base = the
deployed fleet sha c6e91a8; registration `peacefulkit-01.c6e91a8.json`) and, for a fleet on towndeposit-02,
`pk-on-92bc84f` @ 7ae5e0f (`peacefulkit-01.92bc84f.json`).

## 1. What the fleet holds (measured, not remembered)

Fleet c6e91a8, 80 bots, rotation-aware loader with rows sorted by `t` (scoreboard.py `load_window`), last snapshot
per bot, 12 h to 10-07 17:30Z (288,858 rows, 441 bot-h):

| what | measured | denominator |
|---|---|---|
| swords held | 68 stone + 55 wooden = 123 copies = 123 slots | 73 of 80 bots hold one; ~2,494 used slots fleet-wide (4.9%) |
| swords crafted | 1 craft row (stone_sword, success) in 12 h; 3 sword craft proposals in 70,115 decisions in 24 h | all craft rows / all decisions |
| sword pickups by the sweep | 0 `_pickups` rows naming a sword in 12 h | 288,858 rows (the same query finds other items) |
| swords leaving bags, 24 h | 1 via a deposit (a spare copy), 1 snapshot blip (fell and came back 4 s later) | 765,819 rows, 80 bots; no unexplained net loss |
| deposits | unnamed success 85, named success 64 in 12 h; 76 of the 85 unnamed successes by a sword holder (0.17/bot-h) | 472 deposit runs |
| compost visits | 102 `_compost` rows (0.23/bot-h); 85 by bots holding a non-sapling, non-apple plant | 441 bot-h |
| plant stock (slots) | wildflowers 34, melon_slice 27, brown_mushroom 26, kelp 19, leaf_litter 13, red_mushroom 12, rose_bush 9, cocoa_beans 9, wheat_seeds 8, peony 8, dried_kelp 5, other flowers ~20 | 80 bags |
| saplings | oak 910 items in 80 slots (79 holders, median 8, p90 16, max 74), birch 436 / 62, jungle 16 / 12, spruce 41 / 5 | every holder holds ONE stack per species |

So swords are stock with no inflow and no exit except the bank, and the kit's plants are ~165 slots the composter
refuses today.

## 2. Prior art and external behaviour (searched; cited)

- **The composter table** (Java 1.21.5-1.21.8). NeoForge's generated 1.21.8 data map
  (https://raw.githubusercontent.com/neoforged/NeoForge/1.21.8/src/generated/resources/data/neoforge/data_maps/item/compostables.json,
  115 entries) and a decompiled Mojang-mapped `ComposterBlock.bootStrap`
  (https://github.com/rrrRex1024/minecraft-1-21-11-source/blob/fb136698ca0ae1f6e6e5a1b0c964740fb2f6dd18/net/minecraft/world/level/block/ComposterBlock.java)
  agree: 30% kelp, dried_kelp, all seeds, pitcher_pod, sweet/glow berries, pink_petals, wildflowers, cactus_flower,
  leaf_litter, bush, firefly_bush, dry grass, every sapling; 50% melon_slice; 65% mushrooms, cocoa_beans, apple, every
  small and tall flower including wither_rose and both eyeblossoms; 85% torchflower, pitcher_plant, bread.
  https://minecraft.wiki/w/Composter has the same tiers; https://minecraft.wiki/w/Leaf_Litter dates leaf litter's 30%
  to 25w03a. The 1.21.5 changelog page itself returned 403 (not verified there).
- **Mechanics** (same source): at levels 0-6 `useItemOn` always consumes the item, whether or not the level rises;
  at level 0 any compostable raises it; at level 7 nothing is consumed; 7 -> 8 after 20 ticks; at 8 a use pops one
  bone meal whatever is held.
- **Paper vs vanilla**: Paper 1.21.8's patch
  (https://raw.githubusercontent.com/PaperMC/Paper/ver/1.21.8/paper-server/patches/sources/net/minecraft/world/level/block/ComposterBlock.java.patch)
  adds `EntityCompostItemEvent` (cancellable) and `CompostItemEvent` (hoppers); consumption and odds are unchanged unless
  a plugin intervenes. The fleet and sandbox servers run Paper 1.21.8-60-29c8822 with only bStats and spark. Paper's
  composter issues found (#6561, #6329, #10170) are all about hopper amounts.
- **Peaceful detection**: mineflayer 4.37.1 `lib/plugins/game.js` reads `difficultyNames[packet.difficulty]`, but
  minecraft-data 1.21.8 already decodes the field to a name, so `bot.game.difficulty` is always undefined
  (https://github.com/PrismarineJS/mineflayer/issues/4147, fix pending in https://github.com/PrismarineJS/mineflayer/pull/4163).
  foodskip.mjs already reads the raw packet; this change reuses that. Vanilla sends `difficulty` on join, respawn /
  dimension change, and on every `/difficulty` change (decompiled PlayerList / MinecraftServer; Paper's per-world
  handling not separately checked).
- **Swords in peaceful**: https://minecraft.wiki/w/Difficulty — hostile mobs despawn at once in peaceful (exceptions:
  shulkers, the dragon, piglins, killer bunnies, structure-only mobs); https://minecraft.wiki/w/Sword — a sword on a
  block costs 2 durability. A peaceful bot has no use for one.
- **mineflayer + composters**: no API and no issues; `bot.equip` + `bot.activateBlock` is the use (what composter.mjs
  already does). Prior-art bots: `nuxdie/baritone-ts` CompostTask.ts has a WRONG table (seeds 65%, dried_kelp 85%) —
  not copied; mindcraft disposes by tossing and chests, no composter; Voyager none. Two bots that gate on difficulty
  (`AkagawaTsurunaki/KonekoMinecraftBot` fearAlgorithm.ts, `mineflayer-statemachine`) read the broken field.

**Verified on the real server, not from memory** (sandbox2, Paper 1.21.8-60, RCON only, 10-07 ~18:00Z; script
`sandbox/craft/compost-table.py`): for each item a hopper of 64 above a real composter above an empty hopper; read back
the items left, the bone meal pulled out, and the level. Chance estimate = (7 x bone meal + level) / consumed (64 draws:
+-0.06, biased up by the level-0 rule).

| item | consumed | est. | vanilla | | item | consumed | est. | vanilla |
|---|---|---|---|---|---|---|---|---|
| melon_slice | 64/64 | 0.56 | 0.5 | | sunflower | 64/64 | 0.72 | 0.65 |
| kelp | 64/64 | 0.25 | 0.3 | | lilac | 64/64 | 0.75 | 0.65 |
| brown_mushroom | 64/64 | 0.70 | 0.65 | | rose_bush | 64/64 | 0.75 | 0.65 |
| red_mushroom | 64/64 | 0.69 | 0.65 | | peony | 64/64 | 0.59 | 0.65 |
| cocoa_beans | 64/64 | 0.72 | 0.65 | | wildflowers | 64/64 | 0.34 | 0.3 |
| sweet_berries | 64/64 | 0.31 | 0.3 | | pink_petals | 64/64 | 0.30 | 0.3 |
| torchflower_seeds | 64/64 | 0.30 | 0.3 | | cactus_flower | 64/64 | 0.36 | 0.3 |
| pitcher_pod | 64/64 | 0.28 | 0.3 | | torchflower | 64/64 | 0.86 | 0.85 |
| blue_orchid | 64/64 | 0.64 | 0.65 | | pitcher_plant | 64/64 | 0.81 | 0.85 |
| allium | 64/64 | 0.70 | 0.65 | | closed_eyeblossom | 64/64 | 0.59 | 0.65 |
| azure_bluet | 64/64 | 0.66 | 0.65 | | open_eyeblossom | 64/64 | 0.72 | 0.65 |
| red/orange/white/pink tulip | 64/64 each | 0.84/0.64/0.69/0.78 | 0.65 | | wither_rose | 64/64 | 0.59 | 0.65 |
| oxeye_daisy | 64/64 | 0.80 | 0.65 | | cornflower | 64/64 | 0.72 | 0.65 |
| lily_of_the_valley | 64/64 | 0.64 | 0.65 | | | | | |
| *already composted, unchanged:* wheat/beetroot/melon/pumpkin seeds, dandelion, poppy, leaf_litter, oak/birch/jungle/spruce sapling, apple | 64/64 each | | | | | | | |
| *compostable, NOT approved:* dried_kelp, glow_berries, firefly_bush, bush, moss_carpet, short_dry_grass, bread | 64/64 each | | | | | | | |
| *negative controls:* stone_sword, wooden_sword, egg, flint, bamboo, dead_bush, ink_sac | 0/N each | | | | | | | |

## 3. The change

**One switch** — foodskip's: `FOOD_SKIP=auto|on|off` (default auto = active while the server's `difficulty` packet says
peaceful; unknown = off). foodskip.mjs `attachDifficulty` now also refreshes the policy's in-process decision
(`setPeacefulFood`) from every packet under the env's mode, so code with no bot at hand (the bank's pure allowance, the
prompt's craft list) reads a current decision; `foodSkipNow(bot)` still decides at every sweep, compost and deposit.
Turning the world to easy/normal/hard, or FOOD_SKIP=off, turns every part below off and each function returns the old
answer (tested).

New module `bots/src/peacefulkit.mjs` (pure): `PEACEFUL_COMPOST` (the 30 names above, vanilla chances),
`isPeacefulCompost`, `peacefulRank`, `isSword`, `swordCraftRefusal`, `skipSwordDrop`, `bankEveryCopy`,
`peacefulKitDetail`.

**(3) Swords**
- *Never crafted*: admission refuses `craft <any>_sword` while active (`peaceful_no_sword`, before any walk to a
  table), and the craft skill refuses it at depth 0 (chat and any other caller) with `no_effect`. The remedy is a verb
  the bot can always choose ("craft a pickaxe, axe or shovel, or gather instead"). The prompt's CAN CRAFT NOW line
  stops offering swords (advice never names a craft the gate refuses).
- *Never chased*: `pickupNearbyItems` skips a sword drop while active (the same door as hygiene's NEVER_KEEP and
  foodskip's food). Passive server pickup is unchanged (owner: fine).
- *Banked*: `bankableInventory` gains `swords` (default FALSE). Only a RUNNING deposit passes the switch's reading:
  then a sword keeps NO copy — every usable copy is bankable; the base keeps the best copy of each tool name. Spent
  copies (<= toolfor FLOOR) never move either way. The deposit skill reads the switch once and passes it to the plan
  AND to the slot-precise tool transfer (`keepOne = 0` for a sword), so plan and transfer cannot disagree. **No new
  trip** (round 2, Codex P2): admission's `depositDue`, the deposit milestone and the prompt's CARRYING line keep the
  base count, so a sword never makes a deposit due that was not due (tested through the real gate at the 12-item
  boundary). A deposit whose only eligible copies are the kit's (the sword the base would keep) never starts the
  full-chest recovery or closes the bank: a full chest then ends `no_effect`, as the base would (round 3, Claude P2).
  Never tossed, never dropped: the tool transfer is a shift-click that either moves the copy into the chest
  or leaves it in its slot (verified by re-reading the slot).
- On **92bc84f** (towndeposit, if it is KEPT): `toolSlotsToBank` gains `keepBest` and keeps no sword under the switch,
  so a full bag at town banks its swords in the town deposit. The order's trigger keeps the base count (swords never
  make the order fire on their own); nothing else in towndeposit changes (variant `pk-on-92bc84f`).
- Spent swords (<= 10 uses) never leave under this rule — a sword is never swung for wear-out (hygiene excludes
  swords). The 10-07 census found every sword at ~100% durability; OWNER DECISION whether a spent sword may be banked.

**(4) Compost more**
- `compostAllowance / compostPlan / nextInsert` gain `plants` beside `apples`; the compost skill and the town order pass
  the same decision to both. While active every kit plant is composted WHOLE (no reserve: a peaceful world has no use
  for them); NEVER_COMPOST still wins; saplings above 16 and apples above 4 exactly as before; anything not on a list
  is never offered (the allowlist IS the safety: a composter consumes whatever it accepts).
- Insertion order: the kit's seeds-like items with the seeds, its flowers with the flowers, the rest last.
- The outcome classifier counts lost kit plants as the composter's own effect only while active.
- The `_compost` row carries the complete inserted map in `skill.args.items` and `args.peaceful` (round 2, Codex P1:
  the 300-char detail can cut a long kit list; the read gates on the map, never on cut prose).
- **No no-op orders** (round 2 Claude P3, round 3 Codex P3): while the switch is on the town order counts
  `startableJunk` — a full 36/36 bag gets the order only when `fillDecision` at the town composter's level (read
  lazily, only for a full bag; unknown = 0) would insert its smallest whole stack; otherwise the order would walk to a
  free no_effect and repeat on each 3-min cooldown. Off, the order is unchanged. NOTE, A SECOND EFFECT IN THIS
  VARIABLE: it also applies to the food policy's apples while the switch is on, so compost-visit counts can differ
  between arms for apple-only bags too (recorded in the registration).
- **An interrupted visit still writes its row** (rounds 3-4, Codex P2): on an abort the `_compost` row (status
  `aborted`, written before the hand is restored) carries the VERIFIED map and the NAME of an insert in flight
  (`args.inflight`, `args.incomplete`) -- never a count reconciled from the bag after the stop, where a death, a
  disconnect or a late inventory update would read as composted. The read counts the in-flight name as maybe composted
  for K5/K6 and does not judge a reserve on such a row.
- **One use consumes one item** (round 4, Codex P2; vanilla `consume(1)`): a larger fall in the bag during one insert
  (a death, a toss, a resync) is never credited to the composter and stops the visit. This guard also applies with the
  switch off (an anomaly path; normal visits are unchanged).
- **Sapling reserve: unchanged at 16 per species (recommended).** Evidence: every holder holds exactly one stack per
  species (oak median 8, p90 16), so ANY reserve above 0 frees zero slots; 16 is twice planting's PLANT_RESERVE (8)
  and above the tree farm's 3x3 grid (9 of one species, FARM_SPECIES birch then oak, treefarm.mjs on bp-on-1918bb5).
  Saplings above 16 were already composted before this change (composter-01). OWNER DECISION if a smaller reserve is
  wanted — it would free nothing measurable.

**Not in this variable (listed):** dried_kelp, glow_berries, bush, firefly_bush, moss_carpet, dry grass and bread
(compostable on Paper, not approved; dried_kelp 5 slots, firefly_bush 4, moss_carpet 2 fleet-wide); `withdraw <sword>`
is not refused (0 seen); a pickup sweep that would NOT pick up plants (the owner asked for composting, not that).

## 4. Composition (refusal chains, CLAUDE.md)

- The craft refusal composes with the milestone ladder: no rung wants a sword (milestones.mjs never names one), so
  no rung can be left with only a refused move.
- Banking composes with the tool rules: a sword is never a digging tool here (toolfor handFiller excludes swords), so
  banking the last one cannot disarm a bot; pickaxes/axes/shovels keep the best copy as before (tested side by side).
- The composer composes with the trigger: kit plants count as junk for the >= 34-slot compost order, so a bag whose
  only compostables are kit plants now gets the order (tested through the real cognitive loop); a full 36/36 bag still
  only starts a fill that empties a slot for the bone meal.
- towndeposit (92bc84f): the kit's plants and apples are never towndeposit targets (not bankable); swords become
  bankable there under the switch. The town deposit runs before the compost order.

## 5. Tests and mutants

- `bots/test/peacefulkit.test.mjs`: the Paper list, every sword tier, off = old allowance/plan, on = whole plants +
  reserves, insertion order, insert-by-insert to the end, a full bag, startableJunk, the bank allowance on/off/spent,
  NO NEW TRIP (the default count, and through the real admission gate at the 12-item boundary), the REAL deposit skill
  (peaceful banks both swords and keeps the best pickaxe; easy and unknown keep both; a named deposit), admission, the
  refusal CHAIN (sword refused -> the named remedies `craft stone_pickaxe` and `gather` admitted), the craft skill, the
  sweep, the difficulty packet (auto/off/on), the `_peaceful_kit` row, the classifier, the prompt, and FOOD_SKIP=off in
  its own process.
- `bots/test/composter.test.mjs` +3: the REAL compost skill through the fake vanilla composter (peaceful: every kit
  plant gone, 16 saplings, 4 apples, bread/dried_kelp/sword untouched, args.items complete; hard and unknown: no kit
  plant touched).
- `bots/test/peacefulkit-order.test.mjs` (3): the town order through the real cognitive loop, including the full bag
  that must NOT get an order.
- `bots/test/towndeposit.test.mjs` +3 (pk-on-92bc84f only): the pure plan and the REAL town_deposit skill.
- `scripts/mutants/mutants-pk.py`: JS mutants (each anchor asserted present and unique, the baseline proven green first,
  the source restored and re-read after each) and, since round 2, mutants of the READ's predicates killed by its
  `--selftest` fixtures (`--read-only` runs those alone). FINAL (da3e38d): 39/39 JS mutants and 20/20 read mutants
  killed. npm test 237/237 (pk-on-c6e91a8), 238/238 (pk-on-92bc84f). eslint no-undef: only the pre-existing
  `withinBody` (reflex.mjs, fixed on main by a lint comment). The read's main loop is checked by the dry run and review,
  not by mutants: it calls the selftested predicates by name. Equivalent mutant, recorded: the deposit transfer's `keepOne` for non-sword tools is redundant
  with the plan (the plan's count is at most usable - 1), so forcing it to 0 changes nothing observable.

## 6. The read (scripts/host/peacefulkitread.py) and registration (docs/reports/peacefulkit-01.c6e91a8.json)

Every gate is a named predicate and its instrument runs the SAME predicate on the control arm (round 2, Codex P2);
`--selftest` proves each predicate on fixtures at every run. Liveness `_peaceful_kit active=1`. REVERT gates:
THE CLOCK (round 3, both reviews P1): a SKILL row is stamped at its start while its snapshot is the bag at its end
(logger.mjs logSkill), so the read sorts every row by when its snapshot was taken (`row_times`: start + duration_ms for
skill rows, the stamp for `_kind` rows) and credits a bank row's sword fall anywhere in its run [start - 5 s, end + 1 s];
a death since the last non-empty snapshot explains a fall whenever the respawn bag shows up. K4 judges a reserve only
on a `_compost` row whose END bag is the visit's own (`reserve_judged`: a complete map, not aborted, a non-empty bag, no
death in the 120 s before). CALIBRATION (Claude r3): the read prints control pickaxe losses within 60 s after a
same-name bank row -- 0 in the round-4 dry run (ledger: banked 13, blip 9, death 2, acquired 86, lost 68 = wear-outs and
breaks), so the bank-credit window is wide enough. The selftest replays
logger-shaped rows (a deposit stamped at its start with a reflex row inside it still holding the sword; a death whose
respawn bag shows 400 s later). With the clock fixed the control's pickaxe "blips" fell from 124 to 11 in the dry run.
K0 mode; K1 `crafted(row, SWORD)` — the requested sword, success, gained (a passive sword during another craft is not a
craft; Codex P2); K2 the sword LEDGER — every fall pending until a bank row whose run interval contains it, a death
(-5..+180 s) or a same-name blip (<= 120 s) explains it; later rises are acquisitions and never cancel a loss; empty
bags are unknown; falls in the last 300 s are unresolved (Codex P1); breach when the canary's lost rate exceeds the
control's (control 0 in 24 h) or a sword was composted; K3 `took_last(SWORD)` while off / by the control; K4
`reserve_breaches` vs the control rate; K5 `composted_in(KIT)` while off / by the control; K6 `off_list`. Compost
items come from `args.items` (complete); a legacy cut detail drops its last pair and is counted as incomplete.
DRY RUN (3 h, board-c + hive-a as the canary, 10 vs 70 bots, 10-07 15:05Z): every gate 0; instruments: tool crafts 72,
pickaxe falls explained by a bank row 18 (control pickaxe ledger: banked 18, blip 124, acquired 87, lost 64 = wear-outs
and breaks), bank rows that emptied a name 43, reserve checks evaluated 21, base/sapling/apple composts 28, rows off
the BASE list 16; control sword ledger lost 0; 10 canary bots held a sword at the cut (X1's ceiling).
EXPOSURE: liveness AND X1 >= 3 canary BOTS whose bank row took a sword while active AND X2 >= 3 canary BOTS that
composted a kit plant. Swords are stock, so each bot banks once (Claude P2): X1 counts bots and prints its ceiling.
MEASURED POWER (distinct bots, random draws of whole pools, JOINT X1 and X2): 6 h: 0.35-0.94 with 2 pools, 0.73-1.00
with 3; 12 h: 0.87 (2 pools), 0.99 (3); 24 h: 0.99 (2), 1.00 (3). So: reads at +180/+360, extension reads until
exposure at +540/+720/+1080/+1440, deadline +1680 -> INCONCLUSIVE (recorded, torn down). Draw at least 2 pools.
The sweep-chase half is a reported tripwire, never a gate: sword drops are ~0 on the fleet (foodskip's F2 lesson).
Primaries REPORTED: sword slots/bot DiD, kit-plant and plant+food slots/bot DiD, all slots/bot DiD, share >= 34 DiD.

## 7. Paper sandbox (sandbox3, RCON only; sandbox/craft/peacefulkit-ab.cjs; one fresh real bot per trial)

| scene | candidate b1bfe16 (2 reps each) | control c6e91a8 (1 rep) |
|---|---|---|
| craft (`craft wooden_sword`, peaceful) | 2/2 refused `peaceful_no_sword` before any walk; no sword, planks 8 -> 8 | crafted 1 wooden_sword |
| craft_easy (`difficulty easy`) | 2/2 crafted (row `difficulty=easy active=0`) | — |
| bank (unnamed `deposit`, peaceful) | 2/2 both swords in the chest, none in the bag; the 30-used pickaxe kept, the 100-used one banked | swords stay in the bag |
| bank_off (FOOD_SKIP=off) / bank_easy | 2/2 + 2/2 swords stay in the bag | — |
| compost (town order, 35/36) | 2/2 all 69 kit items (14 kinds) consumed; apples 10 -> 4; oak saplings 20 -> 16; bread 5, dried_kelp 4, sword 1 untouched; bone meal 5-6 | kit 69 -> 69; apples 10 -> 4; saplings -> 16 |
| compost_off / compost_easy | 2/2 + 2/2 kit 69 -> 69, apples 10 (the food policy off too), saplings -> 16 | — |
| drop (`gather 1 oak_log`; a sword ~5 away, cobblestone ~6) | sword left on the ground 3/3 (pilot + 2); cobblestone collected | the sweep walked to the sword (`stone_sword 1 ... sought`) |

Every trial: the `_peaceful_kit` row named the right mode and difficulty; nothing on the ground that was not there
before (except the drop scene's sword, by design); `difficulty` restored to peaceful after each non-peaceful trial.
Harness note: in two candidate drop trials the scene's log block was already broken before the gather ran
("no oak_log within 32 blocks"); the sword half of the scene is unaffected.
Round-2 re-run (87518ef, sandbox3): compost 2/2 the same (69 kit items consumed, apples 10 -> 4, saplings 20 -> 16),
and the real Paper `_compost` row's `args.items` listed all 16 inserted names while the 300-char detail was cut; drop
2/2 clean (the log AND the cobblestone collected, the sword left on the ground; control 1/1 walked to the sword);
bank 2/2 and craft 2/2 as above. The later rounds (85f3013..da3e38d) changed only the deposit's full-chest edge, the
interrupted-visit row, the order guard and tests -- covered by the suite; not re-run on Paper.
FINAL DRY RUN (the staged read, md5 22a14034, 6 h, board-a + placebo-b as the canary, 10 vs 70 bots): every gate 0;
instruments tool crafts 126, pickaxe falls explained by a bank row 41, bank rows that emptied a name 91, reserve checks
45, base composts 48, off-BASE rows 32; CALIBRATION 0; control sword ledger lost 0.

## 8. Reviews

Round 1 (b1bfe16): **Codex CHANGE** — (P1) the read's K2 sword accounting could false-trip on an intermediate snapshot
and let a later acquisition cancel a loss; (P2) swords in the default allowance could make a deposit due (a new trip);
(P1) gates on a 300-char-cut detail; (P2) K1 counted any sword gained during any craft; (P2) instruments did not run
the gates' predicates; (P2) exposure not shown powered, no extension plan. **Claude APPROVE** with P2/P3: X1 power
overstated (swords are stock: count bots, print the ceiling, 2+ pools, a capped extension); K2's control check must
test the bank credit; the death exemption timing; no-op compost orders on a full bag; the deposit trigger moved; spent
swords never leave (owner); cut details blind K4/K6; `compostish` at harvest (not changed: at level 8 vanilla extracts
whatever is held, so it is harmless); missing mutants (RANK, the deposit plan's switch) and test-state hygiene; a
refusal-chain test. All addressed in 87518ef (code) and the read above, except `compostish` (reasoned) and spent swords
(owner decision).

Round 2 (87518ef): **Claude CHANGE** — (P1) the read timed skill rows by their end although they are stamped at their
start, so a correct deposit could read as a lost sword; (P2) a death whose respawn bag shows > 180 s later read as a
loss; (P2) the deposit skill's early recovery checks and its ending path disagreed: a full chest with only the kit's
sword could start the recovery (a new chest, a bank closure); (P3) K6 instrument comment; (P3) startableJunk also
changes apples. **Codex CHANGE** — (P1) the same clock defect, reproduced; (P2) an interrupted compost visit wrote no
`_compost` row, so K4-K6 never saw it; (P3) startableJunk ignored the composter's level. All addressed in 85f3013 and
the read (section 6).

Round 3 (85f3013): **Claude APPROVE** (P3: show the calibration; the level lookup ran out of town; kitOnly under a
withdraw hold; the aborted row could be lost if the hand restore threw; stale registration notes). **Codex CHANGE** —
(P2) a death during a compost visit was reconciled as composting the whole stack and could trip K4; (P2) a late
inventory update after an abort was missed while the read treated the row as complete. All addressed in 28f8312 and
the read (verified map + in-flight name, one use one item, `reserve_judged`, the calibration line).


Round 4 (28f8312): **Claude APPROVE** (P3: print the calibration; flag the "bag changed" stop incomplete; X2 counted an
unverified in-flight insert; list the new `_compost` statuses). **Codex CHANGE** — (P2) X2 counted unverified in-flight
inserts (a false-KEEP path). Fixed in d65f686 + the read (`verified_items` for X2 and totals; K5/K6 still see the
in-flight name). Round 5 (d65f686): **Codex APPROVE**. A surviving mutant (startableJunk's "nothing can start") was
killed by a test in da3e38d.

The towndeposit variant (pk-on-92bc84f @ 7ae5e0f): **Codex APPROVE** (rebase confirmation: the one-count sword fits the
whole-stack two-click transfer, read-back, holds and keeps; the trigger counts the base rule; the ledger credits
`town_deposit` rows; off-mode deposit behaviour equals 92bc84f).

## 9. Owner decisions

1. **Sapling reserve** — recommended: keep 16 per species (unchanged since composter-01). Every holder holds exactly ONE
   stack per species (oak median 8, p90 16, max 74), so any reserve above 0 frees zero slots; 16 is twice planting's
   PLANT_RESERVE (8) and above the tree farm's 9 per build. Only a reserve of 0 would free slots, and it would switch
   planting and the tree farm off.
2. **Spent swords** (<= 10 uses) — never banked or worn out, so they would keep a slot. The census found every sword at
   ~100%; bank them too, or leave them?
3. **Compostable but not approved** — dried_kelp (5 slots fleet-wide), firefly_bush (4), moss_carpet (2), glow_berries,
   bush, dry grass, bread: all consumed by the Paper composter. Add any?
4. **A second effect in this variable** — startableJunk also stops no-op compost orders for the food policy's
   apple-only full bags while the switch is on. Accept it inside peacefulkit-01, or split it out?
5. **Draw size** — exposure is powered with 2+ pools (joint 0.87 at 12 h, 0.99 at 24 h); a 1-pool draw is underpowered.
