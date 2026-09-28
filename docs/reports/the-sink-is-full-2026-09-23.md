# The sink is full, and it is full of pickaxes

**2026-09-23.** `stock returned/bot-h` is **0.80** against a target of ≥20 — a 25x miss, and
it has been read as a wood problem for a month. It is not. Measured today from the world
saves, which nothing in the bot can bias:

## 1. Acquisition is not the constraint

Server-authored per-bot statistics, 60 bots, 9.8 h window:

| | |
|---|---:|
| logs the SERVER recorded as mined, lifetime | **260,960** |
| over the window | +3,528 (**5.98/bot-h**) |
| logs that reached an inventory | +4,523 |
| retrieval gap | **NEGATIVE** |

The bots mine wood at six logs per bot-hour and collect more than they break. "Log gather
succeeds 12.2%" describes the SKILL's success rate, not the fleet's wood supply.

## 2. The sink is full

Every container in hive-b, enumerated from the region files as block entities — no
coordinates guessed, nothing that can miss a chest placed somewhere unexpected:

- **989 containers** in the world; **22 at 27/27 slots**.
- The town chests sit at (353–356, **72**, 147), one block under home (355,73,147).
  **All four are 27/27 full**, holding 529 / 1,205 / 634 / 656 items.

## 3. And it is full of the wrong things

Town containers (11 within 24 blocks; 4 completely full). A SLOT is the scarce resource, so
the question is which names hold slots:

| occupant | slots | share |
|---|---:|---:|
| TOOLS — wooden_pickaxe 21, stone_pickaxe 13 | 34 | **16.3%** |
| low-value junk — cobblestone 37, dirt 10, leaf_litter 9, stick 8, bamboo 4, sand 4 | 76 | **36.5%** |
| **LOGS — what we are trying to bank** | 19 | **9.1%** |

**52.8% of town storage is tools and rubble. 9.1% is logs.**

Memory already records this: `deposit-banks-the-tools`, FOUND 2026-09-13. Ten days later the
chests are still filling with pickaxes.

## 4. Why it cannot recover on its own

Two individually-correct policies meet where the bot has no legal move:

- `bankableInventory` reserves tools, stations and 8 scaffold blocks — but the scaffold
  reserve is gated on `/cobblestone|cobbled_deepslate|stone|dirt/`. **Logs and planks match
  nothing**, so a successful deposit hands over every log.
- The `storage_full` recovery crafts another chest. A chest costs 8 planks = **2 logs** —
  the wood that has just been banked. 91.5% of `storage_full` runs end
  `cannot craft chest — gather oak_log first`.

Nothing withdraws: `withdraw` exists and no milestone calls it, and `deposit_surplus` is
satisfied when no chest is in reach. **The sink is one-way by policy.** 16.9 → 5.43 → 0.80
is the shape of a filling container, not a regression anyone introduced.

## 5. What this changes

The month's wood work — the leaves-as-rock filter, the shoreline veto, the canopy fallback —
was aimed at a stage that is not the constraint. The constraint is that storage saturated
with things the bots did not need to keep.

**Smallest tests, in order, none of which need a canary:**
1. Repeat the census on the other 11 worlds: is 4-of-11-full universal or is hive-b unlucky?
2. Re-read the same chests after a window. The FILL RATE says whether this is asymptotic.
3. `bankableInventory` is a pure function with existing tests: assert that a bot holding 5
   logs retains 2. Falsifiable offline before it is ever a deploy.

## 6. How this was found, and what it cost

RCON first, which read **zero chests on all 12 worlds** — a parser bug in the new tool, not a
fact about the fleet, and it said so rather than reporting an empty sink. The save-based
reader found them immediately and carries a positive control (block-entity kinds seen).
Neither instrument existed 12 hours ago.
