#!/usr/bin/env python3
"""Dump one bot's skill rows in a window, compact. usage: trail.py BOT FROM TO [files...]"""
import sys, json, gzip, glob
bot, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
files = sys.argv[4:] or sorted(glob.glob(f'/var/log/mcai/{bot}/skill-{bot}.jsonl*'))
n = 0; tot = 0
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    with op(f, 'rt', errors='replace') as fh:
        for line in fh:
            tot += 1
            try:
                r = json.loads(line)
            except Exception:
                continue
            ts = r.get('@timestamp', '')
            if not (frm <= ts <= to):
                continue
            n += 1
            s = r.get('skill') or {}; b = r.get('bot') or {}
            p = b.get('pos') or {}
            pos = f"{p.get('x')},{p.get('y')},{p.get('z')}" if p else '-'
            args = s.get('args') or {}
            a = json.dumps(args, separators=(',', ':'))[:300] if args else ''
            ver = (r.get('code') or {}).get('version', '')[:8]
            extra = {k: b[k] for k in ('oxygen', 'oxygenLevel', 'inWater', 'eyeInWater', 'onGround') if k in b}
            print(f"{ts[11:23]} {s.get('name')} {s.get('status')} trig={r.get('trigger')} d={s.get('duration_ms')} "
                  f"mv={s.get('distance_moved')} hp={b.get('health')} {extra or ''} pos={pos} held={b.get('held')} v={ver} | "
                  f"{(s.get('detail') or '')[:500]} {('ARGS ' + a) if a else ''}")
print(f"# rows in window {n}, rows walked {tot}", file=sys.stderr)
