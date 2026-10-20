#!/usr/bin/env python3
"""Measure, and backfill exactly once, a hole in mcai-skill-agents / mcai-llm-agents.

WHY. 2026-10-19 23:16Z the ELK VM's disk crossed the 95% flood stage; every index went
read_only_allow_delete and filebeat on 10.0.0.31 stopped delivering. The daily copytruncate
rotation (~23:59Z) ran while filebeat was blocked, so every row written between filebeat's last
read and the truncate is in the rotated -20261020.gz copy but was never shipped. The disk was
grown and ES released the block itself at 02:42Z. See docs/reports/es-flood-2026-10-20.md.

METHOD. A row is identified by its CANONICAL CONTENT, not by a key subset: the parsed JSON with
null-valued keys dropped (filebeat never ships them -- es-completeness-2026-10-14 sec. 3) and
integral floats as ints (Go re-encodes 73.0 as 73), dumped with sorted keys, then sha1. For each
(bot, hash) the file multiset and the ES multiset are compared. Legitimate byte-identical rows
exist (16,293 over 10-07..10-14), so a hash counted twice in the files must be counted twice in
ES too -- the comparison is a multiset, never a set.

    missing(bot, h) = max(0, file_count - es_count)   -> backfilled (fill window only)
    extra(bot, h)   = max(0, es_count - file_count)   -> reported, never deleted

EXACTLY ONCE. (1) The diff is recomputed from ES on every run, so a second run finds nothing
missing and sends nothing. (2) Every backfilled doc carries a deterministic _id
`fl<yymmdd>-<sha1[:24]>-<k>` (k = which occurrence of that row it is), sent with op `create`, so a
concurrent or repeated send of the same occurrence is a 409, not a duplicate.

CREDENTIALS. Reads use the owner's read-only API key (~/.config/mcai/es-readonly.key, via
escheck/esclient.py). Writes use the shipper account filebeat itself uses, read from
/etc/filebeat/filebeat.yml through `sudo -n cat` into memory -- the same credential
infra/elk/llm-backfill.py used. Neither is printed, logged, written or put on a command line.

Run ON 10.0.0.31 as mike (the files are local), niced:
    nice -n 19 ionice -c3 python3 flood-backfill.py --stream skill            # measure only
    nice -n 19 ionice -c3 python3 flood-backfill.py --stream skill --go       # fill, then re-measure
"""
import argparse
import base64
import collections
import datetime as dt
import glob
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                'scripts', 'host', 'escheck'))
sys.path.insert(0, os.path.expanduser('~/esflood'))
import esclient as E  # noqa: E402

