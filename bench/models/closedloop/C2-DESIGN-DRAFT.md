# Stage C2 design (revision 2, after Claude + Codex review: both CHANGE): overseer and stuck escalation in the closed loop

**Needs the owner's OK before it is built:** it adds bot code. The code goes on the bench-only branch
`bench-closedloop`, which runs only on the sandbox and is never deployed to the fleet.

## Goal

Measure whether a larger model raises a 4-8-bot colony's useful output on the Paper sandbox. It is tested in two
roles, on top of the best per-bot brain from C1:
- (a) town overseer;
- (b) stuck escalation.

## Delivery: a directive hook, not a chat side-door

Both reviews found the same problem with the chat side-door. Chat commands call `runner.run` directly
(commands.mjs:67/76/105). That skips:
- admission (cognitive.mjs:790-813);
- the outcome feedback (lastOutcome, the milestone counter, memory).

On top of that, runner refusals (paused/busy/body_held) return before any row is written (runner.mjs:164-196).

The revised path is a **bench-only directive queue inside cognitive.mjs**:

**Transport**
- A whitelisted chat sender (`mbench-Mayor`) posts `<bot> directive <id> <json>`. Every other sender is ignored
  for this verb.
- The directive is one skill call, or a short ordered list (GET_WOOD = goto, then gather).

**Execution**
- The brain's own decisions pause for the directive's lease.
- Each step goes through the same admission as a model proposal. Any exemption is logged as one.
- Each step is logged `requested / admitted / started / completed / refused`, with origin
  (`overseer` | `escalation`) and the directive id.
- The outcome is fed back exactly like a model decision's.

**Refusals**
- `runner_paused` (the 3-failure pause) is waited out, up to its auto-resume, and logged. A directive is never
  silently dropped.
- A refused directive releases control at once, so the brain keeps a legal move (CLAUDE.md: no dead ends from
  two guards meeting).

**Priority:** escalation > overseer > the bot's own brain. At most one directive per bot at a time.

## Arms

All arms use the same best C1 worker, 8 bots, a 2 h run, and the same resets.

| # | arm | what it isolates |
|---|---|---|
| 1 | no overseer, no escalation | baseline |
| 2 | deterministic allocator (mayor_core.decide) through the same directive path | an allocator + actuator, no LLM |
| 3 / 4 | LLM overseer A / B (validated with mayor_core.validate) | 3/4 vs 2 isolates the LLM's allocation |
| 5 | LLM stuck escalation only | rescue |
| 6 | overseer (best of 3/4) + escalation | the combined stack |

**Presence, triggers and memory, identical in every arm**
- `mbench-Mayor` joins the world in **every** arm and stays silent where it has no role.
- The escalation trigger is computed **in shadow in every arm**, so rescue is measured intent-to-treat over all
  triggered episodes, not over matched survivors.
- Co-residency: the worker and the overseer model are both loaded in arms 3-6. Each arm reports the bots'
  decision latency and decisions per hour, so a GPU-sharing slowdown is visible and cannot hide inside "advice
  quality". The memory budget is checked with `ollama ps` before each run.

**Escalation trigger, defined**
- Fires when the bot is within 8 blocks of its window start for 5 min AND the window holds at least 3 failed,
  rejected or unknown rows, deduplicated per decision.
- An episode starts at the trigger. It ends when the bot is 8 or more blocks from the start, or dies, or the run
  ends.
- Cooldown is 5 min from the last escalation. At most 3 escalations per episode, then control returns to the bot.

**Overseer cadence**
- Every 5 min, one request in flight at a time.
- The snapshot is built from the run's own logs and facts by the shadow mayor's code, pinned at the deployed md5
  `fa27084...` (shadow-mayor branch, 784b71c lineage).
- Duty prerequisites are rechecked at delivery. Stale answers (older than 5 min) are dropped.

## Measurement

| what | how |
|---|---|
| primary | team useful output per hour |
| ledger | crafting is priced at its inputs, so it never creates value; withdrawals are netted; missing bots count as 0 |
| terminal census | inventories read from the server over RCON at the end of the run |
| secondary | milestones (time to each, censored), pickaxe-less share, deaths per bot-hour (a cost, since keepInventory makes death a free teleport) |
| overseer | directive counts (requested / admitted / completed / refused); duty outcome within 10 min |
| escalation | triggered episodes per arm; time to exit, intent-to-treat |

**Run count** comes from C1's measured run-to-run variance, before any C2 run. The primary contrasts are fixed in
advance:
- 2 vs 1;
- 3/4 vs 2;
- 5 vs 1;
- 6 vs 1.

Runs are the independent units. Arm order is randomized within matched-start blocks.

**Isolation.** The sandbox lock and a GPU reservation (a marker file the Stage A queue honours) are held for the
whole run. Cleanup runs in a `finally` path. Every run records immutable identifiers:
- bot code sha;
- model digest;
- mayor md5;
- config.
