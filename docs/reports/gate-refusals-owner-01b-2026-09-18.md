# The 102/bot-h WATCH is the actuator gate meeting the live reflex layer, not the owner's rungs (evening session, 18 Sep 14:45 UTC)

Handed to the operator of record; read-only analysis, nothing changed. `owner-01b` breached my own registered line
`refused_actuator_per_bh_canary <= 30` at **102.4**. I set that threshold from a sandbox fixture where no skill ever
ran; this is the first time `ARBITER=1` has met eighty bots' worth of live reflex and skill traffic, so the number is
a measurement, not yet a harm.

## Who is being refused (1,890 refusals, 90 min, 10 bots, since 13:04:27Z)

| holder while refused | n |  | refused call | n |
|---|---|---|---|---|
| gather | 938 | | setControlState | 1,345 |
| goto | 302 | | clearControlStates | 162 |
| explore | 295 | | look | 120 |
| deposit | 149 | | setGoal | 78 |
| **owner:entombed** | **139** | | placeBlock / goto | 95 |

**The owner holds the body for 7% of them.** The rest are the gate arbitrating between a SKILL that holds the body
and callers that are contextless by construction.

## The five call sites, and which need a decision

| site | n | reading |
|---|---|---|
| `EventEmitter.monitorMovement` (pathfinder) | 520 | the pathfinder's movement loop still firing after its goal was taken; "tick bound to nobody" — correct to refuse, and the arbiter's own stop already clears the goal |
| `reflex.mjs:1786` + `:1804` (the water hold) | 623 | the **unowned** float/surface hold, which has no grant to run inside; silently dropped today |
| `unstick` | 235 | an unrouted rescue path: while anything holds the body, unstick is now inert on canary bots |
| `digStraightUp`, `pillarOut` | 159 | rung bodies called after their grant ended (stale continuations) — correct refusals |
| `runner.mjs:264` stop, `Timeout._onTimeout`, `signal.addEventListener` | ~78 | timers and listeners that lost the async context |

Samples show the shape plainly: `setControlState from explore while owner:entombed holds the body (tick bound to
nobody)`. The owner preempted a skill at escape priority; the skill keeps calling for a while and is dropped. That is
Codex's pass-2 finding 2 in the wild — a refusal neither cancels the caller nor tells it anything.

## What I would put to the operator

1. **`unstick` should take a grant** (it is a rescue, and inert-while-held is a regression the sandbox could not show).
2. **The unowned water hold should stand down explicitly or hold a grant**, not be dropped silently.
3. **A preempted skill should stop sooner** — the interrupt fires through `onCancel`, but explore keeps issuing calls
   after it.
4. **Re-baseline my line.** 30/bot-h came from a fixture with no skills. A live floor looks like 60-120/bot-h before
   any of the above; the WATCH should be re-registered against the measured distribution, or split by holder so the
   owner's own refusals (7%) are the part that gates.

