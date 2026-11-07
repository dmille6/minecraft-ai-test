# Effect audit — fleet KEEPs 11-06/07 and showcase releases

_Analysis agent, control session, 11-07 ~14:40Z. Read-only on hosts. Owner question (11-07 morning): "what are the next
things we need to analyze and study". Every recent KEEP reads "KEEP goal-unverified: no harm detected (the change was not
shown to act)". This report asks the question the gate never asks: **did each change do what it was built for?**
Companion: `queue-plan-2026-11-07.md`._

## Bottom line

| change | promoted (Z) | verdict | the number (fleet, promoted builds only) | conf. |
|---|---|---|---|---|
| stuckproj-01 | 11-06 05:40 | **WORKING** (mechanisms; no effect declared) | tidy `attempts_spent` 404 -> **0** per ~1,665 bot-h; monument canopy cuts 0 -> 417; tidy deferrals 43 -> 1,065; wall places 0 -> 167 | med |
| idlework-01 | 11-06 10:30 | **WORKING** | explore **-82%** (21.1 -> 3.8 /bot-h; min -20%); items/bot-h 54 -> 180; productive share 8.5% -> 26%; walking 31% -> 9.5%; scoreboard value/bot-h 11-06 **38.4 vs 12.9** (7-day median) | high |
| decbundle-01 | 11-06 13:50 | **WORKING**, at the margin | `deposit_nothing_to_bank` vetoes **12.0% -> 3.1%** of model calls (min -50%); decision share 62.3% -> 58.6% (**-5.9%**, min -5%) against the hours just before; repeat_loop not met | med-low |
| gkforever-01 | 11-06 17:18 | **WORKING, then fading** | tidy places/bot-h **1.1 -> 10.4** (first 6 h; min x2), clears 0.29 -> 2.24, productive 17% -> 30%. By 11-07 07-13Z: 0.2-1.8 /bot-h, and **90% of grounds batches gain nothing** | high (first 6 h) |
| idlework-02 | 11-06 20:50 | **WORKING** | mine `bad_args` **10.8% -> 6.9%** of calls (min -30%); bag_stop endings 0 -> 10-20 /h; target 3 is unreadable (misnamed kind) | med |
| gklease-01 | 11-06 22:53 | **WORSE** (likely) | tidy places/bot-h **10.8-13.0 -> 4.3-4.9** at the promotion hour (-64%; it claimed +10%). Leases churn: 51-113 takes/h, 32-72 underground releases/h | med |
| stations-01 | 11-07 02:08 | **WORKING, with two costs** | furnace retakes 0 -> **0.12 /bot-h** (min +0.03); sweeps 0 -> 0.45 /bot-h; craft success 42% -> 64%. Costs: **sweeps fail 80-97%**; stations in bags **220 -> 539** | high |
| gkstay-01 | 11-07 04:25 | **WORKING** | keeper takes **64 -> 41 /h (-35%)** (min -30%); underground releases 53-66 -> 3-15 /h; tidy did not recover | med |
| escdead-01 | 11-07 08:31 | **NOT ACTING** | since promotion: **0** `_swim_under_start`, **0** breaches, 90 breach refusals; its target bot isolated-d-Echo is pinned again at 358,58,180 (pinned_min 320 at 13:48Z) | med |
| buildfix-01 | 11-07 14:00 | **TOO EARLY** (fires on the canary) | canary pools: board-d tidy `blocked` **176 in 6 h before -> 0 in its 3-h canary** (now deferred, waived, deadline) | — |

