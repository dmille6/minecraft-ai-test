# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-23 12:35 UTC — **LIVE CANARY `banktruth-01` (9a6aa13) on placebo-d, hive-c, board-b,
board-c, declared 12:10:07Z. Fleet baseline `9b572aa+72e533`. Ledger 58 decisions.**
**It MUST be decided and torn down before 24 Sep 00:00Z. Reads at +30/+90/+180/+360 → final 18:10Z.**_

> **TWO COPIES OF THIS FILE EXIST.** The daily task reads `mcai-rl02/docs/reports/STATE.md` first and falls
> back to the repo copy. **If they disagree, take the later `_updated` stamp, not the documented order.**
> Today's report is in the REPO tree (branch `veto-feedback`): `status-report-2026-09-23.md`.

> **STATE.md IS STRUCTURALLY STALE BY ONE CANARY AND THAT IS NOT A BUG TO FIX BY TRYING HARDER.**
> Yesterday's file was written 12:01Z; shoreline-01 was read KEEP at 18:04Z and promoted at 18:14Z, and an
> evening session then did six commits of instrument work. None of it was in the file this session opened.
> **Read the JOURNAL and the LEDGER before trusting this file's canary section.** That is re-arm rule 4 and
> it has now earned its keep two days running.

---

## ⚠ LIVE CANARY — `banktruth-01`, MINE, deployed 12:10:07Z

- **sha `9a6aa13`**, pools **placebo-d, hive-c, board-b, board-c** (4 pools / 20 bots, the registered k=20
  draw, drawn at deploy). Half mix on offer `{5080: 3, 3090: 1}` — **record the half of each drawn pool as
  a read covariate.** Baseline `9b572aa`; descent verified by `fleet-deploy`.
- Version census after deploy: **9a6aa13 on exactly 20 bots**, 9b572aa elsewhere.
- Registration: `docs/reports/recovery-ladder-registration.md` (four sections, `banktruth-01`) and the
  machine copy `~/mcai-analysis/registrations/banktruth-01.json` = `docs/reports/banktruth-01-registration.json`.
- Reads **+30 / +90 / +180 / +360 → final 18:10:07Z**. Loop alive: `pgrep -af "canary-loop[.]sh"`.

### THE THREE THINGS THAT WILL BITE WHOEVER READS THIS

1. **`canary-loop.sh:73` CANNOT CLOSE A KEEP HERE.** It requires `promotion == "fleet-wide"`; this
   registration says `none`, so on KEEP it pages an error, exits 2, and **leaves the canary deployed**.
   That is correct — the program window forbids promotion — but it means **a KEEP is an open loop until
   closed by hand**: `check-open-loop.py --record` under sudo BEFORE touching the manifest, then the THREE
   teardown steps plus killing detached readers. REVERT and INCONCLUSIVE tear down on their own at line 79.
   **If the journal's last phase is a KEEP with no teardown, that is this, not a crash.**
2. **TEARDOWN IS MANDATORY TODAY WHATEVER IT READS.** The 24–27 Sep window opens at 00:00Z. A KEEP is
   promoted on **27 Sep**, not tonight.
3. **The manifest's `notes` carry a RETRACTED claim.** `fleet-deploy` copied the registration notes at
   12:10Z, before I corrected them at 12:12Z. The manifest says "THE BOT WAS CARRYING THE ITEM IN 2,078 OF
   THEM (100.0%) … is the positive control". **That framing is withdrawn** (see below). Read the notes in
   the registration JSON, not the manifest.

### The change, and the retraction that came with it

The deposit `no_effect` refusal said `nothing matching <item> to hand over` to a bot that was carrying the
item. Measured on `9b572aa`, 917,491 rows, **3,226 deposit runs / 54 bots / 24 h**, isolated excluded:
**2,079 runs end in that refusal**; `apple` alone is 1,494 of the 2,587 named runs; and **1,874 of the
2,079 (90.1%) are a bot re-proposing an item it has already been refused**, one of them 151 times in a day.
The refusal OUTCOME is correct — `bankable.mjs` is right about food, ballast and the 8-block scaffold
reserve. Only the reason was false.

