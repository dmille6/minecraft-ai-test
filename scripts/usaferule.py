#!/usr/bin/env python3
"""The death gate for UNDERGROUND-SAFETY canaries (gate v34), as pure functions. Part of the gate bundle.

WHY A DIFFERENT GATE. A safety fix must be tested where its target lives, so an underground-safety canary is DRAWN on the
pools that drown (draw_exposure: hive-c, hive-d, placebo-a, placebo-b, placebo-d qualified on 10-07). On the base build
alone those pools died 2.6-3.2x the control's rate in the 6 h before (airpocket design section 6). The live gate compares
the canary's POST rate with the control's POST rate, so a no-change canary drawn this way trips it on its own pools'
baseline -- measured on the null below. A cross-sectional comparison cannot test a fix where the problem is.

THE GATE (difference-in-differences of death RATES, each arm against ITSELF):
  canary ratio   R_c = (canary POST deaths / POST bot-h) / (canary PRE deaths / PRE bot-h)   -- the same bots, before
  control ratio  R_k = (control POST / POST bot-h) / (control PRE / PRE bot-h)               -- what time alone did
  psi = R_c / R_k. The canary's POST/PRE ratio gets the owner's exact Poisson lower bound (deathgate.ratio_lower_bound,
  the v21 machinery, conditional binomial); the control's ratio, ~60 bots, is taken as its point estimate with a 0.5
  continuity correction. TRIP iff canary POST deaths >= the owner's two-death floor AND lower_bound(R_c) / R_k > THRESHOLD
  (2.0, CALIBRATED on the five-pool null -- deaths cluster, so the nominal 1.25 false-trips 12-17%).
  PRE is the `pre_hours` (default 24 h) before declared_at -- long enough to hold ~10 deaths on 10 drowning-pool bots.
  The in-window randomization p (v26) is kept REPORT-ONLY, on the DiD statistic per pool (POST deaths minus PRE rate x
  POST bot-h x R_k), permuted over every pool.
MECHANISM LINKAGE still reverts, by the registration's `link_rules` (round 1, Claude: "any death within 120 s of an
_air_pocket row" would revert a WORKING fix whenever an attempt that failed with its reserve intact was followed by the
drowning it could not prevent -- the read's C3 deliberately does not call that a breach). Two rule shapes:
  {"kind": K, "until_kind": E, "window_s": W}
                                 a death within W s (default 600) after the bot's K row and before the matching E row
                                 (same `id=` when both carry one) is linked -- for airpocket, a death DURING the step
                                 (C3's "any death between start and end"), and a death after a pre-empt with no step;
  {"kind": K, "window_s": N, "except_detail_re": R, "except_cause": C}
                                 a death within N s after the bot's K row is linked, EXCEPT when the row's detail matches
                                 R and the death's CAUSE (its detail before the first ';', e.g. "drowned") contains C --
                                 for airpocket, a drowning after an aborted/failed/opened attempt that ended at >= 3 HP
                                 (the reserve held: the read's C3 is clean) is the base-rate drowning;
                                 every other death after an attempt (after a success, after an attempt that spent the
                                 reserve or whose health is unknown, or any non-drowning death) is linked.
Any linked death reverts once the canary is at the two-death floor (v23). THE FLOOR BINDS THE STATISTICAL GATE AND THE
LINKAGE ONLY: the read's reserve gate (C3) is a registered `evidence: defect` own line and reverts at a read on the
defect itself -- one death during an attempt is one -- as every defect own line always has (round 2, Codex).
Calibration: scripts/host/usafe_null.py (no-change draws restricted to the five pools, the draw's 12-h filter applied).
"""
import math

FLOOR = 2
THRESHOLD = 2.0          # CALIBRATED on the five-pool null (scripts/host/usafe_null.py), not the nominal 1.25: see the report
DEFAULT_PRE_H = 24.0
CLASS = 'underground-safety'


def is_underground_safety(reg):
    return isinstance(reg, dict) and reg.get('class') == CLASS


