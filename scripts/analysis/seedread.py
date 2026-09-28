#!/usr/bin/env python3
"""
seedread.py -- the registered seed-canary read (docs/reports/seed-canary-registration.md).

  seedread.py <pool> <hours>        e.g.  seedread.py placebo-a 24

DiD: the re-seeded pool vs the FOURTEEN controls (both re-seeded pools are held out
of control), pre = the 24 h before that pool's own T0, post = the first <hours> after.

Five program numbers, by class where it applies: deaths/bot-h split lava/drown/fall,
immobile bot-hour share, gather success, stock returned, iron-pickaxe bot-hour share.

DENOMINATORS. bot-hours are OBSERVED (distinct bot x clock-hour cells carrying at
least one row), not bots*hours -- a pool whose bots were down would otherwise be
credited with hours it did not run, and the re-seeded pools were restarted inside
this window by construction.

POSITIVE CONTROL runs first and the script REFUSES rather than print zeroes: every
number below is an absence claim about a pool of five bots, which is exactly the
shape that has been wrong here before.

The 24-h read carries the registered RESEED-PLUS-RESET confound: the pool's state
dirs, inventories, world changes and world clock were reset with the terrain, so a
24-h difference is not attributable to the seed. Printed on every run.
"""
import sys, datetime as dt, collections, glob as _g

sys.path.insert(0, '/home/mike/mcai-analysis')          # golden analysis library
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

POOL = sys.argv[1] if len(sys.argv) > 1 else 'placebo-a'
HOURS = float(sys.argv[2]) if len(sys.argv) > 2 else 24.0
RESEEDED = {'placebo-a', 'placebo-b'}                    # both are treatment; neither may be a control
T0S = {'placebo-a': '2026-09-19T00:00:44Z', 'placebo-b': '2026-09-19T11:25:23Z'}
if POOL not in T0S:
    print(f"seedread REFUSED: {POOL} is not a re-seeded pool ({', '.join(sorted(T0S))})"); sys.exit(2)
T0 = dt.datetime.fromisoformat(T0S[POOL].replace('Z', '+00:00'))
PRE0, POST1 = T0 - dt.timedelta(hours=24), T0 + dt.timedelta(hours=HOURS)
now = dt.datetime.now(dt.timezone.utc)
if now < POST1:
    print(f"seedread REFUSED: the +{HOURS:.0f} h window closes at {POST1:%Y-%m-%d %H:%M}Z, "
          f"{(POST1-now).total_seconds()/60:.0f} min from now"); sys.exit(2)

