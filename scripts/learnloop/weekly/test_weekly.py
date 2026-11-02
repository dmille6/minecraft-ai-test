#!/usr/bin/env python3
"""Tests for the weekly learning-loop pipeline's DECISIONS (weekly.py), the assemble replay buffer (build_clean.py),
the dispatcher's restricted-key argument filter (llgpu.sh), and mutants of each (anchors asserted present + unique).

    python3 scripts/learnloop/weekly/test_weekly.py
"""
import datetime as dt, json, os, random, subprocess, sys, tempfile, types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import weekly as W  # noqa: E402

R = []


def t(fn):
    R.append(fn); return fn


def sc(**kw):
    base = {'n': 600, 'missing': 0, 'schema_valid': 100.0, 'hard': 2.0, 'rep_fail': 20.0, 'post_veto_repeat': 30.0}
    base.update(kw); return base


G = json.load(open(os.path.join(HERE, '..', '..', '..', 'config', 'learnloop-weekly.json')))['gates']
UTC = dt.timezone.utc


@t
def round_due_after_cadence_not_before():
    t0 = dt.datetime(2026, 11, 1, 3, 0, tzinfo=UTC)
    assert W.round_due(None, t0, 7)
    assert not W.round_due(t0, t0 + dt.timedelta(days=6), 7)
    assert W.round_due(t0, t0 + dt.timedelta(days=7), 7)
    assert W.round_due(t0, t0 + dt.timedelta(days=7) - dt.timedelta(minutes=30), 7)   # a tick a little early still starts it


@t
def window_ends_at_newest_archived_day():
    assert W.window('2026-10-31', 9) == ('2026-10-23', '2026-10-31')


@t
def next_phase_is_first_not_done():
    st = {'phases': {'harvest': {'status': 'done'}, 'pool': {'status': 'waiting'}}}
    assert W.next_phase(st, ['harvest', 'pool', 'transform']) == 'pool'
    st['phases']['pool']['status'] = 'done'; st['phases']['transform'] = {'status': 'done'}
    assert W.next_phase(st, ['harvest', 'pool', 'transform']) is None


@t
def phases_have_train_and_export_per_candidate():
    cfg = {'candidates': [{'key': 'a'}, {'key': 'b'}]}
    p = W.phases(cfg)
    assert p.index('assemble') < p.index('train:a') < p.index('export:a') < p.index('train:b') < p.index('replay')


@t
def incumbent_gate_s4a():
    inc = sc(schema_valid=100.0, hard=15.0, rep_fail=66.7)
    assert W.gate_vs_incumbent(sc(), inc, G['vs_incumbent'])['pass']
    assert not W.gate_vs_incumbent(sc(hard=15.5), inc, G['vs_incumbent'])['pass']
    assert not W.gate_vs_incumbent(sc(rep_fail=67.0), inc, G['vs_incumbent'])['pass']
    assert not W.gate_vs_incumbent(sc(schema_valid=99.4), inc, G['vs_incumbent'])['pass']
    assert not W.gate_vs_incumbent(sc(missing=1), inc, G['vs_incumbent'])['pass']      # coverage first


@t
def best_gate_tolerances():
    best = sc(rep_fail=16.7, post_veto_repeat=7.0, hard=2.0)
    assert W.gate_vs_best(sc(rep_fail=18.7, post_veto_repeat=12.0, hard=2.5), best, G['vs_best'])['pass']
    assert not W.gate_vs_best(sc(rep_fail=18.8, post_veto_repeat=7.0, hard=2.0), best, G['vs_best'])['pass']
    assert not W.gate_vs_best(sc(rep_fail=16.7, post_veto_repeat=12.1, hard=2.0), best, G['vs_best'])['pass']
    assert not W.gate_vs_best(sc(rep_fail=16.7, post_veto_repeat=7.0, hard=2.6), best, G['vs_best'])['pass']
    assert not W.gate_vs_best(sc(schema_valid=98.9), best, G['vs_best'])['pass']
    assert W.gate_vs_best(sc(), None, G['vs_best'])['pass']


