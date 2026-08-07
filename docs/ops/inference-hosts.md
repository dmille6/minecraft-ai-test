# Inference hosts

Where each fleet's thinking happens, and the constraints that decided it.

_Last verified: 2026-08-07._

## The map

| host | RAM | serves | model | notes |
|---|---|---|---|---|
| **M4 Studio** `192.168.192.15` | 128 GB | instance #2 (all 5) · instance #1 (3 bots, via `ai.ticrcorp.com`) | `qwen2.5:14b-instruct` | also serves other projects; one model pinned by someone else |
| **M4 Mac mini** `10.0.0.70` | **16 GB** | instance #1 (2 bots) | `qwen2.5:7b-instruct` **pinned** | dedicated to this project |

Instance #1's bot host has **no route** to `192.168.192.15`; it reaches the Studio
over the WAN via `ai.ticrcorp.com` → `76.165.200.8`.

## Three rules, each learned by breaking something

### 1. Match `num_ctx` to the loaded context, or the request hangs

Verified on **both** hosts, so treat it as general:

```
num_ctx = 8192  (matches what is loaded)   0.7-4.1s, works
num_ctx = 4096                             HANGS
no num_ctx at all                          HANGS
```

Any request whose context differs from the resident model triggers a reload, and
that reload path hangs on this Ollama build. Every bot decision timed out at 180s
because of this once — 27 endpoint failures in three minutes — while a hand-run
`curl` returned in two seconds. **Testing the endpoint proves nothing; you have
to test the request.**

### 2. A 16 GB host fits ONE of these models, and 14b is not it

| model on the mini | resident | free RAM | swap |
|---|---|---|---|
| `qwen2.5:14b-instruct` | 9.6 GB | **0.1 GB** | **3.5 GB** |
| `qwen2.5:7b-instruct` | 4.8 GB | 3.8-5.2 GB | 1.9 GB, draining |

14b *answers* in ~4s while swapping, which is the trap: a swapped inference host
does not present as an error, it presents as random multi-second stalls that look
like a network problem. Same failure mode this repo already documents for a
swapped JVM heap.

### 3. `keep_alive=-1` is not a guarantee under memory pressure

7b was pinned on the mini with `keep_alive=-1`. A single 14b request arrived and
Ollama **evicted the pinned model** to make room. The pin is a preference, not a
reservation. On a small host the only real protection is not asking it for the
big model — which is why routing is per-bot by model, below.

## Routing on instance #1

Instance #1 is running a **model A/B** that predates this note. Routing follows
the model, not the host:

| bot | model | endpoint |
|---|---|---|
| `scout`, `gatherer` | `qwen2.5:7b-instruct` | `http://10.0.0.70:11434` |
| `scout2`, `miner`, `gather2` | `qwen2.5:14b-instruct` | `http://ai.ticrcorp.com:11434` |

Pointing all five at the mini would have collapsed that A/B **and** put 14b on a
host that swaps to hold it. Both mistakes were made and reverted; this is the
result.

## The confound this exposed

Instances #1 and #2 were being compared as if they differed only in Minecraft
version and world. They also differ in **model** — and instance #1 is not even
internally uniform.

```
instance #1   Paper 1.21.11 · older world · MIXED 7b / 14b
instance #2   Paper 1.21.8  · pregenerated · 14b throughout
```

So any cross-instance comparison is confounded at least three ways. This is
recorded rather than resolved: an ablation from a common seed is the fix, and it
needs the A6000 or sequential runs.

## When a fleet stops thinking

Symptom is `llm endpoint failed` and `{"error":"server busy, please try again.
maximum pending requests exceeded"}`. Check, in this order:

1. **Can it generate?** Not `/api/tags` — that answered 200 throughout a total
   outage. `POST /api/generate` with the bot's real `num_ctx`.
2. **Are the backends idle while the API says busy?** `curl :PORT/slots` on each
   `llama-server`. Twelve free slots and zero busy while the API refuses
   everything means the scheduler is wedged, not overloaded.
3. **Restart Ollama by PID.** `osascript -e 'quit app "Ollama"'` was ignored on
   macOS; the process survived and stayed wedged. Kill the app and `ollama serve`
   by PID, then `open -a Ollama`.
4. **Re-pin anything that was pinned.** A restart drops it.
