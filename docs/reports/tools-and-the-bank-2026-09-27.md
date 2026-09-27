# Four changes to design, build and DEPLOY. Owner has authorised implementation.

_written 2026-09-27 22:24Z (date -u). The owner's instruction: both engines review items 1-4, find the best
solutions, implement and deploy. So this is not "should we" — it is "what exactly, and how do we
know it worked"._

---

## THE FINDING THAT REORDERS EVERYTHING, measured tonight

**Bots carry dead tools while good ones sit in the town chests.**

```
HELD, from raw.bot.tools, all 80 bots, latest record each
  pickaxes per bot   1:8  2:23  3:12  4:14  5:8  6:7  7:4  8:2  11:1  12:1
  durability of every held pickaxe (n=295)
      <=10%  237      11-25%  21      26-50%  11      51-75%  12      >75%  14
      min 0.4%   p25 0.8%   MEDIAN 1.7%   p75 2.3%
  the BEST pickaxe each bot holds: median 1.7%, p75 45%
  bots whose best pickaxe is <=50%: 63 of 80 = 78.8%

BANKED, RCON slot-by-slot, the 12 un-reseeded worlds (n=1,382 stacks)
      <=10%  480      11-25%  82      26-50%  144     51-75%  192     >75%  484
      min 0.8%   p25 1.7%   MEDIAN 48.1%   p75 88.1%   max 100%
  ABOVE 50%: 676 of 1,382 = 48.9%.  With NO damage tag at all (unused): 112.
```

**A bot with a 1.7% pickaxe stands ~48 blocks from 484 pickaxes above 75% and 112 unused ones, asks
to craft a new one 5,211 times a day, and fails for want of 2 sticks.**

Positive controls: the stack count 1,382 matches the independent item census of 1,355 for the same
worlds; 0 stacks had damage exceeding the type maximum; `axes`, which the prompt does NOT
re-advertise, sit at a median 7.6% held — so worn-out tools are a fleet-wide condition, not a
pickaxe artefact.

**This corrects a conclusion I published earlier today.** I framed 5,211 pickaxe proposals as "demand
fiction" because the bot "already holds six". Six DEAD ones. The demand is real, the prompt's
pickaxe exemption is CORRECT, and I priced the withdraw fix at "1-2/day" on a false premise.

---

## ITEM 1 — `withdraw` refuses to walk home. `deposit` walks home.

**Source-verified.** `deposit` (`skills.mjs:2172-2189`): when `findChest()` (maxDistance 48) returns
nothing it calls **`home(ctx, {}, signal)`** — deliberately `home` and not `goto`, to inherit retry
across hazard interrupts and route repair. Its comment: *"a 48-block scan cannot see it from a mine.
Walking home first is the difference between 'deposit works near town' and 'deposit works'."*
`withdraw` (`skills.mjs:3764-3770`): `findBlock(maxDistance: 48)` then an immediate
`nothing_found`.

**Measured, 24 h:** deposit 3,997 rows / 74 bots / 269 successes. withdraw 44 rows / 22 bots /
**3 successes (48 items)**. **34 of the 44 failures are the literal "no chest or barrel within 48
blocks".**

**Known hazards a previous review raised and I have not resolved — address them or say why not:**
- `skills.mjs:3781` `await bot.openContainer(chestBlock)` is **unbounded and outside the try**;
  `deposit` wraps the same call in an 8 s `withTimeout` after a `chestLidBlocked` check
  (`skills.mjs:2216-2230`) and measures **138 lid-blocked opens a day at 20 s each, at town chests** —
  exactly where homing sends withdraw.
- `withdraw` searches **ONE** container and returns `nothing_found` if the item is not in it
  (`:3793-3797`); `deposit` iterates up to three (`:2330-2348`). With ~30 stacks per container,
  P(nearest chest holds any given item) is well under 1.
- `SKILL_CONTRACTS.withdraw.maxMs` is 60 s against deposit's 240 s — though `maxMs` has no runtime
  consumer; the real cap is `config.skills.defaultTimeoutMs = 180_000`.
- After homing, every withdraw failure happens at ONE coordinate, where `lessons` place-scoped
  amnesty (`PLACE_RADIUS = 96`) stops granting forgiveness. `nothing_found` is in
  `EVIDENCE_ONLY_IF_HERE`.
- mineflayer 4.37.1 throws `destination full` mid-transfer and leaves the stack on the cursor;
  inventories sit at a median 28 of 36 slots.