@t
def new_best_needs_both_gates_and_better_or_smaller():
    best = sc(rep_fail=16.7, post_veto_repeat=7.0)
    assert not W.becomes_best(sc(rep_fail=10.0, post_veto_repeat=5.0), best, 9, 9, False, True)[0]
    assert not W.becomes_best(sc(rep_fail=10.0, post_veto_repeat=5.0), best, 9, 9, True, False)[0]
    assert W.becomes_best(sc(rep_fail=16.0, post_veto_repeat=7.0), best, 9, 9, True, True)[0]
    # equal quality, same size: not a new best
    assert not W.becomes_best(sc(rep_fail=16.7, post_veto_repeat=7.0), best, 9, 9, True, True)[0]
    # equal quality within tolerance at <= 60% of the parameters: a new best (capacity)
    assert W.becomes_best(sc(rep_fail=18.0, post_veto_repeat=9.0), best, 4, 9, True, True)[0]
    assert not W.becomes_best(sc(rep_fail=18.0, post_veto_repeat=9.0), best, 6, 9, True, True)[0]


@t
def smaller_winner_must_pass_against_the_leader():
    S_ = {'big': sc(rep_fail=10.0, post_veto_repeat=10.0), 'small': sc(rep_fail=16.0, post_veto_repeat=8.0),
          'close': sc(rep_fail=11.5, post_veto_repeat=12.0)}
    W_ = lambda n, p: (S_[n]['rep_fail'] + S_[n]['post_veto_repeat'], p, n, n)
    assert W.pick_winner([W_('big', 9), W_('small', 4)], S_, G['vs_best'])[2] == 'big'      # 6 pp worse on rep_fail
    assert W.pick_winner([W_('big', 9), W_('close', 4)], S_, G['vs_best'])[2] == 'close'    # within each tolerance
    assert W.pick_winner([W_('big', 9), W_('close', 8)], S_, G['vs_best'])[2] == 'big'      # not smaller enough


@t
def drift_flags_only_a_real_drop():
    # the pilot: 58.9% of 1,000. 200 items at 58% is noise; at 45% it is drift
    assert W.drift(116, 200, 58.9, 2.0)[0] is False
    f, z = W.drift(90, 200, 58.9, 2.0)
    assert f is True and z < -2
    assert W.drift(150, 200, 58.9, 2.0)[0] is False            # agreeing MORE is not drift
    assert W.drift(0, 0, 58.9, 2.0) == (None, None)


@t
def latency_summary_counts_timeouts_against_the_gate():
    recs = [{'id': i, 'latencyMs': 1000 + i, 'schemaValid': True, 't_done_ms': 60000 * i / 30} for i in range(60)]
    s = W.latency_summary(recs, 3, 20)
    assert s['valid'] == 60 and s['gates_p50_2500_p95_5000'] and s['p50_ms'] == 1030
    recs[5] = {'id': 5, 'transport_error': True, 't_done_ms': 45000}
    s = W.latency_summary(recs, 3, 20)
    assert s['timeouts_or_errors'] == 1 and not s['gates_p50_2500_p95_5000']


# ---------------------------------------------------------------- build_clean assemble: the replay buffer

def item(i, kind='fail', skill='mine', world='hive-b', day='2026-10-25'):
    return {'id': i, 'bot': 'b1', 'world': world, 'day': day, 'system': 's', 'kind': kind,
            'user': 'STATE: ok\nLAST ACTION: x\n', 'sentinel': 'END-1', 'schema': {},
            'logged': {'skill': skill, 'args': {}, 'label': 'bad', 'refused': False, 'reason': '', 'status': 'failed',
                       'detail': '', 'failure_class': 'failed:no_path'},
            'vetoed': [skill, {}] if kind == 'post_veto' else None, 'assistant': json.dumps({'reason': 'r', 'skill': skill, 'args': {}, 'saw_end': 'END-1'}),
            'provenance': 'fleet:qwen2.5:7b-instruct'}


def label(i, skill):
    return {'id': i, 'model': 'qwen3.8:27b', 'schemaValid': True, 'proposal': {'reason': 'r', 'skill': skill, 'args': {}, 'saw_end': 'END-1'}}


