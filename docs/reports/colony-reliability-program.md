# Colony reliability program — 13 September 2026

> **Amended 14:50 UTC after the feasibility check (docs/reports/program-feasibility.md):** both engines judged the written targets unrealistic. The committed numbers are now: deaths/bot-h ≤ 0.05 (2 wk) / ≤ 0.03 (6 wk); immobile bot-minutes ≤ 2% / ≤ 1%; iron-pickaxe bot-hours ≥ 8% / ≥ 20%; gather success ≥ 40% / ≥ 55%; stock returned ≥ 20 / ≥ 30 items/bot-h. The product for six weeks is a restricted operating envelope (known sites, dry routes, mapped exploration, one gather–deposit loop, tools carried home); the deposit path (17% successful) is fixed in week one; tool-less flooded pockets are prevention, not rescue; the schedule is the slower one ChatGPT states. The tables below are the original drafts.

Owner's decision: the project changes focus to fixing "an unreliable autonomous colony." Stop the current approach; make the changes that produce steady forward progress with every resource we have. Two planners wrote independently, ChatGPT (Codex, with repository access) and Claude; Part 3 reconciles them into one program.

## Part 1 — Claude's program

### The goal, as numbers

"Reliable" means a bot left alone survives, gets itself out of trouble, keeps its tools, and returns something to stock. Four numbers define it. Baselines are measured today; targets are for a 72-hour continuous read at two weeks and a 7-day read at six weeks.

| Measure | Today | 2 weeks | 6 weeks |
|---|---|---|---|
| Deaths per bot-hour | 0.06–0.10 | ≤ 0.03 | ≤ 0.01 |
| Bot-minutes immobile (trailing hour < 6 blocks) | ~3 of 80 bots, 20–29% on two pools | ≤ 1% fleet-wide | ≤ 0.25% |
| Iron-pickaxe bot-hours as a share of bot-time | 3.3% of bot-time over 24 h (35.2 iron-pickaxe bot-hours; 16 bots held one at some point; 41 gained, 41 lost) | ≥ 20% | ≥ 50% |
| Stock returned per bot-hour (items leaving inventory in a deposit run) | 14.7 items/bot-h over 24 h (15,936 items / 1,081 bot-h; deposit runs: 280 success, 567 failed, 816 no-effect; mostly cobblestone, bamboo, oak logs) | rising with retention | rising |

Gross items per bot-hour is retired as the headline. It measures churn.

### Stop list

- Stop per-decision model calls as the day-to-day driver. The model answers open questions off the tick.
- Stop discovering mechanisms with fleet canaries. The fleet checks safety and regression only.
- Stop review loops past two passes per patch. A remaining objection becomes a smaller patch or a sandbox fixture, never a third pass.
- Stop waiting for fleet exposure to test a mechanism. Synthesise the exposure in the sandbox.
- Stop bigger-model experiments on the decision tick. Settled.
- Stop rewarding production. Iron made is not the metric; iron held is.

### The program, in order

