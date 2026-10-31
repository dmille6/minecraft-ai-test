# Learning loop M1-M3: pipeline, archive, M2b script, training VM, teacher plumbing (2026-10-22)

Design: `docs/reports/learning-loop-design-2026-10-21.md` (both engines APPROVE). Branch `learnloop-m1-m3`.
Owner answers of 10-21 are the authority for every step below. Nothing here touched 10.0.0.72, a bot env file, a unit,
the canary queue, the scheduler or the manifest. No paid API was called.

## 1. M1: the data pipeline and the nightly archive (INSTALLED)

**What runs.** `scripts/learnloop/nightly.py --tick` from mike's crontab on 10.0.0.31 at **01:50Z**, under
`nice -n 19 ionice -c3`, from `~/learnloop/app/scripts/learnloop/` (a copy of the repo at the installed commit; the
commit is in `VERSION`). Per finished UTC day, oldest first:

1. every rotated llm/skill generation is COPIED to `~/learnloop/rawhold/` (logs on .31 rotate after 14 days);
2. `extract_triples.extract_day` writes one deterministic shard `triples-YYYYMMDD.jsonl.gz` (one line per model
   decision, label rule L1) + `summary.json`;
3. positive controls, all recorded in `controls.json` and never a reason to skip the archive:
   - **rows**: the day's decision lines counted by timestamp prefix before any parse = parsed rows; model +
     deterministic = rows; triples written = model rows; labels sum; refused + admitted = model rows; bots with rows =
     roster;
   - **join**: every EXECUTED decision (admitted, not runner-refused) joins its skill row; unexplained misses <= 0.01%;
   - **sysprompt**: every (code version, system hash) pair of the day rebuilds from that version's own `prompt.mjs`;
   - **es**: Elasticsearch agrees on llm docs, skill docs, `_death`, `_stagnation`, `_milestone_complete`
     (allowance: the rotation race, llm 15 / skill 120 / events 2);
   - **raw**: the generation that holds the day exists and gzip-tests for every bot with rows;
