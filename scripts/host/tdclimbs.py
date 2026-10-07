import sys, datetime as dt
sys.path.insert(0, "/home/mike/mcai-analysis"); sys.path.insert(0, "/tmp")
from lib.telemetry import Events
import glob as _glob
def load_window(since, until):
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    out, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen: out.append(r); seen.add(key(r))
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            for r in Events.load(paths=g, since=since, until=until).rows:
                if key(r) not in seen: out.append(r); seen.add(key(r))
    return out
from collections import Counter, defaultdict
Z = dt.timezone.utc
def T(s): return dt.datetime.fromisoformat(s).replace(tzinfo=Z)
CAN = {"board-b", "placebo-a"}
def scan(a, b, label):
    rows = sorted(load_window(T(a), T(b)), key=lambda r: r["t"])
    cl = Counter(); bots = defaultdict(set); per = Counter(); td = defaultdict(list)
    for r in rows:
        p = (r.get("raw") or {}).get("exp",{}).get("pool"); bn = (r.get("bot") or {}).get("name"); k = r.get("name")
        if not p: continue
        arm = "canary" if p in CAN else "control"
        bots[arm].add(bn)
        if k in ("_entombed", "_marooned"):
            cl[arm] += 1
            if arm == "canary": per[bn] += 1
        if k == "_town_deposit": td[bn].append(r["t"])
    h = (T(b) - T(a)).total_seconds() / 3600
    print(label, "rows", len(rows), "| climbs/bot-h canary %.2f (%d, %d bots) control %.2f (%d, %d bots)" % (
        cl["canary"] / max(1, len(bots["canary"])) / h, cl["canary"], len(bots["canary"]),
        cl["control"] / max(1, len(bots["control"])) / h, cl["control"], len(bots["control"])))
    return rows, per, td
scan("2026-10-06T20:00:00", "2026-10-07T05:00:00", "CLEAN PRE 10-06 20:00-05:00")
rows, per, td = scan("2026-10-07T13:06:18", "2026-10-07T16:06:18", "POST 13:06-16:06")
print("canary per bot:", per.most_common())
near = tot = 0
for r in rows:
    k = r.get("name"); bn = (r.get("bot") or {}).get("name"); p = (r.get("raw") or {}).get("exp",{}).get("pool")
    if p in CAN and k in ("_entombed", "_marooned"):
        tot += 1
        if any(abs((r["t"] - t).total_seconds()) <= 600 for t in td.get(bn, [])): near += 1
print("canary climbs within 10 min of the same bot's _town_deposit row:", near, "of", tot, "| deposit rows by bot:", {b: len(v) for b, v in td.items()})
