#!/usr/bin/env python3
"""Stage C1 readout: every valid run cut to the SAME horizon (default 70 min from its start; the shortest valid
window), then arms compared WITHIN blocks (paired by matched start) -- the run is the unit.

    python3 cl_analyze.py results/runs.jsonl [--horizon 70] [--exclude RUN_ID ...]   (mini; ssh to the bots host)

Excluded by rule: smoke runs, runs with a `flag` (tunnel/endpoint interruption), and runs listed with --exclude.
The q25-7b block-1 run lost its endpoint at 15:32Z (75 min in), which is why the horizon is 70 min for everyone.
"""
import argparse, json, statistics, subprocess, sys
from datetime import datetime, timedelta, timezone

BOTS = 'mike@10.0.0.31'


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('runs'); ap.add_argument('--horizon', type=float, default=70)
    ap.add_argument('--exclude', nargs='*', default=[]); ap.add_argument('--json')
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.runs) if l.strip()]
    rows = [r for r in rows if 'smoke' not in r['run_id'] and r['run_id'] not in a.exclude and not r.get('flag')]
    out = []
    for r in rows:
        t0 = datetime.strptime(r['start'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        t1 = t0 + timedelta(minutes=a.horizon)
        cmd = 'python3 ~/mbench-cl/cl_metrics.py ~/mbench-cl/runs/%s --start %s --end %s 2>/dev/null' % (r['run_id'], iso(t0), iso(t1))
        m = json.loads(subprocess.run(['ssh', '-o', 'BatchMode=yes', BOTS, cmd], stdin=subprocess.DEVNULL,
                                      capture_output=True, text=True).stdout)
        blk = r['run_id'].rsplit('-b', 1)[-1]
        out.append({'run_id': r['run_id'], 'arm': r['arm'], 'block': blk, 'output': round(m.get('team_output_per_h', 0) * a.horizon / 60, 1),
                    'milestones': m.get('milestone_bots'), 'pickless': m.get('pickless_share'), 'stuck_min': m.get('stuck_min_per_bot'),
                    'loops_h': m.get('loops_per_bot_h'), 'deaths': m.get('deaths'), 'dec_h': m.get('decisions_per_bot_h'),
                    'lat_p50': m.get('latency_p50_med'), 'bots_live': sum(1 for b in m['bots'] if b.get('rows'))})
    arms = sorted({o['arm'] for o in out})
    print('| run | arm | block | team output at %d min (value units) | stone pickaxe (bots of 8) | furnace | iron ingot | pickaxe-less share | stuck min/bot | loops/bot-h | deaths | decisions/bot-h |' % a.horizon)
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for o in sorted(out, key=lambda o: (o['block'], o['arm'])):
        ms = o['milestones'] or {}
        print('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (o['run_id'], o['arm'], o['block'], o['output'], ms.get('stone_pickaxe'),
              ms.get('furnace'), ms.get('iron_ingot'), o['pickless'], o['stuck_min'], o['loops_h'], o['deaths'], o['dec_h']))
    print()
    print('| arm | runs | mean output | mean stone-pickaxe bots | mean iron-ingot bots | mean pickaxe-less | mean stuck min/bot |')
    print('|---|---|---|---|---|---|---|')
    for arm in arms:
        x = [o for o in out if o['arm'] == arm]
        f = lambda k: round(statistics.mean(k(o) for o in x), 2)
        print('| %s | %d | %s | %s | %s | %s | %s |' % (arm, len(x), f(lambda o: o['output']), f(lambda o: (o['milestones'] or {}).get('stone_pickaxe', 0)),
              f(lambda o: (o['milestones'] or {}).get('iron_ingot', 0)), f(lambda o: o['pickless']), f(lambda o: o['stuck_min'])))
    print()
    print('Paired within blocks (ratio of team output vs q25-7b in the same block):')
    for arm in arms:
        if arm == 'q25-7b':
            continue
        rat = []
        for b in sorted({o['block'] for o in out}):
            xa = [o for o in out if o['arm'] == arm and o['block'] == b]
            xb = [o for o in out if o['arm'] == 'q25-7b' and o['block'] == b]
            if xa and xb and xb[0]['output']:
                rat.append(xa[0]['output'] / xb[0]['output'])
        if rat:
            print('  %s: per-block ratios %s; geometric mean %.2fx' % (arm, [round(v, 2) for v in rat], statistics.geometric_mean(rat)))
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
