#!/usr/bin/env python3
"""Pre-deploy guard: will the pools we are about to draw ACTUALLY EXPOSE the change?

    drawexposure.py <run_id> [--hours 6] [--registrations DIR] [--pools a,b]

`drawrec.sh` bands pools on activity and then applies ONE hard-coded exposure filter --
">= 20 entombed+marooned rows OR >= 8 livelock_escape rows in the prior 3 h" -- written for
recovery-ladder-01 and reused unchanged for every canary since. It is a fine filter for an
escape-ladder change and blind to everything else.

recovery-ladder-13c is what that costs. It drew board-b,hive-b, which were rich in livelock
and climb rows and had, in their own 180-min pre-window, ZERO deaths and 2 sealed pockets.
Both halves of the bundle need exposure the filter never looked at:

    -13a pocket rung  needs a SEALED POCKET   (`_drowning_ceiling_no_air`, detail ~ "sealed")
    -13b death sites  needs a DEATH           (`_death`) -- no death, no death site, so the
                                               priced-route machinery cannot act at all

At +360 the canary had 60 bot-h, 0 deaths, 0 sealed verdicts, 0 rung rows, 0
`death_site_recorded`, 0 `route_crossed`, 0 `target_skipped`. Not a null result -- no
measurement was possible. The exposure interlock (Codex audit 2026-09-11) already asks for
this check before the deploy; nothing implemented it.

So the requirement comes from the RUN'S OWN REGISTRATION, not from this file:

    "draw_exposure": {
      "hours": 6,
      "require": [
        {"name": "sealed pocket", "kind": "drowning_ceiling_no_air",
         "detail_contains": "sealed", "min": 2},
        {"name": "death",         "kind": "death", "min": 1}
      ]
    }

Every requirement must be met by a pool for it to be eligible: for a bundle, a half that
cannot be exposed makes the whole canary unmeasurable. Exit 0 if at least two pools qualify,
2 otherwise.
"""
import argparse, collections, glob, gzip, json, os, sys, datetime as dt

MCAI = '/var/log/mcai'


def pools():
    return sorted({os.path.basename(p.rstrip('/')).rsplit('-', 1)[0]
                   for p in glob.glob(f'{MCAI}/*-*/')})


def scan(lo_iso, hi_iso):
    """(pool -> kind -> [details]) plus totals, over the window."""
    days = {lo_iso[:10], hi_iso[:10]}
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    bots, rows, kinds = set(), 0, set()
    for f in glob.glob(f'{MCAI}/*-*/skill-*.jsonl') + glob.glob(f'{MCAI}/*-*/skill-*.jsonl-*.gz'):
        pool = os.path.basename(os.path.dirname(f)).rsplit('-', 1)[0]
        op = gzip.open if f.endswith('.gz') else open
        try:
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    if not any(d in l[:60] for d in days):
                        continue
                    try:
                        r = json.loads(l)
                    except ValueError:
                        continue
                    ts = r.get('@timestamp', '')
                    if not (lo_iso <= ts[:19] <= hi_iso):
                        continue
                    sk = r.get('skill') or {}
                    k = (sk.get('name') or '').lstrip('_')   # logEvent kind 'x' -> skill.name '_x'
                    rows += 1; kinds.add(k); bots.add((r.get('bot') or {}).get('name', ''))
                    per[pool][k].append(sk.get('detail') or '')
        except Exception:
            pass          # one unreadable file must not silently empty the whole read
    return per, bots, rows, kinds


def count(per, pool, req):
    kind = req['kind'].lstrip('_')
    dets = per.get(pool, {}).get(kind, [])
    needle = req.get('detail_contains')
    if needle:
        dets = [d for d in dets if needle in d]
    return len(dets)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_id')
    ap.add_argument('--hours', type=float, default=None)
    ap.add_argument('--registrations', default=os.path.expanduser('~/mcai-analysis/registrations'))
    ap.add_argument('--pools', default=None, help='restrict to these pools (comma separated)')
    a = ap.parse_args()

    p = os.path.join(a.registrations, f'{a.run_id}.json')
    if not os.path.exists(p):
        p = f'/tmp/registrations/{a.run_id}.json'
    reg = json.load(open(p))

    de = reg.get('draw_exposure')
    if not de:
        print(f'{a.run_id} declares no draw_exposure block — this guard cannot vouch for the '
              f'draw. Declare one, or accept the v8 livelock/climb filter knowingly.')
        return 0

    hours = a.hours if a.hours is not None else de.get('hours', 6)
    now = dt.datetime.now(dt.timezone.utc)
    lo_iso = (now - dt.timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%S')
    hi_iso = now.strftime('%Y-%m-%dT%H:%M:%S')

    per, bots, rows, kinds = scan(lo_iso, hi_iso)

    print(f'exposure window {lo_iso}Z .. {hi_iso}Z ({hours:g} h)')
    print(f'positive control: {rows} rows, {len(bots)} bots, {len(kinds)} distinct row kinds')
    if rows == 0 or len(bots) < 40 or len(kinds) < 20:
        print('REFUSED: the exposure read found too little to prove anything — an instrument '
              'failure, not an eligible fleet')
        return 2

    reqs = de['require']
    cand = [x.strip() for x in a.pools.split(',')] if a.pools else pools()
    cand = [p for p in cand if p != 'placebo-c' and not p.startswith('isolated')]

    hdr = f"{'pool':12s}" + ''.join(f"{r['name'][:18]:>20s}" for r in reqs) + '   eligible'
    print('\n' + hdr)
    ok = []
    for pool in cand:
        cells, passing = [], True
        for r in reqs:
            n = count(per, pool, r)
            if n < r['min']:
                passing = False
            cells.append(f"{n:>13d}/{r['min']:<6d}")
        if passing:
            ok.append(pool)
        print(f'{pool:12s}' + ''.join(cells) + f"   {'YES' if passing else 'no'}")

    print(f"\neligible on exposure: {ok or 'NONE'}")
    for r in reqs:
        print(f"  requirement '{r['name']}': kind={r['kind']}"
              + (f", detail~'{r['detail_contains']}'" if r.get('detail_contains') else '')
              + f", min {r['min']} per pool in {hours:g} h")
    if len(ok) < 2:
        print(f'\nREFUSED: {len(ok)} pool(s) can expose this change; two are needed. Drawing '
              f'anyway buys a canary that cannot measure its own mechanism.')
        return 2
    print('\nat least two pools can expose the change')
    return 0


if __name__ == '__main__':
    sys.exit(main())