def run_assemble(d, n_new, n_buf, relabel_n, forbid=(), extra=None):
    wr = lambda p, rows: open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in rows))
    sk = ['explore', 'gather', 'goto', 'home', 'deposit']
    wr(os.path.join(d, 'pool.jsonl'), [item('n%d' % i) for i in range(n_new)])
    wr(os.path.join(d, 'labels.jsonl'), [label('n%d' % i, sk[i % 5]) for i in range(n_new)])
    wr(os.path.join(d, 'bpool.jsonl'), [item('b%d' % i, day='2026-10-12') for i in range(n_buf)])
    wr(os.path.join(d, 'blabels.jsonl'), [label('b%d' % i, sk[i % 5]) for i in range(n_buf)])
    wr(os.path.join(d, 'good.jsonl'), [dict(item('g%d' % i, kind='good', skill='gather'), logged={**item('g').get('logged'), 'label': 'good'}) for i in range(4)])
    wr(os.path.join(d, 'forbid.jsonl'), [{'id': x} for x in forbid])
    args = ['assemble', '--out', d, '--name', 'train.jsonl', '--pool-file', os.path.join(d, 'pool.jsonl'), '--good-file', os.path.join(d, 'good.jsonl'),
            '--labels', os.path.join(d, 'labels.jsonl'), '--local-model', 'qwen3.8:27b', '--relabel-n', str(relabel_n),
            '--max-skill-share', '0', '--buffer-pool', os.path.join(d, 'bpool.jsonl'), '--buffer-labels', os.path.join(d, 'blabels.jsonl'),
            '--forbid-ids', os.path.join(d, 'forbid.jsonl')] + (extra or [])
    import build_clean as BC
    import score as S
    S.check_action = lambda sk, args, f: ([], None)        # the hard check is tested in bench; here every label is legal
    BC.S = S
    BC.main(args)
    rows = [json.loads(l) for l in open(os.path.join(d, 'train.jsonl'))]
    return rows, json.load(open(os.path.join(d, 'train.jsonl.MANIFEST.json')))


@t
def buffer_tops_up_after_this_rounds_relabels():
    with tempfile.TemporaryDirectory() as d:
        rows, m = run_assemble(d, 10, 50, 30)
        new = [r for r in rows if r['id'].startswith('n')]; buf = [r for r in rows if r['id'].startswith('b')]
        assert len(new) == 10 and len(buf) == 20, (len(new), len(buf))
        assert all(r.get('buffer') for r in buf) and not any(r.get('buffer') for r in new)


@t
def buffer_unused_when_this_round_fills_the_target():
    with tempfile.TemporaryDirectory() as d:
        rows, m = run_assemble(d, 40, 50, 30)
        assert sum(r['id'].startswith('b') for r in rows) == 0 and sum(r['id'].startswith('n') for r in rows) == 30


@t
def a_gate_id_in_the_pool_is_refused():
    with tempfile.TemporaryDirectory() as d:
        try:
            run_assemble(d, 10, 5, 30, forbid=['b3'])
        except SystemExit as e:
            assert 'evaluation ids' in str(e); return
        raise AssertionError('not refused')


@t
def a_buffer_label_repeating_the_logged_failure_is_dropped():
    with tempfile.TemporaryDirectory() as d:
        rows, m = run_assemble(d, 0 + 1, 3, 30)
        # every buffer item's logged action is mine; a buffer label 'mine' must be refused (labels cycle explore..deposit,
        # so make one explicitly)
        p = os.path.join(d, 'blabels.jsonl'); L = [json.loads(l) for l in open(p)]; L[0]['proposal']['skill'] = 'mine'
        open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in L))
        os.remove(os.path.join(d, 'train.jsonl.MANIFEST.json'))
        import build_clean as BC
        BC.main(['assemble', '--out', d, '--name', 'train.jsonl', '--pool-file', os.path.join(d, 'pool.jsonl'), '--good-file', os.path.join(d, 'good.jsonl'),
                 '--labels', os.path.join(d, 'labels.jsonl'), '--local-model', 'qwen3.8:27b', '--relabel-n', '30', '--max-skill-share', '0',
                 '--buffer-pool', os.path.join(d, 'bpool.jsonl'), '--buffer-labels', p])
        rows = [json.loads(l) for l in open(os.path.join(d, 'train.jsonl'))]
        assert 'b0' not in {r['id'] for r in rows} and {'b1', 'b2'} <= {r['id'] for r in rows}


