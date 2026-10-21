#!/usr/bin/env python3
"""frontierpublish.py -- E0's PUBLISHER: the frontier census's staged bundle -> /var/lib/mcai/_pool-<pool>/
frontier-<home>.g<N>.json (the blueprint link() protocol). Standard library only, self-contained.

It runs as the BOTS' user, never as root (Codex r2 P1: a root process that imports or self-tests code from mike's home
is a root process running mike's code). mike's crontab runs it right after the tick:

    /usr/bin/sudo -n -u mcbot /usr/bin/python3 -B -c "$(cat .../frontierpublish.py)" --state-dir /var/lib/mcai \\
        < .../out/publish/bundle.json

so the program text and the bundle both arrive on mike's side of the boundary (mcbot cannot read /home/mike), and the
only process with mcbot's rights is this one. It writes NOTHING but `frontier-<x>_<y>_<z>.g<N>.json` (and its own
`.tmp`, unlinked) inside an EXISTING `_pool-<pool>` directory, opened relative to a pinned, no-follow /var/lib/mcai
fd; it never creates a directory; it prunes only its own key's generations. Its one line of output (JSON) goes to
mike's publish.log through the cron redirect.

What it publishes is exactly the bundle's entries: the tick writes the bundle every tick with only the towns that are
eligible NOW (shared, one home, not reseeded, instrument checks passed), so a town the census dropped is never
published from an older staging (Codex r2 P1). It refuses the whole bundle when it is stale, not warm, or malformed.
"""
import json
import os
import re
import sys
import time
import datetime as dt

MIN_MS = 60_000
KEEP_GENS = 48
BUNDLE_MAX_AGE_MS = 20 * MIN_MS
MAX_BUNDLE_BYTES = 64 << 20
POOL_RE = re.compile(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
KEY_RE = re.compile(r'^frontier-(-?\d+)_(-?\d+)_(-?\d+)$')
NOT_TOWNS = ('showcase',)
GEN_RE = r'^{key}\.g(\d+)\.json$'


def ms_of(s):
    return int(dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000)


def gen_key(home):
    return f'frontier-{int(home[0])}_{int(home[1])}_{int(home[2])}'


def open_dir(path, dir_fd=None):
    """A directory fd that is NOT a symlink (O_NOFOLLOW | O_DIRECTORY): every later operation is relative to it, so a
    directory swapped for a symlink after this check cannot redirect a write (Codex r1 P1)."""
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)


def _gens(dfd, key):
    rx = re.compile(GEN_RE.format(key=re.escape(key)))
    return sorted(int(m.group(1)) for m in (rx.match(f) for f in os.listdir(dfd)) if m)


def _with_dir(dir_, fn):
    dfd = open_dir(dir_) if isinstance(dir_, str) else os.dup(dir_)
    try:
        return fn(dfd)
    finally:
        os.close(dfd)


def highest_gen(dir_, key):
    return _with_dir(dir_, lambda dfd: (_gens(dfd, key) or [0])[-1])


def create_gen(dir_, key, body, keep=KEEP_GENS, n=None):
    """The blueprint protocol (blueprint.mjs createGen): write a tmp file, link() it to <key>.g<N+1>.json -- link fails
    if the name exists, so exactly one writer wins each N -- then unlink the tmp. -> the generation created, or None.
    dir_ is a path or an open directory fd; everything is relative to one pinned directory fd; the tmp is created
    O_EXCL | O_NOFOLLOW; only this key's generations at or below N - keep are pruned (a single writer under the census
    lock, so no slow writer can re-create a pruned number)."""
    def go(dfd):
        nn = n
        if nn is None:
            g = _gens(dfd, key)
            nn = (g[-1] if g else 0) + 1
        final = f'{key}.g{nn}.json'
        tmp = f'{final}.{os.getpid()}.{os.urandom(4).hex()}.tmp'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=dfd)
        try:
            with os.fdopen(fd, 'w') as f:
                json.dump(body, f, sort_keys=True, default=list)
                f.flush()
                os.fsync(f.fileno())
            try:
                os.link(tmp, final, src_dir_fd=dfd, dst_dir_fd=dfd, follow_symlinks=False)
            except FileExistsError:
                return None
        finally:
            try:
                os.unlink(tmp, dir_fd=dfd)
            except OSError:
                pass
        for old in _gens(dfd, key):
            if old <= nn - keep:
                try:
                    os.unlink(f'{key}.g{old}.json', dir_fd=dfd)
                except OSError:
                    pass
        return nn
    return _with_dir(dir_, go)


