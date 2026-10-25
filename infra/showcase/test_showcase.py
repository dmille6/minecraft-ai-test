#!/usr/bin/env python3
"""Behaviour tests for the showcase's pure decisions (docs/reports/showcase-2026-10-20.md).

    python3 infra/showcase/test_showcase.py        # exit 1 on any failure; no network, no hosts

Covers: the follow rule (lagging pointer, explained deploys, the witnessed hold boundary, rollback / STOP, REVOKED),
the env builder (one endpoint, bench hosts refused), the Studio proxy (pause sources, per-reservation identity, the
fail-closed acknowledgement, the fallback path over REAL sockets with fake upstreams), the timelapse (slots, pair
publish, terrain check, video sampling and no-change skip), and the status lines. Mutants for the load-bearing
guards are in test_showcase_mutants.py.
"""
import datetime as dt
import http.server
import importlib.util
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts', 'lib'))


def load(name, fn):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fn))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


FR = load('followrule', 'followrule.py')
ME = load('make_env', 'make_env.py')
SP = load('showcaseproxy', 'showcaseproxy.py')
TL = load('tl_showcase', 'tl_showcase.py')
TV = load('tl_video', 'tl_video.py')
import showcasestatus as SS  # noqa: E402

UTC = dt.timezone.utc
T0 = dt.datetime(2026, 10, 20, 0, 0, tzinfo=UTC)
A40, B40, C40, D40 = ('a' * 40), ('b' * 40), ('c' * 40), ('d' * 40)
# a linear history a <- b <- c ; d is on a side branch from a
ORDER = {A40: 0, B40: 1, C40: 2}


def is_anc(x, y):
    if x == y:
        return True
    if x in ORDER and y in ORDER:
        return ORDER[x] <= ORDER[y]
    if x == A40 and y == D40:
        return True
    return False


def merge_base(x, y):
    if is_anc(x, y):
        return x
    if is_anc(y, x):
        return y
    return A40


def obs(h, sha, verified=True, explained=False, policy='p1', deps='d1'):
    return {'t': FR.iso(T0 + dt.timedelta(hours=h)), 'sha': sha, 'verified': verified, 'explained': explained,
            'policy': policy, 'deps': deps, 'census_share': 1.0, 'census_n': 70, 'roster_n': 70}


def prom(h, sha, run='r'):
    return (T0 + dt.timedelta(hours=h), sha, run)


