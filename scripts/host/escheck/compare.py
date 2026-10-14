#!/usr/bin/env python3
"""escheck/compare.py -- join files.json + es.json (+ filebeat.json) into summary.json.

No network, no credentials: pure arithmetic over the two sides' outputs. Every ratio is
printed with its denominator (file rows), and every "0" is next to the control that shows
the same instrument finding something.

Usage: compare.py --run DIR   (writes DIR/summary.json, prints a readable digest)
"""
import argparse
import collections
import datetime as dt
import json
import statistics

STREAMS = ('skill', 'llm')


# ---------------------------------------------------------------- mapping evaluation
def ancestors(path):
    parts = path.split('.')
    return ['.'.join(parts[:i]) for i in range(1, len(parts))]


RANGES = {'byte': (-2 ** 7, 2 ** 7 - 1), 'short': (-2 ** 15, 2 ** 15 - 1),
          'integer': (-2 ** 31, 2 ** 31 - 1), 'long': (-2 ** 63, 2 ** 63 - 1)}
MAX_TERM_BYTES = 32766      # Lucene's hard limit for one indexed term (keyword / flattened leaf)
FLATTENED_DEPTH_LIMIT = 20  # flattened default depth_limit


def classify(path, types, fm, num=None, strmax=0):
    """How a backing index with flat mapping `fm` treats `path` carrying census `types`
    (plus the observed numeric [min,max] and longest string in UTF-8 bytes).
    Returns (status, detail). status in: mapped, under_flattened, under_disabled,
    REJECT_strict_unmapped, unindexed_dynamic_false, TYPE_CONFLICT, null_only.
    Type-level and value-range checks only: a numeric STRING coercing, or a date string's
    format, is not judged here (the 0-dropped filebeat counter covers what actually arrived)."""
    real = {t: n for t, n in types.items() if t != 'null'}
    if not real:
        return 'null_only', 'only null values (filebeat drops nulls; ES treats null as absent)'
    for a in ancestors(path):
        m = fm.get(a)
        if m is None:
            continue
        if m['type'] == 'flattened':
            depth = len(path.split('.')) - len(a.split('.'))
            limit = m.get('depth_limit') or FLATTENED_DEPTH_LIMIT  # the mapping's own, else the default
            if depth > limit:
                return 'TYPE_CONFLICT', f'{depth} levels under flattened {a} > depth_limit {limit}'
            if strmax > MAX_TERM_BYTES:
                return 'TYPE_CONFLICT', f'string of {strmax} bytes under flattened {a} > {MAX_TERM_BYTES}'
            return 'under_flattened', a
        if m.get('enabled') is False:
            return 'under_disabled', a
    m = fm.get(path)
    if m is None:
        # nearest mapped object ancestor decides via its (inherited) dynamic setting
        dyn = fm['<root>']['dynamic']
        for a in ancestors(path):
            if a in fm and fm[a]['type'] == 'object':
                dyn = fm[a]['dynamic']
        if dyn == 'strict':
            return 'REJECT_strict_unmapped', 'whole document rejected (strict_dynamic_mapping_exception)'
        if dyn in ('false', 'False'):
            return 'unindexed_dynamic_false', 'kept in _source, not searchable'
        return 'unmapped_dynamic_true', 'would be added dynamically (never seen by ES?)'
    bad = conflicts(m['type'], real)
    if bad:
        return 'TYPE_CONFLICT', f'{m["type"]} <- {bad}'
    if num and m['type'] in RANGES:
        lo, hi = RANGES[m['type']]
        if num[0] < lo or num[1] > hi:
            return 'TYPE_CONFLICT', f'{m["type"]} range {lo}..{hi} <- observed {num}'
    if m['type'] == 'keyword' and strmax > min(MAX_TERM_BYTES, m.get('ignore_above') or MAX_TERM_BYTES):
        return 'TYPE_CONFLICT', f'keyword <- string of {strmax} bytes'
    return 'mapped', m['type']


