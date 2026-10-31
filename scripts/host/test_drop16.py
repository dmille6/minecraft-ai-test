#!/usr/bin/env python3
"""Behaviour tests for scripts/host/drop16.sh (learning loop M2b) in a SANDBOX: fake env dir, manifest, unit dir,
/proc, llm logs, and fake sudo/systemctl/pgrep/holdtoken on PATH. Nothing touches a real bot. Needs flock (Linux):

    python3 scripts/host/test_drop16.py        (on 10.0.0.31; skips on a host without flock)
"""
import datetime as dt, json, os, shutil, stat, subprocess, sys, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'drop16.sh')
OLD = 'OLLAMA_BASE_URLS=http://10.0.0.72:11434,http://10.0.0.16:11434'
NEW = 'OLLAMA_BASE_URLS=http://10.0.0.72:11434'
URL1 = 'OLLAMA_BASE_URL=http://10.0.0.72:11434'
BOTS = ['w-a-Alpha', 'w-a-Bravo', 'w-b-Alpha']
PASS = FAIL = SKIP = 0

FAKE_SUDO = '#!/bin/bash\n[ "$1" = -n ] && shift\nexec "$@"\n'
FAKE_PGREP = '#!/bin/bash\n[ -n "$FAKE_LOOP" ] && echo "999 bash /home/mike/canary-loop.sh x"\nexit 0\n'
# systemctl: `restart mcbot@B.service` re-reads the env file into $PROC/<pid>/environ and logs a decision row 30 s in
# the future (the verify window starts after the last restart); FAIL_BOT makes one restart fail.
FAKE_SYSTEMCTL = r'''#!/bin/bash
pidof() { echo $(( $(echo -n "$1" | cksum | cut -d' ' -f1) % 30000 + 1000 )); }
if [ "$1" = show ]; then u=${@: -1}; b=${u#mcbot@}; b=${b%.service}; pidof "$b"; exit 0; fi
if [ "$1" = restart ]; then
  u=$2; b=${u#mcbot@}; b=${b%.service}
  echo "restart $b" >> "$SANDBOX/restarts.log"
  [ "$b" = "${FAIL_BOT:-}" ] && exit 1
  p=$(pidof "$b"); mkdir -p "$DROP16_PROC/$p"; tr '\n' '\0' < "$ENV_DIR/$b.env" > "$DROP16_PROC/$p/environ"
  ep=$(grep '^OLLAMA_BASE_URLS=' "$ENV_DIR/$b.env" | cut -d= -f2 | cut -d, -f1)
  t=$(date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%S.000Z)
  mkdir -p "$DROP16_LOGROOT/$b"
  echo "{\"@timestamp\":\"$t\",\"code\":{\"version\":\"abc12345\"},\"llm\":{\"latency_ms\":1500,\"endpoint\":\"$ep\",\"retry_count\":0}}" >> "$DROP16_LOGROOT/$b/llm-$b.jsonl"
  exit 0
fi
exit 0
'''
FAKE_HOLD = r'''#!/usr/bin/env python3
import json, os, sys
f = os.environ['SANDBOX'] + '/hold.json'; log = open(os.environ['SANDBOX'] + '/hold.log', 'a')
a = sys.argv[1:]; log.write(' '.join(a) + '\n')
if a[0] == 'owner':
    print(json.load(open(f))['owner'] if os.path.exists(f) else ''); sys.exit(0)
if a[0] == 'claim':
    if os.path.exists(f): print('REFUSED: exists'); sys.exit(3)
    json.dump({'owner': a[1]}, open(f, 'w')); print('INSTALL-HOLD by %s' % a[1]); sys.exit(0)
if a[0] == 'release':
    if os.path.exists(f) and json.load(open(f))['owner'] == a[1]: os.remove(f)
    print('released'); sys.exit(0)
'''


def check(n, f):
    global PASS, FAIL, SKIP
    try:
        f(); PASS += 1; print('  PASS  ' + n)
    except Exception as e:
        if type(e).__name__ == 'Skip':
            SKIP += 1; print('  SKIP  %s: %s' % (n, e)); return
        FAIL += 1; print('  FAIL  ' + n); traceback.print_exc()


class Skip(Exception):
    pass


