# Junk DISPOSAL for the fleet: design only, not built (2026-10-04)

Claude design, with an independent Codex design run in parallel (`codex exec -s read-only`, full text in
`codex-final.md` next to this file). Code facts are from the **live fleet sha 56db2cd** (`co-on-ffa0f57`). `origin/main`
does not carry composter.mjs or pickupbox.mjs, so I checked the fleet sha. Withdraw facts are from `origin/wd-on-6c9a8fb` @ 98b95c8.
Nothing was built, committed or run on a server. The only server contact was a read-only `grep` of spigot.yml and
paper-world-defaults.yml on 10.0.0.30.

---

## 0. The answer in five lines

1. **Build a "junk well" at each town.** It is a 1x1 shaft whose floor sits 2 blocks below the walking surface, capped flush by a
   wooden trapdoor placed in its top half. A bot opens the trapdoor, tosses whole allowlisted stacks in, and closes it. The items lie
   2 blocks below every standing player. The pickup box reaches only 0.75 down, so nobody can pick them up, and vanilla despawn deletes them after
   6000 ticked ticks. It costs 6 planks per town (2 trapdoors), needs no iron, works in any biome, and puts no hazard at home.
2. **Codex's hopper/dropper feeder is not needed on this fleet.** Codex chose it because it assumed a Paper merge radius
   of up to 2.5, which would let pit items merge into surface stacks. **Measured: `merge-radius.item: 0.5` on all 20 worlds**
   (16 fleet + 4 sandbox). Paper's vertical merge inflation is `radius - 0.5` = **0.0**, so a pit item can never merge
   upward. That removes Codex's only reason for 20 iron + redstone.
3. Both engines agree on the rest: composting stays first, then the well for what composting cannot take. Lava,
   cactus and egg-throwing are rejected. Using ballast productively is not a disposal method.
4. **The junk swap uses the well by making room BEFORE the withdraw:** dispose first, then open the chest. Never drop junk
   at the chest. The withdraw's cursor "hold" stays as it is. Dispose-first makes it rare, and it is not a disposal path.
5. Start with an **eight-item allowlist** (eggs x3, flint, clay_ball, ink_sac, glow_ink_sac, armadillo_scute) plus the
   non-compostable NEVER_KEEP decorations (dead_bush, pointed_dripstone, rail). Cobble, dirt and other ballast are out of the first
   canary: they are scaffold and banking inputs ("not bankable" does not mean "safe to destroy", Codex).

---

## 1. Facts this design rests on (verified, with sources)

