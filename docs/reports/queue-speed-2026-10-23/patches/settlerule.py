#!/usr/bin/env python3
"""settlerule.py -- DESIGN 1 (queue-speed-1023): SETTLE-BASED release of just-closed pools. PURE. Proposed, NOT installed.

docs/reports/queue-speed-2026-10-23/queue-speed-design.md, section 1. drawsteady.py imports it (host: ~/mcai-analysis).

WHAT IT ADDS -- AN EXTRA WAY OUT OF THE EXCLUSION, NEVER A WAY IN. drawsteady prints `STEADY RELEASE [...]`, which
drawrec subtracts from its 12-h ledger exclusion. The settle path's releases are UNIONED with today's, so no pool is ever
held longer than today, and a pool today's rule holds can only come out through the checks below.

A pool comes out on the settle path for the incoming run R when EVERY ledger decision naming it in the last 12 h:
  * is CLOSED -- its LAST torn-down row, or the fleet-wide promotion of its sha, at/after the decision (tierrule.close_of);
  * is not a death-driven REVERT (canary-sched R11's words in the ledger note) and not an unpromoted KEEP;
  * is at least FLOOR minutes past that close, FLOOR = TABLE[R's tier][predecessor kind], raised to R's declared
    settle.lookback_min when R declares one (a read with a fixed pre-window longer than its read minute);
and the pool, measured at the draw by drawsteady, has SETTLED:
  S1 every enabled bot active, >= 20 rows in the hour, no corrupt line, bag readings in both halves (rule 2, as today);
  S2 SYMMETRIC BUILD over [now - max(60, FLOOR), now): every row of the pool on its 10-min bucket's fleet-majority build,
     the only exception a fleet transition (tierrule.asymmetric_rows -- the v36 gate's own baseline test, with the pool
     as the canary arm). This REPLACES today's "only the fleet build for 60 / 240 min" for the settle path: a fleet-wide
     promotion moves every pool at once, so it is not a carryover, but today's single-build test fails EVERY pool for an
     hour after it (and 240 min on the tier-2 path) -- and the next canary is launched ~10 min after each promotion;
  S3 bag carryover inside the qualified controls' min..max for the hour, each half and the change (rule 3, as today);
  S4 depth carryover: the pool's share of position rows below y=50 over the hour inside the same controls' min..max.
Controls qualify by S1 + S2 over the hour (the same symmetric test), and >= 4 are needed, as today.

WHY THE FLOOR IS A TIMER AND NOT A SETTLE CHECK. Every read compares the canary arm's POST with its PRE window
[declared_at - L, declared_at). A pool that ran another build inside it carries that build into R's baseline: a fact
about the past, which no measurement of the pool NOW can see. The floor is the PRE the deciding read needs (tier 2:
240 = immobiledid PRE 180 + 60 trailing, the +180 KEEP; tier 3: 360, the +360 read). Extension reads (+540, +720 ...)
read further back; today's 6-h steady and 240-min tier-2 releases already accept that, and so does this table (stated
residual, design doc 1.6) -- the v36 gate's baseline_clean refuses a tier-2 KEEP on a contaminated later read."""
import datetime as dt, re

EXCL_H = 12
DEATH_REVERT = re.compile(r'death gate:|death gate trip|rung-linked death|linked death|death-linked|death window', re.I)
NO_SETTLE_CLASSES = ('bag-fix', 'model-env', 'underground-safety')
MIN_CONTROLS = 4
DEPTH_Y = 50
MIN_POS_ROWS = 20

# THE TABLE: incoming tier -> predecessor kind -> floor (min); a cell may be {predecessor tier: minutes}. A missing
# cell or None = no settle release: today's rule alone decides. PROPOSED = iteration I8 (design doc 1.5), the only
# iteration with no re-runnable verdict flip: TODAY'S timer (a tier-3 KEEP promoted fleet-wide, 360 min from its
# promotion) for TIER-3 incoming runs, measured by S1-S4 instead of "one build in the last hour". Tier-2 incoming draws
# keep exactly today's v36 release: every iteration that changed a tier-2 draw flipped a recorded KEEP through the v36
# baseline (I2-I4, design doc 1.6). The wider tables are kept for the record and for the replay:
TABLE = {
    2: {},
    3: {'keep-promoted': 360},
}
TABLE_I3 = {2: {'keep-promoted': {2: 240, 3: 360}, 'inconclusive': 240, 'revert': 240},
            3: {'keep-promoted': 360, 'inconclusive': 360, 'revert': 360}}      # REJECTED: flips toolkit-03 (+720)


def _int(x):
    return type(x) is int


def incoming_ok(reg):
    """PURE. (ok, why) -- may this incoming run use the settle path at all?"""
    if not isinstance(reg, dict):
        return False, 'registration unreadable'
    if (reg.get('class') or '') in NO_SETTLE_CLASSES:
        return False, 'class %r keeps its own draw rules' % reg.get('class')
    if reg.get('draw_k') is not None:
        return False, 'a capped draw (draw_k) keeps today\'s rule'
    st = reg.get('settle')
    if st is None:
        return False, 'no settle block (opt-in: settle.lookback_min, the longest FIXED pre-window of its reads): today\'s rule'
    if not (isinstance(st, dict) and _int(st.get('lookback_min')) and 0 <= st['lookback_min'] <= 10080):
        return False, 'settle block malformed: today\'s rule'
    return True, 'settle path open (declared lookback %d min)' % st['lookback_min']