| showcase release | live (Z) | verdict | the number |
|---|---|---|---|
| market-01 + market-02 | 11-07 03:43 | **NOT ACTING** | ~10.5 h, **0 trades**: every `_market_run` skipped (service_due 40, keeper 4, bag 4); 34/34 `_market_job` skip `no_free_jobless`; the one trip that ran, "nobody (0 visited, +0 emerald)" |
| forest-04 (+ gkwork-01) | 11-07 06:41 | **NOT ACTING** | 0 forest rows after 07:21Z (one visit "felled 21 logs (0 trees); no time"); forest harvests 10 in the release before, 0 since |
| gkwork-01show | 11-07 06:41 | **NOT ACTING** | tidy place 0, clear 0; keeper releases `no_work_visit` 18 of 19; helpers "nothing of the grounds is this helper's now" |
| roughground-01show | 11-07 10:38 | **NOT ACTING** | 3.3 h: 0 rough cut/fill, 0 grounds census rows |
| escdead-01show | 11-07 13:56 | **TOO EARLY** | 24 min |

**Fleet-level context (positive control).** idlework-01 is the big one. Daily scoreboard value/bot-h went from 12.9
(7-day median) to 38.4 on 11-06 (+198%), and deaths/bot-h fell 45-68% on 11-05 and 11-06. The hourly series moved at
11-06T11Z on mine, gather, explore, productive and walking together. The changes after it mostly move secondary lines.

## The tooling cannot see any of this right now (fix first)

1. **effectwatch has crashed every hour since 11-07 03:12Z (11 runs).** The cause is `read_target` line 393:
   `em = (expo or {}).get('model')`. Every registration since leasegen-01 writes `effect.exposure` as a **string**:
   idlework-01, decbundle-01, gkforever-01, idlework-02, gklease-01, stations-01, gkstay-01 and buildfix-01 all do.
   **No +24 h or +72 h effect verdict exists for any change in this report**, and none will until the line is fixed.
   main = installed (md5 identical). Fix: treat a non-dict exposure as `{}` (tier tooling, one line, plus a test).
2. **Two primaries can never be read from the cache.** gkstay-01's `_keeper:keeper_take` and idlework-02's
   `_idlework:met:bag_stop` are not in `effectmetrics.DETAIL_KEYS`, so the cache never counts them. They read 0 forever,
   which effectwatch reports as UNREADABLE (zero baseline). Adding a key needs a cache rebuild over the days it covers.
3. **Misnamed or reversed metrics in the registrations** (Codex found most of these):
   - idlework-02 names kind `well_dispose`; the rows are `_well_dispose`. It reads 0 in both windows.
   - escdead-01's guardrails name kind `death` (0 rows ever; the kind is `_death`) and fail_class `drowned`. The class
     in the rows is `drowning`.
   - escdead-01 marks no target `primary`.
   - idlework-01's guardrails give `direction: increase` for idle share and for `deposit_nothing_to_bank`. If direction
     means the good direction, these reward the bad outcome.
   - idlework-02's relative "+100%" on a row the base cannot write has a zero baseline. Use an absolute rate.
   - stuckproj-01 has no `effect` field at all.
   `effectwatch.py validate` checks the schema, not whether a name has ever appeared. **A validate step that requires
   each metric to be non-zero somewhere in the last 7 days** would have caught all of these. It is the `ZeroLooksWrong`
   rule applied to registrations.

## Per change

Method. effectwatch's hourly cache was read from 11-03 00Z to 11-07 10Z. It holds one cell per bot, hour and build, and
the cache lags about 3 h. A cell counts only once its build was promoted, so canary pools stay out until promotion.
Mechanism rows came from main's `lib/telemetry.stream_rows` over all 80 bots, 11-05 10Z to 11-07 14Z: 4,118,566 skill
rows, rotated files included, canary builds split out. **Nine promotions landed in 27 h**, so a "24 h before vs since"
window mixes changes. Each verdict therefore rests on **where the hourly step happens** (the hours just before against
the hours just after the promotion), with the 24-h window reported alongside. Restart hours (<40 promoted bot-h) are
dropped.

### stuckproj-01 — WORKING on its own lines (no declared effect)
- Tidy `attempts_spent` visits: 0.24/bot-h (404/1,668) for the 24 h before, then **0** (0/1,664) from the promotion hour
  on. Tidy deferrals: 43 -> 1,065.
