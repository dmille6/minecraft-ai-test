# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-20 12:20 UTC — **NO LIVE CANARY. The slot is free and the ledger is clear.** cfc1c58 fleet-wide._

> **TWO COPIES OF THIS FILE EXIST AND THEY DIVERGED YESTERDAY.** The daily task reads
> `mcai-rl02/docs/reports/STATE.md` first and falls back to the repo copy; on 20 Sep the **repo copy was the
> newer one** (20:45Z vs 16:00Z) and the stale one named the wrong canary. Both are written together today.
> **If the two disagree, take the later `_updated` stamp, not the documented order.**

## Fleet
- 80 bots / 16 Peaceful worlds. **`cfc1c58` fleet-wide, ONE version on all 80 (`cfc1c58+e1d1b2`)**, verified
  11:30Z and again after promotion. `main` = cfc1c58. Previous mains: **main-pre-2026-09-20 (b1659c0)**,
  main-pre-2026-09-17 (1d6c97d), main-pre-2026-09-16b (08a3da2), main-pre-2026-09-16 (426058d).
- 11:30Z digest: one version, 80 bots, 2 deaths in 2 h (0.012/bot-h), 3 immobile, 7 zero-item bots in 2 h.
- **keepInventory=true and doImmediateRespawn=true on every world** (deliberate, place-town.py): deaths cost
  time, not items. Owner 18 Sep: it stays ON through the seed canary's 72 h, then goes OFF fleet-wide as its
  own registered program change (a world rule, never a canary) — queue item 7 moves it to after 27 Sep.

## No live code canary — the slot is FREE and the ledger is closed
`check-open-loop.py` clear at 11:26Z and after the promotion; `canary_pool` empty; no `canary-loop` process.
Last decisions: **digwatch-02 KEEP / PROMOTED** 20 Sep 11:26Z. **digwatch-01 INCONCLUSIVE** 19 Sep (v1 was
blind). **leaf-01 REVERT** 19 Sep 15:48:55Z. **owner-01b REVERT** 18 Sep 16:38:45Z.

## digwatch-02 (cfc1c58) — KEEP, PROMOTED FLEET-WIDE, and what it found
Closed by hand on 20 Sep: **the loop was dead and the canary had run 15 h against a 420-min deadline with no
read**. Full account in `status-report-2026-09-20.md`; the read itself is the registered +360 window.
- Death gate HELD (v21): 3 deaths / 60.0 bot-h (0.050/bh) vs 9 / 300.0 (0.030/bh), ratio 1.67x, lower bound
  0.39x < 1.25x. **Same 1.67x over the full 902 min** (5/150.7 vs 21/1054.7) — the registered window is not
  flattering it.
- **Hand-read passed**: 77 canary aborts -> 15 `_dig_collision` rows; control 825 aborts -> **0** rows.
- **THE FINDING: 15 of 15 collisions had a harvesting pickaxe in the bot's inventory while it held the wrong
  block.** 13/15 are `skills.mjs:169` `watchDigging` (`!b.canHarvest(heldItem)` -> `stopDigging`); 1 is
  `reflex.mjs:4601` (the concurrent digger, wrongly retired when v1 came back blind); 1 is `index.mjs:531`.
  This is the CLAUDE.md refusal-without-a-remedy class: **the remedy was in the pocket and the code aborted
  instead of equipping.** Accumulator: `~/mcai-analysis/collisions.py`. The recorder is now fleet-wide, so
  n grows 8x from here. **A fix is a BUILD CANDIDATE and has not been through review.**

## SEED CANARY — +24 h READ DONE ON BOTH POOLS, and it is the week's biggest number
Full read `seed-canary-24h-2026-09-20.md`; readers `~/mcai-analysis/seedread.py`, `seedtraj.py`, `seedfails.py`
(written 20 Sep — the registration had no standing script).
- **Gather success DiD +29.1 pp (placebo-a) and +30.1 pp (placebo-b)**; the pools read 41.6% and 43.1%
  against a fleet of 19-22% and a >=40% two-week gate. Two seeds, two pools, agreeing within 1 pp.
- **The +24 h read cannot attribute this to the seed** (registered reseed-plus-reset confound). But the shape
  test does not wait: fresh-start decays, terrain is flat. **Neither pool decays over 24-30 h; placebo-b
  rises** (+10.8 -> +30.0 pp). The short transient is ruled out, a multi-day one is not.
- **Stock is NOT a finding**: +13.6/+13.1 at 24 h but the trajectories disagree (a decays 23.5->4.5, b rises).
  **Iron-pickaxe share moves in opposite directions in the two pools — noise.** Deaths are under-powered at
  five bots in both.
