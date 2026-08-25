#!/usr/bin/env python3
"""Prove the liveness check can say BOTH yes and no.

Six confident-zero bugs were shipped in a single day on this project, every
one of them a detector that returned the same answer to every question. A
check that guards the experiment is worthless unless it has itself been shown
a known-positive and a known-negative and told them apart.

Each case below builds a fleet on disk whose answer is known by construction,
then asserts the verdict. The mutation cases are the important ones: they
recreate the exact defects this check exists to catch, and fail if it sleeps
through them.
"""
import json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, '..', 'treatment-liveness.py')


def build(root, pools, decisions, wfacts=None):
    """pools:  {pool: {rule_key: [reporters]}}   -- the LESSONS store
       wfacts: {pool: [bots]}                    -- who wrote the WORLD MODEL
       decisions: [(bot, cited_reporters or None)]

    The two stores are built separately on purpose: they are scoped
    separately in the code, so a fixture that fills both from one input
    could not tell the two mechanisms apart.
    """
    wfacts = wfacts or {}
    state, logs = os.path.join(root, 'state'), os.path.join(root, 'logs')
    for pool in set(pools) | set(wfacts):
        d = os.path.join(state, f'_pool-{pool}')
        os.makedirs(d, exist_ok=True)
        if pool in pools:
            avoid = {k: {'skill': k.split(':')[0], 'fails': 2,
                         'reporters': sorted(v)}
                     for k, v in pools[pool].items()}
            json.dump({'schema': 6, 'avoid': avoid, 'worked': {}, 'sites': [],
                       'runs': 1, 'progress': {}},
                      open(os.path.join(d, f'lessons-{pool}.json'), 'w'))
        if pool in wfacts:
            res = {f'site{i}': {'x': i, 'reporters': [b]}
                   for i, b in enumerate(wfacts[pool])}
            json.dump({'schema': 3, 'sites': {}, 'unreachable': {},
                       'resources': res},
                      open(os.path.join(d, f'world-facts-{pool}.json'), 'w'))
    now = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + '.000Z'
    per = {}
    for bot, reps in decisions:
        per.setdefault(bot, []).append(reps)
    for bot, rows in per.items():
        d = os.path.join(logs, bot)
        os.makedirs(d, exist_ok=True)
        arm = bot.split('-')[0]
        with open(os.path.join(d, 'llm-1.jsonl'), 'w') as fh:
            for reps in rows:
                rec = {'@timestamp': now, 'bot': {'name': bot},
                       # isolated really does report a per-bot pool id; the
                       # check must not depend on this field.
                       'exp': {'arm': arm, 'pool': f'self-{bot}' if arm == 'isolated'
                               else bot.rsplit('-', 1)[0]},
                       'tool_calls': [{'skill': 'gather'}]}
                if reps is not None:
                    rec['memory'] = {'cited_rule': 'gather:{}',
                                     'cited_reporters': reps,
                                     'inherited': bot not in reps}
                fh.write(json.dumps(rec) + '\n')
    return state, logs


def run(state, logs):
    env = dict(os.environ, MCAI_STATE=state, MCAI_LOGS=logs)
    p = subprocess.run([sys.executable, CHECK, '--json', '--hours', '2'],
                       capture_output=True, text=True, env=env)
    assert p.returncode in (0, 1, 2, 3), p.stderr[-2000:]
    return json.loads(p.stdout), p.returncode


def L(out, pool):
    return [r for r in out['rows'] if r['pool'] == pool][0]['lessons']


def W(out, pool):
    return [r for r in out['rows'] if r['pool'] == pool][0]['wfacts']


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


FIVE = ['hive-a-' + n for n in ('Ann', 'Bob', 'Cid', 'Dee', 'Eve')]


@case
def sharing_pool_reads_LIVE():
    """KNOWN POSITIVE. If this does not read LIVE, the check cannot see success."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'hive-a': {'gather:{}': ['hive-a-Ann', 'hive-a-Bob']}},
                     [('hive-a-Cid', ['hive-a-Ann'])] * 250,
                     wfacts={'hive-a': ['hive-a-Ann', 'hive-a-Bob']})
        out, rc = run(s, l)
        assert L(out, 'hive-a') == 'LIVE', out['rows']
        assert W(out, 'hive-a') == 'LIVE', out['rows']
        assert rc == 0, rc


@case
def isolated_pool_reads_INERT_on_both():
    """KNOWN NEGATIVE, and the arm the first version silently dropped: the
    isolated arm reports pool='self-<bot>', so deriving the arm from that
    string matched no expectation and the negative control vanished."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t, {}, [('isolated-a-Ann', ['isolated-a-Ann'])] * 250)
        out, rc = run(s, l)
        assert L(out, 'isolated-a') == 'INERT', out['rows']
        assert W(out, 'isolated-a') == 'INERT', out['rows']
        assert rc == 0, rc


