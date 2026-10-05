#!/usr/bin/env python3
"""B1-physical: the sandbox's own trap fixtures, with a candidate model as the bot's brain (mini orchestrates).

    python3 cl_fixture.py --arm gemma4-26b --model gemma4:26b --think false --fixtures synthetic-entombed,synthetic-island \
        [--minutes 10] [--repeats 1] [--server sandbox4]

For each fixture x repeat: the existing loader (sandbox/sandbox-scenario.py, on the worlds host) rebuilds the trap
cell for cell, places the bot and gives it the recorded inventory, then watches it; the bot runs on the bots host
(run-bot-cl.sh, the Studio as its brain) with HOME at the fixture origin. Verdict = the loader's own
{escaped, seconds, final}. Positive control: the same fixtures' earlier results in sandbox/results.jsonl (scripted
or 7B), and the 7B arm here. Appends to results/fixtures.jsonl.
"""
import argparse, json, os, shlex, subprocess, sys, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import cl_run as C  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--arm', required=True); ap.add_argument('--model', required=True)
    ap.add_argument('--think', default='none'); ap.add_argument('--fixtures', required=True)
    ap.add_argument('--minutes', type=float, default=10); ap.add_argument('--repeats', type=int, default=1)
    ap.add_argument('--server', default='sandbox4', choices=sorted(C.PORTS)); ap.add_argument('--timeout-ms', type=int, default=45000)
    ap.add_argument('--endpoint', default='http://ai.ticrcorp.com:11434')
    a = ap.parse_args()
    subprocess.run(['scp', '-q', os.path.join(ROOT, 'sandbox', 'sandbox-scenario.py'), C.WORLDS_HOST + ':/tmp/mbench-sandbox-scenario.py'], check=True)
    subprocess.run(['scp', '-q', os.path.join(HERE, 'run-bot-cl.sh'), C.BOTS_HOST + ':mbench-cl/run-bot-cl.sh'], check=True)
    out = os.path.join(HERE, 'results', 'fixtures.jsonl'); os.makedirs(os.path.dirname(out), exist_ok=True)
    for fx in a.fixtures.split(','):
        path = os.path.join(ROOT, 'sandbox', 'fixtures', fx + '.json')
        f = json.load(open(path))
        ox, oy, oz = [int(float(v)) for v in f['origin']]
        subprocess.run(['scp', '-q', path, C.WORLDS_HOST + ':/tmp/mbench-fx-%s.json' % fx], check=True)
        for rep in range(a.repeats):
            run_id = 'fx-%s-%s-%s-r%d' % (a.arm, fx, datetime.now(timezone.utc).strftime('%m%dT%H%M'), rep)
            ns = argparse.Namespace(**vars(a)); ns.bots = 1
            name, e = C.env_for(ns, run_id, 0)
            e.update(HOME_X=str(ox), HOME_Y=str(oy), HOME_Z=str(oz), BOARD_X=str(ox), BOARD_Y=str(oy), BOARD_Z=str(oz),
                     EXP_ARM='fixture-' + a.arm)
            body = '\n'.join('%s=%s' % (k, shlex.quote(v) if not v.startswith('$HOME') else '"%s"' % v) for k, v in e.items())
            C.sh(C.BOTS_HOST, 'mkdir -p ~/mbench-cl/runs/%s' % run_id)
            loader = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', C.WORLDS_HOST,
                                       'python3 /tmp/mbench-sandbox-scenario.py /tmp/mbench-fx-%s.json --bot %s --server %s --minutes %s --verify'
                                       % (fx, name, a.server, a.minutes)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True)
            time.sleep(8)
            envf = '~/mbench-cl/runs/%s/%s.env' % (run_id, name)
            C.sh(C.BOTS_HOST, 'cat > %s <<"ENVEOF"\n%s\nENVEOF\nsetsid nohup ~/mbench-cl/run-bot-cl.sh %s > ~/mbench-cl/runs/%s/%s.out 2>&1 < /dev/null & echo $! > ~/mbench-cl/runs/%s/%s.pid'
                 % (envf, body, envf, run_id, name, run_id, name))
            try:
                stdout, _ = loader.communicate(timeout=a.minutes * 60 + 400)
            except subprocess.TimeoutExpired:
                loader.kill(); stdout = ''
            C.sh(C.BOTS_HOST, 'for p in ~/mbench-cl/runs/%s/*.pid; do kill -- -$(cat $p) 2>/dev/null || kill $(cat $p) 2>/dev/null; done; true' % run_id, check=False)
            verdict = None
            for line in stdout.splitlines():
                if line.startswith('{"fixture"'):
                    verdict = json.loads(line)
            rec = {'ts': C.now(), 'run_id': run_id, 'arm': a.arm, 'model': a.model, 'think': a.think, 'fixture': fx,
                   'repeat': rep, 'minutes': a.minutes, 'verdict': verdict}
            open(out, 'a').write(json.dumps(rec) + '\n')
            print(json.dumps(rec), flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
