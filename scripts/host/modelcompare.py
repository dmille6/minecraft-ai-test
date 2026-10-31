#!/usr/bin/env python3
r"""modelcompare.py -- the +24 h comparison for the qwen3.5:9b fleet experiment (OWNER 2026-10-31 14:00Z; run by
`modelrollout.py watch` right AFTER its mandatory rollback, or by hand). Writes ~/qwen35-rollout/compare-24h.md (+ .json).

WINDOWS (from ~/qwen35-rollout/state.json): EXP = [completed, completed + 24 h] (the whole fleet on the model);
PRE = [started - 24 h, started] (the 24 h before the first stage); D1..D7 = the seven 24-h windows before PRE, for the
7-day MEDIAN. The ramp [started, completed] is in none of them.

CANARY EXCLUSION: a pool that was a canary pool at any moment of a window (journal `deployed` row -> its run's close:
torn-down / promoted / recorded) is excluded from THAT window, for the whole window, in every metric. Promotions and
fleet-sha changes inside a window are listed as CONFOUNDS (they change every pool's code), as are the canaries.

METRICS
  ES (skill stream, wide windows; CLAUDE.md): items_per_bot_h and value_per_bot_h (valuescore.measure, restricted to the
  included pools), deaths_per_bot_h, success share of gather / craft / deposit / town_deposit / mine / smelt / build*,
  _build rows per bot-h, time outside skills (1 - sum of non-underscore skill.duration_ms / active bot-time).
  FILES (the decision stream llm-<bot>.jsonl, which ES's skill stream does not hold): model decisions per bot-h, latency
  p50/p95/p99, timeouts (>= LLM_TIMEOUT_MS or a timeout error), invalid share, served-by-the-model share, rep_fail and
  veto_repeat (modelread.repeat_rates: the live forms of the replay's repeat-failure and post-veto metrics).
Every number carries its denominator (bot-h, rows). A metric that cannot be read prints UNREADABLE, never 0.
"""
import datetime as dt
import glob
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
UTC = dt.timezone.utc
H = os.path.expanduser('~')
HOME = os.environ.get('ROLL_HOME', os.path.join(H, 'qwen35-rollout'))
JOURNAL = os.environ.get('ROLL_JOURNAL', os.path.join(H, 'canary-journal.jsonl'))
ENV_DIR = os.environ.get('ROLL_ENV_DIR', '/srv/mcbots/harness/env')
W5 = os.environ.get('ROLL_W5_SCRIPTS', os.path.join(H, 'w5alarms', 'scripts'))
SKILLS = ('gather', 'craft', 'deposit', 'town_deposit', 'mine', 'smelt')
CLOSE = ('torn-down', 'promoted')
BOT_RE = re.compile(r'([a-z]+-[a-z])-[A-Z][a-z]+')


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def read_jsonl(p):
    out = []
    if os.path.exists(p):
        for l in open(p, errors='replace'):
            try:
                out.append(json.loads(l))
            except ValueError:
                pass
    return out


# ------------------------------------------------------------------------------------------------------- pure --
def windows(started, completed):
    """PURE. -> [(name, since, until)]: EXP, PRE, D1..D7."""
    out = [('EXP', completed, completed + dt.timedelta(hours=24)), ('PRE', started - dt.timedelta(hours=24), started)]
    for k in range(1, 8):
        out.append(('D%d' % k, started - dt.timedelta(hours=24 * (k + 1)), started - dt.timedelta(hours=24 * k)))
    return out


