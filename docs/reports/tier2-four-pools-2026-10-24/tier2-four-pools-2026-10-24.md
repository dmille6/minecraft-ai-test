# Tier 2 draws exactly four pools or waits (2026-10-24) — design + replay, NOTHING installed

OWNER POLICY (adopted from queue-speed Q3, via the coordinator 10-24): a tier-2 fix that cannot draw exactly 4 pools
waits for 4 or is registered tier 3. Nothing enforces it; ironsmelt-01 (tier 2) drew 3 pools at 02:21Z today because the
draw takes what is free. This is the smallest mechanical enforcement, its replay over 10-12..10-24, and the comparison
with auto-registering tier 3 at draw time. Branch `tier2-min4-1024` (on `queue-speed-1023`, whose replay tools it
reuses). Host 10.0.0.31: files read, read-only programs over ssh stdin; nothing written there.

**BOTH ENGINES APPROVE round 3 (commit 7a8e7fe8)** — Codex and Claude, P3 nits only (section 7). Round 3 fixed
Codex's round-2 P2 (R10's exit-2 path) and Claude's round-2 P3s. **Round 2**: both engines asked for changes in round 1. The headline replay number was wrong — a replay bug
(poolescape-01) — and is corrected here; the loop gained a count interlock; the scheduler's tier-2 wait gained its
12-h page; the wording no longer claims bounds the replay cannot support.

## 0. Short version

