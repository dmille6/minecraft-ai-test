# Which model should run 4-8 smart bots, the overseer, and stuck escalation? (2026-10-05/06)

> **STATUS: CHECKPOINT after Stage A (replay) and Stage B (scenario suites), 10-06 06:30Z.**
> - **Stage C1 (closed loop) is running on the sandbox**, 06:24Z to about 21:00Z.
> - The long-tail model screens are queued after it.
> - Nothing here has changed the live fleet.
> - Recommendations below are **provisional until C1 reads out**.

## Provisional recommendation (one per role)

| role | model | how to run it | why (evidence below) |
|---|---|---|---|
| **per-bot brain (4-8 bots)** | **gemma4:26b** (Gemma 4 26B-A4B MoE) | thinking OFF; the fleet's JSON-schema grammar, not native tool calls; **LM Studio MLX 8-bit** (Ollama Q4_K_M is equal in quality at about half the throughput) | best on every deterministic measure (table below); top of both blind judges; 0 of 36 adversarial baits taken; 8 bots at p50 2.5 s / p95 7 s on LM Studio |
| **overseer** | **gpt-oss:120b**, reasoning **medium** | Ollama, with the shadow mayor's JSON schema | 100% validator-clean; exact optimum on 15 of 15 allocation problems and 55 of 60 at "low"; plans reach the goal 12 of 15; about 60 s per call **while** 8 bots run, without slowing them |
| **stuck escalation** | **gpt-oss:120b**, reasoning low or medium (the same loaded model) | as above | 20-45 s per call under load; picks an executable remedy as often as anything tested (9 of 12 at "low") |

Runner-ups:

| role | runner-up | why it is not first |
|---|---|---|
| brain | qwen3.6:35b-a3b | close behind gemma4, but worse on repeats, infeasible crafts and loops (paired, significant) |
| overseer / escalation | **qwen3.8:27b at reasoning "low"** | both judges' favourite and only 18 GB, but a call takes about 7 min while 8 bots share the GPU; viable only off-peak or on its own machine |

**What the owner has to decide or do before a live test**
1. **Memory: RESOLVED 10-06.** The owner cleared the Studio. The pair (about 93 GB) was re-tested co-loaded under
   an 8-bot load, with no swap and 0% missed decisions.
   - The fleet analyst cron stays paused while the benchmark runs. If it returns, it must not load a model on
     the Studio next to this pair.
   - The Studio's :11434 WAN forward has been closed since 15:32Z. The benchmark uses an ssh tunnel; the owner is
     fixing the forward.
2. **C2 (overseer and escalation inside real bots on the sandbox): APPROVED by the owner 10-07 ~01:15Z.** The
   bench-only hook is built on branch `bench-c2` (never main, never the fleet) and is in review by both engines;
   the metrics are pre-registered below, before any run.
3. **Then the live A/B**: 4-8 bots on the chosen stack as their own canary, against a matched control.

**What NOT to use**

| model / setting | why |
|---|---|
| gpt-oss as the per-bot brain with the grammar on Ollama | 21-68% valid, on both 0.33.3 and 0.35.1. Native tool calls fix it (96% valid), but it is no better than gemma4 there. |
| nemotron-3.5-lightning | repeats the 4x loop 53-65% of the time |
| dense 27-36B models as the brain | 30-54 s per decision with 4 bots asking, because Ollama serialises them |
| qwen2.5:7b, kept | it is the worst of everything tested |
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

### A1 screen + Stage B, the main candidates (as of 17:30Z)

**Bot brain.** Each model answered the same 120 real decisions, with thinking OFF (gpt-oss: reasoning "low",
the lowest it has).

- "Took the bait" counts the 36 adversarial prompts, each containing one injected falsehood.
- "p50 @4" is the median time per decision with 4 requests in flight on Ollama.
- The judge columns are Claude's and Codex's blind mean scores (1-5) over 60 of these decisions.

| model | invalid | hard-infeasible | repeats the action that really failed (77) | repeats the 4x loop (17) | took the bait (36) | judge Claude | judge Codex | p50 @4 |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b (fleet today) | 0% | 14% | 71% | 88% | - | 2.22 | 2.52 | 12 s |
| gemma4:26b (A4B MoE) | 0% | 1% | 14% | 18% | 0 | **3.40** | **3.83** | 10 s |
| qwen3.5:122b-a10b | 0% | 1% | 16% | 29% | 0 | 3.24 | 3.81 | 31 s |
| qwen3.8:27b (dense) | 0% | 5% | 17% | 18% | 0 | 3.28 | 3.66 | 54 s |
| qwen3.6:35b-a3b | 0% | 2% | 27% | 35% | - | 3.28 | 3.43 | 10 s |
| nemotron-3.5-lightning:30b-a3b | 0% | 2% | 29% | 53% | 1 | 2.67 | 2.71 | 10 s |
| gpt-oss:120b (low) | **32%** | 0% | 6% | 29% | 0 | 2.60 | 2.98 | 14 s |

**What the brain table shows**
- **Judge agreement:** Spearman 0.78; within one point 88%; the same top model and the same bottom model.
- **gpt-oss's 32% invalid** is a runtime defect, not the model's reasoning. With reasoning plus a JSON grammar,
  Ollama 0.33.3 often returned an empty answer.
