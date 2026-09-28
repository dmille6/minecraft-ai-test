# Status — 2026-09-22

_Daily operator session. Clock from `date -u`. Fleet `9fc3968+107160`, one version, 80/80 bots._

## What the session found already done

STATE.md was written 21 Sep 12:05Z and says "NO LIVE CANARY". It was right when written and
wrong by the time this session read it: an overnight session deployed **leaf-02 (`9fc3968`)
to board-b,board-d at 21 Sep 19:41Z**, the canary loop read it to +540, recorded **KEEP** at
22 Sep 04:43:47Z and **promoted it fleet-wide at 04:53:28Z**. The loop closed its own loop.

Verified rather than assumed:
- ledger `/var/log/mcai/_canary-decisions.jsonl` holds **57** decisions, newest the leaf-02 KEEP;
- `check-open-loop.py` (sudo): *"no open canary — clear to start something new"*;
- `canary_pool` and `canary_code_version` empty in the manifest;
- anchored `pgrep -af "canary-loop[.]sh"` → NONE;
- no systemd drop-ins under `/etc/systemd/system/mcbot@*.d/`;
- `~/MANUAL-READS-UNTIL` already moved aside (`.expired-2026-09-21`);
- **version census over a 45-min walk: `9fc3968+107160` on 80/80 bots, one string.**

**One gap closed:** the owner's rule is to fast-forward `main` on every promote *and keep
`main-pre-<date>`*. `main` was at `9fc3968`, but **`main-pre-2026-09-22` did not exist**.
Created at `cfc1c58` (the main the promotion replaced).

The leaf-02 KEEP was taken with `no_path_share_did = 0.072` against a `<= 0.05` line — that
line is a **WATCH**, not a deciding gate, so the KEEP is correct under v23. Recorded here
because the page text reads like a failed gate and will confuse the next reader.

## The standing 24 Sep item is satisfied

`program-read-registration-2026-09-24.md` **is committed** (`0627ddc`, 21 Sep) — the wake-up
said to confirm this before 24 Sep. Consequence in force: the 72 h window opens
**24 Sep 00:00Z**, the fleet must sit on ONE `declared_code_version` throughout, and any
canary must be decided and torn down before it.

## A SECOND SESSION IS RUNNING ON THIS FLEET — and it deployed while I was analysing

**This is the finding that matters most today.** At **11:20:59Z**, while this daily session was
mid-analysis, another operator session rewrote `/srv/mcbots/trial-manifest.json` to
`run_id: pickup-sweep`, `declared_code_version: 842e017`, and deployed **`pickup-sweep`
fleet-wide** with a full written justification in `notes` ("fleet-wide correctness, not a canary").

I did not do this. It is not in `~/canary-journal.jsonl`, `~/digest/page.jsonl`, or the ledger —
correctly so for a fleet-wide correctness deploy, which is not a canary and takes no ledger entry.
The same session is also writing project memory (`wood-is-terrain-not-policy.md` carries amendments
stamped 11:30Z and 11:45Z, which were already on disk when this session read the file at ~11:29Z).

**Fleet state, verified rather than assumed** (12-min walk, 8,258 rows): **80/80 bots on
`842e017+623b31`, one version.** The change is **not inert** — the `pickup_skipped` change row fires
**330 times from 23 bots in 12 minutes**, which is exactly the check `canary-can-ship-inert` exists for.
So the other session's work is sound and I have left it alone.

**The owner should decide the rotation question.** The standing directive is one session per day;
two autonomous sessions with deploy authority on one fleet can each satisfy "one canary at a time"
separately and violate it jointly. A `PushNotification` was attempted and did not reach (Remote
Control inactive), so it is recorded here.

## The telemetry outage was a symptom of that deploy, and my first diagnosis was wrong

