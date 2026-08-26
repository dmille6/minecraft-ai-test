# The Playbook — what this lab has learned, written to survive the next game

This directory is the lab's cross-game memory. Every page is one lesson that
was paid for in Minecraft — with dead bots, leaked memory, wedged fleets, or
wasted weeks — written down so the *next* platform (TrackMania, Beyond All
Reason, whatever follows) starts from our scars instead of re-earning them.

Every page has two layers:

- **The brief** — plain language, no jargon. If you only read these, you know
  what the lab knows.
- **The deep end** — the incident that taught us, the precise rule, why it's
  true, and how it should show up in each game.

## The loop is the method

This is not a wisdom archive; it's a set of live hypotheses. Each pattern ends
with a **prediction** — a specific, falsifiable claim about how it will
manifest in a game we haven't built yet. When TrackMania or BAR gets built,
each pattern gets a **verdict** section added: held, held-with-modification,
or refuted (with the boundary condition we learned). A pattern that survives
three genres — a survival sandbox, a racing time-trial, and a war game — is a
law of building LLM agent systems. One that doesn't teaches us exactly where
its edges are. Either way the playbook improves.

Minecraft → TrackMania → BAR → back to Minecraft. Take the lessons forward,
bring the verdicts back.

## The patterns

| # | Pattern | One line |
|---|---------|----------|
| 1 | [The evidence gate](evidence-gate.md) | Never learn from an outcome you didn't verify |
| 2 | [The cadence stack](cadence-stack.md) | Reflexes are never an LLM; every tier up trades speed for scope |
| 3 | [One owner per control](control-ownership.md) | Seize, re-assert, release — and never timeout-clear your own controls |
| 4 | [Bounded everything](bounded-everything.md) | A timeout that doesn't cancel is a leak with a friendly name |
| 5 | [The rescue exemption](rescue-exemption.md) | Never let the system learn to avoid its own rescue |
| 6 | [Failure text teaches](failure-text-teaches.md) | The error message is curriculum, not noise |
| 7 | [Boundaries by architecture](architectural-boundaries.md) | Information isolation enforced by code, never by discipline |
| 8 | [Two-clock freshness](two-clock-freshness.md) | Knowledge earns credit from when it was seen, and decays from when it was told |
| 9 | [Earned conclusions](earned-conclusions.md) | "Impossible" is a verdict you must earn, not infer |
| 10 | [Bare-client reproduction](bare-client-repro.md) | Reproduce with a plain client before blaming your own code |
| 11 | [Measure from the deploy](measure-from-deploy.md) | Windows start at the deploy timestamp, and exposure must be confirmed |
| 12 | [The method](the-method.md) | Arms, pre-registration, freeze, and arm-blind hands |
| 13 | [The harness is the contribution](harness-is-the-contribution.md) | Tooling outlives results |
| 14 | [Refused, not unwilling](refused-not-unwilling.md) | Count the agent's attempts before believing it chose not to |

## House rules for this directory

- **Amend, don't rewrite.** When a game tests a pattern, add a dated verdict
  under "The record"; leave the original scar and prediction intact. The
  playbook's value is its history.
- **One page, one pattern.** If a page needs two rules, it's two pages.
- **Every rule cites its scar.** A pattern with no incident behind it is a
  guess and doesn't belong here yet.
- **Docs are freeze-safe.** Nothing in this directory touches `bots/src`,
  so playbook edits never violate an experiment code freeze.
