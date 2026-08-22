# Block 2 — Decision Record

**Dated 2026-08-21.** This document exists so that settled questions are not
re-litigated. If a decision below is to be reopened, it is reopened *here*, with
a date and a reason — not in a commit message.

Scope: everything decided between Block 1's close (2026-08-16) and Block 2's
close-out (2026-08-21). Block 2's seven-day clock **never started**; it produced
no runtime result and every decision below is about the *apparatus*.

Companions: [`block2-methods-report.md`](block2-methods-report.md),
[`block2-failure-taxonomy.md`](block2-failure-taxonomy.md),
[`block2-preregistration.md`](block2-preregistration.md).

---

## Part 1 — RETIRED claims

These are dead. Do not cite them, do not rebuild on them, do not re-derive them.

| # | retired claim | why it is dead | date |
|---|---|---|---|
| R-01 | *"Block 2 measured a memory effect."* | The seven-day clock never started. No arm comparison from Block 2 is admissible. | 2026-08-21 |
| R-02 | *"Entrapment is a nuisance; the binding constraint is cognition — better prompts or new verbs."* | Retired **as the diagnosis of the binding constraint**, not as a claim that cognition is fine. `stranded` and `no_path` are the top failure of six of nine verbs; 86.2% of 15,175 path events in one hour were the pathfinder's stuck detector. Mobility is what must be fixed first. **This does NOT retire prompting or model effects** — `6d09602`, `502bca6`, `8d46c7a`, `f30e619` and `f89d946` all record real ones, and the admission-gate regression in `3f1e942` is a decision-layer defect, not a mobility one. See O-06. | 2026-08-17 → 2026-08-20 |
| R-03 | *"Our reflex layer prevents mob deaths."* | There were no mobs. All worlds ran `difficulty=peaceful`; the `mindcraft` baseline it was compared against ran `normal`. 106 of its 110 deaths were mobs, against zero in this fleet's entire history. | 2026-08-19 |
| R-04 | *"Held chunk-column count explains the memory growth."* | Disproved by our own instrument: held columns flat at 329 while `arrayBuffers` climbed 20MB → 219MB over two hours. **Narrow scope:** this retires *the count of retained columns as the explanation*. It does **not** retire "the growth is ArrayBuffers" (measured, `fee480d`) nor rule out other chunk- or packet-derived buffers. The leak is **not found**; retained packet buffers are a *hypothesis*. See O-01. | 2026-08-20 |
| R-05 | *"`--max-old-space-size` bounds bot memory."* | It bounds the old space only. `heap_used_mb=172` while `array_buffers_mb=321` and RSS hit the 1G ceiling. | 2026-08-20 |
| R-06 | *"An immobile-fraction ratio gate protects comparability."* | Structurally cannot reject its own target case: it passes the known-confounded Block 1 at every slack value tried. Replaced by the **mobile**-fraction form at the same 2× threshold plus a 30% floor. | 2026-08-18 |
| R-07 | *"The mobility gate is sufficient to start a block."* | It passes eight equally-broken worlds by construction. Passed a 24h window with gather at 11%, productive:path 0.37, and 0/211 deposits. | 2026-08-20 |
| R-08 | *"`systemd active` + `NRestarts=0` means the fleet is healthy."* | 40 bots → 11 over 15 hours with all forty units green. | 2026-08-20 |
| R-09 | *"`MemoryHigh` is a safety measure."* | It throttles rather than kills, so it converted a visible crash into 15 hours of silent degradation. Removed. `MemoryMax` + `Restart=always` only. | 2026-08-20 |
| R-10 | *"`_livelock_escape` is a rescue path that never works."* | It was never *measured*: `status:'failed'` was hardcoded before the `goto` ran, across 2,305 relocations. Success there is **displacement**, not arrival. | 2026-08-20 |
| R-11 | *"Torches are a town-economy mechanism."* | Zero torches placed in the entire corpus; no bot has ever held one. Zero mob deaths in twelve days, so the rationale (mob suppression) has no evidence behind it. Torches remain as inert world setup; no endpoint depends on them. | 2026-08-18 |
| R-12 | *"Sleeping is part of the autonomous action space."* | 0 successes in 505 calls. Decisive objection is **arm-neutrality**, not the success rate: board and placebo bots travel to town by obligation, so a sleep mechanism whose opportunity rate depends on town-visit frequency is treatment-mediated. Cut. | 2026-08-18 |
| R-13 | *"Retained items (deposits) is a usable co-primary **as things stand**."* | 0 of 211 attempts in 24h; 8 of 823 over twelve days. **Pre-declared unmeasurable** by the pre-registered rule (≥30 fleet-wide and ≥1 per arm). **This retires the current status only.** The walk-home repair (`93b3a48`) routed `deposit` through `home()` and has never been measured on healthy material, so deposits remain a *candidate* co-primary — see O-04. | 2026-08-18 / 2026-08-20 |
| R-14 | *"Satellite chests near work sites would fix deposits."* | Rejected again, for the record. They change the estimand from "can a bot return home with value" to "can a bot touch a nearby cache", removing the return-home construct the endpoint exists to measure. | 2026-08-18 |
| R-15 | *"Seed `20260820` is usable material."* | A probe of 19 candidate sites found terrain spread from 11 to 116 blocks and **nothing both flat and wooded**. There was nowhere on that seed to put a town the fleet could operate from. Superseded by `31415926`. | 2026-08-20 |
| R-16 | *"One column is an adequate siting probe."* | A town on a dry spit in open water passes it. Replaced by a deterministic outward spiral scored over a 32-block radius. | 2026-08-20 |
| R-17 | *"An unequal decisions/bot-hour rate is automatically a fault."* | It is a fault only when the endpoint is **straining**. Measured: hive 79.9 vs board 57.4 decisions/bot-hour (28% spread) with p95 at 4.6s against a 30s cadence — behavioural, not capacity. Gating on it, or "fixing" it with an equal-slot scheduler, would mask the thing being measured. Now conditioned on strain, and reported as a covariate below saturation. | 2026-08-20 |
| R-18 | *"Stockpile perception belongs in Block 2."* | Deferred to Block 3 — treatment-mediated, same defect class as R-12. | 2026-08-17 |
| R-19 | *"Four arms × 5 bots in four worlds is an adequate design."* | The pool is the unit, so that design gives hive/board/placebo **n=1 each** — one observation per arm per repetition, and no within-repetition variance estimate at all. Any arm difference and any terrain luck are the same number. Superseded by 4×2×5 in eight worlds (`1a02f04`). | 2026-08-18 |
| R-20 | *"The runtime configuration can be read off the files and the provisioning script."* | Dead three separate ways: an unreadable `server.properties` made Paper run **defaults** while the correct file sat on disk (`a9ba5cd`); the world config said `normal` while the pre-registration said `peaceful` (`ee67c89`); and eight "deterministic" siting searches over one seed produced two different towns (`016b480`). **Ask the running server, not the disk.** | 2026-08-20 |
| R-21 | *"`noPath` / path success rate is the locomotion readout that matters."* | It is not where the failure was. Once `path_reset` was instrumented **by reason**, `stuck` dominated at 86.2% — a walking failure, not a planning failure — and `noPath`-based readouts had been pointing at the wrong layer (`fcb37fb`, `83cfacc`). Gate on the `stuck` share. | 2026-08-20 |
| R-22 | *"Watching the mobility covariate is an adequate daily health check."* | The bootstrap-exemption regression was **invisible in mobility and obvious in productivity**: crafting collapsed from 37 successes in 69 bot-hours to 1 in 27 while the covariate looked fine (`3f1e942`). The endpoint gets measured on every check-in, beside the covariate. | 2026-08-19 |

