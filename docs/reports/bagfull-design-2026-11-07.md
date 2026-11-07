# bagfull-01: full bags block every showcase build order (2026-11-07)

Control-session brief 11-07: on showcase release `272288e1`, build orders were skipped `why=room` (bags full), and keepers made
zero tidy visits in the gkwork and roughground-01 2-h reads. The owner's top goal is grounds work, so this blocks it.

## Measured (showcase, 15 bots, 24 h to 11-07 13:00Z, 255,666 skill rows, `scripts/lib/telemetry.py` full walk)

- `_shop_skip why=room`: 442 rows from 14 bots. The row is rate-limited to one per bot per 30 min, so this is a lower bound and the
  refusal is continuous. 396 of the 412 sampled skips were inside the town. Positive control: 513 `_shop_skip` rows of 4 kinds.
- Real free slots at the skips (matched to a `_mats_skip free=` row within 2 min): mostly 5-7. That is below the build's 8 and
  above a light plot's 2.
- Build visits fell from ~150 per 3 h (11-05) to ~60 per 3 h (11-07). In the last 12 h, 29 of 31 keeper terms released
  `no_work_visit`. During those terms the keeper's room skips were at 6-7 free slots, because the keeper's order puts the forest
  (needs 8) ahead of the tidy (needs 2). There have been no keeper tidy visits since 11-06 ~15Z and no forest visits since
  11-07 07:21Z.
- Bags hold ~30 slots, and cobble is only 3.4 of them (mean slots per skip). The rest: tools 7.1, building blocks + stations 4.5
  (each bag ~15 chests, stone bricks, signs, stonecutter), earth 4.1, wood 3.9, plants 3.5, other 2.5 (snowballs, buckets).
- The town deposit banks only its standing targets and wants. On a real 29-slot bag it planned one step (cobblestone:20), and the
  cobble cap refused it. Town containers (town index): 196 of 729 slots used, 0 full; the storehub hall's 18 chests are mostly empty.
- Cobble: the town is at its 1000 cap (963 cobbled_deepslate + 193 cobblestone), the stock yard is full (304/304), and the well's
  band remedy (`BAGROOM_WELL`) is off on the showcase because of the stoneworks plan.
- bagroom-01 (live since 79bc6085, 11-06 06:31Z) is on the live line. Its share half finds little to bank now: shares are small.
- **Fleet (3 h, 80 bots, 277,618 rows): no room gap.** `_shop_skip` 312 rows, of which `why=room` is 17; the top reasons are
  stuck_on_cell 164 and underground 77. 266 of 342 `_mats_skip` rows show >= 8 free slots. No fleet variant was built.

## Cause

Two correct guards compose into a dead end. The build refuses without room, and the deposit refuses everything outside its
standing targets, so a full bag in a town with an empty hall has no exit.

## Fix (bagfull-01show, on 272288e1): the room bank

- `shop.mjs buildOrder` passes the plot's own room to the room ask: 8, or 2 for a light plot.
- `skills.mjs roomAsk` tries the share bank first (unchanged). Otherwise it calls `bagroom.mjs roomBankAsk` with the number of room
  steps in `towndeposit.mjs townDepositPlan({ room: true })`, which is the same plan the run banks. The ask is rate-limited to once
  per 10 min.
- The order is `build_shop { roomBank }`. If no town container is within 16 blocks, the bot walks to the nearest one (within 48).
  It then runs `townDeposit { room }`, where every plan of the run carries the flag and the valve never does, and writes one
  `_room_bank` row. If the bag now has the room, the same visit goes on into the build (inside 90 s).
- Room steps are whole stacks above townKeeps and ROOM_KIT_KEEP. The room bank never takes:
  - tools, food, armour or buckets
  - cobble
  - stations, torches or bone meal (the allowance rows own them)
  - junk, saplings or compost
  - the iron ladder, standing targets or always-banked ores
  - anything under a withdraw hold
  - drawn-share names
  - target-0 groups (dirt, gravel)

  Targeted names such as wood and sand still need the town's stock claim (`bankInto` is unchanged).
- Offline on 412 real refused bags: 366 reach 8 free and all 412 reach 2.
- Rollback: `BAGROOM_BANK=off` (or `BAGROOM=off`). Tier 2: `protected.py` says not protected.
- Tripwire: no rule needed. The bank moves items into chests and places or digs nothing. The build visit's `_build_bag` starts
  after the bank, so G8 bag_loss cannot read the bank as a loss.

## Codex independent design (summary) and reconciliation

Where Codex agreed:
- The room refusal should order a room-storage visit.
- Pass the plot's need to the ask.
- Keep stock claims and cobble reservations; never use the `explicit` claim bypass.
- Whole stacks only.
- Keep the cobble cap, skip the full yard, and leave `BAGROOM_WELL` off.

Where Codex differed:
1. **Keep only a "useful surplus" allow-list; anything unknown stays.** Not taken. Banked items stay in town chests, where the
   build's bill draws them back, so nothing is destroyed. Everything a reflex or the pathfinder needs is in the kit, the townKeeps
   floors (scaffold reserve, wood means) or another layer's rules.
2. **Route to the hall beyond 16 blocks using the index.** Partly taken. The bot walks to the nearest town container within 48, and
   the home chests have room (81+ free slots).
3. **Keeper fallback: when the forest needs 8 and the keeper has 2-7 free, run the tidy now.** Deferred to piece 2. Doing it needs
   `buildShop` to honour a chosen plot instead of re-deriving the forest. The room bank alone takes most bags to 8.
4. **Audit the >= 34-slot well path against the owner's 10-16 rule.** Out of scope; this change makes no cobble change.
