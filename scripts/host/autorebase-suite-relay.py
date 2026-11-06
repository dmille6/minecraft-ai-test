#!/usr/bin/env python3
"""autorebase-suite-relay.py -- runs on the MAC (launchd com.mcai.autorebase-suite-relay, every 2 min). Phase 1 item 3a
(OWNER 11-06: "pre-build the next queued variant DURING the current canary's read, on ci2 or .30, not the loaded .31").

canary-sched.py v42's autorebase (on .31) asks for its FULL SUITE to run on a test host instead of .31 when
~/autorebase/SUITE-REMOTE exists: it writes ~/autorebase/suite/<key>.req = {run, base, sha, ref} and a local ref <ref> in
its scratch repo, then waits up to 100 min for <key>.out (the run-tests output) and <key>.done ({rc, host, label}). .31
has no ssh key to the test hosts; the Mac has both, so this relay does the hand-over:

  1. new request: fetch <ref> from .31's scratch repo into the relay's bare repo (~/mcai-autorebase-relay.git, the push
     relay's), check it IS the requested sha, and start `suite-run.py <that repo> --ref <sha> --detach` (ci2 first, .30
     second, its lock, its deadlines, a real git checkout) -- recorded in ~/mcai-autorebase-suite/<key>.json;
  2. a started run: read its remote log's last line; `DONE rc=N` -> copy the log to .31 as <key>.out, THEN write
     <key>.done (the order .31 relies on), and rename <key>.req to <key>.req-done;
  3. a run older than GIVEUP_MIN (150) with no DONE -> <key>.done {rc: "timeout"} (.31 then runs the suite itself).
A request .31 already gave up on (<key>.expired) is dropped. Light work only (ssh, scp, a fetch): a controller job.

    python3 scripts/host/autorebase-suite-relay.py            (one pass; launchd)
    python3 scripts/host/autorebase-suite-relay.py --install-launchd
"""
import datetime as dt
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile

HOST = 'mike@10.0.0.31'
HDIR = '/home/mike/autorebase/suite'
HREPO = '/home/mike/autorebase/repo.git'
R = os.path.expanduser('~/mcai-autorebase-relay.git')
STATE = os.path.expanduser('~/mcai-autorebase-suite')
SUITE_RUN = os.path.expanduser(os.environ.get('AR_SUITE_RUN', '~/bin/suite-run.py'))
TEST_HOSTS = {'ci2': 'mike@10.0.0.34', 'w30': 'mike@10.0.0.30'}
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
GIVEUP_MIN = 150
LABEL = 'com.mcai.autorebase-suite-relay'
KEY_RE = re.compile(r'^[a-z0-9][a-z0-9._-]*--[0-9a-f]{12}--[0-9a-f]{12}$')
REF_RE = re.compile(r'^refs/heads/autorebase-suite/[a-z0-9][a-z0-9._-]*-on-[0-9a-f]{8}$')


def log(msg):
    print(f'{dt.datetime.now(dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ} {msg}', flush=True)


# ------------------------------------------------------------------------------------------------ pure
def valid_request(key, req):
    """PURE. '' when a request is well-formed, else why not (the relay acts on nothing else)."""
    if not KEY_RE.match(key or ''):
        return 'bad key'
    if not isinstance(req, dict):
        return 'not an object'
    for k in ('base', 'sha'):
        if not re.match(r'^[0-9a-f]{40}$', str(req.get(k) or '')):
            return f'{k} is not a full sha'
    if not REF_RE.match(str(req.get('ref') or '')):
        return 'bad ref'
    if not key.endswith('--' + req['sha'][:12]) or ('--' + req['base'][:12] + '--') not in key:
        return 'key does not match base/sha'
    return ''


def parse_detach(out):
    """PURE. suite-run --detach's output -> (host key, label, remote log) or None."""
    m = re.search(r'host=(\w+) \(.*?\) label=(\S+) .*?remote_log=~/(\S+)', out or '')
    return (m.group(1), m.group(2), m.group(3)) if m else None


def action(state, last_line, now):
    """PURE. One started run -> 'done' (with rc) | 'wait' | 'giveup'. state['started'] is an ISO time."""
    m = re.match(r'^DONE rc=(\d+)$', (last_line or '').strip())
    if m:
        return 'done', int(m.group(1))
    t = dt.datetime.fromisoformat(str(state.get('started')).replace('Z', '+00:00'))
    if now - t > dt.timedelta(minutes=GIVEUP_MIN):
        return 'giveup', None
    return 'wait', None


# ------------------------------------------------------------------------------------------------ impure
def ssh(host, cmd, timeout=120, **kw):
    try:
        return subprocess.run(SSH + [host, cmd], capture_output=True, text=True, timeout=timeout, **kw)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 255, '', 'timeout')


