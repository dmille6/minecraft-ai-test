# The town bank is write-only: 124,894 items in, 3 items out per day

_written 2026-09-27 15:42Z (date -u). Owner's question, asked twice: "with all the depositing in the town
chest, is anyone withdrawing and using the items in the chest?"_

**Answer: no. The fleet has banked 124,894 items and takes out three a day.**

---

## 1. THE BANK, counted by the worlds themselves

RCON read of every container within 6 blocks of each town, **slot by slot**, on all 16 worlds.

| group | worlds | containers | stacks | items |
|---|---|---|---|---|
| un-reseeded | 12 | 191 | 5,713 | **124,894** |
| reseeded today | 4 | 12 | 13 | 599 |

**Three positive controls, and the read needed all of them:**
1. **The first version of this read was WRONG by 17x** — it asked for the whole `Items` list and
   the GAME truncated the reply with a literal `...`, so it saw about the first stack of each
   chest and reported 7,274. The tell was exactly one stack per chest in all sixteen worlds.
   Reading slot by slot returns short, whole replies. **Truncation markers in the corrected run: 1.**
2. **The four worlds reseeded today hold 599 items** — 128x torch each, which is what
   `place-town.py` stamps into a new town. So the sweep is finding town chests and not something
   else, and a fresh bank really does start empty.
3. Containers found per world is printed, so a world with none is a failed search rather than an
   empty town. No world reported zero.

### What is locked up, across the twelve un-reseeded worlds
```
cobblestone  52,957      oak_sapling  3,900      coal           1,779
oak_log      16,383      raw_copper   3,809      sand           1,731
stick         6,859      oak_planks   3,782      torch          1,579
leaf_litter   6,270      birch_log    3,357      wheat_seeds    1,062
bamboo        5,539      stone_pickaxe  865      crafting_table   837
dirt          5,496      wooden_pickaxe 490                TOTAL 124,894
```
**1,355 pickaxes are sitting in chests.** So are 6,859 sticks, 3,782 planks and 16,383 logs.

## 2. THE FLOW, 24 h, 929,871 rows walked

| skill | rows | bots | successes |
|---|---|---|---|
| `deposit` | 3,997 | 74 | **269** |
| `withdraw` | 44 | 22 | **3** |

Positive control: both counts come from the SAME walk, so withdraw's 3 is not a query that sees
nothing. The three successes were 16x apple, 16x apple, 16x cobblestone.

**withdraw outcomes:** `nothing_found` 34 of 44 (77%), and the message is almost always the
literal **"no chest or barrel within 48 blocks"**.

## 3. WHY — and there are two causes, not one

### (a) SOURCE-VERIFIED: withdraw does not walk home, and deposit does
- `deposit` — `skills.mjs:2172-2189`: when `findChest()` (maxDistance 48) returns nothing it
  calls **`home(ctx, {}, signal)`**. Its own comment: *"The town chest lives at home, and a
  48-block scan cannot see it from a mine. Walking home first is the difference between 'deposit
  works near town' and 'deposit works'."* It deliberately uses `home` rather than `goto` to
  inherit retry across hazard interrupts, route repair below sea level, and no 16-leg ceiling.
- `withdraw` — `skills.mjs:3764-3770`: `findBlock(maxDistance: 48)`, and if nothing is found it
  returns **immediately** with `nothing_found` / "no chest or barrel within 48 blocks".

**The bank is reachable for writing and not for reading, and 77% of the measured failures are
exactly that.** The fleet uses 0.95% of a 1,950-radius world but ranges far enough that a
48-block scan misses town.

### (b) MEASURED: the model barely proposes it, and the prompt is not the reason
`withdraw` IS documented to the model — `prompt.mjs:222`:
`  withdraw args: {"item": "<item id>", "count": <integer>}  (takes from a chest or barrel within 48 blocks)`
and `prompt-usage-coverage.test.mjs` asserts every selectable skill has a line. The same block's
comment records the history: over ~200K decisions `build` was proposed **zero** times and
`withdraw` **25**, "which is what an undocumented affordance looks like from the outside" — it was
documented in response. It is now proposed 44 times in 24 h. **Documenting it moved it from
~0 to ~0.**

