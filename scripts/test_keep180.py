#!/usr/bin/env python3
"""Rule A' (KEEP at +180 for four-pool bag fixes; owner delegation 10-08, operator + Codex): behaviour, end to end.

  1. bagfixrule.keep_early / death_rate_ok (pure): every condition, each failing alone.
  2. verdict.py on fixture worlds (the acceptance harness): a clean four-pool bag fix KEEPs at +180 with
     extra.keep_rule; each single failing condition gives NOT_YET instead; +360 KEEPs as before and reports the bag
     metric. Needs the host lib (version_split): off the host this section is SKIPPED, loudly.
  3. MUTANTS on copies (anchors asserted present and unique), scored only after the unmutated copies pass.
"""
import os, sys, json, tempfile, shutil, subprocess, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
T = []; SKIP = []


def t(n, ok, d=''):
    T.append(bool(ok)); print(('PASS' if ok else 'FAIL') + '  ' + n + ('' if ok else '\n        -> ' + str(d)[-500:]))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m; spec.loader.exec_module(m); return m


BF = {'class': 'bag-fix', 'bag_fix': {'own_kinds': ['_x_action'], 'primary': {'read': 'bagread', 'field': 'slots_did', 'op': '<=', 'value': -1.0},
                                      'extended_deadline_min': 1560}}


def pure(BR):
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    k = lambda **kw: BR.keep_early(**dict(dict(reg=BF, n_pools=4, minute=180, read_minutes=[180, 360], extended=False, watch=[],
                                               blocked=[], exposed=True, reads_readable=True, cd=0, cbh=60.0, kd=2, kbh=300.0), **kw))[0]
    c('all conditions hold -> KEEP at +180', k())
    c('not a bag fix -> no', not k(reg={'class': 'underground-safety'}) and not k(reg={}))
    c('three pools -> no', not k(n_pools=3))
    c('the +360 read (the last) -> no early path', not k(minute=360))
    c('a minute other than 180 -> no', not k(minute=90, read_minutes=[90, 180, 360]))
    c('180 not a registered read -> no', not k(read_minutes=[90, 360], minute=180))
    c('extension in force -> no', not k(extended=True))
    c('a WATCH -> no', not k(watch=['WATCH: moved']))
    c('a blocked line -> no', not k(blocked=['x.y']))
    c('exposure not ready -> no', not k(exposed=False))
    c('a read not readable -> no', not k(reads_readable=False))
    c('canary death rate above control -> no', not k(cd=1, cbh=60.0, kd=0, kbh=300.0))
    c('canary rate EQUAL to control -> yes (<=)', k(cd=1, cbh=60.0, kd=5, kbh=300.0))
    c('canary or control exposure unmeasured -> no (fail closed)', not k(cbh=0.0) and not k(kbh=0.0) and not k(kbh=None))
    c('death_rate_ok: point estimates', BR.death_rate_ok(1, 60, 5, 300) and not BR.death_rate_ok(2, 60, 5, 300) and BR.death_rate_ok(0, 10, 0, 10))
    return out


