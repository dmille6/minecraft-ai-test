# Learning loop round 3: the weekly pipeline + a 9B and a 4B candidate (2026-11-01)

Owner 11-01: (1) vendor terms = A, so paid Claude/GPT labels are referee/evaluation only and never train anything;
(2) keep training our own model, continuously, and a SMALLER model is a valid direction because the fleet's GPUs are
prefill-bound (~2,550 prompt tokens per decision). Branch `learnloop-r3-1101`. No bot, env file, manifest or queue entry
was changed. Nothing touched 10.0.0.72, the Blackwell or ~/ethan-gpu. The Mac ran only the installer and the referee
client (a batch-API client).

## 0. Answer

- **The pipeline is built, installed and has run one full round end to end** (round `20261101`, 13:05Z 11-01 to
  05:06Z 11-02, closed by itself). The phases are: harvest from the M1 archive, the outcome-good filter, local-teacher
  relabel with the 30% per-skill cap, train, GGUF, replay gate against the incumbent and the current best, a HELD
  registration when there is a new best, and a report. A cron on .31 ticks every 10 min and starts a round every
  7 days. GPU work goes through one restricted key to the 3090. The paid referee runs on the Mac. s.1 has the details.
- **Round-3 candidates, on the 600-item gate set in the promptcache layout, llama-server, same session** (s.3):

  | model | params | schema | hard | rep_fail | post-veto | agree skill (good) |
  |---|---|---|---|---|---|---|
  | qwen2.5:7b (fleet incumbent) | 7B | 100 | 15.0 | 59.0 | 95.0 | 75.5 |
  | stock Qwen3.5-9B q8_0 | 9B | 100 | 2.3 | 19.3 | 38.0 | 44.5 |
  | stock Qwen3.5-4B q8_0 | 4B | 100 | 1.7 | 20.0 | 46.0 | 53.5 |
  | **candidate 2** (current best, 10-31) | 9B | 100 | **1.5** | 15.7 | 8.0 | 67.0 |
  | **r3 9B** (Qwen3.5-9B, newest week) | 9B | 100 | 2.2 | 16.3 | **6.0** | 68.0 |
  | **r3 4B** (Qwen3.5-4B, same data) | **4B** | 100 | 2.3 | **15.3** | 7.0 | **68.5** |

- **Both r3 candidates pass the incumbent gate and match candidate 2 on rep_fail and post-veto.** In paired sign
  tests vs candidate 2: 4B fail items 10 vs 11 (p = 1.0), post-veto 3 vs 4 (p = 1.0); 9B 9 vs 7 (p = 0.80) and 1 vs 3
  (p = 0.63). **Neither becomes the new best**, because both miss the pre-set hard tolerance (best + 0.5 pp). The 4B
  has 14 hard items out of 600 and the 9B 13, against candidate 2's 9. On the hard items alone the 4B has 7 that
  candidate 2 does not and candidate 2 has 2 that the 4B does not (sign test p = 0.18); for the 9B it is 6 vs 2
  (p = 0.29). That is not significant, but the rule was fixed before the results and I did not move it. Registry best
  stays `cand-c2-q8`, and no HELD entry was prepared.
- **The 4B holds quality at about half the serving cost.** On the 3090, beside ethan-gpu, llama-server with the
  servea flags, open loop at the serving agent's rates:

  | @20/min p50 / p95 | @50/min p50 / p95 | @80/min valid / served per min |
  |---|---|---|
  | **r3 4B: 1.67 / 3.08 s (PASSES the gates)** | 6.0 / 12.0 s | 213/240, 50.2/min |
  | r3 9B: 2.93 / 6.01 s | 11.1 / 18.5 s | 69/240, 15.8/min |
  | candidate 2: 3.05 / 5.56 s | 16.6 / 24.0 s | 57/240, 13.0/min |
  | qwen2.5:7b (same server): 2.24 / 5.84 s | 7.4 / 12.4 s | 231/240, 54.2/min |

  This is the first qwen3.5-class model that meets p50 <= 2.5 s and p95 <= 5 s at 20/min on the shared 3090. It is
  faster than today's fleet model on the same server at 20/min, and at 80/min it sustains about 3.5x the 9B
  throughput. Nothing meets the gates at 50/min or above on this card, so 107/min still needs the 5080 or two servers.