def conflicts(mtype, real):
    out = {}
    for t, n in real.items():
        base = t[5:-1] if t.startswith('list[') else t
        if base in ('list', 'null'):
            continue
        ok = True
        if mtype in ('keyword', 'text', 'wildcard', 'match_only_text'):
            ok = base in ('str', 'int', 'float', 'bool')
        elif mtype in ('long', 'integer', 'short', 'byte', 'float', 'double', 'half_float', 'scaled_float'):
            ok = base in ('int', 'float')          # str coerces only if numeric; bool rejects
            if base == 'float' and mtype in ('long', 'integer', 'short', 'byte'):
                ok = True                          # coerced (truncated), not rejected
        elif mtype == 'boolean':
            ok = base in ('bool',)
        elif mtype in ('date', 'date_nanos'):
            ok = base in ('str', 'int')
        elif mtype == 'flattened':
            ok = base in ('dict', 'dict(empty)')
        elif mtype == 'object':
            ok = base in ('dict', 'dict(empty)')
        if not ok:
            out[t] = n
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    a = ap.parse_args()
    F = json.load(open(f'{a.run}/files.json'))
    E = json.load(open(f'{a.run}/es.json'))
    try:
        FB = json.load(open(f'{a.run}/filebeat.json'))
    except FileNotFoundError:
        FB = None
    S = {'days': F['days'], 'cutoff': F['cutoff'], 'controls': E['controls'],
         'file_bad_lines': F['bad'], 'file_bad_by_file': F.get('bad_by_file'), 'dir_mismatch': F['dir_mismatch'], 'walk_seconds': F['walk_seconds'],
         'backing_in_window': E['backing_in_window'],
         'file_lines_read': F.get('lines_read'), 'files_read': F.get('files_read'), 'bot_dirs': len(F['bots_dirs'])}

    # ---- totals per day ------------------------------------------------------------------
    S['day_totals'] = {}
    for s in STREAMS:
        rows = []
        for day in F['days']:
            f = F['rows_day'][s].get(day, 0)
            e = E['day_totals'][s][day]['count']
            rows.append({'day': day, 'file_rows': f, 'es_docs': e, 'file_minus_es': f - e,
                         'es_over_file': round(e / f, 6) if f else None})
        tf = sum(r['file_rows'] for r in rows)
        te = sum(r['es_docs'] for r in rows)
        S['day_totals'][s] = {'rows': rows, 'total_file': tf, 'total_es': te, 'total_diff': tf - te,
                              'ratio': round(te / tf, 6) if tf else None}

    # ---- per bot-day ---------------------------------------------------------------------
    S['bot_days'] = {}
    for s in STREAMS:
        fc, ec = F['counts'][s], E['counts'][s]
        keys = set(fc) | set(ec)
        diffs = []
        by_hour = collections.Counter()
        for k in keys:
            fh, eh = fc.get(k, {}), ec.get(k, {})
            f, e = sum(fh.values()), sum(eh.values())
            diffs.append((k, f, e, f - e))
            for h in set(fh) | set(eh):
                by_hour[h] += fh.get(h, 0) - eh.get(h, 0)
        d0 = sum(1 for x in diffs if x[3] == 0)
        # PER BOT-HOUR, not netted across bots: how many bot-hours differ at all, by hour class
        bh = collections.Counter()
        nonzero_mid = []
        for k in keys:
            fh, eh = fc.get(k, {}), ec.get(k, {})
            day = k.split('|')[1]
            for h in set(fh) | set(eh):
                cls = 'rotation_hours_00_23' if h in ('00', '23') else 'hours_01_22'
                bh[(day, cls, 'n')] += 1
                if fh.get(h, 0) != eh.get(h, 0):
                    bh[(day, cls, 'nonzero')] += 1
                    if cls == 'hours_01_22':
                        nonzero_mid.append([k, h, fh.get(h, 0), eh.get(h, 0)])
        S['bot_days'][s] = {
            'n_bot_days': len(diffs), 'exact': d0,
            'abs_diff_le_2': sum(1 for x in diffs if abs(x[3]) <= 2),
            'file_only_bot_days': sorted(k for k, f, e, _ in diffs if e == 0 and f > 0)[:20],
            'es_only_bot_days': sorted(k for k, f, e, _ in diffs if f == 0 and e > 0)[:20],
            'worst_deficit': [list(x) for x in sorted(diffs, key=lambda x: -x[3])[:10]],
            'worst_surplus': [list(x) for x in sorted(diffs, key=lambda x: x[3])[:5]],
            'worst_ratio': [[k, f, e, round(e / f, 4)] for k, f, e, _ in
                            sorted((x for x in diffs if x[1] >= 100), key=lambda x: x[2] / x[1])[:10]],
            'net_diff_by_hour': dict(sorted(by_hour.items())),
            'bot_hours': {day: {cls: [bh[(day, cls, 'nonzero')], bh[(day, cls, 'n')]]
                                for cls in ('hours_01_22', 'rotation_hours_00_23')} for day in F['days']},
            'bot_hours_nonzero_01_22': sorted(nonzero_mid)[:40],
            'deficit_by_day': {day: sum(x[3] for x in diffs if x[0].endswith(day) and x[3] > 0) for day in F['days']},
            'surplus_by_day': {day: -sum(x[3] for x in diffs if x[0].endswith(day) and x[3] < 0) for day in F['days']},
        }

    # ---- rotation minutes ----------------------------------------------------------------
    S['rotation'] = {}
    for s in STREAMS:
        fm, em = F['minutes'][s], E['minutes'][s]
        by_min = collections.Counter()
        by_boundary = collections.Counter()
        for k in set(fm) | set(em):
            d = fm.get(k, 0) - em.get(k, 0)
            mm = k.split('|')[1]
            by_min[mm[11:16]] += d
            if d:
                by_boundary[mm[:10] if mm[11:13] == '23' else (dt.date.fromisoformat(mm[:10]) - dt.timedelta(days=1)).isoformat()] += d
        S['rotation'][s] = {'net_file_minus_es_by_minute': dict(sorted((k, v) for k, v in by_min.items() if v)),
                            'net_by_boundary_ending_day': dict(sorted(by_boundary.items())),
                            'total_in_rotation_windows': sum(by_min.values())}

    # ---- kinds ---------------------------------------------------------------------------
    S['kinds'] = {}
    for s in STREAMS:
        per = {}
        tot = collections.Counter()
        for day in F['days']:
            fk, ek = F['kinds'][s].get(day, {}), E['kinds'][s].get(day, {})
            dd = {k: fk.get(k, 0) - ek.get(k, 0) for k in set(fk) | set(ek) if fk.get(k, 0) != ek.get(k, 0)}
            per[day] = dict(sorted(dd.items(), key=lambda x: -abs(x[1]))[:8])
            for k, v in dd.items():
                tot[k] += v
        # GROSS per day: a 10-07 surplus must not net against later deficits of the same kind
        gross_def = collections.Counter()
        gross_sur = collections.Counter()
        for day in F['days']:
            fk, ek = F['kinds'][s].get(day, {}), E['kinds'][s].get(day, {})
            for k in set(fk) | set(ek):
                d = fk.get(k, 0) - ek.get(k, 0)
                if d > 0:
                    gross_def[(day, k)] += d
                elif d < 0:
                    gross_sur[(day, k)] -= d
        S['kinds'][s + '_gross'] = {
            'deficit_total_by_kind_excl_first_day': dict(collections.Counter(
                {k: sum(v for (d, kk), v in gross_def.items() if kk == k and d != F['days'][0])
                 for (_, k) in gross_def}).most_common(12)),
            'max_single_day_kind_deficit': max(((v, d, k) for (d, k), v in gross_def.items()), default=None),
            'surplus_day_kinds': sorted([[d, k, v] for (d, k), v in gross_sur.items()], key=lambda x: -x[2])[:12]}
        S['kinds'][s] = {'by_day_top': per, 'window_total_top': dict(tot.most_common(10)),
                         'kinds_in_files': len({k for d in F['kinds'][s].values() for k in d}),
                         'kinds_in_es': len({k for d in E['kinds'][s].values() for k in d})}

    # ---- census vs mapping -----------------------------------------------------------------
    S['fields'] = {}
    for s in STREAMS:
        maps = E['mapping'][s]
        in_window = sorted(E['backing_in_window'][s])
        res = collections.defaultdict(dict)
        status_count = collections.Counter()
        for path, types in F['census'][s].items():
            rows = sum(types.values())
            days = F['census_day'][s].get(path, {})
            for bi in in_window:
                st, det = classify(path, types, maps[bi], F['census_num'][s].get(path),
                                   F['census_strmax'][s].get(path, 0))
                res[path][bi] = [st, det]
            st0 = res[path][in_window[-1]][0]
            status_count[st0] += 1
        problems = []
        for path, per in res.items():
            sts = {v[0] for v in per.values()}
            if sts & {'REJECT_strict_unmapped', 'TYPE_CONFLICT', 'unindexed_dynamic_false', 'unmapped_dynamic_true'}:
                problems.append({'path': path, 'per_backing_index': per,
                                 'types': F['census'][s][path], 'rows_by_day': F['census_day'][s].get(path, {})})
        S['fields'][s] = {'paths_in_files': len(res), 'status_latest_index': dict(status_count),
                          'problems': sorted(problems, key=lambda p: -sum(p['types'].values())),
                          'mapped_leaf_fields_latest': len([k for k, v in maps[in_window[-1]].items()
                                                            if v.get('type') != 'object']),
                          'mapped_never_seen_in_files': sorted(
                              k for k, v in maps[in_window[-1]].items()
                              if v.get('type') not in ('object',) and k != '<root>'
                              and not any(p == k or p.startswith(k + '.') for p in res))}
        lm = maps[in_window[-1]]
        S['fields'][s]['numeric_ranges_of_integer_mapped'] = {
            p: [lm[p]['type'], F['census_num'][s].get(p)] for p in lm
            if lm[p].get('type') in RANGES and p in F['census_num'][s]}
        S['fields'][s]['longest_strings_top'] = sorted(F['census_strmax'][s].items(), key=lambda x: -x[1])[:8]
        S['fields'][s]['max_flattened_depth'] = max(
            ((len(p.split('.')) - len(a.split('.')), p) for p in F['census'][s] for a in ancestors(p)
             if lm.get(a, {}).get('type') == 'flattened'), default=None)
        S['fields'][s]['brain_paths'] = sorted(p for p in res if p.split('.')[0] == 'brain' or '.brain' in p)
        S['fields'][s]['ignored'] = E['ignored'][s]

    # ---- spot ------------------------------------------------------------------------------
    S['spot'] = {}
    for s in STREAMS:
        sp = E.get('spot', {}).get(s)
        if not sp:
            continue
        S['spot'][s] = {k: sp.get(k) for k in ('n', 'found', 'multi_hit', 'exact_source_equal',
                                                'equal_modulo_null_fields', 'field_equal', 'field_compared',
                                                'by_day', 'diff_paths', 'missing_examples', 'controls',
                                                'mutation_rows', 'mutants_planted', 'mutants_detected',
                                                'multi_hit_days')}
        S['spot'][s]['nonnull_loss_paths'] = {k: v for k, v in sp['diff_paths'].items() if '[null dropped]' not in k}

    # ---- multiset ----------------------------------------------------------------------------
    S['multiset'] = {}
    for s in STREAMS:
        m = E['multiset'][s]
        S['multiset'][s] = {'bot_days': len(m), 'file_rows': sum(v['file_rows'] for v in m.values()),
                            'es_docs': sum(v['es_docs'] for v in m.values()),
                            'lost': sum(v['lost'] for v in m.values()),
                            'extra_in_es': sum(v['extra_in_es'] for v in m.values()),
                            'lost_examples': [[k] + ex for k, v in m.items() for ex in v['lost_examples']][:20]}
        for ex in S['multiset'][s]['lost_examples']:
            ms = int(ex[1].split('|')[0])
            ex.append(dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).isoformat(timespec='milliseconds'))

    # ---- freshness ---------------------------------------------------------------------------
    S['lag'] = {}
    for s in STREAMS:
        lags = {}
        for bot, fts in E['file_tail_newest'][s].items():
            ets = E['newest'][s].get(bot)
            if not ets:
                lags[bot] = None
                continue
            f = dt.datetime.fromisoformat(fts.replace('Z', '+00:00'))
            e = dt.datetime.fromisoformat(ets.replace('Z', '+00:00'))
            lags[bot] = round((f - e).total_seconds(), 1)
        vals = [v for v in lags.values() if v is not None]
        S['lag'][s] = {'bots': len(lags), 'no_recent_es_doc': sorted(b for b, v in lags.items() if v is None),
                       'median_s': statistics.median(vals) if vals else None, 'max_s': max(vals) if vals else None,
                       'p90_s': sorted(vals)[int(0.9 * (len(vals) - 1))] if vals else None,
                       'queried_at': E['newest_queried_at'], 'tails_read_at': E['file_tail_read_at']}
    # ---- drill summaries -----------------------------------------------------------------
    S['drill'] = {}
    for s in STREAMS:
        S['drill'][s] = [{'bot_day': f'{d["bot"]}|{d["day"]}', 'file_rows': d['file_rows'], 'es_docs': d['es_docs'],
                          'lost': sum(d['lost_by_minute'].values()),
                          'lost_minutes': sorted(d['lost_by_minute'])[:5],
                          'es_duplicates': sum(d['es_duplicates_of_file_keys_by_minute'].values()),
                          'dup_span': [min(d['es_duplicates_of_file_keys_by_minute'], default=None),
                                       max(d['es_duplicates_of_file_keys_by_minute'], default=None)],
                          'es_only_keys': sum(d['es_keys_absent_from_file_by_minute'].values()),
                          'es_only_minutes': sorted(d['es_keys_absent_from_file_by_minute'])[:5],
                          'not_json_lines': len(d['not_json_lines_in_files'])}
                         for d in E.get('drill', {}).get(s, [])]

    # ---- classifier controls: the census-vs-mapping judge must be able to say NO ----------
    S['classifier_controls'] = {}
    for s in STREAMS:
        fm = E['mapping'][s][sorted(E['backing_in_window'][s])[-1]]
        # llm.brain is what brain-01 (unmerged, origin/brain01-on-82aef34) adds to logLlm: its
        # branch edits the TEMPLATE, which only reaches the next backing index at rollover.
        probes = {('llm.brain', 'str'): 'REJECT_strict_unmapped',
                  ('brain.mode', 'str'): 'REJECT_strict_unmapped',
                  ('zz_new_top_level', 'int'): 'REJECT_strict_unmapped',
                  ('bot.name', 'dict'): 'TYPE_CONFLICT',
                  ('bot.inventory', 'int'): 'TYPE_CONFLICT',
                  ('bot.inventory.oak_log', 'int'): 'under_flattened',
                  ('bot.pos.x', 'float'): 'mapped',
                  ('bot.held', 'null'): 'null_only'}
        S['classifier_controls'][s] = {f'{p} <- {t}': [classify(p, {t: 1}, fm)[0], want,
                                                         classify(p, {t: 1}, fm)[0] == want]
                                       for (p, t), want in probes.items()}
    # ---- end-to-end classifier control: planted ROWS through the same walk() the census uses --
    from files import walk
    S['classifier_e2e'] = {}
    planted = [({'bot': {'name': {'first': 'x'}}}, True), ({'llm': {'brain': 'local'}}, True),
               ({'bot': {'inventory': 5}}, True), ({'zz_top': 1}, True), ({'bot': {'pos': {'x': 'abc'}}}, True),
               ({'game': {'tick': 2 ** 64}}, True), ({'bot': {'held': 'x' * 40000}}, True),
               ({'bot': {'name': 'x' * 40000}}, True), ({'bot': {'name': 'x' * 1000}}, False),
               ({'bot': {'inventory': {'oak_log': 3}, 'name': 'b', 'pos': {'x': 1.5}}}, False),
               ({'bot': {'held': None}}, False)]
    for s in STREAMS:
        fm = E['mapping'][s][sorted(E['backing_in_window'][s])[-1]]
        res_e2e = []
        for row, want_flag in planted:
            leaves = []
            walk(row, '', leaves)
            types = collections.defaultdict(collections.Counter)
            num, smax = {}, collections.Counter()
            for p, t, v in leaves:
                types[p][t] += 1
                if isinstance(v, str):
                    smax[p] = max(smax[p], len(v.encode()))
                elif v is not None:
                    num[p] = [min(num.get(p, [v, v])[0], v), max(num.get(p, [v, v])[1], v)]
            st = {p: classify(p, dict(t), fm, num.get(p), smax.get(p, 0))[0] for p, t in types.items()}
            flagged = any(x in ('REJECT_strict_unmapped', 'TYPE_CONFLICT') for x in st.values())
            res_e2e.append([json.dumps(row)[:60], 'flagged' if flagged else 'clean', want_flag == flagged,
                            {p: x for p, x in st.items() if x not in ('mapped', 'under_flattened')} or 'all mapped'])
        S['classifier_e2e'][s] = res_e2e

    # ---- full reconciliation (reconcile.py) --------------------------------------------------
    try:
        R = json.load(open(f'{a.run}/reconcile.json'))
    except FileNotFoundError:
        R = None
    # a later `reconcile.py --days D` re-check (reconcile-D.json) replaces those bot-days
    import glob
    for extra_run in sorted(glob.glob(f'{a.run}/reconcile-*.json')):
        if R is not None:
            X = json.load(open(extra_run))
            for s in STREAMS:
                R[s].update(X.get(s, {}))
            S.setdefault('reconcile_overlays', []).append(extra_run.split('/')[-1])
    if R:
        S['reconcile'] = {}
        for s in STREAMS:
            v = R[s]
            first = F['days'][0]
            later = {k: x for k, x in v.items() if not k.endswith(first)}
            lost_min = collections.Counter()
            extra_min = collections.Counter()
            for x in later.values():
                lost_min.update(x['lost_by_minute'])
                extra_min.update(x['extra_by_minute'])
            rot = lambda m: m >= '23:50' or m < '00:10'  # noqa: E731
            checked = collections.Counter()
            for x in v.values():
                checked.update(x['extra_checked'])
            S['reconcile'][s] = {
                'bot_days': len(v), 'file': sum(x['file'] for x in v.values()), 'es': sum(x['es'] for x in v.values()),
                'lost_all': sum(x['lost'] for x in v.values()), 'extra_all': sum(x['extra'] for x in v.values()),
                'after_first_day': {'file': sum(x['file'] for x in later.values()),
                                    'lost': sum(x['lost'] for x in later.values()),
                                    'extra': sum(x['extra'] for x in later.values()),
                                    'lost_outside_23:50-00:10': sum(n for m, n in lost_min.items() if not rot(m)),
                                    'extra_outside_23:50-00:10': sum(n for m, n in extra_min.items() if not rot(m)),
                                    'lost_by_minute': dict(sorted(lost_min.items())),
                                    'extra_by_minute': dict(sorted(extra_min.items()))},
                'first_day_totals': {'lost': sum(x['lost'] for k, x in v.items() if k.endswith(first)),
                                     'extra': sum(x['extra'] for k, x in v.items() if k.endswith(first))},
                'first_day': {k: {kk: x.get(kk) for kk in ('file', 'es', 'lost', 'extra', 'extra_checked', 'extra_key_minutes')}
                              for k, x in v.items() if k.endswith(first) and (x['lost'] or x['extra'])},
                'extra_checked_all': dict(checked),
                'file_key_repeats': sum(x['file_key_repeats'] for x in v.values()),
                'file_identical_rows': sum(x['file_identical_rows'] for x in v.values()),
            }
    if FB:
        S['filebeat'] = FB
    with open(f'{a.run}/summary.json', 'w') as fh:
        json.dump(S, fh, indent=1)
    digest(S)


