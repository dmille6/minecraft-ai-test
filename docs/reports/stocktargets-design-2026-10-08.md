# Per-town stock targets + chest pruning (stocktarget-01): design r6, 2026-10-10

Status: r6. r3: Claude APPROVE (three P2 spec changes taken); r4, r5: Codex CHANGE (sections 13, 14). Owner 10-08 ~17:20Z delegated the design ("do what you and codex think is right");
owner 10-10 (via the operator) added: CHEST PRUNING, USABLE TOOLS as a stocked item, coverage of logs, sticks, planks,
saplings, cobble, stone variants, dirt/sand/gravel, torches and stations, and targets sized from measured use that are
also the caps of ONE more admin clear, run only after this ships. Queue: peacefulkit (live) -> junkwell-02 -> stonecap ->
**stocktarget** -> the clear. This agent does not deploy, queue or touch the loop.

r1 reviews (Codex CHANGE, 10 findings; Claude CHANGE, 4 P1/P2 + 6 P3) are answered in section 10.

## 1. Measured

**Town containers, 10-10 12:08Z** (the operator's read-only RCON census, scripts/host/chestclear2/census2.py; 16
worlds, 425 town containers, 175 full, 7,988 occupied slots):

| name | slots | share | items | median town |
|---|---:|---:|---:|---:|
| stone_pickaxe | 1,759 | 22.0% | 1,759 (1,594 usable, 165 spent) | 86 |
| oak_log | 1,444 | 18.1% | 80,140 | 5,291 |
| cobblestone | 1,395 | 17.5% | 73,474 | 4,120 |
| stick | 404 | 5.1% | 17,443 | 1,177 |
| wooden_pickaxe | 374 | 4.7% | 374 (347 usable) | 22 |
| raw_copper | 287 | 3.6% | 7,356 | 510 |
| birch_log | 238 | 3.0% | 10,712 | 295 |
| oak_planks | 228 | 2.9% | 7,219 | 528 |
| coal, iron_ingot, raw_iron | 523 | 6.5% | | |
| bamboo | 122 | 1.5% | 6,066 | |
| oak_sapling / birch_sapling | 127 | 1.6% | 4,419 | |
| furnace / crafting_table / chest / bucket / ladder / torch | 323 | 4.0% | | |

Denominator: 7,988 occupied slots of 425 x 27 (more for doubles). Positive control: 16 of 16 worlds answered, every
container listed by positions.py was read.

**Flows, 48 h to 10-10 12:00Z** (scratchpad flows.py, streamed over 2,549,641 rows, 80 bots, every skill row's
inventory_delta; per day = /2):

| | banked/day | drawn from town/day | the bots' own use/day |
|---|---:|---:|---:|
| oak_log | 9,425 | 0 | craft 535, smelt 135, scaffold/losses ~2,400 |
| cobblestone | 16,908 | 0 | craft 2,851, scaffold ~15,000 |
| stick | 605 | 5 (withdraw_pick) | craft 1,133 |
| oak_planks | 184 | 1 | craft 281 |
| stone_pickaxe | 248 | **78** (withdraw_pick) | broken in use ~320; crafted 493 |
| wooden_pickaxe | 18 | **29** | crafted 105 |
| iron_pickaxe | 0 | 4.5 | crafted 35 |
| coal | 158 | **42** | smelt 58 |
| raw_copper | 449 | 0 | none |
| dirt / sand / gravel | 236 / 0 / 0 | 0 | scaffold ~17,800 dirt |
| saplings, torches, stations | ~0 (never bankable) | 0 | compost 510 saplings; tables 160, furnaces 133 crafted-and-used |

The bank is **write-only for every bulk material**; the only town draws are pickaxes (~5/town/day), coal and a few
sticks. Deposits 48 h: deposit 884 ok / 1,290 failed; town_deposit 771 ok / 858 failed, nearly all "full".
New chests: 5 placements in 48 h (hive-d), 168 `far`/`defer` refusals.

## 2. The targets (per town) = the bank cap = the prune floor = the clear cap

