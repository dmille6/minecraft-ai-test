# change_rows spelled `_x` never linked (gate v36.1) — 2026-10-20

Branch `changerows-underscore-1020` (from origin/main `45d56d58`). Found by the homefix-01 agent, confirmed by the
coordinator. **Not installed.** The coordinator installs it in a canary gap with
`scripts/host/install-changerows-1020.sh` (below).

## The defect

`verdict.py` links a canary death to the change through the registration's `change_rows` (v12 linkage, v19
discrimination, v25 control rate). Every comparison strips the log row kind's leading underscore —
`q[1].lstrip('_') in C_ROWS` — because logEvent kind `x` lands in `skill.name` as `_x`. The registered names were
kept as written: `C_ROWS = set(reg.get('change_rows', []))`. A registration that spells its rows the way the logs
do (`_lid_clear`) therefore matched nothing:

- no death was ever linked to its own rows (`changerow` empty), so the licensed-row REVERT path could not fire;
- `away` stayed empty and the control emission rate (`_ctrl_rate`) was never computed for those rows;
- the death gate's RATE path still ran — only linkage was dead, and nothing said so (the v27 "LINKAGE
  UNAVAILABLE" note keys on `not C_ROWS`, which was non-empty).

`linkage_extra` had the same mismatch against `M_LIST`.

`changerowcheck.py` (the launch preflight) has the mirror defect: `tally()` keys its counts by the stripped kind and
`main()` looked the declared name up as written, so it read 0 and printed "ok — baseline silent" for every `_x` row
**without having checked anything** (reproduced on the old code: a `_town_deposit` registration against a baseline
that emits `town_deposit` passed, exit 0).

Registrations on the host that use the spelling (scan of 330 registration files, 193 declaring rows):
**lidclear-01, cobblekeep-01, bagbudget-01** (9 files including variants). bagbudget-01 is LIVE on board-d,hive-a.

## The fix

| file | change |
|---|---|
| `scripts/verdict.py` | new pure `registered_row_names(names)`: strip the underscore once; a plain name is unchanged; a name empty once stripped (`_`, `__`) is dropped (it would match every nameless row); a non-string passes through so a dict still raises `TypeError` exactly as `set()` did, and a null list still raises. Used for `C_ROWS` and for `M_LIST`'s `linkage_extra`. |
| `scripts/changerowcheck.py` | new pure `assess(declared, base, other, unknown)`: the lookup (baseline, unversioned, other-build note) uses `row.lstrip('_')`, as `tally()` keys its counts; `main()` prints from it. |

Siblings checked, no change needed: `scripts/host/licencecheck.py` already strips both sides (`lic['kind'].lstrip`,
`row.lstrip`); `bagfixgate.own_kinds` adds every spelling (`k`, `k.lstrip('_')`, `'_' + k.lstrip('_')`);
`bagfixrule.registration_problems` only checks non-emptiness; `usaferule` requires `_x` link kinds and
`usafegate._named` matches the raw `skill.name` exactly (consistent with itself); `fieldaudit.py` reads only dict
entries of `change_rows`; `cobblekeepread.py` / `lidclearread.py` mention change_rows in comments only;
host-only `~/regcheck.py` counts entries and compares nothing.

## Tests

- `scripts/test_changerows_underscore.py` — drives the real `verdict.py` (the acceptance suite's `Case` fixtures: a
  manifest, a registration, evidence and per-bot skill logs in a temp dir). 12 cases: positive control (clean KEEP);
  `_x` + two deaths after `_x` rows → REVERT by the change-row path, and the control rate is MEASURED
  (`lid_clear=0.000/bh`); `x` (no underscore) → unchanged REVERT; `_y` registered → no link; control emits `x`
  constantly → REFUSED on its control rate; the death poll counts `1 with a change row`; `linkage_extra: ['_x']` →
  rung-linked; the pure normaliser (strip, drop-empty, '' dropped and None passed through, dict still raises). **4 anchored mutants** (anchor asserted
  present and unique, file asserted changed, each must FAIL exactly its named cases): the old `C_ROWS` line (kills
  cases 1, 3, 4 — and 1b; cases 2 and 2b still pass under it, which is the "unchanged for plain names" proof);
  `linkage_extra` as written (kills 5); normaliser without the strip; normaliser keeping empty names.