- Canopy cuts (`_build ... op=canopy`): 0 -> 417 (monument) and 108 (tidy).
- Wall placements: 0 -> 167. The starvation remedy fired, but walls mostly stopped again after 11-06 12Z.
- Monument aborted visits -22%. Tidy `blocked` unchanged (+1%); buildfix-01 targets that.
- hourwatch 11-07 13:25Z still shows 5 of 16 towns "no workable project".

### idlework-01 — WORKING (high)
- Primary: explore rows 21.1 -> 3.8 /bot-h (-82%, 6 h each side; min -20%). The step is at the promotion hour, 11Z.
- items/bot-h 54.5 -> 180. Productive 8.5% -> 26%. Walking 31% -> 9.5%.
- mine rows 1-3 -> 13-20 /bot-h; gather rows 5-7 -> 17-23 /bot-h.
- Costs:
  - mine `bad_args` 1.8% -> 10.8% of model calls. idlework-02 fixed half of it.
  - Idle share 2.1% -> 3.7%.
  - Skill rows per bot-h +40% (63k -> 87k rows/h fleet), which is a logging-volume change.
- The value claim is mostly mining and gathering.

### decbundle-01 — WORKING at the margin (med-low)
- `deposit_nothing_to_bank` share: 12.0% -> 3.1% of calls (-74%). The step is at 14Z; it crept back to 3-6% after
  gkforever.
- Total veto share: 54% -> 40%.
- Primary (decision share of bot time): 0.574 -> 0.572 against the 6 h before its deploy. Those hours predate
  idlework-01, which raised decision share to 0.62-0.63. Against the hours right after idlework-01 (11-12Z) it is
  **62.3% -> 58.6% (-5.9%)**, just over the 5% minimum. **Codex's attribution, adopted.**
- repeat_loop: the fall from about 19% to about 10% is idlework-01's (11Z). Across decbundle's promotion it rose
  9.6% -> 12.7%. **Codex calls that WORSE. I do not**: the rise began at 13Z (13.5%), before the 13:50 promotion, as a
  rebound from idlework-01's drop.
- calls/bot-h fell about 10% (101 -> 91), so the registration's "calls/bot-h stays inside 5%" premise failed. Read the
  shares with the rates.

### gkforever-01 — WORKING, then fading (high for the first 6 h)
- Tidy places 1.08 -> 10.4 /bot-h for the 6 h each side (+866%; min +100%), step at 18Z. Clears 0.29 -> 2.24.
  Productive share 17% -> 30%.
- Fading: by 11-07 07-13Z tidy places are 0.2-1.8 /bot-h, and they come from 3 towns only (board-a, isolated-b,
  isolated-c). In 11-07 07-13Z only **6-10% of `idle_work met: grounds` batches gained anything**, against 27% at 00Z;
  n = 126-156 an hour. The grounds run out. That is the population gkwork-01 and roughground-01/02 target.
- Guardrail `_build_visit:tidy:blocked` per bot-h rose (+67-131%). **Codex calls that WORSE. I do not**: tidy visits
  roughly tripled, and the blocked share of tidy visits fell from 22% to 13% (14-16Z against 18-19Z). The rate guardrail
  is a visit-volume artifact.

### idlework-02 — WORKING (med)
- mine `bad_args` share 10.8% -> 6.9% (6 h each side; min -30%). Codex finds -56% using the hours just around it.
  It is still 4-5x the 1.3-1.8% level before idlework-01.
- bag_stop endings: 0 before; afterwards 207 iron, 55 coal and 18 logs (about 10-20 an hour). The mechanism fires.
- `_well_dispose` 0.905 -> 0.914 /bot-h (+1%): the band-shedding claim did not move. The declared kind is misnamed.

