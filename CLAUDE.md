# Working rules for this repo

> **FUN MODE (OWNER DECISION 2026-10-28) — read [`docs/PROCESS-fun-mode.md`](docs/PROCESS-fun-mode.md) first.**
> It sets the process: tiers by risk (`config/protected-paths.txt`), reviews, canary reads, the showcase,
> the rollout ledger, stuck goals. This file holds the **tooling rules** that still apply under it.
> Current state: [`docs/reports/STATE.md`](docs/reports/STATE.md) (one screen). The history and
> rationale behind every rule here, and the full lab-mode process, are in
> [`docs/archive/CLAUDE-history-2026-10-28.md`](docs/archive/CLAUDE-history-2026-10-28.md).

Every rule here exists because breaking it cost real time. Where a rule could be made
mechanical, that is the better fix and this file should shrink. `ZeroLooksWrong` is the model:
it does not ask you to remember, it raises.

The failure this project keeps repeating is **believing a cheap negative**: a zero from a query,
an empty mutant, a short window, a green run of the wrong runner. The second is **never
closing**.

## Done means read, not merged

```
merged -> deployed -> observed -> KEEP / REVERT / INCONCLUSIVE recorded -> memory says SHIPPED
```

A local test proves the code does what you wrote; only the fleet or the showcase says whether it
was worth writing. **While a canary is deployed and unread, read it and close it before starting
the next change.** `check-open-loop.py` raises `OpenLoop` when the manifest declares a canary with
no decision against its sha. INCONCLUSIVE is a legitimate close. Walking away with nothing written
is not. (09-04: five commits sat undeployed, including all three drowning fixes, while six fresh
analyses were written.)

## Telemetry: use `scripts/lib/telemetry.py`. Do not hand-roll a query.

```python
from lib.telemetry import Events
ev = Events.load(since_minutes=180)
ev.count('drowning_route')          # raises ZeroLooksWrong on a suspicious 0
ev.by_bot('mine'); ev.where('mine', lambda r: 'water' in (r.get('detail') or ''))
```

Pass `allow_zero=True` only after proving the query finds something. (Hand-rolled queries gave
"84 of 84 bots immobile" and "rideFloorDown places zero blocks" in one day; both were wrong.)

- **Full walks only** (~4 s). Seeking to the tail eats the baseline.
- **`grep -a`**: the files trip binary detection.
- Event kinds are in `skill.name`, position in `bot.pos`, inventory in `bot.inventory`, pool in
  `exp`. There is no top-level `snapshot`.
- **`Events.rate()` requires `bots=`**; pass `bots='auto'`.
- Logs rotate at about 23:59Z. Reads that span it must load the rotated files.
- **Wide windows: `scripts/lib/estelemetry.py` (Elasticsearch). Gates and canary reads: the
  files.** It refuses windows that touch 10-07 (duplicate docs), and it cannot tell null from
  absent. `scripts/host/fleetstatus.py` gives the 3 h / 24 h / 7 d status.
- Daily numbers come from `scripts/host/scoreboard.py`, not from hand arithmetic.

## Tests: `npm test` from `bots/`. Never a homegrown loop.

`npm test` runs `node scripts/run-tests.mjs`, which sets `SKILL_TIMEOUT_MS=300` and
`SKILL_HARD_STOP_GRACE_MS=300`. A test that assumes production timeouts passes on its own and
fails in the suite. Some files really take 56 s and 210 s; that is slow, not hung. Do not switch
branches in a worktree while a suite runs there; use a second worktree. Lint every variant built
across bases (`npm run check`); the no-undef gate once went unwired.

## Every negative claim carries a positive control. Say the denominator.

Before writing "zero X", show the same query finding something: a neighbouring event kind, or
just the totals for rows, bots and timestamps. Before writing a number, say **out of what**.
"0 placed blocks" was true of the failures and false of the population.

## Test behaviour. Source-grep only for structural invariants.

Pull a decision into an exported pure function and test what it does (`overheadBreakRisk`,
`climbPrereqFor`, `stairLiquid`). Source assertions are right only for what behaviour cannot reach:
a skill is registered, a dangerous call is absent, a config value is wired, a guard is still dead.
When you write one, strip comments first (comments here quote the code), anchor on the executable
line, and prove it fails for the intended reason with a mutant. Never assert decision logic by
matching text.

## Mutants must assert their anchor is present and unique