At ~11:24Z `Events.load()` began raising `WalkTooWide` **on a 30-minute window**; the same query had
worked at 11:15Z. The mechanism is real: the stale `telemetry.py` sizes the **whole corpus regardless
of `since_minutes`** — 1,124 mostly-empty `.gz` generations (0.42 GB raw, assumed **10.62 GB** at 25x)
plus 0.38 GB live = est **10.99 GB against a 6.00 GB cap** — so once rotated history crossed the cap,
every walk was refused identically, whatever window it asked for.

**On the trigger, I changed my mind twice and the second change was an over-correction.** The
durable defect is not mine to claim: `recovery-ladder-03` already records it at 04:52Z today —
*"the telemetry walk-cap fix (c79d57b) is not on the deployed line, so today's promotion put the
broken copy back on the host."* **Any deploy or promotion reinstalls a window-blind
`telemetry.py`**, because the fix lives only in the golden copy.

What today adds is *why it surfaced when it did*: the estimate is a property of the **corpus**, not
of the query, so a window-blind library sits harmless until rotated history crosses the cap. It
crossed at ~11:20Z. That is why the identical query worked at 11:15Z and failed at 11:24Z with no
intervening promotion. Both the 04:53Z promotion and the 11:21Z deploy had installed the broken
copy; **which one was in place at 11:24Z I cannot separate, and it does not matter.** My earlier
line that "promotions don't restore the lib" is not established either way — `~/bin/fleet-deploy`
restores it at line 90 after a deploy; whether the promote path does was never tested.

**My own mistake, recorded because it is the more useful half:** I wrote a window-aware patch before
diffing against the golden copy, and `~/mcai-analysis/lib/telemetry.py` **already had the fix**, in a
better form (a `predates_window(f, since)` predicate shared between the estimate and the walk through
ONE frozen glob, plus a second in-walk `read_chars` guard). That is exactly the re-fix trap the
two-diverged-checkouts note warns about. I restored the golden copy over my patch, which is kept only
as `telemetry.py.mypatch-2026-09-22`.

After restore, checked in **both** directions: `since=30` → 18,780 rows / 80 bots, `since=360` →
210,419 rows / 80 bots, and a **60-day walk is still refused** — the OOM guard is intact, not disabled.
`/opt`'s lib currently matches the golden copy.

**What survives as a durable lesson:** during a fleet-wide deploy there is a window in which every
telemetry read on the host fails, and the canary loop's reads use that same path. And the symptom is
worth recognising on sight — **`WalkTooWide` on a narrow window is never about that window.**

## Seed canary — placebo-a +72 h, the last registered discriminator for that arm

Read at 00:03Z by the prospectively-replaced v2 reader. Positive control 3,225,930 rows /
80 bots / 132 kinds / 97.5 h walk.

| arm | gather DiD | stock/bot-h | immobile | deaths/bot-h |
|---|---:|---:|---:|---:|
| ALL controls (10 pools / 50 bots) | **+29.3 pp** | +7.818 | −3.5 pp | −0.022 |
| CLEAN controls (placebo-c alone) | **+32.7 pp** | +5.718 | +1.4 pp | −0.030 |

Treatment went 13.0% → 43.1% on 1,972 → 6,572 terminal rows.

**It replicates the +48 h read almost exactly** (+29.1 / +32.1 pp), which is the useful
property: two reads 24 h apart on the same pool agree to ~0.5 pp. The deaths column stays a
tripwire — 5 bots cannot resolve 0.01/bot-h, and the read says so itself.

The precision caveat from 21 Sep still stands and is not resolved by this read: the "clean"
arm is **one pool**, so it is the noisiest comparator available (null sd 0.608 at k=5 vs
0.313 at k=20), while the all-controls arm carries real canary exposure. **Sign and size are
not in doubt; precision is.** The `isolated*` admission remains a registered *proposal for a
future read*, deliberately not slipped into this one.

## The `no_safe_target` veto: a band the source called undecidable is now closed

Full read: `veto-faces-2026-09-22.md`. Scripts `vetoread.py`, `vetowhere.py`, `pickupexp.py`
saved to `~/mcai-analysis` on this Mac and on .31.

