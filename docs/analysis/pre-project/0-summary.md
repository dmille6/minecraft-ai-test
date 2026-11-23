# Pre-project analysis: summary (2026-11-23)

Seven analyses of the full old-fleet history (15.6M decisions, ~126M skill/event rows, 08-05 to 11-22) plus the Opus answer key
(30,931 graded decisions). Each linked report gives its denominators, controls and caveats.

| # | Report | Headline |
|---|---|---|
| 1 | [Skill reliability](1-skill-reliability.md) | Some "bad reasoning" was really **broken skills or success checks**. bucket succeeded 0 times in 110k calls. In 142k gather failures the route was found but nothing was collected. 17% of goto "arrived" results were scored unknown. Most aborts came from the bots' own reflexes, and 19% of November "entombed" alarms were false. |
| 2 | [Rejection loops](2-rejection-loops.md) | The gate refused **36.6% of all decisions**. Refusal streaks took about **29% of active bot time**. After a refusal the bot picked the same skill 67% of the time. After a repeat_loop refusal the same refusal followed 93% of the time. The prompt *did* give the reason (99%), but the skill menu was never narrowed. |
| 3 | [Time accounting](3-time-accounting.md) | Bots **waited between decisions 45–64% of the time**, mostly because of a built-in 30 s cooldown. Model latency was only 1.7 s at the median. Productive work was 6–8% of time; navigation losses were 10–15%. |
| 4 | [Prompt features](4-prompt-features.md) | Following the prompt's hint: **+22 points** sensible. Half of the prompts contradict themselves, giving a hint for a skill the same prompt shows as refused. More refusal lines go with more repeats. |
| 7 | [Deaths and danger](7-deaths-and-danger.md) | **36 deaths per 1,000 bot-hours** (8 by November): drowning 56%, falls 22%, lava 19%. **There were no hostile mobs, ever**, because every world was peaceful. Reflexes fired but failed: before 90% of drownings and 88% of lava deaths. 1.9M items were lost. |
| 8 | [Logging gaps](8-logging-gaps.md) | What the new platform must log from day 1: linking IDs, the menu offered, rejection chains, who cancelled, effects, a block ledger, a weekly graded sample. |
| 9 | [Releases, orders, gates](9-releases-orders-gates.md) | **No old release measurably improved decision quality.** The rise from 21% to 42% sensible follows the **model** (qwen2.5 7B 33%, gemma4 40%, Qwen3.5-4B 43%). Orders succeeded less often than the model's own choices (41% against 50%). The junk well destroyed 1.71M items, almost as many as went into chests (1.85M). (Corrected: an earlier version said "more than".) |

## What this changes in the new platform

1. **Feasible menus with no repeat offers.** A rejected skill or argument set is removed from the next choices. After two refusals the skill is off the menu for a few decisions. Show only the latest refusal, as a short note with a remedy. *(Reports 2, 4)*
2. **A data-derived recovery ladder.** No exact retries; one retry with changed arguments; replan at 3 refusals or ~2 min; set aside at 5 or ~4 min; escalate at 10 or ~8 min. *(2)*
3. **Hints that never contradict themselves.** Compute the hint after the gates and filters, and phrase it as a recommended call with arguments. *(4)*
4. **No 30 s cooldown.** Decide when a skill ends or something meaningful changes, with one outstanding decision per bot. This could multiply productive time. *(3)*
5. **Fix the skills before blaming the model.** Rebuild gather, goto, mine, craft, home and deposit with verified outcomes. Drop bucket, swim_to, build, follow and come from the menu. Turn status and eat into observations. *(1)*
6. **Navigation first**, then a **fast reflex layer:** a ≤250 ms survival tick; air planning before entering water; lava as a hard pathfinding rule; drop checks; retreat at 10 hp; a death-site memory. *(3, 7)*
7. **Model quality is the strongest lever measured.** Newer models were 7–10 points better under the same old architecture. Screen the candidates next. *(9)*
8. **Before easy or normal difficulty:** combat, food, armour, torches and shelter. None of these was ever tested. *(7)*
9. **Storage design.** Stop destroying cobblestone in the junk well (1.71M items against 1.85M deposited) and stockpile it for terraforming. Fix why deposits fail three times out of four. *(9)*

## Still to do
- **5. Offline test of the new prompt design.** Rebuild graded situations with feasible menus, collapsed refusals and post-filter hints. Ask the candidate models and grade with the best judge. This runs after the local-judge bake-off: so far Qwen3.8-27B agrees with Opus 78–80%; for comparison, Sonnet 87%.
- **6. The owner's review** on the Bot Review Bench: 50 decisions graded blind, and 54 views scored for beauty.

## Codex second opinion (2026-11-23), see [10-codex-review-of-design.md](10-codex-review-of-design.md)
**Verdict: a better direction, with two blockers:** blanket skill bans, and promotion decided on the weekly KPI alone.
- **Feasible menus need an escape contract.** Mark each option feasible, infeasible or unknown, from one registry. An exclusion applies to that target, that cause and that world state, and clears when the state changes. A past failure lowers preference; it does not prove infeasibility. Recheck feasibility at execution.
  Exclude a refused *call* (skill plus arguments) through validated candidate-call IDs, not the skill-name enum. **Empty menu:** refresh the view once, offer a bounded recovery or inspection, or else defer with a wake condition and a deadline (supervised idle, no repeated model calls). Never relax safety to fill the menu.
- **The ladder thresholds are hypotheses, not optimal values.** Track a goal-level no-progress episode across switches, deferrals and replans, and separate invalid proposals from execution failures, pre-emption and infrastructure faults. Allow a retry when the evidence changes. Use separate budgets for attempts, time, tokens and world edits. Tune it all in paired scenario runs.
- **Removing the cooldown needs an explicit throttle:** a global limit on inference concurrency and token rate, fair queues, merged events, rejection of stale answers, back-off when nothing changed, commitment to a skill that is still making progress, and A→B→A cycle detection.
  The 20 s test in September gave 41% more calls and 2% fewer executed decisions. Don't promise the whole 45–64% gap as recoverable throughput.
- **Reflexes:** what matters is exclusive emergency control with lease revocation, arbitration between hazards, and actuation latency measured under load, more than the tick rate. Resume only after verified recovery. Air routes must count oxygen margin and tools and keep unknown blocks unknown.
  **90% and 88% are "a reflex was present before death", not failure rates:** measure every emergency episode, including rescues and false alarms. Eating stays an action.
- **KPI honesty:** a judge at 78–80% agreement is fit for screening, not as the sole KPI. Use sensitivity and specificity, audits by humans or a strong judge, frozen rubric versions, and at least ±6–7 points of margin at n=200–300.
  The answer key grades the *old* actions: new alternatives need fresh grading against the menu actually offered. Don't reward obeying the hint by definition.
- **Before building:** reconcile the small count mismatches (30,931 vs 30,933 labels; 931 vs 933 in the random sample; the two repeat_loop figures, 92.8% vs 67.4%) and correct the storage claim (done above). Report 9 cannot prove that code changes had no effect.
  Test complete prerequisite chains (full bag plus full chest, no tool plus blocked exit, cancel during a transfer, recovery exhausted). Prioritise verified goal completion, useful output per hour, clean-up debt and interventions, because refusal rates fall to zero if the bot is offered nothing.
  **Build one complete, instrumented task first.**