**RETRACTED: "the bot held the item in 2,078 of 2,079 runs — 100.0%" is a tautology, not a measurement.**
`admission.mjs:326` refuses a named deposit with `deposit_item_missing` whenever the bot holds none, BEFORE
the skill runs, on both the model and work-order paths. Every named refusal reaching the skill holds the
item **by construction**, and the single `dirt` exception is a gate/skill race, not a positive control.
**The conclusion is stronger for it** — the sentence is false on *every* named fleet refusal — but do not
re-quote the 100%. It also makes the new `carrying no <item>` branch **unreachable from the fleet**
(chat-only, `commands.mjs:105`); its silence is not a finding.

### The read — and both endpoints that were thrown away

**PRIMARY, DECIDING, CALIBRATED: repeat refusals PER BOT-HOUR, DiD.** A refusal is
`skill.status == 'no_effect'` with a named `skill.args.item`; a repeat is the same `(bot, item)` again.

- **Draft 1 counted the prose** `nothing matching <item> to hand over` — a string **this change rewrites**,
  so it would have read **−100% in the canary arm from the wording alone.**
- **Draft 2 used a SHARE of deposit runs** — a denominator the treatment moves.
  `metric-must-not-condition-on-attempts`.

| null: 300 placebo draws, 4 pools/20 bots, pre 180/post 360, one version, 502,713 rows | share (withdrawn) | **rate (live)** |
|---|---|---|
| mean | +2.18 pp | **+0.006 /bot-h** |
| sd | 11.68 pp | 0.507 |
| p05 | −15.70 | **−0.885** |
| placebo dry runs crossing its own gate | **1 of 2** | **0 of 3** (−0.158, −0.484, −0.025) |

**GATE −0.885 repeats/bot-h**; ceiling **−1.446/bot-h** (1,874 / 1,296 bot-h). **The gate needs 61% of the
ceiling, so this read can only see a LARGE effect** — a half effect is honestly INCONCLUSIVE.
**EXPOSURE floor 60** on `newmsg_rows_canary` (detail begins `you are carrying`; the control build cannot
emit it). **WATCH, not deciding:** `deposit_runs_per_bh_canary_post` — the named way this makes things
worse is the model concluding it cannot bank at all.

**Inert check already answered** at +10 min: canary/post 8 new-sentence rows vs 1 old; control/post 0 new
vs 11 old; both pre-periods 0 new. Live, discriminating, 0 leaks.

**Objections registered BEFORE the read, so a good number cannot retire them quietly:** advice printed is
not advice taken (262 times on this fleet, never acted on); and the `RECENT EVENTS` frequency bias is a
cause this change cannot touch.

---

## Fleet
- **80 bots / 16 Peaceful worlds.** `9b572aa+72e533` baseline, `9a6aa13+4fa233` on the 20 canary bots.
- Ledger **58** decisions; last shoreline-01 KEEP 22 Sep 18:04Z, promoted 18:14Z. `main` = **9b572aa**,
  fast-forwarded; `origin/main-pre-2026-09-22b` = 842e017 kept. Both halves of the owner's rule honoured.
- 2 h digest: items/bot-h 23.9, decisions/bot-h 40.7, deaths 5 (0.031/bot-h).
- **4 of 80 pinned ≥ 4 h**: hive-a-Echo, hive-b-Comet (y=0), isolated-d-Alpha, isolated-d-Echo. All four
  show `path_no_legal_move` in the hundreds. Ops alarm, not a fleet mechanism — but also the program's
  immobile line, which fails.
- **keepInventory=true / doImmediateRespawn=true on every world.** Stays ON through the window; OFF
  fleet-wide after 27 Sep as its own registered program change, never a canary.

## THE GOLDEN LIBRARY WAS BEHIND, AND A DEPLOY WOULD HAVE DELETED THE VOCABULARY WORK — FIXED AND PROVEN
`~/mcai-analysis/lib` is what `fleet-deploy` copies over `/opt` after every deploy. It held `telemetry.py`
at **402 lines and no `vocabulary.py`**, while `/opt` had the overnight session's **540-line** copy plus
`vocabulary.py`. `main` carries a **279-line** copy. So the next deploy would have reset `/opt` to 279 and
copied 402 over it, deleting `count_class`, `WrongVocabulary` and the registry.
Golden updated from `/opt`, verified both ways (21,462 rows / 80 bots, typed classes live) — **and then
today's deploy proved it**: `analysis lib restored: telemetry.py / vocabulary.py`, `/opt` at 540 lines with
`count_class` present afterwards. **Queue item 11 is closed for the deploy path.** The durable form —
landing the library on the bots line — costs a fleet-wide deploy and is **held until after 27 Sep**.
- **Before patching anything under `/opt/.../lib`, diff it against `~/mcai-analysis/lib/` FIRST**, and now
  also check which way the difference runs. It was `/opt` that was ahead today.

