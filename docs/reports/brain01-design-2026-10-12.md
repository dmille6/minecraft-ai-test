# brain-01: gemma4 on the Studio as the per-bot brain for 10 live bots (design, 2026-10-12)

Status: **STAGED, nothing installed or deployed.** Branch `brain01-on-0cdb1a8`. Owner approved planning on 10-10.
The new key on the fleet host (s.3) waits for the owner. Both engines review every piece before anything is queued.

## 1. Why: what a smarter brain can move

On 10-10, since 00:00Z, there were 82,666 model decisions on 80 bots. Each one was classified by its own row
(`~/brain01/abort_classify.py`); every aborted row landed in a named bucket, and each bucket prints an example.

**43% were refused at admission. These are the model's own bad choices:**
- repeat_loop: 19.9%;
- learned_avoid: 9.9%;
- cooldown: 6.1%;
- impossible y: 2.9%;
- bank gate: 2.3%;
- item not held or not real: 1.0%;
- count out of range: 0.9%.

**Admitted, then interrupted: 3.9%.** Preempted by a work order: 0.

**Failed: 25%.**
- runner paused: 6.9%;
- unreachable: 6.9%;
- unsafe: 2.4%;
- buried: 1.5%;
- cannot stand: 1.2%.

**The replay measured exactly these refusals,** on 1,008 real prompts:

| | qwen2.5:7b | gemma4 |
|---|---|---|
| repeats the 4x loop | 90% | 28% |
| repeats the action that really failed | 74% | 21% |
| hard-infeasible | 13% | 1.3% |

All three intervals exclude 0.

**What the brain cannot move:** pathing failures, interrupts, and work orders that the gate vetoes (29% repeat_loop
and 20% cooldown). Those are code.

## 2. The change (bot code; inert unless the env asks)

| piece | what | why |
|---|---|---|
| `OLLAMA_BRAIN_PRIMARY` (brain.mjs `composePool`) | one `url\|model\|brain\|timeoutMs` entry, **prepended** to the bot's own pool | the canary sets one variable; each bot keeps its own local endpoints, in its own order, as the fallback |
| per-endpoint timeout (llm.mjs `parseEndpoint`) | the Studio gets 15 s; local keeps LLM_TIMEOUT_MS | a slow or dead Studio costs one short wait. A bad label or timeout is refused at startup |
| `OLLAMA_THINK` (ported from 8e80080) | sent only to labelled endpoints when the pool has any | the local fallback gets today's exact request; qwen2.5 answers "does not support thinking" to `think` |
| `llm.brain` on every decision row | serving endpoint's label, `local`, `order` (work order), or null (nothing served) | which brain decided. Work orders were logged as the model before this |
| model_mismatch vs the endpoint's pinned model | | it would otherwise fire on every gemma decision |
| `_brain_config` / `_brain_share` skill rows | written only by a bot with a labelled endpoint; the baseline writes 0 | licencecheck scans skill rows only, so this is the canary's licence kind |
| ES mapping | `brain` plus `args_cleaned`, `args_cleaned_fields`, `model_mismatch` | the logger already wrote those three and the strict template lacked them. Under `dynamic:strict` an unmapped field rejects the whole row |

**Tests:** `bots/test/brain01.test.mjs`, 20 tests with a fetch stub that honours AbortSignal, the real logger and
the real CognitiveLoop. They cover:
- falling back within the primary's own budget;
- skipping the primary while it cools down, then recovering;
- 502 and connection refused;
- `think` byte-identity when unset;
- the row, with every logged field mapped;
- labelled vs unlabelled loops, a work order labelled `order`, and the share row;
- the pool composition, including a child process.

**Mutants:** `brain01-mutants.py`, 15 of 15 killed. **Full suite:** 242/244 at 0c77d904. The two failures are
`gather-reach` (passes alone, 2 of 2) and `well.test` (fails identically on the base 0cdb1a8: a pre-existing failure,
not brain-01).

