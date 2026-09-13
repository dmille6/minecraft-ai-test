# score-run.py <bot> <from-iso> <to-iso> <label> <arm> <root> <fixture.json> <verdict-json>
# Scores one sandbox run for the corpus table. The REFERENCE is the fixture's recorded bot position, not the first
# logged row: the bot logs from its spawn before the loader teleports it, and a spawn-relative score read "moved 397".
# Samples farther than 40 blocks from the fixture position are pre-teleport (or a respawn after death) and are ignored.
import sys, json, glob
bot, a, b, label, arm, root, fx, verdict = sys.argv[1:9]
ref = json.load(open(fx))['bot']['pos']; rx, ry, rz = ref[0], ref[1], ref[2]
died = 0; inv0 = None; inv1 = None; maxrise = 0.0; maxmove = 0.0; n = 0
for f in glob.glob(f'sandbox/log/{bot}/skill-*.jsonl'):
    for l in open(f, errors='replace'):
        try: r = json.loads(l)
        except Exception: continue
        t = r.get('@timestamp', '')
        if not (a <= t < b): continue
        sk = r.get('skill') or {}; nme = sk.get('name') or ''
        if nme == '_death': died += 1
        p = (r.get('bot') or {}).get('pos') or {}; inv = (r.get('bot') or {}).get('inventory')
        if p.get('x') is not None:
            d = ((p['x'] - rx) ** 2 + (p['z'] - rz) ** 2) ** 0.5
            if d <= 40 and abs(p['y'] - ry) <= 40:
                n += 1
                if not (r.get('bot') or {}).get('wet'): maxrise = max(maxrise, p['y'] - ry)
                maxmove = max(maxmove, d)
                if isinstance(inv, dict):
                    if inv0 is None: inv0 = inv
                    inv1 = inv
picks = lambda inv: sum(v for k, v in (inv or {}).items() if k.endswith('_pickaxe'))
lost = max(0, picks(inv0) - picks(inv1))
try: esc = json.loads(verdict).get('escaped')
except Exception: esc = None
print('\t'.join(str(x) for x in [label, arm, root.split('/')[-1], 'DIED' if died else 'alive', 'escaped' if esc else 'not', f'rise{maxrise:.0f}', f'move{maxmove:.0f}', f'picks_lost{lost}', f'samples{n}']))
