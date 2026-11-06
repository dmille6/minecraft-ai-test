# Code evaluation: PIPELINE (fleet change pipeline + watchers), 2026-11-06

Read-only. Code at origin/main bd2c308f. Measured on .31 from `~/digest/sched.log` (one decision line every 5 min, no
gaps), `~/canary-journal.jsonl`, `~/digest/sched-state.jsonl`, `~/digest/page.jsonl`, `~/digest/ALARMS.log` and
`~/digest/stuckwatch.log`, plus git. Window: **10-23 00:00Z to 11-06 02:30Z = 338.5 h**. The scripts are in
`scratchpad/codeeval/pipeline/` (slot.py, runs.py, alarms.py, onmain.py).

## (a) Summary

1. The canary slot sat **idle 100.9 of 338.5 h (30%)** over 34 intervals, 28 of them 30 min or longer. The causes: variant and
   autorebase problems 44 h, install-holds 21 h, a held or blocked head that the scheduler will not skip 18 h, the lab-mode
   exposure wait (R10) 13 h. Most of it waits on a **human verb**, so it runs overnight until the operator wakes.
2. The pipeline mostly works: 55 runs, 50 KEEP, 3 INCONCLUSIVE, 1 REVERT. Per run: draw median 3 min, deploy 3 min, read
   3.0 h, promote 10 min. The stalls sit **between** runs and **after** them. Promotion to main took a median of 18.4 h
   (p90 50 h; 32 of 49 took over 6 h).
3. Detection exists but **pages into nothing**, and two pager systems run side by side. The scheduler and the model
   rollout write `page.jsonl`, which nothing pushes: 71 error pages in 14 days, including "ROLLBACK INCOMPLETE" at
   11-05 03:28Z. A human acted at 13:52Z, **10.4 h later**. ntfy carries 852 pushes in 14 days (about 61 a day, about 185 a day
   on 11-03..05), and 81% are goalwatch or flowledger. Alarms have no ack or owner, so "acted on" cannot be measured
   except by inference.
4. Recovery is manual by design. A refused autorebase, a stale install-hold, a held head and a death hold each need a
   typed verb. The scheduler "never skips the head", so one bad entry idles the whole queue.
5. Verdict **PARTIAL**: keep the scheduler core, journal, tripper and deploy. Do targeted fixes for skip-head,
   auto-recovery, speculative autorebase on a test host, and the orphan-manifest conflict. **Refactor the alarm and watcher
   layer** into one autopilot plus pager. Delete the lab-mode paths and the roughly 210 dead host scripts.

## (b) Findings, ranked by impact on "progress keeps moving"