---

## Part 2 — VALIDATED infrastructure

**"Validated" here means one specific thing: demonstrated to work during
shakedown.** Block 2's clock never started, so nothing below is validated across
a repetition, and the third column states the actual limit of each claim rather
than implying more.

### 2.1 Detectors and gates

| component | what it is validated to do | and what it is NOT |
|---|---|---|
| `scripts/fleet-doctor.py` | Diff the **Minecraft server's** player list against the roster every five minutes and restart what is missing. The only non-self-reported membership signal in the stack; would have caught both faults that silently shrank this fleet. | **Membership only.** Its docstring states the telemetry-silence principle but the code does not implement it: a bot that is connected and silent still passes. Pair it with the ES cardinality check in C-01/C-13. |
| `scripts/shakedown-gate.py` | A pre-registered stop/go decision as an **exit code** (0 GO / 1 NO-GO / 2 INSUFFICIENT), not a judgement made at midnight. Correctly refused to start Block 2 on two separate windows. | Its committed defaults are the **Block 2** thresholds (fleet gather 20%, per-arm 10%, productive:path 0.5). The stricter per-world criteria in Part 4 are **not implemented** and must be written before they can be enforced. |
| Mobile-fraction statistic (2×, 30% floor, 500 windows, 10-min windows, net not range) | Discriminates on back-test: fails known-confounded Block 1 at every slack value (2.38×–4.20×), passes a known-healthy block at every slack value (1.08×–1.56×). | The back-test result is recorded in the pre-registration; **no fixture or captured dataset is committed** that would let the run be repeated from this repo alone. Committing one is cheap and should be done. |
| Viability gates (amendment 6) | Detect the specific fleet-wide brokenness they encode — gather rate, productive:path, dead non-observation labels, LLM tail, roster size — which the mobility gate cannot see by construction. Correctly failed seed `20260820` at gather 2.4% and productive:path 0.11. | **Not** a general "every arm equally broken" detector. Equal breakage through a channel with no gate passes silently. The set is a floor, not a proof of health. |
| `TERMINAL_LABELS` observation set | An explicit auditable list that keeps the 0%-success gate from punishing truthful telemetry. Of three labels initially read as dead rescues, exactly one was a genuine defect. | Only **partly** pre-registered: the amendment declares the *rule* and its rationale, but several individual labels are justified in code comments rather than in `block2-preregistration.md`. Move them, or the "declared set" claim weakens each time one is added. |
| `scripts/world-health.py` | Samples per-world TPS/MSPT from Paper itself, which is what turns "the arms had equal compute" from an assumption into a measurement — or voids a repetition honestly. | **Has no committed timer or service.** Until it does, it is a tool that can be run, not evidence that was collected. See taxonomy T-21. |
| `bots/src/evictor.mjs` | Runs, sweeps, unloads columns beyond radius 10 against `view-distance=8`, and reports every sweep. **Justified on correctness, not memory:** a column beyond the server's view distance is stale, and a bot reasoning about ore it "remembers" there produces `unreachable` failures indistinguishable from real navigation failures. Also the instrument that disproved R-04. | It **does not bound the leak** — that is exactly what it failed to do. And its numbers land in `skill.detail` (`text`), so they cannot be aggregated; see the detector gap in taxonomy T-01. |
| `scripts/observe-fleet.py` (RCON poller) | One ruler for two harnesses, from the server: position deltas, inventory deltas, health and player-list membership. Caught both harnesses grading their own homework in the same direction. | Inventory delta is **retained inventory**, not gather productivity — deposits, deaths and consumption all move it. Use it as a cross-check on the skill telemetry, not as the primary endpoint. |
| Server-side `deathCount` objective | A monotonic counter instead of a 30-second level poll that could never observe a death. Poll reported 0 across 8.5h while telemetry showed nine. | Counts deaths; says nothing about cause. Cause still comes from `skill.name:"_death"` / `skill.fail_class`. |