- `scripts/test_changerowcheck.py` — +6 cases (`_x` refused when the baseline emits `x`; the plain spelling
  unchanged; `_x` refused when only unversioned rows exist; `_x` clears when only another build emits it AND the
  other-build note proves it was looked up; `'_'` refused as not a row name; `assess()` on every spelling) and +2
  mutants (`k = row`, the 10-20 defect — it fails exactly the four underscore cases; the empty-name refusal
  removed). Every mutant now names the case it exists to break and a crash is a harness failure, not a kill (Codex
  r1). One existing mutant's anchor moved with the code into `assess()`. 22/22.
- `scripts/test_verdict_acceptance_mutants.py` — two mutants had been printing `SKIP` (anchors stale since v33's
  `out('REVERT', {'by': ...})` and v34's `and not _USAFE`). Re-anchored; both KILL. 31/33 → **33/33**.
- Unchanged suites, all green locally (with the host's `version_split.py` as `VERDICT_MODULE_DIR`, see below) and on
  the host in the staging dir: acceptance 83/83, test_license_change_rows ALL PASS, test_tiers, test_keep180,
  test_bagfix, test_usafe, test_threepool, test_drawrequire, test_holdtoken, test_bagfix_loop. On the host
  (`changerows-suites.sh`, staging dir, nothing SKIPPED): 12/12 + 4/4 mutants, 22/22, 149/149, 46/46, 163/163,
  166/166, 177/177, 35/35, 19/19, 21/21, ALL PASS, 83/83.

Pre-existing, not fixed here: the repo's `scripts/lib/version_split.py` has no `in_canary_pool` (only the host's
`~/mcai-analysis/lib/version_split.py` does), so off the host `verdict.py` cannot run a non-dry read without a shim.

Pre-existing, noticed, not fixed here: verdict.py's `_scan` keeps an ordinary row only if its line carries the
DECLARED date or TODAY's date (deaths from any date). A canary that runs into a THIRD UTC day (a bag-fix extension
to +1440 or +1920 can) therefore loses every non-death row from the middle day(s) — including change rows in a
death window on that day. Worth its own fix.

## What would have changed

### Launch preflight (counterfactual: the fixed `tally`+`assess` over each launch's own recorded window and build)

| run | window (baseline) | row | as written (old) | stripped (fix) |
|---|---|---|---|---|
| lidclear-01 | 10-16 10:56–16:56Z (623e92b) | `_lid_clear` | 0 → ok | 0 → ok |
| cobblekeep-01 | 10-19 23:01Z–10-20 05:01Z (adbec4f) | `_lid_clear` | 0 → ok | **485 → REFUSED** |
| | | `_well_dispose` | 0 → ok | **56 → REFUSED** |
| bagbudget-01 | 10-20 05:31–11:31Z (9e7d998) | `_bagbudget` | 0 → ok | 0 → ok |
| | | `_town_deposit` | 0 → ok | **28 → REFUSED** (+246 from adbec4f, noted) |

Positive control: each re-scan reproduces the recorded preflight's row/bot/kind totals (e.g. cobblekeep 357,054 rows,
319,855 baseline on 80 bots, 173 kinds vs the recorded 357,031 / 319,832 / 80 / 173).

So the fixed preflight would have **refused cobblekeep-01 and bagbudget-01 at launch**: their change rows were
already emitted by the baseline (lidclear-01 and towndeposit-02 had been promoted), so they could never
discriminate. That is a launch outcome, not a verdict: at read time v19/v25 would have refused those rows as
non-discriminating anyway.

### Verdicts

