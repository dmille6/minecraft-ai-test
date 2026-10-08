# Canary throughput (2026-10-08): two lanes NOT built; a queue scheduler built instead

**OWNER 2026-10-08 ~02:30Z:** "run it by codex first. but if codex and claude both find a good solution and agree on it,
then go ahead build it and implement it and deploy it."

**Outcome.** Codex and an independent Claude reviewer each rejected two concurrent canary lanes (option A) for now, on
the same evidence, and agreed on a **single-slot queue scheduler** (D2) plus a **mechanical variant-prep tool**. The
scheduler went through six design rounds and both engines approved it (Codex r5 + r6, Claude r6). The "one canary pool,
ever" rule in CLAUDE.md therefore stands; it gains a note on the scheduler and the installer lock protocol.

## 1. What was measured (host 10.0.0.31; scripts and outputs in section 7)

| | |
|---|---|
| Slot use 10-03 00:00Z..10-08 02:40Z | 97.9 of 122.7 h busy (80%); 13 decided + 1 live |
| Decisions since 09-28 (ledger) | 23: 15 KEEP, 6 REVERT, 2 INCONCLUSIVE (KEEP share 0.65) |
| Gaps > 12 min, by cause (hours) | deliberate holds 10.2; variant for a just-moved base not ready 5.0; draw stalls 5.5; preflight refusal + v33 install 2.6 |
| chain-after latency | 2-3 min after a terminal phase whenever a chain was set (5 of 5) |
| Free pools (not live, not in the 12-h exclusion), one lane | median 6 of 11 drawable; P(>=2) 100%, P(>=4) 84%, P(>=6) 53% |

Corrections both reviewers made to the first memo (accepted): the first pool-budget run carried three September
deployments that never closed as live for five days (median 4, not 6); the ledger has 23 decisions, not 22; oretunnel-03
lasted 26.4 h, not 22.8; and the carryover study (below) is not evidence for or against the 12-h exclusion.

