#!/usr/bin/env python3
"""brain-01 step 3 readout (sandbox4 closed loop, today's fleet code + brain-01): per run, from the bots' own rows on
the bots host, at the 70-min horizon (as C1/C2): stuck min/bot and milestones (cl_metrics.py), and from the decision
rows: model decisions, refused-at-admission share, success share, brain shares, unserved. Paired within blocks.
    python3 brain01_loop_read.py
"""
import json, subprocess, statistics as st, math
from datetime import datetime, timedelta, timezone
RUNS = '/Users/darrellmiller/mbench-ctl/bench/models/closedloop/results/runs.jsonl'
ssh = lambda c: subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.31', c], stdin=subprocess.DEVNULL, capture_output=True, text=True).stdout
rows = [json.loads(l) for l in open(RUNS) if l.strip()]
rows = [r for r in rows if r.get('arm', '') in ('brain01-gemma4', 'brain01-local') and not r.get('flag')]
DEC = r'''
import sys, json, glob
t0, t1 = sys.argv[1], sys.argv[2]; c = {}
for f in glob.glob(sys.argv[3] + '/*/llm-*.jsonl'):
    for l in open(f):
        d = json.loads(l)
        if not (t0 <= d['@timestamp'] < t1): continue
        llm = d['llm']; o = (d.get('outcome') or {}).get('status')
        if (llm.get('latency_ms') or 0) <= 0: c['order'] = c.get('order', 0) + 1; continue
        k = lambda n: c.__setitem__(n, c.get(n, 0) + 1)
        k('model'); k('brain:%s' % llm.get('brain'))
        if o == 'aborted' and llm.get('admission') is None: k('refused')
        if o == 'success': k('success')
        if llm.get('endpoint') is None: k('unserved')
        if not llm.get('schema_valid'): k('invalid')
print(json.dumps(c))
'''
subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.31', 'cat > ~/brain01/loopdec.py'], input=DEC, text=True, check=True)
rows = [r for r in rows if not str(r.get('flag') or '').startswith('INVALID')]
out = []
for r in rows:
    t0 = datetime.strptime(r['start'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc); t1 = t0 + timedelta(minutes=70)
    f = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
    m = json.loads(ssh('python3 ~/mbench-cl/cl_metrics.py ~/mbench-cl/runs/%s --start %s --end %s 2>/dev/null' % (r['run_id'], f(t0), f(t1))) or '{}')
    d = json.loads(ssh("python3 ~/brain01/loopdec.py %s %s ~/mbench-cl/runs/%s" % (f(t0), f(t1), r['run_id'])) or '{}')
    n = d.get('model', 0) or 1
    out.append({'run': r['run_id'], 'arm': r['arm'][8:], 'block': r['run_id'].rsplit('-b', 1)[-1], 'stuck': m.get('stuck_min_per_bot'),
                'stone': (m.get('milestone_bots') or {}).get('stone_pickaxe'), 'iron': (m.get('milestone_bots') or {}).get('iron_ingot'),
                'output': round((m.get('team_output_per_h') or 0) * 70 / 60, 1), 'deaths': m.get('deaths'), 'model': d.get('model'),
                'refused': round(d.get('refused', 0) / n, 3), 'success': round(d.get('success', 0) / n, 3),
                'gemma4': round(d.get('brain:gemma4', 0) / n, 3), 'local': round(d.get('brain:local', 0) / n, 3),
                'unserved': d.get('unserved', 0), 'invalid': d.get('invalid', 0)})
for o in sorted(out, key=lambda o: (o['block'], o['arm'])):
    print(json.dumps(o))
print()
for k in ('stuck', 'refused', 'success', 'stone', 'iron', 'output'):
    diffs = []
    for b in sorted({o['block'] for o in out}):
        g = [o for o in out if o['block'] == b and o['arm'] == 'gemma4']; l = [o for o in out if o['block'] == b and o['arm'] == 'local']
        if g and l and g[0][k] is not None and l[0][k] is not None: diffs.append(g[0][k] - l[0][k])
    if len(diffs) >= 2:
        sd = st.stdev(diffs); half = {1: 12.706, 2: 4.303, 3: 3.182}.get(len(diffs) - 1, 2.776) * sd / math.sqrt(len(diffs))
        print('%-8s gemma4 - local per block %s; mean %+.3f, 95%% CI [%+.3f, %+.3f]' % (k, ', '.join('%+.3f' % x for x in diffs), st.mean(diffs), st.mean(diffs) - half, st.mean(diffs) + half))
    else:
        print('%-8s per block %s' % (k, diffs))
