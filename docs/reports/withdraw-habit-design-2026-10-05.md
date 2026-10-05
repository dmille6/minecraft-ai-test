# Getting bots to take things out of the chests: analysis and design (2026-10-05)

Owner question, 10-05 ~12:00Z: "how do we encourage our bots to actually withdraw items from chests, not only deposit?
Do our bots know what's in the chests? How do they find out? When they run low on pickaxes and don't have materials for
new pickaxes, can they be encouraged to check the chests?"

The owner then added three requirements. These are covered in sections 4 to 6.
- A fixed ladder for a bot with no pickaxe: go home, then a chest pickaxe, then chest ingredients, and gather only as
  a last resort.
- An answer on whether bots should take two pickaxes.
- A stock-driven priority: no pickaxe crafting when the chests are full of pickaxes, and production first when they
  are nearly empty.

This was a read-only analysis. No code was changed, nothing was deployed, nothing was written over RCON and nothing was
committed. Claude and Codex worked independently, two rounds each. Section 8 compares their answers.

**Sources.** Code is cited as file:line on three trees:
- **B**: the fleet, `1918bb5`.
- **W**: the withdraw branch, `origin/wd-on-6c9a8fb @ ed0d856`.
- **C**: the chest-full re-run, `origin/chest2-on-1918bb5 @ 47110e8`.

Telemetry covers the 24 h to 10-05 11:53Z: 1,242,723 skill rows and 80 bots. Files were loaded one bot at a time
through `lib/telemetry.Events`, rotation-aware and sorted by time. Bot-time is time-weighted, with gaps capped at 120 s.
"Usable" means more than 10 uses left (toolfor FLOOR). The decision stream, `llm-<bot>.jsonl`, is read separately:
158,864 decisions. Chest stock comes from the read-only census taken after the clear
(`docs/reports/census/census-after-clear-2026-10-04T1807Z.json`). "Town" there means containers within 16 blocks of
home horizontally and 12 vertically.

---

## The short answers

1. **Do bots know what is in the chests? No.** No part of the bot keeps, shares or shows chest contents.
   - The prompt mentions storage only as a reason to deposit.
   - Deposit opens chests every day and remembers nothing it saw.
   - The model's `withdraw` verb looks in only the nearest container within 48 blocks of the bot itself. A bot away
     from town therefore fails before it starts. All 9 withdraw runs in 24 h failed, at 39 to 272 blocks from home.
   - The model proposed `withdraw` 10 times in 158,821 proposals. It proposed `deposit` 8,910 times.
   - Craft advice tells a bot to "gather X first". It never says "take it from the chest".
2. **With withdraw deployed, a bot with no usable pickaxe would take one automatically,** at town, with no model
   decision needed.
   - It covers only a pickaxe, or the ingredients for one stone pickaxe. Nothing else.
   - It fires only when the bot is within 48 of home **and** within 16 blocks of a container. That describes just 10%
     of pickaxe-less bot-time.
   - Most pickaxe-less spells do pass through that zone, though: 67% of spells, holding 68% of the pickaxe-less hours,
     reach it at some point. So the built order could end up to ~227 of the ~334 pickaxe-less bot-hours per day,
     about a fifth of all bot-time, if it succeeds when the bot arrives.
   - Nothing brings a distant pickaxe-less bot home. 75 spells a day (50 bot-hours) never come near town.
3. **Best next steps, in order** (one change per canary; details in section 7):
   1. Ship the built withdraw, after rebasing it and making one small fix (section 2).
   2. Make recovery a saved stage that comes before ordinary work, and have a bot at town walk to the chests.
   3. Add the owner's walk home from 48 to 300 blocks, with time limits. A bot first crafts from its own bag if it can.
      The data says this step 0 matters: 163 of 281 spells start with the ingredients already in the bag.
   4. Add a town stock index that the bots fill in themselves. At first it only records.
   5. Use stock to steer: craft advice that names the chest, no pickaxe crafting when stock is high, production first
      when it is low.
   6. Then take-two, a prompt stock line, and general restocking.

---

## 1. Today on the fleet (1918bb5): what bots know about the chests

### Where knowledge could come from, and what each source actually gives

