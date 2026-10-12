#!/usr/bin/env python3
"""CR log-loss read: per trial, every craft row (start = end - duration), each ABORT and how far into the craft it came,
every click within 3 s after each abort row (trace: window id; probe: craftsync active/busy at the click), the server's
oak_log at the end (invEnd entries), and whether the next craft after the 2nd abort succeeded.
  crlogs.py results.jsonl [...]"""
import json, re, sys
rows = []
for f in sys.argv[1:]:
    rows += [json.loads(l) for l in open(f) if l.strip()]
rows = sorted([r for r in rows if r['scene'] == 'CR'], key=lambda r: r['t0'])
for r in rows:
    crafts = [s for s in r.get('smelt', []) if s['name'] == 'craft']
    logs = [int(m.group(1)) for x in str(r.get('invEnd', '')).split(' | ') if 'oak_log' in x for m in [re.search(r'count: (\d+)', x)] if m]
    cs = [p for p in r.get('probe', []) if p.get('pkt') == 'click_state']
    clicks = [w for w in r.get('win', []) if w['pkt'] == 'click']
    aborts = [c for c in crafts if c['status'] == 'aborted']
    print(f"== {r['id']} sha={r['sha']} server={r['server']} t0={r['t0']} alive={r['alive']} | server oak_log at end = {sum(logs) if logs else 0}")
    for i, c in enumerate(crafts):
        st = round(c['tMs'] - (c.get('dur') or 0) / 1000, 3)
        print(f"   craft {c['status']:<8} start {st:>7} end {c['tMs']:>7} dur {c.get('dur')} ms | {c['detail'][:70]}")
    for k, a in enumerate(aborts):
        after = [w for w in clicks if a['tMs'] - 0.05 <= w['t'] <= a['tMs'] + 3]
        nxt = next((c for c in crafts if c['tMs'] > a['tMs']), None)
        print(f"   ABORT#{k + 1} at {a['tMs']} ({a['detail'][:20]}) {a.get('dur')} ms into the craft; clicks in the next 3 s: {len(after)}; next craft: {nxt['status'] + ' @' + str(nxt['tMs']) if nxt else '-'}")
        for w in after:
            p = min(cs, key=lambda p: abs(p['t'] - w['t']), default=None)
            pd = f" craftActive={p.get('craftActive')} craftBusy={p.get('craftBusy')} curWin={p.get('curWin')} held={p.get('held')}" if p and abs(p['t'] - w['t']) < 0.3 else ''
            print(f"      {w['t']:>8} click win={w['win']} slot={w['slot']} mode={w['mode']}{pd}")