### 2.2 Provisioning discipline

| guard | rule it encodes |
|---|---|
| `provision-block2.sh` config-readability check | **Chown before chmod, then refuse to continue** unless the service user can read every file just written. Paper silently falls back to defaults on an unreadable config. |
| `TOWN-PLACED.json` marker | Any operation whose input is the world state it also mutates must be idempotent by **marker**, not by convention. |
| Search once, re-score N times | Determinism by construction beats determinism by hoping. `forceload` returns when *queued*; generation is async. |
| `_forceload` settle-wait | Read the centre column twice identically before scoring anything. |
| `wood_nearby()` and the canopy **band** | A filter made entirely of rejections optimises for the null site. Every siting rule set needs at least one positive requirement. |
| Explicit filebeat unit list | `include_matches` does exact matching; a glob matches nothing while the input reports healthy. Check the destination, never the transport. **⚠ Not committed** — this rule exists only in prose today (taxonomy T-21). |
| Identical cgroup envelopes (worlds and bots) | Identical is what matters, not generous. Same host is a design requirement; same scheduler is not. |
| `pregen-world.py` | Terrain caching is an arm effect made of chunk generation, invisible in skill telemetry. |
| `generate-roster.py` name refusal (`MC_NAME_MAX`) | Refuse to emit a configuration the server cannot accept. |
| Single endpoint, no fallback | A fallback to different silicon is not the declared per-bot rotation; every affected interval would be censored. Log the **served** model (`llm.model`), not the requested one. **Note:** this is the *default*, not an enforced invariant — `generate-roster.py --endpoints` still accepts a comma-separated list and rotates it, so the one-bucket check in C-16 is load-bearing. |

### 2.3 Methodological practice (the most portable output of Block 2)

1. **Pre-register, and amend only while no data exists** — stated as the
   legitimacy condition inside each of the six amendments.
2. **Implement every gate as a program with an exit code.** The immobile-fraction
   defect was only findable because the rule was executable.
3. **Back-test every gate against a block whose verdict you already know.**
4. **Dual independent review** (Claude + ChatGPT, separately, then reconciled),
   then check every disputed claim against the live cluster. This found the
   `difficulty=normal` mismatch, the torch/sleep/deposit economy result, and the
   capped-shaft `need_pickaxe` state.