class FollowRule(unittest.TestCase):
    def now(self, h):
        return T0 + dt.timedelta(hours=h)

    def test_hold_until_24h_then_due(self):
        led = [obs(h, B40) for h in range(0, 24)]
        d = FR.decide(led, [prom(-1, B40)], None, self.now(23), is_anc)
        self.assertEqual(d['decision'], 'HOLD')
        led.append(obs(24, B40))
        d = FR.decide(led, [prom(-1, B40)], None, self.now(24), is_anc)
        self.assertEqual((d['decision'], d['target']), ('DUE', B40))

    def test_lagging_pointer_survives_new_promotions(self):
        # the fleet moves b -> c at h=10; b stayed INSIDE every build for 24 h, c did not
        led = [obs(h, B40 if h < 10 else C40) for h in range(0, 26)]
        d = FR.decide(led, [prom(9, C40), prom(-1, B40)], None, self.now(25), is_anc)
        self.assertEqual((d['decision'], d['target']), ('DUE', B40))

    def test_explained_rows_are_neutral_but_cannot_witness_the_boundary(self):
        # Codex r3 repro: an explained row at -24 h, verified from -23 h -> must NOT be DUE
        led = [obs(0, B40, verified=False, explained=True)] + [obs(h, B40) for h in range(1, 25)]
        d = FR.decide(led, [prom(-1, B40)], None, self.now(24), is_anc)
        self.assertEqual(d['decision'], 'HOLD', d)
        # with a verified witness at the boundary and an explained row in the middle -> DUE
        led = [obs(h, B40) for h in range(0, 25)]
        led[12] = obs(12, B40, verified=False, explained=True)
        d = FR.decide(led, [prom(-1, B40)], None, self.now(24), is_anc)
        self.assertEqual(d['decision'], 'DUE', d)

    def test_two_consecutive_unexplained_break_the_run(self):
        led = [obs(h, B40) for h in range(0, 26)]
        led[5] = obs(5, B40, verified=False)
        d = FR.decide(led, [prom(-1, B40)], None, self.now(25), is_anc)
        self.assertEqual(d['decision'], 'DUE', 'one unexplained row is tolerated')
        led[6] = obs(6, B40, verified=False)
        d = FR.decide(led, [prom(-1, B40)], None, self.now(25), is_anc)
        self.assertEqual(d['decision'], 'HOLD', d)

    def test_policy_change_restarts_the_clock(self):
        led = [obs(h, B40, policy='p1' if h < 10 else 'p2') for h in range(0, 26)]
        d = FR.decide(led, [prom(-1, B40)], None, self.now(25), is_anc)
        self.assertEqual(d['decision'], 'HOLD')

    def test_gap_restarts_the_clock(self):
        led = [obs(h, B40) for h in range(0, 26) if h not in (8, 9, 10)]
        d = FR.decide(led, [prom(-1, B40)], None, self.now(25), is_anc)
        self.assertEqual(d['decision'], 'HOLD')

    def test_rollback_needs_a_target_that_passed_24h_else_common_ancestor_else_stop(self):
        # showcase on c; the fleet goes back to the side branch d (does not contain c)
        led = [obs(h, C40) for h in range(0, 20)] + [obs(h, D40) for h in range(20, 26)]
        # a fresh promotion of d at h=19 has NOT been inside for 24 h -> common ancestor a (promoted)
        d = FR.decide(led, [prom(19, D40), prom(-5, A40)], C40, self.now(25), is_anc, merge_base)
        self.assertEqual((d['decision'], d['target']), ('ROLLBACK', A40), d)
        # no promoted common ancestor -> STOP
        d = FR.decide(led, [prom(19, D40)], C40, self.now(25), is_anc, merge_base)
        self.assertEqual(d['decision'], 'STOP', d)

    def test_revoked_is_never_a_target_and_forces_rollback(self):
        led = [obs(h, C40) for h in range(0, 26)]
        d = FR.decide(led, [prom(-1, C40), prom(-5, A40)], C40, self.now(25), is_anc, merge_base, revoked=(B40,))
        self.assertEqual((d['decision'], d['target']), ('ROLLBACK', A40), d)

    def test_noop_and_unverified_newest(self):
        led = [obs(h, B40) for h in range(0, 26)]
        self.assertEqual(FR.decide(led, [prom(-1, B40)], B40, self.now(25), is_anc)['decision'], 'NOOP')
        led.append(obs(26, B40, verified=False))
        self.assertEqual(FR.decide(led, [prom(-1, B40)], None, self.now(26), is_anc)['decision'], 'HOLD')

    def test_promotions_resolve_short_and_full_hex(self):
        j = [{'ts': '2026-10-20T11:23:13Z', 'phase': 'promoted', 'run': 'x', 'note': '9e7d998 fleet-wide'},
             {'ts': '2026-10-19T01:16:00Z', 'phase': 'promoted', 'run': 'y', 'note': 'no sha here'},
             {'ts': '2026-10-18T01:16:00Z', 'phase': 'recorded', 'run': 'z', 'note': 'KEEP'}]
        res = FR.promotions(j, lambda h: (h + '0' * 40)[:40] if h.startswith('9e7') else None)
        self.assertEqual([p[2] for p in res], ['x'])

    def test_observe_verification_and_explanations(self):
        now = T0
        feed = {'manifest': {'declared_code_version': B40, 'declared_at': '2026-10-19T00:00:00Z',
                             'canary_pool': 'board-d', 'canary_code_version': C40},
                'roster': [f'board-a-{i}' for i in range(10)] + [f'board-d-{i}' for i in range(5)],
                'census': [{'bot': f'board-a-{i}', 'ts': FR.iso(now), 'version': B40 + '+aaaaaa'} for i in range(10)]
                + [{'bot': f'board-d-{i}', 'ts': FR.iso(now), 'version': C40 + '+cccccc'} for i in range(5)],
                'errors': []}
        o = FR.observe(feed, now, 'p', 'd')
        self.assertTrue(o['verified'], o)                    # the canary pool is left out
        feed['census'][0]['version'] = D40 + '+dddddd'
        feed['census'][1]['version'] = D40 + '+dddddd'
        o = FR.observe(feed, now, 'p', 'd', prev_verified_version=D40 + '+dddddd')
        self.assertFalse(o['verified'])
        self.assertTrue(o['explained'], 'off-majority bots on the previous build = a deploy in progress')
        # coverage: only 5 of 10 expected fresh -> unverified
        feed = dict(feed, census=feed['census'][5:])
        self.assertFalse(FR.observe(feed, now, 'p', 'd')['verified'])

    def test_kept_runs(self):
        j = [{'run': 'a', 'phase': 'recorded', 'note': 'KEEP'}, {'run': 'a', 'phase': 'promoted', 'note': B40},
             {'run': 'b', 'phase': 'recorded', 'note': 'KEEP'}, {'run': 'c', 'phase': 'owner-direct', 'note': 'x'}]
        k = FR.kept_runs(j, [('a', B40), ('b', B40), ('c', B40), ('d', B40)])
        self.assertEqual({r: v[0] for r, v in k.items()}, {'a': True, 'b': False, 'c': True, 'd': False})


CONTROL = '\n'.join([
    'BOT_ROLE=gatherer', 'EXP_INSTANCE=instance-1', 'EXP_BLOCK=block2', 'MINECRAFT_HOST=10.0.0.30',
    'MINECRAFT_VERSION=1.21.8', 'MINECRAFT_AUTH=offline', 'LLM_ENABLED=true', 'OLLAMA_MODEL=qwen2.5:7b-instruct',
    'OLLAMA_NUM_CTX=8192', 'LLM_TIMEOUT_MS=45000', 'LLM_DECISION_COOLDOWN_MS=30000', 'SKILL_TIMEOUT_MS=180000',
    'OLLAMA_BASE_URLS=http://10.0.0.72:11434,http://10.0.0.16:11434', 'OLLAMA_BASE_URL=http://10.0.0.72:11434',
    'BOT_NAME=board-a-Alpha', 'MEMORY_SCOPE=board', 'MEMORY_POOL=board-a', 'EXP_ARM=board', 'HOME_X=1'])
SITE = {'home': [10, 70, 20], 'board': [13, 70, 20], 'border_radius': 5000}


