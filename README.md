# minecraft-ai-test

A private Minecraft server as a laboratory for autonomous LLM agents — with
enough instrumentation to tell whether they are actually getting better.

The interesting problem here is not "can an LLM play Minecraft." It is: **when
an agent fails, can you tell whether the model chose badly, the skill was
broken, or the world was hostile?** Most of this repo exists to make that
question answerable.

---

## What is running

```
                    ┌──────────────────────────────────┐
                    │   homepage   http://mcai.lan     │  ← start here
                    └──────────────────────────────────┘

  mcai                                    mcelk
  ├── Paper 1.21.11 (Minecraft)           ├── Elasticsearch + Kibana
  ├── Scout01 — mineflayer agent          ├── Hermes Agent (+ dashboard)
  ├── squaremap    :8080  top-down map    └── Glances      :61208
  ├── 3D bot view  :3007                       ▲
  ├── Glances      :61208                      │ read-only
  └── Filebeat ───── logs + telemetry ─────────┘

  studio      — Ollama, serves agent + Hermes inference (large models)
  gpu-host    — Ollama, small fast models and embeddings
```

Hostnames above are placeholders; real addresses live in `.env` files on the
hosts and are deliberately not committed.


Full inventory, ports, and accounts: [`docs/ops/services.md`](docs/ops/services.md).

---

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

`goto` · `gather` · `craft` · `place` · `mine` · `eat` · `sleep` · `deposit` ·
`come` · `follow` · `home` · `status`

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
| `mcai-skill-agents` | skill attempt — name, args, status, duration, bot state at the time |
| `mcai-llm-agents` | LLM decision — prompt, response, latency breakdown, `schema_valid`, what was chosen, what happened |
| `mcai-mc-paper` | parsed server log — joins with coordinates, deaths, chat |

Retention 180 days. Dashboard: **Kibana → "Minecraft AI — Overview"**.

The `outcome` and `schema_valid` fields are what make this a corpus rather than
an archive: they let you ask *"which prompt shapes produce invalid tool calls?"*
and *"which decisions preceded a death?"*

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

---

## Watching it

| | |
|---|---|
| **Top-down live map** | http://mcai.lan:8080 — agent and player markers |
| **3D over-the-shoulder** | http://mcai.lan:3007 — browser, no game client needed |
| **In-game god mode** | `/gamemode spectator`, then `/spectate Scout01` |
| **Kibana** | what it decided and why |

---

## Decisions worth knowing about

Full reasoning in [`docs/decisions/`](docs/decisions/). Two shape everything:

**[ADR-0001](docs/decisions/ADR-0001-stack-selection.md) — pinned to Minecraft
1.21.11, not the latest.** mineflayer's protocol layer stops at 1.21.11; bots
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

---

## Current state

Phase 1 (infrastructure) is complete. The agent connects, survives restarts,
recovers from death, and the LLM drives it autonomously toward a milestone
chain ending in stone tools.

**Known gaps, honestly:** no automated tests — every bug so far was found by
hand; world backups sit on the same volume as the world they protect; there is
observability but no alerting; and no griefing controls yet, which matters now
that an LLM can choose `place` and `mine`.

Difficulty is `peaceful` on purpose. With no weapon, armour, or combat skill,
an armed night produced 22 mob deaths in six hours — that measures the world's
hostility, not the agent's judgement. Combat is its own milestone.

---

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

Built with [mineflayer](https://github.com/PrismarineJS/mineflayer),
[Paper](https://papermc.io/), [Ollama](https://ollama.com/), and the
Elastic Stack.
