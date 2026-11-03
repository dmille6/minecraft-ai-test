# Ministral 3 8B / 14B on the learning-loop replay (2026-11-02)

Owner 11-02 ("sure"): score Ministral 3 8B and 14B on the round-3 600-item replay. Compare them with the current best,
`20261101-qwen35-4b`, and with the fleet baseline qwen2.5:7b. **This is an evaluation only.** No bot, env file,
queue entry, registry, round directory or showcase was changed. Nothing touched 10.0.0.72 (the 5080), the Blackwell
or `~/ethan-gpu`. The Mac only relayed files and ran the ssh client. Raw numbers and the scripts are in
`ministral-eval-2026-11-02/`.

## 0. Answer

| model (all on the 3090, llama-server b12020, servea flags) | hard (of 600) | rep_fail (of 300) | post_veto (of 100) | schema | within-gate rate, 3090 | p50 / p95 @10/min | p50 / p95 @20/min | VRAM np8 (3090) | fits the 5080 beside qwen2.5? |
|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b (fleet) | 15.0% (90) | 59.0% (177) | 95% (95) | 100 | **25/min** | 1.23 / 1.75 s | 1.61 / 4.30 s | 7.3 GB | it is the resident model |
| **r3 Qwen3.5-4B (best)** | 2.3% (14) | **15.3%** (46) | **7%** (7) | 100 | **25/min** | **1.18 / 1.75 s** | **1.55 / 2.82 s** | 6.6 GB | **yes** (measured: 6.1 GB at 6 slots, 80/min) |
| Ministral 3 8B (stock) | **1.3%** (8) | 20.0% (60) | 42% (42) | 100 | 14/min | 2.30 / 3.37 s | 2.93 / 5.86 s FAIL | 11.6 GB | **no** (only at about 2 slots) |
| Ministral 3 14B (stock) | 2.5% (15) | 18.0% (54) | 25% (25) | 100 | 6/min | 3.43 / 5.42 s FAIL | 4.85 / 9.26 s FAIL | 15.6 GB | **no** (only as a replacement) |

- **Neither Ministral beats the 4B, and neither is a candidate under the capacity rule.** Both are significantly
  worse than the 4B on post_veto: the 8B has 37 items where only it fails against 2 where only the 4B fails
  (p < 0.001), and the 14B 21 against 3 (p = 0.0003). On hard and rep_fail neither is significantly different.
  Both are slower: the 8B serves 14/min within the gates and the 14B 6/min, against 25/min for the 4B. That is 0.56x
  and 0.24x, where the rule asks for 1.5x. They fail both halves of the rule.
- **Both beat the fleet's qwen2.5 by a wide margin** on all three measures (paired, every p < 0.001). They are stock
  models, though, and they behave like the stock Qwen3.5 bases did in r3. Against the stock Qwen3.5-4B base the 8B
  ties on everything: hard 6 vs 8 discordant (p = 0.79), rep_fail 23 vs 23, post_veto 9 vs 13 (p = 0.52). The 14B
  is **better than the stock 4B base on post_veto** (it fails 8 items the base passes, the base fails 29 it passes;
  p = 0.0008) and ties on hard and rep_fail. It is also better than the stock 9B base on post_veto (5 vs 18, p = 0.011).
- **Parsing does not drive any score.** The outputs go through the bots' own client (`LlmClient.decide`, json_schema
  grammar, the sentinel check). Both models scored 600/600 schema-valid, with 0 retries, 0 errors and 0 transport
  errors. The quality differences are decision quality. Ministral does pretty-print its JSON (newlines and indents);
  the median is 60 completion tokens against 41 for the 4B, which costs it some decode time.
- **VRAM is the structural problem on the 5080.** Qwen3.5 is hybrid (Gated DeltaNet), so its KV cache is small. The
  Ministrals use full attention with 8 KV heads: about 0.80 GiB per 6,144-token slot for the 8B and 0.94 GiB for the 14B.
  At the servea shape (8 slots) the 8B needs 11.6 GB and the 14B 15.6 GB, both measured on the 3090. The 5080 has
  about 7.5-8 GiB free beside the resident qwen2.5 (8.1 GiB). The 8B's weights alone take 4.8 GiB, so it fits only
  at about 2 slots (~6.9 GB est.). The 14B does not fit beside qwen2.5 at all, and alone it would need the whole card
  (~13.7 GB at 6 slots, est.). The 5080 numbers are arithmetic from the 3090 measurements: the 5080 is 10.0.0.72 and
  was not touched.
