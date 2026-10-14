#!/usr/bin/env python3
"""escheck/reconcile.py -- GROSS loss and GROSS extras for EVERY bot-day, not a sample.

Why it exists: equal per-bot-hour counts can hide a loss and a duplicate inside the same hour,
and the seeded 16-bot-day multiset could not speak for the other 624 (Codex review, 10-14).

For each bot, each stream, each day in the run: the exact multiset of
    skill: (@timestamp ms, skill.name, skill.status, skill.duration_ms)
    llm:   (@timestamp ms, trigger, llm.latency_ms, prompt.system_hash)
from the files vs the same tuple from an ES composite aggregation over the same window.
Four fields make two distinct events colliding on one key very unlikely; any key ES holds
more often than the file is then CHECKED: up to EXTRA_CHECK such keys per bot-day are fetched
and their _source compared to each other and to the file row(s) -- "identical payload" is a
re-send, anything else is reported as distinct.

Usage: reconcile.py --run DIR     (reads DIR/files.json for days + cutoff; writes DIR/reconcile.json)
Read-only. ~1 composite query per 10k docs; a short sleep between bot-days keeps ES load low.
"""
import argparse
import collections
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import esclient as E  # noqa: E402
from files import files_for, open_lines, ts_ms, TS_RE  # noqa: E402
from esside import INDEX, BOT, day_window  # noqa: E402

FIELDS = {'skill': ['skill.name', 'skill.status', 'skill.duration_ms'],
          'llm': ['trigger', 'llm.latency_ms', 'prompt.system_hash']}
NUMERIC = {'skill.duration_ms', 'llm.latency_ms'}
EXTRA_CHECK = 25


def _get(d, path):
    for p in path.split('.'):
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def norm(field, v):
    if v is None:
        return None
    if field in NUMERIC:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return f'<nonnum:{v}>'
        return int(v)  # ES `long` doc values truncate a float; _source keeps it
    return v if isinstance(v, str) else str(v)


def file_keys(stream, botdir, bot, days, cutoff):
    per_day = {d: collections.Counter() for d in days}
    rows = {d: collections.defaultdict(list) for d in days}
    whole = {d: collections.Counter() for d in days}   # byte-identical rows, to price a full-_source dedup
    for path in files_for(stream, botdir, days):
        for line, complete in open_lines(path):
            if not complete:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            ts = d.get('@timestamp') if isinstance(d, dict) else None
            if not isinstance(ts, str) or not TS_RE.fullmatch(ts):
                continue
            if ts[:10] not in per_day or ts[:19] >= cutoff[:19]:
                continue
            if (d.get('bot') or {}).get('name') != bot:
                continue
            k = (ts_ms(ts),) + tuple(norm(f, _get(d, f)) for f in FIELDS[stream])
            per_day[ts[:10]][k] += 1
            rows[ts[:10]][k].append(line)
            whole[ts[:10]][hash(line.strip())] += 1
    return per_day, rows, {d: sum(n - 1 for n in c.values() if n > 1) for d, c in whole.items()}


def es_keys(stream, bot, day, cutoff):
    gte, lt = day_window(day, cutoff)
    srcs = [{'ts': {'terms': {'field': '@timestamp'}}}]
    srcs += [{f'f{i}': {'terms': {'field': f, 'missing_bucket': True}}} for i, f in enumerate(FIELDS[stream])]
    c = collections.Counter()
    after = None
    while True:
        comp = {'size': 10000, 'sources': srcs}
        if after:
            comp['after'] = after
        r = E.search(INDEX[stream], {'size': 0, 'query': {'bool': {'filter': [
            {'term': {BOT: bot}}, E.window(gte, lt)]}}, 'aggs': {'c': {'composite': comp}}})
        agg = r['aggregations']['c']
        for b in agg['buckets']:
            k = b['key']
            c[(k['ts'],) + tuple(norm(f, k[f'f{i}']) for i, f in enumerate(FIELDS[stream]))] += b['doc_count']
        after = agg.get('after_key')
        if not agg['buckets'] or not after:
            break
    return c