5. **Declare conditions that are identical across arms**, precisely because no
   internal comparison can ever surface them.
6. **Two verdicts are not enough.** `INSUFFICIENT` must be distinct from `GO`.

---

## Part 3 — OPEN questions

Unresolved. Each has an owner-shaped next action, not an opinion.

| # | question | status | what would settle it |
|---|---|---|---|
| O-01 | **Where is the ArrayBuffer leak?** | Open. Chunk retention is *disproved*. Retained packet buffers are a hypothesis, given ~14,800 path and ~4,000 drowning events/hour. | Heap/allocation profile of a single bot over 6h with `--expose-gc`, correlated against per-kind event volume. A leak proportional to path-event count confirms the hypothesis. |
| O-02 | **Can the fleet reach 20% gather at all?** | Open, and it is the gating question for any further comparison work. Block 1's lifetime ceiling was ~10%; Block 2's shakedown ran 2.4%–11.0%. | A shakedown on `31415926` with the seed change, `MAX_TERRAIN_SPREAD` and the reflex fixes in place. If it still floors near 10%, the movement layer must change before any memory question can be asked. |
| O-03 | **Is the pathfinder ceiling upstream or ours?** | Open. Believed upstream (`mineflayer-pathfinder` stuck detector), but **the specific upstream issue numbers cited in planning could not be verified from this repo and must not be cited until confirmed.** | Reproduce with a **bare mineflayer client** (no harness) on the same world and seed — the established protocol here — and count `path_reset` reasons. |
| O-04 | **Are deposits recoverable as a co-primary?** | Open. Currently pre-declared unmeasurable. The repaired walk-home path (`93b3a48`) has never been measured on a healthy world. | The pre-registered rule, unchanged: ≥30 successful deposits fleet-wide and ≥1 per arm in a shakedown day. |
| O-05 | **All five Block 2 predictions.** | Untested, unmodified. hive > isolated; board between; board < hive on false belief; placebo ≈ isolated minus a travel tax; isolated highest stranding. | A block that passes both gate families. |
| O-06 | **Does model capability interact with the memory condition?** | **Partly settled, mostly open.** Settled: model and prompt choice measurably affect behaviour in the eval harness (`f30e619`, `502bca6`, `8d46c7a`). Open — and this is the part that matters — whether capability *interacts with the memory condition* in a live block. Open by pre-registered rule (amendment 1). If suggestibility falls materially with capability, the hive-vs-isolated contrast must be replicated with a stronger model for ≥2 days before any general claim. | `scripts/model-eval.py suggest` across ≥3 models. Existing evidence is n=13, mostly one bot — the *between-model* comparison is the sound part; the absolute rates are noisy. |
| O-07 | **Do two pools under the same treatment agree?** | Unanswered — this is the question the n=2 design exists to ask, and no repetition has run. | One completed repetition. The between-pool gap *is* the noise estimate. |
| O-08 | **Is a scheduled recycle acceptable, or is it a permanent confound?** | Open. Uniform and declared makes it defensible; it still means the block runs on a workaround for an unfixed leak. **C-11 alone is not sufficient:** a recycle resets in-process state and could interact with the treatment even when applied identically — arm-uniform is not the same as treatment-neutral. | C-11 makes the *interval* pass/fail; **C-23** checks that the treatment (the `STATE_DIR` lessons store) actually survives the restart. Both are needed, and the residual interaction stays a stated limitation. |
| O-09 | **What is the entrapment covariate's true effect size?** | Open. Block 1 inverted its own arm ranking during interim once trapped bots were freed. Neither ratio measured memory; both measured mobility. | Report exposure both ways (raw and mobile bot-hours) in every future analysis, as pre-registered. |
| O-10 | **Does `hits.total` truncation affect any published narrative figure?** | **Settled for this repo, open outside it.** A targeted grep found no `hits.total` or `track_total_hits` usage anywhere in `scripts/` or `bots/`; every count comes from `size=0` aggregations and `doc_count`, which are exact and uncapped. Remains open only for figures produced by external notebooks or ad-hoc queries not in version control. | Re-run `grep -rn "hits" scripts/ bots/` after any new analysis tooling lands, and set `"track_total_hits": true` on any query that ever needs an exact raw total. |

---

## Part 4 — Success criteria for the follow-on comparison block

**Twenty-three criteria, fixed here in advance.** These supersede the informal
three-criterion version. They are **not analysis endpoints** and must never be
reported as results: their only job is to answer *"is the apparatus measuring
anything at all"* before a seven-day clock starts, and *"is it still measuring
it"* while the clock runs.