### gklease-01 — WORSE, likely (med). I first called this NOT ACTING; Codex's timing argument changed it
- Tidy places 10.8-13.0 /bot-h (21-22Z) -> 4.3, 4.9, 4.7 (23Z-01Z). The step is **at the promotion hour**, and it is
  sharp: hive-a 226 -> 0, isolated-a 136 -> 0, hive-d 63 -> 0. The registration claimed +10%.
- Lease activity: takes 51-113 /h; underground releases 32-72 /h (from 0 before).
- Competing explanation: grounds exhaustion, which is real (above) but gradual, and does not explain several towns
  stopping in the same hour.
- To check: does `keeper_release why=underground` leave a town without a working keeper for the rest of the hour?

### stations-01 — WORKING, with two costs (high on its targets)
- Furnace retakes (`_station_retaken` success): 0 -> 0.124 /bot-h, about 12-26 an hour. Retakes succeed about 55%.
- Groundskeeper sweeps (`_station_swept` success): 0 -> 0.45 /bot-h. They fell from 127/h (02Z) to about 7-12/h, as the
  easy strays went.
- Craft success share 42% -> 64%. smelt `needs_station` stays about 0.
- **Cost 1, the sweep failure loop.** Failed sweeps outnumber successes 10-35 to 1 since 05Z: 130-336 failed an hour,
  e.g. 13Z 256 failed against 7 ok. Reasons: "dug but it did not arrive", "arrived out of reach", "floor dig".
- **Cost 2, hoarding.** Stations held in bags went 220 -> 539 in 12 h (flowledger). board-a holds 89 on 5 bots. Gross
  placements from bags doubled, 17.5/h -> 34/h. Net placed-and-not-taken-back is about 0, so the owner's ">= 70% fewer
  left" is plausibly met net, but bags fill.
- Note: isolated-d-Echo's pin (escdead, below) has a furnace and a crafting table as two of its four walls.

### gkstay-01 — WORKING (med)
- Keeper takes 64/h (23-03Z) -> 41/h (05-13Z): -35%, min -30%. Underground releases 53-66 -> 3-15 /h. Bot-hours were
  about the same.
- The "tidy no worse" target cannot be read: tidy was already falling (gklease, exhaustion) and did not recover.
- The cache metric `kind.rate _keeper` moves only -10% because it counts every keeper op, not takes. Wrong proxy.

### escdead-01 — NOT ACTING (med). Codex agrees
- `_climb_flood_refused` fell (about 50 -> 16 /h), but the fall began at 06Z, before promotion, while canary pools
  were excluded. Not attributable.
- Since 08:31Z: **0 `_swim_under_start` fleet-wide**; 13 `_swim_under_refused` (9 with wide=1); 90
  `_flood_breach_refused`; **0 breaches**.
- Breach refusal reasons: "no water over the roof" (most), "the roof is not a block (air)", "water closed by
  <block>", and twice "lava over the roof".