Harm check so far: one canary death (13:27:38 board-b-Alpha, "drowned; idle" — the fleet's standing channel), and the
v15c movement guards did not breach at +90.

---

# CORRECTION at +180 (16:06Z): the refusals are not the story, and they are not harm

Read at +180 changes two things I wrote above, and the operator should act on this section, not the one above it.

**1. The refusal rate is not a static legacy floor. It doubled: 102.4 -> 235.5/bot-h.** My "~93% legacy, 7% owner"
split at +90 does not hold at +180, because the owner's episodes accumulate and the refusals track them.

**2. But it is not costing work, and nothing else is either.** Every pre-registered harm guard is within its band:

| guard (v15c) | value | band |
|---|---|---|
| blocks moved / bot-h | +0% | >= -30% |
| working share | -4% | >= -20% |
| immobile DiD | **-0.4 pp** | > +10 pp to breach |
| items gathered / bot-h | -13% | >= -50% |

Immobility rose on both sides (canary 0.0 -> 2.9 pp, control 1.4 -> 4.8 pp) so the DiD slightly FAVOURS the canary.
Both canary deaths are `drowned; idle`, `mechanism-linked=no` -- the standing channel, and the v21 death gate correctly
held (rate ratio 10x but the lower 95% bound 0.78x does not clear 1.25x). **A gate refusing 235 calls per bot-hour at
0% movement cost is evidence the refused calls were redundant.** That is a result worth keeping from this canary even
if the owner itself is not kept.

## The real finding: the rung ladder holds instead of escaping

**71 episodes opened, 9 closed, 55 held.** `hold_share` 0.79 against my registered 0.5.

```
pillar: ran 45  failed 19  refused 17  preempted 23
stair:  ran  7  failed  5  preempted  2
```

Three concrete defects, all visible in the rows:

1. **The episode budget refuses its own rung.** `pillar outcome=refused why=needs_blocks (episode budget 8 < 16)`.
   `newEpisode` sizes the budget at need+2; `pillarOut` asks for 16. The episode cannot perform the rung it selects,
   which is exactly the dead-end composition CLAUDE.md names -- a refusal whose remedy the bot cannot execute.
2. **`pillar outcome=failed why=no height gained (undefined)`** 19 times. The `(undefined)` is a formatting hole in the
   `why` string, so the diagnostic that would explain the failure is missing from the row that reports it.
3. **Episodes re-open at each new height instead of continuing.** board-b-Bravo: pillar rises 6.0 at `352,66,207`,
   and a new episode opens at `352,72,207` in the same second, with a fresh 180 s deadline and a fresh budget.
   Progress made is not carried forward, so a bot in a shaft re-enters ASSESS at every rung.

Entombment rows/bot-h rose 3.50 -> 5.63 on the canary (+61%) against control 2.34 -> 2.63 (+12%), and climb firings
are +63%. Those are the same phenomenon as (3): the owner opens more episodes, not that bots are more trapped.

## What the verdict should be

The KEEP condition is not met and will not be by +360: it needs a freed canary bot **with a ladder row**, and the
canary freed share is 0/0 against a control spontaneous base of 4/6. On the registered rules this reads
**INCONCLUSIVE or REVERT on ineffectiveness, never KEEP** -- the owner is safe and does not work yet. Fixing (1) is
the single change most likely to move the close rate, and it is a one-line budget change.

---

# REVERTED 16:38:45Z — and the death names a defect the refusal lines never would have

`VERDICT REVERT :: change row inside a death window, discriminating: ('hive-a-Bravo', '16:33:01', 'escape_rung')`.
Torn down at 16:42:21Z, one version live. **The revert is correct and the linkage is real**, unlike the three earlier
false reverts this month.

## What killed hive-a-Bravo

The bot was **walled in while submerged**, one block from a drowning site already recorded at `386,59,175`:

```
16:29:50  _death_site_route_crossed  death:drowning x1 at 386,59,175; the planned route passes 384.5,59,169.5
16:29:50  _entombed                  walled in at y=59
16:29:50  _arbiter_preempting        {"holder":"gather","by":"owner:entombed"}     <- the owner takes the body
16:31:28  escape_rung  rung=pillar outcome=refused  why=body held by air
16:32:09  escape_rung  rung=pillar outcome=preempted  ms=1151
16:32:30  escape_rung  rung=pillar outcome=preempted  ms=648
16:32:51  escape_rung  rung=pillar outcome=preempted  ms=1150
          death: drowned; idle at the moment of death
```

`isEntombed` reads "walled in" for a **swimming** bot. So the owner opened an escape episode on a bot in water, took
the body away from `gather` at PRIORITY.escape, and then spent eighty seconds losing it to the air reflex on every
rung, one block from where this same bot had drowned before. The air reflex outranks the owner and was doing its job;
the owner was contending for the body of a drowning bot against the only reflex that could save it.

This is not a one-off: **15 of the canary's 240 rung rows are `refused why=body held by air`.**

It is also a direct breach of the standing owner directive -- water is terrain, and the only water reflex is getting
air. The escape ladder has no business running on a bot that is swimming.

## The proportions, which correct my earlier sections

| rung row | n | share of 240 |
|---|---|---|
| `failed: no height gained` | 20 | 8% |
| **`refused: body held by air`** | **15** | **6%** |
| `ran: rose 1.0` | 13 | 5% |
| `refused: needs_blocks` | 4 | 2% |

The frozen-budget defect I wrote up above is **4 rows in four hours**. I spent the afternoon on the third-order bug.
The first-order ones are that pillar runs and gains no height, and that the ladder runs in water at all.

## Fixed on the branch, not deployed (`49c4f17`, movement-owner-1)

1. **`nextRung` returns nothing while `obs.wet`**, and the hold is named `wet`. The bot holds, the air reflex has the
   body uncontested, and the hold ends on evidence when it is ashore.
2. The affordability test moves out of the rung and into `nextRung` as a **gate that records nothing**, reading the
   live need and the live block count. A `needs_blocks` refusal no longer latches the rung out of the episode.
3. **A real spend cap.** `blocksSpent` was accumulated and compared to nothing anywhere; the only bound was the reflex
   line, so removing that line would have left an episode free to empty a bot's inventory into a chimney.

Adversarial review killed my first draft: it assumed `underfoot` harvests blocks, and `harvestUnderfoot` is a
bare-handed DESCENT whose postcondition is `fell`, not a pickup. **The entombed ladder contains no rung that acquires
blocks** -- `harvestAdjacent` exists and is not wired into it. That is the open design item for owner-01c.

## Two things for the operator

- **`no height gained` is now the top failure (20 rows) and is not diagnosed.** The row prints the return value and
  nothing about the column. Worth an instrument before the next canary rather than a fix.
- **A death row lists dropped items** (`dropped: leaf_litter x110, cobblestone x39, dirt x35 ...`) on a fleet recorded
  as `keepInventory=true`. Either the gamerule is not what we believe on every world, or that row means something
  else. It changes the cost of a death, so it is worth five minutes with RCON.

---

# Two-engine review, and the trap I nearly shipped

Both engines reviewed the fix. Each found something decisive, and each killed a version of it.

**Claude killed draft 1.** It rested on `underfoot` harvesting blocks so a refused climb could be retried after a
harvest. `harvestUnderfoot` is a bare-handed DESCENT whose postcondition is `fell`, not a pickup. Verified in source.
The entombed ladder has no rung that acquires blocks at all.

**Codex killed draft 2, and this one matters most.** Gating the ladder on `isInWater` created a NEW dead end of
exactly the kind this project keeps building: **a bot walled in with one block of water at its feet, head in air, full
oxygen and a pocket full of blocks.** `isEntombed` says trapped. `assessAir` declines it, because it is not an air
emergency. And my gate said no rung. That bot had no legal move and no reflex coming. Codex reproduced it on a
shallow-water fixture at y=140.

The correction: **wetness is not a handoff acknowledgement.** The gate now asks whether the air reflex actually holds
the body, or whether the head is in a cell only the air reflex can help with. A wet-footed bot with a breathing head
still climbs out. There is now a regression test named for that dead zone, and a mutant that re-keys the gate on
wetness kills it.

## Also fixed: the top failure can now be read

`pillarOut` had three exits that all returned `undefined`, so `no height gained` (20 of 240 rows) named none of them.
It now counts placements and returns a reason. **Both engines independently picked `placed` as the discriminating
field**: `placed=0` never landed a placement, `placed=6` placed and slid back. Those are different bugs.

## Known limits, carried forward rather than fixed

| limit | why it is not fixed here |
|---|---|
| the spend cap is an admission threshold, not a hard limit, and resets on displacement | a cumulative trap-level budget is a design change, not a bug fix |
| `BLOCK_REFUSAL_RETRIES` bounds one episode, not repeated episodes at one trap | same |
| `harvestAdjacent` stays unwired | it stops at four blocks, has no `alive` check, and does not protect the last pickaxe; it needs a resource-progress contract |

## State

Branch `movement-owner-1` at `2f3d918`, suite 193/193, **not deployed**. The fleet is on `b1659c0`, 80 of 80 bots
live across all 16 pools, no canary declared. owner-01c is the operator's call, and the case for it is now: the
stand-down, the live block gate, a real spend bound, and an instrument that can finally explain the top failure.
