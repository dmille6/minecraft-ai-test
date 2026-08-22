# Block 2 — Failure Taxonomy

**2026-08-21.** This is not a bug list. It is a list of **detectors**, and the
field that matters most in every entry is *why the health checks missed it*.

**Most** of the failures below reported themselves healthy, and that is the
through-line: in this stack the signals were self-reported by the layer being
asked, and every self-reported signal that was checked turned out to be wrong at
least once. The Minecraft server is the only layer that cannot report itself
healthy while being broken, which is why so many detectors here end at RCON.
Three entries do not fit that pattern and are kept because they are still worth
the detector: T-19 (a check that worked and disproved its author), T-22 (a plain
CLI trap) and T-23/T-24 (risks caught before they bit).

**How to use this at 1am:** find your symptom in the index, jump to the entry,
run the example query. If it fires, the *minimal detector* column tells you the
smallest permanent check to add.

### Read this before running any query below

The telemetry shape is not obvious and several plausible-looking queries return
zero rather than an error.

| you might write | it is actually |
|---|---|
| `kind: chunks_evicted` | `skill.name: "_chunks_evicted"` — `logEvent({kind})` writes `skill.name = "_" + kind` (`bots/src/logger.mjs`) |
| `kind: path_reset` / `kind: death` | `skill.name: "_path_reset"` / `skill.name: "_death"` |
| `skill.failClass` | `skill.fail_class` — `logSkill` maps the camelCase argument to the snake_case field itself |
| `llm.model_served` | `llm.model` |
| a `world` field | **there is none.** Derive it from the `bot.name` prefix (`hive-a-Alpha` → `hive-a`), or use `exp.pool`, which equals the world for hive/board/placebo and is `self-<bot>` for isolated |
| `terms` on `skill.detail` | **`skill.detail` is `text`.** It cannot be aggregated. Use a `filters` aggregation of `match_phrase` clauses, or add a keyword field |

The `mcai-skill-*` and `mcai-llm-*` templates are **`dynamic: strict`** — an
undeclared field does not get indexed, it **rejects the whole document**. Adding
a field to a detector means adding it to `infra/elk/apply-mappings.sh` first.
Keyword fields available on both: `exp.block`, `exp.arm`, `exp.pool`,
`exp.memory_scope`, `exp.instance`, `bot.name`, `bot.role`, `code.version`,
`run_id`, `trigger`; plus `skill.name`, `skill.status`, `skill.fail_class`
(keyword) and `skill.duration_ms`, `skill.distance_moved`, `bot.pos.x/y/z`
(numeric) on the skill index.

**Severity scale**

| | meaning |
|---|---|
| **CRITICAL** | silently invalidates the experiment — produces numbers that look like results |
| **HIGH** | destroys or biases a measurement, visibly enough to be caught late |
| **MEDIUM** | costs time, rebuilds or a window of data; does not bias a comparison |
| **LOW** | operational friction |

**Provenance.** Every number is quoted from the commit or pre-registration
amendment that recorded it, cited inline. Nothing was recomputed: the ES cluster
at `10.0.0.186:9200` answers but requires credentials that are (correctly) not
in the repo. Where a claim could not be verified against this tree it says so.

---

## Index

