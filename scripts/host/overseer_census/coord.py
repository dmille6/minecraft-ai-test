"""Overseer-assigner design (10-19): coordination-failure census over the last N hours (ES, read only).
Every count prints its denominator; every zero is either guarded by EsEvents or printed with a positive control."""
import sys, json, re, bisect, collections, datetime as dt
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents

HOURS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
ev = EsEvents.load("skill", since_minutes=HOURS * 60)
F = ["@timestamp", "skill", "exp.pool", "bot.name"]


def ts(r):
    return dt.datetime.fromisoformat(r["@timestamp"].replace("Z", "+00:00")).timestamp()


def world(pool):
    # shared pools: board-a etc.; isolated pools are per bot: self-isolated-a-Alpha -> isolated-a
    p = pool or "?"
    if p.startswith("self-"):
        p = p[5:]
    m = re.match(r"^(board|hive|placebo|isolated)-[a-d]", p)
    return m.group(0) if m else p


def shared(pool):
    return not (pool or "").startswith("self-")


print(f"WINDOW {HOURS} h; total skill docs {ev.total():,}; bots {len(ev.bots_present())}; span {ev.span_hours():.2f} h")
print("caveats:", ev.caveats)
BH = len(ev.bots_present()) * ev.span_hours()
print(f"bot-hours (bots x span) ~ {BH:,.0f}")

# ---- A. body time by skill (top) -- the denominator for every job below
print("\n== A. body time by skill (duration_ms summed; rows with a duration) ==")
kinds = ["gather", "explore", "goto", "mine", "craft", "smelt", "smelt_town", "furnace_drain", "count_town",
         "town_deposit", "deposit", "withdraw_pick", "withdraw", "toolkit", "dispose_well", "compost", "wear_out",
         "home", "surface", "place", "build_plinth", "build_well", "bamboo_sticks", "board", "eat", "bucket", "status"]
rows_by = {}
tot_h = 0.0
table = []
for k in kinds:
    try:
        rs = list(ev.rows(k, fields=F, max_rows=100000))
    except Exception as e:  # ZeroLooksWrong for a kind with no rows
        print(f"  {k}: {type(e).__name__}: {str(e)[:120]}")
        continue
    rows_by[k] = rs
    st = collections.Counter((r.get("skill") or {}).get("status") for r in rs)
    h = sum(((r.get("skill") or {}).get("duration_ms") or 0) for r in rs) / 3.6e6
    hne = sum(((r.get("skill") or {}).get("duration_ms") or 0) for r in rs
              if (r.get("skill") or {}).get("status") in ("no_effect", "failed")) / 3.6e6
    tot_h += h
    table.append((h, k, len(rs), dict(st), hne))
for h, k, n, st, hne in sorted(table, reverse=True):
    print(f"  {k:15s} n={n:6d} body_h={h:7.1f} ({100*h/BH:5.2f}% of bot-h)  no_effect+failed_h={hne:6.1f}  {st}")
print(f"  SUM over listed skills {tot_h:,.0f} bot-h of {BH:,.0f}")

TOWN = ["smelt_town", "furnace_drain", "count_town", "town_deposit", "withdraw_pick", "toolkit", "dispose_well",
        "compost", "wear_out", "build_plinth", "build_well", "bamboo_sticks"]
th = sum(((r.get("skill") or {}).get("duration_ms") or 0) for k in TOWN for r in rows_by.get(k, [])) / 3.6e6
print(f"  TOWN JOBS body time {th:.1f} bot-h = {100*th/BH:.2f}% of bot-h")

# ---- B. redundant discovery (same finding by another bot of the same SHARED town shortly before)
print("\n== B. redundant discovery: a no-effect town job whose finding another bot of the same shared town made shortly before ==")


