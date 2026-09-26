# Is the reliability program realistic? — 13 September 2026

Owner's question: "I like that plan. Is it realistic? Are the numbers realistic?" Answered independently by ChatGPT (Codex) and Claude, then reconciled. Short answer from both: the shape of the program is right, the schedule will slip, and the two-week and six-week numbers as written are not realistic. Revised numbers we can commit to are in Part 3.

## Part 1 — Claude's assessment

### The numbers, one by one

| Target | Written | Realistic? | What I would commit to (2 wk / 6 wk) |
|---|---|---|---|
| Deaths per bot-hour (today 0.06–0.10) | ≤ 0.02 / ≤ 0.005 | No. Three death channels, each needs its own fix, canary and rollout; the fleet has promoted one change in 72 h. | ≤ 0.05 / ≤ 0.03 |
| Immobile bot-minutes (today ~3 bots; 20–29% on two pools) | ≤ 1% / ≤ 0.25% | Two weeks: possible for the Delta class only. Bravo-class pockets are prevention, not rescue. | ≤ 2% / ≤ 1% |
| Iron-pickaxe bot-hours (today 3.3%; 41 made, 41 lost per day) | ≥ 25% / ≥ 60% | No. Losses are deaths and escapes; halving deaths roughly doubles retention, not eight-fold. | ≥ 8% / ≥ 20% |
| Gather success (today 30%) | ≥ 60% / ≥ 85% | No. Half of gather failures are refusals that are correct (water, falling blocks, buried); the ceiling without new mechanics is nearer 50%. | ≥ 40% / ≥ 55% |
| Stock returned (today 14.7 of ~70 items/bot-h; deposits 280 ok / 567 failed / 816 no-effect) | "rising" | Not a target as written. The deposit path itself is 17% successful; that is a separate, tractable bug. | ≥ 20 / ≥ 30 items/bot-h |

### Why the written numbers are wrong

They were set by what "reliable" ought to mean, not by what one week of this fleet's history says a change moves. The measured pace is the constraint: one promotion, two reverts on unrelated deaths, three inconclusive reads in 72 hours. A six-hour canary and a five-bot pool cannot certify a 67% death reduction; the noise band on five bots is larger than the effect. The sandbox shortens mechanism proof to minutes but does not shorten fleet validation at all.

### The assumptions most likely to be wrong

1. **That the sandbox corpus covers the deaths.** It reproduces captured traps faithfully. Explore falls into lava, the biggest channel, are not a fixture yet, and a fixture cannot reproduce "unseen terrain over six hours."
2. **That survival fixes raise output.** Deposits fail or do nothing 83% of the time. A bot that survives and reaches home still returns little until the deposit path is fixed. That is a smaller, cheaper bug than any movement work and should be in week one.
3. **That two review passes and a feature flag make integration fast.** The arbiter took one day to build and wire behind a flag; routing every reflex and skill leg through it, then proving no regression on the corpus and one safety canary, is a week, not four days.

### The schedule I actually expect

- Days 1–2, proving ground: done today, coverage incomplete (no lava-fall or idle-lava fixture yet).
- Days 2–6, movement owner: the arbiter is built and wired; the owner's states and routing are days 4–10.
- Days 4–10, navigation: one intervention (leg overrun budget) validated on the corpus; a safety canary by day 10 at best.
- Days 7–14, rules-first worker: demonstrated in the sandbox by day 14; fleet rollout in week 3.
- Weeks 3–6: staged rollout and regressions consume the period; "hardening" is optimistic.

### What I would cut to make it certain

Cut full navigation ownership and the general worker to a **restricted operating envelope**: known resource sites, dry routes, no exploration into unmapped terrain, one gather–deposit loop with verified inventory transfer, tools carried home. Add one item: fix the deposit path first, because it is 17% successful today and every other gain flows through it.

## Part 2 — ChatGPT's assessment (Codex, independent)

**1. The targets**
The program is technically credible. Its outcome targets outrun its demonstrated delivery rate. Commit throughput is high; validated fleet improvement is slow.

