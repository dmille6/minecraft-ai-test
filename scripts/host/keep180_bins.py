#!/usr/bin/env python3
"""keep180_bins.py <out.pkl> [procs]  -- per-bot sufficient statistics of immobiledid's HARM GUARDS (v15c movement guards,
v11 climbs/livelock, ladders, deaths), for every 6-h cut, in the PRE (180 min) and in two POST windows (180 and 360 min),
so any draw of pools can be scored for both designs of the owner's KEEP-at-+180 question (10-08) without re-reading logs.

THE ESTIMATOR IS immobiledid's, restated per bot (the live read loads every bot at once: 28 GB at W=360, so it cannot be
run hundreds of times). Per bot and era: grid minutes with a position and their immobile count (60-min trailing
displacement < 6 blocks) and the bot's immobile-run >= 30 flag; blocks moved (consecutive positions, each step capped at
20, the chain reset per era); working minutes (distinct minute indices carrying a skill row that is not '_x'/'status');
items gathered (positive inventory_delta on gather/mine/collect/harvest rows); _entombed+_marooned rows; _livelock_escape
rows and their 'blocks spent'; _death rows. A row counts when -PRE <= d <= W (minutes from the cut), era post iff d >= 0,
exactly as immobiledid. keep180_check.py asserts the aggregation equals the live immobiledid on real draws.
Out: {'cuts': {iso: {bot: {'pre': {...}, 'post180': {...}, 'post360': {...}}}}}"""
import os, sys, re, json, glob, gzip, pickle, datetime as dt, concurrent.futures as cf
from collections import Counter
OUT = sys.argv[1]; PROCS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
PRE = 180
GATHERISH = ('gather', 'mine', 'collect', 'harvest')
SPENT = re.compile(r'blocks spent (\d+)')
_TS = re.compile(r'"@timestamp":\s*"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)')
BOTS = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob('/var/log/mcai/*-*/'))
BOTS = [b for b in BOTS if not b.startswith('isolated') and not b.startswith('self-')]


def bot_rows(b, lo, hi):
    los, his = lo.strftime('%Y-%m-%dT%H:%M:%S'), hi.strftime('%Y-%m-%dT%H:%M:%S')
    out = []
    for f in sorted(glob.glob('/var/log/mcai/%s/skill-*.jsonl*' % b)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < lo:
                continue
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
            with fh:
                for line in fh:
                    m = _TS.search(line[:200])
                    if not m or not (los <= m.group(1) <= his):
                        continue
                    try:
                        d = json.loads(line)
                        sk = d.get('skill') or {}
                        n = sk.get('name')
                        if not n:
                            continue
                        t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                    except Exception:
                        continue
                    out.append((t, str(n), sk.get('detail') or '', d.get('bot') or {}, sk))
        except (OSError, EOFError):
            continue
    out.sort(key=lambda r: r[0])
    return out


def stats(rows, cut, W):
    """-> {'pre': {...}, 'post': {...}} for one bot over [cut-PRE, cut+W], immobiledid's definitions."""
    E = {e: Counter() for e in ('pre', 'post')}
    runflag = {'pre': False, 'post': False}
    spent = []
    pos = [(t, b.get('pos')) for t, n, det, b, sk in rows if (b.get('pos') or {}).get('x') is not None]
    t0 = cut - dt.timedelta(minutes=PRE); t1 = cut + dt.timedelta(minutes=W); i = 0; j = 0; immrun = 0; m = t0
    while m < t1 and pos:
        while j < len(pos) and pos[j][0] <= m:
            j += 1
        cur = pos[j - 1][1] if j > 0 else None
        back = m - dt.timedelta(minutes=60)
        while i < len(pos) and pos[i][0] < back:
            i += 1
        window = [q for _, q in pos[i:j]]
        if cur and window:
            far = max(((q['x'] - cur['x']) ** 2 + (q['z'] - cur['z']) ** 2) ** 0.5 for q in window)
            era = 'post' if m >= cut else 'pre'
            E[era]['mins'] += 1
            if far < 6:
                E[era]['imm'] += 1; immrun += 1
                if immrun >= 30:
                    runflag[era] = True
            else:
                immrun = 0
        m += dt.timedelta(minutes=1)
    last = {}; wmin = {'pre': set(), 'post': set()}
    for t, n, det, b, sk in rows:
        d = (t - cut).total_seconds() / 60
        if d < -PRE or d > W:
            continue
        era = 'post' if d >= 0 else 'pre'
        if n == '_livelock_escape':
            E[era]['ll'] += 1
            mm = SPENT.search(det)
            if mm and era == 'post':
                spent.append(int(mm.group(1)))
        if n in ('_entombed', '_marooned'):
            E[era]['cl'] += 1
        if n == '_death':
            E[era]['deaths'] += 1
        q = b.get('pos')
        if q and q.get('x') is not None:
            if era in last:
                E[era]['mv'] += min(20, ((q['x'] - last[era]['x']) ** 2 + (q['z'] - last[era]['z']) ** 2) ** 0.5)
            last[era] = q
        if not n.startswith('_') and n != 'status':
            wmin[era].add(int(d // 1))
        if n in GATHERISH:
            E[era]['it'] += sum(v for v in ((sk.get('inventory_delta') or {}).values()) if isinstance(v, (int, float)) and v > 0)
    for era in ('pre', 'post'):
        E[era]['wk'] = len(wmin[era])
    out = {e: dict(E[e]) for e in E}
    out['pre']['run30'] = runflag['pre']; out['post']['run30'] = runflag['post']; out['post']['spent'] = spent
    return out


def one_cut(cut):
    res = {}
    for b in BOTS:
        rows = bot_rows(b, cut - dt.timedelta(minutes=PRE + 61), cut + dt.timedelta(minutes=360))
        s180 = stats(rows, cut, 180); s360 = stats(rows, cut, 360)
        res[b] = {'pre': s180['pre'], 'post180': s180['post'], 'post360': s360['post']}
    return cut.isoformat(), res


if __name__ == '__main__':
    cuts = []; c = dt.datetime(2026, 10, 3, 0, tzinfo=dt.timezone.utc)
    last = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6, minutes=30)
    while c <= last:
        cuts.append(c); c += dt.timedelta(hours=6)
    out = {'cuts': {}}
    with cf.ProcessPoolExecutor(PROCS) as ex:
        for iso, res in ex.map(one_cut, cuts):
            out['cuts'][iso] = res
            print(iso, len(res), 'bots', flush=True)
    pickle.dump(out, open(OUT, 'wb'))