class MakeEnv(unittest.TestCase):
    def test_one_endpoint_no_bench_host(self):
        rows = dict(ME.build_env(ME.parse_env(CONTROL), 0, SITE, B40))
        self.assertEqual(rows['OLLAMA_BASE_URLS'], 'http://127.0.0.1:11612|gemma4:26b')
        text = '\n'.join(f'{k}={v}' for k, v in rows.items())
        for h in ('10.0.0.16', '10.0.0.72', '192.168.19'):
            self.assertNotIn(h, text)
        self.assertEqual(rows['EXP_BLOCK'], 'showcase')
        self.assertEqual(rows['MEMORY_POOL'], 'showcase')
        self.assertEqual(rows['LLM_TIMEOUT_MS'], '45000')       # a policy knob copied from the fleet

    def test_refuses_a_bench_host_smuggled_in_a_policy_key(self):
        c = ME.parse_env(CONTROL + '\nSOME_FALLBACK=http://10.0.0.16:11434')
        with self.assertRaises(ValueError):
            ME.build_env(c, 0, SITE, B40)

    def test_names_fit_minecraft(self):
        for i, n in enumerate(ME.NAMES):
            self.assertLessEqual(len(ME.PREFIX + n), 16)


class Proxy(unittest.TestCase):
    def test_paused_sources(self):
        ex = {'/a', '/b'}.__contains__
        self.assertEqual(SP.paused(['/x', '/b'], exists=ex), '/b')
        self.assertIsNone(SP.paused(['/x'], exists=ex))
        self.assertEqual(SP.paused([], exists=ex, pause_dir='/d', listdir=lambda d: ['.hid', 'mbench-1']),
                         '/d/mbench-1')

    def test_bench_procs_never_matches_itself(self):
        ps = ('  101 /usr/bin/python3 showcaseproxy.py --pause run_bench.py\n'
              '  102 /bin/bash ./run_model.sh ollama x\n  103 python3 run_bench.py --engine ollama\n')
        self.assertTrue(SP.bench_procs(ps, own_pid=999).startswith('pid 103'))
        self.assertIsNone(SP.bench_procs('  101 python3 showcaseproxy.py run_bench.py\n', own_pid=1))

    def test_quiesce_is_fail_closed(self):
        q = SP.quiesce_state
        self.assertEqual(q(False, 0, 99, 30, None, None), 'resume')
        self.assertEqual(q(True, 1, 99, 30, False, True), 'wait')
        self.assertEqual(q(True, 0, 10, 30, False, True), 'wait')
        self.assertEqual(q(True, 0, 99, 30, True, True), 'unload')
        self.assertEqual(q(True, 0, 99, 30, None, True), 'unload')      # unreadable = not confirmed
        self.assertEqual(q(True, 0, 99, 30, False, None), 'wait')        # LM Studio state unknown
        self.assertEqual(q(True, 0, 99, 30, False, False), 'wait')       # LM Studio generating
        self.assertEqual(q(True, 0, 99, 30, False, True), 'ack')

    def test_lms_ps_parse(self):
        idle = ('IDENTIFIER    MODEL                      STATUS    SIZE        CONTEXT\n'
                'brain         gemma-4-26b-a4b-it@8bit    IDLE      27.99 GB    16384\n')
        busy = idle.replace('IDLE', 'GENERATING')
        self.assertIs(SP.lms_brain_idle(idle), True)
        self.assertIs(SP.lms_brain_idle(busy), False)
        self.assertIsNone(SP.lms_brain_idle('garbage'))
        self.assertIs(SP.lms_brain_idle('No models are currently loaded'), True)
        # DRILL 2026-10-20 ~13:50Z on the Studio: `lms server stop`, then `lms ps` -> rc 0, the SAME table (the app
        # still holds the model; only the HTTP server stopped), and `lms server status` still "not running" after
        # it: `lms ps` does not start the server. Captured verbatim:
        down = ('\nIDENTIFIER    MODEL                      STATUS    SIZE        CONTEXT    PARALLEL    LOAD CONFIG    '
                'DEVICE    TTL\nbrain         gemma-4-26b-a4b-it@8bit    IDLE      27.99 GB    16384      12          '
                'LM Studio      Local        \n')
        self.assertIs(SP.lms_brain_idle(down), True)

    def test_reservation_replaced_in_place_is_a_new_reservation(self):
        with tempfile.TemporaryDirectory() as d:
            r = os.path.join(d, 'GPU_RESERVED')
            open(r, 'w').write('run-A')
            s1 = SP.pause_signature([r], None, None)
            os.remove(r)
            open(r, 'w').write('run-B')                     # same path, same size, within one poll
            s2 = SP.pause_signature([r], None, None)
            self.assertNotEqual(s1, s2)

    def test_ack_names_its_reservations_and_unknown_is_unknown(self):
        sig = ((('/r/GPU_RESERVED', 1, 21, b'run-x-123-1792500000\n'), ('/r/LIVE', 2, 0, b'')),
               (('/d/mbench-7', 3, 5, b'x'),), 'pid 9: run_bench.py')
        lines = SP.ack_text(sig, 0).splitlines()
        self.assertIn('RESV run-x-123-1792500000', lines)
        self.assertIn('RESV mbench-7', lines)
        self.assertIn('PROC pid 9: run_bench.py', lines)
        self.assertEqual(sum(1 for l in lines if l.startswith('RESV')), 3, 'exactly the validated reservations')
        self.assertIsNone(SP.ollama_resident({}, 'q'))
        self.assertIsNone(SP.ollama_resident({'models': None}, 'q'))
        self.assertIs(SP.ollama_resident({'models': []}, 'q'), False)
        self.assertIs(SP.ollama_resident({'models': [{'name': 'q'}]}, 'q'), True)

    def test_translate_and_names(self):
        b = SP.translate({'messages': [], 'format': {'type': 'object'}}, 'brain', False)
        self.assertEqual(b['chat_template_kwargs'], {'enable_thinking': False})
        b = SP.translate({'messages': [], 'think': True}, 'brain', False)
        self.assertEqual(b['chat_template_kwargs'], {'enable_thinking': True})
        self.assertEqual(SP.served_name('brain', 'brain', 'gemma4:26b'), 'gemma4:26b')
        self.assertEqual(SP.served_name(None, 'brain', 'gemma4:26b'), 'lmstudio:unknown')
        fb = SP.fallback_body({'model': 'gemma4:26b', 'keep_alive': '30m', 'stream': True}, 'qwen2.5:7b-instruct')
        self.assertEqual((fb['model'], fb['stream'], fb['keep_alive']), ('qwen2.5:7b-instruct', False, '30m'))