def requests():
    r = ssh(HOST, f'cd {HDIR} 2>/dev/null && for f in *.req; do [ -e "$f" ] && printf "%s\\t%s\\n" "${{f%.req}}" "$(cat "$f")"; done; '
                  f'for f in *.expired; do [ -e "$f" ] && printf "%s\\tEXPIRED\\n" "${{f%.expired}}"; done; true')
    out, gone = {}, set()
    for line in (r.stdout or '').splitlines():
        key, _, body = line.partition('\t')
        if body == 'EXPIRED':
            gone.add(key)
            continue
        try:
            out[key] = json.loads(body)
        except ValueError:
            out[key] = None
    return out, gone, r.returncode == 0


def put_state(key, d):
    os.makedirs(STATE, exist_ok=True)
    with open(os.path.join(STATE, key + '.json.tmp'), 'w') as f:
        json.dump(d, f)
    os.replace(os.path.join(STATE, key + '.json.tmp'), os.path.join(STATE, key + '.json'))


def start(key, req):
    if not os.path.isdir(R):
        subprocess.run(['git', 'init', '-q', '--bare', R], check=False)
    env = dict(os.environ, GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=10')
    f = subprocess.run(['git', '-C', R, 'fetch', '-q', f'ssh://{HOST}{HREPO}', f'+{req["ref"]}:{req["ref"]}'],
                       capture_output=True, text=True, env=env, timeout=1800)
    got = subprocess.run(['git', '-C', R, 'rev-parse', req['ref']], capture_output=True, text=True).stdout.strip()
    if f.returncode != 0 or got != req['sha']:
        log(f'REFUSED {key}: fetched {req["ref"]} = {got or "nothing"} ({(f.stderr or "").strip()[:120]}), request says {req["sha"]}')
        return
    s = subprocess.run(['python3', SUITE_RUN, R, '--ref', req['sha'], '--label', 'ar-' + key, '--detach'],
                       capture_output=True, text=True, timeout=3600)
    p = parse_detach(s.stdout)
    if s.returncode != 0 or not p:
        log(f'suite-run did not start for {key}: rc {s.returncode} {(s.stdout + s.stderr).strip()[-200:]}')
        return
    put_state(key, {'host': p[0], 'label': p[1], 'rlog': p[2], 'sha': req['sha'],
                    'started': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
    log(f'started {key} on {p[0]} ({p[1]})')


def finish(key, st, rc):
    with tempfile.TemporaryDirectory() as d:
        lp = os.path.join(d, 'out')
        if rc is not None:
            subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', f'{TEST_HOSTS[st["host"]]}:{st["rlog"]}', lp], timeout=600)
            up = subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', lp, f'{HOST}:{HDIR}/{key}.out'], timeout=600)
            if up.returncode != 0:
                log(f'copy of {key}.out to the canary host failed; retry next pass')
                return False
        done = json.dumps({'rc': rc if rc is not None else 'timeout', 'host': st['host'], 'label': st['label']})
        r = ssh(HOST, f"printf %s {shlex.quote(done)} > {HDIR}/{key}.done.tmp && mv -f {HDIR}/{key}.done.tmp {HDIR}/{key}.done "
                      f"&& mv -f {HDIR}/{key}.req {HDIR}/{key}.req-done 2>/dev/null; true")
        if r.returncode != 0:
            log(f'writing {key}.done failed; retry next pass')
            return False
    os.replace(os.path.join(STATE, key + '.json'), os.path.join(STATE, key + '.json.finished'))
    log(f'finished {key}: rc {rc if rc is not None else "timeout"}')
    return True


def main(argv):
    if argv[:1] == ['--install-launchd']:
        pl = os.path.expanduser(f'~/Library/LaunchAgents/{LABEL}.plist')
        me = os.path.expanduser('~/bin/autorebase-suite-relay.py')
        open(pl, 'w').write(f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>{me}</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>{os.path.expanduser('~/Library/Logs/autorebase-suite-relay.log')}</string>
  <key>StandardErrorPath</key><string>{os.path.expanduser('~/Library/Logs/autorebase-suite-relay.log')}</string>
</dict></plist>
''')
        subprocess.run(['launchctl', 'unload', pl], capture_output=True)
        subprocess.run(['launchctl', 'load', pl], check=False)
        log(f'loaded {pl}')
        return 0
    reqs, gone, ok = requests()
    if not ok:
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    started = {f[:-5] for f in os.listdir(STATE) if f.endswith('.json')} if os.path.isdir(STATE) else set()
    for key in sorted(gone & started):
        os.replace(os.path.join(STATE, key + '.json'), os.path.join(STATE, key + '.json.expired'))
        log(f'dropped {key}: the canary host gave up on it')
    for key, req in sorted(reqs.items()):
        if key in started:
            continue
        bad = valid_request(key, req)
        if bad:
            log(f'REFUSED malformed request {key}: {bad}')
            continue
        start(key, req)
    for key in sorted(started - gone):
        st = json.load(open(os.path.join(STATE, key + '.json')))
        r = ssh(TEST_HOSTS[st['host']], f'tail -n 1 ~/{st["rlog"]}', timeout=60)
        what, rc = action(st, r.stdout if r.returncode == 0 else '', now)
        if what == 'done':
            finish(key, st, rc)
        elif what == 'giveup':
            finish(key, st, None)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
