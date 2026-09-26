# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-26 12:20 UTC — **NO LIVE CANARY.** Fleet on **`efa2853+c7b045`, ONE version, 80 bots**
(881,375 rows / 80 bots over the 24 h to 12:11Z). Ledger **65**. Two canaries closed overnight by the host
loop, both **KEEP, both unpromoted**, both torn down. Today's work: **the third consecutive unregistered gate
generation, registered — and turned into a mechanism so there cannot be a fourth.** `licencecheck.py`'s
launch refusal **did not exist** (never wired); it does now._

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If they disagree, take the later `_updated` stamp, not the documented order.**

> **THIS FILE IS STRUCTURALLY STALE BY WHATEVER HAPPENS AFTER IT IS WRITTEN.** Yesterday's copy said "NO LIVE
> CANARY" and **two** canaries then ran overnight (`falls-02` 00:25Z, `vetob2-01` 06:02Z), neither of them in
> it. **Read the JOURNAL, the LEDGER and the MANIFEST before trusting the canary section.** Re-arm rules 0
> and 4.

> **AND IT IS NOW STALE ABOUT THE GATE BY CONSTRUCTION — THAT IS FIXED.** Three days running this file
> recorded a `verdict.py` md5 that was no longer live. **Do not compare md5s by hand any more:**
> `python3 ~/mcai-analysis/gatedigest.py` answers it, and a canary cannot launch while it disagrees.

---

## ⚠ THE OWNER HAS NOW BEEN UN-NOTIFIED **FIVE** DAYS RUNNING. THIS FILE IS THE ONLY CHANNEL.
PushNotification attempted again today — same "Remote Control inactive" failure as 22–25 Sep. Everything
under OWNER CALLS has reached the owner by no channel but this file.

## OWNER CALLS WAITING
0. **THREE KEPT CANARIES SIT UNPROMOTED, AND NOTHING SAYS WHETHER THAT IS THE INTENT.** `falls-02`
   (`37a68c3`, KEEP 03:31Z today), `vetob2-01` (`efabf13`, KEEP 09:08Z today), `banktruth-01` (`9a6aa13`).
   All three registered `promotion: none`, so the loop recorded KEEP and restored the baseline — **correct
   behaviour, not a bug.** But the fleet now carries none of three changes that passed their gates, and
   `main` tracks the fleet. **Say whether `promotion: none` means "measure then decide" (and decide these
   three) or "never promote".** This is the single largest thing blocking the endpoint from moving.
1. **The 24–27 Sep program window.** Ended early by the 25 Sep 11:57Z fleet-wide promotion of `efa2853`.
   Rule 1 said the window restarts if that happens. **Restart from 25 Sep, or abandon?** (unchanged)
2. **The v21 death-gate lower bound** is declining reverts the audit calls CORRECT — trips on 0 of 15
   death-involved reverts. A question about the **bound**, not the p. (unchanged)
3. **The audit (`8019b1d`) finds 7 of 23 reverts CONFIRMED FALSE and 5 more suspect.** (unchanged)
4. **Commits headed "OWNER DECISION"** with no artefact recording one — three instances over 24–25 Sep,
   recorded as unverifiable from the operator seat, **not** as unsanctioned. Worth settling. (unchanged)

---

