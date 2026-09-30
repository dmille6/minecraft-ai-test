# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-30 13:20Z by the daily operator session — **CANARY LIVE: `lastswing-01` on `8ed9450`, pools
board-a, hive-c (10 bots), declared 13:04:30Z.** Fleet baseline `1d107ed+52f617` on the other 70. Exactly two
versions live at 13:15Z (telemetry: 5,797 rows / 80 bots in 8 min; 660 rows `8ed9450+addedf`, 5,137 `1d107ed+52f617`).
`canary-loop.sh lastswing-01` (pid 1553802) does the reads, verdict, record, promote/teardown. **UPDATED 15:56Z (owner
~13:15Z: "yes run hygiene before the bundle"): `hygiene-01` is auto-chained behind it (`~/chain-hygiene.sh`, pid
1613048); `~/chain-fixes.sh` was STOPPED (note in `~/chain-fixes.out`) -- relaunch it after hygiene-01 ends.**_

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. The 610-line version this replaces (full history of
> 09-27..09-30 night work, every branch's review trail) is `git show 40a09da:docs/reports/STATE.md` on main.

---

## THE LIVE CANARY — lastswing-01

| | |
|---|---|
| sha | `8ed9450` (branch `last-swing-on-1d107ed` = 1d107ed + last-swing, 205/205) |
| pools | board-a, hive-c — drawn by the loop at 13:04:29Z (only 7 pools pass its exposure filter) |
| declared | 2026-09-30T13:04:30Z |
| read +180 | **2026-09-30 16:04Z** (correctness; KEEP not possible yet) |
| read +360 | **2026-09-30 19:04Z** — KEEP possible if correctness, harm and exposure are clean |
| extensions | 540 → 22:04Z · 720 → 10-01 01:04Z · 1080 → 07:04Z · 1560 → 15:04Z (only until exposure) |
| deadline | **2026-10-01 17:04Z** (1680 min) |
| registration | `~/mcai-analysis/registrations/lastswing-01.json` = `docs/reports/lastswing-01-registration.json` (sha set at launch) |
| reads | `/tmp/lastswingread.py` (md5 c530a67c), `/tmp/immobiledid.py` |
| promotion | **fleet-wide** on KEEP (owner allowed 09-28). Operator then fast-forwards `main` to it, keeping `main-pre-<date>` |

What it is: gather may spend a pickaxe's LAST use, on the stone family only, with the held tool confirmed; licence
row `_last_swing` (baseline writes 0). Population: 61/80 bots could not make stone for want of a usable pickaxe.

**If you are the next session and the loop has died:** `pgrep -af canary-loop`. If absent and no decision is
recorded, restart it with `setsid nohup bash ~/canary-loop.sh lastswing-01 >> ~/canary-loop-lastswing-01.out 2>&1 < /dev/null &`
— it resumes from the journal and skips the redeploy because the manifest names the sha.

## NEXT CANARY — hygiene-01, AUTO-CHAINED (15:56Z; owner reordered: hygiene BEFORE the bundle)

`~/chain-hygiene.sh` (repo `scripts/host/chain-hygiene.sh`, log `~/chain-hygiene.out`) waits for lastswing-01 to end,
and launches hygiene-01 ONLY if the fleet is the promoted last-swing `8ed9450`: the hygiene branch is BUILT ON
last-swing (b1c978e is its ancestor), so on any other sha it STOPS -- hygiene would carry last-swing back in and needs
a rebuild. sha `adc7658` = branch `hygiene-on-8ed9450` (inventory-hygiene + a merge of 8ed9450; identical content to
the reviewed branch; differs from 8ed9450 by hygiene's 5 files; 206/206). Registration `~/mcai-analysis/hygiene-01.8ed9450.json`.
The registration's MANUAL step is automated: before launch `~/hygiene-pool-check.py --apply` (repo scripts/host)
excludes pools with < 2 bots at >= 34 estimated slots (tagged `hygiene-slot-pressure`, 12 h). Dry run 15:5xZ: board-b,
hive-c, hive-d would be excluded (the fresh worlds); the other 13 qualify.

## AFTER HYGIENE — fixes-01 (chain STOPPED 15:56Z; relaunch `~/chain-fixes.sh` after hygiene-01 ends, with its
## `fixes-01.8ed9450.json` sha re-based onto whatever hygiene leaves on the fleet)

`~/chain-fixes.sh` (repo `scripts/host/chain-fixes.sh`, log `~/chain-fixes.out`) waits for lastswing-01 to end
(`promoted` | `torn-down`), waits for the loop lock, then picks the registration for the fleet sha and launches
`canary-loop.sh fixes-01`. It STOPS (never guesses) on an abnormal end, a declared canary, an unexpected sha, an
existing `fixes-01` registration, or a missing `/tmp` read.

| fleet after lastswing-01 | registration | sha | contents |
|---|---|---|---|
| `1d107ed` (torn down) | `~/mcai-analysis/fixes-01.1d107ed.json` | `ecf33b6` (branch fixes-bundle) | digsync + stale-stop + craft-advice + hive-progress |
| `8ed9450` (promoted) | `~/mcai-analysis/fixes-01.8ed9450.json` | `25a8397` (branch fixes-bundle-on-8ed9450) | the above + last-swing + prereq-usable; npm test 210/210 on 09-30 |

Reads (all in `/tmp` on 10.0.0.31): digsyncread, stalestopread, craftadviceread, hiveprogressread,
[prequsableread — 8ed9450 variant only], fixesbundleread, immobiledid. `fixesbundleread` now adds prequsableread
to its exposure MEMBERS when the registration lists it (dry run: 3 members without, 4 with; backup
`/tmp/fixesbundleread.py.bak-20260930T*`). Draw exposure: `_reflex_stuck` >= 2, `_pickup_skipped` >= 30,
[+ `_prereq_adopted` >= 10]. A REVERT names its member (lines are tagged); drop that member and rerun the rest.
Registrations docs: `docs/reports/fixes-01.{1d107ed,8ed9450}.json`; base `fixes-01-registration.json`.

## FLEET
| | |
|---|---|
| baseline | `1d107ed+52f617` (deathfix-02 KEEP + promoted 08:43Z 09-30), 70 bots |
| canary | `8ed9450+addedf`, 10 bots (above) |
| `main` | `a1c922c` (fixes-01 staging) = fleet 1d107ed + docs/scripts |
| fresh worlds | hive-c, board-b, hive-d, placebo-d — draw exclusions expired 09-30 12:59–14:05Z |
| analyst 11:00Z | fleet healthy, one version; 6 deaths/24h window (0.037/bot-h, drowning at hive-c/d, isolated-c); 9 immobile, 8 zero-item bots |
| stuckwatch 13:00Z | placebo-b-Comet and -Echo pinned at (287,49,-388), path_no_legal_move x600+ — operations alarm, not a mechanism |
| iron funnel (24 h) | raw iron 14, ingots 21, iron pickaxes crafted 2, gone 13 — iron is the wall after stone |

## LOOP STATE
- `check-open-loop.py` 11:10Z: "no open canary". It will name lastswing-01 as open until the loop records a decision.
- **While lastswing-01 is unread, no new analysis starts** (CLAUDE.md). Build/stage work for later slots is fine.

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file; on 10.0.0.31: `grep -E 'lastswing-01|fixes-01' ~/canary-journal.jsonl | tail`,
   `cat ~/chain-fixes.out`, `cat /srv/mcbots/trial-manifest.json`, `tail ~/digest/page.jsonl`.
2. Confirm `canary-loop.sh` and/or `chain-fixes.sh` are alive (`pgrep -af 'canary-loop|chain-fixes'`).
3. If lastswing-01 was decided: KEEP → confirm 80/80 on `8ed9450`, fast-forward `main` to it (keep
   `main-pre-<date>`), PushNotification the owner. REVERT/INCONCLUSIVE → confirm teardown (exactly ONE version
   live), write it up, PushNotification on REVERT. Either way check `~/chain-fixes.out` says `launched` and the
   fixes-01 loop is in the draw or deployed.
4. Live versions: `cd /opt/minecraft-ai/scripts && python3 -c "from lib.telemetry import Events; print(Events.load(since_minutes=8).versions())"`
   (positive control: rows and bots > 0).
5. Monitors: prefer ONE background `until` wait on a journal phase over re-armed 30-min Monitors.

## OWNER CALLS WAITING (unchanged from 09-27)
1. ~~24–27 Sep program window~~ DECIDED 09-28: abandoned; fleet-wide promotion allowed.
2. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
3. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect.
4. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
5. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## QUEUE (owner-approved order, 09-29 evening: "run last-swing next, and bundle the small fixes")
1. **lastswing-01** — LIVE (above).
2. **hygiene-01** — auto-chained (above; owner 09-30 moved it before the bundle).
2b. **fixes-01** — after hygiene (its chain is stopped; relaunch then).
3. Then, each its own canary, all merged onto 1d107ed and green 09-30 ~09:30Z (rebase onto the fleet sha at launch
   if lastswing-01 is promoted): **hygiene-01** (inventory-hygiene 43dffe8, needs a MANUAL pool check: >= 2 bots at
   >= 34 slots), **oretunnel-01** (ore-tunnel 7ab4f23, needs digsync on the fleet first; draw >= 10 iron gather
   rows), **idlegap-01** (idle-gap c7d0d99), **bankfix-01** (bank-fix 15dec57 = chest-ledger + tool-keeper-2 +
   withdraw-home + tiers; gate reads ledger/RCON, never `_deposit_window`), **exploretoward-01** (explore-toward
   86e8985), **vetoretry-01** (veto-retry 1efd82c; d0c47c6 follows it). Registrations staged in docs/reports.
4. PARKED: `tool-guard` b1d6b62 (Codex rejects the composition; population zero today) — revisit after
   lastswing-01 shows how many bots reach zero pickaxes.
5. Analysis backlog (only when no canary is unread): why `gather cobblestone` ends no_path at the surface (321 of
   3,309 succeed); escape burns logs as scaffold (1,009/day); planting cohort vs depletion curve; `gather` event
   with a coordinate; merge the two `place-town.py` copies (run the HOST copy); `PLANT_RESERVE` per species;
   `place` one learned_avoid key for all saplings; `container_open` 446/4,160 uncharacterised.
6. Colony path (owner-approved): chest ledger (in bank-fix) → shadow-mode mayor. Spec
   `docs/reports/jobs-mayor-spec-2026-09-29.md`.

## WORKTREES / BRANCHES touched 09-30
- `fixes-bundle-on-8ed9450` @ 25a8397 — on origin; local worktree in session scratchpad (disposable).
- `last-swing-on-1d107ed` @ 8ed9450 — the live canary; on origin.
- `mcai-rl02` worktree carries someone else's uncommitted `check-movement-writers.mjs`, `movement-ratchet.test.mjs`
  and 09-27 reports — still undecided, left alone.
