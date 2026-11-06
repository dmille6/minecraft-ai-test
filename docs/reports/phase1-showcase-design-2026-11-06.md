# Phase 1 item 4: the showcase stops only for harm (2026-11-06)

Owner, 11-06: "execute the code-evaluation phases with Claude + Codex designing, implementing, deploying and testing each element."
This is phase 1 item 4 of [codeeval-2026-11-06/README.md](codeeval-2026-11-06/README.md). Evidence:
[codeeval-2026-11-06/showcase.md](codeeval-2026-11-06/showcase.md). It is PROTECTED scope (the tripwire): two engines review
each piece, blockers only. Branch `showtrip-01`. Each item has a Claude design and an independent Codex design (`codex exec -s
read-only`, given the goal and the measurements, not the Claude design); the reconciliation follows each item.

## The numbers this rests on (live .40 data, 10-22..11-06)

- **Trips.** 263 reads logged; 12 TRIPs. 7 were S6 (H1 x4, H2 x2, H4 x1), all false. 4 were S5 G3: 2 marginal, 1 false, 1 a
  real access hole. 1 was S4 (10-31 02:35Z, the trial-chambers fence and 2 planks): true. Downtime was 9.7%, and 85% of it was
  two overnight waits for a human.
- **Z1 and S2 were blind.** Neither Z1 (trapped in a zone) nor S2 (stuck) fired in 253 reads; S2 printed `none` in all 253.
  - Cause: about half of a bot's rows carry no `bot.pos`. `still_spells` read each of those rows as "outside the box" and
    restarted the spell. In a live hour of showcase-Gale: 877 rows, 463 with a position, the largest gap 35 s, 0 spells found.
  - Full replay over the history: 2.00 M rows, 1.52 M with a position. As installed: 0 Z1 spells, 0 S2 spells. With the fix:
    7 Z1 spells, 51 S2 spells and 6 "legal ground" spells.
  - The 7 Z1 spells: showcase-Alpha 11-01 (19 and 83 min), Haven 11-04 (86 min), Gale 11-05..06 (133, 875, 212 and 625 min).
    Gale is still trapped now, at 64.5,58,38.5 in village-taiga-6_1, since 11-05 ~03:00Z (32 h). Every half hour it logs about
    30 `_protect_zone` minute rows and 25 `_protect_zone_refused` rows, and it never moves more than 1.3 blocks.
  - Haven and Alpha were real traps too: `_path_noPath` / `_path_no_legal_move`, and the zone refused the transit pillar.
- **Crash loops.** The tripwire had no crash-loop detector. systemd's own lines since 10-25 (5,729 mcshow lines) hold 68
  "Scheduled restart job" lines, all between 11-04 22:00Z and 11-05 03:30Z, across all 15 units. Per unit that is at most 2 in
  any 60 min, but 3 to 5 in 180 min, so rollout.py's 3-in-60 rule would never have seen it.
- **The follower.** It wrote ROLLBACK on 290 of 446 rows, with auto=false on all 446.
- **WATCH noise.** WATCH was the verdict on 199 of 253 reads. Two lines were on nearly all of them: DEEP and tree debris.
  The WATCH verdict itself stays on 187 of those reads, because of `conformance UNJUDGED`: the showcase has no survey job, so
  this gate is blind on every read. It is a real blind gate and is kept as WATCH; the finding goes to the owner.
- **haltwatch.** During a stop it returned "NO mcshow@ units found -- census is wrong", because `disable --now` unloads the
  units and the census ran before the stop row was read. A planned restart read as HALTED, because start-bots.sh wrote no row.
- **The hand replay.** The release agent's hand replay ("new-kind grep ... PRE-ACTIVATION REPLAY", 11-06 08:39Z) is now
  mechanical. Over the 28 real releases staged 11-03..11-06, each judged against the reader live at its staging, the new gate
  flags two:
  - `7b5524df` (coverdig-01show, 11-05 19:01Z) is flagged `_build:kind=cover`. That is the release behind the 11-05 23:35Z
    false trip.
  - `0e8a1cfa` (11-05 05:34Z) is flagged `_build:result=misplaced`. It needs a reader rule or a declaration.

