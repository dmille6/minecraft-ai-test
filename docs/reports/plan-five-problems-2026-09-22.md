# The five problems: what two engines agreed, what they disagreed on, and the order

**2026-09-22.** Claude and Codex each designed an execution plan for the five
problems, independently, from the same brief. They converged on the substance and
disagreed with my proposed ordering in the same direction. Where one was wrong,
the correction is recorded with the measurement that produced it.

## Where they disagreed with me

| my plan | what both engines said |
|---|---|
| build the practice world on the sandbox host (10.0.0.30, RCON + real server) | build it **in-process**. `bots/test/helpers/reachlab.mjs` already has real `minecraft-data`, real `prismarine-block`, real `Movements`, real raycast and the real move generator, and `dig-approach.test.mjs` already replays six captured fleet scenes through it with no server. |
| ship `pickup-sweep` third | ship it **first**, and **fleet-wide, not as a canary** |
| per-run randomisation as the new unit | **not worth doing as specified.** Change the *endpoint*, not the unit. |
| the re-seed is the read for world-vs-policy | the re-seed is confounded; the **radius gradient** is the read |

I tested the first one rather than taking it on faith. The RCON rig is the wrong
tool here and the smoke test said so in three minutes: its scorer cannot see a
gather outcome, its `escaped` predicate requires `not wet` so a shoreline scene
passes by construction, and a 3-minute run bought **three decisions, all of them
`status`, and zero gather rows**. Pivoted.

## What got built

**The offline funnel** (`wood-harness`, 43b07e9). Five scenes through gather's
real candidate pipeline — `isExposed` → `Movements.safeToBreak` → `approachable`
→ A* → `inReach` — in milliseconds, no server, inside `npm test`. It reports
which stage a log-gather dies at.

It kills and ranks candidates. It calibrates nothing: the sandbox refusal floor
was measured ~3x tighter than live, so an absolute rate off a fixture is
worthless. A pass means "not yet dead".

**The positive control earned its place twice in ten minutes.** `reachable()`
wraps `getNeighbors` in try/catch, so when the gather profile threw
`Cannot read properties of undefined (reading 'bestHarvestTool')` every scene came
back with one node and read `no_path`. Then the funnel's own
`bot.pathfinder = {movements}` clobbered the stub that fixed it and every scene
read `no_path` again from the opposite direction. Without an ordinary tree in the
corpus, a table of zeros is indistinguishable from a rig that cannot chop wood.

**The shoreline candidate** (`shoreline-log`, 718426d) — ranked by the funnel
before it costs a slot. It flips the shoreline scene and leaves the other four
byte-identical. Six defects, every one found by *executing* the path:

1. The exemption certified a dry stance that *existed* and nothing made the bot
   occupy it — a dig ran from two blocks **below** the target.
2. `|| shorelineExemptAt` bypassed `canDig`, `blocksCantBreak` and
   `exclusionBreak`, which `breakVeto` knows nothing about.
3. `dryStanceFor` tested `!b.liquid` on a raw block, where `liquid` is a
   `Movements.getBlock` decoration and undefined — **it returned a water cell as
   a dry stance**.
4. The admission went stale across the walk and the equip.
5. `standingDry` admitted a bot with stone in its head cell.
6. `terrainAbove`'s four-block scan cannot prove a block is above ground.

**`pickup-sweep`'s premise checked before spending a read on it.** It only helps
where a sweep meets ≥2 drops. Measured: **54.7% of gathers ask for count > 1 and
56.4% of banking runs collect ≥2 items**, 32.2% collect ≥4. The ceiling is real.
This is the `needsdrop-01` check passing rather than failing.

## The order, and why

1. **`pickup-sweep` (8f3ece0), fleet-wide, the moment leaf-02 tears down.** It is
   a strict reallocation of an existing fixed budget — four attempts, each already
   bounded — so it cannot increase time spent and adds no refusal. Exposure is
   8.8% of all gathers across 77 of 80 bots, the largest in the queue. It needs
   one change-row (`pickup_skipped`) so the read has a denominator HEAD cannot
   emit. It must precede the wood work, because a log broken inside foliage drops
   into foliage and the sweep currently abandons it.
2. **The world-vs-policy census.** Read-only RCON, reusing `place-town.py`'s
   `column()` and `wood_nearby()`, which already solve the unloaded-chunk trap.
   The primary read is a **per-bot regression** of log-gather success on local
   wetness, wood density and distance-from-home — 80 rows, no arms. The causal cut
   is the **radius gradient**: sample inside the fleet's excavated envelope
   (≤128 blocks from home) and outside it (256–512, pregenerated but never
   visited) *on the same world*. A gradient means the fleet did this; no gradient
   means the worlds were always like this and "worn out" is the wrong word.
   Built-in negative control: the two re-seeded worlds must show no gradient.
3. **The shoreline canary (718426d).** With the conservation-law rival
   pre-registered: if `no_safe_target` falls and the other classes absorb more
   than half of it, REVERT whatever the endpoint says. That is leaf-01's exact
   signature.
4. **The endpoint change, not the unit change.** Replace items-per-bot-hour — a
   heavy-tailed sum where one bamboo stack contributes 91 in a single row — with
   **productive log-gather runs per log-gather run**. At p≈0.124 and n≈900 per arm
   in a 3-hour 5-bot window, the binomial se is ≈1.1 pp, so +5 pp is detectable
   *within* the arm. Plus a within-bot paired pre/post, which removes the
   between-pool term that put the placebo null at sd 3.00. Cost: analysis scripts.
   No `bots/src` change, no slot.

Per-run randomisation is **dropped** as specified. Codex enumerated the carry-over
channels and three cannot be neutralised at all without changing the world to fix
a bot: inventory (a treatment success changes the milestone, the goal, the prompt
and the gate's exemptions for every later run of *either* arm), the async
world-facts reflex writes, and the chunk evictor changing what the next run's
scan can even see. It would buy n=35,000 on a diluted estimate of a *different
estimand* than the one the project cares about.

## The reorder trigger, pre-registered

If local terrain explains **≥50%** of between-bot variance in log-gather success
**and** un-reseeded worlds show a radius gradient, then items 3 and 4 are demoted
below reliability-program step 4 — the deterministic
gather→craft→smelt→mine→deposit worker with the model off the tick — because the
policy is being asked to work in terrain the fleet destroyed and the answer is a
worker that does not depend on finding good terrain. If it explains **<20%**, the
question closes as "world state is not the dominant term" and this order stands.

One standing constraint that does not move either way: *the fix must be code that
works in any Minecraft world.* A policy that only works on fresh terrain is still
a broken policy.