**Questions:** does withdraw become a travel skill, or does a deterministic obligation call `home`
first and then withdraw? Does it need the three-container sweep to be worth deploying? And **what
does it withdraw — a pickaxe, or the sticks to make one?** Withdrawing a finished tool needs no
recipe at all.

## ITEM 2 — `explore` cannot be aimed

**Source-verified.** `skills.mjs:3604`:
`async function explore(ctx, { blocks = 60, heading = null, toward = null }, signal)` — the
function accepts a direction and the code to use it is written. `skills.mjs:6943`:
`explore: { run: explore, usage: 'explore [blocks]', args: ['blocks'], rescue: true }` — the
dispatch declares only `blocks`. `prompt.mjs:248` tells the model only `{"blocks": <distance>}`.

**Measured:** 14,043 explore calls in 24 h; **14,042 supplied `blocks` alone (100.0%)**. Distance
from each world's own town, from 561,234 position observations: worn worlds median **32-190 blocks**,
fresh worlds median 198-605, farthest any bot ever reached 1,250 of a 1,950 border.

Explore is already the **second most proposed skill** — 28,239 proposals/day, 15,758 admitted,
12,024 rejected `repeat_loop`. **So frequency is not the lever; aim is.** The owner asked whether to
raise the suggestion rate when idle (28% of prompts read `TASK: Nothing to do.`) and I argued no
until it can be aimed. Confirm or refute that.

**Questions:** declaring `heading`/`toward` requires the schema AND the prompt line, per
`grammar-pattern-makes-it-unsayable` — Ollama compiles the JSON schema, so an undeclared arg is
literally unsayable. What is the right argument shape for a 7B model: a compass word, a bearing in
degrees, or a coordinate? And does adding an arg **fragment the `explore:{}` avoid key**, which
36,000+ `repeat_loop` rejections currently depend on collapsing?

## ITEM 3 — tool hoarding

12 pickaxes on one bot, median held durability 1.7%, inventories at a median 28 of 36 slots, and
`bankable.mjs` keeps one of each tool NAME. **Questions:** should a bot keep the best one and bank
the rest, or drop the dead ones? Is a dead pickaxe worth banking at all — 480 of the 1,382 banked are
at <=10%, so the bank is half landfill? And does this interact with item 1: if withdraw starts
pulling tools out, the bank must not hand back a 1% pickaxe.

## ITEM 4 — the owner's durability gate on the prompt suggestion

`prompt.mjs` `craftableNow()`: `if (items.some(i => i.name === name && i.count > 0) &&
!name.endsWith('_pickaxe')) continue`. Measured consequence: **7,617 of 8,132 `CAN CRAFT NOW:
stone_pickaxe` lines in 6 h were shown to a bot whose inventory already listed one**, and naming it
makes the model **2.4x** more likely to propose it (3.3% of 77,336 decisions vs 1.4% of 7,346).

**But the measurement above says the gate would only suppress 21.2% of bots**, and the behaviour it
suppresses is mostly correct. **Is item 4 worth deploying at all, or does item 1 make it moot?**
Rank it honestly; the owner proposed it and deserves a straight answer either way.

---

## WHAT I NEED FROM YOU, because this is going to be deployed

1. **One ranked build order for items 1-4, with anything you would DROP said plainly.**
2. **For each thing to build: the exact change, the behavioural test, and the mutant** that proves the
   test can fail. Pure exported functions where possible — this repo's source-greps have passed for
   the wrong reason five times in one day.
3. **The deploy shape.** One canary pool of 5 drawn from the 12 un-reseeded worlds (never mixing the
   4 fresh ones — fresh median 95.7 items/bot-h against control 31.9), or fleet-wide? One canary pool
   EVER at a time. Name the endpoint, the exposure floor, and the read minutes BEFORE it runs.
4. **The measurement contract**: population, denominator, unit, stock-or-flow, and which FILE the
   number comes from. Every headline I published today was wrong on the first attempt, and the
   decision stream (`llm-<bot>.jsonl`, which `Events.load()` cannot see) is where proposals and
   rejections live.
5. **A placebo anchor for any causal claim**, after a fully source-verified chain failed at 3.7%
   against a 3.2% gather anchor today.
6. **What must NOT be deployed.**

## Rules
- Every negative claim carries a positive control, **and it must come from a different instrument
  than the claim** — today a control drawn from the same blind query produced a wrong conclusion.
- `file:line` for everything. Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: what to build first, and the one query that shows within 6 hours whether it
  worked.

---