def verdict_cases(verdict_py, tmp):
    out = []
    for cand in (os.path.join(os.path.dirname(verdict_py), 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib'):
        if os.path.isdir(cand):
            sys.path.insert(1, cand); break
    try:
        from version_split import in_canary_pool  # noqa: F401
    except ImportError:
        SKIP.append('verdict.py A\' cases: no version_split.in_canary_pool here -- run on the host')
        return out
    os.environ['ACCEPTANCE_VERDICT_PY'] = verdict_py
    A = load(os.path.join(HERE, 'test_verdict_acceptance.py'), 'tva_k180')
    A.VERDICT = verdict_py
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    P4 = 'board-b,hive-a,board-c,hive-b'

    def run(M=180, pools=P4, reg=None, v15c='OK', deaths=(0, 60.0, 2, 300.0), bag=-0.5, env=None, readable=True, own_lines=()):
        r = dict({'reads': ['immobiledid', 'bagread'], 'read_minutes': [180, 360], 'licence': {'class': 'kind'},
                  'own_lines': list(own_lines)}, **(reg if reg is not None else BF))
        cs = A.Case(tmp, reg_extra=r, manifest_extra={'canary_pool': pools})
        cd, cbh, kd, kbh = deaths
        cs.evidence('immobiledid', A.immobiledid(readable=readable, v15c=v15c, canary_deaths=cd, canary_bh=cbh, control_deaths=kd, control_bh=kbh),
                    M=M, pools=pools)
        bagf = {'slots_did': bag, 'full_share_did': 0.0, 'pick_slots_did': 0.0, 'sword_slots_did': 0.0,
                'cobble_slots_did': 0.0, 'canary_bot_h_post': cbh}
        bagf.update({ln['field']: 0 for ln in own_lines if ln['read'] == 'bagread'})     # one evidence object per read
        cs.evidence('bagread', bagf, M=M, pools=pools)
        v, head = cs.run(M=M, env_extra=dict(env or {}, VERDICT_MODULE_DIR=os.path.dirname(os.path.abspath(verdict_py))))
        try:
            art = json.load(open(os.path.join(cs.reads, '%s-verdict-%d.json' % (A.RUN, M))))
        except Exception:
            art = {}
        return v, head, art
    v, h, a = run()
    c('A\': a clean four-pool bag fix KEEPs at +180, extra.keep_rule A-prime, the bag metric reported', v == 'KEEP'
      and (a.get('extra') or {}).get('keep_rule') == 'A-prime +180' and 'bag metric at the KEEP read' in h, h)
    v, h, a = run(pools='board-b,hive-a')
    c('two pools -> NOT_YET at +180 (today\'s rule)', v == 'NOT_YET' and 'drawn at 2 pools' in h, h)
    v, h, a = run(deaths=(1, 60.0, 0, 300.0))
    c('canary death rate above control (1 death, below the floor) -> NOT_YET', v == 'NOT_YET' and 'above the control' in h, h)
    v, h, a = run(v15c='WATCH: blocks moved/bh')
    c('a v15c WATCH -> NOT_YET', v == 'NOT_YET' and 'WATCH' in h, h)
    v, h, a = run(bag=None)
    c('bagread blind (slots_did None) -> NOT_YET (a read not readable)', v == 'NOT_YET' and 'not readable' in h, h)
    v, h, a = run(reg={})
    c('an ordinary canary at four pools -> NOT_YET (A\' is bag-fix only)', v == 'NOT_YET', h)
    v, h, a = run(deaths=(0, 60.0, 0, 0.0))
    c('control exposure unmeasured -> NOT_YET (fail closed)', v == 'NOT_YET', h)
    v, h, a = run(reg=dict(BF, exposure={'read': 'bagread', 'field': 'canary_bot_h_post', 'min': 1000}))
    c('exposure not ready -> NOT_YET', v == 'NOT_YET' and 'exposure not ready' in h, h)
    v, h, a = run(own_lines=[{'read': 'bagread', 'field': 'x_rows', 'op': '>=', 'value': 1, 'on_fail': 'REVERT', 'note': 'liveness'}],
                  reg=dict(BF, reads=['immobiledid', 'bagread']))
    c('a blocked liveness line -> NOT_YET at +180 (decided at +360 as before)', v == 'NOT_YET', h)
    two = [{'read': 'bagread', 'field': 'f%d' % i, 'op': '<=', 'value': 1, 'on_fail': 'REVERT', 'evidence': 'calibrated'} for i in (1, 2)]
    v, h, a = run(own_lines=two)
    c('a BLOCK with no WATCH (two calibrated REVERT lines declared, both passing) -> NOT_YET at +180', v == 'NOT_YET'
      and 'deciding line failed' in h, h)
    v, h, a = run(M=360)
    c('+360 for a bag fix: KEEP as before, no keep_rule, bag metric reported', v == 'KEEP' and not (a.get('extra') or {}).get('keep_rule')
      and 'bag metric at the KEEP read' in h, h)
    return out


MUTANTS = [
    ('bagfixrule.py', 'four-pool condition dropped', "    if n_pools < MIN_POOLS:\n        return False, 'drawn at", "    if False:\n        return False, 'drawn at"),
    ('bagfixrule.py', 'death-rate screen dropped', "    if not death_rate_ok(cd, cbh, kd, kbh):\n        return False", "    if False:\n        return False"),
    ('bagfixrule.py', 'rate screen strict-wrong (>=)', "    return (cd / cbh) <= (kd / kbh)", "    return (cd / cbh) >= (kd / kbh)"),
    ('bagfixrule.py', 'unmeasured exposure passes', "    if not cbh or cbh <= 0 or not kbh or kbh <= 0:\n        return False", "    if False:\n        return False"),
    ('bagfixrule.py', 'WATCH ignored', "    if watch:\n        return False", "    if False:\n        return False"),
    ('bagfixrule.py', 'extension ignored', "    if extended:\n        return False", "    if False:\n        return False"),
    ('bagfixrule.py', 'any class', "    if not is_bag_fix(reg):\n        return False, 'not a bag fix'", "    if False:\n        return False, 'not a bag fix'"),
    ('bagfixrule.py', 'readability ignored', "    if not reads_readable:\n        return False", "    if False:\n        return False"),
    ('verdict.py', 'A\' never consulted', "if M < max(reg['read_minutes']) and not _KEEP_EARLY: (out('NOT_YET'))", "if M < max(reg['read_minutes']): (out('NOT_YET'))"),
    ('verdict.py', 'bagread blindness ignored', "        (('bagread' not in reg['reads']) or _bag.get('slots_did') is not None)", "        True"),
    ('verdict.py', 'blocked lines not passed', "        watch, blocked, exposed, _readable, _cd, _cbh, _kd, _kbh)", "        watch, [], exposed, _readable, _cd, _cbh, _kd, _kbh)"),
]

if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='k180test-')
    BRP = os.path.join(HERE, 'bagfixrule.py'); VP = os.path.join(HERE, 'verdict.py')
    for n, ok, d in pure(load(BRP, 'bagfixrule_k')):
        t(n, ok, d)
    VB = verdict_cases(VP, tmp)
    for n, ok, d in VB:
        t(n, ok, d)
    VB_OK = bool(VB) and all(ok for _n, ok, _d in VB)
    print('\nmutants (copies; anchors present and unique; scored after the unmutated copies pass):')
    for fname, name, old, new in MUTANTS:
        src = open(os.path.join(HERE, fname)).read()
        assert src.count(old) == 1, 'ANCHOR %s: %s (%d)' % (fname, name, src.count(old))
        md = tempfile.mkdtemp(dir=tmp)
        for f in ('bagfixrule.py', 'verdict.py', 'usaferule.py', 'usafegate.py', 'deathgate.py', 'singledeath.py', 'arms.py',
                  'bagfixgate.py', 'changerowcheck.py'):
            if os.path.exists(os.path.join(HERE, f)):
                shutil.copy(os.path.join(HERE, f), md)
        open(os.path.join(md, fname), 'w').write(src.replace(old, new, 1))
        try:
            res = pure(load(os.path.join(md, 'bagfixrule.py'), 'bagfixrule_m'))
        except Exception as e:
            res = [('raised %s' % type(e).__name__, False, '')]
        if fname == 'verdict.py' or all(ok for _n, ok, _d in res):
            if not VB:
                SKIP.append('mutant "%s": host only' % name); continue
            if not VB_OK:
                t('mutant NOT SCORED: %s (the unmutated verdict cases fail)' % name, False); continue
            res = res + verdict_cases(os.path.join(md, 'verdict.py'), tmp)
        t('mutant killed: %s: %s' % (fname, name), not all(ok for _n, ok, _d in res), 'SURVIVED')
    for s in SKIP:
        print('SKIPPED  ' + s)
    print('\n%d/%d pass%s' % (sum(T), len(T), ('; %d SKIPPED (not passes)' % len(SKIP)) if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(0 if all(T) else 1)