def redundant(rs, keyf, window_s, label):
    groups = collections.defaultdict(list)
    for r in rs:
        k = keyf(r)
        if k is None:
            continue
        groups[k].append((ts(r), r["bot"]["name"], ((r.get("skill") or {}).get("duration_ms") or 0)))
    n = red = 0
    red_ms = 0
    for k, lst in groups.items():
        lst.sort()
        for i, (t, b, ms) in enumerate(lst):
            n += 1
            j = i - 1
            while j >= 0 and t - lst[j][0] <= window_s:
                if lst[j][1] != b:
                    red += 1
                    red_ms += ms
                    break
                j -= 1
    print(f"  {label}: {red} of {n} ({100*red/max(n,1):.1f}%) were preceded by ANOTHER bot's identical finding within "
          f"{window_s//60} min; their body time {red_ms/3.6e6:.2f} bot-h")
    return n, red


st_rows = rows_by.get("smelt_town", [])
none_copper = [r for r in st_rows if shared(r["exp"]["pool"]) and (r["skill"].get("detail") or "").startswith("no raw copper")]
print(f"  smelt_town rows (shared towns) {sum(1 for r in st_rows if shared(r['exp']['pool']))}; 'no raw copper' {len(none_copper)}")
redundant(none_copper, lambda r: r["exp"]["pool"], 7200, "smelt_town 'no raw copper' (2 h = the per-bot memory)")
fd = rows_by.get("furnace_drain", [])
empty = [r for r in fd if shared(r["exp"]["pool"]) and re.search(r"the furnace at (\S+) is empty", r["skill"].get("detail") or "")]
print(f"  furnace_drain rows (shared) {sum(1 for r in fd if shared(r['exp']['pool']))}; 'is empty' {len(empty)}")
redundant(empty, lambda r: (r["exp"]["pool"], re.search(r"the furnace at (\S+) is empty", r["skill"]["detail"]).group(1)), 3600,
          "furnace_drain of the SAME empty furnace (60 min)")
ct = rows_by.get("count_town", [])
lid = [r for r in ct if shared(r["exp"]["pool"]) and "lid_blocked" in (r["skill"].get("detail") or "")]
print(f"  count_town rows (shared) {sum(1 for r in ct if shared(r['exp']['pool']))}; with lid_blocked {len(lid)}; "
      f"counted>0 {sum(1 for r in ct if re.search(r'counted=[1-9]', r['skill'].get('detail') or ''))}")
redundant(lid, lambda r: r["exp"]["pool"], 3600, "count_town lid_blocked in the same town (60 min)")

# ---- C. smelt job: skip reasons; is the job supply-limited or labour-limited?
print("\n== C. smelt_town: supply or labour? ==")
sk = list(ev.rows("_smelt_job_skip", fields=F, max_rows=100000))
why = collections.Counter(re.search(r"why=(\S+)", r["skill"].get("detail") or "why=?").group(1) for r in sk)
print(f"  _smelt_job_skip {len(sk)} by why: {dict(why.most_common())}")
ok = [r for r in st_rows if r["skill"].get("status") == "success"]
cu = sum(-((r["skill"].get("inventory_delta") or {}).get("raw_copper", 0)) for r in ok)
ing = sum(((r["skill"].get("inventory_delta") or {}).get("copper_ingot", 0)) for r in ok)
print(f"  smelt_town success {len(ok)} of {len(st_rows)}; detail classes:")
cls = collections.Counter(re.sub(r"[0-9.,]+", "#", (r["skill"].get("detail") or ""))[:70] for r in st_rows)
for c, n in cls.most_common(10):
    print(f"     {n:5d}  {c}")
by_hour = collections.Counter(r["@timestamp"][:13] for r in ok)
print("  successes by hour:", " ".join(f"{h[11:13]}:{n}" for h, n in sorted(by_hour.items())))
per_world_ok = collections.Counter(world(r["exp"]["pool"]) for r in ok)
per_world_none = collections.Counter(world(r["exp"]["pool"]) for r in st_rows if (r["skill"].get("detail") or "").startswith("no raw copper"))
print("  per world success / no-copper:", {w: (per_world_ok[w], per_world_none[w]) for w in sorted(set(per_world_ok) | set(per_world_none))})

