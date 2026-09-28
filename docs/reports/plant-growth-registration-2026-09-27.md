# plant-20260927 — the +12 h growth cohort, registered PROSPECTIVELY

_written 2026-09-27 11:40Z (`date -u`). Registered BEFORE the read it governs. The +4.8 h read is
already recorded in the ledger as KEEP for `268c074`; this document registers the SECOND read, at
+12 h, and it exists because the second review engine made it the condition on spending sixteen
worlds:_

> "Replace the placement-only preflight with a registered 12-hour coordinate-tracked growth cohort
> before reseeding." — ChatGPT (`codex exec`, read-only), 2026-09-27 01:00Z, closing sentence.

> "What must not happen today: … reseed away the growth cohort before reading it." — same pass, §8.

**This is a registration, not a canary.** `268c074` is fleet-wide, there is no control pool, and
`check-open-loop.py` cannot raise on it because a fleet-wide deploy leaves `canary_pool` empty. That
is a real gap and it is queued. The discipline here is supplied by writing the read down in advance
instead of by the loop.

## run

| field | value |
|---|---|
| run_id | `plant-20260927` |
| sha | `268c074` (`+b4d009`), ONE version, 80 bots |
| deployed | 2026-09-27T06:22:00.666606Z (manifest `declared_at`) |
| read 1 | +4.8 h, taken 11:21Z, **KEEP recorded** (ledger entry 66) |
| read 2 | **+12 h, due 2026-09-27T18:22Z**, this registration |
| pools | all 16 (no split — both review engines refuted the env-var arm) |

## instrument

The coordinate, not a rate. `_plant_spot` records `at=x,y,z` for every issued planting; the cohort is
every such coordinate whose bot then logged a **successful** `place` of a sapling within 120 s, because
an order is not a placement. Three hours or more later an RCON `execute if block` at that exact cell
answers what is there now.

- cohort builder: `~/mcai-analysis/plantcohort.py` on 10.0.0.31 (telemetry walk → TSV)
- growth read: `~/scripts/plantgrow.py` on 10.0.0.30 (RCON, all 16 worlds, read-only)
- ambient control: `~/scripts/plantnull.py` on 10.0.0.30 (same cells displaced ±7, four per planting)

`execute if loaded` is tested before every block test, because **an unloaded chunk fails every block
test** and would read as a destroyed sapling. Unreadable cells are excluded from every rate and counted.

Nothing in this read writes to a world. No `forceload`, no `setblock`, no teleport.

## the numbers read 1 produced, which read 2 is measured against

Denominators, in the order the review insisted they be kept apart — **issued orders 1,002 → executed
placements 889 → readable cells 763 → mature trees 286**:

| cell now holds | n | of 763 readable | ambient (±7, n=3,019) |
|---|---|---|---|
| log | 286 | **37.48%** | **2.19%** (log 9 + leaves 57) |
| sapling | 208 | 27.3% | **0.00%** (0 of 3,019) |
| air | 207 | 27.1% | 43.3% |
| dirt / other / water | 62 | 8.1% | 54.5% |

126 of 889 cells were in unloaded chunks and are excluded.

## what read 2 must show, decided now

1. **PASS on growth** — mature (`log` or `leaves`) at **≥ 20%** of readable cells in the cohort placed
   before 08:22Z (the ≥10 h sub-cohort), against an ambient log/leaves rate re-measured in the same
   run. 20% is set below read 1's 37.48% deliberately: read 1 is a mid-process snapshot and cells
   convert out of `sapling` into either `log` or `air`, so a **grown tree the bots then chop lands in
   `air`** and depresses this number. The ≥180 min sub-cohort at read 1 already reads 31.65%.
2. **The ambient control must hold.** If ambient log/leaves rises above 10%, or ambient sapling rises
   above 1%, the instrument is not distinguishing planted cells from terrain and the read is
   **UNREADABLE**, not a failure.
3. **FAIL on inertness** — mature < 5% of readable cells at ≥10 h, with the ambient control holding.
   That is the outcome that says planting puts saplings where they cannot grow, and it **blocks the
   reseed** until the predicate is fixed, because a fresh world with inert planting answers nothing.
4. **REPORT-ONLY, no verdict attached** (named now so none is claimed later):
   - the underground split. Read 1: `y<55` n=40, **0 grew**, 21 still saplings; `y>=55` n=723, 286 grew
     (39.6%). `isPlantable` checks soil, a replaceable cell and the measured 5–7 block column and does
     **not** check light, so ~5% of plantings go where nothing can ever grow. Named, not fixed.
   - harvest attribution. `air` is ambiguous between a destroyed sapling and a grown tree the fleet
     chopped, and separating them needs a proximity/harvest join this read does not have.
   - the declared residual: `place` declares `args [item]` only, so all planting shares one
     `learned_avoid` key. Read 1: `_rule_contradicted` 900 rows post-deploy, **0 naming place**
     (positive control: the top contradicted subject is `gather:{"block":"dirt"}`); sapling `place` per
     hour 125/193/203/190 against `_plant_spot` 364/461/467/511. A closing gate shows place falling
     against a flat scan count. Re-read at +12 h.

## what this registration does NOT license

It does not license crediting the change with any items/bot-h number. `268c074` is fleet-wide, so the
only available contrast is a before/after, and a fleet-wide before/after cannot credit an effect — the
per-pool ratio spread on this fleet runs 0.46–2.66. Read 1's harm line is therefore recorded as
**"no aggregate harm signal detected in this window"**, which is the second engine's wording and is
weaker than "no harm": 5 deaths vs 7 over 307/320 bot-h is under the owner's two-death floor and a
favourable drift could mask harm.

## the reseed gate

The sixteen fresh worlds the owner asked for on 2026-09-27 are **downstream of read 2**, and of one
further condition the same review pass set in §4:

> "Do not batch-execute a missing reseeder with a stale eight-world map. Positive control before
> scaling: one completed pool must pass town validity, env-coordinate agreement, restored service
> health, and five real bots."

`scripts/reseed-pool.sh` is documented at `docs/reports/seed-canary-registration.md:11` and **does not
exist** on either host or in the repo, and `place-town.py`'s `ARMS` map holds **eight** worlds and
derives the RCON port from the index, against a sixteen-world fleet. Both are prerequisites, not
paperwork.