@case
def the_twenty_day_bug_reads_INERT():
    """MUTATION: the real bug. Store present, rules inheritable, gate firing
    constantly -- and nobody ever inherits, because each bot reads its own file."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'hive-a': {f'gather:{{"i":{i}}}': [b]
                                 for i, b in enumerate(FIVE)}},
                     [(b, [b]) for b in FIVE for _ in range(80)],
                     wfacts={'hive-a': FIVE})
        out, rc = run(s, l)
        assert L(out, 'hive-a') == 'INERT', out['rows']
        assert rc == 1, rc


@case
def leaking_isolation_reads_LEAK():
    """MUTATION: the opposite failure. A check that only looks for sharing
    passes here, and the control arm is silently ruined."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'isolated-a': {'gather:{}': ['isolated-a-Ann',
                                                   'isolated-a-Bob']}},
                     [('isolated-a-Cid', ['isolated-a-Ann'])] * 250)
        out, rc = run(s, l)
        assert L(out, 'isolated-a') == 'LEAK', out['rows']
        assert rc == 2, rc


@case
def pooled_world_model_is_correct_for_placebo_and_a_leak_for_isolated():
    """THE DISTINCTION THE COMBINED VERDICT HID. worldfacts.mjs pools for every
    scope except `isolated`, so a placebo pool sharing a world model is the
    design working -- while the same file under isolated is contamination.
    One 'does this arm share' verdict cannot express that."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t, {},
                     [('placebo-a-Ann', None)] * 250 +
                     [('isolated-a-Ann', None)] * 250,
                     wfacts={'placebo-a': ['placebo-a-Ann', 'placebo-a-Bob'],
                             'isolated-a': ['isolated-a-Ann', 'isolated-a-Bob']})
        out, rc = run(s, l)
        assert W(out, 'placebo-a') == 'LIVE', out['rows']
        assert W(out, 'isolated-a') == 'LEAK', out['rows']
        assert rc == 2, rc


@case
def placebo_sharing_lessons_is_a_LEAK():
    """Placebo pays the travel cost and stores no judgements. If lessons ever
    cross bots there, it is no longer a control."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'placebo-a': {'gather:{}': ['placebo-a-Ann',
                                                  'placebo-a-Bob']}},
                     [('placebo-a-Cid', ['placebo-a-Ann'])] * 250,
                     wfacts={'placebo-a': ['placebo-a-Ann']})
        out, rc = run(s, l)
        assert L(out, 'placebo-a') == 'LEAK', out['rows']
        assert rc == 2, rc


@case
def cold_start_reads_INSUFFICIENT_not_pass():
    """A freshly wiped fleet has no sharing yet. That is not a failure -- but
    it must not read as a pass, or the gate opens on no evidence at all."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'hive-a': {'gather:{}': ['hive-a-Ann']}},
                     # self-citations only: the gate is firing, but nothing has
                     # crossed between bots yet -- which is what an hour-old
                     # fleet actually looks like.
                     [('hive-a-Ann', ['hive-a-Ann'])] * 3 +
                     [('hive-a-Bob', ['hive-a-Bob'])] * 3,
                     wfacts={'hive-a': ['hive-a-Ann']})
        out, rc = run(s, l)
        assert L(out, 'hive-a') == 'INSUFFICIENT', out['rows']
        assert rc == 3, rc


@case
def stray_per_bot_store_is_caught():
    """MUTATION: the original bug's exact signature -- a correctly NAMED file
    in the wrong DIRECTORY. Every presence check ever written passed on this."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'hive-a': {'gather:{}': ['hive-a-Ann', 'hive-a-Bob']}},
                     [('hive-a-Cid', ['hive-a-Ann'])] * 250,
                     wfacts={'hive-a': ['hive-a-Ann', 'hive-a-Bob']})
        os.makedirs(os.path.join(s, 'hive-a-Ann'), exist_ok=True)
        json.dump({'avoid': {}}, open(
            os.path.join(s, 'hive-a-Ann', 'lessons-hive-a.json'), 'w'))
        out, rc = run(s, l)
        assert out['strays'], 'the stray copy was not noticed'
        assert rc == 2, rc


@case
def cross_pool_reporter_is_caught():
    """MUTATION: sharing across the pool boundary. It looks like healthy
    sharing and it destroys the experimental unit."""
    with tempfile.TemporaryDirectory() as t:
        s, l = build(t,
                     {'hive-a': {'gather:{}': ['hive-a-Ann', 'hive-b-Zed']}},
                     [('hive-a-Cid', ['hive-b-Zed'])] * 250,
                     wfacts={'hive-a': ['hive-a-Ann']})
        out, rc = run(s, l)
        row = [r for r in out['rows'] if r['pool'] == 'hive-a'][0]
        assert row['foreign_reporters'] > 0, row
        assert rc == 2, rc


if __name__ == '__main__':
    bad = 0
    for fn in CASES:
        try:
            fn()
            print(f'  ok    {fn.__name__}')
        except AssertionError as e:
            bad += 1
            print(f'  FAIL  {fn.__name__}: {e}')
    print(f'\n  {len(CASES) - bad}/{len(CASES)} passed')
    sys.exit(1 if bad else 0)
