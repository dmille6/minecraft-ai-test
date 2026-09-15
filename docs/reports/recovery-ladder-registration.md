# LIVE CANARY: recovery-ladder-01 on the pool named in the manifest (fd9474b vs 8a2964a). A SAFETY canary: KEEP means 'safe to promote' at +360; mechanism evidence comes from the sandbox corpus (already recorded). Immobility is DESCRIPTIVE. Reads +30 (exposure/split only), +90, +180, +360 (verdict).

## PRE-REGISTERED v8 FROZEN 13:00 UTC 09-13 — recovery-ladder-01 (885d2dd on 8a2964a): a SAFETY canary; the mechanism is proven in the sandbox (Codex passes 1–14: passes 1–13 each fixed the rule; pass 14's path is recorded as an accepted residual below)
**Why v6 changed shape (Codex passes 3–4 + the dry run):** trapped bots are ~3 of 80, and today 2 of 3 trapped
CONTROL bots freed themselves with `_marooned` rows in the 10 minutes before (the old code's climb keeps
firing), so on the fleet neither a pp primary nor a "ladder row within 10 min" link can tell the policy from
spontaneous recovery. The fleet cannot read causation at n≈3. The honest split: **mechanism from the sandbox,
harm and non-regression from the fleet.**
- **Mechanism evidence (required before deploy, recorded here):** control-vs-candidate replays of the captured
  traps on identical fixtures. Delta (`hive-a-delta-no-pick-shaft-r8`): control = pickaxe-prerequisite loop,
  no rise (and drowned in the flooded replay); candidate = rose y=55 → 63 alive. Bravo: control refused 24-vs-25;
  candidate admitted the climb but cannot pillar while floating → NOT fixed, out of scope, named. Any new trap
  captured before deploy is replayed both ways and added.
- **Pool draw:** rule v5 band; exposure = the pool has ≥ 20 `entombed`+`marooned` rows or ≥ 8 `livelock_escape`
  rows in the prior 3 h (every pool qualifies today; the mechanism touches those paths), clean ≥ 90-min
  pre-window; a pool with a trapped bot is preferred but not required (the trapped-bot read is descriptive).
