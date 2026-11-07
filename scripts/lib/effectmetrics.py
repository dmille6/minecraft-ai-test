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


HAND_NAMES = frozenset(n for n, _ in DETAIL_KEYS)
# GENERIC KEYS (effectfix-01, 11-07: gkstay-01 `_keeper:keeper_take` and idlework-02 `_idlework:met:bag_stop` read 0 forever
# because nobody added them here). A key '<name>:<tok>[:<tok>...]' whose name is NOT one of the hand-listed names above counts
# a row when skill.name == name and the tokens occur IN ORDER among the detail's word tokens ('project=tidy op=keeper_take'
# -> project tidy op keeper_take). The cache counts every generic key a registration or config/effect-targets.json names
# (effectcache.wanted_keys) and records the set it counted per hour (`dk_keys`); an hour that did not count a key is a cache
# hole for it, never a zero. The hand-listed names keep their exact regexes (cache compatibility).
TOKEN_RX = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')


def parse_key(key):
    """'<name>:<tok>:...' -> (name, [tokens]); the name is everything before the first ':'."""
    parts = str(key or '').split(':')
    return parts[0], [t for t in parts[1:] if t]


def is_generic_key(key):
    n, toks = parse_key(key)
    return bool(n) and n not in HAND_NAMES and bool(toks)


def detail_tokens(detail):
    return TOKEN_RX.findall(detail or '')


def generic_match(tokens, detail):
    """PURE. The tokens occur in order among the detail's word tokens."""
    it = iter(detail_tokens(detail))
    return all(any(t == x for x in it) for t in tokens)


def detail_keys(name, detail, wanted=()):
    out = []
    for n, rx in DETAIL_KEYS:
        if n == name:
            m = rx.search(detail or '')
            if m:
                out.append(n + ':' + ':'.join(g for g in m.groups() if g))
    if name not in HAND_NAMES:
        for k in wanted:
            kn, toks = parse_key(k)
            if kn == name and toks and generic_match(toks, detail):
                out.append(k)
    return out


def effect_keys(effect):
    """-> every detail key a detail.* metric of this effect (targets + guardrails) names."""
    out = set()
    if not isinstance(effect, dict):
        return out
    for t in (effect.get('targets') or []) + (effect.get('guardrails') or []):
        if isinstance(t, dict) and str(t.get('metric') or '').startswith('detail.') and isinstance(t.get('params'), dict):
            if t['params'].get('key'):
                out.add(str(t['params']['key']))
    return out


def exposure_model(expo):
    """PURE. effect.exposure is EITHER a dict (a model-env run: {'model': 'qwen3.5'} -- post cells are those whose dominant
    model contains it) OR a string describing the exposed population (every registration since leasegen-01, 11-05; the
    11-07 crash `(expo or {}).get('model')` on a str). Only a dict's non-empty string 'model' filters by model."""
    if isinstance(expo, dict):
        m = expo.get('model')
        return m if isinstance(m, str) and m else None
    return None


VOCAB_TOKENS = 40          # word tokens of one detail folded into the hour's vocabulary (the validator's name list)


def add_vocab(vocab, row):
    """Fold one skill row into an HOUR-level vocabulary {name: {token: rows}} (fleet-wide, not per cell): what the
    registration validator calls "seen in the last 7 days" and draws the nearest names from."""
    sk = row.get('skill') or {}
    n = sk.get('name')
    if not n:
        return
    d = vocab.setdefault(n, {})
    for t in set(detail_tokens(sk.get('detail'))[:VOCAB_TOKENS]):
        if len(t) <= 40:
            d[t] = d.get(t, 0) + 1


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


def add_skill_row(cell, row, wanted=()):
    """Fold one skill-stream row (the raw dict) into a cell. PURE. wanted: the generic detail keys to count."""
    sk = row.get('skill') or {}
    n = sk.get('name')
    if not n:
        return
    st = sk.get('status') or '-'
    cell['rows'] += 1
    _inc(cell['k'], f'{n}|{st}')
    if sk.get('fail_class'):
        _inc(cell['fc'], f'{n}|{sk["fail_class"]}')
    for key in detail_keys(n, sk.get('detail'), wanted):
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
    extra = set(effect) - {'version', 'targets', 'guardrails', 'none_reason', 'note', 'retrospective', 'exposure',
                           'correction'}
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
            if t.get('metric', '').startswith('detail.') and 'key' in p:
                kn, toks = parse_key(p['key'])
                if not kn or (kn not in HAND_NAMES and not toks):
                    bad.append(f'{w}: detail key {p["key"]!r} needs <name>:<token>[:<token>...] (a bare name is kind.rate.v1)')
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


# ---- seen in the logs (effectfix-01: the ZeroLooksWrong rule applied to a registration) ---------------------------------
SEEN_DAYS = 7


def _near(word, pool, n=3):
    import difflib
    pool = sorted(set(pool))
    out = [x for x in pool if x != word and (x == '_' + word or x.lstrip('_') == word.lstrip('_'))]
    out += [x for x in difflib.get_close_matches(word, pool, n=n + 2, cutoff=0.5) if x not in out and x != word]
    return out[:n]