4. `raw-YYYYMMDD.tar` (that generation's llm + skill gz) and `sysprompts-YYYYMMDD.json` (the rebuilt templates);
5. `MANIFEST.json` (no clock; sha256 + bytes of every file and of every raw member), then every file goes through the
   relay, MANIFEST last, then `seal`.

**The NAS path.** `/volume1/homes/mike/learnloop/daily/<YYYY-MM-DD>/` on bronto (10.0.0.5), with `_OK` per sealed day
and `/volume1/homes/mike/learnloop/.last-good`. Nothing is ever deleted there.

**How .31 reaches the NAS: it does not.** The world backups reach the NAS from 10.0.0.30 with .30's existing key
(`~/.ssh/id_esbackup`), and the showcase backup set the rule "no new key on the NAS". So .31 holds one new restricted
key (`~/.ssh/id_learnloop_relay`) whose only power is a forced command on .30:
`restrict,from="10.0.0.31",command="/home/mike/bin/learnloop-relay.sh"`. The relay (`scripts/learnloop/nas-relay.sh`)
accepts seven verbs -- `put`, `seal`, `verify`, `manifest`, `members`, `status`, `list` -- with day/name/sha regexes and a
character whitelist; `put` hashes what it received, streams it to the NAS, has the NAS hash what it STORED, and only
then renames; a sealed day is immutable (only new `repair-*` files may be added).

**Recovery paths (both engines, round 1).** A day sealed on the NAS but unknown locally (a lost acknowledgement, a
lost `state.json`) is found by `verify` and recorded from the NAS's own MANIFEST, never re-sent. Held raw files are
pruned one by one, only when that file's sha256 is recorded for its sealed day and logrotate has deleted the live
copy; anything a raw control left out stays held until `--repair-raw DAY`. A failed control on ANY day stays "!!"
until a person runs `--ack DAY "why"`.

**Heartbeat.** `~/learnloop/heartbeat.json`, read by `fleetstatus.py`'s new header line `learning-loop archive (M1)`:
missing, stale (> 26 h), any status but ok, a due day not archived (D is due by D+1 04:15Z), an unresolved day, raw at
risk, or a NAS that disagrees with local state is a `!!` line.

Pipeline numbers: section 5.1.

## 2. M2b: remove 10.0.0.16 from every bot's endpoint list (SCRIPT READY, NOT RUN)

`scripts/host/drop16.sh`, staged by `install-m1.sh` as `~/drop16.sh` on 10.0.0.31 (its sha256 is printed by the
install and listed in s.5.2; compare before running). It rewrites one line in each of the 80 env files,
`OLLAMA_BASE_URLS=http://10.0.0.72:11434,http://10.0.0.16:11434` -> `OLLAMA_BASE_URLS=http://10.0.0.72:11434`
(`OLLAMA_BASE_URL` is already .72 and is not touched), and restarts the 80 bots 12 s apart (~16 min).

- **Dry run by default.** `bash ~/drop16.sh` checks everything and changes nothing.
- **Refuses** while a canary is declared in the manifest, while any `10-canary.conf` drop-in exists, while a canary
  loop or chain runs, unless all 80 files carry exactly the expected two lines, and if any unit or drop-in names .16.
- **Installer protocol:** `holdtoken.py claim` (the scheduler's own slot check under its tick lock) and
  `flock -n /tmp/mcai-canary.lock` for the whole run; the slot is re-checked under both.
- **Backups** `*.env.bak-drop16-<stamp>`, each cmp-checked; every file must differ from its backup in exactly that one
  line, or all 80 are restored and nothing restarts.
- **Verify** after the LAST restart (+180 s): every running bot's `/proc/<pid>/environ` carries the new line and no
  .16; the llm rows since then are all served by .72, none by .16, none without an endpoint; p50/p95/p99 <= 2.5 / 5 /
  10 s; one code version live; every bot decided. A failed restart or verify KEEPS the install-hold and exits 4.
- **Rollback** `bash ~/drop16.sh --rollback <stamp>`: restores, restarts 12 s apart, verifies the old line. **After a
  failed `--apply` the hold is kept, and the only working rollback is the one it prints:
  `bash ~/drop16.sh --rollback <stamp> --hold-token <token>`** (a plain `--rollback` is refused while the kept hold
  exists, by design).

Run it (owner, in a canary gap; a copy outside any repo):

    ssh mike@10.0.0.31
    sha256sum ~/drop16.sh            # must equal the sha in s.5.2
    bash ~/drop16.sh                 # must end "DRY RUN OK: --apply would proceed now"
    bash ~/drop16.sh --apply         # ~20 min; prints the backup stamp and the verify
    bash ~/drop16.sh --verify <T0>   # again at +60 min, and at +24 h: exclusion (i) of design s.5.2

**What is evidence and what is a tripwire.** The environ check is the evidence: run today (read-only) it found
`10.0.0.16` in all 80 running bots' environ, so it can see the thing it must later find absent. The row gate is a
tripwire only: of 4,433 model rows since 11:30Z, 4,433 were already served by .72 and 0 by .16, so "0 on .16" would
pass even if drop16 never ran. The script's sandbox test (`scripts/host/test_drop16.py`, 7 cases, run on .31 with fake
sudo/systemctl/pgrep/holdtoken and fictitious bot names) covers dry run, every refusal, apply, a failed restart, and
rollback with and without the kept hold. The dry run refused correctly on keepout-01 (drop-ins, a running loop, a
declared canary, the canary lock). **Disclosure:** while building it I also invoked `--apply` once on .31 as a refusal
check while keepout-01 was declared; it stopped at check 1 (`REFUSED: canary drop-ins present`) before claiming a hold
or touching any file. That should not have been done that way and was not repeated.

## 3. The 3090 training VM (VM 200 ollama-3090, 10.0.0.16) -- procedure

**State read 10-22 (read-only except the venv and the base download).** Ubuntu 24.04, 8 vCPU, 31 GB RAM, 386 GB free
disk, RTX 3090 24 GB, driver 595.91 (CUDA 13.2), Ollama 0.32.14 with `OLLAMA_NUM_PARALLEL=16`, `KEEP_ALIVE=-1`,
`MAX_LOADED_MODELS=1`, no model resident. **A second GPU process is running that is not ours:** `llama-server`
(Qwen3.5-4B, port 1234, `~/ethan-gpu/`, up 4 days) holds 6 GB, leaving 17.4 GB free.

**Prepared (owner-approved environment step):** `~/learnloop-train/venv` (pip bootstrapped into a venv without
ensurepip; no apt package installed): torch 2.14.1+cu130, unsloth 2026.10.7, transformers 5.17.0, trl 1.15.0, peft
0.21.2, bitsandbytes 0.50.2; `unsloth/Qwen3-8B` (16 GB) in `~/learnloop-train/hf`. Checked: CUDA visible, Unsloth
imports, the SFTConfig the trainer builds is accepted, and Qwen3's no-think chat template renders
`<|im_start|>assistant\n<think>\n\n</think>\n\n`.

**Procedure (`scripts/learnloop/train/run.sh`, one phase at a time; every GPU phase refuses without
`DROP16_VERIFIED=<the +24 h verify time>` and with any Ollama model resident):**

1. M2b applied and its +24 h `--verify` OK (no bot can reach .16).
2. Owner decision on the `ethan-gpu` llama-server: stop it for the training window, or leave it (17.4 GB free;
   QLoRA-8B at seq 3,072 is expected to fit, measured by step 4) and say so with `export ALLOW_OTHER_GPU=<decision>`
   -- every GPU phase refuses while another process holds GPU memory unless that is set, so a VRAM figure is never
   read without knowing 6 GB was already taken.
3. `bash run.sh preflight`, then `bash run.sh stop-ollama` (saves the override, stops and disables ollama.service:
   training needs the VRAM and nothing may load a model mid-run).
4. `bash run.sh fit` -- 50 optimizer steps: peak VRAM, tok/s, grad-norm finite and non-zero.
5. `bash run.sh train` -- the dry round (below).
6. `bash run.sh export` -- merge (already saved by train), llama.cpp convert to GGUF bf16, byte-exact Modelfiles.
7. `bash run.sh start-ollama` -- ollama with `OLLAMA_NUM_PARALLEL=2` for evaluation (16 parallel slots of 8,192
   tokens would reserve far more KV cache than 24 GB holds for an 8B model); then `ollama create` the candidate
   (q4_K_M and bf16) and `qwen3-8b-nothink` (base Qwen3-8B with the same no-think template) as printed by export.
8. `bash run.sh template-check` -- the served prompt must equal the trained prompt, token for token.
9. Evaluation from 10.0.0.31 (node + the code live there): `bash scripts/learnloop/train/eval.sh <dataset>
   qwen2.5:7b-instruct qwen3-8b-nothink cand-qwen3-8b-v0-dry cand-qwen3-8b-v0-dry-bf16`, then
   `eval_offline.py --export-check` (q4 vs bf16 same skill >= 97%).
10. `bash run.sh restore-ollama` -- the saved override back byte-equal, ollama enabled and started.

## 4. M3: the first offline training round -- READY TO RUN, NOT RUN

M2b has not run (a canary, keepout-01, is deployed; the owner runs drop16.sh in a gap), so no training was started on
.16 -- by the task's rule and by `run.sh`'s own guard (`REFUSED: set DROP16_VERIFIED=...`, checked live).

**Data for the dry round (dataset v0, s.5.3):** `m3-train-2000.jsonl`, 2,000 good decisions from the TRAIN cell,
skill-balanced (sqrt allocation: gather 508, explore 466, mine 386, goto 329, craft 85, deposit 79, surface 50, smelt
37, place 34, home 13, withdraw 8, board 5). Rendered with Qwen3's no-think template: p50 2,576 tokens, p95 2,828, max
2,966, **0 over 3,072** (none dropped); 5.15 M tokens in all, so the round takes **about 3.6-6.1 h** at the planning
range of 235-400 tok/s. Staged on .16 in `~/learnloop-train/data/`.

**The round:** 200 optimizer steps x grad-accum 10 = the 2,000 examples, one epoch (the design's accumulation of 16
would be 125 steps for the same epoch). QLoRA r 16 / alpha 32 on all linear projections, lr 1e-4 cosine, 3% warmup,
adamw_8bit, loss on the answer only, packing off. A 50-step fit test runs first: peak VRAM, tok/s, grad-norm.

**Evaluation (offline, rung a):** `m3-eval.jsonl` = 600 items from cell C (held-out worlds x the 2 newest days):
200 good (agreement), 300 non-transient failures (repeats-the-failed-action, hard-infeasible), 100 decisions right
after a repeat_loop veto (post-veto test). They are replayed through the bots' own `LlmClient.decide()` (grammar,
sentinel, repair retry, fleet settings 8,192 / 512 / 0.7 / 45 s) against:
- base qwen2.5:7b (the reference for the gates);
- base Qwen3-8B with the same no-think template;
- the candidate (q4_K_M, and bf16 for the export check).