A target is what a town should hold for what WILL draw it: the blueprints (tree farm: 9 saplings, 4 torches -- its
soil dirt comes from the builder's bag; workshop: 1 table, 2 furnaces = 16 cobble, 3 chests = 24 planks; mineshaft: lining ~10 cobble/level, 48 ladders =
112 sticks), withdraw/withdraw2 (measured pickaxe and coal draw), chests for under-target storage, plus a margin. The
bots' own crafting, fuel and scaffold are served from their bags (table above) and are covered by the bot's keeps, not
by town stock. Every number below is **provisional**: when a blueprint starts drawing, its target is re-derived from
its measured draw.

| class | names | target | banked below | above target |
|---|---|---:|---|---|
| A counted bulk | **cobble** (cobblestone + cobbled_deepslate) | 256 | yes (stonecap) | bag surplus -> well; chests pruned |
| A | each **log** type (9) | 64 | yes | well; pruned |
| A | each **planks** type (10) | 64 | yes | well; pruned |
| A | **stick** | 64 | yes | well; pruned |
| A | **stone** | 64 | yes | well; pruned |
| B zero bulk | dirt; sand + red_sand; gravel; deepslate; tuff; calcite; sandstone + red_sandstone | 0 | never | well above the bot's keeps; pruned |
| B | the well's own junk list (owner 10-04 + 10-07 decorations, incl. andesite/diorite/granite) | 0 | never | unchanged (junkwell-02); pruned |
| C tools (usable copies, > FLOOR uses) | stone_pickaxe 16, wooden_pickaxe 4, stone_axe 4, stone_shovel 4; other wood/stone axes, shovels, hoes 0 | as listed | spare usable copies, by claim | **stay in the bag; never disposed, never pruned** |
| D protected, clear cap only | each sapling type 64; torch 64; ladder 64; crafting_table 2; furnace 4; chest 8; bucket 2 | as listed | as today (stations/saplings/torches: not banked) | never disposed, never pruned |
| E untargeted | iron, gold, every ore and raw_*, ingots, nuggets, coal, gems, iron/diamond tools, food, books, bamboo | none | as today | as today |

Why these numbers: stone_pickaxe 16 = ~3 days of the measured draw (78/day over 16 towns ~ 5/town/day); wooden 4 (~2
days of 29/day); axes/shovels 4 (no measured draw: a small provisional budget, not a per-bot allowance). Logs/planks 64 per type: the workshop and
the mineshaft ladders need ~21 logs and 28 planks; by type as the owner asked, symmetric across worlds (a taiga world
banks spruce as an oak world banks oak). Sticks 64: withdraw2's iron pickaxe takes 2. Stone 64: stone bricks later.
Class B is 0 because nothing draws them from a town (consumers are the bots' own scaffold, pillar and pit cover, served
from the bag and protected by the keeps in section 3.4). bamboo is left to bamboo/bamboocraft (clear cap 0, see 8).

**Never disposed or pruned, whatever a table says** (a structural test asserts no A/B group names one): tools and
armour, iron/ores/raw_*/ingots/nuggets/coal/gems, saplings and propagules, anything the composter takes, torches,
stations, buckets, food, bone meal, bamboo.

## 3. Mechanism

