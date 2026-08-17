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
