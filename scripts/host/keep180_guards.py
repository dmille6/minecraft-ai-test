#!/usr/bin/env python3
"""keep180_guards.py <out.jsonl> [procs]  -- calibration for the owner's KEEP-at-+180 rule (10-08): the HARM GUARDS a
KEEP must pass, run on NO-CHANGE draws in the two designs the owner compares:
    A (new)    4 random drawable pools, read at W = 180
    B (today)  2 random drawable pools, read at W = 360
Each draw runs the LIVE immobiledid (/tmp/immobiledid.py, the read every canary registers) as a dry run (nullrun.py with
NULLRUN_NO_REFUSAL=1: emit is stubbed, nothing written) and records its v15c / v11 / harm fields. Cuts every 6 h,
10-03 00Z .. the last cut with 6 h of POST in the logs; 2 draws per design per cut (seeded by the cut). keep180_power.py
then injects harm into these null values and computes the false-KEEP rate of each design. Read-only."""
import os, sys, json, glob, random, subprocess, datetime as dt, concurrent.futures as cf
OUT = sys.argv[1]; PROCS = int(sys.argv[2]) if len(sys.argv) > 2 else 2
HERE = os.path.dirname(os.path.abspath(__file__))
pool_of = lambda b: '-'.join(b.split('-')[:2])
POOLS = sorted({pool_of(os.path.basename(d.rstrip('/'))) for d in glob.glob('/var/log/mcai/*-*/')})
DRAWABLE = [p for p in POOLS if p != 'placebo-c' and not p.startswith('isolated') and not p.startswith('_')]
DESIGNS = {'A': (4, 180), 'B': (2, 360)}
done = set()
if os.path.exists(OUT):
    for l in open(OUT):
        try:
            o = json.loads(l)
            if o.get('fields'):
                done.add((o['design'], o['cut'], tuple(o['draw'])))
        except ValueError:
            pass
jobs = []
c = dt.datetime(2026, 10, 3, 0, tzinfo=dt.timezone.utc)
last = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6, minutes=30)
while c <= last:
    for d, (k, W) in DESIGNS.items():
        rng = random.Random(int(c.timestamp()) * 10 + k)
        for _ in range(2):
            draw = sorted(rng.sample(DRAWABLE, k))
            if (d, c.isoformat(), tuple(draw)) not in done:
                jobs.append((d, c, draw, W))
    c += dt.timedelta(hours=6)


def run(job):
    d, cut, draw, W = job
    env = dict(os.environ, NULLRUN_NO_REFUSAL='1', CANARY_DRYRUN='%s::%s' % (','.join(draw), cut.isoformat().replace('+00:00', 'Z')))
    p = subprocess.run(['prlimit', '--as=%d' % (20 * 1024 ** 3), 'nice', 'python3', os.path.join(HERE, 'nullrun2.py'), '/tmp/immobiledid.py', str(W)],
                       cwd='/opt/minecraft-ai/scripts', env=env, capture_output=True, text=True, timeout=3600)
    line = next((l for l in p.stdout.splitlines() if l.startswith('NULLFIELDS ')), None)
    return {'design': d, 'cut': cut.isoformat(), 'draw': draw, 'W': W, 'rc': p.returncode,
            'fields': json.loads(line[len('NULLFIELDS '):])['fields'] if line else None, 'tail': '' if line else (p.stdout + p.stderr)[-300:]}


with cf.ThreadPoolExecutor(PROCS) as ex:
    for rec in ex.map(run, jobs):
        with open(OUT, 'a') as fh:
            fh.write(json.dumps(rec, default=str) + '\n')
        print(rec['design'], rec['cut'], rec['draw'], 'ok' if rec['fields'] else 'FAILED ' + rec['tail'][-150:], flush=True)
