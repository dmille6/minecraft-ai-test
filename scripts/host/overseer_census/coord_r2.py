"""r2 of the C1-C4/C7 census (Codex r1 findings 2-3). Read only, ES, 24 h.

C1-C3: a repeated finding counts as REDUNDANT only when (a) another bot of the same SHARED town made the identical
finding inside the window, (b) keyed as narrowly as the row allows (furnace coordinate; for copper and lids the town,
since the rows do not name the container), and (c) no state change that could invalidate it happened in between: any
town_deposit / deposit / smelt_town success / dispose_well in the same town resets the copper and lid keys; any
non-drain _furnace_session on that furnace (smelt / job; a drain's own session changes nothing) resets the furnace key. The result is labelled CANDIDATE savings.
C4/C7: identical predicates at the event and in the control; the control is matched by TOWN (random moments drawn from
the same town's own snapshot rows, as many per town as that town has events), with a bootstrap 95% interval."""
import sys, re, bisect, random, collections, datetime as dt
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents

ev = EsEvents.load("skill", since_minutes=24 * 60)
F = ["@timestamp", "skill", "exp.pool", "bot.name"]


def ts(r):
    return dt.datetime.fromisoformat(r["@timestamp"].replace("Z", "+00:00")).timestamp()


def shared(p):
    return not (p or "").startswith("self-")


rows = {k: [r for r in ev.rows(k, fields=F, max_rows=100000) if shared(r["exp"]["pool"])]
        for k in ["smelt_town", "furnace_drain", "count_town", "town_deposit", "deposit", "dispose_well", "_furnace_session"]}
resets = collections.defaultdict(list)          # town -> times of a state change that may refill or open a container
for k in ["town_deposit", "deposit", "dispose_well"]:
    for r in rows[k]:
        if r["skill"].get("status") == "success":
            resets[r["exp"]["pool"]].append(ts(r))
for r in rows["smelt_town"]:
    if r["skill"].get("status") == "success":
        resets[r["exp"]["pool"]].append(ts(r))
fres = collections.defaultdict(list)
for r in rows["_furnace_session"]:
    d = r["skill"].get("detail") or ""
    m = re.search(r"furnace=(\S+)", d)
    if m and "by=drain" not in d:      # a drain's own session of an empty furnace changes nothing
        fres[(r["exp"]["pool"], m.group(1))].append(ts(r))
for d in (resets, fres):
    for k in d:
        d[k].sort()


def changed_between(lst, a, b):
    i = bisect.bisect_right(lst, a)
    return i < len(lst) and lst[i] < b


def redundant(events, keyf, resetf, window_s, label):
    g = collections.defaultdict(list)
    for r in events:
        g[keyf(r)].append((ts(r), r["bot"]["name"], r["skill"].get("duration_ms") or 0, r))
    n = red = 0
    ms = 0
    for k, lst in g.items():
        lst.sort(key=lambda x: x[0])
        for i, (t, b, d, r) in enumerate(lst):
            n += 1
            j = i - 1
            while j >= 0 and t - lst[j][0] <= window_s:
                if lst[j][1] != b and not changed_between(resetf(k), lst[j][0], t):
                    red += 1
                    ms += d
                    break
                j -= 1
    print(f"  {label}: CANDIDATE redundant {red} of {n} ({100*red/max(n,1):.1f}%), body {ms/3.6e6:.2f} bot-h")


print("== C1-C3 r2 (shared towns only; state-change invalidation) ==")
cu = [r for r in rows["smelt_town"] if (r["skill"].get("detail") or "").startswith("no raw copper")]
redundant(cu, lambda r: r["exp"]["pool"], lambda k: resets[k], 7200, "C1 no raw copper (town key, 2 h)")
emp = [r for r in rows["furnace_drain"] if re.search(r"the furnace at (\S+) is empty", r["skill"].get("detail") or "")]
redundant(emp, lambda r: (r["exp"]["pool"], re.search(r"the furnace at (\S+) is empty", r["skill"]["detail"]).group(1)),
          lambda k: fres[k], 3600, "C2 same empty furnace (furnace key, 60 min)")