**None of these is implemented yet.** `shakedown-gate.py` carries the Block 2
thresholds. Writing these as code — and back-testing each against a window whose
verdict is already known — is the first task of the next block, not a formality
after it.

**Some criteria overlap deliberately.** C-01/C-02/C-03 all touch the roster
because each catches it at a different stage: C-02 prevents a bad roster from
being written, C-03 proves the runtime matches what was written, C-01 proves the
world agrees with both. The Block 2 failures happened in the gaps between
exactly those stages. Redundancy across *stages* is intended; redundancy within
one stage is not.

Two rules govern the whole table:

- **No fleet mean satisfies a START gate unless the row says so.** Block 2's
  averages hid a dead world, a dead arm and a half-strength fleet.
- **A unit is alive only if all three agree:** systemd says active, RCON says the
  bot is in the world, and Elasticsearch has telemetry from it in the last 15
  minutes. Any two out of three is a fault.

| # | criterion | threshold | guards against | how it is measured | gate | on failure |
|---|---|---|---|---|---|---|
| **C-01** | **Balanced roster, three-way agreed** | Exactly 5 bots in each of 8 worlds; identical `cardinality(bot.name)` per arm; systemd/RCON/ES all agree | T-02, T-03, T-14 — the arm-asymmetric silent shortfall | `fleet-doctor.py --once` (exit 0) **and** ES `terms exp.arm` → `cardinality bot.name` on `mcai-skill-*` over `now-30m` | START + CONTINUOUS | START: do not start. CONTINUOUS: imbalance >10 min **voids the repetition** — this is not repairable after the fact |
| **C-02** | **Roster is emittable** | Every bot name ≤16 chars and unique; `generate-roster.py` refuses otherwise | T-03 | `awk -F= '/^BOT_NAME=/{if(length($2)>16) print}' env/*.env` empty | START | Rename; discard all telemetry produced before the fix |
| **C-03** | **Treatment assignment matches the manifest** | Every bot's live `MEMORY_SCOPE`/`MEMORY_POOL` equals the manifest; pool counts are exactly hive/board/placebo n=2, isolated n=10 | silently running the wrong experiment; losing the pool-as-unit design | `systemctl show mcbot@X -p Environment` for all 40, diffed against `env/block2-manifest.json` (the file `generate-roster.py` writes), keyed on `roster_sha`. Cross-check in ES: `terms exp.arm` x `cardinality exp.pool` must give hive/board/placebo 2 and isolated 10 | START | Do not start until manifest and runtime agree byte for byte. **The manifest must be frozen and hashed before the check** (C-20), or "make them agree" is a one-line edit |
| **C-04** | **Every world runs the config it was given** | 8 distinct listening ports; RCON-reported `difficulty`, seed, view-distance, `spawn-monsters`, `pvp`, `level-type`, `generate-structures`, `allow-nether` identical across all 8 **and** equal to the pre-registration | T-07, T-15 — Paper silently falling back to defaults; undeclared constants | Ask the **running server**, not the file: RCON per world; `ss -ltnp \| grep java` shows 8 ports; dump the effective config into the trial manifest | START + CONTINUOUS | START: fix ownership/config and rebuild. CONTINUOUS: any world down >5 min voids the repetition |
| **C-05** | **Identical material in all 8 worlds** | All 8 `TOWN-PLACED.json` identical in `x`, `z` and site statistics; exactly one marker per world; region-directory sizes agree after pre-generation | T-08, T-09, T-24 | `jq -r '.x,.z' /srv/block2/*/TOWN-PLACED.json \| paste - -` all equal; `ls /srv/*/TOWN-PLACED.json \| wc -l` = 8 | START | Rebuild worlds from a clean seed; do not "fix" one world to match |
| **C-06** | **The site is habitable, per world** | ≥3 of 24 sampled columns are tree at rings 48 and 80 blocks; canopy inside the declared band; terrain spread ≤ `MAX_TERRAIN_SPREAD` over the **walked** radius, not the platform | T-10 — all-negative criteria selecting the null site | Recorded in the town JSON by `place-town.py`, which writes every rejected candidate too | START | Reject the site and re-run siting; never hand-place |
| **C-07** | **Locomotion floor, per world** | `path_reset` with reason `stuck` **< 40%** of all path events, in **8 of 8** worlds, over a 6h qualification window | T-11 — the stuck storm that produced Block 2's 86.2% | ES `mcai-skill-*`: filter `skill.name:"_path_reset"`. The reason lives in `skill.detail`, which is `text`, so use a `filters` agg of `match_phrase` clauses — **or better, emit the reason as `skill.fail_class` first** and make it a `terms` agg. Split by world via the `bot.name` prefix | START + CONTINUOUS | START: do not start — this is terrain or movement layer, not tuning. CONTINUOUS: 2 consecutive hours above threshold in any world voids the repetition |
| **C-08** | **Productive : path-failure** | START ≥ **1.0**; CONTINUOUS floor **0.5**. The two numbers are deliberate and must both be written into the gate: 1.0 to begin, 0.5 to continue. Block 2's single pre-registered floor was 0.5 and it measured 0.11 and 0.37 — 0.5 is too close to a fleet that mostly fails to move to serve as a *start* bar. **The committed default in `shakedown-gate.py` is still 0.5 and must be changed, or C-08 silently degrades to the Block 2 rule** | T-12 — every arm equally broken | `shakedown-gate.py --min-productive-ratio`; `PRODUCTIVE` vs `PATH_FAILURE` sets | START + CONTINUOUS | START: do not start. CONTINUOUS: below 0.5 for 3h voids the repetition |
| **C-09** | **Gather competence, per world** | **≥15% in at least 6 of 8 worlds**, and **no world below 8%**, over a 6h qualification window | T-03/T-12 — a fleet mean hiding a dead world or a handicapped arm | ES `mcai-skill-*`: filter `skill.name:"gather"`, success = `skill.status:"success"` over all terminal attempts. **There is no `world` field** — derive it from the `bot.name` prefix (`hive-a-Alpha` -> `hive-a`), which equals `exp.pool` for hive/board/placebo and is `self-<bot>` for isolated. Either add a keyword `exp.world` to the mapping or split client-side; do **not** quietly fall back to `exp.arm`, which is precisely what hides a dead world | START | Do not start. This is the criterion Block 2 could never have met (ceiling ~11%) and it is the honest bar |
| **C-10** | **Deposit instrument is alive** | ≥30 successful deposits fleet-wide **and ≥1 in every arm** in the shakedown day — **unchanged from the pre-registration** | T-13/R-13 | ES `skill.name:deposit`, `terms exp.arm`, count `status:success` | START (non-blocking) | Does **not** block the start. Retained-items is reported **unmeasurable by pre-registered rule** and gathers stand as the sole confirmatory primary. Declared in advance so it cannot be argued afterwards |
| **C-11** | **No mandatory recycle more often than 24h** | No scheduled or emergency recycle interval < **24h**; zero `MemoryMax` kills in a 24h soak; and if a recycle exists, its interval is in the trial manifest and **identical for every arm** | T-01b, T-21 — leak containment becoming permanent, and arm-asymmetric restarts | `systemctl show mcai-fleet-recycle.timer -p OnUnitActiveSec`; `systemctl show 'mcbot@*' -p NRestarts` — **per-arm restart counts must not differ by more than 1** | START + CONTINUOUS | START: qualification fails; the leak must be fixed or the interval raised. CONTINUOUS: an unplanned restart imbalance >1 per arm voids the repetition. **Anti-gaming:** "declare a 24h recycle and say no more" does not satisfy this — the manifest must record *why* the recycle exists and what O-01 evidence remains open, so the workaround stays visible |
| **C-12** | **Memory is bounded and the right allocator is watched** | Per bot over a 24h soak: `arrayBuffers` slope < **10 MB/h**, RSS slope < **25 MB/h**, peak RSS < **70%** of the cgroup limit | T-01, T-05 — a flat heap while the process dies | **Not computable from ES today.** `_chunks_evicted` writes its numbers into `skill.detail`, which is `text`; and `mcai-skill-*` is `dynamic:strict`, so emitting `mem.array_buffers_mb` without declaring it first would **reject the whole document**. Prerequisite: declare the numeric fields in `infra/elk/apply-mappings.sh`, then emit them, then `date_histogram` + `max` per `bot.name`. Until then the working readout is `/proc/PID/status` plus `journalctl | grep 'chunk sweep'`. **Never gate on heap alone.** | START + CONTINUOUS | START: fix the leak. CONTINUOUS: any arm's median breaching for 3h voids the repetition |
| **C-13** | **No throttle-masking; liveness is positive** | `MemoryHigh` is `infinity` on **every `mcbot@` unit** — the *bot* units only; `provision-block2.sh` sets `MemoryHigh=5G` on the *world* units, which is deliberate and out of scope here. Plus: cgroup `memory.pressure full avg300` < 10; per-bot telemetry gap p95 < 120s and **no bot silent >5 min while systemd reports active** | T-05, T-02 | `systemctl show ... -p MemoryHigh`; `memory.pressure`; ES `date_histogram` per `bot.name` for max gap | START + CONTINUOUS | START: fail the soak. CONTINUOUS: fewer than 38 healthy bots for >10 min voids the repetition |
| **C-14** | **The instruments are audited before they are trusted** | Health-script fields match `systemctl show` key=value on 10/10 sampled units (no positional `--value` parsing); **zero terminal statuses written before their awaited action** | T-06, T-04 | `grep -rn '\-\-value' scripts/` returns no multi-`-p` call; `grep -rn "status: *'failed'" bots/src/` — each hit must be after the awaited call; and each declared observation label must be justified in the pre-registration | START | Fix instrumentation. Discard analyses computed with the old readout |
| **C-15** | **Every request/outcome event pair closes** | For each registered pair (`_prereq_adopted`→`_prereq_satisfied`, and any other request-shaped label on the observation allowlist), closure ratio **≥ 0.5** over 24h | T-18 — a dead loop hiding *inside* the allowlist that correctly exempts it from the 0%-success gate | ES `terms skill.name` over the registered pair, computed as a ratio | START + CONTINUOUS | START: repair the loop. CONTINUOUS: below 0.25 for 6h is reported as a covariate and the affected endpoint is footnoted |
| **C-16** | **Inference is neither strained nor arm-confounded** | Per-arm `llm.latency_ms` **p95 ≤ 15s and p99 ≤ 25s** (unchanged from the pre-registration — do **not** relax to 30s); decisions/bot-hour spread ≤10% **conditional on strain**, reported as a covariate below saturation | T-16/R-17 — an arm effect manufactured by hardware; and over-gating a behavioural difference | ES `mcai-llm-agents*`: `terms exp.arm` → `percentiles llm.latency_ms [50,95,99]`; single endpoint asserted via `terms llm.endpoint` = 1 bucket | START + CONTINUOUS | START: do not start. CONTINUOUS: >1h in breach pauses the run; if arms were affected unequally, void the repetition |
| **C-17** | **Equal compute per world** | Per-world 1-minute TPS within **5%** across all 8 worlds for ≥95% of samples | T-23 | `world-health.py --interval 60`, aggregated per world | CONTINUOUS | A world persistently below the others voids that repetition honestly rather than silently |
| **C-18** | **Every declared guard is a committed unit** | Each guard named in the runbook exists as a committed `.timer`/`.service` and is asserted active in pre-flight | T-21 — a guard that lives only in prose | `git ls-files \| grep '\.timer$'` covers each named guard; `systemctl list-timers 'mcai-*' --all` on the host | START | Do not start. A guard that is not in version control did not run |

