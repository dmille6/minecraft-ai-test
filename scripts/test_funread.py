#!/usr/bin/env python3
"""test_funread.py -- funread.py (v37 fun-mode generic read): the pure decision, and gather() end to end on a fixture
tree with a stub death poll. Runs anywhere (Mac or host). Run: python3 scripts/test_funread.py"""
import os, sys, json, shutil, tempfile, subprocess, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('funread', os.path.join(HERE, 'funread.py'))
FR = importlib.util.module_from_spec(spec); spec.loader.exec_module(FR)
T = []
BOTS = ['board-a-%s' % n for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]


def t(name, ok, detail=''):
    T.append(bool(ok))
    print('%s  %s' % ('PASS' if ok else 'FAIL', name) + ('' if ok else '\n        -> %r' % (detail,)))


def facts(**kw):
    f = {'bound': True, 'death_word': 'POLL_OK', 'death_line': 'poll ok', 'deaths': 0, 'linked': 0,
         'units': {b: {'restarts': 0, 'active': 'active'} for b in BOTS}, 'fresh_on_canary': 5, 'own_lines': [],
         'exposed': False, 'tripwires': []}
    f.update(kw)
    return f


def word(f, M=180):
    return FR.decide(f, M, 180)


def pure():
    w, why, ex = word(facts())
    t('no harm at the final read -> KEEP goal-unverified', w == 'KEEP' and ex['label'] == 'goal-unverified' and
      'KEEP goal-unverified' in why[1], (w, why))
    w, _, ex = word(facts(exposed=True))
    t('exposure met -> KEEP goal-verified', w == 'KEEP' and ex['label'] == 'goal-verified', (w, ex))
    w, _, _ = word(facts(), 90)
    t('no harm before the final read -> NOT_YET', w == 'NOT_YET', w)
    w, why, ex = word(facts(death_word='REVERT', deaths=2), 90)
    t('death gate REVERT -> REVERT by death_gate with deaths', w == 'REVERT' and ex['by'] == 'death_gate' and ex['deaths'] == 2, (w, ex))
    u = facts()['units']; u[BOTS[1]]['restarts'] = FR.CRASH_RESTARTS
    w, why, ex = word(facts(units=u), 90)
    t('restarts >= CRASH_RESTARTS -> REVERT crash_loop, no deaths key (R11 must not hold it)',
      w == 'REVERT' and ex['by'] == 'crash_loop' and 'deaths' not in ex, (w, ex))
    u = facts()['units']; u[BOTS[1]]['restarts'] = FR.CRASH_RESTARTS - 1
    t('restarts below the threshold is not harm', word(facts(units=u))[0] == 'KEEP')
    u = facts()['units']; u[BOTS[2]]['active'] = 'inactive'
    w, why, _ = word(facts(units=u), 90)
    t('a stopped canary unit -> REVERT', w == 'REVERT' and any('not running' in x for x in why), why)
    w, why, ex = word(facts(own_lines=[{'read': 'r', 'field': 'f', 'value': 1, 'op': '<=', 'want': 0, 'state': 'fail'}]), 90)
    t('a failing own line -> REVERT own_line', w == 'REVERT' and ex['by'] == 'own_line', (w, ex))
    w, why, _ = word(facts(own_lines=[{'read': 'r', 'field': 'f', 'op': '<=', 'want': 0, 'state': 'absent', 'why': 'no evidence'}]))
    t('an own line with no evidence decides nothing', w == 'KEEP' and any('not evaluated' in x for x in why), why)
    for k, v, label in (('death_word', 'UNREADABLE', 'death poll unreadable'), ('death_word', None, 'death poll silent'),
                        ('units', None, 'units unreadable'), ('fresh_on_canary', 2, 'positive control 2 of 5'),
                        ('fresh_on_canary', None, 'positive control unknown'), ('bound', False, 'not bound'),
                        ('units', {}, 'no canary bots')):
        w, why, _ = word(facts(**{k: v}))
        t('%s at the final read -> INCONCLUSIVE, never KEEP' % label, w == 'INCONCLUSIVE', (w, why[-1]))
        w, _, _ = word(facts(**{k: v}), 90)
        t('%s before the final read -> NOT_YET' % label, w == 'NOT_YET', w)
    t('positive control needs EVERY canary bot: 4 of 5 -> INCONCLUSIVE', word(facts(fresh_on_canary=4))[0] == 'INCONCLUSIVE')
    t('positive control 5 of 5 -> KEEP', word(facts(fresh_on_canary=5))[0] == 'KEEP')
    t('a relayed change-row REVERT counts as linked',
      FR.re.search(r'change row inside a death window', 'x change row inside a death window, discriminating') is not None)
    w, why, _ = word(facts(tripwires=['load_high']))
    t('fleet tripwires are reported, not deciding', w == 'KEEP' and any('load_high' in x for x in why), why)
    w, why, ex = word(facts(death_word='REVERT', units=None), 180)
    t('harm wins over unknowns', w == 'REVERT', w)
    t('linked count carried for R11', word(facts(death_word='REVERT', linked=1), 90)[2]['linked'] == 1)
    t('only the boolean true is lab', FR.is_lab({'lab': True}) and not FR.is_lab({'lab': 'true'}) and not FR.is_lab({}))


