#!/usr/bin/env python3
# Read scene-SM trials: the rescue step's window vs every click/open/close on the wire (trace), per trial.
# Denominator first: trials, then for each trial its step(s), the furnace windows, and every click.
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in rows if r.get('scene') in (sys.argv[2].split(',') if len(sys.argv) > 2 else ['SM'])]
print(f'trials: {len(rows)}')
for r in rows:
    ap = r.get('ap', []); win = r.get('win', [])
    starts = [a for a in ap if a['name'] == '_air_pocket_start']; ends = [a for a in ap if a['name'] == '_air_pocket']
    opens = [w for w in win if w['pkt'] == 'open_window']
    clicks = [w for w in win if w['pkt'] == 'click']
    print(f"\n== {r['id']} sha={r['sha']} died={r['died']} roofOpened={r['roofOpened']}@{r['roofOpenT']} breath={r['breathT']} hpEnd={r['healthEnd']} "
          f"starts={len(starts)} ends={len(ends)} refused={sum(a['name']=='_air_pocket_refused' for a in ap)} opens={len(opens)} clicks={len(clicks)} (positive control: the trace saw {len(win)} window events)")
    for a in ap: print(f"   {a.get('tMs', a['t']):>8} {a['name']:<22} {a['status']:<9} {a['detail'][:230]}")
    for s in r.get('smelt', []): print(f"   {s['tMs']:>8} {s['name']:<22} {s['status']:<9} {s['detail'][:120]}")
    # each step's interval; clicks inside it, by window
    for st in starts:
        t0 = st['tMs']; en = next((e for e in ends if e['tMs'] >= t0), None); t1 = en['tMs'] if en else 1e9
        inside = [w for w in win if t0 - 0.5 <= w['t'] <= t1]
        bad = [w for w in inside if w['pkt'] == 'click' and w['win'] not in (0, None)]
        print(f"   STEP {t0}->{t1}: events inside {len(inside)}; clicks into a container window {len(bad)}")
        for w in inside: print(f"      {w['t']:>8} {w['pkt']:<17} win={w.get('win')} slot={w.get('slot')} mode={w.get('mode')}")
    print(f"   invEnd: {r.get('invEnd','')[:700]}")
    print(f"   furnaceEnd: {r.get('furnaceEnd')}")
