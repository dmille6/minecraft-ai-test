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
all. The 31 bots with wood and no cobble could each craft one and be mining within
a minute. Which lands exactly on a known and previously measured defect —
`learned-avoid-blacklists-the-ladder`: **70 of 80 bots forbidden to craft a wooden
pickaxe** by accumulated avoid rules. That should be re-measured first; if it still
holds, it is the binding constraint on the whole gather endpoint.

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
