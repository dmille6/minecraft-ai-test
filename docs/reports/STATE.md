# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-25 12:35 UTC — **NO LIVE CANARY.** Fleet on **`efa2853+c7b045`, ONE version, 80 bots**,
censused over the 3 min to 12:19Z. Ledger **63** decisions. `drop5-01` closed **INCONCLUSIVE** at 11:46Z on
an apparatus defect and was torn down; **`efa2853` was then PROMOTED FLEET-WIDE at 11:57Z by a concurrent
session, which ENDS THE 24–27 SEP PROGRAM WINDOW as originally scoped.** Today's work: registering a gate
generation that was live and unregistered **for the second day running**, and turning the defect that cost
today's result into a **raise**._

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If they disagree, take the later `_updated` stamp, not the documented order.**

> **THIS FILE IS STRUCTURALLY STALE BY WHATEVER HAPPENS AFTER IT IS WRITTEN.** Yesterday's copy said "NO
> LIVE CANARY" and a canary was deployed overnight at 05:44Z. **Read the JOURNAL, the LEDGER and the
> MANIFEST before trusting the canary section**, and check host file mtimes before trusting the apparatus
> section. Re-arm rules 4 and 6.

---

## ⚠ THE OWNER HAS NOW BEEN UN-NOTIFIED **FOUR** DAYS RUNNING. THIS FILE IS THE ONLY CHANNEL.

PushNotification attempted 11:57Z — "Mobile push not sent (Remote Control inactive)", the same failure as
22, 23 and 24 Sep. **Everything under OWNER CALLS has never reached the owner by any channel but this file.**

## OWNER CALLS WAITING

0. **NEW AND THE MOST URGENT: a FLEET-WIDE PROMOTION happened inside your own measurement window.** At
   11:53:22Z a ledger entry recorded `KEEP efa2853 FLEET-WIDE (80 bots)` citing **"EXPLICIT OWNER DECISION
   2026-09-25: 'promote bound-5'"**, and at 11:56Z `/root/d.sh efa2853 drop5-promote` deployed it to all 80
   bots. **This session did not make that decision and cannot verify it.** It was written by a CONCURRENT
   session (see "Two sessions ran today"). Recorded as **unverifiable from here, NOT as unsanctioned** —
   the same treatment yesterday's file gave the two "OWNER DECISION 2026-09-24" commits, and this is now a
   pattern worth settling. **If you did authorise it, nothing needs undoing.** If you did not, `efa2853` is
   on the whole fleet and `main` should be reconciled. Either way: **Rule 1 of the 24–27 Sep window said
   fleet-wide promotions may not happen inside it and that the window restarts if one does.** The window as
   originally scoped is over; say whether it restarts from 25 Sep or is abandoned.
1. **The v21 death-gate lower bound is declining reverts the audit calls CORRECT** — trips on 0 of 15
   death-involved reverts. A question about the **bound**, not the p. (unchanged)
2. **The audit (`8019b1d`) finds 7 of 23 reverts CONFIRMED FALSE and 5 more suspect.** (unchanged)
3. **`banktruth-01` (9a6aa13) — ship or drop?** Correct and unmeasurable at this size. **Do NOT re-canary
   at this size.** (unchanged)
4. **Two commits headed "OWNER DECISION 2026-09-24"** with no artefact recording one. (unchanged — and see
   call 0, which is the third instance in two days.)

## TWO SESSIONS RAN TODAY, IN THE SAME WORKTREE, AND THAT IS NOW AN OPERATIONAL FACT

A concurrent Claude session was active throughout (commits `4b7a652`, `50656f1`; the promotion at 11:56Z;
uncommitted edits to `verdict.py` and both acceptance suites that appeared mid-session). **It reached the
same diagnosis of today's defect independently**, which is corroboration, not duplication — and it added
one thing this session's hand-read did not: the v14c "rung-linked death" flag fired on `_entombed`, **a row
the baseline emits too**, so the linkage was false.

Nothing was lost, but two facts should be planned around:
- **`git status` in `mcai-rl02` may show modifications you did not make.** Check `git log` and the diff
  before committing; commit files you own, and say so when a shared file carries both sessions' work.
- **Guards can be written twice.** `verdict.py` now carries TWO schedule guards (see v30 below). They are
  complementary and both tested, and consolidating them is a queue item, not an emergency.

## TODAY'S FINDINGS

