# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-28 12:06Z — **CANARY LIVE: `toolkeeper-01` on `4320136`, pools placebo-a, placebo-b,
board-d, board-c (20 bots), declared 12:02:07Z.** Baseline `80b3bbd+8b910b` on the other 60. Exactly two
versions verified live at 12:05Z (60/20). `canary-loop.sh toolkeeper-01` is running on 10.0.0.31 and
does the reads, the verdict, the record and the teardown itself._

> **THIS FILE ALSO EXISTS ON `main`.** `bots/test/nothing-important-is-orphaned.test.mjs` asserts it
> stays there. If the two copies disagree, take the later `_updated` stamp.


> **CORRECTION 2026-09-28 12:09Z, by a second operator session — read before trusting the canary section below.**
> Three INSTRUMENT defects in `toolkeeper-01` survived the pre-launch reviews and the 12:02Z launch. All
> fixed before the first read (+360 at 18:02Z); recorded as amendment 5 in the registration itself.
> 1. **`immobiledid` was not in `reads`.** `verdict.py:401` refuses without it — it carries the DEATH GATE,
>    the v15c movement guards and the readability test. So from 12:02Z to 12:10Z the canary had **no safety
>    floor**, and every read would have returned UNREADABLE: the 28-hour run could never have reached a
>    verdict. "Harm gates are unchanged" in the launch report was not true of this registration.
> 2. **`change_rows`/`linkage_extra` had a leading underscore.** `verdict.py:411-412` store them verbatim and
>    `:458-459` compare `lstrip('_')` names, so the single-death linkage path could never match. Now bare.
> 3. **The loop runs reads from `/tmp`, and `/tmp/toolkeepread.py` was the PRE-FIX read** (md5 `c74099ae`,
>    the Infinity-dropping parse both reviews flagged). The fixed read existed only in `~/mcai-analysis`.
>    `/tmp` now holds `45b41e0e`, identical to the committed copy.
> 4. *(12:15Z, amendment 6, REPORT-ONLY)* `bad_keeps` checks the keep row, which is logged BEFORE the
>    transfer — the plan, not the result. The read now also checks the OUTCOME: the deposit skill row that
>    spans the keep event is snapshotted after the chest closes, so `survivor_lost` says whether the kept
>    copy is still in the inventory and `copies_after` whether the banks happened. Not gated (never seen on
>    fleet data); `unmatched` is printed, never read as a pass. All three copies are now md5 `1504158a`.
> The loop was stopped (whole process group — a `sleep` child holds the flock) and restarted; it resumed
> from phase `deployed` with the manifest, pools and `declared_at` unchanged. Backups:
> `registrations/toolkeeper-01.json.bak-20260928T120549Z`, `/tmp/toolkeepread.py.bak-20260928T120549Z`.
> **If you restart this loop or re-stage its reads, stage from `~/mcai-analysis`, not from memory.**

---

## THE LIVE CANARY — toolkeeper-01

> **+360 READ, 18:04Z — verdict.py NOT_YET (correct: the verdict is at +1560, 2026-09-29 14:02Z).**
> - LIVENESS pass: 138 canary keep rows (gate >= 12), 0 in control. CORRECTNESS pass: 0 bad keeps, 0 unparsed.
> - EXPOSURE: 46 canary / 85 control deposit successes (gate >= 20 each) — already met.
> - HARM clean: 1 canary death (placebo-a-Echo 12:17, "unknown; idle" — the TDZ crash re-count, not linked)
>   vs control 4; 0.008 vs 0.017/bh. Immobile +1.4 pp canary vs +0.6 pp control; all v15c guards within.
> - OUTCOME (reported): 138 of 138 kept copies survived; only **20 of 138** ended at one copy — banking still
>   mostly blocked by full chests. 140 `_deposit_cursor_rescue` rows, **140 returned, 0 lost**, every one
>   "destination full" (logs 59, sticks 44, planks 16, cobble 16, iron_ingot 2). The control build has no
>   rescue: the same full-chest failure there leaves the lifted stack on the cursor at close.
> - Median best pickaxe uses: canary 1 -> 59, control 2 -> 4. **Not a result** — the pre-registered null
>   for this metric spans -24..+130 and a dry run with no code change gave 59.0.
> - Nothing to decide until +1560. Expected there: KEEP on correctness/liveness/harm, effect INERT-by-storage.

