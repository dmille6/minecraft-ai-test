# The `no_safe_target` veto is water, and the water is the world

_2026-09-22. Fleet read at 11:10–11:15Z on `9fc3968+107160`, one version, 80/80 bots._

`skills.mjs` has carried this admission since the refusal was first instrumented:

> 18% of gather runs end here and a third of them are SAND, which is itself a falling
> block -- so the share attributable to liquid is unknown, and the only proxy available
> from telemetry bounds it between **3% and 97%**. That is too wide to decide anything on.

`veto_faces` (8d6f6f7) was shipped to close that band. **It has now been read, and the
band is closed.** This report is that reading, a correction to the hypothesis the queue
attached to it, and the two-engine review that followed.

---

## 1. The denominators

Positive control: 209,586 rows, 80 bots, 118 distinct kinds, 360 min, a single
`code.version`.

Gather, denominator **8,736 runs**:

| outcome | n | share |
|---|---:|---:|
| failed | 6,278 | 71.9% |
| success | 1,941 | 22.2% |
| aborted | 435 | 5.0% |
| unknown | 82 | 0.9% |

Fail classes, denominator **6,278 failures**:

| class | n | of failures | of all runs |
|---|---:|---:|---:|
| unreachable | 2,179 | 34.7% | 24.9% |
| **no_safe_target** | **1,878** | **29.9%** | **21.5%** |
| no_path | 1,669 | 26.6% | 19.1% |
| nothing_found | 532 | 8.5% | 6.1% |

## 2. The band is closed: 74.3% liquid, and the liquid is water

`veto_faces` fired on all 1,878 refusals, from **76 of 80 bots**, naming **9,944**
rejected candidates.

Veto cause, denominator 9,944 candidates:

| cause | n | share |
|---|---:|---:|
| liquid | 6,775 | 68.1% |
| falling | 2,550 | 25.6% |
| both | 619 | 6.2% |

Liquid-involved is **74.3%**. Face labels, denominator 9,786:

| label | n | share |
|---|---:|---:|
| none | 2,536 | 25.9% |
| side_waterx1 | 1,851 | 18.9% |
| side_waterx2 | 1,012 | 10.3% |
| above_water+side_waterx2 | 828 | 8.5% |
| above_water | 821 | 8.4% |
| above_water+side_waterx1 | 719 | 7.3% |
| side_waterx3 | 661 | 6.8% |
| side_waterx4 | 658 | 6.7% |
| above_water+side_waterx3 | 436 | 4.5% |
| above_water+side_waterx4 | 260 | 2.7% |
| **above_lava+side_lavax1** | **4** | **0.04%** |

**Lava is four candidates in six hours.** The refusal text says "beside water or under
falling blocks" as though the two were comparable; they are 74% and 26%, and the liquid
half is water in 9,782 of 9,786 cases.

**Positive control on the instrument itself:** the `none` bucket (2,536) and the
independent `falling` cause count (2,550) agree to **0.6%**. Two fields that are computed
separately agree about which candidates had no liquid at all, which is the check that
says the face labeller is not answering uniformly.

By block, denominator 1,878 refusals: `oak_log` **1,316** (and 37.1% of all 3,545 oak
gathers end here), `sand` 376 (37.1% of 1,014), `iron_ore` 98, `dirt` 34.

## 3. CORRECTION — the water is terrain, not the bots' own flooding

The queue's leading hypothesis was: *"the bots excavate and flood their own surroundings
and the safety check correctly refuses targets in it."* That predicts a roughly **uniform**
refusal share across pools, because every pool runs identical code.

It is not uniform. Each of the 16 pools is its own world on its own port (verified: 16
ports, 5 bots each), so a pool difference **is** a world difference.

| | |
|---|---|
| lowest | placebo-d **8.4%** of 438 runs |
| highest | isolated-d **33.7%** of 731 runs |
| spread | **4.0x**, sd **8.7 pp** across 16 pools |

And the spread survives *within* one arm, which removes the retired experiment's arms as
the explanation: **placebo-c 33.5% vs placebo-d 8.4%** — same code, same arm, 4x apart.

The two re-seeded pools are near the bottom (placebo-a 10.1%, placebo-b 14.7%), which is
what the seed canary's 69% cut in this failure class already implied.