def check_extra(stream, bot, key, file_lines):
    """Fetch every ES doc at this key; are they byte-identical payloads of the file row?"""
    ts = dt.datetime.fromtimestamp(key[0] / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:23] + 'Z'
    f = [{'term': {BOT: bot}}, {'range': {'@timestamp': {'gte': ts, 'lte': ts}}}]
    must_not = []
    for i, fld in enumerate(FIELDS[stream]):
        if key[1 + i] is None:
            must_not.append({'exists': {'field': fld}})   # the key says "absent": require it
        elif not str(key[1 + i]).startswith('<nonnum'):
            f.append({'term': {fld: key[1 + i]}})
    r = E.search(INDEX[stream], {'size': 100, 'track_total_hits': True,
                                 'query': {'bool': {'filter': f, 'must_not': must_not}}})
    hits = r['hits']['hits']
    if not hits:
        # An empty answer is the MATCHER failing, not a re-send (a reviewer reproduced the
        # first version labelling [] as "identical payload").
        return 'no ES hit for this key (matcher)'
    if r['hits']['total']['value'] > len(hits):
        return 'more ES hits than fetched'

    def canon(o):
        def strip(x):  # nulls dropped (filebeat does), integral floats as ints (Go re-encodes 73.0 as 73)
            if isinstance(x, dict):
                return {k: strip(v) for k, v in x.items() if v is not None}
            if isinstance(x, list):
                return [strip(v) for v in x]
            if isinstance(x, float) and x.is_integer():
                return int(x)
            return x
        return json.dumps(strip(o), sort_keys=True)
    es_c = [canon(h['_source']) for h in hits]
    file_c = [canon(json.loads(l)) for l in file_lines]
    if not file_c:
        return 'no file row at this key'
    if len(es_c) > len(file_c) and all(x == file_c[0] for x in es_c) and len(set(file_c)) == 1:
        return 'identical payload (re-send)'
    return 'distinct payloads'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    ap.add_argument('--days', help='comma list: re-check only these days (writes reconcile-<days>.json)')
    a = ap.parse_args()
    F = json.load(open(f'{a.run}/files.json'))
    days, cutoff = F['days'], F['cutoff']
    if a.days:
        days = [d for d in days if d in a.days.split(',')]
    t0 = time.time()
    out = {s: {} for s in INDEX}
    for bot in F['bots_dirs']:
        botdir = f'{F["root"]}/{bot}'
        for s in INDEX:
            per_day, rows, identical = file_keys(s, botdir, bot, days, cutoff)
            for day in days:
                fk = per_day[day]
                ek = es_keys(s, bot, day, cutoff)
                if not fk and not ek:
                    continue
                lost = collections.Counter()
                extra = collections.Counter()
                extra_keys = []
                for k in set(fk) | set(ek):
                    fn, en = fk.get(k, 0), ek.get(k, 0)
                    minute = dt.datetime.fromtimestamp(k[0] / 1000, dt.timezone.utc).strftime('%H:%M')
                    if fn > en:
                        lost[minute] += fn - en
                    elif en > fn:
                        extra[minute] += en - fn
                        extra_keys.append(k)
                verdicts = collections.Counter()
                ek_sorted = sorted(extra_keys)  # spread the checks over the whole day, not its first minute
                step = max(1, len(ek_sorted) // EXTRA_CHECK)
                for k in ek_sorted[::step][:EXTRA_CHECK]:
                    verdicts[check_extra(s, bot, k, rows[day].get(k, []))] += 1
                out[s][f'{bot}|{day}'] = {
                    'file': sum(fk.values()), 'es': sum(ek.values()),
                    'lost': sum(lost.values()), 'extra': sum(extra.values()),
                    'lost_by_minute': dict(lost), 'extra_by_minute': dict(extra),
                    'extra_keys': len(extra_keys), 'extra_checked': dict(verdicts),
                    'extra_key_minutes': sorted({dt.datetime.fromtimestamp(k[0] / 1000, dt.timezone.utc).strftime('%H:%M')
                                                 for k in extra_keys})[:50],
                    'file_key_repeats': sum(n - 1 for n in fk.values() if n > 1),
                    'file_identical_rows': identical[day]}
            time.sleep(0.05)
        print(f'{bot} {time.time() - t0:.0f}s', file=sys.stderr, flush=True)
    name = 'reconcile.json' if not a.days else f'reconcile-{a.days.replace(",", "_")}.json'
    with open(f'{a.run}/{name}', 'w') as fh:
        json.dump(out, fh)
    for s in INDEX:
        v = out[s].values()
        print(s, 'bot-days', len(out[s]), 'file', sum(x['file'] for x in v), 'es', sum(x['es'] for x in v),
              'lost', sum(x['lost'] for x in v), 'extra', sum(x['extra'] for x in v))


if __name__ == '__main__':
    main()