def kind_of(row, how):
    """PURE. The predecessor decision's kind, for the table: keep-promoted | inconclusive | revert, or None when it
    keeps today's rule (death-driven REVERT, unpromoted KEEP, anything else)."""
    d = str(row.get('decision') or '').upper()
    if d == 'REVERT':
        return None if DEATH_REVERT.search(str(row.get('note') or '')) else 'revert'
    if d == 'INCONCLUSIVE':
        return 'inconclusive'
    if d == 'KEEP' and how == 'promoted':
        return 'keep-promoted'
    return None


def floor_for(reg, tier, row, how, table=None, pred_tier=3):
    """PURE. -> floor minutes, or None (today's rule). reg: the incoming registration; tier: its tierrule.tier_of;
    pred_tier: the predecessor's tier AS DECIDED (tierrule.ledger_tier). A table cell is minutes, None, or
    {predecessor tier: minutes or None}."""
    k = kind_of(row, how)
    if k is None or how not in ('torn-down', 'promoted'):
        return None
    f = (table or TABLE).get(tier, {}).get(k)
    if isinstance(f, dict):
        f = f.get(pred_tier)
    if f is None:
        return None
    lb = (reg.get('settle') or {}).get('lookback_min') if isinstance(reg.get('settle'), dict) else None
    return max(f, lb) if _int(lb) else f


def hold_settle(row, how, mins_since_close, floor):
    """PURE. One in-window decision -> None (it no longer holds its pools on the settle path) or why."""
    if floor is None:
        return '%s: no settle release for this decision (death-driven REVERT, unpromoted KEEP or not closed)' % (
            row.get('decision'),)
    if mins_since_close is None:
        return 'not closed'
    if mins_since_close < floor:
        return '%s closed (%s) %.0f min ago (< the floor %d)' % (row.get('decision'), how, mins_since_close, floor)
    return None


def candidates_settle(ledger_rows, journal_rows, now, reg, tier, pools_in, close_of, closes, run_of, table=None,
                      ledger_tier=None):
    """PURE given its helpers (drawsteady.pools_in; tierrule.close_of / closes / run_of -- passed in so this file imports
    nothing). -> ({pool: (run, sha, decided, closed_at, how, floor)}, {pool: why}). A pool held by ANY in-window
    decision is not released by another; its floor is the largest of its decisions'."""
    ok, held = {}, {}
    if not incoming_ok(reg)[0]:
        return ok, held
    cl = closes(journal_rows)
    for row in ledger_rows:
        t = _t(row.get('ts'))
        if t is None:
            for p in pools_in(row):
                held[p] = 'a ledger row with an unreadable ts'
            continue
        age_s = (now - t).total_seconds()
        if age_s < -600 or age_s >= EXCL_H * 3600:
            continue
        run = run_of(row)
        sha = str(row.get('canary_sha') or '')[:7]
        ct, how = close_of(run, sha, t, cl, now)
        mins = None if ct is None else (now - ct).total_seconds() / 60.0
        pt = ledger_tier(row) if ledger_tier else 3
        fl = floor_for(reg, tier, row, how, table, pt) if ct is not None else None
        why = hold_settle(row, how, mins, fl)
        for p in pools_in(row):
            if why:
                held[p] = '%s: %s' % (run, why)
            elif p not in held:
                prev = ok.get(p)
                if prev is None or prev[3] < ct or prev[5] < fl:
                    ok[p] = (run, sha, t, ct, how, max(fl, prev[5]) if prev else fl)
    for p in held:
        ok.pop(p, None)
    return ok, held


def band_ok(value, controls, name):
    """PURE. A carryover share inside the qualified controls' min..max. -> (ok, why)."""
    cs = [c for c in controls if isinstance(c, (int, float))]
    if len(cs) < MIN_CONTROLS:
        return False, '%s: only %d qualified controls (< %d)' % (name, len(cs), MIN_CONTROLS)
    if not isinstance(value, (int, float)):
        return False, '%s: unmeasured on the candidate' % name
    lo, hi = min(cs), max(cs)
    if not lo <= value <= hi:
        return False, '%s %.3f outside the controls\' %.3f..%.3f (carryover not cleared)' % (name, value, lo, hi)
    return True, '%s %.3f inside %.3f..%.3f' % (name, value, lo, hi)


def depth_share(n_pos, n_deep):
    """PURE. The share of position rows below y=DEPTH_Y; None with fewer than MIN_POS_ROWS position rows."""
    return (n_deep / n_pos) if (_int(n_pos) and n_pos >= MIN_POS_ROWS) else None


def symmetric_build(asymmetric_rows, pool_buckets, fleet_buckets, roster, since, until):
    """PURE given tierrule.asymmetric_rows. S2: the pool (as the canary arm) against every other enabled bot (as the
    control arm) over [since, until). -> (ok, why)."""
    ok, why, _het = asymmetric_rows(pool_buckets, fleet_buckets, roster, since, until, 0)
    return ok, why


def _t(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else None
    except Exception:
        return None
