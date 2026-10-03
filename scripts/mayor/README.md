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

As a unit: `Nice=10`, `MemoryMax=512M`, `CPUQuota=25%`, `Restart=on-failure`, **`RestartPreventExitStatus=6`**
(exit 6 is the output cap: restarting would only hit it again, so the unit stays down until someone archives the
files), user `mcbot` (read access to `/var/log/mcai` and `/var/lib/mcai`, write access to `/var/lib/mcai-mayor`
only). Exit 3 (RSS over `--max-rss-mb`) is meant to be restarted; exit 2 (refused out dir) is a config error.

Dry run against a copied slice (no clock, no host): `--replay --replay-minutes 30 --logs '<slice>/*/skill-*.jsonl'
--facts-root <slice-facts> --out-dir <tmp> --allow-out-root <tmp>`, or `--once --now-from-data`.

**Output path safety.** `--out-dir` is resolved with realpath and REFUSED (exit 2) if it is at or under
`/var/log/mcai`, `/var/lib/mcai`, `/srv/mcbots` or `/opt/minecraft-ai`, or not under an allowlisted mayor dir
(default `/var/lib/mcai-mayor`; add others with `--allow-out-root`, which never re-allows a bot tree). Every file
is created `O_NOFOLLOW`. The scorer's `--json` and the frontier's `--out-dir` follow the same rule.

**Shortages.** FREE_BAG, RESTORE_PICK and GET_WOOD are PER BOT (only the short bot is a candidate); GET_IRON is per
world. GET_WOOD = no usable pickaxe and too little of the bot's OWN wood to craft one, by the same function
(`pick_ingredients`) that blocks RESTORE_PICK `no_ingredients` -- bots cannot hand each other wood.

**Freshness.** A bot is fresh only if a STATE-BEARING row is within 5 min. A state row needs BOTH a valid
position (numeric x, y, z) and an inventory object; a row with a position and no inventory never stands in for one
with an empty bag (the scorer applies the same rule). A reflex row proves the process is alive, not where the bot is. Rows stamped more than 60 s in the future are rejected
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
  A file gone for `--evict-file-min` (30) is forgotten; a bot silent for `--evict-bot-h` (6) is dropped; a world
  with no snapshot for `--evict-world-h` (6) is dropped with its leases, cooldowns and bank evidence; the facts
  cache keeps only files used in the current tick.
- **Output cap**: past `--max-out-mb` (1024) of mayor files the process writes nothing more and exits 6 with
  "output cap reached ... Archive or remove the files, then restart." (no silent disk fill). `--replay` obeys the
  same cap.
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
  --assign '/var/lib/mcai-mayor/assign-*.jsonl' --assign 'replay/assign-*-*.jsonl' --json score.json \
  [--since 2026-10-04T02:00:00Z] [--until ...]
python3 scripts/mayor/wood_replay.py --snaps '/var/lib/mcai-mayor/snap-*.jsonl'   # current GET_WOOD rule over recorded snapshots
python3 scripts/mayor/mayor_frontier.py --dry-run --out-dir /tmp/fr        # no key, no network
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... python3 scripts/mayor/mayor_frontier.py \
  --out-dir replay-<date> --max-snapshots 100 --budget-usd 10              # REAL MONEY: owner approves first