**This does not prove zero self-flooding.** It bounds how much of the variance behaviour
can carry: a mechanism that every pool executes identically cannot produce a 4x spread
across worlds. The refusal tracks the terrain a pool was given.

## 4. The registered dual review: DO NOT spend a canary slot on relaxing this

Both engines were given the same proposal — relax the veto for water, never lava — and
both independently returned **do not canary it**, for two reasons that agree.

**(a) It is underpowered by roughly 4x.** Even recovering *every* one of the 1,878
refusals at the fleet's own 22.2% conversion gives ~417 extra successes, ~21.5% relative
growth, against a null sd of 0.313 on the items/bot-h ratio-DiD — about **0.69 sd**. The
realistic band is +5% to +12%, i.e. 4–8x under the floor. And the wood read is worse than
the all-items read: this rig's own header measures the placebo null for wood at **sd 3.00
against a canary-arm baseline of 0.64**. A 20-bot canary on acquired wood is guaranteed to
read null, and that null would say nothing about the change.

**(b) There is a named mechanism by which it reads NEGATIVE, and it is ours.** Verified
directly, not taken from the reviews:

- `COLLECTBLOCK_ENABLED` appears in **0 of 80** env files, so `mustCollectManually` is true
  for every block (`skills.mjs:988-990`) and **every gather digs raw and banks through
  `pickupNearbyItems`**. Blaming mineflayer-collectblock is wrong; that path is off.
- `pickupNearbyItems` (`skills.mjs:1227-1249`) snapshots the drop position **once**
  (`:1240`, `GoalNear(drop.position…)`) and returns outright on seeing the same entity
  twice (`:1236`). It is built for a stationary drop and **cannot chase a moving one.**
- Admitting water-adjacent targets is precisely what puts drops in moving water.

That is leaf-01's loss channel on a new candidate class, and the file already says so at
`:4904`. Worse than null: a dig that does not bank scores `barren++`, costs a random
reposition walk, and the log is gone from a world the fleet is already eating.

**(c) The nearest measurement in existence points against it**, and the proposal had not
cited it. `index.mjs:473-482`, verified verbatim: in the 14 bot-hours `6d1fdba` ran
fleet-wide with `dontCreateFlow` off on the approach profile, **five bots died against
zero in the windows either side** — two inside a gather, one "sealed, no route up or out".
That is a wider blast radius than the target filter, but it is the only measurement of
this flag being relaxed and it is a death signal.

**(d) Face count is a fake axis.** `side_waterx1` vs `side_waterx4` predicts no physical
quantity — one source block fills a 1x1 hole and spreads 7 cells; four do the same
slightly faster. A `<= N faces` threshold would be a number with no mechanism, which is
the `canary-gate-was-noise` failure repainted.

The partition with a mechanism behind each condition, if this is ever built: **above must
be dry** (the pour-down column is the only persistent current, and the case the upstream
rule exists for), **at least one `air` open face** (water's `boundingBox` is `'empty'`, so
`isExposed` counts water as an opening — without this the change preferentially admits
blocks reachable only *through* water), and **`*_log` only** (which excludes the 376 sand
candidates for free; sand beside water is the textbook drown-yourself-digging case, and
`dontMineUnderFallingBlock` does not protect it because the sand is beside, not above).

## 5. What was done instead

Both engines demanded the *same* pre-deploy test, and it already existed unrun:
`sandbox/corpus-wood.tsv` — `shoreline` (the target, one pond source on a horizontal face,
canopy held clear so the liquid rule is the only variable), `open` (positive control),
`buried` and `wetstone` (MUST-REFUSE controls). `sandbox/score-run.py` already scores
`logs+N` from the **inventory delta**, not from gather's verdict, which is exactly the
"more attempts vs more items" discrimination leaf-01 failed.

Neither candidate needed building: `shoreline-log` (718426d) and `pickup-sweep` (842e017)
already exist as branches, the latter based on the deployed baseline and carrying a
`pickup_skipped` change row that HEAD structurally cannot emit.

