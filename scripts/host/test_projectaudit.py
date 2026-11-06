#!/usr/bin/env python3
"""Behaviour tests for projectaudit.py (11-06, OWNER: "a daily or scheduled check to see if projects are effective and useful").
The verdict rules on synthetic facts (the showcase tree farm failure replayed is the positive control), the row matching,
the visit grouping, carry-forward, the alarm tiers, and one end-to-end audit over a temp record dir + rotated and live logs.

    python3 scripts/host/test_projectaudit.py        (exit 1 on any failure or a surviving mutant)

Bottom: MUTANTS, each asserting its anchor is present exactly once; the named test must then fail.
"""
import contextlib
import datetime as dt
import gzip
import importlib.util
import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, '..')
sys.path.insert(0, SCRIPTS)
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 6, 13, 50, tzinfo=UTC)
SINCE = NOW - dt.timedelta(days=7)
H = lambda h: dt.timedelta(hours=h)
FAILS = []
PATHS = {'projectaudit.py': os.path.join(HERE, 'projectaudit.py'), 'lib/alarm.py': os.path.join(SCRIPTS, 'lib', 'alarm.py'),
         'lib/alarmhead.py': os.path.join(SCRIPTS, 'lib', 'alarmhead.py'), 'pager.py': os.path.join(HERE, 'pager.py'),
         'stategen.py': os.path.join(HERE, 'stategen.py')}
REGISTRY = os.path.join(SCRIPTS, '..', 'config', 'projectaudit-registry.json')


