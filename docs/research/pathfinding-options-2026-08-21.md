# Pathfinding options: is mineflayer-pathfinder the blocker?

**Date:** 2026-08-21
**Question asked:** the fleet spends ~86% of `path_reset` events on reason `stuck`, ~14,800/hour.
Both candidate replacement codebases pin `mineflayer-pathfinder ^2.4.5`, so switching codebases
looks like it cannot escape the problem. What are the real options?

**Constraint (verbatim from the owner):** *"i do not want to change the world, thats a cheap cop
out fix. i need to build a problem solving platform that can work in any mindcraft environment."*
No seed cherry-picking, no flattened terrain, strongly prefer no server-side mod. Client-side is
acceptable. Must run many agents concurrently.

**Method.** GitHub API for all repo/issue/PR facts, npm registry for versions and download counts,
direct reading of the installed `bots/node_modules/mineflayer-pathfinder@2.4.5` source, and two
independent ChatGPT (`gpt-5.5` via `codex exec`) reviews — the first briefed with evidence but not
with my conclusion, the second explicitly asked to destroy my conclusion. Disagreements are
recorded in their own section. Anything I could not verify is marked **UNVERIFIED**.

---

## Headline

**The framing in the question is probably wrong, and the citations are probably the wrong bugs.**

Three findings, in descending order of importance:

1. **The fleet runs Paper 1.21.11, which has an open, still-unfixed, version-specific mineflayer
   movement regression that produces exactly this symptom** — and the repo's own README says the
   server was pinned to 1.21.8 *specifically to avoid that bug*. It is not. There is a **two-line,
   client-side** workaround. The closest independent report reproduces on **Paper 1.21.11 build
   132, offline-mode** — the lab's exact server build and mode — and does **not** reproduce on LAN
   singleplayer.
2. **`reason: 'stuck'` does not mean what the metric implies.** It is emitted from exactly one
   place: a hardcoded 3.5-second "I have not reached the next path node" watchdog. A high stuck
   count is the *recovery mechanism firing*, not a diagnosis. Fixing the known bug in that watchdog
   would make the number go **up**.
