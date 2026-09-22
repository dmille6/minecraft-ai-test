# One chain, end to end: why the committed output metric reads 3.80

**2026-09-22.** `stock returned per bot-hour` is the program's committed useful-output
measure. Target ≥20 at two weeks. It reads **3.80**. This is the whole chain from the
metric back to the root, every link measured today with its denominator.

## Link 1 — the metric is the deposit path, and deposit succeeds 10.1%

2,866 deposit runs in 24 h across 56 bots:

| outcome | share | runs |
|---|---:|---:|
| `no_effect` | 58.7% | 1,682 |
| `failed/storage_full` | 16.0% | 458 |
| `failed/skill_error` | 11.1% | 318 |
| **success** | **10.1%** | 289 |
| `container_open` | 3.0% | 85 |

289 successful runs moved 5,419 items — median 7 per run.

## Link 2 — what each failure actually is

**The 58.7% no-effect: 1,069 runs were a false statement.** They returned *"nothing
matching &lt;item&gt; to hand over"* and in **1,068 of them the bot was holding the item** —
21 wheat_seeds, told there was no such thing. apple 543, wheat_seeds 116, dirt 99,
chest 78, oak_sapling 77. The *policy* is right: `bankableInventory` correctly refuses to
bank food and saplings. The *sentence* was false, so the model could not learn from it
and asked again every day. **Fixed today** (`deposit-truth`), refused at the gate before
the walk, naming the items that would actually move.

**The 16.0% storage_full is the wood problem wearing a different name.** 91.5% of those
460 runs say:

> had N item(s) and the chest is full; could not make another chest — **cannot craft
> chest -- gather oak_log first**

A bot standing at a full chest, holding bankable stock, unable to bank it because a chest
costs 8 planks, which costs 2 logs, which it cannot get.

**The 11.1% skill_error is the route problem wearing a different name.** All 311 runs,
across 47 bots, are pathfinding verbatim: *No path to the goal!* 38.3%, *The goal was
changed before it could be completed!* 37.3%, *Took to long to decide path to goal!*
22.2%. Not one is a deposit defect.

**The 3.0% container_open is its own small bug** — 83 runs timing out while opening a
chest **whose lid is `air` or `cave_air`** at 1–3 blocks from the eyes. Unexplained, and
the only genuinely deposit-local failure left.

## Link 3 — the wood filter, which two of those links reduce to

14,647 log gathers in 24 h, **11.5% succeed**. On worn worlds **76.4% are refused at the
candidate filter before the bot moves** (33.1% on the two re-seeded worlds — same code).
Two verified causes:

- `oak_leaves.boundingBox === 'block'`, so **60% of the wood on an ordinary oak reads as
  "buried"** — 75% on a height-4 trunk, checked against Minecraft's own generator shapes
  with the real predicates.
- A mineshaft liquid rule refusing shoreline trees: **0.0% lava** across 994 candidates,
  43.1% side-water-only.

Of the runs that get past and travel, **77.9% of worn route failures are a genuine
"A\* reached none"** — the same dead end that produces link 2's `skill_error`.

## What this means

**Deposit is not independently broken.** 27 of its 30 failing percentage points are
downstream of wood and routing, and both are already in flight: `leaf-02` shipped,
`shoreline-01` is canarying, `deposit-truth` is built.

It also means **the "cheapest large gain" framing needs qualifying.** Fixing the deposit
path cannot reach ≥20 items/bot-hour on its own, because the chest is full and the bot
cannot walk there — and neither of those is a deposit bug. What the deposit fix buys is
real but bounded: reclaimed decision time, and a true sentence the model can act on.

And it means the chain **inverts the usual reading of the output collapse**. Deposited
output fell 81% over the month while the filter-refusal rate on log gathers rose from
36.2% to 83.7%. Those are the same event seen at two ends of one pipe.

## The one thing here that is cheap, local, and not downstream of anything

`container_open`: 83 runs a day, 27 bots, timing out on a chest with **air on its lid**
at conversational range. That is either a stuck `openContainer` promise or a reach test
disagreeing with the server, and it is the only deposit failure not explained by wood or
by routing. It is small — 2.9% — and it is the only piece of this report that could be
finished without waiting for anything else.
