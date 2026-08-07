# minecraft-ai-test

A private Minecraft server as a laboratory for autonomous LLM agents — with
enough instrumentation to tell whether they are actually getting better.

The interesting problem here is not "can an LLM play Minecraft." It is: **when
an agent fails, can you tell whether the model chose badly, the skill was
broken, or the world was hostile?** Most of this repo exists to make that
question answerable.

---

## What is running

Five hosts on their own VLAN (192.168.193.0/24), on one node of a shared
Proxmox cluster.

```
        ┌──────────────────────────────────────────────┐
        │  homepage   http://192.168.193.10            │  ← start here
        └──────────────────────────────────────────────┘

  mc01  .100   Paper 1.21.8 · one pregenerated world · seed 7914455308567851796
               ├── squaremap  :8080   live 2D map, all bots
               └── observer          server-side RCON sampling, 10s

  lab01 .40    five mineflayer agents · Filebeat
               └── 3D bot views :3007-3011   one per bot, live

  evd01 .21    raw NDJSON archive · DuckDB · BlueMap (staged)
  elk01 .30    Elasticsearch 9.4.4 + Kibana :5601
  ctl01 .10    Claude Code · Codex · homepage · the guards

  M4 Studio    Ollama — inference for the fleet (reachable by one firewall rule)
```

**Paper is pinned to 1.21.8, not 1.21.11**, because of an open mineflayer issue
reporting pathfinding and jumping failures specifically on 1.21.11 — and
movement is this project's binding constraint. ViaVersion lets a current client
still join.

Instances are **role names** — `scout scout2 miner gatherer gather2` — never
display names. `systemctl restart mcbot@Scout01` creates a phantom unit that
fails forever while the real bot keeps running.

## How the agent works

Four layers. Each one can override the one above it, and that ordering is the
whole design.

```
  milestone controller   plain code. owns the plan, defines "done"
          ↓
  cognitive layer        LLM picks ONE skill + arguments   ← the only AI part
          ↓
  admission layer        plain code. may VETO the choice
          ↓
  skill layer            deterministic, cancellable, watchdogged
          ↓
  reflex layer           plain code, 500ms. may PREEMPT anything
```

**The LLM's entire job is choosing one skill and its arguments.** It does not
write code, does not own a plan, does not decide when it runs, and its output
is a *proposal* — the admission layer can reject it before anything happens.

That sounds restrictive. It is the point. When something goes wrong, the layer
responsible is unambiguous, and every layer logs why it acted.

### Skills

| | |
|---|---|
| **World** | `goto` · `gather` · `mine` · `place` |
| **Self** | `eat` · `sleep` · `home` · `status` |
| **Items** | `craft` · `deposit` |
| **Social** | `come` · `follow` |

Deterministic, cancellable via `AbortSignal`, and watchdogged. Skills may dig;
**navigation may not** — pathfinder runs with `canDig=false` because with
digging enabled it treats excavation as a normal way to reach a goal and
tunnels the bot into pits.

### Reflexes

Eat when hungry, escape lava, surface when drowning, disengage at low health,
detect being stuck. No LLM — these must happen in under a second, and a model
call would be both slower and less reliable.

### Timeout nesting

```
pathfinding attempt (12s) < stuck reflex (20s) < skill watchdog (180s)
```

This ordering is load-bearing. Getting it backwards once meant the reflex
always fired first and the skill's own recovery path was unreachable code.

---

## Observability

Every skill attempt and every LLM decision is written as JSONL on the agent
host and shipped to Elasticsearch by Filebeat.

**The JSONL files are the source of truth; Elasticsearch is a disposable view.**
Mappings will change, indices get deleted — with files as truth you just
re-ship and lose nothing.

| Index | One document per |
|---|---|
| `mcai-skill-agents` | skill attempt, **and** every reflex firing, entrapment, livelock escape, and death |
| `mcai-llm-agents` | LLM decision — prompt, response, latency breakdown, what was chosen, what happened |
| `mcai-mc-paper` | parsed server log — joins with coordinates, deaths with cause, chat |

Retention 180 days. Dashboards: **"Minecraft AI — Overview"** and
**"Minecraft AI — Agent Behaviour"**.

Every record carries the fields needed to *attribute* a failure rather than
merely observe it:

| Field | The question it answers |
|---|---|
| `code.version` · `code.config_hash` | Which commit and which thresholds produced this run? Without it, comparing runs is guesswork — and comparing runs is the whole point. |
| `perception` | What could it actually see? Separates "chose badly" from "chose the only option available". |
| `skill.inventory_delta` | What actually changed? "gather succeeded" and "8 logs richer" are different claims. |
| `skill.fail_class` | Aggregatable failure taxonomy, not free text |
| `skill.distance_moved` | Productive work vs wandering |
| `outcome` · `schema_valid` | Which prompt shapes produce invalid tool calls? Which decisions preceded a death? |

### Learning from it

