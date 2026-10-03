# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-02 20:20Z (see the EVENING section first); earlier stamp 06:10Z by the autonomous operator session (owner grant 10-02 04:45Z: 15-20 h on v1, iron first,
both engines, reports every 4-6 h) — **CANARY LIVE: `fixes-03` on `8453c09`, pools hive-c, board-a, placebo-d,
placebo-b (20 bots), declared 05:03:00Z.** Fleet baseline `bf296c9+9287fd` on the other 60. Exactly two versions live
at 05:10Z. `canary-loop.sh fixes-03` (pid 1921117) does reads/verdict/record/promote/teardown. NOTHING is chained
behind it (chain-ore.sh stopped 10-01 on fixes-02's revert)._

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. Long history: `git show 40a09da:docs/reports/STATE.md`
> (to 09-30 morning), `git show 6a18e70:docs/reports/STATE.md` (09-30 evening), `git show d67d840:docs/reports/STATE.md` (10-01).

---

## 10-02 EVENING (20:20Z) — CURRENT
- **fixes-03 KEPT +360 (11:15Z) and PROMOTED: fleet is `8453c09` on all 80.** Good pickaxes lost 1 (120 canary bot-h) vs
  208 (240 control); spent-pickaxe satisfactions 0/147 vs 283/651; climbs +19% (normal); deaths 3 vs 8.
- **digsync2-01 (254f208) REVERTED +180 (15:17Z) on its own correctness gate**: 91 silent acks, 61 got AIR in the 3 s
  grace, 30 restored, 22 of those false (0.73). The server never sends a non-air word; silence = slow break. The
  chain to oretunnel-02 STOPPED correctly. Memory: silence-is-not-refusal. Telemetry detail is capped at 300 chars.
- **NEXT (OWNER 10-02 ~22:15Z: "run explore-toward after the ore tunnel"): exploretoward-02, CHAINED** by
  `chain-after.sh oretunnel-03 exploretoward-02` (pid 2073712, log ~/chain-exploretoward-02.out). It launches after the
  ore tunnel ends WHATEVER its verdict, picking the variant by fleet sha: 8453c09 -> b268881 (explore-on-8453c09, 214/214),
  3edf1d6 -> ccead1e (explore-on-3edf1d6, 215/215). Registrations docs/reports/exploretoward-02.<fleet>.json; read
  /tmp/exploretowardread.py (dry run: instrument 429 control rows).
- **oretunnel-03 +180 (23:27Z): NOT_YET, exposure ready.** 12 tunnels; the 3 that ran ALL reached the ore (3 raw iron;
  control 0); the other 9 were `inventory_full` refusals on 2 bots holding 176-252 spare in stone stacks but no free slot.
  Climbs 8.9 -> 6.7/bh (control 6.7 -> 6.0); deaths 1 vs 6. KEEP possible at +360 (~02:22Z).
- **SHADOW MAYOR LIVE since 2026-10-03 03:17:40Z** on 10.0.0.31: transient unit `mcai-mayor-shadow` (Nice 10, MemoryMax
  512M, CPUQuota 25%, Restart on-failure, exit 6 = output cap, stays down), code ~/mcai-mayor = branch shadow-mayor
  @ a6e8f15 (both engines approved the deterministic part; 66 tests, 60 suite mutants). Writes ONLY /var/lib/mcai-mayor
  (snap-/assign-<world>.jsonl). First tick: 80 bots, 16 worlds, 29 would-assign, 2.0 s CPU, 27 MB. A transient unit
  does not survive a host reboot -- restart it with the same systemd-run line (README). **Decision date: 2026-10-06
  03:18Z (KEEP-BUILDING or STOP).** Frontier replay needs API keys on the host (owner to place) + the client fixes
  queued with the builder.
- **TIMELINE (OWNER 10-03 ~04:40Z: "end of next week is fine"; NO bundling — one change per canary for clean attribution):**
  ore tunnel decides ~22:22Z 10-03 -> explore-toward (+pickup log) -> craftroom -> orepack -> composter (after sandbox)
  -> cell memory (town map stage 1) -> bone-meal trees, bank fix, town map stages 2-3. Shadow mayor in parallel (72 h).
  Chain each next canary on the host as soon as its reviews pass (chain-after.sh), so no operator gap stalls the queue.
- **QUEUE (OWNER 10-03 ~02:15Z: "build a composter, put it in the queue"):** 1) oretunnel-03 (live, verdict ~02:22Z)
  -> 2) exploretoward-02 (chained) -> 3) orepack (ready) -> 4) **composter** (BUILDING, branch composter-on-3edf1d6;
  design agreed by both engines 09-30: one per town, deterministic only when already at town with >= 34 slots, compost
  leaf litter/seeds/flowers, keep saplings/food, collect bone meal, place >= 3 from containers). Then implementation
  reviews by both engines + sandbox. 6) **CRAFT-ROOM + TABLE** (10-03 03:20Z diagnosis): of 7 bots holding cobblestone+sticks without a trip pickaxe, 5 carry
  no crafting_table (crafts fail "need a crafting_table" / "table 32 blocks away could not be reached"); and hive-a-Delta
  (table, full bag) CRAFTED a stone_pickaxe that never reached its bag -- mineflayer drops a craft result with no room
  (163 of 325 pickaxe crafts in 4 h logged "nothing changed"). Fix: never craft into a full bag (make room first or
  refuse with an executable remedy); keep/carry one crafting table; trip-sized pickaxe threshold (need, not a flat 40).
  8) **TOWN MAP / shared mind map** (OWNER 10-03; plan docs/reports/town-map-plan-2026-10-03.md; live shared updates OK): stage 1
  building (remember failed cells, go where gathering worked); stages 2-3 after. 9) **LOG PICKUP** (both engines, 10-03 ~04:40Z, independently): the top log-gather failure is NOT reach -- the log is broken
  and the DROP is not picked up: 291/949 failed log gathers (31%, 48 bots) end "collect threw nothing" and are then
  classed no_path (an action-level learned-avoid vote); 1,866 log drops left behind vs 2,584 logs gained in 3 h; the
  pickup walk's GoalNear(drop,1) times out when the drop rests on leaves (27% of left drops 2.3+ above the feet).
  BUILDING (branch logpickup-on-93b3892): pickup-box goal, break the supporting leaves, finish on inventory gain,
  fail class pickup_failed (no avoid vote). Slot: right after craftroom.
  **SANDBOX 10-03 ~07:00Z (720d079 vs control, 3 reps/scene): wins every scene** — open trunk 15/15 vs 12/15 at
  1.8 vs 6.7 s/log; canopy branch 18/18 vs 14/18; stub 15/15 vs 12/15; full bag 1 log + inventory_full vs control 3 logs
  left + no_path + an avoid rule per rep. Defects being fixed: falling drops judged before landing (server sends item
  positions ~1/s); walk scaffolding with the gathered logs (pre-existing); unreachable label; sweep count. 11b) **CRAFTSYNC — ROOT CAUSE FOUND (sandbox A/B 10-03 ~07:30Z, RCON-verified):** with spare ingredients, unpatched
  mineflayer 4.37.1 silently loses 7/40 single table crafts, 3/20 2x2 crafts, and comes up short on 11/20 repeated crafts in
  one window, reporting success. Cause: ONE global stateId (usually window 0's) + fire-and-forget clicks; Paper applies the
  stale clicks but answers with full refreshes that land behind the click burst, reverting a local slot -> put-away swaps
  on the server -> the result click picks up nothing. LOCKSTEP clicks during bot.craft (wait for quiet; one forced resync
  on open) -> 0/20, 0/10, 0/10; never hung; ~1.4 s per craft. Per-window stateId alone: 3/10 short. BUILDING
  craftsync-on-93b3892 (own canary; propose it NEXT after explore-toward — it is the pickaxe supply). Upstream: mineflayer
  #3906 (same symptom), #4103 (per-window stateId), #3974 (4.39.0). Artifacts: session scratchpad craftsync/.
11c) **CRAFTING STATUS 10-03 ~09:30Z:** craftroom APPROVED by both engines at **f0a677c** (verdict from server packets,
  reconcile + one retry after a denial, wear-out room remedy, table retake, `crafted` evidence contract). craftsync
  (lockstep + post-craft verification) in its third round. Both reviewers: keep craftroom's verdict/retry as the safety
  net when combined with craftsync; a combined branch needs a test that the final-click marker survives craftsync's
  click path. PRE-EXISTING FLEET BUG found by the Claude reviewer: craft passes the ITEM count as the CRAFT count (ask 4
  sticks -> 4 crafts -> 16 sticks; wood wasted; can throw 'missing ingredient' after success) — fixed in craftsync,
  must also be applied when craftroom is combined. OWNER DECISION NEEDED: craftsync + craftroom as one 'crafting' canary
  or two.