- **Training on the newest week (promptcache layout) bought no measurable gain over candidate 2 on this gate set.**
  The r3 9B ties candidate 2 within noise. The gate set's items are from 10-20/21, and the fleet has changed since then. The weekly
  dataset carries a fresh held-out cell (10-30/31, `w20261031/m3-eval.jsonl`); next round should score it beside the fixed set.
- **Referee (paid, evaluation only, $2.51 this round).** The local teacher agreed with Claude Opus 5.5 on 71.5% of
  200 items and with gpt-6.1-sol on 72.4% of 192. Claude and GPT agreed with each other on 80.7%. There is **no drift**:
  both are above the pilot baseline (58.9 / 59.6; z = +3.6), though this sample is newer, includes post-veto items and
  uses the new layout, so it is not the pilot's population. **All three teachers choose `surface` on 55-60% of this
  week's failure and post-veto items** (local 60.0, Claude 55.0, GPT 55.2). Against that, the trained models' 53-67%
  `surface` on such items is no longer only an artefact of the local teacher: the paid referees make the same call.
- **Recommendation.** Make the **4B the serving direction** and the next model canary *candidate*. It needs an owner
  call, because the pipeline's own rule says "not a new best" by 5 hard items, a difference that is not significant.
  The prerequisites are the same as qwen35c2-01's: a serving host for it (llama-server `oai+` path), its template
  check there, a capacity test at the stage rate, and a marker on the fleet tip. Keep candidate 2 as the quality
  best. Leave the weekly loop running as it is. For the next rounds: (1) add the fresh held-out cell to the gate
  report; (2) consider training the 4B only, since one round costs about 2.7 h of GPU against 5.8 h for the 9B;
  (3) an owner decision on the hard tolerance (0.5 pp = 3 items) if smaller-model swaps should win on capacity.

## 1. The pipeline (repeatable; installed and running)

`scripts/learnloop/weekly/` (installer `install-weekly.sh`, run from the Mac in a clean checkout; tests gate it):

| where | what | how often |
|---|---|---|
| 10.0.0.31 | `weekly.py tick` (cron `*/10`, nice 19): starts a round every 7 days, advances the open one phase by phase; state, log and `REPORT.md` in `~/learnloop/rounds/<R>/`; `~/learnloop/weekly-latest.md`; heartbeat `~/learnloop/weekly-heartbeat.json` | every 10 min |
| 10.0.0.16 (3090) | `~/learnloop-train/r3/llgpu.sh`: the ONLY door to the GPU. Reached from .31 by one ed25519 key with `restrict,from="10.0.0.31",command="llgpu.sh --ssh"`; every argument must be a plain token, `..` refused; a fixed verb set (status, claim, release, teacher-up/down, put, put-eval, train, export, convert-base, job, serve, unserve, get, models) | on demand |
| Mac | `referee.py tick` (launchd `com.mcai.learnloop-referee`, every 6 h): the paid referee | every 6 h |

Phases of one round (each resumable; a GPU phase that cannot claim the GPU WAITS, it never fails on that):

1. **harvest**: `build_dataset.py` over the newest 9 sealed days of the M1 archive (`~/learnloop/days`, sealed nightly
   on the NAS), the gate set's three held-out worlds REUSED (board-a, placebo-d, isolated-c), the newest 2 days held out.
   Refuses a harvest with < 10,000 train-good decisions (a broken harvest, not a quiet week) and waits on a non-ok
   nightly heartbeat.
2. **pool**: `build_clean.py pool`: good BY OUTPUT (G2 no repeat of a failed/vetoed previous action, G3 an item or a
   milestone, G4 top half of its skill by 600-s items) + a stratified relabel pool (non-transient failures, post-veto).