```bash
export MCAI_ES_PASS='...'
python3 scripts/reflect.py --hours 6                    # local model
python3 scripts/reflect.py --hours 24 --backend codex   # ChatGPT
python3 scripts/reflect.py --hours 24 --backend claude  # Claude
```

Reads telemetry, computes a failure taxonomy **in code**, and asks an LLM to
interpret only that aggregation — never raw logs, which is where confident
hallucinated narratives come from.

It **proposes; it does not apply.** The first run justified that: it suggested
raising the 180s skill watchdog, but the aborts came from the 20s stuck
reflex, so the change would have done nothing. A reviewer catches that
instantly. An auto-applier ships it.

### Did anything actually improve?

```bash
python3 scripts/progress_report.py
```

Compares hazard and success rates across runs, normalised per hour.

It says *"stopped happening"*, never *"learned to avoid"* — because **the agent
does not learn between runs**. Its memory is a rolling window that dies at
restart, weights never change, no lesson persists. Every improvement so far
came from a human reading telemetry and changing code. Genuine learning would
need persistent memory plus a reviewed path from `reflect.py` back into the
prompt; neither exists yet, and the distinction will matter enormously once
they do.

---

## Watching it

| | |
|---|---|
| **Dashboard** | http://192.168.193.10 — start here. Live fleet metrics, per-bot health, host stats |
| **Top-down live map** | http://192.168.193.100:8080 — squaremap, all five bots |
| **3D per-bot view** | http://192.168.193.40:3007-3011 — live, in a browser, one per bot |
| **In-game god mode** | connect to `192.168.193.100`, then `/gamemode spectator` |
| **Kibana** | http://192.168.193.30:5601 — what it decided and why |

There is no *webpage* that lets you fly freely through the live world: free
flight means streaming arbitrary chunks on demand, which is what a Minecraft
client is. The per-bot views are live and 3D but tethered to their bot; a
spectator client is the only true fly-through.

---

## Decisions worth knowing about

Full reasoning in [`docs/decisions/`](docs/decisions/). Two shape everything:

**[ADR-0001](docs/decisions/ADR-0001-stack-selection.md) — pinned to Minecraft
1.21.8, not the latest.** mineflayer's protocol layer stops at 1.21.11, and an
open mineflayer issue reports pathfinding failures on 1.21.11 itself, so the lab
runs 1.21.8 with ViaVersion for current clients. Bots
that cannot connect make the rest moot. ViaVersion lets a current client join
anyway. This constraint propagates — plugins need per-version builds too.

**[ADR-0002](docs/decisions/ADR-0002-cognitive-layer.md) — structured JSON
output, not native tool calling.** Settled by measurement:

```
tools     0/3 valid   6238ms    ← native tool calling: unusable
schema    3/3 valid   1197ms    ← structured output: perfect, 5x faster
```

Both ADRs were reached by having Claude, ChatGPT, and a local model analyse the
same brief independently, then recording where they agreed and where they did
not.

---

## Things that cost a debugging cycle

Collected because none are obvious from reading the code:

- **ECS reserves `agent.*`.** Filebeat writes `agent.name` to describe *itself*.
  With a `dynamic: strict` mapping that collision rejects 100% of documents,
  silently, the only symptom being one line in a log. The game agent is `bot.*`.
- **libbeat injects metadata *after* input-level processors**, so `agent`/`ecs`/
  `host` can only be stripped in the global processor chain.
- **Ollama truncates silently at `num_ctx`.** No error — the model just looks
  stupid because it has been blindfolded. Set it explicitly, slice client-side,
  and make the model echo a sentinel from the end of the prompt so truncation
  is *detected* rather than inferred.
- **A veto is not a strategy.** The oscillation guard correctly rejected a
  repeated action, but rejecting without redirecting is a livelock — the model
  re-proposes, the gate re-rejects, and nothing about the world changed. Ran
  indefinitely. Rejections now trigger a deterministic relocation.
- **Model eviction dominates latency.** Watch `load_duration_ns`: a 41-second
  decision was 39 seconds of reload. `keep_alive` plus not letting two services
  fight over one GPU's memory took it to 1.5s.
- **`chunk-system.worker-threads: -1`** gave 2 threads on 6 cores. Setting it to
  4 took chunk generation from 17 to ~85 chunks/sec with TPS untouched.
- **`node --check` cannot see an undeclared identifier.** It is a runtime
  `ReferenceError`, not a parse error. A commit referenced four names it never
  declared and the whole reflex layer threw on every tick, twice a second, for
  hours — while the bots stayed connected, kept making LLM calls, and reported
  health 20/20. **Every signal we monitor said healthy.** Only executing the
  branch finds this, and that branch needed a bot to actually be entombed.
- **A `catch` that logs and continues converts an outage into a log line.**
  That is what let the above run silently. Any repeated failure needs a
  *counter* and an escalation, not just capture. Anything repeating at the tick
  rate is an outage.
