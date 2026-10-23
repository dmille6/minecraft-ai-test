# BUILD_RESERVE: the proposed table and what it funds (owner Q6 follow-up, 2026-10-23)

**OWNER ANSWER (10-23, relayed by the operator): table D -- logs 512, copper ingots 512, cobblestone 256, torches 32,
sand 16, planks 71, sticks 40, all settings (10 of 13 workshops, 25 houses fundable today). It supersedes Q6's "512 for
each". Declared in matset-01 r4 (7b9db3a2, both engines APPROVE); read first by mats-01.**

PROPOSAL FOR THE OWNER, NOT A DECISION. The owner answered Q6 "lets do 512 for each". Run through the design's own funding
estimate, that funds nothing. The operator's recommendation is below, with the result per town. mats-01 is not built until
the owner answers. matset-01 declares `BUILD_RESERVE` but nothing reads it, so the numbers can change at no cost.

## The proposed table (operator recommendation = table C)

| reserved item (per town) | owner Q6 (512 each) | **proposed (C)** | basis |
|---|---|---|---|
| cobblestone | 512 | **512** | bulk: the operator kept 512. Towns hold 787-1000, and the cap refills it daily |
| logs (all species) | 512 | **512** | bulk: towns hold 67-1717 logs |
| copper_ingot | 512 | **512** | bulk: copper is an upgrade with a plank or stone-brick fallback, so a shortfall never blocks a build |
| torch | 512 | **32** | towns hold 64 torches (hive-d holds 0). Anything at or above 64 funds no building at all |
| sand | 512 | **16** | "at or below its target" (target 64 since matset-01). 16 is the design default. 64 (table C3) funds the same today |
| planks (all species) | 512 | **71** | "what towns actually hold": the median town's planks (64-119; hive-d 3, placebo-d 16) |
| sticks | 512 | **40** | the median town's sticks (0-165). No bill spends sticks, so this number changes no result below |

## What each table funds

Source: `tools/reserves.py.txt`, which runs `tools/funding.py.txt` unchanged with only its reserve table swapped, on
`data/census-species-20261023.jsonl` (town storage, 10-23). Output: `data/reserves-20261023.txt`. The 13 eligible towns
exclude isolated-a, c and d (D2). "Houses" means houses after the workshop, one at a time, from today's storage, with no
refill and at most 5 per town.

| table | reserve | workshops | houses | per town (board-a..d, hive-a..d, isolated-b, placebo-a..d) |
|---|---|---|---|---|
| A design defaults (**positive control**) | cobble 256, logs 512, planks 64, sticks 64, copper 256, sand 16, torch 32 | **10 / 13** | **26 / 65** | 3 2 3 3 · 2 0 2 0 · 3 · 2 3 3 0 |
| B owner Q6 as answered | 512 each | **0 / 13** | **0** | all 0. Every town is torch-short; hive-b, hive-d and placebo-d are plank-short as well |
| **C proposal** | cobble 512, logs 512, copper 512, torch 32, sand 16, planks 71, sticks 40 | **10 / 13** | **10 / 65** | 1 1 2 1 · 0 0 1 0 · 1 · 0 1 2 0 |
| C2 planks and sticks = each town's own holding | as C | 10 / 13 | 10 | the same as C |
| C3 sand 64 | as C | 10 / 13 | 10 | the same as C (sand is 0 in every town today, so windows are planks either way) |
| D = C with cobble 256 | as C | 10 / 13 | **25** | 3 2 3 3 · 2 0 1 0 · 3 · 2 3 3 0 |
| E = C with copper 256 | as C | 10 / 13 | 10 | the same as C |

Table A reproduces `data/funding-20261023.txt` exactly (10 workshops, 26 houses), so the harness reads the census correctly.

## What the numbers say

- **Torches are why "512 each" funds nothing.** Every town holds 64 or fewer, and each building bills 1-2 torches. Under
  mats-01, charcoal torches (Q3) could only add to the stock above the reserve. At 512, a town would first need about 450
  more torches.
- **Sand at 512 could never be spent.** The town stops banking sand at 64 (matset-01's target), so stock minus a 512 reserve
  is always below 0, and no glass is ever made. At or below 64 (C, C3), glass becomes possible once sand is banked. Sand is
  0 in every town today.
- **In C, cobble is what limits houses.** D, with cobble at 256, restores 25 of A's 26. Copper at 512 changes nothing (E),
  because copper falls back to planks or stone bricks.
  - At 512, a town keeps 512 cobble and spends 80% of the rest. Each house bills 112 cobble, so today's storage funds 0-2
    houses per town.
  - This is a snapshot with no refill. Cobble refills toward the 1000 cap daily, so over days C can fund more. This
    estimate does not model that rate.
- **Planks and sticks at "what towns hold" bind nothing here.** Bills are paid from logs crafted to planks, and towns hold
  far more logs than planks. Sticks are in no bill.
- **Three towns are never funded under any table:** hive-b, hive-d and placebo-d are plank-short (thin logs). hive-d is
  torch-short too. The design already names them for review after a week of the BUILD line.

## The answer the owner is asked for

One reserve number per item: cobblestone, logs, copper_ingot, torch, sand, planks, sticks. The operator recommends table C.
Table D (C with cobble 256) funds 2.5x the houses from today's storage. Every reserve stays a setting.