```python
assert src.count(old) == 1, "ANCHOR MISSING OR NOT UNIQUE"
```

A mutant that silently fails to apply reads as "killed". Reuse `withMutant` in
`bots/test/climb-escape.test.mjs`.

## A new refusal must name a remedy the bot can perform from where it is

The repeated trap is **two correct guards composing into a dead end**. Check that the remedy is
**executable from here**, **reachable** (advice printed is not advice taken; if it must happen,
make it deterministic), and **composed**: test the refusal chain, not the single guard.

## Deploys

- **Run the deploy script from a copy outside the repo.** It `git reset`s its own tree, and bash
  re-reads a running script by byte offset:
  `sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh && sudo /root/d.sh <sha> <run_id> "<notes>" [--pool P]`
- **One canary slot, ever.** The tripper matches `canary_pool` literally. Two canaries mean three
  versions, which halts the fleet. (Two lanes were evaluated and rejected 10-08.)
- **The scheduler `~/canary-sched.py` (cron, every 5 min) launches canaries** from
  `~/canary-queue.json`. It launches only into an empty slot, never skips the head, and never
  retries. A human runs `rearm`, `abandon`, `closed`, `cancel` or `continue`. It takes its own
  lock. **Never wrap it in `flock`**, because that deadlocks.
- **Installers hold `/tmp/mcai-canary.lock` (flock -n)** for their whole run. Call
  `canary-sched.py install-hold <owner> <minutes>` first and `install-release` when done.
- **Teardown is THREE steps:** remove the drop-ins, clear `canary_pool`, **and restart the pool's
  bots**, staggered 12 s apart. Then confirm exactly two versions are live. The first two steps
  are config only, and the bots keep running canary code from memory. (09-04: after a two-step
  teardown, all five bots were still on the canary build.)
- **The pre-push hook blocks canary branches, and that is a false positive.** A canary branches
  from the deployed baseline, so it is behind main by construction. Confirm the remote branch does
  not exist yet, then push it with `--no-verify`, for that push only.
- A canary pool must **contain the population the fix targets**, or it shows nothing.
- **The death gate needs two canary deaths** (and more than 1.25x the control rate) to trip. One
  death gets named in the read; it is not a verdict.
- **Never promise a look before rollout.** The loop auto-promotes about 10 minutes after a KEEP.
  The coordinator merges a promoted sha to main within 1–25 minutes, so re-fetch rather than race
  it.
- A gate's install state is its **digest**, not its name: `gatedigest.py` compares the live bundle
  against the registered one. Do not grep for a version string.

## Commits and merges

- Use `git commit -F -` with a quoted heredoc. With `-m` and double quotes, the shell silently
  eats backticked identifiers.
- Fetch before merging to main. Other agents merge too. Rebase, and **never force-push main**.
- Work only counts once it is on main. `bots/test/nothing-important-is-orphaned.test.mjs` lists the
  files that must stay tracked there. Add to that list when you create one.

## Standing constraints from the owner

- **Bots must survive, move, gather and build in any Minecraft world.** The fix is code.
  **Bots changing the world is fine and wanted.** What is restricted is tools and admin edits:
  no teleporting, no `/give`, no `/setblock` or `/fill`, no WorldEdit, no world-file edits. The
  one exception is an **owner-directed one-off repair**, logged in the ops journal and never a
  substitute for the code fix (`docs/PROCESS-fun-mode.md` § Owner one-off world fixes).
- Swimming is travel, not danger. Water is terrain. The only water reflex is getting air.
- **Network:** never use the 192.168.19x network. Never use the UniFi API on 10.0.0.1 (it triggers
  a WAN re-provision). Never touch 10.0.0.72. Never disable `rpcbind` on a Proxmox node. Never
  print keys. The Mac mini is a controller only: no models and no heavy jobs on it.
- **Reviews follow fun mode:** one engine, one round, blockers only. Two engines plus a real
  search of open source, issues and forums are for **protected scope**
  (`python3 scripts/lib/protected.py`) and for anything that rests on Paper or mineflayer behaviour
  nobody here has seen work.
- `codex exec`: pass the prompt as an argument with `</dev/null`, or on stdin with `- < file`
  (then without `</dev/null`). macOS has no `timeout`, so use a kill watchdog.
- The memory experiment (four arms, arm-stratified analysis) is **retired**, not paused (09-04).
  Lab mode keeps its measurement process for one declared experiment at a time.
