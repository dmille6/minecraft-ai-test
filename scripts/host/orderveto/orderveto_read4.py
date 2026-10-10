"""orderveto read 4 (both r2 reviews): classify the model's first turn after a bag-full craft-order failure by whether it
took the remedy the failure NAMED -- home (the `home` skill, or a goto/explore ending within 16 blocks of home), place
<named block>, deposit -- and whether the bag lost slots within the next 3 decisions. Home = HOME_X/HOME_Z from each
bot's harness env. Same window as reads 1-3. Positive control: the classifier must find admitted `home` and `deposit`
decisions elsewhere in the fleet's rows (printed)."""
import json, glob, collections, re, os, math
SINCE, UNTIL = '2026-10-10T00:00:00', '2026-10-10T13:28:00'
STACK = json.load(open(os.path.expanduser('~/orderveto/stacks.json')))


def est_slots(inv):
    return sum(-(-int(c) // max(1, STACK.get(n, 64))) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0)


def home_of(bot):
    h = {}
    try:
        for l in open('/srv/mcbots/harness/env/%s.env' % bot):
            m = re.match(r'^(HOME_X|HOME_Z)=(-?[\d.]+)', l.strip())
            if m:
                h[m.group(1)] = float(m.group(2))
    except OSError:
        return None
    return (h['HOME_X'], h['HOME_Z']) if 'HOME_X' in h and 'HOME_Z' in h else None


cls = collections.Counter(); cls_ex = {}; freed = collections.Counter(); ctrl = collections.Counter(); dist0 = []
nohome = 0
for f in sorted(glob.glob('/var/log/mcai/*/llm-*.jsonl')):
    bot = f.split('/')[-2]
    home = home_of(bot)
    rows = []
    for l in open(f, errors='replace'):
        if '"@timestamp":"2026-10-10' not in l[:40]:
            continue
        try:
            d = json.loads(l)
        except Exception:
            continue
        t = d.get('@timestamp', '')
        if not (SINCE <= t < UNTIL):
            continue
        llm = d.get('llm') or {}; o = d.get('outcome') or {}
        tc = (d.get('tool_calls') or [None])[0] or {}
        resp = ((d.get('response') or {}).get('text') or '')
        src = 'order' if (llm.get('latency_ms') or 0) == 0 and not resp and tc.get('skill') else 'model'
        b = d.get('bot') or {}
        rows.append(dict(t=t, src=src, sk=tc.get('skill'), args=tc.get('args') or {}, adm=llm.get('admission') is not None,
                         st=o.get('status'), det=o.get('detail') or '', err=llm.get('error'), pos=b.get('pos') or {}, inv=b.get('inventory') or {}))
    rows.sort(key=lambda r: r['t'])
    for r in rows:
        if r['adm'] and r['sk'] in ('home', 'deposit'):
            ctrl[(r['sk'], r['st'])] += 1
    pend = None
    for i, r in enumerate(rows):
        if r['src'] == 'order' and r['sk'] == 'craft' and r['adm'] and r['st'] == 'failed' and re.search(r'frees slots|No room|no room', r['det']):
            kind = 'home' if r['det'].startswith('home --') else 'deposit' if r['det'].startswith('deposit ') else 'place' if r['det'].startswith('place ') else 'other'
            m = re.match(r'place (\S+)', r['det'])
            pend = (kind, m.group(1) if m else None, est_slots(r['inv']), r)
            continue
        if pend and r['src'] == 'model':
            kind, blk, slots0, fr = pend
            pend = None
            if home is None:
                nohome += 1
            took = False
            if kind in ('home', 'deposit'):
                if r['adm'] and r['sk'] in ('home', 'deposit'):
                    took = True
                elif r['adm'] and r['sk'] in ('goto', 'explore') and home is not None and i + 1 < len(rows):
                    p = rows[i + 1]['pos']
                    if 'x' in p and math.hypot(p['x'] - home[0], p['z'] - home[1]) <= 16:
                        took = True
            elif kind == 'place':
                took = r['adm'] and r['sk'] == 'place' and (r['args'].get('item') == blk)
            if home is not None and 'x' in (fr['pos'] or {}):
                dist0.append(math.hypot(fr['pos']['x'] - home[0], fr['pos']['z'] - home[1]))
            key = (kind, 'TOOK the named remedy' if took else 'other: %s %s' % (r['sk'], 'admitted' if r['adm'] else 'refused ' + str(r['err'])))
            cls[key] += 1; cls_ex.setdefault(key, (bot, r['t'], r['det'][:100]))
            later = [x for x in rows[i + 1:i + 4]]
            s3 = min([est_slots(x['inv']) for x in later if x['inv']] or [slots0])
            freed[(kind, took, s3 < slots0)] += 1

n = sum(cls.values())
print('MODEL TURN after a bag-full craft-order failure, by the remedy named and whether it was taken (n=%d; bots without an env home %d)' % (n, nohome))
for (k, c), v in sorted(cls.items(), key=lambda kv: (kv[0][0], -kv[1])):
    print('  %-8s %4d  %-50s e.g. %s' % (k, v, c, cls_ex[(k, c)]))
took = sum(v for (k, c), v in cls.items() if c.startswith('TOOK'))
print('TOOK the named remedy: %d of %d' % (took, n))
print('bag lost slots within the next 3 decisions: %s' % {('%s/%s' % (k, 'took' if t else 'not')): (v, 'freed' if f else 'not') for (k, t, f), v in freed.items()})
dist0.sort()
print('distance from home at the failure: median %s p90 %s (n=%d)' % (dist0[len(dist0) // 2] if dist0 else None, dist0[int(.9 * len(dist0))] if dist0 else None, len(dist0)))
print('POSITIVE CONTROL: admitted home/deposit decisions fleet-wide in the window', dict(ctrl))
