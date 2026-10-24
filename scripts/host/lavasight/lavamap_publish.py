#!/usr/bin/env python3
"""lavasight-01: publish one `lava-map.json` per pool directory from the per-seed hazard map.

    sudo -n -u mcbot python3 -B lavamap_publish.py publish --map /home/mike/hazardmap/out/hazardmap.json \
        --hazard-heartbeat /home/mike/hazardmap/out/heartbeat.json --root /var/lib/mcai --heartbeat <file>
    python3 -B lavamap_publish.py plan --map ... --root ...        # what it would write; writes nothing
    python3 -B lavamap_publish.py check --root ...                 # one header line: lavamap OK, or LAVAMAP ALARM: <why>

Rules (docs/reports/lavasight-01-design-2026-10-24.md r2, 2.1):
- TRIGGERED BY A GOOD REFRESH (Claude design r1 R5): it publishes only when the hazard map's own heartbeat says `ok` for
  the map's `generated_at`; otherwise it writes nothing and exits 0 (a later run picks the refresh up). Run hourly.
- the map: schema `mcai.hazardmap`, schema_version 1, not past `stale_after` -> else exit 3 and write NOTHING (the bots'
  own staleness rule then fails them open at the old file's stale_after);
- per world W of `seeds[s].worlds` whose `<root>/_pool-W` directory exists (never created, never a symlink): the per-world
  view of hazardmap report 7 -- lava hazards not `absent` in W, `sightings.cells` (most-seen first) then `deaths.cells`,
  deduplicated, at most 4096. No other kind is delivered (design r2 2.2);
- written as a temp file in the same directory, fsync, rename; a byte-identical file is left alone (the file carries no
  clock of its own, so a re-run of the same map is byte-identical);
- never as root.
"""
import argparse, datetime, hashlib, json, os, sys, tempfile, time

SCHEMA, VERSION = 'mcai.lavamap', 1
MAP_SCHEMA, MAP_VERSION = 'mcai.hazardmap', 1
MAX_CELLS = 4096
FILE = 'lava-map.json'


class Refuse(Exception):
    pass


def parse_iso(s):
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


def refresh_ok(m, hb):
    """Did the hazard map's own refresh finish `ok` for THIS map? -> (bool, why). Pure."""
    if not isinstance(hb, dict):
        return False, 'no hazardmap heartbeat'
    if hb.get('status') != 'ok':
        return False, 'hazardmap heartbeat status %r' % hb.get('status')
    try:
        if abs(parse_iso(hb['at']) - parse_iso(m['generated_at'])) > 120:
            return False, 'heartbeat %s is not this map (%s)' % (hb.get('at'), m.get('generated_at'))
    except Exception:
        return False, 'heartbeat or map time unreadable'
    return True, 'ok'


def _state(h, world):
    return (((h.get('exists') or {}).get('by_world') or {}).get(world) or {}).get('state')


def _cell(c):
    return isinstance(c, list) and len(c) >= 3 and all(isinstance(v, int) and not isinstance(v, bool) for v in c[:3])


def world_view(m, world):
    """-> (seed, cells) for one world, or (None, []) when no seed lists it. Pure.

    Lava hazards not `absent` in the world. SIGHTING cells first (each names a lava cell a guard refused), most-seen first;
    then death cells (where a bot died: mostly not lava itself, so the bot's live re-read drops most; Claude design r1
    P3-3); deduplicated; at most MAX_CELLS.
    """
    for seed, s in m['seeds'].items():
        if world not in (s.get('worlds') or {}):
            continue
        sight, death = [], []
        for h in s.get('hazards') or []:
            if h.get('kind') != 'lava' or _state(h, world) == 'absent':
                continue
            deaths = int(((h.get('deaths') or {}).get('total')) or 0)
            for c in (h.get('sightings') or {}).get('cells') or []:
                if _cell(c):
                    rows = c[3] if len(c) > 3 and isinstance(c[3], int) else 0
                    sight.append((-rows, -deaths, c[0], c[1], c[2]))
            for c in (h.get('deaths') or {}).get('cells') or []:
                if _cell(c):
                    death.append((-deaths, 0, c[0], c[1], c[2]))
        seen, cells = set(), []
        for _, _, x, y, z in sorted(sight) + sorted(death):
            if (x, y, z) in seen:
                continue
            seen.add((x, y, z))
            cells.append([x, y, z])
            if len(cells) >= MAX_CELLS:
                break
        return seed, cells
    return None, []


def build_file(m, world, map_sha):
    """-> dict | None. Pure (no clock of its own: a re-run of the same map is byte-identical)."""
    seed, cells = world_view(m, world)
    if seed is None:
        return None
    return {'schema': SCHEMA, 'schema_version': VERSION, 'world': world, 'seed': seed,
            'generated_at': m.get('generated_at'), 'stale_after': m['stale_after'],
            'source': {'map_sha256': map_sha, 'map_generated_at': m.get('generated_at')},
            'cells': cells}


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
        # the rename itself durable too (Claude r2 P3-8)
        dfd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return True