| Source | What it gives about chest CONTENTS | Evidence |
|---|---|---|
| System prompt | A fixed sentence: "A town stockpile chest sits at home… the town keeps torches in the stockpile chest." It names no item and no count. | B:prompt.mjs:296-301 |
| `CARRYING` observation | Appears only when a deposit is due. It says how far away storage is and tells the bot to "Use deposit". There is no matching observation for withdrawing. | B:prompt.mjs:598-621 |
| User prompt (every decision) | Task, inventory, what can be crafted now, nearby blocks (a chest is a *block* seen, not its contents), known places, recent events. **No storage contents.** | B:prompt.mjs:674-718 |
| Deposit opening a chest | It opens the window, moves its planned stacks and closes. It never reads `containerItems()` and records nothing. | B:skills.mjs:2516-2560 |
| `withdraw` opening a chest | It reads the contents of that one container, and only on failure does it mention up to 4 stacks. That text is short-lived (one LAST ACTION or event line) and in practice never appeared: 0 of 9 runs got as far as opening a chest. | B:skills.mjs:5360-5375 |
| World facts (shared file) | Hazards, goals that cannot be reached, resource sightings. No container contents. | B:worldfacts.mjs (header), no `chest` reference |
| Shadow mayor | Runs on the host and only observes. Its own plan says bank contents are "UNKNOWN, never 0". It has no way to send commands to bots. | docs/reports/shadow-mayor-plan-2026-10-03.md ("no chest ledger") |
| Affordance registry | Records the gap itself: withdraw has "no observation for 'the chest you own has something you need'". | B:affordances.json:87-90 |

### How `withdraw` is offered, and why it fails

- The verb appears in the usage list as `withdraw args: {"item", "count"} (takes from a chest or barrel within 48
  blocks)` (B:prompt.mjs:222). It is in the skill table (B:skills.mjs:8523).
- The implementation runs `bot.findBlock({... maxDistance: 48})`. The search is centred on **the bot**, and it gives
  up if no container is found (B:skills.mjs:5343-5349). It never walks home first, which deposit does
  (B:skills.mjs:2459-2486). It opens one container, the nearest, and does not try another.
- **Decision stream, 24 h:** 10 withdraw proposals out of 158,821 (0.006%), with **0 vetoed**. For comparison,
  deposit had 8,910.
  - 7 of the 10 were the model confusing withdraw with checking its own bag. Examples: "Check inventory for cobblestone",
    and an attempt to withdraw raw_iron.
  - 3 were real requests for a stone pickaxe from bots that had none.
