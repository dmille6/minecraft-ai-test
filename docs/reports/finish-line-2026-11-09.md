# Finish line — definitions (2026-11-09)

**Owner decision 2026-11-09 ~14:00Z** (relayed by the coordinator). The project has a finish line:
**M1, M2 and M3 passing, plus the owner's yes on M5, on two fresh worlds, at the small footprint.** M4 is a bonus.

**Owner context.** The owner plans to scale the project down later, to roughly one VM (Paper plus 10-15 bots) and one model
GPU. The trigger is the headline numbers levelling off while fleet canaries mostly read no-effect. At that point the code
freezes and the M2 fresh-world test runs. This page only defines the measures. It does not plan the scale-down.

**What the status page shows now.** The "Finish line" block sits on the owner status page, under the Headline numbers. It is
built by `scripts/host/finishline.py`, called from `statusreport.py`. Until a fresh-world run exists, it measures the
**current worlds**, the fleet and the showcase as they are, and is labelled **"current worlds (not a fresh-world run)"**.
Those worlds have had admin repairs, code changes and weeks of history. A pass there is evidence, not the
finish line.

## Rules for every criterion

- Each criterion reads **pass**, **fail** or **unread (why)**. **Unread never counts as a pass.** A criterion with no data
  source is unread, with the reason, never a silent zero.
- A **milestone** reads **pass** when every criterion passes, **not yet** when none passes, and **partial** otherwise. The
  number of unread criteria is added in brackets.
- An Elasticsearch count of zero is used only after the window is proven live: `_death` rows exist in the same 7-day window,
  otherwise the whole world reads unread.
- Windows end 5 minutes before the run (ingest lag). "7 d" is the last 7 days. "24 h" is the last 24 hours, whole clock
  hours only.

## M1 — Survives anywhere

| Criterion | Measure | Source | Window | Threshold |
|---|---|---|---|---|
| No bot stuck > 1 h | A bot is stuck for an hour when it wrote at least 20 position rows (`bot.pos`) in a whole clock hour and they stay inside a 2-block box on x, y and z. Bots stuck / bots present. | ES skill stream (fleet) or showcase-skill stream: per bot, per hour, min/max of `bot.pos.x/y/z` | 24 h | 0 stuck bots |
| Deaths < 1 per 100 bot-h | `_death` rows × 100 / active bot-hours (the headline number) | `headline.py` → ES, fleetstatus.py's rate | this headline week (7 full UTC days) | < 1.0 |
| No admin help | Owner-directed one-off repairs and world edits | Showcase: the release log (`deploy.jsonl`, events `owner-repair`, `owner-direct-world-edit`) served through the dashboard proxy. Fleet: **no journal kind exists**, so it is unread | 7 d | 0. A found edit counts even if the log is short. "None found" counts as 0 only when the log reaches back 7 days |

Pass rule: all three pass. A stuck bot's name and hours are listed (top 4).

## M2 — Builds a town by itself (per town)

A **town** is a fleet pool (one town per pool; 16 on the fleet) or the showcase. The criteria are judged per town. A world
passes M2 when **every** town passes. It is **partial** when any criterion passes in any town. The block shows
"k of N towns pass" and, for each criterion, how many towns pass it.

| Criterion | Measure | Source | Window | Threshold |
|---|---|---|---|---|
| Walls | a completed `wall` / `wallext` project | `_structure_complete` rows (detail `project=<plot>`), by `exp.pool` | ever, since 2026-10-20 | ≥ 1 |
| 4+ roofed houses | completed `house*`, `cottage*`, `hall` projects. A completed house blueprint includes its roof, flat or pitched; a flat roof counts | same | ever | ≥ 4 distinct plots |
| Storage | a completed `storehouse` / `storehub` / `shopchest` (town chests alone do not count) | same | ever | ≥ 1 |
| Farm | a completed `cropfarm` / `treefarm` / `canefarm` / `forest` / `farm` | same | ever | ≥ 1 |
| Roads | a completed `paths` / `road` | same | ever | ≥ 1 |
| Mine | a completed `shaft` / `stepwell` / `minewell` | same | ever | ≥ 1 |
| No project stuck > 6 h | longest STUCK goal in the town, grounds clean-up included | fleet: goalwatch-fleet.json (the stuck-goal alarms); showcase: fleetstatus' showcase STUCK lines | now | ≤ 6 h |
| Working share > 50% | busytime `productive` / observed bot-seconds (the headline definition) | fleet: effectwatch hourly cache, by the cell's pool; showcase: the headline's this-week number | 7 d (fleet needs ≥ 80% of the hours) | > 50% |
| No admin edits | as M1 | as M1 | 7 d | 0 |

Known limits: "ever completed" does not see a building that was later destroyed. Completion rows exist only from 10-28; an
older building with no later completion row is missed.

## M3 — Town economy (per world)

| Criterion | Measure | Source | Window | Threshold |
|---|---|---|---|---|
| Villagers employed | sightings of a villager whose profession is not `none` / `nitwit` | `_merchant_seen` rows (the trading scout; showcase only). Fleet: no scout rows, so unread | 7 d | > 0 |
| Births | — | **no source**: no villager birth or breeding row kind exists | — | unread |
| Trades | — | **no source**: no executed-trade row kind exists. The wandering-trader offers seen (`_trade_seen`) are shown beside it | — | unread |
| Food produced | — | **no source**: no harvest or food-production row kind exists | — | unread |
| Food eaten | `eat` rows with status success | ES | 7 d | > 0 |

Pass rule: all five pass. M3 cannot pass until the three missing sources exist: a birth census, a trade row and a harvest row.

## M4 — Progression (bonus)

| Criterion | Measure | Source | Window | Threshold |
|---|---|---|---|---|
| Diamond tools | bots whose latest snapshot holds a `diamond_` or `netherite_` pickaxe, axe, shovel, sword or hoe (tools or inventory) / bots with a snapshot | ES `latest()` per bot, rows carrying `bot.pos.x` | 24 h | ≥ 50% of bots |
| Enchanting | `_enchant_tool` rows with status success | ES (showcase only; the fleet has no such rows, so unread) | 7 d | ≥ 1 |

## M5 — Looks like a town

This one is the owner's judgement. It always shows **owner review pending**, with a link to the latest timelapse (the
dashboard's `/videos/` gallery), until the owner records a yes.

## Fresh-world run (not built yet)

The real finish line runs these same measures on two fresh worlds at the small footprint, over 7 days with no admin edits
and no code changes. That run has its own window and world list. This block will gain a third column for it.
