# Lab notebook — overnight run, 2026-08-21

**Mandate:** explore Step 00 (does Cairn/PincerCraft beat our runtime in OUR
world), de-risk the adapter design, and research the pathfinding blocker.
Failure is acceptable; undocumented failure is not.

**Method (standing):** every judgement and every data analysis goes through BOTH
Claude and ChatGPT independently, then reconciled. Search GitHub, papers, forums
before proposing to build.

**Rules for tonight**
- Do not touch Block 2 (pve1: worlds 201, bots 202, ELK 109). It is still soaking.
- Do not touch pve4 BIOS, cluster config, or corosync.
- Third-party code runs only in its own sandboxed VM.
- Never fabricate a number. "Unverified" is an acceptable result.
- Stop and write state if: cluster loses quorum, Block 2 shows distress, or
  foreign code escapes its VM.

**Resources**
| what | where | state at start |
|---|---|---|
| inference | ollama-3090 @ 10.0.0.16 | idle, 0% util, qwen2.5:7b-instruct resident |
| compute | pve4 @ 10.0.0.72 | 24 cpu, 120GB free, 5.4TB, idle |
| blocked | pve4 RTX 5080 | IVMD firmware block, needs BIOS work in the morning |

---

## Entry format

Each entry: **what I tried → what I expected → what happened → what I learned →
what I did next.** Negative results are recorded with the same care as positive.

---
## Entry 1 — RCON observability spike

**Tried:** ChatGPT warned the observer design was threatened because "RCON alone
may not give clean high-frequency state." Tested it directly against a real
Paper 1.21.11 server with a bare mineflayer client connected.

**Expected:** based on that warning, that inventory/block state would be slow,
awkward, or need a Paper plugin.

**Happened:**

| query | latency | result |
|---|---|---|
| `list` | 5.1ms | works |
| `data get entity <p> Pos` | 11.2ms | `[-4.5d, 64.0d, -8.5d]` |
| `data get entity <p> Inventory` | 5.4ms | full NBT, correct after `give` |
| `data get entity <p> Health` | 4.5ms | `20.0f` |
| `data get entity <p> XpLevel` | 5.2ms | works |
| `data get block X Y Z` | 4.9ms | **"not a block entity"** — only works for chests/furnaces |
| `execute if block X Y Z <type>` | 8.9ms | works as a predicate |
| sustained inventory poll | **4.4ms mean** | **~230Hz sustainable** |

**Learned:** the warning was mostly wrong, with one real exception it correctly
anticipated in spirit.

- Inventory, position, health, XP, dimension: RCON is fast and complete. No
  plugin needed. 230Hz is ~200x more than the observer needs.
- **Block state is the genuine gap.** There is no "dump the block type at X,Y,Z"
  — `data get block` only returns block ENTITIES. You can only test a predicate
  with `execute if block`. So "which blocks changed" requires predicate-polling a
  known region, log parsing, or a plugin.

**Consequence for the design:** scoring that rests on INVENTORY deltas (gather,
crafting, tier progression) is fully served by RCON and needs nothing else. Only
block-change scoring (building, mining-in-place) needs more machinery. Since the
lab's primary metric is gather-active fraction, the observer can be built on RCON
alone and a plugin deferred until a task actually needs block deltas.

**Next:** connect Cairn against this world.

---
## Entry 2 — two findings from Cairn's source, useful even if we never adopt it

**Finding A: Cairn can run against local Ollama.** It looks DeepSeek-specific
(`deepseek.baseUrl`, `deepseek-v4-pro`), but the client is built as
`new OpenAI({ apiKey: key, baseURL: config.deepseek.baseUrl })` with
`baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'`. So it is an
OpenAI-compatible client with a rebrandable base URL — pointing it at
`http://10.0.0.16:11434/v1` should work with no code change. No API spend, and
the same model our fleet uses, which makes the comparison fair.

