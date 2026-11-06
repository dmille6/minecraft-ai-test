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
    assert s['timeouts_or_errors'] == 1 and not s['gates_p50_2500_p95_5000']      # 59/60 valid < 99%
    big = [{'id': i, 'latencyMs': 1000, 'schemaValid': True, 't_done_ms': 100 * i} for i in range(200)]
    big[7] = {'id': 7, 'latencyMs': 1200, 'schemaValid': False, 't_done_ms': 700}
    assert W.latency_summary(big, 3, 66)['gates_p50_2500_p95_5000']                  # 199/200 >= 99%
    for i in (11, 13):
        big[i] = {'id': i, 'latencyMs': 1200, 'schemaValid': False, 't_done_ms': 100 * i}
    assert not W.latency_summary(big, 3, 66)['gates_p50_2500_p95_5000']              # 197/200 < 99%


@t
def timeouts_count_at_full_latency():
    recs = [{'id': i, 'latencyMs': 1000, 'schemaValid': True, 't_done_ms': 1000 * i} for i in range(18)]
    recs += [{'id': 18, 'transport_error': True, 't_done_ms': 45000}, {'id': 19, 'transport_error': True, 't_done_ms': 45000}]
    s = W.latency_summary(recs, 3, 20)
    assert s['p95_ms'] == 45000 and s['p50_ms'] == 1000, s     # dropped timeouts would read p95 1000 ms


@t
def sign_test_and_significance():
    assert W.sign_p(0, 0) == 1.0 and abs(W.sign_p(7, 2) - 0.1797) < 1e-3 and W.sign_p(9, 0) < 0.01
    sw = W.significantly_worse({'hard': (7, 2), 'rep_fail': (10, 11), 'post_veto': (9, 0)}, 0.05)
    assert not sw['hard']['significantly_worse'] and not sw['rep_fail']['significantly_worse'] and sw['post_veto']['significantly_worse']
    assert not W.significantly_worse({'hard': (0, 9)}, 0.05)['hard']['significantly_worse']   # better, not worse


@t
def within_gate_rate_needs_every_lower_rung():
    ok = lambda b: {'gates_p50_2500_p95_5000': b}
    L = [4, 6, 8, 10]
    assert W.within_gate_rate({4: ok(True), 6: ok(True), 8: ok(False)}, L) == 6
    assert W.within_gate_rate({4: ok(False), 6: ok(True)}, L) == 0          # a lucky pass above a failure does not count
    assert W.within_gate_rate({4: ok(True), 6: ok(True), 8: ok(True), 10: ok(True)}, L) == 10
    assert W.within_gate_rate({}, L) is None and W.within_gate_rate({6: ok(True)}, L) is None


@t
def capacity_rule_owner_1102():
    fine = W.significantly_worse({'hard': (7, 2), 'rep_fail': (10, 11), 'post_veto': (3, 4)}, 0.05)
    L = [4, 6, 8, 10, 12, 14, 17, 20]
    assert W.capacity_rule(fine, 14, 6, L, 1.5)[0]
    assert W.capacity_rule(fine, 9, 6, L, 1.5)[0] and not W.capacity_rule(fine, 8, 6, L, 1.5)[0]     # 1.5x exactly
    assert W.capacity_rule(fine, 6, 0, L, 1.5)[0] and not W.capacity_rule(fine, 4, 0, L, 1.5)[0]     # best below the floor = 4
    bad = W.significantly_worse({'hard': (12, 1), 'rep_fail': (10, 11), 'post_veto': (3, 4)}, 0.05)
    assert not W.capacity_rule(bad, 40, 6, L, 1.5)[0]
    assert not W.capacity_rule(fine, None, 6, L, 1.5)[0] and not W.capacity_rule(fine, 14, None, L, 1.5)[0]


@t
def a_truncated_run_is_not_a_held_rate():
    one = [{'id': 0, 'latencyMs': 900, 'schemaValid': True, 't_done_ms': 900}]
    assert not W.latency_summary(one, 3, 40)['gates_p50_2500_p95_5000']
    full = [{'id': i, 'latencyMs': 900, 'schemaValid': True, 't_done_ms': 1500 * i} for i in range(120)]
    assert W.latency_summary(full, 3, 40)['gates_p50_2500_p95_5000']


