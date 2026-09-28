# The equip is unreachable, and the wood number was wrong — 21 Sep 2026

_Written 2026-09-21 11:20–11:55 UTC by the daily operator session, against `cfc1c58+e1d1b2`
fleet-wide (80 bots, one version). No canary was live; the slot was free all day._

This session took no new ground. It tested the two claims the overnight session left as
its handoff, and **both need correcting before anything is built on them.** One of them
was about to become a canary.

Every number below states its denominator and every read printed a positive control first.
Scripts: `equipblind.py`, `craftwhy.py`, `craftadvice.py`, `gout.py`, `birch.py`
(this Mac, `~/mcai-analysis/`; run on `.31` against `/var/log/mcai/*/skill-*.jsonl`).
Window: a full 360-minute walk, 216,864 rows / 80 bots / 114 event kinds.

---

## 1. THE PROPOSED NEXT CHANGE IS AIMED AT 1.5% OF ITS POPULATION. Do not build it.

The overnight handoff named this as "►► THE NEXT CHANGE":

> The bug is the silently-failing equip, not which sites arm the watchdog. `bestTool`
> returns only harvesting tools or `null`, so a watchDigging cancel at `skills.mjs:1195`
> **proves the equip three lines above at `:1191-1192` failed or was undone**. First step
> is to stop swallowing it so the failure has a name.

The inference has a hole, and the code closes it without needing any data:

```js
const tool = bestTool(bot, block)          // skills.mjs:1184
if (tool) await bot.equip(tool, 'hand').catch(() => {})   // :1185
```

`bestTool` → `applyToolPolicy` → `toolFor`, and `toolFor` filters candidates with
`remaining(it) > HARD_STOP`, `HARD_STOP = 1` (`toolfor.mjs:15,51`). A pickaxe at
130 used of 131 has `remaining == 1`, which is **not** `> 1`. So `eligible` is empty;
stone is not hand-harvestable so `handOk` is false; `toolFor` returns
`{item: null, hand: false, reason: 'none'}`; **`if (tool)` is false and the equip never
runs.** A cancel below it proves nothing about an equip that was never attempted.

Measured, on the fleet, at the nearest tools snapshot to each cancel (median gap 1.0 s,
p90 3.9 s):

| | | |
|---|---:|---|
| **denominator** | **327** | watchDigging (`skills.mjs:169`) dig collisions in 360 min |
| pickaxes held, **all** at remaining ≤ 1 → `toolFor` returns none → **equip never reached** | 321 | **98.2%** |
| a swingable pickaxe existed → equip **was** attempted and failed | 5 | 1.5% |
| no snapshot | 1 | 0.3% |

Blocks: stone 165, cobblestone 148, iron_ore 8, coal_ore 6 — 96% of the population is
stone/cobble, which any pickaxe tier harvests, so "a pickaxe with remaining > 1 exists"
is exactly "toolFor would have returned an item". The discriminator is not a proxy.