### 3.0 The one rule everything below follows: CONFIRM BEFORE YOU MUTATE (Claude r2 P1-1, Codex r2 1, 3)
Every record whose LOSS could make the town look fuller than it is (a bank claim, a prune's take claim, a withdraw's
draw claim, a predecessor's void) is appended to the CURRENT generation and confirmed by re-reading the generation
BEFORE the click it covers; if the generation moved, the action does not happen (the claim is released in the new
generation). Records written AFTER a mutation (the releasing post-transfer count, a recount, a dirty mark) may be lost
without harm: a lost release leaves its claim live (a bank claim keeps reserving, a take/draw keeps lowering the floor),
a lost recount leaves the older count to age out. When a writer's re-read shows the generation moved, it re-appends
such a record there AS ITS RELEASES PLUS A DIRTY MARK for the container -- never as a count with a releasing count's
priority, which could overwrite a newer, lower count (Claude r3 P2-3); a duplicate dirty mark costs one recount.

### 3.1 One journal, every group (stonecap's machinery, generalised)
- A count record (`cnt`) keeps `n` (cobble; stonecap's read folds it) and adds `v: 2`, `m` = { group: count } over EVERY
  group of section 2's table (A, B and the class-C tools by usable copy). `v: 2` means every group was counted: an absent
  group is a KNOWN 0. A legacy record (no `v`) is a count of cobble only: other groups' containers are UNKNOWN until
  recounted.
- Claims carry `g` (absent = cobble) and a `kind`:
  - `bank` (incoming): admitted when the count is complete and lb + live bank claims + n <= target(g) (cobbleAdmit);
  - `take` (a prune, outgoing): admitted when FLOOR - live outgoing - n >= target(g);
  - `draw` (a withdraw, outgoing): always admitted; it only lowers the floor until its post-transfer count releases it.
  Target-0 groups are never admitted to bank.
- **The floor**, defined once: the sum, over the town's containers, of counts captured within FLOOR_TTL (1 h), taking
  the SMALLER of two equal captures (`lo`). **The available floor** = floor - every live outgoing claim (takes + draws).
  EVERY disposal decision -- a take's admission, the well's plan and each of its throws, a prune's throws -- uses the
  available floor (Codex r3 1). A take is judged at its own place in the order; a draw confirmed after an admitted take
  does not undo it: the prune left the town at or above target and the draw is real use of that stock.
- Equal captures: MAX for the ceiling (stonecap's rule), `lo` = MIN for the floor (Codex 9).
- **A releasing count never moves a container's count backwards in capture time** (Codex r4 1): stonecap let a count
  that releases a claim on its container replace the standing count whatever the clocks say (so a release is never
  lost to a clock step). Now, when the releasing count's capture is OLDER than or EQUAL to the standing count's
  (Codex r5 1: a tie must not bypass `lo`), the claim is released and the container is marked UNKNOWN (dirty) until a
  recount -- neither count is trusted: the ceiling refuses (unknown), the floor counts 0 there. Only a releasing count
  captured strictly AFTER the standing one replaces it. (stonecap's clock-step test now expects UNKNOWN instead of the old count: more conservative.)
- `reset` (an operator fence, bots/scripts/stockreset.mjs, appended and confirmed like any record): every count captured
  at or before it is dropped (containers unknown until recounted). THE CLEAR PROCEDURE (Codex r3 2 / r4 2, Claude r3
  P2-1): the one-time clear runs with the affected pools' BOTS STOPPED (acknowledged suspension: no deposit, draw, swap
  or prune can mutate a chest during census, planning or execution), through the operator's own stop/start tooling;
  then `stockreset.mjs` appends a `reset` to every affected town's journal (dropping every count captured before it);
  then the bots start. Their live claims from before are voided at their next login (stonecap's void), which marks
  those containers unknown until recounted. The read checks the reset record per cleared town. (The `hold` field stays
  available -- no take is admitted while it is 1 -- but the procedure does not rely on it.)

### 3.2 Banking below target; the stop is paired with its exit
- The plan keeps today's allowance for every targeted name (scaffold reserve 8, 2 sticks, KEEP_ONE, creditCap 64,
  withdraw holds) AND -- for A names -- the town deposit's keeps (townKeeps: stockpile wood 64 units incl. planks/4, the
  stone family 64, ladder means, the active rung's wants), so ordinary banking, town banking and disposal leave the same
  bag behind (Codex 5). Capped by the group's room under target; excluded `town_stock_target` at target,
  `town_stock_unknown` when unknown below. Cobble keeps stonecap's whole-stack rule and phrases.
- Each transfer of a targeted name: one confirmed bank claim per name (per copy for a tool), released by the
  post-transfer count; only into TOWN containers. Paths: deposit, town_deposit, withdraw's room-making (3.6), the
  recovery's new chest (3.3).
- **No exit, no stop** (Codex 4 bootstrap): the bank cap binds for bulk only while a USABLE junk well stands in town (the
  at-target surplus then has an exit). In a town with no usable well, A/B names bank as today (claims still record them,
  flagged `nowell`), so the well's build is never starved of room by the cap.
- Tools (class C): a spare usable copy is admitted per copy against its target; above target it stays in the bag.
  THE VALVE (Codex r2 4, r3 4): at >= 34 slots, when nothing else at town can free a slot (no bankable non-tool stack,
  no well-able stack, nothing compostable), the town deposit may bank ONE copy that TODAY's tool rule would bank (the
  best usable copy of each name always stays; spent copies never move) -- so two copies of one name are enough. A
  `valve` bank claim is admitted whatever the target, only with the order's recorded proof `nothing_else=1`. Tools are
  never destroyed, so a full bag of spare tools always has this move while a town container has an empty slot; with
  every container full it is refused (reported: valve refusals). Expected rare (toolhygiene, promoted 10-10).

### 3.3 No new chest at or above target (Codex 6, 7; Claude P3-5)
Chest-full recovery builds a chest only for a QUALIFYING remainder: an untargeted item, a `nowell` item, or a targeted
item whose amount a bank claim admits. The claim is made against the chosen SITE's key before the craft (confirmed,
3.0), held through the craft and the placement, and released by the first deposit into the new chest (or on any
cancellation). The first deposit into the new chest transfers UNDER that claim (no second claim, which would count the
same items twice -- Claude r3 P2-2); its post-transfer count releases it. A remainder with no admitted claim and no
untargeted item ends the recovery `no_effect`. Rows:
`_stock_recovery stage=entry|reserve|craft|place|release qualifying=<names> claim=<id>`. Cobble keeps stonecap's rule
(never grows the bank).

### 3.4 The bag at the well (the junk-well coupling; owner-approved deletion)
At the well's existing trigger (town, >= 34 slots), for each A/B group whose FLOOR is at or above its target (target 0:
always), whole stacks go down the well while the bag keeps: every name's townKeeps keep; withdraw holds; cobble's 64
and STONE_GUARD (unchanged); and 64 scaffold-capable blocks in all (exit-contract scaffoldCount) after every stack.
One `_stock_dispose` row per targeted click (group, name, count, floor at the click, target, keeps and scaffold after).
Never a tool or a protected kind -- except the peaceful-world swords junkwell-02/peacefulkit already send to the well
(owner 10-07), which this change does not touch.

