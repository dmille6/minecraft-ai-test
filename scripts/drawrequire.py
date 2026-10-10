#!/usr/bin/env python3
"""drawrequire.py -- a registration's `draw_require_pools`: pools the draw MUST include (gate v35; coordinator 10-10).

airpocket-02 has exposure only in hive-d (the ice-trap pool), and neither drawexposure.py nor drawrec.sh could force a
pool. A registration may declare `"draw_require_pools": ["hive-d"]`. drawrec.sh then:
  * includes every required pool, or draws NOTHING (the loop waits and retries; it never substitutes);
  * still respects EXCLUSIONS for required pools (the ledger's 12 h, or drawsteady's 6 h; the live canary; the manual
    draw-exclude.txt), and never takes placebo-c or isolated-*;
  * exempts required pools from the productivity band and the exposure filter (they are required BECAUSE of their
    exposure), but requires them to be live pools in the band table (a pool with no data cannot be drawn);
  * fills the rest of the draw from the ordinary eligible set (band + exposure filters), up to TARGET_K pools in total.
A malformed field refuses the draw (fail closed): it must be a non-empty list of distinct pool names (`<word>-<letter>`),
at most TARGET_K long. Absent or null = no requirement, exactly as before."""
import re

POOL_RE = re.compile(r'^[a-z]+-[a-z]$')


def parse(reg):
    """PURE. -> (required list, None) or (None, why). [] = no requirement."""
    if not isinstance(reg, dict) or reg.get('draw_require_pools') is None:
        return [], None
    v = reg['draw_require_pools']
    if not isinstance(v, list) or not v or not all(isinstance(p, str) and POOL_RE.match(p) for p in v) or len(set(v)) != len(v):
        return None, 'draw_require_pools must be a non-empty list of distinct pool names, got %r' % (v,)
    return list(v), None


def pick(required, eligible, excluded, band_pools, target_k, min_k, sample):
    """PURE. required: parse()'s list; eligible: the ordinary eligible pools (band + exposure, exclusions applied);
    excluded: the excluded set; band_pools: every pool with a band row; sample(list, k) -> k items.
    -> (pools or None, why). None = no draw: the loop waits."""
    if not required:
        return None, 'no requirement'
    if len(required) > target_k:
        return None, 'requires %d pools, more than the %d-pool target' % (len(required), target_k)
    for p in required:
        if p == 'placebo-c' or p.startswith('isolated'):
            return None, 'required pool %s is never drawable' % p
        if p in excluded:
            return None, 'required pool %s is excluded (its 12-h/6-h window, the live canary or a manual exclusion): waiting' % p
        if p not in band_pools:
            return None, 'required pool %s has no band row (no data): waiting' % p
    rest = [p for p in eligible if p not in required]
    k = min(target_k - len(required), len(rest))
    out = list(required) + (sample(rest, k) if k > 0 else [])
    if len(out) < min_k:
        return None, 'required %s plus %d eligible = %d pools < %d: waiting' % (required, len(rest), len(out), min_k)
    return out, 'required %s + %d drawn from the eligible set' % (required, k)
