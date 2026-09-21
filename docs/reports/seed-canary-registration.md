# Seed canary — registration (owner 15 Sep 21:30Z; decided 17 Sep 12:10Z: after the -13c verdict, no promotion freeze)

## Question
Does the death MIX and the set of trap classes change with the terrain? Every world runs `level-seed=1239381899`; every fix
this month is a local block rule that should transfer, but which fix matters is a property of the seed, and "code that
works in any world" has never been measured.

## Treatment
Two pools (drawn like a canary at execution time: one per inference half, never placebo-c or isolated, 12-h ledger
exclusions honoured, not the live code canary) have their worlds re-seeded with random 63-bit seeds by
`scripts/reseed-pool.sh <pool> --go` (worlds archived as `world.pre-reseed-<ts>`, identical town stamped by
place-town.py, radius 512 pregenerated, the five bots' HOME_* rewritten, pool state archived). Code is unchanged; the
trial manifest is untouched (the tripper judges code versions, and there is one).

## Read (72 h, DiD by pool set: the two re-seeded pools vs the fourteen, split at each promotion epoch)
The five program numbers by class where it applies: deaths/bot-h by class (lava, drown, fall), immobile bot-minutes,
gather success, stock returned, iron-pickaxe bot-hours. Reads at 24/48/72 h; every read states bot-hours and death
counts. A promotion inside the window changes both arms at once: the read is split at each `declared_code_version`
change and the per-epoch DiDs are reported side by side, never pooled across an epoch boundary.
KEEP/REVERT do not apply (no code). The output is a table and, for every death class first seen on the new seeds, a
captured fixture (`sandbox/fixtures/captured/`) for the corpus. The two pools stay re-seeded afterwards unless the
owner says otherwise.

## Pools, seeds, times
(filled by reseed-pool.sh at execution)

## Registered confound (Codex pass 2 on the runbook, 17 Sep): this is a RESEED-PLUS-RESET intervention
The two treatment pools do not only get new terrain. Their pool state (world facts, lessons), each bot's state dir, the
bots' inventories and progress in the old world, the accumulated world changes (shafts, stairs, chests' contents) and the
world clock are all reset with the world; the town is stamped fresh with new supplies. The fourteen controls keep all of
that. The 24-h read therefore includes a "fresh start" effect that the seed alone does not cause; the 48- and 72-h reads
are the ones that speak to terrain. Every read says so in its first line. The archives (.pre-reseed-<ts>) make the old
state recoverable but are not restored.
Runbook residuals accepted after two review passes (no third pass, by rule): place-town.py writes its marker after
warnings and pregen-world.py does not verify chunk generation; both are run supervised, their logs read before the bots
start, and the runbook refuses a stale or site-less town record.
- 2026-09-19T00:00:44Z: pool **placebo-a** re-seeded with `level-seed=8948499624371160708` (archives world.pre-reseed-20260918T235209Z, TOWN-PLACED.pre-reseed-20260918T235209Z.json on .30; /var/lib/mcai/_pool-placebo-a.pre-reseed-20260918T235209Z and the five STATE_DIRs on .31); new home 249 75 -144; radius 512 pregenerated; bots restarted 12 s apart. Treatment starts at the bots-started stamp in ~/mcai-analysis/reseed-placebo-a.journal.
- 2026-09-19T11:25:23Z: pool **placebo-b** re-seeded with `level-seed=7843072457371465157` (archives world.pre-reseed-20260919T111053Z, TOWN-PLACED.pre-reseed-20260919T111053Z.json on .30; /var/lib/mcai/_pool-placebo-b.pre-reseed-20260919T111053Z and the five STATE_DIRs on .31); new home 282 65 -388; radius 512 pregenerated; bots restarted 12 s apart. Treatment starts at the bots-started stamp in ~/mcai-analysis/reseed-placebo-b.journal.

## Amendment, 2026-09-19 11:20 UTC (PROSPECTIVE, before pool two's read opens): the sample is seeds on which the town sites

Pool two's first draw, `level-seed=2308430494737375791`, has **no placeable town**. `place-town.py` walked its
spiral and rejected every candidate — `platform relief 43 > 3`, `centre is water`, `24% of columns within 32 are
water`, `water inside the platform at 6,0` — and exited non-zero, leaving placebo-b with its five bots stopped, its
state archived and a reseeded, townless world. It was recovered by drawing `7843072457371465157` (see the record
below) and `scripts/reseed-pool.sh` gained a guarded `--new-seed` so the next one is one command, not hand work.

