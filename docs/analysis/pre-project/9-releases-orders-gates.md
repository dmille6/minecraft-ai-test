# 9. Releases, orders, gates, storage, latency, interference (pre-project analysis)

Date 2026-11-23. Data: analysis VM 10.0.0.45, read-only. Decision table (15,564,095 rows, 08-05..11-22),
raw skill streams agents + showcase (compacted to `~/mcai9/skill/*.parquet`: 9,605,573 executed skill rows
plus order/board events; 10-07 skipped; agents skill stream ends 11-18), Opus v3 outcome-blind answer key
(30,933 labels: 10,527 yes / 20,235 no / 171 unclear). Scripts: `infra/analysis/pre-project/a9_*.py`.
"Sensible" = `decision_ok == yes`, denominator includes unclear. Everything below is correlational.

## 1. Did any release improve decision quality?

**No release has a detectable, robust effect.**

- Prevalence trend (simple random slice 0, n=933): Aug 20/95 = 21% [14,30], Sep 117/326 = 36% [31,41],
  Oct 95/284 = 33% [28,39], Nov 96/228 = 42% [36,49]. The model mix also changed over that time (4B, gemma
  arms in Oct/Nov), so this rise cannot be credited to code.
- Sequential eras (54 fleet run_ids with >=120 labels, each compared with the era before it, within the
  same cell (world|skill|status|trigger|place|load|pick, month dropped), cell bootstrap): **5 of 54** CIs
  exclude 0, and about 2.7 would by chance. Positive: bare-handed-escape +0.20 [+0.01,+0.38], idlegap-01 +0.19
  [+0.01,+0.35], lidclear-01 +0.23 [+0.07,+0.37]. Negative: shoreline-01 -0.13, junkwell-02 -0.18. Each of these
  rests on 20-120 matched labels, and none would survive a multiple-comparison correction.
- Each run vs concurrent others (40 runs with >=150 labels, same full cell including month): **3 of 40**
  exclude 0, and about 2.0 would by chance. All 3 are early block2 runs (shared-memory-live -0.06, climb-escape
  -0.06, three-traps -0.05), which were the memory-experiment arms. lidclear-01 is +0.096 [-0.002,+0.172] here,
  the closest any KEEP comes.
- Caveat: the cell includes the outcome status, which is post-treatment. Most releases fixed execution, not
  choice, so they would not be expected to move a choice label.
- By model (raw, stratified, so not a prevalence): qwen2.5:7b 32.7% (n=25,548), gemma4:26b 39.5% (2,966),
  4B r3 43.0% (2,074). The model is the lever, not the release.

## 2. What did the hard-coded orders cost?

Source of each executed skill row: an **order** is a `_work_order` for the same bot and skill, starting within
±3 s (the gap peaks at 0 / -0.5 s); **model** is an `llm:*` trigger; **interrupt** is an `interrupt:*` trigger;
**reflex** is everything else.

| stream (since first order) | order rows | share of rows | share of skill time | order success | model success |
|---|---|---|---|---|---|
| agents (from 09-10) | 354,925 of 7.19 M | 4.9% | 0.6% | 40.8% | 49.7% |
| showcase (from 10-20) | 30,520 of 0.48 M | 6.3% | 0.9% | 33.3% | 60.6% |

- The order share of rows grew by month: Sep 0.6%, Oct 4.3%, Nov 8.4% (time share 1.4% in Nov). Orders are
  short. Most of the time goes to model-chosen skills (70%) and interrupted skills (22-26%).
- Positive control: 1,040,711 `_work_order` events, of which 385,445 (37%) matched an execution. The rest are
  orders that did not run an executable skill row in the window (veto remedies, retries, other names), so
  **the order share is a lower bound**.
- Orders mostly yield `no_effect`, not failure: deep_mine order 13% success / 83% no_effect (n=78,140), against
  79% success for model-chosen deep_mine. Also smelt_town 4% / 83% (n=17,106), build_well 0% / 99.7% (12,887),
  count_town 10% / 90%, mats_return 0.3% / 99%, build_shop "undefined" 0.8% / 84% (9,071).
- Orders that work: sapling place 99.5% (57,416), town_deposit 61% vs model 30%, deposit veto-remedy 53% vs
  model 25%, gather-continue 76% vs model 30%.
- Displacement: the pipeline dropped prefetched model answers because an order took the turn 75,547 times
  (63,417 agents + 12,130 showcase, out of 662,000 pipeline rows).

## 3. Gate value: what follows each rejection

Next decision by the same bot (all gated decisions had one within 5 min). Baseline for an ungated failed
decision: next different-skill success 11.6%, next gated 38.4%.

| gate | n | same gate again | redirect to a success | same skill, then fails | Opus sensible on gated rows |
|---|---|---|---|---|---|
| repeat_loop | 1,881,503 | 67.4% | 4.2% | 8.4% | 26% (n=2,641) |
| learned_avoid | 1,127,378 | 43.9% | 8.1% | 13.1% | 22% (1,239) |
| cooldown | 1,062,158 | 6.9% | 6.5% | 45.4% | 12% (1,547) |
| bad_args | 546,707 | 28.1% | 10.0% | 10.4% | 36% (747) |
| deposit_nothing_to_bank | 315,758 | 48.1% | 9.4% | 3.0% | 38% (407) |
| unreachable_elevation | 277,897 | **72.5%** | 2.7% | 1.9% | **1.8%** (382) |
| deposit_not_worth_it | 266,727 | 11.5% | **25.2%** | 0 | 24% (384) |
| water_blocks_land_travel | 79,346 | 55.6% | 0.6% | 11.7% | 8.5% (71) |
| gather_area / log_cap / redundant_craft | 18k / 6k / 15k | 13-25% | 26-27% | 1-6% | small n |