## THE 24–27 SEP PROGRAM READ — opens 00:00Z TONIGHT
- **Rule 4 is SATISFIED.** `programread.py` reports `stock … items net into chests = 0.80/bot-h` against
  the ≥20 target, from inventory deltas, with the deposit *outcome rate* printed separately and labelled as
  **not** the program's stock number. Both denominators printed.
- **Rule 1: canaries MAY run inside the window** (10–20 of 80, read as DiD); **fleet-wide promotions may
  not.** If a promotion is unavoidable the window restarts. `banktruth-01` is out before it opens anyway.
- Rule 3: `keepInventory` stays ON. Rule 5: the read is the 72-h aggregate, not the best 24 h inside it.
- **Standing today on the five committed targets:** deaths 0.0071/bot-h **pass**; iron-pick share 15.3%
  **pass**; immobile 4–7% **FAIL** (≤2%); gather 21.7% **FAIL** (≥40%); stock **0.80 items/bot-h FAIL by
  25x** (≥20). The 18 Sep prediction was "three of five pass, gather fails, stock unresolved" — stock is
  now resolved and fails, so the forecast is heading for **two of five**, one worse than predicted.

## ACQUISITION WORKS, BANKING DOES NOT — the overnight finding that redirects the queue
From Minecraft's own `world/stats/<uuid>.json` (the SERVER's ledger, not telemetry the bots write about
themselves): **257,378 logs mined, 272,021 picked up, gap −5.7%.** There is **no fleet-scale retrieval
loss**; the sealed-cell hypothesis is not happening at scale. The fleet has mined a **quarter of a million
logs** while stock returned is 0.80 items/bot-h. That is why today's slot went to the deposit path, not wood.
- Caveat kept: `picked_up` also counts chest withdrawals and other bots' drops, so the gap **bounds**
  retrieval loss rather than measuring it. It cannot be read the other way: a negative gap cannot hide a
  large loss.
- Also overnight: RCON reaches **all 16 live worlds** (the old client hardcoded a different server), and
  **every world holds 20.00 TPS, 0.0% spread** — which kills per-world TPS as the explanation for the
  −45%/+77% six-hour swings. Not killed: max mspt varies 9.9–100.1 across worlds; a tail, not a rate.
- New instruments, all on `recovery-ladder-03`: `lib/coreprotect.py` (sandbox only), `lib/mcrcon.py`,
  `lib/vocabulary.py`, `worldhealth.py`, `botstats.py`, `instruments.py`, `monitor.py` (installed to
  `/home/mike/monitor`, **NOT** `/opt`, deliberately — `/opt` is reset by every deploy).

## Queue
1. **CLOSE `banktruth-01` TODAY.** Final read 18:10Z; decide, record, tear down before 00:00Z. See the
   three warnings above.
2. **The 24–27 Sep program read.** Registration committed (`0627ddc`). `programread.py 72` after the window.
3. **BANKING is the bottleneck, and the deposit path is where it lives.** Today's canary fixes the refusal's
   *honesty*, not its *rate*. The live outcome mix on 3,226 runs: `no_effect` 64.9%, `storage_full` 11.6%,
   `skill_error` 10.9%, **success 6.2%**, `container_open` 4.9%. After the message, the next real targets
   are `storage_full` (372 runs; the chest is 27 slots for 5 bots) and `skill_error` (352).
4. **falls-02 — HELD until after 27 Sep**, deliberately. Worktree `mcai-falls` (fc28885).
5. **NAVIGATION / GATHER.** `unreachable` is 2,179 (24.9%) and still larger than `no_safe_target`, with no
   `veto_faces`-grade instrument pointed at it. **That is the better-posed question.** Read any wood change
   on acquired wood, never on refusals avoided.
6. **The drifting-drop pickup.** `pickupNearbyItems` (`skills.mjs:1240`) snapshots the drop position once.
   `pickup-sweep` fixed a DIFFERENT bug. Two bugs; the branch name implies otherwise.
   **NOTE: the overnight server-side read bounds how big this can be — the retrieval gap is NEGATIVE.**