Gates: complete coverage, a passing instrument check, schema-valid >= reference - 0.5 pp, hard <= reference,
rep_fail <= reference; export check q4 vs bf16 same skill >= 97%. **Positive control already measured on the logged
actions:** of 13,408 post-veto decisions in cell C, the fleet repeated the vetoed action 7,858 times (58.6%; the
sandbox measured 29-59%), and 13,390 of those prompts carry the rejection.

**Ready-to-run commands (after `drop16.sh --verify` passes at +24 h):**

    ssh mike@10.0.0.16
    cd ~/learnloop-train              # (inside the remote session)
    export DROP16_VERIFIED=<the +24 h verify time, e.g. 2026-10-24T10:00:00Z>
    bash run.sh preflight
    bash run.sh stop-ollama           # owner-approved step (and decide on the ethan-gpu llama-server, s.3)
    bash run.sh fit                   # 50 steps -> runs/fit-01/metrics.json
    bash run.sh train                 # the dry round -> runs/dry-01/{metrics.json,lora,merged-16bit}
    bash run.sh export                # GGUF bf16 + Modelfiles (prints the ollama create commands)
    bash run.sh start-ollama          # OLLAMA_NUM_PARALLEL=2 for the evaluation
    ollama create cand-qwen3-8b-v0-dry-bf16 -f runs/dry-01/Modelfile.bf16
    ollama create cand-qwen3-8b-v0-dry -q q4_K_M -f runs/dry-01/Modelfile.q4
    ollama pull qwen3:8b && ollama create qwen3-8b-nothink -f runs/dry-01/Modelfile.base-nothink
    bash run.sh template-check
    # then on 10.0.0.31, from the installed copy (NOT /opt/minecraft-ai's tree, which deploys reset):
    cd ~/learnloop/app/scripts/learnloop
    DROP16_VERIFIED=<same> bash train/eval.sh ~/learnloop/datasets/v0 \
        qwen2.5:7b-instruct qwen3-8b-nothink cand-qwen3-8b-v0-dry cand-qwen3-8b-v0-dry-bf16
    python3 train/eval_offline.py --items ~/learnloop/datasets/v0/m3-eval.jsonl \
        --ref qwen2.5:7b-instruct --runs ~/learnloop/datasets/v0/eval/qwen2.5_7b-instruct.jsonl \
        ~/learnloop/datasets/v0/eval/qwen3-8b-nothink.jsonl ~/learnloop/datasets/v0/eval/cand-qwen3-8b-v0-dry.jsonl \
        --export-check \
        ~/learnloop/datasets/v0/eval/cand-qwen3-8b-v0-dry.jsonl ~/learnloop/datasets/v0/eval/cand-qwen3-8b-v0-dry-bf16.jsonl
    # back on .16:
    bash run.sh restore-ollama