- **Its own target is unfreed.** isolated-d-Echo has refused the breach every ~10 min at 358,58,180 since 07:17Z
  ("the water over the roof is closed by **air** at y=62: a breach would flood the pocket and open nothing"). Its
  pinned_min reached 320 at 13:48Z, and every `_swim_under_refused` it wrote today says `wide=0` ("no way out within 4
  cells").
- The wide swim got Delta, Bravo and Echo out of this same pocket at 05:52Z during the canary. After promotion it never
  armed for Echo.
- Two things to look at, both protected scope:
  1. The wide arm is keyed on something other than the breach's `pinned_min`.
  2. A closure "by air" above the water may be the open surface being read as a lid.
- Deaths since promotion: 5. placebo-a-Comet drowned (idle, no breach row); 2 falls; 1 stalagmite; 1 lava. None is
  linked to the change.

### buildfix-01 — TOO EARLY (promoted 14:00Z)
- On its canary pools: board-d tidy `blocked` 176 (04-10Z) -> 0 (11-13Z canary). The visits now end deferred, waived,
  deadline or no_material. placebo-b `stuck_on_cell` 35 -> 1.
- Fleet `_shop_skip stuck_on_cell` 46-70 /h before; it needs post-promotion hours.

## Showcase

Source: .40 skill streams 11-06 00Z to 11-07 14:20Z, 13-15 bots (FIXTURE excluded), rotated files included.

- **market-01/02 (03:43Z):** `_market_mode` is on (jobs=1, radius 96), but nothing trades. In 06:41-14:20Z:
  - `_market_run` 48/48 skipped (`service_due` 40);
  - `_market_job` 34/34 `no_free_jobless`;
  - `_market_trip` skipped `not_morning` 26 and `bag` 11;
  - one real trip: "nobody (0 visited, +0 emerald)".
- **forest-04 (06:41Z):** no forest rows after 07:21Z. The forest harvested 10 times under forest-02, then never. The
  showcase treefarm is BROKEN in projectaudit.
- **gkwork-01show (06:41Z):** keeper takes 20, releases 19 (18 `no_work_visit`). Tidy place and clear 0.
- **roughground-01show (10:38Z):** no rough, census or tidy cut/fill rows in 3.3 h.

These are the pieces the fleet queue is about to ship: gkwork-01 is in the slot now, and roughground-01/02, forest-01 and
market-01/02 follow. See the queue plan.

## Codex's independent read (data pack, no verdicts given) and the reconciliation

Codex (codex exec, read-only) got the hourly series, window tables, mechanism counts, registrations and showcase
counts, and none of my verdicts. It agreed on idlework-01, idlework-02, stations-01, gkstay-01, escdead-01,
buildfix-01 and all five showcase releases.

| change | Codex | mine | resolution |
|---|---|---|---|
| stuckproj-01 | NOT ACTING ("no declared contract") | WORKING (mechanisms) | Both stand. The mechanisms clearly fire; nothing was declared to judge. Recorded as WORKING-undeclared |
| decbundle-01 | WORSE (repeat_loop +33% at the boundary) | WORKING at the margin | Codex's local baseline adopted for the primary (-5.9%). WORSE rejected: the repeat_loop rise began at 13Z, before the promotion |
| gkforever-01 | WORSE (blocked guardrail +131%) | WORKING then fading | Rejected: visits tripled, and the blocked share of visits fell 22% -> 13% |
| gklease-01 | WORSE (-64% at 23Z) | was NOT ACTING (exhaustion) | **Codex adopted**: the step sits on the promotion hour, and several towns stopped at once |

Codex's extra defects, all adopted:
- the misnamed `death`/`drowned`;
- the reversed idlework-01 guardrails;
- the zero-baseline relative target;
- `_keeper` as a wrong proxy for takes;
- decbundle's calls/bot-h premise failing;
- a raw-against-cache filter mismatch at 11-07T03Z. Station retakes: 6 raw against about 3 in the cache, because the
  promotion hour's restart cells are split. I report the two separately.

## What to study next (the owner's question)

1. **Make the effect read run at all.** Fix the effectwatch exposure crash and add the missing DETAIL_KEYS, then
   re-read every change above at +24/+72 h. Make `validate` refuse metric names that have never appeared.
2. **escdead's unfreed pin** (isolated-d-Echo, 358,58,180): why the wide swim never arms after promotion, and whether
   "closed by air" is a false lid. Protected scope: two engines.
3. **Grounds after gkforever: lease or exhaustion?** Tidy work fell 64% at the gklease hour and is now about 10% of
   batches. Answer this before gkwork-01's read is believed.
4. **Stations:** the sweep failure loop (about 200 failed rows an hour) and 539 stations in bags. A bag cap or a deposit
   rule for stations is probably the fix.
5. **Showcase pieces that never act:** market (no villager visited), forest-04, gkwork, roughground. Each needs a
   one-hour look at why its first step is skipped, before the fleet copies ship.