1. **Proving ground first (days 1–2).** A trap corpus: every death and immobility class captured live over RCON (flooded pocket, sealed pocket, ledge, lava edge, interrupted mine, idle-lava), plus synthesised variants, with a control-vs-candidate replay runner that scores survive, escape, tool loss, and return-to-work automatically. Four sandbox worlds on the idle i9 so a corpus run takes minutes. Acceptance: every known failure reproduces; a replay gate blocks any fleet change without corpus evidence.
2. **One movement owner (days 2–6).** A single controller owns the body: walk, dig, place, cancel. Explicit states WORK, ASSESS, ESCAPE, RETURN, SAFE-HOLD with deadlines, attempt limits, inventory budgets, one postcondition, one terminal state. Drowning-air, entombed, marooned, livelock, stuck, and the recovery ladder become transitions of this machine, not separate reflexes. Proven in the sandbox, then one safety canary. Acceptance: no competing actuator commands, every fixture ends in safety or a recorded bounded failure.
3. **Own navigation (days 4–10).** Port Baritone's loop discipline into the runner: expected duration and overrun budget per leg, cancel at twice the estimate or ten seconds without progress, re-plan when the remaining cost rises by half, refuse a leg without a route and the escape resources to survive it. Raw dig-and-place escape for flooded pockets, since the pathfinder refuses blocks touching liquid and cannot jump-place in water. The three Mindcraft guards. Acceptance: zero deaths on the mandatory corpus, bounded termination everywhere, ≥ 95% escape on recoverable traps. Then a safety canary, then staged rollout.
4. **Rules-first worker (days 7–14).** Deterministic gather → craft → smelt → mine → deposit → return, with inventory reservations, station ownership, fuel checks, tool replacement, and a "carry iron home" rule. The model is asked only when the cycle has a genuinely open choice, asynchronously. Acceptance: a 24-hour unattended sandbox run meets the two-week numbers with zero model calls on the tick; then a safety canary; then fleet-wide.
5. **Retention hardening (weeks 3–6).** Terrain coverage, escape budgets, tool-loss attribution by cause. Every change replay-gated. Acceptance: six-week numbers hold for seven days.

### Resources

- **Fleet, 16 worlds:** measurement and safety canaries, then staged rollout one world at a time. Throttled while steps 2–4 land: no feature work reaches it.
- **Sandbox on the worlds host and four worlds on the i9:** the proving ground; captures, corpus, endurance runs.
- **Blackwell:** offline skill authoring and trace analysis with a large local model, batch, never on the tick; sandbox brains when a scripted decision is not enough.
- **Mac Studio:** the night-shift digest and shadow analyst; experiment coordination.
- **ChatGPT and Claude:** one plans and challenges, the other implements and assembles acceptance evidence, swapping per step. Two review passes per patch, then a smaller patch. Both review each registration once.

### In-flight work

- explore-step-guard-02: read the verdict at 13:36 UTC as registered, then tear down. Its guard folds into the movement owner.
- recovery-ladder: replay-gate it on the corpus, run its registered safety canary, promote if clean. Its pieces become the first states of the movement owner.
- approach-at-depth: the mechanism is proven; archive the branch and re-prove it in the sandbox with synthesised exposure once the movement owner exists.
- Station and craft work: kept where the deterministic cycle needs it.
- Night-shift tiers: keep the digest; the analyst stays in shadow with a fixed nightly budget.

### Risks, and the one decision

Replay cannot see live physics drift, so small safety canaries stay. Raw escape actions can destroy tools, so inventory budgets are enforced in the state machine, not reported after. The two big files couple everything; the controller boundary is drawn before any refactor. The decision the owner must make: six weeks in which survival and retained tool-hours outrank exploration and gross throughput, including a throttled fleet.


## Part 2 — ChatGPT's program (Codex, independent, with repository access)

## 1. THE GOAL

Make the colony survive, recover, retain tools, and complete useful work without supervision.

| Measure | Today | Two weeks | Six weeks |
|---|---:|---:|---:|
| Deaths/bot-hour | 0.06–0.10 | ≤0.02 | ≤0.005 |
| Fraction immobile for over five minutes | ~3/80; duration unmeasured | ≤1% | ≤0.25% |
| Iron-pickaxe tool-hours / bot-hours | 3.3% (measured 13:45 UTC; ChatGPT wrote before the measurement) | ≥25% | ≥60% |
| Gather success | 30% | ≥60% | ≥85% |

Measure two-week results over 72 continuous hours; six-week results over seven days. Establish duration-based immobility and tool-hour baselines on day one.

Useful output means materials returned to stock and completed recipes serving colony needs. Today’s ~70 items/bot-hour measures gross activity, not useful output. Establish useful-output baseline on day one; require it to rise alongside retention. Fourteen iron pickaxes made daily is not success when only two remain held.

## 2. STOP LIST