```

The scorer prints positive controls before any rate (global, and per-bot coverage of the snapshot times) and exits
4 on a zero its detector could not have seen. Its headline executability is **at the next snapshot**, with the
validator's rejected proposals in the denominator. **Silence is unknown, never a result:** a window in which the
bot's state telemetry has a gap > 5 min is **unobserved** and leaves EVERY outcome denominator (concordance,
downstream, unforced, base rate) whether or not the outcome was seen; a bot missing or stale at the next snapshot
leaves the executability denominator; a per-bot shortage whose bot is not fresh at +30/+60 leaves persistence. The
unforced gap needs eligibility at every snapshot through the window; downstream success is compared with the
**random-eligible baseline** (`xrand`).

**Partitions are never pooled; no window crosses an epoch.** Every snapshot, deterministic record and frontier record
carries `mayor_rev`, a hash of `mayor_core.py` + `mayor_shadow.py` + `stack_sizes.json` (also in each tick line), so a
deploy is a new revision without anyone remembering to bump anything. The scoring PARTITION is that revision + a hash
of the canonical effective configuration recorded in the snapshot (`cfg-unrecorded` if none), and it is scored with
that configuration, not today's defaults. Each world's history is cut into EPOCHS -- contiguous runs of one
partition, so a rollback A,B,A is three epochs -- and every lookup stays inside its epoch: a window (outcome, base
rate, persistence, gap) that reaches past a non-final epoch's last snapshot crosses a transition and is censored
(`censored_epoch`), never credited. One table per partition; the JSON has `partitions` (with `mayor_rev`, `cfg`,
`epochs`), and the flat `engines`/`base` keys only when exactly one partition was scored. `--since`/`--until` (ISO
UTC) select which proposals and base windows are scored; an unparseable bound is refused (exit 2). A legacy
world-scope GET_WOOD shortage (before 9cad2ad) is UNKNOWN per bot, never true for every bot.

**GET_WOOD biases, corrected.**
- `xrand` counts only **contested** proposals (`contd`): any competition for the duty -- duty cap, world cap, a bot
  feasible for two duties, or two candidates sharing a target. Without one, every order assigns the same candidates
  and targets (property-tested against `core.greedy`), so random and the mayor cannot differ there.
- **Lease timing.** The mayor re-proposes right after a success and goes quiet ~25 min after a failure (lease 10 min
  + cooldown 15). The `random`/`nearest` baselines run through the SAME `core.decide` -- leases, cooldowns, caps --
  with only the order changed, replayed from the FIRST snapshot of each epoch (before `--since`/`--until`) from their
  own empty state, never the mayor's leases. Their proposals in the first lease + cooldown (25 min) of an epoch are
  forced by that empty start and excluded (`warmup_excluded`); no engine's `xrand` counts that period. The frontier
  engines are per-snapshot (no memory), so they are compared with `random-stateless`/`nearest-stateless`.
- `xbase` = **concordance** / base rate of **eligible** short bots (fresh, observed, short AND feasible by the
  mayor's own `evaluate`): the same outcome, window and observation rule on both sides. Target-conditioned
  downstream is NOT used here -- a base bot has no target, and imputing the nearest one would invent an assignment
  (and not even the mayor's, which avoids duplicate targets). The plain base rate over all short bots is printed
  beside it.
- The GET_WOOD outcome is **relief**, as the lease's `duty_done`: a log gained OR no longer `short_of_wood` (planks
  picked up, a pickaxe obtained; an unknown pickaxe state is never relief). "Logs gained" is printed as its own line.

**Bank certainty** (`withdraw_verified` in `mayor_core.DEFAULTS`, one switch per item, both `False` today). Rule
(decision 2026-10-03): a held-stock shortage is `unknown-bank` only once withdraw is verified for that item, because
until a bot can take an item back out, banked stock cannot relieve the shortage. So GET_WOOD is **definite**.
GET_IRON stays `unknown-bank` by a separate conservative exception (`bank_unknown_conservative = ('iron',)`), so
no iron gap is ever claimed from held iron alone; `unknown-bank` shortages are reported apart (`unkb`), never in the
unforced gap. Flip `withdraw_verified['wood']` to `True` when withdraw of wood is proven on the fleet.

**Replay** (`mayor_shadow.py --replay`) has no lookahead: a row is ingested only once it was WRITTEN (start +
duration_ms), sightings whose `last` is after the snapshot time are dropped, and every snapshot is marked
`replay: true`. The scorer refuses replay snapshots (exit 2) unless `--replay-only`, which scores them on their
own, never mixed with live ones.

**Frontier budget, honestly.** Before every attempt (retries included) it reserves an ESTIMATE, not a bound:
the request bytes (system + prompt + output schema) at 1 token per 2 bytes plus a fixed 1,000-token request
overhead, at the input rate, plus the full `max_tokens` (thinking included) at the output rate. The HARD STOP is on
ACTUAL billed tokens as the API reports them: the run stops when spent + the next reservation would pass
`--budget-usd`. An attempt that timed out, dropped, or returned a 200 without valid JSON, a valid envelope or
numeric usage (`usage: {}` counts as missing, not zero) is charged its reservation -- an estimate. **So when billing
data is unavailable, the cumulative actual cost is not bounded by the ledger**: the stop is on observed billed
tokens plus reservations, and only the provider's invoice is ground truth. Malformed envelopes (null or non-dict
content/output elements, non-string text) are counted invalid, never an exception. The client loads snapshots
streaming with the scorer's replay rule (`--replay-only`, never mixed), skips an unreadable line (counted), counts
a non-JSON 200 as invalid and carries on, normalises every field before using it, enforces the full output schema
(malformed answers are invalid, never an exception), and stores HTTP errors as `http_<status>:<sanitised type>`
only.

## Tests

`python3 -m unittest discover -s scripts/mayor/tests -v` (99 tests, ~45 s). `test_mutants.py` applies each of 99
mutants to a temp copy of the package and runs the WHOLE suite against it in a subprocess; every one must turn it
red (a missing or non-unique anchor raises). **No mutant runs until the unmutated suite is proven green**:
`run_mutants` (used by both the unittest and `--report`) aborts with `BaselineRed` -- `--report` prints ABORT and
exits 2 -- because a red suite reads every mutant as "killed". To see which tests kill which mutant:
`python3 scripts/mayor/tests/test_mutants.py --report`.

## Decision date (no open loop)

**72 h after the shadow starts, record KEEP-BUILDING or STOP** in `docs/reports/STATE.md` and memory. The
start time is the first line of `mayor-ticks.jsonl`. INCONCLUSIVE is a legitimate close; walking away is not.
A duty may only *act* under the plan's owner gate (>= 48 h; unforced gap >= 20 bot-h/day fleet-wide;
executability >= 80%; downstream >= 1.5x base; the duty's refusal chain tested), then ONE duty in ONE world.
