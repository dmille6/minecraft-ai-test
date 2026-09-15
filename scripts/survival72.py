#!/usr/bin/env python3
"""The 72-h fleet read after a promotion, on the program's five committed numbers, SPLIT BY CODE VERSION so a revert or a
later promotion cannot blur it (ChatGPT, goals review 2026-09-14). Runs on 10.0.0.31:
    python3 survival72.py <promotion ISO time> [hours=72]
Numbers (2-week commitments): deaths/bot-h <= 0.05; immobile bot-minutes <= 2%; iron-pickaxe bot-hours >= 8%;
gather success >= 40%; stock returned >= 20 items/bot-h. Bot-hours are counted from rows present per (bot, minute)."""
import sys, json, glob, datetime as dt, collections, math

def log_files(lo):
    """Live files plus the rotated .gz generations whose rows can fall inside the window (day d rotates into -<d+1>.gz)."""
    out = list(glob.glob('/var/log/mcai/*/skill-*.jsonl')); d = lo.date(); now = dt.datetime.now(dt.timezone.utc)
    while d <= now.date():
        out += glob.glob(f"/var/log/mcai/*/skill-*.jsonl-{(d + dt.timedelta(days=1)).strftime('%Y%m%d')}.gz"); d += dt.timedelta(days=1)
    return out
def open_log(f):
    import gzip; return gzip.open(f, 'rb') if f.endswith('.gz') else open(f, 'rb')

T0 = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')); H = int(sys.argv[2]) if len(sys.argv) > 2 else 72
lo = T0 - dt.timedelta(hours=H); hi = T0 + dt.timedelta(hours=H); now = dt.datetime.now(dt.timezone.utc)
K = collections.defaultdict(collections.Counter)      # (era, version) -> counters
minutes = collections.defaultdict(set)                 # (era, version) -> {(bot, minute)}
pos = collections.defaultdict(list)                    # (era, version, bot) -> [(t, x, z)]
first = last = None
for f in log_files(lo):
    for l in open_log(f):
        try: r = json.loads(l)
        except Exception: continue
        b = r.get('bot', {}).get('name', '')
        if not b or b.startswith('isolated'): continue
        ts = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
        if ts < lo or ts > hi: continue
        era = 'after' if ts >= T0 else 'before'; v = (r.get('code') or {}).get('version', '?')[:7]; k = (era, v)
        first = min(first, ts) if first else ts; last = max(last, ts) if last else ts
        minutes[k].add((b, ts.strftime('%m%d%H%M')))
        sk = r.get('skill') or {}; n = sk.get('name'); st = sk.get('status'); det = sk.get('detail') or ''
        if n == '_death': K[k]['deaths'] += 1
        if n == 'gather': K[k]['gather'] += 1; K[k]['gather_ok'] += (st == 'success')
        if n == 'deposit' and st == 'success':
            K[k]['deposit_ok'] += 1
            import re; m = re.findall(r'(\d+)x? [a-z_]+', det); K[k]['items_returned'] += sum(int(x) for x in m) if m else 0
        inv = r.get('bot', {}).get('inventory') or {}
        K[k]['rows'] += 1; K[k]['iron_rows'] += ('iron_pickaxe' in inv)
        p = r.get('bot', {}).get('pos') or {}
        if p.get('x') is not None: pos[(era, v, b)].append((ts, p['x'], p['z']))
# immobility: share of (bot, minute) whose 60-min trailing displacement < 6 blocks, sampled every 10 min
imm = collections.defaultdict(lambda: [0, 0])
for (era, v, b), ps in pos.items():
    ps.sort(); i = 0
    for j in range(0, len(ps), 10):
        t, x, z = ps[j]; back = t - dt.timedelta(minutes=60)
        while i < len(ps) and ps[i][0] < back: i += 1
        w = ps[i:j + 1]
        if len(w) < 5: continue
        far = max(math.hypot(x - q[1], z - q[2]) for q in w); imm[(era, v)][1] += 1; imm[(era, v)][0] += (far < 6)
print(f"promotion T0 {T0:%Y-%m-%d %H:%M}Z; window +-{H} h; coverage {first} .. {last}")
print(f"{'era':7}{'code':9}{'bot-h':>7}{'deaths/bh':>11}{'immobile':>10}{'iron-pick':>11}{'gather ok':>11}{'items/bh':>10}{'deposit ok':>12}")
for k in sorted(K):
    bh = len(minutes[k]) / 60; c = K[k]; im = imm[k]
    print(f"{k[0]:7}{k[1]:9}{bh:7.0f}{c['deaths']/max(bh,0.01):11.3f}{(100*im[0]/im[1] if im[1] else float('nan')):9.1f}%{100*c['iron_rows']/max(1,c['rows']):10.1f}%{100*c['gather_ok']/max(1,c['gather']):10.0f}%{c['items_returned']/max(bh,0.01):10.1f}{c['deposit_ok']:12}")
print("targets (2 wk): deaths <= 0.05/bh, immobile <= 2%, iron-pick >= 8%, gather >= 40%, items >= 20/bh; positive control: deaths counted", sum(c['deaths'] for c in K.values()))
