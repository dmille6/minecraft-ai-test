#!/usr/bin/env python3
"""Placebo calibration of the canary death gate on the fleet's own history (Codex, amendment pass 2: 'calibrate under
the actual fleet process'). Pseudo-canaries: every real 5-bot pool x start times every 30 min over the last N hours,
with NO change deployed. For each, the rule is evaluated exactly as a real read would at +30/+90/+180/+360.
Reports the false-trip rate of the CURRENT rule (>=2 canary deaths and ratio > 1.25 at any look) and of v3."""
import sys, json, glob, subprocess, datetime as dt, math, collections, random
HOURS = int(sys.argv[1]) if len(sys.argv) > 1 else 72
now = dt.datetime.now(dt.timezone.utc); t_start = now - dt.timedelta(hours=HOURS)
# deaths: one grep pass over the fleet logs
out = subprocess.run("grep -ah '\"_death\"' /var/log/mcai/*/skill-*.jsonl", shell=True, capture_output=True, text=True).stdout
deaths = []
for l in out.splitlines():
    try: r = json.loads(l)
    except Exception: continue
    if r.get('skill', {}).get('name') != '_death': continue
    ts = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
    if ts < t_start: continue
    b = r['bot']['name']; pool = b.rsplit('-', 1)[0]
    deaths.append((ts, pool, b))
deaths.sort()
pools = sorted({p for _, p, _ in deaths} | {f'{a}-{s}' for a in ('hive', 'board', 'placebo') for s in 'abcd'})
pools = [p for p in pools if not p.startswith('isolated')]
print(f'window {HOURS} h ending {now:%Y-%m-%dT%H:%M}Z: {len(deaths)} deaths, {len(pools)} pools; positive control: first {deaths[0][0]:%m-%d %H:%M} last {deaths[-1][0]:%m-%d %H:%M}')
LOOKS = [30, 90, 180, 360]; ALPHA = {30: 0.010, 90: 0.010, 180: 0.020, 360: 0.030}
def binom_tail(k, n, p):  # P(X >= k)
    return sum(math.comb(n, i) * p**i * (1-p)**(n-i) for i in range(k, n+1))
def poisson_upper90(d):   # one-sided 90% upper bound on the mean for an observed count d (chi-square/2 form via search)
    lo, hi = 0.0, 50.0
    for _ in range(60):
        mid = (lo+hi)/2; cdf = sum(math.exp(-mid)*mid**i/math.factorial(i) for i in range(d+1))
        if cdf > 0.10: lo = mid
        else: hi = mid
    return hi
def window_counts(pool, t0, L):
    t1 = t0 + dt.timedelta(minutes=L)
    dc = sum(1 for ts, p, _ in deaths if p == pool and t0 <= ts < t1)
    dk = sum(1 for ts, p, _ in deaths if p != pool and t0 <= ts < t1)
    return dc, dk, 5*L/60, 75*L/60
res = collections.Counter(); n = 0; trip_look = collections.Counter(); ex = []; zero_dc = 0; ctrl_rates = []
t0 = max(t_start, deaths[0][0])   # coverage starts where the logs do (logrotate), not where the argument says
while t0 + dt.timedelta(minutes=360) <= now:
    for pool in pools:
        n += 1
        cur = v3 = None; keep_fail = False
        for L in LOOKS:
            dc, dk, ec, ek = window_counts(pool, t0, L)
            ratio = (dc/ec) / (dk/ek) if dk > 0 else (math.inf if dc > 0 else 0)
            if cur is None and dc >= 2 and ratio > 1.25: cur = L
            if v3 is None:
                if dc >= 3 or (dc >= 2 and dk == 0): v3 = L
                elif ec >= 6 and dc + dk > 0:
                    p = binom_tail(dc, dc+dk, ec/(ec+ek))
                    if p < ALPHA[L] and ratio > 1.25: v3 = L
            if L == 360:
                if dc == 0: zero_dc += 1
                ctrl_rates.append(dk/ek)
            if L == 360 and v3 is None:
                # KEEP harm bound: 90% upper bound on the canary rate <= 2x the control rate
                ub = poisson_upper90(dc) / ec; ctrl = dk/ek if dk > 0 else 0.5/ek
                if ub > 2*ctrl: keep_fail = True
        if cur: res['current_trip'] += 1; trip_look[('cur', cur)] += 1
        if v3: res['v3_trip'] += 1; trip_look[('v3', v3)] += 1
        if keep_fail: res['v3_keep_fail_at_360'] += 1
        if cur and not v3 and len(ex) < 6: ex.append((pool, f'{t0:%m-%d %H:%M}', cur))
    t0 += dt.timedelta(minutes=30)
print(f'pseudo-canaries: {n} (coverage {deaths[0][0]:%m-%d %H:%M} .. {now:%H:%M}); canary 0 deaths at +360: {zero_dc} ({100*zero_dc/n:.0f}%); control deaths/bot-h at +360: mean {sum(ctrl_rates)/len(ctrl_rates):.3f}')
for k in ('current_trip', 'v3_trip', 'v3_keep_fail_at_360'): print(f'  {k:24} {res[k]:5} ({100*res[k]/n:.1f}%)')
print('  trips by look:', dict(sorted(trip_look.items())))
print('  examples tripped by the current rule but not v3:', ex)