- **Composition, per bot-hour** (reseeded vs control): SUCCESS 7.55 vs 3.41 (2.2x); **`no_safe_target` 1.19 vs
  3.85 (-69%)**; `unreachable` 3.15 vs 4.90 (-36%); **`no_path` 3.20 vs 2.71 (+18%)**; **`nothing_found` 1.82
  vs 0.99 (+84%)**. Attempts comparable (18.0 vs 16.7 terminal/bot-h). The fresh worlds are **not uniformly
  easier** — and the biggest single gain is a **safety refusal that queue item 3 explicitly excludes from its
  denominator.** See queue item 3, which this changes.
- **Remaining reads: placebo-a +48 h 21 Sep 00:00Z, +72 h 22 Sep 00:00Z; placebo-b +48 h 21 Sep 11:25Z,
  +72 h 22 Sep 11:25Z.** These are the registered discriminators. KEEP/REVERT do not apply (no code change).
  Both windows close clear of the 24-27 Sep program read.
- Sample caveat (amendment 19 Sep): the population is **seeds on which the town SITES** — flat, dry, low
  relief. 1 of the 2 seeds drawn hit the rejection. A later null is weaker than it looks.

## RETRACTIONS still in force — read before using any 19 Sep noise number
From `endpoint-noise-floor-2026-09-19.md`; Codex refuted four of five conclusions and a positive control.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f). Every
  "planted +30% -> +30.0% ok" from `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not evidence.
  Replacement `scripts/analysis/realcontrol2.py` must SCATTER (sd 0.303). **Its own v1 reproduced the same
  tautology.** Twice in one session a control was built from the quantity it was meant to test.
- **Concurrent canaries are NOT cancelled** — concurrency shrinks the CONTROL set, ~2% worse SD for twice the
  experiments. Kill that workstream on engineering cost if at all, never on the old argument.
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430` preserves preference order). Treat it
  as an UNADJUSTED covariate. The draw no longer holds it constant (`drawrec.sh:72`, changed 19 Sep 19:51Z);
  the ±band STAYS (it removes a -10% median bias).
- **"Time is not a design lever" is UNVERIFIED.** **`decisions/bot-hour` is not cooldown-pinned**, but its
  direction is ambiguous — an operational breakage guard only, never a success criterion.
- **`items/bot-hour` survives as very dispersed**: null sd 0.70 at one pool, 0.51 at two, 0.41 at four.
  Dropping ONE bot from a five-bot pool moves the estimate with sd 0.30.
- **leaf-01 is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed -0.650 against a -0.5 gate. Scored on "refusals avoided" it would have been
  promoted while making the fleet gather less. Next version, if any: admit leaf-covered logs only as
  FALLBACK, never as a peer of an open target — that experiment has run.

## Queue
1. ~~Seed canary~~ **+24 h DONE 20 Sep, both pools.** Remaining: 48 h and 72 h reads (times above).
2. **v23 suite — what remains**: make uncalibrated linkage WATCH-only (v19 already demoted rung-linkage;
   confirm no other uncalibrated path can revert), and **calibrate or amend the invented 7x control
   denominator** (item 16). The 16-case / 11-mutant suite itself is DONE.
