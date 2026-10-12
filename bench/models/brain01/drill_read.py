#!/usr/bin/env python3
"""brain-01 drill readout: the bots' OWN decision rows (llm-*.jsonl on the bots host) cut by the drill timeline.
Per window: decisions, decisions per bot-minute, brain shares, nothing-served rows (brain null), schema-valid
share, latency p50/p95; and per transition the seconds to the first fallback (drill on) and to the first gemma4
decision again (drill off). Positive control: the healthy window must show gemma4 decisions.
    python3 drill_read.py <run_id> <timeline.jsonl>
"""
import json, subprocess, sys, statistics as st
from datetime import datetime
run, tl = sys.argv[1], sys.argv[2]
P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
rows = []
out = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.31', 'cat ~/mbench-cl/runs/%s/*/llm-*.jsonl' % run],
                     stdin=subprocess.DEVNULL, capture_output=True, text=True).stdout
for l in out.splitlines():
    try: d = json.loads(l)
    except ValueError: continue
    rows.append({'t': P(d['@timestamp']), 'bot': d['bot']['name'], 'brain': d['llm'].get('brain'), 'lat': d['llm'].get('latency_ms') or 0,
                 'valid': d['llm'].get('schema_valid'), 'model': d['llm'].get('model'), 'mm': d['llm'].get('model_mismatch'),
                 'status': (d.get('outcome') or {}).get('status'), 'err': d['llm'].get('error')})
rows.sort(key=lambda r: r['t'])
ev = [json.loads(l) for l in open(tl)]
marks = [(P(e['t']), e['event']) for e in ev]
bots = sorted({r['bot'] for r in rows})
print('rows %d, bots %d, %s .. %s' % (len(rows), len(bots), rows[0]['t'] if rows else '-', rows[-1]['t'] if rows else '-'))
print('| window | min | decisions | per bot-min | gemma4 | local | order | nothing served | schema-valid | model decision p50 / p95 s |')
print('|---|---|---|---|---|---|---|---|---|---|')
for (t0, name), (t1, _) in zip(marks, marks[1:]):
    w = [r for r in rows if t0 <= r['t'] < t1]
    mins = (t1 - t0).total_seconds() / 60
    lat = [r['lat'] / 1000 for r in w if r['brain'] not in ('order',) and r['lat']]
    c = lambda b: sum(1 for r in w if r['brain'] == b)
    pct = lambda v: sorted(v)[min(len(v) - 1, int(0.95 * len(v)))] if v else None
    print('| after %s | %.1f | %d | %.2f | %d | %d | %d | %d | %s | %s / %s |' % (
        name, mins, len(w), len(w) / max(1e-9, mins * len(bots)), c('gemma4'), c('local'), c('order'), c(None),
        '%d%%' % round(100 * sum(1 for r in w if r['valid']) / len(w)) if w else '-',
        round(st.median(lat), 1) if lat else '-', round(pct(lat), 1) if lat else '-'))
print()
for (t0, name), (t1, _) in zip(marks, marks[1:]):
    if name.endswith('_on') or name in ('proxy_killed', 'model_unloaded'):
        f = next((r for r in rows if t0 <= r['t'] < t1 and r['brain'] == 'local'), None)
        print('%-16s first fallback decision %s s after' % (name, round((f['t'] - t0).total_seconds()) if f else 'NONE'))
    if name.endswith('_off') or name in ('proxy_restarted', 'model_reloaded'):
        g = next((r for r in rows if r['t'] >= t0 and r['brain'] == 'gemma4'), None)
        print('%-16s first gemma4 decision again %s s after' % (name, round((g['t'] - t0).total_seconds()) if g else 'NONE'))
mm = [r for r in rows if r['mm']]
print('\nmodel_mismatch rows: %d %s' % (len(mm), sorted({r['mm'] for r in mm})[:3]))
print('errors on nothing-served rows:', sorted({r['err'] for r in rows if r['brain'] is None})[:5])
