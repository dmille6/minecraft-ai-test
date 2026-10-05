# Which model should run 4-8 smart bots, the overseer, and stuck escalation? (2026-10-05)

> **STATUS: INTERIM — the merged test plan is below; Stage A is running on the Mac Studio.** This file is updated
> as results land. Nothing here has changed the live fleet. The recommendation section is filled in last.

## The question

Owner, 10-05 ~12:30Z: "I'd be fine with 4-8 really smart bots roaming a world ... the overseer using a larger
smarter model, along with when bots are stuck ... which model would be best?"
Widened ~13:00Z: "use both engines to sort out the best approach to test the bot model and overseer model and see
what is possible. Let's do a very extensive and exhaustive test on any models that could work."

---

## THE MERGED TEST PLAN (Claude + Codex)

Both engines wrote a plan independently: Claude's is in the scratchpad as `claude-testplan.md`, and Codex's is
`codex-testplan.out`. This section takes the stronger version of each stage.

**What each engine proposed, and the budget we chose.**
- **Codex** proposed 500-600 Mac-hours, about 3-4 weeks. That includes 348 h of closed-loop runs, 20 matched world
  pairs, and a 2,400-episode replay corpus.
- **Claude** proposed 2-3 days.
- **Merged plan:** about **5-7 days of Studio time**, run as a funnel. Stages A and B prune hard. Stage C spends
  the remaining time on a few finalists.
- **What this budget buys:** it detects large effects. That means a model that halves wasted decisions, or a stack
  with ~30% more output. It cannot rank two good models a few points apart.
- **Codex's 3-week confirmation design** stays available as the follow-up if the owner wants that precision before
  the live canary.

### Ground rules (both engines)

**Fairness and comparability**
- **One model under test on the Studio at a time.** Arms never compete for the GPU, except in labelled load tests.
- **First-pass answers only.** No repair retry, no argument cleaning. The fleet's one repair retry is reported
  separately as "eventual validity".
- **Same request for every model:** the fleet's system prompt, the logged user prompt verbatim, and the fleet's
  JSON-schema grammar.
  - The fleet's system prompt is rebuilt from the deployed source and matched to the logged hash.
  - Prompts the logger cut at 6,000 characters are excluded, and that bias is stated.
  - Format (grammar vs native tool calls) is tested only as a labelled interface factor.
- **Thinking is measured, not assumed.** Reasoning tokens, stop reason, and time are recorded. Thinking is
  "off" only where the runtime really stops it.
- **Exact artifacts are recorded:** tag, digest, quantization, runtime version, context and settings.
- **Arms that fail stay in.** Timeouts and invalid output count against their own arm.

**Scoring and statistics**
- **Deterministic checks outrank judges.** Positive controls are printed first.
- **The headline is "invalid OR a detected hard-constraint violation".** It is a floor on wasted decisions, not the
  waste rate. "Repeats the action that really failed" is reported apart.
- **Paired statistics:**
  - cluster bootstrap by bot or world;
  - McNemar for binary outcomes;
  - Holm correction across the few confirmatory pairs.
- **Promotion criteria are numeric and fixed before results:**
  - worker: >= 99% first-pass valid;
  - overseer: zero accepted hard-rule violations;
  - stack: about +25% useful output with no material death or milestone regression.

### Candidate universe (frozen 10-05; exact artifacts pinned in `bench/models/manifest.json`)

Coverage is family-complete: every family that plausibly fits 128 GB and runs in Ollama or LM Studio. The screen
uses one cheap artifact per checkpoint. Quantization, runtime and format variants are added only for survivors.

**Controls**
- qwen2.5:7b-instruct (the fleet today)
- qwen2.5:14b and 32b
- llama3.3:70b and qwen2.5:72b (2024 dense)
- the deterministic shadow mayor (overseer control)
- the bots' existing recovery behaviour (stuck control)

**Small models (≤15B)**
- qwen3.5:9b
- gemma4:12b
- gpt-oss:20b (low reasoning)
- Ministral 3 8B/14B, Phi-4 14B and Granite (8B class), if the artifacts resolve

