# Fun mode — the default process from 2026-10-28

**OWNER DECISION 2026-10-28.** This is a fun experiment, not a mission-critical
system or a paper. From today the goal is **visible progress in the world** —
towns that grow, tools that climb the tech tree, bots that build — not causal
claims that would survive a referee. Where this file conflicts with
`CLAUDE.md`, this file wins. Where it says nothing, `CLAUDE.md` still applies.

Amended the same day with the agreed points from two independent evaluations
(Claude and Codex), all approved by the owner.

> **Until the tooling catches up, the scripts still enforce the old rules.**
> The showcase gate (`infra/showcase/showcase_ops.py`, workstream W2) still
> wants Paper plus two engines for building pieces, or a fleet KEEP for
> survival pieces. The canary loop and scheduler (`canary-loop.sh`,
> `canary-sched.py`, `tierrule.py`, `bagfixrule.py`, `licencecheck.py`,
> per-change read scripts; workstream W4) still want licences, exposure,
> registrations and their own reads. Until W2 and W4 land, do not fight a
> validator with a design round. Use the tier-1 path, or wait for the tooling
> change. This file says what the process **is**; the scripts are catching up.

## Why

Measured from the canary journal, 2026-10-12 to 2026-10-28: **46 canaries in
16.5 days (about 20 a week): 31 KEEP, 4 REVERT, 11 INCONCLUSIVE**, so about
two-thirds were kept. The slot was busy 278 of 395 hours, and a change took
1–2 days from first commit to live. **The fleet is not slow; the visible world
is.**

The cost sits around the canaries:

- From 10-12 to 10-26, 352 of 555 non-merge commits (63%) were review rounds.
  fell-01 took six rounds and nobridge-01 took four, mostly on P2s.
- Docs grew by about 201k lines against about 18k of bot source. `STATE.md`
  reached 3,649 lines over 98 edits.
- The showcase ran on its own line of history. Its tip `fc300013` was not on
  main and was missing two fleet KEEPs.
- All four REVERTs were caught by a change's own defect lines or by deaths
  linked to the change. None came from DiD, licences or null bands. Paper
  passed fell-01, which then failed live.
- Nothing put a time limit on a stuck goal or alerted the owner about one.

The rigor was built for a question — *do the agents learn?* — that the owner
retired on 2026-09-04. Most of the process outlived that question.

## What stays (cheap, mechanical, and it is what makes going fast safe)

- `npm test` / `scripts/preflight.sh` and the no-undef lint before every deploy.
- The death circuit breaker, the commit-mismatch trip, the tripper, the version
  census, and `code.version` on every record.
- One-step rollback to the previous sha, with the rollback target pinned.
- Nightly world backups to the NAS. Code rollback does **not** undo world
  edits. Take a fresh snapshot before any change to destructive behaviour or to
  persistent state formats.
- **Done means read, not merged.** Every rollout closes with a recorded outcome;
  an open loop still blocks the next canary (`check-open-loop.py`).
- The three-step teardown, the deploy-from-a-copy rule, the one canary slot,
  the deploy lock, and every other *tooling* rule in `CLAUDE.md` § Deploys.
  Those describe how the scripts behave, not how careful to be.
- `scripts/lib/telemetry.py` with `ZeroLooksWrong`, positive controls, and
  denominators. **Missing telemetry is never "no harm".**
- The network constraints. No host addresses in markdown.

## Tiers — by risk, not by size

The test is what a change can break, not how long it is. A one-line change to
mining depth is high risk. A 600-line town building feature is not.

**Protected scope** is the file list `config/protected-paths.txt`. It covers
movement and pathfinding (including scaffolding and bridging during travel),
escapes and relocation, reflexes, mining depth and excavation, death handling,
the bot's execution core (`runner.mjs`, `cognitive.mjs`, `admission.mjs`),
dependency bumps (`bots/package.json` and its lock), and deployment and tripwire
logic. `skills.mjs` is listed per function, because most of it is building; its
`SKILLS` and `SKILL_CONTRACTS` tables are covered row by row. Building features'
spawn-time installs and licence rows go in `bots/src/features.mjs`, which is not
listed, rather than in `index.mjs`, which is. One helper decides, and both gates
call it:

```
python3 scripts/lib/protected.py --base origin/main   # exit 0 no, 1 yes (hits listed), 2 cannot tell = treat as yes
                                                      # on exit 1 the last line is tier=3 or tier=tooling
```

Entries marked `tooling:` are host scripts that never run on a bot: the canary
loop, scheduler and verdict, the showcase gate and tripwire, and the list and its
decider. Those changes are tier **tooling**.

| Tier | What | Review | Where it goes and how it closes |
|---|---|---|---|
| **1** | Constants, thresholds, prompt lines, milestone changes; read-only reports, dashboards, cameras; fixes under ~150 lines **outside** protected scope | One engine, one round | Showcase first if it touches showcase behaviour. Then an owner-direct fleet rollout (journal phase `owner-direct`) with a 60-min tripwire. Ledger row. |
| **2** | Features and behaviour of any size **outside** protected scope: building, towns, crafting, storage, cooperation | One engine, one round, plus a focused regression or composition test | **Showcase first**: watch it for 2 h and check that the goal visibly moved. Then the fleet, owner-direct with a 60-min tripwire. Ledger row. |
| **3** | Anything `protected.py` flags (`tier=3`), or anything that rests on Paper/mineflayer behaviour nobody here has seen work | Two engines, plus a real search of open source, issues and forums | A fleet canary in the one slot (bundle rules below). A Paper repro where it helps. |
| **tooling** | Only `tooling:` entries flagged (`tier=tooling`): host scripts that schedule, read or gate canaries and drive the showcase | Two engines, one round, blockers only, plus `npm test` | No fleet canary: nothing on a bot changes. Install on the host it runs on, and check its first real run. Ledger row. A change that also flags tier 3 is tier 3. |

