# DOES THE MODEL ACTUALLY DIVERSIFY? The relocation story says B2 stops the model
# re-proposing the identical action (warm repeat_loop DiD -12.17) and the freed proposals
# hit learned_avoid instead (+6.26, above every same-shape null draw). That is an
# INFERENCE from two veto rates. This measures the claim directly: distinct (skill,args)
# keys per bot-hour among ADMITTED decisions, and the repeat share among consecutive ones.
# Same warm window, same DiD, same exhaustive same-shape null.
import sys, os, re, subprocess, itertools, statistics, json
import datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0, "/srv/mcb-analysis-lib")
from lib.telemetry import Events

# POOLS/CUT overridable: after teardown the manifest is cleared, and this read must still
# work on data that is still on disk. NEVER typed by hand when the manifest is live.
if os.environ.get('POOLS') and os.environ.get('CUTISO'):
    CANS = {x.strip() for x in os.environ['POOLS'].split(',') if x.strip()}
    CUT = dt.datetime.fromisoformat(os.environ['CUTISO'].replace('Z', '+00:00'))
else:
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CANS = {x.strip() for x in str(man['canary_pool']).split(',') if x.strip()}
W = float(os.environ.get("W", "180")); WARM = 30.0; PRE = 180.0
now = dt.datetime.now(dt.timezone.utc)
back = int(PRE + W + 10)
ev = Events.load(since_minutes=back)
pool_of = lambda b: b.rsplit('-', 1)[0]
arm = lambda b: 'canary' if pool_of(b) in CANS else (None if pool_of(b).startswith('isolated') else 'control')
# WARM era: pre is untouched; post starts WARM minutes after the cut (the restart clears
# `recent`, so early post-deploy diversity is inflated for free).
def era(t):
    if t < CUT: return 'pre' if (CUT - t).total_seconds() / 60 <= PRE else None
    m = (t - CUT).total_seconds() / 60
    return 'post' if WARM <= m <= W else None

span = defaultdict(dict); keys = defaultdict(lambda: defaultdict(set)); seq = defaultdict(list)
nadm = Counter()
for r in ev.rows:
    raw = r.get('raw') or {}; sk = raw.get('skill') or {}
    n = sk.get('name'); b = (raw.get('bot') or {}).get('name'); t = r.get('t')
    if not (n and b and t) or n.startswith('_'): continue
    a = arm(b)
    if a is None: continue
    e = era(t)
    if e is None: continue
    k = (a, e)
    s = span[k].get(b); span[k][b] = (t if s is None else min(s[0], t), t if s is None else max(s[1], t))
    key = n + ':' + json.dumps(sk.get('args') or {}, sort_keys=True)
    keys[k][b].add(key); seq[(k, b)].append((t, key)); nadm[k] += 1

bh = lambda k: sum((v[1] - v[0]).total_seconds() / 3600.0 for v in span[k].values() if v[1] > v[0])
CP, CTL, CPRE, KPRE = ('canary', 'post'), ('control', 'post'), ('canary', 'pre'), ('control', 'pre')
print("positive control: %d rows; admitted decisions per cell %s" % (len(ev.rows), {f"{a}/{e}": nadm[(a, e)] for a in ('canary','control') for e in ('pre','post')}))
print("bot-h: canary post %.1f control post %.1f canary pre %.1f control pre %.1f" % (bh(CP), bh(CTL), bh(CPRE), bh(KPRE)))

def distinct_per_bh(k):
    if bh(k) <= 0: return None
    return sum(len(v) for v in keys[k].values()) / bh(k)

def repeat_share(k):
    tot = rep = 0
    for b in keys[k]:
        L = sorted(seq[(k, b)])
        for i in range(1, len(L)):
            tot += 1
            if L[i][1] == L[i - 1][1]: rep += 1
    return (rep / tot) if tot else None

def did(f):
    v = [f(x) for x in (CP, CPRE, CTL, KPRE)]
    return None if any(x is None for x in v) else (v[0] - v[1]) - (v[2] - v[3])

fmt = lambda x: 'n/a' if x is None else f'{x:.3f}'
print()
print("  distinct (skill,args) keys / bot-h   canary %s  control %s   DiD %s"
      % (fmt(distinct_per_bh(CP)), fmt(distinct_per_bh(CTL)), fmt(did(distinct_per_bh))))
print("  share of consecutive admitted decisions that REPEAT   canary %s  control %s   DiD %s"
      % (fmt(repeat_share(CP)), fmt(repeat_share(CTL)), fmt(did(repeat_share))))
print("     (B2's claim: the canary's repeat share must FALL; that is the whole mechanism)")
