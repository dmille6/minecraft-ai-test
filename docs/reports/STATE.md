# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-24 11:25 UTC — **NO LIVE CANARY. The loop is CLOSED and was already closed when this
session opened.** Fleet on **ONE version, `9b572aa+72e533`, 80 bots**, verified 11:19Z. Ledger **59**
decisions, unchanged. **The 24–27 Sep program read window is OPEN** (opened 00:00Z today). Today's work was
not a canary: it was closing a **registration gap in the decision path itself** — eight gate rules were live
in `verdict.py` and in no registration._

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If they disagree, take the later `_updated` stamp, not the documented order.**
> Today's report is in the REPO tree (branch `veto-feedback`): `status-report-2026-09-24.md`.

> **THIS FILE IS STRUCTURALLY STALE BY WHATEVER HAPPENS AFTER IT IS WRITTEN.** That is the rotation, not the
> author. **Read the JOURNAL and the LEDGER before trusting the canary section**, and check host file mtimes
> before trusting the apparatus section — that is how today's finding was made. Re-arm rule 4.

---

## ⚠ THE OWNER HAS NOW BEEN UN-NOTIFIED THREE DAYS RUNNING. THIS FILE IS THE ONLY CHANNEL.

A PushNotification was ATTEMPTED at 11:18Z and **did not reach** — "Mobile push not sent (Remote Control
inactive)", the same failure as 22 and 23 Sep. **Three consecutive days.** Everything under "OWNER CALLS"
below has never reached the owner by any channel except this file. **Raise it directly.**

## OWNER CALLS WAITING (none is mine to take)

1. **The v21 death-gate lower bound is declining reverts the audit calls CORRECT.** Backtested across all 15
   death-involved reverts, the live lower-bound gate trips on **0 of 15**. rl-08b's own lower bound is 0.58x,
   so the gate never even consults the new p. Its false-positive win was bought with real detection. This is
   a question about the **bound**, not about the p.
2. **The audit (`8019b1d`) finds 7 of 23 reverts CONFIRMED FALSE and 5 more suspect.** Roughly a third of
   this project's REVERT decisions may be wrong. That bears on the ledger's history, not only on future reads.
3. **`banktruth-01` (9a6aa13) — ship or drop?** The canary answered "no measurable effect", not "wrong". It
   is correct and unmeasurable at this size. Shipping a refusal that stopped lying, on truthfulness grounds
   alone, is an owner call. **Do NOT re-canary it at this size** — the floor is −0.885/bot-h against a
   −1.446 ceiling and it has now been measured, not guessed.
4. **Two commits are headed "OWNER DECISION 2026-09-24"** (`a75f169` v26, `7a7b5d1` v28) and **no artefact in
   the repo, in CLAUDE.md, or in memory records one.** They landed 23:00Z and 00:13Z — evening in the owner's
   timezone and entirely consistent with an owner-driven session. **Recorded as unverifiable from this
   session, NOT as unsanctioned.** v28 is registered prospectively either way, which is conservative whichever
   way it resolves. If the owner did not make that decision, v28 needs re-deciding before any canary uses it.

## TODAY'S FINDING: THE DECISION PATH RAN A WHOLE GENERATION AHEAD OF ITS REGISTRATION

Between **21:47Z 23 Sep and 00:48Z 24 Sep** a session implemented **eight** new gate rules in `~/verdict.py`
— v25, v26, v26b, v27, v27b, v28, v28b, v28c — taking it from 26 KB to 52 KB. **None was entered in
`recovery-ladder-registration.md`.** `RULE.md` — which is **hashed into every read as
`registration_sha256`** — and `RULES-IN-FORCE.md` were both still the 19 Sep versions naming **v24** as the
newest rule while the instrument ran **v28c**.

A commit message is not a registration. The registration is what makes a verdict defensible, and it is the
only thing that can make "amendments are prospective only" checkable.

**THE GAP COST NOTHING, AND THAT IS WHY TODAY'S ENTRY IS A REGISTRATION AND NOT A RESCUE.** The ledger's last
decision is `banktruth-01` at **18:18Z 23 Sep**; the first gate landed at **21:47Z**, three and a half hours
later. **No canary has ever been read by any of v25–v28c.** Registering them today makes all eight
**prospective**, the only form the standing rule allows. Had a canary been decided in between, the honest
close would have been to void that decision, not to back-date the rule.

