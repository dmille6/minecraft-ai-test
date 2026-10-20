#!/usr/bin/env python3
"""Paper stream (mcai-mc-paper) vs the Paper logs on 10.0.0.30, around the 2026-10-19 flood.

Two halves, because the files and the read-only key live on different hosts:

    # on 10.0.0.30 (read-only; the files are small):
    python3 paper-flood-check.py dump --day 2026-10-19 > paper-lines.jsonl
    # on 10.0.0.31 (read-only key):
    python3 paper-flood-check.py compare paper-lines.jsonl

WHY THE ROW KEY IS (world, byte offset, message). Paper's @timestamp in ES is filebeat's READ
time, not the event time (the line carries only [HH:MM:SS]), so a time-bucket comparison of a
blocked shipper is meaningless: everything it held back is stamped when it was finally read.
filebeat records log.offset (the line's byte offset in latest.log) in _source, and Paper rolls
latest.log by renaming it, so the offsets in the rotated YYYY-MM-DD-N.log.gz are the offsets ES
holds. The message is compared after the same grok the mcai-paper pipeline applies, and lines on
an RCON thread are excluded on the file side because that pipeline drops them.
"""
import collections
import glob
import gzip
import hashlib
import json
import os
import re
import sys

LINE = re.compile(r'^\[(\d\d:\d\d:\d\d)\] \[(.*)/(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]: (.*)$')
WORLDS = ('board-*', 'hive-*', 'isolated-*', 'placebo-*')   # filebeat's globs on .30


def parse(raw):
    m = LINE.match(raw)
    if not m:
        return None, None, raw
    return m.group(1), m.group(2), m.group(4)


def dump(day):
    nxt = None
    for pat in WORLDS:
        for logs in sorted(glob.glob(f'/srv/block2/{pat}/logs')):
            world = logs.split('/')[3]
            files = sorted(glob.glob(f'{logs}/{day}-*.log.gz')) + [f'{logs}/latest.log']
            for f in files:
                if not os.path.exists(f):
                    continue
                if f.endswith('.gz'):
                    data = gzip.open(f, 'rb').read()
                    fday = day
                else:
                    size = os.path.getsize(f)
                    data = open(f, 'rb').read(size)
                    fday = 'live'
                off = 0
                for line in data.split(b'\n')[:-1] if data.endswith(b'\n') else data.split(b'\n'):
                    raw = line.decode('utf-8', 'replace').rstrip('\r')
                    t, thread, msg = parse(raw)
                    print(json.dumps({'world': world, 'file': os.path.basename(f), 'fday': fday,
                                      'offset': off, 'time': t, 'thread': thread,
                                      'rcon': bool(thread and 'RCON' in thread),
                                      'msg_sha': hashlib.sha1(msg.encode()).hexdigest(),
                                      'raw': raw}))
                    off += len(line) + 1


def compare(path, since='2026-10-19T00:00:00.000Z', until=None):
    sys.path.insert(0, os.path.expanduser('~/esflood'))
    import esclient as E
    import datetime as dt
    until = until or dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    total = E.count('mcai-mc-paper', E.window(since, until))
    pit = E.request('mcai-mc-paper/_pit?keep_alive=5m', method='POST')['id']
    es = collections.Counter()
    seen, after = 0, None
    while True:
        body = {'size': 5000, 'query': {'bool': {'filter': [E.window(since, until)]}},
                'pit': {'id': pit, 'keep_alive': '5m'}, 'sort': [{'_shard_doc': 'asc'}],
                '_source': ['log.file.path', 'log.offset', 'message'], 'track_total_hits': False}
        if after:
            body['search_after'] = after
        r = E.request('_search', body)
        hits = r['hits']['hits']
        if not hits:
            break
        pit = r.get('pit_id', pit)
        for h in hits:
            s = h['_source']
            p = ((s.get('log') or {}).get('file') or {}).get('path') or ''
            m = re.match(r'/srv/block2/([^/]+)/logs/', p)
            es[(m.group(1) if m else '<nopath>', (s.get('log') or {}).get('offset'),
                hashlib.sha1((s.get('message') or '').encode()).hexdigest())] += 1
            seen += 1
        after = hits[-1]['sort']
    E.request('_pit', {'id': pit}, method='DELETE')
    assert seen == total, f'walked {seen} of {total} paper docs'

    rows = [json.loads(x) for x in open(path)]
    assert rows, 'NotAnInstrument: the dump is empty'
    fc = collections.Counter()
    meta = {}
    for r in rows:
        if r['rcon']:
            continue
        k = (r['world'], r['offset'], r['msg_sha'])
        fc[k] += 1
        meta[k] = r
    found = collections.Counter()
    miss = collections.Counter()
    missing_rows = []
    for k, n in fc.items():
        r = meta[k]
        hour = (r['fday'] if r['fday'] != 'live' else 'live') + ' ' + ((r['time'] or '??')[:2] + ':00')
        got = min(n, es.get(k, 0))
        found[hour] += got
        if n > got:
            miss[hour] += n - got
            missing_rows.append(r)
    print(f'ES paper docs walked {seen:,} in [{since}, {until}); file lines (non-RCON) {sum(fc.values()):,}; '
          f'RCON lines excluded {sum(1 for r in rows if r["rcon"]):,}')
    print('server-hour        found  missing')
    for h in sorted(set(found) | set(miss)):
        print(f'  {h:<16} {found[h]:>6}  {miss[h]:>6}')
    by_world = collections.Counter(r['world'] for r in missing_rows)
    print('missing by world:', dict(by_world))
    with open(path + '.missing.json', 'w') as fh:
        json.dump(missing_rows, fh)
    print('missing rows written to', path + '.missing.json')


if __name__ == '__main__':
    if sys.argv[1] == 'dump':
        dump(sys.argv[sys.argv.index('--day') + 1])
    else:
        compare(sys.argv[2])
