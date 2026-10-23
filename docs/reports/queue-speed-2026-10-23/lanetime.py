#!/usr/bin/env python3
"""lanetime.py <snapshot dir> <from ISO> <to ISO> -- lane accounting, READ-ONLY, from copies of the host's
~/canary-journal.jsonl and ~/digest/sched.log (the snapshot dir holds both, sched.log under digest/).

Every minute of [from, to) gets ONE category:
  live        a run is deployed and not yet closed (journal `deployed` .. last `torn-down` / fleet-wide `promoted`)
  deploying   `drawn` .. `deployed`
  draw-wait   the run's loop is alive in its draw phase (`draw` .. `drawn`): the scheduler sees S2/S3/S7 busy
  idle:<why>  anything else, labelled with the scheduler's last decision line before that minute (BLOCK H2, WAIT R10...)
Positive control: the live minutes must equal the sum of (close - deployed) over the runs, printed per run."""
import bisect, collections, datetime as dt, json, re, sys

T = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def intervals(journal):
    runs = collections.OrderedDict()
    for r in journal:
        runs.setdefault(r['run'], []).append(r)
    iv = []
    for run, rs in runs.items():
        ph = lambda p: [T(r['ts']) for r in rs if r['phase'] == p]
        dep = ph('deployed')
        close = ph('torn-down') + [T(r['ts']) for r in rs if r['phase'] == 'promoted' and 'fleet-wide' in str(r.get('note'))]
        draw, drawn = ph('draw'), ph('drawn')
        if draw and drawn:
            iv.append((min(draw), min(drawn), 'draw-wait', run))
        elif draw:
            iv.append((min(draw), max(T(r['ts']) for r in rs), 'draw-wait', run))
        if drawn and dep:
            iv.append((min(drawn), min(dep), 'deploying', run))
        if dep:
            iv.append((min(dep), max(close) if close else None, 'live', run))
    # a run with no close row (an old manual run) ends at the next run's deploy: never a 'live' that covers later runs
    deps = sorted(s for s, _e, k, _r in iv if k == 'live')
    out = []
    for s, e, k, run in iv:
        if k == 'live' and e is None:
            later = [d for d in deps if d > s]
            e = later[0] if later else None
        out.append((s, e, k, run))
    return out


def sched_lines(path):
    out = []
    for l in open(path, errors='replace'):
        p = l.split(' ', 2)
        if len(p) == 3 and re.match(r'\d{4}-\d\d-\d\dT', p[0]):
            try:
                out.append((T(p[0]), p[1].rstrip(':'), p[2].strip()))
            except ValueError:
                pass
    out.sort(key=lambda x: x[0])
    return out


def main(snap, A, B):
    a, b = T(A), T(B)
    J = [json.loads(l) for l in open(snap + '/canary-journal.jsonl') if l.strip()]
    iv = intervals(J)
    sl = sched_lines(snap + '/digest/sched.log')
    keys = [x[0] for x in sl]

    def reason(m):
        i = bisect.bisect_right(keys, m) - 1
        while i >= 0 and sl[i][1] in ('note', 'another', 'RE-CHECK'):
            i -= 1
        if i < 0:
            return 'unknown', '?'
        _t, kind, txt = sl[i]
        codes = re.findall(r'(?:^|\| )([SHRLQ]\d*) ', txt)
        return '%s %s' % (kind, codes[0] if codes else ''), txt.split(' | ')[0][:120]

    tot, why, live_by = collections.Counter(), collections.defaultdict(collections.Counter), collections.Counter()
    m = a
    while m < b:
        k = None
        for s, e, kind, run in iv:
            if kind == 'live' and s <= m < (e or b):
                k = ('live', run)
                break
        if k is None:
            for s, e, kind, run in iv:
                if kind != 'live' and s <= m < (e or b):
                    k = (kind, run)
                    break
        if k and k[0] == 'live':
            tot['live'] += 1; live_by[k[1]] += 1
        elif k:
            tot[k[0]] += 1; why[k[0]][k[1]] += 1
        else:
            r = reason(m)
            tot['idle: ' + r[0]] += 1; why['idle: ' + r[0]][r[1]] += 1
        m += dt.timedelta(minutes=1)
    print('window %s -> %s = %.1f h' % (A, B, (b - a).total_seconds() / 3600))
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1]):
        print('%-30s %6.1f h' % (k, v / 60))
        for w, n in why[k].most_common(8):
            print('        %5.1f h  %s' % (n / 60, w))
    print('live by run (positive control: each = close - deployed, clipped to the window):')
    for run, n in live_by.items():
        print('   %-18s %5.1f h' % (run, n / 60))


if __name__ == '__main__':
    main(*sys.argv[1:4])
