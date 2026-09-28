# DOES THE THROTTLE ACTUALLY BITE? For each heavily-throttled key, compare the attempt
# rate per bot-hour between bots whose OWN store holds the rule at >= 4 and bots whose
# does not. If the ~80% throttle is real, throttled bots should attempt it ~5x less.
# Hive pools share one store named _pool-hive-<x>, so a hive bot maps to that store.
import sys, json, glob, os, collections
sys.path.insert(0, "/srv/mcb-analysis-lib")
from lib.telemetry import Events
canon = lambda s, a: s + ":" + json.dumps(a or {}, sort_keys=True, separators=(",", ":"))
THRESH = 4
MINS = int(os.environ.get("MINS", "360"))

store = {}
for f in glob.glob("/var/lib/mcai/*/lessons-*.json"):
    if ".pre-reseed" in f: continue
    owner = os.path.basename(os.path.dirname(f))
    try: d = json.load(open(f))
    except Exception: continue
    m = {}
    for k, v in (d.get("avoid") or {}).items():
        i = k.find(":")
        try: args = json.loads(k[i + 1:])
        except Exception: continue
        m[canon(k[:i], args)] = v.get("fails", 0)
    store[owner] = m
pools = {o[len("_pool-"):] for o in store if o.startswith("_pool-")}
def store_for(bot):
    p = bot.rsplit("-", 1)[0]
    return store.get("_pool-" + p) if p in pools else store.get(bot)
print("stores %d (pool-shared: %s)" % (len(store), sorted(pools)))

ev = Events.load(since_minutes=MINS)
att = collections.defaultdict(collections.Counter)
okc = collections.defaultdict(collections.Counter)
stat = collections.Counter()
spans = {}
for r in ev.rows:
    raw = r.get("raw") or {}; sk = raw.get("skill") or {}
    b = (raw.get("bot") or {}).get("name"); t = r.get("t")
    if b and t:
        lo, hi = spans.get(b, (t, t)); spans[b] = (min(lo, t), max(hi, t))
    n = sk.get("name")
    if not n or n.startswith("_") or not b: continue
    st = sk.get("status")
    if st not in ("success", "failed", "fail", "no_effect", "aborted", "unknown"): continue
    ck = canon(n, sk.get("args")); att[ck][b] += 1; stat[st] += 1
    if st == "success": okc[ck][b] += 1
bh = {b: (hi - lo).total_seconds() / 3600 for b, (lo, hi) in spans.items()}
print("positive control: window %d min, %d bots, %.0f bot-h, %d keys" % (MINS, len(bh), sum(bh.values()), len(att)))
print()
KEYS = ['craft:{"item":"stone_pickaxe"}', 'gather:{"block":"cobblestone","count":8}',
        'gather:{"block":"oak_log","count":1}', 'gather:{"block":"dirt","count":1}',
        'gather:{"block":"dirt","count":8}', 'gather:{"block":"oak_log","count":8}',
        'gather:{"block":"stone","count":1}', 'goto:{"x":355,"y":73,"z":147}']
print("  KEY                                THROTTLED(fails>=4)      NOT THROTTLED         ratio")
print("                                     bots att/bot-h  ok%%     bots att/bot-h  ok%%")
for k in KEYS:
    gT = [b for b in bh if (store_for(b) or {}).get(k, 0) >= THRESH]
    gN = [b for b in bh if b not in gT and store_for(b) is not None]
    def agg(g):
        h = sum(bh[b] for b in g); a = sum(att[k][b] for b in g); s = sum(okc[k][b] for b in g)
        return len(g), (a / h if h else None), (100.0 * s / a if a else None)
    nT, rT, pT = agg(gT); nN, rN, pN = agg(gN)
    fm = lambda x, f="%.2f": "n/a" if x is None else f % x
    ratio = (rN / rT) if (rT and rN) else None
    print("  %-33s %4d %8s %6s    %4d %8s %6s  %7s" % (
      k[:33], nT, fm(rT), fm(pT, "%.0f%%"), nN, fm(rN), fm(pN, "%.0f%%"), fm(ratio, "%.1fx")))
print()
print("  ratio = att/bot-h NOT-throttled / THROTTLED. ~5x is the predicted bite of an 80%")
print("  throttle (admission.mjs:650 plus the 1-in-5 valve at :675-689). Much less than 5x")
print("  means the valve dominates; much more means something else suppresses the key too.")
print()
print("=== DENOMINATOR BIAS: an `unknown` outcome goes to noteFailure, never to a win ===")
T = sum(stat.values())
for s, c in stat.most_common():
    print("    %-10s %8d  %5.2f%%" % (s, c, 100.0 * c / T))
