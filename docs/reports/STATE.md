# STATE — the operator's state file (a fresh session starts from THIS, not from the handoff history)
_updated 2026-09-29 (owner decisions recorded; night work: see QUEUE 'NIGHT 2026-09-29'; the canary block below is from 09-28 and still live) — **CANARY LIVE: `toolkeeper-01` on `4320136`, pools placebo-a, placebo-b,
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
- **NIGHT 2026-09-29 (autonomous, owner asleep; both engines):**
  - **GHOST BLOCKS — PROVEN, a fleet-wide defect.** A dig Paper rejects leaves the client holding AIR over
    server STONE, permanently. mineflayer's finishDigging writes air on its own timer; there is no rollback,
    and Paper re-sends nothing. RCON showed stone where the stalled bot saw air, twice. Global dig
    instrumentation linked the stall cell to the ONE unconfirmed dig. Bare-client probes:
    - A too-far dig: no packet, a permanent ghost.
    - An early finish: confirmed at ~0.9 s (Paper's delayed destroy).
    - ABORT: an ack only, no resync.
    collectManually's `dig_unconfirmed` (skills.mjs:1225-1250) assumes a re-send, so it is BLIND to these.
    **CAUSE #1 FOUND:** mineflayer never sends `player_loaded` (1.21.4+), so Paper DROPS every dig for ~3 s
    after each join and respawn. A bare client showed it twice: a dig at +300 ms was not acked and not
    broken; with the packet, the same dig broke in ~30 ms. The entombment reflex digs in that window.
    **BUILT: `dig-rollback` @ `0f228ec`** (from 80b3bbd). Both engines rejected the timer design and
    recommended the vanilla protocol instead:
    - one increasing sequence; each STOP records the block it overwrites;
    - on the ack, settle on the server's word (block_change / multi_block_change), else restore the prior
      block; a 5 s backstop;
    - `player_loaded` on every spawn;
    - collectManually waits for settlement;
    - a `_dig_sync` heartbeat with totals.
    Both implementation reviews applied (never-throwing wrapper, no seq wrap, the version checked at spawn,
    the delayed-destroy grace, the denominator). 18 tests, 13 mutants killed, 204/204.
    REAL SERVER: control 3 refused digs -> 3 ghosts; candidate -> 0 ghosts (restored at the ack in 45 ms;
    the early dig broken).
    **Canary staged:** `digsync-01` registration + read (docs/reports), dry-run on the fleet (positive
    control 78 `_reflex_stuck` rows). Correctness gate; the effect is reported only (a -0.31/bot-h swing on
    an unchanged pool in 2.5 h).
    Memory: ghost-blocks-are-rejected-digs.
  - **A/B on the ghost-making harness** (rejoin inside the arena + a mid-dig tp; the arms alternated): tunnel
    only reached the ore 4 of 7 (3 stalled at y 116-117, the ghost signature; not RCON-verified per run);
    tunnel + digsync 7 of 7, with 26/26 digs server-confirmed per run and player_loaded sent once per spawn.
    Small n (one-sided Fisher p ~0.1); it agrees with the mechanism proof. Combined branch
    `tmp-tunnel-digsync` (local only).
  - **Ore tunnel committed: `ore-tunnel` @ `a63b93d`** (both reviews' findings fixed; 6/6 buried, gravel, water,
    worn pickaxe OK; lava wall = the existing collectblock "collect threw nothing", a known limitation).
    `oretunnel-01` registration + read staged (a capability canary: the outcome line gates KEEP; the draw
    requires >= 10 iron gather rows because hive-c made 6 against 255 in control). It needs digsync on the
    fleet first.
  - **IDLE GAP BUILT: `idle-gap` @ `f3bff3d`** (from 80b3bbd; owner-approved tech-tree item 4). Both engines
    analysed 24 h of fleet data first: idle is 25.3% of decisions; 51% of the attempts behind a skip were
    admission REJECTIONS; skipCount never reset (69% of entries at the 6 h cap).
    - Only an executed, serving outcome counts (servesRung: item rules + verb map + detours by their own
      wants).
    - A genuine completion resets skipCount (a no-means bypass does not).
    - A 45-min no-progress deadline (persisted) is the exit; it is never reported to peers.
    - Both implementation reviews applied:
      - Claude: 22% of "serving failures" were runner refusals (paused/busy) -> excluded; detours are judged
        by their own wants; withdraw/deepslate; a 10-min restart grace.
      - Codex REJECTED the exit claim with a counterexample (a rung held 6.6 h) -> an absolute 3 h residence
        bound; rung identity; the no-chest bypass is not a completion.
    - Head `45e152d`: 19 tests, 15 anchored mutants killed, 204/204; the sandbox smoke is clean.
    - `idlegap-01` registration + read staged (text licence 'serving'; correctness = the residence bound
      holds; the effect is reported only: the idle share swung +0.28 DiD on an unchanged pool in 2.4 h).
  - **HIVE PROGRESS FIXED: `hive-progress` @ `f2d447b`** (the side defect above). A shared store lost every
    hive bot's milestone history on restart and re-saved a stale slot.
    - Both engines reviewed it: Claude AGREE+2 (a version marker so the old build's frozen slot loads empty;
      progress in the load log); Codex CHANGE (layout guessing fooled 3 ways -> an explicit keyed slotOf +
      a migration of the legacy flat fields).
    - 10 tests (the restart test FAILS on 80b3bbd), 8 mutants killed, 204/204; merged onto idle-gap 205/205.
    - Canary: HIVE pools only; hive-c/d held out to 09-30 -> hive-a vs hive-b, effect INCONCLUSIVE, but
      correctness (restored progress non-empty after a 2nd restart, from the new load-log fields) is
      readable. A registration is not written yet.
  - **DROPPED ITEMS -> STALE STOP, BUILT: `stale-stop` @ `1eface8`** (from 80b3bbd). Both engines measured it:
    - 13,275 pickup drops were retired unreached in 6 h (27.5/bot-h, 73/80 bots);
    - 12.8% of gathers were barren (dug, drop left on the floor; mostly logs and dirt).
    Root cause (Claude; verified in the pathfinder source): `stop()` only sets a flag, and our cleanup did
    setGoal(null) THEN stop(), so the NEXT goto died instantly (>= 1,261 skips have that signature). The
    stuck reflex and the dig watcher did it too.
    - Both implementation reviews applied:
      - Claude: the dig-watcher gap around a direct dig; err= logged 'Error'.
      - Codex: the first draft's stop()->setGoal made pathfinder re-centre the bot mid-air -> haltPath is
        setGoal(null) alone; leg listeners removed.
    - 8 real-pathfinder tests, mutants killed, 204/204.
    - **`stalestop-01` staged**: licence err= (0 of 13,867 baseline rows); correctness = instant
      PathStopped deaths <= 1% of enriched rows.
    - The first two drafts of this read would have passed UNCHANGED code (the between-pool share, then a
      vacuous zero); both caught by dry runs.
    - Not in it (later design): a pickup goal matching the real pickup range; a dig-out for pocket drops.
  - **OWNER DECISIONS 2026-09-29 (morning):**
    (1) the queue order below is APPROVED; each change keeps its own canary (bundling the small fixes was
        asked, not answered -- not assumed);
    (2) withdraw-home is BUNDLED with the bank fix;
    (3) the mayor path is approved: chest ledger -> shadow-mode mayor, once the queue has moved.
  - **CHEST LEDGER BUILT: `chest-ledger` @ `e43f384`** (on withdraw-home; owner-approved colony step 1).
    - Observe-only: one JSON snapshot per container per pool; nothing reads it yet.
    - Both engines designed it and both reviewed the implementation:
      - Claude: a pairing test that could not fail -> literal; stale records -> superseded/replaced
        tombstones; the predicted close overwrote the server's contents -> server_snapshot kept.
      - Codex REJECT as-is: disk work on the critical path -> deferred; exception holes -> airtight;
        cross-dimension tombstones -> scoped; a regex bypass test -> syntax-aware (espree).
    - 15 tests, mutants killed, 205/205.
    - REAL SERVER, three runs: the ledger matches RCON entry by entry for a double chest (one record, both
      halves) and a single chest after a deposit + a withdraw.
    - Positive control: an RCON change -> MISMATCH (the first comparator was truncated by the server and
      read MATCH).
    - Ships in the withdraw-home + bank-fix bundle.
    - Before step 2 reads it, revisit (Codex): newer-wins races, mtime eviction, ambiguous 54-slot records.
  - **DAY 2026-09-29 (owner: "analyze, find, fix, implement, deploy") -- fleet triage by both engines**
    (24 h, 60 bots on 80b3bbd):
    - **PREREQ-USABLE: `prereq-usable` @ `db3c461`** (on last-swing). 88.4% of pickaxe prerequisites
      were counted met by SPENT pickaxes (57 bots; 4 bots sealed all day, 96 bot-h).
      - The fix: a digging tool counts only above toolfor's floor.
      - Escape asks now request TWO (the reserve rule refuses on one: a closed loop, found by Claude).
      - `_prereq_usable_filtered` row.
      - Both reviews applied (Codex: digging tools only; its REJECT of my claim was right -- a sealed bot
        with NO wood still cannot make sticks/table). 9 tests, 205/205.
      - Canaries after lastswing-01.
    - **VETO RETRY: `veto-retry` @ `722b112`** (from 80b3bbd). 40% of decisions were vetoed, holding 32%
      of fleet time; 44.5% of vetoes were followed by the same key.
      - REPLAY on the spare 10.0.0.16 with the hash-verified deployed prompt: feedback changed the action
        97% vs 58% without.
      - One in-tick retry with what/why feedback; a same-key retry is refused without the gate.
      - `_veto_retry` row. 204/204; the sandbox smoke shows the row.
      - **Both implementation reviews running.**
    - d0c47c6 (an explore repeat is not a repeat from 48 blocks away) was never deployed (program
      window); it is part of the veto problem and should follow veto-retry.
    - **EXPLORE TOWARD THE TASK: `explore-toward` @ `96bc68d`** (from 80b3bbd). Re-measured 28-29 Sep:
      1,287 of 8,766 explores walked to IRON under a wood/dirt/sand/stone task (9.8 h); control 78/78.
      - exploreintent.mjs maps gather/stockpile rungs to the kinds the reflex sights. The runner gets a copy
        of the args after admission, so gate keys are unchanged. A family means the nearest member, with no
        fall-through to iron. The walk stops at the target. A null heading is no longer due east.
      - Row `_explore_toward_milestone` (legacy= included). 13 tests, 9 mutants killed, 204/204.
      - **Both implementation reviews running.** d0c47c6 kept separate: Codex re-measured explore at 34.5%
        of repeat_loop vetoes (not 54%), median same-key separation 1.1 blocks (not 48).
    - **EXPLORE after both implementation reviews: `explore-toward` @ `4458107`** -- stone and dirt OUT (buried, not
      distant; dirt never sighted); an unsightable main item is never aimed; literal-item detours (a smelt prereq
      counting iron_ore) not aimed; the walk RE-AIMS each leg and stops on ARRIVAL (a distance cap was not arrival).
      18 tests incl. explore() driven with a drifting pathfinder, 14 mutants killed, 204/204. Registration
      `exploretoward-01` staged in docs (correctness gate: every aimed target is a kind the task asked for; read
      dry-run on unchanged hive-b prints NOT judged). Exposure ~0.8 aimed walks/bot-h: items effect unmeasurable.
    - **BANK FIX BUILT: `bank-fix` @ `4d76b43`** (chest-ledger + tool-keeper-2 + craft-count, then 3 parts).
      Part 1 = Codex triage: deposit's chest walk cancellable + bounded; a named deposit admitted on its own plan;
      craft checks ingredients before walking to a table. Part 2 = the owner's tiers (valuable uncapped / useful 128
      under 75% / bulk 64 under 50% / junk never; only valuable opens a chest; place a CARRIED chest first),
      hold-iron 3, demand vs transfer (logs+cobble never send a bot), the capped/full state, withdraw skips bulk,
      place() never on a lid. Part 3 = both implementation reviews + SANDBOX (RCON slot reads): A places the carried
      chest and banks ONLY the valuables; an empty chest takes exactly 64 cobble; the next trip is refused. 209/209,
      ~24 mutants killed. MEASURED FIRST: inventories are median 34/36 slots but bulk is ~3.6% of slots -- ballast
      and spent tools fill them (hygiene's job). KNOWN RESIDUAL: nothing frees a slot for a bot full of capped bulk.
      Registration NOT yet written; its gate must read the ledger open snapshots / RCON, never `_deposit_window`
      (client-side), and key a double chest as one container. veto-retry's RETRYABLE needs deposit_nothing_to_bank
      and bank_capped when the two meet.
    - Codex's smaller finds: deposit cancellation, craft preflight and the deposit admission plan are INSIDE the bank
      fix. Not built: escape burns logs as scaffold (1,009 logs/day).
  - **toolkeeper-01 DECIDED 2026-09-29 14:10Z: KEEP** (4320136).
    - 8 canary deaths in 520 bot-h (0.015/bh) vs 30 in 1,040 (0.029/bh).
    - Its registration said promotion 'none' (written before the owner allowed fleet-wide), so it was
      recorded and torn down, NOT promoted.
    - Teardown verified by me: 80/80 bots report 80b3bbd, no drop-ins, 80 running.
    - Its deposit change is folded into the bank-fix bundle (the same code) rather than a separate
      fleet-wide deploy.
  - **deathfix-01 DEPLOYING 2026-09-29 15:09Z** (1d107ed on the fleet base 80b3bbd) to **hive-a,board-a**
    (10 bots, both on the 5080 half). Licence and gate digest passed 14:18Z. The draw waited 50 min, then
    hive-a entered the +/-40% band when the median moved (34.1 -> 31.5).
    - Reads at +180/+360, with extension until exposure. Promotion is fleet-wide, so on a KEEP every later
      branch rebases onto 1d107ed.
    - THROUGHPUT: one canary at a time + a 12 h pool cool-down = >= 12 h per change. With ~8 changes queued
      that is >= 4 days. Bundling the small deterministic fixes (asked 09-29 morning, not answered) is the lever.
    - digsync-01 is STAGED on the host (registration sha 59cbb71 = dig-rollback head, from 80b3bbd; read
      /tmp/digsyncread.py matches docs). Its dry draw at 15:08Z offered hive-a,board-a too. **Rebase it onto
      1d107ed if deathfix-01 is promoted.**
  - **QUEUE (owner-approved 09-29; one canary at a time):**
    1. ~~toolkeeper-01~~ KEEP (not promoted)
    2. deathfix-01 (DEPLOYING 15:09Z, hive-a,board-a)
    3. **digsync-01** (fleet-wide stuck bots + the tunnel depend on it; rebases cleanly onto 1d107ed, 205/205)
    3b. **stalestop-01** (fleet-wide dropped items; small, deterministic)
    4. lastswing-01
    5. hygiene-01
    6. ore tunnel (rebase the stack; oretunnel-01 staged)
    6b. idle gap (idlegap-01 staged); hive-progress (reviewed by both; registration to write)
    - **withdraw-home is NOT canary-able alone** (read staged: docs/reports/withdraw-01-read.py.txt). The dry run
      found 5 withdraws in 7.3 h on 80 bots, 0 successes (~0.22/bot-day), so a 5-bot pool sees ~1 a day and
      ends INCONCLUSIVE. Recommend BUNDLING it with the change that makes bots withdraw (craft sourcing from
      the bank = colony step 3), or with the bank fix. The read's correctness gate (every success's snapshot
      holds the item) is ready either way.
    7. withdraw-home
    8. bank fix
    9. craft limits
  - **Ore tunnel** (`ore-tunnel`, e455cf5 + uncommitted fixes in `$SP/wt-hyg`):
    - Both implementation reviews: REJECT for canary as it stood.
    - Fixed: arrival checked (goto resolves on an empty path); the pickaxe remedy = this trip's need, with
      too-long trips refused (chain property test); inventory_full no longer ends gather; the deadline comes
      from gather's own clock; abort stops the walk; the planner's step test = the corridor guard's (drop
      lava); gather's iron candidates get the six-face check. 21 tests; 3 mutants killed.
    - The sandbox stalls were ghost blocks. The harness made them (rejoin inside the refilled arena +
      mid-dig tp); run-ore.sh now parks the bot on top.
    - Waits for the ghost fix (the tunnel needs it on the fleet too).
  - **Staged canaries:** `lastswing-01` and `hygiene-01` registrations + reads committed (docs/reports), both
    dry-run on the fleet with positive controls (225 'gather cobblestone' failures; 50 control bots at >= 34
    slots). The sha is set at launch after rebasing on the fleet. hygiene-01 needs a MANUAL pool check (>= 2
    bots at >= 34 slots); drawexposure cannot see slots.
  - **Jobs/mayor spec** (owner question): `docs/reports/jobs-mayor-spec-2026-09-29.md`. Both engines: duties,
    not permanent jobs; ledger + retrieval first; mayor in shadow mode; one duty in one world.
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
  **COLONY LAYER, two-engine analysis 2026-09-29** (`docs/reports/colony-design-2026-09-29.md`): not built. Both:
  coordination is not the problem yet (3.5% contention); ACCESS is (stone_pickaxe failures are 3 cobble short,
  bank full). Plan: (1) chest ledger observe-only, (2) craft/withdraw source from the bank deterministically,
  (3) unify sharing as its own step + a deterministic needs-vector "mayor" that reorders, never vetoes; chat stays
  outbound (fix only with auth + commands.mjs lockdown); claims later, with the ore tunnel. Canary unit = a world.
  **IRON RESEARCH 2026-09-29** (`docs/reports/iron-research-2026-09-29.md`, both engines): anti-xray is OFF on
  all worlds, so bots KNOW every ore; nearest iron median 15 blocks. Item (1) becomes a Baritone-style COSTED
  TUNNEL to known ore (not novel: Baritone MineProcess does it) + hazard mask + exit-contract budget + cluster
  mining, deterministic on "buried". Needs last-swing + hygiene first. Cheap side fix: deepslate_iron_ore is
  missing from the model's INTERESTING_BLOCKS and perception.
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
