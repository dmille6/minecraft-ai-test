# Two-engine review, reconciled — 18 September 2026 23:45 UTC

Claude (subagent, repo + web search) and ChatGPT (codex exec, read-only, repo) reviewed `review-memo-2026-09-18.md` independently and without sight of each other. **They converged on every major call, which is the signal the owner's rule exists for.** Both told me my headline proposal was wrong.

## Where they agree

1. **Do NOT register v22 as written.** Both: excluding refusals blinds the gate to this project's documented bug class — "two individually-correct guards meeting where the bot had no legal move", where the refusal IS the mechanism.
   **Claude's objection is fatal and I verified it:** during an air emergency the rescue seizes and holds the body (`reflex.mjs` ~1955-1975), which is exactly what owner-01b's rows show — every rung `refused (body held by air)` or `preempted blocks=0`. So a movement/escape change **structurally cannot produce `outcome=ran` inside a fatal drowning episode**, and drowning is 58% of deaths. **v22 would be vacuous for the majority of deaths — it fails the very preflight I proposed alongside it.**
   **ChatGPT's independent objection:** the licence function receives only event *names*; the caller reduces change rows to names and truncates detail, so outcome and episode never reach it. v22 is not implementable as an outcome filter without a data-contract change.
2. **`gate-power.py` as a general framework is wrong.** ChatGPT: *"reachability is not power"* — a synthetic pass/fail witness establishes neither exposure nor false-revert probability, and forcing every safety gate to have realistic trip opportunities would obstruct legitimate rare-event monitoring. Claude: by my own table it would have caught **1 of 6** defects, and building it as a separate script **repeats defect #5** — two instruments that must agree about the draw and will drift. Split it: static vacuity is cheap and total; power is probabilistic and per-draw; fold both into `drawexposure.py` rather than a new script.
3. **Navigation/gather must precede drowning.** Claude's arithmetic decides it: navigation-class gather failures run ~7.6/bot-h → **~455 events** on a 10-bot 6-h canary, against drowning ceilings at 0.2/bot-h → **~12**. About 38x the exposure, on the metric that is actually failing its gate. And *"gated behind the movement owner as program step 3"* is a plan, not evidence — letting it block the only failing metric is CLAUDE.md's "never closing" failure wearing a roadmap.
4. **Fix the verdict path first, and bound it.** ChatGPT: a replay acceptance suite over recorded incidents (inert deployment, wrong-run evidence, undefined endpoint, background death + irrelevant rung, refusal blocking an executable rescue, an injected known regression), ~1 engineer-day, then stop adding harness scope. Claude: the same target stated as one invariant — **"no single canary death may licence a REVERT by any path"** — because the change-row licence path bypasses v21's arithmetic entirely and is the last surviving single-death revert route. It fired today. Closing it costs zero fleet time.
5. **The drowning endpoint as drafted is broken.** ChatGPT: ceilings-per-episode **can reward failure** — fewer ceilings may mean the bot died sooner. Claude: it has no power at all (~3 canary episodes). Both: measure *reaching and sustaining breathable space* within a fixed horizon per eligible episode, with death or continued entrapment as failure and incomplete observation censored; use the rate, pre-register the MDE.
6. **The runway is shorter than I said.** Promotions must stay out of the 24-27 Sep read window, so there are **~5-6 days**, not nine.

## Where they differ

- **Seed canary timing.** ChatGPT: run it separately, unranked. **Claude is sharper and time-critical:** start it now so its 72 h closes well before 24 Sep, because re-seeded pools inside the read window are a world-level confound on gather and stock.
- **`openloop.py`.** Claude reviewed the fix and had no objection. **ChatGPT exercised the function and found a real residual defect:** a later decision carrying the **wrong `run_id`** still closes the deployment, exactly as the correct run's would. Ordering was necessary and not sufficient — identity is also required. ChatGPT is right; Claude did not test that case. **Fixed tonight.**
- **Throughput ceiling.** Claude alone raises the only idea that changes throughput by a *multiple*: CLAUDE.md's "one canary pool, ever" is justified by *"the tripper matches `canary_pool` literally"* — an implementation limit, not a statistical one. With 80 bots over 16 worlds, 2-3 disjoint canaries could run concurrently if the tripper accepted a **set** of declared versions. ~1-2 days, and it touches the fleet's halt protection. **Flagged for the owner, not for me to take alone.**

## Errors in my own work, found by the reviews and verified by me

| claim | status |
|---|---|
| "62% of gather failures are navigation" | **WRONG.** I listed three fail classes and summed two. `unreachable`+`no_path` = 14,544 (61.8%); adding `no_safe_target` = 22,270 (**94.6%**). `no_safe_target` is a *safety* refusal, not a reachability failure, so 14,544 is the defensible number — but the memo's presentation was incoherent. |
| "89 fires → 72 deaths" | **WRONG wording.** 72 is event-level matches across 89 fires; the distinct drowning-death population is 21-28 depending on window. Repeated warnings are not independent outcomes. |
| ChatGPT's "1,498 unexplained terminals" | **ChatGPT is wrong here.** 6,374 + 23,544 + 1,498 = 31,416 exactly; the 1,498 is the `aborted` bucket, reported in the read but omitted from the memo. My omission, not a gap in the data. |
| "the canary was safe" / "gather cannot reach 40%" / "nothing was learned" | **Overstated,** both engines. Correct: listed guards stayed within limits; gather is far below target; owner exposure occurred. |
| "two metrics will fail" | Should be **"gather is failing; stock returned is unreadable"** — it is specified in items/bot-h and reported as a success percentage. |

