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
  `~/canary-queue.json`. It launches only into an empty slot and never retries. It walks the
  queue in order and skips an entry only for a typed block that touched nothing (held, a refused
  or dead autorebase, an exposure wait, a blocked attempt that never deployed, and from v43 no
  patch source and a stale staged registration); `~/digest/SKIP-OFF` restores strict head order. A human runs `rearm`, `abandon`, `closed`, `cancel` or `continue`. It takes its own
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
  `promomerge.py` (Mac LaunchAgent, every 15 min) then merges the promoted sha into main: clean
  merge + full suite on .30, or an ancestry-only merge when main already carries it, else it pages
  (`!! promotion ... does NOT merge into main`). Do not race it; re-fetch. A page means a hand merge.
- A gate's install state is its **digest**, not its name: `gatedigest.py` compares the live bundle
  against the registered one. Do not grep for a version string.
- **The showcase takes one change at a time** (owner 11-14; `/srv/showcase/SOAK_GATE`). `showcase_ops.py stage`
  and a first `activate` are refused until the LIVE release has a read (KEEP / REVERT /
  INCONCLUSIVE) written at least 3 h after it went live. Write reads with
  `showcase_ops.py read --run <run> --decision "KEEP (...)" --why "<numbers>"`, never by hand. The
  one way past is a fix of what the live release shows: `stage ... --fix-of <live release or the one
  it replaced> --fix-why "<what it shows>"`. Going back to a release that was live before is never
  gated. (11-13: six releases on 14 bots in a day; the wrong piece was blamed first.)
- **`stopwatch.py` pages when something that worked yesterday never works now** (showcase, hourly,
  `~/digest/stopwatch-showcase.json`). A `stopped:` page stays up until that thing succeeds again;
  retire one on purpose with `--release skill:<name>`. Before calling a piece a KEEP, read what it
  says: a one-hour read of your own piece's rows does not see what else you broke. (11-13: the
  junk well was dead 5 h under three KEEPs.)
- **Before a release that changes how bots walk or place, replay the real route.** Read the blocks
  from the saved region and run the real A* over them (the 11-14 well replay: 17 ms to show the
  route, after a live release had failed for want of it). `mineflayer-pathfinder`'s `goto`
  resolves on any empty `path_update`, a `partial` one included: use `walkToGoal`
  (`cleanzone.mjs`) when arrival matters.

## Commits and merges

- Use `git commit -F -` with a quoted heredoc. With `-m` and double quotes, the shell silently
  eats backticked identifiers.
- Fetch before merging to main. Other agents merge too. Rebase, and **never force-push main**.
- Work only counts once it is on main. `bots/test/nothing-important-is-orphaned.test.mjs` lists the
  files that must stay tracked there. Add to that list when you create one.

## Standing constraints from the owner

- **Consolidation is under way (owner 11-14): read
  [`docs/decisions/consolidation-2026-11-14.md`](docs/decisions/consolidation-2026-11-14.md).** End state: two
  worlds (a test world and the showcase), models on the 5080 and the 3090 only, five VMs. Until it is done:
  no new VMs, hosts or outside model endpoints; weigh new work by whether it survives the two-world end
  state (fleet-pool plumbing does not); deleting a VM or data needs the owner's yes at that time.
- **Bots must survive, move, gather and build in any Minecraft world.** The fix is code.
  **Bots changing the world is fine and wanted.** What is restricted is tools and admin edits:
  no teleporting, no `/give`, no `/setblock` or `/fill`, no WorldEdit, no world-file edits. The
  one exception is an **owner-directed one-off repair**, logged in the ops journal and never a
  substitute for the code fix (`docs/PROCESS-fun-mode.md` § Owner one-off world fixes).
- Swimming is travel, not danger. Water is terrain. The only water reflex is getting air.
- **Network:** never use the 192.168.19x network. Never use the UniFi API on 10.0.0.1 (it triggers
  a WAN re-provision). 10.0.0.72 (pve4, the 5080) is touched only for model serving: the
  owner's 11-01 exception covers llama-server in `/root/servea` and its model files, with
  Ollama qwen2.5 kept as the tested fallback, backups first, and no OS, driver or network
  changes beyond one unit, `servea-boot.service` (11-03, owner "get everything running": restarts
  llama-server after a reboot only while `/root/servea/AUTOSTART` exists). Its host key was verified 11-02 (ED25519 `SHA256:IvXdH5Pv…TZxo`). Never disable
  `rpcbind` on a Proxmox node. Never print keys. The Mac mini is a controller only: no models
  and no heavy jobs on it; full test suites run on a test host via `python3 scripts/host/suite-run.py` (a free ci host first --
  ci2/ci3/ci4 10.0.0.34-36, least loaded -- then 10.0.0.30; one suite per host under its `~/suite.lock`, `nice -n 19`).
- The Blackwell is for tests only; long-term serving runs on the 5080 and the 3090 (owner 10-31).
- **Reviews follow fun mode:** one engine, one round, blockers only. Two engines plus a real
  search of open source, issues and forums are for **protected scope**
  (`python3 scripts/lib/protected.py`) and for anything that rests on Paper or mineflayer behaviour
  nobody here has seen work.
- `codex exec`: pass the prompt as an argument with `</dev/null`, or on stdin with `- < file`
  (then without `</dev/null`). macOS has no `timeout`, so use a kill watchdog.
- The memory experiment (four arms, arm-stratified analysis) is **retired**, not paused (09-04).
  Lab mode keeps its measurement process for one declared experiment at a time.