`skills.mjs` has carried the admission that the liquid share of this refusal was "bounded
between 3% and 97% — too wide to decide anything on". The `veto_faces` instrument shipped to
settle it (8d6f6f7) had never been read. It has now been.

Denominator 8,736 gather runs / 80 bots / 360 min: `no_safe_target` is **1,878 runs = 21.5%
of all gathers**, 29.9% of failures. Across the **9,944** candidates those refusals named
(from 76 of 80 bots): **liquid 68.1%, falling 25.6%, both 6.2%** — and of 9,786 face labels,
**lava is 4 (0.04%)**. It is water.

Positive control on the instrument itself: the `none` face bucket (2,536) and the independently
computed `falling` cause (2,550) agree to **0.6%**.

**CORRECTION to queue item 3.** Its stated leading hypothesis was that the bots excavate and
flood their own surroundings. That predicts a uniform share across pools, since every pool runs
identical code. Measured: **8.4% (placebo-d) to 33.7% (isolated-d), a 4.0x spread, sd 8.7 pp
across 16 pools** — and 4x *within one arm* (placebo-c 33.5% vs placebo-d 8.4%). Each pool is
its own port and world (verified: 16 ports, 5 bots each), so a pool difference is a world
difference. **The refusal tracks the terrain a pool was given.** This does not prove zero
self-flooding; it bounds how much of the variance behaviour can carry.

## The registered dual review said DO NOT spend the slot, and both engines agreed

Claude and ChatGPT/Codex were given the same proposal independently, plus an open-source search
of mineflayer-pathfinder issues and Minecraft item-entity behaviour. Both returned **do not
canary the water relaxation**, on two grounds that agree:

1. **Underpowered by ~4x.** Recovering *every* one of the 1,878 refusals at the fleet's own
   22.2% conversion is ~417 extra successes, ~21.5% relative growth, ≈ **0.69 sd** against a
   null sd of 0.313 on the items/bot-h ratio-DiD; the realistic band is +5% to +12%. The wood
   read is worse still — this project's own rig header measures the placebo null for wood at
   **sd 3.00 against a canary-arm baseline of 0.64**.
2. **A named mechanism by which it reads NEGATIVE**, verified in source rather than taken on
   trust: `COLLECTBLOCK_ENABLED` is in **0 of 80** env files, so every gather digs raw and banks
   through `pickupNearbyItems` (`skills.mjs:988-990`, `:1716`); and that function snapshots the
   drop position **once** (`:1240`) and returns on seeing the same entity twice (`:1236`). It
   cannot chase a drifting drop — and admitting water-adjacent targets is exactly what puts
   drops in moving water. That is leaf-01's loss channel on a new candidate class.

Two further facts the proposal had not accounted for, both verified here:
- **`index.mjs:473-482`**: in the 14 bot-hours `6d1fdba` ran with `dontCreateFlow` off on the
  approach profile, **five bots died against zero in the windows either side**. Wider blast
  radius than the target filter, but it is the only measurement of this flag relaxed.
- **`isExposed` counts water as an opening.** `water.boundingBox === 'empty'` (checked against
  minecraft-data 1.21.1 on the harness, not assumed; lava too), so the "WATER IS NOT AN OPENING"
  comment at `skills.mjs:1412` describes a fix that is not in that function. **The liquid veto is
  therefore the only remaining guard against targeting a block reachable solely through water** —
  which makes it load-bearing in a second way nobody intended.

**Neither candidate needed building.** `shoreline-log` (718426d) and `pickup-sweep` (842e017)
already existed as branches, and both pass the canonical runner — **shoreline-log 194/194,
pickup-sweep 193/193.**

**`pickup-sweep` was then shipped fleet-wide by the other session at 11:21Z**, so it is no longer a
candidate; it is the code the fleet runs. Its exposure, re-measured here on the live sha rather than
trusted from its commit message: **777 of 8,741 gathers = 8.9%, 70 of 80 bots, 1.619/bot-h.** But
**74.3% of those runs are `dirt` and only 4.2% of log gathers are affected** — so a flat wood number
after this deploy is not evidence against it, and should not be read as such.

