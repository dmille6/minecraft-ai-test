# Thirty days: 23 August – 22 September 2026

Two engines reviewed the same measured brief independently. Both corrected the
brief, and one of the corrections changes the verdict. Everything below is from
telemetry with denominators stated; where a number cannot be read it says so.

---

## 0. A correction that changes the score

I scored the project against deaths ≤0.02, gather ≥60%, iron ≥25%, immobility
≤1%. **Those were superseded on 13 September, the same day they were written**,
after both engines called them unreachable (`docs/reports/program-feasibility.md`
Part 3). The committed numbers are different, and scoring against the right ones
gives a materially different picture:

| measure | 13 Sep | **today** | committed 2-wk (27 Sep) | committed 6-wk (25 Oct) | |
|---|---|---:|---|---|---|
| deaths / bot-hour | 0.06–0.10 | **0.026** | ≤ 0.05 | ≤ 0.03 | inside, 2x clear |
| iron-pickaxe share | 3.3% | **16.7%** | ≥ 8% | ≥ 20% | inside, 2x clear |
| gather success | 30% | **22.5%** | ≥ 40% | ≥ 55% | fail |
| stock returned / bot-h | 14.7 | **3.80** | ≥ 20 | ≥ 30 | **fail by 5.3x** |
| immobile bot-minutes | never measured | — | ≤ 2% | ≤ 1% | **unmeasurable** |

Two of five are inside their number, two fail, one cannot be scored at all.

**"Inside" is not "passed", and the distinction is the program's own.** The committed
2-week number is a **72-hour read** and the 6-week number a **7-day read**
(`program-feasibility.md`:73). Everything above is a 24-hour window. Deaths and iron are
indicative, not certified, and the formal read is on 27 September.

---

## 1. Is the project making progress?

**On knowledge, yes and fast. On the capability the owner asked for, no.**

The daily series, 60 measurable bots and ~1,440 bot-hours per day:

| | 09-11 | peak | **today** | change from peak |
|---|---:|---:|---:|---|
| items / bot-hour | 44.5 | **64.9** (09-14) | 25.3 | **−61%** |
| **deposited / bot-hour** | 16.9 | **16.9** (09-11) | 3.3 | **−81%** |
| gather success | 35.9% | 38.1% (09-12) | 22.5% | −41% |
| log-gather success | 28.3% | 28.3% (09-11) | 10.4% | **−63%** |
| decisions / bot-hour | 58.9 | 59.6 | 47.3 | −21% |
| deaths / bot-hour | 0.046 | — | **0.026** | **3.3x better** |

**The metric that fell hardest is the one the owner chose.** Gross items/bot-hour
was explicitly retired on 13 September in favour of deposited output; deposited
output is down 81%.

And the death improvement deserves a harder look than "3.3x". Normalised per unit
of work actually delivered:

| deaths per… | 13 Sep | today | |
|---|---:|---:|---|
| decision | 1.43e-3 | 0.55e-3 | 2.6x better |
| item gained | 1.36e-3 | 1.03e-3 | 1.3x better |
| **item deposited** | 6.69e-3 | **7.95e-3** | **19% worse** |

Per item banked, this fleet dies slightly *more* than it did on 13 September. The
3.3x is a rate per unit of time on a fleet that is doing less. And the prize was
never large: `keepInventory=true` and immediate respawn on all 16 worlds mean a
death costs time, not items — measured at **0.04% of bot-hours**.

Against that, the epistemic gain is real and I do not want to undersell it: three
gates measured to fire on noise (43.3%, 17.2%, 46% on windows where nothing was
deployed), five stale detectors caught, a placebo null established, and an offline
harness that found six defects in one change before it cost a bot-hour.

---

## 2. Are the goals realistic? The arithmetic

**Deaths — met, but measured under conditions the end-state removes.** Slope
≈ −0.0045/day. Already inside the 2-week number and on track for the 6-week one.
But it is measured on **Peaceful** worlds with `keepInventory=true`. Raise
difficulty or turn keepInventory off — both of which the end-state requires — and
this baseline resets.