11) **TABLE CRAFTS REJECTED BY PAPER (sandbox 10-03 ~06:00Z, RCON-verified, BOTH builds):** 5 of 12 crafts at a
  crafting table were rejected by the server (no result, ingredients back in the bag) — mostly the first craft after a
  table is placed — while the fleet's code reports success with a pickaxe that exists only locally. 2x2 grid crafts were
  not rejected. Likely a large share of the fleet's 44% "crafted, nothing changed". Suspect: mineflayer stateId / clicking
  before the crafting window's initial window_items. Both engines diagnosing (root cause + smallest fix in our code).
  Also from that run: wear_out's waitForTicks(2) check misses breaks (same code on the fleet). 10) EXPLORE BLIND-STEP HEADING BUG (pre-existing,
  confirmed by the Claude reviewer 10-03): explore's fallback step calls bot.look(ang) with a math angle, so the body walks a
  MIRRORED heading (ang=0 east walks north). Not a lava risk (stepLineSafe checks the walked line). Fix
  look(Math.atan2(-Math.cos(a), -Math.sin(a)), 0) as its OWN canary (changes explore fleet-wide). 7) **BONE-MEAL TREES AT TOWN** after the composter (renewable wood where the bots live). 5) **SHADOW MAYOR** (OWNER 10-03 ~02:30Z; plan docs/reports/shadow-mayor-plan-2026-10-03.md,
  both engines): host-side, observe-only, NO canary slot -- runs in parallel with the queue; frontier replay after ~24-48 h of
  snapshots; decision date 72 h after start. LATER IDEA: bone meal on planted saplings grows trees at town (the wood bottleneck).
