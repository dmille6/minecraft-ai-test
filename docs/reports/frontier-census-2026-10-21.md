# E0, the frontier census: built, reviewed, installed (2026-10-21/22)

Spec: `docs/reports/expansion-plan-2026-10-19.md` section 4 (and 1.1-1.3). Branch `frontiercensus-02`.
Installed on 10.0.0.31 at **2026-10-22 00:19Z** from `173163bc`. **The 48 h warm-up ends 2026-10-24 00:20:26Z.** Until
then nothing is written under `/var/lib/mcai`; after it, the publisher writes `frontier-<home>.g<N>.json` into each shared
town's `_pool-<pool>` dir. No bot reads that file yet (checked below), so publishing cannot change behaviour.

## What it measures

- **Visit map, per shared town.** A 64 x 64 region grid anchored on the origin, out to 1,000 blocks from home and inside
  the border minus 64. It is folded from the END position of every positioned skill row in ES (`mcai-skill-agents`, from
  10-08 00:00Z, 14 days at most), not from samples. Each region records rows, bot-minutes, and first and last visit.
- **Frontier status.** A region is `visited` if any row ended in it in the window. It is `not_observed` only when every
  day of the window is covered; otherwise it is `unknown`. It is never reported as "unvisited" or "reachable".
  - **Coverage per UTC day:** the median positioned rows per bot-day against the fleet median, below 80% uncovers the day.
    The same 80% test is applied per town against the town's own median (only on days with at least 12 hours). A town-day
    below 30% of the fleet median is uncovered whatever the town's own median says. A VOID or missing hour uncovers its day.
  - **`unreached`:** two `no_route` turn-backs mark a region for 7 days. This is a stub until expedition-01 logs them.
  - **Ranking:** candidates are `not_observed`, 300-800 blocks out, no hazard and not unreached. They are ordered by water
    label, then the half-plane facing away from spawn (the world origin, as explore does), then distance step, then
    bearing.
- **Hazards.** World-facts `death:*` sites and `_death` rows within 32 blocks, over 7 days. Water labels come only from
  `_region_scan` (a stub for now) and from the perception water distance of rows that ended in the region. Until
  `_region_scan` exists, every candidate's water label is `unknown`.
- **Baselines over a rolling 7 days.** They are split by distance band and depth:
  - log and ore per gather body-hour, and mine ore per body-hour;
  - deaths per bot-hour, where bot-hours come from each bot's newest row per minute;
  - `home` success by start band and by trigger;
  - bag eligibility per town-hour, on the hourly latest-per-bot sample.
- **Pools whose status changes.** An isolated bot logs `self-<pool>-<Bot>`; the census folds it under `<pool>`.
  - Isolated pools (a, c, d) are folded but never published. When one becomes shared, its history is already on record
    and nothing is refolded. isolated-b is shared since 10-21 13:53Z, and its conversion hour folds exactly (parity below).
  - A town reseeded inside the window is left out and alarmed.
- **The showcase is never read.** It ships to its own `mcai-*-showcase` streams (0 docs on 10-21: its bots are not
  started). Across 10-08..10-21, the bench stream's 33 `exp.pool` values include none for it, and the name is refused as
  a town as well. A later showcase census is easy:
  - run this same code on 10.0.0.40 against its own state dir, after a small change: a `--stream` option selecting `showcase-skill` (not built);
  - add its protected zones (villages) to the hazard overlay as no-go regions. The bench has no protected zones today.

## Output and health

- **Frontier files.** `/var/lib/mcai/_pool-<pool>/frontier-<home>.g<N>.json` are written with the blueprint `link()`
  protocol (a link fails if the number is taken). The newest 12 generations are kept, about 140 KB per town.
  - Each doc carries `stale_after` (the newest measured hour + 3 h); a reader MUST treat a file past it as VOID.
  - Each doc also carries `withdrawal`: a town that drops out is not tombstoned yet. Tombstones are to be added before the
    first reader is built.
- **Daily text:** `~/frontiercensus/out/daily/frontier-<day>.txt`. Ad-hoc views: `--report`, and `--control SINCE UNTIL`.
- **Health.** `heartbeat.json` (every tick), `check-frontiercensus.py` (cron :03/:33, `out/check.log`) and the new
  fleetstatus header line all treat a bad state as an alarm. That covers missing, stale, VOID (never zero), error,
  instrument, behind, a town left out or gone, unreadable hazards, and the publisher. During the warm-up the publisher
  must stay live and rehearse every pool dir as writable. After it, the census must keep staging (an alarm after 30 min
  without) and the publisher must report `ok` (within 15 min of the tick that carries its line).