## 3. The path from the fleet host to the Studio

The Studio is reached only by ssh to `ai.ticrcorp.com` (WAN :11434 closed; never 192.168.19x). The mini is controller
only, so the live path is on the fleet host itself:
- `infra/brain/mcai-studio-tunnel.service` forwards `127.0.0.1:11601` to the Studio's `127.0.0.1:11501`, with
  ServerAlive 10/3, ExitOnForwardFailure and Restart=always/5 s.
- **Owner decision needed:** a new key `id_ed25519_brain01` on 10.0.0.31, added to the Studio's authorized_keys
  restricted to `restrict,port-forwarding,permitopen="127.0.0.1:11501",command="/usr/bin/false"`
  (`infra/brain/authorized_keys.line`). Not created and not placed.
- A dead tunnel means connection refused, which means the local fallback at once. The drill measured it (s.5).

**Studio side:**
- `brainproxy.py` (launchd plist, KeepAlive):
  - strict json_schema;
  - think goes into chat_template_kwargs;
  - it reports `gemma4:26b` only when LM Studio says the loaded identifier served the answer;
  - it fails fast: 503 above 12 in flight, 502 on any upstream error.
- `brain-keeper.sh` (every minute):
  - holds `GPU_RESERVED=brain01-live`, so the bench queue, which unloads models, waits;
  - reloads the model if it is missing.

## 4. Capacity (Studio, gemma4 MLX 8-bit, self-paced bots, 0 errors, 0 misses at 45 s)

| bots | p50 | p95 | p99 |
|---|---|---|---|
| 10 | 3.1 s | 6.8 s | 12.4 s |
| 12 | 3.4 s | 9.8 s | 14.2 s |
| 16 | 4.2 s | 13.6 s | 23.7 s |

So brain-01 is capped at **10 bots (2 pools)**. The 15 s budget sits above p99 at 10 bots. Nothing else runs on the
Studio: the bench queue waits on the reservation, and the overseer is parked.

## 5. Sandbox proof of the fallback (sandbox4, 4 bots, fleet code 0cdb1a8 + brain-01, 10-12 11:57-12:41Z)

Drills on the Studio, 3 min each. Rows are the bots' own decision rows (`bench/models/brain01/drill_read.py`).

| window | decisions / bot-min | gemma4 | local | nothing served | schema-valid | p50 / p95 |
|---|---|---|---|---|---|---|
| healthy (positive control) | 1.12 | 35 | 0 | 0 | 100% | 1.9 / 3.4 s |
| network blackholed (hang) | 1.08 | 0 | 13 | 0 | 100% | 16.6 / 25.3 s |
| +20 s latency | 1.33 | 1 | 15 | 0 | 100% | 11.5 / 17.3 s |
| +8 s latency (under budget) | 1.08 | 12 | 0 | 0 | 100% | 9.8 / 10.7 s |
| 502, model unloaded at the proxy | 1.41 | 0 | 16 | 0 | 100% | 2.1 / 4.4 s |
| proxy killed | 1.24 | 0 | 15 | 0 | 100% | 2.8 / 36.7 s |
| LM Studio model unloaded | 1.25 | 0 | 16 | 0 | 100% | 2.2 / 21.5 s |

**No decision went unserved** (0 nothing-served rows in 214), and the decision rate held in every window.

**Recovery after each drill:**
- 13 to 55 s for most of them.
- 337 s after the proxy restart. That is the pool's existing exponential cooldown: 60 s·2^(n-1), at most 900 s.
  Bots decide locally in the meantime.
- After the model reloaded: 26 s.

**Before going live (tunnel-drop drill):** the long local p95 in the kill windows (36.7 s) is qwen2.5 on the Studio's
Ollama standing in for the fleet's 5080 in this sandbox. Live, the fallback is the bot's own fleet GPU. A drop of the
fleet-host tunnel itself is the one drill not run, because the tunnel does not exist yet. It must be run (`systemctl
stop mcai-studio-tunnel` for 3 min) before the canary.