def load(name, src_text=None):
    path = PATHS[name]
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', dir=os.path.dirname(PATHS[name]))
        os.write(fd, src_text.encode())
        os.close(fd)
    try:
        spec = importlib.util.spec_from_file_location('tpa_%d_%s' % (id(path), os.path.basename(name)[:-3]), path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(path)
    return m


def check(cond, what):
    if not cond:
        FAILS.append(what)


def reg_entry(PA, name):
    return next(e for e in PA.load_registry(REGISTRY) if e['name'] == name)


def facts(**kw):
    f = {'pool': 'showcase', 'home': '0_70_0', 'plot': 'treefarm', 'state': 'complete', 'complete': True,
         'complete_at': dt.datetime(2026, 10, 31, 20, 23, tzinfo=UTC), 'coverage': {'hours': 160, 'covered_hours': 160,
                                                                                    'bot_hours': 2400},
         'use_qty': 0.0, 'use_visits': [], 'fail_visits': [], 'fail_rows': 0, 'fail_reasons': {}, 'last_use': None,
         'last_visit': None, 'upkeep': {'failed_visits': [], 'intact_t': [], 'repaired_t': [], 'failed_outcomes': {}},
         'dormant_coverage': 1.0, 'emitters_missing': []}
    f.update(kw)
    return f


TREEFARM_FAILS = [dt.datetime(2026, 11, 1, 7, 20, tzinfo=UTC), dt.datetime(2026, 11, 1, 7, 21, tzinfo=UTC),
                  dt.datetime(2026, 11, 1, 13, 21, tzinfo=UTC), dt.datetime(2026, 11, 1, 19, 22, tzinfo=UTC),
                  dt.datetime(2026, 11, 2, 12, 36, tzinfo=UTC)]


# ------------------------------------------------------------------------------------------------ tests
def t_match(PA):
    check(PA.value_ok('@plot', 'treefarm', 'treefarm') and not PA.value_ok('@plot', 'cropfarm', 'treefarm'), 'match: @plot')
    check(PA.value_ok('!no_plan', 'walk') and not PA.value_ok('!no_plan', 'no_plan') and not PA.value_ok('!no_plan', None),
          'match: !x (absent is not a match)')
    check(PA.value_ok('~w', 'w/-') and not PA.value_ok('~w', '-/-'), 'match: ~ contains')
    check(PA.value_ok('!~:t0:', '-5,71,8:t1:torch') and not PA.value_ok('!~:t0:', '-5,71,8:t0:torch'), 'match: !~ not contains')
    check(PA.value_ok('>0', '3') and not PA.value_ok('>0', '0') and not PA.value_ok('>0', '-'), 'match: >0')
    check(PA.value_ok(['stock', 'upkeep+stock'], 'upkeep+stock') and not PA.value_ok(['stock'], 'draw'), 'match: list')
    s = {'row': '_build', 'where': {'project': '@plot', 'op': 'harvest', 'kind': 'grown'}}
    d = PA.kv('project=treefarm op=harvest cell=-30,70,19 block=spruce_log kind=grown')
    check(PA.spec_matches(s, '_build', 'success', d, 'treefarm'), 'spec: grown harvest matches')
    check(not PA.spec_matches(s, '_build', 'success', PA.kv('project=treefarm op=harvest kind=grown_failed n=0'), 'treefarm'),
          'spec: grown_failed is not a grown harvest')
    check(not PA.spec_matches(s, '_build', 'success', PA.kv('project=treefarm op=harvest kind=site'), 'treefarm'),
          'spec: a site tree is not farm output')
    check(not PA.spec_matches({'row': '_x', 'where': {'status': 'success'}}, '_x', 'failed', {}, None), 'spec: status')
    check(PA.qty_of({'qty': 'dug'}, PA.kv('kind=draw dug=cobblestone:6 yard=cobblestone:297')) == 6, 'qty: dug=cobblestone:6 -> 6')
    check(PA.qty_of({'qty': 'n'}, {'n': '10'}) == 10 and PA.qty_of({'qty': 1}, {}) == 1, 'qty: n / 1')
    check(PA.qty_of({'qty': ['drew', 'placed']}, {'drew': 'cobblestone:3', 'placed': '-'}) == 3, 'qty: list, "-" is 0')
    reg = PA.load_registry(REGISTRY)
    check(PA.kind_for('shop', reg)['name'] == 'workshop' and PA.kind_for('shopchest', reg)['name'] == 'shopchest',
          'kind_for: shop is the workshop, shopchest is not')
    check(PA.kind_for('cottage1', reg)['name'] == 'house' and PA.kind_for('road', reg)['name'] == 'paths', 'kind_for: globs')
    check(PA.kind_for('nosuchkind', reg) is None, 'kind_for: undeclared -> None')


def t_visits(PA):
    t = dt.datetime(2026, 11, 1, 7, 20, tzinfo=UTC)
    rows = [(t, 'A'), (t + dt.timedelta(seconds=30), 'A'), (t + dt.timedelta(minutes=5), 'A'), (t, 'B'),
            (t + H(6), 'A')]
    v = PA.group_visits(rows)
    check(len(v) == 3, f'visits: 3 rows of A in 5 min = 1 visit, B 1, A 6 h later 1 (got {len(v)})')
    check(PA.upkeep_class('complete', {'placed': '0', 'cleared': '0'}, 'no_effect') == 'intact', 'upkeep: complete/no_effect = intact')
    check(PA.upkeep_class('stuck_on_cell', {'placed': '0'}, 'no_effect') == 'failed', 'upkeep: stuck_on_cell = failed')
    check(PA.upkeep_class('stuck_on_cell', {'placed': '2'}, 'success') == 'repaired', 'upkeep: placed>0 = repaired')
    check(PA.upkeep_class('slots_full', {}, 'no_effect') is None, 'upkeep: slots_full is no attempt')


def t_treefarm(PA):
    """THE POSITIVE CONTROL: the 11-01 tree farm, replayed."""
    e = reg_entry(PA, 'treefarm')
    fv = [(t, t) for t in TREEFARM_FAILS]
    p = facts(fail_visits=fv, fail_rows=74, fail_reasons={'harvest_failed:no_safe_target': 69},
              last_visit=TREEFARM_FAILS[-1])
    v, why = PA.judge(p, e, NOW, SINCE)
    check(v == 'BROKEN', f'treefarm replay: BROKEN (got {v}: {why})')
    check('nothing has visited since 11-02 12:36Z' in why, f'treefarm replay names the silence since 11-02: {why}')
    # one grown log felled: not "every attempt fails" -- but most attempts still fail
    v2, why2 = PA.judge(facts(fail_visits=fv, use_qty=1.0, use_visits=[(TREEFARM_FAILS[0], TREEFARM_FAILS[0])],
                              last_use=TREEFARM_FAILS[0], last_visit=TREEFARM_FAILS[-1], dormant_coverage=1.0), e, NOW, SINCE)
    check(v2 != 'BROKEN', f'one success is not BROKEN (got {v2})')
    check(v2 == 'DORMANT', f'one success 11-01, nothing for 5 d -> DORMANT (got {v2}: {why2})')
    # no attempt at all for > 2 days after it finished -> DORMANT
    v3, _ = PA.judge(facts(), e, NOW, SINCE)
    check(v3 == 'DORMANT', f'finished, never visited -> DORMANT (got {v3})')
    # bots down: NOT JUDGED, never a verdict from silence
    v4, why4 = PA.judge(facts(coverage={'hours': 160, 'covered_hours': 30, 'bot_hours': 40}), e, NOW, SINCE)
    check(v4 == 'NOT JUDGED' and 'bots down' in why4, f'coverage 30/160 h -> NOT JUDGED (got {v4})')
    v5, _ = PA.judge(facts(dormant_coverage=0.2), e, NOW, SINCE)
    check(v5 == 'NOT JUDGED', f'dormant span mostly uncovered -> NOT JUDGED (got {v5})')
    # the deployed build cannot log a harvest: UNMEASURED, never DORMANT
    v6, why6 = PA.judge(facts(emitters_missing=["TREEFARM_PLOT, op: 'harvest'"]), e, NOW, SINCE)
    check(v6 == 'UNMEASURED' and 'cannot log' in why6, f'emitter missing -> UNMEASURED (got {v6})')


def t_rates(PA):
    e = reg_entry(PA, 'treefarm')
    ca = NOW - dt.timedelta(days=3)
    many = [(NOW - H(h), NOW - H(h)) for h in range(1, 60, 6)]
    v, why = PA.judge(facts(complete_at=ca, use_qty=60.0, use_visits=many, last_use=NOW - H(1)), e, NOW, SINCE)
    check(v == 'EFFECTIVE', f'60 logs in 3 d (20/day >= 8) -> EFFECTIVE (got {v}: {why})')
    v, why = PA.judge(facts(complete_at=ca, use_qty=6.0, use_visits=many, last_use=NOW - H(1)), e, NOW, SINCE)
    check(v == 'UNDERUSED' and 'below the expected rate' in why, f'6 logs in 3 d (2/day < 8) -> UNDERUSED (got {v})')
    fails = [(NOW - H(h), NOW - H(h)) for h in range(2, 60, 3)]
    v, why = PA.judge(facts(complete_at=ca, use_qty=60.0, use_visits=many[:2], fail_visits=fails, last_use=NOW - H(1)),
                      e, NOW, SINCE)
    check(v == 'UNDERUSED' and 'most attempts fail' in why, f'2 ok of 22 visits -> UNDERUSED most attempts fail (got {v})')
    v, why = PA.judge(facts(complete_at=NOW - H(5)), e, NOW, SINCE)
    check(v == 'NOT JUDGED' and 'young' in why, f'finished 5 h ago, no use -> NOT JUDGED young (got {v})')
    v, _ = PA.judge(facts(state='open', complete=False, complete_at=None), e, NOW, SINCE)
    check(v == '-', f'open -> - (got {v})')
    v, _ = PA.judge(facts(state='no_site', complete=False, complete_at=None), e, NOW, SINCE)
    check(v == '-', f'no_site -> - (got {v})')
    v, _ = PA.judge(facts(plot='walldemo'), reg_entry(PA, 'walldemo'), NOW, SINCE)
    check(v == 'EFFECTIVE', f'one-off finished -> EFFECTIVE (got {v})')
    v, _ = PA.judge(facts(plot='house1'), reg_entry(PA, 'house'), NOW, SINCE)
    check(v == 'UNMEASURED', f'house: no use signal -> UNMEASURED (got {v})')
    v, _ = PA.judge(facts(plot='mystery'), None, NOW, SINCE)
    check(v == 'UNMEASURED', f'undeclared kind -> UNMEASURED (got {v})')


def t_codex_r1(PA):
    """Codex r1 blockers: (B1) a use row that moved nothing is not a use; (B3) BROKEN on failure evidence inside the grace."""
    e = reg_entry(PA, 'yard')
    p = facts(plot='yard', complete_at=NOW - H(150))
    walked = {'presence': {}, 'coverage': {'showcase': {h: {'A'} for h in PA.hours_between(SINCE, NOW)}}, 'slots': {}}
    evs = [{'t': NOW - H(1), 'bot': 'A', 'pool': 'showcase', 'name': '_yard', 'status': 'success',
            'd': {'kind': 'stock', 'placed': '0'}}]
    f = PA.collect_project(p, e, evs, walked, SINCE, NOW)
    check(f['use_qty'] == 0 and f['last_use'] is None and f['last_visit'] == NOW - H(1), f'B1: placed=0 is a visit, not a use: {f["use_qty"]}, {f["last_use"]}')
    v, _ = PA.judge(f, e, NOW, SINCE)
    check(v == 'DORMANT', f'B1: a yard that moved nothing for 6 d is DORMANT despite an empty visit (got {v})')
    p = facts(complete_at=NOW - H(12), fail_visits=[(NOW - H(h), NOW - H(h)) for h in (11, 7, 3)])
    v, _ = PA.judge(p, reg_entry(PA, 'treefarm'), NOW, SINCE)
    check(v == 'BROKEN', f'B3: 3 failed visits over 8 h inside the grace -> BROKEN (failure evidence, documented) (got {v})')


def t_crash_keeps(PA):
    """Codex r1 B2: a crashed audit keeps yesterday's findings open (no CLEARED, no NEW page again on recovery)."""
    with tempfile.TemporaryDirectory() as d:
        bad = os.path.join(d, 'reg.json')
        with open(bad, 'w') as fh:
            fh.write('{not json')
        key = 'broken:showcase/showcase/treefarm@0_70_0'
        json.dump({'alarms': {key: 'BROKEN: treefarm'}}, open(os.path.join(d, 'projectaudit-showcase.json'), 'w'))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            PA.main(['run', '--label', 'showcase', '--registry', bad, '--state-dir', d, '--no-push', '--root', d, '--logs', d,
                     '--now', '2026-11-06T13:50:00Z'])
        st = json.load(open(os.path.join(d, 'projectaudit-showcase.json')))
        check(key in st['alarms'] and 'projectaudit:showcase' in st['alarms'], f'crash keeps the finding + adds its own key: {sorted(st["alarms"])}')
        log = open(os.path.join(d, 'ALARMS.log')).read()
        check('CLEARED' not in log, f'crash: nothing CLEARED: {log[-300:]}')


def t_open(PA):
    e = reg_entry(PA, 'tidy')
    p = facts(plot='tidy', state='open', complete=False, complete_at=None, use_qty=50.0,
              use_visits=[(NOW - H(100), NOW - H(100))], last_use=NOW - H(100))
    v, why = PA.judge_project(p, e, NOW, SINCE)
    check(v == 'UNDERUSED' and 'open and idle' in why, f'open tidy idle 4 d -> UNDERUSED, never a DORMANT page (got {v}: {why})')
    v, _ = PA.judge_project(facts(plot='tidy', use_qty=50.0, last_use=NOW - H(100)), e, NOW, SINCE)
    check(v == 'UNMEASURED', f'finished tidy -> UNMEASURED (no ground census) (got {v})')
    v, _ = PA.judge_project(facts(), reg_entry(PA, 'treefarm'), NOW, SINCE)
    check(v == 'DORMANT', f'a FINISHED idle project is still DORMANT (got {v})')


def t_upkeep(PA):
    e = reg_entry(PA, 'house')
    t0 = NOW - H(20)
    fv = [(t0, t0), (t0 + H(4), t0 + H(4)), (t0 + H(8), t0 + H(8))]
    up = {'failed_visits': fv, 'intact_t': [t0 - H(2)], 'repaired_t': [], 'failed_outcomes': {'stuck_on_cell': 3}}
    v, why = PA.judge(facts(plot='house1', upkeep=up), e, NOW, SINCE)
    check(v == 'BROKEN' and why.startswith('upkeep'), f'3 failed repairs over 8 h, none intact since -> BROKEN (got {v})')
    up2 = dict(up, intact_t=[t0 + H(9)])
    v, _ = PA.judge(facts(plot='house1', upkeep=up2), e, NOW, SINCE)
    check(v == 'UNMEASURED', f'an intact check after the failures -> not BROKEN (got {v})')
    up3 = dict(up, failed_visits=fv[:2])
    v, _ = PA.judge(facts(plot='house1', upkeep=up3), e, NOW, SINCE)
    check(v == 'UNMEASURED', f'2 failed repairs are not enough -> not BROKEN (got {v})')


def t_alarms(PA, AL):
    rs = [dict(facts(), verdict='BROKEN', why='x', purpose='wood'), dict(facts(plot='cropfarm'), verdict='DORMANT', why='y'),
          dict(facts(plot='road'), verdict='UNDERUSED', why='z'), dict(facts(plot='shop'), verdict='EFFECTIVE', why='ok')]
    al = PA.alarms_for('showcase', rs)
    check(set(al) == {'broken:showcase/showcase/treefarm@0_70_0', 'dormant:showcase/showcase/cropfarm@0_70_0',
                      'underused:showcase/showcase/road@0_70_0'}, f'alarms_for keys: {sorted(al)}')
    check(AL.tier_of('projectaudit-showcase', 'broken:showcase/showcase/treefarm@0_70_0') == AL.TIER_PAGE, 'tier: BROKEN pages')
    check(AL.tier_of('projectaudit-fleet', 'dormant:fleet/hive-b/shaft@1_2_3') == AL.TIER_PAGE, 'tier: DORMANT pages')
    check(AL.tier_of('projectaudit-fleet', 'underused:fleet/hive-b/shaft@1_2_3') == AL.TIER_DIGEST, 'tier: UNDERUSED is digest')
    check(AL.tier_of('projectaudit-fleet', 'projectaudit:fleet') == AL.TIER_PAGE, 'tier: a crashed audit pages')
    prev = {'broken:showcase/showcase/treefarm@0_70_0': 'BROKEN: ...', 'dormant:showcase/showcase/cropfarm@0_70_0': 'DORMANT: ...'}
    today = [dict(facts(), verdict='NOT JUDGED', why='bots down'), dict(facts(plot='cropfarm'), verdict='EFFECTIVE', why='ok')]
    cf = PA.carry_forward(prev, today, 'showcase')
    check(list(cf) == ['broken:showcase/showcase/treefarm@0_70_0'], f'carry: NOT JUDGED keeps BROKEN, EFFECTIVE clears (got {list(cf)})')
    check('(carried' in cf.get('broken:showcase/showcase/treefarm@0_70_0', ''), 'carry: the line says it was carried')
    tl = PA.town_lines('showcase', rs)
    check(len(tl) == 1 and tl[0].startswith('!! ') and 'treefarm BROKEN' in tl[0], f'town line: {tl}')


def _row(t, bot, pool, name, status, detail, pos=(0.5, 71, 0.5)):
    return json.dumps({'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'exp': {'pool': pool},
                       'bot': {'name': bot, 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}},
                       'skill': {'name': name, 'status': status, 'detail': detail}}, separators=(',', ':')) + '\n'


