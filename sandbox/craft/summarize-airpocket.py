#!/usr/bin/env python3
"""Per scene x arm table for airpocket-ab.cjs results:  summarize-airpocket.py results-*.jsonl [--trials] [--j]

The OUTCOME is the world's (RCON every ~1 s: Air, Health, Pos, a deathCount scoreboard, the eye cell, the roof cell
700 42 700 and its neighbours), never the bot's rows. The bot's rows (_air_pocket / _air_pocket_refused / _drowning_*)
are reported beside it.
  alive    = no server death (deathCount 0, no Health 0 poll, no _death row) and Health > 0 at the last poll
  pocket   = the roof cell read a different block from its first poll (stone -> air, ice -> water/air) at any poll
  breath   = first poll (before any death) whose eye cell is air; hp@breath = server Health at that poll
  ap       = the first _air_pocket row: outcome, predicted_ms vs dig_ms, ms
  refused  = _air_pocket_refused rows, distinct reasons
  digs     = trace dig starts (status 0) at the roof cell 700,42,700 / anywhere
"""
import json, re, sys
from collections import defaultdict, Counter

EXPECT = {
    'A': 'cand: pocket dug at 700 42 700, eye in air, alive. ctrl: dies',
    'B': 'cand: one dig suffices through a 3-thick roof, alive',
    'C': 'cand: refuses ("beside the roof cell"), never digs 700 42 700',
    'D': 'cand: refuses (lava above), never digs',
    'E': 'cand: refuses (sand above)',
    'F': 'cand: breaks the ice and rises, eye in air, alive. ctrl: ?',
    'G': 'cand: no _air_pocket row; the rescue swims to the air at 42',
    'H': 'cand (easy): refuses (envelope 2.0), never dies DIGGING',
    'I': 'cand: refuses or never triggers',
    'J': 'A for 300 s: after the pocket, sink back / re-seize / re-drown?',
}

def kv(detail, key):
    m = re.search(r'\b' + key + r'=(\S+)', detail or '')
    return m.group(1) if m else None

AIRISH = re.compile(r'^(air|cave_air|off-column)$')