- **gemma4:26b through LM Studio MLX 4-bit**:
  - **faster under load**: about 38 decisions/min at 8 concurrent (8.8 s each), against about 25/min for the
    7B on Ollama;
  - **it decides differently from the same model on Ollama**: it agrees with logged successful actions 19% of
    the time against 69%, and its "reason" text is cut at the 60-character cap mid-word.
  - The runtime is therefore a real factor, not a detail.

**Overseer and planning.** Stage B suites, thinking OFF except gpt-oss (low).

| model | overseer answers fully valid (24) | allocation: exact optimum (60) | rule violations (60) | utility / optimum | planning: goal reached (30) | stuck: a GOOD action (either labeller) | stuck: a BAD action |
|---|---|---|---|---|---|---|---|
| **gpt-oss:120b (low)** | **100%** | **55** | **1** | **0.97** | **14** | **58%** | 33% |
| qwen3.5:122b-a10b | 83% | 9 | 37 | 0.45 | 7 | 58% | 46% |
| qwen3.8:27b | 75% | 15 | 13 | 0.42 | 9 | 42% | 46% |
| gemma4:26b | 88% | 20 | 18 | 0.61 | 5 | 38% | 46% |
| nemotron-3.5-lightning | 21% | 1 | 56 | 0.20 | 9 | 29% | 33% |
| qwen2.5:7b | 17% | - | - | - | - | 17% | 50% |

For comparison, a nearest-eligible greedy rule (no model) reaches the exact optimum on 47 of the 60 allocation
problems. **Only a model that reasons beats it.** That points toward the overseer: a reasoning model, with
allocation arithmetic left to code where possible.

**Thinking factor.** The thinking variants of the overseer candidates are queued:
- gpt-oss medium;
- qwen3.6, qwen3.5-122b and nemotron with thinking on;
- qwen3.8 at "low".

**Judge reliability caveat.** The swap and repeat copies sat inside the same packet, so both judges matched them
100%. They saw the identical observation twice, which means this does not measure self-consistency. The
slow-role packets will put the copies in a separate session.

### Runtime: Ollama upgraded, LM Studio made first-class (owner, 10-05 ~17:30Z)

