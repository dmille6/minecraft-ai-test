# poolescape-01 — dig out of a walled water pit (design, 2026-10-22; r2 after Codex + Claude r1)

OWNER 2026-10-22 ~17:10Z, a named exception to the 09-30 "no stuck/drowning hunts" rule: *"can the bot use their
pickaxes to dig a tunnel or stairs up and out of the stranded pool?"* Base: fleet `1f5b4b4e` (protectzone-01, promoted
16:54Z). Branch `poolescape-on-1f5b4b4`.

## 1. Rows first (measured 10-22 16:50-17:30Z)

**Population, 7 days, Elasticsearch** (10-15 17:28Z -> 10-22 17:28Z; 10,420,941 skill docs, 80 bots, 168 h, 13,440
bot-h; window does not touch 10-07). A *spell* = consecutive 10-minute buckets of one bot that each hold at least one
`_marooned`, one `_water_float` and one `_path_no_legal_move` row. Positive control: the three kinds total 53,450 /
325,207 / 405,388 docs, and 76 of 80 bots have at least one such bucket (the state is common and brief).

| | spells >= 30 min | bot-h in them | longest |
|---|---|---|---|
| fleet | 9 spells on **8 of 80 bots** | 419.3 of 13,440 (3.1%) | |
| board-d-Alpha | 1 | 159.5 | since 10-16 02:00Z, (555, 61, 116) |
| board-d-Comet | 1 | 138.8 | since 10-16 22:40Z, (329, 61, 213) |
| board-d-Bravo | 1 | 117.0 | since 10-17 20:30Z, (329, 61, 213) — the same cell |
| 5 others | 6 | 4.0 | 0.5-1.3 h each, all ended on their own |

So the trap is three bots in one world and 99% of the spell time: **415.3 of 419.3 bot-h**.

**Per 4 h each (files, telemetry.py):** ~1,650 `_water_float` + `_water_float_ended` ("afloat and unowned — float";
"ended because ashore"), 1,147-1,287 `_path_no_legal_move` (`sealed_in_liquid status=noPath visited=1 startLiquid=true`),
119 `_marooned` ("no path can start from y=61 with an open column above -- climbing out"), 118 `_stranded_escape_try`
(plan=float_up) + 118 `_stranded_escape_result` ("floated 0.3 block(s); still wet"); Bravo also 2,600 `_scaffold_pick`
(`dig_straight_up: dirt instead of cobblestone`, one per 5.5 s).

**What they carry (last snapshot):** Alpha stone_pickaxe 0/131 used, 2 wooden pickaxes (16 and 52 of 59 used), 16 oak
logs, glass, ladders (placeable count 16); Bravo iron_pickaxe 0/250, stone_pickaxe 0/131 + 110/131, 91 cobblestone,
10 dirt, 64 logs (placeable 168); Comet 3 stone pickaxes (116, 121, 0 of 131 used), 61 logs (placeable 61). All
health 20, hunger 20.

## 2. Geometry (region files read-only on 10.0.0.30, then 200 of 200 cells confirmed against the LIVE world by
read-only RCON `execute if block`; negative control: stone cell queried as air -> "Test failed")

Both pits are the same shape: **a 1x1x2 hole whose feet cell is a water source on a solid floor, whose head cell is
air, whose four head-level walls are solid, and whose column above is open.**

- **Bravo/Comet (329, 61, 213), sparse_jungle, a flooded cave 12 blocks under the grass (y 68-70).** Floor
  (329,60,213) oak_planks; feet (329,61,213) water; head (329,62,213) air; head-level walls N cobblestone (329,62,212),
  S andesite (329,62,214), W cobblestone (328,62,213), E cobblestone (330,62,213). Feet-level neighbours: N dirt, S
  dirt, W water, E water. Above: air y 63-65, stone at 66 (a cave 3 high, open to the grass near (328,68,215)). Water at
  y 57-62 all round; two of the head-level wall blocks touch a water SOURCE at the same level ((330,62,212),
  (328,62,214)). Rim = top of the head-level walls = 63, **2 above the floor top (61); water depth 1**.
