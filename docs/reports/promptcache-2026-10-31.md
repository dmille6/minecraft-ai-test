# promptcache-01: the decision prompt, measured and cut (2026-10-31)

Follows `batching-3090-2026-10-31.md`, which found fleet decisions prefill-bound (~2,550 tokens in, 43-62 out). The
question here: how much of the prompt is static, how much can a server reuse, and what can be cut, so that qwen3.5:9b
(or candidate 2) could carry the fleet (~107 decisions/min, p50 <= 2.5 s, p95 <= 5 s) on the fleet's own GPUs.
Evidence and scripts are in `promptcache-2026-10-31/`. The 5080 was not touched. The Blackwell was not queried (it
served the 24 h qwen3.5 experiment until that experiment rolled back at 18:58Z on its own "endpoint down" stop).

## 0. Answer

- **The cache was broken for qwen3.5 by one line.** For a hybrid-SSM model, llama.cpp restores a prefix only at a
  saved checkpoint, and the first checkpoint sits at the start of the last user message. The bot's name was the last
  line of the system message, so each checkpoint belonged to one bot. Across bots, reuse was **0 tokens** (8 of 8 bots).
  With the name moved to the first line of the user message, every bot after the first reuses **1,173 tokens**.
- **The batching report overstated live capacity.** Its replay prompts repeated bot names (15 distinct systems), so
  they hit the cache 36-42% of the time. With the fleet's 80 names they hit 0%. At 20/min on the 3090: old layout
  p50 12.7 s / p95 21.6 s, new layout 6.8 / 13.6 s.
- **Prompt trim: about 170 user tokens per prompt (12%) on today's prompts**, with no information loss the model can act
  on. It drops: the last event that repeats LAST ACTION, consecutive duplicate events, bracketed diagnostics, and peer
  name lists.
- **Capacity gate on the 3090: FAILS at every rate (20-130/min), whichever prompt is used.** The new prompt halves
  latency at 20/min and raises overload throughput 26-52%, but the 3090 shared with ethan-gpu is far from 107/min.
  **The fleet target is not reachable on this card by prompt work alone.**
- **Quality gate (600-item replay): PASS on both models.** The new prompt is not worse on hard, rep_fail, post-veto or
  schema, and is better on each:
  - qwen3.5:9b: hard 3.0 -> 2.5, rep_fail 25.3 -> 22.0, post-veto 54 -> 48, schema 100 -> 100.
  - qwen2.5:7b: hard 14.2 -> 12.5, rep_fail 67.3 -> 57.3, post-veto 95 -> 92, schema 100 -> 100.
  - One reported, non-gated metric fell: agreement with the logged *working* action on the 200 good items, 81.5 ->
    74.5 (qwen2.5) and 54.5 -> 48.5 (qwen3.5). It is the canary's thing to watch (items per bot-hour).
- **Today's qwen2.5:7b on the 5080 gains little.** On the 3090's Ollama 0.32.14 neither layout showed cross-bot prefix
  reuse (prefill time scales with the full prompt, both models), so the identity move is neutral on Ollama. Only the
  ~170 trimmed tokens help: ~12% of a ~160 ms prefill, in an 821 ms p50 decision (~2-3%). The real gain is for a
  hybrid model on llama.cpp.

## 1. The prompt (3,891 live decisions, 80 bots, 17:54-18:54Z; Qwen3.5 tokenizer)

Total prompt p50 2,575 tokens (qwen3.5 rows; 2,502 for qwen2.5). That is system 1,184-1,212 (3 memory scopes; the
identity line is 15 of them), user p50 1,398 (p95 1,600), and chat template 17. Completion p50 57-63.

