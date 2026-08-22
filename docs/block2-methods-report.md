# Block 2 — Methods Report

**Status: a failed runtime-competence run, and a valid methods run.**
**Written 2026-08-21. Covers the Block 2 build and shakedown period, 2026-08-16 → 2026-08-21.**

Block 2 never produced competent bots. The seven-day clock was never started.
The apparatus, the instrumentation and the pre-registration discipline are the
product, and they are what the next system inherits. This document records what
was actually run, how, and — most importantly — what this data does not support.

Companion documents:

- [`block2-failure-taxonomy.md`](block2-failure-taxonomy.md) — the detectors. This
  is the artifact with the most transferable value.
- [`block2-decision-record.md`](block2-decision-record.md) — what is settled, so it
  is not re-litigated.
- [`block2-preregistration.md`](block2-preregistration.md) — the locked design and
  its six dated amendments.

---

## 0. Provenance of every number in this document

**No figure here was recomputed from Elasticsearch for this report.** The cluster
at `10.0.0.186:9200` is reachable but returns `401 security_exception`; the
read-only credentials (`ES_USER`/`ES_PASS`) are correctly gitignored and not
present in the working tree. Every quantity below is quoted from the commit,
pre-registration amendment or analysis document that recorded it, and is
attributed inline. Where a claim could not be verified it is marked
**unverified** together with the query that would settle it.

To re-derive any of them:

```sh
export ES_URL=http://10.0.0.186:9200 ES_USER=mcai_ro ES_PASS=...
./scripts/shakedown-gate.py --block block2 --hours 24 --expect-bots 40
```

Before writing any query of your own, read the field-shape table at the top of
the failure taxonomy. Several natural-looking queries (`kind: path_reset`,
`skill.failClass`, `terms` on `skill.detail`, a `world` field) return zero
rather than an error, and the indices are `dynamic: strict`, so an undeclared
field rejects the whole document rather than dropping the field.

---

## 1. The design

### 1.1 The question

> Does a physically-mediated, quorum-gated shared memory (the bulletin board)
> capture shared memory's productivity gains while damping its false-belief
> amplification, relative to instant sharing (hive) and no sharing (isolated)?

### 1.2 The treatment, and where it lives in the code

The treatment is two environment variables emitted per bot by
`scripts/generate-roster.py`:

| variable | what it does |
|---|---|
| `MEMORY_SCOPE` | the arm: `shared` (hive), `board`, `isolated`, `checkpoint` (placebo) |
| `MEMORY_POOL` | **the experimental unit** — which memory store this bot reads and writes |

`placebo` is `checkpoint`: those bots make the same walk to the same lectern on
the same schedule and the board stores nothing. That is what separates "sharing
beliefs helped" from "walking to town helped".

### 1.3 The unit of analysis is the POOL, not the bot

This is the single most important design decision in Block 2 and it is the one
most likely to be lost in a rewrite.

Five bots sharing one memory are **five correlated samples of one thing**. Under
the original 4×5 design the three pooled arms produced exactly one observation
each per repetition, so any difference between arms and any difference caused by
terrain luck were the same number — no within-repetition variance estimate is
possible at n=1.

The 2026-08-18 amendment doubled the worlds:

| | original | as run |
|---|---|---|
| worlds | 4 | **8** (two per arm, same seed) |
| bots | 20 | **40** |
| hive / board / placebo | n=1 pool each | **n=2 pools each** |
| isolated | n=5 | **n=10** (each bot is its own pool) |

The two pools per arm require **separate worlds**. Two pools in one world would
compete for the same ore and fell the same trees, coupling their outcomes —
adding correlation rather than replication, which is the defect being fixed.

The asymmetry is real and must be stated whenever these arms are compared:
**hive, board and placebo have n=2 independent units; isolated has n=10.** Any
test that treats the 40 bots as 40 independent samples is wrong by a factor that
is not small.

### 1.4 Fixed material, declared in advance

| | value | where declared |
|---|---|---|
| seed | `31415926` (was `20260820`) | amendment 6, 2026-08-20 |
| difficulty | `peaceful`, all eight worlds | amendment 4, 2026-08-19 |
| worlds | 8 Paper, one host (`10.0.0.30`), identical dedicated cgroup envelopes | `provision-block2.sh` |
| bots | 40, one host (`10.0.0.31`), 768MB heap, 1G `MemoryMax`, identical | `bootstrap-block2-bots.sh` |
| inference | single endpoint, dedicated RTX 3090 at `10.0.0.16:11434`, no fallback | `generate-roster.py` |
| cadence | 30s decision cadence | pre-registration |
| town | one deterministic search, its result stamped into all eight worlds | `place-town.py` |