lid = [r for r in rows["count_town"] if "lid_blocked" in (r["skill"].get("detail") or "")]
redundant(lid, lambda r: r["exp"]["pool"], lambda k: resets[k], 3600, "C3 lid_blocked count (town key, 60 min)")
ct = rows["count_town"]
print(f"  count_town shared {len(ct)}: lid_blocked {len(lid)}, counted>0 {sum(1 for r in ct if re.search(r'counted=[1-9]', r['skill'].get('detail') or ''))}")

print("== C4/C7 r2: identical predicates, town-matched controls, bootstrap 95% ==")
snaps = collections.defaultdict(list)
for k in ["_work_order", "gather", "goto", "explore", "mine"]:
    for r in ev.rows(k, fields=["@timestamp", "exp.pool", "bot.name", "bot.inventory"], max_rows=200000):
        p = (r.get("exp") or {}).get("pool")
        if shared(p):
            snaps[p].append((ts(r), r["bot"]["name"], (r.get("bot") or {}).get("inventory") or {}))
for p in snaps:
    snaps[p].sort(key=lambda x: x[0])


def mate(pool, bot, t, pred, look=900):
    lst = snaps.get(pool, [])
    i = bisect.bisect_left(lst, (t - look,))
    last = {}
    for tt, b, inv in lst[i:]:
        if tt > t:
            break
        if b != bot:
            last[b] = inv
    return any(pred(v) for v in last.values()), bool(last)


def boot(x, B=2000):
    random.seed(11)
    n = len(x)
    if n == 0:
        return (float("nan"),) * 2
    ms = sorted(sum(random.choice(x) for _ in range(n)) / n for _ in range(B))
    return ms[int(.025 * B)], ms[int(.975 * B)]


def compare(events, pred, label, reps=5):
    ev_hits, ctl_hits = [], []
    random.seed(5)
    for r in events:
        p, b, t = r["exp"]["pool"], r["bot"]["name"], ts(r)
        h, seen = mate(p, b, t, pred)
        if not seen:
            continue
        ev_hits.append(1 if h else 0)
        lst = snaps[p]
        for _ in range(reps):          # town-matched, EVENT-WEIGHTED moments; mates exclude the SAMPLED bot (Codex r2 P2)
            tt, bb, _inv = random.choice(lst)
            h2, s2 = mate(p, bb, tt, pred)
            if s2:
                ctl_hits.append(1 if h2 else 0)
    e, c = sum(ev_hits) / max(1, len(ev_hits)), sum(ctl_hits) / max(1, len(ctl_hits))
    print(f"  {label}: at events {sum(ev_hits)}/{len(ev_hits)} = {100*e:.1f}% {tuple(round(100*v,1) for v in boot(ev_hits))}; "
          f"town-matched control {sum(ctl_hits)}/{len(ctl_hits)} = {100*c:.1f}% {tuple(round(100*v,1) for v in boot(ctl_hits))}")


tk = [r for r in ev.rows("_toolkit", fields=F, max_rows=100000) if shared(r["exp"]["pool"])]
noiron = [r for r in tk if "outcome=no_iron" in (r["skill"].get("detail") or "")]
for thr in (1, 3):
    compare(noiron, lambda inv, t=thr: inv.get("iron_ingot", 0) >= t, f"C7 toolkit no_iron (n={len(noiron)}), townmate iron_ingot >= {thr}")
coal = [r for r in rows["smelt_town"] if (r["skill"].get("detail") or "").startswith("no coal")]
fuel = lambda inv, t: inv.get("coal", 0) + inv.get("charcoal", 0) >= t
for thr in (1, 8):
    compare(coal, lambda inv, t=thr: fuel(inv, t), f"C4 smelt no coal (n={len(coal)}), townmate coal+charcoal >= {thr}")
