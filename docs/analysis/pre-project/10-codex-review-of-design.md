**This is a better direction, but I would block implementation of the blanket skill bans and block promotion based solely on the proposed KPI.** Preserve the fresh-start architecture’s ownership, cancellation and reconciliation rules; treat the new thresholds as experimental defaults.

1. **Feasible menus need an escape contract.**

Filtering becomes the old tree when “previously failed” means “impossible,” or strategic preferences become hard exclusions. ADR-0004’s authority rules correctly distinguish unknown from impossible and make relevance advisory. Two failed `goto` targets should not disable all navigation, including retreat. Two failed gathers should not remove the resource needed to recover. ([ADR, “Architecture”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/decisions/ADR-0004-ai-mind-DRAFT.md))

Use one registry for preconditions, schema generation and admission. Distinguish **feasible, infeasible and unknown**. Scope exclusions to the target, failure cause and relevant world state; invalidate them when that state changes. Historical failure should ordinarily lower preference, not prove infeasibility. Recheck at execution because observations become stale.

A skill-name enum cannot exclude one `(skill,args)` tuple. Either offer validated candidate-call IDs or implement argument constraints explicitly.

**When the set is empty:** refresh observations once; identify blocked prerequisites and offer a bounded inspection or recovery operation if safe; otherwise defer with an observable wake condition and a deadline, entering supervised idle without repeated model calls. Never relax safety merely to populate the menu. Record empty-menu duration and repeated deferrals.

This matters because roughly half of eventual same-skill admissions after long refusal runs succeeded: some gates were blocking workable actions. ([Rejection loops §3](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/2-rejection-loops.md))

2. **The ladder is defensible as a starting hypothesis, not “data-derived” optimization.**

The data supports early intervention. It does not establish that 2/3/5/10 decisions or 2/4/8 minutes are optimal. Those durations reflect the old 30-second cadence; switching-versus-retrying comparisons are observational and mix situations. “Changed args” can also mean meaningless coordinate jitter.

Track a **goal-level no-progress episode** across skill switches, deferrals and replans. Reset it on verified progress or a relevant prerequisite change. Separate invalid proposals, execution failures, controller preemption and infrastructure failures. Permit retries when evidence changes, including identical arguments after a prerequisite is restored.

Define how escalation happens after deferral: a goal parked at five refusals will never reach ten consecutive refusals unless its episode persists. Use attempt, elapsed-time, token and mutation budgets independently; tune them through paired scenario runs. ([Rejection loops §§6–7](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/2-rejection-loops.md); [Fresh-start §1](/Users/darrellmiller/Documents/code-minecraft-ai/docs/decisions/fresh-start-analysis-2026-11-22.md))

3. **Remove unconditional waiting, but replace its load control explicitly.**

One outstanding request per bot does not bound fleet load or rapid sequential failures. Add:

- Global inference concurrency and token-rate limits, bounded queues and fair scheduling.
- Coalesced events, observation/plan versions, and stale-answer rejection.
- Backoff when no meaningful state changed, with event-based wakeups.
- Commitment to a running skill while it makes progress; ordinary observations should not continually preempt it.
- Detection of A→B→A cycles using goal progress, not just repeated skill names.

Feasible menus remove known invalid proposals only if their contracts are accurate. They cannot prevent alternating valid-but-useless calls or immediate execution failures.

The older 20-second experiment produced 41% more calls while executed decisions fell 2%. The cooldown report also estimated 28–42% idle waiting, while report 3’s 45–64% “decision gap” uses an inferred window. Don’t promise that entire gap as recoverable throughput. ([Cooldown, “History” and “Baseline”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/reports/cooldown15-01-2026-11-01.md); [Time accounting, “Limitations”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/3-time-accounting.md))

4. **Reflex ownership and successful execution matter more than tick frequency.**

A 250 ms timer offers little protection if pathfinding blocks the event loop, cancellation leaves controls active, or another reflex replaces the escape route. Require execution-lease revocation, exclusive emergency control, hazard arbitration and measured detection-to-actuation latency under load. Resume ordinary work only after verified recovery with hysteresis.

Air-route checks need execution costs, oxygen margin, tool availability and continuous validation. Unknown blocks must remain unknown. No dig-out routine can honestly promise it “always ends in air.” Test unavailable escape routes, falling blocks, fluid changes, simultaneous hazards, disconnects and stale callbacks.

The reported 90%/88% figures are **reflex presence among deaths**, not reflex failure rates. Measure all emergency episodes, including successful rescues and false alarms. Keep start/transition/end records under one emergency ID; a final-only record disappears on crashes. Eating remains an actuator or automatic maintenance action, not merely an observation. ([Danger, “Did reflexes fire?” and “Near misses”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/7-deaths-and-danger.md); [Skill reliability, “Who aborts”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/1-skill-reliability.md))

5. **78–80% agreement is suitable for screening, not an unqualified weekly quality KPI.**

Agreement does not reveal prevalence bias. A judge can agree 80% while systematically overstating good decisions. Sonnet’s 87% does not make it ground truth either.

Use a probability sample with blinded human/strong-judge adjudication of a random subset, plus separately reported difficult cases. Track sensitivity, specificity, argument accuracy, abstentions and error by model, skill and situation. Freeze judge/rubric versions; overlap old and new versions when changing them. At 200–300 independent decisions, sampling uncertainty alone is roughly ±6–7 percentage points near 50%; clustering and judge error add uncertainty.

The old answer key labels **old actions**, not every newly generated alternative. Replays need fresh grading with the actual offered menu and contracts. Keep a held-out set and add new-runtime episodes. Avoid rewarding hint obedience by definition—the prompt report explicitly acknowledges that bias. ([Answer key, “Caveats”](/Users/darrellmiller/Documents/code-minecraft-ai/docs/reports/answer-key-v3-2026-11-23.md); [Prompt features §§3.1, 5](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/4-prompt-features.md))

6. **Before building, resolve evidence inconsistencies and test complete recovery.**

Reconcile 30,931 versus 30,933 labels, 931 versus 933 random samples, and `repeat_loop` recurrence of 92.8% versus 67.4%. Also correct report 9’s claim that 1.71M discarded items exceeds 1.85M deposited items. Its post-treatment matching and model/era confounding do not establish that code changes were ineffective. ([Releases §§1, 3–4](/Users/darrellmiller/Documents/code-minecraft-ai/docs/analysis/pre-project/9-releases-orders-gates.md))

Then test complete prerequisite chains: full bag plus full chest; no tool plus blocked exit; cancellation during transfer; exhausted recovery options; repeated deferral. Preserve recovery capabilities when removing broken menu entries.

Prioritize verified goal completion, useful output per hour, cleanup debt and human interventions. Refusal rates can reach zero simply by offering nothing. Build one complete, instrumented task first; compare menu and cadence changes through paired runs before adding more policy.
