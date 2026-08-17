# Block 1 (exp-001): The Baseline That Revealed a Memory-Control Failure Mode

**Window:** 2026-08-11 02:19:36 UTC → 2026-08-16 02:19:36 UTC (120h, closed on the
pre-registered boundary). **World:** fresh seed, depleted spawn, Paper 1.21.8.
**Code:** frozen at `9a3aaf8` + declared fixes (`e24495b` chat scoping, `a2744e`
digest), converged on both instances. **Fleet:** 10 bots, all role=gatherer.

**Arms (fixed, never rotated):**
- `shared`, 3 memory units of 2 bots each: hive-a (Hive01+Hive02),
  hive-b (Hive03+Gather01), hive-c (Gather02+Miner01)
- `isolated`, 4 units of 1: Scout01, Scout02, Solo01, Solo02

## Headline numbers (full window, from Elasticsearch)

|                          | shared (6 bots) | isolated (4 bots) | per-bot ratio |
|--------------------------|-----------------|-------------------|---------------|
| gathers succeeded        | 879 (147/bot)   | 140 (35/bot)      | **4.2× more** |
| deaths                   | 250 (42/bot)    | 53 (13/bot)       | 3.1× more     |
| rule contradictions      | 1,542 (257/bot) | 280 (70/bot)      | 3.7× more/bot |
| beliefs held at close    | 78 (26/pool)    | 37 (9/bot)        | —             |
| **contradictions per belief** | **19.8**   | **7.6**           | **2.6× more** |
| stranded events          | 160 (27/bot)    | 476 (119/bot)     | 4.5× less     |
| **time below y=45**      | **12%**         | **55%**           | **4.6× less** |
| LLM decisions            | 61,038          | 42,485            | —             |
| decisions executed       | 42%             | 46%               | —             |
| learned_avoid vetoes     | 29,424          | 15,974            | 1.2× more/bot |
| inherited-belief blocks  | 114             | 0 (by construction) | —           |
| operator interventions   | 4               | 1                 | arm-blind     |
| milestones completed     | 0               | 0                 | —             |