| id | finding | evidence | impact (14 d unless noted) | rec | effort | risk |
|---|---|---|---|---|---|---|
| P1 | **Head-of-line blocking.** `decide()` takes `head_entry()` (first entry not done) and blocks on any H1/H3/H2 of that one entry. A held, blocked or refused head idles the slot while later entries are runnable. | canary-sched.py:422-426 `head_entry`, :1101-1108 `decide`, :504-583 `head_blockers` (a held entry is "not waiting", so BLOCK). 10-31 06:15-13:55: `H1 townfloor-01 held: PREREQUISITE` for 7.7 h, then shaft-03 launched as soon as the head moved. 10-25: `H3 lavastep-01` for 7.9 h. | H1 10.0 h + H3 7.9 h + R10 13.0 h (respawnfall 12 h overnight) + refused H2 14.9 h = **about 46 h** in which the head, not the queue, was the blocker | FIX: skip a non-runnable head to the next runnable entry that respects `after`/lanes. Page once about the skipped one. Keep strict order only for `after` deps. | M | low-med: order intent already lives in `after` and the lane notes |
| P2 | **Every recovery needs a human verb.** STALE install-hold → BLOCK "installer must release it". Refused autorebase → "build by hand / autorebase-clear". `rollout-rollback-incomplete` keeps the hold. | canary-sched.py:492-496 (stale hold goes into `block`), :620-640 `ar_view`. modelrollout.py:64 ("a stale hold BLOCKS ... pages"). 11-05: rollout stopped 03:28Z, hold expired 09:55Z, released 13:52Z. dropdig refused 13:55Z on a hand-set patch hash, hand variant 18:08Z. | 11-05 alone: **17.9 h** idle (00:00-17:50). Install-hold 21.5 h total. Only 17 `human` verbs in 14 d; each idle interval waits for one. | FIX: autopilot rules. A hold whose owner pid is dead, or whose `until` has passed, is auto-released if no drop-ins or rollout procs remain (else page). A `repo`-step refusal re-derives `diff_sha256` from the source range. | S-M | low: each rule is the current hand step made mechanical |
| P3 | **Autorebase runs serially after each promotion, on the loaded fleet host, and refuses on host-load flakes.** | canary-sched.py:2417-2429 (`nice 10 npm test`, 45-min timeout :162) on .31 at load avg 15. 20 builds, median 36 min, 9.5 h. Refusals: drainpick "none of the 3 files in its import closure changed" yet refused; monustuck refused twice at `rerun` (plinth-skill passes **1/3 on the BASE**); fewerdec; cooldown15-01 lint. Hand variants followed. | "building" 10.2 h + refused 14.9 h ≈ **25 h idle** | FIX: build the next head's variant **speculatively on the canary sha during its 3-h read** (50/55 KEEP), on ci2/.30 via suite-run, not on .31. A file that fails on the base too is a base flake, not a refusal. Keep a flake quarantine list. | M | low: the diff-identity check stays the gate |
| P4 | **Two pager systems; the scheduler's pager is never pushed.** `page()` appends to page.jsonl. Only slotwatch (since 11-02) and a hand-run fleetstatus header read it indirectly. | canary-sched.py:1664-1678; haltwatch.py:19-27 docstring admits it; page.jsonl since 10-23: 71 error, 117 verdict, 7 flag rows; no `servea`/`qwen35-roll` line in ALARMS.log in the 11-05 window. | the 10.4 h rollback-incomplete wait; every H2 refusal page | FIX: `page()` and modelrollout pages call `lib/alarm.raise_alarms` (push, dedup). Retire page.jsonl as a destination. | S | low |
| P5 | **slotwatch blind spots.** "Idle" counts only BLOCK/WAIT/IDLE ticks; `BUSY S8 INSTALL-HOLD` (not yet stale) counts as busy. One key `slot:idle` dedups across cause changes. Added 11-02, so the five biggest idle intervals (5.9-12.2 h) predate it. | alarmhead.py:57-59 (BUSY ends a streak), :188 `slot_idle`. 11-05: hold active 00:00-09:55Z with no alarm; alarm 11:05Z; cause changed to a refusal at 14:00Z with no re-push (6 h REPUSH, alarm.py:23). | 10 h unalarmed on 11-05. Since 11-02: 7 episodes, alarm→clear median 0.4 h, max 7.9 h | FIX: "no canary deployed for 60 min" whatever the reason. Key the alarm by cause code, so a new cause pushes. | S | low |
| P6 | **Promotions conflict into main on one file every time.** Every branch appends to the REQUIRED list of `nothing-important-is-orphaned.test.mjs` (502 lines, 129 commits since 10-20). The repo has no `.gitattributes`. promomerge aborts on conflict and pages. | promomerge.py:17, :236-238. 12 promomerge episodes, 10 of them `conflict` on that file. stallcheck-promo "NOT on main after 6/12/13 h". | promotion→main median **18.4 h**, p90 50 h. Since promomerge (11-02): median about 4 h, but dirtrung 23 h and llmoai 21 h. Main is also stale for every agent that reads it. | FIX: `merge=union` on that file, or split the manifest into `config/required.d/<feature>.txt` (one file per feature, no shared hunk). promomerge also runs only on the Mac (LaunchAgent), so a sleeping Mac means no merges. Move it to .31 or ci2. | S | very low |
| P7 | **suite-run.py can hang forever.** ship(): the file list is written to tar's stdin before the ssh consumer starts, so a list over the pipe buffer deadlocks. The wait loop is `while True` with no deadline and no heartbeat. | suite-run.py:91-105, :193-203 | Mac runners hung up to 27 h, undetected (brief). promomerge's suite and every hand full-suite depend on it. | FIX: `-T <tmpfile>`; an overall deadline; a heartbeat file that slotwatch-style alarms read. | S | very low |
| P8 | **Alarm noise hides the actionable few. No ack, unverified delivery** (Codex: notify ignores the curl result; dedup state is saved even when the push failed, alarm.py:90/127). goalwatch: 116 episodes / 40 goals / 414 events. flowledger: 270 events, 45 of them "stations" episodes that nobody ever acts on. stallcheck reports 53-59 items permanently (push=False, stallcheck.py:880). | ALARMS.log 10-23..: 845 events (NEW 245, STILL 384, CLEARED 209). Actionable sources (slotwatch, promomerge, stallcheck-promo, haltwatch, rollout) = 90 events (11%). | the owner learns stalls by asking | REFACTOR (alarm layer): three tiers. PAGE = progress stopped and no autopilot rule can fix it. DIGEST = daily. LOG = state. Add `ack <key> <why> [until]` and an owner per key. Measure page→ack. | M | low |
| P9 | **Goal stalls are detected well and acted on by nothing.** goalwatch meets the 3-h rule, but no code defers, skips or re-plans the project. Keys flap: one goal re-opened 14 times. | goalwatch.py:23. 17 episodes over 24 h. About **1,816 alarmed project-hours** since 10-28 (top: hive-d/shop 134 h, isolated-b/shop 131 h, board-d/shop 131 h) | 7 of 16 towns with no open project on 11-05 (brief) | FIX, cross-area: the remedy belongs in the planner (building area): defer a stuck project after N fruitless visits so the picker takes the next one. The pipeline pages only when **every** project in a town is blocked. | M | med (bot code) |
| P10 | **Pinned bots: detected, never pushed.** stuckwatch writes a log and `BOTS-PINNED.txt`, read only by the hand-run fleetstatus header. | stuckwatch.py:26, :60-85; alarmhead.py:37 | 434 of 676 half-hour samples (64%) show 1-5 bots pinned ≥4 h: **about 700 bot-h, 2.6%** of about 27,000 fleet bot-h, plus the first 4 h of each pin | FIX: push through lib/alarm with a per-bot key (6 h repush), and feed failmine. The survival area owns the cure. | S | low |
| P11 | **The lab-mode draw wait still costs slot time in fun mode.** The loop waits up to `FUN_DRAW_CAP_MIN=30` for "two pools" under the 12-h ledger exclusion, then takes the fallback anyway. | canary-loop.sh:33, :188-195 | 40 runs since 10-28 spent **626 min (10.4 h)** drawing; 14 of them hit the 30-min cap | FIX: draw the fallback first in fun mode (constant → 0). | S | low |
| P12 | **Structure: big single-file scheduler, lab-mode residue, dead scripts.** canary-sched.py is 3,558 lines and 127 defs, including about 1,200 lines of a JS import-closure lexer (:779-2073). canary-loop.sh is 700 lines; the v19/v30/v31/v33/v34 lab branches are bypassed in fun mode. There are 19 install-*.sh, v33-v37 "rules paragraph" md files, and 8 per-watcher install copies on .31 (all equal to main now; the 11-03 effect-targets staleness came from this pattern). `~/fleetstatus.py` on .31 is a **never-committed** copy, 1,016 diff lines from main. | `wc`, `git log`, md5 against the live copies | changing scheduler policy means a 3.5k-line file plus a 1,713-line test file. Every watcher installs separately. | REFACTOR partial: split canary-sched into decide / autorebase / closure modules; delete the lab paths; one install of `scripts/` at a main sha for every watcher (an rsync plus a sha stamp checked by stallcheck). | M-L | med |
| P13 | **scripts/host: 343 tracked files.** About 38 are entrypoints in cron, launchd or the loop, and about 47 more are called from them (≈85 live). Then 12 tests of live code and 20 installers. **About 225 (≈65%)** are one-off reads, analyses, patches and lab-era tools that nothing live references; 169 of all files were last touched before 10-22. | `scripts-class.tsv` (heuristic: name referenced by a crontab on .31/.40, a Mac LaunchAgent, or a live entrypoint) | search and review cost; agents cite dead tools | DELETE to `archive/host-reads/` (or a tag). Keep the list of live ones in `config/monitors.json`. | S | low (git keeps them) |
| P14 | Queue entries carry no `queued_at`, so queued→launched cannot be measured. Hand edits are journalled only as notes. | canary-sched.py `_cmd_queue` (no timestamp written) | blind spot in measuring the "wait" | FIX: stamp `queued_at` and `head_since`. | S | none |