| user section | present | tokens when present | share of user tokens | same as the bot's previous turn |
|---|---|---|---|---|
| LESSONS FROM PAST RUNS | 100% | 488 | 35.2% | 43.5% (80% of lines) |
| RECENT EVENTS | 100% | 321 | 23.1% | 5.4% |
| INVENTORY | 100% | 125 | 9.0% | 58.9% |
| BLOCK CHECKS | 100% | 78 | 5.6% | 44.9% |
| ELEVATION | 100% | 57 | 4.1% | 50.2% |
| NEARBY | 100% | 56 | 4.0% | 43.0% |
| CAN SMELT NOW | 100% | 53 | 3.8% | 92.1% |
| CARRYING | 61% | 45 | 2.0% | 29.0% |
| STATE | 100% | 39 | 2.8% | 39.1% |
| LAST ACTION | 99% | 30 | 2.1% | 26.1% |
| CAN CRAFT NOW | 96% | 29 | 2.0% | 93.0% |
| KNOWN PLACES / TASK / HINT / PROGRESS / TRIGGER / saw_end | | 17 / 15 / 12 / 10 / 4 / 10 | 4.7% | 100 / 91 / 91 / 67 / 72 / 0 |

Lessons per prompt: 4.0 pool sightings (169 tok, with "reported by A and B and ..."), 3.0 pool hazards (105), 2.3
"failed Nx" (86), 2.0 "worked Nx" (54), 1.9 own hazard areas (48).

**Static vs per-turn.** Only the system message is shared across bots. In the user message nothing is shared across
bots of one pool at the same time (TASK/HINT match 36%). Turn to turn for the same bot, the common prefix of the user
message is p50 61 tokens (mean 283). The order was already right for a pure-attention model: everything static first,
identity last. It was wrong for the hybrid only because of where the checkpoint falls.

## 2. What the servers reuse (3090 test, `promptcache-2026-10-31/cachetest-results.txt`)

- **llama-server b12020, qwen3.5:9b Q8** (hybrid). Checkpoints are saved at the start of the last user message
  (1,173), ~512 tokens before the prompt end, and at the prompt end (`--checkpoint-min-step` 8192 by default). A restore
  can only happen at one of them.
  - Old layout: cross-bot reuse 0. Same-bot reuse is 1,189 tokens, but only when the bot's request lands on its own
    slot, which with 80 bots on 8 slots it almost never does.
  - New layout: 1,173 tokens for every bot.
  - No checkpoint lands inside a bot's stable user-message prefix, so per-bot reordering gains nothing on this server.
    The host prompt cache (`--cache-ram`, ~280 MiB per entry) cannot hold 80 bots' states either.
- **Ollama 0.32.14 (3090; `olcache.py.txt`).** 8 bots, serial, both layouts, `think:false`. `prompt_eval_count` is
  always the full prompt. `prompt_eval_duration` tracks prompt length in both layouts:
  - qwen2.5:7b: 344-456 ms (old) vs 344-454 ms (new);
  - qwen3.5:9b: 934-1,071 ms vs 963-1,111 ms.
  So neither layout showed cross-bot reuse on this Ollama, and the move is neutral there. The 5080's Ollama was not
  touched; its live prefill is p50 160 ms for ~2,500 tokens, which cannot tell reuse from raw speed.

**Expected gain** (prefill ~70-75% of batched GPU time, batching report). Uncached tokens per decision go from ~2,575
(old, live names) to ~1,400 (new), minus ~170 trimmed, so ~1,230: a 52% cut in prefill work. That predicts roughly
1.5-1.9x capacity on a server where prefill dominates.

## 3. Capacity gate: `batchload.mjs`, open loop, 3 min of arrivals per run, server restarted before each run

Stock qwen3.5:9b Q8_0, llama-server b12020 (`-np 8 --no-kv-unified -c 49152 -fa on --jinja --reasoning off`, prompt
cache on). The fleet client is used throughout (grammar, repair, sentinel), with timeout 45 s.
- **old** = the 600 m3-eval items with identities spread over the 80 live bot names, as the fleet sends them.
- **new** = the same items through `scripts/learnloop/prompt_transform.mjs`. These are 10-20 prompts, so the trim is
  only 6.3% of characters here, against ~12% of user tokens today. This understates the trim.

"ethan busy" is the share of 2-second samples in which ethan-gpu's llama-server was processing (sample count in
brackets).

