#!/usr/bin/env python3
"""bagnull.py <regdir> <out.jsonl> [procs]  -- the NO-CHANGE null of bagread's fields at the +1440 read, drawn the way
each bag fix is drawn (round 1, Claude: a band from random pools is biased lenient -- full-bag pools regress).

For every cut (each 6 h, 10-03 00Z .. the last cut with 24 h of POST in the logs):
  1. every bot's rows over [cut - 24 h, cut + 24 h] are accrued ONCE with bagread's own estimator (bagread.bot_rows +
     bagread.accrue, keyed per bot; no version filter -- a no-change canary is fictitious);
  2. each fix's draw filter is evaluated AT THE CUT with drawexposure.py's own scan/count over its registered hours
     (placebo-c and isolated pools excluded, as drawrec does); NOT replicated: drawrec's productivity band and the
     12-h per-pool exclusion (stated);
  3. if >= 4 pools pass, up to 10 random 4-pool draws (seeded by the cut) are aggregated -> one record per draw and field.
  A 'random' scheme (any 4 drawable pools) is recorded beside, for the comparison.
Out: one JSON line per (cut, scheme, draw): {'cut', 'scheme', 'draw', fields...}.
"""
import os, sys, json, glob, random, itertools, datetime as dt, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.expanduser('~/mcai-analysis')]
import bagread as BR
import drawexposure as DE

ROOT = '/var/log/mcai'
REGDIR, OUT = sys.argv[1], sys.argv[2]
PROCS = int(sys.argv[3]) if len(sys.argv) > 3 else 3
RUNS = ('toolhygiene-01', 'peacefulkit-01', 'junkwell-02', 'gridfix-01', 'stonecap-01')   # bamboo-01, bamboocraft-01: ordinary canaries (operator + Codex 10-08)
FILTERS = {}
for run in RUNS:
    f = sorted(glob.glob(os.path.join(REGDIR, '%s.*.json' % run)))[0]
    FILTERS[run] = json.load(open(f))['draw_exposure']
pool_of = BR.pool_of
BOTS = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(ROOT + '/*-*/'))
POOLS = sorted({pool_of(b) for b in BOTS})
DRAWABLE = [p for p in POOLS if p != 'placebo-c' and not p.startswith('isolated') and not p.startswith('_')]


def per_bot(cut):
    tw = BR.new_tw(); ob = [0]; corrupt = 0; bad = 0; nrows = 0
    for b in BOTS:
        rows, bd, cor, dts = BR.bot_rows(b, cut - dt.timedelta(hours=24), cut + dt.timedelta(hours=24), ROOT)
        bad += bd; corrupt += cor; nrows += len(rows)
        if rows:
            BR.accrue(rows, cut, b, '', tw, ob, cut + dt.timedelta(hours=24), BR.censor_spans(dts))
    return tw, bad, corrupt, nrows


def eligible(cut, de):
    hours = de.get('hours', 6)
    per, _bots, rows, _k = DE.scan((cut - dt.timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%S'), cut.strftime('%Y-%m-%dT%H:%M:%S'))
    return [p for p in DRAWABLE if all(DE.count(per, p, r) >= r['min'] for r in de.get('require', []))], rows


def agg(tw, draw):
    out = BR.new_tw()
    for (period, b), v in tw.items():
        arm = 'canary' if pool_of(b) in draw else 'control'
        a = out[(period, arm)]
        for i, x in enumerate(v):
            a[i] += x
    return out


def one_cut(cut):
    tw, bad, corrupt, nrows = per_bot(cut)
    invalid = BR.blind(bad, corrupt, nrows)     # the live read's own rule: such a window would emit no primary
    recs = []
    rng = random.Random(int(cut.timestamp()))
    schemes = {'random': (DRAWABLE, None)}
    for run, de in FILTERS.items():
        el, rows = eligible(cut, de)
        schemes[run] = (el, rows)
    for scheme, (pools, rows) in schemes.items():
        combos = list(itertools.combinations(sorted(pools), 4)) if len(pools) >= 4 else []
        for draw in (rng.sample(combos, min(10, len(combos))) if combos else []):
            a = agg(tw, set(draw))
            rec = {'cut': cut.isoformat(), 'scheme': scheme, 'draw': list(draw), 'eligible': len(pools), 'scan_rows': rows,
                   'unreadable': bad, 'corrupt': corrupt, 'rows': nrows, 'invalid': invalid}
            rec.update({f: BR.did_of(a, i) for f, i in BR.FIELDS})
            recs.append(rec)
        if not combos:
            recs.append({'cut': cut.isoformat(), 'scheme': scheme, 'draw': None, 'eligible': len(pools), 'scan_rows': rows})
    return recs


if __name__ == '__main__':
    last = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24, minutes=30)
    cuts = []
    c = dt.datetime(2026, 10, 3, 0, tzinfo=dt.timezone.utc)
    while c <= last:
        cuts.append(c); c += dt.timedelta(hours=6)
    with cf.ProcessPoolExecutor(PROCS) as ex:
        for recs in ex.map(one_cut, cuts):
            with open(OUT, 'a') as fh:
                for r in recs:
                    fh.write(json.dumps(r) + '\n')
            print(recs[0]['cut'], {s: sum(1 for r in recs if r['scheme'] == s and r.get('draw')) for s in ['random'] + list(RUNS)}, flush=True)
