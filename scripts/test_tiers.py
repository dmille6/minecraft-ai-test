#!/usr/bin/env python3
"""Canary TIERS (gate v36; owner 2026-10-19): behaviour, end to end. docs/reports/canary-tiers-2026-10-19.md.

  A. tierrule.py (pure): tier_of / tier_problem, keep_early (every condition failing alone), hold_t2, ledger_tier
     (anchored), close_of (the LAST close), asymmetric_rows (the log-based baseline interlock).
  B. drawsteady.py (pure): candidates_t2, version_clean, incoming_tier, the strict journal.
  C. drawsteady.py CLI on fixture worlds: a tier-2 DRAW_RUN releases a tier-2 predecessor's pool >= 240 min after its
     close; a tier-3 / absent DRAW_RUN releases nothing early (today's behaviour); failed restart, short cool-off,
     malformed later journal row, a bucket gap -> nothing.
  D. verdict.py on fixture worlds (the acceptance harness; needs the host lib, SKIPPED off the host, loudly): a clean
     tier-2 +180 KEEPs (keep_rule tier-2 +180, the line starts with the marker, the artifact carries tier 2); zero
     exposure -> NOT_YET (extends); a defect line -> REVERT; no tier / tier "2" -> NOT_YET; a contaminated baseline,
     an unreadable roster (no crash) -> NOT_YET; +360 contaminated -> INCONCLUSIVE, clean -> KEEP; the first hour only
     in a rotated .gz -> KEEP (rotation positive control).
  E. MUTANTS on copies (anchors asserted present and unique), scored only after the unmutated copies pass.
"""
import os, sys, json, gzip, tempfile, shutil, subprocess, importlib.util, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
UTC = dt.timezone.utc
T = []; SKIP = []


def t(n, ok, d=''):
    T.append(bool(ok)); print(('PASS' if ok else 'FAIL') + '  ' + n + ('' if ok else '\n        -> ' + str(d)[-600:]))


def find(n, host=False):
    for d in ((os.path.join(HERE, 'host'), HERE) if host else (HERE, os.path.join(HERE, 'host'))):
        if os.path.exists(os.path.join(d, n)):
            return os.path.join(d, n)
    raise SystemExit('missing: %s' % n)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m; spec.loader.exec_module(m); return m


NOW = dt.datetime(2026, 10, 19, 12, 0, 0, tzinfo=UTC)
REG2 = {'tier': 2, 'reads': ['immobiledid', 'xread'], 'exposure': {'read': 'xread', 'field': 'n', 'min': 3}}


# ------------------------------------------------------------------------------------------------ A. tierrule (pure)
def pure_rule(TR):
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    c('tier_of: exactly the int 2 on a class-less registration', TR.tier_of({'tier': 2}) == 2)
    c('tier_of: absent / 3 / "2" / True / 2.0 / 1 / None -> 3', all(TR.tier_of(r) == 3 for r in (
        {}, {'tier': 3}, {'tier': '2'}, {'tier': True}, {'tier': 2.0}, {'tier': 1}, {'tier': None}, None, [])))
    c('tier_of: tier 2 on a bag fix or an underground-safety fix -> 3 (own rules)',
      TR.tier_of({'tier': 2, 'class': 'bag-fix'}) == 3 and TR.tier_of({'tier': 2, 'class': 'underground-safety'}) == 3)
    c('tier_problem: silent when absent, 2 honoured or 3; named for "2", 1, 2-on-a-class',
      TR.tier_problem({}) is None and TR.tier_problem({'tier': 2}) is None and TR.tier_problem({'tier': 3}) is None
      and 'not one of' in TR.tier_problem({'tier': '2'}) and 'owner-direct' in TR.tier_problem({'tier': 1})
      and 'own rules' in TR.tier_problem({'tier': 2, 'class': 'bag-fix'}))
    base = dict(reg=REG2, n_pools=4, split=False, minute=180, read_minutes=[180, 360], watch=[], blocked=[], undefined=[],
                exposure=REG2['exposure'], exposure_value=5, reads_readable=True, licence_class='kind', cd=0, cbh=60.0,
                kd=3, kbh=240.0, clean=True, clean_why='ok')
    k = lambda **kw: TR.keep_early(**dict(base, **kw))[0]
    c('keep_early: every condition holds -> KEEP', k())
    c('keep_early: no tier / tier 3 -> no', not k(reg={k2: v for k2, v in REG2.items() if k2 != 'tier'}) and not k(reg=dict(REG2, tier=3)))
    c('keep_early: +360, +90, 180 unregistered, 180 the last read -> no', not k(minute=360) and not k(minute=90, read_minutes=[90, 180, 360])
      and not k(read_minutes=[90, 360]) and not k(read_minutes=[180]))
    c('keep_early: three or five pools -> no (exactly four)', not k(n_pools=3) and not k(n_pools=5) and not k(n_pools=2))
    c('keep_early: a within-world split -> no', not k(split=True))
    c('keep_early: 47.9 canary bot-h -> no; 48 -> yes', not k(cbh=47.9) and k(cbh=48.0))
    c('keep_early: control bot-h unmeasured / NaN / inf canary -> no', not k(kbh=0.0) and not k(kbh=float('nan')) and not k(cbh=float('inf')))
    c('keep_early: no exposure block -> no', not k(exposure=None))
    c('keep_early: exposure read not registered, min 0, min True -> no', not k(exposure={'read': 'other', 'field': 'n', 'min': 3})
      and not k(exposure={'read': 'xread', 'field': 'n', 'min': 0}) and not k(exposure={'read': 'xread', 'field': 'n', 'min': True}))
    c('keep_early: exposure value 2 < 3, None, True, NaN -> no (zero exposure extends)', not k(exposure_value=2) and not k(exposure_value=None)
      and not k(exposure_value=True) and not k(exposure_value=float('nan')) and not k(exposure_value=0))
    c('keep_early: ANY watch, including the death gate HOLD -> no', not k(watch=['death gate held (v21)']) and not k(watch=['WATCH: moved']))
    c('keep_early: a blocked line -> no', not k(blocked=['x.y']))
    c('keep_early: an undefined (nullable) line -> no', not k(undefined=['xread.f=None']))
    c('keep_early: a read not readable -> no', not k(reads_readable=False))
    c('keep_early: licence rate / none -> no; text -> yes', not k(licence_class='rate') and not k(licence_class=None) and k(licence_class='text'))
    c('keep_early: canary death rate above control -> no; one death below control -> yes', not k(cd=2, kd=3) and k(cd=1, kd=6))
    c('keep_early: baseline not clean -> no', not k(clean=False))
    c('death_rate_ok: point estimates, fail closed', TR.death_rate_ok(1, 60, 4, 240) and not TR.death_rate_ok(2, 60, 4, 240)
      and not TR.death_rate_ok(0, 0, 1, 10) and not TR.death_rate_ok(0, 10, 1, 0))
    c('lookback_min: 240 at +180, M beyond', TR.lookback_min(180) == 240 and TR.lookback_min(360) == 360 and TR.lookback_min(720) == 720)
    # hold_t2
    h = TR.hold_t2
    c('hold_t2: tier-2 REVERT torn down 241 min ago -> released; 239 -> held', h('REVERT', 2, 'torn-down', 241) is None and h('REVERT', 2, 'torn-down', 239))
    c('hold_t2: tier-2 KEEP promoted 241 -> released; INCONCLUSIVE torn down 300 -> released',
      h('KEEP', 2, 'promoted', 241) is None and h('INCONCLUSIVE', 2, 'torn-down', 300) is None)
    c('hold_t2: not closed -> held whatever the tier', h('REVERT', 2, None, None) and h('KEEP', 3, None, None))
    c('hold_t2: tier-3 KEEP promoted 361 -> released, 359 -> held; tier-3 REVERT torn down 700 -> held (12 h)',
      h('KEEP', 3, 'promoted', 361) is None and h('KEEP', 3, 'promoted', 359) and h('REVERT', 3, 'torn-down', 700))
    c('hold_t2: an unknown decision word -> held', h('WATCH', 2, 'torn-down', 500))
    c('hold_t2: a close of an unknown kind (not torn-down / promoted) -> held', h('REVERT', 2, 'deployed', 500))
    # ledger_tier
    L = lambda note: {'note': note}
    c('ledger_tier: the anchored marker -> 2', TR.ledger_tier(L('toolkit-03: VERDICT KEEP (+180) :: tier 2 (v36) | deaths 0')) == 2)
    c('ledger_tier: the marker NOT first (a NOT_YET prose mention) -> 3',
      TR.ledger_tier(L('toolkit-03: VERDICT REVERT (+180) :: deaths 1 | tier 2 (v36) | x')) == 3)
    c('ledger_tier: a manual close note -> 3', TR.ledger_tier(L('plinth-01: INCONCLUSIVE (closed early by the operator)')) == 3)
    c('ledger_tier: no " |" after the marker -> 3', TR.ledger_tier(L('x-01: VERDICT KEEP (+180) :: tier 2 (v36) (canary loop)')) == 3)
    c('ledger_tier: a non-dict -> 3', TR.ledger_tier('x') == 3)
    # close_of: the LAST close
    jr = [{'ts': '2026-10-19T05:00:00Z', 'run': 'r', 'phase': 'torn-down', 'note': ''},
          {'ts': '2026-10-19T07:00:00Z', 'run': 'r', 'phase': 'torn-down', 'note': ''},
          {'ts': '2026-10-19T08:00:00Z', 'run': 'r', 'phase': 'promoted', 'note': 'bbbbbbb fleet-wide'}]
    ct, how = TR.close_of('r', 'aaaaaaa', dt.datetime(2026, 10, 19, 4, 0, tzinfo=UTC), TR.closes(jr), NOW)
    c('close_of: the LAST teardown (07:00), not the first; a promotion of another sha ignored',
      ct == dt.datetime(2026, 10, 19, 7, 0, tzinfo=UTC) and how == 'torn-down', (ct, how))
    ct, how = TR.close_of('r', 'aaaaaaa', dt.datetime(2026, 10, 19, 7, 30, tzinfo=UTC), TR.closes(jr), NOW)
    c('close_of: no close at/after the decision -> None', ct is None, (ct, how))
    out += asym_cases(TR)
    return out


