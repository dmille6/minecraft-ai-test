#!/usr/bin/env python3
"""derive-affordances.py -- Layer 0, read-only: what did bots PROVE about terrain?

    ssh mike@10.0.0.31 'python3 -' < scripts/derive-affordances.py            # today
    ssh mike@10.0.0.31 'python3 - 240' < scripts/derive-affordances.py        # last 240 min

WHAT THIS IS

An affordance ledger records what a bot ACTUALLY PROVED by trying: "A->B worked
by walking", "B->A failed, drop too high", "this shaft is one-way down without
blocks", "this crossing made 80 blocks of progress and was not a failure".

It is deliberately NOT a world model. Every trap in this system is a one-way door
a bot walked through without knowing it was one-way, and entrapment is the #1
productivity killer -- so the missing object is not better terrain data, it is a
record of which commitments were reversible.

WHY IT IS DERIVED FROM TELEMETRY AND NOT EMITTED BY SKILLS

Because it can be, and because that means the fleet does not have to change to
find out whether the idea works. Every skill event already carries a position, a
status and an inventory. If the derived ledger cannot explain yesterday's traps,
no amount of new emit-sites in the hot loop would have helped. Deliberate
emission comes later, only where telemetry genuinely cannot classify the cause.

WHY IT IS SCOPE-AWARE, WHICH IS THE PART THAT COULD RUIN THE EXPERIMENT

This is a memory-sharing experiment. Traversal knowledge IS memory. A global
ledger would silently hand every arm the most valuable shared memory in the
system and destroy the treatment. So edges are attributed to (scope, pool) and
this script reports them separately -- an isolated bot's edges are its own, a
hive pool's are shared, and board edges would only move at a board visit.

If hive bots compound terrain knowledge and isolated bots do not, that is not
contamination. That is the result.
"""
import json, glob, sys, math, collections, datetime

import gzip as _gzip
def _openlog(p):
    """Rotated telemetry is gzipped; a plain open() would parse compressed bytes
    as text and silently yield nothing. See scripts/lib/telemetry.py:open_log."""
    return _gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')

MINS = int(sys.argv[1]) if len(sys.argv) > 1 else None
NOW = datetime.datetime.now(datetime.timezone.utc)
CUT = NOW - datetime.timedelta(minutes=MINS) if MINS else NOW.replace(hour=0, minute=0, second=0, microsecond=0)

# Anchor quantisation. Block-level is millions of edges; chunk-level cannot say
# "the drop out of this hole is 7 blocks". 8 horizontal / 4 vertical keeps the
# vertical resolution that matters for descent while collapsing the horizontal
# wandering that does not.
AX, AY = 8, 4
def anchor(p):
    return (int(round(p['x'] / AX) * AX), int(round(p['y'] / AY) * AY), int(round(p['z'] / AX) * AX))

# An edge is only worth recording when something happened. A successful leg has
# to have covered real ground, or every idle wobble becomes an edge.
MIN_LEG = 32

TRAP_KINDS = {
    '_marooned': 'marooned', '_marooned_needs_scaffold': 'needs_scaffold',
    '_marooned_needs_pickaxe': 'needs_pickaxe', '_entombed': 'entombed',
    '_entombed_unrecoverable': 'entombed_hard', '_drowning_route': 'drowning',
    '_drowning_surfaced_stranded': 'stranded_water', '_reflex_stuck': 'stuck',
    '_unstick_oscillation': 'oscillating', '_death': 'died',
    '_path_noPath': 'no_path', '_path_timeout': 'path_timeout',
}

rows = []
for f in glob.glob('/var/log/mcai/*/skill-*.jsonl*'):
    try:
        with _openlog(f) as fh:
            for line in fh:
                try: d = json.loads(line)
                except Exception: continue
                try: t = datetime.datetime.fromisoformat(d.get('@timestamp','').replace('Z','+00:00'))
                except Exception: continue
                if t < CUT: continue
                b = d.get('bot') or {}; p = b.get('pos') or {}
                if 'x' not in p: continue
                e = d.get('exp') or {}
                rows.append({
                    't': t, 'bot': b.get('name'), 'pos': p,
                    'name': (d.get('skill') or {}).get('name',''),
                    'status': (d.get('skill') or {}).get('status',''),
                    'detail': (d.get('skill') or {}).get('detail') or '',
                    'inv': b.get('inventory') or {}, 'health': b.get('health'),
                    'scope': e.get('memory_scope','?'), 'pool': e.get('pool','?'), 'arm': e.get('arm','?'),
                })
    except Exception:
        pass

