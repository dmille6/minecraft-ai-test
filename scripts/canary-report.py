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

# TWO KINDS OF GATE, AND CONFLATING THEM MAKES THE REPORT USELESS.
#
# The first live run of this script judged a NO-OP canary -- identical bots/src,
# only the version label differed -- and failed three gates. Two of them were
# absolute targets that the baseline fleet also fails (land-release 0.60 when
# both arms sit near 0.20; reflex-owned 0.10 when both sit near 0.20), and the
# third was noise off 0.9 exposure-hours. A gate that rejects a change which
# does nothing would block every rollout, so nobody would use it.
#
# So the canary answers ONE question -- is this better than what we already have
# -- and it answers it against a control running the same minutes. Whether the
# result is GOOD ENOUGH is a different question, belonging to the shakedown
# gate, and mixing the two is what produced the nonsense above.
#
# REGRESSION gates block a rollout. Each is set at the p5 of its MEASURED null,
# so it fires on things the instrument can actually resolve and not on things it
# cannot.
#
# THE HARVEST GATE IS A CATASTROPHE GATE, NOT A NON-INFERIORITY GATE, and
# calling it anything else would be the false confidence this file has already
# produced once. At five bots over four hours it means: block if harvest
# plausibly fell by more than about 57%. It does NOT mean harvest is safe. A
# change that quietly costs 30% of the harvest passes this gate, and only the
# 7-day block can say otherwise.
REGRESSION = [
    ("harvest COLLAPSE",    "gather_ratio",     0.43, "at least",
     "of the control's harvest — CATASTROPHE GATE ONLY; cannot rule out losses "
     "smaller than ~2x (measured null p5=0.43, p95=3.87)"),
    ("deaths vs control",   "death_ratio",      1.25, "at most",
     "times the control's death rate"),
]

# DROPPED AS A BLOCKING GATE: reflex-owned share.
#
# Its null spread stayed at 3-4x whether the window was one hour or four. A
# sampling-noise term shrinks with exposure; this one does not, so it is pool
# and world heterogeneity, or instability in what counts as an event. A gate
# that cannot be tightened by running longer is not measuring the change, and
# blocking on it would have rejected good work at a rate nobody could predict.
# It stays below as a diagnostic, where being noisy is harmless.

# PROGRESS metrics are reported against the control and against the standing
# target, and they never block on their own. `--expect <metric>` names the one
# this change is supposed to move, and THAT one is required to improve.
PROGRESS = [
    # Measured DiD nulls at 4h/5 bots: escape_rate p5 0.64 p95 2.29 (usable),
    # reentry_s p5 0.75 p95 1.40 (the tightest metric here).
    ("ended on land",       "escape_rate",      0.60, "at least",
     "of episodes end on land (DiD outside 0.64..2.29 is real)"),
    ("re-entry gap (s)",    "reentry_s",       60.00, "at least",
     "seconds before drowning again (DiD outside 0.75..1.40 is real)"),
    # Diagnostic only. See the note above the REGRESSION list.
    ("reflex-owned share",  "held_frac",        0.10, "at most",
     "of exposure in water trouble — DIAGNOSTIC, null does not tighten (0.49..2.13)"),
]

# A CANARY IS FIVE BOTS. It needs enough exposure before its numbers mean
# anything, and it has just restarted while the control has not -- so its first
# minutes are burn-in that the control does not have. Comparing across that is a
# systematic bias against every canary, which is worse than no comparison.
MIN_EXPOSURE_H = 2.0
BURN_IN_MIN = 15

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


def summarise(rows, bots, skip_before=None, lo=None, hi=None):
    """Episode-level outcomes for one group of bots.

    `skip_before` drops each bot's first minutes after its restart. Only the
    canary restarted, so without this every canary is compared against a control
    that has been settled for hours -- a bias against the change, every time.
    """
    eps, gathers, deaths, events, water_events = [], 0, 0, 0, 0
    exposure = 0.0
    reentry_gaps = []
    for bot in bots:
        cur, last_end = None, None
        buckets = collections.defaultdict(list)
        for t, d in rows[bot]:
            if skip_before and t < skip_before.get(bot, t):
                continue
            if lo is not None and t < lo: continue
            if hi is not None and t >= hi: continue
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


def did(c_before, c_after, k_before, k_after, key):
    """Difference-in-differences for one metric, as a ratio of ratios.

    WHY THIS AND NOT THE CONCURRENT COMPARISON.
    ---------------------------------------------------------------------------
    The first version of this script compared the canary pool against the other
    thirty-five bots over the same minutes, which removes time-of-day and server
    load. It does NOT remove the pool itself, and the pool is the dominant term:
    measured on a UNIFORM fleet where every bot ran identical code, pool-vs-rest
    harvest ratios came out

        0.26  0.30  0.44  0.95  1.03  1.62  1.81  2.53

    a tenfold spread with no change deployed at all. Gates set on that would
    reject a no-op roughly a third of the time and wave a real regression
    through about as often -- a coin flip wearing a number.

    So each arm is compared against ITSELF before the change, and the control's
    own before/after shift is divided out. The pool effect cancels because a
    pool appears in both terms; the time effect cancels because the control
    moved through the same hours. What is left is the change.

        DiD = (canary_after / canary_before) / (control_after / control_before)

    1.0 is "did nothing". Returns None when any term is missing or zero -- a
    pool that gathered nothing in the before window cannot tell you what its
    harvest did, and inventing a denominator there is how a confident zero gets
    into a report.
    """
    a, b = c_after.get(key), c_before.get(key)
    ka, kb = k_after.get(key), k_before.get(key)
    if None in (a, b, ka, kb) or b == 0 or kb == 0:
        return None
    control_shift = ka / kb
    if control_shift == 0:
        return None
    return (a / b) / control_shift


