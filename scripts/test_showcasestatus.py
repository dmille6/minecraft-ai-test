#!/usr/bin/env python3
"""The SHOWCASE BRAIN line judges the decision rows against the brain the showcase is SET to (monfix-01, 2026-11-16).

Behaviour tests for lib/showcasestatus.py (brain_expected, brain_off, brain_line) and for fleetstatus.showcase_report's
use of them, on fakes: no network. Then MUTANTS: each changes one decision in the source (anchor asserted present and
unique), and the test that pins it must fail on the mutated copy.

WHY. The owner made qwen2.5:7b-instruct on the 5080 (http://10.0.0.72:11434, /srv/showcase/BRAIN.json on 10.0.0.40) the
showcase's permanent brain on 11-16. fleetstatus runs on another host and had the Studio proxy and gemma4 written into it,
so it printed `gemma4 0 (0.0%), fallback/other 3323 (100.0%) ...; 2941 rows from a NON-showcase endpoint (must be 0)`:
every one of those 2,941 rows was a decision the SET endpoint served. The other 382 carried no endpoint at all: work
orders (the scheduler chose, no model was asked; latency 0 on all 371 such rows of a later 3 h window).

    python3 -B scripts/test_showcasestatus.py        (exit 1 on any failure or surviving mutant)
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 16, 19, 55, tzinfo=UTC)
FAILS = []

QWEN = {'url': 'http://10.0.0.72:11434', 'model': 'qwen2.5:7b-instruct', 'kind': 'ollama'}
PROXY = {'url': 'http://127.0.0.1:11612', 'model': 'gemma4:26b', 'kind': 'proxy'}
MISSING = '<missing>'          # lib.estelemetry.MISSING (asserted in t_report)
# the 19:02Z report's own rows: 3,323 decisions, all named qwen2.5; 2,941 at the 5080, 382 with no endpoint
MODELS, ENDPOINTS, TOTAL = {'qwen2.5:7b-instruct': 3323}, {'http://10.0.0.72:11434': 2941}, 3323


def load(rel, src_text=None):
    path = os.path.join(HERE, rel)
    if src_text is not None:
        fd, tmp = tempfile.mkstemp(suffix='.py', dir=os.path.dirname(path))
        os.write(fd, src_text.encode()); os.close(fd)
    spec = importlib.util.spec_from_file_location('m_' + os.path.basename(rel)[:-3] + ('_mut' if src_text is not None else ''),
                                                  tmp if src_text is not None else path)
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(tmp)
    return m


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} :: {str(detail)[:300]}')


def hb(minutes_ago, brain, now=NOW):
    return {'t': (now - dt.timedelta(minutes=minutes_ago)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'kind': 'showcase_timelapse',
            'ok': True, 'capture_min': 15, 'brain': brain}


# ------------------------------------------------------------------------------------------------ the setting, as carried
def t_expected(SS):
    setting = dict(QWEN, ok=True)
    check('expected: the newest heartbeat names the set brain', SS.brain_expected([hb(10, setting)], NOW) == (QWEN, None),
          SS.brain_expected([hb(10, setting)], NOW))
    check('expected: a dark endpoint is still the set one',
          SS.brain_expected([hb(10, dict(QWEN, ok=False, error='URLError: refused'))], NOW)[0] == QWEN)
    e, why = SS.brain_expected([hb(10, {'ok': True})], NOW)          # what tl_showcase.py wrote before monfix-01
    check('expected: a heartbeat that names no setting is UNREAD, never a default', e is None and 'names no brain setting' in why
          and 'older than monfix-01' in why, (e, why))
    e, why = SS.brain_expected([hb(10, {'ok': False, 'error': 'the brain setting is unreadable (ValueError: not JSON)'})], NOW)
    check('expected: an unreadable BRAIN.json says so', e is None and 'the brain setting is unreadable (ValueError' in why, (e, why))
    e, why = SS.brain_expected([hb(200, setting)], NOW)
    check('expected: a setting last heard 3.3 h ago is unread', e is None and '3.3 h old' in why, (e, why))
    check('expected: ... and one heard 110 min ago is read (positive control)', SS.brain_expected([hb(110, setting)], NOW)[0] == QWEN)
    e, why = SS.brain_expected([hb(40, setting), hb(10, {'ok': True})], NOW)
    check('expected: an older setting is not remembered past a newer heartbeat without one', e is None, (e, why))
    check('expected: the newest of several wins', SS.brain_expected([hb(10, dict(PROXY, ok=True)), hb(40, setting)], NOW)[0] == PROXY)
    for rows in ([], None, [{'t': '2026-11-16T19:45:00Z', 'brain': None}], [{'brain': setting}]):
        e, why = SS.brain_expected(rows, NOW)
        check('expected: no heartbeat with a brain object is unread', e is None and 'no heartbeat row carries a brain object' in why, (rows, e, why))
    e, why = SS.brain_expected([{'t': 'yesterday', 'brain': setting}], NOW)
    check('expected: a time that does not parse is unread, not a crash', e is None and 'no readable time' in why, (e, why))
    for bad in (dict(setting, url=''), dict(setting, model=None), dict(setting, url=7)):
        check('expected: half a setting is unread', SS.brain_expected([hb(10, bad)], NOW)[0] is None, bad)


# ------------------------------------------------------------------------------------------------ the line
def t_line(SS):
    ok = SS.brain_line(MODELS, 0, TOTAL, ENDPOINTS, QWEN)
    check('line: the 19:02Z rows against the set brain are healthy', not ok.startswith('!!') and 'NOT THE SET BRAIN' not in ok, ok)
    check('line: ... with every denominator', ok.startswith('SHOWCASE BRAIN: 3323 decisions; qwen2.5:7b-instruct 3323 (100.0%), other models 0 (0.0%)')
          and 'unserved 0 (0.0%)' in ok and 'at the set endpoint 2941, no endpoint 382 (work orders: no model asked), elsewhere 0' in ok
          and '[set: ollama qwen2.5:7b-instruct at http://10.0.0.72:11434]' in ok, ok)
    check('line: brain_off says 0 and 0', SS.brain_off(MODELS, ENDPOINTS, QWEN) == (0, 0), SS.brain_off(MODELS, ENDPOINTS, QWEN))

    other = SS.brain_line({'qwen2.5:7b-instruct': 3000, 'qwen3.5:4b': 323}, 0, TOTAL, ENDPOINTS, QWEN)
    check('line: rows by another model ALARM and name it', other.startswith('!! SHOWCASE BRAIN: 3323 decisions')
          and 'NOT THE SET BRAIN (must be 0): 323 rows by a model that is not the set one (qwen3.5:4b x323)' in other
          and 'other models 323 (9.7%)' in other, other)
    away = SS.brain_line(MODELS, 0, TOTAL, {'http://10.0.0.72:11434': 2900, 'http://10.0.0.16:11434': 41}, QWEN)
    check('line: rows at another endpoint ALARM and name it', away.startswith('!! ')
          and '41 rows at an endpoint that is not the set one (http://10.0.0.16:11434 x41)' in away and 'elsewhere 41' in away, away)
    # the reader this replaces called exactly this healthy: gemma4 at the Studio proxy
    old = SS.brain_line({'gemma4:26b': 3323}, 0, TOTAL, {'http://127.0.0.1:11612': 2941}, QWEN)
    check('line: gemma4 at the Studio proxy is NOT the set brain now', old.startswith('!! ') and 'gemma4:26b x3323' in old
          and 'http://127.0.0.1:11612 x2941' in old and 'qwen2.5:7b-instruct 0 (0.0%)' in old, old)
    check('line: ... and brain_off counts both', SS.brain_off({'gemma4:26b': 3323}, {'http://127.0.0.1:11612': 2941}, QWEN) == (3323, 2941))

    unread = SS.brain_line(MODELS, 0, TOTAL, ENDPOINTS, None, 'the heartbeat of 2026-11-16T19:45:00Z names no brain setting')
    check('line: an unread setting ALARMS and judges nothing', unread.startswith('!! SHOWCASE BRAIN: the brain setting is UNREAD (the heartbeat of')
          and '3323 llm rows NOT JUDGED against it' in unread and 'NOT THE SET BRAIN' not in unread, unread)
    check('line: ... and still shows what was seen', "{'qwen2.5:7b-instruct': 3323}" in unread and 'http://10.0.0.72:11434 2941' in unread
          and 'no endpoint 382' in unread, unread)
    check('line: unknown is not zero', SS.brain_off(MODELS, ENDPOINTS, None) == (None, None))
    check('line: no rows and no setting is an alarm too', SS.brain_line({}, 0, 0, {}, None, 'x').startswith('!! SHOWCASE BRAIN: no llm rows'))
    none = SS.brain_line({}, 0, 0, {}, QWEN)
    check('line: no rows under a read setting is the plain zero, with the setting', none.startswith('SHOWCASE BRAIN: no llm rows in the window')
          and '[set: ollama qwen2.5:7b-instruct' in none, none)

    fam = SS.brain_line({'gemma4:26b-it-q4': 95, 'qwen2.5:7b-instruct': 5}, 5, 105, {'http://127.0.0.1:11612': 100}, PROXY)
    check('line: behind the designed proxy the family is the set model; its fallback is not', fam.startswith('!! ')
          and 'gemma4:26b 95 (90.5%)' in fam and 'qwen2.5:7b-instruct x5' in fam and 'gemma4:26b-it-q4 x' not in fam
          and 'unserved 5 (4.8%)' in fam, fam)
    exact = SS.brain_line({'qwen2.5:14b': 10}, 0, 10, {'http://10.0.0.72:11434': 10}, QWEN)
    check('line: on a plain Ollama another tag of the family is another model', exact.startswith('!! ') and 'qwen2.5:14b x10' in exact, exact)


# ------------------------------------------------------------------------------------------------ fleetstatus wiring
class FakeStream:
    def __init__(self, n, terms):
        self.n, self.t = n, terms

    def total(self):
        return self.n

    def terms(self, field, allow_zero=False):
        return dict(self.t.get(field) or {})

    def bots_present(self):
        return ['showcase-Alpha', 'showcase-Bravo']

    def count(self, name, allow_zero=False):
        return 0


def report(FS, models, endpoints, n, hb_rows, hb_dead=False):
    def client(method, path, body=None, timeout=120):
        if '_count' in path:
            return {'count': 0}
        if 'showcase_timelapse' in json.dumps(body):
            if hb_dead:
                raise RuntimeError('ops index refused')
            return {'hits': {'hits': [{'_source': r} for r in hb_rows]}}
        return {'hits': {'hits': []}}
    real = FS.EsEvents.load
    FS.EsEvents.load = lambda stream, **kw: FakeStream(n, {'llm.model': models, 'llm.endpoint': endpoints, 'code.version': {'6ed264b9': n}})
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return FS.showcase_report(NOW, client=client)
    finally:
        FS.EsEvents.load = real


def t_report(FS):
    check('report: the fake speaks estelemetry\'s MISSING (positive control)', FS._est.MISSING == MISSING, FS._est.MISSING)
    eps = dict(ENDPOINTS, **{MISSING: 382})
    out = report(FS, MODELS, eps, TOTAL, [hb(10, dict(QWEN, ok=True)), hb(25, dict(QWEN, ok=True))])
    brain = [l for l in out['lines'] if 'SHOWCASE BRAIN' in l]
    check('report: the 19:02Z rows under the set brain -> one healthy line', len(brain) == 1 and not brain[0].startswith('!!')
          and 'at the set endpoint 2941, no endpoint 382' in brain[0] and 'elsewhere 0' in brain[0], brain)
    check('report: the JSON carries the setting and both counts', out.get('brain_expected') == QWEN and out.get('brain_unread') is None
          and out.get('foreign_endpoint_rows') == 0 and out.get('other_model_rows') == 0 and out.get('endpoints') == ENDPOINTS, out)
    i_b = next(i for i, l in enumerate(out['lines']) if 'SHOWCASE BRAIN' in l)
    i_t = next(i for i, l in enumerate(out['lines']) if 'SHOWCASE TIMELAPSE' in l)
    check('report: the BRAIN line still comes before the TIMELAPSE line (statusreport takes the first BRAIN line)', i_b < i_t, out['lines'])

    out = report(FS, MODELS, eps, TOTAL, [hb(10, {'ok': True})])           # today's heartbeat: no setting in it
    brain = [l for l in out['lines'] if 'SHOWCASE BRAIN' in l]
    check('report: a heartbeat without the setting -> UNREAD, an alarm, nothing judged', len(brain) == 1
          and brain[0].startswith('!! SHOWCASE BRAIN: the brain setting is UNREAD') and 'NOT JUDGED' in brain[0], brain)
    check('report: ... and the counts are unknown, not 0', out.get('foreign_endpoint_rows') is None and out.get('other_model_rows') is None
          and out.get('brain_expected') is None and 'names no brain setting' in str(out.get('brain_unread')), out)

    out = report(FS, MODELS, eps, TOTAL, [], hb_dead=True)
    brain = [l for l in out['lines'] if 'SHOWCASE BRAIN' in l]
    check('report: an unreadable heartbeat -> UNREAD with the reason', len(brain) == 1 and brain[0].startswith('!! ')
          and 'UNREAD (the heartbeat is unreadable (RuntimeError: ops index refused)' in brain[0], brain)
    check('report: ... and the timelapse line still says its own', any(l.startswith('SHOWCASE TIMELAPSE: heartbeat unreadable (RuntimeError')
                                                                      for l in out['lines']), out['lines'])

    out = report(FS, {'qwen2.5:7b-instruct': 3000, 'gemma4:26b': 323}, {'http://10.0.0.72:11434': 2700, 'http://127.0.0.1:11612': 323, MISSING: 300},
                 TOTAL, [hb(10, dict(QWEN, ok=True))])
    brain = [l for l in out['lines'] if 'SHOWCASE BRAIN' in l]
    check('report: rows from the Studio proxy and gemma4 under a qwen setting ALARM', len(brain) == 1 and brain[0].startswith('!! SHOWCASE BRAIN: 3323 decisions')
          and 'gemma4:26b x323' in brain[0] and 'http://127.0.0.1:11612 x323' in brain[0], brain)
    check('report: ... counted in the JSON', (out.get('other_model_rows'), out.get('foreign_endpoint_rows')) == (323, 323), out)

    out = report(FS, {'qwen2.5:7b-instruct': 100}, {'http://10.0.0.72:11434': 100}, 100,
                 [hb(10, dict(QWEN, ok=False, error='qwen2.5:7b-instruct is not on the endpoint (2 models listed)'))])
    check('report: a DOWN brain keeps its own line after the judged one',
          [l.split(':')[0] for l in out['lines'] if 'BRAIN' in l] == ['SHOWCASE BRAIN', 'SHOWCASE BRAIN DOWN at 2026-11-16T19'], out['lines'])


MUTANTS = [
    ('lib/showcasestatus.py', "    if age > stale:\n", "    if False:\n", t_expected),
    ('lib/showcasestatus.py', "    if not (isinstance(url, str) and url and isinstance(model, str) and model):", "    if False:", t_expected),
    ('lib/showcasestatus.py', "    r = rows[-1]\n    try:\n        age = now - _t(r['t'])",
     "    r = next((x for x in reversed(rows) if x['brain'].get('url')), rows[-1])\n    try:\n        age = now - _t(r['t'])", t_expected),
    ('lib/showcasestatus.py', "    if not rows:\n        return None, 'no heartbeat row carries a brain object'",
     "    if not rows:\n        return {'url': 'http://127.0.0.1:11612', 'model': 'gemma4:26b', 'kind': 'proxy'}, None", t_expected),
    ('lib/showcasestatus.py', "    return m == want or (expect.get('kind') == 'proxy' and", "    return True or (expect.get('kind') == 'proxy' and", t_line),
    ('lib/showcasestatus.py', "    return m == want or (expect.get('kind') == 'proxy' and", "    return m == want or (True and", t_line),
    ('lib/showcasestatus.py', "            sum(n for u, n in endpoints.items() if u != expect['url']))", "            0)", t_line),
    ('lib/showcasestatus.py', "    return (('!! ' if bad else '')\n", "    return ((''\n", t_line),
    ('lib/showcasestatus.py', "        return (f'!! SHOWCASE BRAIN: {why} -- {total} llm rows NOT JUDGED against it: models '",
     "        return (f'SHOWCASE BRAIN: {why} -- {total} llm rows NOT JUDGED against it: models '", t_line),
    ('lib/showcasestatus.py', "    if not expect:\n        return None, None\n", "    if not expect:\n        return 0, 0\n", t_line),
    ('host/fleetstatus.py', "            else SS.brain_expected(rows, until)",
     "            else ({'url': 'http://127.0.0.1:11612', 'model': 'gemma4:26b', 'kind': 'proxy'}, None)", t_report),
    ('host/fleetstatus.py', "        eps = {k: v for k, v in eps.items() if k != _est.MISSING}\n", "", t_report),
    ('host/fleetstatus.py', "        expect, unread = (None, f'the heartbeat is unreadable ({type(hb_err).__name__}: {str(hb_err)[:80]})') if rows is None \\",
     "        expect, unread = ({'url': 'http://10.0.0.72:11434', 'model': 'qwen2.5:7b-instruct', 'kind': 'ollama'}, None) if rows is None \\", t_report),
]


def main():
    SS, FS = load('lib/showcasestatus.py'), load('host/fleetstatus.py')
    t_expected(SS); t_line(SS); t_report(FS)
    base = list(FAILS)
    for f in base:
        print('FAIL', f)
    killed = 0
    for fn, old, new, test in MUTANTS:
        src = open(os.path.join(HERE, fn)).read()
        code = '\n'.join('' if ln.lstrip().startswith('#') else ln for ln in src.split('\n'))
        assert src.count(old) == 1 and code.count(old) == 1, f'MUTANT ANCHOR MISSING OR NOT UNIQUE in {fn}: {old!r} x{src.count(old)}'
        FAILS.clear()
        try:
            test(load(fn, src.replace(old, new)))
        except Exception as e:      # a crash is a kill too, but say so
            FAILS.append(f'crash {type(e).__name__}: {e}')
        if FAILS:
            killed += 1
        else:
            print(f'MUTANT SURVIVED: {fn}: {old.strip()[:80]!r}')
    FAILS[:] = base
    print(f'showcase brain line: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
