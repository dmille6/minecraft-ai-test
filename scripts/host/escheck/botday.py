#!/usr/bin/env python3
"""escheck/botday.py -- drill into ONE bot-day: exact (ts_ms, kind) multiset, file vs ES.

  botday.py STREAM BOT DAY [CUTOFF]   e.g. botday.py skill placebo-a-Comet 2026-10-07

Prints rows lost (in the file, not in ES) and extra (in ES, not in the file) grouped by
minute, whether the extras are DUPLICATES of keys the file has once (re-send) or keys the
file lacks entirely (file-side loss), and the not-JSON lines (e.g. NUL runs) in that bot's
files. Read-only; uses esclient's API key file.
"""
import collections
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import esclient as E  # noqa: E402
from files import files_for, open_lines, ts_ms, kind_of  # noqa: E402
from esside import INDEX, KIND, BOT, nextday  # noqa: E402


def main():
    stream, bot, day = sys.argv[1:4]
    cutoff = sys.argv[4] if len(sys.argv) > 4 else '9999-12-31T00:00:00Z'
    print(json.dumps(drill(stream, bot, day, cutoff), indent=1))


def drill(stream, bot, day, cutoff='9999-12-31T00:00:00Z'):
    """Both sides end at `cutoff` (whole seconds), so a drill of TODAY compares like with like."""
    fk = collections.Counter()
    bad = []
    for path in files_for(stream, f'/var/log/mcai/{bot}', [day]):
        for line, complete in open_lines(path):
            if not complete:
                continue
            try:
                d = json.loads(line)
            except Exception:
                bad.append((os.path.basename(path), len(line), line.count(b'\x00'), line[:60]))
                continue
            ts = d.get('@timestamp', '')
            if ts[:10] == day and ts[:19] < cutoff[:19] and (d.get('bot') or {}).get('name') == bot:
                fk[(ts_ms(ts), kind_of(stream, d))] += 1
    ek = collections.Counter()
    after = None
    while True:
        comp = {'size': 5000, 'sources': [{'ts': {'terms': {'field': '@timestamp'}}},
                                          {'k': {'terms': {'field': KIND[stream], 'missing_bucket': True}}}]}
        if after:
            comp['after'] = after
        r = E.search(INDEX[stream], {'size': 0, 'query': {'bool': {'filter': [
            {'term': {BOT: bot}}, E.window(day + 'T00:00:00Z', min(nextday(day) + 'T00:00:00Z', cutoff))]}},
            'aggs': {'c': {'composite': comp}}})
        c = r['aggregations']['c']
        for b in c['buckets']:
            ek[(b['key']['ts'], b['key']['k'])] += b['doc_count']
        after = c.get('after_key')
        if not c['buckets'] or not after:
            break
    lost = collections.Counter()
    dup = collections.Counter()
    uniq_extra = collections.Counter()
    for k in set(fk) | set(ek):
        f, e = fk.get(k, 0), ek.get(k, 0)
        minute = dt.datetime.fromtimestamp(k[0] / 1000, dt.timezone.utc).strftime('%H:%M')
        if f > e:
            lost[minute] += f - e
        elif e > f:
            (dup if f else uniq_extra)[minute] += e - f
    return {'stream': stream, 'bot': bot, 'day': day, 'file_rows': sum(fk.values()),
            'es_docs': sum(ek.values()), 'lost_by_minute': dict(sorted(lost.items())),
            'es_duplicates_of_file_keys_by_minute': dict(sorted(dup.items())),
            'es_keys_absent_from_file_by_minute': dict(sorted(uniq_extra.items())),
            'not_json_lines_in_files': [[b[0], b[1], b[2], b[3].decode('utf-8', 'replace')] for b in bad]}


if __name__ == '__main__':
    main()
