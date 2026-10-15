#!/usr/bin/env python3
"""towncap.py -- THE TOWN COBBLE CAP for the host reads, taken from the one place it is written.

cobblecap-1000 (OWNER 10-14 "can we up the chest limit for cobblestones to 1000"): the cap lives in bots/src/stocktarget.mjs
(`TOWN_COBBLE_CAP`, the `cobble` group's target; cobblecap.mjs re-exports it). A read that judges the cap takes it from
there -- through this module -- or from the row that carries it (`_cobble_bank ... cap=N`, the cobble `_stock_*` row's
`target=N`). Never a literal: stonecapread's `CAP = 256` and stocktargetread's `'cobble': 256` were literals, and the day the
cap moved they would have called every bank between 257 and 1000 a breach.

Which copy: the module beside the canary's own fold (STOCK_ST, else the stocktarget.mjs beside STOCK_CC, else
~/mcai-analysis/stocktarget/stocktarget.mjs, else this repo's bots/src) -- the same copy stockjournal.mjs folds with. Old
copies (before cobblecap-1000) have no TOWN_COBBLE_CAP export; their `targetOf('cobble')` answers the same question, so
both are read and must agree. No copy, or a copy that will not load, raises: a read must not fall back to a guess.

  python3 towncap.py [stocktarget.mjs]   -> prints the cap and the module it came from
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE = {}


def module_candidates(explicit=None):
    cc = os.environ.get('STOCK_CC')
    return [c for c in (explicit, os.environ.get('STOCK_ST'),
                        os.path.join(os.path.dirname(cc), 'stocktarget.mjs') if cc else None,
                        os.path.expanduser('~/mcai-analysis/stocktarget/stocktarget.mjs'),
                        os.path.join(HERE, '..', '..', 'bots', 'src', 'stocktarget.mjs')) if c]


def module_path(explicit=None):
    for c in module_candidates(explicit):
        if os.path.exists(c):
            return os.path.abspath(c)
    raise FileNotFoundError('towncap: no stocktarget.mjs among %s' % module_candidates(explicit))


def town_cobble_cap(explicit=None):
    """-> int: the town cobble cap the module's bot judges with. Raises when it cannot be read or the two answers differ."""
    path = module_path(explicit)
    if path in _CACHE:
        return _CACHE[path]
    code = ("const m = await import(%s); console.log(JSON.stringify({ cap: m.TOWN_COBBLE_CAP ?? null, "
            "target: typeof m.targetOf === 'function' ? m.targetOf('cobble') : null }))") % json.dumps('file://' + path)
    r = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, timeout=60)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError('towncap: %s would not load: %s' % (path, r.stderr[-300:]))
    v = json.loads(r.stdout.strip().splitlines()[-1])
    cap, target = v.get('cap'), v.get('target')
    if cap is not None and target is not None and cap != target:
        raise RuntimeError('towncap: %s says TOWN_COBBLE_CAP=%s but targetOf(cobble)=%s' % (path, cap, target))
    got = cap if cap is not None else target
    if not isinstance(got, int) or got <= 0:
        raise RuntimeError('towncap: %s gave no cobble cap (%r)' % (path, v))
    _CACHE[path] = got
    return got


def row_cap(fields, default):
    """The cap a `_cobble_bank` row was judged with (its own cap= field), else `default` (rows before the field)."""
    v = str((fields or {}).get('cap', ''))
    return int(v) if v.isdigit() else default


if __name__ == '__main__':
    p = module_path(sys.argv[1] if len(sys.argv) > 1 else None)
    print(town_cobble_cap(p), p)
