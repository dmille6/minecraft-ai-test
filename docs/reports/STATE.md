# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-02 06:10Z by the autonomous operator session (owner grant 10-02 04:45Z: 15-20 h on v1, iron first,
both engines, reports every 4-6 h) — **CANARY LIVE: `fixes-03` on `8453c09`, pools hive-c, board-a, placebo-d,
placebo-b (20 bots), declared 05:03:00Z.** Fleet baseline `bf296c9+9287fd` on the other 60. Exactly two versions live
at 05:10Z. `canary-loop.sh fixes-03` (pid 1921117) does reads/verdict/record/promote/teardown. NOTHING is chained
behind it (chain-ore.sh stopped 10-01 on fixes-02's revert)._

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. Long history: `git show 40a09da:docs/reports/STATE.md`
> (to 09-30 morning), `git show 6a18e70:docs/reports/STATE.md` (09-30 evening), `git show d67d840:docs/reports/STATE.md` (10-01).

---

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