`difficulty=peaceful` is load-bearing and is stated everywhere the death
endpoints appear: on peaceful no hostile mob spawns, so **death count and death
cost mean "death by environment" only**, and Block 2 can say nothing about
survival under threat.

### 1.5 Endpoints, as pre-registered

- **Primary:** successful gathers per bot-hour of exposure.
- **Co-primary:** deposited items per bot-hour ("retained").
- **Secondary:** valid board uptake rate; false/stale belief rate per arm
  (contradictions per *consulted belief*, never per bot); death count and death
  cost, reported separately and never summed; deposit ratio.
- **Exploratory only, and labelled as such wherever they appear:** attention
  patterns, lexicon, macro formation, public works, aesthetics.

Exposure is published **both ways** — raw bot-hours and mobile bot-hours —
because if they disagree, the disagreement is the finding.

---

## 2. The pre-registration and its six amendments

The document was written 2026-08-16 and amended six times. Every amendment
carries the same legitimacy condition, stated in each: **made before any Block 2
data exists, which is the only condition under which this document may change.**
That condition held for all six — the seven-day clock never started.

| # | date | what changed | why |
|---|---|---|---|
| 1 | 2026-08-17 | model-sensitivity decision rule | a suggestible model may adopt peer beliefs uncritically, making the shared arm's contradiction rate partly a fact about the model; the rule and the model set were fixed before any data |
| 2 | 2026-08-18 | shakedown gate binds on **mobile** fraction, 2× ratio + 30% floor | the immobile form could not reject the case it was written for (below) |
| 3 | 2026-08-18 | town economy: torches cut, sleeping cut, deposits kept but gated | torches never placed once in the corpus; `sleep` 0/505; both mechanisms were treatment-mediated or dead |
| 4 | 2026-08-18 | two pools per arm, forty bots, eight worlds | the pool is the unit; n=1 per arm admits no variance estimate |
| 5 | 2026-08-19 | `difficulty=peaceful` declared | never written down; two secondary endpoints depend on it |
| 6 | 2026-08-20 | seven operational readiness gates + scored town siting | the mobility gate protects comparability and by construction cannot notice that every arm is equally broken |
| 7 | 2026-08-20 | seed `20260820` → `31415926` | there was nowhere on the old seed to put a town the fleet could cross |

(The list has seven rows because amendments 3 and 4 share a date; the
pre-registration numbers them as six dated amendment sections plus the
2026-08-17 model-sensitivity section.)

### 2.1 The amendment that matters most to a future experimenter

Amendment 2 is the methodological result of Block 2, independent of any bot
behaviour.

The gate originally read *"no arm's **immobile** fraction exceeds another's by
more than 2×"*. Building it as an executable check (`scripts/shakedown-gate.py`)
made it possible to run the rule against a block whose outcome was already known
— Block 1's `fixed-arms-01b`, already described as confounded by entrapment:

| slack (blocks) | immobile-fraction ratio | mobile-fraction ratio | worst arm mobile |
|---|---|---|---|
| 2 | 1.39× **PASS** | 2.38× FAIL | 16.9% |
| 4 | 1.36× **PASS** | 2.43× FAIL | 15.7% |
| 8 | 1.36× **PASS** | 3.06× FAIL | 11.3% |
| 16 | 1.31× **PASS** | 4.20× FAIL | 6.9% |

*(source: pre-registration amendment 2026-08-18)*

The immobile test passes the confounded block at **every** slack value tried.
That is structural, not bad luck: **a ratio of large fractions compresses toward
1 exactly when both arms are badly stuck**, which is the situation the gate
exists to catch. The mobile form is also the one whose denominator matches the
primary endpoint.

The threshold (2×) was deliberately **not** moved. "Moving a pre-registered
number because it fails to reject data one dislikes is how a gate becomes
decoration."

### 2.2 The three-verdict gate

`shakedown-gate.py` returns an exit code, not an opinion, because the judgement
gets made at midnight by someone who wants to start the block.