@t
def buffer_pilot_items_without_kind_or_skill_are_skipped_not_crashed():
    with tempfile.TemporaryDirectory() as d:
        wr = lambda p, rows: open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in rows))
        run_assemble(d, 2, 2, 30)                              # writes the files
        a = item('p0'); a.pop('kind'); b = item('p1'); b.pop('kind'); b['logged']['skill'] = None
        wr(os.path.join(d, 'bpool.jsonl'), [a, b]); wr(os.path.join(d, 'blabels.jsonl'), [label('p0', 'explore'), label('p1', 'explore')])
        import build_clean as BC
        BC.main(['assemble', '--out', d, '--name', 't2.jsonl', '--pool-file', os.path.join(d, 'pool.jsonl'), '--good-file', os.path.join(d, 'good.jsonl'),
                 '--labels', os.path.join(d, 'labels.jsonl'), '--local-model', 'qwen3.8:27b', '--relabel-n', '30', '--max-skill-share', '0',
                 '--buffer-pool', os.path.join(d, 'bpool.jsonl'), '--buffer-labels', os.path.join(d, 'blabels.jsonl')])
        ids = {json.loads(l)['id'] for l in open(os.path.join(d, 't2.jsonl'))}
        assert 'p0' in ids and 'p1' not in ids, ids


@t
def the_cap_applies_while_filling_so_the_target_is_reached():
    import build_clean as BC
    mk = lambda i, sk, buf=False: {'id': i, 'assistant': json.dumps({'skill': sk}), 'buffer': buf}
    new = [mk('n%d' % i, 'surface') for i in range(60)] + [mk('m%d' % i, 'home') for i in range(10)]
    buf = [mk('b%d' % i, ['goto', 'gather', 'explore', 'surface'][i % 4], True) for i in range(200)]
    out, got = BC.alloc_relabels(new, buf, 0.30, 100, random.Random(1))
    assert len(out) == 100, len(out)
    assert got['surface'] <= 30 and all(v <= 30 for v in got.values()), got
    assert {r['id'] for r in out} >= {'m%d' % i for i in range(10)}                       # this round's rows first
    assert sum(1 for r in out if r['id'].startswith('n')) == 30                            # its surface rows fill the cap
    # infeasible at the full target: the largest feasible total
    buf = [mk('h%d%s' % (i, k), k, True) for k in ('home', 'goto', 'gather') for i in range(5)]
    out, got = BC.alloc_relabels([mk('s%d' % i, 'surface') for i in range(50)], buf, 0.30, 100, random.Random(1))
    assert len(out) == 21 and got['surface'] == 6, (len(out), got)


@t
def buffer_alone_can_fill_a_round_with_no_kept_labels():
    with tempfile.TemporaryDirectory() as d:
        rows, m = run_assemble(d, 0, 20, 30)
        assert len([r for r in rows if r['id'].startswith('b')]) == 20


# ---------------------------------------------------------------- llgpu.sh restricted-key argument filter

@t
def llgpu_ssh_rejects_shell_metacharacters_and_dotdot():
    sh = os.path.join(HERE, 'llgpu.sh')
    for bad in ('status; id', 'get x ../../.ssh/id_rsa', 'serve h run:x/../../y a', 'status $(id)', 'get a `id`'):
        r = subprocess.run(['bash', sh, '--ssh'], env=dict(os.environ, SSH_ORIGINAL_COMMAND=bad, HOME=tempfile.gettempdir()),
                           capture_output=True, text=True)
        assert r.returncode == 2 and 'bad argument' in r.stdout, (bad, r.stdout[-200:])


# ---------------------------------------------------------------- fleetstatus header line

@t
def fleetstatus_weekly_line_alarms():
    sys.path.insert(0, os.path.join(HERE, '..', '..', 'host'))
    import fleetstatus as F
    n = dt.datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    with tempfile.TemporaryDirectory() as d:
        hb = os.path.join(d, 'hb.json'); rd = os.path.join(d, 'rounds'); os.makedirs(os.path.join(rd, 'R1'))
        assert F.learnloop_weekly_line(n, hb, rd).startswith('!! ')                       # missing
        w = lambda **k: json.dump(dict({'at': '2026-11-02T11:55:00Z', 'status': 'ok', 'round': 'R1', 'phase': 'teach', 'best': 'c2'}, **k), open(hb, 'w'))
        json.dump({'phases': {'teach': {'status': 'waiting', 'waiting_since': '2026-11-02T06:00:00Z', 'wait': 'GPU busy'}}}, open(os.path.join(rd, 'R1', 'state.json'), 'w'))
        w(); assert not F.learnloop_weekly_line(n, hb, rd).startswith('!! '), F.learnloop_weekly_line(n, hb, rd)
        w(at='2026-11-02T06:00:00Z'); assert 'STALE' in F.learnloop_weekly_line(n, hb, rd)
        w(status='failed'); assert F.learnloop_weekly_line(n, hb, rd).startswith('!! ')
        json.dump({'phases': {'teach': {'status': 'waiting', 'waiting_since': '2026-10-30T06:00:00Z', 'wait': 'GPU busy'}}}, open(os.path.join(rd, 'R1', 'state.json'), 'w'))
        w(); assert 'waiting 78 h' in F.learnloop_weekly_line(n, hb, rd), F.learnloop_weekly_line(n, hb, rd)