**Gather success — the trajectory is negative.** −0.56 pp/day across the window,
−0.84 pp/day over the last seven. At the observed rate it never arrives. And the
ceiling settles it: from today's measured funnel, closing **100%** of the largest
effect this project has ever measured (the fresh-vs-worn gap) still lands fleet
gather success near **35%**, below the ≥40% gate. Fixing both known filter defects
buys roughly **+4.6 pp** — against a cross-arm detection floor of ~14 pp. *That is
why leaf-01 read as nothing: it was unobservable by construction.*

**Gather success is also arguably mis-specified — but not for the reason I first
gave.** I wrote that the metric improves if the bot stops refusing and starts failing
slowly. That is arithmetically wrong: both are failures and successes/attempts does not
move. What actually changes is THROUGHPUT — a refusal is nearly free and a failed attempt
costs up to 180 s, so the same success rate can hide a large difference in successes per
bot-hour. The real specification problem is that 76.4% of log gathers are refused before
the bot moves, so the metric is dominated by a filter decision rather than by execution.

**Iron-pickaxe share — perverse, and near its own ceiling.** 16.7% looks like 5x
progress. It is held by **11 of 60 bots**, and those 11 hold one **91% of their
time**. The hard ceiling at 11 bots is **18.3%**. It moves only when a twelfth bot
acquires one, and last night the fleet crafted **zero**. It is also stock
occupancy: a bot pinned motionless holding a pickaxe scores 100%.

**Immobility — genuinely mis-specified, and this is the clearest case.** In one
week the same quantity was reported as **0 of 80**, **3 of 80 pinned ≥4h**
(3.75%), and **55.0% of position samples identical to the previous sample**. The
baseline is a bot count, the target is a share of bot-minutes, and the fleet-wide
figure that exists is on a third axis. `program-feasibility.md` said on 13
September: *"Resolve the immobility denominator first."* Nine days later it is
unresolved.

**27 September: gather fails, stock fails by 5.3x, deaths and iron pass,
immobility cannot be scored.**

---

## 3. What actually causes the wood number

Five explanations were tested and killed this week — local exhaustion (its
negative control moved 4x harder), the radius gradient (measures mobility, not
ground), "fresh worlds have more wood" (they have *fewer* tree columns near their
bots), accumulated avoid rules (the gap survived a fleet-wide store wipe), and my
own "two thirds never move" (circular: a refused run never walks).

What survives, all measured today:

- **76.4%** of log gathers on worn worlds are refused at the candidate filter;
  **33.1%** on the two fresh ones. Same code.
- Two verified causes: `oak_leaves.boundingBox === 'block'`, so **60% of an
  ordinary oak's wood reads as "buried"** (75% on a short trunk); and a mineshaft
  liquid rule refusing shoreline trees — **0.0% lava** across 994 candidates.
- Among runs that get past admission and travel, fresh worlds are **1.51x** better
  (65.4% vs 43.4% productive; the worn failure probability is 1.64x), and **77.9%** of
  worn route failures are a genuine "A\* reached none". An earlier draft said "2x" from
  a differently-filtered window; 1.51x is the like-for-like figure.
- Worn worlds carry **6.9x** the density of dry drops deeper than the movement
  profile will step down — but **the link to the route failures is not
  established**, and the mechanism I proposed for it was killed by its own harness
  test.

It is **not** "there are no trees": `nothing_found` is 5.5%, and the ground sample
found *more* tree columns near worn-world bots. The wood is there and is being
rejected.

---

## 4. The measured rate of validated change

- 850 commits, **472 in `bots/src`**, 44 reports, 65 branches.
- **Coverage: 20 of 80 bots — 25% of the fleet — are in `isolated-*` pools and are
  excluded from every read in this report.** Every rate above is over the 60 measurable
  bots, and nothing here says what the other 20 are doing.
- Canary ledger since 16 Sep: **12 runs — 3 KEEP, 5 REVERT, 4 no verdict.** Of the
  three KEEPs, one was an instrument that changed no behaviour and one passed a
  threshold whose confidence interval straddles it.