## Item 1: stop only for harm (showcase_trip.py `classify`)

**Claude design.**
- `verdict()` becomes `classify()`, which keeps every reason in one of four lists: harm, report, watch and quarantine.
  `verdict()` still returns `(verdict, reasons)`, now TRIP / REPORT / WATCH / OK.
- **HARM** (TRIP, rc 2) is:
  - S0: no bot wrote a row (judged against the ENABLED roster);
  - S1: 4 or more deaths in 180 min;
  - S3 Z1, when `ZONE_TRAP_WORLD` = 3 or more bots are trapped at once;
  - S4: BREACH;
  - S6 H3 zone and S5 G5 zone (`HARM_GATES`);
  - S7: a crash loop, meaning 3 or more restart jobs of one unit inside 180 min (systemd's `_PID=1` lines).
- **REPORT** (rc 0) is every other defect gate: S5 D1-D5 and G1-G4, S6 H1, H2 and H4-H8. haltwatch pages these tier 1.
- **The accounting is unchanged.** `defect_items`, `unacked`, the ACK.json multiset and the prune all work as before; only
  the consequence changes.
- **Z1 with fewer than 3 trapped bots is a QUARANTINE.** trip-cron runs `showcase_ops.py quarantine`, which stops only those
  bots' units. The event is journalled and paged. The trapped bot is the one that ends up breaching a zone to escape (10-31),
  and the other 14 keep working.
- **The Gale gap.** A row with no position is not a sample: it neither ends a spell nor advances the gap clock. The 5-min gap
  rule now applies between samples that carry a position.
- **Noise.** S3 DEEP and H2 tree debris are counted on a REPORTED line and are no longer WATCH.
- **trip-last.json** also carries `harm`, `reports`, `watch`, `quarantine`, `new_items` and `harm_evidence` (the times of
  the deaths, the restart jobs and the start of each Z1 spell).

**Codex design (independent).**
- The same HARM / REPORT split and the same accounting.
- An explicit UNKNOWN safety hold, which would STOP when harm cannot be judged.
- A Z1 stops the world: "per-bot quarantine requires separate roster, lease, recovery, and isolation guarantees".
- S0 stays a stop.
- The same still_spells fix: skip missing positions and enforce the 5-min gap between valid positions.
- Crash loops at 3 or more per unit per 60 min.

**Reconciliation.**
- Adopted from Codex: the exact spell fix; S0 stays harm; every coexisting class is kept; journal unreadable = WATCH, never
  invented crashes.
- **UNKNOWN stays WATCH, not a stop.** The owner asked to stop only for harm. Today's blind gates are UNKNOWN: an S4 stale
  mirror, an unreadable zones file, g5_unjudged and conformance UNJUDGED. These are on most reads (187 of 253 for UNJUDGED
  alone), so a stop on UNKNOWN would stop the world more often than today.
- **Z1 quarantine (Claude), not a world stop (Codex).**
  - Measured: with the fix, Z1 would have stopped the world on 11-01, 11-04 and 11-05.
  - Gale's dead end has no remedy short of phase 2's escape fix, so a world-scope Z1 latch would keep the showcase down until
    that fix ships. Today Gale has been trapped 32 h.
  - Codex's guarantees, as implemented:
    - roster: S0 judges the enabled units;
    - leases: the bot's leases expire as they do on any stop;
    - recovery: start-bots.sh brings it back, and a re-trap re-quarantines it;
    - systemic: 3 at once stops the world.
  - Setting `ZONE_TRAP_WORLD = 1` gives the literal rule. **Owner decision** (below).
- **Crash-loop span: 180 min, not 60.** The one real crash-loop incident (11-04/05) was invisible at 60 min. 3 restarts in
  180 min fires on it.

## Item 2: auto-rollback (showcase_ops.py `remedy_plan`, `trip-remedy`)

**Claude design.**
- trip-cron hands a HARM read to `trip-remedy`, which always stops the bots first.
- Then `remedy_plan` (pure) rolls back only when ALL of these hold:
  - `/srv/showcase/trip/AUTO_ROLLBACK` is present (the deploy switch);
  - the live release's newest `activated` row (the switch) is no more than 3 h before the read;
  - that switch was not itself `cause: auto-rollback`, and this release was never rolled back before (one attempt, never a
    chain);
  - the switch names a `previous` that agrees with RELEASE.json's `prev_release`;
  - every harm class happened after the switch:
    - S1: 4 deaths after it;
    - S7: 3 restarts of one unit after it;
    - Z1: a spell that began after it;
    - S0, S4, H3, G5: the read itself is after the switch.
- The executor:
  - checks that the target is staged, admissible and carries REQUIRED_KEPT;
  - activates it with `cause: auto-rollback` (the world snapshot first, as every activation);
  - journals `auto-rollback`;
  - releases the ops lock and runs start-bots.sh (its gate and 10-min verify), journalled `auto-rollback-start`.
- **World damage (S4, H3, G5) rolls the code back but keeps the bots STOPPED.** A code rollback cannot replace blocks, and an
  unrepaired S4 reads BREACH on every later read. The owner's one-off repair, then start-bots.sh, ends it (as on 10-31).
- Any doubt leaves the bots stopped. If the remedy itself fails, trip-cron falls back to a plain stop-bots.

**Codex design.** The same, with three additions: activation "episodes" with attributable evidence; S4 rolls back but stays
stopped until a fresh INTACT; a Z1 latch that survives restarts. Codex also proposed an interrupt signal that would cancel an
operation already in progress, and a persisted reservation for a rollback interrupted mid-way. It names the request's mistake
as an "unconditional rollback-restart".

**Reconciliation.**
- Adopted: episodes (the newest `activated` row of the live release, plus `cause`), attribution by evidence time, S4 / zone
  damage stays stopped, one attempt, predecessor agreement, and an explicit start (activate() alone restarts nothing once the
  bots are stopped).
- Not adopted: the interrupt signal and the persisted reservation. The single ops lock already serialises the steps, and the
  remedy re-reads the harness under that lock. A remedy that dies mid-way leaves the bots stopped, which is the safe end.

## Item 3: a planned restart clears a stop (start-bots.sh, haltwatch `showcase_lifecycle`)

**Claude design.**
- start-bots.sh journals `start-requested`, then `start-verified` (release, version, run epoch) or `start-failed` (gate, env
  build, verify, model share).
- haltwatch's pure `showcase_lifecycle` holds a stop open until a later `start-verified` (or the legacy
  `start-bots-after-restart` rc 0). An intervening stop wins. A quarantine is expected-down until the next verified start.

