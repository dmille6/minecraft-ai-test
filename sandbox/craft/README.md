# sandbox/craft — craft A/B harness (sandbox Paper only)

Drives the **real bot** (an unmodified worktree at the revision under test) through `craft` decisions on a
sandbox Paper server, sets each scene with RCON, and reads the **server's** slots and the item entities on the
ground before and after. The bot's own claim is recorded but never trusted as the outcome.

Sandbox only: every driver refuses a non-`sandbox-*` bot name, and `run-bot.sh` refuses anything but
`10.0.0.30:25599..25602`. RCON goes through `sbx-rcon.py` on the worlds host, which asserts a sandbox name and reads
the RCON password from that server's own `server.properties` (nothing secret lives here). Never point any of this at
a fleet world.

## Files

| file | what it is |
|---|---|
| `craftroom-ab.cjs` | **the scene A/B driver** (craftroom vs craftsync, 2026-10-03). One fresh bot per session, scenes below, server oracle per slot. |
| `abba.sh` | runs `craftroom-ab.cjs` cand, ctrl, ctrl, cand, cand, ctrl: three rounds per arm, each a fresh bot. |
| `summarize.py` | per-trial lines + per-scene outcome table (CRAFTED / TOSSED / REFUSED / LIED) from the results files. |
| `trace.cjs` | `node --require` preload that **only observes** packets (clicks, item spawns, pickups, slot updates) with timestamps. |
| `qbrain.mjs` | loopback "model": answers each decision with the next line of a queue file (`craft [n] <item>`, `goto x y z`), else `status`. |
| `sbx-rcon.py` | the RCON helper the drivers call over ssh as `/tmp/sbx-rcon.py <sandbox..sandbox4> -` (copy it there if missing). |
| `drive.cjs` | craftsync skill A/B (2026-10-03 night): real bot, no shims, table/2x2/recursive cells. |
| `realdrive.cjs` + `preload.cjs` | the same through `preload.cjs`, which can SHIM clicks (`CRAFTSYNC_ARM=A/B/AB`): an experiment harness, not a neutral observer. |
| `craftsync.cjs` | bare-mineflayer craft probe (no bot code): table/2x2 cells, arms none/A/B/AB via in-process shims. |

## Running the scene A/B

Prerequisites: ssh to `mike@10.0.0.30` (keys), `/tmp/sbx-rcon.py` there, the target sandbox empty (the drivers wait
for `list` to say 0 players), and one worktree per arm with `bots/node_modules` (a symlink to another worktree's
node_modules is fine when `package.json` is identical).

```bash
git worktree add --detach ../crab-cand <candidate-sha>
git worktree add --detach ../crab-ctrl <control-sha>
ln -s <a worktree>/bots/node_modules ../crab-cand/bots/node_modules   # same for ctrl

# one session (one fresh bot) of every scene:
node sandbox/craft/craftroom-ab.cjs cand ../crab-cand 1 full35,full36,full36-chain,race-early,race-late,race-stream,logs,wear,wear-open,nothing
# or the ABBA run of both arms (3 rounds each, ~25 min):
sandbox/craft/abba.sh ../crab-cand ../crab-ctrl
python3 sandbox/craft/summarize.py sandbox/log/craftroom-ab/results-cand.jsonl sandbox/log/craftroom-ab/results-ctrl.jsonl
python3 sandbox/craft/summarize.py --rows sandbox/log/craftroom-ab/results-cand.jsonl race-late   # every bot row
```

`CRAFT_REPO` overrides the checkout that holds `sandbox/run-bot.sh` and `sandbox/sandbox-bot-scripted.env`
(default: two levels above this directory). Outputs (bot stdout, skill log, brain log, queue, packet trace, results)
go to `sandbox/log/craftroom-ab/` (the older drivers: `sandbox/log/craft/`), both gitignored. One bot process per
driver; run one driver at a time per machine (the brain listens on 127.0.0.1:11499).

## Scenes (`craftroom-ab.cjs`)

The bot stands at 700.5 120 700.5 on a stone floor (y 119), air above; a crafting table, when the scene has one, at
702 120 700. Fillers are stacks of 64.

