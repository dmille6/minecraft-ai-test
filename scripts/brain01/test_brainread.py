"""python3 scripts/brain01/test_brainread.py -- brainread's gates on synthetic log trees (dry-run mode, no emit)."""
import json, os, subprocess, sys, tempfile
from datetime import datetime, timedelta, timezone
HERE = os.path.dirname(os.path.abspath(__file__)); fails = 0
D0 = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def tree(spec):
    """spec: {bot: {'brain': label|None|'absent', 'n': decisions after, 'cfg': detail|None, 'endpoint_null': k}}"""
    root = tempfile.mkdtemp()
    for bot, s in spec.items():
        os.makedirs(os.path.join(root, bot))
        with open(os.path.join(root, bot, 'llm-%s.jsonl' % bot), 'w') as f:
            for era, n in (('before', s.get('n_before', s['n'])), ('after', s['n'])):
                for i in range(n):
                    t = (D0 - timedelta(minutes=170) if era == 'before' else D0 + timedelta(minutes=5)) + timedelta(seconds=i * 160 * 60 // max(1, n))
                    llm = {'latency_ms': s.get('lat', 2000) if era == 'after' else 2000, 'schema_valid': True, 'admission': 'normal', 'endpoint': 'http://x'}
                    if s.get('brain', 'absent') != 'absent' and era == 'after':
                        llm['brain'] = s['brain']
                    if i < s.get('endpoint_null', 0) and era == 'after':
                        llm['endpoint'] = None
                    f.write(json.dumps({'@timestamp': iso(t), 'llm': llm, 'outcome': {'status': 'success'}, 'tool_calls': []}) + '\n')
        with open(os.path.join(root, bot, 'skill-%s.jsonl' % bot), 'w') as f:
            if s.get('cfg'):
                f.write(json.dumps({'@timestamp': iso(D0 + timedelta(minutes=1)), 'skill': {'name': '_brain_config', 'detail': s['cfg']}}) + '\n')
    return root


def read(root, pools):
    r = subprocess.run([sys.executable, os.path.join(HERE, 'brainread.py'), '--pools', pools, '--declared', iso(D0), '--minutes', '180',
                        '--logroot', root, '--subset', '/nonexistent'], capture_output=True, text=True)
    return json.loads(r.stdout)


def check(name, cond):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name); fails += 0 if cond else 1


CFG = 'brain=gemma4 pool=[gemma4 gemma4:26b@http://127.0.0.1:11601 15000ms > local qwen2.5:7b-instruct@http://10.0.0.72:11434 45000ms]'
ctrl = {'hive-c-%s' % n: {'n': 60} for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')}
good = {**ctrl, **{'hive-a-%s' % n: {'n': 60, 'brain': 'gemma4', 'cfg': CFG} for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')}}
r = read(tree(good), 'hive-a')
check('positive control: a live gemma4 canary passes every gate', r['all_gates_pass'] and r['gates_failed'] == 0)
one = {**ctrl, 'hive-a-Alpha': {'n': 60, 'brain': 'gemma4', 'cfg': CFG}, **{'hive-a-%s' % n: {'n': 0, 'cfg': CFG} for n in ('Bravo', 'Comet', 'Delta', 'Echo')}}
r = read(tree(one), 'hive-a')
check('ONE live bot of five fails G8 (the pooled gates would pass)', not r['gates']['G8_every_bot_on_gemma4']['pass'] and r['gates']['G1_liveness']['pass'])
loc = {**good, 'hive-a-Echo': {'n': 60, 'brain': 'local', 'cfg': CFG}}
r = read(tree(loc), 'hive-a')
check('a bot deciding locally all the time fails G8', 'hive-a-Echo' in r['gates']['G8_every_bot_on_gemma4']['failing_bots'])
second = {**good, 'hive-a-Echo': {'n': 60, 'brain': 'gemma4', 'cfg': 'brain=gemma4 pool=[local qwen@x 45000ms > gemma4 gemma4:26b@y 15000ms]'}}
r = read(tree(second), 'hive-a')
check('G7 fails when gemma4 is labelled but NOT the first endpoint', not r['gates']['G7_brain_config']['pass'])
uns = {**good, 'hive-a-Alpha': {'n': 60, 'brain': 'gemma4', 'cfg': CFG, 'endpoint_null': 30}}
r = read(tree(uns), 'hive-a')
check('unserved decisions (endpoint null) fail G3; the control (no brain field) counts the same way', not r['gates']['G3_nothing_served_per_bot_h']['pass'] and r['gates']['G3_nothing_served_per_bot_h']['control'] == 0)
none = {**ctrl, **{'hive-a-%s' % n: {'n': 60} for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')}}
r = read(tree(none), 'hive-a')
check('negative control: pools with no brain fail G1, G7, G8', not r['gates']['G1_liveness']['pass'] and not r['gates']['G7_brain_config']['pass'] and not r['gates']['G8_every_bot_on_gemma4']['pass'])
slow = {**ctrl, **{'hive-a-%s' % n: {'n': 60, 'brain': 'gemma4', 'cfg': CFG, 'lat': 30000} for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')}}
r = read(tree(slow), 'hive-a')
check('decisions 28 s slower than the control at p95 fail G5', not r['gates']['G5_decision_time_p95_s']['pass'])
sys.exit(1 if fails else 0)