## Seed canary — placebo-b +72 h, and an OOM I caused

Read at 11:28Z. Positive control 3,268,301 rows / 80 bots / 134 kinds / 97.5 h walk.
T0 2026-09-19 11:25:23Z; post window [09-19 11:25, 09-22 11:25)Z.

**ALL controls (10 pools / 50 bots):** gather DiD **+29.9 pp** (treatment 10.0% → 42.9% on
1,885 → 5,442 terminal rows; control 18.5% → 21.4%). Stock **+15.886/bot-h**. Iron-pick share
+27.1 pp. Immobile −3.1 pp. Deaths −0.009/bot-h — a tripwire, not a result, and the read says so.

**The clean-controls arm was OOM-killed mid-walk** (`902677 Killed`), and the honest attribution is
that **I probably caused it**: I had several wide telemetry walks running concurrently on the same
host while the scheduled reader started its 97.5 h walk. The read is retrospective, so it is
recoverable. **Re-run with the reader's exact list, nothing else heavy on the host: gather DiD
**+33.6 pp** (treatment 10.0% → 42.9%, control 18.6% → 17.9%), stock +17.666/bot-h, iron-pick share
+28.5 pp, deaths −0.000. The registered discriminator was recovered, not lost.**

**Lesson, and it is mine:** the host has 46 GB and a single 97.5 h walk takes ~29 GB of it. Wide
walks must be run **one at a time**. The `WalkTooWide` guard prices one walk, not two.

### The seed series, closed

| read | all-controls | clean-controls |
|---|---:|---:|
| placebo-a +48 h | +29.1 pp | +32.1 pp |
| placebo-b +48 h | +32.8 pp | +38.4 pp |
| **placebo-a +72 h** | **+29.3 pp** | **+32.7 pp** |
| **placebo-b +72 h** | **+29.9 pp** | **+33.6 pp** |

Four reads, two pools, two timepoints: **+29.1 to +32.8 pp on the all-controls comparator, every
time.** The registered regression-to-the-mean discriminator was satisfied at +48 h (the registration
named placebo-b in advance as the fleet's worst pool and predicted that if only it improved, that was
RTM — both improved) and nothing at +72 h disturbs it.

**The precision caveat stands and must not be quietly dropped.** The clean arm is **one pool**
(placebo-c) — the noisiest comparator available (null sd 0.608 at k=5 vs 0.313 at k=20) — while the
all-controls arm carries real canary exposure. **Sign and size are not in doubt; precision is.** The
`isolated*` admission remains a registered proposal for a future read; changing the comparator after
seeing the answer is choosing the comparator on the answer, and it was correctly not slipped in here.

## The sandbox corpus — and the instrument turned out to be blind

Both engines demanded the same pre-deploy test, and it already existed unrun: `sandbox/corpus-wood.tsv`.
Run with `REPEATS=5`, candidate `718426d` vs control `7dd3775` — the change's own base, so the comparison
is single-variable (verified: `shorelineExemptAt` occurs 0 times in control, 4 in candidate). Scored on
`logs+N` from the **inventory delta**, which is the "more attempts vs more items" discrimination leaf-01
failed.

| fixture | control | candidate | gate |
|---|---|---|---|
| `open` POSITIVE CONTROL | 0,0,0,1,11 = 12 / 5 | 0,1,1,1,6 = 9 / 5 | both arms take it — **PASS** |
| `canopy` | 0 / 5 | 0 / 5 | untargeted — as expected |
| **`shoreline`** | 0,0,0,0,6 = **6 / 5** | 0,0,0,4,4 = **8 / 5** | control must be `logs+0` — **FAILED** |
| `buried` MUST-REFUSE | **0 / 5** | **1 / 5** | one unexplained, see below |
| `wetstone` LEAKAGE | **stone+6 / 5** | **stone+6 / 5** | `stone+0` required — **FAILED** |