def recompute(r):
    """Breathing from the SERVER only, recomputed from the polls so every results line is judged the same way: the eye
    cell is floor(Pos.y + 1.62) in the 700/700 column, named by that poll's block reads (41 head, 42 roof, 43 above);
    breathing = that cell is air, or the server's Air rose since the previous poll. Polls after a death are excluded.
    (The driver's `anchored eyes` query was measured unreliable: it read water at y 41.2 under an air cell while Air
    sat at 300.)"""
    alive = [p for p in r['polls'] if not p.get('err') and not ((p.get('deaths') or 0) > 0 or p.get('health') == 0)]
    prev = None
    for p in alive:
        pos = p.get('pos')
        if pos:
            ey = int((pos[1] + 1.62) // 1)
            # F's 3x3x3 room (43..45) is built air and nothing in F can fill 44/45 but the bot's own pillar
            col = {41: p.get('head'), 42: p.get('roof'), 43: p.get('above')}
            if r['scene'] == 'F':
                col.update({44: 'air', 45: 'air'})
            p['eyeCell'] = (col.get(ey, f'y{ey}')
                            if int(pos[0] // 1) == 700 and int(pos[2] // 1) == 700 else 'off-column')
        else:
            p['eyeCell'] = None
        # Air sits in [-20, 0] while drowning (it resets to 0 on each damage tick), so a rise only counts above 0
        p['airRose'] = prev is not None and p.get('air') is not None and p['air'] > prev and p['air'] > 0
        if p.get('air') is not None:
            prev = p['air']
    fb = next((p for p in alive if AIRISH.match(p.get('eyeCell') or '') or p['airRose']), None)
    r['breathT'] = fb['t'] if fb else None
    r['healthAtBreath'] = fb['health'] if fb else None
    ep = rs = 0
    pa = None
    for p in alive:
        ea = bool(AIRISH.match(p.get('eyeCell') or ''))
        if ea and pa is not True:
            ep += 1
        if not ea and pa is True:
            rs += 1
        pa = ea
    r['episodes'], r['resub'] = ep, rs
    r['minAirAlive'] = min((p['air'] for p in alive if p.get('air') is not None), default=None)
    return r

def load(paths):
    rows = []
    for f in paths:
        for line in open(f):
            line = line.strip()
            if line:
                rows.append(recompute(json.loads(line)))
    return rows

def trial_line(r):
    ap = [a for a in r['ap'] if a['name'] == '_air_pocket']
    rf = [a for a in r['ap'] if a['name'] == '_air_pocket_refused']
    # dig packets at the roof cell: starts / finishes (a start followed by a cancel, status 1, breaks nothing)
    roof_digs = '%d/%d held=%s' % (sum(1 for d in r['digs'] if d['status'] == 0 and d['loc'] == '700,42,700'),
                                   sum(1 for d in r['digs'] if d['status'] == 2 and d['loc'] == '700,42,700'),
                                   ','.join(sorted({str(d['held']) for d in r['digs'] if d['status'] == 0 and d['loc'] == '700,42,700'})) or '-')
    a0 = ap[0] if ap else None
    s = (f"{r['id']:<11} {r['sha']:<8} {r['server']:<8} diff={r['difficultyDuring']:<8} alive={'Y' if r['alive'] else 'N'} "
         f"death@={r['deathT'] if r['deathT'] is not None else '-':<6} roof {r['roof0']}->{r['roofEnd']} pocket@={r['roofOpenT'] if r['roofOpenT'] is not None else '-':<6} "
         f"breath@={r['breathT'] if r['breathT'] is not None else '-':<6} hp@breath={r['healthAtBreath'] if r['healthAtBreath'] is not None else '-'} "
         f"minHP={round(r['minHealth'], 1)} hpEnd={r['healthEnd']} roofDigs(start/finish)={roof_digs} ap={len(ap)} refused={len(rf)}")
    if a0:
        d = a0['detail']
        s += (f"\n    first _air_pocket @{a0['t']}s outcome={kv(d, 'outcome')} kind={kv(d, 'kind')} predicted_ms={kv(d, 'predicted_ms')} "
              f"dig_ms={kv(d, 'dig_ms')} ms={kv(d, 'ms')} health={kv(d, 'health')} req={kv(d, 'required_ms')} budget={kv(d, 'budget_ms')} "
              f"trigger={kv(d, 'trigger_route')} held={kv(d, 'held_ms')} -- {d.split(' -- ')[-1][:90]}")
    for a in ap[1:]:
        s += f"\n    later _air_pocket @{a['t']}s {a['detail'][:200]}"
    reasons = Counter(re.sub(r'\d+(\.\d+)?', '#', (kv(a['detail'], 'reason') and a['detail'].split('reason=')[1].split(' at=')[0]) or a['detail'])[:90] for a in rf)
    for why, n in reasons.items():
        s += f"\n    refused x{n}: {why}"
    return s

def step_line(r):
    """One line per trial: the step's own timeline against the server's. Times are s from submersion (the teleport)."""
    def first(name):
        return next((a for a in r['ap'] if a['name'] == name), None)
    pre, st, ap = first('_air_pocket_preempt'), first('_air_pocket_start'), first('_air_pocket')
    alive = [p for p in r['polls'] if not p.get('err') and not ((p.get('deaths') or 0) > 0 or p.get('health') == 0)]
    yr = '-'
    if st and ap:
        ys = [p['pos'][1] for p in alive if p.get('pos') and st['t'] - 0.5 <= p['t'] <= ap['t'] + 0.5]
        yr = f'{min(ys):.2f}..{max(ys):.2f}' if ys else '-'
    after = '-'
    if ap:
        later = [p for p in alive if p['t'] > ap['t']]
        reseize = sum(1 for d in r['drown'] if d['name'] == '_drowning_route' and d['t'] > ap['t'])
        sub, pa = 0, None
        for p in later:
            ea = bool(AIRISH.match(p.get('eyeCell') or ''))
            if pa is True and not ea:
                sub += 1
            pa = ea
        after = (f"after-step: minAir={min((p['air'] for p in later if p.get('air') is not None), default='-')} "
                 f"minHP={min((round(p['health'], 1) for p in later if p.get('health') is not None), default='-')} "
                 f"yRange={min((p['pos'][1] for p in later if p.get('pos')), default=0):.2f}..{max((p['pos'][1] for p in later if p.get('pos')), default=0):.2f} "
                 f"eyeLeftAir={sub} _drowning_route={reseize}")
    hp = lambda a: (re.search(r'health=([\d.]+)', a['detail']) or [None, '?'])[1][:5] if a else '-'
    return (f"{r['id']:<10} {r['sha']:<8} {r['server']:<8} {r['difficultyDuring']:<8} preempt@{pre['t'] if pre else '-'} "
            f"start@{st['t'] if st else '-'}(hp {hp(st)}) {('outcome=' + str(kv(ap['detail'], 'outcome')) + '@' + str(ap['t'])) if ap else 'no step'} "
            f"pred/dig={kv(ap['detail'], 'predicted_ms') if ap else '-'}/{kv(ap['detail'], 'dig_ms') if ap else '-'} "
            f"roofOpen@{r['roofOpenT'] if r['roofOpenT'] is not None else '-'} breath@{r['breathT'] if r['breathT'] is not None else '-'} "
            f"yDuringStep={yr} minHP={round(min((p['health'] for p in alive if p.get('health') is not None), default=0), 1)} "
            f"alive={'Y' if r['alive'] else 'N'}{' death@' + str(r['deathT']) if r['deathT'] is not None else ''} | {after}")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    rows = load(args)
    shaf = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--sha=')]
    if shaf:
        rows = [r for r in rows if r['sha'] in shaf[0].split(',')]
    if '--steps' in sys.argv:
        for r in sorted(rows, key=lambda r: (r['scene'], r['arm'], r['t0'])):
            print(step_line(r))
        return
    by = defaultdict(list)
    for r in rows:
        by[(r['scene'], r['arm'])].append(r)
    hdr = '%-5s %-5s %-14s %3s %6s %7s %7s %10s %12s %10s %8s %s' % ('scene', 'arm', 'sha', 'n', 'alive', 'pocket', 'breath', 'breath@s', 'hp@breath', 'deaths', 'refused', 'first _air_pocket outcomes / refusal reasons')
    print(hdr)
    for scene in sorted({s for s, _ in by}):
        for arm in ('cand', 'ctrl'):
            rs = by.get((scene, arm))
            if not rs:
                continue
            n = len(rs)
            shas = ','.join(sorted({r['sha'] for r in rs}))
            alive = sum(r['alive'] for r in rs)
            pocket = sum(r['roofOpened'] for r in rs)
            br = [r for r in rs if r['breathT'] is not None]
            deaths = sum(1 for r in rs if r['died'])
            refused = sum(sum(1 for a in r['ap'] if a['name'] == '_air_pocket_refused') for r in rs)
            outs = Counter(kv(a['detail'], 'outcome') for r in rs for a in r['ap'] if a['name'] == '_air_pocket')
            reasons = Counter((a['detail'].split('reason=')[1].split(' at=')[0][:60] if 'reason=' in a['detail'] else a['detail'][:60])
                              for r in rs for a in r['ap'] if a['name'] == '_air_pocket_refused')
            reasons = Counter({re.sub(r'\d+(\.\d+)?', '#', k): v for k, v in reasons.items()})
            print('%-5s %-5s %-14s %3d %6s %7s %7s %10s %12s %10s %8d %s %s' % (
                scene, arm, shas, n, f'{alive}/{n}', f'{pocket}/{n}', f'{len(br)}/{n}', ','.join(str(r['breathT']) for r in br) or '-',
                ','.join(str(round(r['healthAtBreath'], 1)) for r in br) or '-', f'{deaths}/{n}', refused, dict(outs) or '', dict(reasons) or ''))
        print('      expected: ' + EXPECT.get(scene, ''))
    if '--trials' in sys.argv:
        print()
        for r in sorted(rows, key=lambda r: (r['scene'], r['arm'], r['t0'])):
            print(trial_line(r))
    if '--j' in sys.argv:
        print('\nJ (300 s full stack): per trial, every 30 s: t air hp eyeAir pos.y roof; plus drowning-row counts')
        for r in [r for r in rows if r['scene'] in ('J',)]:
            print(trial_line(r))
            dr = Counter(d['name'] for d in r['drown'])
            print('    rows:', dict(dr), ' re-seizures (_drowning_route)=', dr.get('_drowning_route', 0), ' eye episodes=', r['episodes'], ' re-submersions=', r['resub'])
            nxt = 0
            for p in r['polls']:
                if p.get('err') or p['t'] < nxt:
                    continue
                nxt = p['t'] + 30
                print(f"      t={p['t']:>5} air={p['air']} hp={p['health']} eye={p.get('eyeCell')} y={p['pos'][1] if p.get('pos') else None} roof={p['roof']} deaths={p['deaths']}")

if __name__ == '__main__':
    main()