@t
def card_rates_from_ladder_files():
    with tempfile.TemporaryDirectory() as d:
        def run(rate, p95_ms, n):
            recs = [{'id': i, 'model': 'm4b', 'latencyMs': 1000 if i < n * 0.9 else p95_ms, 'schemaValid': True, 't_done_ms': 1000 * i} for i in range(n)]
            open(os.path.join(d, 'm-r%d.jsonl' % rate), 'w').write(''.join(json.dumps(r) + '\n' for r in recs))
        run(20, 1600, 60); run(40, 2700, 120); run(80, 3900, 240); run(107, 5200, 321)
        out = os.path.join(d, 'cr.json')
        subprocess.run([sys.executable, os.path.join(HERE, 'card_rates.py'), '--card', 'x', '--by', 'y', '--model', 'cand=m4b@%s/m-r*.jsonl' % d,
                        '--cannot', 'best=VRAM', '--ladder', '20,40,80,107', '--out', out], check=True, capture_output=True)
        ev = json.load(open(out))
        assert ev['rates'] == {'cand': 80, 'best': 0}, ev['rates']
        # a model credited from a late first rung is refused (Claude r3): the ladder starts at 10, the files at 20
        r = subprocess.run([sys.executable, os.path.join(HERE, 'card_rates.py'), '--card', 'x', '--by', 'y', '--model', 'cand=m4b@%s/m-r*.jsonl' % d,
                            '--ladder', '10,20,40,80,107', '--out', out + '2'], capture_output=True, text=True)
        assert r.returncode != 0 and 'lacks ladder rungs' in (r.stdout + r.stderr), r.stdout + r.stderr
        r = subprocess.run([sys.executable, os.path.join(HERE, 'card_rates.py'), '--card', 'x', '--by', 'y', '--model', 'cand=other@%s/m-r*.jsonl' % d,
                            '--ladder', '20,40,80,107', '--out', out + '3'], capture_output=True, text=True)
        assert r.returncode != 0 and 'not other' in (r.stdout + r.stderr)
        # a truncated rung (one fast answer of the 120 an 40/min x 3 min run must hold) does not count as held
        open(os.path.join(d, 'm-r40.jsonl'), 'w').write(json.dumps({'id': 0, 'model': 'm4b', 'latencyMs': 900, 'schemaValid': True, 't_done_ms': 900}) + '\n')
        subprocess.run([sys.executable, os.path.join(HERE, 'card_rates.py'), '--card', 'x', '--by', 'y', '--model', 'cand=m4b@%s/m-r*.jsonl' % d,
                        '--ladder', '20,40,80,107', '--out', out], check=True, capture_output=True)
        assert json.load(open(out))['rates']['cand'] == 20
        assert W.capacity_rule(W.significantly_worse({'hard': (1, 1)}, 0.05), 80, 0, [20, 40, 80, 107], 1.5)[0]
        assert not W.capacity_rule(W.significantly_worse({'hard': (1, 1)}, 0.05), 20, 0, [20, 40, 80, 107], 1.5)[0]   # floor = the card's lowest rung


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


def run_assemble(d, n_new, n_buf, relabel_n, forbid=(), extra=None, keep_good=False):
    wr = lambda p, rows: open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in rows))
    sk = ['explore', 'gather', 'goto', 'home', 'deposit']
    wr(os.path.join(d, 'pool.jsonl'), [item('n%d' % i) for i in range(n_new)])
    wr(os.path.join(d, 'labels.jsonl'), [label('n%d' % i, sk[i % 5]) for i in range(n_new)])
    wr(os.path.join(d, 'bpool.jsonl'), [item('b%d' % i, day='2026-10-12') for i in range(n_buf)])
    wr(os.path.join(d, 'blabels.jsonl'), [label('b%d' % i, sk[i % 5]) for i in range(n_buf)])
    G5 = {'rule': 'llpatrol-01', 'milestone': 'gather_dirt#2', 'skill': 'gather', 'status': 'success', 'inventory_delta': {'dirt': 3}}
    keep_good or wr(os.path.join(d, 'good.jsonl'), [dict(item('g%d' % i, kind='good', skill='gather'), logged={**item('g').get('logged'), 'label': 'good'}, g5=G5) for i in range(4)])
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