def t_end_to_end(PA):
    """Records + logs on disk: the tree farm's failed harvests sit in a ROTATED .gz (a live-only walk would miss them and
    call the farm DORMANT, not BROKEN); a path project with cells gets presence from bot.pos."""
    with tempfile.TemporaryDirectory() as d:
        root, logs, src = os.path.join(d, 'lib'), os.path.join(d, 'log'), os.path.join(d, 'src')
        pool = os.path.join(root, '_pool-showcase')
        os.makedirs(pool)
        os.makedirs(src)
        with open(os.path.join(src, 'treefarm.mjs'), 'w') as fh:
            fh.write("export const harvestRow = () => ({ project: TREEFARM_PLOT, op: 'harvest' })\nkind: 'shaft_use'\n")
        ms = lambda t: int(t.timestamp() * 1000)
        json.dump({'state': 'complete', 'structure_complete': True, 'completeAt': ms(dt.datetime(2026, 10, 31, 20, 23, tzinfo=UTC)),
                   'cells': [{'at': [-33, 68, 6]}]}, open(os.path.join(pool, 'project-0_70_0.treefarm.g3.json'), 'w'))
        json.dump({'state': 'complete', 'structure_complete': False}, open(os.path.join(pool, 'project-0_70_0.treefarm.g2.json'), 'w'))
        json.dump({'state': 'complete', 'structure_complete': True, 'completeAt': ms(NOW - dt.timedelta(days=3)),
                   'cells': [{'at': [10, 70, z]} for z in range(0, 20)]}, open(os.path.join(pool, 'project-0_70_0.paths.g4.json'), 'w'))
        json.dump({'state': 'no_site', 'structure_complete': True, 'why': 'unrouted', 'cells': []},
                  open(os.path.join(pool, 'project-0_70_0.wall.g1.json'), 'w'))
        for b in ('showcase-Alpha', 'showcase-Bravo'):
            os.makedirs(os.path.join(logs, b))
            rot = []
            for t in TREEFARM_FAILS:
                for cell in ('-37,68,6', '-33,68,6', '-37,68,10'):
                    rot.append(_row(t, b, 'showcase', '_build', 'success',
                                    f'project=treefarm op=harvest cell={cell} block=log kind=grown_failed n=0 why=no_safe_target'))
            with gzip.open(os.path.join(logs, b, f'skill-{b}.jsonl-20261103.gz'), 'wt') as fh:
                fh.writelines(rot)
            live = []
            t = NOW - dt.timedelta(days=7) + H(1)
            while t < NOW:   # the bots are up all week: one heartbeat row every 30 min, walking the path on day 6-7
                pos = (10.5, 71, 5.5) if t > NOW - dt.timedelta(days=2) else (100.5, 64, 100.5)
                live.append(_row(t, b, 'showcase', 'goto', 'success', 'to=somewhere', pos))
                t += dt.timedelta(minutes=30)
            with open(os.path.join(logs, b, f'skill-{b}.jsonl'), 'w') as fh:
                fh.writelines(live)
            for f in os.listdir(os.path.join(logs, b)):
                os.utime(os.path.join(logs, b, f), (NOW.timestamp(), NOW.timestamp()))
        reg = PA.load_registry(REGISTRY)
        em = PA.emitters_missing(src, reg)
        check(em['treefarm'] == [] and em['tidy'] == ["kind: 'tidy'", "op: 'sweep'"], f'emitters: present / none present: {em}')
        with open(os.path.join(src, 'tidy.mjs'), 'w') as fh:
            fh.write("log({ kind: 'tidy' })\n")     # one of tidy's two emitters (the fleet has no op: 'sweep')
        check(PA.emitters_missing(src, reg)['tidy'] == [], 'emitters: ONE emitter present is enough')
        check(PA.emitters_missing(os.path.join(d, 'nosuchdir'), reg) is None, 'emitters: no source dir -> None, not "all present"')
        results, rep = PA.audit(root, logs, reg, NOW, 7, src)
        by = {r['plot']: r for r in results}
        check(rep['bots'] == 2 and rep['lines'] > 600, f'e2e denominators: bots {rep["bots"]}, lines {rep["lines"]}')
        tf = by.get('treefarm') or {}
        check(tf.get('verdict') == 'BROKEN', f'e2e: treefarm BROKEN from the rotated .gz (got {tf.get("verdict")}: {tf.get("why")})')
        check(tf.get('gen') == 3, 'e2e: the NEWEST generation is the record')
        check('[control:' in (tf.get('control') or ''), f'e2e: the BROKEN line carries its positive control: {tf.get("control")}')
        pa = by.get('paths') or {}
        check(pa.get('presence_min', 0) > 0 and pa.get('verdict') in ('EFFECTIVE', 'UNDERUSED'),
              f'e2e: path presence counted (got {pa.get("presence_min")} bot-min, {pa.get("verdict")}: {pa.get("why")})')
        check((by.get('wall') or {}).get('verdict') == '-', f'e2e: a no_site wall with structure_complete is unsited, not judged')
        check((by.get('wall') or {}).get('complete') is False, 'e2e: inventory: no_site + structure_complete is NOT complete')


