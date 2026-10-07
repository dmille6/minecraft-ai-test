#!/usr/bin/env python3
# analyze.py <results.jsonl> : per-trial A (drown clock) and B (escape primitives) summaries from SERVER polls.
import json, sys, statistics as st
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]

def slope(pts):
    if len(pts) < 3: return None
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; mx = st.mean(xs); my = st.mean(ys)
    d = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / d if d else None

print('== A: drown clock (server polls; times in game-ticks/20 from survival-in-water) ==')
for r in rows:
    if not r['arm'].startswith('A_'): continue
    cd = next((e for e in r['clientEv'] if e['k'] == 'death'), None)
    _offs = [p['ts'] - (p['cs'] + p['cr']) / 2 for p in r['polls'] if p.get('cs')]
    _cut = (cd['t'] + st.median(_offs)) if cd else float('inf')
    P = [p for p in r['polls'] if p.get('hp') is not None and p['ts'] < _cut and (p['y'] or 0) < 50]
    air0 = next((p for p in P if p['air'] is not None and p['air'] <= 0), None)
    first_dmg = next((p for p in P if p['hp'] < 20), None)
    death = next((p for p in r['polls'] if (p.get('hp') is not None and p['hp'] <= 0) or p.get('gone')), None)
    cdeath = next((e for e in r['clientEv'] if e['k'] == 'death'), None)
    # client death time on the server clock: offset from the polls (server ts - midpoint of local send/recv)
    offs = [p['ts'] - (p['cs'] + p['cr']) / 2 for p in r['polls'] if p.get('cs')]
    off = st.median(offs) if offs else 0
    cdeath_dt = (cdeath['t'] + off - r['t0']) / 1000 if cdeath else None
    # steady state: after saturation first <= 1 (peaceful) or after first damage (easy), until death
    sat_lo = next((p for p in P if p['air'] is not None and p['air'] <= 0 and p['sat'] is not None and p['sat'] <= 1.0), None)
    win_start = sat_lo['dgt'] if sat_lo else (first_dmg['dgt'] if first_dmg else None)
    pts = [(p['dgt'], p['hp']) for p in P if win_start is not None and p['dgt'] >= win_start and p['hp'] > 0]
    s_all = slope([(p['dgt'], p['hp']) for p in P if air0 and p['dgt'] >= air0['dgt'] and p['hp'] > 0])
    end_t = (death['dgt'] if death else (cdeath_dt or P[-1]['dgt']))
    plateau = [p for p in P if air0 and p['dgt'] >= air0['dgt'] and p['hp'] >= 19.5]
    print(f"{r['arm']:9s}#{r['k']} diff={r['diff']:8s} entry food={P[0]['food']} sat={P[0]['sat']} hp={P[0]['hp']} | air0@{air0['dgt'] if air0 else None}s "
          f"first<20@{first_dmg['dgt'] if first_dmg else None}s death@{death['dgt'] if death else None}s (client {cdeath_dt and round(cdeath_dt,2)}) "
          f"air0->death={round(end_t - air0['dgt'],2) if air0 and (death or cdeath) else 'ALIVE'} | slope(air0..death)={s_all and round(s_all,3)} "
          f"steady(sat<=1..death, from {win_start}s)={slope(pts) and round(slope(pts),3)} HP/s | hp>=19.5 after air0 for {round(plateau[-1]['dgt']-air0['dgt'],1) if plateau else 0}s "
          f"| polls={len(P)} lastHp={P[-1]['hp']} lastSat={P[-1]['sat']} lastFood={P[-1]['food']}")

print('\n== B: escape primitives ==')
for r in rows:
    if not r['arm'].startswith('B'): continue
    c = r['ctx']; acts = r['acts']
    ha = c.get('headAir')
    digs = ' '.join(f"[{a['label']} srv={a['srvSecs']} cli={a['clientSecs']} cDig={a['cDigTime']}ms og={a['cOnGround']} eye={a['cEye']} ok={a.get('ok')} {a.get('err','')}]" for a in acts)
    ext = [p['extra'] for p in r['polls'] if p.get('dgt', 0) >= (c.get('actGt', 0) - r['gt0']) / 20]
    lastx = r['polls'][-1]['extra'] if r['polls'] else None
    print(f"{r['arm']:7s}#{r['k']} actAt hp={c.get('hpAtStart')} og={c.get('ogAtStart')} | headAir={ha} | {digs} "
          f"{'held=' + str(c.get('heldAfter')) if 'heldAfter' in c else ''} {'place=' + str(c.get('placeOk')) + ' ' + str(c.get('placeErr','')) + ' ' + str(c.get('placeSecs')) if 'useT' in c and r['arm'].startswith('B5') else ''} "
          f"| last extra[head41air,feet40air,cobble701,head41water]={lastx} died={r['died']} floatY={c.get('floatY')} floatOG={c.get('floatOG')}")
