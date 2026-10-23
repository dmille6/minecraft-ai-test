#!/usr/bin/env python3
"""pull.py -- the 10.0.0.31 side of owner Q8: mirror the structure count (and the newest chest census) from 10.0.0.30 over
the read-only key, so fleetstatus and goalboard can read them here. Cron (mike, hourly at :20; installed by
install-structcount-key.sh --verify --install-cron). Writes ONLY under ~/structcount/in and ~/goalboard/census.

    pull.py [--in ~/structcount/in] [--census-dir ~/goalboard/census] [--key ~/.ssh/id_structcount] [--host mike@10.0.0.30]

The mirror is the same layout the reader (scread.py) reads on 10.0.0.30: in/manifest.json, in/attempts/attempt.json and
in/<gen>/structcount-day.json. Day files are fetched FIRST and kept only if their sha256 matches the manifest; then the
attempt, then the manifest are replaced (atomic renames). So a torn pull reads UNKNOWN or the previous state, never a mix.
The census is fetched only when its name is new, and kept only if it parses as JSON. Exit 0 ok, 1 a fetch failed.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

GEN_RE = re.compile(r'^gen-\d{8}T\d{6}\.\d{3}Z-\d+$')
CENSUS_RE = re.compile(r'^census-goal-\d{8}T\d{4}Z\.json$')


def fetch(req, a):
    r = subprocess.run(['ssh', '-i', a['key'], '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'IdentitiesOnly=yes',
                        a['host'], req], capture_output=True, timeout=120)
    if r.returncode:
        raise RuntimeError('%s: exit %d %s' % (req, r.returncode, r.stderr.decode(errors='replace')[:200]))
    return r.stdout


def put(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp.%d' % os.getpid()
    with open(tmp, 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def pull(a, fetch=fetch):
    ind = os.path.expanduser(a['in'])
    man_b = fetch('manifest', a)
    man = json.loads(man_b)
    att_b = fetch('attempt', a)
    json.loads(att_b)
    for gen in {man.get('generation'), (man.get('last_good') or {}).get('generation')} - {None}:
        if not GEN_RE.match(gen):
            raise RuntimeError('bad generation name %r' % gen)
        want = (man.get('files') or {}).get('structcount-day.json') if gen == man.get('generation') else (man.get('last_good') or {}).get('sha')
        p = os.path.join(ind, gen, 'structcount-day.json')
        if os.path.exists(p) and hashlib.sha256(open(p, 'rb').read()).hexdigest() == want:
            continue
        data = fetch('day ' + gen, a)
        if hashlib.sha256(data).hexdigest() != want:
            raise RuntimeError('%s: the day file does not match the manifest' % gen)
        put(p, data)
    put(os.path.join(ind, 'attempts', 'attempt.json'), att_b)
    put(os.path.join(ind, 'manifest.json'), man_b)
    cd = os.path.expanduser(a['census_dir'])
    name = fetch('census-name', a).decode().strip()
    if CENSUS_RE.match(name) and not os.path.exists(os.path.join(cd, name)):
        data = fetch('census ' + name, a)
        json.loads(data)
        put(os.path.join(cd, name), data)
    return 0


if __name__ == '__main__':
    args = sys.argv[1:]
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    a = {'in': opt('--in', '~/structcount/in'), 'census_dir': opt('--census-dir', '~/goalboard/census'),
         'key': os.path.expanduser(opt('--key', '~/.ssh/id_structcount')), 'host': opt('--host', 'mike@10.0.0.30')}
    try:
        sys.exit(pull(a))
    except Exception as e:
        print('pull failed: %s' % e)
        sys.exit(1)
