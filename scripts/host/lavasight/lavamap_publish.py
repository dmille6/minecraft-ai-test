#!/usr/bin/env python3
"""lavasight-01: publish one `lava-map.json` per pool directory from the per-seed hazard map.

    sudo -n -u mcbot python3 -B lavamap_publish.py publish --map ~mike/hazardmap/out/hazardmap.json --root /var/lib/mcai
    python3 -B lavamap_publish.py plan --map ... --root ...        # what it would write, writes nothing
    python3 -B lavamap_publish.py check --root ...                 # one header line: OK, or LAVAMAP ALARM: <why>

Rules (docs/reports/lavasight-01-design-2026-10-24.md 2.1):
- the map: schema `mcai.hazardmap`, schema_version 1, not past `stale_after` -> else exit 3 and write NOTHING (the bots'
  own staleness rule then fails them open at the old file's stale_after);
- per world W of `seeds[s].worlds` whose `<root>/_pool-W` directory exists (never created, never a symlink): the per-world
  view of hazardmap report 7 -- lava hazards not `absent` in W, `sightings.cells` + `deaths.cells`, deduplicated, ranked by
  the hazard's deaths, then the cell's sighting rows, at most 4096; warn-only hazards (drowning, cave_fall, dripstone) with a
  death, not absent in W, ranked by deaths, at most 256;
- written as a temp file in the same directory, fsync, rename; a byte-identical file is left alone;
- never as root.
"""
import argparse, hashlib, json, os, sys, tempfile, time

SCHEMA, VERSION = 'mcai.lavamap', 1
MAP_SCHEMA, MAP_VERSION = 'mcai.hazardmap', 1
MAX_CELLS, MAX_WARN = 4096, 256
WARN_KINDS = ('drowning', 'cave_fall', 'dripstone')
FILE = 'lava-map.json'
HEARTBEAT = 'lavamap-publish.json'


class Refuse(Exception):
    pass


def parse_iso(s):
    import datetime
    return datetime.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()


