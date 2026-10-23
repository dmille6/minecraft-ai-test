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
| raw_iron, iron_ore, deepslate_iron_ore | 8 | The iron tier gates the owner's plans: an iron pickaxe costs 3, the kit shovel 1, rails about 0.375 a block. It is about 40× scarcer than logs (304 against 12,146 oak a day at BASE). The weight rests on scarcity and on gating the plans, NOT on effort: per gather/mine bot-minute, iron (0.336) costs about the same as a log (0.296). The sensitivity table below includes iron at effort parity (1). |
| raw_copper (and ores) | 2 | Owner 10-19: copper into builds. |
| raw_gold, lapis, redstone, quartz, amethyst, emerald, diamond, obsidian | 8, 2, 2, 1, 1, 16, 32, 2 | Rare; none moves a day's total today. |
| saplings | 0.5 | Tree-farm input. |
| bamboo | 0.05 | 9 bamboo → 1 block → 2 planks = 0.5 log. |
| dirt, sand, gravel, the stone junk (andesite, diorite, granite, tuff, calcite, deepslate, dripstone), the owner's well junk and decorations (WELL_JUNK, including rail, lead, wool, glass, fences, polished stone) | 0 | The project's own policy gives these no use: `stocktarget.mjs` town targets 0 and `well.mjs` WELL_JUNK. |
| flowers, food, compost inputs | 0 | A **scoring choice**, not a junk rule. The code protects them, but the worlds are peaceful (foodskip), and compost is not output. |
| crafted products (planks, sticks, tools, ingots, stations, bricks, slabs and similar; explicit suffixes, with no `_block` catch-all) | 0 | Made, not found. |
| any item in no table | **unweighted** | Counted and printed by name, never a quiet 0. Over 10 % of intake units raises. A renamed raw item such as `raw_iron_block` lands here and is not zeroed. |

**Gross, not net.** The line counts gains inside intake rows; it does not subtract weighted items lost in the same rows. Cobble placed and later re-mined, or tossed and picked up again, therefore counts twice. The weighted items lost inside intake rows bound this: cobble 15,552 units on 10-09 and 10,013 on 10-22, at most about 14 % of value on both days, so a day-to-day comparison keeps its direction.

**Why frozen.** A weight that tracked current effort would rise as the world depletes, and that would hide the depletion. Bot-minutes per unit is shown as evidence for the relative sizes, not as the weight.

## 2. What it says (`valuescore-2026-10-23/runs.txt`)

| day | value per active bot-h | wood | stone | iron | copper | old gather ok/bot-h |
|---|---:|---:|---:|---:|---:|---:|
| 10-09 | **14.95** | 12,668 | 11,310 | 2,584 | 902 | 7.15 |
| 10-22 | **9.05** | 1,645 | 9,845 | 4,096 | 1,094 | 6.37 |

- **The value line falls 39 %, against the old count's 11 %.** Iron intake rises 59 %; wood collapses as bags fill (the production report's finding).
- **Dirt no longer inflates the number:** 40,508 and 55,698 of the two days' intake units weigh 0.
- **Weight sensitivity** (`valuescore_sensitivity.py`): the direction holds in every variant tried. The change runs from −31 % to −48 % with iron at ×0.5, ×2 or effort parity (1), cobble at 0.1 or 0.5, copper at 1 or 4, or saplings at 0.
- **The 15-day series** (`runs.txt`) runs 16.02 on 10-08, 11.88 on 10-17, 8.09 on 10-18 and 9.05 on 10-22. The step on 10-18 is the day log intake collapsed (production report §4). No day raised.
- **Cross-check:** on the same 3 h window, the old file-based scoreboard counted "raw iron gained (flow) 62". The new ES-based line reports 496 iron value, which is 62 raw iron × 8.

## 3. It fails loudly, not with a quiet 0

`ValueBlind` is raised when:
- an intake kind falls below its document floor for the window. Floors are per 24 h, scaled by window length: gather 5,000, mine 1,500, explore 3,000, goto 3,000, surface 100, home 50. Measured 10-08..10-22: gather 27-42k a day, home 0.3-0.9k. A similarly named kind is named in the message;
- any intake kind's rows stop carrying `skill.inventory_delta`. The floors are 10 % for gather and mine, and 5 % for explore, goto, surface and home. The shares measured were 57/67/26/22/40/38 % on 10-09 and 58/74/24/21/52/50 % on 10-22;
- the window has an empty whole hour, or more than 2 empty 10-minute bins. ES caveats, including ingest lag on a window ending now, are printed with the result;
- the window is empty, the weighted total is 0, or unweighted units exceed 10 %;
- an unweighted item LOOKS like a weighted one, at any count. That means it shares a valuable token (iron, copper, gold, diamond, emerald, lapis, redstone, coal, log, ore, raw and others), or it is a close spelling of a weighted name. A low-volume rename such as diamond → diamonds (8 a day) is caught by this (Codex r3). On 10-08..10-22 it raised on no day: the only unweighted items were netherrack (up to 6), name_tag and big_dripleaf;
- any SINGLE unweighted item exceeds 50 units a day, scaled by window length. A renamed raw_iron (512 units, 0.5 % of intake) is caught by this, where the share test could not see it (Claude r1);
- a SENTINEL item is below its floor on windows of 3 h or more. The floors are cobblestone 2,000, raw_iron 50 and any log 100 a day; the measured minima over 10-08..10-22 were 24,000, 229 and 1,147;
- the streamed intake rows do not equal the intake kinds' document counts;
- the newest document is more than 15 minutes before the window end (an ingest stall, or a window running into the future).