- **Recommendation: NOT a serving candidate. NOT a training base next week.** The 14B is the one interesting result.
  Stock, it already halves the stock 4B's post-veto repeats, and post-veto is exactly what our fine-tune fixes (the
  4B went from 46 to 7). Its edge is on the axis training already wins. It costs 2x the parameters, 2.4x the VRAM
  per slot and about 4x less capacity. Keep Qwen3.5-4B as the base. If a second base is ever wanted, **Ministral 3 8B
  Base** is the cheaper experiment (it ties the stock 4B), but it would still fail the 5080 fit. Both are
  **Apache-2.0** (verified: the Ollama license blob of both artifacts is the Apache License 2.0 text, and the Mistral
  model card says so). Base checkpoints exist (`Ministral-3-{8B,14B}-Base-2512`), and Unsloth lists Ministral 3 for
  fine-tuning, so licence and tooling would not block it.

## 1. Artifacts

| tag | Ollama id (manifest sha256[:12]) | model blob sha256 | source | on the 3090 |
|---|---|---|---|---|
| ministral-3:8b | 1922accd5827 (= `bench/models/manifest.json`) | 3ea32f88...1574 (6.02 GB, Q4_K_M) | the Mac Studio's Ollama store (pulled 10-05), copied blob-only host to host (Studio -> Mac pipe -> 3090), sha256 verified | `~/learnloop-train/ministral-eval/blobs/ministral-3-8b.gguf` |
| ministral-3:14b | 4760c35aeb9d (= manifest) | bfb40fc6...891e (9.08 GB, Q4_K_M) | same | `.../blobs/ministral-3-14b.gguf` |

**Nothing was pulled from the internet.** Nothing was deleted or changed on the Studio, and its Ollama and LM Studio
were not touched (the blobs were only read).

**The Ollama blob does not load in llama.cpp as it is.** Ollama packs text and vision into one GGUF, and llama-server
b12020 refuses it ("wrong number of tensors; expected 531, got 309"). `textonly.py` writes a text-only GGUF:
- The 309 text tensors are copied **byte for byte** (the same Q4_K_M weights). The 222 `v.*` / `mm.*` vision tensors
  are dropped.
- Ollama's metadata names are mapped to llama.cpp's, as llama.cpp's own converter (`conversion/mistral3.py`) writes
  them for ministral3: `rope.scaling.beta_fast/slow` -> `yarn_beta_fast/slow`; `yarn_log_multiplier` = mscale_all_dim
  (1.0); `attention.temperature_scale` = Ollama's `rope.scaling_beta` (0.1, Mistral's `llama_4_scaling_beta`).
- `tokenizer.ggml.pre` is set to `tekken` (Ollama wrote `default`).
- The chat template is Ollama's template for the same artifact, in jinja: BOS, `[SYSTEM_PROMPT]..[/SYSTEM_PROMPT]`,
  `[INST]..[/INST]`. The bots always send a system prompt, so Ollama's default "Le Chat" system text never applies.

Checks on the converted files:
- They load. llama-server logs `yarn_attn_factor = 1.0 (mscale == 1.0, mscale_all_dim = 1.0)`.
- `/tokenize` of `[INST]hello[/INST]` gives `[3, 29706, 4]`, so the control tokens are single tokens.
- `/apply-template` renders `[SYSTEM_PROMPT]SYS[/SYSTEM_PROMPT][INST]hi[/INST]`.
- A free-text probe answers "Paris" and "391" correctly.

Files: `ministral-eval/ministral-3-{8b,14b}-text.gguf` (5.2 / 8.2 GB), hard-linked as
`~/learnloop-train/r3/models/ministral-3-{8b,14b}.gguf`, so `llgpu.sh serve` takes them by key.

## 2. Method (the r3 instrument, unchanged)

- **Door:** every GPU step went through `llgpu.sh` with the loop's restricted key from .31, holder `ministral-eval`
  (claim -> serve -> run -> unserve -> release). The weekly loop was idle: its next round is due 7 days after
  11-01 13:05Z, and its heartbeat said `idle`. Nothing collided with it.
- **Server:** llama-server b12020 `-np 8 --no-kv-unified -c 49152 -fa on --jinja --reasoning off`, the same binary
  and flags as r3.
- **Replay:** the round-3 gate set `~/learnloop/r3/m3-eval.v0.pc.jsonl`: 600 items in the promptcache layout,
  300 fail, 100 post-veto, 200 good. The client is the fleet's own (`batchload.mjs`, api oai, bots
  `bots-96261fffbdaf`), closed loop, concurrency 2, T = 0.
