# Learning loop for the bot brain: continuous fine-tuning (design, 2026-10-21, round 3)

**Status:** DESIGN + offline prototype only. Nothing was trained or served. No fleet, queue, scheduler, manifest, env file
or endpoint was changed. 10.0.0.72 was never contacted: every 5080 number below comes from the bots' own decision rows.
No paid API was called.

**Approval:** the owner approved the direction on 2026-10-21 ~03:30Z, including a small paid-teacher pilot.

**Where things are:**
- Branch: `learning-loop-1021`.
- Evidence: `docs/reports/learning-loop-1021/`.
- Scripts: `scripts/learnloop/`. They are read-only and ran on 10.0.0.31 under `nice -n 19 ionice -c3`; the largest peaked at
  0.84 GB RSS.

**Reviews so far:**

| round | Codex | Claude |
|---|---|---|
| 1 | CHANGE (12 P1) | CHANGE (3 P1) |
| 2 | CHANGE (3 P1, all in the bench statistics) | APPROVE (3 P2) |

Every point from both rounds is taken; s.10 maps each finding to the section that answers it.

## 0. The answer in brief

**Data.** The decision data is complete enough to train on.
- On 10-20 the fleet logged 160,559 decision rows on 80 of 80 bots. 151,549 were model decisions.
- Each of those carries:
  - the full user prompt;
  - the raw model response;
  - a response nonce that matches the prompt (151,467; the other 82 are the gate's sentinel refusals).
- Files and Elasticsearch agree on decisions, deaths, stagnation and milestones. Skill rows differ by 5 rows, the known
  rotation race.
- Every system-prompt hash of the day rebuilds from code: 3 of 3 hashes, from both live versions.

**Labels.** "Good decision" is a training signal; it is not a scoreboard.
- Per decision, good decisions are followed by more output. Counting only rows other than the decision's own, they gather
  1.8x the items of bad ones in 120 s and 1.7x in 600 s.
- Per bot, the link to output is **not established**: good share vs items/bot-h gives rho +0.24, world-cluster 95% CI
  [-0.06, +0.50].
- brain-01 shows why this matters. It moved decision shares far outside noise: success +0.161 and refused -0.241, against
  null SDs of 0.067 and 0.088. Its items (-4.1/bot-h) and stagnation (-0.79/bot-h) stayed inside noise. It closed
  INCONCLUSIVE below exposure.
- **So promotion is judged on output, never on decision shares.**

**Base and framework.**
- Primary arm: Qwen3-8B (Apache-2.0) with QLoRA in Unsloth on the 3090.
- Offline control arm: qwen2.5-7B trained the same way.
- Second arm: Qwen3-14B, only after the 8B arm moves the bench.
- Export: Ollama removed LoRA `ADAPTER` in v0.34.1, so the path is merge → llama.cpp convert → Q4_K_M → `FROM model.gguf`.

**Teacher pilot.** The pilot is a **screen**. It checks validity, cost and terms, and gives a blind-judged quality signal.
- Data: 1,000 hard decisions.
- Teachers: Claude Opus 5.5 and OpenAI gpt-6.1-sol (via Batch), plus local gemma4:26b.
- Cost: **~$35** at batch list prices. Cap: **$100/month per vendor**, enforced by the vendor and by a client ledger.
- Use: evaluation only until the owner settles the vendors' output-use terms (s.2.4).
- Limits: it cannot say a teacher is better at producing *outcomes*. Only a closed-loop test of a teacher-trained model can.

**Model bench.** 4 worlds × 5 bots, each world split 3/2.
- Schedule: one AB/BA crossover with 72 h periods and a 6 h washout.
- Primary: **gross gathered items/bot-h** (no transfers, no conversions). It is tested by a stratified re-randomization
  test, and that test was simulated end to end on 13 days of the fleet's own null.
- Under the null it rejects 3.5% of the time (nominal 5%).
- Minimum detectable effect at 80% power: **20% of the mean**.
- Comparison, as a planning approximation: a 10 v 10 parallel split needs ~40%; a whole-world crossover is close to the
  within-world one (19% vs 18%), and within-world is kept for coverage.

**The 3090 move.** This is a **conditional hypothesis**, not a verdict.
- The evidence is favourable:
  - with 80 bots, prompt demand would be 29-33% of the 5080's per-request prefill rate, as measured under today's load;
  - decode, the larger share of GPU time, would average ~2.2 requests at once (today 1.97);
  - the 5080 carried all 80 bots until 09-11, alongside the same honeypot.
- `NUM_PARALLEL` and free VRAM on the 5080 are unknown here. **The operator reads them; no agent touches .72.**
- Method: one 80-bot env transaction (.16 removed everywhere), under the installer protocol (flock +
  `canary-sched.py install-hold`), with absolute fleet-wide latency gates and a full rollback.

**Kill rule.** If two candidates in a row show no benefit on the pre-registered primary, the loop stops. That records
"these candidates did not show the benefit", not "the model is not the constraint".

**Calendar.** Training throughput is measured at M3, so the schedule is dependency-based (s.7). The first candidate
reaches a fleet canary read about 4 weeks after the 3090 move.

---

## 1. Data pipeline

### 1.1 What a decision row holds (verified on the rows, 10-20)

`/var/log/mcai/<bot>/llm-<bot>.jsonl` holds one row per decision. It is written by `bots/src/logger.mjs:logLlm` and
stamped at the decision start, before inference. Each row carries:
- `prompt.text`: the user prompt, capped at 6000 chars.
- `prompt.system_hash`: a hash of the system prompt.
- `response.text`: the raw output, capped at 4000 chars.
- `tool_calls[0]`: `{skill, args, reason}`.
- `llm.*`: model, endpoint, tokens, latency, durations, `schema_valid`, `error` (the gate's refusal), `admission`,
  `retry_count`.
- `outcome.status` / `detail`: the detail is capped at 400 chars.
- `bot.*`, `perception`, `code.version`, `exp.pool`.

| needed | where | coverage on 10-20 (denominator) |
|---|---|---|
| complete prompt | `saw_end:` in the last 40 chars and under the cap | 151,549 of 151,549 model rows |
| response matches the prompt | the response's `saw_end` equals the prompt's nonce | 151,467 of 151,549; the other 82 are the gate's `truncation sentinel mismatch` refusals |
| system prompt text | rebuilt from `src/prompt.mjs` at the row's code version, matched by hash (`/tmp/brain01-sysprompt.mjs`) | **3 of 3 hashes of the day rebuilt from BOTH 9e7d9980 and adbec4f4**; board a953f82c, shared/isolated bcc44f92, checkpoint 695b8935; 4.2-4.3k chars, 15-16 skills |
| the executed skill row | `skill-<bot>.jsonl`; the runner stamps its row at execution start, AFTER inference. Join rule: same name; trigger `llm:*`/`interrupt:*`; start in [t − 1 s, t + latency + 30 s] (the −1 s absorbs millisecond stamp skew); each row used once; status equal; first 120 detail chars equal (both come from one result object) | **70,581 of 81,031 admitted decisions joined uniquely on status + detail; only these count as joined.** 10 were ambiguous (flagged, not counted). 5 matched on status alone; their decisions say "paused", so they are false joins and are labelled `void`, which shows status-only matching is not trustworthy. **All 10,435 misses are `failed`:** 10,127 say "paused after repeated failures" and 303 say "busy with X". In both cases the runner returns before `logSkill` (runner.mjs 169-185), so no row can exist. The other 5 are real misses (2 unreachable gathers, 3 explores) and are reported. |
| the bot's evidence value | computed in `cognitive.mjs` but dropped by the logger's allowlist. Recovered from the next decision row's `RECENT EVENTS` line (`<skill> -> <status> (<value>)`), reading past midnight | line found for 80,658 of 81,031; values: valuable 31,716, neutral 3,457, costly 63, line-without-value (failures) 45,422; 373 not found |
| outcome windows | skill rows. Items are counted when a skill ENDS in the window: an end-time index (bisect), so a skill that started long before the window still counts. Deaths, stagnation and milestones are counted by their own stamp. A window is `observed` only if the bot has rows at or after its end | 0 censored on 10-20; lookahead runs 1 h past midnight, the back-read 2 h before; the longest skill that day ran 211 s, well inside both |

**Reader.** `lib/telemetry.Events.load()` cannot read the decision stream: it drops rows without `skill.name` (memory
`the-decision-stream-is-a-separate-file`).
- The extractor therefore uses brainread's rotation rule (`files_for`) and counts unreadable files and unparseable
  lines; both were 0.
- `endpoint_load.py` imports the same reader. Its counts now equal the extractor's (151,549 model rows).

**Follow-up** (bot code, not built here): log `outcome.value` and `because` in the llm row, and a decision id on the
executed skill row.
- The ES template is `dynamic: strict`, so the mapping goes first.
- It ships as its own tier-1/2 change.

### 1.2 The triple

`scripts/learnloop/extract_triples.py` writes one JSON line per model decision. The fields are:
- **Identity:** `id`, `ts`, `bot`, `world`, `pool`, `code_version`, `model`, `endpoint`, `system_hash`, `trigger`,
  `milestone`.
- **State:** `prompt`, `prompt_complete`.
- **Action:** `response`, `nonce_ok`, `action{skill, args, reason}`.
- **Gate:** `gate{refused, reason, admission}`.
- **Outcome:** `outcome{status, detail, value, join, duration_ms, inventory_delta, distance_moved, next_decision_s}`.
- **Windows:** `window{120, 600}{items, items_other, deaths, stagnation, milestones, observed}`.
- **Bookkeeping:** `label`, plus `dedupe{prompt, prompt_action}` keys.

Deterministic decisions are counted but not emitted. These are rows with `latency_ms` 0: work orders and town jobs, which
are code, not model output. There were 9,010 on 10-20.

### 1.3 Outcome labels, and what they are worth

The definitions are brainread's:
- **model decision:** `latency_ms > 0`;
- **refused:** outcome `aborted` with admission null;
- **success:** outcome `success`.

| label | rule |
|---|---|
| **void** | admitted, but the runner refused to start ("paused after repeated failures" / "busy with X"). The action never ran, so this is no evidence about it (cognitive.mjs treats it the same way). **Never a negative example** and never in the pilot's failure strata; for teacher filtering it counts as a transient failure |
| **bad** | refused; OR executed `failed` / `aborted`; OR a death or stagnation event within 120 s |
| **good** | executed `success` AND (own value `valuable` OR own skill gained items OR a milestone within 120 s) AND no death within 600 s AND the 600 s window observed |
| neutral | everything else: success with no durable evidence, `unknown`, `no_effect`, censored |

**Positive controls.**
- **Shares.** On 10-20, 46.5% of model decisions were refused (70,518 / 151,549) and 23.3% succeeded (35,353 / 151,549).
  brain-01's control arm over 10-19/20 showed 47.6% and 22.4%, using the same definitions on a neighbouring window.
- **Elasticsearch, 10-20.**

  Committed as `es_crosscheck-20261020.txt`. ES and the files use the same predicates, exact kind names.

  | stream | Elasticsearch | files |
  |---|---|---|
  | llm | 160,559 | 160,559 |
  | `_death` | 36 | 36 |
  | `_stagnation`, exact kind | 5,070 | 5,070 |
  | `_milestone_complete` | 9,769 | 9,769 |
  | skill rows | 1,491,973 | 1,491,978 (5 lost to the rotation race) |

  The extractor's label rule uses a **broader** stagnation predicate: any `_stagnation*` kind, or STAGNANT in a
  detail. That gives 5,262 = 5,070 `_stagnation` + 192 `_stagnation_reconnect`. Both counts are in the summary.

**Per decision.** From `label_check-20261020.txt`. The denominator is model decisions with that label, all windows observed.
Windows overlap, so each "per 1k" figure counts decisions *followed by* the event, not the events themselves. For
example, 36 deaths sit inside the 600 s windows of many decisions.

| label | n | items, 120 s (other rows only) | items, 600 s (other rows only) | per 1k: death within 600 s | per 1k: stagnation within 120 s | per 1k: milestone within 120 s |
|---|---|---|---|---|---|---|
| good | 32,726 | 3.16 (1.30) | 11.86 (9.79) | 0 (by rule) | 0 | 295 |
| neutral | 4,134 | 1.65 (1.53) | 10.68 (10.56) | 25.2 (by rule: success, then a death 120-600 s later) | 0 | 85 |
| bad | 104,254 | 0.87 (0.74) | 5.93 (5.80) | 2.6 | 100 | 71 |
| void | 10,435 | 0.72 (0.72) | 6.11 (6.11) | 2.4 | 53 | 44 |

- The non-circular columns ("other rows only") exclude the decision's own skill row.
- On those columns, good vs bad is **1.8x at 120 s and 1.7x at 600 s**.

**Per bot.** Production here is independent of the joins: brainread's items over every skill row per decision-hour, and
"gathered" without the transfer skills.

| share | vs items_all/bot-h | vs gross gathered/bot-h (no transfers, no conversions) |
|---|---|---|
| good | rho +0.24 [-0.06, +0.50] | +0.24 [-0.06, +0.50] |
| success | +0.26 [-0.02, +0.50] | +0.26 [-0.04, +0.51] |
| refused | -0.27 [-0.51, +0.01] | -0.27 [-0.53, +0.05] |
| bad | -0.29 [-0.54, -0.01] | -0.28 [-0.55, -0.00] |

- n = 80 bots in 16 worlds. Intervals are a world-cluster bootstrap with 1,000 resamples.
- **The good-share interval touches 0.** One day cannot establish that a bot's label shares track its output.
- Bad share is the only one whose interval just clears 0.

**What this means.** The labels are a training signal. The scoreboard is output, measured by DiD.
- brain-01 is the reference case (`brain-01-brainread-{360,720}.json`, committed):
  - at +720 on 119.9 canary bot-h, success DiD was +0.161 and refused -0.241; the 10-12 null SDs for 6 h reads were 0.067
    and 0.088;
  - stagnation DiD was -0.79/bot-h (null SD 0.95) and items -4.1/bot-h (null SD 18.2);
  - at +360, items were -0.11 and stagnation -0.69;
  - so decision shares moved well outside noise, and output did not move distinguishably. It closed INCONCLUSIVE below
    its 200 bot-h exposure.
- model-tier-01 (qwen2.5:72b, 09-13) gives no evidence either way. It ran 5 bots for 6 h, items -38%, bootstrap
  [-70%, +69%], and the placebo screen failed.
- **Neither result shows a better brain cannot raise output. Neither shows it can.** The bench (s.4c) is sized to see 20%.
- Training labels are re-weighted toward durable progress (gathered items in 600 s, milestones).
- They are stratified by skill, because good shares differ widely:

  | skill | good share |
  |---|---|
  | mine | 44% |
  | explore | 26% |
  | gather | 22% |
  | goto | 18% |
  | craft | 5.6% |
  | deposit | 1.0% |

### 1.4 What one day supports (10-20; `triples-summary-20261020.json`)

**Rows.** 160,559 decision rows: 151,549 model decisions (94.4%) and 9,010 deterministic, from 80 of 80 roster bots.
The 16 worlds each produced 8,312-10,956 model decisions.

**Endpoints.**

| endpoint | decisions |
|---|---|
| .72 | 110,325 |
| .16 | 37,741 |
| Studio tunnel (gemma4, brain-01, until 04:51Z) | 3,483 |

**Code versions (5).** Each triple is tagged.

| version | decisions |
|---|---|
| adbec4f4 | 59,267 |
| 9e7d9980 | 76,558 |
| 78fa19d9 | 3,487 |
| a52d075e | 7,011 |
| 31416ee5 | 5,226 |

**Tokens.** Prompt p50 2,494 and p95 2,739 (376 M/day). Completion p50 57 and p95 88.

**Clean outcomes.**
- All 70,518 refusals carry a gate reason.
- Of the admitted decisions:
  - 70,581 have a unique exact join (s.1.1);
  - 10,430 are void (the runner never started), plus 5 status-only joins that are also void;
  - 5 are real misses;
  - 10 are ambiguous.
- Lower bound for a clean outcome (exact join and value line found): 70,581 + 80,658 − 81,031 = 70,208. Adding the
  refusals gives **140,726 of 151,549, i.e. 92.9%**.

**Duplicates.**
- Same prompt (nonce normalised): 6,548 (4.3%).
- Same prompt AND same action: 5,560 (3.7%).

**Labels.** good 32,726 (21.6%), neutral 4,134 (2.7%), bad 104,254 (68.8%), void 10,435 (6.9%).

**Actions.**

| action | share |
|---|---|
| gather | 29.2% |
| explore | 28.3% |
| goto | 21.1% |
| deposit | 8.7% |
| mine | 8.2% |
| craft | 2.2% |
| surface | 0.8% |
| other | 1.5% |

**Refusals.** All 70,518:

| reason | count |
|---|---|
| repeat_loop | 32,987 |
| learned_avoid | 8,920 |
| cooldown | 8,604 |
| deposit_nothing_to_bank | 8,386 |
| unreachable_elevation | 5,671 |
| bad_args | 2,745 |
| deposit_not_worth_it | 2,439 |
| deposit_item_missing | 350 |
| redundant_craft | 332 |
| truncation sentinel mismatch | 82 |
| bucket (2 reasons) | 2 |

**Admitted.** All 81,031: success 35,353, failed 34,755, aborted 6,152, unknown 3,247, no_effect 1,524.

**Retention.** Model decisions ran 146,809-156,476 per day on 10-08..10-20 (13 full days, ~1.96 M). Two warnings:
- 10-07 is partial.
- **Retention on 10.0.0.31 is 14 generations**, so anything not archived is gone after two weeks.

**Pilot pool.** 100,990 hard decisions: complete prompt, refused or failed/aborted, void excluded.

### 1.5 Dedupe, splits, retention

**Dedupe.** Mine preference pairs (s.2.3) **before** deduping.
- Then dedupe on prompt + action, keeping the earliest copy.
- Cap near-duplicates at k = 3 per (bot, near-key, action), where the near-key strips positions and clock; that rate is
  measured at M1.
- Cap strata per (skill, milestone family).

**Held-out sets by pool AND by date.** The unit is the world: its bots share a board and a town, so they are not
independent.
- Draw 3 of the 16 worlds once per dataset version (`secrets.choice`, recorded): one board/hive, one placebo, one
  isolated.
- Hold out the newest 2 days for every world.
- Train on (other worlds) × (older days).
- Report three cells: held-out worlds × old days; training worlds × new days; held-out × new (the headline).
- Teacher labels inherit their source decision's split.

**Retention.**
- A nightly job on 10.0.0.31 runs after rotation (`nice`/`ionice`, ~3 min). It extracts the previous day and copies the
  rotated llm and skill gz to the NAS.
- Volume: ~32 MB/day of triples plus ~90 MB/day of raw logs, about 45 GB a year.
- Dataset versions are immutable. Each records:
  - a manifest with sha256;
  - the split seed;
  - the label rule version;
  - the code versions it contains.

---

## 2. Labeling strategies

### 2.1 Stage 1: filtered behaviour cloning

Train on the fleet's own good decisions.
- **Volume:** 32,726 per day. After dedupe and caps, 15-25k a day is expected; M1 measures it.
- **Mix:** skill and milestone strata are balanced against the natural mix, so rare productive actions (craft, smelt, the
  right `mine` depth) are not drowned out.
- **Prior art:** this is %BC (Decision Transformer). It is also MineCollab's recipe: Llama-3-8B on about 16k successful
  transitions of a 70B model.
- **Limit:** stage 1 can only re-weight choices the 7B already makes.

### 2.2 Stage 2: teacher relabeling of failures

A stronger model proposes the action for a bad decision. Its answer is kept only if all of these hold:
- it passes the fleet's grammar;
- it passes `bench/models/score.py`'s hard check;
- it is not the action that was just refused or failed. The exception is a failure class marked transient (void, i.e.
  `busy` / `paused`, or `timeout`), where a retry can be correct;
- it does not repeat a vetoed action after a veto. brain-01's sandbox saw gemma4 do that 76-85% of the time.

The teacher is **gemma4:26b on the Studio**, which is local and free.
- Licence: Apache-2.0 per the Gemma 4 licence page.
- Replay (10-12): infeasible 1.4% vs 11.4%; repeats-the-failed-action 15.9% vs 67.8%.
- It runs at concurrency 1, yields to GPU_RESERVED, and never runs during a showcase brain test.

### 2.3 Stage 3: preference pairs (DPO/KTO)

Pairs come from three places:
- **Natural pairs:** the same bot, a near-identical state, two actions, different outcomes.
- **Constructed pairs:** a filtered teacher action vs the logged failed action.
- **KTO:** uses unpaired good/bad labels directly.

Stage 3 runs only after stage 1 or 2 has shown a bench effect. Unsloth supports DPO/ORPO/KTO; TRL marks ORPO/CPO as
experimental.

### 2.4 The paid-teacher PILOT: a screen (owner-approved in principle; not run)

**Questions.**
- (Q1) Are the paid answers valid under our grammar and gate?
- (Q2) What do they cost in practice?
- (Q3) Do blind human judgments prefer them over gemma4's?

It **does not** answer whether paid labels make a better trained model. That needs a closed-loop test: two candidates
trained on gemma4 labels vs paid labels, compared in the bench. That test is gated on the terms decision below.

**Sample.**
- 1,000 hard decisions, stratified by refusal reason / failure class × skill.
- A recorded seed, drawn from training-split worlds and days.

**Two prompt conditions per arm.**
- **Blind** (scored): the rebuilt system prompt plus the user prompt, exactly what the fleet model saw. The arm is not
  shown the logged action or its outcome, so the gate check is a real test, not instruction-following.
- **Informed** (label generation only): the same, plus the logged action, its outcome and a teacher instruction. This is
  what a stage-2 label would use. It is not scored.

**Arms.** The JSON schema is the fleet's. Thinking is at each API's minimum (Opus 5.5 cannot disable it, so effort is
`low`).

| arm | model | route |
|---|---|---|
| A | gemma4:26b | Studio |
| B | Claude Opus 5.5 | Anthropic Message Batches |
| C | OpenAI gpt-6.1-sol | OpenAI Batch |
| D, E (optional) | Sonnet 5.5, gpt-6-astra | Batch |

**Scores.** Blind condition, paired by item, with uncertainty by world-day cluster.

1. **Grammar and hard check.** Pass share, judged **non-inferior** to gemma4: the paired 95% lower bound of
   (arm − gemma4) must be above −2 pp. Gemma4 already passes 98.6% of items, so superiority is not a sensible test here.
2. **Known-failure avoidance.**
   - For non-transient refusals and failures, measure the share that re-chooses the logged action or a vetoed one.
   - It is judged **non-inferior** to gemma4 when the paired 95% upper bound of (arm − gemma4) is below +2 pp, with
     McNemar for the paired difference.
   - Transient classes, void included, are reported only.
3. **Blind pairwise judging (mandatory).**
   - The owner, or a person the owner names, judges 200 items: the paid arm against gemma4, in random order, with model
     names hidden.
   - **Pre-registered rule:** at least 100 non-tie pairs, AND a one-sided exact binomial test of the arm's win share
     against 50% with p < 0.05.
   - With 200 informative pairs, the threshold is a win share of about 56%, and power at a true 60% is about 87%.
   - **Fewer than 100 non-ties means no advancement.**
   - **There is no LLM judge**: a model would be grading its own family.
4. **Reported only, never a decision:**
   - hindsight agreement with a later success from a near-identical state, with coverage reported;
   - the outcome predictor's score (s.4a). It is off-policy, and teacher actions may lie outside its support.

**Decision.** A paid arm goes forward to the closed-loop test only if all three hold: (1) is non-inferior, (2) is not
worse, and (3) prefers it. Otherwise gemma4 stays the teacher and paid spend stays 0.

**Cost.** Assumptions:
- p50 prompt is 2,494 qwen tokens. Allow 1.35x for other tokenizers (Claude's 4.7+ tokenizer is documented at about 30%
  more tokens per text).
- Add ~600 instruction tokens, for **~4.0 M input per 1,000 items per condition**.
- Allow 1,500 output tokens per item including thinking (generous; the visible answer is about 80), for **1.5 M output**.
- The blind and informed conditions together double the figures. The informed condition can be cut to the 200 judged
  items: +20%.

| arm | list $/M (in / out) | per 1,000 items: standard | per 1,000 items: Batch -50% |
|---|---|---|---|
| Claude Opus 5.5 | $4 / $20 | $46 | **$23** |
| Claude Sonnet 5.5 | $2 / $10 | $23 | $11.5 |
| OpenAI gpt-6.1-sol | $2 / $10 | $23 | **$11.5** |
| OpenAI gpt-6-astra | $10 / $50 | $115 | $57.5 |
| Claude Haiku 5.5 / OpenAI gpt-6-luna | $0.10 / $0.50 | $1.2 | $0.6 |

- **B + C, blind condition, at Batch: ~$35. With the informed condition on 200 items: ~$42.** All four paid arms: ~$125.
- **Caching.** The shared system prompt is about 1,500 of the ~4,000 input tokens. The estimate ignores caching, so it is
  an upper bound.
  - Anthropic lists cache hits at 0.05x for Opus/Sonnet 5.5 on the pricing page. The cached reference bundled with this
    repo's tooling says 0.1x for Sonnet 5.5.
  - OpenAI lists 0.05-0.1x.
  - Cache writes cost 1.25x.
- Haiku 5.5's price is from the pricing page; it is not in the bundled reference.
- Sources, read 2026-10-20:
  - https://platform.claude.com/docs/en/about-claude/pricing (Batch is "a 50% discount on both input and output tokens");
  - https://developers.openai.com/api/docs/pricing (the Flex/Batch tab is 50% of Standard; openai.com/api/pricing
    returned 403).

**Monthly cap.** Two layers, both placed by the owner.
1. **Vendor hard limits.**
   - Anthropic: a dedicated workspace with its own spend limit. The docs say "You can't set spend limits on the default
     Workspace" (https://platform.claude.com/docs/en/api/rate-limits).
   - OpenAI: a dedicated project with a monthly hard limit; over the limit it returns 429
     (https://developers.openai.com/api/docs/guides/spend-limits). The docs say enforcement "is not instantaneous".
   - Proposed: **$100/month per vendor.**
2. **Client ledger** (`~/learnloop/spend.jsonl`).
   - Before each batch, estimate its cost by counting tokens.
   - **Refuse the batch if month-to-date plus the estimate exceeds 80% of the vendor cap**, which leaves room for the
     vendor's enforcement lag.
   - Record actual usage from every response.
   - Never retry into a 429.
   - Large arms are split into batches of ≤ $10, so arm E ($57.5) can run inside a $100 cap.
   - **The two paid arms, B + C (~$42 with the informed condition), fit in one month under both caps.**
   - The all-four-arms option does not: OpenAI C + E with the informed condition is ~$83, over the 80% ledger line. It
     would run E in the following month, or the owner raises the cap.
   - Keys stay wherever the owner puts them. They never go on a command line or into a log, the same rule as the ES key.

**Output-use terms.** These are quoted, not interpreted. No legal conclusion is drawn; **the owner (or counsel) decides.**

- **Anthropic Usage Policy** (https://www.anthropic.com/legal/aup; in force since 15 Sep 2025; the 12 Nov 2026 version is
  already published): it lists using outputs "to train an AI model ... without prior authorization from Anthropic".
- **Anthropic Commercial Terms** §D.4 (https://www.anthropic.com/legal/commercial-terms): no access "to build a competing
  product or service, including to train competing AI models". §B also says the customer "owns its Outputs".
- **OpenAI Services Agreement** §3.3(e), read via the Wayback copy of https://openai.com/policies/services-agreement/
  dated 2026-10-20 (the live page returned 403): no using Output "to develop artificial intelligence models that compete
  with OpenAI". It lists "Permitted Exceptions": classifiers that are not distributed, and OpenAI's own fine-tuning.

**Questions for the owner and counsel.** These are not settled here, and "evaluation only" is not offered as a safe
harbour:
- (i) Is using paid outputs to *score or select* teachers allowed?
- (ii) Is using them to *train* the bot model allowed? For Anthropic this may need prior authorization.
- (iii) What about using held-back paid labels to evaluate a later candidate?

**Until those are answered:**
- Paid labels sit in a quarantined `teacher-paid/` set.
- The dataset builder refuses any example whose provenance is a paid vendor unless a recorded owner decision names that
  vendor and use.
- gemma4 carries the teacher role regardless.

---

## 3. Training

### 3.1 Base candidates (HF + Ollama, read 2026-10-20)

| model | params | licence | Ollama | 24 GB 3090 | role |
|---|---|---|---|---|---|
| **Qwen/Qwen3-8B** | 8.19 B | Apache-2.0 | `qwen3:8b` | QLoRA, ~6 GB minimum (Unsloth) | **primary** |
| Qwen/Qwen2.5-7B-Instruct (the fleet's) | 7.6 B | Apache-2.0 | `qwen2.5:7b-instruct` | QLoRA, ~5 GB | offline control: the same base, trained |
| Qwen/Qwen3.5-9B | 9.65 B | Apache-2.0 | `qwen3.5:9b` | Unsloth advises AGAINST QLoRA on Qwen3.5; bf16 LoRA is 22 GB at seq 2048, and ours needs ~3,072 | later, only if a fit test passes |
| google/gemma-4-12B-it / E4B | 12 B / 8 B (4 B effective) | Apache-2.0 | `gemma4:12b` / `:e4b` | 4-bit listed | alternative |
| mistralai/Ministral-3-8B / 14B | 8.9 / 14 B | Apache-2.0 | `ministral-3:8b` / `:14b` | QLoRA | alternative |
| meta-llama/Llama-3.1-8B-Instruct | 8 B | Llama 3.1 Community (derivative names must start with "Llama") | `llama3.1:8b` | QLoRA | not chosen |
| **Qwen/Qwen3-14B** | 14.8 B | Apache-2.0 | `qwen3:14b` | QLoRA, ~8.5 GB minimum | **second arm** |

**Why Qwen3-8B.**
- Same family as the fleet model.
- Apache-2.0.
- Has an Ollama tag.
- Unsloth supports it in 4-bit.
- There is no newer Qwen at ~14B than Qwen3.

**Qwen3 has a thinking mode.**
- Serve it with thinking off and train without think tags.
- Before scoring at M3, check that the exported template injects none. The replay's `schema_valid` share catches it if
  it does.

**The 14B arm** needs its own capacity measurement before any serving plan. On the 5080 the weights plus KV cache come
to about 15.6 GB of 16 GB, beside the honeypot's coder:7b. No prefill extrapolation is offered for it.

### 3.2 Framework

| framework | status | memory on 24 GB | preference training | export | verdict |
|---|---|---|---|---|---|
| **Unsloth** | active | QLoRA minimums: 8B 6 GB, 14B 8.5 GB | DPO, ORPO, KTO, reward models | merged 16-bit / `save_pretrained_gguf` | **primary** |
| TRL + PEFT | active (v1.16) | yes | SFT, DPO, KTO stable; ORPO/CPO experimental | merge, then llama.cpp | fallback |
| Axolotl | active | QLoRA/LoRA, packing | DPO, IPO, KTO, ORPO, GRPO | GGUF path | alternative |
| torchtune | README: "no longer actively maintained" | - | - | - | excluded |
| MLX-LM (Studio) | active | LoRA/QLoRA on unified memory | DPO not documented | `fuse --export-gguf` covers Llama/Mistral only; for Qwen, fuse then llama.cpp | fallback only (the Studio is the showcase brain + teacher) |

**Planned configuration (to be measured, not assumed):**
- **Sequences.** `max_seq_length` 3,072. Real sequences run p50 ~2,550 and p95 ~2,830 tokens (prompt + response).
  Examples over 3,072 are dropped, never truncated.
- **Batching and loss.**
  - Micro-batch 1, gradient accumulation 16.
  - Loss on response tokens only.
  - Packing off, so there is no cross-example attention.
- **Model and optimizer.**
  - 4-bit base with Unsloth gradient checkpointing.
  - LoRA r 16, alpha 32, on all linear projections (q, k, v, o, gate, up, down), dropout 0.
  - `adamw_8bit`, lr 1e-4 cosine with 3% warmup, 1 epoch.
- **Throughput.** No authoritative 3090 figure exists.

  | basis | tok/s |
  |---|---|
  | Andy-4: 1× RTX 3090, ~3 weeks, 425.5 M tokens, 2-2.5 epochs, unknown duty cycle | ≥ ~235 |
  | arithmetic: ~6N FLOPs per token, ~71 TFLOPS bf16 peak, 30-40% MFU, less for dequantization | 300-600 |

- **Planning range: 235-400 tok/s.** Schedules use 235.

**M3 fit-and-speed test.** It measures:
- peak VRAM (`torch.cuda.max_memory_allocated`) over 50 full optimizer steps at seq 3,072;
- tok/s;
- that grad-norm is non-zero and finite. A 2026 paper reports a "fast" run whose gradients were all zero.

**Export to Ollama.**
- Ollama removed `ADAPTER` support in v0.34.1 (2026-09-14; commit 98acec4; the release notes say GGUF creation "requires
  using llama.cpp tooling"). The 3090 runs 0.32.14 and the Studio 0.35.1, so `ADAPTER` is not used at all.
- Steps:
  1. Merge the LoRA into the 16-bit base. This needs ~16 GB host RAM and ~16 GB disk for 8B, plus ~5 GB for the GGUF.
     VM 200 has 32 GB.
  2. Run `convert_hf_to_gguf.py`.
  3. Run `llama-quantize Q4_K_M`.
  4. Write a Modelfile: `FROM ./cand.gguf` plus the base's TEMPLATE.
  5. Run `ollama create`.
- **Export check:** on the 420-item replay set, the Q4_K_M GGUF must choose the same skill as the merged 16-bit model
  ≥ 97% of the time. The schema-valid share must not fall.

### 3.3 Round time (planning; replaced by M3's measurement)

| round | size | time at 235 tok/s | time at 400 tok/s | note |
|---|---|---|---|---|
| bootstrap SFT | 40k examples × ~2,650 tokens = 106 M tokens | 5.2 days | 3.1 days | MineCollab used about 16k transitions |
| 20k bootstrap (the fallback if 235 holds) | 53 M tokens | 2.6 days | - | |
| incremental | 5k examples = 13 M tokens | 15 h | 9 h | |

**Cadence: weekly at most, and never while a bench experiment runs (s.4c).** Training faster than the ladder can read
only grows a queue (CLAUDE.md: "never closing").

### 3.4 Versioning, and never training only on a model's own outputs

**Names.** Each candidate is `cand-<base>-<dataset ver>-<round>`. Its manifest records:
- the base digest;
- the dataset manifest sha, label rule version and split seed;
- hyperparameters;
- framework and llama.cpp versions;
- the GGUF sha256 and the Ollama digest;
- ladder results.

**Lineage rule.** The dataset builder enforces it.
- **No more than 50% of a round's examples may have actions produced by the model being trained or its fine-tuned
  ancestors.**
- For the Qwen3-8B arm, qwen2.5's decisions are not its lineage. Stage 1 is distillation from a different model, as in
  MineCollab.
- **Exception:** the qwen2.5-7B SFT control is trained on its own outputs. It is an offline control only and is never
  served to bots.
- **Frozen anchor.** ≥ 10% of every round comes from dataset v0, which is qwen2.5 days from before any candidate went
  live. Shumailov et al. (2024) found that keeping 10% original data per generation gave "only minor degradation".
- The rest comes from teacher labels (gemma4, plus paid vendors only after the terms decision) and new fleet days.
- Once a candidate is live anywhere, its rows are tagged by model and the cap applies per lineage.

**Attribution.**
- The bench (s.4c) answers the **deploy question**: candidate vs incumbent.
- Separating "a newer base" from "our training" takes:
  - offline: tuned vs untuned Qwen3-8B, and tuned vs untuned qwen2.5;
  - optionally, a second bench experiment, tuned vs untuned Qwen3-8B. That is an owner choice; it costs one bench cycle.

---

## 4. Evaluation ladder

Each rung must pass before the next one runs, and each has a positive control.

**(a) Offline.**
- **Data.**
  - Held-out cells (s.1.5) on the current code version's prompts.
  - The system prompt is rebuilt per hash.
  - Harness: `bench/models/run_bench.py` + `score.py`, the same harness that ran brain-01's 420-item replay on 10-12.
- **Gates, against the fleet model:**
  - schema-valid ≥ the fleet's -0.5 pp;
  - hard-infeasible/bad-args ≤ the fleet's;
  - repeats-the-failed-action ≤ the fleet's.
  - Agreement with held-out good actions is reported only.
- **Post-veto sequence test (new).**
  - The prompt is re-issued with `LAST ACTION: rejected: repeat_loop` and the vetoed action, and we measure whether the
    model repeats it.
  - The 10-12 replay missed this failure because it scores one decision per prompt; the sandbox caught it.
  - Positive control: qwen2.5 must reproduce its sandbox rate (29-59%) before any candidate is scored.
- **Outcome predictor.** P(good | state, action), a calibrated classifier trained on the training split. It is a screen
  only.
- **Serving test** (the 3090 only).
  - Decisions/s at 16 streams on real prompts with varied prefixes; identical prompts measure nothing (memory
    `decision-cadence-formula`).
  - Both bench models resident at once (`/api/ps`), with load_duration p95 < 1 s for each.

**(b) Sandbox closed loop.**
- **Harness:** `bench/models/closedloop/` (C1: `cl_run.py`, `cl_series.py`): 8 bots, 90 min, read at 70 min, paired
  blocks.
- **World setup.** The harness restores and initializes **sandbox** worlds: spawn, time, difficulty (`cl_world.sh`).
  - That is test-fixture setup on worlds no fleet bot lives in. The same setup ran brain-01's C1 pairs (b10-b12) and
    every Paper scene.
  - It is not a world edit made to fix a bot: nothing is changed during a run, and the candidate is scored on the same
    fixture as the control.
  - If the owner reads the constraint more strictly, this rung is dropped. The bench (c) does not depend on it.
- **Gross-failure gate only.** Two qwen-only runs on 10-12 differed by 0.12 in refused share and 3x in output, so this rung
  cannot estimate an effect. Gates:
  - 0 invalid and 0 unserved decisions;
  - deaths not above the local arm;
  - stuck minutes not worse in 2 of 3 pairs;
  - the candidate-share floor from `brain01_series.py`: a block in which under 90% of decisions came from the candidate
    is invalid.

**(c) MODEL BENCH (new; never part of the canary control).**

*Shape.*
- A new pve1 VM (owner GO; resources not checked here), with 4 worlds × 5 bots and its own ES streams.
- It is excluded from canary draws, reads and the tripper, as the showcase already is. Concretely:
  - its bot names carry a `bench-` prefix;
  - the roster lives outside `/srv/mcbots/harness/env`;
  - a structural test asserts the prefix is in the exclusion lists, as the showcase's does.
- **Code and model digests are frozen per experiment.** The bench never follows a fleet promotion mid-experiment.
- **No training during an experiment.** The 3090 serves both arms at equal `NUM_PARALLEL`, with both models resident.
  - A residency check every 5 min.
  - Any eviction or load_duration > 1 s invalidates that 6 h window for both arms.

*Assignment and schedule (one schedule, registered).*
- Each world is split 3/2 by bot, alternating 3/2/3/2, so the sequences are 10/10.
- Period 1 is 72 h, AB or BA by sequence.
- Then one swap and a 6 h washout, which is excluded.
- Period 2 is 72 h.
- **Total 150 h.**
- Both sequences use the same calendar windows.
- Exposure is active bot-hours from decision rows, not calendar time.

*Primary.* **Gross gathered items/bot-h.**
- Definition: positive `inventory_delta` on skill rows, excluding transfer skills (withdraws, town draws, deposits) and
  conversion skills (craft, smelt, compost, toolkit, wear_out, well).
- On 10-20 those exclusions were 3.6% of all positive gains (3,367 of 92,826). Gather (48.0%), mine (32.3%), goto (12.3%) and surface (2.8%)
  make up the rest.
- It is **gross**: tool wear, death losses and junk are not subtracted.
  - The registered estimand is items acquired from the world per bot-hour.
  - A net or value-weighted metric (the bag-fix gate's) is reported as a secondary, not the primary.
- One primary means no multiplicity correction.
- Secondary (reported): stagnation/bot-h, success and refused shares, decisions/bot-h, stone/iron pickaxe crafts.

*Estimator and missing data.* The standard 2×2 crossover estimator: τ = (mean_AB(d) − mean_BA(d)) / 2, with
d = period-1 value − period-2 value per bot.
- It cancels a common period effect for **any** group sizes (Codex r2). The earlier pooled signed mean did not when bots
  dropped out.
- **Usable bot:** at least 36 active bot-h (50%) in each period.
- **A read is INCONCLUSIVE** if either sequence has fewer than 7 usable bots.
- The identical rule runs in the simulation and in the live read.

*Test: a stratified re-randomization test.*
- Re-draw the AB/BA labels within each world, keeping its 3/2 count. That gives 10^4 = 10,000 assignments.
- The statistic is τ, two-sided.
- p < 0.05 with τ > 0 earns **KEEP-to-canary**, subject to the rules below.
- **Confidence interval:** inversion of the same test. It is the set of additive shifts δ that the test does not reject
  when δ is removed from the treated periods.
- World-level bootstrap is **not** used: 4 worlds give only 35 distinct resamples.

*Carryover and sensitivity, with consequences (Codex r2).*
- **Period-1-only estimate.** A parallel comparison of the AB and BA arms in period 1, which is free of carryover.
  - If its sign is opposite to τ and its magnitude exceeds its own simulated null SD, the read is **INCONCLUSIVE**.
  - A whole-pool canary then decides (rung d), not the bench.
- **Washout 0 / 6 / 12 h.** Period 2 starts 0, 6 or 12 h after the swap.
  - If τ changes sign across the three, the read is INCONCLUSIVE.
- Carryover is not assumed away: LESSONS FROM PAST RUNS, inventories and town state persist across the swap.

*Interference.* The arms share chests, trees, ore and a board, and the bias **can go either way**. That is why the primary
excludes transfers. The canary rung, which uses whole pools, is the check.

*Harm.* **KEEP-to-canary also requires all of the following:**
- **Stagnation:** the stagnation/bot-h τ's upper 95% bound, by test inversion, below +15% of the null mean.
- **Death gate.** This is the installed fleet rule applied to the bench arms:
  - at least two candidate-arm deaths;
  - a rate above 1.25× the other arm's;
  - the lower 95% bound clearing 1.25×.
  - It is evaluated at fixed polls (+24/+48/+72 h of each period) on per-arm, per-period exposure.
  - Deaths are attributed to the arm the bot is on at the time of death. A death within 30 min after the swap is reported
    for both arms.
  - The kept null runs 0.0211 deaths/bot-h, about 5.1 deaths per 10-bot arm per day.
  - A trip stops the candidate arm and the read is REVERT.
- **Liveness:** ≥ 95% of candidate-arm decisions are served by the candidate, and schema-valid ≥ the other arm's −1 pp.

*A/A first, through the complete schedule.* Both arms run qwen2.5 for 150 h, read with exactly the procedure above. It
passes only if all of these hold:
1. the test does not reject (p ≥ 0.05);
2. **Variance check.** The A/A's own re-randomization SD of τ lies within 0.5-2× the simulated null SD for the primary
   (the Part 1 null). A "central 95%" check alone cannot see inflated variance;
3. residency and latency gates are met by both arms;
4. 0 bench rows reach any fleet read.

**On failure:** the bench is not used for any candidate. The cause is diagnosed and recorded (fresh-world drift,
serving inequality, a leak), then the A/A is re-run once. A second failure is recorded INCONCLUSIVE, the bench rung is
dropped, and candidates go to the canary rung with its own power.

*Power* (Codex r2: simulate the registered test, not a pooled null). Source: `scripts/learnloop/bench_power.py`, output
`bench_power-13d-v3.txt`.

**Null population.** 13 days (10-08..10-20), 80 bots, 52 6-h windows. Kept: 3,043 of 4,160 bot-windows. Excluded:
- 622 with any row on a **minority build**, one seen on fewer than half the bots in that window (a canary pool or its
  restart-lag rows). A fleet-wide promotion is a common change, and a crossover cancels it.
- 465 post-intervention windows: the bot's next window after such a cell.
- 30 with a non-qwen decision (brain-01).

Kept volume: 1,442,544 decisions, 385 deaths, 18,211 bot-h.

**Part 1, the registered test, simulated.**
- 400 draws of 4 of 16 worlds × a time offset (28 distinct).
- 400 re-randomizations each.
- Effects injected additively into each bot's treated period.

| metric (null mean) | rejection at δ = 0 | power at 10% / 15% / 20% / 25% / 30% of the mean | **MDE80** |
|---|---|---|---|
| **gross gathered/bot-h (49.98)** | 0.035 | 0.38 / 0.63 / 0.83 / 0.89 / 0.96 | **20%** |
| stagnation/bot-h (3.16) | 0.054 | 0.37 / 0.62 / 0.82 / 0.92 / 0.98 | 20% |
| success share (0.239) | 0.043 | 0.32 / 0.51 / 0.69 / 0.83 / 0.90 | 25% (~6 pp) |
| refused share (0.445) | 0.048 | 0.66 / 0.90 / 0.99 / 1.00 / 1.00 | 15% (~6.7 pp) |

**Reading Part 1:**
- **The test holds its size:** rejection under the null is 3.5-5.4%, against a nominal 5%.
- **It detects a 20% change in gross gathered output with 80% power.**
- These power figures rest on 115-130 usable draws per metric, ±~0.04.
- The other 270-285 draws were INCONCLUSIVE on coverage. In the fleet null, canary exclusions knock bots below the
  50%-of-hours floor. That is a property of the fleet null (16 pools sharing a canary lane), not of the bench, which has
  no canaries.
- Most usable draws were left unbalanced by the exposure rule (93 of 115 for the primary), and the size still held. That
  is the 2×2 estimator doing its job.

**Part 2, design comparison on the same schedule.** A planning approximation: MDE ≈ 2.8 × null SD, as % of the mean.

| metric | within-world parallel | whole-world parallel | **within-world crossover** | whole-world crossover |
|---|---|---|---|---|
| gross gathered/bot-h | 40% | 60% | **18%** | 19% |
| stagnation/bot-h | 39% | 52% | 19% | 21% |
| refused share | 26% | 33% | 11% | 13% |

**What Part 2 shows:**
- **10 v 10 in parallel cannot see an output change under ~40%.** It sees brain-01-sized moves in decision shares.
- Crossover is what buys the power.
- Within-world and whole-world crossover are close on the primary: 18% vs 19%.
- Within-world is kept because whole-world crossover more often fails the 7-per-sequence coverage rule (n/a on two
  metrics), and a world outage would remove a fifth of a sequence. Interference is the price of within-world, so
  whole-world crossover is the fallback design if the A/A shows within-world interference.

**Caveats.**
- 28 distinct time offsets underlie the 72 h figures, and they overlap.
- The null is a mature fleet. Fresh bench worlds drift faster ("fresh worlds buy one week"), which is what the A/A and
  its variance check measure.
- **These power figures are re-derived on the A/A data before any candidate is read.**

**(d) Promotion through the main lane: a model-env canary, brain-01 style.**
- **Registration.** `class: model-env`, tier 3, `draw_k: 2`, `canary_env: OLLAMA_MODEL=cand-…` with the 3090 as the
  endpoint. These are the host patches installed on 10-19. The bench is idle during the canary.
- **Reads.** Gates as brainread's (liveness, fallback, unserved, schema, decision time, mismatch, config, every bot),
  plus immobiledid. Exposure ≥ 200 canary bot-h. The primary is gross gathered/bot-h, which goes to the owner.
- **Close.** KEEP / REVERT / INCONCLUSIVE is recorded, then the **teardown**, three steps plus the env check:
  1. remove the drop-ins;
  2. clear `canary_pool`;
  3. restart the pool's bots 12 s apart;
  4. then check that no pool bot's `/proc/<pid>/environ` carries the candidate model, and confirm exactly two versions are
     live.
  - Memory then records SHIPPED or its opposite.
- **Fleet promotion.** If the canary KEEPs, the owner decides whether the fleet model changes. Serving it fleet-wide means
  the candidate goes onto 10.0.0.72, which is an **owner/operator step**: no agent touches .72. qwen2.5 stays pulled for
  rollback. This is listed under owner decisions.

---

## 5. The 3090 move

### 5.1 What the rows say (`endpoint_load-20261020.txt`)

Every number is computed from llm rows with the shared reader. 10.0.0.72 was not contacted.

| 10-20 | 5080 (10.0.0.72) | 3090 (10.0.0.16) |
|---|---|---|
| bots / model decisions | 60 / 110,325 | 20 / 37,741 |
| prompt tokens (avg / busiest hour / busiest 5 min) | 3,172 / 3,338 / 3,538 tok/s | 1,074 / 1,174 / 1,267 tok/s |
| latency p50 / p95 / p99 | 1,458 / 2,791 / 3,437 ms | 3,054 / 7,252 / 9,388 ms |
| per-request prefill p50 (under its own concurrency) | 14,582 tok/s | 8,332 tok/s |
| per-request decode p50 | 50.1 tok/s | 27.3 tok/s |
| summed decode / prefill seconds per wall second | 1.606 / 0.216 | 1.098 / 0.148 |
| mean in flight (observed) | 1.97 | 1.53 |

**Fallback evidence.**
- Every 10-20 row was served by its bot's configured first endpoint, except the 3,483 brain-01 rows served by the Studio
  by design.
- 215 rows had `retry_count > 0`, and 0 model rows had no endpoint.
- All 80 env files were rewritten at 10-20 11:13Z. The endpoint lines held throughout: every row matched the post-rewrite
  first entry.

**The hypothesis: all 80 bots on the 5080.**
- **Prompt demand.** 4,246 tok/s on the day, 4,494 in the busiest hour, 4,753 in the busiest 5 min. That is 29% / 31% /
  33% of the 5080's per-request prefill rate.
  - That rate was measured under today's concurrency. It is **not** exclusive capacity, and this is **not** a utilization
    figure.
- **Decode, the larger share.** It scales from 1.61 to ~2.16 decode-seconds per second, i.e. ~2.2 requests decoding at once
  on average.
  - It fits only if `NUM_PARALLEL` ≥ 4 with headroom for bursts.
  - Per-stream decode falls as parallel slots fill. Expect p50 above today's 1.5 s.
- **Little's law** describes today; it does not predict latency under more load.

**Precedent.**
- The 5080 carried all 80 bots until 09-11, at p50 ~1.5 s and ~110 decisions/min. Today's rate is ~103/min.
- The honeypot's coder:7b was already resident then (memory `ollama-5080-second-model`, since 08-06).
- Prompts were shorter then: ~2,100 vs 2,494 tokens p50.
- Memory `inference-is-not-the-constraint`: decision rate 91.10 vs 91.85 decisions/bot-h across a 1.9× latency gap.

**Unknown here:** the 5080's `NUM_PARALLEL`, `num_ctx`, and free VRAM next to the honeypot.

**Verdict: conditional GO.** It needs both of the following:
- (1) **The operator reads `/api/ps` and the Ollama env on .72** (an owner/operator action, not this agent) and confirms
  `NUM_PARALLEL` ≥ 4 and the VRAM for the extra KV slots.
- (2) The read gates below pass.

### 5.2 How (one transaction for all 80 bots)

**Change.**
- Rewrite all **80** env files in one step:
  - the 20 `*-d` bots point at .72;
  - **.16 is removed from every list**, the 60 fallbacks included (option A, recommended).
- Back up all 80 as `*.bak-3090move-<stamp>`.
- Option B keeps .16 as a last fallback. It is rejected for the training period, because a fallback would land on the
  training GPU and could only be flagged afterwards.

**When.** In a canary gap, as its own restart. The gap is held by a mechanism, not by timing (Claude r2): the move runs
under the installer protocol (CLAUDE.md, "Deploys"), because `canary-sched.py` launches the queue head into any empty slot
every 5 min.
- **Acquire the gap.**
  - `flock -n /tmp/mcai-canary.lock` for the whole run, refusing on a declared manifest or any drop-in.
  - `canary-sched.py install-hold <owner> <minutes>`, which exits 2 unless the slot is free.
  - The hold runs until the +360 read is recorded **and** the 90-min clean pre-window after the last restart has passed.
- **Restart.** All 80 bots, 12 s apart, ~16 min in all.
  - It is not bundled with a promotion, so neither read confounds the other.
- **Release.** `canary-sched.py install-release` once the +360 read is recorded (or the rollback is complete). It is logged in
  `~/digest/gate-installs.log` like any install.

**Mechanical exclusion before training starts on .16:**
- (i) 0 fleet rows on .16 for 24 h;
- (ii) no fleet bot's `/proc/<pid>/environ` contains `10.0.0.16`;
- (iii) owner choice: a firewall rule on VM 200 that admits only the bench VM to 11434.

**Read: absolute fleet-wide gates. DiD is reported, never the gate.** A slowdown that hits all 80 bots alike cannot show in
a 20-vs-60 DiD.

| read | gates (a breach at either read means rollback) |
|---|---|
| +60 | every fleet model row served by .72; 0 on .16; 0 model rows with no endpoint |
| +60 and +360 | fleet p50 ≤ 2.5 s; p95 ≤ 5 s (the existing tripwire); p99 ≤ 10 s; `retry_count > 0` ≤ 3× today's rate (215/day) |
| +360, reported only | decisions/bot-h and gross gathered/bot-h, moved 20 vs 60, as a DiD on 6 h windows that skip the first 30 min |

**Rollback.**
- Restore all 80 files from the backup and restart all 80, 12 s apart.
- Until the +360 read passes, .16 keeps qwen2.5 loaded and runs nothing else.

**Afterwards.** .16 becomes training plus bench serving, never both at once (s.4c).
- Today it holds qwen2.5 at 12.18 GB (`/api/ps` on .16, read-only).
- The bench needs two ~5-6 GB models at a lower `NUM_PARALLEL`.
- QLoRA 8B needs ~10 GB or more (measured at M3).

---

## 6. Risks

- **Decision quality may not be what limits output.** The kill rule is operational.
  - If the first two candidates that reach the bench both fail to show the pre-registered benefit, the loop stops at the
    bench. "Fail" means the gathered primary is not significant, or is negative.
  - What gets recorded: "these candidates did not demonstrate the pre-specified benefit; a bench that detects a 20% change with 80% power". If the A/A re-derived a weaker power, that figure is recorded instead.
  - That is not "the model is not the constraint". Weak labels, ineffective training, interference or carryover would look
    the same.
  - The 3090 then returns to being a spare.
- **Feedback loops.** Filtered BC on a model's own outputs narrows it, for example toward explore, which is already 28% of
  actions. Mitigations:
  - the 50% lineage cap;
  - the frozen anchor;
  - action mix and entropy tracked per round;
  - a round is refused if a top-5 skill share moves more than 10 pp from the anchor without a bench reason.
- **Distribution shift on every code change.**
  - Each triple carries its code version and system hash.
  - Offline scoring always uses the current version's prompts.
  - Examples whose skill or args no longer exist are dropped.
  - The grammar enforces the current schema at serve time.
  - The replay is re-run on the fleet tip before any canary.
- **Safety.** No new actions are possible:
  - the gate and reflexes are unchanged;
  - a model can only propose what the schema allows, and the gate still refuses;
  - deaths gate both the bench and the canary;
  - no world edits.
- **Evaluation noise.**
  - The 2.36× between-pool band and fresh-world drift are both known.
  - The answer is the full-schedule A/A, the crossover, DiD only, and denominators printed.
  - The sandbox serves only as a gross-failure gate.
- **Cost runaway.**
  - Vendor hard limits plus a client ledger at 80%, in batches of ≤ $10.
  - No retry into a 429.
  - gemma4 is the default teacher.
  - Compute is local.
- **Terms.** Paid outputs stay quarantined until the owner decides (s.2.4).
- **Fleet host load.** Extraction takes ~3 min/day at `nice 19`/`ionice -c3`, 0.84 GB peak, on a 94 GB host with 77 GB
  available.
- **The Studio.** The teacher runs at concurrency 1, yields to GPU_RESERVED, and never runs during a brain test.

---

## 7. Schedule (dependency-based), milestones, owner decisions

Durations use the slow planning figure (235 tok/s) and are replaced by measurements as each step lands.

| # | milestone | depends on | est. | done when |
|---|---|---|---|---|
| M0 | this design, both reviews APPROVE | - | - | branch pushed |
| M1 | nightly extraction + NAS archive; dataset v0 (13 days); splits; near-dup rate; outcome predictor; replay baseline (qwen2.5, qwen3-8b zero-shot, gemma4 at low concurrency) | NAS share (owner) | 3-4 days | v0 manifest + offline table |
| M2 | **3090 move** (s.5.2) | owner GO; operator's .72 readout; a canary gap | 1 day | +360 read recorded |
| M3 | fit + speed test; bootstrap SFT (Qwen3-8B; qwen2.5 control); export + export check; ladder (a) | M2 | 3-6 days | offline gates recorded |
| M4 | teacher pilot: gemma4 at once; paid arms B + C | owner keys, caps, terms answers (i) | 2 days after keys | pilot table + decision |
| M5 | sandbox ladder (b), 3 pairs | sandbox slot | 1 day | gross-failure gate recorded |
| M6 | bench VM; A/A 150 h; candidate crossover 150 h | owner GO on VM + pve1 resources | ~14 days (2 × 6.25 + setup) | bench verdict recorded |
| M7 | model-env canary (tier 3, queue) → owner's promotion call | a queue slot | 1-2 days of reads (≥ 200 bot-h) | KEEP/REVERT, teardown, SHIPPED |

**Critical path.** M2 → M3 → M5 → M6 → M7, about 4 weeks to the first canary read. M1 and M4 run in parallel.

**Cadence after that.** One candidate in the bench at a time.
- The next candidate is read only after the current one is decided (the OpenLoop rule, applied to the bench).
- Training for the next candidate runs only between experiments.

**Owner decisions.**
1. **3090 move:** GO, the operator's .72 readout, option A (remove .16 everywhere), and optionally the VM 200 firewall rule.
2. **Base:** Qwen3-8B primary. 14B only after a bench effect and its own capacity measurement.
3. **Teacher pilot:**
   - keys in a dedicated workspace or project;
   - **$100/month cap per vendor**;
   - arms B + C (D/E optional);
   - **answers to the terms questions (i)-(iii)** (s.2.4);
   - a named person for the 200 blind judgments.
4. **Bench:** VM on pve1 (resources), the 150 h schedule, and gross gathered/bot-h as the one primary.
5. **NAS share** for training data, about 45 GB a year.
6. **Kill rule** as written (s.6).
7. **Fleet promotion of a KEPT model onto 10.0.0.72:** an owner/operator step.
8. **Sandbox fixture (s.4b):** whether restoring and initializing sandbox worlds (spawn, time, difficulty) is acceptable
   test setup under "do not change the world to fix a bot". If not, rung (b) is dropped.
9. Optional:
   - log `outcome.value` and a decision id (ES mapping first);
   - whether to spend a bench cycle on attribution (tuned vs untuned Qwen3).

---

## 8. Prior art

**Minecraft agents.**
- **ODYSSEY** (arXiv 2407.15325, https://github.com/zju-vipa/Odyssey). MineMA-8B and -70B are LoRA fine-tunes of LLaMA-3 on
  390k+ Minecraft-Wiki instructions, with a 40 + 183 skill library. That is domain-knowledge SFT; ours is
  state/action/outcome data from our own fleet.
- **MineCollab / "Collaborating Action by Action"** (arXiv 2504.17950, https://mindcraft-minecollab.github.io/). Filtered
  BC trained llama3-8b on about 16k successful transitions of a 70B:
  - over 17% better on cooking;
  - matched the 70B on construction;
  - beat gpt-4o on crafting.
  - **This is stages 1 and 2 here.**
- **Andy-4** (https://huggingface.co/Sweaterdog/Andy-4). An 8B Mindcraft model trained "on a single RTX 3090 over three
  weeks": 62k conversations, 425.5 M tokens, 3 stages.
  - Base: `unsloth/DeepSeek-R1-Distill-Llama-8B-bnb-4bit`, so probably Unsloth QLoRA.
  - Licence: its own "Andy 1.0 License". Andy-3.5 is Apache-2.0 (7B from R1-Distill-Qwen, about 12k prompts).
  - **This is our hardware's existence proof, and our lower bound on throughput.**
- **Mindcraft** (https://github.com/kolbytn/mindcraft, MIT): mineflayer + LLM agents, and home of the Andy models.
- **Voyager** (arXiv 2305.16291): curriculum, skill library and iterative prompting with GPT-4, no training. 3.3× unique
  items.
- **MindForge** (arXiv 2411.12977): theory of mind, memory and communication. With open-weight LLMs it reports 3× the
  tech-tree milestones of Voyager.

**Distillation and self-training.**
- FireAct (arXiv 2310.05915): 500 GPT-4 trajectories, Llama2-7B +77% on HotpotQA.
- AgentTuning (arXiv 2310.12823).
- Distilling step-by-step (arXiv 2305.02301).
- ReST (arXiv 2308.08998).
- STaR (arXiv 2203.14465).
- DPO (arXiv 2305.18290).
- %BC in Decision Transformer (arXiv 2106.01345).
- **Model collapse** (Shumailov et al., Nature 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11269175/): keeping original
  data mitigates it. That is the s.3.4 lineage rule.

**Learning from deployment.**
- WebRL (arXiv 2411.02337): Llama-3.1-8B from 4.8% to 42.4% on WebArena-Lite, with a self-evolving curriculum and an
  outcome reward model.
- Agent Q (arXiv 2408.07199).
- SWE-Gym (arXiv 2412.21139).
- Weight-free alternatives, if the kill rule fires: Memento (arXiv 2508.16153) and "Learning on the Job" (arXiv 2607.22157).

**Where we differ.** Our scoreboard is a live, noisy, multi-bot world with a measured null. Two earlier brain changes
moved decision shares without a distinguishable output change. The ladder exists to find out cheaply whether this one
does.

## 9. Offline prototype (done)

Everything ran on 10.0.0.31 in `~/learnloop-scratch-1021/`. The triples are not committed: they are 32 MB gz of full
prompts.

| script | what it did |
|---|---|
| `extract_triples.py --day 2026-10-20` | 80 bots in 3 min 4 s, peak 0.84 GB; output `triples-summary-20261020.json` |
| `label_check.py` | s.1.3-1.4 |
| `endpoint_load.py 2026-10-20` | s.5.1 |
| `bench_power.py --days 13` | s.4c; output `bench_power-13d-v3.txt`, cache `cells-13d-v3.json` |
| system-prompt rebuild | `sp/` (9e7d9980 and adbec4f4 × 4 scopes) |

**10.0.0.61.** It answers ping, but nothing listens on 11434, 1234, 8000 or 8080. Memory `inference-vram-measured` says it
is the owner's MacBook, not infrastructure. **No 96 GB analysis endpoint is available today.**

## 10. Reviews → where each finding is answered

**Round 1.**

| finding (engine) | answer |
|---|---|
| join can pick the wrong row; misses unexplained (Codex P1-1; Claude P2-10) | s.1.1: start in [t, t + latency + 30 s], one use per row, status + detail equality; quality counted; all misses are `failed`, 97% "paused" |
| windows attribute by start; censoring; midnight (Codex P1-2) | s.1.1/1.2: end-attributed items, `items_other`, `observed`, 1 h lookahead, next prompt read past midnight |
| crossover vs whole-world comparison unfair (Codex P1-3) | s.4c: all four designs on the same schedule; whole-world crossover 28% vs within-world 17% |
| null contaminated by interventions (Codex P1-4; Claude P3-5) | s.4c: off-majority-build and non-qwen bot-windows excluded and counted |
| schedule, washout, carryover (Codex P1-5; Claude P2-2, P2-6) | s.4c: one 150 h schedule, washout simulated, period-1 and washout sensitivity, carryover named |
| bootstrap by world invalid; A/A (Codex P1-6; Claude P1-3, P2-4) | s.4c: stratified re-randomization (10^4 assignments); A/A through the full schedule with pass criteria; simulated MDE |
| promotion and death-gate rules undefined (Codex P1-7; Claude P3-6) | s.4c: one primary; harm margin; fleet death rule with fixed polls and attribution |
| capacity argument (Codex P1-8; Claude P2-1) | s.5.1: decode-led argument, per-request rate not capacity, conditional GO on the operator's .72 readout; 14B extrapolation removed |
| endpoint reader and fallback (Codex P1-9; Claude P3-2) | `endpoint_load.py` uses the shared reader (counts equal); config first entry vs served endpoint; retries; unserved |
| teacher scoring cannot discriminate (Codex P1-10; Claude P1-2) | s.2.4: blind condition scored, non-inferiority, failure-class aware, McNemar, mandatory blind human judging, closed loop required for any superiority claim |
| move transaction and rollback (Codex P1-11; Claude P3-10) | s.5.2: one 80-file transaction, full rollback, standalone restart, mechanical exclusion, absolute gates |
| world init, .72, teardown (Codex P1-12; Claude P2-12) | s.4b, s.4d, s.7 decision 7 |
| brain-01 / model-tier-01 overclaimed (Claude P1-1) | s.0, s.1.3 reworded; brain-01 reads committed |
| bot-level validation not independent (Codex P2-13; Claude P2-8) | s.1.3: per-bot production from all skill rows, world-cluster CI (touches 0); non-circular columns; "decisions followed by" |
| "clean" overclaimed; readers; hashes (Codex P2-14; Claude P3-1, P3-3) | s.1.1: nonce check, 3 of 3 hashes rebuilt, reader counts, full refusal table, value semantics |
| training spec and export check (Codex P2-15; Claude P3-9) | s.3.2: config, 235 tok/s schedule figure, M3 measurements, merge budget, GGUF-vs-16-bit check |
| lineage vs control; attribution (Codex P2-16; Claude P3-9) | s.3.4 |
| bench stability (Codex P2-17; Claude P2-7) | s.4c: frozen digests, residency check, no training during experiments, exposure in bot-h |
| kill-rule wording (Codex P2-18; Claude P3-6) | s.6 |
| dedupe deletes pairs (Claude P2-9) | s.1.5: mine pairs first, dedupe on prompt + action |
| interference direction; transfers (Claude P2-5) | s.4c: either direction; gathered primary excludes transfers |
| terms "safe harbour" (Claude P2-11) | s.2.4: questions (i)-(iii) |
| ledger vs arm E; Haiku price (Claude P3-8) | s.2.4: 80% rule in ≤ $10 batches; Haiku from the pricing page only |
| schedule mismatch (Codex P3-19) | s.0, s.7: one dependency-based schedule |
| draw count; ES 5-row gap (Claude P3-4, P3-7) | printed in the outputs; s.0, s.1.3 |

**Round 2.**

| finding (engine) | answer |
|---|---|
| mixed-build cells survive the exclusion (Codex r2 P1-1) | `bench_power.py`: a cell with ANY row on a minority (canary) build is excluded, plus the next window. A promotion is a common change and stays in. Version reader fixed for 7-char shas, with a blind-reader assert |
| 17% is not power for the registered test (Codex r2 P1-2) | s.4c Part 1: the re-randomization test is simulated under the null (size 3.5-5.4%) and under injected effects; MDE80 20%; CI by test inversion; kill-rule wording now cites the A/A-re-derived power |
| exclusions break crossover balance (Codex r2 P1-3; Claude r2 P3) | s.4c: the standard 2×2 estimator (cancels a common period effect for any group sizes), usable = 36 bot-h per period, < 7 per sequence = INCONCLUSIVE; imbalance counted (size still holds) |
| sensitivity checks have no consequence (Codex r2 P2-4) | s.4c: a period-1 sign reversal beyond its null SD, or a sign change across washouts, means INCONCLUSIVE |
| end-attributed windows can miss long skills (Codex r2 P2-5; Claude r2 P3) | `extract_triples.py`: an end-time index (bisect); longest skill 211 s, inside the 2 h back-read; evidence regenerated from this code |
| clean count includes ambiguous joins; 8 misses unexplained; t−1 (Codex r2 P2-6) | s.1.1/1.4: only the 70,581 unique exact joins count; misses = 10,127 paused + 303 busy + 5 real (listed); the 5 status-only joins shown false; [t − 1 s, …] documented |
| human judging has tiny effective samples; NI margin missing (Codex r2 P2-7; Claude r2 P3) | s.2.4: ≥ 100 non-ties and an exact one-sided binomial at p < 0.05; paired NI bounds of ±2 pp for both checks |
| "net" is gross; conversions count as gains (Codex r2 P2-8; Claude r2 P2-2) | s.0/4c: renamed **gross gathered**; craft, smelt, compost, toolkit, wear_out and well excluded with transfers; underscore names dropped from the set; a net metric is secondary |
| stagnation reconciliation; MDE approximation statement (Codex r2 P3-9) | s.1.3: exact-kind 5,070 (= ES) vs broad 5,262, both reported; Part 2 is labelled an approximation |
| runner-refused "failed" labelled bad (Claude r2 P2-1) | s.1.3: label `void` (10,435), never a negative; the pilot pool excludes it (100,990) |
| 3090 move "canary gap" has no mechanism (Claude r2 P2-3) | s.5.2: flock + `canary-sched.py install-hold`, held through +360 and the 90-min pre-window, then `install-release` |
| harm margin redundant; A/A on failure; variance check (Claude r2 P3) | s.4c: the margin moves to stagnation (upper bound < +15%); A/A variance check 0.5-2×; failure procedure |
| ledger vs all-four arms (Claude r2 P3) | s.2.4: B + C fit; all four do not in one month |
| ES query and hash rebuild not committed (Claude r2 P3) | `es_crosscheck-20261020.txt`, `sp_hash_rebuild.txt` |
| sandbox fixture not in owner decisions (Claude r2 P3) | s.7 decision 8 |