> **READ THIS BEFORE THE +360 READ (found 13:15Z by the new outcome check, amendment 6).** The keeper is
> CORRECT and mostly INERT. At +69 min: 59 canary keep rows, 0 bad keeps, 59 of 59 kept copies survived —
> but only **2 of 59** actually banked anything; the other 57 still held the same 2-6 copies afterwards.
> Checked with a second instrument (the bot's NEXT skill row, not the deposit's own snapshot): same answer.
> **Why: the chests are full.** Of the 62 deposits carrying a keep event, 51 ended "the chest is full; could
> not make another chest", 9 used a second chest and banked no tool, 2 banked one. Tools rank LAST in the
> deposit order, so logs/sticks/cobble take the last free slots and the tool loop exits at `dest == null`
> — silently: that branch logs nothing, and the keep row is written before it (and again per chest tried).
> So: liveness and correctness will pass; the effect will read near-null **because storage is saturated,
> not because keeping is wrong.** Do not record "keeper doesn't work". The upstream problem is the bank:
> write-only (124,894 in, 48/day out) and now full, which is what `withdraw-home` starts to address.

| | |
|---|---|
| sha | `4320136` on branch `tool-keeper-2` = `80b3bbd` + 2 commits (the keeper + today's slot fix) |
| pools | placebo-a, placebo-b, board-d, board-c — drawn by `drawrec.sh` at deploy (4 pools = 20 bots) |
| declared | 2026-09-28T12:02:07Z |
| read +360 | **2026-09-28 18:02Z** — correctness + liveness (`keep_rows_canary >= 12`, `bad_keeps == 0`) |
| read +1560 | **2026-09-29 14:02Z** — the verdict (exposure: 20 deposit successes in EACH arm) |
| deadline | 2026-09-29 16:02Z (1680 min) |
| registration | `~/mcai-analysis/registrations/toolkeeper-01.json` = `docs/reports/toolkeeper-01-registration.json` (6 amendments: 1-4 before launch; 5 = the instrument fixes above; 6 = the report-only outcome check. No gate moved after data) |
| read | `~/mcai-analysis/toolkeepread.py` = `docs/reports/toolkeeper-01-read.py.txt` |
| promotion | `none` — a KEEP is recorded and torn down, not promoted |

**What can decide it.** `bad_keeps > 0` is the ONLY line that reverts on its own (`evidence: defect`).
`keep_rows_canary < 12`, `keep_rows_control > 0`, `keep_unparsed > 0` and `deposit_success_control < 20`
BLOCK KEEP and never revert. Harm is unchanged: two-death floor and gather_ratio < 0.43. `primary`
(share of bots above toolfor's 10-use floor, diff-DiD) is advisory, and its quoted null was measured
for ONE 5-bot pool, so at 20 bots it overstates the noise.

**If you are the next session and the loop has died:** `pgrep -f '^bash /home/mike/canary-loop.sh'`.
If absent and no decision is recorded, restart it with
`setsid nohup bash ~/canary-loop.sh toolkeeper-01 >> ~/digest/canary-loop-toolkeeper-01.log 2>&1 < /dev/null &`
— it resumes from the journal and skips the deploy because the manifest already names the sha.

## WHAT TODAY FOUND BEFORE LAUNCH — the canary as built last night would have lied

Last night's `904cedb` was "built, tested, pushed". Both independent reviews (Claude, Codex) said
DO NOT LAUNCH, for the same reason, and the sandbox proved it:

- **The keeper moved the wrong slots.** It ranked copies from `bot.inventory.items()` (slots 9–44) and
  handed those numbers to `bot.moveSlotItem`, which clicks the OPEN CHEST window (player range 27–62).
  **Sandbox, real Paper server, same stage, positive control first:** `904cedb` logged
  `keep=slot38 bank=slot37,slot39`, reported `deposited 74 items`, and **zero pickaxes reached the
  chest.** The fix (`toolCopiesInWindow`: read `chest.items()`, window-numbered and live) banked
  exactly the damage-130 and damage-100 copies and kept the 129-use one.
- **The only test of the call was a source-grep that asserted the bug was present.** Replaced with a
  behaviour test on a real prismarine-windows chest window plus a positive control.
- **The correctness gate could not revert.** Under verdict.py v25 an own_line with no `evidence` class
  only blocks KEEP. All three lines lacked one, so a wrong keep could never have reverted it.
- **The parse was blind** to `Infinity` uses, to a partially-parsed bank list, and to 300-char
  truncation (Codex reproduced a truncated wrong row reading `ok`). Now all are `unparsed` and block
  KEEP, with a self-test of known-bad rows that runs before any fleet row is read.
- **The dedupe did nothing** (`id()` across separate loads). Now a content key over every row.
- **The registration's pool story was fiction:** it described a sha256 draw of hive-a + board-c;
  nothing enforces that — the loop draws with `drawrec.sh`.
- **The branch was not descended from the fleet sha** (built on `8f1cedb`, the pre-merge pin), so
  `fleet-deploy` refused it. Cherry-picked onto `80b3bbd`; bots/src trees verified identical.
- **Dry runs of the read wrote into the live reads dir** under the manifest's run_id. Two files moved to
  `~/digest/reads-dryrun/`; the read no longer emits under `CANARY_DRYRUN`.

## FOUND IN PASSING — the death-handler crash: BUILT, reviewed, waiting for the canary slot
**`index.mjs` read `cause` five lines above `const cause = freshDeathCause()`** (TDZ, from `8f1e037`, 09-17).
Corrected by a full measurement at 12:40Z — the earlier "1 hit in 7 days" was a 4-bot sample:
- **It crashes the process.** Journal: `ReferenceError ... index.mjs:1002:94`, exit 1, systemd restart.
  **17 crashes across 15 bots in 36 h** (placebo-a-Echo at 12:17Z is on the live canary).
- **Live on the fleet since 09-27, not 09-17:** 8f1e037 first shipped in `859af48`. `after falling` death
  rows: 6-45/day on every build through `efa2853`, **0 of 60** on 859af48 and later.
- Trigger: any death **more than 3 blocks below the recent peak** — a fall, or drowning/lava after a descent.
- **The death gate was NOT blind.** 17 of 17 crashes are followed ~11 s later by a `_death` row
  "unknown; idle at the moment of death" — the restarted bot rejoins dead and dies again on a path that does
  not throw. The COUNT survived; cause, fall distance and death site did not. So toolkeeper-01's harm gate
  is intact, and a canary of the fix does not change the death count, only its label.
- **What DID go blind: `infra/guard/death-tripper.py`** (fall-class only). When the fix ships it will see
  fall deaths again after two days of seeing none. Expect it to be noisy; do not read that as the fix
  causing falls — compare against the 6-45/day baseline above.

**Fix: branch `fall-death-tdz` = `80b3bbd` + `7311029` + `1d107ed`.** Declaration moved above the read;
`hpTrail` cleared after the death record (a ring that spanned lives, which the restart hid).
`test/no-tdz.test.mjs` runs ESLint `no-use-before-define` over `src/`, found exactly this site, failed
before the fix; it is a regression guard, not a TDZ proof (both reviews listed what it misses). 204/204.
Reviewed by Claude and Codex: both CONFIRM the fix; they disagreed on the gate (Codex: blind; Claude:
re-counted as unknown) and the host settled it for Claude, 17 of 17. Not deployed: one canary at a time.
**Sandbox-passed 13:52Z** (Paper 1.21.11, a 17-block drop onto glass, same arena both runs): control `80b3bbd`
throws `ReferenceError: Cannot access 'cause' before initialization`, no `_death` row; candidate `1d107ed`
writes "fell from a high place after falling 17 blocks … hp 20->0 over 13s". The candidate also logged an
"unknown; idle" death on connect — it rejoined still dead from the control run, which is the fleet's
re-count mechanism reproduced.

## FLEET
| | |
|---|---|
| baseline | `80b3bbd+8b910b`, 60 bots |
| canary | `4320136`, 20 bots (above) |
| `main` | `1261b89` (+ today's docs commit); bots/src identical to the baseline |
| fresh worlds | `hive-c` `board-b` `hive-d` `placebo-d` — reseeded 2026-09-27; `draw-exclude.txt` holds them out of draws until 2026-09-30 ~13:00-14:05Z |
| analyst | 11:00Z verdict: fleet healthy, versions ok, one control death (board-b-Delta drowned, idle) |
| iron funnel (24 h) | raw iron 41, ingots 51, iron pickaxes crafted 2 — unchanged story |

## LOOP STATE
- `check-open-loop.py` (at `/opt/minecraft-ai/scripts/check-open-loop.py`, run with sudo) said
  "no open canary" at 11:15Z. It will name toolkeeper-01 as open until the loop records a decision.
- **While toolkeeper-01 is unread, no new analysis starts** (CLAUDE.md). Build work for the NEXT slot
  (the TDZ fix) is fine; deploying it is not.

## RE-ARM ON A FRESH SESSION
1. `date -u`; read this file; `grep toolkeeper-01 ~/canary-journal.jsonl` on 10.0.0.31.
2. Confirm the loop is alive (above). If a decision is recorded, confirm teardown (exactly ONE version
   live) and write it up; wake the owner on any REVERT.
3. Monitor, emit-on-change only:
   `ssh mike@10.0.0.31 'tail -n0 -F ~/canary-journal.jsonl ~/digest/page.jsonl' | grep --line-buffered -E 'toolkeeper|error|REVERT|KEEP|UNREADABLE'`
4. After 18:02Z: read `~/digest/reads/toolkeeper-01-toolkeepread-360.json` — keep_rows_canary, bad_keeps,
   keep_unparsed. After 2026-09-29 14:02Z: the verdict.

## OWNER CALLS WAITING (unchanged from 09-27)
1. ~~The 24–27 Sep program window~~ **DECIDED 2026-09-28 22:10Z: ABANDONED; fleet-wide promotion is allowed.**
2. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
3. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect.
4. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
5. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## BANK SATURATION — OWNER DECISION 2026-09-28 20:30Z, design settled, not built
Owner: one admin clear of the full town chests is allowed (a bug caused it), never as a recurring
practice; code must stop the refill; bots may build as many chests as they need.
Two code causes, measured: (1) `cobblestone`/`cobbled_deepslate`/`stone` are STANDING_TARGETS, banked
without limit (42% of the bank); (2) the full-chest recovery always CRAFTS a chest — 70 of 79 full-chest
failures (12 h) were HOLDING one, only 5 had the logs to craft.
Design after the Claude review (Codex hit its usage limit — resets 2026-10-03 15:17; the second review
is owed before this deploys):
- A: full chest + a non-bulk item left to bank -> place a CARRIED chest/trapped_chest/barrel and retry;
  craft only if none carried; if only bulk remains, `no_effect` "bulk capped", build nothing.
- B: cobble family out of STANDING_TARGETS; banked only while the open container holds < 64 of it.
- C (toss excess) DROPPED: the exit contract needs ~148 scaffold at y=-55, pickupNearbyItems re-collects
  drops within 8 blocks, and a shared chest would recycle them. A pickup-skip is a later, separate idea.
- D: the one clear runs after A+B are KEPT — bulk only, slot-by-slot RCON read before and after, shown
  to the owner first.
- Found in passing: `craft` passes `count` to bot.craft as REPETITIONS; a bot with 2-7 logs crafting a
  chest crafts twice and throws. Separate fix.
- Order: toolkeeper-01 verdict -> fall-death-tdz -> withdraw-home -> bank fix, built on whatever is then
  deployed (it edits the same deposit loop as tool-keeper-2).
- **FINAL DESIGNS after the Claude review (owner: Claude-only for these two), 21:30Z. Build each on the
  sha deployed at its turn.** The review REJECTED both as first specified; the fixes are below.
  BANK FIX:
  - A: place a CARRIED chest/trapped_chest (NOT a barrel: a barrel on a town chest's lid blocks it and the
    next deposit digs it off, spilling it), never on top of a container; craft one only if none carried.
    Only a VALUABLE item (metal/gem list + DEPOSIT_ALWAYS, no tools) may trigger A.
  - B tiers judged per ITEM against the live window (re-read before each item): useful (logs/planks/
    sticks) <= 128 each while < 75% occupied; bulk (cobble family, dirt, gravel, andesite/diorite/granite/
    tuff) <= 64 while < 50%. Before returning "capped", try the other chests within 24 blocks.
  - THE LOOP (probe: 128 cobble + 40 logs = bankable 104, deposit due): remove bulk/useful from the
    bankable count used by the prompt's CARRYING line (prompt.mjs:602), deposit admission
    (admission.mjs:337) and the deposit_surplus milestone (milestones.mjs:729), or bots loop
    deposit -> no_effect. depositDue's 30-slot trigger stays.
  - A SINK: above 3 stacks of bulk carried, bank it into any chest with room regardless of tier.
  - Tools: keep tool-keeper-2's behaviour; tools <= toolfor's absolute FLOOR (10 uses, not 10%) bank as bulk.
  - withdraw with no item named skips bulk. MEASURE before building: occupied slots and bulk slots per bot.
  - Read: a post-close per-deposit row from the WINDOW's before/after counts (not the plan); bulk & useful
    banked per bot-h DiD; RCON slot-by-slot read of the canary town's chests at start and end; harm adds
    full-inventory bots, deposit repeat loops, deposit_surplus skips, raw_iron per iron_ore mined.
    A fires ~1-5 times per canary, so A must pass the SANDBOX first.
  CRAFT LIMITS (admission.mjs craft block ~:414, LLM proposals only — work orders pass the same check()
  and need a source flag; craft()'s internal recursion and deposit's chest craft bypass the gate):
  - stations: refuse when one is carried; remedy "craft what you need — craft places the table you carry".
  - axe/shovel/hoe/sword: refuse when a same-kind copy of that tier or better is > 25%.
  - PICKAXES: refuse only when same-tier-or-better pickaxe uses total >= 150 (the y=-55 exit contract) and
    canContinueDescent at y-1 is not short on pickaxe. A flat 25% rule is a DEAD END (probe: y=-50, 70 uses
    left vs 144 needed -> exit contract refuses mine for 'pickaxe', its remedy is craft, the rule refuses
    the craft) and caps depth, which is where the iron is.
  - refusals never reach learned_avoid (cognitive.mjs:812-860) but three in a row trip the livelock escape
    (:977) and count toward the milestone skip (:1002) — read both as harm.
  - Read: ~50 refusal rows expected on a 20-bot canary / 26 h, 0 in control; gate = 0 rows refusing a copy
    <= 25% or a bot short on pickaxe uses; harm = mine 'pickaxe' refusals, livelock escapes, skips (DiD).
- **CODEX REVIEW of both designs, 23:00Z (second engine, back online) — amendments to build from:**
  BANK FIX: split TRANSFER eligibility from the DEMAND count (prompt.mjs:602, admission.mjs:335,
  milestones.mjs:729) — bankableInventory mixes them. depositDue's >=30-slot trigger still yields
  full -> deposit -> capped -> repeat: add a capacity-exhausted state with an executable remedy and
  milestone handling (4 spare tools also keep deposit_surplus open). DROP the "3 stacks -> any chest" sink
  (it refills the valuable chests and re-triggers expansion); a sink may bank only EXCESS over a
  depth-dependent reserve (exit-contract.mjs:145-162), never the 8-scaffold default. deposit returns after
  ANY transfer (skills.mjs:2274) before the alternate-container recovery (2335-2357): A must check what
  valuable is still unbanked after a partial success, and a capped attempt must reach the alternate
  search. No-container-under-target on EVERY placement candidate path (3195-3228). FLOOR tools: only
  SURPLUS copies count as bulk.
  CRAFT LIMITS: admission allows count up to 64 and execution treats count as REPETITIONS
  (admission.mjs:421-423, skills.mjs:2918) — limit the admitted batch / projected holdings, and fix the
  count-vs-repetition bug FIRST. Station remedy is per type (craft places tables :2723, smelt places
  furnaces :3946); do not reuse STATION_ITEMS (includes chest/barrel). Pickaxe rule must REUSE
  exit-contract's accounting (it discounts every copy by one swing, :79-86) and compute the requirement
  independently — the contract checks health/scaffold before pickaxe, so `reason !== 'pickaxe'` proves
  nothing; include depths below -55. Canary must measure completed crafts, holdings, descent/mining,
  escapes and skips — refusal rows only show the gate ran; "any copy <= 25%" is the wrong failure test.


## TWO-ENGINE DATA CHECK, 2026-09-28 ~00:05Z (owner: "use both engines to analyze data, don't make assumptions")
Both engines re-derived the numbers from a 21h55m export (7,996 craft/deposit rows, 80 bots; NOT 24 h, and 340
rows are from older 268c074). Agreed and CONFIRMED: full-chest failures 125, 105 holding a chest (the recovery
at skills.mjs:2350 always crafts); redundant crafts tables 73/169, stone_pickaxe 70-72/221, wooden 27-30/142,
furnace 5/50, ~97% llm:idle; craft-count fix `ef9c549` (branch craft-count) correct, no caller passes
repetitions, nothing parses "crafted Nx".
**CORRECTIONS to my claims:** (1) ef9c549's commit says fleet impact ~0 — WRONG: the bug bites inside the
recursive resolver, 49 failures on 28 bots in ~22 h (one log, a sub-craft asks for 3-4 repetitions, makes 4
planks, throws); ~25 of them would succeed with the fix. It rides with the bank fix. (2) wood at full-chest
failures: counting BEFORE the deposit (inventory - inventory_delta), 54/125 had >=2 logs, not ~5 — inventories
at 34-36 of 36 slots are the likelier constraint (the resolver drops the sub-craft reason, skills.mjs:2743).
**NEW, both engines:** placing a chest already fails 64x/22 h on 20 bots ("placing exceeded Nms") — bank fix A
needs a sandbox pass against that; the model sends craft's quantity as `blocks` (3,434 of 3,801 rows), which
craft() ignores; 993 of 1,895 no-effect deposits are about apples. **BIGGER LEVER:** 1,604 stone_pickaxe
failures on 69 bots told "gather cobbled_deepslate first" (alphabetical rootGap, skills.mjs ~2759), 1,602 at
y >= 0 holding zero stone — ~10x the craft-limit target. Both engines are now analysing the whole
stone-pickaxe funnel (advice vs worn pickaxes at toolfor FLOOR vs reachability) before anything is built.

## QUEUE (after toolkeeper-01 closes)
- **OWNER 2026-09-29: SHORT CANARY FOR FIXES.** Reads +180/+360, extension until exposure (540/720/1080/1560),
  deadline 1680; KEEP possible from +360 when correctness, harm and exposure are clean. A "fix" = a deterministic
  correctness gate (licence row/text only the fix writes + a positive control) + sandbox + both engines. Safety
  unchanged. deathfix-01 amended to it before launch (exposure_ready = a canary fall death AND a control crash;
  read md5 5cae9332 staged in /tmp and ~/mcai-analysis). Apply the same shape to last-swing, hygiene, withdraw.
- **TECH-TREE REVIEW 2026-09-28 (both engines, data + code + upstream source):** `docs/reports/tech-tree-review-2026-09-28.md`.
  After last-swing the wall is IRON (usable stone pick 45 bots -> raw_iron 22-25; buried ore; the mine escalation
  drops the ore's x/z at skills.mjs:1734-1741). Queue additions, each its own canary after the current queue:
  (1) directed 1x2 tunnel to buried ore (GITM design; nobody upstream solves buried ore), (2) hold iron <3 out of
  the bank (inside the bank fix), (3) durability-aware ladder, (4) end the idle gap (skipCount never resets),
  (5) shared recipe/capability predicates (milestones.mjs:376 counts andesite etc. as cobble).
  **OWNER APPROVED all five into the queue, 2026-09-28.**
- **2nd IN LINE (after deathfix-01): `last-swing` (`b1c978e`, from 80b3bbd) — THE BIGGEST LEVER FOUND.** Both
  engines, independently, ~22 h of data: 92% of 3,393 failed stone/cobble gathers had every pickaxe at 1 use;
  61 of 80 bots in that trap (67.6% of bot-time); toolFor's HARD_STOP sent a bare hand at stone. Gather may now
  spend a last use when nothing else can harvest (collectManually only; travel and exit contract unchanged).
  SANDBOX PASSED: control "Digging aborted" + deepslate advice; candidate 3x `_last_swing`, "collected 3
  cobblestone", "crafted 1x stone_pickaxe". 204/204, 3 mutants. Implementation review by both engines running.
  The deepslate advice (skills.mjs:2663 recipe tie, not the sort) is cosmetic per both engines.
  **Both implementation reviews done; changes applied in `b1c978e`:** stone family only,
  equip_failed instead of a bare-hand dig, `_last_swing` logged after the confirmed break with a snapshot.
  Sandbox re-passed. CANARY READ (both reviews): PRIMARY = per-bot binary, share of bots TRAPPED AT LAUNCH
  (every pickaxe at 1 use) that hold a pickaxe with > 1 use within T h, DiD vs control bots trapped at launch;
  SECONDARY = stone_pickaxe crafted per bot-h DiD (baseline ~0.125) and inventory-backed cobble yield;
  REPORT per `_last_swing`: stone-family share, cobble gained, _tool_broke ~1:1 (a rise is expected — NOT a
  harm gate). STRATIFY by sticks held (a bot short of 2 sticks gains cobble but cannot craft) and by
  tool-keeper exposure. Tripwires: two-death floor, entombment/stuck-rescue failures, bots with zero pickaxes
  > X min, mine refusals (should not move).
- **3rd IN LINE (after last-swing, BEFORE withdraw-home): `inventory-hygiene` phase 1** (branch head, on last-swing).
  OWNER 09-29: "stop bots from collecting and keeping junk". Both engines: median 35/36 slots, 25/80 full; a full
  bot's gather 4.8% vs 52.2% with room (same bot+block). Tossing was REJECTED (sandbox: stacks back in 11-90 s;
  owner: any pile is picked up by the next bot). Phase 1 drops nothing: pickup never chases ballast; `wear_out`
  (work order at 34+ slots, chatOnly) breaks spent tools by one dig each on a safe natural block. Both engines'
  implementation reviews applied; sandbox passed (36 -> 32 slots, stays). withdraw-home needs the room, hence
  the order. Canary read (both reviews): DiD on snapshot slots, share at >=34/36, items/bot-h, spent copies held,
  NEVER_KEEP over time; tripwires: a destroyed copy with 2+ uses, fall/air/death within 30 s of a wear_out,
  sapling drops near one, wear_out share of decisions, milestone_skipped rate; controls on last-swing.
  PHASE 2 (not built): pile-free disposal of stackable ballast (burial) — both reviews set the bar.
- Queued, separate (pre-existing, Claude review): toolFor spends an iron pickaxe inside its FLOOR reserve on
  stone while a 1-use lower-tier copy exists (`reserved_required`).
- **NEXT CANARY IS STAGED: `deathfix-01`** (sha `1d107ed`, promotion **fleet-wide** — owner abandoned the 24-27 Sep
  window and approved fleet-wide promotion, 22:10Z). Registration
  `~/mcai-analysis/registrations/deathfix-01.json` = `docs/reports/deathfix-01-registration.json`; read
  `deathfixread` at `~/mcai-analysis/` and `/tmp/` (md5 `17045b95`) = `docs/reports/deathfix-01-read.py.txt`.
  licencecheck and changerowcheck PASS on the live baseline (text 'after falling': 0 of 8 baseline _death rows).
  Dry run over 24 h on a baseline pseudo-canary: canary crashes 3, control 9, re-count rows 3 and 9 — the
  correctness gate fires on unfixed code, as it must. **Launch only after toolkeeper-01's teardown is
  confirmed** (one canary, ever): `cd ~ && setsid bash ~/canary-loop.sh deathfix-01 </dev/null >
  ~/canary-loop-deathfix-01.out 2>&1 &`, then kill nothing but confirm with pgrep + the journal.
- **OWNER 21:00Z: QUEUED — bank fix with TIERED chest limits, then CRAFT LIMITS; Claude-only review for
  these two** (Codex was out; it is back as of 22:10Z, so both engines review these after all). Order: fall-death-tdz -> withdraw-home ->
  bank fix (A: place carried chest; B: tiers) -> craft limits. The one chest clear after the bank fix KEEPs.
- **TDZ death-handler fix** — BUILT on `fall-death-tdz` (`1d107ed`), reviewed; the next canary. Watch death-tripper.
- **withdraw walk-home** — BUILT, REVIEWED, SANDBOX-PASSED on `withdraw-home` (`353d89e`, from `80b3bbd`).
  Both engines' implementation reviews found real defects (unverified success, late windows, double chests,
  a `no_path` vote, the `#output` exemption bypassing the repeat guard, two tests passing for the wrong
  reason); all fixed in `8abcf60`, `#output` deliberately REMOVED. The sandbox then caught one more the fakes
  hid (the verification read a slot prismarine had already rewritten) — fixed in `353d89e`. Sandbox, same
  arena: candidate takes the 129-use pickaxe from the second chest, verified server-side; control `80b3bbd`
  fails "no stone_pickaxe in the chest". 17 mutants killed, 204/204. Homing not exercised in the sandbox.
  **Denominator: ~0.45 withdraws/bot-day** (18 in 12 h / 80 bots), so a 20-bot canary sees ~10 in 26 h:
  readable for "does the skill work", not the endpoint. The lever after it is getting the model to ASK —
  `craft` failed `missing_ingredients` 1,292 times in the same 12 h.
- Re-read the planting cohort against the twelve controls: does planting change the DEPLETION CURVE?
- `gather` logs what it collected but not WHERE — one new EVENT with a coordinate (ELK is `dynamic:strict`).
- Merge the two `place-town.py` copies (host has discovery + mid-reseed patch; repo has `probe.py`
  handling). Until merged, run the HOST copy.
- `PLANT_RESERVE = 8` is per species → oak-only planting.
- `place` declares only `args: ['item']` → one `learned_avoid` key for all saplings. Measured, not fixed.
- `skills.mjs` `.sort()` alphabetical → 1,415/day told to gather `cobbled_deepslate`. UNBUILT.
- `container_open` 446/4,160 uncharacterised; consolidate the two schedule guards in `verdict.py`.
- **Uncommitted in this worktree, not mine, left alone:** `bots/scripts/check-movement-writers.mjs`
  (modified), `bots/test/movement-ratchet.test.mjs` and four `external-*`/`instrumentation-audit`
  reports (untracked). Someone should decide whether they land.

## WORKTREES touched today
- `tool-keeper-2` (the live canary) — `$SCRATCH/wt-tk2` of session 223836c1; also on origin.
- `tool-keeper` (904cedb → e71e6a1, superseded, not descended from the fleet) — on origin; do not deploy.
- `wt-old` (detached 904cedb, sandbox control only) — disposable.