3. **transform**: `prompt_transform.mjs` with the bots' own exported functions from a `git archive` of main
   (96261fff, which carries promptcache-01's `identityLine`/`compactEvents`/`seenLine`): every training prompt, the
   relabel pool, the c2 replay buffer and the 600-item gate set are in the promptcache-01 layout the fleet will run.
4. **teach**: the LOCAL teacher qwen3.8:27b (Apache-2.0) on the 3090 Ollama answers a seeded, shuffled 2,000-item prefix
   of the pool, blind, through the fleet client (think:false proxy, num_ctx 4096, T=0). Claim -> teacher-up -> run ->
   teacher-down -> release; Ollama is left stopped, as found.
5. **referee**: a seeded 200-item sample of the labelled items is written for the Mac (not a gate).
6. **assemble**: `build_clean.py assemble`: label filter (schema-valid, hard check, not the logged failed action, not
   the vetoed action, local provenance only), then the **30% per-skill cap applied while filling** `relabel_n` = 2,800:
   this round's kept relabels first, the replay buffer (earlier rounds' kept relabels, LOCAL labels only; round 3's
   buffer is c2's 4,852 labels) tops up. 3,000 fleet good-by-output examples. The file is re-checked: 0 paid rows,
   0 gate-set ids, 0 held-out-world rows, 0 old-layout prompts.
7. **train:<c>** per candidate: `put` + `train` (LoRA r16/a32 on every attention, DeltaNet and MLP projection,
   one epoch, adapter only).
8. **export:<c>**: `export_lora_gguf.py` merges the adapter ON THE FLY inside llama.cpp's own converter
   (W' = W + (alpha/r)·B·A before the converter's tensor transforms) into a q8_0 GGUF; the untuned base through the same
   converter once (control); a bf16 too where it fits (the 4B), for the owner's A1 export check. CPU only.
9. **replay**: every model on llama-server b12020 with the servea flags (`-np 8 --no-kv-unified -c 49152 -fa on
   --jinja --reasoning off`), i.e. the serving path the fleet is moving to; 600 items, fleet client (`batchload.mjs`,
   api oai), T=0, concurrency 2: incumbent qwen2.5:7b, the current BEST, each candidate, each candidate's untuned base.
10. **latency**: open-loop Poisson at the serving agent's rates (20/50/80/107/130 per min, 3 min of arrivals each,
    server restarted before each run), fleet client settings (T 0.7, 45 s timeout): candidates, best, incumbent.
