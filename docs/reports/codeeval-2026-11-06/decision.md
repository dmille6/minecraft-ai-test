# Code evaluation: DECISION (how a bot picks what to do next), 2026-11-06

Read-only. Code: origin/main `bd2c308f` (read-only worktree `/Users/darrellmiller/Documents/.wt-eval-decision`). Fleet `4f3b0f5c`.
The measurements are full walks with `lib.telemetry.stream_rows` and `lib.busytime.classify` on .31, run at nice 19. Script:
`codeeval/dslice.py`. Window 11-05 23:00Z to 11-06 02:00Z, 3 h, across the rotation. It covers **80 of 80 bots, 240.0 of 240.0
bot-h observed** (0 unobserved), 296,288 rows. Positive control: the classes sum to the window, and attributed slices sum to the totals.

## (a) Summary

1. **Bots spend 83% of their time on the idle lap.** 198.9 of 240 bot-h are on the rungs `patrol`, `return`,
   `deposit_surplus` and `idle`. Productive work is **8.4%** of bot time. Decision time is **57.0%** (llm 4.7 + pause 6.4 +
   between 45.9), and **81% of that decision time (111 of 137 bot-h) is spent on the lap rungs**.
2. **Decision time splits into a fixed wait and vetoes.**
   - **49%** is the fixed gap after an admitted model decision. The 15 s cooldown applies to every step: 21 bot-h follow
     successful `explore` calls alone.
   - **47%** follows a **veto**: repeat_loop 22%, deposit_nothing_to_bank 9%, learned_avoid 4%, unreachable_elevation 3%,
     not_worth_it 3%, cooldown 3%.
   - Deterministic work orders fill only **3%**.
3. **Root cause: two schedulers that never talk to each other.** The personal ladder (milestones.mjs) pushes every bot 80
   blocks out and back, forever. Town work (build/deep-mine/mats) is offered only as one late slot in a ~20-step
   `if (!order)` chain, and only while the bot happens to stand within 48 blocks of home. The picker is `activeProject` =
   the first open project, with a no_site back-off scoped to the bot. jobshadow: only **35% of ~23 open town needs get a bot
   within 60 min** (142 ticks, 24 h), while 83% of bot time is laps.
4. **The fixes measured as the biggest levers are built or designed but have not run.** vetoremedy-01 was built 11-03.
   repeatwork-01 and depositoffer-01 are designed. All three sit at queue positions 12-14 behind the one canary slot.
   Detection exists (driftwatch daily, goalwatch 3 h), but it alarms into logs with no actor, and it is blind to "busy doing
   nothing".
5. **Verdict: PARTIAL refactor.** Replace the scheduling layer (the sustaining ladder, the order chain and the project
   picker) with a **town work board**, built in stages from jobrules/jobshadow. Keep admission, skills, the pure deciders and
   lessons. Land the three queued targeted fixes first.

## (b) Findings, ranked by impact on "bots keep working / progress keeps moving"

