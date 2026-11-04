# shafttrap-02: the fleet's stair trap -- the reflexes hand a bot on the stair to the egress (design + build, 2026-11-03)

Piece 2 of [`shafttrap-design-2026-11-03.md`](shafttrap-design-2026-11-03.md) (owner 11-03: "yes design all using both claude
and codex, put them in the queue and implement and deploy where you feel is right"). FLEET piece, survival lane, tier 3
(`protected.py --base 53fd28ee`: `bots/src/reflex.mjs`, `skills.mjs::stairAscend`, `::stairEgressReflex`, `::stairStandingOn`,
`::stairWalkOwned`). Branch `canary-shafttrap-02-on-53fd28ee` on the live fleet sha 53fd28ee (cooldown15-02), with shafttrap-01's
five commits cherry-picked first (one import-line conflict with stuckcells-01's `supportChain`, resolved by keeping both).

## 1. Measured (fleet files on the canary host, `telemetry.stream_rows`, full walks)

Window 11-02 00:00Z to 11-03 22:00Z (46 h): 80 of 80 bots, 3,647,488 skill rows; 308,606 rows of the kinds read (307,381
positioned). 14 of 16 towns have a COMPLETE stair record (board-c and hive-c none); "on the stair" = `stairStepAt(planOf(rec),
floored feet)` below the collar (exactly the build's trigger predicate): 25,722 positioned rows.

| what | all | on a stair |
|---|---|---|
| `_needs_rescue` `record=shaft` | 176 (of 214 `_needs_rescue`) | 173 |
| `_entombed` | 33,783 | 3,810 |
| `_marooned` | 13,018 | 1,447 |
| `_escape_guard_ramp` / `_refused` | 5,299 / 1,529 | 4,952 / 1,299 |
| `_inventory_mutation` (pillar placements) | 37,277 | 1,132 |
| `_shaft op=dig why=air` (repair of foreign blocks in air cells) | 1,279 | 1,279 |
| `_shaft_use dir=up` arrived / no_plan / walk | 41 / 2,431 / 6 | 0 / 304 / 1 |

**Episodes** (first in-stair `_marooned`/`_entombed`/`_needs_rescue`, closed at the next row off the stair): **1,429 on 68 bots,
3,305 bot-minutes** (median 1.2 min, p90 5.7 min; ~29 bot-h a day). First arm: entombed 995, marooned 431. Skill ended before:
build_shop 443 (the stair visit: shafttrap-01, folded in, covers these), gather 384, goto 154, explore 113, surface 67, home 49,
furnace_drain 39, smelt_town 37, make_material 36, mine 31, deep_mine 29. 553 episodes placed pillar blocks, 749 met the escape
guard, 163 ended in a shaft `_needs_rescue`.

**Where the body is** (the finding that reshaped the entombed hook): of 3,810 in-stair `_entombed` rows, **3,643 have the feet in
the HEAD cell of the next step down or the one after** (1,926 + 1,717): a body in transit between treads, rock overhead and on
three sides by design. The skill that ended with them was ABORTED (gather 855, goto 782, explore 466, surface 331, home 250, mine
113, furnace_drain 111, ...): **the entombed arm cut moving walks through the stair short and pillared.** `_marooned` rows are
the other shape: 1,426 of 1,447 on the step's own stand (an idle bot).

Positive controls: the same walks found 33,783 `_entombed` and 13,018 `_marooned` rows overall, 1,279 `_shaft` repair digs,
2,431 `_shaft_use` up rows, and every one of the 80 bots.

## 2. The design (Claude)

1. **A walk through the stair is not entombment.** The entombed arm waits (`!stairWalkThrough()`, just before tombexit's decline)
   while a skill runs AND the pathfinder is moving the bot AND its feet are on the town's complete stair (`stairWalkThroughNow`,
   pure). A walk that stalls stops moving (the stuck detector interrupts it; the skill's hard timeout bounds an oscillation), and
   the arm, with its hand-over, applies. Row `_stair_walk_through` (once a minute).
2. **The hand-over** (`reflex.mjs stairExitCandidate/stairExitFirst`; `skills.mjs stairStandingOn/stairEgressReflex`):
   - marooned arm: after `maroonState` says `climb` or `need_scaffold` (exactly where today's code would pillar or ramp; never
     where it would do nothing, so an idle miner at a landing whose probe succeeds is left alone), take the body, run the egress;
   - entombed arm: after `takeBody`, before `pillarOut`; its give-up (the pickaxe ask) waits while a hand-over is due;
   - never for a deep miner's open trip (`deepTripOnStair`: tripHoldsBody or a descent under an hour old) or a held 'stair'
     claim (mine's descent, a visit, the deep hops); only on a COMPLETE stair record with an exit;
   - `egressHandoff` (pure): out -> no escape (counters cleared); yield (pre-empted) -> no escape; retry (it hopped or cleared)
     -> this firing ends; **fallthrough (nothing gained) -> today's escape chain runs at once**, and that step is not handed
     over again for `EGRESS_RETRY_MS` (5 min): a failed egress is never a new dead end and never a loop.
3. **surface**: `stairAscend` walks a bot ON the stair up with the egress (clears the dirt) instead of the plan that answers
   `no_plan` on one dirt block (304 in-stair no_plan, 0 arrived); not out -> null -> today's climb.
4. **Ownership** (from the reviews): the reflex grant has no acknowledged hand-over (the arbiter is off on the fleet), so the
   reflex's hop walk (`stairWalkOwned`) halts only its OWN goal, restores the walk profile only over its own town profile and,
   once the body is lost, without clearing the control states; the signal asks `alive()` (owns the body, no drowning rescue,
   no air-pocket want, no danger move) whenever it is read, so no hop starts after a rescue's seize; no equip or dig once
   aborted; the default profile is read after the town-walk probe.
5. **Ghost blocks** (Paper): a dig the server does not confirm is resolved by the server (buildbot probe, at most twice: air
   confirms, a block stands and is back in the client's world), else the egress hopped into client air over server dirt.
6. Switch `SHAFTTRAP=0`: no hand-over, no walk-through wait, surface plans as before. Rows: `_stair_handoff handler= k= then=
   egress= hops= cleared= ms=`, `_stair_walk_through`, and shafttrap-01's `_shaft op=egress` / `op=egress_dig`.

Not built (both noted, neither needed for the fix to compose): the place guard (no scaffold placed into a planned air cell of
the stair, egress named as the remedy) and a stair-safe fallback that refuses protected digs even after escapeguard's last
resort. Both change today's escape chain itself; they are a separate, later piece if the read shows fall-throughs still
pillaring the stair.

## 3. Codex's independent design (codex exec, read-only, given the measurements and the code) and the reconciliation

| Codex | reconciliation |
|---|---|
| one bounded stair-egress adapter for both reflexes and surface; "do not make on-a-stair an unconditional instruction to ascend" | agreed: `stairEgressReflex`/`visitEgress` shared; the marooned hook is gated on the states that would pillar |
| marooned hook before `maroonState` dispatch and before `canStartAPath` (the probe accepts any non-empty partial path) | kept AFTER maroonState: before it, every idle bot at a landing (mine's descent target) would be walked up; where the probe says a route exists today's code does nothing either (Paper: an idle bot on a clean stand logged nothing in 6 min) |
| entombed hook before `tombDeclines()` and before the give-up branch | the give-up waits while a hand-over is due (adopted); tombexit's decline stays first: it finds the walk back open and acts on nothing |
| exclude `tripHoldsBody`, typed claims; preserve mine's descent | adopted (plus a deep trip's descent phase) |
| "do not require COMPLETE" | kept the requirement: on an unfinished stair a planned air cell holds native rock not yet lined, and the egress would dig the visit's work without its lining-first safety; all 14 fleet stairs are complete |
| tagged outcome contract; abort/ownership loss: no same-tick fallthrough | adopted (`egressHandoff`: yield, retry) |
| stair-safe fallback: reject pillar placements in passage cells and protected digs, also after the last resort | not in this piece (section 2) |
| shared retry state keyed by place and reason, jittered 30/60/120 s | one memo across both arms keyed by step, 5 min; a retry that climbed stamps it, a clear without a hop does not |
| `_stair_egress` rows with attempt id etc.; `STAIR_EGRESS=off` | `_stair_handoff` row; `SHAFTTRAP=0` |
| tests through the real branch composition; mutants for each hook | the decisions are pure and tested; the chain on the real A*; the arms' wiring anchored; 9 mutants; the real arms are proven on Paper (section 5) |
| the canary read with exposure denominators | section 6 |

What Codex did not have and changed the design: the in-transit finding (section 1), which put the walk-through wait in front of
the hand-over for the entombed arm.

## 4. Reviews (tier 3: two engines, blockers only)

- **Codex r1: 2 blockers** -- (1) an aborted egress could clear the next owner's goal/stroke (`haltPath`; setMovements' resetPath
  clears controls), (2) a dig could start after the body was lost (during the equip). Fixed (section 2.4) with behaviour tests
  and mutants; the fix's own test found a third path (a next hop starting between a rescue's seize and the 200 ms poll), fixed by
  the synchronous signal. **Codex r2: no blockers** (both fixed; the walk-through gate cannot suppress indefinitely: stall resets
  and the runner's hard timeout).
- **Claude subagent r1: no blockers**; note 1 (retry stamps the wait) adopted. **Claude r2: 1 blocker** -- the r1 fix read the
  default walk profile before the town-walk probe, so an egress that interrupted a gather walk could re-install gather's digging
  profile (world damage). Fixed (read after the probe; restore only over its own profile), test + mutant. Walk-through hunk clean.
- **Codex r3** (re-check of the Claude r2 fix, the retry stamp and the ghost-dig probe): no blockers.
- **The full suite** (ci2, b2ac1b58) failed 5 pinned contracts beyond the known base failures; fixed in r3 (5f8b42f8): the walk
  profiles stay index.mjs's (dep-contract: `bot.withTownDepositWalk(fn, { quiet })` restores only over its own profile and, once
  the body is lost, without clearing controls -- which also removed the profile capture of the Claude r2 blocker), the hand-over
  takes its own grant (maroon-terminates), the give-up skip is a preceding `else` arm (climb-flood-chain), the second typed
  'stair' read is listed (body-claim), 29 lock-checking drivers (sandbox-registry). **Codex r4 and Claude r3: no blockers.**
- After r4 (small, not re-reviewed): a body moved by something else mid-egress (respawn, teleport) is a yield, not a fall-through
  (`jumped`, from a Paper driver artifact); fallpath-wired's pinned restore count.
- **Suite** (w30, 5f8b42f8): 383/388; failing ceilescape, nothing-important-is-orphaned, protected-paths, well (known base) and
  fallpath-wired (a pinned count, fixed in 5159b315; targeted stair, tomb, escape, maroon, fallpath, dep-contract, body-claim,
  climb-flood, sandbox-registry all pass). eslint clean; lint:movement fails on the base (buildbot.mjs etc., pre-existing).

## 5. Proven

- Unit: `bots/test/stair-handoff.test.mjs` (the decisions, the refusal chain on board-a's stair geometry with the REAL
  mineflayer-pathfinder A*: before = probe false + walk out exists; out with 3 dirt dug and every record cell untouched; water ->
  fallthrough now, then skip inside the wait, then tried again; progress -> retry -> fallthrough, bounded; pre-empted -> yield; off
  the stair -> skip; no equip/dig once aborted; the ghost-dig probe; wiring; 4 mutants), `town-stair-wiring.test.mjs` (surface on
  the stair takes the egress without a plan; SHAFTTRAP=0 the base; a rescue mid-hop keeps its goal, jump and the default
  profile, also from an interrupted gather walk; 3 mutants), `town-stair-stuck.test.mjs` (call sites), `tombexit.test.mjs`
  (the decline stays LAST).
- Paper (sandbox3, whole bot `node src/index.mjs`, model off or the scripted brain; driver `sandbox/shafttrap/handoff-e2e.mjs`):
  stair carved by RCON from shaftgeom's plan (K 55, g 70), the record written to the bot's pool dir, fleet-like bag.
  - `blocked` (idle at step 44, dirt in step 43's feet and head cells and in step 30): **4 clean runs out of 4** (1436fd27,
    053f4c66, 68ab4c75 twice; one more run on 053f4c66 started inside the stair from the previous scene's spawn -- the driver now
    parks the bot -- and is the source of the `jumped` fix). Each:
    `_stair_handoff handler=marooned k=44 then=out egress=arrived hops=16 cleared=3 ms=39103`; at the collar exit; all 192 planned
    air and 464 solid cells as planned; no pillar, no guard row. **PASS.**
  - `blocked_base` (SHAFTTRAP=0), the control: the maroon arm's ramp pillared dirt into step 44's stand cell, stopped at y 32
    in the stair ("a route exists again"); a planned air cell left solid. This is the fleet's damage, reproduced.
  - the same `blocked` on the pre-fix build 24e009c5 showed two things the final build fixes: the first dig was not confirmed by
    the server and left client air over server dirt (the egress then hopped into it: `then=retry hops=0 cleared=1`, and the
    retry stamp sent the next firing to the lattice) -> the probe and the stamp rule (section 2.5, r2); and the composition:
    `handler=entombed k=43 then=fallthrough egress=hop` followed in the same firing by today's `_escape_guard_ramp` and then
    `_needs_rescue` -- the fall-through runs the escape that existed, no new dead end.
  - `descend` (a scripted goto from the collar down the stair to the 16 landing's stub end; the town deep miner also ran its
    trips): the goto hit the entombed test mid-walk on the stair (`_stair_walk_through`), was NOT interrupted, arrived; 0
    in-stair `_entombed` (the 2 `_entombed` rows were in the deep miner's branches off the stair). Twice (24e009c5, 1436fd27).
    `descend_base` never reached its goto inside 5 min (the deep miner's trip ran first): no control for the in-transit
    interrupt on Paper; the fleet's 3,643 rows are the evidence.
  - `tread` (step 43's tread removed, idle at 44): no arm fired in 5 min (the probe found a route through the hole): not
    exercised.
  - Not shown on Paper: two bots in the stair at once, a rescue pre-empting a running egress (unit-tested with a pathfinder
    model), the up/down loop of a re-issued descent (named in the read).

## 6. The read (canary, survival lane)

Generic reads (tripper, death gate) plus own lines, canary pools vs control, denominators: bot-minutes on a stair and stair
episodes. Expect: in-stair trap episodes per stair-exposure bot-hour down (baseline 1,429 / 46 h fleet), in-stair `_entombed`
interrupts of a running skill to ~0 (`_stair_walk_through` rows instead), shaft `_needs_rescue` down (173 / 46 h), in-stair
`_inventory_mutation` down (1,132), repair digs `why=air` down over days (1,279), `_shaft_use dir=up` arrivals up from 0 on the
stair. Own rows: `_stair_handoff` then= shares (out should dominate; fallthrough named by egress why), and **repeat
hand-overs per bot-hour** (an up-and-down loop: a skill re-issued down the stair, interrupted, walked up again) -- if a bot logs
more than 6 `then=out` in an hour, name it in the read. Deaths: none linked expected (no new digs outside the stair's own air
cells; the walk-through wait does not touch the air/drowning/lava reflexes).

## 7. Queue placement

Fleet lane, **S**. Claude: after swimcentre-01 (S, at the queue head) and the next P (bundle-1103a), i.e. the next S slot.
**dropdig's swimunder-01** (branch `swimout01-on-53fd28e`, also S, also reflex.mjs) is the competing next S. My view: shafttrap-02
first. It is ~29 bot-h a day of trapped time on 68 bots plus world damage (pillar dirt into 14 stairs, 1,279 repair digs) and 173
rescues, against swimunder's ~40 bot-h a day on 3 pinned bots (the long ones) and ~0.3-0.6 deaths a day at pin sites; shafttrap
touches more bots and the stair is every town's shared infrastructure. swimunder kills more often per event, so the next S
after shafttrap. The two change different hunks of reflex.mjs (theirs: the floodBranch call sites and a helper block after line
1735; mine: imports beside rideFloorDown, a helper after `airPocketWanted`, the marooned hook after maroonState, the entombed
condition and hook): they rebase onto each other without conflict expected; either order works mechanically. Codex (design
round): "canary protected changes first; showcase then inherits the identical protected tree" -- the same lane.

## 8. Owner decisions

None. Every existing escape stays as the fall-through; `SHAFTTRAP=0` restores the base.