- **Scoring:** `eval_offline.score_one/table` and `weekly.disc_counts/significantly_worse`, imported from the
  installed loop (`mineval.py score`).
- **Positive controls:**
  1. The scorer path reproduces r3's `gate.json` exactly from r3's own replay files: the 4B at hard 2.3, rep_fail
     15.3, post_veto 7.0; qwen2.5 at 15.0 / 59.0 / 95.0; c2 at 1.5 / 15.7 / 8.0.
  2. The 4B was replayed again tonight on the same server. It gave identical scores (hard 2.3, rep_fail 15.3,
     post_veto 7.0) and the identical skill and arguments on 585 of 600 items. So the r3 replay numbers for the 4B
     and qwen2.5 are directly comparable, and they are what the table uses.
- **Capacity:** the owner's capacity-rule ladder (`config/learnloop-weekly.json` `latency`): rungs 4..40/min, 3 min
  open-loop Poisson per rung, a cold server per rung, live promptcache-layout prompts with the 80 real bot names
  (`live-pc.servea-1101.jsonl`), the bots' own `oai+` client (api native), T 0.7, 45 s timeout. Gate: p50 <= 2.5 s,
  p95 <= 5 s over ALL requests, >= 99% valid, run complete. The ladder stops at the first failed rung. A second pass
  ran every model at **fixed 10 and 20/min** with the same method, to compare the models at the same load.

## 3. Results

### Quality (paired against the 4B; exact two-sided sign test on discordant items)

| | hard: only it fails / only the ref fails, p | rep_fail | post_veto | agree skill (good items) |
|---|---|---|---|---|
| 8B vs 4B best | 6 / 12, p 0.24 | 37 / 23, p 0.093 | **37 / 2, p < 0.001: significantly worse** | 42.5 vs 68.5 |
| 14B vs 4B best | 10 / 9, p 1.0 | 30 / 22, p 0.33 | **21 / 3, p 0.0003: significantly worse** | 47.5 vs 68.5 |
| 8B vs qwen2.5 | 4 / 86 | 16 / 133 | 3 / 56 | 42.5 vs 75.5 |
| 14B vs qwen2.5 | 11 / 86 | 14 / 137 | 2 / 72 | 47.5 vs 75.5 |
| 8B vs stock Qwen3.5-4B base | 6 / 8, p 0.79 | 23 / 23, p 1.0 | 9 / 13, p 0.52 | 42.5 vs 53.5 |
| 14B vs stock Qwen3.5-4B base | 13 / 8, p 0.38 | 22 / 28, p 0.48 | **8 / 29, p 0.0008: better** | 47.5 vs 53.5 |
| 14B vs stock Qwen3.5-9B base | 13 / 12, p 1.0 | 27 / 31, p 0.69 | **5 / 18, p 0.011: better** | 47.5 vs 44.5 |

Skill mix (degenerate-policy check). On fail items: 8B `surface` 36.7%, 14B 31.0%, against the 4B's 53.3% and the
stock 4B base's 22.7%. On post-veto items the 8B is mostly `explore` 28% and `gather` 25%; the 14B spreads across
`gather`, `home` and `deposit` (17-19% each). Neither collapses onto one skill.

### Latency and capacity (3090)

**The 3090 VM and .31 both rebooted between 01:16 and 01:23Z.** It was a kernel update (6.8.0-146 -> 147) with a
clean poweroff, not this eval. It cut the 4B ladder at 12/min. That run was moved aside (`latency/aborted-reboot-0116`
on .31) and re-run from its first rung. ethan-gpu's llama-server came back with a new pid (910) and was **idle**
afterwards: 0 active samples of 137 in `nvidia-smi pmon` during the Ministral re-runs. The Ministral ladders had
first run BEFORE the reboot, when ethan-gpu was busy (47-61% SM). They were then **re-run after it**, so every
number below shares one condition: post-reboot, ethan-gpu idle.

| model | ladder (rung: p50 / p95 s) | within-gate | fixed 10/min | fixed 20/min |
|---|---|---|---|---|
| r3 4B | 4 1.33/1.49 ... 20 1.55/3.92, 25 1.68/3.88, **30 2.53/4.75 FAIL** | **25/min** | 1.18 / 1.75 pass | 1.55 / 2.82 pass |
| qwen2.5:7b | 4 1.40/1.74 ... 20 1.65/3.63, 25 2.25/4.13, **30 2.62/5.82 FAIL** | **25/min** | 1.23 / 1.75 pass | 1.61 / 4.30 pass |
| Ministral 8B | 4 1.61/2.02 ... 12 2.10/3.02, 14 2.24/3.84, **17 2.26/5.29 FAIL** | **14/min** | 2.30 / 3.37 pass | 2.93 / 5.86 FAIL |
| Ministral 14B | 4 2.12/2.45, 6 2.26/3.82, **8 2.85/4.65 FAIL** | **6/min** | 3.43 / 5.42 FAIL | 4.85 / 9.26 FAIL |