def canary_spans(journal, exclude_runs=()):
    """PURE. Journal -> [(run, pools set, deployed_t, closed_t or None, decision or None, promoted_t or None)]."""
    by = {}
    for r in journal:
        run = r.get('run')
        if not run or run in exclude_runs:
            continue
        ph, t = r.get('phase'), ts(r.get('ts'))
        if ph == 'deployed' and run not in by:
            parts = str(r.get('note') or '').split()
            by[run] = {'pools': set((parts[0] if parts else '').split(',')) - {''}, 'dep': t, 'close': None, 'dec': None, 'prom': None}
        elif run in by:
            if ph in CLOSE and by[run]['close'] is None:
                by[run]['close'] = t
            if ph == 'promoted':
                by[run]['prom'] = t
            if ph == 'recorded':
                by[run]['dec'] = str(r.get('note') or '').split()[:1][0] if r.get('note') else None
    out = sorted(((k, v['pools'], v['dep'], v['close'], v['dec'], v['prom']) for k, v in by.items() if v['dep']),
                 key=lambda x: x[2])
    # ONE canary slot: a run with no close row (older journals) ended no later than the next run's deploy
    for i, (k, ps, dep, close, dec, prom) in enumerate(out):
        nxt = out[i + 1][2] if i + 1 < len(out) else None
        if close is None and nxt is not None:
            out[i] = (k, ps, dep, nxt, dec, prom)
    return out


def excluded_pools(spans, since, until):
    """PURE. Pools that were canary pools at any moment of [since, until), and the runs responsible."""
    pools, runs = set(), []
    for run, ps, dep, close, dec, prom in spans:
        end = close or until
        if dep < until and end > since:
            pools |= ps
            runs.append(run)
    return pools, runs


def segments(spans, since, until):
    """PURE. [since, until) cut at every canary boundary -> [(a, b, canary pools active in [a, b))]. A pool is excluded
    only for the time it was a canary pool, not for the whole window."""
    cuts = {since, until}
    for run, ps, dep, close, dec, prom in spans:
        for x in (dep, close):
            if x and since < x < until:
                cuts.add(x)
    cuts = sorted(cuts)
    out = []
    for a, b in zip(cuts, cuts[1:]):
        ex = set()
        for run, ps, dep, close, dec, prom in spans:
            if dep < b and (close or until) > a:
                ex |= ps
        out.append((a, b, ex))
    return out


def excluded_at(segs, pool, t):
    """PURE. Was `pool` a canary pool at time t?"""
    for a, b, ex in segs:
        if a <= t < b:
            return pool in ex
    return False


def confounds(spans, since, until):
    """PURE. Human lines: the canaries overlapping the window and the promotions inside it."""
    out = []
    for run, ps, dep, close, dec, prom in spans:
        end = close or until
        if dep < until and end > since:
            out.append('canary %s on %s, %s..%s, %s' % (run, ','.join(sorted(ps)), iso(dep)[5:16],
                                                       iso(close)[5:16] if close else 'open', dec or 'undecided'))
        if prom and since <= prom < until:
            out.append('PROMOTION of %s at %s: every pool changed code inside the window' % (run, iso(prom)[5:16]))
    return out


def decision_metrics(rows_by_bot, model, hours_by_bot=None):
    """PURE. llm rows (per bot, time order) -> the decision-stream metrics (work orders excluded)."""
    import modelread as mr
    from modelrollout import is_timeout, pct
    rows = [r for v in rows_by_bot.values() for r in v if not mr.is_order(r)]
    L = [r.get('llm') or {} for r in rows]
    rc = {'fail_n': 0, 'fail_rep': 0, 'veto_n': 0, 'veto_rep': 0, 'n': 0, 'refused': 0}
    for v in rows_by_bot.values():
        for k, x in mr.repeat_rates(v).items():
            rc[k] += x
    bh = sum((hours_by_bot or {}).values()) if hours_by_bot else None
    lat = [x.get('latency_ms') for x in L if x.get('schema_valid')]
    n = len(rows)
    sh = lambda a, b: round(a / b, 4) if b else None
    return {'decisions': n, 'bot_h': round(bh, 1) if bh else None, 'decisions_per_bot_h': round(n / bh, 2) if bh else None,
            'lat_p50_ms': pct(lat, .5), 'lat_p95_ms': pct(lat, .95), 'lat_p99_ms': pct(lat, .99),
            'timeouts': sum(1 for x in L if is_timeout(x)), 'timeout_share': sh(sum(1 for x in L if is_timeout(x)), n),
            'invalid_share': sh(sum(1 for x in L if not x.get('schema_valid')), n),
            'model_share': sh(sum(1 for r in rows if mr.served_by(r, model)), n) if model else None,
            'rep_fail': sh(rc['fail_rep'], rc['fail_n']), 'rep_fail_n': rc['fail_n'],
            'veto_repeat': sh(rc['veto_rep'], rc['veto_n']), 'veto_repeat_n': rc['veto_n'],
            'refused_share': sh(rc['refused'], rc['n'])}


