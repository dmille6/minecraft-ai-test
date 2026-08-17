# Entrapment, verbs, and what to do before the new box

**2026-08-17.** Two independent analyses — Claude's (from Elasticsearch: 615K
skill events, ~200K LLM decisions, 12 days, 10 bots) and ChatGPT's (from the
source) — then every disputed claim checked against the live cluster.

---

## 1. The headline

**The bots are not confused. They cannot move.**

Every verb fails the same way. Sorted by share of that verb's failures:

| verb | calls | success | dominant failure |
|---|---:|---:|---|
| gather | 31,024 | 11.3% | nothing_found 27%, no_safe_target 24%, **no_path 18%, unreachable 15%** |
| goto | 28,554 | 10.9% | **stranded 41%, no_path 26%, path_interrupted 10%** |
| explore | 13,130 | 26.6% | **no_path 55%** |
| craft | 6,928 | 15.0% | missing_ingredients 90% |
| mine | 6,583 | 22.2% | already_below 50%, missing_tool 41% |
| surface | 6,375 | 3.4% | path_interrupted 31%, **stranded 20%** |
| home | 2,244 | 1.1% | **stranded 38%, no_path 27%** |
| deposit | 563 | 1.2% | **stranded 56%** |
| sleep | 150 | **0%** | stranded 40% |

`stranded` and `no_path` are the top failure of six of nine verbs. The
supporting event volume dwarfs the actions themselves: `_path_noPath` 119,582,
`_path_reset` 130,743, `_livelock_escape` 20,509 **at 0% success**, `_entombed`
14,216, `_entombed_unrecoverable` 3,196.

A verbatim `sleep` failure, which is the whole system in one line:

> no bed nearby; walking home to the town beds failed: pathfinder returned an
> empty path from 225,72,-232 — no route out of here even with digging
> allowed, 323 blocks short of 0,0

### Entrapment measured

Hourly buckets; immobile = moved under 8 blocks in an hour.

| bot | immobile | longest single stuck run |
|---|---:|---:|
| Hive03 | 87.8% | **131h (5.5 days)** |
| Hive02 | 59.8% | 107h |
| Solo02 | 54.3% | 86h |
| Gather01 | 41.0% | 70h |
| Scout01 | 38.0% | 93h |
| Scout02 | 31.5% | 52h |
| **Miner01** | **2.2%** | **2h** |

Miner01 is the control nobody designed. Same code, same model, same cadence,
same prompt — and a twentieth of the entrapment. Whatever differs is terrain
and path-dependency, not cognition.

---

## 2. The verb question, answered honestly

The request was for automatically created verbs. The data does not support
that as the first move, and it is worth being precise about why.

**The model already has 15 verbs and concentrates on six.** Proposal counts
from `tool_calls.skill` across ~200K decisions:

```
gather 72,262   explore 53,104   craft 26,675   goto 17,724
surface 12,137  mine 11,307      home 3,766     eat 1,110
deposit 778     status 488       sleep 218
place 79        withdraw 25      build 0
```

`build` was proposed **zero times**. `place` 79 times — 0.04% of decisions —
and when it did run it succeeded **38% of the time, the highest rate of any
verb in the system**.

Three things explain that, and none of them is a missing verb:

**(a) Two of the fifteen offered verbs are undocumented.** `SKILL_NAMES` is
`Object.keys(SKILLS)` minus chatOnly, so the schema enum and the prompt's
"Available skills" list both include `build` and `withdraw`. But
`prompt.mjs`'s usage block documents only 10 of the 15. The model is offered a
verb, told nothing about its arguments, and never picks it. `build` 0 calls and
`withdraw` 25 proposals / 13 executions / 0 successes are exactly that
signature. `place` is documented but with no statement of *purpose* — every
other verb has a parenthetical ("staircases down", "walks home to the town
chest"), and `place` has none.

**(b) The model states the right plan and cannot hold it for two steps.**
Mined from the free-text `reason` field, which is generated *before* the skill
choice, 732 decisions express place/build intent and 621 of them fall back to
`gather`. Verbatim:

> "gather dirt as it is needed for **pillar out** and is nearby."

The bot knows the Minecraft technique for escaping a hole. It gathers the dirt.
Then the next decision is independent, it re-reads the same state, and it
gathers dirt again. It never reaches the placement step. 384 more decisions say
"the agent is stuck and needs to find a way out" and land on `gather`/`surface`/`sleep`.

**(c) The measurement that would settle it is structurally blind.** The schema
pins `skill` to an enum which Ollama compiles into a GBNF grammar, so the model
is *grammatically incapable* of naming a verb that does not exist. Absence of
unknown verbs in the logs is a property of the grammar, not evidence about
demand. `reason` is the only channel where intent leaks, which is why it was
mined here.

**So the missing capability is not a name, it is a procedure** — the ability to
carry "get scaffold → climb → resume" across decisions. That is a planning
layer, not a vocabulary.

---

## 3. Where the two analyses disagreed, and who was right

Every disputed claim was checked against the live cluster rather than argued.

### ChatGPT was right, Claude was wrong (×2)

**The proposed skill IS logged.** `logger.mjs` writes
`tool_calls: [{skill, args, reason}]`, it is mapped in production, and
`tool_calls.skill` aggregates fine — the table in §2 came from it. Claude
asserted "nothing logs the proposed verb" and regexed `response.text`
unnecessarily. The residual point stands only weakly: a top-level
`proposal.skill` would be more ergonomic than a flattened array, but it is a
convenience, not a gap.

**"Cited rule → 0% success" is tautological.** Claude reported that decisions
citing a learned rule had 0% success across 66,698 records and read it as
memory being actively harmful. ChatGPT caught the error: `memory.cited_rule` is
written only inside the *rejection* branch of `logger.mjs`, so citation exists
only where the gate already blocked the action. The 0% is definitional.

The sound version of that point survives on different evidence:

| admission | decisions | success |
|---|---:|---:|
| normal | 17,965 | **7%** |
| forced (bypasses the veto) | 1,817 | **7%** |
| milestone_critical | 3,544 | 3% |

Forced admissions bypass `learned_avoid` and succeed at exactly the same rate
as normal ones. If the avoid rules identified genuinely bad actions, the ones
they blocked should do *worse* when forced through. They do not. **The veto
carries no measurable discriminative signal** — and cited rules have
accumulated up to 1,206 failures each, average 189.

### Claude was right, ChatGPT was wrong (×1)

ChatGPT's **number-one ruthless priority** was that the Elasticsearch mappings
lack `llm.admission`, `memory.*` and `exp.pool` under `dynamic: strict`, making
this "a Block 2-threatening measurement failure" where "new LLM documents will
be rejected."

Checked against both live clusters: **all four field groups are PRESENT and
populated.** The §3 admission table and the memory citation counts were queried
from those very fields. ChatGPT inferred production from a repo file without
checking the running system.

**But the finding was right about the defect and wrong about where it lived.**
`infra/elk/apply-mappings.sh` really had drifted — production was correct only
because the mappings were applied by hand during the ELK merge. The repo could
rebuild a cluster that silently drops precisely the fields Block 2
pre-registered on, and Wednesday's new host gets built from these scripts.
Fixed in `7f55ae2`, with `bots/test/mapping-drift.test.mjs` asserting
repo-against-repo that every field the logger emits is mapped (verified to fail
when a field is removed, so it is not passing vacuously).

### Where both agreed

- Entrapment, not memory, dominates the variance, and Block 2's productivity
  endpoint is a mobility measurement until that is controlled.
- Movement-rule asymmetry is the mechanism: `mine` digs down and `pillarOut`
  builds up under movement rules that ordinary navigation does not share, so a
  bot manufactures terrain its own pathfinder refuses to cross. ChatGPT
  localised this well (`skills.mjs:356-393`, `reflex.mjs:708-747`) and it is
  the best single explanation for Miner01.
- **Do not ship new verbs into Block 2.** The pre-registration forbids macros
  and invention in this block; adding them now makes it uninterpretable.

---

## 4. Recommendation

### Before Wednesday — instrumentation and cheap truth, no behaviour changes

1. **DONE — ELK mapping drift fixed + drift test** (`7f55ae2`).
2. **Filebeat credential drift.** `.187` ships with the rotated `mcai_ship`
   password; `.185` and `.186` still carry the pre-rotation one, so those two
   hosts' logs are not authenticating. Bot telemetry is unaffected (it comes
   from `.187`), but host-level data is dark.
