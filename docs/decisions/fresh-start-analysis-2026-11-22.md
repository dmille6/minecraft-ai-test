# A fresh, AI-first project with low upkeep: analysis

**2026-11-22** · Claude and Codex each wrote an analysis independently, then they were merged here, with outside research on models and hardware.
Builds on [ADR-0004 (draft)](ADR-0004-ai-mind-DRAFT.md) and the [ELK report](../reports/elk-for-ai-mind-2026-11-22.md).
**Where this disagrees with ADR-0004, this document wins.** The changes are marked ⟲.

## Verdict (both agree)

**Start a fresh repo with one bot in one active world. Keep the old project frozen as evidence and as a baseline.**
Do not bring its operating machinery across. Upkeep is high today because:
- **Stalls are fixed by people and agents, not by the bot.** Every dead end becomes a new order, guard or escape module, shipped through a canary.
- **Release states multiply.** The fleet, canary slot, promotion merges, soak gates and the 4,140-line scheduler exist only to manage several versions running at once.
  Fun mode's own audit found that 63% of sampled commits were review rounds, and the statistical machinery caught none of the four reversions.
- **Signals are noisy and outcomes untrustworthy.** 319 of 355 row kinds are internal; 98 alarms are open; results such as "unverified" and "interrupted" mean every number needs a manual check.
- **Control can leak** (Codex, from the code). A hard timeout in `runner.mjs` frees the runner while the abandoned skill keeps running with access to the bot.
  Orders in `cognitive.mjs` charge cooldowns and claims before execution, then need refunds when overridden.

## 1. Architecture: bound every failure, then add intelligence

**The bot owns its stalls. A stall is an input to the mind, not an alarm for a person.**

- **Ownership enforced in code.** Only the kernel touches the bot's controls. Each running skill holds an **execution lease (token)**. When it is revoked, any further call from that skill fails, so a skill that was supposedly stopped cannot keep acting. Execution states are
  `ready → running → cancelling → reconciling → ready`, plus `degraded`.
- **Progress contracts.** The mind chooses what counts as progress (items, distance, blocks, land-report change); **code measures and enforces it**.
  Both skill progress and goal progress are tracked, so a loop that looks busy without moving the goal is still caught. Standing still while smelting counts as progress.
- **A recovery ladder, fixed and bounded:** one local retry → observe again and let the model pick an alternative → after 3 failures with nothing changed, replan or
  **defer the target with a named wake condition** → repeated unrecoverable failure becomes **one incident**, not endless retries. Budgets cover attempts, time, tokens and world edits.
- **Crash-only with reconciliation.** Skills are safe to kill. On restart the bot rereads the world and its own persisted intent before continuing, because world changes survive a client crash.
  Skills are phrased as targets, not increments: "ensure the chest holds 16 logs", not "deposit 16 more".
- **Supervision.** One child process per bot, plus the model servers and the Minecraft server, each restarted with back-off and a restart ceiling. An external supervisor catches a blocked event loop.
- **Deterministic code does four things only:** safety reflexes, the movement and interaction kernel, skill contracts, and the supervisor's budgets. The supervisor never holds game knowledge,
  otherwise the decision tree grows back inside it. Goals, priorities, order and recovery choices belong to the model.

### ⟲ Changes to ADR-0004
1. **Navigation: wrap first, then rebuild.** mineflayer-pathfinder already has dig and place costs, partial search and composite goals.
   M0 builds a **reliable wrapper** (typed results, arrival checks, cancellation) and reproduces the real stuck scenes as tests.
   `canDig=false` was added after bots tunnelled destructively, so digging during travel comes back only once those tests pass, with a budget. The Baritone ideas
   (plan while walking, a cached chunk map) come afterwards, when the tests show they are needed.
2. **Clean-up is a debt, not a precondition for success.** "Undo every temporary change before reporting success" can deadlock: falling blocks, fluids and changed surroundings are not always reversible.
   Record `task_effect` and `cleanup_state` separately. Clean-up obligations survive crashes. **Total clean-up debt is bounded**, and optional growth pauses above the limit.
   **Danger always comes before clean-up.** Tidiness is measured against the agreed landscape and against changes the bots caused; a natural cliff is not litter.
3. **No feature flag inside the old controller.** The new runtime is built fresh and takes helpers over one at a time behind its own interface. Running both systems side by side means double maintenance.
4. **Training keeps failures.** Supervise on verified corrective actions, including recoveries, and keep failed alternatives as labelled evidence. "Successes only" would erase the recovery skill we want.
5. **Evaluation starts small.** Begin with the failures that can stop the first complete task (about 12 live scenarios), not 300 hand-labelled cases in week 1.

