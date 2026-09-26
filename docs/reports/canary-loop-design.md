# The canary loop on the host — design v1 (16 Sep 2026 12:20 UTC; for two-engine review before building)

## Why
Every canary costs the operator 30–40 turns, and most of the operator's tokens on a canary day are cold starts after idle gaps. Every step is already a script; only the glue is a person. Rules v12/v14c/v15c/v16 are mechanical and calibrated; the read scripts print their verdict lines.

## The loop (`canary-loop.sh`, on the bots host, one run per canary, started by the operator or by a queue file)
1. **Queue**: `~/canary-queue.tsv` = `<sha> <run_id> <registration-id> <reads: scripts> <notes>` in histogram order (queue-order.py output pasted by the operator when registering). One line is consumed per loop run.
2. **Baseline check**: the sha must descend from the manifest's declared_code_version (fleet-deploy already refuses otherwise). If not: page the operator and stop.
3. **Draw**: `drawrec.sh` every 20 min until two pools; each miss is logged, not paged.
4. **Deploy**: `fleet-deploy <sha> <run_id> "<notes>" --pool P,Q`; wait for VERIFIED; page on FAILED/MIXED.
5. **Reads** at +30/+90/+180/+360 (and +540/+720 if the registration says so): the registered read scripts; each output is written to `~/digest/reads/` and the local analyst's verdict object is attached.
6. **Death poll** every 5 min with the v12 linkage + change-row checks; a rung-linked or change-row death applies the registered rule mechanically (v12 for ladder changes, v14c's four conditions for non-ladder); the death gate (two deaths and > 1.25× control) likewise.
7. **Verdict** at the registered read: KEEP if readability, the linkage rules, the v15c guards, the deposit line and the change's own lines all pass as the scripts print them; REVERT if a rule trips; INCONCLUSIVE on zero exposure past the registered extension.
8. **Act**: KEEP → `check-open-loop.py --record KEEP` → `fleet-deploy <sha>` fleet-wide → `main-pre-<date>` → fast-forward main; REVERT/INCONCLUSIVE → record → teardown three steps → confirm versions. Then write the decision line into the registration doc and STATE.md, commit on the docs branch, and page the operator with one line.
9. **Page** only on: a verdict, a gate or rule trip, a deploy failure, a version split, the analyst's page flag, or any step's exception. Never for a landed read that changed nothing.

## What stays with the operator
Registration (the rule text, the change's own lines, the read list), the build and reviews, anything the loop pages about, and the prospective amendments. The loop never edits a rule.

## Safety
The loop cannot deploy an unregistered sha (the queue line must name a registration id present in the doc), cannot skip the baseline check, cannot promote without a KEEP recorded, and cannot run two canaries (it refuses when the manifest already names one). A dry run replays a finished canary's window (CANARY_DRYRUN) and must reproduce the recorded verdict before the loop goes live.

## Question for the reviewer
Is this the right boundary between the loop and the operator? What must the loop refuse to do on its own? Name at most three defects with one-line remedies, then ACCEPTABLE or NOT ACCEPTABLE.

## v2 — ChatGPT's first pass folded in
1. **The registration binds everything.** A queue line carries only a registration id; the registration block in `docs/reports/recovery-ladder-registration.md` (committed, immutable once deployed: the loop refuses a block whose hash changed after the deploy) names the sha, the read scripts, the rules, the pool constraints and the promotion scope (`fleet-wide` or `none`). Any mismatch between the queue line, the block and the manifest stops the loop and pages; a fleet-wide promotion needs `promotion: fleet-wide` in the block, written by the operator at registration.
2. **Evidence is structured and validated; the analyst escalates, never authorizes.** Each read script writes a JSON verdict object beside its text (fields: readable, gates, guards, own_lines, exposure, harm) and the loop's verdict is computed from those fields by `verdict.py`; a missing, stale (older than the read time), contradictory (two scripts disagree on bot-hours by > 10%) or unparsable object is `UNREADABLE` and the loop holds and pages. The local analyst reads the same objects and may only add flags (`page: true`); it never changes a verdict.
3. **One loop, journaled, idempotent.** `flock` on `/run/lock/mcai-canary` for the whole run; every phase appends to `~/canary-journal.jsonl` (phase, sha, pools, declared_at, outcome) before acting; every action is idempotent (deploy checks the manifest first, teardown checks the drop-ins first, promotion checks the fleet's live versions first) and a restart resumes from the journal's last phase; when the journal and the fleet disagree (manifest says a canary, journal says torn down, or versions live ≠ expected) the loop stops, verifies rollback is possible, and pages rather than reconciling on its own.

## v3 — pass 2 folded in; review closed; build follows
1. **Evidence is bound.** Each read's JSON object carries `{sha, pools, run_id, declared_at, window_min, registration_sha256}` and a fixed schema; `verdict.py` accepts an object only when all six match the active manifest and registration and every registered predicate is present; otherwise UNREADABLE.
2. **A held loop is not an unattended canary.** UNREADABLE, an exception, or a journal/fleet disagreement puts the loop in HOLD, in which the death poll and the analyst keep running and paging; the registration names a deadline (default +420 min) after which a canary still without a verdict is contained by the registered action (teardown, recorded INCONCLUSIVE with the hold reason). The operator can lift a hold only by writing a decision line.