def digest(S):
    print('cutoff', S['cutoff'], 'controls', json.dumps(S['controls']))
    for s in STREAMS:
        t = S['day_totals'][s]
        print(f'\n== {s}: file {t["total_file"]:,} es {t["total_es"]:,} diff {t["total_diff"]:,} ratio {t["ratio"]}')
        for r in t['rows']:
            print('  ', r)
        b = S['bot_days'][s]
        print('  bot-days', b['n_bot_days'], 'exact', b['exact'], '|d|<=2', b['abs_diff_le_2'])
        print('  worst deficit', b['worst_deficit'][:5])
        print('  worst surplus', b['worst_surplus'][:3])
        print('  net by hour', b['net_diff_by_hour'])
        print('  rotation', S['rotation'][s])
        print('  kinds', S['kinds'][s]['window_total_top'])
        f = S['fields'][s]
        print('  fields', f['paths_in_files'], f['status_latest_index'], 'brain:', f['brain_paths'])
        for p in f['problems'][:15]:
            print('    PROBLEM', p['path'], p['types'], list(p['per_backing_index'].values())[-1], p['rows_by_day'])
        print('  ignored', f['ignored'])
        if s in S['spot']:
            sp = S['spot'][s]
            print('  spot', {k: sp[k] for k in ('n', 'found', 'multi_hit', 'exact_source_equal',
                                                 'equal_modulo_null_fields', 'controls', 'nonnull_loss_paths')})
        print('  multiset', S['multiset'][s])
        print('  lag', S['lag'][s])
        print('  drill', S['drill'][s])
        print('  classifier controls', S['classifier_controls'][s])
        print('  classifier e2e', S['classifier_e2e'][s])
        print('  bot-hours', b['bot_hours'], 'nonzero 01-22:', b['bot_hours_nonzero_01_22'][:10])
        print('  kinds gross', S['kinds'][s + '_gross'])
        if 'reconcile' in S:
            print('  RECONCILE', json.dumps(S['reconcile'][s]))


if __name__ == '__main__':
    main()
