# The canary endpoint, not the canary design, is the noise floor

2026-09-19, measured on 10.0.0.31. Every number below comes from a **placebo
difference-in-differences**: fake canaries on historical windows where nothing
was deployed, so the true effect is zero by construction and every reported
number is noise. Windows overlapping a real canary (12 h before each ledger
decision, per pool) are excluded.

Scripts: `~/mcai-analysis/halfdid.py`, `sweep.py`, `endpoints.py`, `candidates.py`,
`halfmix.py`.

## Positive controls

A null study that cannot see a difference proves nothing, so three gates:

1. **The aggregator matches the live instrument exactly.** Item totals per pool
   over an identical window with an identical version filter match `poolrank2`
   on all 12 pools. The first attempt did NOT match -- up to 48% out -- because
   `poolrank2` uses an unrounded `now - 120min` and my aggregate rounded to the
   hour. Two instruments reading two windows say nothing about either.
2. ~~**A planted effect is recovered.**~~ **RETRACTED 2026-09-19, same day.**
   This control multiplied the canary post window by 1.30 and checked the
   estimator returned +30.0%. Codex pointed out that for a ratio estimator this
   is the identity `log(f*R) - log(R) = log(f)`, and the measurement agrees:
   across f in {1.05, 1.30, 1.77, 3.50, 0.40}, the spread of the "recovery"
   across 162 fits was **7e-16 every time**. It could not fail and it validated
   nothing. Every "planted +30% -> +30.0% ok" in the tables below is arithmetic,
   not evidence, and none of them should be read as validating an endpoint.

   Its replacement (`~/mcai-analysis/realcontrol.py`) attacks the DENOMINATOR
   instead, which the multiplicative injection never touched: drop one canary bot
   from the post window and require the estimate not to move, with a mutant that
   assumes a fixed pool size of 5 and must be caught at log(4/5) = -0.223.
3. ~~**The result reproduces a known quantity by another route.**~~
   **WITHDRAWN.** I claimed exp(0.83) = 2.3x corroborated the 2.36x between-pool
   noise band in CLAUDE.md. Exponentiating a log-SD is not automatically the same
   quantity as that band, whose quantile basis is unspecified. It is a numerical
   coincidence I presented as independent validation.

## Finding 1: the endpoint dominates everything else

3h/3h placebo windows, 5 days, identical cuts for every row.

| endpoint | 1 pool | 2 pools | 4 pools |
|---|---:|---:|---:|
| items / bot-hour (sum) | **0.70** | 0.51 | 0.41 |
| items winsorised at 20 | 0.65 | 0.47 | 0.38 |
| log1p items | 0.58 | 0.43 | 0.35 |
| productive runs / bot-hour | 0.53 | 0.39 | 0.32 |
| **decisions / bot-hour** | **0.10** | **0.07** | **0.05** |

As a minimum detectable effect at 80% power, two-sided 5%:

| endpoint | 1 pool | 2 pools | 4 pools |
|---|---:|---:|---:|
| items / bot-hour | 615% | 318% | 217% |
| productive runs / bot-hour | 343% | 201% | 145% |
| decisions / bot-hour | **32%** | **22%** | **17%** |

**Our KEEP gates ask for +30%.** On items/bot-hour that is unreachable by a
factor of 7 even with four pools. This is a sufficient explanation for the
season's INCONCLUSIVE rate without any story about the fleet, the worlds, or the
changes being too small.

## Finding 2: my first explanation was wrong

I proposed that items/bot-hour is noisy because it is a **heavy-tailed sum** (one
row can carry 91 bamboo) and that counting instead of summing would fix it. The
transform ladder above refutes the strong form of that: winsorising at 20 moves
sd 0.70 -> 0.65, and a pure count of productive runs only reaches 0.53. The tail
is real but it is a minority of the variance.

What remains is that **whether a bot gathers at all in a 3-hour window is
genuinely variable**, and no transform of the gather signal rescues it at this
scale. To reach sd ~0.094 (a 30% MDE) from 0.41 at four pools would need roughly
19x more pools than the fleet has.

## Finding 3: pool count is the only design lever, and time is not one

| window | 1 pool | 2 pools | 4 pools |
|---|---:|---:|---:|
| 3h | 0.71 | 0.51 | 0.42 |
| 6h | 0.67 | 0.55 | 0.53 |
| 12h | 0.69 | 0.55 | 0.60 |
| 24h | 0.36 (n=95, unreliable) | no clean windows | no clean windows |

Pools help; hours do not. Under DiD a persistent pool difference cancels, so what
is left is **differential drift**, which grows with window length and offsets the
averaging. At 24h with 2+ pools there are **zero** placebo windows free of a real
canary -- long multi-pool reads are currently impossible without pausing the
program.

**This says the approved concurrent-canary work is aimed the wrong way**:
concurrency makes each canary *smaller*, and pool count is the only thing that
reduces noise.

## Finding 4: the inference half was holding nothing constant

`drawrec.sh:72` admitted only 5080-half pools, making 3 of 12 permanently
control. The live harness env shows every pool lists **both** endpoints in
`OLLAMA_BASE_URLS` with the same `qwen2.5:7b-instruct` on each; the half names
only which is tried first.

| canary drawn from | n | null sd | null median |
|---|---:|---:|---:|
| 5080 half (allowed) | 231 | 0.89 | -8.6% |
| 3090 half (banned) | 129 | 0.70 | +0.2% |

2-pool canaries by half mix:

| canary halves | n | null sd | null median |
|---|---:|---:|---:|
| both 5080 | 1057 | 0.56 | -1.5% |
| one of each | 1476 | 0.50 | -0.3% |
| both 3090 | 312 | **0.47** | +1.5% |