| | |
|---|---|
| rule | **derived, no new field**: `tierrule.tier_of(reg) == 2` (the one definition verdict.py and drawsteady use). drawrec draws exactly 4 or nothing; the loop refuses a tier-2 registration that can never draw 4 before the draw, journals each empty draw, **refuses after 12 h** with a page naming the remedies, and refuses any tier-2 draw that is not exactly 4 (an interlock against a drawrec without the rule); R10 holds a tier-2 head in the scheduler (not in the loop, holding the lock) while fewer than 4 pools can expose it, and pages an error at 12 h |
| replay 10-12..10-24 | 10 tier-2 draws (all after v36, 10-19 16:27Z; no registration had a tier before). 3 drew 4. **The other 7 would have waited 0.7, 0.7, 0.7, 1.1, 3.3 and 7.3 h; indexsearch-01 found no 4th pool inside its 3.3-h window** (and only 2 pools could expose it: it would have waited in the scheduler). None reached the 12-h bound inside its window |
| lane cost | a **conditional estimate, not a bound**: +17.2 h of waits over 4.5 days (indexsearch-01 counted as its 3.3-h window), less 6.0 h of hypothetical earlier KEEPs (ironpick-01, poolescape-01 at +180, reasoned) = **net about +11.2 h** (~2.5 h/day), first order, if the lane was otherwise busy |
| verdicts | **unknown, not shown unchanged**: every 4-pool counterfactual contains the run's own pools, whose logs hold its real canary, so the baseline and death gate cannot be re-run (all 12 R1 and 4 R2 checks CASCADE-BLIND). R3 (reasoned, baseline taken as clean) says 2 runs would have KEPT at +180 instead of +360 and 2 would not; 3 have no counterfactual verdict (bagbudget-01: closed by hand with no deciding read; indexsearch-01: no 4-pool draw; ironsmelt-01: not yet read) |
| auto-tier-3 at draw | relabelling a short draw tier 3 is not simpler (the tier lives in hashed registration bytes read by the gate: a trusted marker is a gate change) and not safer (a tier-3 verdict drops the v36 baseline check on pools drawn under tier-2's 240-min release). The safe automatic variant — swap in a pre-approved tier-3 variant and redraw under tier-3 exclusions — needs no gate change but is scheduler work plus a second approved variant per entry (Q2) |
| recommendation | install it if the owner accepts ~2.5 h/day of lane for exactly-4-pool tier-2 reads; most of the waiting is short (5 of 7 found a 4th pool within 3.3 h) — Q1 |

## 1. The rule

Patches are against the live files (md5s): drawrec.sh d0d4d51c, canary-loop.sh 344b1074, canary-sched.py 0d9a87f3 (the
repo's scripts/host copies of the last two are identical). Patched copies (round 3): drawrec 01f8170e, loop 076a5799,
scheduler 1a333d49.

1. **drawrec.sh** (`patches/drawrec.sh.patch`). After the draw_k block: a registration with a `tier` key is classified
   with `tierrule.tier_of`; tier 2 sets `TARGET_K = MIN_K = 4`, so the draw is exactly 4 or `NONE`. Tier 2 whose draw_k
   caps the draw below 4 (drawrec's own reading: an int with 1 <= k < 4, so `True` caps at 1 and 0/False are ignored)
   draws nothing. A `tier` key that cannot be classified draws nothing (fail closed). **No `tier` key: today's code
   path** (the block is skipped, nothing imported). `draw_require_pools` goes through `drawrequire.pick` with MIN_K 4.
2. **canary-loop.sh** (`patches/canary-loop.sh.patch`). All in the DRAW phase, so a resume of a deployed canary never
   classifies anything:
   - `TIER2` from `tier_of`; a tier it cannot classify journals `refused-tier2-tier` and pages "restore tierrule.py, then
     rearm".
   - preflight: draw_k read as drawrec reads it (1 <= k < 4), more than 4 `draw_require_pools`, or a malformed one
     (drawrequire.parse; drawrec refuses it on every attempt): `refused-tier2-pre`, naming the field and the remedy
     (replace-variant, or a tier-3 variant, then rearm). drawrequire.py unreadable: left to drawrec, which fails closed.
   - the `draw` row says "waiting for exactly four pools (tier 2)" (untiered: "two pools", as today).
   - each attempt that draws nothing: `draw-short` with drawrec's own last line (so the scheduler's existing draw-stall
     page at 3 h names it). **The bound**: at the first empty attempt at or past 12 h (`T2_DRAW_MAX_H`; every ledger
     exclusion has lapsed by then) the loop journals `refused-tier2-draw` and pages an error: if drawrec named the 4-pool
     floor, re-register tier 3 (`queue replace-variant`, then `rearm`) or `rearm` to wait again; if it named another
     refusal (draw-exclude.txt, drawsteady, the registration), fix that. Then exit 2, nothing deployed; the entry is
     `blocked` (`refused*` is in the scheduler's REFUSAL_PREFIXES; both remedies are performable on a never-deployed run).
     It is a timeout on unsuccessful draws, checked after each one: a draw of 4 that arrives at any time deploys (that is
     the policy), and a drawrec that HANGS is not bounded here, exactly as for every run today (the draw-stall page fires
     on it at 3 h).
   - **interlock** after the draw: a tier-2 `P` that is not exactly 4 pools journals `refused-tier2-count` and pages
     "install drawrec.sh from the same bundle as this loop" — so a partial install, a rollback of drawrec alone or a
     later drawrec edit can never again deploy a tier-2 run short (the bag-fix rule has the same kind of interlock).
3. **canary-sched.py** (`patches/canary-sched.py.patch`).
   - R10, for a head that declares `draw_exposure`: tier 2 with fewer than 4 pools that can count — the exposure list
     plus `draw_require_pools` (drawrec exempts them from the exposure filter; placebo-c and isolated-* never count, as
     drawrec never draws them), from either valid drawexposure answer (exit 0, or exit 2 = fewer than two exposure
     pools: round 3) — is a `WAIT` in the scheduler, and four with the required pools passes R10 even when drawexposure
     said fewer than two, so a
     structurally narrow head does not park a loop in `draw` holding the loop lock (which shuts installers out). This is
     NECESSARY, not sufficient: the band, ledger and steady release are the draw's, so a head that passes R10 can still
     wait in the loop, bounded there. A `tier` it cannot classify BLOCKS — a tier-3 head with an unreadable tierrule.py
     included, on exit 0 and exit 2 alike (newly blocked where it used to pass or wait; fail closed).
   - W4 (`r10_wait_pages`, a pure function): every R10 wait pages a flag past 3 h naming its floor ("two", or "four" for
     tier 2 — the old text always said two); a tier-2 wait also pages an ERROR from 12 h naming the remedies
     (replace-variant to tier 3, or `queue hold` and reorder). It stays a wait, not a block: in a serial queue a block
     halts the lane exactly as a wait does, and the policy is "waits for 4", so it still launches if 4 pools can expose it
     later. (The loop must refuse at 12 h because it holds the lock; the scheduler holds nothing.) The clock is W4's
     existing one: from the first R10 wait since the last launch, so time the head spent in another wait between two
     R10 waits counts toward the 12 h (as it always has for the 3-h flag).

Why derived and not a `draw_min_pools` field: the policy is "tier 2 means 4"; a field would be a second definition that
can disagree with `tier_of`, and every queued tier-2 entry would need re-registering (a new sha256). A registrant who
wants fewer pools registers tier 3 — the policy's own remedy.

## 2. Interactions

- **R10 / draw_exposure:** today R10 needs 2 exposure pools; a tier-2 head now needs 4 (required pools counted). In the
  replay only indexsearch-01 had fewer (2: board-a, placebo-a) — it would have waited in the scheduler.
- **draw_require_pools** (towniron needs hive-b, board-a fixes need board-a): `drawrequire.pick` takes MIN_K 4: the
  required pools must be drawable (they obey every exclusion) **plus** enough eligible others to make 4, or it waits —
  never a substitute, never 3 (tested). More than 4 required is refused before the draw. poolescape-01 (required board-d)
  is the replay's case: 3.3 h.
- **The 6-h / 12-h / 240-min exclusions and restart lag:** unchanged. A tier-2 draw keeps v36's release (240 min after a
  tier-2 close, 360 after a tier-3 promotion) and every steady check (one build in the hour, the 240-min version_clean,
  bags). Waiting for 4 is waiting for more of them to lapse; after a promotion the restart-lag check holds every pool
  ~1 h, so a tier-2 head launched just after one often waits ~1 h (bagbudget, townindex, ironsmelt: 0.7 h).
- **Bag fixes / model-env / underground-safety:** they carry a `class`, so they are never tier 2; unchanged.
- **One canary pool, the tripper, install holds:** unchanged. A waiting loop holds the loop lock, as a bag fix's draw
  does today — bounded at 12 h, and R10 keeps the structurally narrow cases out of it.
- **Resume / rearm:** a loop restarted during its draw starts a new 12-h clock (the bound is per loop attempt).

## 3. Replay (`replay_min4.py`, `out/replay_min4.out`)

Method: the queue-speed reconstruction (`drawsim.py`, positive control 27/34 actual draws reproduced), a fresh read-only
log scan 10-11 00:00Z..10-24 03:30Z (18.9 M rows), re-drawn every 22 min (the loop's cadence) from each short draw,
through `eligible_waiting`, the WAITING world:
- until the run's actual close the real fleet is that world, except that the run's own deployment did not happen. It is
  removed from the live set before anything is decided (round 2: round 1 added the pools back AFTER the draw had
  discarded them, so a required own pool could never reach 4 — poolescape-01's ">= 6.3 h" was that bug; regression
  test `test_replay_min4.py`, whose positive control runs the round-1 method on the same stub and sees the loss);
- **A1** the run's own pools are eligible, as at its draw (their real rows hold its canary and cannot be re-read);
- **A2** their treated telemetry is kept out of the band median and of every steady-release reference;
- past the actual close the waiting world is unreadable; a wait not found by then is reported as "not within" the window.

Every number below is conditional on A1 and A2. They can move other pools' eligibility either way, so no row is a bound.

| run | drew | 4-pool draw | wait | recorded | R3: 4-pool +180 KEEP (reasoned) |
|---|---|---|---|---|---|
| cobblekeep-01 | 4 | — | 0 | KEEP +360 | — |
| bagbudget-01 | 2 | 10-20 12:14Z (+hive-b, placebo-b) | 0.7 h | INCONCLUSIVE (by hand) | none (no deciding read to compare) |
| toolkit-03 | 3 | 10-21 08:25Z (+hive-a) | **7.3 h** | KEEP +720 | no (death gate WATCH) |
| ironpick-01 | 3 | 10-22 01:36Z (+board-a; one of 6) | 1.1 h | KEEP +360 | **yes** — the same KEEP 3 h sooner (hypothetical) |
| protectzone-01 | 4 | — | 0 | KEEP +180 | — |
| townindex-01 | 3 | 10-22 19:34Z (+board-d) | 0.7 h | KEEP +360 | no (exposure 0 at +180) |
| poolescape-01 | 3 | 10-23 05:03Z (+board-a; one of 7) | **3.3 h** | KEEP +360 | **yes** — 3 h sooner (hypothetical) |
| indexsearch-01 | 2 | not within its 3.3-h window | unknown (>= window) | INCONCLUSIVE (by hand) | no counterfactual |
| chatgate-01 | 4 | — | 0 | KEEP +360 | — |
| ironsmelt-01 (live) | 3 | 10-24 02:59Z (+board-b) | 0.7 h | not yet read | — |

- **Unbounded waits:** none reached 12 h inside its window. indexsearch-01 is unknown past 3.3 h; with only 2 exposure
  pools it would have waited in the scheduler (R10), paged at 3 h and with an error at 12 h, without holding the lock.
- **Verdicts:** waiting cannot flip a past verdict, but it changes the pools and the window, so every changed run's
  verdict is a NEW verdict on a counterfactual. None can be re-run: R1 (baseline, 12 checks) and R2 (death gate, 4) are
  all CASCADE-BLIND — the counterfactual windows overlap the run's own real canary on shared pools. So the 7 changed runs
  split into: 4 reasoned with R3 (2 would KEEP at +180, 2 not) and 3 with no counterfactual verdict at all. R3 takes the
  baseline as clean (the most KEEP-favourable reading), so its two "yes" are an upper estimate.
- **Lane time (first order):** waits 17.2 h (indexsearch-01 counted as its 3.3-h window), hypothetical earlier KEEPs
  6.0 h, net **about +11.2 h over 4.5 days** — IF the slot was otherwise busy. Idle slot time (R11 holds, install holds,
  an empty queue, no variant for the base) absorbs waits, and later draws are not re-simulated against the shifted lane.

## 4. Alternative: auto-register tier 3 at draw time

- **Relabelling the drawn run is not simpler.** The tier is in the registration bytes, hashed at `queue add` and checked
  by the scheduler's H3 before launch (never re-checked while the loop runs), and read by verdict.py (verdict.py:208,
  `tier_of(reg)`) and drawsteady. A downgrade must either edit the registration under a running loop (the run-id-is-one-
  deployment rule, and the hash no longer matches the queue's) or add a downgrade marker that verdict.py trusts from the
  journal — a gate-bundle change, a new digest, and a journal line deciding a gate rule.
- **Relabelling is not safer.** The short draw was made under tier 2's 240-min early release. Judged as tier 3, the run
  loses the v36 baseline check, which verdict.py applies only when the tier is 2 — so indexsearch-01's dirty +360
  baseline (placebo-a ran poolescape-01's canary inside the lookback) would have been KEEP-able unchecked. And it keeps
  the lane moving exactly as today, i.e. it does not enforce the policy.
- **The safe automatic variant (Codex round 1):** on a short tier-2 draw, swap in a pre-approved tier-3 variant through
  the existing never-deployed `replace-variant` path and redraw under tier-3 exclusions (6 h / 12 h). No gate change —
  but scheduler/loop work, a second reviewed variant for every tier-2 entry, and a run that loses its +180 KEEP. Not
  designed or replayed here (Q2).

## 5. Tests (all pass; every mutant killed; positive controls)

| suite | result |
|---|---|
| `patches/test_drawrec_tier2.py <patched drawrec> drawrequire tierrule --mutants` — the REAL drawrec Python block on fixtures | 19/19 (no tier / tier 3 unchanged; tier 2 with 2, 3, 4, 6 eligible; class / `True` tiers ignored; draw_k 2 and True refused, draw_k 4, 5, 0, False draw 4; tierrule missing with and without a tier key; draw_require + tier 2 with 3 and 2 others; tier-3 draw_require positive control); 5/5 mutants |
| `patches/test_loop_tier2.py <patched loop> tierrule drawrequire --mutants` — the loop's OWN tier-2 code cut from the patched canary-loop.sh, fake clock | 22/22 (drawn at once; draw-short rows then drawn; refusal at the first empty draw at or past 12 h, page naming when each remedy applies; the bound is the configured value; untiered and 3-pool untiered positive controls; count interlock; draw_k 2/True refused, 0/False/4/5 not; 5 required refused, 1 not; a malformed required list refused for tier 2, untouched untiered; unclassifiable tier journalled and refused; no tier + no tierrule drawn); 11/11 mutants |
| `test_replay_min4.py --mutants` — the replay's waiting-world eligibility on a stub | 9/9 (the round-1 method loses the 4th pool — positive control; the regression; ledger and other-run exclusions still apply; own telemetry out of the median; steady release decided in the waiting world, with its control); 3/3 mutants |
| scripts/host/test_canary_sched.py patched (`test_canary_sched.py.patch`) | 106/106 (93 + 13: tier-2 R10 waits on 2 and 3 exposure pools, launches on 4; a required pool off the list counts, one on it does not, placebo-c never; one exposure pool (exit 2) + 3 required launches, + 2 waits, untiered unchanged; tier 3 unchanged; unclassifiable tier blocks; `r10_wait_pages` decision; tier-2 wait flagged at 3 h and errored at 12 h, still not launched; untiered wait never errored; + 1 after round 3: an isolated-* required pool on its own); 75/75 mutants killed |
| scripts/test_drawrequire.py on the patched drawrec | 35/35 |
| scripts/test_threepool.py with the patched loop + drawrec | 163/163 (2 host-only skipped, as before) |

Reproduce: apply the three host patches to copies of the live files (md5s in section 1; they apply cleanly), then run
the suites as in the table; outputs are in `out/test_*.out`. The replay: `python3 replay_min4.py <host copy> <scan>
<host mcai-analysis copy> ../queue-speed-2026-10-23/patches` (`out/replay_min4.out`).

## 6. Install steps (if approved)

None of these files is in the gate bundle: the digest must read 635ad8d866a6e4a772351961bd5bd997 before and after.
**canary-loop.sh must never be replaced while a loop runs** (bash re-reads a running script by byte offset): install
only with no `canary-loop.sh` process — ironsmelt-01's loop is live now. Install all three files together (the loop's
count interlock refuses a tier-2 draw from a drawrec without the rule, so a partial install fails closed, not open).
1. Empty slot, no loop/drawrec process, no INSTALL-HOLD. `python3 ~/holdtoken.py claim <token> 60`; hold
   `flock -n /tmp/mcai-canary.lock` for the whole install. Record the gate digest. Re-check the live md5s (section 1).
2. Stage in `~/t2min4/stage/`: apply `drawrec.sh.patch` to ~/mcai-analysis/drawrec.sh, `canary-loop.sh.patch` to
   ~/canary-loop.sh, `canary-sched.py.patch` to ~/canary-sched.py; `patch --dry-run` first.
3. Run test_drawrec_tier2, test_loop_tier2 and test_canary_sched.py with `--mutants`, test_drawrequire, test_threepool,
   test_bagfix_loop and test_holdtoken (the host-only loop suites included).
4. Positive control on live inputs: the staged drawrec for the current head prints the installed one's lines (plus the
   `tier 2:` line for a tier-2 run); `canary-sched.py status` from the staged copy matches except an R10 line.
5. Back up (`*.bak-t2min4-<stamp>`), install by tmp+rename, re-read the digest, log to gate-installs.log and a draw-rules
   paragraph to RULES-IN-FORCE.md; release the lock and the hold. Rollback: restore ALL THREE backups together.
6. Land the installed files on main: scripts/host/canary-loop.sh and canary-sched.py (+ the test patch), and the
   installed drawrec.sh as scripts/host/drawrec.sh — BOTH repo drawrec copies already differ from live (pre-existing
   drift: scripts/host/drawrec.sh 986e18d2 and scripts/drawrec.sh e7d974a3, vs live d0d4d51c; neither is named
   canonical anywhere I found), which the commit should say and resolve.

## 7. Reviews

**Round 1 (commit ed4692e0): both REQUEST CHANGES.** Fixed in round 2:

| finding | by | fix |
|---|---|---|
| P1 poolescape-01's ">= 6.3 h" is a replay artefact (own deployment excluded the required pool before the pools were added back) | Codex, Claude | `eligible_waiting` removes the run's deployment first; regression test with a positive control; table and cost recomputed (3.3 h; net +17.2 -> +11.2 h) |
| P1/P2 "lower bounds", "net >=", "zero flips, all reasoned" overclaim; idle slot time absorbs waits | Codex, Claude | conditional estimates under stated A1/A2; changed draws vs changed verdicts separated; R3 gains labelled hypothetical; unknown runs named |
| P1 the tier-2 R10 wait was unbounded and W4 still said "two pools" | Codex | `r10_wait_pages`: "four" for tier 2, an error at 12 h with the remedies; tested past 12 h |
| P2 the 12-h limit is not a hard bound (hung drawrec; a late successful draw) | Codex | described exactly: a timeout on unsuccessful draws; a hung drawrec is paged at 3 h as today; a late draw of 4 deploys by policy |
| P2 auto-tier-3: the replace-variant + tier-3 redraw path needs no gate change | Codex | section 4 scoped to relabelling; the variant path described (Q2) |
| P2 the loop never checks the count | Claude | `refused-tier2-count` interlock + mutant |
| P3 tier classified on resume; unjournalled exit | Claude | classified in the draw phase only; `refused-tier2-tier` journalled |
| P3 loop and drawrec disagree on draw_k; > 4 required waits 12 h for nothing | Claude | one predicate (1 <= k < 4); `refused-tier2-pre` for both; tests for 0/False/True/4/5 and 5 required |
| P3 R10 ignores required pools; necessary-not-sufficient; tier-3 newly blockable; stale texts | Claude | required pools counted; wording; draw row and draw-short/page texts; section 1.3 |
| P3 test gaps (3 exposure pools; docstring; draw_k 4/5); §4 H3 wording; install lands nothing on main | Claude | "three" fixture + mutant; docstring; cases; §4 and §6 |

**Round 2 (commit aec18fb3): Claude APPROVE (P3s only); Codex REQUEST CHANGES (one P2).** Fixed in round 3:

| finding | by | fix |
|---|---|---|
| P2 R10's tier-2 union ran only on drawexposure exit 0; exit 2 (a valid read with < 2 exposure pools) waited forever even with 4 required + exposure pools | Codex | both exits handled; 1 + 3 required launches, 1 + 2 waits, untiered unchanged (tests + 2 mutants) |
| P3 a malformed draw_require_pools waits 12 h for nothing | Claude | `refused-tier2-pre` (test + mutant; untiered control) |
| P3 W4's 12-h error clock includes other waits between R10 waits | Claude | documented (section 1.3); the head was waiting either way |
| P3 only one drifted repo drawrec named | Claude | both named in section 6 |
| P3 R10 counts a never-drawable required pool | Claude | placebo-c / isolated-* not counted (test + mutant); brain-subset left to the loop's bound (necessary, not sufficient) |

**Round 3 (commit 7a8e7fe8): Codex APPROVE, Claude APPROVE** (Claude re-ran the loop, drawrec and scheduler suites
with mutants on copies rebuilt from the patches; Codex checked 360 in-memory R10 cases and patch-to-copy equivalence).
P3s only, handled after approval WITHOUT touching production code (the patched scheduler, loop and drawrec are
byte-identical to the approved round 3):

| P3 | by | handling |
|---|---|---|
| `isolated-*` has no test of its own; the mutant removed both exclusions at once | Codex | test-only: an `isolated-a` case, and the one mutant split into two (one per predicate) |
| the fail-closed block on an unclassifiable tier now also applies on drawexposure exit 2 | Claude | section 1.3 says so |

## 8. Questions for the owner

1. **Accept the cost?** In this replay, waiting for 4 cost about 11 h net of lane over 4.5 days (~2.5 h/day; conditional,
   first order, assumes a busy slot), for exactly-4-pool tier-2 reads, two reasoned +180 KEEPs and no tier-2 run on
   early-released short pools. *Recommendation:* install as designed (12-h bound). A shorter bound (e.g. 4 h) would have
   cut toolkit-03's 7.3 h but sends such runs back for re-registration by hand.
2. **The automatic tier-3 variant** (section 4: a short tier-2 draw swaps in a pre-approved tier-3 variant and redraws
   under tier-3 exclusions) — design and replay it?
3. **The R10 part:** install it with the rest (recommended: a structurally narrow tier-2 head then waits without holding
   the lock, with its own 12-h error page), or leave R10 at 2?
