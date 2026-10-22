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
accepts five verbs -- `put`, `seal`, `verify`, `manifest`, `status`, `list` -- with day/name/sha regexes and a
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

PIPELINE NUMBERS: section 5.

## 2. M2b: remove 10.0.0.16 from every bot's endpoint list (SCRIPT READY, NOT RUN)

`scripts/host/drop16.sh`, staged as `~/drop16.sh` on 10.0.0.31. It rewrites one line in each of the 80 env files,
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
- **Rollback** `bash ~/drop16.sh --rollback <stamp>`: restores, restarts 12 s apart, verifies the old line.

Run it (owner, in a canary gap; a copy outside any repo):

    ssh mike@10.0.0.31
    bash ~/drop16.sh                 # must end "DRY RUN OK: --apply would proceed now"
    bash ~/drop16.sh --apply         # ~20 min; prints the backup stamp and the verify
    bash ~/drop16.sh --verify <T0>   # again at +60 min, and at +24 h: exclusion (i) of design s.5.2

Measured today (positive control, read-only): `--verify` found `10.0.0.16` in all 80 running bots' environ, and of
4,433 model rows since 11:30Z, 4,433 were served by .72 and 0 by .16. The dry run refused correctly on keepout-01
(drop-ins, a running loop, a declared canary, the canary lock).

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
2. Owner decision on the `ethan-gpu` llama-server: leave it (17.4 GB free; QLoRA-8B at seq 3,072 is expected to fit,
   measured by step 4) or stop it for the training window.
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

## 4. M3: the first offline training round

STATUS: section 5.

## 5. Numbers

(filled in below)

## 6. Teacher pilot plumbing (Mac only, dry run)

STATUS: section 5.

## 7. Reviews

(filled in below)
