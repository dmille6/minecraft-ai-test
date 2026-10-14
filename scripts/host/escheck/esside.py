#!/usr/bin/env python3
"""escheck/esside.py -- the ELASTICSEARCH side of the completeness check (read-only).

Reads <run>/files.json (written by files.py) for the days, the cutoff, the spot sample and
the multiset bot-days, asks ES the SAME questions over the SAME half-open windows, and
writes <run>/es.json plus the raw live mappings (<run>/mapping-<stream>.json).

Every count here is paired with a control:
  * per day, sum(bot buckets) + missing-bot-name bucket must equal _count for that window,
    and sum_other_doc_count must be 0 -- an aggregation that silently truncated is refused;
  * a nonexistent bot and a window in 2001 must both return 0 (a zero can be zero);
  * spot-matching is run on docs FETCHED FROM ES (must be found: proves the matcher can see
    a presence) and on file rows shifted by -400 days (must not be found).

Auth: esclient.py (owner's read-only API key file; never printed). Only _count, _search
and _mapping are used.
"""
import argparse
import collections
import datetime as dt
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import esclient as E  # noqa: E402

INDEX = {'skill': 'mcai-skill-agents', 'llm': 'mcai-llm-agents'}
KIND = {'skill': 'skill.name', 'llm': 'trigger'}
BOT = 'bot.name'
NONEXISTENT_BOT = 'no-such-bot-zz'
SEED = 20261014
DRILL_N = 6
MUTATION_ROWS = 40