- **Skill rows, 24 h:** 9 runs by 7 bots, **0 successes**.
  - 8 failed with "no chest or barrel within 48 blocks", 1 with "could not reach the chest".
  - At the moment of the attempt the bots were **39 to 272 blocks from home** (median about 110).
  - Positive control: the same query finds 2,217 deposit rows (522 success, 843 no_effect, 828 failed, 24 aborted).
  - (The coordinator's earlier figure, 10 attempts with 1 success, used a window ending at a different time.)

### What craft advice tells a bot that lacks ingredients

- It always says to gather: `cannot craft X -- gather Y first, nothing crafts it` (B:skills.mjs:3198). No branch looks
  at storage. W and C leave this unchanged (W:skills.mjs:3609, C:skills.mjs:3648).
- **24 h of pickaxe craft rows:**
  - Stone pickaxe: 573 successes, 2,863 failures. Wooden pickaxe: 208 successes, 1,385 failures.
  - Causes of failure:
    - **Full bag: 2,587** (817 of them at town). This is the biggest one.
    - "Gather cobblestone first": 984 (273 at town).
    - "Gather oak_log first": 486 (98 at town).
  - Every town that has a census holds sticks and logs. Most hold 256 cobblestone, but board-a and placebo-d hold
    none after the clear.

### How big the pickaxe problem is (this is who withdraw serves)

- **338.7 of 1,031.5 bot-hours (32.8%) have no usable pickaxe.** 78 of 80 bots had at least one such spell.
- **Where the bots are** while pickaxe-less, by distance from home:

  | Distance from home | Hours |
  |---|---|
  | 16 or less | 32.3 |
  | 16-48 | 70.7 |
  | 48-100 | 94.0 |
  | 100-300 | 117.7 |
  | over 300 | 23.9 |

- **What is in their bags:**
  - **32.5% of pickaxe-less time the bag already holds everything for a stone pickaxe.** 163 of 281 spells start
    that way.
  - 33.4% has no cobblestone but enough wood for a wooden pickaxe.
  - The rest lack wood, cobblestone, or both.
- **How full their bags are:**
  - 34 or more of 36 slots: 61% of pickaxe-less time.
  - 30 or more slots: 93% of it.
- **Their decisions:** pickaxe-less bots make 35.1% of all decisions. They propose gather 25,814 times, craft 9,984 and
  explore 9,554.
- **Spells of 5 minutes or more:** 281.
  - Length: median 56 min, p75 131, p90 296.
  - 286 of 317 spells (the broader count, which includes short ones) end with the bot getting a pickaxe, mostly by
    crafting one.

**What is in the town chests** (census after the clear, town zone only):
- **1,292 usable pickaxes:** 851 stone, 433 wooden, 8 iron. 717 of them are stone or better with 40+ uses left.
  - Stone-or-better copies per town range from **3 (hive-b)** and 16 (board-b) up to 119, 156 and 170 (board-c, board-d,
    board-a). Every town also has at least 17 usable pickaxes of some tier.
- Wood: 14,303 sticks, 6,784 planks, 43,649 logs.
- Cobblestone: 3,328.
- 2,050 torches, 165 spare chests, 415 iron ingots.
- Food: 308 bread and apples. Food does not matter here: on peaceful, hunger does not drop.

---

## 2. With withdraw (W) and chest-full (C) deployed: what bots will know and do

**What W adds** (W:withdrawpick.mjs, W:composter.mjs:553-583, W:cognitive.mjs:784-808, W:skills.mjs:6553-6640):
- **A town order, `withdraw_pick`.** It is fixed code with no model involvement. It fires when all of these hold:
  - the bag has no usable pickaxe;
  - the bot is **within 48 of home** (W:composter.mjs:558);
  - there is a **container within 16 blocks of the bot** (`STORAGE_NEAR`, W:cognitive.mjs:793, W:composter.mjs:167);
  - room can be made in the bag (`roomPlan`);
  - the town has no complete recent record that its containers hold no pickaxe;
  - the 5-minute cooldown and 15-minute backoff have passed.
- **What it takes.** It looks in up to 3 containers for the best usable pickaxe, preferring one with 40+ uses. Failing
  that, it takes the exact shortfall for **one stone pickaxe**: 3 cobblestone, 2 sticks, and 4 planks if no crafting
  table is near (W:withdrawpick.mjs:50-62). Every move is checked against the server's own record of the bag. What
  it took is protected from re-deposit for 10 minutes (W:withdrawpick.mjs:218). It never takes a worn-out tool.
- **A rebuilt `withdraw` verb for the model.** The item is now required, and the verb walks home first when no
  container is near and tries other containers (W:skills.mjs:6466-6531). The prompt line now says so
  (W:prompt.mjs:223).
- **One memory, which is not stock.** Each container records "no usable pickaxe seen here" for 15 minutes
  (`_pick_miss`, W:chestfull.mjs:254-274).

**What C adds:** each container in town remembers its last result (full, took, unavailable, unknown or unusable) with a
time and a backoff (C:chestfull.mjs:249-308). **It stores no quantities.** Its prompt changes only hide deposit advice
when the bank is closed.

**What they will know:** still no stock. A bot finds out what a chest holds only by opening it, and forgets afterwards.
The two exceptions are the pickaxe "miss" note and the full/took status.

**Needs covered:**

| Need | Covered? |
|---|---|
| Pickaxe | Yes, automatically |
| Ingredients for one stone pickaxe | Yes, automatically |
| Wood or sticks for other crafts | Only if the model names the item in the verb |
| Torches | Only if the model names the item in the verb |
| A chest | Not by withdraw. The chest-full recovery places a carried chest or **crafts** one while 165 sit in the banks. |
| Food | Not needed on peaceful |
| Anything else | Only if the model names the item in the verb |

**When it fires, and what brings a pickaxe-less bot to town:** only at town. **Nothing new brings a bot home.** Today
the first arrival in town during a pickaxe-less spell happens through:

| How the bot arrived | Spells |
|---|---|
| Already in town when the spell started | 89 |
| goto | 59 |
| explore | 22 |
| gather | 10 |
| home | 10 |
| deposit | 3 |

**How much of today's pickaxe-less time it could reach** (24 h, with container positions from the 10-04 census; chests
built since then are missing, so this slightly undercounts):

| Measure | Value |
|---|---|
| Pickaxe-less bot-hours | 338.0 |
| …within 48 of home | 103.1 (31%) |
| …and within 16 of a container, so the order could fire right then | **34.3 (10%)** |
| Spells (5 min or more) that become eligible at least once | 187 of 281 (**67%**) |
| Pickaxe-less hours after the first eligible moment (the most a perfect order could end) | **226.7 of 334.2 (68%)** |
| Spells that never come within 48 of home | 75 spells, 50.3 h; they start a median 168 blocks out (p25 104, p75 258) |
| Spells that start away and do reach town | first arrival after a median 14 min (p75 47) |