**Good, keep:** `decide()` is pure and names a reason code every tick. sched.log is a complete audit trail, and this whole
measurement came from it. The autorebase **diff-identity** check (`norm_diff`, :649) stops unreviewed code. The one-slot
discipline, the journal, the generic 90/180 read, and the mechanical 10-min promote work. The death tripper is armed:
5 fleet halts, cleared in a median 0.1 h. lib/alarm is dedup-correct (pure `plan_pushes`, tested). promomerge merges clean
promotions on its own. rollout.py has its 60-min checks. Effect test fixtures now go to the state dir. The live watcher
copies match main.

### Per-run latency (55 runs that drew or deployed, 10-23..11-06)
draw→drawn median 3.4 min (p90 37, max 365 in lab mode); drawn→deployed 3.4 min; deployed→recorded 3.0 h (6.1 h before
fun mode); recorded→promoted 9.8 min; promoted→on main median 18.4 h, p90 50.2 h. Idle gap after each promotion (autorebase):
median 36 min. **A canary's whole cycle is about 3.5-4.3 h; the slot does 3.9 runs a day against about 6 possible.**

### Idle intervals of 3 h or more (cause; who ended it)
10-23 15:25 4.2 h install-hold (indexsearch close, human) · 10-25 05:25 7.9 h H3 lavastep (human `rearm` 13:19) ·
10-26 05:55 5.9 h H2 cavefall no variant (hand build) · 10-27 19:10 **12.2 h** R10 respawnfall exposure (overnight) ·
10-29 21:35 **11.8 h** H2 tdfull no variant (hand build in the morning) · 10-31 06:15 7.7 h H1 townfloor held (queue moved) ·
11-02 03:35 8.9 h fewerdec refused at rerun (flake) + R11 death hold (human `continue`) · 11-04 23:55 **17.9 h** servea-roll
hold + stale hold + dropdig hand-hash refusal (human 13:52 / 17:50). Seven of the eight end at a human verb (respawnfall ended when exposure came back). Six of the eight start
between 19:00Z and 06:00Z.

