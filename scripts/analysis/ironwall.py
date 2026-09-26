# WHY DOES gather iron_ore FAIL 99.7% OF THE TIME? It is the binding constraint on the
# whole tech ladder: ~4 ore/day fleet-wide -> 4 ingots -> 0 iron pickaxes from 39 attempts.
import sys, os, collections
sys.path.insert(0, "/srv/mcb-analysis-lib")
from lib.telemetry import Events
MINS = int(os.environ.get("MINS", "1440"))
ev = Events.load(since_minutes=MINS)
spans = {}
fc = collections.Counter(); det = collections.Counter(); ok = 0; n = 0
ydist = collections.Counter(); okd = collections.Counter()
allg = collections.Counter()
for r in ev.rows:
    raw = r.get("raw") or {}; sk = raw.get("skill") or {}
    b = (raw.get("bot") or {}).get("name"); t = r.get("t")
    if b and t:
        lo, hi = spans.get(b, (t, t)); spans[b] = (min(lo, t), max(hi, t))
    if sk.get("name") != "gather": continue
    blk = (sk.get("args") or {}).get("block")
    allg[blk] += 1
    if blk not in ("iron_ore", "deepslate_iron_ore", "raw_iron"): continue
    n += 1
    st = sk.get("status")
    if st == "success":
        ok += 1
        continue
    fc[sk.get("fail_class") or st] += 1
    det[(sk.get("detail") or "")[:110]] += 1
    p = (raw.get("bot") or {}).get("pos") or {}
    y = p.get("y")
    if isinstance(y, (int, float)): ydist[int(y // 16) * 16] += 1
bh = sum((hi - lo).total_seconds() / 3600 for lo, hi in spans.values())
print("POSITIVE CONTROL: %.0f bot-h; gather attempts by block (top 8): %s"
      % (bh, allg.most_common(8)))
print()
print("iron-ore gather attempts %d (%.2f/bot-h), successes %d (%.2f%%)"
      % (n, n / bh, ok, 100.0 * ok / n if n else 0))
print()
print("  failure class            count   share")
for k, c in fc.most_common(10):
    print("    %-22s %6d  %5.1f%%" % (k, c, 100.0 * c / (n - ok) if n > ok else 0))
print()
print("  y-band of the bot when it failed (16-block bands; iron generates below y=64, best y=-24..56):")
for y in sorted(ydist):
    print("    y %4d..%4d  %6d  %5.1f%%" % (y, y + 15, ydist[y], 100.0 * ydist[y] / sum(ydist.values())))
print()
print("  most common failure detail:")
for k, c in det.most_common(6):
    print("    %6d  %s" % (c, k))