## Install (10.0.0.31, mike's crontab; nothing else touched)

```
*/5 * * * * /bin/bash /home/mike/frontiercensus/scripts/host/frontiercensus-cron.sh
3,33 * * * * /usr/bin/python3 -B /home/mike/frontiercensus/scripts/host/check-frontiercensus.py --dir /home/mike/frontiercensus/out >> /home/mike/frontiercensus/out/check.log 2>&1
```

- **The tick** runs as mike at nice 19. It reads ES with the read-only key and reads `/var/lib/mcai`. It writes only under
  `~/frontiercensus/out`, never through a symlink, and refuses to run as root.
- **The publisher** (`frontierpublish.py`) runs as **mcbot, never root**, via `sudo -n -u mcbot`. That is the sudo-from-cron
  pattern the other host jobs use; the pool dirs are mcbot:mcbot 0755.
  - It gets the program text and the bundle on one stdin, so sudo logs a one-line command.
  - It runs only after a tick that finished, inside one `flock`.
  - It writes only `frontier-*.g<N>.json` inside existing pool dirs it owns, and never creates a directory.
- **What the install moved.** The r1 draft from 10-20 (never on cron) and the trial dirs were moved to
  `~/frontiercensus/old/`; the crontab backup is there too. The trial's 335 hour files (the same `FOLD_SCHEMA` 4) seeded
  `out/hours`; every tick re-validates their counts against ES.
- **First cron-driven runs (no tty):**
  - 00:20Z: `ok`, 1 hour folded, parity 0 diffs on 10-21 21Z (40,444 rows, 191 regions). The publisher ran as euid 999
    with status `warmup`, rehearsing 13 of 13 pool dirs as usable and 0 unusable, and published nothing.
  - 00:25Z and 00:30Z: `idle` (1.6 s each).
  - 00:33Z: the checker reported "frontier census OK".
  - 0 frontier files under `/var/lib/mcai`.

**No bot reads `frontier-*.json` yet.** A grep of `/srv/mcbots/harness/src`, `/srv/mcbots/harness-canary/src` and
`/opt/minecraft-ai/bots/src` (84, 88 and 88 `.mjs` files) for `frontier-<x>`, `frontier.json`, `_region_scan` and
`_expedition_turnback` found 0 files. The positive control, `junkwell-site-`, was found in one file of each tree. No
`exped*` or `outpost*` branch exists. Every directory reader in `bots/src` matches its own key-anchored regex, so it
cannot pick up a frontier file.

## Positive controls (live, denominators first)

All of these ran on the census's stored hour files: 334 hours, 10-08 00Z .. 10-21 21Z, 0 VOID and 0 unstable. The
backfill took 978 s at nice 19.

| control | result |
|---|---|
| Section 1.1 band shares, hourly latest-per-bot, 10-12 16Z .. 10-19 15Z (168 timepoints), the 12 shared towns of that week | 10,078 samples: 45.1 / 30.9 / 17.5 / 6.0 / 0.6 %, deep 56.9 %. **Identical to 1.1 (0.0 points off).** |
| Same, all 16 pools | 13,438 samples: 43.9 / 31.6 / 17.8 / 5.7 / 0.9 %, deep 57.7 %. **Identical.** |
| 1.1's farthest sample per world and regions touched | Identical: board-a 420 ... hive-b 931 ... placebo-d 319; 34-56 regions per shared world, 5-27 beyond 200. |
| Row-end fold finds every region the samples found | 721 sampled regions (13,438 rows), **0 missing** from the fold's 1,240. Full window: 954 sampled regions (26,715 rows), 0 missing from 1,584. |
| Section 1.2 gather table, same window (167 h) | To the row, e.g. 0-48 logs 7,629 gathers, 30.0 % ok, 51.5 body-h, 155 per body-h; 200-300 logs 3,349, 15.5 %; ore at 200-300 56.8 per body-h. |
| Section 1.3, 24 samples to 10-19 15Z | 1,439 bot-snapshots, 288 town-hours, **6 eligible (0.42 %), 6 of 288 town-hours**; pickaxe 68.6 %, bag <= 30 26.2 %, bag <= 24 1.1 %, at town 21.9 %, health 99.9 %. Identical. |
| Section 2 `home` by start band, 10-12 16Z .. 10-19 15Z | 2,333 rows, 580 ok (24.9 %), 1,083 start unknown; 0-48 196/576, 48-100 108/375, 100-200 46/201, 200+ 8/98. Section 2 had 2,338 / 582 / 1,090 over a window one hour longer. |
| Parity: ES aggregations vs a Python fold of the raw rows | 10-21 19Z: 39,486 rows, 216 regions, 0 diffs. **10-21 13Z, the isolated-b conversion hour:** 47,702 rows, 215 regions, 0 diffs (the r2.1 code had 8 diffs there, which the reviews also found). 10-21 21Z (install tick): 0 diffs. |
| Fixture world (`--selftest`, every live mode) | It covers a known path and known visits, coverage, hazards, unreached, water, ranking, baselines and the controls. Offline suite: 123 cases plus the self-test, and 100 mutants, each killed by its intended case with its anchor unique once comments and docstrings are stripped. fleetstatus: 39/39 and 13 mutants. |

