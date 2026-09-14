#!/usr/bin/env python3
"""The 72-h fleet survival read (reliability program, committed numbers): deaths per bot-hour fleet-wide over the
72 h AFTER the promotion vs the 72 h BEFORE it, plus deposit success and iron-pickaxe bot-hours where cheap.
Runs on 10.0.0.31: python3 survival72.py <promotion ISO time> [hours=72]. Logs rotate: the read reports its coverage."""
import sys, json, glob, subprocess, datetime as dt, collections
T0 = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')); H = int(sys.argv[2]) if len(sys.argv) > 2 else 72
lo = T0 - dt.timedelta(hours=H); hi = T0 + dt.timedelta(hours=H); now = dt.datetime.now(dt.timezone.utc)
deaths = collections.Counter(); dep = collections.Counter(); first = None; last = None; picks = collections.Counter(); rows = collections.Counter()
for f in glob.glob('/var/log/mcai/*/skill-*.jsonl'):
    for l in open(f, 'rb'):
        if b'"_death"' not in l and b'"deposit"' not in l and b'_milestone' not in l: continue
        try: r = json.loads(l)
        except Exception: continue
        b = r.get('bot', {}).get('name', '');
        if b.startswith('isolated'): continue
        ts = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
        if ts < lo or ts > hi: continue
        era = 'after' if ts >= T0 else 'before'; rows[era] += 1
        first = min(first, ts) if first else ts; last = max(last, ts) if last else ts
        n = (r.get('skill') or {}).get('name'); st = (r.get('skill') or {}).get('status')
        if n == '_death': deaths[era] += 1
        if n == 'deposit': dep[(era, st)] += 1
        inv = r.get('bot', {}).get('inventory') or {}
        picks[(era, 'iron' if 'iron_pickaxe' in inv else 'no-iron')] += 1
bots = 60
for era, a, b in (('before', lo, T0), ('after', T0, min(hi, now))):
    hours = max(0.01, (b - a).total_seconds() / 3600); bh = bots * hours
    ok = dep[(era, 'success')]; tot = sum(v for (e, s), v in dep.items() if e == era)
    ip = picks[(era, 'iron')]; ipt = ip + picks[(era, 'no-iron')]
    print(f"{era:6} {a:%m-%d %H:%M}..{b:%H:%M}Z  bot-h {bh:6.0f}  deaths {deaths[era]:3}  = {deaths[era]/bh:.3f}/bot-h  (target <= 0.05)  deposit {ok}/{tot} = {100*ok/max(1,tot):.0f}%  iron-pick row share {100*ip/max(1,ipt):.1f}%")
print(f"coverage: rows {dict(rows)}, first row {first}, last row {last}; positive control: deaths counted {sum(deaths.values())}")