def load_window(since_minutes):
    """Rotation-aware: the live files plus every .gz generation the window touches."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    start = now - dt.timedelta(minutes=since_minutes); d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz',
                                       since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    return ev

span = int((now - PRE0).total_seconds() / 60) + 90
ev = load_window(span)

# ---- POSITIVE CONTROL, before any count that could come back zero -------------
allbots = {(r['bot'] or {}).get('name') for r in ev.rows if (r['bot'] or {}).get('name')}
kinds = {r['name'] for r in ev.rows}
print(f"positive control: {len(ev.rows)} rows, {len(allbots)} bots, {len(kinds)} distinct kinds, "
      f"walk spans {span/60:.1f} h")
if len(ev.rows) < 1000 or len(allbots) < 20 or len(kinds) < 10:
    print("seedread REFUSED: the walk looks broken; nothing below would mean anything"); sys.exit(1)

# CONTROL POOLS THAT RAN A CANARY ARE NOT CLEAN CONTROLS.
#
# The registration requires this read be split at each declared_code_version
# change. The +48 h read on placebo-a could not be: every control pool carried
# b1659c0 AND cfc1c58 inside the post window. Those two are FLEET-WIDE baselines
# and affect both arms, so they cancel in a difference-in-differences. What does
# NOT cancel is a canary build on a specific control pool -- board-a and board-c
# ran 2850cde (leaf-01), board-b and hive-a ran 1457f3a (digwatch-01), board-d and
# placebo-d ran cfc1c58 as a canary before it was promoted. Six of fourteen
# controls were carrying someone else's experiment.
#
# SEED_CONTROL_EXCLUDE is a comma-separated pool list dropped from the CONTROL arm
# only; the treatment arm is untouched. Running the read with and without it is the
# sensitivity analysis, and BOTH numbers get reported -- if they disagree the
# headline is the contamination, not the seed.
_EXCL = {x.strip() for x in __import__('os').environ.get('SEED_CONTROL_EXCLUDE', '').split(',') if x.strip()}
if _EXCL: print(f"  CONTROL ARM RESTRICTED: dropping {', '.join(sorted(_EXCL))}")

def arm_of(bot):
    p = bot.rsplit('-', 1)[0]
    if p == POOL: return 'treatment'
    if p in RESEEDED: return None                        # the other re-seeded pool: neither arm
    if p.startswith('isolated') or p.startswith('self-'): return None
    if p in _EXCL: return None                           # ran someone else's canary in this window
    return 'control'

def era_of(t):
    if PRE0 <= t < T0: return 'pre'
    if T0 <= t < POST1: return 'post'
    return None

# ---- accumulate ---------------------------------------------------------------
cells = collections.defaultdict(set)      # (arm,era) -> {(bot, hour)}
deaths = collections.defaultdict(collections.Counter)
g = collections.defaultdict(collections.Counter)
stock = collections.Counter()
ironcells = collections.defaultdict(set)
posc = collections.defaultdict(lambda: collections.defaultdict(list))   # (arm,era)->(bot,hr)->[(x,z)]
poolver = collections.defaultdict(set)
for r in ev.rows:
    b = (r['bot'] or {}).get('name')
    if not b: continue
    arm = arm_of(b)
    if arm is None: continue
    t = r['t']; era = era_of(t)
    if era is None: continue
    k = (arm, era); hr = t.replace(minute=0, second=0, microsecond=0)
    cells[k].add((b, hr))
    if era == 'post':
        poolver[b.rsplit('-', 1)[0]].add(((r['raw'].get('code') or {}).get('version') or '?').split('+')[0])
    sk = r['raw'].get('skill') or {}
    if r['name'] == '_death':
        d = (r['detail'] or '').lower()
        cls = ('drown' if 'drown' in d else 'lava' if 'lava' in d else
               'fall' if ('fell from a high place' in d or 'fall' in d) else 'other')
        deaths[k][cls] += 1; deaths[k]['all'] += 1
    if r['name'] == 'gather':
        g[k][sk.get('status')] += 1
    if r['name'] == 'deposit':
        for item, v in (sk.get('inventory_delta') or {}).items():
            stock[(k, 'out' if v < 0 else 'in')] += abs(v)
    inv = (r['bot'] or {}).get('inventory') or {}
    if any('iron_pickaxe' in str(i) for i in inv):
        ironcells[k].add((b, hr))
    p = (r['bot'] or {}).get('pos')
    if p and p.get('x') is not None:
        posc[k][(b, hr)].append((p['x'], p['z']))

def immshare(k):
    cs = posc[k]
    if not cs: return None, 0
    imm = sum(1 for _, ps in cs.items()
              if max(x for x, _ in ps) - min(x for x, _ in ps) < 6
              and max(z for _, z in ps) - min(z for _, z in ps) < 6)
    return 100.0 * imm / len(cs), len(cs)

def did(tp, tq, cp, cq, pct=False):
    """Difference of differences. Returns a string; says UNREADABLE on a hole."""
    vals = [tp, tq, cp, cq]
    if any(v is None for v in vals): return "UNREADABLE (a side is missing)"
    if pct: return f"{(tq-tp) - (cq-cp):+.1f} pp"
    return f"{(tq-tp) - (cq-cp):+.3f}"

print()
print(f"SEED CANARY READ -- pool {POOL}, +{HOURS:.0f} h")
print(f"  T0 {T0:%Y-%m-%d %H:%M:%S}Z   pre [{PRE0:%m-%d %H:%M}, {T0:%m-%d %H:%M})   "
      f"post [{T0:%m-%d %H:%M}, {POST1:%m-%d %H:%M})Z")
print(f"  treatment = {POOL}; control = every pool except placebo-a and placebo-b "
      f"(the other re-seeded pool is held out of BOTH arms)")
print(f"  REGISTERED CONFOUND: this is a reseed-PLUS-RESET. State dirs, inventories, world")
print(f"  changes and the world clock were reset with the terrain, and the bots were restarted.")
print(f"  A +24 h difference is NOT attributable to the seed; the 48 and 72 h reads are.")
print()
hdr = f"  {'arm/era':<18}{'bot-h':>7}{'deaths':>8}{'/bot-h':>9}{'drown':>7}{'lava':>6}{'fall':>6}{'immob%':>8}{'gather%':>9}{'stock/bh':>10}{'iron%':>7}"
print(hdr); print("  " + "-" * (len(hdr) - 2))
M = {}
for arm in ('treatment', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); bh = len(cells[k])
        if not bh:
            print(f"  {arm+'/'+era:<18}{'0':>7}   NO DATA -- refusing to report this cell as zero"); continue
        dd = deaths[k]; ish, icells = immshare(k)
        gt = g[k]['success'] + g[k]['failed'] + g[k]['aborted']
        gs = 100.0 * g[k]['success'] / gt if gt else None
        net = stock[(k, 'out')] - stock[(k, 'in')]
        iron = 100.0 * len(ironcells[k]) / bh
        M[k] = dict(bh=bh, deaths=dd['all'], drate=dd['all']/bh, drown=dd['drown'], lava=dd['lava'],
                    fall=dd['fall'], imm=ish, g=gs, gt=gt, stock=net/bh, iron=iron)
        print(f"  {arm+'/'+era:<18}{bh:>7}{dd['all']:>8}{dd['all']/bh:>9.4f}{dd['drown']:>7}{dd['lava']:>6}"
              f"{dd['fall']:>6}{(f'{ish:.1f}' if ish is not None else 'n/a'):>8}"
              f"{(f'{gs:.1f}' if gs is not None else 'n/a'):>9}{net/bh:>10.2f}{iron:>7.1f}")
T, C = ('treatment', 'pre'), ('treatment', 'post')
CP, CQ = ('control', 'pre'), ('control', 'post')
if all(k in M for k in (T, C, CP, CQ)):
    print()
    print("  DiD (treatment change minus control change)")
    print(f"    deaths/bot-h   {did(M[T]['drate'], M[C]['drate'], M[CP]['drate'], M[CQ]['drate'])}"
          f"   [counts {M[T]['deaths']}->{M[C]['deaths']} vs {M[CP]['deaths']}->{M[CQ]['deaths']};"
          f" 5 bots cannot resolve a rate this rare -- a tripwire, not a result]")
    print(f"    immobile share {did(M[T]['imm'], M[C]['imm'], M[CP]['imm'], M[CQ]['imm'], pct=True)}")
    print(f"    gather success {did(M[T]['g'], M[C]['g'], M[CP]['g'], M[CQ]['g'], pct=True)}"
          f"   [terminal rows {M[T]['gt']}->{M[C]['gt']} vs {M[CP]['gt']}->{M[CQ]['gt']}]")
    print(f"    stock/bot-h    {did(M[T]['stock'], M[C]['stock'], M[CP]['stock'], M[CQ]['stock'])}")
    print(f"    iron-pick share{did(M[T]['iron'], M[C]['iron'], M[CP]['iron'], M[CQ]['iron'], pct=True)}")
print()
print("  DEATH CLASSES SEEN ON THE NEW SEED (post, treatment): " +
      (", ".join(f"{c} {n}" for c, n in deaths[C].most_common() if c != 'all') or "NONE"))
multi = {p: v for p, v in poolver.items() if len(v) > 1}
crossver = {p: sorted(v) for p, v in poolver.items() if v - {sorted(poolver.get(POOL, {'?'}))[0]}}
print("  CONTAMINATION: control pools that ran a canary build inside the post window --")
allv = collections.Counter()
for p, v in poolver.items(): allv[tuple(sorted(v))] += 1
for p, v in sorted(poolver.items()):
    if len(v) > 1 or (len(allv) > 1 and p != POOL):
        print(f"    {p}: {', '.join(sorted(v))}")
print("    (code epochs differ by pool because canaries ran during this window; the registration")
print("     requires the read be split at each declared_code_version change -- see the status report)")
