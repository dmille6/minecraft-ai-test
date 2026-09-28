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
1. The 24–27 Sep program window: restart from 25 Sep, or abandon?
2. The v21 death-gate lower bound — trips on 0 of 15 death-involved reverts.
3. The audit (`8019b1d`): 7 of 23 reverts CONFIRMED FALSE, 5 more suspect.
4. Commits headed "OWNER DECISION" with no recorded artefact — three over 24–25 Sep.
5. `vetob2-01` (`efabf13`) KEPT and unpromoted; recommend re-drawing it off the hive pools.

## QUEUE (after toolkeeper-01 closes)
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