def sandbox(canary=False, dropin=False, odd_line=False):
    if not shutil.which('flock') or subprocess.run(['date', '-u', '-d', '+1 seconds'], capture_output=True).returncode:
        raise Skip('needs flock and GNU date (run on 10.0.0.31)')
    d = tempfile.mkdtemp(prefix='drop16-')
    for sub in ('env', 'units', 'proc', 'logs', 'bin', 'home/digest', 'run'):
        os.makedirs(os.path.join(d, sub))
    for b in BOTS:
        lines = ['BOT_NAME=%s' % b, 'OLLAMA_MODEL=qwen2.5:7b-instruct', OLD if not (odd_line and b == BOTS[1]) else
                 'OLLAMA_BASE_URLS=http://10.0.0.16:11434,http://10.0.0.72:11434', URL1]
        open(os.path.join(d, 'env', b + '.env'), 'w').write('\n'.join(lines) + '\n')
    open(os.path.join(d, 'env', '._w-a-Alpha.env'), 'w').write('appledouble')
    json.dump({'canary_pool': 'w-a' if canary else None, 'canary_code_version': None}, open(os.path.join(d, 'manifest.json'), 'w'))
    if dropin:
        os.makedirs(os.path.join(d, 'units', 'mcbot@w-a-Alpha.service.d'))
        open(os.path.join(d, 'units', 'mcbot@w-a-Alpha.service.d', '10-canary.conf'), 'w').write('[Service]\n')
    for name, body in (('sudo', FAKE_SUDO), ('pgrep', FAKE_PGREP), ('systemctl', FAKE_SYSTEMCTL)):
        p = os.path.join(d, 'bin', name); open(p, 'w').write(body); os.chmod(p, 0o755)
    hp = os.path.join(d, 'holdtoken.py'); open(hp, 'w').write(FAKE_HOLD); os.chmod(hp, 0o755)
    shutil.copy2(SRC, os.path.join(d, 'run', 'drop16.sh'))
    # the bots' processes as they run today (old line): environ files
    for b in BOTS:
        env = dict(os.environ, SANDBOX=d, ENV_DIR=os.path.join(d, 'env'), DROP16_PROC=os.path.join(d, 'proc'),
                   DROP16_LOGROOT=os.path.join(d, 'logs'))
        subprocess.run([os.path.join(d, 'bin', 'systemctl'), 'restart', 'mcbot@%s.service' % b], env=env, check=True)
    os.remove(os.path.join(d, 'restarts.log'))
    return d


def run(d, *args, **envx):
    env = dict(os.environ, PATH=os.path.join(d, 'bin') + ':' + os.environ['PATH'], SANDBOX=d, ENV_DIR=os.path.join(d, 'env'),
               DROP16_HOME=os.path.join(d, 'home'), DROP16_MANIFEST=os.path.join(d, 'manifest.json'),
               DROP16_PROC=os.path.join(d, 'proc'), DROP16_UNITS=os.path.join(d, 'units'),
               DROP16_LOGROOT=os.path.join(d, 'logs'), DROP16_WAIT='35', DROP16_LOCK=os.path.join(d, 'canary.lock'),
               HOLDTOKEN=os.path.join(d, 'holdtoken.py'), EXPECT=str(len(BOTS)), STAGGER='0', **envx)
    r = subprocess.run(['bash', os.path.join(d, 'run', 'drop16.sh')] + list(args), env=env, capture_output=True, text=True, timeout=300)
    return r.returncode, r.stdout + r.stderr


def envs(d):
    return {b: open(os.path.join(d, 'env', b + '.env')).read() for b in BOTS}


def held(d):
    p = os.path.join(d, 'hold.log')
    return open(p).read() if os.path.exists(p) else ''


def restarts(d):
    p = os.path.join(d, 'restarts.log')
    return open(p).read().split('\n')[:-1] if os.path.exists(p) else []


def t_dry_run_is_the_default_and_changes_nothing():
    d = sandbox(); before = envs(d)
    rc, out = run(d)
    assert rc == 0 and 'DRY RUN OK' in out and envs(d) == before and restarts(d) == [], out
    assert 'claim' not in held(d), 'a dry run claims no hold (it only reads the owner)'


def t_a_declared_canary_a_dropin_or_a_loop_refuses_before_anything():
    for kw, env, want in (({'canary': True}, {}, 'a canary is declared'), ({'dropin': True}, {}, 'canary drop-ins present'),
                          ({}, {'FAKE_LOOP': '1'}, 'a canary loop is running')):
        d = sandbox(**kw); before = envs(d)
        rc, out = run(d, **env)
        assert rc == 0 and 'WOULD REFUSE: ' + want in out and 'would REFUSE now' in out, (kw, out)
        rc, out = run(d, '--apply', **env)
        assert rc == 2 and 'REFUSED: ' + want in out, (kw, rc, out)
        assert envs(d) == before and restarts(d) == [] and 'claim' not in held(d), kw


def t_an_unexpected_env_line_refuses_and_nothing_changes():
    d = sandbox(odd_line=True); before = envs(d)
    rc, out = run(d, '--apply')
    assert rc == 2 and 'not on the expected lines' in out and envs(d) == before and restarts(d) == [], out
    assert open(os.path.join(d, 'hold.log')).read().split()[0] == 'claim' and not os.path.exists(os.path.join(d, 'hold.json')), \
        'the hold was claimed then RELEASED'


