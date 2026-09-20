# Status — 2026-09-20 (daily session)

Clock from `date -u`. Session opened 11:08Z, a fresh rotation with no memory of yesterday beyond STATE.md.

## The session opened on an open loop that nobody was watching

STATE.md (the mcai-rl02 copy) was stamped 19 Sep 16:00Z and said the live canary was `digwatch-01`. The
manifest said something else: **`digwatch-02` (cfc1c58) on board-d,placebo-d, declared 19 Sep 20:09:38Z**.
The repo copy of STATE.md, committed at 20:45Z as `c0a00a1`, was the current one — **the two canonical
copies had diverged, and the daily task reads the stale one first.** Both are rewritten today.

**The canary loop was dead.** `~/canary-loop-digwatch-02.out` contains one line — `loop digwatch-02 sha
cfc1c58 resumes from phase: none` — and the journal has `preflight-ok` and `draw` at 16:41Z and nothing
after. The deploy at 20:09:38Z went through `fleet-deploy` by hand; no loop ever attached to it. So the
canary ran **15 hours against a 420-minute deadline** with no read taken and no decision recorded.

The tier-1 analyst caught this correctly and was ignored, because nobody was in session: its 11:00Z verdict
paged `Rule 5: ... declared 890 minutes ago and has no recorded read`. That is the two-part OpenLoop test
(queue item 14) working by accident — the deadline half fired even though the `pgrep` half is not built.

### digwatch-02: KEEP, promoted fleet-wide

Read by hand at the registered final minute. `immobiledid.py 360` and `depositread.py 360` reproduce the
registered +360 window from `declared_at` (`W = min(elapsed, argv[1])`), so this is the registered read
taken late, not an improvised one.

`VERDICT KEEP (+360)`. Deaths are the only gate on this registration (no productivity gate; the
`decisions/bot-hour` guard was removed prospectively before deploy). **Death gate HELD under v21**: 3 canary
deaths in 60.0 bot-h (0.050/bh) vs 9 control in 300.0 (0.030/bh) — ratio 1.67x, lower 95% bound 0.39x,
short of 1.25x. I checked the long window too rather than hiding behind the registered one: over the full
902 minutes it is 5 deaths / 150.7 bot-h vs 21 / 1054.7, **the same 1.67x**, lower bound ~0.6x. The gate
holds either way; the registered window is not flattering it.

**The hand-read was the point of this canary and it passed.**

- Not blind, with the negative control the registration asked for: **77 canary `Digging aborted` details ->
  15 `_dig_collision` rows**; control **825 aborts -> 0 rows**, because the recorder only exists on the
  canary. v1 died on exactly this check (4 aborts, 0 rows).
- Capture is 15/77, consistent with the documented 60 s per-bot throttle — the row names the caller, the
  detail string still does the counting.