**The work itself is excellent and is not being criticised** — it is the best-measured gate work in this
project (800 accepted pseudo-canary draws over a 6.6 M-row walk; every change mutant-pinned). The defect is
that it was not written down where a verdict can point at it.

- **Seven of eight act only against a REVERT or against a quiet KEEP** → registered retrospectively, which
  passes the standard `immobiledid` set.
- **v28 is the exception: it CREATES a path to revert that did not exist under v24** (a change's own alarm
  stopping its own canary). It is registered **PROSPECTIVELY, from the next canary registered after
  `a9e13e1`.** No amount of quality in the measurement changes that direction.
- **`CAL_MAX_AGE_H = 48` is registered explicitly AS A PLACEHOLDER**, so it can never later be quoted as a
  calibrated value.

Done today, all verified: registration block appended (`a9e13e1` on `recovery-ladder-03`);
`RULES-IN-FORCE.md` rewritten and synced to the host (md5 **`29ba5e26`** on both, was `c30f1b0b`);
`RULE.md` header corrected (it had named recovery-ladder-01 as live since **13 Sep**) and the block appended
(md5 `30a63a67` → **`395d8988`**). **Safe only because no canary was live** — the between-canaries window is
exactly when RULE.md may be touched.

### Queue items closed by this, with evidence
- **Item 12 (the death gate's invented control denominator, `canary_bot_h × 7`) is CLOSED.** The mutant
  "invented control denominator restored" is now **killed**: exposure is measured, never assumed. Measured on
  the live canary 23 Sep — 20 bots and 56.8 measured bot-h against the 30.8 the hardcoded ten implied, a
  death rate inflated **1.85x** toward a false REVERT.
- **Item 13 is CLOSED, both halves.** `canary-loop.sh:133` now captures stderr to
  `~/digest/verdict-err-$RUN-$M.log` **and** substitutes an explicit `CRASH (no verdict on stdout)` note when
  `$V` is empty, so a crashed read can no longer journal `""` and carry on. `depositread.py` reads
  `fail_class` and carries a **`NotAnInstrument` guard** that refuses when ≥50 deposit runs carry no
  `fail_class` at all. (STATE.md said both were unfixed; both were already fixed. **Check mtimes, not the
  state file.**)

### Suites, re-run green at 11:10–11:14Z before the registration was written
57/57 acceptance, **25/25 mutants (run OFF the bots host, per the standing rule)**, deathgate all pass,
linkage/license ALL PASS, membership 14/14, singledeath 11/11.

## THE NEXT CANARY IS POSED AND MEASURED: `storage_full` — THE BOT IS HOLDING A CHEST

Measured today, fleet-wide, **6 h / 80 bots / 480 bot-h / 227,862 rows, positive control printed**:

| deposit outcome | runs | share of 859 |
|---|---:|---:|
| `no_effect` | 485 | 56.5% |
| `failed/skill_error` | 141 | 16.4% |
| **`failed/storage_full`** | **94** | **10.9%** |
| `failed/container_open` | 69 | 8.0% |
| **`success`** | **60** | **7.0%** |

**`no_effect` is not a banking bug.** Its items are `apple` 240, `chest` 56, `wheat_seeds` 53, `dirt` 39,
`cooked_beef` 28, `oak_sapling` 24 — food, ballast and reserve, which `bankable.mjs` is **right** to refuse.
That is banktruth-01's finding confirmed at fleet scale: the outcome is correct and the model keeps asking.

**`storage_full` is where real stock is lost, and the remedy is already in the bot's hands:**
- **85 of 94 storage_full refusals (90.4%) — the bot is HOLDING at least one chest**, median **3** (distribution 3:19, 2:17, 4:15, 5:14, 7:10, 1:4).
- Bankable-ish items carried at the moment of refusal: median **55**.
- Successful deposits bank **22.1 items** each; observed stock **2.76 items/bot-h** (independently
  cross-checks the nightly `programread` fleet figure of **2.96**).

**Effect ceiling, stated as a ceiling and not a prediction:**
- conservative, bankable items only: 94 × 55 = 5,170 items = **+10.77 items/bot-h** (current stock 2.76)
- upper, whole carried stack (median 348): **+68 items/bot-h** — *an upper bound only; most of that stack is
  not bankable, and this number must not be quoted as an expected effect.*

Even the conservative figure is **~4x current stock** and is the largest lever found in this queue. It also
satisfies the refusal rule exactly — **a remedy the bot can perform from where it is**: it holds three
chests while being told storage is full. Make it **deterministic, not advisory** (262 printed-and-ignored
remedies are the precedent).

**NOT YET BUILT. Before it can deploy it needs:** sandbox mechanism proof, two Codex passes, **independent
Claude AND ChatGPT review**, and a registration with **`immobiledid` in `reads`**. Read it on **acquired
stock**, never on refusals avoided (`leaf-01`, `shoreline-01`).

## Fleet
- **80 bots / 16 Peaceful worlds. ONE version, `9b572aa+72e533`, verified on all 80 at 11:19Z.** Manifest
  `declared_at` **2026-09-23T18:23:13Z** — the start of the single-version run the program read needs.
- Ledger **59** decisions, **unchanged today**; newest still `banktruth-01` INCONCLUSIVE 23 Sep 18:19Z.
  `main` = **9b572aa**. `origin/main-pre-2026-09-22b` = 842e017 kept.
- 2 h digest (11:00Z): items/bot-h 24.7, decisions/bot-h 42.7, deaths 3 (0.019/bot-h).
- **4 of 80 immobile**: hive-b-Comet (462,1,30), isolated-d-Alpha, isolated-d-Echo, placebo-a-Echo. Ops
  alarm, and also the program's immobile line, which fails.
- **keepInventory=true / doImmediateRespawn=true on every world.** Stays ON through the window; OFF
  fleet-wide after 27 Sep as its own registered program change, never a canary.

## THE 24–27 SEP PROGRAM READ — OPEN, opened 00:00Z today, closes 27 Sep. `programread.py 72` at close.
- **Rule 1: canaries MAY run inside the window** (10–20 of 80, read as DiD); **fleet-wide promotions MAY NOT.**
  If a promotion is unavoidable the window restarts. Rule 3: `keepInventory` stays ON. Rule 5: the read is
  the **72-h aggregate**, not the best 24 h inside it.
- **CORRECTION TO YESTERDAY'S FILE — DO NOT RE-QUOTE "stock 0.80 items/bot-h".** That was a
  **`[7dd3775 nominal]` per-version line**, and `programread.py` prints on those lines that they are
  **NOT comparable** (no DiD, no exposure cut) — and 7dd3775 was not even live. **The program endpoint is the
  `[fleet]` line.** Nightly fleet series: **6.00 → 5.88 → 3.95 → 2.95 → 2.96** items/bot-h. Today's
  independent 6 h read gives **2.76**, which agrees.
- **Standing on the five committed targets** (fleet line, 00:12Z run): deaths 0.0229/bot-h **pass** (≤0.05);
  iron-pick share 15.2% **pass**; immobile 5.0% **FAIL** (≤2%); gather 20.2% **FAIL** (≥40%); stock **2.96
  FAIL by 6.8x** (≥20). **Two of five**, as forecast after stock resolved.
- **Stock has halved over five nightly reads with no code change** (6.00 → 2.96). Consistent with the known
  ±77% six-hour world drift; **do not read it as a regression**, and do not credit any fix with reversing it.
  This is exactly why the program read is a 72-h aggregate.

## Queue
1. **`storage_full` / place-a-chest — THE NEXT CANARY, posed and measured above.** Needs sandbox proof, two
   Codex passes, dual review, `immobiledid` in `reads`. Read on **acquired stock**.
2. **`banktruth-01` (9a6aa13) unpromoted** — owner call 3 above. Do NOT re-canary at this size.
3. **`skill_error` 141/859 = 16.4%** — the second banking bucket, uncharacterised. Nobody has looked at what
   throws. Cheap next read.
4. **falls-02 — HELD until after 27 Sep.** Worktree `mcai-falls` (fc28885). The falls-01 re-read (`76b8c6f`)
   finds the revert **rule-compliant and wrong**, observability-only over the whole b1659c0..fc28885 stack
   (mutant-proven 4/4), and the merge **clean** (merge-tree exit 0, 198/198). Restoration is queued, not done.
5. **NAVIGATION / GATHER.** `unreachable` is the largest gather-fail bucket — **8,602** in the 24 h fleet read
   (vs no_safe_target 7,778, no_path 6,979) — with no `veto_faces`-grade instrument pointed at it.
6. **The drifting-drop pickup.** `pickupNearbyItems` (`skills.mjs:1240`) snapshots the drop position once.
   `pickup-sweep` fixed a DIFFERENT bug. **Bounded small** by the server-ledger retrieval gap being NEGATIVE.
7. **owner-01c** — third attempt. Pre-flight landmine unchanged: `index.mjs:259` calls
   `runner.arb.installActuatorGate(...)` guarded only by `runner?.arb`, and that method does not exist
   outside `movement-owner-1`. Assert it exists and `bot.dig.__arbiterGated` is true before declaring.
   **ARBITER authorised for owner-01c only.** Note v28c now **refuses owner-01b's own lines** as
   unreconstructable (0/0, not 0%) — do not register them as deciding.
8. **Land the analysis library on the bots line** so deployed shas carry it. Costs a fleet-wide deploy →
   **after 27 Sep**.
9. **`keepInventory` OFF — after 27 Sep**, a registered program change, never a canary.
10. **Extend `drawexposure.py`** — non-degenerate pre-period. REPORT-only until calibrated.
11. **Teach the analyst the two-part OpenLoop test.** **TRAP: `pgrep -f canary-loop` SELF-MATCHES** — use
    `pgrep -af "canary-loop[.]sh"`.
12. **Measure `CAL_MAX_AGE_H`** on two non-overlapping periods and replace the 48 h placeholder
    (`VERDICT_CAL_MAX_AGE_H` overrides it meanwhile).
13. **17 existing WATCH lines: leave them.** The backtest says promoting them adds **2 new false reverts and
    corrects none**; 7 of 17 are dead instruments reading 0 or None in every read of every run.

## Rules in force (docs/reports/recovery-ladder-registration.md — now current through v28c)
**v28c** (a deciding calibrated own-line must be `form: did`; a canary-only LEVEL may NEVER revert),
**v28b** (a calibration must report `nonzero_draws`; <10% is DEGENERATE and refused), **v28** (a change's own
alarm may revert **only** with `evidence: calibrated` — `at_threshold` equal to the registered value,
`false_trip_rate` ≤ 0.05, `over_reads: true`, `measured_at` within `CAL_MAX_AGE_H`, `tool`/`draws` named,
`nonzero_draws` ≥ 10%, `form: did`; any unmet **blocks KEEP as INCONCLUSIVE, never REVERT**; **AT MOST ONE**
such deciding line per canary, because 9 reads × 5% is 37%) — **PROSPECTIVE from `a9e13e1`**,
**v27b** (linkage window calibrated at **60 s**; the canary's own emission rate REPORTED, not enforced),
v27 (the verdict SAYS when linkage was unavailable), **v26b** (the death-gate randomization p is
**REPORT-ONLY**; `p_vetoes=True` required), v26 (that p is ranked on the canary death **RATE**, permuted at
the unit of ASSIGNMENT from `canary_split`), **v25** (a typed threshold is NOT evidence; a deciding own-line
needs `evidence: 'defect'` or a present `support` p ≤ max, else the line FAILS and the verdict is
INCONCLUSIVE — never a fall-through to KEEP), **v24**, **v23**, v22 WITHDRAWN unregistered, v12 linkage,
v14c, v15c, v16, v17/v18, v19, **v21** (see owner call 1), the owner's floor of **two** canary deaths, draws
at deploy, `fleet-deploy` refuses a `--pool` sha not descending from `declared_code_version`, `CANARY_ENV` +
the `/proc/<pid>/environ` assertion, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS.** Null sd of the pool-mean ratio-DiD on items/bot-h is 0.313 at
  k=20/3 h vs 0.608 at k=5/3 h. `drawrec.sh` degrades 4 → 3 → 2 and says which.
  **CLAUDE.md still says "randomize five bots"; this is the registered change to it.**
- **`~/digest/RULES-IN-FORCE.md` is AUTHORITATIVE and now matches `scripts/host/RULES-IN-FORCE.md` by md5
  (`29ba5e26…`), rewritten today.** `RULE.md`'s header is **also correct now** (it had been stale since
  13 Sep). `analyst.py` reads RULES-IN-FORCE.md plus RULE.md from `## v14c` onward.

## RETRACTIONS still in force
- **"stock 0.80 items/bot-h" was a per-version nominal line, not the program endpoint.** New today. The
  fleet line is 2.96. Per-version lines in `programread.py` print their own "NOT comparable" warning — heed it.
- **`banktruth-01`'s "2,078 of 2,079 = 100.0%" is a tautology** — `admission.mjs:326` refuses a named deposit
  whenever the bot holds none, BEFORE the skill runs, so every named refusal reaching the skill holds the
  item **by construction**.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f).
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`). UNADJUSTED covariate; the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED.** An operational breakage guard only.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed −0.650 against a −0.5 gate.
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control.**
- **The sealed-cell retrieval-loss hypothesis is REFUTED at fleet scale** — the server's own ledger gives
  257,378 logs mined vs 272,021 picked up, gap **−5.7%**.
- **`owner-01b`'s own lines are UNRECONSTRUCTABLE** — `arbiter_actuator_refused` is logged only under
  `config.reflex.arbiter`, which no env file sets: 10,870 rows in its own three hours against **0** in the
  other 11,406,760. Their false-trip rate is **0/0, not 0%**.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md`** against
  `recovery-ladder-registration.md`. **Verified and RESYNCED 24 Sep 11:16Z.** RULE.md is hashed into every
  read as `registration_sha256`, so **do NOT edit it while a canary is live.**
