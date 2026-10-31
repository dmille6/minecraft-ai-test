# Learning loop candidate 2 + the teacher pilot (2026-10-30 .. 31)

Owner 10-30 "queue both": run the paid-teacher pilot, train a SECOND candidate on cleaned data, judge it against
qwen3.5:9b. Kill rule (owner-approved): stop after two failed candidates; this one counts. Branch `learnloop-c2-1030`
(main + learnloop-m3-run merged in). Nothing here touched 10.0.0.72 or a world. No bot, env file or manifest was changed. The one queue
change is a HELD entry appended at the end (s.7). The Mac ran only the batch-API client and light analysis.

## 0. Answer

- **Candidate 2 (`cand-qwen35-9b-c2-q8`: Qwen3.5-9B + 8-bit LoRA on 5,768 cleaned examples) PASSES the owner's offline
  bar against qwen3.5:9b**, on the same 600-item replay with the same scorer: schema-valid 100%, hard 2.0 (vs 3.0),
  rep_fail **16.7** (vs 25.3), post-veto repeat **7.0** (vs 54.0). It also passes against the recorded reference
  (26.7 / 53.0 / 2.0; hard ties). Candidate 1 was 50.0 / 72 / 11.3.
- **The latency gate is not yet passed or failed.** On the 3090, which shares its GPU with ethan-gpu, neither the
  candidate nor qwen3.5:9b holds p50 <= 2.5 s / p95 <= 5 s at 20/min. The candidate is the fastest of the three there:
  its answers are shorter (41 vs 57-62 completion tokens), giving ~20-25% less service time. It has to be measured on the
  Blackwell, which served qwen35-01 live at p50 1.44 s / p95 2.55 s. That measurement is a release prerequisite.
- **Three caveats the owner should weigh** (s.6):
  1. Most of the rep_fail gain over the stock tag comes from quantisation, not training. The stock qwen3.5:9b at Q8_0
     scores 20.3 / 33.0 / hard 1.7 by itself.
  2. Against Q8_0, the candidate's hard is 2-3 items worse out of 600 (2.0 vs 1.7 / 1.5).
  3. The post-veto gain comes with a shift to `surface`: the candidate answers it on 65% of post-veto items and 53% of
     failure items. About 70% of those answers are given while underground.
- **Queue:** `qwen35c2-01` is prepared like qwen35-01 (model-env, empty-tree variant 840faa5b on aad2506a, Blackwell,
  promotion none). It is **HELD and appended at the end**, so it cannot launch or block anyone (s.7).
- **Kill rule:** not reached, because candidate 2 did not fail the bar. Whether it helps OUTPUT (items/bot-h, the design's
  primary) only a canary can say.
- **Teacher pilot:** both paid arms done. Claude Opus 5.5 cost **$11.61**; GPT `gpt-6.1-sol` cost **$4.97**
  (run 10-31 ~17:10-17:25Z after the owner added credit). Total paid **$16.58**. The local teacher qwen3.8:27b agrees with Claude on the skill 58.9% of the time (kappa 0.48). The fleet's own
  failed actions agree with Claude 18.5%, and Claude agrees with itself 75% across blind and informed prompts.

**OWNER DECISION STILL NEEDED: read the vendors' output-use terms before any paid-teacher label is trained on.**
Both Anthropic (Usage Policy; Commercial Terms D.4) and OpenAI (Services Agreement 3.3(e)) restrict using outputs to
build competing models (design s.2.4 quotes them). The Claude labels from this pilot sit quarantined on the Mac
(`~/learnloop/teacher-paid/B/`). They were used ONLY to measure the local teacher. NOTHING trained on them: the builder
refuses `teacher-paid:` provenance and any record without an allow-listed LOCAL provenance, and the training file has 0
paid rows. Questions (i)-(iii) of design s.2.4 are still open. Whether even this measurement use is allowed is question
(i).

## 1. Teacher pilot (design s.2.4)