def _bk(TR, spec, since):
    """spec: {bot: [(minute offset, version)]} -> {bot: {bucket: {version: n}}}"""
    return {b: TR.bucketize([(since + dt.timedelta(minutes=m), v) for m, v in rows], since, since + dt.timedelta(minutes=240))
            for b, rs in spec.items() for rows in [rs]}


def asym_cases(TR):
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    since = NOW - dt.timedelta(minutes=240)
    can_b = ['pa-%d' % i for i in range(5)]; ctl_b = ['pc-%d' % i for i in range(10)]
    every = lambda v, step=5: [(m, v) for m in range(0, 240, step)]
    A = lambda can, ctl, roster=can_b, bad=0: TR.asymmetric_rows(_bk(TR, can, since), _bk(TR, ctl, since), roster, since, NOW, bad)
    can = {b: every('B+1') for b in can_b}; ctl = {b: every('B+1') for b in ctl_b}
    r = A(can, ctl)
    c('asymmetric_rows: everyone on one build -> clean (positive control)', r[0], r[1])
    # a SYMMETRIC promotion at minute 120: everybody switches within ~10 min (staggered)
    sym_c = {b: [(m, 'B+1' if m < 120 + i else 'P+2') for m in range(0, 240, 5)] for i, b in enumerate(can_b)}
    sym_k = {b: [(m, 'B+1' if m < 118 + i else 'P+2') for m in range(0, 240, 5)] for i, b in enumerate(ctl_b)}
    r = A(sym_c, sym_k)
    c('asymmetric_rows: a symmetric staggered fleet promotion -> clean', r[0], r[1])
    # the predecessor's canary: the canary pool ran P for 180 min while the controls ran B, then everybody P
    pre = {b: [(m, 'P+2') for m in range(0, 240, 5)] for b in can_b}
    sym_k2 = {b: [(m, 'B+1' if m < 180 else 'P+2') for m in range(0, 240, 5)] for b in ctl_b}
    r = A(pre, sym_k2)
    c('asymmetric_rows: canary pool on the predecessor build before the controls -> NOT clean', not r[0] and 'asymmetric' in r[1], r[1])
    one = dict(can); one['pa-2'] = [(m, 'C+9' if 100 <= m < 110 else 'B+1') for m in range(0, 240, 5)]
    r = A(one, ctl)
    c('asymmetric_rows: ONE bot on the old build in ONE mid-window bucket -> NOT clean', not r[0], r[1])
    gap = {b: [(m, 'B+1') for m in range(0, 240, 5) if not 60 <= m < 70] for b in can_b}
    r = A(gap, ctl)
    c('asymmetric_rows: a 10-min bucket with no canary row (a lost generation) -> NOT clean', not r[0] and 'no canary row' in r[1], r[1])
    late = {b: [(m, 'B+1') for m in range(150, 240, 2)] for b in can_b}
    r = A(late, ctl)
    c('asymmetric_rows: rows only in the last 90 min (rotation dropped the start) -> NOT clean', not r[0], r[1])
    ctl_gap = {b: [(m, 'B+1') for m in range(0, 240, 5) if not 30 <= m < 40] for b in ctl_b}
    r = A(can, ctl_gap)
    c('asymmetric_rows: a bucket with no control rows -> NOT clean', not r[0] and 'no control rows' in r[1], r[1])
    tie = {b: every('B+1' if i < 5 else 'X+3') for i, b in enumerate(ctl_b)}
    r = A(can, tie)
    c('asymmetric_rows: a tied control majority -> NOT clean', not r[0] and 'tied' in r[1], r[1])
    minority = {b: every('B+1' if i < 7 else 'P+2') for i, b in enumerate(ctl_b)}
    r = A(can, minority)
    c('asymmetric_rows: the predecessor\'s other pools as a control MINORITY -> clean, heterogeneity reported (residual v)',
      r[0] and r[2] and abs(r[2] - 0.3) < 1e-9, r)
    seen4 = dict(can); seen4['pa-4'] = []; seen4['pa-3'] = every('B+1', 60)
    r = A(seen4, ctl)
    c('asymmetric_rows: 3 of 5 canary bots seen (< 80%) -> NOT clean', not r[0] and 'seen' in r[1], r[1])
    seen_ok = dict(can); seen_ok['pa-4'] = []
    r = A(seen_ok, ctl)
    c('asymmetric_rows: 4 of 5 seen (a dead unit) -> clean', r[0], r[1])
    r = A(can, ctl, bad=1)
    c('asymmetric_rows: one unreadable file / corrupt line -> NOT clean', not r[0] and 'unreadable' in r[1], r[1])
    r = A(can, ctl, roster=[])
    c('asymmetric_rows: no enabled canary bots -> NOT clean', not r[0], r[1])
    # transition cap: canary switches 15 min BEFORE the controls (two buckets early) -> the early bucket fails
    early = {b: [(m, 'B+1' if m < 105 else 'P+2') for m in range(0, 240, 5)] for b in can_b}
    sym_k3 = {b: [(m, 'B+1' if m < 120 else 'P+2') for m in range(0, 240, 5)] for b in ctl_b}
    r = A(early, sym_k3)
    c('asymmetric_rows: a canary on the new build TWO buckets before the controls -> NOT clean (one bucket only)', not r[0], r[1])
    near = {b: [(m, 'B+1' if m < 115 else 'P+2') for m in range(0, 240, 5)] for b in can_b}
    r = A(near, sym_k3)
    c('asymmetric_rows: within one bucket of the controls\' switch -> clean (bounded transition)', r[0], r[1])
    blds = lambda m, sh: 'B+1' if m < 60 + sh else 'P+2' if m < 120 + sh else 'Q+3' if m < 180 + sh else 'R+4'
    lag_c = {b: [(m, blds(m, 10)) for m in range(0, 240, 5)] for b in can_b}
    lag_k = {b: [(m, blds(m, 0)) for m in range(0, 240, 5)] for b in ctl_b}
    r = A(lag_c, lag_k)
    c('asymmetric_rows: three fleet transitions, the canary a bucket late each time (12.5%% of rows) -> NOT clean (cap 10%%)',
      not r[0] and 'transition' in r[1], r[1])
    late2 = dict(can); late2['pa-3'] = [(m, 'B+1') for m in range(70, 240, 5)]; late2['pa-4'] = [(m, 'B+1') for m in range(70, 240, 5)]
    r = A(late2, ctl)
    c('asymmetric_rows: two bots with >= 20 rows but none in the first hour -> 3 of 5 seen -> NOT clean', not r[0] and 'seen' in r[1], r[1])
    return out


