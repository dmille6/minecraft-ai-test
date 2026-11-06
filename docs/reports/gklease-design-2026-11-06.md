# gklease-01: a grounds lease is held only by a bot that can work the grounds (2026-11-06)

Ledger row `gklease-1106`. Source: the coordinator, 11-06 ~18:30Z. After batch15 (17:09Z) no groundskeeper visit happened, and
forest-01 (siting, and retiring the old tree farm into a garden) waited behind a lease holder that was not working.

## Measured (`lib.telemetry`, main's copy, full walks)

**Showcase, live window 17:25 to 18:25Z** (9,412 rows, 13 bots, 34 build visits):
- The keeper lease went to Alpha 17:12:45Z, to Alpha again 17:43:51Z (after its own lapse), and to Kite 18:14:52Z. Kite's median
  y was 18, at a minimum of 14 to 17 while it mined iron; it was entombed at 17:43Z and 17:47Z.
- From 16:00 to 18:20Z there were **0 tidy and 0 forest visits**.
- Alpha's two visits went to repairs instead: `monument deps_open` and `paths complete`. activeProject puts repairs first, ahead
  of the keeper's own tidy.

**Showcase, 30 h** (349,376 rows, 15 bots, 1,063 build visits, 149 of them grounds visits):
- 38 keeper takes. **11 had no grounds visit** before the next take or 30 min, and 6 holders spent most of the term below y 55.
  The median term had 1 grounds visit.
- 37 helper takes, 1 of them with no visit.

**Fleet, 3 h on 9e9284d7 (gkforever-01)** (274,433 rows, 80 bots, 787 build visits, 543 of them grounds visits):
- 26 keeper takes. **7 had no grounds visit** and 8 holders were mostly below y 55.
- There were no helper leases. Crew mode lets non-keepers work the grounds.

**The mechanism:**
- The keeper lease is taken inside skills.mjs `keeperOrder`, which runs on every order read, wherever the bot is (in a mine, out
  of town). It is also taken at the start of a tidy visit.
- Only a grounds visit renews it, so it lapses after 30 min, and any bot, including the same one, takes it again.
- A keeper's own order still sends it to the town's other repairs first.

## The change (both trees; the pure rules in groundskeeper.mjs)

1. **Fit.** `groundsUnfit` returns `underground` when the bot is more than 8 below the town ground, `away` when it is more than
   128 from home, and null when the position is unknown. A **new take** is refused by an unfit bot. The check sits in both
   `takeKeeper` and `takeHelper`, so it covers the order's read and the start of a visit (Codex r1 blocker).
2. **Holder check** (`groundsLeaseCheck`, run on every order read):
   - A holder that is unfit, or has done no grounds work for 20 min (`groundsIdle`), releases the lease and rests 30 min. "No
     grounds work" means no successful tidy or forest visit since the latest of: the term's start, its last such visit, its spawn.
   - The release row is `_keeper op=keeper_release why=underground|away|no_work_visit`.
   - On the showcase, an unfit helper releases its helper lease too.
3. **The keeper's grounds first** (`keeperGroundsFirst`): while the grounds want work, the keeper's own order reads the town's
   other repairs as upkeep. Every other bot keeps the repair tier.
4. **Showcase cosmetic fix:** prodserve `stampAt` now treats a null start as no start. Before, `Number(null)` read as 0, so a
   never-served plot printed `last_min` in minutes since 1970; it now prints `never`.

Turning it off: `GKLEASE=off`.

## Reviews, tests, suites, tripwire

- **Tier 2**, not protected (hunk-level `protected.py`). Bot code only, no Paper or mineflayer behaviour, so one engine.
- **Codex r1** found 1 blocker: the visit start's takeKeeper/takeHelper bypassed the gate. Fixed in showcase b2ebf408 and fleet
  bd64f380. **Codex r2:** NO BLOCKERS.
- **Tests:** `gklease.test.mjs`:
  - the live Kite and Alpha scenes;
  - the chain: an unfit holder releases, rests, and another bot's next decision is `take`;
  - the keeper's pick going from paths to tidy while other bots keep the repair;
  - 4 anchored mutants;
  - a wiring check that fails when the acquisition gate is cut.
  - The showcase `prodserve.test` also covers `last_min=never`, and `gkhelpers.test`'s wiring regex follows the helper line.
- **Tripwire:** no new rule. `_keeper` rows are not read by shopread or showcase_trip (grep), and the piece logs no new `_build`
  op. Replay on .40:
  - `replaygate.py shapes` (old 3d985d36, new b2ebf408, the installed reader) found no unknown shapes (`[]`).
  - R2 with this piece's rows (2 `_keeper` releases, a `_service last_min=never` row) gave 0 new defects.
  - Control: an off-record cane harvest gives H2.
- **Suites** (`suite-run.py --ref`, ci2):
  - showcase b2ebf408: 455/456. The one FAIL is nothing-important-is-orphaned, from the known untracked `bagdiet.test.mjs` on
    the live base.
  - fleet bd64f380: 406/406.
- **Fleet registration** and a draft queue entry: `docs/reports/gklease-01/`.