### 3.5 The floor is kept fresh, and CHEST PRUNING (owner 10-10)
- **Every outgoing mutation is a confirmed draw/take claim** (Claude P2-1, Codex 1): withdraw appends a `draw` claim per
  group it is about to take, confirmed, BEFORE its clicks; the post-transfer count releases it, or a dirty mark (window
  lost) leaves it live until the bot's next connection voids it (container unknown until recounted).
- **One freshness for both exits** (Claude P1-2): the town-deposit order's count step (3.7) also counts containers
  whose count of a group the bag holds surplus of is older than the floor's hour; so a full bag of a group at target by
  the 6 h ceiling but not by the 1 h floor gets the floor refreshed by the next town order, then the well disposes.
- **The prune order** (deterministic, after the well's orders, never the model's):
  - fires at town when a usable well stands, the bag has >= 2 free slots, the journal shows a town container whose
    1 h count holds a full stack of an A/B group with floor - outgoing - 64 >= target (or any stack of the well's junk
    list), within the bot's 10 min cooldown / 30 min backoff;
  - walks to it, opens it (count), takes at most min(4, free - 1) FULL stacks (64) by shift-click (no cursor), each
    under a confirmed take claim (junk-list stacks need no claim: target 0);
  - closes with the post-transfer count (releasing the takes), walks to the well and throws, for each name, as many
    FULL stacks as it took (a shift-click may fill the bag's own partial stacks first; the total it throws is exactly
    the total it took, so the bag ends with what it had); a per-click `_stock_prune` row. The quantity is the SERVER's
    bag delta at the close; every throw re-checks 3.4's keeps, the 64 scaffold and the available floor, and stops at
    the first that would be breached (a refused throw is recorded, not counted as pruned -- Codex r3 6, Claude r3 P3-5);
  - never a tool, a protected kind, a sapling, a station, food or iron; never below target; a stack it could not throw
    is ordinary bag surplus. Rate: <= 4 stacks per visit; a town at 5,000 logs drains in ~1-2 days of visits.

