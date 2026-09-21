# 81% of the fleet cannot mine, and three correct policies are why

2026-09-21, measured on the live fleet (80 bots, `cfc1c58`, one version). Found
while reading the wreckage of `needsdrop-01`, which was aimed at the wrong thing.

## The number

**65 of 80 bots (81%) carry only dead pickaxes** — every pickaxe they own worn to
**1 durability** out of 131 (stone) or 59 (wooden). They hold **230 dead pickaxes
between them, 3.5 per starved bot, up to 8 each.**

A bot in this state cannot mine stone. Not "mines slowly" — cannot.

## Why a dead pickaxe stops the bot, in three correct steps

1. **`toolFor` reserves it.** `eligible = tools.filter(canHarvest && remaining(it) > HARD_STOP)`.
   Every pickaxe is below the floor, so nothing is eligible and it returns
   `{ item: null }`. This is the iron-retention policy working as designed —
   16 iron pickaxes were destroyed in two days before it existed.
2. **`applyToolPolicy` puts dirt in the hand.** `if (!d.item && isTool(bot.heldItem))`
   it equips a *filler* — a non-tool — specifically to stop the held tool being
   worn down. Also correct, and the comment records that a blind `unequip` used to
   throw the stack on the floor.
3. **`watchDigging` cancels the dig.** `gather` does `const tool = bestTool(...);
   if (tool) await bot.equip(...)` — `tool` is `null`, so nothing is equipped — and
   three lines later the dig is watched with `needsDrop: true`. The watchdog asks
   whether **dirt** can harvest stone, gets `false`, and calls `stopDigging()` at
   its first 1-second poll.

Each step is right on its own. Together they are a bot standing in front of stone
it will never break, and the only thing the logs say is `Digging aborted`.

**Measured: 386 of 392 watchDigging cancels (98.5%) happened with every pickaxe at
≤10 durability.** Only 6 happened with a usable tool.

## This corrects a claim I made yesterday and repeated today

I reported, from the `dig_collision` recorder, that **"682 of 682 cancels had a
harvesting pickaxe in the bot's inventory — the remedy was in its pocket."**

That check tested only whether an item named `*pickaxe` **existed**. It never read
durability. The pocket held three stone pickaxes at 1/131. **The remedy was not in
the pocket**, and the framing that it was is what sent `needsdrop-01` after the
watchdog's *arming* instead of the fleet's *tools*.

## The deadlock

Of the 65 starved bots, what are they missing?

| | n | share |
|---|---:|---:|
| have wood, **no cobblestone** | 31 | 48% |
| have neither | 14 | 22% |
| have cobblestone, **no wood** | 11 | 17% |
| **have both and are not crafting** | 6 | 9% |
| have both but need the craft chain | 3 | 5% |

51 of the 65 hold **no log at all**.

A stone pickaxe is 3 cobblestone + 2 sticks. **No pickaxe → cannot mine stone →
no cobblestone → cannot craft a pickaxe.** That is 48% of the starved population
sitting in a closed loop, and examples are stark: `board-a-Echo` holds **243
cobblestone and 0 sticks**; `board-b-Bravo` holds **14 sticks and 0 cobblestone**.

**The escape is a WOODEN pickaxe**, which needs 3 planks + 2 sticks and no stone at
all.

### The avoid-rule hypothesis is REFUTED, and the bots are trying

`learned-avoid-blacklists-the-ladder` records 70 of 80 bots once forbidden to craft
a wooden pickaxe. That is **stale**: a full walk finds **no avoid or veto event kind
at all**. Positive control for that zero — the only `*refused` kinds present are
`canopy_drop_refused`, `explore_blind_step_refused`, `maroon_climb_refused`,
`maroon_dig_refused`. Nothing is blacklisting the craft.

The bots are trying and failing: **875 failed crafts against 150 successes in 6 h**,
with explicit reasons.

### What the failures actually say, including where I over-read them