| Metric | Two-week target realistic? | Six-week target realistic? | What I would commit to: 2 / 6 weeks |
|---|---|---|---|
| Deaths/bot-hour | No. Requires a 67–80% reduction across multiple death channels. | No. Requires a 92–95% reduction. | ≤0.05 / ≤0.025 |
| Immobile bot-minutes | No. Concentrated pool failures still need fleet validation. | No. 0.25% leaves almost no allowance for unresolved traps. | ≤2% / ≤1% |
| Iron-pickaxe bot-hours | No. 25% is 7.6× baseline while gains merely replace losses. | No. 60% is 18× baseline. | ≥10% / ≥25% |
| Gather success | No. Doubling requires dependable navigation and completed work cycles. | No. 85% exceeds the evidence from current execution. | ≥45% / ≥65% |
| Stock returned | No proposed target to assess. | No proposed target to assess. | ≥20 / ≥30 items/bot-hour |

These are operating commitments, not statistically established forecasts. Measure them across the entire fleet, including failed runs. Resolve the immobility denominator first: "three bots" is not a bot-minute measurement.

**2. The assumptions most likely to be wrong**
- Sandbox success transfers cleanly to survival uptime. Replays prove captured traps are reproducible. They do not establish safety through unseen terrain, competing actions, or long operating periods. Two reverted and three inconclusive canaries expose that gap.
- Navigation fixes automatically produce economic gains. Only 280 of 1,663 deposit runs succeed: 16.8%. Inventory accounting, task completion, equipment replacement, and return routing are separate bottlenecks.
- Implementation pace equals validation capacity. One fleet promotion in 72 hours is the relevant pace. Six-hour canaries, intermittent owner attention, and inconclusive results dominate the schedule. Capping reviews limits effort; it does not resolve remaining defects.

**3. The actual schedule**
- Days 1–2: Proving-ground infrastructure complete. Coverage remains incomplete; more captures continue.
- Days 2–6: Arbiter integration, ownership conflicts, regression fixes, and one interpretable canary. Fleet adoption remains unfinished.
- Days 4–10: One targeted navigation intervention validated. Full navigation ownership remains unfinished. Tool-less flooded pockets require prevention.
- Days 7–14: One deterministic worker loop demonstrated in controlled conditions. Fleet rollout extends beyond day 14.
- Weeks 3–6: Staged rollout, retention fixes, regressions, and measurement. Broad fleet reliability consumes this period; it is not merely hardening time.

**4. What I would cut**
Cut full navigation ownership, general-purpose worker scope, and tool-less underwater rescue. Restrict work to approved dry routes and known resource sites. Stop exploration into unknown hazards. Implement one gather–deposit loop with verified inventory transfer and bounded failure handling. Commit firmly to that restricted operating envelope and its acceptance tests. No scope cut makes survival-rate numbers certain.

## Part 3 — Reconciled: the numbers we commit to, and the program as amended

Both engines, independently, reached the same verdict on every target and the same cut. The committed numbers take the more conservative of the two where they differ.

| Measure | Today | 2 weeks (72-h read) | 6 weeks (7-day read) |
|---|---|---|---|
| Deaths per bot-hour | 0.06–0.10 | ≤ 0.05 | ≤ 0.03 |
| Immobile bot-minutes, fleet-wide | to be measured as bot-minutes today | ≤ 2% | ≤ 1% |
| Iron-pickaxe bot-hours share | 3.3% | ≥ 8% | ≥ 20% |
| Gather success | 30% | ≥ 40% | ≥ 55% |
| Stock returned per bot-hour | 14.7 | ≥ 20 | ≥ 30 |

Amendments to the program, both engines agreeing:

1. **A restricted operating envelope is the product for six weeks:** known resource sites, dry routes, exploration only into mapped terrain, one gather–deposit loop with verified inventory transfer, tools carried home. Full navigation ownership and the general worker are built underneath it, not promised by it.
2. **Fix the deposit path in week one.** 17% success is the cheapest large gain in the program and every other gain flows through it.
3. **Tool-less flooded pockets are prevention** (keep a wooden pickaxe in hand), not rescue. The rung is built for the tooled case.
4. **Schedule as ChatGPT states it:** the movement owner lands over days 4–10, one navigation intervention is validated by day 10, the worker loop is demonstrated by day 14 and rolls out in week 3, and weeks 3–6 are rollout and regression, not hardening.
5. **Survival numbers are commitments to operate against, not forecasts.** Nothing in the plan makes them certain; the honest promise is the envelope, the corpus gate, and a fleet safety read on every change.

The decision for the owner is unchanged: six weeks in which survival and retained tool-hours outrank exploration and gross throughput, with a throttled fleet, now against the numbers above.
