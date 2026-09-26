# The routing layer counts its own rescue rate and throws it away

Date: 2026-09-26. All figures MEASURED over the last 24 h on the live fleet:
80 bots, 1,919.9 measured bot-hours, one version `efa2853+c7b045`, no canary.

## 1. Routing is now the fleet's dominant failure, and it is not concentrated

Gather failures, 24 h (n=27,225 failed gather attempts):

    unreachable       8612   31.6%   4.49/bot-h
    no_safe_target    8163   30.0%   4.25/bot-h
    no_path           7954   29.2%   4.14/bot-h
    nothing_found     2409    8.8%   1.25/bot-h

Skill success, same window (POSITIVE CONTROL: `status` values present in the
window are success 114,890 / failed 26,054 / no_effect 9,723 / aborted 685 /
unknown 587 / fail 134 / skipped 3 -- an earlier pass of mine filtered on
status=='ok', found 0.0% success for all twelve skills, and that was a false zero):

    gather   35,838 att   19.2% ok   18.67 att/bot-h
    explore  16,633 att   77.5% ok    8.66
    goto     13,613 att   63.9% ok    7.09
    mine      6,620 att   10.6% ok    3.45
    craft     4,119 att   11.3% ok    2.15
    deposit   4,142 att    5.9% ok    2.16

## 2. A* fails 51.9 times per bot-hour, and the shapes are already logged

`_path_failure_shapes` (bots/src/pathbackoff.mjs:126-137) flushes an exact tally
every 60 s. Over 24 h: 29,021 rows, 99,697 summed A* failures.

    disconnected      50,217   50.4%   26.15/bot-h
    budget            30,392   30.5%   15.83/bot-h
    sealed_in_liquid  15,834   15.9%    8.25/bot-h
    no_legal_move      3,254    3.3%    1.69/bot-h

All 80 bots emit them; median 319 rows/bot, top five 862/679/650/635/622. This is
fleet-wide, not a handful of wedged bots.

What the classes MEAN, source-verified at bots/src/pathbackoff.mjs:106-116:
  - `budget`   = status 'timeout'. The search budget ran out.
  - `disconnected` = status 'noPath' with visitedNodes > 1. astar.js returns
    'noPath' only after `while (!this.openHeap.isEmpty())` drains, so this is a
    FINISHED search -- but finished under the movement permissions in force.
  - `sealed_in_liquid` / `no_legal_move` = visitedNodes <= 1, split on startLiquid.

Movement permissions differ per profile (bots/src/index.mjs): general nav
`canDig=false` (:226), gather `canDig=true` (:407), ascend `canDig=true` (:457);
`allowParkour=false` and `maxDropDown=6` in all of them (:252,:267,:408,:410,:461).
So "disconnected" means disconnected UNDER THOSE PERMISSIONS, not in the world.
The event does not record which profile was active. That is an instrument gap.

## 3. THE DEFECT: the Baritone partial-path rescue is unmeasured

`installPathBackoff` (pathbackoff.mjs:140) patches `AStar.prototype.makeResult`.
On 'timeout' or 'noPath' it keeps Baritone's seven-coefficient family
(COEFFICIENTS = [1.5,2,2.5,3,4,5,10], :59) each minimising `h + g/coef`, and
returns the lowest-coefficient candidate that travelled >= MIN_DIST_PATH = 5
blocks from the start (:240-246). If none did, it hands back the library's node
and increments `kept` (:250).

So EVERY ONE of those 99,697 failures/24h goes through a rescue that either
substitutes a partial path or gives up. The counters exist and are correct:

    export const backoffStats = { substituted: 0, kept: 0, byCoefficient: {}, shapes: {} }   // :69

`backoffStats.substituted` / `.kept` / `.byCoefficient` are incremented at
:242, :244, :236, :250 -- and **nothing in production ever reads them.**

VERIFIED: a repo-wide grep for `backoffStats` outside pathbackoff.mjs returns
only `bots/test/pathbackoff.test.mjs` (lines 68,71,97,102,112,129,135,138,143,149).
Tests only. POSITIVE CONTROL, same grep, same flags: `flushPathShapes`,
`installPathBackoff` and `pathFailureShape` all return production hits, and
`shapes` DOES reach the log because flushPathShapes copies the separate `pending`
object. So the grep can find a reader when one exists; there is none for
substituted/kept/byCoefficient.

Consequence: we know A* fails 51.9x/bot-h. We do NOT know whether the bot then
walks 5+ blocks toward the goal (substituted) or stands still (kept). Those two
worlds demand opposite next moves:

  - substitution dominant -> 51.9/bot-h is LOUD, NOT HARMFUL. Routing is working
    by degrees and the real problem is elsewhere (craft 11.3%, mine 10.6%).
  - `kept` dominant -> the bot is handed its own stuck node ~50x/bot-h and
    routing is the substantive problem, with a one-parameter fix available
    (budget, or MIN_DIST_PATH, or per-profile permissions).

And `byCoefficient` says WHICH end of the family wins. Baritone's own source
calls results above coefficient 3 "pretty terrible" (quoted in the comment at
:25-27). If our substitutions are mostly coefficient 10 -- the degenerate
member the comment itself flags -- then "substituted" is not good news either.

## 4. Proposed change (observability only)

Emit the backoff outcome from the flusher that already runs. NEW event kind
`path_backoff`, deltas not cumulative, so a rate is computable; emit nothing when
both deltas are zero; leave the existing `path_failure_shapes` detail STRING
BYTE-IDENTICAL because live readers parse it. Wrapped so it cannot break the
60 s interval or the path it observes. Cumulative `backoffStats` fields must NOT
be reset -- the tests assert `before + 1` against them.

Cost if wrong: one extra event per bot per 60 s at most, and only when the
backoff fired. No behaviour change. Licence class `kind` (baseline silent).

## What I want from you
1. Destroy the section-3 claim. Is `backoffStats` genuinely unread in production?
   Is there a path by which substituted/kept reaches a log or a metric I missed?
2. Is the substituted-vs-kept ratio actually the decisive number for "is routing
   the next problem", or is there a cheaper/better discriminator already in the
   logs? Name it with file:line.
3. Review the proposed change for the ways it could be inert, wrong, or could
   perturb an existing reader. Specifically: is a delta-based emission safe given
   the tests assert cumulative values?
4. Is there a SECOND change worth bundling, or does that break single-variable?
5. What would make you say "do not canary this tonight"?

RULES: every negative claim carries a positive control. file:line for everything.
Distinguish measured / source-verified / inferred. Rank by what a wrong decision
costs. End with ONE sentence: the single most valuable thing to do first.
