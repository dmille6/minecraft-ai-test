# Inference topology

**As of 2026-08-25.** Four Ollama endpoints answer on `10.0.0.0/24`. Two are in
use, one is a warm spare, one is broken.

| host | hardware | role | models |
|---|---|---|---|
| `10.0.0.72` | RTX 5080 | **fleet inference** — 80 bots, latency-critical | `qwen2.5:7b-instruct` |
| `10.0.0.61` | 96GB (no SSH; API only) | **analysis** — latency-insensitive | 11, up to `qwen3.5:122b-a10b` |
| `10.0.0.16` | RTX 3090, 24GB | warm spare for the fleet | `qwen2.5:7b-instruct` |
| `10.0.0.75` | — | **broken**: port 11434 open, API never answers | — |

## The split, and why it is not negotiable

**Nothing but the fleet talks to `10.0.0.72`.** Eighty bots decide against it
every ~33 seconds against a 30s design target. A single 16k-token analysis
prompt sits in the same queue the bots are using, and the endpoint has no
fallback by pre-registration.

**Analysis goes to `10.0.0.61`.** Measured: `qwen3.5:122b-a10b` loads in 30.4s
and generates at **45–60 tok/s** — it is a Mixture-of-Experts with ~10B active
parameters, so it runs far faster than its 81GB footprint suggests. Also holds
`gpt-oss:120b`, `qwen2.5:72b-instruct`, `llama3.3:70b` and
`hf.co/NousResearch/Hermes-4.3-36B-GGUF:Q6_K`.

**`10.0.0.16` is deliberately idle.** It holds the byte-identical fleet model
(digest `845dbda0ea48ed74`, Q4_K_M) so a 5080 failure is one `sed` and a restart
away from recovery. It is NOT a second fleet endpoint: at ~7 tok/s per stream
under load against the 5080's 68, rotating bots across both would put a ~10x
speed difference inside pools, and between-pool variance is already the term
limiting the experiment. See preregistration amendment 7.

Its 24GB fits models up to ~32B (`qwen2.5:32b-instruct` is 19.9GB) if a second
analysis tier is ever wanted.

## Two traps

**Thinking models return an empty answer if the budget is too small.**
`qwen3.5:122b-a10b` writes to a separate `thinking` field. At `num_predict=1400`
it produced 5,462 characters of thinking and an **empty** `response` —
indistinguishable from a broken endpoint. At 6,000 it produced 21,539 characters
of thinking and a complete answer. `reflect.py` now asks for 8,192 and reports
the thinking length rather than returning an empty string.

**`10.0.0.61` refuses SSH.** Use the HTTP API; there is no shell on it from here.

## Why the 3090 cannot carry the fleet

Not a GPU limit. Under 80-bot load it was generation-bound at 6.8 tok/s per
stream with **one `llama-server` thread pegged at 90.9%** while all 8 vCPUs sat
62% idle and the GPU oscillated 19–99%. `NUM_PARALLEL=32` made it worse,
`NUM_PARALLEL=8` doubled per-stream speed and confirmed the diagnosis but
starved on slots, and `FLASH_ATTENTION=1` changed nothing. Full detail in the
preregistration amendment.
