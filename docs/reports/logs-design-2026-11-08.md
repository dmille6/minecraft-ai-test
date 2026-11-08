# Logs: a town log gathering cap, and charcoal (2026-11-08)

**Owner (11-08).** The fleet's town chests hold about 80,937 items, and 60,583 of them are logs (16 towns, about 3,800 a
town). On 11-07 the bots brought in 15,985 logs, against a 7-day median of 1,954 a day. The owner approved two things:

1. A **log gathering cap**, like the cobble cap. Once a town holds more than a limit, bots stop choosing "gather logs".
   Logs from tree clearing (tidy, forest, tree farm) still bank.
2. **Charcoal.** Turn surplus logs into charcoal in town furnaces, as fuel to smelt surplus cobble into stone and bricks
   for the masons (stoneworks).

**Result.** Piece 1 is built as **logcap-02**: tier 1/2, Codex found no blockers, and a registration and a draft entry
are on the canary host. (The name logcap-01 was already used on 10-17, for the bank-target raise from 64 to 4,000.)
Piece 2 is **designed and not built**. On both worlds today, the "fuel short" condition it would act on never happens.
On the fleet it would cost bot time and save nothing. See section 4. The owner needs to decide on it (section 7).

## 1. Measurements

All reads use `lib/telemetry.stream_rows` (full walks, rotated files included). They ran from a mktemp copy of main's
`scripts/lib` on each host, and the copy was removed afterwards.

- **Fleet** (10.0.0.31): 80 bots, 48 h to 11-08 13:35Z, 3,838 bot-h, 4,518,268 skill-stream rows (315,714 top-level
  skill runs), and 422,001 decision rows.
- **Showcase** (10.0.0.40): 15 bots (the FIXTURE bot excluded), 693.7 bot-h, 525,970 rows, and 43,674 decisions.
- **Town stock** comes from each pool's town index (`/var/lib/mcai/_pool-*/town-index-*.jsonl`), taking the newest
  observation of every container.

### 1.1 Stock (the town index, 16 shared towns)

| | fleet | showcase |
|---|---:|---:|
| logs | 65,335 (2,817-5,180 in 15 towns; hive-d 860) | 635 (spruce 559) |
| coal | 10,447 (232-1,047 a town) | 91 |
| charcoal | **1** | 0 |
| chest slots used | 8,790 of 9,963 (e.g. board-b 542/567, isolated-b 592/594, placebo-b 538/540) | 269 of 729 |

- The index count is about 4,700 above the owner's 60,583, because the flowledger and the index fold the containers
  differently. Both say about 3,800-4,100 a town.
- Most of the stock is `oak_log`. The per-type bank target is 4,000 (`stocktarget.mjs TOWN_WOOD_TARGET`). oak_log is at
  or above that target in about 9 towns, so **3,043 logs went down the junk well in 48 h**: logs that were gathered and
  then destroyed.

### 1.2 Where logs come from (positive inventory deltas, every skill except transfers)

**33,387 logs were gained in 48 h.**

- **gather: 31,124 (93.2%).**
- build_shop (tree clears, tidy): 701.
- mine: 385.
- compost: 256.
- make_material: 245.
- goto: 160.
- Others under 120 each.

Logs banked by deposit and town_deposit, per UTC day: 11-06 (from 13:35Z) 7,160, **11-07 15,209**, 11-08 (to 13:35Z)
5,518. The owner's 15,985 for 11-07 is the same flow.

**Showcase:** gather took 49 logs and build_shop's tree clears 768, so the showcase's logs come from clearing. Positive
control: gather on the showcase is 78.6 bot-h, mostly dirt (53.5) and iron (21.0), so the query does see gathers there.

### 1.3 Bot time on logs, and which decision path asked

- **Gather-of-log runs:** 16,109 runs, 55% successful, 31,037 logs. They took **217.8 bot-h**, counting skill time plus
  the lead (capped at 60 s). That is **5.7% of fleet time**, second among gather targets after iron_ore (278.3).
- **Each log gather joined to the bot's latest decision** (its TASK line, 48 h):