| id | finding | evidence | impact (numbers) | rec | effort | risk |
|---|---|---|---|---|---|---|
| D1 | **The sustaining lap is unconditional.** `patrol` is met by being >80 blocks out. `deposit_surplus` is met trivially when no chest is within 48 (it sits *before* `return`, though its comment says after). `return` is met within 15 blocks. The exhausted chain re-enters because `patrol` is outstanding again at home. The count is `patrol#3520` re-entries on board-a-Alpha. The lap never checks town demand. | milestones.mjs:820-880 (rungs), :1051-1067 (re-entry); llm row board-a-Alpha 02:28Z: TASK patrol, model chose `goto home`, vetoed repeat_loop | 198.9/240 bot-h (83%) on lap rungs. patrol alone is 117 bot-h (51.7 walk, 57.0 decision, 7.2 productive). Fleet value/bot-h 16.14 -> 9.90 after dirtrung-01 exposed the lap (idlework design) | FIX now: idlework-01 (built, queued #2: batches of iron/logs/coal instead of the lap, return before deposit). REFACTOR later: the board replaces the rung | S (built) / L | med: more mining exposure; read deaths, stratify 4B vs q7 |
| D2 | **Town work reaches a bot only by accident.** build_shop, deep_mine and make_material are order-only (`chatOnly`). The model cannot choose them. `#shopOrder` is gated on `atTown` (<=48 blocks), sits at chain slot ~13 of ~20 (`if (!order && SHOP.on ...)`), and has a 10-min per-bot cooldown, while D1 sends the bot away. | cognitive.mjs:843 (atTown), :1564 (slot), shop.mjs:244 (cooldown); jobshadow log 11-05 03Z-11-06 02Z | 35% of open town needs covered within 60 min (8.1 of 23.3 mean, 142 ticks), while ~1,600 bot-h/day sit on laps. In 3 h: 586 build_shop orders vs ~23,000 model calls | REFACTOR: a town work board (section d) | L | med-high |
| D3 | **The picker is first-open-project with bot-scoped back-offs.** It always takes the first open project that has a free slot. Otherwise it takes `open[0]` even when that project cannot be sited. `no_site` is the *bot's* `lastStop`, which holds that bot's order 24 h whatever project is next. There is no fairness across projects (one monument with 3 slots takes every visit). Each new project adds a special case (`damaged/due/dueFirst/waiting/free/stuck`, tidyFirst, yard work). | shop.mjs:134-163, :611; skills.mjs:17138-17196; stuckprojects-1104 (407 monument vs 3 wall visits) | 3 h: 552 build visits, **29 success (5%)**, 444 no_effect (80%), 61 aborted. isolated-c 152 no_effect, placebo-b 80. 7 of 16 towns had no workable project (idlework). 8 projects stuck 4-63 h | FIX: idlework-01 B (an unsited project yields), stuckproj-01 (in the slot now). REFACTOR: per-project ready/blocked state on the board | S-M / L | low-med |
| D4 | **Vetoes after the model call, with no remedy.** The model proposes, admission refuses, and the bot waits ~15 s, repeated every cycle. repeat_loop refuses 4 identical keys in 8 *even when they succeed* (explore on patrol). deposit_nothing_to_bank: the prompt keeps offering deposit. `onDepositMilestone` compares `'deposit_surplus'` to ids that carry `#N`, so it is **never true** (still on main). | admission.mjs:26, :206, :432 (bug), :790; cognitive.mjs:1735; idlegap design | 65 of 137 decision bot-h (47%) in 3 h, about **520 bot-h/day**. repeat_loop 30.4 bot-h/3h (2,287 explore vetoes on patrol) | FIX: vetoremedy-01 (built 0556ddfa), repeatwork-01, depositoffer-01, run as one P bundle *ahead* of non-decision items. Fix the `#N` compare | M | med (admission is protected: two engines) |
| D5 | **A fixed cooldown after every step.** `#scheduleNext(config.llm.decisionCooldownMs)` (cap 15 s) follows any decision. CONTINUE ends it early only for gathers that gained items. The cooldown throttles the LLM but is charged to deterministic and obvious next steps too. History: shorter cooldowns were REVERTED because the extra calls became vetoed re-proposals. That is D4, not the cooldown. | cognitive.mjs:652-665, :2141-2148; config.mjs:286 | 67 bot-h/3h (49% of decision) is post-success wait, 21 of it after successful explore | FIX after D1/D4: chain the next step at once when it comes from an order or the board; keep the cooldown for model calls only. Calls/bot-h must not rise | M | med (LLM load on .72) |
| D6 | **Detection is blind to busy-but-useless.** Watchdog liveness counts vetoed decisions as alive (`lastDecisionAt` refreshed). Milestone give-up (45 min) is reset by any serving success, and patrol explore succeeds. goalwatch alarms only on STUCK *records*, so a town whose first project has no site, or that has nothing open, stays silent. driftwatch is daily: the -39% was seen a day late. The jobshadow +24 h go/no-go never ran (summary.json dated 11-03 06:22, stallcheck "jobassign-1103 QUIET 49 h"). None of these has an actor. | cognitive.mjs:674-681; milestones.mjs:1000-1006; scripts/host/goalwatch.py:42; driftwatch cron 01:20; ALARMS.log (414 goalwatch lines) | Days of lap time and stuck projects found only when the owner asked. Example: 11-05 value drop alarmed 11-06 01:20Z | FIX: an hourly per-pool "lap share / veto share / build success / towns with no workable project" in fleetstatus+STATE with a threshold, a named owner and a named remedy. Run the jobshadow summary | S | low |
| D7 | **The order chain is a hand-ordered pile.** cognitive.mjs (2,162 lines, 29% comments, 76 commits/30 d) has ~16 `if (!order)` slots plus pre-slots (mats, plinth, found, deposit, recount, junkout) and post-overrides (sky_descend, keepout). Each slot carries bespoke charge/refund logic (`refundDeclined`, `visitDisplacedRefund`, and the JIT notes for each pair). **33 test files read or mutate cognitive.mjs source (43 refs).** Each project touches PROJECTS, `projectsOn` (11 positional booleans), `blueprintOf`, `shopActive` and buildShop in a 22,286-line skills.mjs (288 commits/30 d). | cognitive.mjs:1300-1720; shop.mjs:103-117; skills.mjs:17125 | Every new job is a fresh priority fight plus cross-job refund bugs (the JIT entries). It slows every piece in D1-D5 | REFACTOR with the board: one arbitration table `{id, eligible(), priority, charge, refund}`, so pair-wise refunds go away. Move tests to behaviour scenarios with a fake clock | L | med |
| D8 | **The ladder fights the model.** The prompt shows TASK patrol while the model keeps choosing `goto home` (the "Return home to deposit" reason), which then gets repeat-vetoed. The model is asked questions whose admissible answer is fixed (D4) or empty (D1). | llm row above; idlegap: `return` 81% vetoed over 24 h | Part of D4's 47% | Folded into D1/D2: the board gives a concrete task; the LLM chooses within it | n/a | n/a |
| K1 | **KEEP:** admission as the single door, including for orders. The pure deciders (`buildOrder`, `activeProject`, `coalRunOrder`, `deepMineOrder`, `orderFor`) can be tested without a world. Orders synthesised as proposals still feed `noteAttempt` and the give-up. Milestone give-up and back-off with persisted state. Per-order telemetry rows (`work_order`, `shop_skip`). fewerdec vetoskip/pausewait. jobrules.py (pure demand/hysteresis/caps) and jobfacts (read-only). lessons evidence classes. llm.mjs failover | the files named | The step layer mostly works: build visits run, admission blocks real hazards | KEEP | - | - |

Unverified (Codex, code-derived): mats.mjs:658-682 drops a project's reduced reserve floor after 24 h without placement. That
could starve the recovery of a stalled project. Not measured here.

## (c) Codex's independent evaluation and the reconciliation

Codex ran read-only (`codex exec -s read-only`, prompt `codeeval/decision.codex-prompt.txt`, output
`codeeval/decision.codex-out.md`, final answer `codeeval/decision.codex-final.md`). It got the area, the files, the incidents and the 5
questions, not these conclusions. Its ranked findings:

1. The sustaining ladder manufactures travel without checking demand. DELETE the unconditional patrol, REFACTOR sustaining (L).
2. The picker lacks fairness and feasibility (one busy monument starves the rest; unsitable projects are refused per bot
   for 24 h). FIX back-off now, REFACTOR the picker.
3. Admission finds impossibility after paying for a model call plus the cooldown. Use typed remedies and early
   deterministic redispatch.
4. repeat_loop confuses productive repetition with looping. Make it progress-aware.
5. Some cells are physically impossible under composed guards; scheduling cannot fix those (stuckproj territory).
6. Alarms do not close the loop: goalwatch publishes, nobody re-plans. Add owner, deadline and escalation, and bounded
   auto-reassignment. Also: veto loops look alive to the liveness check.
7. jobrules is a good foundation but not a scheduler (builder demand is one `active_build`; no between-project fairness;
   roles.mjs leases need ROLES=on). KEEP the rules and build an actuator around executable tasks.
8. The reserve floor lapses on stalled projects (mats.mjs). A risk only.

Replacement: a **town task queue with bot-local execution**. Tasks are generated from unmet demand, with
ready/blocked/running/complete/parked states. Selection weighs urgency, waiting age, travel and progress, with fairness
between projects. On refusal the bot redispatches at once. The LLM chooses among feasible tasks. Its order: "First ship the
targeted fairness, veto-remedy and construction fixes; then replace scheduling incrementally."

**Where we agree:** all of 1-7, the shape of the replacement, the ranking (lap > picker/starvation > vetoes), and the
order (targeted fixes, then a staged board). Both of us KEEP the single admission door, the pure deciders and lessons, and
neither recommends a rewrite of skills.mjs.

**Where we differ, and why:**
- **The size of the patrol fix.** Codex rates removing patrol as L/high risk. A targeted replacement is already built
  (idlework-01: bounded batches with per-kind back-off, scout 1 lap in 8, IDLEWORK=0 rollback), so the first step is S. The
  L is the board. Codex did not know idlework-01 existed when it wrote this; its own idlework review had reached the same
  shape.
- **The cooldown (D5).** Codex treats vetoes as the stronger lever than inference speed and does not separate out the fixed
  post-success gap. My measurement adds that **49% of decision time follows an *admitted* model decision**, so even with
  zero vetoes the cadence costs ~67 bot-h every 3 h. That makes "orders and board steps chain without the cooldown" a lever
  of its own. We agree it only pays once D1/D4 stop the bad proposals ("faster decisions repeat the wrong work faster").
- **Measured vs supplied numbers.** Codex used the brief's and the reports' numbers. Mine are re-measured (3 h, 80/80 bots)
  and confirm them: 57.0% decision, the lap at 83% of bot time, a 5% build-visit success rate, and the queue positions of
  the veto fixes.
- **Detection.** Codex says push support exists, so this is "operational ownership", not "an unread log". Both are true: the
  push fires, but no rule or person is assigned to act, and no detector exists for lap share or for projectless/unsited
  towns.

## (d) Top 3 to do first in this area

1. **Run the decision fixes that are already built, ordered by bot-time.**
   - idlework-01 (queued #2, behind stuckproj-01 in the slot): D1 and D3-B.
   - Then pull **vetoremedy-01 + repeatwork-01 + depositoffer-01** forward from positions 12-14 as one P bundle (D4: ~47% of
     decision time, ~520 bot-h/day). They have waited 3 days.
   - Add the one-line `onDepositMilestone` `#N` fix (admission.mjs:432) to repeatwork-01.
   - Effort: S to M. Gain: the lap and the vetoes together hold ~80% of decision time.
2. **Give detection an actor (S).**
   - Hourly per pool: lap share of bot time, veto share of decision time, build-visit success rate, and towns with no
     workable project (unsited/blocked first project, or catalog finished).
   - Put these in fleetstatus/STATE, with thresholds (for example lap > 50% for 2 h, build success < 15% for 3 h, a town
     with nothing workable for 2 h). Each alarm line names its remedy and its owner (the control session).
   - Also count a vetoed decision as *not* progress for the in-bot liveness and give-up clocks (cognitive.mjs:674,
     milestones.mjs:1000).
   - Run the overdue jobshadow 24 h summary.
3. **Build the town work board (REFACTOR, L), in stages from what exists.**
   - (i) jobshadow becomes a **board writer**: per town, concrete tasks such as a build segment, a material supply from a
     project bill, a deep-mine trip, groundskeeping, banking, or scouting a named area. Each task has ready/blocked/claimed/
     parked state, per-*project* siting and stuck back-offs, and fairness by waiting age.
   - (ii) An idle bot **claims** a task wherever it is; travel to town is part of the task. This replaces the `patrol` rung
     behind a switch, and the LLM chooses only within a task or when the board is empty.
   - (iii) The `if (!order)` town-job slots and their pair-wise refunds fold into board tasks one at a time.
   - (iv) Board steps chain without the decision cooldown (D5).
   - The ladder shrinks to tool and capability prerequisites.
   - Expected gain: even a 30% conversion of the ~1,600 lap bot-h/day is ~480 bot-h/day of directed work. The new work flows
     to the 7 towns that sat idle.

## (e) Refactor verdict: PARTIAL (yes for scheduling, no for the rest)

- **Yes:** the layer that answers "nothing urgent, what now?" is the root of the idle, patrol and starvation stalls. That
  layer is the sustaining ladder, the first-open-project picker with bot-scoped back-offs, and the opportunistic at-town
  order slot. Patching it rung by rung is how the dirt filler hid the lap for weeks, and how each project added another
  special case to `shopActive`. Replace it with a town work board, built in stages behind switches.
- **No:** admission, the skill bodies, the pure deciders, lessons and llm.mjs are sound at the step level, so keep them. Do
  not try a wholesale split of skills.mjs or cognitive.mjs. That would be L+ with high regression risk and no gain in bot
  time by itself.
- **Not this area:** vetoes are partly a prompt/admission mismatch (D4, targeted fixes), and physically impossible cells
  belong to construction (stuckproj, tidydead).
