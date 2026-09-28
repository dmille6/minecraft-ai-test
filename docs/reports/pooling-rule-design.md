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

## v2 — ChatGPT's first pass folded in
1. **One chest transaction at a time, on live contents.** A pool's chest visits go through a lock file in the pool's state dir (`chest.lock`, 20-s lease, the holder's name and time); a bot that cannot take the lock does its non-chest work and retries next tick. Inside the lease the bot re-reads the container, decides, transfers, and VERIFIES the transfer by re-reading its own inventory before it crafts or reports; a mismatch is `pool_transfer_mismatch` and the visit ends without crafting.
2. **Eligibility and a reserve.** A withdrawn pickaxe must be usable for the job that asked (the ladder's required tier from `toolFor`'s harvest table); the chest keeps a per-pool reserve of one stone pickaxe that rule 1 may not take (rule 3 refills it); a bot that finds only the reserve crafts as today. Nothing is withdrawn that the same bot deposited in this visit.
3. **Roles per visit.** At the chest a bot is a DONOR if it holds < 3 ingots and will not reach 3 with the chest's stock, or a RECIPIENT if it holds ≥ 1 ingot and chest stock + held ≥ 3 and it holds no iron pickaxe (that is the upgrade eligibility; a bot with an iron pickaxe is always a donor of its ingots above 3). A donor deposits all its ingots; a recipient withdraws exactly 3 − held, crafts at the home table inside the same lease, and re-deposits the ingots (`pool_craft_abort`) if the craft does not verify. Allocated ingots are therefore never left in a pocket.

## v3 — pass 2 folded in; review closed; build follows
1. **Lock = atomic create with a token, renewed, never taken over mid-operation.** `chest.lock` is created with O_EXCL holding `{bot, token, expires}`; the holder renews every 5 s while inside; a stale lock may be taken only when its expiry has passed AND the previous holder's last chest row is older than the expiry (no operation in flight); every chest operation checks the token before it acts.
2. **Exhaustive roles.** held ingots h, chest ingots c, iron pickaxe p: RECIPIENT if !p and h + c ≥ 3 (withdraw max(0, 3 − h), craft, keep 0); DONOR if p and h > 0 (deposit all), or if !p and h + c < 3 and h > 0 (deposit all: the pool accumulates); NONE if h = 0 and (p or c < 3). A zero-ingot bot without an iron pickaxe is a recipient when c ≥ 3.
3. **Pending allocations persist.** Before withdrawing, the recipient writes `pending.json` {bot, count, token, ts} in the pool state dir; after a verified craft (or verified re-deposit) it is cleared; on any visit, a bot that finds its own stale pending entry first reconciles (inventory vs. the entry) and returns what it still holds before pooling again; another bot's stale entry older than 10 min is reported (`pool_pending_stale`) and counted against that bot, never taken.

## Build map (16 Sep 15:10 UTC; the build starts in the next session from STATE.md)
- `bots/src/pooling.mjs` (pure): `poolRole({held, chest, hasIronPick})` → RECIPIENT/DONOR/NONE with counts (v3 rule 2); `pickToTake(chestItems, requiredTier, reserve)` (v3 rule 1: tier from `toolFor`'s harvest table, one stone pickaxe reserved); `surplusPicks(items)` (rule 3); `lockPath/pendingPath(poolStateDir)` with the O_EXCL token lock and `pending.json` (rule 3 of v3). Tests: roles table incl. h=0/c≥3, negative-count guard, reserve, stale lock takeover rule.
- `bots/src/skills.mjs` deposit: after `depositPlan`, apply the ingot role and the stone-pick surplus inside the lease; verify by re-reading the inventory; rows `pool_deposit` / `pool_withdraw` / `pool_transfer_mismatch` / `pool_craft_abort` / `pool_pending_stale`.
- `bots/src/reflex.mjs` `pickaxePrereq` / `climbPrereqFor` and `bots/src/milestones.mjs` craft rungs: before crafting a pickaxe within 48 blocks of the home chest, try `withdraw` of `pickToTake` (rule 1); fall back to crafting as today.
- `~/mcai-analysis/poolread.py`: pickaxes withdrawn/bot-h, iron pickaxes crafted/bot-h (DiD), share of bots without a pickaxe (DiD), ingots idle in chests, deposit runs/bot-h (friction ≤ +50%); JSON via readjson.emit.
- Registration `-12 pooling` under v12+v14c+v15c+v16; not a ladder change; the canary after the -10+-11 verdict and the 72-h read.