The corpus was run, control `7dd3775` (shoreline's exact base — single variable) vs
candidate `718426d`, five repeats per fixture. **Result in §6.**

## 5b. A finding that stands whatever happens to the shoreline change

`skills.mjs:1412-1418` carries this, as settled history:

> **WATER IS NOT AN OPENING, AND A WET BLOCK IS NOT A TARGET.** This counted `water` as
> an exposing face, so a stone block with water behind it scored as exposed and was
> RANKED AS PREFERRED... We have been selecting the blocks that drown us, on purpose.

**That fix is not in `isExposed`.** At `9fc3968` the function is:

```js
if (!n || n.name === 'air' || n.boundingBox === 'empty') return true
```

and, checked against `minecraft-data` 1.21.1 on the harness rather than assumed:

| block | boundingBox |
|---|---|
| water | **empty** |
| lava | **empty** |
| air | empty |
| oak_log | block |
| oak_leaves | block |

So water — and lava — still count as exposing faces. The comment describes an intent that
lives somewhere else.

**The consequence is the load-bearing one for this whole thread:** the only thing currently
stopping a block whose sole opening is liquid from being admitted and ranked is
`safeTarget`, i.e. **the very veto the proposal set out to relax.** The liquid rule is
doing double duty — it is both the flood guard and the last remaining "don't target a
block you can only reach through water" guard.

That is why the "at least one `air` open face" condition in §4 is not a refinement. It is
restoring a guard this codebase already believes it has, and any relaxation that ships
without it removes a protection nobody intended to remove.
## 6. The corpus result: the test both engines demanded is BLIND, and here is why

Run: `CORPUS=sandbox/corpus-wood.tsv REPEATS=5`, candidate `718426d` (shoreline-log) vs control
`7dd3775` — **the change's own base, so the comparison is single-variable** (verified: `shorelineExemptAt`
appears 0 times in control, 4 times in candidate; 2 files, 244 insertions). Scored on `logs+N` from the
**inventory delta**, not gather's verdict.

| fixture | control | candidate | the gate |
|---|---|---|---|
| `open` (POSITIVE CONTROL) | 0,0,0,1,11 = **12 logs / 5** | 0,1,1,1,6 = **9 logs / 5** | both arms must take it — **PASS** |
| `canopy` (unreachable family) | 0,0,0,0,0 | 0,0,0,0,0 | neither change targets it — as expected |
| **`shoreline` (THE TEST)** | 0,0,0,0,6 = **6 logs / 5** | 0,0,0,4,4 = **8 logs / 5** | control must be `logs+0` — **PRECONDITION FAILED** |

The registered gate was: *shoreline reads `logs+0` on control and `logs+>0` on candidate.* **Control did
not read `logs+0`.** So the fixture does not discriminate, and no verdict on the change can be taken from it.

**The reason is structural, and I found it by reading the fixture rather than the table.**
`synthetic-tree-shoreline.json` contains **five log cells stacked at y=70–74**, and

```
oak_log (300,70,300)  water faces: ['W+x']
oak_log (300,71,300)  water faces: NONE
oak_log (300,72,300)  water faces: NONE
oak_log (300,73,300)  water faces: NONE
oak_log (300,74,300)  water faces: NONE
```

**Only the basal log is water-adjacent.** The liquid veto refuses one candidate of five; the other four
are unvetoed and either arm can take them. The maximum difference the fixture can express is **one log
per run**, against a measured run-to-run spread of 0 to 11 logs on the positive control. The test is
swamped by its own noise by construction.

The fixture's docstring says the canopy is held clear *"so the ONLY thing refusing is the liquid rule."*
That is true of **why the basal log is refused** and false of **what the fixture measures**, because the
run does not need that log to succeed. This is the project's recurring failure — an instrument that
cannot express the presence it was built to detect — caught this time before a number was published
rather than after.

**The fix is small and the corpus is worth keeping:** the shoreline fixture must offer **only**
water-adjacent logs — a one- or two-log stump beside the pond, or water adjacent at every trunk level —
so that a refusal is the difference between `logs+0` and `logs+N` rather than between 4 logs and 5.
Until then, **`wood-shoreline-nosafetarget` must not be cited as evidence either way**, and the row in
`corpus-results.tsv` should be read as a fixture result, not a change result.

**Scope note:** this ran against `718426d`. The canary the other session deployed at 11:58Z is
**`9b572aa`**, a narrower rebuild on the current baseline (log-only, veto cause exactly `liquid`, no
liquid above, no lava, no terrain overhead, bot already standing dry at or above the target, re-checked
immediately before `bot.dig`). **The corpus above does not bound the deployed change.**