3. **Document the five undocumented verbs** in `prompt.mjs`, and add a preflight
   assertion that every name in `SKILL_NAMES` has a usage line. This is a
   prompt change, so it must land *before* the block starts and be inside the
   frozen `CODE_VERSION`, or not at all.
4. **Make the shakedown gate an executable stop/go script**, not an analyst's
   promise: immobile fraction per arm, below-y exposure, mobile bot-hours, and
   indexed-document loss. The pre-registration's 2× rule needs a program.

### After Wednesday — the actual long-term answer

**Build a typed option layer, not an LLM code generator.** Both analyses
converged here independently, and it is the right call. An *option* has a name
and schema, preconditions over observable state, a controller composed of
existing primitives, a termination condition, a contract in the same evidence
dimensions as `SKILL_CONTRACTS`, and a version hash so learned judgements
invalidate when it changes.

The first options should be recovery and logistics, where the logs already show
demand: `escape_pit`, `surface_with_scaffold`, `get_prereq_then_retry`,
`return_and_deposit`. `escape_pit` is `gather dirt → place beneath → repeat
until y gained`, which is the exact sequence 732 decisions asked for and none
completed.

**Refuse, for now: Voyager-style LLM-authored executable skills.** A 7B model
at a 25s cadence is not a reliable code author, and arbitrary generated code
destroys cross-block comparability unless everything is frozen before a block
anyway — at which point the generation was offline and the option layer was the
useful part. Revisit only as offline synthesis of *options*, promoted through
microworld trap fixtures, never as online self-modification during a block.

**Macro induction from logs: build it as a proposer only.** Mine repeated
sequences that turn the same precondition into the same evidence-backed
postcondition, then require a candidate to beat the primitive baseline on fixed
trap fixtures before promotion. Do not promote on success *status* — that is
how no-op successes got in last time.

### On the model

Block 2 stays on **qwen2.5:7b-instruct** as pre-registered. Wednesday's box
removes the capacity reason for that choice (32b managed ~17 bots against
Block 2's 20), and the 32b's measured advantage is specifically at escaping
traps — 6/13 vs 0/13 from prose alone, and three times harder to fool with a
bogus prerequisite. But comparability with Block 1 is the stronger argument and
it does not change. **Bring the committed 32b replication forward** to run
directly after Block 2 rather than someday.

---

## 5. Gaps neither of us had noticed before this

- **No stuck-episode object.** There are many events — `_stagnation`,
  `_marooned`, `_entombed`, `_livelock_escape` — but nothing ties detection,
  attempted rescue, prerequisite adoption, recovery, death, or operator
  intervention into one durable unit with an id. Every entrapment number in
  this document had to be reconstructed from position histograms. Block 2's
  primary covariate deserves a first-class record.
- **False-belief harm is censored by construction.** `_rule_contradicted` can
  only fire when a suppressed action is eventually tried and succeeds. A false
  rule that successfully prevents every test of itself is maximally harmful and
  completely invisible. The measurable proxy is veto duration and opportunity
  cost, which nothing currently records.
- **Same seed is not same terrain once bots diverge.** The four worlds start
  identical and immediately stop being so. The shakedown mobility gate helps,
  but arm-level terrain diagnostics at t=0 — home elevation, water/canopy/cave
  density, routeability from home to chest/beds/board — would catch a bad draw
  before seven days are spent on it.
- **`sleep` has never once succeeded** (0/150). The beds were built recently
  and the skill has never worked; every failure is the walk home, not the bed.
- **`_livelock_escape` fires 20,509 times at 0% success.** A recovery mechanism
  that has never worked is worse than none, because it consumes the budget that
  would otherwise escalate.
