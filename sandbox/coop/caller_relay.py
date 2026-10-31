"""THE MAC-SIDE RELAY for the B5 Paper arms when the driver and bots run on the worlds host (control session 10-31: the Mac mini
is a controller only; the arms moved to 10.0.0.30). Tiny, and it is the only part that stays on the Mac, because the keys do.

    ~/learnloop/venv/bin/python sandbox/coop/caller_relay.py --servers sandbox5,sandbox6,sandbox8

Every 5 s: pull each request the driver dropped in ~/coopb5/relay/req-<id>.json on 10.0.0.30, run scripts/overseer/caller.py
on it HERE (the guard, the ledger and the keys are the Mac's), push the caller's output back as resp-<id>.json, and move the
request to done/. Every 60 s: run the sandbox lock probe (sandbox/lib/sbxlock.cjs probeCmd, the library's own) on the lock host
10.0.0.31 and copy its output to ~/coopb5/relay/lockprobe-<server>.txt, which the driver's lock check reads (the worlds host
cannot ssh to the lock host). The relay never touches a sandbox and never reads a key itself.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
WORLDS, LOCKS = 'mike@10.0.0.30', 'mike@10.0.0.31'
RDIR = 'coopb5/relay'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']


def sh(args, inp=None, timeout=120):
    return subprocess.run(args, input=inp, capture_output=True, text=True, timeout=timeout)


def probe_cmd(server):
    return sh(['node', '-e', "process.stdout.write(require('%s/sandbox/lib/sbxlock.cjs').probeCmd(%s))" % (REPO, json.dumps(server))]).stdout


def push_probes(servers, log):
    for s in servers:
        r = sh(SSH + [LOCKS, probe_cmd(s)])
        if r.returncode != 0 or len([l for l in r.stdout.split('\n') if l]) != 2:
            log('probe %s failed: %s' % (s, r.stderr.strip()[:120])); continue
        w = sh(SSH + [WORLDS, 'mkdir -p %s && cat > %s/lockprobe-%s.txt.tmp && mv %s/lockprobe-%s.txt.tmp %s/lockprobe-%s.txt' % (RDIR, RDIR, s, RDIR, s, RDIR, s)], inp=r.stdout)
        if w.returncode != 0:
            log('probe push %s failed: %s' % (s, w.stderr.strip()[:120]))


def serve_requests(py, log):
    r = sh(SSH + [WORLDS, 'ls %s/ 2>/dev/null | grep "^req-.*\\.json$" || true' % RDIR])
    for name in [n for n in r.stdout.split() if n]:
        rid = name[len('req-'):-len('.json')]
        got = sh(SSH + [WORLDS, 'cat %s/%s' % (RDIR, name)])
        try:
            req = json.loads(got.stdout)
        except Exception:
            log('unreadable request %s' % name); continue
        with tempfile.TemporaryDirectory() as td:
            snap, out = os.path.join(td, 'snap.json'), os.path.join(td, 'out.json')
            with open(snap, 'w') as f:
                json.dump(req['snapshot'], f)
            c = sh([py, os.path.join(REPO, 'scripts/overseer/caller.py'), 'call', '--model', req['model'], '--snapshot', snap, '--out', out,
                    '--purpose', 'paper', '--run', str(req.get('run')), '--wait-lock', '120'], timeout=200)
            body = open(out).read() if os.path.exists(out) else json.dumps({'reply': None, 'meta': {'outcome': 'relay_caller_exit_%s' % c.returncode}})
        p = sh(SSH + [WORLDS, 'cat > %s/resp-%s.json.tmp && mv %s/resp-%s.json.tmp %s/resp-%s.json && mkdir -p %s/done && mv %s/%s %s/done/'
                      % (RDIR, rid, RDIR, rid, RDIR, rid, RDIR, RDIR, name, RDIR)], inp=body)
        log('served %s %s exit=%s push=%s' % (rid, req['model'], c.returncode, p.returncode))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--servers', required=True)
    ap.add_argument('--py', default=sys.executable)
    a = ap.parse_args()
    servers = a.servers.split(',')
    logf = os.path.join(REPO, 'sandbox/log/arms-e2e/relay.log')
    os.makedirs(os.path.dirname(logf), exist_ok=True)
    log = lambda s: open(logf, 'a').write('%s %s\n' % (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), s))
    log('relay start servers=%s' % servers)
    last_probe = 0
    while True:
        try:
            if time.time() - last_probe >= 60:
                push_probes(servers, log); last_probe = time.time()
            serve_requests(a.py, log)
        except Exception as e:
            log('loop error %s' % e)
        time.sleep(5)


if __name__ == '__main__':
    main()
