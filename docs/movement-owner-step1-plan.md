# Movement owner — step 1 implementation plan (17 Sep 2026 13:00 UTC; Claude planning agent from design v3; Codex pass pending)

# Step 1 plan: `MovementOwner` for entombed / marooned / recovery ladder

## 0. Prerequisite (found while reading, blocks everything)

`OWNER=1` implies `ARBITER=1`, but `ARBITER=1` on 1d6c97d crashes at connect: `/Users/darrellmiller/Documents/mcai-b1011b/bots/src/index.mjs:250` calls `runner.arb.installActuatorGate(...)` inside the un-try'd `bot.once('spawn')` handler (line 216), and `bots/src/arbiter.mjs` at 1d6c97d (115 lines) has no such method. The gate lives only on `recovery-ladder` (d67a182, 5027752, 050f743, 7ee5a30, ff51703) together with `withinBody` (`recovery-ladder:bots/src/reflex.mjs:1256`). The pocket rung at reflex.mjs:2228 already comments on this. First commit on the candidate branch: cherry-pick those five commits (arbiter.mjs, arbiter.test.mjs, the `withinBody` line), run `npm test`, and do one sandbox boot with `ARBITER=1` before writing any owner code.

## 1. New module `bots/src/owner.mjs`

Pure machine (no bot, no timers), tested like `escape.mjs`:

- `newEpisode({ cls, at, now, blocks, climbNeed, deadlineMs = 180_000 })` → `{ id, cls, at, startedAt, deadline, blockBudget: climbNeed + 2, tried: [], hazards: [], state: 'ASSESS' }`.
- `rungsFor(cls)` → entombed: `['pillar','stair','underfoot']`; marooned: `['adjacent','pillar','stair','underfoot']` (mirrors today's chain at reflex.mjs:2366-2470 and 2624-2683); ladder: `['walk','dig']`.
- `nextRung(episode, obs, now)` → `{ rung, reason, budget: { deadlineMs, blocks } } | null`. Skips rungs whose last outcome was `refused|failed|exhausted`; a `preempted` rung stays eligible (v3 §2). Refuses `pillar` when `obs.blocks < episode.blockBudget`, `dig` when `obs.blocks < LIVELOCK_BLOCK_RESERVE`. Null past the cumulative deadline.
- `recordRung(episode, { rung, outcome, blocksSpent, ms, hazard })` → new episode (immutable).
- `closeEpisode(episode, before, after, pred)` → `{ closed, why }`: `escapedFrom(before, after)` AND the class predicate — `!pred.entombed && pred.supported` (entombed), `pred.canStartPath` (marooned), `escapedFrom` alone (ladder, as `livelockNext` does today).
- `holdReason(episode)` → `'exhausted' | 'deadline' | 'no_rung'`; `safeHoldExit(hold, evidence)` where `evidence = { displaced, inventoryChanged, blockChangedNearby, pathStartable, newRequest }` (v2 §3).
- `transition(from, to, { reason, budget, postcondition })` — the only place policy strings are made; every row logs it.

Runtime `class MovementOwner({ bot, runner, arb, rungs, log, now })`:

- `assessAndRun({ cls, obs, before, pred, inDanger })`: returns `'busy'` immediately if `this.running` (one rung at a time; the two-owners guard); otherwise opens/continues the episode for `(cls, at)`, acquires `arb.acquire({ owner: 'owner:'+cls, priority: PRIORITY.escape, context: { kind: rung, episode: id }, onCancel })`, runs `rungs[rung](bot, { alive: () => arb.ok(grant), yieldTo })` inside `arb.within(grant, ...)`, records, re-checks `closeEpisode`, chains the next rung without waiting a tick (as the entombed arm chains pillar→stair today), releases the grant, and enters SAFE-HOLD when `nextRung` is null.
- Hazard preemption: air preempts through the arbiter (reflex.mjs:2115 `takeBody(... PRIORITY.air)`), the rung sees `alive()` false and returns `preempted`. Lava has no acquirer today (`escape(bot)` at 4962 is contextless and would be refused by the gate while the owner holds), so the owner self-revokes on `inDanger` (`arb.release(grant, 'hazard: lava')`) before the danger escape fires.
- Rows: `logEvent({ kind: 'escape_rung', status, detail: 'class=… rung=… episode=… budget=… outcome=… blocks=…' })` per rung; `logEvent({ kind: 'safe_hold', status: 'failed', detail: 'reason=… tried=… until=displacement|evidence' })` on hold; exhaustion still publishes `bot.pendingPrereq` via `climbPrereqFor(reason)` (reflex.mjs:4522) so the refusal names a remedy.

## 2. Extractions from `reflex.mjs` (detectors become pure)

- `entombedState(at)` from `isEntombed` (3042): `at(dx,dy,dz) → block`, returns `{ entombed, ceilingSolid, walls }`; `isEntombed(bot)` becomes a one-line wrapper (keep `isEntombedForTest`).
- `maroonInputs({ above, items, passable })` → `{ upIsOpen, blockCount, haveBlocks }` (the block at 2334-2351); `canStartAPath` stays async and is passed in; `maroonState` (358) unchanged.
- `climbOutcome(r)` → `'ran'|'refused'|'failed'|'preempted'` (`needs_blocks|needs_pickaxe`→refused, `exhausted|threw`→failed; the mapping now duplicated at 2657 and 2818-2935).
- Rung adapters (closures inside `startReflexes`, passed as the `rungs` table): `pillar` → `pillarOut(bot, climbNeedAbove(bmap(bot), pos), { alive })` (4541); `stair` → `escapeStairUp(bot, { yieldTo: () => drowningOwnsBody() || arbiterYield(() => grant) })` (4085) with `rampStatus`; `underfoot` → `harvestUnderfoot(bot)` (3783); `adjacent` → `harvestAdjacent(bot)` (3944); ladder `walk`/`dig` → the two `runner.run('goto', …)` legs from cognitive.mjs:385-421 (the owner holds no grant for these: `runner.run` takes its own work grant at runner.mjs:194).

## 3. Wiring anchors (flag `config.reflex.owner`)

- `bots/src/config.mjs:155`: `arbiter: req('ARBITER','0') === '1' || req('OWNER','0') === '1'`, add `owner: req('OWNER','0') === '1'`.
- `index.mjs:250`: after `installActuatorGate`, `runner.owner = new MovementOwner({ bot, runner, arb: runner.arb, … })` (mirrors `runner.arb`; no signature change to `startReflexes` or `Cognitive`).
- Entombed arm, between the gate `if (!escaping && !marooned && !climbing && !inDanger && isEntombed(bot) &&` / `!pocketing && !pocketPending && Date.now() - lastEscapeAt > ESCAPE_MIN_INTERVAL_MS) {` (2728-2729) and `if (escapeFailures >= ESCAPE_GIVE_UP_AFTER) {` (2730): `if (config.reflex.owner && runner.owner) { escaping = true; lastEscapeAt = Date.now(); try { await runner.owner.assessAndRun({ cls: 'entombed', … }) } finally { escaping = false }; return }`.
- Marooned arm, after `mstate` is computed (2363-2365) and before `if (!pocketing && !pocketPending && mstate === 'need_scaffold' && !inDanger &&` (2366): same shape for `mstate === 'climb' || mstate === 'need_scaffold'`, bracketed by `escaping` (keeps 2217, 2246, 2332 standing down without touching them). `need_pickaxe` and `stranded_high` stay legacy.
- Keep the owner lines textually distinct from the four gate regexes in `bots/test/danger-owns-the-body.test.mjs` (each must match exactly once).
- `cognitive.mjs:360 async #escape()`: first statement `if (config.reflex.owner && this.runner.owner) return this.#escapeViaOwner()`; the legacy body stays intact so `livelock-ladder.test.mjs`'s anchors (`withAscentMovements`, the `done` branch, line 916's trigger) still hold. `#escapeViaOwner` sets `livelockLatchedUntil` / `recoveryExhaustedAt` from the owner's hold so lines 905-916 keep working, and still emits `recovery_exhausted` for the digest.
- `takeBody`/`giveBody` (1027/1038) unchanged; the owner acquires directly.

## 4. Untouched

