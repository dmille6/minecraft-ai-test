#!/usr/bin/env python3
"""measure-null.py -- what does a canary say when NOTHING changed?

    scripts/measure-null.py --window 90 --steps 6

A gate is only worth having if you know what the instrument reads on a change
that does nothing. The concurrent comparison was never checked that way, and
when it finally was -- every pool against the other thirty-five, uniform fleet,
identical code -- harvest ratios came out

    0.26  0.30  0.44  0.95  1.03  1.62  1.81  2.53

Gates set on that reject a no-op about a third of the time and pass a real
regression about as often. The number in the gate was chosen; it should have
been measured.

So this sweeps every pool against several pseudo-deploy times on a fleet where
no deploy happened, runs the SAME difference-in-differences estimator a real
canary would use, and reports the spread. That spread IS the null. A gate below
its 5th percentile catches things the instrument can actually resolve; anything
tighter is false precision.

Requires a uniform fleet. If versions disagree, the "null" would contain a real
effect and the whole exercise is circular, so this refuses to run.
"""
import argparse, datetime, glob, json, os, statistics, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

import gzip as _gzip
def _openlog(p):
    """Rotated telemetry is gzipped; a plain open() would parse compressed bytes
    as text and silently yield nothing. See scripts/lib/telemetry.py:open_log."""
    return _gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')
spec = importlib.util.spec_from_file_location("cr", Path(__file__).parent / "canary-report.py")
cr = importlib.util.module_from_spec(spec); spec.loader.exec_module(cr)

METRICS = [("harvest", "gather_per_exp"), ("reflex-owned", "held_frac"),
           ("ended on land", "escape_rate"), ("re-entry gap", "reentry_s")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paths", default="/var/log/mcai/*/skill-*.jsonl*")
    ap.add_argument("--window", type=int, default=90)
    ap.add_argument("--steps", type=int, default=6, help="pseudo-deploy times to sweep")
    ap.add_argument("--burn-in", type=int, default=0,
                    help="0 for the null: nothing restarted, so there is no burn-in")
    a = ap.parse_args()

    span = datetime.timedelta(minutes=a.window)
    newest = datetime.datetime.now(datetime.timezone.utc)
    since = newest - span * 2 - datetime.timedelta(minutes=a.window * a.steps // 2 + 30)
    rows = cr.load(a.paths, since, "")
    if not rows:
        sys.exit("no telemetry in the window")

    # THE FLEET MUST BE UNIFORM or this measures a deploy, not a null.
    vers = set()
    for bot, evs in rows.items():
        for _, d in evs[-40:]:
            v = (d.get("code") or {}).get("version")
            if v: vers.add(v)
    if len(vers) != 1:
        sys.exit(f"fleet is not uniform ({sorted(vers)}) -- a null measured across a "
                 f"split would contain the very effect it is meant to exclude")
    print(f"  uniform fleet on {vers.pop()}")

    pools = sorted({b.rsplit("-", 1)[0] for b in rows})
    latest = max(t for evs in rows.values() for t, _ in evs)
    samples = {k: [] for _, k in METRICS}
    n_ok = n_thin = 0
    for i in range(a.steps):
        t0 = latest - span - datetime.timedelta(minutes=a.window * i // 2)
        for pool in pools:
            canary = [b for b in rows if b.startswith(pool + "-")]
            control = [b for b in rows if not b.startswith(pool + "-")]
            if not canary or not control: continue
            cb = cr.summarise(rows, canary,  lo=t0 - span, hi=t0)
            ca = cr.summarise(rows, canary,  lo=t0, hi=t0 + span)
            kb = cr.summarise(rows, control, lo=t0 - span, hi=t0)
            ka = cr.summarise(rows, control, lo=t0, hi=t0 + span)
            if min(cb["exposure"], ca["exposure"], kb["exposure"], ka["exposure"]) < 0.5:
                n_thin += 1; continue
            n_ok += 1
            for _, key in METRICS:
                d = cr.did(cb, ca, kb, ka, key)
                if d is not None and d > 0: samples[key].append(d)

    print(f"  {len(pools)} pools x {a.steps} pseudo-deploy times, "
          f"{a.window}m windows -> {n_ok} usable, {n_thin} too thin\n")
    if n_ok < 8:
        print("  NOT ENOUGH USABLE SAMPLES to characterise a null. Need more "
              "hours of telemetry, or a shorter --window.\n")
        return 2

    print(f"  {'METRIC':<16}{'N':>4}{'p5':>8}{'p25':>8}{'MEDIAN':>8}{'p75':>8}{'p95':>8}{'SPREAD':>9}")
    for label, key in METRICS:
        v = sorted(samples[key])
        if len(v) < 8:
            print(f"  {label:<16}{len(v):>4}   too few samples")
            continue
        q = lambda p: v[min(len(v) - 1, int(p * len(v)))]
        print(f"  {label:<16}{len(v):>4}{q(.05):>8.2f}{q(.25):>8.2f}"
              f"{statistics.median(v):>8.2f}{q(.75):>8.2f}{q(.95):>8.2f}"
              f"{q(.95)/max(q(.05),1e-9):>8.1f}x")
    print("\n  A DiD of 1.00 is 'did nothing'. A blocking gate must sit outside")
    print("  p5..p95, or it will fire on changes that did nothing.\n")
    for label, key in METRICS:
        v = sorted(samples[key])
        if len(v) < 8: continue
        q5 = v[max(0, int(.05 * len(v)))]
        print(f"    suggested {label:<16} gate: DiD below {q5:.2f} is a real regression")
    return 0


if __name__ == "__main__":
    sys.exit(main())
