# prodserve-01: finished production projects keep producing (2026-11-06)

Ledger row `prodserve-1106`. Source: the daily project audit (projectaudit-01, main 6fc0301c; `~/digest/projectaudit/` on the
showcase VM), 11-06 14:04Z: cropfarm DORMANT, canefarm UNDERUSED, storehub UNDERUSED, dress BROKEN. The tree farm (the same
failure, 10-31) belongs to the managed-forest piece and is not touched here.

## 1. Measured

`lib.telemetry` (main's copy) full walk over `/var/log/mcai/showcase-*/skill-*.jsonl*`, rotated files included.
Window 11-04 08:00Z to 11-06 14:20Z (54.3 h): **832,928 rows, 15 bots, 3,305 `_build_visit` rows.** World reads use RCON
`execute if block` (read-only) on the cells the records name.

| project | finished | visits since | the world now | why it is not served |
|---|---|---|---|---|
| canefarm | 11-04 21:38Z | **0** in 1.7 d | **7 of 8 cane cells 3 tall (ripe)**, 1 open | its harvest is only `due` |
| cropfarm | 11-04 08:29Z | **0** in 2.2 d | all 10 crop cells air, all 10 till cells grass_block (`hydrated: 0`) | `due` only, and it finished with nothing planted (below) |
| storehub | 11-05 09:05Z | 10 (stuck_on_cell 2, cell_deferred 2, no_material 2, complete 2, other 2) | the earth cell 15,69,-53 reads cobblestone since the 14:01Z visit | **0 `_storehub_clerk` rows ever**: the clerk is `due` only, and only while the hall reads undamaged |
| dress | complete (5 batches, 65 cells) | 9 since 11-05, 5 failed repairs in 12 h | L1-light 20,73,-20 is air; the column 20,-20 is air from y 67 to 75 | its support was dug by another project |

Positive controls (the same walk): 3,305 build visits split tidy 1,181, storehub 566 (556 before it finished), storehouse 316,
shaft 193, wallext 155, paths 153, and so on down to cropfarm 14 and canefarm 13, all before each finished. Since 11-05 09:05Z
the commonest outcomes were visits that did nothing: paths `complete` 113, shaft `complete` 72, monument `complete` 37.
`_storehub_mode` rows: 2,819 (`on=1 clerk=1`), so the build can log the clerk's row. It has never had the chance.

**The cause.** `shop.mjs activeProject` offers the tiers in this order: repairs, then free open projects, then (with a sink) the
`dueFirst` upkeeps and the sink, then the other `due` upkeeps. A finished farm's harvest and the hall's clerk are `due`
(`skills.mjs recordDamaged`: a farm is never damaged, its harvest is upkeep). The showcase always has an open project or a sink
(stepwell, tower, tidy, town hall, enchanting workshop), so `due` is never reached. The hall's upkeep visit
(`buildShopVisit`) also required `!recordDamaged(tidy: false)`, so one unreachable earth fill cell kept the clerk off for a day.

**The crop farm finished empty.** Its completion rule accepts "every crop cell passed for want of seed after a gather that found no
source". The gather found 65 grass blocks within range and 0 targets once the reservation guard was applied, and no bag held a seed.
The till then dried back to grass. Now 3 bots hold 1 wheat seed each (Juno held 4 in the last 24 h). A bot with seeds has a
`replant` reason (`cropDue`), and its visit tills and plants.

**The dress light.** L1-P3 was a wall-top torch placed 11-04 03:47Z (Juno, `op=place seg=L1-P3 cell=20,73,-20 block=torch`) on the
old wall. The wall demolition (walldemo g2, 114 demolish clears, complete 11-05) lists 20,72,-20 among its clears, so the torch
dropped. The wall record's cells there are retired. The light cannot be placed (nothing to stand on or against), and as damage it
headed the repair tier for every bot: stuck_on_cell x3, cell_deferred x2. The stone sinks' waiver (sinkwaive-01) leaves out dress
on purpose. It also waives only on deferral counts and refuses a complete record.

## 2. Design (Claude)

**A SERVICE tier** (`bots/src/prodserve.mjs`, pure).
- `SERVICE_PLOTS` lists each plot and its gap: cropfarm 45 min (reasons harvest, replant), canefarm 60 min (harvest, replant),
  storehub 30 min (any clerk work). The managed forest joins by adding its plot.
- `servicePick(states, { stamps, botLastAt })` takes a complete service plot whose own due test names a service reason for this bot
  (`serve`: `cropDueFor`, `caneDueFor`, `hubUpkeepDue`), when both of these hold:
  - **the town schedule.** No service visit has started there within the plot's gap. The start is kept as stamp GENERATIONS
    (`<key>.service.g<N>.json`), each created exclusively (open 'wx'), so a claim is a compare-and-swap on the generation the pick
    read: of 15 bots at once, one wins and the rest work something else (Codex r1 blocker 2). The newest 4 are kept.
  - **the fair share.** This bot has not served anything in 20 min. A visit takes 1 to 3 min, so service is at most about 15% of a
    bot's turns, and building keeps the rest.
- The most overdue plot goes first, and a never-served plot before all others.
- **A plot in its stuck back-off is never picked** (Codex r1 blocker 1): the order's own stuck gate would refuse it, and the bot
  would get no orders at all for the 6-h back-off.
- **The offer gate** generalises that fix. If the bot has been offered a pick for 15 min and no visit has started (the order
  refused it for room, a held slot, health or a cooldown), the pick is dropped and charged to the bot's share, so its building
  comes back.
- `activeProject(..., { service })` returns the service plot **first**, ahead of repairs, open projects and sinks. Repairs that do
  nothing are common (the 113, 72 and 37 above), and the fair share bounds what service takes from them.
- `shopActive` reads the stamps and puts `serve` on the states. It writes the stamp and one `_service` row only on the visit's own
  call (`visit: true`). The order's calls (shopKey, activePlotOf) compute the same pick without consuming it.
- A visit that never happened (`IDLE_NOT_A_VISIT`: slots_full, aborted, and so on), or a claim the visit's pick did not use, marks
  its own generation `.released` (`stampReleaseDue`), which reads as the previous start. The bot's share stays, so an interrupted
  bot does not re-pick at once.
- The order path needs no change: `cognitive.mjs` passes `complete = structure_complete && !shopDamaged`, and `shopDamaged` reads
  `recordDamaged(tidy: true)`, which is true while the farm or hall is due. A service pick therefore issues an order.
- **The hall.** On a service pick, its upkeep visit runs even when a cell reads damaged. The repair stays in its own tier.
- **Dress host-gone** (`towndress.mjs dressOrphans`, `sinks.mjs sinkWaivedKind`). A light cell is orphaned when all of these hold:
  - the cell reads unlit air;
  - its support reads loaded and not a full block. This mirrors the siting rule, since `wallTopCandidates` requires a full block;
  - the support is not this record's own post cell. A post is a repair: the post goes back first;
  - the support is not another record's live cell (`shopCellsNow`). The wall's own repair restores a wall block a bot dug.

  `buildSink` waives orphans before the visit, including on a complete record (`op=waived why=host_gone`), and the dress visit
  reads waived lights done. `SINKWAIVE=off` turns the waiver off.
- **The switch.** `PRODSERVE=on|off`. It is on in the showcase pool only (`PRODSERVE_POOLS`). `PRODSERVE=off` restores the old
  picker exactly.

## 3. Codex's independent design (read-only, same measurements; summary)

1. **Root cause.** Codex found the same one: completion ends service. `dueFirst` and `upkeepTurn` only reorder later tiers, the hub
   dispatch requires an undamaged record, and crop completion allows an empty bed.
2. **A generic SERVICE lane.** A registry with adapters (observe, eligibleBot, plan, execute) and a pure arbiter. Service
   dispatches before repairs. Fairness is a persisted town-wide cycle **SERVICE, BUILD, BUILD** behind a short town scheduler
   lease, with project service leases checked by generation. Crops and cane are inspected every 5 min, the clerk every 3 min.
   Unknown or unloaded reads schedule an inspection visit. Seed carriers are preferred.
3. **The hub.** Operational checks (reachable intake and destinations) instead of whole-record integrity, so the unrelated earth
   cell does not block sorting.
4. **Seeds.** Seed holders first, then banked seeds, then gathering. Allow seed grass on the farm's own cells. Wider searches
   with persisted back-off, never weakening the shared guard.
5. **Dress.** Semantic retirement only when the support is absent **and a completed demolition record clears that support**. The
   retirement applies everywhere (damage, progress, spacing), and a replacement fixture is queued.
6. **Telemetry.** `_service_visit` start and end rows with a visit id, linked to the harvest and clerk rows.
7. **Tests.** Pure `chooseService`, `serviceNextState`, `hubOperational`, `seedRecoveryPlan` and `dressRetirement`, plus
   dispatch and admission integration tests.

## 4. Reconciliation

| point | Claude | Codex | decision |
|---|---|---|---|
| tier position | first, before repairs | first, before repairs | **agreed** |
| fairness | per-plot town gap + per-bot 20-min share | town-wide SERVICE,BUILD,BUILD cycle + scheduler lease | **Claude's**: the work needed is small (3 plots, one visit each per 30 to 60 min, under 5% of the ~60 visits/h). A 1-in-3 cycle would take far more than that, and its scheduler lease adds a second lock to the picker. Revisit if a forest and more farms push service volume up. |
| claim | the stamp is the claim (gap from start); the farms' own slot leases (crop 2, cane 1) and the clerk lease stay | scheduler lease + service leases | **Codex's point taken in review (r1 blocker 2):** the stamp is an exclusive generation (compare-and-swap), not a rewritten file; no separate scheduler lease |
| inspection of unknown reads | not served (an unloaded farm reads `null`) | schedule an inspection visit | **residual risk, recorded**: the cane bed is ~90 from home, inside a town bot's loaded range. Add an inspect reason if the audit shows a loaded-chunk gap |
| hub on damage | service runs the upkeep past a damaged cell | operational checks | Claude's for now (the clerk's own walks fail per chest with `unreachable`). Codex's operational check is a follow-up |
| seeds | seed holders get `replant` (cropDue); the gather unchanged | + own-cell grass, wider search | **follow-up piece** (`cropseed`): the guard composition needs its own tripwire rule (seedgrass_ok) |
| dress rule | support not a full block and not any live record cell | + a completed demolition must list the support | Claude's is broader: no fixture kind stands on a non-record support (lamps on their own posts, wall tops on wall cells), so it is equivalent for every fixture today and also covers a retired wall without a demolition. Codex's caution is kept: a live record cell, the record's own post and an unread block are never orphans |
| replacement fixture | the dress sink keeps siting batches (walltops on the extension) | queue one | agreed in effect |
| telemetry | `_service` start row; the outcome is the project's own `_build_visit` / harvest / clerk rows | start + end rows with ids | Claude's: the audit counts harvests and clerk runs, which already exist |