**Positive controls printed on every run:**
- the window's document count and active bot-hours;
- per-kind document counts and their inventory_delta counts;
- the number of streamed rows. It must equal the per-kind sum, and `EsEvents.rows` raises otherwise.

**Per-world values** divide by that world's own active bot-hours ((bot, hour) pairs with at least one document), not by a fleet share.

**The old counts** (gather ok/bot-h, mine ok, craft ok, town_deposit ok/all) print alongside until `OLD_COUNTS_UNTIL = 2026-10-31`; after that only with `--old`. 10-31 is one week from an install on 10-24; if the install is later, move the constant. They reproduce the owner's 10-09 and 10-22 figures exactly (7.15 and 6.37; 8,243 and 5,508; 885 and 478; 413/841 and 165/211).

**Tests** (`python3 scripts/host/test_valuescore.py`): 65 behaviour cases and 15 source mutants. A mutant that fails to load or run is a harness ERROR, not a kill. Every mutant is killed, and every anchor is checked unique.
- **The blind-input mutant:** renaming `gather` to `gathering` must raise. So must a kind thinning to 100 documents a day, any intake kind losing inventory_delta, a renamed raw item, or a coverage gap.
- **Wiring:** `measure()` must call all three guards and stream every intake kind.
- **The installer** has its own test, `scripts/host/test_install_valuescore.sh`, run on 10.0.0.31. It uses a throwaway HOME and a fake `crontab`, so the real ones are never touched, and all 26 checks pass. It covers:
  - dry run changes nothing;
  - --apply installs and adds exactly one line, keeping the others;
  - re-apply refuses and changes nothing;
  - --rollback restores scoreboard.py, removes only its own exact cron line, and keeps a look-alike comment;
  - a --apply that fails after installing restores files and crontab;
  - an exact line already present before the install survives that install's rollback;
  - a `crontab -l` error other than "no crontab" refuses before any change;
  - rollback refuses when someone else has edited scoreboard.py since the install;
  - no temporary files are left. All temporary files live under `$HOME`;
  - a crontab write failure during rollback leaves the installed files in place, so the rollback can be re-run. Rollback does cron first, then files.

## 4. Install (staged; the coordinator runs it)

```
# on 10.0.0.31 as mike, from a checkout of this branch:
bash scripts/host/install-valuescore.sh             # dry run: self-test, estelemetry md5, scoreboard md5, smoke run; changes nothing
bash scripts/host/install-valuescore.sh --apply     # backs up and installs into ~/mcai-analysis, adds ONE cron line
bash scripts/host/install-valuescore.sh --rollback  # restores scoreboard.py, removes valuescore and its cron line
```

- **The cron line:** 00:50Z daily, nice 19. It writes `~/digest/valuescore/<day>.json` and appends to `~/digest/valuescore.log`; its marker is `# valuescore-1023`.
- **The dry run passed on 10.0.0.31:** all cases and mutants, estelemetry md5 c3444ffe = repo, installed scoreboard md5 a27acb0e as expected, and the smoke run succeeded. Nothing was changed, and the real crontab has no valuescore line.
- **What --apply refuses to do:** overwrite a scoreboard.py that differs from the one this branch was written against, or install against a stale `~/estel` copy.
- **How --apply records its work:** it writes a state file with every backup path, whether each companion file existed, and the crontab backup. Any failure after the files are installed restores all of it.
- **What --rollback undoes:** exactly what that state file recorded, removing the one exact cron line.

**Where failures land.** A ValueBlind from the cron run is written only to `~/digest/valuescore.log`. Per the "alarm log nobody reads" lesson, it should reach the fleetstatus header. That line is a follow-up for the owner to choose, as is a goalboard field.

**Not done (owner's choice later):** a fleetstatus header line and a goalboard field. goalboard has its own documented row families, and adding there needs its own review.

## 5. Reviews

**r1** (254f7f3a), Codex CHANGE: 6 P2s and 2 P3s.
- **Delta floors** now cover every intake kind.
- **Coverage gaps** are rejected, and caveats are printed.
- **The `_block` product catch-all** is removed.
- **Per-world values** use per-world bot-hours.
- **The installer** keeps a state file, restores on any failure, rolls back exactly, matches cron lines exactly and handles an absent crontab. It now has its own test.
- **The zero-weight wording** is corrected, and rail, lead and the decorations are added.

**r1** (254f7f3a), Claude CHANGE: 2 P2s, 8 P3s.
- **P2:** a renamed weighted item dropped the value without raising. Fixed by the per-item unweighted floor and the sentinels; tested with renames inside a realistic day.
- **P2:** the per-world denominator, already fixed in r2.
- **P3s:**
  - gross-not-net is stated and bounded;
  - iron's weight is justified by scarcity, with an effort-parity row in the sensitivity table;
  - the ingest-gap check and the row-count equality assertion are added;
  - OLD_COUNTS_UNTIL is noted;
  - the explore floor is kept as a deliberate blind gate: if explore is retired, the floor must be edited;
  - the alarm surfacing is noted;
  - the installer P3s are covered by r2/r3.

**r2** (27c94aef), Codex CHANGE: 2 P2s, 1 P3.
- **P2:** rollback must remove only a line this install added (CRON_ADDED in the state file).
- **P2:** a `crontab -l` error must refuse before any change.
- **P3:** temporary files live under `$HOME`.
- All three are tested in `test_install_valuescore.sh`.

**r3** (525eaf47), Codex CHANGE: 2 P2s, 1 P3.
- **P2:** rollback is now cron-first, so it can be retried.
- **P2:** a low-volume weighted-item rename is caught by the look-alike rule.
- **P3:** the mutant harness treats load or run errors as failures.

**r4:** pending.