## 2. Operations: one release path, one digest, a budget for attention

- **One trunk. Immutable release bundles** holding code, lockfile, config, prompts, skill registry and model id. **One deploy command; rollback is "deploy the previous bundle".**
- **Release gate:** fast contract tests, then about 12 live scenarios (full bag, blocked target, cancel mid-dig or mid-deposit, lost connection, model unavailable),
  then **paired runs** from identical throwaway snapshots on one test server. If the unattended acceptance run passes, it promotes automatically; if it fails, it rolls back automatically.
  One short release record. No branch restacking, no merges after deploy.
- **Worlds:** nightly backups, a snapshot before any destructive change, and a **tested restore**. Rolling back code does not roll back the world.
- **Attention:** one dashboard plus one daily digest showing verified progress, downtime, human interventions, clean-up debt and the release id.
  **Immediate pages only for:** a service that cannot recover, a broken safety invariant, or a failed backup. Blocked targets go in the digest.
- **Upkeep budget:** **30 minutes of owner or developer time per week** once stable, and developer tokens spent on upkeep are tracked.
  **If upkeep goes over budget, new capabilities freeze until it is back under.** This turns "low upkeep" into a rule.

## 3. Logging: causal episodes, a small vocabulary

**Every event carries:** `schema_version, event_id, timestamp, monotonic_time, session_seq, world_id, bot_id, session_id, release_id,
trace_id, parent_id, goal_id, plan_version, decision_id, execution_id`. Unknowns get an explicit value, never a missing field.

**Eight event kinds only:** observation · decision · admission · execution transition · effect · world mutation · goal transition · incident.
Skill names and reasons are fields, not new kinds.

**Capture:** the exact model input and output with the model, sampling settings, and prompt and registry versions; arguments as proposed, as admitted and as run;
**who cancelled, why, and what preempted**; evidence before and after, partial effects, progress counters; each block mutation with coordinates,
before and after state, intent, whether it is temporary, and who owns its clean-up; queue delay, inference time, execution time and tokens; a short rationale (not hidden reasoning).

**Volume:** keep every causal transition and outcome, plus periodic liveness rows. **Aggregate routine path diagnostics** per minute.
Keep a rolling debug buffer that is **flushed around failures**, and sample some successful traces too, so investigations are not biased toward failures.

**Storage:** local append-only logs (the durable intake) → compressed **Parquet on the NAS** (source of truth for analysis and training) →
**Elasticsearch** as a recent search index with a strict mapping. **If ES goes down, the bots keep running.** Detect sequence gaps; quarantine malformed rows
rather than dropping them silently.

**The first viewer answers five questions:** what did the bot know, what did it choose, what actually ran, who stopped it, and what changed?

## 4. Models and hardware

| Machine | Role | Notes |
|---|---|---|
| **5080, 16 GB** (free once the showcase pauses) | **Executive** first, plus planning prompts on the same model | Use llama.cpp here: research found vLLM and SGLang support for Blackwell (sm_120) still patchy in 2026 |
| **3090, ~15 GB free** | Background planning and evaluation, or a second executive if a benchmark shows it is faster (vLLM and SGLang are mature on Ampere) | Hard VRAM cap so Ethan's project is never pushed out |
| **Mac Studio, 128 GB** | **Offline brain:** nightly reflection over episodes, candidate lessons, evaluation judge, hard-plan proposals, teacher for distillation, log analysis, the draft digest | **Never needed for emergency recovery.** Moves expensive thinking off the Claude and Codex token budget |

- **Start with one model for both roles.** Add a separate planner only if completed work improves enough to pay for the latency and upkeep.
- **Executive candidates** (2026 research, to benchmark on real prompts from ELK): **Qwen3.5-9B** (reported BFCL-V4 66.1), **Qwen3.5-4B** (our incumbent,
  beat larger models in an independent tool-call test), **IBM Granite 4.1 8B** (BFCL-v3 68.3%), **Ministral 3 14B**, **Gemma 4 12B**. None has published results for 6 concurrent requests, so measure that.
  A LoRA fine-tune of Qwen3.5-4B *lost* BFCL score: fine-tuning can hurt, so it is tested, not assumed.
- **Planner candidates:** **gpt-oss-20b** (mixture of experts, ~3.6B active, fits the 5080), **Qwen3.6-27B** (24 GB class), and on the Studio **gpt-oss-120b**
  (~60 GB; one MLX run measured ~75 tok/s output, ~650 tok/s prompt processing, 1.6 s to first token at 1k context) or **Qwen3.5-122B-A10B** (~61 GB at 4-bit).
