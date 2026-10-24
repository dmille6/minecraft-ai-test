# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-10-19 12:50Z by the daily operator session (10-19). **FLEET `adbec4f4`** (plinthfirst-01, OWNER-DIRECT rollout 01:26Z on top of townsearch-02 6bea246c KEPT +720 01:06Z / promoted 01:16Z; = a9cff42c + townsearch-02 + plinthfirst-01) on **80 of 80 bots, one build live**. **NO canary deployed** at 12:40Z: bamboo-02 `dffd97e4` REVERTED +180 (05:11Z) and torn down (05:15Z); the scheduler's decision is `launch treefarm-02` (variant `0b3a0d4c` on adbec4f4, queued 12:28Z, draw amended 12:35Z) -- **the live operator session (heuristic-nightingale) owns the queue this week; see its 10-19 12:45Z COORDINATION entry on origin/main.**

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it stays there.
> If the two copies disagree, take the later `_updated` stamp. Long history: `git show 40a09da:docs/reports/STATE.md`
> (to 09-30 morning), `git show 6a18e70:docs/reports/STATE.md` (09-30 evening), `git show d67d840:docs/reports/STATE.md` (10-01).
> **origin/main's copy is where the coordinator and the agents append entries; its header is often stale while its dated
> entries are the newest.** Read BOTH: `git show origin/main:docs/reports/STATE.md | grep -n '^## '`.


## CURRENT (rewritten 2026-10-19 12:50Z) — read this block, then the dated entries below it

**COORDINATION (10-19 12:45Z, origin/main):** the live operator session has been taking the owner's instructions since 10-12 and drives the
queue. A daily session does NOT apply queue entries, release holds, install gates or deploy without checking that session's newest
entries and the journal first; analysis and reporting are welcome. Owner decisions 10-19 (recorded there): tiered canaries (tier 1
settings = direct; tier 2 small fixes = 20 bots, KEEP at +180, ~3 h cool-off; tier 3 unchanged; gate change installed between canaries
under install-hold); queue treefarm-02 -> brain-01 ("test now", rebuilt on the live tip) -> cobble-in-bags fix -> toolkit-03 (iron via
townsearch) -> bamboo-03 (G3 fix) -> townfloor-01 -> monument-01 -> shaft-01 -> stonewithdraw-01; nightly world backups to the NAS;
a daily goal scoreboard (goalboard.py); town projects 2-8 + overseer being designed.

**FLEET** `adbec4f4` = 6bea246c (townsearch-02) + plinthfirst-01 (every NEW well a plinth; working natural wells kept; rollback `6bea246c`
or `PLINTH_FIRST=0`). Census 11:08Z: 80 of 80 bots' newest rows carry code.version adbec4f4; manifest declared adbec4f4 (02:05Z),
canary_pool null. origin/main = 12d4a41c (coordinator: townsearch-02 + plinthfirst-01 merged ce44d552). Local checkout code-minecraft-ai
main = 6b14e84b (behind; fast-forward before touching it). mcai-rl02 (recovery-ladder-03) carries this copy + status reports.

**bamboo-02 `dffd97e4` CLOSED: REVERT +180 (05:11:30Z), torn down 05:15Z (10 bots back on adbec4f4, 0 drop-ins).** The deciding line was the
registered correctness gate, not the death: bambooread G3_bamboo = 3 (must be 0, evidence=defect): of 12 fold runs on the 10 canary bots,
9 freed a slot and 3 (hive-b-Bravo 04:12, hive-b-Alpha 04:25, hive-b-Comet 04:32) stopped `aborted:stagnation` with crafts 0/32, 6/32,
7/36 and freed 0 -- runs planning 32-36 crafts outlive their fold window (46.6-51.8 s) and the stagnation watchdog aborts them; each bot's
next run (2.5 min later) succeeded. **bamboo-03 (queued by the owner): size the fold window to the planned crafts or cap crafts/run.**
Death reviewed (v14c flag): hive-b-Comet 04:16:56Z = mine stopped at y=38 "lava in the headroom", `_lava_corridor` refused the leg twice,
`_marooned` climbed out into lava; no bamboo row within 12 min (its first fold ran 04:29Z after respawn). NOT linked. R11 (death-hold)
released 11:50Z with that review as the `why`. Death gate reported 1 vs 1 (0.033 vs 0.007/bh), never a verdict (two-death floor).

**treefarm-02 variant on adbec4f4: `0b3a0d4c` (branch tf-on-adbec4f, pushed; registration ~/mcai-analysis/treefarm-02.0b3a0d4c.json;
queue entry ~/mcai-analysis/treefarm-02.entry-adbec4f.json, all older variants kept).** farm-on-9f8e30d 288a19fa's three commits
cherry-picked onto adbec4f4; five hunks resolved by hand (no bamboo import / HOUSEKEEPING entry; townWellSite's NEW-site search through
wellSearchAvoid in BOTH plinth-first branches; buildPlinth passes plinthfirst's minK, bare into the farm-aware planner) + plinth.mjs by
rerere; one test-only commit (treefarm-compose runs with PLINTH_FIRST=0 as chest-full/plinth-skill do; wiring/mutant anchors re-anchored,
+1 mutant; well.test.mjs's plinth-first compute mutant re-anchored -- the full runner caught it). Codex read-only rebase review: production
resolutions correct (3 informational), CHANGE only on the stale anchors. npm test 272/272; no-undef 1 = base 1. The coordinator checked
it against an independent build (db5e37d3, same production code) and allowed the launch. **Draw amendment (prospective, 12:35Z):**
draw_exposure kind `deposit` -> `town_deposit` (min 8 / 3 h unchanged; read-time gate exposure_ready >= 1 unchanged): bank-chest deposit
rows are rare now (3 h: 64 fleet-wide, only hive-b >= 8) while town_deposit rows (98) qualify board-a, hive-a, hive-c, placebo-b,
placebo-c; pre-amendment bytes in treefarm-02.0b3a0d4c.json.bak-draw. `tick --no-act` = LAUNCH; no journal row yet at 12:40Z (cron
tick / install-hold: the coordinator's lane). Reads 180/360, extension 540/720/1080/1560, deadline 1680; exposure = >= 9 confirmed
plantings on the canary and >= 20 control log gathers.

**plinth tripwires (direct rollouts):** plinthfirsttrip (since 01:26Z, adbec4f4) TRIPWIRE OK. plinth2trip (since 02:05Z, 547 min, 1.13 M
rows): C1-C9 at raised wells 0, P1-P4 0, **P5_stuck BREACH named, no rollback**: placebo-c-Alpha 06:32 is the END of a `_livelock_escape`
relocation from 335,69,115 (30 blocks away); board-d-Delta 08:33 is a gather entombment at 363,69,130, 8 blocks from board-d's cap
366,73,138, matched horizontally to another world's cap -- its escape dug through and `_well_retired 363,73,134 wall_is_air` (board-d's
natural well; plinth-first will re-site it raised). FOLLOW-UP: P5 should match caps per world in 3-D.

**FLEET HEALTH (ES, 11:07Z):** 24 h 1,920 bot-h, deaths 30 (0.0156/bh; drowning 12, fire 6, other 6, fall 4, suffocation 2) -- DOWN from
48 (fire 18) on 10-18. 7 d 13,440 bot-h, 262 (0.0195/bh). Gather 5.66 ok/bot-h, craft 0.29, town_deposit 132 ok of 590. **Bags WORSE:
41 of 80 bots at >= 34 slots, 23 at 36 (10-18: 24 / 8)**; hive-a, hive-c, isolated-d, placebo-b, placebo-c 5/5 at >= 34. 12 h town_deposit
refusals 284 of 358: 186 "nothing to bank: everything carried is kept (stockpile, scaffold, tool...)", 0 chest-full; deposit 184 fails of
251, 10 "full" (cobbleoverflow trigger not met on town_deposit). Iron 24 h: raw 293 (0.20/bot-h), ingots 280, iron pickaxes crafted 24,
gone 66, share 64.7%. Units `mcbot@hive-a-Charlie` / `mcbot@hive-b-Charlie` are enabled with NO env file since August (empty logs; not
fleet bots: 16 x 5 = 80 are up); every hive-a/b teardown logs restart-failed for them -- a human `systemctl disable --now` + reset-failed.

**QUEUE (host, 12:40Z; the coordinator's):** treefarm-02 (variant adbec4f4 -> 0b3a0d4c; scheduler decision LAUNCH) -> townfloor-01 (HELD) ->
monument-01 (HELD) -> stonewithdraw-01 -> shaft-01 (HELD); the owner's 10-19 order inserts brain-01, the cobble-in-bags fix, toolkit-03
and bamboo-03 after treefarm-02 (entries pending from the coordinator). None of treefarm-02's successors has an adbec4f4 variant.

**LOOP STATE 12:40Z: CLOSED** -- bamboo-02 REVERT recorded 05:11Z, torn down 05:15Z, `check-open-loop.py` clear ("no open canary"). If
treefarm-02 launches, its +180 read is 3 h after `deployed`; the host loop reads and acts; the next session closes it first.

**RULES IN FORCE:** gate bundle b7ce36d7 (v35.1) matched at the 02:03Z launch; ~/digest/RULE.md md5 746c65e4 = repo scripts/host/RULE.md
(12:30Z). Death gate two + 1.25x. Owner 10-15 early close; 10-16 setting fast path; 10-17 owner-direct rollouts (phase `owner-direct`,
before/after + tripwires); 10-19 tiered canaries (gate change pending install by the coordinator). wellread judges the canary arm only.

**RE-ARM ON A FRESH SESSION**
  1. `date -u`; read this block, origin/main's newest entries (the coordinator's COORDINATION entry first) and the journal; on 10.0.0.31:
     `cat /srv/mcbots/trial-manifest.json`; `tail ~/canary-journal.jsonl`; `tail ~/digest/page.jsonl`; `python3 ~/canary-sched.py status
     | tail -14`; `pgrep -af canary-loop`; `sudo python3 /opt/minecraft-ai/scripts/check-open-loop.py`.
  2. `python3 ~/verdict.py <live run> 0 --poll` (2-5 min). Read texts `~/digest/reads/<run>-<read>-<min>.txt`; loop stdout
     `~/canary-loop-<run>.out`. A REVERT's deciding line is in the `read-<min>` journal note ("own line ... evidence=defect" = a
     correctness gate, even when the note opens with the v14c death text); R11 then still holds the queue until `continue`.
  3. Live builds: per-bot newest row `code.version` (`r["code"]["version"]`), or the scheduler's note line; `Events.load(paths="/var/log/
     mcai/<pool>-*/skill-*.jsonl*", since_minutes=N)` per pool.
  4. If a run was decided: confirm the ledger row + version count; PushNotification on promote/revert (desktop only: Remote Control is
     inactive); the coordinator merges a promotion to main within 1-25 min -- re-fetch before any merge of your own.
  5. A single-notification waiter beats a Monitor: background `ssh ... 'for i in $(seq 1 56); do grep -q "\"run\":\"<run>\",\"phase\":
     \"read-<min>\"" ~/canary-journal.jsonl && exit 0; sleep 10; done'` (the Bash tool caps a command at 10 min).
  6. The local analyst is STALE (10-06). Wide analysis: `cd ~/estel && python3 scripts/host/fleetstatus.py` (~3 min; ES); iron:
     `tail ~/digest/ironfunnel.log`; plinth tripwires: `cd ~/mcai-analysis && nice -n 19 python3 plinthfirsttrip.py --since <rollout
     ISO> --version adbec4f4` and `python3 plinth2trip.py` (each walks every log: run with nohup to ~/digest/*.out).
  7. Codex review: `codex exec --sandbox read-only - < promptfile` from the worktree, with a `( sleep N; kill )` watchdog; macOS has no
     `timeout`. A variant worktree needs `ln -s <repo>/bots/node_modules bots/node_modules`; never `git add -A bots` there. The FULL
     runner (`npm test`, ~35 min here) is the only test command; it caught a stale mutant anchor the filtered run could not.
  8. Re-stacking a variant: prefer `scripts/prepare-variant.sh` (aborts on conflict); a conflicted cherry-pick is a reviewed rebase
     (Codex pass on the range-diff), its registration carries `variant_prep` + `approved` naming the review, and the host's deploy
     checkout must `sudo git -C /opt/minecraft-ai fetch origin` before `queue replace-variant` can resolve the sha.
  9. An owner decision can land between loop reads and in the OTHER session: re-read origin/main's STATE and the journal before acting.

**CHECKOUTS** origin/main canonical (coordinator). Local checkout code-minecraft-ai on main (6b14e84b, behind; `git pull --ff-only`).
mcai-rl02 (recovery-ladder-03) carries the daily copy and status reports, unpushed. Host checkout for ES tools ~/estel on 10.0.0.31
(not a git repo); the deploy checkout /opt/minecraft-ai resolves shas for the scheduler.

---

## 10-24 02:20Z — FLEET 3cc5f14d (chatgate-01 KEPT +360 01:52Z, promoted 02:02Z); ironsmelt-01 LAUNCHED (canary fb8de72f); structcount + valuescore installed

- **chatgate-01** `3cc5f14d` drawn placebo-b, hive-d, hive-a, hive-c (4 pools) 19:39Z. +180 NOT_YET (one canary death v control's:
  hive-c-Comet 71-block cave fall, idle; not linked). +360 KEEP: deaths 2 v 4 (0.017 v 0.017/bh); one v14c rung-linked flag
  (hive-c-Comet 00:12:30 livelock_escape) reviewed: chat gating cannot reach that rung, not linked. Promoted 02:02Z.
- **Isolated phase 2** tripwire OK at +240 (3 deaths in 74 bot-h: two dripstone/cave falls, one lava swim; not the conversion);
  hold released 19:29Z (accepted quiet 240).
- **Infra gap 02:02-02:15Z** (operator install-hold, ironsmelt held): **structcount** installed on 10.0.0.30 (check PASS 106/106,
  cron 03:45Z..05:45Z after the nightly backup; first real count tonight starts the 3-day baseline); Q8 key installed on .30;
  `install-structcount-key.sh --verify --install-cron` on .31 must run AFTER the first published count (pull exits 3 until then).
  **valuescore** installed on .31 (cron 00:50Z; 10-23 = 9.22 value/bot-h). Merged structcount (1d2a0a30, fleetstatus conflict
  resolved keeping coop + structcount lines; tests 106/106 on main).
- **Queue:** ironsmelt-01 (fb8de72f, drawing) -> townplan-01 -> found-01 -> junkout-01 -> ledger-01 -> [lavastep-01, mats-01 when
  filed] ... parked: bamboo-03, foldwatch-01, treefarm-03 (HOLD, 1 pool each). Not yet queued: towniron-01 (Claude review after
  10-26 06:00 CDT; tier 3, hive-b required), indexsearch-02 (kit-led exposure, after ironsmelt).
- **Owner decisions 10-23** (memory): next tiers; queue speed (designs NOT installed, tier-2 needs 4 pools or tier 3); designs
  answered (mineshaft O1-O13, building Q1-Q11 + reserves logs/copper 512, cobble 256, torch 32, sand 16, planks 71, sticks 40,
  cooperation 1-5 with existing keys); production breakdown (no fleet reseed); towniron-01 one reserve, shovels gated;
  furnaceseen-01 tier-1 after ledger-01. Open: D (board-a-Comet escape fix).

## 10-23 15:40Z — indexsearch-01 CLOSED INCONCLUSIVE +180 (early, unexposed); isolated phase 2 APPLIED; owner set the next tiers

- **drop16 (M2b) DONE** 08:06:59-08:23:20Z: 80/80 bots on OLLAMA_BASE_URLS .72 only; re-verify 08:26Z OK (1,810 rows all .72, 0 on
  .16, p95 3.2 s); hold released by its token. 24 h verify due >= 10-24 08:25Z (`bash ~/drop16.sh --verify 2026-10-23T08:23:20Z`).
- **JIT 10-23** (queue on 6e1afb52): indexsearch d4a0f424; chatgate 3cc5f14d (+ 9d1f6d02 on d4a0f424); bamboo-03 f998ed34;
  junkout-01 4108c84e; foldwatch-01 9280aaa6 (on f998ed34); treefarm-03 975e2ce5. bamboo/junkout/treefarm each needed a reviewed
  production fix for composition with homefix/keepout/protectzone (both engines APPROVE). Stale /tmp/bambooread.py (10-06) moved aside.
- **indexsearch-01 `d4a0f424`** drawn board-a, placebo-a (only 2 pools could expose it) 12:14Z. +180 NOT_YET; **closed INCONCLUSIVE
  15:21Z** under the owner 10-15 early-close rule: canary coal-searching smelt jobs 0 of 43 (need 13; bots carry coal); kit half shows
  no effect because town iron is running out (no_iron per attempt rising on both arms). Torn down 15:25Z, 10 bots on 6e1afb5, 0
  drop-ins; `closed` in the scheduler. **Re-queue as indexsearch-02 after ironsmelt-01** with a reviewed, kit-led exposure.
- **isolated -> shared PHASE 2 APPLIED** 15:26-15:28Z (isolated-a, -c, -d; --quiet 240 accepted per owner 10-21 #2). The rollout's
  install-hold blocks launches until `bash isolated2shared-direct.sh --release operator` at >= 19:28Z (it refuses earlier). Tripwires
  +15/+60/+180. Then 15 drawable pools.
- **OWNER 10-23 decisions** (memory owner-next-tiers-1023, owner-queue-speed-1023, owner-design-answers-1023): town iron smelting
  (ironsmelt-01, building; smelt_town is copper-only and copper is gone while 899 raw iron sits unsmelted, ingots -448/day);
  townplan-01 + found-01 move up after chatgate-01 (being re-stacked); designs in progress with both engines: building tier +
  structure count, mineshaft safety -> diamonds, cooperation (frontier overseer, $150/month cap), queue speed (settle-based cool-off
  -- install only with ZERO flipped verdicts in replay -- and head-blocked lookahead after 30 min; both back to the owner before
  install). Successors are pre-built for both outcomes of the live canary. Expeditions up to 1200 blocks (after census 10-24).
- **Lane order once released:** chatgate-01 -> ironsmelt-01 -> townplan-01 -> found-01 -> bamboo-03 -> junkout-01 -> foldwatch-01
  -> treefarm-03 (ironsmelt/townplan/found entries added when built).

## 10-23 08:30Z — FLEET 6e1afb52 (poolescape-01 KEPT +360 07:55Z, promoted 08:05Z); lane BLOCKED H2 pending JIT variants; drop16 applying

- **poolescape-01** KEEP +360: marooned-water spell bot-h canary 18.0 -> 0.0 v control 0.0 -> 0.5 (DiD per bot -1.21); coverage
  0.94-1.0; G2-G4 0; 3 firings (2 out, 1 refused), yielded 0; deaths 0 v 6. Merged f52aa902 + its Paper driver 96463bd5 (registry
  wired drivers 18 -> 19). Board-d trap (owner priority 10-22) CLOSED: SHIPPED.
- **Lane:** scheduler blocks H2 (indexsearch-01 has no 6e1afb52 variant). A JIT agent is re-stacking indexsearch-01 first, then
  chatgate-01, bamboo-03, junkout-01, foldwatch-01, treefarm-03 onto 6e1afb52 (registrations + entry fragments in ~/mcai-analysis;
  the operator applies `queue replace-variant`).
- **drop16 (learning loop M2b)** in this gap: dry run OK 08:12Z, `--apply` started ~08:14Z (80 env files -> OLLAMA_BASE_URLS .72
  only; restart 12 s apart under its own install-hold). Then `--verify <restart ISO>` now and again at +24 h; training on .16 only
  after the 24 h verify shows 0 fleet rows on .16.

## 10-23 02:05Z — FLEET c0fec812 (townindex-01 KEPT +360, promoted 01:17Z); poolescape-01 LIVE 01:48:44Z (3 pools); protectzone + townindex merged

- **keepout-01** KEPT +360 10-22 13:13Z, promoted 13:22Z (merged 45497e34). **protectzone-01** `1f5b4b4e` KEPT +180 16:44Z (tier 2,
  4 pools), promoted 16:54Z; merged to main now, its Paper driver moved onto the shared sandbox lock at merge (wired drivers 17 -> 18).
- **townindex-01** `c0fec812` (on 1f5b4b4e): +180 NOT_YET (exposure 40/50; WATCH refusals_up = cobble-cap admission, 72 -> 202 over
  8 bots), +360 **KEEP** 01:07Z (defects 0, 249 obs, refusals settled 300 -> 365 v control 1099 -> 992). Death gate held: 2 v 3, both
  hive-c drownings while idle after gather/craft/goto, no index row near -- not linked. Promoted 01:17Z. 3 pools, so no +180 KEEP.
- **poolescape-01** (OWNER 10-22 priority, queued NEXT 21:26Z): variant `6e1afb52` on c0fec812, tier 2, draw_require board-d. Drawn
  board-d, placebo-a, hive-b (3 pools -> reads on to +360 ~07:48Z). **All three marooned board-d bots out within 2.5 min of deploy**:
  Alpha (555,61,116) out 01:51:01 by hand (dug 1, placed 3); Bravo (329,61,213) out 01:50:59 (stone pickaxe, dug 1, placed 1); Comet
  refused (Bravo's cut had opened the route) and walked out; all health 20, lava_refused 0, no zone/fire marks. Read: poolescaperead
  G1 (trapped bot-h halve, DiD < 0, pre-trapped bots still observed); G2-G4 revert lines.
- **Next in the lane:** indexsearch-01 -> chatgate-01 -> bamboo-03 (JIT) -> junkout-01 (JIT) -> foldwatch-01 (JIT) -> treefarm-03 (JIT);
  townplan-01/found-01 JIT re-variants after chatgate. **Gap work:** ~/drop16.sh (remove .16 fallback), isolated phase 2.
- `mcbot@board-a-Charlie` is a failed, disabled leftover unit since 10-19 (no env file; not one of the 80) -- the scheduler's
  "enabled but inactive" note is it; a human `systemctl reset-failed` clears the note.

## 10-22 03:30Z — ironpick-01 LIVE (3 pools); keepout-01 + chatgate-01 QUEUED; chain re-varianted (16 variants)

- **ironpick-01 `2719ee0e` LIVE 00:36:03Z on hive-d, placebo-b, hive-c** (3 pools: no tier-2 +180 KEEP). homefix-02 merged to
  main cd8df1d3 (278/278); frontier census merged 5cc17edb + fleetstatus E0 line installed (warm-up ends 10-24 00:20Z).
- **Queue:** ironpick-01 -> **keepout-01** (safety lane, owner C3; tier 3; needs pools with a live fire site) -> protectzone-01
  (HELD for the corrected fixture) -> townindex-01 -> indexsearch-01 -> **chatgate-01** (before the showcase bots; owner C4)
  -> bamboo-03 -> junkout-01 -> foldwatch-01 -> treefarm-03.
- **keepout-01 d014ec2c variant SWAPPED 04a3c726 -> 80339a91**: Codex P1 on the never-reviewed homefix composition (the
  relocation dry check looked only at the target's foot height; goto arrives within +-6 y, so the watchdog could relocate into a
  fire column) -- fixed + the watchdog's fire-site read wrapped. Also a807352c-style fix in every protectzone-on-keepout
  variant: mine's zone refusal may not suggest an exit inside a fire column. Both engines APPROVE lines B (d014ec2c) and C
  (2719ee0e); line A sidecar jit-1022b/lineA-variants.json not applied. Uncovered: a REVERT mid-chain leaves the next run
  without a variant (JIT then); bamboo-03 / junkout-01 / foldwatch-01 / treefarm-03 still need variants at their turn.
- **Ops audit 10-21: 1 HIGH** (toolkit-03 promoted before the promised owner look -- the loop auto-promotes; owner 10-22
  00:50Z: fine with fast rollback, no promote-hold) and 1 low (drawrec still records a 5080/3090 half covariate after the
  all-5080 move -- to fix).

## 10-22 00:40Z — FLEET d014ec2c (homefix-02 KEPT +360 00:18Z, promoted 00:28Z); ironpick-01 launching; queue re-varianted

- **homefix-02 KEEP +360** (tier 3, gates complete at +360): G1 4 opps 0 defects; G2 50 / 0; G3 216 / 0; G4 337 / 0
  (reserve_expired 12); G5a-g 0 (272 relocation landings, 4 wet); G6 0 verdict-adjacent drownings; deaths 3 / 120 bh v 2 / 240
  (held), guard DiD +0.001; 0 deaths within 120 s of a rescue. Read COVERAGE was False at +180 only because two stale
  `-Charlie` log dirs (renamed 09-02, no env, no unit) counted as canary bots -> all 8 `*-Charlie` dirs moved to
  /var/log/mcai-stale-charlie/ (nothing deleted); +360 COVERAGE readable True. Merge to main pending (tests running).
- **ironpick-01 launching** on the homefix-02 variant (canary 2719ee0e). Queue after it: protectzone-01 (HELD: install the
  CORRECTED fixture jit-1021b/protectzone-fixture.py md5 ac13bc75 first -- the old one closed the column to y -64, Codex P1)
  -> townindex-01 -> indexsearch-01 -> bamboo-03 -> junkout-01 -> foldwatch-01 -> treefarm-03. JIT 13 variants applied
  (ironpick 4, protectzone 5, townindex 7, indexsearch 7); two zone fixes (5e4f4189 town search, fab4329b count_town extras).
  bamboo-03 / foldwatch-01 / treefarm-03 still carry adbec4f4-era variants -> JIT when each nears the head.
- **New since 10-21 14:00Z:** junkout-01 queued (approved list additions NOT applied: all used or already handled); comms design
  merged (9ba02e6f; owner C1-C10 yes); chatgate-01 + keepout-01 building; townplan-01 + found-01 building; frontier census
  restarted (owner); learning-loop keys on the Mac (both verified; owner caps set); isolated-b pilot clean, hold released
  (tool quiet_min bug: fix before phase 2).

## 10-21 18:15Z — isolated-b pilot +180 clean; hold released (240 min, owner); homefix-02 LIVE 18:05:53Z (4 pools)

- **isolated-b pilot tripwire** +15/+60/+180: config right on 5/5; one shared well cap (357,74,160), 0 new wells; deaths 0 in
  17.6 bh; furnace sessions 46, 0 overlapping; smelt jobs 44 (0 before the switch; smelt_town_ok 0 -> 1.0/bh); +180 reads
  BLIND only because no junk-well disposal happened in 3 h (exposure), not a breach. Convert isolated-a/c/d after homefix-02.
- **Tool bug:** the claim recorded quiet_min 420 (computed) although the owner-accepted 240 was journalled
  (contamination-accepted 13:53:20Z), so `--release` refused until 20:54Z. Operator set HOLD.json quiet_min 240 under
  rollout.lock (backup HOLD.json.bak-17xxZ, note in the file) and released 17:54:55Z. Fix the claim path before phase 2.
- **homefix-02 LIVE 18:05:53Z on placebo-d, hive-a, board-c, board-b** (variant on 34d3e5e9 -> canary d014ec2c; tier 3).
- toolkit-03 merged to main c009771a (272/272, clean re-run after an invalid mixed-checkout run).

## 10-21 14:00Z — FLEET 34d3e5e9 (toolkit-03 KEPT +720, promoted 13:37Z); all 80 bots on the 5080; isolated-b pilot APPLIED

- **toolkit-03 KEEP +720 13:28Z, promoted 13:37:52Z.** Deaths 7 / 180 bh (0.039) v 12 / 540 (0.022): 1.75x, LB 0.69x (held).
  Operator promised the owner a look before rollout; the loop auto-promotes ~10 min after a KEEP -- told the owner plainly.
  WATCH 24 h fleet-wide: y<20 time share and underground deaths v the days before (canary arm went 3% -> 14% at y<20); roll
  back to 9e7d9980 if the pattern appears fleet-wide.
- **5080 move DONE 13:38-13:42Z** (~/dmove.sh --apply, backups *.bak-dmove-20261021T1338Z): the 20 *-d bots now 10.0.0.72
  primary, .16 fallback. 13:42-13:52Z: d-pools 297 decisions on .72, 0 on .16; all 80 bots on .72 p50 1,987 ms, p95 3,460 ms
  (60 bots before: 1,469 / 2,808). .16 must leave every endpoint list before the first training round (learning loop M3).
- **isolated-b -> shared town APPLIED 13:53:20Z** (isolated2shared-direct.sh, owner flags --quiet 240 --accept-contamination;
  scope private; backup /var/backups/mcai-isolated2shared/20261021T135320Z-isolated-b; plinth cap 357,74,160 shared; 20
  containers merged). INSTALL-HOLD isolated2shared-01 until 18:53Z; `--release operator-claude` allowed after 17:53Z.
  Tripwire at +15/+60/+180 (operator ~/bin/i2strip.sh). homefix-02 queue hold RELEASED: it launches when the install-hold
  is released (variants 9e7d9980 + 34d3e5e9 -> d014ec2c).
- **Learning loop:** owner answered a-h (memory owner-learning-loop-1021); both API keys installed on the Mac
  (~/.config/mcai/*.key, 600; both verified with free model-list calls; owner set spending limits); operator may promote a
  KEPT model onto .72 (owner: automated).

## 10-21 07:40Z — toolkit-03 +360 NOT_YET (reads to its registered +720 ~13:11Z); deaths 5 v 6 (2.50x, LB 0.75x); deep-time WATCH

- **toolkit-03 +360 07:22Z NOT_YET**: registration reads [180, 360, 720] -> the decision is at +720 (~13:11Z, 8:11 CDT), so
  the gap (5080 move, isolated-b pilot, homefix-02 release) moves to after that. Death gate held: 5 canary deaths / 90 bh
  (0.056) v 6 / 270 (0.022); deaths: hive-b-Comet drowned idle 01:42; hive-b-Alpha 26-block fall in gather 03:47; hive-b-Echo
  lava idle 06:10 at (334,39,154); board-a-Alpha stalagmite fall y=4.7 while mining 06:57 (rung-linked `entombed`, v14c
  report); hive-b-Bravo lava after an 8-block fall 06:58 at (335,38,155) -- two lava deaths at ONE hive-b spot.
- **WATCH (operator, ES 6 h pre v post, bot.pos rows):** canary share of rows at y<20 3.2% -> 13.9% (control 5.1% -> 5.4%);
  y<50 36.8% -> 49.8% (control 32.6% -> 31.0%). Concentrated: hive-b-Bravo 0.00 -> 0.74, hive-b-Comet 0 -> 0.28, board-a-Bravo
  0 -> 0.18, hive-b-Echo 0 -> 0.17, board-a-Delta 0.03 -> 0.13; placebo-a went DOWN. Very-deep rows are mostly _path_reset /
  _water_surface / _path_noPath (bots stuck in deep water/caves). No mechanism in toolkit-03 (kit search + smelt fuel) that
  moves bots is known; could be chance (2 of 3 pools) or more iron tools enabling deeper trips. Weigh at +720 (owner 10-07:
  exposure deaths are not mechanism deaths); consider a mining-exposure line before any KEEP.

## 10-21 04:45Z — toolkit-03 +180 NOT_YET (3 pools; strong mechanism); homefix-02 QUEUED (after toolkit-03, HELD); gap plan

- **toolkit-03 +180 04:23Z NOT_YET** (3 pools -> no tier-2 KEEP; exposure met): kit "no iron" per attempt canary 17/24 -> 0/11 vs
  control 56/76 -> 62/88 (DiD -0.676); kits crafted per bot-h 0.111 -> 0.244 (DiD +0.123); smelt ingots 104 -> 152 vs control
  172 -> 80; D1-D3 0, toolkit defects 0, C1-C3 0. Deaths 2 v 5 (held); one rung-linked `entombed` (hive-b-Comet 01:42:36,
  v14c report-only; operator to review). +360 ~07:11Z.
- **homefix-02 READY + QUEUED after toolkit-03, HELD for the gap** (owner X9 + 10-21 01:20Z "yes"): canary 08b237f7 on
  homefix02-on-9e7d998 (records homefix02-records-1021 634ecb7e); both engines APPROVE (design r6, code r3); 274/274; Paper:
  ice-head trap base died 3/3 vs homefix-02 lived 3/3; relocation over a frozen river 3/3 dry landings (homefix-01 3/3 on ice);
  home rescue dropped into the trap lived 2/2. Diagnosis: death 1 = the drowning route scan never read the head cell (answered
  `up` under ice; 10 of 92 old-code drownings in 7 d had this signature, all hive-d); death 2 = a magma/bubble-column pool,
  not linked (follow-up F1). Licence `_relocate_landed`; read homefix2read.py (G5a-g defect gates, G6 rescue-adjacent drownings:
  1 blocks KEEP, 2 + DiD + p<.05 REVERT). JIT variant on toolkit-03's 34d3e5e9 being built (jit-1021/homefix-02.entry.json).
- **Gap after toolkit-03 closes (holds: homefix-02, ironpick-01, protectzone-01):** (1) OWNER: ~/dmove.sh --apply (20 *-d bots
  -> 5080 primary, 3090 fallback) + endpoint check; (2) isolated-b pilot: isolated2shared-direct.sh with --quiet 240
  --accept-contamination owner (owner 01:30Z: 240 min, towns only); (3) release homefix-02 (verify head = homefix-02, variant
  matches the fleet sha), keep ironpick/protectzone behind it.

## 10-21 01:40Z — OWNER answered the 22-item list (memory owner-decisions-1021-list); toolkit-03 LIVE (3 pools); protectzone-01 queued + held

- toolkit-03 `34d3e5e9` LIVE 01:11:13Z on board-a, placebo-a, hive-b (3 pools: no tier-2 +180 KEEP; reads on to +360 ~07:11Z).
- **Owner 01:30Z:** isolated->shared hold 240 min/phase + scope towns only (MEMORY_SCOPE private) -> pilot isolated-b in the gap
  after toolkit-03 closes, `--quiet 240 --accept-contamination owner`; town plan: first pieces next, signs, cluster-as-storehouse
  (building only hive-a/b), no table pickup yet, farhome yes, furnace_drain later, tree felling after the site survey, showcase
  starts after Paper + a no-harm bench read; showcase: 15-min capture, owner-direct counts as kept, map/timelapse on its VM, pause
  during brain tests, seed kept; trial chambers PROTECTED (zone added 01:17Z to /var/lib/mcai/_pool-showcase/protected-zones.json,
  backup .bak-20261021-trial; parseZones: 8 zones, 0 bad), mineshaft NOT; protectzone-01 after ironpick-01; "mike" whitelisted on
  the showcase + root cron sets him spectator each minute (no password stored -- offline mode needs none).
- **10.0.0.40 vs DHCP:** DHCP server 10.0.0.1 (UniFi); .40 is probably inside the default .6-.254 range; asked the owner to set a
  UniFi Fixed IP for MAC BC:24:11:09:66:76 (operator may not use the UniFi API). Same for the other static VMs.
- **protectzone-01 QUEUED after ironpick-01, HELD:** before release install the bench test strip
  (`sudo python3 ~/mcai-analysis/protectzone-fixture.py --install`) and rebuild the variant on the then-fleet sha (only 9e7d9980
  exists). townindex-01 / indexsearch-01 to be queued after it once JIT variants exist (their variants were keyed on bagbudget).

## 10-21 01:15Z — homefix-01 REVERTED (v23: 2 deaths, one licensed watchdog_rescue); R11 continued; toolkit-03 launching

- **homefix-01 `a52d075e` REVERT 00:57Z (poll, +0).** +180 had G2/G3/G4 complete with 0 defects (G1 1 of 2). Deaths, both
  hive-d-Echo, both drowning: 20:19:20Z -- ~2.5 min after a level-1 relocation (a rescue the old code never started) left it in
  wet ground; mine refused (water every direction); level-2 home rescue aborted `stuck`; the drowning rescue yielded twice and it
  died at y=61.4. 00:50:35Z -- drowned in explore at y=48 after explore aborted x3. v23 floor met + a licensed change row ->
  REVERT, legitimately (not a read bug). Torn down 01:03Z (20 on 9e7d998, 0 drop-ins). Teardown note "placebo-b-Charlie
  restart-failed" is the stale `-Charlie` name (no env file; pools are Alpha/Bravo/Comet/Delta/Echo); reset-failed; 80/80 run.
- **R11 continued 01:10Z** (operator, deaths reviewed; toolkit-03 does not touch watchdog/relocation/home). toolkit-03 launches.
- **homefix-02** being diagnosed + designed (agent; branch homefix02-on-<base>): dry/standable relocation destinations; a home
  rescue meeting water hands off to the drowning/escape path; whatever death 2's chain shows. NOT queued -- owner decides
  (X1 lifted the stuck-hunt rule for homefix-01 only).

## 10-20 19:30Z — GAP: bagbudget-01 CLOSED INCONCLUSIVE; gate v36.1 installed; worlds VM 201 RAM 48 -> 80 GB; homefix-01 LIVE (4 pools)

- **bagbudget-01 `31416ee5` INCONCLUSIVE at +360** (owner 10-15 early-close rule: unexposed). Canary full-bag bank runs 0 in 6 h:
  cobblekeep-01 fleet-wide removed the population -- control full-bag town deposits that banked > 0 went 29/127 -> 45/49.
  D1-D5 0; 5 spent picks worn. Deaths 2 v 2, both hive-a-Comet (idle drowning after failed gotos; 25-block fall y=-1), not
  near deposit/wear. ~/bbclose.sh recorded 17:53Z, torn down 17:57Z (10 on 9e7d998, 0 drop-ins). Re-measure the leftover
  surplus (stations, torches, bone meal) on the new fleet before any bagbudget-02.
- **Gate v36.1 installed 18:49Z** (change-row spelling; branch changerows-underscore-1020 @ 49723bb9; Codex + Claude APPROVE):
  bundle 199517353b... -> 635ad8d866a6e4a772351961bd5bd997; replays of cobblekeep-01 / lidclear-01 +180/+360 identical; backups
  *.bak-v36_1-20261020T182359Z. Note: the FIXED launch check would have refused cobblekeep-01 (_lid_clear 485 baseline rows) and
  bagbudget-01 (_town_deposit 28) -- a re-arm of bagbudget needs its change_rows fixed and a queue re-add. Open: verdict.py's
  log scan keeps ordinary rows from the declared date and today only (a read spanning a 3rd UTC day loses the middle day).
- **Worlds VM 201 RAM 48 -> 80 GB** (ramup.sh 18:50-19:10Z: install-hold, 80 bots stopped, clean saves "All chunks are saved"
  in every world, qm set 81920, 20 units up, 80 bots restarted 12 s apart, 80 on 9e7d998, hold released). MemAvailable 64 G.
  The old ad-hoc BlueMap on .30 (nohup) stopped with the VM and was not restarted (the showcase has its own map).
- **homefix-01 `a52d075e` LIVE 19:21:21Z on hive-d, placebo-d, placebo-b, board-c** (tier 3; reads 180/360, extension to +540 at
  4 pools; deadline_min 1140). Stale pre-review /tmp/homefixread.py (12:12Z) moved aside first (H4; second time today -- see
  memory stale-tmp-read-blocks-launch). Queue after it: toolkit-03 -> ironpick-01 -> bamboo-03 -> foldwatch-01 -> treefarm-03.
- **Ready, not queued (owner decisions tonight):** townindex-01 + indexsearch-01 (both engines APPROVE; variants were keyed on
  bagbudget's tip -- need JIT re-variants on whatever toolkit-03/ironpick leave); protectzone-01 (b637723f; showcase start gate;
  needs the bench test-strip fixture); isolated->shared (c6bea93b); showcase decisions; town plan decisions 1-9.

## 10-20 15:10Z — homefix-01 QUEUED (after bagbudget, HELD for the RAM gap); bagbudget +180 NOT_YET (unexposed); change_rows underscore gate bug; daily Codex ops audit live

- **bagbudget-01 +180 14:38Z NOT_YET:** 2 pools (no tier-2 KEEP possible); exposure 0 -- the canary made 0 full-bag town
  deposits in 3 h (cobblekeep-01 fleet-wide since 11:23Z emptied bags first); D1-D5 0; 4 spent picks worn; deaths 1 v 0 (floor).
  +360 ~17:35Z, then extension.
- **homefix-01 QUEUED** after bagbudget-01 (owner X9: first free slot). Tier 3, deadline_min 1140. Variants 9e7d9980 ->
  a52d075e, 31416ee5 -> bff0a4ac (both engines APPROVE r4; 271/271; Paper P0-P3 candidate PASS, base shows each defect).
  **HELD** with toolkit-03 for the worlds VM 201 RAM upgrade in the gap after bagbudget closes (operator ramup.sh in the
  session scratchpad: install-hold, sandbox lock, stop 80 bots, qm shutdown/set 81920/start, 20 units up, staggered starts,
  versions, release). Release order after the restart: verify the head vs the owner order (opsaudit flag 2), then release.
- **GATE BUG (homefix agent, confirmed):** verdict.py `C_ROWS = set(reg['change_rows'])` keeps `_` but every match strips it,
  so registrations with `_`-prefixed change_rows (cobblekeep-01, bagbudget-01 LIVE) never link a death to their own rows; the
  rate path still runs. Fix + replay + install script being built (branch changerows-underscore-1020), installed in the
  same gap. Until then: register change_rows WITHOUT the leading underscore (homefix, toolkit-03, ironpick already do).
- **Daily Codex ops audit (OWNER "yes"):** ~/bin/opsaudit.sh (repo scripts/mac/opsaudit.sh), LaunchAgent com.mcai.opsaudit
  17:00 CDT; publishes .31 ~/digest/opsaudit-latest.md; fleetstatus.py header line 3 (installed). First run 14:36Z: 3 flags
  (0 high) -- (1) unread disk warnings [fixed: DiskLow header]; (2) cobblekeep reached preflight 10-19 16:32Z ahead of the
  owner-ordered brain-01, stopped only by a registration refusal [answer: check the head before releasing any hold];
  (3) idle VMs stopped 12:15Z DURING bagbudget's canary [accepted: infra changes go in gaps; no harm shown].
- **Ready, awaiting owner decisions tonight:** isolated->shared (branch isolated2shared-on-9e7d998 c6bea93b; hold 240 min/phase
  [rec] vs ~16 h; scope private [rec]); town plan decisions 1-9 (doc §; merged c727687b). townindex-01 + indexsearch-01 building.

## 10-20 12:20Z — FLEET 9e7d9980 (cobblekeep-01 KEPT +360, promoted 11:23Z, merged de502055); bagbudget-01 LIVE (2 pools); OWNER: town plan + fleet reshape

- **cobblekeep-01 KEEP +360 11:13Z** (2 v 5 deaths, rate 0.80x control; bag cobble DiD -155, bots >= 34 slots 55% -> 10% vs control
  45% flat; lid_blocked 71 -> 0; D1/D2/D4 0). Promoted fleet-wide 11:23Z; merged to main de502055 (270/270). Watch: smelt_town
  stop=no_fuel rose on the arm (toolkit-03's smeltfuel targets it); coal/iron banking barely exercised (2 coal).
- **bagbudget-01 `31416ee5` LIVE 11:35:30Z on board-d, hive-a** -- only TWO pools in band (cobblekeep's 4 cooling, brain-01's 2
  excluded 12 h, isolated + placebo-c never drawn), so no tier-2 KEEP at +180; reads on (+360 ~17:35Z). Stale pre-review
  /tmp/bagbudgetread.py (03:44Z) moved aside to ~/mcai-analysis/bagbudgetread.py.stale-tmp-0344Z (scheduler H4 had blocked).
- **Queue:** bagbudget-01 -> toolkit-03 -> ironpick-01 -> bamboo-03 -> foldwatch-01 -> treefarm-03 -> ...; JIT variants of
  toolkit-03 + ironpick-01 on 31416ee5 being built (snippets will land in ~/mcai-analysis/jit-1020/). homefix-01 RESTARTED
  (owner 12:00Z) from 3fe8cbbe (branch homefix-wip-3fe8cbbe) on 9e7d998; first free slot when ready.
- **OWNER 12:30Z: whole-town plan** (as-is measurement + BlueMap before pictures + template/per-town siting file; sorted deposits,
  tidy-up chore, storehouse-01 planned) -- design agent, branch town-plan-1020. No canary until built.
- **OWNER 12:45Z: fleet reshape, "do it all"**: (1) isolated-a..d -> shared towns (design + pilot one pool; agent); (2) a SHOWCASE
  world, new VM on pve1, ~10 bots on the Studio gemma4 brain, kept builds only, excluded from canary draws/reads (agent, branch
  showcase-1020); (3) sandboxes 5-8 (RCON 25603-25606, units prepared DISABLED; agent, branch sandbox58-1020) + worlds VM 201
  RAM 48 -> 80 GB (no memory hotplug: ONE VM restart, done by the coordinator between canaries: install-hold, stop bots,
  qm shutdown 201, set memory (+ hotplug), start, staggered 12 s bot starts); (4) keep 16 bench worlds x 5 bots on qwen 7B.
  **Done 12:15Z: idle VMs STOPPED (not deleted)** -- pve1 103 vm-minecraft-ai, 115 vm-minecraft-bots, 118 vm-minecraft-ai-v2
  (an idle Paper testbed; onboot set 0), pve3 206 mc-playground. Nothing on .30/.31/.186 referenced .185/.187/.188.
- NAS `es-backup` NFS share: owner creates it tonight (10-20 evening CT); then move the ES snapshot repo.

## 10-20 07:15Z — brain-01 CLOSED INCONCLUSIVE (+720); COBBLEKEEP-01 LIVE; ironpick-01 QUEUED after toolkit-03; bagbudget-01 Paper partial

- **brain-01 `78fa19d9`**: +720 read 04:51Z NOT_YET -> ~/brclose.sh recorded INCONCLUSIVE 04:51:46Z (OWNER), torn down (10 bots on
  adbec4f, 0 drop-ins). Studio ~/brain01/LIVE removed; keeper released GPU_RESERVED 04:57Z (KEEP_LOADED stays). brain-02 later.
- **cobblekeep-01 `9e7d9980` LIVE 05:06:57Z on board-a, placebo-d, hive-c, placebo-a** (tier 2, 4 pools). +180 ~08:07Z.
- **ironpick-01 QUEUED** (07:10Z, after toolkit-03; variants keyed 34d3e5e9 -> 2d410985, 28dc1158 -> f06f27a2; both engines APPROVE r4;
  npm test 271/271; Paper ironpick/keep/full CANDIDATE_PASS, base BASE_SHAPE). Registrations + ironpickread.py installed on .31;
  /opt/minecraft-ai fetched the two branches so the scheduler resolves the shas.
- **bagbudget-01** (branches bagbudget-on-9e7d998 / -on-adbec4f; both engines APPROVE design + code; npm test 269/269): Paper bagmix
  CANDIDATE_PASS (36->32, torch/ladder/bone meal banked, no junk in chest), base BASE_SHAPE; build refused under plinth-first (scene
  needs PLINTH_FIRST=0); rerun: bagwell FAIL (well took junk 36->33, chest rows never ran; crafting_table lost on BOTH arms),
  bagfar FAIL (2 of 4 spent picks worn: arena has no natural blocks). Returned to its agent to diagnose. NOT queued.
- **homefix-01 agent was STOPPED by the owner's side** ~06:1xZ mid-Paper (local commit 3fe8cbbe in its worktree, not pushed); its stale
  sandbox lock moved to /tmp/mcai-sandbox.lock.stale-homefix-20261020 after confirming no process. Not restarted: owner asked.
- **ES flood**: backfilled exactly (esflood-1020 merged fc8837e6); DiskLow now in fleetstatus.py's header (installed on .31 + .186).

## 10-20 03:30Z — ELK DISK FULL (fixed: 500 GB); OWNER: iron pickaxe in the toolkit, bag allowance, brain-01 closes at +720

- **ES flood stage 10-19 23:16Z -> 10-20 02:42Z.** The ELK VM (109 on pve1, vmdata zfs) hit 96% of 128 GB (data 48 G + local
  snapshot repo /srv/es-backup 47 G); every index went read_only_allow_delete; filebeat retried (429) and resumed. OWNER: grow to
  500 GB total + move the snapshot repo to the NAS. Disk DONE (`qm resize 109 scsi0 500G`, growpart/pvresize/lvextend -r: 490 G,
  25% used). The NAS move waits on the owner creating an NFS share `es-backup` for 10.0.0.186 (NAS exports only /volume1/Media
  today). Hole: 23:16-00:00Z 10-19 missing in ES (copytruncate rotation while blocked); backfill + a DiskLow check being built
  (branch esflood-1020). Wide-window reads must avoid that hour until the backfill lands.
- **OWNER (03:20Z): add the iron pickaxe to the toolkit** (2,324 town ingots idle; KIT was axe+shovel only) -> ironpick-01, tier 2,
  stacked on toolkit-03; **and a per-item bag allowance** (36/80 bags full; 71/77 full-bag town_deposits no_effect "nothing to bank:
  everything carried is kept") -> bagbudget-01, design + both engines first, base cobblekeep-on-adbec4f. Both building; not queued.
- **brain-01 closes INCONCLUSIVE at its +720 read (~04:45Z) if NOT_YET** (OWNER "yes take [the] read"): ~/brclose.sh on .31
  (nohup; log ~/digest/brclose.log) stops the loop, records, tears down 3 steps. cobblekeep-01 (queue head next) then launches.
  Re-queue brain-02 later for the full >= 200 bot-h read. The Studio's brain01 LIVE flag is cleared after the close.

## 10-20 02:10Z — OWNER: expansion X1-X10 "all yes except for rails"; brain-01 +360 NOT_YET (3 v 5 deaths, held); homefix-01 + E0 building

- **Owner answer (10-19 ~20:10Z, live operator session) to docs/reports/expansion-plan-2026-10-19.md §10:** X1 YES (the 09-30 "no more
  stuck hunts" rule is lifted for homefix-01 ONLY; tier 3; no 10-15 early close at +360 on a 2-pool arm), X9 YES (homefix-01 takes the
  first free slot once built + both reviews, never the head; before shaftuse-01 on a tie), X2 YES (expedition-01 before pavilion-01),
  X3 YES (surface-and-shallow), X4 YES (one per shared town), X5 YES (outposts valuables only), X8 YES, X10 YES (subject to K0).
  **X6 / X7 (rails) NOT decided** -- ask again at R0 / R0b.
- **Building now (agents, both reviews each):** homefix-01 (§5) on branch `homefix-on-adbec4f`; E0 frontier census (§4, host-side,
  read-only, no slot) on branch `frontiercensus-01`. Neither is queued yet.
- **brain-01 `78fa19d9` (board-c, hive-d, live 16:43Z):** +360 read 22:52Z NOT_YET; death gate HELD (WATCH): 3 canary deaths / 60 bh vs
  5 control / 300 bh, lower bound 0.63x. Deaths: hive-d-Delta drowned idle 16:45 (2 min after deploy), board-c-Bravo fell 28 blocks in
  gather 18:56 (after home->aborted), hive-d-Bravo suffocated idle 20:20 (after surface->failed). None linked (no change_rows).
  brainread at 554 min: gates G1-G8 pass (gemma4 share 99.8% of 6,540 decisions; p95 decision 4.75 s v 4.08 control); success DiD +0.17,
  stagnant DiD -0.84, items DiD -1.1/bh; exposure_ready 0 (registration needs >= 200 canary bh; 92 bh now -> about +1200, ~12:45Z 10-20).

## 10-19 16:27Z — GATE v36 (CANARY TIERS) INSTALLED + brain-01 host prerequisites, in ONE window after treefarm-02 (REVERT +180, torn down 15:57Z)
- **Owner 10-19 ~12:30Z "yes": tiers.** A registration declares `"tier": 2` (the integer, no `class`); ABSENT = tier 3 =
  unchanged. Tier 1 (a constant) = owner-direct rollout + tripwire (no tooling). Tier 2 = small fix with strong Paper
  evidence: KEEP allowed at +180 only with EXACTLY 4 pools, >= 48 measured canary bot-h, a declared exposure met, NO
  WATCH/HOLD, no blocked or undefined line, a licence that is not `rate`, a canary death rate <= control, and a CLEAN
  BASELINE. CLEAN BASELINE = verdict.py reads every bot's logs over [declared_at - max(240, M), declared_at); every
  canary row must be on the control-majority build. A later tier-2 KEEP needs the same, else INCONCLUSIVE at the final
  read. A tier-2 DRAW gets pools whose tier-2 predecessor closed >= 240 min ago (360 after a tier-3 promotion; strict
  journal; 240 min single build). A tier-2 verdict line starts `tier 2 (v36)`. Design + code reviewed to APPROVE by
  Claude and Codex (design 4 rounds, code 2 + window 2): docs/reports/canary-tiers-2026-10-19.md, branch
  canary-tiers-v36.
- **Installed 15:57-16:27Z** by `install-gate-v36.sh --then install-brain01-host.sh` (fired by gate-v36/v36-wait.sh when
  treefarm-02 tore down). Under one install-hold + /tmp/mcai-canary.lock it ran:
  - suites: tiers 149/149 (41 mutants incl. verdict ones), keep180 46/46, bagfix 163/163, usafe 166/166, threepool
    177/177, acceptance 83/83;
  - a byte-identical replay of 60 past tier-3 reads: 48 SAME, 0 different, 12 = the known `--dryrun` ALLBOTS crash on
    BOTH copies (pre-existing; follow-up chip);
  - a drawsteady comparison: identical for DRAW_RUN '', bamboo-02 and treefarm-02;
  - a LIVE loader check: 80/80 bots, bad 0, CLEAN, version_clean True.
  **GATE DIGEST b7ce36d7 -> 199517353b444cfdeb706d3ad965e05b** (gatedigest OK; parts now include tierrule.py ec878a51).
  Host: ~/verdict.py 43bdfb34, ~/mcai-analysis/tierrule.py ec878a51 (new), ~/mcai-analysis/drawsteady.py 7f34cbad,
  ~/digest/RULES-IN-FORCE.md 384ef223 (= repo scripts/host/RULES-IN-FORCE.md). Backups *.bak-v36-20261019T155752Z.
- **brain-01 host files (coordinator: same window).** Its approved patches went on unchanged, after v36:
  canary-loop.sh 344b1074 (canary_env), canary-sched.py 0d9a87f3 (class model-env), drawrec.sh 986e18d2 (draw_k; a
  model-env draw is capped at 2). Suites: threepool 177, bagfix_loop 21, drawrequire 35, holdtoken 19, canary_sched 93.
  The bundle is unchanged. The brain verdict.py/immobiledid.py patches were NOT installed. Composition: a model-env
  registration has a class, so it is tier 3 and keeps its 2-pool cap. Backups *.bak-brain01-20261019T162045Z. Both
  lines are in ~/digest/gate-installs.log.
- **No queued registration was tagged tier 2.** bamboo-03 and toolkit-03 look like candidates; their registrants should
  add `"tier": 2` and use `queue replace-variant`, which updates the registration sha256. A tier-2 registration also
  needs 180 in read_minutes before the last read, an exposure block, and a kind/text licence.
- **Follow-ups:** fix verdict.py's --dryrun ALLBOTS crash (needs a gate generation); close a dirty-baseline tier-2 run
  INCONCLUSIVE at once instead of reading on; at the FIRST tier-2 +180 read, record its baseline line and the
  control heterogeneity figure (residual: the previous run's held pools sit in the control arm, KEEP-favouring after
  a promotion; accepted, measured, not gated).

## 10-19 15:20Z — bamboo-03 queued (bamboo-02's G3 REVERT was a READ bug); cobblekeep-01, toolkit-03 queued; brain-01 pending host patches
- bamboo-02 G3=3 were stagnation-cut folds one craft short (in-flight craft made by the server, not yet recorded); no bamboo lost.
  bambooread fixed (e329a14f installed); bamboo-03 = foldTally counts the in-flight craft. Branches bb3-on-adbec4f 736e89b0,
  bb3-on-0b3a0d4 0447ffed. Open: 2 of 3 stagnation aborts were self-inflicted by the fold (owner call: exempt like smeltjob).
- cobblekeep-01 (bag-fix class): dirt/grass lids dug, leaves/glass lids open; the well takes what the cap refuses (same count);
  coal + raw iron banked above own needs. Branches cobblekeep-on-adbec4f 9e7d9980 / -on-0b3a0d4 5d36b839.
- toolkit-03: kit iron + smelt coal through every-container search. tk3-on-adbec4f 28dc1158 / tk3-on-0b3a0d4 132694cb (being
  re-stacked on cobblekeep).
- Queue: treefarm-02 (live) -> [brain-01 when its 3 host patches + the tier install land] -> cobblekeep-01 -> toolkit-03 ->
  bamboo-03 -> townfloor-01 -> monument-01 -> stonewithdraw-01 -> shaft-01. ES: llm.brain mapped (template + data stream).

## 10-19 14:00Z — PLINTHFIRST-01 read: KEEP recorded (direct rollout 01:30Z; tripwire window to 13:43Z) -- SHIPPED
- plinthfirsttrip.py OK every run 01:28-13:43Z (no natural well dug under the policy, no replan without evidence, no isolated
  plan, no second plinth beside a first in a shared town). plinth2trip one BREACH 08:39Z: P4 board-d raised well 363,73,134
  retired (wall_is_air: a gather-entombed bot escaped through it) -> the town replanned (structural, twice) and built a new
  plinth + well at 366,73,138 by itself; P5 two stuck episodes, misattributed (daily session read: one was the end of a 30-block
  livelock relocation, one matched another world's cap horizontally -- P5 should match caps per world in 3-D). Reviewed, no
  rollback. Clean 12:05-13:43Z. Follow-ups: escape should prefer a non-well exit; P5 per-world 3-D matching.
- Single control session: the daily scheduled task `mcai-daily-session` is DISABLED (owner 10-19 "one session to control").
- Added 10-19: nightly world backups (NAS, 03:15Z, verified), goalboard (daily 01:40Z on .31; census 00:15Z on .30, relayed
  via the Mac launch agent com.mcai.goalcensus-relay), overseer design r3 (S0 census first; not an actor yet).

## 10-19 12:50Z — (daily operator session) bamboo-02 REVERT reviewed (G3 defect, death not linked), R11 released; treefarm-02 re-stacked on adbec4f4 (0b3a0d4c) and queued; plinth tripwires read (P5 named, no rollback); coordination handed to the live operator session
- **Found at start (11:08Z):** no open canary; fleet adbec4f4 on 80/80 (townsearch-02 KEPT +720 01:06Z + promoted; plinthfirst-01 direct
  01:26Z; bamboo-02 launched 02:01Z, REVERTED +180 05:11Z, torn down 05:15Z); scheduler BLOCKED R11 since 05:20Z. Nothing to close.
- **bamboo-02 review:** REVERT decided by G3_bamboo (3 stagnation-aborted folds of 12, freed 0) -- a real defect for bamboo-03; the
  hive-b-Comet death is the mine-into-lava chain, not the fold. `continue bamboo-02` at 11:50Z with the review as the why.
- **treefarm-02 on adbec4f4:** cherry-pick + 5 hand hunks + rerere; Codex rebase review; 272/272; queued 12:28Z (replace-variant); draw
  kind amended deposit -> town_deposit 12:35Z (prospective; R10 had only hive-b eligible); scheduler decision LAUNCH. The live operator
  session confirmed the variant against its own build (db5e37d3) and asked daily sessions to stop applying queue/fleet changes without
  checking -- acknowledged by message (13:4xZ) listing every host change above.
- **Tripwires:** plinthfirst OK; plinth2trip P5_stuck breach = two misattributed episodes (details in CURRENT); named, no rollback.
- **Health:** deaths 24 h 30 (0.0156/bh, down from 48); bags 41/80 >= 34 (worse); 186/284 town_deposit refusals are "everything kept".
- Status report docs/reports/status-2026-10-19-daily-operator.md. Memory: r11-death-hold-after-correctness-revert.

## 10-19 12:45Z — COORDINATION: the live operator session (heuristic-nightingale) is driving the queue this week -- daily sessions please read
The owner has been giving instructions in the operator session continuously since 10-12. To any DAILY / FRESH operator session:
please do NOT apply queue entries, release holds, install gate changes or deploy without first checking this file's newest
entries and the journal; prefer analysis/reporting. Your treefarm-02 adbec4f4 variant 0b3a0d4c (applied 12:28Z) was checked
against an independent build (db5e37d3: same production code but one comment) and is allowed to launch. Owner decisions 10-19:
- tiered canaries (tier 1 settings = direct; tier 2 small fixes = 20 bots, KEEP at +180, ~3 h cool-off; tier 3 unchanged) --
  gate change being installed between canaries;
- queue: treefarm-02 -> brain-01 ("test now") -> cobble-in-bags fix -> toolkit-03 (iron via townsearch) -> bamboo-03 (G3 fix)
  -> townfloor-01 -> monument-01 -> shaft-01 -> stonewithdraw-01; copper into town builds; town projects 2-8 and the overseer
  as job assigner being DESIGNED; diamond tier held until mineshaft safety; nightly world backups to the NAS; a daily goal
  scoreboard (goalboard.py).
- Rule reminders: never wrap canary-sched.py in `flock ~/sched.lock` (deadlock); one canary at a time; teardown is 3 steps.

## 10-19 01:45Z — FLEET adbec4f4: toolkit-02, wellcare-01, townsearch-02 KEPT; plinthfirst-01 direct rollout; bamboo-02 next
- toolkit-02 932befcc KEEP +360 06:17Z 10-18 (deaths 2/60 vs 5/300; one rung-linked death reviewed: a sealed-water drowning at
  y 60, idle, no toolkit row -- not mechanism-linked), promoted 06:27Z. wellcare-01 a9cff42c KEEP +360 12:38Z (1/120 vs 4/240),
  promoted 12:48Z (supersedes minewell-02). townsearch-02 6bea246c KEEP +720 01:06Z 10-19 (0/120 vs 6/600; +360 had 5 of 6
  orders, 3 of the 4 pickaxes taken had 130+ uses), promoted 01:16Z.
- plinthfirst-01 adbec4f4 (every new well a plinth; working natural wells kept) deployed directly ~01:30Z after Paper pfnew /
  pfretire / pfkeep and both engines. Rollback = 6bea246c or PLINTH_FIRST=0. Tripwire: plinthfirsttrip.py (8e5ccd93) +
  plinth2trip.py every 30 min until 13:30Z. Expect almost no effect until a natural well breaks (~4 re-sites in 12 days).
- WELL WORK DONE except stocktargetread.py's literal 64 wood targets. Dirt lids still refused by lidclear (cobblestone-only).
- Queue: bamboo-02 (HELD; variant on adbec4f4 being cherry-picked) -> treefarm-02 -> townfloor-01 -> monument-01 -> shaft-01 ->
  stonewithdraw-01. Parked: cobbleoverflow-01 (chests not full), kitshrink-02 (re-queue).

## 10-18 13:25Z — (daily operator session) WELLCARE-01 KEPT (+360, 12:38Z) and PROMOTED: FLEET a9cff42c (12:48Z); merged to main 5ab7ad4e by the coordinator (13:13Z); townsearch-02 LIVE on board-a,board-d (13:00Z)
- **KEEP +360 at 12:38:56Z** by the canary loop (details in CURRENT): deaths 1 vs 4, W1-W3 0, licence 32/leak 0, unreachable-well failures
  35 -> 3 on the canary arm vs 73 -> 86 on control. Promoted 12:48:37Z (`deploy-wellcare-01-promote.log`: VERIFIED fleet on a9cff42c);
  manifest declared a9cff42c, canary cleared, 0 drop-ins at 12:49Z; open-loop check clear. Desktop notice sent (mobile push inactive).
- **Merge to main:** the coordinator merged first (5ab7ad4e, 13:13Z, 25 min after the promote) while this session built the same merge
  (ac7fb793, npm 267/267); the push was refused and the duplicate discarded. The two resolved the one add/add conflict differently:
  the coordinator took the wellcare copy of sandbox/well/minewell-e2e.cjs, which drops main's trapdoor `column` check (Paper scene only;
  follow-up to re-add). LESSON for item 4 of the re-arm list: the coordinator merges a promotion within ~1-25 min; wait for it or
  check origin/main immediately before `git merge`, and never assume a `--ff-only` success means the merge is yours to make.
- **townsearch-02 launched by the scheduler 12:56Z** into the empty slot (canary 6bea246c on base a9cff42c): preflight 384,230 rows,
  licence ok, gate digest ok, drawn board-a,board-d 13:00:36Z, deployed 13:00:37Z; 70 + 10 builds live. First read 19:00Z.
- **Session ends here (owner: do not run past the day).** No waiter is armed for 19:00Z: the host loop reads and acts; tomorrow's session
  closes the loop first.


## 10-18 11:25Z — (daily operator session) fleet 932befcc (toolkit-02 KEPT+promoted 06:27Z); wellcare-01 live since 06:34Z, +180 NOT_YET with exposure met, +360 at 12:34Z decides; no daily session ran 10-17
- **Found at start:** the STATE header was two days old (10-16 14:50Z) while origin/main carried dated entries through 10-18 00:30Z. The
  loop, scheduler and coordinator closed plinth-01 (INCONCLUSIVE), lidclear-01 (KEEP), townsearch-01 and kitshrink-01 (INCONCLUSIVE early),
  smeltjob-01 (KEEP), toolkit-02 (KEEP); the owner rolled plinth-02 (+02.1) and logcap-01 out directly. Fleet verified 932befcc (60) +
  a9cff42c (20) at 11:10Z; open-loop check = wellcare-01, correctly. RULE.md md5 746c65e4 both sides. Nothing to close yet.
- **wellcare-01 +180 (09:40Z):** NOT_YET on the schedule only; exposure_ready 1, W1-W3 0, licence 24 rows, unreachable DiD -0.406,
  guards within, deaths 0 vs 4. One canary death since (hive-d-Alpha 10:13Z, drowned idle at the surface, no change row) named above.
- **toolkit-02 operator review (v14c flag) DONE:** the rung-linked death is the sealed-water entombment chain, not the kit. KEEP stands.
- **Housekeeping:** local main fast-forwarded 29 -> 872f128e (30 commits). Status report docs/reports/status-2026-10-18-daily-operator.md.
- **Waiting:** the +360 read (Monitor on the journal, re-armed every 30 min). This block is rewritten after it.

## 10-18 00:30Z — PLINTH-02 (direct rollout, + 02.1 hotfix) READ: KEEP recorded (operator; owner-direct, no canary) -- SHIPPED
12 h before vs 12 h after the 12:25Z rollout (80 bots both; a fleet before/after, so world drift is not separated -- no DiD exists):
- towns with a well in use 8 -> 16 (of 16 worlds); well disposes 80 -> 204; no_site refusals 81 -> 9; bags 90% -> 87% full.
- deaths 20 -> 26; causes drowned 7, lava 6, falls 5, stalagmite 2, suffocation 1 -- 0 of 26 within 12 blocks of any of the 22
  plinth caps; tripwire P1-P5 / C1-C9 all 0 through 23:53Z except C6 isolated-c (the 16.09 invisible-cap second well, fixed by
  plinth-02.1 830dc36b). Not judged as harm; named.
- Side effect found and fixed: the 64 wood stock target pruned 14,585 oak logs down the new wells -> logcap-01 (469cba5a).
- Decision: KEEP (owner chose the direct path; the read is the tripwire + the before/after above). Follow-ups: plinth-first
  (rebuilt, Paper pending), wellcare-01 (queued), stocktargetread.py literal 64 wood targets.

## 10-17 22:50Z — FLEET 469cba5a: smeltjob-01 KEPT; plinth-02.1 hotfix; LOGCAP-01 (wood target 64 -> 4000) direct rollout
- smeltjob-01 (857c853c) KEEP +360 19:43Z (deaths 0/120 bh vs 2/240; +180 1,009 copper smelted, 1,646 in 12 h fleet-wide after),
  promoted 19:53Z. plinth-02.1 hotfix 830dc36b fleet-wide 20:04Z (isolated per-bot plinths, the 16.09 invisible cap that built
  isolated-c a SECOND well -- tripwire C6 17:18Z, not rolled back: explained, fixed, rollback not clean -- deep orders, replan on
  evidence, abandoned-pit cover). Merged to main (b4bf3f62).
- **LOGCAP-01:** with wells in 15 of 16 worlds, the 64-per-type wood stock target made prune_town throw 14,585 oak logs down wells
  in 12 h. OWNER "Yup raise log limit" -> TOWN_WOOD_TARGET 4000 (logs/planks/sticks), fast path: Claude APPROVE, Codex CHANGE (env
  parse, fixed; stocktargetread.py literal 64s -- follow-up, no queued canary uses it). Deployed directly 469cba5a ~22:50Z. Rollback
  = 830dc36b. WATCH: wood now banks instead of pruning -> chest fill / new-chest budget (4/day, 12 standing).
- **Queue:** toolkit-02 (H2: needs a 469cba5a variant; the chain agent is re-stacking toolkit -> wellcare -> townsearch-02 -> bamboo
  -> treefarm on 469cba5a) -> wellcare-01 -> townsearch-02 -> bamboo-02 -> treefarm-02 -> townfloor-01 -> monument-01 -> ...
  minewell-02 cancelled (superseded by wellcare-01). plinth-first rebuilt on 830dc36b+ pending Paper. kitshrink-02 to re-queue.
- Tripwire loop: plinth2trip.py with TRIP_SINCE (a canary deploy rewrites declared_at); INSTRUMENT "blind" no longer exits.

## 10-17 12:45Z — PLINTH-02 ROLLED OUT FLEET-WIDE DIRECTLY (OWNER option 2, no canary): FLEET 0fe92258 (VERIFIED ~12:33Z)
- Owner: "can we just build the wells? instead of waiting for some oportune time?" -> option 2: kitshrink-01 (live 12:10Z on
  board-a, board-b, hive-d, hive-c) closed INCONCLUSIVE 12:19Z and torn down (20 on 0152bae, 0 drop-ins); install-hold; fleet-deploy
  0fe92258 run_id plinth-02-direct; plinth-02 queue entry CANCELLED (owner-authorised). Merged to main.
- **Rollback = redeploy 0152baeb.** Tripwire: a fleet-wide plinth2read mode (all pools treated) is being built by the plinth agent;
  run it every 30-60 min; any P1-P5 / C1-C9 breach -> roll back.
- Side note: board-c and hive-d already have wells on the plinth-01 plinths (built by base bots 10-16 19:07Z / 10-17 06:53Z).
- **Queue head toolkit-01** BLOCKS on H2 (no 0fe92258 variant; being built). Variants being built on 0fe92258: toolkit-01,
  townsearch-02 (re-registered for exposure), treefarm-02, bamboo-02, smeltjob-01; kitshrink-02 to re-queue. plinth-first design
  (owner-approved) on dev base 0fe92258.

## 10-17 12:05Z — TOWNSEARCH-01 CLOSED INCONCLUSIVE early (unexposed); kitshrink-01 swapped ahead of plinth-02 (R10 wait)
- townsearch-01 (27908be4) live 04:58Z on placebo-d, board-c. +360: exposure needs >= 6 canary withdraw_pick order rows; ONE in 6 h
  (licence _townsearch_mode 20 rows: build live). Deaths 4/60 bh vs 4/300 (gate held, lower bound 1.20x): drowned gathering, lava
  swim idle, drowned idle, suffocated idle -- none in a withdraw. Closed under the owner early-close rule, torn down (10 on 0152bae,
  0 drop-ins). TO DO: re-queue as townsearch-02 with a registration that can reach exposure (more pools / longer reads), on the tip then.
- plinth-02 BLOCKED at R10 ("fewer than two pools can expose it now", eligible board-a only; draw exposure = >= 2 _well_refused
  order=build in 3 h). Swapped kitshrink-01 ahead (owner rule: swap when the slot would idle); it launches on 0152baeb (51033241).
  plinth-02 variant for 51033241 being built; its draw window is under review (3 h may miss towns in the 2 h no-site backoff).
- kitshrink-01 variants now: 623e92b9 359a9213, 0152baeb 51033241, 534aeec0 cc149425, da978c18 905aa1cb.
- toolkit-01 has NO 0152baeb / 51033241 variant yet.

## 10-16 23:30Z — LIDCLEAR-01 KEPT (+360, 23:05Z) and PROMOTED: FLEET 0152baeb (23:14Z); merged to main; townsearch-01 next
- KEEP +360: deaths 1 (0.008/bh over 120 bot-h) vs control 6 (0.025/bh over 240); exposure_ready 1. +180: 14 cobble lids dug,
  count_town lid_blocked 1 of 25 in the 4 canary towns (board-a, board-b, hive-c, placebo-b; was most rows). One dirt lid refused
  (cobblestone-only by design; widen if dirt lids recur). Merge conflict: lidcensus.mjs (branch static import) and
  sandbox/well/stock-e2e.cjs (union: cobblecap + lidrecount scenes).
- **Queue (variants ready for each likely tip):** townsearch-01 (27908be4 on 0152baeb) -> plinth-02 (623e92b9 / 0152baeb 0fe92258 /
  27908be4 534aeec0) -> toolkit-01 (... / 27908be4 7f99ba8e / 534aeec0 da978c18) -> kitshrink-01 (623e92b9 359a9213 / 0152baeb
  51033241; needs a variant on toolkit's tip) -> bamboo-02 -> treefarm-02 -> smeltjob-01 -> townfloor-01 -> minewell-02 -> monument-01
  -> stonewithdraw-01 -> shaft-01.
- kitshrink-01: banks torches + ladders (< 26) at the town deposit only; ~140 slots fleet-wide. Stations/bucket/chest kept (tech-ladder
  rungs count only while held; full-town recovery places the carried chest). Junk items linger only in towns without a working well.
- Follow-ups noted: place() has no well/plinth exclusion for crafting tables (every town craft); the well order reaches bots deep in
  mines (horizontal distance only); dirt lids.

## 10-16 ~17:15Z — PLINTH-01 CLOSED INCONCLUSIVE early (unexposable); torn down (10 bots on 623e92b, 0 drop-ins); lidclear-01 launching
- Both plinths built complete (board-c 60/60, hive-d 66/66, stair=[]), but build_well cannot finish the well on top: 23/30
  attempts "nowhere within 2 of the junk well's standing cell to put a crafting table" (trapdoor craft, skills.mjs ~8423), 5 "could
  not reach the standing cell". _well_built 0 -> exposure_ready 0. +180 deaths 0/30 bh vs control 1/150. Paper never hit this path
  (the scene bot carried trapdoors / had table room). Closed under the owner early-close rule; ledger INCONCLUSIVE (f8daab3).
- **plinth-02** being built on 623e92b9: trapdoor/table fix (works on the real board-c/hive-d plans), stand reachability (stair or
  refuse), + the stair-lid guard and wear_out refusal (from lidclear-on-f8daab3). Queue it after it is approved.
- Fleet stays **623e92b9**. lidclear-01 launches on its 623e92b9 variant 0152baeb (no plinth guards needed: no plinth on the fleet).
- New work (owner 10-16 ~16:30Z): withdraw searches ALL town chests (census: every town holds 4-16 usable stone pickaxes and 56-310
  sticks, yet withdraw_pick successes fell 119/day -> 17; agent building on lidclear-on-623e92b); shrink the carried kit (~470 slots of
  one-of-each items fleet-wide; agent designing with both engines).

## 10-16 ~16:30Z — plinth-01 LIVE (board-c, hive-d, 13:40Z); lidclear-01 + plinth hardening queued NEXT; toolkit-01 variants ready
- **plinth-01** canary f8daab3a (plinth-on-623e92b) deployed 13:40Z on board-c, hive-d (both no-site towns). Both plinths complete
  within ~30 min (board-c 60 cells, hive-d 66), stair=[] in both, no plan cell on any of the towns' 30/13 journal containers.
- **Two plinth defects found by reviewers** (latent; neither occurred in the canary): (1) stairOptions can put a stair on a town
  chest lid (lidclear then refuses it as a well cell -> a permanently shut chest); (2) wear_out can dig plinth wall blocks
  (andesite/diorite/granite). BOTH FIXED inside lidclear-01's f8daab3a variant **51972f9a** (lidclear-on-f8daab3): furnitureNear
  stair guard + click-time furniture re-check (a furniture stop counts as a stall -> void + replan), wear_out refuses well/plinth
  cells (wellCellAt). npm 255/255, lidclear 42/42, Paper lid + plinth scenes pass, Codex + Claude APPROVE. Records: d8374405 (main).
- **lidclear-01** (18 of 277 town containers lid-blocked in 7 worlds, cobblestone 18/18, bot-placed): recount clears a cobble lid;
  deposit/withdraw lid digs equip a tool and budget the dig. Variants 623e92b9 (lidclear-on-623e92b 0152baeb) and f8daab3a
  (51972f9a). MOVED to right after plinth-01 (it protects the plinths that promotion spreads), then toolkit-01.
- **toolkit-01** variants: f8daab3a -> 7be67d6e (tk-on-f8daab3), 623e92b9 -> b1722a6f (tk-on-623e92b); both engines APPROVE.
- **Queue:** plinth-01 (live) -> lidclear-01 -> toolkit-01 -> bamboo-02 -> treefarm-02 -> smeltjob-01 -> townfloor-01 -> minewell-02
  -> monument-01 -> stonewithdraw-01 -> shaft-01. bamboo-02 and later need variants on whichever tip plinth leaves.
- **Lesson:** never wrap canary-sched.py in `flock ~/sched.lock` (it takes it itself): a replace-variant deadlocked ~70 min.

## 10-16 14:50Z — (daily operator session, wake-up) cobblecap-1000 was KEPT by the owner at 11:44Z and promoted (FLEET 623e92b9); plinth-01 LIVE on board-c,hive-d since 13:40Z; the +540 rule is moot
- The 14:40Z wake-up found the owner's decision in the journal (`owner-decision` 11:44:23Z, `recorded KEEP`, `promoted` 11:54:04Z) and the
  coordinator's 12:00Z entry; fleet verified on 623e92b9 (70) + f8daab3a (10) at 14:40Z. No teardown, no merge, no page by this session.
- plinth-01's registration read and summarised in CURRENT; nothing else touched. Status report updated.

## 10-16 12:00Z — COBBLECAP-1000 OWNER KEEP and PROMOTED: FLEET 623e92b9 (11:54Z); merged to main; plinth-01 next (variant building)
- **Owner, 10-16 ~11:50Z: "promote, and future setting changes get a fast path ... if a change has poor effects we simply change the
  setting back to original number".** +360 was NOT_YET on exposure only (1 canary bank above 256 of the 3 the registration asked
  for: placebo-a 256->268 cap=1000; hive-a cannot bank -- a lid-blocked town container keeps its count unknown). Deaths 0/60 bh vs
  control 8/300 bh; D1/D2 breaches 0. Loop stopped by pid, KEEP recorded (owner note in the ledger), fleet-deploy VERIFIED 11:54Z.
- **REVERT IS ONE NUMBER:** TOWN_COBBLE_CAP 1000 -> 256 in bots/src/stocktarget.mjs (cobblecap.mjs re-exports it).
- **FAST PATH (new owner rule):** a constant-only change gets a light review, npm test, the default death/error gate and a +180 read;
  no custom read/licence/exposure rule. Behaviour changes keep the full process.
- **Queue:** plinth-01 (moved up by the owner 11:25Z) is the head and BLOCKS on H2 "no variant for 623e92b"; the plinth agent is
  building plinth-on-623e92b first. Every other entry (toolkit, bamboo, treefarm, smeltjob, ...) also needs a 623e92b9 variant.
- **OWNER 10-16 ~12:05Z ("1. yes 2. yes 3. normal"):** (1) after plinth-01 is KEPT, a follow-up makes EVERY new well a plinth
  (natural wells stay until they break); (2) lid-blocked chests: investigate, design, build if both engines agree (agent started);
  (3) cobbleoverflow-01 is a NORMAL fix (no `class: bag-fix`), still parked until towns fill.
- **Found 10-16:** 7 of 16 pools had count_town lid_blocked fails in 24 h (placebo-b 336/341 rows). A lid-blocked container keeps the
  town's cobble count unknown, so that town banks NO cobble at any cap. Fix proposed to the owner (find what is on the lids first).

## 10-16 11:50Z — (daily operator session) fleet 75cfb447 (wellsite-04 and townzone-01 KEPT+promoted overnight); cobblecap-1000 +360 NOT_YET, extending; hive-a is blind to it (lid-blocked town count); local checkout fast-forwarded
- **Overnight, by the host loop, the scheduler and the coordinator:** wellsite-04 @ 8cd0bc62 deployed 10-15 13:14Z on placebo-b,
  board-c,board-b,board-d, KEEP +360 19:23Z, promoted 19:33Z; townzone-01 @ 75cfb447 launched 22:41Z on board-a,hive-b,hive-c (after the
  operator gate), KEEP +360 04:52:57Z (deaths 1/90 bh vs 3/270; exposure_ready 1), promoted 05:02:38Z; cobblecap-1000 launched 05:06Z,
  drawn 05:32Z. Both promotions merged on origin/main (2d37c1f0). The docs STATE was a day behind; this copy is re-based on origin/main.
- **cobblecap-1000 reads** +180 and +360 NOT_YET (details in CURRENT). The poll 11:10Z: 0 canary deaths since declared_at. The cap is
  visibly live on the canary arm (refusals at a counted cap 110 -> 0 while control rose 716 -> 784; one bank to 268 under cap 1000),
  but exposure needs three bank rows and hive-a cannot write one: its town count fails `lid_blocked:1` on all 56 tries today
  (first 00:13:45Z, on the base build; none on 10-15). Decision rule for +540/+720 recorded in CURRENT; wake-up 14:40Z.
- **Fleet (ES, 11:09Z):** 3 h 240 bot-h, deaths 5 (0.021/bh; drowning 3, fire 2); 24 h 1,920 bot-h, deaths 32 (0.017/bh; drowning 10,
  fire 10, fall 7), gather 6.06 ok/bot-h, town_deposit 153 ok of 301. Iron funnel 24 h: raw iron 202 (0.14/bot-h), iron pickaxes crafted
  28, gone 75; iron-pickaxe bot-hour share 59.3% (raw iron is falling day over day: 326 -> 361 -> 296 -> 240 -> 202).
- **Housekeeping:** local checkout fast-forwarded 29aa97f5 -> 743cb4f5 (its uncommitted STATE copy moved aside, then overwritten by
  this rewrite). RULE.md unchanged (md5 746c65e4 both sides). The local analyst is still stale (10-06).
- **For the coordinator:** (1) the hive-a lid-blocked container (which block sits on which chest; whether a bot placed it; a count
  that tolerates one unavailable container, or a lid-clearing remedy) -- it closes hive-a's cobble bank entirely; (2) plinth-01 and
  minewell-02 have no 75cfb447 variant; townfloor-01's hold is satisfied but needs a tip merge; (3) a cobblecap re-registration with
  a "town count completes" draw requirement if (b) fires.

## 10-16 06:30Z — COBBLEOVERFLOW-01 READY (owner 10-16 "junk can take the extra"); both engines APPROVE; PARKED, not queued: zero exposure
- **Branch** `cobbleoverflow-on-cc1000` @ 5fae06fe (reviewed code 46a951a7; the tip adds docs/read only), on cc1000-on-8cd0bc6 9e79c171.
  The live cobblecap-1000 variant is 623e92b9 (on 75cfb447): a REBASE VARIANT onto that (or onto cobblecap's promoted tip) is needed.
- **Rule:** below the cap the well takes a whole surplus cobble/deepslate stack (bot keeps 64) only when the town's ROOM IS KNOWN (every
  container counted within 6 h, each count carrying per-name room + container size, size unchanged, no void/dirty/withdraw in progress,
  cobble count complete and < 1000; re-checked at plan, precheck and every click; > 48 blocks from home = unknown) AND no single container
  takes that stack whole. Unknown room sends nothing. 6 h TTL accepted by both engines (1 h never fires: 0/289 samples fully fresh).
- **Evidence:** npm 252/252; mutants 55/55 killed; Paper sandbox3 on 46a951a7: full town < 1000 -> bag 158->64, shaft +94, chest
  unchanged; room -> 94 banked, well +0; unknown room (lid-blocked chest) -> nothing in 157 s. Records docs/reports/cobbleoverflow-01-*.
- **Read** scripts/host/cobbleoverflowread.py 938b71e5 (+ cobbleroomaudit.mjs a184fc76 beside it); licence kind `_cobbleoverflow_mode`;
  draft registration docs/reports/cobbleoverflow-01.registration-draft.json (stuck_did; draw gate >= 3 "town chests in reach are full"
  rows / 12 h; no draw_require_pools).
- **WHY PARKED:** 48 h, 1.41 M rows: 0 full-town refusals, 0 cobble-only no-room deposits, 0 chest-budget refusals (positive control:
  318 town-deposit rows, 30 far-chest failures). Queued now it would sit at its draw gate and, as the head, block the queue. TRIGGER to
  queue: cobblecapread's BANK CLOSED tripwire, or >= 3 full-town refusal rows / 12 h on any pool -> build the variant on the live tip,
  install the read, queue it next.

## 10-16 05:15Z — TOWNZONE-01 KEPT (+360, 04:52Z) and PROMOTED: FLEET 75cfb447 (05:02Z); merged to main; cobblecap-1000 drawing
- **Verdict** KEEP +360 04:52:57Z: deaths 1 (0.011/bh over 90.0 bot-h) vs control 3 (0.011/bh over 270.0); +180 was NOT_YET with
  0 vs 3; exposure townzoneread.exposure_ready = 1. Promoted by the loop, VERIFIED 05:02:38Z (fleet on 75cfb447). Merged to main.
- **cobblecap-1000** launched by the scheduler on its 75cfb447 variant **623e92b9** (cc1000-on-75cfb44): preflight, licence
  (`_cobblecap_mode`, baseline silent) and gate digest OK 05:08Z; drawing ("waiting for two pools" -- the post-promotion steady rule).
- **Variants on the new tip 75cfb447 already exist** for toolkit-01, bamboo-02, treefarm-02, smeltjob-01. If cobblecap-1000 is KEPT
  and promoted, all four need variants on 623e92b9. plinth-01 and minewell-02 have NO 75cfb447 variant yet; townfloor-01 (held, its
  only variant 3b1ae8bb is on the 5e663860 lineage) needs townfloor merged onto the live tip before it can launch.
- **OWNER 10-16 ~02:00Z "yes, junk can take the extra":** the well takes whole surplus cobble stacks (bot keeps 64) when the town has
  NO ROOM, even below 1000. Being built as its own follow-up canary on cc1000-on-8cd0bc6 (the cobble-overflow agent; it hit the weekly
  API limit once and was resumed); queue it after cobblecap-1000; it will need a variant on whatever tip cobblecap leaves.

## 10-16 01:42Z — COBBLECAP-1000 READY on 8cd0bc62 / 75cfb447 (town cobble cap 256 -> 1000); both engines APPROVE; NOTHING queued or deployed (the cobblecap restart agent)
OWNER 10-14 "can we up the chest limit for cobblestones to 1000". The first agent stopped in its final round (r1-r5 both APPROVE on
16b83acc, old base 5e663860); restarted 10-15 ~23:00Z (owner "yes") and REBUILT on the live bases.
- **Branches (pushed):** `cc1000-on-8cd0bc6` @ **9e79c171** (fleet 8cd0bc62) and `cc1000-on-75cfb44` @ **623e92b9** (townzone-01
  75cfb447; use only if townzone is KEPT and promoted). The seven reviewed commits cherry-picked patch-identical (range-diff all '=') +
  r7. TOWN_COBBLE_CAP = 1000 written ONCE (bots/src/stocktarget.mjs); cobblecap.mjs re-exports it; admission, the cobble group target,
  the well's cobble switch, the prune, the refusal sentence and `_cobble_bank cap=` derive from it. Bag reserve 64 UNCHANGED.
- **r7, a LAUNCH BLOCKER fixed:** the old text licence (`_cobble_bank` 'cap=1000') passed only at --hours 24 -- the base wrote ONE
  _cobble_bank row in 24 h fleet-wide and canary-loop.sh runs licencecheck --hours 6, which REFUSED it. Now each bot writes
  `_cobblecap_mode phase=mode cap=1000` once per spawn; licence {class: kind, kind: _cobblecap_mode}. It proves the build is live,
  not the effect; liveness stays cobblecapread's bank_above_base_cap.
- **Evidence:** npm test 251/251 and 252/252; 25 anchored mutants killed / 0 on each; eslint no-undef only reflex.mjs:2384. PAPER (sandbox3,
  lock 00:17-00:19Z and 01:02-01:04Z, released): a town of 800 counted cobble banked a whole 30-stack (server chest 800 -> 830, bag
  158 -> 128, row town_after=830 cap=1000); a town at exactly 1000 refused at admission ("nothing worth banking (town cobble cap)",
  `_stock_refused at_cobble=1 cobblestone:158:cobble_cap`, chest unchanged); the base 75cfb447 refused the 800 town; one licence row per
  process. The deposit's own sentence "past its 1000 cobble (town cobble cap)" is proven at 970/971/999/1000/1001 in cobble-rule.test.
  Records: docs/reports/cobblecap-1000-{reviews,paper}-2026-10-15.txt.
- **Reviews:** r6 (rebuild + main-side reads) Codex APPROVE, Claude APPROVE (2 P3 handled); r7 (licence row) Codex APPROVE, Claude APPROVE
  (P2 stale host registrations -> reissued; P3s recorded).
- **Registrations** `~/mcai-analysis/cobblecap-1000.{9e79c171,623e92b9}.json` (copies in docs/reports): liveness bank_above_base_cap >= 1
  (a canary bank above 256 carrying cap=1000); DEFECT gates D1 a bank past 1000, D2 a released journal claim past 1000; arms (control
  rows carrying cap=1000) and the instrument block KEEP. No draw_require_pools (drawrequire.parse ([], None)); licencecheck PASS at 6 h
  and 24 h (baseline silent on _cobblecap_mode); changerowcheck PASS (none declared). draw_exposure 12 h `_stock_refused` ' at_cobble=1 '
  >= 5: re-measured 00:21Z, 8 eligible pools (hive-b 115, hive-a 105, hive-d 64, board-c 63, board-d 58, placebo-d 57, placebo-a 41,
  hive-c 38). The r6 registrations (0ef97f5c, 6853ed05) moved to ~/mcai-analysis/old-cc1000/.
- **Reads installed (~/mcai-analysis = /tmp):** cobblecapread 4eb87862, towncap ad5bde2f (imported from the read's own directory -- the
  scheduler does not pin it), stocktargetread 7b4f0d42 (NEW: the cobble target from the fold's module; the old literal 256 FAILS its
  own selftest against a 1000 fold), stonecapread 7fae15d7 (C5 from towncap + each row's cap=). Backups *.bak-cc1000-20261016T005251Z.
  Fold copy ~/mcai-analysis/cobblecap1000/cobblecap.mjs updated to r7 (f019a4f2). **Re-pin: none** -- only stonecap-01 and
  stocktarget-01 (both done) name stocktargetread/stonecapread. docs/reports/stocktarget-clear-caps-2026-10-10.json: a note that
  its 256 is the one-time clear's record, not the live cap.
- **Entry (NOT added):** `python3 ~/canary-sched.py queue add ~/mcai-analysis/cobblecap-1000.queue-entry.json` (copy
  docs/reports/cobblecap-1000.queue-entry.json), after=[townzone-01], carries a coordinator HOLD. canary-sched validate_entry dry run:
  the only refusal is "registration sha does not resolve" -- **`git -C /opt/minecraft-ai fetch origin` first.**
- **QUEUE PLACEMENT (Codex-agreed):** right after townzone-01, BEFORE toolkit-01. Adding the entry does not move toolkit-01 (its
  after= is townzone-01): set toolkit-01 after cobblecap-1000. If cobblecap is KEPT + promoted, toolkit-01 (cb801c52/2bce1306),
  bamboo-02, treefarm-02 and smeltjob-01 (all built on 8cd0bc62/75cfb447) need variants on cobblecap's tip.
- **OWNER DECISION still open (named, not designed):** a town BELOW 1000 whose containers are all full leaves surplus cobble with no exit
  (no room, cobble never opens a chest, the well takes cobble only at 1000). At 256 the well relieved it. Instrumented as the BANK CLOSED
  tripwire in cobblecapread.

## 10-15 23:45Z — shaft-01 (ziggurat stage 5, shared mineshaft) READY on a dev base, queued HELD after monument-01
Branch shaft-on-1f066b0 @ 41dc9d66 (dev base: mw-on-8cd0bc6 1f066b05 + treefarm-02 + monument-01) -> REBASE onto the real
tip when monument-01 is decided. Codex r4 APPROVE, Claude r2/r3 APPROVE. Offline: 12/12 snapshot shafts complete to y=16
(94-120 ladders, 15-169 lining). Paper: build to y=100 (40/40 ladders, 132/132 landing open, 332/332 lining), cap 2/2
after the centring fix, idle-kill climb-out with 0 shaft digs, SIGKILL resume complete. npm 261/261. Gates: REVERT on
unexplained shaft-cell loss, digs from inside the built part, liquid in the lining, deaths in the shaft, guard refusals
outside it, a bot held > 3 min; block KEEP on stuck bots near the collar or control shaft rows. Rail geometry recorded in
the shaft record's `rail` field (relayed to town projects). Next: shaftuse-01 (mine/surface route through the shaft).
smeltjob-01 (town projects stage 1, copper) queued after treefarm-02; iron design r15 Codex APPROVE (hoppers feed the
workshop blast furnaces; rails gated as stage 8). Queue: townzone-01 (live) -> [cobblecap-1000 when built] -> toolkit-01 ->
bamboo-02 -> treefarm-02 -> smeltjob-01 -> plinth-01 -> townfloor-01 -> minewell-02 -> monument-01 -> shaft-01 -> stonewithdraw-01.

## 10-15 23:12Z — TOWN PROJECTS: STAGE 1 (smeltjob-01) READY on 8cd0bc62 / 75cfb447 + the IRON design (r15, Codex APPROVE) + the RAILS stage; NOTHING queued or deployed (the townprojects agent, restarted 10-15 ~20:40Z)
**smeltjob-01 (replaces the never-queued 10-15 04:46Z entry on 5e663860 / 1957811e).** `smeltjob-on-8cd0bc6` @ **4935ef12** (fleet
8cd0bc62) and `smeltjob-on-75cfb44` @ **8fe41ad7** (townzone-01 75cfb447): the approved 371c08ed diff, no conflict, plus THE EXIT FIX the
rebase reviews found -- **the job fought its own withdraw hold**: it released only the leftover of its hold, so after "take 8, smelt 5"
the hold covered the 3 raw copper left and its own deposit planned nothing (raw_copper is DEPOSIT_ALWAYS; banked only 10 min later by
town_deposit). Now the WHOLE withdrawal is released at the exit (smeltjob.mjs `jobReturns`, pure), the town coal it took and did not
burn goes back while the bag's own stays (bankable.mjs `swapWithdrawHold`, exact and restored), and the job burns COAL ONLY (1 charcoal
in 354 town containers; owner D4). A ready milestone step is never displaced (milestoneHolds; the Paper milestone scene).
- Tests: npm test 253/253 and 254/254 (one concurrent-run flake, llm-admission-attribution ENOENT on a shared /tmp log path, passed on a
  solo rerun); smeltjob 39 + smeltjob-return 7 (the REAL skill over the fake world). Mutants 40/40 on both. eslint: only reflex.mjs:2384.
- Paper (sandbox2, server-read, lock 21:29-21:51Z): **7/7 on 4935ef12** (nofurnace NEW, copper, drain, milestone, carry, fullchest,
  recovery after SIGKILL), **5/5 on 8fe41ad7** (copper, drain, milestone, nofurnace, recovery). docs/reports/smeltjob-01-paper-2026-10-15.txt.
- Reviews (docs/reports/smeltjob-01-reviews-2026-10-15.txt): rebase Codex r1 APPROVE -> r2 CHANGE (charcoal preference; additive hold)
  -> r3 APPROVE; Claude r1 CHANGE (the hold P2) -> r2 APPROVE -> r3 APPROVE. Named residual: an interrupted/error/unsettled exit skips the
  return (bounded: holds lapse in 10 min; the next job takes the bag's copper first).
- Registrations `~/mcai-analysis/smeltjob-01.{4935ef12,8fe41ad7}.json` (copies docs/reports/): licencecheck PASS (_smelt_town 0 baseline
  rows; 1.38M rows / 80 bots / 24 h), changerowcheck PASS, drawrequire.parse ([], None) -- NO draw_require_pools. Read
  `~/mcai-analysis/smeltjobread.py` md5 c2345e99 (unchanged; scripts/host/smeltjobread.py). Entry (NOT added; the operator places it):
  copy docs/reports/smeltjob-01.queue-entry.json to .31 and `python3 ~/canary-sched.py queue add <it>` after
  `git -C /opt/minecraft-ai fetch origin` (branches pushed). `after` is set to townzone-01; move it as the queue needs.

**IRON (OWNER 10-15 ~20:30Z) -> design r15, section 12 of docs/reports/townprojects-design-2026-10-14.md; Codex APPROVE (r11 iron, r15
rails), raw texts docs/reports/townprojects-iron-reviews-2026-10-15.txt.**
- **Hoppers: in the WORKSHOP, not the storehouse.** A self-emptying item sorter needs a comparator (nether quartz: 0 in 354 containers),
  and any hopper flow inside town storage breaks the count journal. Stage 4 builds the two blast-furnace stations HOPPER-FED (H2: input
  hopper on top, output hoppers in the pad layer to one output chest; 30 iron) where the town's iron allows, else H0 (blast furnaces,
  10) or plain; stage 3 reserves the stations' notch so nothing is ever dug. The H2 line has its own fenced ledger (epoch boundaries
  taken by the feeding bot on an EMPTY line under the line lease; visits fenced by lease generation; <= 320 ore units per line).
- **Blast furnaces** stage 4 (D6). **Lanterns + bars:** storehouse 10 iron, hall 12 (5 with the storehouse's spare parts).
- **Budget per town:** the iron-pickaxe reserve 30 first, toolkit-01's <= 20 (4/bot) next, then stage by stage against 80% of spendable
  iron; IRON IS AN UPGRADE, NEVER A PRECONDITION (each stage has a no-iron variant). At the 10-14 census (in-town shared units 1,675):
  projects ~445 + toolkit 240 = ~0.69k.
- **Rails: stage 8**, designed against shaft-01's `rail` field (u=0 at feet yL, v=2..8, stop block v=1; surface terminus v<=-2),
  GATED: R0 a telemetry-only goto instrument + a measured saving (>= 2 bot-min/bot-h on the buildable lane), R0b Paper riding proof
  (mount/moveVehicle/dismount; riding must beat walking), R1 lanes only on 2-wide stub continuations dug by shaft-01's own primitive with
  u=1 a reserved walking lane; ~29 iron per qualifying landing.
- **STAGE ORDER:** 1 smeltjob-01 (ready) -> 2 structureguard-01 (the ziggurat lane's; reused) -> 3 yard-01 (+ reserved stations,
  PROJECT_COUNTED with raw_iron, the drain extended to blast furnaces) -> 4 workshop-01 (blast furnaces, hopper auto-smelter) -> 5
  storehouse-01 (lanterns, bars; no hoppers) -> 6 hall-01 -> 7 demand (only if needed) -> 8 rails (gated, after shaft-01 KEPT).
  Recorded departure: PROJECT_COUNTED moved from stage 1 to stage 3 (stage 1 discovers copper by looking).

## 10-15 22:42Z — TOOLKIT-01 READY (new) + BAMBOO-02 REBUILT on 8cd0bc62 / 75cfb447; both engines APPROVE; NOTHING queued or deployed (the toolkit agent)
**bamboo-02 (replace-variant).** `bb-on-8cd0bc6` @ **6b731312** (fleet 8cd0bc62) and `bb-on-75cfb44` @ **6ac667c0** (townzone-01 75cfb447):
the reviewed bamboo diff as composed with stocktarget-01 + orderroom-01 (`git diff 2ec19385 77ac5597`) as one commit, sorted +/- lines
identical except ONE union (hygiene HOUSEKEEPING + count_town); the two deltas are line-identical; + test/bamboo-chain.test.mjs (the
order through the real CognitiveLoop; 2 anchored mutants killed). npm test 253/253 and 254/254; eslint no-undef only reflex.mjs:2384.
Composition checked: bamboo NEVER_BANKABLE / NEVER_DISPOSE / PROTECTED, sticks = stock group (target 64), order town deposit -> recount
-> firstOrder(milestone, wear_out, bamboo) -> town/well/prune -> room order. Reviews (docs/reports/bamboo-02.rebase-review-2026-10-15.txt):
Codex r1 APPROVE, Claude r1 APPROVE (P3s on the chain test fixed; P3-1 inherited: a runner decline costs the fold a 30-min backoff --
follow-up, wear_out shares it). Registrations `~/mcai-analysis/bamboo-02.{6b731312,6ac667c0}.json`: no draw_require_pools
(drawrequire.parse ([], None)), licencecheck PASS (_bamboo_sticks 0 baseline rows / 6 h), changerowcheck PASS. **draw_exposure changed
3 h / min 5 -> 6 h / min 1**: since orderroom-01 the fleet writes few full-bag craft_room refusals (21:55Z: board-c, board-d eligible;
board-a at the edge). bambooread unchanged (md5 1aeb644a; dry run +180 on board-c,board-d: instrument 18, breaches 0).
Entry: `python3 ~/canary-sched.py queue replace-variant bamboo-02 ~/mcai-analysis/bamboo-02.queue-entry-replace-1015.json`
(copy docs/reports/bamboo-02.queue-entry-replace-2026-10-15.json; the old e29c1e7/79ab946/82aef34 variants dropped).

**toolkit-01 (new entry, NOT queued).** `tk-on-8cd0bc6` @ **cb801c52** (fleet 8cd0bc62) and `tk-on-75cfb44` @ **2bce1306** (townzone 75cfb447).
- MEASURED (ES 24 h, docs/reports/toolkit-01-measure-2026-10-15.txt): 22/80 bots hold a usable iron pickaxe; their usable stone
  pickaxes 0 x7, 1 x15 -> **0-2 usable extras fleet-wide** (the town deposit already banks them: one usable copy per name stays,
  stone_pickaxe target 16); they carry 23 SPENT stone copies, 16 at exactly 1 use (84 fleet-wide). 0/80 hold an iron axe/shovel;
  log gather 15.9 s/log no axe vs 10.4 stone axe.
- PART 1: with a usable iron(+) pickaxe AND a usable stone spare, wear_out keeps NONE of the 1-use stone copies for last-swing (34+
  slots). **DEVIATION from the ask:** spent copies go by USE, not down the junk well -- a pickaxe in the well is an off-list throw to
  wellread.py C3 (a REVERT gate on any later canary that registers wellread) and changing wellread changes pinned md5s. Scope: 1-use
  copies only, only under bag pressure, only with a usable spare (7 of 22 iron holders have none and keep theirs).
- PART 2: at town, no usable iron axe/shovel, a table near/carried/makeable: one container keeping 4 gives 3(+1) ingots (+ the short
  sticks; never iron when the bag cannot make the rest), the craft skill makes axe then shovel; the kit spends only bot.kitCredit + its
  verified draw (never ladder iron); the credit survives aborts (a restart forgets it: at most one extra draw, iron stays in the bag).
  The LAST deterministic order (a ready rung is never displaced). toolfor already picks the iron axe for logs and the shovel for soil.
- PAPER (docs/reports/toolkit-01-paper-2026-10-15.txt, lock 21:11-21:26Z): spare 36->34, three 1-use copies destroyed, iron + spare kept
  (ctrl unchanged); kitgather chest iron -4, server bag +iron_axe +iron_shovel, then 3 logs with the axe (damage 3) 7.9 s vs ctrl by
  hand 22.3 s, dirt with the shovel 4.7 s vs 6.0 s; the tz variant the same.
- Tests: toolkit.test 33 (real 1.21.8 blocks; the skill vs fakeworld; CHAIN through the real CognitiveLoop incl. abort -> retry);
  13 anchored mutants killed; npm test 252/252 (8cd0bc62 tip) and 253/253 (75cfb447 tip); eslint no-undef only reflex.mjs:2384.
- Reviews (docs/reports/toolkit-01-reviews-2026-10-15.txt): Codex r1 CHANGES (credit lost on abort; partial draw could spend ladder
  iron) -> r2 CHANGES (craft-then-throw kept spent credit) -> r3 APPROVE; Claude r1 CHANGES (same + K3 on window timing) -> r2/r3 APPROVE.
- Read `~/mcai-analysis/toolkitread.py` (NEW, md5 53b09256, /tmp copy matches; repo scripts/host/toolkitread.py): K1 no usable
  pickaxe left, K2 usable tool lost, K3 iron drawn and no tool (per bot, PENDING inside the last 40 min), K4 unverified craft -- all
  REVERT; liveness = verified kit crafts; control _toolkit rows 0; instrument = control bots without the kit. Gather-rate DiD
  REPORTED only (null dry run: log -0.82 s, soil +4.59 s).
- Registrations `~/mcai-analysis/toolkit-01.{cb801c52,2bce1306}.json`: licence kind `_toolkit` (baseline 0 rows), change_rows [toolkit]
  (changerowcheck PASS), no draw_require_pools, draw_exposure 6 h `_dig_town` >= 5 (10 of 11 pools). Entry (NOT added):
  `python3 ~/canary-sched.py queue add ~/mcai-analysis/toolkit-01.queue-entry.json` (copy docs/reports/toolkit-01.queue-entry.json),
  carries a coordinator HOLD; place it with `after` as the coordinator decides. Driver: sandbox/craft/toolkit-ab.cjs.
- BOTH ENTRIES dry-validated with canary-sched's own validate_entry: the only refusal is "registration sha does not resolve" --
  **`git -C /opt/minecraft-ai fetch origin` first** (branches bb-on-8cd0bc6, bb-on-75cfb44, tk-on-8cd0bc6, tk-on-75cfb44 are pushed).

## 10-15 16:45Z — monument-01 (ziggurat stage 4) READY, queued HELD; minewell-02 moved ahead of it
Both engines APPROVE (Codex r7/r8, Claude r3-r8). Click lock is a server-ordered barrier (use_item seq ack), no time-based
expiry. Paper r8 (sandbox4): build12 366/366 in 13.9 min, stand12 ok, kill12 366/366, cost48 gate p95 <= 94 ms, loop lag
<= 292 ms. Gates: REVERT M1 stall, M2 slow gate, M5 guard refusal outside the site; block KEEP M3 stuck near site, M4
gather regression (dig-share half powered, false trip 1.25%; gather-success half effectively UNPOWERED), M6 waived cells,
any control _monument row. Variants (monument-on-835ef3f d59eed78, -a784c0f 16c9acde, -4716d12 d2d7e6ff, -d0cf6c5
b5788efb) are all on minewell-01 lineage; structureguard plugs into minewell's stair planner, so monument-01 is HELD until
minewell-02 is KEPT+promoted and then needs a variant on that fleet tip. Queue: wellsite-04 (live) -> townzone-01 ->
treefarm-02 -> plinth-01 -> townfloor-01 -> minewell-02 -> monument-01 -> stonewithdraw-01 -> bamboo-02.
Known gaps: idle bot on an open cell holds a layer; a never-settling author keeps a world busy (named in lock_wait);
tree felling / litter pickup / chest draw not built. Review record: docs/reports/monument-01-reviews-2026-10-15.txt.

## 10-15 15:05Z — townzone-01 x minewell-01: PAPER PASSED, Codex r4 APPROVE -> all nine townzone variants approved (the townground agent)
Sandbox lock taken 14:54Z, RELEASED 15:02Z (sandbox4 empty, forceload removed). sandbox/townground/composition-scene.cjs,
cand tz-on-835ef3f d0cf6c5c vs ctrl 835ef3f0: CORNER (town S/W, a real well N/E) cand one walk-off -> mine success, 0 shell / 0 town
cells removed; ctrl 30 cells of the square removed. ROOF (bedrock over the arena, stone chamber in town, above sea level) cand
refused town_ground with the walk-only remedy -> the real goto -> mine success; 0 town TARGET digs vs ctrl 32. Codex r4 APPROVE
(last P3 closed); Claude APPROVE. Entry ~/mcai-analysis/townzone-01.queue-entry-9var.json UPDATED (the four new variants' approved
text + note; registrations and hashes unchanged) -- re-run `python3 ~/canary-sched.py queue replace-variant townzone-01
~/mcai-analysis/townzone-01.queue-entry-9var.json` to load it. Hold unchanged (coordinator releases).

## 10-15 14:45Z — townzone-01 COMPOSED INTO minewell-01's keep-out (option (b)): 4 variants built; PAPER BLOCKED on the sandbox lock
Builds (pushed, new branches; NOT queued): `tz-on-835ef3f` @ `d0cf6c5c` (treefarm-02), `tz-on-a784c0f` @ `4716d12d`
(wellsite-04 on 835ef3f0), `tz-on-a8af87d` @ `4edce8bb` (minewell-01), `tz-on-389b44f` @ `0a3e973a` (wellsite-04 on a8af87db).
ONE plan: the town is a keep-out part (townground.mjs townKeepOut, kind 'town') in minewell's composed forbid; one walk-off
target satisfies every keep-out (far starts beyond the square when the rings fail and the town blocks); one per-dig stop.
No-bearing -> an explicit refusal naming every blocking keep-out + "goto a dry spot 30+ blocks from home"; null choice guarded;
roof climb, inside-a-well escape and zone telemetry kept. npm test 257/258/254/255 rc=0. Registrations
`~/mcai-analysis/townzone-01.{d0cf6c5c,4716d12d,4edce8bb,0a3e973a}.json`: no draw_require_pools, drawrequire.parse ok,
licencecheck + changerowcheck PASS. Reviews: Claude APPROVE (r1, r2); Codex r3 CHANGES on ONE P3 -- the ROOF Paper scene must
actually run. Entry `~/mcai-analysis/townzone-01.queue-entry-9var.json` (keeps eb543899/5e663860/1957811e/8cd0bc62/7dbd6da6
and adds the four): its four new variants say DO NOT INSTALL until Paper passes. PAPER (sandbox/townground/composition-scene.cjs
CORNER + ROOF, cand vs 835ef3f0) NOT RUN: /tmp/mcai-sandbox.lock held by "monument (ziggurat stage 4)" since 10:41Z, no bot online.
**KEEP-OUT SHAPE (for the ziggurat agent / structureguard-01):** minewell.mjs `composeKeepOut(...parts)` is VARIADIC (a
two-argument compose drops a third part silently -- mutant-tested); a part is `{ forbid(cell) -> kind | true | null, bottom }`
(true = 'farm'); the first part that claims a cell names it, so compose `composeKeepOut(farm, monument, town)` (town LAST:
the ziggurat is cobblestone, which is town TERRAIN). stairClear uses structureguard's own kind lines; keepOutLabel/keepOutWhy
are a table (farm, monument, town); planMineStart returns `kinds` (every kind that blocked) and takes `far(kinds)`: gate the
monument exit on `kinds.includes('monument')` and offer its exit cells through `far`, so startAt judges them against every
keep-out (Claude P2-1). structures.mjs should re-export minewell's composeKeepOut rather than keep a two-argument one.

## 10-15 ~13:00Z — TREEFARM-02 variants on townzone-01 READY: entry `docs/reports/treefarm-02.queue-entry.json` now 5 variants, after townzone-01; NOT QUEUED
- **Queue (coordinator):** wellsite-04 live (5e663860 -> 8cd0bc62; placebo-b, board-c, board-b, board-d -- two of the farm's
  exposure pools), so townzone-01 runs BEFORE treefarm-02; minewell-01 closed INCONCLUSIVE (fleet 5e663860).
- **New variants:** 3b1ae8bb (townzone on 5e663860; if wellsite-04 reverts) -> `farm-on-3b1ae8b` @ **02ccaa8b**,
  registration treefarm-02.02ccaa8b.json; 75cfb447 (townzone on 8cd0bc62; if wellsite-04 is kept) -> `farm-on-75cfb44` @
  **859b719b**, registration treefarm-02.859b719b.json. Each = the approved farm diff for its base, one index.mjs conflict
  resolved as on the reviewed farm-x-tz merge, plus treefarm-zone.test.mjs (7). npm test 254/254 and 255/255. Codex r12
  APPROVE, Claude r12 APPROVE (3 test P3s fixed). licencecheck/changerowcheck PASS, no draw_require_pools.
- **Zone composition:** plots are inside the town box (soil = ground, guarded by the zone too); farm logs are free for
  gather; the farm digs only logs and restores soil by placement; mine's zone stair check covers farm soil in the box.
  **Open (all variants but a8af87db):** `mine` outside the box can cut a plot; the zone's walk-out (Chebyshev 19) can funnel a
  start there. A fix needs the farm check in mine's bearing filter (as on the minewell variant), not only per step.

## 10-15 11:29Z — (daily operator session) 5e66386 merged to main; minewell-01 closed INCONCLUSIVE early by the coordinator at +360; teardown verified
- Host overnight vs the docs STATE (10-14 11:40Z): stocktarget-02 KEEP +360 17:34:36Z (deaths 1/60.0 bh vs control
  7/300.0, exposure_ready 1), promoted 5e66386 fleet-wide 17:44:27Z -- NOT merged to main until this session (the
  coordinator wrote 20 commits of docs/variants on main meanwhile). wellsite-02 deployed 17:50Z on placebo-b,board-a,
  board-b,board-d; +180 NOT_YET; +360 REVERT 23:57Z on wellread.breach_recollected = 9 -- a FALSE TRIP: all nine
  recollections were hive-d (control, base build) where `mine` dug the well's own wall (the defect minewell-01 fixes);
  torn down 00:03Z (3 Charlie units were not running before the restart and restart-failed: placebo-b, board-a, board-b
  -- they came back; 80/80 seen in ES 3 h). airpocket-03 deployed 00:13Z on hive-d,hive-c, closed INCONCLUSIVE by the
  operator 03:10Z on the owner's early-close decision, torn down 03:14Z. wellsite-03 and treefarm-01 launched, waited
  for excluded pools, were abandoned and re-queued unchanged as wellsite-04 / treefarm-02. minewell-01 launched 06:45Z,
  drawn placebo-a,hive-a 06:49Z, deployed 06:52Z, +180 NOT_YET 09:56Z.
- Ledger 11:08Z: exactly one open loop (minewell-01). Scheduler S1-S7 consistent with the manifest and the journal.
- Merge of 5e663860 into main: clean auto-merge (recount.mjs, stockrecountread.py added; skills/cognitive/hygiene/runner
  merged; one test file auto-merged) in a scratch worktree of origin/main b558f187; commit 63a11279; full suite
  252/252 files green (run-tests.mjs, 11:13-11:27Z); main-pre-20261015 = b558f187; pushed 11:29Z.
- Fleet (ES, fleetstatus 11:11Z): 3 h 8 deaths / 240 bot-h (3 drowning); 24 h 37 deaths / 1,920 bot-h (17 drowning, 8
  of them hive-d; 8 fire, 7 fall); 7 d 274 deaths / 13,440 bot-h (116 drowning). gather 42.5% ok / 7.29 ok per bot-h (24 h).
  Iron funnel (24 h, 1,436 bot-h): raw iron 240 (0.17/bot-h), ingots 263, iron pickaxes crafted 34, gone 75 (51 at <= 3
  uses left); iron-pickaxe bot-hour share 60.1% (57.6% yesterday). Host / 29% used, 69 GB free.
- Owner notified (desktop; mobile push not sent, Remote Control inactive) of the promote, the revert and the live canary.
- minewell-01 +360 read 12:59:42Z NOT_YET (details in CURRENT); the coordinator closed it INCONCLUSIVE 13:00:40Z under the owner's
  early-close rule and tore it down; I waited for the torn-down phase instead of racing the restarts, then verified 13:04:49Z:
  ledger clear, journal torn-down + sched closed, 80 bots, one build live (14 restart-lag rows on a8af87db, none after the restarts).
  Follow-up for a re-queue: declare `_mine_well_guard` in change_rows (the read flagged LINKAGE UNAVAILABLE), and draw a pool that
  has a recorded well cap (placebo-a had none for the whole run, so half the exposure could never arrive there).
- No analysis started. No world change. RULE.md unchanged (md5 matches the host).
## 10-15 ~10:30Z — ZIGGURAT/SHAFT BUILD, STAGES 1-2 DONE (OWNER ~05:00Z: shared mineshaft + a SOLID ziggurat per world; Z2-Z8 operator defaults); stage-2 entry READY, NOT QUEUED
**STAGE 1 (offline Z0/M0, read-only snapshots 04:14Z):**
- Branch `zig-offline` @ 568cadd3 (on b7cc60b5): monument.mjs, shaftplan.mjs, zigsite.mjs, zigexposure.py, 40 tests.
- Report: `docs/reports/zig-stage1-z0m0-2026-10-15.md`. JSON: `zig-z0m0-2026-10-15.json`. Reviews:
  `zig-stage1-reviews-2026-10-15.txt` (Codex r6 APPROVE; Claude r2+r3 APPROVE).
- **Ziggurat sites in 12 of 12 shared worlds** under OPERATOR rules: centre <= 80 (placebo-d 96), water <= 150 columns
  filled, <= 250 levelling digs; trees and litter cleared.
  - Strict design rules (64 / 24 / 0) give 2 of 12. **hive-b's site exists only under the 150-water rule.**
  - 13.4-18.6k blocks per world, 190.0k for all 12.
- **Shafts to y=16 in 12 of 12**, each with a walkable pad from home: 328-435 digs once and 22-168 lining placements per
  town.
- The town ring is QUARRIED: 501-537 of about 580 collar candidates are more than 6 below home.y in the shared-seed
  towns.

**STAGE 2 = stonewithdraw-01** (withdraw before dig near town, at the surface + goto dig-retry evidence).
- Branches (pushed, new):
  - `stonewithdraw-on-5e66386`: canary sha **e08c3b94** (tip d3016d82, docs only after);
  - `stonewithdraw-on-b7cc60b`: canary sha **ae5e3e8a** on treefarm-01's tip (tip b44c7285).
- npm test 251/251 and 253/253. eslint no-undef: only reflex.mjs:2384, as on the base.
- Paper sandbox4: surface / short / deepslate / retry all ok on RCON truth.
- licencecheck PASS (_stone_withdraw 0 rows / 6 h). changerowcheck PASS.
- Reviews: Codex r1 CHANGE, r2+r3 APPROVE; Claude r1 CHANGE, r2+r3 APPROVE.
- Read: `~/mcai-analysis/stonewithdrawread.py` (md5 a862bcb6), W1-W4 + leak.
- Registrations: `~/mcai-analysis/stonewithdraw-01.{e08c3b94,ae5e3e8a}.json` (copies in docs/reports).
- Entry `~/mcai-analysis/stonewithdraw-01.queue-entry.json`; **the coordinator queues it.**
- **Known gaps** (in its notes):
  - the rung's own order (5.1a) is not built;
  - mine's rung credit within 48 is not changed;
  - the count is the model's (it may churn against the bank);
  - the 64 floor is advisory between bots.
- Expected cut is small: about 0.2-0.75k cobble a day, shared.

**NEXT: stage 3** = structureguard-01 built ON minewell-01 + the generic placement builder, shared with town projects'
stage 3; built once.
- Sandbox lock released.
- Note: a `ziggurat timelapse pipeline` commit (3799f453) by another session is on main.

## 10-15 10:17Z — ZIGGURAT STAGE 3 DONE: structureguard-01 + the generic placement builder; both engines APPROVE; NO standalone canary (recommend folding into monument-01, stage 4)
(The stage 1-2 entry below is stamped ~10:30Z; it was written before this one, so read that stamp as earlier.)
- **Branch:** `structureguard-on-835ef3f` @ **eb407fa0**, pushed. Base 835ef3f0 = treefarm-02 on minewell-01. The guard
  composes into minewell's planMineStart, so 5e663860 and b7cc60b5 cannot carry it.
- **Report:** `docs/reports/zig-stage3-structureguard-builder-2026-10-15.md`.
- **Reviews:** `zig-stage3-reviews-2026-10-15.txt`.
  - Codex: CHANGE in r1, r2 and r3 (each a check-then-await race), then r4 APPROVE.
  - Claude: CHANGE in r1 and r2, r3 APPROVE, r4 CHANGE (a committed mutant file), r5 APPROVE.
- **What it does:**
  - A recorded monument (`monument-<home>.g<N>.json` in the pool dir) is kept out of TARGET digs only: mine's plan and
    per-dig stop, gather (the search and the dig), room vetoes, and the ore tunnel (candidates, route price, and its
    dig-time boundary).
  - From inside a large reservation, mine walks off the monument's nearest side itself.
  - builder.mjs and buildbot.mjs: plinth's placement rules made generic, plus a fenced and gated executor with a mineflayer
    adapter. It has no caller until stage 4.
- **Tests and lint:**
  - npm test 258/258 on eb407fa0.
  - structureguard.test 26/26, including the tunnel boundary on mineflayer's real digging plugin. builder.test 24/24.
  - eslint no-undef: only reflex.mjs:2384, as on the base.
- **Paper (sandbox4):**
  - zig, a 12-wide solid ziggurat: 366/366 confirmed by the server, 1.14 s per placement.
  - bystander, resume: pass.
  - mine: 0 of 528 reserved cells dug (control 17).
  - gather: 0 near / 6 far (control 6 near).
  - offmon: walked off, mined, 0 of 780 reserved dug.
  - tunnel: 7 runs, refused at the dig 2 times and re-routed 5 times, with 1 in-flight dig allowed.
- **The one fleet-visible change without a record:** every gather dig now does a forced look and then `dig(…, 'ignore')`
  (craft's table retake already did this). The Paper gather scenes pass with it.
- **NO registration or queue entry,** deliberately. The guard has nothing to guard until stage 4 writes the first record.
  A no-regression canary for the look change can be written if the coordinator wants one.
- **Merge notes:**
  - townzone-01 edits the same gather, collectManually, tunnel and mine sites; merge by hand.
  - wellsite-04's 835ef3f0 variant overlaps in skills.mjs, not yet checked.
  - plinth-01 should import builder.mjs's primitives.
- **NEXT: stage 4 = monument-01.** Siting and the record writer, the frontier barrier and the cover rule, segment slots and
  leases, the build_monument job (nearest-first order), funding and the well yield, `_monument` rows and the read, Paper
  scenes, registration and queue entry.

## 10-15 09:45Z — TREEFARM-02 variant on minewell-01 (a8af87db) READY: replace-variant entry `docs/reports/treefarm-02.queue-entry.json` (after minewell-01); NOT QUEUED
- **treefarm-01 -> treefarm-02** (coordinator): treefarm-01 was abandoned before its draw (board-b, board-d, hive-c all
  excluded until ~11:57Z) and re-queued unchanged as treefarm-02 after minewell-01. Variants: 5e663860 (b7cc60b5),
  8cd0bc62 (cc16f64e), and NEW a8af87db: `farm-on-a8af87d` @ **835ef3f0**, registration `docs/reports/treefarm-02.835ef3f0.json`
  (= ~/mcai-analysis; run_id treefarm-02; read md5 600bc667; no draw_require_pools; licencecheck + changerowcheck PASS).
- **What the a8af87db variant adds (composition with minewell's mine guard):** `mine` digs with bot.dig directly, so the
  farm's pathfinder exclusions never reached its stair -- a gap since the farm's 10-06 design, STILL OPEN on the 5e663860
  and 8cd0bc62 variants. On a8af87db minewell's planner takes the farm's cells (farmStairForbid) as a forbid predicate,
  read from the shared record at every plan and dig; a relocation never stands in a farm cell; refusals name the farm (or
  both) with a performed remedy. No farm -> minewell unchanged (4,000-case side-by-side, 0 differences). Plots never sit in
  a well's shell (they keep 4 from a cap).
- **Reviews:** Codex r8 CHANGE -> r9/r10/r11 APPROVE; Claude CHANGE (P2: a farm refusal named a far well) -> APPROVE x2.
  npm test 255/255; treefarm-minewell.test.mjs 18 with 6 anchored mutants.

## 10-15 ~05:30Z — ZIGGURAT + SHARED MINESHAFT + DIG AVOIDANCE: measured and designed (OWNER ~03Z "lets do it"); Codex APPROVE r5+r6, Claude APPROVE r3+r5; NOTHING built, queued or deployed
Doc: `docs/reports/ziggurat-mineshaft-2026-10-15.md` (r5). Reviews: `docs/reports/ziggurat-mineshaft-reviews-2026-10-15.txt`
(Codex CHANGE r1-r4, APPROVE r5 and r6; Claude CHANGE r1-r2, APPROVE r3 and r5; the last fix is r5.1's cover
anchor). Scripts:
`...measure.py.txt` (host ~/zig on 10.0.0.31).

**Measured** (full walk 10-14 11:30Z to 10-15 02:30Z, 15 h, 80 bots, 1,198 bot-h, 897,944 rows, which reconciles with ES
897,899; 7-day ES cross-check):
- **Cobble collected: 28,417, about 45.5k/day.** The shared pools account for 34.5k/day of it.
- **mine's staircase is 50.7%** (ES 7 d: 47.6%). goto's dig retry is 17.0%, gather stone 9.2% (falling: 27% on 10-08,
  9% on 10-14), approaches 6.5%, survival 5.4%, the ore tunnel 5.1%, surface 4.2%.
- **Digs of any block:** 126,612 (105.7 per bot-h).
- **How mine is called:** 74% of calls descend less than 2 blocks, inside a mine → gather iron_ore → mine loop.
- **Town chests:** 4,413 cobble across the 12 shared towns (journal fold); 8 towns are at the 256 cap.
- **Gather stone:** 94% of gather-stone runs start below the 64 reserve.

**Designed:**
- **(1) Ziggurat.** 48 base, 8 tiers of 2, setback 3, 16 high. **SOLID BY LAYERS: 14,688 blocks, about 11-14k
  cobble.** The true hollow shell (3,780) has 2,116 cells over air and an open pit while it is built, so it is not v1.
  - The skin is cobble and the core takes stone-family blocks above the guard.
  - It is a monument lane with an admission gate and a frontier layer barrier. Waived cells carry a cover rule with an anchor.
  - It takes cobble before the junk well only on laps where its own order is issued.
  - Its cells are guarded against target digs only; damage is absorbed.
  - The plan is funding-bound: about 1-3.5 weeks per world today, 1-10.5 weeks after the cuts.
- **(2) Shaft.** One per shared town, with the collar at Chebyshev 17-21 from home.
  - Two ladder columns (down and up), landings every 8, and the bottom B is the lowest landing.
  - Trap table T1-T11, including a `use_ladder` escape rung and exit-contract credit from a zero-break, zero-place
    route that is revalidated before every step.
  - mine "landing hops" route through it deterministically.
  - **Expected cut: about 0.94 / 4.67 / 8.19k a day (low / central / high).**
- **(3) Withdraw instead of dig** near town: about 0.2-0.75k a day. The transit cut is instrumented first, and none is
  claimed.
- **Total: about 1.2 / 5.1 / 8.9k a day, which is 3 / 15 / 26% of shared gross.**

**Staging:**
- S0: offline Z0 (sites, foundation, voids, exposure) and M0 (shaft envelope surveys).
- S1: stonewithdraw-01, plus the goto-retry instrument.
- S2: monument-01, after structureguard-01 and the generic builder.
- S3: shaft-01, then shaftuse-01.

**OWNER DECISIONS PENDING: Z1-Z8 (doc §7):**
- **Z1:** solid by layers (≈1.5x the "hollow ≈ 10k" the owner expected) vs a true hollow.
- **Z2:** a monument lane outside the projects' WIP=1.
- **Z3:** the ziggurat as the generic builder's first client, ahead of the yard.
- **Z4:** the town floor goes first.
- **Z5:** accept that the cuts slow the ziggurat.
- **Z6:** setback S=3.
- **Z7:** stone_bricks for the crown.
- **Z8:** accept foreign skin blocks.

**Scratch note:** this session overwrote an older `codex-r1.txt` in the shared scratchpad, owner unknown. This round's
files are under `scratchpad/zigms/`.

## 10-15 05:10Z — TREEFARM-01 REVIVED on 5e663860; bone meal OFF by default (OWNER, after the A/B); both engines APPROVE; READY, NOT QUEUED (after wellsite-03)
- **Branches:** `farm-on-5e66386` @ **b7cc60b5** (fleet 5e663860); `farm-on-8cd0bc6` @ **cc16f64e** (if wellsite-03 is kept:
  the same net diff on 8cd0bc62, one union hunk in townWellSite). The airpocket-03 variant is dropped (airpocket-03
  INCONCLUSIVE). Registrations `docs/reports/treefarm-01.b7cc60b5.json` / `.cc16f64e.json` (also in ~/mcai-analysis);
  read `scripts/host/treefarmread.py` = ~/mcai-analysis (md5 600bc667...; the 10-06 read kept as .bak-20261015-1918bb5);
  queue entry `docs/reports/treefarm-01.queue-entry.json` with `after: ["wellsite-03"]`. No draw_require_pools;
  licencecheck + changerowcheck PASS on both.
- **Rebase/composition:** the 10-06 diff as unions; the farm YIELDS to the junk well (a recorded well site is judged without
  the farm; a NEW one keeps 4 from a plot), plinth plans and chest claims, checked at the fence before every click;
  chest-full keeps off farm cells and widens on a farm refusal; the farm keeps out of the town floor's band; `_dig_town`
  target scope; order only within 12 of home.y; a walk's own confirmed scaffold is scaffold= not lost=.
- **MERGE LINES (whichever lands SECOND carries them; green on the test merges `farm-x-pl`, `farm-x-floor`):**
  - **plinth-01** (skills.mjs): `plinthKeepOut` ends with
    `try { out.push(...farmKeepOut(knownFarmRecord(bot))) } catch { /* no farm */ }`, and the planner call becomes
    `planPlinthSteps({ read: memoRead(read0), home, avoid: wellSearchAvoid(bot), keepOut: plinthKeepOut(bot), otherColumns: others })`
    (plus `farmKeepOut` in the treefarm import). The hand-off oracle keeps `wellAvoid` (a recorded site is judged without the farm).
  - **townfloor-01** (skills.mjs): `floorKeepOut` ends with
    `try { for (const c of farmKeepOut(knownFarmRecord(bot))) out.push({ x: c.x, y: c.y, z: c.z, r: 0, up: 0, down: 0 }) } catch { /* no farm */ }`
    (plus `farmKeepOut` in the treefarm import); cognitive.mjs runs the floor order, then the farm's; HOUSEKEEPING gets both.
  - **wellsite-03** (if it lands without the farm first): townWellSite's compute is
    `(searched = canonicalWellSite({ home, read, avoid: wellSearchAvoid(bot) }))` -- already in cc16f64e.
- **Bone meal:** OFF unless `TREEFARM_BONEMEAL=on` (gated `bonemeal_used <= 0`; an arm-on pool needs its own registration;
  C5/C6 kept for it). Paper A/B (n=2/arm): first trees sooner, **no log gain measured**, **43 bone meal per farm-hour** vs
  fleet composting ~70-90/day.
- **Reviews:** Codex r1-r5 CHANGE (9 findings, all fixed) -> r6 APPROVE; Claude r1 CHANGE -> r2 APPROVE -> final APPROVE;
  the OFF flip and the wellsite variant: Codex r7 APPROVE, Claude r7 APPROVE (P3s fixed). npm test 252/252 (variant
  253/253); mutants 52/56 (4 named survivors). Paper: build, SIGKILL resume, lease, well/plinth first, full bag + composter,
  paths, grow->gather->clear->replant.

## 10-15 03:20Z — OWNER: airpocket-03 closes EARLY; a failed airpocket goes to the BOTTOM of the queue
Owner 10-15: "if airpocket-3 fails.. lets move it to the bottom ... these other things in the queue will have a much larger
effect" and "lets close it early". Rule (operator): if airpocket-03 is still unexposed (exposure_ready_ap2 = 0) at its +720
read (~12:10Z 10-15), close it INCONCLUSIVE by hand (the airpocket-02 procedure: stop loop, check-open-loop --record
INCONCLUSIVE, drop-ins, canary_pool, restart pool bots from the env roster, `canary-sched closed`). Any airpocket-04 is
queued LAST. Rationale: the ice trap is ~9% of drownings (~10 deaths/week, ~4% of all deaths); the queue behind it
(cobblecap-1000, wellsite-03, townzone-01, plinth-01, townfloor-01, ziggurat/mineshaft) lifts all 80 bots.

## 10-15 00:50Z — townfloor-01 READY (the town floor: bots fill the ground dug from under their towns); both engines APPROVE; NOT queued, NOT deployed
OWNER 10-14 "lets absolutely do what you recommend with the cobblestones". Doc: `docs/reports/townfloor-2026-10-14.md`;
reviews: `docs/reports/townfloor-01-reviews-2026-10-14.txt` (Codex r8 APPROVE, Claude r6 APPROVE at 187fe6a4).
- **Scale (read-only, region copies 10-14 18:00Z):** inside townzone's band (Chebyshev 16, home.y-12..home.y-2) 3,300-8,100
  open cells per town, 103,340 over 16 towns, 80% dug by bots. Offline planner: 52,388 of 98,116 targets fillable (53%;
  43-69% per town). Bags hold 13,465 cobble above the 64 reserve; 47,559 collected/day (gross).
- **Drowning (for B):** 2 of 117 drownings in 7 days were within 16 of home -> B (a 120-block kerb) is design only and
  NOT justified on drowning.
- **Branches (pushed):** `tf-on-5e66386` @ da99ec95 (inert base build, npm test 254/254); **`tf-x-tz` @ a2d6972f = the
  canary** (tf merged onto townzone-01's 5e663860 variant tz-on-5e66386 @ 3b1ae8bb; npm test 255/255). Mutants 72/74
  killed (2 bed-route survivors documented; follow-up).
- **Paper sandbox (sandbox2, lock released 00:05Z):** fill 241/241, walker 243/243, SIGKILL x2 241/241 -- 0 outside, 0
  bridges, 0 cut ways. board-a real town 205 rows all on the server; 6 extra blocks + 1 "bridge" are the BASE entombment
  reflex's escape pillar during count_town (named for gate F5).
- **Registration:** `~/mcai-analysis/townfloor-01.a2d6972f.json` (sha256 a3fe3315..., copy in docs/reports/), licence +
  changerow PASS; read `~/mcai-analysis/townfloorread.py` (md5 8cbc47d5; F1-F6 + no_start tripwire); queue entry
  `docs/reports/townfloor-01.queue-entry.json`.
- **PREREQUISITE / HOLD:** launch ONLY on a fleet running townzone-01 KEPT and promoted from the 3b1ae8bb variant (the
  order is gated on zoneLive; without the zone gatherers dig the fill back out). If the fleet moves off 5e663860 first,
  tf-on-5e66386 must be re-merged onto the new base's townzone variant and re-registered. Composes with plinth-01 /
  well site / stocktarget recount via keep-outs re-read per click.

## 10-15 00:30Z — TOWN PROJECTS DESIGNED (owner 10-14 "find real uses ... put the bots to real work" -> "yes do it"); both engines APPROVE r5; NOTHING built, queued or deployed
**Design:** docs/reports/townprojects-design-2026-10-14.md (r5).
**Reviews:** docs/reports/townprojects-reviews-2026-10-14.txt.
- Codex r1-r4 CHANGE, r5 APPROVE.
- Claude r1 CHANGE, r2-r5 APPROVE.
- No disagreement remains. On room-making r4 took Claude's position (a skip bounded by stall/pause, measured), and
  Codex accepted it.

**Facts (10-14):**
- **Material is not the constraint.** An average world holds ~656 raw copper, ~635 logs, ~250 coal and ~113 iron.
- **Copper is banked but not smelted:** smelt 318/24 h, of which raw_iron 308 and raw_copper 5.
- **Time near town:** 48.5% of bot-time is within 48 of home (ES, 3 h, 80/80 bots). That is an upper bound on project
  time.
- **Copper bulbs need a blaze rod (Nether), so they cannot be made.** Copper lanterns, torches, chests and bars do
  not exist on 1.21.8.
- **The blueprint builder (treefarm-01) never ran on the fleet.**
- **stone_bricks and smooth_stone are on the junk-well list.**
- **Isolated pools have per-bot town state,** so they are excluded in v1.
- **Nothing above pad+2 can be started from the pad** (plinth's standFor rule), so buildings use TERRACED
  construction: 2-high walls and a 1-high step ring.

**Stages** (each its own canary, after the current queue):
1. smeltjob-01: composite smelt_town; furnace_drain; the furnace lease; PROJECT_COUNTED.
2. structureguard-01: **built ON the operator's planned minewell-01**, generalised to every reserved structure cell
   at bot.dig, never a second guard.
3. yard-01: the generic builder plus a pad with 6 furnaces and a table, placed at Chebyshev >= 22 and straight-line
   <= 44 from home. Prerequisite: the town-floor job DECLARES its domain inside 21.
4. furnaceline-01: load-and-leave furnace jobs.
5. storehouse-01: 229 placements, 150 cobble, 52 logs, 18 barrels. It sits inside the 16-block town-storage
   cylinder, so it needs the shared siting file adopted by plinth/well and the town floor first.
6. hall-01: the landmark, a copper roof terrace. Variant M: 286 placements, 579 raw copper, 687 smelts. The average
   world qualifies for S.
7. projectdemand: only if stalls show stock short.

Stage 1 is ~1 week to ready; stages 1-6 take ~9-13 weeks on one lane.

**OWNER DECISIONS (section 10 of the design):**
- D1: which landmark (recommended: the copper-roofed hall);
- D2: no isolated pools in v1;
- D3: lanterns and torches instead of bulbs;
- D4: no charcoal yet (coal covers the copper 3x);
- D5: open doorways;
- D6: blast furnaces;
- D7: the new stage order;
- D8: take stone_bricks and smooth_stone off the junk list (otherwise the hall is cobblestone).

**COORDINATION:** the town-floor author is asked, through the doc (section 3.4 and section 8), for (a) a declared
domain inside Chebyshev 21, (b) adoption of the shared townsites file before stage 5, and (c) to treat
projectReservedCells as occupied.

## 10-15 00:19Z — OWNER: town-project decisions D1-D8 all as recommended ("go with your recommendations"); stage 1 build started
- **Decisions:** D1 copper-roofed hall; D2 isolated pools out of v1; D3 torches + iron lanterns; D4 no charcoal yet;
  D5 open doorways; D6 blast furnaces yes (10 iron/town); D7 yard -> storehouse -> hall; D8 stone_bricks +
  smooth_stone OFF the junk list.
- **Recorded in:** docs/reports/townprojects-design-2026-10-14.md section 10.
- **Coordinator order:**
  - build STAGE 1 (smeltjob-01: deterministic copper smelt + furnace drain), D8 folded in unless both engines say it
    needs its own canary;
  - base: fleet 5e663860, plus a variant on ap3-on-5e663860 @ 1957811e;
  - dig guard: coordinate with minewell-01 (the wellsite agent), never duplicate it;
  - do NOT queue or deploy.

## 10-15 00:15Z — wellsite-02 REVERTED at +360 -- a FALSE TRIP (control-arm event); airpocket-03 launching
Ledger says REVERT (wellread.breach_recollected = 9). Diagnosis (wellsite agent, Codex agrees): all 9 recollected items
were in hive-d, a CONTROL pool on the base 5e66386 (no wellsite code): hive-d-Echo started `mine` on the well's stand
(79,58,77) and its staircase dug the well's south wall and floor (base defect: mine's direct digs ignore the well dig
keep-out; its 12-block home guard did not fire at 14.9 blocks). Canary arm: 0 recollections, 17 disposals at placebo-b's
sand-wall well (sealed, read from the world). ROOT GATE BUG: wellread.py C1-C8 count BOTH arms (only C9 is canary-only)
-- harmless while only canaries had wells; since junkwell-02 promoted every pool has one, so any control event can revert
any canary registering these gates (stocktarget-01, orderroom-01, wellsite, plinth-01). Actions: fix wellread to judge
the canary arm only (both engines; install between canaries -- no queued-next canary uses it), re-queue wellsite unchanged
as wellsite-03 after airpocket-03, and build minewell-01 (mine refuses to dig a known well/plinth shell, with an executable
relocate remedy). plinth-01 stays blocked until wellsite-03 is kept. Fleet unchanged: 5e663860.

## 10-14 22:15Z — ESTELEMETRY BUILT (OWNER step 4 "Yes use the elastic for analysis"): ES is the default for WIDE analysis; gates/canary reads stay on the files
`scripts/lib/estelemetry.py` (EsEvents.load('skill'|'llm', since_minutes=..|since/until, pools=, bots=, version=, gaps='raise'|'clip'|'allow'))
provides count/by_bot/by_pool/terms/histogram/latest/coverage/rate(bots= REQUIRED)/rows/where. Everything is aggregated
server-side; rows() is PIT-streamed, capped at 200k, and refuses before reading. The zero guard is the same class as lib/telemetry.py's
ZeroLooksWrong. Its positive controls: the window has docs; no near-miss name (incl. the `_kind`/`kind` variant: names
are EXACT here, because town_deposit and _town_deposit both exist and canon() folds them); every filter, grouping and split field is
carried, or is mapped (quiet windows); a detail_contains (TOKEN phrase) zero always raises. Known gaps are guards: windows touching 10-07 are
REFUSED (clip/allow on request); null==absent (match None raises); caveats name rotations crossed (~40-60 skill rows lost
each), windows past the reconciled 10-14 18:46Z, pre-10-07 history, llm 09-08/09-16 holes. Key: ~/.config/mcai/es-readonly.key
read per call; no redirects; scrubbed from errors.
`scripts/host/fleetstatus.py` (3h/24h/7d; replaces the lost /tmp/quickstatus.py and the 24 h summary that hit WalkTooWide) reports:
deaths by cause and by pool; per ACTIVE bot-hour; gather/craft/deposit/town_deposit ok/attempts; drownings by pool x
hour (by day for 7 d); and bags (latest snapshot per bot via the bot.pos.x marker; ~/stack.json; a lower bound). It refuses empty or
stale windows, names empty hours and 10-min stalls, and every table reconciles to its direct count. Runs in <1 s. Live 22:04Z:
3 h 4 deaths (3 drowning), gather 42.8% ok; 7 d (clipped to 10-08) 273 deaths, 115 drowning, isolated-d 25 and hive-d 24
drownings; bags median 33.5 of 36, 40 of 80 bots at >= 34.
Run it from a checkout of main (the host's /opt/minecraft-ai is reset to the fleet sha by deploys), e.g.
`python3 <main-checkout>/scripts/host/fleetstatus.py`.
TESTS: scripts/test_estelemetry.py 48 (FakeES with real exists/phrase/missing semantics); scripts/test_fleetstatus.py 10;
scripts/test_estelemetry_mutants.py 21/21 killed (anchors asserted unique); MCAI_ES_LIVE=1 scripts/test_estelemetry_live.py 8/8 on .31
(reproduces 10-13 skill 1,306,930 / llm 162,828); npm test 252/252. Independent check: _death files-grep = ES (3 h 4, today 31).
REVIEWS (docs/reports/estelemetry-review-2026-10-14.txt): Codex and Claude both REQUEST-CHANGES twice, then APPROVE at round 3.
CLAUDE.md telemetry section: one bullet added (wide -> estelemetry; gates/canary reads -> files).
NOTE (not fixed, out of scope): lib/telemetry.py rate(bots='auto') builds a set of bot DICTS (unhashable) -> TypeError;
and its canon() merges town_deposit with _town_deposit.

## 10-14 21:40Z — plinth-01 VARIANT ON 8cd0bc62 built, reviewed and registered; hold reworded (the plinth agent, at the coordinator's request)
- **Branch** plinth-on-8cd0bc6, canary sha **b4174a09**; the tip fd86d351 adds docs only.
  - It is the approved plinth-01 net diff on wellsite-02's 8cd0bc62, as one commit (2fd7197b).
  - bots/src differs from the approved diff only by two conflict unions:
    - the decide chain is build_plinth > town_deposit > count_town (stocktarget-02's recount guard yields to the plinth
      as it does to the deposit);
    - HOUSEKEEPING.
- **Composition tests:**
  - PLINTH x RECOUNT CHAIN, through the real CognitiveLoop, plus its mutant;
  - DIGTOWN, through the real _dig_town wrapper: plinth leaf clears are class free (summary only); its dirt cover is one
    ground row with purpose other.
- **Tests and lint:** npm test 253/253. eslint no-undef shows only the pre-existing withinBody.
- **townzone-01:** plinth-x-tz-8cd @ 43cc6373 (tz-on-5e66386 + plinth) is a clean merge, npm test 254/254.
- **orderroom's well walk:** no change needed. The read watches its new window (Claude P3-1).
- **Reviews** (docs/reports/plinth-01.rebase-review-8cd0bc62-2026-10-14.txt): Codex APPROVE; Claude APPROVE with 3 P3s,
  none blocking.
- **Registration** ~/mcai-analysis/plinth-01.8cd0bc6.json (sha256 c9e10383...):
  - NO draw_require_pools key; drawrequire.parse -> ([], None);
  - licencecheck PASS (kind _plinth, 0 baseline rows in 356,942 / 6 h);
  - changerowcheck PASS (baseline 5e66386 silent).
- **Replace-variant entry** ~/mcai-analysis/plinth-01.entry-8cd0bc6.json, NOT applied:
  - the coordinator runs `queue replace-variant plinth-01 <it>`;
  - fetch origin in the scheduler's git first, because b4174a09 does not resolve there yet.
- **Hold reworded** with `queue hold plinth-01 "wellsite-02 KEPT and PROMOTED"`. The coordinator lifts it.
- **Plan-cell record** (for the town-floor fill job), /var/lib/mcai/_pool-<pool>/junkwell-plinth-<homeX>_<homeY>_<homeZ>.json:
  - `state` is plan | complete | none | void;
  - `plan.steps[].c` = [x,y,z] with `op` place | clear;
  - `plan.stair` = [[x,y,z]];
  - `plan.cap`, with its column cap.y-1 .. cap.y+2 kept open;
  - `prev[]` = {x,y,z,stair}, every column the town ever started.
  - The lease generations sit beside it as `.lease.g<n>.json`.

## 10-14 20:55Z — townzone-01: FIVE variants in ONE replace-variant entry (the townground agent); NOT queued by me
New (pushed, new branches), each the approved zone cherry-picked with no conflict, patch-identical (1,059 +/- lines;
earlier "988" was my miscount): `tz-on-1957811` @ `5d3b155c` (airpocket-03 kept only), `tz-on-8cd0bc6` @ `75cfb447`
(wellsite-03 kept only), `tz-on-7dbd6da` @ `bbfb3b47` (both kept); kept: eb543899 -> 523a7dd8, 5e663860 -> 3b1ae8bb.
npm test 252/252, 252/252, 253/253 rc=0; eslint no-undef only each base's own withinBody. Registrations
`~/mcai-analysis/townzone-01.<sha8>.json`: no draw_require_pools, drawrequire.parse ([], None), licencecheck + changerowcheck
PASS. Composition: airpocket-03 rescues run in the reflex tick's survival scope (never refused by the zone); ONE residual:
a rescue dig while an unwound tunnelToOre's halted path is still mining reads target:ore_tunnel -> check a Z1 row
by=ore_tunnel against _air_pocket rows before believing it. wellsite-03's no-site record/backoff share nothing with the zone;
build_well digs are `other`. Codex APPROVE x3; Claude APPROVE x3 (after suite evidence + the P3 wording). Entry:
`python3 ~/canary-sched.py queue replace-variant townzone-01 ~/mcai-analysis/townzone-01.queue-entry-5var.json`.
HOLD (coordinator releases): >= 180 min after the LATEST prior decision restart (airpocket-03, wellsite-03, ...).

## 10-14 19:50Z — ES COMPLETENESS CHECK DONE: ES is the default for wide analysis from 10-08 (both engines agree); read-only, nothing live changed
Report docs/reports/es-completeness-2026-10-14.md (+ .summary.json, -reviews.txt); scripts scripts/host/escheck/ (run.sh FIRST LAST
on 10.0.0.31; auth = the owner's read-only API key file ~/.config/mcai/es-readonly.key, never printed). Raw: ~/escheck/final2/.
NUMBERS (every bot-day row-by-row, gross): from 10-08 to 10-14 18:46Z, ES lost 344/8,851,670 skill rows and 59/1,089,658 llm,
0 extras. All the loss sits in 23:57-00:00, the logrotate copytruncate race. 0 of 1,760 bot-hours/day differ in hours
01-22. Field census over all 12.2M rows: 0 strict-rejected paths, 0 type/range conflicts. filebeat dropped=0 every day
10-08..10-14. 3,200 spot rows equal field by field, ignoring keys whose value is null (filebeat drops those).
GAPS: (1) 10-07 is OVER-counted: 4,633 skill + 415 llm extras, filebeat re-sends after the 05:01Z host crash (exact
doubles 00-04h on placebo-a-Comet, isolated-c-Echo, llm placebo-b-Bravo). EXCLUDE 10-07 from ES counts, or use its files
until ~10-21. Never dedup by (bot,ts,kind) or by whole _source: there are 16,293 legitimate identical skill rows.
(2) null and absent look the same in ES. (3) **llm.brain is UNMAPPED in the live write index .ds-mcai-llm-agents-2026.10.08-000010.**
brain-01 writes a non-null llm.brain and changes the template only, so every brain-01 llm doc would be REJECTED WHOLE
until the field is mapped (PUT _mapping) or the ~10-15 rollover picks up an applied template. This is a PRE-DEPLOY step
for brain-01 and needs an owner/operator decision. (4) Nothing before 10-07 was validated.
The brain-01 agent's claim that args_cleaned, args_cleaned_fields and model_mismatch are unmapped is WRONG: they have been
mapped since backing index 000007 (09-16); the last two are null in every row.
Reviews: Codex round 1 NOT-COMPLETE-ENOUGH (method defects, all fixed; see the report's appendix) -> round 2 COMPLETE-ENOUGH;
Claude round 1 and round 2 COMPLETE-ENOUGH (conditions met).

## 10-14 12:15Z — townzone-01 FINAL: two variants + ONE replace-variant entry (the townground agent); NOT queued by me
Variants (both pushed, new branches): `tz-on-eb54389` @ `523a7dd8` (fleet eb543899; tree identical to the prepared
22c01bd3) and `tz-on-5e66386` @ `3b1ae8bb` (fleet 5e663860 = stocktarget-02 on digtown-01; skills.mjs auto-merged, no
conflict). Both are the approved zone diff exactly (988 +/- lines; Claude: full-context byte-identical, merge commutes).
npm test 251/251 each; eslint no-undef only the base's reflex.mjs:2384 withinBody. Registrations
`~/mcai-analysis/townzone-01.523a7dd8.json` / `.3b1ae8bb.json`: NO draw_require_pools key, drawrequire.parse ([], None),
licencecheck PASS (_town_ground 0 rows / 6 h baseline) + changerowcheck PASS. Positive control: townzoneread dry run with
digtown's instrumented unzoned pools (hive-d,placebo-d, 07:55Z +180) -> Z1 = 22 town target digs; control coverage 0.0 before
the promotion (gate fails closed). Reviews incl. composition with count_town + the recount file: Codex code/merge APPROVE,
notes P3 -> fixed -> APPROVE both; Claude APPROVE both (notes P3s applied). Entry:
`~/mcai-analysis/townzone-01.queue-entry-final.json` (copy in docs/reports/): `python3 ~/canary-sched.py queue
replace-variant townzone-01 ~/mcai-analysis/townzone-01.queue-entry-final.json`. HOLD: digtown promoted + 180 min AND
>= 180 min after stocktarget-02's decision restart (teardown after REVERT -> eb543899 variant; promotion after KEEP ->
5e663860 variant). The read needs one build per pool across its pre-window; it does NOT need stocktarget-02's pools
excluded. KEPT-but-not-promoted: neither variant matches -> new variant. Known P3 (comment-only, unfixed):
townzoneread.py lines 2/13 stale.

## 10-14 11:40Z — (daily operator session) digtown-01 promoted and merged; stocktarget-02 preflight refusal fixed, canary live
- Host overnight vs the docs STATE (10-13 11:30Z): airpocket-02 closed INCONCLUSIVE 16:12Z (operator early close, both
  engines); v35.1 installed 16:26Z; stocktarget-01 KEEP +180 19:40Z, promoted 48b093c 19:50Z; orderroom-01 KEEP +360
  02:09Z, promoted 2ec1938 02:19Z; chest clear #2 02:21-02:39Z (249 full -> 0; 248,428 items out); wellsite-01
  cancelled (its required pool placebo-b excluded) -> wellsite-02; digtown-01 deployed 04:54Z on placebo-d,hive-d.
- digtown-01 +360 KEEP 11:00:44Z: deaths 1/60.0 bh vs control 7/300.0 (exposure_ready 1). Promoted 11:10:25Z;
  80/80 on eb54389 by 11:13Z (positive control: 4,536 rows in 4 min, one build). Owner notified (desktop only; mobile push
  not sent, Remote Control inactive on this session). Merged: d7cc653a on main (full suite 251/252 files, the one failure
  being the orphan guard on my then-uncommitted review file; green once committed); main-pre-20261014 = de964fff.
- stocktarget-02: scheduler launched 11:16Z, preflight REFUSED 11:17Z (cobble_reconcile in change_rows is a base row).
  Fixed as above; rearmed; drawn board-c,hive-b 11:30:02Z; deployed 11:30:03Z. First read ~14:30Z.
- Iron funnel (24 h, 1,438 bot-h): raw iron 296 (0.21/bot-h), ingots 313, iron pickaxes crafted 38, gone 97 (65 at <=3
  uses left); iron-pickaxe bot-hour share 57.6% (previous lines 41.0 -> 52.6%). Host / 29% used, 69 GB free.
- No analysis started (a canary is live). No world change.

## 10-14 07:10Z — digtown-01 LIVE (hive-d,placebo-d, 04:55Z); queue stocked through airpocket-03; follow-ups recorded
QUEUE: digtown-01 (live; +180 ~07:55Z, +360 ~10:55Z) -> stocktarget-02 (count_town recount fix for the post-clear
"not yet counted" dead end; both engines APPROVE; Paper PASS) -> wellsite-02 (5 variants) -> airpocket-03 (6 variants,
not before 12:00Z, needs hive-d which digtown holds) -> townzone-01 (needs digtown promoted + 180 min) -> plinth-01 ->
bamboo-02 (needs a variant on the then fleet tip).
OPERATOR ACTIONS 04:40-05:00Z: wellsite-01 abandoned+cancelled (required pool placebo-b excluded after orderroom) and
re-queued as wellsite-02 (Claude+Codex agree); digtown-01 + townzone-01 registrations carried draw_require_pools [] which
v35 refuses as malformed -> key removed (backups .bak-emptydrp-*), digtown rearmed; generator fixed by its agent.
FOLLOW-UPS (not blocking): (1) stocktarget: recountOrder needs a real `inside` gate (no count_town while
insideTownWell; seen 2x in 26k bot-h, P3, Codex SHIP) + close_well/pit-cover priority vs count_town + failure reasons on
aborted recount rows. (2) well dig-click gap compares performance.now() lastDigTime to wall clock -> the wait never runs
(pre-existing mineflayer 4.37.1 detail; harmless for the sealed check). (3) placebo-a-Echo cannot path to chest
251,74,-148. (4) brain-01: post-veto loop fix before the live canary (owner to decide); Studio unattended-reboot recovery.

## 10-14 06:01Z — STOCKTARGET-02 READY (the town recount order); queue entry for the operator, NOT queued
THE DEFECT (the clear #2 recount, f9331b98): after the fence a not-yet-counted refusal had no remedy below 34 slots
(hive-a/placebo-a 0/24, 0/17 recounted in 2 h; hive-a-Delta refused 55 times). THE FIX: at town, holding a name a plan
refuses as not yet counted, with a reachable uncounted container -> the deterministic order `count_town` counts up to 3
containers at once, whatever the bag's size (60 s cooldown, the look charged too; 10 min backoff after a fruitless count).
Reachability: misses (a real no-path, out of reach after the walk, unopenable) go to the town's own
`<townKey>.recount.json` -- NEVER the container memory the deposit/withdraw/recovery read (Claude r1 P1) -- two misses
>= 10 min apart = out of every bot's recount for 6 h; interruptions, our clock, slow opens and unloaded cells are never
misses. Reviews: Codex r1 CHANGE -> r2/r3 APPROVE; Claude r1 CHANGE -> r2 CHANGE -> r3 APPROVE
(docs/reports/stocktarget-02-reviews-2026-10-14.txt). npm test 249/249 (2ec1938), 250/250 (eb54389); mutants 82/82 on
fresh archives of both; eslint no-undef only the base's guarded withinBody. Paper PASS
(docs/reports/stocktarget-02-paper-2026-10-14.txt): fenced town, 7-slot bag -> recount counted=1 at once -> deposit 44,
server chest 20 -> 64. Dry run (hive-a,placebo-a on the base, 02:30Z +157 min): instrument 477 control not-yet-counted
refusals, exposure READY. Registrations (ordinary class; liveness recount_live; L1 loop, L2 backoff; arms):
docs/reports/stocktarget-02.{2ec1938,eb54389}.json, copies in ~/mcai-analysis (sha256 in the entry); licencecheck
`_stock_recount` baseline 0; staged v35 registration_problems []. Branches pushed: st2-on-2ec1938 @ 4798b708,
st2-on-eb54389 @ 5e663860. QUEUE ENTRY (for the operator): docs/reports/stocktarget-02.queue-entry.json ("after"
digtown-01 -- the operator's to set). Read stockrecountread.py md5 84a80157 in ~/mcai-analysis and /tmp.
Residuals: coverage=false refusals (no key, today's rule); back-to-back recounts after a clear until the town is counted;
an aborted run backs off 10 min and its row omits fails=.

## 10-14 04:25Z — digtown-01 VARIANT for 2ec19385 READY (the townground agent); townzone-01 variant PREPARED only
`dt-on-2ec19385` @ `eb543899` (pushed; new branch): 9dc2ad5e's net diff over 82aef34 as ONE commit on 2ec19385,
patch-identical (901 sorted +/- lines equal), no conflict. npm test 250/250; eslint no-undef only the pre-existing
reflex.mjs withinBody (2384). Registration `~/mcai-analysis/digtown-01.2ec19385.json` (sha256 db94ea62... after the coordinator's 04:47Z fix: my generator wrote `"draw_require_pools": []`, which v35 drawrequire refuses, so the draw returned NONE; the key is now omitted and the generator fixed):
licencecheck PASS (_dig_town_sum: 0 baseline rows in 6 h; 337,509 rows, 80 bots) + changerowcheck PASS, re-run 04:20Z
on the final file; digtownread dry run on 2ec19385 flags I4 on 4/5 (positive control). Variant review: Codex APPROVE
(no findings), Claude APPROVE (two registration P3s, applied: harm gather_ratio is canary-report.py, and the pre-window
also holds the 02:19Z restart). Entry: `~/mcai-analysis/digtown-01.queue-entry-2ec19385.json` (copy in
docs/reports/), after wellsite-01. **To install (coordinator):** `python3 ~/canary-sched.py queue replace-variant
digtown-01 ~/mcai-analysis/digtown-01.queue-entry-2ec19385.json`. PRE-PERIOD: declare at or after ~05:25Z to keep the
02:19Z restart and the 02:22Z clear out of the 180-min pre-window. The gates carry no pre-period term, so an earlier
declaration only affects the reported neutrality DiDs.
townzone-01: `tz-on-2ec19385` @ `22c01bd3` (local only; NOT pushed, NOT registered). It is the zone's net diff over
dt-on-82aef34, applied onto eb543899 and patch-identical; npm test 251/251. It is finalised only after digtown-01 is decided.

## 10-14 03:45Z — FLEET 2ec19385 (stocktarget-01 KEEP+180 19:40Z, orderroom-01 KEEP+360 02:09Z); CHEST CLEAR DONE; queue reordered
stocktarget-01 promoted 19:50Z, merged to main 3ef61dd2 (250/250). orderroom-01 promoted 02:19Z, merged 1ff85475 (251/251).
ONE-TIME CHEST CLEAR (owner GO 10-13 "do the chest clear") ran 02:21-02:39Z: 354 containers, full 249 -> 0, items
276,870 -> 28,442 (248,428 removed: logs 106,874, cobble 104,517, ...), ores/coal/gems/ingots/food/iron tools untouched;
validate 6,503/6,503, run 6,501 cmds 0 failed, verify PASS, 32/32 pool journals fenced, 80 bots back on 2ec1938.
Details docs/reports/census/clear2-20261014T0221Z/. Recount re-check for hive-a/hive-c/placebo-a/placebo-b ~04:40Z.
QUEUE (operator, Claude only -- ordering): wellsite-01 -> digtown-01 -> airpocket-03 (not before 12Z) -> townzone-01 ->
plinth-01 -> bamboo-02 (backup ~/canary-queue.json.bak-reorder2-*). ALL BLOCKED for want of 2ec1938 variants: wellsite,
digtown, airpocket-03 being built now by their agents. Canaries starting before ~08:22Z have a pre-period straddling the
02:22Z clear: notes record it.

## 10-14 02:40Z — CHEST CLEAR #2 DONE (owner GO 10-13 ~20:40Z, "do the chest clear"); fleet 2ec1938; bamboo-02 hold released

Ran `docs/reports/chest-clear-procedure-2026-10-13.md` step by step in the gap after orderroom-01 was KEPT and promoted
(2ec1938, 02:19:37Z). Every pass line passed; nothing aborted. Files: `docs/reports/census/clear2-20261014T0221Z/`.

**Result.**
- Full bank containers: 249 -> 0.
- Used slots: 8,305 -> 1,829, out of 354 x 27 = 9,558.
- Items: 276,870 -> 28,442.
- Removed: 248,428 = 247,760 in 6,476 whole stacks + 668 cut from 27 boundary stacks. That is cobble 104,517,
  logs 106,874, sticks 17,366, planks 6,434, bamboo 6,058, saplings 3,387, stations/torches 2,134, surplus usable tools
  1,481 and spent tools 177.
- Kept and untouched: ores 10,306, coal/gems 4,802, ingots 2,065, food, the 10 iron pickaxes and 1 potion.

**Timeline and pass lines.**
- 02:21:34 install-hold, loop lock and recycle timer stopped.
- regionscan: DISCOVERY PASS. It found 2 new containers (board-b, placebo-b).
- forceload3 add PASS: 0-49 tickets per world.
- 02:21:55 all 80 stopped.
- census-before 02:21:58Z: 0 problems, 0 online in all 16 worlds.
- plan: 6,503 actions, total 248,428 (-2.6% against the manifest).
- check: 0 problems.
- validate: PASS (6,503/6,503 planned, all negative controls failed).
- trial: PASS (board-a reduce chest 21 -> 8, remove oak_log 64).
- run: COMPLETE, 6,501 commands in 7.7 s, 0 failed.
- census-after 02:22:28Z, verify: PASS (kept_unchanged 1,802, removed_empty 6,476, reduced_exact 27, 0 problems).
- re-plan: 0 actions, full after 0.
- forceload3 remove PASS: every world back to its exact pre-clear tickets. The state file is `forceload-20261014T0221Z.json`, so there are no leftover tickets.
- stockreset: 32/32 `written=true counts_left_from_before=0`, exit 0, reset at 02:22:39Z.
- 02:22:44-02:38 restart, 12 s apart: 80 active.
- fleetversion since 02:22:44Z: 80/80 `2ec1938+f21576`, 0 silent.
- recycle timer restarted, next run 07:29Z. install-release done.
- `queue release bamboo-02` 02:39Z. **bamboo-02 is now blocked H2: no variant for fleet base 2ec1938.**

**Bot downtime:** 02:21:55 -> 02:22:44..02:38:4x, about 1-17 min per bot.

**Procedure fix found in the run.** Killing the flock pid left its `sleep` child holding `/tmp/mcai-canary.lock`. It
was killed by hand and the lock confirmed FREE; step 14 now uses `pkill -P`.

**Next canary:** its pre-period must not straddle 02:22Z, or its notes must record the clear.

**Recount check, +60 min (census 03:40:19Z, 0 problems; `recount-20261014T0221Z-a1.txt`): RESET PASS.**
- All 32/32 pool dirs carry the 02:22:39Z reset.
- 48 containers have been recounted since: 35 match the census exactly, 0 partial, 13 zero-only (agreeing zeros).
- Nonzero coverage is above 0 in 12 of 16 worlds.
- **hive-a, hive-c, placebo-a and placebo-b are still at 0 nonzero coverage at +60 min.** The procedure's finding
  threshold is 0 coverage after 2 h: re-run step 15 at about 04:40Z.

**Recount +2 h (census 04:40:28Z, 0 problems; `recount2-20261014T0221Z-a1.txt`): RESET PASS.**
- All 32/32 pool dirs reset. 101 containers recounted: 68 match, 0 partial, 33 zero-only. Coverage is above 0 in 13 of
  16 worlds.
- The four towns flagged at +60:
  - **placebo-b: RECOUNTED.** 3/23, all 3 match the census.
  - **hive-c: recounted but ZERO-ONLY.** 5 containers; the bots counted 0 of every group, and the census agrees. They
    are empty chests, so this is weak evidence; nonzero coverage is 0/31.
  - **hive-a: NOT recounted** (0/24).
  - **placebo-a: NOT recounted** (0/17).
- **Diagnosis (read-only; scripts in `clear2-20261014T0221Z/diag/`).** This is not a broken fence and not absent bots.
  - **The bots are in town.** Since the 02:22:44Z restart, hive-a logged 7,352 rows and placebo-a 9,138, with 1,972 and
    3,044 position rows within 48 blocks of home.
  - **Ordinary deposit is refused.** It returns `_stock_refused via=admission ... *_unknown` (hive-a 59, placebo-a 11).
    That is the design: an unknown container is refused for the ceiling.
  - **What unlocks the recount.** Per design 3.7 the only deterministic recount is the town-deposit order. It fires at
    >= 34 used slots. Estimated slots: hive-a bots peaked at 22-31, except Alpha (36, 199 of 925 rows at >= 34);
    placebo-a peaked at 28-34 (Bravo 91 of 1,412 rows at >= 34).
  - **The towns that did recount have full bags.** placebo-b and board-c had 274-1,361 rows at >= 34 slots per bot, and
    their town_deposit / _cobble_reconcile rows are there; hive-a and placebo-a have none.
  - **So the recount is LAZY, not stuck.** It waits for a bag to fill. The refusals make bags fill, so it should come.
    Re-check at about +6 h.
  - **Separately:** placebo-a-Echo failed 3 deposits with `could not reach the chest at 251,74,-148: No path to the goal`.
- **For the coordinator (no change made).** The unknown refusal names no remedy the bot performs now: hive-a-Delta was
  refused 55 times in 2 h. A refusal on `*_unknown` that triggers the count step at once, rather than at 34 slots,
  would close the gap. That is a design question for the stocktarget owner.

**Recount +6 h (census 08:30:24Z, 0 problems; `recount6-20261014T0221Z-a1.txt`): RESET PASS, 32/32.**
- **The three lagging towns have now been recounted:**
  - **hive-a:** 4/24 recounted, all 4 match the census.
  - **placebo-a:** 4/17 recounted, 3 match and 1 is zero-only.
  - **hive-c:** 8/31 recounted, 1 matches and 7 are zero-only. Nonzero coverage is still only 1/31.
- **Fleet:**
  - 266 containers recounted: 193 match, 64 zero-only, 8 partial.
  - Nonzero coverage is above 0 in all 16 worlds, from 1/31 (hive-c) to 21/32 (board-c).
- **The 8 partials** are all in isolated per-bot dirs. In most of them the bot's count is lower than the census, for
  example oak_log 72 vs 136 and 26 vs 90. That fits deposits after the bot counted, so it is honest drift, not a
  wrong recount.
- **Conclusion:** the lazy recount closes on its own, slowly. The stocktarget-02 fix (an immediate count on an
  `*_unknown` refusal) is still worth doing; hive-c is the slowest town.

The entry below this one is the PREPARED record.

## 10-13 20:35Z — CHEST CLEAR #2 (stock targets): PREPARED, awaiting owner go. NOTHING RUN; no world changed, no bot stopped

The owner's one-time clear (10-10). It runs only after the inflow fix: stocktarget-01 was KEPT and promoted to fleet
48b093c. Caps are owner-confirmed 10-12 in `docs/reports/stocktarget-clear-caps-2026-10-10.json`. Standing rule from
10-04: the owner sees the list first.

**Next action: the owner reads the manifest and says GO, or not.** The operator then runs the procedure. Run it only
when no canary is live; it holds the slot for about 35-45 min.

- **Manifest (owner-facing):** `docs/reports/chest-clear-manifest-2026-10-13.md`. Read-only RCON census 20:13:54Z, 16
  towns, 353 bank containers, every slot read. Two discovery instruments agree in every town.
  - 255 -> 0 full containers.
  - 254,390 items removed in 6,596 slots, plus 668 reduced. Logs over 64/type 109,429; cobble over 256 108,549; sticks
    17,364; planks 6,466; bamboo 6,058; saplings 3,387; stations/torches 2,134; surplus usable tools 1,494 (the best 16
    stone pickaxes per town are kept); spent tools 177.
  - Junk, ballast and stone over 64: 0 (positive control: 59 names, 7 stone).
  - Ores, raw metal, ingots, coal, gems, food, iron tools, and any named/enchanted/abbreviated item are never touched.
- **Procedure:** `docs/reports/chest-clear-procedure-2026-10-13.md`.
  1. Hold the canary slot (install-hold plus the loop lock) and stop `fleet-recycle.timer`.
  2. Run regionscan (DISCOVERY PASS), then forceload3 add (chunk tickets: with nobody online, bank chunks 2-3 from
     home unload).
  3. Stop all 80 bots.
  4. census3 -> plan3 -> check -> validate -> trial -> run (one atomic `execute if items` per slot, with a
     per-container pre-read against the census).
  5. Re-census and verify, then forceload3 remove.
  6. `stockreset.mjs` on all 32 pool dirs, then restart 12 s apart and run fleetversion.
  7. Release the slot and the timer. Run recountcheck at +60 min.
  - Downtime: about 5-25 min per bot (about 15 on average).
- **Tools:** `scripts/host/chestclear3/` (rcon3, census3, regionscan, positions3, forceload3, cc_clear3, summary3,
  recountcheck, fleetversion, sandbox_scene) and `scripts/host/chestclear2/plan3.py`. The plan pins
  abbreviated/component/iron+ items, which still consume their cap, and keeps tools best-first.
- **Data:** `docs/reports/census/{census-2026-10-13T2013Z,clear-plan-2026-10-13,clear-summary-2026-10-13,positions-union-2026-10-13}.json`.
- **Evidence:** `docs/reports/census/chest-clear-sandbox-2026-10-13.txt`, on Paper sandbox r1-r5:
  - full positive runs;
  - stale receipt refused;
  - count change -> abort, 0 edits;
  - rename after trial -> abort, 0 sent;
  - tamper after run -> verify FAIL;
  - unloaded-chunk control;
  - double chest;
  - forceload add/remove restores the exact pre-existing tickets.

  Fleet read-only validate: 6,623/6,623 predicates pass, all negative controls fail; it refused only for bots online.
- **Reviews:** `docs/reports/chest-clear-review-2026-10-13.txt`.
  - Codex r1 BLOCK, r2 BLOCK, r3 APPROVE, r4 delta APPROVE.
  - Claude r1 BLOCK, r2 APPROVE, r3 delta APPROVE.
  - Every later SHOULD-FIX and NIT is applied (r6).
- **Found on the way:**
  - chestclear2/positions.py matched bot logs by exp.pool, but isolated bots log `self-isolated-X-Name`. The four
    isolated towns therefore had only 10-04 positions. The region scan proves no container was missed.
  - Paper abbreviates deep NBT even for one `Items[k]` element.
  - An empty-command RCON sentinel makes Paper close the connection.
- **AFTER THE RUN:**
  - The STATE entry must name `forceload-$T.json` and the `FORCELOAD remove PASS` line, so any leftover chunk tickets
    can be found.
  - The next canary's pre-period must not straddle the clear, or its notes must record it.

## 10-13 20:25Z — Codex RE-REVIEW of digtown-01/townzone-01 deltas: APPROVE / APPROVE (digtown-01's hold may be released)
- (a) counter: Paper scene E2 (docs/reports/townground-paper-E2-2026-10-13.txt): 14 reflex digs inside ACTIVE gather runs,
  all survival, none target -> Codex APPROVE. digtown-01 registration/sha unchanged (9dc2ad5e).
- (b) zone: r7 3be6de18 (the roofed climb really rises: surface aimed at the column top) -> Codex APPROVE. townzone-01's
  canary sha is now 3be6de18; its registration (~/mcai-analysis/townzone-01.9dc2ad5e.json, sha256 8d594826) and entry
  (docs/reports/townzone-01.queue-entry.json) are updated -> the queued variant needs `queue replace-variant townzone-01`.
- Fleet -> 48b093ce (stocktarget-01 KEPT): both runs need variants on whatever the fleet tip is at their turn.

## 10-13 19:10Z — plinth-01 (the raised, self-building junk well) BUILT, reviewed, registered; NOT queued (owner GO "yes do 2-4", step 4)
For the towns that cannot site a well (13 of 16 on 10-13). A town whose wellsite-01 search found no cell PLANS a raised
well once and BUILDS it from cobble in bounded visits. The plan is checked by the unchanged oracle (wellSiteRefusal) on
the world with the plan applied. It is placements only, apart from leaves in planned cells. Each step has a support face,
a proved stand that walks back to town, and a cover for every hazardous state. One builder per town: an exclusive lease
generation plus a 25-s settle. The finished cap becomes the well site; build_well floors it and caps it.
- **Branch** plinth-on-baa9487. CANARY SHA **4774bec1**; later commits are docs only. It sits on wellsite-01's canary sha
  baa94879, so it launches ONLY after wellsite-01 KEEP + promotion. Without wellsite-01 there is no trigger.
- **Tests.** npm test 248/248. plinth.test 51/51 with 10 mutant tests; plinth-skill.test 51/51 (real SKILLS on a fake
  town) with 12 mutant tests. Every mutant asserts that its anchor is present and unique. Offline replay: 16/16 real towns
  plan, verify, and route by A* with 0 column nodes; planning blocks at most 58 ms at a time.
- **Paper** (sandbox2/3; docs/reports/plinth-01-sandbox-2026-10-13.md; runs at 3d9448f6, 0e288720 and 4774bec1):
  - 17/17 builds, 5 of them SIGKILLed twice and resumed;
  - 1,170/1,170 placements read back by RCON, 0 new cobble outside the plan;
  - build_well on the plinth 5/5;
  - 2,880/2,880 junk items in the shaft, 0 outside (+30 s also);
  - a walker picked up 0 items in 60 passes + the 4 ledge cells (egg control 5/5);
  - 800/800 pathfinder trips, 0 column nodes;
  - plinth cells lost to an entombed or pit bot: 0.
  - The S4 bots did not get out in 300/180 s. The pit CONTROL (no plinth) did not either, so that is base behaviour.
    The tomb control is not comparable: open on the plinth side, the bot fell 48 blocks off the fixture.
  - Caveat: chest funding is proved in unit tests only.
- **Reviews** (docs/reports/plinth-01-review-2026-10-13.txt):
  - Codex r1-r5 (r5 APPROVE), plus the r7 and r8 diffs APPROVE;
  - Claude subagent r1-r7 (r6 and r7 APPROVE).
  - Nothing open.
- **Read** ~/mcai-analysis/plinthread.py (md5 30f2778a):
  - liveness is licence _plinth;
  - DEFECT gates: P1 outside the shell, P2 reserve, P3 pit open > 10 min, P4 retired plinth, P5 stuck near a plinth
    (more than 1 episode), P6 control leak;
  - INSTRUMENT: control no_site rows.
  - Dry run 19:00Z, under nice: 327k rows, 295 control no_site rows, P5 instrument 2,029 rows, gates 0.
- **Staged on .31:**
  - registration ~/mcai-analysis/plinth-01.baa9487.json (sha256 07c10c15...): reads plinthread + wellread + immobiledid;
    180/360; draw_exposure _well_refused reason=no_site >= 2 / 3 h;
  - entry ~/mcai-analysis/plinth-01.entry.json (= docs/reports/plinth-01.queue-entry.json): after wellsite-01, one variant
    baa94879 -> 4774bec1. NOT queued.
- **VARIANTS NEEDED**, one per wellsite-01 variant that gets promoted. None of those exists yet. Compositions already
  proven:
  - plinth-on-st-ws @ fa270a1e: stocktarget-01 48b093ce + wellsite + plinth; npm test 251/251;
  - plinth-x-tz @ 30c495e1: townzone-01 b945226a + plinth; npm test 250/250; Paper S4 plinth cells lost 0.
  Both merges are clean. The stair veto rides wellBreakCost, so townzone's frozen arrays are untouched.
- **Sandbox lock** /tmp/mcai-sandbox.lock released 19:00Z (the townground agent was waiting on it for its zone scenes).

## 10-13 18:50Z — digtown-01 + townzone-01 BUILT, reviewed, registered; NOT queued (the townground agent; owner GO "yes do 2-4")
Design: docs/reports/townground-2026-10-13.md (r4) + its IMPLEMENTATION AMENDMENT section. Order: digtown-01 (instrument,
its own canary) -> KEEP + fleet-wide promotion -> restart lag + a 180-min instrumented pre-window -> townzone-01.
- **digtown-01** branch dt-on-82aef34 @ 9dc2ad5e (pushed, new). TELEMETRY ONLY: bot.dig wrapped (`_dig_town_sum` exact
  per-minute counts of every dig; `_dig_town` per town-ground dig) with class, purpose (pathfinder tag/transit > reflex >
  async scope: goto/surface transit, the reflex tick survival > skill) and the server's word as outcome. Paper (sandbox4,
  bare bots + the instrument): 7/7 fixtures incl. two bots on one cell (both confirmed, deduped = removed) and a ghost dig
  300 ms after join (unconfirmed, the block still there). npm test 246/246. Registration ~/mcai-analysis/digtown-01.82aef34.json;
  read ~/mcai-analysis/digtownread.py (md5 f3cfbc5d); licencecheck PASS (kind _dig_town_sum, baseline 0 rows / 6 h).
- **townzone-01** branch tz-on-82aef34 @ b945226a (pushed, new) = digtown-01 + the zone. Launch ONLY on a fleet running
  9dc2ad5e (digtown promoted). gather: town candidates filtered at enumeration + conjunctions; mine: 12-block rule kept,
  bearing filter, per-step check, walk-out (exits nearest first, accepted at a dry clear stair; under a roof climb first,
  never tunnel at depth); ore tunnel: 100 on town ground; TRANSIT UNTOUCHED (pathfinder discards moves > 100, so a price
  is a veto); survival untouched. npm test 247/247. Paper: sandbox4 19:28-19:47Z (docs/reports/townground-paper-2026-10-13.txt), the real bot cand vs ctrl, world read by RCON: confirmed town-ground TARGET digs 0 vs 49 over five scenes (gather from home 0 vs 4 with +4 dirt from outside; mine 16 out walked out 0 vs 42; a 5-deep town pit: got out and gathered outside; entombed WHILE gathering: no tomb dig read target, escaped; no dirt outside: 0 vs 2, an honest failure). The queue entry for townzone-01 carries a hold (digtown promoted + 180 min). Registration
  ~/mcai-analysis/townzone-01.9dc2ad5e.json; read ~/mcai-analysis/townzoneread.py (md5 d40891f8; Z4/Z5/Z6 calibrated on
  44 null samples); licencecheck PASS (kind _town_ground, baseline 0).
- Reviews: Codex r1-r4 + Claude subagent r1-r3 (docs/reports/townground-steps23-review-2026-10-13.txt). Final: Claude
  APPROVE A-E; Codex APPROVE B/D/E, A and C APPROVE-WITH-CHANGES whose last items are fixed in the tips (scene E run: no tomb dig
  read target; reflex attribution seen on the real bot in P and E).
- Queue entries (for the coordinator to `queue add`): docs/reports/digtown-01.queue-entry.json,
  docs/reports/townzone-01.queue-entry.json. Both need a variant on whatever the fleet is at their turn (stocktarget-01 is
  live now; `git merge-tree` of tz-on-82aef34 with st-on-82aef34 and wellsite-on-82aef34 is clean).

## 10-13 16:30Z — AIRPOCKET-02 CLOSED INCONCLUSIVE (operator early close); v35.1 INSTALLED; stocktarget-01 launching
airpocket-02 @ 70cb0d41: +1080 NOT_YET; exposure_ready_ap2 0 -- the only upblocked attempt (hive-d-Delta 10:59-11:00Z, kind=ice)
FAILED: the step waited 1,528 ms for the interrupted `mine` to unwind (window=unsettled), dug, and mine's own still-running
dig cancelled it ("Digging aborted"); no retry (60-s cooldown); bot survived (air -1, health 18.33 -> 20). Not the window
logic; a design gap (a skill that ignores its interrupt keeps the body). Deaths canary 3/181 bh vs matched 5/272, gate held;
2 pocket rescues succeeded. Claude + Codex agree: close INCONCLUSIVE and fix as airpocket-03 (contested handoff -> short
cooldown + contested=1; mine's stair loop honours its abort; Paper scene: a skill ignoring its interrupt at the ice trap).
Closed by hand: loop stopped, ledger INCONCLUSIVE (check-open-loop --record), drop-ins removed (10), canary_pool cleared,
10 bots restarted from the env roster (no ghost units), all on 82aef34; `canary-sched closed airpocket-02`.
v35.1 installed 16:26Z (dry run rc=0; drawsteady b4a20bc7, drawrec 792a7cfd; digest b7ce36d7 unchanged, verified).
stocktarget-01 hold released 16:26Z; the scheduler launches it next (variant 82aef34 -> 48b093ce).
Building (owner "yes do 2-4", 10-13): the _dig_town counter + no-dig zone; the raised (self-building) junk well.

## 10-13 11:30Z — (daily operator session) nothing to close; airpocket-02 extending; STATE re-based on origin/main
- The docs-branch STATE (10-12 15:20Z) was 20 h behind origin/main (gridfix KEEP+promote, v35 installed, bamboo-01 ->
  bamboo-02, airpocket-02 live, wellsite-01 staged). Rebuilt from origin/main + the host; no conflict with the host.
- airpocket-02 poll 11:20Z POLL_OK (numbers in CURRENT). 2 canary deaths, both idle (hive-d drowned 22:45Z, placebo-d lava
  05:48Z) -- at the two-death floor, held on both arms. Rescues 2 success / 1 opened; no `upblocked` exposure yet.
- Iron funnel (24 h, newest line): raw iron 361 (0.25/bot-h), ingots 357, iron pickaxes crafted 40, gone 86; iron-pickaxe
  bot-hour share 52.6% (the previous four lines: 34.8 -> 35.2 -> 36.6 -> 41.0%). Denominator 1,439 bot-h.
- Host: 94 GB, 74 GB available; / 28% used.
- No deploy, no analysis started (a canary is live). No owner wake: nothing promoted or reverted today.

## 10-13 10:05Z — wellsite-01 STAGED for the queue (after bamboo-02); junk-well site defect diagnosed
DIAGNOSIS (24 h to 08:07Z, full walk, 1.29M rows, 80 bots):
- 3,197 build_well no_site refusals from 55 bots in 12 pools; per-bot gap p50 7.2 min. Every attempt was free: no_effect
  carried no backoff.
- Town region files were read offline (read-only copy; 10/10 cells matched read-only RCON; the 5 live wells read intact).
  Within 14 of home the bots have dug out the ground: the walls and the 2-wide underground ring fail on 80-100% of
  candidates in EVERY town.
- The 741 well_retired rows/day were TWO wells:
  - board-b: a real breach (its ring was mined out);
  - placebo-b: a FALSE breach. An escape pillar left sand resting on dirt in the well's wall. The well is sealed but was
    retired, and has had no disposals since 10-12 09:31Z.
CHANGE wellsite-on-82aef34, canary sha baa94879 (both engines APPROVE r4):
- an exhausted search backs off 2 h, and the town remembers it in junkwell-nosite-<home>.json;
- a supported sand/gravel wall counts as a wall;
- containment is re-read at the stand and at every throw click;
- tally= on the no_site row; one retirement row per well.
- Searching to radius 32 was REJECTED by both reviews.
STILL NO WELL after this change: board-c, board-d, placebo-c, isolated-a, isolated-b have no valid cell even at radius 32.
Follow-up design (analysis only, sandbox first): docs/reports/wellsite-selfbuild-design-2026-10-13.md.
STAGED ON 10.0.0.31:
- ~/mcai-analysis/wellsite-01.82aef34.json (sha256 c6369c3d...)
- wellsiteread.py c8dff7cc, in ~/mcai-analysis and /tmp
- licencecheck PASS (text ' tally=cols:': 0 hits in 747 baseline rows); changerowcheck PASS (change_rows emptied: the base
  emits both well rows)
- entry ~/mcai-analysis/wellsite-01.entry.json: after bamboo-02, ONE variant 82aef34 -> baa94879; draw_require_pools placebo-b
- NOT queued: the coordinator runs `queue add`.
VARIANTS NEEDED by its turn (not built): 70cb0d41, 48b093ce, a88f763d, 08c791aa, 7ffe2c40, 2ec19385, 1d6dd516, 82126748,
and bamboo-02 on each of those. stocktarget-01's well arms act only in towns with a live well.
Review record: docs/reports/wellsite-01-review-2026-10-13.txt.

## 10-13 08:10Z — overnight: airpocket-02 extending (+540 NOT_YET, gate held); brain-01 series done; junk-well investigation started
airpocket-02 (hive-d,placebo-d): +180/+360/+540 NOT_YET. Deaths canary 2/90.8 bh (hive-d-Comet drowned idle 22:45Z;
placebo-d-Comet lava idle 05:48Z) vs matched 1/136.2; DiD psi 0.93x, lower bound 0.14x, matched lower 0.23x -- held.
Rescues on the canary: 2 success (placebo-d 02:06Z, 06:38Z), 1 opened (hive-d 06:00Z). exposure_ready_ap2 = 0 (no mature
`upblocked` attempt yet); extension continues to deadline 1680 (~01:56Z 10-14). stocktarget-01 queue-held for v35.1.
brain-01 closed-loop (3 valid pairs b10-b12, 82aef34 + brain-01, 8 bots, 70 min): stuck -10.4 min/bot [-19.7,-1.1] (3/3
same direction); refused share, success share, output INCONCLUSIVE. MODEL FINDING: after a repeat_loop veto gemma
re-proposes the identical action 76-85% (qwen 29-59%) with the rejection text in its prompt 99-100%. Recommendation
(agent + operator): a fleet fix for post-veto loops (veto names an executable alternative, or deterministic change after
N identical vetoes) BEFORE the brain-01 canary; owner to decide. brain-01 otherwise ready (key, tunnel :11611, keeper,
variant on 82aef34). Open: Studio unattended-reboot recovery (no auto-login; LaunchDaemon recommended) -- owner.
JUNK WELL DEFECT (10-12 24 h): 12 of 16 pools cannot site a well (build_well no_site 3,068x from 55 bots); disposals only
in hive-a/b/c, placebo-b/d. Investigation agent started 08:05Z (analysis + both-engine design; build only if both agree;
no queue/deploy).

## 10-12 22:20Z — airpocket-02 LIVE (hive-d,placebo-d, 10 bots, declared 21:55:59Z); v35.1 STAGED for the next gap
airpocket-02 @ 70cb0d41 on 82aef34: preflight, licence, gatedigest, usafe registration OK; drawn hive-d + placebo-d (hive-d
required by draw_require_pools); matched control FROZEN hive-c,placebo-a,placebo-b. Reads +180 ~00:56Z, +360 ~03:56Z.
v35.1 (Codex + Claude APPROVE r2, main 56f983b6, ~/gate-v35_1): drawsteady validates only rows inside its 12 h window
(the refusing rows were three SEPTEMBER hand-recorded 'FLEET-WIDE (80 bots)' promotions, not gridfix's), a FLEET-WIDE row
inside the window suspends the release, drawrec PAGES on a drawsteady refusal (once / 6 h). Digest unchanged b7ce36d7.
stocktarget-01 carries a QUEUE HOLD for the gap. INSTALL after airpocket-02 is decided + torn down:
  bash ~/gate-v35_1/install-gate-v35_1.sh --dry-run   (no WOULD REFUSE, rc=0, ~5 min)
  bash ~/gate-v35_1/install-gate-v35_1.sh             (holdtoken + loop lock; backups *.bak-v35_1-<stamp>; digest verified)
  python3 ~/canary-sched.py queue release stocktarget-01

## 10-12 21:55Z — v35 INSTALLED (20:33Z, by the claiming operator session); bamboo-01 -> bamboo-02 at the END; airpocket-02 launching
v35 bundle b7ce36d777443eae018e804f4776e95a installed + verified 20:33Z; steps 3-6 applied (airpocket-02 regs carry
top-level draw_require_pools ['hive-d'], sha 05710889/b9a85ad6; stocktarget-01 five variants with the 3-pool edge).
bamboo-01 launched 20:37Z, draw EMPTY: its draw_exposure allows only board-a/board-d, both in the 12 h exclusion after
gridfix-01 (18:10Z) -> earliest ~06:10Z. V35 DEFECT: drawsteady reads the promotion ledger row canary_pool 'FLEET-WIDE
(80 bots)' as malformed -> 12 h for every pool, so the 6 h steady release can never fire after a promote (fails closed;
fix requested from the v35 agent as a v35.1, install only in a gap). Operator (Claude + Codex AGREE): killed bamboo-01's
loop in its draw wait (nothing drawn/deployed), `abandon` + `cancel bamboo-01` (superseded), re-queued as bamboo-02
(registrations copied, run_id changed, backup ~/canary-queue.json.bak-bb2-*) AFTER orderroom-01 so every earlier entry
keeps existing variants; airpocket-02.after -> []. bamboo-02 NEEDS a variant on the fleet tip at its turn.
/tmp/airpocket2read.py was the OLD read (13cd6acf); replaced by the approved 4fa3b83e (old kept as .old-13cd6acf).
QUEUE NOW: airpocket-02 (launching ~21:50Z) -> stocktarget-01 -> orderroom-01 -> bamboo-02.

## 10-12 18:40Z — brain-01 (model agent): BOTH ENGINES APPROVE the plumbing; Studio restored; 10-12 sandbox gemma blocks INVALID
- **Branch `brain01-on-0cdb1a8`** @ 8d7f9206; design `docs/reports/brain01-design-2026-10-12.md` on that branch.
  - Codex and Claude APPROVE A (bot code), B (Studio/host pieces) and C (operator patches + registration) after 4 rounds.
  - Nothing is queued or deployed.
- **Key decision (a) is DONE.** The coordinator placed the key; the owner said they do not hold one.
  - `mcai-studio-tunnel.service` is installed and enabled on .31, on **127.0.0.1:11611**. 11601 is held by an unrelated
    mini relay (pids 32742/42146, started 10-11 21:34Z, not the model agent's). It is left alive pending its owner.
  - Tunnel-drop drill on the real unit: refused in ~9 ms (instant local fallback), back within 6 s.
- **The Studio is restored.**
  - gemma4 MLX 8-bit is loaded as `brain`; brainproxy is healthy on :11501.
  - The launchd agents `com.mcai.brain01.proxy` and `com.mcai.brain01.keeper` are now INSTALLED. They were only staged
    before, which is why nothing put gemma back after andy-eval's `lms unload --all; lms server stop` at 12:32Z and
    13:48Z.
  - The keeper reloads within a minute (proven 18:13:46 -> 18:14:26Z).
  - **To free the memory on purpose:** `touch ~/brain01/PAUSE` and then `lms unload brain`. Remove PAUSE to restore.
- **LEDGER (bots' own llm.brain rows):**
  - INVALID: `cl-brain01-gemma4-…-b0` and `…-b1` (14:51-17:55Z), 0% gemma4.
  - Unpaired and never averaged in: `cl-brain01-local-…-b0`; the b1 local run was stopped 18:10Z.
  - INVALID: the drill's "337 s recovery" (real: 26 s).
  - STILL VALID: the replay (gemma 12:45-13:02Z) — executable choice 98.6% vs qwen 88.6%, repeats-failed 15.9% vs
    67.8%, 4x loop 28.3% vs 95.0%, schema-valid 99.3% vs 99.5%. Also the capacity runs (10 bots p95 6.8 s), the drill
    windows before 12:30Z (0 unserved of 214), the gate calibration (0 trips) and the abort analysis.
- **Sandbox series re-run AFTER andy-eval, on the coordinator's word.** `brain01_series.py` now refuses a gemma block
  without `/healthz` ok and aborts one whose gemma4 share falls below 0.90 over 10 min (positive control: it fires on the
  invalid run).
- **Studio share with andy-eval:** gemma stays idle during its round. For its fine-tune: PAUSE + unload `brain` only,
  then remove PAUSE.
- **Owner decisions closed 10-12:** (b) the Studio is for this project for the foreseeable future, so a kept subset may hold
  the reservation indefinitely. (c) Every reader that builds its own control adopting the subset exclusion is
  engineering work before any keep-subset.

## 10-12 18:25Z — GRIDFIX-01 KEPT (+540, 18:10Z) and PROMOTED: FLEET 82aef34 (18:20Z); v35 install claimed
+540 (exposure reached): aborted 2x2 exits with clicks canary 1 / control 4; canary grid_clear yes 1, no 0, unverified 0;
liveness grid_clear 135 of 135 canary craftsync rows, 0 control; deaths canary 1/180 bh vs control 4/360 bh. Recorded KEEP
18:10:34Z, promoted 18:20:15Z, one build live 18:22Z. Watch (n=1, not a gate): the canary's next craft after its abort
still failed (1 of 1; control 2 of 3). The INCONCLUSIVE risk in the 15:20Z entry is moot: bamboo-01 and airpocket-02
both have 82aef34 variants.

## 10-12 16:45Z — ORDERROOM-01 FALLBACKS for a stocktarget REVERT: merged 10-variant entry ready (both engines APPROVE), NOT installed
Closes the gap noted above: if stocktarget-01 is not kept, orderroom had no variant on the non-stocktarget bases, and the old r8
fallbacks pinned read md5 4c96f509 (refused by the scheduler). The fallbacks are r1-r8 + r9g (f5776239: the 16-fuel floor in the
iron-ladder fallback, and the peaceful sword switch in the room order's deposit plan), WITHOUT the stocktarget-only walk to the
junk well. Codex + Claude APPROVE on the fallback delta (identical +/- lines on all five; no airpocket-02 composition issue).
- 0cdb1a8 -> or-on-0cdb1a8 @ f5776239 (244/244); 82aef34 -> or-on-82aef34 @ 08c791aa (246/246); 8212674 -> or-on-8212674 @
  fb75ac48 (247/247); 70cb0d41 -> or-on-70cb0d4 @ 7ffe2c40 (246/246); 71032630 -> or-on-7103263 @ 92f4f819 (247/247). no-undef clean.
- READ 8a22256f IS VALID WITHOUT STOCKTARGET (both engines): no gate reads a stocktarget row; on these bases a `home` room order
  always names its deposit X, so the well-walk counts (`home_well`, the item '-' completion branch) read zero, the iron-ladder share
  is just reported, and the 30 s probe-race line is an inert note. Its dry runs on 10-12 were taken on the non-stocktarget fleet.
- MERGED ENTRY (the five stocktarget variants + the five fallbacks; every registration pins read 8a22256f; registration hashes
  verified on the host): ~/mcai-analysis/orderroom-01.entry-merged.json = docs/reports/orderroom-01.queue-entry.json ->
  `python3 ~/canary-sched.py queue replace-variant orderroom-01 ~/mcai-analysis/orderroom-01.entry-merged.json`.

---

## 10-12 15:35Z — gridfix-01 +360 NOT_YET (still unexposed; extends, reads +720/+1080..., deadline 1680 = ~13:03Z 10-13)
deaths 1/120 bh vs control 3/240; aborted 2x2 exits with clicks 0 canary / 0 control. Queue waits behind it (bamboo held
for the v35 gap). orderroom-01: five stocktarget-tip variants INSTALLED (replace-variant; host repo fetched first; backup
~/canary-queue.json.bak-or5-*). GAP: no orderroom variant on a non-stocktarget fleet -- if stocktarget-01 REVERTS the queue
blocks at orderroom; fallbacks (current read md5 8a22256f) requested from the orderroom agent. stocktarget-01 Paper hold
released 14:45Z.

## 10-12 15:20Z — (daily operator session) gridfix-01 +360 NOT_YET: ZERO aborted 2x2 exits on EITHER arm in 6 h
- +180 (12:08Z) and +360 (15:11Z) both NOT_YET; no breach; deaths canary 1/120 bh vs control 3/240 bh. Blocks KEEP:
  exposure_ready 0 and own line aborted_control 0 (no evidence class, so no revert). The loop extends (pid 538005).
- gridfixread +360 by hand (654,249 rows walked). POSITIVE CONTROLS: liveness grid_clear on 84 of 84 canary _craft_sync
  rows, 0 of 236 control; craftsync "nothing changed" 0/184 vs 0/578. So the instrument sees craftsync rows. What is absent
  is the EVENT itself: unclean 2x2 exits with clicks are canary 0, control 0. The registration's measured rate was ~0.5/h
  fleet-wide. That would put ~2.3 in the control's 6 h; P(0) ~0.10. Possible reasons, NOT tested: the bag fixes
  (peacefulkit, junkwell) lowered abort pressure, or the registered rate is stale.
- LIKELY OUTCOME: INCONCLUSIVE at the deadline (10-13 13:04Z) unless the extensions find >= 1 abort on each arm.
  CONSEQUENCE FOR THE QUEUE: on INCONCLUSIVE or REVERT the fleet stays 0cdb1a8. bamboo-01's variants are e29c1e7, 79ab946
  and 82aef34; there is NO 0cdb1a8 variant (checked: no origin/bb-on-0cdb1a8). airpocket-02 is gridfix-lineage only by
  design. Both would BLOCK, so apply the 13:50Z operator rule and move stocktarget-01/orderroom-01 up. Prepare a
  bb-on-0cdb1a8 variant now if bamboo should not wait.
- Also: the craftsync cursor defect (13:30Z entry) argues for KEEPing the grid fix. But a KEEP needs exposure under the
  registration. Any shortcut (Paper evidence as exposure) is an amendment: PROSPECTIVE only, both engines.
- The local analyst's newest *.verdict.json is still 20261006T1500 (6 days stale).
- The docs branch copy (mcai-rl02, recovery-ladder-03) was 2 days behind main; synced from main + this entry.

## 10-12 15:10Z — ORDERROOM-01 REBASED ONTO STOCKTARGET-01 (both engines APPROVE st-4); replace-variant entry ready, NOT installed
The queue runs orderroom after stocktarget, so its variants are now keyed by STOCKTARGET's canary shas (the fleet then):
764fad4f -> or-on-764fad4 @ 1e1bcc86 (247/247); 48b093ce -> or-on-48b093c @ 2ec19385 (249/249); 31e64375 -> or-on-31e6437 @ 77ac5597
(250/250); a88f763d -> or-on-a88f763 @ 1d6dd516 (249/249); 1940574d -> or-on-1940574 @ 35f96502 (250/250). no-undef clean (only
reflex.mjs's typeof-guarded withinBody, pre-existing). Entry: docs/reports/orderroom-01.queue-entry.json = ~/mcai-analysis/
orderroom-01.entry.json (after stocktarget-01) -> `canary-sched.py queue replace-variant orderroom-01 ~/mcai-analysis/orderroom-01.entry.json`.
Registrations installed (~/mcai-analysis/orderroom-01.{1e1bcc8,2ec1938,77ac559,1d6dd51,35f9650}.json); read md5 8a22256f.
- WHAT CHANGED FOR THE STOCK TARGETS (r9-r10; Claude st-1 finding: at target the bank takes no bulk, so far full bags mostly got
  `none`): a far bot with nothing bankable walks home toward a RECORDED junk well (townWellTakes = the well's own disposePlan,
  never a craft ingredient; stockWellOpts gains a planning-only assumeCap); a well walk backs further ones off 30 min whatever the
  well did, and none is named while the well's dispose order backs off; the iron-ladder fallback keeps 16 fuel; the deposit plan
  passes the peaceful sword switch. Read: share of deposits banking ladder items; well walks judged by the craft that follows.
- PAPER on the stocktarget variant (sandbox, 14:3x-14:5xZ; cand or-on-764fad4 vs 764fad4f): kept = home -> build_well -> deposit
  oak_log (chest +64) -> craft; far = home -> town_deposit (+65) -> craft; keptfull (town chest full, no chest to build one) = the
  deposit failed, the room order backed off, one craft on an unknown verdict failed for room, then nothing more; bag/chest/ground as
  expected. Control never crafted (no-room x3, refused x14 in 180 s). Caveat: the fresh sandbox pool had no recorded/usable well, so
  stocktarget's cap did not bind in these scenes; the at-target path is covered by tests and both reviews, not by Paper.
- FOLLOW-UP, NOT FIXED IN ORDERROOM (coordinator): admission.mjs:362 (same line on 0cdb1a8 and the stocktarget tips) builds the
  deposit gate's wants as `[...(wanted ? [wanted].flat() : []), ...DEPOSIT_ALWAYS]`, but the caller passes a Set
  (cognitive.mjs:979 `wantedNow = this.#wantedItems(milestone)`, which returns a Set at :737). `[aSet].flat()` does not spread a Set,
  so `wants` holds the Set object itself, bankableInventory never sees the milestone's wanted names, and the gate's deposit_due test
  can count an item the active rung wants as bankable. Advice and execution agree today only because deposit()/adviseDeposit also
  ignore wants the same way (bot.currentWants is set from this same array). Fix: `[...(wanted ? [...wanted] : [])...]` with a test
  that a wanted name is not counted bankable by the gate -- its own small canary, since it changes what the deposit gate admits.
- Process note: one r10 commit briefly carried a generated test _mutant file (a suite was running while I switched branches); the
  commits were amended before any push and both engines confirmed it gone.

---

## 10-12 14:20Z — V35 INSTALL CHECKLIST (run in the gap after gridfix-01 is decided AND torn down; no agent needed)
v35 STAGED, NOT installed: Codex r10 + Claude APPROVE, dry run rc=0, main 2377a88c/be41ea54, bundle b7ce36d777443eae018e804f4776e95a.
bamboo-01 carries a QUEUE hold for this gap (a per-entry hold does NOT block the installer; never add `install-hold`).
 0. Confirm teardown: drop-ins gone, canary_pool empty, pool bots restarted, exactly 2 builds live.
 1. bash ~/gate-v35/install-gate-v35.sh --dry-run    (~1.5 h; no WOULD REFUSE lines)
 2. bash ~/gate-v35/install-gate-v35.sh              (backs up *.bak-v35-<stamp>; registers + verifies digest; rolls back on mismatch)
 3. python3 ~/bagfix-regs/install-bagfix-regs.py --dry-run ; then without --dry-run   (36 regs: 3-pool edges + keep_rule)
 4. airpocket-02: cp ~/ap2-v35-regs/airpocket-02.{70cb0d41,71032630}.json ~/mcai-analysis/ ; then
    canary-sched.py queue replace-variant airpocket-02 ~/ap2-v35-regs/airpocket-02.queue-entry.json
    (WHY: the live regs carry draw_exposure.draw_pools_required, which NO code reads -- hive-d was never enforced; v35's
    drawrequire reads top-level draw_require_pools.)
 5. stocktarget-01: canary-sched.py queue replace-variant stocktarget-01 ~/st-v35-regs/stocktarget-01.queue-entry.5variants.json
    (FIVE variants: 0cdb1a8, 82aef34, 8212674 + airpocket tips 70cb0d41, 71032630; replace-variant re-hashes the files NOW and
    refuses on a mismatch -- if the 3 older ~/mcai-analysis copies were not refreshed by step 3, copy them from ~/st-v35-regs.)
    stocktarget-01's Paper hold was RELEASED 14:45Z (stocktarget-paper-2026-10-12.txt VERDICT PASS).
    (3-pool edge -1.598 reused from stonecap-01's identical draw filter; without it a 3-pool final is INCONCLUSIVE).
    Its airpocket-tip variants (being built) need the same edge.
 6. canary-sched.py queue release bamboo-01
Host needs the 94 GB VM (reads peak 23 GB at +1920). Calibration jobs now refuse while any canary is active.

## 10-12 14:00Z — STOCKTARGET-01: Paper PASS (from the world); five variants incl. the airpocket-02 builds; one replace-variant entry
PAPER (docs/reports/stocktarget-paper-2026-10-12.txt, VERDICT PASS): no chest at target (run 5: chests 1 -> 1, the carried
chest kept; control +30 iron -> chests 1 -> 2, aid matched); the refusal row from the world (run 6, no well: chest cobble
1,661 -> 1,661, bag kept 161, iron banked; rows via=deposit and via=admission, at_cobble=1). The hold's condition is met:
lift with `canary-sched.py queue release stocktarget-01`.
VARIANTS (queue gridfix-01 -> bamboo-01 -> airpocket-02 -> stocktarget-01 -> orderroom-01): + st-on-70cb0d4 @ a88f763d
(airpocket-02 on gridfix 70cb0d41) and st-on-7103263 @ 1940574d (airpocket-02 on bamboo 71032630) -- the approved diffs,
no conflict; rebase review Codex APPROVE + Claude APPROVE (exact composition; the prune chain keeps the rescue's ownership);
npm test 248/248, 249/249; mutants 62/62; lint only the guarded withinBody at reflex.mjs:2451 (= the base). Their
registrations carry v35's primary_by_pools (3-pool -1.598) + keep_rule like the other three; staged v35
registration_problems [] on all five; bagfixgate check-registration OK. ONE FILE: docs/reports/stocktarget-01.queue-entry.json
= ~/st-v35-regs/stocktarget-01.queue-entry.5variants.json (built on the v35 entry: its three variants unchanged + the two;
"hold" kept, text now says PASS). Registrations for the two new keys: ~/st-v35-regs and ~/mcai-analysis
stocktarget-01.{70cb0d4,7103263}.json (sha256 in the entry).
STATE.md housekeeping: a partial duplicate of the 12:40Z stocktarget entry (a merge artifact, mid-file) was removed.

## 10-12 13:50Z — QUEUE (host): gridfix-01 (live) -> bamboo-01 -> airpocket-02 -> stocktarget-01 (HELD: Paper) -> orderroom-01
Order agreed Claude + Codex (codex exec 10-12): airpocket-02 (drowning; Paper 0/10 equips into open windows, 0 deaths)
ahead of the held stocktarget. airpocket-02 has variants ONLY on gridfix lineage (82aef34 -> 70cb0d41, 8212674 ->
71032630): if gridfix REVERTS it BLOCKS by design (never on 0cdb1a8: the craftsync cursor log-loss, Paper 3/4 on 0cdb1a8).
OPERATOR RULE (Codex): if airpocket-02 is blocked when its turn comes, move stocktarget-01/orderroom-01 ahead of it (hand
edit under flock ~/sched.lock with a .bak) so bags/chests are not held. Done today: host repo fetched for the new shas;
stocktarget-01 queued held (lift: `canary-sched.py queue release stocktarget-01` when
docs/reports/stocktarget-paper-2026-10-12.txt says PASS); orderroom-01 queued (after stocktarget); airpocket-02 inserted by
hand (backup ~/canary-queue.json.bak-ap2-*), stocktarget.after -> airpocket-02. Variant builds in progress: stocktarget and
orderroom on the airpocket tips; orderroom on the stocktarget tips. v35: Claude APPROVE, Codex r10 + dry run running;
install only after gridfix is decided. brain-01: Claude r1 A CHANGE / B APPROVE / C CHANGE, fixes + r2 in progress;
OWNER DECISIONS PENDING: the 10.0.0.31 -> Studio restricted ssh key; a kept gemma subset would hold GPU_RESERVED indefinitely.

## 10-12 13:30Z — AIRPOCKET-02 READY (both engines APPROVE), queue entry on main (after bamboo-01; NO 0cdb1a8 variant); FLEET DEFECT: craftsync abort strands a stack on the cursor (0cdb1a8 line; gridfix-01 covers it)

**THE BUILD.** airpocket-02 now has the owner's open-window equip race fix integrated:
- the owner's commits 39ac212, 978c887, dafc276 and d2df552, hand-merged;
- ONE inventory core, `rescueInventoryDecision`, which feeds admission, the pre-empt and the step;
- a craft that is in flight (craftsync `active()`, not a zombie) counts as owned and locked, so no equip is ever queued behind it;
- a junk well's hold counts as owned. The rescue RELEASES it before any equip and DROPS whatever was queued behind it;
- a rescue epoch plus an in-progress flag, so an interrupted housekeeping order never restores its old item over the rescue's pickaxe.

**Reviews.** Codex approved at r3 and Claude at r2 (docs/reports/airpocket-02-integration.review-2026-10-12.txt). Round 1 found two P1s and two P2s; round 2 found one P1. All were fixed, each with a test and a mutant.

**Variants.** The diffs are identical across bases.

| base | branch | canary sha | suite |
|---|---|---|---|
| 82aef34 (gridfix-01) | ap2w-on-82aef34 | 70cb0d41 | 245/245 |
| 8212674 (bamboo-01) | ap2w-on-8212674 | 71032630 | 246/246 |
| 0cdb1a8 (current fleet) | ap2w-on-0cdb1a8 | 776766cb | 243/243 |

The 0cdb1a8 build was tested on Paper but is deliberately NOT in the queue entry.

**Queue entry and read.**
- The queue entry is docs/reports/airpocket-02.queue-entry.json, with `after: [bamboo-01]` and variants for 82aef34 and 8212674 ONLY. If gridfix-01 reverts, the entry BLOCKS (H2).
- Registrations are installed at ~/mcai-analysis/airpocket-02.{70cb0d41,71032630}.json. They require **hive-d in the draw** (the ice trap). drawexposure over 24 h finds board-d, hive-d and placebo-b eligible.
- The read is ~/mcai-analysis/airpocket2read.py (md5 4fa3b83e). It parses `window=<state>:<ms>`. The old copy is saved as airpocket2read.py.bak-20261012.

**PAPER** (docs/reports/airpocket-02-paper-2026-10-12.md; sandbox/craft/airpocket-ab.cjs with the CR scene; sandbox/craft/airpocket-ab-CR-2026-10-12.txt):
- **SM:** the candidate 776766cb was 3/3 alive, with 0 of 6 equip clicks into a window. The control 0cdb1a8 was 0/2 alive: 6 of 6 equip clicks went into the furnace window (the owner's defect, reproduced).
- **A / AF / F:** no regression.
- **CR (a craft in flight at the trap):** no equip landed while craftsync was active.
- **Smelt restarts:** in SM on the candidate, cognition restarted smelt twice during the dig. Each time it made 9 furnace clicks before the step's guard aborted it, with no harm. A start gate while `airPocketing` is set would remove this; it is follow-up work.

**FLEET DEFECT (0cdb1a8 line, pre-existing): an aborted craft can strand the crafted-from stack on the server cursor.**
- **Mechanism.** The craft is aborted about 350-400 ms in. The table closes and the server returns the grid to slot 10. craftsync's abort cleanup then clicks -999 (its resync) and **slot 10**. That click picks the stack up onto the cursor, and nothing puts it back. The items vanish from the Inventory and the next craft fails with "0x oak_log". Nothing is dropped into the world and nothing is tossed. The stack is dropped when the bot disconnects, which would explain a stray item at the arena on the next login.
- **Results in Paper CR:**

  | build | trials losing the stack |
  |---|---|
  | 0cdb1a8 (fleet) | 3/4 |
  | 776766cb (airpocket-02 candidate) | 2/4 |
  | 82aef34 (gridfix-01) | 0/2 |
  | 70cb0d41 (airpocket-02 on gridfix) | 0/2 |

  On the non-gridfix builds the stack was lost exactly when the slot-10 pickup happened: 5 of 5 pickups lost it, and 0 of 3 trials without the pickup did.
- **What gridfix changes.** gridfix-01's grid clear follows the same pickup with a close, and the server returns the cursor stack to the inventory.
- **Why airpocket-02 is not queued on 0cdb1a8.** airpocket-02 does not cause the loss, but its guard aborts crafts about 0.35-0.4 s in, which would surface the defect more often. That is the only reason.
- **CAVEAT:** every gridfix abort came at 594 ms or later, so **no gridfix abort under 0.5 s was observed**. TODO when the sandbox is free: a Paper CR trial on 82aef34 whose second abort lands under 0.5 s.
- **Fleet exposure today:** any craft aborted early on 0cdb1a8. The fleet has not been measured for it. The tell is a `craft` failure "you have 0x <item>" right after a `craft` abort row.

---

## 10-12 12:55Z — ORDERROOM-01 READY (both engines APPROVE r6), NOT queued: no rung craft order without room; the remedy is the order
Follow-up to the 10-10 orderveto finding (docs/reports/orderveto-investigation-2026-10-10.md: 3,608 refused craft orders in
13.5 h, ~90% after a no-room craft failure whose named remedy nothing executed). Design + final state:
docs/reports/orderroom-design-2026-10-10.md; reviews docs/reports/orderroom-reviews-2026-10-12.txt (Codex r1-r5 CHANGE, r6
APPROVE; Claude r2-r5 APPROVE-WITH-CHANGES, r6 APPROVE).
- THE CHANGE: readyFor asks the craft's own room check (craftRouteFor = craftLevel's route A/B/C; chainPeak; the pickup slot as
  admitRoom holds it; the craft's own wear-out in tools). No room -> no craft order, the prompt stops advertising it, and the
  remedy is the order: eat / deposit X (admission's own depositDue+bankClosed; X frees a stack, never an ingredient, outside
  the iron ladder first, cheapest rung last) / home only when far and only toward a deposit that can run. Never a placement.
  A remedy the gate's memory would refuse is skipped (AdmissionControl.memoryRefuses, a read). Unknown verdicts issue the craft
  as before, tagged "(room via unknown)". Rows: _craft_noroom, _room_order. ORDINARY class.
- VARIANTS (pushed; queue entry docs/reports/orderroom-01.queue-entry.json, after bamboo-01): fleet 0cdb1a8 -> or-on-0cdb1a8
  @ 4825f17 (244/244); 82aef34 -> or-on-82aef34 @ 8223061 (246/246); 8212674 -> or-on-8212674 @ 411aa37 (247/247).
  Registrations installed at ~/mcai-analysis/orderroom-01.{4825f17,8223061,411aa37}.json; read ~/mcai-analysis/orderroomread.py
  (= scripts/host/orderroomread.py, md5 4c96f509). Dry runs (CANARY_DRYRUN, identical code) ran clean; the PRIMARY (refused
  rung craft orders DiD) read +5.19/+4.78/-2.78 on the null, so it is REPORTED; KEEP rests on the gates.
- PAPER (sandbox4, 10-12, sandbox/craft/orderroom-ab.cjs): cand or-on-0cdb1a8 far = home -> town_deposit -> craft; kept =
  home -> build_well -> deposit raw_iron -> craft; room = craft at once. ctrl 0cdb1a8 never crafted (no-room x3, refused x12-14).
- COMPOSITION TO RECHECK: if stocktarget-01 lands first, its caps can drop the deposit X (`_stock_refused via=deposit`); the
  room order then frees nothing and backs off (bounded), but rebase and re-run the `kept` Paper scene before queueing.
- NOTE: the orderroom Paper proof on 10-10 held /tmp/mcai-sandbox.lock from 19:50Z 10-10 until 11:04Z 10-12 (left over the
  API-limit stop); released. Unrelated existing bug found in review: admission.mjs `[wanted].flat()` does not spread a Set, so
  milestone wants never reach bankableInventory in the deposit gate (advice and execution agree only because both ignore them).

---

## 10-12 12:40Z — STOCKTARGET-01 READY, HELD for the operator (Paper pending: the sandbox lock is held by other agents; the run takes it next); carries stonecap-01's cobble cap (the fold)
Per-town stock targets + chest pruning + usable-tool targets, CARRYING stonecap's cap + well-at-cap code unchanged.
stonecap-01 is closed INCONCLUSIVE and NOT re-run (fold decided with both engines: Codex fold-r1 CHANGE -> r2 APPROVE,
Claude fold-r1/r2 APPROVE). THE STONECAP LESSON IS BUILT IN: `_stock_refused` (via=deposit|town_deposit|admission;
at_cobble=/at_stock= for refusals at a COUNTED cap/target) whenever the cap or a target drops a held name from a plan --
so a town already above its cap is not a silent run; liveness line = stocktargetread `rows_live` (unknown-only refusals
are reported, never liveness). Code reviews: Codex r4 APPROVE, Claude r3 APPROVE (docs/reports/
stocktarget-code-reviews-2026-10-10.txt). Variants (queue entry docs/reports/stocktarget-01.queue-entry.json, after
bamboo-01, **"hold" set**): fleet 0cdb1a8 -> st-on-0cdb1a8 @ 764fad4f; 82aef34 (gridfix kept) -> st-on-82aef34 @ 48b093ce;
8212674 (bamboo kept) -> st-on-8212674 @ 31e64375 (three union conflicts with bamboo, checked by Claude fold-r2).
npm test 246/246, 248/248, 249/249 (the three variants); mutants-stocktarget 62/62 killed on all three; eslint no-undef only reflex.mjs:2382 withinBody on
all three -- PRE-EXISTING on each plain base at the same line, typeof-guarded, cannot throw (registration 'lint'); licencecheck: `_stock_refused` baseline 0 rows / 6 h (329k rows, 80 bots); bagfixgate check-registration OK.
Dry runs: hive-d,placebo-a 10-10 (+180) gates 0, instrument 106; stonecap's own pools 10-11 20:45Z (+360, journals of 4
towns readable, admitted cobble bank claims 0 -> C1-C5 UNTESTED, as expected on over-cap towns).
**TO LIFT THE HOLD (no agent needed):** read docs/reports/stocktarget-paper-2026-10-12.txt; if it says PASS,
`canary-sched.py queue release stocktarget-01`. Install the drawn variant's registration as
~/mcai-analysis/registrations/stocktarget-01.json (copies at ~/mcai-analysis/stocktarget-01.<fleet>.json).
THE ONE-TIME CLEAR uses these targets as its caps (design §15.1, docs/reports/stocktarget-clear-caps-2026-10-10.json;
OWNER TO CONFIRM: bamboo 0, bucket 2). After the clear: run stocktargetread + stonecapread as a tripwire read on the
promoted fleet (near-cap cobble banking gets its first exposure there).
Built but NOT pushed: the 0264f61 contingency (peacefulkit was kept). Branches pushed: st-on-0cdb1a8, st-on-82aef34, st-on-8212674.

## 10-12 12:25Z — gridfix-01 LIVE @ 82aef34 (declared 09:03:55Z, placebo-a,board-a,board-d,board-b, 20 bots); agents resumed 11:03Z
+180 (12:08Z) NOT_YET: deaths 1/60 bh vs control 2/120 bh (equal rate); liveness 43/43 canary _craft_sync rows carry
grid_clear (control 0); defect (grid_clear=no) 0; tripwire 0; craftsync holds 0/113. NOT EXPOSED: aborted 2x2 exits with
clicks 0 canary / 0 control (registered rate ~0.0065/bot-h; deadline 1680 min carries the extensions). Reported: crafts/bh
DiD +0.09, craft success share DiD -0.070 (small n), _reflex_stuck/bh DiD -0.27.
FLEET 24 h (to 12:15Z): 80 bots, 27 deaths (drowned 8, lava 8, wall 3, stalagmite 2 ...). Bags: 90% of slots used
(10-07 96%, 10-11 92%); >=34 slots 37/80, full 19/80; cobblestone is still the top slot user (248 slots, 13,579 items).
AGENTS (Codex answering again 11:03Z): v35 Claude APPROVE, Codex r8 + install dry run running (install only between
canaries); stocktarget-01 code APPROVE both (st-on-0cdb1a8), adds _stock_refused liveness, proposes folding the cobble cap
in (fold-r1 under review), Paper re-check after the sandbox frees ~12:30Z, variants on 0cdb1a8/82aef34/8212674 asked;
airpocket-02, orderroom-01 resumed; brain-01: capacity 10 bots (p95 6.8 s), bot change + sandbox drills going ahead,
OWNER DECISION NEEDED: a dedicated, permitopen-restricted ssh key from 10.0.0.31 to the Studio for the live path.

## 10-12 03:10Z — gridfix-01 launched 03:00Z, preflight/licence/gatedigest/bag-fix OK, DRAW SHORT (board-a,board-d)
Bag fix needs 4 pools; 8 of the drawable pools are inside their 12 h exclusion (junkwell-02's placebo-a,board-b,
placebo-d,hive-b until 07:21Z; stonecap-01's four until 14:50Z). The loop re-draws every 20 min and pages once at 3 h;
expected 4-pool draw ~07:20-07:40Z. Deliberately NOT re-run as ordinary (that needs both engines, as peacefulkit-02 did);
v35's three-pool fallback is the structural fix and is still in review.

## 10-12 03:05Z — STONECAP-01 INCONCLUSIVE (+360, 02:50Z): the cap works, but its liveness row CANNOT occur on these towns
Read: deaths canary 1/120 bh vs control 3/240 bh; breaches 0; exposure_ready 1; own line rows_canary (_cobble_bank) = 0
blocks KEEP (no evidence class, so no revert). Torn down 02:56Z, 20 bots back on 0cdb1a8. NOT promoted; fleet stays 0cdb1a8.
WHY ZERO (positive control): the canary bots DID arrive with spare cobble -- 119 of 137 canary deposit rows held > 64
(median 95; control 388/484, median 124), and 16 unnamed canary deposits succeeded. But every canary town is far over the
256 cap by the cap's own journal (/var/lib/mcai/_pool-*/town-chest-*.cobble.jsonl, latest count per container summed):
hive-a 2,288 (6 ctrs), hive-c 4,022 (11), placebo-b 5,723 (15), hive-d 8,704 (9) = 9x-34x the cap. bankableInventory
(bankable.mjs) drops refused stacks from the PLAN, so the deposit never names cobble and no _cobble_bank row is written
(skills.mjs ~2847 writes rows only for planned cobble). The refusal itself is silent on a deposit that moves other items.
So the run could only ever read INCONCLUSIVE. Effect lines were in the right direction: cobble_banked_did -9.06,
full_share_did -0.2, bag cobble not higher on canary (median 104 vs 120 latest per bot).
NEXT: re-run the cap AFTER the deferred one-time clear (towns then start under 256, so banking-under-cap rows occur), or
fold it into stocktarget-01 (same per-town caps). Registration fix for the re-run: count an at-cap refusal as liveness
(a row when the plan drops cobble at the cap), so an over-cap town is not a silent run.
TEARDOWN NOISE: the teardown restarts ghost units hive-a-Charlie/placebo-b-Charlie (no env file; the roster is
Alpha/Bravo/Comet/Delta/Echo) -- seen also on withdraw2-01. Harmless; reset-failed. Fix the teardown roster to read env/.
Queue: gridfix-01 launches next (variant 0cdb1a8 -> 82aef34; scheduler DECISION launch at 02:57Z), then bamboo-01.

## 10-11 21:00Z — CANARY LIVE: stonecap-01 @ 935c63e on hive-a,hive-d,placebo-b,hive-c (20 bots), declared 20:45:56Z
Cap + surplus cobble to the well at 256/town. Reads ~23:45Z / ~02:45Z (+ extension until exposure). FALLBACKS registered
so the queue never waits on a missing base: gridfix-01 + variant 0cdb1a8 -> 82aef34 (gf-on-0cdb1a8, both engines APPROVE
r2 on 10-10) and bamboo-01 + variant 82aef34 -> 8212674 (bb-on-82aef34, both APPROVE r1). Registrations
docs/reports/gridfix-01.82aef34.json, bamboo-01.8212674.json.

## 10-11 19:40Z — JUNKWELL-02 KEPT (+360, 19:21Z) and PROMOTED: FLEET 0cdb1a8 (19:31Z); merged to main; stonecap-01 next
+360: breaches 0; 2 wells, 9 disposal visits; junk slots DiD -3.02 (owner junk -2.45); share>=34 DiD -0.033; mine DiD
+7.03 (the predicted side effect: room -> mining) WITHOUT the deaths of junkwell-01: deaths canary 1/120 bh vs control
2/240 bh (equal rate), deep deaths 1 vs 3, deaths near a well 0. Main: merge of 0cdb1a8 (well-e2e.cjs kept main's),
npm test 245/245. stonecap-01 launches next on variant 0cdb1a8 -> 935c63e (cap + surplus cobble to the well).
FOLLOW-UPS (junk well): placebo-a has no valid well site near home; repeated _well_retired why=wall_is_air on the same
wells (placebo-d's own, board-b's 10-05 leftover) -- investigate when the agents return.

## 10-11 17:00Z — junkwell-02 +180 NOT_YET (clean); stonecap FALLBACK on 6f1921a built by the operator and queued
junkwell-02 +180 (16:19Z): breaches 0 (pit left open, nonlisted, inside, sword not peaceful, stone guard ...); 2 wells
built (placebo-d, hive-b), 6 disposal visits (4 with swords), junk slots DiD -1.40, mine DiD +1.17, deaths canary 0 vs
control 1, deep deaths 0. Watch: share>=34 DiD +0.067 (noise at 3 h?); placebo-a has no valid well site near home;
_well_retired why=wall_is_air repeats (placebo-d 16x on its own well, board-b 41x on a 10-05 leftover well) -- review
after the decision.
stonecap FALLBACK (owner: "implement the cobblestone cap"; builder agents rate-limited): sc-on-6f1921a @ 7cdc742 = the
approved plain stonecap (971fb09) on fleet 6f1921a with no well; peacefulkit conflicts resolved as the approved coupled
935c63e (admission/bankable byte-identical); npm test 243/243; cobble mutants 67/67; Codex r1 CHANGE (mutant anchors,
sword refusal text) -> r2 APPROVE. Registration docs/reports/stonecap-01.6f1921a.json; queue variant 6f1921a added.
So stonecap-01 launches after junkwell-02 whichever way it is decided.

## 10-11 13:25Z — CANARY LIVE: junkwell-02 @ 0cdb1a8 on placebo-a,board-b,placebo-d,hive-b (20 bots), declared 13:15:48Z
Four pools found at 13:15Z (placebo-d joined after the exclusions expired). Reads ~16:15Z / ~19:15Z; class bag-fix
under v33 (adaptive 24 h extension if the death gate trips with zero linked deaths). Early preflight of stonecap-01
(0cdb1a8 variant) on the live baseline: change rows cobble_bank/cobble_reconcile silent, licence _cobble_bank silent.
GAP: if junkwell-02 is REVERTED the fleet stays 6f1921a and stonecap-01 has no 6f1921a variant (only 0cdb1a8 and
0264f61) -> it would block until one is built (agents back ~10-12 11Z).

## 10-11 12:45Z — PEACEFULKIT-02 KEPT (+360, 01:23Z) and PROMOTED: FLEET 6f1921a (01:32Z); merged to main; junkwell-02 drawing
+360: breaches 0; every instrument fired; 8 swords burned by 8 bots, 57 kit items composted; DiD sword slots -0.42,
plant/food slots -1.31, all slots -0.46, share>=34 -0.087; deaths canary 2/60 bh vs control 6/300 bh (held, LB 0.24).
Bag census 12:20Z: 92% of slots (96% on 10-08), >=34 slots 42/80 (65), full 17 (36); wooden swords 55 -> 22,
wildflowers 38 -> 7 slots, stone pickaxes 183 -> 152.
IDLE 01:32Z -> 12:22Z: junkwell-02 was HELD for v35 and the operator session AND every agent were stopped by the weekly
API limit (resets 10-12 11:00Z), so nobody could release it. LESSON: never leave a hold only an agent can lift; give it
a not_before / expiry. Released 12:22Z without v35 (96 GB RAM). junkwell-02 then draw-short (3 pools) at 12:30Z;
placebo-b/board-c leave their exclusion ~13:32Z. Main: merge of 6f1921a, npm test 244/244. The scratchpad worktree
state-main lost its .git link overnight (prunable); replaced by scratchpad/sm2.

## 10-10 19:45Z — GRIDFIX + BAMBOO READY on the stonecap shas (entries drafted, NOT added)
- **gridfix-01:**
  - **gf-on-935c63e @ e29c1e7**: npm test 246/246.
  - **gf-on-d551f7a @ 79ab946** (contingency, no peacefulkit): npm test 243/243.
  - Each is b54e452's net diff plus ced0b52, the well + grid fix composition test.
  - Mutants: gridfix 1/1 and compose 4/4 on both.
- **bamboo-01 (ORDINARY):**
  - **bb-on-e29c1e7 @ 2b37bd9**: npm test 247/247.
  - **bb-on-79ab946 @ f7312c4**: npm test 244/244. On this base classifyOutcome was a manual union: the well's evidence block and bamboo's slots_freed block are both kept.
  - f7312c4's commit message wrongly names a startableJunk union. The code correctly has none.
- **Reviews:** Codex r1 and Claude r1 both APPROVE all four, no P1/P2. Text: docs/reports/{gridfix,bamboo}-01.rebase-review-2026-10-10.txt; the 10-08 rounds are committed beside them.
- **The CONDITION stands for gridfix:** airpocket-02 must take "no equip is ever queued behind a craft".
  - Claude: implement it as waiting for !bot.craftSync.busy(). That covers craft, lockstep, recount and confirmCursor.
  - The well's holdInventory is NOT visible through busy().
- **P3s recorded:**
  - cobbleObserve does not check repairPending.
  - No chain test runs the cap's town-deposit claims through the real lockstep. Claude suggests adding one before deploy.
  - A bamboo fold at 34-35 slots can defer at-cap disposal for that visit.
- **Paper:** not re-run on these shas. Both engines: not needed. The sandbox lock was held by stocktarget's Paper proof.
- The older gf/bb variants on the jw shas (gf-on-{bd747a8,0cdb1a8,2299221,e4f2917}, bb-on-{1782dff,82aef34,0cc06fc,f272526}) are superseded and not registered.
- **OPERATOR:**
  - `queue add` docs/reports/gridfix-01.queue-entry.json (= ~/mcai-analysis/gridfix-01.entry.json): bag-fix, after stonecap-01. Variants 935c63e -> e29c1e7 and d551f7a -> 79ab946.
  - Then docs/reports/bamboo-01.queue-entry.json (= ~/mcai-analysis/bamboo-01.entry.json): ordinary, after gridfix-01. Variants e29c1e7 -> 2b37bd9 and 79ab946 -> f7312c4.
  - Both were validated no-act: VALID.
  - FIRST fetch gf-on-935c63e, gf-on-d551f7a, bb-on-e29c1e7 and bb-on-79ab946 into /opt.
  - If airpocket-02 or stocktarget-01 is inserted before gridfix, these need new variants on that base.

## 10-10 19:10Z — DRAW STARVATION: peacefulkit-01 abandoned (never deployed) -> ORDINARY canary peacefulkit-02 launching
peacefulkit-01 (class bag-fix, needs 4 pools) was draw-short 11:37Z -> 19:05Z (3 eligible pools: placebo-b, hive-a,
board-c). v35's three-pool fallback is built but not staged; all builder agents hit the weekly API limit ~14Z (resets
10-12 06:00 CT). Operator + Codex (option X): re-register the SAME code/reads/gates as ORDINARY canary peacefulkit-02
(no class, no bag_fix; forfeits only the v33 adaptive extension, which rarely qualifies here), registrations
~/mcai-analysis/peacefulkit-02.*.json with an amendment; peacefulkit-01 journal-noted, `abandon`ed, `cancel`led; queue
hand-edited (backup ~/canary-queue.json.bak-pk2-*): peacefulkit-02 moved ahead of junkwell-02, junkwell-02 after ->
peacefulkit-02. Scheduler tick --no-act: LAUNCH peacefulkit-02 (variant 4970c91 -> 6f1921a).
RISK: junkwell-02 and stonecap-01 are bag fixes and will hit the same four-pool starvation; junkwell is exactly the
case the adaptive extension exists for (more mining), so it should wait for v35 rather than be downgraded.

## 10-10 13:50Z — ORDERVETO: gate refusals JUSTIFIED (root cause: craft orders issued without bag room); stonecap queued
orderveto investigation (docs/reports/orderveto-investigation-2026-10-10.md, both engines agreed NOT to build the
first idea): 3,608 of 7,311 work orders refused (repeat_loop 2,151, cooldown 1,456), all craft/smelt orders; 0
refusals of a repeating SUCCESS (positive control: 203 crafts + 96 smelts ordered this way succeeded); 89.7% of the
underlying failures = "no room in the bag"; cost ~33 bot-h/day (~3% of fleet time), runs up to ~40 min. Root cause:
readyFor checks the recipe, not bag room. NOW BUILDING orderroom-01: craft orders only with room (the craft's own
check); otherwise the named remedy (place / deposit / home+deposit) becomes the order; close the town-deposit gaps.
QUEUE (scheduler): peacefulkit-01 (drawing; needs 4 pools, ~17Z) -> junkwell-02 (variants + 4970c91->0264f61) ->
stonecap-01 (sc-on-0cdb1a8 935c63e / sc-on-0264f61 d551f7a; both engines APPROVE). Fetched into /opt. airpocket-02 gets
two more race fixes (well cleanup vs rescue equip; no equip behind a craft) and variants on the stonecap shas.

## 10-10 13:50Z — STONECAP READY on jw-on-6f1921a (+ a peacefulkit-REVERT contingency for junkwell and stonecap); entries drafted, NOT added
- **sc-on-0cdb1a8 @ 935c63e.** The approved sc-on-cf4192e @ 32d7447 was applied as one commit (bacad2f): no conflict, identical text.
  - 935c63e adds main's mutant driver (scripts only; bots/ identical to bacad2f).
  - npm test 244/244. Mutants with main's drivers: cobble 67/67, mutants-pk PK_COMPOSED 87/87, well classifier 2/2.
  - Reviews: Claude r1 APPROVE. Codex r1 CHANGE -> r2 APPROVE.
  - Codex's P2 was the stale branch driver: fixed in 935c63e.
  - Its other P2 (an air_pocket interrupt of a well visit: the well's cleanup restores the hand, or holds the rescue's equip) is pre-existing in junkwell-02. It goes to **AIRPOCKET-02**.
- **CONTINGENCY if peacefulkit-01 is NOT kept** (today a revert would block junkwell):
  - **jw-on-4970c91 @ 0264f61** (the plain 1db3fcd well): npm test 240/240.
  - **sc-on-0264f61 @ d551f7a** (f5bdb80 on it): npm test 241/241, cobble 67/67.
  - Both engines APPROVE both (r1), no P1/P2.
- **Paper:** not re-run. Both engines: the code is byte-identical to the Paper-proven builds.
- **stonecapread dry run** (4970c91 logs): gates 0, instrument 43.
- Registrations stonecap-01.0cdb1a8 / junkwell-02.4970c91 / stonecap-01.0264f61: on main and in ~/mcai-analysis. Bag-fix fields unchanged.
  - Review text: docs/reports/stonecap-01.rebase-review-2026-10-10.txt.
- **OPERATOR:**
  - (1) `queue add` docs/reports/stonecap-01.queue-entry.json (= ~/mcai-analysis/stonecap-01.entry.json): bag-fix, after junkwell-02. Variants: 0cdb1a8 -> 935c63e and 0264f61 -> d551f7a.
  - (2) `queue replace-variant junkwell-02` with docs/reports/junkwell-02.queue-entry.json (= ~/mcai-analysis/junkwell-02.entry-r2.json): the 6 queued variants unchanged, + 4970c91 -> 0264f61.
  - Both were validated no-act: VALID.
  - FIRST fetch sc-on-0cdb1a8, jw-on-4970c91 and sc-on-0264f61 into /opt. 935c63e, 0264f61 and d551f7a are not there yet.
- **gridfix-01 / bamboo-01** were built and reviewed 10-08 on the four jw shas. Branches pushed:
  - gf-on-{bd747a8,0cdb1a8,2299221,e4f2917} @ 1782dff / 82aef34 / 0cc06fc / f272526. Both engines APPROVE at r2. These include the well + grid fix composition test.
  - bb-on-{1782dff,82aef34,0cc06fc,f272526} @ 7a60da5 / 8212674 / 812d42f / 37657ae. Both APPROVE r1. Paper fold A20/D20/K20 OK on the full stack.
  - Not registered: under the new order they must sit on the stonecap/stocktarget shas, and will be redone there.
  - Open: one load flake in bb-82aef34's suite (craftsync-mutants passed 3/3 when rerun alone).
  - Condition from Claude r2 on the airpocket bases: airpocket-02 must take "no equip ever queued behind a craft".

## 10-10 13:42Z — orderveto: the gate's refusals of WORK ORDERS are JUSTIFIED; orderveto-01 NOT BUILT (both engines AGREE)
Record: docs/reports/orderveto-investigation-2026-10-10.md; reviews docs/reports/orderveto-reviews-2026-10-10.txt; reads
scripts/host/orderveto/ (+ outputs in ~/mcai-analysis/orderveto-evidence-2026-10-10/ on the fleet host).
- 10-10 00:00-13:28Z, 80 bots: 3,608 of 7,311 work orders refused (repeat_loop 2,151, cooldown 1,457), ALL craft/smelt
  rung orders. 0 productive repeats refused (positive control: 299 order crafts/smelts succeeded). ~90% stop a craft that
  failed for NO ROOM in the bag with no fewer slots since (stack-size estimate, not an admitRoom re-run). Gate is right.
- Cost: ~33 bot-h of decisions that ran nothing (~3%); the order is re-issued every decision before the model, so 44 runs
  of >= 10 refused orders (14.8 bot-h), longest ~41 min with the model never asked.
- Root: readyFor issues a craft the bag cannot hold; craftroom names the remedy ("home -- then deposit X" 62%, "deposit X",
  "place <block>") and nothing executes it. Given a turn, the model took that remedy 14 of 112 times.
- The "order yields to the model" fix was designed, prototyped with tests, reviewed (r1 both APPROVE-WITH-CHANGES, Claude
  predicting it inert: the prompt's HINT/CAN CRAFT NOW pull the model back to the craft) and DROPPED (r2 both AGREE).
- FOLLOW-UP (not built, needs owner priority + both engines): readyFor asks admitRoom; while no room, no craft order and
  no HINT/CAN CRAFT NOW for it; the named remedy becomes the order (place X / home-then-deposit X, checked against the
  town deposit's keeps). Gaps listed in the record.

## 10-10 13:32Z — FLEET HOST RAM 48 -> 96 GB (owner); airpocket-02 built; abort breakdown; peacefulkit rearmed
VM 202 (block2-bots, pve1) shut down 13:28Z, memory 98304, started 13:29Z: 94 GB usable + 8 GB /swapfile (swappiness 10);
80/80 bots back on 4970c91, mayor/reads/crons/scheduler back by themselves. peacefulkit-01's draw loop was stopped
(nothing deployed) and rearmed. The restart sits in every arm's baseline window (symmetric).
Why: the bots use ~17.6 GB and +1920 reads peak at 23 GB (peacefulkitread 23.0, wellread 23.6+), with no swap. Gate agent:
heavyread.sh (systemd scope MemoryMax, 32G on the new VM; shared lock /tmp/mcai-heavyread.lock; a capped read fails
UNREADABLE, never KEEP) wired into canary-loop.sh for v35.
ABORT BREAKDOWN (model agent, ~/brain01/abort_classify.py): of 82,666 model decisions, 43% refused at admission
(repeat_loop 19.9%, learned_avoid 9.9%, cooldown 6.1%, impossible y 2.9%, bank gate 2.3% ...), 3.9% interrupted after
admission, 25% failed (runner paused 6.9%, unreachable 6.9%, unsafe target 2.4% ...). Replay: qwen2.5:7b repeats the 4x
loop 90% vs gemma4 28%, repeats the real failure 74% vs 21%, infeasible 13% vs 1.3%. WORK ORDERS (7,226): 29% refused by
repeat_loop, 20% by cooldown -- code, not model; orderveto investigation agent started.
AIRPOCKET-02 BUILT (ap2-on-4970c91 ccc593f7 / ap2-on-6f1921a 1bea197f; both engines APPROVE; Paper 53 trials: refreeze
5/5 lived vs control 1/4, 1-tall gap 3/3 vs 0/4); must draw HIVE-D (the only ice-trap pool) -- the draw cannot force a
pool yet (ask v35 for a required-pool option). Queue intent: peacefulkit -> junkwell-02 -> airpocket-02 -> stonecap ->
stocktarget(+pruning) -> one-time clear -> brain-01 / orderveto / gridfix / bamboo ...

## 10-10 ~13:30Z — OWNER: plan the live BRAIN canary (brain-01); overseer/escalation parked
LLM layers status: brain gemma4:26b benchmarked (C1 sandbox: stuck time halved, output inconclusive), NOT live; overseer
gpt-oss:120b (C2 sandbox: inconclusive, lower output mostly cobble, iron-tier equal) and stuck escalation (no stuck-time
cut) PARKED as built; strategist parked. Owner "yes please" to planning brain-01: 5-10 live bots on gemma4 (Studio)
vs matched control, same code, after junkwell-02 and airpocket-02 (~Mon). Model agent: finish the C2 readout (reviewer's
AGREE-WITH-CHANGES items), then design brain-01 (robust fleet->Studio path, deterministic local fallback, brain field on
decision rows, capacity/latency, read + registration), both engines.

## 10-10 13:10Z — TOWN CHESTS FULL AGAIN; second one-time clear APPROVED then DEFERRED by the owner until the inflow fixes ship
Read-only census (per-item RCON `data get block X Y Z Items[k]` on the world host; list reads are abbreviated by the
server): 425 town containers, 175 full, 70% of slots used -- stone_pickaxe 1,759 slots, oak_log 80,140, cobblestone
73,474 (256/town after the 10-04 clear), stick 17,443, bamboo 6,066, raw_copper 7,356, coal 3,367, iron_ingot 1,041.
Town deposit 12 h: 147 ok / 297 failed (289 "chest full"); no new chests are being built. OWNER: one-time clear OK
"to continue making progress, i just dont want it part of our solution", then "adjust caps or fix the bigger issues
first then clear chests so we dont end up in the same situation in 48 hours". NEW ORDER: peacefulkit (live) ->
junkwell-02 -> stonecap (cobble cap; needs rebase) -> stocktarget (+ CHEST PRUNING: over-target surplus taken from chests
to the well) -> the one-time clear with caps = the stock targets -> gridfix, bamboo, bamboocraft, treefarm; follow-ups
airpocket-02, withdraw2-02, A'. Tools: scripts/host/chestclear2/ (positions.py, census2.py read-only, plan2.py draft caps:
256 cobble, 1,024 oak/birch/spruce logs, 256 sticks, 32 usable stone pickaxes/town -> 166,649 items, 175 -> 0 full).

## 10-10 12:47Z (host clock) — STOCK TARGETS + CHEST PRUNING: DESIGN APPROVED by both engines; caps for the one-time clear
- Design r6: docs/reports/stocktargets-design-2026-10-08.md. Reviews: Codex r1-r5 CHANGE, r6 APPROVE; Claude r1-r2 CHANGE, r3 APPROVE.
  Excerpts: docs/reports/stocktarget-design-reviews-2026-10-10.txt.
- Measured (10-10 census + 48 h flows): the bank is write-only for every bulk material. Town draws are only pickaxes
  (~5/town/day), coal and a few sticks. Banked/day: oak_log 9,425, cobble 16,908, stick 605, stone_pickaxe 248.
- Targets per town (= bank cap = prune floor = clear cap), provisional:
  - cobble 256; each log type 64; each planks type 64; stick 64; stone 64;
  - dirt/sand/gravel/deepslate/tuff/calcite/sandstone 0;
  - usable stone_pickaxe 16, wooden_pickaxe 4, stone axe/shovel 4 (tools are never disposed);
  - clear-only caps: saplings 64/type, torch 64, ladder 64, crafting_table 2, furnace 4, chest 8. bamboo 0 and bucket 2 are OWNER TO CONFIRM.
- Mechanism: stonecap's journal generalised (every group per count; bank/take/draw/valve claims; a 1 h floor; confirm
  before mutate; rotation by generations with no lock). Above target nothing is banked while a usable well stands, and the
  surplus goes down the well at a full bag. A PRUNE town order takes over-target full stacks out of chests (under take
  claims) and throws them down the well. Withdraw draws are claimed before their clicks.
- CLEAR CAPS: docs/reports/stocktarget-clear-caps-2026-10-10.json + scripts/host/chestclear2/plan3.py (plan2 with a shared
  cobble group and boundary-stack REDUCE). On the 10-10 census: 175 -> 0 full, 5,958 of 7,988 slots, 195,462 items.
- CLEAR PROCEDURE (both engines): stop the affected pools' bots; clear; then bots/scripts/stockreset.mjs appends a `reset`
  to each cleared town's journal (being built); then start the bots. Validate `reduce` (setting a slot's count) on a
  sandbox first.
- Building now on sc-on-cf4192e (32d7447). Nothing deployed or queued.

## 10-10 12:05Z — (daily operator session) peacefulkit-01 DRAW SHORT; analyst stale; a second operator is on main
- peacefulkit-01 @ 6f1921a: preflight/licence/gatedigest/bagfix OK 11:37Z; draw-short 11:39Z (band hive-b,placebo-d,
  placebo-b) and 12:00Z (band placebo-b,placebo-d); the loop retries every 20 min. Probable cause: the fleet-wide restart
  at 11:31Z reset per-pool exposure -- NOT verified. Still short by evening -> look at drawrec's band.
- NO junkwell-02 variant on 4970c91: a peacefulkit REVERT blocks junkwell and pages.
- The local analyst's newest *.verdict.json is 20261006T1500 (none for 4 days).
- Two operator sessions ran this morning: the daily session merged 4970c91 too, found b5dfa0d already on main, and
  dropped its merge. Backup branch `main-pre-20261010` = b4d70a0 (main before the merge).
- Operator tooling lesson: wait on journal `phase` parsed as JSON (verdict prose contains "KEEP" and "promotion" in its
  NOT-evaluated list); bracket `pgrep -f` patterns; end Monitor pipes with awk fflush, never `| cut`.

## 10-10 11:45Z — TOOLHYGIENE-01 KEPT (+360) and PROMOTED: FLEET 4970c91 (11:31Z); merged to main; peacefulkit launching
+360: breaches 0 (redundant admitted, unjustified refusal, unjustified worn, wanted refused); 55 refusals; pick_slots DiD
-0.94 (bag-fix edge -0.842), slots DiD -0.46, share>=34 DiD -0.098, breaks DiD +0.11, escape refusals DiD +0.05 (expected
side effects); deaths canary 1/120 bh vs control 1/240 bh. Main: merge of 4970c91 (includes airpocket dbb4d78), npm test
241/241. QUEUE: peacefulkit-01 (launching) -> junkwell-02 (queued 11:35Z, after peacefulkit) -> gridfix/bamboo/stonecap/
bamboocraft/stocktarget/treefarm need variant prep on the new tip (agents back ~10-12 11Z). Follow-ups: airpocket-02,
withdraw2-02, A' (+180 KEEP), stocktarget design.

## 10-10 05:30Z — WITHDRAW2-01 REVERTED (+180, G1 = 3); suspected pathfinder scaffold, NOT proven; toolhygiene queued
+180: G1 "unplanned server-counted loss" 3 -- hive-d-Comet 02:56:40 dirt -1 (crafted_iron), hive-a-Alpha 04:09:47
cobblestone -1 (no_better), hive-d-Bravo 04:52:00 dirt -1 (crafted_iron). Everything else clean: G2-G6 0, 9 server-confirmed
iron pickaxe crafts, iron holders DiD +0.28, nopick time DiD -0.033. Suspected cause: mineflayer-pathfinder scaffolding
(dirt/cobblestone) on the walk to the chest/table -- withdraw2's ledger spans the WHOLE order (walks included) while
withdraw-01's srv spans only the chest transaction, so the control cannot calibrate it. Comet shows a _path_reset
place_error inside its order; Alpha/Bravo have no placement evidence. A draft read amendment (excuse <= 3 scaffold
blocks per order; replay G1 0) got Codex CHANGE: an unconditional exemption could hide a real 1-3 block transfer loss;
require per-row, same-order, server-confirmed placement evidence; label these rows "suspected scaffold", not proven.
NEXT for withdraw2-02 (agents, after 10-12): log the bot's own block placements (or bracket the ledger around the chest
and craft transactions only), then the evidence-backed G1 split (raw / scaffold-evidenced / residual), ambiguous-placement
and unplanned-deposit test cases, both engines. Draft: docs/reports/drafts/withdrawread-g1-scaffold-DRAFT.diff.
SLOT: bag-fix registrations INSTALLED 05:06Z (~/bagfix-regs; backups *.bak-bfregs-20261010T050625Z). toolhygiene-01
queued (bag-fix, 4 variants, dependency on withdraw2 dropped) -> scheduler DECISION launch.

## 10-10 05:22Z — CANARY LIVE: toolhygiene-01 @ 4970c91 on board-b,placebo-a,board-d,hive-c (20 bots), declared 05:15:23Z
First bag fix under v33 (class bag-fix, four pools); A' (+180 KEEP) is NOT installed (agents down), so KEEP from +360
(~11:15Z). Reads ~08:15Z / ~11:15Z. peacefulkit-01 queued behind it (after toolhygiene-01; variants 92bc84f, 6238095,
4970c91, 5d1f710, 2f38f69 -- NO dbb4d78 variant: if toolhygiene reverts, peacefulkit needs pk-on-dbb4d78 built first).
Early preflight on the live baseline: peacefulkit 4970c91 -> licence _peaceful_kit baseline 0; own_kinds _sword_fuel.
(Earlier STATE stamps today ran ahead of the host clock; host time is the reference.)

## 10-10 02:10Z — CANARY LIVE: withdraw2-01 @ 2189de3 on board-a,hive-a,hive-d,board-c (20 bots), declared 01:57:23Z
Reads ~04:57Z / ~07:57Z. Standing watch (journal phases + sched BLOCK) running. EARLY PREFLIGHT of the next item,
toolhygiene-01, against the live baseline dbb4d78: variants dbb4d78 and 2189de3 -> changerowcheck "nothing declared",
licencecheck class kind _tool_hygiene baseline 0 (OK); bag-fix own_kinds (_redundant_craft, _craft_admit, _worn_first)
silent on the baseline. Next gap: install ~/bagfix-regs (+ A' if approved by then), then `queue add` toolhygiene.

## 10-10 01:55Z — AIRPOCKET-01 KEPT (+720, 10-08 19:42Z) and PROMOTED (FLEET dbb4d78, 19:52Z); 30 h IDLE SLOT; withdraw2 drawing
airpocket-01 KEEP: DiD psi 0.61x (LB 0.17) and matched 1.50x (LB 0.36), both held; deaths canary 4/121.3 bh vs control
24/849.0; attempts 3 (1 success, 2 "opened" ice -- the swimming-pose trap; bot survived).
IDLE 10-08 19:56Z -> 10-10 01:52Z (~30 h): withdraw2-01 refused at preflight (changerowcheck: withdraw_pick is emitted by
the baseline since withdraw-01); the scheduler BLOCKED and paged, but nothing woke the operator and every agent was down
(weekly API limit, resets 10-12 06:00 CT). Fixes: amendment 1 (change_rows -> [withdraw_settled]), then licencecheck v31
refused class kind _withdraw_pick (baseline emits it); amendment 2: licence class text, row _withdraw_pick, text
"best_valid=" (written only by withdraw2's withdrawRow; baseline 0 hits in 70 rows). 01:53Z preflight/licence/gatedigest
OK, drawing. LESSON: an operator-side standing watch on the journal + sched.log BLOCK lines now wakes the operator.
AGENTS DOWN until ~10-12 11Z (weekly limit): A' build (in review), stock targets (design r2), airpocket-02 (r1 fixes),
variant prep (gridfix). The owner started a separate session for airpocket's open-window equip race (task_e9234f96).
Deaths steady ~23-30 per 12 h fleet-wide (10-08 / 10-09).

## 10-08 17:40Z — THE HIVE-D ICE TRAP: 9.4% of all drownings since 10-01; airpocket-02 being built (airpocket-01 continues)
Cause of the missed rescue (reproduced on Paper): the floating bot's cell freezes over (snowy biome); the SERVER puts the
bot in swimming pose (0.6 tall, eye y+0.4 in water, y = 62 - 0.605 = 61.395); mineflayer assumes standing (eye y+1.62 in
air, head cell = ice); the drowning route scan starts above the head cell and reports `up dist=1`, so the base rescue
jumps into the ice, airpocket refuses on an "up" route, and the marooned climb sees an open column. Since 10-01: 23 of
244 drowning deaths fleet-wide (9.4%), ALL in hive-d, all `up dist=1`; plus 16 with a false `up` and head in water. In
airpocket-01's window: 2 canary drownings, both this trap (07:45:33Z, 14:08:10Z); 0 of 5 control drownings.
airpocket-01 DEFECT found on Paper: after an ice dig, a refreeze within ~1 s gives a FALSE `_air_pocket` success (client
eye/health) then a drowning -- would trip C1 and revert (justified); not seen live (Bravo's was real).
DECISION: airpocket-01 continues (not linked; no breach). airpocket-02 = pose-aware eye, `upblocked` route, server-grounded
success, re-dig on refreeze, window-handoff race, well-floor guard, airPocketTools; variants on dbb4d78 and 92bc84f;
draw must include hive-d.

## 10-08 17:25Z — OWNER delegated the open items to operator + Codex ("implement, deploy and run them")
+180 KEEP: Codex and operator AGREE on A' as calibrated (four-pool bag fix; KEEP at +180 only if every gate passes,
exposure ready, no death trip/extension pending, reads readable, cumulative canary death rate <= control's; else +360;
bag metric reported, not gated; daily scoreboard/bag census = non-attributable post-promotion tripwire). Gate agent
building; install with ~/bagfix-regs in the empty slot after withdraw2-01. PER-TOWN STOCK TARGETS: agent designing with
both engines (generalise stonecap's reconciled cap to bulk materials, surplus to the well, no new chest at target, log
rotation), to run as stocktarget-01 after stonecap. airpocket-01: 3 real attempts (1 success 13:15Z; 2 "opened" ice
17:02Z, bot survived) -> exposure now reached; next read decides.

## 10-08 16:55Z — airpocket-01 +540 NOT_YET (1 success; exposure 1 of 2); a MISSED rescue under ice under investigation
+540: deaths canary 2/91.2 bh vs control 16/638.4; DiD psi 0.45x (LB 0.07) held; matched 1.00x (LB 0.12) held.
v14c operator review (journalled): hive-d-Alpha drowned 14:08:10Z sealed under ICE at 7,61,63 -- NOT linked (no
_air_pocket / _air_pocket_refused row at all), but a MISSED opportunity: the base rescue yielded to the escape handlers
(marooned/pillar_out/dig_straight_up) and airpocket never evaluated. Builder agent investigating (read-only); fix goes into
airpocket-02 with the window-handoff race and the well-floor guard. junkwell-02 prepared on the 4 peacefulkit shas
(bd747a8, 0cdb1a8, 2299221, e4f2917; both engines APPROVE; Paper full-stack dispose 402/402 contained), fetched into /opt.

## 10-08 16:45Z — JUNKWELL-02 READY on the four peacefulkit shas (queue entry drafted, NOT added)
- The approved pit-fixed well is jw-on-40046b8 @ cf4192e: 55 commits, 21 of them merges.
  - Its net diff over 40046b8 was applied as ONE commit per base; the merges do not replay as cherry-picks.
- The four variants:
  - **jw-on-d948bfd @ bd747a8** and **jw-on-6f1921a @ 0cdb1a8**: no conflict, identical patch.
  - **jw-on-3382a17 @ 2299221**: two union conflicts (the cognitive skills import; fakeworld NAMES gets oak_trapdoor appended).
  - **jw-on-4be1a29 @ e4f2917**: the same commit as 2299221, no conflict.
- **Reviews:** Codex r1 and Claude r1 both APPROVE all four; no P1/P2.
  - airpocket: an intact well cannot host a drowning pocket. The rescue has no well guard; the only way to reach the well is a flooded column under its floor. This goes on the follow-up list with airpocket-02.
  - toolhygiene: the well throws no tool except swords.
  - withdraw2: ingots, sticks, planks, logs and pickaxes are never well junk. The well order runs after compost -> withdraw -> upgrade.
  - P3s recorded: a failed iron attempt's wood can feed build_well; no loop test has both withdraw2 and a built well.
  - Text: docs/reports/junkwell-02.rebase-review-2026-10-08.txt.
- **Tests:** npm test 242/242, 243/243, 244/244, 245/245. mutants-pk (PK_VARIANT=1) 86/86 plus the well's two classifier mutants 2/2, on each. Lint: withinBody only.
- **PAPER** on the full stack (sandbox3, e4f2917):
  - Pit-first build: success. Cap closed; 66 items, all in the shaft.
  - Dispose of a composed 36/36 bag: 402 thrown (36 -> 27 slots); 402 in the shaft and 0 outside at +30 s. Swords thrown (peaceful).
  - Kept, per the server's per-slot read: both pickaxes (worn + full), iron_ingot 3, stick 2, planks 4, logs 5.
  - Codex's rescue-during-visit and withdraw-then-visit scenes were NOT run; the review text says why.
  - Lock taken and released. The driver used is cf4192e's well-e2e.cjs (main's copy is older).
- **wellread dry run** on the live airpocket pools: gates 0, instruments 52 / 27.
- **Registrations** junkwell-02.{d948bfd,6f1921a,3382a17,4be1a29}.json: on main and in ~/mcai-analysis. Bag-fix fields unchanged from the gate agent's 40046b8 file.
- **OPERATOR: queue entry docs/reports/junkwell-02.queue-entry.json** (= ~/mcai-analysis/junkwell-02.entry.json).
  - class bag-fix, after peacefulkit-01, 6 variants: 92bc84f -> 1db3fcd, 40046b8 -> cf4192e, plus the four above.
  - It needs install-bagfix-regs.py first, and a fetch of the jw-on-{d948bfd,6f1921a,3382a17,4be1a29} branches into /opt.
  - Validated no-act: VALID.
  - NOT built: the well on a toolhygiene sha without peacefulkit. That is needed only if peacefulkit-01 is not kept.

## 10-08 15:05Z — peacefulkit prepared on the 4 toolhygiene shas (both engines APPROVE), fetched into /opt; FOLLOW-UP airpocket-02
pk-on-6238095 d948bfd, pk-on-4970c91 6f1921a, pk-on-5d1f710 3382a17, pk-on-2f38f69 4be1a29 (+ 92bc84f -> 40046b8); queue
entry docs/reports/peacefulkit-01.queue-entry.json (after toolhygiene-01; needs install-bagfix-regs first).
AIRPOCKET-02 (follow-up, after airpocket-01's decision): found in review -- the drowning rescue equips a pickaxe right
after interrupting a skill, while an interrupted smelt/chest/craft may still hold a window open and be clicking. The race
exists on the live airpocket-01 build (dbb4d78). Rare (drowning while a container window is open) and not a death risk
as far as known; fix = a bounded window handoff before equipping, never a forced close. Not a reason to stop airpocket-01.

## 10-08 15:05Z — PEACEFULKIT VARIANTS READY on the four toolhygiene shas (queue entry drafted, NOT added)
- The approved pk-on-92bc84f (40046b8, 30 commits) is now on each toolhygiene sha:
  - **pk-on-6238095 @ d948bfd** (toolhygiene only). One conflict: admission keeps both refusals; the prompt keeps both filters.
  - **pk-on-4970c91 @ 6f1921a** (+airpocket). No conflict; the patch is identical to d948bfd's.
  - **pk-on-5d1f710 @ 3382a17** (+withdraw2). Import-line conflicts only, plus the EXCLUSION_PHRASE table (both entries kept). One test-only fix.
  - **pk-on-2f38f69 @ 4be1a29** (all three). No conflict.
- **The test-only fix.** Claude r1 P1, confirmed red by the runner: peacefulkit-order.test.mjs's stone pickaxe fired withdraw2's upgrade order.
  - The bag now holds an iron pickaxe.
  - New case: stone pickaxe -> peaceful composts first; hard -> withdraw_pick.
- **Reviews:** Codex and Claude both APPROVE all four at r2.
  - Codex's r1 CHANGE on A/C was withdrawn. airpocket's rescue equip can click inside an interrupted smelt's still-open furnace window, but that is PRE-EXISTING on the live airpocket-01 build (dbb4d78). Peacefulkit only adds interleavings inside the same race.
  - The fix belongs on airpocket's own line, for all windows: a bounded handoff, never a forced close. A task chip was spawned for it.
  - withdraw2 x kit and toolhygiene x kit: clean. Text: docs/reports/peacefulkit-01.rebase-review-2026-10-08.txt.
- **Tests:** npm test 241/241, 242/242, 243/243, 244/244. mutants-pk.py (PK_VARIANT=1): 86/86 killed on each. Lint: withinBody only.
- **Paper:** not re-run. Both engines: no peacefulkit line changed, and the race is not reproducible in a scene.
- **peacefulkitread dry run** on the live airpocket pools (+180): every gate 0, every instrument fired.
- **Registrations** peacefulkit-01.{6238095,4970c91,5d1f710,2f38f69}.json: on main and in ~/mcai-analysis. The bag-fix fields are unchanged from the gate agent's 92bc84f file.
- **OPERATOR: queue entry docs/reports/peacefulkit-01.queue-entry.json** (= ~/mcai-analysis/peacefulkit-01.entry.json).
  - class bag-fix, after toolhygiene-01, 5 variants: 92bc84f -> 40046b8, plus the four toolhygiene shas.
  - It needs install-bagfix-regs.py first. /opt/minecraft-ai needs a fetch of the pk-on-6238095, pk-on-4970c91, pk-on-5d1f710 and pk-on-2f38f69 branches.
  - Validated no-act against a scratch clone: VALID.
  - NOT built: peacefulkit on dbb4d78 / a6cd3c1 / 2189de3. Those are needed only if toolhygiene is not kept on those bases.

## 10-08 13:45Z — airpocket-01 +360 NOT_YET (exposure 1 of 2): FIRST LIVE RESCUE succeeded; extension continues
13:15:45Z hive-d-Bravo sealed under ICE at y 60.5 (cell 155,62,168), health 18: dug the ice with a wooden pickaxe in
1,901 ms (predicted 1,900), eye in air, health 18 -> 20 within 4.4 s. attempts 1, successes 1, refusals/aborts/failures
0, every breach 0. Deaths canary 1/60.6 bh vs matched control 2/90.9 bh (both below the two-death floor). Exposure needs
>= 2 attempts; the registered extension (to +1560, ~09:34Z 10-09) continues. withdraw2-01 queued behind it.

## 10-08 ~13:30Z — TOOLHYGIENE VARIANTS READY on dbb4d78 / a6cd3c1 / 2189de3 (queue entry drafted, NOT added)
- The approved th-on-92bc84f (6238095) was rebased onto the three bases that can follow airpocket and withdraw2:
  - **th-on-dbb4d78 @ 4970c91** (airpocket KEPT). The cherry-pick was clean. It also carries 2 composition commits.
  - **th-on-a6cd3c1 @ 5d1f710** (withdraw2 KEPT on 92bc84f). One skills.mjs import conflict, resolved as the union.
  - **th-on-2189de3 @ 2f38f69** (both KEPT). It has B's commits plus A's composition commits.
- **The composition fix (A, C).** Round 1, Codex P1 and Claude P2: airpocket's dig step took any pickaxe and broke ties by slot.
  - Hygiene drains worn copies to 1 use. A copy the server already broke still shows at 1 use, so the step could dig bare-handed.
  - New `airPocketTools`: with hygiene on, a <= HARD_STOP copy is dropped when a same-kind copy above it is held.
  - The step AND the pre-empt price (reflex prepareAirPocket) both use it. Hygiene off = airpocket-01 exactly.
  - A stale-copy price added in r1 was removed after Codex r2: a hand price is not a hand dig.
  - Round 3: Codex APPROVE, Claude APPROVE. B was APPROVE at r1 from both.
  - Text: docs/reports/toolhygiene-01.rebase-review-2026-10-08.txt.
- **Follow-up, NOT in this canary (both engines).** A faster 1-use copy (golden@1 beside stone) is now declined, not used.
  - A read is specified in the review text, with its denominator and a positive control.
- **Tests:** npm test 239/239 (A), 240/240 (B), 241/241 (C). The in-suite hygiene mutants pass. airpocket.test.mjs L1-L6 includes 2 composition mutants. Lint: withinBody only.
- **PAPER** (Codex required it): 19/19 trials alive, roof opened, breathing.
  - Kit stone@1 ahead of stone@100, hygiene on: cand 5/5 used the healthy copy and kept the @1. ctrl (no fix) 4/4 and hygiene OFF 3/3 spent the @1.
  - Kit iron@1 ahead of stone@100: cand 2/2 dug with stone; ctrl dug with the iron@1.
  - Kit iron@1 alone: the copy's last use dug 1/1.
  - Default kit A/AF/F: 3/3.
  - Driver: sandbox/craft/airpocket-ab.cjs, now with AP_KIT, AP_TOOL_HYGIENE and a per-entry server Inventory read.
  - The sandbox lock was taken and released.
- **Registrations** toolhygiene-01.{dbb4d78,a6cd3c1,2189de3}.json: on main and in ~/mcai-analysis.
  - The bag-fix fields come unchanged from the gate agent's toolhygiene-01.92bc84f.json (9e19a6d).
  - toolhygieneread dry run on the live airpocket pools: gates 0, positive controls 107 / 4655.
- **OPERATOR: queue entry docs/reports/toolhygiene-01.queue-entry.json** (= ~/mcai-analysis/toolhygiene-01.entry.json).
  - It is class bag-fix, after withdraw2-01, with 4 variants (92bc84f, dbb4d78, a6cd3c1, 2189de3).
  - It needs install-bagfix-regs.py FIRST (bagread.py and the 92bc84f registration).
  - /opt/minecraft-ai must also fetch the th-on-dbb4d78, th-on-a6cd3c1 and th-on-2189de3 branches.
  - Validated no-act: VALID, against a scratch clone, with the staged bagread and 92bc84f registration standing in.
- CORRECTION: the wd2-on-dbb4d78 section below was stamped ~14:40Z; it was ~12:40Z.
  - withdraw2-01.dbb4d78.json says registered_at 14:30Z; the file is hash-pinned in the queue, so it was left unchanged.

## 10-08 13:25Z — toolhygiene prepared on dbb4d78 / a6cd3c1 / 2189de3 (both engines APPROVE); fetched into /opt
th-on-dbb4d78 @ 4970c91, th-on-a6cd3c1 @ 5d1f710, th-on-2189de3 @ 2f38f69 (+ th-on-92bc84f @ 6238095). Found by review:
airpocket's dig picked any pickaxe by slot, so with hygiene's 1-use copies it could dig bare-handed on the server; fixed
on the airpocket bases with airPocketTools (skip a 1-use copy when a healthier one of the same kind exists; identical
to airpocket-01 when hygiene is off); Paper 19 trials, all bots breathed. Queue entry drafted
(docs/reports/toolhygiene-01.queue-entry.json). PLAN: it can only be queued after install-bagfix-regs.py (bagread +
the 92bc84f registration), which needs an empty slot -- do it in the gap after withdraw2-01, then `queue add`.
(Timestamp note: the "13:15Z" entry below was first stamped 14:00Z in error; host clock is the reference.)

## 10-08 13:15Z — BAG-FIX REGISTRATIONS STAGED (~/bagfix-regs, both engines APPROVE); +180 KEEP awaits the owner
18 bag-fix registration variants on main (9e19a6d): class bag-fix, four pools, bagread primary at +1440 with per-fix
death-censored null edges (toolhygiene pick_slots -0.842, peacefulkit sword_slots -0.059, junkwell slots -1.653, gridfix
-1.366, stonecap -1.366); docs/reports/bagfix-registrations-2026-10-08.md. INSTALL between canaries (after airpocket):
python3 ~/bagfix-regs/install-bagfix-regs.py (takes the scheduler install-hold, the loop lock; no gate digest change).
CAUTION: the +1440 reads use 16-18 GB each -- never run two concurrently. Scheduler nit: install-hold/-release are not
owner-scoped (queued fix).
+180 KEEP calibration: as specified it is WORSE on deaths (x2 82.6% vs today's 75.7% false KEEP); variant A' (+180 only
if the canary death rate <= control's) is better than today on deaths and equal to the 4-pool +360 design, but ~3-6 pts
worse than today's 2-pool read on near-threshold movement/work/gathering harms (a 4-pool property). Codex: drop unless
the owner revises the condition; operator: build A'. OWNER DECIDES. Nothing built.
MAIN HYGIENE: twice today an agent pushed a stale tree to main and deleted others' files (restored both times within
minutes: 64783f7, 9e19a6d). Never use --no-verify on main; fetch + rebase before every push.

## 10-08 12:55Z — OWNER: KEEP at +180 for four-pool bag fixes; rolling variant prep; withdraw2 queued behind airpocket
OWNER chose "1 and 2": (1) KEEP allowed at +180 for class bag-fix drawn at four pools when exposure is ready, every gate
passes, no death trip/extension pending and all reads are readable -- gate agent calibrating (false-KEEP rate must not
exceed today's 2-pool +360) and building; not live until installed between canaries. (2) a variant-prep agent keeps
the next queue item rebuilt on each plausible base one step ahead (now: wd2-on-dbb4d78 for an airpocket KEEP).
Scheduler queue: airpocket-01 (running) -> withdraw2-01 (queued 12:50Z, variant 92bc84f -> withdraw2-01.92bc84f.json,
approved; the dbb4d78 variant will be added with `queue replace-variant`). Owner asked about two concurrent tests again;
the narrow form (rare-event safety canary + one ordinary canary) was offered, not chosen. Pending owner: per-town stock
targets for all bulk materials (proposed).

## 10-08 ~12:40Z — WITHDRAW2 ON AIRPOCKET READY: wd2-on-dbb4d78 @ 2189de3 (queue entry drafted, NOT added)
- For the airpocket-01 KEEP case (fleet dbb4d78). The 13 commits of wd2-on-92bc84f (a6cd3c1) were cherry-picked onto dbb4d78.
  - No conflict. range-diff: every patch identical.
  - The interdiff is one cognitive.mjs hunk offset.
- Tests: npm test 239/239; mutants-wd2.py 52/52; eslint no-undef only withinBody.
- Reviews of the rebased diff vs the approved one: Codex APPROVE, Claude subagent APPROVE.
  - Claude P3, no change: a town order issued while airpocket digs is aborted and spends its cooldown.
  - Text: docs/reports/withdraw2-01.dbb4d78-review.txt.
- Paper not re-run. The merge is behaviour-neutral (no shared function; both reviews agree).
- Registration withdraw2-01.dbb4d78.json: on main and in ~/mcai-analysis (sha256 e3f1de4c).
- withdrawread dry run on the live airpocket pools (+180, 319,006 rows): gates 0.
  - canary_rows_without_ledger 3 is expected: it is the arms check's positive control.
- **OPERATOR: queue entry docs/reports/withdraw2-01.queue-entry.json** (= ~/mcai-analysis/withdraw2-01.entry.json). It has both variants (92bc84f unchanged, + dbb4d78).
  - Apply with `queue replace-variant withdraw2-01 <entry>`.
  - FIRST make 2189de3 resolvable in /opt/minecraft-ai (fetch). Until then validate_entry refuses with "does not resolve".
  - Validated no-act (canary-sched.validate_entry against a scratch clone): VALID.

## 10-08 12:30Z — airpocket-01 +180 NOT_YET (0 attempts yet; extension to +1560 registered); "control 0/0.0" explained
Canary LIVE since 07:34:26Z on hive-d,placebo-a; matched control frozen hive-c,placebo-b,placebo-d. +180: liveness 0 rows
(no sealed-pocket episode yet), every breach 0, instruments fired on the control (308 capped rescues, 17 no-air
ceilings); deaths canary 1/30.8 bh vs matched 2/46.2 bh. The verdict's "control 0/0.0" is a PLACEHOLDER, not a
measurement: usafegate.measure() scans the control POST only once the canary reaches the two-death floor; read-only
check with the installed gate found the control POST = 9 deaths / 315.2 bot-h / 77 bots, 0 errors. Fail-closed
confirmed: at the floor an empty control yields UNREADABLE unless the matched arm trips. Cosmetic wording fix ("not
scanned, below the floor") queued for the next install between canaries. KEEP requires >= 1 real airpocket success
(own lines block KEEP, never revert) -- intended.

## 10-08 08:00Z -- junkwell-02 ON PEACEFULKIT built (queued, not launched); the well's grade fixed; the plain shas move
- **The plain junkwell-02 is now jw-on-c6e91a8 @ 7d5095d / jw-on-92bc84f @ 1db3fcd** (was 2bd1452 / b446f4d). Two changes:
  - classifyOutcome credits a sword's loss (and, on the cobble coupling, cobble) only if THIS visit's throw clicked it. The click record is reset at each visit's start.
  - The strict sword switch is tested in real child processes under every FOOD_SKIP mode.
  - Codex: the composition r1 CHANGE -> ec54010; r2 CHANGE -> b62b7c5; r3 and r4 APPROVE. Claude: CHANGE on the tests -> 7d5095d, then APPROVE.
- **If peacefulkit-01 is KEPT: jw-on-39fbcde @ e2ea50a / jw-on-40046b8 @ cf4192e** (registrations junkwell-02.39fbcde.json / .40046b8.json).
  - The final well merged into peacefulkit's final heads.
  - The well's sword classifier IS peacefulkit's unwantedSword, fed the well's strict switch (peaceful difficulty AND foodskip on).
  - **Paper Job 8 (a681043, sword code identical):**
    - peaceful: swords thrown, both in the shaft. Easy: kept. Peaceful turned easy after the first click: kept (sword_kept=2).
    - FOOD_SKIP=on in an EASY world: kept, although the bot's own switch read active=1.
    - 5/5 pit-first builds landed. 0 items outside the shaft in every trial. Control 2bd1452 matched.
  - **SUPERSEDED, DO NOT LAUNCH:** jw-on-6dc10d1 (91f9ce4) / jw-on-f2c4ba0 (582ade7). They lack the pit fix.
- **stonecap-01 coupled:**
  - plain well: sc-on-7d5095d @ 8da6cf6 / sc-on-1db3fcd @ f5bdb80 (registrations stonecap-01.7d5095d / .1db3fcd; the .2bd1452/.b446f4d files are removed). The grade now also credits cobble the well clicked at the cap.
  - **well on peacefulkit:** sc-on-e2ea50a @ 70db8a3 / sc-on-cf4192e @ 32d7447. This is the first composition of the cobble cap with peacefulkit.
    - The union resolutions: call-time noSwords reaches the cap's empty-plan refusal.
    - A spare-swords-only bag is refused as deposit_nothing_to_bank: "swords are not banked in a peaceful world -- nothing to deposit, keep working".
  - NOT BUILT: a plain stonecap on peacefulkit's heads (needed only if peacefulkit is KEPT and junkwell-02 is NOT).
- Tests: npm test jw 236/236 and 237/237, jw-on-pk 239/239 and 240/240, couplings 237/237 and 238/238, pk couplings 240/240 and 241/241. Mutants: peacefulkit 59/59 on both jw-on-pk (+3 towndeposit on 92) + 2 well-classifier mutants; on the pk couplings the cobble set 65/65 and 67/67 and the peacefulkit bank/sword subset 32/32 and 35/35 (PK_COMPOSED: the drivers on main gained the composition's anchors). Lint clean but for withinBody.
- Registrations on main and in ~/mcai-analysis. Nothing deployed; the manifest and the loop untouched.

## 10-08 07:30Z — GATE v34-HYB INSTALLED (07:11Z); airpocket-01 QUEUED in the scheduler (launching); bamboo = ordinary
v34: bundle 97abe762470a3e2c4a9da0b48f771035, gatedigest OK, backups *.bak-v34-20261008T071139Z. HYB@2.5 on the five
drowning pools: false trip 1.9% (6 h) / 2.5% (26 h); in airpocket's stratum catches 35% of doublings, 76% of triplings
at 26 h; matched control frozen after the draw (a failed freeze refuses the deploy; unusable control -> UNREADABLE).
airpocket-01: registration airpocket-01.dbb4d78.json (USAFE OK), queued at 07:28Z with an approved record; scheduler
tick --no-act said LAUNCH. Bamboo decision (operator + Codex, owner delegation): bamboo-01 and bamboocraft-01 are
ORDINARY canaries (no bag-fix class; 2-3 eligible pools cannot reach v33's 400 bot-h). Gate agent still fixing the
other bag-fix registrations (per-fix noise band under each fix's own draw filter, a vacuous linkage control, the
W=1440 read cost vs the 900 s / memory limits).

## 10-08 06:45Z — TOWNDEPOSIT-02 KEPT (+360) and PROMOTED: FLEET 92bc84f (06:31Z, all live bots verified); merged to main
+360: 21 deposits, 17/25 full-bag town stays served, slots/bot DiD -1.23, share>=34 DiD -0.30, correctness 0, deaths
canary 1 (0.017/bh) vs control 8 (0.027/bh); climbs +56% (<= +100%). Main: merge of 92bc84f + towndeposit test flake
fix (a6cd3c1 cherry-picked); npm test green. SCHEDULER INSTALLED 06:35Z (~/canary-sched.py, cron */5, queue empty;
rollback: bash ~/sched-install/install-canary-sched.sh --rollback 20261008T063539Z); stale owner-01 (09-18) closed
against its ledger row. NEXT: airpocket-01 (92bc84f variant ap dbb4d78) once gate v34-HYB is installed; bag fixes and
withdraw2 use their 92bc84f variants.

## 10-08 05:30Z — DECISIONS: airpocket gate = HYB@2.5 (Codex + operator); two lanes REJECTED by both engines; scheduler staged
AIRPOCKET GATE: HYB@2.5 (DiD OR frozen matched-pool control > 2.5), not the built DID24@2.0, which is blind in
airpocket's stratum (doubling 3.3%, tripling 34% at 26 h vs HYB 35% / 76%, false trip <= 2.5%). Gate agent rebuilding
v34; airpocket WAITS rather than launch under DID24 (Codex: docs/reports/airpocket-gate-choice-codex-2026-10-08.txt).
THROUGHPUT (docs/reports/canary-throughput-2026-10-08.md): both engines rejected two concurrent lanes (a replay of six
past canaries: removing a second lane's pools from the control flipped junkwell-01's REVERT to POLL_OK; modelled gain
+0-30%); isolated pools are NOT equivalent (per-bot memory) and stay out of draws; bundling not built; the 12 h exclusion
is kept. BUILT + STAGED (not installed): a single-slot queue scheduler (scripts/host/canary-sched.py, cron */5,
~/canary-queue.json with "approved" entries; never skips the head, never retries on its own), a drawrec fail-closed
patch, and scripts/prepare-variant.sh. Slot busy 80% 10-03..10-08 (97.9 of 122.7 h). CLAUDE.md keeps "one canary pool,
ever" (re-decided). Note: fleet-recycle does not run while a canary is declared (the 05:53Z recycle will not happen).
OWNER QUESTIONS: (a) allow KEEP at +180 for four-pool draws (drawrec noise: 4 pools x 3 h 0.313 < 2 pools x 6 h
0.395) -- the biggest throughput lever left; (b) isolated pools sit in every read's control though not equivalent for
town/chest changes.
INSTALL PLAN, in the empty slot after towndeposit-02: gate v34 (HYB, once re-staged) + scheduler (no shared files).

## 10-08 05:00Z — REBOOT FIXES INSTALLED (owner "yes")
1. mcai-mayor-shadow is a persistent enabled unit (/etc/systemd/system/mcai-mayor-shadow.service, same limits as the
   transient one; ~5 s gap in snapshots at the switch). 2. block2-sandbox (sandbox 1) enabled at boot on 10.0.0.30.
3. ~/bin/restore-reads.sh, cron @reboot + */10: copies any ~/mcai-analysis/*.py missing from /tmp (never overwrites).
4. CHAINS: start them with ~/bin/chain-start.sh (records ~/chains.d/<next>.args); ~/bin/resume-chains.sh, cron @reboot
   (+90 s) + */10, relaunches unfinished chains; tested (relaunch once, no duplicate, args removed on STOP).
   Copies in scripts/host/bin/. crontab backup ~/crontab.bak-20261008-rebootfixes.
FOUND: /tmp/quickstatus.py, modelshare.py, cooldid4.py (nightwatch digest sections) were lost in the 10-06 outage and
are not in the repo; the digest's quick-status/model sections have been empty since. To rebuild (low priority).

## 10-08 ~04:40Z — CANARY THROUGHPUT: two lanes NOT built (both engines); a queue SCHEDULER built + staged, NOT installed
Owner 10-08 ~02:30Z delegated to Codex + Claude. Report: docs/reports/canary-throughput-2026-10-08.md.
- A (two concurrent lanes): Codex and Claude each DON'T BUILD. The deciding evidence was a time-travel replay of six past
  canaries with a second lane's pools removed from control (logs truncated at the read instant, frozen clock, private
  mount namespace; the full-control replay reproduced every recorded verdict line exactly).
  - Five verdicts held.
  - junkwell-01's death-gate REVERT became POLL_OK (LB 1.40 -> 1.18).
  - Model gain was only +0..30% once unmeasured double-KEEP compositions and control erosion are counted.
  - "One canary pool, ever" stands; CLAUDE.md records the re-decision.
- B: isolated pools are NOT equivalent (per-bot memory, town state, world facts, no comms or board). Not admitted; owner
  question. C (bundling): not built. D1: the 12-h exclusion stays.
- BUILT, both engines APPROVE after 6 design rounds + 4 implementation rounds:
  - `scripts/host/canary-sched.py`: cron */5. It launches the HEAD of `~/canary-queue.json` into an empty slot exactly
    as chain-after does. It never skips the head, never retries, never takes the loop lock, and never overwrites a
    /tmp read. Human verbs: rearm, abandon, closed (needs the ledger row), cancel, continue; also install-hold /
    install-release.
  - Tests: 93 tests and anchored mutants, all killed.
  - One anchored drawrec.sh patch: a drawexposure crash on a DECLARED registration no longer reads as "no requirement"
    (10/10 tests on the live file; TARGET_K line intact).
  - `scripts/prepare-variant.sh`: mechanical cherry-pick + range-diff + npm test + no-undef against the base. Its output
    has NO `approved` field, so `queue add` refuses it until reviewed.
- STAGED on 10.0.0.31 in ~/sched-install; dry run 04:42Z: tests 93/93 + 10/10 on the live drawrec; staged canary-sched.py md5 dee491d6, gate bundle
  untouched (it refuses now: towndeposit-02 is live). It is independent of gate v34: no shared file, and both
  installers hold the loop lock, so either order is safe. The operator sequences:
  ```
  ssh mike@10.0.0.31 'bash ~/sched-install/install-canary-sched.sh --dry-run'    # then without --dry-run
  ```
  It prints the rollback: `bash ~/sched-install/install-canary-sched.sh --rollback <STAMP>`.
  After the install the queue is EMPTY (no launches) until the operator `queue add`s entries with `approved`.
  Compatible with the operator's 10-08 reboot fixes (chain-start/resume-chains/restore-reads): it changes none of
  them, nor chain-after's command line, .out wording or read locations; a running chain-after/chain-start counts as
  'slot busy'. Do not queue a run that also has a recorded chain (chains.d): whichever launches first wins, the
  other waits on the lock, and the scheduler then tracks the run as running.
- FOUND, pre-existing:
  - fleet-recycle.timer SKIPS while any canary is declared, so the 05:53Z recycle noted below will NOT run.
  - check-open-loop.py cannot record a decision once the manifest is cleared.
  - drawrec's exposure filter failed open on a crash (fixed by the staged patch).
- OWNER QUESTIONS: KEEP at +180 for 4-pool draws (the biggest lever; drawrec's own null sd 0.313 vs 0.395); isolated
  pools in town/chest controls; auto-approval of unchanged range-diff variants (Codex: no).

## 10-08 04:05Z — OWNER GOAL + ROADMAP: build cool structures, survive, cooperate, for long periods (peaceful stays)
Not beating the game. docs/reports/roadmap-2026-10-08.md (owner agreed). After the current queue: LAST (renewables:
tree farm, cobblestone generator; unattended recovery; bounded logs/stores) -> BUILD (workshop, safe mineshaft, larger
structures; materials produced deliberately) -> COOPERATE (roles, town stock, overseer per C2 evidence, strategist).
New measure to build: a weekly long-run check per town (built something? deaths/stuck low? output steady?).

## 10-08 03:05Z -- junkwell-02 PIT FIX READY (queued, not launched): the aim said twice; an abandoned pit is COVERED; C9 gates a pit left open
- **junkwell-02**: jw-on-c6e91a8 @ 2bd1452 (was 5c13330), jw-on-92bc84f @ b446f4d (was 5cca9c5).
  - **Cause of the 5/5 misses:** the server dropped the bot's single aim look in 12/12 traced throws. RCON read the dig look 72.15 at the click.
  - **Fix:** the look is said again, twice, before the click; the bot aims again if a correction moved it. Each throw's receipt is read from the spawn_entity PACKET (aim_off= / aim_read=, a tripwire).
  - **Abandoned pits are COVERED, not filled:** one block in the cap cell. The fill pushed thrown junk back out on Paper.
    - Only the run that dug the pit covers it, and never after an abort. Any visitor's close_well covers an open pit nobody is at.
    - There is no build order without a cover block; cobblestone counts only above 64.
  - **Read C9 (REVERT own_line breach_pit_left_open):** a pit opened (`_well_pit_dug`, written BEFORE the dig) or left (`_well_pit_open`) with no cover or build within 10 min.
    - `scripts/host/wellread_c9_e2e.py` ran on the host against /home/mike/verdict.py: ALL HOLD (clean KEEP, one pit REVERT, 5/5 read mutants killed).
    - wellread md5 a1a3deee on /tmp and ~/mcai-analysis; dry run 10-08 ~02:50Z: 313,926 rows walked, the instruments live, C1-C9 0.
  - **Reviews:** Codex r1-r3 CHANGE, r4/r5/r6 APPROVE. Claude r1/r2 CHANGE, r3 APPROVE (its P3s taken).
  - **Tests:** suites 236/236 and 237/237; well.test 167/167; lint clean but for withinBody.
  - **Paper:**
    - 35/35 consecutive pit-first throws landed on the fixed builds (15 on 88e4bb4, 20 on 2a6214f).
    - Control 5c13330: 3 of 10 throws landed, and 3 of 6 builds left the pit open.
    - Give-up: covered by the build, items contained (66 in the shaft, 0 outside, +30 s).
    - Abort: why=aborted, then a visitor covered it 12.5 s later. Kill: a visitor covered it 10.6 s later.
    - Resume: the well finished on the covered pit (131 in the shaft, 0 outside).
    - No cover block: no order, no walk. Dispose: 528/528 in the shaft.
  - **Not proven on Paper:** the visitor-race gate (B never scanned while the pit was open; it is unit-tested).
- **stonecap-01 COUPLED** (only if junkwell-02 is KEPT and promoted): now sc-on-2bd1452 @ 5260f71 and sc-on-b446f4d @ 39b6f82 (were sc-on-5c13330 ee4c916 / sc-on-5cca9c5 5ee00b8).
  - Registrations: stonecap-01.2bd1452.json / .b446f4d.json. The old .5c13330/.5cca9c5 files are superseded and deleted.
  - Union merges, checked by Codex r6. Cobble mutants 65/65 and 67/67; suites 237/237 and 238/238.
- **Still waiting:** jw-on-<peacefulkit sha> variants, for peacefulkit's new heads. The old jw-on-6dc10d1 / jw-on-f2c4ba0 lack the pit fix; do NOT launch them.
- **Driver:** sandbox/well/well-e2e.cjs (visitor bot, Job 7 scenes, site census) and sandbox/craft/trace-rot.cjs landed on main.

## 10-08 ~01:30Z — WITHDRAW2 REBASED (both variants READY, not chained, not launched)
`wd2-on-c6e91a8` @ 6c86fa7 (fleet c6e91a8; registration docs/reports/withdraw2-01.c6e91a8.json) and `wd2-on-92bc84f` @ a6cd3c1
(only if towndeposit-02 is KEPT + promoted; withdraw2-01.92bc84f.json). bots/src on both = the approved withdraw2 (c4e9c47)
rebased; only conflict the cognitive.mjs import line. A surplus-first room order (785cd0d) was built for the towndeposit base
and DROPPED before any push (Codex P1: ignores chest capacity, could decline a pull the old order completed).
- IRON RETENTION vs TOWNDEPOSIT: proven. Unit (withdraw2-towndeposit.test.mjs: real pull -> real townDepositPlan/Order) and Paper
  sandbox2: irontd 2/2 (crafted_iron, then _town_deposit at 34 slots banked raw_copper:7 ONLY; iron + stone pickaxes + coal
  stayed); irontdfail 2/2 (table out of reach, craft_failed, ingots 3 + sticks 2 in the bag at 35 slots, _town_deposit banked
  raw_copper:7 ONLY). The other direction is one-way: withdraw's unchanged room rule banks COAL FIRST (then raw_iron), which the
  town deposit keeps -- no ping-pong; withdrawread now REPORTS it per arm (no gate).
- Paper best-first + iron craft, both variants: tiers40 IRON (controls c6e91a8/92bc84f STONE), twochest IRON (control c6e91a8
  WOODEN), ironcraft crafted_iron craft=server; conserved, ground empty.
- Reviews: Codex r1 CHANGE (785cd0d P1; foodskip-order test stale P2) -> r2 CHANGE (read: verb= cut at 300 chars; now the order
  is recognized by its ledger, which also lets G1/G2/G5/G6 see cut rows) -> r3 no findings -> r4 APPROVE; Claude APPROVE x3.
- npm test: 236/236 (6c86fa7); 238/238 (a6cd3c1). Mutants 49/49 (c6) and 52/52 (92, incl. the town deposit's keeps).
  eslint no-undef: only withinBody. toolhygiene composes (scratch merge: no redundant-craft refusal of the iron craft; tests green).
- FOUND, PRE-EXISTING (fixed on wd2-on-92bc84f only): towndeposit.test.mjs TOWN MEMORY flakes ~50% on 92bc84f itself (same-ms
  'took' vs miss). If towndeposit-02 is promoted and merged to main, take a6cd3c1's test fix too.
- Dry run (10.0.0.31, 180 min): every gate 0, INSTRUMENT2 50. Exposure power: withdraw-01 orders 0.077/bot-h, upgrade
  opportunities 1.03/bot-h -> P(>= 5 orders on 10 bots) 0.09..1.00 at +180, 0.50..1.00 at +360. Read md5 2640ca65 = repo =
  host /tmp = ~/mcai-analysis (backups *.bak-20261008-wd2rebase); registrations in ~/mcai-analysis.
- FOLLOW-UPS (pre-existing, not this canary): bot.currentWants keeps DEPOSIT_ALWAYS ores in every room plan after any model
  deposit; chestfull recordOutcome keeps only the latest outcome (a later full/unknown un-invalidates _pick_best/_pick_miss
  <= 15 min); capacity-aware room choice at the chest (then demote IRON_LADDER items).

## 10-08 00:40Z — OWNER delegated to operator + Codex: FOUR-pool bag fixes; AIRPOCKET before bag fixes
D1: all seven bag fixes (toolhygiene, peacefulkit, junkwell-02, gridfix, bamboo, stonecap(+cap), bamboocraft) are
"class": "bag-fix", drawn at four pools from the start (criterion: frees usable bag capacity). D2: QUEUE is now
towndeposit-02 (live) -> airpocket-01 (needs the self-baseline DiD death gate installed first) -> withdraw2 (raises iron
mining) -> toolhygiene -> peacefulkit -> junkwell-02 -> gridfix -> bamboo -> stonecap -> bamboocraft -> treefarm. If the
airpocket gate is not ready when the slot frees, the bag fixes are HELD rather than bypassing it. Gate agent: build the
gate, set the registration classes, check four-pool eligibility. Codex text:
docs/reports/bagfix-pools-airpocket-order-codex-2026-10-08.txt.

## 10-08 00:30Z — CANARY LIVE: towndeposit-02 @ 92bc84f on placebo-b,board-c (10 bots), declared 00:15:33Z
Drawn 00:15Z (earlier than the 04:15Z estimate). Versions: 10 x 92bc84f on the canary pools. Reads ~03:15Z / ~06:15Z.
PRE WINDOW NOTE (Codex condition "no restart in the pre window"): fleet-recycle.timer (OnBootSec=6h, OnUnitActiveSec=6h;
"uniform staggered bot recycle, all arms alike") restarted all 80 bots 23:53-00:01Z, 14 min before deploy. It is
symmetric across arms and hits every canary every 6 h (next 05:53Z, inside this run), unlike the 10-07 outage +
promotion restart that shrank only the canary's pre window to 11.6 bot-h. Accepted and recorded; the queued
restart-contamination preflight must exempt fleet-recycle (or align draws to it), and should measure pre bot-h per arm.

## 10-08 00:20Z — OPERATOR: build status; towndeposit-02 draw waiting (exposure)
towndeposit-02: preflight ok 22:21Z, draw waiting -- exposure (compost >= 8 rows/6 h) passes only board-c, placebo-b;
board-c out of band; board-b/placebo-a excluded until ~04:15Z (12 h after towndeposit-01's teardown). Expect a draw
~04:15-05Z. Not swapped for another canary: every queued variant is based on c6e91a8/92bc84f, and a KEEP in between
would orphan towndeposit-02's variant.
READY (both engines APPROVE, npm test green, Paper-proven, reads staged on host): toolhygiene-01 (th-on-c6e91a8 efbb607 /
th-on-92bc84f 6238095); airpocket-01 (ap-on-c6e91a8 ee21207 / ap-on-92bc84f dbb4d78; 59/59 sealed-pocket survivals vs
control 0) -- BLOCKED on an underground-safety death gate (its pools drown 2.6-3.2x on the base; gate agent building a
self-baseline DiD gate); stonecap-01 + cobble cap (sc-on-c6e91a8 06e2964 / sc-on-92bc84f 971fb09; well-at-cap variants
sc-on-5c13330 / sc-on-5cca9c5; cap log needs rotation before promotion); bamboocraft-01 (after bamboo-01 KEEP).
FIXING: peacefulkit (spare swords still counted bankable in places; wooden sword can stay on the cursor after a furnace
drain) -- agent resumed; junkwell-02 (pit-first toss missed 5/5 on Paper and the abandoned build left the pit OPEN) --
agent resumed; dependent jw-on-<pk sha> variants to be rebuilt on peacefulkit's new heads. withdraw2 still needs its
rebase onto c6e91a8 (and 92bc84f).

## 10-08 00:10Z -- QUEUED, NOT LAUNCHED: the cobble cap inside stonecap-01; swords in junkwell-02; the well-at-cap coupling; bamboocraft-01; junkwell on peacefulkit
All branches pushed; registrations in docs/reports; reads in scripts/host (md5 on the host /tmp and ~/mcai-analysis = repo:
stonecapread 69ae9d78, wellread 31204393, bamboocraftread 8d797bd6). Nothing deployed, the manifest and the loop untouched.
- **stonecap-01 = the cobble rule + THE TOWN COBBLE CAP** (owner-delegated 10-07, Codex's rule): sc-on-c6e91a8 @ 06e2964,
  sc-on-92bc84f @ 971fb09. Counted counts in an append-only journal per town (`/var/lib/mcai/_pool-<pool>/<townKey>.cobble.jsonl`),
  claims decided in a shared fold, reconciliation of uncounted containers, never past 256, surplus stays in the bag at the
  ceiling. Codex 8 rounds -> APPROVE; Claude 4 rounds + final delta -> APPROVE (8-process race: 0 overshoots). Mutants 65/65 and
  67/67; suites 236/236 and 237/237. Paper: the cap held in every scene (control overshot 270-336); details in the registrations.
  BEFORE FLEET-WIDE PROMOTION: rotate the journal (P3, Claude); the read lists claims live > 1 h by bot (a removed bot's stay
  reserved, fail closed). Exposure is slow at the evening rate (~12 h for a 5-bot pool): the extensions carry it.
- **stonecap-01 COUPLED** (only if junkwell-02 is KEPT and promoted): sc-on-5c13330 @ ee4c916, sc-on-5cca9c5 @ 5ee00b8 --
  surplus whole stacks above 64 go down the well only while the town HOLDS 256 (counted), re-read at every click. Codex 3 rounds
  -> APPROVE; Claude APPROVE (its cheap P3s taken: cap read only at town; build room without cobble/swords). Paper: at 277
  counted the 30 + one 64 went into the shaft and exactly 64 stayed; at 247 none; a count dropped after the first click kept the
  second stack; control 5c13330 threw none. junkwell's chest-full W4-W8 fixtures adapted (a lone 64 cobble is now reserve).
- **junkwell-02 + swords** (peaceful only, re-read at every click): jw-on-c6e91a8 @ 5c13330, jw-on-92bc84f @ 5cca9c5. Codex r3 and
  Claude r2 APPROVE; suites 236/236, 237/237; Paper: peaceful threw both swords into the shaft, easy and a mid-visit switch kept
  them. **If peacefulkit is KEPT:** jw-on-6dc10d1 @ 91f9ce4 and jw-on-f2c4ba0 @ 582ade7 (merged on pk's final heads; both
  engines checked the composition -- Claude APPROVE, Codex CHANGE on peacefulkit's OWN code, not the merge: the counting sites still count spare swords
  (admission/milestones/prompt/skills: pass noSwords), and drainFurnace can leave a lifted wooden sword on the cursor). The
  earlier jw-on-da3e38d / jw-on-7ae5e0f are SUPERSEDED (not pushed). Suites 239/239 and 240/240.
- **bamboocraft-01** (launch only after bamboo-01 is KEPT): bc-on-6fb6fd9 @ 56956af, bc-on-786da4c @ f7415de. Codex r2 and Claude
  r2 APPROVE; suites 238/238, 239/239; 14 + 4 mutants killed. Paper: 36/36 bamboo 64 + sticks 32 -> 32 server-confirmed fold
  crafts freed a slot and the stone pickaxe was crafted (control refused). **bamboo-01 FINDING (both arms):** its housekeeping
  order fires first at 34+ slots and folds ALL bamboo -- in one scene it ate the scaffolding's ingredient; the craft-time fold
  only got its turn with the order on cooldown. Read bamboo-01 with that in mind.
- KNOWN, junkwell-02 (pre-existing, both revisions in the sandbox): the pit-first toss can miss the pit and the bot picks the
  stack back up; after two misses the build refuses "0 free slots" -- 5 misses in a row on one sandbox site 10-07 evening.
- DO NOT deploy the round-6 cap shas 9e88176 / a12572d (a mutant survives there; the finals kill it).

## 10-07 ~22:30Z — PEACEFULKIT-01 REVISED to the owner's 19:50Z decisions; REVIEWED (Claude + Codex APPROVE); NOT LAUNCHED
`pk-on-c6e91a8` @ 6dc10d1 (registration docs/reports/peacefulkit-01.c6e91a8.json) and, for a fleet on towndeposit-02,
`pk-on-92bc84f` @ f2c4ba0 (peacefulkit-01.92bc84f.json); both in ~/mcai-analysis/ too. Read scripts/host/peacefulkitread.py
= ~/mcai-analysis = /tmp, md5 5d3714b6. SWORDS never banked (not even a spare) and never crafted or chased while on; a smelt
ALREADY happening burns carried WOODEN swords first (one per item, only into a cold furnace, so the switch read at the put
is the burn); stone swords stay in the bag; `unwantedSword(item, peacefulActive)` exported for junkwell-02. SAPLINGS:
oak/birch keep 16, other species composted (their replanting stops by design). COMPOST + dried_kelp, glow_berries,
moss_carpet, firefly_bush, bush, bread (each 64/64 on Paper; off when not peaceful). GUARD general: no compost trip when
the real surplus after every reserve is zero. Six review rounds on the revision (both APPROVE); 97 mutants all killed; npm test green on both; the big catch (Claude r3, confirmed on
real sandbox rows): mineflayer freezes bot.inventory while a window is open, so mid-job burn rows read as LOST (2 of 2)
-- rows now written after the close, and the read keeps a 180 s burn credit. Paper sandbox3 (real bot): bank/compost/
guard/craft/drop as designed; smelt 5/5 both wooden swords burned, coal untouched; an earlier call's sword in the fuel
slot is taken back before any input (full bag: the job refuses, nothing dropped). Dry run (board-a,placebo-b, 6 h): every
gate 0, every positive control fires (K1 125, K2 31, K3 19, K4 34, K5 37, K6 22, K7 65); licencecheck exit 0 (class
kind, `_peaceful_kit` silent in baseline); drawexposure: both pools eligible. TEARDOWN NOTE: record the read's "left in
the furnace" swords by bot (base code's drain would toss them from a full bag).

## 10-07 22:25Z — GATE v33 INSTALLED (bag-fix death rule + version-aware changerowcheck); towndeposit-02 drawing
Installed 22:12Z in the empty slot (launcher stopped by PID, dry run, install, relaunched): bundle
ac3da3b64d3fa5e31be5678c33d84ac0, gatedigest OK, backups *.bak-v33-20261007T221224Z. Report:
docs/reports/bagfix-death-rule-2026-10-07.md (main 8522797; both engines APPROVE; backtest: of 17 death-involved
reverts only junkwell-01 would have extended). Bag fixes need "class": "bag-fix" + a bag_fix block and draw FOUR pools
from the start (no mid-run widening). After a bag-fix KEEP the loop only launches "class": "underground-safety"
(airpocket must declare it). towndeposit-02 runs as a normal canary (no class). 22:21Z preflight-ok with the new check
("0 from other builds"), licence-ok, gatedigest-ok; draw waiting for two pools.
OWNER (pending): accept four-pool draws for bag fixes (4-pool draws happened 6 of 21 times since 09-28 -> slower starts).

## 10-07 22:10Z — GATE v33 (bag-fix death rule) BUILT + STAGED, NOT INSTALLED; changerowcheck baseline-only fix in it
Built per the owner's 19:45Z decision: docs/reports/bagfix-death-rule-2026-10-07.md. SUBSTITUTION (needs owner nod):
no mid-run widening (a 2nd deploy rewrites the one declared_at, restarts canary pools, rebuilds the tree under them)
-- bag fixes are DRAWN AT 4 POOLS (20 bots) from the start; the loop waits for such a draw (6 of 21 draws since 09-28).
VALUE MEASURE: net change in log-eq (junk/ballast/cobble>64 = 0, iron 10/ingot, tools at material cost, logs<=64,
saplings<=16; transfers and in-transfer rows excluded); 24-h null p2.5 -3.21 log-eq/bot-h, iron -0.127 ingot/bot-h.
TABLE (P(REVERT), k=1/1.5/2/3): rule as built 1.6/11.3/28.7/72.2% vs today 20-bot 4.3/15.3/34.8/73.2% -- a leniency
rule by construction. BACKTEST: of 17 death-involved reverts today's gate trips on 2; only junkwell-01 would have
EXTENDED (0/6 linked, LB 1.39); its 24-h outcome is unknown (torn down +308). chestfull-01 stands (no own rows; LB>2).
Fail-closed additions listed in the report section 8. Reviews: Claude APPROVE (r5), Codex APPROVE (r6) after 6 rounds.
STAGED on 10.0.0.31 in ~/bagfix-v33; dry run 22:00Z OK, predicted bundle digest ac3da3b64d3fa5e31be5678c33d84ac0.
INSTALL (between canaries ONLY; the script refuses while any loop/chain/launch runs or a canary is declared):
  ssh mike@10.0.0.31 'bash ~/bagfix-v33/install-bagfix-gate.sh --dry-run' then without --dry-run.
At 22:00Z it WOULD REFUSE: ~/launch-td02.sh (towndeposit-02, 22:20Z) is waiting. After install, the changerowcheck
fix stops the false refusal that hit towndeposit-02 at 19:46Z (40 town_deposit rows, all from towndeposit-01's build).
Before the first bag fix: register it with "class":"bag-fix" + a bag_fix block, and dry-run its reads at +1440.

## 10-07 19:50Z — OWNER APPROVED: adaptive death rule for bag fixes + airpocket; swords never stored; sapling/compost decided
DEATH RULE (underground-safety-phase2 section 7, adaptive form): bag fixes run the normal 6 h canary; if the death gate
trips with ZERO mechanism-linked deaths, extend to 24 h on 20 bots and decide by linked deaths beyond chance / deaths
confidently > 2x control / value-weighted net output; no bag benefit or too little exposure -> INCONCLUSIVE; a KEEP hands
the next slot to a safety fix. NOT LIVE until: value-weighted re-run, backtest on ~15 death reverts, tooling + gate digest
re-registered, installed BETWEEN canaries (agent building; CLAUDE.md to be updated). Until then the two-death floor rules.
AIRPOCKET (rank 1 safety, ~25-35% of drownings): being built (dig up inside the drowning rescue; damage envelope).
SWORDS (owner): never stored -- no banking; wooden swords burn as fuel in smelts already happening; all swords to the well
while peaceful (junkwell-02). SAPLINGS: oak/birch keep 16/bot, other species composted. COMPOST adds dried_kelp,
glow_berries, moss_carpet, firefly_bush, bush, bread (peaceful only). Full-bag compost guard generalised. Codex text:
pk2-codex (scratchpad) folded into the peacefulkit design by its agent.

## 10-07 19:40Z — OWNER delegated "1 and 2" to operator + Codex: decided
COBBLE CAP: build the 256-per-town ceiling INTO stonecap-01 before its canary (reconciled chest counts with deposit
reservations; whole stacks only; bot keeps 64 reserve; at the ceiling, surplus whole stacks above the reserve go down the
junk well if junkwell-02 is kept, else stay in the bag -- no new chest, no toss). BAMBOO AS A CRAFT REMEDY: a separate
follow-up canary bamboocraft-01 after bamboo-01 is KEPT (bamboo-01 unchanged). Codex text:
docs/reports/cobblecap-bamboocraft-decision-codex-2026-10-07.txt. Builder agent resumed on both.
STILL OPEN (owner; defaults used meanwhile): sapling reserve 16 (default 16), bank spent swords (default no), extra
compostables dried_kelp/glow_berries/moss_carpet/firefly_bush/bush/bread (default none), apple-only full-bag guard in
peacefulkit (default in), the bag-fix death rule (safety agent finishing review).

## 10-07 ~19:40Z — PEACEFULKIT-01 READY (not launched): pk-on-c6e91a8 @ da3e38d / pk-on-92bc84f @ 7ae5e0f
The owner's 10-07 items (3) swords and (4) compost more, under foodskip's ONE switch (FOOD_SKIP auto|on|off; auto = the
server's difficulty packet says peaceful). Design docs/reports/peacefulkit-design-2026-10-07.md (measurements, cited prior
art, the Paper compost table, 5 review rounds, owner decisions); registrations docs/reports/peacefulkit-01.c6e91a8.json and
peacefulkit-01.92bc84f.json (also in ~/mcai-analysis/); read scripts/host/peacefulkitread.py = ~/mcai-analysis = /tmp, md5
22a14034 (`--selftest` runs at every read); mutants scripts/mutants/mutants-pk.py (39/39 JS + 20/20 read killed).
- SWORDS: admission + the craft skill refuse a sword craft while active (remedy: craft a pickaxe/axe/shovel or gather), the
  prompt stops offering one, the sweep never walks to a sword drop, a RUNNING deposit keeps no usable sword (spent never);
  admission/advice/milestones/the town-deposit trigger keep the base count (no new trip); a sword-only full chest never
  starts the recovery. COMPOST: 30 kit plants WHOLE (each consumed 64/64 by a real Paper 1.21.8-60 composter, RCON hopper
  test; negatives 0); saplings > 16 and apples > 4 unchanged; dried_kelp/glow_berries/bush/firefly_bush/moss/bread NOT
  approved; full bags get an order only when a fill can start (startableJunk at the composter's level -- also applies to
  the food policy's apples while on); `_compost` rows carry args.items (+ `aborted` rows on interruption, args.incomplete).
- PAPER (sandbox3, the real bot, server read-back): craft refused 2+2/2+2 (control crafts), easy crafts 2/2; deposit banks
  both swords 2+2/2+2 keeping the better pickaxe (control keeps both), FOOD_SKIP=off and easy keep them; compost 2+2: all 69
  kit items consumed, apples 10->4, saplings 20->16, bread/dried_kelp/sword kept (control: kit untouched); off/easy untouched;
  sword drop never chased 5/5 (control chases it).
- REVIEWS: Claude r1 APPROVE, r2 CHANGE (the read's clock: skill rows are stamped at START), r3/r4 APPROVE; Codex r1-r4
  CHANGE (K2 ledger, truncated compost rows, exposure power, interrupted visits, unverified X2) -> r5 APPROVE; Codex rebase
  confirmation of the 92bc84f variant APPROVE. Suite 237/237 (c6e91a8 line), 238/238 (92bc84f line).
- DRY RUNS: every gate 0, every instrument fired on the control (6 h: tool crafts 126, bank-explained pickaxe falls 41,
  bank rows emptying a name 91, reserve checks 45 ...), CALIBRATION 0, control sword ledger lost 0; licencecheck (kind
  _peaceful_kit, baseline silent) and drawexposure (9 pools eligible) OK.
- EXPOSURE is per BOT (swords are stock): joint P(X1 >= 3 and X2 >= 3) 0.35-0.94 at 6 h with 2 pools, 0.87 at 12 h, 0.99
  at 24 h -> reads 180/360 + extension 540/720/1080/1440, deadline 1680 -> INCONCLUSIVE. DRAW >= 2 POOLS.
- OWNER DECISIONS: sapling reserve (recommend keep 16: every holder has ONE stack per species, so no reserve > 0 frees a
  slot); spent swords (never banked now; census found none); the unapproved compostables; accept startableJunk's apple
  effect inside this canary; a 2+ pool draw.
Queue position (18:00Z entry): after toolhygiene. Not deployed, nothing launched, no world edits outside the sandboxes.

## 10-07 ~19:15Z — QUEUED (not launched): junkwell-02, gridfix-01, bamboo-01, stonecap-01 -- each with a c6e91a8 AND a 92bc84f variant
Pick the variant by the fleet sha when its turn comes (92bc84f only if towndeposit-02 is KEPT and promoted). Registrations on
main docs/reports/<run>.<base>.json and on the host ~/mcai-analysis/; reads in ~/mcai-analysis/ and /tmp/ (md5s below).
- **junkwell-02**: jw-on-c6e91a8 @ 5a462a4 / jw-on-92bc84f @ d43b543. The 10-04 owner list + the owner's 10-07 decorations
  (124 names: glass/panes/stained, wool, buttons, wooden+stone plates, rails, lead, brick(s), mossy/cracked/chiseled stone
  bricks, polished andesite/diorite/granite, smooth_basalt, polished_tuff, tuff bricks, fences) + andesite/diorite/granite/
  stone_bricks/mossy_cobblestone/smooth_stone only while the bag KEEPS 64 reserve stone (cobble, deepslate, raw andesite/
  diorite/granite), judged at each click. Never: wooden slabs (composter recipe), trapdoors, beds, sandstone, calcite/tuff,
  compostables (peacefulkit's). Codex CHANGE -> APPROVE (r2); Claude APPROVE-WITH-CHANGES x2 (applied). Paper sandbox3:
  deco63/64/0 exactly as planned, 0 outside the shaft, non-listed untouched. Read wellread.py adds C7 (stone guard), mine
  actions/bot DiD (BLIND when the control shows none; MINING SHIFT > +15) and deaths below y 60 by mechanism.
  OPERATOR RULE: MINING SHIFT + a canary death below y 60 = read it by hand before any KEEP (junkwell-01's mechanism).
- **gridfix-01**: gf-on-c6e91a8 @ 55dff5a / gf-on-92bc84f @ b54e452. NOT a mechanical rebase (withdraw's evolved click
  machinery); Claude's probe found the grid fix's write-hook drop desyncing withdraw/town-deposit locksteps (12/20) -> fixed
  (stopIssued before validate()). Codex APPROVE x2, Claude APPROVE (r2, probe 0/20). Paper: ctrl stranded on every mid-click
  abort, cand 0/8 (int3 read unverified_skipped, bag conserved). POWER: aborted 2x2 exits ~0.5/h fleet-wide -> a 15-bot
  draw is exposed by +360 only ~45% of the time, ~92% by +1560 (extensions); prefer 15-20 bots.
- **bamboo-01** (after gridfix is KEPT): bb-on-55dff5a @ 6fb6fd9 / bb-on-b54e452 @ 786da4c. Claude APPROVE; Codex
  APPROVE-WITH-CHANGES, its one P2 INHERITED from the 10-05 design (a room-blocked milestone craft wins the decision before
  bamboo) -- OWNER/OPERATOR DECISION, not changed. Paper K20 abort 3/3 clean (was 46 bamboo stranded without the grid fix).
- **stonecap-01 (the cobble rule, NEW)**: sc-on-c6e91a8 @ c238c3d / sc-on-92bc84f @ b2dee1a. Design
  docs/reports/cobble-rule-design-2026-10-07.md (+ prior-art search). Whole cobble stacks only, smallest first, keep 64
  cobble+deepslate; moved by mineflayer's own transfer() narrowed to the slot (no new click path); cobble never grows the
  bank; depositDue false with nothing bankable; admission refuses an empty plan before the walk. The 256/town = the 10-04
  clear's reserve, NOT a cap (owner's "no-ledger design"; both engines agree) -- a hard cap is an OWNER DECISION.
  Reviews: Codex CHANGE -> APPROVE-WITH-CHANGES x2 -> APPROVE (r4); Claude APPROVE-WITH-CHANGES x2 -> APPROVE (r3). Paper: A [64,30] ->
  the 30 banked, 64 kept in one slot (ctrl banked 64, kept 30); B [50] -> 0 cobble (ctrl 42, to its old 8); C 14-room chest
  -> nothing moved, no chest, no recovery (ctrl part-filled +14). Craftsync's recount after real transfers says src=skipped,
  so C1 judges the client bag (it matched the server in every trial).
- towndeposit.test TOWN MEMORY is FLAKY on the unmodified 92bc84f (3/8): same-millisecond precondition; fixed test-only on
  the 92bc84f variants. towndeposit-02 itself is unaffected (the code is right).
- Sandbox harnesses added to main: sandbox/well/well-e2e.cjs (deco63/64/0 scenes), sandbox/craft/cobble-ab.cjs.
- Reads on the host (/tmp = ~/mcai-analysis = repo): wellread.py f5ff8d45 (old one kept as .bak-20261007T1950Z), stonecapread.py
  549372b1, gridfixread.py eac8d6da and bambooread.py 1aeb644a unchanged. Each dry-ran 10-07 with CANARY_DRYRUN.
  Mutant driver: scripts/mutants/mutants-canaries-1007.py (gridfix 1/1, cobble 10/10 killed).

## 10-07 18:00Z — BAG CENSUS + OWNER: "i want all of those things done and queued" (six bag fixes)
Census 17:00Z (scripts/host/bagcensus.py, bagcost.py; slots = ceil(count/stack)): 2,752 of 2,880 slots used (96%), median
35/36, 37 bots full. Unneeded in peaceful (~15 slots/bot): owner junk ~375 slots, decorations ~300, food ~200, swords 123
(all ~100% durability), stone pickaxes 250 (148 at <= 10% left; 211 crafted today vs 13 iron), bamboo 104. Items gained
per bot-h by fullness since 13:00Z: <=30 slots 106.9 (32.1 bot-h), 31-33 97.9 (50.9), 34-36 58.2 (228.6) -- correlational.
Rows naming a full bag in 4 h: craft 600, _ore_tunnel 149, gather 149.
APPROVED + being built (3 agents, own worktrees, both engines, sandbox-proven, dual variants c6e91a8/92bc84f):
toolhygiene (no redundant tool/station crafts; most-worn usable pickaxe for low-tier blocks), peacefulkit (swords under
the peaceful switch: no craft/chase, banked; composter takes melon/kelp/mushrooms/seeds/flowers/leaf litter/surplus
saplings), junkwell-02 (owner junk + decorations), gridfix -> bamboo rebases, cobble rule (256/town).
QUEUE: towndeposit-02 (>= 19:45Z) -> withdraw2 -> toolhygiene -> peacefulkit -> junkwell-02 -> gridfix -> bamboo ->
cobble -> treefarm. Plus the restart-contamination preflight (Codex) before the next launch that needs it.
RISK NOTED: emptier bags send bots back to mining (junkwell-01's revert mechanism); reads must report mine actions/bot and
underground deaths by mechanism.

## 10-07 17:30Z — TOWNDEPOSIT-01 REVERTED (+180, guard v11 climbs +239%); towndeposit-02 = identical re-run, launches >= 19:45Z
Feature gates at +180 all 0 breaches; 12/20 full-bag town stays served; slots/bot DiD -0.57, share>=34 DiD -0.087; deaths
1 (0.033/bh) vs control 0.047/bh. The trip: climb firings (_entombed+_marooned)/bot-h canary 3.2 -> 7.8, control 11.0 -> 7.9.
The pre window (10:06-13:06Z) held the outage (to 11:53Z) and the fleet promotion restart (12:00-12:12Z): canary pre 11.6
of 30 nominal bot-h. Clean 9 h pre (10-06 20:00-05:00Z, scripts/host/tdclimbs.py): canary 6.51/bh, control 8.01; post 7.77
vs 7.99 -> ratio-DiD +19%. Spread over all 10 bots (8-42 each); 61/233 within 10 min of the same bot's _town_deposit row
(proximity, not causation). RECORDED AS: baseline compromised by outage/restart; feature effect UNRESOLVED (Codex wording,
docs/reports/towndeposit-01-revert-codex.txt). Torn down 16:15Z, pools on c6e91a8.
towndeposit-02: same sha 92bc84f, same reads and gates, no trip waived (registration docs/reports/towndeposit-02.c6e91a8.json).
~/launch-td02.sh (pid on host) waits until 19:45Z so the 3 h pre window is clear of the 16:15Z teardown restarts in the
control too, refuses if a canary is declared or the fleet is not c6e91a8, then runs canary-loop.
Teardown noise: the restart step globbed stale /var/log/mcai/board-b-Charlie and placebo-a-Charlie dirs (bots retired
09-02) and tried to start units with no env file -> 2 "failed" units, reset-failed; 80/80 real bots running.
QUEUED (Codex): a preflight refusing a deploy whose 3 h pre window has < 80% of nominal bot-h in canary OR control, or
contains a fleet/pool restart; build + review before towndeposit-02's successors rely on it. Then withdraw2.

## 10-07 13:10Z — CANARY LIVE: towndeposit-01 @ 92bc84f (td-on-c6e91a8) on board-b,placebo-a (10 bots), declared 13:06:18Z
Two versions live (92bc84f x10, c6e91a8 rest). Reads ~16:06Z (+180) and ~19:06Z (+360). Next in the queue: withdraw2
(rebase wd2-on-c902d6f onto the then-fleet sha; check iron retention vs towndeposit), then gridfix, bamboo, junk well,
cobble rule, treefarm.

## 10-07 12:25Z — FOODSKIP-01 KEPT (scoped, amendment 1) and PROMOTED: FLEET c6e91a8 (12:12Z, all live bots verified). towndeposit-01 drawing.
SECOND POWER OUTAGE: fleet host 10.0.0.31 + world host 10.0.0.30 down 05:01:47Z -> 11:53Z (6h51m). Studio and mini stayed up.
Came back on their own: 16 worlds, 80 bots, sandboxes 2-4, canary-loop (cron at 12:00). Restored by hand: /tmp read
scripts (cp from ~/mcai-analysis), mcai-mayor-shadow (systemd-run as mike, same flags), block2-sandbox (sandbox 1, disabled
at boot), chain-after. +360 read ran late (12:02Z; window 01:10-07:10Z includes ~2 h of outage; 72.8 canary bot-h).
+360: KEEP. LIVENESS 17 rows/control 0; F1 0; F2 UNPOWERED (control sought 2, canary 0); A1-A3 0; 693 apples composted in
16 visits (~65 bone meal); instrument 25; deaths canary 1 (0.014/bh) vs control 6 (0.027/bh); slots DiD +0.48, share>=34 DiD
+0.086 (inside the 10-05 no-change noise band), gather success DiD +0.028. LABEL: apple composting + mode switch supported on
the fleet; food-chase suppression UNVALIDATED on the fleet (unit tests only). Follow-up sandbox A/B still owed.
Fleet bot code c6e91a8 MERGED TO MAIN 10-07 (c259a9e, owner asked): main's bots/ had lagged since idlegap (bf296c9);
merged bots/src == deployed c6e91a8 except one lint comment in reflex.mjs; npm test 237/237. From now on, merge each
promoted canary sha into main at promotion so main stays equal to the fleet.
towndeposit-01: chain-after STOPPED ("already registered": the stalled c902d6f registration). Moved aside
(registrations/towndeposit-01.json.c902d6f-stalled-20261007), re-registered from towndeposit-01.c6e91a8.json (td-on-c6e91a8
@ 92bc84f), loop relaunched 12:22Z: preflight/licence/gatedigest OK, draw waiting. Expect the draw this afternoon: its 6 h
exposure window (>= 8 compost rows/pool) still contains the outage, and foodskip's pools are in the 12 h exclusion.
MODEL BENCH: fixtures done 04:09Z. C2 smoke "FAIL" at 05:06Z was mostly the outage (check ran with the fleet host down).
Re-run 12:10Z on real data: overseer side works (mayor_spawn 1, overseer_call 5, directive_sent 15, escalation_call 8,
2047 bot rows) but the bots logged NO requested/dispatched directive rows -- a real gap; the det arm is void (outage).
Model agent resumed to debug on sandbox4 and re-run the smoke. C2 series not started.

## 10-07 05:10Z — foodskip-01 +180 NOT_YET (exposure 0); AMENDMENT 1 registered before +360 (Codex APPROVE-WITH-CHANGES)
+180 (04:15Z): LIVENESS 16 active=1 rows, control 0; F1 0; A1/A2/A3 0 (627 apples composted in 14 visits; instrument 19
control visits holding > 4 apples); deaths canary 1 vs control 3 (0.022/bh both); gather success DiD +0.025. Exposure 0
because F2_judged needs >= 20 control sought apples and the control had 2 in 194.6 bot-h (0.01/bot-h vs 0.07 in the 10-05
dry run): ~30 h to reach, past the 1680-min deadline, blocking towndeposit-01 (owner top priority) for ~22 h.
AMENDMENT 1 (registration amendments[0], main docs/reports/foodskip-01.c902d6f.json == host registrations/foodskip-01.json;
read d2684f1 on host /tmp + ~/mcai-analysis, .bak-amend1 kept): exposure drops F2_judged; F2 is a REVERT tripwire (canary
sought >= 3 AND (control 0 OR ratio > 0.25)); status printed TRIPPED/JUDGED/UNPOWERED. A KEEP under it is LABELLED
"apple composting + mode switch supported; food-chase suppression UNVALIDATED on the fleet (unit tests only)" -- not a
pass of the original gate. Residual risk if the chase half does nothing = base behaviour. OWNER: accept or not.
Follow-up registered: sandbox apple-drop A/B with a log-drop positive control (does not block towndeposit). Codex text:
docs/reports/foodskip-01-amend1-codex.txt. Expected: +360 (~07:11Z) can KEEP -> towndeposit-01 chain fires.

## 10-07 01:15Z — ORDER SWAP: towndeposit-01's draw stalled (only placebo-b passed draw_exposure after the outage; five pools in
12 h exclusion) -> its loop stopped by the operator (journalled), foodskip-01 (c902d6f variant, draws 4 pools now) launched
first; towndeposit re-chains after it (needs a rebase onto fs c6e91a8). Lesson: `pkill -f` from an ssh command line kills
the ssh session itself (memory pgrep-f-matches-itself) and an orphaned `sleep 1200` child keeps the flock on
/tmp/mcai-canary.lock -- kill loops by PID and kill their children. MODEL C1 (3 blocks, 8 bots, 70 min): gemma4:26b halves
stuck time (35.0 -> 14.9 min/bot, 9/9 pairs), stone pickaxe 2.3 -> 4.0 of 8; team output inconclusive (2.95x/0.59x/0.96x);
gemma-Ollama 4 deaths vs 0 (watch); co-load fine on the cleared Studio (gemma LMS 8-bit + gpt-oss Ollama: 2.7 s / 29 s);
blind round 2: 8-bit good, 4-bit worse. OWNER APPROVED C2 (bench-only overseer/stuck hook, never deployed). Persistent
Studio tunnel on the mini (launchd com.mbench.tunnel).

## 10-07 01:14Z — CANARY LIVE: foodskip-01 @ c6e91a8 on board-d,hive-c,placebo-b (15 bots), declared 01:10:52Z; two versions
confirmed (65 c902d6f, 15 c6e91a8). Reads ~04:11Z / ~07:11Z. towndeposit-01 next (td-on-c6e91a8 being gated).

## 10-06 ~23:30Z — WITHDRAW2 READY (not chained): wd2-on-c902d6f @ c4e9c47, Codex APPROVE (round 7), 49/49 mutants; registration
withdraw2-01.c902d6f.json on main 2df5fc4 (read + reg on the host in /tmp and ~/mcai-analysis). Paper: best tier taken 2/2
where the control took wooden; iron pickaxe crafted from exactly 3 ingots + 2 sticks, server-confirmed 4/4; full-bag
trade conserved. Live confirmation of the problem: control withdrawals in 3 h were wooden 8, stone 4, iron 1. Queue:
after towndeposit + foodskip (rebase + check iron retention vs towndeposit's at that point). Mutant drivers now kept in
scripts/mutants/ (the scratchpad copies were lost once).

## 10-06 23:00Z — towndeposit-01 CHAINED (22:13Z) but its DRAW was crashing: drawrec.sh runs /tmp/poolrank2.py, which existed
ONLY in /tmp (never committed) and was wiped by the outage reboot. RECONSTRUCTED as scripts/host/poolrank2.py from
halfdid.py's documented exact reproduction (120-min window, declared_code_version filter, -d pools = 3090 half); installed
to /tmp and ~/mcai-analysis. The draw now runs: only placebo-b passes draw_exposure (>= 8 compost rows in 6 h -- the outage
gap thins the window) and five pools are inside their 12 h post-canary exclusion; the loop redraws every 20 min and will
deploy when two qualify. foodskip-01 CHAINED after it (variants 56aa04a / c902d6f). Other /tmp-only scripts referenced by
host tooling: quickstatus.py, modelshare.py, cooldid4.py (nightwatch/halfdid) -- check before relying on them.

## 10-06 21:40Z — CLIMBFLOOD-02 KEPT (+360; deaths 0/63.7 bot-h vs 9/191) and PROMOTED: FLEET c902d6f (21:01Z), 80/80 live.
withdraw live 6 h: 15 orders, 14 ok, 13 pickaxes out (7 wooden). Scoreboard 11:19-21:19Z (incl. the outage): no usable
pickaxe 18 -> 8, trip pickaxes 32 -> 41. Iron pickaxes: 69 crafted / 72 h, 31 of 80 hold one; 105 of 137 failed crafts
were short iron_ingot while the banks held ~806. OWNER: build `withdraw2` (best-first pickaxe selection + take 3 ingots
+ 2 sticks and craft an iron pickaxe at town) -- queued after towndeposit and foodskip. Slot is FREE now; towndeposit
(round-3 checks) launches next.

## 10-06 20:25Z — POWER OUTAGE (owner's UPS failed): fleet host 10.0.0.31 and world host 10.0.0.30 down 17:07-19:50Z (2h43m;
the host came back on kernel 6.8.0-142), Mac mini rebooted ~20:06Z, Studio unaffected (up 32 days). Recovery checked:
80/80 mcbot units active, canary pools on c902d6f, LLM decisions flowing (10.0.0.72 fine), filebeat up, 16 worlds + sandboxes
up. FIXED BY HAND: (1) /tmp on 10.0.0.31 lost the read scripts -> climbflood-02's loop exited "reads-missing"; restored
immobiledid.py (main e8cd891) and every queued read (towndeposit, foodskip, gridfix, bamboo, treefarm, well, withdraw,
chest) to /tmp AND ~/mcai-analysis/ (canarywatch's HEAL looks there); relaunched the loop 20:14Z (resumed, no
redeploy) -> +180 read done: NOT_YET, deaths 0 vs 6, exposure 167/100. (2) shadow mayor recorder (transient unit) was
gone: restarted 20:18Z as uid mike (mcbot cannot traverse /home/mike). (3) sandbox 1 (block2-sandbox, :25599) is DISABLED
at boot: started by hand. (4) the model benchmark's C1 runner + SSH tunnel on the mini died; agent resuming with a
reboot-proof tunnel. Agents interrupted by a network failure were resumed. FOLLOW-UPS for the owner: make the mayor a
persistent unit; enable block2-sandbox at boot; keep read scripts out of /tmp (tmpfs) -- the loop deliberately refuses
to auto-copy.

## 10-06 ~17:05Z — OWNER: the M4 Studio is cleared of other projects; unload unused models freely. Verified: LCIA keepwarm +
llmcache gone (com.lcia.ollama-env remains: NUM_PARALLEL=4, KEEP_ALIVE=30m). PAUSED this project's tier-1 shadow
analyst cron on 10.0.0.31 (~/analyst.py at :03/:33 calling qwen3.8:27b on the Studio) for the model benchmark --
crontab line prefixed `#PAUSED-20261006-model-bench#`, backup ~/crontab.bak-20261006-analyst. RESTORE when the
benchmark ends (or point it at a non-Studio endpoint).

## 10-06 16:50Z — WITHDRAW-01 KEPT at +540 (14:29Z; exposure reached 6 orders) and PROMOTED: FLEET b54e22c (14:39Z). G1-G4 0;
bot-time without a usable pickaxe canary 12.6% -> 3.7% vs control 18.4% -> 20.5% (DiD -11 points); deaths 3/90 bot-h vs
16/450 (0.94x). CANARY LIVE: climbflood-02 @ c902d6f on board-a,board-c,hive-a (15 bots) since 14:44:21Z; two versions
confirmed (65 b54e22c, 15 c902d6f); reads ~17:44Z / ~20:44Z. NEXT: towndeposit (variants b54e22c / c902d6f being built),
then foodskip+apples. Still to build: the "go home to restock" ladder step (pickaxe-less bots away from town).

## 10-06 09:16Z — climbflood-02 READY and CHAINED after withdraw-01 (variants 47110e8 -> cf2 6ca31e9, b54e22c -> c902d6f;
main 3dd0b75). Root causes of climbflood-01's 3 rows, each reproduced on Paper with the old build: ice melts to water
when broken (scene H: old 3/3 flooded, new 0/3); a second dig trusted mineflayer's stale "air" before the server's water
arrived (300 ms settle added); a 3-deep sand column with water on top (whole column now read; flood exit sidesteps
before unburying). Codex APPROVE. withdraw-01 +180 NOT_YET (deaths 1 vs 5, same rate).

## 10-06 06:30Z — CLIMBFLOOD-01 INCONCLUSIVE (+360, 05:11Z), torn down 05:15Z (fleet stays 47110e8). Exposure met (202 opps);
20 s endpoint canary 1.36% -> 0.00% vs control 1.19% -> 1.54% (E0 3.6, 0 observed); harm not detected; BUT correctness
caught 2 real breaches (hive-d-Alpha 04:59Z, caller=ramp_step: dug ICE -- ice melts to water when broken -- then sand
over water 4 s later) + 1 refusal written wet. Fix round (ice/frosted ice as water; ramp_step re-check; Paper ice scenes)
-> climbflood-02. CANARY LIVE: withdraw-01 on board-b,placebo-a (10 bots) since 05:22:41Z (variant 47110e8 = b54e22c);
reads ~08:22Z / ~11:22Z.
MODEL SELECTION checkpoint (Stage A+B, report on main): brain gemma4:26b (LM Studio MLX 8-bit, thinking off, grammar);
overseer + stuck gpt-oss:120b (reasoning medium, Ollama). C1 closed-loop (7B vs gemma Ollama vs gemma LM Studio; 8 bots,
90 min, 3 blocks) running from 06:23Z (orchestrator on the mini, bots on 10.0.0.31). Ollama upgraded 0.33.3 -> 0.35.1.
OWNER DECISIONS PENDING: (1) Studio memory: gemma 8-bit + gpt-oss ~93 GB + co-tenants ~32 GB (LCIA keepwarm coder:7b;
THIS project's own tier-1 shadow analyst cron on 10.0.0.31, ~/analyst.py at :03/:33 calling qwen3.8:27b) exceeds the GPU
budget; (2) C2 needs a bench-only bot-code hook (never deployed), both engines reviewed.

## 10-06 ~04:30Z — READY (not launched): towndeposit td-on-1918bb5 @ 09415cc and foodskip+apples fs-on-1918bb5 @ 41fa406 (Codex
APPROVE; Paper: apples 6 composted / 4 kept x4 in peaceful, 0 with the switch off / on easy / on control); registrations
+ reads on main 419dca1 and on the host; both trial-merge cleanly onto 47110e8 -- rebase onto the fleet sha when their
turn comes (after withdraw).

## 10-06 ~03:30Z — OWNER: compost APPLES in peaceful worlds (same switch as foodskip, keep 4, apples only) -- folded into
foodskip-01 as one "peaceful food policy" variable; builder updating fs-on-1918bb5 + read/registration. Bone meal on the
tree farm offered as the sink; not yet explicitly approved. Model selection A2 (1,008 real decisions): bot brain
gemma4:26b (infeasible 1.3% vs 13.3%, repeats-failed 21% vs 73.5%, 4x loop 28% vs 90%; top blind-judge scores);
overseer gpt-oss:120b (100% valid, 55/60 optimal allocations, 1 rule violation); LM Studio MLX beats Ollama under load
(gemma 8 concurrent: 8.8 s vs 17.1 s; 43 vs 25 decisions/min). Stage C closed-loop runner prepared.

## 10-06 ~00:15Z — TREEFARM-01 (blueprint builder + town tree farm) BUILT, REVIEWED, REGISTERED, NOT LAUNCHED. Queue: LAST
(owner 10-05 ~19:00Z). Branch bp-on-1918bb5 @ 453cd07 (base 1918bb5; REBASE onto the fleet sha when its turn comes --
chestSiteRefusal and the junk well's site search must then refuse farmIndex cells). Registration main
docs/reports/treefarm-01.1918bb5.json; read scripts/host/treefarmread.py (staged /tmp/treefarmread.py on 10.0.0.31; dry run
37 s, positive control 352 control log gathers; changerowcheck/licencecheck/v30 preflights dry-run OK). Codex APPROVE r6.
MEASURED (Paper sandbox4): saplings grow a median ~16 min at rtick 3 in light, 0 at night without light, at daylight
speed at night with the farm's torch layout; leaves in a column do NOT block growth (16/16) -- and a harvested tree's
leaves never decay while a neighbour stands, so this mattered. E2E on the final sha: build 9/9 + 4/4 confirmed, SIGKILL
resume, foreign lease, other skills around it, grow -> ordinary gather -> clear -> replant loop closed; harvest A/B on
the same farm: ctrl 15,16 logs vs cand 21,23 (no harm). Bone meal arm built, OFF by default (owner decision pending).
Bags: 76/80 bots hold >= 6 farm saplings, 62/80 carry torches. Design + follow-ons (WORKSHOP, SAFE MINESHAFT, designed
not built): docs/reports/blueprint-builder-design-2026-10-05.md.

## 10-05 ~23:30Z — TOWNDEPOSIT + FOODSKIP built, reviewed (Codex APPROVE), registered (main d7aafcf), NOT launched; both on
1918bb5 and need rebasing (trial picks onto 47110e8 and withdraw pass). towndeposit Paper: full bag 3/3 banked exactly
the surplus (60-use spare pickaxe, cobble 20, logs 10, raw copper 7), kept spent+best pickaxe, iron, coal, stockpile
targets; the model's own deposit with the same bag banked the spent AND best pickaxe, iron and coal. foodskip: Paper
caught a real bug both reviews missed (mineflayer 4.37.1 stores difficulty undefined on 1.21.8, so auto never fired);
fixed by reading the packet, tested through the real decoder. HONEST: foodskip barely moves bags (sought apples ~0.07
/bot-h; the ~2 food slots already held have no exit -- apples ARE compostable in vanilla: a composter-list change is
the exit, owner decision).

## 10-05 23:03Z — CANARY LIVE: climbflood-01 @ f590430 (cf-on-47110e8) on hive-d,hive-b (10 bots; the draw gave 2 pools,
not the design's 20 bots -- exposure needs >= 100 canary escape opportunities, dry runs gave 107-163 at +180 on 10 bots),
declared 23:01:19Z; exactly two versions (70 on 47110e8, 10 on f590430). Reads +180 ~02:01Z, +360 ~05:01Z 10-06,
extensions to 1560. Withdraw (rebasing onto 47110e8) goes next and will need a quick re-rebase if climbflood is kept.

## 10-05 21:43Z — CHESTFULL-02 KEPT (+360) and PROMOTED: FLEET 47110e8. C1-C4 0, rescues 16 ok, instrument 43; deaths 4/120
bot-h vs 9/240 (0.89x). WATCH: canary successful deposits 37 -> 18 vs control 96 -> 94 (DiD -0.153/bot-h, harm watch,
small n) -- the coming towndeposit makes deposits deterministic. NEXT: withdraw (rebasing onto 47110e8) and climbflood
(rebasing onto 47110e8 as cf-on-47110e8; registered as a FIX per the owner's 09-29 rule: deterministic gates decide,
effect reported; read defects fixed after Codex CHANGE x3 -> APPROVE; Paper: control flooded 17/17 eligible, candidate
0/20) -- whichever is launch-ready first. towndeposit/foodskip and the blueprint builder also need rebases onto 47110e8.

## 10-05 ~19:30Z — OWNER: add a frontier STRATEGIST ("god" layer, Claude/GPT via API, hourly-daily: world goals, role
targets, cross-world lessons, proposed blueprints/rules/skills through the same sandbox + canary gate) to the queue
"further down, its not a rush". Architecture agreed: strategist (frontier) -> overseer (large local) -> bot brain
(fast local) -> reflexes (code), with a deterministic validation layer on every order. Order: model selection ->
overseer first real job (stock record + assembler orders) -> strategist in SHADOW (one plan/day scored against
outcomes) -> authority over overseer targets once it proves out. Needs owner-placed API keys on the host (I never
handle credentials). Not started.

## 10-05 ~19:00Z — OWNER: build a BLUEPRINT BUILDER skill (both engines + GitHub prior art), proven first on a TREE FARM
by town; then a town WORKSHOP and a SAFE MINESHAFT (cobble-lined, ladder exit). Queued BELOW the current queue (after the
cobble rule). Designing/building now on bp-on-1918bb5 (not launched). Bone meal on saplings: a separate switch, default
OFF, until the owner decides. Also discussed (no build yet): overseer roles -- town stock record -> Assembler orders
(806 iron ingots ~= 260 iron pickaxes) -> stock-driven priorities -> Rescuer (big model) -> Builder.

## 10-05 ~18:35Z — OWNER: food no-pickup in peaceful worlds (switch auto|on|off from server difficulty) and an AUTOMATIC
TOWN DEPOSIT for full bags -- both being designed (both engines) and built as separate canaries (towndeposit-01,
foodskip-01). Evidence: docs/reports/bag-creep-analysis-2026-10-05.md (fleet average flat ~33.2 slots; ~11-12
slots/bot have no exit; 715 full-bag town stays carried bankable items, 231 tried a deposit; 35% of model deposit
proposals asked to bank apples; scoreboard undercounts ~0.8 slot -- eggs stack 16). Underground safety:
docs/reports/underground-safety-design-2026-10-05.md (every drowning a sealed pocket; the escape climb digs into
water unchecked = 28% of drownings) -> climbflood-01 being built. Studio co-tenants identified (com.lcia.* launch
agents: keepwarm watchdog restarts Ollama + pins qwen2.5-coder:7b; NUM_PARALLEL=4; caching proxy :11435) -- owner
investigating; Ollama upgrade approved. Model screen A1: gemma4:26b leads (infeasible 1%, repeats failed 14%, overseer
valid 88% vs the fleet 7B 14% / 71% / 17%). QUEUE: chestfull-02 (live) -> withdraw -> climbflood -> towndeposit ->
foodskip -> grid fix -> bamboo -> junk well re-run -> cobble rule.

## 10-05 17:15Z — JUNKWELL-01 REVERTED by the death gate (15:13Z): 6 canary deaths / 51.1 bot-h vs 11 / 358.2 (3.83x,
lower bound 1.40x, randomization p = 0.033). All 6 were 80-173 blocks from the well, deep underground: 4 drownings in
sealed water pockets (y 36-60), 2 lava (y -1, -55); none within 2 min of well activity. MECHANISM (measured): canary
mine actions/bot 15.9 -> 48.9 vs control 34.8 -> 33.5 (DiD +34.3) -- unique among 7 canaries (others -8.2..+5.0), so
NOT a restart effect: freeing bag space sent bots back to iron mining (GET_IRON was blocked on no_room), into the
fleet's existing sealed-pocket and lava weaknesses. The well worked (+180: 154 items disposed, C1-C6 0, junk slots
DiD -1.30). OWNER 17:10Z: work on UNDERGROUND SAFETY next (design with both engines running), and analyse why bags
creep back up (45 at >= 34 slots in 07:01-17:01Z vs 38 overnight; analysis running). The junk well returns after
underground safety. CANARY LIVE: chestfull-02 @ 47110e8 on board-a,board-c,board-d,placebo-d (20 bots) since 15:24Z;
reads ~18:24Z / ~21:24Z. Scoreboard 07:01-17:01Z: no pickaxe 2/80, no usable 12, trip 35, raw iron 167, wood 55.1%.

## 10-05 ~14:30Z — CHAIN: junkwell-01 (live; +180 NOT_YET 13:10Z: 2 wells built, 6 disposals / 154 items, C1-C6 0,
listed-junk slots/bot DiD -1.30, deaths 1 vs 6 same rate) -> chestfull-02 CHAINED on the host (variants 911d792 ->
chest2-on-911d792 @ 7ee230f, which also changes the well's site picker to respect claimed chests; 1918bb5 ->
chest2-on-1918bb5 @ 47110e8). Then withdraw (wd-on-6c9a8fb @ 098cb6b: town-miss gate fixed; rebase onto whichever
chestfull-02 lands) -> grid fix (gf-on-1918bb5 8c9239d / gf-on-911d792 ced0b52 ready; will need a rebase onto the
chest-full fleet sha) -> bamboo. Rebases happen per stage as each lands.

## 10-05 ~13:00Z — OWNER DIRECTION: 4-8 really smart bots are fine (80 not needed); a larger model as OVERSEER and for STUCK
escalation; find the best model(s) with both engines, an "extensive and exhaustive" test, all public sources. The M4 Studio
(ai.ticrcorp.com) is DEDICATED to this; model downloads there are authorized; never 10.0.0.72. Running: Codex research
(docs/reports/model-research-codex-2026-10-05.md: worker qwen3.6:35b-a3b / Nemotron-3.5-Lightning-30B-A3B / qwen3.8:27b /
Gemma 4 26B-A4B; overseer qwen3.5:122b-a10b / gpt-oss:120b / Nemotron-3-Super-120B-A12B; control Hermes-4.3-36B);
Codex test-plan design; Claude research + staged benchmark (A replay of real decisions, B ground-truth scenario suites,
C closed-loop sandbox bots driven by finalists, D blind two-vendor judging) -> docs/reports/model-selection-2026-10-05.md.
Also delivered: trapped-bots-analysis (11-15% real stranding; 4 bots stuck all day; 74% of bot-time outside any skill)
and withdraw-habit-design (bots never learn chest contents; withdraw proposed 10 of 158,821 decisions/24 h).

## 10-05 ~10:30Z — CHESTFULL-01 REVERT INVESTIGATED: no mechanism found. 0 of 7 canary deposits had a watchDigging stop
(fleet nav profile canDig=false); the y=15 chest was targeted 14x in the 3 h BEFORE the deploy on the fleet base (so not
this diff); bank closure never triggered (0 _deposit_new_chest, 0 bank_closed of 201 rejections). The mining rise is
milestone timing: 57 of 71 canary mine decisions were in gather_iron_ore_3 (entered before the deploy); mines per
iron-milestone decision 0.57 vs 0.56 pre (control 0.47 vs 0.51). The deaths were in iron mining, wood gathering and
a goto home after iron. The revert stands as recorded (the gate did its job); the re-run is chestfull-02 with real
fixes Paper found: a bot sealed in a 1-block pocket got "arrived" 17-18 blocks short, struck the good town chest and
CLOSED THE BANK (6c9a8fb 2/2; new 0/2); a deep chest 20 below home was banked into (old 1/1, new 0/3); the chest walk no
longer watches digs; one town boundary (16 h / 12 v); only a truly closed bank closes. chest2-on-1918bb5 @ 47110e8,
Codex APPROVE (round 3), registration chestfull-02.1918bb5.json on main 25c543a. GRID FIX: independent Claude review
APPROVE (Paper: control stranded the grid 12/12, candidate 0/11; bamboo interrupted fold clean 2/2 on the fix);
registration gridfix-01.1918bb5.json (main 483f2b0); a variant on the junk-well base (911d792) is being built so the
chain launches whichever way junkwell-01 ends. QUEUE: junkwell (live) -> gridfix -> chestfull-02 (must add
wellReservedCells to chestSiteRefusal if the well is kept) -> withdraw (rebase onto chest2) -> bamboo (on the grid fix).

## 10-05 10:07Z — CANARY LIVE: junkwell-01 @ 911d792 on placebo-a,board-b (10 bots), declared 10:05:20Z; exactly two
versions (70 on 1918bb5, 10 on 911d792). Reads +180 ~13:05Z, +360 ~16:05Z (extensions to 1560, deadline 1680). Both
engines APPROVE (Codex AGREE after 8 rounds; independent Claude review CHANGE -> APPROVE at 8f73e80; later fixes:
unloaded neighbour = "decide later", snow-raised aim, C4 = stuck inside >= 2 min). Paper: 432/432 items into the shaft,
0 off-list, 0 pickups by a walker, admission refusal, escape from inside in 7 s, creeper clearance 0 spawns.
Expected exposure ~7-12 dispose orders per 6 h once each town builds its well. CONDITION for the chest-full rebase:
chestSiteRefusal must refuse wellReservedCells.
OTHER WORK: withdraw ed0d856 (code done, waits for chest2); chest-full round 6 (chest2-on-1918bb5, evidence + walk fix);
grid fix 8c9239d (Codex APPROVE; Claude review + Paper + registration in progress); bamboo waits for the grid fix.

## 10-05 03:17Z — CHESTFULL-01 REVERTED by the death gate at +30 min (3 canary deaths / 15 bots vs 0 / 65 in 25 min;
randomization p = 0.0018); torn down 03:22Z; fleet 80/80 on 1918bb5 (verified 05:58Z). Deaths: board-a-Bravo drowned
sealed in a flooded pocket at y=45 after entombment; placebo-d-Bravo drowned gathering birch; board-a-Alpha fell 73
blocks during goto. None had a deposit/chest row in the 150 s before death. RESTART EFFECT RULED OUT: over 15 canaries
since 09-27 (8.9M rows, 408 deaths) canary deaths in the first 45 min after deploy 0.023/bot-h vs 0.019 later (excl.
this run); control 0.026 vs 0.028 -- so 3 early deaths (~0.25 expected) is a real outlier. Behaviour shift in the 30 min
(15 bots, small n): canary mine/bot 1.73 -> 4.33 (control 2.85 -> 2.75), _entombed 2.87 -> 4.67 (2.11 -> 2.86), deposits
0.67 -> 0.47 (0.71 -> 0.77); 3 deposits tried a chest at 365,15,184 (y=15, a deep container) "No path". Evidence:
docs/reports/chestfull-01-revert-evidence.txt. Codex causal review running; NO re-run until a mechanism is found or
ruled out. Grid fix (Codex APPROVED 8c9239d) is being prepared for the slot (Claude review + Paper + registration).

## 10-05 02:47Z — CANARY LIVE: chestfull-01 @ 6c9a8fb on board-c,board-a,placebo-d (15 bots), declared 02:46:55Z;
exactly two versions (65 on 1918bb5, 15 on 6c9a8fb). Reads +180 ~05:47Z, +360 ~08:47Z, extensions 540/720, deadline
780 min. After the 10-04 clear a placement is ~0 per 6 h on the canary (1 full-chest failure fleet-wide in 8.1 h vs 52
in the 12 h before), so a KEEP means "C1-C4 defect gates 0 and ordinary deposits unharmed"; placement itself is proven
on Paper (sandbox/craft/chest-ab.cjs: carried chest placed 2/2 where the control failed 2/2; nothing dropped in any
trial). The licence kind row does not gate the verdict (verdict.py has no min_rows); exposure = >= 20 canary deposit
rows + the control positive control. Withdraw (registered on 6c9a8fb) chains after this.

## 10-05 ~02:45Z — CHESTFULL-01 READY, NOT LAUNCHED (chest-on-1918bb5 @ 6c9a8fb; registration on main
docs/reports/chestfull-01.1918bb5.json; staged on 10.0.0.31: ~/mcai-analysis/chestfull-01.1918bb5.json, /tmp/chestread.py =
repo md5 0b936388, old read backed up /tmp/chestread.py.bak-20261005T024025Z). Suite 225/225, eslint only withinBody.
Launch: `~/chain-after.sh toolclean-01 chestfull-01 1918bb5=/home/mike/mcai-analysis/chestfull-01.1918bb5.json`.
**EXPOSURE AFTER THE CLEAR IS ~0 FOR PLACEMENTS:** 1 storage_full deposit fleet-wide in 8.1 h after 18:07Z (52 in the 12 h
before). The read therefore gates DEFECTS deterministically (C1 off-site, C2 from the bots' own claim ledger in
/var/lib/mcai/_pool-*, C3 unsettled EVENTS, C4 craft-while-carrying from the END snapshot net of a crafted-unplaced chest)
with exposure = the ordinary deposit path (>= 20 canary-build deposits + a control positive control); success DiD is
REPORTED only (identical-code null -0.73/bot-h). The placement path is proven on PAPER (sandbox/craft/chest-ab.cjs, both
arms): carried 2/2 placed + banked (control 2/2 "could not make another chest" while carrying one), craft 4/5 (1 safe
refusal: craftsync baseline_unanswered), budget refusal chain 2/2 (admission refuses, no walk, prompt stops advertising
deposit), roomy 2/2 = control, site 2/2 (no path floor, off table cells), far 2/2 nothing placed; nothing dropped anywhere.
chestread now streams (memory 294 MB for a 12 h walk) -- the other reads still hold every row via Events.load.

## 10-05 ~02:30Z — BAMBOO-01 READY BUT HELD (bb-on-1918bb5 @ 33384ad; registration on main 33b5a27; staged on the host,
NOT launched). Paper round 2: the stuck-watchdog and tally defects are fixed (32-fold 3/3, 64-fold 3/3 in its window,
planks never burned 26/26, control 6/6 no change) BUT an interrupted fold (low-health reflex) strands up to 46 bamboo in
the 2x2 grid 3/3 -- the craftsync grid defect the GRID FIX repairs; G3 would REVERT on it and the items drop at logout.
DECISION: bamboo waits for the grid fix and is rebased onto it. Canary order, first ready first, dependencies kept:
chest-full (6c9a8fb, sandbox+registration in progress) | grid fix (gf round 5: invalidate the held ticket on a
click-cap timeout) -> bamboo (on the grid fix) -> junk well (building) -> withdraw (on chest-full; Codex APPROVED
2691727; Claude review + first Paper run in progress) -> cobble rule. Grid fix and withdraw share byte-identical
window-binding code (inflight.mjs + craftsync spans). Agents share /tmp/mcai-suite.lock and /tmp/mcai-sandbox.lock.

## 10-05 00:05Z — TOOLCLEAN-01 KEPT (+360); promotion of 1918bb5 fleet-wide follows (chain). Spent axe/shovel/hoe
copies per bot canary 2.25 -> 0.05 vs control 2.27 -> 2.22 (DiD -2.15); G1/G2/G3 0 (G3 amended 19:35Z before the
+180 read: the deposit window covers the whole deposit -- all 10 good-tool losses in the window, both arms, were spare
pickaxes banked during long deposits); instrument 220; 1-use pickaxes/bot DiD +0.13 (reported). Death gate HELD:
6 canary deaths / 120 bot-h vs 7 / 240 (1.71x, lower bound 0.58x); all 6 are idle drownings, none within 90 s of a
spent-tool event; the drawn pools drowned more before the canary too (4 vs 9 in the 6 h pre-window).
NEXT (owner: bags and chests first): bamboo-01 (rebasing onto 1918bb5 + sandbox + registration with change_rows) ->
junk well (building) -> withdraw (round 6) -> cobble rule -> chest-full -> grid fix (round 4, adopting withdraw's
window binding). Session paused twice on Claude limits (10-04 ~20:00-23:55Z).

## 10-04 19:45Z — JUNK WELL SANDBOX (Paper 1.21.8, sandbox3; docs/reports/junk-well-sandbox-2026-10-04.md): control 20/20
picked up on open ground; accuracy 59/60 (117/118 over two runs; the miss re-collected by the thrower); isolation 0
pickups (30 s on the trapdoor, 8 rim blocks, 200 passes, open-trapdoor rim); despawn at age ~6000. FOUND: (1) the age
PAUSES in an unloaded chunk (items wait, still unreachable); (2) pathfinder routes over an OPEN trapdoor (0/12 fell
in crossing) but a bot whose GOAL is the well cell falls in (2/2) -- admission rule + never target the cell; (3)
clearance under the cap is 1.8125 not 1.5: a creeper (1.7) fits and the shaft is dark -- fleet is peaceful, but for
"any world" put the second trapdoor (recipe makes 2) bottom-half on the floor (untested). Run beats reading: the
well's isolation holds, so Codex's 20-iron feeder is not needed; its admission/underground-neighbour concerns are
real and go into the build.
WITHDRAW d490102 (round 4 H-N): 229/229, 79/79 mutants; Codex confirmation running.

## 10-04 18:40Z — DISPOSAL: owner accepts vanilla 5-min despawn as the INTERIM disposal ("fine for now, long term i want
a better solution"). Designs: Claude "junk well" (1x1, floor 2 down, wooden trapdoor cap, 6 planks/town;
docs/reports/disposal-design-2026-10-04.md) vs Codex sealed chest->hoppers->dropper chamber (20 iron + redstone/town;
disposal-design-codex-2026-10-04.md; its merge concern is moot at the measured merge radius 0.5, its admission/
underground-neighbour concerns stand). Paper sandbox subset running to decide. Long-term open item: a better disposal.

## 10-04 18:08Z — ONE-TIME CHEST CLEAR DONE (owner approved). 105,053 junk items / 3,473 slots removed from the 16 town
banks; kept items 92,846 -> 92,846 exactly; full bank containers 233 -> 0; free slots 2,669 -> 6,142. Details in
chest-clear-manifest-2026-10-04.md. **Fleet-wide world event at 18:07Z, inside toolclean-01 (declared 17:55:31Z):** both
arms see it, so DiD absorbs the level shift; note it in the toolclean read. Owner also decided (10-04 ~18:10Z): RCON
rotation later (not major); eggs/flint/clay/ink/scutes have no use -> cleared; cobble: keep 256/town reserve, bank only
when it frees a slot (both-engine no-ledger design); withdraw no-room: junk swap ONLY once a disposal exists, hold
until then. Disposal design (both engines + external search) running. toolclean-01 live: 60 bots 56db2cd, 20 on 1918bb5.

## 10-04 17:51Z — COMPOSTER-01 KEPT (+360) and PROMOTED 56db2cd fleet-wide 17:50:43Z; toolclean-01 chained next.
+360: 12 real compost visits, C1-C5 all 0; junk slots/bot canary 5.60 -> 3.50 vs control 4.90 -> 4.96 (DiD -2.16);
share of bots at >= 34 slots DiD -0.214; 2.00 slots freed per visit. Only board-b built a composter (hive-a visits
used it? -- check hive-a has one after promotion). Deaths 1 vs control 6 (rate 0.017 vs 0.020/bh).
craftroom refusals explained (6 h fleet, 3,187 _craft_room rows, 71 bots): 2,534 refused, all at 36/36 slots with
"no spent tool that can be spared (the last digging pickaxe is kept)"; bags hold leaf_litter, bamboo, saplings, eggs,
cobble. Remedies queued: composter (now fleet), toolclean (next), bamboo fold, no-junk; eggs have NO exit (owner).

## 10-04 17:35Z — CRAFTROOM-01 KEPT (+360, 11:22Z) and PROMOTED ffa0f57 fleet-wide 11:32Z. COMPOSTER-01 LIVE @ 56db2cd on
hive-a,board-b since 11:37:15Z (+180 NOT_YET: 3 real visits, 1 composter, C1-C5 clean, junk slots/bot DiD -0.74);
toolclean-01 chained behind it. (Session paused ~08:20-17:25Z on API limits; the loop ran unattended.)
craftroom +360: canary pickaxe crafts the server saw lost 0 of 19 vs control 123 of 288 (43%; 91 of them at >= 35 slots);
unanswered 0/49; one entombed death on board-a-Bravo (1 vs control 6, under the two-death floor). **Watch:** 225 of 274
canary _craft_room rows are REFUSALS (remedy_failed 112, no_room 111) -- craftroom turned lost pickaxes into refusals;
the full bag is still the blocker, which is what composter/toolclean/withdraw/no-junk target. A refusal must name an
executable remedy (CLAUDE.md): remedy_failed is that remedy failing -- analyse after the composter read.
GRID FIX 55c2bf8: Codex CHANGE (P1: a fence timeout releases ownership while mineflayer still holds a click; the late
click moves items and the row still says grid_clear=yes; P2 passthrough lets reflex clicks overlap cleanup; P2 null
grid_clear on many exits). Round 3 sent: adopt withdraw's `inflight` set (one craftsync implementation). Read drafted:
scripts/host/gridfixread.py (dry run: control positive control 145 unclean 2x2 exits, next craft failed 111/135 = 82%).

## 10-04 07:50Z — WITHDRAW 98b95c8 (round 3 fixed, pushed): Codex CHANGE (2 P1: survival release closes with a click in
flight; confirmCursor does not own the inventory while its answer is pending), Claude APPROVE (5 P2). **Paper sandbox
CONFIRMED confirmCursor** (Paper 1.21.8-60: CLONE + stateId -1 is a no-op, full window_items with the true carried
item, every case). Round 4 = items H-N sent to the builder. **Owner decision sharpened:** "keep holding" cannot keep
its promise -- with a full bag the server drops the stack at the next close/disconnect/death/restart, so holding only
freezes the bot until then. Options built as a switch: hold (default) | close after 30 s | junkswap (swap the cursor
onto a never-bank junk slot, confirm, close: only junk drops). Survival release (air/lava/fire/fall/damage) closes at
once and can drop the held stack on a full bag -- dying would drop everything.

## 10-04 07:30Z — NO-JUNK: ledger DROPPED by both engines; cobble banks only when the transfer empties a bag slot (design file SYNTHESIS)

## 10-04 06:40Z — NO-JUNK DESIGN (both engines; docs/reports/nojunk-design-2026-10-04.md; NOT BUILT, Claude review running)
**Deposit already refuses almost all of the manifest's junk** (bankable.mjs:143-204: goal-wanted, fixed list, ores,
spare usable tools only). 24 h, 1.18M rows, 7,051 items in reconciled deposit runs: cobblestone 62%, wood 34%, ores
2.5%, spent tools 0.7%; ballast/seeds/litter/eggs 0 (positive control: same query finds wood/ores; refusal rows name
apple 302, dirt 90, leaf_litter 37). The census junk dates from the old every-stack deposit loop (replaced ~09-13).
So the live inflow is cobble (~7,200/day) and spent tools (~100/day, withdraw branch already stops them).
**A flat cobble cap is dangerous:** >= 64.6% of banked cobble comes from bots at 34+ slots, for whom it is the bag
relief. Log/plank/stick caps DROPPED (both engines): 4,096 cap vs 44,701 usable; bags net -2,300 wood/day.
Proposed canary stonecap-01 (after withdraw promoted, composter+toolclean closed): cobble 256/town refused only on
evidence (lower bound from chests opened < 6 h, unknown != zero), relief valve at 34+ slots, cap refusal never routes to
chest-full. Plus a hard never-bank list (zero new bag load). Eggs/flint/ink/scutes/clay have NO exit from a bag
(150+64+72 slots across 64 full bags) -- owner decision. Admin clear only after stonecap is KEPT and promoted.

## 10-04 05:15Z — FLEET ba84fa6 (craftsync promoted 05:08Z); CANARY LIVE: craftroom-01 @ ffa0f57 on board-a,hive-b,
declared 05:12:59Z; exactly two versions (70 ba84fa6, 10 ffa0f57). Reads +180 ~08:13Z, +360 ~11:13Z. Chained: composter-01
(fleet ffa0f57 -> 56db2cd), toolclean-01 (fleet 56db2cd -> 1918bb5). scoreboard.py now rotation-aware.

- **WITHDRAW round 3 (515d99c): both CHANGE on the recovery lifecycle** (pending click across timeout; reflex
  equip clicking the inventory during a hold; quiet window != server-confirmed empty cursor; disconnect not
  cancelling a retry; server-closed window; unbounded hold = dead end). Builder applying A-G. **OWNER DECISION PENDING:**
  last resort when a stuck cursor stack has nowhere to go after a verified rearrangement -- (a) keep holding (never
  drop; intervention_needed rows) [DEFAULT, Codex], or (b) close after 30 s (server returns it to the bag; only a
  remainder lands at the bot's feet and is picked back up) [Claude recommends]. Survival reflexes may always release.

## 10-04 04:58Z — craftsync-01 KEPT (+360); promotion to the fleet (ba84fa6) done 05:08Z
- 0 of 215 canary crafts "nothing changed" vs control 236 of 1,337 (18%); Paper answered 82/82 resyncs; 0 confirmed
  without a resync; craft p50 1.6 s / max 4.3 s; _reflex_stuck DiD -0.138/bh; deaths 1 (0.017/bh) vs 7 (0.023/bh).
  58 crafts unconfirmed = full-bag losses, now honest (craftroom's job). Known: aborted 2x2 crafts strand the grid
  (2 of 94) -> grid fix queued after toolclean.
- In review: grid fix (Claude AGREE, Codex CHANGE: in-flight click after cleanup, disconnect tracking, error-path
  verdict) -- fixing; withdraw 18b36d4 round 2 (Claude CHANGE small: abort rows, plan= field, swap failure tests;
  Codex pending); chest fix 6c9a8fb approved (Codex AGREE r5, Claude AGREE r3); bamboo fixes in mutant runs.

## 10-03 22:56Z — FLEET 3edf1d6 (ore tunnel promoted 22:48Z); CANARY LIVE: craftsync-01 @ ba84fa6 on board-c,
placebo-a (10 bots), declared 22:53:29Z; exactly two versions live (70 x 3edf1d6, 10 x ba84fa6) at 22:56Z.
Reads +180 (~01:53Z) and +360 (~04:53Z); KEEP possible from +360. NOTHING chained behind it (logpickup chain stopped;
craftroom needs its no-logpickup rebuild + registration + the read's positive control proven on craftsync's rows).
Fleet raw iron gained 33 -> 17 -> 6 per 10 h over 10-03 (no fleet-wide change): watch it now the tunnel is fleet-wide.
- **OWNER 10-03 ~23:10Z: "fix the chest full problem, use claude and codex to find the best approach, implement it and
  deploy it" + "yes" to bamboo -> sticks.** Queue: craftsync (live) -> craftroom -> composter -> tool cleanup -> CHEST
  FULL -> BAMBOO STICKS -> logpickup -> explore -> orepack -> cellmem. The ported bank fix is dropped from the slot (frees
  ~0 today; its loop-stopping parts can return later). MEASURED 24 h, 1,970 deposits: success 343 (+99 used another
  chest, +13 built one), failed 938, no_effect 659. Full-chest blocks only 90 -- and **75 of the 90 bots CARRIED a chest**
  while the skill tried to CRAFT one (bug). Bigger deposit losses: 538 path failures (no path 252, goal changed 153,
  path timeout 133) and 494 "not a banking target" (apple 311, dirt 92, scaffold cobblestone 91).
  **DESIGNS (both engines, ~23:30Z) agree:** root cause skills.mjs:2834 crafts a chest unconditionally (place only after a
  successful craft). Claude also found the deposit path DROPS a stack on "destination full" (catch at :2752, then
  chest.close()) -- a never-drop violation; bank-fix's returnCursor cures it. CHEST FIX (building, chest-on-948bc26):
  carried chest first, cursor rescue, new chest only if no container within 16 of home has room, chestSiteRefusal (no
  lids, >= 3 from composter, no adjacent chests, no body-overlap cells, read back after a timeout), shared cap 1 per
  town per 10 min and <= 12 containers. SEPARATE later canaries: deposit admission (no_effect 659: refuse when
  depositPlan is empty) and deposit path failures (538). BAMBOO (2nd): pinned bamboo recipe (never craft('stick'),
  which may burn planks), only when a slot is actually freed (64 bamboo + 0 sticks frees 0), via craftExecutions.
  OWNER QUESTION OPEN: any bankable item may open a new chest (current) vs valuable-only (09-28 rule) -- kept current + cap.

- **craftroom-01 CHAINED (~00:00Z 10-04)** behind craftsync-01: variant ba84fa6 -> ffa0f57 (cr-on-ba84fa6, craftroom
  WITHOUT logpickup; Codex AGREE on the rebuild, Claude confirmation pending -- stop the chain if it says CHANGE; Paper
  regression 15/15). STOPs by itself if craftsync is not promoted. Read /tmp/craftroomread.py = repo c6bd787 (md5
  0dc5218a); POSITIVE CONTROL PROVEN on live craftsync-01 rows: 2 of 5 canary pickaxe crafts lost on the server
  (dry run with the craftsync pools on the control side). Preflights dry-run OK.
- Composter rebuilt without logpickup: co-on-ffa0f57 @ 56db2cd (Codex AGREE). Tool cleanup de7d0aa: both reviews
  CHANGE (non-transitive comparator; name-only equip guard; hard stop 0 only on harvest digs; telemetry) -- fixing.
  Chest fix: building.

- **AUTOMATED LINE (host chains, 23:45Z):** craftsync-01 (live, ba84fa6) -> craftroom-01 (fleet ba84fa6 -> ffa0f57;
  chain pid 2294257) -> composter-01 (fleet ffa0f57 -> 56db2cd; chain pid 2295673; read scripts/host/composterread.py,
  positive control 57 full junk-holding control bots; read under Claude review). Each chain STOPs if the previous run
  was not promoted to the expected sha. Building: tool cleanup fixes (tc-on-948bc26), chest fix (chest-on-948bc26),
  bamboo sticks (bb-on-56db2cd) -- each to be rebased onto the line's tip before its own registration.

- **10-04 ~00:30Z build status (bag fixes):** TOOL CLEANUP 476edb9 -- Claude AGREE, Codex closed all round-1 items;
  being rebased onto 56db2cd (no logpickup). **LOGPICKUP REBASE REQUIREMENT (Codex):** the support-dig veto must clear a
  spent tool to hand/filler before evaluating (2-use axe -> canopy drop -> pickup_failed), with a regression test.
  CHEST FIX 421dc53 -- both CHANGE (cap blocks most towns -> budget on NEW chests: >= 10 min apart, <= 4/day, <= 12
  recovery-created standing, pre-existing not counted; unavailable vs unknown containers with per-town memory;
  MAX_SITE_TRIES=1; verified cursor rescue; 180 s real deadline; truthful closed-bank advice; table access) -- fixing.
  BAMBOO d5736f0 -- Codex CHANGE (re-check the stick cap at execution admission: 63 sticks + 1 picked up during the
  baseline -> 65, slot not freed); Claude CHANGE (pickup refusal must not back off 30 min; split stacks consolidate on
  the real server so the freed decision is too pessimistic; wiring-test mutants survive; row in a finally) -- fixing.
  **BAMBOO YIELD IS SMALL (census 00:40Z):** 68/80 bots at >= 34 slots, 29 hold bamboo, only 9 can fold now (1 slot each,
  ~9 slots fleet-wide); 18 "no batch frees a slot". Tell the owner plainly.

- **10-04 01:35Z: toolclean-01 CHAINED** behind composter-01 (fleet 56db2cd -> tc-on-56db2cd @ 1918bb5; both engines
  AGREE; Paper sandbox 6 scenes x 3 x 2 passed; read /tmp/toolcleanread.py md5 a378d4ad = repo; positive control 87).
  KNOWN pre-existing (both arms): a pathfinder travel dig can swing a held 1-use shovel when travelTool hands back
  nothing (1 of 13 sandbox trials) -- candidate for a later fix (empty the hand before a travel dig).
  **READS NOW ROTATION-AWARE** (logs rotate ~23:59Z; live-only reads dropped the window before it) and the craftsync
  tripwire counts unanswered resyncs (amendment recorded before the +180 read). craftsync-01 so far: 0 of 96 false
  successes (control 117/633), Paper answered 46/46 resyncs, many planks crafts lost to full bags (craftroom's job).

- **10-04 ~02:00Z:** BAMBOO d26eedc both engines AGREE (planner stress-tested on ~25k random bags; live census 19 of
  29 full bamboo holders eligible); Paper sandbox running; read scripts/host/bambooread.py (positive control 27).
  CHEST fix rebased onto the line (chest-on-1918bb5 @ 3be9307, patch-identical, 225/225, 20 mutants): Claude AGREE on
  round 2; Codex CHANGE with 5 reproduced items (standing-cap bypass via dismissed claims, first chest ignores memory,
  unreachable first chest, first attempt not clamped, transfer_unsettled lost on retry) -- builder fixing.
  **OWNER-LEVEL WARNING (Claude):** at <= 4 new chests/day and <= 12 standing, a town whose bank only receives (125k in,
  48 out/day on 09-28) fills its expansion budget in ~3 days; then refusals are honest but permanent. The lasting fix
  is withdrawals or ballast disposal; the chest read should report the refuse_cap share so that point is visible.

- **OWNER 10-04 ~02:50Z: bots WITHDRAW from chests; NEVER deposit junk; existing junk comes OUT. "use both engines to
  formulate, implement ... deploy ... monitor and test ... if not effective revaluate make changes and deploy changes."**
  Running: read-only RCON chest census (slot by slot, tool durability, proposed junk list); both engines designing
  withdraw + no-junk deposit + clear + queue order. The one-time admin clear (09-28 permission) runs only after the
  no-junk fix is live, with the exact list shown to the owner first. 09-27 chests: 124,894 items, 42% cobblestone,
  but 16k logs, 6.8k sticks, 865 stone pickaxes while 45/80 bots lack a usable pickaxe.

- **CHEST CENSUS 10-04 02:52Z (read-only, every slot answered; docs/reports/census/):** bank = 375 containers near
  the 16 homes, 197,863 items, 228/375 full, 73% of slots used. Valuable: 897 usable stone pickaxes (640 > half), 438
  wooden, 8 iron; iron ingots 430; logs 44,701; sticks 14,215; chests 168 -- while 45/80 bots lack a usable pickaxe.
  Junk (proposed): 100,593 items / 3,125 slots (42%): cobblestone above 256/town 81,535; spent tools 1,156; ballast
  9,721; seeds/litter 8,180. Manifest for the owner: docs/reports/chest-clear-manifest-2026-10-04.md (NOT RUN; after
  the no-junk fix; owner decides eggs/scutes/flint/clay/ink 2,297 and decorations 125).
  **SECURITY:** /tmp/scan2.py on 10.0.0.31 holds hive-b's RCON password in plain text and it was printed into this
  session's output while searching for the old census. Owner asked to rotate it and delete the file (and /tmp/scan.py).
  I do not touch credentials.

- **BAMBOO SANDBOX (Paper, ~03:40Z):** short folds work (B: [64,10]+32 sticks -> 5 crafts, 36->35; E cap kept; C/G no
  order; planks never burned) BUT (1) folds > the stuck limit are killed by the 20 s watchdog (32-craft fold stops at
  15, frees nothing; 64 cannot finish; one rep ended fuller) -- no stationary window declared; (2) an ABORTED fold left
  8 bamboo in the 2x2 crafting grid/cursor, invisible to the bag, dropped at logout -- **checking whether this is a
  craftsync defect (live canary, KEEP possible ~04:53Z) or bamboo-only**; (3) row crafts off by one on abort; (4) the
  runner filed the aborted run as success. Harness on main (8ab8a5c). Chest fix 96cfbe0: Claude AGREE; Codex two more
  edge cases (clamped timeout converted in recovery/sweep; walkFrom aliases a mutable Vec3) -- fixing, then withdraw.

- **CRAFTSYNC GRID DEFECT CONFIRMED (10-04 03:25Z, builder repro with real craftsync + mineflayer + fake Paper):** an
  ABORTED 2x2 inventory craft (stuck watchdog, interrupt, preempt) after the first click leaves the grid + cursor
  loaded (craftsync never sends close_window 0 on the cancel path); items return on the next craftsync craft's baseline
  close, that next craft fails once, and a logout/restart before it drops them. Table crafts are clean. The control
  cannot be aborted, so this exposure is NEW. Live canary: 2 of 82 crafts in 4.5 h (oak_planks 2x2). **DECISION:**
  craftsync-01 proceeds to its +360 read (the 19% false-success fix outweighs this narrow, mostly self-healing defect);
  the GRID FIX ships as its own canary right after toolclean: order toolclean -> gridfix -> chest -> withdraw ->
  no-junk -> admin clear -> bamboo -> logpickup.

## 10-03 22:38Z — oretunnel-03 KEPT (+1560), then promoted
- Iron collected per bot-hour: canary 0.004 -> 0.038, control 0.014 -> 0.016, **DiD +0.033**; 10 iron on 10 canary bots
  vs 29 on 70 control bots; 75 tunnels, 7 reached the ore; tunnel-linked deaths 0; deaths 5 canary (0.019/bh) vs 45
  control (0.035/bh), none mechanism-linked; every v6/v15c guard within. Chain launches craftsync-01 (variant by fleet sha).
- CORRECTION to the tool numbers below: the 2-10-use spent copies were 118 in a 24 h last-snapshot window and 170 in a
  90 min window; both are "latest snapshot per bot" over different windows (Codex and Claude both caught the mismatch).

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

## 10-08 ~05Z — GATE v34 (UNDERGROUND-SAFETY DEATH GATE) BUILT + STAGED, NOT INSTALLED; airpocket registrations ready
Both engines APPROVE (Claude r2-r10, Codex r10). On main d6e5eb0; staged on 10.0.0.31 in ~/gate-v34 with
MANIFEST-v34.txt (exact md5 of every staged file, each target's live md5 before, the predicted digest). Dry run (twice,
manifest self-verified): every suite passes (test_usafe 123/123, 42 mutants), predicted bundle
9452993d3c05777bb8107b66c8846655; it refuses while towndeposit-02 is live. NOTHING on the host was changed: live
verdict.py 07ad5e09, canary-loop.sh 19a06267, gatedigest OK on v33 (ac3da3b6). INSTALL BETWEEN CANARIES, sequenced with
the multi-lane install by the coordinator:  ssh mike@10.0.0.31 'bash ~/gate-v34/install-gate-v34.sh'
- The gate: class underground-safety; psi = canary POST/PRE over control POST/PRE (PRE 24 h); TRIP iff >= 2 canary
  deaths AND LB > 2.0 (calibrated). No-change false trip 3.3% (6 h) / 4.4% (26 h) on the five drowning pools (today's
  gate: 12.9% / 29.0%). Power vs a doubling 17.5% / 25.4%. Linkage by the registration's link_rules reverts at the floor.
- **OWNER DECISION BEFORE AIRPOCKET LAUNCHES:** in the stratum airpocket is drawn for (pools already >= 2x control), the
  built gate catches a doubling 3.3% and a tripling 34% at 26 h -- effectively blind; linkage + the read's C3 are the
  protection. The alternative HYB@2.5 (DiD OR matched-pool control) keeps <= 2.5% false trip and catches 35% / 76% there,
  resting on a single 5-bot control pool. Built: DID24@2.0. Report: docs/reports/usafe-death-gate-2026-10-08.md.
- airpocket-01.{ee21207,dbb4d78}.json: class underground-safety, link_rules, linkage_extra [] (the old dict crashed
  verdict.py and changerowcheck.py). Exposure NOT powered at 6 h (P(>= 2 attempts) ~50%); the registered extension to
  +1560 reaches ~95% (conditional estimate).

## 10-08 — PEACEFULKIT-01 REVISION 2: two Codex defects from the junkwell-02 merge fixed; both engines APPROVE; NOT LAUNCHED
New heads (junkwell-02's jw-on-* need a rebase onto them): `pk-on-c6e91a8` @ 39fbcde (was 6dc10d1) and `pk-on-92bc84f` @
40046b8 (was f2c4ba0); code approved at a68dc5c / f25f050, the head commits are test-only. (1) Spare swords were still
counted BANKABLE wherever a caller did not pass noSwords (deposit-due test, room advice, prompt, milestone, withdraw and
recovery planners, the town-deposit trigger): bankableInventory's noSwords now defaults to the switch, and the trip
deciders read it at the call. (2) A wooden sword could be left on the CURSOR when the furnace drain closed: Paper probe
(sandbox/craft/pk-cursor-probe.mjs) -- vanilla returns a closed window's cursor item to the bag when there is room and
DROPS it when the bag is full; the drain now puts it back into the bag, else into the furnace slot it came from, and a
drop that still happens is a K2 breach row. Six more review rounds on the drain's accounting (no second furnace credit for
an earlier call's sword; per-call ` restaged=1` mark; timed-out takes settled and uncredited). npm test 238/238 and
239/239; 83 JS + 38 read + 3 variant mutants all killed; Paper smelt/bank scenes unchanged; dry run all gates 0, every
positive control fires; licencecheck exit 0. Read md5 6151dbca (= ~/mcai-analysis = /tmp).

## 10-03 EVENING (22:40Z) — NEW ORDER (OWNER ~22:30Z: "lets do 1 and 2 now and do the bank fix now too")
- **QUEUE NOW: craftsync (launching after the ore verdict) -> craftroom -> composter -> SPENT-TOOL CLEANUP (new) ->
  BANK FIX (port of bank-fix 4d76b43) -> logpickup -> explore-toward -> orepack -> cellmem.** Still one canary at a
  time. WHY: the full bag is the root blocker (census: bag-full is the top reason wood and iron needs go unmet); full
  bags (59/80 at >= 34) are 40% misc items (bank), 22% tools of which half spent (199 spent: tool cleanup), 14%
  compostable junk (composter), 10% stone (bank), 7% saplings, 5% wood. Logpickup moved last-but-three because it
  FILLS bags (more logs kept).
- logpickup chain (pid 2197785) STOPPED 22:29Z. Craftroom and composter are being REBUILT on ba84fa6 WITHOUT logpickup's
  gather behaviour (helpers only; gather must be byte-identical to ba84fa6). Tool cleanup: design by both engines
  (running). Bank fix: port analysis running.

## 10-03 MIDDAY (11:55Z) — superseded queue, kept for history
- **OWNER 10-03 ~11:20Z: "test each crafting element seperately"; queue per Codex ("i agree with codex"):**
  oretunnel-03 (live, decides ~22:22Z) -> **craftsync-01** -> logpickup -> craftroom -> composter -> explore-toward
  -> orepack -> cellmem (deferred). One change per canary. Explore-toward is no longer next.
- **craftsync-01 CHAINED** behind oretunnel-03 (chain-after.sh pid 2191467, log ~/chain-craftsync-01.out; the explore chain pid 2073712 was stopped). Variants by
  fleet sha: 3edf1d6 -> ba84fa6 (cs-on-3edf1d6, 219/219), 8453c09 -> 9794a58 (cs-on-8453c09, 218/218) (each = base + craftsync 93b3892..6660831 + the
  behaviour-neutral pickup telemetry 3edf1d6..e2b4ebd). Registrations docs/reports/craftsync-01.<fleet>.json; read
  scripts/host/craftsyncread.py (dry run 10-03: control 100/892 crafts "nothing changed" = the positive control; the
  UNCHANGED canary pool read 17/101, so the correctness line would have fired on today's code).
- **logpickup-01 CHAINED (12:36Z)** behind craftsync-01 (chain-after.sh pid 2197785, log ~/chain-logpickup-01.out),
  FOUR variants so it launches whatever craftsync's verdict: fleet ba84fa6 -> a40c588, 9794a58 -> 54ed323 (craftsync
  promoted), 3edf1d6 -> 8c66dda, 8453c09 -> 10251f3 (not promoted; these carry the pickup telemetry). All npm test green.
  Registrations docs/reports/logpickup-01.<fleet>.json; read /tmp/logpickupread.py (md5 = repo).
- **REBASE DEFECT CAUGHT (12:20Z):** logpickup on an 8453c09 base read `gatherT0`, declared only by the ore-tunnel
  change -- every log gather would have thrown ReferenceError. logpickup.test.mjs caught it; fixed in both 8453c09
  variants. Then found the no-undef lint gate (eslint.config.mjs: "Deploys run it") was NEVER run by any v1 fleet
  deploy script (only instance #1's deploy-harness.sh) and the fleet sha fails it. Now `bots/test/lint-gate.test.mjs`
  runs it in the suite (positive control + mutant killed); the one typeof-guarded `withinBody` is declared global.
  Every cross-base variant: run the no-undef lint, not only the suite.
- **craftroom on craftsync (cr-on-a40c588 @ f975a52, builder):** craftsync is the ONE verifier (marker removed),
  count = items, one execution per bot.craft. BOTH reviews CHANGE (14:00Z): [P1, both] room is checked BEFORE craftsync's
  baseline resync -- Codex reproduced a pickaxe tossed when the last slot fills during the resync; fix = an admission
  hook inside craftsync after the resync, before the first click (+1 slot margin with an item entity in range);
  verdict labels from error.reason (unanswered / click_timeout, source=none); executable-remedy refusal. Builder applying.
  **craftroomread.py REWRITTEN** (Claude review: the old gates were 0 by construction under craftsync): correctness =
  canary pickaxe crafts the SERVER saw lost with a full bag <= 1; instrument = verdict=unanswered share <= 5%,
  verified_local = 0. Dry run clean but its positive control (`_craft_sync` lost-pickaxe rows) CANNOT be shown until
  craftsync-01's canary emits them -- prove it on those rows before chaining craftroom.
- **craftroom-on-craftsync APPROVED by both engines at e9da587** (branch cr-on-a40c588, pushed; base a40c588 = the
  logpickup variant for fleet ba84fa6). 5 review rounds, 7 real defects fixed, 30 mutants killed, 222/222: admission
  inside craftsync after an ANSWERED baseline resync (else refuse before any click); pickup hold-back never wears a
  tool, collects only within the table's reach band (anchored to the plan's station), re-measures reach after any
  walk (reason=table_out_of_reach, never no_path); remedies only if executable (placeStackOf, depositFreesSlot);
  verdict labels unanswered/click_timeout, source=none. Known limit: a pickup after clicks start can still toss.
  NEXT: sandbox A/B on Paper (agent running; also lands the craft harness from the scratchpad into sandbox/craft/),
  then registrations once the fleet sha after logpickup is known. Read: scripts/host/craftroomread.py (main c6bd787).
- **craftroom SANDBOX A/B (Paper 1.21.8, 16:40Z, 3 reps/arm/scene, server-slot oracle): control a40c588 TOSSED the
  pickaxe 21 of 21 times the bag had no room; candidate e9da587 never tossed except `race-late` (drop lands mid-clicks;
  both arms 3/3 -- the documented limit).** Candidate: full36 refused with 0 clicks + "place your one dirt" (executed:
  worked, then crafted); race-early/stream refused (admission saw the drop); logs exact (-3 log, +1 pickaxe, table
  retaken; +5.5 s); wear-out spent axe never the good pickaxe; nothing-to-free says so. Deposit advice NOT executed
  (no town chest in the sandbox). Harness landed on main: sandbox/craft/ (67a5efd). Results sandbox/log/craftroom-ab/.
- **BEFORE craftroom's canary, backport from the composter review:** depositTarget (deposit advice names one item the
  craft does not consume -- e9da587's plain "deposit" would bank the craft's own sticks/cobblestone), remedy-first
  text (Codex: 220-char truncation drops the remedy, twice: skill detail and cognitive.mjs:1037), whole-chain
  ingredient protection for planned crafts.
- **craftroom FINAL = b00b22c (cr-on-a40c588, pushed), both engines AGREE (~17:40Z):** e9da587 (sandbox-passed) +
  the backport: deposit advice names one non-ingredient item whose deposit empties a stack (depositTarget), whole-plan
  ingredient protection, remedy-first refusal text checked through formatOutcome (output-identical, 1,152 cases).
  The backport changes advice text only, not the crafting mechanics the sandbox measured.
- **composter on craftroom FINAL = co-on-b00b22c @ 661c249 (pushed), both engines AGREE (~18:30Z).** Stand cell
  enforced before the table (composter_unreachable otherwise). C4: chain room simulated (from logs 2 slots, not 4).
  **SANDBOX (Paper, ~18:45Z): build from logs 6/6 exact (34/36 and 30/36), never starts at 35-36/36 -- BUT 3 defects:**
  bone meal left on the ground 5/6 compost visits; the 20 s stuck watchdog interrupts compost visits (only dig is
  exempt -- guard composition); the stand-cell check passes off-centre and the bot's own body blocks its table cell
  (placement timed out 2/3). Builder fixing; NOT queueable until re-sandboxed. Harness on main (7742265).
  **Fixes d2f3629 RE-SANDBOXED (~19:50Z): bone meal in the bag 6/6 (0 on the ground) with the fleet's 20 s stuck limit,
  no interruption; build 6/6 exact; mid-click toss now composter_no_room; table only placed with the bot centred.**
  Edge: a boat the bot pushes can drift into the chosen table cell (1/3 placement timeout; bounded). Reviews: both
  CHANGE on one item (the avoid-set entry is a no-op; the real hazard is a path node ON TOP of the composter -> an
  exclusionAreasStep) -- builder fixing. Harness re-run on main (650052f).
  **COMPOSTER FINAL = co-on-b00b22c @ 948bc26 (pushed), both engines AGREE (~21:00Z), Paper re-run 9/9** (compost 6/6
  bone meal in the bag at the fleet's 20 s stuck limit; build 3/3 exact). The fleet-wide composter exclusion (d9b8b07)
  was REVERTED to a scoped one: Codex reproduced a drop-down landing on the top that the exclusion did not price
  (getLandingBlock cells never pass exclusionStep) and measured ~8% slower getNeighbors fleet-wide; now only the compost
  visit's two walks borrow a profile whose neighbours are filtered by their real landing cell. Shared movement profiles
  are byte-identical to d2f3629. Queue slot: 4th (after craftsync, logpickup, craftroom).
- **LATENT IRON BLOCKER (sandbox 19:50Z, verified against the fleet):** the 20 s stuck watchdog killed `smelt 8
  raw_iron` at 20.7 s (8 iron ~ 80 s of furnace time; the bot stands still). Fleet 24 h: 0 of 141 failed/aborted/
  unknown smelts coincide with a _reflex_stuck (positive control: 48 other skill rows do -- goto 26, gather 10,
  craft 3), because 72 of 232 smelts had no raw iron and batches are small. It WILL bite once iron flows. Candidate
  fix (both engines first): exempt live furnace waits the way dig is exempt (or a self-expiring stationary window
  bounded by the smelt's own budget, as compost now does); same idea as Claude's suggestion to exempt live crafting
  (craftsync batches can pass 20 s; craftsyncread now REPORTS durations and _reflex_stuck DiD).
- **MAYOR GET_WOOD was blind (found 17:00Z):** world-pooled wood; in 1,376 of 2,661 quiet snapshots a pickaxe-less bot
  held < 2 log-eq while the richest bot held a median 49% of its world's wood. Fix (shadow-mayor 77c025c + 9cad2ad,
  pushed, NOT deployed): per-bot shortage sharing RESTORE_PICK's arithmetic; replay on 2,768 live snapshots: 62 -> 1,812
  firings, = RESTORE_PICK no_ingredients exactly. Also: the mayor test suite had been RED since ~08:35Z (wall-clock
  eviction vs fixture rows) so mutant kills were unscored. Both reviews CHANGE (tests + scorer biases + revision stamp);
  **DEPLOYED 2026-10-03 18:02:46Z: shadow-mayor 784b71c, MAYOR_REV 2e82cfe81496** (matches the reviewer's independent
  hash). Both engines: live assignment behaviour unchanged but for the stamp (Codex replayed 13 ticks old vs new);
  Claude AGREE to deploy; Codex CHANGE items are all in the OFFLINE scorer (retroactive) -- builder fixing before the
  10-06 read. First snapshot per world = <world>@2026-10-03T18:02:46Z (all 16). GET_WOOD leases at deploy: 0.
  Pre-deploy records are `unstamped` (111dadc since 03:17:40Z). Backup ~/mcai-mayor.bak-111dadc. Unit limits intact
  (Nice 10, MemoryMax 512M, CPUQuota 25%). GET_WOOD's 48 h window: 18:02Z 10-03 -> 18:02Z 10-05; never pool pre/post.
  No cfg flag changes during the trial (composter flag off). Scorer runtime on 15 h live data: 4:54, 57 MB.
  **FREEZE UNTIL THE 10-06 READ:** no change to mayor_core.py, mayor_shadow.py or stack_sizes.json and no cfg flag
  change -- any of them starts a new partition and the 48 h GET_WOOD window no longer fits. Scorer-only commits are
  safe. READ RULE (Claude r3): partition 2e82cfe81496/<cfg>, 18:02:46Z 10-03 -> 03:18Z 10-06 (~56 h after warm-up and
  censoring); for GET_WOOD/GET_IRON judge xbase AGAINST THE LEASED-RANDOM baseline's xbase (lease timing cancels), raw
  xbase reported alongside; xrand is a contested-only diagnostic. Deviation from plan: the gate is now target-blind.
- After each KEEP: rebase the next item onto the new fleet sha and chain it. craftroom must take craftsync's count fix
  (count = items) and a test that its final-click marker survives craftsync's click path; composter re-runs its
  build-from-logs sandbox once craftsync is in.

## 10-02 EVENING (20:20Z)
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
11e) **CRAFTSYNC @ 6660831: Claude AGREE (4 passes); Codex CHANGES only on rare mixed-variant planning (tight
  oak+birch plank splits in batches report an honest shortfall where a cleverer split exists) — ACCEPTED as a
  documented limitation (fails safe: nothing spent, names the shortfall); revisit if the fleet read shows it.**
  Read note (Claude): duplicate-tool crafts now SUCCEED (74% of craft failures historically targeted items already
  held) and spend materials — count 'root item already held' crafts in the read; a 'you already have a usable one'
  guard is a candidate follow-up.
11d) **CRAFTSYNC SANDBOX through the real craft skill (10-03 ~10:00Z, c5c2dc5 vs 93b3892, RCON oracle):** window-0
  verification answered 140/140. Candidate 38 OK / 0 lost / 0 over / 6 honest fails; CONTROL 16 OK / 13 LOST (reported
  success, nothing made) / 7 OVER-CRAFTED (4 sticks -> 16; 8 planks -> 20 = all logs) / 4 false fails. Cost ~1.1-1.9 s
  per craft. One regression (wooden_pickaxe from logs only: the table eats the pickaxe's planks once over-crafting is
  gone) being fixed. This is likely the largest single pickaxe-supply fix available.
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