The forbidden configuration is the best-behaved. The half term was dropped and is
now recorded as a read covariate. `digwatch-02` (cfc1c58) deployed 20:09:38Z on
board-d + placebo-d under the new rule; split verified 70/10, exposure 0.93
dig-aborts/bot-hour at deploy.

**The band stays.** It buys almost nothing on spread (0.81 inside vs 0.84
outside) but removes a -10% median bias -- regression to the mean.

## What I am NOT yet willing to conclude

`decisions/bot-hour` is quiet because it is **cadence-bound**: a 30 s decision
cooldown makes it close to a clock at ~40-50/bot-h. Low variance earned that way
may mean it is a good *instrument check* and a poor *proxy for anything we care
about*. Switching the gates to it could buy readability by measuring something
that cannot move for the reasons we want to detect. That objection is the main
thing this review needs to settle.

## Proposed change, for review

1. Canary gates move to **mechanism and harm endpoints** (event counts, refusals,
   deaths) plus `decisions/bot-hour` as a **guard against breakage**, not as a
   success criterion.
2. `items/bot-hour` is **reported descriptively and never gated on**. Where a
   productivity number is wanted, `productive runs / bot-hour` replaces it as the
   better-behaved of the gather-side options.
3. **Productivity is read fleet-wide over weeks**, not per canary -- the 24-27
   Sep two-week window, not a 3-hour pool read.
4. The **concurrent-canary tripper work is dropped**; if anything, canaries get
   *more* pools each.


---

# Two-engine review outcome, 2026-09-19

**The proposal above did not survive.** Codex reviewed it adversarially and
refuted four of its five conclusions. Recorded here in full because the report
was published before the review, and a corrected record is the only useful kind.

## Refuted

**Dropping concurrency (Finding 3's corollary) -- my reasoning was wrong.** I
claimed concurrency makes each canary smaller. It does not; it shrinks the
CONTROL set. With 12 pools, two simultaneous 2-pool canaries leave 8 shared
controls: variance proportional to 1/2 + 1/8 = 0.625 against 1/2 + 1/10 = 0.60
sequentially. **~2% worse SD per experiment for twice the experiments.** The
strongest surviving case for concurrency is parallel evaluation of distinct,
exposed mechanisms with fixed canary sizes -- which the shift toward mechanism
endpoints would strengthen, not weaken. Concurrency is NOT cancelled on this
report's evidence.

**"The inference half is not a confounder" -- REFUTED.**
`bots/src/llm.mjs:430` `EndpointPool.available()` preserves preference order
among healthy endpoints, so the primary really does serve under normal
conditions. Both URLs being listed means fallback capability, not equal GPU
exposure, latency, queueing or timeout rates. Shared inference also permits
interference: a canary can change control latency through the shared queue. And
"both 3090" (n=312) is drawn from 3 pool pairs over overlapping windows -- the
effective sample size is nowhere near 312. Recording the half "as a covariate"
is not an adjustment, and the served endpoint may itself be treatment-affected.

**"Time is not a design lever" -- UNVERIFIED, plausibly a selection artifact.**
The duration sweep changes window length AND which windows survive the
contamination filter. Longer windows overlap more real-canary spans, so
survivors are a selected minority; selection alone can invert the comparison.
The fix is to restrict the 3/6/12 h comparison to the pool sets and timestamps
eligible at 12 h, with control membership held fixed.

**"True effect is zero by construction" -- UNVERIFIED.** The contamination rule
("12 h before a ledger decision") is not the actual deployment interval. It can
miss early exposure, post-decision continuation, fleet promotion, and persistent
changes to inventories or worlds. Controls must be clean too.

## The endpoint argument, corrected

My stated worry -- that `decisions/bot-hour` is pinned by the 30 s cooldown -- is
**wrong on the code**. `cognitive.mjs:588` awaits admitted skills and `:846`
schedules the cooldown at cycle END, so 30 s implies a 120/h ceiling, not 40-50.
The cooldown is ~33-42% of cycle time; the metric has real dynamic range.

The actual defect is worse and I missed it: **the direction is ambiguous.**
Longer productive skills LOWER decisions/hour; fast failures RAISE it. And
`cognitive.mjs:561` counts synthesised work orders and rejected LLM results as
decisions. It is not a productivity proxy in either direction. It may be a useful
*operational guard* after separate validation; it is not a success criterion.

**Comparing MDEs across endpoints with different natural effect scales is not a
quality ranking.** The correct comparison is detection rate at a matched
false-alarm rate against several independently established interventions,
covering both harmful and beneficial directions -- i.e. labelled historical
experiments, not null variance.

**leaf-01 is a direct counterexample to "gate on mechanism and harm only":**
mechanism improved, deaths did not worsen, and acquired wood collapsed. Under the
proposed policy that change ships.

## Arithmetic corrections

- "19x more pools than the fleet" should be 19x the FOUR-POOL canary, ~76 treated
  pools; and the extrapolation ignores shrinking controls and correlation.
- "+30% is unreachable" is wrong as stated: an 80%-power MDE is not a threshold
  below which detection is impossible, it is the point of reliable detection at
  chosen error rates.
- MDEs computed for an increase do not calibrate a guard against a decrease: at
  sd 0.10, the same log magnitude is +32% up but -24% down.

## What survives

Only this: **`items/bot-hour` is very dispersed at canary scale** (sd 0.70 at one
pool, 0.41 at four), measured directly and not dependent on the retracted
control. The draw-filter decomposition also survives -- it is counting, not
inference. Nothing else in this report should be acted on as written.