**The frontier as published at warm-up end, if nothing changes (10-21 23Z data):**
- 11 of 13 towns are covered, with 366-414 candidates each.
- hive-b and board-b read `unknown`, with 0 candidates. hive-b was at 72 % of its own median on 10-09 and 79 % on 10-08,
  board-b at 76 % on 10-10.
- Those days stop being judged once fewer than 12 of their hours remain in the window: about 10-23 12Z for hive-b and
  10-24 12Z for board-b.

**Coverage noise, measured to set the rules.** 224 complete town-days over 10-08..10-21:
- 3 were below 80 % of the town's own median, and 6 below 80 % of the fleet's.
- Edge part days of 1, 2, 4, 6 and 12 h read below 80 % of their own median 20.2, 13.7, 10.1, 6.7 and 3.1 % of the time.
  That is why the per-town test needs 12 hours.
- The 30 %-of-fleet floor fired on 0 of 416 part days at every length.
- The fleet rule had 0 of 26 part days below 80 %.

## Reviews (Codex `codex exec --sandbox read-only -`, plus an independent Claude subagent each round)

- **r1** (10-20, previous agent): both CHANGE. Codex raised 10 P1 and 2 P2, Claude 4 P2. r2 claimed all of them; r2
  verified them.
- **r2** (`28423b1b`, this session): both CHANGE.
  - The conversion hour double-counted bot-minutes and overwrote rows on the aggregation path.
  - A root publisher ran mike-writable code.
  - Old staging could be published for a dropped town.
  - An interrupted refold lost its successor hour.
  - Per-town coverage was not gated at 80 %.
  - `--report` and `--control` printed stale or unmeasured numbers.
  - A vanished town and a census that never staged both went unalarmed.
  - Reseeds were judged against 10-08 forever.
- **r3** (`10dbf2b4`): both CHANGE.
  - A failed tick could still publish the previous bundle.
  - Reports and controls accepted invalid folds.
  - The first tick of a new version inherited the warm-up.
  - A loss lasting more than half the window passed per-town coverage.
  - A locked tick read as fresh.
  - One TwoPools hour stopped the census.
  - The publisher's real path was never exercised.
- **r4** (`f930783d`): both CHANGE on P2s.
  - The control's subset check and missing samples were not counted in validity.
  - A silent publisher during the warm-up raised no alarm.
- **r5** (`0302c725`): **Codex APPROVE**. Claude CHANGE on one P2: the control status had no test.
- **r6** (`e720de2d`): **Codex APPROVE, Claude APPROVE.** Claude's three P3s (tests, and wording of the withheld message)
  were applied after the verdicts in `173163bc`, which is the installed sha.

**Deferred by agreement:**
- **Withdrawal tombstones.** Claude r3 P2-4; both reviewers called the deferral safe for an install with no reader.
  Until they exist a reader must honour `stale_after`; the `withdrawal` field says so in every doc.
- **TwoPools.** A bot logged under two census pools in one hour withholds every town while that hour is in the window.
  Bot names carry their world, so this needs a misconfigured `exp.pool`. The remedy is written in the code: fix the pool,
  move the hour file out, and it refolds.

## For the operator

- **Install the fleetstatus header line.** The commands are in the session report; there is no change to the bots.
- **Read the census at 10-24 00:20Z.** The first publish should show 13 of 13 `ok`, and frontier files should appear in
  the 13 shared towns' pool dirs.
- **Before expedition-01 reads the file:** add tombstones, and make the reader treat a file past `stale_after` as VOID.