def publish(map_path, root, hazard_heartbeat, now=None, heartbeat=None, euid=None):
    """The hazard map's heartbeat is REQUIRED (Codex r2 P2): no heartbeat, or one that is not `ok` for this map, writes nothing."""
    if not hazard_heartbeat:
        raise Refuse('the hazardmap heartbeat path is required')
    raw = open(map_path, 'rb').read()
    try:
        hb = json.load(open(hazard_heartbeat))
    except Exception:
        hb = None
    return publish_bytes(raw, hb, root, now=now, heartbeat=heartbeat, euid=euid)


def publish_bytes(raw, hb, root, now=None, heartbeat=None, euid=None):
    """The publisher's core over the map's BYTES and the parsed heartbeat (None = missing): the cron's stdin path sends both,
    because mcbot cannot read /home/mike (the frontier publisher's pattern)."""
    now = time.time() if now is None else now
    if (os.geteuid() if euid is None else euid) == 0:
        raise Refuse('refusing to run as root')
    m = json.loads(raw)
    check_map(m, now)
    ok, why = refresh_ok(m, hb)
    if not ok:
        return {'at': iso(now), 'status': 'waiting', 'why': why, 'written': [], 'same': [], 'skipped': {}}
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


def check(root, now=None, worlds=None):
    """The fleetstatus header line -> (ok, line). Every pool directory whose world the map lists (`worlds`; all `_pool-*`
    directories when None) must hold a file that parses and is inside its stale_after. Zero pools examined is an alarm
    (Codex r2 P2: an OK over nothing is a blind check), and the total is the pools examined, each counted once."""
    now = time.time() if now is None else now
    bad, good, skipped = [], 0, []
    for name in sorted(os.listdir(root)):
        if not name.startswith('_pool-') or '.pre-reseed-' in name or name.startswith('_pool-self-'):
            continue
        w = name[len('_pool-'):]
        if worlds is not None and w not in worlds:
            skipped.append(w)
            continue
        p = os.path.join(root, name, FILE)
        try:
            d = json.load(open(p))
        except FileNotFoundError:
            bad.append('%s:absent' % w)
            continue
        except Exception:
            bad.append('%s:unreadable' % w)
            continue
        try:
            if now > parse_iso(d['stale_after']):
                bad.append('%s:stale' % w)
                continue
        except Exception:
            bad.append('%s:stale_after' % w)
            continue
        good += 1
    total = good + len(bad)
    if total == 0:
        return False, 'LAVAMAP ALARM: no pool directory examined under %s' % root
    if bad:
        return False, 'LAVAMAP ALARM: %d of %d pool files bad: %s' % (len(bad), total, ', '.join(bad[:6]))
    return True, 'lavamap OK: %d of %d pool files inside stale_after%s' % (good, total, ('; not on the map: ' + ','.join(skipped)) if skipped else '')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['publish', 'publish-stdin', 'plan', 'check'])
    ap.add_argument('--map', default=os.path.expanduser('~/hazardmap/out/hazardmap.json'))
    ap.add_argument('--hazard-heartbeat', default=os.path.expanduser('~/hazardmap/out/heartbeat.json'))
    ap.add_argument('--root', default='/var/lib/mcai')
    ap.add_argument('--heartbeat', default=None)
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'check':
            worlds = None
            try:
                worlds = {w for s in json.load(open(a.map))['seeds'].values() for w in (s.get('worlds') or {})}
            except Exception:
                pass
            ok, line = check(a.root, worlds=worlds)
            print(line)
            return 0 if ok else 1
        if a.cmd == 'plan':
            raw = open(a.map, 'rb').read()
            m = json.loads(raw)
            check_map(m, time.time())
            for w, path, data, why in plan(m, a.root, hashlib.sha256(raw).hexdigest()):
                d = json.loads(data) if data else None
                print('%-12s %-12s %s' % (w, why, ('cells=%d %s' % (len(d['cells']), path)) if d else path))
            return 0
        if a.cmd == 'publish-stdin':
            # after the program text (lavamap-cron.sh's BOOT): one line with the map's byte count, the map, then the heartbeat
            b = sys.stdin.buffer
            n = int(b.readline())
            raw = b.read(n)
            if len(raw) != n:
                raise Refuse('short map on stdin: %d of %d bytes' % (len(raw), n))
            try:
                hb = json.loads(b.read() or b'null')
            except Exception:
                hb = None
            r = publish_bytes(raw, hb, a.root, heartbeat=a.heartbeat)
        else:
            r = publish(a.map, a.root, hazard_heartbeat=a.hazard_heartbeat, heartbeat=a.heartbeat)
        print(json.dumps(r, sort_keys=True))
        return 0
    except Refuse as e:
        print('lavamap_publish refused: %s' % e, file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
