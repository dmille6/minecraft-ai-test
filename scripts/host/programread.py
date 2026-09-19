#!/usr/bin/env python3
"""
programread.py -- the five committed program numbers, once a night, in one line each.

WHY THIS EXISTS (measured 2026-09-18): of the five numbers the colony reliability
program is judged on, only THREE had a standing read. The 30-minute digest carries
deaths and immobility (and items/bot-h, which the program explicitly RETIRED as a
headline); ironfunnel.py carries the iron-pickaxe share. Gather success and stock
returned had no standing read anywhere -- and they are the two that are failing.
Gather was last quoted at 30% on 13 Sep and read 20.3% on 18 Sep; nobody saw it
move, because nothing was looking.

DENOMINATORS ARE PRINTED, ALWAYS. Deposit in particular reads 11.2% or 22.7%
depending on whether `no_effect` is in the denominator, and a silent switch
between the two would manufacture a regression or hide one. Both are printed.

Split by code.version so a promotion or revert inside the window cannot blur the
read (the program requires a 72-h continuous read at two weeks).

Usage:  programread.py [hours]      default 24
"""
import sys, collections, re

sys.path.insert(0, '/home/mike/mcai-analysis')          # golden analysis library
from lib.telemetry import Events

HOURS = float(sys.argv[1]) if len(sys.argv) > 1 else 24.0
ev = Events.load(since_minutes=int(HOURS * 60))
R = ev.rows

# POSITIVE CONTROL FIRST. Every negative below is only as good as this line:
# if the walk is empty or one-kinded, nothing after it means anything.
bots = {(r['bot'] or {}).get('name') for r in R if (r['bot'] or {}).get('name')}
kinds = {r['name'] for r in R}
if not R or len(kinds) < 10 or len(bots) < 2:
    print(f"program read REFUSED: walk looks broken -- rows={len(R)} bots={len(bots)} kinds={len(kinds)}")
    sys.exit(1)
bot_h = len(bots) * HOURS

def ver(r):
    v = (r['raw'].get('code') or {}).get('version') or '?'
    return v.split('+')[0]                               # strip the build suffix

def status(r):
    return ((r['raw'].get('skill') or {}).get('status'))

def block(rows, label, denom_bots, denom_h):
    deaths = [r for r in rows if r['name'] == '_death']
    drown = sum(1 for r in deaths if 'drown' in (r['detail'] or '').lower())
    g = collections.Counter(status(r) for r in rows if r['name'] == 'gather')
    d = collections.Counter(status(r) for r in rows if r['name'] == 'deposit')
    bh = denom_bots * denom_h
    g_term = g['success'] + g['failed'] + g['aborted']
    d_strict = d['success'] + d['failed'] + d['no_effect'] + d['aborted']
    d_acted = d['success'] + d['failed'] + d['aborted']
    # THE PROGRAM COMMITS TO items/bot-h RETURNED TO STOCK; this script reported a
    # deposit SUCCESS RATE, which is a different quantity and cannot be compared to
    # a >=20 items/bot-h gate at all. Measured 2026-09-19 over 24 h: the rate said
    # 9.1% while the actual transfer was 10,691 items = 5.57/bot-h against the >=20
    # two-week gate -- a fail the rate could not express, in either direction.
    #
    # The quantity is the negative side of `inventory_delta` on a deposit row: what
    # left the bot and went into a chest. Two things this gets right that counting
    # `status == success` does not:
    #   - A ROW THAT ENDS `failed` OR `no_effect` CAN STILL HAVE MOVED ITEMS. Same
    #     window: 755 items on 138 failed rows (the chest filled mid-transfer) and
    #     398 on 136 no_effect rows, 1,153 units = 10.8% of the total. Scoring only
    #     successes quietly discards stock that is demonstrably in a chest.
    #   - The row's own prose undercounts. `detail` says "deposited N items" for the
    #     named item only: it disagreed with the delta on 222 of 397 successes
    #     ("deposited 1 items" for {iron_ingot -1, stone_pickaxe -1}).
    # A deposit can also hand items BACK (89 units in the window, chest-crafting and
    # the like), so the returned figure is net.
    stock_out = stock_in = stock_ok = 0
    stock_mix = collections.Counter()
    for r in rows:
        if r['name'] != 'deposit':
            continue
        sk = r['raw'].get('skill') or {}
        for k, v in ((sk.get('inventory_delta')) or {}).items():
            if v < 0:
                stock_out += -v
                stock_mix[k] += -v
                if sk.get('status') == 'success':
                    stock_ok += -v
            else:
                stock_in += v
    stock_net = stock_out - stock_in
    stock_partial = stock_out - stock_ok        # moved on rows that did not end `success`
    pos = collections.defaultdict(list)
    for r in rows:
        p, b = (r['bot'] or {}).get('pos'), (r['bot'] or {}).get('name')
        if p and b: pos[b].append((p['x'], p['z']))
    imm = [b for b, ps in pos.items()
           if max(x for x, _ in ps) - min(x for x, _ in ps) < 6
           and max(z for _, z in ps) - min(z for _, z in ps) < 6]
    out = [f"program read [{label}] {denom_h:.0f}h, {denom_bots} bots, {bh:.0f} bot-h"]
    out.append(f"  deaths        {len(deaths)} = {len(deaths)/bh:.4f}/bot-h "
               f"({drown} drowned, {len(deaths)-drown} other)   [2wk <=0.05  6wk <=0.03]")
    out.append(f"  immobile      {len(imm)}/{len(pos)} = {100*len(imm)/len(pos) if pos else 0:.1f}% "
               f"never moved 6 blocks in the window   [2wk <=2%  6wk <=1%]")
    out.append(f"  gather        {g['success']}/{g_term} terminal = "
               f"{100*g['success']/g_term if g_term else 0:.1f}%   [2wk >=40%  6wk >=55%]   "
               f"(failed {g['failed']}, aborted {g['aborted']}, unknown {g['unknown']})")
    out.append(f"  stock         {stock_net} items net into chests = {stock_net/bh:.2f}/bot-h"
               f"   [2wk >=20  6wk >=30]")
    out.append(f"                (out {stock_out}, back to bots {stock_in}; "
               f"{stock_ok} of the out on rows that ended `success`, "
               f"{stock_partial} on rows that ended failed/no_effect)")
    out.append(f"                mix: {', '.join(f'{k} {v}' for k, v in stock_mix.most_common(6))}")
    out.append(f"  deposit rate  {d['success']}/{d_strict} all = "
               f"{100*d['success']/d_strict if d_strict else 0:.1f}%  |  "
               f"{d['success']}/{d_acted} excl no_effect = "
               f"{100*d['success']/d_acted if d_acted else 0:.1f}%   "
               f"(an OUTCOME RATE, NOT the program's stock number; "
               f"no_effect {d['no_effect']} -- say which denominator)")
    fc = collections.Counter((r['raw'].get('skill') or {}).get('fail_class')
                             for r in rows if r['name'] == 'gather' and status(r) == 'failed')
    out.append(f"  gather fails  {', '.join(f'{k}={v}' for k, v in fc.most_common(5))}")
    return "\n".join(out)