- **The deploy check had never once worked.** It grepped root-owned env files
  without `sudo`, silently read nothing, and reported "not recorded" while the
  fleet ran 18 commits behind and `_entombed` fired 2,695 times in three hours.
  Success was 5%; deploying the already-committed fix took it to 70%.
  **A check that cannot fail is not a check.** It now fails loudly and lists
  the missing commits.
- **Stamp the version where the CODE lives.** `src/` is shared by every role but
  `env/` is written per role, so version stamps described the last role a deploy
  touched, not what was executing — three bots read two different versions while
  all running a third. `harness/VERSION` sits beside `src/` and is the authority.
- **Size `num_ctx` from the MAX, not the p99.** Telemetry said `p99=2390` and
  `MAX=2542`; 2048 looked safe on the p99 and would have truncated the tail.
  Ollama preallocates KV for `num_ctx * NUM_PARALLEL`, so an oversized window is
  paid on every slot: 8192 held a 9.0GB model at 15.2GB. 4096 took it to 12.0GB.
  Startup now refuses a window smaller than the prompt budget plus headroom.
- **A timer-driven analysis job will preempt live control on a shared GPU.**
  `selfcheck` ran 02:24:56–02:25:29 and the four slowest agent decisions of the
  night — 61s, 48s, 38s, 31s — all landed inside that window. Analysis now
  shares the agents' own model instead of holding a second, larger one resident.

---

## Current state

Rebuilt on new infrastructure on 2026-08-07, which is also the day the telemetry
stopped lying. The full account is in
[`docs/HANDOFF-2026-08-07.md`](docs/HANDOFF-2026-08-07.md).

The old fleet ran 16 hours and produced **81 deaths, 80 of them falls**, with
`goto` succeeding **3%** of the time — while every liveness check reported
healthy. Three defects, all the same shape, *a value reported rather than
measured*:

- `goto` decided why a walk failed by regexing its own error prose. The pattern
  matched our own wrapper timeout, so 393 expired travel budgets were recorded
  as "no route exists". The pathfinder returned `NoPath` **zero** times.
- The reflex layer's stuck detector calls `pathfinder.stop()`, so `goto()`
  rejected with `PathStopped` rather than our AbortError — and **596
  interruptions we caused were charged to the skill**.
- Those false labels were persisted, and the admission gate enforced them. All
  five bots had concluded that walking home was impossible.

After the fixes, on a fresh pregenerated world:

```
goto 33.3% (was 3.0%)   gather 69.6% (was 11%)   craft 56.8% (was 24%)
2 deaths in 4 hours (was ~5/hour)     ~70 actions/hour (was ~375)
```

**This improvement cannot yet be attributed.** Five things changed at once —
the Minecraft version, the world, the purged lessons, the lessons rule, and an
LLM context mismatch. Resolving that confound with an A/A run and one-variable
ablations is the next work, and it blocks everything else. A lab that cannot
reproduce a run cannot support a conclusion.

## What watches it now

- **Death circuit breaker** — 2 fall deaths per bot per 30m stops that bot; 5
  fleet-wide, or 4 at mining depth, stops all. Reads **only** raw death events,
  because the label pipeline has proven it can manufacture evidence. It only
  ever stops; it never tunes or deploys.
- **Commit-mismatch trip** — bots disagreeing on version, or running something
  the trial does not declare, means the trial is uninterpretable. Version is
  `<sha>+<digest of the .mjs actually loaded>`.
- **Independent observer** — server-side position and health, sampled over RCON,
  computing displacement itself. Nothing in the agent stack contributes to it.
- **Evidence archive** — raw NDJSON on a host that runs none of the agents'
  code, pulled over a forced-command key that refuses a shell.

## Layout

```
bots/           the agent — skills, reflexes, cognitive layer, admission gate
docs/decisions/ ADRs: what was chosen, why, and what was rejected
docs/ops/       provisioning and runbooks, with measured numbers
infra/elk/      index templates, ILM policy — apply BEFORE first ingest
infra/homepage/ dashboard config
schemas/        the JSONL record contract
scripts/        reflect.py and operational helpers
```

## Two agents build this

There is no direct channel between them, so **the repo is the message bus**.
Ownership, conventions, and current handoff notes live in
[`docs/COORDINATION.md`](docs/COORDINATION.md); work in flight is announced in
[`docs/IN-FLIGHT.md`](docs/IN-FLIGHT.md).

## How decisions get made here

Architecture choices are put to **Claude, ChatGPT (via `codex`), and a local
model** independently, working from the same written brief. Where they agree,
that is recorded; where they disagree, the disagreement is recorded too, along
with what each uniquely contributed. Both ADRs were reached this way, and the
tool-calling question was then settled by measurement rather than consensus.

Built with [mineflayer](https://github.com/PrismarineJS/mineflayer),
[Paper](https://papermc.io/), [Ollama](https://ollama.com/), and the
Elastic Stack.
