#!/usr/bin/env python3
"""canary-report.py -- did the change on one pool help, or did it just get loud?

    scripts/canary-report.py --pool hive-a --minutes 20

WHY EPISODES AND NOT EVENTS
---------------------------------------------------------------------------
On 2026-08-24 I judged two water changes by comparing EVENT RATES against a
baseline taken hours earlier, saw `drowning_reentry` at 4.9x, and reverted. The
review's objection was exact: a truthful sensor generates more transitions per
incident by construction, so a 4.9x rise in transition events can be the same
number of real incidents, logged in more detail. 34,190 drowning events could be
34,190 tiny observations or 500 long traps, and an event count cannot tell you
which.

So this counts EPISODES -- contiguous runs of water trouble for one bot,
separated by a quiet gap -- and reports what each one COST: how long the bot was
held, whether it ended on land, and what it gathered afterwards. Those are
outcomes. Event counts are printed too, in their place, as volume rather than
harm.

WHY A CONCURRENT CONTROL
---------------------------------------------------------------------------
Every comparison I made that day was against a baseline measured at a different
time, on a differently-settled fleet, after a different number of restarts. The
canary pool and the control bots run the same minutes in identical worlds, so
time-of-day, server load and restart churn cancel. That is the entire point of
the split, and it is worth more than any single metric below.

THE GATES are pre-declared here rather than argued about afterwards.
"""
import argparse, json, glob, datetime, collections, os, sys

# Contiguous water trouble for one bot, split on a gap this long.
EPISODE_GAP_S = 30
WATER = {"oxygen_critical_state", "drowning_up", "drowning_to_shore", "drowning_no_shore",
         "drowning_reentry", "drowning_surfaced_stranded", "drowning_released_timeout",
         "drowning_escaped", "water_surface_hold", "reflex_drowning"}
ESCAPED = "drowning_escaped"

# Pre-declared acceptance gates. A change that does not clear these is not an
# improvement, whatever its event counts do.
GATES = [
    ("land-release rate",     "escape_rate",  0.60, "at least", "of episodes end on land (baseline 0.21)"),
    ("median re-entry gap",   "reentry_s",    60.0, "at least", "seconds before drowning again (baseline 6)"),
    ("reflex-owned time",     "held_frac",    0.10, "at most",  "of exposure spent in water trouble"),
    ("gather rate retained",  "gather_ratio", 0.90, "at least", "of the control's gathers per exposure-hour"),
    ("deaths",                "death_ratio",  1.25, "at most",  "times the control's death rate"),
]


def load(paths, since, pool):
    rows = collections.defaultdict(list)
    for f in glob.glob(paths):
        bot = os.path.basename(os.path.dirname(f))
        try: fh = open(f, errors="replace")
        except OSError: continue
        with fh:
            fh.seek(max(0, fh.seek(0, 2) - 30_000_000)); fh.readline()
            for line in fh:
                try:
                    d = json.loads(line)
                    t = datetime.datetime.fromisoformat(d["@timestamp"].replace("Z", "+00:00"))
                except Exception:
                    continue
                if t < since: continue
                rows[bot].append((t, d))
    for v in rows.values(): v.sort(key=lambda r: r[0])
    return rows


