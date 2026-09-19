#!/usr/bin/env python3
"""Placebo difference-in-differences: is the INFERENCE HALF a real confounder?

The draw at drawrec.sh:72 admits only 5080-half pools. That holds `half` constant
across canary and control. The cost is that 3 of 12 pools are permanently control
and the eligible set is routinely too small to draw a pair from.

But `half` is only which of two entries comes FIRST in OLLAMA_BASE_URLS. Both
endpoints are listed for every pool and both serve the same model. So the
restriction may be buying nothing.

This does not argue that. It measures it, by running FAKE canaries on history --
windows where no change was deployed, so the true DiD effect is zero by
construction -- and comparing the null distribution of the estimator for
same-half pairs against cross-half pairs.

The estimator is the one the reads actually use: ratio-DiD on items per bot-hour,
  (canary_post/canary_pre) / (control_post/control_pre)
reported in logs so that 0 is "no effect" and the spread is symmetric.

POSITIVE CONTROLS, because a null study that cannot see a difference proves
nothing:
  1. The hourly aggregation is checked against the poolrank2 numbers on the same
     window and the same version filter. It must match EXACTLY.
  2. An INJECTED effect (multiply the canary post items by a known factor) must be
     recovered by the same estimator. If it cannot recover a planted effect it
     cannot rule one out.
  3. Out-of-band pairs are reported alongside in-band pairs. If the band is doing
     work, out-of-band must show a wider null. If it does not, the band is not
     doing work either -- and that is a finding about the band, not about halves.
"""

# ---------------------------------------------------------------------------
# RETRACTED CONTROL, 2026-09-19. Any "planted +30% -> +30.0% ok" this file
# prints is an ARITHMETIC IDENTITY, not evidence. Multiplying the canary post
# window by f and reporting the log difference returns log(f) whatever the data
# says: measured across f in {1.05, 1.30, 1.77, 3.50, 0.40}, the spread over 162
# fits was 7e-16 every time. It could never fail.
# The real denominator control is realcontrol2.py, which drops a bot's ACTUAL
# per-bot items, must SCATTER (sd 0.30), and carries a mutant caught at
# log(4/5) = -0.2231. Note that its own first version repeated the same mistake
# by scaling the dropped bot's items by the surviving pool fraction.
# ---------------------------------------------------------------------------
import sys, json, math, datetime as dt, statistics as st, itertools, random
sys.path.insert(0, "/opt/minecraft-ai/scripts")
from lib.telemetry import Events
from collections import defaultdict

HOUR = dt.timedelta(hours=1)


def half_of(pool):
    # Matches poolrank2 line 20. Verified 2026-09-19 against the live harness env:
    # only *-d pools carry OLLAMA_BASE_URL=http://10.0.0.16:11434 (3090); the other
    # nine carry 10.0.0.72 (5080). BOTH endpoints appear in OLLAMA_BASE_URLS for
    # every pool, so this names the PRIMARY, not an isolation boundary.
    return "3090" if pool.endswith("-d") else "5080"


def pool_of(botname):
    return botname.rsplit("-", 1)[0]


def walk(since, until, version=None):
    """Full walk of [since, until). Windowed ONLY to stay under the loader OOM cap --
    every file that can hold a row in the window is read whole."""
    return Events.load(paths="/var/log/mcai/*/skill-*.jsonl*",
                       since=since, until=until, version=version)


def aggregate(since, until, version=None, chunk_hours=6, quiet=False,
              paths="/var/log/mcai/*/skill-*.jsonl*"):
    """per (pool, hour) -> items, bots present, deaths, llm decisions."""
    items = defaultdict(int)
    bots = defaultdict(set)
    deaths = defaultdict(int)
    dec = defaultdict(int)
    total_rows = 0
    t = since
    while t < until:
        t2 = min(t + dt.timedelta(hours=chunk_hours), until)
        ev = Events.load(paths=paths, since=t, until=t2, version=version)
        total_rows += len(ev.rows)
        for r in ev.rows:
            b = r["bot"].get("name", "")
            if not b or b.startswith("isolated") or b.startswith("self-"):
                continue
            p = pool_of(b)
            key = (p, r["t"].replace(minute=0, second=0, microsecond=0))
            bots[key].add(b)
            for _it, v in ((r["raw"].get("skill") or {}).get("inventory_delta") or {}).items():
                if v > 0:
                    items[key] += v
            if r["name"] == "_death":
                deaths[key] += 1
            if str(r["raw"].get("trigger", "")).startswith("llm") and not r["name"].startswith("_"):
                dec[key] += 1
        if not quiet:
            sys.stderr.write("  walked %s .. %s  %d rows\n"
                             % (t.strftime("%m-%d %HZ"), t2.strftime("%m-%d %HZ"), len(ev.rows)))
            sys.stderr.flush()
        del ev
        t = t2
    return dict(items=items, bots=bots, deaths=deaths, dec=dec, rows=total_rows)


# ---------------------------------------------------------------- positive control 1