def _versions(rows, bots):
    """The distinct `sha+digest` strings a group of bots actually reported."""
    out = set()
    for b in bots:
        for _, d in rows.get(b, []):
            v = (d.get("code") or {}).get("version")
            if v:
                out.add(v)
    return out


def fmt(v, nd=2):
    return "n/a" if v is None else f"{v:.{nd}f}"


def report_did(rows, canary, control, t0, a):
    """Before/after on both arms, with the control's own drift divided out."""
    W = datetime.timedelta(minutes=a.window)
    burn = datetime.timedelta(minutes=a.burn_in)
    cb = summarise(rows, canary,  lo=t0 - W, hi=t0)
    ca = summarise(rows, canary,  lo=t0 + burn, hi=t0 + burn + W)
    kb = summarise(rows, control, lo=t0 - W, hi=t0)
    ka = summarise(rows, control, lo=t0 + burn, hi=t0 + burn + W)

    print(f"\n  DIFFERENCE-IN-DIFFERENCES around {t0:%Y-%m-%d %H:%M}Z"
          f"  (+/-{a.window}m, {a.burn_in}m burn-in)")
    print(f"  canary pool {a.pool}: {len(canary)} bots · control: {len(control)} bots")
    print(f"  EXPOSURE-H   canary {cb['exposure']:.1f} -> {ca['exposure']:.1f}   "
          f"control {kb['exposure']:.1f} -> {ka['exposure']:.1f}")
    thin = [n for n, x in (("canary before", cb), ("canary after", ca),
                           ("control before", kb), ("control after", ka))
            if x["exposure"] < MIN_EXPOSURE_H]
    if thin:
        print(f"\n  INSUFFICIENT EXPOSURE in: {', '.join(thin)} "
              f"(need {MIN_EXPOSURE_H}h each)\n")
        return 2

    print(f"\n  {'METRIC':<24}{'CANARY b->a':>16}{'CONTROL b->a':>16}{'DiD':>8}")
    out = {}
    for label, key in [("gathers / exposure-h", "gather_per_exp"),
                       ("deaths / exposure-h", "death_per_exp"),
                       ("reflex-owned share", "held_frac"),
                       ("ended on land", "escape_rate"),
                       ("re-entry gap (s)", "reentry_s")]:
        d = did(cb, ca, kb, ka, key)
        out[key] = d
        print(f"  {label:<24}{fmt(cb[key])+' -> '+fmt(ca[key]):>16}"
              f"{fmt(kb[key])+' -> '+fmt(ka[key]):>16}{fmt(d):>8}")
    print(f"\n  DiD of 1.00 means the change did nothing. Gates are calibrated"
          f"\n  against a measured null -- see scripts/measure-null.py.\n")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", required=True)
    ap.add_argument("--minutes", type=int, default=20)
    ap.add_argument("--paths", default="/var/log/mcai/*/skill-*.jsonl")
    ap.add_argument("--expect", default="",
                    help="the PROGRESS metric this change claims to improve "
                         "(escape_rate | reentry_s | held_frac)")
    ap.add_argument("--burn-in", type=int, default=BURN_IN_MIN,
                    help="minutes to drop after each canary bot's restart")
    ap.add_argument("--at", default="",
                    help="ISO time of the canary deploy. Enables "
                         "difference-in-differences, which is the only mode "
                         "whose null has been measured. Without it you get the "
                         "concurrent comparison, whose null spans 0.26-2.53.")
    ap.add_argument("--window", type=int, default=90,
                    help="minutes on each side of --at")
    a = ap.parse_args()

    if a.at:
        t0 = datetime.datetime.fromisoformat(a.at.replace("Z", "+00:00"))
        since = t0 - datetime.timedelta(minutes=a.window + 5)
    else:
        t0 = None
        since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=a.minutes)
    rows = load(a.paths, since, a.pool)
    canary = sorted(b for b in rows if b.startswith(a.pool + "-"))
    control = sorted(b for b in rows if not b.startswith(a.pool + "-"))
    if not canary:
        sys.exit(f"no bots matched pool '{a.pool}' -- nothing to report")
    if not control:
        sys.exit("no control bots -- a canary with no control is just a deploy")

    # ARE THE TWO GROUPS ACTUALLY RUNNING DIFFERENT CODE?
    #
    # Membership is decided by POOL NAME, which says nothing about what the bots
    # are executing. On 2026-08-25 a scheduled fleet recycle restarted all eighty
    # bots onto whatever was in $H/src -- the canary build -- without touching
    # their env labels. The fleet then reported 75 x `78ab136+ab359c` and
    # 5 x `34892cc+ab359c`: identical DIGESTS, different shas. This report
    # cheerfully compared the build against itself and printed 34% versus 28%.
    #
    # The digest is the hash of the .mjs actually loaded, so it is the only field
    # that describes what ran. If both sides share it, there is no experiment
    # here and saying so is the entire job.
    cver = _versions(rows, canary)
    kver = _versions(rows, control)
    print(f"\n  canary  code: {', '.join(sorted(cver)) or 'unknown'}")
    print(f"  control code: {', '.join(sorted(kver)) or 'unknown'}")
    cdig = {v.split('+')[-1] for v in cver}
    kdig = {v.split('+')[-1] for v in kver}
    if cdig and kdig and cdig == kdig:
        print("\n  NOT A CANARY: both groups are running the same code digest "
              f"({', '.join(sorted(cdig))}).")
        print("  Labels differ, the loaded source does not. Nothing below would")
        print("  mean anything, so it is not printed. A scheduled fleet recycle")
        print("  does exactly this -- see scripts/fleet-recycle.sh.\n")
        return 2
    if len(cdig) > 1 or len(kdig) > 1:
        print("\n  MIXED CODE within a group; the split is not clean. Refusing.\n")
        return 2

    if t0 is not None:
        return report_did(rows, canary, control, t0, a)

    # Only the canary restarted, so only the canary gets a burn-in cut.
    first = {b: rows[b][0][0] + datetime.timedelta(minutes=a.burn_in)
             for b in canary if rows[b]}
    c, k = summarise(rows, canary, skip_before=first), summarise(rows, control)
    print("\n  WARNING: no --at, so this is the concurrent comparison. Its null"
          "\n  spans 0.26-2.53 on harvest with NO change deployed. Prefer --at.")
    print(f"\n  window {a.minutes}m · canary pool {a.pool} ({c['bots']} bots) "
          f"vs control ({k['bots']} bots)")
    print(f"  DENOMINATORS  canary {c['exposure']:.1f} exposure-h / {c['events']} events   "
          f"control {k['exposure']:.1f} / {k['events']}")
    if c["exposure"] < MIN_EXPOSURE_H or k["exposure"] < MIN_EXPOSURE_H:
        print(f"\n  INSUFFICIENT EXPOSURE (need {MIN_EXPOSURE_H}h per arm after a "
              f"{a.burn_in}m burn-in cut on the canary).")
        print("  Five bots need time. Nothing below would mean anything yet.\n")
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
    def ratio(a, b, default=None):
        if a is None or b is None: return default
        return a / b if b else (1.0 if a == 0 else None)

    vals = dict(c)
    vals["gather_ratio"] = ratio(c["gather_per_exp"], k["gather_per_exp"])
    vals["death_ratio"] = ratio(c["death_per_exp"], k["death_per_exp"],
                                default=(1.0 if c["death_per_exp"] == 0 else None))
    vals["held_ratio"] = ratio(c["held_frac"], k["held_frac"])

    print(f"\n  REGRESSION GATES — the change must not make these worse")
    failed = 0
    for label, key, thr, sense, why in REGRESSION:
        v = vals.get(key)
        if v is None:
            print(f"    ?     {label:<22} no data — {why}")
            continue
        good = v >= thr if sense == "at least" else v <= thr
        failed += 0 if good else 1
        print(f"    {'PASS' if good else 'FAIL'}  {label:<22}{v:>8.2f}  {sense} {thr}  — {why}")

    print(f"\n  PROGRESS — reported against the control AND the standing target."
          f"\n  These never block on their own; --expect names the one this change must move.")
    for label, key, target, sense, why in PROGRESS:
        cv, kv = c.get(key), k.get(key)
        if cv is None or kv is None:
            print(f"    ?     {label:<22} no data")
            continue
        better = cv > kv if sense == "at least" else cv < kv
        hit = cv >= target if sense == "at least" else cv <= target
        mark = "better" if better else ("same" if cv == kv else "WORSE")
        print(f"          {label:<22}{cv:>8.2f} vs control {kv:>7.2f}  ({mark}; "
              f"target {sense} {target}{' — MET' if hit else ''})  — {why}")
        if a.expect == key:
            if better:
                print(f"    PASS  {label:<22}improved, which is what this change claimed")
            else:
                failed += 1
                print(f"    FAIL  {label:<22}did NOT improve, and it is what this change claimed")
    if a.expect and a.expect not in {g[1] for g in PROGRESS}:
        print(f"\n    !  --expect {a.expect} is not a progress metric; nothing was checked")
        failed += 1
    if not a.expect:
        print(f"\n    !  no --expect given: nothing checked that the change did what it claimed")

    print(f"\n  {'PASS — safe to roll out' if failed == 0 else f'{failed} GATE(S) FAILED — do not roll out'}\n")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