| **C-19** | **Code freeze is observable in the telemetry** | Exactly **one** `code.version` and one `code.config_hash` across every document in the block window, on both indices | a mid-block deploy silently splitting the corpus; a bot left on an old build | `POST mcai-skill-*/_search?size=0 {"query":{"term":{"exp.block":"block3"}},"aggs":{"v":{"terms":{"field":"code.version","size":10}},"h":{"terms":{"field":"code.config_hash","size":10}}}}` → **one bucket each** | START + CONTINUOUS | START: do not start. CONTINUOUS: a second bucket appearing means an undeclared deploy — the block is reported as split at that timestamp, never silently merged. Declared deploys go in the trial manifest *before* the restart |
| **C-20** | **The clock starts against a frozen, hashed manifest** | One hash covering: `roster_sha`, every `env/*.env`, all eight `server.properties`, all eight `TOWN-PLACED.json`, the unit files, the timers and the ES mappings — recorded before the first block-window document | every "make them agree afterwards" evasion in this table, including C-03 and C-05 | `sha256sum` over the frozen set, written into the trial manifest and echoed as `code.config_hash` where possible | START | No hash, no clock. This is the criterion that makes the others un-gameable |
| **C-21** | **The field contract is checked before the block, not after** | Every field any gate queries exists in `infra/elk/apply-mappings.sh`; zero `strict_dynamic_mapping_exception` in the last 24h | the `dynamic:strict` failure mode, where one undeclared field **rejects whole documents** and the only symptom is a line in a shipper log — and the T-01 gap, where the numbers exist but are unaggregatable `text` | Run every gate query against the live index and require a non-error response; then `GET mcai-skill-*/_mapping` diffed against the fields the gates name. Check the shipper's error count, not its health status | START | Do not start. A gate that cannot execute is not a gate |
| **C-22** | **Delivery is verified from the destination** | ES document count per bot per hour is non-zero for all 40 bots; indexing lag p95 < 120s | T-14 — a shipper input that reports healthy and ships nothing | `date_histogram 1h` × `terms bot.name` on `mcai-skill-*`; compare `@timestamp` to ingest time | START + CONTINUOUS | START: do not start. CONTINUOUS: any bot with an empty hour is a fault until explained |
| **C-23** | **The treatment survives the intervention** | After every recycle, each bot's `STATE_DIR` lessons store is non-empty and its `MEMORY_POOL` unchanged; pooled arms still read the same store | a restart silently resetting the memory under study — the recycle is only defensible if it costs `WorkingMemory` and nothing else | Checksum/line-count the lessons store per pool immediately before and after a recycle; assert `MEMORY_POOL` from the live environment | CONTINUOUS | Any pool whose store is emptied by a recycle **voids that pool's repetition** — a treatment that does not survive the intervention is not the treatment being reported |