## The correction that changes a design — the drowning health floor

Claude caught that my drowning report accounted for **235 + 23 = 258 of 291 yields** and silently dropped 33. Re-read over 24 h to 23:40Z (windows rolled, so totals differ from the morning read — 321 yields, 21 drowning deaths; the morning read had 291 and 27):

| health at yield | n | fatal ≤ 180 s |
|---|---:|---:|
| under 5 | 19 | **100%** |
| 5-10 | 1 | 0% |
| 10-15 | 3 | 67% |
| **15-19.9** | **27** | **70.4%** |
| 20 (full) | 271 | **0.7%** |

**The band I omitted is larger than the band I reported, and it is 70% fatal.** The separation is not "3.17-4.67 versus full health" — it is **"not at full health" versus "at full health"** (50 yields at 80% fatal vs 271 at 0.7%). A floor set at health 5, which is what my report implied, would miss 27 yields that die 70% of the time. Design the floor at *any health below full*, and say so.

## Also verified tonight: "the proven pieces" are half-proven

`floatDigTargets()` returns `[]` unless `path[0].toBreak` is non-empty — it requires a **pathfinder plan's first move** (`digapproach.mjs:481-482`). The drowning rescue has no path, so the drowning remedy must synthesise its own target (the lid above the head): **new code with no fleet history**, not a reuse. `floatDigOk()` is reusable. And the `_goto_float_dig` positive control (72 fires, 0 deaths) is **selected** — those bots had a path, i.e. they were not sealed, which is precisely the population the remedy is for.

## Prior art I should use instead of inventing (Claude, with URLs)

- **Static vacuity by mutation of checkers** is 15-year-old hardware-verification practice — CLAUDE.md's "a source test that has never been seen to fail is not a test", formalised.
- **Cloudflare's `pint`** lints Prometheus rules that cannot fire: a **linter in CI**, not a per-deploy proof. Supports keeping the vacuity half cheap and total.
- **Prometheus `unit_testing_rules`** already supports asserting an alert must NOT fire — the both-branches idiom, off the shelf.
- **Netflix sequential testing** is a better answer to v21's real problem than a wider CI: the gate is polled ~108 times, and a one-sided bound re-evaluated at every look still spends error at every look. If v21 gets a second pass, take an always-valid sequential test.
- **Kayenta/Netflix A/A canaries** measure the false-alarm rate of the judge itself. I did this once by hand (46% false revert). Make it standing: one A/A canary per week buys the only honest number about the apparatus.
- **`mustHaveData`** (Kayenta) and Google SRE canarying guidance: explicit missing-data handling rather than a metric silently reading as a pass.
- **mineflayer-pathfinder issues #222, #273, PR #380** characterise upstream exactly the navigation failures behind the 14,544 — which makes navigation **cheaper** to attack than the memo assumed.

Negative claim with its control (Claude): no published system runs persistent, non-episodic, multi-day LLM agents in Minecraft with survival or tool-retention endpoints — and the same searches *did* return Project Sid, Voyager and Odyssey, so the space is populated and the search could have found one. Two searches, not a survey.

## What I am doing as a result

1. **v22 WITHDRAWN as drafted.** Replaced by the invariant below.
2. **v23 (prospective): no single canary death may licence a REVERT by any path.** Stated once, at the top of the rules, so a third path cannot be invented. The refusal class is not abandoned — it moves to a **pre-registered DiD guard on a row kind BOTH arms emit**: share of escape episodes ending with zero measured body displacement, and time-to-first-displacement per episode. `escape_rung` runs ~7/bot-h, so that guard has hundreds of events where deaths have one, and it fires symmetrically on exactly "two correct guards composing into a dead end". Displacement is read from `bot.pos`, **not** from the rung's self-reported `outcome` — a change that misreports itself is not exotic here; owner-01 shipped inert with every self-report green.
3. **`openloop.py`: identity AND ordering** (ChatGPT's verified defect).
4. **Queue reordered**: seed canary → verdict-path repair → navigation/gather → owner-01c → drowning → falls-02.
5. **No `gate-power.py`.** Two checks folded into `drawexposure.py` instead: a non-degenerate pre-period on the primary metric, and exposure against the MDE-implied n. Gates carry `role: deciding | tripwire`; only `deciding` gates block.
6. **keepInventory OFF moves after 27 Sep** — Claude caught that seed-canary-plus-72h lands it ~21-22 Sep, two days inside the read window, changing what a death costs.
