# The test world: runbook

One disposable copy of the showcase town, on block2-bots, with 14 bots on the showcase's code. A release soaks here for
3 hours plus a load step before the control session stages it on the showcase. Plan and the reasons for each choice:
[`docs/reports/testworld-plan-2026-11-18.md`](../reports/testworld-plan-2026-11-18.md).

All commands run from the controller, in a worktree of this repo. The ssh target comes from the install script:

```bash
TW=$(infra/testworld/install.sh --host)
```

## What is where (on block2-bots, all under `/srv/testworld`)

| | |
|---|---|
| `server/` | the Paper server (same jar, Java options and plugins as the showcase), game port 25560 and RCON 25660, localhost only |
| `state/` | the bots' records and the town pool `_pool-showcase` (the showcase keeps these in `/var/lib/mcai`) |
| `log/<bot>/` | the bots' skill and model logs. Never shipped: the log shipper on that host takes `/var/log/mcai` only |
| `releases/`, `harness` | one folder per loaded release; `harness` links to the active one |
| `soak/` | `samples.jsonl` (memory, every 5 min) and one folder per soak run with its read |
| `ops/deploy.jsonl` | the journal: every load, start, stop, guard check, pause and soak |
| `incoming/` | world copies as they arrived; `old/` copies set aside by a refresh (kept until someone says to remove them) |

