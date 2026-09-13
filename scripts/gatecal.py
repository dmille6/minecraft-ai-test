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
import itertools
UNITS = [(p,) for p in pools] + list(itertools.combinations(pools, 2))   # 5-bot pools and 10-bot pairs (owner: C)
def unit_counts(unit, t0, L, pre=False):
    a, b = (t0 - dt.timedelta(minutes=L), t0) if pre else (t0, t0 + dt.timedelta(minutes=L))
    dc = sum(1 for ts, p, _ in deaths if p in unit and a <= ts < b)
    dk = sum(1 for ts, p, _ in deaths if p not in unit and a <= ts < b)
    nb = 5 * len(unit)
    return dc, dk, nb*L/60, (80-nb)*L/60
res = collections.Counter(); n = collections.Counter(); trip_look = collections.Counter(); ex = []; zero_dc = 0; ctrl_rates = []
t0 = max(t_start, deaths[0][0]) + dt.timedelta(hours=6)   # coverage starts where the logs do, plus the 6-h pre-period the DiD rule needs
while t0 + dt.timedelta(minutes=360) <= now:
    # fleet-level backstop, evaluated every 30 min: trailing 2-h fleet rate > 2x the 6-h rate before t0 (the "deploy")
    pre_d = sum(1 for ts, _, _ in deaths if t0 - dt.timedelta(hours=6) <= ts < t0); pre_rate = pre_d / (80*6)
    fleet_trip = False
    for m in range(120, 361, 30):
        w1 = t0 + dt.timedelta(minutes=m); d2 = sum(1 for ts, _, _ in deaths if w1 - dt.timedelta(hours=2) <= ts < w1)
        if d2/(80*2) > 2*max(pre_rate, 1/(80*6)): fleet_trip = True
    res['fleet_backstop_trip'] += fleet_trip; n['fleet'] += 1
    for unit in UNITS:
        size = f'{5*len(unit)}bot'; n[size] += 1
        cur = v3 = None
        for L in LOOKS:
            dc, dk, ec, ek = unit_counts(unit, t0, L)
            ratio = (dc/ec) / (dk/ek) if dk > 0 else (math.inf if dc > 0 else 0)
            if cur is None and dc >= 2 and ratio > 1.25: cur = L
            if v3 is None:
                if dc >= 3 or (dc >= 2 and dk == 0): v3 = L
                elif ec >= 6 and dc + dk > 0:
                    p = binom_tail(dc, dc+dk, ec/(ec+ek))
                    if p < ALPHA[L] and ratio > 1.25: v3 = L
        # pool DiD at +360: the unit's post rate vs its own 6-h pre rate, against the control's change; two-death floor and 1.25x
        dc, dk, ec, ek = unit_counts(unit, t0, 360); pc, pk, pec, pek = unit_counts(unit, t0, 360, pre=True)
        can_change = (dc/ec) / max(pc/pec, 0.5/pec); ctl_change = (dk/ek) / max(pk/pek, 0.5/pek)
        did_trip = dc >= 2 and can_change / max(ctl_change, 1e-9) > 1.25
        if cur: res[f'current_trip_{size}'] += 1
        if v3: res[f'v3_trip_{size}'] += 1
        if did_trip: res[f'did360_trip_{size}'] += 1
        if size == '5bot' and L == 360:
            pass
    t0 += dt.timedelta(minutes=30)
print(f"pseudo-canaries: {dict(n)} (coverage {deaths[0][0]:%m-%d %H:%M} .. {now:%H:%M}, 6-h pre-period reserved)")
for k in sorted(res): print(f"  {k:28} {res[k]:5} ({100*res[k]/(n['fleet'] if k.startswith('fleet') else n[k.rsplit('_',1)[1]]):.1f}%)")