# ---- D. labour concentration: do roles already emerge?
print("\n== D. who does the town jobs (share of successes by the top bot of each shared town) ==")
for k in ["smelt_town", "furnace_drain", "town_deposit", "withdraw_pick", "toolkit", "dispose_well", "compost"]:
    rs = [r for r in rows_by.get(k, []) if r["skill"].get("status") == "success" and shared(r["exp"]["pool"])]
    by = collections.defaultdict(collections.Counter)
    for r in rs:
        by[r["exp"]["pool"]][r["bot"]["name"]] += 1
    tops = [max(c.values()) / sum(c.values()) for c in by.values() if sum(c.values()) >= 5]
    nb = [len(c) for c in by.values() if sum(c.values()) >= 5]
    if tops:
        tops.sort()
        print(f"  {k:14s} successes {len(rs):5d} in {len(by)} towns; towns with >=5: {len(tops)}; top-bot share median "
              f"{tops[len(tops)//2]:.2f} (min {tops[0]:.2f} max {tops[-1]:.2f}); distinct bots median {sorted(nb)[len(nb)//2]}")
    else:
        print(f"  {k:14s} successes {len(rs)} (no town with >= 5)")

# ---- E. stock refused: carrying what the town will not take
print("\n== E. _stock_refused: items the town refused (bank side) ==")
sr = list(ev.rows("_stock_refused", fields=F, max_rows=100000))
reason = collections.Counter()
items = collections.Counter()
for r in sr:
    for it, n, why_ in re.findall(r"(\w+):(\d+):(\w+)", r["skill"].get("detail") or ""):
        reason[why_] += 1
        items[(it, why_)] += int(n)
print(f"  rows {len(sr)}; item-entries by reason {dict(reason.most_common())}")
print("  top items (count carried at refusal, by reason):", items.most_common(12))
print(f"  rows from shared towns {sum(1 for r in sr if shared(r['exp']['pool']))}, isolated {sum(1 for r in sr if not shared(r['exp']['pool']))}")

# ---- F. toolkit no_iron / withdraw_pick misses while a TOWNMATE carries the thing
print("\n== F. sharing: a bot is refused for want of X while a townmate (same shared town) carries X ==")
snap_kinds = ["_work_order", "gather", "goto", "explore", "mine"]
snaps = collections.defaultdict(list)   # pool -> [(t, bot, inv)]
for k in snap_kinds:
    for r in ev.rows(k, fields=["@timestamp", "exp.pool", "bot.name", "bot.inventory"], max_rows=200000):
        p = (r.get("exp") or {}).get("pool")
        if not shared(p):
            continue
        snaps[p].append((ts(r), r["bot"]["name"], (r.get("bot") or {}).get("inventory") or {}))
for p in snaps:
    snaps[p].sort(key=lambda x: x[0])
print(f"  inventory snapshots (5 kinds, shared towns): {sum(len(v) for v in snaps.values()):,} rows in {len(snaps)} towns")


def mates_holding(pool, bot, t, pred, look=900):
    lst = snaps.get(pool, [])
    i = bisect.bisect_left(lst, (t - look,))
    last = {}
    for tt, b, inv in lst[i:]:
        if tt > t:
            break
        if b != bot:
            last[b] = inv
    return [b for b, inv in last.items() if pred(inv)], len(last)


tk = list(ev.rows("_toolkit", fields=["@timestamp", "skill", "exp.pool", "bot.name"], max_rows=100000))
noiron = [r for r in tk if "outcome=no_iron" in (r["skill"].get("detail") or "") and shared(r["exp"]["pool"])]
hit = seen = 0
for r in noiron:
    hold, n = mates_holding(r["exp"]["pool"], r["bot"]["name"], ts(r), lambda inv: inv.get("iron_ingot", 0) >= 1)
    seen += 1 if n else 0
    hit += 1 if hold else 0
