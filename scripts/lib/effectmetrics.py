"""effectmetrics.py -- the named, versioned metrics a promotion's EFFECT is judged on (effectwatch-01, OWNER 11-03 item 1).

A registration never carries a query. It names a metric from METRICS plus parameters and a direction:

    "effect": {
      "version": 1,
      "targets": [{"metric": "llm.calls_per_bot_hour.v1", "params": {}, "direction": "decrease",
                   "minimum": 0.15, "scale": "relative", "claim": "~96 -> ~79 calls/min fleet", "primary": true}],
      "guardrails": [{"metric": "items.per_bot_hour.v1", "params": {}, "direction": "increase"}],
      "none_reason": null
    }

  targets      >= 1 unless none_reason says why the change has no fleet-measurable target (a guard, a trap fix with no
               fleet population). A run with neither is UNREADABLE "no effect declared" and alarms: declare it.
  minimum      the smallest change that counts, relative (0.15 = 15 %) or absolute (0.05 = 5 points of a share).
  guardrails   must not get WORSE; their verdict counts only when it is WORSE.
  window_h     optional, 24 (default) or 72. A rare-event metric (deaths) is read on 72-h windows at +72 h only.

The scheduler never reads this field (its H3 check hashes the file; nothing here changes launch or promotion). For a run
whose registration has no `effect`, config/effect-targets.json supplies one (the backfill since 10-28, and entries written
ahead for queued runs); a registration's own field wins.

Every metric is computed from the hourly cache cells (scripts/host/effectcache.py): one cell per (bot, hour, build), built
from BOTH streams with lib/telemetry.stream_rows -- rotated files included. A metric is a ratio of SUMS over cells
(never a mean of per-bot ratios) and always reports its numerator and denominator.
"""
import re

SCHEMA_VERSION = 1
CELL_SCHEMA = 3          # 3: work-order rows of the llm stream are not model calls (Claude review r1)

# ---- detail keys the cache counts (key = '<name>:' + the regex groups joined by ':') -------------------------------------
# ADDING A KEY needs a cache rebuild over the days it must cover (effectcache.py build --from ... --rebuild).
DETAIL_KEYS = (
    ('_build', re.compile(r'\bproject=(\w+) op=(\w+)')),
    ('_build_visit', re.compile(r'\bproject=(\w+) outcome=(\w+)')),
    ('_lid_clear', re.compile(r'\boutcome=(\w+)\b.*?\blid=(\w+)')),
    ('_withdraw_pick', re.compile(r'\boutcome=(\w+)')),
    ('_furnace_drain', re.compile(r'\bstop=(\w+)')),
    ('_deepmine', re.compile(r'\bop=(\w+)(?:.*?\bend=(\w+))?')),
    ('_shaft_use', re.compile(r'\bok=(\d)')),
    ('_coal_run', re.compile(r'\bskip=(\w+)')),
    ('_decision_skipped', re.compile(r'\brule=(\w+)')),
)


def detail_keys(name, detail):
    out = []
    for n, rx in DETAIL_KEYS:
        if n == name:
            m = rx.search(detail or '')
            if m:
                out.append(n + ':' + ':'.join(g for g in m.groups() if g))
    return out


def gather_key(args):
    """gather rows are also counted per block family: 'gather_log' for any *_log block (logsurface-01's population)."""
    b = str((args or {}).get('block') or '')
    return 'gather_log' if b.endswith('_log') else None


def new_cell(pool):
    return {'pool': pool, 'rows': 0, 'k': {}, 'fc': {}, 'dk': {}, 'dur': {}, 'items': 0,
            'llm': {'n': 0, 'orders': 0, 'lat_ms': 0, 'ptok': 0, 'ptok_n': 0, 'valid': 0, 'err': {}, 'trig': {}, 'model': {}},
            'busy': {}}


def _inc(d, k, v=1):
    d[k] = d.get(k, 0) + v


def add_skill_row(cell, row):
    """Fold one skill-stream row (the raw dict) into a cell. PURE."""
    sk = row.get('skill') or {}
    n = sk.get('name')
    if not n:
        return
    st = sk.get('status') or '-'
    cell['rows'] += 1
    _inc(cell['k'], f'{n}|{st}')
    if sk.get('fail_class'):
        _inc(cell['fc'], f'{n}|{sk["fail_class"]}')
    for key in detail_keys(n, sk.get('detail')):
        _inc(cell['dk'], key)
    if n == 'gather':
        g = gather_key(sk.get('args'))
        if g:
            _inc(cell['k'], f'{g}|{st}')
    if not n.startswith('_'):
        try:
            _inc(cell['dur'], n, int(sk.get('duration_ms') or 0))
        except (TypeError, ValueError):
            pass
        for v in (sk.get('inventory_delta') or {}).values():
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
                cell['items'] += v