A tier-1 or tier-2 fleet rollout takes the deploy lock. It never lands while a
canary is reading, because that would change the canary's baseline.

## Reviews: one engine, one round, blockers only

- **Blockers are:** a crash, a death, world damage, data loss, or **the change
  failing its own primary behaviour**. Nothing else blocks.
- Everything else goes in the commit message and is either fixed in the same
  commit or dropped. Style and speculative edge cases are not blockers.
- A second round only re-checks the blocker fixes. It does not reopen the
  design.
- No separate design review for tier 1 or tier 2. Write the design in the
  commit message.
- Review transcripts (`*-reviews-*.txt`) are not committed. The commit names
  the reviewer and any blocker.

## The canary (tier 3)

There is **one canary slot**. The tripper matches `canary_pool` literally and
`deploy-fleet.sh` ships per sha.

- **Bundle up to four compatible changes on one variant sha.** Different files
  do not make changes independent; say why they compose.
- **The read is generic, at +90 and +180:** the tripper, the death gate with
  its two-death floor, crash loops, and each change's own defect lines where it
  has them. No per-change read script is needed.
- **INCONCLUSIVE with no harm is a KEEP.** The question is "did it break
  anything", not "can we prove it helped".
- **"KEEP, goal unverified"** is the label when the change was never exposed,
  or its goal cannot be seen yet. The code stays, and the task stays **open**
  until someone sees the goal happen. No harm is not proof that it worked.
- **Whole-bundle rollback.** If the read trips, revert the **entire** bundle to
  the pinned previous sha, then diagnose offline. Do not drop the newest change
  and rerun live.
- Control pools are free, so look at them. There is no DiD write-up unless
  something looks wrong. Pre-registration, placebo pools, null bands, exposure
  licences and read scripts belong to **lab mode** only.

## The showcase follows main

- **One trunk.** The showcase is a separate *world*, not a separate *history*.
  It deploys from main, and main is where its pieces land.
- **The showcase is the first stop for building work and for most fixes.**
  It is the primary place where visible progress is accepted. The fleet is for
  breadth and endurance. A fleet KEEP is not proof of showcase behaviour, and a
  showcase pass is not required for a fleet canary.
- Before activating, the gate takes a world snapshot and checks ancestry and
  revocation. It never auto-follows backwards over showcase improvements; it
  reconciles instead.

## Rollout ledger

Every rollout writes **one row**: tier 1 and 2 owner-direct rollouts, showcase
activations, and canary promotes and reverts. The row records the sha, the
previous sha (the rollback target), the environment, the tier, the reviewer,
the time, the check-at time and the outcome. Until W5 automates it, write the
row as a `canary-journal.jsonl` entry, phase `owner-direct` for fleet rollouts,
or in the showcase ops journal, with those fields in the note. A rollout with
no check-at outcome is an open loop.

## Stuck goals reach the owner within 3 hours

A visible goal is a structure, a project or a tech step the bots are working
on. If one shows **no progress for 3 hours**, the owner hears about it **within
those 3 hours**, with options: the code fix in hand and its tier, a one-off
world fix (below), parking the goal, or dropping it. Do not silently keep
waiting. Do not stop every bot over one routine stall either. W5 makes this an
alarm in the fleetstatus header. Until then, the operator checks by hand.

## Owner one-off world fixes

**Bots changing the world is fine and wanted.** Digging, building and moving
blocks is what they are for. The restricted part is **tools and admin edits**:
RCON or console commands, `/give`, `/tp`, `/setblock`, `/fill`, WorldEdit, and
editing world files.

The owner may direct a **one-off** admin repair, for example clearing a block
that has trapped a goal for days. The rules:

- **Owner-directed only.** An agent proposes it; the owner says yes for this
  one case.
- **Logged** in the showcase or fleet ops journal: who asked, what was changed,
  where, why, and the task for the code fix.
- **Never a substitute for the code fix.** The bug stays open until bots can
  handle that situation themselves. A repaired goal counts as assistance, not
  as autonomous success.

## Short records

- `docs/reports/STATE.md` is **one screen** of current state: the live fleet
  sha, the showcase release, the canary in the slot, the queue head, pending
  owner decisions and open alarms. History goes in `docs/archive/`.
- One short line when a rollout closes, and one daily summary.
- Analysis has a time limit: 30 minutes, then decide with what you have.

## What success looks like now

- The showcase world: does the timelapse show the town growing week to week?
- The tech tree: what is the best tool, armour and block the fleet makes on its own?
- Completed structures, sustained cooperation and healthy bot-hours, not review
  volume.
- Deaths per bot-hour stay flat or fall, and the fleet keeps running unattended.

## Switching back to lab mode

If a question becomes worth proving — "did the bots actually learn this?" —
declare **lab mode** for that one experiment in `STATE.md`. Use the full
measurement process for it alone; it is archived in
`docs/archive/CLAUDE-history-2026-10-28.md`, and its scripts are kept.
Everything else stays in fun mode.

## Trade-off, stated plainly

We lose the ability to say *why* something improved. Changes will interact in
ways nobody measured, and some KEEPs will turn out to have done nothing. For a
fun project, that is an acceptable price for a several-fold increase in the
rate at which the world changes. The guardrails that remain are the ones that
keep the change rate safe: limited rollout scope, continuous trips, pinned
rollback, snapshots and backups.
