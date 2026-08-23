# Block 2 Pre-Registration — locked before first data

Written 2026-08-16, during the interim between Block 1's close and Block 2's
start. Nothing below changes after Block 2 begins. Analyses not listed here
are exploratory and will be labeled as such wherever they appear.

## Question

Does a physically-mediated, quorum-gated shared memory (the bulletin board)
capture shared memory's productivity gains while damping its false-belief
amplification, relative to instant sharing (hive) and no sharing (isolated)?

## Arms (four, same seed, separate worlds/servers)

1. **hive** — pool-shared memory, instant propagation (Block 1's `shared`)
2. **board** — beliefs move only via the town totem: posted in person,
   adopted on failClass-typed two-witness quorum, expiring per two-clock
   freshness (credit from observed_at, shelf-life from posted_at), TTLs sized
   for map-crossing travel; disproof marks `disputed`, board order is
   seeded-random; death knowledge arrives only if the respawned bot chooses
   to report (obituary-as-choice)
3. **isolated** — per-bot memory only (Block 1's `isolated`)
4. **placebo** — bots visit the same totem on the same schedule but the board
   stores nothing (controls for the travel/ritual cost of board visits)

Bots per arm: equal count, all role=gatherer, same cadence, same LLM
model/quant on every arm. Every arm gets identical universal infrastructure:
town chest + beds + torch perimeter + stocked torches, rescue-skill
learnability (no avoid-rules on rescue skills), deposit/sleep walk-home
fallbacks, water cost-tuning and drowning-exit fix, `llm.admission`
instrumentation. No reputation ordering, no macros, no lexicon gates, no
invention, no cathedral, no tempo variation in this block.

## Endpoints

- **Primary:** productivity per bot-hour = successful gathers per bot-hour of
  exposure. Retained variant (deposited items per bot-hour) is co-primary.
- **Secondary:** (1) valid board uptake rate (board arm only: fraction of
  adopted beliefs later confirmed by the adopter's own evidence); (2) false /
  stale belief rate per arm (contradiction events per consulted belief);
  (3) death count and death cost (items lost, recovery time, town return
  rate — reported separately, never summed); (4) deposit ratio (deposited /
  gathered).
- **Exploratory only:** attention patterns, lexicon/naming behavior,
  macro formation, public-works activity, aesthetics, anything not named
  above.

## Duration and exposure

- **7 consecutive days** per repetition, timestamp-bounded, preceded by 1–2
  shakedown days that are excluded from all analysis.
- Exposure gaps (infra outages) are subtracted identically across arms; an
  outage affecting arms unequally for >6h voids the repetition.
- Target: 3 repetitions minimum before any cross-repetition claim.

## Inclusion / exclusion rules

- A bot crash-looping >2h is restarted (logged intervention); its downtime is
  subtracted from exposure. Manual rescues follow the Block 1 protocol:
  arm-blind, tagged `_operator_intervention`, budgeted at parity across arms.
- Code freeze at block start; mid-block deploys only for data-integrity
  failures, declared in the trial manifest before restart.
- Early close only on the pre-defined tripwire (accepted non-forced
  admissions near zero fleet-wide for 2h+) or infra failure; a block closed
  early is reported as such, never silently shortened.

## Effect size and honesty rules

- Minimum effect worth claiming on the primary endpoint: 1.5× between-arm
  ratio per bot-hour (Block 1 showed 4.1× hive vs isolated; board landing
  under 1.5× of isolated means the board's costs ate its benefits).
- Confirmatory plots: primary + the four secondaries, per arm, per
  repetition. Everything else is narrative.
- Block 1 vs Block 2 comparisons are never causal (code changed at the
  boundary); within-Block-2 arm comparisons are the evidence.
- N is small and worlds are single-seed; language stays mechanism-strong,
  causality-cautious.

## Predictions (falsifiable, written in advance)

1. hive > isolated on production per bot-hour (replicates Block 1).
2. board lands between hive and isolated on production, closer to hive.
3. board < hive on false-belief rate (quorum + expiry damp bad beliefs).
4. placebo ≈ isolated on production minus a travel tax (ritual without
   memory is a pure cost).
5. isolated shows the highest stranding time despite learnable rescue
   (recovery exists but does not compound without sharing).

## Model sensitivity (added 2026-08-17 after adversarial review)

Block 2 runs ONE model across all four arms, so its result is properly stated
as "the memory effect **under this model**", not "the memory effect". The
objection that forces this wording: model capability may interact with the
memory condition -- a suggestible model may adopt peer-reported beliefs
uncritically while a stronger one checks them against observation, in which
case the shared-memory arm's contradiction rate is partly a fact about the
model.

Committed in advance:

1. Before Block 2, run `scripts/model-eval.py suggest` across at least three
   models spanning size, family, and reasoning-tuning. It measures
   suggestibility directly: a false peer report is injected contradicting a
   resource the bot can see, paired against the uninjected prompt.
2. If suggestibility is comparable across models, Block 2 proceeds
   single-model and this limitation is a stated footnote.
3. If suggestibility falls materially with capability, the interaction is
   real. Block 2 still runs single-model, but afterwards the hive-vs-isolated
   contrast is replicated with a stronger model for >=2 days, and no general
   claim about LLM collectives is made until that replication agrees.
4. The decision rule and the model set are fixed HERE, before any Block 2
   data exists.

## Metric corrections carried into Block 2

- Contradictions are reported per BELIEF and per ACTED-UPON belief, not per
  bot. Shared bots generate more beliefs, so a per-bot ratio partly measures
  belief volume rather than belief quality. (Block 1's 3.6x figure is
  re-stated on this basis in the report.)
- Productivity is decomposed rather than aggregated: gathers by target type,
  and gathered-vs-retained, so a large ratio driven by repetitive easy
  actions cannot read as progress.

## Entrapment as the dominant variance source (added 2026-08-17, before any Block 2 data)

Observed during interim, and it undermines a load-bearing assumption of this
document: **productivity in this world is dominated by whether a bot is
physically stuck, not by what it knows.**

Evidence. In Block 1 the isolated arm spent 55% of the block below y=45 and
the shared arm 12%; the shared arm out-gathered it 4.2:1. After three
capability fixes freed the trapped bots during interim, the ranking inverted
completely -- one hour showed 46 gathers from the isolated arm against 1 from
the shared arm -- for the mirror-image reason: the shared bots were now the
stuck ones (tree canopy, mountain ledges, surface pins). Neither ratio
measured memory. Both measured mobility.

An arm comparison that does not control for this is measuring terrain luck.
Committed in advance:

1. **Entrapment is a reported covariate, not a footnote.** Every arm
   comparison reports fraction-of-time-immobile (no net position change over
   a 10-minute window) and fraction-of-time-below-y=45 alongside the primary
   endpoint. An arm difference in the primary endpoint accompanied by a
   comparable difference in immobility is reported as CONFOUNDED, not as a
   memory effect.
2. **Exposure is redefined as MOBILE bot-hours.** The primary endpoint's
   denominator excludes windows in which a bot was immobile, so productivity
   measures what a working bot achieved rather than how many of an arm's bots
   happened to be free.
3. **Both denominators are published.** Raw per-bot-hour and per-mobile-bot-hour
   appear side by side in every confirmatory plot; if they disagree, the
   disagreement is the finding.
4. **Shakedown gate.** Block 2 does not start until, across a full shakedown
   day, no arm's immobile fraction exceeds another's by more than 2x. If the
   worlds cannot meet that, the terrain or the spawn placement is changed
   before the block, not after.

## Deferred to Block 3: stockpile perception (decided 2026-08-17, before Block 2 data)

Proposal considered and REJECTED for Block 2: making the communal chest's
contents visible to nearby bots, plus a deterministic "town needs" list, as
universal town infrastructure.

Rejected because it is not arm-neutral, which was the whole premise for
calling it infrastructure. Chest visibility is proximity-gated, so its
sampling rate is TREATMENT-MEDIATED: board and placebo bots return to town by
obligation, hive bots need fewer trips because information reaches them
remotely, and isolated bots' trip frequency is itself an outcome. The board
arm would gain an accidental advantage -- its bulletin-board ritual also
refreshes stockpile state -- and any improved allocation could be credited to
"physical memory" when it was really "more frequent stockpile reads".

It also changes the estimand. Deposits stop being a productivity measure and
become closed-loop economy performance: gathering competence x navigation x
town-return rate x observation recency x scarcity interpretation. Landing that
in the same block as the just-repaired banking path would make any Block 2
surprise uninterpretable.

Block 3 gets it properly, as a manipulation rather than a control: memory
regime (hive/board/isolated/placebo) x stockpile visibility (visible /
hidden / yoked-exposure), with town-visit schedule controlled separately. A
needs list, when it ships, is declared as CURRICULUM SHAPING, generated by a
stated rule (minimal canonical ingredients for the next unlocked milestone,
capped), and frozen before the block -- not hand-picked quantities that merely
look natural to a Minecraft player.

## Analysis corrections (2026-08-17, before Block 2 data)

1. **Mobile bot-hours is post-treatment conditioning and must not stand
   alone.** If a memory regime CAUSES immobility -- paralysis by inherited
   avoid-rules, or rescue by shared knowledge -- then conditioning on mobile
   time removes part of the very effect under study. Wall-clock and
   mobile-denominator results are therefore co-equal outputs, always reported
   together, and disagreement between them is a finding about the treatment
   rather than a nuisance to resolve.

2. **False-belief HALF-LIFE, not just spread.** Instant sharing is a fast
   correction channel as well as a fast error channel; measuring only
   propagation would credit the hive with all of its errors and none of its
   repairs. Report, per arm: time from a belief's first adoption to its first
   contradiction, and the fraction of contradicted beliefs still acted upon
   afterwards.

3. **Typed quorum's false negatives are measured, not assumed away.** Requiring
   two same-class witnesses suppresses rare true discoveries that only one bot
   ever makes. Report claims that never reached quorum but were later confirmed
   by the reporter's own repeated evidence -- the board's cost of filtering,
   which cannot be called "truth filtering" until its false-negative rate is
   known.

4. **Prompt budget is a hidden treatment.** Arms carry different amounts of
   memory text, so token count and dropped-event counts are logged per arm and
   reported alongside the endpoints.

## Model choice for Block 2 — decided 2026-08-17 on evidence

The sensitivity rule fixed above required running the model sweep before
Block 2. First results, on the Blackwell (idle, no fleet contention), 13
identical logged trapped states, both models seeing byte-identical prompts:

| prompt variant | qwen2.5:7b | qwen2.5:32b |
|---|---|---|
| as-logged (prerequisite only as prose) | 0/13 | **6/13** |
| prerequisite promoted into TASK | 3/13 | **12/13** |
| BOGUS `sea_pickle` prerequisite obeyed | 3x | **1x** |

warm latency: 7b = 0.79s (~37 bots at 30s cadence); 32b = 1.76s (~17 bots).

Three findings, all bearing on the pre-registration:

1. **Model size is NOT irrelevant to this failure.** An earlier interim note
   claimed the four-day fixation was "an interface failure, not a model
   limitation". That was too strong: the 32b solves the trap from prose alone
   where the 7b never does. The prompt fix is real AND the capability gap is
   real; they compound (32b + promotion = 12/13, the best any configuration
   has produced).
2. **The larger model is markedly harder to fool.** It obeyed a nonsense
   prerequisite a third as often. That matters because a promoted prerequisite
   is immune to the admission gate, so the override channel is safer under a
   model that reasons about plausibility.
3. **17 bots at a 30s cadence is inside Block 2's envelope** (4 arms x 5 bots
   = 20 bots), but only just, and only with the Blackwell healthy. The 7b has
   roughly twice the headroom.

DECISION: Block 2 runs **qwen2.5:7b-instruct**, unchanged, because (a) it is
what Block 1 ran, so the arms stay comparable to the existing baseline, (b) it
leaves inference headroom for 20 bots on a single host, and (c) the
capability gap is now MEASURED rather than assumed, so it can be stated as a
limitation instead of discovered later.

The 32b result converts the earlier hand-waving into a concrete follow-up:
after Block 2, replicate the hive-vs-isolated contrast on qwen2.5:32b for >=2
days. If the memory effect changes size under the stronger model, the
interaction the review warned about is real and the Block 2 claim is scoped to
"under this model" permanently.

CAVEAT ON THESE NUMBERS: n=13, drawn mostly from one bot, and the 7b's rates
here differ from a 30-state run on a different corpus (2/30 and 20/28). The
BETWEEN-MODEL comparison within this run is the sound part; the absolute rates
are noisy.

## AMENDMENT — the shakedown gate binds on mobile fraction (2026-08-18)

Made **before any Block 2 data exists**, which is the only condition under
which amending this document is legitimate. Once Block 2 starts, the numbers
below are frozen and any further change is reported as a deviation.

### What changed

The gate previously read: *"no arm's immobile fraction exceeds another's by
more than 2x."* It now reads:

> Across a full shakedown day, no arm's **mobile** fraction may exceed
> another's by more than **2x**, AND every arm must be at least **30% mobile**.
> If the worlds cannot meet that, the terrain or the spawn placement is changed
> before the block, not after.

**The 2x threshold is unchanged.** What changed is the statistic it binds on.

### Why — the original rule could not reject the case it was written for

Building the gate as an executable check (`scripts/shakedown-gate.py`) made it
possible to run the rule against blocks whose outcome we already know. Applied
to Block 1's own `fixed-arms-01b` — the block this document already describes
as confounded by entrapment:

| slack (blocks) | immobile-fraction ratio | mobile-fraction ratio | worst arm mobile |
|---|---|---|---|
| 2 | 1.39x **PASS** | 2.38x FAIL | 16.9% |
| 4 | 1.36x **PASS** | 2.43x FAIL | 15.7% |
| 8 | 1.36x **PASS** | 3.06x FAIL | 11.3% |
| 16 | 1.31x **PASS** | 4.20x FAIL | 6.9% |

The immobile-fraction test passes the confounded block at *every* slack value
tried. That is structural, not bad luck: a ratio of large fractions compresses
toward 1 exactly when both arms are badly stuck, which is the situation the
gate exists to catch. Isolated 84.3% vs shared 61.9% immobile reads as a 1.36x
difference; the same measurements as *working* time read 15.7% vs 38.1%, a
2.43x difference. The mobile form is also the one that matches the primary
endpoint, whose denominator is mobile bot-hours.

On a healthy block (`baseline`) the mobile-fraction test passes at every slack
value (1.08x-1.56x), so the change discriminates rather than merely tightening.

### The floor, and why a ratio alone is not enough

A ratio passes when every arm is equally broken. Block 1's worst arm sat at
15.7% mobile; `baseline`'s at 38.1%. Below roughly a third, most of an arm's
exposure is spent getting unstuck, the per-mobile-bot-hour denominator becomes
thin and noisy, and the endpoint measures recovery from entrapment rather than
memory. **30%** is a judgement call, fixed here in advance rather than chosen
later.

### Parameters fixed in advance

| parameter | value | rationale |
|---|---|---|
| window | 10 min | unchanged from the original |
| immobile if net move < | **4 blocks** | verdicts stable at slack 2 and 4, drifting at 8 and 16 |
| mobile-fraction ratio limit | **2.0x** | the originally pre-registered threshold, unchanged |
| minimum mobile fraction | **30%** | separates Block 1 (15.7%) from baseline (38.1%) |
| minimum windows per arm | **500** | 4 arms x 5 bots x 144 windows/day is ~720; 100 let a mostly-dead arm pass |

`--slack` is printed on every run because it is the one judgement call inside
the definition of "no net position change".

### What was deliberately NOT changed

- **below-y45 remains reported, never gated.** Depth is partly a *consequence*
  of the treatment — bots choose to mine — so hard-gating it would select for
  worlds that suppress the behaviour under study. A depth spread above 2x
  prints a warning, and if the primary endpoint also differs the comparison is
  reported as CONFOUNDED, per rule 1 above.
- **The 2x threshold itself.** Moving a pre-registered number because it fails
  to reject data one dislikes is how a gate becomes decoration.

### Additional stop conditions found while building it

- **INSUFFICIENT is a distinct verdict from GO** (exit 2, not 0). A gate that
  passes because an arm shipped no telemetry is worse than no gate.
- **Arms must be disjoint.** `exp.arm` is stamped per document, so a bot
  reassigned mid-window contributes to two arms at once — observed on
  `interim-01`, where five bots straddled. The gate refuses rather than
  computing a ratio between overlapping sets.

## AMENDMENT — town economy: deposits gated, sleeping and torches cut (2026-08-18)

Made **before any Block 2 data exists**. Two independent analyses (Claude from
~620K logged skill events, ChatGPT from the source) reached the same three
conclusions, and the measurements below are the reason.

### Torches — CUT as an economy mechanism

The stated rationale was suppressing mob spawns near town so deaths would not
be an uneven nuisance across arms. The death record does not support it:

| cause | deaths | share |
|---|---:|---:|
| drowning | 663 | 76% |
| fall | 169 | 19% |
| fire | 11 | 1% |
| suffocation | 1 | — |
| **mob** | **0** | **0%** |

And by elevation, **94% of all deaths occur at y=20–59** — underground — against
36 at surface level. The problem torches were built to equalise does not appear
in twelve days of data.

They are also dormant by construction. `place` has been called 42 times in the
entire corpus (crafting_table 35, birch_log 4, stone_pickaxe 2, oak_sapling 1);
**no torch has ever been placed, and no bot has ever held one** — zero inventory
events containing a torch. The only route to the stocked torch chest is
`withdraw`, which scans 48 blocks and does not walk home, so a bot away from
town cannot reach it even in principle.

Static torches may remain as inert world setup — removing them would cost a
world rebuild for no benefit — but they are no longer treated as town economy,
no endpoint depends on them, and no implementation effort goes to autonomous
torch use.

### Sleeping — CUT from the autonomous action space

**0 successes in 505 calls.** 377 (75%) failed on travel; 113 (22%) were chosen
in daylight against a prompt that already says night-only, which makes it a
model/action-selection mismatch rather than a missing instruction.

The decisive objection is arm-neutrality, not the success rate: **board and
placebo bots travel to town by obligation**, so they are near the beds at night
more often than hive and isolated bots. A sleep mechanism whose opportunity
rate is a function of town-visit frequency is treatment-mediated — the same
defect that got stockpile perception rejected above. Beds stay in the world as
spawn infrastructure; the LLM no longer spends decisions on sleeping.

### Deposits — KEPT, but gated

`deposit` is a co-primary endpoint and had **8 successes in 823 calls over
twelve days** (199 items, four bots ever). It is currently a sparse incident
log, not an endpoint. Of 815 failures, 650 (80%) were travel — stranded 466,
no_path 75, interrupted 65, path_interrupted 44 — against only 75 where the
deposit logic failed to find a chest.

The cause was structural: `deposit` walked home with a raw `goto` and therefore
inherited none of the `home` repairs (retry across hazard interrupts, route
repair below sea level, chaining past goto's 720-block ceiling). Fixed in
93b3a48+; `deposit` and `sleep` now both travel via `home`.

**Viability gate, fixed in advance.** Deposits are confirmatory in Block 2 only
if the shakedown day produces **at least 30 successful deposits fleet-wide AND
at least one in every arm**. If it does not, retained-items is reported as
**unmeasurable by pre-registered rule**, gathered-vs-retained accounting is
reported descriptively, and the primary endpoint stands alone. This is an
event-count gate, not an effect-size gate, and it is set here so it cannot be
argued after seeing the block.

**Rejected again, for the record:** satellite chests near work sites. They
would change the estimand from "can a bot return home with value" to "can a bot
touch a nearby cache", and they remove the return-home construct the endpoint
exists to measure.

### Where the effort goes instead

Water. It is the actual mortality mechanism — 663 of 868 deaths, overwhelmingly
underground in flooded caves — and every fix for it is arm-neutral because it
applies wherever a bot is, not because it visited town: water-avoidant
pathfinding, refusing wet mining targets, honest drowning-release accounting
(93b3a48), and water-exposure telemetry.

## AMENDMENT — two pools per arm, forty bots (2026-08-18)

Made **before any Block 2 data exists**, the only condition under which this
document may change. Once Block 2 starts these numbers are frozen and any
further change is reported as a deviation, not an amendment.

### What changed

Block 2 was specified as four arms × 5 bots = 20 bots in four worlds. It is now
**four arms × 2 independent pools × 5 bots = 40 bots in eight worlds.**

| | was | now |
|---|---|---|
| worlds | 4 | **8** (two per arm, same seed) |
| bots | 20 | **40** |
| hive / board / placebo | n=1 each | **n=2 each** |
| isolated | n=5 | **n=10** |

### Why

The pool, not the bot, is the experimental unit — five bots sharing one memory
are five correlated samples of one thing. Under the original design the three
pooled arms produced **exactly one observation each per repetition**, which
means no within-repetition estimate of variance is possible: any difference
between arms and any difference caused by terrain luck are the same number.
The design leaned entirely on 3 repetitions to supply replication.

A second pool per arm does not merely add bots. It answers a question the
original design could not ask at all: **do two pools under the same treatment
agree with each other?** The gap between them is a direct measurement of how
much of an arm difference is noise, and it is available within a single
repetition rather than only across three.

The two pools require **separate worlds**. Two pools in one world would compete
for the same ore, fell the same trees and cross each other's terrain, so their
outcomes would be coupled — adding correlation rather than replication, which
is the defect being fixed.

### Why it is affordable now

The new host (54 cores / 512GB / RTX 3090, with the RTX 5080 dedicated to the
fleet once the honeypot workload moves off it):

- 8 Paper servers × 3GB = 24GB, ~6 cores each — trivial against 512GB / 54c
- inference, from the 7b's **measured** p50 under real 10-bot fleet load
  (865ms, on a 5080 that was *also* serving another model at the time):

      40 bots @ 30s cadence = 1.33 decisions/sec
      x 0.865s each         = 1.15 GPU-seconds/sec
      / 2 dedicated GPUs    = 58% utilisation

  The figure to watch is not the mean but the tail: p99 was 21.9s at 10 bots.
  Oversubscription shows up in the tail well before it shows up in p50, so p99
  is the quantity that decides whether 40 was too many.

### What did NOT change

Everything else: the four scopes, one seed, one host, one endpoint pool with
per-bot rotation, 7 days per repetition, 3 repetitions, the endpoints, the
shakedown gate (mobile fraction, 2x, 30% floor), the entrapment covariate
rules, the code freeze, and the ban on new verbs and macros. Arm size is a
power decision; none of the above is affected by it.

## AMENDMENT — world difficulty is declared (2026-08-19)

Made **before any Block 2 data exists**.

### What was missing

This document specifies the seed, the border, the arms, the model, the cadence
and the endpoints. It never states the **difficulty setting**, and the fleet has
run on `difficulty=peaceful` since the world was built.

That is not a detail. On peaceful:

- no hostile mobs spawn at all
- hunger does not deplete
- health regenerates

Two of the pre-registered secondary endpoints are **death count** and **death
cost**. On peaceful, an entire class of death — being killed — cannot occur, so
those endpoints measure only environmental death (drowning, falling,
suffocation, fire). Reporting "deaths per arm" without stating that would imply
a survival result the design cannot produce.

### Declared for Block 2

**`difficulty=peaceful` on all eight worlds**, identical across arms.

Keeping it (rather than moving to `normal`) is deliberate:

- It is what Block 1 ran, so the arms stay comparable to the existing baseline.
- Mob deaths are a large, terrain- and time-of-day-correlated variance source
  that is unrelated to memory. Entrapment already swamped Block 1; adding a
  second confound of that size would make the memory effect harder to see, not
  easier.
- The question is whether shared memory amplifies false belief, not whether
  agents can survive a night. Combat competence is a different study.

The cost is stated plainly: **Block 2 cannot say anything about survival under
threat**, and its death endpoints mean "death by environment" only. Any future
comparison against a system running `normal` is invalid unless difficulty is
matched first.

### How this was found

A capability baseline was stood up on `mindcraft` for comparison, and its server
was created with `difficulty=normal` while ours ran peaceful. The resulting
head-to-head showed mindcraft dying 89 times to our 15 — 106 of its 110 deaths
being mobs, against zero mob deaths in our fleet's entire recorded history. That
was read, briefly, as evidence that our reflex layer prevents mob deaths. It is
not: there were no mobs. The baseline has been set to peaceful and its
comparison window restarted from 2026-08-19T21:12Z.

The general lesson, which is why this amendment exists rather than a quiet
config change: a condition that is identical across arms is invisible in an
arm comparison, and therefore easy to leave undeclared -- right up until
something outside the experiment is compared against it.

## AMENDMENT — operational readiness gates and town siting (2026-08-20)

Made **before any Block 2 data exists**, the only condition under which this
document may change. Once Block 2 starts these numbers are frozen and any
further change is reported as a deviation, not an amendment.

### What the existing gate could not catch

The shakedown gate added on 2026-08-18 binds on MOBILE FRACTION and protects
COMPARABILITY: it stops one arm being more trapped than another. It cannot
detect that every arm is equally broken, and by construction it never will --
eight equally-crippled worlds pass it exactly as eight healthy ones do.

That gap is not hypothetical. Run against the live fleet over 24 hours on
2026-08-20, the mobility gate returned a comfortable pass:

    MOBILE fraction: isolated=74.1%, shared=52.3%
    spread 1.42x (limit 2.0x)   floor 52.3% (minimum 30%)

while the same window contained:

    gather                 11.0% success fleet-wide
    productive:path        14,406 : 38,951 = 0.37
    deposit                211 attempts, 0 successes
    decisions/bot-hour     47.3% apart between arms
    _prereq_adopted 479 -> _prereq_satisfied 22  (5% closure)

A block started on those numbers measures mobility pathology, water pathology
and recovery pathology, and reports the residue as a memory effect.

### Thresholds, fixed in advance

These are **START/NO-START operational gates**. They are NOT analysis endpoints
and must never be reported as results. Their only job is to answer "is the
apparatus measuring anything at all" before the seven-day clock starts.

| gate | threshold | rationale |
|---|---|---|
| fleet gather success | **>= 20%** | below this the primary endpoint has no dynamic range for an effect to appear in |
| per-arm gather success | **>= 10%** | one dead arm cannot be averaged away by seven healthy ones |
| productive : path-failure | **>= 0.5** | measured 0.37 live; below parity the fleet is mostly failing to move |
| LLM p95 latency, per arm | **<= 15s** | p99 <= 25s; oversubscription shows in the tail long before the mean |
| decisions/bot-hour spread | **<= 10%** | see below -- this one is a confound, not an inconvenience |
| rescue paths >= 100 firings with 0 successes | **none** | outside the declared observation set |
| deposits | unchanged: >= 30 fleet-wide and >= 1 per arm, or reported unmeasurable | |

`--skip-viability` reproduces the pre-amendment behaviour, so the two gates can
be compared on the same window.

### Why decisions/bot-hour is a confound and not an inconvenience

Hive and board arms accumulate more memory than isolated arms, so their prompts
grow longer. If the inference endpoint saturates, those arms complete FEWER
decisions per bot-hour than isolated -- an arm effect manufactured by hardware
rather than by memory, which would read as a treatment difference in every
downstream plot. Measured capacity (2026-08-19, RTX 3090, 40 concurrent unique
prompts at the 3,000-token budget cap) is 13.8s against a 30s cadence, 46%
utilisation, so this should not bite. The gate exists so that if it ever does,
it is caught before the block rather than argued about after it.

### The observation set, and why it is declared

A 0% success rate is only a defect for an event that reports on an ACTION IT
PERFORMED. An event that reports an OBSERVATION -- "no shore is reachable", "I
am stagnating", "I am asking for scaffold" -- has no success available to it,
and gating on it would punish the telemetry for being truthful.

`shakedown-gate.py` therefore carries an explicit, auditable set of observation
labels. Adding a label to that set is a claim that the label is an observation
and must be justified in this document; it is not a way to silence the gate.

This distinction was learned the hard way. Three labels were initially read as
"rescue paths that never work". On inspection one was a genuine defect
(`_livelock_escape` hardcoded `status: 'failed'` BEFORE the relocation it was
reporting on ran, so 2,305 relocations recorded 0% regardless of outcome), one
was correct reporting (`_drowning_no_shore` is a fact about open water), and one
was a request whose outcome lives in a different event (`_prereq_adopted` ->
`_prereq_satisfied`). Only the first was worth fixing.

### Town siting is now a scored search, not a single probe

The worlds are shared material: all eight use one seed, and a town is stamped
into each. Siting therefore decides how much of every arm's exposure is spent in
water, and drowning accounted for 21,442 of the live fleet's logged events in
24 hours -- roughly a third of everything.

The previous test probed ONE column and asked only whether it was void or deep
water. A town on a dry spit in the middle of a lake passes that test.

`place-town.py` now runs a deterministic outward spiral and scores candidates
over a 32-block radius, rejecting a site for any of:

- water anywhere inside the 13x13 platform footprint
- more than 5% of sampled columns within 32 blocks being water
- platform relief greater than 3 blocks
- more than 35% canopy (the probe returns treetops, so terrain readings there
  are measuring the wrong surface)
- any cardinal route to 32 blocks crossing water or dropping more than 6 blocks

DETERMINISM IS THE POINT: one seed and one search from one origin put the same
town in all eight worlds, which is what keeps terrain out of the arm effect. The
chosen site, its statistics and every rejected candidate are written into the
town JSON so the decision can be audited and reproduced.

### What did NOT change

The four scopes, one seed, one host, per-bot endpoint rotation, 7 days per
repetition, 3 repetitions, the mobile-fraction gate itself (2x ratio, 30% floor,
500 windows), the entrapment covariate rules, the code freeze, the ban on new
verbs and macros, and every analysis rule. This amendment adds start criteria
and improves the worlds; it changes nothing about what is measured or how.

## AMENDMENT — the seed is changed, and this is why (2026-08-20)

Made **before any Block 2 data exists**. Seed `20260820` -> `31415926`.

### What the fleet said

Forty bots ran for one hour on `20260820`. The mobility gate PASSED -- spread
1.50x against a 2.0x limit, worst arm 32.8% mobile against a 30% floor -- and the
operational gate failed hard:

    gather              19/805 = 2.4%      (needs 20% fleet, 10% per arm)
    productive:path     1673:15175 = 0.11  (needs 0.5)

Both failures had ONE cause. Of 15,175 path events in that hour, **86.2% were
`stuck`** -- mineflayer-pathfinder's own stuck detector. The bots were not failing
to PLAN routes; they were failing to WALK them. Gather could not reach what it
found, and recovery churn drowned every productive event nine to one.

### Why the seed, and not the agent

The town scored `platform_relief 2` -- a genuinely flat 13x13 shelf -- at y=119,
with the surrounding terrain spread over 14 blocks. The criteria gated the ground
the CHEST stands on and merely recorded the ground the BOTS walk over.

Tightening that criterion alone would not have helped. A probe of 19 candidate
sites across `20260820` found terrain spread from **11 to 116 blocks and nothing
both flat and wooded**. There was nowhere on that seed to put a town the fleet
could operate from.

### How the new seed was chosen

Eight candidate seeds were scored on a scratch world by probing spawn terrain for
flatness, standing water and wood. The choice was made on terrain statistics
alone, before any bot ran on any of them, and no outcome measure was involved.

| | 20260820 | 31415926 |
|---|---|---|
| y_spread at the sited town | 14 | **7** |
| canopy fraction | 4% | **32%** |
| home elevation | y=119 | **y=74** |
| candidates the search rejected | 1 | **242** |

`MAX_TERRAIN_SPREAD` is now a rejection criterion rather than a recorded
statistic, which is what rejects those 242.

### Why this is legitimate

**The seed is experimental MATERIAL, not an outcome.** It is fixed in advance,
shared identically by all eight worlds and all four arms, and recorded here
before any data exists -- the same class of decision as declaring
`difficulty=peaceful`.

It would be far less defensible to run seven days on terrain the fleet
demonstrably cannot cross and then report the result as a fact about memory. A
world where no arm can act is not a harder test of the hypothesis; it is no test
of it at all.

### What did NOT change

The four scopes, two pools per arm, per-bot endpoint rotation, 7 days per
repetition, 3 repetitions, the mobility gate, every operational threshold, the
entrapment covariate rules, the code freeze, the ban on new verbs, and every
analysis rule. Only the terrain the experiment runs on.

## AMENDMENT — the substrate is rebuilt: Paper 1.21.8, a new seed, eight new worlds (2026-08-21)

Made **before any Block 2 measurement window has opened**. The shakedown clock
had never been started, so no completed window is lost and no frozen number is
being moved after seeing a result it was meant to test. Shakedown and
readiness-gate telemetry does exist, and this amendment states plainly what that
data is now worth.

This is a **substrate restart**, not a design change. Nothing about the arms,
the endpoints, the analysis rules or the gates moves. What moves is the ground
underneath them, and the standing of everything already measured on the old
ground.

### What changed

| | was | now |
|---|---|---|
| Paper build | `1.21.11-132-c5eb079` | **`1.21.8-60`** |
| seed | `31415926` | **`878725988`** |
| worlds | 8, generated on `31415926` | **8, REGENERATED** |
| arms, endpoints, gates, model, difficulty | | unchanged |

Both changes are made in one step deliberately: the version migration already
destroys the worlds, so a seed change is free at this moment and expensive at
any other. The cost of moving two things at once is stated below and is not
argued away.

### The evidence: a bare client failed every route we tested on 1.21.11

The test removed everything of ours from the loop — a **bare mineflayer client**,
no agent, no reflex layer, no LLM, no skills — on `mineflayer 4.37.1` and
`mineflayer-pathfinder 2.4.5`, the libraries the fleet runs.

Controls, all fixed before the runs:

- **ONE world**, a pristine copy restored before every run, so no state carries
  between runs and the terrain is byte-identical across arms
- **identical JVM flags** on both servers (`-Xms3G -Xmx4G -XX:+UseG1GC`)
- **exactly one server process alive at a time**, so neither arm is measured
  under host contention
- bot **RCON-teleported to an identical start block** `(10.5, 66, 10.5)`,
  verified in every run's output
- **three different start→goal routes**, each run on **both** versions
- **randomized run order**

| version | arrived | net progress mean | `path_reset` mean |
|---|---|---|---|
| Paper 1.21.11 | **0/3** | 3.2 blocks | 27.7 |
| Paper 1.21.8 | **3/3** | 50.6 blocks | 1.0 |

Per route: 1.21.8 arrived on A, B and C; 1.21.11 failed on A, B and C. **Route
is eliminated as an explanation within this matrix** — there is no route on
which the two versions agree, so "route A is harder than route B" cannot
produce this split. That is a statement about these three routes, not about
every route in Minecraft.

**This is n=3 per arm — six runs in total, and no statistical test is claimed
on it.** What the design supports is narrow and worth stating exactly: the
server build was the **only manipulated variable**, so within this test the
difference is attributable to it. What the design does NOT support: an effect
size for the fleet, a claim about forty agents in eight worlds, a claim about
other builds, or a claim that no other cause of fleet immobility exists.

Two limits on the test itself:

- `path_reset` is an observational marker for "not making progress", **not** a
  mechanism discriminator. A reset can come from collision stuckness, chunk
  stalls, server corrections, bad plans or unreachable goals.
- Server configuration beyond the JVM flags — plugins, Paper config, offline
  mode, view and simulation distance, gamerules, world border — was not
  exhaustively diffed. "Version" here means **these two server builds as
  configured**, and mindcraft #801 names offline-mode specifically, so mode may
  be part of the interaction rather than neutral.

### The first design was not clean, and that is on the record

An earlier, less-controlled version of this comparison gave **0/6 on 1.21.11
against 5/7 on 1.21.8**. It carried real confounds: the arms started from
different spawn coordinates, ran different heap settings, and both servers were
live on one host simultaneously. It is not cited here as evidence, because it
could not distinguish "version A is bad" from "route A is harder".

Those confounds were removed and **the separation did not shrink — it widened**:
1.21.8 went from 5/7 to 3/3, and its reset counts fell to 0–3 against 27–28.
The two designs are not strictly comparable to each other, so this is not an
effect-size comparison; it is the observation that the direction predicted by
"the confounds were generating the result" did not occur. Part of the earlier
1.21.8 failure was our own uncontrolled spawn placement.

Recording this matters more than the tidy number does. The clean design was
built only after an outside review named the confounds, and a version of this
finding written before that review would have been overclaimed on bad controls.

### Corroboration, and the pin we already had

Three public reports describe compatible movement failures on this version
family: mineflayer issue **#3911**, mindcraft issue **#801** — which names
**Paper 1.21.11-132 offline-mode** specifically, this fleet's exact build and
mode — and mineflayer-pathfinder issue **#366**. They are cited only as
**corroboration that similar failures have been reported outside this lab**.
They are not the mechanism and they carry no causal weight here; the controlled
matrix stands or falls on its own.

The internal fact is sharper. **`README.md` line 49 already stated that Paper is
pinned to 1.21.8, and gave this exact bug as the reason.** The fleet ran 1.21.11
regardless. The finding was not new information; it was information the repo
already held and the deployment did not honour. A documented pin that nothing
verifies is a comment, not a control.

### Mechanism is NOT established

The published explanation attached to #3911 — the bot ending up roughly 0.2
blocks in the air, glued to the block below — **did not reproduce**.
Fractional-Y position samples were **0.6% on 1.21.11 versus 1.9% on 1.21.8**:
tiny, and in the *opposite* direction from what that explanation predicts.

Stated plainly, and to be maintained everywhere this result is used: **the
effect is established and the mechanism is not.** The effect established is the
observed contrast in this controlled probe — same client, same world bytes, same
start block, same routes, opposite outcomes as a function of server build. The
causal pathway is unknown. We cannot say why, cannot predict which other builds
or configurations are affected, and may not treat any future build as safe on
the grounds that it is "not 1.21.11". Nothing downstream may assume the
mechanism is understood.

### The worlds are destroyed by the migration

Minecraft has **no world downgrade path**. The current worlds are at
**DataVersion 4671**; Paper 1.21.8 requires **4440** and will not open them.
All eight worlds are therefore **regenerated**, not converted.

- **World state is destroyed** — terrain, structures, chests, bot inventories,
  everything inside the save.
- **Telemetry already in Elasticsearch is unaffected.** The event record
  survives the worlds it describes.

### The seed changes too

Seed `31415926` is retired. An **845-point probe** (a 96×96 block grid around
spawn, 5 sampled heights, 8-block spacing) on a Paper 1.21.8 world generated
from `31415926` found **zero blocks matching `#minecraft:logs`**.

**The probe is coarse: 0/845 is strong but not conclusive.** Eight-block spacing
and five sampled heights can miss trees entirely, and a denser scan, a plugin,
or reading the region files would be needed to settle it.

**This appears to contradict amendment 6 and must be reconciled, not glossed.**
Amendment 6 (2026-08-20) recorded `31415926` as having 32% canopy fraction and
chose it partly for wood. Three differences separate the two measurements, and
which of them dominates is **UNVERIFIED**:

1. **Different locations.** Amendment 6's canopy figure was taken at the *sited
   town*, found by the spiral search; the 845-point probe sampled the *world
   spawn* of a separate eval world. They are not the same place.
2. **Different quantities.** Canopy fraction came from a surface probe that
   returns treetops — this document already notes that a high canopy reading
   means the probe is reading the wrong surface. The 845-point probe tested for
   the `#minecraft:logs` block tag directly. A high canopy number and zero
   sampled log blocks are not arithmetically inconsistent.
3. **Different generators.** Same seed does not guarantee the same terrain
   across Paper versions; worldgen, spawn selection and decoration can differ
   between 1.21.8 and 1.21.11. Amendment 6's world was generated under 1.21.11;
   the probed world under 1.21.8.

Reason 3 alone is enough to require regeneration and re-siting on the target
version regardless of the seed, and it means **no terrain statistic measured on
a 1.21.11-generated world carries over.** The whole siting search is re-run on
1.21.8.

### The seed selection method, fixed here before the seed is known

This is the part that has to survive a cherry-picking accusation, so it is
written before `878725988` exists:

1. Seeds are drawn **at random**.
2. They are screened against criteria **declared in writing before screening
   begins**, in the screening script and its log.
3. The **FIRST seed that passes is taken.** Not the best of N, not the prettiest,
   not one chosen after inspecting more than one passing candidate.
4. The criteria are **resource availability near spawn** — logs present, plus
   the basic early tech-tree inputs — and **not** agent outcomes. No seed is
   accepted or rejected on the basis of how any agent performed on it.
5. Every seed drawn, its screen result, and the reason for each rejection are
   written to an audit log, so the search that produced `878725988` can be
   replayed.

The concrete numeric thresholds — sample radius, block tags, minimum counts,
sampled heights, rejection cutoffs — are fixed in the screening script and its
log **before the first draw**, and are transcribed into this amendment when
`878725988` is filled in. Declaring the method here and the numbers there is
only legitimate if the numbers cannot move afterwards; if any threshold is
changed after a draw, the search restarts from scratch.

### Easier versus possible — and where this conflicts with the standing constraint

The owner's constraint is recorded verbatim in
`docs/research/pathfinding-options-2026-08-21.md`:

> *"i do not want to change the world, thats a cheap cop out fix. i need to
> build a problem solving platform that can work in any mindcraft environment."*

The distinction this amendment relies on:

- **Making a task EASIER is forbidden.** Flattening terrain, deleting water,
  shortening routes, removing hazards, or selecting a seed *because agents
  scored better on it* substitutes world-shaping for capability and makes the
  platform's competence unfalsifiable.
- **Making a task POSSIBLE is calibration, and is a precondition of grading
  anything.** A world in which the tech tree's first input does not exist within
  reach is not a hard test; it is a broken one. Every agent scores zero, the
  measurement has no dynamic range, and the zero carries no information about
  capability. If all agents score near zero, the task is not a benchmark — it is
  a failure mode.

**Where this genuinely conflicts with the constraint, stated rather than
buried.** Adversarial review pushed back on the distinction and it does not come
through unscathed:

- A seed chosen for resource presence also changes biome, elevation, route
  topology, hazard density and travel burden. **Difficulty moves as a side
  effect even though difficulty was not a criterion.** The claim "resource
  availability, not terrain difficulty" describes the *criteria*, not the
  *consequences*.
- The lab is already difficulty-shaping one level down: town siting rejects
  water, relief, canopy and route drops. Calling seed selection categorically
  different from siting is not sustainable — they differ in degree, not in kind.
- The trigger for this change was readiness data showing failure. A rule that
  only ever fires after a bad result is structurally close to a rationalisation,
  whatever its stated content.

So this is recorded as a **declared exception to the constraint, not as
something falling outside it**. The exception is taken because the alternative
is a seven-day block on a substrate where the first tech-tree input may not
exist, which produces no test of the hypothesis at all. The damage is bounded by
the pre-declared, outcome-blind screening method above, by keeping
`difficulty=peaceful` and every hazard untouched, and by this rule:

**No siting or seed criterion may ever be justified by an agent outcome. If a
future criterion is defended by a result rather than by a resource, it is
world-shaping and this document must reject it.**

### Consequences for everything measured before today

**Any prior Block 2 or instance #1 metric coupled to travel, mining, reaching
resources, or exploring chunks is CONFOUNDED.** That includes gather success
rate, productive-to-path ratio, deposit counts, mobile and immobile fractions,
below-y=45 time, and every readiness-gate number reported on the 1.21.11 fleet.

Those results are neither discarded nor rehabilitated. They are salvageable as
exactly two things:

1. a **lower bound** on travel-coupled agent capability, and
2. a **robustness record** — behaviour under a degraded locomotion substrate.

They are **never** an unbiased estimate of agent capability, and no conclusion of
the form "the agents rarely gather", "the planner fails to explore" or "LLM
strategy is ineffective" may be drawn from them. One caution on the lower-bound
reading: a degraded substrate does not only depress scores, it also generates
retry churn, spurious observations and inflated recovery activity, so "lower
bound" applies to the travel-coupled capability measures and not to event counts
in general.

**Two axes move at once, and this costs comparability.** Post-migration results
differ from prior Block 2 numbers in **both** server version **and** seed, and
the two are not separable. Therefore:

- **No post-migration result may be cited as evidence of improvement over
  pre-migration readiness or shakedown numbers.** Any such comparison credits an
  unknown mixture of build and terrain.
- **The migration is a fresh start, not a continuation.** Block 2's confirmatory
  claims rest on **within-substrate, between-arm** comparison only, and its
  repetitions are counted from the new substrate.

**The shakedown clock had not started**, so no completed measurement window is
lost.

### Falsifier — written before the migrated fleet runs

Stated precisely, because a vague falsifier is decoration. What follows
falsifies **"changing the server build is sufficient to fix fleet locomotion"**.
It does not, and cannot, falsify the bare-client contrast, which has already
been measured under controls this fleet does not have.

**The fleet-level claim is UNSUPPORTED if,** over the first full shakedown day
on `1.21.8-60` under matched conditions — same bot count, same 30s cadence, same
model, same siting rules, at least 500 windows per arm, identical event
definitions — **both** of the following hold against the pre-migration 1.21.11
baseline window:

- `path_reset` per mobile bot-hour remains inside the 1.21.11 baseline interval,
  and
- gather-active fraction remains inside the 1.21.11 baseline interval.

The baseline intervals are computed from the recorded 1.21.11 fleet window and
written down **before** the migrated fleet is started, so the comparison cannot
be tuned afterwards.

If that is the observation, the bare-client result — however clean — did not
generalise from one client on three routes to forty agents in eight worlds, the
fleet's movement failure has a cause we have not found, and it is reported as a
**falsification of the fleet-level claim**. It is not to be explained away with
a residual-1.21.11 story.

Three limits on this falsifier, stated now rather than after the fact:

- **Only the negative result is clean.** Because the seed changes at the same
  time, "no improvement" falsifies informatively — a seed screened for resource
  availability should if anything help. "Large improvement" is *consistent* with
  the version explanation but **cannot separate build from terrain**, and must be
  reported crediting both.
- **Movement improving while gather success does not is NOT a falsification.**
  It is evidence of a second blocker downstream of locomotion. The two metrics
  are reported separately for exactly this reason.
- **Passing this falsifier is not proof of the mechanism.** It shows the
  migration removed the fleet-level blocker; it says nothing about why.

### What did NOT change

The four scopes, two pools per arm, forty bots in eight worlds, one model
(`qwen2.5:7b-instruct`), `difficulty=peaceful`, per-bot endpoint rotation, 7 days
per repetition, 3 repetitions, the primary and secondary endpoints, the
mobile-fraction shakedown gate (2× ratio, 30% floor, 500 windows), every
operational readiness threshold, the deposit viability gate, the entrapment
covariate rules, the code freeze, the ban on new verbs and macros, and every
analysis rule.

What DID change, said without hedging: the **server build**, the **seed**, the
**worlds**, and the **standing of every travel-coupled number measured before
today**. The treatment arms, endpoints, duration, model, gates and analysis
rules are untouched; the substrate is replaced before the measurement window
opens.

**Screening thresholds as actually run (transcribed 2026-08-21).** Candidate
seeds drawn uniformly at random; screened in draw order; the FIRST passing seed
taken. Criterion: the nearest tree-bearing biome, located from origin via
`locate biome`, lies within **128 blocks**. Biomes accepted as tree-bearing:
`forest`, `birch_forest`, `dark_forest`, `taiga`, `old_growth_birch_forest`,
`flower_forest`, `jungle`. Eight seeds were screened; seven passed; the first,
**878725988**, was taken at 90 blocks to `minecraft:forest`. Three later seeds
spawned inside a tree biome (0 blocks) and were **not** taken, because taking
them would have been selection on the outcome.

An earlier block-probe operationalisation (">=8 `#minecraft:logs` blocks within a
96x96 grid") was discarded before any seed was accepted: its detector was proven
non-functional against a known planted log block. The 845-probe null result on
seed 31415926 quoted above is therefore **withdrawn as evidence of treelessness**;
the correct measurement is that seed 31415926's nearest forest is **273 blocks**
from origin, which is outside the probe radius used and outside the 128-block
criterion adopted here.

---

## AMENDMENT — the water/hazard start gate replaces the drowning escape-rate threshold (2026-08-23)

Written **before the 200 bot-hour collection on `7d1ee54` completes**, and before
any of the thresholds below have been evaluated against it. The reason for the
ordering is on the record in the previous day's work: a threshold chosen after
seeing the number is a threshold that gets talked into passing.

### Why the old gate is withdrawn

The drowning-escape-rate threshold — `escaped / (escaped + timeout) >= 50%` — is
**withdrawn as a start gate**. It is not merely too lax. It is the wrong shape,
and it failed in the specific way a gate must not:

    version    escape win%      drowning deaths / bot-h
    d41b828        14.8%              0.053     <- baseline
    a769e73        53.5%              0.070
    91dbefc        44.1%              0.134     <- 2.5x the baseline

Over eight hours of iteration the escape rate rose from 14.8% to the high fifties
while drowning deaths **tripled**. The metric improved and the fleet got worse.

The mechanism is structural, not a mistake in the threshold. Escape rate
**conditions on attempted escapes**: its denominator counts only bots that
already reached a rescue. It is therefore blind to a change that creates more
water exposure, and every change in that period created more. A fleet that
enters water twice as often and escapes slightly better scores better and buries
more bots.

Any replacement must have harm in the numerator and EXPOSURE — not attempts — in
the denominator.

### The gate is lexicographic; the composite is a dashboard number

A weighted harm score is **not** adopted as the gate. A weighted sum permits a
large improvement in a cheap frequent term to mask a regression in a rare
expensive one, which is the failure above with more arithmetic on top. The
composite is retained for ranking candidates AFTER the hard gates pass, and it
never overrides them.

Gates are evaluated in order. The first failure stops the block; later gates are
not consulted.

    G1  terminal harm, water      drowning deaths
    G2  terminal harm, all-cause  every accidental death, water or not
    G3  near-death water exposure oxygen-critical state, reentry, stranding
    G4  hold efficacy             does the surface-hold actually hold
    G5  composite                 only reached if G1-G4 pass

### G1 — drowning deaths, and why they cannot be the working gate

Baseline: **0.053 drowning deaths per bot-hour** (`d41b828`, 2.82h, the last
measurement taken before any water work).

Deaths are rare enough that short windows carry almost no information. Computed
from the Poisson upper bound `chi2(2(k+1), c) / 2E`:

    exposure   baseline expects   max deaths passing an 80% bound <= 1.5x baseline
      50 bot-h       2.6                    k <= 1
     100 bot-h       5.3                    k <= 5
     200 bot-h      10.6                    k <= 12
     300 bot-h      15.9                    k <= 19
     400 bot-h      21.2                    k <= 26

**At 50 bot-hours the acceptance test is unpassable by construction** — it admits
at most 1 death where baseline itself expects 2.6. This is not a stricter
standard; it is a window too short to distinguish any hypothesis from any other.
The `b6a4845` run (k=3 over 50 bot-h) yields an 80% upper bound of 0.110/bot-h,
**2.1x baseline** — which is neither evidence of regression nor of safety, and
was correctly recorded as neither.

Therefore:

  - **Catastrophic veto, any 50 bot-h window:** halt on `k >= 6` drowning deaths.
    Under baseline `P(k >= 6) = 0.053`, so this accepts a ~5% false-halt rate per
    window in exchange for catching a real 2x+ regression quickly.
  - **Acceptance requires >= 200 bot-hours accumulated on one code version**, and
    passes when the 80% one-sided upper bound on the drowning death rate is
    `<= 0.080/bot-h` (1.5x baseline).
  - **No claim of death-rate improvement may be made from fewer than 10 observed
    deaths**, in either direction.

### G2 — all-cause accidental deaths, because water work moved other causes

A water-only gate is too narrow. Across the water change set, deaths by cause:

    version    drowning   falls   lava
    d41b828        6        0       0
    91dbefc       23        8       0
    b6a4845        3        2       2

Falls appeared and then persisted; lava deaths are new. A rescue behaviour can
plausibly produce bad pathing, cliff exits or lava routing, and those deaths are
not unrelated merely because the final damage type is not drowning.

  - **Fail** if all-cause accidental deaths exceed **1.25x** the all-cause
    baseline (`0.062/bot-h`, i.e. `> 0.078/bot-h`) over `>= 200` bot-hours.
  - **Inspect** if any single non-water cause exceeds 3 deaths per 100 bot-hours,
    even when G1 passes.

### G3 — leading indicators, defined independently of the mechanisms that respond

These carry the working load, because they move fast enough to measure at the
30-90 minute timescale that iteration actually runs at.

They are defined on the PHYSICAL STATE and not on any intervention. This is
load-bearing: `oxygen_critical_state` is emitted by `airCriticalTransition()`,
which has no knowledge of `mayAct`, `rescuing`, `swimming`, or whether any rescue
occurred. Gating on "how often did my override fire" would count the mechanism
rather than the world, and tuning the override would move the number whether or
not one bot was safer — the escape-rate failure in a new costume.

    indicator                      pass        warn        fail
    oxygen_critical_state /bot-h   <= 0.75x pre-fix        > 1.0x pre-fix
    drowning_reentry /bot-h        <= 12       12-18       > 18
    surfaced_stranded /bot-h       <= 10       10-15       > 15

Measured on `b6a4845` for reference, not as a pass: reentry 9.2, stranded 7.7.

### G4 — the surface-hold must be shown to work, not merely to run

Raw `_water_surface_hold` count is **explicitly not a gate**. A high count is
ambiguous between "prevention is working" and "bots keep ending up in bad
states", and the entry count alone cannot tell those apart. `b6a4845` produced
560 entries across 33 of 40 bots, which on its own says nothing.

Gate on the aftermath, via `water_surface_hold_ended`:

  - **Fail** if median health during holds `< 18`
  - **Fail** if `> 5%` of holds dip to critical air while held
  - **Fail** if `> 5%` of holds exceed 5s with no controller ever acquiring the bot

### G5 — composite, consulted only after G1-G4 pass

    water_harm_rate = ( 100*drowning_deaths
                      +  20*drowning_damage_episodes
                      +  10*seconds_below_10pct_air
                      +   5*severe_reentries
                      +   2*seconds_surfaced_stranded
                      +   1*failed_water_skills ) / bot_hour

Durations preferred to counts wherever both are available. Pass at `<= 0.70x` the
previous version, warn to `0.90x`, fail above.

**The weights are triage, not truth**, and are recorded as such. They may be
revised only by evidence — a survival or regression model showing which leading
indicators actually predict later drowning, an ablation where reducing one term
moves the death rate, or trace review showing a term is mostly benign. They may
not be revised because a candidate narrowly failed.

### What would falsify this gate design

Stated now, so it can be checked later rather than argued:

  - **G3 is worthless if its indicators do not predict deaths.** Once >= 400
    bot-hours exist, regress drowning deaths on oxygen-critical entries, reentry
    and stranding. Any indicator with no relationship is demoted to a dashboard
    number and stops gating.
  - **G1's baseline may be wrong.** 0.053/bot-h comes from a single 2.82h window
    on `d41b828`. If a re-measurement under the same seed and task mix puts the
    true baseline materially higher, every multiple above moves with it, and the
    `91dbefc` regression shrinks accordingly.
  - **If G2 never binds** across several hundred bot-hours while G1 varies, the
    all-cause gate is redundant and should be dropped rather than carried as
    decoration.
  - **If the catastrophic veto fires on windows that later prove benign** more
    than ~1 time in 10, the 5% false-halt rate was mis-specified and `k >= 6`
    should move.

### What did NOT change

The treatment arms, the memory-scope manipulation, the primary and secondary
endpoints, the seven-day duration, the model, the worlds, the seed, and every
analysis rule are untouched. This amendment replaces one **operational
START/NO-START gate** with another and adds no analysis endpoint. As with every
gate in this document, none of these numbers may be reported as a result: their
only job is to answer whether the apparatus is safe to measure with before the
seven-day clock starts.