**Finding B — adopt this regardless of the Step 00 outcome.**
`scripts/check-pathfinder-writes.js` is a LINT RULE that scans `src/`, `test/`
and `scripts/` for any call matching:

    /\b(?:bot|this\.bot)\.pathfinder\.(setGoal|setMovements|stop)\s*\(/

and **fails the build unless it appears in exactly one file**,
`src/control/pathfinder.js`.

That is single-writer discipline over the pathfinder, enforced statically at zero
runtime cost. It is the same class of problem as our own
[[control-state-has-no-owner]] note — seize once, re-assert per tick, release
explicitly — but caught at lint time instead of debugged at 3am from telemetry.

**Why this matters to us specifically:** a large share of our control-arbitration
bugs were "two subsystems both writing movement." A grep-based CI check would
have made those impossible to commit. This is ~40 lines and copies directly.

**Learned:** reading a competitor's *build tooling* was more valuable than
reading its agent code. The tooling encodes the lessons they already paid for.

---
## Entry 3 — THE PAPER VERSION IS THE PATHFINDING BUG (n=1, replication pending)

**Tried:** a research agent found mineflayer #3911, mindcraft #801 and
pathfinder #366 reporting a movement regression specific to Paper 1.21.10/1.21.11,
with 1.21.8 working. mindcraft #801 names **Paper 1.21.11-132 offline-mode** —
byte-identical to this lab's build. The repo's own `README.md:49` already says
Paper should be pinned to 1.21.8 for this reason; the fleet runs 1.21.11.

Built a bare-client A/B: identical `mineflayer 4.37.1` + `mineflayer-pathfinder
2.4.5`, identical seed 31415926, identical server.properties, a 56-block
`GoalNear` walk, 180s, both servers on one host, **run in parallel** to control
for anything time-varying.

**Result:**

| | 1.21.11 (fleet build) | 1.21.8 (control) |
|---|---|---|
| arrived at target | **NO** | **yes, 15.1s** |
| net progress in 180s | **0.4 blocks** | 55.2 blocks |
| total distance moved | 24.3 (thrashing) | 70.9 |
| `path_reset` events | **59** | 16 |
| `goal_reached` | 0 | 1 |

**Learned:** this is not a degradation, it is total failure versus complete
success. The same client, same pathfinder version, same world — only the server
build differs. **The lab's dominant failure mode is the Paper version, not
mineflayer-pathfinder, not the agent architecture, and not their own code.**

Consequences if it replicates:
- Block 2's <10% gather ceiling has a candidate mechanical explanation.
- Cairn's `path.stuck` events on our 1.21.11 server (8 in ~2 min) are explained
  by the substrate, so **the Cairn evaluation so far is confounded and must be
  re-run on 1.21.8.**
- "Rebuild on a better base" is largely moot — the base was not the problem.
- Instance #1's 11.4 days and Block 2's soak both ran on a broken substrate.

**Honest caveat:** the specific mechanism reported in #3911 ("glued 0.2 in the
air") did NOT show strongly — fractional-Y samples were 0.6% on 1.21.11 vs 1.9%
on 1.21.8, i.e. the opposite direction and tiny. So we reproduced the *effect*
without confirming *that* mechanism. Do not cite #3911's explanation as ours.

**Next:** replicate n=4 per arm before believing it.

---
## Entry 4 — replication (n=13 runs) and the honest reading

**Method fix first:** the first replication attempt lost 6 of 8 runs to Paper's
`connection-throttle` (bots launched 2s apart from one IP get kicked). Set
`connection-throttle: -1` on BOTH servers equally and spaced launches 8s apart.
Recording this because a naive reading of that batch would have been "the test
is flaky."

**Pooled result, all runs, identical client (mineflayer 4.37.1 +
mineflayer-pathfinder 2.4.5), identical seed, 56-block GoalNear:**

| arm | n | arrived | net progress mean | net range | resets mean |
|---|---|---|---|---|---|
| Paper **1.21.11** (fleet build) | 6 | **0/6** | **1.3** / 56 blocks | 0.3–3.2 | 45.8 |
| Paper **1.21.8** (control) | 7 | **5/7** | **41.6** / 56 blocks | 7.5–55.3 | 22.6 |

**The reset count discriminates outcome in BOTH arms:**

| arm | outcome | n | resets mean |
|---|---|---|---|
| 1.21.11 | failed | 6 | 45.8 |
| 1.21.8 | arrived | 5 | **13.8** |
| 1.21.8 | failed | 2 | **44.5** |

**Learned — and this is the careful version:**

1. On the fleet's own build, a bare client with no agent logic at all made
   **1.3 blocks of net progress in two minutes, zero arrivals in six attempts.**
   This is not an agent-quality problem. Nothing built on this substrate could
   have worked.
2. **1.21.8 is not a cure.** It failed 2 of 7 runs — and when it failed, its
   reset signature (44.5) was indistinguishable from 1.21.11's (45.8). So there
   is a failure mode that 1.21.11 triggers *always* and 1.21.8 triggers
   *sometimes*. Downgrading buys much better odds, not correctness.
3. `path_reset` count is a usable observational discriminator: ~14 means moving,
   ~45 means stuck, in both versions. That is a better detector than the
   `reason:"stuck"` share, which the research agent showed is a denominator
   artifact of a hardcoded 3500ms watchdog.

**Consequences:**
- The Cairn evaluation run earlier tonight is **confounded** and must be re-run
  on 1.21.8. Its 8 `path.stuck` events in ~2 minutes are consistent with the
  substrate, not with Cairn.
- Block 2's <10% gather ceiling now has a strong candidate mechanical cause.
- The Step 00 question ("is a different codebase better?") was probably the
  wrong question. The substrate was broken underneath all candidates equally.

**Not established:** why. The #3911 "glued 0.2 in the air" mechanism did not
reproduce (fractional-Y was 0.6% on 1.21.11 vs 1.9% on 1.21.8). We reproduced the
effect without confirming the published explanation.

---
## Entry 5 — ChatGPT attacked the result and was right

Gave codex the raw numbers and asked it to challenge the interpretation. Its
verdict:

> Strong evidence of a real arm-level difference **in this harness**, but weak
> evidence that "Paper 1.21.11 causes the fleet failure" as a general causal
> claim… a high-value smoke test, not a clean isolation.

**Confounds it identified that I introduced:**

1. **Different start coordinates.** 1.21.11 spawned at (3.5, 67, 10.5), 1.21.8 at
   (10.5, 66, 10.5). A 7-block x offset and 1-block y offset is not trivial for
   pathfinding — different geometry, slopes, vegetation, chunk boundaries.
   The result could be "route A is harder than route B", not "version A is bad".
2. **Same seed does NOT guarantee same terrain across versions.** Worldgen,
   spawn selection and decoration can differ between 1.21.8 and 1.21.11.
3. **JVM heap differed** — 6G vs 4G max. Different GC behaviour.
4. **Both servers were live simultaneously** on one host. Interleaving controls
   for drift but not for CPU/IO/GC contention between the arms.
5. Offline-mode may be part of the interaction, not neutral — mindcraft #801
   names offline-mode specifically.

**On `path_reset` as a metric it drew a line I had blurred:** defensible as an
observational marker for "not making progress", NOT as a mechanism discriminator.
A reset can come from collision stuckness, chunk stalls, server corrections, bad
plans, unreachable goals, or simply moving slower than the watchdog.

**On the two 1.21.8 failures** it phrased the mechanism better than I did:

> 1.21.8 reduces exposure to, or improves recovery from, a reset-prone state.
> The underlying trigger may be terrain, chunking, spawn placement, movement
> validation, or pathfinder behaviour, with Paper version modulating the
> probability.

**On the prior corpus** — the sharpest point for the lab:

> Conclusions like "the agents rarely gather", "the planner fails to explore", or
> "LLM strategy is ineffective" would be **overclaimed if movement was externally
> suppressed**. Any metric coupled to travel, mining, reaching resources, or
> exploring new chunks is confounded.

It still salvages them, as: a record of behaviour under a degraded locomotion
substrate, a robustness stress test, and a **lower bound** — never an unbiased
estimate of agent capability.

**Acted on it.** Built the controlled design it specified:
- ONE world (the 1.21.8-generated world) **copied byte-for-byte to both servers**
- identical JVM flags on both (`-Xms3G -Xmx4G -XX:+UseG1GC`)
- **exactly one server running at a time**
- bot teleported by RCON to an **identical fixed start coordinate**
- identical fixed goal coordinates
- three start→goal pairs (diagonal, straight-z, straight-x)
- **randomized run order**

Result pending.

---
## Entry 6 — CONTROLLED MATRIX: the version is the active ingredient

Rebuilt the experiment to ChatGPT's specification. Every confound it named is
now removed:

- **one world**, a pristine copy restored before EVERY run (no state carryover)
- **identical JVM flags** on both (`-Xms3G -Xmx4G -XX:+UseG1GC`)
- **exactly one server process alive at a time** (no host contention)
- bot **RCON-teleported to an identical start**, verified in the output as
  `(10.5, 66, 10.5)` on all six runs
- **three different routes**, each run on both versions
- **randomized run order**

Two bugs were fixed to get here, both mine and both worth recording:
1. `ssh` inside a `while read` loop **consumes stdin** and ate 5 of 6 runs. Use
   `ssh -n`, or materialize the list into an array first.
2. The readiness check grepped `latest.log` for `Done (` — **which survives from
   the previous boot**, so it passed instantly and every bot connected before the
   server was listening (`ECONNREFUSED` × 6). Wait on the PORT, not a log.

### Result

| # | version | route | start (after tp) | arrived | net | resets |
|---|---|---|---|---|---|---|
| 1 | 1.21.8 | B | (10.5,66,10.5) | **10.5s** | 48.9 | **0** |
| 2 | 1.21.8 | A | (10.5,66,10.5) | **12.0s** | 55.1 | **0** |
| 3 | 1.21.11 | A | (10.5,66,10.5) | NO | 2.3 | 28 |
| 4 | 1.21.8 | C | (10.5,66,10.5) | **22.2s** | 47.9 | **3** |
| 5 | 1.21.11 | C | (10.5,66,10.5) | NO | 3.2 | 28 |
| 6 | 1.21.11 | B | (10.5,66,10.5) | NO | 4.2 | 27 |

|  | arrived | net mean | resets mean |
|---|---|---|---|
| **Paper 1.21.11** | **0/3** | **3.2** blocks | 27.7 |
| **Paper 1.21.8** | **3/3** | **50.6** blocks | **1.0** |

### Route is eliminated

| route | 1.21.11 | 1.21.8 |
|---|---|---|
| A | failed, net 2.3 | **ARRIVED**, net 55.1 |
| B | failed, net 4.2 | **ARRIVED**, net 48.9 |
| C | failed, net 3.2 | **ARRIVED**, net 47.9 |

Same start block, same world, same goals — 1.21.8 succeeded on **every** route,
1.21.11 failed on **every** route. "Route A is harder than route B" is dead as an
explanation.

**Learned:** with all confounds controlled the effect got LARGER, not smaller.
Resets went to 0–3 on 1.21.8 versus 27–28 on 1.21.11. In the earlier sloppy
design 1.21.8 sometimes failed; with a clean start block it never did. Some of
that earlier 1.21.8 failure was my own uncontrolled spawn placement, not the
server.

**Status: the Paper version is the active ingredient.** Not the route, not the
world, not the heap, not host contention, not the agent code, and not
mineflayer-pathfinder — the same client library succeeds and fails purely as a
function of which server it talks to.

**Still unknown:** the mechanism. #3911's "glued 0.2 in the air" did not
reproduce. That question is now worth someone's time; the *decision* is not
blocked on it.

---
## Entry 7 — Cairn on a working substrate, and a task-design failure of my own

Re-ran Cairn against **Paper 1.21.8** with the identical goal ("gather 10 oak
logs"), local Ollama `qwen2.5:7b-instruct`, 12-minute window, graded from outside
by world state only.

| | Paper 1.21.11 | Paper 1.21.8 |
|---|---|---|
| distance travelled | ~0 (sat still) | **259.8 blocks** |
| active fraction | — | **79%** |
| `collect.target` | 12 | **78** |
| `collect.drop-pickup` | 4 | **36** |
| `skill.result` | 3 | 12 |
| log lines | 107 | 504 |
| `path.stuck` | 8 | 24 |
| **goal completed** | **no** | **no** |
| final inventory | — | **9 dirt** |

**The substrate difference reproduces at the agent level**: ~6.5x the collection
activity and 260 blocks of travel versus standing still. `path.stuck` rose in
absolute terms (8 → 24) but over ~5x more activity, so the rate fell.

**But neither run achieved the goal, and that is MY fault, not Cairn's.**
Probed an 845-point grid (96x96 blocks, 5 heights, 8-block spacing) around the
eval spawn for `#minecraft:logs`:

    log blocks found: 0

There are, apparently, **no trees near the eval world's spawn**. "Gather 10 oak
logs" was likely unachievable there for any agent. Cairn collected 9 dirt because
dirt was what existed.

This is precisely the lab's own historical failure — all-negative siting criteria
producing a town with zero trees within 288 blocks — reproduced by me, tonight,
in the very harness meant to avoid it. It is also exactly the trap ChatGPT named:

> If all agents score near zero on a task, the task is not a benchmark yet; it is
> just a failure mode.

**Learned:** a bakeoff needs a **calibration phase** before it can grade anything.
Verify the task is achievable at the start location — ideally by a human or a
scripted oracle — before any agent is judged on it. The observer should refuse to
score a task it cannot confirm is possible.

**Caveat on the probe:** 8-block spacing and 5 sampled heights is coarse and could
miss trees. 0/845 is strong but not proof. A proper check needs either a denser
scan, a plugin, or reading the region files.

**Status of Step 00:** still open. Cairn is now known to (a) run against local
Ollama with no code change, (b) move competently on 1.21.8, and (c) not have been
given a fair task yet. Its iron-tier claim is neither supported nor refuted here.

---
## Entry 8 — seed selection criteria, DECLARED BEFORE SCREENING

Seed 31415926's spawn had no logs in an 845-point probe. Moving to a new seed.
To keep this from being world-shopping, the criteria are written down here
BEFORE any seed is screened, and the procedure is: draw random seeds, screen in
order, **take the first that passes**. Not best-of-N. Not hand-picked.

**Criteria (all must hold, measured at the world spawn point):**
1. Spawn biome is NOT ocean, deep ocean, or river.
2. At least one `#minecraft:logs` block within a 64x64 block area centred on
   spawn — the tech tree's first input must actually exist within reach.
3. At least 8 distinct log blocks in that area, so it is a tree rather than a
   single decorative log.
4. Solid ground at spawn (spawn y is not underwater).

**What these criteria deliberately do NOT do:** they do not select for flat
terrain, low relief, absence of water, short travel distances, or any other
property that would make the *problem* easier. Terrain difficulty is untouched.
They only require that the first rung of the tech tree is present.

**The distinction being drawn:** making a task easier is forbidden by the owner's
standing constraint ("i do not want to change the world, thats a cheap cop out
fix"). Making a task *possible* is calibration. A world where oak_log does not
exist within reach is not a hard test of an agent — it is a broken one, and it
was already the failure that forced `wood_nearby()` into the siting code.

**Recorded risk:** the new seed means post-migration results differ from prior
Block 2 numbers on TWO axes at once (server version and seed). This is a fresh
start, not a continuation, and no before/after comparison should be drawn.

---
## Entry 9 — seed screening: three broken detectors before a working one

Screening took four attempts. Recording all of them, because the failure mode was
the same each time and it is the one the failure taxonomy exists to catch: **a
detector that returns zero everywhere is more likely broken than correct.**

**Attempt 1 — `say` doesn't return through RCON.** Probed 1,734 points per seed
with `execute if block <pos> #minecraft:logs run say L` and got 0 hits on all six
seeds. Six random Minecraft seeds with no trees is not plausible. Tested the
mechanism by `setblock`-ing a known oak log and asking the probe to find it — it
could not. `execute ... run say` writes to chat; RCON receives the command's
return value, which is empty.

**Attempt 1b — `setworldspawn` WRITES.** With no arguments it *sets* spawn to the
executor's position rather than reading it. So the probe was overwriting spawn and
then probing coordinates it had invented.

**Attempt 2 — a stale server held the port.** Fixed the detector
(`execute if block <pos> #minecraft:logs` → `Test passed`), re-ran, and got
*identical* output for all six seeds: same spawn, same 3 logs, same nearest log
at (-20,66,-36). A previous screener java process still held port 25598, so every
new server failed to bind and the probe kept talking to the first one. Added a
guard that kills anything on the port AND **asks the running server `seed` and
refuses to probe if it does not match the requested seed.**

**Attempt 3 — the loop never ran.** Seeds were passed from a local file that had
been consumed; `$@` was empty. Moved the seed list onto the remote host.

**Attempt 4 — changed the measurement entirely.** Rather than probe 8,125 blocks
per seed, use ONE command: `locate biome`. It reports the nearest matching biome
and its distance directly.

This immediately explained last night's mystery: on seed **31415926** the nearest
`minecraft:forest` is **273 blocks away**. My 96-block probe was never going to
find a tree. The world was not treeless — I was looking in too small a circle.

### Criterion, revised and re-declared BEFORE the screen ran

Replaced "at least 8 `#minecraft:logs` blocks in a 96x96 grid" with **"nearest
tree-bearing biome within 128 blocks of origin"** (forest, birch_forest,
dark_forest, taiga, old_growth_birch_forest, flower_forest, jungle). Same intent,
a measurement that actually works. The procedure is unchanged: draw at random,
screen in order, **take the first that passes**.

### Result

| seed | nearest tree biome | distance | verdict |
|---|---|---|---|
| **878725988** | forest | **90** | **PASS — TAKEN** |
| 1992116698 | flower_forest | 249 | fail |
| 1239381899 | forest | 71 | pass |
| 2133140653 | taiga | 0 | pass |
| 786787197 | taiga | 110 | pass |
| 2031861170 | flower_forest | 101 | pass |
| 1789521323 | forest | 0 | pass |
| 934688107 | forest | 0 | pass |

Six distinct distances across eight seeds confirms the seeds genuinely differed
(the check attempt 2 lacked).

**Seed 878725988 is taken because it is FIRST, not because it is best.** Three
later seeds spawn inside a forest at 0 blocks and would be more convenient. Taking
one of those would be exactly the world-shopping the declared procedure exists to
prevent, and the fact that better options were visible and refused is the whole
point of declaring the method in advance.

---
## Entry 10 — the pregeneration gap, and why "identical" took four attempts

**The gap.** The runbook requires pregenerating the operating radius in every
world, identically, BEFORE any bot connects — *"an arm that explores into fresh
chunks under load loses ticks an arm that does not explore never pays. That is an
arm effect made of terrain caching."* It is also **T-24** in the failure taxonomy
written the night before. I skipped it and started the fleet anyway.

Fifteen minutes of play produced a **47% spread** in generated terrain
(17 to 25 region files per arm), widening every minute.

**What it took to close.** Four attempts, and each failure taught the same thing:

1. **Pregen on top of divergence just freezes the inequality.** The worlds had to
   be wiped first, not patched.
2. **`--at` refused on all eight right after pregen** — "only 1/24 columns within
   80 blocks are tree". The chunks existed in memory but had not been written, so
   the tree probe read empty terrain. `save-all flush` plus a settle period fixed
   it. **The tool was right and my reading of it was wrong, twice.**
3. **Re-running the SEARCH on hive-a re-broke parity** — 12 region files and
   24MB against 4 files and 4MB elsewhere, because the search explores 16 rings
   and generates as it goes. The search is not parity-safe; only `--at` is. hive-a
   had to be wiped and rebuilt by coordinate like the others.
4. `forceload add` over a 288x288 area fails: **Minecraft caps a forceload at 256
   chunks.** 18x18 chunks = 324. The earlier 224x224 (196 chunks) worked.

**Final state, verified:**

| | value |
|---|---|
| towns | 8/8, all `home [355,73,147]`, one distinct pair |
| region files | **4 on every arm** |
| world size | 4464–4492 KB — within **0.6%** |
| bots | 40/40 in world, 5 per arm |

**Learned:** "identical" is not a thing you assert, it is a thing you measure
after every step. Three of my four attempts produced worlds I *believed* were
identical and were not, and the only reason I know is that I counted region files
each time instead of trusting the step that had just run.

---
## Entry 11 — Step 00: Cairn on a fair footing, and a measurable say-do gap

**Controls added** after the first attempt proved uninformative (Cairn spawned at
raw world spawn while Block 2 bots start on a sited town, so the comparison was
about starting terrain, not agents):

- eval world reseeded to **1239381899**, the same seed Block 2 now runs
- town area force-generated and flushed to disk
- `setworldspawn` moved to the town coordinates
- **stale playerdata deleted** (a returning player ignores a changed world spawn)
- bot **RCON-teleported to (355, 73, 147)** after join, before goal work

**What Cairn did** in ~7 minutes before the goal aborted:

| event | count |
|---|---|
| `collect.target` | 41 |
| `collect.tree.start` | 11 |
| `collect.tree.complete` | **8** |
| `collect.drop-pickup` | 14 |
| `collect.no-drop` | **13** |
| `path.stuck` | 11 |
| internal counter `sofar` | reached **8 of 10** |

**What the world says.** Ground truth by RCON at the anchors Cairn logged:

    ( 6, 86, -57)  NO LOGS - block was broken
    ( 6, 86, -56)  NO LOGS - block was broken
    (336, 69, 165) logs STILL PRESENT at y=[69,70]
    (326, 71, 133) logs STILL PRESENT at y=[71]
    (326, 78, 104) logs STILL PRESENT at y=[78]

    bot inventory: 3 dirt, ZERO oak logs
    dropped item entities in world: yes; dropped OAK LOGS: none

So of five logged anchors, **two were genuinely broken and three are still
standing**, while the internal counter advanced to 8 and the bot holds nothing.
`collect.drop-pickup` records the mechanism verbatim:
`{"ok":false,"reason":"no nearby dropped item entity"}`.

**How the run ended:** a `collect` skill timed out at 120s, Cairn replanned, and
the replan was refused —
`plan activation rejected: stale plan activation: falling changed true -> false`
— after which it declared `main.goal-failed` and stopped rather than replanning
again. A safety guard that terminates the goal instead of retrying.

**Learned.** This is exactly the say-do gap PincerCraft's `referee` exists to
measure, observed independently in a different codebase: **an agent's own
progress counter is not evidence.** Only the world is. Grading on `sofar` would
have scored this run 8/10; grading on inventory scores it 0/10.

**Do NOT over-read this.** n=1, ~7 minutes, one seed, one model
(`qwen2.5:7b-instruct`, far weaker than the `deepseek-v4-pro` Cairn is built
around). This is not yet evidence that Cairn is bad — it is evidence that the
harness can catch a self-report diverging from the world, which is the thing
Step 00 needed to prove it could do. Replication with a stronger model and
longer windows is required before any claim about Cairn.

---
## Entry 12 — smoke run started 2026-08-22T16:30Z

40/40 bots in world on Paper 1.21.8, seed 1239381899, 8/8 towns at
[355,73,147], terrain parity 4 region files per arm. Guards active
(fleet-doctor 5-min, fleet-recycle staggered). Endpoint: the declared
3090 at 10.0.0.16.

**This is the 2-4h SMOKE, not the shakedown.** Per the runbook it is an early
abort checkpoint so a failure at scale costs hours instead of two days. The
shakedown clock has NOT started.
