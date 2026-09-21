# The wood canary: what I proposed, why it was killed, and what replaced it

2026-09-21. Written after a two-engine review stopped the first design and a
measurement found a better one.

## Proposal 1 — relax the horizontal water veto on logs. KILLED, do not build.

`gather` filters candidates through `isSafeToBreak` → mineflayer-pathfinder
`safeToBreak`, which with `dontCreateFlow=true` refuses any block with liquid above
**or on any of four horizontal sides**. Observed refusal, uniform:

> `oak_log found but all 10 candidates are beside water or under falling blocks —
> digging them would flood or bury this spot [liquid:10]`

The idea: a tunnelling rule applied to tree-chopping. Break a trunk beside a pond
and nothing floods, because there is no tunnel.

**It would have shipped INERT while looking live**, and I verified this myself
rather than taking the review's word:

- `mineflayer-collectblock@1.5.0` contains **no `dontCreateFlow` anywhere**
  (`grep` across the package returns nothing).
- Its `mineBlock` (`lib/CollectBlock.js:70`) re-runs
  `bot.pathfinder.movements.safeToBreak(block)` and on failure calls
  `removeTarget(block); return` — **silently, no throw, no log**.
- `index.mjs` hands collectblock **our** `gatherMoves`, which sets
  `dontCreateFlow = true` at `:482`.

So every candidate the filter freed would be **walked to and then silently
refused**, converting a cheap, correctly-classified `no_safe_target` into an
expensive walk that burns a decision cycle and 40 s of collect budget and then
reports `no_path`. That is `leaf-01`'s failure reproduced by construction, with a
travel tax.

**And our own source comment says the opposite.** `skills.mjs:4319-4320`:

> *"mineflayer-collectblock then turns that refusal off on every single call
> (CollectBlock.ts sets `dontCreateFlow = false` before each…"*

**That comment is wrong about the deployed version**, and it is precisely the
comment that would have reassured me. It needs correcting whatever else happens.

Three further reasons it should not be built even if the sink were fixed:
- **Power**: optimistic ceiling ≈ **+43%** acquired wood against an MDE of **+88%
  to +138%**. No honest effect size is registrable — the design can only return
  INCONCLUSIVE.
- **Lava is 5–21% of the liquid vetoes**, not 0. (The affordance scan *cannot*
  measure the split: `INTERESTING_BLOCKS` is walked in list order under a budget of
  48, water is 9th and lava 10th, so for a bot gathering logs the budget is spent
  before either is reached. A naive join returns a clean-looking 131/131 water —
  a detector that answers uniformly.)
- **The observation would not follow the skill.** `prompt.mjs:135` builds the
  model's `BLOCK CHECKS` from the same `isSafeToBreak`, so the model keeps reading
  `exposed_safe=0` and steering away from targets the skill just unlocked.

## Proposal 2 — the milestone asks for oak; the scoreboard accepts any wood

`milestones.mjs` hardcodes the **target** at three sites:

```
:184  scout     M.gather('oak_log',  8, 'Enough wood to be self-sufficient out there.')
:216  miner     M.gather('oak_log',  8, 'Tools start with wood.')
:231  gatherer  M.gather('oak_log', 12, 'Wood too.')
```

while the **counter** and the **hint** were already widened, and the file's own
comment explains why:

> **WOOD IS WOOD.** This counted `oak_log` alone while the fleet held 2,966 oak and
> 4,105 logs of every other kind … 39 of 80 bots (49%) read as short of the 8-log
> floor while carrying hundreds of birch and spruce. **They were then sent to gather
> more oak specifically.**

**The fix was half-applied**: `done`/`progress` count any log and the hint says "or
any other `_log` you can see", but the goal still names oak.

### Measured, with selection controlled

12 h, 414,145 rows. Raw rates are confounded (oak is asked everywhere, birch only
where birch is visible), so the comparison is restricted to gather runs where that
same bot had seen **both** species in an affordance scan within the previous 180 s:

| target | runs | success |
|---|---:|---:|
| `oak_log` | 3,302 | **13.9%** |
| `birch_log` | 132 | **38.6%** |

**2.8x, with visibility controlled**, and the fleet still asks oak **25:1** when both
are in the same scan. Raw (uncontrolled) is 11.7% vs 36.9% over 6,695 vs 141 runs.

Residual rivals, stated: birch n is small (132; 95% CI roughly ±8 pp, still clear of
oak), and the scan-ordering budget above means birch may be reported only when oak
is sparse — which could bias in either direction and is not yet ruled out.

### Why the fleet asks oak 25:1 — and the hazard in fixing it

`prompt.mjs:673/690` drive `actionableBlocks` and `nearbyBlocks` through
`scanOrder(wants)`. With `wants: 'oak_log'`, oak leads a budget-limited scan, so
birch can go unreported. That is the likely mechanism, and it means the fix has to
reach `wants`, not just the text.

**`wants` cannot simply become an array.** `cognitive.mjs:593 #wantedItems`:

```js
const target = milestone?.wants
const want = new Set([target])
const def = this.bot.registry.itemsByName[target]   // STRING index
```

An array makes `def` undefined, skips the recipe expansion, and puts the array
object into the Set — **it breaks silently**. `bankable.mjs:56` spreads `wants`, so
a bare string would shred into characters there; `admission.mjs:333` already does
`[wanted].flat()` and is fine. So the consumers disagree with each other today, and
any change here must make `wants` polymorphic **in one commit across
`milestones.mjs`, `cognitive.mjs`, `prompt.mjs`, `bankable.mjs` and
`workorder.mjs`**, with a test per consumer.

That is a real change with a measured 2.8x behind it — not a one-liner, and not
something to deploy without the same review the first proposal got.

## Order of work this implies

1. **Widen `breakVeto`'s return token** to `liquid_above` / `liquid_side_water` /
   `liquid_side_lava`. It is already a pure function that receives `above` and
   `sides` separately and collapses them to one `liquid` token; the `why` histogram
   already reaches `skill.detail`. **Behaviour-inert, no canary slot**, and it
   answers both splits proposal 1 could not measure.
2. **Correct `skills.mjs:4319-4320`.** It documents behaviour the deployed
   `collectblock@1.5.0` does not have.
3. **Read why bots holding wooden-pickaxe materials do not craft** — 20 of 80 hold
   them. Deterministic unlock for a quarter of the fleet, one hour, no slot.
4. **Then** build proposal 2 as a reviewed, multi-file `wants`-polymorphism change,
   pre-registered on acquired wood at k=20.
