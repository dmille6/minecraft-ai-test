# ADR-0003: Learn from durable value, not from calls that return cleanly

**Status:** accepted, not yet implemented
**Date:** 2026-08-06
**Prompted by:** cross-model review (ChatGPT via codex CLI), one night of fleet data

## Context

The agents' persistent memory (`lessons.mjs`) records `recordSuccess(skill, args)`
and `recordFailure(skill, args, failClass, pos)`. Successes are fed back into the
prompt as `"<skill> has worked Nx — a reliable choice"`.

Scout01 discovered that the `status` skill always succeeds. It called it 17
times. Its memory now reads `status has worked 18x — a reliable choice`, and
that line is injected into its next prompt. The learning layer rewards actions
that **return cleanly**, with no notion of whether anything was **accomplished**.

An external review named the underlying flaw more generally than the symptom:

> Without [state-delta value], your learning layer is not learning usefulness.
> It is learning which calls return cleanly. Any low-risk, low-effect action
> will become attractive. Any necessary but failure-prone action will be
> punished. The agent will drift toward procedural comfort instead of task
> progress.

That is correct, and it is measurable. Of 313 reported successes across the
fleet, **144 (46%) moved the bot zero blocks and changed no inventory**:

```
status=70   goto=35   eat=33   mine=4   place=2

reported success rate  25.8%
excluding no-ops       13.9%
```

Every success metric quoted in this repo before 2026-08-06 is inflated by
roughly 2x.

## Decision

Separate **reliability** from **value**. A skill call yields two distinct facts:

- `status` — did the call complete? Admission-control data.
- `value`  — did it change the world durably? Policy data.

`recordSuccess` becomes value-aware. Memory lines become e.g.
`status: reliable (18/18) but median value 0 — only useful when local state is
stale`, never `worked 18x — a reliable choice`.

The rule, stated so it needs no blacklist of "real" skills:

> A successful action with no meaningful state delta is not reinforced as
> progress. It may be reinforced only as a diagnostic action under uncertainty.

## The data already exists

This is cheap. `skill.distance_moved` is populated on 1210/1210 real skill
records and `skill.inventory_delta` on every record where inventory changed.
Both are written in the same code path as `recordSuccess`, which ignores them.

## Correction to the reviewer's framing

"Zero measured delta" is not "zero value". `eat` restores hunger and appears in
the no-op bucket purely because our instrumentation tracks inventory and
position but not health or food. A utility function built only on inventory and
distance would **punish eating**, which is survival behaviour.

So the value signal must include, at minimum:
milestone progress · durable inventory · durable world change (blocks placed) ·
health and food recovery · information gain when state was stale · minus time,
damage, and repeated-no-op cost.

## Consequences

- Every historical success rate in this repo needs the 2x caveat attached.
- `status` stays available; it stops being reinforced as achievement.
- Skills that are necessary but failure-prone (`goto` in forest) stop being
  penalised relative to safe no-ops.
- Requires a post-skill evaluator. Not yet written.
