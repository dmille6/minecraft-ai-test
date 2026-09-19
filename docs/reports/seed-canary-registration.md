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