### 3.6 Withdraw (Claude P2-1/P2-3, Codex 4)
Room-making (roomCandidates, the swap, rearrangeFor) banks a targeted name only under an admitted bank claim (below
target, or `nowell`); every visit's takes are covered by draw claims (3.5). The usual relief for a full bag at a town at
target is the well (at-target surplus above the keeps). ACCEPTED RESIDUAL (Codex r3 4): a pickaxe-less bot whose 36
slots are ALL keeps and protected items cannot make room at a town at target (today it could bank its wood keep down to
8). It can craft a stone pickaxe only if its keeps hold cobblestone/cobbled_deepslate/blackstone, 2 sticks and a table
and craftroom's real room check admits it; the chain test runs that through the real selector and craftroom, and the
read reports pickaxe-less full-bag bot-hours (DiD) as a tripwire.

### 3.7 Unknown is reconciled deterministically (Codex 7)
The town-deposit order also fires (town, >= 34 slots) when the bag holds targeted surplus the town cannot judge for
the ceiling or the floor and such a container is outside its backoff; the skill counts up to 3 of them first
(reconcileCobble generalised), then plans.

### 3.8 Accepted exposure, stated (Codex 6)
This change adds NO cursor path: pruning and the bank claims' transfers are shift-clicks or mineflayer's own
transfer(); the town deposit's two-click moves, chest.deposit and withdraw's partial takes keep their existing,
separately reviewed disconnect exposure, unchanged.

## 4. Rotation (Codex 1-3, Claude P1-1/P1-2) -- no tail, no lock

Single host, local filesystem (the bots and their pool dirs live on 10.0.0.31).
- Generation 0 = `<key>.cobble.jsonl`; generation N >= 1 = `<key>.cobble.g<N>.jsonl` + SEAL `...g<N>.seal` (created
  `wx`: one rotator) + BASE `...g<N>.base.json`. Current generation = the highest sealed one.
- BASE N = the fold, PER WORLD, of base N-1 + generation N-1 up to its end when the base is computed (after the seal),
  with `seq`. Published once by link (EEXIST: the published one IS the base).
- A READER of N folds base N + generation N only. Records appended to N-1 after the base's cut are NEVER folded, so the
  fold is a pure function of a stable order (Claude's p2-tail probe: folding a growing tail re-decided an admitted claim
  and let the town reach 304/256).
- Why that is safe: by 3.0 every record that matters before a mutation is confirmed in the current generation; a writer
  whose confirm sees a move does not act. What a late record can lose is a post-mutation record -- conservative.
- A sealed generation without a base: any reader publishes it, or the town is UNKNOWN. A generation older than
  current that is gone: UNKNOWN, never empty. Checkpoints are per generation, deleted with it.
- Deletion: rotating to N+1 deletes every generation < N. Kept: N and N+1. A rotator stalled across two rotations may
  link a base nobody reads: harmless.
- Threshold 4 MB (~2 weeks of a town): never reached inside a canary window, so proven OFF-fleet: a multi-process stress
  test (threshold lowered, writers SIGKILLed mid-append, two rotators, Claude's straggler schedule during active
  appends) asserting no admitted bank exceeds its target, no take goes below it, and every reader decides every
  surviving claim alike; and a sandbox run with STOCK_ROTATE_BYTES lowered.

## 5. Remedy check (CLAUDE.md) -- chain tests through the real order selector

- At target with a well: banking stops; the well disposes at a full bag (floor refreshed by 3.7 when stale); the prune
  order drains the chests. Without a usable well: banking as today (3.2).
- Unknown: the town-deposit order counts first (3.7); out of town the refusal names "a deposit at town counts first".
- A full bag of keeps + protected + spare tools: the valve banks one spare tool (3.2); with no spare tool, the bag is
  today's town-deposit floor (its keeps are today's).
- No pickaxe + full bag of keeps: craft one from the keeps IF they hold a stone-tool material, sticks and a table and
  craftroom admits it (3.6); otherwise an ACCEPTED, UNRESOLVED residual, reported as such (pickaxe-less full-bag
  bot-hours), never counted as a recovery.