- **PUT `immobiledid` IN A REGISTRATION'S `reads` LIST.** It is the safety floor for every canary on this
  fleet — death gate, v15c guards, readability — and `verdict.py` refuses the final read without it.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` **OFF** the bots host.
- **Nightly 00:12Z `~/programread.py 24` → `~/digest/programread.log`**; nightly 00:07Z iron-funnel.
  Last iron line: 16 raw iron / 16 ingots / 2 picks crafted, 3 gone, share 15.2%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`) — **alive, newest 20260924T1100**; tier-0
  digest `~/digest/latest.md`. `versions_ok=False` is the known build-suffix false-fail, not an alarm.
- `canarywatch.py` cron */10; `stuckwatch.py` cron :17/:47. `monitor.py` cron */10 on BOTH hosts.
- **Keep promotions and world changes out of the 24–27 Sep window.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "canary-loop[.]sh"` **plus** the deadline.

## Apparatus notes
- **`check-open-loop.py` is at `/opt/minecraft-ai/scripts/`, NOT `~/mcai-analysis/`.** Yesterday's re-arm
  text implies otherwise and the wrong path fails with ENOENT, which reads like "no canary".
- **`fleet-deploy` finds the reader with `pgrep -f '^bash /home/mike/canary-loop.sh'`.** A copy at any other
  path **fails the reader check and the deploy is REFUSED**. Launch it as:
  `setsid bash /home/mike/canary-loop.sh <run_id> </dev/null > ~/canary-loop-<run_id>.out 2>&1 & disown`
  Do not route around it with `READER_OK=1`.
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`.
- **Before patching anything under `/opt/.../lib`, diff it against `~/mcai-analysis/lib/` FIRST** and check
  **which way** the difference runs. On 23 Sep it was `/opt` that was ahead.
