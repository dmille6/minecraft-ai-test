# queue-order.py [hours] -- rule v16.3: before each draw, the last N hours of fleet deaths by class and activity, and
# each queued canary's coverage, so the slot goes to the candidate covering the most deaths. Kinds carry the
# underscore; live files + the rotated generations in the window. Edit QUEUE when the queue changes.
import sys, json, glob, gzip, re, datetime as dt, collections
H = float(sys.argv[1]) if len(sys.argv) > 1 else 12
now = dt.datetime.now(dt.timezone.utc); lo = now - dt.timedelta(hours=H)
QUEUE = {   # candidate -> (classes it addresses)
    '-10 pocket rung (recovery-ladder-10 4bfe2f2)': {('drown', 'idle'), ('drown', 'mine'), ('drown', 'gather')},
    '-09 iron retention (recovery-ladder-iron 4bf76a5)': set(),
    '-08e lava guards + guarded fallback (recovery-ladder-lava 2d5c83e)': {('lava', 'idle'), ('lava', 'explore'), ('lava', 'goto'), ('lava', 'gather'), ('fall', 'explore')},
    '-11 canopy drop measure (recovery-ladder-canopy 4664df9)': {('fall', 'gather'), ('fall', 'explore')},
}
files = glob.glob('/var/log/mcai/*/skill-*.jsonl') + [f for f in glob.glob('/var/log/mcai/*/skill-*.jsonl-*.gz') if f.rsplit('-', 1)[1][:8] >= lo.strftime('%Y%m%d')]
c = collections.Counter(); n = 0; bots = set()
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    with op(f, 'rt', errors='replace') as fh:
        for l in fh:
            if '"_death"' not in l: continue
            try: r = json.loads(l)
            except Exception: continue
            ts = r.get('@timestamp', '')
            try: t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except Exception: continue
            if t < lo: continue
            b = r.get('bot', {}).get('name', ''); bots.add(b)
            if b.startswith('isolated'): continue
            d = (r.get('skill') or {}).get('detail') or ''; n += 1
            cls = 'lava' if 'lava' in d else 'drown' if 'drown' in d else 'fall' if 'fell' in d else 'fire' if ('burn' in d or 'fire' in d) else 'other'
            m = re.search(r'was running (\w+)', d); ctx = 'idle' if 'idle at the moment' in d else (m.group(1) if m else '?')
            c[(cls, ctx)] += 1
print(f"fleet deaths, last {H:.0f} h (non-isolated pools, {60} bots): {n} = {n / (60 * H):.3f}/bot-h; positive control: bots seen {len(bots)}")
for k, v in c.most_common(): print(f"   {v:3d}  {k[0]:6} during {k[1]}")
print("queue coverage (deaths in the window addressed by each candidate):")
cov = sorted(((sum(v for k, v in c.items() if k in cls), name) for name, cls in QUEUE.items()), reverse=True)
for v, name in cov: print(f"   {v:3d}  {name}")
print("ORDER:", ' -> '.join(name.split(' (')[0] for v, name in cov))
