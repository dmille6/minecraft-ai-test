#!/usr/bin/env python3
# furnaceseenpower.py [hours=72] [effect=0.7] [sims=200] -- the PRE-LAUNCH power simulation for furnaceseen-01's effect line
# (design 6.3 B3: "the registration's reads (+180, +360, and a last read) are the shortest schedule a pre-launch simulation from
# the per-town pre-period rates gives 80% power for the bar; if no schedule <= 48 h reaches 80%, B3 closes INCONCLUSIVE:
# underpowered"). Read-only: the fleet's skill logs, no emit.
#
# FROM THE FLEET: per shared pool, every `_furnace_drain` (stop, furnace, bot) and every smelt / smelt_town `_furnace_session`
# (a load), and bot-hours by minute presence. A simulated run: a random cut t in the history, 4 random canary pools, the rest
# control; pre = [t-W, t), post = [t, t+W); the canary's POST repeat empty drains thinned by `effect` (each removed with that
# probability: the skip removes a repeat unless a race or a lit sighting releases it). The effect line's margin (furnaceseenread
# lower_bound - 0.25 x the canary pre rate) at +180 and at the final read; a run KEEPs when either is >= 0. Power = KEEP share.
# Also the null (effect 0): the false-KEEP share, which the Bonferroni split should hold near or under 5%.
import sys, os, glob, json, random
import datetime as dt
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from furnaceseenread import fields, pool_of, repeat_empties, lower_bound, BAR_SHARE   # noqa: E402

HOURS = float(sys.argv[1]) if len(sys.argv) > 1 else 72
EFFECT = float(sys.argv[2]) if len(sys.argv) > 2 else 0.7
SIMS = int(sys.argv[3]) if len(sys.argv) > 3 else 200
FINALS = (360, 720, 1440, 2880)
random.seed(20261023)


def load(pool, since, until):
    from lib.telemetry import Events
    ev = Events.load(paths=f'/var/log/mcai/{pool}-*/skill-*.jsonl*', since=since, until=until)
    drains, loads, pres = [], [], defaultdict(set)
    for r in ev.rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        ms = int(t.timestamp() * 1000)
        pres[b].add(ms // 60000)
        k = (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
        if k == '_furnace_drain':
            f = fields(r.get('detail'))
            drains.append((ms, b, f.get('furnace'), f.get('stop')))
        elif k == '_furnace_session':
            f = fields(r.get('detail'))
            if f.get('by') in ('smelt', 'smelt_town'):
                loads.append((ms, f.get('furnace')))
    # bot-minutes per minute, as a prefix sum: bot-hours of any window in O(1)
    import bisect
    cnt = defaultdict(int)
    for mins in pres.values():
        for m in mins:
            cnt[m] += 1
    keys = sorted(cnt)
    pref = [0]
    for m in keys:
        pref.append(pref[-1] + cnt[m])
    def bot_hours(lo, hi):
        i, j = bisect.bisect_left(keys, lo // 60000), bisect.bisect_left(keys, hi // 60000)
        return (pref[j] - pref[i]) / 60.0
    return sorted(drains), loads, bot_hours


def window_rate(d, lo, hi, thin=0.0):
    drains, loads, bot_hours = d
    ds = [x for x in drains if lo <= x[0] < hi]
    if thin:
        # the skip removes a repeat with probability `thin`: mark repeats first, then drop those
        keep = []
        last = {}
        for x in sorted(ds):
            t, b, f, stop = x
            rep = False
            if stop == 'empty':
                e = last.get(f)
                rep = bool(e and e[1] != b and t - e[0] < 3600_000 and not any(e[0] < tl < t for tl, fl in loads if fl == f))
                last[f] = (t, b)
            if not (rep and random.random() < thin):
                keep.append(x)
        ds = keep
    bh = bot_hours(lo, hi)
    return (repeat_empties(ds, [x for x in loads if lo <= x[0] < hi]) / bh) if bh > 0 else None


def main():
    until = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
    since = until - dt.timedelta(hours=HOURS)
    pools = sorted({os.path.basename(p).split('-')[0] + '-' + os.path.basename(p).split('-')[1] for p in glob.glob('/var/log/mcai/*-*-*')
                    if not os.path.basename(p).startswith('_')})
    data = {}
    for p in pools:
        d = load(p, since, until)
        if sum(1 for x in d[0] if x[3] == 'empty') >= 20:          # a pool whose bots drain (a draw requires it)
            data[p] = d
    names = sorted(data)
    s_ms, u_ms = int(since.timestamp() * 1000), int(until.timestamp() * 1000)
    print(f'pools with drains {len(names)}: {",".join(names)} | history {HOURS:g} h to {until:%m-%d %H:%MZ} | effect {EFFECT} | sims {SIMS}')
    for eff in (EFFECT, 0.0):
        hits = {f: 0 for f in FINALS}
        runs = {f: 0 for f in FINALS}
        for _ in range(SIMS):
            can = random.sample(names, 4)
            for fin in FINALS:
                W = fin * 60000
                if u_ms - s_ms < 2 * W:
                    continue
                t = random.randint(s_ms + W, u_ms - W)
                ok = False
                for read in (180, fin):
                    w = read * 60000
                    pre = {p: window_rate(data[p], t - w, t) for p in names}
                    post = {p: window_rate(data[p], t, t + w, thin=eff if p in can else 0.0) for p in names}
                    ch = {p: (None if pre[p] is None or post[p] is None else post[p] - pre[p]) for p in names}
                    R, lb = lower_bound([ch[p] for p in can], [ch[p] for p in names if p not in can])
                    pc = [pre[p] for p in can]
                    if lb is None or any(x is None for x in pc):
                        continue
                    if lb - BAR_SHARE * sum(pc) / len(pc) >= 0:
                        ok = True
                runs[fin] += 1
                hits[fin] += ok
        print(('POWER (effect %.2f)' % eff if eff else 'NULL  (effect 0)   ') + '  ' + '  '.join(
            f'+180/+{fin}: {hits[fin]}/{runs[fin]} = {hits[fin] / runs[fin]:.2f}' if runs[fin] else f'+{fin}: no history' for fin in FINALS))


if __name__ == '__main__':
    main()