print(block(R, "fleet", len(bots), HOURS))

# Split by code version. One version live is the normal case and prints nothing
# extra; two means a canary, and the program read must not blur them together.
byv = collections.defaultdict(list)
for r in R: byv[ver(r)].append(r)
if len(byv) > 1:
    print(f"  -- {len(byv)} code versions in this window; per-version below, "
          f"NOT comparable as a canary read (no DiD, no exposure cut) --")
    for v, rows in sorted(byv.items(), key=lambda x: -len(x[1])):
        vb = {(r['bot'] or {}).get('name') for r in rows if (r['bot'] or {}).get('name')}
        # bot-hours are unknown per version (a bot can cross versions mid-window),
        # so the denominator is named as nominal rather than quietly assumed exact.
        print(block(rows, f"{v} nominal", len(vb), HOURS))

# ---------------------------------------------------------------------------
# THROUGHPUT. "Two canaries, zero results" is the standing complaint about this
# project and nothing measured it: the five program numbers are all about the
# BOTS, and none of them notices a week in which the pipeline produced no
# verdict at all. Measured from the decisions ledger, which is the only record
# that a canary was actually closed rather than merely analysed.
#
# INCONCLUSIVE is counted separately and is NOT a result. It is a legitimate
# close -- often the honest one -- but a fortnight of them means the harness,
# not the colony, is what is being debugged.
import datetime as _dt, json as _json, os as _os
_LED = '/var/log/mcai/_canary-decisions.jsonl'
_DAYS = 14.0
try:
    _now = _dt.datetime.now(_dt.timezone.utc)
    _cut = _now - _dt.timedelta(days=_DAYS)
    _all, _win, _bad = 0, [], 0
    with open(_LED) as _f:
        for _l in _f:
            _l = _l.strip()
            if not _l:
                continue
            _all += 1
            try:
                _r = _json.loads(_l)
                _t = _dt.datetime.fromisoformat(_r['ts'])
            except Exception:
                _bad += 1                      # a line we cannot read is reported, never skipped silently
                continue
            if _t >= _cut:
                _win.append((_t, (_r.get('decision') or '?').upper(), _r.get('canary_sha') or '?'))
    _c = collections.Counter(d for _, d, _s in _win)
    _results = _c['KEEP'] + _c['REVERT']
    # POSITIVE CONTROL: the ledger is not empty and this reader can parse it.
    # Without this line a broken path and a quiet fortnight look identical.
    if not _all:
        print(f"throughput     REFUSED: {_LED} is empty or unreadable -- no claim about the pipeline")
    else:
        print(f"throughput    {len(_win)} decisions in {_DAYS:.0f} d = {len(_win)/_DAYS:.2f}/day; "
              f"of these {_results} are results (KEEP {_c['KEEP']}, REVERT {_c['REVERT']}) "
              f"= {_results/_DAYS:.2f}/day, and {_c['INCONCLUSIVE']} INCONCLUSIVE "
              f"(a close, not a result)")
        # AND THE LAST 7 DAYS BESIDE IT. A fortnight average hides a slowdown:
        # measured 2026-09-19 the ledger ran 13 decisions on 09-11 and 2-4/day
        # since, so the 14-d mean flatters the week it is quoted in.
        _w7 = [x for x in _win if x[0] >= _now - _dt.timedelta(days=7)]
        _c7 = collections.Counter(d for _, d, _s in _w7)
        print(f"              last 7 d: {len(_w7)} decisions = {len(_w7)/7:.2f}/day, "
              f"{_c7['KEEP'] + _c7['REVERT']} results = {(_c7['KEEP'] + _c7['REVERT'])/7:.2f}/day "
              f"(KEEP {_c7['KEEP']}, REVERT {_c7['REVERT']}, INCONCLUSIVE {_c7['INCONCLUSIVE']})")
        _last = max((t for t, _d, _s in _win), default=None)
        print(f"              ledger holds {_all} decisions in all"
              + (f", {_bad} unparseable" if _bad else "")
              + (f"; last decision {_last:%Y-%m-%d %H:%M}Z, "
                 f"{(_now-_last).total_seconds()/3600:.1f} h ago" if _last else
                 "; NONE in the window -- the pipeline produced nothing"))
except FileNotFoundError:
    print(f"throughput    REFUSED: {_LED} not found -- no claim about the pipeline")
