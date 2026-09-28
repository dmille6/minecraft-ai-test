#!/usr/bin/env python3
"""THE GROWTH READ for plant-20260927. Reads the recorded planting coordinate in
each world and asks what is there now.

The instrument is the coordinate, not a rate: a cell that still holds a sapling
did not grow; a cell holding a log did. Nothing here writes to a world --
`execute if` and `execute if loaded` are pure tests, and the only reason to use
`if loaded` is that an unloaded chunk fails EVERY block test, which would read as
"the sapling is gone" and is the cheap-negative this project keeps buying.

    ./plantgrow.py /home/mike/plant-cohort.tsv [--min-age-min 180]
"""
import argparse, collections, csv, datetime as dt, importlib.util, sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("pt", Path("/home/mike/scripts/place-town.py"))
_pt = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_pt)
Rcon, ROOT = _pt.Rcon, _pt.ROOT

TESTS = [('sapling', '#minecraft:saplings'), ('log', '#minecraft:logs'),
         ('leaves', '#minecraft:leaves'), ('air', 'air'),
         ('dirt', '#minecraft:dirt'), ('water', 'water')]

def props(pool):
    p = ROOT / pool / "server.properties"
    conf = dict(l.split("=", 1) for l in p.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    return int(conf["rcon.port"]), conf["rcon.password"].strip()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv"); ap.add_argument("--min-age-min", type=int, default=180)
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    rows = list(csv.DictReader(open(a.tsv), delimiter='\t'))
    by_pool = collections.defaultdict(list)
    for r in rows:
        age = (now - dt.datetime.fromisoformat(r['ts'])).total_seconds() / 60
        r['age_min'] = age
        by_pool[r['pool']].append(r)
    print(f"cohort {len(rows)} plantings / {len(by_pool)} pools; now {now:%Y-%m-%dT%H:%M:%SZ}; "
          f"reporting the >={a.min_age_min} min cohort separately\n")

    out, unreadable = [], 0
    for pool in sorted(by_pool):
        port, pw = props(pool)
        try:
            rc = Rcon("127.0.0.1", port, pw)
        except SystemExit as e:
            print(f"{pool}: RCON FAILED ({e}) -- {len(by_pool[pool])} plantings UNREAD"); continue
        # POSITIVE CONTROL per world, and the FIRST version of this was wrong: it
        # probed by_pool[pool][0] unconditionally, and that cell is often in an
        # unloaded chunk, so three worlds read "control=FAILED" when the channel was
        # answering perfectly. A control that fails for its own reasons is worse than
        # none, because the next reader takes it as evidence about the instrument.
        # Now: walk until a cell reports LOADED, then demand the channel answer two
        # different questions about THAT cell differently. If no cohort cell in the
        # world is loaded, say so -- that is not a failure either.
        ctl = 'no cohort cell loaded'
        for probe in by_pool[pool]:
            pos = f"{probe['x']} {probe['y']} {probe['z']}"
            if 'passed' not in rc.run(f"execute if loaded {pos}").lower():
                continue
            neg = 'passed' not in rc.run(f"execute if block {pos} bedrock").lower()
            any_hit = any('passed' in rc.run(f"execute if block {pos} {b}").lower()
                          for _, b in TESTS)
            ctl = 'OK' if (neg and any_hit) else 'CHANNEL SUSPECT'
            break
        for r in by_pool[pool]:
            pos = f"{r['x']} {r['y']} {r['z']}"
            if 'passed' not in rc.run(f"execute if loaded {pos}").lower():
                r['now'] = 'UNLOADED'; unreadable += 1; out.append(r); continue
            r['now'] = 'other'
            for label, blk in TESTS:
                if 'passed' in rc.run(f"execute if block {pos} {blk}").lower():
                    r['now'] = label; break
            out.append(r)
        mix = collections.Counter(x['now'] for x in by_pool[pool])
        print(f"{pool:<11} n={len(by_pool[pool]):>3}  control={ctl:<20} {dict(mix)}")

    print()
    for label, sub in (("ALL", out),
                       (f">={a.min_age_min}min", [r for r in out if r['age_min'] >= a.min_age_min])):
        if not sub: print(f"{label}: empty"); continue
        mix = collections.Counter(r['now'] for r in sub)
        read = [r for r in sub if r['now'] != 'UNLOADED']
        grew = sum(1 for r in read if r['now'] in ('log', 'leaves'))
        still = sum(1 for r in read if r['now'] == 'sapling')
        print(f"{label}: n={len(sub)}  readable={len(read)}  {mix.most_common()}")
        if read:
            print(f"   GREW (log/leaves) {grew}/{len(read)} = {100*grew/len(read):.2f}%   "
                  f"STILL A SAPLING {still}/{len(read)} = {100*still/len(read):.1f}%   "
                  f"GONE (air) {mix['air']}")
        # depth split: the light hypothesis
        for lo, hi, name in ((-64, 55, 'y<55 (underground)'), (55, 200, 'y>=55 (surface)')):
            s = [r for r in read if lo <= int(r['y']) < hi]
            if s:
                g = sum(1 for r in s if r['now'] in ('log', 'leaves'))
                print(f"   {name}: n={len(s)} grew {g} ({100*g/len(s):.1f}%) "
                      f"still {sum(1 for r in s if r['now']=='sapling')}")
        print()
    if unreadable:
        print(f"NOTE: {unreadable} coordinates were in UNLOADED chunks and are excluded from "
              f"every rate above -- an unloaded chunk fails every block test.")
    w = csv.DictWriter(open('/home/mike/plant-growth.tsv', 'w', newline=''), delimiter='\t',
                       fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)
    print("per-planting detail: /home/mike/plant-growth.tsv")

main()