| arm | model (why) | route | requests | result | cost (actual) |
|---|---|---|---|---|---|
| B | `claude-opus-5-5`: the current Opus and the design's choice. $4/$20 list, $2/$10 batch | Anthropic Message Batches, effort `low`, structured output = the fleet schema. No server-side fallback, because a fallback model would contaminate the arm | 5 probe + 1,000 blind + 200 informed | 1,205/1,205 succeeded and parsed | **$11.61** (5.27 M in / 107 k out) |
| C | `gpt-6.1-sol`: newest OpenAI generation, batch $1/$5. `gpt-6-astra` ($5/$25 batch) costs ~5x; the design priced sol | OpenAI Batch, reasoning_effort `low`, strict json_schema, no fallback | 5 probe + 1,000 blind + 200 informed (10-31, after the owner added credit) | blind 941/1,000 parsed. The other 59 came back EMPTY: reasoning used the whole 4,096-token budget. They count as invalid (the arm's own outcome; no retry). Informed 196/200 | **$4.97** (3.14 M in / 362 k out) |

- **OpenAI strict mode** rejects the fleet schema as written: every property must be in `required` (live 400 on a
  one-item synchronous check). So `openai_strict_schema` makes the optional `args` fields required-but-nullable, which
  keeps the grammar enforced, and fetch strips the nulls. The first probe used the old schema; it was cancelled before
  it ran ($0, recorded `void`). A second probe on the next 5 items passed 5/5 ($0.015).
- The Claude arm cost far less than the plan ($11.61 vs $26.44 expected for blind + informed). Answers were ~65 tokens
  with very little thinking at effort `low`. The plan assumed 1,500 output tokens per item.
- Keys stayed on the Mac (mode 600). They were read in-process and never printed, logged or placed on a command line.

### 1.1 How good are the LOCAL teacher's labels? (1,000 pilot items, blind condition)

The local teacher is **qwen3.8:27b** (Apache-2.0). It was the best untuned model on the 600-item replay (rep_fail 14.7,
post-veto 21, hard 2.2). It ran at T=0 with think:false through the fleet's own client, on the 3090 (fully on the GPU
beside ethan-gpu with num_ctx 4096 and num_gpu 999). One guarded window ran on the Blackwell (s.2.1). Both hosts serve
the same weight blob and renderer. Scoring uses the same filters as training (`teacher/pilot_agreement.py`).