- Stop feature-led exploration and mining expansion until movement and recovery pass replay.
- Stop routine LLM decisions every 30 seconds. Stop larger-model experiments; 72B already changed nothing.
- Stop using production canaries to discover whether mechanisms work. Thirty-one decisions yielding eight KEEP verdicts is an expensive proving process.
- Stop open-ended review passes, speculative refactoring, and promotion based on green unit tests alone.
- Stop spending fleet time repeatedly reproducing known traps. Capture once, replay repeatedly.
- Stop rewarding iron production and item churn. Track tool-hours, deaths, and tools consumed during escape.

## 3. THE PROGRAM

**1. Establish the proving ground — days 1–2.**  
Build a trap corpus from live RCON captures: flooded pockets, sealed chambers, ledges, lava exposure, interrupted mining, and idle hazards. Add synthetic variations and stock-return accounting. Prove in **sandbox replay**, control against candidate with identical scripted decisions. Acceptance: each known failure reproduces, outcomes are recorded automatically, and every fleet change requires replay evidence.

**2. Give movement one owner — days 2–5.**  
Build one controller that exclusively owns movement, digging, placement, and cancellation. Add explicit states: WORK, ASSESS, ESCAPE, RETURN, SAFE-HOLD. Each state has deadlines, attempt limits, inventory costs, and transitions. SAFE-HOLD must seek verified safety, not freeze over lava. Prove in **sandbox**, then **fleet safety canary**. Acceptance: no competing actuator commands, no unbounded retries, and every fixture reaches safety or a recorded bounded failure.

**3. Own navigation — days 4–10.**  
Wrap navigation with Baritone’s loop discipline; do not port its client. Give every leg an expected duration and overrun budget; cancel at twice expected duration or ten seconds without progress. Re-plan when estimated remaining cost rises 50%. Reject legs lacking a feasible route and required escape resources before entry.

Build raw dig/place escape sequences for flooded pockets because the pathfinder refuses liquid-touching blocks and cannot jump-place in water. Prove in **sandbox replay** across held-out scenes. Acceptance: zero deaths in the mandatory corpus, bounded termination everywhere, and ≥95% escape success across generated recoverable traps. Then run a **safety canary**, followed by staged **fleet-wide** rollout.

**4. Build the rules-first worker — days 7–14.**  
Implement deterministic gather → craft → smelt → mine → return, including inventory reservations, station ownership, fuel checks, and tool replacement. LLMs answer unresolved planning questions asynchronously; they never own the movement tick. Prove in **sandbox**, then **safety canary**, then **fleet-wide**. Acceptance: a 24-hour unattended run meets two-week reliability targets and completes stock-return cycles without model calls.

**5. Harden retention — weeks 3–6.**  
Expand terrain coverage and tune escape inventory budgets. Prove every change in **replay** before rollout. Acceptance: six-week targets hold; tool losses and escape costs have attributable causes; useful output exceeds day-one baseline.

## 4. RESOURCES

- **80 bots / 16 worlds:** production measurement and representative safety checks. Canary on one world’s five bots with a matched control world; expand to four worlds, then sixteen. Any new death mechanism or tool-loss regression stops rollout.
- **Worlds-host sandbox:** authoritative captures and quick reproduction.
- **Idle i9 / pve3:** parallel replay worlds, generated terrain, overnight endurance runs.
- **Blackwell RTX 6000 96 GB:** batch local-model trace analysis, skill proposals, and sandbox-only experiments.
- **Mac Studio:** digest scheduling, independent shadow analysis, and experiment coordination. Neither local-model host controls production ticks.
- **ChatGPT/Codex:** implement and assemble acceptance evidence. **Claude:** independently plan and challenge mechanisms; reconcile once against the targets. Limit each patch to two review passes. Remaining blockers require a smaller patch or sandbox investigation; no cosmetic review loops.

## 5. WHAT TO DO WITH IN-FLIGHT WORK

- **explore-step-guard-02:** read the due verdict now; retain only demonstrated safety value.
- **recovery-ladder:** stop reviewing after five ACCEPTABLE passes. Run replay, then its registered safety canary.
- **approach-at-depth:** archive the proven mechanism; stop waiting for fleet exposure. Synthesize exposure in sandbox.
- **Station/craft:** retain work required by the deterministic cycle; freeze unrelated expansion.
- **Night shift:** keep digest cron. Run the local analyst in shadow mode with a fixed nightly budget and at most three evidence-linked proposals.