My first reading was that the resolver demands a specific material variant —
`cannot craft stone_pickaxe -- gather cobbled_deepslate ... (you have 0x
cobbled_deepslate)` on a bot holding 56 andesite, and `crafting_table -- gather
oak_log` on a bot holding 5 other wood. That is the known
`wrong-wood-blocks-the-craft-tree` defect and it is real.

**But it is 19%, not the story.** Of 718 craft failures naming a missing material:

| | n | share |
|---|---:|---:|
| genuinely lacks the material | 578 | **81%** |
| holds an equivalent the resolver will not take | 140 | 19% |

So the variant mismatch is worth fixing — 140 wasted attempts in six hours — but it
is not what is holding the fleet. **81% genuinely have nothing to craft with.**

### The root is wood, not stone

51 of the 65 starved bots hold **no log at all**. Wood is the entry point: logs make
planks, planks make sticks, planks + sticks make a wooden pickaxe, and a wooden
pickaxe makes cobblestone possible. **Nothing in that chain needs a pickaxe to
start.** Oak logs carry no harvest-tool requirement.

So the real question is not why bots cannot craft — it is **why 51 of 65 tool-starved
bots have failed to acquire a single log**, when that is the one thing they can do
bare-handed.

### And that question has an answer: wood gathering succeeds one time in ten

Measured over 6 h, gather runs targeting wood:

| | runs | success |
|---|---:|---:|
| tool-starved bots | 3,208 | **10.8%** |
| bots with working tools | 601 | **9.7%** |

**The rates are the same.** Tool starvation does not cause the wood failure — wood
fails identically for bots that have perfectly good pickaxes. (The starved bots make
5x more attempts, which is the system trying: they need wood and keep going for it.)

Where those attempts die:

| failure class | starved | share |
|---|---:|---:|
| `unreachable` | 1,238 | 39% |
| `no_safe_target` | 1,071 | 33% |
| `nothing_found` | 286 | 9% |
| `no_path` | 225 | 7% |
| `collect_budget` | 40 | 1% |

**72% is `unreachable` + `no_safe_target`** — the bot can see the log and either
cannot reach it or will not approach it. The same shape holds for the healthy bots.

## The whole chain, in order

1. Wood gather succeeds **~10%** of the time; 72% of the failures are reachability
   or safety refusals.
2. No wood → no planks, no sticks → **no wooden pickaxe**.
3. No pickaxe → cannot mine stone → **no cobblestone** → no stone pickaxe.
4. Every pickaxe wears to 1 durability and is never replaced: **230 dead pickaxes,
   81% of the fleet**.
5. Tool starvation then silently blocks stone mining through the three-policy
   composition at the top of this report, and the only trace is `Digging aborted`.

**Step 1 is the root and everything below it is downstream.** This is queue item 3
(navigation/gather), which both review engines independently ranked as the top
substantive item, and it is where the next canary belongs — not at the watchdog,
and not at the tool policy.

It is also the honest frame for `leaf-01`, which attacked `unreachable` directly:
it halved that class (29.0% → 13.1%) and the freed attempts became `no_safe_target`
(+15 pp) and `no_path` (+6.4 pp) rather than successes. The refusals move around;
the 10% does not. Any next attempt has to beat that, and has to be read on
**acquired wood**, not on refusals avoided.

**And 6 bots have both inputs right now and are not crafting.** Whatever stops
those six is not a materials problem and is worth reading on its own.

## Why this matters more than anything currently queued

Gather success is the only failing committed metric and the 27 Sep gate is ≥40%
against a fleet at ~23%. The seed canary's re-seeded pools read **42.7%** — and a
reseed resets bot state, which includes handing the bots working tools. That is a
rival explanation for the entire +29 pp seed effect that the seed registration's
"reseed-plus-reset confound" names but nobody had quantified.

So before reading the fresh-terrain result as terrain, this has to be ruled out:
**were the re-seeded pools simply the only bots with working pickaxes?**

## What NOT to do

