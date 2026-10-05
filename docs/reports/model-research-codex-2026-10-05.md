# Local Minecraft brains on M4 Max 128 GB

**Research cutoff: October 5, 2026.** This was read-only research; no files, models, settings, or services were changed.

**My recommendation:** first benchmark **Qwen3.6-35B-A3B** and **Nemotron-3.5-Lightning-30B-A3B** as the frequent-action brain, with **Qwen3.8-27B** as a potentially stronger but slower alternative. For overseer and escalation, compare **Qwen3.5-122B-A10B**, **gpt-oss-120b**, and **Nemotron-3-Super-120B-A12B** against the winning smaller model. Include **Gemma 4 26B-A4B** for a different model family and your existing **Hermes-4.3-36B Q6_K** as a control.

That is a **benchmark recommendation, not an established quality ranking**. I found useful tool-use evaluations and Apple Silicon measurements, but no credible current comparison showing which of these models best controls Mineflayer under your action schema.

## 1. What matters for this workload

Your workload is unusually **prompt-heavy and answer-light**. With approximately 2,600 input tokens and 60 output tokens, uncached prompt processing can dominate latency. Published measurements illustrate the distinction: Qwen3.8-27B processes roughly 260 prompt tokens/s in one matched M4 Max submission, versus roughly 800 for Qwen3.6-35B-A3B and 1,500 for Nemotron Lightning in other submissions. These are different quantizations and runtime versions, not a controlled comparison. [Qwen3.8 measurement](https://omlx.ai/benchmarks/performance/bcuo5v6o), [Qwen3.6 measurement](https://omlx.ai/benchmarks/performance/340fvjlv), [Lightning measurement](https://omlx.ai/benchmarks/performance/axepaxw4)

My proposed division of responsibility:

| Role | Initial candidates | Selection criterion |
|---|---|---|
| Per-bot action selection | Qwen3.6, Lightning, Qwen3.8, Gemma 4 | Feasible actions and sustained progress within a predictable latency budget |
| Town/world overseer | Qwen3.5-122B, gpt-oss-120b, Nemotron Super; also test Qwen3.8 | Correct priorities, dependency ordering, resource allocation, and avoiding contradictory assignments |
| Stuck escalation | Same overseer candidates | Diagnose failure from evidence and propose a materially different, executable recovery |

**Do not assume a larger model wins every role.** Even Qwen’s own published table has the smaller Qwen3.5-35B-A3B ahead of its 122B sibling on one agentic evaluation, while trailing on another. Those evaluations also use different environments and reasoning budgets from yours. [Qwen3.5 model card and evaluation table](https://huggingface.co/Qwen/Qwen3.5-122B-A10B)

Your supplied statistics also deserve a denominator check before benchmarking: 79,006 decisions over 12 hours is **109.7 decisions/minute**, versus 80/minute implied by 80 bots making one decision per minute. The reported outcome percentages total 96%. These are calculations from your figures; retries or additional decision types may explain the differences.

## 2. Eight models worth benchmarking

“Already installed” below comes from your inventory. Sizes are **downloaded weight artifacts**, not guaranteed resident memory. Context limits are advertised/configured limits, not evidence of reliable planning throughout that context.

The approximate six-month window starts in early April. I distinguish recent candidates from older controls instead of treating a newly uploaded quantization or edited README as a new base model.

| Model and freshness | Why benchmark it | Context and thinking | Exact download; weight footprint | Installed |
|---|---|---|---|---|
| **Qwen3.6-35B-A3B** — April generation | First per-bot candidate: 35B total/3B active, with native tool-use support and strong measured prefill | 262,144 native; approximately 1M extended. Test explicit thinking-off | Ollama **`qwen3.6:35b-a3b`**, current GGUF listing **23 GB**. MLX **`mlx-community/Qwen3.6-35B-A3B-6bit`**, **29.1 GB** | Yes, Ollama tag |
| **NVIDIA Nemotron-3.5-Lightning-30B-A3B** — August | Most interesting new fast challenger: 30B/3B active; training explicitly includes multi-step tools and structured output | Advertised 1M; thinking can be disabled through its template | HF **`unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF`**, **`UD-Q4_K_M`**, **25.3 GB** | Not listed |
| **Qwen3.8-27B** — August 14 | Dense quality challenger for workers and a relatively compact overseer | 262,144 native; extended context available. Thinking-off and reasoning-effort controls | Ollama **`qwen3.8:27b`**, **18 GB**. MLX **`mlx-community/Qwen3.8-27B-4bit`**, **16.1 GB** | Yes, Ollama tag |
| **Gemma 4 26B-A4B instruction-tuned** — recent July QAT variant | Cross-family MoE candidate; 26B/4B active and native function calling | 256K; template supports thinking on/off | **`mlx-community/gemma-4-26b-a4b-it-4bit`**, **15.3 GB**. Also test official **`google/gemma-4-26B-A4B-it-qat-q4_0-gguf`** | Not listed |
| **Qwen3.5-122B-A10B** — February, older control | First large overseer/escalation candidate; 122B/10B active | 262,144 native; approximately 1M extended | Ollama **`qwen3.5:122b-a10b`**; MLX **`mlx-community/Qwen3.5-122B-A10B-4bit`**, **69.6 GB** | Yes, Ollama tag |
| **gpt-oss-120b** — August 2025, older control | Already has your useful end-to-end measurement; 117B total/5.1B active | 131,072; low/medium/high reasoning, rather than assuming a universal thinking-off switch | Ollama **`gpt-oss:120b`**, native **MXFP4**, **65 GB** | Yes |
| **NVIDIA Nemotron-3-Super-120B-A12B** — March, just outside window | Different large-model family for planning and recovery; 120B/12B active | Advertised 1M; configurable thinking | **`mlx-community/NVIDIA-Nemotron-3-Super-120B-A12B-4bit`**, **68 GB** | Not listed |
| **Hermes-4.3-36B** — older control | Already resident; useful dense-model comparison with explicit JSON/function-calling training | Configuration permits 524,288 positions; effective long-context quality unverified here | **`NousResearch/Hermes-4.3-36B-GGUF`**, **Q6_K: 29.7 GB** | Yes, Q6_K |

Sources for the table:

- **Qwen3.6:** [model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), [Ollama artifact](https://ollama.com/library/qwen3.6:35b-a3b), [MLX 6-bit](https://huggingface.co/mlx-community/Qwen3.6-35B-A3B-6bit).
- **Lightning:** [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16), [GGUF files and sizes](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF/tree/main).
- **Qwen3.8:** [release README](https://github.com/QwenLM/Qwen3.8/blob/main/README.md), [model card](https://huggingface.co/Qwen/Qwen3.8-27B), [Ollama](https://ollama.com/library/qwen3.8:27b), [MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.8-27B-4bit).
- **Gemma:** [instruction model card](https://huggingface.co/google/gemma-4-26B-A4B-it), [MLX instruction variant](https://huggingface.co/mlx-community/gemma-4-26b-a4b-it-4bit), [official QAT GGUF](https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf).
- **Qwen3.5:** [model card](https://huggingface.co/Qwen/Qwen3.5-122B-A10B), [MLX 4-bit](https://huggingface.co/mlx-community/Qwen3.5-122B-A10B-4bit).
- **gpt-oss:** [official specifications](https://developers.openai.com/api/docs/models/gpt-oss-120b), [Ollama artifact](https://ollama.com/library/gpt-oss:120b), [original report](https://arxiv.org/abs/2508.10925).
- **Nemotron Super:** [model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16), [MLX 4-bit](https://huggingface.co/mlx-community/NVIDIA-Nemotron-3-Super-120B-A12B-4bit).
- **Hermes:** [model card](https://huggingface.co/NousResearch/Hermes-4.3-36B), [configuration](https://huggingface.co/NousResearch/Hermes-4.3-36B/blob/main/config.json), [GGUF sizes](https://huggingface.co/NousResearch/Hermes-4.3-36B-GGUF).

For Lightning, the exact HF-style Ollama reference to test is:

```text
hf.co/unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF:UD-Q4_K_M
```

The artifact exists; **I have not verified successful loading and tool parsing on your particular Ollama 0.33.x build**. [Artifact repository](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF)

### Quantization choices

My suggested first pass is **MLX 4-bit or GGUF Q4-class for the 120B models**, and **4-bit versus 6-bit/Q6 for worker finalists**. Add an 8-bit worker run as a quality reference where memory permits. Treat quantization as an experimental factor: the measured task-quality difference matters more than the label.

In particular:

- **MLX 4-bit, GGUF Q4_K_M, dynamic “UD” quantizations, and QAT Q4_0 are different artifacts.** Do not describe a cross-format result as “the same quantization.” The linked Gemma and Lightning repositories expose materially different variants and sizes. [Gemma QAT](https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf), [Lightning files](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF/tree/main)
- Preserve **gpt-oss’s native MXFP4** for the initial comparison. Its MoE weights were trained for that representation; implementation/conversion correctness warrants separate validation. [OpenAI implementation-verification guidance](https://developers.openai.com/cookbook/articles/gpt-oss/verifying-implementations)
- Active parameter counts help explain compute requirements, but **all resident expert weights still contribute to memory**. The concrete example is Qwen3.5-122B-A10B: 10B active, yet its linked 4-bit artifact is 69.6 GB. [Artifact](https://huggingface.co/mlx-community/Qwen3.5-122B-A10B-4bit)

A roughly 70 GB large model plus a 16–25 GB worker leaves limited room within your stated default wired-memory allowance for caches, runtime buffers, and other processes. That is a **capacity estimate**, not a verified residency result; measure process footprint, wired memory, memory pressure, and swap together. Keep decimal GB and GiB distinct.

### Recent models I would defer

**Qwen3.8-Flash-Next** is interesting but awkward here. Its headline 125B/6B-active description excludes an additional approximately 51B embedding component and 4B prediction component. One experimental MLX conversion reports approximately 103–105 GB active memory, leaving little room for another resident brain. Conversion repositories also document experimental architecture support. I would test it separately only after establishing a reliable production candidate. [Official card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next), [conversion and footprint](https://huggingface.co/rapid-mlx/Qwen3.8-Flash-Next-4bit), [support notes](https://huggingface.co/pipenetwork/Qwen3.8-Flash-Next-MLX-4bit)

**Mistral Medium 3.5 128B**, released in April, is another plausible overseer experiment. However, it is dense, and I did not verify a sufficiently matched M4 Max measurement to place it ahead of the large MoEs for this workload. [Official card](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B), [release documentation](https://docs.mistral.ai/models/mistral-medium-3-5-26-04)

**GLM-5.3-Flash** and **MiniMax-M3** have approximately 320B and 428B total parameters respectively. Simple four-bit weight arithmetic alone gives about 160 and 214 GB, before overhead. They are not sensible first choices for fully resident inference on this machine. [GLM card](https://huggingface.co/zai-org/GLM-5.3-Flash), [MiniMax card](https://huggingface.co/MiniMaxAI/MiniMax-M3)

## 3. Realistic Apple Silicon throughput

### Closest published measurements

These are **community submissions, not independent replications**. Most sufficiently specific recent reports use **oMLX**. They establish plausible hardware performance, but must not be presented as measurements of LM Studio, Ollama, or plain `mlx-lm`.

**PP** means prompt-processing tokens/s; **TG** means generation tokens/s. Batch figures are **aggregate generation throughput**, not throughput per request or total short-turn speedup.

| Model / measured artifact | Hardware and runtim
[exited with code 0]