### 4.1 Anti-gaming rules

Written here because the person checking these gates is the person who wants to
start the block.

1. **The clock starts only after all START gates pass from a clean state.**
   Qualification, soak, world generation and remediation time are never counted
   as block time.
2. **No threshold in this table moves after data exists.** Moving a
   pre-registered number because it fails to reject data one dislikes is how a
   gate becomes decoration. If a threshold is wrong, that is a finding, and the
   block is re-run.
3. **Adding a label to the observation allowlist is a claim** that must be
   justified in the pre-registration. It is not a way to silence a gate.
4. **A criterion is not satisfied by a fleet mean** unless its row explicitly
   permits one.
5. **`INSUFFICIENT` is not `GO`.** A gate that passes because an arm shipped no
   telemetry is worse than no gate.
6. **Uniform does not mean free.** A workaround applied identically to every arm
   (the recycle) is defensible, but it is declared in the manifest and it is
   pass/fail by C-11 — not permanent by habit.

### 4.2 Where these came from, and what was rejected

The list was produced independently by this author and by an adversarial ChatGPT
consult, then reconciled. Three of the consult's proposals were **rejected** and
the reasons are recorded so they are not re-proposed:

| rejected proposal | why |
|---|---|
| *"deposit success rate ≥20% per arm" as a START gate* | Unreachable by two orders of magnitude (measured 1.2% over twelve days) and would be waived on the first run, which is how a gate becomes decoration. Replaced by C-10, the pre-registered **event-count instrument check** that explicitly does not block the start. |
| *"global LLM p95 < 30s"* | Looser than the already pre-registered ≤15s / ≤25s. A close-out document must not silently relax a locked threshold. Kept at 15s/25s in C-16. |
| *"per-world path success rate ≥70%"* | No `path` skill has a success rate anywhere near that in any recorded window, and "path success" is not a field the telemetry defines cleanly. Replaced by C-07, which gates the `stuck` **share** of `path_reset` — a quantity that exists, was measured at 86.2%, and has a defensible threshold.