| layout | rate/min | n | done/min | p50 s | p95 s | timeouts | valid | prefix cached | srv prompt ms p50 | srv gen ms p50 | ethan busy |
|---|---|---|---|---|---|---|---|---|---|---|---|
| old | 20 | 60 | 23.5 | 12.7 | 21.6 | 0 | 60/60 | 0.0 | 2085 | 8312 | 88% (78) |
| new | 20 | 60 | 24.4 | 6.8 | 13.6 | 0 | 60/60 | 0.41 | 906 | 5045 | 67% (75) |
| old | 50 | 150 | 8.8 | 30.3 | 85.6 | 111 | 39/150 | 0.024 | 1896 | 12181 | 72% (134) |
| new | 50 | 150 | 13.4 | 33.8 | 89.4 | 91 | 59/150 | 0.421 | 1563 | 11173 | 84% (133) |
| old | 80 | 240 | 6.6 | 27.8 | 40.6 | 211 | 29/240 | 0.0 | 1890 | 11941 | 89% (132) |
| new | 80 | 240 | 8.3 | 28.9 | 41.7 | 204 | 36/240 | 0.371 | 913 | 10286 | 64% (132) |
| old | 107 | 321 | 5.3 | 27.7 | 40.8 | 298 | 23/321 | 0.0 | 2403 | 12094 | 82% (131) |
| new | 107 | 321 | 7.1 | 30.3 | 43.4 | 290 | 31/321 | 0.352 | 1030 | 11193 | 85% (131) |
| old | 130 | 390 | 5.3 | 28.7 | 42.2 | 367 | 23/390 | 0.0 | 2388 | 11299 | 52% (132) |
| new | 130 | 390 | 7.1 | 28.8 | 41.5 | 359 | 31/390 | 0.353 | 1106 | 11029 | 40% (132) |

- **Gates (p50 <= 2.5 s, p95 <= 5 s): FAIL at every rate, for both layouts.** Above 20/min every run is in collapse.
  Throughput then falls below the 20/min run, because timed-out requests still occupy the server.
- **Measured vs expected.** At 20/min the new layout cuts p50 46% and p95 37%. Server prompt time per request drops
  from 2.1 s to 0.9 s, and served throughput under overload rises 26-52% (8.8 -> 13.4, 6.6 -> 8.3, 5.3 -> 7.1/min).
  That is in line with the 1.5-1.9x estimate, given that ethan-gpu's load varied 40-89% between runs.
- Every answer that came back was schema-valid. All failures are 45 s client timeouts.
- **The batching report's 20/min stock-Q8 line (p50 6.8 / p95 12.3 s at 36% cached) matches the NEW layout.** The live
  fleet's old layout would have measured ~12.7 / 21.6 s.
- **What this means for 107/min.** On this shared 3090, a qwen3.5:9b decision with the new prompt is about 2x cheaper
  but still serves ~15-24/min within or near the gates. The 5080 estimate in the batching report (~40-70/min within
  gates) assumed its replay's cache hits. With the new prompt those hits are now real for the live fleet, so that
  estimate stands. With the old prompt it would have been roughly half. **107/min still needs a dedicated card at
  least ~2x the 5080, or a smaller/faster model, or two servers.**

## 4. Quality gate: 600-item replay (`eval_offline.py`, `replay-scores.txt`)

**Setup.** This is the instrument of `learnloop-c2-2026-10-31.md` s.5:
- v0 `m3-eval.jsonl`: 200 good / 300 non-transient failures / 100 post-veto;
- the fleet's own client (replay bots-d014ec2cbd8b), T=0, concurrency 2;
- the 3090's Ollama 0.32.14 behind one think:false proxy, 21:00Z.

"new" = the same items through `prompt_transform.mjs`. All 4 runs answered 600/600 with 0 transport errors. The
instrument check is OK. Scoring against the original items and against the transformed items gives identical numbers.

| model | layout | schema-valid | hard | rep_fail (300) | post-veto repeat (100) | agree skill (200 good) | agree key |
|---|---|---|---|---|---|---|---|
| qwen2.5:7b-instruct (fleet today) | old | 100.0 | 14.2 | 67.3 | 95.0 | 81.5 | 75.5 |
| qwen2.5:7b-instruct | **new** | 100.0 | **12.5** | **57.3** | **92.0** | 74.5 | 69.5 |
| qwen3.5:9b (stock Q4_K_M) | old | 100.0 | 3.0 | 25.3 | 54.0 | 54.5 | 43.5 |
| qwen3.5:9b | **new** | 100.0 | **2.5** | **22.0** | **48.0** | 48.5 | 38.0 |