**An instrument on `:1185` would have covered 5 events of 327.** That is the blind
instrument this project keeps shipping — `digwatch-01` was closed INCONCLUSIVE for the
same reason nine days ago, and the framing that produced it ("682 of 682 had a harvesting
pickaxe in the pocket") was itself already corrected once overnight for never reading
durability. It has now been corrected twice: the pocket does not hold a remedy, and the
line that would use one is not on the path.

The five real cases exist and are a different bug (e.g. `board-b-Alpha` cancelled on
stone holding pickaxes at 95/96 remaining). They are 1.5% and do not justify a slot.

### What the 98.2% actually is
Three correct policies composing into "cannot mine", with no trace but `Digging aborted`:

1. `toolFor` refuses every pickaxe at remaining ≤ `HARD_STOP` — added so the last tool is
   not ground to dust (iron-retention v3), and it returns `reason: 'none'`.
2. `applyToolPolicy` then **deliberately swaps a non-tool into the hand** so "dig by hand"
   does not secretly dig with a reserved pickaxe (Codex pass 1 on that change).
3. `watchDigging` cancels the dig, correctly, because dirt cannot harvest stone.

This is CLAUDE.md's refusal class exactly: **`reason: 'none'` names no remedy the bot can
perform from where it is.** Note the asymmetry that makes it a bug rather than a policy —
the `FLOOR` reservation has an escape hatch (`reserved_required`, returned when only a
reserved tool can harvest the block); `HARD_STOP` has none.

### Fleet tool state, 360 min, denominator 80 bots reporting a tools snapshot
- **18** have a pickaxe with remaining > 1 (can mine)
- **62** carry pickaxes but every one at remaining ≤ 1
- **0** carry no pickaxe at all
- **261 dead pickaxe stubs held fleet-wide** (`board-a-Alpha`: six stone pickaxes, all 130/131)

**Raising `HARD_STOP` is still not the fix**, and neither is a last-resort rung: 261 stubs
× 1 use = 261 blocks, once, fleet-wide. The ceiling is too small to canary.

---

## 2. "THE ROOT IS WOOD AT 10%" — the 10% is oak only, and the fleet number is 23.1%

The overnight read reported "wood at 10% success" as the root of the chain. My first
attempt to reproduce it matched substrings in `skill.detail` and returned **0.0% success
for every target** — a uniform answer, which is the signature of a detector that cannot
see the thing it counts, not a finding. The outcome is a field: `skill.status` and
`skill.fail_class`. Corrected:

**GATHER BY TARGET — denominator 8,791 gather runs / 360 min / 80 bots**

| target | runs | success | top fail classes |
|---|---:|---:|---|
| oak_log | 3,483 | **12.1%** | no_safe_target 1244, unreachable 1179, no_path 267 |
| dirt | 2,313 | 55.6% | no_path 630, interrupted 173 |
| sand | 994 | 14.0% | no_safe_target 349, unreachable 277 |
| iron_ore | 658 | 0.9% | unreachable 428, no_safe_target 113 |
| cobblestone | 580 | 10.9% | no_path 472 |
| stone | 397 | 19.9% | no_path 238 |
| **birch_log** | **83** | **34.9%** | unreachable 16, no_safe_target 15 |
| oak_sapling | 60 | 0.0% | nothing_found 60 |
| **ALL** | **8,791** | **23.1%** | unreachable 2200, no_safe_target 1759, no_path 1744 |

- The fleet gathers at **23.1%**, not 10%. The 10% figure is `oak_log` specifically.
- **`oak_log` is 39.5% of every gather run the fleet makes and is among its worst woods.**
- **Starvation is downstream, and this replicates**: wood success 12.4% on starved bots
  (2,767 runs) vs 13.5% on healthy (800). The overnight session's central claim holds.
- `no_safe_target` on oak reads *"found but all 10 candidates are beside water or under
  falling blocks — digging them would flood or bury this spot [liquid:10]"*. That is
  STATE.md queue item 3's leading hypothesis — the bots have flooded their own
  surroundings — and it is the component the seed canary's fresh terrain cut by 69%.

### The oak/birch gap is a HYPOTHESIS, not a finding — the within-bot control is n=1
The obvious rival is selection: oak is the milestone's advertised target and is asked
everywhere, birch is asked only where birch is visible. The control is bots that tried
both. **Exactly one bot tried each ≥ 10 times** (`placebo-b-Alpha`: oak 29/78 = 37.2%,
birch 15/16 = 93.8%) — same direction, and it sits in a re-seeded pool, so even that one
bot is special. 83 birch runs against 3,483 oak cannot carry a fleet claim. Registering
it as a hypothesis, not scoring it.

What is not in doubt is where the oak comes from: `milestones.mjs:184` is
`M.gather('oak_log', 8, 'Enough wood to be self-sufficient out there.')`. The *counter*
was already widened to any log (`milestones.mjs:563`, "WOOD IS WOOD") and the hint at
`:583` already says *"gather with block=oak_log, or any other _log you can see"* — but the
advertised target still leads with oak, and the fleet targets oak over birch 42:1.

---

## 3. A refusal that names an unreachable remedy — real, and **inert**

84.2% of craft rows are refusals (896 of 1,064 in 360 min). The largest single failure
detail in the fleet is *"cannot craft stone_pickaxe -- gather cobbled_deepslate first"*.

**Stone-pickaxe refusals naming a gather target — denominator 396:**

| material the bot is sent for | count | |
|---|---:|---|
| `cobbled_deepslate` | **245** | generates only below y≈0 |
| `oak_log` | 161 | |
| `bamboo` | 74 | jungle biome only |
| `cobblestone` | 23 | the one tag member available at the surface |

**Bot y at the refusal: median 68; 2 of 396 are below y=0.** The recipe resolver picks an
arbitrary member of the stone-tool ingredient tag and sends the bot after it.

**The check is not wrong** — 0 of 396 cases had the bot holding ≥ 3 of the tag and being
refused anyway. This is advice only.

**And the advice is inert.** Fleet-wide, over the same 360 minutes: **zero gather runs
target `cobbled_deepslate`** (positive control: the same query resolves targets for 12
other blocks in the same window, including bamboo 91 and cobblestone 580). The model
ignores it. This is "advice printed is not advice taken" measured at zero uptake.

**Consequence for the queue: fixing the advice is predicted null and must not take the
slot.** It is dead text in the observation window. The deterministic form of this remedy
is the missing `craft → gather` edge already on record, which is a design change and
needs the registered dual review.

---

## 4. Materials, and why the deadlock is self-locking

Latest inventory snapshot per bot:

| | starved (62) | healthy (18) |
|---|---:|---:|
| holds cobblestone | **27%** | **100%** |
| holds sticks | 61% | 67% |
| holds logs | 23% | 39% |
| holds a crafting table | 89% | 83% |
| **can craft a stone pickaxe now** (3 cobble + 2 sticks) | **5%** | **44%** |
| can craft a wooden pickaxe now (3 planks + 2 sticks) | 5% | 11% |

Cobblestone is the cleanest discriminator and is also **reverse-caused** — healthy bots
hold cobble *because* they have a working pickaxe. It is not evidence that cobble is the
upstream constraint. The escape hatch that does not require a pickaxe is the wooden route,
and only 5% of starved bots hold its materials while 23% hold ≥ 2 logs.

---

## Standing corrections this leaves

1. **`skills.mjs:1185` equip instrumentation: DO NOT BUILD.** 1.5% of its population.
2. **"wood at 10%"** → oak_log 12.1% of 3,483; fleet gather 23.1% of 8,791. Say which.
3. **"the remedy was in the bot's pocket"** is now retired in both its forms: the pocket
   holds stubs, and the line that would use one is not reached.
4. **Never read a gather outcome out of `skill.detail`** — it is `skill.status` /
   `skill.fail_class`. A per-target success column that is 0.0% everywhere is a blind
   detector, not a result.
5. The oak/birch gap is a hypothesis with an n=1 within-bot control.

---

## 5. The seed canary's tooling confound — tested, and it does NOT explain the effect

The overnight session raised a rival for the seed canary's +29 to +32 pp: *"a reseed resets bot
state, which includes handing bots working tools. Nobody has ruled out that the re-seeded pools
were simply the only bots with live pickaxes."* With 62 of 80 bots fleet-wide holding only dead
stubs, that rival is worth taking seriously. Script: `seedtools.py`.

**The exposure half of the rival is TRUE.** Live-pickaxe share, denominator = each pool's 5 bots:

- **re-seeded pools 5/10 = 50.0%**
- every other pool **13/70 = 18.6%**

(placebo-b 3/5 and placebo-a 2/5; five pools — board-c, board-d, hive-b, hive-c, isolated-d — are
at 0/5.) So the re-seeded pools really are better tooled.

**But stratifying on tool state removes the rival rather than supporting it.**
Gather success, denominator printed in each cell:

| | has a live pickaxe | only dead stubs |
|---|---:|---:|
| **re-seeded** | **50.5%** of 457 | **43.4%** of 541 |
| all other pools | 18.4% of 1,262 | 20.1% of 6,520 |

The seed gap is **+32.1 pp among tooled bots and +23.3 pp among starved bots.** It survives inside
both strata, so tooling is not what produces it.

**And the same table independently re-confirms that starvation is downstream**, with a cleaner
design than the wood-only split: in the control pools, holding a live pickaxe is worth
**18.4% vs 20.1%** — flat, and if anything slightly negative.

**Limitation, stated rather than buried:** each bot is assigned to a stratum by its *latest* tools
snapshot, so a bot that wore out its last pickaxe mid-window has all 360 minutes of its runs counted
as "dead stubs". That blurs the two strata. It is also two pools and ten bots on the treated side.
This narrows the rival; it does not close the seed canary, whose registered discriminators are the
+72 h reads on 22 Sep.