## 6. Power at today's rates

Placebo DiD of 2 random pools against the rest, adjacent 6 h windows over 3 days, 31 pools, 418k decisions
(`~/brain01/power.py`):

| metric | fleet mean | null DiD SD | MDE80, one 6 h read |
|---|---|---|---|
| refused-at-admission share | 0.420 | 0.088 | 0.25 (59% of the mean) |
| success share | 0.252 | 0.067 | 0.19 |
| stagnation events / bot-h | 3.2 | 0.95 | 2.65 |
| items / bot-h | 54.9 | 18.2 | 51 (93%), report only |

- **The read can see a large brain effect on refusals,** which is what the replay predicts. The C1 sandbox gemma vs
  7B gap on stuck time was more than 50%.
- **It cannot see a 10-20% production change.** Reads extend to 24 h (`extra_reads`) and the verdict says what its
  power was.
- **The gates do not depend on power:** liveness, fallback, nothing served, schema-valid, slow decisions, mismatch
  and config are deterministic on the canary's own rows.

## 7. The read (`scripts/brain01/brainread.py`)

**Gates.** Any failure means REVERT:

| gate | rule |
|---|---|
| G1 | gemma4 share of model decisions >= 0.80 |
| G2 | local share <= 0.20 |
| G3 | nothing-served rows per bot-hour <= control + 0.5 |
| G4 | gemma4 schema-valid >= control's - 0.01 |
| G5 | gemma4 decisions slower than 45 s <= 0.5% |
| G6 | mismatch rows = 0 |
| G7 | every canary bot's `_brain_config` names gemma4 first |

**Primaries (DiD):**
- refused share;
- success share;
- stagnation per bot-hour;
- stone and iron pickaxe crafts per bot-hour;
- items per bot-hour (report only).

**Decision rate per bot-hour is reported, not gated.** A 3 h placebo read of two untouched pools gave DiD -20% with
no change at all. That read was also the negative control for the gates: G1, G4 and G7 failed on pools that had no
brain, as they must.

**Harm:** the loop's death gate (two-death floor) is authoritative.

## 8. Keep on a fixed subset: what KEEP means when the Studio serves 10 bots, not 80