- **READY, not registered: orepack** (branch orepack-on-3edf1d6 @ **f642b17**, 215/215, 43 tests): tunnel room by CAPACITY
  per item with a reserved ore slot (ore room = route iron + target cluster at max drop + 5 slack), post-plan recheck,
  enchanted tools refused with a structured need, a plan-time veto on unplanned digs (same-item spare only, never an empty
  slot). Stack MERGING and bamboo->stick CRAFTING were built and REMOVED (both engines: click races / crafts can toss);
  a bot.dig wrapper was REMOVED (it could refuse a reflex's rescue dig). Reviews: Claude AGREE, Codex APPROVE (6 rounds).
  Of tonight's 9 refusals it would let 3 proceed (the 6 others have no slot for the ore at all). Sandbox: on a full bag it
  passes the room screen where 3edf1d6 refuses; the corpus-iron scene itself is unroutable for BOTH builds (noPath).
  TO RUN: rebase onto the fleet sha after explore-toward; read = tunnel attempts/refusal classes per bot-h, iron collected,
  raw iron left on the ground (the documented residual), enchanted_tool count (expect 0).

- **LEAD (unverified):** 163 of 325 pickaxe crafts that "succeeded" in 4 h logged "nothing changed" (inventory gain not
  seen); 62 of them on an estimated-full bag. mineflayer drops a craft result when the bag is full. Worth a read.
- **WHY IRON IS RARE (10-02 21:00Z, 80 bots, 2-3 h):** iron visible in 77% of scans, but 53/80 bots hold NO pickaxe
  and 52 of those hold no wood; only 11 hold a trip pickaxe, and the iron rung exists only for them. 68% of 1,186 log
  gathers fail (unreachable / no standing spot / beside water); escapes burned ~145 logs in 2 h.
- **oretunnel-03 LAUNCHED 20:19Z**: the ore tunnel on 8453c09 WITHOUT digsync (branch ore-on-8453c09 @ 3edf1d6,
  214/214, Codex APPROVE). Registration docs/reports/oretunnel-03.json. Reads oretunnelread + immobiledid, 180/360/720/1560.

## 10-02 — WHY fixes-02 REVERTED, AND WHAT RUNS NOW
- fixes-02 (f5609af, 10 bots) REVERTED +180 on v11 climbs +123%. **The trip was REAL**: null 858 random 2-pool draws
  (12 h single-version) put climbs > +100% at 0.1%; trapped-seconds +177% vs null p99 +125%. It came with 5x more
  successful mine descents (5.6 -> 30.0/bot/3 h; control flat). Per depth-hour: mid band (y48-62) canary ~ control;
  below y48 canary trapped-s/bh 495 -> 1044 while control 559 -> 370. digsync v1 is the suspect: 92/138 rollbacks
  were false restores (server AIR within 2 s); climbs 2.3-5.1x faster in the 2 min after a rollback.
- **fixes-03** = the bundle minus digsync (branch fixes-nodig-on-bf296c9, 213/213; Codex CHANGES applied:
  fixesbundleread fails closed, licence `_progress_restored` with per-bot coverage). Reads +180 **08:03Z**, +360 **11:03Z**.
  If it trips climbs again: revert, and conclude dropping digsync was insufficient (frozen in the registration).
- **digsync-v2** (branch digsync2-on-8453c09 @ ede3b83, 214/214): a 3 s grace after an ack with no server word;
  restore only at expiry. Codex review + sandbox corpus (control 8453c09) running 06:00Z. Next canary after fixes-03.
- **ore tunnel** rebuilt on digsync-v2: branch ore-on-digsync2 (worktree ore2), tests running.
- **CHAINED ON THE HOST (10-02 06:54Z), each step STOPs on anything but `promoted` at the expected fleet sha:**
  `chain-next.sh fixes-03 8453c09 digsync2-01` (pid 1940380, log ~/chain-digsync2-01.out) and
  `chain-next.sh digsync2-01 254f208 oretunnel-02` (pid 1940387, log ~/chain-oretunnel-02.out). Registrations
  ~/mcai-analysis/digsync2-01.254f208.json, oretunnel-02.553adf2.json (= docs/reports/*.json). Reads in /tmp.
  digsync-v2 final sha **254f208** (3 review rounds, both engines); ore-on-digsync2 **553adf2** (216/216).
- **Climbs guard**: both engines recommend (prospectively) outcome guards — trapped-seconds/bot-h and unrecoverable,
  null-calibrated with restarts — with raw climbs demoted to INCONCLUSIVE; NOT "per descent" (the change makes the
  descents). NOT applied: decide after fixes-03 shows whether digsync v1 caused the traps.
- Iron pickaxes: all 5 lost with >100 uses (24 h) vanished in the same second as an entombment reflex (the toss bug;
  tool-safe, in fixes-03, fixes it).


## WHAT HAPPENED SINCE 09-30 13:20Z (all decided by the host loop)
| run | sha | result |
|---|---|---|
| lastswing-01 | 8ed9450 | KEEP +360, promoted 09-30 19:16Z |
| hygiene-01 | adc7658 | KEEP, recorded 10-01 01:46:59Z, promoted |
| fixes-01 | a943b7f | **REVERT +180 (05:10Z) — FALSE.** The one failing row (prequsableread.spent_satisfied_judged) was placebo-a-Comet 02:03:06Z on the OLD build adc7658, before the restart finished (declared 02:02:10, deployed 02:05:30). Canary-build rows: 0 of 45 spent-satisfied; control 101 of 212. The recorded verdict stands; amendments prospective only. |
| idlegap-01 | bf296c9 | KEEP +360 (11:28Z; deaths 0 vs control 9), promoted fleet-wide 11:38Z; `main` merged it (a2b5d36, `main-pre-20261001b` kept), 208/208 |

**Read fix (e8cd891 on main, /tmp on 10.0.0.31 with `.bak-20261001T*`):** prequsableread, toolsaferead (`_tool_gone`)
and immobiledid (deaths → two-death floor) skip a post-cutoff canary row whose version is NON-EMPTY and not
startswith(CV). Empty versions still count (0 of 450,482 rows carry one). Codex: CHANGES → narrowed → APPROVE. The
other member reads already filtered (audit by a Claude subagent). Memory: restart-lag-rows-are-not-canary.

## (PAST, REVERTED 10-01 16:39Z) fixes-02
| | |
|---|---|
| sha | `f5609af` (branch `idle-on-a943b7f` = fixes3-on-adc7658 a943b7f + bf296c9), 214/214 |
| members | digsync, stale-stop, craft-advice, hive-progress, prereq-usable, tool-safe, bank-why (same seven as fixes-01) |
| pools | board-a, hive-c (both 5080 half) — drawn by the loop 13:28:20Z |
| declared | 2026-10-01T13:28:21Z |
| read +180 | **2026-10-01 16:28Z** (correctness) |
| read +360 | **2026-10-01 19:28Z** — KEEP possible |
| extensions (until exposure) | 540 → 22:28Z · 720 → 10-02 01:28Z · 1080 → 07:28Z · 1560 → 15:28Z |
| deadline | **2026-10-02 17:48Z** (1700 min; v30 passes) |
| registration | `~/mcai-analysis/registrations/fixes-02.json` = `docs/reports/fixes-02.f5609af.json` |
| reads | digsyncread stalestopread craftadviceread hiveprogressread prequsableread toolsaferead bankwhyread fixesbundleread immobiledid (all /tmp) |
| promotion | fleet-wide on KEEP. Then merge `f5609af` into `main` (keep `main-pre-<date>`). |

A REVERT names its member; drop that member and rerun the rest — **but first check the failing rows' build
(`raw.code.version`)**: fixes-01 was lost to an old-build row.

**If the loop has died:** `pgrep -af canary-loop`. If absent and no decision is recorded, restart with
`setsid nohup bash ~/canary-loop.sh fixes-02 >> ~/canary-loop-fixes-02.out 2>&1 < /dev/null &` (resumes from journal).

## (STOPPED) oretunnel-01 chain — rebuilt as ore-on-digsync2, see 10-02 above
`~/chain-ore.sh` (repo `scripts/host/chain-ore.sh`): when fixes-02 ends `promoted` with fleet `f5609af*`, registers
`~/mcai-analysis/oretunnel-01.f5609af.json` (sha **49096f4**, branch `ore-on-f5609af` = bc3bcba + f5609af, 215/215,
v30 passes at 1680) and launches the loop. ANY other ending (torn-down, refused-*, error) → STOP; then rebuild ore
on whatever the fleet is (bc3bcba carries the bundle, so on a torn-down fleet it needs the bundle members removed).

## FLEET
| | |
|---|---|
| baseline | `bf296c9+9287fd`, 70 bots |
| canary | `f5609af+433de1`, 10 bots |
| `main` | `6a18e70` = fleet bf296c9 + docs/scripts |
| analyst 12:00Z | fleet healthy, one version; 49.9 items/bot-h, 39.6 decisions/bot-h; 8 immobile; 3 deaths in 2 h |
| iron funnel (24 h) | raw iron 23, ingots 32, iron pickaxes crafted 3, gone 22 (14 at <= 3 uses) |
| last-swing fleet check | 09-30 baseline to compare: 21/80 bots with a usable pickaxe, 37.5 items/bot-h, 42 deaths/24 h — NOT yet re-measured |

## LOOP STATE
- `check-open-loop.py` 12:05Z: "no open canary". It names fixes-02 open until the loop records a decision.
- **While fixes-02 is unread, no new analysis starts.** Build/stage work for later slots is fine.

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file; on 10.0.0.31: `grep -E '"fixes-02"|"oretunnel-01"' ~/canary-journal.jsonl | tail`,
   `cat ~/chain-ore.out /srv/mcbots/trial-manifest.json`, `tail ~/digest/page.jsonl`.
2. `pgrep -af 'canary-loop|chain-'` — expect `canary-loop.sh fixes-02` and/or `chain-ore.sh`.
3. If fixes-02 decided: KEEP → confirm 80/80 on f5609af, merge into `main`, PushNotification; confirm chain-ore says
   `launched`. REVERT → check the failing rows' build before believing it; confirm teardown (ONE version), write up.
4. Live versions: `cd /opt/minecraft-ai/scripts && python3 -c "from lib.telemetry import Events; e=Events.load(since_minutes=8); print(e.versions())"`.
5. Monitors: ONE background `until` wait on a journal phase, not re-armed 30-min Monitors.

## OWNER CALLS WAITING (unchanged from 09-27)
1. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
2. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect. (fixes-01 is now another false revert,
   by a different mechanism: restart-lag rows.)
3. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
4. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## QUEUE
1. **fixes-03** — LIVE (fixes-02 reverted).
2. **oretunnel-01** — chained.
3. Then each its own canary (rebase onto the fleet sha at launch): **bankfix-01** (bank-fix 15dec57; gate reads
   ledger/RCON, never `_deposit_window`), **exploretoward-01** (86e8985), **vetoretry-01** (1efd82c; d0c47c6 follows).
   Registrations staged in docs/reports (shas need rebasing). Before staging any new read: copy the known-other-build
   skip from prequsableread into every correctness/harm count.
4. COMPOSTER (hygiene phase 2) — designed by both engines 09-30, not built (see `git show 6a18e70:docs/reports/STATE.md` 3c).
5. PARKED: `tool-guard` b1d6b62.
6. Analysis backlog (only when no canary is unread): last-swing/hygiene fleet-wide effect vs 09-30 baseline; why
   `gather cobblestone` ends no_path at the surface; escape burns logs as scaffold; planting cohort vs depletion;
   `container_open` 446/4,160 uncharacterised; ~6,000 bamboo carried (2 bamboo = 1 stick).
7. Colony path: chest ledger (in bank-fix) → shadow-mode mayor (`docs/reports/jobs-mayor-spec-2026-09-29.md`).

## WORKTREES / BRANCHES touched 10-01
- `idle-on-a943b7f` @ f5609af — the live canary; on origin.
- `ore-on-f5609af` @ 49096f4 — chained; on origin (pushed `--no-verify`, new branch only).
- session scratchpad worktree `fx` (disposable).
- `mcai-rl02` worktree carries someone else's uncommitted `check-movement-writers.mjs`, `movement-ratchet.test.mjs`
  and 09-27 reports — still left alone.