**Fast MoE (2-5B active)**
- qwen3.6:35b-a3b
- nemotron-3.5-lightning:30b-a3b
- gemma4:26b (A4B)
- Qwen3-30B-A3B-Instruct-2507
- qwen3-coder:30b (on disk)
- GLM-4.7-Flash, Nemotron 3 Nano and LFM2-24B-A2B, if they resolve

**Dense 24-36B**
- qwen3.8:27b
- qwen3.5:27b
- hermes-4.3-36b (on disk)
- Gemma 4 31B, Mistral Small 3.2 24B, Devstral Small 2 and Muse Glimmer 30B, if they resolve

**Large models for the overseer and escalation**
- gpt-oss:120b at low, medium and high reasoning
- qwen3.5:122b-a10b
- nemotron-3-super:120b
- Mistral Small 4 119B (6B active), via MLX or HF GGUF
- Qwen3-Next-80B-A3B (Instruct and Thinking)
- GLM-4.5-Air (106B, 12B active)
- deepseek-r1:70b (on disk)

**Boundary models (solo only; they cannot sit next to a bot model)**
- Qwen3.8-Flash-Next (about 105 GB)
- Qwen3-235B at 3-bit
- MiniMax-M2.7 at 3-bit

These run only if Stage A leaves a quality gap they could plausibly close.

**Out of scope without the owner**
- Ollama 0.35 "decision models" (nimble, clef). These need an Ollama upgrade.
- Anything that needs mlx-lm, oMLX, vLLM-MLX or a llama.cpp fork. We would have to install a new runtime.

### Stage A — replay of real logged decisions (offline; prunes)

| Pass | What | Size | Keeps |
|---|---|---|---|
| A0 conformance | Every candidate: one request per skill/arg type, hyphenated bot names, negative coords; does the grammar allow every legal action; does think:false really stop thinking; memory and load time | ~20 requests each | runtime-broken vs model-broken separated |
| A1 screen | Every candidate: 120 brain + 24 stuck + 24 overseer items | ~170 calls each | ~12-15 configs (role specialists kept) |
| A2 selection | Survivors: the full 1,008-item brain corpus (420 from 10-05 + 588 from 10-04), 40 stuck, 36 overseer | ~1,100 calls each | 3 workers + 2-3 large models |
| A3 confirmation | Finalists: a LOCKED, untouched set from another day (10-03, ~600 items) | ~600 each | confirms A2 differences |
| A4 factors | On 3 anchors (7B, best MoE worker, gpt-oss-20b) then every finalist: think off/low; Q4 vs Q8 (MLX 4 vs 8 bit); Ollama GGUF vs LM Studio MLX vs LM Studio llama.cpp; JSON-schema vs native tool calls | 300 items per cell | the deployable configuration |
| A5 serving | Finalists: waves of exactly 1/4/8 simultaneous bots; a staggered arrival trace (8 bots, one decision per 30-60 s, 3 blocks of 10 min); the **mixed** load (8 workers + an overseer call every 5 min + escalations) with the worker and overseer models **co-resident**; p50/p95/p99, time to a valid action, memory and swap, reloads | 3 x 10 min per cell | operational limits |

Metrics:
- validity (first pass; and after one repair);
- detected hard infeasibility (craft not craftable, smelt not smeltable, mine/goto elevation), with
  feasible/infeasible/unknown kept apart;
- repeats the really-failed action (coarse and exact);
- breaks the 4x loop;
- agreement with logged successes (weak supervision);
- per-stratum tables;
- a production-weighted score beside the balanced one;
- deadline success (a valid action inside the role's time budget: worker p95 <= 30 s, escalation <= 60 s,
  overseer <= 120 s).

### Stage B — scenario suites with ground truth (independent of Stage A's items)

