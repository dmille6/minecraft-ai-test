# Learning loop for the bot brain: continuous fine-tuning (design, 2026-10-21)

Status: **DESIGN + offline prototype only.** Nothing was trained or served. No fleet, queue, scheduler, manifest, env file
or endpoint was changed, and 10.0.0.72 was never contacted: every 5080 number below comes from the bots' own decision
rows. No paid API was called. The owner approved the design direction on 2026-10-21 ~03:30Z, including a small
paid-teacher pilot. Branch `learning-loop-1021`. Evidence files: `docs/reports/learning-loop-1021/`. Scripts:
`scripts/learnloop/` (read-only; they ran on 10.0.0.31 under `nice -n 19`, the largest at 0.7 GB RSS).

## 0. The answer in brief

- **The data is already there and it is clean.** On 10-20 the fleet logged 160,559 decision rows on 80 bots. 151,549 of them
  were model decisions, and every one carries the full user prompt and the raw model response. Elasticsearch agrees
  with the files row for row.
- **The current label ("good decision") follows output, but only weakly.** Good decisions are followed by 3.4x the items of bad
  ones within 120 s. But across 80 bots, the share of good decisions ranks bots by output at only rho +0.28.
  brain-01 is the warning: success share +16 pp and refusals -24 pp, yet items -4.1/bot-h. **The loop must be judged
  on items and stagnation, never on decision-level success.**
- **Base and framework:** Qwen3-8B (Apache-2.0), trained with QLoRA in Unsloth on the 3090. qwen2.5-7B with the same
  training is the offline control arm. 14B (Qwen3-14B) is a second arm, run only if the 8B arm moves the bench.
- **Export path:** Ollama dropped LoRA `ADAPTER` support in v0.34.1. So: merge the adapter, convert with llama.cpp, quantise
  to Q4_K_M, then `FROM model.gguf`.
- **Teacher pilot:** 1,000 hard decisions, relabeled by Claude Opus 5.5 and OpenAI gpt-6.1-sol (Batch API) and by local
  gemma4:26b. Estimated **~$35** at batch list prices, with a hard **$100/month per-vendor cap**.
  - The labels are used for **scoring only** until the owner settles the vendors' output-use terms (s.2.4).
  - Anthropic's Usage Policy names model distillation "without prior authorization".
  - OpenAI restricts using Output to develop "models that compete".
- **Model bench:** 4 worlds x 5 bots, each world split 3/2 by bot, with a daily AB/BA crossover.
  - At 72 h per period, the smallest effect it can detect at 80% power is **items/bot-h 19% of the mean**, success share 4.4 pp and refused
    share 5.4 pp.
  - A plain 10 v 10 parallel split needs a **38%** items effect, so 10 v 10 alone is too weak for output.
- **The 3090 move: feasible.** With the 3090's bots added, the 5080 would face 4,494 prompt tok/s in the busiest hour. That is
  31% of its measured 14,582 tok/s per-request prefill rate. The 5080 carried all 80 bots until 09-11.
  - Do it at the next fleet-wide restart (a promotion) in a canary gap, with a read at +60 and +360 and a 12 s-staggered rollback.
- **Schedule:** the loop is "continuous" in data, but promotion runs one candidate at a time. A candidate needs about
  2 weeks from data to a fleet canary read. A **kill criterion** is built in (s.6).

---

## 1. Data pipeline

### 1.1 What a decision row holds (verified on the rows, 10-20)

`/var/log/mcai/<bot>/llm-<bot>.jsonl` holds one row per decision, written by `bots/src/logger.mjs:logLlm`.

