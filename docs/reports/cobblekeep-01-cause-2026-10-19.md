# cobblekeep-01 — why bots keep their cobble (2026-10-19)

OWNER 10-19 ~12:15Z: "yes do that" — find why bots keep their cobble, and fix it. Setting -> fast path; behaviour -> canary.
**Verdict: a BEHAVIOUR change (three small rules), not a setting. Normal canary.** Fleet adbec4f4.

## 1. The cause, from rows (ES, 24 h to 10-19 ~12:15Z; positive controls and denominators first)

Window: 1,497,080 skill rows, 80 bots. `town_deposit` 613 rows (positive control for the join: 609 of them have a
`_stock_refused via=town_deposit` row from the same bot within 60 s; `_stock_refused` 6,244 rows in all).

**What each town deposit refused its cobble for** (the refusal row names the rule; none names a plinth or a reserve):

| refusal | visits | median cobble held | pools |
|---|---|---|---|
| `cobble_unknown` (a town container has no fresh count) | 446 (391 no_effect + 55 that banked something else) | 788 | board-a 62, hive-c 88, placebo-b 125, placebo-c 88, isolated-a/-c 67 |
| `cobble_cap` (the town at its 1000) | 163 (90 + 73) | 405 | board-b/c/d, hive-a/b/d, placebo-a/d, isolated-b/d |
| cobble banked or <= 64 held | 4 | 342 | — |

**The hypothesis (plinth funding) is refuted**: `plinthBudget` spends bag cobble above STONE_GUARD 64, it reserves
none; `townKeeps` keeps the stone family to min(held, 64); no refusal row names a plinth keep. COBBLE_RESERVE is 64.

### 1a. UNKNOWN towns: a lid the bot will not clear (dirt) or wrongly calls a lid (leaves)

`_lid_clear` 60 h: 4,200 rows, **3,774 lid=dirt, 422 lid=oak_leaves, 4 cobblestone (all 4 dug)**; every dirt/leaves row
`refused` ("dirt is not a block a bot may break off a lid" — lidclear-01 breaks cobble only, by design until the row
named a new blocker). The town journals (read-only fold of a copy of `/var/lib/mcai/_pool-*/town-chest-*.cobble*`,
12:15Z) show each UNKNOWN town's stale container is a refused-lid key: board-a 353,72,146 (dirt, last count 50.5 h),
hive-c -66,61,-74/-75 (dirt, 36 h), placebo-b 282,64,-388 (dirt, 68 h) and 284,65,-389 (oak_leaves, 30.6 h), placebo-c
355,72,149 (dirt, 60 h), placebo-d 177,74,73 (dirt, 36 h), isolated-a 356,74,148 (dirt), isolated-c 357,72,147 and
358,72,148 (dirt). `count_town` 24 h: lid_blocked on 456 of the recount rows in board-a/hive-c/placebo-b/placebo-c.
Leaves never stop a chest opening on the server (vanilla: never a redstone conductor) — confirmed on Paper below.

### 1b. AT-CAP towns: the bank and the well both refuse (a band with no legal move)

The bank refuses a stack at the cap on the 6 h counts (`lb + reserved + stack > 1000`). The well (stonecap-01's switch,
skills.mjs cobbleWellCap) threw cobble only when the **1 h floor** held 1000. The floor counts only containers opened in
the last hour, so a 13-30 container town reads far below its count: at 12:15Z lb/floor were board-b 1000/943, board-c
1000/386, board-d 981/347, hive-a 999/733, hive-b 1000/501, hive-d 1000/979, placebo-a 1000/893, placebo-d 1000/133,
placebo-b 969/0. And a town filled to within one stack (hive-a 999, board-d 981, isolated-d 999) can take no whole stack.
`_well_dispose` 24 h: 232 rows; cap=unknown 116, below 80, none 3 -> **0 cobble**; at_cap 33 -> 9,738 cobble.

### 1c. Bags (latest snapshot per bot, 80 bots)

Cobble+deepslate held: sum 33,477, mean 418, p10 67, p25 130, median 366, p75 669, p90 906, max 1,133; 74 of 80 hold more
than the 64 reserve, 51 more than 256. By mechanism: UNKNOWN pools (30 bots) 17.4 k (~579/bot); AT-CAP pools (50 bots)
16.1 k (~322/bot). Fixing 1a alone frees little: those towns are within 31-723 of the cap (~1.7 k room in all), so they
then hit 1b. Coordinator's addition (10-19): "everything carried is kept" refusals 88 -> 187 / 12 h; median cobble at a
refused deposit 399 (10-15) -> 815; 41/80 bots >= 34 slots. The 8 bots behind 624 of 887 full-bag craft failures are in
hive-a (1b), hive-c, placebo-b, placebo-c (1a) — the same towns.

