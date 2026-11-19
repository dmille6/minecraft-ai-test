# Overseer dry run on the test world: handoff (2026-11-19)

For the session that runs the test world ("Stand up the test world for showcase releases"). The overseer has never run
anywhere. This is a **dry** practice run: it reads the town and the bots' logs and writes down what it *would* decide. It
writes nothing a bot reads. Nothing here was installed; installing is yours.

- **Code:** branch `overseer-02show` (head in the commit that adds this note), on `t11reach3-01show` 68ad0bfae.
  Design: `docs/reports/overseer-design-2026-11-17.md`. Rules: `docs/reports/overseer-replay-2026-11-19.md`.
- **What runs:** `scripts/host/overseer.py` (python 3.12, no packages) calls `node scripts/host/overseer-cycle.mjs`
  (node 22, built-ins only), which imports `bots/src/overseer.mjs`, `buildproj.mjs` and `gradetidy.mjs`.
  The bots need no new code for a dry run.

## What a dry cycle writes

With `--dry`, the cycle writes only inside `--state`:

| File | What it holds |
|---|---|
| `decisions.jsonl` | **the log**: one row per decision (below) |
| `cycles.jsonl` | one row per cycle: the counts, the rules in force, the cuts offered and excluded by kind, peak memory, any error |
| `book.dry.json`, `setaside.json` | the overseer's own book and its set-aside list |
| `tail.json`, `logdirs.json`, `gzcheck.json`, `overseer.lock`, `stage/` | its read offsets, its lock, its last staged run |
| `cron.log` | the cron line's stdout and stderr (from the line below) |

It writes no record, lease, env, list or order file. `--dry` ignores any LIVE switch. It never runs the live-to-off
clean-up, and it refuses `--ship`. `overseer.py` also refuses to publish any staged write whose destination is outside
`--state`. `test_dry_writes_nothing` proves this against a town holding a record, a lease, an env file, an old order
file, a LIVE switch and a live book. Its positive control shows the same town *with* the switch does get list files.
Five anchored mutants each make it fail. The test runs the install's own file set (the `git archive` list
below), copied to a scratch tree that the snapshot also covers, so a `__pycache__` written beside the code is caught
as well.

**Running it as `mike` adds a second guard.** `_pool-showcase` and the logs are owned by `mcbot` (mode 755/644), so a
cron job running as `mike` can read them and has no permission to write them.

## Install (dry)

From the controller, in a checkout of this repo:

```bash
SHA=<overseer-02show head, 40 hex>
git archive $SHA scripts/host/overseer.py scripts/host/overseer-cycle.mjs scripts/lib bots/src/overseer.mjs bots/src/buildproj.mjs bots/src/gradetidy.mjs \
  | ssh mike@10.0.0.31 "mkdir -p ~/overseer-dry/${SHA:0:8} ~/overseer-dry/state && tar -x -C ~/overseer-dry/${SHA:0:8} && ln -sfn ~/overseer-dry/${SHA:0:8} ~/overseer-dry/tree"
```

**First cycle, by hand.** It reads the whole live logs once (421 MB on 11-19), then only new bytes. On a copy of the
pool plus 49 MB of the test world's logs it took 0.6 s at a peak of 160 MB.

```bash
ssh mike@10.0.0.31 'cd ~/overseer-dry/tree/scripts/host && nice -n 19 python3 overseer.py --dry --pool /srv/testworld/state/_pool-showcase --home 0,70,0 --radius 128 --state ~/overseer-dry/state --zones /srv/testworld/state/_pool-showcase/protected-zones.json --logs /srv/testworld/log'
```

It prints the cycle row. Check that `hard_dry` is `true`, that there is no `error`, and that `bots` and `online` match
the bots that are running.

## Cron line: every 15 min, in mike's crontab

Add it with `crontab -e` as mike, not as root.

```
2,17,32,47 * * * * cd /home/mike/overseer-dry/tree/scripts/host && flock -n /home/mike/overseer-dry/state/cron.lock timeout 120 nice -n 19 python3 overseer.py --dry --pool /srv/testworld/state/_pool-showcase --home 0,70,0 --radius 128 --state /home/mike/overseer-dry/state --zones /srv/testworld/state/_pool-showcase/protected-zones.json --logs /srv/testworld/log >> /home/mike/overseer-dry/state/cron.log 2>&1 # overseer-dry
```

The minutes avoid the hourly lease prune at :19. The log and its outputs go to `/home/mike/overseer-dry/state/`:

- `decisions.jsonl`: the log to read
- `cycles.jsonl`: the cycle rows
- `cron.log`: stdout and stderr

## Stop it