**Decision fields:**
- `prompt.text`: the user prompt as sent, capped at 6000 chars.
- `prompt.system_hash`: the system prompt, by hash only.
- `response.text`: the raw model output, capped at 4000 chars.
- `tool_calls[0]`: the parsed `{skill, args, reason}`.
- `llm.*`: model, endpoint, tokens, latency, durations, `schema_valid`, `args_cleaned`, `error` (the gate's refusal reason), `admission`.

**Outcome fields:**
- `outcome.status` and `outcome.detail` (detail capped at 400 chars).
- `bot.*`: pos, inventory, tools.
- `perception`.
- `code.version`, `exp.pool`.

**Not in the row, and where it is:**

| needed | where | coverage on 10-20 (denominator) |
|---|---|---|
| system prompt text | rebuilt per code version from `src/prompt.mjs` and matched by hash (brain-01's `/tmp/brain01-sysprompt.mjs`, `~/brain01/system_prompts-0cdb1a8.json`) | 3 hashes on 10-20; brain-01 matched 3 of 3 and 420 of 420 items on 10-12 |
| the bot's own evidence value (valuable / neutral / costly) | computed in `cognitive.mjs` but **dropped by the logger's allowlist**; recovered from the NEXT prompt's `RECENT EVENTS` line `<skill> -> <status> (<value>)` | 80,605 of 81,031 admitted decisions (99.5%) |
| the executed skill row (duration, `inventory_delta`, `distance_moved`) | `skill-<bot>.jsonl`, same skill name, stamped at the decision start | 70,699 of 81,031 admitted (87.2%) |
| deaths, stagnation, milestones after the decision | skill rows `_death`, `_stagnation*` / STAGNANT, `_milestone_complete` | 36 / 5,262 / 9,769 rows that day |

**Prompt and response completeness.** Every model row has `saw_end:` within 40 chars of the end and is under the 6000-char
cap. The response echoes the nonce. So **151,549 of 151,549 model rows (100%) carry a complete prompt and a present
response.** This is a positive control as well as a count: the same test is what would have caught truncation.

**Follow-up (not built here; it is bot code):**
- Add `outcome.value` and `because` to the llm row.
- The ES template is `dynamic: strict`, so the mapping must change first, or every doc is rejected whole. brain-01's `llm.brain` already hit this.
- Ship it as its own tier-1/2 change.

### 1.2 The triple

`scripts/learnloop/extract_triples.py` writes one JSON line per model decision:

- **Identity:**
  - `id` = sha1(system_hash + prompt with the nonce normalised) + timestamp;
  - `ts`, `bot`, `pool`, `code_version`, `model`, `endpoint`, `system_hash`, `trigger`, `milestone`.
- **State:** `prompt`, `prompt_complete`.
- **Action:** `response` and `action{skill, args, reason}`.
- **Gate:** `gate{refused, reason, admission}`.
- **Outcome:** `outcome{status, detail, value, duration_ms, inventory_delta, distance_moved, next_decision_s}`.
- **Windows:** `window{120, 600}{items, deaths, stagnation, milestones}`. The windows are measured from the decision start.
  Items are positive `inventory_delta` summed over the bot's non-underscore skill rows.

Deterministic decisions (`latency_ms` 0, no endpoint) are counted but not emitted. There were 9,010 on 10-20; they are work
orders and town jobs, i.e. code. A future version may keep them as a non-model anchor set (s.3.4).

### 1.3 Outcome labels

The definitions are brainread's, so they can be checked against the brain-01 read:
- **model decision** = `latency_ms > 0`;
- **refused** = outcome `aborted` with `admission` null;
- **success** = outcome `success`.

| label | rule |
|---|---|
| **bad** | refused, OR executed `failed`/`aborted`, OR a death or a stagnation event within 120 s |
| **good** | executed `success` AND (the bot's own value is `valuable` OR its own skill gained items OR a milestone completed within 120 s) AND no death within 600 s |
| neutral | everything else (success with no durable evidence; `unknown`; `no_effect`) |

**Validation.** The full output is in `docs/reports/learning-loop-1021/label_check-20261020.txt`.

- **Positive control on the definitions.** On 10-20, 46.5% of model decisions were refused (70,518 / 151,549) and 23.3%
  succeeded (35,353 / 151,549). The brain-01 read's control arm measured 47.6% and 22.4% on 10-19/20 with the same
  definitions. That is the same instrument on a neighbouring window, and it agrees within about 1 pp.
- **Positive control on the joins.** Elasticsearch for 10-20 gives llm 160,559 (files: 160,559), `_death` 36 (36),
  `_stagnation` 5,070 (5,070) and `_milestone_complete` 9,769 (9,769). Skill rows were 1,491,973 against 1,491,978; the
  5-row gap is the known rotation race.

**Do the labels track outcomes?** Denominators are the model decisions carrying each label.

| label | n | items / decision, 120 s | items / decision, 600 s | deaths / 1k (600 s) | milestones / 1k (120 s) |
|---|---|---|---|---|---|
| good | 32,714 | 3.98 | 12.51 | 0.00 (by construction) | 363 |
| neutral | 4,146 | 2.27 | 11.36 | 26.1 | 101 |
| bad | 114,689 | 1.18 | 6.38 | 2.59 | 75 |

**The bot-level check is weak.** Across 80 bots, each with more than 6 h of decisions, the rank correlation with the
bot's items per hour is:
- good share: rho +0.28;
- success share: +0.30;
- refused share: -0.30.

Part of the 120 s item gap is circular, because "good" uses the decision's own gain.

**What this means for the loop.** This is the central caveat of the design. A model trained to raise the good share can
raise it without raising output, and that has already happened twice:
- **brain-01** (+720 read): success share 22.5% -> 39.7% against control 21.3% -> 22.4% (DiD +0.161, null SD 0.067), and
  refused share DiD -0.241 (null SD 0.088), **but items DiD -4.1/bot-h**.
- **model-tier-01** (qwen2.5:72b, 09-13): items -38%.

So the labels are a training signal; they are not the scoreboard. Promotion is judged on items/bot-h and
stagnation/bot-h in the bench and the canary (s.4). The label is re-weighted toward durable progress: items in 600 s
and milestones. Stratifying by skill is mandatory, because good shares differ by skill:
- mine 44%;
- explore 26%;
- gather 22%;
- goto 18%;
- craft 5.6%;
- deposit 1.0%.

### 1.4 What one day supports (10-20; `triples-summary-20261020.json`)

**Volume:**
- **160,559** decision rows; **151,549** model decisions (94.4%); 9,010 deterministic. 80 of 80 roster bots; 16 worlds,
  8,312-10,956 model decisions each.
- Endpoints: 10.0.0.72 110,325; 10.0.0.16 37,741; Studio tunnel 3,483 (gemma4, brain-01 until its 04:51Z close).
- Code versions: 5 (adbec4f4 59,267; 9e7d9980 76,558; 78fa19d9 3,487; a52d075e 7,011; 31416ee5 5,226). Every
  triple is tagged, so a code-version filter is a field, not a guess.
- Tokens: prompt p50 2,494 and p95 2,739 (sum 376 M/day); completion p50 57 and p95 88.

**Clean outcomes.** At least **92.9%** of model decisions have one. All 70,518 refusals carry a gate reason. Of the 81,031
admitted decisions:
- 70,699 have their own skill row;
- 80,605 have the bot's evidence value;
- inclusion-exclusion gives >= 70,273 with both.

**Duplicates.** Exact duplicates after normalising the nonce: 6,548 (4.3%). A near-duplicate key (positions and clock
stripped) is an M1 measurement.

**Labels:** good 32,714 (21.6%), neutral 4,146 (2.7%), bad 114,689 (75.7%).

**Actions** (model decisions):

| skill | share | skill | share |
|---|---|---|---|
| gather | 29.2% | explore | 28.3% |
| goto | 21.1% | deposit | 8.7% |
| mine | 8.2% | craft | 2.2% |
| surface | 0.8% | other | 1.5% |

**Refusals** (70,518):

| reason | count | reason | count |
|---|---|---|---|
| repeat_loop | 32,987 | learned_avoid | 8,920 |
| cooldown | 8,604 | deposit_nothing_to_bank | 8,386 |
| unreachable_elevation | 5,671 | bad_args | 2,745 |
| deposit_not_worth_it | 2,439 | sentinel mismatch | 82 |

**Admitted outcomes** (81,031):

| status | count | status | count |
|---|---|---|---|
| success | 35,353 | failed | 34,755 |
| aborted | 6,152 | unknown | 3,247 |
| no_effect | 1,524 | | |

**Per day across the retained window** (rotated files; a `-YYYYMMDD` generation holds the day before):
- model decisions 146,809-156,476 per day on 10-08..10-20 (13 full days, ~1.96 M);
- 10-07 is partial (102,555; the logs start that day).
- **Retention on 10.0.0.31 is 14 generations**, so anything not archived is lost after two weeks.

**Pilot pool:** 111,425 hard decisions on 10-20 (complete prompt, refused or failed/aborted).

### 1.5 Dedupe, splits, retention

- **Dedupe:** exact key = sha1(system_hash + normalised prompt), keeping the earliest. Near-duplicates are capped at k = 3 per
  (bot, near-key, action) so loops do not dominate. Strata are capped per (skill, milestone family).
- **Held-out by pool AND by date.** Bots in a world share a board and town, so a bot is not an independent unit; the world is.
  - Draw 3 of the 16 worlds once per dataset version (`secrets.choice`, recorded): one board/hive, one placebo, one isolated.
  - Hold out the newest 2 days for every world.
  - Train only on (non-held-out worlds) x (older days).
  - Report offline metrics on three cells: held-out worlds x old days (pool leakage), training worlds x new days (date drift), and
    held-out worlds x new days (the headline).
  - A teacher-labeled example inherits its source decision's split.
- **Retention and archiving.**
  - A nightly job on 10.0.0.31 (after rotation, `nice`/`ionice`) extracts the previous day's triples and copies the rotated llm +
    skill gz to the NAS.
  - Sizes: ~32 MB/day of triples (gz) plus ~90 MB/day of raw logs, so ~45 GB/year.
  - Dataset versions are immutable: manifest + sha256, the split seed, the label rule version, and the code versions included.
  - The NAS share is an owner decision (a `mcai-learn` share, or space on the `es-backup` share being created).

---

## 2. Labeling strategies

### 2.1 Stage 1: filtered behaviour cloning (no teacher)

Train on the fleet's own **good** decisions.
- **Sizing:** 32,714/day. After dedupe and capping, the expectation is 15-25k/day; this is measured at M1.
- **Mix:** the dataset is a stratified sample, sized to the round's compute budget (s.3.3). Skill and milestone strata are balanced
  against the natural mix, so rare productive actions are not drowned (craft, smelt, the right `mine` depth).
- **Prior art:** this is %BC (Decision Transformer's percentile BC), and it is what MineCollab did: Llama-3-8B trained on about 16k
  successful transitions of a 70B model.
- **Weakness:** filtered BC from the 7B's own data can only re-weight choices the 7B already makes.

### 2.2 Stage 2: teacher relabeling of failures

On bad decisions, ask a stronger model for the action it would take, then filter that answer.

**Filters applied to every teacher label:**
- the fleet's grammar (schema-valid);
- `bench/models/score.py`'s hard check (no infeasible or bad args);
- **never the action that was just refused or failed** (the replay's "repeats the failed action");
- never a vetoed action after a veto. brain-01's sandbox found gemma4 re-proposes the identical vetoed action 76-85% of the time.

**Teachers, in order:**
- **gemma4:26b on the Studio first** (local, free, Apache-2.0 per the Gemma 4 licence page). In the 10-12 replay: infeasible
  1.4% vs 11.4%, repeats-the-failed-action 15.9% vs 67.8%. It runs at concurrency 1 and yields to the showcase brain
  (the Studio's GPU_RESERVED and pause handshake).
- **The paid teachers** follow, only after the pilot and the terms decision.

### 2.3 Stage 3: preference pairs (DPO/KTO)

**Where pairs come from:**
- **Natural pairs:** the same bot, near-identical state (near-key), two actions with different outcomes.
- **Constructed pairs:** (teacher action, logged failed action), using the gate and the outcome as the preference.

**Rules:**
- KTO can use unpaired good/bad labels directly.
- This stage runs only after stage 1 or 2 has shown a bench effect: preferences sharpen a policy that already works.
- Unsloth supports DPO/ORPO/KTO; TRL marks ORPO/CPO experimental.

### 2.4 The paid-teacher PILOT (owner-approved in principle; not run)

**Question.** Does a paid frontier teacher label hard decisions better than local gemma4, by enough to be worth the money?

**Sample.**
- 1,000 hard decisions: complete prompt, refused or failed/aborted.
- Stratified by refusal reason / failure class x skill.
- Drawn with a recorded seed from training-split worlds and days.
- 200 of the 1,000 are reserved as the scoring set for any later teacher-trained candidate.

**Arms.** Each arm gets the same input: the rebuilt system prompt, the user prompt, the logged action and its outcome, and
an instruction to choose one action under the fleet's JSON schema with a one-line reason. Thinking is at the minimum each
API allows; Opus 5.5 cannot disable it, so effort is set to `low`.

| arm | where | cost |
|---|---|---|
| A: gemma4:26b | Studio, local | free |
| B: Claude Opus 5.5 | Anthropic Message Batches | billed |
| C: OpenAI gpt-6.1-sol | OpenAI Batch | billed |
| D, E (optional): Sonnet 5.5 and gpt-6-astra | same | only if the owner wants a tier comparison |

**Scoring.** The chosen actions are never executed live, so the scores lean on what the logs prove:

1. **Executable:** schema-valid and passes the hard check, as a share.
2. **Avoids the known failure:** does not re-choose the logged refused or failed action, nor a vetoed one.
3. **Hindsight agreement:** where the same bot reached a success from a near-identical state within 600 s, does the
   teacher's action match that later successful action (skill + key args)? Coverage is measured and reported; it is
   not assumed.
4. **Outcome-predictor score:** P(good | state, action) from the offline predictor (s.4a). This is a screen, never a verdict.
5. **Blind pairwise judging** of 200 items by a human (the owner, optional). There is no LLM judge, because a model would
   judge itself.

**Analysis and decision rule.**
- Per-arm shares with bootstrap 95% intervals, resampled by world-day cluster.
- A paid arm earns a place only if it beats gemma4 on (1) and (2) by at least 5 pp with the interval excluding 0, AND on (3)
  where coverage is at least 100 items.
- Otherwise gemma4 stays the teacher and spend stays at 0.

**Cost.** Assumptions:
- p50 prompt is 2,494 qwen tokens. Allow 1.35x for other tokenizers (Claude's 4.7+ tokenizer is documented at about 30% more tokens per text).
- Plus ~600 instruction/outcome tokens, for **~4.0 M input tokens per 1,000 items**.
- Output is 1,500 tokens per item including thinking, for **1.5 M output tokens**. That is a high allowance; the visible answer is about 80.

| arm | list $/M in / out | per 1,000 items, standard | with Batch (-50%) |
|---|---|---|---|
| Claude Opus 5.5 | $4 / $20 | $46 | **$23** |
| Claude Sonnet 5.5 | $2 / $10 | $23 | $11.5 |
| Claude Haiku 5.5 (<= 100k prompt) | $0.10 / $0.50 | $1.2 | $0.6 |
| OpenAI gpt-6.1-sol | $2 / $10 | $23 | **$11.5** |
| OpenAI gpt-6-astra | $10 / $50 | $115 | $57.5 |
| OpenAI gpt-6-luna | $0.10 / $0.50 | $1.2 | $0.6 |

- **Pilot B + C at Batch: ~$35.** All four paid arms: ~$104.
- Prompt caching of the shared system prompt (~1,500 of ~4,000 input tokens per item) cuts input cost further:
  - Anthropic cache hits are listed at 0.05x for Opus/Sonnet 5.5;
  - OpenAI's cached input is 0.05-0.1x;
  - writes are 1.25x for 5 min / 30 min;
  - the cached SDK table this repo's tooling ships lists Sonnet 5.5 hits at $0.20/M, i.e. 0.1x.
  - The estimate above ignores caching, so it is an upper bound on input.
- **Sources (read 2026-10-20):**
  - https://platform.claude.com/docs/en/about-claude/pricing (Batch: "a 50% discount on both input and output tokens"; caching multipliers stack with Batch);
  - https://developers.openai.com/api/docs/pricing (openai.com/api/pricing returned 403);
  - its Flex/Batch tab is 50% of Standard.

**Monthly cap mechanism** (both layers, owner-placed):
1. **Vendor hard limits.**
   - Anthropic: a dedicated workspace for this project with its own spend limit. "You can't set spend limits on the default
     Workspace", per https://platform.claude.com/docs/en/api/rate-limits.
   - OpenAI: a dedicated project with a monthly hard spend limit (https://developers.openai.com/api/docs/guides/spend-limits).
     Over the limit, requests return 429. Enforcement "is not instantaneous", so the client cap sits below it.
   - Proposed: **$100/month per vendor.**
2. **Client ledger.** The labeler counts tokens before each batch (`count_tokens` / the vendor's estimate), refuses a batch whose
   estimate would cross 50% of the month's cap, and appends actual usage from each response to `~/learnloop/spend.jsonl`.
   A month total over the cap stops the labeler; it never retries into a 429.
   - Keys live where the owner puts them, never on a command line or in a log; the same rule as the ES key.

**Output-use terms.** Quoted, not interpreted; no legal conclusion is drawn here. The owner (or counsel) decides.

- **Anthropic Usage Policy** (https://www.anthropic.com/legal/aup; in force since 15 Sep 2025, with the 12 Nov 2026 version
  already published): it lists using outputs "to train an AI model ... without prior authorization from Anthropic".
- **Anthropic Commercial Terms** §D.4 (https://www.anthropic.com/legal/commercial-terms): no access "to build a competing
  product or service, including to train competing AI models". §B also says the customer "owns its Outputs".
- **OpenAI Services Agreement** §3.3(e). Read via the Wayback copy of https://openai.com/policies/services-agreement/
  dated 2026-10-20, because the live page returned 403. It bars using Output "to develop artificial intelligence models
  that compete with OpenAI". There are named "Permitted Exceptions" (classifiers not distributed; OpenAI's own fine-tuning).

**Consequence for this design.**
- The pilot is **evaluation-only**. Paid-teacher labels go into a quarantined set (`teacher-paid/`, never in a training
  manifest).
- The training pipeline refuses any example whose provenance is a paid vendor, unless a recorded owner decision names that vendor.
- gemma4 (local) carries the teacher role regardless.

---

## 3. Training

### 3.1 Base candidates (HF + Ollama, read 2026-10-20)

| model | params | licence | Ollama | fit on a 24 GB 3090 | role |
|---|---|---|---|---|---|
| **Qwen/Qwen3-8B** | 8.19 B | Apache-2.0 | `qwen3:8b` | QLoRA ~6 GB minimum (Unsloth's table) | **primary arm** |
| Qwen/Qwen2.5-7B-Instruct (the fleet's) | 7.6 B | Apache-2.0 | `qwen2.5:7b-instruct` | QLoRA ~5 GB | offline control arm: training on the same base isolates the training effect |
| Qwen/Qwen3.5-9B | 9.65 B | Apache-2.0 | `qwen3.5:9b` | Unsloth advises AGAINST QLoRA on Qwen3.5; bf16 LoRA 22 GB at seq 2048, and ours needs ~3,072 | later, if a fit test passes |
| google/gemma-4-12B-it / E4B | 12 B / 8 B (4 B effective) | Apache-2.0 | `gemma4:12b` / `gemma4:e4b` | 4-bit listed (12B VRAM unpublished) | alternative |
| mistralai/Ministral-3-8B / 14B | 8.9 / 14 B | Apache-2.0 | `ministral-3:8b` / `:14b` | QLoRA | alternative |
| meta-llama/Llama-3.1-8B-Instruct | 8 B | Llama 3.1 Community (derivatives must start their name with "Llama") | `llama3.1:8b` | QLoRA | not chosen: older, naming clause |
| **Qwen/Qwen3-14B** | 14.8 B | Apache-2.0 | `qwen3:14b` | QLoRA ~8.5 GB minimum | **second arm** |

**Why Qwen3-8B first:**
- it is the same family as the fleet's model (tokenizer lineage and JSON habits);
- it has an Apache-2.0 licence, an Ollama tag, and is supported by Unsloth 4-bit;
- it leaves room in 24 GB for a ~3k-token sequence;
- there is no Qwen at ~14B newer than Qwen3.

**Two caveats for M3:**
- **Thinking.** Qwen3 is a hybrid thinking model, so serve with thinking off, train without think tags, and verify that the
  exported template does not inject them (the replay's `schema_valid` share catches it).
- **Capacity.** The 14B arm runs only if the 8B arm moves the bench, and only after a capacity check:
  - 14B Q4_K_M is ~9 GB on the 16 GB 5080, beside the honeypot's coder:7b (4.6 GB);
  - its prefill rate is roughly half the 8B's, so the 5080 would run at ~60% at the busiest hour.

### 3.2 Framework

| framework | status | 8B / 14B on 24 GB | preference training | export | verdict |
|---|---|---|---|---|---|
| **Unsloth** | active | QLoRA 8B 6 GB / 14B 8.5 GB minimum; max context on 24 GB 78k (8B, its benchmark) | DPO, ORPO, KTO, reward models | `save_pretrained_gguf` / merged 16-bit | **primary** |
| TRL + PEFT | active (v1.16) | yes (Unsloth wraps it) | SFT, DPO, KTO stable; ORPO/CPO experimental | merge, then llama.cpp | fallback |
| Axolotl | active | QLoRA/LoRA, sample packing | DPO/IPO/KTO/ORPO, GRPO | GGUF path | alternative (config-first) |
| torchtune | **README: no longer actively maintained (2025)** | - | - | - | excluded |
| MLX-LM (Studio) | active | LoRA/QLoRA/DoRA on 128 GB unified memory | no DPO documented | `fuse --export-gguf` covers Llama/Mistral-style only; for Qwen, fuse then llama.cpp | fallback only: the Studio is the showcase brain + teacher |

**Throughput: no authoritative 3090 figure exists, so it is measured at M3.**

| estimate | source | tok/s |
|---|---|---|
| Andy-4 lower bound | 1x RTX 3090, ~3 weeks, 425.5 M tokens, 2-2.5 epochs, duty cycle unknown | ~235 |
| arithmetic | ~6N FLOPs/token for LoRA with gradient checkpointing; 3090 bf16 tensor peak ~71 TFLOPS; 30-40% MFU, less for 4-bit dequant | 300-600 |
| **planning figure** | | **400** |

Check grad-norm before trusting any speed figure (a 2026 paper reports a fast run with zero gradients).

**Export to Ollama:**
- Ollama removed `ADAPTER` support in v0.34.1 (2026-09-14; commit 98acec4, release notes: GGUF creation "requires using
  llama.cpp tooling"). The fleet's 3090 runs 0.32.14 and the Studio 0.35.1, so do not depend on `ADAPTER` at all.
- The path:
  1. merge LoRA into the base (16-bit);
  2. `convert_hf_to_gguf.py`;
  3. `llama-quantize Q4_K_M`;
  4. a Modelfile `FROM ./cand.gguf` with the base's TEMPLATE;
  5. `ollama create cand-<ver>`.
- The digest is recorded.

### 3.3 Round time

- **Sequence and batching.** ~2,650 tokens per example (prompt + response). Loss on the response only; this does not
  reduce compute. Packing is off.
- **Bootstrap SFT:** 40k examples x 2,650 tokens = 106 M tokens, ~3 days at 400 tok/s, 1 epoch. For scale, MineCollab
  used about 16k transitions.
- **Incremental round:** 5k new examples (13 M tokens), ~9 h. That fits a night, but see s.5: the bench pauses while the
  3090 trains.
- **Cadence:** **weekly** rounds by default, nightly only if the bench is idle. Training faster than the evaluation
  ladder can read only grows a queue (CLAUDE.md "never closing").

### 3.4 Versioning, and never training only on the model's own outputs

**Versioning.** `cand-<base>-<dataset ver>-<round>`, with a manifest recording:
- base digest, dataset manifest sha, label rule version, split seed;
- hyperparameters (LoRA r/alpha/targets, lr, epochs);
- framework + llama.cpp versions;
- GGUF sha256 and Ollama digest;
- the offline-ladder results.

Every candidate is reproducible from its manifest.

**Data mix rule**, enforced by the dataset builder:
- **no more than 50%** of examples whose action came from the model being trained or its ancestors;
- the rest comes from teacher labels (gemma4; paid vendors only after the terms decision);
- a **frozen anchor set** of >= 10% of every round: dataset v0, drawn from qwen2.5 days before any candidate was live
  (Shumailov et al. 2024: keeping 10% original data each generation gave "only minor degradation");
- optionally deterministic work-order decisions (code, 9,010/day).

Once a fine-tuned model is live on any bots, its rows are tagged by model, and the builder applies the cap per lineage.

---

## 4. Evaluation ladder

Each rung must pass before the next. Each rung has a positive control.

**(a) Offline.**
- **Data:** held-out cells (s.1.5), on the current code version's prompts. The system prompt is rebuilt per hash.
- **Harness:** `bench/models/run_bench.py` + `score.py`, the brain-01 replay harness; on 10-12 it scored 420 of 420 items.
- **Gates:**
  - schema-valid >= the fleet model's, -0.5 pp;
  - hard-infeasible/bad-args <= the fleet's;
  - repeats-the-failed-action <= the fleet's;
  - agreement with held-out good actions reported (top-1 skill; skill + key args).
- **The post-veto sequence test (new).** The prompt is re-issued with `LAST ACTION: rejected: repeat_loop` and the
  vetoed action, and the test measures whether the model repeats it. **The 10-12 replay missed this failure (one decision per
  prompt); the sandbox found it.**
  - Positive control: qwen2.5 must reproduce its sandbox rate (29-59%) before a candidate is scored on it.
- **Outcome predictor.** P(good | state, action), a calibrated small classifier trained on training-split triples. It
  ranks a candidate's actions against the logged ones. It is a screen only: off-policy and confounded.
- **Throughput test:** decisions/s at 16 streams on the serving box, on real ~2.5k-token prompts with varied prefixes. Memory
  `decision-cadence-formula`: identical prompts measure nothing.

**(b) Sandbox closed loop.**
- **Harness:** `bench/models/closedloop/` (C1: `cl_run.py`, `cl_series.py`): 8 bots, 90 min, read at 70 min, paired blocks.
- **Use:** this is a **gross-failure gate, not an effect estimate**. Two qwen-only runs on 10-12 differed by 0.12 in refused share
  and 3x in output.
- **Gates:** 0 invalid / unserved, deaths not above the local arm, stuck minutes not worse in 2 of 3 pairs.
- **Arm check:** the candidate-share floor from `brain01_series.py` applies: a block is invalid if under 90% of its decisions came
  from the candidate.

**(c) MODEL BENCH (new, never part of the canary control).**
- **Shape:** a new pve1 VM with 4 worlds x 5 bots, the same code as the fleet (kept builds only; it follows
  the fleet's sha like the showcase's follower), and its own ES streams.
- **Exclusions:** it is excluded from canary draws, reads and the tripper, as the showcase already is.
- **Serving:** both arms are served by the **3090**, so hardware is identical across arms.
- **Design:** each world is split 3/2 by bot (10 v 10 overall), and the arms swap daily (AB/BA crossover). Each bot is
  then its own control and each world appears in both arms.
- **A/A first:** 72 h with both arms on qwen2.5 measures the bench's own null on fresh worlds. Fresh worlds drift: "fresh worlds buy one week".

*Power*, from `scripts/learnloop/bench_power.py`. Method:
- a placebo split of the real fleet (every bot on the same model, so any difference is noise);
- 7 days, 10-14..10-20: 80 bots, 28 6-h windows, 1,068,460 model decisions, 259 deaths, 13,406 bot-h;
- 1,500 draws of 4 worlds out of 16;
- MDE80 = 2.8 x SD.

MDE80 as a share of the fleet mean, by design and period length:

| metric (fleet mean) | 10v10 within-world parallel DiD, 24 h | same, 72 h | whole-world split (2 v 2), 72 h | **crossover**, 24 h periods | **crossover**, 72 h periods |
|---|---|---|---|---|---|
| items/bot-h (50.3) | 44% | 38% | 64% | 22% | **19%** |
| stagnation/bot-h (3.06) | 44% | 37% | 49% | 22% | **17%** |
| success share (0.237) | 10.1 pp | 10.0 pp | 11.4 pp | 5.1 pp | **4.4 pp** |
| refused share (0.453) | 11.9 pp | 11.7 pp | 15.8 pp | 5.9 pp | **5.4 pp** |

**Reading the power table:**
- 10 v 10 in parallel sees brain-01-sized shifts in decision shares (+16 pp success, -24 pp refused), but it **cannot see a
  production change under ~38%**.
- The crossover at 72 h periods (6 days in all) sees ~19% on items. That is the recommended design.
- Whole-world splits are worst, because 2 worlds per arm is 2 clusters.
- **Interference:** within a world the arms share a town and a board, which biases toward null. Accepted and stated; the
  canary rung uses whole pools.
- **Carryover:** "LESSONS FROM PAST RUNS" are learned under the previous arm. The first 6 h after each swap are excluded and
  reported separately.

*Analysis plan* (registered before the A/A):
- **Primaries:** items/bot-h and stagnation/bot-h.
- **Estimator:** crossover, the mean within-bot difference signed by sequence, with a bootstrap by world. A period
  effect cancels because the 10/10 sequences are balanced.
- **Secondaries:** success, refused share, decisions/bot-h, iron/stone pickaxe crafts.
- **Bench KEEP-to-canary:** items CI lower bound > 0 OR stagnation CI upper bound < 0, with no harm.
- **INCONCLUSIVE** is recorded as such.
- **Death gate:** the fleet's rule, two-death floor and > 1.25x the other arm's rate. At 0.0193 deaths/bot-h, a 10-bot arm expects
  4.6 deaths/day, so the floor is reachable in ~10 h. Rolling 48 h exact conditional (binomial) test; a trip stops the
  candidate arm.
- **Liveness:** >= 95% of candidate-arm decisions served by the candidate, schema-valid share >= the other arm's -1 pp.

**(d) Promotion through the main lane: a model-env canary, brain-01 style.**
- **Registration:** `class: model-env`, tier 3, `draw_k: 2`, `canary_env: OLLAMA_MODEL=cand-…`, and the endpoint is the 3090.
  This is the existing install from 10-19.
- **Reads and gates:** brainread-style gates (liveness, fallback, unserved, schema, decision time, mismatch, config, every bot)
  plus immobiledid. Exposure is >= 200 canary bot-h. The primaries go to the owner.
- **Bench state:** the bench pauses for the canary (one GPU).
- **Promotion:** a KEEP leads to a fleet model change on 10.0.0.72, owner-direct, with qwen2.5:7b-instruct kept pulled for
  rollback.
- **Close:** recorded KEEP/REVERT/INCONCLUSIVE, then memory says SHIPPED.

---

## 5. The 3090 move

### 5.1 Can the 5080 carry 80 bots? (`endpoint_load-20261020.txt`, from rows only)

| 10-20 | 5080 (10.0.0.72) | 3090 (10.0.0.16) |
|---|---|---|
| bots / model decisions | 60 / 110,307 | 20 / 37,733 |
| prompt tokens/day | 274.0 M (avg 3,171 tok/s; busiest hour 3,338) | 92.8 M (1,074; 1,174) |
| latency p50 / p95 | 1,458 / 2,791 ms | 3,054 / 7,252 ms |
| per-request prefill p50 | **14,582 tok/s** | 8,332 tok/s |
| per-stream decode p50 | 50.1 tok/s | 27.3 tok/s |
| mean in flight (Little's law) | 1.97 | 1.53 |

**Replay: all 80 bots on the 5080.**
- **Prefill:** prompt demand averages 4,245 tok/s and peaks at 4,494 tok/s in the busiest hour, which is **29% / 31%** of the
  5080's per-request prefill rate.
- **Decode:** demand is 104 tok/s.
- **Concurrency:** mean in-flight rises to about 2.6-3. Decode per stream falls somewhat under more parallel slots, so expect p50 ~2 s and p95 ~4 s. That
  is under the 5 s tripwire.

**Supporting evidence:**
- The 5080 served all 80 until 09-11, at ~110 decisions/min with p50 1.5 s. Today's rate is 148k model decisions/day, the same
  ~103/min.
- Memory `inference-is-not-the-constraint`: decision rate 91.10 vs 91.85 decisions/bot-h across a 1.9x latency gap.
  Inference is 3-6% of the ~40 s cycle.
- Positive control: every 10-20 model row carries its endpoint and all 148,040 fleet-endpoint rows carry durations. Each
  endpoint served exactly its configured bots: 60 + 20, so **fallbacks used: 0**.

**Caveats:**
- The honeypot's live traffic on the 5080 is inside today's latencies, but it is not measured separately (it is never probed).
- The 5080's `NUM_PARALLEL` is not known from here; its 09-11 configuration served 80 bots.
- Prompts are longer now: 2,494 tokens p50 vs ~2,100 then.

**Verdict:** feasible.

### 5.2 How

- **Env change.** The 20 `*-d` env files change `OLLAMA_BASE_URL(S)` to .72. All 80 lists also carry .16; for the 60 it is the
  fallback. **.16 must leave every list** (or stay only as an explicit last fallback, which is an owner choice, below).
  Otherwise a fleet fallback would land on the bench/training GPU unseen.
- **Owner choice on .16:**
  - **(A, recommended)** remove it everywhere. A .72 outage then pauses fleet inference, as before 09-11.
  - **(B)** keep it last. Any fleet row with endpoint .16 is then a flagged bench contamination.
- **When.** At the **next fleet-wide restart** (a promotion), in a canary gap, so no extra restart is spent: all 80 restart anyway.
  - The next canary's pre-window starts >= 90 min after.
  - If no promotion comes within a week: a standalone restart of the 20 `*-d` bots 12 s apart, in a gap.
- **Read** (owner-direct, tripwire style):
  - **+60:** every bot's model rows on .72 and 0 fleet rows on .16; .72 p95 <= 5 s.
  - **+360:**
    - p50 <= 2.5 s, p95 <= 5 s;
    - decisions/bot-h of the 20 moved bots vs the 60, DiD on 6 h windows excluding the first 30 min, guard -25%;
    - items/bot-h reported, not gated (noise).
- **Rollback.** Restore the 20 env files from `*.bak-3090move-<stamp>` and restart them 12 s apart. Until the +360 read
  passes, .16 keeps qwen2.5 loaded and nothing else runs there.
- **Then.** .16 becomes training plus bench serving. VRAM today is qwen2.5 at 12.18 GB (`/api/ps`, NUM_PARALLEL 16, ctx 8192). The
  bench needs two ~5-6 GB models at a lower NUM_PARALLEL, and QLoRA 8B needs ~10 GB. They do not all fit with a margin,
  so **training and bench serving alternate**:
  - training rounds run while the bench is paused (both arms together, so no arm bias);
  - the bench uses the pause handshake the showcase built.

---

## 6. Risks

- **Decision quality may not be the bottleneck.** brain-01 (+16 pp success, items -4.1/bot-h) and model-tier-01 (items -38%)
  both say that. **Kill criterion:** if the first two bench reads (stage 1, then stage 2) are both INCONCLUSIVE or negative on
  items AND stagnation, the loop stops at the bench. That is recorded as a finding ("the model is not the constraint at
  this fleet state"), and the 3090 goes back to being a spare.
- **Feedback loops.** Filtered BC from a model's own outputs narrows it, for example toward explore, 28% of actions. Mitigations: the
  50% own-lineage cap, the frozen anchor, action-mix and entropy monitored per round, and a round refused if any top-5 skill
  share moves > 10 pp vs the anchor without a bench reason.
- **Distribution shift on every code change.** Prompts change with code: new lines, skills and refusals.
  - Each triple carries its code version and system hash.
  - The offline ladder always scores on the current version's prompts.
  - Examples whose skill or args no longer exist in the current schema are dropped.
  - The grammar still enforces the current schema at serve time.
  - Re-run the replay on the fleet's new tip before any canary.
- **Safety.** No new actions: the gate and reflexes are unchanged. A model can only propose what the schema allows, and the gate
  still refuses. Deaths are a bench gate and a canary gate. No world edits.
- **Evaluation noise.** The 2.36x between-pool band and fresh-world drift: hence the A/A, the crossover, DiD only, and the
  denominators printed. The sandbox is only a gross-failure gate.
- **Cost runaway.** Vendor hard limits plus a client ledger at 50% of the cap, no retries on 429, and gemma4 as the default teacher.
  Compute is local, so its cost is only the 3090's time.
- **Terms.** Paid-teacher outputs are quarantined (s.2.4).
- **Fleet host load.** Extraction runs at `nice 19`/`ionice -c3` after rotation, about 2.3 min/day, peak 0.7 GB RSS, on a 94 GB
  host with 77 GB available.
- **Showcase contention.** The Studio teacher runs at concurrency 1, yields to GPU_RESERVED, and never runs during a brain test.

---

## 7. Schedule, milestones and owner decisions

Durations are working estimates. Each milestone closes with a recorded result.

| # | milestone | needs | done when |
|---|---|---|---|
| M0 | this design, both reviews APPROVE | - | branch pushed |
| M1 | nightly extraction + NAS archive; dataset v0 (7-14 days); splits; near-dup measure; outcome predictor; replay baseline: qwen2.5, qwen3-8b zero-shot, gemma4 (Studio, low concurrency) | NAS share (owner) | v0 manifest + offline table |
| M2 | **3090 move** at the next fleet-wide restart in a gap; +60/+360 read | owner GO; operator executes | KEEP/REVERT recorded |
| M3 | 3090 fit + speed test; first SFT round (Qwen3-8B QLoRA) + qwen2.5-7B SFT control; GGUF export; ladder (a) | M2 | offline gates pass or fail, recorded |
| M4 | teacher pilot: gemma4 at once; paid arms B + C | owner keys + caps + terms decision | pilot table + decision |
| M5 | sandbox ladder (b), 3 pairs | sandbox slot | gross-failure gate recorded |
| M6 | bench VM, A/A 72 h, then crossover 2 x 72 h | owner GO on VM + pve1 RAM/CPU; bench nightly pause | bench verdict recorded |
| M7 | model-env canary in the main lane (queue, tier 3), then the owner's promotion call | owner queue slot | KEEP/REVERT, SHIPPED |

M3 finishes around day 10. A candidate reaches its canary read around day 21-25. After that the cadence is one candidate in the bench at a time, and
the next candidate is read only after the current one is decided (the OpenLoop rule, applied to the bench).

**Owner decisions:**
1. **3090 move:** GO at the next fleet-wide restart, and .16 fallback policy A or B.
2. **Base:** Qwen3-8B as the primary arm; 14B only after a bench effect.
3. **Teacher pilot:** keys, a dedicated workspace/project, **$100/month cap per vendor**, and arms B + C (+ D/E optional).
   **Terms:** paid labels are evaluation-only unless the owner records otherwise.
4. **Bench:** VM on pve1 (resources not checked here); accept the nightly bench pause while the 3090 trains; weekly
   rounds.
5. **NAS share** for training data (~45 GB/year).
6. **Kill criterion** (s.6) accepted as written.
7. Optional follow-up: log `outcome.value` in the llm row (ES mapping first).

---

## 8. Prior art

- **ODYSSEY** (arXiv 2407.15325, https://github.com/zju-vipa/Odyssey). MineMA-8B/70B are LoRA fine-tunes of LLaMA-3 on 390k+
  Minecraft-Wiki instructions, with a 40 + 183 skill library.
  - Lesson: domain knowledge SFT helps a small model plan.
  - Our data is better matched to us: our own state/action/outcome rather than wiki Q&A.
- **MineCollab / "Collaborating Action by Action"** (arXiv 2504.17950, https://mindcraft-minecollab.github.io/).
  Filtered BC trained llama3-8b on about 16k successful transitions of a 70B. It gained over 17% on cooking, matched the 70B on
  construction, and beat gpt-4o on crafting. **This is stage 1 + 2 here.**
- **Andy-4** (https://huggingface.co/Sweaterdog/Andy-4). An 8B Mindcraft model trained on a single RTX 3090 over about 3 weeks:
  62k conversations, 425.5 M tokens, 3 stages, base `unsloth/DeepSeek-R1-Distill-Llama-8B-bnb-4bit`, so likely Unsloth
  QLoRA.
  - The model is under its own "Andy 1.0 License".
  - Andy-3.5 (Apache-2.0, 7B from R1-Distill-Qwen) used about 12k prompts.
  - **This is our hardware's existence proof, and its lower-bound throughput.**
- **Mindcraft** (https://github.com/kolbytn/mindcraft, MIT): mineflayer + LLM agents; the Andy models' home.
- **Voyager** (arXiv 2305.16291): curriculum + skill library + iterative prompting with GPT-4 and no weights trained. 3.3x unique
  items.
- **MindForge** (arXiv 2411.12977): theory of mind + memory + communication. With open-weight LLMs it reports 3x the tech-tree
  milestones of Voyager.
- **Distillation and self-training:**
  - FireAct (arXiv 2310.05915): 500 GPT-4 trajectories, Llama2-7B +77% on HotpotQA.
  - AgentTuning (arXiv 2310.12823): mix agent and general data.
  - Distilling step-by-step (arXiv 2305.02301).
  - ReST (arXiv 2308.08998, grow/improve with reward filtering).
  - STaR (arXiv 2203.14465).
  - DPO (arXiv 2305.18290).
  - %BC in Decision Transformer (arXiv 2106.01345).
  - **Model collapse**, Shumailov et al., Nature 2024 (https://pmc.ncbi.nlm.nih.gov/articles/PMC11269175/). Indiscriminate
    self-generated training data erodes the tails; keeping original data mitigates it. This is the s.3.4 rule.
- **Learning from deployment:**
  - WebRL (arXiv 2411.02337): Llama-3.1-8B 4.8% -> 42.4% on WebArena-Lite, using a self-evolving curriculum and an outcome
    reward model.
  - Agent Q (arXiv 2408.07199): MCTS + off-policy DPO.
  - SWE-Gym (arXiv 2412.21139).
  - Weight-free alternatives worth remembering if the kill criterion fires: Memento (arXiv 2508.16153) and "Learning on the Job"
    (arXiv 2607.22157).

Our design differs from all of these in one way that matters: **the scoreboard is a live, noisy, multi-bot world with a
measured null**, and two earlier "better model" changes did not raise output. The ladder exists to find out cheaply
whether this one does.

## 9. Offline prototype (done)

Scratch on 10.0.0.31: `~/learnloop-scratch-1021/`. The triples are not committed, because they hold full prompts (32 MB gz).

| script | what it did | result |
|---|---|---|
| `extract_triples.py --day 2026-10-20` | read all 80 bots | 80 files, 32 MB gz, in 2 min 15 s, peak RSS 0.7 GB; summary `triples-summary-20261020.json` |
| `label_check.py` | label validation, per-world counts, hard pool | s.1.3-1.4 |
| `endpoint_load.py 2026-10-20` | per-endpoint load from rows; the 80-on-5080 replay | s.5.1 |
| `bench_power.py --days 7` | placebo power for the bench designs | s.4c; cache `cells-7d.json` |

Nothing was trained or served. **10.0.0.61** answers ping, but nothing listens on 11434, 1234, 8000 or 8080. Memory
`inference-vram-measured` says it is the owner's MacBook, not infrastructure. **So no 96 GB analysis endpoint is available
today.**