- **The gate passes: not worse on hard, rep_fail, post-veto or schema, on both models.** The old qwen3.5:9b row
  reproduces the c2 report exactly (3.0 / 25.3 / 54.0), so the instrument holds.
- **Agreement on good items fell** (reported, not gated). Discordant items, i.e. old agreed and new did not vs the
  reverse:
  - qwen2.5: 27 vs 13 (sign test p ~ 0.04);
  - qwen3.5: 23 vs 11 (p ~ 0.06).
  The moves are scattered (goto -> explore 4, mine -> gather 4, goto -> deposit 3, ...). There is no degenerate
  policy: the largest shift is qwen3.5 `surface` on failure items, 52 -> 59 of 300; candidate 2 by comparison went
  to 65% `surface` on post-veto items. On good items qwen2.5 proposes `mine` less (38 -> 28) and `deposit` more (it enters
  the top six with 10).
- About 24% of items change skill at T=0 from the prompt edit alone, so "agree" moves both ways. This is why the
  canary watches items per bot-hour (s.5) rather than trusting the replay's agreement.

## 5. The change (main + canary variants)

- `bots/src/prompt.mjs`:
  - `identityLine()` becomes the first line of `buildUserPrompt`'s output, and `buildSystemPrompt` no longer
    contains it.
  - `compactEvents(texts, lastOutcome)` renders RECENT EVENTS. It drops a final event equal to
    `lastOutcome.slice(0,160)` (the exact text `addEvent` stored), strips `[...]` diagnostics including an
    unterminated one, collapses consecutive identical events to `(xN)`, and drops empties. LAST ACTION still shows
    the full newest outcome.
- `bots/src/worldfacts.mjs`: `seenLine()` / `hazardLine()` render "3 reports, incl. you" and "2 other bots hit ...".
  A single peer keeps its name.
- `bots/test/promptcache.test.mjs` (13 behaviour tests, including the composed `buildUserPrompt` and
  `WorldFacts.promptLines`). `promptfix.test.mjs` now renders through `seenLine`.
- `scripts/learnloop/prompt_transform.mjs` rewrites logged replay items with the bots' own exported functions.
- **Tier:** `protected.py` exit 0 (prompt.mjs and worldfacts.mjs are not protected). It runs as a fleet canary anyway,
  because it changes the decision prompt fleet-wide.
- **Reviews:**
  - Claude (independent subagent) r1 APPROVE, 0 blockers. Two notes were fixed: the empty bullet, and the stale
    render copy in promptfix.
  - Codex (`codex exec`, blockers-only) r1 APPROVE, 0 blockers.
- **Tests and lint:** `npm test` 376/376 on the main commit. Each variant: eslint clean and the 8 affected test files
  pass. `lint:movement` fails identically on main (buildbot.mjs and two tests, untouched).
