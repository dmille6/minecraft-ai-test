# Learning loop M3 on the 3090: fit, dry round, export, rung (a) (2026-10-24)

Design: `docs/reports/learning-loop-design-2026-10-21.md` s.3.2, s.4(a), s.7 (M3). Tooling: branch `learnloop-m1-m3`
(af9fbd90, both engines APPROVE r6) plus this branch, `learnloop-m3-run`. Authority: the owner's 10-21 answers (a-h,
"share the GPU"). Nothing here touched 10.0.0.72, a bot env file, a unit, the queue, the scheduler, the manifest or a
world. No frontier API was called. Everything heavy ran on VM 200 (10.0.0.16); dataset work ran on 10.0.0.31 at
nice 19 / ionice idle; the Mac ran nothing but ssh.

## 1. VM 200 state (read 09:16Z, read-only)

- Ubuntu 24.04, 8 vCPU, 31 GB RAM (21 GB available: ethan-gpu holds 9.3 GB RSS), 361 GB free disk.
- RTX 3090 24 GB, driver 595.91 / CUDA 13.2. **ethan-gpu**: `llama-ethan.service` (its own systemd unit and cgroup),
  Qwen3.5-4B on :1234, 6,056 MiB. Never touched; stopping `ollama.service` cannot reach it. It was busy during the
  runs (79-100% GPU), so every speed figure below is "beside ethan-gpu".
- Ollama 0.32.14, `NUM_PARALLEL=16`, `KEEP_ALIVE=-1`, `MAX_LOADED_MODELS=1`, `CONTEXT_LENGTH=8192`, nothing resident.
- **Fleet traffic on .16: none.** The ollama journal held 2 `[GIN]` requests in 24 h, both mine (positive control:
  it saw them). This agrees with the drop16 +24 h verify (152,902 rows on .72, 0 on .16).
- venv `~/learnloop-train/venv` as staged 10-22 (torch 2.14.1+cu130, unsloth 2026.10.7, transformers 5.17.0, trl
  1.15.0, peft 0.21.2, bitsandbytes 0.50.2); `unsloth/Qwen3-8B` cached; `unsloth/Qwen2.5-7B-Instruct` downloaded 10-24.

**Blocker found and fixed in place: no C compiler.** Triton builds its launcher stubs with `cc`; VM 200 has no gcc,
so the first fit test died at step 0 (`Failed to find C compiler`). Fixed without touching the system: the `ziglang`
wheel in the venv plus the Python 3.12 headers extracted with `dpkg -x` (not installed) from Ubuntu's own
`libpython3.12-dev 3.12.3-1ubuntu0.17` into `~/learnloop-train/sysroot`, wrapped as `~/learnloop-train/bin/cc`.
`run.sh` exports `CC` and refuses without it. Control: a Triton kernel built with it and failed without it.

## 2. Training set

Source: dataset v0 (immutable, 10-08..10-21; held-out worlds board-a, placebo-d, isolated-c; newest 2 days held out).

- **Label (L1, from evidence):** good = executed `success` AND (own value `valuable` OR the skill's own bag gained items
  OR a milestone within 120 s) AND no death within 600 s AND the 600 s window observed.
- **Deduplicated** in v0: exact prompt+action duplicates dropped, near-duplicates capped at k = 3 per (bot, near-key,
  action). v0 TRAIN good: 335,189 kept.