Units: `testworld-paper.service`, `mctest@showcase-<Name>.service` (14), both in `testworld.slice` (10 CPUs, the
showcase VM's count), and two timers: `testworld-sample.timer` and `testworld-leaseprune.timer`.

**The in-world names and the pool are the showcase's** (`showcase-Alpha`..., pool `showcase`), because 33 source files
switch features on by that pool name and the copied bags and records belong to those names. What keeps the two apart:
every unit asserts the host is block2-bots, the bot unit and the loader refuse an env that does not point at
`127.0.0.1:25560`, the server listens on localhost only, and every row carries `RUN_ID=testworld-<sha8>`.

## Rules

- **The fleet must be stopped.** `start` refuses while any `mcbot@` unit is active. If one is, tell the control session
  what started it (on 11-18 it was `fleet-doctor.timer` on block2-worlds). Do not stop fleet bots from here.
- **The showcase comes first on the model.** Both towns use qwen2.5 on the 5080. `start` reads the showcase's model
  latency first and refuses if it is past the limit or cannot be read. `soak` reads it every 10 minutes from the
  telemetry store, through the load step too, and stops the test bots if its 30-minute p95 passes 6 s or if it cannot
  see the showcase for 30 minutes. Outside a soak nothing watches it: do not leave the bots running unwatched.
- **If the showcase is stopped on purpose** (a tripwire stop, a planned stop), its rows are missing and the guard would
  stop every run. Say so, with the reason and whose word it is: `start --showcase-stopped "<why>"` and
  `soak --run <run> --showcase-stopped "<why>"`. The guard is then off until a check sees the showcase's rows again;
  from that moment it is armed as usual. The read names it ("THE SHOWCASE GUARD WAS OFF"). A reading past the limit
  still refuses a start.
- No admin world edits here either: a soak measures the bots. The driver uses RCON only for `list`, `save-off`,
  `save-all flush` and `save-on`.
- Nothing here pages, and nothing reads it but the soak read. An idle or stopped test world is not an alarm.

## Install or update the scripts and units

```bash
infra/testworld/install.sh
```

Idempotent. It starts no bot and no server. Run it after any change to `scripts/host/testworld.py`,
`scripts/host/soakread.py`, `infra/showcase/make_env.py` or `infra/testworld/`.

## Status, start, stop

```bash
ssh $TW sudo /srv/testworld/bin/testworld.py status
```

```bash
ssh $TW sudo /srv/testworld/bin/testworld.py start
```

```bash
ssh $TW 'sudo /srv/testworld/bin/testworld.py stop "why"'
```

`start` runs a gate first (fleet stopped, a release active, env files pointing at the test server, the server answering,
the model listed, 15 GB free, and the showcase's own model p95 over the last 30 minutes read and under 6 s), starts the 14 bots 12 s apart, and waits until each has written a row on the release's
version and the server lists all 14. Bots are started, never enabled: a reboot does not bring them back by itself.

## Load a release

Any commit on the showcase's line (or on main once the lines are one):

```bash
SHA=<40 hex>
```

```bash
git archive $SHA bots/src bots/package.json | ssh $TW "sudo /srv/testworld/bin/testworld.py load $SHA --archive -"
```

```bash
ssh $TW sudo /srv/testworld/bin/testworld.py activate ${SHA:0:8}-6dd0ded8-fdd64ead
```

`load` checks that the archive names that commit, builds the release folder the way the showcase's stage does, and
prints the version the bots must report. `activate` switches the link and restarts running bots 12 s apart.

The policy file and the dependency tree are the showcase's (digests `6dd0ded8` / `fdd64ead`, adopted from the 11-14
capsule's release after both digests were checked). A candidate that changes `bots/package.json` is refused: copy the
staged release's folder (its `RELEASE.json`, `control.env`, `package.json`, `node_modules/`) to `incoming/` and run
`testworld.py adopt-bundle <folder>` first.

## Run a soak and read it

Start it detached, so it does not depend on an ssh session:

```bash
ssh $TW sudo systemd-run --unit testworld-soak-<run> --collect /usr/bin/python3 -B /srv/testworld/bin/testworld.py soak --run <run>
```

It needs all 14 bots in the world. It takes 3 h 50 min:

1. Copies the world's region files and the server's statistics (the start of the record).
2. **3 hours untouched**, with the showcase guard every 10 minutes.
3. **The load step:** 15 minutes with the slice's CPU cut to 40% of what it had been using; then six rounds in which
   each bot's process is paused 50 seconds, 12 s apart, so the server drops it for a missed keepalive (the 11-18
   failure) and it reconnects; then 15 minutes to recover.
4. Copies the region files and statistics again and writes the read.

```bash
ssh $TW cat /srv/testworld/soak/<run>/soak-read.md
```

To rebuild the read from what is on disk: `ssh $TW sudo /srv/testworld/bin/soakread.py --run <run>`.

**How to read it.** FAIL names what broke. INCONCLUSIVE means it could not see enough to say (a bot without rows, rows
on another version, thin memory samples, too few forced reconnects, a run the guard stopped). PASS is neither. The
table puts each bot's memory beside its reconnect count; the load step fails a release that keeps more than 8 MB of
chunk buffers per forced reconnect (the fixed build keeps under 4; the 11-18 leak kept 14 to 22).

The read has a **protected zones** section (every box in the pool's `protected-zones.json`; on 11-18 a sapling that
grew into a tree inside the village stopped the showcase): plant spots chosen inside a zone or within 8 blocks of
one, orders to plant and plantings there, what the block history shows placed, grown and broken inside the boxes,
refusals by kind, zone walks by outcome, deaths in a zone, and what each bot that began inside a zone did. Named in the
read, never part of the verdict.

Other reads of the same run:

```bash
ssh $TW sudo /srv/testworld/bin/buildfirstread.py --run <run>
```

That one is the building read (blocks by project and hour, bag-room trips, plot holds, idle orders, the materials
draw, completions). Run it before the next world restore: it reads the live world's folders.

To read a run again after a later restore, point the soak read at the world that restore set aside:

```bash
ssh $TW sudo /srv/testworld/bin/soakread.py --run <run> --server /srv/testworld/old/<time>/server
```

**The load step alone**, for a release whose untouched hours are not the question (about 1 h 25 min):

```bash
ssh $TW sudo systemd-run --unit testworld-soak-<run> --collect /usr/bin/python3 -B /srv/testworld/bin/testworld.py soak --run <run> --load-only
```

Stopping a soak (`systemctl stop testworld-soak-<run>`) puts the CPU quota back and continues every paused bot by
itself. If the host went down mid-step, or to be sure:

```bash
ssh $TW 'sudo systemctl set-property --runtime testworld.slice CPUQuota= ; sudo systemctl kill --signal=SIGCONT "mctest@*"'
```

## Refresh the world

The source is the showcase's nightly copy that block2-worlds pulls at 04:15Z. Not between 04:10 and 04:30Z.

```bash
infra/testworld/push-world.sh
```

It streams the copy through the controller to `incoming/<stamp>/` on block2-bots and compares the world files' names
and sizes on both sides. Then:

```bash
ssh $TW sudo /srv/testworld/bin/testworld.py setup-world /srv/testworld/incoming/<stamp>/showcase
```

That stops the bots and the server, moves the current `server/` and `state/` to `old/<time>/` (kept), restores the
copy with the test world's ports and new secrets, and starts the server. Then `start`. To put two releases on the same
ground, run `setup-world` on the same `incoming/` copy before each.

## What the showcase VM runs that this does not

| On the showcase VM | Here |
|---|---|
| lease prune, hourly (`leaseprune4h.py` on the pool) | **run**, hourly, `testworld-leaseprune.timer`: its absence changes how bots behave |
| tripwire, hourly (a trip stops the town, a Z1 quarantines a bot) | not run: the soak read is the instrument, and Comet stays in the world sealed in its pocket, as the fixture for the zone-escape work |
| follower and restack timers | not run: releases arrive by `load` |
| nightly backup hold at 04:15Z (saving paused about 100 s) | not run |
| block-history purge (`co purge t:30d`) | not run: the copy is refreshed long before it matters |
| cameras and timelapses | none (control session 11-18); each soak keeps its start and end region files instead |
| watchers (goalwatch, stopwatch, routewatch, brainwatch, haltwatch, project audit) | none: they only read, and nothing here pages |

The showcase VM is also busier than this host (the tripwire's read, renders). The load step stands in for that.

## Leaving it

`stop` the bots when no soak is planned: idle test bots still spend the model's time. The server may stay up. If the
fleet is ever restarted on purpose, stop the test world first: 80 fleet bots are allowed 80 of that host's 96 GB.
