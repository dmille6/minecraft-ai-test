# What the new platform must log that the old one did not (2026-11-23)

Built from what the analyses could *not* answer: the ELK survey, the answer key, the Codex reviews, and the pre-project analyses.
Each item says **which question it answers**. Everything goes into the 8-event schema of the fresh-start analysis §3, with explicit values (never missing fields).

## A. Decisions: so we can always tell *why* a choice was made and *who* stopped it
1. **IDs that link everything:** `decision_id → execution_id → effect`, plus `goal_id`, `plan_version` and `trace_id`. *Today only timestamps link a decision to its outcome, and ambiguous joins are unknowable.*
2. **The menu actually offered:** the list of skills the executive could choose from, and which were greyed out and why. *The answer key cannot tell whether the bad pick was even avoidable, or whether a better skill was on offer.*
3. **The rejection chain:** for each gate or skill rejection, its reason, the `decision_id` it rejected, and whether the next prompt contained the reason. *The 57% repeat cause could only be inferred.*
4. **Who cancelled, and why:** requester (reflex / supervisor / planner / player / crash), the reason, and what pre-empted it. *Today "aborted" mixes controller interrupts with real failures.*
5. **The prompt by sections:** prompt template version, section lengths and order, and a hash of each section (the full text too, but sampled after the first weeks). *The prompt-feature analysis has to re-parse free text.*
6. **Model call details:** model and quantisation, sampling settings, queue wait separate from inference time, tokens, and cache hits. *Today latency mixes queueing and generation.*

## B. Effects: so success is measured, not claimed
7. **Before/after evidence for every skill:** inventory diff, position diff, blocks changed, chest contents diff. *`mine` had 13.7k "unverified" results in one week.*
8. **Progress counters** per skill and per goal, sampled on a schedule. *A loop that looks busy without moving the goal was invisible.*
9. **A ledger of every block change:** coordinates, before and after block, owning bot and skill, intent (temporary or permanent), clean-up owner and clean-up state. *There is no mess baseline at all from logs today; it exists only in CoreProtect and world backups.*

## C. The bot's state over time: so time and danger can be accounted
10. **A state-machine record:** every transition of `ready / running / cancelling / reconciling / degraded`, with timestamps. *The time-accounting analysis has to guess from event gaps.*
11. **Death and near-miss context:** cause, the last 2 minutes of events, which reflexes fired and when, health and air, and items lost and recovered.
12. **Liveness heartbeats** with *why* a bot is idle (waiting for the model / waiting on a reservation / nothing to do). *The 88% "idle" trigger told us nothing.*

## D. Planner and team
13. **Planner records:** goals created, decomposed and abandoned (with the wake condition); plan graphs and versions; reasons for replanning.
14. **Reservations and the work board:** claims, releases, conflicts and expiries. *Bot-on-bot interference was never measured.*

## E. World, server and beauty
15. **Land-report snapshots** on a schedule: counts of pillars, holes, floating blocks, litter, and unlit or bare ground near the base and routes.
16. **Server health:** TPS, chunk loads, memory and players online. *Terraforming load on Paper is unknown.*
17. **A render index:** each timelapse frame and project view, linked to world time and to the land report.

## F. Quality over time (the blind spot that hid the 35%)
18. **A weekly graded sample:** 200–300 random decisions graded by the local judge (Sonnet only for audits), stored with the rubric version.
    The digest shows **"sensible decisions: X% ±Y"** next to deaths and output.
19. **A repeat-after-rejection rate** in the digest, with a target near 0.
20. **Population rates by default:** every digest number gives its denominator (all bots, all decisions), not just the affected bots.

## G. Volume rules (from the ELK survey: 319 of 355 row kinds were internal noise)
- Keep every causal transition and outcome. Roll routine path and scan diagnostics into per-minute summaries.
- Keep a rolling debug buffer, flushed only around failures, plus a small random sample of successful traces.
- Store everything in Parquet on the NAS as the source of truth. Elasticsearch is a recent-window search view, and the bots never depend on it.

## Other things worth digging into in the data we already have
- **Did any old "KEEP" release actually improve decision quality?** Join the answer key to `code.version`. *The fleet ran ~15 code versions; this shows whether the canary process measured the right thing.*
- **What the old orders cost:** time the bots spent in hard-coded orders against model-chosen work, and the results of each.
- **How well the gates worked:** for each gate type, how often a rejection was followed by a better choice or by a loop.
- **Storage and chest flows:** how items moved between bags and chests, where bags filled up, and how often deposits had nothing to bank. This shapes the warehouse design.
- **Latency against quality:** whether slow model answers were worse or better (queue pressure, timeouts).
- **Bot-on-bot interference:** several bots targeting the same block, chest or cell within a minute.
