"""Wall-clock ownership, with overlap subtracted.

The first pass summed reflex intervals and skill durations separately, which
double-counts any second where the reflex seized a bot mid-skill -- and that is
exactly the contended case, so the overlap is not small. This builds real
intervals per bot and takes their UNION.

Also reported, because the reconstruction can be wrong in ways that bias rather
than blur (per review):
  * orphan reflex starts and ends
  * time attributed to capped (unpaired) intervals
  * the reflex/skill overlap itself, which is the contention number
"""
import json, glob, datetime, collections, os, re, statistics

SEIZE = {"reflex_drowning","oxygen_critical_state","water_surface_hold","drowning_reentry"}
RELEASE = {"drowning_escaped","drowning_released_timeout","drowning_surfaced_stranded",
           "drowning_yielded_to_swim","water_surface_hold_ended"}
SKILLS = {"gather","mine","craft","goto","explore","swim_to","surface","deposit",
          "withdraw","place","build","home","eat","status","board"}
STATED = re.compile(r"released after (\d+)s")
CAP = 300.0

now = datetime.datetime.now(datetime.timezone.utc)
cut = now - datetime.timedelta(hours=3)
per = collections.defaultdict(list)
for f in glob.glob("/var/log/mcai/*/skill-*.jsonl"):
    bot = os.path.basename(os.path.dirname(f))
    try: fh = open(f, errors="replace")
    except OSError: continue
    with fh:
        fh.seek(max(0, fh.seek(0,2) - 20_000_000)); fh.readline()
        for line in fh:
            try:
                d = json.loads(line)
                t = datetime.datetime.fromisoformat(d["@timestamp"].replace("Z","+00:00"))
            except Exception: continue
            if t < cut: continue
            sk = d.get("skill") or {}
            per[bot].append((t.timestamp(), (sk.get("name") or "").lstrip("_"),
                             sk.get("duration_ms"), str(sk.get("detail") or "")))

def union(iv):
    if not iv: return 0.0, []
    iv = sorted(iv)
    out = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= out[-1][1]: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return sum(b - a for a, b in out), out

def overlap(A, B):
    tot = 0.0; i = j = 0
    while i < len(A) and j < len(B):
        lo = max(A[i][0], B[j][0]); hi = min(A[i][1], B[j][1])
        if hi > lo: tot += hi - lo
        if A[i][1] < B[j][1]: i += 1
        else: j += 1
    return tot

span = rx = sk_t = ov = capped = 0.0
orphan_end = orphan_start = 0
checks = []
for bot, evs in per.items():
    evs.sort(key=lambda r: r[0])
    if len(evs) < 2: continue
    span += evs[-1][0] - evs[0][0]
    riv, siv = [], []
    open_at = None
    for t, name, dur, det in evs:
        if name in SEIZE:
            if open_at is None: open_at = t
        elif name in RELEASE:
            if open_at is None: orphan_end += 1; continue
            secs = t - open_at
            if secs > CAP: capped += CAP; riv.append((open_at, open_at + CAP))
            elif secs >= 0:
                riv.append((open_at, t))
                m = STATED.search(det)
                if m: checks.append((secs, float(m.group(1))))
            open_at = None
        if name in SKILLS and isinstance(dur,(int,float)) and dur > 0:
            siv.append((t - dur/1000.0, t))       # completion records
    if open_at is not None: orphan_start += 1
    r, rm = union(riv); s, sm = union(siv)
    rx += r; sk_t += s; ov += overlap(rm, sm)

err = [abs(a-b) for a,b in checks]
print("  CONTROL: reconstructed vs the bot's own stated duration")
print("    n=%d  median error %.1fs  within 2s %.0f%%"
      % (len(err), statistics.median(err), 100*sum(1 for e in err if e<=2)/len(err)))
print("    orphan starts %d, orphan ends %d, capped time %.1f bot-hours"
      % (orphan_start, orphan_end, capped/3600))
u = rx + sk_t - ov
print("\n  %d bots, %.1f bot-hours observed\n" % (len(per), span/3600))
print("  %-26s %9s %8s" % ("", "BOT-HRS", "SHARE"))
for lbl, v in (("reflex-owned", rx), ("skill-active", sk_t),
               ("  ...of which OVERLAP", ov), ("busy (union)", u),
               ("NOT BUSY", span-u)):
    print("  %-26s %9.1f %7.1f%%" % (lbl, v/3600, 100*v/span))
print("\n  water = 51%% of EVENTS, %.1f%% of TIME" % (100*rx/span))
print("  contention (reflex seizing mid-skill) = %.1f%% of skill time" % (100*ov/max(sk_t,1)))
