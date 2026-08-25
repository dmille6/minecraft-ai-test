# Events are not time

**2026-08-25.** "Water is 51% of the fleet's events" has been the load-bearing
number in every argument about the water subsystem this week. Two reviewers
disagreed about what it meant — I said mostly telemetry artifact, ChatGPT said
artifact *and* real cost — and **neither of us had measured it.**

Now it is measured. `scripts/wall-clock-states.py`.

## The answer

| | bot-hours | share |
|---|---|---|
| reflex-owned | 60.2 | **25.2%** |
| skill-active | 48.5 | 20.3% |
| …of which overlap | 14.2 | 5.9% |
| **busy (union)** | 94.5 | **39.5%** |
| **not busy** | 144.5 | **60.5%** |

**Water is 51% of events and about 25% of time.** The event ratio inflates by
roughly 2×, which is structural: the reflex logs per 500ms firing and a gather
logs once per attempt. So I was wrong to call it *mostly* artifact, and ChatGPT
was right that it is both.

## The number nobody was arguing about

**60.5% of wall clock, a bot is doing nothing** — not under the reflex, not
inside a skill. That is larger than water and pathfinding combined, and it is
the biggest single sink in the system.

It is idle by construction: at a 33-second cadence with a median skill duration
of 8 seconds, a bot acts for about a quarter of each cycle and waits for the
rest. Skills report `duration_ms` on **100%** of records, so this is not a
telemetry hole.

This is the empirical case for a tactical layer. That 60.5% is precisely the
time no layer owns — the 500ms reflex only wakes for emergencies and the 33s
planner is asleep. Questions like *am I still making progress, is this target
still reachable, should this skill be aborted* have nowhere to live.

It is **not**, on its own, an argument for a faster decision loop. Block 1
measured actions per hour flat at 46–65 across a 44× productivity range: the
difference between good and bad bots was allocation and execution, not
throughput. More decisions into the same idle would not obviously help.

## The contention number, independently

**The reflex seizes a bot mid-skill for 29.3% of all skill-active time.**

That corroborates a separate measurement made a different way: skill attempts
that overlapped a reflex event succeeded at **0.79×** the undisturbed rate
(31.4% against 39.7%). Two independent routes to the same conclusion — the
locomotion arbiter has a real target, and it is about a fifth of skill outcomes,
not a rounding error.

## Method, and why it is trustworthy

`duration_ms` is **zero on every reflex record** — they are instantaneous logs,
so the field cannot be used for ownership time. Intervals are reconstructed from
event pairs instead: a seize (`reflex_drowning`, `oxygen_critical_state`,
`water_surface_hold`, `drowning_reentry`) opens one, a release
(`drowning_escaped`, `_released_timeout`, `_surfaced_stranded`,
`_yielded_to_swim`, `water_surface_hold_ended`) closes it, and repeated seizes
inside an open interval are heartbeats rather than new intervals.

**The data carries its own positive control.** Release events state their
duration in prose — *"released after 23s still in water"* — so the
reconstruction can be checked against the bot's own claim:

```
n=1012   median error 0.3s   within 2s: 82%
```

Reflex and skill intervals are unioned rather than summed, because a reflex
seizing mid-skill would otherwise be counted twice — and that overlap is 5.9% of
the whole clock, so it is not negligible. Review caught this; the first pass
summed them and read 18% instead of 25%.

## What this measurement cannot support

- **2,077 orphan releases against 60 orphan seizes.** Many releases have no
  matching seize in the seize set, so the reflex share is probably an
  UNDERcount. The set of events that constitute a seize is not fully known.
- **17.2 bot-hours (7%) sit in capped intervals** — unpaired seizes closed at a
  300s ceiling. That pushes the other way.

So 25.2% is a central estimate with real uncertainty on both sides, not a
precise figure. What is robust is the ordering: **idle > reflex > skill**, and
water being nowhere near half the clock.