## 5. Numbers

### 5.1 The pipeline, per day (10.0.0.31; all 14 days archived and sealed on the NAS; every control OK)

| day | llm rows | model decisions (= triples) | bots | good | bad | void | neutral | ES diff llm / skill | sysprompt pairs | raw files | MB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10-08 | 158,586 | 146,790 | 80/80 | 34,363 | 97,255 | 10,168 | 5,004 | -5 / -55 | 9/9 | 160 | 132 |
| 10-09 | 160,586 | 148,067 | 80/80 | 33,812 | 98,717 | 10,354 | 5,184 | +7 / +52 | 3/3 | 160 | 132 |
| 10-10 | 162,388 | 150,179 | 80/80 | 32,059 | 102,434 | 10,568 | 5,118 | +7 / +58 | 10/10 | 160 | 132 |
| 10-11 | 160,185 | 149,974 | 80/80 | 34,375 | 100,870 | 9,943 | 4,786 | +9 / +62 | 11/11 | 160 | 133 |
| 10-12 | 161,684 | 148,379 | 80/80 | 35,178 | 98,636 | 9,699 | 4,866 | +10 / +37 | 10/10 | 160 | 132 |
| 10-13 | 162,840 | 148,580 | 80/80 | 34,686 | 99,237 | 9,847 | 4,810 | +12 / +44 | 11/11 | 160 | 132 |
| 10-14 | 157,933 | 150,362 | 80/80 | 35,414 | 100,098 | 10,197 | 4,653 | +5 / +46 | 14/14 | 160 | 138 |
| 10-15 | 161,880 | 154,384 | 80/80 | 32,822 | 106,612 | 10,496 | 4,454 | +7 / +42 | 11/11 | 160 | 137 |
| 10-16 | 157,961 | 152,294 | 80/80 | 34,146 | 102,848 | 10,734 | 4,566 | +10 / +29 | 14/14 | 160 | 140 |
| 10-17 | 159,334 | 151,806 | 80/80 | 33,371 | 103,588 | 10,463 | 4,384 | +10 / +55 | 19/19 | 160 | 140 |
| 10-18 | 161,332 | 151,582 | 80/80 | 32,798 | 104,658 | 10,265 | 3,861 | +7 / +42 | 10/10 | 160 | 140 |
| 10-19 | 165,010 | 156,483 | 80/80 | 31,585 | 109,217 | 11,132 | 4,549 | +7 / +32 | 14/14 | 160 | 140 |
| 10-20 | 160,559 | 151,549 | 80/80 | 32,726 | 104,254 | 10,435 | 4,134 | +0 / +5 | 13/13 | 160 | 140 |
| 10-21 | 160,393 | 151,785 | 80/80 | 33,631 | 104,469 | 9,960 | 3,725 | +11 / +39 | 12/12 | 160 | 142 |
| **14 days** | **2,250,671** | **2,112,214** | | **470,966** | | | | | | **2,240** | **1,910** |

