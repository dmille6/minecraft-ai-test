# Token limits, card efficiency and model choice: tests and research (2026-11-22)

Sources: tests on our cards with **real showcase bot prompts from ELK**; model and serving research by Claude (with model cards opened)
and by Codex, each working independently. Builds on [ai-serving-2026-11-22](ai-serving-2026-11-22.md).

## 1. Token limits

**Prompt size (measured):** median **1,344–1,364 tokens**, p95 about 1,490, max 1,674. **A 4,096-token context per request is enough**, with room to spare.

**The answer-size problem was padded JSON, not a low limit.**
- The 8B model on vLLM wrote pretty-printed JSON with free whitespace and loose `args`. With `max_tokens` 120–192, **20–35% of answers were cut off**.
  Under a generous limit, the p95 answer still reached 512 tokens (runaway padding).
- **Fix:** compact JSON (vLLM `disable_any_whitespace`) plus a short `reason` (`maxLength` 80) and tight `args`
  (at most 4 properties, short string or integer values). The result was **0 of 96 cut off, 96 of 96 valid**, and the average answer dropped from **about 97 to about 32 tokens**.
- llama.cpp's grammar output for the 4B model was already compact: about 45 tokens on average, 2–8% cut off at 64–192.

**Settings adopted for the executive:** compact JSON (no free whitespace) · `reason` maxLength 80 · tight `args` schema · **`max_tokens` 96**
(about 3× the typical answer; Codex suggests up to 256 as a safety ceiling, which costs nothing when answers are short) · thinking **off** ·
**4,096-token context per request**.

## 2. Card efficiency

All runs below use the same prompts, the compact schema and `max_tokens` 96. Cells are 24–96 requests each, so read the shape, not exact numbers.

| Setup | 1 at a time | 4 parallel | 8 parallel | 16 parallel | VRAM |
|---|---|---|---|---|---|
| **5080 llama.cpp, Qwen3-8B Q4_K_M, 8 slots, q8 KV cache** | **0.68 s** · 86/min | **1.43 s · 160/min** | 2.6 s · **175/min** | 5.3 s · 173/min | **7.4 GB** |
| 5080 llama.cpp, same, 8 slots, f16 KV cache | 0.67 s | 1.53 s | 2.8 s · 171/min | 5.7 s · 164/min | 9.5 GB |
| 5080 llama.cpp, same, 4 slots, f16 | 0.70 s | 1.39 s | 3.5 s · 133/min | 6.9 s · 134/min | 7.2 GB |
| 5080 llama.cpp, same, 16 slots, q8 | 0.69 s | 1.56 s | 4.1 s · 125/min | 4.6 s · 193/min | 10.0 GB |
| **3090 vLLM, Qwen3-8B-AWQ (shared with Ethan)** | 0.76 s · 78/min | 2.0 s · 122/min | 2.6 s · **174/min** | 6.1 s · 156/min | 10 GB share |

**What this shows**
- **Both cards top out at about 170–190 decisions a minute** with an 8B model. That is far more than 4–6 bots need: at one decision per bot every
  2–3 seconds, that is 120–180 a minute at the very most.
- **Eight parallel requests is the sweet spot.** More only adds waiting time.
- **Use a q8 KV cache on llama.cpp:** the same speed in 2 GB less VRAM.
- **The 3090's numbers move run to run** (4 parallel: 255/min in the first run, 122/min in this one) because Ethan's work shares the card's compute. A fixed memory
  share does not isolate compute (Codex makes the same point).
- **vLLM did not run on the 5080.** On Blackwell (sm_120) it needs a full CUDA toolkit to compile FlashInfer kernels. The pip `nvcc` plus `ninja` still
  failed (`#error "CUDA compil…`). It would work with the official NVIDIA CUDA 13 toolkit on the host or in a CUDA container. **Not worth it for now:**
  llama.cpp on the 5080 matches vLLM on the 3090.

