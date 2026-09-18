# Review memo — 18 September 2026, for independent Claude and ChatGPT review

**The question for you: is the diagnosis right, is the proposed mechanism the right fix, and is the queue order right? Attack all three.**

Repo: `/Users/darrellmiller/Documents/mcai-rl02` (docs/scripts branch `recovery-ladder-03`). Working rules in `CLAUDE.md` at the repo root — read it; it names the failure modes this project actually repeats. Today's evidence: `docs/reports/status-report-2026-09-18.md`, `docs/reports/drowning-pipeline-2026-09-18.md`, `docs/reports/STATE.md`, and the `## v22 — DRAFT` block at the end of `docs/reports/recovery-ladder-registration.md`.

## Context in three lines

80 mineflayer bots, 16 Peaceful Minecraft worlds, one seed. Changes ship as canaries on 2 pools (10 bots) against 70 controls, read as difference-in-differences under a pre-registered gate, and are KEPT or REVERTED by an unattended host loop. The program's committed metrics are deaths/bot-h, immobile share, iron-pickaxe bot-hour share, gather success, stock returned.

## What happened today: two canaries, zero results, both lost to the apparatus

The same change (`aa44514`, "movement owner step 1" — one controller owning walk/dig/place/cancel for entombed-escape episodes, behind `OWNER=1`) was deployed twice and produced no verdict about itself either time.

1. **owner-01 shipped INERT.** `mcai-canary-tree` wrote exactly `CODE_VERSION` and `RUN_ID` into the canary env file and had no mechanism for a third key, so `OWNER=1` never reached the process and `config.mjs` defaults it to 0. It ran 97 minutes as the baseline under a new sha. **Sha split, suite 192/192, preflight change-row check, and all safety lines stayed green throughout.** The only tell was the exposure counter reading `episodes_canary = 0` — and that only became a tell after computing the expectation: entombment episodes run 1.5/bot-h fleet-wide, so 10 bots over 90 min expect ~22 and P(zero) ≈ 0. Ground truth was `/proc/<pid>/environ` (57 vars as the positive control; `RUN_ID` present, `OWNER` absent).

2. **owner-01b was REVERTED on a linkage row that moved nothing.** Redeployed with the flag confirmed live; exposure reached 68 episodes; every v15c guard stayed within bounds at +180 (blocks moved +0%, working share −4%, items −13%, immobile DiD −0.4 pp). At 16:38Z the loop reverted on `('hive-a-Bravo','16:33:01','escape_rung')` — "change row inside a death window, discriminating". The fatal episode's own rows:

```
-93s  _escape_rung  rung=pillar outcome=refused   why=body held by air
-73s  _drowning_ceiling_no_air  never reached air (oxygen 0, health 18) — sealed
-53s  _drowning_ceiling_no_air  (health 17.67)
-53s  _drowning_rescue_yielded  "2 ceilings ... no harm (health 17.67, still sealed in)"
-51s  _escape_rung  rung=pillar outcome=preempted blocks=0
-31s  _drowning_ceiling_no_air  (health 10.67)
-31s  _escape_rung  rung=pillar outcome=preempted blocks=0
-11s  _drowning_ceiling_no_air  (health 3.33)
-11s  _drowning_rescue_yielded  "4 ceilings ... no harm (health 3.33, still sealed in)"
-10s  _escape_rung  rung=pillar outcome=preempted blocks=0
   0  _death        drowned; idle at the moment of death | hp 1->0 over 3s
```

Every rung in the fatal episode was refused or preempted with `blocks=0`; the air reflex held the body at priority 100 throughout. A control bot died identically four minutes earlier, and all three fleet deaths in that two-hour window were drownings-while-idle across both arms. One rung did run 167 s earlier — `rose 1.0` — but in a different episode ~9 blocks away.

## The diagnosis I want attacked

**Six defects found today, all one shape: a check that cannot fail, or an absence read as information.**

| # | instrument | the defect |
|---|---|---|
| 1 | `Events.load()` | an OOM guard summed 1124 rotated generations before applying the window, so it refused EVERY query for 6.5 h |
| 2 | program metrics | 2 of the 5 committed numbers (gather success, stock returned) had no standing read anywhere; gather drifted 30% → 20.3% unobserved |
| 3 | `mcai-canary-tree` | no mechanism for a feature flag, so a flag-gated canary is the baseline and every other check stays green |
| 4 | `openloop.py` | matched a decision to a deployment by sha alone, so the previous trial's verdict pre-satisfied the live canary's tripwire and it reported "clear to start something new" with a canary live |
| 5 | `analyst.py` | globbed `*.out` while the loop writes `*.txt`, so for two days it read finished runs' files under the heading "latest canary reads" |
| 6 | **v19 licence test** | refuses a change row that "appears in a CONTROL death window" — but a change row never appears on control **at all**, by construction. The condition can never fire. It reads as discrimination and performs none. |

None were caught by a standing check. Each was caught by hand, and the move that worked every time was the same: **turn the reported number into an expected number and compare.**