- **Use `date -u`. Do not estimate elapsed time from the flow of the work.** I stamped the registration
  11:4xZ and RULE.md 11:55Z when the clock said 11:19Z, and had to correct both — the same error this file
  recorded yesterday.

## Telemetry row shape and walk discipline
- Rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), the event
  kind is `r['name']` (leading underscore for `logEvent` kinds), everything else under `r['raw']` —
  `raw.bot.tools` (the only place durability lives), `raw.bot.inventory`, `raw.bot.pos`, `raw.code.version`,
  `raw.skill.{status, fail_class, detail, args, duration_ms, inventory_delta}`.
  **A gather or deposit outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`.**
- **Full walks only**; `grep -a`; readers must include rotated `.gz` generations.
- **A single 97.5 h walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME.**

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or
  revert and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599-25602 only). Swimming is travel. No 192.168.19x
  network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One code canary at a
  time (a bundle of two **disjoint** changes counts as one). **Teardown is THREE steps plus killing the
  detached readers and clearing `~/MANUAL-READS-UNTIL`.** Deploy only via `~/bin/fleet-deploy`. Commit with
  `git commit -F -` heredocs — **and use a QUOTED heredoc over SSH too.** Two Codex passes per patch, then a
  smaller patch. Never share a live canary's inference endpoint/model; ARBITER OFF as the fleet default
  (authorised for owner-01c only). Never `git add -A bots` in a worktree with a node_modules symlink.
  Lab SSH `mike@10.0.0.31` (bots) / `mike@10.0.0.30` (worlds); key `~/.ssh/id_ed25519`.
- Independent Claude **and** ChatGPT review, plus a real search of open source, before proposing to build —
  scoped to design changes, new research claims and deploy-impacting conclusions.

## Worktrees
mcai-banktruth (`deposit-truth-msg` 9a6aa13 — **kept, unpromoted, undecided**), mcai-deposit
(`deposit-truth` 73acd47 — the LARGER deposit patch, refused by both engines;
`docs/reports/deposit-truth-review-pass-2.md` lives there and nowhere else), mcai-shore (9b572aa = now main),
mcai-pickup (842e017), mcai-leafb (9fc3968), mcai-anylog (7dd3775), mcai-digwatch (cfc1c58),
mcai-falls (fc28885 — falls-02, restoration queued), mcai-owner (owner-01c 93f5b8f), mcai-deathsites
(b1659c0), **mcai-rl02 (`recovery-ladder-03` = docs/scripts branch)**, mcai-scene (sandbox harness).
**The main repo checkout is on branch `veto-feedback`**, which does **NOT** contain the live sha —
**read live source with `git show 9b572aa:bots/src/<file>`, never the working tree.**
Scripts: `~/mcai-analysis` on this Mac and on .31; on .31 also `lib/` — the golden analysis library.

## Re-arm on a fresh session (monitors are session-local)
0. **NO CANARY IS LIVE** as of 11:19Z: `check-open-loop.py` says "no open canary"; `canary_pool` is empty;
   anchored `pgrep -af "canary-loop[.]sh"` returns nothing; census is one version on 80 bots. **Verify all
   four yourself** — it is the sentence most likely to be stale.
   **The program window is open: no fleet-wide promotion until 27 Sep 00:00Z.**
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|recorded`, new lines only
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT.** Neither file is complete. Treat silence as a
   reason to run the anchored pgrep. **Monitors expire in ~5 minutes here regardless of the timeout asked
   for — re-arm, or check by hand.** With no canary live this is optional; with one live it is not.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT.** Confirm it is alive from `ls -t ~/digest/*.verdict.json`.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT — **only if the
   loop is alive.** Verify with the anchored pgrep.
4. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest,
   then tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
5. **After any deploy OR PROMOTION, check the analysis library survived** — note the CWD:
   `cd /opt/minecraft-ai && python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18-19k rows / 80 bots over 30 min. Also assert `vocabulary.py` is present and `count_class` exists.
6. **CHECK HOST FILE MTIMES BEFORE TRUSTING THIS FILE'S APPARATUS SECTION.** Today's whole finding came from
   `ls -l --time-style=full-iso ~/verdict.py ~/canary-loop.sh`, which showed 05:48Z and 22:16Z edits this
   file knew nothing about. Two queue items were already fixed and one rule generation had gone unregistered.
7. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER.** Stamp every measurement with the sha it was
   taken on, as this file's readings are.