**Isolated pools (B) are not equivalent.** `isolated-*` run `MEMORY_SCOPE=isolated` with `MEMORY_POOL=self-<bot>`:
per-bot world facts and lessons, no comms ingestion, no board, and every pool-scoped state dir (town site, town memory,
stonecap's cobble journal) is per bot. They are already in every read's control. Admitting them as treated would be
wrong for town/chest changes; making them equivalent is an env change on 20 bots that resets their memory. Owner question.

**Carryover (D1).** A restart does not reset a bag. Bag-occupancy DiD after teardown/promotion stayed off zero through
+12 h for composter-01, junkwell-01, withdraw-01 and toolclean-01, but both reviewers showed the method cannot support a
conclusion (missing treatments in the control histories, no null for two events, promotions measure early-vs-late
treatment, effects that grow after removal point at control drift). **The 12-h exclusion stays, unvalidated either way.**

**The tripper** is not scheduled anywhere: it runs only, dry, inside deploy-fleet.sh's verifier, which itself requires
exactly two builds for `--pool`. deploy-fleet.sh and the tripper ship with each canary sha (fleet-deploy runs the
sha's own copy), so any multi-canary support would have to be host-owned.

## 2. Throughput model (lanesim.py; queue never empty, draw rule as built)

| decisions/day | 1 lane | 2 lanes + promotion barrier | gain |
|---|---:|---:|---:|
| 11 pools, 12-h exclusion | 2.9-3.0 | 3.6-4.2 | +22..+40% |
| 15 pools (isolated admitted), 6-h exclusion | 3.1 | 4.9-5.0 | +57..+62% |

Observed 2.55/day. Claude's re-run (lanesim2.py) adds what the first model left out. A double KEEP ships only if a
disjoint variant on the first sha exists, so the gain is +26..+52% if it always exists, +13..+32% at half, and -1..+11%
if never. Post-promotion variant latency costs the single lane about 8%. Control erosion: excluding the other lane's pools
over a whole read window leaves a median of 4-5 non-isolated control pools, against 12-14 today.

## 3. Backtest: six past canaries replayed with a reduced control

**Harness.** Each read is replayed with:
- the logs truncated at the original read instant;
- the clock frozen there;
- a single-canary manifest bound over the manifest path in a private mount namespace;
- a fixture HOME.

Nothing live is written. **The full-control replay reproduced every recorded verdict line exactly** (deaths, bot-h,
v11 and death-gate figures).

Each canary is replayed again with the pools of an adjacent, disjoint canary removed from its control, as if that
canary had run in a second lane.

| canary (deciding read) | other lane removed | full control | reduced control |
|---|---|---|---|
| foodskip-01 +360 | board-b, placebo-a | KEEP (control 6/218.2 bh) | KEEP (3/169.7) |
| towndeposit-01 +180 | board-d, hive-c, placebo-b | REVERT (v11 +239%) | REVERT (+240%) |
| **junkwell-01 death poll** | board-a, board-c, board-d, placebo-d | **REVERT** (death gate 3.82x, LB 1.40) | **POLL_OK** (3.33x, LB 1.18 < 1.25) |
| chestfull-02 +360 | placebo-a, board-b | KEEP | KEEP |
| withdraw-01 +540 | board-a, board-c, hive-a | KEEP | KEEP |
| climbflood-02 +360 | board-b, placebo-a | KEEP | KEEP |

Five of six verdicts survive. **The death gate is where a smaller control bites.** Removing 4 pools widened the
confidence interval enough that junkwell-01's revert (6 canary deaths in 51 bot-h) would not have fired. Concurrent lanes
would cost the death gate power, the one guard this project cannot afford to weaken.

## 4. Option verdicts (both engines, independently, round 1)

| option | Codex | Claude |
|---|---|---|
| A. Two concurrent lanes | DON'T BUILD now. The forecast is unreliable, the design permits contamination and unmeasured promotions, and recovery is incomplete. | DON'T BUILD. Realistic gain +0..30%, it needs unmeasured double-KEEP compositions, controls erode toward non-equivalent pools, and it rewrites every safety script during v34. |
| B. Isolated pools | CHANGE: no blanket admission or env conversion | DON'T BUILD; report the validity question to the owner |
| C. Bundling | DON'T BUILD as proposed (p(KEEP) not calibrated) | CHANGE: no policy until calibrated |
| D1. 12-h exclusion | keep (not validated by the carryover study) | keep (it does not bind under one lane) |
| D2. Queue runner | CHANGE, then BUILD | CHANGE, then BUILD |
| Variant prep | build (better lever) | build (auto-approval is the owner's call) |

## 5. What was built

- **`scripts/host/canary-sched.py`** (cron, every 5 min, on the host). It launches the head of the owner's ordered
  queue (`~/canary-queue.json`) into an empty slot, exactly as chain-after does, and never looks past the head. The
  checks are listed in the module docstring. In short:
  - **Slot free.** Each of these is a separate observation:
    - the manifest declares no canary;
    - no loop, chain, launch, install, fleet-deploy, d.sh or drawrec process;
    - nobody holds the loop's lock (read from `/proc/locks`, never acquired);
    - no canary drop-in;
    - every unit, transitional ones included, shows fresh post-close evidence on the one declared build;
    - no process runs from the canary tree;
    - openloop is closed;
    - no journalled run is open. Closed means promoted|torn-down + `recorded` + a ledger row for its sha and pools.
  - **No SCHED-PAUSE and no INSTALL-HOLD.** It also holds after a death-driven REVERT until a human says `continue`.
  - **Head.** It must not be held, any `not_before` must have passed, and `after` dependencies must be done.
    It needs exactly one variant keyed by the full sha of the fleet base. The registration, its reads and its class
    must be byte-identical to what was queued. A /tmp read is staged only if absent and never overwritten. A pending
    NEXT-SLOT.json admits only underground-safety. A bag fix needs TARGET_K >= 4. drawexposure must answer, and with
    fewer than two eligible pools it waits and pages every 3 h.
  - **No automatic retry.** A refusal, or a loop that dies without a journal line, blocks and pages. Humans recover with:
    - `rearm`: a never-deployed run may launch again;
    - `abandon`: a never-deployed run is resolved. It refuses while a deploy process runs or within 20 min of `drawn`.
    - `closed`: a deployed run is closed. It refuses without its ledger row, and prints the row to append.
    - `cancel`: removes a run from the queue.
  - **Watch.** It pages on a draw stall (from the first draw line), on drift in a read's md5, and on canarywatch's
    UNREAD marker for the live run.
- **drawrec.sh, one anchored patch** (`patch_drawrec_exposure.py`). A drawexposure crash on a registration that
  DECLARES draw_exposure now leaves no pool eligible; before, it read as "no requirement". The TARGET_K line is
  byte-identical. It is the only existing file this changes.
- **`scripts/prepare-variant.sh`.** Mechanical variant preparation:
  - it works in a throwaway worktree and aborts on any conflict;
  - it runs range-diff, the real `npm test`, and a no-undef lint compared against the base;
  - the registration copy it writes has `approved` REMOVED, so `queue add` refuses it until a reviewer names the review.

  On toolhygiene c6e91a8->92bc84f it correctly reported CONFLICT; that variant was in fact hand-rebased.
- **Installer** `scripts/host/install-canary-sched.sh` (`--dry-run`, `--rollback STAMP`). It refuses while a loop,
  chain, launch or install runs, while the manifest declares a canary, or while drop-ins exist. It acquires the loop's
  lock for the whole install. It runs the tests on the live drawrec, backs up the crontab and drawrec.sh, installs by
  tmp+rename, seeds the three September runs as closed, and verifies everything. On any mismatch it rolls back. The gate
  bundle is untouched, and the installer checks that the digest is identical before and after.

**Installer lock protocol (new rule).** An installer must ACQUIRE `/tmp/mcai-canary.lock` (flock -n) for its whole run,
as v33/v34 do. It should first call `canary-sched.py install-hold <owner> <minutes>`, which stops new launches and exits
2 unless the slot is free now.

## 6. Pre-existing defects found (reported, not changed)

- **fleet-recycle.timer SKIPS while any canary is declared.** The journal shows skips at 10-06 05:00, 11:00 and 17:00,
  and 10-07 01:50. STATE.md's "next 05:53Z, inside this run" is wrong. With canaries near-continuous, the fleet is
  almost never recycled. The skip predates the canary tree, which already keeps a restarting control on baseline.
- **check-open-loop.py cannot record a decision once the manifest is cleared.** A `record-failed` followed by
  `torn-down` therefore leaves no reachable tool; `canary-sched.py closed` prints the row to append by hand.
- **canary-loop.sh can exit with a canary still deployed and its lock free:** promote-held, reads-missing (exit 4), or
  deploy not verified. Installers must also refuse on a declared manifest or drop-ins (v33/v34 check the manifest).
- **chain-after checks the lock, sleeps 60 s, then launches**, so an installer can take the lock in that gap. The loop
  then exits 3, and chain-after only warns.
- **canarywatch's heal** relaunches into a held lock, and copies missing reads from an unhashed source.

## 7. For the owner

1. **Duration is the biggest single lever** (Claude r1). drawrec's own measurement gives a null sd of 0.313 for a
   4-pool read at 3 h, against 0.395 for a 2-pool read at 6 h. Allowing KEEP at +180 for four-pool draws with exposure
   met would raise single-lane throughput more than lanes would, with no new machinery. This is your rule to change.
2. **Isolated pools.** They are in every read's control, though not equivalent for town and chest changes. Two options:
   - convert them to pooled memory (an env change that resets their memory);
   - exclude them from town/chest reads.
3. **Auto-approval of an unchanged range-diff variant.** Claude proposed it; Codex says "clean application is not
   approval". It is not built.
4. **fleet-recycle skips during canaries** (section 6).

Files: lanesim.py, poolbudget.py, carryover.py, ttbuild.py, backtest.sh, backtest-all.sh and the review transcripts
are kept in the operator's scratch for this session; the host copies are in `~/lanes-work/` on 10.0.0.31.
