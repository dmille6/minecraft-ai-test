# anvilapply-01 + enchant-01: bots use the anvil and the enchanting table (2026-11-04)

OWNER 11-04: "build the skills bots need to USE the anvil and enchanting table" (an enchanting + anvil workshop for the
showcase is designed separately: enchantshop-1104). Ledger `anvilbooks-1103`. Method: [anvilproof-2026-11-03](anvilproof-2026-11-03.md).

**Branch `showcase-anvilapply-on-d3773f8b` (on the live showcase release d3773f8b), sha `336aa45a`. Ready to stage; not staged.**

## What it does

At town, `shop.mjs buildOrder` asks `skills.mjs enchantAsk` first (before the sink / copper / expedition branch and the
build). It answers at most once per bot per kind every 20 min, and only when there is work:

| Ask | Issues when | Skill |
|---|---|---|
| anvil | an anvil within 32 blocks, and a book in the bag that a bag tool gains from at a cost the level pays (< 40); or no bag book but the town index shows one, the bag has a tool, level >= 2, no useless town book in the last 6 h | `anvil_apply` (args `town:1` draws one book with the withdraw verb first) |
| table | an enchanting table within 32 blocks, level >= 8, a tool with no enchantment, lapis in the bag or town, and the anvil has no work waiting for levels | `enchant_tool` (args `town:1` draws 6 lapis first) |

Decisions are pure functions in `bots/src/enchant.mjs`:
- `anvilPlan`: tools best first (pickaxe > axe > shovel > sword > hoe; netherite .. wooden; most uses), books in owner order
  (Mending, Unbreaking, Efficiency, Fortune, Silk Touch, ...). The first pair that gains something and the level pays.
- `anvilEstimate`: vanilla 1.21 book costs (half the item anvil cost, >= 1, x the result level; equal levels +1; conflicts
  Fortune/Silk Touch and the damage trio; prior-work penalties). It matched the server every time: 2, 3, 4, 5.
- `anvilTakeOk`: the SERVER's cost (window property 0) must be > 0, < 40 and <= the level. This side never clicks a result
  it cannot pay.
- `offerChoice`: the highest table offer with level >= its price and i+1 levels and i+1 lapis available.

The window drivers (`anvilCombine`, `enchantAtTable`) are the proof's method: plain left clicks on WINDOW slot numbers, wait for
the server's result / prices (past the zeros sent at open), shift-click out, confirm the level drop from the server's
experience packet. `_anvil_apply` / `_enchant_tool` rows carry stop, tool, book, cost, levels before -> after, gain, the block.
Mode rows `_anvilapply_mode` / `_enchanttool_mode`. Kill switches `ANVILAPPLY=off`, `ENCHANTTOOL=off`.

## Evidence

- `bots/test/enchant.test.mjs`: 20 pass (planners; a fake Paper window for both drivers, including the refused take and the
  early `ready`; buildOrder with the ask; structural registration; 5 anchored mutants killed).
- Paper re-proof, sandbox3 (Paper 1.21.8-60), `sandbox/trading/enchant-e2e.mjs`, the REAL ask -> skill path with craftsync
  installed as on every bot (re-run after r1 through the owned/tracked io: same results; the table offers differed by seed), each result read from the server (`xp query`, `data get entity ... components`):

| Step | Ask | Server after |
|---|---|---|
| s1 | anvil_apply | iron pickaxe `{mending: 1}`, levels 12 -> 10, books 2 -> 1 |
| s2 | anvil_apply | iron pickaxe `{mending: 1, unbreaking: 3}`, 10 -> 6 (estimate 4) |
| s3 | none (6 levels < 8; no book left) | unchanged |
| s4 (10 levels) | enchant_tool | stone pickaxe `{efficiency: 1}` (the iron one is enchanted), 10 -> 7, lapis 6 -> 3 |
| s5 | none | unchanged |
| s6 | anvil_apply `town:1` | a chest's Efficiency II book withdrawn (`verification=server`), applied: iron pickaxe `{mending:1, unbreaking:3, efficiency:2}`, 7 -> 2 (estimate 5) |

- Suite (`scripts/host/suite-run.py`, queued to w30 since ci2 was busy, at 336aa45a): 416/420; FAIL ceilescape, nothing-important-is-orphaned, protected-paths (the copied tree has no .git; the known set) + well.test (passes alone at the same sha with `--filter well.test`: 3/3, so a load flake). Targeted on the Mac: enchant 21, buildrun-stuck 3, showcase-on-fleet, copperhall, shop 2, merchantscout, expedition pass; eslint clean (lint:movement fails on the base for buildbot / two tests, not this change).
- Review (Codex, one round, blockers only; not protected scope per `scripts/lib/protected.py`): r1 (79793c6e): one BLOCKER -- unguarded clicks and an unconditional close of the captured window. Fixed in 336aa45a: the drivers take an io; the skills pass withdraw's ownInventory, lockstep + tracked clicks refused once the window changed or the skill aborted, settleCursor before the close (holdUnsettled if unresolved). r2 on the fix: "RESOLVED, NO BLOCKERS". The Paper e2e was re-run through the fixed path: same six results.

## Not proven / open

- The table's `town:1` lapis draw uses the same withdraw verb s6 proved for the book; the town-index branch of the anvil ask
  (no bag book, index shows one) is covered by the unit test, not the sandbox (the sandbox has no town index).
- **Tripwire.** The skills place and dig nothing. But an anvil chips with use (12 % per completed use: anvil ->
  chipped_anvil -> damaged_anvil -> gone). If the workshop's anvil is a recorded structure block, the showcase tripwire
  (S4 compares block names) will read a chip as damage. enchantshop-1104 must either keep the anvil out of the record or
  get a shopread rule: an `_anvil_apply` stop=applied row at that cell explains anvil -> chipped -> damaged -> air.
- XP comes from play only. The showcase bots' levels are not logged yet beyond trading-scout's `_xp` rows; the ask's skip
  rows (`stop=skip:xp`, at most hourly per bot) will show how often levels are short.
- Books reach town only by trading (anvilbooks step 2, after trading T2) or loot; until then the anvil ask stays quiet.

## Queue placement

Showcase lane, with the enchantshop-1104 workshop (no anvil or table near home -> never asked). Staging it alone is harmless
(switch on, no blocks in reach -> no orders); it shows something only once the workshop is built and books / levels exist.
