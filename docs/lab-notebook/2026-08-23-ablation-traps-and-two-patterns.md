# 2026-08-23 — the ablation, two dead bots, and two patterns that kept repeating

Seventeen commits. The single most useful thing learned is not any one fix; it is
two failure patterns that each recurred four or more times in a day, in different
subsystems, without being recognised as the same thing until late.

## 1. The ablation: the surface-hold was load-bearing

Three attempts to write an efficacy criterion for `shouldHoldSurface` all failed
the same way — each classified the hold HANDING OFF to a rescue as the hold
failing. Rather than write a fourth, the mechanism was removed and the same
G1/G2/G3 gates re-run without it.

Drowning deaths per EXPOSURE-WEIGHTED bot-hour:

    baseline, never had it        0.0820
    hold ON                       0.0361
    hold OFF (the ablation)       0.2196   <- final; 0.1263 at the halt decision

4 drowning deaths in 32 exposure-weighted bot-hours at the point of halting.
Under the hold-ON rate that outcome has probability 0.030, so the data rejects
"the hold made no difference".

Halted early rather than running to the 200 bot-hour gate. The pre-registered
catastrophic veto did NOT strictly fire — it wants k>=6 in a real 50 bot-hour
window and there were 4 in 32. The stop was on other grounds: the question was
answered, a known-safer configuration existed, and reaching 200 bot-hours would
have cost roughly 15 additional bot deaths to sharpen a number whose sign was
already known.

**The transferable lesson: when a mechanism resists specification, remove it and
measure.** The ablation settled in 32 bot-hours what three criteria could not.

## 2. Two bots died of a goal, not of the world

`isolated-a-Alpha` lost its last pickaxe at y=-4 at 05:03 and was still sealed at
y=2 ten hours later, carrying:

    cobbled_deepslate 24    stick 6    crafting_table 64

A stone pickaxe is 3 cobblestone-family blocks and 2 sticks; cobbled_deepslate
qualifies in 1.21.8. It could have dug out at any moment in those ten hours. It
spent them failing to craft the WOODEN pickaxe its milestone named, because wood
is on the surface and the surface needs a pickaxe.

Not a deadlock in the world. A deadlock in the goal.

The lesson was already in this repo, one function away, under `M.travel`:

> "A fixed coordinate can be genuinely unreachable ... and then the milestone can
> never complete and the bot loops on it forever. Rewarding displacement lets any
> workable route count."

Craft never got the same treatment. `done: countItem(b, item) >= n` matches on
item identity, so a bot holding a STONE pickaxe had still not satisfied "craft a
wooden pickaxe". Fixed in `da071c5` — a tool is a capability, not an item name.

**And it still was not enough**, which is the more important half. Fixing the goal
did not help a bot that could not SEE the move. `1d4b4ee` added `CAN CRAFT NOW`
to the observation; the bot switched from asking for `wooden_pickaxe` to asking
for `stone_pickaxe` within minutes. It remains sealed — it cannot place a table
in a space it has no room for, and cannot dig that room without the pickaxe — so
it is genuinely unrecoverable, and the fix for it was never recovery. It was
prevention, which is Layer 2.

## PATTERN A — the model cannot choose what it cannot see

Four instances in one day, each found only after shipping:

1. `swim_to` shipped with usage text saying "use this when you are ALREADY IN
   WATER" — to a model whose observation never said which medium it was in.
   Zero uses.
2. The IN WATER line then told it to swim WITHOUT saying where. A bot in open
   water does not know where land is; that is the definition of the situation. It
   answered with 0-block and 1-block "crossings".
3. `equivalentTools` made a stone pickaxe satisfy a wooden-pickaxe goal — but
   only surfaced the alternative in a craft FAILURE message, and the trapped
   bot's failures were for `crafting_table`, not for a tool.
4. `CAN CRAFT NOW` finally closed it, and behaviour changed within minutes.

**Rule: a capability is not shipped until the observation names it.** Every new
skill needs a matching answer to "how does the model know this applies right now".

## PATTERN B — a detector that answers uniformly is probably lying

Six instances, each caught only by checking against a known-good control:

1. RCON `execute if block` returns the SENTENCE "That position is not loaded" for
   an unloaded chunk. `"passed" in response` scored that as "not water", and an
   entire ocean survey came back dry.
2. A measurement window computed as now-minus-N landed two minutes in the FUTURE.
   Zero events, no error.
3. `logEvent` writes `skill.name` as `_${kind}`. A query for the bare name
   returned 0 while 578 events sat in the files — and a working safety feature was
   reported to the lab owner as possibly inert.
4. The same underscore trap again, through `ev.rows` — after `telemetry.py` was
   written specifically to prevent it. **A guard with a bypass is not a guard.**
5. "16,590 lost-pickaxe events" came from reading events WITHOUT a snapshot as
   "inventory is empty". The real number was 782.
6. `exposure.py` carried a hardcoded version list and silently omitted the one
   version being investigated.