### Alarms raised vs acted on (ALARMS.log 10-23..11-06)
245 NEW episodes. Most clear on their own: goalwatch median 4.4 h, flowledger 14 h. Episodes still open: flowledger 11
(up to 50 h), effectwatch 3 (up to 68 h: kitmulti-01, smeltgate-01). Acted-on, where an action can be identified:
slotwatch 7/7, median 0.4 h after the push, max 7.9 h · promomerge conflict 12/12, median 5 h, max 23 h · stallcheck-promo
5/5, median 14 h · effectwatch "undeclared" 6, all cleared by one code fix after up to 29 h · page.jsonl errors (71):
**0 pushed**. There is no ack field, so for goalwatch and flowledger "acted on" cannot be separated from "went away".

## (c) Codex's independent evaluation and reconciliation

Codex ran it independently (`codex exec -s read-only`, rc 0). It got the area, the files, the incident list and the five
questions, but **not** these findings. Its full output is in `scratchpad/codeeval/pipeline-codex.md`. Codex read code only
and did not measure.

**Codex findings.** (1) A bad queue head stops all work (`head_entry`/`decide`, :422/:1094). (2) An expired install-hold
blocks instead of releasing (:492; modelrollout.py:1452 keeps it on purpose after a partial stop). (3) suite-run tar
deadlock, with no whole-job deadline (:91, :172, :194). (4) Three separate full-suite paths (autorebase on the fleet host,
promomerge on ci2, suite-run), each with its own retry and flake policy. (5) promomerge stops on the shared orphan
manifest. (6) The scheduler's `page()` only appends to page.jsonl, and slotwatch suppresses the alarm while a hold is
unexpired (alarmhead.py:180). (7) **alarm.py `notify()` ignores transport return codes (curl without `--fail`), and
`raise_alarms()` saves the dedup state whether or not the push was delivered, so a failed push is silent for 6 h**
(alarm.py:90, :127). No ack or escalation. (8) Driftwatch runs once a day at 01:20Z with a 30% threshold, so a value drop
takes about a day to see. Wants a rolling 1-3 h value check that pauses rollouts. (9) Installed copies: a merge is not an
install, so it wants one versioned tooling bundle whose digest is in every heartbeat. (10) It estimates 70-100 live
files out of 343. It keeps the slot, the diff identity, pure `decide`, the teardown, the tripper and the effectwatch
repairs. Top 3: suite-run deadlock; unified acknowledged incidents with tested delivery; a hold/queue recovery
controller. Verdict: **partial**.