- **Denominators and controls, every day:** raw lines counted by timestamp prefix = parsed rows (0 unparseable);
  model + deterministic = rows; triples = model decisions; the labels sum to them; refused + admitted = model
  decisions; 80 of 80 roster bots with rows. **Join: 0 unexplained misses on every day** (e.g. 10-08: 74,673 of 74,673
  executed decisions joined; the 10,168 runner-refused are void and have no row by construction). ES: llm within 15,
  skill within 120, `_death` / `_stagnation` / `_milestone_complete` within 2 (largest event diff 1). Every (code
  version, system hash) pair rebuilt from its own version. Raw: 160 of 160 files (80 bots x llm + skill).
- **Regression control:** the productionised extractor's 10-20 summary equals the committed prototype's on all 577 of
  its keys, and 10-20's ES counts equal the committed crosscheck.
- **Archive control:** all 2,240 raw members of the 14 days were hashed FROM THE NAS'S BYTES on .30 (`--adopt-raw`,
  relay `members`); 2,240 of 2,240 equal the sha256 of the local copy.
- **Near-duplicates (s.1.5 "measured at M1"):** 5.0% of 10-20's model decisions share a near-key with an earlier one
  (7,535 of 151,549); among TRAIN good decisions none exceeded k = 3 per (bot, near-key, action).
- **Cost on the fleet host:** ~4.3 min per day at nice 19 / ionice idle, 0.84 GB peak RSS; ~135 MB per day on the
  NAS (~50 GB a year).