| | schema-valid | hard | re-chooses the logged failed action (837 non-transient) | passes the label filter |
|---|---|---|---|---|
| qwen3.8:27b (local) | 100.0 | 4.6 | 14.2 | 84.6 |
| claude-opus-5-5 (paid) | 100.0 | 4.4 | 10.6 | 87.2 |
| gpt-6.1-sol (paid) | 94.1 (59 empty) | 3.0 | 9.7 | 83.3 |
| untuned qwen3.5:9b (reference: the student's base, T=0, think:false, 3090) | 100.0 | 7.0 | 22.5 | 75.8 |
| the fleet's logged action (positive control) | 100.0 | 16.7 | 100 (by construction) | 13.9 |

| agreement on the pilot | n | same skill | same skill + key arg | skill kappa |
|---|---|---|---|---|
| **qwen3.8:27b vs Claude** | 1,000 | **58.9%** | **50.5%** | **0.48** |
| **qwen3.8:27b vs GPT** | 941 | **59.6%** | **51.4%** | **0.48** |
| **Claude vs GPT** (paid teachers with each other) | 941 | **72.5%** | **61.4%** | **0.66** |
| untuned qwen3.5:9b vs GPT | 941 | 38.6% | 27.8% | 0.27 |
| untuned qwen3.5:9b (the canary model, the student's base) vs Claude | 1,000 | 36.2% | 26.2% | 0.25 |
| fleet logged action vs Claude (floor) | 990 | 18.5% | 9.5% | 0.10 |
| Claude informed vs Claude blind (the paid teacher's own consistency) | 200 | 75.0% | 67.0% | 0.69 |

- **`surface` share** of valid answers: qwen3.8:27b 48.5%, Claude 33.1%, GPT 35.4%, qwen3.5:9b 17.8%.
- The two paid teachers agree with each other (72.5%) clearly more than the local teacher agrees with either (~59%).
  The local teacher sits between the student's base (36-39%) and the paid pair. Same keep/drop call: Claude-GPT 89.8%,
  local-Claude 85.8%, local-GPT 86.0%.
- Hard is a share of VALID answers. GPT's 3.0 is over 941.
- Local teacher vs Claude: both make the same keep/drop call on 85.8% of items. When both keep their answer, the action matches on 55.1%.
- Read: the local teacher is far closer to Claude than the student's base is (58.9% vs 36.2%), and far closer than the fleet is, and just as valid (hard 4.6 vs 4.4). It re-chooses
  the failed action somewhat more often (14.2 vs 10.6). It also over-uses `surface`: 485 vs Claude's 331 of 1,000, though
  Claude agrees on 311 of its 485. That over-use shaped the dataset (s.2, the 30% cap).

## 2. Cleaned dataset (design s.2.1-2.2) -- `~/learnloop/c2/data/v1/` on 10.0.0.31, `build_clean.py`

The source is dataset v0's TRAIN cell only: 13 training worlds x 10-08..10-19. The held-out worlds (board-a, placebo-d,
isolated-c) and the 2 newest days never enter. The 600 eval ids and the 1,000 pilot ids are kept out of the relabel pool.
Positive control: the pass walked 1,462,110 TRAIN rows, exactly v0's TRAIN cell.

- **Good by OUTPUT** (never decision success alone). Start: 316,538 v0 train-good decisions. Dropped 12,597 that repeated
  the bot's previous action when that action had failed or been vetoed. Dropped 49,390 with no gathered item in 600 s
  and no milestone. Kept the top half of each skill by 600-s gathered items, leaving 131,395. Drew 9,000 sqrt-by-skill,
  then a seeded 3,000 for training.
- **Relabel pool** for the local teacher, blind (the prompt the fleet saw), in shuffled order so a time-boxed stop is
  unbiased:
  - 12,000 non-transient failures, stratified over 107 failure-class x skill strata;
  - 4,000 decisions made right after a repeat_loop veto.
  - **Labelled by 06:00Z:** 4,852 (2,828 on the 3090 + 2,024 on the Blackwell, from opposite ends, so disjoint). The
    pilot's 827 non-transient items were added with their local labels, after a split check.
- **Label filter** (s.2.2) kept 4,496:
  - schema-valid through the fleet client;
  - bench/models/score.py hard check passes (221 refused);
  - not the logged failed action, on ANY item whose logged decision failed non-transiently (924 refused);
  - after a veto, not the vetoed action (38 refused);
  - allow-listed local provenance only.
- **Anti-collapse cap:** no skill above 30% of kept relabels. It was fixed before the final count and applied by seeded
  water-filling. It dropped 1,728 surplus `surface` answers, leaving 2,768 relabels.

**Training set `train-c2-01.jsonl`** (sha256 7a4feac2...) has **5,768 examples**: 3,000 fleet good-by-output
(qwen2.5) + 2,199 failure relabels + 569 post-veto relabels (qwen3.8:27b). The 1:1 fleet:teacher balance is on purpose,
because candidate 1 failed by imitating the fleet. Skill mix: gather 22.1%, surface 15.8%, explore 14.1, mine 14.1, goto
13.6, deposit 7.6, home 6.7, craft 2.5, smelt 1.4, place 1.0, status 1.0. Assertion run on the final file: 0 eval ids,
0 held-out-world rows, 0 new-day rows, 0 paid rows, 0 duplicate ids, 5,768/5,768 sentinels correct.

## 3. Base choice: Qwen3.5-9B, not Qwen3-8B

- **Stronger untuned:** qwen3.5:9b scored 26.7 / 53 / hard 2.0 and 100% schema-valid. Qwen3-8B no-think scored
  28.3 / 54 / 3.8 and only 83% schema-valid. The bar is "beat qwen3.5:9b"; starting below it would have made the bar
  harder for no reason.
- **Licence** Apache-2.0 (HF card and Ollama licence).
- **Trainable:** Unsloth 2026.10.7 + transformers 5.17 support Qwen3.5 natively. Unsloth vendors fla, so the Gated
  DeltaNet layers train with its kernels.
  - Unsloth's guide says "It is not recommended to do QLoRA (4-bit) training on the Qwen3.5 models", and bf16 LoRA on
    9B needs ~22 GB, which does not fit beside ethan-gpu's 6 GB. So the run used **8-bit LoRA**: fit test 12.4 GiB peak,
    ~680 tok/s, grad-norm healthy.
- **Exportable:** llama.cpp df9beac7 converts it (arch QWEN35, text-only, 442 tensors). Q8_0 by `ollama create -q`.
- **Servable:**
  - The candidate's Modelfile copies the stock tag's `RENDERER qwen3.5`, `PARSER qwen3.5` and `PARAMETER`s, so it
    differs from qwen3.5:9b only in weights.
  - It is a drop-in for the qwen35-01 serving path, which canaried with **KEEP** at 06:10Z.
  - Its KV cache is ~1/4 of Qwen3-8B's: only 8 of its 32 layers are full attention. That removes the 5080 KV problem
    found at M3.
- **No-think render:** `enable_thinking=False` renders `<think>\n\n</think>\n\n`. On Ollama 0.33.2 (the Blackwell),
  `think` unset == think:false (qwen35-01 registration, 40/40). On the 3090's 0.32.14 an unset `think` thinks. So every
  model in the replay was served behind one think:false proxy.
- **Template check:** the served prompt counted exactly the trained render (2,629 tokens) for the candidate q8_0, the
  candidate bf16, the base through our converter, and stock qwen3.5:9b-q8_0. Both controls differed: think on = 2,627,
  and qwen2.5's template = 2,560.

## 4. Training (`runs/c2-01` on 10.0.0.16; `train/run_c2.sh`)

- **Setup:** Qwen3.5-9B (unsloth/Qwen3.5-9B @005429ce), 8-bit base, LoRA r 16 / alpha 32 / dropout 0.
- **Targets:** q/k/v/o in the 8 full-attention layers, in_proj_qkv/in_proj_z/out_proj in the 24 Gated DeltaNet layers,
  and gate/up/down everywhere. That is 40,108,032 trainable parameters, exactly the hand count, so every intended module
  got an adapter.
- **Schedule:** one epoch, 360 steps x grad-accum 16. 5,754 used; 14 were over 3,072 tokens and dropped. lr 1e-4 cosine,
  adamw_8bit, loss on the answer only.
- **Run:** 20,060 s (5.6 h) beside ethan-gpu, 760.6 tok/s, peak 12.4 GiB. Loss 1.52 -> 0.26. Grad-norm 360/360 finite
  and non-zero (0.65-12.9). Verdict OK.
- **Export check (owner A1):** greedy, q8_0 vs bf16 GGUF, same skill **591/600 = 98.5% (PASS >= 97%)**. The determinism
  ceiling (q8_0 replayed twice) was 600/600, and both are 100% schema-valid.
- **Merge check (review note):** the trained PEFT model's own greedy answers vs the bf16 GGUF agree on the skill 26/30
  and on skill + args 23/30. That is consistent with an 8-bit-base-plus-adapter vs bf16-merged numeric difference plus
  Ollama's grammar-constrained decoding (the HF probe was unconstrained). It is not a broken merge, which would sit near
  chance.

## 5. Replay: 600 items, same instrument and scorer as replay-cands-01 / blackwell-base-01

Setup: v0 m3-eval.jsonl (200 good / 300 non-transient failures / 100 post-veto), the fleet's own client, T=0,
concurrency 2, `eval_offline.py`. The 3090 ran Ollama with NUM_PARALLEL 2 behind a think:false proxy. Instrument
check OK: logged hard fires on 19.3% of failure items vs 3.5% of good items. All runs answered 600/600 with 0 transport
errors (`~/learnloop/c2/replay-c2-01/`).

| model (this session, one server) | schema-valid | hard | rep_fail (300) | post-veto repeat (100) | agree skill (200 good) | agree key |
|---|---|---|---|---|---|---|
| qwen2.5:7b-instruct (fleet) | 100.0 | 15.0 | 66.7 | 94.0 | 82.5 | 76.0 |
| **qwen3.5:9b** (stock, Q4_K_M = the qwen35-01 canary) | 100.0 | 3.0 | 25.3 | 54.0 | 54.5 | 43.5 |
| qwen3.5:9b-q8_0 (stock) | 100.0 | 1.7 | 20.3 | 33.0 | 47.0 | 39.0 |
| Qwen3.5-9B base through OUR converter, q8_0 | 100.0 | 1.5 | 18.0 | 36.0 | 47.5 | 37.5 |
| **candidate 2, q8_0 (would ship)** | **100.0** | **2.0** | **16.7** | **7.0** | 61.5 | 52.0 |
| candidate 2, bf16 | 100.0 | 1.7 | 16.3 | 7.0 | 62.0 | 52.0 |

Recorded references (other sessions): qwen3.5:9b on the Blackwell 26.7 / 53.0 / hard 2.0; qwen3.8:27b 14.7 / 21 / 2.2;
qwen3-8b no-think 28.3 / 54 / 3.8; candidate 1 (boot-01) 50.0 / 72 / 11.3; qwen2.5 67 / 95 / 14.2. This session's
qwen2.5 and qwen3.5:9b reproduce them within ~1.5 pp, so the instrument holds across hosts.

**Paired, candidate q8_0 vs each base.** Discordant items: the candidate repeats and the base does not, vs the reverse.
Exact sign test.

| vs | failure items | post-veto items |
|---|---|---|
| qwen3.5:9b (Q4) | 18 vs 44, p = 0.001 | 2 vs 49, p < 0.001 |
| qwen3.5:9b-q8_0 | 23 vs 34, p = 0.18 | 2 vs 28, p < 0.001 |
| base via our converter, q8_0 | 26 vs 30, p = 0.69 | 2 vs 31, p < 0.001 |

Hard counts out of 600: candidate 12, Q4 stock 18, Q8 stock 10, base-conv 9.

**Skill mix** (the degenerate-policy check; % of items):

| | good items | failure items | post-veto items |
|---|---|---|---|
| candidate q8_0 | gather 22, goto 19, explore 17, mine 13, surface 12.5 | **surface 53**, gather 13, goto 9, mine 9 | **surface 65**, goto 8, home 8, explore 8 |
| qwen3.5:9b-q8_0 | gather 29.5, explore 17, goto 15.5, deposit 12, surface 8.5 | surface 26, gather 24, goto 19, home 11 | goto 28, gather 20, home 16, explore 14, surface 9 |

Where the candidate chooses `surface`, the bot is below y=60 in 113 of 159 failure items and 48 of 65 post-veto items.
That is a plausible escape, but at surface level it is likely a no-op. The base models show the same ~70/30 split on far
fewer items.

**Latency** (3090, shared with ethan-gpu, NUM_PARALLEL 2; `c2host/lat_c2.sh`, the qwen35-01 open-loop test at 20/min,
300 items, 0 transport errors each):

| | closed loop (replay, conc 2) p50 / p95 | open loop 20/min p50 / p95 / p99 | completion p50 / p95 |
|---|---|---|---|
| candidate q8_0 | 4.1 / 4.7 s | 3.9 / 9.7 / 11.9 s | 41 / 51 |
| qwen3.5:9b-q8_0 | 5.5 / 6.2 s | 20.0 / 30.4 / 33.1 s | 57 / 82 |
| qwen3.5:9b (Q4) | 5.1 / 5.7 s | 9.6 / 23.3 / 27.6 s | 62 / 85 |

At 20/min the 3090 is saturated, so small service-time differences turn into large queueing differences. No model
meets the gates on this host. The Blackwell served qwen3.5:9b live at p50 1.44 s / p95 2.55 s (qwen35-01 +180 read).
The candidate's gate must be measured there.

## 6. Verdict vs the owner's bar

| owner bar (10-30) | vs qwen3.5:9b, this session | vs recorded 26.7 / 53 / 2.0 | vs qwen3.5:9b at Q8_0 (quant-matched) |
|---|---|---|---|
| rep_fail below | 16.7 < 25.3 PASS (p = 0.001) | PASS | 16.7 < 20.3, not significant (p = 0.18) |
| post-veto below | 7.0 < 54.0 PASS | PASS | 7.0 < 33.0 PASS (p < 0.001) |
| hard no worse | 2.0 <= 3.0 PASS | 2.0 <= 2.0 PASS (tie) | 2.0 > 1.7 **FAIL by 2 items of 600** |
| schema-valid >= 99% | 100 PASS | PASS | PASS |
| latency within gates | **open**: not measurable on the 3090; a release prerequisite on the Blackwell | | |

**Verdict: PASSES the bar as written (against qwen3.5:9b, the tag qwen35-01 canaried). It is NOT a failed candidate,
and the kill rule is not reached.** It is not a clean win, and I would not call it one:

1. **The training's own effect is mostly on post-veto.** Separated from conversion and quantisation by comparing with
   the base through the same converter at the same quant: post-veto 36 -> 7 (p < 0.001), rep_fail 18.0 -> 16.7 (not
   significant), hard 1.5 -> 2.0 (+3 items, not significant). Much of the gap to the stock canary tag is just Q8_0 vs
   Q4_K_M: stock Q8_0 alone moves 25.3 / 54 / 3.0 to 20.3 / 33 / 1.7.
2. **The post-veto gain is largely "surface instead of repeating".** Whether that raises or lowers output is invisible
   offline. It is exactly what a canary's items/bot-h measures.

**Recommendation:**
- Release `qwen35c2-01` only after its prerequisites (s.7), and read it on output: items_ratio_did and the live
  rep_fail/veto_repeat that modelread reports, plus the canary bots' live `surface` share.
- If the owner would rather separate quantisation from training first, the cheaper alternative is a canary of the
  STOCK qwen3.5:9b at Q8_0. That is the same entry shape with `OLLAMA_MODEL=qwen3.5:9b-q8_0`. Its offline numbers already
  beat the Q4 tag.

## 7. Queue entry (prepared, NOT launched)

- `qwen35c2-01`, class model-env, `after: ["qwen35-01"]`, draw_k 2, promotion none, no fallback. The own lines are
  identical to qwen35-01's: stall, model_share >= 0.95, schema gap <= 1 pp, p50 <= 2.5 s, p95 <= 5 s, completion p95
  <= 300. The env is `OLLAMA_MODEL=cand-qwen35-9b-c2-q8` on the Blackwell.
- Variant: empty-tree marker **840faa5b** on the fleet base aad2506a. Its tree is byte-identical to the base. Branch
  `qwen35c2-on-aad2506a`, pushed with `--no-verify` per CLAUDE.md (canary branch, remote absent first).
- Registration: `~/mcai-analysis/qwen35c2-01.840faa5b.json` on .31, with a copy in
  `docs/reports/qwen35c2-01-registration.840faa5b.json`.
- `canary-sched.py queue add` validated it and queued it at **position 84, the end**: behind townfloor-01's hold and the
  three parked entries. **HOLD** = owner decision first, then:
  1. put the candidate on the Blackwell Ollama and record its digest (from .16 `runs/c2-01/cand-qwen35-9b-c2-bf16.gguf`
     + its Modelfile, quantised q8_0);
  2. `SERVED_THINK=unset URL=http://ai.ticrcorp.com:11438 MODELS=cand-qwen35-9b-c2-q8 bash ~/learnloop-train/run_c2.sh
     template-check` must PASS (think unset == the trained render on THAT server);
  3. the Blackwell capacity test at 20/min passes p50 <= 2.5 s and p95 <= 5 s;
  4. if the fleet tip has moved, re-mark the variant on the new tip;
  5. move the entry to the head and run `queue release qwen35c2-01`.
- I did not upload anything to the Blackwell: it is a shared box, and the entry waits on the owner anyway.

## 8. Reviews (fun mode: one engine for blockers, plus an independent Claude read, as the task asked)

| round | Codex (`codex exec --sandbox read-only`, blockers only) | Claude (independent subagent, code only, no conclusions given) |
|---|---|---|
| r1 (builder, trainer, export, runners) | 2 blockers, both reproduced and fixed in 8ae87b16: (a) a post-veto item that itself failed could be relabelled with that same action; (b) missing provenance defaulted to local | 2 blockers, fixed in 8ae87b16: (a) the template check tested think:false while the canary serves think unset; (b) the Blackwell guard failed open on an unreadable scheduler and missed `launching` |
| r2 (delta) | all FIXED, no new blocker | -- |
| r3 (cap, pilot admission, eval, bar, latency) | 3 blockers, fixed in 59677ddd: (a) `--pilot` lacked its own split check; (b) the cap was not water-filling; (c) bar_c2 omitted eval_offline's instrument check. The built training set is byte-identical under the fixes, and the bar is unchanged | -- |

Tests: test_build_clean 12/12. Mutants, anchors asserted unique, all killed: no vetoed check, no logged check, no G2,
no unknown-source check, post-veto failure not checked, no cap. test_fleetstatus 66/0 + 12/12 mutants after the merge.
Learning-loop unit tests green.

## 9. Owner decisions needed

1. **Vendor terms.** Read Anthropic's and OpenAI's output-use terms before any paid-teacher label trains anything.
   Also decide whether the measurement use made here is fine (design s.2.4 questions i-iii).
2. ~~OpenAI credit~~ added by the owner 10-31; arm C ran ($4.97). Its labels are quarantined like Claude's
   (`~/learnloop/teacher-paid/C/` on the Mac).
3. **Candidate 2's canary.** Options: release `qwen35c2-01` after its prerequisites (s.7); run a stock qwen3.5:9b-q8_0
   canary first; or neither.
4. **Uploading the candidate to the Blackwell** (a shared box), which the canary prerequisite needs.
5. **The surface shift.** Accept it as something the canary judges, or ask for a candidate 2b with a tighter cap / more
   post-veto relabels. A 2b would be a third training round, which the kill rule's wording leaves to the owner.

## 10. Where things are

- **.31 `~/learnloop/c2/`:**
  - data: `data/v1/` (POOL-MANIFEST, relabel-pool, good, train-c2-01 + MANIFEST);
  - teacher labels: `labels-qwen3_8_27b-{pilot,pool,poolB}.jsonl`;
  - results: `replay-c2-01/` (scores.json, bar.json), `lat-c2-01/`, `pilot-qwen3_5_9b.jsonl`, `queue/qwen35c2-01.entry.json`.
- **.16 `~/learnloop-train/`:** `runs/c2-01/` (lora, merged-16bit, GGUF bf16 sha 870196b0..., metrics, peft_probe) and
  `runs/base-qwen35-9b/`. Ollama models on the 3090: `cand-qwen35-9b-c2-q8` (eb0a1779b6b7), `cand-qwen35-9b-c2-bf16`
  (ee7b881747ec), `qwen35-9b-baseconv-q8` (0183a2f2850d).
  - The 3090's Ollama is back as I found it: stopped and disabled, with its override at NUM_PARALLEL=2 (temporarily 1
    while the 27B teacher ran). No bot points at it: 80/80 environ checked at 06:00Z (70 on .72, 10 qwen35-01 canary
    bots on the Blackwell, 0 on .16). ethan-gpu was never touched.
- **Mac:** `~/learnloop/spend.jsonl` (ledger), `~/learnloop/teacher-paid/B/` (quarantined Claude answers),
  `~/learnloop/c2/pilot-agreement.json`.
- **Code:** `scripts/learnloop/build_clean.py`, `teacher/pilot_agreement.py`, `train/{train_sft.py, run_c2.sh,
  bar_c2.py, template_check.py, after_train_c2.sh}`, `c2host/{teach.sh, proxy*.py, blackwell_window.sh, arm_b.sh,
  eval_c2.sh, lat_c2.sh}`.
- One overlap to note: my teacher sent requests to the Blackwell from 23:31:48Z to ~23:37Z on 10-30, inside the
  qwen35-01 load test's first minutes. I stopped it, left a note in `~/qwen35-01/`, and moved the bulk work to the 3090.
  The later Blackwell window (00:38-02:15Z) ran under a fail-closed guard and ended before the canary was launched.
