# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-02 11:40Z by the daily operator session (scheduled task). **FLEET `8453c09+5ad1cf` on 80/80 bots
(fixes-03 KEEP +360 11:15:35Z, promoted 11:25:16Z). `digsync2-01` (sha `254f208`) launched by the host chain 11:27:29Z
(`canary-loop.sh digsync2-01`, pid 1982258); at 11:28Z it was in preflight/draw.** `oretunnel-02` (553adf2) is chained
behind it._

> **TWO SESSIONS ON 10-02.** The owner-granted autonomous session (worktree `.claude/worktrees/heuristic-nightingale-49eee9`,
> grant 04:45Z → ~00:45Z 10-03, progress reports `docs/reports/progress-1002-*.md`) OWNS the queue, `main` and the
> merges today. The daily operator session yields to it: it read, verified and recorded, and did not merge or deploy.
> If the two copies of this file disagree, take the later `_updated` stamp. History: `git show b638373:docs/reports/STATE.md`
> (10-02 06:10Z), `git show d67d840:docs/reports/STATE.md` (10-01), `git show 6a18e70:docs/reports/STATE.md` (09-30).

---

## DECIDED SINCE 10-01 13:40Z (all by the host loop)
| run | sha | result |
|---|---|---|
| fixes-02 | f5609af | REVERT +180 (10-01 16:39Z) on v11 climbs +123%. REAL (null: >+100% in 0.1% of 858 draws); came with 5x more mine descents. digsync v1 the suspect (92/138 rollbacks were false restores). |
| fixes-03 | 8453c09 | = fixes-02 minus digsync, 20 bots (hive-c, board-a, placebo-d, placebo-b), declared 05:03:00Z. **KEEP +360** 11:15:35Z; deaths 3 (0.025/bh) vs control 8 (0.033/bh), ratio 0.75x, death gate held (v21, not a verdict). Exposure ready (fixesbundleread). +180 member reads: tool-safe good-pickaxe losses canary 0.417 → 0.017/bh vs control 0.378 → 0.472 (DiD -0.494); prereq-usable 0/51 spent-satisfied vs control 199/373; stale-stop 0/2528 instant PathStopped; craft-advice 0 deepslate advice vs control 122; hive-progress 20/20 bots restored. Promoted 11:25:16Z; verified 80/80 bots on 8453c09 at ~11:33Z (4,013 rows / 4 min; positive control). |

## LIVE — digsync2-01
| | |
|---|---|
| sha | `254f208` (branch digsync2-on-8453c09; digsync-v2: 3 s grace after an ack with no server word, restore only at expiry; 3 review rounds, both engines) |
| registration | `~/mcai-analysis/digsync2-01.254f208.json` = `docs/reports/digsync2-01.json` on main |
| reads | digsync2read, immobiledid; read_minutes 180, 360; deadline 1700 min |
| pools / declared_at | drawn by the loop — read them from `/srv/mcbots/trial-manifest.json`; reads land at declared_at +180 and +360 |
| climbs guard | v11 raw climbs (+100%) still in force; digsync2 makes descents, so watch it. Outcome-guard amendment recommended by both engines, NOT applied (prospective only) |

## NEXT — oretunnel-02 (AUTO-CHAINED)
`chain-next.sh digsync2-01 254f208 oretunnel-02` (pid 1940387, log `~/chain-oretunnel-02.out`) launches 553adf2 only if
digsync2-01 ends `promoted` at fleet 254f208. Any other ending STOPs the chain.

## LOOP STATE
- fixes-03: KEEP recorded and promoted — closed. **digsync2-01 is the open loop**; no new analysis until it is read.
- `main` has NOT yet merged 8453c09 (the 11:25Z PROMOTED page says "fast-forward main and keep main-pre-<date>"). Left
  to the autonomous session; if it has not happened by the next daily run, do it then (`git tag main-pre-20261002`,
  merge 8453c09, `npm test`, push).

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file AND `git show origin/main:docs/reports/STATE.md`; take the later stamp.
2. On 10.0.0.31: `grep -E '"digsync2-01"|"oretunnel-02"' ~/canary-journal.jsonl | tail`; `cat ~/chain-oretunnel-02.out
   /srv/mcbots/trial-manifest.json`; `tail ~/digest/page.jsonl`; `pgrep -af 'canary-loop|chain-'`.
3. Check whether another session is live (newest jsonl under `~/.claude/projects/*minecraft-ai*`); if so, yield on main/deploys.
4. Versions per bot (positive control: 80 bots): `Events.load(since_minutes=4)`; bot name is `r['bot']['name']`
   (`r['bot']` is a dict), build is `r['raw']['code']['version']`.
5. ONE background `until` wait on a journal phase; no re-armed 30-min Monitors.

## OWNER CALLS WAITING (unchanged from 09-27)
1. The v21 death-gate lower bound. 2. The audit (`8019b1d`): 7/23 reverts confirmed false (+fixes-01, restart-lag).
3. "OWNER DECISION" commits with no artefact (24–25 Sep). 4. `vetob2-01` (efabf13) KEPT, unpromoted.

## QUEUE
1. digsync2-01 — LIVE. 2. oretunnel-02 — chained. 3. Then, each its own canary rebased on the fleet sha: bankfix-01
(15dec57), exploretoward-01 (86e8985), vetoretry-01 (1efd82c; d0c47c6 follows); copy the known-other-build skip into
every new read. 4. Climbs-guard amendment (outcome guards, null-calibrated with restarts) — both reviews, prospective.
5. COMPOSTER (designed, not built). 6. PARKED tool-guard b1d6b62. 7. Analysis backlog per `git show 6a18e70:docs/reports/STATE.md`.

## WORKTREES
- `.claude/worktrees/{fx3,digsync2,ore2,heuristic-nightingale-49eee9}` — the autonomous session's.
- `mcai-rl02` carries someone else's uncommitted `check-movement-writers.mjs`, `movement-ratchet.test.mjs`, 09-27 reports — left alone.