- **Alpha (555, 61, 116): a lake (surface y 62), open sky.** Floor (555,60,116) cobblestone; feet water; head air;
  head-level walls cobblestone on all four sides — lines of cobblestone at the lake surface radiating from the cell
  (pathfinder bridge blocks, most likely its own); feet-level neighbours all water; everything above y 63 air.
  Rim 63, 2 above the floor top; depth 1; the lake below is 5+ deep.

Walls: cobblestone and andesite (pickaxe blocks; bare hand 10 s / 7.5 s grounded, x5 while afloat = 50 / 37.5 s), dirt
under the N and S walls at Bravo's site (hand 0.75 s).

## 3. Why every rung fails (the chain, each guard correct alone)

1. **Pathfinder (`goto`, `canStartAPath`).** `getMoveJumpUp` needs the step cell (dir, +1) dug; with `canDig` it asks
   `safeToBreak`, and `dontCreateFlow` refuses any block with liquid above or BESIDE it — every head-level wall here
   touches water. `getMoveUp`/`getMoveParkourForward` return at once from a liquid node ("cant jump from water").
   So A* has one node and no neighbour: `visited=1`, `sealed_in_liquid`, "no route even with digging allowed".
2. **`marooned` -> `pillarOut` -> `digStraightUp`** (mstate `climb`: all three hold blocks). The pillar jumps and
   places on the floor's top face into the bot's own water cell. A bot in 1-deep water bobs to at most floor+0.8
   (measured: y 61.0-61.8 across 4,600 snapshots), so its box always overlaps the target cell and the server refuses
   the place; after 3 stalls it hands to `digStraightUp`, whose ceiling is open, so it repeats the same jump+place 20
   times (the 5.5 s `_scaffold_pick` cadence: each place waits out mineflayer's 5 s timeout) and returns nothing.
   `climbOutcomeRoute(undefined)` routes nowhere. The bot is where it began.
3. **The ramp (`escapeStairUp`, bare-handed)** is never reached from `climb`, and would refuse if it were: the side
   treads are water ("no tread to stand on") and the N/S steps are refused by `overheadBreakRisk` (water beside the
   block; the submerged exemption does not apply, the head is in air).
4. **The stranded lattice** picks `float_up` (afloat, column open, no lateral head opening) — it is already floating.
5. **`_water_float`** keeps it breathing (correct; the only water reflex).

Physics that makes a fix possible (prismarine-physics index.js:461-463 and 499, the vanilla rule): a bot in water that is
**horizontally collided** gets `vel.y = 0.3` when its box, raised by 0.6, touches **no block and no water**. Bobbing to
floor+0.8, that clears a ledge whose top is floor+1 into a DRY cell, never one at floor+2, and never into a wet step.
**The trap is a rim 2 above the floor; one cut (and, where the step would flood, one or two plugs) turns it into a dry
1-high ledge.** (Qualifications, Codex r1 P3: `canStartAPath` runs on the walking profile, canDig false -- the
dontCreateFlow refusal is what a dig-capable `goto` meets, the walking profile simply has no move; all three bots are in
mstate `climb` because each holds more blocks than `canFinishClimb` asks, 16 / 168 / 61 against climbNeedAbove; only two
of Bravo's four head-level walls touch a water source, all four of Alpha's.)

## 4. The rung: `poolEscape` (reflex.mjs actuator; pure planner `bots/src/poolescape.mjs`) -- revised after r1

**When.** In the marooned arm, after the existing rungs have run and failed, and only if the bot is WADING (feet cell
water, head cell AIR -- not merely passable, Codex r1 P1), no owner outranks it, and still no route (`canStartAPath`).
Two hooks, each holding a grant (Codex r1 P1):
(a) the `climb` branch, inside the existing `maroonGrant`, after `pillarOut` (+ the flood branch) -- never after a
`preempted` pillar; (b) the `need_scaffold` branch after the ramp cut 0 steps and the underfoot dig failed: it sets
`marooned` (so the next tick cannot fire it again), takes its own grant with `takeBody`, gives it back in `finally`.
Hook (a) runs only after a pillar that cannot rise (~115 s: 20 placements that each wait out mineflayer's 5 s timeout).
That cost is accepted: nothing that ran before is removed or reordered, so the rung subtracts no move the bot had.

**Owners it yields to (`gone()`, asked before every mutation and after every await -- equip, look, dig, place, the step):**
the drowning rescue (`drowningOwnsBody`; with the arbiter OFF in production that is "rescuing and the water is real"),
an air-pocket request (`airPocketWanted()`, the handshake the pillar already observes), the arbiter grant when it is on,
and a skill the planner dispatched mid-firing (`runner.isBusy()`, Claude r1 P2). A yield leaves the controls to the new
owner. While a firing runs, two arms that steer a wet body without owning it stand aside (Claude r1 P2): the stranded
ladder (deliberately not gated on `marooned`) and the float hold's jump; the drowning rescue still runs.

**One step up** (relative to the feet; bearing b = a cardinal):
- *room to rise*: the bot's own (0,2,0) and (0,3,0) are breathable air.
- *tread* (b,0) solid, or **placed** (it is water or air) against the first solid face: below it, then its sides, then the
  wall above it (placed while that wall is still solid).
- *step* (b,1) takes the feet, *head* (b,2) the head, *clearance* (b,3) is the next step's headroom. Solid ones are dug,
  top down.
- **THE STEP MUST END DRY** (the physics above): every plain-water side of (b,1) is **plugged** first -- a block placed into
  it -- and water already in (b,1) is **filled** (clicked on the tread's top) and dug out again. A waterlogged block beside
  or in the step cannot be plugged: that bearing refuses. This replaces r1's "water beside is allowed", which both
  reviews showed would flood the destination and the bot's own head cell.
- **THE BREATHING COLUMN** (Codex r1 P1): (b,2) and (b,3) are not water, and nothing wet (water, waterlogged, melting ice)
  touches them except from below.
- **hard refusals**, per candidate and again, live, immediately before every place, before every dig AND after the hand
  change at the swing (the ramp's lesson; a mutant proves the second check): lava in any worked cell or on any of its six
  faces; unloaded terrain; a block neither hand can break (`escapeDigPlan`: obsidian-class); a falling column in the step;
  fewer blocks held than the placements need.
- **Tool.** `toolFor` (the cheapest eligible tool), then `escapeDigPlan`: bare hand first, the tool when the bare swing
  would exceed the cap (cobblestone afloat: 50 s bare, ~3.75 s stone pickaxe). **The escape reserve is KEPT** (both
  reviews): the bag's last usable pickaxe is never spent; the hand digs instead -- slower, never a refusal. All three
  target bots hold 3+ pickaxes.
- **Step.** Look along b, hold forward + jump up to 1.2 s; success is the feet cell at (b,1) after a 400 ms settle.

**Choosing.** The four bearings; ranked: fewest keep-out marks, fewest placements, fewest digs, fewest plugs, the facing
order. If none is ok from here, the bot swims (<= 4 cells, through wading cells whose feet and head cells have no lava on
any face and no fire-column veto -- the transit gets the step's checks, Codex r1 P2) to a cell that has one.

**Repeat** up to 8 steps / 90 s per firing. **A route ends it, wet or dry** (Claude r1 P2: both measured exits are a lake
and a flooded cave); not wading any more (dry feet: the older rungs work again) ends it too.

**Keep-outs.** Protected zones (`blocked`) and town ground (`townDigClass`) are an ORDERING mark, never a veto: digs in the
marooned arm are survival-class (the reflex tick's `digScoped` scope), protectzone's SURVIVAL_OPS lets a reflex's pillar
dig and place, and townground leaves transit untouched ("a bot in a town pit digs out exactly as it does today"); a veto
would build the dead end both designs refused (both reviews agree). A **live fire column is a movement VETO** on the cells
the body enters (`routeForbids`: an inward step), kept as keepout has it (Codex r1 P2); lava itself is the hard refusal.

**Bounded.** Per spot (2-block key): back-off after a firing that ends `refused` or `progress`: 5, 10, 20, 40, then 60 min;
none after `yielded` (the owner that took the body decides; the 60 s maroon cadence bounds it); reset on `out`.
`POOLESCAPE=0` turns the rung off (the one-setting rollback).

**Rows.** `_poolescape_mode` once per spawn (the licence); `_poolescape_start` BEFORE anything moves (`id= hook= at= tries=`);
`_poolescape` at the end with the same id (`outcome=out|progress|refused|yielded steps= rose= dug= placed= swam= hands=
marks=zone:,fire:,town: lava_refused= water_beside= dry= route= at= tries= -- reason`). Nothing else in the fleet writes them.

Two bots in one pit (Bravo and Comet): each firing re-plans against the live world, so a wall the other bot already cut is
simply an open step; a placement the other body blocks fails verification and the firing ends `refused` (backed off).

## 5. What it is NOT
No new water reflex (the only water reflex stays "get air", and the rung yields to it). No world edit. No change to the
pathfinder, `overheadBreakRisk`, the ramp, the pillar or any guard's predicate; one rung in the marooned arm and two
stand-asides while it runs.

## 6. Proof
- Behaviour tests (`bots/test/poolescape.test.mjs`, 38): the planner on both LIVE pits (fixtures from the region files,
  200/200 cells matched live), lava behind a wall, the breathing column, waterlogged sides, the fill, keep-out ordering
  and the fire veto, obsidian, the swim, the tool reserve, back-off; the REAL actuator on a fake bot whose one piece of
  physics is the impulse rule (plug, cut, step, out; the base shape with no blocks never opens a cut; lava appearing at
  the swing and at the place; the drowning yield; a non-owner stop releasing the controls; the hand on dirt; no-tool
  obsidian through the real hand choice; no falling plug). Eleven anchored, unique mutants.
- Paper (sandbox, per-server lock `poolescape`): the WHOLE bot (`src/index.mjs`, model off) in each live pit copied cell
  for cell -- bravo (two bots), alpha, lava, zone -- BASE 1f5b4b4e vs CANDIDATE.
- Read `poolescaperead.py` (instrument = bot.pos, not the rung's rows; both reviews): G1 canary spell bot-h post <= half
  of pre and DiD < 0 (BLOCKS KEEP); G2 fire death inside an escape window (start row to end + 120 s, or start + 210 s with
  no end row) REVERT; G3 drowning/suffocation there REVERT; G4 an `out` row with the bot pinned at the spot 10-30 min
  later REVERT; ARMS, LIVENESS, INSTRUMENT. Tier 2, `draw_require_pools: ["board-d"]`, exposure = canary spell bot-h pre
  >= 0.5 and >= 1 firing (the three named bots are on board-d; dry run on the base 10-22: 7.5 canary spell bot-h in 150
  min, G1 "DID NOT FALL").

## 7. Code review r1 (Codex CHANGES, Claude CHANGES) -> r2 (335ad2e0)

- A solid FLOOR under the feet is required (Codex P1: a bot afloat over deep water is swimming; the rung would stand it
  down from the float hold while it worked), and the bot's own head cell must be breathable on every plan; `gone()` stops
  the moment the eye is in water and hands the body back to the air reflex (Claude P1-2).
- Never a falling block for a plug, tread or fill (Claude P1-2: a sand plug reads solid, then falls and floods the cut).
- Two kinds of stop (Claude P1-1): an owner that steers (the drowning rescue) keeps its controls; any other stop (arbiter,
  air-pocket request, a skill, the head under water) releases the forward/jump the rung set.
- The placement is planned again after the equip (Codex P2); water plants in or beside the step refuse (Codex P2).
- No tool is priced past the cap (Claude P2-1: planDig reads Infinity as unknown); hook (b) asks wading before it takes the
  body (Claude P2-2); the runner is RESERVED for the firing, renewed before every action, and a running skill stops it
  (Claude P2-3: the cognitive tick reads isBusy, so with the model on it dispatches nothing into a firing).
- Read: order-independent trap spread (Codex P2); >= 75% post-deploy position coverage for every canary bot trapped pre,
  or G1 cannot pass (Codex P2: a silent canary read as escaped); G4 matures on the bot's own rows; a spell ending in a
  death counts to the window end and each named bot's exit cause is reported (Claude P2-4).
