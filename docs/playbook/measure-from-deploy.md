# 11 · Measure from the deploy

## The brief

Three times in one week, the same analyst (me) reported results from a time
window that didn't line up with when the fix actually went live — comparing
"before" data that included some after, or "after" data that started before
the deploy finished rolling out. Each time the conclusion flipped once the
window was cut correctly.

And a clean window isn't enough. A fix can be deployed and running yet
never *exercised* — a gathering fix on bots that spent all night stuck
underground has an exposure count of zero, and "zero incidents" means
nothing. Two questions, always, before any verdict: **Is my measurement
window strictly after the deploy timestamp? Did the code path actually run,
and how many times?** "0 OOM kills" is noise; "0 OOM kills across 76 gathers
by all 10 bots" is evidence.

## The deep end

### The scar

Three windowing errors during the OOM hunt and its verification — reporting
improvement from windows that straddled deploys, retracted after re-cutting.
The exposure lesson came the same week from its near-miss: the collectblock
verification was only credible because we confirmed 76 gather invocations
across all 10 bots inside the clean window. Related instrument scars that
sharpened the discipline: the "0 gather attempts" alarm that was actually a
grep-format artifact (verify the instrument before the finding), and the
llm.endpoint field that logged a config constant rather than the serving
host — the metric *existed* and measured nothing (fixed to report actual
`servedBy`, then nearly un-fixed by a well-meaning `?? baseUrl` fallback:
a metric that can't be null can't tell the truth).

### The rule

- Verdict windows start at the deploy timestamp — of the *last* instance to
  converge, not the first. Mixed-version windows are discarded, not caveated.
- Every "the fix works" claim carries an exposure count: how many times the
  fixed path executed, across how many agents.
- Deploys are declared before restart (manifest updated first) — partly
  fleet-tripwire hygiene, but equally so analysis can trust deploy times.
- Instrument checks precede findings: a surprising number is first a
  question about the measurement, then a question about the world.

### Why it's true

Continuous systems have no natural experiment boundaries — every analysis
window is an *assertion*, and asserting it wrong silently converts noise
into narrative. Exposure is the statistical power of the window: without the
denominator, absence of failures is indistinguishable from absence of
attempts. Both errors produce confident, wrong, *plausible* reports — the
kind that get acted on.

### How it shows up per game

- **Minecraft** (practiced): srcDigest convergence checks before windows
  open; per-bot craft/travel tables as exposure evidence in every status
  report.
- **TrackMania**: same-seed discipline is the windowing (coached vs uncoached
  compared only across identical seeds/budgets), and exposure = environment
  steps actually spent in the drilled segment — a drill that never engaged
  its corner proves nothing.
- **BAR**: game-version pinning is the window (a balance patch mid-block is
  an undeclared deploy by the upstream project — pattern 12's freeze extends
  to the game bundle); exposure = matches in which the changed tier actually
  fired, since a tier-4 change exercised 3 times in 50 matches has no verdict.

### The prediction

The first false "improvement" reported on any new platform will trace to a
window/exposure error, not a data error — because new harnesses generate
sparse data, and sparse data plus eager windows manufactures results. The
checklist ("window after deploy? exposure counted? instrument verified?")
catches it for the cost of three questions.

### The record

- **2026-08 · Minecraft**: violated three times, formalized, then held —
  the collectblock verification is the template.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