| scene | bag | command | what it asks |
|---|---|---|---|
| `full35` | cobblestone 8, stick 5, 33 rock stacks = 35/36 | `craft stone_pickaxe` | fits one: both arms should craft |
| `full36` | + a spent stone_pickaxe (the only pickaxe) + one dirt = 36/36 | same | no room: toss, refuse, or wear something? never the last pickaxe |
| `full36-chain` | as full36 | `craft`, then `place dirt`, then `craft 1` | the refusal CHAIN: is the remedy the refusal named executable, and does the craft then land? |
| `race-early` | as full35 | same | a feather summoned 1 block away as the decision is served, PickupDelay 20 ticks |
| `race-late` | as full35 | same | a feather summoned ~1.3 s after the decision, PickupDelay 0 (lands after the clicks start) |
| `race-stream` | as full35 | same | five feathers as the decision is served, PickupDelay 10/30/50/70/90 ticks |
| `logs` | oak_log 3 + 12 rock stacks, no table anywhere | `craft wooden_pickaxe` | whole tree from logs: exact counts, table placed and taken back |
| `wear` | cobblestone 8, stick 5, good stone_pickaxe, spent stone_axe (1 use), 32 rocks = 36/36; side stones at foot height | `craft stone_pickaxe` | the craft's own remedy wears the axe out, never the pickaxe |
| `wear-open` | as wear, no side stones | same | the same with nothing at the sides to wear the axe on |
| `nothing` | cobblestone 8, stick 5, good stone_pickaxe, 33 stacks of bone/string/feather/gunpowder = 36/36 | same | the refusal names only a remedy that can run |

`wear`/`wear-open` first run a **primer** (a 35-slot bag with a spent wooden_hoe) so the decision loop's own hygiene
`wear_out` fires and its 2-minute cooldown is charged; otherwise that reflex, not the craft, would wear the axe out.

Harness settings that are not the code under test, identical for every arm: `FAILED_COOLDOWN_MS=1000` (the admission
gate's 45 s cooldown would otherwise reject the next scene's identical craft, since a refusal is a failure),
`MAX_CONSECUTIVE_FAILURES=50`, a fresh `STATE_DIR` and `MEMORY_POOL` per session, and the arg form alternating
between `craft X` and `craft 1 X` so no two consecutive decisions are identical. A rejected decision re-sets the
whole scene before the retry, so drops never accumulate.

## Reading a result