### Pickup box: vanilla, and Paper does not change it
- `Player.aiStep` (1.21.8): `this.getBoundingBox().inflate(1.0, 0.5, 1.0)`, then `touch()` on every entity in it
  (decompiled 1.21.8 Player.java:559,
  https://raw.githubusercontent.com/extremeheat/extracted_minecraft_data/client1.21.8/client/net/minecraft/world/entity/player/Player.java).
  Paper's Player patch does not touch this
  (https://raw.githubusercontent.com/PaperMC/Paper/ver/1.21.8/paper-server/patches/sources/net/minecraft/world/entity/player/Player.java.patch,
  grep finds no `inflate`).
- The repo already encodes this exactly: `bots/src/pickupbox.mjs:7-24`. The bounds are |dx|,|dz| < 1.425 and **dy in (-0.75, 2.3)**,
  measured from the item's bottom to the player's feet. Wiki: "extends 1 additional block to the horizontal sides, and 0.5 additional
  blocks up and down" (https://minecraft.wiki/w/Item_(entity)).
- **Consequence: an item resting more than 0.75 below a player's feet cannot be picked up, whatever the horizontal distance.**
- A rider's box is `minmax(vehicle box).inflate(1.0, 0.0, 1.0)` (Player.java:557), which is shallower still. Boats do not change this.

### Toss mechanics: what mineflayer actually sends
- `bot.tossStack` = `clickWindow(slot)` + `clickWindow(-999)` + close (mineflayer 4.37.1 `lib/plugins/simple_inventory.js:22-27`).
- On the server, a -999 PICKUP click calls `player.drop(carried, true)` (AbstractContainerMenu.java:421-424), which becomes
  `createItemStackToDrop(stack, throwRandomly=false, retain=true)` (LivingEntity.java:3117-3141). The throw is **aimed, not
  random.** It spawns at the player's x,z, at eyeY - 0.3 (1.32 above the feet). Velocity is `(-sin(yaw)cos(pitch)*0.3 + r, -sin(pitch)*0.3 + 0.1 ± 0.1,
  cos(yaw)cos(pitch)*0.3 + r)` with |r| <= 0.02. **`setPickUpDelay(40)` applies to every player** (the target is null for a toss).
- Block drops get a 10-tick delay (wiki).
- Closing a container with a loaded cursor runs `dropOrPlaceInInventory` and then `placeItemBackInInventory`. On a full bag that is a drop
  (AbstractContainerMenu.java:598-632). This is the withdraw-hold problem in STATE 07:50Z.

### Merge and despawn on THIS fleet (read-only, 10.0.0.30, all 20 worlds)
- `spigot.yml`: `merge-radius.item: 0.5`, `item-despawn-rate: 6000` on every world. `paper-world-defaults.yml`:
  `only-merge-items-horizontally: false`, `fix-items-merging-through-walls: false`, `alt-item-despawn-rate.enabled: false`.
- Paper 1.21.8 ItemEntity patch: the merge search box is `inflate(radius, onlyHorizontal ? 0 : radius - 0.5, radius)`. At 0.5 that is
  **(0.5, 0.0, 0.5)**, identical to vanilla, so two items must overlap vertically to merge (their boxes are 0.25 tall). On merge,
  `age = min(ages)`: the merged stack takes the YOUNGER age
  (https://raw.githubusercontent.com/PaperMC/Paper/ver/1.21.8/paper-server/patches/sources/net/minecraft/world/entity/item/ItemEntity.java.patch).
- Despawn: 6000 ticks "of being in a loaded, entity-ticking chunk"; items do not age in unloaded chunks (wiki).
  The worlds run `simulation-distance=6` (scripts/bootstrap-mcai.sh:189).

### What deletes items (wiki: lava, fire, cactus, explosions, void; despawn)
- **A lava cauldron does not spread fire** ("Lava inside cauldrons does not spread fires like free lava") and "burns any
  entity inside of it". It costs 7 iron (cauldron) + 3 (bucket) (https://minecraft.wiki/w/Cauldron).
- Trapdoors need no support block. A trapdoor placed on the top half of a face sits in the top half of its cell. "Mobs cannot
  open wooden trapdoors". "Mobs consider all trapdoors closed", so they fall through open ones (https://minecraft.wiki/w/Trapdoor).
- Recipe (minecraft-data 1.21.8): `oak_trapdoor` = 3x2 planks makes 2. The 3-wide shape **needs a crafting table**. Hardness 3, axe.

### Pathfinder facts that shape the cover
- mineflayer-pathfinder 2.4.5 `lib/movements.js:233-234`: `safe` and `physical` are computed from the block's **static**
  `boundingBox`. For trapdoors that is `'block'` in minecraft-data **whether open or closed**. So the planner treats an OPEN trapdoor
  as solid floor and would walk a bot onto it (the bot then falls). A closed trapdoor is correct floor. The design has to keep the open window
  short and empty of other bots.
- `getLandingBlock` (movements.js:462-473) makes a hole a legal drop-down if it is <= maxDropDown deep. Fleet maxDropDown is 6/6/8
  (index.mjs:374, 530, 601, 645), so an UNCOVERED pit is enterable on purpose. A cover is required.
- Fleet-wide step exclusions cost about 8% in getNeighbors, and drop-down landings bypass `exclusionStep`. The composter's fleet
  exclusion was reverted for this reason (STATE 10-03; `composterSafeMovements` composter.mjs:679-683 is the scoped fix). So the
  design must **not** depend on a new per-node exclusion.
- `blocksCantBreak` is a type set (an O(1) lookup that already exists). Adding the wooden trapdoor ids there stops canDig profiles from digging
  the cap. Trapdoors are never a gather target.

### Repo facts
- `NEVER_KEEP` (hygiene.mjs:21-25) has eggs, flint, both ink sacs, dripstone, dead_bush and rail. **It does not have clay_ball or
  armadillo_scute** (Codex agrees). `neverPickUp` (hygiene.mjs:28) only stops CHASING
  (`pickupNearbyItems` skills.mjs:1387, filter at :1395). The server still auto-gives these items.
  The test pins cobblestone as collectible (test/hygiene.test.mjs:48-50).
- `smelting.mjs:98` maps `clay_ball -> brick`. That is a recipe entry, not a use: nothing in the fleet wants bricks.
- Composter: `isCompostJunk` = NEVER_KEEP AND verified-compostable (composter.mjs:39-68). Eggs, flint, ink, dripstone, dead_bush,
  rail and bamboo are excluded on purpose (composter.mjs:31-37). Reusable machinery: `canonicalComposterSite` and
  `siteRefusal` (composter.mjs:318-388); the shared per-pool generation record `townComposterSite` / `resolveTownSite`
  (skills.mjs:4918-4927); `townOrder`, which is deterministic and only fires when the bot is already at town (composter.mjs:549);
  `chainPeak` / slotsNeeded, the free-slot guard for craft chains.
- Home = `config.world.homeX/Y/Z` (config.mjs:139). The only dig-near-home ban is for `descend` (skills.mjs:5654-5672, <= 12
  blocks), plus oretunnel's break exclusion (oretunnel.mjs:52,189). **Gather can dig dirt/cobble at town**, so a cap made of dirt
  or cobble would get mined. A trapdoor will not be.
- Withdraw (wd-on-6c9a8fb): room is made by `roomPlan` / `roomCandidates`, which bank whole stacks deposit would bank anyway
  (withdrawpick.mjs:117-150). `HOLD_MS` = 10 min (withdrawpick.mjs:218). `survivalRelease` (:202) closes a loaded cursor in an
  emergency.

---

## 2. Candidates, ranked

| # | Mechanism | Verdict | Why |
|---|---|---|---|
| 1 | **Composter** (shipped, KEPT 17:50Z) | keep first | Consumes compostables outright. DiD -2.16 junk slots/bot. Covers none of the eight. |
| 2 | **Junk well**: top-half trapdoor over a 1-air-cell shaft, despawn | **RECOMMEND** | Any world, 6 planks, no iron, no fire, no lethal fall. Out of every pickup box by 2.0 blocks of margin against 0.75. No merge path at radius 0.5. |
| 3 | Codex's sealed chest -> 4 hoppers -> dropper -> deep chamber | not needed here | Solves a merge radius of 2.5 that this fleet does not run. Costs 20 iron + redstone + a powered pulse per town while iron is the bottleneck. Keep it on file in case any world ever raises merge-radius. |
| 4 | Lava (pit or cauldron) | reject for now | Destroys items immediately. But the cauldron alone is 10 iron, lava has to be fetched (a lava trip; lava deaths are a fleet cause). A lava cauldron is also a hollow-top block that the planner reads as floor: the same trap the composter had (STATE 10-03), and lethal this time. A possible later upgrade only, after the well proves the visit loop. |
| 5 | Cactus | reject | Needs sand and a desert/badlands source, and hurts bots. Not "any world". The cactus trash-can designs online also need sand + a trapdoor + paintings. |
| 6 | Throwing eggs | reject | It consumes the egg, but chicks hatch about 1 in 8 times. Chickens at town lay eggs that bots auto-pick up: a junk source that keeps itself going. Tossing eggs into the well does the same job with no chicks. |
| 7 | Ballast used productively (scaffold, tunnel fill) | complement, not disposal | Slot relief needs a WHOLE stack gone. Placing 1 of 64 frees nothing. Pathfinder already scaffolds with dirt/cobble (movements.js:76-77, scaffold.mjs:83,189). Baritone does the same (`acceptableThrowawayItems`). |
| 8 | Fire / explosions / void / full hoppers / campfire | reject | Fire and explosions do collateral damage, the void is in the End, and full hoppers stop accepting rather than delete. I could not verify that a campfire burns items, so it is not relied on. |
| 9 | `setCanPickupItems(false)` / PlayerAttemptPickupItemEvent | reject | Works only through a server plugin (the Paper patch shows the hooks). That is an admin change, not bot code. |

Prior art (the real search): **Mindcraft `!discard`** = `moveAway(5)`, then `bot.toss`, then walk back
(https://github.com/kolbytn/mindcraft/blob/main/src/agent/commands/actions.js lines 242-253;
`skills.discard` at src/agent/library/skills.js:838). That is exactly the toss-and-walk-away design the sandbox already refuted.
**Voyager** hard-codes "Deposit useless items such as andesite, dirt, cobblestone" into a chest at >= 33 slots
(https://github.com/MineDojo/Voyager/blob/main/voyager/agents/curriculum.py lines 246-264). That is the write-only bank this fleet
already ran into. **Baritone** has no disposal, only throwaway blocks for scaffolding
(https://github.com/cabaletta/baritone/blob/1.21.4/src/api/java/baritone/api/Settings.java:227-230). Human survival designs use
lava or cactus under a trapdoor (https://www.sportskeeda.com/minecraft/how-make-trash-can-minecraft ,
https://www.instructables.com/Minecraft-Trash-Bin/). No bot project I found has a bot-built, pickup-safe disposal. mineflayer's own
tossStack has open reliability issues (https://github.com/PrismarineJS/mineflayer/issues/2280 ,
https://github.com/PrismarineJS/mineflayer/issues/3590), so tosses must use the fleet's own click/settle machinery (craftsync `inflight`),
not raw tossStack. Codex also cites https://github.com/PrismarineJS/mineflayer/issues/2020 (I did not open it).

---

## 3. The junk well: exact geometry

Let the walking surface be the top of block layer `g` (bot feet at `g+1`). The well column is X,Z.

```
 y=g+1  . . . . .        <- bots walk here (feet g+1)
 y=g    S [T] S          T = wooden trapdoor, TOP half (occupies g+0.5..g+1), hinge on the side AWAY from the tossing stand
 y=g-1  S [ ] S          one air cell: items rest at y = g-1
 y=g-2  S  S  S          solid, non-falling floor
