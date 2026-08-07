# Inference hosts

Where each fleet's thinking happens, and the constraints that decided it.

_Last verified: 2026-08-07._

## The map

| host | RAM | serves | model | notes |
|---|---|---|---|---|
| **M4 Studio** `192.168.192.15` | 128 GB | instance #2 (all 5) · instance #1 (5 bots, via `ai.ticrcorp.com`) | `qwen2.5:14b-instruct` | also serves other projects; **89 GB pinned by them** |
| **M4 Mac mini** `10.0.0.70` | **16 GB** | instance #1 (3 bots) | `qwen2.5:7b-instruct` **pinned** | dedicated to this project |

Instance #1's bot host has **no route** to `192.168.192.15`; it reaches the Studio
over the WAN via `ai.ticrcorp.com` → `76.165.200.8`.

### Which bot is on which host, and why

| bot | scope | host | model |
|---|---|---|---|
| Scout01, Gather01 | private | mini | 7b |
| Solo01 | isolated | mini | 7b |
| Scout02, Miner01, Gather02 | private | Studio | 14b |
| Hive01, Hive02 | shared | Studio | 14b |

**2026-08-07 22:4x UTC — Hive01 and Hive02 moved from the mini to the Studio.**
Two reasons, and the second is the one that matters.

Latency, the reason given at the time: over 90 minutes the dedicated 16 GB mini
running the SMALLER model was consistently slower than the shared 128 GB Studio
running the larger one -- p50 6.0s against 3.6s, per bot, no exceptions.

**That prediction was mostly wrong, and the measurement afterwards says so:**

| | before (5 mini / 3 Studio) | after (3 mini / 5 Studio) |
|---|---|---|
| mini, 7b | p50 6.0s | p50 5.5s |
| Studio, 14b | p50 3.6s | p50 4.9s |

Two more bots cost the Studio ~1.3s and saved the mini ~0.6s. The move equalised
the hosts rather than speeding anything up, which means the Studio's advantage
was substantially that it was LESS LOADED, not that it is a bigger machine --
per-bot queueing dominates, and moving load around does not create capacity.
(n=7-10 per bot over 14 minutes post-restart; indicative, not settled.)

Keep the arrangement anyway: the experimental-design reason below is the one
that matters, and it is unaffected.

Experimental design: the pair had to move together (a hive split across two
models is not a hive), and moving these two rather than two private bots is what
keeps the trial answerable. Every arm now has a MODEL-MATCHED control:

    hive (14b)      vs  Scout02/Miner01/Gather02 (14b private)
    isolated (7b)   vs  Scout01/Gather01 (7b private)

Moving two private bots instead would have put every private bot on 14b and every
hive/isolated bot on 7b -- model perfectly confounded with memory scope, so any
hive-vs-private difference would have been indistinguishable from 7b-vs-14b.
Any analysis crossing this timestamp must treat Hive01/Hive02 as a model change.

### We are the evictable tenant on the Studio

`/api/ps`, 2026-08-07: `qwen2.5:32b` (54.2 GB) and `qwen2.5-coder:14b` (34.9 GB),
both `keep_alive=-1`, expiry stamped **year 2318** -- 89.1 GB of 128 GB pinned by
another project. Our `qwen2.5:14b-instruct` is NOT pinned; it lives in the
remaining ~39 GB on the default 5-minute keep-alive.

It is genuinely resident right now (`load_duration=0.12s` on a live probe, versus
the ~10s+ a cold 9 GB load would cost). But if that project pins anything more,
ours is what gets evicted -- the same failure that already cost this fleet a night
on the mini, where `keep_alive=-1` did not survive memory pressure. Watch it, and
note that a `/api/ps` listing which omits our model is not proof it is gone: two
snapshots minutes apart caught it absent and then present without any change.

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