Before the reboot, with ethan-gpu busy: 8B 4/min (failed 6/min, p50 3.40 s), 14B 0 (failed 4/min, p50 3.19 s); see
`latency-pre-reboot/`. Every run in both sessions was 100% valid, so all of the failures are latency.

- The capacity rule against the 4B: the 8B is 14/25 = 0.56x and the 14B 6/25 = 0.24x, against the 1.5x the rule
  needs. Both also fail its "not significantly worse" prong on post_veto.
- With ethan-gpu idle, the 4B's 3090 rate (25/min) is higher than at the 11-02 13:16Z regate (14/min, ethan-gpu
  busy). The ordering does not change: the 4B ties qwen2.5 and beats both Ministrals.
- Fleet-like concurrency: the fleet needs about 107/min. On the 3090 nothing tested reaches it within the gates.
  On the 5080 the 4B carries 80/min beside qwen2.5 (serving agent, s.7 of `serving-A-2026-11-01.md`). There the 8B
  could run only at ~2 slots and the 14B not at all.

### VRAM

| model | weights | KV per 6,144-token slot | np8 total (measured on the 3090) | 5080 beside qwen2.5 (~7.5-8 GiB free) |
|---|---|---|---|---|
| r3 4B q8_0 | 4.6 GB | small (hybrid DeltaNet) | 6.6 GB | **fits**: 6.1 GB at 6 slots, measured by the serving agent |
| qwen2.5:7b Q4_K_M | 4.7 GB | 0.33 GiB | 7.3 GB | it is the resident model (8.1 GiB in Ollama) |
| Ministral 8B Q4_K_M | 4.8 GiB | 0.80 GiB | 11.6 GB | no; ~6.9 GB at 2 slots (est.), marginal |
| Ministral 14B Q4_K_M | 7.7 GiB | 0.94 GiB | 15.6 GB | no; alone on the card ~13.7 GB at 6 slots (est.) |

On the 3090 (24 GB, 6 GB of it ethan-gpu's) both Ministrals fit at 8 slots. The 14B leaves about 2.8 GB.

## 4. Training-base view

The fine-tune moved the Qwen3.5-4B mostly on post_veto (46 -> 7) and rep_fail (20 -> 15.3); hard was unchanged
(1.7 -> 2.3). Stock, the Ministral 8B is indistinguishable from the stock 4B. The 14B starts better only on
post_veto, the axis the fine-tune already fixes. No evidence here says that either would end up better than the
trained 4B after the same training. Both would serve worse on the fleet's card: the KV cost is per slot, so a
fine-tune does not change it. Licence (Apache-2.0) and tooling are not the obstacle; serving cost is. **Verdict: keep
Qwen3.5-4B as the weekly base.** Revisit only if the serving card changes (a dedicated 24 GB card), and then try
the 8B Base for one round as a side candidate, since one 8B round costs about the 9B's 5.8 h.

## 5. Where things are

- **.31:** `~/learnloop/evals/ministral-1102/` holds the replays (`ministral-3-8b.jsonl` sha256 6e00e500...,
  `ministral-3-14b.jsonl` a9aceea7..., `rerun-qwen35-4b.jsonl` d06ff039...), the latency runs, `eval.log`,
  `scores.json`, `mineval.py` and `chain*.sh`. Nothing in `~/learnloop/rounds/` or `registry.json` was written.
- **The 3090 (10.0.0.16), left in place:**
  - `~/learnloop-train/ministral-eval/blobs/ministral-3-{8b,14b}.gguf`: the Ollama blobs, 6.0 + 9.1 GB.
  - `~/learnloop-train/ministral-eval/ministral-3-{8b,14b}-text.gguf`: the text-only GGUFs, 5.2 + 8.2 GB, hard-linked
    as `~/learnloop-train/r3/models/ministral-3-{8b,14b}.gguf`.
  - `textonly.py`, and `pmon*.log` (GPU samples).
  - 463 GB free. No lock is held. Ollama is stopped, as found. ethan-gpu was never touched.
- **The repo:** this report and `ministral-eval-2026-11-02/`: scores, ladder and fixed-rate summaries, the eval log,
  the scripts.
