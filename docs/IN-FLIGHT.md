# In flight

Live state. Anything here is either running or waiting on a decision.

_Last updated: 2026-08-07, end of the build day._

## Running now

- **The fleet**: five bots on `mc2-lab01-dm`, Paper 1.21.8 on `mc2-mc01-dm`,
  world seed `7914455308567851796`. First run with correct labels and a clean
  lessons store. Left deliberately untouched to produce a baseline.
- **Death circuit breaker** on ctl01, 5-minute timer, alerts to ntfy.
- **Independent observer** on mc01, RCON sampling every 10s.
- **Evidence collection** on evd01, every 5 minutes.

## Waiting on a decision

- **A/A reproducibility run** — the weekend's first job, and a prerequisite for
  every other experiment.
- **BlueMap render** — staged on evd01, deliberately not started. Hours of IO.
  Run it during a window with no trial.
- **UniFi API key rotation** — the key used to build VLAN 193 is in plaintext in
  a session transcript. The build is done; rotate it.

## Inference topology (changed 2026-08-07 evening)

Instance #1 now splits by model: `scout` and `gatherer` (7b) run on the
dedicated M4 mini at `<mini-host>`; `scout2`, `miner` and `gather2` (14b) stay on
the M4 Studio via `<studio-host>`. See
[`ops/inference-hosts.md`](ops/inference-hosts.md) — the mini is 16GB and cannot
hold 14b without swapping.

**Instance #1 is running a model A/B** (3 bots on 14b, 2 on 7b) that predates
this week. Do not "tidy" it to one model without deciding to end it.

## Known open, not urgent

- `home` has been chosen twice since the purge and succeeded neither time — too
  small a sample to judge whether removing the false lessons helped.
- `mine` success fell (67% → 43%) against yesterday, on a small sample. Watch it.
- `qwen2.5-coder:14b` on the M4 was re-pinned after an Ollama restart; if that
  host reboots, the pin is lost again.
- Cross-instance comparisons are confounded THREE ways, not two: Minecraft
  version, world pregeneration, AND model (instance #1 is mixed 7b/14b,
  instance #2 is 14b throughout). Any "instance #1 vs #2" number in these docs
  should be read with that in mind.
- The three bot roles have still never been demonstrated to behave differently.
  Tonight is the first run where the scout chain is measured in knowledge rather
  than items.

## 2026-08-08 — instance #1 reduced to 5 bots

Stopped `hive1`, `hive2`, `scout2`. Remaining: `scout gatherer gather2 miner
solo1` — 4 private + 1 isolated.

**Why:** a health decision, not an experiment decision. At 8 bots the mini was
91% utilised (p90 19s, p99 69s, 7 errors/hr) and 5.7 GB into swap; the bot host
was at 10.5 GB of 11 GB with 2 GB swapped. At 5 bots the same 70s cadence gives
~57% utilisation, which is out of the region where queueing turns vicious.

**Cadence deliberately unchanged at 70s.** The headroom is for latency, not for
more decisions — spending it would return utilisation to ~89%.

**What was given up:** the shared-lessons (hive) arm. You cannot half-stop a
hive; one bot sharing a lessons file with nobody is a private bot with extra
steps. The shared-world-model comparison survives (private vs isolated).

State archived before stopping, under `/srv/mcbots/state/archive/` on the bot
host: `lessons-hive-<ts>.json` (avoid=14, worked=33, every rule carrying
`reporters=['Hive01','Hive02']`) and `world-facts-<ts>.json`.

Bring the hive arm back when the A6000 lands and `goto` works — it will be a
better experiment then, because the result will be attributable. Note before
restarting it: `#saveMerged()` takes `max(theirs, mine)` on fail counts, so the
hive arm structurally cannot forget. That needs fixing first or the arm measures
the merge rule rather than the hypothesis.