- Chain tests (cognitive's real selector): (a) 36 slots of at-target logs, floor stale -> count -> dispose; (b) 36 slots
  of keeps + 3 usable stone pickaxes, town at tool target -> valve; (c) no well + at-target logs -> bank; (d) no pickaxe
  + keeps -> craft.

## 6. Not solved here

- raw_copper (449/day banked, 7,356 stored, no consumer): an ore, never disposed; owner decision.
- Whether bots should USE town stock before gathering (cooperation; the roadmap's town-stock record).

## 7. Canary stocktarget-01 (class bag-fix, four pools)

Built ONLY on stonecap's well-coupled heads. One variable: the targets + pruning (cobble behaves as stonecap, except
its well disposal uses the floor rule shared by every group -- Claude P3-1).
- Licence: `_stock_bank`, `_stock_refuse`, `_stock_dispose`, `_stock_prune` (this build only).
- Gates (REVERT), each with a failing fixture in the read's self-test (G3 excepts exactly the `valve` claims that carry
  `nothing_else=1`; G3v: a valve claim without it, or more than one per visit, REVERTS): G1 a dispose/prune click of a protected kind or a
  tool (swords in a peaceful world excepted, as junkwell-02), of a group whose floor at the click was below target, or
  that breached a keep or the 64 scaffold; G1b (independent) at the read, the town's region census shows a pruned or
  disposed group below target after adding back the canary's quantified draws of it since; G2 a canary new chest
  without `_stock_recovery stage=place` carrying an admitted claim or an untargeted/nowell item, with the same action id
  as the placement; G3 an admitted non-`nowell` bank claim whose release-time group total exceeds its target (journal),
  or a `_stock_bank` row with complete=1 and town_after > target, no tolerance; G4 (Codex r4 3) a take whose
  admission, re-judged at its OWN place in the journal's order against the available floor, was not admissible, or
  whose server-verified quantity removed exceeded its claim -- release-time stock is NOT judged (a later draw is
  legitimate use); fixtures: a valid take followed by a draw and a delayed release (passes), an excessive take (fails).
- EXPOSURE, stated honestly (Claude P2-2): before the one-time clear the canary towns hold 1,000-5,000 of the capped
  groups, so banking near target, G1b, G3 and G4 have no exposure: they are reported UNTESTED, never "0 breaches". What
  the canary exercises: refusals at target, the well disposing at-target surplus, pruning far above target, the valve.
  Near-target behaviour is proven on Paper BEFORE the canary: a world seeded at target + one stack with two pruners, one
  withdraw and one depositor concurrently, measured against the known initial stock and the legitimate draws: no
  UNAUTHORISED INCREASE (a bank past the target) and no DESTRUCTIVE DECREASE (a prune or well throw that took the
  available floor below target); the scene must also show a successful admitted bank, a recovery chest under a claim
  and a prune, and each gate's failing fixture (Codex r3 5). The clear runs on the canary pools' towns first only if the
  operator chooses to read a second window.
- Liveness: canary `_stock_refuse` / `_stock_dispose` / `_stock_prune` rows. Positive controls: control deposit runs
  that banked a targeted group (~9,400 oak logs/day fleet-wide), control well visits, journal group totals, the census.
- Primary: bagread `slots_did` with this fix's own no-change band (bagnull under its draw filter). Reported: targeted
  banked/day DiD, chest-full failures DiD, full containers (census) before/after, pruned stacks/day, valve uses, nowell
  banking, rotation events (expected 0).

## 8. The one-time clear's caps (output)

The caps are the targets of section 2, as `scripts/host/chestclear2/plan2.py` reads them
(docs/reports/stocktarget-clear-caps-2026-10-10.json), applied to the 10-10 census with plan2's logic (largest stacks
kept first, the boundary stack REDUCED so exactly min(total, cap) stays; usable tools counted by copy; spent tools and
the well's junk removed): **175 -> 0 full containers; 5,958 of 7,988 slots freed; 195,462 items (668 by reducing a
boundary stack)** -- oak_log 79,116, cobblestone 69,378, stick 16,419, birch_log 9,792, oak_planks
6,315, bamboo 6,066, oak_sapling 3,394, stone_pickaxe 1,503 (+202 spent tools), torch 962, crafting_table 770. Kept
largest: raw_copper 7,356 (uncapped), cobblestone 4,096 (16 towns x 256), coal 3,367, iron_ingot 1,041. Class E is not
capped. bamboo 0 and bucket 2 (iron) are plan2's draft caps, listed for the OWNER to confirm: they are class E for
the bots (never banked differently, never disposed); the clear is the owner's one-time action, not the bots' rule.
cobblestone + cobbled_deepslate share the 256 as one group (`KEEP_GROUPS`; scripts/host/chestclear2/plan3.py reads it).
Inputs to reproduce: the census JSON (10.0.0.30:/tmp/cc2_census.json, copied to ~/mcai-analysis/cc2_census-20261010.json)
and plan3.py. Compared with plan2's draft caps (1,024 logs, 256 sticks, 32
stone pickaxes) these are tighter, because the measured town draw of bulk is zero; the clear runs only after this
canary is KEPT, so the bots stop refilling what it removes. The planner's `reduce` entries (668 items in boundary
stacks) need the clear tool to set a slot's count; that execution step must be validated on a sandbox before the clear
(Codex r4 5); a tool that cannot set counts keeps those stacks whole (a temporary overshoot of at most one stack).