Replayed NON-dry (the linkage scan only runs outside `--dryrun`) through the installed v36 gate and the staged
v36.1 gate, read mode and `--poll` mode, with `scripts/host/changerows_replay.py verdict`: the manifest exactly as
bound in each read's evidence objects; every bot's skill rows in [declared_at − 7 h, T) copied (T = the recorded
verdict artifact's `at`; 7 h covers the tier-2 interlock's lookback); the read's own evidence objects with ONE
field changed, `emitted_at` → 2 min ago (verdict.py's 90-min freshness check is wall-clock). The staged copy runs
on its own modules (`VERDICT_MODULE_DIR`) against the re-registered rules, so the only allowed difference is its
module-dir annotation. **Positive control: the installed copy must reproduce the recorded verdict word, or the
comparison is refused.** Reads that span a UTC date other than the declared date or today are refused (the
scanner keeps ordinary rows only from those two dates); both runs below fall inside one day.

| read | rows copied (bots) | recorded | installed | staged | reason lists | poll (both copies) |
|---|---|---|---|---|---|---|
| cobblekeep-01 +180 | 614,611 (88) | NOT_YET | NOT_YET | NOT_YET | identical | 2 canary deaths, 0 rung-linked, **0 with a change row** |
| cobblekeep-01 +360 | 806,471 (88) | KEEP | KEEP | KEEP | identical | 2 deaths, 0, **0** |
| lidclear-01 +180 | 616,701 (88) | NOT_YET | NOT_YET | NOT_YET | identical | 1 death, 0, **0** |
| lidclear-01 +360 | 794,141 (88) | KEEP | KEEP | KEEP | identical | 1 death, 0, **0** |
| bagbudget-01 LIVE (poll, 10-20 ~16Z) | 708,997 (88) | — | POLL_OK | POLL_OK | identical but the annotation | 1 death, 0, **0** |

**No verdict would have changed.** The reason, checked directly rather than inferred: neither cobblekeep-01 canary
death (placebo-d-Comet 06:45:22Z drowned; placebo-a-Comet 07:06:52Z lava) had a `_lid_clear` or `_well_dispose`
row in the 60 s before it. Positive control for that read: the same scan found 16 canary and 386 control own-kind
rows in the window (control `_lid_clear` 350 — the baseline emits it), so the instrument could see the rows.

Also: the `--dryrun` replay of 61 past reads (every registration, tiered included) through both copies: **49 SAME,
0 different, 12 both-crash** (the pre-existing `ALLBOTS` dryrun crash, identical on both copies).

## Install (coordinator, in a canary gap)

Nothing on 10.0.0.31 was modified except new files under `~/changerows-1020/` (staging, scratch rules, replay
work, test temp dirs). The installer was NOT run, not even `--dry-run` (its dry run probes
`/tmp/mcai-canary.lock`).

How the live gate is installed and pinned (as found): `~/verdict.py` plus the decision modules it imports or the
loop runs form a BUNDLE; `python3 ~/verdict.py --gate-digest` prints its md5 (live **199517353b444cfdeb706d3ad965e05b**,
v36). The authoritative record is the column-0 `GATE DIGEST verdict-bundle md5 ...` line in
`~/digest/RULES-IN-FORCE.md`; `~/mcai-analysis/gatedigest.py` refuses a LAUNCH when they differ (canary-loop.sh),
and verdict.py annotates a mismatch on every read. Installs are recorded in `~/digest/gate-installs.log`
(v33..v36). The v36 installer (`scripts/host/install-gate-v36.sh`) is the model: holdtoken.py claim (the scheduler's
install-hold, under its tick lock) + `flock -n /tmp/mcai-canary.lock`, busy checks, staged suites, digest
predicted, rules rewritten in a scratch copy and checked by gatedigest, replays, backups, rename install, interlock
verify or rollback.

New bundle: **635ad8d866a6e4a772351961bd5bd997** (verdict.py 36c8e287, changerowcheck.py d62df410; every other
part unchanged). Header becomes `(v36.1, 2026-10-20; the interlock is v32)`; the paragraph is
`scripts/host/changerows-rules-paragraph.md`.

Stage (from this branch's head) and run, in a gap between canaries:

```
ssh mike@10.0.0.31 'mkdir -p ~/changerows-1020/stage'
scp scripts/{verdict.py,changerowcheck.py,tierrule.py,bagfixrule.py,usaferule.py,usafegate.py,bagfixgate.py,\
    deathgate.py,drawrequire.py,singledeath.py,drawsteady.py,test_tiers.py,test_keep180.py,test_usafe.py,test_bagfix.py,\
    test_changerowcheck.py,test_verdict_acceptance.py,test_threepool.py,test_drawrequire.py,test_holdtoken.py,\
    test_changerows_underscore.py,test_license_change_rows.py} \
    scripts/host/{canary-loop.sh,drawrec.sh,bagread.py,holdtoken.py,heavyread.sh,canary-sched.py,test_bagfix_loop.py,\
    canarywatch.py,ugsafe2_value.py,changerows_replay.py,changerows-precheck.sh,changerows-suites.sh,gatedigest.py,\
    changerows-rules-paragraph.md,install-changerows-1020.sh} \
    docs/reports/airpocket-01.{ee21207,dbb4d78}.json mike@10.0.0.31:changerows-1020/stage/
# precheck (read-only, any time; exit 0 = installable; it REPORTS a live canary as BUSY):
ssh mike@10.0.0.31 'bash ~/changerows-1020/stage/changerows-precheck.sh'
# in the gap (no manifest canary, no drop-ins, no loop/chain, no install-hold):
ssh mike@10.0.0.31 'bash ~/changerows-1020/stage/install-changerows-1020.sh --dry-run'
ssh mike@10.0.0.31 'bash ~/changerows-1020/stage/install-changerows-1020.sh'
```

The precheck (run 10-20 with bagbudget-01 live) passes: staged files present; 16 unchanged files equal live;
targets on their v36 base (verdict 43bdfb34, changerowcheck e8211c76); live bundle = v36 and gatedigest passes;
predicted bundle 635ad8d8…, all parts resolved; BUSY: bagbudget-01 declared, drop-ins and its loop present. The
installer runs the precheck again UNDER the hold just before installing and refuses if the predicted bundle moved.
A failed rollback (restored files not verified, gatedigest failing, or bundle not back to v36) KEEPS the
install-hold and says so.

Queue: entries pin each variant's registration sha256 and read-script md5s (`reads`, `kitsearchread_md5`); **no
entry pins verdict.py or changerowcheck.py**, so the install needs no queue edit. No pending entry declares an
underscore-led row (only lidclear-01, cobblekeep-01, bagbudget-01 ever did). If bagbudget-01 is rearmed after the
install, its `_town_deposit` row will be REFUSED at launch (the baseline emits it): drop it from `change_rows`, which
changes the registration's sha256, so the queue entry must be re-added.

## Reviews

| round | engine | verdict | what changed |
|---|---|---|---|
| 1 | Codex (`codex exec --sandbox read-only`) | APPROVE-WITH-CHANGES | P1 the staged replay hashed the LIVE changerowcheck (it stripped `VERDICT_MODULE_DIR`), so every staged line would carry a GATE-CODE note and the installer would refuse → the staged copy now runs on its own modules; v36_replay.py replaced by `changerows_replay.py dryrun`. P2 compare whole reason lists, not the word; P2 refuse replays whose dates the scanner would drop; P2 rollback must check gatedigest and keep the hold on failure; P2 changerowcheck mutants must name their target case and a crash is not a kill. Edge claims corrected ('' dropped, None passes through; changerowcheck now refuses a name empty once stripped). → df32e9d3 |
| 1 | Claude (independent subagent) | APPROVE-WITH-CHANGES | P1 commit this report; P2 re-run the precheck under the hold before installing; P2 say the queue-pin consequence for bagbudget-01; P3 note the linkage_extra WATCH; P3 add gatedigest.py to the SAME list (holdtoken.py has no live copy — it runs from the staging dir — so it is not comparable). Ran: 11/11 + 4/4, 22/22, acceptance mutants 33/33, selftest OK. → this commit |
| 2 | Claude | **APPROVE** | all round-1 items closed (report committed; precheck re-run under the hold must print the same bundle; queue-pin + linkage_extra notes; gatedigest.py in SAME). Two P3 notes, no change: the repo and host gatedigest.py must stay equal (they are, md5 6bc85d81); the paragraph's "same verdicts and reasons" claim is enforced by step 4b, which refuses on any difference. |
| 2 | Codex | APPROVE-WITH-CHANGES | every round-1 finding resolved; P2 `live` mode compared only the word and accepted two crashes → now requires both verdict lines and artifacts and compares reasons + extra (re-run on bagbudget-01: SAME). → next commit |
| 3 | Codex | **APPROVE** | round-2 P2 resolved; no remaining findings. |