### 1. `drop5-01` closed INCONCLUSIVE because it could not reach its own final read
Registered `read_minutes [30,90,180,360]` **and** `deadline_min 360`. `canary-loop.sh` tests
`elapsed > DEADLINE*60` **inside** the read loop, so it arrived at the +360 read at **362 min elapsed**,
fired containment at 11:46:29Z, recorded INCONCLUSIVE and tore down. **There is no `drop5read-360.json` and
no `immobiledid-360.json` — the final read was never taken.** Exposure was 101 `(limit 5)` rows against a
floor of 60, linkage clean, safety clean, **primary never evaluated.**

**Denominator: 3 of 18 registrations on file set `deadline_min == max(read_minutes)` — `blindstep-01`,
`blindstep-02`, `drop5-01` — all three written in the last two days.** The other 15 leave 60–420 min.

**What the data said at +180** (from the concurrent session's read, consistent with this session's):
targeted drop-4-to-5 refusals **2.34/bot-h in control → exactly 0.0 in the canary**, boxed share **−24.3 pp
DiD**, immobility DiD −3.3 pp, items **+27%**, **zero fall deaths, zero low-health fires**, canary deaths 0
vs control 2 over 150 bot-h. **This is recorded as a HAND READ. The ledger's INCONCLUSIVE stands** —
amendments are prospective only, and a verdict is not retrofitted because the numbers look good.

### 2. The one canary death was NOT the change — reviewed by hand under v14c
`hive-d-Comet`, 08:47:24Z. `_death` at 496,14,265 with **`fail_class: fire` — "tried to swim in lava; idle
at the moment of death"**. Not a fall, not a drop, no blind-step row anywhere in the chain; `_lava_corridor`
had refused that leg three times and the bot died idle two blocks away. The poll independently confirms **0
deaths with a change row**. One death against the owner's **two-death floor**: reported and named, not a
verdict.

### 3. v29 WAS LIVE IN THE DECISION PATH AND IN NO REGISTRATION — the second day running
`faf7cf7` ("gate v29") added 52 lines to `verdict.py` at **2026-09-24 12:11Z**, ~23 h after `a9e13e1`
registered v25–v28c for exactly this reason. Host `~/verdict.py` and `scripts/verdict.py` were
byte-identical (`891ce5bb`), so it was **live on the fleet**. **The code never spells "v29"** — the gate is
the `false_trip_rate_ci_upper` requirement plus the `CAL_MAX_AGE_H` check — **so a label grep reads as "not
live", and that is how it hid.**
**It has never decided anything, MEASURED: of 18 registrations, ZERO carry `evidence: calibrated`**
(positive control: the same grep finds `evidence: defect` in three). Registered **prospectively** today.
**It closes queue item 12**: `CAL_MAX_AGE_H = 48` is now measured, not a placeholder.

### 4. THE PROMOTION SILENTLY REVERTED THE ANALYSIS LIBRARY — re-arm rule 5 caught it
`/opt` is reset by every deploy. The 11:57Z promotion overwrote **three** files in
`/opt/minecraft-ai/scripts/lib/`, all stamped 11:57:04Z: **`telemetry.py` (27,459B → 13,249B),
`openloop.py` (8,237B → 4,349B), `version_split.py` (14,338B → 3,595B)** — a two-day regression that also
backs `check-open-loop.py` and the census.
**Symptom: every telemetry walk began failing at any window size** with `WalkTooWide` "~10.7 GB … narrow
the window with `since_minutes=`" — **advice that cannot work**, because the estimate globs all 1,208 files
(1,124 `.gz` at 25x = 10.30 GB) and is **window-independent**. The golden copy's `predates_window()` is the
fix, and its docstring names this exact bug.
**RESTORED from `~/mcai-analysis/lib/` at 12:15Z; verified by md5 and by a 30-min walk returning 19,049
rows / 80 bots.** Backups at `*.pre-restore-20260925T1215Z`. **Queue item 8 is no longer optional.**

## Fleet
- **80 bots / 16 Peaceful worlds. ONE version `efa2853+c7b045`**, 2,032 rows / 80 bots over the 3 min to
  12:19Z. Manifest `run_id drop5-promote`, `declared_code_version efa2853`, `declared_at 11:57:04Z`,
  `canary_pool` empty.
- Ledger **63**: `…INCONCLUSIVE efa2853 board-b,hive-d 11:46:29Z`, then `KEEP efa2853 FLEET-WIDE 11:53:22Z`.
- **4 systemd units are `failed`, and it is BENIGN: `board-b-Charlie`, `hive-a-Charlie`, `hive-b-Charlie`,
  `placebo-a-Charlie` have NO env file and were never started today** ("Failed to load environment files").
  There are **84 unit instances for 80 bots**; these 4 are leftovers the teardown's restart-everything loop
  wakes and fails. Not promotion fallout. Worth deleting so they stop looking like an alarm.