| exit | verdict | meaning |
|---|---|---|
| 0 | GO | mobility comparable *and* the apparatus is measuring something |
| 1 | NO-GO | a threshold failed |
| 2 | **INSUFFICIENT** | thin or lopsided corpus — a gate that passes because an arm shipped no telemetry is worse than no gate |

Two additional structural rules are enforced in code:

- **Arms must be disjoint.** `exp.arm` is stamped per document, so a bot
  reassigned mid-window contributes to two arms at once — observed on
  `interim-01`, where five bots straddled. The gate refuses rather than
  computing a ratio between overlapping sets.
- **Roster completeness is checked before any rate is computed**, because every
  rate is a ratio whose denominator is the fleet. A quietly short roster
  produces numbers that look like results.

---

## 3. The shakedown gate, as run

### 3.1 Comparability gate (amendment 2)

| parameter | value |
|---|---|
| window | 10 min |
| immobile if net move < | 4 blocks (`--slack`, printed on every run) |
| mobile-fraction ratio limit | 2.0× |
| minimum mobile fraction | 30% |
| minimum windows per arm | 500 |

Net displacement, not range: a bot that wanders and returns has achieved
nothing, which is the quantity of interest.

### 3.2 Viability gate (amendment 6)

These are **START/NO-START operational gates. They are not analysis endpoints
and must never be reported as results.** Their only job is to answer "is the
apparatus measuring anything at all".

| gate | threshold |
|---|---|
| fleet gather success | ≥ 20% |
| per-arm gather success | ≥ 10% |
| productive : path-failure | ≥ 0.5 |
| LLM p95 latency, per arm | ≤ 15s (p99 ≤ 25s) |
| decisions/bot-hour spread | ≤ 10% *(conditioned on endpoint strain — see §3.4)* |
| rescue paths with ≥100 firings and 0 successes | none, outside the declared observation set |
| deposits | ≥ 30 fleet-wide **and** ≥ 1 per arm, or retained-items is reported unmeasurable |

### 3.3 The observation set

A 0% success rate is a defect only for an event that reports on **an action it
performed**. An event reporting an **observation** — "no shore is reachable", "I
am stagnating", "I am asking for scaffold" — has no success available to it, and
gating on it would punish the telemetry for being truthful.

`shakedown-gate.py` therefore carries `TERMINAL_LABELS`, an explicit auditable
set. **Adding a label to it is a claim that must be justified in the
pre-registration; it is not a way to silence the gate.**

The discriminator is *not* "is the status hardcoded to failed". It is: **does
this event report on an action it performed?** Three labels initially read as
dead rescue paths; on inspection exactly one was a genuine defect
(`_livelock_escape`), one was correct reporting (`_drowning_no_shore` is a fact
about open water) and one was a request whose outcome lives in a different event
(`_prereq_adopted` → `_prereq_satisfied`).

### 3.4 One gate was deliberately loosened, and this is the reasoning

The decisions/bot-hour spread rule exists to catch a **capacity artifact**: hive
and board accumulate more memory, their prompts grow longer, and a saturated
endpoint then gives those arms fewer decisions for reasons having nothing to do
with what they remember.

But arms also differ because their bots **behave** differently. Measured in one
hour: hive 79.9 decisions/bot-hour against board's 57.4 — a 28% spread — while
p95 was 4.6s against a 30s cadence. The endpoint was nowhere near strained,
which makes **capacity an unlikely explanation** — it does not by itself prove
the spread is behavioural, since skill-duration mix, retry dynamics and client
stalls are all live alternatives, and none was ruled out. What follows from the
low p95 is narrower and sufficient: the spread cannot be *attributed* to
saturation, so failing the gate on it — or "fixing" it with an equal-slot
scheduler — would risk masking the very thing the block is measuring. The rule
now conditions on endpoint strain; below the saturation threshold the spread is
reported as a finding and carried into the analysis as a covariate rather than
being either ignored or corrected away.

*(source: commit `b2a9dee`)*

---

## 4. What was actually run

### 4.1 Chronology