def t_surfaces(AH, PG, PA):
    """The fleetstatus header shows the summary + one line per town; the digest pushes a fresh weekly summary, never a stale one."""
    with tempfile.TemporaryDirectory() as d:
        rs = [dict(facts(), verdict='BROKEN', why='x'), dict(facts(plot='shop'), verdict='EFFECTIVE', why='ok')]
        st = PA.state_obj('fleet', rs, {'generated_at': '2026-11-06T12:05:00Z', 'days': 7, 'projects': 2, 'lines': 10, 'bots': 1,
                                        'verdicts': {'BROKEN': 1, 'EFFECTIVE': 1}}, PA.alarms_for('fleet', rs))
        json.dump(st, open(os.path.join(d, 'projectaudit-fleet.json'), 'w'))
        lines = AH.file_lines(NOW.replace(hour=13), 'projectaudit-fleet.json', 'project audit', H(26), d)
        check(lines[0].startswith('!! project audit fleet') and any('treefarm BROKEN' in x for x in lines[1:]),
              f'header: summary + town lines, !! on BROKEN: {lines}')
        check(any(n == 'projectaudit-fleet.json' for n, _, _ in AH.FILES), 'header: projectaudit-fleet.json is wired')
        os.makedirs(os.path.join(d, 'digest-attach'))
        fresh, old = os.path.join(d, 'digest-attach', 'projectaudit-weekly-fleet.txt'), os.path.join(d, 'digest-attach', 'old.txt')
        for p in (fresh, old):
            with open(p, 'w') as fh:
                fh.write('Weekly project check, fleet\nrow 1\n')
        t_old = (NOW - H(40)).timestamp()
        os.utime(old, (t_old, t_old))
        os.utime(fresh, (NOW.timestamp(), NOW.timestamp()))
        with contextlib.redirect_stdout(io.StringIO()):
            att = PG.attachments(d, NOW)
        check([os.path.basename(p) for p, _, _ in att] == ['projectaudit-weekly-fleet.txt'] and att[0][1] == 'Weekly project check, fleet',
              f'digest attachments: only the fresh one, first line is the subject: {att}')


