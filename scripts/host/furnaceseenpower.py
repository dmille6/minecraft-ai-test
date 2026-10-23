#!/usr/bin/env python3
# furnaceseenpower.py [hours=120] [sims=1000] [effect=auto] -- the PRE-LAUNCH power simulation for furnaceseen-01's effect line
# (design 6.3 B3: "the registration's reads are the shortest schedule a pre-launch simulation from the per-town pre-period rates
# gives 80% power for the bar; if no schedule <= 48 h reaches 80%, B3 closes INCONCLUSIVE: underpowered"). Read-only: the
# fleet's skill logs, no emit. r2 (Codex r1 P2-3, Claude r1 P3-6): the READ'S OWN machinery -- the frozen 24 h pre-period, the
# eligible control set (eligible_controls), span bot-hours, effect_line -- and ONE treated trajectory per simulated run (each
# repeat removed or not once, then both reads see the same history); the removal share ESTIMATED from the base logs.
#
# A simulated run: a random cut t with 24 h of history before it and the final read's window after it; 4 canary pools drawn from
# the pools eligible at t (the same rule as the controls); the canary's POST repeats thinned by the removal share. KEEP when the
# margin is >= 0 at +180 or at the final read. Power = KEEP share (with its binomial 95% interval). Also the null (effect 0).
# NOT MODELLED, and stated with the result: verdict.py's tier-2 clean-baseline rule (the 4 pools on the controls' build for
# max(240, M) min before the cut), which a +2880 tier-2 KEEP also needs.
import sys, os, glob, random, bisect, math
from collections import Counter
import datetime as dt
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from furnaceseenread import fields, repeat_empties, effect_line, eligible_controls, contamination, PRE_MIN, MIN_POOL_BH, REPEAT_MS, CONTAM_BUCKET_MS   # noqa: E402

SELFTEST = sys.argv[1:2] == ['--selftest']
HOURS = float(sys.argv[1]) if len(sys.argv) > 1 and not SELFTEST else 120
SIMS = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
EFFECT = sys.argv[3] if len(sys.argv) > 3 else 'auto'
FINALS = (360, 720, 1440, 2880)
random.seed(20261023)


