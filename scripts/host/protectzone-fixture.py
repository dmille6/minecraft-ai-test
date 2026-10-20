#!/usr/bin/env python3
"""protectzone-01 BENCH FIXTURE (draft for the coordinator; never run by an agent on the bench).

The bench has no village, so a protectzone-01 canary is exposed only where a pool's directory holds a zone file. This writes
ONE zone per town -- a strip of ground every bot crosses -- into /var/lib/mcai/_pool-<pool>/protected-zones.json:

    box = [home.x + 20, -64, home.z - 10, home.x + 44, home.y + 24, home.z + 10]   (25 x 21 columns, east of town, just
          outside townzone's square of 16, the whole column like the showcase's villages)

It is DATA: the control build never reads the file (a fleet sha without protectzone.mjs has no reader), so installing it on
EVERY drawable pool before a launch keeps the arms comparable (difference-in-differences: same ground, only the canary
honours it). `--remove` takes it away again (and is the rollback of the data on its own).

  protectzone-fixture.py --dry-run                 print the zone each pool would get (reads the env files only)
  sudo protectzone-fixture.py --install [--pools a,b]
  sudo protectzone-fixture.py --remove  [--pools a,b]
"""
import argparse, glob, json, os, sys

ENVDIR = os.environ.get('PZ_ENVDIR', '/srv/mcbots/harness/env')
POOLROOT = os.environ.get('PZ_POOLROOT', '/var/lib/mcai')
NAME = 'protected-zones.json'


def homes():
    out = {}
    for f in sorted(glob.glob(os.path.join(ENVDIR, '*.env'))):
        bot = os.path.basename(f)[:-4]
        pool = '-'.join(bot.split('-')[:2])
        try:
            kv = dict(l.strip().split('=', 1) for l in open(f) if '=' in l and not l.startswith('#'))
            h = (int(float(kv['HOME_X'])), int(float(kv['HOME_Y'])), int(float(kv['HOME_Z'])))
        except Exception:
            continue
        if kv.get('MEMORY_POOL', pool) != pool:
            continue
        out.setdefault(pool, set()).add(h)
    return out


def zone_for(pool, h):
    hx, hy, hz = h
    return {'version': 1, 'world': pool, 'policy': 'protectzone-01 bench fixture (not scenery: a strip every bot crosses)',
            'zones': [{'id': f'fixture-{pool}', 'kind': 'fixture', 'label': f'the {pool} test strip',
                       'box': [hx + 20, -64, hz - 10, hx + 44, hy + 24, hz + 10]}]}


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--dry-run', action='store_true'); g.add_argument('--install', action='store_true'); g.add_argument('--remove', action='store_true')
    ap.add_argument('--pools')
    a = ap.parse_args()
    hs = homes()
    if not hs:
        sys.exit('ZERO LOOKS WRONG: no bot env files with a home under %s' % ENVDIR)
    want = set(a.pools.split(',')) if a.pools else set(hs)
    for pool in sorted(want):
        hset = hs.get(pool)
        if not hset or len(hset) != 1:
            print('SKIP %s: homes %s (needs exactly one)' % (pool, sorted(hset or [])))
            continue
        d = os.path.join(POOLROOT, '_pool-' + pool)
        f = os.path.join(d, NAME)
        if a.remove:
            if os.path.exists(f):
                os.remove(f); print('removed', f)
            continue
        doc = zone_for(pool, next(iter(hset)))
        if a.dry_run:
            print(pool, doc['zones'][0]['box'], '->', f)
            continue
        if not os.path.isdir(d):
            print('SKIP %s: no pool dir %s' % (pool, d)); continue
        tmp = f + '.tmp'
        with open(tmp, 'w') as fh:
            json.dump(doc, fh, indent=1)
        st = os.stat(d)
        os.chown(tmp, st.st_uid, st.st_gid); os.chmod(tmp, 0o644)
        os.replace(tmp, f)   # atomic: a bot never reads half a file
        print('installed', f, doc['zones'][0]['box'])


if __name__ == '__main__':
    main()