Each results line has `before`/`after` (server slots `{slot: {id, count, damage}}`, totals, ground items, position),
`tables` (crafting tables left standing in the arena), every bot row the trial wrote (`craft`, `_craft_room`,
`_craft_sync`, `_table_retaken`, `wear_out`, `_pickups`, ...), decision rejections, and the packet trace relative to
the moment the decision was served (`firstReal`/`lastReal` = the craft's own clicks; slot `-999` clicks are
craftsync's resyncs or a toss, and the ground oracle tells which). A trial's outcome is the server's, not the row's:
a pickaxe on the ground after the trial is TOSSED whatever the craft row says.

## Composter A/B (`composter-ab.cjs`, `coab.sh`, `summarize-composter.py`)

`compost` and `build_composter` are deterministic town orders (composter.mjs `townOrder`), never the model's choice,
so this driver queues nothing: it sets a scene and WATCHES for the order for a fixed window (100 s), then reads the
server. **One fresh bot per trial**: the orders' cooldowns and backoffs (build 5 / 30 min, compost 3 / 15 min) live in
the bot's memory, and the shared site record lives in the pool state dir (`sandbox/state/_pool-<MEMORY_POOL>`), both
fresh per trial.

What "town" needs in the sandbox (cognitive.mjs): the bot within 48 of `HOME_X/HOME_Z` (the driver puts home at the
stand, 700 120 700), a **chest within 16 of the bot** (690 120 690), and for compost a composter within 16 of home.
**The arena is built only after the bot has been teleported there**: `setblock`/`fill` into an unloaded chunk fails
("not loaded"), and the first pilot built its chest into nothing, so no order could ever fire. The driver now refuses
to run a trial whose arena did not build.

For this arena the canonical site is 697 120 699, its standing cell 698 120 699, the builder's table cell 699 120 699
(computed with composter.mjs and confirmed by every build).

| scene | bag | expects |
|---|---|---|
| `build30` / `build34` | oak_log 3 + rocks to 30 / 34 slots | one composter at the site; oak_log -3, oak_planks +2, oak_slab +5; table at 699 120 699 |
| `build35` / `build36` | the same at 35 / 36 | no order (the chain from logs needs 2 free slots) |
| `build34-fillmid` | as build34; `give` 2 stacks of tuff the moment the order starts | the refusal path the scheduler never reaches |
| `compost36` | leaf_litter 64/64/30, wheat_seeds 64/6, beetroot_seeds 5, oak_sapling 64/20, birch_sapling 10, apple 12, bread 8, cooked_beef 4, poppy 3 + rocks = 36/36; a level-0 composter at the site | slots freed, saplings above 16/species only, food kept, bone meal in the bag, nothing on the ground |
| `compost36-stuck20` | as compost36 with `STUCK_SECONDS=20` (the fleet's value; the sandbox env file says 35) | the same, under the fleet's stuck watchdog |
| `stand-blocked` | as build30; an oak boat on the standing cell under a stone at y+2 | composter_unreachable before any table goes down |
| `stand-offcentre` | as build30; the bot is teleported onto the standing cell 0.45 off centre as the order starts | centred (STAND_CENTRE_TOL 0.3) before the table goes down |
| `build34-fillclick` | as build34-fillmid, the give delayed 300 ms so it lands during the first planks clicks | a put-away toss at a full bag is filed composter_no_room |
| `compost-then-wedge` | a long visit (3 stacks of leaf_litter, 2 of seeds) with STUCK_SECONDS=20, then `smelt 8 raw_iron` queued as it ends | no stuck interruption inside the visit's declared window; the watchdog fires on the stationary smelt after it |

The driver answers the bot's model calls itself (the queue brain is embedded), so a trial runs two node processes:
the driver and the bot. `trace.cjs` also records every `block_place` with the bot's feet at that moment (was the
bot centred when the table went down?) and each change of `bot.stationaryUntil` (the compost visit's declared window).
An oak boat is NOT a reliable occupant of the standing cell: the bot pushes it (and is pushed by it), so `stand-blocked`
exercises off-centre and moving bodies more than an occupied stand.

```bash
sandbox/craft/coab.sh ../coab-cand ../coab-ctrl 3        # ~70 min: cand 7 scenes, ctrl 5 scenes, 3 reps, alternating order
python3 sandbox/craft/summarize-composter.py sandbox/log/composter-ab/results-cand.jsonl sandbox/log/composter-ab/results-ctrl.jsonl
python3 sandbox/craft/summarize-composter.py --rows sandbox/log/composter-ab/results-cand.jsonl compost36
```

## Spent-tool A/B (`tools-ab.cjs`, `tcab.sh`)

One fresh bot per trial, ONE queued decision (`gather N block` or `goto x y z`; the brain is embedded, so a trial is
two node processes), the server's slots read with their `damage` before and after, item entities on the ground, and
from `trace.cjs` every dig start/finish with the item held at that moment (name, durability used, slot). The arena
floor is SMOOTH_STONE (no gather targets it), the blocks to dig are a row at y 120 from x 703 east.

| scene | bag | command |
|---|---|---|
| `axe5` | the sole stone_axe at 5 uses | gather 6 oak_log (row of 6) |
| `shovel4` | the sole wooden_shovel at 4 uses | gather 5 dirt (row of 5) |
| `axes90-3` | stone_axes at 90 and 3 uses | gather 6 oak_log |
| `picks1x3-50` | three 1-use stone_pickaxes + one at 50 uses | gather 5 stone |
| `pick1-only` | only a 1-use stone_pickaxe | gather 5 stone |
| `travel-shovel1` / `-filler` | a 1-use wooden_shovel (held), with/without a cobblestone stack | goto 711 120 700 from a dirt pit with a roof |

Two world traps found on the first run, both handled by the driver now: **stone outside the arena** (the floating
platform's own stone at the edge: gather took it and the bot fell 51 blocks into the void -- stone scenes replace every
stone block within ~24 of the stand with smooth_stone first), and **an open pit top** (the dig-capable profile towered
out with the cobblestone instead of digging -- the pit has a dirt roof at y 122).

```bash
sandbox/craft/tcab.sh ../tc-cand ../tc-ctrl 3
```

## Bamboo -> sticks A/B (`bamboo-ab.cjs`, `bbab.sh`)

Derived from `tools-ab.cjs` (one fresh bot per trial, embedded brain, server slots before/after), but nothing is
queued: `bamboo_sticks` is a deterministic housekeeping order, so the driver WATCHES for it for 150 s. Two extra
reads per trial: the bag again 6 s after the order ended, and the item entities on the ground AFTER the bot logs out
(what the server returned or dropped from the 2x2 grid and the cursor -- an interrupted craft leaves items there that
are in neither the bag slots nor on the ground while the bot is online).

| scene | bag (rock stacks of 64 fill the rest) |
|---|---|
| `A` | 36/36: bamboo 64, sticks 32, oak_planks 10 |
| `B` | 36/36: bamboo 64 + 10 (split), sticks 32, oak_planks 10 |
| `C` | 36/36: bamboo 64, oak_planks 10, no sticks |
| `D` | 35/36: bamboo 64 + 64, oak_planks 10, no sticks |
| `E` | 36/36: bamboo 2, sticks 63, oak_planks 10 |
| `F` | scene A, and a feather (PickupDelay 600 ticks) summoned beside the bot as the order starts |
| `G` | scene A's contents at 33/36 (below the 34-slot trigger) |
| `A20` | scene A with the fleet's STUCK_SECONDS=20 |
| `B20`..`G20` | scenes B..G with the fleet's STUCK_SECONDS=20 (round 2, 10-05: the declared stationary window) |
| `D20` | the 64-craft fold (128 bamboo -> 64 sticks frees 1 slot; window 88.2 s, inside the 90 s cap) |
| `K20` | scene A20 ABORTED mid-fold: `damage` 14 (health 20 -> 6, FLEE_BELOW_HEALTH 8) 10 s after the order starts, so the low_health reflex interrupts the skill; the ground after logout shows what the 2x2 grid/cursor held |

```bash
sandbox/craft/bbab.sh ../bb-cand ../bb-ctrl 3          # ~100 min: the control waits the full window in every scene
```

## Withdraw A/B (`withdraw-ab.cjs`)

`withdraw_pick` is a deterministic town order (composter.mjs `townOrder`): the driver sets the scene and WATCHES for it
(100 s); the control build has no such order, so after a 60 s window it queues the model's old verb (`cmd`) instead.
One fresh bot per trial; the server's bag slots (with damage), the chest's 27 slots and the ground are read before,
right after the order, after any follow-up, and after logout. The bot stands at home (700.5 120 700.5); ONE single chest
at 702 120 700 goes down LAST, filled in the same RCON batch (an order that scans an empty chest records a 15-min town
miss and never comes back).

| scene | bag | chest | asks |
|---|---|---|---|
| `pick` | 20 andesite stacks | ingredients + stone_pickaxe (111 uses) | the pickaxe, nothing else moved |
| `ingred` | as pick | cobblestone 64, stick 16, oak_planks 16 | exactly 3 + 2 + 4 |
| `swap` | 20 stone + 16 andesite = 36/36 | 26 diorite + the pickaxe = 27/27 | the 3-click trade, totals conserved |
| `spent` | as pick | stone_pickaxe 6 uses, wooden 7 uses + ingredients | a spent copy never taken |
| `holdwin` | as pick + coal 64 | ingredients | then `deposit`: what was withdrawn stays (control: `withdraw 2 stick`, deposit) |
| `kick` / `kicklong` | as swap | as swap | RCON kick right after the first chest click; `kicklong` watches 75 s after the reconnect |
| `holdroom` / `holdfull` | as swap + 3 feathers at the feet | as swap | the feather is picked up into the slot click 1 empties, so the pickaxe has nowhere to go: a HELD cursor; after 70 s one slot is freed (`holdroom`) or `damage 2` forces the survival release (`holdfull`) |

```bash
node sandbox/craft/withdraw-ab.cjs cand ../wd-cand 1 pick,ingred,swap,spent,holdwin,kick,holdroom,holdfull
node sandbox/craft/withdraw-ab.cjs ctrl ../wd-ctrl 1 pick,ingred,swap,spent,holdwin,kick,holdroom,holdfull
```

Found on Paper 1.21.8 (10-05): a disconnect while a stack is on the cursor DROPS it whatever the room
(`AbstractContainerMenu.removed` drops the carried stack once the player has disconnected) -- the kick dropped 64 stone
in 2/2 trials although the slot it came from was empty.

## Chest-full A/B (`chest-ab.cjs`)

`deposit` is the model's verb, so the driver QUEUES it (embedded brain) once the scene is set, then reads the server.
One fresh bot per trial, a fresh `STATE_DIR`/`MEMORY_POOL` (so a fresh town container memory and claim ledger). Home is
the stand (700 120 700); town chests A 703 120 700 and B 697 120 705 (not adjacent: no double chest). "Full" = 27 x 64
diorite (never bankable); the bag's bankables are coal 64 x2 + raw_iron 32. Every scene has a town composter
(693 120 694, or the scene's own): without one, `build_composter` runs first and turns the bag's planks into slabs.
The oracle reads every bag slot, every slot of every chest in the scene, and every chest/trapped_chest block within five
rings of the scene's chests and four of the bot (a new chest is found in the WORLD, never from the row), the floor under
each new chest (dirt_path?), and the item entities on the ground before logout and after it.

| scene | bag | world | asks |
|---|---|---|---|
| `carried` | bankables + 1 chest, no wood | A, B full | place the CARRIED chest next to the bank, deposit, nothing dropped |
| `craft` | bankables + 16 oak_planks | A, B full | craft one chest within the budget, place it, deposit |
| `budget` | bankables + 1 chest | A, B full; the claim ledger pre-seeded with 4 claims in 24 h | refuse_cap with a remedy; then the CHAIN: `deposit`, `deposit coal` (admission must refuse, no walk), `goto`, 20 s idle |
| `roomy` | bankables + 1 chest | A with room, B full | the ordinary deposit, nothing built |
| `site` | bankables + 1 chest | A full and the only chest; dirt_path floor 5x5 around A, composter 3 east of A, crafting table 4 south of A | never on a path, >= 3 from the composter, off the table's standing cells, within 16 of home |
| `far` | bankables + 1 chest + 16 oak_planks | A, B full; the bot at 740 120 700 beside a FULL far chest F (42 from home) | never a chest off-site |

```bash
node sandbox/craft/chest-ab.cjs cand ../chest-cand 1 carried,craft,budget,roomy,site,far
node sandbox/craft/chest-ab.cjs ctrl ../chest-ctrl 1 carried,craft,budget,roomy,site,far
```

## Grid-clear A/B (`grid-ab.cjs`)

The craftsync grid fix (gf-on-1918bb5 @ 8c9239d): does an ABORTED 2x2 craft leave the grid (window-0 slots 1-4) or the
cursor loaded? `craft` is the model's verb, so the driver QUEUES `craft 64 stick` (16 executions of the 2x2 recipe, one
bot.craft each) and fires the abort at a measured moment: the first craft click seen in `trace.cjs`, plus an offset.
One fresh bot per trial (`sandbox-Grid`). **The grid and the cursor are not in the Inventory NBT**, so the oracle is
(1) conservation in planks units (planks + sticks/2) before vs 6 s after the craft row: a deficit is what the grid or
cursor holds, and (2) the item entities after LOGOUT: Paper drops a disconnected player's grid + cursor, so the ground
after logout is exactly what was stranded. The sandbox runs PEACEFUL, where food never drops: `pre` sets
`difficulty easy` for its trial and restores peaceful after it.

| scene | bag | abort |
|---|---|---|
| `int` / `int3` | planks 64 + rocks = 20/36 | `damage 14` (low_health interrupt) 1.5 s / 0.3 s after the first click |
| `stuck` | as int, `STUCK_SECONDS=5` | the stuck watchdog (lands mid-click: 2-3 clicks into an execution) |
| `kick` / `kick3` / `kickst` | as int / int3 / stuck | then RCON `kick` as the craft row lands; the ground 2 s later, the bag after the reconnect |
| `pre` | as int + bread 16, no saturation | `hunger` (easy) -> the hunger reflex's `equip(bread)` PREEMPTS the craft (preempted=true) |
| `full` / `full3` / `fullst` | planks 64 + stick 4 + rocks = 36/36 | as int / int3 / stuck |
| `fullp` / `fullpst` | as full + 3 feathers (PickupDelay 0) at the first click | as int / stuck |
| `ok` | planks 64 + stick 16, a table at 702 120 700 | none: 5 2x2 and 5 table crafts in one session |

```bash
node sandbox/craft/grid-ab.cjs cand ../gf-cand 1 int,stuck,kick,pre,full,fullp,ok
node sandbox/craft/grid-ab.cjs ctrl ../gf-ctrl 1 int,stuck,kick,pre,full,fullp,ok
```

Found 10-05: a +1.5 s abort lands AFTER an execution's six clicks (both arms clean: not a strand test); +0.3 s lands in
the verification resync (candidate: `unverified_skipped`, bag conserved); only the stuck watchdog and the preempting
reflex land mid-click. Fleet aborted 2x2 rows (30 h): 38 of 44 mid-click, 2 in the verification resync.
