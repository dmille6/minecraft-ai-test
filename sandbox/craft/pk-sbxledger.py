# sandbox/craft/pk-sbxledger.py <sandbox/log/peacefulkit-ab/<tag>/skill-<bot>.jsonl>... -- the read's own Ledger(SWORD) + ledger_step + row_times over sandbox rows (Claude r-rev3:
# "K2 has never been exercised on a real burn"). Execs the read's pure part (everything before its import-time selftest).
import sys, json, datetime as dt
here = __file__.rsplit('/', 1)[0]
import os
READ = os.environ.get('PK_READ') or next((c for c in (here + '/../../scripts/host/peacefulkitread.py', here + '/peacefulkitread.py') if os.path.exists(c)), None)
src = open(READ).read()
print('read:', READ)
cut = src.index('\nselftest()\n')
ns = {'__name__': 'sbxledger'}
exec(compile(src[:cut], 'peacefulkitread.py', 'exec'), ns)
Ledger, ledger_step, row_times, SWORD = ns['Ledger'], ns['ledger_step'], ns['row_times'], ns['SWORD']
for path in sys.argv[1:]:
    rows = []
    for line in open(path, errors='replace'):
        try:
            raw = json.loads(line)
        except Exception:
            continue
        t = dt.datetime.fromisoformat(raw['@timestamp'].replace('Z', '+00:00'))
        sk = raw.get('skill') or {}
        rows.append({'t': t, 'name': sk.get('name'), 'raw': raw, 'bot': raw.get('bot') or {}, 'detail': sk.get('detail')})
    rows.sort(key=lambda r: row_times(r)[1])
    # THE BASELINE: the harness's RCON snapshot of the bag before the command (the server's slots), one second before the
    # first row -- without it the first row's own snapshot is the baseline and a fall before it is never seen.
    tag = path.split('/')[-2]
    res = os.path.dirname(os.path.dirname(os.path.abspath(path))) + '/results-' + tag.split('-')[0] + '-sandbox3.jsonl'
    try:
        base = [json.loads(l) for l in open(res) if '"tag":"%s"' % tag in l]
    except OSError:
        base = []
    if base and rows:
        bag = base[0]['before']['totals']['bag']
        rows.insert(0, {'t': rows[0]['t'] - dt.timedelta(seconds=1), 'name': '_baseline', 'raw': {}, 'bot': {'inventory': bag}, 'detail': 'RCON before'})
        print('   baseline (RCON) swords', {k: v for k, v in bag.items() if 'sword' in k})
    L = Ledger(SWORD)
    trail = []
    for r in rows:
        t0, t = row_times(r)
        sk = r['raw'].get('skill') or {}
        inv = r['bot'].get('inventory') if isinstance(r['bot'].get('inventory'), dict) else None
        ledger_step(L, r['name'], t0, t, inv, sk.get('inventory_delta') or {}, sk)
        if r['name'] in ('_sword_fuel', 'smelt'):
            trail.append('%s %s swords=%s' % (r['name'], (r['detail'] or '')[:60], {k: v for k, v in (inv or {}).items() if 'sword' in k}))
    end = rows[-1]['t'] + dt.timedelta(hours=1) if rows else None
    n = L.finalize(end) if rows else {}
    print(path.split('/')[-2], dict(n))
    for x in trail:
        print('   ', x)