| date | event |
|---|---|
| 2026-08-16 | Block 1 closed; pre-registration written |
| 2026-08-17 | entrapment analysis (2 independent reviews, then checked against the live cluster); model-sensitivity amendment |
| 2026-08-18 | mobile-fraction gate; town-economy amendment; forty-bot amendment |
| 2026-08-19 | `difficulty=peaceful` declared; capped-shaft and pickaxe reflex fixes |
| 2026-08-20 | eight worlds + forty bots stood up on seed `20260820`; readiness gates; five separate provisioning defects found by running it; seed changed to `31415926` |
| 2026-08-20 | 15-hour soak: fleet silently degraded 40 → 11; ArrayBuffer leak identified; `MemoryHigh` removed; `fleet-doctor.py` written |
| 2026-08-21 | close-out. **The seven-day clock has never started.** |

### 4.2 Measured behaviour during shakedown

All figures below are from the commit or amendment that recorded them. They are
**shakedown telemetry, not results**, and the arms were not comparable in any
window in which they were taken.

**One hour, 40 bots, seed `20260820`** *(amendment 6 / commit `fcb37fb`)*:

```
gather            19/805  = 2.4%      (viability gate needs 20% fleet, 10% per arm)
productive:path   1673:15175 = 0.11   (needs 0.5)
path events       15,175 in one hour, 86.2% reason=stuck
mobility gate     PASSED — spread 1.50x (limit 2.0x), worst arm 32.8% (floor 30%)
```

**24 hours, live fleet, 2026-08-20** *(amendment 6 / commit `83cfacc`)*:

```
MOBILE fraction   isolated=74.1%, shared=52.3%; spread 1.42x, floor 52.3%  -> PASS
gather            11.0% fleet-wide
productive:path   14,406 : 38,951 = 0.37
deposit           211 attempts, 0 successes
decisions/bot-hour 47.3% apart between arms
_prereq_adopted 479 -> _prereq_satisfied 22   (5% closure)
```

**The mobility gate passed both windows.** That is the finding, not a footnote:
comparability without viability passes eight equally-broken worlds.

### 4.3 The competence ceiling

Across nine verbs measured over 12 days and 10 bots on the Block 1 codebase
*(`docs/analysis-2026-08-17-entrapment-and-verbs.md`)*, `gather` ran at 11.3%
success over 31,024 calls, and `stranded`/`no_path` were the top failure of six
of nine verbs. Block 2's shakedown reproduced the same ceiling at 40 bots
(11.0% over 24h, 2.4% over the worst hour).

**In every window that was measured and recorded, Block 2's fleet-wide gather
success sat between 2.4% and 11.0%.** No window above that was recorded, and no
exhaustive sweep was run — the honest statement is "never observed above ~11%",
not "never exceeded 11%". Either way it is far below the pre-registered
viability floor of 20% fleet-wide: the primary endpoint had no dynamic range for
an effect to appear in, and the block was correctly never started. To close the
gap, run `shakedown-gate.py` over the full retained corpus rather than a 24-hour
window.

---

## 5. What this data does NOT support

This section exists so that no future reader has to reconstruct it.

**It does not support any claim about memory.** No arm comparison from Block 2
is admissible. The seven-day clock never started; the block ran only shakedown
windows, and for at least one entire soak the roster was silently short and
**arm-asymmetric** — two arms at 10 bots, two at 8 (taxonomy T-03). Every
between-arm number drawn from a window overlapping that soak compares arms of
different sizes. Windows outside it are not thereby rescued: they are shakedown
windows, excluded from analysis by pre-registered rule regardless of roster
health. **Establish which windows were affected before quoting any of them** —
`terms exp.arm` → `cardinality bot.name` per hour tells you exactly when the arms
were unequal.

**It does not support the prediction set.** None of the five pre-registered
predictions (hive > isolated; board between; board < hive on false belief;
placebo ≈ isolated minus a travel tax; isolated highest stranding) was tested.
They remain open and unmodified.

**It does not support "the bots cannot learn" or any cognitive claim.** The
*dominant* measured failure mode in Block 2 is mobility, not cognition: of
15,175 path events in one hour, 86.2% were the pathfinder's own stuck detector —
the bots were not failing to plan routes, they were failing to walk them. A
system that cannot reach what it finds cannot be observed to reason about what
it remembers.

**And it does not support the converse either — "the cognitive and learning
machinery was sound".** Not every Block 2 failure is mobility or infrastructure.
The admission gate's bootstrap exemption admitted 116 doomed `wooden_pickaxe`
crafts by bots holding no wood, collapsing crafting output from 37 successes in
69 bot-hours to 1 in 27 (taxonomy T-26); the prerequisite bus closed 22 of 479
requests (T-18). Those are decision-layer defects. Block 2 says the cognitive
layer was **never fairly tested**, which is different from saying it was fine.