7. **owner-01c** — third attempt. Pre-flight landmine unchanged: `index.mjs:259` calls
   `runner.arb.installActuatorGate(...)` guarded only by `runner?.arb`, and that method does not exist
   outside `movement-owner-1`. Assert it exists and `bot.dig.__arbiterGated` is true before declaring.
   **ARBITER authorised for owner-01c only.**
8. **Land the analysis library on the bots line** so deployed shas carry it (the durable form of item 11).
   Costs a fleet-wide deploy → **after 27 Sep**.
9. **`keepInventory` OFF — after 27 Sep**, a registered program change, never a canary.
10. **Extend `drawexposure.py`** — non-degenerate pre-period. REPORT-only until calibrated.
11. **Teach the analyst the two-part OpenLoop test.** **TRAP: `pgrep -f canary-loop` SELF-MATCHES** — use
    `pgrep -af "canary-loop[.]sh"`. (I re-learned the general form today: a `pkill -f` whose pattern appears
    in my own SSH command line killed my own shell.)
12. **The death gate's invented control denominator** (`control_bot_h = canary_bot_h * 7`). Calibrate or
    amend to UNREADABLE; prospective, pinned by `test_verdict_acceptance.py`.
13. **`depositread.py:19` reads `sk.get('failClass')`** but the logger writes `fail_class`, so its failure
    buckets are always empty. Found today, not fixed. Pocket-rung block floor. Pooling rule −12 (iron).

## Rules in force (docs/reports/recovery-ladder-registration.md)
**v24** (an own-line value that is None, NaN or ±inf is UNREADABLE, not a failure) — LIVE. **v23** (no
single canary death reverts by ANY path; gates carry `role: deciding|tripwire`) — LIVE. v22 WITHDRAWN
unregistered. v12 linkage, v14c, v15c movement guards, v16 (**calibrate before revert**; histogram slot
order; bundles of two **disjoint** changes), v17/v18, v19 (a change/linkage row must DISCRIMINATE), **v21**
(death gate on the LOWER BOUND of the rate ratio), the owner's floor of **two** canary deaths, draws at
deploy (12-h ledger exclusions, ±25% then ±40%, the inference half an unadjusted covariate, never
placebo-c/isolated), `fleet-deploy` refuses a `--pool` sha not descending from `declared_code_version`,
`CANARY_ENV` + the `/proc/<pid>/environ` assertion, and `fleet-deploy --pool` refuses without a reader.
- **THE DRAW IS FOUR POOLS / 20 BOTS.** Null sd of the pool-mean ratio-DiD on items/bot-h is 0.313 at
  k=20/3 h vs 0.608 at k=5/3 h. `drawrec.sh` degrades 4 → 3 → 2 and says which.
  **CLAUDE.md still says "randomize five bots"; this is the registered change to it.**
- `~/digest/RULES-IN-FORCE.md` is **AUTHORITATIVE** and matches `scripts/host/RULES-IN-FORCE.md` by md5.
  `~/digest/RULE.md`'s header is stale (still names recovery-ladder-01 as live) — **COSMETIC**:
  `analyst.py` reads only from `## v14c` onward. Do not raise it as an alarm; fix it when RULE.md is touched.

## RETRACTIONS still in force
- **`banktruth-01`'s "2,078 of 2,079 = 100.0%" is a tautology** (above). New today.
- **The planted-effect positive control was an ARITHMETIC IDENTITY** (spread 7e-16 across f). Every
  "planted +30% → +30.0% ok" from `sweep/endpoints/candidates/halfdid/halfmix` is arithmetic, not evidence.
- **The inference half is NOT cleared as a confounder** (`llm.mjs:430`). UNADJUSTED covariate; the ±band STAYS.
- **"Time is not a design lever" is UNVERIFIED.** An operational breakage guard only, never a success criterion.
- **`leaf-01` is the counterexample to gating on mechanism and harm alone**: mechanism improved, deaths held,
  acquired wood collapsed −0.650 against a −0.5 gate.
- **The exhaustion mechanism for the wood gap is REFUTED by its own negative control**; the mobility framing
  that replaced it was **withdrawn as circular**. The non-circular halves: the filter refuses 76.4% worn vs
  33.1% fresh, and among runs that DID travel fresh is still 2x.
- **The sealed-cell retrieval-loss hypothesis is REFUTED at fleet scale** by the server's own ledger (above).

## Standing wake-ups
- **Before any canary read, check `~/digest/RULE.md` and `~/digest/RULES-IN-FORCE.md`** against
  `recovery-ladder-registration.md`.
