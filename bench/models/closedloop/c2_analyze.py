#!/usr/bin/env python3
"""Stage C2 readout (mini; reads over ssh). PRE-REGISTERED before the first C2 run (10-07):

PRIMARY    team output at 70 min (the C1 definition: resource-value ledger, crafting priced at inputs).
SECONDARY  stuck minutes per bot; bots reaching a stone pickaxe / an iron ingot; deaths; the bots' own decision
           latency p50 (does a co-resident overseer slow the brain?).
MECHANISM  directive funnel per run: requested -> step_done/completed vs refused/released/expired/superseded/
           parse_failed (from the bots' own `_directive` rows); overseer calls (count, seconds, validator-clean share,
           accepted assignments); escalation: triggered episodes (computed in EVERY arm -- intent-to-treat), share of
           episodes ending within 10 min, escalation calls.
CONTRASTS  det vs none (an allocator + actuator at all); ov vs det (the LLM's allocation); esc vs none (rescue).
           Paired within blocks; the run is the unit; 3 blocks -> large effects only.

    python3 c2_analyze.py results/runs.jsonl [--horizon 70]
"""
import argparse, collections, json, re, statistics, subprocess
from datetime import datetime, timedelta, timezone

BOTS = 'mike@10.0.0.31'


def ssh(cmd):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', BOTS, cmd], stdin=subprocess.DEVNULL, capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('runs'); ap.add_argument('--horizon', type=float, default=70)
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.runs) if l.strip()]
    blk = lambda r: int((re.search(r'-b(\d+)$', r['run_id']) or [0, 999])[1])   # untagged runs count as smoke
    rows = [r for r in rows if r.get('c2_arm') and not r.get('flag') and blk(r) < 90]   # blocks 90+ are smoke runs
    out = []
    for r in rows:
        t0 = datetime.strptime(r['start'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        t1 = t0 + timedelta(minutes=a.horizon)
        m = json.loads(ssh('python3 ~/mbench-cl/cl_metrics.py ~/mbench-cl/runs/%s --start %s --end %s 2>/dev/null'
                           % (r['run_id'], t0.strftime('%Y-%m-%dT%H:%M:%SZ'), t1.strftime('%Y-%m-%dT%H:%M:%SZ'))))
        funnel = collections.Counter()
        for line in ssh("cat ~/mbench-cl/runs/%s/*/skill-*.jsonl | grep -a '\"_directive\"' || true" % r['run_id']).splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            det = (d.get('skill') or {}).get('detail', '')
            parts = det.split()
            if len(parts) >= 3:
                funnel['%s:%s' % (parts[2], parts[0])] += 1
        dl = [json.loads(l) for l in ssh('cat ~/mbench-c2/%s/director.jsonl 2>/dev/null' % r['run_id']).splitlines() if l.startswith('{')]
        ov = [x for x in dl if x['kind'] == 'overseer_call']
        eps = [x for x in dl if x['kind'] == 'episode_start']
        ends = [x for x in dl if x['kind'] == 'episode_end']
        out.append({'run_id': r['run_id'], 'arm': r['c2_arm'], 'block': r['run_id'].rsplit('-b', 1)[-1],
                    'output': round((m.get('team_output_per_h') or 0) * a.horizon / 60, 1),
                    'stuck_min': m.get('stuck_min_per_bot'), 'stone': (m.get('milestone_bots') or {}).get('stone_pickaxe'),
                    'iron': (m.get('milestone_bots') or {}).get('iron_ingot'), 'deaths': m.get('deaths'), 'lat_p50': m.get('latency_p50_med'),
                    'funnel': dict(funnel), 'ov_calls': len(ov), 'ov_ok': sum(1 for x in ov if x.get('valid')),
                    'ov_s': round(statistics.median([x['s'] for x in ov if x.get('s')]), 1) if any(x.get('s') for x in ov) else None,
                    'episodes': len(eps), 'ended_10min': sum(1 for x in ends if x.get('minutes', 99) <= 10),
                    'esc_calls': sum(1 for x in dl if x['kind'] == 'escalation_call'),
                    'sent': sum(1 for x in dl if x['kind'] == 'directive_sent')})
    for o in sorted(out, key=lambda o: (o['block'], o['arm'])):
        print(json.dumps(o))
    print()
    for arm in sorted({o['arm'] for o in out}):
        x = [o for o in out if o['arm'] == arm]
        mean = lambda k: round(statistics.mean((o[k] or 0) for o in x), 2)
        print('%-7s runs=%d output=%s stuck=%s stone=%s iron=%s deaths=%s lat=%s sent=%s episodes=%s ended10=%s' % (
            arm, len(x), mean('output'), mean('stuck_min'), mean('stone'), mean('iron'), mean('deaths'), mean('lat_p50'),
            mean('sent'), mean('episodes'), mean('ended_10min')))


if __name__ == '__main__':
    main()