**Ollama upgrade.** 0.33.3 → **0.35.1**, done at 18:00Z between two models (`bench/models/upgrade_ollama.sh`).
- The old app bundle is kept, so the upgrade can be rolled back.
- The digest of the official zip was verified.
- Server config after the upgrade: NUM_PARALLEL 4 (the LCIA env agent), keep-alive per request. Both co-tenants
  still work after the upgrade: the LCIA keep-warm re-pinned qwen2.5-coder:7b, and qwen3.8:27b (the fleet
  analyst's model) answered.
- **Every record now carries its runtime version.**
- Runs before 18:00Z are on 0.33.3. The A2 runs and gpt-oss are being **re-run on 0.35.1 under `-o35` labels**,
  so the A2 comparisons share one version and the upgrade's own effect is measured.

**Concurrency is still not what NUM_PARALLEL=4 suggests.** qwen2.5:7b on Ollama 0.33.3, as one, four or eight
simultaneous decisions (still under measurement on 0.35.1):

| simultaneous decisions | 1 | 4 | 8 |
|---|---|---|---|
| time each | 2.4 s | 9.3 s | 15.7 s |
| throughput | 25/min | 25/min | 26/min |

- **Slots exist, but the work is effectively serial.**
- Ollama's scheduler also forces one-at-a-time for the qwen3.5/3.6/3.8 and Nemotron-H architectures. It says so
  in its own log: "model architecture does not currently support parallel requests".
- gemma4:26b through LM Studio MLX 4-bit:

  | simultaneous decisions | 1 | 4 | 8 |
  |---|---|---|---|
  | time each | 1.7 s | 4.9 s | 8.8 s |
  | throughput | about 38/min at every level | | |

**LM Studio runtime comparison (queued).** Same model on both runtimes:

| model | LM Studio artifact | compared against |
|---|---|---|
| qwen3.6-35b-a3b | MLX 4-bit | Ollama Q4_K_M |
| gemma4-26b | MLX 4-bit and 8-bit | Ollama Q4_K_M |
| gpt-oss-120b | MLX (download resuming) | Ollama |

- Measured on each: validity under the fleet's JSON schema (`response_format` json_schema vs Ollama `format`),
  whether thinking really switches off (reasoning chars, and "Thinking Process" leaking into the answer),
  latency, concurrency at 1/4/8, and a 15-min sustained load.

**Stage C with LM Studio.** The bots' brain speaks only Ollama's `/api/chat`. So `closedloop/ollama2openai.py` is
a thin translating proxy (bench only, never the fleet path).
- The route: proxy on the Studio, then an ssh tunnel on the mini, then 10.0.0.70:11501 for the bots on 10.0.0.31.
- The path was tested end to end at 17:5xZ.
- The bench runner admits only the Studio's Ollama or this proxy as a model endpoint.

**Co-tenants (left running, worked around).**
- The LCIA keep-warm restarts Ollama if `/api/version` stalls. The benchmark never routes through the LCIA
  caching proxy on :11435.
- The fleet analyst's half-hourly qwen3.8:27b call evicted the benchmark's model at least once, and caused GPU OOM
  errors next to gpt-oss-120b: 8 errors at 14:03Z, re-run.
- **Deployment consequence:** with the co-tenants resident (about 32 GB), a 120B-class overseer plus a worker does
  not fit the ~107 GiB Metal budget.

### A2 selection (1,008 real decisions from 10-04 and 10-05) and the runtime comparison (as of 22:50Z)

**A2: paired comparison on all 1,008 decisions (Ollama 0.35.1, thinking off).** In brackets: the 95%
cluster-bootstrap interval of the difference against the 7B.

| model | detected hard-infeasible | repeats the action that really failed (n=648) | repeats the 4x loop (n=144) | same skill as a logged success (n=216) |
|---|---|---|---|---|
| qwen2.5:7b (fleet today) | 13.3% | 73.5% | 90.3% | 75.9% |
| **gemma4:26b** | **1.3%** [-15,-10] | **21.1%** [-57,-48] | **27.8%** [-70,-54] | 54.6% |
| qwen3.6:35b-a3b | 2.9% [-13,-8] | 27.5% [-50,-42] | 33.3% [-66,-48] | 34.7% |

- **gemma4:26b beats qwen3.6 head-to-head** on the same items, with intervals excluding 0:
  - infeasible: -1.6 points;
  - repeating the failed action: -6.3 points;
  - repeating the exact failed action: -2.9 points.
- The 7B's 76% agreement with logged successes is partly **self-agreement**: those actions were the 7B's own.
- nemotron-3.5-lightning repeats the 4x loop 65% of the time on the screen and is out of the running for the
  brain.

**Runtime: the same model through Ollama and through LM Studio.** Screen items (120). Time and throughput are
measured with 1 and 8 simultaneous decisions on the same real prompts.

| model | runtime / artifact | valid | hard-infeasible | repeats failed | repeats 4x loop | 1 bot | 8 bots | decisions/min at 8 |
|---|---|---|---|---|---|---|---|---|
| gemma4:26b | Ollama 0.35.1, GGUF Q4_K_M | 100% | 0% | 13% | 18% | 2.4 s | 17.1 s | 25 |
| gemma4:26b | LM Studio 1.1.7, MLX **8-bit** | 100% | 0% | 16% | 24% | 1.9 s | **8.8 s** | **43** |
| gemma4:26b | LM Studio, MLX 4-bit | 97% | 2% | 16% | 24% | 1.7 s | 8.8 s | 38 |
| qwen3.6:35b-a3b | Ollama 0.35.1, GGUF Q4_K_M | 100% | 4% | 25% | 24% | 2.2 s | 9.4 s | 29 |
| qwen3.6:35b-a3b | LM Studio, MLX 4-bit | 98% | 2% | 31% | 47% | 2.0 s | 10.4 s | 39 |
| qwen2.5:7b | Ollama 0.35.1 | 100% | 15% | 64% | 88% | 2.3 s | 15.4 s | 26 |

**What the runtime comparison shows**
- **LM Studio serves 8 bots about twice as fast as Ollama.** With 8 simultaneous decisions it answers in 9-10 s
  against 15-17 s, at 38-43 decisions/min against 25-29. Ollama is effectively serial on this machine with
  NUM_PARALLEL=4.
- **Thinking OFF works in LM Studio now.** With qwen3.6 MLX, via `chat_template_kwargs.enable_thinking=false` +
  `reasoning_effort: none`, it gave 0 reasoning characters and no "Thinking Process" leak. The 10-02 finding
  ("cannot be made not to think") does not hold on this version with these parameters.
- **LM Studio's JSON-schema enforcement held:**
  - 97-100% valid on the fleet schema, against 100% on Ollama;
  - the few invalid answers on MLX 4-bit were cut-off strings.
- **The 8-bit MLX gemma behaves most like the Ollama build.** The 4-bit MLX one drifted: 19% agreement with
  logged successes against 62-69%.
- **gpt-oss-120b as the per-bot brain is broken on Ollama in both versions**, though for different reasons:

  | Ollama version | what happens | invalid answers |
  |---|---|---|
  | 0.33.3 | 23-28% of answers come back empty after reasoning | 32% |
  | 0.35.1 | the grammar is no longer enforced: it answers `{"action": ...}` or plain text | 79% |

  The same model is **100% valid as the overseer** on both versions, so this is the fleet schema with a reasoning
  model, not gpt-oss in general. Its LM Studio MLX run and a native-tool-call run are queued.

### Slow roles: overseer, stuck escalation, allocation, planning, with thinking (as of 03:40Z on 10-06)

All models below answered the same 54 items:
- 12 stuck episodes;
- 12 overseer snapshots;
- 15 allocation problems with a known optimum;
- 15 planning tasks checked by the simulator.

The judge columns are the blind mean scores (1-5) from Claude and Codex. Seconds are per answer with 4 requests in
flight on Ollama.

| config | thinking | overseer valid (12) | allocation exact (15) | allocation violations | plan reaches goal (15) | stuck: good / bad action (12) | judge overseer C / X | judge stuck C / X | s per answer |
|---|---|---|---|---|---|---|---|---|---|
| **qwen3.8:27b** | low | 100% | 14 | 0 | **12** | 8 / 3 | **4.67 / 4.67** | **3.75 / 4.08** | 304 |
| **gpt-oss:120b** | medium | 100% | **15** | 0 | **12** | 6 / 3 | 4.17 / 4.67 | 3.08 / 3.42 | **43** |
| gpt-oss:120b | low | 100% | 14 | 0 | 10 | 9 / 3 | 3.67 / 3.83 | 3.00 / 3.25 | 24 |
| qwen3.6:35b-a3b | on | 100% | 13 | 2 | 2 | 6 / 5 | 4.25 / 4.33 | 3.75 / 4.00 | 174 |
| qwen3.5:122b-a10b | on | 67% | 9 | 6 | 11 | 8 / 3 | 3.50 / 3.50 | 3.25 / 3.75 | 456 |
| nemotron-3.5-lightning | on | 75% | 13 | 2 | 10 | 4 / 8 | 3.42 / 3.58 | 2.58 / 2.92 | 200 |
| gemma4:26b | off | 100% | 4 | 5 | 4 | 6 / 4 | 3.33 / 3.67 | 3.00 / 3.25 | 6 |
| qwen2.5:7b (fleet) | - | 25% | 2 | 10 | 2 | 1 / 8 | 1.83 / 1.75 | 2.08 / 2.17 | 7 |

**What the slow-role table shows**
- **Reasoning is what wins the slow roles.** Without it, every model is at or below a 10-line greedy rule on
  allocation (greedy: 47 of 60 exact). With it, qwen3.8:27b and gpt-oss:120b get 14-15 of 15 exact and reach the
  planning goal 12 times in 15.
- **The two leaders trade speed for memory:**

  | | qwen3.8:27b (low) | gpt-oss:120b (medium) |
  |---|---|---|
  | memory | ~18 GB | ~65 GB |
  | time per answer | ~76 s alone, 304 s at 4 in flight (serial) | ~11 s alone, 43 s at 4 in flight |
  | judges | preferred | close behind |
  | can sit next to a gemma4 worker? | yes, even beside today's co-tenants | only if the co-tenants move |

- **Judge agreement on the slow roles:** Spearman 0.87, within one point 97%.
- **Judge self-consistency**, with the copies judged in a separate session this time: 81-96% identical scores on
  a repeated or order-swapped item, and 98-100% within one point.

### A5: sustained mixed load, 8 simulated bots (10-06, 03:54-05:50Z)

**Setup**
- Each simulated bot asks for a decision, waits for the answer, then "works" for a random 30-60 s before asking
  again (the fleet's cadence).
- "Overseer" means a real shadow-mayor snapshot every 5 min.
- "Escalation" means a real stuck episode every 3 min.
- Both are served by the second model, CO-RESIDENT with the worker.
- 15 min per row (30 min for the LM Studio row). Ollama 0.35.1 unless noted.

| worker (+ overseer/escalation model) | worker decisions | worker p50 / p95 | misses the bots' 45 s timeout | overseer time | escalation p50 / p95 | swap |
|---|---|---|---|---|---|---|
| gemma4:26b alone | 140 | 3.5 s / 31 s | 2.9% | - | - | none |
| **gemma4:26b + gpt-oss:120b (medium)** | 147 | **4.2 s / 9.0 s** | **0%** | **60 s** | 23 s / 44 s | none |
| qwen3.6:35b + gpt-oss:120b (medium) | 153 | 2.4 s / 7.9 s | 0.7% | 38 s | 19 s / 38 s | none |
| gemma4:26b + qwen3.8:27b (low) | 126 | 9.4 s / 44 s | 4.0% | **403 s** | 389 s | none |
| **gemma4:26b MLX 8-bit on LM Studio** (30 min) | 295 | **2.5 s / 7.0 s** | 0.7% | - | - | - |
| qwen2.5:7b alone (fleet today) | 147 | 3.0 s / 8.7 s | 0% | - | - | none |

**What the serving table shows**
- **gpt-oss:120b can sit next to the 8-bot worker without hurting it.** The worker's p95 stays under 10 s, and an
  overseer call takes about a minute.
- **qwen3.8:27b with thinking cannot share the GPU under load.** The 8 bots' decisions push an overseer call to
  nearly 7 minutes, and its own long reasoning pushes the bots to a 44 s p95. On judged quality it is the best
  overseer, but only on a machine where it does not compete with the bots.
- **The 31 s p95 of "gemma4 alone" came from a co-tenant, not from gemma.** The fleet analyst's qwen3.8 call at
  :03 evicted the model mid-run.
- **The gpt-oss tool-call format fixes it as a worker.** Native tool calls instead of the JSON grammar: 96% valid
  on Ollama 0.35.1, against 21% with the grammar. gemma4 does WORSE through tool calls: it repeats the failed
  action 38% of the time against 13%. The grammar stays for gemma.

### Contamination ledger: co-tenants and infrastructure (added 10-06 ~17:10Z)

The owner cleared the Studio of other projects on 10-06, at about 17:00Z.
- The LCIA keep-warm and the LCIA caching proxy are gone.
- The fleet's own analyst cron is paused: its qwen3.8:27b call at :03 and :33 on 10.0.0.31 is commented out,
  backup `~/crontab.bak-20261006-analyst`.
- **Until then, the Studio was shared.** Every effect of that sharing found so far:

| when (UTC) | what | cause | effect on results | handled |
|---|---|---|---|---|
| 10-05 12:38 | Ollama scheduler wedged; every load hung for about 20 min | a qwen3.8 thinking request at the analyst's 262k default context, next to the co-tenants | 4 stuck items of the 7B timed out | Ollama restarted; the items were re-run |
| 10-05 14:03 | 8 GPU out-of-memory errors (gpt-oss-120b screen) | the analyst loaded qwen3.8 (20 GB) next to gpt-oss (65 GB) and the keep-warm's coder (12 GB) | errors only, not wrong answers | re-run |
| 10-05 19:03 | 6 GPU out-of-memory errors (gpt-oss-120b on 0.35.1) | the same | errors only | re-run queued |
| 10-05, all day | the LCIA keep-warm held qwen2.5-coder:7b (12 GB) on the GPU | co-tenant | less memory headroom; no effect on answers | - |
| 10-05 to 10-06, every :03 and :33 | the analyst's call evicted or competed with the benchmark model | co-tenant | **latency only**: every A1/A2 "p50 @4" figure and throughput sweep that crossed one of these windows reads high (requests that paid a reload are excluded; those queued behind the analyst are not) | latency figures are kept, with this caveat |
| 10-06 03:54-04:10 | "gemma4 alone" serving run: p95 31 s, 2.9% misses | the analyst at 04:03 evicted gemma mid-run | this row's tail latency | superseded by the clean re-test below |
| 10-06 04:35 | the benchmark's own watchdog restarted Ollama during serve-q36+gpt-oss | **self-inflicted** false trip: serving.py writes nothing until it ends | 1 error in that row | watchdog fixed |
| 10-06 C1 runs 06:23-15:52 | the bots' decision latency in the analyst windows: p95 17-25 s, against about 4 s otherwise | the analyst | **all arms alike**, the LM Studio arm included (the GPU is shared); medians barely move | reported; output compared within blocks |
| 10-06 15:32 onward | `ai.ticrcorp.com:11434` stopped answering from the LAN (WAN forward gone; ssh still works) | infrastructure change during the clean-up | the C1 run q25-7b block 1 lost its brain for its last 20 of 90 min; the gemma4 Ollama block-2 run (15:52) never got a decision | q25 b1 is read over 14:19-15:32 only and flagged; the gemma4 b2 run is invalid and is being redone through an ssh tunnel on the mini (10.0.0.70:11502 → Studio :11434) |

**No QUALITY metric was touched.**
- Validity, infeasibility, repeats, judge scores and the Stage B suites depend only on the model's answers, not
  on timing.
- Errored items were re-run, not counted as answers.

**Additions to the ledger, 10-06 evening:**

| when (UTC) | what | effect | handled |
|---|---|---|---|
| 10-06 15:52 | C1 block-2 run "gemma4 on Ollama": no model decision ever arrived (WAN :11434 gone) | **invalid** (folder renamed `INVALID-wan11434-down-…`) | re-run 20:20Z through the supervised tunnel |
| 10-06 06:21 | first C1 attempt: bot name `mbench-s4-Charlie` is 17 characters and was kicked (the limit is 16) | **invalid**, 7 of 8 bots | names fixed; restarted 06:23Z |
| 10-06 16:55-20:20 | C1 deliberately stopped (WAN), then the power outage: the bots host and the world host were down 17:07-19:50Z, and the Mac mini rebooted about 20:06Z | **no C1 run was in progress at 17:07Z**, so none was cut by the outage; the Studio stayed up, so the co-load re-test (16:52-17:36Z) is unaffected | block 2 (3 runs) re-run from 20:20Z |
| from 10-06 20:19 | the bots reach the Studio through a **supervised ssh tunnel on the Mac mini**: launchd agent `com.mbench.tunnel`, ServerAliveInterval 10 / CountMax 3, ExitOnForwardFailure, KeepAlive; it reconnects in about 3 s when killed (tested) and costs 5 MB | every start and DROP is logged in `~/Library/Logs/mbench-tunnel.log` | the runner checks the endpoint from the bots host before each run and waits instead of burning it; it re-checks every 5 min; any drop or failed check inside a run is written to that run's record as `flag` |

**Additions to the ledger, 10-07 early (before C2):**

| when (UTC) | what | effect | handled |
|---|---|---|---|
| found 01:50 | two `pause` lines in a row in the Studio queue (`pause fx`, `pause c2`) would have overwritten each other at once: a pause line wrote its tag without waiting for the earlier holder, so the fixture series would never have seen `pause-fx`. An LM Studio line could likewise overwrite a held pause | **none** (caught before either pause was reached) | a pause line and an LM Studio line now wait until the reservation is free; the series matches its tag exactly |
| 01:47 | while fixing that, the running `lms_factor.sh` (gpt-oss MLX arm) was overwritten in place for about a minute; bash reads a running script by byte offset | **none**: bash was blocked inside `throughput.py` (started 01:43) for the whole minute, and the original bytes were written back into the same inode; the new version was installed by rename | recorded; scripts that may be running are only ever replaced by rename |

**Additions to the ledger, 10-07 (the first C2 smoke and a second power outage):**

| when (UTC) | what | effect | handled |
|---|---|---|---|
| 04:10-04:37 | C2 smoke, arm ov+esc (`cl-c2-ovesc-sandbox4-1007T0409-b90`) ran its full 25 min: 5 overseer calls, 8 escalation calls, 15 directives said in chat, **0 received by the bots**. Root cause below | **smoke FAIL**, correctly: the gate saw no bot-side directive rows. Row flagged in runs.jsonl; smoke blocks are never analysed | fixed in the harness (director renamed); re-smoke queued |
| 04:37-05:01 | C2 smoke, arm det (`cl-c2-det-sandbox4-1007T0437-b90`) | **void**: cut by the outage; no metrics, no row in runs.jsonl | re-smoke |
| 05:01:47-11:53 | **power out on both lab hosts** (10.0.0.30 worlds, 10.0.0.31 bots). The Studio and the mini stayed up; the mini's tunnel to the Studio dropped every ~30 s through the outage window (922 logged drops) and has been stable since 11:41Z | the 05:06Z smoke gate ran against unreachable hosts and saw 0 rows. No Stage A/B item ran on the lab hosts | gate re-read at 12:10Z (coordinator): the real failure was the delivery, not the outage |
| 05:06-12:04 | the series' final GPU-reservation release failed (network) and left a stale `GPU_RESERVED`; the Studio queue waited behind it for **7 h, idle** | lost time only | the release now retries for up to an hour |
| 05:06-12:11 | gemma4 8-bit (28 GB) and the LM Studio proxy stayed loaded after the cut series | the long-tail screen `q3-30b-2507` started 12:06Z with it co-resident for about 5 min: **latency caveat only** for that screen's first minutes | unloaded 12:11Z |
| 12:05 | the deferred `pause c2` line had already been read by the queue and briefly held the GPU again | none (released within a minute) | - |

**Why no directive arrived (proven on sandbox4, 12:08-12:10Z).** mineflayer 4.37.1 raises its `chat` event only when
the sender's name matches its username pattern, `[a-zA-Z0-9_]{3,16}`. The director's name `mbench-Mayor` has a
hyphen. The server broadcast every line (its log shows `<mbench-Mayor> mbench-s4-Bravo directive o1 {...}`), and the
bots received each one only as a raw `messagestr`. Their command handler listens to `chat`, so it never ran.
- **Probe:** a listener client got `messagestr` but no `chat` from `mbench-Mayor`. From `mbench_Mayor`, the same
  lines raised `chat`.
- **A real bench-c2 bot on sandbox4, director `mbench_Mayor`,** logged its own rows: `requested -> admitted ->
  dispatched -> step_done -> completed` for a goto directive (it arrived at 356,72,148). For a `mine y=200`
  directive it logged `requested -> refused (admission: bad_args)`.
- **Fix:** the harness only, no bot code. The director is `mbench_Mayor`, set in one constant, and the chat client
  refuses to start under a name the pattern cannot parse.
- **Reviewed by both engines** (4 rounds, both APPROVE). Hardening that came out of the review: the series releases
  only its own GPU reservation (a unique token or its own pause), with bounded retries and an exit code when it cannot;
  the chain stops on that; smoke blocks are decimal and 90 or above, and the analysis never reads them.
- **The tests could not have caught it.** They drive the queue and the cognitive loop directly and never go through
  the network chat path. The smoke gate did catch it; that is what it is for.

The sandbox4 world after the unclean shutdown:
- It is still in benchmark mode (`level-name=mbench-world`).
- Every C1 run starts by restoring the pristine snapshot (`mbench-pristine-sandbox4.tgz`, intact), so the
  shutdown cannot carry over into a run.
- The C1 series now puts the sandbox back to its own world when it finishes.

### Co-loading re-tested on the cleared Studio (10-06 16:52-17:36Z)

Setup: no co-tenants, analyst paused, 8 simulated bots, an overseer call every 5 min, an escalation every 3 min,
20 min per configuration.

| worker + overseer/escalation | worker decisions | worker p50 / p95 / p99 | misses the 45 s timeout | overseer p50 | escalation p50 / p95 | swap |
|---|---|---|---|---|---|---|
| **gemma4 MLX 8-bit (LM Studio) + gpt-oss:120b medium (Ollama)** | 201 | **2.7 / 8.7 / 15.5 s** | 0% | **29 s** | 17 / 56 s | none |
| gemma4:26b + gpt-oss:120b medium (both on Ollama) | 197 | 3.9 / 12.6 / 15.9 s | 0% | 50 s | 22 / 34 s | none |

**The recommended pair now fits and runs together without swapping.** That is about 93 GB resident across two
runtimes.

**The earlier out-of-memory errors and latency spikes were co-tenant contamination** (see the ledger above).

### Blind judging, brain round 2: runtimes and quantization (10-06 ~20:40Z)

Setup:
- 58 screen decisions;
- 10 configurations;
- reliability copies judged in a **separate session**;
- scores and key in `bench/models/results/judging/round3-brain/`.

| config | Claude mean / share ≥4 | Codex mean / share ≥4 |
|---|---|---|
| **gemma4:26b, Ollama Q4_K_M** | **3.69** / 55% | 3.86 / 69% |
| **gemma4:26b, LM Studio MLX 8-bit** | 3.66 / 50% | **3.97** / 75% |
| qwen3.5:122b-a10b (Ollama) | 3.47 / 51% | 3.79 / 63% |
| qwen3.8:27b (Ollama, no thinking) | 3.47 / 50% | 3.52 / 53% |
| qwen3.6:35b-a3b (Ollama) | 3.31 / 46% | 3.28 / 50% |
| gpt-oss:120b, native tool calls | 3.26 / 44% | 3.47 / 58% |
| qwen3.6:35b-a3b, LM Studio MLX 4-bit | 3.03 / 36% | 2.86 / 32% |
| nemotron-3.5-lightning | 2.78 / 25% | 2.50 / 22% |
| gemma4:26b, LM Studio MLX **4-bit** | 2.72 / 19% | 2.90 / 37% |
| qwen2.5:7b (fleet today) | 2.29 / 12% | 2.38 / 20% |

**What round 2 shows**
- **Both judges put the two 8-bit-or-better gemma4 builds on top.** They also both put the MLX **4-bit** gemma near
  the bottom: **4-bit MLX costs real decision quality, 8-bit does not.**
- **Agreement:** Spearman 0.75; within one point 89%.
- **Self-consistency, now measured in a separate session:**

  | | repeated item, same score | order-swapped item, same score |
  |---|---|---|
  | Claude | 79% | 47% (96% within one point) |
  | Codex | 95% | 69% |

- So candidate order shifts single scores, Claude's more than Codex's. The rankings above are means over many
  items and both judges, and they agree at the top and the bottom.

**Lost artifacts (mini reboot, 10-06 ~20:06Z).** The Mac mini's scratchpad (/tmp) was wiped. Lost:
- the raw score files of judging rounds 1 and 2 (brain round 1; overseer and stuck);
- Claude's research note (restored from the session record: `docs/reports/model-research-claude-2026-10-05.md`);
- Codex's test-plan and method-review outputs, whose content is merged into this report.

The merged numbers of rounds 1 and 2 were already recorded above. Their packets and keys survive on the Studio
(`~/mbench/judge1`, `~/mbench/judge2`). From now on, judge outputs are copied to the Studio and committed under
`bench/models/results/`.

### Stage C1: closed loop, real v1 bots on the Paper sandbox (3 matched blocks, 10-06)

**Setup**
- 8 real bots per run, unchanged fleet code at 1918bb5, plus the bench-only thinking flag.
- A fresh fleet-seed world restored from a snapshot each run; peaceful, keepInventory, an empty inventory, the
  fleet's home.
- 90-minute runs. **Every run is read at the same 70-minute horizon**: one baseline run lost its endpoint at
  minute 72 (see the ledger).
- Arm order randomized within each block. The run is the unit.
- No tunnel drops inside any block-2 run (each run's record checks this).

| arm | runs | team output at 70 min (resource-value units) | bots reaching a stone pickaxe (of 8) | bots with an iron ingot | **stuck minutes per bot** | pickaxe-less share of time | deaths |
|---|---|---|---|---|---|---|---|
| qwen2.5:7b (fleet today) | 3 | 213 (155 / 237 / 247) | 2.3 | 0.7 | **35.0** (38 / 32 / 35) | 0.64 | 0 |
| gemma4:26b, Ollama | 3 | 278 (458 / 140 / 236) | 4.0 | 1.0 | **14.9** (13 / 15 / 16) | 0.68 | 4 |
| gemma4:26b, LM Studio MLX 8-bit | 3 | 248 (305 / 201 / 239) | 4.0 | 1.0 | **14.9** (18 / 8 / 19) | 0.69 | 0 |

**What three blocks can and cannot say**
- **Stuck time.** With gemma4, bots spend **less than half as much time stranded**, on both runtimes and in every
  block (9 of 9 paired comparisons in the same direction).
- **Tool progress.** About **twice as many bots reach a stone pickaxe** within 70 min.
- **Team output is INCONCLUSIVE.**
  - Per-block ratios against the 7B: 2.95, 0.59 and 0.96 for gemma4 on Ollama; 1.96, 0.85 and 0.97 for
    LM Studio. That is a geometric mean of about 1.2x with very wide spread.
  - A fresh world is log-rich, and the 7B gathers logs well. The value metric is dominated by early wood, so a
    90-minute window rewards gathering more than progression.
- **Deaths.** 4 deaths with gemma4 on Ollama is above the 7B's 0 (peaceful world; falls and drowning). This is a
  tripwire to watch, not a verdict: the project's own two-death floor applies per canary.
- **Runtime does not change closed-loop behaviour:** Ollama and LM Studio gave the same stuck-time and milestone
  results.

**Next for C**
- More blocks (3-6 more, about 5 h each) to resolve output, queued after the long-tail screens and the physical
  trap fixtures.
- C2 (overseer and escalation in the loop): approved 10-07; see the pre-registration below.

### C2: pre-registration (written 10-07 ~01:35Z, BEFORE any C2 run)

**What runs.** Sandbox4 only (10.0.0.30:25602, restored from the pristine archive before every run). 8 bots on
10.0.0.31 under bench names, from the bench-only tree `bench-c2` (hook reviewed by both engines before the first
run; the deployed sha is written into each run's meta as `bot_code`). Brain in every arm: **gemma4:26b 8-bit MLX on
LM Studio**, thinking off. 90-min runs; metrics read at the **70-min horizon**, as in C1. Same seeded starts and the
same randomized-block design as C1: each block runs every arm once in a random order.

**Arms** (all four run the same tree with the director set and the `mbench-Mayor` client present, silent where it
has no role):

| arm | allocator | stuck escalation |
|---|---|---|
| c2-none (control) | none | none |
| c2-det | the deterministic shadow-mayor assigner (pinned, md5 fa27084...) | none |
| c2-ov | gpt-oss:120b, reasoning medium, on Ollama, one call per new mayor snapshot | none |
| c2-esc | none | gpt-oss:120b, reasoning medium |

Optional fifth arm, only if time allows: qwen3.8:27b ("low") as the overseer.

**Delivery.** A directive is a chat line from the whitelisted director to one bot. The bot treats each step as a
**proposal** before the work order, so the admission gate, the outcome classifier, the milestone counter and the
decision row all apply unchanged. A refused step releases control to the bot's own model at once (no dead end).

**Escalation trigger** (computed in every arm, intent-to-treat): at most 8 blocks moved in 5 min AND at least 3
failed/aborted/unknown model outcomes; 300 s cooldown; at most 3 calls per episode; an episode ends once the bot
has moved at least 8 blocks.

**Metrics, fixed now:**
- **PRIMARY:** team output at 70 min (the C1 resource-value ledger; crafting priced at its inputs).
- **Secondary:** stuck minutes per bot; bots reaching a stone pickaxe and an iron ingot; deaths (a tripwire, not a
  verdict); the bots' own decision latency p50 (does a co-resident 120B overseer slow the brain?).
- **Mechanism:** the directive funnel from the bots' own rows (requested -> dispatched -> step_done/completed vs
  refused/released/expired/superseded/orphan_outcome); overseer calls, seconds, validator-clean share; escalation
  episodes per arm and the share ending within 10 min. **Dose is read from the bot-side rows**, not from what the
  director sent.
- **Contrasts:** det vs none (does any allocator plus actuator help); ov vs det (does the LLM allocate better than
  the rule); esc vs none (rescue). Paired within blocks; the run is the unit.

**What 3 blocks can show.** Only large effects. C1's output ratios spanned 0.59-2.95 across blocks on one change,
so a team-output difference inside that band will be reported as INCONCLUSIVE, not as a result. Stuck time and
milestones separated cleanly in C1 and are the likelier readable signals.

**Analysis:** `bench/models/closedloop/c2_analyze.py results/runs.jsonl --horizon 70`.

**Hook review record (both engines, before any run).** Branch `bench-c2` (pushed to origin as a bench-only branch;
never merged to main, never deployed to the fleet).

| round | sha | Claude | Codex | what changed in response |
|---|---|---|---|---|
| 1 | b41e8cc | CHANGE | CHANGE | a runner pause dropped the directive; ids not unique per delivery; it survived reconnects; rows carried the flush time; the trigger was overwritten; weak tests |
| 2 | 7593eb3 | CHANGE | CHANGE | while waiting, the bot's own model could put the directive's action on cooldown; `started` logged before the runner ran; a superseded step's outcome was lost |
| 3 | bfd39f4 | APPROVE (lows) | CHANGE | a lease ending mid-step lost that step's outcome |
| 4 | 09a5db5 | APPROVE | APPROVE | none blocking. 510a863 adds one test only (a reconnect mid-step) |
| 5 | 6001cc1 | **APPROVE** | **APPROVE** | the FULL suite caught two of the fleet's own structural tests (planting, workorder) anchored on the work-order line the hook had rewritten; restored verbatim, the directive replaces the order afterwards. d1257ce tightens one wiring test (test only) |

Accepted by both: milestone accounting still excludes a runner `superseded` result, exactly as the fleet does. It is
identical in every arm, and changing it for directive steps only would add a second difference between arms. So the
milestone counter's `executed` must not be read as a per-arm execution count; the directive rows are the dose.
Behaviour mutants: 16 of 16 killed (`bots/test/directives-mutants.py` on the branch).
Full suite (`scripts/run-tests.mjs`) on the bots host at 6001cc1: 224 of 225 files. The one failure is
`craftsync.test.mjs`, subtest "a refresh slower than quietMs beats lockstep", a timing race that fails on the
**base tree too** (alternating single-file reruns: base 3 of 8, hook 2 of 8, same subtest, same message). It is a
pre-existing flake in the fleet lineage, not the hook.