- **The Studio's weak spot is prompt processing.** A 30k-token prompt takes about 45 s to read in. Keep its prompts short and its work batched overnight.
  Check which chip it has (M4 Max 546 GB/s, or a cut-down 410 GB/s part).
- **Serving:** pinned llama.cpp everywhere first (CUDA and Metal from one stack). Try vLLM or SGLang on the 3090 when concurrency demands it; try MLX or vllm-mlx on the Studio
  only if it clearly beats llama.cpp. Bounded queues; stale requests discarded. A large-model judge only *proposes* assessments; world predicates decide whether something physically succeeded.
- **Rules:** the Studio is a new host and a new model location under consolidation, so it needs the owner's yes. The Mac mini stays controller only.

## 5. Fresh project plan

**Carry over:** connection code; movement and interaction helpers that pass tests (each extracted behind the new interface and tested alone); useful fixtures and
the `withMutant` pattern; the region-replay tool; world snapshots and raw logs/ELK data (as reference and a source of scenarios); backup tooling; the telemetry library's
zero-guard and denominator rules; the short owner constraints (no cheats, network, Ethan's GPU, 5080 exception).
**Leave behind:** order selection, strategic admission vetoes, enforced "learned avoid", the escape-module stack, fleet pools and A/B arms, the canary, scheduler and promotion machinery,
per-feature monitors, and the review bureaucracy.

**Weeks 1–4**
1. **Week 1:** list every scheduled job and snapshot all data for the freeze. New repo with a single-bot runtime: kernel, leases, supervisor, causal logging, the viewer,
   inspection and the navigation wrapper. **Prove cancellation and restart reconciliation.**
2. **Week 2:** gather, craft, deposit, minimal placing. Complete **collect materials → make tools → store surplus → remove temporary work**.
   Test a full bag and interrupted operations. Model benchmark on the shortlist.
3. **Week 3:** model-owned goals, bounded replanning, clean-up debt. One useful build. **An unattended overnight run.**
4. **Week 4:** paired regression runs, one-step release and rollback, the digest. **Add a second bot only if one bot is reliable.**

Difficulty: peaceful at first, with easy-difficulty scenarios before survival is called reliable; normal difficulty and cooperation later.

**Advance only when verified useful work rises while human intervention time and unresolved clean-up debt fall.**

## Risks
1. **Rebuilding the old framework** inside the supervisor or the gates. Guard: the supervisor knows only budgets and rungs.
2. **Hiding stalls behind deferral.** Every deferral names its wake condition, and repeats become an incident.
3. **Growing navigation and beautification faster than the contracts stabilise.**
4. **Small models not good enough.** Find out in week 2 from the benchmark; the Studio is the fallback teacher.
5. **An easy evaluation suite.** Every real failure cluster becomes a scenario.
6. **Nothing to watch at first.** Cameras run from frame zero.

## Owner decisions needed
1. Freeze the old system: **pause the showcase** (frees the 5080) and **stop the fleet**, keeping all data. Yes or no?
2. **New repo** (recommended) or a folder in this one?
3. **Mac Studio**: is it available, which chip, and may it host models (a new host under consolidation)?
4. The **30-minute-per-week upkeep budget**, with capability work freezing when it is exceeded: agreed?

## Owner goals for the new platform (OWNER 11-22, later)

- **Hardware is open:** the Dell/Proxmox 3090 host (pve1) and the 5080 host (pve4) may be used for anything needed to build, test, train and study.
  (This supersedes the 11-01 narrow exception on the 5080 for the new project. Ethan's VM on the 3090 stays unless the owner says otherwise.)
- **The end product is open source:** a "showcase" that runs on **one VM and one GPU**. Development may use more.
- **Low maintenance:** no "is anything stalled" checks every few hours, no rebase conflicts, no blocking problems.
- **Timelapses from day 1:** a top-down view of the whole world, isometric views of each project the bots work on, and an isometric view of the town. Well made, showing progress.
- **GitHub explains the process**, with diagrams showing progress over time.
- **The owner can join the world and walk around.**
- **Owner answers 11-22:** Ethan's VM is left alone · license **Apache-2.0** · the repo stays **private** for a while ·
  world access is **LAN only** (the owner uses their own VPN; no port forwarding).
- **Owner 11-22 (latest): build big, ship small.** Use as many VMs as help to train, build, test and analyse, and use ELK where it helps the
  analysis; resource use during development does not matter. **The released product must run on a single system and be run by a novice user.**
