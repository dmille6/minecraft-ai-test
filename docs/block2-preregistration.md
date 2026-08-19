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