- **Bootstrap set** `v0-boot-40000` (`select_bootstrap.py`, seed 3592996891894273659, sha256 107c1f87...): 40,000
  of them, sqrt-by-skill (the dry round's rule): gather 10,341, explore 9,492, mine 7,857, goto 6,683, craft 1,713,
  deposit 1,603, surface 1,031, smelt 619, place 534, home 76, withdraw 36, board 15.
- Audit of the 40,000: 100% `success`, 100% observed, 0 deaths in 600 s; evidence: value valuable 88.3%, own bag
  gain 52.4%, milestone in 120 s 23.8%, moved >= 2 blocks 80.6%. 13 training worlds, 12 older days, **0 held-out
  worlds, 0 overlap with the eval set**, 100% `fleet:qwen2.5:7b-instruct`.
- Lineage (s.3.4): 0% of the Qwen3 arm's examples are its own (qwen2.5 is not its lineage); the qwen2.5 control is
  100% own outputs, the design's named exception (offline control only, never served).
- 3 of 40,000 are over 3,072 tokens and are dropped by the trainer (39,997 used).

## 3. Fit and speed test (50 optimizer steps, seq 3,072, beside ethan-gpu)

| measure | value |
|---|---|
| peak VRAM (`max_memory_allocated` / reserved) | **8.12 / 8.18 GiB** -- fits with ~10 GB spare beside ethan-gpu's 6 GB |
| tok/s (45 timed steps x 10 sequences, mean 2,573 tokens) | **954.5** (the design planned 235-400) |
| grad-norm | 50 of 50 finite and non-zero, min 0.334, max 6.50 |
| loss | 1.91 -> 0.24 |

Verdict OK. The bootstrap round then ran at ~38 s per 16-sequence step (~1,080 tok/s).

## 4. Dry round (the approved 2,000-example subset; pipeline proof)

`cand-qwen3-8b-v0-dry`: 2,000 examples, 0 dropped, one epoch (200 steps x 10), 5,424 s, 952 tok/s, peak 8.12 GiB,
grad-norm 200/200 finite non-zero, loss 1.91 -> 0.17. Merged 16-bit, converted (llama.cpp df9beac7), quantized by
Ollama (`ollama create -q`; VM 200 cannot build `llama-quantize` without a compiler toolchain and Ollama uses the same
llama.cpp quantizer).

### 4.1 The template check failed first, as it should

The served prompt was **2,560** tokens where training rendered **2,564**. Raw prompts counted 2,564 / 2,560 in Ollama
(the tokenizers agree); `/api/chat` gave 2,560 with `think` unset or true and 2,564 only with `think: false`. **The
fleet's client sends no `think` field** (`bots/src/llm.mjs` at d014ec2c), so a Qwen3 candidate would have been served
the thinking prompt it was never trained on, whatever the Modelfile TEMPLATE said. Ollama marks the GGUF
`thinking`-capable from its own metadata (a template with no think text was still marked so).

Fix (`nothink_template.py`, in `run.sh export`): the GGUF's chat template gets the trained no-think tail
unconditionally, and refuses unless that renders exactly the `enable_thinking=False` training render. The untuned
base is built the same way (`run.sh export-base`), so base and candidate differ only in weights. After the fix: 3 of
3 items equal for `think` unset / false / true on the q4 candidate, the bf16 candidate and the base; the stock
`qwen3:8b` control differs on every item. `template_check.py --think-variants` now gates all three.

### 4.2 Rung (a), dry candidate (600 cell-C items: 200 good, 300 non-transient failures, 100 post-veto)

Fleet client, fleet settings (8,192 ctx, 512 tokens, temperature 0.7), concurrency 2, 600 of 600 answered by every
model, 0 transport errors. Reference = qwen2.5:7b-instruct replayed (s.4a).

| model | schema-valid | retry | hard | bad | rep_fail | post-veto repeat | agree skill | agree key |
|---|---|---|---|---|---|---|---|---|
| logged (instrument) | 100.0 | 0.0 | 13.2 | 13.2 | 100 (by construction) | 90.0 | 100 | 100 |
| qwen2.5:7b-instruct (ref) | 100.0 | 0.0 | 13.5 | 13.5 | 61.0 | 94.0 | 80.5 | 73.5 |
| Qwen3-8B untuned (no-think) | 85.3 | 18.7 | 4.7 | 19.3 | 33.3 | 49.0 | 42.0 | 40.5 |
| dry candidate, q4_K_M | 99.7 | 0.3 | 6.7 | 7.0 | 40.0 | 66.0 | 52.0 | 47.5 |
| dry candidate, bf16 | 100.0 | 0.7 | 8.3 | 8.3 | 42.0 | 65.0 | 55.0 | 48.5 |

- Instrument check OK: hard fires on 19.3% of logged failure items vs 3.5% of good items.
- Gates vs the reference: **dry q4 PASS** (99.7 >= 99.5; 6.7 <= 13.5; 40.0 <= 61.0). Untuned Qwen3 FAILS
  schema-valid (85.3%: 200 sentinel failures in the client log). Training fixes the format.
- **Post-veto test: NOT SCORED.** The design requires qwen2.5 to reproduce its sandbox rate (29-59%) first. On these
  100 items qwen2.5 repeats the vetoed action 94% by `score.key_of` (skill + key argument) and 67% by exact args; the
  logged actions 90% / 71%. Both are above the band, so the control fails and no candidate post-veto number is a
  result. (The dataset recorded 58.6% exact-args over the 13,408-item pool; 71% on this 100-item draw.)

### 4.3 Export check

| comparison (600 items) | same skill | schema-valid | verdict (>= 97%) |
|---|---|---|---|
| as specified, T=0.7: q4 vs bf16 | 392/598 = **65.6%** | 99.7 vs 100.0 | FAIL |
| control: q4 T=0.7 vs q4 T=0.7 rerun (same weights) | 398/597 = 66.7% | 99.7 vs 99.8 | - |
| greedy, T=0: **q4_K_M vs bf16** | 527/600 = **87.8%** | 100.0 vs 100.0 | **FAIL** |
| greedy, T=0: **q8_0 vs bf16** | 583/600 = **97.2%** | 100.0 vs 100.0 | **PASS** |
| control: q4 T=0 vs q4 T=0 rerun (determinism) | 580/600 = 96.7% | 100.0 vs 100.0 | ceiling |

- At the fleet's temperature the gate cannot be met by any export (the same weights agree 66.7% with themselves), so
  the check is run greedy (`export_check.sh`, `LLM_TEMPERATURE=0`, everything else the fleet client).
- Ollama at NUM_PARALLEL 2 is not bit-deterministic: the instrument's ceiling is ~96.7%, just under the gate.
- Against that ceiling, **q4_K_M loses ~9 pp of skill choice; q8_0 is at the ceiling.** The bf16 model ran with
  1.6 of 18.1 GB on the CPU (beside ethan-gpu), which can only add noise, not remove it.

## 5. Bootstrap round (40k)

RUNNING. Results are filled in when the runs finish.

- **Qwen3-8B `boot-01`** (`cand-qwen3-8b-v0-boot`): started 10-24 17:51Z, `v0-boot-40000`, 39,997 used, one epoch =
  2,500 steps x grad-accum 16, checkpoints every 100 steps (`SAVE=100`, resumable with `RESUME=1`). 20:23Z: step 206,
  ~44 s/step beside ethan-gpu (~940 tok/s), checkpoint-200 saved. Steps 1-100: loss 1.46 -> 0.19, grad-norm
  0.36-6.72, all finite. ETA ~10-26 00:30Z.
- **qwen2.5-7B control `boot-qwen25-01`** (`cand-qwen25-7b-v0-boot`): queued on VM 200 by `chain-qwen25.sh`, which
  starts only after boot-01 ends with verdict OK and a merged model (and Ollama stopped): its own 50-step fit test
  (`fit-qwen25`), then the same 40k set, same recipe. ~28 h.
- Then per arm: `export` (+ `export-base` for Qwen3), `template-check`, `eval.sh` (rung a, fleet settings),
  `export_check.sh` (q8_0 -- owner A1 -- and q4_K_M vs bf16, greedy, with the determinism control), the rung (a)
  serving test (owner A2, s.6.2). Rung (a) scores the Q8_0 artifact.

## 6. Owner amendments (OWNER 10-24, "both yes")

### 6.1 A1: export at Q8_0, not Q4_K_M (amends design s.3.2 "Export to Ollama", step 3)

- **Step 3 is now `ollama create -q q8_0`** (Ollama's bundled llama.cpp quantizer, from the bf16 GGUF). Q4_K_M is
  still built and reported, but it is no longer the candidate that is served or scored.
- **The export check is unchanged in its gate and changed in its method, as run in s.4.3.** Every model replays
  greedy (`LLM_TEMPERATURE=0`, otherwise the fleet's client). Q8_0 vs the merged bf16 must choose the same skill on
  >= 97% of the 600 items both answer schema-valid, with complete coverage, and Q8_0's schema-valid share must not
  be below bf16's. The determinism control (the same quant replayed twice) is printed beside every verdict, with
  `ceiling_below_gate` when the control itself cannot reach 97% (`export_check.sh`, `export_summary.py`).
- Why: on the dry round, greedy q4_K_M vs bf16 gave 87.8% (FAIL) and q8_0 vs bf16 gave 97.2% (PASS), against a
  determinism ceiling of 96.7%.
- Cost: weights 8.7 GB instead of 5.0 GB. Rung (a) and everything after it score the Q8_0 artifact.

### 6.2 A2: serving is chosen by the 16-stream serving test (amends design s.4(a) "Serving test")

**Rule.** The rung (a) serving test picks the CHEAPEST combination that holds today's fleet latency gates on the
3090: **p50 <= 2.5 s, p95 <= 5 s, p99 <= 10 s** per decision (the same gates as drop16.sh's verify). The record must
name the combination chosen and why. Nothing changes on 10.0.0.72; that serving change is the operator's at M7.

**Why it is needed (arithmetic).** Qwen3-8B's KV cache is ~144 KiB/token (36 layers x 8 KV heads x 128 x K+V x 2 B),
against qwen2.5-7B's ~56 KiB (28 x 4). At the fleet's 16 slots x 8,192 ctx that is ~18 GiB of fp16 KV for Qwen3-8B
vs ~7 GiB for qwen2.5, which does not fit the 16 GB 5080 at any weight quantization.

**Do the bots' real prompts fit a smaller context? Yes, for 4,096.** Measured on 10-23 (146,829 model decisions,
5 code versions, 0 rows without token counts):

| | p50 | p95 | p99 | p99.9 | max |
|---|---|---|---|---|---|
| prompt tokens | 2,514 | 2,722 | 2,800 | 2,896 | 2,998 |
| completion tokens | 58 | 89 | 103 | - | 125 |
| prompt + completion | - | - | - | 2,969 | 3,070 |

0 of 146,829 exceeded 3,072, so 0 exceeded 4,096. The client's reserve is `num_predict` 512, and the largest prompt
seen (2,998) + 512 = 3,510, which leaves 586 tokens of headroom under 4,096. Any context below 3,584 is ruled out.
Counts are qwen2.5's tokenizer; Qwen3's matched it on every item the template check counted. **A smaller context
is a BOT env change** (`OLLAMA_NUM_CTX=8192` in all 80 env files; the client sends `num_ctx` on every request), so
it costs an 80-file env transaction at M7. The KV type and slot count are server-only.

**Candidates, cheapest first** (16 slots unless stated; KV for Qwen3-8B; weights Q8_0 8.7 GB):

| # | combination | KV | change at M7 | quality risk |
|---|---|---|---|---|
| 1 | `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0`, ctx 8,192 | ~9 GiB | server env only | q8 KV: small; re-scored |
| 2 | ctx 4,096, fp16 KV | ~9 GiB | 80 bot env files | none (no prompt exceeds 3,070 + reserve) |
| 3 | ctx 4,096 + q8_0 KV | ~4.5 GiB | both | as 1 |
| 4 | fewer slots (12, then 8) at the cheapest fitting KV/ctx | scales | server env only | none; latency is the risk |

- The order is by change cost, then by risk: a server-only change before an 80-file bot env change, and slots last
  because they trade directly against latency.
- **Test.** Ollama on the 3090 at each combination, 16 concurrent streams of real, varied prompts (the 600 cell-C
  items cycled, never one prompt repeated, per memory `decision-cadence-formula`), through the fleet's client.
  Read decide() latency p50/p95/p99, `/api/ps` `size_vram` = size (no CPU offload), and load_duration p95 < 1 s.
- The first combination, in order, that holds all three gates with the model fully on the GPU is chosen.
- A combination that changes KV precision must also re-pass rung (a)'s schema-valid / hard / rep_fail gates at
  that setting before it is chosen.
- **3090 caveat:** ethan-gpu holds 6 GB, leaving ~17.5 GB. A combination that fits the 3090 but would not fit the
  5080 beside the honeypot is recorded as such; the operator reads .72's free VRAM, no agent does.
- Result: PENDING (runs with the bootstrap candidates).
