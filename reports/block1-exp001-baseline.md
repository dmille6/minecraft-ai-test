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
| gathers succeeded        | 856 (143/bot)   | 140 (35/bot)      | **4.1× more** |
| deaths                   | 249 (41/bot)    | 53 (13/bot)       | **3.1× more** |
| rule contradictions      | 1,498 (250/bot) | 280 (70/bot)      | **3.6× more** |
| stranded events          | 157 (26/bot)    | 476 (119/bot)     | **4.5× less** |
| LLM decisions            | 59,834          | 41,642            | —             |
| decisions executed       | 42%             | 46%               | —             |
| learned_avoid vetoes     | 28,769          | 15,533            | 1.2× more/bot |
| inherited-belief blocks  | 114             | 0 (by construction) | —           |
| operator interventions   | 4               | 1                 | arm-blind     |
| milestones completed     | 0               | 0                 | —             |

**The thesis survived contact with the data: shared memory made the fleet learn
faster, be wrong faster, and freeze less.** 4.1× the production per bot, at the
cost of 3.1× the deaths and 3.6× the contradicted beliefs — while isolated bots
spent the block overwhelmingly stuck (4.5× the stranding events, and by day 3
all four were pinned motionless underground or on terrain features).

Every shared pool out-produced every isolated bot. Worst pool (hive-a, 173)
beat best isolated (Scout02, 82) by 2:1.

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