## WHAT HAPPENED OVERNIGHT (the host loop, unattended — read it, do not re-derive it)
| run | sha | pools | verdict | at | note |
|---|---|---|---|---|---|
| `falls-02` | `37a68c3` | hive-d, placebo-d, board-c, placebo-b (4 pools / 20 bots) | **KEEP** | 03:31Z | exposure 106 fall rows (min 8); deaths 1 canary / 2 control, both 0.017/bh. **One death is named, not a verdict** (owner's two-death floor). Torn down 03:37Z. |
| `vetob2-01` | `efabf13` | hive-c, hive-a (**degraded TWO-pool draw, 10 bots**) | **KEEP** | 09:08Z | exposure 1,198 `veto_feedback` rows (min 150); deaths 0 canary / 2 control. Torn down 09:12Z. |

Both closed through `check-open-loop.py --record` before the manifest was cleared, both `promotion: none`.
**The gate KEEP does not test the effect** — `primary` is in `_ADVISORY`, so KEEP means "nothing objected".
`vetob2-01`'s effect read INCONCLUSIVE by hand (63% of the primary is a channel B2 cannot touch, and ~80% of
the raw veto DiD was the deploy clearing the gate's own state). Both reports are committed under
`docs/reports/`.

**Verified independently this morning, all four checks:** `check-open-loop.py` says "no open canary — clear
to start something new"; `canary_pool` and `canary_code_version` are `null`; the anchored
`pgrep -af "^bash /home/mike/canary-loop\.sh"` finds nothing; census 881,375 rows / 80 bots / ONE version.

---

## TODAY'S FINDINGS

### 1. A THIRD CONSECUTIVE GATE GENERATION WAS LIVE AND UNREGISTERED — and it is now mechanically impossible
`~/verdict.py` md5 `e9a81408` against the `6dda048d` this file recorded as registered. `b01b1e7` added the
v31 licence-class gate at **2026-09-25 15:21Z — four hours after v29/v30 were registered for exactly this
reason.** The pattern: v25–v28c (retrospective), v29 (`faf7cf7`, 23 h after its own lesson was written),
v31. Each found only by a human remembering to compare md5s.

**It decided nothing in the 20 h it was unregistered** (positive control included): `falls-02` and
`vetob2-01` both ran under it, both declared a `licence`, and `licence` sits in both reads' NOT-evaluated
list beside `mechanism_check` and `null_calibration`. **Registered prospectively today as v31.**

**v32 is the mechanism.** `RULES-IN-FORCE.md` now carries exactly one column-0 line
`GATE DIGEST verdict-bundle md5 …`; `gatedigest.py` **refuses a launch** when the live bundle disagrees, and
`verdict.py` annotates a mismatch / an absent record / two records on **every read, report-only**. Verified
live on .31: exit 0 against the real gate, **exit 2 with a named remedy on a wrong record and on no record.**

### 2. `licencecheck.py`'s LAUNCH REFUSAL DID NOT EXIST
Its docstring says it refuses "before the draw and before three hours of fleet time". **`canary-loop.sh`
never invoked it.** Positive control in the same grep: the loop called `changerowcheck.py` (line 22) and
`v30check.py` (line 52). **2 of 20 registrations on file declare a `licence` at all.** That is the defect
class CLAUDE.md opens with — a remedy printed and not reachable, like the 262 printed-and-ignored remedies.
**Wired today**, and `scripts/test_launch_guards.py` asserts the wiring in *executable* text.

### 3. A LATENT FALSE-REVERT ROUTE IN THE LOOP, FOUND AND CLOSED
The **death-poll** arm matched `case "$V" in *REVERT*)` on the **whole verdict line** and set `FINAL=REVERT`
from the substring, while the scheduled-read arm has always taken `awk '{print $2}'`. **Measured: 8 of 42
`why.append` sites in `verdict.py` carry the literal "REVERT"**; six are on the same statement as
`out('REVERT')`, and v28's *"MORE THAN ONE calibrated REVERT line"* and v25's *"does not license a REVERT"*
print it while the verdict is INCONCLUSIVE — **both past the poll's `out('POLL_OK')` exit, so the route was
LATENT, not live.** The v32 advisory *is* reachable under `--poll`, which is why it was closed rather than
documented. The poll arm now reads the field, and **`out()` flattens every reason to one line** — the loop
takes `tail -1` then `awk '{print $2}'` with no check that the line is a verdict at all.

### 4. QUEUE ITEM 2 IS NOT A BANKING BUCKET — and it makes item 1 BIGGER
`skill_error` is **819 of 4,160 deposit rows (19.7%) in 24 h on 65 of 80 bots**, and it is **entirely
pathfinding**: `No path to the goal!` 420 (51.3%), `Took to long to decide path to goal!` 205 (25.0%),
`The goal was changed before it could be completed!` 192 (23.4%), PathStopped 2. Nothing in it is deposit
logic. The third group is the interrupt tax, not navigation.

**Then the important part.** Every one of those buckets is full of bots **already carrying a chest**:

| bucket | n | holding a chest | median chest |
|---|---|---|---|
| `no_path` | 419 | **269 (64.2%)** | 5 |
| `path_timeout` | 205 | **179 (87.3%)** | 3 |
| `goal_changed` | 193 | **176 (91.2%)** | 4 |
| `storage_full` | 328 | **283 (86.3%)** | 4 |

**907 deposit failures in 24 h where the bot held a chest it could have placed**, against the **283** that
`storage_full` alone accounts for — **a 3.2x larger addressable population than queue item 1 scopes.** The
remedy is the same one in all four and it is executable from where the bot stands, which is the test
CLAUDE.md sets. *Denominator: 4,160 deposit rows / 80 bots / 24 h to 12:11Z on `efa2853+c7b045`.*
**DO NOT quote a new items/bot-h ceiling from this read.** The "median bankable carried ~300" figure it also
produced uses a LOOSER definition of bankable (all inventory but chest/crafting_table/torch) than the 55 in
queue item 1, so it is an upper bound and **not comparable**. The **count** is the robust finding.

## Fleet
- **80 bots / 16 Peaceful worlds. ONE version `efa2853+c7b045`.** Manifest `run_id vetob2-01`,
  `declared_code_version efa2853`, `declared_at 2026-09-26T06:02:47Z`, `canary_pool` and
  `canary_code_version` **null**.
- **The analysis library SURVIVED today's two deploys** — `/opt/minecraft-ai/scripts/lib/` is byte-identical
  to `~/mcai-analysis/lib/` on all four files (telemetry 27,459B, openloop 8,237B, version_split 14,338B,
  vocabulary 7,007B). **That is because the overnight deploys went through `~/bin/fleet-deploy`, which
  restores it; 25 Sep's `/root/d.sh` route did not.** Queue item 16 stands.
- Nightly 00:12Z program read (pre-dating today's two decisions, so it says ledger 63): **stock 2 items net
  = 0.01/bot-h against a 2wk gate of ≥20** — a tiny window, do not read a trend into it; gather fails
  unreachable 56 / no_safe_target 44 / no_path 39. Throughput 14 d: 41 decisions = 2.93/day, of which 29
  results (KEEP 11, REVERT 18); last 7 d 1.57/day, 1.00 results/day.
- Iron funnel 24 h / 1,438 bot-h: raw iron **3 (0.00/bot-h)**, 2 ingots, 0 pickaxes crafted, iron-pickaxe
  bot-hour share 15.0%. The wall is depth — 0.37% of 2,401 attempts, 84.7% tried at y≥48.
- **FIVE `*-Charlie` units are `failed` and it is BENIGN and now WORSE BY ONE:** `board-b`, `hive-a`,
  `hive-b`, `placebo-a`, **`placebo-b`** (was four yesterday). No env file, never started; 84 unit instances
  for 80 bots. Teardown's restart-everything loop wakes them. **Delete them** (queue 4).
- **keepInventory=true / doImmediateRespawn=true on every world.**

## Queue
1. **`storage_full` / place-a-chest — the largest lever, and TODAY'S FINDING 4 WIDENS IT 3.2x.** Scope it to
   **all four chest-holding deposit-failure buckets**, not just `storage_full`: 907 events/24 h. Needs
   sandbox proof, two Codex passes, **dual Claude+ChatGPT review**, `immobiledid` in `reads`,
   `deadline_min ≥ last read + 30` (v30 refuses otherwise), **a `licence` with a class (v31 now refuses
   without one)**, and the **`GATE DIGEST` line updated in the same commit if the gate is touched (v32)**.
   Read on **acquired stock**, never on refusals avoided. Make the remedy **deterministic, not advisory**.
2. ~~Characterise `skill_error`~~ **CLOSED by finding 4. It is pathfinding + the interrupt tax, and it
   belongs to items 1 and 7, not to banking.**
3. **`container_open` 446 of 4,160 (10.7%) is UNCHARACTERISED** and is the one named deposit bucket nobody
   has read. Cheap. Replaces the closed item 2.
4. **Delete the 5 orphan `*-Charlie` unit instances.**
5. **Consolidate the TWO schedule guards in `verdict.py`** (mine `schedule_violation`, pure/report-only with
   the 30-min grace; the other returns UNREADABLE at the first read). Both live, both tested, one invariant.
6. **`scripts/canary-loop.sh` (md5 `c3227ceb`) IS A STALE SECOND COPY** of `scripts/host/canary-loop.sh`
   (`0a01b3c1`, byte-identical to the host). `scripts/test_loop_teardown.sh` and the registration document
   reference the stale one. **Two copies of the loop is the 2026-09-18 two-copies-of-`verdict.py` failure
   waiting to repeat.** Delete or symlink it.
7. **NAVIGATION / GATHER.** `unreachable` is the largest gather-fail bucket (**8,911** in a 24 h read vs
   no_safe_target 7,963, no_path 7,658) with no `veto_faces`-grade instrument. **Finding 4 adds 624
   deposit-side pathfinder failures to the same account.**
8. **Land the analysis library on the bots line so deployed shas carry it.**
9. **`keepInventory` OFF** — a registered program change, never a canary. Re-time with owner call 1.
10. **Extend `drawexposure.py`** — non-degenerate pre-period. REPORT-only until calibrated.
11. **Teach the analyst the two-part OpenLoop test.** Use the **anchored**
    `pgrep -af "^bash /home/mike/canary-loop\.sh"`; **the bracketed form `canary-loop[.]sh` SELF-MATCHES.**
12. **17 existing WATCH lines: leave them.** Promoting them adds 2 false reverts and corrects none.
13. **`MEMORY.md` is 249 lines against a ~200 line load limit, so the tail is SILENTLY NEVER READ** — it now
    truncates at line 201. Run the `consolidate-memory` pass: the index needs **shrinking**, not more lines.
14. **The `WalkTooWide` message names a remedy that cannot be performed** ("narrow the window with
    `since_minutes=`" when the estimate is window-independent). The golden `predates_window()` is the fix.
15. **`deploy-fleet.sh` run directly as `/root/d.sh` SKIPS `fleet-deploy`'s golden-lib restore**, and
    CLAUDE.md points at that route while this file says `fleet-deploy` only. Reconcile.
16. **`~/digest/RULE.md` has NO tracked source of truth and is 103 KB of hand-maintained duplicate.** It is
    0.58-similar to the registration document and carries 139 lines found nowhere else, so it cannot be
    regenerated — and today it was destroyed by one careless `cat >>`. It is now tracked at
    `scripts/host/RULE.md`. **Either make the analyst read the registration document directly, or make
    RULE.md generated from it with its unique sections moved in.** Until then: `.bak` before every edit.

## Rules in force (docs/reports/recovery-ladder-registration.md — current through **v32**)
**v32** (THE LIVE GATE CODE MUST BE THE REGISTERED GATE CODE: one column-0 `GATE DIGEST verdict-bundle md5`
line in `RULES-IN-FORCE.md`; `gatedigest.py` refuses a launch on a mismatch, an absent record, two different
records, or an UNRESOLVED part; `verdict.py` annotates on every read, report-only. A **bundle** —
`verdict.py` + `deathgate.py` + `singledeath.py` + `arms.py`, resolved via `sys.modules` — because the
mutant runner flips a verdict by editing `deathgate.py` alone) — **PROSPECTIVE from 2026-09-26**,
**v31** (a canary must NAME its instrument and its CLASS: `kind` / `text` / `rate`, and `rate` is
REPORT-ONLY BY CONSTRUCTION; `licencecheck.py` refuses at launch — **wired 2026-09-26**) —
**PROSPECTIVE from 2026-09-26**, **v30**, **v29**, **v28c**, **v28b**, **v28**, **v27b**, v27, **v26b**,
v26, **v25**, **v24**, **v23**, v22 WITHDRAWN unregistered, v12 linkage, v14c, v15c, v16, v17/v18, v19,
**v21** (owner call 2), the owner's floor of **two** canary deaths, draws at deploy, `fleet-deploy` refuses
a `--pool` sha not descending from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ`
assertion, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS**; `drawrec.sh` degrades 4 → 3 → 2 and says which. **`vetob2-01` ran on
  a degraded TWO-pool draw (10 bots)** — record the draw shape with every read. **CLAUDE.md still says
  "randomize five bots"; the registered change supersedes it.**
- **THE REGISTERED GATE, 2026-09-26: bundle md5 `863a725917e4c32ac9b37a2fff37c5fc`** —
  `arms.py 9d563283`, `deathgate.py 450d32bf`, `singledeath.py 08bd12cd`, `verdict.py b3179121`.
  **IDENTICAL on 10.0.0.31 and in the repo, all four files.** Read it with `python3 ~/verdict.py
  --gate-digest`; check it with `python3 ~/mcai-analysis/gatedigest.py`.
- **`~/digest/RULES-IN-FORCE.md` is AUTHORITATIVE**, rewritten and synced today: md5 **`96b7be11`** on both
  host and `scripts/host/RULES-IN-FORCE.md`. **It was correct throughout today and is the half the analyst
  treats as authoritative.**
- **`~/digest/RULE.md` md5 `746c65e4`** (was `a38827a9`), and **RULE.md is now TRACKED at
  `scripts/host/RULE.md`**, which it was not before — that is what caused the incident below.
  **I DESTROYED `~/digest/RULE.md` AND RESTORED IT. Read this before touching either rule file.**
  `cat >> scripts/host/RULE.md` created a NEW 1,847-byte repo file (RULE.md was untracked, so there was
  nothing to append to), and the scp then overwrote the host's real 103 KB file with that fragment.
  **`## v14c` was gone, so `analyst.py`'s slice fell back to the whole 1.8 KB file and the analyst read
  v31/v32 as the entire rule tail.** The tell was `prompt_tokens` **8034 → 3631** on the 12:30 run — a
  DROP after I had made both rule files longer, which is the wrong direction and is why it was caught.
  **Blast radius: ONE analyst run (12:30Z), which still returned `fleet_healthy=True`, `versions_ok=True`
  with no canary live, so no decision rested on it.** Restored 12:27Z from
  `~/digest/RULE.md.bak-20260925T1225Z` (md5 `395d8988`, the pre-25-Sep file) plus re-appended v29–v32.
  **v29 and v30 are RECONSTRUCTED and say so in the text** — the 25 Sep append's exact wording is
  unrecoverable; the authoritative text is the registration document, and `RULES-IN-FORCE.md` carries the
  one-paragraph form. Broken file kept at `~/digest/RULE.md.BROKEN-20260926T1225Z`.
  **Two lessons. (1) The previous session took a timestamped `.bak` before editing this file and I did not
  — that backup is the only reason this was recoverable. Take one.** (2) RULE.md is NOT a slice of the
  registration document: similarity is 0.58 and it carries 139 lines of its own (a `PRE-REGISTERED v8`
  section, v6 shape notes), so it cannot be regenerated from the registration doc. Queue item 17.
- **`~/verdict.py` and `scripts/verdict.py` are byte-identical: md5 `b3179121`.** v32 now enforces this by
  construction, so it is no longer a thing to remember.

## RETRACTIONS still in force
- **`drop5-01`'s INCONCLUSIVE is an INSTRUMENT close, not a finding about the change.**
- **"stock 0.80 items/bot-h" was a per-version nominal line, not the program endpoint.**
- **`banktruth-01`'s "2,078 of 2,079 = 100.0%" is a tautology** (`admission.mjs:326`).
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f).
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`); the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED** — an operational breakage guard only.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone.**
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control.**
- **The sealed-cell retrieval-loss hypothesis is REFUTED at fleet scale** (−5.7% server ledger gap).
- **`owner-01b`'s own lines are UNRECONSTRUCTABLE** — false-trip rate **0/0, not 0%**.
- **`vetob2-01`'s KEEP is a GATE keep, not an effect.** `primary` is `_ADVISORY`; the effect is INCONCLUSIVE.
- **NEW: the deposit "median bankable carried ~300" is an UPPER BOUND on a looser definition** than queue
  item 1's 55, and the two must not be compared.

## Standing wake-ups
- **THE GATE DIGEST IS NOW THE ANSWER TO "IS THIS THE REGISTERED GATE".** Do not grep for `vNN` — the v29
  gate never spelled its own name, and three generations hid that way. Run `gatedigest.py`.
  **If you change `verdict.py`, `deathgate.py`, `singledeath.py` or `arms.py`, update the `GATE DIGEST` line
  and register the generation IN THE SAME COMMIT**, or the next canary cannot launch.
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md`** against
  `recovery-ladder-registration.md`. **Resynced 26 Sep 12:15Z** (md5s above). RULE.md is hashed into every
  read, so **do NOT edit it while a canary is live** — between canaries is the safe window.
- **PUT `immobiledid` IN A REGISTRATION'S `reads` LIST** — `verdict.py` refuses the final read without it.
- **`deadline_min` ≥ `max(read_minutes)` + 30.** v30 refuses at launch.
- **A REGISTRATION NEEDS A `licence` WITH A CLASS.** v31 now refuses at launch; 18 of 20 on file have none.
- **`licencecheck.py`'s BASELINE WINDOW IS 6 h AND INCLUDES A JUST-FINISHED CANARY'S OWN ROWS.** Verified
  12:24Z by running the loop's exact v31 command line for `vetob2-01`: **REFUSED — "the baseline EMITS
  `veto_feedback` (1,055 rows in 6 h)"**, which is the torn-down canary's own exposure, not the baseline's.
  So **a re-run of a canary torn down in the last 6 h is refused for a reason about the WINDOW, not the
  licence.** Wait out the window, or widen `--hours` past the run and subtract it. Same family as
  `blindstep-02`: exposure drifts faster than a 6 h qualifying window.
- **Run before and after touching the verdict path:** `scripts/test_verdict_acceptance.py` (**83/83**),
  `test_verdict_acceptance_mutants.py` **OFF** the bots host (**33/33**),
  `scripts/test_launch_guards.py` (new — v31/v32 wiring + 3/3 mutants), and
  `scripts/test_schedule_invariant.py` (set `CANARY_LOOP_PATH` on the host).
- **Nightly 00:12Z `~/programread.py 24`**; nightly 00:07Z iron-funnel.
- Tier-1 analyst every 30 min — **alive; the 13:00Z run confirms the RULE.md restore: `prompt_tokens` 8668
  (broken 3631, pre-incident 8034), `fleet_healthy=True`, `versions_ok=True`.**
- **WHAT THE ANALYST ACTUALLY READS, because the token count looks too small and it is not.**
  `analyst.py:12` does `rule = rule[-20000:]` — a **blind 20,000-character tail** of the `## v14c`-onward
  slice — and *then* prepends `RULES-IN-FORCE.md` in full. So the prompt is 7,139 (authoritative paragraph)
  + 20,000 (tail of RULE.md) + the system block + 1,241 (digest) ≈ **8.7K tokens, which matches 8668
  exactly. Nothing is being silently cut by `num_ctx` (24,576).**
  **Two consequences.** (1) **Rules older than the last ~20 KB of RULE.md are ALREADY outside the window** —
  v14c through roughly v27 — and that is by design: `RULES-IN-FORCE.md` exists to cover it, which is why
  `analyst.py` calls that half AUTHORITATIVE and puts it first. (2) **Append new rules to the END of
  RULE.md**, or they fall outside the tail and the analyst never sees them.
- `canarywatch.py` cron */10; `stuckwatch.py` cron :17/:47; `monitor.py` */10 on BOTH hosts.

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
Normal from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "^bash /home/mike/canary-loop\.sh"` **plus** the deadline.

## Apparatus notes
- **`check-open-loop.py` is at `/opt/minecraft-ai/scripts/`, NOT `~/mcai-analysis/`.** Ledger:
  `/var/log/mcai/_canary-decisions.jsonl` (`MCAI_DECISIONS` overrides).
- **Registrations live in `~/mcai-analysis/registrations/<run_id>.json`** (20 on file), with a
  `/tmp/registrations/` fallback only when `VERDICT_REG_DIR` is unset.
- **The preflight checkers live in `~/mcai-analysis/`:** `changerowcheck.py`, **`licencecheck.py` (moved
  there today from `~/`)**, **`gatedigest.py` (new)**. `v30check.py` is at `~/v30check.py`.
- **`fleet-deploy` finds the reader with `pgrep -f '^bash /home/mike/canary-loop.sh'`.** Launch the loop as
  `setsid bash /home/mike/canary-loop.sh <run_id> </dev/null > ~/canary-loop-<run_id>.out 2>&1 & disown`.
  Do not route around it with `READER_OK=1`.
- **AFTER EVERY DEPLOY OR PROMOTION, diff `/opt/minecraft-ai/scripts/lib/` against `~/mcai-analysis/lib/`
  AND CHECK WHICH WAY THE DIFFERENCE RUNS.** It survived today; on 25 Sep `/opt` was two days BEHIND on
  three files, and on 23 Sep it was AHEAD.
- **`Events.count_class` exists on the Events class, not in `lib/vocabulary.py`.**
- **Use `date -u`. Do not estimate elapsed time from the flow of the work.**
- **`/root/d.sh` is the deploy copy** — the script `git reset`s the tree it lives in, so it must run from
  outside the repo. **But prefer `~/bin/fleet-deploy`, which also restores the analysis library.**
- **NEVER `open(p,'w').write(x)` when `x` might not be a string** — it truncates before it raises.
  `test_verdict_acceptance_mutants.py` was zeroed that way today and restored from HEAD. Write to a temp
  file and `os.replace`.

## Telemetry row shape and walk discipline
- Rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), kind is
  `r['name']` (leading underscore for `logEvent` kinds), everything else under `r['raw']` —
  `raw.bot.tools` (the only place durability lives), `raw.bot.inventory`, `raw.bot.pos`,
  `raw.code.version`, `raw.skill.{status, fail_class, detail, args, duration_ms, inventory_delta}`.
  **A gather or deposit outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`**
  — but for `skill_error` the SUB-CAUSE is only in `detail` (finding 4), and it is pathfinder prose.
- **Full walks only**; `grep -a`; readers must include rotated `.gz` generations. A 24 h walk is ~881k rows.
- **A wide walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME**, never alongside a live
  canary read.

## Worktrees
mcai-banktruth (`deposit-truth-msg` 9a6aa13 — KEPT, unpromoted), mcai-deposit (`deposit-truth` 73acd47 —
refused by both engines), mcai-shore (9b572aa), mcai-pickup (842e017), mcai-leafb (9fc3968), mcai-anylog
(7dd3775), mcai-digwatch (cfc1c58), mcai-falls (fc28885 — **falls-02 `37a68c3` KEPT, unpromoted**),
mcai-owner (owner-01c 93f5b8f), mcai-deathsites (b1659c0), **mcai-rl02 (`recovery-ladder-03` = docs/scripts
branch)**, mcai-scene. Branch `veto-b2-01` = `efabf13` (**vetob2-01 KEPT, unpromoted**).
**The main repo checkout is on branch `veto-feedback`**, which does **NOT** contain the live sha —
**read live source with `git show efa2853:bots/src/<file>`, never the working tree.**
**Uncommitted in `mcai-rl02` and NOT mine:** `bots/scripts/check-movement-writers.mjs` (modified),
`bots/test/movement-ratchet.test.mjs`, `scripts/botview.sh` (untracked). Left alone deliberately.

## Re-arm on a fresh session (monitors are session-local)
0. **VERIFY THE CANARY STATE YOURSELF — this file was wrong about it two days running.** Four checks:
   `check-open-loop.py`; `canary_pool` in the manifest; the **anchored** pgrep; and a census. As of 12:20Z
   all four say **no canary, one version, 80 bots**.
1. **RUN `python3 ~/mcai-analysis/gatedigest.py` FIRST.** It is one command and it answers the question that
   cost three days. Exit 0 = the live gate is the registered gate.
2. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|recorded|CRASH|refused`,
   `tail -n 0 -F`. **Neither file is complete; `page.jsonl` ALONE IS NOT A HEARTBEAT.** Monitors expire at
   30 min — re-arm, or check by hand. **An expiry with 0 events means nothing on its own** (it happened
   twice today with the loop idle and healthy), so silence is a prompt to run the anchored pgrep.
3. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT.** Confirm it is alive from `ls -t ~/digest/*.verdict.json`.
4. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min — **only if the loop is alive.**
5. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the
   manifest, then tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
6. **AFTER ANY DEPLOY OR PROMOTION, CHECK THE ANALYSIS LIBRARY SURVIVED:**
   `cd /opt/minecraft-ai && sudo python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18–19k rows / 80 bots. Then diff `lib/` against `~/mcai-analysis/lib/` **both ways**.
7. **CHECK HOST FILE MTIMES BEFORE TRUSTING THIS FILE'S APPARATUS SECTION.**
8. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER**, and stamp every measurement with its sha.
9. **CHECK WHETHER ANOTHER SESSION IS RUNNING** before editing shared files: `git log --oneline -5` and
   `git status` in `mcai-rl02`, and `sudo tail /var/log/auth.log` on .31 for commands you did not issue.
   **Today: none — the only entries were this session's.** But a session ran 06:00–09:50Z before this one
   and committed seven times without rewriting this file, which is how the overnight canaries went unrecorded
   here until now.
