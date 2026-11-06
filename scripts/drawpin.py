#!/usr/bin/env python3
"""drawpin.py -- a registration's PINNED draw: `draw_pin_pools` (+ `draw_pin_owner_ok`), honoured in FUN MODE (owner
11-06 ~14:00Z; the coordinator's pipeline item).

WHY. Fun mode ignores draw_require_pools (lab-only since drawrec.sh v37), and the fun draw never takes isolated-* or
placebo-c (hard exclusions from the retired memory experiment). escdead-01's targets are the bots pinned 4 days at
isolated-d 358,58,180 and hive-c-Bravo: a draw without isolated-d is UNEXPOSED by construction. The owner explicitly
allowed drawing isolated-d. treefarm-05 needs board-b, hive-b, placebo-a (the towns that built every project).

THE FIELD. `"draw_pin_pools": ["isolated-d", "hive-c"]` -- the draw is EXACTLY these pools, in fun mode and lab mode:
  * a non-empty list of distinct pool names (`<word>-<letter>`), at most the draw's pool cap (TARGET_K, or draw_k);
  * an isolated-* or placebo-c pin needs `"draw_pin_owner_ok": "<the owner's words, with a date>"` (a non-empty string of
    at least 10 characters): those pools stay hard-excluded for everyone else;
  * cannot be combined with draw_require_pools (one way to say which pools; both = refused);
  * the HARD exclusions still hold for pinned pools: the brain subset, the live canary, draw-exclude.txt; the 12-h ledger
    exclusion, the productivity band and the exposure filter do not (they are measurement controls, and the pin is the
    owner's choice of population). A pinned pool must be LIVE: a band row, or (poolrank2 lists no isolated-* pool) all
    five of its bots wrote a skill row in the last 15 min;
  * FAIL CLOSED: a pinned pool that is not available, or a malformed field, draws NOTHING (the loop waits, never a
    substitute, and canary-loop.sh never takes the 30-min fun fallback for a pinned run).
Absent or null = no pin, exactly as before."""
import re

POOL_RE = re.compile(r'^[a-z]+-[a-z]$')
OWNER_ONLY = ('isolated-', 'placebo-c')
OK_MIN_LEN = 10


def owner_only(pool):
    """PURE. A pool the ordinary draw never takes (the retired experiment's controls): only with the owner's OK."""
    return pool == 'placebo-c' or pool.startswith('isolated-')


def parse(reg):
    """PURE. -> (pins list, None) | (None, why). [] = no pin."""
    if not isinstance(reg, dict) or reg.get('draw_pin_pools') is None:
        return [], None
    v = reg['draw_pin_pools']
    if not isinstance(v, list) or not v or not all(isinstance(p, str) and POOL_RE.match(p) for p in v) or len(set(v)) != len(v):
        return None, 'draw_pin_pools must be a non-empty list of distinct pool names, got %r' % (v,)
    if reg.get('draw_require_pools') is not None:
        return None, 'draw_pin_pools and draw_require_pools are both set: say the pools one way'
    gated = [p for p in v if owner_only(p)]
    ok = reg.get('draw_pin_owner_ok')
    if gated and not (isinstance(ok, str) and len(ok.strip()) >= OK_MIN_LEN):
        return None, ('pinned %s are drawn only with the owner\'s OK: set draw_pin_owner_ok to the owner\'s words and date'
                      % ', '.join(gated))
    return list(v), None


PIN_FRESH_MIN = 15
POOL_BOTS = 5


def pool_fresh(log_root, pool, now, fresh_min=PIN_FRESH_MIN, bots=POOL_BOTS):
    """A pool with no band row is LIVE when exactly `bots` bot dirs <root>/<pool>-<Name>/ exist and every one's skill log
    was written in the last fresh_min minutes. Never raises (False = not shown live)."""
    import datetime as dt, glob, os
    try:
        dirs = [d for d in glob.glob(os.path.join(log_root, pool + '-*')) if os.path.isdir(d)
                and '-' not in os.path.basename(d)[len(pool) + 1:]]
        if len(dirs) != bots:
            return False
        for d in dirs:
            f = os.path.join(d, 'skill-%s.jsonl' % os.path.basename(d))
            t = dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc)
            if now - t > dt.timedelta(minutes=fresh_min):
                return False
        return True
    except Exception:
        return False


def pick(pins, hard_excluded, band_pools, cap):
    """PURE. pins: parse()'s list; hard_excluded: the brain subset, the live canary and draw-exclude.txt pools; band_pools:
    pools with a band row; cap: the most pools this registration may draw. -> (pools or None, why). None = no draw."""
    if not pins:
        return None, 'no pin'
    if cap < 1 or len(pins) > cap:
        return None, 'pins %d pool(s), the draw may take at most %d: refused' % (len(pins), cap)
    for p in pins:
        if p in hard_excluded:
            return None, 'pinned pool %s is excluded (the live canary, the brain subset or draw-exclude.txt): waiting' % p
        if p not in band_pools:
            return None, 'pinned pool %s is not live (no band row, and not all five bots wrote a row in %d min): waiting' % (p, PIN_FRESH_MIN)
    return list(pins), 'pinned %s exactly (owner OK: %s)' % (pins, 'given' if any(owner_only(p) for p in pins) else 'not needed')