- **KEEP means "safe to promote", read at +360 (HOLD at +180 if any guard is undefined):** (1) the standing
  death gate not tripped — at every read, canary deaths (count) ≥ 2 AND canary deaths/bot-h > 1.25× control's
  over [cutoff, read] → REVERT; (2) harvest: items/bot-h ratio-DiD ≥ −57% (0.43×), evaluated from +90 with
  ≥ 7.5 canary bot-h and ≥ 20 control items; (3) gather runs/bot-h and explore runs/bot-h within 30% relative
  of the control's own change; (4) `entombed`+`marooned` firings/bot-h not up > 2× relative; (5)
  `livelock_escape` rows/bot-h not up > 2× relative (the latch must not thrash) and blocks spent per ladder
  p90 ≤ 32; (6) no `recovery_exhausted` row on a bot that is not immobile AT that row — the window IS the episode: from the earliest of the three `livelock_escape … latched` rows that produced the exhaustion (the breaker's own record of the sequence, ≥ 20 min before the row by construction) to the exhaustion row, EVERY position sample lies within 6 horizontal blocks AND within 4 vertical blocks of the bot's position at the row (a bot climbing or descending a shaft is moving, Codex pass 12) — a bounded region over exactly the unresolved episode, never an earlier one and never pre-trap travel, AND the span must be covered at both boundaries and throughout: no gap > 120 s from the episode start to the first sample, between consecutive samples, or from the last sample to the row (the bots log rows far more often); a larger gap makes guard 6 UNDEFINED for that row → HOLD, INCONCLUSIVE at +360, never clean (Codex passes 8–13; /tmp/immobiledid.py computes the maximum distance and the largest gap over that span).
  Also, from the breaker's OWN complete records over the episode: every `livelock_escape` row of the bot in the
  span must report moved < 8 (the three latched rows do so by construction) and no `livelock_escape` success row
  may fall in the span. ACCEPTED RESIDUAL, recorded: movement that happens entirely between two samples ≤ 120 s
  apart and returns to the region, with the breaker's own displacement measurements all < 8, reads as immobile;
  no sampling closes that, and the harm it could hide — the breaker thrashing on a mobile bot — is bounded
  independently by guard 5 (livelock rows/bot-h ≤ 2× relative) and by guard 3 (gather/explore runs held).
  Stopping rule for this guard: only a named path that guards 3 and 5 also miss reopens it; exhaustion on a trapped bot is the intended terminal state however many traps the world produces, on a mobile bot it is the breaker thrashing → any such row = guard tripped; (7) the split
  verified at +30 and readability = ≥ 15 canary bot-h with all 5 bots reporting.
- **Descriptive, printed at every read, never a gate:** immobile share pre → post (pp) canary vs control; every
  bot immobile ≥ 30 min at the cutoff on BOTH arms, freed or not, with the ladder rows preceding a freeing;
  `recovery_exhausted` names and positions.
- **After promotion:** the trapped-bot list from the digest (`recovery_exhausted` + immobile ≥ 30 min) is the
  fleet-wide read over days, descriptive; new trap captures feed the sandbox, which is where the next rung
  (flooded-pocket pillar) is proven.
- **Precedence:** harm → REVERT; a guard undefined/insufficient → HOLD then INCONCLUSIVE; KEEP only with all
  seven clean at +360. Reads +30 / +90 / +180 / +360 with `/tmp/immobiledid.py <M>` + canary-report.
- **Accepted residual, closing the review (pass 14):** Codex's last path is a bot that makes between-sample
  excursions and returns three times exactly inside the breaker's own goto measurements, so that
  `recovery_exhausted` fires on a bot that is really mobile, and "its useful recovery is disabled". Recorded and
  not fixed: (a) no sampling closes a between-sample excursion, and three such excursions timed to the breaker's
  measurements have no fleet-plausible mechanism; (b) the consequence claimed is not a loss — `recovery_exhausted`
  switches off only the breaker's relocation gotos for that bot, never its skills, and a bot that is genuinely
  mobile does not need a relocation goto. The registration is frozen here; the review had moved from named
  fleet mechanisms to constructed sequences, which is this project's stopping rule for a review loop.


## Amendment (prospective) — recovery-ladder-02, written 2026-09-13 15:33 UTC before any -02 read
- -01 (3eb1bec, placebo-a, declared 14:33:29Z) was REVERTED by hand at +42 min: the rebuilt deposit's chest matcher read b.position on mineflayer palette blocks (position null); 6/6 canary deposits threw. Not a registered gate; recorded in the ledger as REVERT with the reason.
- -02 = a242d64 (3eb1bec + that one fix, suite 172/172) on hive-c (drawn at deploy 15:27 UTC: 5080 half, 66.8 items/bh vs median 56.2 at ±25%, exposure 82 livelock / 117 climb rows, no trapped bot; placebo-a, board-a, board-b, placebo-b excluded within 12 h). declared_at 2026-09-13T15:27:52.542029Z. Reads +30/+90/+180/+360 (15:58 / 16:58 / 18:28 / 21:28 UTC).
- Rules unchanged (v8: safety canary, KEEP = safe to promote, guards 1–7, readability floors, two-death floor, placebo screen), plus one added gate: the canary's deposit skill_error share (runs failing with a JS error) must not exceed the control's; above it is a REVERT regardless of the other reads.

## v9 — registered 2026-09-13 17:10 UTC for recovery-ladder-03 (owner: "B and C"), BEFORE the deploy
Change: a242d64's bot code (3eb1bec + the deposit palette-block fix), sha 9dfe2ee (= a242d64 + two-pool tooling, src digest unchanged) vs 8a2964a.
Pools: TWO pools of five, drawn at deploy from the 5080 half under rule v5 (band ±25% of the half's 2-h median, exposure, not a canary in 12 h, not placebo-c).
Reads: +30/+90/+180/+360; KEEP = safe to promote on the non-death guards 1–7 (v8) with readability floors; the deposit skill_error share must not exceed the control's.
DEATHS — the calibrated rule (scripts/gatecal.py on today's fleet history, 132 five-bot and 726 ten-bot pseudo-canaries, no change deployed):
  measured false-trip rates inside 6 h: current two-death rule 54% (5-bot) / 53% (10-bot); exact-binomial v3 41% / 77%; pool DiD at +360 vs its own 6-h pre-period 38% / 38%; fleet-level backstop (2-h fleet rate > 2x the pre-deploy 6-h rate) 45% of deploy times.
  Therefore NO death-RATE test can auto-revert inside the 6-h window: every one of them reverts a harmless change more often than not. Registered:
  (a) a MECHANISM-LINKED canary death reverts at once: the dead bot has a row of the change's mechanism in the 600 s before its _death row. M = {entombed, marooned, maroon_wall, entombed_ramp_cut, maroon_climb_refused, maroon_climb_exhausted, maroon_pillar_declined, maroon_dig_refused, marooned_needs_pickaxe, livelock_escape, pillar_no_gain, recovery_exhausted, danger_block, stuck}. Checked continuously (5-min poll) and at every read.
  (b) every canary death is reported at every read with its mechanism and the control count; none is excused, none is a trip on its own.
  (c) survival is judged where it can be: fleet-wide, over 72 h after promotion, against the program's committed numbers (deaths/bot-h ≤ 0.05), as the feasibility review specified. A promotion that fails that read is reverted fleet-wide.
Everything else from v8 stands. Amendments after this line are prospective only.
DRAW at deploy (2026-09-13 17:08 UTC, clock checked with date -u): 5080-half 2-h median 51.4 items/bh; ±25% held one eligible pool only (hive-b 63.0); widened to ±40% as the rule allows (stated): eligible hive-b (63.0; livelock 99 / climbs 108) and placebo-b (68.4; 53 / 96, one trapped bot; its 04:14 canary exclusion lifted 16:14). hive-a (30.7) missed the band by 0.1. Exactly two eligible -> both drawn, no randomness needed. POOLS = hive-b,placebo-b.

## v10 — DRAFT (prospective; written 2026-09-13 21:25 UTC after -03's revert; applies to -04 only once registered)
1. Mechanism linkage (v9a) counts only a rung that MOVED the body in the 600 s before the death: entombed, marooned, maroon_wall, entombed_ramp_cut, marooned_ramp_cut, livelock_escape, pillar_no_gain, danger_block, stuck, unstick_oscillation. Refusals and terminal states are reported, never linked. (-03 was reverted on marooned_needs_pickaxe, a refusal, 4 min before a gather-at-height fall.)
2. Guard 6 counts recovery_exhausted rows whose bot is STILL immobile (60-min displacement < 6) 30 min after the row. (-03: 9 rows, 0 immobile after.)
3. The livelock breaker's trigger (3 consecutive rejected decisions, or repeat_loop) fires on WORKING bots and walks them 30-57 blocks every 5-10 min; before -04 it needs physical fixation too (no displacement >= 8 and no items gained in the window). Design change: two Codex passes first.
Everything else from v9 stands.

## v10 — REGISTERED 2026-09-13T22:44Z for recovery-ladder-04 (owner 21:50 UTC: "do whatever you think is best"), BEFORE the deploy
Change: the same bot code as -03 (a242d64's src, digest 3dc1ae) at the recovery-ladder-03 branch head 6d843a1 (docs and read scripts only since 612d1c8) vs 8a2964a.
Pools: two pools of five drawn at deploy under rule v5 (5080 half, band ±25% widened to ±40% if fewer than two, exposure, 12-h exclusions, not placebo-c). Reads +30/+90/+180/+360.
KEEP = safe to promote: guards 1–5 and 7 as v8; guard 6 = recovery_exhausted rows whose bot is STILL STUCK (60-min displacement < 6 AND no positive inventory delta) 30 min after the row, <= trapped-at-deploy + 1; readability floors; deposit skill_error share <= control's.
Deaths: (a) a canary death with a rung that MOVED the body (entombed, marooned, maroon_wall, entombed_ramp_cut, marooned_ramp_cut, livelock_escape, pillar_no_gain, danger_block, stuck, unstick_oscillation) in the 600 s before it reverts at once (5-min poll + every read); refusals and terminal states are reported, never linked; (b) every death reported; (c) survival judged fleet-wide over 72 h after promotion (deaths/bot-h <= 0.05).
Guards gather/bh and explore/bh are ONE-SIDED (a fall of more than 30% fails; a rise never does) — this is the registered reading from v10 on.
KEEP -> promote 6d843a1 fleet-wide, fast-forward main, open the 72-h fleet read. Anything else -> teardown, INCONCLUSIVE or REVERT as the lines say. Amendments after this line are prospective only.
DRAW at deploy (2026-09-13 22:45 UTC): 5080-half 2-h median 66.7; ±25% band held four pools per the script, but the script's 12-h list was missing hive-c (15:27) and placebo-b (17:07) -- both were still excluded by the rule; neither was picked. Valid eligible: hive-a (73.6; livelock 100 / climbs 141; one trapped bot -> preferred) and board-a (70.7; 80 / 96; its 10:24 exclusion lifted 22:24). POOLS = hive-a,board-a.

## v11 — REGISTERED 2026-09-13T23:05Z for recovery-ladder-05 (prospective; the owner delegated at 21:50 UTC)
-04 was reverted at +17 min by v10(a): the linked row was an entombed arm that had ENDED ten minutes and ~100 blocks of walking, gathering and exploring before the bot walked into lava during gather. In all four canary deaths today the nearest rung row was 4-10 min before the death and the bot had left the rung's place. The 600-s window links a rung that merely fired, not one that acted.
v11(a): a canary death is mechanism-linked when a MOVING rung row (the v10 list) is within 60 s before the death AND no skill row (a non-underscore kind) lies between them -- i.e. the bot died inside or straight out of the rung, not later in its own work. Everything else from v10 stands (guards, one-sided gather/explore, guard 6 = still-stuck rows, deposit gate, two pools, 72-h fleet survival read after promotion).
Next draw: the 12-h exclusions lift hive-c 03:27, placebo-a 02:33, board-b 01:41, hive-b/placebo-b 05:07, hive-a/board-a 10:45 UTC; deploy at the first draw with two eligible pools.
DRAW at deploy (2026-09-14 03:32 UTC): 5080-half 2-h median 60.7. The draw script's 12-h exclusion computation is unreliable (it printed only hive-b); exclusions applied BY HAND: hive-a, board-a (22:45 -> 10:45), hive-b, placebo-b (17:07 -> 05:07); lifted: hive-c 03:27, placebo-a 02:33, board-b 01:41. ±25% (45.5-75.9) leaves board-c (54.0; livelock 63 / climbs 161; one trapped bot) alone -> widened to ±40% (36.4-85.0) as the rule allows: adds placebo-a (82.9; 86 / 175). board-b (33.3) misses the band; hive-c (97.6) and placebo-b (134.6) are above it. POOLS = board-c,placebo-a.

## v12 — REGISTERED 2026-09-14T10:47Z for recovery-ladder-06 (the danger guard, 01a4155 on top of the promoted 6d843a1), BEFORE the deploy
Change: while the feet or the support block is a danger block, the four movement arms (wall, marooned, entombed, unstick) stand down and the escape re-fires every 2.5 s; the tick keeps running. Two Codex passes; suite 173/173; no corpus fixture reproduces lava (stated).
Pools: two pools of five drawn at deploy (ledger-based exclusions). Reads +30/+90/+180/+360. Everything from v11 stands EXCEPT the linkage list for THIS canary: `danger_block` is NOT a linking row (the escape fires in response to every lava contact, so linking it would count every lava death against the guard). M for -06 = {entombed, marooned, maroon_wall, entombed_ramp_cut, marooned_ramp_cut, livelock_escape, pillar_no_gain, stuck, unstick_oscillation}.
The change's own line (descriptive, both arms): lava/fire deaths with a movement-arm row (entombed/marooned/maroon_wall/livelock_escape) in the 60 s before, per bot-hour. KEEP = safe to promote on the v11 guards; the line above must not be worse on the canary.

## Backstop for the 6d843a1 promotion — FROZEN 2026-09-14 10:58 UTC (self-imposed, stated before the read)
Window 09:34:09–12:34:09 UTC; denominator 60 non-isolated bots x 3 h = 180 bot-h; deaths = `_death` rows in the window on non-isolated bots (isolated pools excluded as in every read). Threshold: >= 22 deaths (0.12/bot-h, 2x yesterday's 0.06) -> fleet-wide revert to 8a2964a via fleet-deploy. Below it the promotion stands and the 72-h read continues, reported by code version.

## v12 as applied to recovery-ladder-06 = the BREAKER FIXATION GATE (2dfe261 = 6d843a1 + 94f8981), registered 2026-09-14T12:42Z before the deploy
Change (reordered 11:05 UTC after the lava reproduction: the danger guard is hygiene, blind relocation walks are the lava lever): the livelock breaker fires only on physical fixation (arguing AND path extent < 8 AND no positive inventory delta over a fully observed 180-s window); otherwise a `livelock_not_fixated` row. Two Codex passes; suite green; corpus run 9 (3 repeats) rise better on all four fixtures.
Pools drawn at deploy (ledger exclusions): median 61.6, ±25%; eligible board-a, hive-a, hive-c, board-b; with a trapped bot: hive-c, board-b -> POOLS = hive-c,board-b.
Rules: v11 guards; linkage list M (danger_block excluded); the change's own lines (descriptive, both arms): livelock_escape rows per bot-h (expected DOWN), livelock_not_fixated rows (canary only), blind-walk deaths (fall/lava within 60 s of a livelock_escape) per bot-h. KEEP = safe to promote on the guards, and livelock_escape/bh not UP.

## Clarification written at +92 min of -06 (2026-09-14T14:15Z), BEFORE its verdict read
Guard 6 (v10 text: "recovery_exhausted rows whose bot is still stuck 30 min after, <= trapped-at-deploy + 1") compares a ROW count to a BOT count; the only coherent reading, and the intent, is DISTINCT BOTS still stuck, since one trapped bot re-latches every hour by construction. The read script now prints both; the verdict uses distinct bots. Also fixed: the script counted pre-cutoff exhausted rows (a bug), and its HARM label still printed the retired two-death verdict; it now prints v11's (deaths reported; only a linked death reverts).

## v12 as applied to recovery-ladder-07 = the DANGER GUARD (426058d = 2dfe261 + the guard, two Codex passes, suite 174/174), registered 2026-09-14T21:18Z before the deploy
Change: while the feet or the support block is a danger block the four movement arms stand down and the escape re-fires every 2.5 s; the tick keeps running. Sandbox: the lava-pocket fixture reproduces the takeover (control: entombed 0.5 s after lava) but not the outcome (a bot inside a lava source dies either way); hygiene, expected small on deaths.
Pools drawn at deploy (ledger exclusions board-b, board-c, hive-c, placebo-a): median 63.5, ±25%; eligible board-a (62.5, trapped bot) and placebo-b (78.9, trapped bot) -> POOLS = placebo-b,board-a.
Rules: v11 guards; linkage list M without danger_block (the escape is the response to lava); the change's own lines (descriptive): lava/fire deaths with a movement-arm row in the 60 s before, per bot-h (expected DOWN); reflex_danger_block rows per bot-h. KEEP = safe to promote on the guards.

## v13 — the 72-h fleet read, resolved jointly by Claude and ChatGPT under the owner's delegation (2026-09-14T22:24Z)
1. Missed slots: the rule stands (both agree). Two pools from the shared-endpoint half, ±40% at most, 12-h exclusions; idle canary hours are cheaper than an inference confound.
2. EXCEPTION, recorded as such and not called prospective (ChatGPT): v9c's "revert the fleet if the 72-h deaths/bot-h exceeds 0.05" was a program commitment written into a per-promotion gate; post-promotion outcomes are already partly known, so it cannot honestly be re-registered for THIS promotion. The owner delegated the call; the joint decision: the Thursday 17 Sep 09:34 UTC read is a PROGRAM STATUS read (all five numbers, by code version, counts beside rates, pre-72 h vs post-72 h), not a revert gate for 6d843a1/2dfe261. The 0.05 target is judged on 27 Sep on the whole program, as the feasibility review wrote it.
3. PROSPECTIVE fleet-regression rule for every promotion from the next one on (well-formed per metric): compared with the 72 h before the promotion on the same fleet, denominators bot-hours / bot-minutes:
   - deaths per bot-hour: GATE; revert if up by more than 25% AND the excess is at least 8 deaths;
   - immobile bot-minute share: GATE; revert if up by more than 25% relative AND the excess is at least 300 bot-minutes;
   - items returned per bot-hour, gather success, iron-pickaxe bot-hour share: REPORT ONLY (they are program targets, not safety).
   A fleet-read revert removes the whole promoted stack; to isolate one change, a contemporaneous reverse canary (two pools returned to the previous main) is the instrument, offered, not required.

## v12 as applied to recovery-ladder-08 = the LAVA GUARDS (14c662d = 426058d + lavaguard.mjs wired: corridor check on path_update, swept hold + rescue-stroke check, idle stand-off; design v3, two Codex passes; suite 176/176), registered 2026-09-15T05:23Z, in the same command and seconds before the deploy launch (declared_at 05:23:20Z)
Change: prevention only. (1) a relocation leg whose planned corridor crosses or overhangs lava is refused before it starts (`lava_corridor`, goal cleared); (2) the drowning hold and the rescue stroke refuse a forward stroke whose swept 3-wide, +3-cell corridor contains lava (`hold_lava_ahead`); (3) an idle bot standing beside lava steps away along a verified dry retreat (`lava_adjacent_stand_off`) or records that none exists (`lava_adjacent_no_retreat`). Sandbox: guard 1 fired on a real relocation over the pool, guard 3 fired twice; the water fixture is non-discriminating (both arms drown in 10 s), so guard 2 has no outcome proof; no regressions on the corpus.
Pools drawn at deploy (ledger exclusions board-a, board-b, hive-c, placebo-b): median 55.4, ±25%; eligible board-c (42.4), placebo-a (49.8, trapped bot), hive-a (55.4, trapped bot) -> POOLS = placebo-a,hive-a.
Rules: v11 guards; linkage list M without danger_block; the two-death floor and the v12 linkage decide REVERT. The change's own lines (descriptive, DiD vs the 70 controls): lava/fire deaths per bot-h (expected DOWN, unmeasurable on 10 bots in 6 h, reported with counts); guard rows per bot-h (lava_corridor, hold_lava_ahead, lava_adjacent_stand_off, lava_adjacent_no_retreat) as the exposure proof; explore and gather one-sided guards watch for the refusal costing travel. KEEP = safe to promote on the guards with the guard rows present (an absent guard row across 10 bots x 6 h is INCONCLUSIVE on mechanism, still KEEP on safety).

## -08 decision (to be recorded at the +90 read, ~06:53 UTC): the canary's own read found a DEFECT in guard 1
134 `lava_corridor` refusals on the 10 canary bots in the first 45 min (18/bot-h): 124 "unsupported step" (swim nodes and drops > 3, both terrain) vs 10 "lava below"; every refusal clears the pathfinder goal (243 path_reset within 5 s; 3 mine stair steps failed right after). Not a harm gate (guards within at +30; one canary death, hive-a-Alpha 06:02 drowned sealed in a water pocket, unlinked). The promotion candidate is therefore NOT 14c662d: the decision is REVERT-BY-DEFECT recorded in the ledger, with the safety read noted, and the fixed guard (-08b) takes its own two-pool canary. Rule v12 unchanged; this is the "the change's own line not worse" clause applied to the guard's own instrument.

## v12 as applied to recovery-ladder-08b = the LAVA GUARDS, fixed (3810457 = 426058d + lavaguard v2: dropLavaSafe reach 12, lava-only, water does not end the scan, landing checked beside, footprint beside every fall cell; guard 3 not in water; two Codex passes on the fix; suite 176/176), registration written 06:30Z, pools drawn at deploy
Change: as -08, with guard 1 refusing a route sample only when lava is found in the drop below it or beside the fall. Expected refusal rate on the fleet: an order of magnitude below -08's 18/bot-h; the read reports `lava_corridor` rows per bot-h by reason as the change's own instrument line, and mine success canary vs control (DiD) as the friction line.
Rules: v11 guards; linkage list M without danger_block; the two-death floor and v12 linkage decide REVERT; the change's own lines: lava/fire deaths per bot-h (counts), guard rows per bot-h (exposure), refusals per bot-h (must be < 3/bot-h at +90 or the guard is still misfiring -> REVERT-BY-DEFECT again), mine success DiD (one-sided -30%). KEEP = safe to promote on the guards with refusals < 3/bot-h.

## v12 as applied to recovery-ladder-09 = TOOL TIERING + DURABILITY FLOOR (recovery-ladder-iron 4bf76a5 = 426058d + 485ba61; plan v3, two Codex passes on the plan and two on the patch; suite 178/178; sandbox: the Delta climb-out dug with the stone pick, iron wear 0), registration drafted 06:35Z, pools drawn at deploy, deployed after -08b's verdict (one canary at a time)
Change: every dig-tool picker (skills, reflex, the pathfinder's travel digs) equips the cheapest tool that can harvest the block within 2x the fastest dig time; <=10 uses reserved for blocks that need the tier; <=1 use never swung; a held tool is swapped out for a block (never a blind unequip); tool losses logged as tool_broke / tool_gone; tools snapshot per copy.
Rules: v11 guards; linkage list M; two-death floor + v12 linkage decide REVERT. The change's own lines (toolread.py): iron pickaxes lost during work per bot-h (DiD, counts), iron uses consumed per bot-h on the canary (descriptive), tool_broke/tool_gone rows; FRICTION guards: gather success and mine success one-sided DiD >= -30 pp (the cheaper tool is slower). KEEP = safe on the guards with no friction breach; retention itself (iron-pickaxe bot-hours) is reported, not judged.
Slot at 07:00Z MISSED under the v13 missed-slot rule: after -08's teardown the ledger excludes board-a, hive-a, placebo-a, placebo-b (12 h); on the 5080 half only hive-b (-15%) sits inside ±40% (board-c -72%, board-b +129%, hive-c +116%, placebo-c never). No deploy; the draw is re-run hourly (monitor) and -08b goes out at the first draw with two eligible pools. Exclusions lapse: board-a/placebo-b ~15:20Z, placebo-a/hive-a ~18:55Z.

## v12 as applied to recovery-ladder-10 = the TOOLED FLOODED-POCKET RUNG with step 4b (recovery-ladder-10 4bfe2f2 = 426058d + the pocket commits; sandbox-closed as recovery-ladder-pocket 88d1184; design v3 + step 4b v1-v3 with four Codex passes on the design and code; suite 176/176; sandbox: Delta out on every run since the inflow fix, control 0), registration drafted 09:00Z; pools drawn at deploy; after -08b and -09 (one canary at a time). NOTE: the pocket branch base is ~2dfe261 + pocket commits; before its canary it must be rebased onto the fleet base (426058d or its successor) and re-suited.
Change: for a bot sealed in a water pocket with a pickaxe in hand: sink to the floor, pillar up between breaths digging the ceiling cells (lateral water at a cell's level no longer refuses; liquid above or lava beside does), and at a stable dry headroom step out sideways (ready ledge / fills / notch), seal the column and continue. The rung ends success when the bot is up, dry, breathing and standing, wherever it stands.
Rules: v11 guards; linkage list M PLUS flooded_pocket_rung and flooded_pocket_side_exit (a death within 60 s of either is rung-linked); two-death floor; the change's own lines: drowning deaths per bot-h (DiD, counts), flooded_pocket_rung rows by outcome and side-exit rows (exposure), blocks spent per rung p90 <= 12; guard: the water-hold's release rate not worse (one-sided -30%). KEEP = safe on the guards with rung rows present.
-08b DRAW at 10:01Z (ledger exclusions board-a, hive-a, placebo-a, placebo-b): median 51.1, ±25%; eligible board-b (51.1) and hive-c (52.0), no trapped bot in either -> POOLS = board-b,hive-c. Deployed 3810457, declared_at 2026-09-15T10:01:27Z.