- **Gates that redirect** (redirect-to-success at or above the 11.6% baseline): deposit_not_worth_it,
  gather_area, log_cap, redundant_craft, no_filled_bucket.
- **Gates that mostly loop:** unreachable_elevation (72.5% same gate again; p90 streak 8; 8.4% of streaks are
  10 or longer), repeat_loop (p90 streak 6, max 500), water_blocks_land_travel, learned_avoid.
- **cooldown** rarely loops, but 45% of the time the model retries the same skill right after and it fails.
  The gate delays a bad choice rather than replacing it.
- What gates block: learned_avoid blocks gather at 51.6% of its rejections, and ungated gather succeeds only
  27.5% of the time, so the block is plausibly worth it. bad_args blocks mine at 61.9%, and ungated mine
  succeeds 51.5%, so it is less clearly worth it. The rejection-loop analysis covers streak structure; this
  section is value per gate only.

## 4. Storage and chest flows

- Deposit-type skills moved about 1.85 M items out of bags: deposit 1.39 M, town_deposit 0.46 M. Withdraw-type
  skills took back about 98 k (withdraw 52.7 k, toolkit 32.2 k, withdraw_pick 13.2 k). **Chests are close to
  write-only**: about 19 items go in for each one that comes out. The largest net banked items are cobblestone
  582 k, oak_log 375 k, torch 148 k, cobbled_deepslate 103 k and oak_planks 98 k.
- The junk well disposed of 1.71 M items, more than all deposits. Cobblestone 923 k and deepslate 387 k lead,
  with andesite, diorite and granite at about 77 k each. Much of the mining output is thrown away.
- Success rates (agents): deposit 24.7% (n=185,825; 30% no_effect, 43% failed), town_deposit 46.7%,
  withdraw 40.0%, mats_return 2.9% (95% no_effect), count_town 13%. Showcase deposit 61%, town_deposit 78%.
- "Nothing to bank" gate: 315,758 rejections, all from Oct-Nov (154 k in Oct, 162 k in Nov). Nov has
  161,775 against 254,015 deposit decisions, so the model keeps offering deposits the gate refuses.
  not_worth_it: 267 k in all. A further 13,399 deposit runs ended "nothing matching apple to hand over".
- Chest full: 26,408 rows by fail_class (27,776 by text), out of 9.6 M executed rows. By month: Sep 9,762, Oct
  5,225, Nov 17,927. Plus 14,506 deposits that succeeded only after "the first chest was full" and 8,790 that
  failed with "chest is full; could not make another chest".
- Bag full: 47,444 inventory_full rows and 101,816 "N of N slots used" orders. There were 8,422 bag-full
  episodes on agents (80 bots, median 3 min, p90 27 min, 1,238 bot-hours in total) and 468 on the showcase (47 h).

## 5. Latency vs quality

**There is no meaningful relation.** About 1.04 M decisions (6.7%) have latency 0 and no completion tokens,
so they are not fresh model answers; they are oversampled in slices 1-3 and are 17% sensible. They are
excluded below.

- Simple random slice (n=872 nonzero), by latency quintile: 33.7, 33.1, 35.1, 36.8, 37.4%. Every CI overlaps.
- Within model: qwen2.5:7b Q1-Q5 35.6 / 36.5 / 36.8 / 36.3 / 32.7% (about 4,230 each); the slowest quintile
  (>2.8 s) is 3-4 points lower. gemma4 51-63% and the 4B 50-51% are flat.
- Within model and cell, slowest minus fastest quintile is -0.007 (2,898 matched). Including the zero-latency
  rows it is -0.05 [-0.10,+0.005]; also controlling for completion tokens it is -0.02 [-0.05,+0.02].

## 6. Bot-on-bot interference

- Explicit contention texts ("another bot ...", "held by", "one at a time") appear in 513 of 480,718 showcase
  rows (0.11%; town well 230, storehouse-upkeep lease about 200, materials job 31) and 16 of 9.12 M agents rows.
  That these leases fire on the showcase is the positive control; the fleet rarely shares jobs.
- Same exact target (goto/mine/gather coordinates or chest) with 2 or more bots in the same minute: 114,595 +
  17,341 groups (293,662 rows, 7.1% of the 4.11 M targeted rows). Shared targets succeed **more** (62-67% vs
  44.6% solo). They are mostly goto to a town point (223 k), so they show a common destination, not a fight
  over a block.
- Crowding (same 8-block cell and minute) does go with more failure for block work:
  - gather fails 57.6% alone, 72.9% with 2 bots and 85.2% with 3 (n = 2.72 M / 28 k / 1.6 k).
  - mine fails 25% alone and 46% with 2.
  - place fails 25% alone and 49% with 2.
  - Deposit and withdraw do better in a crowd, which is the town effect.
  This is confounded: crowding happens at depleted or contested spots, so it is a contention signal, not a
  proven cause.
- Workboard (agents): 99,838 rows, 25,948 issue against 48,264 yield (no job).

## Data gaps

- No source field on skill rows, so order attribution is a timestamp match (37% of orders matched).
- Labels are stratified (slices 1-3), so only slice 0 gives prevalence.
- The answer key has no fleet canary/control split, and run_id is shared fleet-wide.
- Raw args are truncated at 300 chars in the extraction.
- Pools (world key = bot-name prefix) are assumed to be separate worlds.
- The agents skill stream ends 11-18.
- Bag-full uses texts and fail_class, not slot counts.