def is_model_call(row):
    """cognitive.mjs writes an llm row for every WORK ORDER too (CONTINUE continuations included): latency 0, no
    completion_tokens, no model asked. Only a row with completion_tokens set is a model call (11-03 host: 1,951 calls +
    164 order rows for one bot-day, no overlap)."""
    return (row.get('llm') or {}).get('completion_tokens') is not None


def add_llm_row(cell, row):
    L = row.get('llm') or {}
    c = cell['llm']
    if not is_model_call(row):
        c['orders'] += 1
        _inc(c['trig'], 'order:' + str(row.get('trigger') or '-'))
        return
    c['n'] += 1
    try:
        c['lat_ms'] += int(L.get('latency_ms') or 0)
    except (TypeError, ValueError):
        pass
    pt = L.get('prompt_tokens')
    if isinstance(pt, (int, float)) and not isinstance(pt, bool) and pt > 0:
        c['ptok'] += pt
        c['ptok_n'] += 1
    if L.get('schema_valid') is True:
        c['valid'] += 1
    _inc(c['err'], str(L.get('error') or '-'))
    _inc(c['trig'], str(row.get('trigger') or '-'))
    _inc(c['model'], str(L.get('model') or '-'))


# ---- metric families ---------------------------------------------------------------------------------------------------
# Each: kind ('rate' per observed bot-hour, 'share' num/den, 'mean' num/den), params it accepts (required ones without
# '?'), num(cell, p), den(cell, p). obs_h comes from the busy-time accounting of the same cell.

def obs_h(cell):
    b = cell.get('busy') or {}
    return sum(v for k, v in b.items() if k != 'unobserved') / 3600.0


def kcount(cell, name, statuses=None):
    if statuses is None:
        return sum(v for k, v in cell['k'].items() if k.rsplit('|', 1)[0] == name)
    return sum(cell['k'].get(f'{name}|{s}', 0) for s in statuses)


def _statuses(p):
    s = p.get('status')
    return None if s is None else ([s] if isinstance(s, str) else list(s))


METRICS = {
    'kind.rate.v1': {
        'kind': 'rate', 'params': ('name', 'status?'),
        'num': lambda c, p: kcount(c, p['name'], _statuses(p)), 'den': lambda c, p: obs_h(c),
        'doc': 'rows of skill.name (optionally with status) per observed bot-hour'},
    'skill.share.v1': {
        'kind': 'share', 'params': ('name', 'status'),
        'num': lambda c, p: kcount(c, p['name'], _statuses(p)), 'den': lambda c, p: kcount(c, p['name']),
        'doc': 'share of skill.name rows with the given status(es)'},
    'failclass.share.v1': {
        'kind': 'share', 'params': ('name', 'fail_class'),
        'num': lambda c, p: c['fc'].get(f'{p["name"]}|{p["fail_class"]}', 0), 'den': lambda c, p: kcount(c, p['name']),
        'doc': 'share of skill.name rows with the given fail_class'},
    'failclass.rate.v1': {
        'kind': 'rate', 'params': ('name', 'fail_class'),
        'num': lambda c, p: c['fc'].get(f'{p["name"]}|{p["fail_class"]}', 0), 'den': lambda c, p: obs_h(c),
        'doc': 'rows of skill.name with fail_class per observed bot-hour (deaths: name=_death)'},
    'detail.rate.v1': {
        'kind': 'rate', 'params': ('key',),
        'num': lambda c, p: c['dk'].get(p['key'], 0), 'den': lambda c, p: obs_h(c),
        'doc': 'DETAIL_KEYS key per observed bot-hour'},
    'detail.share.v1': {
        'kind': 'share', 'params': ('key', 'of_name'),
        'num': lambda c, p: c['dk'].get(p['key'], 0), 'den': lambda c, p: kcount(c, p['of_name']),
        'doc': 'DETAIL_KEYS key as a share of all rows of of_name'},
    'llm.calls_per_bot_hour.v1': {
        'kind': 'rate', 'params': (),
        'num': lambda c, p: c['llm']['n'], 'den': lambda c, p: obs_h(c),
        'doc': 'model calls (llm-<bot>.jsonl rows) per observed bot-hour'},
    'llm.veto_share.v1': {
        'kind': 'share', 'params': ('error?',),
        'num': lambda c, p: (c['llm']['err'].get(p['error'], 0) if p.get('error')
                             else c['llm']['n'] - c['llm']['err'].get('-', 0)),
        'den': lambda c, p: c['llm']['n'], 'doc': 'share of model calls the gate rejected (llm.error set)'},
    'llm.prompt_tokens_mean.v1': {
        'kind': 'mean', 'params': (),
        'num': lambda c, p: c['llm']['ptok'], 'den': lambda c, p: c['llm']['ptok_n'],
        'doc': 'mean prompt_tokens per model call'},
    'llm.schema_valid_share.v1': {
        'kind': 'share', 'params': (),
        'num': lambda c, p: c['llm']['valid'], 'den': lambda c, p: c['llm']['n'],
        'doc': 'share of model calls with schema_valid true'},
    'llm.latency_mean_ms.v1': {
        'kind': 'mean', 'params': (),
        'num': lambda c, p: c['llm']['lat_ms'], 'den': lambda c, p: c['llm']['n'],
        'doc': 'mean model-call latency (ms)'},
    'busy.share.v1': {
        'kind': 'share', 'params': ('cls',),
        'num': lambda c, p: sum((c.get('busy') or {}).get(k, 0) for k in _busy_classes(p['cls'])),
        'den': lambda c, p: obs_h(c) * 3600.0,
        'doc': 'share of observed bot-seconds in a busy-time class (productive, walking, decision, idle, ...)'},
    'items.per_bot_hour.v1': {
        'kind': 'rate', 'params': (),
        'num': lambda c, p: c['items'], 'den': lambda c, p: obs_h(c),
        'doc': 'items gained (positive inventory_delta of skill rows) per observed bot-hour'},
}