# TWO OWNER QUESTIONS ASKED MID-REVIEW. Both change the scope of items 2 and 3.

## Q: do we log where bots have EXPLORED? Per bot or shared? Can an idle bot seek unexplored ground?

**No, and that is the reason item 2 cannot simply be "suggest explore when idle".**

**SOURCE-VERIFIED.** `worldfacts.mjs` records where **THINGS** are, not where a bot has **BEEN**:
`reportResource(kind, pos, by)` at `:205`, merging any sighting within `RESOURCE_MERGE = 24` blocks
into one entry (`:211`), capped at `MAX_RESOURCES = 200` with `slice(-200)` (`:123`), decaying by
halving per 12 h period, and **pool-shared** unless `memory.scope === 'isolated'`.

A grep across `bots/src/*.mjs` for `visited|explored|been_here|frontier|coverage|territory` returns
**no spatial visited-map at all**. Positive control, same grep: it does find `digapproach.mjs:380`
`visitedNodes` (A* search nodes, not places), `cognitive.mjs:159` `coverage` (a sampling-window term
in the fixation detector), and `board.mjs:33-42` / `milestones.mjs:273` which discuss "the frontier"
**in comments only**. So the grep can find these words where they exist; the concept does not.

**What direction exists today:** `knownTarget(bot, toward, radius = 400)` (`skills.mjs:3641`), called
only by `explore` (`:3692`). So a bot walks toward a remembered RESOURCE if it has one, and otherwise
picks a random bearing. **There is nothing that could answer "where have I not been".**

**Questions for you:**
1. Is a visited-map worth building, and at what resolution? A chunk-level set (16x16) over a
   1,950-block border is ~14,900 chunks per world — cheap as a bitset, but it is **new persisted
   state**, and `worldfacts`' own failure modes (24-block key collapse, silent `slice(-200)`
   truncation, halving decay, pool-shared so treatment-mediated) are the template for how it goes
   wrong. Name the shape that avoids each.
2. **Per bot or shared?** Shared covers ground faster and is the whole point of a colony; it is also
   what makes an effect differ by arm. 5 bots per world.
3. Is "walk to the nearest unvisited chunk" even the right objective, or is the honest objective
   "walk to where a resource was last seen and is likely to have regrown"? The fleet's problem is
   depletion, and unexplored ground is a proxy for undepleted ground, not the thing itself.
4. Cheapest version that needs NO new state: `explore` already gets a bearing; **bias the random
   bearing away from the town and away from the last N bearings**, which needs only in-memory
   history. Is that most of the value for none of the risk?

## Q: what can we do with dead pickaxes?

**The clever answer is not reachable, and the boring answer is already item 1.**

**EXTERNAL BEHAVIOUR, checked rather than assumed:**
- **Grid repair — combining two damaged tools of the same type into one with their durability summed
  plus 5% — is real in vanilla and NOT available to these bots.** `minecraft-data` 1.21.8 lists
  **3** recipes for `stone_pickaxe`, all `cobble-variant + stick` (`[[9,9,9],[null,905,null],
  [null,905,null]]` and two siblings), and **0 recipes combining two `stone_pickaxe`**. Positive
  control: the same query does return the three real recipes, so the table is being read correctly.
  And `mineflayer` 4.37.1 exposes **no** `Bot.prototype` method matching `craft|repair|smith|anvil`
  beyond the ordinary recipe path. Grid repair would need hand-rolled crafting-window clicks.
- **Wooden tools as furnace fuel** is real in vanilla, but `minecraft-data` 1.21.8 exposes **no fuels
  table** (`mcData.fuels` is undefined), so the smelt path would need a hardcoded burn list. Wooden
  pickaxes are 490 of the 1,382 banked stacks.
- **Stone tools are genuinely worthless**: not fuel, not smeltable. 865 of the banked stacks.
- **Iron tools** smelt to a nugget, and iron is the fleet's ceiling with 28 ingots banked — so an iron
  pickaxe should never be scrapped.

**So the answer to "what do we do with dead pickaxes" is: stop needing them.** 484 banked pickaxes
are above 75% durability and 112 are unused, against a held median of 1.7% — so **withdrawing a good
one beats repairing a dead one, costs no sticks, and item 1 already unlocks it.**

**Questions:** is grid repair worth the hand-rolled window work later, given 480 of 1,382 banked
pickaxes are also at <=10% and repair would compound them into a few usable ones for free? And for
item 3, should a dead tool be **dropped** rather than banked, given the bank is currently ~35%
landfill by stack count?