**Changes made**
- 3090 vLLM: compact JSON on, `--max-num-seqs 8` (compose file under `infra/ai-serving/`).
- 5080: back to `servea` (Qwen3.5-4B q8, 6 slots) for the gateway. The Qwen3-8B GGUF and the vLLM venv are kept in `/root/mcai-bench` for later tests.

## 3. Models (Claude and Codex agree)

All candidates are **Apache-2.0** (licence files must be kept when redistributing). Vendor scores only screen candidates; **our own evaluation decides.**

| Role | Candidates | Notes |
|---|---|---|
| **Executive** | **Qwen3.5-9B** (BFCL-V4 66.1, TAU2 79.1) · **Qwen3.5-4B** (50.3 / 79.9; current) · **Granite 4.2 8B** (Aug 2026; about 52.4; official GGUF, FP8 and MLX builds) · **Gemma 4 12B** (TAU2 69) · Gemma 4 E4B (12 GB / Mac fallback) · **Qwen3-8B-AWQ** as the control | Qwen3.5 has built-in multi-token prediction heads (speculative decoding to test later) |
| **Planner (24 GB / Mac)** | **Qwen3.8-27B** (Aug 2026, official FP8, MLX builds) · Granite 4.2 30B | Too big for 16 GB once caches are counted |
| **Planner (16 GB)** | Qwen3.5-35B-A3B · Gemma 4 26B-A4B (mixture of experts, about 3–4B active) | Q4 is about 20 GB, so tight. Same model in both roles is the default |
| **Mac teacher / judge** | Qwen3.5-122B-A10B (about 61 GB at 4-bit) · Qwen3.8-27B at 8-bit | Dev only |

Excluded: NVIDIA's models and Qwen3.8-Flash-Next (licence "other"), Llama (licence), and anything far bigger than 128 GB. The Berkeley leaderboard has not been
updated since 2026-04 and lists none of the 2026 families.

## 4. The approach

**Release (one machine, one GPU, novice):**
- **Pinned llama.cpp server** with a checksummed GGUF. A launcher picks CUDA or Metal. Ollama is an optional path.
- **One resident model for both roles:** thinking off for the executive, on (with a budget) for the planner. Planner work runs only when there is spare capacity.
- **16 GB profile:** an 8–9B model at Q4_K_M, or the 4B at Q8; **8 slots × 4,096 tokens, q8 KV cache**.
- **12 GB profile:** the 4B at Q5_K_M, 2–4 slots.
- **Mac profile:** the same GGUF on Metal. To be measured on the Studio this week.
- Keep **one outstanding decision per bot**, drop stale observations and stagger bots. Static instructions and the schema go first, the bot's state last, so the prefix cache is reused.

**Development:**
- **3090:** vLLM as the throughput baseline.
- **5080:** llama.cpp, the release stack, used for model screening.
- **Mac Studio:** judge, planner tryouts and Apple Silicon tests.
- Everything goes through the LiteLLM gateway.

**Evaluation plan:**
- A frozen replay set from the logs, split by world and session.
- Score validity and truncation, argument grounding (does the target or item exist), acceptable skill choice (several acceptable answers allowed), and latency under realistic arrivals.
- **300–500 cases to drop weak models, about 2,000 paired cases for the finalists** (detecting a 3-point gain at 20% disagreement needs about 1,750 pairs).
- A judge model only proposes labels; ambiguous ones are checked by hand. The decision is then confirmed by **paired live runs** from matched world snapshots.

## 5. Next (the Studio week)
1. Export the replay set from ELK (VM 109 is running).
2. Studio: install llama.cpp, MLX-LM and the judge models; label the set (two judges must agree).
3. Screen the executive candidates on the 5080 with llama.cpp at the adopted settings: validity, grounding, agreement, latency.
4. Planner tryouts and Apple Silicon numbers on the Studio.
5. Pick the release model and profile.
