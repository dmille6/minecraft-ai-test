# Code evaluation: tests-process (tests and the development process)

Read-only. Sources: origin/main `bd2c308f` (worktree `/Users/darrellmiller/Documents/.wt-eval-tests`), the canary journal and
queue on the canary host (copied 11-06 ~02:30Z), the autorebase job logs there, the 179 suite logs `~/ci/*.log` on ci2, git
history of all local refs. Window for the pipeline numbers: 10-28 08:00Z (fun mode) to 11-06 02:28Z = **210.5 h, 41 canaries**.
Codex's independent read: `codeeval/codex-tests-process.final.md` (raw: `codex-tests-process.out`).

## (a) Summary

1. A change takes a **median 18.6 h from its first commit to deploy and 21.8 h to fleet promotion** (n=34). The canary itself is
   3 h. The rest is waiting: the one slot, re-variants, and blocks that nobody clears. Main gets it a median 3.3 h later.
2. **46% of slot runs (19 of 41) were not protected code.** Fun mode sends tier 1/2 changes owner-direct with a 60-min check,
   but no code change has gone owner-direct since 10-28, so they all queue behind tier 3. Half the live queue is tier 1/2 too.
3. **The slot was idle 47 h of 210 h (22%)** in four long gaps: a stopped rollout's hold left in place, a refused hand-set patch,
   and overnight blocks. Turnover (autorebase after each promotion) cost another 31 h (median 47 min each time).
4. **The test signal is red by construction.** 121 of 152 complete ci2 runs (80%) fail on exactly the same 3 files, because
   suite-run ships a tree with no `.git`. Only 22 (14%) are green. craftsync and lavastep each flake in 12 of 152 runs (8%).
   15% of ci2 logs never finished. suite-run has a real pipe deadlock and no deadlines.
5. Verdict **PARTIAL**. Keep the runner, the mutants, the decider and the autorebase gate. Fix the tier-1/2 lane, the stall
   auto-remedies, the orphan manifest and the suite environment, in about 4-6 days of targeted work. Refactor the source-pinning
   tests one cluster at a time. No wholesale rewrite.

## (b) Findings, ranked by impact on "bots keep working / progress keeps moving"

