# The canary ceiling is the draw band, not the tripper — 19 September 2026, 16:55 UTC

Found by running out. Two canaries in four hours (`leaf-01` 12:44Z, `digwatch-01` 15:55Z) exhausted the draw,
and the third refused: **`DRAW: NONE (fewer than two eligible)`**, with one pool left.

This matters because the owner approved 1-2 days of work on **concurrent canaries**, on the argument that the
tripper's "one canary pool, ever" is the throughput limit. **It is not, and concurrency would make this worse.**

## Measured, from `poolrank2.py` at 16:52Z

| | count | pools |
|---|---:|---|
| ranked at all | 12 | `isolated-*` never appear |
| on the **5080 half** | **9** | board-a, board-b, board-c, hive-a, hive-b, hive-c, placebo-a, placebo-b, placebo-c |
| on the 3090 half | 3 | board-d, hive-d, placebo-d |
| drawable (5080 minus the standing `placebo-c` ban) | **8** | |
| drawable today (minus placebo-a/b, re-seeded until 22 Sep) | **6** | |
| **within the ±40% band** around the 5080 median of 20.7 | **4** | board-a 13.9, hive-b 14.0, hive-c 18.3, hive-a 20.7 |

Out of band and therefore undrawable however free they are: board-b 31.6, board-c 35.6, placebo-a 68.2,
placebo-b 88.9.

## So the ceiling is arithmetic

**~4 pools are in-band at any moment. A canary consumes 2 and locks them out for 12 h. That is 2 canaries per
12 hours**, which is exactly what happened: leaf-01 took board-a + board-c, digwatch-01 took hive-a + board-b,
and the band was empty but for hive-c.

`drawrec.sh:72` filters `h == '5080'`, so **3 of 12 pools — a quarter of the fleet — can never be a canary at
all.** They are permanently control. Presumably to keep the inference half constant across arms; the cost has
not been written down anywhere I can find.

## What this says about the concurrency plan

- **Concurrent canaries do not raise the ceiling. They lower it.** Running 2-3 at once consumes 4-6 in-band
  pools simultaneously and locks them all for 12 h. The tripper's limit was never the binding constraint.
- The binding constraints, in order: the **±25/40% band** (4 of 12 pools), the **5080-half filter** (9 of 12),
  and the **12-h exclusion** (2 pools per canary).
- **Before spending 1-2 days on the tripper**, the cheaper questions are: can a canary draw from the 3090 half
  with the half recorded as a covariate rather than held constant? Is a ±40% band on `items/bh` the right
  matching criterion, or would a wider band with the pre-period as a covariate serve the DiD equally? Both are
  analysis changes, not fleet changes, and either would move the ceiling further than concurrency can.

**Not claimed:** that the band is wrong. It exists so a canary is compared against pools of similar
productivity, and today's `leaf-01` read leaned on exactly that. The claim is narrower — **the band, not the
tripper, is what stops the third canary of the day**, and the approved work targets the wrong one.

## Correction to my own earlier note

I told the owner the exclusion rule was the ceiling and estimated it caps throughput near 2/12 h. The number is
right and the reason was wrong: with 8 drawable pools the exclusion alone would allow 4 canaries per 12 h. It is
the **band** that reduces the eligible set to 4, and the exclusion then halves it twice.
