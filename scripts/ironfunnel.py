#!/usr/bin/env python3
"""Nightly iron-funnel lines (iron retention plan v2): over the last 24 h on the 60 non-isolated bots --
raw iron / iron ore gathered, iron ingots smelted, iron pickaxes crafted, iron pickaxes GONE (count fell between two
rows that carry an inventory, and by the row kind where), and the iron-pickaxe bot-hour share. Runs on 10.0.0.31."""
import glob, json, datetime as dt, collections, re, sys

def log_files(lo):
    """Live files plus the rotated .gz generations whose rows can fall inside the window (day d rotates into -<d+1>.gz)."""
    out = list(glob.glob('/var/log/mcai/*/skill-*.jsonl')); d = lo.date(); now = dt.datetime.now(dt.timezone.utc)
    while d <= now.date():
        out += glob.glob(f"/var/log/mcai/*/skill-*.jsonl-{(d + dt.timedelta(days=1)).strftime('%Y%m%d')}.gz"); d += dt.timedelta(days=1)
    return out
def open_log(f):
    import gzip; return gzip.open(f, 'rb') if f.endswith('.gz') else open(f, 'rb')

H = int(sys.argv[1]) if len(sys.argv) > 1 else 24
now = dt.datetime.now(dt.timezone.utc); lo = now - dt.timedelta(hours=H)
by = collections.defaultdict(list); c = collections.Counter(); minutes = set(); iron_minutes = set()
for f in log_files(lo):
    for l in open_log(f):
        try: r = json.loads(l)
        except Exception: continue
        b = r.get('bot', {}).get('name', '')
        if not b or b.startswith('isolated'): continue
        ts = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
        if ts < lo: continue
        sk = r.get('skill') or {}; n = sk.get('name'); st = sk.get('status'); det = sk.get('detail') or ''
        inv = r.get('bot', {}).get('inventory')
        key = (b, ts.strftime('%m%d%H%M')); minutes.add(key)
        if inv is not None:
            by[b].append((ts, inv.get('iron_pickaxe', 0), n or '', det[:60], (r['bot'].get('tools') or {}).get('iron_pickaxe')))
            if inv.get('iron_pickaxe', 0) > 0: iron_minutes.add(key)
        if n == 'gather' and st == 'success' and ('raw_iron' in det or 'iron_ore' in det):
            m = re.search(r'collected (\d+)', det); c['raw_iron_gathered'] += int(m.group(1)) if m else 1
        if n == 'smelt' and st == 'success' and 'iron_ingot' in det:
            m = re.search(r'smelted (\d+)x', det); c['iron_ingots_smelted'] += int(m.group(1)) if m else 1
        if n == 'craft' and st == 'success' and 'iron_pickaxe' in det: c['iron_pickaxes_crafted'] += 1
gone = collections.Counter(); worn = 0
for b, rs in by.items():
    rs.sort()
    for i in range(1, len(rs)):
        if rs[i][1] < rs[i - 1][1]:
            k = rs[i][2]; gone['death' if k == '_death' else 'deposit' if k == 'deposit' else 'during work'] += 1
            w = rs[i - 1][4]
            if w and w.get('max') and w.get('used') is not None and w['max'] - w['used'] <= 3: worn += 1
bh = len(minutes) / 60
print(f"iron funnel, last {H} h, {bh:.0f} bot-h: raw iron gathered {c['raw_iron_gathered']} ({c['raw_iron_gathered']/max(bh,0.01):.2f}/bot-h); ingots smelted {c['iron_ingots_smelted']}; "
      f"iron pickaxes crafted {c['iron_pickaxes_crafted']}, gone {sum(gone.values())} {dict(gone)} (of which at <=3 uses left: {worn}, once wear is logged); "
      f"iron-pickaxe bot-hour share {100*len(iron_minutes)/max(1,len(minutes)):.1f}%")