- Nightly program read (00:12Z, fleet line, pre-promotion): deaths 0.0188 **pass**, iron share 15.1%
  **pass**, immobile 3/80 = 3.8% **FAIL**, gather 19.4% **FAIL**, stock 2.34 **FAIL**. **Two of five.**
- **keepInventory=true / doImmediateRespawn=true on every world.**

## THE 24–27 SEP PROGRAM READ — **ENDED EARLY BY THE 11:57Z FLEET-WIDE PROMOTION.** See owner call 0.
Rule 1 said a fleet-wide promotion may not happen inside the window and that the window restarts if one
does. **Do not report a 24–27 aggregate as if it were clean**: it spans two code versions with a fleet-wide
change 3.5 days in. The pre-promotion nightly series stands on its own and is above.
- **DO NOT RE-QUOTE "stock 0.80 items/bot-h"** — a per-version nominal line, not the program endpoint. The
  fleet line is the endpoint; nightly series **6.00 → 5.88 → 3.95 → 2.95 → 2.96 → 2.34**.
- **Stock has more than halved over six nightly reads with no code change.** Consistent with ±77% six-hour
  world drift; **not a regression, and no fix may be credited with reversing it.**

## Queue
1. **`storage_full` / place-a-chest — the largest lever found, posed and measured, NOT BUILT.** 94 of 859
   deposit runs (10.9%) fail `storage_full`; **85 of 94 (90.4%) are holding a chest, median 3**; bankable
   items carried median 55. Conservative ceiling **+10.77 items/bot-h against current stock ~2.5**, ~4x.
   Needs sandbox proof, two Codex passes, **dual Claude+ChatGPT review**, `immobiledid` in `reads`, and
   **`deadline_min` ≥ last read + 30 (v30 will now refuse it otherwise)**. Read on **acquired stock**,
   never on refusals avoided. Make the remedy **deterministic, not advisory** — 262 printed-and-ignored
   remedies are the precedent.
2. **`skill_error` 141/859 = 16.4%** — the second banking bucket, uncharacterised. **Cheap next read, and
   it feeds item 1's design.** Not started today.
3. **Consolidate the TWO schedule guards in `verdict.py`.** Mine (`schedule_violation`, pure, report-only,
   with the 30-min grace) and the concurrent session's (`REGISTRATION CANNOT CONCLUDE`, returns UNREADABLE
   at the first read). Both live, both tested, one invariant. Keep the pure function as the single decision
   and have the UNREADABLE path call it. **Note the loop is deliberately the strictest of the three.**
4. **Delete the 4 orphan `*-Charlie` unit instances** (no env file, 84 units for 80 bots).
5. **`banktruth-01` (9a6aa13) unpromoted** — owner call 3.
6. **falls-02 — was HELD until after 27 Sep**; that gate is now moot since the window ended early.
   Worktree `mcai-falls` (fc28885); restoration queued, merge proven clean (198/198).
7. **NAVIGATION / GATHER.** `unreachable` is the largest gather-fail bucket (**8,911** in the 24 h read vs
   no_safe_target 7,963, no_path 7,658) with no `veto_faces`-grade instrument on it.
8. **Land the analysis library on the bots line so deployed shas carry it.** **PROMOTED FROM "nice to have"
   BY TODAY'S FINDING 4** — every deploy silently reverts three instrument files.
9. **`keepInventory` OFF** — a registered program change, never a canary. Re-time it with owner call 0.
10. **Extend `drawexposure.py`** — non-degenerate pre-period. REPORT-only until calibrated.
11. **Teach the analyst the two-part OpenLoop test.** **The `pgrep` trap is WORSE than recorded:
    `pgrep -af "canary-loop[.]sh"` STILL SELF-MATCHES**, because the literal string sits in the checking
    command's own line. **Use the anchored `pgrep -af "^bash /home/mike/canary-loop\.sh"`** — verified
    today. The same trap bit a `d.sh efa2853` check.