# ---------------------------------------------------------------- G5: patrol-lap walks are never GOOD (llpatrol-01)

def trip(i, skill='gather', milestone='gather_dirt#3', gain=None, label='good', world='hive-b', bot='b1', refused=False,
         reason=None, status='success', items600=20, ms120=0, ts='2026-10-30T01:00:00.000Z'):
    return {'id': i, 'ts': ts, 'bot': bot, 'world': world, 'pool': world, 'code_version': 'v1', 'model': 'qwen2.5:7b-instruct',
            'system_hash': 'h1', 'trigger': 'idle', 'milestone': milestone, 'prompt': 'STATE: ok\nsaw_end: END-AAAA',
            'prompt_complete': True, 'response': json.dumps({'reason': 'r', 'skill': skill, 'args': {}, 'saw_end': 'END-AAAA'}),
            'nonce_ok': True, 'action': {'skill': skill, 'args': {}, 'reason': 'r'}, 'schema_valid': True, 'prompt_tokens': 10,
            'gate': {'refused': refused, 'reason': reason, 'admission': 'normal'},
            'outcome': {'status': status, 'detail': 'could not reach it' if status == 'failed' else 'ok', 'value': 'valuable',
                        'inventory_delta': gain},
            'window': {'120': {'items': 0, 'milestones': ms120, 'deaths': 0, 'stagnation': 0, 'observed': True},
                       '600': {'items': items600, 'milestones': 1, 'deaths': 0, 'stagnation': 0, 'observed': True}},
            'label': label}


@t
def patrol_lap_walks_are_never_good():
    import build_clean as BC
    P = BC.patrol_lap
    for ms in ('patrol#3315', 'return', 'deposit_surplus', 'idle'):            # every lap rung, a walk with no gain
        for sk in ('explore', 'goto', 'home'):
            assert P(trip('x', sk, ms)), (ms, sk)
            assert P(trip('x', sk, ms, gain={'cobblestone': -1})), (ms, sk)   # a block spent is not a gain
    assert not P(trip('x', 'explore', 'patrol#2', gain={'oak_log': 3}))        # the walk's own skill gained: real output
    for ms in ('gather_dirt#4', 'gather_iron_ore', 'stockpile_wood#2', 'idle+prereq', None):   # goal-directed search stays
        assert not P(trip('x', 'explore', ms)), ms
    # conversions/transfers on the rungs are no gain (Codex: no blanket craft/smelt exemption) ...
    assert P(trip('x', 'craft', 'idle', gain={'stone_pickaxe': 1}))
    assert P(trip('x', 'smelt', 'return', gain={'iron_ingot': 4}))
    assert P(trip('x', 'deposit', 'return', gain={'dirt': -40}))                     # a deposit off its rung
    # ... except a bank deposit on deposit_surplus that really removed items (the rung also completes vacuously)
    assert not P(trip('x', 'deposit', 'deposit_surplus', gain={'dirt': -40}))
    assert not P(trip('x', 'town_deposit', 'deposit_surplus', gain={'cobblestone': -64, 'dirt': -3}))
    assert P(trip('x', 'deposit', 'deposit_surplus'))                                # nothing moved
    assert P(trip('x', 'deposit', 'deposit_surplus', gain={'dirt': -40}, status='failed'))
    assert not P(trip('x', 'craft', 'gather_dirt#2', gain={'stone_pickaxe': 1}))     # off the lap G5 does not apply