# ---------------------------------------------------------------- mutants

def mutant(path, old, new, test):
    src = open(path).read()
    assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r' % old[:60]
    mod = types.ModuleType('m'); mod.__file__ = path
    code = src.replace(old, new)
    if path.endswith('weekly.py'):
        exec(compile(code, path, 'exec'), mod.__dict__)
        saved = W.__dict__.copy(); W.__dict__.update({k: v for k, v in mod.__dict__.items() if callable(v)})
        try:
            test(); return False
        except Exception:          # the intended test fails (an assertion, or the mutant's own crash in it)
            return True
        finally:
            W.__dict__.update(saved)
    if path.endswith('build_clean.py'):
        import build_clean as BC
        exec(compile(code, path, 'exec'), mod.__dict__)
        saved = BC.__dict__.copy(); BC.__dict__.update({k: v for k, v in mod.__dict__.items() if callable(v)})
        try:
            test(); return False
        except Exception:          # the intended test fails (an assertion, or the mutant's own crash in it)
            return True
        finally:
            BC.__dict__.update(saved)
    raise ValueError(path)


@t
def mutants_are_killed():
    wp = os.path.join(HERE, 'weekly.py')
    cases = [
        ("c['hard'] <= inc['hard']", "c['hard'] <= inc['hard'] + 5", incumbent_gate_s4a),
        ("c['rep_fail'] <= best['rep_fail'] + g['rep_fail_tol_pp']", "True", best_gate_tolerances),
        ("if not (passed_inc and passed_best):", "if False:", new_best_needs_both_gates_and_better_or_smaller),
        ("c_params <= 0.6 * best_params", "c_params <= 1.0 * best_params", new_best_needs_both_gates_and_better_or_smaller),
        ("return z < -z_crit, round(z, 2)", "return abs(z) > z_crit, round(z, 2)", drift_flags_only_a_real_drop),
        ("and len(ok) == len(recs)}", "}", latency_summary_counts_timeouts_against_the_gate),
        ("c['missing'] == 0 and inc['missing'] == 0 and", "", incumbent_gate_s4a),
        ("and gate_vs_best(sc[small[2]], sc[lead[2]], gb)['pass']", "", smaller_winner_must_pass_against_the_leader),
        ("small[1] <= 0.6 * lead[1]", "True", smaller_winner_must_pass_against_the_leader),
    ]
    bp = os.path.join(HERE, '..', 'build_clean.py')
    bcases = [
        ("    feas = lambda T: sum(min(c, int(cap * T)) for c in cnt.values()) >= T", "    feas = lambda T: True", the_cap_applies_while_filling_so_the_target_is_reached),
        ("        picked[k] = rng.sample(a, min(q[k], len(a)))", "        picked[k] = []", the_cap_applies_while_filling_so_the_target_is_reached),
        ("    clash = (set(items) | set(buf_items)) & forbid", "    clash = set()", a_gate_id_in_the_pool_is_refused),
    ]
    alive = [c[0] for c in cases if not mutant(wp, c[0], c[1], c[2])] + [c[0] for c in bcases if not mutant(bp, c[0], c[1], c[2])]
    assert not alive, 'mutants survived: %s' % alive


def main():
    ok = 0
    for fn in R:
        try:
            fn(); print('  PASS ', fn.__name__); ok += 1
        except Exception as e:                     # noqa: BLE001
            print('  FAIL ', fn.__name__, repr(e)[:300])
    print('%d passed, %d failed' % (ok, len(R) - ok))
    return 0 if ok == len(R) else 1


if __name__ == '__main__':
    sys.exit(main())