**Where we agree:** almost everything. Head-of-line blocking, hold expiry, the page.jsonl dead end, slotwatch's hold blind
spot, the suite-run deadlock, the orphan-manifest hotspot, installed-copy coupling, live ≈ 70-100, keep the safety gates,
verdict PARTIAL. My measurements give Codex's mechanisms their sizes: P1/P2 ≈ 46-60 h of 101 idle h; P4 = 10.4 h on 11-05.

**Where we differ, and how I settle it:**
- *Hold recovery.* Codex says do not just delete expired holds; reconcile the real configuration first. **I accept
  that.** It is stricter than my P2 wording. Auto-release only when the holder pid is dead **and** no rollout procs or
  drop-ins remain **and** the bots' env matches the declared baseline. Otherwise page at once. 11-05 shows why: the
  "rollback-incomplete" was a false alarm (baseline-equal env), so a reconciling check would have released the hold safely
  at 03:28Z.
- *Skip-head.* Codex wants an explicit policy before any dependency-aware bypass (it rates it medium risk). I rate it
  low-med, because `after` deps and lanes already encode order. **Settled:** skip only entries whose blocker is H1-held,
  H3, R10 or a refused H2. Never skip past an `after` dependent. Page once per skipped entry.
- *Alarm delivery.* Codex's point (7) is a real finding I missed. **Add it to P8:** check the curl exit status and HTTP
  code, and do not advance `last_push` when delivery failed.
- *Drift detection.* Codex's point (8) adds to the brief's -39% value incident. **Add it as an extension of P8/P9:** an hourly
  rolling items/bot-h and idle-lap share against the 7-day same-hour median. On a sustained drop, page and pause the queue.
  Do not auto-revert.
- *Test orchestration.* Codex wants one test-job service (L). I want the cheaper step first: move the autorebase suite to
  ci2/.30 through suite-run, and build speculatively during the read (M). The unified service can come later.
  Codex did not measure the 10.2 h + 14.9 h this costs. I did.
- *Codex's top 1 (suite-run) vs my top 1 (scheduler autopilot).* By measured hours the scheduler is larger (≈46-60 h
  against one 27-h hang). suite-run is an S fix, so do it the same day.

## (d) Top 3 first

1. **Autopilot recovery in canary-sched (P1 + P2).** Skip a non-runnable head to the next runnable entry. Auto-release a
   dead or expired install-hold when the fleet shows no rollout procs or drop-ins. Re-derive a hand-set patch hash. Page
   only when nothing in the whole queue is runnable. *About 46-60 of the 101 idle hours / 14 d; M; tooling tier.*
2. **One pager, with tiers (P4 + P5 + P8 + P10).** page.jsonl and modelrollout pages go to lib/alarm. slotwatch fires on
   "no canary deployed 60 min" keyed by cause. stuckwatch pushes. goalwatch and flowledger move to a daily digest unless a
   whole town is blocked. Add `ack`. *Turns the 10.4 h / 7 h / 10 h unseen waits into 1 h ones; S-M.*
3. **Speculative autorebase off the fleet host, and the orphan-manifest union merge (P3 + P6 + P7).** Build the next
   variant during the current canary's 3-h read on ci2/.30. Classify base flakes. Add `merge=union` (or
   `required.d/`). Fix suite-run's tar pipe and add a deadline. *About 25 h idle / 14 d, plus main within 1 h of a promotion; S-M.*

## (e) Refactor verdict: PARTIAL

The scheduler core, journal, deploy, tripper and diff-identity gate are sound and well tested. The stalls do not come from
bugs in them. They come from **policy** (a strict head, human-only recovery, serial autorebase on the loaded host, a
lab-era draw wait) and from an **alarm surface** that splits into two pagers, floods the push channel, and has no ack.
Fix the policy with targeted changes. Refactor the watcher and alarm layer into one "autopilot + pager" module with a
single install. Split canary-sched.py's closure lexer and autorebase into modules when next touched. Delete the lab-mode
loop branches and the roughly 225 dead host scripts. A full rewrite would put at risk the parts that produced 50 of 55
clean KEEPs.