The registered gate required `shoreline` to read `logs+0` on control. It did not, so **no verdict on the
change can be taken from this corpus** — and the reason is structural, found by reading the fixture rather
than the table:

```
oak_log (300,70,300)  water faces: ['W+x']
oak_log (300,71,300)  water faces: NONE
oak_log (300,72,300)  water faces: NONE
oak_log (300,73,300)  water faces: NONE
oak_log (300,74,300)  water faces: NONE
```

**Five logs stacked; only the basal one is water-adjacent.** The liquid veto refuses one candidate of
five and either arm takes the other four. The most the fixture can express is **one log per run**, against
a run-to-run spread of 0 to 11 logs measured on its own positive control. It is swamped by its own noise
by construction.

Its docstring says the canopy is held clear *"so the ONLY thing refusing is the liquid rule"* — true of
**why the basal log is refused**, false of **what the run measures**, because the run never needed that
log. This is the project's recurring failure mode (an instrument that cannot express the presence it was
built to detect), caught this time before a number was published rather than after.

**The fix is small and the corpus is worth keeping:** rebuild `shoreline` to offer **only** water-adjacent
logs — a one- or two-log stump beside the pond, or water adjacent at every trunk level — so a refusal is
the difference between `logs+0` and `logs+N`, not between four logs and five. Until then
`wood-shoreline-nosafetarget` must not be cited either way.

## A canary went live at 11:58Z, deployed by the other session

`shoreline-01`, **sha `9b572aa`**, pools **hive-b, hive-a, board-c, hive-d** (the registered k=20 draw),
rebased onto the deployed baseline `842e017` (verified ancestry). `canary-loop.sh shoreline-01` owns the
reads. It must be decided and torn down before **24 Sep 00:00Z**; a +540 read from 11:58Z lands ~21:00Z.

**The deployed change is much narrower than the proposal I reviewed, and that deserves saying plainly.**
It admits only a natural log, only when the veto cause is exactly `liquid`, only with no liquid above, no
lava on any face, no terrain overhead, and only while the bot is already standing dry, clear, solid and at
or above the target — re-asked immediately before `bot.dig` because the admission goes stale across the
walk and the equip. `Movements` is never mutated. **That is, independently, the partition my own review
asked for.** Of my four objections, the face-count one, the sand one and the `isExposed` one are answered
by that scoping. Two survive, both prospective:

- **Power.** A 20-bot read on acquired wood against a placebo null of sd 3.00 vs a canary-arm baseline of
  0.64. INCONCLUSIVE is the likely verdict and is a legitimate close — it should not be rescued by a
  mechanism number.
- **Drift.** `pickupNearbyItems` still snapshots the drop position once and retires each drop after one
  walk, so a drop carried by the flow the dig creates is abandoned. If it reads negative on acquired wood,
  that is the first place to look — an instrumentation question, not a reason to revert the scoping.

Both are written up on the host at `~/digest/SHORELINE-01-REVIEW-EVIDENCE.md`, with an addendum correcting
the original note once I could read the deployed scope. Nothing was torn down or interfered with.

## What closed today

1. **leaf-02's loop** — verified closed (KEEP 04:43Z, promoted 04:53Z, ledger 57, one version), and the
   missing `main-pre-2026-09-22` created at `cfc1c58`.
2. **The seed canary series** — all four reads taken; +29.1 to +32.8 pp on all-controls every time.
   The placebo-b clean arm was OOM-killed and was recovered by re-running it.
3. **The `no_safe_target` band** `skills.mjs` called undecidable — closed at 74.3% liquid, lava 0.04%.
4. **Queue item 3's hypothesis** — corrected; the refusal is 4.0x clustered by world, not uniform.
5. **The registered dual review** for the wood thread — taken, with an open-source search.
6. **The wood corpus** — run, and found blind, with the structural reason and the fix named.

**No canary was started by this session, deliberately**, and the reasoning is in STATE.md under
"Why no canary today" so tomorrow does not re-litigate it.