3. **Of the five cited issues, one (#54) is closed** — fixed in 1.3.0 in January 2021. Of the four
   that are open, none is the best match for the symptom; the best match is a different issue in a
   different repository, opened three months ago.

The arithmetic in finding 2 is the part that should change the plan. See "What the metric actually
measures" below: at ~370 resets/bot/hour the fleet is running at roughly **85-90% of the
theoretical maximum stuck-reset rate**. That is not "navigation is degraded". That is "navigation
is failing essentially continuously", which is a signature far more consistent with a systematic
per-step movement rejection than with terrain-dependent planner bugs.

---

## 1. The state of mineflayer-pathfinder

### Version and maintenance

| Fact | Value | Source |
|---|---|---|
| Latest npm release | **2.4.5**, published **2023-09-04** | [npm](https://www.npmjs.com/package/mineflayer-pathfinder), `npm view` |
| Latest commit on `master` | **2026-04-01** (`Merge PR #362`, a dependabot vec3 bump) | [GitHub API](https://github.com/PrismarineJS/mineflayer-pathfinder/commits/master) |
| Stars / forks | 307 / 103 | `gh api repos/PrismarineJS/mineflayer-pathfinder` |
| Open / closed issues | **44 open / 129 closed** | GitHub search API |
| Open / merged PRs | **7 open / 147 merged** | GitHub search API |
| Weekly npm downloads | **24,083** | api.npmjs.org, week of 2026-08-13 |
| Archived? | No | GitHub API |

**The honest read: semi-maintained, not abandoned, but functionally frozen.** In the ~35 months
since 2.4.5 shipped, `master` received only **two** functional commits — `Fix isEnd crashing`
(2024-01-06) and `fix(movements): use blockD instead of blockC in exclusionPlace calculation`
(2025-08-18, PR #351). Everything else is CI, Node version bumps, and dependabot.

An important nuance that cuts against the premise of the question: **pinning `^2.4.5` is not
meaningfully "behind" `master`.** The gap is two commits. Forking to get `master` buys almost
nothing. The value is entirely in the *unmerged* PRs.

A release PR — [#361 "Release 2.5.0"](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/361),
opened by the maintainer's own bot on 2026-03-30 — has sat open and unmerged for ~5 months. That is
the clearest single indicator of the project's velocity.

### The five cited issues — verified

| Issue | Title | State | Verdict |
|---|---|---|---|
| [#273](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/273) | Pathfinder can get stuck in a state with an active goal when the computed path is not complete | **OPEN** since 2022-06-15, 1 comment, no activity since the day it was filed | Real and relevant, but describes a *silent hang*, not a reset storm |
| [#222](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/222) | Pathfinding hangs indefinitely when obstructed by an unbreakable block | **OPEN** since 2021-11-23 | Real. Reporter explicitly notes it fires **no** `path_reset` events — so it cannot be producing your 14,800/hr |
| [#310](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/310) | Bot thinks it can travel diagonally when blocked by other blocks | **OPEN** since 2022-12-29 | Real, and has a documented workaround (below) |
| [#332](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/332) | Bot Constantly Stuck or Halts with GoalFollow | **OPEN** since 2023-09-25 | Weak — a support request, never reproduced. Maintainer's reply: *"some steps to reliably reproduce this issue would be good"* |
| [#54](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/54) | Bot gets stuck in water if it tries to place a block under itself while Jumping/Swimming | **CLOSED 2021-01-07** | **Not a live bug.** Maintainer Karang: *"Fixed, update to 1.3.0."* |

Two of these deserve a closer read because they change the diagnosis:

**#222 is evidence *against* the current theory, not for it.** The reporter is explicit: *"The bot
does not throw any error, nor does it trigger any 'goal_reached', 'path_updated', or 'path_reset'
events while this is happening."* A failure mode that emits no `path_reset` cannot be the source of
a `path_reset` storm.

**#310's root cause is disclaimed by the maintainer as belonging to a different library.** IceTank:
*"I think this issue is with the 1.18.1 physics implementation... The real fix would be to fix
prismarine-physics"*, and then, importantly: *"mineflayer-pathfinder simulates jumps before it
attempts them. If it detects that the simulation does not work it won't jump at all. If the bot
jumps it means the bot thinks it can make the jump. If it fails it should be because **the server
resets the bots position** making it fail the jump."*

That last sentence, written in 2022, is a precise description of the 1.21.11 bug found in section 2.
The maintainer already located this class of failure in the client/server physics boundary rather
than in the planner.

### Open PRs that target stuck behaviour — all unmerged

| PR | Title | Opened | Size | Relevance |
|---|---|---|---|---|
| [#357](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/357) | Fix `goto()` resolving when bot is stuck and no path exists | 2025-12-29 | +3/-3 | **High.** `goto()` currently checks `results.path.length === 0` *before* `results.status`, so a `noPath` result with an empty path **resolves as success**. A trapped bot reports "arrived." |
| [#365](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/365) | Fix futility check | 2026-06-10 | +11/-6 | **High.** Many movement branches `return` early and skip the futility check, so *"the agent jump[s] up and down indefinitely instead of recalculating."* |
| [#364](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/364) | Fix 1.21.x pathfinder collision bug by slightly expanding client hitbox | 2026-06-04 | +70/-6 | **Highest — see section 2.** |
| [#369](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/369) | Fix `BinaryHeapOpenSet` sift-down off-by-one and `GoalCompositeAll` heuristic sentinel | 2026-08-13 | +105/-2 | Medium. A genuine A* correctness bug (claimed to corrupt heap order on ~62% of randomized trials) but it degrades path *optimality*, not path *execution*. Would not explain a reset storm. |
| [#348](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/348) | Fixed Towering issue | 2025-04-20 | +3/-0 | Medium — this is the mindcraft patch, upstreamed. Blocked for 16 months on the maintainer not understanding it: *"I still don't understand what this is supposed to do and why it helps."* |
| [#356](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/356) | Pillar jumping bug fix | 2025-12-29 | +2/-2 | Medium. Relevant given `allow1by1towers=true`. |

PR #348's comment thread is the single best illustration of the project's state. A contributor
ports a working fix from mindcraft; the maintainer asks what it does; nobody can explain it; 16
months pass; a third party forks the repo to ship it themselves
([ChangingSelf/mineflayer-pathfinder-mai](https://github.com/ChangingSelf/mineflayer-pathfinder-mai)),
reporting *"it's working really well with Minecraft 1.21.4."* Another contributor on #356 simply
asks: *"Why has this not been merged or reviewed yet? Is there a problem?"* — no reply.

### What the metric actually measures

This is the most important technical finding in the report and it is verifiable in five lines of
the installed source.

`path_reset` with `reason: 'stuck'` is emitted from **exactly one site** in the entire library,
at the very end of the per-tick movement monitor (`index.js:631-634`):

```js
// check for futility
if (performance.now() - lastNodeTime > 3500) {
  // should never take this long to go to the next node
  resetPath('stuck')
}
```

`lastNodeTime` is reset whenever the bot reaches the next node in the path. `3500` is a hardcoded
literal — **not configurable**. `resetPath` discards the path and replans, and only emits at all
if `path.length > 0` (`index.js:124`).

So `reason: 'stuck'` means precisely one thing: **"this bot failed to advance one path node within
3.5 seconds."** It is a watchdog, and the watchdog firing is the library *working*.

Three consequences the lab should internalise:

- **86% is the wrong number to look at.** It is a ratio between the watchdog and the other reset
  reasons (block updates, goal changes). A high share means the watchdog dominates — which it will
  whenever anything at all is wrong with movement execution.
- **The absolute rate is the alarming number, and it reconciles almost exactly with continuous
  failure.** At 14,800/hr over ~40 bots that is ~370/bot/hr, one per **~9.7 seconds**. The
  theoretical floor for one stuck→replan cycle is 3.5s (futility) plus a replan bounded by
  `bot.pathfinder.thinkTimeout`, which `bots/src/index.mjs:463` sets to 5000ms — so **~8.5s worst
  case**. The observed 9.7s is ~88% of the maximum achievable rate. **The bots are not
  occasionally stuck. They are stuck close to continuously.**
- **Fixing PR #365 would make the metric worse while making behaviour better.** ~12 `return`
  statements occur earlier in that same tick function (block-placing, block-breaking,
  lock-acquisition failures, `moveToEdge` failure), each skipping the futility check entirely.
  Those are currently *uncounted* stalls. Counting them raises the number.

ChatGPT reached this independently and stated it more sharply than I had: *"If the futility check
were never reached, `path_reset("stuck")` would be near zero, even if bots were visibly stuck
forever. Therefore, '86% of resets are stuck' does not prove the futility check bug is causing the
resets."*

**Recommendation: stop treating `path_reset:stuck` share as the KPI.** It is a denominator artifact.
The defensible KPI is *stuck resets per bot-hour of active pathing*, plus the `path_update.status`
distribution (`success` / `partial` / `timeout` / `noPath`), which `lib/astar.js` already produces
and which is currently, as far as I can tell, not being broken out.

---

## 2. The finding that reframes the problem: Paper 1.21.11

### The bug

[**PrismarineJS/mineflayer issue #3911**](https://github.com/PrismarineJS/mineflayer/issues/3911) —
*"Mineflayer 1.21.11 Pathfinding bug"*, opened **2026-05-26**, **still open**.

The reporter's description, verbatim:

> *"this only happens on native 1.21.11 servers and on 1.21.8 this did not happen. the bot would
> run next to a block attempt to jump and get suck around 0.2 in the air glued to the block.
> sometimes completely ignoring knockback as well."*

and, critically for this investigation:

> *"ive used different path finding forks and such to no avail with multiple different
> environments."*

Their test matrix: Paper 1.21.11 and vanilla 1.21.11, both offline and online mode. A bot glued to
a block cannot reach the next path node, trips the 3.5s futility timer, and emits
`path_reset('stuck')`. **This is the observed symptom, exactly, and it is version-gated to the
version the fleet runs.**

Three independent commenters confirm a fix via the server command
`/attribute <bot> minecraft:scale base set 0.9999999`. One (`osyra42`) adds: *"I had issues with
my bot climbing up the terrain and pathfinding around walls. I also had issues with my bot getting
in and out of water... Your attribute scale apply has fixed all of that."* Another reports the same
on a 26.1.2 server through ViaVersion with a 1.20.2 bot, suggesting the trigger is broader than one
version pair.

### Independent corroboration

This is not one anecdote. Four other reports, all open, all verified via the GitHub API:

- **[mineflayer #3913](https://github.com/PrismarineJS/mineflayer/issues/3913)** (2026-05-28) —
  reproduces on **latest master of *both* mineflayer (`03eba44`) and mineflayer-pathfinder
  (`d1f4d7f`)**, Paper 1.21.11. Three symptoms: *"Bot can't step up a single block... Bot can't swim
  out of water... Bot gets stuck against walls constantly. Walks into a solid block and stops dead
  instead of routing around. Sometimes recovers after a long timeout, sometimes never."*
  **This kills "upgrade the library" as a remedy.** Critically, it also records: *"Setting
  `movements.allowSprinting = false`, `allowParkour = false`, `allow1by1towers = false` — no
  improvement."*
- **[pathfinder #366](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/366)**
  (2026-07-05) — *"the bot get stuck behind every 1-block obstacle, walking into it instead of
  jumping"*, with an explicit version matrix: `26.2 → does not work`, `1.21.11 → does not work`,
  `1.21.10 → does not work`, **`1.21.8 → follow works`**.
- **[mindcraft #801](https://github.com/mindcraft-bots/mindcraft/issues/801)** (2026-07-10, closed as
  completed) — **"Server (Broken): Paper 1.21.11-132 (online-mode=false)"**, versus
  **"Server (Working): 1.21.11 singleplayer opened to LAN."** The lab runs Paper **1.21.11 build
  132** (`docs/ops/world-setup.md:3`) in **offline mode** (`infra/homepage/services.yaml:4`). This is
  a build-for-build, mode-for-mode match. The issue was closed by pointing at #3911 and the scale
  workaround; the reporter replied *"ok thanks."*
- **[mineflayer #3915](https://github.com/PrismarineJS/mineflayer/issues/3915)** (2026-06-04) —
  "Knockback and pathfinding issue", the same cluster.

The LAN-versus-Paper split in mindcraft #801 is the most informative single data point in the whole
report: it localises the fault to **server-side movement validation**, not to the planner, not to
terrain, and not to the lab's configuration.

(Two further issues — [mineflayer #3941](https://github.com/PrismarineJS/mineflayer/issues/3941) and
[pathfinder #367](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/367) — are also
1.21.11 movement failures but are specific to **BungeeCord transfers** and chunk-loading. They are
probably a *different* bug and should not be counted as corroboration.)

### The client-side fix

[PR #364](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/364) proposes the client-side
equivalent. The functional core is 9 lines at the top of `monitorMovement()`:

```js
if (bot.physics && bot.physics.playerHalfWidth === 0.3) {
  bot.physics.playerHalfWidth = 0.30001
  bot.physics.playerHeight = 1.80001
}
```

Its stated root cause: *"when the client's hitbox dimensions (`playerHalfWidth = 0.3`) align
exactly with a block edge, the server calculates an exact '1.0' boundary and incorrectly rejects
the movement, causing the bot to freeze."*

**Verified against the lab's own installed tree:** `prismarine-physics@1.11.1`
(`bots/node_modules/prismarine-physics/index.js:76-77`) defines `playerHalfWidth: 0.3` and
`playerHeight: 1.8` as plain mutable properties of the physics settings object, used only at
lines 114-121 to construct the player AABB. `mineflayer/lib/plugins/physics.js:205` assigns
`bot.physics = physics` — that same object.

**Therefore the lab does not need to fork, patch, or vendor anything.** Two lines in their own
`bot.once('spawn')` handler in `bots/src/index.mjs` reproduce the entire fix. No `patch-package`,
no fork, no server mod, no world modification. It satisfies the hard constraint completely.

Do note the *rest* of PR #364 is junk — it renames the package to `notaina-pathfinder`, adds a
scratch `test_bot.js`, and deletes `.npmrc`. That is almost certainly why it has not been merged,
and it is a reason to take the 9 lines rather than the PR.

### The contradiction inside the repo

The repo already knows about this bug and believes it has mitigated it. `README.md:49-51`:

> **"Paper is pinned to 1.21.8, not 1.21.11**, because of an open mineflayer issue reporting
> pathfinding and jumping failures specifically on 1.21.11."

The same claim appears in `docs/HANDOFF-2026-08-07.md:43-44`. **But the fleet runs 1.21.11:**

| Location | Value |
|---|---|
| `bots/.env.example:8` | `MINECRAFT_VERSION=1.21.11` |
| `docs/COORDINATION.md:140` | "Paper 1.21.11 on `mcai`, pregenerated r=2000 world" |
| `docs/ops/world-setup.md:3` | "Server: Paper 1.21.11 build 132" |
| `docs/ops/services.md:32,40` | "Minecraft (Java 1.21.11)", "Paper 1.21.11, 6 G fixed heap" |
| `docs/decisions/ADR-0001-stack-selection.md:45` | **"Decision: pin Paper 1.21.11."** — "Unanimous across all three analyses" |
| `docs/lab-notebook/2026-08-21-overnight.md:38` | "a real Paper 1.21.11 server" |
| `infra/homepage/services.yaml:4` | "1.21.11 · offline-mode · border 1950" |

ADR-0001 (dated 2026-08-05) decided on 1.21.11 on protocol-ceiling grounds and recorded exactly one
accepted risk: EOL status. **The pathfinding regression is not mentioned in the ADR at all.** The
README's contrary claim appears to be stale text from the pre-ADR handoff document that was never
reconciled. Only one file — `infra/homepage/config/services.yaml:11` — still says 1.21.8, and it
describes the map service, not the fleet.

`docs/PLAN-30-DAY.md:85` already schedules the right experiment — *"the version test. 1.21.8
versus 1.21.11, seed-paired and rotated"* — and `:407` states its purpose: *"was the movement
problem a library bug?"* **That experiment has not been run, and it is the one that matters.**

### One caution the lab's own memory raises

A prior finding recorded for instance #1 says *"native Paper 1.21.11 rejects bot movement 20x/sec;
the fix is server-side, not ours"*, and `docs/playbook/bare-client-repro.md:23` records that a bare
mineflayer bot reproduced it. ChatGPT's view, which I accept: the new evidence **partially**
overturns that. Server-side rejection and a client-side workaround are not mutually exclusive — the
workaround stops the client *proposing* boundary-exact positions the server would reject. But
"the server rejects movement" was an accurate observation, and it is possible these are two
distinct bugs. The falsification run below distinguishes them.

---

## 3. What practitioners actually do

Short version: **everyone builds an unstuck layer, nobody fixes the library, and this lab's
existing layer is already better than most of what is published.**

### The de-facto standard

GitHub code search (authenticated) finds **137 JavaScript and 70 TypeScript files** containing both
`"pathfinder.goto"` and `"Promise.race"` — including `teamcraft-bench/teamcraft`,
`JesseRWeigel/minecraft-agent-swarm`, `gigio1023/minecraft-llm-agent-community`, and
`yuniko-software/minecraft-mcp-server`. **Racing `goto` against a timeout is the norm, not a hack.**

The reason is structural. `lib/goto.js` resolves or rejects only on `goal_reached`, `path_update`,
`goal_updated` or `path_stop`. If none fires, the `await` hangs forever — and per PR #357, a
`noPath` result with an empty path **resolves as success while the bot never moved**. So a stuck
bot can surface as a hung promise, a *successful* `goto` that didn't move, or a rejection. Only the
last is visible without extra code.

**Every `goto` needs both a timeout race and a post-hoc distance assertion.** mindcraft does this;
`christopherthompson81/autobot` implements the PR #357 guard by hand, treating a `goal_reached`
event as a failure if the bot ended up further than `sqrt(goal.rangeSq)` away.

### Timeout values in the wild

| Source | Threshold | Purpose |
|---|---|---|
| pathfinder internal | **3500 ms** per node | `path_reset('stuck')` |
| `thinkTimeout` / `tickTimeout` | 5000 ms / 40 ms (defaults) | A* compute budgets |
| [mindcraft](https://github.com/mindcraft-bots/mindcraft) door interval | 1200 ms at <0.1 blocks | door/gate nudge |
| mindcraft `unstuck` mode | **20 s at <2 blocks** | `moveAway(5)` |
| [Voyager](https://github.com/MineDojo/Voyager) / [Odyssey](https://github.com/zju-vipa/Odyssey) | 100 ticks (~5 s) sampling; <1.5 blocks over ~25 s | `/tp` escape |
| `WuMin4/soulcraft-mcbot` | 7500 ms, retry at 4200 ms | goto race + nudge |
| `Laplash1/minecortex` | 15 s, 3 retries, 2 s backoff | goto race |
| `Satvik374/Minecraft-24-7-Bot` | 5 ticks at <0.025 blocks | step-wedge |
| issue [#142](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/142) snippet | 10 s at <1 block | skip goal |

Two clusters: a **fast twitch layer at 1-5 s** for physical wedges, and a **slow supervisory layer
at 15-30 s** for "abandon this goal." The lab's `STUCK_SECONDS=20` sits correctly in the slow tier;
it has no fast tier.

### Notable techniques worth stealing

- **`bot.world.unloadColumn(x, z)` to force a chunk re-send.** From autobot, whose escalation ladder
  is the best found: *back up one block → flatten surroundings → mark goal bad and go home*. It
  ships `bug_demonstrations/world_desync.js`, a standalone repro showing `bot.blockAt()` returning
  stale data after a server-side `/setblock`. **This is direct evidence that one class of "stuck" is
  client-side world desync, not physics** — the bot paths through a block that no longer exists in
  its cache. The lab's unstick ladder has no equivalent primitive.
- **Align before jumping.** soulcraft: *"Mineflayer's pathfinder normally does this in the same tick
  as it presses jump; doing it explicitly here prevents an unstuck jump from launching sideways
  while the body is still facing elsewhere."* `bot.look(yaw, 0, true)` first, then jump.
- **Preserve momentum across a reset.** `reliablePathfinder.js` keeps `forward`/`jump` toward the
  last valid node during the replan instead of standing still for another cycle.
- **Two-tier planning.** mindcraft plans non-destructively first (1000 ms budget, glass unbreakable,
  `placeCost 2`, `digCost 10`), then falls back to destructive movements. This is a strictly better
  design than the lab's hard `canDig = false`, because it preserves the "report a navigation
  failure" signal while still letting a genuinely-walled bot escape.
- **Leg-chunking for long trips.** `FundamentalLabs/minecraft-mcp` refuses goals >150 blocks,
  ray-casting 128 blocks toward the target and snapping Y to the surface. This is the standard
  mitigation for issue [#229](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/229).
  Maintainer IceTank's guidance there is worth quoting: *"If you use **setGoal instead of goto** the
  bot will path to the loaded chunk edge and recalculate the path when new chunks load."*
- **Voyager's answer is to cheat.** `bot.chat('/tp @s ...')` to a random adjacent air block. Requires
  op/creative and is not available to this lab under its constraint.

### Configuration traps confirmed in issue threads

- **Never set `allowSprinting = false` while `allowParkour = true`.** Issue
  [#227](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/227), filed by the maintainer:
  `getMoveParkourForward` emits 2-block-gap jumps the physics sim cannot execute without sprint. The
  lab is safe here (`allowParkour = false`).
- **`canOpenDoors` is documented as *"Unreliable and known to be buggy"*** and defaults off. mindcraft
  turns it on only via its patch; soulcraft leaves it off and handles doors externally with
  `activateBlock`, noting the door queue *"can leave an empty `placingBlock` after activation and
  crash in `monitorMovement`."*
- **Non-full-height blocks** (soul sand, farmland, slabs, snow, dirt path) caused a class of silent
  stuck because `Goal.isEnd()` takes only integer vectors — issues #205/#242/#278, fixed by PR #268
  merged 2022-05-30, so present in 2.4.5. Residual cases are mitigated with `GoalNearXZ` or a larger
  `GoalNear` range.

### The scale-specific mechanism — and why it does *not* apply here

Pathfinder runs A* **synchronously on the Node event loop**, inside `physicsTick`
(`index.js:166`), yielding only when `performance.now() - computeStartTime > tickTimeout`. The
README states it plainly: *"The generator will block the event loop until a path is found or
`options.tickTimeout` (default to 50ms) is reached."*

If many bots shared one Node process, their A* searches would serialise: 5 bots replanning at
`tickTimeout=40` burns 200 ms inside a 50 ms tick budget, the process misses physics ticks, position
packets stop flowing at 20 Hz, and the server sees stalled players — which then *causes* physical
stuck states and "kicked for floating too long." That is a genuine positive feedback loop, and it is
amplified by `chunkColumnLoad` → `resetPath('chunk_loaded')` and `blockUpdate` →
`resetPath('block_updated')`, both of which fire more often with more bots in more terrain.

**Verified not applicable to this lab.** `bots/src/index.mjs` calls `mineflayer.createBot` exactly
once and takes a single `BOT_NAME` from the environment (`bots/.env.example:15`) — **one bot per
process**. The event-loop contention path is closed by design. It remains worth watching at the
*host* level, since 40 processes plus 8 worlds share pve1, but that is CPU scheduling, not event-loop
serialisation.

### What the lab already has

Worth stating plainly so this report does not recommend existing code. `bots/src/reflex.mjs` already
implements: stuck detection gated on `runner.isBusy()` and `!bot.targetDigBlock` (avoiding the
false-positive that mindcraft had to special-case); a staged escape with a **tabu list** of failed
squares (`UNSTICK_MEMORY_MS`, `UNSTICK_TABU_MAX`); an **oscillation detector** that recognises
repeated unsticks from the same spot as failure rather than success; a `standableAt()` check that
tests **head** clearance, not just feet; and `canStartAPath()`, which validates escape success by
attempting a real short-range plan at `thinkTimeout = 800`.

The code comments show this was all driven by measurement (*"telemetry over 44 firings showed the
agent was in the same place afterwards 35 times: 80% ineffective"*; *"188 legal steps found, 106
FAILED"*). **This is more rigorous than anything found in the surveyed public projects.** The
absence of an obvious gap in the unstuck layer is itself evidence that the problem is upstream of
it — which points back to section 2.

---

## 4. Baritone

**Verdict: technically drivable headlessly, one working proof of concept exists, and it is still
the wrong substrate at 40 agents — because of a cost that cannot be engineered away.**

### Maintenance and API

[cabaletta/baritone](https://github.com/cabaletta/baritone): 9,128 stars, 2,022 forks, LGPL-3.0,
`pushed_at` **2026-08-11** (genuinely alive), 943 open issues, default branch `1.19.4`.

**But releases are stale.** Latest release is **v1.15.0, 2025-08-26** — ~12 months old. The README
download table spans MC 1.12.2 → 1.21.8. Branches exist for `1.21.10`, `1.21.11`, `26.1` and `26.2`
with commits as recent as 2026-08-11, but **no release jars have been cut for any of them**. Whether
those branches build and run against 1.21.11 is **UNVERIFIED** — and it matters, because the lab's
server is 1.21.11.

Baritone **does** expose a real programmatic API (`src/api/java/baritone/api/`): `BaritoneAPI`,
`IBaritone`, `Settings`, and a `process/` package (`ICustomGoalProcess`, `IMineProcess`,
`IBuilderProcess`, `IFollowProcess`, `IGetToBlockProcess`, …). Javadocs at
[baritone.leijurv.com](https://baritone.leijurv.com/). No chat parsing required:

```java
BaritoneAPI.getProvider().getPrimaryBaritone().getCustomGoalProcess()
  .setGoalAndPath(new GoalXZ(10000, 20000));
```

It is Forge/Fabric/NeoForge — all **client** loaders. **Stock Baritone needs no server-side mod**,
which does satisfy the constraint.

### Headless

Upstream refused it. [Issue #844 "Be able to run baritone headless"](https://github.com/cabaletta/baritone/issues/844)
was opened 2019-08-24 and **closed 2020-04-22 as `wontfix`**. Maintainer 5HT2: *"Baritone's
original intent was to pathfind Minecraft, not to mass botnet Minecraft servers :p ... it would be
too much work to implement."* There is no `xvfb` or `headless` reference anywhere in the repo.

The GL-context problem is solved *outside* Baritone, by
[headlesshq/headlessmc](https://github.com/headlesshq/headlessmc) (387 stars, MIT, latest release
2.10.0 on 2026-07-13, actively maintained), which patches LWJGL so *"every of its functions is
rewritten to do nothing, or to return stub values."*

A complete working stack exists: [**nothub/headlessbot**](https://github.com/nothub/headlessbot) —
HeadlessMc + Baritone + Fabric, MC 1.21.5, driven entirely from code, Prometheus-instrumented, and
its `scripts/server.sh` downloads **stock PaperMC**, confirming no server mod. It is **archived**
(`archived: true` via API, last push 2026-04-24) and runs **one Docker container per bot** using
`getPrimaryBaritone()` only — a single-agent demo.

### Why it does not scale here

`IBaritoneProvider` does expose `getAllBaritones()` and `createBaritone(Minecraft)`, so multi-agent
is *in the interface*. But **the unit of multiplicity is a `net.minecraft.client.Minecraft`
object** — N Baritones means N full Minecraft clients. Running several in one JVM has been attempted
and failed: [PR #244 "Bot System"](https://github.com/cabaletta/baritone/pull/244) was opened
**2018-10-30 and is still open, never merged**; on its branch, maintainer 0-x-2-2 wrote in
[#553](https://github.com/cabaletta/baritone/issues/553): *"1. its dead 2. outdated ... 3. extremely
buggy ... 4. crashes"*. A request for a native swarm command
([#4403](https://github.com/cabaletta/baritone/issues/4403), 2024-06-26) has one comment and zero
maintainer engagement.

The closest thing to scale in the wild is [Meteor Swarm](https://meteorclient.com/faq/swarm), whose
own docs instruct you to open **another full Minecraft instance per worker**. No resource figures
published.

**The cost that cannot be engineered away:** HeadlessMc's README states *"HeadlessMc will not allow
you to play without having bought Minecraft! Accounts will always be validated."* At 40 agents that
is 40 purchased Minecraft accounts. The lab's server is **offline-mode**
(`infra/homepage/services.yaml:4`), which is exactly why mineflayer costs nothing per agent today.

**Per-agent RAM/CPU for a headless MC client: UNVERIFIED.** No credible published benchmark was
found. Do not be misled by the widely-repeated "~30 bots on a 2GB VPS" figure — that describes
[MCCTeam/Minecraft-Console-Client](https://github.com/MCCTeam/Minecraft-Console-Client), a
protocol-level C# client with no world model, no chunk storage and no physics. Structurally each
Baritone agent is a full vanilla client holding chunks and running world state; LWJGL stubbing
removes rendering, not the world model. Budget ~1-2 GB/agent and measure before believing it.

### Cairn's `fabric-client/` — investigated, and it argues *against* Baritone

The project is [VasilisDragon/cairn](https://github.com/VasilisDragon/cairn) (1 star, AGPL-3.0,
created 2026-05-25). ADR-0001 already characterised it correctly: *"Personal project; borrow ideas
only."*

The `fabric-client/` directory is real, but **GitHub code search for `baritone` scoped to that repo
returns zero results.** It does not embed Baritone. They wrote their own A* from scratch —
`GridAStar.java`, `VoxelAStar.java`, `ConstructiveVoxelAStar.java`, `Navigator.java`,
`PathFollower.java`, `RouteHeadingPlanner.java`. Its README describes *"grid A* pathfinding,
kinematics-aware following, walkability classification."*

It is also neither headless nor multi-agent. Its own README: *"A Fabric **client** mod that lets an
external Node 'brain' drive a real single-player Minecraft client"*, and *"The mod releases inputs
and refuses brain intent when not in integrated singleplayer."*

**Read that as a data point:** a team that built both a mineflayer agent and a Fabric client mod
chose to reimplement A* rather than embed Baritone, kept all scale work on the mineflayer side, and
confined the client mod to single-player, single-agent embodiment. (Caveat: 1 star, solo author,
three months old — a weak signal, not authority.)

---

## 5. Alternative approaches entirely

### Other mineflayer pathfinders — thin, and probably beside the point

| Package | Stars | Last real commit | npm downloads/wk | License |
|---|---|---|---|---|
| `mineflayer-pathfinder` | 307 | 2025-08-18 | **24,083** | MIT |
| [`@miner-org/mineflayer-baritone`](https://github.com/miner-org/mineflayer-baritone) | 41 | 2026-03-01 | **189** | ISC in package.json, **no LICENSE file in repo** |
| [`@nxg-org/mineflayer-pathfinder`](https://github.com/Minecraft-Pathfinding/minecraft-pathfinding) | 33 | 2025-12-22 | **13** | MIT |
| `mineflayer-movement` | 41 | 2023-04-18 | **28** | reactive steering, not a planner |
| `mineflayer-navigate` | 62 | **2020-10-31** | **30** | **dead** — everything since is dependabot |

Download counts verified via `api.npmjs.org` for the week of 2026-08-13. The ratio is **~127:1** and
**~1,850:1**. That is the whole story: these alternatives are not battle-tested, and their bugs are
undiscovered rather than absent. `@nxg-org/mineflayer-pathfinder` self-declares *"not meant to be
used in production."* `@miner-org/mineflayer-baritone` is the only live JS option and is a solo
project with a **license inconsistency that matters for a lab that publishes** (package.json says
ISC; the repo has no LICENSE file and the GitHub API reports `license: null`).

**More importantly, section 2 predicts none of them would help.** The reporter of mineflayer #3911
tried exactly this: *"ive used different path finding forks and such to no avail with multiple
different environments."*

### azalea (Rust) — the strongest genuine alternative

[azalea-rs/azalea](https://github.com/azalea-rs/azalea): 763 stars, 108 forks, **MIT**,
`pushed_at` 2026-07-23, ~305 commits in 12 months. Verified via `gh api`.

- Its pathfinder is explicitly *"partially based on Baritone"* and ships a `BARITONE_COMPAT` flag
  for differential debugging against it.
- **It is genuinely regression-tested** — `pathfinder/tests.rs` builds synthetic worlds and runs
  bots end-to-end through real physics asserting goal arrival. mineflayer-pathfinder's "Add more
  tests" issue has been open since 2020.
- Its changelog records fixing precisely the class of bug that plagues pathfinder: *"Shape offsets
  were implemented, so bots no longer get stuck on bamboo and dripstone."* (pathfinder issue #328,
  "Stuck in dripstone", open since 2023).
- **Swarm economics are excellent** and are the best argument for it: the
  [performance guide](https://azalea.rs/azalea/_docs/performance/index.html) states 20-40 MB for
  the first bot and, because world data is shared, *"usually up to 1mb extra per bot"*, supporting
  *"up to a few hundred bots."*
- **`azalea 0.15.1+mc1.21.11` exists** (2026-02-03) — an exact match for the fleet's server version.
- One process can span multiple servers via per-bot `JoinOpts.custom_socket_addr`, which fits the
  8-world topology.

Honest negatives, and they are serious:
- **Bus factor 1.** ~1,738 of ~1,850 commits are by `mat-1`; the README describes it as
  *"maintained primarily by one person as a hobby project."*
- **No block placement moves.** Verified: no place/scaffold/tower/bridge moves in the move set. It
  can mine through obstacles but cannot pillar up or bridge a gap. The lab currently relies on
  `allow1by1towers = true`, so this is a real capability regression.
- The ~1 MB/bot figure assumes a **shared** world. Bots on 8 different servers need separate chunk
  storage — budget closer to 20-40 MB per world.
- One MC version supported at a time.
- Its README's "several times faster than Baritone" claim was **added 2026-01-18 and has since been
  removed**. Treat the deletion as the author walking it back. **UNVERIFIED either way.**

Prior art for this exact use case: [simon-lehmann/emil](https://github.com/simon-lehmann/emil), an
LLM-driven Minecraft NPC on azalea using a three-layer stack (20 Hz reflexes / classical skills /
~1 s LLM deliberation) that keeps the model out of the fast path — architecturally the same shape as
this lab's reflex/skill/cognitive split. It independently documents azalea's missing placement move.
[ErrorNoWatcher](https://github.com/ErrorNoInternet/ErrorNoWatcher) adds Lua scripting and an MCP
bridge, so adopting azalea would not require rewriting the whole control plane in Rust.

### ZenithProxy (Java) — a real headless Baritone port

[rfresh2/ZenithProxy](https://github.com/rfresh2/ZenithProxy): 423 stars, **AGPL-3.0**, ~543 human
commits in 12 months. It is a genuine port of Baritone onto headless MCProtocolLib —
`Baritone.java`, `movement/`, `calc/`, `executor/`, `goals/`, `process/` — including a from-scratch
reimplementation of vanilla movement physics (`Bot.java`, ~1,815 lines) and the full move set
(traverse, diagonal, pillar, parkour, ascend, descend, fall). **It has a dedicated `1.21.11`
branch.**

This is the answer to "can you get Baritone quality without a Minecraft client?" — yes, someone did
it. Caveats: **AGPL-3.0 is viral** and this lab publishes; it is a proxy *application* you would
have to extract a library from; its pathfinder package is marked `@ApiStatus`; and development
happens on the `1.21.4` branch and merges forward, so `1.21.11` was last updated 2026-04-18 while
`26.2.0` is current — a ~4-month lag.

### Learned navigation policies — a dead end, for a non-obvious reason

The usual objection ("a GPU per bot") is **false**: VPT is 248M params, weights are shared across
agents, and 40 bots at 20 Hz is ~1-2 TFLOP/s — comfortably one 3090.

**The real blocker is architectural: these policies consume rendered RGB pixels as their only
input.** VPT: *"The environment observations are simply the raw pixels."* MineRL and MineDojo launch
their own patched Minecraft (1.16.5 and 1.11.2 respectively) and **cannot attach to a Paper 1.21
server at all.** 40 agents would mean 40 full Minecraft clients at 2-4 GB heap each (80-160 GB RAM)
rendering ~800 frames/sec; MineRL's own docs warn that xvfb *"will slow it down by 2-3x as the
rendering is done on CPU"*, putting a single bot at ~15-22 FPS against a 20 Hz requirement.

GitHub search for any mineflayer↔VPT/MineRL bridge returns **zero repositories**. MineDojo's last
code change was 2023-04-25; MineRL is frozen with 241 open issues. No distilled Minecraft navigation
checkpoint exists.

And the decisive point: **a learned policy emits actions at 20 Hz too, so it would hit the identical
server-side movement rejection described in section 2.** It does not route around the actual bug.

### Academic work — nobody has published a baseline

**No paper quantifies mineflayer-pathfinder's failure rate.** Notably,
**[Voyager (arXiv:2305.16291)](https://arxiv.org/abs/2305.16291) contains no navigation failure
analysis at all** — its Limitations section covers Cost, Inaccuracies and Hallucinations only. The
paper that popularised this entire stack never measured its locomotion.

Two datapoints exist and point in opposite directions:
- **HAS ([arXiv:2403.08282](https://arxiv.org/abs/2403.08282), Table 1):** Voyager on pure
  navigation tasks fails 79% / 59% / 33% (image / object / audio goal), ≥30 tests per task. But
  these blend target *selection* with locomotion — treat as an upper bound.
- **MineNPC-Task ([arXiv:2601.05215](https://arxiv.org/abs/2601.05215), §6.3):** of 71 failures,
  *"Navigational failures (n=5)"* — the **smallest** category, 7%, attributed to ambiguous spatial
  targets rather than broken locomotion.

Reading: navigation dominates when the task *is* navigation, and is nearly irrelevant for
craft/gather with well-specified targets. That is directly relevant to this lab's 10% gather ceiling.

**[LoopNav (arXiv:2505.22976)](https://arxiv.org/abs/2505.22976) §A.3** is the only peer-reviewed
critique of mineflayer-pathfinder found: they had to patch *"sharp turns and other non-smooth
behaviors"* by preventing movement along **1×1 block edges**. That geometric, block-edge mechanism
is strikingly consistent with the hitbox bug in section 2, and it is independent corroboration from
a different research group.

### Rolling your own — the graph search is the easy 15%

| Implementation | Search code | Movement execution + physics |
|---|---|---|
| mineflayer-pathfinder | 5.8 KB | 28.3 KB |
| mineflayer-baritone | ~22 KB | 45 KB (`executor.js` alone) |
| azalea | astar module | 107 KB (moves + execute + world) |
| ZenithProxy | `calc/` | `MovementHelper.java` 41 KB + `Bot.java` ~1,815 lines |

Execution outweighs search 5-10x everywhere. The hard part is block-level movement physics — jump
arcs, step-up, slabs and stairs, water entry/exit, ladders, fall damage — and **matching the
server's movement validation tick-for-tick**. Azalea and ZenithProxy both *simulate* physics;
mineflayer-pathfinder approximates it, which is precisely why a sub-pixel hitbox discrepancy breaks
it. **Rolling your own from scratch is not realistic**, but the prior art proves porting Baritone's
movement layer onto a protocol library is tractable — two teams have done it.

---

## 6. The options, ranked

Ranked by (a) likelihood of fixing the stuck problem, (b) engineering cost, (c) resource cost per
agent. Only options compatible with the hard constraint are ranked; disqualified ones are listed
below the table with reasons.

| # | Option | P(fixes stuck) | Eng. cost | Resource cost/agent | Constraint fit |
|---|---|---|---|---|---|
| **1** | **Client hitbox epsilon** — `bot.physics.playerHalfWidth = 0.30001` in the lab's own spawn handler | **High** — directly targets the mechanism matching the symptom, version, server build and mode | **~2 lines + a flag + an A/B run** | **Zero** | Perfect: client-side, no fork, no server mod, no world change, portable to any environment |
| **2** | **Version A/B: 1.21.8 vs 1.21.11** (already planned in `PLAN-30-DAY.md:85`) | Diagnostic, not a fix — but *decides* everything below | ~1 day, already designed | Zero | Good, though 1.21.8 as a permanent answer is a version pin, not a portable fix |
| **3** | **Vendor the 4 unmerged upstream PRs** (#357 false-success, #365 futility, #356 pillar, #369 heap) via `patch-package` | Low-moderate alone; **high value for observability** | ~1 day | Zero | Perfect |
| **4** | **Adopt mindcraft's patch set** (via PincerCraft) | Low, and **carries a specific regression risk** — see below | ~0.5 day | Zero | Perfect |
| **5** | **azalea (Rust)** `0.15.1+mc1.21.11` | Moderate-high — simulates physics rather than approximating it, Baritone-derived, regression-tested | **High** — Rust rewrite of the movement/skill layer | **Excellent**: 20-40 MB first bot, ~1 MB/bot shared-world | Good; MIT; but loses block placement |
| **6** | **ZenithProxy (Java)** — extract its Baritone port | Moderate-high | **Very high** — extract a library from an application | Moderate (JVM/bot) | **AGPL-3.0 is a publication risk** |
| **7** | **`@miner-org/mineflayer-baritone`** | **Low** — #3911 reporter tried forks "to no avail" | Low (near drop-in) | Zero | License inconsistency (ISC vs no LICENSE file) |

**Disqualified, with reasons:**

- **Switching to Cairn or PincerCraft as a *pathfinding* fix — non-starter.** Verified: PincerCraft's
  `patches/mineflayer-pathfinder+2.4.5.patch` is **byte-identical** to mindcraft's (`diff` reports no
  difference), and **neither touches the 3500 ms futility timer nor the hitbox**. Cairn is worse: it
  has **no `patches/` directory and no `patch-package` postinstall at all**, so it runs stock 2.4.5.
  The premise that "both pin ^2.4.5 so neither escapes" is correct in conclusion but understates the
  difference — they are not equivalent, and the lab's own `bots/` harness (verified: no `isInLava` in
  the installed `index.js`) is **unpatched stock 2.4.5**.
- **Baritone headless** — technically proven (`nothub/headlessbot` + HeadlessMc against stock Paper),
  but costs **one full Minecraft client and one purchased Minecraft account per agent**. The lab's
  server is offline-mode; 40 accounts is a cost that cannot be engineered away, and no release jar
  exists for 1.21.11.
- **Learned navigation policies** — pixel-input only, cannot attach to a Paper 1.21 server, and would
  hit the same 20 Hz server-side rejection anyway.
- **Rolling your own pathfinder** — the 85% that matters is movement physics, not graph search.
- **`/attribute <bot> minecraft:scale base set 0.9999999`** — works (three independent confirmations)
  but is a **server-side per-bot command requiring op**. Useful as a *lab control arm* to
  cross-validate option 1; not a deployable answer under "must work in any Minecraft environment."

### The specific regression risk in option 4

mindcraft's patch **tightens the node-arrival tolerance from `0.35` to `0.175`**
(`eval/pincercraft/patches/mineflayer-pathfinder+2.4.5.patch:71-72`):

```diff
-    if (Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1) {
+    if (Math.abs(dx) <= 0.175 && Math.abs(dz) <= 0.175 && Math.abs(dy) < 1) {
```

That is the test that resets `lastNodeTime`. **Halving it means the bot must get twice as close to
each node to stop the futility clock.** On a server that is already rejecting boundary-exact
movement, this should *increase* `path_reset:stuck` — a concrete, falsifiable prediction, and a
reason not to adopt the mindcraft patch set wholesale without measuring.

---

## 7. The experiment to run first

Both ChatGPT reviews and I converge on this, and the lab has already designed most of it
(`docs/PLAN-30-DAY.md:85`, `:407`). Run **one** seed-paired, rotated experiment with four arms:

| Arm | Change | Purpose |
|---|---|---|
| **A** | Baseline: 1.21.11, `playerHalfWidth = 0.3` | Control |
| **B** | 1.21.11, `playerHalfWidth = 0.30001`, `playerHeight = 1.80001` | The client-side hypothesis |
| **C** | 1.21.11 + `/attribute … scale 0.9999999` | Cross-validates B via the server-side route |
| **D** | **1.21.8**, `playerHalfWidth = 0.3` | The version control — the only arm that can prove version-gating |

Arm D is the one that cannot be skipped. It is the difference between "we found a workaround" and
"we know what the bug is."

**Instrument per path attempt, not just per reset:**

- `path_update.status` broken out — `success` / `partial` / `timeout` / `noPath`. This exists in
  `lib/astar.js` today and appears not to be recorded separately.
- `path_reset` reason **per goal**, plus resets-per-goal-attempt.
- Time since `lastNodeTime` at reset, and **which node index** the bot wedged on.
- At the moment of reset: bot position **fractional parts**, next-node block name, block in front,
  block below, headroom, `isInWater`, `onGround`.
- Consecutive ticks with controls asserted but accepted displacement < 0.01 — **this is the direct
  measurement of server-side movement rejection** and the single most diagnostic signal available.
- Count of neighbours pruned by `cost > 100` (requires a small instrumented `Movements` subclass).

**Decision rule (ChatGPT's, which I endorse):**

- **Confirmed** if arm B cuts `path_reset:stuck` per bot-hour by ≥80% vs A, **and** ≥80% of the
  eliminated resets were preceded by repeated attempted movement with near-zero accepted
  displacement while the AABB was at a block boundary.
- **Weakened** if the rate drops but the failures are not edge/contact localised.
- **Killed** if B does not materially reduce it, or if resets cluster away from block contacts —
  after chunk-load gaps, after goal changes, or in non-collision states.
- Arm D matching B is strong confirmation. **Arm D matching A would falsify the whole hypothesis**
  and send the investigation back to the cost model.

**Do not ship arm B silently.** Put it behind a config flag, record it in `code.config_hash`
alongside every event (the telemetry already carries this per `docs/COORDINATION.md`), and treat it
as a declared experimental treatment. Changing the embodiment of a research fleet mid-programme
without declaring it would make Block 2 non-comparable with Block 1.

---

## 8. Where ChatGPT and I disagreed

Two independent `codex exec` reviews (`gpt-5.5`): the first briefed with evidence but **not** my
conclusion; the second explicitly instructed to destroy my conclusion.

**Agreed, unprompted and independently:**
- That `path_reset:stuck` is a watchdog and the 86% share is a denominator artifact. ChatGPT put it
  more sharply than I had: *"If the futility check were never reached, `path_reset('stuck')` would be
  near zero, even if bots were visibly stuck forever."*
- That fixing PR #365 would **raise** the number while improving behaviour.
- That switching to a codebase pinning the same version is *"mostly a non-starter."*
- That learned policies are *"a research project, not an operational remedy."*
- That the two-line client change is the highest-expected-value first move, and that azalea is
  *"worth prototyping, not betting the lab on immediately."*

**Disagreement 1 — how dangerous the lab's cost tuning is. I think ChatGPT overstated it.**

Round 1, without the 1.21.11 evidence, ChatGPT ranked *"movement-cost graph pruning from custom
penalties"* as the **most likely** root cause, calling the risk *"high"* and warning the water
penalties could *"create discontinuous reachability changes."*

I checked the arithmetic against the source and **the lab's own comments are correct**. Tracing
`getMoveForward` (`lib/movements.js:361-400`), a step into shallow water costs
`1 + exclusionStep(blockC) + safeOrBreak(blockB) + safeOrBreak(blockC)` = `1 + 25 + 0 + 25` = **51**;
deep water **76**; wet-to-deep-water **86**. All below the `cost > 100` cliff, exactly as
`bots/src/index.mjs` claims. The tuning is deliberate and the headroom calculation is right.

The evidence that settles it: mineflayer **#3913**'s reporter tried
`allowSprinting = false`, `allowParkour = false`, `allow1by1towers = false` and reports **"no
improvement"** — cost/movement tuning does not touch this failure mode.

**But ChatGPT identified a real fragility I had missed, and it stands.** `safeOrBreak` adds
`getNumEntitiesAt(...) * entityCost` on top of `exclusionStep`, and is called 2-4× per candidate
move. A wet move at 86 has only 14 points of headroom before the neighbour is **deleted from the
graph entirely** — not made expensive, deleted. A mob standing nearby, or any future second
exclusion function, silently disconnects water. That is worth a guard rail regardless of the outcome
of the experiment.

**Disagreement 2 — direction of the hitbox fix. ChatGPT corrected me, and it was right.**

I had loosely treated the client patch and the `/attribute scale` command as equivalent. ChatGPT:
*"The server command slightly shrinks the server-side hitbox. The client patch does the opposite
locally: it makes Mineflayer's simulated hitbox slightly wider, so the bot stops just before exact
block-boundary contact and avoids sending movement the server rejects. Both can dodge an
equality/rounding edge case, but they are not equivalent."* That is correct, and it is why arms B and
C in the experiment must both be run rather than treated as interchangeable.

**Disagreement 3 — how much of the 86% this explains. ChatGPT is more cautious, and I have moved
toward its position.**

Its strongest objection: *"`path_reset('stuck')` is a broad symptom, not a diagnosis... The GitHub
evidence supports 'there is a 1.21.11 hitbox/collision regression,' not 'the lab's 86% stuck rate is
dominated by it.'"* It also warned that shipping the epsilon could bias navigation near walls, water
exits, fences and ledges, *"corrupt[ing] published results if the paper claims vanilla Mineflayer,
vanilla player geometry, or compares against prior runs without declaring the intervention."*

I accept this. My rate arithmetic (~88% of the theoretical maximum) shows the failure is
*continuous*, which is a signature consistent with a systematic per-step rejection — but "consistent
with" is not "proven by." The report's claim is therefore: **leading hypothesis, strong enough to
test immediately, not strong enough to act on without arm D.**

**Disagreement 4 — the prior instance-#1 finding.** The lab's recorded conclusion was *"the fix is
server-side, not ours."* I initially read the new evidence as overturning it. ChatGPT's more careful
reading, which I adopt: it is **partially** overturned. Server-side rejection and a client-side
workaround are not mutually exclusive — the workaround stops the client *proposing* positions the
server would reject. The observation was accurate; only the conclusion that no client-side remedy
exists was wrong. It also remains possible these are two distinct bugs (the reports disagree on
whether the scale fix also repairs knockback), which arm D would help separate.

---

## 9. What I could not determine

- **Whether the hitbox hypothesis actually explains the lab's 86%.** Nobody has run the controlled
  comparison — not the lab, not upstream, not any published paper. This is the central open question
  and only arm D answers it.
- **The exact bot count behind "14,800/hour."** The ~370/bot/hour and ~9.7 s figures assume 40 bots
  (per the Block 2 build). If the real denominator differs, the "88% of theoretical maximum"
  arithmetic moves proportionally. **The conclusion is sensitive to this — verify it.**
- **The root cause of mineflayer #3911.** It is open, unfixed, and the mechanism is *asserted* by PR
  #364's author, not demonstrated. Three users confirm the workaround; nobody has explained it. One
  commenter's *"I have no idea why"* is the honest state of the art.
- **Whether the epsilon has side effects on combat, knockback, or block interaction.** Reporters on
  #3911 **actively disagree** about whether the scale fix repairs knockback. **UNVERIFIED.**
- **Per-agent RAM/CPU for a headless Minecraft client.** No credible published benchmark exists.
  (The widely-quoted "~30 bots on a 2 GB VPS" figure describes
  [MCCTeam/Minecraft-Console-Client](https://github.com/MCCTeam/Minecraft-Console-Client), a
  protocol-only C# client with no world model or physics — **not transferable**.)
- **Whether Baritone's `1.21.11` / `26.x` branches build or run.** Source-only, no release jars.
- **Whether HeadlessMc's `-inmemory` mode supports multiple concurrent MC instances in one JVM.** The
  docs are silent; I would assume not.
- **Whether azalea's pathfinder is actually better in practice.** Its own "several times faster than
  Baritone" claim was added 2026-01-18 and subsequently **removed** from the README. No independent
  benchmark exists.
- **Whether `@nxg-org/mineflayer-pathfinder`'s claim of better-than-Baritone execution holds.** It is
  a self-claim on its own README, at 13 downloads/week.
- **Whether server TPS causally drives stuck rate.** The event-loop contention chain is code-verified
  but does not apply here (one bot per process). The TPS→stuck chain is plausible but **unmeasured** —
  no issue or thread anywhere measures it.

---

## 10. Bottom line

**"Nobody has solved this" is true of the general problem and false of this lab's specific problem.**

Nobody has built a reliable, maintained, multi-agent Minecraft navigation stack in JavaScript.
mineflayer-pathfinder is functionally frozen with the fixes sitting in unmerged PRs; the JS
alternatives have 1/127th the users; Baritone costs a client and a paid account per agent; learned
policies cannot even connect to the server. Two projects (azalea, ZenithProxy) have done the hard
work of simulating movement physics properly, and both carry real adoption costs. That is the
honest state of the art.

But the fleet's specific 14,800/hour is very likely **not** the general problem. It is very likely a
**version-gated regression on Paper 1.21.11**, reported independently at least four times since May
2026 ([mineflayer #3911](https://github.com/PrismarineJS/mineflayer/issues/3911),
[#3913](https://github.com/PrismarineJS/mineflayer/issues/3913),
[#3915](https://github.com/PrismarineJS/mineflayer/issues/3915);
[pathfinder #366](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/366);
[mindcraft #801](https://github.com/mindcraft-bots/mindcraft/issues/801)), reproducing on
the **same Paper build 132 in the same offline mode** the lab runs, absent on 1.21.8, absent on LAN
singleplayer, **unfixed by upgrading to latest master of both libraries**, and unfixed by movement
tuning — with a two-line client-side workaround that costs nothing and satisfies the constraint
completely.

The repo already decided to avoid this exact bug by pinning 1.21.8, and then shipped 1.21.11 anyway.
The version test that would have caught it is already written into the 30-day plan and has not been
run.

**Run arms A/B/C/D before spending anything on migration.** If arm D comes back matching arm A, this
report's central hypothesis is dead and azalea becomes the lead — but that is a one-day experiment
standing between the lab and a decision it would otherwise make on inference.