- **Run `python3 scripts/test_verdict_acceptance.py` before and after touching the verdict path**, and
  `test_verdict_acceptance_mutants.py` OFF the bots host.
- **Nightly 00:12Z `~/programread.py 24` → `~/digest/programread.log`**; nightly 00:07Z iron-funnel.
  Last iron line: 19 raw iron / 23 ingots / 1 pick crafted, 2 gone, share 15.3%.
- Tier-1 local analyst every 30 min (`~/digest/*.verdict.json`); tier-0 digest `~/digest/latest.md`.
  `versions_ok=False` is the known build-suffix false-fail (`<sha>+<buildhash>`), not an alarm.
- `canarywatch.py` cron */10; `stuckwatch.py` cron :17/:47. `monitor.py` cron */10 on BOTH hosts →
  `/var/log/mcai-monitor/<role>.jsonl`.
- **The program read window is 24–27 Sep. Keep promotions and world changes out of it.**

## Known false alarm — the analyst pages OpenLoop for the whole life of every canary
`check-open-loop.py` reports OpenLoop whenever the manifest declares a canary with no decision, which is the
NORMAL state from deploy to verdict. The discriminating test is the **anchored**
`pgrep -af "canary-loop[.]sh"` **plus** the deadline.

## Apparatus notes learned today — read these before launching a loop
- **`fleet-deploy` finds the reader with `pgrep -f '^bash /home/mike/canary-loop.sh'`.** A copy at any other
  path — `/tmp/cl-run.sh`, even `/tmp/canary-loop.sh` — **fails the reader check and the deploy is REFUSED**.
  It cost two failed launches today. `canary-loop.sh` lives in `$HOME`, which no deploy resets, so running it
  in place is correct; CLAUDE.md's "run from a copy outside the repo" is about `deploy-fleet.sh`, which
  `git reset`s its own tree. Launch it as:
  `setsid bash /home/mike/canary-loop.sh <run_id> </dev/null > ~/canary-loop-<run_id>.out 2>&1 & disown`
- **The refusal is a good one and it worked**: nothing deployed on either failed attempt and the manifest
  stayed clean. Do not route around it with `READER_OK=1`.
- `scripts/depositread.py:19` reads `sk.get('failClass')`; the logger writes `fail_class`. Its failure
  buckets are silently always empty. Queue item 13.

## Telemetry row shape and walk discipline
- **`~/mcai-analysis/arm-read.sh` DOES NOT EXIST** despite older re-arm text naming it. The loop takes a read
  as `cd /opt/minecraft-ai/scripts && python3 /tmp/<read>.py <M>` then `python3 ~/verdict.py <run> <M>`.
- Rows are FLATTENED to `{bot, detail, name, raw, t}`. `r['bot']` is a **dict** (`.get('name')`), the event
  kind is `r['name']` (leading underscore for `logEvent` kinds), everything else under `r['raw']` —
  `raw.bot.tools` (the only place durability lives), `raw.bot.inventory`, `raw.bot.pos`, `raw.code.version`,
  `raw.skill.{status, fail_class, detail, args, duration_ms, inventory_delta}`.
  **A gather outcome is `skill.status` / `skill.fail_class`, NEVER a substring of `skill.detail`** — and
  today that rule earned its keep twice, since the change under test rewrites a detail string.
- **Full walks only**; `grep -a`; readers must include rotated `.gz` generations.
- **A single 97.5 h walk takes ~29 GB of the host's 46 GB — run wide walks ONE AT A TIME.** `WalkTooWide`
  prices one walk, not two, and the OOM killer does not say which.

## Standing constraints (verbatim from the owner)
- Full autonomy: deploy, canary, promote, tear down without waiting. Wake the owner on every promote or
  revert and on anything needing a human hand.
- No world changes to fix a bot (sandbox 10.0.0.30:25599-25602 only). Swimming is travel. No 192.168.19x
  network; no UniFi API on 10.0.0.1; never disable rpcbind; never touch the apt timer. One code canary at a
  time (a bundle of two **disjoint** changes counts as one). **Teardown is THREE steps plus killing the
  detached readers and clearing `~/MANUAL-READS-UNTIL`.** Deploy only via `~/bin/fleet-deploy`. Commit with
  `git commit -F -` heredocs — **and use a QUOTED heredoc over SSH too; an unquoted one ate backticks out of
  a registration today.** Two Codex passes per patch, then a smaller patch. Never share a live canary's
  inference endpoint/model; ARBITER OFF as the fleet default (authorised for owner-01c only). Never
  `git add -A bots` in a worktree with a node_modules symlink. Lab SSH `mike@10.0.0.31` (bots) /
  `mike@10.0.0.30` (worlds); key `~/.ssh/id_ed25519`. **Use `date -u` — do not estimate elapsed time from
  the flow of the work. I stamped three registration headings 90 minutes in the future today doing exactly
  that, and had to correct them.**