if not rows:
    print("NO EVENTS — check the window, not the fleet: a window in the future returns exactly this.")
    sys.exit(2)

per = collections.defaultdict(list)
for r in rows: per[r['bot']].append(r)
for v in per.values(): v.sort(key=lambda r: r['t'])

edges = {}          # (scope,pool,from,to,mode) -> record
traps = collections.Counter()
trap_sites = collections.defaultdict(collections.Counter)

def bump(key, **kw):
    e = edges.setdefault(key, {'attempts':0,'successes':0,'failures':0,'reporters':set(),
                               'blocks_placed':0,'blocks_broken':0,'max_drop':0,'first':None,'last':None})
    e['attempts'] += 1
    for k, v in kw.items():
        if k in ('successes','failures'): e[k] += v
        elif k == 'reporter': e['reporters'].add(v)
        elif k in ('blocks_placed','blocks_broken'): e[k] += v
        elif k == 'drop': e['max_drop'] = max(e['max_drop'], v)
    return e

for bot, evs in per.items():
    last = None
    for r in evs:
        a = anchor(r['pos'])
        scope, pool = r['scope'], r['pool']

        # --- hard negatives: a trap is proof about a PLACE, not about an edge --
        if r['name'] in TRAP_KINDS:
            traps[TRAP_KINDS[r['name']]] += 1
            trap_sites[(scope, pool)][a] += 1

        # --- directed travel edges, from consecutive positions ----------------
        if last is not None:
            fa, fp, ft = last['anchor'], last['pos'], last['t']
            dist = math.hypot(r['pos']['x']-fp['x'], r['pos']['z']-fp['z'])
            dt = (r['t']-ft).total_seconds()
            if fa != a and dist >= MIN_LEG and 0 < dt < 600:
                # inventory delta tells us whether terrain was CHANGED en route
                placed = sum(max(0, last['inv'].get(k,0)-r['inv'].get(k,0))
                             for k in last['inv'] if k.endswith(('_planks','cobblestone','dirt','_log')))
                broken = sum(max(0, r['inv'].get(k,0)-last['inv'].get(k,0))
                             for k in r['inv'] if k.endswith(('cobblestone','dirt','_log','sand','gravel')))
                mode = 'construct' if placed > 0 else ('mine' if broken > 2 else 'walk')
                ok = r['status'] != 'failed'
                bump((scope,pool,fa,a,mode), successes=1 if ok else 0, failures=0 if ok else 1,
                     reporter=bot, blocks_placed=placed, blocks_broken=broken,
                     drop=max(0, fp['y']-r['pos']['y']))
        last = {'anchor': a, 'pos': r['pos'], 't': r['t'], 'inv': r['inv']}

# ---------------------------------------------------------------- report -----
print("  window: %s   events: %d   bots: %d" %
      ("last %d min" % MINS if MINS else "since 00:00Z", len(rows), len(per)))
print("\n=== EDGE COUNT (is the granularity sane?) ===")
print("  directed edges derived : %d" % len(edges))
print("  anchors quantised at   : %d horizontal / %d vertical" % (AX, AY))
print("  target                 : hundreds to low thousands, NOT millions")

by_mode = collections.Counter(k[4] for k in edges)
print("\n=== by mode ===")
for m, n in by_mode.most_common(): print("  %-10s %d" % (m, n))

print("\n=== REVERSIBILITY: how many edges have a proven reverse? ===")
rev = 0; oneway = 0
for (s,p,f,t,m) in edges:
    if (s,p,t,f,m) in edges: rev += 1
    else: oneway += 1
print("  reverse proven   : %d" % rev)
print("  reverse UNPROVEN : %d   <- every one is a possible one-way door" % oneway)

print("\n=== TRAPS (proof about a place) ===")
for k, n in traps.most_common(10): print("  %-16s %d" % (k, n))

print("\n=== SCOPE SEPARATION (the part that could ruin the experiment) ===")
per_scope = collections.Counter((k[0], k[1]) for k in edges)
for (s, p), n in sorted(per_scope.items()): print("  scope=%-10s pool=%-12s edges=%d" % (s, p, n))
print("  -> these MUST stay separate; a global ledger would hand every arm the")
print("     most valuable shared memory in the system and destroy the treatment.")

print("\n=== WORST TRAP SITES (per pool, top 3) ===")
for (s, p), sites in sorted(trap_sites.items()):
    top = sites.most_common(3)
    if not top: continue
    print("  %-10s %-12s %s" % (s, p, "  ".join("%s x%d" % (str(a), n) for a, n in top)))