class QuiesceTransitions(unittest.TestCase):
    """mark_quiesced() through its transitions, with the upstream probes and the unload call stubbed."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.resv = os.path.join(self.d, 'GPU_RESERVED')

        class A:
            pass
        a = A()
        a.pause_file, a.pause_dir = [self.resv], None
        a.quiesced_file = os.path.join(self.d, 'QUIESCED')
        a.quiesce_grace, a.fallback, a.fallback_model, a.log = 30, 'http://x', 'q', None
        self.saved = (SP.A, dict(SP.STATE), SP.probe_upstreams, SP.post_json)
        SP.A = a
        SP.STATE.clear()
        SP.STATE.update({'inflight': 0})
        self.probes, self.unloads = [], []
        self.probe_answer = (False, True)
        self.on_probe = None

        def probe():
            self.probes.append(1)
            if self.on_probe:
                self.on_probe()
            return self.probe_answer
        SP.probe_upstreams = probe
        SP.post_json = lambda url, body, t: self.unloads.append(body)

    def tearDown(self):
        SP.A, st, SP.probe_upstreams, SP.post_json = self.saved
        SP.STATE.clear()
        SP.STATE.update(st)

    def write(self, txt):
        with open(self.resv, 'w') as f:
            f.write(txt + '\n')

    def ack(self):
        p = SP.A.quiesced_file
        return open(p).read() if os.path.exists(p) else None

    def test_grace_then_ack_naming_the_reservation(self):
        self.write('run-x-1-100')
        SP.mark_quiesced(now=1000.0)
        self.assertIsNone(self.ack(), 'inside the grace')
        SP.mark_quiesced(now=1031.0)
        self.assertIn('RESV run-x-1-100', self.ack())
        self.assertEqual(len(self.probes), 1, 'Ollama/LM Studio probed even with no in-memory flag (restart-safe)')

    def test_reservation_replaced_during_the_probes_gets_no_ack(self):
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        self.on_probe = lambda: self.write('run-b-2-200')      # B arrives while A's probes run
        SP.mark_quiesced(now=1031.0)
        self.assertIsNone(self.ack(), 'an ack must never be published for a signature that changed')
        self.on_probe = None
        SP.mark_quiesced(now=1032.0)                           # B is new: its own grace starts
        self.assertIsNone(self.ack())
        SP.mark_quiesced(now=1063.0)
        a = self.ack()
        self.assertIn('RESV run-b-2-200', a)
        self.assertNotIn('run-a-1-100', a)

    def test_one_unload_per_pause_even_when_the_tag_changes(self):
        self.probe_answer = (True, True)                       # the fallback is resident
        self.write('pending-pause-c1-9-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertEqual(len(self.unloads), 1)
        self.write('pause-c1')                                 # the Stage C tag: same pause, new signature
        SP.mark_quiesced(now=1032.0)
        SP.mark_quiesced(now=1063.0)
        self.assertEqual(len(self.unloads), 1, 'a tag change must not re-authorise an unload')
        self.assertIsNone(self.ack(), 'still resident after the one unload, no handoff yet -> fail closed')
        os.remove(self.resv)                                   # the pause ends
        SP.mark_quiesced(now=1100.0)
        self.write('run-next-3-300')                           # a NEW pause: its own single unload
        SP.mark_quiesced(now=1200.0)
        SP.mark_quiesced(now=1231.0)
        self.assertEqual(len(self.unloads), 2)

    def test_no_unload_after_a_handoff_that_needed_none(self):
        # Codex r6 repro: qwen absent -> ack; the benchmark then loads qwen; the Stage C tag changes the signature.
        self.probe_answer = (False, True)
        self.write('pending-pause-c2-9-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertIn('RESV pending-pause-c2-9-100', self.ack())
        self.probe_answer = (True, True)                       # the BENCHMARK's qwen now
        self.write('pause-c2')
        n_probes = len(self.probes)
        SP.mark_quiesced(now=1032.0)
        self.assertEqual(self.unloads, [], 'eligibility closed at the handoff: the benchmark model is never unloaded')
        self.assertIsNotNone(self.ack(), 'the next reservation in the same pause is acknowledged at once')
        self.assertIn('RESV pause-c2', self.ack())
        self.assertEqual(len(self.probes), n_probes, 'no probe after the handoff (nothing on the GPU is ours)')

    def test_resumed_admission_ends_the_handoff(self):
        # Codex r7 repro: ack A -> pause removed -> a request is admitted and finishes -> reservation B appears BEFORE
        # the next poll. B must get a fresh grace and fresh probes, not the post-handoff fast path.
        SP.A.max_inflight = 4
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertIn('RESV run-a-1-100', self.ack())
        os.remove(self.resv)                                   # pause over (no poll in between)
        p, _, _ = SP.admit()
        self.assertIsNone(p)
        self.assertIsNone(self.ack(), 'admission withdraws the old ack')
        SP.finish()
        SP.STATE['last_done'] = 1040.0
        self.write('run-b-2-200')
        n = len(self.probes)
        SP.mark_quiesced(now=1041.0)
        self.assertIsNone(self.ack(), 'B is inside its grace: no immediate ack')
        SP.mark_quiesced(now=1072.0)
        self.assertEqual(len(self.probes), n + 1, 'B was probed afresh')
        self.assertIsNotNone(self.ack())
        self.assertIn('RESV run-b-2-200', self.ack())

    def test_restart_during_a_handed_off_pause_never_unloads(self):
        # Codex r8 repro: ack A -> the benchmark loads qwen -> the proxy RESTARTS with A still held.
        self.probe_answer = (False, True)
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertIsNotNone(self.ack())
        self.probe_answer = (True, True)                       # the benchmark's qwen
        SP.STATE.clear()                                       # --- proxy restart: memory gone ---
        SP.STATE.update({'inflight': 0})
        self.assertTrue(SP.restore_handoff(SP.is_paused()), 'the handoff file restores the handoff')
        SP.mark_quiesced(now=2000.0)
        SP.mark_quiesced(now=2031.0)
        self.assertEqual(self.unloads, [], 'a restart must never reopen unload eligibility')
        self.assertIsNotNone(self.ack())
        self.assertIn('RESV run-a-1-100', self.ack())
        os.remove(self.resv)                                   # pause ends -> handoff file removed
        SP.mark_quiesced(now=2100.0)
        self.assertFalse(os.path.exists(SP.handoff_path()))

    def test_crash_between_marker_and_ack_still_never_unloads(self):
        # Codex r9: the marker is persisted BEFORE the ack. A crash right after the marker (ack never written) must
        # still restore the handoff on restart -> no unload of the benchmark's model.
        self.probe_answer = (False, True)
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        real_replace = SP.os.replace
        def crash(src, dst):
            raise KeyboardInterrupt('crash before the ack rename')
        SP.os.replace = crash
        try:
            with self.assertRaises(KeyboardInterrupt):
                SP.mark_quiesced(now=1031.0)
        finally:
            SP.os.replace = real_replace
        self.assertTrue(os.path.exists(SP.handoff_path()), 'the marker was persisted first')
        self.assertIsNone(self.ack(), 'the ack never became visible')
        self.probe_answer = (True, True)                       # the benchmark loads qwen after all
        SP.STATE.clear(); SP.STATE.update({'inflight': 0})     # restart
        SP.restore_handoff(SP.is_paused())
        SP.mark_quiesced(now=2000.0)
        SP.mark_quiesced(now=2031.0)
        self.assertEqual(self.unloads, [])

    def test_marker_persistence_failure_means_no_ack(self):
        SP.A.max_inflight = 4
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        real = SP.save_handoff
        SP.save_handoff = lambda on: False
        try:
            SP.mark_quiesced(now=1031.0)
            self.assertIsNone(self.ack(), 'no marker -> no ack (fail closed)')
            os.remove(self.resv)
            p, _, n = SP.admit()
            self.assertIsNone(p, 'not handed off yet: admission is unaffected')
            SP.finish()
        finally:
            SP.save_handoff = real

    def test_marker_removal_failure_keeps_admission_closed(self):
        SP.A.max_inflight = 4
        self.write('run-a-1-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertIsNotNone(self.ack())
        os.remove(self.resv)
        real = SP.save_handoff
        SP.save_handoff = lambda on: on                       # removal (on=False) fails
        try:
            p, _, n = SP.admit()
            self.assertTrue(p, 'a marker that cannot be removed keeps admission closed')
            self.assertEqual(n, 0)
        finally:
            SP.save_handoff = real

    def test_admitted_request_blocks_the_ack_and_paused_admission_refuses(self):
        SP.A.max_inflight = 4
        p, full, n = SP.admit()                                # a request admitted BEFORE the pause began
        self.assertEqual((p, full, n), (None, False, 1))
        self.write('run-x-1-100')
        SP.mark_quiesced(now=1000.0)
        SP.mark_quiesced(now=1031.0)
        self.assertIsNone(self.ack(), 'an admitted request blocks the ack')
        p2, _, n2 = SP.admit()                                 # admission during the pause refuses
        self.assertTrue(p2)
        self.assertEqual(n2, 1)
        SP.finish()
        SP.mark_quiesced(now=1062.0)                           # finished just now: the grace counts from last_done
        SP.STATE['last_done'] = 1000.0
        SP.mark_quiesced(now=1100.0)
        self.assertIn('RESV run-x-1-100', self.ack())

    def test_inflight_blocks_the_ack(self):
        self.write('run-x-1-100')
        SP.mark_quiesced(now=1000.0)
        SP.STATE['inflight'] = 1
        SP.mark_quiesced(now=1031.0)
        self.assertIsNone(self.ack())


class FilebeatRoutes(unittest.TestCase):
    """Mechanism 2 of the exclusion (design s.4): the VM's filebeat can only name SHOWCASE streams. A structural
    test on purpose (a config file has no behaviour to call); comments stripped first, since they name bench streams."""
    SHOWCASE = {'mcai-skill-showcase', 'mcai-llm-showcase', 'mcai-mc-showcase', 'mcai-sys-showcase',
                'mcai-showcase-ops', 'mcai-misc-showcase'}
    BENCH = ('mcai-skill-agents', 'mcai-llm-agents', 'mcai-mc-paper', 'mcai-sys-journal', 'mcai_ship')

    def test_only_showcase_indices_and_the_scoped_credential(self):
        import re
        code = '\n'.join(l.split('#', 1)[0] for l in open(os.path.join(HERE, 'files', 'filebeat.yml')).read().splitlines())
        names = set(re.findall(r'index:\s*"([^"]+)"', code))
        self.assertTrue(names, 'the parse found no index at all (the test would pass vacuously)')
        self.assertLessEqual(names, self.SHOWCASE, f'non-showcase index routed: {names - self.SHOWCASE}')
        self.assertIn('mcai-misc-showcase', names, 'the catch-all must be the showcase misc stream')
        for b in self.BENCH:
            self.assertNotIn(b, code, f'{b} appears in an executable line')
        self.assertIn('${ES_USER}', code)
        self.assertIn('${ES_PASS}', code)


class GuardScript(unittest.TestCase):
    """studio-gpu-guard.sh under /bin/bash (3.2 on macOS, as on the Studio, whose -nt compares whole seconds)."""

    def run_guard(self, resv_token, ack_lines, wait=4):
        import subprocess
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, 'bin'))
        with open(os.path.join(d, 'bin', 'pgrep'), 'w') as f:
            f.write('#!/bin/sh\nexit 0\n')                  # "a proxy is running"
        os.chmod(os.path.join(d, 'bin', 'pgrep'), 0o755)
        resv = os.path.join(d, 'GPU_RESERVED')
        open(resv, 'w').write(resv_token + '\n')
        q = os.path.join(d, 'QUIESCED')
        open(q, 'w').write('2026-10-20T00:00:00Z quiesced\n' + ''.join(l + '\n' for l in ack_lines))  # SAME second
        env = dict(os.environ, PATH=os.path.join(d, 'bin') + ':' + os.environ['PATH'], HOME=d,
                   SHOWCASE_QUIESCED=q, SHOWCASE_QUIESCE_WAIT_S=str(wait))
        r = subprocess.run(['/bin/bash', '-c', f'. {os.path.join(HERE, "studio-gpu-guard.sh")}; '
                                               f'showcase_await_quiesced {resv}'], env=env, capture_output=True,
                           text=True, timeout=30)
        return r.returncode

    def test_ack_in_the_same_second_naming_the_token_is_accepted(self):
        self.assertEqual(self.run_guard('run-x-1-100', ['RESV run-x-1-100']), 0)

    def test_ack_for_another_reservation_is_refused(self):
        self.assertEqual(self.run_guard('run-y-2-200', ['RESV run-x-1-100'], wait=2), 1)


class SaveHoldLock(unittest.TestCase):
    def setUp(self):
        self.R = load('rcon', 'rcon.py')
        self.calls = []
        self.R.save_hold = lambda on: self.calls.append(on) or 'ok'
        self.lock = os.path.join(tempfile.mkdtemp(), 'save.lock')

    def test_exclusive_and_non_owner_does_not_touch_saves(self):
        with self.R.SaveHold(wait_s=0, path=self.lock) as a:
            self.assertTrue(a.held)
            with self.R.SaveHold(wait_s=0, path=self.lock) as b:
                self.assertFalse(b.held)
        self.assertEqual(self.calls, [True, False], 'only the owner paused and resumed saving')

    def test_failed_enter_unwinds(self):
        def boom(on):
            self.calls.append(on)
            if on:
                raise TimeoutError('save-all flush timed out')
        self.R.save_hold = boom
        with self.assertRaises(TimeoutError):
            with self.R.SaveHold(wait_s=0, path=self.lock):
                pass
        self.assertEqual(self.calls, [True, False], 'save-on after a failed save-off')
        self.R.save_hold = lambda on: 'ok'
        with self.R.SaveHold(wait_s=0, path=self.lock) as c:
            self.assertTrue(c.held, 'the lock was released')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


class _Fake(http.server.BaseHTTPRequestHandler):
    mode = 'ok'
    seen = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        self._j(200, {'data': [{'id': 'brain'}]} if self.path.startswith('/v1/models') else {'models': []})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(n) or b'{}')
        type(self).seen.append((self.path, body))
        if type(self).mode == 'fail':
            return self._j(500, {'error': 'down'})
        if self.path.startswith('/v1/chat'):
            return self._j(200, {'model': 'brain', 'choices': [{'message': {'content': '{"ok":1}'},
                                                                'finish_reason': 'stop'}],
                                 'usage': {'prompt_tokens': 3, 'completion_tokens': 2}})
        return self._j(200, {'model': body.get('model'), 'message': {'role': 'assistant', 'content': '{"ok":2}'},
                             'done': True})

    def _j(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)


class ProxyOverSockets(unittest.TestCase):
    """The real handler on real sockets, with fake LM Studio and fake Ollama upstreams."""

    @classmethod
    def setUpClass(cls):
        class Up(_Fake):
            mode, seen = 'ok', []

        class Fb(_Fake):
            mode, seen = 'ok', []
        cls.Up, cls.Fb = Up, Fb
        cls.up = http.server.ThreadingHTTPServer(('127.0.0.1', free_port()), Up)
        cls.fb = http.server.ThreadingHTTPServer(('127.0.0.1', free_port()), Fb)
        for s in (cls.up, cls.fb):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        cls.tmp = tempfile.mkdtemp()
        cls.off = os.path.join(cls.tmp, 'OFF')

        class A:
            pass
        a = A()
        a.upstream = f'http://127.0.0.1:{cls.up.server_address[1]}'
        a.fallback = f'http://127.0.0.1:{cls.fb.server_address[1]}'
        a.fallback_model, a.model, a.serve_as = 'qwen2.5:7b-instruct', 'brain', 'gemma4:26b'
        a.max_inflight, a.timeout, a.fallback_timeout = 4, 5, 5
        a.log, a.default_think = None, False
        a.pause_file, a.pause_dir, a.quiesced_file = [cls.off], None, None
        a.quiesce_grace, a.lms = 30, '/nonexistent'
        SP.A = a
        cls.px = http.server.ThreadingHTTPServer(('127.0.0.1', free_port()), SP.H)
        threading.Thread(target=cls.px.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.px.server_address[1]}'

    def chat(self):
        req = urllib.request.Request(self.url + '/api/chat', data=json.dumps(
            {'model': 'gemma4:26b', 'messages': [{'role': 'user', 'content': 'x'}], 'format': {'type': 'object'},
             'options': {'num_ctx': 8192}}).encode(), headers={'Content-Type': 'application/json'})
        try:
            r = urllib.request.urlopen(req, timeout=10)
            return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')

    def test_primary_then_fallback_then_paused(self):
        self.Up.mode = 'ok'
        code, d = self.chat()
        self.assertEqual((code, d['model']), (200, 'gemma4:26b'))
        sent = self.Up.seen[-1][1]
        self.assertEqual(sent['chat_template_kwargs'], {'enable_thinking': False})
        self.Up.mode = 'fail'
        code, d = self.chat()
        self.assertEqual((code, d['model']), (200, 'qwen2.5:7b-instruct'), 'served by the Studio fallback')
        self.assertEqual(self.Fb.seen[-1][1]['options'], {'num_ctx': 8192})
        open(self.off, 'w').write('x')
        try:
            n_up, n_fb = len(self.Up.seen), len(self.Fb.seen)
            code, d = self.chat()
            self.assertEqual(code, 503)
            self.assertEqual((len(self.Up.seen), len(self.Fb.seen)), (n_up, n_fb), 'paused calls NO model')
        finally:
            os.remove(self.off)
            self.Up.mode = 'ok'


class Timelapse(unittest.TestCase):
    def test_missing_slots_counts_from_outside(self):
        now = T0 + dt.timedelta(hours=2, minutes=7)
        oks = [T0 + dt.timedelta(minutes=15 * k) for k in range(8) if k != 3]
        miss, exp = SS.missing_slots(oks, now, 15, T0)
        self.assertEqual((miss, exp), (1, 8))
        self.assertEqual(SS.missing_slots([], now, 15, T0), (8, 8), 'a job that never ran = all missing')

    def test_pair_publish_all_or_nothing(self):
        moved = []
        ok, why = TL.publish_pair(['a', 'b'], ['A', 'B'], size=lambda p: 99999, exists=lambda p: True,
                                  replace=lambda s, f: moved.append(f), content_ok=lambda p: p != 'b')
        self.assertFalse(ok)
        self.assertEqual(moved, [])
        ok, _ = TL.publish_pair(['a', 'b'], ['A', 'B'], size=lambda p: 99999, exists=lambda p: True,
                                replace=lambda s, f: moved.append(f))
        self.assertTrue(ok)
        self.assertEqual(moved, ['A', 'B'])

    def _capture_with(self, writes, rc):
        """Run TL.capture with capture.mjs faked: it writes the staged files whose view is in `writes`, exits rc."""
        import tempfile, types
        root = tempfile.mkdtemp()
        cam = {'x': 0.5, 'y': 70, 'z': 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0, 'ortho': 1, 'mode': 'flat', 'fov': None}
        cfg = {'root': root, 'web': 'http://x', 'map_id': 'm', 'width': 1920, 'height': 1080, 'capture_dir': root,
               'cameras': {'topdown': cam, 'angled': cam, 'town': dict(cam, width=1440, height=1440)}}
        seen = {}

        def fake_run(cmd, input=None, **kw):
            jobs = json.loads(input)
            seen['jobs'] = jobs
            for j in jobs:
                if any(('/%s-' % v) in j['out'] for v in writes):
                    open(j['out'], 'wb').write(b'x' * 30000)
            return types.SimpleNamespace(returncode=rc, stdout='', stderr='FAIL' if rc else '')
        old = (TL.subprocess.run, TL.small_gray, TL.terrain_ok)
        TL.subprocess.run, TL.small_gray, TL.terrain_ok = fake_run, (lambda p: b''), (lambda g: True)
        try:
            out = TL.capture(cfg, '20261025T1800Z')
        finally:
            TL.subprocess.run, TL.small_gray, TL.terrain_ok = old
        return out, seen['jobs'], root

    def test_town_camera_is_extra_and_never_costs_the_pair(self):
        self.assertEqual(TL.extra_views({'cameras': {'topdown': {}, 'angled': {}, 'town': {}}}), ['town'])
        (rc, msg, got, _, _, extra, err, raw), jobs, root = self._capture_with({'topdown', 'angled'}, 1)
        self.assertEqual((raw, list(err)), (1, ['town']), 'the town failure keeps its diagnostics')
        self.assertEqual(rc, 0, msg)
        self.assertEqual(len(got), 2, 'the pair is published although the town job failed')
        self.assertEqual(extra, [])
        self.assertEqual([(j['width'], j['height']) for j in jobs], [(1920, 1080), (1920, 1080), (1440, 1440)], 'per-camera size')
        (rc, msg, got, _, _, extra, _, _), _, root = self._capture_with({'topdown', 'town'}, 1)
        self.assertEqual(got, [], 'a broken pair is not published')
        self.assertEqual(len(extra), 1, 'the town frame is published on its own')
        self.assertTrue(extra[0].endswith('/frames/town/20261025/20261025T1800Z.png'))
        (rc, msg, got, _, _, extra, err, _), _, _ = self._capture_with({'topdown', 'angled', 'town'}, 0)
        self.assertEqual(err, {})
        self.assertEqual((rc, len(got), len(extra)), (0, 2, 1))

    def test_town_video_uses_its_own_frames(self):
        old = TV.all_stamps
        TV.all_stamps = lambda v: {'town': ['20261025T1800Z'], 'angled': [], 'topdown': []}[v]
        try:
            st = TV.sample(TV.all_stamps('town'), dt.datetime(2026, 10, 25, tzinfo=dt.timezone.utc),
                           dt.datetime(2026, 10, 26, tzinfo=dt.timezone.utc), None)
            self.assertEqual(st, ['20261025T1800Z'])
            self.assertEqual(TV.paired_stamps(), [], 'the town frame never enters the pair')
        finally:
            TV.all_stamps = old
        self.assertIn('town', TV.EXTRA)

    def test_town_only_month_is_built(self):
        import types
        calls = []
        old = (TV.all_stamps, TV.build)
        TV.all_stamps = lambda v: {'town': ['20261001T1800Z'], 'angled': [], 'topdown': []}[v]
        TV.build = lambda v, st, out, name: calls.append((v, st)) or {'view': v}
        old_argv = TV.sys.argv
        TV.sys.argv = ['tl_video.py', 'monthly', '--month', '2026-10']
        try:
            TV.main()
        finally:
            TV.all_stamps, TV.build = old
            TV.sys.argv = old_argv
        self.assertIn(('town', ['20261001T1800Z']), calls, 'a month with town frames but no pair is not skipped')

    def test_terrain_check(self):
        sky = bytes([160]) * 1000
        self.assertFalse(TL.terrain_ok(sky))
        half = bytes([160]) * 600 + bytes([60]) * 400
        self.assertTrue(TL.terrain_ok(half))
        self.assertFalse(TL.terrain_ok(b''))

    def test_regions_and_camera(self):
        self.assertEqual(TL.regions_for(0, 0, 100), ['r.-1.-1.mca', 'r.-1.0.mca', 'r.0.-1.mca', 'r.0.0.mca'])
        h = TL.camera_hash('showcase', {'x': 1, 'y': 70, 'z': 2, 'distance': 300, 'rotation': 0, 'angle': 0.7,
                                        'ortho': 0, 'mode': 'perspective'})
        self.assertTrue(h.startswith('#showcase:1.0:70:2.0:300:'))

    def test_video_sampling_and_dedup(self):
        st = [f'20261020T{h:02d}{m:02d}Z' for h in range(0, 3) for m in (0, 15, 30, 45)] + ['20261020T0016Z-event-x']
        lo, hi = T0, T0 + dt.timedelta(hours=3)
        self.assertEqual(TV.sample(st, lo, hi, 60), ['20261020T0000Z', '20261020T0100Z', '20261020T0200Z'])
        self.assertEqual(len(TV.sample(st, lo, hi, None)), 12, 'event frames are never sampled')
        frames = {s: bytes([i // 4]) * 100 for i, s in enumerate(TV.sample(st, lo, hi, None))}
        kept, skipped = TV.dedup(list(frames), frames.get, level=0, min_frac=0.5)
        self.assertEqual((len(kept), skipped), (4, 8))     # first + 2 changes + last (unchanged, kept anyway)

    def test_status_lines(self):
        now = T0 + dt.timedelta(hours=1)
        rows = [{'t': FR.iso(T0 + dt.timedelta(minutes=15 * k)), 'ok': True, 'stamp':
                 (T0 + dt.timedelta(minutes=15 * k)).strftime('%Y%m%dT%H%MZ'), 'capture_min': 15,
                 'render_cpu_s': 5, 'capture_cpu_s': 7} for k in range(4)]
        line = SS.timelapse_line(rows, now, frame0=T0)
        self.assertTrue(line.startswith('SHOWCASE TIMELAPSE OK'), line)
        self.assertIn('4 of 4 slots', line)
        self.assertTrue(SS.timelapse_line([], now).startswith('SHOWCASE TIMELAPSE NO HEARTBEAT'))
        stale = SS.timelapse_line(rows, now + dt.timedelta(hours=2), frame0=T0)
        self.assertIn('STALE', stale)
        p = SS.pause_line([dict(rows[-1], brain={'ok': False, 'paused_by': '/x/GPU_RESERVED',
                                                 'paused_since': FR.iso(T0 - dt.timedelta(hours=8))})], now)
        self.assertIn('PAUSED by /x/GPU_RESERVED', p)
        self.assertIn('stale holder', p)
        b = SS.brain_line({'gemma4:26b': 90, 'qwen2.5:7b-instruct': 5}, 5, 100, 0)
        self.assertIn('gemma4 90 (90.0%)', b)


if __name__ == '__main__':
    r = unittest.main(exit=False, verbosity=1).result
    sys.exit(0 if r.wasSuccessful() else 1)