## 6. RISKS AND OWNER DECISION

Replay can miss live physics; preserve small safety canaries. Raw escape actions can destroy tools; enforce inventory budgets. Concentrated source code creates coupling; establish controller boundaries before broad refactoring.

**Owner decision:** approve six weeks in which survival and retained tool-hours outrank exploration and gross item throughput, including temporary fleet throttling.

## Part 3 — Reconciled program (one plan)

The two programs were written independently and agree on shape, order, and the stop list. The reconciled plan takes ChatGPT's stricter targets and acceptance tests, Claude's throttled-fleet and two-pass review bounds, and resolves the three differences:

- **Targets.** ChatGPT's are tighter (deaths ≤ 0.02 then ≤ 0.005; immobile ≤ 1% then ≤ 0.25%; iron-pickaxe tool-hours ≥ 25% then ≥ 60%; gather success ≥ 60% then ≥ 85%). Adopted, with one caveat: deaths ≤ 0.005 per bot-hour is one death per 200 bot-hours, about one every 2.5 hours across the fleet; it is a six-week aspiration measured over seven days, not a gate.
- **Useful output.** Both retire gross items per bot-hour. Adopted metric: materials returned to stock and completed recipes serving the colony, baselined on day one.
- **Who does what.** ChatGPT proposes it implements and assembles evidence while Claude plans and challenges. Adopted as the default, swapping per step where one engine holds more context (Claude on the sandbox rig and telemetry, ChatGPT on navigation semantics), with two review passes per patch and no third.

**The program, reconciled (acceptance tests are ChatGPT's unless noted):**

| Step | Days | Built | Proven where | Acceptance |
|---|---|---|---|---|
| 1 Proving ground | 1–2 | Trap corpus from live captures + synthesised variants; four sandbox worlds on the i9; automatic scoring (survive, escape, tool loss, return to work); replay gate | Sandbox | Every known failure reproduces; no fleet change without replay evidence |
| 2 One movement owner | 2–6 | One controller owning walk/dig/place/cancel; states WORK, ASSESS, ESCAPE, RETURN, SAFE-HOLD with deadlines, attempt limits, inventory budgets, one postcondition, one terminal state | Sandbox, then one safety canary | No competing actuator commands; no unbounded retries; every fixture ends in safety or a recorded bounded failure |
| 3 Own navigation | 4–10 | Baritone loop discipline in the runner; raw dig/place flooded-pocket escape; three Mindcraft guards | Sandbox held-out scenes, safety canary, staged rollout | Zero deaths on the mandatory corpus; bounded termination; ≥ 95% escape on recoverable traps |
| 4 Rules-first worker | 7–14 | Deterministic gather → craft → smelt → mine → deposit → return with reservations, station ownership, fuel, tool replacement, carry-iron-home; model only for open questions, off the tick | Sandbox 24 h unattended, safety canary, fleet-wide | Two-week targets met with zero model calls on the tick |
| 5 Retention hardening | wk 3–6 | Terrain coverage, escape budgets, tool-loss attribution | Replay-gated, staged | Six-week targets hold for seven days |

**In-flight work (both agree):** read explore-step-guard-02 now and tear it down, keeping only demonstrated safety value; replay-gate recovery-ladder and run its registered safety canary, no more review passes; archive approach-at-depth as proven and re-prove it in the sandbox with synthesised exposure; keep station/craft work the cycle needs; keep the digest, keep the analyst in shadow on a fixed budget.

**The decision the owner must make (both engines, same words):** approve six weeks in which survival and retained tool-hours outrank exploration and gross item throughput, including a throttled fleet while steps 2 to 4 land.

**Day 1 starts now:** the guard verdict and teardown; the recovery-ladder safety canary as registered (it is steps 2 and 3's first slice and its canary is registered as safety-only); the trap corpus and the i9 sandbox worlds in parallel; the retention and stock-return baselines recorded today.