**It does not support any figure computed over the 15-hour soak.** The fleet
degraded from 40 bots to 11 during that window while all forty systemd units
reported `active` with `NRestarts=0`. Every rate over that window has a
denominator that is wrong by an unknown, time-varying amount.

**It does not support any survival-under-threat or mob-death claim.** All eight
worlds ran `difficulty=peaceful`: no hostile mob spawns, hunger does not
deplete, health regenerates. Death endpoints mean **"death by environment"
only** — and even those are subject to the instrument defect in taxonomy T-17,
where a 30-second health poll reported 0 deaths across 8.5 hours while the
telemetry recorded nine. Environmental-death *instrumentation* claims are
available; environmental-death *rates* need the server-side `deathCount`
objective, not the poll.

**It does not support the deposit / retained-items co-primary.** 211 attempts, 0
successes in the 24-hour window; 8 successes in 823 calls over the preceding
twelve days. By pre-registered rule, retained-items is **unmeasurable** and
gathered-vs-retained accounting is descriptive only. This was declared in
advance, in code, precisely so it could not be argued after the fact.

**It does not support any comparison against the `mindcraft` baseline before
2026-08-19T21:12Z.** That baseline was created with `difficulty=normal` while
this fleet ran `peaceful`. The resulting head-to-head showed mindcraft dying 89
times to our 15, with 106 of its 110 deaths being mobs against zero mob deaths
in this fleet's entire recorded history — which was briefly read as evidence
that the reflex layer prevents mob deaths. It is not: there were no mobs.

**It does not support Block 1 → Block 2 causal comparison.** Code changed at the
boundary. This was pre-registered as a rule, and it still holds.

**It does not support any claim requiring a total event count.** No script in
this repo reads `hits.total`; all counts come from `size=0` aggregations and
`doc_count`, which are exact. If any narrative figure elsewhere was taken from a
raw `hits.total`, it is capped at 10,000 by default. **Unverified in this
repo** — no such read exists in `scripts/`. Verify with:
`grep -rn "hits'\]\['total'\]\|hits\"\]\[\"total\"" scripts/ bots/`, and set
`"track_total_hits": true` in any query that ever needs an exact total.

---

## 6. What this data DOES support

Only claims about the apparatus, and they are worth stating.

1. **A comparability gate is not a viability gate, and neither substitutes for
   the other.** Demonstrated, with numbers, on two independent windows.
2. **A pre-registered threshold expressed as an executable exit code survives
   contact with a tired operator; one expressed as prose does not.** The
   immobile-fraction rule was only shown to be structurally unable to reject its
   target case *because* it was implemented and run against a known-confounded
   block.
3. **Every self-reported health signal that was checked turned out to be wrong
   at least once — systemd's, the bot's own logs', filebeat's, the health
   script's, the death poller's — and the Minecraft server is the only layer in
   this stack that cannot report itself healthy while being broken.** This is
   the transferable finding; see the taxonomy for the detector each one needs.
4. **These amendments were defensible because the seven-day clock had not
   started, and because each one wrote down its reason.** That is the narrow
   claim the evidence carries. The broader principle — amend only while no data
   exists — is the rule this lab adopted, not something Block 2 demonstrated;
   what Block 2 shows is that following it kept a seed change (amendment 7) from
   being indistinguishable from a p-hack.

---

## 7. Statistical caveats that survive into any future block

- **n is 2, not 10, for three of four arms.** Do not compute a per-bot test.
- **One seed, one host, one model.** The result, when there is one, is properly
  stated as "the memory effect **under this model, on this terrain**".
- **Contradictions are reported per belief and per acted-upon belief, never per
  bot.** Shared bots generate more beliefs, so a per-bot ratio partly measures
  belief volume rather than belief quality.
- **Entrapment is a covariate, and exposure means mobile bot-hours.** Block 1
  inverted its own arm ranking during interim once trapped bots were freed;
  neither ratio measured memory, both measured mobility.
- **Minimum effect worth claiming on the primary endpoint: 1.5× between-arm
  ratio per bot-hour.** Board landing under 1.5× of isolated means the board's
  costs ate its benefits.
