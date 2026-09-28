# Review this canary BEFORE it launches. Its read's first draft had a 59x false positive.

_written 2026-09-28 03:19Z. The fleet is idle-safe: `80b3bbd`, one version, 80 bots, no canary
declared. I am about to declare `toolkeeper-01` and I want both engines on the registration and the
read script first, because the read has already been wrong once tonight in a way that would have
produced a confident KEEP on noise._

Artifacts under review, both committed beside this file:
- `docs/reports/toolkeeper-01-registration.json`
- `docs/reports/toolkeeper-01-read.py.txt` (the read, as it sits at `~/mcai-analysis/toolkeepread.py`)

## WHAT ALREADY WENT WRONG, so you can look for more of it

The read's first draft used **median best-held-pickaxe uses** as the primary, with a ratio-DiD and a
**3.0x KEEP gate**. Dry-run against a past window on IDENTICAL CODE it returned **DiD = 59.0** — the
control median moved 59 uses to 1 with no code change, because at n=5 the median is pinned near 1 and
one fresh pickaxe swings it.

So I measured the null instead of typing a gate. Exhaustive same-shape draws, one pool as
pseudo-canary against the other eleven, 180-min windows either side of a pseudo-deploy, four reseeded
worlds excluded, **identical code throughout**:

```
statistic        n       min       p10    median       p90       max
med_uses        12   -24.000     0.000     0.000     0.000   130.000
share_floor     12    -0.418    -0.418     0.018     0.236     0.455
mean_uses       12   -31.509   -24.527    -7.509    20.855    49.218
tot_uses        12  -633.000  -569.000  -413.000  -153.000   107.000
```

**Conclusion I drew, and the one I most want attacked: at 5 bots per pool no durability endpoint can
resolve this change, so the GATE is correctness and liveness and the effect is reported with its null
printed beside it.** Two pools (10 bots) rather than one, because the table above is what 5 buys.

## THE DESIGN AS IT STANDS

- **sha** `904cedb` = the live fleet sha + ONE commit. Suite 204/204, 3 mutants killed.
- **pools** `hive-a` + `board-c`, drawn by sha256 of `<pool>+2026-09-27+toolkeeper` among the TEN
  pools that passed an eligibility rule fixed BEFORE the draw (>=3 of 5 bots holding 2+ pickaxes whose
  best copy is at or below the fleet median). The four reseeded worlds are excluded absolutely.
- **reads** +360 min (correctness/liveness only) and +1560 min (verdict). **deadline** 1680.
- **exposure** >= 20 deposit successes in the canary arm. Measured: deposit succeeds at 0.151/bot-h,
  so 10 bots make 1.51/h and 20 needs ~13 h; 26 h gives ~39 with margin. **A 3-hour read yields ~4
  per arm and is guaranteed INCONCLUSIVE.**
- **licence** class `kind`, `_deposit_tool_keep`, min_rows 12. v31 check passes: 0 baseline rows in
  249,870 over 6 h, 120 distinct kinds present as the positive control.
- **own_lines** (all REVERT): `keep_rows_control <= 0` (the baseline cannot emit it),
  `bad_keeps <= 0` (a keep row that banked a fuller copy than it kept — deterministic), and
  `keep_rows_canary >= 12` (shipped inert).
- **anchors** crafting_table copies held (same deposit call, same KEEP_ONE reserve, not
  durability-selected) and cobblestone held (the scaffold reserve — specifically the RESTART anchor,
  since only the canary pool restarts).
- v30 schedule invariant: pass. gatedigest interlock: pass.

## WHAT I WANT YOU TO DESTROY

1. **Is "gate on correctness, report the effect" the right call, or is it a canary that cannot fail?**
   Argue the other side: if the only REVERT routes are liveness and a deterministic invariant, what
   real harm could this ship that none of the three own_lines would catch?
2. **Attack the null measurement itself.** One pseudo-deploy time, 180-min windows, 12 draws, and the
   canary arm in the real run is TWO pools while the null drew ONE. Does that invalidate the
   -0.418..+0.455 band I am quoting? What would a same-shape null for a 2-pool draw look like, and is
   C(12,2)=66 the honest denominator?
3. **The correctness parse.** `bad_keeps` is a regex over the `_deposit_tool_keep` detail string:
   `keep=slotN/Xuses bank=slotM/Yuses,slotP/Zuses`. If that regex mis-parses, the gate silently
   reads 0 and the canary passes a gate that never ran. **How do I prove the parse fires?** It has no
   positive control today and that is the defect class this project keeps buying.
4. **`_deposit_cursor_rescue` is in `linkage_extra`, not in a gate.** The cursor bug is the half
   that was destroying items. Should a failed rescue (`rescue_failed_canary > 0`) be a REVERT line?
5. **Exposure is counted on deposit SUCCESSES, but the keeper acts on deposit ATTEMPTS** where a bot
   holds 2+ of a tool. Is the floor measuring the wrong denominator?
6. **Two pools on one canary** — the tripper matches `canary_pool` literally and vetob2-01 used two.
   Confirm from the code that a comma-separated pool list is genuinely supported end to end, or say
   which step breaks.
7. Anything in the read that could produce a confident number from an absence, given tonight.

## Rules
- Every negative claim carries a positive control, and it must come from a DIFFERENT instrument than
  the claim.
- `file:line` for everything. Distinguish measured / source-verified / inferred.
- Rank by what a wrong decision costs. A wrong KEEP here promotes a change to 80 bots on noise; a
  wrong REVERT discards a fix whose mechanism is source-verified and whose defect is measured.
- End with: LAUNCH or DO NOT LAUNCH, and the single change you would make first.