- **This week: five hypotheses tested, five killed, zero confirmed.**
- Hard ceiling: about two canaries per 12 hours, and after exclusions only four
  pools sit inside the eligibility band.

**That is roughly one behaviour change validated per week, and the aggregate of a
month of them is an endpoint down 61%.** A completion date cannot be computed from
a negative slope. What the rate does support:

- **27 Sep:** the gather gate fails. High confidence, pre-registered.
- **To ~27% fleet gather:** both filter fixes landing and reading positive — 2–4
  weeks, and the arithmetic caps it there.
- **To ~35%:** additionally requires closing the 2x traveller residual, for which
  **zero mechanisms are currently alive**. No date.
- **"Build"** is not on any timeline, correctly: all 16 worlds are Peaceful and a
  shelter has no fitness function.

**Honest statement: at the demonstrated rate, "survive, move, gather and build in
any Minecraft world" has no defensible date, and the binding constraint is not
ideas — it is that the fleet cannot tell whether a change worked.**

---

## 5. What should stop

| 13 Sep stop-list item | honoured? |
|---|---|
| Per-decision LLM as the day-to-day driver | **No.** 47.3 decisions/bot-h, model still on the tick. Step 4 committed 13 Sep, **never started**. |
| Fleet canary = safety and non-regression only | **No.** Every canary since has been mechanism discovery. |
| Review loops past two passes | **Partly.** Codified; in practice one report took three amendments and a withdrawal in a day. |
| Synthesise exposure instead of waiting for it | **Honoured, 8 days late** — the offline harness landed 21–22 Sep. |
| Bigger-model experiments on the tick | **Honoured.** |
| Reward retention, not production | **Honoured in definition**, but the metric chosen is perverse. |

**New candidates:**

1. **Stop running canaries to discover whether a change works.** The instrument is
   measured blind under ~14 pp. Forty-two canaries bought one established effect.
   Keep the fleet for safety and non-regression — which is what the owner's own
   directive said nine days ago.
2. **Stop the wood-filter thread as the main line** once both fixes ship. The
   defects are real and verified; the arithmetic caps the whole thread at +4.6 pp,
   below every instrument's noise floor.
3. **Stop reporting immobility until it has one denominator.**
4. **Stop spending slots on deaths** while `keepInventory=true` makes them worth
   0.04% of bot-hours.

---

## 6. The single highest-leverage move

**Start reliability-program step 4 — the deterministic
gather→craft→smelt→mine→deposit worker with the model off the tick — and read it
as a half-fleet comparison on deposited items per bot-hour.**

The argument is arithmetic, with its limits stated. Measured placebo nulls on THIS
estimator: sd 9.0 pp at 2 pools over 180/180, 8.2 pp at 2 pools over 180/540, 10.9 pp at
4 pools over a 30-minute window. The pool-mean spread falls roughly as 1/√k, so resolving
a 3 pp change would need on the order of **800 bots**. There are 80. What I have NOT
measured is a blocked or within-bot design, or windows beyond 9 hours, so "cannot see
small changes at any window length" is stronger than the evidence — **what is measured is
that the designs actually in use are blind under roughly 14 pp.** So the only rational
policy is to attempt large ones — and the instrument demonstrably *does* see large
effects: the re-seed read +29 to +33 pp and replicated across two pools and two
timepoints to within 0.5 pp.

Step 4 is the only queued item with a plausibly large effect, and every supporting
number is measured: 55% of position samples are stationary; decisions/bot-h fell
59.6 → 47.3; the decision cooldown is ~33-42% of cycle time; the model picks the
most-echoed verb 54.5% of the time against 7.1% by chance; and deposit succeeds
**10.1%** of the time.

It is also robust to the unresolved world question **in either direction**. If
terrain dominates, a scripted worker that always has a next action does not depend
on finding good terrain. If it does not, the defect is decision quality, and the
worker removes that from the tick.