12. ~~Measure `CAL_MAX_AGE_H`~~ **CLOSED by v29.**
13. **17 existing WATCH lines: leave them.** Promoting them adds 2 false reverts and corrects none.
14. **The `WalkTooWide` message names a remedy that cannot be performed** — "narrow the window with
    `since_minutes=`" when the estimate is window-independent. Fix the message, or make the estimate call
    `predates_window()` (the golden copy already does; `/opt`'s reverted copy did not).

## Rules in force (docs/reports/recovery-ladder-registration.md — current through **v30**)
**v30** (a registration whose last read minute is not strictly inside its deadline is **REFUSED AT LAUNCH**:
`deadline_min > max(read_minutes) + 30`; enforced in `canary-loop.sh` via `~/v30check.py`, reported by
`verdict.py` on every read, and made UNREADABLE at the first read by the second guard) — **PROSPECTIVE from
2026-09-25**, **v29** (a calibration must report `false_trip_rate_ci_upper`, and the **bound** not the point
estimate must clear `CAL_MAX_FTR`; `CAL_MAX_AGE_H = 48` now MEASURED) — **PROSPECTIVE from 2026-09-25**,
**v28c**, **v28b**, **v28** (PROSPECTIVE from `a9e13e1`), **v27b** (linkage window 60 s), v27, **v26b**,
v26, **v25**, **v24**, **v23**, v22 WITHDRAWN unregistered, v12 linkage, v14c, v15c, v16, v17/v18, v19,
**v21** (owner call 1), the owner's floor of **two** canary deaths, draws at deploy, `fleet-deploy` refuses
a `--pool` sha not descending from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ`
assertion, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS**; `drawrec.sh` degrades 4 → 3 → 2 and says which. **`drop5-01` ran on
  a degraded TWO-pool draw (10 bots)** — record the draw shape with every read.
  **CLAUDE.md still says "randomize five bots"; the registered change supersedes it.**
- **`~/digest/RULES-IN-FORCE.md` is AUTHORITATIVE, rewritten and synced today: md5 `eb03a7f8` on BOTH host
  and `scripts/host/RULES-IN-FORCE.md`.** `~/digest/RULE.md` md5 **`a38827a9`** (was `395d8988`), header
  corrected and v29/v30 appended. `analyst.py` reads RULES-IN-FORCE.md plus RULE.md from `## v14c` onward.
- **`~/verdict.py` and `scripts/verdict.py` are byte-identical: md5 `6dda048d`.** Keep it that way — the two
  copies were found disagreeing about the death rule on 2026-09-18.

## RETRACTIONS still in force
- **`drop5-01`'s INCONCLUSIVE is an INSTRUMENT close, not a finding about the change.** The change is
  unrefuted; its +180 numbers are a hand read and were never a gate verdict.
- **"stock 0.80 items/bot-h" was a per-version nominal line, not the program endpoint.**
- **`banktruth-01`'s "2,078 of 2,079 = 100.0%" is a tautology** (`admission.mjs:326`).
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f).
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`); the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED** — an operational breakage guard only.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone.**
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control.**
- **The sealed-cell retrieval-loss hypothesis is REFUTED at fleet scale** (−5.7% server ledger gap).
- **`owner-01b`'s own lines are UNRECONSTRUCTABLE** — false-trip rate **0/0, not 0%**.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md`** against
  `recovery-ladder-registration.md`. **Verified and RESYNCED 25 Sep 12:30Z** (md5s above). RULE.md is hashed
  into every read, so **do NOT edit it while a canary is live** — between canaries is the safe window.
- **A GATE CAN BE LIVE WITHOUT SPELLING ITS OWN NAME.** Two days running, a gate generation shipped
  unregistered. **Do not grep for "vNN" to decide what is live** — diff `~/verdict.py` against the last
  registered md5, and read what changed. This is queue-worthy as a hash interlock: `verdict.py` should
  refuse to run when its gate region's digest is not the one `RULES-IN-FORCE.md` records.
- **PUT `immobiledid` IN A REGISTRATION'S `reads` LIST** — `verdict.py` refuses the final read without it.
- **`deadline_min` ≥ `max(read_minutes)` + 30.** v30 now refuses at launch; do not rely on remembering it.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path** (now
  **67/67**), `test_verdict_acceptance_mutants.py` **OFF** the bots host (**26/26**), and
  `scripts/test_schedule_invariant.py` (16 cases + 5 mutants; set `CANARY_LOOP_PATH` on the host).
- **Nightly 00:12Z `~/programread.py 24`**; nightly 00:07Z iron-funnel.
- Tier-1 analyst every 30 min — **alive, newest `20260925T1200`**. `versions_ok=False` is the known
  build-suffix false-fail.
