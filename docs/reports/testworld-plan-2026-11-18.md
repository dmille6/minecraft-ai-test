# Test world for the showcase code line: plan (2026-11-18, phase 1, nothing changed on any host)

Goal: one long-running copy of the showcase town with 14 bots on the showcase's code, where a release soaks 3 hours
(plus a load step) before the control session stages it on the showcase. Every check below was read-only, 12:53-13:05Z.

## Found first: the fleet's stop did not hold

All 80 `mcbot@` units are running again since **12:55:04Z**. `fleet-doctor.timer` on block2-worlds (every 5 min,
`fleet-doctor.py --once --repair`) saw 0 of 80 bots in the worlds and restarted every one over its root key (its
journal: `in world 0/80 MISSING 80 ... -> restarted`; the units still read `disabled`). It will do so again after any
stop. Holding the stop needs that timer disabled as well. I changed nothing: it is the control session's call.
**This plan needs the fleet stopped** (model room and RAM, below).

## Where it runs: everything on block2-bots

| | block2-bots | block2-worlds |
|---|---|---|
| CPU | 24 cores; 92% idle in the hour before the stop, with all 80 bots running | 32 cores, 98% idle, but every core is pinned in pairs to a fleet server |
| RAM | 96 GB; 93 GB available with the fleet stopped (12:53Z), 81 GB four minutes after it came back | 80 GB, 43 GB available (16 fleet servers + 8 sandbox servers hold 37 GB) |
| Disk | 44 GB free of 96 | 148 GB free of 387 |
| Runtime | Node 22, user `mcbot`; no Java | Java 21, Paper 1.21.8 build 60 (same jar checksum as the showcase's); Node 18 |

- **Server and bots both on block2-bots**, as the showcase has them on one VM, inside one systemd slice
  `testworld.slice` held to 10 CPUs (the showcase VM's count; Paper on 6 of them, as there). Worst case 14 x 1.5 GB +
  12 GB for Paper = 33 GB. Disk budget 10 GB; the loader refuses below 15 GB free.
- Why not split: the two hosts have no key to each other (checked both ways), so a soak read could not see both
  halves without a new key; and the showcase's two defects needed bots and server short of CPU together.
- Java: copy the 194 MB runtime directory from block2-worlds into the test world's own folder (same Ubuntu 24.04.5 on
  both). No package is installed. Ports: game 25560, RCON 25660, both bound to localhost only, so nothing off the
  host can join; bot viewer ports 3300-3314. Free on both hosts (fleet 25570-85 / 25670-85, sandboxes 25599-606 /
  25699-706, showcase 3200-14).
- **Not disturbed:** the 16 fleet servers and their saves (never touched: block2-worlds is only read); the 36 cron
  lines and 4 timers on block2-bots (they keep 14 CPUs and 60 GB; none reads the test world's folders); the sandbox
  rig (its servers are on block2-worlds, its locks in `/tmp` on block2-bots, `sandbox4` held when checked; the test world
  takes no sandbox lock and no sandbox port); suites (`suite-run.py` uses the ci hosts, then block2-worlds).
- **If the fleet is restarted on purpose, the test world stops first** (80 bots are allowed 80 GB of the 96).

## The world

- Source: the showcase's nightly copy that block2-worlds already pulls at 04:15Z (`/srv/showcase-backup/src/showcase`):
  world, block-history database, plugins, settings and the bots' records, taken with saving held. Today's is from
  **04:16Z (9 hours old at writing)**, 656 MB, and its journal shows the live release `b6b83327`. Nothing is asked of
  the showcase VM.
- Restored into a NEW folder `/srv/testworld/` on block2-bots (`server/`, `state/`), sent as one stream through the
  controller (about 0.75 GB, 2 min). The showcase's RCON password and plugin secrets are replaced with new values made
  on the host and never printed.
- Refresh: `testworld.py refresh-world` stops bots and server, moves the old copy aside (kept, not deleted), restores
  the newest nightly copy, checks `level.dat` and a second dry pass showing nothing changed. Not between 04:10 and
  04:30Z. Default: refresh before each candidate, so it meets the town as it is. The time capsule (11-14 15:50Z,
  4 days old) is the other source, for comparing two versions from the same start.

## The bots

- Unit `mctest@.service`: `mcshow@.service` with only the paths and the slice changed (MemoryMax 1536M, heap 1152,
  `Restart=always`, same hardening).
- **In-world names and pool stay `showcase-Alpha`...`showcase-Onyx` and `showcase`.** Checked on `b6b83327`: 33 source
  files switch a feature on by pool name `showcase`, and the copied bags, positions and records belong to those names.
  Renamed bots would run different code on empty bags. Collisions are ruled out one level up: another host, another
  unit name, folders `/srv/testworld/log` and `/srv/testworld/state` (not `/var/log/mcai` or `/var/lib/mcai`), and
  `RUN_ID=testworld-<sha8>` on every row.
- Env files: `infra/showcase/make_env.py` `build_env` called unchanged, then five keys replaced (`LOG_DIR`,
  `STATE_DIR`, `MINECRAFT_PORT`, `VIEWER_PORT`, `RUN_ID`). A test holds every other key equal to the showcase's.
- **Model: qwen2.5 on the 5080, the showcase's endpoint, but only while the fleet is stopped.** Measured from the
  telemetry store (no read on the showcase VM), fleet still running: showcase 15.1 calls/min over 6 h (5,423 calls,
  13 bots, peak minute 24), p50 3.3 s, p95 6.1 s; in the last hour 12.7/min and **p95 9.0 s**. The fleet put 163
  calls/min on the same card (84 on qwen2.5, 79 on the 4B). The 11-15 capacity read: that server held at about 84
  qwen2.5 calls/min in all and failed at about 100. So with the fleet running there is **no room** and I would not
  start the bots. With it stopped: showcase 15 + test world about 15 = 30 calls/min. Not measured: the showcase's
  latency with the fleet off (it was back before I could). So: 30 min of that first, then start; the soak read prints
  the showcase's p50/p95 before and during, and the test bots stop if its 30-min p95 passes 6 s. No new endpoint.

## Releases

- **A thin copy, not the showcase tool at a second root.** `showcase_ops.py` holds its root, the `mcshow@` unit name
  and the log paths as constants on 58 lines, binds stage and activate to gates that belong to the showcase,
  and is tooling-protected (two engines). New `scripts/host/testworld.py` (about 300 lines, unprotected, one engine)
  builds the same release folder: `git archive <sha> bots/src bots/package.json`, the dependency bundle, the pinned
  policy file, env files, `RELEASE.json`, a `harness` link, restart 12 s apart, then every bot must log a row on the
  expected version. Cost: about 80 duplicated lines; it imports `make_env` and `src_digest` so those cannot drift.
- Any sha on origin works (`b6b83327` is on four `*-rel` branches; block2-bots already fetches origin). The policy file
  and bundle for digests `6dd0ded8` / `fdd64ead` are inside the capsule archive on block2-worlds. A candidate that
  changes `bots/package.json` is refused until its bundle exists.
- **The soak read** (`scripts/host/soakread.py`, with a test; pure functions over samples, log lines and rows):
  per-bot memory every 5 min (cgroup current and peak, from a timer that writes only into the test world's folder):
  min, median, max, share of the 1536M cap, slope over the last 90 min; reconnects per bot-hour from the Paper log,
  by reason; deaths (bot rows and Paper lines, which must agree); restarts and kernel memory kills; blocks placed and
  cleared per hour from the block-history database; model calls and p95. Each number with its denominator and a
  positive control (rows, 14 of 14 bots, all on the expected version, 36 samples a bot).
- **Load step, after the 3 hours (45 min):** 15 min with the slice's CPU cut to 40% of what it used; then each bot's
  process paused 40 s, three times, 12 s apart, so the server drops it for a missed keepalive, which is the 11-18
  failure itself; then 15 min to recover. Reported: reconnects seen against expected, minutes until 14 of 14 are back,
  memory before and after each reconnect.

## Telemetry and noise

Logs stay in `/srv/testworld/log` on block2-bots and are read there at `nice 19`, or copied to ci2. Checked: the log
shipper there takes `/var/log/mcai/*/` and a by-name list of `mcbot@` units, so it ships none of this; the pool
cleaner takes `/var/lib/mcai/_pool-*`. No cron is added, no alarm row, no ntfy. The one timer gets a
`config/monitors.json` row naming the soak read as its reader.

## What it does not do

No trunk merge. No fleet start or stop. Nothing deleted (old test copies are kept until someone says so). No release
gate of its own: it produces a read, and the showcase's gate stays as it is. No cameras, which needs a word: the
owner's rule is cameras from frame zero on every new world; for this disposable copy I propose keeping its start and
end region files instead. It does not replace the land world on VM 118.

## Steps (after the control session answers)

| # | Step | Time | Done when |
|---|---|---|---|
| 1 | Folders, units, slice, Java copy, restore the nightly copy, start Paper | 1.5 h | `Done`, 0 players, listening on localhost only, world files match the copy |
| 2 | `testworld.py` (load, start, stop, status, refresh-world) with tests | 3 h | release folder for the live sha has the showcase's `expected_version`; env differs in 5 keys |
| 3 | Start 14 bots 12 s apart | 0.5 h | the server lists 14; each has a row on the version and an answered model call |
| 4 | `soakread.py`, the sampler timer, tests, one review | 4 h | tests pass, mutants bind each rule |
| 5 | Proof: the live release, 3 h + load step | 4 h | soak read attached; its numbers become the baseline and set the limits |
| 6 | Positive control: the release before the reconnect fix | 4 h | the soak read FAILS it; without this a pass means little |
| 7 | Runbook `docs/runbooks/testworld.md`, full suite, branch handed over | 1.5 h | suite green on a ci host; the control session merges |

About 11 hours of work and 8 hours of soaking: a day and a half.

## Questions for the control session

1. Stop the fleet again with `fleet-doctor.timer` off (yours to do), or does the test world wait?
2. Server and bots together on block2-bots with a copied Java runtime: yes?
3. In-world names and pool stay `showcase`: yes?
4. Which 14 of the 15 names run, and which jobs on the showcase VM write into the bots' records (so the test world
   copies them or knowingly leaves them out)?
5. Cameras: none on this copy, start and end region files kept: yes, or ask the owner?