| TASK at the decision | logs | runs | bot-h | wood held before (median) |
|---|---:|---:|---:|---:|
| **"Cut 16 logs (any kind) for the town store and its builds."** (idle_work logs batch) + its interrupts | **18,011 (58%)** | 9,005 | **114.2** | 24 |
| "Return home with what you gathered." (the model's own choice) | 4,276 | 716 | 12.9 | 34 |
| iron tasks ("Mine iron ore ...", "Mine N iron ore for tools") + interrupts | 2,832 | 2,313 | 37.1 | 17-19 |
| "Stockpile N logs (any kind)." (SUSTAINING: the bag's 16-unit keep) | 2,036 | 2,052 | 26.0 | 15 |
| "Collect N log (any kind). Wood too." (the gatherer chain's 12) | 1,495 | 1,017 | 12.7 | 2 |
| "Keep the town grounds ..." | 1,156 | 525 | 7.5 | 17 |
| everything else | ~1,200 | | | |

- **Decision-gap time** is the time a TASK was the active goal, so it overlaps the skill time above:
  - "Cut 16 logs" 187.6 bot-h (4.9%).
  - "Stockpile N logs" 53.0 bot-h.
  - "Collect N log" 24.0 bot-h.
- **Proposals.** There were 21,724 `gather <log>` proposals:
  - 12,059 (55.5%) under "Cut 16 logs".
  - 3,708 under "Stockpile N logs".
  - 1,504 under "Collect N log".
  - 2,612 under the iron tasks.
  - 718 under "Return home".
  - 574 under grounds.
- **idle_work batch opens** in the same 48 h: grounds 6,229, scout 2,391, **logs 1,198**, iron 1,097, coal 966.

The two personal rungs ("Stockpile", "Collect") run on bags that are short of wood: the median bag holds 15 and 2 units.
They exist for tool crafting. The town-store batch runs on bags that already hold 24, so its wood is the town's.

### 1.4 Log consumers (48 h, non-transfer losses)

- **Bots' own fuel and tools.**
  - The bots' own `smelt` fuel took 1,104.
  - craft took 583: crafting_table 159, stone_pickaxe (sticks) 146, wooden_pickaxe 108, oak_planks 98.
  - deep_mine scaffold took 390.
  - explore, home, gather and mine took about 440 between them.
- **From the towns.** Net withdrawals were **1,329**. Junk well: **3,043**.
- **Town draw:** about **40-85 logs per town per day**. The build reserve keeps 512 logs a town
  (`stocktarget.mjs BUILD_RESERVE.logs`).

### 1.5 Furnaces and fuel

- **Fuel the bots' own `smelt` burned:** bamboo 4,909, oak_log 1,008, planks 690, coal 417, charcoal 16. It smelted 3,617
  iron_ingot.
- **The town smelt job** (`smelt_town`, coal only: `smeltjob.mjs JOB_FUELS`): 2,344 successful runs, which made 2,048
  copper_ingot.
- **make_material** (the fleet build has no stoneworks):
  - count 5,887.
  - torch 27 (logs to charcoal to 24 torches).
  - bricks 22 (2 logs to 8 planks of fuel for each 12 bricks).
  - panes 4.
- **The queued stoneworks-01** adds the `stone` kind and a fuel ladder (`mats.mjs fuelPlan`): bamboo, then saplings
  above 16, then **planks from logs above the 512 reserve**, then coal above 128. With 3-5k logs in every town, that
  ladder never reaches coal on the fleet.
- **Coal mining:** gather `coal_ore` took 76.0 bot-h, and the "Mine 8 coal" task had 189.2 bot-h of decision gaps.

### 1.6 Positive controls

Every zero or near-zero above has a non-zero neighbour in the same read:

- Town charcoal 1, against coal 10,447 in the same index fold.
- The showcase's log gather is 0.2 bot-h, against dirt 53.5 in the same row family.
- Fuel charcoal 16, against bamboo 4,909 in the same delta sum.
- The junk well's 3,043 logs, against its cobble in the same skill (flowledger: 25,294 in 6 h).

## 2. The design: logcap-02 (built)

**The rule.** While this bot's town is **capped**, the idle_work rung's `logs` kind has no means. That kind is the one
batch whose purpose is "for the town store", and it produced 58% of the gathered logs.

- **Capped** means the town index shows more than **1,024** logs, counting every species.
- It **uncaps** only at or below **768** logs.
- The lap then walks the rotation to the next kind that has means: grounds, iron, coal, or scout (`idlework.mjs
  idlePick`). Nothing is refused.
- A logs batch that was already open when the town capped is met at once (`_idlework met reason=logcap`), and the lap
  goes on to `return`.

**The count.** The town index is a lower bound, because an unknown container counts 0.

- A count above HIGH proves the cap at any coverage.
- Uncapping needs 0.8 coverage.
- If the index cannot be read, a cap proven less than 30 min ago holds. After that the rule fails open, which is the
  base behaviour.

**The TOWN WOOD line.** About 9.5k logs a day are the model's own choices under other tasks. To reach those, the prompt
gets a line, shown only to a capped bot that already holds its 16-unit wood keep:

> TOWN WOOD: the town store holds 4247 logs, above its 1024 cap -- it needs no more logs. You carry 24 wood: cut a log
> only when a craft of your own needs it.

**Never blocked:**

- The personal wood rungs (`stockpile_wood`, the bag's 16; the gatherer chain's 12) never read the cap. A test proves
  this on the real rungs.
- Withdrawals, project draws and the materials job.
- Tree-clear and pickup logs, which still bank up to the 4,000-per-type target.
- Admission, which is protected and unchanged.

**Where the code is:**

- `bots/src/logcap.mjs` (pure):
  - `logCapConfig`: `LOGCAP=0` is the rollback; `LOGCAP_HIGH` / `LOGCAP_LOW` set the limits; an invalid setting falls
    back to the defaults (src=invalid).
  - `townLogsIn`, `logCapNext`, `logCapMeans`, `logCapMet`.
  - `logCapLine` (`LOGCAP_PROMPT=0` drops only the line).
- `milestones.mjs`: `idleMeans` and `idleDone`.
- `skills.mjs logCapStateFor`: the index reader, with a 5-min cache per bot. It writes a `_logcap` row at the first
  decision and at every change of `capped`. That row is the licence and the mechanism line.
- `prompt.mjs townWoodSituation`.

**Limits (reconciled, section 3).**

- 1,024 is twice the build reserve, and about 10 days of the measured town draw above it.
- The 256-log band is sixteen idle batches, or about 5 days of draw, so the switch does not flap.
- At launch, 15 of 16 fleet towns are capped (hive-d, at 860, is not). The showcase (635) is not capped.

**Expected effect.**

- Logs batches fall to about 0 in capped towns, and the 12,059 "Cut 16 logs" proposals disappear.
- gather-of-log runs fall about 45% on a capped pool.
- Inflow falls from about 15k a day to the tree clears plus personal and free gathering. The prompt line should cut the
  free gathering further.
- The towns' 3-5k stock then drains through the draw and the 4,000-per-type well rule. Nothing has to burn it.

## 3. Codex's independent design, and the reconciliation

Codex (`codex exec`, read-only) was given the measurements and the goal, not this design. It proposed:

- **The cap:**
  - A cap of 1,024, resuming at 768, applied in `milestones.mjs idleMeans`.
  - An open logs batch completed when capped.
  - A fresh lower bound above the cap may stop gathering whatever the coverage; reopening needs a complete count; fail
    open when evidence is unavailable.
  - A prompt line, plus one narrow `admission.mjs` check (protected scope, two engines) for the model's free choices.
  - It would also let the personal rungs' completion waive "discretionary" collection.
- **Charcoal:**
  - Convert above 1,536 logs, down to 1,280. That leaves conversion above the gather threshold, so there is no
    gather-to-charcoal treadmill.
  - 6 charcoal from 7 logs, in small demand-bound batches: start below 8 charcoal, at most 16 made with reservations,
    and only against confirmed demand for 48 cobble smelts.
  - A charcoal rung on the stoneworks ladder before the planks rung.
  - Keep the smelt job coal-only.
  - Its own caveat, which matches section 4: "Coal already totals 10.5k; fuel scarcity is unproven ... this will not
    rapidly consume 69k logs." (Codex was given an earlier rough total, 69k; the 16-town fold is 65,335.)

| point | Claude | Codex | taken |
|---|---|---|---|
| limits | 1,536 / 1,024 | 1,024 / 768 | **Codex's.** The chests are near full, and the charcoal threshold must sit above the cap. |
| lower bound proves the cap; uncap needs coverage; fail open | yes | yes | both agree |
| open logs batch | let it finish (16 logs) | complete it at once | **Codex's** (`logCapMet`) |
| personal rungs | untouched | may waive collection | **Claude's.** They are the tool-crafting path (median bag 2-15 units); waiving them is the dead end CLAUDE.md warns about. |
| the model's free choices | prompt line only | prompt line + an admission check | **prompt line now.** The admission check is logcap-03 if the read shows the free share does not move (it is protected, so two engines). |
| charcoal | stack on stoneworks-01, if built | build producer and consumer standalone | **neither yet** (section 4) |

## 4. Charcoal: designed, not built (owner decision)

The piece as approved converts logs to charcoal "as fuel when fuel is short". The measurements say that condition does
not occur on either world:

- **The fleet is not short of fuel.**
  - Town coal is 232-1,047 in every town, above every keep (128).
  - The bots' own smelt burns bamboo first (4,909 in 48 h).
  - The queued stoneworks-01 ladder already burns surplus logs as planks before it reaches coal. A town with 3-5k logs
    never reaches the coal rung.
  - So a "fuel short" trigger would never fire on the fleet.
- **Logs are not fuel-limited.**
  - A log as planks gives 6 smelts.
  - A log as charcoal gives 8 smelts, minus 1/6 of a log to fuel its own smelt, so about 6.9 per log.
  - That gain costs a second furnace session: a whole make_material order (lease, withdraw, craft, smelt 60 s, bank) for
    each 6 charcoal.
  - With logs in surplus, log efficiency is worth nothing and bot time is the cost. On the fleet, charcoal is a net loss
    against the planks rung that stoneworks-01 already has.
- **Stoneworks is buffer-limited, not fuel-limited.** The buffers are stone 320 and bricks 256 (512 while a project is
  active). Filling them takes about 100 logs once. A stoneworks town never burns logs at the rate they arrive, so
  charcoal cannot be the log sink.
- **The showcase is short of coal** (91, below the 128 keep), but not of surplus logs. It has 635 logs, 123 above the
  reserve, and gathers almost none.

**Where charcoal would earn its place:** as the fuel that frees **coal for trading**. Villagers buy coal, never charcoal.
When coalsale-01/02 ship (now HELD until the showcase shows trades), the towns' coal becomes worth emeralds. At that
point a charcoal stock made from logs above 1,536 could replace coal in the town smelt job and the stoneworks ladder,
using Codex's small demand-bound batches. That makes **charcoal-01 a follow-on to coalsale**, not to the cap.

The design is ready:

- A `charcoal` mats kind: 7 logs give 6 charcoal (6 smelted on 4 planks).
- Banked through matsBank. The order's charcoal becomes an obligation, as the torch kind's already is.
- A `charcoal` rung in `fuelPlan`, from town, between saplings and planks.
- `JOB_FUELS` takes charcoal before coal, with the r2 bag-charcoal fix (the job returns only the town's own fuel).
- `TOWN_CHARCOAL=0` is the rollback.

It needs a Paper proof of the two-pass session, and the protected-file check: bankable.mjs's `DEPOSIT_ALWAYS` is not
protected; `scaffoldKeep` is.

## 5. What must be proven

- **logcap-02** changes decisions only: it touches no world, no movement and no inventory call, so it needs no Paper
  sandbox.
- **The canary read must prove the mechanism.**
  - The read: `_logcap capped=1` on the canary bots, and canary `_idlework open kind=logs` at 0 after +15 min in a
    capped pool.
  - The guardrails: craft success does not fall, and the share of 'Nothing to do' and idle time does not rise.

## 6. Queue placement (Claude and Codex agree)

- **logcap-02: fleet, P lane.** It is a progress change: it frees about 5% of bot time for other work.
  - It can go anywhere after the current head. It is independent of every queued entry.
  - The canary pool must be a capped town. Any shared pool except hive-d qualifies.
  - Tier 1/2 also allows an owner-direct rollout with the 60-min tripwire, if the control session prefers.
- **Showcase: none.** The showcase gathers 0.2 bot-h of logs in 48 h and holds 635. The cap would never engage there.
- **charcoal-01: not queued.** It follows coalsale-02 if the owner wants it (section 4).

## 7. Owner decisions

1. **Charcoal.** Fuel is not short, and the stoneworks-01 ladder already burns surplus logs as planks. Do you still want
   charcoal now, or as the coal-for-trading fuel once coalsale ships (recommended)?
2. **The cap value** is 1,024 logs a town (resume at 768). `LOGCAP_HIGH` / `LOGCAP_LOW` change it without a build.

## Appendix: the reads

Scripts are in the control session scratchpad (`logs1108/`): `logread.py` (supply, consumers, fuel, decision stream),
`bytask.py` (log gathers joined to the decision TASK) and `idx.py` (the town index fold). They are read-once reads and
not committed.