def pool_fixture(d):
    """A v0 dataset + one archived day: 3 gather goods with output, 3 patrol-lap explores that pass G2/G3/G4 (the
    window counts OTHER skills' items), a bank deposit on deposit_surplus and a return walk that gained, one
    non-transient failure and one post-veto decision (the pool refuses an empty fail/post-veto pool)."""
    import gzip
    v0, days = os.path.join(d, 'v0'), os.path.join(d, 'days', '2026-10-30'); os.makedirs(v0); os.makedirs(days)
    T = [trip('g%d' % i, ts='2026-10-30T01:0%d:00.000Z' % i, bot='b%d' % i) for i in range(3)]
    T += [trip('p%d' % i, 'explore', 'patrol#%d' % i, ts='2026-10-30T02:0%d:00.000Z' % i, bot='b%d' % i) for i in range(3)]
    T += [trip('c0', 'deposit', 'deposit_surplus', gain={'dirt': -30}, bot='b0', ts='2026-10-30T03:00:00.000Z'),
          trip('r0', 'goto', 'return', gain={'dirt': 2}, bot='b1', ts='2026-10-30T03:01:00.000Z'),
          trip('f0', 'mine', label='bad', status='failed', bot='b5', ts='2026-10-30T04:00:00.000Z'),
          trip('v0', 'mine', label='neutral', refused=True, reason='repeat_loop (x3)', bot='b6', ts='2026-10-30T04:01:00.000Z'),
          trip('v1', 'gather', label='neutral', bot='b6', ts='2026-10-30T04:02:00.000Z')]
    with gzip.open(os.path.join(days, 'triples-20261030.jsonl.gz'), 'wt') as fh:
        fh.write(''.join(json.dumps(x) + '\n' for x in T))
    with gzip.open(os.path.join(v0, 'train-good.jsonl.gz'), 'wt') as fh:
        fh.write(''.join(json.dumps({'id': x['id']}) + '\n' for x in T if x['label'] == 'good'))
    json.dump({'heldout': {'worlds': ['board-a']}, 'new_days': ['2026-10-31'], 'days': ['2026-10-30', '2026-10-31']},
              open(os.path.join(v0, 'MANIFEST.json'), 'w'))
    json.dump({'v1:h1': {'template': 'You are <BOT>, <ROLE>', 'schema': {}, 'skills': ['gather', 'explore']}},
              open(os.path.join(v0, 'sysprompts.json'), 'w'))
    for n in ('pilot-1000.jsonl', 'm3-eval.jsonl'):
        open(os.path.join(v0, n), 'w').write('')
    return v0, os.path.join(d, 'days')


@t
def the_pool_keeps_patrol_lap_walks_out_of_the_good_set():
    import build_clean as BC
    with tempfile.TemporaryDirectory() as d:
        v0, days = pool_fixture(d)
        out = os.path.join(d, 'out')
        BC.main(['pool', '--v0', v0, '--days-dir', days, '--out', out, '--seed', '1', '--g-n', '100'])
        good = {json.loads(l)['id'] for l in open(os.path.join(out, 'good.jsonl'))}
        m = json.load(open(os.path.join(out, 'POOL-MANIFEST.json')))
        assert good == {'g0', 'g1', 'g2', 'c0', 'r0'}, good
        assert m['counts']['g_drop_patrol_lap'] == 3 and m['counts']['g_candidates'] == 8, m['counts']
        assert W.pool_has_g5(m)
        rows = [json.loads(l) for l in open(os.path.join(out, 'good.jsonl'))]
        assert all(BC.g5_violation(r) is None for r in rows) and all(r['g5']['rule'] == 'llpatrol-01' for r in rows)


@t
def assemble_refuses_a_good_row_that_fails_g5():
    with tempfile.TemporaryDirectory() as d:
        rows, m = run_assemble(d, 10, 0, 30)
        assert W.assembled_has_g5(m), m['filter']                                 # positive control: 4 good rows checked
        p = os.path.join(d, 'good.jsonl'); L = [json.loads(l) for l in open(p)]
        for bad in ({'milestone': 'patrol#9', 'skill': 'explore', 'inventory_delta': None}, {'rule': 'llpatrol-00'}, None):
            L2 = [dict(r) for r in L]
            if bad is None:
                L2[1].pop('g5')                                                   # an old pool's row: no evidence
            else:
                L2[1]['g5'] = dict(L2[1]['g5'], **bad)
            open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in L2))
            try:
                run_assemble(d, 10, 0, 30, keep_good=True)
            except SystemExit as e:
                assert 'fail G5' in str(e), e; continue
            raise AssertionError('not refused: %s' % bad)