**Codex design.** The same lifecycle reducer, and "an `activated` row alone no longer clears anything".

**Reconciliation.** Agreed; implemented as Codex states it. (A rollback's `activated` row also does not clear its stop; its
`start-verified` does.)

## Item 4: the pre-activation replay is a gate (replaygate.py, `stage --piece` / `--main`)

**Claude design.** `replay_admit` runs before staging and refuses on any of three findings:
- **R1 new shape.** The candidate's `bots/src` logs a row of a kind the reader judges (the reader's own ROW_KINDS) with a new
  field or a new op / kind / seg / ... literal. "New" means the release it replaces never logged it, and the candidate reader's
  source never names it. The remedy is the reader rule (`--reader <file>`) or `--reader-ok 'kind:field=value'`, which is
  journalled.
- **R2 new defect.** The candidate reader, replayed with `showcase_trip.py items` over the live history from the town epoch
  (plus `--replay-rows`, the candidate's own Paper / offline rows), lists an item the installed reader does not. Items are
  compared as multisets, and a defect that disappears is fine.
- **R3 broken.** The candidate reader fails the tripwire's own selftest. That selftest plants an off-record placement, a zone
  placement and a bag loss, so a reader that judges nothing cannot pass.

The record rides in RELEASE.json's gate.

**Codex design.**
- Bundle the reader into the release with digests.
- Run the candidate's emitters in an isolated environment against the captured live context.
- Map a field inventory to executed fixtures; "grep alone cannot prove dynamic shapes covered".
- Multiset comparison, positive harm controls, and receipts bound to code, reader and inputs.

**Reconciliation.**
- Adopted: multisets, the positive control (R3), and binding (the reader's sha256 in the record).
- Kept Claude's static R1 and live R2, with the candidate's own rows as an optional input. Running emitters in isolation is a
  sandbox per release: the larger refactor Codex describes (codeeval S2/S6 "move shopread into the release"), not this piece.
- The measured cost of the cheap gate: 2 flags in 28 real releases, 1 of them the real 11-05 false trip.
- Known limits:
  - a literal the reader happens to name in another context reads as known: `first` was not flagged for fell-first, because
    the reader already says `first=` elsewhere;
  - a record-meaning change (the 11-05 retired wall cells) is not a row shape, so it needs `--replay-rows`.

## Item 5: noise and the wrong message

- **Follower.** `follow_record`: an observe-only follower writes decision OBSERVE, with the rule's answer under `rule`. It
  never writes a ROLLBACK, DUE or STOP it cannot act on. Codex: the same (`follow_mode`).
- **WATCH noise.** S3 DEEP and H2 tree debris go to the REPORTED line (item 1).
- **haltwatch.** The stop row is read FIRST. During a stop, an empty or unreadable census is the stop, named with its reason
  and its remedy plan, never "census is wrong". The grace periods:
  - a tripwire stop with no remedy row yet: 5 min (stop-bots takes about 3 min);
  - plain stop or rollback-stopped: none (paged at once);
  - rollback-restart: 30 min, the time to verify;
  - a deliberate stop: 15 min.

## Item 6: .40 on the new pager

- `~/pager/app/scripts` on .40 is copied from main. The w5alarms crons (haltwatch, goalwatch, rollout check) are repointed
  there, with the delivery checks, tiers, outbox, acks and the 12:30Z digest (`pager.py digest`).
- The old `/srv/showcase/bin/alarm.py` (restack_prep, root) is replaced by the same file. Because root and mike share
  `~/digest`, the lock files and the delivery log are pre-created mike-owned.
- haltwatch is now the showcase's one pager front end:
  - REPORT gates are source `showtrip`, key `report:<gate>`, tier 1, re-pushed every 2 h until acknowledged in the pager or
    in ACK.json;
  - a read older than 130 min while the bots run pages `trip:stale`;
  - `auto-rollback`, `auto-rollback-start` and `quarantine` rows are paged once each (a cursor, starting at the end).
- Codex: the same, with "the tripwire owns incident pages; haltwatch enriches"; here haltwatch is the single producer, so
  there are no duplicates.

## The 14-day replay (infra/showcase/trip_replay.py over the live trip.log, deploy.jsonl and systemd journal)

| | old | new |
|---|---|---|
| reads | 253 (OK 42, WATCH 199, TRIP 12) | |
| the 11 false or marginal S5/S6 trips | TRIP | **REPORT** (paged, no stop) |
| 10-31 02:35Z S4 trial-chambers BREACH | TRIP, then 11.4 h overnight | **TRIP**: 2707f20c had been activated 87 min before, so the code rolls back to a50a6782 and the bots stay stopped until the repair (still stops) |
| 11-05 00:36Z crash loop (the 11-04 22:00Z .. 11-05 03:30Z restarts) | WATCH (never seen) | **TRIP** (S7): a plain stop, since the restarts began before the 22:54Z switch |
| Z1, with the fix (7 spells) | never | 3 quarantines: Alpha 11-01, Haven 11-04, Gale 11-05. Never 3 bots at once, so never a world stop |
| WATCH -> OK | | 6 reads (the rest keep conformance UNJUDGED: no survey job) |

Command: `python3 infra/showcase/trip_replay.py --trip-log trip.log --deploy deploy.jsonl --journal pid1.json`. The positive
control is the logged verdict counts.

## Tests

- `showcase_trip.py selftest`, with the reads beside it. It now covers:
  - the classes: every defect gate is REPORT except the zone gates; mixed classes are all kept;
  - the Gale spell, the gap between positioned samples, and the moving control;
  - crash loops: the span, FIXTURE, and an unreadable journal;
  - the enabled roster, quarantine versus world stop, and tree debris on the REPORTED line.
- `test_showcase_trip_mutants.py`: 30 of 30 mutants killed, 13 of them new.
- `test_showcase.py`: 152 tests, including TripRemedy (the 10-31 shape, the 3-h boundary, attribution, never a second
  rollback, fail closed, world damage), FollowObserve, ReplayGate (R1 on the cover shape), and the stage commands gated by the
  replay.
- `test_showcase_mutants.py`: 70 of 70 mutants killed, 12 of them new.
- `test_w5alarms.py`: haltwatch's lifecycle, census and graces, events and reports. 43 of 43 mutants killed.
- `replaygate.py selftest`.

## Deploy order (one piece at a time, backups, never while a release is mid-flight)

1. **Item 6 + haltwatch (items 3, 5).** The pager tree and the crons on .40, then start-bots.sh's journal and haltwatch.
2. **Item 5 follower.** `showcase_ops.py` follow_record. The whole file is installed, with trip-remedy and quarantine dormant
   until trip-cron calls them.
3. **Item 1.** `showcase_trip.py` plus trip-cron.sh. **Gale is trapped now: the first read after install quarantines Gale**
   (its unit stops; the world goes on).
4. **Item 2.** `touch /srv/showcase/trip/AUTO_ROLLBACK`.
5. **Item 4.** `replaygate.py` beside showcase_ops (installed with step 2). The replay runs at every stage from then on and is
   recorded in RELEASE.json's gate (`ok`, `enforced`). It refuses only once `/srv/showcase/REPLAY_GATE` exists; before that,
   a failed replay is a printed WARNING. The release agent then stages with `--reader` / `--reader-ok`.

Before each install: no `staged` row newer than the newest `activated` row in `/srv/showcase/ops/deploy.jsonl`, and
`/srv/showcase/ops.lock` free (`flock -n`). Backups go to `/srv/showcase/backup-phase1-<T>/`. Never `showcase_trip.py ack`.

## Owner decisions

1. **Z1 scope.** One or two trapped bots are quarantined (their own unit stops) rather than stopping the world. Three or more
   at once stop the world. Set `ZONE_TRAP_WORLD = 1` for the literal rule; measured, that would have kept the showcase down
   since 11-05 03:35Z on Gale alone.
2. **conformance UNJUDGED** was on 187 of 253 reads: the showcase has no survey job. **ANSWERED 11-06:** the survey job goes
   in phase 3 (the shared project registry). Until then, with NO survey source, UNJUDGED is counted on the REPORTED line, not a
   WATCH. With surveys present the gate judges as before (r3 below).

## r3 (OWNER 11-06): UNJUDGED with no survey source is counts-only

- `shop_read` sets `no_source = not (surveys and surveys[0])`. With no source, a completed workshop's UNJUDGED goes to
  `conformance_unjudged_no_survey` on the REPORTED line. With a source, it stays a WATCH, and a failing F1 is still H8.
- Selftest: both cases. Mutants: 33 of 33 killed (2 new).
- One Codex round, 1 blocker: the replay treated UNJUDGED as counts-only even when surveys existed. Fixed: the replay
  counts it only when the read's own EXPOSURE line says `surveys False`.
- Replay: WATCH -> OK is still 6 reads. The remaining WATCHes are `g5_unjudged (blind)` on 193 reads, also always-on, and
  STALLED on 140 (a real stall signal). Both are kept. g5_unjudged is the next owner question.
- Z1 scope: OWNER 11-06 keeps the quarantine (1-2 bots; 3+ stops the world), ZONE_TRAP_WORLD as is.

## Reviews (two engines, blockers only)

- **Round 1.**
  - Claude agent: 1 blocker. A mutant anchor was no longer unique, because `cmd_items` duplicated it.
  - Codex: 3 blockers.
    - Already-ended traps were counted as "3 at once". Now Z1 acts only on a bot trapped NOW (`trapped_now`).
    - trip-remedy released ops.lock before start-bots. start-bots.sh now has a lock-held mode, and the lock is kept through
      the restart.
    - The approved reader was never enforced. activate now refuses unless the installed reader's digest is the approved one.
  - All four fixed, with tests and mutants.
- **Verify round.** NO BLOCKERS from both engines. One Claude note, the re-stage remedy text, was applied.
- **Full suite.** ci2 at 5d9a3f82: 417/417 files passed.

## Deploy log (10.0.0.40, 11-06)

Before each install: no stage pending (the newest `staged` row was already activated) and `ops.lock` free. Backups are in
`~/pager/backup-20261106T114441Z/` (crontab, w5alarms) and `/srv/showcase/backup-phase1-20261106T114441Z/` (alarm.py,
start-bots.sh, showcase_ops.py, showcase_trip.py, trip-cron.sh).

| when | piece | verified |
|---|---|---|
| 11:44Z | item 6: `~/pager/app/scripts` (showtrip-01 libs + haltwatch / goalwatch / rollout / pager); 3 crons repointed; 12:30Z digest cron; `/srv/showcase/bin/alarm.py` = main's; start-bots.sh start journal; digest lock and log files pre-created as mike | `pager.py selftest --push`: DELIVERED (HTTP 200); 11:45Z haltwatch "15/15", showtrip reports none; 12:30Z digest push DELIVERED |
| 11:50Z | item 5 follower + dormant remedies: `showcase_ops.py`, `replaygate.py` | 12:05Z follow row: decision OBSERVE, rule ROLLBACK aea83708, auto false |
| 12:10Z | item 1: `showcase_trip.py`, `trip-cron.sh` | `selftest ok` (palette included). 12:35Z read: VERDICT REPORT; Z1 trapped now showcase-Gale -> QUARANTINED (`quarantine` row; unit disabled; 14 of 14 running). 12:40Z haltwatch paged it once (DELIVERED); "running 14/14; quarantined (Z1): showcase-Gale" |
| 12:40Z | item 2 `/srv/showcase/trip/AUTO_ROLLBACK`; item 4 `/srv/showcase/REPLAY_GATE` (an `ops-note` row in deploy.jsonl tells the release agent) | remedy_plan on the live journal: an S0 at 09:35Z would roll back b1d5b17e -> 79bc6085 and restart; at 12:40Z it is a stop (4.0 h > 3 h). Replay smoke b1d5b17e on 79bc6085: PASS, both against the installed reader and the pre-FF1 reader (0 = 0 items over 2.0 M lines / 87,280 kept rows, ACK empty; the reader's selftest is the positive control) |

**Rollback (any piece).** Restore the file from the backup directory. `rm /srv/showcase/trip/AUTO_ROLLBACK` stops the
rollbacks, and `rm /srv/showcase/REPLAY_GATE` turns refusals back into warnings. `crontab ~/pager/backup-*/crontab.before`.
Gale comes back with the next start-bots.sh, and is quarantined again while it stays trapped.
