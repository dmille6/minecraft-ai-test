# anvilproof: the anvil and the enchanting table work on Paper 1.21.8 (2026-11-03)

Ledger row `anvilbooks-1103`, step 1. Owner 11-03: "add prove the anvil works, then buy books. to the queue".
Tier 1 sandbox proof: no bot code changed, nothing deployed, no queue edit.

**Verdict: both WORK, server-verified, once two mineflayer pitfalls are avoided.** The trading run's failures
(trading design T6, `sandbox/trading/trade-proof.cjs` P4/P5) were caused by the helpers, not by Paper or the protocol.

## Versions and rig

- Paper `1.21.8-60-main@29c8822`, sandbox3 (10.0.0.30:25601), peaceful, survival test bot `sbx-Anvil`.
- mineflayer 4.37.1, prismarine-item 1.18.0, prismarine-windows 2.10.0, minecraft-protocol 1.66.2, minecraft-data 3.112.0.
- Driver: `sandbox/trading/anvil-proof.cjs` (lock taken with `sandbox/sbxlock.sh take sandbox3 anvilproof`, released
  after every run). Sandbox-only setup by RCON: a glass-walled stone platform at 3600,140,3600 (forceloaded, removed
  after), `give` (anvil, enchanting table, 3 iron pickaxes, 10 lapis, a Mending book, an Unbreaking III book),
  `xp set 10 levels`, `tp`. The bot placed the anvil and the table itself in survival.
- Ground truth is the server, not the client: `xp query <bot> levels`, `clear <bot> <item> 0` counts, and per-entry
  `data get entity <bot> Inventory[i].components."minecraft:enchantments"` (a whole-`Inventory` reply is cut at RCON's
  packet size, which hid the result in the first run).

## Results (runs 2-5 identical where deterministic; run 5 quoted)

| Step | What | Client | Server |
|---|---|---|---|
| A1 | `anvil.combine(pick, book)` (mineflayer helper) | throws `Not anvil-able (in either direction)` | nothing happens |
| A2 | by hand: pick -> slot 0, Mending book -> slot 1, shift-click slot 2 | result in slot 2 within ~0.3 s; cost (window property 0) = **2** | levels **10 -> 8**, books 2 -> 1, pick has `{"minecraft:mending": 1}`, `repair_cost: 1` |
| A3 | rename only: pick -> slot 0, `name_item {name:"TownPick"}` | cost **1** | levels 8 -> 7, `custom_name "TownPick"` |
| A4 | Unbreaking III book onto a pick at **0 levels** | result + cost 3 shown, the take is **refused** | level 0, book still there, items stay in the anvil (returned on close) |
| E1 | enchanting table, no bookshelves, window-numbered items, lapis, `enchant(2)` | offers 1 / 5 / 8 levels (run 4: 1 / 5 / 8; run 3: 1 / 3 / -) | levels **10 -> 7**, lapis **10 -> 7**, pick has Efficiency I (run 4: Efficiency II + Unbreaking II) |
| - | anvil after 3 completed uses | `anvil` | `execute if block ... minecraft:anvil` passed (not chipped; 12 % chance per use) |

## Why the trading run failed (causes, each confirmed)

1. **`anvil.combine` / `anvil.rename` cannot work on 1.20.5+.** They price the work with prismarine-item's `Item.anvil`
   before clicking anything. prismarine-item 1.18's `enchants` getter reads `componentMap.enchantments` but never
   `stored_enchantments`, so an enchanted book reads as `[]` (seen client-side: `enchants: []`, components
   `stored_enchantments: [{id:22, level:1}]`), the price is 0 both ways, and the helper refuses. The server is fine.
2. **The trading run's hand-driven fallback** read `anvil.slots[2]` after 1.5 s and then took it with `putAway`; it
   also read the result from a whole-`Inventory` RCON reply that is truncated. A2 here (plain `clickWindow` left
   clicks on window slots, then shift-click slot 2) gets the result in ~0.3 s every time.