def licence_report_only(reg):
    """PURE. v31: a `rate`-class licence makes every instrument of the change report-only -- verdict.py's
    _LIC_REPORT_ONLY, restated here so the replay CLI decides exactly as the live gate (round 5, Codex)."""
    lic = reg.get('licence') if isinstance(reg, dict) else None
    return isinstance(lic, dict) and lic.get('class') == 'rate'


def spec(reg):
    """The registration's `underground_safety` block with defaults."""
    u = reg.get('underground_safety') if isinstance(reg.get('underground_safety'), dict) else {}
    rules = [r for r in (u.get('link_rules') or []) if isinstance(r, dict)]
    kinds = sorted({k for r in rules for k in (r.get('kind'), r.get('until_kind')) if isinstance(k, str)})
    return {'pre_hours': float(u.get('pre_hours', DEFAULT_PRE_H)), 'link_rules': rules, 'link_kinds': kinds}


def rule_problems(rules):
    import re
    bad = []
    if not isinstance(rules, list) or not rules:
        return ['underground_safety.link_rules must list at least one rule']
    for i, r in enumerate(rules):
        if not isinstance(r, dict) or not isinstance(r.get('kind'), str) or not r['kind'].startswith('_') or len(r['kind']) < 2:
            bad.append('link_rules[%d].kind must name the fix\'s own action row ("_x")' % i); continue
        if 'until_kind' in r:
            if not isinstance(r['until_kind'], str) or not r['until_kind'].startswith('_'):
                bad.append('link_rules[%d].until_kind must be a row name' % i)
            w = r.get('window_s', 600)
            if not isinstance(w, (int, float)) or isinstance(w, bool) or not (0 < w <= 3600):
                bad.append('link_rules[%d].window_s must be in (0, 3600]' % i)
        else:
            w = r.get('window_s')
            if not isinstance(w, (int, float)) or isinstance(w, bool) or not (0 < w <= 600):
                bad.append('link_rules[%d].window_s must be in (0, 600]' % i)
            if 'except_detail_re' in r:
                try:
                    re.compile(r['except_detail_re'])
                except (re.error, TypeError):
                    bad.append('link_rules[%d].except_detail_re does not compile' % i)
                if not isinstance(r.get('except_cause'), str) or not r['except_cause']:
                    bad.append('link_rules[%d].except_cause must accompany except_detail_re' % i)
    return bad


def registration_problems(reg):
    """PURE. [] when an underground-safety registration is well-formed (or the registration is another class)."""
    if not is_underground_safety(reg):
        return []
    bad = []
    u = reg.get('underground_safety')
    if not isinstance(u, dict):
        return ['class underground-safety but no underground_safety block']
    bad += rule_problems(u.get('link_rules'))
    p = u.get('pre_hours', DEFAULT_PRE_H)
    if not isinstance(p, (int, float)) or isinstance(p, bool) or not (6 <= p <= 48):
        bad.append('underground_safety.pre_hours must be in [6, 48]')
    if not isinstance(reg.get('draw_exposure'), dict):
        bad.append('an underground-safety canary must declare draw_exposure (it is tested where its target lives)')
    for x in (reg.get('linkage_extra') or []):
        if not isinstance(x, str):
            bad.append('linkage_extra must hold row names (strings); a %s there crashes verdict.py and changerowcheck.py '
                       '-- put linkage in underground_safety' % type(x).__name__)
            break
    return bad


def control_ratio(c, tc, d, td):
    """R_k with a 0.5 continuity correction (never 0 or inf); None if either exposure is unmeasured."""
    if not tc or not td or tc <= 0 or td <= 0:
        return None
    return ((c + 0.5) / tc) / ((d + 0.5) / td)