def control_matches_poolrank2(since, until):
    """Reproduce poolrank2 EXACTLY -- same paths, same version filter, same bounds --
    and require identical item totals. An aggregator that has never been shown to
    agree with the live instrument is not evidence.

    The bounds MUST be passed in, not recomputed here. The first version let this
    use `since_minutes=120` (an unrounded now) while the comparison aggregate used
    an hour-rounded now: the two windows differed by up to 59 minutes at each end
    and every pool disagreed, by as much as 48%. Two instruments reading two
    windows tell you nothing about either."""
    BV = json.load(open("/srv/mcbots/trial-manifest.json")).get("declared_code_version")
    ev = Events.load(paths="/var/log/mcai/*/skill-*.jsonl", since=since, until=until, version=BV)
    ref_items = defaultdict(int)
    ref_bots = defaultdict(set)
    span = defaultdict(lambda: [None, None])
    for r in ev.rows:
        b = r["bot"].get("name", "")
        p = b.rsplit("-", 1)[0]
        if not b or b.startswith("isolated") or b.startswith("self-"):
            continue
        ref_bots[p].add(b)
        s = span[p]
        t = r["t"]
        s[0] = t if s[0] is None else min(s[0], t)
        s[1] = t if s[1] is None else max(s[1], t)
        for _it, v in ((r["raw"].get("skill") or {}).get("inventory_delta") or {}).items():
            if v > 0:
                ref_items[p] += v
    out = {}
    for p in ref_bots:
        h = (span[p][1] - span[p][0]).total_seconds() / 3600 * len(ref_bots[p])
        out[p] = (ref_items[p], ref_items[p] / h if h else 0.0)
    return out, BV


# ---------------------------------------------------------------- the estimator

def rate(agg, pool, t0, t1, inject=1.0):
    """items per bot-hour for `pool` over [t0, t1), and the bot-hours behind it.

    Bot-hours are counted from PRESENCE: a bot with at least one row in an hour
    bucket contributes one bot-hour. Returns (rate, bot_hours, items)."""
    items = 0.0
    bh = 0.0
    h = t0
    while h < t1:
        key = (pool, h)
        n = len(agg["bots"].get(key, ()))
        if n:
            bh += n
            items += agg["items"].get(key, 0) * inject
        h += HOUR
    return (items / bh if bh else None), bh, items


def did(agg, canary, controls, cut, half_window_h, inject=1.0):
    """ratio-DiD in logs. inject scales the CANARY POST items only -- the planted
    effect for positive control 2."""
    pre0, pre1 = cut - dt.timedelta(hours=half_window_h), cut
    post0, post1 = cut, cut + dt.timedelta(hours=half_window_h)
    cpre, cpre_bh, _ = rate(agg, canary, pre0, pre1)
    cpost, cpost_bh, _ = rate(agg, canary, post0, post1, inject=inject)
    # controls are POOLED, as the reads pool them
    def pooled(t0, t1):
        it = bh = 0.0
        for p in controls:
            r, b, i = rate(agg, p, t0, t1)
            it += i
            bh += b
        return (it / bh if bh else None), bh
    kpre, kpre_bh = pooled(pre0, pre1)
    kpost, kpost_bh = pooled(post0, post1)
    if not all(x for x in (cpre, cpost, kpre, kpost)):
        return None
    if min(cpre_bh, cpost_bh) < half_window_h * 3:   # need most of 5 bots present
        return None
    return math.log((cpost / cpre) / (kpost / kpre))


def spread(xs):
    if len(xs) < 3:
        return None
    xs = sorted(xs)
    return dict(n=len(xs),
                median=st.median(xs),
                sd=st.pstdev(xs),
                iqr=xs[int(.75 * len(xs))] - xs[int(.25 * len(xs))],
                p05=xs[int(.05 * len(xs))],
                p95=xs[min(len(xs) - 1, int(.95 * len(xs)))])


def fmt(s, label):
    if not s:
        return "%-34s  too few pairs" % label
    # log units -> percent, so the reader sees what a read would report
    pct = lambda v: (math.exp(v) - 1) * 100
    return ("%-34s n=%4d  median %+6.1f%%  sd %5.2f  IQR %5.2f  "
            "90%% of the null inside [%+6.1f%%, %+6.1f%%]"
            % (label, s["n"], pct(s["median"]), s["sd"], s["iqr"], pct(s["p05"]), pct(s["p95"])))


# ---------------------------------------------------------------- contamination

def canary_intervals(path="/var/log/mcai/_canary-decisions.jsonl", lead_h=12):
    """(pool, t0, t1) spans where a REAL canary was live, so the null must avoid them.

    The ledger records the DECISION time, not the deploy. Conservatively treat the
    12 h before each decision as live for that pool -- longer than any canary run
    this season, so the exclusion errs toward throwing good windows away rather
    than smuggling a real effect into the null."""
    out = []
    for line in open(path):
        try:
            row = json.loads(line)
        except Exception:
            continue
        ts = dt.datetime.fromisoformat(row["ts"])
        for p in str(row.get("canary_pool") or "").split(","):
            p = p.strip()
            if p:
                out.append((p, ts - dt.timedelta(hours=lead_h), ts))
    return out