print(f"  toolkit outcome=no_iron (shared towns) {len(noiron)}; with >=1 townmate seen in the prior 15 min {seen}; "
      f"of those, a townmate carried >=1 iron_ingot: {hit}")
def _oc(r):
    m = re.search(r"outcome=(\w+)", r["skill"].get("detail") or "")
    return m.group(1) if m else ("phase=mode" if "phase=mode" in (r["skill"].get("detail") or "") else "?")
pc = collections.Counter(_oc(r) for r in tk)
print(f"  _toolkit outcomes (positive control for the parse): {dict(pc)}")
for thr in (3, 4):
    h2 = 0
    for r in noiron:
        hold, n = mates_holding(r["exp"]["pool"], r["bot"]["name"], ts(r), lambda inv, t=thr: inv.get("iron_ingot", 0) >= t)
        h2 += 1 if hold else 0
    print(f"    ... a townmate carried >= {thr} iron_ingot: {h2} of {len(noiron)}")
# CONTROL for the townmate test: the same test on random moments -- how often does ANY townmate carry >=3 ingots?
import random
random.seed(7)
allsn = [(p, t, b) for p, lst in snaps.items() for (t, b, _) in lst]
samp = random.sample(allsn, 2000)
c3 = sum(1 for p, t, b in samp if mates_holding(p, b, t, lambda inv: inv.get("iron_ingot", 0) >= 3)[0])
print(f"  CONTROL: at 2,000 random snapshot moments a townmate carried >= 3 iron_ingot {c3} times ({c3/20:.1f}%)")
coal = [r for r in st_rows if (r["skill"].get("detail") or "").startswith("no coal") and shared(r["exp"]["pool"])]
hc = hc8 = own = 0
for r in coal:
    hold, n = mates_holding(r["exp"]["pool"], r["bot"]["name"], ts(r), lambda inv: inv.get("coal", 0) + inv.get("charcoal", 0) >= 1)
    hold8, _ = mates_holding(r["exp"]["pool"], r["bot"]["name"], ts(r), lambda inv: inv.get("coal", 0) + inv.get("charcoal", 0) >= 8)
    hc += 1 if hold else 0
    hc8 += 1 if hold8 else 0
print(f"  smelt_town 'no coal in the town containers' (shared) {len(coal)}; a townmate carried >=1 coal {hc}, >=8 coal {hc8}")
c8 = sum(1 for p, t, b in samp if mates_holding(p, b, t, lambda inv: inv.get("coal", 0) >= 8)[0])
print(f"  CONTROL: at the same 2,000 random moments a townmate carried >= 8 coal {c8} times ({c8/20:.1f}%)")
cw = collections.Counter(world(r["exp"]["pool"]) for r in coal)
print("  'no coal' by world:", dict(cw))
# own bag at the 'no coal' moment (the job refuses to burn the bag's own fuel)
own_coal = [((r["skill"].get("inventory_delta") or {})) for r in coal]
print("  sample no-coal details:", [ (r["skill"].get("detail") or "")[:160] for r in coal[:2]])
wp = rows_by.get("withdraw_pick", [])
wcls = collections.Counter(re.sub(r"[0-9.,-]+", "#", (r["skill"].get("detail") or ""))[:80] for r in wp if r["skill"].get("status") != "success")
print(f"  withdraw_pick {len(wp)}: success {sum(1 for r in wp if r['skill'].get('status')=='success')}; non-success classes:")
for c, n in wcls.most_common(6):
    print(f"     {n:4d} {c}")
ingred = collections.Counter()
for r in ev.rows("_work_order", fields=["@timestamp", "skill", "exp.pool", "bot.name"], max_rows=100000):
    d = r["skill"].get("detail") or ""
    ingred[d.split(" ", 1)[0]] += 1
print("  _work_order by order (what the deterministic layer already assigns):", ingred.most_common(25))