*(Counts re-pulled 2026-08-17 after a telemetry outage was found and
backfilled; the first pull on close night undercounted shared gathers by 23
and contradictions by 44. The outage was caused by rotating a shared
Elasticsearch credential without updating instance #1's own shipper.)*

## The confound that changes how this reads

**The isolated arm spent 55% of the block below y=45; the shared arm spent
12%.** Isolated bots were not merely less productive -- they were physically
trapped for most of the observation window, in terrain where the milestone's
target (surface wood) does not exist. A large share of the 4.2× productivity
ratio is therefore an ARTIFACT OF ENTRAPMENT, not a demonstration that shared
memory produces better decisions.

The interim period after Block 1 supports that reading. Once three
capability fixes landed -- rescue skills exempted from avoid-rules, a reflex
conflict resolved (an entombed check was cancelling the pillar-climb that
would have freed the bot), and prerequisites promoted into the task line --
all four trapped isolated bots reached the surface, and within an hour the
isolated arm was OUT-PRODUCING the shared arm (Solo01 alone: 15 successful
gathers, against 1 for the entire shared arm). One hour is not a result, but
it is strong evidence that the Block 1 gap measured mobility, not memory.

**Contradictions per belief is the honest version of "wrong faster."** Per
bot, shared looks 3.7× more error-prone; but shared pools also HELD more
beliefs (78 vs 37), so part of that ratio is belief volume rather than belief
quality. Normalised per belief, each shared belief was contradicted 2.6× as
often as each isolated one. That is a smaller claim and a better-supported
one: beliefs that propagate without being personally tested are individually
less reliable, which is the mechanism the experiment was built to detect.
The 114 inherited-belief blocks -- decisions vetoed by a rule the acting bot
never tested, structurally impossible in the isolated arm -- remain the
cleanest single piece of evidence for that mechanism.

**What survives the confound:** shared memory propagated beliefs faster, and
those beliefs were individually less reliable (2.6× the contradiction rate per
belief, plus 114 blocks from beliefs the acting bot never tested). What does
NOT survive unqualified is the productivity claim: the shared arm out-gathered
the isolated arm 4.2:1, but the isolated arm was underground 55% of the time,
and removing that entrapment reversed the ranking within an hour.

Every shared pool out-produced every isolated bot (worst pool hive-a at 173 vs
best isolated Scout02 at 82), but this comparison inherits the same mobility
confound and should not be read as a memory effect.

## What actually happened, day by day

1. **Day 1:** ~9 deaths/hour at the drowning-prone spawn water. Hives posted
   hazard warnings; the first-night signal was contradictions 4.3×/unit and
   vetoes 3.5×/bot in shared vs isolated — the "learns faster, wrong faster"
   silhouette visible within hours.
2. **Day 2:** the admission gate reached 58% veto fleet-wide. This became the
   block's defining condition: **the system learned avoidance faster than it
   learned recovery.** The forced-admission valve (every ~7th proposal passes
   whatever its record) is the only reason the veto metric stayed measurable
   rather than becoming a tombstone. Ruling (pre-registered): ride to the
   planned close; tripwire = non-forced admissions near zero for 2h+, never hit.
3. **Days 3–5:** saturated steady-state punctuated by rare recovery events —
   which turned out to be the block's most valuable observations (below).

## Case studies

- **Scout02 (isolated) — the machine works end-to-end.** belowGroundHint → LLM
  chose `surface` → dug/climbed 13 blocks to y=63 → evidence gate confirmed
  ("position: moved 19 blocks") → 15 gathers. The isolated arm was not dead; it
  was in a low-probability recovery regime. It later re-pinned at y=84 and never
  recovered again — recovery without shared knowledge did not compound.
- **hive-c — production is bursty and social.** Gather02 escaped its hole
  (via death-respawn, honestly attributed), then delivered +69/hour while
  pool-mate Miner01 delivered +55 and +111 hours; the pool produced in
  synchronized bursts, and its 395 gathers led all units. Its cost: serial
  drowning episodes (4 deaths/hour at worst) — the pool never learned water.
- **Gather01 (hive-b) — the mountain.** Pinned at y=94 for days, 20–39 failed
  gathers/hour, LLM re-proposing dirt-gathers indefinitely. The admission gate
  and the pathfinder disagreed about reachability and nothing could arbitrate.
- **114 inherited-belief blocks** — decisions vetoed by a rule the bot itself
  never tested (reporters ≠ self). This is the proposed mechanism for "wrong
  faster" observed directly, at decision granularity, hive-only by construction.

## Honest estimand and caveats

This measures **memory behavior under harsh-start depletion with
forced-admission pressure and arm-blind rescues** — not clean productivity.
Small N (3 pools vs 4 singletons, one world, one seed, one block). The
learned-helplessness bug (rescue skills accumulating avoid-rules) hit all arms
equally; hives pooled avoid-rules faster yet were LESS stuck, so the stuckness
asymmetry is treatment-driven, not bug-driven. Exposure gaps subtracted: one
3.1h power outage (Aug 14 22:20–01:30 UTC, all arms identically). 12 tagged
operator interventions in the log, 4:1 shared:isolated by arm. Deaths respawn
at the surface, so "death freed it" contaminates naive escape metrics —
attribution done per-event. Veto % includes cooldown/repeat_loop/bad_args;
learned_avoid alone is reported above. Forced admissions were NOT instrumented
this block (llm.admission ships with the Block 2 code) — forced-admit outcome
breakdown is unavailable for Block 1 and is claimed nowhere in this report.

## What Block 1 justifies for Block 2

1. **Rescue skills exempt from avoid-learning + purge of poisoned entries**
   (`phase1-learnability`): repairs broken agency; ships globally at this
   boundary. Block 1 vs Block 2 is NOT a causal comparison thereafter.
2. **Failure text as teacher** (climbAdvice recipes): the gate said "no" 44k
   times but never said what to do instead.
3. **The board arm**: hives amplify wrong beliefs instantly and isolated bots
   starve; a physically-mediated, quorum-gated channel is the interesting
   middle, now justified by measured endpoints on both extremes.
4. **llm.admission instrumentation** so forced-vs-normal admissions are never
   invisible again.

*Numbers pulled at close from mcai-skill-agents / mcai-llm-agents on instance
#1's cluster; collector queries in /tmp/block1.sh (to be committed under
scripts/). Case-study events carry `_operator_intervention`,
`_rule_contradicted`, `_stranded_*` markers and are re-derivable.*
