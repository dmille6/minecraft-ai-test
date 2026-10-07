# toolhygiene — no redundant crafts, most-worn pickaxe first (design, 2026-10-07)

Owner-approved 2026-10-07. One canary, two parts behind ONE switch: `TOOL_HYGIENE=on|off` (default `on`; anything
unreadable -> `on`, and the process says so in its `_tool_hygiene` row). Base: the deployed fleet sha `c6e91a8`
(branch `th-on-c6e91a8`). Rebased variant `th-on-92bc84f` only if towndeposit-02 is KEPT.
**Revision 5** (after review rounds 1-4, each CHANGE from at least one engine): escape-reserve, deposit and
descent-contract composition, the decision-time instrument for G1, G3 re-scoped, sandbox evidence. The review log is at
the end (section 10).

## 1. What is wrong, measured (denominators first)

All numbers from the fleet's own logs, 10-07 00:00Z..17:30Z (the live, un-rotated day; 80 bots).

**Crafts.** Decision stream (`llm-*.jsonl`, 69,879 decisions): 4,606 proposals of `craft stone_pickaxe`, 245 wooden,
58 iron, 1,711 furnace, 1,359 crafting_table. Skill rows: stone_pickaxe 218 crafted, iron 13 (owner's 211 vs 13).
Bucketed by the BEST same-or-better-tier pickaxe the bot held at the decision (uses left):

| best held (stone+) | stone proposals | crafted |
|---|---|---|
| none | 350 | 31 |
| <= 10 | 876 | 41 |
| 11-39 | **3,123** | 83 |
| 40-79 | 42 | 10 |
| 80+ | 215 | 53 |

Wooden: 132 of 245 proposals by bots already holding a wooden-or-better copy with > 10 uses (17 crafted).
Stations: 1,346 of 1,359 crafting_table proposals and 1,705 of 1,711 furnace proposals were by bots that did NOT carry
one at that moment; only 7 crafts in the day were by a bot already carrying the same station (2 tables, 5 furnaces).
The owner's census (69/80 carry a furnace) is the stock at 17:00Z, not the state at craft time: station crafts are
made by bots that placed theirs and walked off. A carried-station refusal is cheap and is included; it is not where
the station volume is (reported, not claimed).

**Hoarding.** Census at 17:31Z from each bot's latest snapshot (`bot.tools`, uses per copy): 80 bots, 338 pickaxe
copies, median 4 pickaxe slots per bot. 144 copies above 10 uses, **163 at 2-10 uses** (133 of them beside a
same-or-better copy above 10), 31 at exactly 1 use. 3 bots hold no usable pickaxe.

**Why the 2-10 copies never get used.** `toolfor.mjs` already picks the cheapest adequate TIER (not mineflayer-tool's
fastest), but inside a tier it takes the FULLEST copy (`byCost`: `b.r - a.r`), and a copy at or below FLOOR (10 uses)
is RESERVED for blocks that need its tier. So stone@120 digs until it falls and the worn copies are kept forever; next
to iron@200 a worn stone copy even leaves the iron to dig stone. When the full copy drops under the ladder's 40-use
line the bot crafts another, and the pile grows. (Round 1 found the hoard is not pure waste: a second usable copy is
the escape reflex's spare — section 4.)

## 2. Prior art (searched)

- mineflayer-tool `equipForBlock` (src/Tool.ts): fastest dig time only, no durability; issues #4 and #5 (open since
  2020) ask for durability awareness, never built. mineflayer-pathfinder `bestHarvestTool` (index.js): min digTime,
  ignores durability; mineflayer-collectblock calls equipForBlock. This repo already replaces those for harvest, reflex
  and pathfinder travel digs with `toolfor.mjs` (skills `bestTool`, reflex `applyToolPolicy`,
  `pathfinder.bestHarvestTool = travelTool`). NOT every path: reflex `pocketPlanFor`/`floodedPocketRung` take the first
  pickaxe in slot order (reflex.mjs:5104, 5138, 5182, 5217) — pre-existing; with hygiene on it now takes a copy above
  HARD_STOP first (more 1-use copies sit in bags under part 2), and its intervals are excluded from the wear diagnostic.
- Baritone `itemSaver` (default false) + `itemSaverThreshold` (default 10): never swing a tool within 10 of breaking;
  `ToolSet.getBestSlot` breaks speed ties toward the lower harvest level. That is this repo's FLOOR/HARD_STOP + tier
  order; neither prefers a worn copy.
- AutoTools (client mod) `preferLowDurability` (default off): among equal-speed tools take the lower durability —
  part 2 as an opt-in client preference. No bot framework found that does it.
- Redundant crafting: Mindcraft `craftRecipe` and Voyager `craftItem` never check what is held (Mindcraft issue #185 is
  a table place/break loop). Planners that do: Plan4MC (arXiv 2303.16563 §4.2, DFS over a running inventory plans only
  what is missing), GITM (arXiv 2305.17144 §3.2, held items are used directly and never re-obtained), JARVIS-1
  (arXiv 2311.05997, inventory self-check). Our refusal is the GITM rule applied at admission.
- Vanilla: durability wood 59 / stone 131 / iron 250 / diamond 1561; iron ore needs stone+, gold/redstone/emerald/
  diamond ore iron+, obsidian diamond+ (minecraft.wiki Pickaxe). The last-use drop is not stated on the wiki; this
  repo proved it on the sandbox before last_swing shipped (toolfor.mjs).

## 3. Part 1 — NO REDUNDANT CRAFTS

### The rule (pure: `toolhygiene.mjs redundantCraft(item, items, { wanted, y, on })`)

A craft is refused only when ALL hold:
1. **The task does not want it.** `item` is not in the admission gate's `wanted` set — the active task's target, its
   family (`wantsAny`) and recipe ingredients (cognitive `#wantedItems`). A prerequisite detour moves `wants`/`wantsAny`
   with it (cognitive `applyPrereq`), so ANY item an unsatisfied prerequisite lists is never refused, whatever its
   names, counts or `minUses` (the ore tunnel's stone/iron/diamond detour, the escape's two-pickaxe ask, a count-2
   station). A rung that wants the item is unmet by its own test, so its work order is never refused.
2. **Pickaxe, harvest rank R** (golden = wooden, as `equivalentTools`): the bag holds a pickaxe of rank >= R with at
   least `need` uses — for a stone or wooden craft the cover must itself be stone/wooden/golden (an iron cover made a bot
   with worn stone copies dig stone with its iron: 146 iron uses over 150 stone digs in Claude's round-2 probe) — `need = MIN_TRIP_USES (40)` for stone, `FLOOR + 1 (11)` otherwise (withdraw's `usableTool`); AND
   - **the escape reserve**: at least `ESCAPE_RESERVE = 2` usable (> HARD_STOP) pickaxes among the names the escape's
     ask counts (wooden/stone/iron/diamond; reflex `pickaxePrereq`). `mayDigForEscape` refuses a stone dig on exactly
     one usable pickaxe and asks for two; a bot holding one stone@52 must be able to craft the second whether or not
     the ask was adopted (Claude round 1);
   - **the descent contract**: the bag's summed swings (`exit-contract pickaxeUses`) are at least what a descent from
     the bot's y keeps in reserve (`descentPickNeed(y)`, extracted from `canContinueDescent`, arithmetic unchanged).
     At y=15 stone@40 + wooden@10 is 48 swings against 62: `mine` refuses for want of a pickaxe and the craft is the
     remedy (Codex round 1). And the shortfall `mine` last refused for is REMEMBERED (`bot.exitPickShort`, 15 min, the
     prerequisite TTL) and honoured wherever the bot is: the refusal tells it to "run surface first", and at the surface
     `descentPickNeed` is 2 (Claude round 2). Not cleared but inert once the bag holds the swings (it re-opens if they
     fall back below within the TTL); forgotten after 15 min.
   Iron is therefore never refused beside stone/wooden: the upgrade path (withdraw2's town craft does not pass
   admission at all).
3. **crafting_table / furnace**: the bag already holds one.
Anything else, or `TOOL_HYGIENE=off`: never refused. (Off restores every DECISION; the telemetry rows -- `_tool_hygiene`
saying off, `_craft_admit`, the exit-shortfall note -- are still written.)

**Refused => every guard that could want the item is satisfied** — the composition property, tested against the REAL
code over 20,000 random bags: the ladder rung (`milestones.mjs` `fulfilled`), `mayDigForEscape(bag, stone)`, and
`prereqHave(bag, pickaxePrereq)`; plus the descent and entombed chains end to end through `AdmissionControl`.

### Why 40 for stone and not 11 (the dead end the obvious rule builds)

The stone rung counts a copy only with >= 40 uses (`milestones.mjs capCount`, the iron trip's budget). 3,123 of the
day's 4,606 stone proposals came from bots whose best copy had 11-39 uses, under `craft_stone_pickaxe_1`. A refusal
at "> 10 uses" would refuse the active rung's own work order every decision. So crafts at 11-39 continue (83/day);
part 2 then wears the older copy out first. To cut them too, the rung itself must change (owner decision, section 9).

### Where — the single admission point

Every `craft` the decision loop dispatches (model proposals AND synthesised work orders) passes
`AdmissionControl.check` (cognitive.mjs #tick). The refusal sits in check's `craft` block right after argument
validation, before every exemption. Internal sub-crafts (craftLevel's table/planks/sticks, the composter build, chest
recovery, withdraw2's iron) do not pass admission and are untouched.

### The refusal names what the bot already has

- pickaxe: `you already hold a stone_pickaxe with 52 uses left (a stone-or-better pickaxe with 40+ uses is all any goal
  asks for) -- dig with it; craft another stone_pickaxe when it is below 40`.
- crafting_table: `... craft uses a carried crafting_table by itself (or: place item=crafting_table)`; furnace:
  `... smelt places a carried furnace by itself (or: place item=furnace)`. craftLevel's station branch places a carried
  table; a second table would face the same placement.
- What the refusal does NOT claim (Codex round 1): that any one follow-up action succeeds. Its claim is narrower and
  is what the property tests: nothing that wants the item is left unsatisfied — not the rung, not a detour, not the
  escape reserve, not the descent reserve — so no action the bot could take is blocked by it. The refusal costs one
  decision. Rejections write no failure, lesson or cooldown (cognitive rejection branch).

### Advice consistent with the refusal

`prompt.mjs craftableNow` already hides a carried crafting_table/furnace. With hygiene on it also omits a pickaxe
`redundantCraft` refuses, called with the SAME `wanted` set cognitive hands the gate (`buildUserPrompt({ wanted })`)
and the bot's y. Same function, same inputs.

### Telemetry (new EVENTS, never new fields; `args` is the mapping's flattened field)

- `_tool_hygiene` once per process at spawn: `tool hygiene ON: mode=on (TOOL_HYGIENE unset)` — the licence row.
- `_redundant_craft` per refusal, snapshot at the decision: args `{item, held, uses, need, kind, task, wanted, source,
  pick_uses, exit_need, wants}` (`wants` = the full wanted set, `|`-joined).
- `_craft_admit` per ADMITTED craft of a pickaxe/table/furnace, snapshot at the decision: args `{item, count, task,
  source, wants}`. The read's G1 population.

## 4. Part 2 — MOST-WORN PICKAXE FIRST

Inside `toolFor` (harvest, reflex and pathfinder travel digs) and `travelTool`'s fallback, pickaxes only, hygiene on:

1. **A worn copy (HARD_STOP < uses <= FLOOR) is open only when BOTH reserves stay in the bag** (`hasKeeper`):
   a KEEPER — a different pickaxe of the same-or-higher tier above FLOOR (it harvests everything the worn copy can) —
   and **two OTHER pickaxes no deposit can take** (`depositSurvivors >= ESCAPE_RESERVE`): every copy at 2-10 uses
   (bankable never moves a spent tool) plus ONE copy above FLOOR per pickaxe name (bankable banks at most usable - 1 of
   a name, the worst first). In base the worn copy is the escape spare (Claude round 1) and survives every deposit;
   counting merely "usable" copies let {120, 60, 8} wear to {120, 60, 1} and a deposit then bank the 60, leaving one
   usable pickaxe where base kept two (Codex round 2). Tested: `depositSurvivors` equals the usable count after the
   REAL `depositPlan` + the transfer's worst-first selection on random bags, and after N digs + a deposit the change
   never holds fewer usable pickaxes than min(2, base).
2. **Within a name, the most-worn open copy goes first.** The candidate is chosen by the deployed transitive cost order
   (cheapest adequate tier within SLACK), then the most-worn copy OF THE SAME NAME in that pool is swapped in
   (`mostWornOfName`, already used for axes/shovels/hoes). Same name = same tier and dig time, so the swap never
   changes which tier or kind digs. In `cheapestOpen` (the travel fallback) the same: deployed order first, then the
   same-name swap — never a shift across kinds onto a pickaxe.
3. **Unchanged**: `reserved_required` keeps the deployed fullest-first (round 1: among copies all at or under FLOOR,
   fullest-first keeps two usable longest); HARD_STOP; last_swing/spend_spent (which by design CAN spend the last
   1-use copy on the stone family — pre-existing); iron retention (a worn iron is never opened beside wood or stone);
   the descent contract (it sums swings across copies; the order of wear cannot change the sum — tested).

Examples (stone): {stone@120, stone@8, stone@5} -> stone@5 (was 120). {stone@120, stone@8} -> stone@120 (unchanged:
the 8 is the spare). {stone@120, stone@60, stone@8} -> stone@60 (a deposit would bank the 60; the 8 is the spare).
{iron@200, stone@8, stone@5} -> stone@5 (was iron@200). {stone@120, stone@50} -> stone@50 (was 120). {iron@5, stone@100} on diamond ore -> iron@5 (only means; unchanged). Qualified claim (Codex round 1): iron@8
beside diamond@200 and two more copies now digs stone with the iron before the diamond — cheaper metal spent first.

Telemetry: `_worn_first`, at most one row per process per 10 min while hygiene changed any HARVEST or REFLEX pick
(`applyToolPolicy`), args = the last changed pick's context `{n, block, chosen, base, reason, mode, picks}` (every
pickaxe in the bag at that moment). Pathfinder travel picks are not tallied: `bestHarvestTool` is also called while
PLANNING (mineflayer-pathfinder movements.js prices every candidate dig), so a tally there counts plans, not digs, and
would double toolFor on the planner's hot path (Codex round 2).

## 5. Tests (behaviour, not text) — bots/test/toolhygiene.test.mjs, toolhygiene-mutants.test.mjs

- Round-2 additions: deposit chain (dig -> real depositPlan + worst-first transfer -> escape) with the deployed policy as
  positive control, and a random version holding while a keeper above FLOOR remains (once every copy is at or under
  FLOOR the deployed reserved_required rules govern the remaining hoard -- draining it to two survivors is the change;
  carrying every spare the deployed policy would have carried is not promised); descent-after-climb chain; iron never
  covers stone; travelTool never returns a 1-use pickaxe and its fallback swaps within a name only; the flooded-pocket
  rung (reflex `pocketPlanFor`, first pickaxe by slot) now takes a copy above HARD_STOP first when hygiene is on.
- OFF IS THE DEPLOYED POLICY: `toolFor` and `travelTool` with hygiene off equal a frozen copy of c6e91a8's toolfor.mjs
  (test/fixtures/toolfor-base-c6e91a8.mjs) on 20,000 random bags x 6 blocks x harvest/travel.
- ON invariants (20,000 random bags): same hand/none answers as base; never a higher harvest rank than base; no
  <= HARD_STOP pickaxe outside last swings; a worn open pick always has its keeper and two other deposit-proof copies; the
  chosen copy is the most-worn same-name copy open by the rule; a redirected dig never drops the usable count below two
  where the base dig kept two; summed exit swings identical on and off after N digs.
- Sequences: harvest 3->2->1->gone before the keeper; travel stops at 1; sole worn iron never opened beside wood.
- Part 1: the rule table, the composition property (rung, escape, prereq), the descent chain at y=15, the entombed
  chain (detour adopted and dropped), netherite and count-2 prerequisites, the switch in a fresh process with
  TOOL_HYGIENE=off, the prompt line.
- 25 anchored mutants (present-and-unique asserted; each probe proven to pass on the real module first) and 4 wiring
  checks (the refusal row; the licence + `_worn_first` rows; the `_craft_admit` row; the shortfall note in mine), each
  shown to fail on its mutated source. The existing toolfor-spent mutants were re-anchored and now also
  require their probe to pass on the real module (three had become vacuous under the new default).

## 6. Proof on Paper (sandbox only, 10.0.0.30:25599-25602)

Driver `sandbox/craft/toolhygiene-ab.cjs` (from tools-ab.cjs): one fresh bot per trial, the scene built by RCON, the
decisions queued through an embedded brain, then the SERVER's truth -- every slot with its damage, ground items, and
every cell whose dig finished read back with `execute if block ... minecraft:air` (a ghost block reads solid); dig
durations from the packet trace (start -> finish per cell; stone with a stone pickaxe is ~0.6 s, by hand 7.5 s).
Candidate = th-on-c6e91a8 (98d09b8 for run 1, 14ac55a for runs 2-4, efbb607 for run 5 = scene e2; 14ac55a -> efbb607
changed tests and a moved comment only), control = c6e91a8, sandbox and sandbox2.

OBSERVED (results-cand/ctrl.jsonl; per arm: 3 trials each of a, b, c, c2; 5 of e; 2 of e2; 2 (+2 excluded) of f; 2 of g):
- (a) REDUNDANT -- bag stone@60 + stone@45 + 3 cobble + 2 sticks + table, queue `craft stone_pickaxe`, `gather 3 stone`.
  Candidate 3/3: refused (one `_redundant_craft` row), no pickaxe crafted, sticks unchanged, cobble +3 from the gather,
  dug with the 45 (damage 86 -> 89), the 60 untouched. Control 3/3: crafted a third stone pickaxe (sticks -2) and dug with
  the NEW full copy.
- (b) IRON -- stone@131 + wooden@30 + 3 ingots + 2 sticks + table: both arms 3/3 crafted the iron pickaxe (ingots -3).
- (c) WORN -- {stone@120, @8, @5}, gather 5 stone. Candidate 3/3: the 5 dug 5 times (damage 126 -> 130) and broke on its
  last use via spend_spent (stone_pickaxe -1: a slot freed), the 8 and the 120 untouched. Control 3/3: the 120 dug.
- (c2) SPARE -- {stone@120, @8}: both arms dug with the 120; the 8 kept (the deposit-proof spare).
- (e) TRAVEL -- {stone@120, @8, @4} sealed by stone, goto across a 2-high stone band. Candidate 5/5 trials: the 4 dug
  all 3 travel digs the scene needed and reached 1 use (damage 127 -> 130); the bot climbed out over the band, so no
  4th travel dig happened. Control 5/5: the 120 dug. The trace shows the same client-side lag as (g) (the same `used`
  twice in a row).
- (e2) TRAVEL PAST THE WORN COPY (Codex round 4) -- same bag, a stone wall 11 thick and 7 high, goto its far side. Candidate
  2/2: the 4 dug 3 travel digs to 1 use, then the pathfinder's next digs took the 120 (used 11 -> 20/22) for 9-11 more;
  the 8 untouched; 0 ghosts of 26 finished digs. Control 2/2: the 120 dug all (0 of 24). Both arms' goto ended
  "entombed" inside the tunnel (the entombment reflex fired in the 1-wide bore; harness geometry, both arms).
- (f) MINE (stair digs, back to back) -- same bag on a stone mass, `mine 113` (2 earlier trials per arm were refused by
  mine's home-floor guard -- home was set at the stand -- and are excluded; home moved 60 blocks off). Candidate 2/2: the 4 dug 3 stair digs to 1
  use, then the 120 dug the remaining 9 (12 digs per trial); control 2/2: the 120 dug all 12. Both stopped at y=115 on
  the open space under the arena (harness geometry, both arms).
- (g) ENTOMBED ESCAPE (reflex digs) -- same bag sealed in stone, no decision. Candidate 2/2: the reflex dug out with the 4,
  and the copy BROKE on its 4th dig: the client still showed 2 uses (stale durability, the trace shows the same `used`
  twice) when the server had 1, so HARD_STOP let it swing once more. The dig was a normal tool dig (0.6-0.8 s, block
  broken, no ghost); the copy it broke had been opened only beside a keeper and two deposit-proof copies, so the bag
  kept two usable. The same lag exists in the deployed policy for a sole worn copy (reserved_required).
- GHOSTS / HAND SPEED (all trials, `scratchpad .../th/digtimes.py` over results-cand/ctrl.jsonl): candidate 0 ghost cells
  of 116 finished digs, no pickaxe dig over 0.84 s (the only > 3 s digs in either arm are the bare-hand 3.75 s retake
  of the crafting table). Control: 5 ghost cells of 144 (pre-existing; in redundant, spare, worn).

## 7. The read (`scripts/host/toolhygieneread.py`)

- LIVENESS: canary `_tool_hygiene` ON rows; `_redundant_craft` and `_craft_admit` rows. Control: none of them.
- CORRECTNESS (any breach reverts), each re-derived by the read from the row's OWN snapshot (taken at the decision)
  with an independent Python implementation of the rule:
  - G1 admitted-redundant: a canary `_craft_admit` the rule (given the logged `wants`) calls redundant, exactly (the row's
    snapshot is taken in the same tick as the check; the 3-use margin is only for the decision-stream positive control,
    whose snapshot precedes the check by the model's latency).
  - G2 refused-unjustified: a canary `_redundant_craft` the rule does not justify from its snapshot (no cover at need,
    fewer than 2 usable, exit-short at the snapshot's y, no carried station) — "full" accepted for a copy with
    unknown durability.
  - G3 worn-pick-unjustified: a canary `_worn_first` whose logged context does not justify the chosen copy (chosen at
    <= HARD_STOP outside last swings; a worn chosen copy with no keeper or fewer than two other deposit-proof copies; a
    more-worn same-name copy that the rule opens). The exit-shortfall memory is re-derived from the bot's own
    `_exit_reserve_abort` rows (reason pickaxe, last 15 min) for G1/G2.
  - G4 refused-wanted: a refusal whose own `wants` contains the item, whose task is `craft_<item>_*`, or whose source
    is a work order.
- POSITIVE CONTROLS: the same G1 rule over the CONTROL's decision stream (`llm-*.jsonl`: START snapshot, proposal,
  `llm.error`, task id) finds admitted redundant crafts (>= 1; 59-67 per 6 h on 70 bots in the dry runs); and control
  wear intervals where the fullest copy wore beside a more-worn copy the hygiene rule OPENS (keeper + deposit
  survivors; a two-copy spare does not count) (>= 1; ~2,700 per 6 h). Both re-derived, never the bot's own rows.
- EFFICACY (exposure, observed not intended): canary snapshot intervals where a <= 10-use copy wore while the fullest
  stayed (>= 1). `_worn_first` rows are decisions (applyToolPolicy also runs for capability probes), so they gate G3
  only and count once toward liveness. The read resets the exit-shortfall reconstruction at each `_tool_hygiene` row
  (a new process starts with no `bot.exitPickShort`), skips other-build canary rows without accruing their time, and
  splits intervals at the cutoff.
- DIAGNOSTIC (reported, never a gate): best-first wear intervals from consecutive snapshots ordered by
  `game.tick` (null dropped, ties ambiguous), counted only where unambiguous, with the mirror on the control and both
  denominators; canary worn-first wear intervals (worn copy lost uses beside an unchanged keeper) as the efficacy
  signal; `flooded_pocket_rung` intervals excluded.
- PRIMARY (REPORTED): redundant crafts per bot-h DiD (decision stream, both arms, same rule), pickaxe slots/bot DiD,
  all slots/bot DiD, share >= 34 DiD, bot-time with fewer than two usable pickaxes DiD, pickaxe-less bot-time,
  escape refusals (`maroon_dig_refused`, `marooned_needs_pickaxe`, `entombed_unrecoverable`) per bot-h DiD, pickaxe
  breaks by use per bot-h, stone_pickaxe crafts per bot-h.

## 8. Exposure (stated before the canary)

Dry run (6 h, 70 control bots, the read's own rule): 67 admitted redundant crafts, ~0.17 per bot-h -> ~10 refusals per
10 canary bots per 6 h. Part 2 under the final rule (census 18:04Z, drained by simulation): 95 of 155 worn copies in
31 of 80 bags can be drained (~3 slots per affected bag); `_worn_first` counts harvest/reflex picks only, at most one
row per bot per 10 min. Exposure = >= 5 canary `_redundant_craft` rows AND >= 1 canary `_craft_admit` row (G1 has a
population; also its own liveness line) AND observed canary worn-first wear (a <= 10-use copy wore while the fullest
same-name copy stayed) >= 3 intervals AND at a higher per-bot-h rate than the control's AND >= 1 canary `_worn_first`
row AND both positive controls >= 1. The deployed toolFor cannot produce that wear pattern (an open same-name copy
above FLOOR digs first; reserved_required is fullest-first; 1-use copies are excluded by the count rule), so the
control's own ~0.05 per bot-h (10 per 3 h on 70 bots) is noise from dig paths outside toolFor; with "at least 1" a
10-bot canary would have passed on that noise most of the time (Claude round 4). Below it the read extends, then
records INCONCLUSIVE. Draw: pools with >= 20
`craft` rows naming stone_pickaxe in 6 h (the population the refusal targets).

## 9. Risks and owner decisions

- The 11-39 stone crafts (83/day) continue by design (rung composition). Cutting them needs a rung change (owner).
- The escape reserve keeps two usable pickaxes in every bag the change touches: the hoard drains to two, not one.
- Station crafts by non-carriers (the bulk) are untouched; their cause (placed and abandoned stations) is separate.
- Prompt change: `CAN CRAFT NOW` loses a pickaxe the admission would refuse.
- Part 2 drives more copies through the 2 -> 1 window on non-harvest digs (mine's stair, escape digs, travel), where
  no held-copy check exists. Paper (section 6): travel and mine stopped at 1 and switched (f), 0 ghosts, no hand-speed
  dig; the ENTOMBED ESCAPE (g) broke the worn copy on its last use 2/2 because the client's durability lagged on
  back-to-back reflex digs. DECISION: accepted -- a normal tool dig (block broken, no ghost), one use earlier than
  HARD_STOP intends, of a copy that was opened only with a keeper and two deposit-proof copies in the bag (the escape
  reserve held); the deployed policy has the same lag for a sole worn copy. Hardening (open a worn copy on non-harvest
  digs only above HARD_STOP + 1) is a one-line follow-up if the fleet shows otherwise (pickaxe breaks are reported).

## 10. Review log

- **Round 2 (design r2 + code)** — Codex CHANGE (1): the escape reserve did not compose with DEPOSITS ({120, 60, 8}
  -> dig 7 -> {120, 60, 1} -> deposit banks the 60 -> one usable). Fixed with `depositSurvivors` (above) and a
  dig -> real deposit -> escape regression with the deployed policy as its positive control; also: `_worn_first.n`
  counted pathfinder planning calls -> travel picks no longer tallied. Claude CHANGE (6): iron covering a stone craft
  re-introduced iron burn; the descent exemption held only at the refusal's depth (fixed: remembered shortfall);
  cheapestOpen HARD_STOP pin + no cross-kind shift (fixed: deployed choice first, then same-name swap; test + mutant);
  sandbox the 2 -> 1 window on mine/escape digs (scenes f, g); doc drift; pocketPlanFor first-slot pickaxe (gated).
- **Round 3 (code + read + registration + Paper)** — Codex CHANGE (5): reset the read's exit-shortfall reconstruction per
  connection; part-2 exposure from observed wear and a positive control needing a copy the rule opens; other-build rows
  accrue no time and break the chain, intervals split at the cutoff; complete the Paper evidence (mine, travel, escape
  break, dig durations); doc drift. Claude CHANGE (5): wiring checks for `_craft_admit` and mine's shortfall note; a G1
  population line (`admits_canary`); record the escape break with a decision; doc drift; registration figures. All done.
- **Round 4** — Codex CHANGE (2): wear intervals compared across an excluded-build stretch (fixed: snapshot segments,
  offline asserts with an uninterrupted positive control); show the pathfinder's dig AFTER the worn copy reaches 1
  (scene e2). Claude CHANGE (4): the observed-wear exposure could pass on the control's noise (fixed: >= 3 and above the
  control rate); section 6 counts reproduce from the files (0/116 vs 5/144); doc drift; cherry-pick round 3 onto the
  92bc84f variant (done, re-tested).
- **Round 5** — Codex APPROVE; Claude APPROVE (non-blocking: section 6 run/sha header and trial counts -- fixed; launch the
  92bc84f variant only after its re-test on the round-3 cherry-pick is green).
- **Round 1 (design r1)** — Codex CHANGE (7): descent-contract dead end; prereq names/counts; overstated remedy claims;
  G1 END-snapshot reconstruction; G2/G4 evidence; G3 identity/ordering/mirror; narrow safety claims + sequence tests.
  Claude CHANGE (10): escape-reserve dead end (one usable pickaxe); part 2 drains the escape spare; non-toolFor dig
  paths; cheapestOpen cross-kind shift; tier vs rank; travel-dig lag proof; G1 from the decision snapshot; G4
  tautology; G2 unknown durability; G3 ordering/verdict; exposure; doc drift. All addressed in revision 2 as above.