- **Canary own lines:** schema_valid share and retries (must not fall); prompt_tokens p50 (~150 lower); rejected: and
  repeat_loop vetoes per decision (must not rise); gathered items per bot-hour vs the control pools (must not fall:
  the replay's agreement drop); deaths.
- **Rollback:** the base sha. There is no env switch; the change is prompt text only. `system_hash` changes for every
  bot (expected; 3 hashes, one per memory scope).

### Canary variants (branches `promptcache01-on-<base8>`, one cherry-pick each)

The entry is queued as a PROGRESS entry after lavatarget-01, the last runnable entry, ahead of the parked townfloor-01.
There is one variant for every sha the fleet can be on when it reaches the head: the base, plus every canary sha of
the five entries ahead. Each variant passes eslint and the 9 affected test files. The full suite passed on
`dc9ca1c9` (366/367; plinth-skill passes alone, a load flake) and on the deepest stack `9246217d` (376/376).
A tip not in this table (an entry ahead rebuilt) needs `queue replace-variant`.
Queued 10-31 21:31Z (`queue add`, then moved by hand under `flock ~/sched.lock` to just after lavatarget-01; backup
`~/canary-queue.json.bak-promptcache-20261031T213158Z`; no other entry moved). Registrations `~/mcai-analysis/promptcache-01.<variant8>.json`.

| fleet tip at launch | variant |
|---|---|
| `281d5659` (fleet tip) | `dc9ca1c9` |
| `a11ffbb8` (escapeguard-01) | `a4625f57` |
| `693b28c9` (zigfleet-02 on 281d5659) | `31a14aec` |
| `2717bc1c` (zigfleet-02 on a11ffbb8) | `837ff9b4` |
| `d2e95967` (tombexit-01 on 281d5659) | `7c93af1e` |
| `8d85e5b7` (tombexit-01 on a11ffbb8) | `4493a010` |
| `aceb4a4b` (tombexit-01 on 693b28c9) | `3e2d26e7` |
| `1a0f9ddf` (tombexit-01 on 2717bc1c) | `ee0be340` |
| `02fb644e` (airpocketwin-01 on 281d5659) | `657264f4` |
| `d40126ac` (airpocketwin-01 on a11ffbb8) | `861ed4bc` |
| `3a03478a` (airpocketwin-01 on 2717bc1c) | `bd11c61e` |
| `52d9281a` (airpocketwin-01 on 1a0f9ddf) | `9f2db08c` |
| `998e1231` (lavatarget-01 on 281d5659) | `139969f5` |
| `dfb3ff13` (lavatarget-01 on 52d9281a) | `9246217d` |

## 6. Client design for a llama-server path (designed, not deployed)

`bots/src/llm.mjs` speaks Ollama `/api/chat` only. The minimal change, about 30 lines, all in `llm.mjs`:

1. **Endpoint entry.** An optional scheme prefix in `OLLAMA_BASE_URLS`:
   `oai+http://<llama-host>:18080|stock-q8,http://<ollama-host>:11434|qwen2.5:7b-instruct`. The constructor's `split('|')`
   parse gains `api = url.startsWith('oai+') ? 'oai' : 'ollama'` and strips the prefix. Existing env files are
   unchanged.
2. **`#post`** branches on `ep.api`.
   - For `'oai'` it POSTs `${ep.url}/v1/chat/completions` with:
     - `{model, messages, stream: false, temperature, max_tokens: num_predict, cache_prompt: true}`;
     - `response_format: {type: 'json_schema', json_schema: {name: 'decision', schema}}`.
   - It maps the answer to the existing return shape: `content = choices[0].message.content`,
     `prompt_tokens = usage.prompt_tokens`, `completion_tokens = usage.completion_tokens`, and the
     prompt_eval/eval durations from `timings.prompt_ms` / `predicted_ms` x 1e6. This is the mapping
     `scripts/host/batchload.mjs` used for 2,000+ requests at 100% schema-valid answers.
   - `keep_alive` and `num_ctx` are dropped (server-side settings).
3. **Health/probe.** EndpointPool's probe uses `GET /health` for `oai` endpoints, where it uses `/api/version` for Ollama.
4. **Telemetry.** No new fields on the decision row. The ES index is `dynamic: strict`, and an unmapped key rejects
   the whole document. `timings.cache_n` can go in a separate event kind if wanted.
5. **Server.** llama-server b12020, `-np 8 --no-kv-unified -c 49152 -fa on --jinja --reasoning off`, prompt cache on.
   **It needs the new prompt layout (this change), or every request pays full prefill.**
6. **Tests.** A fake fetch for both APIs (request shape, response mapping, schema failure, timeout -> fallback to the
   next endpoint). Tier 3 when built (it touches the decision path).

## 7. Cleanup

- The 3090's llama-server (mine) is stopped, the sampler is stopped and the read-only bind mount is removed.
- Ollama was started for the replay and the Ollama cache check, then models were unloaded (`/api/ps` empty) and it was
  returned to inactive + disabled.
- ethan-gpu (PID 191969, 6,056 MiB) was untouched. It shared the GPU during the tests (~19:00-21:30Z).