### 5.2 Install

- **10.0.0.31:** `~/learnloop/app/scripts/{learnloop,lib}/` at the commit in its `VERSION`; crontab
  `50 1 * * * cd /home/mike/learnloop/app/scripts/learnloop && PATH=/usr/bin:/bin /usr/bin/nice -n 19 /usr/bin/ionice -c3 /usr/bin/python3 -B nightly.py --tick >> /home/mike/learnloop/cron.log 2>&1`;
  state in `~/learnloop/{state.json,heartbeat.json,nightly.log}`, local days in `~/learnloop/days/`, held raw in
  `~/learnloop/rawhold/` (1.2 GB), relay key `~/.ssh/id_learnloop_relay`. Installer: `scripts/learnloop/install-m1.sh`.
- **M2b script:** `~/drop16.sh` on 10.0.0.31, sha256 `b911c6edd812e67ce841f5d228f8d8dd7dd1fdb048d745bde1a7394288c28f0d`
  (= `scripts/host/drop16.sh` at this branch's head; the installer stages it by rename, refuses while a drop16 run may
  be live, and fails unless the two hashes match).
- **10.0.0.30:** `~/bin/learnloop-relay.sh` and one `restrict,from="10.0.0.31",command=...` line in
  `~/.ssh/authorized_keys` (backup `authorized_keys.bak-learnloop-20261022`).
- **NAS:** `/volume1/homes/mike/learnloop/daily/2026-10-08 .. 2026-10-21/`; `.last-good` = 2026-10-21.

### 5.3 Dataset v0 (`~/learnloop/datasets/v0/` on .31; immutable)

- Days 10-08..10-21 (14). The newest 2 days (10-20, 10-21) are held out for every world. Held-out worlds, drawn once
  with `secrets.SystemRandom`: **board-a, placebo-d, isolated-c**. The split seed is recorded in the MANIFEST.
- Cells (model decisions): TRAIN 1,462,110; A (held-out worlds x old days) 346,770; B (training worlds x new days)
  244,889; C (held-out x new, the headline) 58,445.
- Stage-1 TRAIN good: 335,189 kept of 337,198. Out: 2,008 gemma4 brain-01 rows (v0 is qwen2.5 only) and 1 nonce
  mismatch. 2,114 (skill, milestone) strata; the largest are gather|gather_dirt 74,722, explore|patrol 57,307 and
  mine|gather_iron_ore 51,430.
- Leakage control: 0 of 346,770 A and 0 of 58,445 C decisions share a prompt+action or near-key with a TRAIN
  decision; B 3 and 27 of 244,889. **This is a within-world check only:** a cross-world control (TRAIN-days decisions
  of different worlds, 1,808,880 decisions, 1,736,764 distinct near-keys) found 0 near-keys shared by two worlds, so
  prompts carry world-specific text and a cross-world match is impossible by construction. The 0 for A and C says the
  held-out worlds are not copies of training prompts; it cannot say anything finer.
- Natural preference pairs (same bot, same near-key, good vs bad, different action): **49**. That is too few for
  stage 3 from natural pairs alone; constructed (teacher) pairs will have to carry it.
- Pilot pool: 946,087 hard decisions (TRAIN cell, complete prompt, refused or failed/aborted, void out). The 1,000-item
  sample covers 109 (class x skill) strata and 25 failure classes.

## 6. Teacher pilot plumbing (Mac only) -- DRY RUN, nothing sent

`scripts/learnloop/teacher/teacher_pilot.py` on the Mac mini. The keys stay in `~/.config/mcai/`, mode 600; `plan`
checks their mode and owner with `stat` and never opens them. Sample: `~/learnloop/teacher/pilot-1000.jsonl` (from v0).

`python3 scripts/learnloop/teacher/teacher_pilot.py plan` (10-22, no network):