**The confound this creates, stated before the read rather than after it.** The treatment population is not "random
seeds". It is **random seeds on which the standard town sites** — flat, dry, low-relief ground within the search
spiral. That filter removes precisely the mountainous and flooded terrain that a terrain experiment would most want
in its sample, and it removes it *silently*, because a rejected seed leaves no trace in the read. One of the two
pools drawn today needed a second seed, so the rejection rate is not negligible: 1 of 2 on this evidence, and pool
one's own log records 47 candidate sites rejected before one was accepted.

Consequences for the claim, all of them narrowing it:
- **What the 72-h read can support:** "on seeds where a colony can be founded at all, the death mix and trap classes
  do / do not shift with the terrain." It cannot support anything about worlds where founding fails.
- **A null result is weaker than it looks.** If the two new seeds behave like the fourteen controls, one available
  explanation is that the siting filter made all sixteen worlds locally similar where the bots actually stand.
- **Rejected seeds are data and are now recorded.** `--new-seed` journals a `seed-rejected <ts> <seed>` line, so the
  rejection rate accumulates instead of vanishing. It is not yet an endpoint; it is a denominator for later.
- Not changed, deliberately: the siting criteria stay exactly as pool one had them. Relaxing relief or the water
  fraction between the two pools would put a second variable in a two-pool experiment.

## Execution record (SECOND, OVERLAPPING ACCOUNT — written by the overnight session, committed LATE at 12:15Z)

**Read the account above first; it is the current one.** This section was written by the 18 Sep overnight
session and committed at 12:15Z on 19 Sep, by which time the daily session had already reseeded pool two at
11:25:23Z. Its framing is stale wherever it speaks of pool two as untouched. **The numbers are not stale:**
the pre-period below was measured at 03:50Z, seven hours before placebo-b was reseeded at 11:10Z, which is
exactly the window it claims. Kept rather than deleted because that baseline cannot be re-measured, and
because two sessions overlapping on one document is the hazard STATE's CAUTION names — leaving the evidence
of it visible is worth more than a tidy file.


### Draw (19 Sep 2026, 00:00 UTC)
Eligible after the 12-h ledger exclusions (board-b, hive-a, hive-b, hive-c — from owner-01's INCONCLUSIVE at 12:59Z and owner-01b's REVERT at 16:38Z on 18 Sep) and the standing bans (isolated-*, placebo-c): **board-a, board-c, placebo-a** on the 5080 half; **board-d, hive-d, placebo-b, placebo-d** on the 3090 half. Drawn by lowest SHA-256 of `<pool>+2026-09-18-seed-canary` in each half — deterministic and reproducible from this record, because a hand-pick is what the draw rule forbids. **Result: placebo-a (5080), placebo-b (3090).**

### Pool one — placebo-a, reseeded 19 Sep 00:00:44 UTC
`level-seed=8948499624371160708`. Town at **249,-144** (y=74, platform relief 3, 0% wet within 32, 20% canopy, wood 3/24 columns), chosen after **47 candidate sites rejected** — overwhelmingly "centre is water". Pregen 1024x1024 in 48 s. Envs rewritten to `HOME 249 75 -144 / BOARD 252 74 -144`, border 1950. **5/5 confirmed in-world by RCON.** Archives `world.pre-reseed-20260918T235209Z`, `TOWN-PLACED.pre-reseed-20260918T235209Z.json`, and the five bot state dirs plus `_pool-placebo-a` under the same stamp. Draw-exclusion to 2026-09-22T00:00:44Z.

### PRE-PERIOD BASELINES, 24 h to 19 Sep 03:50 UTC, 120 bot-h per pool
Measured at 03:50Z, **before** placebo-b was reseeded at 11:10Z, which is what makes it a pre-period. (The sentence originally read 'before pool two is touched'; by the time this was committed it had been.) Positive control: 752,389 rows, 80 bots, 121 distinct kinds.

| pool | gather | craft | deposit | deaths |
|---|---|---|---|---|
| **placebo-b (pool two)** | **216/1948 = 11.1%** | 25 | **7/601 = 1.2%** | 2 |
| placebo-a (pool one, incl. post-reseed) | 654/2257 = 29.0% | 122 | 44/269 | 2 |
| fleet without placebo-b | **6053/31215 = 19.4%** | — | — | — |

**placebo-b was the worst pool in the fleet before it was touched**, and its deposit rate is the outlier of the whole fleet: 601 attempts, 7 successes. Other pools run 10–20%. Nothing about the seed canary caused that.

**This is now a registered confound in its own right, on top of the reseed-plus-reset effect already recorded above.** A pool that starts at 11.1% against a fleet at 19.4% has room to improve that has nothing to do with terrain, so a post-reseed rise on placebo-b is the WEAKER of the two arms as evidence. **The 48- and 72-h reads must report the two treatment pools separately, never pooled**, and must state each pool's pre-period beside its post. If placebo-b improves and placebo-a does not, that is regression to the mean and not terrain.

