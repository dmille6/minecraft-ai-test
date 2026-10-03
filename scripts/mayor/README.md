# Shadow mayor

Plan: `docs/reports/shadow-mayor-plan-2026-10-03.md`. **Observe-only.** Nothing here sends a command to a
bot, changes bot code, or uses a canary slot. Python 3.12, stdlib only.

| file | what |
|---|---|
| `mayor_core.py` | every decision as a pure function: roster, slot estimate, shortages, eligibility (`evaluate`), the deterministic mayor (`decide`), the validator (`validate`) |
| `mayor_shadow.py` | the long-running process on the bots host: tails the logs, snapshots each world every 5 min, runs the deterministic mayor |
| `mayor_score.py` | offline scorer over snapshots + later telemetry, for any engine's assignment file |
| `mayor_frontier.py` | REPLAY client: the same snapshots to Claude and GPT, validated, written in the scorer's shape |
| `mayor_io.py` | where the mayor may write: realpath + allowlist, bot trees refused, `O_NOFOLLOW` creates |
| `stack_sizes.json` | real stack sizes, minecraft-data 3.112.0 `pc/1.21.11` (only the non-64 items) |

## Run (on 10.0.0.31, when the owner says so — not deployed by this branch)

```sh
nice -n 10 python3 scripts/mayor/mayor_shadow.py \
  --logs '/var/log/mcai/*/skill-*.jsonl' --facts-root /var/lib/mcai --out-dir /var/lib/mcai-mayor
```

As a unit: `Nice=10`, `MemoryMax=512M`, `CPUQuota=25%`, `Restart=on-failure`, user `mcbot` (read access to
`/var/log/mcai` and `/var/lib/mcai`, write access to `/var/lib/mcai-mayor` only).

Dry run against a copied slice (no clock, no host): `--replay --replay-minutes 30 --logs '<slice>/*/skill-*.jsonl'
--facts-root <slice-facts> --out-dir <tmp> --allow-out-root <tmp>`, or `--once --now-from-data`.

**Output path safety.** `--out-dir` is resolved with realpath and REFUSED (exit 2) if it is at or under
`/var/log/mcai`, `/var/lib/mcai`, `/srv/mcbots` or `/opt/minecraft-ai`, or not under an allowlisted mayor dir
(default `/var/lib/mcai-mayor`; add others with `--allow-out-root`, which never re-allows a bot tree). Every file
is created `O_NOFOLLOW`. The scorer's `--json` and the frontier's `--out-dir` follow the same rule.

**Freshness.** A bot is fresh only if a STATE-BEARING row (position + inventory) is within 5 min; a reflex row
proves the process is alive, not where the bot is. Rows stamped more than 60 s in the future are rejected
(`future_rows` in the tick log).

**Leases** hold a PLACE (`target_key` = `kind@x,y,z`), re-resolved to each tick's R-id, so a new sighting cannot
move one. Held leases, oldest first, get the same uniqueness and caps as new ones: a second lease on one target is
released `conflict`, one over a cap `over_cap` (no cooldown); `failed`/`expired`/`target_lost` cool down 15 min.

## Resource limits (measured 2026-10-03 on a 30-150 min slice of all 80 bots, Python 3.12)

- **Steady tick** (5 min of new rows, ~4.3 MB, 16 worlds): **~46 ms CPU**, RSS ~40 MB.
- **Start-up tick** (bootstrap reads the last `--bootstrap-bytes`, 1 MB, of each current file): ~0.4 s CPU for 52-56 MB.
- **Replay** streams (per-file reorder buffer + merge): 150 min of all 80 bots, RSS 42 MB. **Scorer** goes one world
  at a time (snapshots with inventories dropped, state rows as tuples): the same slice, RSS 30 MB, 1.5 s.
- Memory is O(bots), not O(rows): per bot it keeps the latest state row, the last 6 skills, trap and milestone.
- Bounds: `--max-bytes-per-file` 16 MB per tick (the rest is read next tick, `lag_bytes` in the tick log);
  `--max-rss-mb 400` exits 3 for the supervisor to restart; `--mem-limit-mb 768` sets `RLIMIT_AS` on Linux;
  `--nice 10`. Rotation: a new inode, a size below the offset, or a changed first-128-bytes fingerprint (a
  copytruncate that regrew past the offset between ticks) resets the offset to 0 and drops any partial line.
  A file gone for `--evict-file-min` (30) is forgotten; a bot silent for `--evict-bot-h` (6) is dropped; the facts
  cache keeps only files used in the current tick.
