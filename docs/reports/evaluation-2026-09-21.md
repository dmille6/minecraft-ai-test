# Friday to Monday: a two-engine evaluation

**2026-09-21, 17:00 Central.** Claude and Codex evaluated the same brief
independently. They agree on the verdict and disagree with how this project has
been describing itself. Where they were wrong, they are corrected below with the
measurement that corrects them.

---

## 1. Are we making progress?

**Knowledge: yes, substantially. Shipped behaviour: no. Not one validated
behaviour change in four days.**

### The endpoint, decomposed

Fleet-wide, 12:00–20:00Z windows, 60 measurable bots, ~480 bot-hours each:

| | items/bot-h | logs/bot-h | gather ok% | deaths/bot-h |
|---|---:|---:|---:|---:|
| Fri 18 Sep | 24.44 | 1.71 | 18.0% | 0.023 |
| Sat 19 Sep | 40.51 | 3.70 | 24.2% | 0.025 |
| Sun 20 Sep | 30.62 | 4.23 | 25.8% | 0.035 |
| Mon 21 Sep | 24.03 | 3.33 | 23.5% | 0.017 |

The headline is **+5.5 pp gather success**. The independent Claude review
challenged it as a composition effect from two pools re-seeded onto fresh worlds
on 19 Sep, and computed the un-reseeded fleet as flat at 19.5% → 19.4%.

**I measured it. The challenge is right in direction and wrong in size:**

| | Fri ok% | Mon ok% | delta | items/bot-h | logs/bot-h |
|---|---:|---:|---:|---|---|
| ALL 12 pools | 18.0% | 23.5% | **+5.5 pp** | 24.44 → 24.29 (−1%) | 1.71 → 3.31 (+93%) |
| RE-SEEDED (placebo-a, b) | 13.0% | 39.6% | **+26.6 pp** | 21.87 → 38.65 (+77%) | 2.49 → 6.58 (+164%) |
| UN-RESEEDED (10 pools) | 19.1% | 20.9% | **+1.8 pp** | 24.95 → 21.42 (**−14%**) | 1.55 → 2.65 (+71%) |

Two of twelve pools carry about two-thirds of the headline. The un-reseeded
fleet moved **+1.8 pp**, which is inside the per-pool spread for the same window
(individual pools ran from **−11.8 pp to +14.2 pp** with no change deployed to
most of them). Items per bot-hour on the un-reseeded fleet went **down 14%**.

**The finding underneath is larger than anything we shipped:** same code, fresh
terrain, gather success 13.0% → 39.6%. The 12% log-gather rate is substantially
a property of worlds this fleet has spent three weeks excavating and flooding —
not of the gather policy. That has been logged as a confound to state in the
24–27 Sep program read. It is not a confound. It is the biggest effect measured
on this project, and it is currently sitting in a footnote.

### The ledger

Seven canary slots since Friday. **Validated behaviour changes: zero.**

| run | verdict | what it was worth |
|---|---|---|
| falls-01 | REVERT | later judged a false death-gate trip on a report-only build |
| owner-01 | INCONCLUSIVE | shipped **inert** — ran 97 min as the baseline |
| owner-01b | REVERT | the one genuine result: a real linked death |
| leaf-01 | REVERT | **measured today at p = 0.413** — a coin flip |
| digwatch-01 | superseded | — |
| digwatch-02 | KEEP | an instrument; changed no behaviour |
| leaf-02 | live | — |

Two fleet-wide ships: `8d6f6f7` is behaviourally byte-identical, and `7dd3775`
was shipped explicitly unvalidated at 1.2% measured exposure.

**So yes — the failure mode CLAUDE.md names is happening.** Both engines said so
independently. The file's own words: "being right is not the constraint, and
treating better grounded as progress is how a month goes by with the endpoint
flat."

---

## 2. Are we headed in the right direction?

**The layer is right. The unit of attack is wrong, and leaf-01 is the experiment
that proves it.**

Wood is correctly identified as the root of the chain: 41.9% of all gathers ask
for a log, **12.4% of them succeed**, and everything downstream — sticks, planks,
wooden pickaxe, stone, cobblestone — is gated behind that.

But leaf-01 halved the refusal it targeted and the freed attempts **did not
become successes**. Canary vs control, pre vs post:

| failure class | DiD |
|---|---:|
| `unreachable` (every candidate buried) | **−8.9 pp** |
| `no_safe_target` (liquid / falling block) | **+13.6 pp** |
| `no_path` | +3.2 pp |
| gather success | **−5.0 pp** |

Mass moved between refusals. Buried refusals fell 1.69/bot-h — the mechanism
worked — and no extra wood arrived. **Refusal classes behave like a conservation
law here: the binding constraint is not which filter refuses, but that the
candidate set surviving *all* the filters is empty in this terrain.**

Picking filters off one at a time, one canary per week, through a noise floor
five times the signal, is a local optimum that has already been demonstrated to
be one.

**Prediction, stated so it can be scored on 27 Sep:** un-reseeded gather success
19–22%; the all-pool headline 23–26%, carried by the two fresh worlds; the 40%
gate fails; items/bot-h inside the 2.36x drift band. Flat.

---

## 3. What we have missed

### 3a. The canary is not a viable instrument at this fleet size

Measured today: the placebo null for the 2-pool, 180/180, acquired-logs-per-
bot-hour DiD is **median +0.00, sd 3.00, p5 −4.49**, against a canary-arm
baseline of **0.64**. Doubling the canary arm's wood output is a **0.21 sigma**
effect. The instrument cannot see the thing it was built to see.

Codex computed what "just wait longer" costs: reducing sd from 3.00 to 0.64
needs roughly **22x** the exposure — about 66 h pre + 66 h post, ~7,920 measured
bot-hours — and an effect of one sigma still is not strong detection.

What is actually available:

| option | buys | costs |
|---|---|---|
| **k=20 (4 pools/arm)** | 1.9x sd improvement — already measured, already in `drawrec.sh` | a third of the fleet per canary; thinner control |
| **Per-run randomisation** | n goes from 10 bots to ~35,000 gather runs/day; confounding removed by randomisation | only valid where there is no carry-over — and the persistent avoid rule **is** carry-over, so it must be neutralised for the arm |
| **Sandbox gather corpus** | n≈1,000 attempts in minutes at **zero fleet-hours** | establishes mechanism, not fleet generalisation |
| longer windows | — | measured useless; differential drift grows with the window |

**The sandbox point is the sharpest.** The rig exists — real server on
10.0.0.30:25599, RCON fixtures, scripted brain — and its corpus covers pockets,
lava, ledges, entombment, buried ore. **It has no tree or water fixture at all.**
The standing objection ("the sandbox refusal floor is ~3x too tight live") argues
against calibrating *thresholds* there. It does not argue against *ranking and
killing candidates* there. That distinction has never been drawn, and drawing it
is the highest-leverage apparatus change available.

### 3b. One change for both refusal families

The two dominant classes share a root: `gather` builds its candidate set with
predicates borrowed from a *mining* context and applies them to *above-ground
trees*.

- `isExposed` counts any non-`empty` boundingBox as occluding. `oak_leaves` is
  `'block'`, so a trunk inside its own canopy reads as buried → **`unreachable`,
  32.0%**.
- `dontCreateFlow` refuses any target with liquid on any of five faces →
  **`no_safe_target`, 37.3%** — and the `veto_faces` instrument says **43.1% of
  those refusals are side-water-only with 0.0% lava**.

Neither rule is about wood. Breaking a log beside a pond does not flood an
excavation. The honest version is one bounded tree-harvesting routine — choose a
log, take a dry stance, clear foliage, break, **recover the drop** — with the
flow veto relaxed only inside it, for targets at or above foot level with no
liquid overhead and a dry standing cell, and with lava, falling-block and
overhead-water protections untouched.

**leaf-02 cannot do this.** It still filters its foliage candidates through the
same `safeTarget`, so it addresses `unreachable` and leaves `no_safe_target`
alone — and the conservation law above says that is exactly the shape that moves
mass without moving wood.

Two guardrails, both from prior measurements here: do not simply disable
`dontCreateFlow` (an earlier unsafe-approach exposure cost five deaths in 14
bot-hours), and **43.1% is a share of candidate refusals, not of failed runs** —
multiplying it by 37.3% would not give a defensible estimate.

### 3c. Which layer is the bottleneck

The skill layer, and we are attacking it — **69.3% of log gathers die in
`gather`'s candidate filter**, before the pathfinder is asked anything;
`no_path` is only 8.0%.