def nextday(day):
    return (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()


def day_window(day, cutoff):
    hi = nextday(day) + 'T00:00:00Z'
    if cutoff < hi:
        hi = cutoff
    return day + 'T00:00:00Z', hi


def flat_mapping(props, pre='', dyn='strict', out=None):
    """{path: {'type':..., 'dynamic': inherited dynamic of the containing object}}"""
    out = {} if out is None else out
    for k, v in (props or {}).items():
        p = pre + k
        if 'properties' in v:
            d = str(v.get('dynamic', dyn))
            out[p] = {'type': 'object', 'dynamic': d, 'enabled': v.get('enabled', True)}
            flat_mapping(v['properties'], p + '.', d, out)
        else:
            # An object declared with no properties keeps ITS OWN dynamic (a reviewer reproduced
            # `{"type":"object","dynamic":false}` inheriting the parent's strict instead).
            own = str(v.get('dynamic', dyn)) if v.get('type', 'object') == 'object' else dyn
            out[p] = {'type': v.get('type', 'object'), 'dynamic': own,
                      'enabled': v.get('enabled', True), 'index': v.get('index', True),
                      'ignore_above': v.get('ignore_above'), 'ignore_malformed': v.get('ignore_malformed'),
                      'subfields': sorted(v.get('fields', {})), 'depth_limit': v.get('depth_limit')}
    return out


def agg_counts(stream, gte, lt, interval):
    body = {'size': 0, 'track_total_hits': True, 'query': E.window(gte, lt),
            'aggs': {'bots': {'terms': {'field': BOT, 'size': 1000},
                              'aggs': {'t': {'date_histogram': {'field': '@timestamp',
                                                                'fixed_interval': interval,
                                                                'min_doc_count': 1}}}},
                     'nobot': {'missing': {'field': BOT}}}}
    r = E.search(INDEX[stream], body)
    total = r['hits']['total']['value']
    ag = r['aggregations']
    if ag['bots']['sum_other_doc_count']:
        raise E.EsError(f'{stream} {gte}: terms agg truncated ({ag["bots"]["sum_other_doc_count"]} other)')
    out = {}
    for b in ag['bots']['buckets']:
        out[b['key']] = {x['key_as_string']: x['doc_count'] for x in b['t']['buckets']}
    s = sum(b['doc_count'] for b in ag['bots']['buckets']) + ag['nobot']['doc_count']
    return total, s, ag['nobot']['doc_count'], out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True, help='directory holding files.json')
    ap.add_argument('--skip-spot', action='store_true')
    a = ap.parse_args()
    F = json.load(open(f'{a.run}/files.json'))
    days, cutoff = F['days'], F['cutoff']
    rnd = random.Random(SEED)
    t0 = time.time()
    res = {'started_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'days': days, 'cutoff': cutoff, 'index': INDEX}

    # ---- mappings (all backing indices) and which backing indices hold the window --------
    res['mapping'] = {}
    for s in INDEX:
        raw = E.request(f'{INDEX[s]}/_mapping')
        with open(f'{a.run}/mapping-{s}.json', 'w') as fh:
            json.dump(raw, fh)
        per = {}
        for bi in sorted(raw):
            m = raw[bi]['mappings']
            per[bi] = flat_mapping(m.get('properties', {}), dyn=str(m.get('dynamic', 'true')))
            per[bi]['<root>'] = {'type': 'object', 'dynamic': str(m.get('dynamic', 'true'))}
        res['mapping'][s] = per
        lo, hi = days[0] + 'T00:00:00Z', cutoff
        r = E.search(INDEX[s], {'size': 0, 'query': E.window(lo, hi),
                                'aggs': {'bi': {'terms': {'field': '_index', 'size': 100}}}})
        res.setdefault('backing_in_window', {})[s] = {b['key']: b['doc_count'] for b in r['aggregations']['bi']['buckets']}
        latest = per[sorted(per)[-1]]
        for f, want in ((BOT, 'keyword'), ('@timestamp', 'date'), (KIND[s], 'keyword')):
            got = latest.get(f, {}).get('type')
            if got != want:
                raise E.EsError(f'{s}: field {f} is {got}, expected {want}; fix the field names first')
    print(f'mapping ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- controls ------------------------------------------------------------------------
    ctl = {}
    for s in INDEX:
        ctl[s] = {
            'nonexistent_bot_all_window': E.count(INDEX[s], {'bool': {'filter': [
                {'term': {BOT: NONEXISTENT_BOT}}, E.window(days[0] + 'T00:00:00Z', cutoff)]}}),
            'year_2001_window': E.count(INDEX[s], E.window('2001-01-01T00:00:00Z', '2002-01-01T00:00:00Z')),
            'whole_window': E.count(INDEX[s], E.window(days[0] + 'T00:00:00Z', cutoff)),
            'one_known_bot_whole_window': None,
        }
    res['controls'] = ctl

    # ---- per bot per day per hour ----------------------------------------------------------
    res['counts'] = {}
    res['day_totals'] = {}
    for s in INDEX:
        res['counts'][s] = {}
        res['day_totals'][s] = {}
        for day in days:
            gte, lt = day_window(day, cutoff)
            cnt = E.count(INDEX[s], E.window(gte, lt))
            total, ssum, nobot, per = agg_counts(s, gte, lt, '1h')
            if not (cnt == total == ssum):
                raise E.EsError(f'{s} {day}: _count {cnt} / hits {total} / agg sum {ssum} disagree')
            res['day_totals'][s][day] = {'count': cnt, 'missing_bot_name': nobot, 'window': [gte, lt]}
            for bot, hours in per.items():
                res['counts'][s][f'{bot}|{day}'] = {k[11:13]: v for k, v in hours.items()}
        some_bot = max(res['counts'][s], key=lambda k: sum(res['counts'][s][k].values())).split('|')[0]
        ctl[s]['one_known_bot_whole_window'] = [some_bot, E.count(INDEX[s], {'bool': {'filter': [
            {'term': {BOT: some_bot}}, E.window(days[0] + 'T00:00:00Z', cutoff)]}})]
    print(f'counts ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- drill the worst bot-days: is a gap LOSS, DUPLICATION, or file-side loss? -----------
    from botday import drill
    res['drill'] = {}
    for s in INDEX:
        fc, ec = F['counts'][s], res['counts'][s]
        diffs = sorted(((sum(fc.get(k, {}).values()) - sum(ec.get(k, {}).values()), k)
                        for k in set(fc) | set(ec)), key=lambda x: -abs(x[0]))
        res['drill'][s] = []
        for d, k in diffs[:DRILL_N]:
            if abs(d) < 3:
                break
            bot, day = k.split('|')
            res['drill'][s].append(drill(s, bot, day, cutoff))
    print(f'drill ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- rotation windows by minute --------------------------------------------------------
    res['minutes'] = {}
    for s in INDEX:
        res['minutes'][s] = {}
        wins = [(days[0] + 'T00:00:00Z', days[0] + 'T00:10:00Z')]
        wins += [(d + 'T23:50:00Z', nextday(d) + 'T00:10:00Z') for d in days]
        for gte, lt in wins:
            if gte >= cutoff:
                continue
            lt = min(lt, cutoff)
            _, _, _, per = agg_counts(s, gte, lt, '1m')
            for bot, mins in per.items():
                for k, v in mins.items():
                    res['minutes'][s][f'{bot}|{k[:16]}'] = v

    # ---- kinds per day ---------------------------------------------------------------------
    res['kinds'] = {}
    for s in INDEX:
        res['kinds'][s] = {}
        for day in days:
            gte, lt = day_window(day, cutoff)
            r = E.search(INDEX[s], {'size': 0, 'query': E.window(gte, lt), 'aggs': {
                'k': {'terms': {'field': KIND[s], 'size': 10000}},
                'none': {'missing': {'field': KIND[s]}}}})
            ag = r['aggregations']
            if ag['k']['sum_other_doc_count']:
                raise E.EsError(f'{s} {day}: kind terms truncated')
            d = {b['key']: b['doc_count'] for b in ag['k']['buckets']}
            if ag['none']['doc_count']:
                d['<none>'] = ag['none']['doc_count']
            res['kinds'][s][day] = d

    # ---- _ignored (values ES dropped from the index but kept in _source) --------------------
    res['ignored'] = {}
    for s in INDEX:
        res['ignored'][s] = {}
        for day in days:
            gte, lt = day_window(day, cutoff)
            try:
                r = E.search(INDEX[s], {'size': 0, 'query': E.window(gte, lt),
                                        'aggs': {'ig': {'terms': {'field': '_ignored', 'size': 200}}}})
                res['ignored'][s][day] = {b['key']: b['doc_count'] for b in r['aggregations']['ig']['buckets']}
            except E.EsError as e:
                res['ignored'][s][day] = {'<error>': str(e)[:200]}
        # positive control for the _ignored probe: does ANY doc in the index's history carry it?
        r = E.search(INDEX[s], {'size': 0, 'query': {'exists': {'field': '_ignored'}},
                                'aggs': {'ig': {'terms': {'field': '_ignored', 'size': 50}}}})
        res['ignored'][s]['<all time>'] = {b['key']: b['doc_count'] for b in r['aggregations']['ig']['buckets']}
    print(f'kinds/ignored ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- multiset (loss vs duplication) ------------------------------------------------------
    M = json.load(open(f'{a.run}/multiset.json'))
    res['multiset'] = {}
    for s in INDEX:
        res['multiset'][s] = {}
        for key, fkeys in M[s].items():
            bot, day = key.split('|')
            gte, lt = day_window(day, cutoff)
            esk = collections.Counter()
            after = None
            while True:
                comp = {'size': 5000, 'sources': [
                    {'ts': {'terms': {'field': '@timestamp'}}},
                    {'k': {'terms': {'field': KIND[s], 'missing_bucket': True}}}]}
                if after:
                    comp['after'] = after
                r = E.search(INDEX[s], {'size': 0, 'query': {'bool': {'filter': [
                    {'term': {BOT: bot}}, E.window(gte, lt)]}}, 'aggs': {'c': {'composite': comp}}})
                c = r['aggregations']['c']
                for b in c['buckets']:
                    esk[f'{b["key"]["ts"]}|{b["key"]["k"]}'] += b['doc_count']
                after = c.get('after_key')
                if not c['buckets'] or not after:
                    break
            lost = dup = 0
            lost_ex = []
            for k in set(fkeys) | set(esk):
                f, e = fkeys.get(k, 0), esk.get(k, 0)
                if f > e:
                    lost += f - e
                    if len(lost_ex) < 10:
                        lost_ex.append([k, f, e])
                elif e > f:
                    dup += e - f
            res['multiset'][s][key] = {'file_rows': sum(fkeys.values()), 'es_docs': sum(esk.values()),
                                       'lost': lost, 'extra_in_es': dup, 'lost_examples': lost_ex}
    print(f'multiset ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- spot equality --------------------------------------------------------------------
    if not a.skip_spot:
        res['spot'] = {}
        for s in INDEX:
            rows = [json.loads(l) for l in open(f'{a.run}/spot-{s}.jsonl')]
            res['spot'][s] = spot_check(s, rows)
            res['spot'][s]['controls'] = spot_controls(s, rows, days, cutoff, rnd)
        print(f'spot ok {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    # ---- freshness: newest doc per bot right now --------------------------------------------
    res['newest'] = {}
    now = dt.datetime.now(dt.timezone.utc)
    res['newest_queried_at'] = now.isoformat(timespec='seconds')
    for s in INDEX:
        r = E.search(INDEX[s], {'size': 0, 'query': E.window(
            (now - dt.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%SZ'), '2100-01-01T00:00:00Z'),
            'aggs': {'b': {'terms': {'field': BOT, 'size': 1000},
                           'aggs': {'mx': {'max': {'field': '@timestamp'}}}}}})
        res['newest'][s] = {b['key']: b['mx']['value_as_string'] for b in r['aggregations']['b']['buckets']}
    res['file_tail_newest'] = file_tails()
    res['file_tail_read_at'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    res['finished_at'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    with open(f'{a.run}/es.json', 'w') as fh:
        json.dump(res, fh)
    print(json.dumps({'controls': res['controls'], 'day_totals': res['day_totals']}, indent=1))


def file_tails(root='/var/log/mcai'):
    """Newest @timestamp in each live file, read from its last 64 KB (cheap)."""
    import glob
    out = {}
    for s in INDEX:
        out[s] = {}
        for f in glob.glob(f'{root}/*/{s}-*.jsonl'):
            size = os.path.getsize(f)
            if not size:
                continue
            with open(f, 'rb') as fh:
                fh.seek(max(0, size - 65536))
                lines = fh.read().split(b'\n')
            for l in reversed(lines[1:] if size > 65536 else lines):
                try:
                    d = json.loads(l)
                    out[s][d['bot']['name']] = d['@timestamp']
                    break
                except Exception:
                    continue
    return out


def _same(a, b):
    """Type-strict leaf equality: bool is not a number, the string "null" is not null; int and
    float compare by value only with each other (73 == 73.0 survives JSON re-encoding)."""
    num = (int, float)
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is bool and type(b) is bool and a == b
    if isinstance(a, num) and isinstance(b, num):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(not diff_paths(x, y) for x, y in zip(a, b))
    return a == b


def diff_paths(a, b, pre=''):
    """[(path, cls, file_value, es_value)] for every node where file row a and _source b differ.
    cls: 'null dropped' (file null, key absent in ES -- filebeat drops nulls), 'NON-NULL dropped',
    'extra in ES', 'value differs'. The class is decided on the VALUE, never on its printed form
    (a first version printed then compared, so a string "null" passed as a dropped null)."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = pre + k
            if k not in b:
                out.append((p, 'null dropped' if a[k] is None else 'NON-NULL dropped', str(a[k])[:60], None))
            elif k not in a:
                out.append((p, 'extra in ES', None, str(b[k])[:60]))
            else:
                out.extend(diff_paths(a[k], b[k], p + '.'))
        return out
    if isinstance(a, dict) or isinstance(b, dict) or not _same(a, b):
        out.append((pre.rstrip('.'), 'value differs', str(a)[:60], str(b)[:60]))
    return out


def mutants(row):
    """Copies of `row` each carrying ONE planted change the comparison must report as a
    non-null difference: a string edited, a number moved, a bool turned into 1, a non-null
    value replaced by the string "null", a key deleted."""
    out = []
    leaves = []

    def collect(d, path):
        for k, v in d.items():
            if isinstance(v, dict):
                collect(v, path + [k])
            else:
                leaves.append((path + [k], v))
    collect(row, [])

    def with_change(path, fn):
        r = json.loads(json.dumps(row))
        d = r
        for k in path[:-1]:
            d = d[k]
        fn(d, path[-1])
        return r
    for kind, pred, fn in (
            ('string edited', lambda v: isinstance(v, str) and v, lambda d, k: d.__setitem__(k, d[k] + 'x')),
            ('number +1', lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), lambda d, k: d.__setitem__(k, d[k] + 1)),
            ('bool -> 1', lambda v: isinstance(v, bool), lambda d, k: d.__setitem__(k, 1 if d[k] else 0)),
            ('value -> "null"', lambda v: v is not None and not isinstance(v, (dict, list)), lambda d, k: d.__setitem__(k, 'null')),
            ('key deleted', lambda v: v is not None, lambda d, k: d.pop(k))):
        cand = [pth for pth, v in leaves if pred(v) and pth != ['@timestamp']]
        if cand:
            out.append((kind, with_change(cand[len(cand) // 2], fn)))
    return out


def _get(d, path):
    for p in path.split('.'):
        if not isinstance(d, dict) or p not in d:
            return '<absent>'
        d = d[p]
    return d


COMPARE = {'skill': ['skill.detail', 'skill.status', 'bot.pos', 'bot.inventory', 'skill.args', 'skill.name'],
           'llm': ['llm.model', 'llm.latency_ms', 'outcome.status', 'bot.pos', 'bot.inventory', 'prompt.text',
                   'response.text']}


def match_query(s, row, shift_days=0):
    ts = row['@timestamp']
    if shift_days:
        t = dt.datetime.strptime(ts[:23], '%Y-%m-%dT%H:%M:%S.%f') + dt.timedelta(days=shift_days)
        ts = t.strftime('%Y-%m-%dT%H:%M:%S.%f')[:23] + 'Z'
    f = [{'term': {BOT: _get(row, 'bot.name')}},
         {'range': {'@timestamp': {'gte': ts, 'lte': ts}}}]
    k = row.get('skill', {}).get('name') if s == 'skill' else row.get('trigger')
    if isinstance(k, str):
        f.append({'term': {KIND[s]: k}})
    return {'size': 10, 'query': {'bool': {'filter': f}}}


def spot_check(s, rows):
    out = {'n': 0, 'found': 0, 'multi_hit': 0, 'exact_source_equal': 0,
           'field_equal': collections.Counter(), 'field_compared': collections.Counter(),
           'by_day': collections.defaultdict(lambda: [0, 0]), 'equal_modulo_null_fields': 0, 'missing_examples': [], 'unequal_examples': [],
           'diff_paths': collections.Counter(), 'diff_examples': [],
           'multi_hit_days': collections.Counter(), 'mutation_rows': 0, 'mutants_planted': collections.Counter(), 'mutants_detected': collections.Counter()}
    for item in rows:
        row = json.loads(item['row'])
        out['n'] += 1
        out['by_day'][item['day']][0] += 1
        hits = E.search(INDEX[s], match_query(s, row))['hits']['hits']
        if not hits:
            if len(out['missing_examples']) < 10:
                out['missing_examples'].append({'bot': _get(row, 'bot.name'), 'ts': row['@timestamp'],
                                                'kind': row.get('skill', {}).get('name') if s == 'skill' else row.get('trigger')})
            continue
        out['found'] += 1
        out['by_day'][item['day']][1] += 1
        if len(hits) > 1:
            out['multi_hit'] += 1
            out['multi_hit_days'][item['day']] += 1
        srcs = [h['_source'] for h in hits]
        if any(not diff_paths(row, src) for src in srcs):
            out['exact_source_equal'] += 1
        best = min(srcs, key=lambda src: len(diff_paths(row, src)))
        dps = diff_paths(row, best)
        if all(dp[1] == 'null dropped' for dp in dps):
            out['equal_modulo_null_fields'] += 1
        for dp in dps:
            out['diff_paths'][f'{dp[0]} [{dp[1]}]'] += 1
            if len(out['diff_examples']) < 15:
                out['diff_examples'].append(dp)
        # CONTENT-SENSITIVITY CONTROL: the matcher finding a doc proves visibility, not that
        # the comparison could see a changed value. Plant changes in the file row and require
        # each to be reported against the very same _source.
        if out['mutation_rows'] < MUTATION_ROWS and all(dp[1] == 'null dropped' for dp in dps):
            out['mutation_rows'] += 1
            for kind, m in mutants(row):
                out['mutants_planted'][kind] += 1
                if any(dp[1] != 'null dropped' for dp in diff_paths(m, best)):
                    out['mutants_detected'][kind] += 1
        for f in COMPARE[s]:
            fv = _get(row, f)
            if fv == '<absent>':
                continue
            out['field_compared'][f] += 1
            if not [dp for dp in diff_paths({'v': fv}, {'v': _get(best, f)}) if dp[1] != 'null dropped']:
                out['field_equal'][f] += 1  # equal, ignoring null-valued keys inside it
            elif len(out['unequal_examples']) < 10:
                out['unequal_examples'].append({'field': f, 'file': str(fv)[:120], 'es': str(_get(best, f))[:120]})
    out['diff_paths'] = dict(out['diff_paths'])
    out['mutants_planted'] = dict(out['mutants_planted'])
    out['multi_hit_days'] = dict(out['multi_hit_days'])
    out['mutants_detected'] = dict(out['mutants_detected'])
    out['field_equal'] = dict(out['field_equal'])
    out['field_compared'] = dict(out['field_compared'])
    out['by_day'] = dict(out['by_day'])
    return out


def spot_controls(s, rows, days, cutoff, rnd):
    """Positive: 30 docs drawn FROM ES must be found by the same matcher. Negative: 30 file
    rows shifted -400 days must not be."""
    pos_n = pos_found = 0
    for _ in range(30):
        day = rnd.choice(days)
        gte, lt = day_window(day, cutoff)
        r = E.search(INDEX[s], {'size': 1, 'query': {'function_score': {
            'query': E.window(gte, lt), 'random_score': {'seed': rnd.randrange(1 << 30), 'field': '_seq_no'}}}})
        h = r['hits']['hits']
        if not h:
            continue
        pos_n += 1
        if E.search(INDEX[s], match_query(s, h[0]['_source']))['hits']['hits']:
            pos_found += 1
    neg_n = neg_found = 0
    for item in rnd.sample(rows, min(30, len(rows))):
        row = json.loads(item['row'])
        neg_n += 1
        if E.search(INDEX[s], match_query(s, row, shift_days=-400))['hits']['hits']:
            neg_found += 1
    return {'positive_drawn_from_es': pos_n, 'positive_found': pos_found,
            'negative_shifted_rows': neg_n, 'negative_found': neg_found}


if __name__ == '__main__':
    main()