## 9. Prior art (searched 10-08; unchanged)
MineColonies warehouse minimum stock / full-warehouse courier spam (#6284), consolidation stripping sites (#11421),
orphaned requests (#5395), whole-stack requests (#11385); Create: Colony Logistics per-item stock limits with overflow
shipped out; Create 6 factory-gauge promises; AE2 level emitters; Baritone acceptableThrowawayItems (#4217 deepslate);
mineflayer-collectblock, mindcraft discard (tosses at the feet: forbidden here), Voyager; mineflayer #1859 (deposit can
hang). Order-up-to S = demand x (lead + review) + safety. Raft snapshots / Kafka compaction / RocksDB WAL: snapshot with
its last offset, switch generations atomically, never delete what a reader still needs.

## 10. r1 findings and what changed (history: superseded where section 11/12 says so)

| finding | change |
|---|---|
| Codex 1/3, Claude P1-2: rotation could lose or double-apply records | (r2: tail folding -- SUPERSEDED in r3 by no tail + confirm-before-mutate); per-generation checkpoints; missing = unknown (4) |
| Codex 2: base republication, stale readers | base by link; old generations unknown; a late base is unread (4) |
| Codex 4, Claude P1-1/P2-1: withdraw banks without claims and leaves stale counts | withdraw never banks targeted names; post-transfer count or dirty (3.5, 3.6) |
| Codex 5, Claude P2-2: per-group 64 breaks the wood rung / strands bots | keeps = townKeeps + cobble 64 + STONE_GUARD + 64 scaffold (3.4) |
| Codex 6: recovery approval stale by craft/place | re-checked at entry, craft and place (3.3) |
| Codex 7: unknown has no deterministic remedy | town-deposit order reconciles (3.7) |
| Codex 8, Claude P2-4: gates blind | per-click rows; G3 no tolerance; G1b region census; G2 tripwire + control (7) |
| Codex 9: tie precedence | max for admission, min (`lo`) for the floor (3.1) |
| Codex 10, Claude P3-3/4: evidence | denominators restated; "no TOWN consumer"; dirt banked 236/day lands mostly outside the 16 shared towns' census (isolated pools, far chests) -- the 10-10 census includes isolated worlds |
| Claude P1-1: lb is not a floor | 1 h freshness, lo on ties, withdraw counts, live takes subtracted (3.5) |
| Claude P2-3: new standing targets enlarge the bank | class B = 0; only other log/planks types are new, 64 each |
| Claude P3-1: one well rule | the floor rule for every group, cobble included |
| Claude P3-2: reads must follow generations | stocktargetread folds generations and keeps its own copy of the window's journal |

## 11. r2 findings and what changed

| finding | change |
|---|---|
| Claude P1-1: tail folding re-decides claims (probe: 304/256) | no tail; confirm-before-mutate (3.0, 4) |
| Codex 1, Claude P2-1: withdraw's draw recorded after the clicks | confirmed draw claims before the clicks (3.5) |
| Codex 2, Claude P1-3: the admin clear leaves stale-high counts; cobbled_deepslate 0 | `reset` fence record + stockreset.py; cobble group 256 shared in the caps (3.1, 8) |
| Codex 3: late records across two generations | nothing that matters is written after the cut unconfirmed (3.0, 4) |
| Codex 4: dead ends (spare tools; no-well bootstrap) | the valve; no well -> no bulk cap (3.2); chain tests (5) |
| Codex 5: reserves differ by path | townKeeps + withdraw holds on deposit, town deposit and disposal (3.2, 3.4) |
| Codex 6: cursor exposure; swords | no new cursor path, exposure stated; the peaceful-sword path named (3.4, 3.8) |
| Codex 7: recovery check/action race | a confirmed bank claim on the site, held through craft and place (3.3) |
| Codex 8, Claude P3-3: count coverage; floor double subtraction | every group in `m`; absent = known 0; floor defined once (3.1) |
| Claude P1-2: 6 h ceiling vs 1 h floor strands a full bag | the count step refreshes floor-stale containers (3.5, 3.7) |
| Claude P2-2: near-target behaviour has no exposure | stated UNTESTED; Paper near-target scene before the canary (7) |
| Claude P2-3: withdraw cannot make room | room-making under a bank claim; craft from keeps (3.6) |
| Codex 9: gates | action ids, failing fixtures, untested reported (7) |
| Codex 10: arithmetic, inputs | ~1-2 days per 5,000 logs; inputs named (3.5, 8) |
| Claude P3-1: bamboo/bucket caps | marked for the owner (8) |
| Claude P3-2: bots holding the pruned name could not prune | full stacks; throw exactly the total taken (3.5) |

## 12. r3 findings and what changed

| finding | change |
|---|---|
| Codex 1: disposal used the floor before outgoing claims | the AVAILABLE floor (floor - takes - draws) for every disposal decision and throw; take/draw ordering stated (3.1) |
| Codex 2, Claude P2-1: the reset is not a handshake | hold -> wait for no live take/draw -> clear -> resume (drops counts through the clear) (3.1) |
| Codex 3: whole-stack clear planning cuts below the cap | plan3 keeps exactly min(total, cap), REDUCING the boundary stack (an `reduce` action) instead of deleting it (8) |
| Codex 4: the valve's three-copy threshold; craftability | today's tool rule decides the copy (two copies suffice); full-chest refusals reported; the keeps-only pickaxe case is an accepted residual with a real-craftroom chain test and a tripwire (3.2, 3.6) |
| Codex 5: G3 vs the valve; positive exposure | G3 excepts valve claims with nothing_else=1, G3v gates them; the Paper scene shows admitted bank, recovery, prune and failing fixtures; invariant stated as unauthorised increase / destructive decrease (7) |
| Codex 6, Claude P3-5: prune delivery | server bag delta; every throw re-checks keeps, scaffold, available floor; refusals recorded (3.5) |
| Claude P2-2: the recovery claim blocks its own chest | the first deposit transfers under it (3.3) |
| Claude P2-3: a re-appended releasing count overwrites a newer one | re-appended as releases + dirty mark (3.0) |
| Claude P3-1/2/3/4, Codex 7 | valve refusals reported; craftroom's real room check in the chain test; dirt wording; section 10 marked; targets stated as provisional initial budgets |

## 13. r4 findings (Codex) and what changed

| finding | change |
|---|---|
| 1: an older releasing count could restore stock a later draw removed | a releasing count older than the standing count releases its claim and marks the container UNKNOWN (3.1) |
| 2: the hold does not stop draws/banks during the clear | the clear runs with the pools' bots stopped; reset appended before they start (3.1) |
| 3: G4 judged release-time stock | G4 re-judges admission at its own place + verified quantity; fixtures (7) |
| 4: keeps-only case overstated | conditional, reported as an unresolved residual (5) |
| 5: totals, axes wording, reduce execution | 9,792 / 770; provisional budget wording; sandbox validation of `reduce` before the clear (2, 8) |

## 14. r5 finding (Codex) and what changed

| finding | change |
|---|---|
| 1: an EQUAL-time releasing count could restore withdrawn stock | equal captures are treated as older: release + dirty (3.1); equal-time depositor/withdraw and two-pruner schedules tested (stocktarget-journal.test.mjs) |
| 2, 3 (P3): residual visible; validation requirements retained | unchanged commitments: deterministic rotation schedules, Paper concurrency scene, controls, fixtures, boundary-reduction validation |