## 5. Pieces, tiers, queue

| piece | lane | tier | state |
|---|---|---|---|
| **prodserve-01show** (service tier + hub past damage + dress host-gone) | showcase | 2 (not protected: `protected.py --base b1d5b17e`) | built `prodserve-01show` @ de3a6624 on b1d5b17e, ready to stage |
| PS1 shopread rule (dress op=waived and `_service` rows are no defect) | showcase tripwire | with the piece | main, this commit |
| cropseed-01 (seed gather on the farm's own cells, wider ring) | showcase | 2 | follow-up |
| forest service (the managed forest adds its plot to SERVICE_PLOTS) | showcase | with the forest piece | the forest agent |
| fleet port | fleet | 2 | after a 24-h showcase read shows harvests and clerk runs |

**Queue (Claude).** Showcase lane, the next batch after the live b1d5b17e (batch14d). It touches only the picker's head and the
dress sink, and none of the pieces being staged now. **Codex:** the same lane. The order inside a batch is the release agent's.

## 6. Reviews, suite, replay

- **Codex r1** (blockers only) found 2 blockers, both fixed in d0acdabf:
  1. A stuck service plot held every order of the bot.
  2. The stamp was not an exclusive claim.
- **Codex r2:** NO BLOCKERS. e436decb then releases a claim that was never used.
- **Suite** (`suite-run.py --ref e436decb`, ci2): 451/454.
  - FAIL nothing-important-is-orphaned: `bagdiet.test.mjs` is untracked on the live base, as it was before this piece.
  - FAIL ordernowait and wall-wiring: their source anchors sit on the two lines this piece changed. Fixed in de3a6624 (one line
    moved, one expected string), and both pass alone. Behaviour is unchanged.
- **Tier 2** (not protected; `protected.py --base b1d5b17e`). The piece rests on no unseen Paper or mineflayer behaviour, so one
  engine reviewed the bot code.
- **shopread PS1** got two engines:
  - Codex found 1 blocker: no test covered G6 judging the waiver's feet. Fixed with a positioned regression; no judge change.
  - An independent Claude reviewer found NO BLOCKERS.
  - The selftest passes and 193/193 mutants are killed.
- **Replay** on the showcase VM:
  - `replaygate.py shapes` (old b1d5b17e, new prodserve-01show, candidate reader) finds no unknown shapes (`[]`).
  - The candidate reader, replayed over the live history plus this build's own rows (two `_service` rows, two cane harvests,
    the dress waiver), gives **0 new defects** (27 items installed, 27 candidate).
  - Positive control: an off-record cane harvest at the bottom block gives H2 `clear_outside`.

## 7. Paper / mineflayer facts it rests on

None new. The harvests, plantings and clerk moves are the existing visits, already proven (cropfarm-01, canefarm-01, storehub-01
Paper scenes). Vanilla facts: sugar cane grows to 3 by random ticks (about 18 min a block at the default tick speed), and a
torch with its support removed drops as an item. Both are seen live (7 of 8 cells 3 tall; 20,73,-20 empty). No sandbox proof is
needed.

## 8. Effect and tripwire

- **Effect.** projectaudit verdicts go to EFFECTIVE: canefarm at least 8 cane cut/day, cropfarm at least 8 crops/day (once seeds
  bootstrap), storehub at least 2 clerk runs/day. dress upkeep has no failed repair once the waiver row appears. Read 24 h after
  activation with `projectaudit.py` and `lib.telemetry` (`_service` rows by plot, `_build op=harvest` by project, `_storehub_clerk`
  status, the denominators: build visits, bot-hours).
- **Tripwire.** shopread PS1 (selftest + in-selftest mutant + one harness mutant; 193/193 mutants killed). Service visits log only
  rows the reader already judges: G9 crop harvest, CF1 cane harvest, a farm's place and replant, and SH1 the clerk.