ES = os.environ.get('MCAI_ES_URL', 'http://10.0.0.186:9200')
LOGROOT = '/var/log/mcai'
INDEX = {'skill': 'mcai-skill-agents', 'llm': 'mcai-llm-agents'}
TS_RE = re.compile(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z')


def strip(x):
    """What filebeat ships: no null-valued keys; integral floats as ints."""
    if isinstance(x, dict):
        return {k: strip(v) for k, v in x.items() if v is not None}
    if isinstance(x, list):
        return [strip(v) for v in x]
    if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53:
        return int(x)
    return x


def canon(obj):
    s = json.dumps(strip(obj), sort_keys=True, separators=(',', ':'))
    return s, hashlib.sha1(s.encode()).hexdigest()


def bucket5(ts):
    """'2026-10-19T23:17:42.123Z' -> '10-19T23:15'"""
    return ts[5:14] + '%02d' % (int(ts[14:16]) // 5 * 5)


def files_for(stream, lo):
    """Every rotated generation that can hold a row stamped >= lo (tag date > lo's date), plus
    the live file. A row is stamped when its skill STARTS, so it can sit one generation late."""
    tag_lo = (dt.date.fromisoformat(lo[:10]) + dt.timedelta(days=1)).strftime('%Y%m%d')
    out = []
    for d in sorted(glob.glob(f'{LOGROOT}/*/')):
        for f in sorted(glob.glob(f'{d}{stream}-*.jsonl-*.gz')):
            m = re.search(r'-(\d{8})\.gz$', f)
            if m and m.group(1) >= tag_lo:
                out.append(f)
        out += sorted(glob.glob(f'{d}{stream}-*.jsonl'))
    return out


def lines_of(path):
    if path.endswith('.gz'):
        with gzip.open(path, 'rb') as fh:
            for line in fh:
                yield line, True
        return
    size = os.path.getsize(path)   # the live file grows: never read past its size at open
    with open(path, 'rb') as fh:
        read = 0
        for line in fh:
            read += len(line)
            if read > size:
                break
            yield line, line.endswith(b'\n')


def file_side(stream, lo, hi, keep_lo, keep_hi):
    """Counter[(bot, hash)] for rows stamped in [lo, hi); per-(bot, 5-min) counts; and the
    canonical text of rows in [keep_lo, keep_hi) (the fill window) for insertion."""
    cnt = collections.Counter()
    b5 = collections.Counter()
    keep = {}
    stats = collections.Counter()
    paths = files_for(stream, lo)
    assert paths, f'NotAnInstrument: no {stream} files under {LOGROOT}'
    stats['files'] = len(paths)
    for p in paths:
        for line, complete in lines_of(p):
            stats['lines'] += 1
            if not complete:
                stats['partial_tail'] += 1
                continue
            try:
                d = json.loads(line)
            except Exception:
                stats['unparseable'] += 1
                continue
            ts = d.get('@timestamp') if isinstance(d, dict) else None
            if not isinstance(ts, str) or not TS_RE.fullmatch(ts):
                stats['bad_ts'] += 1
                continue
            if not (lo <= ts < hi):
                continue
            bot = (d.get('bot') or {}).get('name') if isinstance(d.get('bot'), dict) else None
            if not bot:
                stats['no_bot_name'] += 1
                bot = '<missing>'
            s, h = canon(d)
            cnt[(bot, h)] += 1
            b5[(bot, bucket5(ts))] += 1
            stats['rows_in_window'] += 1
            if keep_lo <= ts < keep_hi:
                keep[h] = s
    return cnt, b5, keep, stats


def es_side(stream, lo, hi, page=5000):
    """The same Counter and per-5-min counts from ES, by a point-in-time walk of _source."""
    idx = INDEX[stream]
    total = E.count(idx, E.window(lo, hi))
    pit = E.request(f'{idx}/_pit?keep_alive=5m', method='POST')['id']
    cnt = collections.Counter()
    b5 = collections.Counter()
    ids = collections.Counter()
    after = None
    seen = 0
    try:
        while True:
            body = {'size': page, 'query': {'bool': {'filter': [E.window(lo, hi)]}},
                    'pit': {'id': pit, 'keep_alive': '5m'},
                    'sort': [{'_shard_doc': 'asc'}], 'track_total_hits': False}
            if after:
                body['search_after'] = after
            r = E.request('_search', body)
            hits = r['hits']['hits']
            if not hits:
                break
            pit = r.get('pit_id', pit)
            for x in hits:
                src = x['_source']
                ts = src.get('@timestamp')
                bot = (src.get('bot') or {}).get('name') or '<missing>'
                _, h = canon(src)
                cnt[(bot, h)] += 1
                b5[(bot, bucket5(ts))] += 1
                ids[x['_id'][:2] == 'fl' and x['_id'][:9]] += 1
                seen += 1
            after = hits[-1]['sort']
    finally:
        try:
            E.request('_pit', {'id': pit}, method='DELETE')
        except Exception:
            pass
    if seen != total:
        raise SystemExit(f'ES walk read {seen} docs but _count says {total}: not a complete read')
    return cnt, b5, {'docs': seen, 'backfill_ids': {k: v for k, v in ids.items() if k}}


def ship_creds():
    """filebeat's own shipper account, read through sudo into memory only."""
    txt = subprocess.run(['sudo', '-n', 'cat', '/etc/filebeat/filebeat.yml'],
                         capture_output=True, text=True, timeout=20).stdout
    u = re.search(r'^\s*username:\s*"([^"]+)"', txt, re.M)
    p = re.search(r'^\s*password:\s*"([^"]+)"', txt, re.M)
    if not (u and p):
        raise SystemExit('NoWriteCredential: could not read the shipper account from '
                         '/etc/filebeat/filebeat.yml (sudo -n). Stopping; nothing was written.')
    return u.group(1), p.group(1)


def bulk(stream, ops, u, p):
    body = ''.join(ops).encode()
    req = urllib.request.Request(f'{ES}/{INDEX[stream]}/_bulk', data=body, method='POST',
                                 headers={'Content-Type': 'application/x-ndjson'})
    req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{u}:{p}'.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f'bulk HTTP {e.code}: {e.read().decode(errors="replace")[:300]}')


def compare(fc, ec, fb, eb, lo, hi):
    missing, extra = collections.Counter(), collections.Counter()
    for k in set(fc) | set(ec):
        d = fc.get(k, 0) - ec.get(k, 0)
        if d > 0:
            missing[k] = d
        elif d < 0:
            extra[k] = -d
    bots = sorted({b for b, _ in fb} | {b for b, _ in eb})
    bk = sorted({t for _, t in fb} | {t for _, t in eb})
    per_bucket = {t: {'file': sum(fb.get((b, t), 0) for b in bots),
                      'es': sum(eb.get((b, t), 0) for b in bots),
                      'bots_differing': sum(fb.get((b, t), 0) != eb.get((b, t), 0) for b in bots)}
                  for t in bk}
    per_bot = {b: {'file': sum(v for (bb, _), v in fb.items() if bb == b),
                   'es': sum(v for (bb, _), v in eb.items() if bb == b)} for b in bots}
    return missing, extra, per_bucket, per_bot


def measure(stream, lo, hi, flo, fhi):
    t0 = time.time()
    fc, fb, keep, fstats = file_side(stream, lo, hi, flo, fhi)
    t1 = time.time()
    ec, eb, estats = es_side(stream, lo, hi)
    t2 = time.time()
    missing, extra, per_bucket, per_bot = compare(fc, ec, fb, eb, lo, hi)
    hour = lambda t: t[:9] + '00'   # noqa: E731  '10-19T23:15' -> '10-19T23:00'
    per_hour = collections.defaultdict(lambda: collections.Counter())
    for t, v in per_bucket.items():
        per_hour[hour(t)]['file'] += v['file']
        per_hour[hour(t)]['es'] += v['es']
        per_hour[hour(t)]['bot_5min_differing'] += v['bots_differing']
    return {
        'stream': stream, 'window': [lo, hi], 'fill_window': [flo, fhi],
        'file_stats': dict(fstats), 'es_stats': estats,
        'file_rows': sum(fc.values()), 'es_docs': sum(ec.values()),
        'missing_rows': sum(missing.values()), 'extra_docs': sum(extra.values()),
        'missing_in_fill_window': sum(n for k, n in missing.items() if k[1] in keep),
        'distinct_hashes_file': len(fc), 'file_hashes_repeated': sum(1 for v in fc.values() if v > 1),
        # the duplicate proof: a row held twice in ES must be held twice in the files too
        'es_hashes_repeated': sum(1 for v in ec.values() if v > 1),
        'es_hashes_above_file_count': sum(1 for k, v in ec.items() if v > fc.get(k, 0)),
        'bots_file_ne_es': sorted(b for b, v in per_bot.items() if v['file'] != v['es']),
        'bots': len(per_bot),
        'per_hour': {k: dict(v) for k, v in sorted(per_hour.items())},
        'per_bucket': per_bucket, 'per_bot': per_bot,
        'secs': {'files': round(t1 - t0, 1), 'es': round(t2 - t1, 1)},
    }, missing, extra, keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stream', choices=sorted(INDEX), required=True)
    ap.add_argument('--lo', default='2026-10-19T22:00:00.000Z', help='measure window start (control hour first)')
    ap.add_argument('--hi', default='2026-10-20T01:00:00.000Z')
    ap.add_argument('--fill-lo', default='2026-10-19T23:00:00.000Z')
    ap.add_argument('--fill-hi', default='2026-10-20T01:00:00.000Z')
    ap.add_argument('--go', action='store_true', help='insert the missing rows, then re-measure')
    ap.add_argument('--batch', type=int, default=1000)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    for v in (a.lo, a.hi, a.fill_lo, a.fill_hi):
        assert TS_RE.fullmatch(v), f'use canonical ISO ms timestamps, got {v}'
    assert a.lo <= a.fill_lo < a.fill_hi <= a.hi, 'the fill window must sit inside the measure window'
    out = a.out or os.path.expanduser(f'~/esflood/{a.stream}-{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}.json')

    rep, missing, extra, keep = measure(a.stream, a.lo, a.hi, a.fill_lo, a.fill_hi)
    to_fill = {k: n for k, n in missing.items() if k[1] in keep}
    rep['missing_outside_fill_window'] = rep['missing_rows'] - rep['missing_in_fill_window']
    result = {'before': rep, 'extras_sample': [list(k) + [n] for k, n in list(extra.items())[:20]]}
    print(json.dumps({k: v for k, v in rep.items() if k not in ('per_bucket', 'per_bot')}, indent=1))

    if a.go and to_fill:
        u, p = ship_creds()
        tag = 'fl' + a.fill_lo[2:4] + a.fill_hi[5:7] + a.fill_hi[8:10]
        sent = created = conflict = 0
        rejected = collections.Counter()
        ops = []

        def flush():
            nonlocal ops, created, conflict
            if not ops:
                return
            res = bulk(a.stream, ops, u, p)
            for it in res.get('items', []):
                c = it.get('create', {})
                if c.get('status') == 409:
                    conflict += 1
                elif c.get('error'):
                    rejected[str(c['error'].get('reason'))[:150]] += 1
                else:
                    created += 1
            ops = []

        # occurrence index: rows already in ES at this key are occurrences 0..es-1
        es_now, _, _ = es_side(a.stream, a.fill_lo, a.fill_hi)
        for (bot, h), n in sorted(to_fill.items()):
            base = es_now.get((bot, h), 0)
            for k in range(base, base + n):
                ops.append(json.dumps({'create': {'_id': f'{tag}-{h[:24]}-{k}'}}) + '\n')
                ops.append(keep[h] + '\n')
                sent += 1
                if len(ops) >= 2 * a.batch:
                    flush()
        flush()
        result['backfill'] = {'sent': sent, 'created': created, 'conflict_409': conflict,
                              'rejected': sum(rejected.values()), 'rejected_reasons': dict(rejected)}
        print(json.dumps(result['backfill'], indent=1))
        time.sleep(15)   # refresh_interval is 5s
        after, m2, x2, _ = measure(a.stream, a.lo, a.hi, a.fill_lo, a.fill_hi)
        result['after'] = after
        print(json.dumps({k: v for k, v in after.items() if k not in ('per_bucket', 'per_bot')}, indent=1))
    with open(out, 'w') as fh:
        json.dump(result, fh, indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()