11. **gate**: vs incumbent (eval_offline s.4a: schema >= -0.5 pp, hard <=, rep_fail <=), vs BEST (rep_fail <= +2 pp,
    post-veto <= +5 pp, hard <= +0.5 pp, schema >= 99), the export check where a bf16 exists, paired sign tests vs
    best/incumbent/own base, the skill mix. **New best** = passes both AND (rep_fail+post_veto strictly lower, OR at
    most 60% of best's parameters); of two winners the smaller replaces the leader only if it passes vs-best against
    the leader metric by metric. `~/learnloop/registry.json` keeps the best and its history.
12. **register**: a HELD `model-env` queue entry is PREPARED in the round dir (`queue-entry.HELD.json`). The pipeline
    never queue-adds or launches: a model canary needs a serving host, a template check on it, a capacity test and an
    empty-tree marker on the fleet tip, then a human `queue add` + `release`.
13. **report**: `REPORT.md` + the fleetstatus header line (`!!` on a stale/failed heartbeat or a phase waiting > 48 h).

**Referee (paid, evaluation only).** The Mac job submits each round's 200-item sample to Claude Opus 5.5 and
gpt-6.1-sol batch (the existing `teacher_pilot.py`: one shared ledger, reservation before any call, $100/month/vendor
at 80%, no retries; plus $6/arm/round on the planning estimate), fetches into the quarantine `~/learnloop/teacher-paid/`,
runs `pilot_agreement.py` and sends ONLY counts to `.31` (`referee-result.json`). Drift flag: local-vs-paid skill
agreement below the pilot baseline by more than z = 2 (one-sided).

**GPU coordination.** `claim` refuses (75 = BUSY) while any other GPU process exists (ethan-gpu's llama-server is the
one allowed neighbour), while the serving agent's `~/batchtest` server or servea supervisor is alive, or while another
holder has the lock; a failed `nvidia-smi` is BUSY. A pid counts as ours only with its recorded `/proc` start time AND
our command line (exemptions and kills). While held, `~/GPU3090-IN-USE.txt` says who and since when. The serving
agent's scripts do not read that lock: two jobs on the GPU at once is avoided by this side only.

**Ledger.** `config/owner-commitments.json`: new row `learnloop-continuous` (owner 11-01, max_quiet_hours 192 = 8 days,
depends on the `learnloop-weekly` cron); `learnloop-owner-terms` closed (owner 11-01: A). `config/monitors.json`:
`learnloop-weekly` (.31 cron) and `learnloop-referee` (Mac launchd).

## 2. Round 3 data (`~/learnloop/rounds/20261101/` on .31; copies in `learnloop-r3-2026-11-01/`)

- **Harvest:** `w20261031` = 10-23..10-31 (train 10-23..10-29; 10-30/31 held out), the 3 gate-set worlds held out.
  TRAIN cell 831,469 decisions, 205,517 train-good. Models in the TRAIN cell: qwen2.5:7b only, since the qwen3.5
  canary rows sit in the held-out cells.
- **Pool:** 148,201 good-by-output after G2/G3 (6,241 dropped as repeats of a bad previous action, 38,388 for no
  output), 77,808 after G4; drew 9,000 good, 6,000 non-transient failures (stratified), 2,000 post-veto.
- **Transform:** 8,000 + 9,000 + 600 (gate set) + 17,000 (c2 buffer) items moved to the promptcache layout. 0 lacked
  an identity line, and characters fell 5.9-7.1%.
- **Teacher:** 2,000 items in 3 h 17 min on the 3090 (about 10/min beside ethan-gpu), 1 transport error, answered on
  a resume. Label filter on this round: kept 1,686 (fail 1,262, post-veto 424). Refused: 262 repeated the logged
  failed action, 15 repeated the vetoed action, 37 failed the hard check, 1 had no answer.
- **Assemble (sha256 7d23cc3a...):** **5,800 examples** = 3,000 fleet good-by-output + 2,800 qwen3.8:27b relabels.
  The relabels are 1,366 from this week and 1,434 from the c2 buffer, `surface` exactly 30% (840). Fail 2,164,
  post-veto 636. Re-checked: 0 paid rows, 0 gate-set ids, 0 held-out-world rows, 0 old-layout prompts.
  - A first assembly capped AFTER filling and kept only 1,442 relabels. Its 4B run was stopped at step 14 and moved
    aside (`runs/.aborted-...`). The cap now applies while filling (`alloc_relabels`, tested and mutated).

## 3. Training, export, replay

| | Qwen3.5-4B (unsloth @3764fa35, Apache-2.0) | Qwen3.5-9B (unsloth @005429ce, Apache-2.0) |
|---|---|---|
| precision | bf16 LoRA (16-bit base fits: 9.6 GiB peak beside ethan-gpu) | 8-bit base LoRA (as c2; 12.4 GiB peak) |
| LoRA | r16 / a32, attention + Gated DeltaNet + MLP projections, 30.5 M params | same, 40.1 M params |
| steps / wall / tok/s | 363 x 16 / 2 h 39 min / 1,527 | 363 x 16 / 5 h 48 min / 697 |
| loss first -> last5 | 1.45 -> 0.16-0.26 | 1.39 -> 0.17-0.25 |
| grad-norm | 363/363 finite, 0.64-6.9 | 363/363 finite, 0.59-9.1 |
| export | q8_0 4.6 GB + bf16 8.7 GB, 200/200 adapter pairs merged | q8_0 9.8 GB, 200/200 merged |
| PEFT probe vs q8_0 GGUF (same skill, 30 items) | 29/30 | 29/30 (c2 was 26/30) |
| owner A1 export check (q8_0 vs bf16, 600 items) | **583/600 = 97.2% PASS** | not run: a bf16 9B does not fit beside ethan-gpu (c2's 98.5% used the same converter) |

**The exporter was validated before use.** I re-exported c2's adapter with `export_lora_gguf.py` and compared it with
c2's own Unsloth-merged bf16 GGUF on 24 sampled tensors. Worst relative L2 error 0.0068 (q8_0 noise), and the training
delta (W' - W_base) pointed the same way: cosine 0.72-0.86 on 12 adapted tensors. Control: the unmerged base gives
cosine 0 and FAILS. This is what made the merge possible within the disk that was free then (21 GB; the 3090's disk
was later grown to 1 TB).

**Replay instrument:** llama-server b12020 for EVERY model (the incumbent qwen2.5 Q4_K_M from its Ollama blob, c2
q8_0, both stock bases through our converter, both candidates), servea flags, fleet client through `batchload.mjs`
(api oai: `response_format` json_schema), T=0, concurrency 2, 600/600 answered by every model. Instrument check OK:
logged hard fires more on failure items than on good items, and the logged post-veto repeat rate is 90%. The numbers are
not comparable 1:1 with the c2 report (Ollama, old layout). Within this session every model shares one server,
one client and one layout.

**The training effect (candidate vs its own untuned base, paired):** post-veto 4B 1 vs 40 (p < 0.001), 9B 1 vs 33
(p < 0.001). Failure items 4B 20 vs 34 (p = 0.076), 9B 22 vs 31 (p = 0.27). Hard 4B 2.3 vs 1.7, 9B 2.2 vs 2.3.

**Skill mix (degenerate-policy check):** on failure / post-veto items `surface` is r3 4B 53 / 67%, r3 9B 53 / 66%,
c2 57 / 64%, and the stock bases 23-25 / 10-12%. On good items `surface` is 10.5% for both candidates. The referees'
55% on this week's failure/post-veto sample (s.0) supports the call. Whether it raises output is still the canary's
question.

## 4. Latency (s.0 table; full 20 runs in `learnloop-r3-2026-11-01/REPORT.md`)

Open-loop Poisson for 3 min per rate. The server was restarted before every run (no cache carried over). Fleet client
T 0.7, 45 s timeout. The shared prefix cache hit 0.39-0.50 of prompt tokens (the promptcache layout). ethan-gpu was
busy throughout (99% util at the start). Every model failed the gates at 50/min and above, and above ~80/min every model is in collapse
(timeouts). Capacity at the gates on this card: the 4B about 20-30/min, the rest below 20/min.

## 5. Reviews and tests

- Codex (`codex exec --sandbox read-only`, blockers only). **r1: 5 blockers**, all fixed: PID-reuse exemptions and
  kills, a failed nvidia-smi read as a free GPU, a summed-tolerance winner pick, an assemble that aborted with an
  empty round but a full buffer, and convert "done" without its GGUF. **r2: 3 FIXED, 2 NOT FIXED** (PID identity, the
  occupancy query's own exit status). Both were fixed in r3: a pid is ours only with its `/proc` start time AND our
  command line, and a failed query is BUSY. They were proven live on the 3090: the trainer was exempt with a matching
  start time and listed as another GPU user with a wrong one. No new blockers.
- Bugs found by running it (fixed, each with a test): a buffer pilot item without `kind` (KeyError); the cap applied
  after filling; the recorded trainer pid being a subshell; the loop's own Ollama runner counted as "another GPU
  user"; probe items not shipped to the 3090.
- Tests on 10.0.0.30 (not the Mac): `test_weekly.py` 20/20 with 10 mutants killed (weekly gates, pick_winner, drift,
  latency, alloc_relabels, forbid-ids), `test_build_clean` 12/12, `test_learnloop` 23/23 (0 skipped),
  `test_fleetstatus` 70/70, its learnloop mutants 12/12, `test_stallcheck` PASS (16/16 mutants). Bots runner in a git
  clone: 8 files fail, and **the same 8 fail identically on origin/main fda92bc8 on that host** (ceilescape,
  gather-reach, lavastep, oretunnel, outcome-not-intention, plinth-skill, roles, well): environment, not this
  change. No bot code was touched. `protected.py`: not protected.

## 6. Where things are

- **.31:** `~/learnloop/r3/app/` (installed code, VERSION = the installed commit), `~/learnloop/rounds/20261101/`,
  `~/learnloop/registry.json`, `~/learnloop/weekly-latest.md`, `~/learnloop/weekly-heartbeat.json`,
  `~/learnloop/datasets/w20261031/`, `~/learnloop/r3/buffer-c2/`, `~/learnloop/r3/m3-eval.v0.pc.jsonl` (the gate
  set in the new layout), `~/learnloop/replay/bots-96261fffbdaf/` (main's bots for the transform and the client),
  `~/.ssh/id_llgpu`, cron line `# learnloop-weekly`.
- **.16 (3090):** `~/learnloop-train/r3/` (llgpu.sh, exporter, trainer copy, `runs/20261101-qwen35-{4b,9b}/` with lora +
  GGUFs, `runs/base-qwen35-{4b,9b}/base-q8_0.gguf`, `models/` hard links to the qwen2.5 and c2 GGUFs). The HF
  snapshot `unsloth/Qwen3.5-4B` was added to `~/learnloop-train/hf`. Ollama is stopped, as found. No lock is held
  (`~/GPU3090-IN-USE.txt` removed). ethan-gpu (pid 191969) was never touched.
- **Mac:** launchd `com.mcai.learnloop-referee` (`~/learnloop/referee/`), ledger `~/learnloop/spend.jsonl`
  (+$2.51), paid answers quarantined in `~/learnloop/teacher-paid/{B,C}/`.
- **Spend:** Claude $1.77 + GPT $0.74 this round.

## 7. Open for the control session / owner

1. The 4B as the next model canary despite the 5-hard-item miss (s.0). An owner call.
2. The serving agent's `~/batchtest` scripts do not read the loop's GPU lock. The loop yields to them (`claim` refuses
   while servea or its server runs), not the other way round. If servea becomes a permanent fleet server on the 3090,
   the weekly round will wait forever: the fleetstatus line goes `!!` after 48 h. A training window would then need
   servea stopped, which fails the 3090 bots over to the 5080.
3. Retention: each round keeps its GGUFs (about 25 GB a round). Disk is 490 GB free; pruning non-best rounds is not
   automated yet.


## 8. 11-02: the owner's capacity rule, applied to round 3 (OWNER 11-02 ~12:45Z, relayed)

**Owner:** the round-3 4B becomes the serving direction and the next model canary. The "new best" rule is loosened
so that a smaller, faster model can win on capacity when its quality is near-equal.

**The rule, written and pushed to main BEFORE it was applied** (`dcedd094`, 12:33Z; `config/learnloop-weekly.json`
`gates.capacity_rule`; code `weekly.py` `significantly_worse` / `within_gate_rate` / `capacity_rule`):
- A candidate must pass the unchanged incumbent gate, schema-valid >= 99, and its export check where one exists.
- It must NOT be significantly worse than the current best on hard (600 items), rep_fail (300) or post_veto (100).
  "Significantly worse" means more candidate-only failures AND an exact two-sided sign test on the discordant items
  with p < 0.05.
- It must serve **>= 1.5x the best's within-gate decisions/min on the fleet's serving card**, both measured in the
  same session. The within-gate rate is the highest ladder rung where p50 <= 2.5 s, p95 <= 5 s over ALL requests
  (timeouts count), >= 99% are valid, and the run is complete; it must also hold at every lower rung. The method is
  the serving agent's: a cold server per rung, 3 min open-loop, live promptcache-layout prompts with the 80 real
  names, and the bots' own `oai+` client.
- A best that cannot be served on that card counts at the card's lowest rung.
- `card_rates.py` (`fde6c920`/`4150b7ad`) computes the rates from ladder runs measured on a card the loop may not
  touch (the 5080), using the same functions. The files are hashed, and every model is measured on one ladder.
- `weekly.py regate` re-decides a closed round under the current written gates. It keeps every superseded decision
  and its raw files, and refuses a round that had already promoted a best.

**Reviews (both engines, blockers only):**
- `dcedd094`: Codex found 2 blockers (regate overwrote the superseded latency files; regate on a promoted round).
  Claude found none, with 3 notes. All were fixed in `49382142`, and both reviewers then reported NO BLOCKERS.
- Card evidence `bd20fec4`: Claude found 1 blocker (the floor from a mixed ladder). Codex found 2 (incomplete runs
  counted as held; mixed or duplicate rungs). All were fixed in `fde6c920` (+ servedModel `4150b7ad`), and both
  reviewers then reported NO BLOCKERS.
- Tests: `test_weekly.py` 26/26 with 17 mutants killed.

**Applied to round 3, by the rule only** (round dir `state.json.superseded` keeps all three decisions):

| decision | serving card | 4B within-gate | c2 within-gate | significance vs c2 (cand-only / best-only, p) | result |
|---|---|---|---|---|---|
| 05:06Z (old rule) | -- | -- | -- | hard 7/2 | not best (hard tolerance) |
| 13:16Z regate, the loop's own 3090 ladder | 3090 beside ethan-gpu | 14/min (17 fails p95 6.3 s) | 10/min (12 fails) | hard 7/2 p 0.18, rep_fail 10/11 p 1.0, post_veto 3/4 p 1.0 | 1.4x < 1.5x: **not best** |
| **13:51Z regate, the fleet's serving card** | **the 5080** (servea-01 serves from it), serving-agent ladder 12:31-12:46Z beside the live fleet | **80/min** (107 fails p95 5.2 s) | **0**: cannot load beside the fleet's qwen2.5 (9B Q8 ~10.4 GB + 8.7 GB > 16.3 GB) | same | **NEW BEST** |

The registry best is now `20261101-qwen35-4b` (`~/learnloop/registry.json`, history kept). The 9B r3 is not best: it
cannot load on the 5080 either.

**The canary: `servea-01`, adopted** (the control session asked for it to be adopted rather than a second entry
queued):
- `canary-sched.py queue replace-variant servea-01`. The variant is the same (dfb3ff13 -> d48467f8, the oai+
  client patch).
- The registration is `~/mcai-analysis/servea-01.d48467f8-4bll.json` (copy:
  `docs/reports/servea-01-registration.d48467f8-4bll.json`). Env and own lines are UNCHANGED from the serving agent's
  4B registration: 2 pools (10 bots), first entry `oai+http://10.0.0.72:18080|r3-qwen35-4b-q8`, fallback the
  5080's qwen2.5, own lines stall / model_share >= 0.9 / schema gap / latency / completion.
- A `learnloop` evidence block was added: model, rule, replay scores, significance, capacity on both cards, the
  export check, and what to watch.
- Sizing: 10 bots (~13/min) against 80/min within gates on the 5080. That is the staged rollout's first step;
  20/40/60/80 follow via the serving agent's rollout.
- The modelread md5 was re-pinned to the current file.
- It stays HELD, after deepminer-01. The serving agent's waiter (`com.mcai.servea-waiter`) releases it, following
  its hold text.
- The 3090 copy `~/batchtest/models/r3-qwen35-4b-q8.gguf` (a hard link) and a marker branch I pushed before the
  adoption decision (`servea4b01-on-dfb3ff13`, an empty-tree commit) are unused.

**For the owner:**
1. On the loop's own 3090 the 4B is only 1.4x c2, which fails the rule there. It wins because the fleet's serving
   card is the 5080, where c2 cannot run beside qwen2.5 at all. That is the rule as written, but its margin comes
   from VRAM, not speed.
2. The 5080 evidence was measured by the serving agent, not in the loop's own session. It is pinned by file hashes.