- Independent Claude **and** ChatGPT review, plus a real search of open source, before proposing to build —
  scoped to design changes, new research claims and deploy-impacting conclusions. **Today's pair earned it
  outright: one returned SHIP, the other four blocking findings, and one of those killed my headline.**

## Worktrees
**mcai-banktruth (deposit-truth-msg 9a6aa13 = THE LIVE CANARY)**, mcai-deposit (deposit-truth 73acd47 —
the LARGER deposit patch, refused by both engines; `docs/reports/deposit-truth-review-pass-2.md` lives
there and nowhere else), mcai-shore (9b572aa = now main), mcai-pickup (842e017), mcai-leafb (9fc3968),
mcai-anylog (7dd3775), mcai-digwatch (cfc1c58), mcai-falls (fc28885 — falls-02), mcai-owner (owner-01c
93f5b8f), mcai-deathsites (b1659c0), **mcai-rl02 (recovery-ladder-03 = docs/scripts branch)**,
mcai-scene (sandbox harness).
**The main repo checkout is on branch `veto-feedback`**, which does **NOT** contain the live sha —
**read live source with `git show 9b572aa:bots/src/<file>`, never the working tree.**
Scripts: `~/mcai-analysis` on this Mac and on .31; on .31 also `lib/` — the golden analysis library.

## Re-arm on a fresh session (monitors are session-local)
0. **A CANARY IS LIVE (`banktruth-01`) AND IT IS MINE.** If it is still up when you read this, it is
   **overdue** — its deadline was 24 Sep 00:00Z. Read the journal, take the final read, record, tear down.
1. **Loop pages AND journal phases**: Monitor tailing **both** `~/digest/page.jsonl` **and**
   `~/canary-journal.jsonl` on .31, filtered to
   `verdict|error|flag|PROMOTED|REVERT|deployed|torn-down|KEEP|INCONCLUSIVE|read-|recorded`, new lines only
   (`tail -n 0 -F`). **`page.jsonl` ALONE IS NOT A HEARTBEAT.** Neither file is complete — needsdrop-01's
   REVERT reached the LEDGER and neither. Treat silence as a reason to run the anchored pgrep.
   **Monitors expire in 5 minutes here regardless of the timeout asked for — re-arm, or check by hand.**
2. **Local analyst**: Monitor running `bash ~/analystwatch.sh` on .31. **DO NOT FILTER ON MESSAGE TEXT.**
   **IT IS AN ALARM, NOT A HEARTBEAT** — `analystflag.py` prints NOTHING when there is nothing to flag.
   **Confirm the analyst is alive from `ls -t ~/digest/*.verdict.json`, never from the monitor being quiet.**
3. **Death poll**: the loop runs `verdict.py <run> 0 --poll` every 5 min and pages on REVERT — **only if the
   loop is alive.** Verify with the anchored pgrep.
4. **If the loop is dead with a canary declared**: read the journal, take the reads by hand at their
   registered minutes, record with `check-open-loop.py --record` under sudo **BEFORE** touching the manifest,
   then tear down (THREE steps + kill detached readers + clear `~/MANUAL-READS-UNTIL`).
5. **After any deploy OR PROMOTION, check the analysis library survived** — note the CWD:
   `cd /opt/minecraft-ai && python3 -c "import sys; sys.path.insert(0,'/opt/minecraft-ai/scripts'); from lib.telemetry import Events; print(len(Events.load(since_minutes=30).rows))"`
   Expect ~18-19k rows / 80 bots over 30 min. Also assert `vocabulary.py` is present and `count_class`
   exists — that is the part a stale golden copy deletes silently.
6. **The seed canary is CLOSED.** No monitor, no further reads.
7. **RE-CENSUS THE LIVE VERSION BEFORE PUBLISHING ANY NUMBER.** Stamp every measurement with the sha it was
   taken on, as this file's readings are.