One correction to both engines' framing, verified today: `COLLECTBLOCK_ENABLED`
is unset in every env file, so `mustCollectManually` is true for every block and
**every gather digs raw and delivers through `pickupNearbyItems`**. Blaming
mineflayer-collectblock is wrong — that path is off.

But the uncomfortable answer is that **the world outranks all three layers**, and
the re-seed measurement is the evidence. The reliability program's own step 4 —
a deterministic gather→craft→smelt→mine→deposit worker with the model off the
tick — is the thing that would make bots robust to a degraded world. It was
committed 13 Sep and has not been started.

### 3d. "One canary at a time" is not the binding constraint

Concurrency was correctly rejected (~2% worse sd for twice the experiments). The
binding constraint is that **a slot currently yields close to zero bits**. An
inert deploy, a 15-hour unread run, a 43.3% false-revert rate: the slot is wasted
before concurrency matters.

Unrelated: step 1 of the reliability program set the acceptance criterion "no
fleet change without corpus evidence." Eight days in, every fleet change has gone
without it.

---

## 4. How this project is most likely fooling itself

Both engines converged on the same answer, in different words.

**It is treating a more defensible experiment as evidence of a more capable
bot — and the apparatus is believed to be converging when what it is actually
doing is discovering, one instrument at a time, that it cannot see.**

Two gates calibrated, three instruments corrected, five stale detectors caught, a
null band established. That reads like an apparatus getting sharper. Measured
against its purpose, the thing it was built to measure has sat at ~19–21% on the
un-reseeded fleet all week.

The sharper form of it: a recorded verdict is being treated as knowledge when the
verdicts are coin flips. `leaf-01 REVERT` was cited as a settled fact for two
days before anyone checked it, and it shelved a hypothesis whose mechanism half
demonstrably worked. A null costs a slot; **a false negative recorded as a
verdict costs the slot and deletes the hypothesis.**

And the response to "our threshold was invented" was, initially, to invent
another one. Codex caught that leaf-02's deciding line
(`cover_productive_share >= 0.05`) measures a *conjunction* — break a covered
log AND deliver its drop — whose second half runs through `pickupNearbyItems`,
which this same document names as broken. Reading a near-zero as "the leaf idea
is finished" would have been invalid, and it was pre-registered, which is worse.

**That reading was withdrawn at 20:25Z, before any read verdict existed.** The
registration now says a near-zero licenses exactly one conclusion: *this
fallback, with this delivery path, does not deliver wood.*

The question none of this week's precision has answered, and the one that
matters: **does a wood-starved bot get wood, make a usable tool, and resume
productive work?**

---

## What changed today as a result

1. `leafnull.py` — the placebo null band for the canary endpoint itself.
2. `canary-gate-calibration-2026-09-21.md` — leaf-01's revert retracted as
   evidence; scope checked across all 12 registrations (it is the only one).
3. `leaf-02` deployed on a **within-canary binomial**, not a DiD, with the DiD
   demoted to a placebo-calibrated safety tripwire at p5.
4. The canary loop's draw grep was matching wording `drawrec.sh` no longer
   emits — it would have waited forever. Fixed; an orphaned `sleep` holding the
   lock fd was also found and cleared.
5. `pickup-sweep` (8f3ece0) — one unreachable drop no longer abandons the sweep.
   8.8% of all gathers across 77 of 80 bots. **Not deployed**: leaf-02 holds the
   slot and shipping fleet-wide would move the control arm under a live read.

## Recommended next, in order

1. **Build the tree/water sandbox corpus.** Zero fleet-hours, n≈1,000, and it
   ranks candidates instead of spending a week per guess.
2. **Ship `pickup-sweep`** the moment leaf-02 is read and torn down.
3. **One bounded tree-harvesting routine** — foliage exposure *and* a scoped
   flow-veto relaxation *and* drop recovery, in one commit, pre-registering the
   conservation-law rival: if the mass moves to `no_path`, the idea is dead.
4. **Move skill-local changes to per-run randomisation.** n=35,000/day instead
   of 10 bots. Requires neutralising the persistent avoid rule for the arm.
5. **Take the re-seed result seriously.** 13.0% → 39.6% on identical code is the
   largest effect this project has measured. Either world degradation is the
   dominant term — in which case the deterministic worker of reliability-program
   step 4 is the real work — or it is not, and that needs measuring rather than
   footnoting.