| id | finding | evidence | impact (with denominators) | rec | effort | risk |
|---|---|---|---|---|---|---|
| T1 | **The tier 1/2 lane exists on paper only.** Non-protected changes use the one tier-3 canary slot. | Journal: 19/41 slot runs since 10-28 have variant `protected: False` (smeltgate, kitmulti, chestreach, tdoffer, tdfull, lidplank, promptcache, fleetbuild, tidy, drainpick, cooldown15-01/02, bagdiet, monustuck, dirtrung, llmoai, stuckproj, servea, qwen35). Last code `owner-direct` row is 10-23. The 11-05 rows are the model rollout. Pending queue: 10 `False`, 10 `True`, 9 unrecorded. PROCESS-fun-mode.md:7-17 says the scripts still enforce the old rules ("until W4 lands"). `rollout.py` has the ledger and the 60-min check, but no code-deploy action. | Slot time per run is about 3 h read plus 47 min turnover. 19 runs ≈ 72 h of 160 h slot use, about **8 h/day of tier-3 capacity**. The backlog is about 20 live entries at about 4.7 canaries/day, roughly 4 days. Tier-1/2 fixes could ship the same day instead of after a median 18.6 h. | **FIX**: add an owner-direct code rollout (`rollout.py deploy --tier 1|2`): it takes the deploy lock, refuses while a canary reads, runs deploy-fleet.sh with the pinned prev sha, then the existing 60-min check. `protected.py` routes changes. | M | med (the tripper, death breaker and 60-min check stay; a tier-2 change reaches all 80 bots at once) |
| T2 | **Slot stalls clear only when a human acts, and the alarm has no responder.** | Gaps: 11.9 h (10-29 21:31Z to 10-30 09:20Z, no journal rows), 7.8 h (10-31), 9.1 h (11-02 03:33Z to 12:30Z), **18.1 h** (11-04 23:51Z to 11-05 17:50Z). That last gap = servea rollout stopped 03:28Z but its install-hold held to 13:52Z (10.4 h), then the dropdig refusal "source range ... no longer has the queued diff" (a hand-set hash) from 13:55Z to the clear at 18:08Z (4.2 h). `canary-sched.py:1664` `page()` and `:1942` `ar_page()` only append to `~/digest/page.jsonl`. `haltwatch.py:21` says it plainly: "page.jsonl, which nothing pushes". slotwatch pushes at 60 min, then every 6 h, with no acknowledgement or escalation (ALARMS: 11-05 11:05Z NEW, 17:05Z STILL 420 min). The scheduler never retries (`:42`). | **47 h of 210 h idle (22%), about 5 h/day.** ALARMS.log has 587 lines in 3 days, and 230 of them are flowledger/goalwatch STILL/NEW, so the slot push is buried. | **FIX**: (1) automatic remedies for the mechanical blocks: an install-hold whose owner process and rollout are both finished is released; `set-patch` recomputes the hash, never hand-written; a refused job whose source range is a superseded variant is re-keyed. (2) Escalation: an unacknowledged slot block after 2 h goes to the owner's phone with a one-line remedy. | M | low (each remedy covers one narrow, verifiable state) |
| T3 | **Serial turnover after every promotion.** The next head is cherry-picked and fully re-tested only after the KEEP. | Promotion or teardown to the next deploy: median **47 min** (p25 39, p75 89, n=41). Autorebase jobs take 34-45 min (e.g. `dropdig-01--4a440a53.log` 21:10 to 21:46Z). KEEP rate since 10-28: 40/41. | **31 h of 210 h (15%).** | **FIX**: during the read, build the head speculatively on the canary sha. With a 98% KEEP rate the variant is ready at promotion; on REVERT, discard it. | S-M | low (the same identical-diff and suite gates) |
| T4 | **Autorebase refuses 58% of its jobs. Most refusals are mechanical, not defects.** | 19 job logs on the canary host: 8 built, 11 refused. Refusals: 3 "rebased diff is NOT the reviewed diff" (bagdiet ×2, stationkeep, whose diff includes `nothing-important-is-orphaned.test.mjs`), 1 bundle (the same member), 2 metadata (cooldown15-02 variant key; dropdig hand-set range), 5 tests. Of the 5: gather-reach (later loosened in e54d1cce: "count scales with host CPU"), plinth-skill (base 1/3), keepout, buildcorner+zigtidy2. `well.test.mjs` fails on the base in every alone run. | Each refusal is a human rebase plus a re-review plus a new variant: 182 variants across 42 deployed changes (median 2, mean 4.3; fleetbuild-01 32, apseal-01 23, promptcache-01 17). Each refusal blocks the head (T2). | **FIX**: exclude manifest-only hunks (orphan list, protected-paths additions) from the reviewed-diff hash. Quarantine known flakes (T6). Validate patch metadata at `queue set-patch` time. | S | low |
| T5 | **The orphan manifest is one shared list that every change edits.** | 126/576 non-merge commits on main since 10-28 (22%) touch `bots/test/nothing-important-is-orphaned.test.mjs`. New entries go at the top of `REQUIRED` (line ~33), so any two concurrent changes conflict. Both queued patches (dropdig-01, stuckproj-01) list it in `patch.files`. Merge commits say "the only conflict was the REQUIRED list ... union". Promotion to main lag: median 30 h before promomerge (10-28..11-01, n=23); median 3.3 h after it (n=15), but 3 of those 15 took >18 h (drainpick 24.2, dirtrung 23.1, llmoai 20.6). | 19-24 h promotion-to-main delays. Showcase restack conflicts (STATE: showcase "behind by 7"). Also feeds T4's reviewed-diff mismatch. | **FIX**: one manifest file per change (`config/required/<change>.txt`), read by the test. A new file adds a new file, never a shared hunk. Keep the untracked-files check and the mutant. | S | low |
| T6 | **The full suite is red on every run, so a real red means nothing.** | ci2: 152 complete runs. 22 all-pass (14%). 121 fail exactly `ceilescape`, `nothing-important-is-orphaned`, `protected-paths` (all `fatal: not a git repository`: suite-run tree mode ships no `.git`, documented as expected at `suite-run.py:28`). 9 broken-environment runs (>15 failures, e.g. `MODULE_NOT_FOUND`). Flakes across the 152: craftsync 12 (7.9%, "local (after unanswered)" vs "resync", timing), lavastep 12 (7.9%, already `SERIAL`, `run-tests.mjs:49`), towndeposit 6, craftsync-mutants 4. Reviewers write "ci2 392/395 known 3". | Every run needs a human comparison against a remembered list. Regressions in the 3 git-dependent tests are invisible on ci2. Flakes cause autorebase re-runs (budget 80 min, `canary-sched.py:166`) and refusals. | **FIX**: ship a git context (`git bundle` or `--ref` plus `.git`), or skip git-only checks with an explicit `SKIP (no git)` that counts as neither pass nor fail. Add a flake list in run-tests (name, signature, owner, expiry) that reports `FLAKY`, not `FAIL`. Fix or delete `well.test.mjs` (fails alone on the base every time). | S | low |
| T7 | **suite-run.py can deadlock and has no deadlines.** | `suite-run.py:95-101` writes the whole NUL file list into tar's stdin *before* `subprocess.run(ssh...)` starts reading tar's stdout. Once tar's stdout pipe fills, both sides block. The poll loop `:194` is `while True` and retries ssh failures forever. Prep and upload have no timeout. One commit ever (4527ffd3). ci2: 27 of 179 logs (15%) incomplete, 19 of them 0 bytes. | Runners hung up to 27 h on the Mac, unseen. An agent waiting on a suite waits forever. | **FIX**: start ssh first and feed tar from a thread (or write the list to a temp file and use `tar -T file`). Put a deadline on each stage. Emit a heartbeat and a final `DONE rc=` even on timeout. Add a regression test with a list bigger than 64 KB. | S | low |
| T8 | **Tests pin source text, so harmless edits break tests and force re-reviews.** | 184/416 test files (44%) assert on source text: 683 matching lines (`src.includes/match`, `assert.match(src…)`). Codex counts 236 (57%) by a broader proxy. 216 files carry mutants; 159 assert the anchor is unique (good). Commit 3a7badea moved production logic into a helper "behaviour unchanged" only to fit `dig-hand.test.mjs:150`'s 2,600-char window. 704acf91 re-anchored tests with "no composition defect". Tests are 100.6k lines against 81.9k of `bots/src`. | Hard to measure directly. Part of T4's test refusals, and why "a human rebase and a review" follows any nearby change. | **REFACTOR, one cluster at a time**: when a change touches a file whose tests pin decision text, convert those tests to exported pure functions (the CLAUDE.md rule already says so). Delete character-window asserts. Keep the structural greps (registered, wired, dangerous call absent). | M per cluster (L for the whole suite: don't) | med |
| T9 | **Branch, worktree and variant clutter.** | 962 local branches, 614 of them `-on-<base>` variants. 191 registered worktrees. `.claude/worktrees` is 9.1 GB. 17 `.wt-*` dirs in the main checkout. Each queue variant carries its own registration JSON plus an `approved` text (dropdig-01 has 3 variants, each re-stating the review). | Agent time to find "which branch is current"; disk on the Mac. Since 11-01, autorebase builds variants itself, so the hand-built ones are dead weight. | **DELETE**: prune worktrees and branches whose tip is reachable from main or from a closed run (dry-run list first). Stop pre-building variants by hand; keep one reviewed patch per change. | S | low |
| T10 | **Docs volume.** | 1,387 files under docs, 615 in `docs/reports`. +35.5k lines since 10-28 vs +22.9k in `bots/src`. 307 new doc files in 9 days (~34/day). (Codex measures 541k lines across all doc types; I count 78.5k in `.md`.) Review-round commits are down to 25% (146/577) from the 59-63% measured before fun mode. | Small direct effect on bots. Costs agents reading time and makes things hard to find. | **FIX** (policy): per-change reports become optional; the commit message carries the design (fun mode already says so). Monthly archive sweep. | S | low |
| T11 | **The same "run suite and triage" logic exists in three places, with uneven safety.** | `canary-sched.py` (3,558 lines: autorebase suite, re-runs, process-group timeouts `:2027`), `promomerge.py` (635 lines: its own triage `:135`, re-runs `:584`), `suite-run.py` (218 lines: no timeouts). The docs say a bundle holds 4 members; the code (`BUNDLE_MAX = 3`, `:167`) says 3. | Each fix lands in one copy (T7 exists because suite-run lacks the scheduler's timeouts). | **Partial REFACTOR**: one `lib/suite.py` (ship, run with deadlines, parse, triage flake/pre-existing/hard) used by all three. | M | med |

Not stalls, but worth noting: the 3 h generic read caught **1 of 41** (cooldown15-01 REVERT at +60). The read is cheap
insurance for tier 3. For tier 1/2 it is the main cost (T1).

## (c) Codex's independent findings and the reconciliation

Codex was given the area, the file list, the incident evidence and the 5 questions, but not my conclusions. Its ranked findings:
(1) queue stalls are detected but recovery needs a human, and `page()` pushes nothing; (2) the suite-run deadlock and no
deadlines; (3) the orphan manifest as a merge bottleneck; (4) the test environment manufactures failures, and lenient re-runs
weaken "pass"; (5) source-text coupling (251/416 read source, 236 text-match; the dig-hand window); (6) variants and duplicated
orchestration (1,957 refs, 755 `-on-`; 190 worktrees; the scheduler and promomerge duplicate triage); (7) docs and classification
cost, and doc-vs-code drift (bundle 4 vs 3). Verdict: **partial refactor**. Its main point: the delay is "blocked handoffs with no
guaranteed responder", not the 11-minute suite.

**Agree (independently found by both):** T2 (no responder; page.jsonl unread; manual-only recovery), T7 (same line, same
mechanism), T5 (the orphan list), T6 (the git-less tree makes the 3 base failures), T8 (text pinning, dig-hand window, 3a7badea),
T9/T11 (variants, duplicated triage, BUNDLE_MAX drift), T10, the KEEP list, and the partial-refactor verdict.

**Where we differ, and why:**
- **T1 (tier 1/2 through the canary slot) is my top finding. Codex does not raise it.** Codex read the process doc's tier
  table as how things work. The journal shows otherwise: 19/41 slot runs were non-protected, and there has been no code
  owner-direct rollout since 10-23. This is the biggest capacity lever, so I rank it first.
- **T3/T4 (turnover cost, and why autorebase refuses).** Codex read the code. I read the 19 job logs, which show 47-min serial
  turnover and that 6 of 11 refusals were mechanical (diff hash with the orphan hunk, hand-set metadata) rather than defects.
  Codex's "validate patch metadata at set-patch" matches part of T4.
- **The orphan-list fix.** Codex warns against a `merge=union` driver because it can resurrect deleted entries. I agree, and
  recommend per-change manifest files rather than the union driver. A resurrected required path would fail loudly (file
  missing), so the risk is small, but split files also stop the reviewed-diff mismatch in T4. A union driver alone would not.
- **Promomerge leniency** (accepts a file that passes alone once). Codex calls this a weakened "pass". I agree in principle
  but rank it low. Main is not what bots run: the fleet runs the canary sha, which passed autorebase's stricter 3-try rule.
- **Flake rates.** Codex said they could not be estimated from the incidents. I measured them from the 152 ci2 logs (T6).
- **Docs size.** Codex counts 541k lines (all file types); I count 78.5k (`.md`). Both count 1,387 files. The difference is
  JSON, HTML and other non-markdown files.

## (d) Top 3 to do first in this area

1. **Open the tier 1/2 owner-direct code lane (T1)** and route by `protected.py`. Each non-protected fix ships the same day:
   commit, one review, a green ci2 suite (12 min), owner-direct deploy with the 60-min check, promomerge. That frees about
   8 h/day of the slot for tier 3. (M)
2. **Make slot blocks heal themselves or reach a person (T2, T3, T4).** Release finished holds, compute patch hashes with
   `set-patch`, drop manifest hunks from the reviewed-diff hash, build the head speculatively during the read, escalate an
   unacknowledged block at 2 h. Expected: most of 47 h of idle slot plus about 30 h of turnover over 210 h becomes slot work
   (~4.7 to ~7 canaries/day). (M)
3. **Make green mean green (T5, T6, T7).** Per-change manifest files, a git context on ci2 (or an explicit SKIP), a flake list
   with an owner and expiry, and the suite-run deadlock and deadline fix. Removes the 19-24 h promotion-to-main conflicts and
   the "known 3" triage on every run. Codex ranks the suite-run fix as its quickest win. (S each, about 1.5 days together)

## (e) Refactor verdict: PARTIAL

- **Not a rewrite.** `run-tests.mjs` is sound: per-file processes, private TMPDIRs, slow-first ordering, the FAIL-line belt,
  and an evidenced SERIAL list. Anchored mutants (159 files assert uniqueness), behaviour and composition tests,
  `protected.py`'s fail-closed decider, autorebase's identical-diff plus suite gate (it caught real failures: keepout,
  buildcorner/zigtidy2), promomerge, one slot, the tripper and pinned rollback all earn their keep. Review overhead already
  fell from about 60% to 25% of commits under fun mode.
- **The stalls come from the process around the tests**: a missing lane (T1), blocks with no automatic remedy or responder
  (T2), serial rebuilds (T3), and a constantly red baseline (T6). Each has a targeted fix of S-M size.
- **Refactor only where duplication causes the defects**: one shared suite library (T11, M), and converting source-pinning
  tests one cluster at a time as changes touch them (T8). Do not attempt a suite-wide rewrite of 100k lines of tests.