Three of the consult's proposals were **adopted essentially unchanged** because
they close real Block 2 holes the author's own list missed: C-03 (treatment
assignment verified against the runtime, not the config), C-14's second half
(zero terminal statuses written before their awaited action, as a *source-side*
grep rather than an ES query), and C-17 (equal compute per world as a continuous
gate rather than a one-off provisioning claim).

A second adversarial pass over the drafts added five more, and these are the
ones most likely to be skipped as bureaucracy and most costly to skip: **C-19**
(code freeze visible as a single `code.version` in the telemetry), **C-20** (the
frozen, hashed clock-start manifest, which is what makes C-03 and C-05
un-gameable), **C-21** (the field contract — several detectors in the first
draft of the taxonomy queried fields that do not exist, and `dynamic:strict`
turns that into rejected documents rather than an error), **C-22** (delivery
verified from the destination), and **C-23** (the treatment survives the
recycle).

The same pass caught a class of defect worth recording on its own: **the first
draft of the failure taxonomy contained detector queries that would silently
return zero** — `kind: path_reset` instead of `skill.name: "_path_reset"`,
`skill.failClass` instead of `skill.fail_class`, `llm.model_served` instead of
`llm.model`, a `terms` aggregation on a `text` field, and a `world` field that
does not exist. A document of detectors is only as good as the field names in
it, which is exactly why C-21 requires every gate query to be *executed* before
the block rather than merely written.

---

## Part 5 — What Block 2 is for

Block 2 is the block where the apparatus learned to disbelieve itself.

Its output is not a memory effect. It is: a gate that returns an exit code and
was back-tested against a block whose answer was already known; a health check
that asks the one layer in the system that cannot report itself healthy while
being broken; a provisioner that refuses to continue rather than producing eight
worlds that look provisioned; a pre-registration amended six times, each time
with the date and the reason and the fact that no data existed yet.

The next system inherits those. It does not inherit a result, and this document
exists so nobody claims otherwise.