def iso(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


def check_map(m, now):
    if not isinstance(m, dict) or m.get('schema') != MAP_SCHEMA:
        raise Refuse('map schema %r' % (m.get('schema') if isinstance(m, dict) else type(m).__name__))
    if m.get('schema_version') != MAP_VERSION:
        raise Refuse('map schema_version %r' % m.get('schema_version'))
    try:
        stale = parse_iso(m['stale_after'])
    except Exception:
        raise Refuse('map stale_after unreadable')
    if now > stale:
        raise Refuse('map stale since %s' % m['stale_after'])
    if not isinstance(m.get('seeds'), dict) or not m['seeds']:
        raise Refuse('map has no seeds')
    for s in m['seeds']:
        if not isinstance(s, str) or not s.lstrip('-').isdigit():
            raise Refuse('seed key %r is not a decimal string' % (s,))


def _state(h, world):
    return (((h.get('exists') or {}).get('by_world') or {}).get(world) or {}).get('state')


def _cell(c):
    return isinstance(c, list) and len(c) >= 3 and all(isinstance(v, int) and not isinstance(v, bool) for v in c[:3])


def world_view(m, world):
    """-> (seed, cells, warn) for one world, or (None, [], []) when no seed lists it. Pure."""
    for seed, s in m['seeds'].items():
        if world not in (s.get('worlds') or {}):
            continue
        ranked = []   # (-deaths, -rows, x, y, z)
        warn = []
        for h in s.get('hazards') or []:
            if _state(h, world) == 'absent':
                continue
            deaths = int(((h.get('deaths') or {}).get('total')) or 0)
            if h.get('kind') == 'lava':
                for c in (h.get('sightings') or {}).get('cells') or []:
                    if _cell(c):
                        rows = c[3] if len(c) > 3 and isinstance(c[3], int) else 0
                        ranked.append((-deaths, -rows, c[0], c[1], c[2]))
                for c in (h.get('deaths') or {}).get('cells') or []:
                    if _cell(c):
                        ranked.append((-deaths, 0, c[0], c[1], c[2]))
            elif h.get('kind') in WARN_KINDS and deaths > 0 and _cell(h.get('center')):
                warn.append((-deaths, h['kind'], h['center'][:3]))
        ranked.sort()
        seen, cells = set(), []
        for _, _, x, y, z in ranked:
            if (x, y, z) in seen:
                continue
            seen.add((x, y, z))
            cells.append([x, y, z])
            if len(cells) >= MAX_CELLS:
                break
        warn.sort(key=lambda w: (w[0], w[1], w[2]))
        return seed, cells, [{'kind': k, 'center': c, 'deaths': -d} for d, k, c in warn[:MAX_WARN]]
    return None, [], []


def build_file(m, world, map_sha):
    """-> dict | None. Pure (no clock: published_at is the map's generated_at, so a re-run is byte-identical)."""
    seed, cells, warn = world_view(m, world)
    if seed is None:
        return None
    return {'schema': SCHEMA, 'schema_version': VERSION, 'world': world, 'seed': seed,
            'generated_at': m.get('generated_at'), 'stale_after': m['stale_after'],
            'source': {'map_sha256': map_sha, 'map_generated_at': m.get('generated_at')},
            'cells': cells, 'warn': warn}


def dumps(d):
    return (json.dumps(d, sort_keys=True, separators=(',', ':')) + '\n').encode()


def plan(m, root, map_sha):
    """-> [(world, path, bytes | None, why)]. Pure over the directory listing."""
    out = []
    worlds = sorted({w for s in m['seeds'].values() for w in (s.get('worlds') or {})})
    for w in worlds:
        d = os.path.join(root, '_pool-' + w)
        if os.path.islink(d):
            out.append((w, d, None, 'pool dir is a symlink'))
            continue
        if not os.path.isdir(d):
            out.append((w, d, None, 'no pool dir'))
            continue
        f = build_file(m, w, map_sha)
        out.append((w, os.path.join(d, FILE), dumps(f) if f else None, 'ok' if f else 'no seed'))
    return out


def write_atomic(path, data):
    d = os.path.dirname(path)
    if os.path.islink(path):
        raise Refuse('target is a symlink: %s' % path)
    try:
        with open(path, 'rb') as fh:
            if fh.read() == data:
                return False
    except FileNotFoundError:
        pass
    fd, tmp = tempfile.mkstemp(prefix='.lava-map.', suffix='.tmp', dir=d)
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.rename(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return True


def publish(map_path, root, now=None, heartbeat=None):
    now = time.time() if now is None else now
    if os.geteuid() == 0:
        raise Refuse('refusing to run as root')
    raw = open(map_path, 'rb').read()
    m = json.loads(raw)
    check_map(m, now)
    sha = hashlib.sha256(raw).hexdigest()
    res = {'at': iso(now), 'map_generated_at': m.get('generated_at'), 'stale_after': m['stale_after'], 'written': [],
           'same': [], 'skipped': {}}
    for w, path, data, why in plan(m, root, sha):
        if data is None:
            res['skipped'][w] = why
            continue
        (res['written'] if write_atomic(path, data) else res['same']).append(w)
    res['status'] = 'ok'
    if heartbeat:
        write_atomic(heartbeat, dumps(res))
    return res


def check(root, now=None, heartbeat=None):
    """The fleetstatus header line -> (ok, line). Every pool's file must parse and be inside its stale_after."""
    now = time.time() if now is None else now
    bad = []
    n = 0
    for name in sorted(os.listdir(root)):
        if not name.startswith('_pool-') or '.pre-reseed-' in name or name.startswith('_pool-self-'):
            continue
        p = os.path.join(root, name, FILE)
        try:
            d = json.load(open(p))
        except FileNotFoundError:
            bad.append('%s:absent' % name[6:])
            continue
        except Exception:
            bad.append('%s:unreadable' % name[6:])
            continue
        n += 1
        try:
            if now > parse_iso(d['stale_after']):
                bad.append('%s:stale' % name[6:])
        except Exception:
            bad.append('%s:stale_after' % name[6:])
    if bad:
        return False, 'LAVAMAP ALARM: %d of %d pool files bad: %s' % (len(bad), len(bad) + n, ', '.join(bad[:6]))
    return True, 'lavamap OK: %d pool files inside stale_after' % n


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['publish', 'plan', 'check'])
    ap.add_argument('--map', default=os.path.expanduser('~/hazardmap/out/hazardmap.json'))
    ap.add_argument('--root', default='/var/lib/mcai')
    ap.add_argument('--heartbeat', default=None)
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'check':
            ok, line = check(a.root)
            print(line)
            return 0 if ok else 1
        if a.cmd == 'plan':
            raw = open(a.map, 'rb').read()
            m = json.loads(raw)
            check_map(m, time.time())
            for w, path, data, why in plan(m, a.root, hashlib.sha256(raw).hexdigest()):
                d = json.loads(data) if data else None
                print('%-12s %-6s %s' % (w, why, ('cells=%d warn=%d %s' % (len(d['cells']), len(d['warn']), path)) if d else path))
            return 0
        r = publish(a.map, a.root, heartbeat=a.heartbeat)
        print(json.dumps(r, sort_keys=True))
        return 0
    except Refuse as e:
        print('lavamap_publish refused: %s' % e, file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