def t_state(SG):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'projectaudit-fleet.json')
        check(SG.projectaudit_cell(p, NOW) is None, 'STATE: no file -> no row')
        json.dump({'generated_at': '2026-11-06T12:05:00Z', 'summary': 'project audit fleet: 1 broken'}, open(p, 'w'))
        check(SG.projectaudit_cell(p, NOW) == 'project audit fleet: 1 broken', 'STATE: fresh -> the summary')
        check(str(SG.projectaudit_cell(p, NOW + H(30))).startswith('!! project audit STALE'), 'STATE: > 26 h -> STALE')


TESTS = {'surfaces': lambda m: t_surfaces(m['lib/alarmhead.py'], m['pager.py'], m['projectaudit.py']),
         'state': lambda m: t_state(m['stategen.py']),
         'match': lambda m: t_match(m['projectaudit.py']), 'visits': lambda m: t_visits(m['projectaudit.py']),
         'treefarm': lambda m: t_treefarm(m['projectaudit.py']), 'rates': lambda m: t_rates(m['projectaudit.py']),
         'upkeep': lambda m: t_upkeep(m['projectaudit.py']), 'open': lambda m: t_open(m['projectaudit.py']),
         'codex_r1': lambda m: t_codex_r1(m['projectaudit.py']), 'crash': lambda m: t_crash_keeps(m['projectaudit.py']), 'alarms': lambda m: t_alarms(m['projectaudit.py'], m['lib/alarm.py']),
         'e2e': lambda m: t_end_to_end(m['projectaudit.py'])}