```

- **The item is out of every standing player's box.** Item bottom g-1 against feet g+1 (rim, or on the closed trapdoor) gives dy = -2.0 vs
  the -0.75 limit. A bot on a dirt path block next to it (feet g+0.94) gets -1.94. Jumping only increases the gap. Isolation therefore holds for any
  player whose feet are >= g-0.25 within 1.425 horizontally. The site refusal below guarantees no such lower cell exists.
- **No merge escape:** with merge box (0.5, **0.0**, 0.5), a well item at g-1 and any surface item at >= g+1 never overlap
  vertically. Items inside the well do merge with each other. That is good: it bounds the entity count.
- **Spawn-proof:** under the closed cap the clear height is 1.5 (g-1 to g+0.5). Zombie 1.95, skeleton 1.99 and creeper 1.7 all
  collide with the cap, so they cannot spawn. Spiders are too wide for a 1x1. Only bats (harmless) or small slimes (slime chunks below y 40) fit. Sandbox-check this.
- **Falling in (open window only):** a 2-block fall does no damage (fall damage = distance - 3). The worst case is a bot standing in
  the shaft that picks junk back up (most are full anyway) and has to tower or dig out: bounded, not lethal. The admission rule below
  keeps the window empty of other bots.
- **Never seal onto the pile:** the cap is placed once, at build time, onto an empty shaft. It is opened and closed and never
  re-placed onto items (Codex: an item inside a block is ejected upward).

### Site (pure function, reuse composter machinery)
- `canonicalWellSite({home, read})` is a fixed spiral like `canonicalComposterSite`, using its own record key `junkwell-site-<home>` through
  `resolveTownSite`. Everything it needs is in loaded chunks.
- `wellRefusal(read, site, home)` refuses a cell if any of these hold:
  - it is within 3 of the home point, a composter or a container (re-use `siteRefusal`'s clearances);
  - the floor (g-2) or any wall cell (the 8 neighbours at g and g-1) is not solid and non-falling (no sand, gravel, leaves or liquid);
  - any air, liquid or cave cell is within 2 horizontally at g-3..g-1 (no underground neighbour can stand within the box);
  - any standable column within 2 has its surface below g;
  - there is liquid or lava within 3;
  - there is no solid face on the hinge side to place the trapdoor against;
  - there is no standable tossing cell on the opposite side.
- **Identity:** "a wooden trapdoor (half=top) within ADOPT_RADIUS of home over exactly one air cell on a solid floor". The trapdoor
  is the marker, since towns have no other trapdoors. The nearest valid well is adopted, so a town gets one well.

### Build (deterministic town order, like build_composter)
- The trigger is: at town, no well, 6 planks (or 2 logs) available, a table carried or in reach, and free slots >= the chain's peak (`chainPeak`).
  Mineflayer drops crafted output that has no slot.
- The steps: from the tossing cell, dig g, then g-1 (hand or shovel). The drop from cell g lands on g-1's block, then falls with it. Both
  drops end in the shaft (delay 10 ticks; they fall about 2 blocks in about 10 ticks, so dy is already below -0.75). Then place the trapdoor
  against the hinge-side face with `half: 'top'`. Read back: name, `half=top`, `open=false`, cell g-1 air, g-2 solid.
- Add all `*_trapdoor` ids to `blocksCantBreak` on every movement profile. It is a type set, so there is no hot-path cost.

### Dispose (deterministic town order, beside compost)
1. **Admission:** the bot is at town, bag >= TRIGGER_SLOTS (34), it holds at least one whole stack of allowlisted junk, a well exists,
   and **no other player is within 5 blocks** of the well (`bot.players` entities).
2. Walk to the tossing cell, opposite the hinge, centred, so that <= 1.15 from the well centre. Re-read the trapdoor.
3. Open it (`activateBlock`) and read back `open=true`.
4. For each planned stack: aim, then toss. **Aim is a pure function** `wellPitch(dist)`, using the vanilla ballistics above to land at the
   centre of the usable 13/16 opening. My simulation of the vanilla velocity formula, including its random terms (scratchpad
   `toss.py`), gives 99.2% in the opening at distance 1.0 (pitch ~52.5°), 98.2% at 1.15, and 95.7% at 1.3. So refuse to toss
   from more than 1.15. Use the fleet's click ownership (`inflight` settle) and record server-confirmed bag deltas.
   Never toss a non-allowlisted item. The plan is computed from the bag and re-checked per stack.
5. Wait about 1 s, then **close and read back `open=false`**, in a `finally`. Survival release and hard stop must also close if in reach.
   A visit that cannot close writes `left_open`, and the next visit's first act is to close it.
6. **Misses are retaken, never left.** Track every item entity spawned from this bot's tosses (by entity id). Any entity whose bottom is still >= g
   at +2.5 s is walked to with `pickupGoal` (pickupbox.mjs:91-102), which overrides `neverPickUp` for those ids only. The bot just freed slots, so
   it has room. Row: `missed=N retaken=N`.
- Visit budget: <= 20 s, capped at 9 stacks per visit (2 clicks each).

### Bounded entity count
Merging keeps the younger age, so a well that keeps receiving the same item type within 5 minutes keeps that partial stack alive. Full stacks
(eggs 16, others 64) stop merging and despawn 6000 ticked ticks after their last merge. The count is therefore bounded by about
(types x (1 + inflow per 5 min / stack size)): single digits per town. If no bot stays within simulation distance, the timer pauses. The items
stay contained and age again on the next visit.

---

## 4. Junk swap and the withdraw hold

- **Dispose BEFORE withdraw** (Codex reached the same conclusion independently). When withdraw finds no room, its remedy is the
  well: close the chest with an empty cursor, walk to the well, dispose of whole allowlisted stacks until `slotsNeeded + 1` slots are free, come back,
  re-validate the chest, then withdraw. In code this is one more candidate in `roomCandidates` (withdrawpick.mjs:117): "dispose a junk stack" at the well,
  cheaper than banking. That is the owner's "junk swap" with the junk going into a real disposal, and no valuable item waits on a cursor during travel.
- **Never junk-swap AT the chest.** The current `junkswap` mode (STATE 07:50Z) drops the junk at the chest when it closes. That is a pile. Other bots
  are mostly full, so it lies there and the next bot with room takes it. A well does not fix a drop made somewhere else.
- **The hold, meanwhile:** unchanged. The hold covers only a stuck cursor (the bag refilled between admission and click). With the dispose-first
  margin of +1 slot this should be rare, and the read should count `hold` entries per withdraw before and after. Survival release stays the emergency exception.
  It is a loss path, never "disposal".

---

## 5. Sandbox experiment (Paper 1.21.8, 10.0.0.30:25599-25602; at most 2 node bots; RCON only on sandbox)

The two bots are **A**, the disposer (allowlisted stacks in the bag), and **B**, the walker (free slots, so it CAN pick things up). Item counts come
from read-only RCON queries (`execute if entity @e[type=item,x=..,dy=..]`) on the sandbox only.

| # | Scene | Pass threshold |
|---|---|---|
| P0 | **Positive control:** A tosses 20 stacks onto flat ground; B walks across | B collects **20/20** after the delay. If not, the instrument is blind and nothing else counts. |
| P1 | **Build** in survival from 2 logs + a table, 3 sites (one with a cave 2 blocks under, which must be REFUSED) | 2/2 valid sites built exactly (half=top, closed, 1 air cell, solid floor); cave site refused; the dug drops end up in the shaft; the bag changes only by the planks. |
| P2 | **Accuracy:** 60 tosses from tossing-cell offsets of ±0.35 | >= 58/60 reach y = g-1. Every miss is retaken by A within 10 s, so **0 items on the surface at +30 s**. |
| P3 | **Isolation:** after P2, B makes 200 scripted crossings over the closed cap, along the rim and jumping; also stands at the rim while the hatch is open (RCON-forced) | B picks up **0** items from the well, checked against B's server bag and the in-well entity count. The P0 control runs on the same day. |
| P4 | **Despawn + merge:** stop feeding and keep a bot within range | In-well entity count reaches 0 within **6100 ticks** of the last toss. A second run feeding 1 egg every 2 min keeps exactly 1 egg entity (expected merge age reset) and the count stays <= 2. |
| P5 | **Spawn-proof:** `time set midnight` (sandbox), 20 min, bots parked 24+ blocks away but within simulation distance. Also a 2-high dark 1x1 control shaft | **0** hostile mobs in the well. The control shaft shows the spawn instrument works (>= 1 spawn, or the result is INCONCLUSIVE). |
| P6 | **Open-window hazard:** B is asked to path across the well while A has it open | Documents whether the planner walks onto an open trapdoor (I expect yes). The admission check refuses to open while B is within 5 on 10/10 tries. |
| P7 | **Interruptions:** 10 hard stops / survival releases while open | The trapdoor is closed by the `finally`, or by the next visit's first act, 10/10. No keeper is ever tossed (server bag diff). |
| P8 | **Unload:** feed, move both bots out of simulation range for 10 min, return | Entity ages resume (none despawned while away); P3 isolation still holds. |

The cheapest valuable subset is **P0+P2+P3** (about 30 min, 2 bots). It decides whether the geometry and aim hold before any build code is reviewed.

---

## 6. The one-variable canary (`junkwell-01`)

- **Variable:** the well's build and dispose orders, enabled. NEVER_KEEP, compost, pickup and withdraw stay unchanged (withdraw's dispose-first
  integration is the NEXT canary). Branch from the deployed fleet tip at registration, not from main and not from a withdraw branch.
- **Pools:** draw arbitrarily, per the owner rule. Exposure is the problem: composter-01 saw only 12 real visits in 6 h on 10 bots. So use **2 pools
  (10 bots)** as recent canaries did, with one canary declared and the rest as control. Count wells used by other bots (cross-pool contamination)
  as a separate number.
- **Correctness gates (deterministic; any hit means REVERT):**
  - C1 an item tossed into a well and later collected by any player (`playerCollect` on a tracked entity id, or an allowlisted item collected within 2 blocks of a well column) = 0;
  - C2 a bot whose feet are inside a well column = 0;
  - C3 a visit exiting with `open=true` and not closed by the next visit = 0;
  - C4 a non-allowlisted stack tossed = 0;
  - C5 a miss left on the ground at +30 s = 0;
  - C6 deaths follow the two-death floor (> 1.25x control). One death is named and does not decide the verdict.
- **Effect (difference-in-differences, never canary vs fleet):** allowlisted-junk slots per bot, and the share of bots at >= 34 slots.
  Positive control: control bots that are full and hold allowlisted junk must be > 0, otherwise INCONCLUSIVE. Slots freed per visit should be >= 1.5
  (composter: 2.00). Reads at +180 and +360. KEEP is possible from +360 (owner short-canary rule). Extend while visits < 20. INCONCLUSIVE is a legitimate close.
- **Guardrails:** gather successes per bot-hour DiD ratio >= 0.9; disposal time <= 5% of canary bot-time; `_reflex_stuck` DiD (the 20 s
  watchdog interrupting visits was a composter defect; give the visit a self-expiring stationary window like compost has).
- Read with `scripts/lib/telemetry.py` over full, rotation-aware walks. Every zero carries its positive control.

---

## 7. Where the two engines differ, and how this resolves it

| Point | Codex | Claude | Resolution |
|---|---|---|---|
| Feeder | sealed chest/hopper/dropper, emission 5 deep, 4-block shell | hand toss through an opened trapdoor | Codex's reason was a merge radius up to 2.5. **Measured 0.5, so vertical merge = 0.** Hand toss wins on cost. Keep the feeder on file. |
| Exposure while tossing | "depth does not protect the item before it falls" | pickup delay is 40 ticks for **everyone** (LivingEntity.java:3123); the item is in the well in about 10 ticks | Only misses are exposed, and they are retaken (C5). |
| Cover | permanent solid deck | trapdoor (closed = deck, open about 3 s) | Codex is right that pathfinder misreads an open trapdoor as floor (verified, movements.js:233-234). Hence the admission check (no player within 5), the `finally` close, and P6. |
| Allowlist | the owner's 8 items; ballast only with explicit reserves | same, plus 3 non-compostable NEVER_KEEP decorations | Agree. Ballast is an owner question. |
| Withdraw | dispose first; never "walk holding a cursor"; helper rescue for a stuck cursor | dispose first; hold unchanged; never junk-swap at the chest | Agree on dispose-first. Helper rescue is an owner question. |

Codex also correctly found: clay_ball and armadillo_scute are missing from NEVER_KEEP (hygiene.mjs:21), and cobble is a banking and scaffold input
(bankable.mjs:34,80).

---

## 8. Owner questions

1. **Does vanilla despawn count as "a means for getting rid of junk"?** The well holds junk out of everyone's reach for 5 ticked minutes, then
   the server deletes it. The alternative that deletes at once is lava, at 10 iron per town plus a lava trip, and a hollow-top hazard at home.
2. **Allowlist:** are the 8 items plus dead_bush, pointed_dripstone and rail right? Should armadillo_scute and clay_ball also join NEVER_KEEP
   (stop chasing them)? That would be a separate change.
3. **Ballast:** may surplus andesite, diorite, granite, tuff and gravel be disposed above a kept scaffold reserve (e.g. keep 1 stack)? May cobble beyond
   the stonecap rule? This is not in the first canary.
4. **Junk swap:** confirm that "junk swap" means *dispose at the well, then withdraw*, and that the existing `junkswap` mode (drop at the chest)
   stays OFF.
5. **Stuck cursor:** keep hold, then close-after-30s, as now? Or adopt Codex's "a helper bot withdraws a chest stack to make a return slot, then raise an
   unresolved alert"?
6. **Order in the queue:** the well before or after withdraw? Dispose-first withdraw needs the well, so I propose: toolclean (chained) -> grid fix -> **well** ->
   withdraw (dispose-first) -> stonecap -> admin clear.