**Rule: zero is not an answer until it has been checked.** `scripts/lib/telemetry.py`
now refuses to return a zero without proving the name, window and run identity
are valid, and routes iteration through the same guard.

## 3. The metric that improved while the fleet died

Drowning escape rate rose 14.8% -> 53.5% across eight hours of iteration while
drowning deaths TRIPLED, 0.053 -> 0.134 per bot-hour. The denominator counted
only bots that had already reached a rescue, so the metric was structurally blind
to a change that put MORE bots in the water — and every change in that period did.

Replaced with a lexicographic harm gate (`7e64b23`): terminal harm, all-cause
harm, leading indicators defined on the physical state rather than on the
mechanism responding to it, mechanism efficacy, and a composite that is a
dashboard number only.

**Rule: before adopting any gate, ask what intervention would improve it WITHOUT
helping a single bot. If an answer exists, the gate is wrong.**

## 4. Where the discipline broke, twice

**Six changes shipped in two hours** with no gate evaluation between them, hours
after writing a design doc that says "every step passes the harm gate before the
next starts". The crafting half worked (stone_pickaxe crafts 0.112 -> 0.260 per
bot-hour) and the movement half regressed (`goto` 47.2% -> 41.8%), and only the
fact that they touch different subsystems made the regression attributable at all.

**Layer 2 shipped by accident.** `a989fd0` carried "DRAFTED, NOT DEPLOYED" in its
subject; `eb6eb00` was then deployed as a clean single-change fix, and `a989fd0`
is its ancestor. The reasoning error was about commit INTENT rather than commit
ANCESTRY. Before any deploy: check what else the SHA carries.

## 5. Open state

  - `eb6eb00` on 40/40, carrying every fix from today including Layer 2
  - Layer 2 tripwire declared at >=100 bot-hours (`b216946`); ~21 accumulated
  - `_pathfinder_wedged` at 0.0/bot-h after the narrowing — watch for the opposite
    failure, a watchdog too conservative to catch anything
  - `swim_to` had ZERO uses across two full windows. A skill was built, its speed
    fixed, and an observation line added, and nothing invokes it. Pattern A again,
    unresolved.
  - two bots permanently entombed and left that way deliberately; the
    exposure-weighting rule keeps them out of the denominators

---

## Addendum — entombment is mostly not a problem, and I nearly built for it

Having amended the descent contract's success metric, the obvious next move was
controlled descent (`climb_down`) targeting the 96% of entombment that happens
above sea level. Chasing the mechanism first turned that into a negative result.

### What the numbers actually say

    entombment EVENTS /bot-h            2.6
    entombment EPISODES /bot-h          1.09     (gap of >180s ends an episode)
    MEDIAN EPISODE LENGTH               0 seconds
    p90 episode length                  ~148 seconds
    episodes over 10 minutes            5, across 7 hours and 266 bot-hours

Above sea level, 48% of episodes follow a `gather oak_log`, and 92 of 160 involve
ZERO vertical movement -- the bot is not falling into anything.

### Three hypotheses, all wrong

1. "Bots dig into pits reaching for canopy." The source documents this, but the
   sink distribution says otherwise: 92 of 160 at +0 blocks.
2. "Bots are walled in by leaves and cannot cut them without a hoe." No bot has
   ever carried a hoe, and the upstream tracker says pathfinder will not break
   leaves without one -- but `passableFor` in reflex.mjs ALREADY treats leaves as
   passable, so a leaf-surrounded bot never counts as entombed.
3. "They are stuck and the escape fails." Probed a currently-entombed bot against
   the server: `placebo-a-Comet` fired six entombment events, and by the time it
   was probed it had moved 90 blocks and was standing on grass with open air on
   all four sides at head and ceiling height.

### What it is

A transient, self-resolving condition that re-fires while it lasts. The rate
metric turned a mostly instantaneous state into what looked like a standing
catastrophe -- the same shape as `_drowning_no_shore` firing 3,856 times for bots
that were swimming perfectly well.

This repo has been here before, and the comment is in `isEntombed` itself: an
earlier version without a ceiling check "fired 1,997 times in 40 minutes at an
average y of 64 -- surface level, open sky overhead". The ceiling check reduced
that. It did not eliminate it.

### What this changes

**Do not build `climb_down` for entombment.** On this evidence it would be
optimising noise. Genuinely-stuck episodes run at roughly 0.019 per bot-hour, and
permanent losses at 2 per 24 fleet-hours.

The costs actually worth attacking, on measured evidence:

    goto success                 ~51%   (half of all travel fails)
    _path_reset                  ~80 /bot-h
    edges with no proven reverse  87%   (affordance ledger, 4,062 edges)

**The transferable lesson, and it is the third instance today:** a rate built from
a repeating event measures DURATION, not INCIDENTS. `_drowning_no_shore`,
`_water_surface_hold` and `_entombed` all had it. Before optimising any rate, ask
whether the event fires once per incident or once per tick of a condition.
