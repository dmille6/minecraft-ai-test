# Iron chain: what a "get X" chain would fix, measured; two narrow fixes built (2026-11-09)

Owner 11-09 ("lets do 1,2,3"), idea #3 of the 11-09 landscape survey (minecraft-ai-landscape-2026-11-09.md, not yet on main; rows 2-3:
the one-call prerequisite resolver of [arXiv 2503.03505](https://arxiv.org/html/2503.03505v2), Plan4MC's offline skill graph
[2303.16563](https://arxiv.org/html/2303.16563v2), DEPS's nearest-first selector [2302.01560](https://ar5iv.labs.arxiv.org/html/2302.01560)).
The brief: "get X" as one deterministic call; measure first why gathers fail, then decide where a chain helps and where the
gather itself is broken.

**Short answer.** On this fleet a chain fixes little: tools are never the gap, the gather already hands a buried ore to `mine`,
and the surplus the towns hold (logs, cobble) is the town's own stocking work, while dirt is never banked. The measurement found
two narrow defects instead, both built as tier-3 fleet pieces: the ore tunnel aimed at the town stair's own wall
(**ironchain-01**), and tool hygiene admitting an iron pickaxe the bag cannot make (**ironchain-02**). The idle log batch the
measure also found is already **logcap-02** (queued; it covers the 1,204 proposals and the 1,887 junked logs measured here).

## 1. Measurement (fleet .31, 80 bots, 6 h to 11-09 ~13:10Z, live fleet bcdba35f; `lib.telemetry` full walks)

Positive controls: 566,920 skill rows on 80/80 bots; gather 8,269 runs (3,250 ok, 39.3%) and craft 513 (271 ok, 52.8%) match
the coordinator's baseline (8,437 / 39%; 516 / 52%).

### Gather: 5,019 failures by class

| class | rows | share | dur bot-h | top targets |
|---|---:|---:|---:|---|
| unreachable: path failed | 1,489 | 29.7% | 10.2 | iron_ore 546, dirt 498, coal 208 |
| unsafe target (water / falling / cave floor) | 1,174 | 23.4% | 0.5 | iron_ore 587, oak_log 384 |
| interrupted (entombed 731, stagnation 106, stuck 73) | 924 | 18.4% | 5.4 | iron_ore 420, dirt 223 |
| unreachable: no stand spot | 554 | 11.0% | 1.7 | iron_ore 452 |
| buried: "use mine" (after gather's own escalation) | 512 | 10.2% | 0.5 | iron_ore 396 |
| no target nearby | 167 | 3.3% | 0.0 | oak_log 74 |
| bag full (the tunnel's room check) | 97 | 1.9% | 0.1 | iron_ore 78 |
| path timeout | 56 | 1.1% | 0.8 | iron_ore 36 |
| underground / canopy (logs) | 43 | 0.9% | 0.5 | oak_log 37 |
| **wrong / worn tool** | **3** | **0.1%** | 0.0 | iron_ore 3 |

- **Tools are not the gap:** 0 of 3,221 iron gathers came from a bag without a stone-or-better pickaxe.
- **Iron is the outlier:** 39% of gather runs at 12% ok (deepslate 18%); the rest succeed ~56% (cobble 82%, dirt 61%, logs 51%).
  Per bot-hour of skill time, gather still yields the most raw iron (39 / bot-h vs deep_mine 8.3, mine 4.4); its failures are
  cheap in duration and cost the decision.
- **The hand-off to mine already exists** (skills.mjs: gather escalates to the ore tunnel / `mine` once per run). Of 609 buried
  failures, what mine said: every ore beside liquid or a falling block 236; **"tunnelled to iron at X" 117**; no room 93;
  no tunnel route ~85; no escalation (logs) 52.

### Craft: 242 failures

bag full 79 (craftroom-02, queued), interrupted 77 (escape), **iron_pickaxe "short 3x iron_ingot for the whole tree" 46**,
table out of reach 22 (stations), bucket short 6, "craft cobblestone/dirt" 6.

### Chest-first (the coordinator's part 2): does not fit

- **Dirt** (2,129 gathers): every one of the 29 town indexes holds 0 dirt (the stock target for dirt is 0: it goes down the well).
  The same indexes hold 3,000-5,600 logs and ~1,000 cobble a town (positive control).
- **Logs**: of the log gather proposals, 1,204 are the idle batch "Cut 16 logs for the town store" and 137 "Stockpile N logs":
  the town's own stocking, so a withdraw would be circular. 3,591 logs gathered in 6 h, **1,887 thrown down the junk well**,
  1,447 deposited; `idleMeans` offers the log batch unconditionally (`logs: true`). This is **logcap-02** (built 11-08, queued
  5th): it turns the batch off above 1,024 town logs; the measurement here adds nothing it misses.
- What chest-first could reach: the ladder rungs "Collect N log" (248) and "Collect N cobblestone" (162), ~7% of the proposals,
  already 51% / 81% ok. Dropped (coordinator, D).

## 2. ironchain-01 (B): the ore tunnel aims only at ore gather may take

**Mechanism.** The 117 "tunnelled, still buried" rows arrive with median 0 planned breaks: the bot already stands beside the
target. 184 of the 246 such rows in the live logs name a **`lining` cell of the town stair's record**
(`project-<home>.shaft.gN.json`). RCON (read-only) at four of them: plain `iron_ore` with 3-4 air faces (isolated-c 369,16,121;
hive-b 330,21,134; board-d 332,20,139; board-a 376,5,205). gather never takes a record cell (`shopCellsNow`: "the town stair's
cells are gather targets never"); the tunnel picked its target with its own filter (hazard + 12-block home radius), so from the
landing the stair's ore -- always the nearest -- won every time and the real ore behind it was never tunnelled to. The same bot
re-asked up to 13 times on one cell; 4-5 bots of a pool shared one cell (board-c 353,-2,96; hive-b; isolated-c).

**Change** (branch `ironchain-01-on-bcdba35f`, tip `a9a73984`): `oretunnel.mjs tunnelTargets` (pure: the old filter, plus an
`eligible` rule, counted apart); `skills.mjs tunnelEligibleOf` (gather's per-cell enumeration rule, read-only: town ground,
record cells, keep-out columns, cave floors) handed to `tunnelToOre`; with nothing eligible the tunnel refuses naming it and a
move ("mine down to new rock"); `_ironchain_tunnel` change row; `IRONCHAIN_TUNNEL=0` restores.

**Tests** `bots/test/ironchain.test.mjs` (9): the pure rule; the cell rule cell by cell; `tunnelToOre` on the real
mineflayer-pathfinder over a fake world -- the positive control reproduces the stair pick, the fix plans for the real ore; the
refusal; wiring + 2 anchored mutants. oretunnel, tunnel-escalation, cavefall, townground pass.

**Paper** (sandbox8, `sandbox/ironchain/lining-e2e.mjs`, the real bot, scripted `gather 2 iron_ore`; a stair record whose lining
cell is an exposed ore 4 blocks along the landing corridor, a real ore buried 6 south; verdicts by RCON):

| run | build | tunnel aimed at | gather | raw_iron (server) | lining ore |
|---|---|---|---|---:|---|
| base1, base2 | bcdba35f | the lining (0 breaks) x2 each | 3/3 failed "buried [tunnelled to iron at 9004,16,9000]" | 0 | intact |
| cand1-3 | a1333e9c / 67f43e73 | the real ore (8 breaks) | success "collected 2 iron_ore" | 2 | intact |
| only1 (16 cobble) | cand | refused: 0 eligible (1 ineligible) | buried; then `mine 8`: refused by mine's own exit contract, naming surface | 0 | intact |
| only2 (64 cobble) | cand | refused: 0 eligible | buried; then `mine 8`: **success, reached y=9** | 0 | intact |

**Reviews** (tier 3, both engines, blockers only): Codex r1 no blockers; independent Claude r1 no blockers (note: the rule
applies after findBlocks' 64, so near town 64 ineligible cells could hide eligible ones -- no worse than the base).

## 3. ironchain-02 (C): an iron pickaxe asked for swings, with no iron in the bag, is a stone one

**Mechanism** (decision stream, 12 h): 110 model `craft iron_pickaxe` failed "short 3x iron_ingot"; 95 came from bots holding
2+ usable pickaxes and an iron copy with > 10 uses. Tool hygiene refuses those as redundant **except** for its swing-reserve
exemption: the bag's pickaxe swings were below `descentPickNeed` for the bot's depth (64 of 95 at y <= 16). The exemption is
right (mine refuses below that line, its remedy is another pickaxe), but it admitted the one pickaxe the bag cannot make.

**Change** (branch `ironchain-02-on-bcdba35f`, tip `02cd74b1`): `pickswings.mjs swingRewrite` (pure) -- admitted with the reserve
exemptions and refused without them, the bag's whole-tree plan cannot make the iron one, and it can make a stone one ->
admission rewrites `args.item` to `stone_pickaxe`, `count` 1 (in place, as it rewrites block names); `skills.mjs
craftableFromBag` is the craft skill's own `planCraft`; `_pick_swings` row; `PICKSWINGS=0` restores. Never what the task wants.

**Tests** `bots/test/pickswings.test.mjs` (10): the rule case by case; the real `AdmissionControl.check` on real items and the
1.21.8 recipes; the chain (the stone copy made, the same iron proposal is refused "dig with it"; the stone craft is one the gate
admits); an iron block in the bag leaves the iron craft alone; 2 anchored mutants + wiring.

**Reviews**: Codex r1 2 blockers (the count kept; "< 3 ingots" is not "iron uncraftable": an iron block or nuggets) -> fixed
02cd74b1; r2 "both closed; no blockers". Claude r1 no blockers.

## 4. The fleet pieces

| run | branch / tip | registration (canary host) | effect: primary | rollback |
|---|---|---|---|---|
| ironchain-01 | `ironchain-01-on-bcdba35f` a9a73984 | `~/mcai-analysis/ironchain-01.a9a73984.json` | `gather:buried:tunnelled:iron` rate -50% | `IRONCHAIN_TUNNEL=0` |
| ironchain-02 | `ironchain-02-on-bcdba35f` 02cd74b1 | `~/mcai-analysis/ironchain-02.02cd74b1.json` | craft `missing_ingredients` rate -30% | `PICKSWINGS=0` |

Both pass `effectwatch.py validate`; `drawrec.sh` gives a non-empty DRAW for both (01: hive-c, board-a, placebo-d, hive-a under the fun fallback while workboard-01 holds the slot; 02: board-c, board-d). Draft queue entries beside them; not queued; nothing pinned.

**Suites** (w30, git context): ironchain-01 a1333e9c 418/425 -- coalrun-mine's source anchor on the tunnel call was this change's, fixed in a9a73984 (test-only, 3/3); ironchain-02 02cd74b1 419/425. The remaining failures (buildrun, leasegen, lavastep, plinth-skill, well, ziggurat-tidy, ziggurat-v2-build) are the w30 base set: cobbleroom-01-r1 on the same lineage fails the same files. Showcase: not built (the showcase stair and its
iron rung are a different lineage; port after a fleet KEEP).
