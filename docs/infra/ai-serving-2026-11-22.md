# AI model serving for the new platform (set up 2026-11-22)

The owner told Ethan beforehand. **Ethan's `llama-ethan.service` on the 3090 was not changed**, and it kept running the whole time.

```
dev VMs / bots ──► LiteLLM gateway  10.0.0.186:4000   (one OpenAI-compatible address; master key in /opt/mcai-gateway/.env, mode 600)
                      ├─ "executive" ─► vLLM v0.33.0 on the 3090   10.0.0.16:8000   Qwen/Qwen3-8B-AWQ, thinking off
                      │                  └─ fallback ─► "qwen35-4b"
                      └─ "qwen35-4b" ─► llama.cpp servea on the 5080 10.0.0.72:18080  r3-qwen35-4b-q8 (6 slots)
Ethan ──────────────► llama-ethan.service on the 3090 (llama.cpp, Qwen3.5-4B vision): not behind the gateway, untouched
```

## The 3090 VM (`ollama-3090`, 10.0.0.16, shared)
- **Installed:** Docker CE, the compose plugin and the NVIDIA container toolkit. No reboot, no driver change, and Ethan's service untouched.
- **`~/mcai-vllm/docker-compose.yml`:** the `mcai-vllm` container (`restart: unless-stopped`) with a **fixed memory share**
  (`--gpu-memory-utilization 0.45`, about 10 GB), `--max-model-len 8192`, `--max-num-seqs 16`, prefix caching on.
- **VRAM split as measured:** Ethan 6,056 MiB · vLLM 9,976 MiB · **about 8 GB free** for Ethan's peaks.
- Our old Ollama (`ollama.service`, qwen2.5 fallback) is still installed but holds nothing. Retire it once the gateway is the only path.
- Change the model: edit `--model` in the compose file, then run `docker compose up -d`. Keep the memory share at 0.45 or lower until Ethan's peak is known.

## The 5080 host (pve4)
- **Installed:** `nvidia_gpu_exporter.service` on :9835, the same binary as on the 3090 VM.
- `servea` (llama.cpp) unchanged. The showcase's Ollama qwen2.5 was unloaded during the freeze, leaving **9.8 GB free**.

## Monitoring (ELK VM 109, 10.0.0.186, running on purpose)
- **Prometheus** jobs added: `gpu` (both exporters) and `llm-server` (vLLM `/metrics`, llama.cpp `/metrics`). The old config is saved as `prometheus.yml.bak-1122`.
- **Grafana dashboard "AI platform: GPUs and model servers"** at `http://10.0.0.186/d/ai-platform`: VRAM, **free 3090 memory (Ethan's headroom)**,
  utilisation, power and temperature, vLLM requests running and waiting, latency p50/p95, tokens/s, llama.cpp slots.
- Not done yet: an alert when the 3090's free memory drops below about 2 GB, and gateway metrics (LiteLLM's Prometheus callback exported nothing).

## First benchmark (real showcase prompts from ELK, median 3,846 characters; JSON-schema output; 120 max tokens)

| Server | 1 at a time | 4 parallel | 8 parallel | 16 parallel |
|---|---|---|---|---|
| **3090 vLLM, Qwen3-8B-AWQ** | p50 1.55 s · 42/min | **p50 0.94 s · 255/min** | p50 3.2 s · 144/min | p50 8.0 s · 123/min |
| **5080 llama.cpp, Qwen3.5-4B q8** | **p50 0.64 s** · 91/min | p50 1.3 s · 142/min | p50 3.1 s · 144/min | p50 5.9 s · 144/min |

**How to read it:**
- **Only 16–64 requests per cell.** It shows the shape of each curve, not precise numbers.
- **The two servers run different models** (8B against 4B), so this compares the whole stack, not the engines alone.
- **Ethan's work was sharing the 3090** during the run, at 75–83% in bursts. That is the likely reason vLLM falls off above 4 parallel requests. This needs a re-run during a quiet period.
- **Invalid JSON was truncation, not format failures.** A check found 3 of 16 cut off at 120 tokens and 1 of 16 at 300. The fix is a `maxLength` on `reason` plus a sensible token limit.

**First read:**
- The 5080 with llama.cpp is fastest for a single request.
- vLLM on the 3090 gives the most throughput at about 4 parallel requests.
- Both level off at **about 140–255 decisions per minute**, which is enough for 4–6 bots with a large margin.

## Next
- Re-run the benchmark with matched models (the same model on both cards) and at a quiet time on the 3090. Also try vLLM on the 5080 (Blackwell support).
- Add the shortlisted models (Qwen3.5-9B, Granite 4.1 8B, Ministral 3 14B, Gemma 4 12B) to the benchmark, including a quality score, not only speed.
- Add the alert on the 3090's free memory, and watch Ethan's peak for a week before raising our memory share.