Do not raise `HARD_STOP`, and do not disarm `watchDigging`. Both would let bots
grind their last pickaxe to dust on stone, which is the behaviour the
iron-retention work removed on evidence. The composition is the bug, not any of
its three parts. The remedy has to be that a tool-starved bot **crafts**, and the
refusal has to name a remedy it can perform from where it stands — the rule this
is a textbook instance of.

## Instrument note

`bot.tools` carries `used`/`max` per tool and per slot. Every claim above is read
from it. Any future "the bot had a tool" statement must read durability, because
"owns an item named pickaxe" and "owns a pickaxe the tool policy will use" are
different claims and I conflated them for two days.

---

# Addendum, same day: the bots spend the wood before they can craft with it

The chain above ends at "wood gather succeeds 10%". That is true and it is not the
whole story, because the wood they DO get does not stay.

## Wood in, wood out — 6 h, fleet-wide

Acquired **2,005** wood-family items (logs, planks, sticks); spent or lost **1,690**.
Split by the skill that recorded the loss:

| | starved (66 bots) | healthy (14 bots) |
|---|---:|---:|
| wood acquired | 1,461 | 546 |
| banked by `deposit` | **459 (31%)** | 85 (16%) |
| consumed by `craft` (legitimate) | 341 | 228 |
| **lost to explore / gather / surface / goto** | **553 (38%)** | 42 (8%) |

A tool-starved bot loses **38% of the wood it acquires to movement skills**, against
8% for a bot with working tools. Per bot that is 8.4 items vs 3.0.

## It is the pathfinder placing it, not our code

Only **24** `place` events fired fleet-wide in the same window, against **487
oak_log + 82 planks** leaving on movement rows. The loser rows read
`explored 91 blocks ... some legs blocked` and `entombed`. That is
mineflayer-pathfinder building with the inventory.

`Movements.scafoldingBlocks` seeds with dirt and cobblestone only. **We widen it**
in `scaffold.mjs`, and `PATHFINDER_SCAFFOLD` explicitly lists `oak_log`,
`birch_log`, every `*_planks` and the rest. The comment records exactly why, and
the reasoning is sound:

> WOOD WAS MISSING, and wood is what this fleet actually carries. … 16.2% (13
> bots) hold WOOD and nothing else the pathfinder will accept, and for those bots
> A* cannot plan a tower or a bridge at all.

That widening was correct and measured. What it has no notion of is **"this wood is
my only route to a tool."**

## So there are two loops, not one

1. **The outer loop** (already reported): wood gather at 10% → no wood → no pickaxe →
   no stone → no cobblestone → no pickaxe.
2. **The inner loop, new**: a starved bot has no cobblestone *because* it cannot
   mine, so the only scaffold it carries is wood — and the pathfinder spends that
   wood to climb and bridge, which is the same wood a wooden pickaxe is made of.
   **The poorer the bot, the faster it burns the thing that would make it rich.**

A wooden pickaxe costs 3 planks + 2 sticks ≈ **2 logs**. Starved bots acquire 1,461
wood items in 6 h and hold almost none.

## What this suggests, and what still has to be checked

The candidate remedy is a **reserve**: a bot with no working pickaxe should not
spend, bank or build with the last ~2 logs' worth of wood, because crafting is a
remedy it can perform from where it stands. That is the shape CLAUDE.md asks for.

Not yet established, and required before building:
- **Do not simply remove wood from `PATHFINDER_SCAFFOLD`.** It was added on measured
  evidence that 13 bots had no other scaffold and A* could not plan at all for them.
  Removing it re-creates that. The reserve has to be conditional on tool state.
- **6 bots already hold both inputs and are not crafting.** Whatever stops them is
  not a materials problem, and a reserve would not help them. That needs its own
  read — it may be the cheaper half of this.
- Whether `deposit` banking 31% is a separate defect (`deposit-banks-the-tools`
  already records deposit handing over whole stacks) or the same one.