def summarise(rows, bots):
    """Episode-level outcomes for one group of bots."""
    eps, gathers, deaths, events, water_events = [], 0, 0, 0, 0
    exposure = 0.0
    reentry_gaps = []
    for bot in bots:
        cur, last_end = None, None
        buckets = collections.defaultdict(list)
        for t, d in rows[bot]:
            events += 1
            sk = d.get("skill") or {}
            k = (sk.get("name") or "").lstrip("_")
            if k == "gather" and sk.get("status") == "success": gathers += 1
            if k == "death": deaths += 1
            p = (d.get("bot") or {}).get("pos")
            if p: buckets[int(t.timestamp() // 300)].append((p["x"], p["y"], p["z"]))
            if k not in WATER:
                continue
            water_events += 1
            if cur and (t - cur["end"]).total_seconds() > EPISODE_GAP_S:
                eps.append(cur)
                if last_end: reentry_gaps.append((cur["start"] - last_end).total_seconds())
                last_end = cur["end"]
                cur = None
            if cur is None:
                cur = {"bot": bot, "start": t, "end": t, "escaped": False, "n": 0}
            cur["end"] = t; cur["n"] += 1
            if k == ESCAPED: cur["escaped"] = True
        if cur:
            eps.append(cur)
            if last_end: reentry_gaps.append((cur["start"] - last_end).total_seconds())
        for _, ps in buckets.items():
            if len(ps) < 2: continue
            xs = [q[0] for q in ps]; ys = [q[1] for q in ps]; zs = [q[2] for q in ps]
            if max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) >= 8:
                exposure += 5 / 60
    held = sum((e["end"] - e["start"]).total_seconds() for e in eps) / 3600
    reentry_gaps.sort()
    return {
        "bots": len(bots), "episodes": len(eps), "exposure": exposure,
        "escape_rate": (sum(1 for e in eps if e["escaped"]) / len(eps)) if eps else None,
        "median_episode_s": ((sorted((e["end"] - e["start"]).total_seconds() for e in eps))
                             [len(eps) // 2] if eps else None),
        "reentry_s": (reentry_gaps[len(reentry_gaps) // 2] if reentry_gaps else None),
        "held_frac": (held / exposure) if exposure > 0 else None,
        "gathers": gathers, "deaths": deaths, "events": events, "water_events": water_events,
        "gather_per_exp": (gathers / exposure) if exposure > 0 else None,
        "death_per_exp": (deaths / exposure) if exposure > 0 else None,
    }


def fmt(v, nd=2):
    return "n/a" if v is None else f"{v:.{nd}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", required=True)
    ap.add_argument("--minutes", type=int, default=20)
    ap.add_argument("--paths", default="/var/log/mcai/*/skill-*.jsonl")
    a = ap.parse_args()

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=a.minutes)
    rows = load(a.paths, since, a.pool)
    canary = sorted(b for b in rows if b.startswith(a.pool + "-"))
    control = sorted(b for b in rows if not b.startswith(a.pool + "-"))
    if not canary:
        sys.exit(f"no bots matched pool '{a.pool}' -- nothing to report")
    if not control:
        sys.exit("no control bots -- a canary with no control is just a deploy")

    c, k = summarise(rows, canary), summarise(rows, control)
    print(f"\n  window {a.minutes}m · canary pool {a.pool} ({c['bots']} bots) "
          f"vs control ({k['bots']} bots)")
    print(f"  DENOMINATORS  canary {c['exposure']:.1f} exposure-h / {c['events']} events   "
          f"control {k['exposure']:.1f} / {k['events']}")
    if c["exposure"] < 0.5 or k["exposure"] < 0.5:
        print("\n  INSUFFICIENT EXPOSURE -- nothing below is worth reading yet.\n")
        return 2

    print(f"\n  {'':<26}{'CANARY':>10}{'CONTROL':>10}")
    for label, key, nd in [("episodes", "episodes", 0), ("median episode (s)", "median_episode_s", 0),
                           ("ended on land", "escape_rate", 2), ("median re-entry gap (s)", "reentry_s", 0),
                           ("reflex-owned / exposure", "held_frac", 3),
                           ("gathers / exposure-h", "gather_per_exp", 1),
                           ("deaths / exposure-h", "death_per_exp", 3),
                           ("water events (VOLUME)", "water_events", 0)]:
        print(f"  {label:<26}{fmt(c[key], nd):>10}{fmt(k[key], nd):>10}")

    vals = dict(c)
    vals["gather_ratio"] = (c["gather_per_exp"] / k["gather_per_exp"]
                            if k["gather_per_exp"] else None)
    vals["death_ratio"] = (c["death_per_exp"] / k["death_per_exp"]
                           if k["death_per_exp"] else (0.0 if c["death_per_exp"] == 0 else None))
    print(f"\n  GATES (declared before the change, not after)")
    failed = 0
    for label, key, thr, sense, why in GATES:
        v = vals.get(key)
        if v is None:
            print(f"    ?  {label:<24} no data — {why}")
            continue
        good = v >= thr if sense == "at least" else v <= thr
        failed += 0 if good else 1
        print(f"    {'PASS' if good else 'FAIL'}  {label:<24}{v:>8.2f}  {sense} {thr}  — {why}")
    print(f"\n  {'ALL GATES PASS — roll out' if failed == 0 else f'{failed} GATE(S) FAILED — do not roll out'}\n")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