- **Output cap**: past `--max-out-mb` (1024) of mayor files the process writes nothing more and exits 6 with
  "output cap reached ... Archive or remove the files, then restart." (no silent disk fill).
- Output growth: ~20 KB per world-snapshot (measured 330 KB for one 16-world tick), ~95 MB/day,
  ~285 MB over the 72 h window; assignment files are ~1/10 of that.

It tails instead of walking every file. CLAUDE.md's full-walk rule is for analysis (a tail eats the baseline);
the shadow needs only current state and runs on the bots' own host. The scorer does full reads.

## Files written (only under `--out-dir`, default `/var/lib/mcai-mayor`)

- `snap-<world>.jsonl` — one immutable snapshot per tick: bots `B1..` (freshness, pos, inventory, `slots_est`
  labelled ESTIMATE, pickaxe uses, trap, milestone, last skills), resources `R1..` from world-facts with age,
  shortages `S1..`, candidates `C1..` (feasible + blockers, each blocker naming a remedy or "none from here").
- `assign-<world>.jsonl` — the deterministic mayor: assignments (`lease` new/held), `unstaffed` with reason +
  blocker histogram + remedies, `released` (done/failed/expired), cooldowns.
- `mayor-ticks.jsonl` — per tick: cpu ms, max RSS, bytes, rows, lag, rotations.
- `mayor-state.json` — simulated leases/cooldowns (atomic replace).

World = `exp.pool`; isolated bots write `self-isolated-a-Alpha`, mapped to `isolated-a` (verified in live rows),
whose resources are the five per-bot `world-facts-isolated-a-<Bot>.json` files merged.

## Score and replay

```sh
python3 scripts/mayor/mayor_score.py --snaps '/var/lib/mcai-mayor/snap-*.jsonl' \
  --assign '/var/lib/mcai-mayor/assign-*.jsonl' --assign 'replay/assign-*-*.jsonl' --json score.json
python3 scripts/mayor/mayor_frontier.py --dry-run --out-dir /tmp/fr        # no key, no network
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... python3 scripts/mayor/mayor_frontier.py \
  --out-dir replay-<date> --max-snapshots 100 --budget-usd 10              # REAL MONEY: owner approves first
```

The scorer prints positive controls before any rate (global, and per-bot coverage of the snapshot times) and exits
4 on a zero its detector could not have seen. Its headline executability is **at the next snapshot**, with the
validator's rejected proposals in the denominator; a bot whose state telemetry has a gap > 5 min is **unobserved**
(excluded), not failed; the unforced gap needs eligibility at every snapshot through the window; GET_IRON
shortages are `certainty: unknown-bank` (banked iron is unknown) and are reported apart (`unkb`), never in the gap;
downstream success is compared with the **random-eligible baseline** (`xrand`).

**Replay** (`mayor_shadow.py --replay`) has no lookahead: a row is ingested only once it was WRITTEN (start +
duration_ms), sightings whose `last` is after the snapshot time are dropped, and every snapshot is marked
`replay: true`. The scorer refuses replay snapshots (exit 2) unless `--replay-only`, which scores them on their
own, never mixed with live ones.

The frontier client reserves the worst case before EVERY attempt (retries included; prompt at 1 token per 2 bytes
+ full `max_tokens`), charges a timed-out attempt its whole reservation, enforces the full output schema (malformed
answers are invalid, never an exception), and stores HTTP errors as `http_<status>:<sanitised type>` only.

## Tests

`python3 -m unittest discover -s scripts/mayor/tests -v` (53 tests, ~6 s). `test_mutants.py` applies each of 45
mutants to a temp copy of the package and runs the WHOLE suite against it in a subprocess; every one must turn it
red (an unmutated copy must be green; a missing or non-unique anchor raises). To see which tests kill which mutant:
`python3 scripts/mayor/tests/test_mutants.py --report`.

## Decision date (no open loop)

**72 h after the shadow starts, record KEEP-BUILDING or STOP** in `docs/reports/STATE.md` and memory. The
start time is the first line of `mayor-ticks.jsonl`. INCONCLUSIVE is a legitimate close; walking away is not.
A duty may only *act* under the plan's owner gate (>= 48 h; unforced gap >= 20 bot-h/day fleet-wide;
executability >= 80%; downstream >= 1.5x base; the duty's refusal chain tested), then ONE duty in ONE world.