@t
def a_pool_built_without_g5_is_refused():
    assert W.pool_has_g5({'rules': {'G4': 'x', 'G5': 'llpatrol-01: y'}, 'counts': {'g_drop_patrol_lap': 0}})   # zero drops is still G5
    assert not W.pool_has_g5({'rules': {'G4': 'x'}, 'counts': {'g_drop_no_output': 3}})               # the r3 manifest shape
    assert not W.pool_has_g5({'rules': {'G4': 'x', 'G5': 'llpatrol-01: y'}, 'counts': {}})
    assert not W.pool_has_g5({'rules': {'G5': 'llpatrol-00: an older rule'}, 'counts': {'g_drop_patrol_lap': 0}})
    assert W.assembled_has_g5({'filter': {'good G5 checked (llpatrol-01)': 3000}, 'composition': {'good': 3000, 'fail': 9}})
    assert not W.assembled_has_g5({'filter': {}, 'composition': {'good': 3000}})
    assert not W.assembled_has_g5({'filter': {'good G5 checked (llpatrol-01)': 2999}, 'composition': {'good': 3000}})


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
        ("and len(ok) >= 0.99 * len(recs)\n", "\n", latency_summary_counts_timeouts_against_the_gate),
        ("and len(ok) >= 0.99 * len(recs)\n", "and len(ok) >= 0.9 * len(recs)\n", latency_summary_counts_timeouts_against_the_gate),
        ("                                       and len(recs) >= rate * minutes}", "                                       }", a_truncated_run_is_not_a_held_rate),
        ("c['missing'] == 0 and inc['missing'] == 0 and", "", incumbent_gate_s4a),
        ("and gate_vs_best(sc[small[2]], sc[lead[2]], gb)['pass']", "", smaller_winner_must_pass_against_the_leader),
        ("small[1] <= 0.6 * lead[1]", "True", smaller_winner_must_pass_against_the_leader),
        ("    L = sorted((r.get('latencyMs') or TIMEOUT_MS) for r in recs)", "    L = sorted(r['latencyMs'] for r in recs if r.get('latencyMs'))", timeouts_count_at_full_latency),
        ("'significantly_worse': c > b and p < alpha}", "'significantly_worse': p < alpha}", sign_test_and_significance),
        ("            return best\n        best = r", "            continue\n        best = r", within_gate_rate_needs_every_lower_rung),
        ("    if cand_rate >= ratio * ref and cand_rate > 0:", "    if cand_rate >= ref and cand_rate > 0:", capacity_rule_owner_1102),
        ("    if worse:\n        return False", "    if False:\n        return False", capacity_rule_owner_1102),
        ("    ref = best_rate if best_rate > 0 else floor", "    ref = best_rate", capacity_rule_owner_1102),
        ("    return str((m.get('rules') or {}).get('G5', '')).startswith(G5_RULE + ':') and 'g_drop_patrol_lap' in (m.get('counts') or {})", "    return True", a_pool_built_without_g5_is_refused),
        ("    return n is not None and n == (m.get('composition') or {}).get('good', 0)", "    return True", a_pool_built_without_g5_is_refused),
    ]
    bp = os.path.join(HERE, '..', 'build_clean.py')
    bcases = [
        ("    feas = lambda T: sum(min(c, int(cap * T)) for c in cnt.values()) >= T", "    feas = lambda T: True", the_cap_applies_while_filling_so_the_target_is_reached),
        ("        picked[k] = rng.sample(a, min(q[k], len(a)))", "        picked[k] = []", the_cap_applies_while_filling_so_the_target_is_reached),
        ("    clash = (set(items) | set(buf_items)) & forbid", "    clash = set()", a_gate_id_in_the_pool_is_refused),
        ("                    if patrol_lap(t):\n", "                    if False:\n", the_pool_keeps_patrol_lap_walks_out_of_the_good_set),
        ("    return gained <= 0\n", "    return False\n", patrol_lap_walks_are_never_good),
        ("    if sk in XT.TRANSFER:\n        return True\n", "", patrol_lap_walks_are_never_good),
        (" and (t.get('outcome') or {}).get('status') == 'success' and removed > 0:", ":", patrol_lap_walks_are_never_good),
        ("    if viol:\n", "    if False:\n", assemble_refuses_a_good_row_that_fails_g5),
        ("    if not isinstance(e, dict) or e.get('rule') != G5_RULE:", "    if not isinstance(e, dict):", assemble_refuses_a_good_row_that_fails_g5),
        ("LAP_RUNGS = frozenset(('patrol', 'return', 'deposit_surplus', 'idle'))", "LAP_RUNGS = frozenset(('patrol',))", patrol_lap_walks_are_never_good),
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