def did_gate(a, ta, b, tb, c, tc, d, td, lower_bound, threshold=THRESHOLD, floor=FLOOR):
    """PURE. (reverts, lb_psi, why). a/ta canary POST, b/tb canary PRE, c/tc control POST, d/td control PRE.
    `lower_bound` is deathgate.ratio_lower_bound (passed in). Fail safe in BOTH directions where it matters: below the
    floor never trips; unmeasured exposure in any arm-window is UNREADABLE (returned as reverts=None) -- the caller
    must not read that as clean."""
    base = ('canary %d/%.1f bh POST vs %d/%.1f bh PRE; control %d/%.1f vs %d/%.1f'
            % (a, ta or 0, b, tb or 0, c, tc or 0, d, td or 0))
    # exposure FIRST: zero canary exposure with zero deaths is an instrument that saw nothing, not a clean canary
    if not ta or not tb or ta <= 0 or tb <= 0 or not td or td <= 0:
        return None, None, 'canary POST/PRE or control PRE exposure unmeasured: %s' % base
    if a < floor:
        return False, 0.0, 'below the owner\'s %d-death floor: %s' % (floor, base)
    rk = control_ratio(c, tc, d, td)
    if rk is None:
        return None, None, 'control POST or PRE exposure unmeasured: %s' % base
    lb = lower_bound(a, ta, b, tb) / rk
    pt = ((a / ta) / (b / tb) / rk) if b > 0 else float('inf')
    head = 'DiD death gate: %s; canary POST/PRE %s, control %.2fx, psi %s, lower 95%% bound %.2fx' % (
        base, ('%.2fx' % ((a / ta) / (b / tb))) if b > 0 else 'inf', rk, ('%.2fx' % pt) if pt != float('inf') else 'inf', lb)
    if lb > threshold:
        return True, lb, head + ' > %.2fx' % threshold
    return False, lb, head + ' does not clear %.2fx (held)' % threshold


def linked_reverts(linked, deaths, floor=FLOOR):
    """PURE. Mechanism linkage: any linked death reverts once the canary is at the floor (v23)."""
    if not linked:
        return False, 'no mechanism-linked death'
    if deaths < floor:
        return False, ('%d linked death(s) among %d canary deaths: below the %d-death floor, REPORTED, not a verdict'
                       % (linked, deaths, floor))
    return True, '%d mechanism-linked death(s) among %d canary deaths (floor %d)' % (linked, deaths, floor)


def _id(detail):
    d = detail or ''
    return d[3:].split(' ', 1)[0] if d.startswith('id=') else None


def link_reason(death_t, death_text, own, rules):
    """PURE. -> the rule that links this death, or None. `own` is the bot's own-kind rows [(t, kind, detail)], `rules`
    the registration's link_rules. A row written after the death never links."""
    import re
    before = [(t, k, d) for t, k, d in own if t <= death_t]
    for r in rules:
        if 'until_kind' in r:
            starts = [(t, d) for t, k, d in before if k == r['kind'] and death_t - t <= r.get('window_s', 600)]
            if not starts:
                continue
            ts, ds = starts[-1]
            sid = _id(ds)
            closed = any(k == r['until_kind'] and ts <= t <= death_t and (sid is None or _id(d) == sid) for t, k, d in own)
            if not closed:
                return '%s with no %s before the death (died during the step)' % (r['kind'], r['until_kind'])
        else:
            for t, k, d in before:
                if k != r['kind'] or death_t - t > r['window_s']:
                    continue
                exc = r.get('except_detail_re')
                cause = (death_text or '').split(';', 1)[0]      # "drowned; idle at ... | leading up: ..." -> "drowned"
                if exc and re.search(exc, d or '') and r.get('except_cause', '\0') in cause:
                    continue
                return 'death %.0f s after %s (%s)' % (death_t - t, k, (d or '')[:60])
    return None


def randomization_p(units, treat):
    """REPORT ONLY. units: pool -> (post_deaths, post_h, pre_deaths, pre_h, ) and the control ratio is applied by the
    caller via the statistic: excess = post_deaths - (pre_deaths + 0.5)/pre_h * post_h * rk. Ranked share of same-size
    assignments whose summed excess is >= the treated one."""
    import itertools
    if any(units.get(t) is None for t in treat):
        return None, 0                   # a treated pool without a PRE: no statistic (report-only, never a crash)
    us = sorted(u for u in units if units[u] is not None)
    k = len(treat)
    if k <= 0 or k >= len(us):
        return None, 0
    obs = sum(units[t] for t in treat)
    ge = n = 0
    for combo in itertools.combinations(us, k):
        n += 1
        if sum(units[u] for u in combo) >= obs - 1e-12:
            ge += 1
    return ge / n, n
