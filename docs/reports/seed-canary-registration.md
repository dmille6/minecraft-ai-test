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
