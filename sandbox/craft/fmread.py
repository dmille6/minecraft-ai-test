#!/usr/bin/env python3
"""FM read (airpocket-03): per trial -- alive (server deathCount/Health); every _air_pocket* row with outcome / window= /
contested= / why; each mine row (start = end - duration) and the time from each step start to mine's end; every dig the
trace saw, split into the rescue's (at the trap cell 700,42,700 with a pickaxe after a step start) and others, with the
digs sent after the step's start (mine's digs after the interrupt); the gap from a failed/aborted step to the next
_air_pocket_start; ice dug (server roof cell) and first breath.
  fmread.py results.jsonl [...] [--scenes=FM,F,AF]"""
import json, re, sys
args = [a for a in sys.argv[1:] if not a.startswith('--')]
scenes = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--scenes=')), 'FM,FMD,F,AF').split(',')
kv = lambda d, k: (re.search(r'\b' + k + r'=(\S+)', d or '') or [None, None])[1]
rows = []
for f in args:
    rows += [json.loads(l) for l in open(f) if l.strip()]
rows = sorted([r for r in rows if r['scene'] in scenes], key=lambda r: r['t0'])
print(f'trials: {len(rows)}')
for r in rows:
    ap = r.get('ap', []); digs = r.get('digs', [])
    mines = [s for s in r.get('smelt', []) if s['name'] == 'mine' or s['name'].startswith('_mine_stair')]
    starts = [a for a in ap if a['name'] == '_air_pocket_start']
    print(f"\n== {r['id']} sha={r['sha']} server={r['server']} kit={r.get('kit')} brain={r.get('brain')} ALIVE={'Y' if r['alive'] else 'N'}"
          f" deaths={r['serverDeaths']} deathT={r['deathT']} minHP={round(r['minHealth'], 1)} roof {r['roof0']}->{r['roofEnd']} opened@{r['roofOpenT']} breath@{r.get('breathT')}")
    for a in ap:
        d = a['detail']
        extra = f" outcome={kv(d, 'outcome')} window={kv(d, 'window')} contested={kv(d, 'contested')} tool={kv(d, 'tool')}" if a['name'] == '_air_pocket' else ''
        why = d.split(' -- ', 1)[1][:90] if ' -- ' in d else ''
        print(f"   {a.get('tMs', a['t']):>8} {a['name']:<22}{extra} why={why!r} | {d[:150]}")
    for m in mines:
        dur = (m.get('dur') or 0) / 1000
        print(f"   {m['tMs']:>8} {m['name']:<22} {m['status']} in flight {round(m['tMs'] - dur, 2)}..{m['tMs']} | {m['detail'][:110]}")
    for st in starts:
        t0 = st['tMs']
        mend = next((m for m in mines if m['name'] == 'mine' and m['tMs'] >= t0 - 3 and (m['tMs'] - (m.get('dur') or 0) / 1000) <= t0), None)
        end = next((a for a in ap if a['name'] == '_air_pocket' and a['tMs'] >= t0), None)
        t1 = end['tMs'] if end else t0 + 30
        inside = [d for d in digs if t0 - 0.2 <= d['t'] <= t1 + 0.2]
        other = [d for d in inside if not (d['loc'] == '700,42,700' and d['held'] and 'pickaxe' in d['held'])]
        nxt = next((a for a in starts if a['tMs'] > t0), None)
        print(f"   STEP {t0}->{t1 if end else 'open'}: mine ended {('@' + str(mend['tMs']) + f' ({round(mend['tMs'] - t0, 3)} s after step start)') if mend else '-'};"
              f" digs during step {len(inside)}, NOT the rescue's {len(other)}; next _air_pocket_start {('@' + str(nxt['tMs']) + f' (+{round(nxt['tMs'] - t1, 1)} s after this end)') if nxt else '-'}")
        for d in inside:
            print(f"      {d['t']:>7} dig status={d['status']} loc={d['loc']} held={d['held']}")
