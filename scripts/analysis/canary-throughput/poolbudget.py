import json, datetime as dt, os, sys
D = os.path.dirname(os.path.abspath(__file__))
T = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
DRAWABLE = ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a', 'hive-b', 'hive-c', 'hive-d', 'placebo-a', 'placebo-b', 'placebo-d']
ISO = ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d']
J = [json.loads(l) for l in open(os.path.join(D, 'host/home/mike/canary-journal.jsonl')) if l.strip()]
L = [json.loads(l) for l in open(os.path.join(D, 'ledger.jsonl')) if l.strip()]
live = []
dep = {}
for r in J:
    if r['phase'] == 'deployed':
        dep.setdefault(r['run'], (T(r['ts']), r['note'].split()[0].split(',')))
for r in J:
    if r['phase'] in ('torn-down', 'promoted') and r['run'] in dep:
        t0, ps = dep.pop(r['run']); live.append((ps, t0, T(r['ts'])))
W1 = T('2026-10-08T02:40:00Z')
# ONLY the run still live at W1 (towndeposit-02). Codex r1: unmatched SEPTEMBER deployments (owner-01, digwatch-01,
# blindstep-02) were carried as live to W1 and excluded five pools for the whole window.
for k, (t0, ps) in dep.items():
    if t0 >= T('2026-10-07T00:00:00Z'):
        live.append((ps, t0, W1))
dec = [(T(r['ts']), [p.strip() for p in str(r.get('canary_pool') or '').split(',') if p.strip() and 'FLEET' not in p]) for r in L]
W0 = T('2026-10-03T00:00:00Z')


def free(t, E, pools):
    busy = set()
    for ps, a, b in live:
        if a <= t < b:
            busy |= set(ps)
    for ts, ps in dec:
        if ts <= t < ts + dt.timedelta(hours=E):
            busy |= set(ps)
    return [p for p in pools if p not in busy]


for E in (12, 6, 0):
    for name, pools in (('11 drawable', DRAWABLE), ('15 (+isolated)', DRAWABLE + ISO)):
        n = 0; c = {}; t = W0
        while t < W1:
            f = len(free(t, E, pools)); c[f] = c.get(f, 0) + 1; n += 1; t += dt.timedelta(minutes=10)
        ge = lambda k: sum(v for kk, v in c.items() if kk >= k) / n
        med = sorted(k for k, v in c.items() for _ in range(v))[n // 2]
        print('E=%2dh %-15s free (not live, not excluded): median %2d | P(>=2) %3.0f%% | P(>=4) %3.0f%% | P(>=6) %3.0f%% | P(>=8) %3.0f%%'
              % (E, name, med, 100 * ge(2), 100 * ge(4), 100 * ge(6), 100 * ge(8)))
