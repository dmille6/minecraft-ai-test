# Local model choice for 4-8 bots + overseer + stuck escalation (M4 Max 128 GB): Claude's independent web research, 2026-10-05

> **Where this file came from.** The original scratchpad copy was lost when the Mac mini rebooted on 10-06 at about
> 20:06Z. This file restores it from the session record. It is the counterpart of Codex's research in
> `docs/reports/model-research-codex-2026-10-05.md`.
> - The URLs are the ones the research agent cited. **[UNVERIFIED]** marks what it could not confirm.
> - The benchmarks are mostly vendor-reported. None of them measures Minecraft action selection.

## Five findings that changed the plan

1. **Ollama does not batch Qwen3.5/3.6/3.8 or Nemotron-H.**
   - `server/sched.go` forces `numParallel = 1` for qwen35, qwen35moe, qwen3next, nemotron_h(_moe), lfm2*, mllama
     and qwen3vl*, and logs "model architecture does not currently support parallel requests".
   - PR #17144, which would lift this for qwen35/qwen35moe, is open and validated on CUDA only
     (https://github.com/ollama/ollama/pull/17144).
   - The MLX runner serialises every model (https://github.com/ollama/ollama/issues/17666, /17280).
   - *Confirmed on the Studio:* the log line appears for these models, and Ollama measured effectively serial even
     for other architectures.
2. **Ollama 0.35 (2026-09-28) added "decision models".** It has a `/v1/systemone` endpoint, with Nimble 9B,
   tev1, Clef / Clef-Flash. The model chooses among options and returns a probability for each, but generates no
   arguments. (https://github.com/ollama/ollama/releases)
3. **Ollama 0.34.4** applies structured output on thinking models in a single pass and speeds up Qwen3.8 prompt
   processing. *On the Studio, after the upgrade to 0.35.1, this made gpt-oss with a grammar WORSE as a brain;
   see the report.*
4. **On Artificial Analysis's index, Qwen3.8-27B (xhigh) scores 34.** That compares with 16 for
   Qwen3.5-122B-A10B and 12 for gpt-oss-120b (high). With reasoning off it scores 20, against 18 for Qwen3.6-35B-A3B
   with reasoning on.
   (https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-vs-qwen3-5-122b-a10b)
5. **LM Studio's MLX engine v1.11.0 had open bugs** on concurrent requests invalidating the KV cache
   (lmstudio-bug-tracker #2320) and on the thinking toggle (#2274). *On the Studio (LM Studio 1.1.7, 10-05/06),
   thinking OFF worked for Qwen3.6 MLX, and parallel requests gave about 1.7x Ollama's throughput.*

## Candidates (April-October 2026) and evidence

- **Qwen3.6-35B-A3B** (Apr 2026, 35B / 3B active, Apache-2.0).
  - Its card gives SWE-V 73.4 and Terminal-Bench 2.0 51.5, but no BFCL or tau2 figures.
  - Its predecessor, Qwen3.5-35B-A3B, scores BFCL-V4 67.3 / TAU2 81.2 / IFEval 91.9.
- **Nemotron 3.5 Lightning 30B-A3B** (2026-08-11): behind Qwen3.6 on GPQA, SWE-V and Terminal-Bench; ahead on
  IFBench (71.9 vs 63.7).
- **Gemma 4 26B-A4B** (2026-04-02, 25.2B / 3.8B active).
  - Tau2 average 68.2; the 31B scores 76.9.
  - Ollama bugs: tool-call parser issues; JSON-schema `format` not enforced under `think:true` (#18774).
- **Gemma 4 12B** (2026-06-03): tau2 average 69.0.
- **Granite 4.2 8B/30B** (2026-08-25): the 30B scores BFCL v4 61.4 and τ³ 62.0.
- **Muse Glimmer 30B** (Meta, 2026-08-10).
- **Ollama decision models:** Nimble 9B, Clef-Flash 9B, Clef 27B.
- **Qwen3.8-27B** (2026-08-14, dense, MTP).
  - IFBench 79.5; Terminal-Bench 2.1 73.0.
  - Reasoning effort: low / medium / xhigh (xhigh is the default).
  - Ollama: `think:"high"` silently runs at medium (#18632).
- **gpt-oss-120b** (Aug 2025, 117B / ~5B active, MXFP4 65 GB): tau-bench retail 49.4 / 62.0 / 67.8 at
  low / medium / high.
- **Qwen3.5-122B-A10B** (Feb 2026): BFCL-V4 72.2, TAU2 79.5, IFEval 93.4.
- **Also considered:**
  - Laguna S 2.1 (118B / 8B active);
  - Qwen3.8-Flash-Next (105 GB minimum, so it cannot sit next to anything else);
  - Mistral Small 4 (119B / 6B active);
  - Nemotron 3 Super (120B / 12B active).
- **Too big for this machine:** GLM-5.x, DeepSeek-V4.1-Flash, Kimi K3.

## Minecraft and game-agent evidence (thin, mostly older models)

- **MineCollab / Mindcraft (2025):** Llama-3.3-70B scored well below Claude 3.5 Sonnet, and an 8B SFT model beat
  the 70B on crafting (https://arxiv.org/html/2504.17950v1).
- **Orak (2025):** open models scored 0 on Minecraft with free-form Mineflayer code (https://arxiv.org/html/2506.03610).
- **BALROG:** Qwen2.5-7B 7.8%, Qwen2.5-72B 16.2%, Llama-3.3-70B 23.0%, DeepSeek-R1 34.9% (https://balrogai.com/).
- **MineExplorer (2026):** "larger models or thinking modes do not consistently translate into better
  performance"; agents fail when hidden prerequisites must be coordinated (https://arxiv.org/abs/2605.30931).
- No 2026 Mindcraft comparison of these models was found.

## M4 Max throughput

Community oMLX measurements: M4 Max 40-core, 4k context. "PP" is prompt processing, "TG" is generation, both in
tok/s.

| model | PP | TG |
|---|---|---|
| Qwen3.6-35B-A3B 4-bit | 2,005 | 136 |
| Nemotron Lightning 4-bit | 1,556 | 111 |
| Gemma-4-26B-A4B 8-bit | 1,488 | 78 |
| gpt-oss-20b | 1,548 | 117 |
| Qwen3.5-9B | 975 | 89 |
| Qwen3.8-27B 4-bit | 274 | 29 |
| Muse Glimmer 30B | ~218 | ~30 |
| gpt-oss-120b MXFP4-Q8 | 840 | 70 |
| Qwen3.5-122B 4-bit | 647 | 56 |

Measured on the Studio: see `docs/reports/model-selection-2026-10-05.md`.

## Shortlist this research proposed

| role | models |
|---|---|
| bot | qwen3.6:35b-a3b (think:false); nemotron-3.5-lightning:30b-a3b; gemma4:26b / gemma4:12b (think:false only); decision models (needs 0.35) |
| overseer / escalation | qwen3.8:27b (low/medium; xhigh for escalation); gpt-oss:120b; qwen3.5:122b; granite4.2:30b or muse-glimmer:30b as an optional |

The recommended pair was Qwen3.6-35B-A3B for the bots and Qwen3.8-27B for the overseer. **The Studio benchmark
overturned both:**
- gemma4:26b won the brain role;
- qwen3.8:27b with thinking is too slow to share the GPU with 8 bots;
- gpt-oss:120b at medium won the overseer and escalation roles.
