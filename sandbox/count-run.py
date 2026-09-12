# count-run.py <bot> <from-iso> <to-iso> -- count a sandbox run's events by FULL timestamp (never time-of-day)
import sys, json, glob, collections
bot, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
c = collections.Counter(); ys = []; runs = []
for f in glob.glob(f'sandbox/log/{bot}/skill-*.jsonl'):
    for l in open(f, errors='replace'):
        try: r = json.loads(l)
        except Exception: continue
        t = r.get('@timestamp', '')
        if not (a <= t < b): continue
        sk = r.get('skill') or {}; n = sk.get('name') or ''; c[n] += 1; p = r['bot'].get('pos') or {}
        if p.get('y') is not None: ys.append(p['y'])
        if n == 'mine': runs.append((t[11:19], sk.get('status'), (sk.get('detail') or '')[:60]))
print(f"{a[11:19]}-{b[11:19]} | mine {c['mine']} | entombed {c['_entombed']} | stepfail {c['_mine_stair_step_failed']} | ramp {c['_entombed_ramp_cut']} | deaths {c['_death']} | min y {round(min(ys),1) if ys else None}")
for m in runs[:8]: print('   ', *m)