def median_of(days, key):
    xs = [d.get(key) for d in days if isinstance(d.get(key), (int, float))]
    return (statistics.median(xs), len(xs)) if len(xs) >= 3 else (None, len(xs))


def fmt(v):
    if v is None:
        return 'UNREADABLE'
    if isinstance(v, float):
        return '%.4g' % v
    return str(v)


def delta(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or not b:
        return ''
    return '%+.0f%%' % (100 * (a - b) / b)


def render(res):
    """PURE. The results dict -> markdown."""
    L = ['# qwen3.5:9b fleet experiment: +24 h comparison', '',
         'Generated %s. Model **%s** at %s on every fleet bot from %s (stages started %s); rolled back by the watch at +24 h '
         '(owner rule 10-31: the Blackwell is for testing only).' % (res['generated'], res['model'], res['url'],
                                                                     res['completed'], res['started']), '',
         'Windows: EXP %s .. %s; PRE %s .. %s; the 7-day median is over D1..D7 (24-h windows before PRE). A pool is left '
         'out for the time it was a canary pool (each window is cut at every canary boundary).' % tuple(res['win'][k] for k in (
             'EXP0', 'EXP1', 'PRE0', 'PRE1')), '']
    for sect, keys in (('Fleet value (Elasticsearch skill stream)', res['es_keys']),
                       ('Decision stream (llm-<bot>.jsonl)', res['dec_keys'])):
        L += ['## ' + sect, '', '| metric | EXP | PRE | vs PRE | 7-day median (n) | vs median |', '|---|---|---|---|---|---|']
        for k in keys:
            e, p = res['EXP'].get(k), res['PRE'].get(k)
            m, n = median_of([res[d] for d in res['days']], k)
            L.append('| %s | %s | %s | %s | %s (%d) | %s |' % (k, fmt(e), fmt(p), delta(e, p), fmt(m), n, delta(e, m)))
        L.append('')
    L += ['## Denominators and exclusions', '']
    for w in ['EXP', 'PRE'] + res['days']:
        d = res[w]
        L.append('- %s: %s bot-h (ES), %s decisions over %s bot-h (files); canary pools left out for their canary time: %s (canaries %s)%s' % (
            w, fmt(d.get('bot_hours')), fmt(d.get('decisions')), fmt(d.get('bot_h')), ','.join(d.get('excluded') or []) or 'none',
            ','.join(d.get('excluded_runs') or []) or 'none', ('; ERRORS: ' + '; '.join(d['errors'])) if d.get('errors') else ''))
    L += ['', '## Confounds', '']
    for w in ('EXP', 'PRE'):
        c = res[w].get('confounds') or []
        L.append('- %s: %s' % (w, '; '.join(c) if c else 'no canary or promotion overlapped'))
    L += ['- The EXP model ran on a different server (the Blackwell, serial ~1.2 s/request, ~50 requests/min) than PRE '
          '(the 5080): latency and decision rate measure the serving, not only the model.', '',
          '## Hourly record during EXP', '', '```']
    L += [json.dumps(h) for h in res.get('hourly') or []] or ['(none)']
    L += ['```', '']
    return '\n'.join(L)


# ------------------------------------------------------------------------------------------------- the reads --
def all_pools():
    return sorted({m.group(1) for m in (BOT_RE.fullmatch(os.path.basename(e)[:-4]) for e in glob.glob(os.path.join(ENV_DIR, '*.env'))) if m})


def es_metrics(since, until, pools_all, segs):
    """Sums over the segments (each with its own canary pools left out), then the ratios."""
    sys.path.insert(0, W5); sys.path.insert(0, os.path.join(W5, 'host'))
    from lib.estelemetry import EsEvents
    import valuescore as V
    acc = {'units': 0.0, 'value': 0.0, 'bh': 0.0, 'deaths': 0, 'build_rows': 0, 'dur_ms': 0.0, 'dur_docs': 0, 'docs': 0}
    st = {}
    errs, segs_done = [], 0
    for a, b, ex in segs:
        pools = [p for p in pools_all if p not in ex]
        if not pools:      # EsEvents turns pools=[] into NO filter: the whole fleet, canaries included (Codex r1)
            errs.append('segment %s..%s: no pools left after the canary exclusion: skipped' % (iso(a)[11:16], iso(b)[11:16]))
            continue
        try:
            ev = EsEvents.load('skill', since=a, until=b, pools=pools, gaps='allow')
            if not ev.total():
                raise RuntimeError('no skill documents (an ingest gap is not a quiet segment)')
            bh = ev.coverage()['bot_hours']
            names = ev.names()
            rows_by_kind = {k: [{'delta': (x.get('skill') or {}).get('inventory_delta') or {},
                                 'world': V.world_of((x.get('exp') or {}).get('pool'))}
                                for x in ev.rows(k, fields=['skill.inventory_delta', 'exp.pool'], max_rows=400_000, allow_zero=True)]
                            for k in V.INTAKE_KINDS if names.get(k)}
            sc = V.score(rows_by_kind)
            r = ev._search({'size': 0, 'query': ev._query(), 'aggs': {'k': {'terms': {'field': 'skill.name', 'size': 2000},
                                                                             'aggs': {'d': {'sum': {'field': 'skill.duration_ms'}},
                                                                                      'c': {'value_count': {'field': 'skill.duration_ms'}},
                                                                                      's': {'terms': {'field': 'skill.status', 'size': 20}}}}}})
            bk = ev._complete(r['aggregations']['k'], 'skill.name terms')['buckets']
        except Exception as x:
            errs.append('segment %s..%s: %s: %s' % (iso(a)[5:16], iso(b)[5:16], type(x).__name__, str(x)[:140]))
            continue
        segs_done += 1
        acc['units'] += sc['units']; acc['value'] += sc['value']; acc['bh'] += bh
        acc['deaths'] += names.get('_death', 0); acc['build_rows'] += names.get('_build', 0)
        for bb in bk:
            k = str(bb['key'])
            if k.startswith('_'):
                continue
            acc['docs'] += bb['doc_count']; acc['dur_docs'] += bb['c']['value']; acc['dur_ms'] += bb['d']['value'] or 0
            if k in SKILLS or k.startswith('build'):
                ss = {x['key']: x['doc_count'] for x in bb['s']['buckets']}
                c = st.setdefault(k, [0, 0]); c[0] += ss.get('success', 0); c[1] += bb['doc_count']
    out = {'segments': len(segs), 'segments_read': segs_done}
    if segs_done < len(segs):
        errs.append('%d of %d segments unread: the ES numbers cover the rest only' % (len(segs) - segs_done, len(segs)))
    bh = acc['bh']
    out['bot_hours'] = round(bh, 1) if bh else None
    out['intake_units'] = acc['units']
    out['items_per_bot_h'] = acc['units'] / bh if bh else None
    out['value_per_bot_h'] = acc['value'] / bh if bh else None
    out['deaths'] = acc['deaths'] if segs_done else None
    out['deaths_per_bot_h'] = acc['deaths'] / bh if bh else None
    for k in SKILLS:
        c = st.get(k)
        out['%s_success' % k] = (c[0] / c[1]) if c and c[1] else None
        out['%s_n' % k] = c[1] if c else 0
    for k in sorted(x for x in st if x.startswith('build')):
        out['%s_success' % k] = st[k][0] / st[k][1] if st[k][1] else None
    out['_build_per_bot_h'] = acc['build_rows'] / bh if bh else None
    cov = acc['dur_docs'] / acc['docs'] if acc['docs'] else None
    out['duration_coverage'] = cov
    # a sum over a field nobody carries is 0, which would read as "100 % outside skills" (Codex r1)
    out['time_outside_skills'] = (1 - acc['dur_ms'] / 3.6e6 / bh) if bh and cov is not None and cov >= 0.95 else None
    if bh and out['time_outside_skills'] is None:
        errs.append('time outside skills UNREADABLE: skill.duration_ms on %s of %d skill rows' % (acc['dur_docs'], acc['docs']))
    return out, errs


def file_metrics(since, until, pools_all, segs, model):
    """Decision rows of every fleet bot, minus the rows a bot wrote while its pool was a canary pool; bot-hours in
    10-minute slots holding >= 1 kept row (the unit rollout.py and the ES coverage use)."""
    import modelread as mr
    if not pools_all:
        raise RuntimeError('no pools in the roster')
    rows, hours = {}, {}
    for e in sorted(glob.glob(os.path.join(ENV_DIR, '*.env'))):
        b = os.path.basename(e)[:-4]
        m = BOT_RE.fullmatch(b)
        if not m or m.group(1) not in pools_all:
            continue
        kept = [r for r in mr.read_stream(b, 'llm', since, until) if not excluded_at(segs, m.group(1), r['_t'])]
        rows[b] = kept
        slots = {int((r['_t'] - since).total_seconds() // 600) for r in kept}
        if slots:
            hours[b] = len(slots) / 6.0
    if sum(len(v) for v in rows.values()) < 1000:
        raise RuntimeError('positive control: only %d llm rows over %d bots' % (sum(len(v) for v in rows.values()), len(rows)))
    return decision_metrics(rows, model, hours)


def main():
    st = json.load(open(os.path.join(HOME, 'state.json')))
    started, completed = ts(st['started']), ts(st.get('completed') or st['started'])
    journal = read_jsonl(JOURNAL)
    spans = canary_spans(journal)
    pools_all = all_pools()
    res = {'generated': iso(dt.datetime.now(UTC)), 'model': st.get('model'), 'url': st.get('url'),
           'started': st['started'], 'completed': st.get('completed'), 'win': {}, 'days': ['D%d' % k for k in range(1, 8)]}
    ES_KEYS = ['items_per_bot_h', 'value_per_bot_h', 'deaths_per_bot_h'] + ['%s_success' % k for k in SKILLS] + \
              ['_build_per_bot_h', 'time_outside_skills']
    DEC_KEYS = ['decisions_per_bot_h', 'lat_p50_ms', 'lat_p95_ms', 'lat_p99_ms', 'timeout_share', 'invalid_share',
                'model_share', 'rep_fail', 'veto_repeat', 'refused_share']
    for name, a, b in windows(started, completed):
        if name in ('EXP', 'PRE'):
            res['win'][name + '0'], res['win'][name + '1'] = iso(a), iso(b)
        ex, runs = excluded_pools(spans, a, b)
        segs = segments(spans, a, b)
        d, errs = es_metrics(a, b, pools_all, segs)
        model = st.get('model') if name == 'EXP' else None
        try:
            d.update(file_metrics(a, b, pools_all, segs, model or 'qwen2.5:7b-instruct'))
        except Exception as x:
            errs.append('files: %s: %s' % (type(x).__name__, str(x)[:160]))
        d.update({'excluded': sorted(ex), 'excluded_runs': runs, 'errors': errs, 'confounds': confounds(spans, a, b)})
        res[name] = d
        print('%s %s..%s done (%d errors)' % (name, iso(a), iso(b), len(errs)), flush=True)
    names = set()
    for w in ['EXP', 'PRE']:
        names |= {k for k in res[w] if k.startswith('build') and k.endswith('_success')}
    res['es_keys'] = ES_KEYS + sorted(names)
    res['dec_keys'] = DEC_KEYS
    res['hourly'] = read_jsonl(os.path.join(HOME, 'hourly.jsonl'))
    json.dump(res, open(os.path.join(HOME, 'compare-24h.json'), 'w'), indent=1, default=str)
    md = render(res)
    open(os.path.join(HOME, 'compare-24h.md'), 'w').write(md)
    print(md.split('## Denominators')[0][-1500:])
    return 0


if __name__ == '__main__':
    sys.exit(main())
