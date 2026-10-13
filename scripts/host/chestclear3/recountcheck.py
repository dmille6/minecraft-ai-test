#!/usr/bin/env python3
"""recountcheck.py <census.json> [--reset-after ISO-Z] <pool state dir>... -- READ-ONLY (10.0.0.31; run with sudo to read
the mcbot-owned pool dirs). It opens journal files for reading only and never folds through cobblecap.mjs, whose readTown
may write a checkpoint.

After the clear: did every town journal get THIS run's `reset`, and have the bots RECOUNTED the town since? Per pool dir:
  reset_at      the latest reset record; with --reset-after it must be at or after that time (this run's fence), else FAIL
  recounted     containers with a count (cnt/obs record, or a checkpoint/base obs entry) captured strictly after the reset
                -- also shown as a share of the census's containers for that world (coverage)
  match/partial each recounted container is compared as ONE consistent view (the container alone, or it plus ONE
                horizontally adjacent chest: a double chest is one window over two block entities and the census cannot
                see type=left/right). `match` = every NONZERO name the bot counted equals the census in that view;
                every name is compared, zeros included; a container whose recount is ALL zeros and agrees is reported as
                zero-only (weak evidence) and does not count toward `match` or coverage.
Bots count usable tool copies (> 10 uses left) and the cobble group (cobblestone + cobbled_deepslate) as one.
Without --reset-after (before the clear) it is the instrument's positive control: the latest counts against the census.
World of a pool dir: _pool-<world> or _pool-self-<world>-<Bot>. Exit 1 if any dir lacks the required reset."""
import glob, json, os, re, sys, time
from calendar import timegm
from collections import Counter

args = sys.argv[1:]
census = json.load(open(args.pop(0)))['worlds']
after_ms = None
if args and args[0] == '--reset-after':
    args.pop(0); after_ms = timegm(time.strptime(args.pop(0), '%Y-%m-%dT%H:%M:%SZ')) * 1000
GROUP = {'cobble': ('cobblestone', 'cobbled_deepslate')}
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
MAXDUR = {'wooden': 59, 'stone': 131, 'iron': 250, 'golden': 32, 'diamond': 1561, 'netherite': 2031}


def counts(cs):
    have = Counter()
    for cc in cs:
        for it in cc['items']:
            mat = it['id'].split('_')[0]
            if it['id'].endswith(TOOLS) and mat in MAXDUR:
                if it.get('damage') is None or (it.get('max_damage') or MAXDUR[mat]) - it['damage'] <= 10: continue
            have[it['id']] += it['count']
    return have


tot = Counter(); worst = []; fail = 0; cover = {}
for d in args:
    base = os.path.basename(d.rstrip('/'))
    m = re.match(r'^_pool-(?:self-)?((?:board|hive|placebo|isolated)-[a-d])(?:-[A-Za-z]+)?$', base)
    w = m.group(1) if m else None
    recs, bases = [], []
    for f in sorted(glob.glob(os.path.join(d, '*.cobble*.jsonl'))):
        for ln in open(f, errors='replace'):
            try: recs.append(json.loads(ln))
            except Exception: pass
    for f in sorted(glob.glob(os.path.join(d, '*.cobble*.json'))):          # base / checkpoint states (a rotation folds records into them)
        try: bases.append(json.load(open(f)))
        except Exception: pass
    resets = [r['at'] for r in recs if r.get('t') == 'reset' and isinstance(r.get('at'), (int, float))]
    for b in bases:
        st = b.get('state') if isinstance(b.get('state'), dict) else b
        for ws in ([st] + list((st.get('worlds') or {}).values() if isinstance(st.get('worlds'), dict) else [])):
            if isinstance(ws, dict) and isinstance(ws.get('resetAt'), (int, float)): resets.append(ws['resetAt'])
    reset_at = max(resets) if resets else None
    if after_ms is not None and not (reset_at and reset_at >= after_ms): fail += 1
    last = {}
    def take(k, cap, mm):
        if not k or not isinstance(cap, (int, float)) or not isinstance(mm, dict): return
        if reset_at is not None and not cap > reset_at: return
        if k not in last or cap >= last[k][0]: last[k] = (cap, mm)
    for r in recs:
        if r.get('t') in ('cnt', 'obs'): take(r.get('k'), r.get('cap'), r.get('m'))
    for b in bases:
        st = b.get('state') if isinstance(b.get('state'), dict) else b
        for ws in ([st] + list((st.get('worlds') or {}).values() if isinstance(st.get('worlds'), dict) else [])):
            for k, o in ((ws or {}).get('obs') or {}).items() if isinstance(ws, dict) else []:
                if isinstance(o, dict): take(k, o.get('at'), o.get('m'))
    cont = {','.join(map(str, c['pos'])): c for c in (census.get(w) or {}).get('containers', [])}
    full = partial = notin = nz = zero = zero_only = 0
    for k, (cap, mm) in last.items():
        c = cont.get(k)
        if c is None: notin += 1; continue
        x, y, z = c['pos']
        views = [[c]] + [[c, cont[a]] for a in ('%d,%d,%d' % (x + 1, y, z), '%d,%d,%d' % (x - 1, y, z), '%d,%d,%d' % (x, y, z + 1),
                                                   '%d,%d,%d' % (x, y, z - 1)) if a in cont and cont[a]['kind'] == c['kind'] == 'chest']
        best = None
        for cs in views:                                # EVERY name, zeros included (Codex r2 8: a 0 against 64 logs is wrong)
            h = counts(cs)
            ok = sum(1 for name, n in mm.items() if sum(h[q] for q in GROUP.get(name, (name,))) == n)
            if best is None or ok > best[0]: best = (ok, h)
        nzn = sum(1 for n in mm.values() if n); zero += len(mm) - nzn
        nz += sum(1 for name, n in mm.items() if n and sum(best[1][q] for q in GROUP.get(name, (name,))) == n)
        if best[0] == len(mm) and not nzn: zero_only += 1           # agrees, but only that the chest holds none: weak evidence
        elif best[0] == len(mm): full += 1
        else:
            partial += 1
            worst.append((base, k, {n: (v, sum(best[1][q] for q in GROUP.get(n, (n,)))) for n, v in mm.items()}))
    cover.setdefault(w, set()).update(k for k, (cap, mm) in last.items() if k in cont and any(mm.values()))
    tot.update({'dirs': 1, 'with_reset': reset_at is not None, 'recounted': len(last), 'match': full, 'partial': partial,
                'zero_only_match': zero_only, 'nonzero_names_matched': nz, 'zero_names': zero})
    print('%-30s %-10s reset_at %-20s recounted %3d/%3d match %3d zero-only %2d partial %2d not-in-census %d' % (
        base, w, reset_at and time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(reset_at / 1000)), len(last), len(cont), full, zero_only, partial, notin))
print('COVERAGE per world (containers with a NONZERO recount by any of its dirs / census containers):',
      {w: '%d/%d' % (len(v), len((census.get(w) or {}).get('containers', []))) for w, v in sorted(cover.items())})
print('TOTAL', dict(tot))
print('partial matches (first 10: dir, container, {name: (bots, census)}):', worst[:10])
if after_ms is not None: print('RESET', 'PASS' if not fail else 'FAIL: %d dir(s) without a reset at/after the fence time' % fail)
sys.exit(1 if fail else 0)