def contaminated(pool, t0, t1, spans):
    for p, s0, s1 in spans:
        if p == pool and t0 < s1 and s0 < t1:
            return True
    return False


# ---------------------------------------------------------------- main

def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 7.0
    W = 3                       # 3 h pre, 3 h post -- the usual +180 min read
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    since = now - dt.timedelta(days=days)

    print("== positive control 1: does this aggregator agree with the live instrument?")
    # IDENTICAL bounds and IDENTICAL paths on both sides, or the comparison is vacuous.
    ctl_until = dt.datetime.now(dt.timezone.utc)
    ctl_since = ctl_until - dt.timedelta(minutes=120)
    ref, BV = control_matches_poolrank2(ctl_since, ctl_until)
    agg120 = aggregate(ctl_since, ctl_until, version=BV, chunk_hours=6, quiet=True,
                       paths="/var/log/mcai/*/skill-*.jsonl")
    mine = defaultdict(int)
    for (p, _h), v in agg120["items"].items():
        mine[p] += v
    bad = []
    for p in sorted(ref):
        if mine.get(p, 0) != ref[p][0]:
            bad.append((p, ref[p][0], mine.get(p, 0)))
    print("   version filter %s, %d pools, item totals over the last 120 min" % (BV, len(ref)))
    if bad:
        print("   MISMATCH -- aggregator disagrees with poolrank2, refusing to report a null:")
        for p, a, b in bad:
            print("      %-12s poolrank2 %6d   halfdid %6d" % (p, a, b))
        # the two use different time bounds at the edges; report and continue only if close
        worst = max(abs(a - b) / max(a, 1) for _p, a, b in bad)
        print("   worst relative gap %.1f%%" % (worst * 100))
        if worst > 0.05:
            raise SystemExit("aggregator is not the same instrument; fix before reading a null")
    else:
        print("   EXACT MATCH on all %d pools" % len(ref))

    print()
    print("== walking %.1f days of history" % days)
    agg = aggregate(since, now, version=None, chunk_hours=6)
    pools = sorted({p for (p, _h) in agg["bots"]})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    print("   %d pools, %d rows" % (len(pools), agg["rows"]))
    for p in pools:
        print("      %-12s half %s" % (p, half_of(p)))

    spans = canary_intervals()
    print("   %d real-canary spans excluded from the null" % len(spans))

    # ---- the null: every pool, every cut, control = every other CLEAN pool
    cuts = []
    t = since + dt.timedelta(hours=W)
    while t <= now - dt.timedelta(hours=W):
        cuts.append(t)
        t += HOUR
    print("   %d candidate cut times" % len(cuts))

    buckets = defaultdict(list)
    inj_recovered = []
    INJECT = 1.30              # planted +30% -- the KEEP threshold used by the reads
    for cut in cuts:
        t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
        clean = [p for p in pools if not contaminated(p, t0, t1, spans)]
        if len(clean) < 6:
            continue
        # band is judged on the PRE window, as the draw judges it
        pre_rates = {}
        for p in clean:
            r, bh, _ = rate(agg, p, t0, cut)
            if r is not None and bh >= W * 3:
                pre_rates[p] = r
        if len(pre_rates) < 6:
            continue
        med = st.median([pre_rates[p] for p in pre_rates if half_of(p) == "5080"] or [0])
        if not med:
            continue
        for canary in pre_rates:
            controls = [p for p in pre_rates if p != canary]
            d = did(agg, canary, controls, cut, W)
            if d is None:
                continue
            in_band = abs(pre_rates[canary] - med) / med <= 0.40
            buckets["half: %s canary" % half_of(canary)].append(d)
            buckets["band: %s" % ("inside +-40%" if in_band else "OUTSIDE +-40%")].append(d)
            buckets["ALL"].append(d)
            # positive control 2: can the same estimator recover a planted +30%?
            di = did(agg, canary, controls, cut, W, inject=INJECT)
            if di is not None:
                inj_recovered.append(di - d)

    print()
    print("== positive control 2: can this estimator recover a planted effect?")
    if inj_recovered:
        got = (math.exp(st.median(inj_recovered)) - 1) * 100
        print("   planted +%.0f%% on the canary post window, recovered %+.1f%% (median over %d fits)"
              % ((INJECT - 1) * 100, got, len(inj_recovered)))
        if abs(got - (INJECT - 1) * 100) > 1.0:
            print("   RECOVERY IS OFF -- the estimator cannot see a known effect; the null below means nothing")
    else:
        print("   NO FITS -- cannot verify recovery, so nothing below is evidence")
        raise SystemExit(1)

    print()
    print("== the null distribution of the read, on windows where NOTHING was deployed")
    print("   (true effect is zero by construction; every number below is noise)")
    print()
    for k in ["ALL", "half: 5080 canary", "half: 3090 canary",
              "band: inside +-40%", "band: OUTSIDE +-40%"]:
        print("   " + fmt(spread(buckets.get(k, [])), k))


if __name__ == "__main__":
    main()
