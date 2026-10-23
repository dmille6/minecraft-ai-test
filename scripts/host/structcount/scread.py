#!/usr/bin/env python3
"""scread.py -- the READER of the structure count's publication (design 2.6). Self-contained: no import from structcount.py,
so a broken instrument cannot make its own reader read healthy.

    scread.py <out-dir> <attempts-dir> [--day YYYY-MM-DD] [--mirror] [--json]

CURRENT status is OK only when manifest.json
  * names the expected day (default: today UTC),
  * names the SAME attempt as the newest recorded attempt (attempts-dir/attempt.json; a later attempt with no manifest of its
    own failed, or is still running),
  * has status OK, and its generation exists with every listed file's sha256 matching.
RUNNING: the newest attempt has no manifest yet, has not recorded its end, and started less than RUNNING_MIN minutes ago.
Anything else is UNKNOWN, with the reason. An older OK generation stays readable as HISTORY through `last_good`.
Exit 0 OK, 1 otherwise.
"""
import datetime as dt
import hashlib
import json
import os
import sys

RUNNING_MIN = 60


def _sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


MIRROR_FILES = ('structcount-day.json',)     # what pull.py mirrors to 10.0.0.31 (the cell list stays on 10.0.0.30)


def status(out_dir, attempts_dir, day=None, now=None, only=None):
    """`only`: check just these listed files (the 10.0.0.31 mirror holds MIRROR_FILES); default every listed file."""
    now = now or dt.datetime.now(dt.timezone.utc)
    day = day or now.strftime('%Y-%m-%d')
    r = {'status': 'UNKNOWN', 'day': day, 'why': None, 'generation': None, 'doc': None, 'totals': None, 'history': None}
    try:
        m = json.load(open(os.path.join(out_dir, 'manifest.json')))
    except Exception as e:
        r['why'] = 'no readable manifest (%s)' % type(e).__name__
        return r
    r['history'] = (m.get('last_good') or {}).get('generation')
    try:
        a = json.load(open(os.path.join(attempts_dir, 'attempt.json')))
    except Exception as e:
        r['why'] = 'no recorded attempt (%s)' % type(e).__name__
        return r
    if a.get('attempt') != m.get('attempt'):
        try:
            started = dt.datetime.fromisoformat(a['started'])
            age = (now - started).total_seconds() / 60
        except Exception:
            age = None
        if not a.get('ended') and age is not None and 0 <= age < RUNNING_MIN:
            r['status'] = 'RUNNING'
            r['why'] = 'attempt %s started %.0f min ago' % (a.get('attempt'), age)
        else:
            r['why'] = 'attempt %s has no manifest (the manifest is attempt %s)' % (a.get('attempt'), m.get('attempt'))
        return r
    if m.get('day') != day:
        r['why'] = 'stale manifest (day %s, want %s)' % (m.get('day'), day)
        return r
    if m.get('status') != 'OK':
        r['why'] = m.get('why') or 'status %s' % m.get('status')
        return r
    g = os.path.join(out_dir, m.get('generation') or '')
    for f, h in (m.get('files') or {}).items():
        if only is not None and f not in only:
            continue
        p = os.path.join(g, f)
        if not os.path.exists(p) or _sha(p) != h:
            r['why'] = 'hash mismatch: %s' % f
            return r
    if 'structcount-day.json' not in (m.get('files') or {}):
        r['why'] = 'the manifest lists no day file'
        return r
    r.update(status='OK', generation=m['generation'], totals=m.get('totals'),
             doc=json.load(open(os.path.join(g, 'structcount-day.json'))))
    return r


if __name__ == '__main__':
    args = sys.argv[1:]
    day = args[args.index('--day') + 1] if '--day' in args else None
    res = status(args[0], args[1], day, only=MIRROR_FILES if '--mirror' in args else None)
    if '--json' in args:
        print(json.dumps({k: v for k, v in res.items() if k != 'doc'}))
    else:
        print(res['status'], res['generation'] or '', res['why'] or '', ('totals %s' % res['totals']) if res['totals'] else '')
    sys.exit(0 if res['status'] == 'OK' else 1)