def seen_index(hours):
    """hours: iterable of cache hour objects (effectcache.load_hour). -> the names the window holds: skill names, name|status,
    name|fail_class, detail keys counted, veto errors, busy classes, the hour vocabularies, and how many hours had one."""
    ix = {'hours': 0, 'rows': 0, 'names': set(), 'status': set(), 'fc': set(), 'dk': {}, 'err': set(), 'busy': set(),
          'vocab': {}, 'vocab_hours': 0, 'counted': set(), 'counted_hours': {}}
    for hd in hours:
        if not hd:
            continue
        ix['hours'] += 1
        ix['counted'] |= set(hd.get('dk_keys') or [])
        for k in set(hd.get('dk_keys') or []):
            ix['counted_hours'][k] = ix['counted_hours'].get(k, 0) + 1
        if isinstance(hd.get('vocab'), dict):
            ix['vocab_hours'] += 1
            for n, toks in hd['vocab'].items():
                v = ix['vocab'].setdefault(n, {})
                for t, c in toks.items():
                    v[t] = v.get(t, 0) + c
        for builds in (hd.get('bots') or {}).values():
            for c in builds.values():
                ix['rows'] += c.get('rows', 0)
                for k, v in (c.get('k') or {}).items():
                    if v:
                        ix['status'].add(k)
                        ix['names'].add(k.rsplit('|', 1)[0])
                ix['fc'] |= {k for k, v in (c.get('fc') or {}).items() if v}
                for k, v in (c.get('dk') or {}).items():
                    ix['dk'][k] = ix['dk'].get(k, 0) + v
                ix['err'] |= {k for k, v in ((c.get('llm') or {}).get('err') or {}).items() if v}
                ix['busy'] |= {k for k, v in (c.get('busy') or {}).items() if v}
    return ix


def new_instrument_ok(kind, t):
    """An ABSOLUTE INCREASE target may count a row the base build cannot write (a new instrument: delta = post - base
    reads from a zero baseline). Its never-seen name is a warning, not a refusal (Claude review r1 BLOCKER 2)."""
    return kind == 'target' and t.get('scale') == 'absolute' and t.get('direction') == 'increase'


def seen_problems(effect, ix):
    return seen_report(effect, ix)[0]


def seen_report(effect, ix):
    """PURE. -> (problems, warnings): every name a target or guardrail counts must occur somewhere in the window (default
    the last SEEN_DAYS days), with the nearest names that DO occur. A window with no rows is itself a problem (a positive
    control: an empty cache never passes a registration)."""
    if ix['hours'] == 0 or ix['rows'] == 0:
        return [f'the cache window holds {ix["hours"]} hour(s) and {ix["rows"]} rows: nothing can be checked'], []
    out, warn = [], []
    names = ix['names']
    for kind, lst in (('target', effect.get('targets') or []), ('guardrail', effect.get('guardrails') or [])):
        for i, t in enumerate(lst):
            bad = warn if new_instrument_ok(kind, t) else out
            w = f'{kind} {i} {t.get("metric")}'
            p = t.get('params') or {}
            m = t.get('metric', '')
            for pk in ('name', 'of_name'):
                if pk in p and p[pk] not in names:
                    bad.append(f'{w}: skill.name {p[pk]!r} never occurs (nearest: {", ".join(_near(p[pk], names)) or "-"})')
            if m in ('kind.rate.v1', 'skill.share.v1') and p.get('name') in names and p.get('status') is not None:
                for st in ([p['status']] if not isinstance(p['status'], list) else p['status']):
                    if f'{p["name"]}|{st}' not in ix['status']:
                        have = sorted(k.rsplit('|', 1)[1] for k in ix['status'] if k.rsplit('|', 1)[0] == p['name'])
                        bad.append(f'{w}: {p["name"]} never has status {st!r} (it has: {", ".join(have[:8])})')
            if m.startswith('failclass.') and p.get('name') in names:
                if f'{p["name"]}|{p.get("fail_class")}' not in ix['fc']:
                    have = [k.split('|', 1)[1] for k in ix['fc'] if k.split('|', 1)[0] == p['name']]
                    bad.append(f'{w}: {p["name"]} never has fail_class {p.get("fail_class")!r} '
                               f'(nearest: {", ".join(_near(str(p.get("fail_class")), have)) or "-"})')
            if m.startswith('detail.') and p.get('key'):
                key = p['key']
                kn, toks = parse_key(key)
                if ix['dk'].get(key):
                    continue
                if kn not in names:
                    bad.append(f'{w}: key {key!r}: skill.name {kn!r} never occurs (nearest: {", ".join(_near(kn, names)) or "-"})')
                elif kn in HAND_NAMES or ix['counted_hours'].get(key, 0) >= ix['hours']:
                    # a hand key, or a generic key EVERY hour of the window counted (Codex review r1 BLOCKER 4: one rebuilt
                    # hour with no match must not refuse a key the hours not yet rebuilt hold): it truly never occurred
                    have = sorted((k for k in ix['dk'] if k.startswith(kn + ':')), key=lambda k: -ix['dk'][k])
                    bad.append(f'{w}: key {key!r} was never counted (nearest: {", ".join(_near(key, have)) or "-"})')
                elif ix['vocab_hours'] == 0:
                    bad.append(f'{w}: generic key {key!r}: no cache hour in the window has a vocabulary yet (rebuild)')
                else:
                    voc = ix['vocab'].get(kn) or {}
                    miss = [x for x in toks if x not in voc]
                    if miss:
                        top = sorted(voc, key=lambda x: -voc[x])
                        bad.append(f'{w}: key {key!r}: token(s) {miss} never occur in {kn} details '
                                   f'(nearest: {", ".join(sorted({y for x in miss for y in _near(x, top[:400])})) or "-"})')
            if m == 'llm.veto_share.v1' and p.get('error') and p['error'] not in ix['err']:
                bad.append(f'{w}: veto error {p["error"]!r} never occurs (nearest: {", ".join(_near(p["error"], ix["err"])) or "-"})')
            if m == 'busy.share.v1' and not any(c in ix['busy'] for c in _busy_classes(p.get('cls'))):
                bad.append(f'{w}: busy class {p.get("cls")!r} never occurs (classes: {", ".join(sorted(ix["busy"]))})')
    return out, warn