| ID | symptom in one line | class | severity | preserve? |
|---|---|---|---|---|
| [T-01](#t-01) | RSS climbs to the cgroup ceiling; JS heap is flat and healthy | leak | CRITICAL | **YES** |
| [T-02](#t-02) | 40 units `active`, `NRestarts=0`, and 29 bots are not in the world | masking | CRITICAL | **YES** |
| [T-03](#t-03) | Two arms run 10 bots and two run 8, silently, all soak | arm asymmetry | CRITICAL | **YES** |
| [T-04](#t-04) | Relocation events record 0% success no matter what happened | instrument lies | CRITICAL | **YES** |
| [T-05](#t-05) | A safety measure (`MemoryHigh`) converts a crash into 15h of silent degradation | masking | CRITICAL | **YES** |
| [T-06](#t-06) | Health report prints `restarts=143060992` | instrument lies | HIGH | **YES** |
| [T-07](#t-07) | Config is correct on disk and the server is running defaults | provisioning | CRITICAL | **YES** |
| [T-08](#t-08) | Eight worlds from one seed, two different town sites | determinism | CRITICAL | **YES** |
| [T-09](#t-09) | Running siting three times produces three towns | idempotence | HIGH | **YES** |
| [T-10](#t-10) | A site passes every rejection rule and has no trees within 288 blocks | negative-criteria | HIGH | **YES** |
| [T-11](#t-11) | Every gate passes; 86% of path events are the pathfinder's stuck detector | upstream | CRITICAL | **YES** |
| [T-12](#t-12) | The comparability gate passes eight equally-broken worlds | gate blind spot | CRITICAL | **YES** |
| [T-13](#t-13) | The immobile-fraction gate passes a block already known to be confounded | gate blind spot | CRITICAL | **YES** |
| [T-14](#t-14) | Filebeat input reports healthy and ships zero events | telemetry gap | CRITICAL | **YES** |
| [T-15](#t-15) | A condition identical across arms is never declared, and invalidates an outside comparison | undeclared | HIGH | **YES** |
| [T-16](#t-16) | The roster's default endpoint points at hardware this block does not use | wrong default | HIGH | **YES** |
| [T-17](#t-17) | `deathCount` polled at 30s reports 0 deaths while telemetry shows nine | sampling | HIGH | **YES** |
| [T-18](#t-18) | A rescue path fires 479 times and closes 22 | dead loop | HIGH | **YES** |
| [T-19](#t-19) | A confident diagnosis is disproved by the author's own new instrument | epistemic | HIGH | **YES (the instrument)** |
| [T-20](#t-20) | A fix that only logs when it acts: silence means both "fine" and "never started" | ambiguous silence | HIGH | **YES** |
| [T-21](#t-21) | The runbook names a timer that does not exist in the repo | drift | HIGH | **YES** |
| [T-22](#t-22) | `--at -474,75` is parsed as an option name; seven worlds refuse | CLI trap | MEDIUM | no (fix at source) |
| [T-23](#t-23) | Eight Paper servers in one scheduling domain starve each other | shared resource | HIGH | **YES** |
| [T-24](#t-24) | An arm that explores into fresh chunks pays tick time another arm never pays | shared resource | MEDIUM | **YES** |
| [T-25](#t-25) | Operator guidance says "four units" and starts four of eight worlds | doc drift | MEDIUM | **YES** |
| [T-26](#t-26) | Mobility looks fine all day while crafting output collapses 37→1 | wrong dashboard | HIGH | **YES** |
| [T-27](#t-27) | A one-column probe passes a town built on a spit in a lake | point sampling | HIGH | **YES** |

---

## Class A — the health checks were self-reported

<a id="t-01"></a>
### T-01 · ArrayBuffer leak the heap limit cannot see

| field | |
|---|---|
| **symptom** | Every bot process sits at its 1GB cgroup ceiling. Host at load 35 on 24 cores. Servers begin dropping bots on protocol timeout. Node reports a **flat, healthy JS heap**. |
| **why the health checks missed it** | `--max-old-space-size=768` bounds the **old space**, not `ArrayBuffer`s. The growth was entirely chunk-column data in ArrayBuffers, so the cap added for exactly this risk did nothing, `--heapsnapshot-near-heap-limit` never fired (the heap never approached its limit), and every heap-based check read healthy while RSS thrashed the ceiling. Measured: `heap_used_mb=172 heap_total_mb=189 external_mb=325 array_buffers_mb=321` *(commit `fee480d`)*. |
| **minimal detector** | Log `process.memoryUsage().arrayBuffers` **and** `rss` on a fixed interval, per bot, as an event — never heap alone. Alert on the *slope*, not the level. |
| **example query** | **Presence** is queryable today: <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"term":{"skill.name":"_chunks_evicted"}},{"range":{"@timestamp":{"gte":"now-1h"}}}]}},"aggs":{"b":{"terms":{"field":"bot.name","size":40}}}}` <br>**The numbers are not.** See the detector gap below. Working shell check meanwhile: <br>`for p in $(pgrep -f 'mcbot'); do echo "$p $(awk '/VmRSS/{print $2}' /proc/$p/status)"; done` |
| **severity** | **CRITICAL** — it degraded the fleet to 27% strength with no signal, and it hits arms unequally (see T-01b). |
| **preserve?** | **YES.** The heap is not the allocator that kills a mineflayer bot. Any new apparatus that only bounds and watches the JS heap has reproduced this exact failure. |

> **DETECTOR GAP — open, and it should be closed before the next block.**
> `evictor.mjs` puts `array_buffers_mb`, `rss_mb` and the held-column count into
> `skill.detail`, which is mapped `text` and **cannot be aggregated**. The
> telemetry for the most serious defect in Block 2 is human-readable and
> machine-useless. Because `mcai-skill-*` is `dynamic: strict`, simply emitting
> `mem.array_buffers_mb` would cause every one of those documents to be
> **rejected whole**. Fix in this order: declare the numeric fields in
> `infra/elk/apply-mappings.sh`, then emit them, then the query above becomes a
> real slope alarm. Until then, the memory detector is `/proc`, not ES.

**T-01b — the containment, and why it is a confound if it is not uniform.**
The leak was **never fixed at source**. Measured once, at 2.3h against a 1GB
ceiling: `hive 401MB, isolated 367MB, placebo 360MB, board 349MB` *(commit
`36c67b3`)* — hive highest **in that sample**, which is the direction shared
memory would be expected to push (more content, longer prompts, more traffic).
That ordering is one measurement, not an established rate. It is enough to act
on, because the risk is asymmetric: left alone, **the arm that reaches the
ceiling first is restarted most often**, and a treatment arm perturbed more than the others is
exactly the confound this design exists to prevent. `scripts/fleet-recycle.sh`
converts an arm-asymmetric random failure into a uniform declared intervention
every arm receives identically. *This contains the symptom. It does not find the
leak.* A restart costs `WorkingMemory` (in-process, deliberately not persisted)
and keeps the lessons store in `STATE_DIR` — which is the memory under study.

> **Detector for the containment itself:** compare `NRestarts` per arm. If the
> per-arm restart counts differ by more than one, the intervention is not at
> parity and the repetition is confounded.
> `for b in $(ls /srv/mcbots/harness/env/*.env); do systemctl show "mcbot@$(basename $b .env)" -p NRestarts; done | sort | uniq -c`

---

<a id="t-02"></a>
### T-02 · The unit is green and the bot is gone

| field | |
|---|---|
| **symptom** | A forty-bot fleet degraded to eleven over fifteen hours and nothing reported it. All forty units `active`, `NRestarts=0`, journald showing a connect attempt every couple of minutes. |
| **why the health checks missed it** | **Every signal in the stack was self-reported by the layer being asked.** systemd knows a *process* is running; it cannot know the bot is *playing*. The bot's own log said "connecting", which reads as activity rather than failure. The cgroup ceiling (T-05) prevented the crash that would have made `Restart=always` fire. |
| **minimal detector** | Ask the **Minecraft server** who is connected, and diff against the roster. This is the one layer in the system that cannot report itself healthy while being broken. |
| **example query** | `./scripts/fleet-doctor.py --once` (exit 1 if anything is missing), or directly: RCON `list` per world, compared to `{world}-{Alpha,Bravo,Comet,Delta,Echo}`. Add the telemetry half: a bot connected but silent for longer than a few decision cycles is not healthy either — <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"range":{"@timestamp":{"gte":"now-15m"}}}]}},"aggs":{"b":{"terms":{"field":"bot.name","size":200}}}}` and compare the bucket count to 40. |
| **severity** | **CRITICAL** — every rate in the gate is a ratio whose denominator is the fleet. A quietly short roster produces numbers that look like results. |
| **preserve?** | **YES, and it is the single most important detector in this document.** The gate now refuses to compute rates without a roster check (`--expect-bots`). |

---

<a id="t-05"></a>
### T-05 · `MemoryHigh` throttles instead of killing

| field | |
|---|---|
| **symptom** | Processes stalled but never crashed. `memory.pressure full avg300 = 57.30`, **OOM kills in 16h: 0**. Servers quietly dropped bots that could no longer answer the protocol in time. |
| **why the health checks missed it** | `MemoryHigh` **throttles** a cgroup rather than killing it. So the process never died, `Restart=always` never fired, `NRestarts` stayed a flat zero — and `NRestarts` was the health signal. **The safety measure added to prevent a memory blowup is what converted it into a silent one.** |
| **minimal detector** | Do not set `MemoryHigh` on a workload whose health you infer from restarts. Keep `MemoryMax` (which kills) + `Restart=always`, so `NRestarts` becomes a signal instead of a constant. Independently: read `memory.pressure`, which is the number that was screaming. |
| **example query** | `systemctl show mcbot@hive-a-Alpha -p MemoryHigh -p MemoryMax` (MemoryHigh must be `infinity`) <br>`cat /sys/fs/cgroup/system.slice/'system-mcbot.slice'/memory.pressure` — `full avg300` above ~10 is a stall, not a load average. |
| **severity** | **CRITICAL** |
| **preserve?** | **YES.** Generalised rule, written into `bootstrap-block2-bots.sh`: **prefer a crash you can see.** A safety mechanism that degrades instead of failing has moved the failure somewhere no check is looking. |

---

<a id="t-06"></a>
### T-06 · `systemctl show -p` returns values in *its* order

| field | |
|---|---|
| **symptom** | The fleet report printed a bot's `MemoryCurrent` as its restart count: `restarts=143060992`. |
| **why the health checks missed it** | `systemctl show -p A -p B -p C --value` prints values in **systemd's own ordering**, not the order requested, so positional parsing silently mislabels every field. A human notices `restarts=143060992`; **a threshold does not**. "A health check that reports confident nonsense is worse than one that errors, because nobody double-checks a number that has a plausible label next to it." *(commit `049ca90`)* |
| **minimal detector** | Never use `--value` with multiple `-p`. Ask for `key=value` and read by name — as `fleet-doctor.py:unit_state()` now does. As a permanent guard, range-check: a restart count above ~10⁴ is a mislabelled byte count. |
| **example query** | `systemctl show mcbot@X -p ActiveState -p NRestarts -p MemoryCurrent` (no `--value`), then parse on `=`. <br>Regression test: `diff <(systemctl show mcbot@X -p NRestarts --value) <(systemctl show mcbot@X -p NRestarts \| cut -d= -f2)` |
| **severity** | **HIGH** — it corrupts the readout of the check that catches T-02. |
| **preserve?** | **YES.** The generalisation is broader than systemd: **any tool that returns a positional list of values you did not name is a mislabelling waiting to happen.** |

---

<a id="t-04"></a>
### T-04 · An event that reports its outcome before the action runs

| field | |
|---|---|
| **symptom** | `_livelock_escape`: 2,305 relocations in 24 hours recorded a **0% success rate no matter where the bot ended up**. |
| **why the health checks missed it** | `status: 'failed'` was hardcoded into the event and written **before** the `goto` executed. Nothing downstream can distinguish "a rescue path that never works" from "one that was never measured". The same defect class had already let `drowning_escaped` count ceiling timeouts as rescues — two systems grading their own homework, both erring toward a convenient answer. |
| **minimal detector** | The **declared observation set** in `shakedown-gate.py`: any event label with ≥100 firings and 0 successes is a defect **unless it is on `TERMINAL_LABELS`**. The discriminator is not "is the status hardcoded" but **"does this event report on an action it performed?"** An observation ("no shore is reachable") has no success available to it; an action report ("I relocated") owes an outcome. |
| **example query** | `./scripts/shakedown-gate.py --block block2 --hours 24` prints the dead-rescue section. Directly: <br>`POST mcai-skill-*/_search?size=0 {"query":{"term":{"exp.block":"block2"}},"aggs":{"n":{"terms":{"field":"skill.name","size":200},"aggs":{"s":{"terms":{"field":"skill.status"}}}}}}` → any bucket with `doc_count ≥ 100` and no `success` sub-bucket. <br>Source-side: `grep -rn "status: *'failed'" bots/src/` and check each is written *after* the awaited call. |
| **severity** | **CRITICAL** — it fabricates a result rather than losing one. |
| **preserve?** | **YES.** Also preserve the **allowlist discipline**: adding a label to the observation set is a claim that must be justified in the pre-registration, not a way to silence the gate. Three labels initially read as dead rescues; exactly one was. |

---

<a id="t-20"></a>
### T-20 · A fix whose silence is ambiguous

| field | |
|---|---|
| **symptom** | The chunk evictor was deployed. It produced **zero log lines** for a check-in period while RSS climbed 175MB → 351MB, and it was impossible to tell whether it was working perfectly or had never started. |
| **why the health checks missed it** | It only logged **when it evicted something**. "Running fine, nothing beyond the radius" and "never started at all" produce identical output. |
| **minimal detector** | A periodic component must emit a heartbeat with its **state**, not only its actions. `evictor.mjs` now reports every sweep (or every 10th when quiet: `QUIET_SWEEPS`) with `held`, `evicted`, `array_buffers_mb`, `rss_mb` — and `held` is also the number that says whether the radius is right. |
| **example query** | `POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"skill.name":"_chunks_evicted"}},{"range":{"@timestamp":{"gte":"now-1h"}}}]}},"aggs":{"b":{"terms":{"field":"bot.name","size":40}}}}` — **fewer than 40 buckets means an evictor is dead**, which is precisely what silence could not tell you before. Note `_chunks_evicted`, not `chunks_evicted`: `logEvent` prefixes the kind. |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Rule: *a fix whose effect cannot be measured is a hope, and a fix whose silence is ambiguous is not a fix you can trust.* |

---

## Class B — arm asymmetry, the confound this design exists to prevent

<a id="t-03"></a>
### T-03 · The 16-character username cap

| field | |
|---|---|
| **symptom** | Four bots never joined. The units stayed `active`, `NRestarts` stayed 0, journald showed a connect attempt every couple of minutes, and nothing anywhere reported a problem. |
| **why the health checks missed it** | Minecraft caps usernames at 16 characters and enforces it as a **protocol decode error**, not a readable rejection: the bot connects, is kicked with a netty `DecoderException`, and reconnects forever with a growing backoff. That reads as activity. **And the failure was arm-asymmetric:** `"Charlie"` (7) with `"isolated-a-"` (11) is 18 and with `"placebo-a-"` (10) is 17 — so the four Charlies in the isolated and placebo worlds never joined while hive and board kept all five bots each. **Two arms ran 10 bots and two ran 8, silently, for the whole soak.** |
| **minimal detector** | Two, and both are needed: (1) `generate-roster.py` **refuses to emit** a roster containing a name the server cannot accept (`MC_NAME_MAX = 16`); (2) `fleet-doctor.py` diffs the RCON player list against the roster every five minutes, which catches every future variant, not just this one. |
| **example query** | Pre-flight: `awk -F= '/^BOT_NAME=/{if (length($2)>16) print FILENAME": "$2}' env/*.env` — must be empty. <br>Live: `./scripts/fleet-doctor.py --once; echo $?` (non-zero = someone is missing). <br>Per-arm balance in ES: <br>`POST mcai-skill-*/_search?size=0 {"query":{"term":{"exp.block":"block2"}},"aggs":{"arm":{"terms":{"field":"exp.arm"},"aggs":{"bots":{"cardinality":{"field":"bot.name"}}}}}}` → **every arm must show the same cardinality.** |
| **severity** | **CRITICAL** — a silent, arm-asymmetric handicap applied to exactly half the experiment. Any comparison drawn from that period is between arms of different sizes. |
| **preserve?** | **YES — both halves.** The name check prevents this instance; the RCON diff prevents the class. "A fleet that looks healthy and runs short is worse than one that fails." |

---

<a id="t-23"></a>
### T-23 · Same host is a requirement; same scheduler is not

| field | |
|---|---|
| **symptom** | Eight Paper servers on one host. A world that loses ticks gives its bots fewer opportunities per wall-clock hour. |
| **why the health checks missed it** | Nothing in the *skill* telemetry can see it. It is an arm effect arriving through the **CPU scheduler** — GC, chunk generation or a disk stall in one world starving another — and it is invisible in every event the bots emit. The pre-registration requires one host (arms on different machines would turn every hardware difference into an arm effect); the cost is a shared kernel. |
| **minimal detector** | Identical dedicated envelopes per world (four pinned CPUs, equal quota, equal ceiling — `provision-block2.sh`), **plus a measurement that the pinning worked**: per-world TPS and MSPT sampled from Paper itself. |
| **example query** | `./scripts/world-health.py --out /var/log/mcai/world-health.jsonl --interval 60`, then <br>`jq -s 'group_by(.world)[] \| {world: .[0].world, tps: (map(.tps_1m) \| add/length)}' /var/log/mcai/world-health.jsonl` — **any world more than ~5% below the others voids the comparison window.** |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Without it, "the arms had equal compute" is an assumption; with it, it is a measurement that can be reported alongside the result — or void a repetition honestly. |

---

<a id="t-24"></a>
### T-24 · Terrain caching as an arm effect

| field | |
|---|---|
| **symptom** | Eight worlds from one seed are identical on disk and **not identical in cost**. |
| **why the health checks missed it** | An arm that wanders into fresh terrain under load pays chunk-generation tick time that an arm on already-generated ground never pays. It never appears in the skill telemetry — it appears as slightly worse everything, in one arm. |
| **minimal detector** | Pre-generate each world's full operating radius before any bot connects (`pregen-world.py --centre-from town-<arm>.json`), and assert it completed for all eight. Then watch T-23's TPS series for generation spikes during the block. |
| **example query** | `for w in hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b; do du -sh /srv/block2/$w/world/region; done` — **the eight sizes must agree**; a small one is under-generated. |
| **severity** | **MEDIUM** |
| **preserve?** | **YES.** Cheap to preserve, invisible if lost. |

---

## Class C — provisioning that looked provisioned

<a id="t-07"></a>
### T-07 · `chmod 600` without `chown`

| field | |
|---|---|
| **symptom** | All eight worlds bound the **default** port 25565. Seven crash-looped on "Address already in use"; the one that won the race ran on **default difficulty** with the declared settings sitting unread on disk beside it. |
| **why the health checks missed it** | `server.properties` was written by root with mode 600 and no `chown`, so the service user could not read its own config — and **Paper does not report this. It silently falls back to defaults.** The file was correct on disk and invisible to the process that needed it. "A config the server cannot read is not a config; it is a different experiment that looks provisioned." |
| **minimal detector** | The provisioner **chowns before it chmods**, and then **refuses to continue** unless it has verified the service user can read every file it just wrote. Ownership before mode, always. |
| **example query** | `sudo -u minecraft test -r /srv/block2/<arm>/server.properties && echo OK \|\| echo UNREADABLE` (this is the check in `provision-block2.sh`) <br>Confirm the config actually took effect rather than trusting the file: `ss -ltnp \| grep java` must show **eight distinct ports**, and RCON `difficulty` must return `peaceful` on all eight. |
| **severity** | **CRITICAL** — it silently substitutes a different experiment. |
| **preserve?** | **YES.** Generalised: **verify that the process read the config, not that the file contains it.** Ask the running server, not the disk. |

---

<a id="t-08"></a>
### T-08 · A deterministic search over non-deterministic reads

| field | |
|---|---|
| **symptom** | Eight worlds built from **one seed** produced **two different town sites** — two on a mountain at y=119, six on a plain at y=72. |
| **why the health checks missed it** | The search is deterministic; the reads underneath it were not. `forceload add` returns as soon as the request is **queued**, and generation happens asynchronously — so probing immediately reads terrain that does not exist yet, and the answer depends on how busy that world happened to be. Nothing errors. Both answers look like valid search output. |
| **minimal detector** | Two, because either alone leaves the hole open: (1) `_forceload` **waits for the centre column to read the same surface twice running** before anything is scored; (2) worlds 2..N **do not search at all** — they take the coordinates the first search found and **re-score** them, refusing to stamp if this world disagrees. |
| **example query** | `jq -r '.x, .z, .stats.y_spread' /srv/block2/*/TOWN-PLACED.json \| paste - - -` — **all eight rows must be identical.** Any divergence means the block is running on non-identical material and must be rebuilt. |
| **severity** | **CRITICAL** — terrain differences between arms are the confound the single-seed design exists to remove. |
| **preserve?** | **YES.** "Determinism by construction beats determinism by hoping." Run the search **once**; re-score everywhere else. |

---

<a id="t-09"></a>
### T-09 · Non-idempotent town stamping

| field | |
|---|---|
| **symptom** | Running `place-town.py` three times on one world produced **three towns in three places**. |
| **why the health checks missed it** | A stamped town **changes the terrain the next search scores**: the second search rejected the site the first had built on, and the third rejected both. Nothing failed. The eight worlds stayed identical to each other only because the mistake was made uniformly — which is luck, not design. |
| **minimal detector** | A `TOWN-PLACED.json` marker that records the decision and **refuses a second stamp without `--force`**. |
| **example query** | `ls /srv/block2/*/TOWN-PLACED.json \| wc -l` → must be exactly 8 <br>`grep -c town /srv/block2/<arm>/logs/place-town.log` → more than one stamp per world is the fault |
| **severity** | **HIGH** |
| **preserve?** | **YES.** The general rule: **any operation whose input is the world state it also mutates must be idempotent by marker, not by convention.** |

---

<a id="t-10"></a>
### T-10 · All-negative siting criteria

| field | |
|---|---|
| **symptom** | The first eight worlds scored **perfectly** — 0% wet, platform relief 2 — and had **zero trees within 288 blocks**. |
| **why the health checks missed it** | Every criterion was a **rejection**: reject water, reject canopy, reject relief. Together they select for flat dry **treeless** ground — and the entire tech tree begins at `oak_log`. A site can satisfy every rejection rule and still be uninhabitable, because all the rules were negative. |
| **minimal detector** | At least one **positive** requirement. `wood_nearby()` samples rings at 48 and 80 blocks and requires ≥3 of 24 columns to be tree — outside the town platform, inside walking distance. Canopy becomes a **band**, not a ceiling: too much and the surface probe is reading treetops; too little and nothing can bootstrap. |
| **example query** | The fleet said it within twenty minutes and this is the query that hears it: <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"term":{"skill.name":"craft"}},{"range":{"@timestamp":{"gte":"now-1h"}}}]}},"aggs":{"f":{"terms":{"field":"skill.fail_class","size":10}}}}` <br>(**`skill.fail_class`**, snake_case — `logSkill` maps the camelCase argument itself.) <br>**`missing_ingredients` at ~100% with zero bots ever holding wood is a siting failure, not a crafting failure.** Recorded: 57 craft attempts, every one `missing_ingredients: gather oak_log first`; 88 gathers `unreachable`. **Confirm the interpretation before blaming siting** — see T-26, where the same signature had a different cause. |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Generalised: **a filter made entirely of rejections optimises for the null site.** Every siting rule set needs at least one thing it requires to be present. |

---

<a id="t-16"></a>
### T-16 · A wrong default is worse than no default

| field | |
|---|---|
| **symptom** | The roster's default inference endpoint pointed at `10.0.0.190` — a host Block 2 does not use. |
| **why the health checks missed it** | It produces a roster that **looks correct** and runs against the wrong hardware. Nothing errors; the bots get answers, from the wrong silicon. Under the pre-registered per-bot rotation, every affected interval would have to be censored — a fallback to different silicon is not the rotation the design declares. |
| **minimal detector** | No fallback endpoint at all, and log the **served** model rather than the requested one (`llm.mjs`: endpoints may pin their own model). Then assert one endpoint fleet-wide. |
| **example query** | `grep -h OLLAMA_BASE_URL env/*.env \| sort -u` → must be exactly one line. **Note `generate-roster.py` still accepts a comma-separated `--endpoints` list and rotates it per bot** — a single endpoint is the default, not an invariant enforced by the type, so this check is load-bearing. <br>`POST mcai-llm-*/_search?size=0 {"query":{"term":{"exp.block":"block2"}},"aggs":{"m":{"terms":{"field":"llm.model","size":10}},"e":{"terms":{"field":"llm.endpoint","size":10}}}}` → **one model bucket, one endpoint bucket, or the window is censored.** (`llm.model` is the served model — `llm.mjs` logs what the endpoint answered with, not what was requested.) |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Prefer a missing required argument to a plausible wrong default. |

---

<a id="t-25"></a>
### T-25 · Operator guidance said "four units"

| field | |
|---|---|
| **symptom** | The runbook said "four units" and the operator started four of eight worlds. |
| **why the health checks missed it** | Documentation drifted behind the forty-bot amendment. A half-started fleet still produces telemetry, and every rate computed from it has the wrong denominator (see T-02). |
| **minimal detector** | Derive the expected world/bot count from the roster manifest rather than from prose, and check it. `generate-roster.py` writes `roster_sha`, `bots`, `worlds` and per-arm `independent_units_n` into a manifest for exactly this. |
| **example query** | `jq '.worlds, .bots, .roster_sha, .arms' env/block2-manifest.json` (the file `generate-roster.py` actually writes) compared against `systemctl list-units 'block2@*' --state=active \| wc -l` — must be 8 — and `./scripts/fleet-doctor.py --once` |
| **severity** | **MEDIUM** |
| **preserve?** | **YES** — as the manifest, not as the prose. The trial manifest declaring code version and fleet size before restart is already protocol. |

---

<a id="t-22"></a>
### T-22 · `--at -474,75` parses as an option name

| field | |
|---|---|
| **symptom** | Every stamp failed with `expected one argument`. Seven worlds refused before the cause was obvious. |
| **why the health checks missed it** | Coordinates start with a minus sign, and argparse reads a bare `-474,75` as an option. The error message names the wrong problem. |
| **minimal detector** | Document and require `--at=VALUE` (equals form), or accept coordinates as a positional/`nargs` pair. |
| **example query** | `./scripts/place-town.py <arm> --at=-474,75` (works) vs `--at -474,75` (fails) |
| **severity** | **MEDIUM** — pure time cost, no data impact. |
| **preserve?** | **No** — fix at source instead. Kept here only so the next operator does not spend the same twenty minutes. |

---

## Class D — the gates themselves had blind spots

<a id="t-13"></a>
### T-13 · The immobile-fraction gate could not reject its own target case

| field | |
|---|---|
| **symptom** | The pre-registered mobility gate **passed** Block 1's `fixed-arms-01b` — the block the pre-registration already describes as confounded by entrapment — at **every** slack value tried (1.31×–1.39× against a 2.0× limit). |
| **why the health checks missed it** | It was prose, not a program. It was only shown to be broken because it was **implemented and run against a block whose answer was already known**. The defect is structural: **a ratio of large fractions compresses toward 1 exactly when both arms are badly stuck**, which is the situation the gate exists to catch. Isolated 84.3% vs shared 61.9% immobile reads as 1.36×; the same measurements as *working* time read 15.7% vs 38.1% — 2.43×. |
| **minimal detector** | Bind on the **mobile** fraction (the form whose denominator matches the primary endpoint), keep the pre-registered 2× threshold, and **back-test every new gate against a block whose verdict you already know.** A gate that passes your known-bad data is decoration. |
| **example query** | `./scripts/shakedown-gate.py --block fixed-arms-01b --hours 168 --slack 4` — must return NO-GO. Run this as a regression test whenever the gate changes. |
| **severity** | **CRITICAL** |
| **preserve?** | **YES.** Preserve the *back-test practice*, not just the statistic. This is the most transferable methodological result Block 2 produced. |

---

<a id="t-12"></a>
### T-12 · Comparability without viability

| field | |
|---|---|
| **symptom** | The mobility gate returned a comfortable pass — `spread 1.42× (limit 2.0×), floor 52.3% (min 30%)` — on a 24-hour window in which gather was 11.0%, productive:path was 0.37, deposits were 0 of 211, and decisions/bot-hour differed 47.3% between arms. It passed the seed-`20260820` hour too (1.50×, worst arm 32.8%) while gather ran at 2.4%. |
| **why the health checks missed it** | The mobility gate protects **comparability**: it stops one arm being *more* trapped than another. **By construction it cannot notice that every arm is equally broken** — eight equally-crippled worlds pass it exactly as eight healthy ones do. |
| **minimal detector** | A second, orthogonal family of gates asking "is the apparatus measuring anything at all": fleet gather ≥20%, per-arm gather ≥10%, productive:path ≥0.5, LLM p95 ≤15s, roster complete. **They are start/no-start operational gates and must never be reported as results.** <br>**Know the limits of this family:** (a) it only detects the brokenness it encodes — a fleet equally broken through a channel with no gate still passes; (b) the deposit check is **deliberately non-blocking** (`shakedown-gate.py` does not append it to `fails`), because its purpose is to pre-declare retained-items unmeasurable, not to stop the block. Do not read a GO as "deposits are fine". |
| **example query** | `./scripts/shakedown-gate.py --block block2 --hours 24 --expect-bots 40` (exit 0/1/2) <br>`--skip-viability` reproduces the pre-amendment behaviour so the two gates can be compared on the same window. |
| **severity** | **CRITICAL** — this is the failure that would have started a seven-day block that measured mobility pathology and reported the residue as a memory effect. |
| **preserve?** | **YES.** Two gates, orthogonal, both required. Comparability and viability are different questions and neither implies the other. |

---

<a id="t-14"></a>
### T-14 · A telemetry input that reports healthy and ships nothing

| field | |
|---|---|
| **symptom** | Filebeat's journald input reports itself perfectly healthy and ships **zero events**. |
| **why the health checks missed it** | `include_matches` does **exact** matching, so `mcbot@*.service` silently matches nothing. There is no glob and no error — the input is healthy, it simply matches no journal entries. Downstream, every gate then sees an empty or partial corpus, which is why `INSUFFICIENT` had to be a distinct verdict from `GO`. |
| **minimal detector** | List all forty units **explicitly** in the filebeat config (as `bootstrap-block2-bots.sh` does), and check the corpus from the far end: count distinct `bot.name` in ES, not "is filebeat running". |
| **example query** | `POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"range":{"@timestamp":{"gte":"now-30m"}}}]}},"aggs":{"b":{"cardinality":{"field":"bot.name"}}}}` → **must equal 40.** Anything less is a shipping fault until proven otherwise. |
| **severity** | **CRITICAL** — silent partial telemetry is indistinguishable from a quiet fleet, and biases whichever arm loses shipping. |
| **preserve?** | **YES.** Rule: **check the destination, never the transport.** |

---

<a id="t-17"></a>
### T-17 · A poll interval that cannot catch the event it measures

| field | |
|---|---|
| **symptom** | The observer reported **0 deaths for both fleets across 8.5 hours** while our own telemetry recorded nine in two. |
| **why the health checks missed it** | It polled `health` every 30 seconds. Death and respawn complete well inside that window, so the sampler could never observe the transition — a clean zero, produced by a method that cannot produce anything else. |
| **minimal detector** | Read a **monotonic counter** rather than sampling a level: the server-side `deathCount` scoreboard objective, which accumulates and cannot be missed by a slow poller. |
| **example query** | RCON: `scoreboard players get <bot> deathCount` per poll, and diff. <br>Cross-check the instruments against each other: server `deathCount` delta vs <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"skill.name":"_death"}},{"range":{"@timestamp":{"gte":"now-8h"}}}]}},"aggs":{"b":{"terms":{"field":"bot.name","size":40}},"c":{"terms":{"field":"skill.fail_class","size":10}}}}` — **if two instruments disagree, that disagreement is the finding.** (`skill.name: "_death"`, not `kind: death`.) |
| **severity** | **HIGH** — a pre-registered secondary endpoint read exactly zero, plausibly. |
| **preserve?** | **YES.** Rule: **sample levels, count events.** Never infer an event rate from a periodic level read. |

---

## Class E — the runtime, and the limits of what a fix can fix

<a id="t-11"></a>
### T-11 · The pathfinder stuck storm

| field | |
|---|---|
| **symptom** | 15,175 path events in one hour, **86.2% with reason `stuck`** — mineflayer-pathfinder's own stuck detector. Gather 2.4%, productive:path 0.11. Both viability failures had this one cause. |
| **why the health checks missed it** | The mobility gate **passed that hour** (spread 1.50×, worst arm 32.8% mobile). The bots were mobile enough relative to each other; they were not failing to **plan** routes, they were failing to **walk** them. Nothing in the arm-comparison family of checks can see a fleet-wide floor. |
| **minimal detector** | The `productive : path-failure` ratio (`PRODUCTIVE` vs `PATH_FAILURE = {_path_noPath, _path_reset, _path_timeout}`) with a floor of 0.5, plus a per-hour breakdown of `path_reset` **by reason**. Below parity the fleet is mostly failing to move, whatever the arms look like relative to one another. |
| **example query** | The reason is in `skill.detail`, which is mapped **`text`** and cannot be `terms`-aggregated. Use a `filters` agg (reasons come from `resetPath()` in mineflayer-pathfinder 2.4.5): <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"term":{"skill.name":"_path_reset"}},{"range":{"@timestamp":{"gte":"now-1h"}}}]}},"aggs":{"r":{"filters":{"filters":{"stuck":{"match_phrase":{"skill.detail":"stuck"}},"goal_updated":{"match_phrase":{"skill.detail":"goal_updated"}},"chunk_loaded":{"match_phrase":{"skill.detail":"chunk_loaded"}},"block_updated":{"match_phrase":{"skill.detail":"block_updated"}},"dig_error":{"match_phrase":{"skill.detail":"dig_error"}}}}}}}` <br>**`stuck` above ~50% of path events means the terrain or the movement layer, not the agent.** <br>**Detector improvement to make:** emit the reset reason as `skill.fail_class` (already a keyword) so this becomes a one-line `terms` agg. |
| **severity** | **CRITICAL** — it is the reason Block 2 has no runtime result. |
| **preserve?** | **YES.** Carry the honest scoping too: the evidence supports **"`mineflayer-pathfinder`'s own stuck detector fired on 86.2% of path events"**. It does *not* by itself establish that the defect is upstream rather than something the harness provokes — the harness is known to interact with the pathfinder (the reflex layer's stuck detector calls `pathfinder.stop()`, and `runner.interrupt()` cancels goals mid-path), so a harness contribution is live. The remedy applied was terrain (seed change + `MAX_TERRAIN_SPREAD` gating the ground bots *walk over*, not just the ground the chest stands on), which is mitigation, not a fix. *Upstream issue numbers were cited in planning but could not be verified from this repo or offline — **unverified**; confirm against `github.com/PrismarineJS/mineflayer-pathfinder/issues` before citing them. The settling test is a **bare mineflayer client** on the same world (see O-03).* |

---

<a id="t-18"></a>
### T-18 · A rescue loop that asked trapped bots to travel

| field | |
|---|---|
| **symptom** | Over 24 hours: `_prereq_adopted` 479 → `_prereq_satisfied` **22** (5% closure), `_prereq_abandoned` 453, all at the 15-minute TTL. Every sampled detail read `dirt-class: had 0/8 after 916s` — **zero, every time, while the bot stood inside walls made of dirt.** |
| **why the health checks missed it** | `_prereq_adopted` is correctly on the **observation allowlist** (it records an intention whose outcome lives in a different event), so the dead-rescue gate does not fire on it. The failure is only visible as a **closure ratio across two event types**, which no single-label check computes. Root cause: the prerequisite bus assumes a bot can go and fetch what it lacks; a marooned bot cannot — having no route *is* what marooned means — so the two mechanisms asked for opposite things. |
| **minimal detector** | A **paired-event closure ratio** with a floor. `_prereq_satisfied / _prereq_adopted` below ~0.5 over an hour is a dead loop regardless of how healthy either label looks alone. |
| **example query** | `POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"range":{"@timestamp":{"gte":"now-24h"}}},{"terms":{"skill.name":["_prereq_adopted","_prereq_satisfied","_prereq_abandoned"]}}]}},"aggs":{"n":{"terms":{"field":"skill.name","size":5}}}}` |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Generalise it: **for every request/outcome event pair in the telemetry, register the pair and gate on its closure ratio.** The allowlist that (correctly) exempts a request from the 0%-success gate is exactly what creates this blind spot, so the two rules must ship together. |

---

<a id="t-19"></a>
### T-19 · A confident diagnosis, disproved by its own new instrument

| field | |
|---|---|
| **symptom** | The memory growth was diagnosed as chunk-world-model retention. A chunk evictor was written, deployed, and **it evicted correctly and changed nothing**: held columns stayed flat at 329 while `arrayBuffers` climbed 20MB → 219MB over two hours. |
| **why the health checks missed it** | Nothing missed it — **this is the entry where a check worked.** The diagnosis was wrong and was disproved *because* the fix was instrumented (T-20). The most likely remaining allocator is retained packet buffers, given ~14,800 path events and ~4,000 drowning events per hour, but **that is a hypothesis and is recorded as one.** The leak is not found. |
| **minimal detector** | Instrument every fix with the quantity that would show it working, and **state in advance what number would prove the diagnosis wrong**. Here: held-column count flat while `arrayBuffers` climbs falsifies chunk retention in one line. |
| **example query** | The falsifier is *held columns flat while `arrayBuffers` rises*. Both numbers are emitted by `_chunks_evicted` — **but only inside `skill.detail`, which is `text`** (see T-01's detector gap), so today this is read by eye or by grep, not by aggregation: <br>`journalctl -u 'mcbot@hive-a-Alpha' \| grep 'chunk sweep' \| tail -40` <br>Once the numeric fields are declared in `apply-mappings.sh` and emitted, it becomes: <br>`"aggs":{"t":{"date_histogram":{"field":"@timestamp","fixed_interval":"15m"},"aggs":{"held":{"avg":{"field":"chunks.held"}},"ab":{"avg":{"field":"mem.array_buffers_mb"}}}}}` <br>**Held flat + arrayBuffers rising = the diagnosis is wrong.** |
| **severity** | **HIGH** (as an epistemic failure mode; the instrument is the mitigation) |
| **preserve?** | **YES — preserve the instrument, and the habit.** The evictor is independently justified on **correctness** grounds regardless of memory: a column outside the server's view distance is **stale**, and a bot reasoning about ore it "remembers" there is reasoning about a world that no longer exists — `gather` failing `unreachable` on a block mined out an hour ago is indistinguishable in the telemetry from a real navigation failure. The radius is a correctness bound, not a memory knob. |

---

<a id="t-15"></a>
### T-15 · A condition identical across arms is invisible in an arm comparison

| field | |
|---|---|
| **symptom** | `difficulty=peaceful` was never written down. It was discovered only when an outside baseline (`mindcraft`) was stood up with `difficulty=normal` — producing 89 deaths to our 15, with **106 of its 110 deaths being mobs against zero mob deaths in this fleet's entire history**. That was briefly read as evidence that the reflex layer prevents mob deaths. It does not: there were no mobs. |
| **why the health checks missed it** | **Because it was identical across every arm.** Nothing in an arm comparison can see a constant. It stayed invisible right up until something outside the experiment was compared against it — and it silently voided two pre-registered secondary endpoints (death count, death cost) by removing an entire class of death. |
| **minimal detector** | Dump the **complete effective** server configuration for every world into the trial manifest at block start, and diff all eight against each other **and against the pre-registration**. Pin every setting that has a default — `pvp`, `level-type`, `generate-structures`, `allow-nether`, `spawn-monsters` — because "a default is a value that can change between one arm's world creation and the next with nothing reporting it". |
| **example query** | `for w in /srv/block2/*/; do echo "== $w"; grep -E '^(difficulty\|pvp\|level-type\|level-seed\|generate-structures\|allow-nether\|spawn-monsters\|view-distance)=' $w/server.properties; done \| sort \| uniq -c` — **every setting must appear with count 8.** Then ask the running server, not the file: RCON `difficulty` on all eight (see T-07). |
| **severity** | **HIGH** |
| **preserve?** | **YES.** The rule is the deliverable: **a constant is not self-documenting. Declare every condition that is identical across arms, precisely because no internal comparison will ever surface it.** |

---

<a id="t-21"></a>
### T-21 · The runbook names a timer that does not exist

| field | |
|---|---|
| **symptom** | The runbook's guard table names guards that have no committed implementation. Verified against this tree, **three** are prose only: <br>• **"fleet-doctor timer"** — no `.timer` unit exists for `fleet-doctor.py` <br>• **the "fixed 6-hour staggered recycle"** (commit `36c67b3`) — `fleet-recycle.sh` is a plain script with `STAGGER` defaulting to **6 seconds** and **no interval of its own**; nothing schedules it <br>• **"explicit filebeat unit list"** — no Block 2 filebeat config is committed anywhere (`grep -rn include_matches` matches only documentation) |
| **why the health checks missed it** | A guard described in prose is indistinguishable from a guard that runs. All three are perfectly capable of running — they simply are not in version control, so whether they ran depends on undocumented host state. **The containment for the CRITICAL leak in T-01 therefore has no reproducible schedule in git**, the detector for T-02/T-03 has no schedule, and the fix for T-14 has no artifact. |
| **minimal detector** | Commit the `.timer`/`.service` units and the shipper config alongside the scripts, and assert them in pre-flight: **a guard that is not in the repo is not a guard.** |
| **example query** | `git ls-files \| grep '\.timer$'` — must cover every guard the runbook names <br>`git ls-files \| grep -i filebeat` — must include the Block 2 input config <br>On the host: `systemctl list-timers 'mcai-fleet-*' --all` must show both, and `systemctl show mcai-fleet-recycle.timer -p OnUnitActiveSec` must read the declared, arm-uniform interval. |
| **severity** | **HIGH** — an undeclared or unequal recycle interval reintroduces the arm-asymmetric restart confound of T-01b directly, and an uncommitted shipper config reintroduces T-14. |
| **preserve?** | **YES**, and close it before the next block: **every declared guard must be a committed unit with an asserted schedule, and the recycle interval must be recorded in the trial manifest** so that "every arm received the identical intervention" is a checkable fact rather than an intention. |

---

## Class F — measuring the wrong thing, confidently

<a id="t-26"></a>
### T-26 · Watching the covariate all day and never checking the endpoint

| field | |
|---|---|
| **symptom** | A gate exemption meant to break a deadlock started admitting crafts the bot could not possibly make. `craft` calls 160, `missing_ingredients` **150**; the doomed items were `wooden_pickaxe` ×116, `stick` ×27, `stone_pickaxe` ×13; the bootstrap exemption fired 73 times. **Crafting output collapsed from 37 successes in 69 bot-hours to 1 in 27** in the same window. *(commit `3f1e942`)* |
| **why the health checks missed it** | Two ways, and the second is the important one. (1) The exemption waived `craft wooden_pickaxe` for any bot holding no pickaxe — **including bots holding no wood** — so attempts that were previously vetoed cheaply now executed and failed expensively, one runner slot each. (2) **The author had been tracking immobile fraction all day, because that is the covariate the pre-registration names, and never once checked the endpoint the experiment actually measures.** The regression was invisible in mobility and obvious in productivity. |
| **minimal detector** | Compute the **primary endpoint** — successful gathers per bot-hour — on every check-in, next to the covariate, never instead of it. And for any gate exemption: require the exemption to run the *same* satisfiability test the skill will run a second later (here, `recipesFor()`), so a waiver cannot admit an action that is already known to be impossible. |
| **example query** | Endpoint, per arm, per window — run this beside every mobility check: <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"term":{"skill.name":"gather"}},{"range":{"@timestamp":{"gte":"now-6h"}}}]}},"aggs":{"arm":{"terms":{"field":"exp.arm"},"aggs":{"s":{"terms":{"field":"skill.status"}},"bots":{"cardinality":{"field":"bot.name"}}}}}}` <br>Exemption health: <br>`... {"term":{"skill.name":"craft"}} ... "aggs":{"f":{"terms":{"field":"skill.fail_class","size":10}},"a":{"terms":{"field":"skill.args.item","size":20}}}` — **`missing_ingredients` dominating a single item name is a gate admitting doomed work, not a crafting bug.** (`skill.args` is `flattened`.) |
| **severity** | **HIGH** — it silently traded a cheap veto for an expensive failure 116 times, and it is the class of defect a mobility-only dashboard cannot see. |
| **preserve?** | **YES**, and it is the entry to re-read before designing a dashboard. The covariate is not the endpoint. A change can improve mobility and destroy productivity in the same window, and Block 2 caught this only by finally measuring the thing under study. It is also the reason T-10's "`missing_ingredients` means siting" reading must be **confirmed, not assumed** — the same signature had a completely different cause here. |

---

<a id="t-27"></a>
### T-27 · A one-column probe cannot see a lake

| field | |
|---|---|
| **symptom** | Drowning accounted for **21,442 of the fleet's logged events in 24 hours — roughly a third of everything.** *(commit `30ed3a8`)* Separately, drowning was 663 of 868 recorded deaths (76%), overwhelmingly underground in flooded caves. |
| **why the health checks missed it** | The siting test probed **one column** and asked only whether it was void or deep water. **A town on a dry spit in the middle of a lake passes that test perfectly.** Every downstream measurement then inherits an environment where a third of all events are drowning — and because all eight worlds shared the site, it was invisible as an arm difference (compare T-15). |
| **minimal detector** | Score a **radius**, not a point: water anywhere in the 13×13 platform footprint, >5% wet columns within 32 blocks, or any cardinal route to 32 blocks crossing water rejects the site. Then verify from the fleet's own event mix rather than from the scorer. |
| **example query** | Site-side, before any bot runs: `jq '.stats' /srv/block2/*/TOWN-PLACED.json` — `wet_fraction`, route checks and every rejected candidate are recorded there for audit. <br>Fleet-side, the number that would have caught it: <br>`POST mcai-skill-*/_search?size=0 {"query":{"bool":{"filter":[{"term":{"exp.block":"block2"}},{"range":{"@timestamp":{"gte":"now-24h"}}}]}},"aggs":{"n":{"terms":{"field":"skill.name","size":50}}}}` <br>**Any single environmental hazard above ~10% of all events is a siting failure, whatever the site scorer said.** |
| **severity** | **HIGH** |
| **preserve?** | **YES.** Two rules: **a point sample cannot characterise an area**, and **the fleet's own event mix is the audit on the site scorer.** Note also the incidental win — replacing a falling armour stand (up to 15 seconds per column) with a binary search is what made scoring hundreds of columns arithmetically possible at all. A correctness fix that is too slow to run is not a fix. |

---

## The five rules this taxonomy reduces to

1. **Never trust a layer's report on itself.** Ask the layer that cannot lie —
   here, the Minecraft server. (T-02, T-03, T-07, T-14, T-17)
2. **A safety mechanism that degrades instead of failing has moved the failure
   somewhere no check is looking.** Prefer a crash you can see. (T-05, T-01)
3. **Silence must be unambiguous.** A component that logs only when it acts
   cannot be distinguished from one that never started. (T-20, T-19)
4. **Two orthogonal gates, always: are the arms comparable, and is the apparatus
   measuring anything?** Neither implies the other, and each passes the other's
   failure mode. (T-12, T-13)
5. **Back-test every gate against data whose verdict you already know.** A gate
   that passes your known-bad block is decoration. (T-13)

And one that is really a sixth: **measure the endpoint, not only the covariate.**
Block 2 spent a day watching mobility while the thing under study regressed by a
factor of thirty. (T-26)