### First observation on pool one, 3 h 48 min in — NOT a result
placebo-a ran **160/408 = 39.2% gather and 50 crafts** against a fleet median near 16% and a next-best craft count of 22, with all five bots at full health and moving 200–454 blocks. This is exactly the "fresh start" effect the confound section predicted: new town, new supplies, empty state dirs, no accumulated shafts, no stale world facts. **Discounted by registration.** One death already (placebo-a-Comet, 01:57Z, drowned while idle) — the new terrain has water too.

---

## Amendment, 2026-09-21 11:45 UTC — PROSPECTIVE, before either +72 h window opens

**Written at 11:45Z. The +72 h windows open at 2026-09-22 00:00Z (placebo-a) and 11:25Z (placebo-b),
738 and 1,423 minutes later. Nothing below was chosen after seeing a +72 h number, because none exists.**

### The defect
`~/mcai-analysis/run-seed-72h.sh` (v1, written 20 Sep) carried
`CLEAN=board-a,…,hive-d,placebo-c,placebo-d` — **ten pools**, where the +48 h reader's list was the same
nine **without `placebo-c`**. `seedread.py:90` also removes all four `isolated*` pools from both arms, so
the eligible control universe is ten pools; excluding ten of ten leaves none.

**Verified, not inferred.** Running v1's exact list against the already-closed +48 h window on placebo-b
printed:

```
  control/pre             0   NO DATA -- refusing to report this cell as zero
  control/post            0   NO DATA -- refusing to report this cell as zero
```

and **no DiD block at all**. (An earlier attempt to reproduce this against the +72 h window itself was
correctly refused by the script — *"the +72 h window closes at 2026-09-22 00:00Z, 742 min from now"* — so
the closed +48 h window was used instead.) The script's refusal is v24 behaving correctly: **no wrong number
would have been published.** But both +72 h clean-control arms would have come back empty, and the +72 h
read is the registered discriminator, which cannot be retaken.

### The change, and why it is the conservative one
`placebo-c` is under the standing ban on being **drawn** as a canary pool, so it has never run one; the
contamination block lists only `b1659c0` and `cfc1c58` against it, which are fleet-wide mains affecting both
arms and cancelling in a DiD. It belongs in the clean control arm, and **the +48 h reads on both pools
already used it as exactly that.** Removing it from the exclusion list makes the +72 h read **comparable to
the two reads already taken**, rather than changing the comparator between reads.

- v1 is preserved at `~/mcai-analysis/run-seed-72h.sh` and was **killed, not edited** (a running bash script
  is re-read by byte offset). v2 is `run-seed-72h-v2.sh`, launched from a copy at `~/.run-seed-72h-live.sh`,
  `setsid nohup`, PPID 1, confirmed in its wait loop and due at the two registered times.
- **Proof the new list is non-empty**, from the +48 h run that used it: control/pre **125 bot-h**,
  control/post **245 bot-h** (placebo-c), gather DiD +38.4 pp. A process that exists is not a reader that
  works; this is the check that it works.

### What is deliberately NOT changed
`seedread.py:90` drops every `isolated*` pool from **both** arms. Those are 20 active bots that
**structurally cannot have run a canary** — there are no `_pool-isolated-*` state dirs on .31, which is the
real reason for the draw ban — so they would make a 25-bot uncontaminated control arm, past the k=20 knee,
instead of the single five-bot pool the clean arm currently has. The script's own comment counts *"six of
FOURTEEN controls"*, which only holds if `isolated` counts, and `placebo-c` under the same draw ban is
admitted — so `:90` looks like a slip.

**It is left alone anyway.** Changing the comparator between the +48 h and +72 h reads would make the
registered discriminator incomparable to the reads already taken, and doing it *after* seeing the clean arm
read +38.4 pp would be choosing the comparator on the answer. **Registered here as a proposal for a future
read, to be decided before any read that would use it.**

### Standing note on how the clean arm has been reported
The +48 h clean-control arms are **one pool, five bots** — `control/pre 125 bot-h`, identical to the
treatment. Nothing in the output says so; the header prints what was dropped and never what remains. At this
fleet's measured noise floor (null sd of the pool-mean ratio-DiD **0.608 at k=5** against 0.313 at k=20),
**the clean numbers are the noisier ones**, which is the reverse of how they were presented on 20 Sep
("contamination was diluting the effect, not creating it"). Neither arm is clean: all-controls carries real
canary exposure on board-\* and hive-\*, clean-controls has n=1 pool. The **sign and rough size are not in
doubt** — +32.8 pp against 50 bots, +38.4 pp against 5, and placebo-a agreeing with both — but the precision
is smaller than the decimals suggest, and the +72 h reads should be reported with the control bot-hours
beside every DiD.