| Suite | Cases | Ground truth / scoring |
|---|---|---|
| B1 stuck / recovery | 40 real episodes (with body logs) + ~30 constructed (lost pickaxe, water pocket, wrong tool tier, unreachable tree, full bag, the "repeat is now correct" case) | each labelled with executable-from-here remedies and forbidden actions; labels drafted from the trapped-bots causes and agreed by both engines BEFORE any model runs |
| B1-physical | the sandbox's own fixtures (entombed, island, ledge, buried ore, hollow stair, tree) run on Paper with the model as the brain, 5-10 min each, finalists x 2-3 repeats | escaped / time to escape, from the fixture verdict; a scripted known-good policy and an impossible fixture as positive and negative controls |
| B2 overseer allocation | 36 real shadow-mayor snapshots + ~60 generated 4- and 8-bot problems (perturbed real snapshots: distances, caps, scarce targets, leases, nobody-can-do-it cases) | validator violations; utility / optimum from an exhaustive solver; regret; duplicate assignments; correct abstention; compared with nearest, random and the deterministic mayor |
| B3 planning | ~30 starts from real inventories: get a stone pickaxe / furnace + iron ingot / iron pickaxe, plus perturbed ones (table gone, tool breaks, iron unreachable) | a recipe simulator (minecraft-data 1.21 recipes; the bots' own skill semantics) checks every step's prerequisites and whether the goal is reached |
| B4 adversarial | ~30 real prompts perturbed: misleading HINT, a LESSONS line contradicting the inventory, fake tool results, unknown item names, out-of-range counts, cross-world coordinates, nonexistent bots | labelled forbidden answers and the required safe alternative |

### Stage C — closed loop on the Paper sandbox (finalists only)

**Infrastructure**
- **Servers:** the sandbox Paper servers 10.0.0.30:25599-25602. RCON and world resets are allowed there and
  nowhere else.
- **Bot processes:** they run on **10.0.0.31** (node 22, 24 cores, 29 GB free). The mini allows only 2 and the
  Studio has no node.
  - They run from a separate checkout, with separate log and state dirs.
  - They never touch the fleet's units or /var/log/mcai.
- **Brain endpoint:** the Studio's Ollama. The owner made the Studio dedicated to this experiment.
- **Runner:** a bench-owned runner keeps every guard in `sandbox/run-bot.sh`, with one exception. The
  "loopback-only model" rule becomes "the Studio endpoint only".
- **Each run starts from a restored world snapshot, not just a seed.** The restore covers:
  - the world and player data;
  - bot memory, lessons and state dirs;
  - pre-generated chunks;
  - the same spawn, an empty inventory, and fixed difficulty and gamerules.

**C1: worker screening**
- Arms: the 7B baseline plus the 3 best workers.
- Each run is 4 bots for 2 h. 4 matched starts per arm, arm order randomized, servers rotated.
- Two worlds of the **same** arm may run at once (8 bots on one model is the target load). Different arms never
  run at once.

**C2: architecture (overseer and escalation)**
- The best worker with 8 bots, under each of these variants:
  1. none;
  2. the deterministic allocator;
  3. large overseer A;
  4. large overseer B;
  5. large-model stuck escalation;
  6. overseer + escalation.
- Initial overseer: every 5 min, one request at a time, with leases.
- Initial escalation trigger: 3 equivalent failures with no state change, or 5 min without progress. At most 3
  large-model decisions, then a 5-min per-bot cooldown.
- **This needs a delivery path into the bot (bot code), on a sandbox-only branch.** It is designed and reviewed by
  both engines, and the owner is asked before it is built.

**C3: confirmation**
- The chosen stack against the 7B control, 8 matched pairs. The Codex plan's 20 pairs is the stronger version if
  the owner wants it.

**Metrics**

Productivity and progression:
- useful resource-equivalent output per scheduled bot-hour (a conservation ledger: a log is not also counted as
  its planks and sticks; dirt cannot win);
- team output per hour;
- milestones and time to each, censored at the run end;
- pickaxe-less minutes.

Waste and safety:
- loops;
- stuck minutes (the 8-block rule);
- deaths per bot-hour.

Attribution and cost:
- model-chosen vs scripted vs reflex actions, kept apart;
- inference wait.

### Stage D — judging

**Judges and what they see**
- Two vendors judge blind and independently: Claude (separate subagents) and Codex (`codex exec`).
- Neither judge sees the model, quantization or runtime, how many models chose an answer, the logged answer, or the
  other judge's scores.

**Rubric**
- 0-2 on each of: grounding, feasibility, progress, response to failure, and recovery/allocation quality.
- Plus "executable from here".

**Reliability checks**
- 20% order-swapped repeats.
- 10% exact repeats, to measure self-consistency.
- Agreement is reported as weighted κ, Spearman and within-1.
- κ < 0.6 means the rubric gets fixed; disagreeing scores are not averaged away.

**Precedence**
- Deterministic checks always win over judge preference.
- There is no human calibration set (no human annotator in this loop). That limit is stated.

### Order, checkpoints, and what is cut first

**Order:** A0 → A1 → (checkpoint) → A2 + B1/B2/B3 → A3 + A4 + A5 → (checkpoint after Stage A and Stage B) →
C1 → C2 design review → C2 → C3.

**Cut first if time runs short:**
1. Boundary models.
2. Third and fourth quantizations.
3. LM Studio llama.cpp (Ollama already covers GGUF).
4. B4.
5. C3 pairs beyond 6.
6. The second large-overseer arm in C2.

**Never cut:**
- the 7B baseline;
- both vendors' judging;
- the failure strata;
- the locked confirmation set;
- complete telemetry.

---

## Progress log (interim results)

- **Studio state.**
  - Ollama is 0.33.3. Co-tenants: an LCIA keep-warm pins qwen2.5-coder:7b (12 GB) every 4 min, and the fleet
    host's `analyst.py` cron calls qwen3.8:27b at :03 and :33.
  - Ollama's scheduler wedged once, at 12:38Z. The trigger was a qwen3.8 thinking request at a 262k default
    context next to the benchmark, after which every model load hung. Ollama was restarted at 13:00Z the same way
    the Studio's own watchdog does it.
  - Downloads run at about 0.5 GB/s, so a 25 GB model takes about 1 min.
- **Positive control for the deterministic checks.** The checks were applied to what the fleet's 7B really did on
  the same prompts:
  - the craft check fires on 97.5% of logged crafts that really failed for missing ingredients;
  - it fires on 1.1% of logged actions that really worked;
  - the elevation checks fire on 43% of logged bad-argument refusals.
- **qwen3.8:27b with thinking on.** Default effort ran past 15 min on one stuck item. Effort "low" took 168 s and
  "medium" 287 s per brain decision, under contention. **Thinking Qwen3.8 is far too slow for the per-bot role.**

- **Stuck labels (B1 ground truth), written before any model ran.** Claude and Codex each labelled the 40 real
  stuck episodes. They agree on "can one action help at all" for 31 of 40. Their action lists overlap only
  partly: a "good" action from one engine is also "good" for the other 24% of the time and "bad" for the other 5%
  (the rest is unlabelled there). So answers are scored against both lists: GOOD under either and BAD under either.
- **Stage C plumbing works end to end** (8-minute smoke run, 13:27Z, one bot, the 7B):
  - sandbox4 reset to a pristine fleet-seed world;
  - the bot ran on 10.0.0.31 with the Studio as its brain and made 8 real decisions;
  - metrics were extracted;
  - sandbox4 was restored to its own world afterwards.
- **Runtime finding: gpt-oss-120b on Ollama 0.33.3 with a JSON-schema grammar and reasoning "low".** Several
  answers came back EMPTY. The model "thought" and then emitted nothing. This matches an Ollama bug fixed in
  0.34.4 ("structured outputs on thinking models"). It counts against the configuration as measured, and an
  Ollama upgrade (owner's call) could change it.

### A1 screen, first results (120 real decisions, the same items for every model; 13:12-14:00Z)

| model | detected hard-infeasible | repeats the action that really failed (n=77) | repeats the 4x loop (n=17) | adversarial bait taken (of 36) | overseer answers fully valid (n=24) |
|---|---|---|---|---|---|
| qwen2.5:7b (fleet today) | 14% | 71% | 88% | (pending) | 17% |
| qwen3.6:35b-a3b | 2% | 27% | 35% | (pending) | 67% |
| nemotron-3.5-lightning:30b-a3b | 2% | 29% | 53% | 1 | 21% |
| gemma4:26b (A4B) | 1% | 14% | 18% | 0 | 88% |

All differences from the 7B on the first three columns have paired cluster-bootstrap 95% intervals that exclude 0.
That holds for the "repeats the failed action" and "infeasible" columns for every model shown. Early read: every
2026 MoE removes most of the 7B's mechanical waste, and **gemma4:26b leads so far on loop-breaking and on the
overseer validator**. More models are queued: about 30 more screens, then the full A2 set on the survivors.
