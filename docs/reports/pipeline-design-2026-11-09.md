# pipeline-01: pipelined decisions (2026-11-09)

Owner 11-09 ~14:30Z: "lets do 1,2,3" -> idea #1 of `docs/reports/minecraft-ai-landscape-2026-11-09.md`: **plan while acting.**
Borrowed from Parallelized Planning-Acting ([arXiv 2503.03505](https://arxiv.org/html/2503.03505v2): a planner thread writes
the next action into a one-slot buffer while the actor executes) and Project Sid / PIANO
([arXiv 2411.00114](https://ar5iv.labs.arxiv.org/html/2411.00114): fast non-LLM reflexes, one controller owns the decision).
Tier 3 (`cognitive.mjs`, `admission.mjs`). Built on workboard-01 `3d8ef9de` (fleet canary now). Switch: `PIPELINE=off|shadow|on`.

## 1. What the time between decisions actually is

24 h to 11-09 12:00Z, 80 bots, 1,920 bot-h, 165,906 model calls, 159,329 real skill runs. Scripts: `~/pipeline-1109/pipegaps.py`
and `piperuns.py` on the canary host (full walks of `skill-*` and `llm-*`, rotation-aware, via `~/workboard-1108/lib`). Positive
control: the same walk finds 209,531 llm rows, 165,906 model calls, 16,658 pausewait and 8,355 vetoskip rows; workboard's
`wbmeasure.py` over the day before gives the same totals within 0.1% (165,943 calls, decision 54.3%).

For every model call, the gap is measured from the last thing that ended before it to the call's start, and filed under
**what ended**:

| Before the model call | Calls | Gap, bot-h | % of bot time | Mean gap | What the gap is |
|---|---:|---:|---:|---:|---|
| a run that ended **success** | 54,721 | 215.1 | 11.2% | 15.0 s | **waiting for a decision**: the bot is done, nothing argues for waiting |
| a veto (the gate refused the last pick) | 38,013 | 169.0 | 8.8% | 16.0 s | pacing: the cooldown-20s canaries (09-11, 3 pools) showed a shorter wait here buys vetoed re-proposals, not actions |
| a veto + VETOSKIP's skipped tick | 8,032 | 60.1 | 3.1% | 26.9 s | pacing (fewerdec) |
| a failed / unknown / no_effect run | 47,563 | 208.3 | 10.8% | 15.8 s | pacing: the failed key's 45 s cooldown; re-proposal risk |
| the runner's failure pause (3 failures) | 6,030 | 202.2 | 10.5% | 120.8 s | safety valve |
| an aborted run (reflex handoff) | 10,331 | 43.2 | 2.3% | 15.2 s | the reflex owns the next decision |

84% of the calls after a success sit in the 15-20 s bin (12% at 0-5 s: early ticks and reflex triggers). The model call itself
is 89.6 bot-h (4.7%); 27.4 bot-h of it is the call after a success. **So the removable part is 11.2% (gap) + 1.4% (call)
of bot time = 242 bot-h a day.** Everything else is a deliberate wait and stays.

Prefetch pricing (`piperuns.py`): model-admitted runs end success 49%, failed 30%, unknown 11%, aborted 8%. A failed model run
is short (p50 0.7 s, 67% under 2 s), a successful one long (p50 16.8 s, p25 5.3 s). After a model run that succeeded, the
next decision is a model call 75% of the time and an order 19%. By skill: bucket 0% success (4,808 runs), build 8%, gather
36%, mine 65%, explore 71%, place 73%.

## 2. Design

`bots/src/pipeline.mjs` (pure rules) + hooks in `cognitive.mjs` + `AdmissionControl.dryCheck`.

**Rule 1 -- no wait after a success (`on`).** After a tick's run that **ended `success`**, ran at least 1 s, was not
interrupted by a reflex, with no reflex trigger pending and the runner not paused, the next tick comes after 500 ms (the
CONTINUE early tick's step) and does not wait out the cooldown window. The work-order chain runs first, as today (orders,
workboard, continuations, remedies, exits); with no order the model is asked at once. Runaway guard: at most 4 no-wait
decisions per rolling minute (Mindcraft stops a bot whose actions start faster than its guard allows), then the cooldown.
Every other outcome keeps today's pacing.

**Rule 2 -- the prefetch (`shadow` and `on`).** A **model**-admitted run still going after 3 s starts the next model call in
the background, with the prompt of that moment (one composer, `#composePrompt`, for the tick and the prefetch) and the line
`LAST ACTION: <skill> <args> -> running now; plan the NEXT action as if it succeeds`. Only for skills this bot finishes at
least 30% of the time once they reach 3 s (an EWMA, prior 0.5), one in flight at most. At the next model call it is used
only if: the run that started it armed Rule 1, the tick is `idle`, no reflex trigger is pending, no order took the turn,
the task (milestone id) is unchanged, it is under 60 s old, it has a proposal, and **the gate's dry run admits it**. Then the
real `check()` admits it as this tick's decision and it runs. Otherwise one fresh call is made at once. A prefetch still in
flight is awaited at most 8 s.

**The dry run.** `AdmissionControl.dryCheck` runs the same `#check` on a copy of the proposal and puts everything back: the
repeat window, the veto streak, forced and milestone-critical counters, the probation count (peeked, never bumped, in memory
and in the persisted lessons) and the bot's deposit wants; no `repeat_progress` row. So the gate's state only ever sees the
one proposal a decision runs through `check()` (test: `check()` calls == decisions with every prefetch refused).

**Shadow.** Prefetches run and are judged at the next model call exactly as above, but the fresh call is always made and used,
and pacing is unchanged. Each `pipeline` row says `would_use` / `would_drop`, why, the prefetched and the fresh action keys,
whether they **agree**, and `saved_ms` (the gap since the armed run ended plus the fresh call: what `on` would remove).

**Reflexes stay outside.** Reflexes are unchanged deterministic code that take the body through the arbiter and interrupt
the skill. An interrupt (`r.interruptedBy`, ranked into the pending trigger) or any non-idle trigger (death, entombed,
startup, liveness) voids both rules: that decision goes to the model fresh, after today's wait. The model never interrupts a
running skill (2503.03505 lets the planner set the interrupt flag; here only reflexes do).

**Not aborted.** A prefetch that is not needed finishes and is dropped: `EndpointPool.markFail` would count a caller's abort
as an endpoint failure and cool that endpoint for every decision. Its cost is on its `pipeline` row (`lat_ms`, `ptok`, `ctok`).

**Switches.** `PIPELINE=off|shadow|on`; `PIPELINE_PREFETCH=0` keeps Rule 1 alone (a fresh call at the end of a success, no
extra inference); knobs `PIPELINE_PREFETCH_AFTER_MS` 3000, `_MAX_AGE_MS` 60000, `_WAIT_CAP_MS` 8000, `_MIN_P` 0.3,
`_MIN_RUN_MS` 1000, `_NEXT_DELAY_MS` 500, `_MAX_PER_MIN` 4.

**Telemetry.** `pipeline` row per judged or dropped prefetch: `mode use why pre fresh agree age_ms wait_ms lat_ms saved_ms
ptok ctok`. `pipeline_tally` every 10 min: prefetch, used / would_use, nouse_<why>, drop_<why>, armed, unarmed_<why>,
nowait, nowait_capped, nopf_<why>, agree / disagree. A used prefetch writes the decision's normal llm row (its prompt, its
real latency), so `is_model_call` and the busy-time reads count it; **unused prefetches are only on `pipeline` rows** --
inference load = llm model rows + `pipeline` rows with `use=dropped|fallback|would_*`.

## 3. Expected effect and cost (canary bots)

- Rule 1 frees ~242 bot-h/day fleet-wide (12.6% of bot time) for runs. Admitted runs per bot-h: +10-15% if the freed time
  converts at today's mix. The model is asked about 14% more often (more cycles).
- Prefetches: ~65k a day fleet-wide at the gates above (model runs alive at 3 s), of which ~33k come before a model decision
  that Rule 1 armed. Net extra calls ~+25% before validation losses (the published hit rate for speculated next steps is
  22-55%, Speculative Actions [arXiv 2510.04371](https://arxiv.org/html/2510.04371v1); ours is checked by the gate, not exact
  match). **The prefetch buys at most the 1.4% call time; Rule 1 is the 11.2%.** If the read shows the load is the problem,
  `PIPELINE_PREFETCH=0` keeps the gain.
- On a 15-bot canary: +~6% fleet inference load. Watch the endpoint p95 (capacity rule 11-02).

## 4. Read (fun mode: generic +90/+180, plus this change's own lines)

Effect metric (owner rule 11-06): **gap from a successful run's end to the next run's start (median, s)** and **admitted runs
per bot-h**, canary vs control. Own lines:
- mechanism: canary median post-success gap < 3 s (control ~16 s); `nowait` and `used` in the tally > 0 on every canary bot.
- safety: `use=used` rows after a non-idle trigger = 0 (by construction; a row would be a bug); reflex-triggered decisions
  per bot-h not above control; deaths (two-death floor).
- harm: vetoed share of model calls not up > 5 pp vs control; repeat_loop vetoes per bot-h; explore share.
- cost: (llm model rows + unused `pipeline` rows) per bot-h <= 1.6x control; endpoint p95 <= 5 s.
- shadow data (if a pool runs `PIPELINE=shadow`): would_use share, agree share, dry refusal reasons.

## 5. Composition with workboard-01

workboard-01 changes the ORDER chain (a board order on a grounds lap, claim + pin before the model). This change sits strictly
after the chain: an order taking the turn voids the prefetch (`#pipeDrop('order')`), Rule 1 removes only the window wait of a
**model** call, and a board order's own per-job back-offs and claims are untouched. Built on `3d8ef9de`; townwork, fewerdec,
vetoremedy, orderroom, depositoffer, keepout and keepout-loop tests pass on the combined tree. If workboard-01 reverts, this
rebases onto `bcdba35f` with no shared hunks.

## 6. Reviews and search

- Open-source / forum search (Claude subagent, 11-09): 2503.03505 overwrites the slot and never checks staleness (our dry run
  has no precedent there); PIANO needed one controller for coherence (our gate); Mindcraft is strictly serial, re-prompts
  right after a command with a fast-loop guard (our runaway guard); Speculative Actions 22-55% hit rates; mineflayer-pathfinder
  `stop()` lands at the next node and `goto` settles a tick later (our 500 ms step, the same one CONTINUE's early ticks already
  use after a success); Ollama gives each request its own slot and cancels on disconnect; llama.cpp cancels within ~1 s
  (PR #11285). No measured hit rate for a "next skill while this one runs" pick in Minecraft was found.
- Code reviews: see the commit messages (Codex + independent Claude, blockers only).