Note the prompt line promises only "within 48 blocks", which is accurate today and is the thing
§3(a) would change. **If withdraw gains homing, that line must change with it, or the prompt
becomes a false affordance in the other direction.**

## 4. THE CONSEQUENCE, and this is the part that costs the endpoint

**3,118 craft failures in 24 h** (of 4,129 craft rows; 662 succeeded). The ingredients named as
missing:
```
iron_ingot 319    oak_planks 131    stick 25    birch_planks 8
```
Real failure details, quoted:
- `cannot craft stone_pickaxe -- needs 2x stick (you have 0x stick, **9x stone_pickaxe**, 50x cobblestone, ...)`
- `cannot craft crafting_table -- needs 4x oak_planks (you have 0x oak_planks, 0x crafting_table, ...)`
- `cannot craft stick -- needs 2x oak_planks (you have 0x oak_planks, 2x stick, ...)`

**The chest holds 6,859 sticks and 3,782 oak_planks.** A bot fails to craft a pickaxe for want of
two sticks while carrying nine finished pickaxes, 48 blocks from six thousand sticks.

(Parse caveat, stated: the missing-ingredient tally above comes from a regex over the detail
string and it also produced fragments — "hin" 26, "nts" 21, "table" 21 — so treat the ranking as
sound and the exact counts as approximate. The quoted details are verbatim.)

---

## 5. WHAT I PROPOSE TO BUILD — attack all three

**A. Give `withdraw` the homing `deposit` already has.** When no container is within 48 blocks,
call `home()` and re-scan, exactly as `deposit` does, reusing the same code path. Update the
prompt line in the same commit so the advertised affordance stays true.

**B. Record what the chest holds, every time a bot opens one.** Both `deposit` and `withdraw`
already call `bot.openContainer()` and `containerItems()`, so the full contents are in hand and
thrown away. Persist a per-pool bank manifest, so a bot can KNOW there are sticks at home instead
of guessing. Today nothing in the craft path can see inside a chest.

**C. A deterministic WITHDRAW OBLIGATION when the craft ladder is blocked on a banked ingredient.**
The planting obligation shipped today proves this path: a deterministic work order bypasses the
model entirely and landed **1,033 of 1,034** placements. If `readyFor` reports the rung is blocked
on `stick` and the bank manifest says the town chest holds sticks, issue `withdraw stick` rather
than hoping the model proposes it.

## 6. WHAT I WANT YOU TO DESTROY

1. **Is A alone enough, or is it inert without C?** A fixes the 77% that fail on distance, but only
   44 attempts are made. 34 x fixed is still ~34/day against 3,118 craft failures. **Rank A, B and C
   by what each is worth alone, and say plainly if A is cosmetic without C.**
2. **B is a new persisted store.** This project has been burned by stores: `learned_avoid`
   blacklisted the ladder on 70 of 80 bots, place-scoping wiped hive rules, hive stores accumulate
   everything. **What is the failure mode of a stale bank manifest?** A bot that believes in sticks
   that another bot took is worse than a bot that knows nothing — or is it, given withdraw fails
   cheaply?
3. **C spends a decision, and decisions are the scarce resource** (41/bot-h measured). What is the
   right cap, and what is the right precedence against the planting obligation and the craft rung?
4. **Is the deposit side itself wrong?** 52,957 cobblestone banked while the deposit reserve exists
   precisely because bots need cobblestone to bridge with. Should the fix be to bank LESS rather
   than withdraw more? Say which has the better ratio of endpoint movement to risk.
5. **iron_ingot is the top missing ingredient (319) and the chests hold 28.** So the bank cannot
   solve iron; iron is a depth problem. Does that change the ranking of this whole line of work
   against the iron wall?
6. **What must NOT be done.**

## Rules
- Every negative claim carries a positive control. `file:line` for everything.
- Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: the single most valuable change, and the one query that would show within
  6 hours whether it worked.