**Codex found a real gap, which I confirmed.** In the order's admission, a complete town-wide pickaxe miss blocks
**the whole order** (`!lazy(pickMiss)`, W:composter.mjs:580). That includes the ingredient fallback, which the run
itself was written to attempt "also when every container was a recent miss" (W:skills.mjs:6609-6610). So when no
pickaxe is in stock, the ingredient path is switched off for up to 15 minutes. That is harmless today, when every town
has at least 3 stone-or-better pickaxes, but it will bite as stock runs down. The fix is small and belongs inside
withdraw-01 before its canary: when pickMiss is true, issue the order for the ingredient path only.

---

## 3. Why bots do not withdraw: gaps, ranked

1. **The verb cannot reach the stock from where bots are.** Fixed in W.
2. **No observation tells the model to withdraw.** This is the same pattern deposit, swim and smelt each showed: a skill
   goes unused until an observation line names the situation. W skips the model for pickaxes (a fixed-code order),
   which is the right call for the most important need.
3. **Nothing sends a pickaxe-less bot home.** This is 32% of pickaxe-less hours: 107 h/day before the first eligible
   moment, 50 h of it in spells that never touch town.
4. **No stock index.** Without one there can be no stock-based advice, no prompt line, no stock-driven priority, and no
   way to know a town is empty without walking to it.