- **`promotion: keep-subset`:**
  - The **code** is promoted fleet-wide. It is inert without the env.
  - The **env** becomes permanent on exactly the canary's 2 pools. `mcai-brain-subset apply` writes a marked block
    into those bots' harness env files (backups first), records `/srv/mcbots/brain-subset.json {run, pools, bots,
    env, since}`, restarts them 12 s apart, and verifies each live process's environment.
  - `remove` undoes it.
- **Later canaries:**
  - **drawrec never draws** a subset pool.
  - **verdict.py never uses** a subset bot as control.
  - Together these keep every later read on one brain.
  - The tripper is unaffected: the subset runs the same code version.
- **Roster regeneration** (`generate-roster.py`) would drop the block. Run `remove` before it and `apply` after. This
  is written into the tool's header.

## 9. What the canary machinery needs (staged patches in `docs/reports/brain01-staging/`, against the host files' md5s)

- **`canary-loop.sh`:**
  - reads `canary_env`, validated as KEY=VALUE without spaces;
  - passes it as `CANARY_ENV` to `fleet-deploy`. fleet-deploy already carries it through sudo, and `mcai-canary-tree`
    already writes it into `canary.env` and refuses CODE_VERSION/RUN_ID. fleet-deploy exits 4 if a live canary bot
    lacks a key;
  - at teardown, verifies that no bot of the pools still carries the env in `/proc/<pid>/environ`. The version labels
    cannot show it;
  - a `keep-subset` promotion branch.
- **`canary-sched.py`:**
  - accepts class `model-env`, which must carry `canary_env`, `draw_k` of 1 or 2, and promotion `keep-subset` or
    `none`.
- **`drawrec.sh`:**
  - `draw_k` caps the draw;
  - brain-subset pools are excluded.
- **`verdict.py`:**
  - CONTROL_BOTS excludes the brain subset.
- **Version tag:** brain-01 is a code+env canary. Its sha is the brain-01 branch rebased on the fleet base, so the
  tripper sees two versions, as for every canary. The pure same-sha env canary is NOT supported: deploy-fleet.sh
  cannot find a baseline. Supporting it is not needed.
- **nightwatch:** its MODEL/ENV branch triggers only on equal shas, so it is not used here. Its lost scripts
  (`modelshare`, `cooldid4`) are replaced by brainread.

## 9a. Round-1 reviews (Codex: A/B/C CHANGE; Claude: A CHANGE, B APPROVE, C CHANGE) and what changed

| finding | change |
|---|---|
| a bad 200 from gemma was repaired by gemma again; total failure walked the pool twice | for a LABELLED pool: repair goes to the next endpoint; total transport failure ends the decision. Unlabelled pools are unchanged, with request bytes verified identical to 0cdb1a8 |
| no positive test that a real loop builds the tally | a child-process test constructs a real CognitiveLoop with and without `OLLAMA_BRAIN_PRIMARY`. Mutants: 19 of 19, each killed by an assertion; the driver restores in `finally` and exits 1 on a survivor |
| ES template does not touch existing indices | `apply-mappings.sh` also PUTs the four llm fields onto existing `mcai-llm-*` indices. Live ES already maps the other three; only `brain` is new. **Apply before the deploy** |
| the proxy certified a missing identity as gemma4 | `lmstudio:unknown` unless LM Studio names the loaded identifier. Upstream timeout cut from 60 s to 20 s |
| keeper: no release, no job, could overwrite | owns only `brain01-live`, never overwrites another holder (writes KEEPER-BLOCKED), releases when not live; its own launchd job. Tested on every state |
| the key line allowed `-R` | `permitlisten="127.0.0.1:1"`, plus a verification list to run after the owner places the key |
| subset tool not resumable or exact | record first, removed last; exact-value verification of every bot; resumable; refuses a second subset; positive proof on remove (`test_brain_subset.sh`) |
| the read did not fit the loop contract, and was slow | `brainread.py <M>`, bound to the manifest, `readjson.emit`. It reads only the window's rotated files: **11 s at +180 and 18 s at +360** on the fleet host, against 111 s before |
| the gates could pass on one live bot | per-bot G8; unserved counted by `endpoint` null in both arms; G7 checks the FIRST endpoint; G5 is total decision time p95 canary vs control + 15 s. Synthetic tests include one-live-bot-of-five and a no-brain negative control |
| own_lines would not REVERT | `evidence: defect` on the gates; `immobiledid` added to reads |
| KEEP at +360 on 50 bot-h | exposure is now 200 bot-h + 6,000 gemma4 decisions + every bot on gemma4, so no KEEP before ~20 h. **KEEP means "live, safe and decided by gemma4 for a day"; the primaries are ADVISORY and go to the owner** |
| keep-subset inside the loop could close early | the loop does a normal KEEP teardown, then pages the operator's one command (`subset-pending`); this run registers `promotion: none` |
| teardown could claim success on an unreadable environ | each pool bot's environ is read as root; missing or unreadable is not proof; `torn-down` is journalled only after proof |
| canary-tree not pinned; `\|` and `:` unverified | snapshot + md5 pin `26da45da...` checked by the loop; a value with `\|` and `:` verified through the real CANARY_ENV loop and a real systemd EnvironmentFile on the fleet host. Glob characters are refused, because canary-tree word-splits unquoted |
| draw cap could fall back to 4 pools | drawrec fails closed: an unreadable registration, or model-env without draw_k 1..2, draws nothing |

**Not changed, by design:**
- fleet-deploy checks one unit's environ; G7 and G8 check every canary bot from its own rows.

**Owner decisions:**
- **(a)** the key placement (s.3);
- **(b)** a kept subset holds `GPU_RESERVED=brain01-live` for as long as it lives, so the Studio bench queue stops for
  that time;
- **(c)** before any keep-subset, every reader with its own control must adopt the subset exclusion. verdict.py and
  immobiledid are patched; the others are listed at that time.

## 9b. Gate calibration on untouched pools (Claude r2, before queueing)

**Why:** G3, G5 and G8's floor compare against the control or set a population floor, and `gates_failed` is
`evidence: defect`, read 5 times. So these clauses were run on untouched pools. G1, G4 and G7 fail on brainless pools
by construction and were not read.

**What ran:**
- `brainread.py` dry-run on 4 untouched pool pairs: hive-a+b, hive-c+d, board-c+placebo-b, placebo-d+isolated-a;
- windows of 180, 360 and 1440 min, each ending now, 8 h ago and 16 h ago;
- 36 reads on the fleet host, one process at a time under nice, about 300 MB, with no emit;
- output in `brain01-staging/gate-calibration-20261012.txt`.

**Result: 0 of 36 tripped.**

| clause | worst value seen | gate |
|---|---|---|
| G3 unserved per bot-h | 0 in both arms, every window | <= control + 0.5 |
| G5 decision p95 | at most +1.9 s over the control (the d-pools, on the 3090: 5.2-6.2 s vs 4.0-4.4 s) | <= control + 15 s |
| G8 floor | no bot below it, in any window | per bot |

**One false failure fixed before it could happen:** 16 pools carry a stale `-Charlie` log dir from a rename, and it
would have failed G8 on every read. The read now takes bots from the live roster (`/srv/mcbots/harness/env`).

## 10. Order (owner 10-10, coordinator 10-12)

1. Step (0): done.
2. The plumbing above, with both engines APPROVE.
3. The replay on today's prompts (s.11).
4. 3 blocks of sandbox closed loop on today's code (s.12).
5. The owner's key decision, then the tunnel drill.
6. Queue brain-01 after airpocket-02.

## 11. Replay on today's prompts (step 2, 10-12)

**The sample:** 420 real decisions from 10-12, drawn from the fleet's own `llm-*.jsonl` (75,433 model decisions, 80
bots). It is stratified as in A2 and capped per bot. Every prompt is from 0cdb1a8, so the town-deposit, withdraw,
compost and well era is in it.
- Each model got the fleet's own system prompt, rebuilt from 0cdb1a8 and matched by hash: 3 of 3 hashes, 420 of 420
  items.
- gemma4 ran on LM Studio MLX 8-bit with the strict json_schema (the proxy's translation). qwen2.5:7b ran on Ollama
  with the fleet's grammar.
- Scored by `bench/models/score.py`. Positive control: on the 7B's own logged actions, the hard check fires on 100%
  of `craft_missing` items and 50% of `bad_args` items.

| | gemma4 (MLX 8-bit) | qwen2.5:7b (the fleet's) |
|---|---|---|
| schema-valid | 99.3% (3 not_json) | 99.5% (2 sentinel) |
| hard-infeasible or bad args | **1.4%** | 11.4% |
| **executable choice (100 - bad)** | **98.6%** | 88.6% |
| repeats the action that really failed | **15.9%** | 67.8% |
| repeats the 4x loop | **28.3%** | 95.0% |
| same skill as the logged action | 57.8% | 86.7% (mostly self-agreement) |

**The three invalid gemma answers** each ran an integer into thousands of digits (`"count": 125000000…`) until
`num_predict` (512 tokens) cut it off. The fleet's grammar has no `maximum` on integers.
- qwen does the same at a lower rate: today the gate refused `count 1000000000000000 outside 1..128` 738 times.
- Live, such an answer is repaired by the local fallback (s.9a), at the cost of one long generation.
- **Follow-up (not brain-01):** bound the integers in `skillSchema`. It is a fleet-wide schema change, so it needs its
  own canary.

## 11b. Sandbox closed loop (step 3): see s.12

## 12. Sandbox closed loop (pending)
