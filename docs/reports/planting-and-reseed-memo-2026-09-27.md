# Planting fleet-wide AND sixteen fresh worlds — the evidence, and what I want destroyed

_written 2026-09-27 05:55Z (date -u on the mini). OWNER DIRECTIVE, this session: "lets deploy the tree
planting but also start fresh worlds. this will allow the bots to get to work, but trees to start
growing early in the process."_

## 0. The state I am building on, verified this session and not taken from the handoff

| fact | value | how |
|---|---|---|
| live fleet sha | `859af48+b862bc`, ONE version, 80 bots | `raw.code.version` census, 59,508 rows / 90 min |
| manifest | `run_id promote-20260926`, `canary_pool` empty | `/srv/mcbots/trial-manifest.json` |
| deployed at | 2026-09-26T23:27:09Z | manifest `declared_at` |
| pools carrying bots | 16 worlds x 5 = 80 (the isolated arm's `exp.pool` is per-bot, `self-isolated-*`) | pool census, 60 min |

### HARM READ on the 859af48 promotion — no harm, and no credit either
Warm window, deploy hour dropped, equal-length pre (18:00–23:00Z) and post (00:00–05:00Z),
300 bot-hours each side.

| endpoint | pre/bot-h | post/bot-h | change | per-pool ratio spread (n=12) |
|---|---|---|---|---|
| items | 13.79 | 19.62 | **+42.3%** | min 0.46 … median 1.31 … max 2.66 |
| decisions | 41.69 | 41.27 | −1.0% | 0.89 … 0.94 … 1.26 |
| deaths | 0.020 | 0.023 | 6 vs 7 raw | unmeasurable at this n |

**The items move is NOT creditable to the deploy.** The per-pool ratios span 0.46–2.66, which is the
documented between-pool noise band, and this is a fleet-wide before/after — the exact design
CLAUDE.md forbids for crediting. It is reported only because a −59% harm would have cleared that band
and this does not. Decisions, the quiet high-count endpoint, is flat to 1%.

**The reserve's specific risk was hoarding, and it did not happen.** deposit outcome mix, 913 pre /
677 post rows: `storage_full` 6.8% -> 7.8% (62 -> 53 raw), success 3.7% -> 4.3% (34 -> 29 raw). Both
inside noise on these counts. The banktruth message rewrite is visibly live — the class
"nothing matching X to hand" (250 rows pre) is replaced by "you are carrying X, but ..." (143 rows
post), which is the same refusal telling the truth. **That refusal is still firing at a similar rate,
so banktruth-01 renamed it rather than removing it. Flagged, not addressed here.**

---

## 1. THE POPULATION, measured 60 minutes ago

    bots with an inventory snapshot   80 of 80
    bots holding >=1 sapling          80 of 80  (100%)
    total saplings held               10,125
    by kind      oak 9,535   birch 575   jungle 15
    per bot      min 13   median 111   max 333

**Every bot on the fleet is carrying the fix's input, and 10,125 saplings are sitting idle.** Zero have
ever been planted: no sapling has appeared in a `place` attempt in the telemetry's history.

### Why zero: `place` scored SOLIDITY, not placement
`skills.mjs` on `main` judged success with
`if (!put || put.name === 'air' || put.boundingBox === 'empty')` -> not placed. Saplings, torches and
plants are all `boundingBox: 'empty'`, so **every successful sapling placement was recorded as a
failure** and the model's own win channel learned that placing is useless. Torch placement reads 0/16;
dirt, which is `'block'`, reads 22/26.

### The arithmetic, and it is not close
The fleet takes **3,605 logs/day**. An oak yields ~4–6, so consumption is roughly **700 trees/day**.
A one-per-ten-minutes obligation is 6/bot-h x 80 = **11,520 plantings/day**. Even a few percent
survival outpaces consumption. **The cap is not the binding constraint.**

### EXTERNAL BEHAVIOUR, checked rather than assumed — saplings really do grow in these worlds
This is the claim the whole plan rests on and it is the one that is not mine to assert.

- `spigot.yml` growth block, board-a: **`sapling-modifier: 100`** — vanilla rate. Positive control:
  all 23 modifiers in that block read 100, so nothing was tuned down.
- Live RCON sweep, **all 16 worlds, each with its own rcon password**: `randomTickSpeed` **3** and
  `doDaylightCycle` **true** in 16 of 16. **Worlds where growth is not confirmed: none.** Positive
  control: the `time query daytime` in the same call returned a DIFFERENT value per world
  (1,974–20,411), so RCON is reading each world and not echoing one.
- `paper-world-defaults.yml`: `max-growth-height` names only bamboo/cactus/reeds; `tick-rates` names
  no sapling entry. No Paper-side suppression.

---

## 2. WHAT I INTEND TO DEPLOY — `plant-on-859`, cherry-picked onto the live sha

`2d985b4` was built on `efa2853`, which is an ANCESTOR of the deployed `859af48`, so it was
cherry-picked (`skills.mjs` auto-merged clean) rather than deployed as a sibling. This is the hazard
that nearly reverted an OWNER DECISION last time: `9a6aa13` was a sibling of `efa2853`, not a
descendant.

1. **The place read-back** — `placementLanded({before, after})`: placed means the cell CHANGED, not
   that it became solid.
2. **Soil predicates** — `PLANTABLE_SOIL`, `needsSoil`, `soilOk`, `isPlantable`, `plantableSpotNear`.
3. **The planting obligation** — `plantingOrder()`, `PLANT_RESERVE = 8`, `PLANT_COOLDOWN_MS = 10 min`.
   The cooldown is charged when the order is ISSUED, so an unplantable spot costs one decision per ten
   minutes, not one per decision. Review already caught and fixed the reverse (the 75-call
   `plantableSpotNear` sweep running before the cooldown check, on 100% of bots).
4. **NEW this session — `plantingEnabled(env)`**, so the arm is carried in the ENV and not in a second
   code version. See §3.
5. **NEW this session — a `plant_spot` EVENT** (`found|none sap=N kinds=K ordered=0|1`). Without it a
   null order is invisible and "no trees appeared" has three indistinguishable causes: arm off,
   cooldown unexpired, no soil in reach. A new EVENT and never a new FIELD — the ELK templates are
   `dynamic:strict` and an unknown field drops the whole document.

**Suite: 201/201 files on the cherry-pick, plus `plant-arm.test.mjs` 6/6 including two mutants**
(defaulting OFF; `!!v` truthiness, which is the live bug in a hand-rolled env gate because
`Boolean('false')` is true). `lint:movement`: "ok — no new movement writers", 4 files, baseline 4.
No mutant files left in the tree.

**First-run caveat, stated because it nearly became a false negative here:** the fresh worktree had no
`node_modules` and the runner reported **76/201 with 125 ERR_MODULE_NOT_FOUND**. A cheap FAILURE is as
misleading as a cheap zero. 201/201 is after linking deps.

---

## 3. THE ARM IS AN ENV VAR, AND I WANT THIS ATTACKED

**A tree needs days. A canary is three hours on five bots. The instrument and the mechanism are on
different timescales, so a canary read of planting is not a weak test — it is not a test.**

So: **ONE sha fleet-wide, and `PLANT_ENABLED=false` in the env of 40 bots (8 worlds).** One code
version keeps the death tripper quiet — it matches `canary_pool` literally and two live versions halts
eighty bots.

**The default is ON and that is the load-bearing choice.** Defaulting OFF means a failed env write
ships an inert feature that later reads as a refuted one — the failure mode this project hit five
times in one day. With the default ON, a failed env write degrades to "all 16 worlds plant", which is
exactly the owner's stated request, so the worst case is the intent minus the measurement.

**Costs if this is wrong**, in order:
- **The split is not a registered canary.** `check-open-loop.py` will not raise on it, the loop will
  not read it, nothing tears it down. A week-long unregistered arm is precisely the thing this project
  forgets. *Mitigation I intend: a dated registration in `docs/reports/` and a liveness assertion that
  exactly 40 bots carry the var and `_plant_spot` rows appear from 8 pools and not 16.* **Is that
  enough, or does this need to go through the canary machinery despite the timescale mismatch?**
- **8 worlds deliberately deplete for a week.** That is the price of the control. All 16 get fresh
  worlds either way, so no bot is worse off than today.
- **n = 8 pools per arm.** The 3h items MDE is +146% at 4 pools, but this read is 7 DAYS, ~100x the
  bot-hours. Is 8-vs-8 over 7 days actually powered for the effect size in play (the fresh/worn
  log-gather contrast was 57.6% vs 7.0–7.9%)?

---

## 4. SIXTEEN FRESH WORLDS — and the tool that was supposed to do it DOES NOT EXIST

`docs/reports/seed-canary-registration.md:11` documents `scripts/reseed-pool.sh <pool> --go` and says
it "gained a guarded `--new-seed` so the next one is one command, not hand work."
**`find` across the repo, .30 and .31 returns nothing by that name.** The one-command reseeder is gone;
what survives is `place-town.py`, `pregen-world.py`, `backup-world.sh` and a prose runbook.

**And `place-town.py` is stale in the same way its own comment confesses:** `ARMS` maps eight worlds
(`hive-a/b`, `board-a/b`, `isolated-a/b`, `placebo-a/b`) and derives the RCON port as
`25670 + index`. The fleet is sixteen. The comment reads *"This map was still the pre-amendment four
when the build moved to two pools per arm."* It is now wrong for the same reason a second time.

The real ports, read from each world's own `TOWN-PLACED.json` rather than derived:

    hive-a 25670  hive-b 25671  board-a 25672  board-b 25673
    isolated-a 25674  isolated-b 25675  placebo-a 25676  placebo-b 25677
    hive-c 25678  hive-d 25679  board-c 25680  board-d 25681
    isolated-c 25682  isolated-d 25683  placebo-c 25684  placebo-d 25685

**14 of 16 worlds share seed `1239381899` and the identical town at 355,73,147.** Only placebo-a
(`8948499624371160708`, town 249,75,-144) and placebo-b (`7843072457371465157`, 282,65,-388) differ —
those are the 19 Sep reseeds. So the fleet is fourteen copies of one exhausted world plus two that are
eight days into the same decline.

### The 19 Sep evidence this plan is built on
`placebo-a` + `placebo-b`, fresh worlds, IDENTICAL code:

    day        FRESH items/bh  gok%  logok%     WORN items/bh  gok%  logok%
    09-18         18.39        14.2   4.9         24.70        20.1   7.3
    09-19         63.43        34.8  37.8         23.05        19.5   7.0
    09-20         51.23        46.1  57.6         19.34        19.9   7.9
    09-22         36.47        34.1  35.4         17.89        19.3   7.5
    09-25         20.79        22.6  16.5         13.97        18.1   7.6

Log-gather **4.9% -> 57.6% in two days on a world swap, 11.8x**, while the worn 70 sat at 7.0–7.9%.
**Then the fresh pools fell 63.43 -> 20.79 in six days, −67%.** A fresh world buys about a week.
Registered confound: that was reseed-PLUS-RESET (world and bot state together), n=2 pools, and the
siting script selects flat/dry/wooded ground.

### What I intend to do, per pool
1. stop the 5 `mcbot@<pool>-*` units; 2. stop `block2@<pool>`; 3. archive `world` ->
`world.pre-reseed-<ts>` and `TOWN-PLACED.json` likewise; 4. new `level-seed`; 5. start the server,
let it generate; 6. `pregen-world.py`; 7. `place-town.py <pool>` (needs the 16-entry map first);
8. rewrite `HOME_*`/`BOARD_*` in the 5 env files under `/srv/mcbots/harness/env/`; 9. archive and
clear bot state **uniformly across all 16**, so the reset does not confound the planting split;
10. start the bots staggered 12 s; 11. RCON-confirm 5/5 in world.

Disk: 348 G free, the 16 worlds total ~2.6 G, so archiving all of them is affordable.

### SEQUENCING — planting FIRST, reseed after
**I intend to deploy planting to the depleted worlds and watch it for ~2 hours before touching any
world.** "Do saplings get placed at all" is a CODE question answerable on today's worlds; a reseed with
broken planting code burns sixteen fresh worlds and answers nothing. The owner's goal is unaffected
because the reseed is hours away regardless.

---

## 5. WHAT I WANT YOU TO DESTROY

1. **Does planting actually put wood back, or does it put wood somewhere the bots will not go?**
   The fleet uses **0.95% of a 1,950-radius world**. If bots plant beside the town and then gather
   outward, the trees grow where nobody returns. Is there an argument this is inert for spatial
   reasons rather than growth reasons? What is the cheapest measurement that distinguishes them?
2. **`PLANT_RESERVE = 8` with a median holding of 111** — is a floor of 8 right, or is it a rounding
   error that should be a fraction? And `plantingOrder` spends **the species held most**; in a world
   where oak is 94% of holdings, does that matter?
3. **Sapling growth needs light >= 9 and vertical room.** `isPlantable` checks soil, a replaceable
   cell, and one block above. **It does not check light, and it does not check the 5–7 blocks of
   headroom an oak needs to actually mature.** Is that the defect that makes this inert — saplings
   placed under canopy or in a shaft that can never grow? How would you measure it BEFORE spending a
   week?
4. **The env-var arm** (§3) — is it sound, or does it need the canary machinery?
5. **Reseeding all 16 at once destroys every baseline the fleet has.** The 19 Sep fresh/worn contrast
   is the only causal evidence on depletion and it dies here. Is there a staged design that serves
   "bots get to work now" while keeping a control — and is it worth the complexity, given the fresh
   pools have already decayed back to 20.79 and the contrast is mostly spent?
6. **What must NOT be done today.**

## Rules for your answer
- Every negative claim carries a positive control. `file:line` for everything.
- Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs, not by effort.
- End with ONE sentence: the single most valuable change to the plan, and the one line that would tell
  us in 12 hours whether planting is working.