## 2. The fix (built on adbec4f4; three rules, no constant changed)

1. `lidrule.mjs LID_BREAKABLE` adds `dirt` and `grass_block` (lit dirt turns to grass). Everything else about the clear is
   lidclear-01's: never the well, never beside water/lava/waterlogged, never under a falling block, unknown refuses.
2. `lidrule.mjs chestLidBlocked`: leaves and glass (LID_OPENS, the two measured on Paper) are not a lid; the bot opens,
   the open is the proof (a chest that still does not open fails as any unopenable container). The other vanilla
   never-conductors (observer, piston, redstone_block, copper grate) stay lids to the bot (r2, Claude r1 P3).
3. `cobblecap.mjs wellCobbleSwitch` (pure; `skills.mjs cobbleWellCap` calls it): `at_cap` when the floor holds the cap
   (unchanged) OR when **the bank's own admission refuses the smallest surplus stack at the cap on counted stock** —
   cobbleAdmit over the 6 h counts **taking the smaller of two equal captures** (`lbLo`; r2, Codex r1 P1: `lb` keeps the
   larger for admission and must never authorise destroying anything) less outgoing takes, with **no incoming
   reservation** (stonecap's Codex r1 P1 stands). A withdraw hold on cobble (plinth funds, a smeltjob) returns `held`:
   never thrown (the bank's own rule: a hold holds every stack of the name, for its 10 min). **At town only:** the room
   order's guess from afar (`townWellTakes`, which sends a bot home) keeps stonecap's floor-only rule (`floorOnly`; r2,
   Claude r1 P1-1), so this change adds no trip home.

**Not changed:** COBBLE_RESERVE / COBBLE_WELL_RESERVE / STONE_GUARD 64 (the exit contract's iron-depth descent needs 59);
the 1000 cap; the bank's admission. Plinths still fund: plinth-02 withdraws from town chests (now openable), and a
withdrawn cobble stack is held from the well. No new refusal is added; two dead ends are removed.

Known edge (Claude r1 P3): a plant or door standing on a dirt/grass lid pops when the lid is dug; nothing structural.

**Not in this change (would split):** a deterministic go-home-and-deposit for roaming full bags. The two dead ends here
are AT TOWN (the deposit and the well run there already); a roaming trigger is a separate behaviour with its own
travel/death risk and its own read.

## 2b. PART 2 — coal and iron get banked in town (owner scope addition, 10-19 ~14:10Z)

**The cause:** `townKeeps` kept every unit of `IRON_LADDER` (raw/ingot/nugget/ore, coal, charcoal) for good, so the town
deposit never banked any (coordinator, 24 h: 484 town smelt jobs stopped "no coal in town", a townmate carrying coal at
69%; 253 toolkit "no iron" refusals, a townmate carrying >= 3 ingots at 77%).
**The bags (10-19, 80 latest snapshots):** coal 89 (23 bots), raw iron 26 (14 bots), ingots 124 — **1 to 3 per bot, 34 bots
at exactly 3, never more**; 79 hold a bucket, 21 a usable iron pickaxe.
**The rule (towndeposit.mjs `ironKeeps`, pure):** keep 3 iron units for EACH iron craft the bag has not made (bucket, iron
pickaxe; counted as their rungs count them), never fewer than 3 (the gather rung's number) — r4, Claude r3 P1-1: a flat 3
banked the raw iron of a bot lacking both, which then crafted the bucket and went back underground for the pickaxe's iron.
Ingots first, then raw iron, then ore, each NAME whole (the town deposit moves whole stacks only). Coal/charcoal (the
first name, whole) stay while the bot keeps something of its OWN to smelt: the raw iron/ore kept, or the active rung's
wanted smelt (glass -> sand; never wood) — r4, Codex r3 P2: 8 sand for wanted glass had lost all its coal. The kept wood
is not counted as the alternative fuel (it is the stockpile rungs'). Everything else banks. Away from town the room
order still keeps 16 coal (a different exit); a raw-iron smelt with no coal may burn a few kept planks, as before.
**What it moves (r4 rule, 10-19 ~14:40Z snapshot):** coal 93 held -> 89 bankable (22 bots); raw iron 25 -> 21 (11 bots);
**no ingot** — every ingot in a bag today is that bot's next craft (79 of 80 hold a bucket, so their 1-3 ingots are the
pickaxe's), so the towns' ingot shortage cannot be met from bags without starving a rung. Banked raw iron becomes
available IN TOWN, but this change supplies no automatic conversion to toolkit ingots (Codex r4 P3: the town smelt job,
smeltjob.mjs, smelts raw COPPER only); the coal it banks is what those copper jobs stop for. (A bot holding both still keeps 3, or the gather rung re-opens and sends it mining:
a ladder decision, not this one.) Nuggets and charcoal are not on the bank's list (bankable.mjs). Exposure: the canary
pool must hold bots carrying coal or raw iron (22 and 11 of 80 bots, spread across pools) — reported, not drawn on.
**Not a setting:** the keep is new logic (whole names, ordering, the smelt condition), not a number.

## 3. Evidence

- `npm test` (runner) — see the commit; `cobblekeep.test.mjs` 17 (pure rules, count_town chains on dirt/grass/leaves/
  planks lids through the real skill, the switch on a counted town, 8 anchored mutants); `towndeposit.test.mjs` +3 (the
  deposit -> well chain through the REAL town_deposit: refused at the cap -> the well's switch at_cap -> its plan takes
  the surplus to 64; control: room -> the deposit banks; mutant: stonecap's switch says below); `well.test.mjs` band test
  rewritten (984 + 30 now at_cap; 936 + 64 on its way still not).
- eslint no-undef: one hit, the pre-existing reflex.mjs:2384 withinBody.
- **Paper sandbox3, 10-19 12:35-13:10Z** (stock-e2e.cjs; base = adbec4f4 archive, candidate = 7f5a367b archive; RCON read back):
  - `liddirt` BASE: count_town `fails=lid_blocked:1`, `_lid_clear refused lid=dirt`, lid still dirt, no journal count.
    CANDIDATE: `_lid_clear outcome=dug lid=dirt tool=hand dig_ms=750`, `_dig_town purpose=lid outcome=confirmed`, lid AIR,
    chest unchanged (20 oak), `count_town counted=1 unknown_after=0`, a journal count.
  - `lidleaves` BASE: refused lid=oak_leaves, no count. CANDIDATE: no lid row, no dig, the SERVER opened the chest under
    oak_leaves[persistent=true] (leaves still there), counted=1 unknown_after=0.
  - `lidglass` (r2) BASE: refused lid=glass, lid_blocked, no count. CANDIDATE 38ab9077: the chest under glass opened and
    counted, no dig.
  - r2 re-run of every scene on 38ab9077 (13:29-13:34Z): lidglass, liddirt, lidleaves, cobbleband all CANDIDATE_PASS.
  - `cobbleband` (after `build`, PLINTH_FIRST=0 for the natural well in both runs): chest 984 cobble, bag 36 slots
    (30 + 34x64 + a pickaxe). BASE: counted 984, then 240 s idle at 36/36, no dispose, shaft 0. CANDIDATE: counted 984,
    `dispose_well -> success` 36 -> 27 slots, `_well_dispose cobble=576 cap=at_cap`, shaft census 576 in / 0 out, chest
    984 unchanged, bag 1,630 cobble left.
- Coal/iron (add98da8): towndeposit.test.mjs pure keep table (+ the gather rung never un-done); the REAL town deposit,
  positive (3 ingots / 5 raw / 7 coal -> raw and coal banked, ingots stay) and negative (1 / 2 / 4 -> none of it moves,
  the logs do); an anchored mutant restoring the old keep; the PROPERTY test (400 random full bags) green. Paper
  sandbox3 `ironbank` 14:00Z (add98da8): BASE no town deposit at all, nothing banked; CANDIDATE `banked coal:7,raw_iron:5`,
  chest raw_iron 5 / coal 7 by RCON, bag keeps 3 ingots. r4: the scene's bag now holds a bucket (one craft left), re-run below.
- r4 tests: the IRON SEQUENCE through the real town deposit (no bucket, no pickaxe: deposit, craft the bucket, deposit
  -> the pickaxe's 5 raw iron and 7 coal still in the bag; gather/smelt/pickaxe means intact) + anchored mutant (flat 3);
  the FUEL CHAIN (wanted glass keeps its coal for 8 sand; a rung that smelts nothing banks it).
- Read `scripts/host/cobblekeepread.py` (`--selftest` passes; dry run 10-19 on the base fleet, placebo-b,hive-a as a
  pretend canary, 180 min, 370,476 rows: bag cobble DiD -7.5 on identical code, refusal DiDs +0.28 / +0.14 /bot-h,
  instrument ok, exposure READY 88, licence 0, control rows 0).