def loader_cases(TR, tmp):
    """tierrule.load_buckets: every generation, .gz included; a version-less / unparseable complete line counts as bad;
    an offset stamp is parsed in full (the Z prefilter skips nothing it should not)."""
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    root = tempfile.mkdtemp(dir=tmp); b = 'pool-a-Alpha'; os.makedirs(os.path.join(root, b))
    since = NOW - dt.timedelta(minutes=240)
    row = lambda x, v='aaa+1': json.dumps({'@timestamp': x.strftime('%Y-%m-%dT%H:%M:%S.123Z'), 'code': {'version': v}}) + '\n'
    with gzip.open(os.path.join(root, b, 'skill-%s.jsonl-20261018.gz' % b), 'wt') as f:
        f.write(row(since + dt.timedelta(minutes=5)) + row(since - dt.timedelta(minutes=30)))
    with open(os.path.join(root, b, 'skill-%s.jsonl' % b), 'w') as f:
        f.write(row(since + dt.timedelta(minutes=200)))
        f.write(json.dumps({'@timestamp': (since + dt.timedelta(minutes=100)).strftime('%Y-%m-%dT%H:%M:%S') + '+00:00',
                            'code': {'version': 'aaa+1'}}) + '\n')
    for p in glob_all(root):
        os.utime(p, None)
    got, bad = TR.load_buckets(root, [b], since, NOW)
    c('load_buckets: rows from the rotated .gz AND the live file, an offset stamp parsed, the out-of-window row dropped',
      bad == 0 and sum(sum(x.values()) for x in got[b].values()) == 3 and 0 in got[b] and 20 in got[b] and 10 in got[b], (got, bad))
    with open(os.path.join(root, b, 'skill-%s.jsonl' % b), 'a') as f:
        f.write(json.dumps({'@timestamp': (since + dt.timedelta(minutes=50)).strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {}}) + '\n')
    got, bad = TR.load_buckets(root, [b], since, NOW)
    c('load_buckets: a complete line with no code.version -> bad 1', bad == 1, bad)
    with open(os.path.join(root, b, 'skill-%s.jsonl' % b), 'a') as f:
        f.write(json.dumps({'@timestamp': (since + dt.timedelta(minutes=51)).strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': ''}}) + '\n')
        f.write(json.dumps({'@timestamp': (since + dt.timedelta(minutes=52)).strftime('%Y-%m-%dT%H:%M:%S'), 'code': {'version': 'aaa+1'}}) + '\n')
    got, bad = TR.load_buckets(root, [b], since, NOW)
    c('load_buckets: an EMPTY version and a zone-less stamp -> bad 3', bad == 3, bad)
    open(os.path.join(root, b, 'skill-%s.jsonl-20261017.gz' % b), 'wb').write(b'not gzip')
    got, bad = TR.load_buckets(root, [b], since, NOW)
    c('load_buckets: an undecodable rotated file -> bad', bad >= 2, bad)
    return out


def glob_all(root):
    import glob as _g
    return _g.glob(os.path.join(root, '*', '*'))


# ------------------------------------------------------------------------------------------------ B. drawsteady (pure)
MARK = lambda run, dec: '%s: VERDICT %s (+180) :: tier 2 (v36) | deaths 0' % (run, dec)


def pure_steady(DS, TR):
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))

    def L(dec, pools, h_ago, run='p-01', sha='aaa1111', tier=2):
        return {'canary_sha': sha, 'canary_pool': pools, 'decision': dec, 'ts': (NOW - dt.timedelta(hours=h_ago)).isoformat(),
                'note': MARK(run, dec) if tier == 2 else '%s: VERDICT %s (+360) :: deaths 0' % (run, dec)}

    def J(run, phase, m_ago, note=''):
        return {'ts': (NOW - dt.timedelta(minutes=m_ago)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': run, 'phase': phase, 'note': note}
    ca = DS.candidates_t2
    k, h = ca([L('REVERT', 'pool-a,pool-b', 4.5)], [J('p-01', 'torn-down', 250)], NOW)
    c('candidates_t2: tier-2 REVERT torn down 250 min ago -> both pools', set(k) == {'pool-a', 'pool-b'} and not h, (k, h))
    k, h = ca([L('REVERT', 'pool-a', 4.5)], [J('p-01', 'torn-down', 230)], NOW)
    c('candidates_t2: torn down 230 min ago -> held', not k and 'pool-a' in h, (k, h))
    k, h = ca([L('REVERT', 'pool-a', 4.5)], [J('p-01', 'torn-down', 260), J('p-01', 'torn-down', 200)], NOW)
    c('candidates_t2: an interrupted teardown finished 200 min ago counts from the LAST row -> held', not k, (k, h))
    k, h = ca([L('REVERT', 'pool-a', 4.5)], [], NOW)
    c('candidates_t2: no close row -> held', not k and 'pool-a' in h, (k, h))
    k, h = ca([L('REVERT', 'pool-a', 4.5, tier=3)], [J('p-01', 'torn-down', 250)], NOW)
    c('candidates_t2: a TIER-3 predecessor (no marker) REVERT -> held (12 h, today)', not k and 'pool-a' in h, (k, h))
    k, h = ca([L('KEEP', 'pool-a', 6.5, tier=3)], [J('p-01', 'promoted', 370, 'aaa1111 fleet-wide')], NOW)
    c('candidates_t2: a tier-3 KEEP promoted 370 min ago -> released (360 from the promotion)', 'pool-a' in k, (k, h))
    k, h = ca([L('KEEP', 'pool-a', 6.1, tier=3)], [J('p-01', 'promoted', 350, 'aaa1111 fleet-wide')], NOW)
    c('candidates_t2: a tier-3 KEEP promoted 350 min ago -> held', not k, (k, h))
    k, h = ca([L('REVERT', 'pool-a', 4.5), L('REVERT', 'pool-a', 9, run='q-01', tier=3)],
              [J('p-01', 'torn-down', 250), J('q-01', 'torn-down', 530)], NOW)
    c('candidates_t2: a tier-3 REVERT 9 h ago on the same pool still holds it', not k and 'pool-a' in h, (k, h))
    # version_clean
    since = NOW - dt.timedelta(minutes=240)
    units = {'pool-a-%d' % i: True for i in range(5)}
    rows = lambda v='aaa1111+x', skip=(): ([(since + dt.timedelta(minutes=m), v) for m in range(0, 240, 3) if m not in skip], 0, 0)
    st = {b: rows() for b in units}
    vc = lambda st=st, units=units, fv='aaa1111': DS.version_clean(st, units, fv, since, NOW)[0]
    c('version_clean: one build, rows across 240 min -> ok', vc())
    c('version_clean: one old-build row 200 min ago (a failed restart) -> no',
      not vc(st=dict(st, **{'pool-a-1': ([(since + dt.timedelta(minutes=40), 'old0000+y')] + rows()[0], 0, 0)})))
    c('version_clean: a bot with no rows in the first hour -> no', not vc(st=dict(st, **{'pool-a-2': rows(skip=range(0, 60))})))
    c('version_clean: a 10-min bucket with no pool row -> no', not vc(st={b: rows(skip=range(120, 130)) for b in units}))
    c('version_clean: a unit down / a bot with no rows / a corrupt row -> no', not vc(units=dict(units, **{'pool-a-0': False}))
      and not vc(st=dict(st, **{'pool-a-0': None})) and not vc(st=dict(st, **{'pool-a-0': (rows()[0], 0, 1)})))
    # incoming_tier
    d = tempfile.mkdtemp()
    json.dump({'tier': 2}, open(os.path.join(d, 'r2.json'), 'w')); json.dump({}, open(os.path.join(d, 'r3.json'), 'w'))
    open(os.path.join(d, 'bad.json'), 'w').write('{')
    c('incoming_tier: tier 2 -> 2; absent tier, missing, malformed, a path -> 3',
      DS.incoming_tier('r2', d) == 2 and DS.incoming_tier('r3', d) == 3 and DS.incoming_tier('nope-zz', d) == 3
      and DS.incoming_tier('bad', d) == 3 and DS.incoming_tier('../r2', d) == 3 and DS.incoming_tier('', d) == 3)
    jp = os.path.join(d, 'j')
    open(jp, 'w').write(json.dumps(J('p-01', 'torn-down', 300)) + '\n{"ts": "2026-10-19T10:00:00Z", "run": "p-01", "phase": "torn-d\n')
    try:
        DS._journal_strict(jp); strict = False
    except Exception:
        strict = True
    c('_journal_strict: a valid close followed by a MALFORMED later row raises (nothing released early)', strict)
    open(jp, 'w').write(json.dumps(J('p-01', 'torn-down', 300)) + '\n' + json.dumps({'ts': 'broken', 'run': 'p-01', 'phase': 'torn-down'}) + '\n')
    try:
        DS._journal_strict(jp); strict = False
    except Exception:
        strict = True
    c('_journal_strict: a later teardown row with an UNREADABLE ts raises (round 5, Codex)', strict)
    open(jp, 'w').write(json.dumps(J('p-01', 'torn-down', 300)) + '\n')
    c('_journal_strict: a clean journal parses', len(DS._journal_strict(jp)) == 1)
    shutil.rmtree(d, ignore_errors=True)
    return out


# ------------------------------------------------------------------------------------------------ C. drawsteady CLI
def steady_cli(steady_py, tier_py, tmp):
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    d = tempfile.mkdtemp(dir=tmp)
    shutil.copy(steady_py, os.path.join(d, 'drawsteady.py')); shutil.copy(find('bagread.py', host=True), os.path.join(d, 'bagread.py'))
    if tier_py:
        shutil.copy(tier_py, os.path.join(d, 'tierrule.py'))
    now = dt.datetime.now(UTC).replace(microsecond=0)
    NAMES = ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')

    def world(close_min=250, tier_pred=2, draw_tier=2, old_row_at=None, gap=None, bad_journal=False, reg=True, closed=True):
        w = tempfile.mkdtemp(dir=d); logs = os.path.join(w, 'logs')
        pools = {'pool-a': 31, 'pool-b': 28, 'pool-c': 30, 'pool-d': 32, 'pool-e': 34, 'pool-f': 29}
        units, roster = [], []
        for p, s in pools.items():
            for n in NAMES:
                b = '%s-%s' % (p, n); roster.append('mcbot@%s.service' % b)
                units.append('mcbot@%s.service loaded active running x' % b)
                os.makedirs(os.path.join(logs, b))
                with open(os.path.join(logs, b, 'skill-x.jsonl'), 'w') as f:
                    for i in range(170):
                        m = 248 - i * 1.45
                        tt = now - dt.timedelta(minutes=m)
                        if p == 'pool-a' and gap and gap[0] <= m < gap[1]:
                            continue
                        v = 'old0000+x' if (b == 'pool-a-Bravo' and old_row_at is not None and abs(m - old_row_at) < 0.8) else 'aaa1111+x'
                        f.write(json.dumps({'@timestamp': tt.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': v},
                                            'bot': {'name': b, 'inventory': {'cobblestone': 64 * s}},
                                            'skill': {'name': 'gather', 'duration_ms': 0}}) + '\n')
        open(os.path.join(w, 'units'), 'w').write('\n'.join(units) + '\n')
        os.makedirs(os.path.join(w, 'wants'))
        for n in roster + ['mcbot@.service']:
            open(os.path.join(w, 'wants', n), 'w').write('')
        dec = now - dt.timedelta(minutes=close_min + 5)
        note = MARK('p-01', 'REVERT') if tier_pred == 2 else 'p-01: VERDICT REVERT (+180) :: deaths 0'
        open(os.path.join(w, 'ledger'), 'w').write(json.dumps({'canary_sha': 'ccc3333', 'canary_pool': 'pool-a', 'decision': 'REVERT',
                                                                'note': note, 'ts': dec.isoformat()}) + '\n')
        jl = ''
        if closed:
            jl += json.dumps({'ts': (now - dt.timedelta(minutes=close_min)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': 'p-01',
                              'phase': 'torn-down', 'note': ' 5 aaa1111'}) + '\n'
        if bad_journal:
            jl += '{"ts": "%s", "run": "p-01", "phase": "torn-d\n' % (now - dt.timedelta(minutes=100)).strftime('%Y-%m-%dT%H:%M:%SZ')
        open(os.path.join(w, 'journal'), 'w').write(jl)
        json.dump({'declared_code_version': 'aaa1111', 'declared_at': (now - dt.timedelta(hours=30)).isoformat(), 'canary_pool': ''},
                  open(os.path.join(w, 'man'), 'w'))
        os.makedirs(os.path.join(w, 'regs'))
        if reg:
            json.dump({'tier': 2} if draw_tier == 2 else {}, open(os.path.join(w, 'regs', 'next-01.json'), 'w'))
        return w

    def run(w):
        env = dict(os.environ, STEADY_LEDGER=os.path.join(w, 'ledger'), STEADY_JOURNAL=os.path.join(w, 'journal'),
                   STEADY_MANIFEST=os.path.join(w, 'man'), STEADY_LOGROOT=os.path.join(w, 'logs'),
                   STEADY_UNITS_FILE=os.path.join(w, 'units'), STEADY_ROSTER_DIR=os.path.join(w, 'wants'),
                   STEADY_REGDIR=os.path.join(w, 'regs'), DRAW_RUN='next-01')
        r = subprocess.run([sys.executable, os.path.join(d, 'drawsteady.py')], capture_output=True, text=True, env=env, timeout=300)
        rel = [l for l in r.stdout.splitlines() if l.startswith('STEADY RELEASE ')]
        return (rel[-1][len('STEADY RELEASE '):] if rel else 'NO_LINE'), r.stdout + r.stderr[-400:]
    g, o = run(world())
    c('CLI: tier-2 draw, tier-2 predecessor REVERT torn down 250 min ago, one build 240 min -> releases pool-a',
      g == "['pool-a']" and 'tier-2 draw' in o, o)
    g, o = run(world(draw_tier=3))
    c('CLI: the SAME world, a tier-3 (no tier) incoming run -> releases nothing, no tier-2 line (today)',
      g == '[]' and 'tier-2 draw' not in o, o)
    g, o = run(world(reg=False))
    c('CLI: incoming registration absent -> tier 3 -> releases nothing', g == '[]' and 'tier-2 draw' not in o, o)
    g, o = run(world(close_min=200))
    c('CLI: torn down only 200 min ago -> releases nothing', g == '[]', o)
    g, o = run(world(tier_pred=3))
    c('CLI: a tier-3 predecessor REVERT -> releases nothing (12 h)', g == '[]', o)
    g, o = run(world(old_row_at=200))
    c('CLI: a failed restart (one old-build row 200 min ago, outside the hour) -> releases nothing', g == '[]', o)
    g, o = run(world(gap=(150, 162)))
    c('CLI: the pool has a 12-min hole (a lost log generation) -> releases nothing', g == '[]', o)
    g, o = run(world(bad_journal=True))
    c('CLI: a valid close then a MALFORMED later journal row -> releases nothing', g == '[]' and 'malformed' in o, o)
    g, o = run(world(closed=False))
    c('CLI: no teardown recorded -> releases nothing', g == '[]', o)
    return out


# ------------------------------------------------------------------------------------------------ D. verdict.py
CAN_POOLS = ['board-a', 'board-b', 'hive-a', 'hive-b']
CTL_POOLS = ['board-c', 'board-d', 'hive-c', 'hive-d', 'placebo-a', 'placebo-b']
BOTN = ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')


def verdict_cases(verdict_py, tmp):
    out = []
    for cand in (os.path.join(os.path.dirname(verdict_py), 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib'):
        if os.path.isdir(cand):
            sys.path.insert(1, cand); break
    try:
        from version_split import in_canary_pool  # noqa: F401
    except ImportError:
        SKIP.append('verdict.py tier cases: no version_split.in_canary_pool here -- run on the host')
        return out
    A = load(os.path.join(HERE, 'test_verdict_acceptance.py'), 'tva_tiers')
    A.VERDICT = verdict_py
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    P4 = ','.join(CAN_POOLS)

    def run(M=180, pools=P4, reg=None, v15c='OK', deaths=(0, 60.0, 3, 240.0), expo=5, own_lines=(), xread=None,
            lic='kind', old=None, rotate=False, roster=True, extra_reads=None):
        r = dict({'tier': 2, 'reads': ['immobiledid', 'xread'], 'read_minutes': [180, 360], 'licence': {'class': lic},
                  'exposure': {'read': 'xread', 'field': 'n', 'min': 3}, 'own_lines': list(own_lines),
                  'deadline_min': 420}, **(reg or {}))
        r = {k: v for k, v in r.items() if v is not None}
        cs = A.Case(tmp, reg_extra=r, manifest_extra={'canary_pool': pools, 'declared_at': A.now(-M - 5)})
        cd, cbh, kd, kbh = deaths
        cs.evidence('immobiledid', A.immobiledid(v15c=v15c, canary_deaths=cd, canary_bh=cbh, control_deaths=kd, control_bh=kbh),
                    M=M, pools=pools)
        cs.evidence('xread', dict({'n': expo, 'readable': True}, **(xread or {})), M=M, pools=pools)
        decl = dt.datetime.fromisoformat(cs.man['declared_at'])
        L = max(240, M)
        rd = os.path.join(cs.d, 'wants'); os.makedirs(rd)
        if roster:
            for p in CAN_POOLS + CTL_POOLS:
                for n in BOTN:
                    open(os.path.join(rd, 'mcbot@%s-%s.service' % (p, n)), 'w').write('')
        for p in (pools.split(',') if pools else []) + CTL_POOLS + [q for q in CAN_POOLS if q not in pools.split(',')]:
            for n in BOTN:
                b = '%s-%s' % (p, n); dd = os.path.join(cs.logs, b); os.makedirs(dd, exist_ok=True)
                rows = []
                for i in range(int(L / 4) + 2):
                    tt = decl - dt.timedelta(minutes=L + 2) + dt.timedelta(minutes=4 * i)
                    if tt >= decl:
                        break
                    v = 'base000+d1'
                    if old and b == old[0] and old[1] <= (decl - tt).total_seconds() / 60 < old[1] + 8:
                        v = 'cccc999+d9'
                    rows.append((tt, v, b))
                first = [x for x in rows if (decl - x[0]).total_seconds() / 60 > L - 70] if rotate else []
                rest = [x for x in rows if x not in first]
                ln = lambda x: json.dumps({'@timestamp': x[0].strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': x[1]},
                                           'bot': {'name': x[2]}, 'skill': {'name': 'gather', 'detail': ''}}) + '\n'
                if first:
                    with gzip.open(os.path.join(dd, 'skill-1.jsonl-20261018.gz'), 'wt') as f:
                        f.writelines(ln(x) for x in first)
                with open(os.path.join(dd, 'skill-1.jsonl'), 'a') as f:
                    f.writelines(ln(x) for x in rest)
        env = {'VERDICT_MODULE_DIR': os.path.dirname(os.path.abspath(verdict_py)),
               'VERDICT_ROSTER_DIR': rd if roster else os.path.join(cs.d, 'no-such-dir')}
        v, head = cs.run(M=M, env_extra=env)
        try:
            art = json.load(open(os.path.join(cs.reads, '%s-verdict-%d.json' % (A.RUN, M))))
        except Exception:
            art = {}
        return v, head, art
    v, h, a = run()
    c('D: a clean tier-2 at +180 -> KEEP, keep_rule tier-2 +180, the line STARTS with the marker, artifact tier 2',
      v == 'KEEP' and (a.get('extra') or {}).get('keep_rule') == 'tier-2 +180' and h.startswith('VERDICT KEEP (+180) :: tier 2 (v36) |')
      and a.get('tier') == 2, h)
    v, h, a = run(rotate=True)
    c('D: the window\'s first hour ONLY in a rotated .gz -> KEEP (rotation positive control)', v == 'KEEP', h)
    v, h, a = run(expo=0)
    c('D: tier-2 +180 with ZERO exposure -> NOT_YET (extends), never KEEP', v == 'NOT_YET' and 'exposure not ready' in h, h)
    v, h, a = run(own_lines=[{'read': 'xread', 'field': 'bad', 'op': '<=', 'value': 0, 'on_fail': 'REVERT', 'evidence': 'defect'}],
                  xread={'bad': 3})
    c('D: a defect own line still REVERTs at +180', v == 'REVERT', h)
    v, h, a = run(reg={'tier': None})
    c('D: the same evidence with NO tier -> NOT_YET at +180 (today), no marker, no tier in the artifact',
      v == 'NOT_YET' and 'tier 2 (v36)' not in h and 'tier 2' not in h and 'tier' not in a, h)
    v, h, a = run(reg={'tier': 3})
    c('D: tier 3 -> NOT_YET at +180', v == 'NOT_YET' and 'tier 2 (v36)' not in h, h)
    v, h, a = run(reg={'tier': '2'})
    c('D: tier "2" (a string) -> NOT_YET, the problem named', v == 'NOT_YET' and 'not one of the integers' in h, h)
    v, h, a = run(pools='board-a,board-b,hive-a')
    c('D: three pools -> NOT_YET', v == 'NOT_YET' and '3 distinct pools' in h, h)
    v, h, a = run(v15c='WATCH: blocks moved/bh')
    c('D: a v15c WATCH -> NOT_YET', v == 'NOT_YET', h)
    v, h, a = run(lic='rate')
    c('D: a rate licence -> NOT_YET', v == 'NOT_YET' and 'licence' in h, h)
    v, h, a = run(deaths=(2, 60.0, 3, 240.0))
    c('D: canary death rate above control (held gate) -> NOT_YET', v == 'NOT_YET', h)
    v, h, a = run(old=('hive-a-Comet', 100))
    c('D: one canary bot on another build for one mid-window bucket -> NOT_YET (contaminated baseline)',
      v == 'NOT_YET' and 'asymmetric' in h, h)
    v, h, a = run(roster=False)
    c('D: the roster unreadable (the baseline loader fails) -> NOT_YET, never a crash', v == 'NOT_YET' and 'baseline check failed' in h, h)
    v, h, a = run(M=360)
    c('D: +360 final, clean baseline over 360 min -> KEEP (no early rule label)', v == 'KEEP' and not (a.get('extra') or {}).get('keep_rule'), h)
    v, h, a = run(M=360, old=('board-b-Alpha', 300))
    c('D: +360 final, a canary bot on another build 300 min before -> INCONCLUSIVE (contaminated evidence never KEEPs)',
      v == 'INCONCLUSIVE' and 'no KEEP on this baseline' in h, h)
    v, h, a = run(M=360, reg={'tier': None}, old=('board-b-Alpha', 300))
    c('D: +360 with NO tier and the same contamination -> KEEP (today: tier 3 is not checked)', v == 'KEEP', h)
    return out


# ------------------------------------------------------------------------------------------------ F. the replay control
def replay_cases(tmp):
    """v36_replay.py must FAIL when either verdict process produces no VERDICT line (round 5, Codex: two crashes with
    the same exit code compared equal), and pass when both print the same line."""
    out = []; c = lambda n, ok, d='': out.append((n, bool(ok), d))
    home = tempfile.mkdtemp(dir=tmp)
    os.makedirs(os.path.join(home, 'mcai-analysis', 'registrations')); os.makedirs(os.path.join(home, 'digest', 'reads'))
    json.dump({'reads': ['immobiledid'], 'read_minutes': [180]}, open(os.path.join(home, 'mcai-analysis', 'registrations', 'r-01.json'), 'w'))
    open(os.path.join(home, 'digest', 'reads', 'r-01-immobiledid-180.json'), 'w').write('{}')
    stub = lambda name, body: (open(os.path.join(home, name), 'w').write(body), os.path.join(home, name))[1]
    crash = stub('crash.py', 'import sys; sys.exit(1)\n')
    good = stub('good.py', 'print("VERDICT KEEP (+180) :: x")\n')
    other = stub('other.py', 'print("VERDICT NOT_YET (+180) :: x")\n')
    rp = find('v36_replay.py', host=True)
    run = lambda a, b: subprocess.run([sys.executable, rp, a, b, os.path.join(home, 'rules')], capture_output=True, text=True,
                                      env=dict(os.environ, HOME=home), timeout=120)
    r = run(crash, crash)
    c('replay: BOTH verdict processes crash -> FAILS (never "identical")', r.returncode != 0 and 'no verdict line' in r.stdout, r.stdout)
    r = run(good, good)
    c('replay: both print the same VERDICT line -> passes (positive control)', r.returncode == 0 and 'SAME' in r.stdout, r.stdout)
    r = run(good, other)
    c('replay: different verdict lines -> FAILS', r.returncode != 0 and 'DIFF' in r.stdout, r.stdout)
    return out


# ------------------------------------------------------------------------------------------------ E. mutants
MUTANTS = [
    ('tierrule.py', 'string tier accepted', "    if type(t) is int and t == 2 and not reg.get('class'):", "    if t in (2, '2') and not reg.get('class'):"),
    ('tierrule.py', 'class ignored', "    if type(t) is int and t == 2 and not reg.get('class'):", "    if type(t) is int and t == 2:"),
    ('tierrule.py', 'four or more pools', "    if n_pools != TIER2_POOLS:", "    if n_pools < TIER2_POOLS:"),
    ('tierrule.py', 'split ignored', "    if split:\n        return False", "    if False:\n        return False"),
    ('tierrule.py', 'bot-h floor dropped', "    if not _num(cbh) or cbh < TIER2_MIN_CANARY_BH:", "    if not _num(cbh):"),
    ('tierrule.py', 'exposure value unchecked', "    return declared, bool(declared and _num(value) and value >= ex['min'])", "    return declared, bool(declared)"),
    ('tierrule.py', 'exposure read need not be registered', "ex.get('read') in (reads or [])", "True"),
    ('tierrule.py', 'death-gate HOLD tolerated', "    if watch:\n        return False", "    if [w for w in watch if w != 'death gate held (v21)']:\n        return False"),
    ('tierrule.py', 'undefined lines ignored', "    if undefined:\n        return False", "    if False:\n        return False"),
    ('tierrule.py', 'rate licence accepted', "    if licence_class in (None, '', 'rate'):", "    if licence_class in (None, ''):"),
    ('tierrule.py', 'death-rate screen dropped', "    if not death_rate_ok(cd, cbh, kd, kbh):\n        return False", "    if False:\n        return False"),
    ('tierrule.py', 'baseline ignored by keep_early', "    if not clean:\n        return False", "    if False:\n        return False"),
    ('tierrule.py', '+180 only on the last read too', "    if minute != TIER2_KEEP_MIN or TIER2_KEEP_MIN not in rm or minute >= max(rm or [0]):",
     "    if minute != TIER2_KEEP_MIN or TIER2_KEEP_MIN not in rm:"),
    ('tierrule.py', 'tier-2 cool-off 180 min', "TIER2_CLEAN_MIN = 240 ", "TIER2_CLEAN_MIN = 180 "),
    ('tierrule.py', 'unclosed predecessor released', "    if how not in ('torn-down', 'promoted') or mins_since_close is None:\n        return",
     "    if mins_since_close is None:\n        return"),
    ('tierrule.py', 'tier-3 REVERT released at 240', "    if pred_tier == 2 and decision in ('KEEP', 'REVERT', 'INCONCLUSIVE'):",
     "    if decision in ('KEEP', 'REVERT', 'INCONCLUSIVE'):"),
    ('tierrule.py', 'the FIRST close', "        if decided <= t <= until and (best is None or t > best[0]):", "        if decided <= t <= until and (best is None or t < best[0]):"),
    ('tierrule.py', 'marker by substring', "    m = _MARK_RE.match(str(row.get('note') or ''))", "    m = re.search(r'^([a-z0-9][a-z0-9._-]*):.*tier 2 \\(v36\\)', str(row.get('note') or ''))"),
    ('tierrule.py', 'bad lines ignored', "    if bad:\n        return False, '%d unreadable", "    if False:\n        return False, '%d unreadable"),
    ('tierrule.py', 'seen share ignored', "    if len(seen) < MIN_SEEN_SHARE * len(roster):", "    if False:"),
    ('tierrule.py', 'first/last hour not required', "            and any(i < edge for i in bks) and any(i >= nb - edge for i in bks)]", "            ]"),
    ('tierrule.py', 'no-control bucket tolerated', "        if mv is None:\n            return False, 'bucket", "        if mv is None and c:\n            return False, 'bucket"),
    ('tierrule.py', 'any neighbour majority passes', "            nbrs = {major[j] for j in (i - 1, i + 1) if 0 <= j < nb and major[j] != major[i]}",
     "            nbrs = {major[j] for j in range(nb)}"),
    ('tierrule.py', 'canary bucket coverage dropped', "    if miss:\n        return False, '%d of %d buckets hold no canary row", "    if False:\n        return False, '%d of %d buckets hold no canary row"),
    ('tierrule.py', 'transition cap dropped', "    if trans > MAX_TRANSITION_SHARE * rows:", "    if False:"),
    ('drawsteady.py', 'tier-3 incoming takes the tier-2 path', "    T2 = incoming_tier(os.environ.get('DRAW_RUN', ''), os.environ.get('STEADY_REGDIR') or None) == 2",
     "    T2 = True"),
    ('drawsteady.py', 'tolerant journal on the tier-2 path', "            journal = _journal_strict(JOURNAL)", "            journal = _journal(JOURNAL)"),
    ('drawsteady.py', 'version_clean skipped', "                    ok, vwhy = version_clean(st, by_pool.get(p, {}), fv, s240, now)", "                    vwhy = 'skipped'"),
    ('drawsteady.py', 'version_clean first/last hour dropped', "        if not any(x < first for x, _v in rs) or not any(x >= last for x, _v in rs):", "        if False:"),
    ('drawsteady.py', 'version_clean bucket coverage dropped', "    if miss:\n        return False, 'the pool has no rows", "    if False:\n        return False, 'the pool has no rows"),
    ('drawsteady.py', 'version_clean build check dropped', "        if vs != {fv}:", "        if not vs:"),
    ('drawsteady.py', 'a held pool released by another decision', "    for p in held:\n        ok.pop(p, None)", "    for p in ():\n        ok.pop(p, None)"),
    ('verdict.py', 'tier-2 block never consulted', "if _TIER == 2 and not _KEEP_EARLY and M < max(reg['read_minutes']):", "if False:"),
    ('verdict.py', 'final-read baseline check dropped', "if _TIER == 2 and _T2_RULE is None:\n    _t2f_clean", "if False:\n    _t2f_clean"),
    ('verdict.py', 'baseline exception not caught', "    except Exception as e:\n        res = (False, 'baseline check failed", "    except ZeroDivisionError as e:\n        res = (False, 'baseline check failed"),
    ('verdict.py', 'marker not first', "_TIER = tierrule.tier_of(reg)\nif _TIER == 2:\n    why.append(tierrule.TIER_MARK)\n", "_TIER = tierrule.tier_of(reg)\n"),
    ('verdict.py', 'artifact tier dropped', "        o['tier'] = 2   # v36", "        pass   # v36"),
    ('tierrule.py', 'baseline loader on live files only', "glob.glob(os.path.join(logroot, bot, 'skill-*.jsonl*'))", "glob.glob(os.path.join(logroot, bot, 'skill-*.jsonl'))"),
    ('tierrule.py', 'a version-less line tolerated', "                            if not isinstance(v, str) or not v or x.tzinfo is None:\n                                raise", "                            if False:\n                                raise"),
    ('verdict.py', 'tier-2 label lost', "        _T2_RULE = 'tier-2 +180'", "        _T2_RULE = None"),
]
MODS = ('tierrule.py', 'drawsteady.py', 'verdict.py', 'bagfixrule.py', 'usaferule.py', 'usafegate.py', 'deathgate.py', 'singledeath.py',
        'arms.py', 'bagfixgate.py', 'changerowcheck.py')


def all_cases(d, tmp, with_verdict):
    TR = load(os.path.join(d, 'tierrule.py'), 'tierrule_%d' % abs(hash(d)))
    sys.modules['tierrule'] = TR
    DS = load(os.path.join(d, 'drawsteady.py'), 'ds_%d' % abs(hash(d)))
    res = pure_rule(TR) + loader_cases(TR, tmp) + pure_steady(DS, TR) + steady_cli(os.path.join(d, 'drawsteady.py'), os.path.join(d, 'tierrule.py'), tmp)
    if with_verdict:
        res += verdict_cases(os.path.join(d, 'verdict.py'), tmp)
    return res


def stage(tmp, fname=None, old=None, new=None):
    md = tempfile.mkdtemp(dir=tmp)
    for f in MODS:
        p = os.path.join(HERE, f)
        if os.path.exists(p):
            shutil.copy(p, md)
    if fname:
        src = open(os.path.join(HERE, fname)).read()
        open(os.path.join(md, fname), 'w').write(src.replace(old, new, 1))
    return md


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='tiers-test-')
    base = all_cases(stage(tmp), tmp, True)
    for n, ok, d in replay_cases(tmp):
        t(n, ok, d)
    for n, ok, d in base:
        t(n, ok, d)
    VB = any(n.startswith('D:') for n, _o, _d in base)
    BASE_OK = all(ok for _n, ok, _d in base)
    t('mutant runner control: the UNMUTATED staged copies pass every case (%d)' % len(base), BASE_OK)
    print('\nmutants (copies; anchors present and unique; scored only after the unmutated copies pass):')
    for fname, name, old, new in MUTANTS:
        src = open(os.path.join(HERE, fname)).read()
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE %s: %s (%d)' % (fname, name, src.count(old))
        if fname == 'verdict.py' and not VB:
            SKIP.append('mutant "%s": host only' % name); continue
        if not BASE_OK:
            t('mutant NOT SCORED: %s' % name, False); continue
        try:
            res = all_cases(stage(tmp, fname, old, new), tmp, fname == 'verdict.py')
        except Exception as e:
            res = [('raised %s' % type(e).__name__, False, '')]
        t('mutant killed: %s: %s' % (fname, name), not all(ok for _n, ok, _d in res), 'SURVIVED')
    for s in SKIP:
        print('SKIPPED  ' + s)
    print('\n%d/%d pass%s' % (sum(T), len(T), ('; %d SKIPPED (not passes)' % len(SKIP)) if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(0 if all(T) else 1)
