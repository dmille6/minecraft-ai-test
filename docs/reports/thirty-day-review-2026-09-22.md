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
| deaths / bot-hour | 0.06–0.10 | **0.026** | ≤ 0.05 | ≤ 0.03 | **MET, 2x clear** |
| iron-pickaxe share | 3.3% | **16.7%** | ≥ 8% | ≥ 20% | **MET, 2x clear** |
| gather success | 30% | **22.5%** | ≥ 40% | ≥ 55% | fail |
| stock returned / bot-h | 14.7 | **3.80** | ≥ 20 | ≥ 30 | **fail by 5.3x** |
| immobile bot-minutes | never measured | — | ≤ 2% | ≤ 1% | **unmeasurable** |

Two of five met, two failed, one cannot be scored at all.

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

**Gather success is also arguably mis-specified.** 76.4% of log gathers are
refused at a candidate filter *before the bot moves*. A cheap refusal and an
expensive failed attempt both count as "not success", so the metric improves if
the bot stops refusing and starts failing slowly.

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
- Among runs that get past and travel, fresh worlds are still **2x** better, and
  **77.9%** of worn route failures are a genuine "A\* reached none".
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

The argument is arithmetic. The null spread of the pool-mean estimator is ~1/√k;
resolving a 3 pp change would need roughly **800 bots**. There are 80. **This fleet
cannot be made to see small changes at any window length.** So the only rational
policy is to attempt large ones — and the instrument demonstrably *does* see large
effects: the re-seed read +29 to +33 pp and replicated across two pools and two
timepoints to within 0.5 pp.

Step 4 is the only queued item with a plausibly large effect, and every supporting
number is measured: 55% of position samples are stationary; decisions/bot-h fell
59.6 → 47.3; the decision cooldown is two thirds of fleet life; the model picks the
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
