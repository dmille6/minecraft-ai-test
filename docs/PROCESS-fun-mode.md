# Fun mode — the default process from 2026-10-28

**OWNER DECISION 2026-10-28.** This is a fun experiment, not a mission-critical
system or a paper. From today the goal is **visible progress in the world** —
towns that grow, tools that climb the tech tree, bots that build — not causal
claims that would survive a referee. Where this file conflicts with
`CLAUDE.md`, this file wins. Where it says nothing, `CLAUDE.md` still applies.

## Why

Measured on `origin/main`, 2026-10-12 to 2026-10-26: **352 of 555 non-merge
commits (63%) were review rounds.** townplan-01 and lavastep-01 took 22
commits each, and `docs/reports/STATE.md` was edited 98 times. Canaries run
one at a time for 3–6 h, so the fleet takes about 4–6 changes a week and keeps
about half. The bottleneck is process, not code or compute.

The rigor was built for a question — *do the agents learn?* — that the owner
retired on 2026-09-04. Most of the process stayed when that question was retired.

## What stays (cheap, mechanical, and it is what makes going fast safe)

- `npm test` / `scripts/preflight.sh` and the no-undef lint before every deploy.
- The death circuit breaker, the commit-mismatch trip and the tripper.
- `code.version` on every record, and one-step rollback to the previous sha.
- Nightly world backups to the NAS.
- **Done means read on the fleet** — merged is not done. Close every canary
  with KEEP or REVERT written down; an open loop still blocks the next one.
- The three-step teardown, the deploy-from-a-copy rule, and every other
  *tooling* rule in `CLAUDE.md` § Deploys. Those describe how the scripts
  behave, not how careful to be.
- Do not change the world to fix a bot. The network constraints. No host
  addresses in markdown.

## What changes

### 1. Reviews: one engine, one round, blockers only

- **Default: one review, from either Claude or Codex, one round.** Only a
  finding that would crash bots, kill bots, corrupt the world or lose data
  blocks the change. Everything else is noted in the commit and either fixed
  in the same commit or dropped.
- **No separate design review** for a change under ~300 lines. Write the
  design in the commit message.
- **Two engines and an open-source search are reserved** for changes to
  movement, reflexes or mining depth, and for anything resting on Paper or
  mineflayer behaviour nobody here has seen work.
- A second round happens only if the first found a blocker.

### 2. Most changes ship as tier 1

The tier-1 path (owner-direct fleet rollout with a tripwire, journal phase
`owner-direct`) needs no tooling change. In fun mode it covers:

- any constant, threshold, prompt line or milestone change;
- any fix under ~100 lines outside movement, reflexes and mining depth;
- new read-only reports, dashboards and timelapse cameras.

Roll it out and watch the tripwire for 60 minutes. If deaths, stalls or crash
loops rise, roll back. Otherwise it stays.

### 3. Bundle the rest into one canary

There is **one canary slot**, and it stays one: the tripper matches
`canary_pool` literally and `deploy-fleet.sh` ships per sha (CLAUDE.md
§ Deploys). Parallel lanes would need a tooling change. Instead:

- **Stack up to four independent changes on one variant sha** and run them as
  one canary on 4 pools. Prefer changes that touch different files.
- **Read at +90 min.** KEEP unless the tripper fired, the death gate tripped
  (its two-death floor still applies), or one of the changes visibly broke its
  own behaviour.
- **If it trips, drop the newest change and rerun**, rather than bisecting the
  whole stack with a fresh design.
- **No harm counts as a KEEP.** In fun mode, INCONCLUSIVE with no harm is a KEEP.
  The question is "did it break anything", not "can we prove it helped".

### 4. Skip the experiment machinery for ordinary changes

Fun-mode changes do not need a pre-registration, placebo pools, null bands,
an exposure licence, a Paper sandbox run or a written read script. The control
pools that `drawrec.sh` already holds back are free, so look at them, but
there is no difference-in-differences write-up unless something looks wrong.

Where a script refuses without one of these fields, use the tier-1 path, or
file the script change as its own small task. Do not write a design round to
satisfy a validator.

### 5. Short records

- `STATE.md`: one short entry when a canary closes, and one daily summary.
  The header is rewritten once a day at most.
- Analysis has a time limit: 30 minutes, then decide with what you have.
- Review records (`*-reviews-*.txt`) are no longer committed for fun-mode
  changes. The commit message names the reviewer and any blocker.

## What success looks like now

- The showcase world: does the timelapse show the town growing week to week?
- The tech tree: what is the best tool, armour and block the fleet makes on its own?
- Deaths per bot-hour stay flat or fall, and the fleet keeps running unattended.

## Switching back to lab mode

If a question becomes worth proving — "did the bots actually learn this?" —
declare **lab mode** for that one experiment in `STATE.md` and use the full
process in `CLAUDE.md` for it alone. Everything else stays in fun mode.

## Trade-off, stated plainly

We lose the ability to say *why* something improved. Changes will interact
in ways nobody measured, and some KEEPs will turn out to have done nothing.
For a fun project, that is an acceptable price for a several-fold increase in
the rate at which the world changes.