3. **`putTargetItem` / `putLapis` take a WINDOW item.** They call `moveSlotItem(item.slot, 0)`. Passing an item from
   `bot.inventory.items()` passes the player-inventory slot number (9..44) into the table window, whose player section
   is 2..37: slots >= 38 assert `invalid operation` (the trading run's error), lower ones click the wrong slot. Use
   `table.items()` (window-numbered).
4. **The table's `ready` event fires too early.** It fires when all three level properties are >= 0, which the zero
   values sent at open already satisfy, before the server prices the item. Wait until some `enchantments[i].level > 0`
   (plus ~0.8 s: the three offers arrive as separate properties; run 3 chose before offer 3 arrived).

No 1.21 protocol gap was found: the window types are `minecraft:anvil` / `minecraft:enchantment`, `name_item` is the
1.21.8 rename packet, `enchant_item` works, and the 1.21.5+ hashed-slot click packets are accepted. The issue tracker
has no 1.21 anvil/enchanting bug (searched PrismarineJS/mineflayer and prismarine-item for "anvil" and "enchant":
#3670 is a user slot mistake, #3945 the 35-vs-50 rename length, #3717 the same pre-1.20.5 enchant parsing on dig).
The grindstone is irrelevant (it removes enchantments).

## The working path (what bot code must do)

Anvil (book + tool, or rename):
1. `win = await bot.openBlock(anvil)`; listen to `craft_progress_bar` for `windowId === win.id`, property 0 = level cost.
2. Find items in `win.slots[win.inventoryStart .. win.inventoryEnd)`; `clickWindow(tool.slot,0,0)`, `clickWindow(0,0,0)`,
   `clickWindow(book.slot,0,0)`, `clickWindow(1,0,0)`; for a rename `bot._client.write('name_item', {name})`.
3. Wait (<= 5 s) for `win.slots[2]`; refuse unless `bot.experience.level >= cost` and `cost < 40` (survival "Too
   Expensive"; not reached here: a fresh tool's first book costs 2-3 levels, each later anvil use doubles the prior-work
   penalty 0, 1, 3, 7, 15, 31).
4. `clickWindow(2, 0, 1)` (shift-click out), close, confirm the levels dropped by `cost` and the book is gone.
Enchanting table: `openEnchantmentTable`, `putTargetItem(table.items()...)`, `putLapis(table.items()...)`, wait for a
level > 0 (+0.8 s), choose `i` with `level <= bot.experience.level` (it costs i+1 levels and i+1 lapis), `enchant(i)`,
`takeTargetItem()`, `putAway(1)` for leftover lapis.

## What step 2 (buy + apply books) needs

- **XP.** The levels must come from play (mining, smelting, trading), never `xp`. The trading design saw levels 6-11 in the
  fleet; one Mending/Unbreaking book needs 2-3 levels on a fresh tool. Telemetry for `_xp` is trading T1.
- **Emeralds and a librarian**: trading T2 coalsale-01 KEPT (emeralds) and a librarian sighting (trading-scout-01);
  book offers are random per librarian, so the target must be an OBSERVED offer (`bot.openVillager` parses them; books
  show `stored_enchantments` in `componentMap`, not in `.enchants`).
- **An anvil**: 3 iron blocks + 4 iron ingots (31 ingots); the fleet's town chests hold 1,125 iron. A town anvil (placed
  in the workshop) is a building piece; it chips at 12 % per use.
- **Code**: a small `anvilApply(tool, book)` actuator implementing the steps above with an exported pure `anvilPlan`
  (affordability, too-expensive, which tool gets which book) tested by behaviour, and the server-truth check after.
  Do not call `anvil.combine`/`rename`. Optional: lapis is plentiful (4,377 in town chests), so the enchanting table is a
  second, cheaper source of Efficiency/Unbreaking once bookshelves exist (none here: offers capped at 8 levels).
- Tier per `scripts/lib/protected.py` when it is built; Paper behaviour is now seen working, so one engine suffices
  unless it touches protected scope.
