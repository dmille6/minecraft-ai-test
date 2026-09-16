# Pooling through the home chest — design v1 (16 Sep 2026 12:20 UTC; for two-engine review before building)

## What the logs say (15–16 Sep, 60 bots)
- `deposit` ran 2,227 times in 24 h: 371 put something in a chest, 694 failed, 1,159 had nothing to deposit. `withdraw` ran 12 times, asked for dirt, apples, torches, sand and seeds, succeeded once (5 wheat seeds). The chests hold oak logs, cobblestone, stone pickaxes, copper, eggs. The one-way-sink comment above `withdraw` is still true in effect: the skill works, nothing drives it.
- 11 bots carry iron ingots (mostly 1–2 each), 5 carry raw iron, 8 hold an iron pickaxe, 4 hold no pickaxe. An iron pickaxe costs 3 ingots; the fleet crafts ten a day and the ingots that never reach three sit in eleven pockets.

## The rule (deterministic, in the craft/prerequisite ladder; the model is not asked)
1. **Take a tool before making one.** When the ladder wants a pickaxe (`climbPrereqFor`, `pickaxePrereq`, the craft milestone) and the bot is within 48 blocks of a home chest that holds one, it withdraws the best pickaxe in the chest instead of crafting. Priority: the chest's iron pickaxe, then stone, then wooden. Cost: one goto and one container open.
2. **Pool the ingots.** A bot at the chest (any deposit run) deposits ALL iron ingots unless it holds ≥ 3 (it keeps enough to craft). A bot that holds < 3 ingots and finds ≥ 3 − held in the chest withdraws them and crafts an iron pickaxe at the home table if it holds none. The chest is the pool; the craft happens at home where the table is.
3. **Stone pickaxes are surplus, not stock.** A bot holding two or more stone pickaxes deposits all but one; the chest's stone pickaxes serve rule 1.
4. **Never withdraw what you deposit in the same visit**, and never withdraw when the chest is another pool's (chests are per world/pool; `home` is the pool's base).

## Instruments
- `pool_withdraw` rows (kind, item, count, why) and `pool_deposit` rows on the two rules; the canary's own lines: pickaxes withdrawn per bot-h (exposure), iron pickaxes crafted per bot-h (DiD), bots with no pickaxe (share, DiD), ingots idle in chests (report).
- Friction: deposit runs per bot-h not up by more than 50% (the rules add chest visits).

## Expected effect
Rule 1 removes the "no pickaxe" state for any bot near home (4 of 60 today) without a craft chain; rule 2 turns eleven bots' fractions into three or four iron pickaxes a day on top of the ten crafted — the iron-pickaxe bot-hour share is the program number (2.0% today, target 8%).

## Question for the reviewer
Is a deterministic pooling rule the right shape (vs. a prompt hint), are rules 1–4 complete, and what breaks (ownership races between five bots at one chest, a bot withdrawing the pickaxe another just deposited, the chest emptying the base's spare)? Name at most three defects with one-line remedies, then ACCEPTABLE or NOT ACCEPTABLE.
