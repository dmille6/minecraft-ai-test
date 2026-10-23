# A value-weighted line for the daily scoreboard (2026-10-23)

OWNER 10-23 "yes to all" on the production report's follow-ups (production-breakdown-2026-10-23.md §0.6: "the scoreboard counts dirt and staircase steps").

- **This branch:** `scoreboard-value-1023`.
- **Host script:** `scripts/host/valuescore.py`, wired into the owner's `scripts/host/scoreboard.py`.
- **Tests:** `scripts/host/test_valuescore.py`.
- **Staged installer:** `scripts/host/install-valuescore.sh`. The coordinator runs it; nothing has been installed.
- **Raw outputs:** `valuescore-2026-10-23/`.

## 1. What it measures

**value per active bot-hour.** Items the fleet takes from the world, each weighted by its worth, summed, then divided by active bot-hours.

**Intake rows.** These are the kinds whose gains come from the world: gather, mine, explore, goto, surface and home (walking pickups included).
- Evidence for the intake/transfer split, BASE 10-08..10-10, items gained per day (`valuescore-2026-10-23/evidence-base.txt`):
  - intake kinds: gather 54,086, mine 37,804, goto 7,876, surface 1,199, explore 381, home 225;
  - transfer and transform kinds: craft 2,057 (its products and pickups), smelt 325 (ingots), withdraw_pick 188, compost 116;
  - pickups inside deposit, wear_out, town_deposit and place: about 150 a day together, excluded.
- Crafted and smelted products weigh 0 as intake, because they are made from inputs already counted.

**Weights v1 (frozen; unit = one log).**

| item | weight | why |
|---|---:|---|
| any log (and `_wood`, `_stem`) | 1 | Root of the tool chain (1 log = 4 planks = 1 table). Town target 4000 per type (logcap-01). |
| cobblestone, cobbled_deepslate, stone, blackstone | 0.25 | Build material (town cap 1000) and stone-tool input. The fleet takes it about 4× faster per gather/mine bot-minute than logs (0.074 vs 0.296 bot-min per unit at BASE). |
| coal, charcoal, coal_ore | 1 | Fuel: one coal smelts 8. |
| raw_iron, iron_ore, deepslate_iron_ore | 8 | The iron tier gates the owner's plans: an iron pickaxe costs 3, the kit shovel 1, rails about 0.375 a block. It is about 40× scarcer than logs (304 against 12,146 oak a day at BASE). |
| raw_copper (and ores) | 2 | Owner 10-19: copper into builds. |
| raw_gold, lapis, redstone, quartz, amethyst, emerald, diamond, obsidian | 8, 2, 2, 1, 1, 16, 32, 2 | Rare; none moves a day's total today. |
| saplings | 0.5 | Tree-farm input. |
| bamboo | 0.05 | 9 bamboo → 1 block → 2 planks = 0.5 log. |
| dirt, sand, gravel, the stone junk (andesite, diorite, granite, tuff, calcite, deepslate, dripstone), the owner's well junk, flowers, food | 0 | The project's own policy gives them no use (`stocktarget.mjs` targets 0, `well.mjs` WELL_JUNK). They are listed, so they are not counted as unweighted. |
| any item in no table | **unweighted** | Counted and printed by name, never a quiet 0. Over 10 % of intake units raises. |

**Why frozen.** A weight that tracked current effort would rise as the world depletes, and that would hide the depletion. Bot-minutes per unit is shown as evidence for the relative sizes, not as the weight.

## 2. What it says (`valuescore-2026-10-23/runs.txt`)

| day | value per active bot-h | wood | stone | iron | copper | old gather ok/bot-h |
|---|---:|---:|---:|---:|---:|---:|
| 10-09 | **14.95** | 12,668 | 11,310 | 2,584 | 902 | 7.15 |
| 10-22 | **9.05** | 1,645 | 9,845 | 4,096 | 1,094 | 6.37 |

- **The value line falls 39 %, against the old count's 11 %.** Iron intake rises 59 %; wood collapses as bags fill (the production report's finding).
- **Dirt no longer inflates the number:** 40,508 and 55,698 of the two days' intake units weigh 0.
- **Weight sensitivity** (`valuescore_sensitivity.py`): the direction holds in every variant tried. The change runs from −31 % to −48 % with iron at ×0.5 or ×2, cobble at 0.1 or 0.5, copper at 1 or 4, or saplings at 0.
- **Cross-check:** on the same 3 h window, the old file-based scoreboard counted "raw iron gained (flow) 62". The new ES-based line reports 496 iron value, which is 62 raw iron × 8.

## 3. It fails loudly, not with a quiet 0

`ValueBlind` is raised when:
- an intake kind falls below its document floor for the window. Floors are per 24 h, scaled by window length: gather 5,000, mine 1,500, explore 3,000, goto 3,000, surface 100, home 50. Measured 10-08..10-22: gather 27-42k a day, home 0.3-0.9k. A similarly named kind is named in the message;
- gather or mine rows stop carrying `skill.inventory_delta` (under 10 %; BASE about 57 % and 67 %);
- the window is empty, the weighted total is 0, or unweighted units exceed 10 %.

**Positive controls printed on every run:**
- the window's document count and active bot-hours;
- per-kind document counts and their inventory_delta counts;
- the number of streamed rows. It must equal the per-kind sum, and `EsEvents.rows` raises otherwise.

**The old counts** (gather ok/bot-h, mine ok, craft ok, town_deposit ok/all) print alongside until `OLD_COUNTS_UNTIL = 2026-10-31`; after that only with `--old`. They reproduce the owner's 10-09 and 10-22 figures exactly (7.15 and 6.37; 8,243 and 5,508; 885 and 478; 413/841 and 165/211).

**Tests** (`python3 scripts/host/test_valuescore.py`): 36 behaviour cases and 8 source mutants. Every mutant is killed, and every anchor is checked unique.
- **The blind-input mutant:** renaming `gather` to `gathering` must raise. It also must when a kind thins to 100 documents a day, or when gather rows lose inventory_delta.
- **Wiring:** `measure()` must call both guards and stream every intake kind.

## 4. Install (staged; the coordinator runs it)

```
# on 10.0.0.31 as mike, from a checkout of this branch:
bash scripts/host/install-valuescore.sh             # dry run: self-test, estelemetry md5, scoreboard md5, smoke run; changes nothing
bash scripts/host/install-valuescore.sh --apply     # backs up and installs into ~/mcai-analysis, adds ONE cron line
bash scripts/host/install-valuescore.sh --rollback  # restores scoreboard.py, removes valuescore and its cron line
```

- **The cron line:** 00:50Z daily, nice 19. It writes `~/digest/valuescore/<day>.json` and appends to `~/digest/valuescore.log`; its marker is `# valuescore-1023`.
- **The dry run passed on 10.0.0.31 at 21:24Z:** 36/36 cases, 8/8 mutants, estelemetry md5 c3444ffe = repo, installed scoreboard md5 a27acb0e as expected, and the smoke run for 10-22 succeeded. Nothing was changed.
- **What --apply refuses to do:** overwrite a scoreboard.py that differs from the one this branch was written against, or install against a stale `~/estel` copy.

**Not done (owner's choice later):** a fleetstatus header line and a goalboard field. goalboard has its own documented row families, and adding there needs its own review.

## 5. Reviews

(See the end of this file.)