def load(pool, since, until):
    from lib.telemetry import Events
    drains, loads, per_bot = [], [], defaultdict(list)
    vers = defaultdict(Counter)      # MINUTE -> {version: rows}: re-bucketed exactly at each minute-aligned cut (Codex r4 P2)
    files = glob.glob(f'/var/log/mcai/{pool}-*/skill-*.jsonl*')
    for fpath in files:
        for r in Events.load(paths=fpath, since=since, until=until).rows:
            t = r.get('t'); b = (r.get('bot') or {}).get('name')
            if t is None or not b:
                continue
            ms = int(t.timestamp() * 1000)
            per_bot[b].append(ms)
            v = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
            if v:
                vers[ms // 60000][v] += 1
            k = (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
            if k == '_furnace_drain':
                f = fields(r.get('detail'))
                drains.append((ms, b, f.get('furnace'), f.get('stop'), int(f.get('t0') or ms) if (f.get('t0') or '').isdigit() else ms))
            elif k == '_furnace_session':
                f = fields(r.get('detail'))
                if f.get('by') in ('smelt', 'smelt_town'):
                    loads.append((ms, f.get('furnace')))
    for b in per_bot:
        per_bot[b] = sorted(set(per_bot[b]))
    def span_bh(lo, hi):      # the READ'S bot-hours: each bot's first-to-last row inside the window
        h = 0.0
        for ts in per_bot.values():
            i, j = bisect.bisect_left(ts, lo), bisect.bisect_left(ts, hi) - 1
            if j > i:
                h += (ts[j] - ts[i]) / 3600_000
        return h
    return sorted(drains), sorted(loads), span_bh, vers


def repeats_with_flags(drains, loads):
    """Each drain -> (row, is_repeat, removable): removable = the earlier townmate empty was logged BEFORE this drain's pick
    (t0), so a ledger entry existed to skip on (the skip cannot save a walk already under way)."""
    last, out = {}, []
    lb = defaultdict(list)
    for t, f in loads:
        lb[f].append(t)
    for row in drains:
        t, b, f, stop, t0 = row
        rep = rem = False
        if stop == 'empty':
            e = last.get(f)
            if e and e[1] != b and t - e[0] < REPEAT_MS and not any(e[0] < tl < t for tl in lb[f]):
                rep = True; rem = e[0] < t0
            last[f] = (t, b)
        out.append((row, rep, rem))
    return out


def prebuckets(data, pools, lo, hi):
    """The read's contamination input over EXACTLY [lo, hi) (minute-aligned): each minute's version counts summed into the
    read's own CONTAM_BUCKET_MS buckets (minute m lies in bucket m*60000 // CONTAM_BUCKET_MS, as a row at that minute would)."""
    out = defaultdict(Counter)
    for p in pools:
        vm = data[p][3]
        for m in range(lo // 60000, hi // 60000):
            if m in vm:
                out[(m * 60000 // CONTAM_BUCKET_MS, p)].update(vm[m])
    return out


def treat(rows, loads, removal, rnd=random.random):
    """The treated trajectory of ONE pool's drains (sorted rows (t, bot, furnace, stop, t0)): walking the drains in order, a drain
    is SKIPPED (removed) when the newest RETAINED empty finding on its furnace is ANOTHER bot's, < REPEAT_MS old, logged before
    this drain's pick, with no load between -- with probability `removal`. Later drains compare to what was retained, as the
    skip rule does. -> the retained rows."""
    last, kept = {}, []
    lb = defaultdict(list)
    for t, f in loads:
        lb[f].append(t)
    for row in rows:
        t, b, f, stop, t0 = row
        if stop == 'empty':
            e = last.get(f)
            if e and e[1] != b and t - e[0] < REPEAT_MS and e[0] < t0 and not any(e[0] < tl < t for tl in lb[f]) and rnd() < removal:
                continue
            last[f] = (t, b)
        kept.append(row)
    return kept


# Codex r2 P2-1's fixture: A@0, B@10m, B@20m empties on one furnace -> full removal keeps only A@0 (zero repeats left)
_rows = [(0, 'A', 'F', 'empty', 0), (600_000, 'B', 'F', 'empty', 590_000), (1_200_000, 'B', 'F', 'empty', 1_190_000)]
assert [r[0] for r in treat(_rows, [], 1.0)] == [0]
assert repeat_empties([r[:4] for r in treat(_rows, [], 1.0)], []) == 0 and repeat_empties([r[:4] for r in _rows], []) == 1
assert [r[0] for r in treat(_rows, [], 0.0)] == [0, 600_000, 1_200_000]
# Codex r4 P2's boundary: only rows inside [lo, hi) enter the buckets (a minute before lo, or at hi, never does)
_d = {'P': (None, None, None, {9: Counter({'x': 5}), 10: Counter({'a': 7}), 19: Counter({'a': 1}), 20: Counter({'x': 9})})}
assert prebuckets(_d, ['P'], 600_000, 1_200_000) == {(1, 'P'): Counter({'a': 8})}, prebuckets(_d, ['P'], 600_000, 1_200_000)


def main():
    until = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
    since = until - dt.timedelta(hours=HOURS)
    pools = sorted({'-'.join(os.path.basename(p).split('-')[:2]) for p in glob.glob('/var/log/mcai/*-*-*') if os.path.isdir(p)})
    data = {p: load(p, since, until) for p in pools}
    flags = {p: repeats_with_flags(*data[p][:2]) for p in pools}
    ftimes = {p: [row[0] for row, _, _ in flags[p]] for p in pools}
    ltimes = {p: [x[0] for x in data[p][1]] for p in pools}
    sl = lambda xs, ts, lo, hi: xs[bisect.bisect_left(ts, lo):bisect.bisect_left(ts, hi)]
    reps = sum(1 for p in pools for _, r, _ in flags[p] if r)
    rem = sum(1 for p in pools for _, r, m in flags[p] if r and m)
    share = rem / reps if reps else 0.0
    eff = share if EFFECT == 'auto' else float(EFFECT)
    s_ms, u_ms = int(since.timestamp() * 1000), int(until.timestamp() * 1000)
    print(f'history {HOURS:g} h to {until:%m-%d %H:%MZ} | pools {len(pools)} | repeats {reps}, removable (the earlier empty logged before the pick) {rem} = {share:.3f} | effect used {eff:.3f} | sims {SIMS}')
    def rate(p, lo, hi, kept=None):
        drains = [row[:4] for row in (kept if kept is not None else [r for r, _, _ in sl(flags[p], ftimes[p], lo, hi)]) if lo <= row[0] < hi]
        h = data[p][2](lo, hi)
        return repeat_empties(drains, sl(data[p][1], ltimes[p], lo, hi)) / h if h >= MIN_POOL_BH else None
    for e in (eff, 0.0):
        for fin in FINALS:
            W = fin * 60000; P = PRE_MIN * 60000
            if u_ms - s_ms < P + W:
                print(f'  +{fin}: no history'); continue
            hits = runs = cuts = unreadable = 0
            for _ in range(SIMS):
                t = random.randint((s_ms + P) // 60000 + 1, (u_ms - W) // 60000) * 60000     # minute-aligned: exact windows
                pre_n = {p: len(sl(ftimes[p], ftimes[p], t - P, t)) for p in pools}
                # THE READ'S CONTAMINATION RULE at this cut (Codex r3 P2): the pre-period's version counts per bucket and pool
                contam = contamination(prebuckets(data, pools, t - P, t))
                el, _ = eligible_controls(pre_n, contam, set())
                cuts += 1
                if len(el) < 8:          # the read needs 4 canary pools AND >= 4 controls (Codex r4 P3)
                    unreadable += 1      # fewer than 4 clean canary pools + 2 clean controls: the run would read UNDEFINED
                    continue
                can = random.sample(el, 4)
                ctl = [p for p in el if p not in can]
                # ONE treated trajectory per canary pool, SEQUENTIAL (treat), seen by both reads
                kept = {p: treat([r for r, _, _ in sl(flags[p], ftimes[p], t, t + W)], sl(data[p][1], ltimes[p], t, t + W), e) for p in can}
                ok = False
                for read in (180, fin):
                    w = read * 60000
                    rates = {}
                    for p in can + ctl:
                        rates[('pre', p)] = rate(p, t - P, t)
                        rates[('post', p)] = rate(p, t, t + w, kept.get(p))
                    m = effect_line(rates, can, ctl)['margin']
                    if m is not None and m >= 0:
                        ok = True
                runs += 1; hits += ok
            # ALWAYS reported, even when no cut could be drawn (Codex r4 P3): an all-UNDEFINED schedule is the result
            print(f'  {"POWER" if e else "NULL "} removal {e:.2f}  +180/+{fin}: cuts {cuts}, UNDEFINED (fewer than 4 clean canary + 4 clean '
                  f'control pools) {unreadable} ({unreadable / max(1, cuts):.2f}); KEEP over ALL cuts {hits}/{cuts} = {hits / max(1, cuts):.3f}')
            if runs:
                ph = hits / runs
                indep = max(1, int((u_ms - s_ms - P - W) // W) + 1)
                print(f'      among the {runs} DEFINED cuts: KEEP {hits}/{runs} = {ph:.3f} (not binomial: the cuts share history -- about {indep} '
                      f'non-overlapping post-window(s) in the range)')


if __name__ == '__main__':
    if SELFTEST:
        print('SELFTEST OK')                  # the fixtures above ran on import
    else:
        main()