3. **NAVIGATION / GATHER — the only failing committed metric. REFRAMED 20 Sep, read this before building.**
   The seed read says the largest single component recovered by a fresh world is **`no_safe_target`
   (-2.66/bot-h, -69%)**, which this item's own denominator excludes as "a safety refusal, not a reachability
   failure" — while `no_path` and `nothing_found` got WORSE on fresh terrain. The pathfinder framing
   (`mineflayer-pathfinder` issues #222/#273/PR #380) may be aimed at the smaller half. **Leading hypothesis:
   the bots excavate and flood their own surroundings, the safety check correctly refuses targets in it, and
   that is the collapse.** Exposure is not the constraint: navigation-class failures run ~7.6/bot-h.
   **Needs the registered dual review before a build is proposed.**
4. **NEW — the watchDigging equip remedy.** 13/15 recorded dig collisions are `skills.mjs:169` aborting a dig
   because the held item cannot harvest, with a pickaxe in the inventory. Remedy: equip rather than abort.
   The recorder is fleet-wide now, so n grows before anything ships. **Dual review first.**
5. **owner-01c — the movement owner, third attempt.** Never failed a guard; failed the apparatus twice.
   Needs item 2 and a draw with headroom on the primary endpoint (item 8). **ARBITER is authorised** (owner
   18 Sep) — do not re-ask.
6. **DROWNING — demoted.** Do the one-hour read of the interrupt tax before spending a slot (the air reflex
   once aborted 9.8% of every run; nobody has recomputed it). Deaths cost 0.04% of bot-h. The health floor is
   **"not at full health", NOT "below 5"**. `floatDigTargets()` returns `[]` without a pathfinder plan, so the
   remedy is new code. Endpoint: reached and sustained breathable space within a fixed horizon per eligible
   episode; pre-register the MDE. **Do not bundle the floor with the dig.**
7. **falls-02 — the falls instrument FLEET-WIDE.** Behaviour-inert, needs no slot. 7 fall deaths at
   23/31/31/36/40/40/42 blocks of 48, ~0.0036/bot-h. Worktree `mcai-falls` (fc28885), rebase onto cfc1c58.
8. **`keepInventory` OFF — after 27 Sep.**
9. **Extend `drawexposure.py` — two checks, NOT a new script.** (a) a non-degenerate pre-period on the
   primary metric (owner-01b drew 0.0% and printed `+nan% FAIL`); (b) exposure against the MDE-implied n.
   REPORT-only until calibrated against draws whose outcome is known (-13b, -13c, 1011b).
10. **Concurrent canaries (owner-approved, build it).** Step 1 done: `canary_split_ok` / `in_canary_pool`
    consolidated into `scripts/lib/version_split.py` (20 new tests, 5 mutants dead) on `recovery-ladder-03`.
    **It does NOT ride along with a deploy** — `deploy-fleet.sh:126` installs the tripper at the deployed sha,
    so it must be merged into the branch actually deployed. Remaining per `concurrent-canaries-design.md` §5:
    N-canary classifier (pools pairwise disjoint, versions pairwise distinct, N<=3), per-run canary trees,
    per-run loop locks with a manifest mutex, readers.
11. Pocket-rung block floor (need+4 with 5 held). **12.** Pooling rule -12 (iron).
13. ~~Delete exptest.json~~ **DONE 20 Sep.**
14. **Teach the analyst the two-part OpenLoop test** (`pgrep -f canary-loop` AND the deadline). Today the
    deadline half fired correctly and alone; the slot is free, so editing its rule is safe now.
15. **CLAUDE.md's byte-offset rule is under-scoped** — it names `deploy-fleet.sh`; the hazard is any
    long-running shell script edited in place. Run them from a copy.
16. **The death gate's invented control denominator**: `control_bot_h = canary_bot_h * 7` when control reports
    no rate, reverting on 3 deaths against an assumed 0. Calibrate or amend to UNREADABLE; prospective,
    pinned by `test_verdict_acceptance.py`.
17. **Keep RULE.md and RULES-IN-FORCE.md synced on every rule change** — two `scp`s, part of step D.
    Verified current 20 Sep (both md5-match their sources).
18. **NEW, and it cost 15 fleet-hours — a hand deploy leaves no loop.** `fleet-deploy` does not start
    `canary-loop.sh`. digwatch-02 was deployed at 20:09:38Z with no loop attached and sat unread until the
    next session. Either `fleet-deploy --pool` starts the loop, or it refuses to declare a canary without one.

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24** (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE. **v23** (no single
canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE in the verdict path. v22
WITHDRAWN unregistered. v12 linkage, v14c, v15c movement guards (calibrated 2% false-revert / 97% detection),
v16 (calibrate before revert; trace refusals to fallbacks; histogram slot order; bundles of two disjoint
changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE — `changerowcheck.py` pre-deploy,
`license_change_rows()` at read time), **v21** (the death gate on the LOWER BOUND of the rate ratio), the
owner's floor of **two** canary deaths, draws at deploy (12-h ledger exclusions, ±25% then ±40%, the inference
half now an unadjusted covariate, never placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not
descending from `declared_code_version`, `CANARY_ENV` + the `/proc/<pid>/environ` assertion so a flagged
canary cannot ship inert.

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md` are current** against
  `recovery-ladder-registration.md` and the paragraph above. Both verified current 20 Sep by md5.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` OFF the bots host (`/home/mike/mcai-analysis` shadows a mutated helper).
- **Nightly 00:12Z `~/programread.py 24` -> `~/digest/programread.log`** (stock line and throughput line;
  splits by `code.version`, and that split is NOT a canary read).
- Nightly 00:07Z iron-funnel (`~/digest/ironfunnel.log`). Last fleet line: 73 raw iron / 92 ingots / 10 picks
  crafted, 14 gone, iron-pick share 15.3%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.
  `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- **Declare the two-week program read window: 72 h continuous, 24-27 Sep**, and keep promotions out of it.
  The two-week gate is 27 Sep. **STILL NOT REGISTERED — do it before 24 Sep.** Note in the registration that
  the two re-seeded pools are a world-level confound whose 72 h closes 22 Sep, so they are clear.
- **Seed-canary reads: placebo-a +48 h 21 Sep 00:00Z, +72 h 22 Sep 00:00Z; placebo-b +48 h 21 Sep 11:25Z,
  +72 h 22 Sep 11:25Z.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is `pgrep -f canary-loop` **plus** the deadline:
OpenLoop with no loop running, or past `deadline_min`, is real. **On 20 Sep it was real** — the deadline half
fired at 11:00Z and was right. Queue item 14 builds the other half.

## Daily session rotation
- Desktop task `mcai-daily-session` starts a FRESH session at 06:08 America/Chicago (11:08 UTC). It reads this
  file first, closes any open canary (**check the ledger AND the journal AND `pgrep -f canary-loop` before
  acting**), re-arms below, does the queue, rewrites this file to BOTH copies.
- `check-open-loop.py` lives at **`/opt/minecraft-ai/scripts/check-open-loop.py` on .31** and needs sudo. It
  is NOT in `~/mcai-analysis`.
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`, where
  the read scripts clamp `W = min(elapsed, M)` — so a missed read can be taken late at its registered minute.

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or revert
  and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599 only; the seed canary is the registered exception —
  the world IS the treatment). Swimming is travel. No 192.168.19x network; no UniFi API on 10.0.0.1; never
  disable rpcbind; never touch the apt timer. One code canary at a time (a bundle counts as one) until the
  concurrent-canary build lands. Teardown is THREE steps. Deploy only via `~/bin/fleet-deploy`. Commit with
  `git commit -F -` heredocs. Two Codex passes per patch, then a smaller patch. Never share a live canary's
  inference endpoint/model; ARBITER stays OFF as the fleet default (authorised for owner-01c only). Never
  `git add -A bots` in a worktree with a node_modules symlink. Readers include rotated `.gz` generations.
  logEvent kinds carry a leading underscore in `skill.name`. Lab SSH `mike@10.0.0.31` (bots) /
  `mike@10.0.0.30` (worlds); the lab key on the mini is `~/.ssh/id_ed25519`. Status reports live in
  docs/reports. Use `date -u` for clock labels.
- Independent Claude **and** ChatGPT review, plus a real search of open source, issues and forums, before
  proposing to build — scoped to design changes, new research claims and deploy-impacting conclusions.
- **And one the repo should adopt:** run any long-running shell script from a copy outside the tree you may
  edit. CLAUDE.md says this of `deploy-fleet.sh`; bash re-reads by byte offset for all of them.

## Worktrees
`mcai-digwatch` (dig-collision, cfc1c58 = NOW MAIN), mcai-owner (movement-owner-1, aa44514 — reverted twice,
rebase for owner-01c), mcai-falls (falls-path-log, fc28885 — rebase for falls-02), mcai-owner-f (3b9ff25,
unused), mcai-deathsites (b1659c0 = old main), **mcai-rl02 (recovery-ladder-03 = docs/scripts branch)**,
mcai-recovery (iron tools; pooling NOT started), mcai-rllava, mcai-rliron, mcai-rl10, mcai-canopy, mcai-scene
(sandbox harness).
Scripts: `~/mcai-analysis` on this Mac (reads, reseed journals). On .31 `~/mcai-analysis` holds drawrec.sh,
changerowcheck.py, drawexposure.py, deathgate.py, singledeath.py, collisions.py, **seedread.py / seedtraj.py /
seedfails.py (new 20 Sep)**, registrations, and **`lib/` — the golden analysis library restored after every
deploy**. The nightly/host instruments are vendored in the repo at `scripts/host/`.

## Re-arm on a fresh session (monitors are session-local)
0. **No code canary is live, so items 1-4 do not apply today.** They apply the moment one is deployed.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and
   `~/canary-journal.jsonl`** on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|phase`, **new lines only**
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT** — the loop pages decisions and errors only, so
   a quiet watch is indistinguishable from a dead loop. The journal is the heartbeat. Treat silence as a
   reason to `pgrep -f canary-loop`.
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER IT ON MESSAGE TEXT** —
   a filter added 18 Sep suppressed a verdict carrying `page_claude: True`. ~20 lines over a canary's life is
   cheaper than one suppressed alarm. Triage by hand.
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT, so monitor 1
   covers it — **only if the loop is actually alive.** Verify with `pgrep`, do not assume.
4. **If the loop is dead with a canary declared** (this happened 20 Sep): read `~/canary-journal.jsonl`, take
   the reads by hand at their registered minutes (see "Daily session rotation" above for the exact commands),
   record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest, then promote
   (`~/bin/fleet-deploy <sha> <run>-promote "..."`, which itself tears down the drop-ins and rewrites the
   manifest) or tear down (THREE steps: `sudo /usr/local/sbin/mcai-canary-tree teardown`; clear `canary_pool`
   and `canary_code_version`; restart the pool's bots 12 s apart; confirm exactly one version is live).
5. **After any deploy, check the analysis library survived** —
   `python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   on .31. `fleet-deploy` restores it; a deploy by any other path will not.
6. **The seed canary needs no monitor** — its reads are calendar items and the telemetry walk is
   retrospective, so a missed read is recoverable. Use `~/mcai-analysis/seedread.py <pool> <hours>`.