## Proposal A — `gate-power.py`, a preflight that asserts every gate can decide

This project already made that move mechanical once, for query zeros (`ZeroLooksWrong` raises on a suspicious 0). There is no equivalent for gates. Proposal: before a canary deploys, for each gate in its registration, assert **both branches are reachable on the drawn pools** — it could fire, and it could refuse. A gate with a vacuous branch fails preflight.

It would have caught #6 the first time v19 was registered. It would also have caught owner-01b's primary endpoint, which printed `+nan% FAIL` because the drawn pools had a **0.0% immobile pre-share** — you cannot reduce immobility from zero, so the primary ratio-DiD was a divide-by-zero, not a result.

**Attack this.** Is "both branches reachable" decidable in general, or only for the specific gate shapes here? What is the false-refusal cost — how often would it block a legitimate canary? Is a preflight the right place, or should it run at read time? Is there prior art (statistical power analysis, mutation testing of monitors, assertion coverage, "canary analysis" in CD systems like Kayenta / Spinnaker) that does this better? **Is there a simpler intervention with most of the benefit?**

## Proposal B — v22 (drafted, prospective)

A change row may licence a REVERT only if it **moved the body**: `outcome=ran` with a non-zero effect, and in the **same episode** as the death. `refused`/`preempted`/`no_effect`/`failed` are reported, never linked. This restates an existing rule (v10, written after an earlier canary was reverted on a refusal) inside the v19 licence path, so the two cannot diverge again. Drop the vacuous control-death condition.

**Attack this.** Does "moved the body" have its own vacuity problem? Could a change cause a death precisely by refusing (the project's documented bug class is "two individually-correct guards meeting where the bot has no legal move" — a refusal IS the mechanism there)? If so, v22 as written would blind the gate to the project's most characteristic failure. How should it distinguish "refused and therefore irrelevant" from "refused and therefore fatal"?

## Proposal C — queue order

1. Seed canary (world change, 72-h clock, the only test of "any world" — all 16 worlds share one seed; does not consume the code-canary slot)
2. v22 + gate-power
3. Drowning (see below)
4. Movement owner retry (owner-01c)
5. falls-02 fleet-wide instrument

**Attack this**, particularly item 3's justification. Drowning is 28 of 48 deaths (58%), but **deaths already clear both the 2-week (≤0.05) and 6-week (≤0.03) gates at 0.025/bot-h**. So fixing drowning moves no program metric. Its case is now (a) a background drowning reverted a healthy canary today, so it corrupts reads, and (b) it is pre-investment for when `keepInventory` is turned off and deaths start costing the endpoint. Is that good enough to rank it 3rd, against **gather success at 20.3% versus a 40% two-week gate — the metric that is actually failing, with 62% of its failures being navigation refusing to reach a visible block (`unreachable` 9,940, `no_safe_target` 7,726, `no_path` 4,604 of 23,544)** — which has no queue item at all because it is "program step 3", gated behind the movement owner that cannot land?

## The drowning mechanism (for item 3), already characterised

`_water_no_air_route` discriminates at 81% (89 fires → 72 deaths) against `_water_float` at 0.03% (13,504 fires → 4). The rescue's suppression predicate is correct as written but its input is not: `drownFailHealth` resets at every ceiling, so "healthDropped" only asks *since the last ceiling*. Yields split cleanly — **235 at full health, 1.7% fatal** (the designed phantom-drowning case, working correctly) vs **23 at health < 5, 100% fatal**, spread over 20 bots in 11 of 12 pools. But the yield is a **marker**: 11 s before death, against 73 s and 4 ceilings since the first. The real defect is that `assessAir` returns only `swim | fallthrough | none` — no dig, no place, no bucket — so when routing to air is impossible it re-runs routing to air until the bot dies. `_goto_float_dig` proves a floating bot CAN dig (72 fires, 0 following deaths) but lives in `goto` and is unreachable from the drowning path. Proposed fix: an absolute health floor on the suppression **and** a dig-up remedy armed at the FIRST ceiling (73 s of budget) rather than at the yield (11 s), shipped together. Validate on **ceilings-per-episode, never deaths** — 0.014 deaths/bot-h gives a 10-bot 6-h canary 0.84 expected deaths and no power.

**Attack this too**: is the health floor safe given the 235 correct full-health yields? Does arming a dig at the first ceiling risk the bot digging into more water, or spending the blocks it needs to escape?

## The honest constraint

The two-week gate is **27 September**, nine days out. Gather cannot go 20.3% → 40% in nine days. Three of five metrics will pass, two will not. I intend to register the 72-hour read window (24–27 Sep) and read it straight rather than let it slide.

## What I want from you

1. Is the "checks that cannot fail" diagnosis the right read of today, or am I pattern-matching six unrelated bugs?
2. Best single intervention for throughput over the next 9 days — is it gate-power, or something else entirely?
3. Is the queue order right, especially drowning vs navigation/gather?
4. Specific defects in Proposals A and B as drafted.
5. Prior art I should be using instead of inventing.