Air reflex (1553-2200), flooded-pocket rung (2214-2238, own grant), stand-off (2246), last-resort/lattice branch (1436-1530; it stays contextless and the gate's `arbiter_actuator_refused` rows measure its collisions — recorded, not fixed, in step 1), skills, `runner.claimBody`, `escape.mjs`, `recovery.mjs`, flag-off paths byte-for-byte.

## 5. Tests

- `bots/test/owner-machine.test.mjs` (pure): rung order per class; skip-tried but retry-after-preempt; block reserve pushes `pillar` to `stair`; cumulative deadline → hold; `closeEpisode` needs both conjuncts (mutants: rose 4 into an open shaft but still entombed must not close; moved 8 but no path for marooned must not close); exhaustion latches the strategy not the machine (a new class opens a new episode); `safeHoldExit` on each evidence kind.
- `bots/test/owner-runtime.test.mjs`: real `Arbiter`, fake rung table with controllable promises: acquires at `PRIORITY.escape`; runs under `within`; a `PRIORITY.air` acquire mid-rung → `alive()` false → `preempted` row; a hung rung is revoked at `ACK_MS`; grant released after each rung; second `assessAndRun` while running returns `'busy'` without acquiring; `escape_rung`/`safe_hold` rows carry class, rung, episode, budget, outcome, blocks.
- `bots/test/owner-wired.test.mjs` (source, comments stripped, `withMutant` from climb-escape.test.mjs with unique anchors): the owner route sits between 2729 and 2730 and before 2366, both `escaping`-bracketed with `finally`; `#escape()` opens with the owner branch; `runner.owner` assigned after `installActuatorGate`; `OWNER=1` → `config.reflex.arbiter === true` (spawn `node -e` with the env, behavioural).

## 6. Corpus

Marooned fixture `sandbox/fixtures/hive-b-echo-sealed-pocket.json` has no `bot` block (`score-run.py` line 7 reads `['bot']['pos']`): add `bot: { pos, inventory }` from the capture (origin 352,59,195) and `sandbox-bot-scripted-echo.env` (script `status`). New `sandbox/corpus-owner.tsv`: corpus.tsv lines 1-2 (Delta, Bravo — entombed), the echo line (marooned), corpus.tsv lines 3-4 (buried-ore, regression); then `corpus-pocket.tsv`.

`CANDIDATE_ENV_EXTRA="OWNER=1" CORPUS=sandbox/corpus-owner.tsv REPEATS=2 sandbox/run-corpus.sh ~/Documents/mcai-owner ~/Documents/mcai-b1011b` (control = 1d6c97d, flags off, as deployed).

Accept when, summed over repeats per label: candidate `DIED` ≤ control, `escaped` ≥, `picks_lost` ≤ on every label; on delta, bravo and echo `escaped` and `rise≥4 dry` ≥ control; positive control: ≥1 `escape_rung` row per target fixture, zero `reflex_layer_down`, and `arbiter_actuator_refused` from `owner:` contexts = 0.

## 7. Risks

- Latency: ASSESS is O(1) on the observation the arm already computed; `canStartAPath` (800 ms) keeps its 60 s cadence (`MAROON_CHECK_MS`). No WORK legs in step 1, so the 100 ms/leg budget is deferred to step 3.
- Two owners: the last-resort branch and `unstick` remain unrouted; the gate refuses them while the owner holds, visibly. Watch the refused-row count in the corpus.
- ACK deadline: `pillarOut`'s `digBounded` (≥8 s) checks `alive()` only between steps; the 500 ms revoke plus the independent stop covers it, and the late `placeBlock` is swallowed by its own `catch` — confirm with the runtime test.
- Exhaustion vs displacement: a partial pillar (rose 3) neither closes nor re-opens; evidence exits cover it. Water flow displacing 8 blocks would re-open forever — cap episodes per class at 3/hour like `LADDER_MAX_LATCHES`.

## 8. Effort

Prerequisite cherry-pick and boot 2 h; pure machine + tests 6 h; runtime + arbiter tests 5 h; reflex routing + adapters + wired tests 5 h; cognitive route 2 h; echo fixture/env/tsv 1.5 h; corpus runs and reads (~70 min wall per pass, two passes) 3 h; two-engine review and fixes 3 h. About 28 h, three to four working days.

### Critical Files for Implementation
- /Users/darrellmiller/Documents/mcai-b1011b/bots/src/reflex.mjs (arms at 2316-2940, `takeBody` 1027, detectors 3042/358, rungs 3783/3944/4085/4541)
- /Users/darrellmiller/Documents/mcai-b1011b/bots/src/arbiter.mjs (plus recovery-ladder d67a182..ff51703 for the gate)
- /Users/darrellmiller/Documents/mcai-b1011b/bots/src/cognitive.mjs (`#escape()` 360-455, trigger 905-916)
- /Users/darrellmiller/Documents/mcai-b1011b/bots/src/index.mjs (spawn handler 216-250) and bots/src/config.mjs:155
- /Users/darrellmiller/Documents/code-minecraft-ai/sandbox/run-corpus.sh, sandbox/score-run.py, sandbox/fixtures/hive-b-echo-sealed-pocket.json
## v2 — Codex pass folded in (17 Sep 13:40Z); build order revised
1. **Prerequisite is a reconciled patch, not five cherry-picks.** The baseline (1d6c97d) already carries the final actuator-gate installation and refusal logging in index.mjs but not the gate itself; the recovery-ladder commits also touch the runner, the air routing and tests, and one carries a node_modules symlink. Step 0 of this build is one hand-reconciled commit "arbiter: the actuator gate" (arbiter.mjs + its tests + withinBody) that boots with ARBITER=1 in the sandbox; the runner/air changes are reviewed line by line and either taken or left with a stated reason. Time-boxed to half a day; if it does not boot clean, the owner waits and the day goes to the corpus.
2. **Contextless callers are attributed, not trusted.** The gate's "bound === holder admits every contextless caller" rule cannot tell the pathfinder tick from the last-resort routine (reflex.mjs ~1519) or unstick (~2962). Step 1 gives the pathfinder's own callbacks an explicit context and REFUSES every other contextless actuator call while an owner grant is live; a runtime test drives an unrelated contextless call during a live grant and expects refusal.
3. **Lava is a hazard acquirer, not a self-release.** The danger escape acquires at PRIORITY.lava through the arbiter's handshake (≤500 ms ack, then revoke, independent stop) exactly like air; the owner never releases itself on `inDanger`. `inDanger` is recomputed every tick inside the owner's loop (the hazard monitor), not read once at entry.
4. **The owner route carries every admission guard the legacy arm had** (`!inDanger`, `!pocketing`, `!pocketPending`, `!climbing`, the ESCAPE_MIN_INTERVAL) and refuses while a pocket rung is running; a behavioural test asserts the owner does not start under each of them.
5. **Budgets are enforced inside rungs**: every adapter receives `{ deadlineAt, blocksLeft, alive }`; the owner revokes the grant at the episode deadline independently of the rung; block spending is counted from inventory deltas per rung and summed on the episode.
6. **Exhaustion is per strategy, hold exits are evidence-driven**: the episode cap is per (class, strategy) with a 3/hour ceiling per class, never a blanket cap; `#escapeViaOwner` re-assesses on the v2 §3 evidence kinds (displacement, inventory change, block change nearby, path startable, new request) and does not inherit the legacy displacement-only latch.
7. **The ladder's obligations are tested behaviourally**: ascent profile, planning-time reserve subtraction, the reserve watcher, success-only repeat-window clearing, terminal behaviour, preemption of the delegated work grant — one test file, not preserved anchors.
8. **Acceptance is target improvement with a read rule**: REPEATS=3; a label is READ when the six runs agree in direction; the candidate must be strictly better on the target fixtures (Delta, Bravo, Echo: escaped, rise≥4 dry) and not worse on the regression fixtures; ties or disagreement = INCONCLUSIVE and another repeat, never a pass. Latches and hourly exhaustion get one 30-minute run on one fixture. Effort re-estimated at ~40 hours (five working days), with the half-day prerequisite as the first gate.
Build starts with item 1 only. Nothing beyond it is written until it boots.

## Build log
- 17 Sep 12:55Z — prerequisite gate PASSED: the five gate commits reconciled onto 1d6c97d (index.mjs kept the baseline's install + call-site helper; reflex.mjs keeps lava guard 2 inside the air-grant wrapper); suite 184/184; sandbox boot with ARBITER=1 on the Delta fixture: alive, rose 17/moved 29 vs control 14/18; 22 refused unrouted actuator calls, the first attributed ones being the hold at reflex.mjs ~1755/1773 refused "while surface holds" (item 2 material).
- 13:10Z — `src/owner.mjs` (pure machine, 8 behavioural tests) and `src/owner-runtime.mjs` (under the real Arbiter, 5 tests: escape-priority grant, release after every rung, close needs postcondition + predicate, hold + evidence exit, air preemption -> preempted and retried, a revoked grant means preempted whatever the rung reported, busy while running).
- 13:25Z — ENTOMBED routed behind OWNER=1 (implies ARBITER=1): the route sits inside the arm's gate and try, before the legacy takeBody, so every legacy admission guard still applies (item 4); rungs pillar/stair/underfoot are adapters over pillarOut/escapeStairUp/harvestUnderfoot with alive() and the stair yielding to the air reflex; a closed episode clears the legacy counters; a hold backs the arm off one minute. Wiring test with a mutant and a behavioural OWNER=1 -> arbiter check. NOT routed yet: marooned, the livelock ladder (cognitive #escape), contextless-caller attribution (item 2), per-rung budget enforcement inside pillarOut/escapeStairUp (item 5 -- the owner's deadline revokes the grant; the rung notices at its next alive() check), the evidence hooks that end a hold (item 6: inventory/terrain/path events are not yet wired to owner.evidence()).
- corpus-owner.tsv (Delta, Bravo) running control vs candidate with OWNER=1; result below.