Remove the `# overseer-dry` line with `crontab -e` as mike. Nothing else needs undoing. The overseer touched nothing
outside `~/overseer-dry`. To remove all of it: `rm -rf ~/overseer-dry`. A cycle that is already running ends within
120 s (`timeout`).

**After a world refresh** (`setup-world`), the book still lists the old world's cells. The recheck closes them as
`dropped:off_record` over the next cycles. For a clean read, stop the cron job, move `state/` aside and start again.

## The decision log: how to join it to what the bots did

One JSON row per decision:

```
{"at":"2026-11-19T02:10:00.000Z","t":1795054200000,"run":"<cycle id>","mode":"dry","bot":"showcase-Alpha","kind":"add",
 "rule":"split:nearest_under_share","id":"r:-11,70,-41","cell":"-11,70,-41","block":"dirt","from":null,"why":null,
 "listed":true,"list":1795054200000,"bot_pos":[-18.6,63,-50.6],"bot_seen":"2026-11-19T02:08:07.994Z","bot_online":true}
```

**The join keys:**

- **Bot:** `bot` is the skill rows' `bot.name`.
- **Time:** `at`/`t` is the cycle's clock. `bot_seen` is that bot's newest row when the decision was made.
- **Cell:** `cell` is `x,y,z`, exactly as the build rows write `cell=x,y,z`. `id` is the job id the bots' `_worklist`
  rows would carry in a live run, and `list` is the `list=<issued>` they would echo.

**Every row names its `rule` and threshold:**

| kind | rule (default thresholds) |
|---|---|
| add | `split:nearest_under_share` |
| move / release | `rebalance:slack>1.5`, `avoid:2x_one_bot`, `release:no_work_progress>=30m`, `release:offline`, `release:gone_from_roster`, `unstick:no_action>=45m` |
| unstick | `unstick:no_action>=45m` |
| quarantine | `quarantine:3x2bots` |
| requeue | `requeue:set_aside_behind_other_work` |
| unquarantine | `unquarantine:ttl>=24h`, `unquarantine:new_release` |
| close | `report:done` / `report:gone` / `recheck:zone`, `recheck:record`, `recheck:far`, `recheck:off_record` |
| needs_material | `needs_material:per_project` |

**A suggested read for one decision.** For an `add` of cell C to bot B at time T, find the skill rows with `cell=C`
after T (any bot), and B's rows between T and T+60 min. Did B, another bot or nobody dig C? How long did it take? Was C
waived? `recheck:off_record` closes mark the moment the town's record stopped offering C.

**The rules in force** are in every `cycles.jsonl` row (`rules`). To compare the 01show rules on the same logs, run a
second copy with its own `--state` and `--rules '{"base": "v1"}'`. You can also override one value, e.g.
`--rules '{"unstickAfterMs": 1800000}'` for a 30-min unstick.

## What a dry run can and cannot show

- **No bot sees a list.** So in dry there are no `_worklist` reports, no list progress, no failures, and therefore **no
  quarantine** and no requeue. Release and unstick run on the bots' own rows: any finished work, and any successful
  action. Moves happen.
- Intake takes at most 300 cells a cycle. With nothing being worked, the book grows by 300 a cycle until the plain cuts
  run out (2,149 offered on 11-19, of 2,551 cuts).
- **Plain removals only.** These stay with the shared clean-up visit, and each is counted in `cycles.jsonl`
  `excluded`: hollow crusts (372 on 11-19), plot, teardown and handed cuts, waived cells, claimed boxes, fill columns,
  and the grade gate (when `grade-target.json` exists).

## Please report

1. **Unstick, with Comet as the positive control.** Comet stays sealed in its pocket on the test world. List every
   `unstick` row by bot and time. For Comet, note when its last successful action was and when the order fired; with a
   45-min threshold and 15-min cycles, expect 45 to 60 min. For each other bot that got one, say whether it was really
   stuck. Use the replay's label: no work progress within 30 min after the order means TRUE. Give the false share.
2. **Releases:** how many per bot-day, how many fired while the bot was online, and how many were followed by work
   within 30 min (false).
3. **Quarantine precision: how many quarantined cells another bot later finished.** A dry run cannot produce any,
   because no bot reports a failure. Please say so in the read (0 by construction, not a measurement). The number comes
   from the first live run: for each `quarantine` row, check whether a later build row with `cell=` that cell shows
   another bot clearing it.
4. **Needs material:** the `needs_material` rows, one per `_build_visit ... outcome=no_material`, and `needs` in
   `book.dry.json`, which keeps each project's first and last time, count and bots. Say whether the projects it names
   are the ones really short of a material (civicP's roof is the known case).
5. Cycle health from `cycles.jsonl`: any `error` row, the peak memory (`peak_mb`), and the bytes read per cycle.