**Pre-register the falsifier before building:** deposited items per bot-hour on the
worker arm must beat control by more than the measured drift band (pools moved −45%
to +77% in six hours with no code change), read within-bot paired pre/post. If a
scripted worker cannot clear that, the answer is the uncomfortable one: **80 bots
is too small a fleet to develop against, and the next investment is fleet size.**

Run it after the 27 September window closes. Before then, ship the two built fixes
and let the program read fail honestly — a clean recorded failure on a
pre-registered gate is worth more than the last five canaries together.

---

## 7. Where the two engines disagree, and it matters

They agree on the diagnosis and split on the prescription.

**Engine A (above): build the whole worker.** The instrument can only see large
effects, so attempt only large ones; the worker is the only queued item plausibly
that size.

**Engine B: that is too big a first bite. Fix and prove ONE restricted
gather→deposit cycle first.** Its argument, which I find hard to answer:

- A script meets the same rejected trees and the same impossible routes. *"Always
  has a next action"* does not make terrain irrelevant. The worker's effect is
  **plausible, not demonstrated**.
- Adding craft, smelt and mine introduces four dependencies **before proving the
  terminal operation that monetises every upstream gain**. Deposit succeeds
  **10.0%**. Everything the fleet gathers flows through it.
- **It was already prescribed.** `program-feasibility.md` amendment 2, 13
  September: *"Fix the deposit path in week one. 17% success is the cheapest large
  gain in the program and every other gain flows through it."* Nine days later it
  is not done and the rate has fallen from 16.8% to 10.0%.
- It rejects my falsifier: a failed half-fleet comparison could mean a broken
  implementation, thin exposure, or a bad design — **not** "80 bots is too few".
  Half of 60 measurable bots is six pools, and within-bot pairing does not remove
  shared world drift.
- And it rejects waiting for 27 September: **no measured argument justifies
  idling for five days.**

**I think Engine B is right and my draft was wrong.** The deposit path is smaller,
was already committed, is readable *without* a canary at ~2,900 runs/day (binomial
se ≈0.6 pp), and is the terminal step that converts every upstream gain into the
metric that actually failed. The worker follows it, not the other way round.

The deposit fix built today is a first piece of that, and it is honest about its
own size: it recovers wasted decision time and makes a false refusal true. It banks
**zero extra items by itself**.

## 8. Dates, computed rather than declined

Saying "no defensible date" for the whole goal is right; saying no dated
accountability is an abdication. From the measured trajectories:

| | measured rate | projection |
|---|---|---|
| gather success | **−0.56 pp/day** | 22.5% → **19.7% on 27 Sep**. Reaching ≥40% needs **+3.5 pp/day**; ≥60% needs +7.5. Neither has ever been observed. |
| iron-pickaxe share | +1.49 pp/day (snapshot) | ≥20% around **25 Sep** — but capped at **18.3%** until a twelfth bot acquires one, and zero were crafted last night. |
| deaths | −0.0045/day | already inside both numbers, under conditions the end-state removes |
| deposited output | −0.23/day | moving **away** from ≥20 |
| build | **no measured rate exists** | no date can be computed, and none should be quoted |

The draft's "2–4 weeks" for the filter fixes is not supported by the delivery
evidence and is withdrawn.

## 9. What this review still does not cover

- **Building has no acceptance test.** Peaceful mode does not make construction
  meaningless; it means nobody has specified what a finished structure is or
  measured one. The goal includes "build" and nothing in 30 days measures it.
- **Deposited output is a count, not a value.** It can be inflated by low-value
  items, and nothing here checks for withdraw-and-redeposit.
- **25% of the fleet is unmeasured** (the 20 `isolated-*` bots).
- **World sustainability is unmeasured over time.** The 6.9x dry-drop density is a
  snapshot with no t=0 baseline, so nothing shows it *grew*. The cheap test is the
  same census repeated on the two fresh worlds at +2 and +4 weeks.
- **Why deposit-first went undone for nine days** after being named the cheapest
  large gain in the program. That is a process answer, not a measurement, and it
  belongs with the owner.