def end_to_end():
    d = tempfile.mkdtemp(prefix='funread-')
    try:
        reg = os.path.join(d, 'regs'); os.makedirs(reg); R = os.path.join(d, 'reads'); os.makedirs(R)
        sha = 'a' * 40
        json.dump({'sha': sha[:10], 'own_lines': [{'read': 'x', 'field': 'bad', 'op': '<=', 'value': 0, 'on_fail': 'REVERT'},
                                                  {'read': 'x', 'field': 'w', 'op': '<=', 'value': 0, 'on_fail': 'WATCH'}],
                   'exposure': {'read': 'x', 'field': 'acted', 'min': 1}}, open(os.path.join(reg, 'r-01.json'), 'w'))
        man = os.path.join(d, 'man.json')
        json.dump({'run_id': 'r-01', 'canary_pool': 'board-a', 'canary_code_version': sha, 'declared_at': '2026-10-28T08:00:00Z'},
                  open(man, 'w'))
        envd = os.path.join(d, 'env'); os.makedirs(envd)
        for b in BOTS + ['board-a-Old-x', 'board-ab-Alpha']:
            open(os.path.join(envd, b + '.env'), 'w').write('')
        units = os.path.join(d, 'units.json')
        json.dump({b: {'restarts': 0, 'active': 'active'} for b in BOTS}, open(units, 'w'))
        logs = os.path.join(d, 'logs')
        for i, b in enumerate(BOTS):
            os.makedirs(os.path.join(logs, b))
            ts = '2026-10-28T10:59:00Z'
            open(os.path.join(logs, b, 'skill-1.jsonl'), 'w').write('garbage\n' + json.dumps({'@timestamp': ts, 'code': {'version': sha[:7] + '+x'}}) + '\n')
        stub = os.path.join(d, 'verdict.py')
        open(stub, 'w').write('print("VERDICT POLL_OK (+0) :: deaths 1 (0.1/bh over 10 measured bot-h) | poll: 1 canary deaths since '
                              'declared_at, 0 rung-linked, 1 with a change row")\n')
        ev = {'sha': sha[:7], 'pools': 'board-a', 'run_id': 'r-01', 'declared_at': '2026-10-28T08:00:00Z', 'window_min': 180,
              'fields': {'bad': 0, 'acted': 1}}
        json.dump(ev, open(os.path.join(R, 'r-01-x-180.json'), 'w'))
        envv = dict(FUNREAD_REG_DIR=reg, FUNREAD_READS_DIR=R, FUNREAD_MANIFEST=man, FUNREAD_ENV_DIR=envd,
                    FUNREAD_UNITS_FILE=units, FUNREAD_LOG_ROOT=logs, FUNREAD_NOW='2026-10-28T11:00:00Z',
                    FUNREAD_FREEZE=os.path.join(d, 'none'), FUNREAD_VERDICT=stub)
        run = lambda M: subprocess.run([sys.executable, os.path.join(HERE, 'funread.py'), 'r-01', str(M)],
                                       capture_output=True, text=True, env=dict(os.environ, **envv))
        r = run(180)
        line = r.stdout.strip().splitlines()[-1]
        art = json.load(open(os.path.join(R, 'r-01-verdict-180.json')))
        t('e2e: KEEP goal-verified at +180', line.startswith('VERDICT KEEP (+180) :: ') and 'goal-verified' in line, line)
        t('e2e: roster is exactly the five bots (no Old-x, no board-ab)', 'units: 5 canary bots' in line, line)
        t('e2e: positive control 5 of 5', '5 of 5 canary bots' in line, line)
        t('e2e: change-row death counted as linked', art['extra']['linked'] == 1, art['extra'])
        t('e2e: only REVERT own lines are evaluated', 'x.bad = 0 passes' in line and 'x.w' not in line, line)
        open(os.path.join(logs, BOTS[4], 'skill-1.jsonl'), 'a').write(json.dumps({'@timestamp': '2026-10-28T09:00:00Z', 'code': {'version': sha[:7]}}) + '\n')
        line = run(180).stdout.strip().splitlines()[-1]
        t('e2e: one canary bot silent for 2 h -> INCONCLUSIVE, never KEEP', line.startswith('VERDICT INCONCLUSIVE (+180)') and
          '4 of 5' in line, line)
        open(os.path.join(logs, BOTS[4], 'skill-1.jsonl'), 'a').write(json.dumps({'@timestamp': '2026-10-28T10:58:00Z', 'code': {'version': sha[:7]}}) + '\n')
        ev['fields']['bad'] = 2; json.dump(ev, open(os.path.join(R, 'r-01-x-180.json'), 'w'))
        line = run(180).stdout.strip().splitlines()[-1]
        t('e2e: a failing own line on bound evidence -> REVERT', line.startswith('VERDICT REVERT (+180)'), line)
        ev['run_id'] = 'other'; json.dump(ev, open(os.path.join(R, 'r-01-x-180.json'), 'w'))
        line = run(180).stdout.strip().splitlines()[-1]
        t('e2e: unbound evidence decides nothing (KEEP goal-unverified)', line.startswith('VERDICT KEEP (+180)') and
          'goal-unverified' in line and 'not bound' in line, line)
        json.dump({'run_id': 'r-02', 'canary_pool': 'board-a', 'canary_code_version': sha, 'declared_at': 'x'}, open(man, 'w'))
        line = run(180).stdout.strip().splitlines()[-1]
        t('e2e: a manifest naming another run -> INCONCLUSIVE', line.startswith('VERDICT INCONCLUSIVE (+180)'), line)
        os.remove(os.path.join(reg, 'r-01.json'))
        r = run(90)
        t('e2e: no registration -> UNREADABLE, one line, exit 0', r.returncode == 0 and
          r.stdout.strip().splitlines()[-1].startswith('VERDICT UNREADABLE (+90)'), r.stdout + r.stderr)
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == '__main__':
    pure(); end_to_end()
    print('\n%d/%d pass' % (sum(T), len(T)))
    sys.exit(0 if all(T) else 1)