def t_apply_edits_one_line_backs_up_restarts_verifies_and_releases():
    d = sandbox(); before = envs(d)
    rc, out = run(d, '--apply')
    assert rc == 0 and 'VERIFY OK' in out, out
    after = envs(d)
    for b in BOTS:
        assert after[b] == before[b].replace(OLD, NEW) and '10.0.0.16' not in after[b], after[b]
    baks = [f for f in os.listdir(os.path.join(d, 'env')) if '.bak-drop16-' in f]
    assert len(baks) == len(BOTS) and all(open(os.path.join(d, 'env', f)).read() == before[f.split('.env')[0]] for f in baks)
    assert restarts(d) == ['restart %s' % b for b in BOTS], restarts(d)
    assert not os.path.exists(os.path.join(d, 'hold.json')), 'hold released after a verified apply'
    assert '._w-a-Alpha.env' in os.listdir(os.path.join(d, 'env')) and open(os.path.join(d, 'env', '._w-a-Alpha.env')).read() == 'appledouble'


def t_a_failed_restart_keeps_the_hold_and_exits_nonzero():
    d = sandbox()
    rc, out = run(d, '--apply', FAIL_BOT=BOTS[1])
    assert rc == 4 and 'INSTALL-HOLD KEPT' in out and os.path.exists(os.path.join(d, 'hold.json')), (rc, out)
    assert 'VERIFY FAILED' in out


def t_a_failed_apply_rolls_back_by_adopting_its_kept_hold():
    """Claude r2 P2: the kept hold made a fresh rollback claim refuse -- a dead end. The printed command must work."""
    import re
    d = sandbox(); before = envs(d)
    rc, out = run(d, '--apply', FAIL_BOT=BOTS[1])
    assert rc == 4 and 'INSTALL-HOLD KEPT' in out, out
    m = re.search(r'Roll back with: bash \S+ --rollback (\S+) --hold-token (\S+)', out)
    assert m, out
    rc2, out2 = run(d, '--rollback', m.group(1))
    assert rc2 == 2 and 'install-hold not claimed' in out2, 'without the token the kept hold blocks a claim: %s' % out2
    rc3, out3 = run(d, '--rollback', m.group(1), '--hold-token', 'drop16:someone-else')
    assert rc3 == 2 and 'nothing adopted' in out3, out3
    os.rename(os.path.join(d, 'env', BOTS[0] + '.env.bak-drop16-' + m.group(1)), os.path.join(d, 'gone.bak'))
    rc5, out5 = run(d, '--rollback', m.group(1), '--hold-token', m.group(2))
    assert rc5 == 2 and 'missing backup' in out5 and os.path.exists(os.path.join(d, 'hold.json')), \
        'Codex r3 P1: a refused rollback on an ADOPTED hold keeps it: %s' % out5
    lk = open(os.path.join(d, 'canary.lock'), 'w'); import fcntl; fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    rc6, out6 = run(d, '--rollback', m.group(1), '--hold-token', m.group(2))
    lk.close()
    assert rc6 == 2 and 'is held' in out6 and os.path.exists(os.path.join(d, 'hold.json')), out6
    os.rename(os.path.join(d, 'gone.bak'), os.path.join(d, 'env', BOTS[0] + '.env.bak-drop16-' + m.group(1)))
    rc4, out4 = run(d, '--rollback', m.group(1), '--hold-token', m.group(2))
    assert rc4 == 0 and 'ROLLED BACK %s and verified' % m.group(1) in out4, out4
    assert envs(d) == before and not os.path.exists(os.path.join(d, 'hold.json')), 'restored, and the adopted hold released'


def t_rollback_restores_restarts_and_verifies_the_old_line():
    d = sandbox(); before = envs(d)
    rc, out = run(d, '--apply'); assert rc == 0, out
    stamp = [f for f in os.listdir(os.path.join(d, 'env')) if '.bak-drop16-' in f][0].split('.bak-drop16-')[1]
    os.remove(os.path.join(d, 'restarts.log'))
    rc, out = run(d, '--rollback', stamp)
    assert rc == 0 and 'ROLLED BACK %s and verified' % stamp in out, out
    assert envs(d) == before and restarts(d) == ['restart %s' % b for b in BOTS]
    rc, out = run(d, '--rollback', '20990101T000000Z')
    assert rc == 2 and 'missing backup' in out, out


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed, %d skipped' % (PASS, FAIL, SKIP))
    sys.exit(1 if FAIL else 0)