| arm | condition | requests | batches (<= $10 reserved) | expected | reserved (upper bound) |
|---|---|---|---|---|---|
| B claude-opus-5-5 (Anthropic Batches) | blind | 1,000 | 5 | $21.83 | $47.79 |
| B | informed | 200 | 1 | $4.61 | $9.80 |
| C gpt-6.1-sol (OpenAI Batch) | blind | 1,000 | 3 | $10.91 | $23.89 |
| C | informed | 200 | 1 | $2.31 | $4.90 |
| **total** | | **2,400** | **10** | **$39.66** | **$86.39** |

- Expected = 3.41 M input tokens per 1,000 items (the items' own qwen counts x 1.35) + 1,500 output per item.
- Reserved = output at the request's max_tokens 4,096 (thinking counts as output and cannot be turned off on Opus 5.5).
- Blind only: expected **$32.74**, reserved $71.68. Each vendor's reservation fits under 80% of its $100 cap
  (anthropic $57.59, openai $28.80). This matches the design's ~$35 blind / ~$42 with the informed condition.
- Safeguards: the ledger (`~/learnloop/spend.jsonl`) reserves durably before any vendor call, under a lock; a stopped
  submit resumes without re-paying; a 5-item probe per arm must be fetched and fully parsed before a full submit; no
  server-side fallback model (a refusal stays that arm's refusal). Paid answers land in `~/learnloop/teacher-paid/<arm>/`,
  quarantined: the dataset builder refuses them for training without a recorded owner decision.
- Not exercised against the live APIs (no money may be spent here): the vendors' structured-output subsets may reject
  parts of the fleet schema; the 5-item probe exists to find that out for under $0.30.

## 7. Reviews

Scope: the pipeline (extractor, nightly, relay, sysprompts, fleetstatus line), the endpoint-removal script and the
teacher client, plus the dataset builder and M3 tooling they feed. Codex = `codex exec --sandbox read-only`; Claude =
an independent subagent (read-only, local tests).

| round | commit | Codex | Claude | what changed because of it |
|---|---|---|---|---|
| 1 | 18afe782 | CHANGE (5 P1, 3 P2) | CHANGE (2 P1, 5 P2, 7 P3) | prune per proven member; deterministic MANIFEST + verify/manifest reconcile; unresolved days in the header; eval coverage gate; teacher reservations at max_tokens, durable, locked, Mac-only; drop16 verify after the last restart and kept hold on failure; byte-exact Modelfile + template check; end-to-end archive tests + mutants |
| 2 | 3fd09fa4 | CHANGE (2 P1, 2 P2, 1 P3) | CHANGE (1 P1 reproduced, 3 P2, 4 P3) | dry put/repair never records an archive; adopt via NAS-side member hashes (relay `members`); drop16 hold kept from the first mutation + `--hold-token` rollback; resumable teacher submits; cross-month reservations; export-check coverage; complete-set leakage; node check; stdout-only parsing |
| 3 | 82bf0b7c | CHANGE (1 P1, 1 P2) | CHANGE (1 P2, 2 P3) | adopted hold kept through rollback refusals; unique reservation ids; `--resubmit` never re-sends a submitted batch; locked `release`; repair tars adopted via `list` |
| 4 | f60f9c69 | CHANGE (doc: 1 P2, 1 P3) | **APPROVE** (code); report: 2 P2, 6 P3 | eval reference defaults to qwen2.5 and must be a run; report commands fixed (ssh, `--ref`, the installed eval copy, drop16 staged by the installer with its sha); within-world leakage stated with its cross-world control; environ = evidence, rows = tripwire; other-GPU guard |
| 5 | a64fe08e | CHANGE (1 P2 doc sha, 1 P3 log) | CHANGE (1 P2 in-place re-stage, 2 P3) | drop16 re-staged by rename, refused while a drop16 hold exists, sha compared; sha in s.5.2; nvidia-smi failure refuses; guard output in the run log |
| 6 | 786dac3c | **APPROVE** (no findings) | **APPROVE** (no findings) | -- |

Every finding of rounds 1-5 is answered in the commits that name it. Not runnable on the Mac, so run on 10.0.0.31
instead: the relay shell tests (in test_learnloop.py: 23 passed, 0 skipped there) and `scripts/host/test_drop16.py`
(7 passed).