def read_gen(dir_, key):
    def go(dfd):
        g = _gens(dfd, key)
        if not g:
            return 0, None
        try:
            fd = os.open(f'{key}.g{g[-1]}.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dfd)
            with os.fdopen(fd) as f:
                return g[-1], json.load(f)
        except (OSError, ValueError):
            return g[-1], None
    return _with_dir(dir_, go)


def publish_refusal(doc, pool, key, now):
    """Why one staged frontier must not be published, or None. Pure."""
    if not isinstance(doc, dict):
        return 'the staged frontier is not an object'
    if not isinstance(pool, str) or not POOL_RE.match(pool) or pool.startswith('self-') or pool in NOT_TOWNS:
        return f'{pool!r} is not a shared-town name'
    if not isinstance(key, str) or not KEY_RE.match(key):
        return f'{key!r} is not a frontier key'
    try:
        if doc.get('pool') != pool or gen_key(doc.get('home') or (0, 0, 0)) != key:
            return 'the staged file names another town'
        if now - ms_of(doc['generated_at']) > BUNDLE_MAX_AGE_MS:
            return f'the staged file is stale ({doc["generated_at"]}): the census has stopped staging'
        if now > ms_of(doc['stale_after']):
            return f'its newest measured hour ended {doc.get("measured_until")}: VOID by its own stale_after'
    except (KeyError, TypeError, ValueError, IndexError) as e:
        return f'malformed staged frontier ({type(e).__name__})'
    if doc.get('instrument_ok') is not True:
        return f'instrument check failed: {doc.get("instrument")}'
    return None


def bundle_refusal(b, now):
    """Why the WHOLE bundle must not be published, or None. Pure."""
    if not isinstance(b, dict) or b.get('schema') != 1 or not isinstance(b.get('entries'), list):
        return 'not a schema-1 bundle'
    try:
        if now - ms_of(b['generated_at']) > BUNDLE_MAX_AGE_MS:
            return f'the bundle is stale ({b["generated_at"]}): the census has stopped ticking'
        w = b.get('warmup') or {}
        if w.get('complete') is not True or now < ms_of(w['complete_at']):
            return f'warm-up not complete (ends {w.get("complete_at")})'
    except (KeyError, TypeError, ValueError) as e:
        return f'malformed bundle ({type(e).__name__})'
    return None


def publish(bundle, state_dir, now, euid=None):
    """bundle -> result dict. Writes only through create_gen into existing _pool-<pool> dirs of state_dir."""
    why = bundle_refusal(bundle, now)
    if why:
        return {'status': 'refused' if 'warm-up' not in why else 'warmup', 'why': why, 'published': 0}
    euid = os.geteuid() if euid is None else euid
    if euid == 0:
        return {'status': 'refused', 'why': 'running as root: the publisher runs as the bots\' user only', 'published': 0}
    pub, refused, same = [], [], 0
    sfd = open_dir(state_dir)
    try:
        for e in bundle['entries']:
            pool, key, doc = (e or {}).get('pool'), (e or {}).get('key'), (e or {}).get('doc')
            why = publish_refusal(doc, pool, key, now)
            if why:
                refused.append(f'{pool}: {why}')
                continue
            try:
                pfd = open_dir(f'_pool-{pool}', dir_fd=sfd)
            except OSError as ex:
                refused.append(f'{pool}: no usable pool dir ({type(ex).__name__}); the publisher never creates one')
                continue
            try:
                if os.fstat(pfd).st_uid != euid:
                    refused.append(f'{pool}: _pool-{pool} is not owned by the publishing user')
                    continue
                n, cur = read_gen(pfd, key)
                if cur and cur.get('digest') == doc.get('digest'):
                    same += 1
                    continue
                try:
                    g = create_gen(pfd, key, doc)
                except OSError as ex:
                    refused.append(f'{pool}: cannot write ({type(ex).__name__}: {ex})')
                    continue
                if g is None:
                    refused.append(f'{pool}: generation {n + 1} was taken by another writer')
                else:
                    pub.append(f'{pool}:g{g}')
            finally:
                os.close(pfd)
    finally:
        os.close(sfd)
    return {'status': 'ok' if not refused else 'partial', 'published': len(pub), 'unchanged': same, 'gens': pub,
            'refused': refused, 'offered': len(bundle['entries'])}


def main(argv):
    state_dir = '/var/lib/mcai'
    if len(argv) >= 2 and argv[0] == '--state-dir':
        state_dir = argv[1]
    now = int(time.time() * 1000)
    out = {'mode': 'publish', 'at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'euid': os.geteuid()}
    try:
        raw = sys.stdin.buffer.read(MAX_BUNDLE_BYTES + 1)
        if len(raw) > MAX_BUNDLE_BYTES:
            out.update(status='refused', why='bundle larger than 64 MB', published=0)
        else:
            out.update(publish(json.loads(raw.decode('utf-8')), state_dir, now))
    except Exception as e:                       # one line, always: the checker reads its age and status
        out.update(status='error', error=f'{type(e).__name__}: {e}'[:300], published=0)
    print(json.dumps(out, sort_keys=True), flush=True)
    return 0 if out.get('status') in ('ok', 'warmup', 'partial') else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