def _busy_classes(cls):
    return {'decision': ('llm_wait', 'paused', 'between'), 'idle': ('idle', 'dead'),
            'skills': ('productive', 'walking')}.get(cls, (cls,))


def family(t):
    """Two targets are the SAME FAMILY when they measure the same thing (metric id + params)."""
    return t['metric'] + '|' + '|'.join(f'{k}={t.get("params", {})[k]}' for k in sorted(t.get('params') or {}))


def validate(effect):
    """-> list of problems ('' list = valid). Pure; no data."""
    bad = []
    if not isinstance(effect, dict):
        return ['effect must be an object']
    if effect.get('version') != SCHEMA_VERSION:
        bad.append(f'version must be {SCHEMA_VERSION}')
    extra = set(effect) - {'version', 'targets', 'guardrails', 'none_reason', 'note', 'retrospective', 'exposure'}
    if extra:
        bad.append(f'unknown keys {sorted(extra)}')
    tg = effect.get('targets') or []
    if not tg and not effect.get('none_reason'):
        bad.append('no targets and no none_reason')
    for kind, lst in (('target', tg), ('guardrail', effect.get('guardrails') or [])):
        if not isinstance(lst, list):
            bad.append(f'{kind}s must be a list')
            continue
        for i, t in enumerate(lst):
            w = f'{kind} {i}'
            if not isinstance(t, dict):
                bad.append(f'{w} must be an object')
                continue
            m = METRICS.get(t.get('metric'))
            if m is None:
                bad.append(f'{w}: unknown metric {t.get("metric")!r} (known: {", ".join(sorted(METRICS))})')
                continue
            p = t.get('params') or {}
            if not isinstance(p, dict):
                bad.append(f'{w}: params must be an object')
                continue
            need = {x for x in m['params'] if not x.endswith('?')}
            allow = {x.rstrip('?') for x in m['params']}
            if need - set(p):
                bad.append(f'{w}: {t["metric"]} needs params {sorted(need - set(p))}')
            if set(p) - allow:
                bad.append(f'{w}: {t["metric"]} does not take {sorted(set(p) - allow)}')
            if t.get('direction') not in ('increase', 'decrease'):
                bad.append(f'{w}: direction must be increase or decrease')
            if kind == 'target':
                if not isinstance(t.get('minimum'), (int, float)) or isinstance(t.get('minimum'), bool) or t['minimum'] <= 0:
                    bad.append(f'{w}: minimum must be a number > 0')
                if t.get('scale') not in ('relative', 'absolute'):
                    bad.append(f'{w}: scale must be relative or absolute')
            if t.get('window_h', 24) not in (24, 72):
                bad.append(f'{w}: window_h must be 24 or 72')
    return bad


def measure(cells, metric, params):
    """cells: iterable of (meta, cell) where meta has 'pool' and 'bot'. -> dict with num, den, value, bots, bot_h and
    per-pool (num, den). value is None when den == 0."""
    m = METRICS[metric]
    num = den = 0.0
    bots, pools, bh = set(), {}, 0.0
    for meta, c in cells:
        a, b = float(m['num'](c, params)), float(m['den'](c, params))
        num += a
        den += b
        bh += obs_h(c)
        bots.add(meta['bot'])
        pn = pools.setdefault(meta['pool'], [0.0, 0.0])
        pn[0] += a
        pn[1] += b
    return {'num': num, 'den': den, 'value': (num / den) if den > 0 else None, 'bots': len(bots), 'bot_h': bh,
            'pools': pools, 'kind': m['kind']}