- **Three callers, and one dominates:** 13/15 `digging.js:187 <- skills.mjs:169` (`watchDigging`), 1
  `reflex.mjs:4601` (the concurrent digger, which v1's silence had wrongly retired), 1 `index.mjs:531`.
- **15 of 15 had a harvesting pickaxe in inventory while holding the wrong block.** Every single recorded
  collision is the CLAUDE.md refusal-without-a-remedy class: the remedy was in the bot's pocket and the code
  aborted instead of equipping.

Recorded KEEP with `check-open-loop.py --record` **before** touching the manifest, then promoted via
`~/bin/fleet-deploy cfc1c58 digwatch-02-promote`. A fleet deploy tears the drop-ins down first and rewrites
the manifest (`deploy-fleet.sh:142-146`), so all three teardown steps are covered by the promotion itself.
Verified after: **80/80 bots on `cfc1c58`, one version**, `canary_pool` empty, ledger clear, canary tree
empty. `origin/main` fast-forwarded b1659c0 -> cfc1c58 with **`main-pre-2026-09-20`** pushed at b1659c0.
Journal and page lines written by hand, since the loop that normally writes them was gone.

My counts of aborts and collisions come from a single non-rotation-aware `Events.load` and are **floors**;
the gate numbers come from the read scripts, whose loader walks the `.gz` generations.

## The seed canary's +24 h read, both pools — and it is the biggest number of the week

Full read: `seed-canary-24h-2026-09-20.md`. The registration had **no standing script**; `seedread.py`,
`seedtraj.py` and `seedfails.py` were written today and live in `~/mcai-analysis`.

**Gather success DiD +29.1 pp (placebo-a) and +30.1 pp (placebo-b).** Two independent pools on two
independently drawn seeds, agreeing to within 1 pp, on the only committed program metric that is failing
(fleet 19-22% against a >=40% gate; the re-seeded pools read 41.6% and 43.1%).

The +24 h read **cannot attribute this to the seed** — the registration named the reseed-plus-reset confound
in advance. But the two hypotheses differ in shape, and that test does not have to wait: a fresh-start
effect decays, terrain is flat. **Neither pool decays over 24-30 h and placebo-b rises** (+10.8 -> +30.0 pp).
That rules out the short transient, not a multi-day one.

Stock agrees at +24 h (+13.6, +13.1/bot-h) and **disagrees in trajectory** — placebo-a decays 23.5 -> 4.5
while placebo-b rises. The agreement is an artefact of averaging; stock is not a finding. Iron-pickaxe share
moves in **opposite directions** in the two pools and is noise.

### The composition says the problem is not the one queue item 3 describes

Per bot-hour, since each pool's T0:

| outcome | reseeded /bh | control /bh | |
|---|---|---|---|
| SUCCESS | 7.55 | 3.41 | 2.2x |
| no_safe_target | 1.19 | 3.85 | **-69%** |
| unreachable | 3.15 | 4.90 | -36% |
| no_path | 3.20 | 2.71 | +18% |
| nothing_found | 1.82 | 0.99 | +84% |

Attempt rates are comparable (18.0 vs 16.7 terminal/bot-h), so this is not just more tries. The fresh worlds
are **not uniformly easier** — `no_path` and `nothing_found` got worse. The whole gain is two classes, and
the larger, `no_safe_target` at -2.66/bot-h, is **by queue item 3's own definition a safety refusal that it
explicitly excludes from its denominator**. Item 3 frames the problem around `mineflayer-pathfinder`.

Hypothesis, not result: on a mature world the bots stand in terrain they themselves dug and flooded, the
safety check correctly refuses targets in it, and that refusal is the largest single component of the gather
collapse. `nothing_found` rising on fresh worlds argues against plain resource depletion. This is a build
candidate and goes to the registered dual review before anything is proposed.

## Housekeeping

- Queue 13 done: `~/mcai-analysis/registrations/exptest.json` deleted.
- Rule files checked per the standing wake-up and **both are current** — `~/digest/RULE.md` md5-matches
  `docs/reports/recovery-ladder-registration.md`, and `RULES-IN-FORCE.md` matches `scripts/host/`. No rule
  changed today, so no sync.
- Fleet at 11:30Z: 80 bots, one version, 2 deaths in 2 h (0.012/bot-h), 3 immobile, no open loop.

## An error I made

My first capture query returned `0 aborts, 0 collision rows` on **both** arms while reporting 366k rows
loaded. I treated it as my bug rather than a finding, which was right: `Events` rows carry `r['t']`,
`r['name']` and `r['raw']`, and I had reached for `r['ts']` and `r.get('skill')`. **A cheap negative from a
hand-rolled query, which is the exact failure CLAUDE.md opens with** — and the only reason it did not become
a finding is that the positive-control line was printed first and said 366k rows across 80 bots. `seedread.py`
and `seedfails.py` were written with that refusal built in: they exit non-zero rather than print zeroes.

## Two things the next session should not have to rediscover

1. **The two STATE.md copies diverged and the daily task reads the stale one first.** Today's rewrite goes to
   both, but the ordering in the task file should prefer whichever is newer, not a fixed path.
2. **A hand deploy leaves no loop.** `fleet-deploy` does not start `canary-loop.sh`; yesterday's session
   deployed digwatch-02 and never attached one, and the only thing that noticed was the analyst, 15 hours
   later. Either `fleet-deploy --pool` should start the loop or it should refuse to declare a canary without
   one. Queued as item 18.