- `canarywatch.py` cron */10; `stuckwatch.py` cron :17/:47; `monitor.py` */10 on BOTH hosts.

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
Normal from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "^bash /home/mike/canary-loop\.sh"` **plus** the deadline. **The bracketed form in older notes
self-matches — see queue item 11.**

## Apparatus notes
- **`check-open-loop.py` is at `/opt/minecraft-ai/scripts/`, NOT `~/mcai-analysis/`.** Ledger:
  `/var/log/mcai/_canary-decisions.jsonl` (`MCAI_DECISIONS` overrides).
- **Registrations live in `~/mcai-analysis/registrations/<run_id>.json`**, with a `/tmp/registrations/`
  fallback only when `VERDICT_REG_DIR` is unset.
- **`fleet-deploy` finds the reader with `pgrep -f '^bash /home/mike/canary-loop.sh'`.** Launch the loop as
  `setsid bash /home/mike/canary-loop.sh <run_id> </dev/null > ~/canary-loop-<run_id>.out 2>&1 & disown`.
  Do not route around it with `READER_OK=1`.
- **AFTER EVERY DEPLOY OR PROMOTION, diff `/opt/minecraft-ai/scripts/lib/` against `~/mcai-analysis/lib/`
  AND CHECK WHICH WAY THE DIFFERENCE RUNS.** On 23 Sep `/opt` was ahead; **today `/opt` was two days
  BEHIND on three files.** Restore with `sudo cp` + `rm -rf __pycache__`, then prove it with a 30-min walk.
- **`Events.count_class` exists on the Events class, not in `lib/vocabulary.py`** — older re-arm text
  asserts it in the wrong place and reads as a failure.
- **Use `date -u`. Do not estimate elapsed time from the flow of the work.**
- **`/root/d.sh` is the deploy copy** (`sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh`) —
  the script `git reset`s the tree it lives in, so it must run from outside the repo.

## Telemetry row shape and walk discipline
- Rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), kind is
  `r['name']` (leading underscore for `logEvent` kinds), everything else under `r['raw']` —
  `raw.bot.tools` (the only place durability lives), `raw.bot.inventory`, `raw.bot.pos`,
  `raw.code.version`, `raw.skill.{status, fail_class, detail, args, duration_ms, inventory_delta}`.
  **A gather or deposit outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`.**
- **Full walks only**; `grep -a`; readers must include rotated `.gz` generations.
- **A wide walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME**, and never alongside a
  live canary read.

## Worktrees
mcai-banktruth (`deposit-truth-msg` 9a6aa13 — kept, unpromoted, undecided), mcai-deposit (`deposit-truth`
73acd47 — refused by both engines), mcai-shore (9b572aa), mcai-pickup (842e017), mcai-leafb (9fc3968),
mcai-anylog (7dd3775), mcai-digwatch (cfc1c58), mcai-falls (fc28885), mcai-owner (owner-01c 93f5b8f),
mcai-deathsites (b1659c0), **mcai-rl02 (`recovery-ladder-03` = docs/scripts branch)**, mcai-scene.
**The main repo checkout is on branch `veto-feedback`**, which does **NOT** contain the live sha —
**read live source with `git show efa2853:bots/src/<file>`, never the working tree.**

## Re-arm on a fresh session (monitors are session-local)
0. **VERIFY THE CANARY STATE YOURSELF — yesterday's file was wrong about it.** Four checks:
   `check-open-loop.py`; `canary_pool` in the manifest; the **anchored** pgrep; and a census. As of 12:35Z
   all four say **no canary, one version, 80 bots**.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|recorded|CRASH`,
   `tail -n 0 -F`. **Neither file is complete; `page.jsonl` ALONE IS NOT A HEARTBEAT.** Monitors here
   expire at 30 min — re-arm, or check by hand. **A Monitor that expired with 0 events today did so while
   the loop was working normally**, so silence is a prompt to run the anchored pgrep, not evidence.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT.** Confirm it is alive from `ls -t ~/digest/*.verdict.json`.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min — **only if the loop is alive.**
4. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the
   manifest, then tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
5. **AFTER ANY DEPLOY OR PROMOTION, CHECK THE ANALYSIS LIBRARY SURVIVED** — it did not today:
   `cd /opt/minecraft-ai && sudo python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18–19k rows / 80 bots. Then diff `lib/` against `~/mcai-analysis/lib/` **both ways**.
6. **CHECK HOST FILE MTIMES BEFORE TRUSTING THIS FILE'S APPARATUS SECTION.**
7. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER**, and stamp every measurement with its sha.
8. **CHECK WHETHER ANOTHER SESSION IS RUNNING** before editing shared files: `git log --oneline -5` and
   `git status` in `mcai-rl02`, and `sudo tail /var/log/auth.log` on .31 for commands you did not issue.
