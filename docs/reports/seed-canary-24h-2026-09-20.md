# Seed canary, the +24 h read on both pools — 2026-09-20

Registered in `seed-canary-registration.md`. Reader: `~/mcai-analysis/seedread.py` (written today; the
registration had no standing script). Trajectory and composition readers beside it: `seedtraj.py`,
`seedfails.py`. Clock: `date -u` throughout.

**Read this first: the +24 h read cannot attribute anything to the seed.** The registration names the
confound in advance — this is a reseed-PLUS-RESET. The pools' state dirs, inventories, accumulated world
changes and world clock were reset with the terrain and the bots were restarted. The 48 and 72 h reads are
the registered discriminators. What follows is therefore a description of a difference, plus one test of its
SHAPE that does not have to wait.

## The two pools, +24 h, DiD against the fourteen

Treatment is the named pool; control is every pool except placebo-a and placebo-b (the other re-seeded pool
is held out of both arms). bot-hours are OBSERVED (distinct bot x clock-hour cells carrying a row), not
`bots * hours` — both pools were restarted inside their own window by construction, and a nominal
denominator would credit hours they did not run.

| | bot-h | deaths | /bot-h | immob% | gather% | stock/bh | iron% |
|---|---|---|---|---|---|---|---|
| **placebo-a** pre | 125 | 3 | 0.0240 | 4.0 | 13.0 | 8.86 | 19.2 |
| **placebo-a** post | 125 | 1 | 0.0080 | 2.4 | **41.6** | 22.31 | 3.2 |
| control pre | 1250 | 24 | 0.0192 | 5.9 | 20.1 | 5.82 | 18.8 |
| control post | 1250 | 34 | 0.0272 | 9.0 | 19.6 | 5.69 | 20.9 |
| **placebo-b** pre | 125 | 2 | 0.0160 | 2.4 | 10.0 | 1.40 | 0.0 |
| **placebo-b** post | 125 | 1 | 0.0080 | 0.0 | **43.1** | 14.73 | 27.2 |
| control pre | 1250 | 29 | 0.0232 | 7.0 | 18.5 | 5.11 | 19.4 |
| control post | 1250 | 40 | 0.0320 | 7.9 | 21.5 | 5.33 | 21.8 |

DiD, placebo-a then placebo-b:

- **gather success +29.1 pp and +30.1 pp.** Terminal rows 1972->2278 and 1885->2261 against ~20k per arm.
- stock/bot-h +13.57 and +13.11.
- immobile share -4.6 pp and -3.3 pp.
- deaths/bot-h -0.024 and -0.017. **Five bots cannot resolve a rate this rare** — tripwire, not a result.
- iron-pickaxe bot-hour share **-18.1 pp and +24.9 pp**. Opposite signs: this one does not replicate and
  nothing should be built on it. placebo-b's pre-period was 0.0%, so its "rise" is a floor effect.

Two independent pools, two independently drawn seeds, the same effect to within 1 pp on gather and 0.5 on
stock. That is a replication, and it is on **the only committed program metric that is failing** (fleet
19-22% against a >=40% two-week gate).

## The shape test, which does not wait for +48 h

The +24 h number cannot separate "new terrain" from "fresh start". The two hypotheses differ in shape: a
fresh-start effect decays as the pool re-accumulates state and chews up its own surroundings; a terrain
effect is flat. Control is plotted beside it so a fleet-wide drift cannot be misread as decay.

placebo-a, 6-h buckets since T0 (treat gather% / control gather% / gap):

```
 + 0-6 h   40.5  16.7  +23.8      +18-24h   42.0  19.7  +22.3
 + 6-12h   45.3  19.5  +25.7      +24-30h   39.3  22.1  +17.2
 +12-18h   38.5  22.3  +16.3
```

placebo-b:

```
 + 0-6 h   33.6  22.8  +10.8      +12-18h   52.0  22.0  +30.0
 + 6-12h   45.6  18.9  +26.7      +18-24h   46.2  22.4  +23.7
```

**Neither decays. placebo-b rises.** Over the first 24-30 h the gather gap is flat to increasing in both
pools. That does not prove terrain — a fresh-start effect whose time constant is days, not hours, would look
exactly like this, and "accumulated world changes" is precisely such a term. What it does rule out is the
short transient, which was the cheapest available explanation.

**Stock behaves differently and should not be quoted as a finding.** placebo-a decays hard (23.46, 22.26,
15.83, 18.14, 4.51) while placebo-b rises (4.54, 12.71, 16.77, 18.57). The +24 h agreement is a coincidence
of averaging. The decay in placebo-a is consistent with the fresh town's stamped supplies being banked early
and then running out.

## What the fresh worlds actually removed — and it is not what queue item 3 assumes

Composition of terminal `gather` outcomes since each pool's T0, **per bot-hour** as well as share, because a
share moves when nothing does (reseeded 305 bot-h / 5,498 terminal; control 1,800 bot-h / 30,089 terminal):

| outcome | reseeded /bh | control /bh | change |
|---|---|---|---|
| SUCCESS | 7.55 | 3.41 | **2.2x** |
| no_safe_target | 1.19 | 3.85 | **-69%  (-2.66/bh)** |
| unreachable | 3.15 | 4.90 | -36%  (-1.75/bh) |
| no_path | 3.20 | 2.71 | **+18%** |
| nothing_found | 1.82 | 0.99 | **+84%** |

Attempt rates are comparable (18.0 vs 16.7 terminal/bot-h), so the success gain is not simply more tries.

The fresh worlds are **not uniformly easier**: `no_path` and `nothing_found` both got WORSE. The entire
improvement sits in two classes, and the larger of them — `no_safe_target`, -2.66/bot-h — is by the queue's
own definition **a safety refusal, not a reachability failure**. Queue item 3 explicitly excludes
`no_safe_target` from its denominator and frames the problem around `mineflayer-pathfinder`.

The reading this supports, stated as a hypothesis and not a result: on a mature world the bots are standing
in terrain they themselves excavated and flooded, the safety check correctly refuses targets in it, and that
refusal — not pathfinding — is the largest single component of the gather collapse. `nothing_found` rising
on fresh worlds argues against simple resource depletion.

## What is NOT claimed

- Nothing here is attributed to the seed. The registered discriminators are the 48 h (21 Sep) and 72 h
  (22 Sep) reads.
- The sample is seeds **on which the town sites** (amendment of 19 Sep): flat, dry, low relief. One of the
  two seeds drawn hit the rejection. A null later is weaker than it looks; a positive, as here, is not
  weakened by it, but it is a positive about founded colonies only.
- Deaths, immobility and iron are all under-powered at five bots and are reported, not concluded.
- The control set is contaminated in the ordinary way: canaries (2850cde, 1457f3a, cfc1c58) ran on control
  pools inside both windows, and `cfc1c58` went fleet-wide at 11:14:42Z today, 10 minutes before placebo-b's
  window closed. Both readers print the per-pool epochs. The effect is ~30 pp and the canaries were
  behaviour-inert or reverted; this is noted for honesty, not offered as an explanation.

## Next

- 48 h reads: placebo-a 21 Sep 00:00Z, placebo-b 21 Sep 11:25Z. 72 h: 22 Sep 00:00Z / 11:25Z.
- The `no_safe_target` result is a build candidate for queue item 3 and must go through the registered dual
  review (independent Claude and ChatGPT, plus an open-source search) before anything is proposed.