MUTANTS = [   # (file, anchor, replacement, the test that must fail)
    ('projectaudit.py', "    if fail_v >= e.get('broken_min_fail_visits', 3) and uses == 0:",
     "    if fail_v >= e.get('broken_min_fail_visits', 3) and uses >= 0:", 'treefarm'),
    ('projectaudit.py', "    if span_h >= 1 and (hrs == 0 or cov_h / hrs < min_cov):", "    if False:", 'treefarm'),
    ('projectaudit.py', "        if idle >= dt.timedelta(days=dd):", "        if idle >= dt.timedelta(days=dd * 10):", 'treefarm'),
    ('projectaudit.py', "    if p.get('emitters_missing'):", "    if False:", 'treefarm'),
    ('projectaudit.py', "    if att and ratio < e.get('min_success_ratio', 0.5):", "    if False:", 'rates'),
    ('projectaudit.py', "    if exp_ and rate < exp_:", "    if False:", 'rates'),
    ('projectaudit.py', "        return have is not None and w[2:] not in have", "        return have is not None and w[2:] in have", 'match'),
    ('projectaudit.py', "        if i is not None and t - out[i][1] <= gap:", "        if i is not None and t - out[i][1] <= dt.timedelta(0):", 'visits'),
    ('projectaudit.py', "        ok_after = [t for t in (up.get('intact_t') or []) + (up.get('repaired_t') or []) if t >= first]",
     "        ok_after = []", 'upkeep'),
    ('projectaudit.py', "        if m and m.group(2) == label and (m.group(3), m.group(4), m.group(5)) in nj:",
     "        if m and m.group(2) == label:", 'alarms'),
    ('projectaudit.py', "        complete = (bool(rec.get('structure_complete')) or state == 'complete') and state not in UNSITED_STATES",
     "        complete = (bool(rec.get('structure_complete')) or state == 'complete')", 'e2e'),
    ('projectaudit.py', "        for f in bot_files(log_root, bot, 'skill'):",
     "        for f in [x for x in bot_files(log_root, bot, 'skill') if not x.endswith('.gz')]:", 'e2e'),
    ('projectaudit.py', "        if k not in best or g > best[k][0]:\n            best[k] = (g, p)\n    return best",
     "        if k not in best or g < best[k][0]:\n            best[k] = (g, p)\n    return best", 'e2e'),
    ('projectaudit.py', "        out[e['name']] = list(em) if em and not any(s in text for s in em) else []",
     "        out[e['name']] = [x for x in em if x not in text]", 'e2e'),
    ('projectaudit.py', "    if v == 'DORMANT' and not p.get('complete'):", "    if False:", 'open'),
    ('projectaudit.py', "    if p.get('complete') and e.get('complete_note'):", "    if False:", 'open'),
    ('projectaudit.py', "                if q > 0:       # Codex r1 B1", "                if True:       # Codex r1 B1", 'codex_r1'),
    ('projectaudit.py', "        alarms = {k: v for k, v in prev.items() if not k.startswith('projectaudit:')}", "        alarms = {}", 'crash'),
    ('lib/alarmhead.py', "    if 'town_lines' in d:", "    if False:", 'surfaces'),
    ('pager.py', "            if now - dt.datetime.fromtimestamp(os.path.getmtime(p), UTC) > fresh:",
     "            if False:", 'surfaces'),
    ('stategen.py', "    if t is None or now - t > stale:", "    if t is None:", 'state'),
    ('lib/alarm.py', "        return TIER_PAGE if str(key).startswith(('broken:', 'dormant:', 'projectaudit:')) else TIER_DIGEST",
     "        return TIER_DIGEST", 'alarms'),
]


def load_all(over=None):
    over = over or {}
    return {n: load(n, over.get(n)) for n in PATHS}


def main():
    mods = load_all()
    for t in TESTS.values():
        t(mods)
    base = list(FAILS)
    for f in base:
        print('FAIL', f)
    killed = 0
    for fn, old, new, test in MUTANTS:
        src = open(PATHS[fn]).read()
        assert src.count(old) == 1, f'MUTANT ANCHOR MISSING OR NOT UNIQUE in {fn}: {old!r} x{src.count(old)}'
        FAILS.clear()
        try:
            m = load_all({fn: src.replace(old, new)})
            with contextlib.redirect_stdout(io.StringIO()):
                TESTS[test](m)
        except Exception as e:      # a crash is a kill too, but say so
            FAILS.append(f'crash {type(e).__name__}: {e}')
        if FAILS:
            killed += 1
        else:
            print(f'MUTANT SURVIVED: {fn}: {old.strip()[:90]!r}')
    FAILS[:] = base
    print(f'projectaudit tests: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