5. **Craft advice only ever says "gather".** About 371 pickaxe craft failures per day happen at town (273 "gather
   cobblestone first" and 98 "gather oak_log first"), while the chests hold the missing item.
6. **Full bags.** 61% of pickaxe-less time is at 34+ slots, and "inventory_full" is the top pickaxe craft failure. A
   withdrawn pickaxe needs **one** slot. Crafting needs room for the in-between items too. W makes room only by banking
   a whole stack that deposit would bank anyway, or by a swap.

---

## 4. The owner's ladder: home, then chest pickaxe, then chest ingredients, then gather

Both engines support the owner's order. Both also say plainly where the data pushes against it.

**Where the data argues otherwise.**
- **The bag often already has the ingredients.** 32.5% of pickaxe-less time, and 163 of 281 spells at their start,
  the bag **already holds everything for a stone pickaxe**. Crafting takes seconds. A round trip home costs minutes,
  and `home` succeeds in only 24-30% of calls.
- **What actually blocks those bots is a full bag.** inventory_full is the top pickaxe craft failure, and town is where
  room gets made.
- **So:** craft from the bag right away when that works. When it fails because the bag is full, that is a reason to go
  home. A forced long trip for a bot that is carrying its own fix is poorly supported (Codex says the same).
- **Most bags have no cobblestone.** That is 62% of pickaxe-less time, and a bot with no pickaxe cannot mine stone. So
  outside town, "gather" really means wood, then a wooden pickaxe, then cobblestone. It never means "mine stone with
  bare hands".

**Order priority is a design constraint (Codex, confirmed).** Milestone work orders are chosen before any town order
(`orderFor(readyFor(...))`, W:cognitive.mjs:767; town orders only `if (!order)`, W:cognitive.mjs:784). So a new town
rule cannot enforce the owner's order on its own. Recovery has to be a **saved stage** that ranks above ordinary
milestone orders and below survival reflexes, and that continues across decisions.

**The ladder** (each "-> next" is the remedy the bot can carry out from where it is, chosen by fixed code):

0. **Enter recovery** at the next idle decision when no carried pickaxe has more than 10 uses. If the bag can craft a
   stone pickaxe right now (ingredients, room, and a table in reach or carried), the existing pickaxe-rung order crafts
   it. Otherwise -> 1.
1. **Get to the chests.**
   - **48 or less from home:** walk to a known town container until within 16 blocks, then -> 2. This closes the gap
     where W today fires in only 33% of town time: within 48 of home but not within 16 of a container.
   - **48 to 300:** go home now (`restock_home`, the existing multi-leg `home` skill as a fixed-code order).
   - **Over 300:** only along a route that has worked before, otherwise -> 4. This band is 7% of pickaxe-less time and
     32 run-outs a day.
   - **Limits** (Codex's, which I adopt; they are starting values to test, not measured best values):
     - at most 120 s per return;
     - stop after 20 s without 4 blocks of progress;
     - one attempt per 15 min;
     - at most 240 s of returning per rolling hour.

     Reflexes interrupt the walk but do not reset its budget.
   - **Unreachable home:** -> 4 from where the bot stands. Back off 30 min before trying again.
   - **Night:** the server is `difficulty=peaceful` (scripts/provision-block2.sh:151), so night brings no hostile mobs
     and the walk is not delayed. Arriving home also puts the bot near its bed.
2. **Chest pickaxe** (W's `withdraw_pick`). Keep a checklist of the town's containers, not just one sweep of 3, within
   a 90 s chest budget. A container that was skipped, not opened or timed out counts as **unknown**. That is never
   proof the town is empty. If no pickaxe is found -> 3.
3. **Chest ingredients** (W, with the pickMiss fix): the exact shortfall for one stone pickaxe, then craft. If still
   short -> 4, gathering only the shortfall.
4. **Gather, the last resort:** craft from what is carried; else wood, then a wooden pickaxe, then cobblestone, then a
   stone pickaxe. If nothing is in reach, explore without tools, bounded to 30 s and 32 blocks. If the bot is truly
   sealed in, it reports `blocked` and checks again after 60 s or when its bag or surroundings change. It does not
   invent a remedy.

**Frequency and cost of the trip home** (24 h):
- **How often:** 731 pickaxes ran out. 490 of those were more than 48 from home: 214 at 48-100, 244 at 100-300, 32
  beyond 300. That is about 6 per bot per day, or about 30 per 5-bot pool per day.
- **Travel time:** a successful `home` covers a median 50 blocks in 22 s (about 2.3 blocks/s). That median comes only
  from the walks that worked (Codex's caveat). A trip of 168 blocks is about 75 s each way. 458 trips in the 48-300
  band, out and back, come to about 19 bot-hours a day if they succeed.
- **What it could save:** up to about 107 bot-hours a day.
- **Risk:** 366 `home` calls: 89 succeeded, 149 were interrupted, 51 travel_incomplete, 18 no_path, 17 path_budget, 7
  stranded. Over 48 h, pickaxe-less bots succeeded 92 of 310 times and bots with a pickaxe 116 of 485 (a hand-rolled
  grep; the snapshot is taken at the end of the walk). The canary has to watch the arrival rate.
- **Not chosen:** leaving for home before the last pickaxe breaks (for example at 20 uses or fewer). The data does not
  show pickaxe-less walks failing more often. If the canary shows bots stranded on the way, that becomes its own change.

---

## 5. Take two pickaxes instead of one?

**Both engines say: a second copy only in passing, never as a goal.**

The data runs against a blanket "take two":
- **Bots already carry spares.** 61% of the time bots hold a usable pickaxe, they carry two or more: 1 copy 272.5 h, 2
  copies 224.3 h, 3 copies 94.9 h, 4 or more 102.2 h. Deposit keeps one copy per tool name and banks the rest
  (B:bankable.mjs:150-176).
- **Bags are full.** 61% of pickaxe-less time the bag is at 34+ slots, and pickaxes do not stack.
- **Stock is uneven.** Town usable stone-or-better pickaxes range from 3 (hive-b) to 170 (board-a). Stone breaks run at
  about 340 a day across the fleet, roughly 21 per town.
- Codex adds: the wear rates do not show that a second copy makes outings longer or more productive.

**Rule (Codex's, plus a stock floor of mine).** Aim for **two usable carried copies in total**. Take a second copy only
during the same chest visit, and only if all of these hold:
- the copy has 40 or more uses;
- after checked room-making the bag still has **2 or more empty slots**;
- **at least one usable pickaxe stays in that container**;
- once the index exists, the town is not in the "short" band (section 6).

Each transfer is checked on its own, and a failed second take never undoes the first. Never travel or craft just for a
spare. Expected effect is small. It is a late canary.

---

## 6. Stock-driven priority: should the overseer direct production from stock?

**Both engines say yes, by stock, but as the bots' own fixed rules and not through the shadow mayor (for now).**
- The mayor has **no way to send commands to bots** and **cannot see chest contents** ("bank contents are UNKNOWN").
  It is **frozen until its 10-06 03:18Z decision**. Even if kept, giving it control of a duty needs its own owner gate.
- The decisions involved are craft admission, craft advice and the recovery stage, and the bots already make all of
  them. **One shared policy function** should feed all three (Codex).
- Once the stock index exists, the mayor can read it (read-only). That also ends its GET_IRON "unknown-bank" blind spot.
- Codex also suggests "one producer per town" when stock is low. That needs coordination between bots, which is a
  mayor-like duty, so it comes later.

### The rule

It counts **trip-grade pickaxes** banked in town: stone or better with 40+ uses. This is Codex's count, and it matches
oretunnel's MIN_TRIP_USES. Wooden and worn copies are counted separately.

| Band | Threshold, 5 residents | Behaviour |
|---|---|---|
| **Stocked** | **seen**: 2+ per resident bot (10+) | Within 48 of home only: craft admission refuses routine pickaxe crafting, **but only when a withdrawal it can actually carry out exists**. The refusal names the `withdraw_pick` order and issues it in the same decision. Craft advice says "take a stone_pickaxe from the town chest (N seen at x,z, M min ago)". Away from town, or on an emergency in recovery stage 4, crafting is always allowed. After a withdraw miss the refusal lifts for 15 min. The refusal chain is tested as a chain. |
| **Unknown or neutral** | anything else | Today's behaviour. **Unknown never vetoes and never assigns production.** |
| **Short** | under 1 per bot (under 5), established **by a complete recent check**, not by a sum | Production first. Craft advice prefers making a stone pickaxe, and at town spare usable copies beyond the second are banked. Bots hold 3+ copies 28% of their usable time, so this puts pickaxes back into circulation. Take-two is off. |

So 500 iron pickaxes stop production, and 2 make it a priority, as the owner put it. The census puts towns in these
bands as follows:
- **Short:** hive-b (3 trip-grade), once a complete check confirms it.
- **Stocked:** the other 15 towns, from board-b (11) to board-a (146). The bands are close: board-b is just over the
  line at 10, and hive-a (14), iso-c (17), hive-c and placebo-d (18) are not far above it.

The census was taken before any withdrawing, so these bands will move.

### The town stock index

**A measured limit that shapes the design: bots that only record what they happen to open will always have partial
coverage.**
- Deposit reached a chest roughly 1,365 times in 24 h (522 success plus 843 no_effect, which open the chest before
  deciding). That is about **3.6 opens per town per hour**.
- A town has a median of about 22 containers within 16 of home (range 11 to 37).
- So a 30-minute window sees about 2 containers, roughly 10% of the town.

**What follows from that:**
- "Seen N or more" is a sound positive claim, and that is enough for the **stocked** band.
- "The town has none" needs a **complete check**: W's per-container misses (`_pick_miss`) or the recovery checklist in
  section 4. A sum is never enough for that. This is why the **short** band is defined by a complete recent check.

**Disagreement on freshness.**
- Codex proposes 60 s for decisions and 5 min for routing hints.
- At 3.6 opens per town-hour, a 60 s window is empty nearly all the time, so the policy would almost never act.
- **I recommend 30 min for "seen" positives, and complete-check misses for negatives** (15 min, as W already does).
- A wrong "seen" costs at most one extra look. The withdraw itself checks with the server, and the miss memory and
  backoff limit repeats.
- **Owner decision**, below.

**Design (both engines agree on the substance):**
- **What is recorded.** On every open the bot makes for its own reasons, it records **absolute counts after the
  transfer**, not running totals of changes:
  - trip-grade, usable and spent pickaxes by tier;
  - sticks, planks, logs, cobblestone and its variants, iron ingots, torches, chests, crafting tables;
  - free slots.

  Each record carries the time, which bot observed it, and the world epoch. There is no polling and no extra trip.
- **Storage that cannot lose updates.** One file per writer, for example `/var/lib/mcai/_town-<world>/stock-<bot>.json`,
  written by atomic rename. Readers keep the newest observation per container. There is no shared read-modify-write,
  which fixes no-junk finding 4a.
  - Codex would go further, with per-container leases and version numbers. I do not think that is needed: no file has
    more than one writer, and stale highs are a fact of the world that a lease cannot fix.
  - The store is kept separate from the status memory, so `recordOutcome` cannot erase it (finding 4d).
- **Keying.** By world (the server), epoch, dimension, town, and the container's canonical position. **Never** by
  `memory.pool`, because isolated pools split one physical town (finding 5). Owner, please confirm that sharing within
  a world is fine now the memory experiment is retired.
  - **Double chests:** the partner half must be confirmed, or the record is unknown and left out of totals (finding 4c).
  - A removed container gets a tombstone.
- **Clears.** Any admin clear runbook bumps the epoch, which voids older observations (finding 4b). This is a file
  operation, not a change to the world.
- **What it may and may not do.** It may only send a bot to look. It never refuses a deposit, and it is never the stock
  of record.
- **How it is checked.** The read-only RCON census is used as **ground truth for the canary's accuracy check only**.
  Using it as a bot input would make it an admin oracle, which does not exist "in any Minecraft world". **Owner
  decision.**

---

## 7. Recommended sequence (one behavioural change per canary)

The current queue comes first: the junkwell-01 read, then chestfull-02 (47110e8) and the grid fix. W is built on
chestfull-01 (6c9a8fb), which was **reverted**. It must be **rebased onto whichever chest-full baseline is accepted**
before it is registered. Both engines flagged this. Stock canaries need a **whole physical town** inside the canary pool
(Codex), because the chests are shared and effects spill across bots.

| # | Canary | Change | Expected effect (measured upper bound) | Read: primary metric / gates / positive control |
|---|---|---|---|---|
| 1 | **withdraw-01** | W (ed0d856), rebased, plus the pickMiss fix | Ends pickaxe-less spells at the first eligible town moment: up to **227 bot-h/day** (68% of pickaxe-less hours) | `scripts/host/withdrawread.py` (on main). Primary: share of bot-time with a usable pickaxe, DiD; recoveries per eligible visit. Gates G1-G4 (items lost, spent tool taken, unconfirmed success, cursor closed while loaded). Positive control: control bots seen at town with no usable pickaxe, plus a server-recounted first-pick gain. |
| 2 | **recovery-01** | Ladder steps 0, 1 (48 or less only), 2 and 3 as a saved stage above milestone orders; walk to a container from within 48; container checklist | Lifts town eligibility from 10% toward the 31% of pickaxe-less time spent within 48 | Primary: pickaxe-less bot-hours at town, DiD; recovery latency; repeated craft refusals per spell. Positive control: a full-bag chain that ends with a usable pickaxe. |
| 3 | **restock-home-01** | Step 1 for 48 to 300 blocks, with Codex's budgets; unreachable leads to step 4 | Up to **~107 bot-h/day** more, minus about 19 bot-h/day of travel if trips succeed | Primary: away pickaxe-less bot-hours, DiD; travel seconds per recovery. Gates: arrival rate, stranded rows, deaths (two-death floor). Positive control: control-pool run-outs more than 48 from home (about 30 per day per pool). |
| 4 | **stockindex-01** | Index writes only, no behaviour change | None by design (instrument) | Index compared with a read-only RCON census of the canary town: coverage, age, count disagreement. Replayed clear, race and double-chest cases with mutants. Positive control: a non-empty container that was opened produces a matching record. |
| 5 | **stockcraft-01** | Stocked band: craft advice says "take X from the town chest", and admission suppression with a remedy that runs | Targets about 371 "gather first" failures at town per day and pickaxe crafts made while stock is high | Primary: crafts per high-stock opportunity, pickaxe-less hours, DiD. Gate: no stranded refusal (every refusal followed by a withdraw or an allowed craft within 10 min). Positive controls: high stock leading to a withdraw, and unknown stock leading to an allowed craft. |
| 6 | **lowstock-01** | Short band: production first, bank spares beyond 2 | Keeps stock from running out (hive-b today) | Primary: how long towns stay short; producer successes. Positive controls: low stock leading to production, and target reached leading to a stop. |
| 7 | **take2-01** | Section 5 rule | Small: fewer trips home | Primary: trips home per bot-hour, outing length, DiD. Tripwires: slot-pressure failures, a second copy taken without the first being kept. |
| 8 | **stockprompt-01** | `TOWN STOCK (seen N min ago): …` line, shown only when the bot lacks something the town has | Uncertain, depends on the model | Named withdraw proposals per exposed decision, and verified gains. Positive control: prompts that showed the line (decision stream). |
| 9 | **restock-general-01** | Fixed-code withdraw of exact recipe ingredients for other crafts; **a stored chest instead of crafting one** in the chest-full recovery (165 spare chests sit in the banks) | Unmeasured | Designed after 4 and 5 report. |

**What we would NOT build** (both engines):
- An LLM command overseer, or a mayor-directed duty, now.
- Fleet-wide totals steering local towns.
- Claims that a town is empty based on partial scans.
- Unlimited retries of the walk home.
- Unconditional collecting of spares.
- Exhaustive chest polling, or a delivery network.
- A blanket "withdraw more" sentence in the prompt.
- RCON stock as a bot input.
- Food withdrawal (peaceful).

---

## 8. Claude and Codex: where they agree and differ

**Round 1** (the original question):
- **Codex agrees on every fact in section 1.** The 48-block search is centred on the bot (Codex cited mineflayer's
  `findBlocks` docs for this). Deposit records nothing. Craft advice says only "gather". The mayor cannot see contents.
- **Codex found the pickMiss gap** (section 2). I confirmed it in the code.
- **One difference: the index before or after the trip home.** Codex ranked the index before the home trigger. The
  measurement favours putting home first: every town held stock at the census, so a trigger without an index loses
  little, while the index has no effect by itself. **Taken: home first.**

**Round 2** (the owner's three requirements, with the same measurements given to Codex):

| Topic | Agree | Differ, and which wins |
|---|---|---|
| Ladder | Chest first where practical; craft from the bag first; a bounded walk home; no delay at night on peaceful; never gather stone with bare hands; refusal chains end in an executable successor or an honest `blocked` | Codex split local recovery from the long trip home and pointed out that milestone orders come before town orders. Both adopted. Codex's budgets (120 s, 20 s without progress, 15 min, 240 s per hour) adopted. Distance limit: Codex 300 (over 300 only along a known route), mine 400. **Taken: 300.** |
| Take two | A second copy only in passing; it is secondary given 61% already carry 2+ and full bags | Codex's local rule is adopted, plus my town floor once the index exists. |
| Where priority lives | The bots' own fixed rules; the mayor stays observe-only and frozen | none |
| Index storage | Keyed by world, an epoch, double chests confirmed, unknown never zero, sums are not lower bounds, absolute observations | Codex: a transactional store with leases. Mine: one file per writer, newest wins. **Mine taken:** no file has more than one writer, so there is no lost update to prevent. |
| Freshness | — | Codex: 60 s for decisions. Mine: 30 min for positives, complete checks for negatives. **Mine, on a measurement:** at about 3.6 opens per town per hour, 60 s makes the policy almost never act. Owner decision. |
| Thresholds | Count trip-grade pickaxes (Codex); high 2 per bot, low 1 per bot | I first proposed 6 or more per bot using all usable tiers. **Codex's taken**, because trip-grade matches what an outing needs. |

---

## Owner decisions

1. **Ladder step 0:** let a bot craft from its own bag before walking home when it can. The data says yes: 163 of 281
   spells start with the ingredients in the bag. Your stated order would send these bots home first.
2. **The walk-home limit:** 48 to 300 blocks with Codex's time budgets, and only along a known route beyond 300.
3. **Take two:** only in passing, under the section 5 rule, late in the queue.
4. **Stock thresholds:** stocked at 2+ trip-grade pickaxes per resident bot, short below 1 (and only from a complete
   recent check).
5. **Freshness:** 30 min for "seen" (mine) or 60 s (Codex).
6. **Index scope:** share the index within a world, which includes the isolated-arm towns (the memory experiment is
   retired).
7. **RCON census:** a measuring tool only, never a bot input.
8. **Priority:** withdraw-01 must be rebased onto the accepted chest-full baseline, so it waits for the chestfull-02
   decision.

---

## Method notes (for anyone re-running this)

- **Scripts** are in the session scratchpad, copied to 10.0.0.31:/tmp:
  - `wdhabit.py`: pickaxe-less time, bands, bags, episodes, withdraw/deposit/craft rows.
  - `wdhabit2.py`: hours before and after the first town touch, what brought the bot, `home` outcomes.
  - `wdhabit3.py`: eligibility against census container positions.
  - `wdhabit4.py`: copies carried, bag fullness, where pickaxes run out.
  - `wdllm.py`: the decision stream.
  - `homepick.py`: `home` success by pickaxe, 48 h.

  The skill-row scripts use `lib.telemetry.Events.load` per bot file plus that day's rotated `.gz`. `wdllm.py` and
  `homepick.py` are plain JSON streams, because Events drops decision rows.
- **Positive controls:**
  - deposit rows, 2,217;
  - 80 of 80 bots with snapshots;
  - 1,242,723 rows walked, consistent with about 48k per hour;
  - pickaxe-less bots found at town: 75 of 78.
- **Known biases:**
  - The 10% eligibility uses 10-04 container positions, so newer chests are missed and eligibility is slightly
    undercounted.
  - "Episodes" are split at gaps of 10 minutes or more. Two passes split them slightly differently (317 versus 281 spells
    of 5 minutes or more).
  - Snapshots are taken at the end of each skill.
  - Slots are an estimate, and split stacks read low.
