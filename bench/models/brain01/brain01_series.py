#!/usr/bin/env python3
"""brain-01 step 3: closed loop on sandbox4 with TODAY's fleet code + the brain-01 change (~/brain01/tree on the bots
host), 8 bots, two arms per block in a shuffled order:
  local   the Studio Ollama's qwen2.5:7b-instruct only (the fleet's model), via the mini's sandbox tunnel   -- control
  gemma4  gemma4 through the fleet host's own tunnel (127.0.0.1:11611 -> brainproxy, 15 s), then that same qwen
LM Studio + brainproxy stay loaded in BOTH arms (the keeper holds them); the GPU reservation `brain01-drills` is held
throughout. Readout: brain01_loop_read.py.

THE GEMMA-SHARE FLOOR (10-12: another session's `lms unload --all; lms server stop` left both gemma blocks 100% local,
and nothing noticed). A gemma block STARTS only when the proxy says the model is loaded. Every 5 min the last 10 min
of the block's decision rows are read: a gemma block whose gemma4 share falls below FLOOR (with >= 10 model
decisions), or a local block with ANY gemma4 decision, is ABORTED -- cl_run terminated, its bots stopped (by pid AND
cwd), its row flagged INVALID in runs.jsonl -- and the series stops.
    nohup python3 brain01_series.py --blocks 3 --minutes 90 > series.log 2>&1 &
"""
import argparse, json, os, random, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); CL = os.path.join(HERE, '..', 'closedloop', 'cl_run.py')
RUNS = os.path.join(HERE, '..', 'closedloop', 'results', 'runs.jsonl')
BOTS = 'mike@10.0.0.31'
QWEN = 'http://10.0.0.70:11502|qwen2.5:7b-instruct'
GEMMA = 'http://127.0.0.1:11611|gemma4:26b|gemma4|15000'
ARMS = {'local': QWEN, 'gemma4': GEMMA + ',' + QWEN}
FLOOR = 0.90
SHARE = r'''
import sys, json, glob, datetime as dt
cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=int(sys.argv[2]) if len(sys.argv) > 2 else 10)).strftime('%Y-%m-%dT%H:%M:%S')
n = g = 0
for f in glob.glob(sys.argv[1] + '/*/llm-*.jsonl'):
    for l in open(f):
        d = json.loads(l)
        if d['@timestamp'] < cut or (d['llm'].get('latency_ms') or 0) <= 0: continue
        n += 1; g += d['llm'].get('brain') == 'gemma4'
print(json.dumps({'n': n, 'g': g}))
'''


def ssh(c, timeout=120):
    try:
        return subprocess.run(['ssh', '-o', 'BatchMode=yes', BOTS, c], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout).stdout
    except subprocess.TimeoutExpired:
        return ''


def healthy():
    return '"ok": true' in ssh('curl -s -m 8 http://127.0.0.1:11611/healthz')


def latest_run(arm, b):
    return ssh('ls -td ~/mbench-cl/runs/cl-brain01-%s-sandbox4-*-b%d 2>/dev/null | head -1' % (arm, b)).strip() or None


def share(rundir, minutes=10):
    try:
        return json.loads(ssh('python3 ~/brain01/gemmashare.py %s %d' % (rundir, minutes)) or '{}')
    except ValueError:
        return {}


def install_share():
    p = subprocess.run(['ssh', '-o', 'BatchMode=yes', BOTS, 'cat > ~/brain01/gemmashare.py'], input=SHARE, text=True, capture_output=True)
    assert p.returncode == 0, 'could not install the share probe: %s' % p.stderr


def stop_bots(rundir):
    ssh('for p in %s/*.pid; do pid=$(cat $p); [ "$(readlink /proc/$pid/cwd)" = "$HOME/brain01/tree/bots" ] && kill $pid; done' % rundir)


def flag(run_id, why):
    rows = [json.loads(l) for l in open(RUNS) if l.strip()]
    hit = False
    for r in rows:
        if r['run_id'] == run_id:
            r['flag'] = 'INVALID: ' + why; hit = True
    if not hit:
        rows.append({'run_id': run_id, 'arm': 'brain01-aborted', 'flag': 'INVALID: ' + why})
    open(RUNS, 'w').write(''.join(json.dumps(r) + '\n' for r in rows))


def violates(arm, c):
    n, g = c.get('n', 0), c.get('g', 0)
    if n < 10:
        return None
    if arm == 'gemma4' and g / n < FLOOR:
        return 'gemma4 block: gemma4 %d of %d model decisions in the last 10 min (floor %.2f)' % (g, n, FLOOR)
    if arm == 'local' and g > 0:
        return 'local block: %d gemma4 decisions in the last 10 min (must be 0)' % g
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blocks', type=int, default=3); ap.add_argument('--minutes', type=float, default=90)
    ap.add_argument('--bots', type=int, default=8); ap.add_argument('--seed', type=int, default=1013); ap.add_argument('--block-offset', type=int, default=10)
    ap.add_argument('--order', default='', help='resume: explicit "block:arm,..." (e.g. after a pause), overrides the seeded order')
    a = ap.parse_args()
    install_share()
    rng = random.Random(a.seed)
    order = []
    for b in range(a.blocks):
        arms = list(ARMS); rng.shuffle(arms); order += [(a.block_offset + b, x) for x in arms]
    if a.order:
        order = [(int(x.split(':')[0]), x.split(':')[1]) for x in a.order.split(',')]
        assert all(arm in ARMS for _, arm in order), order
    print('ORDER', order, flush=True)
    for b, arm in order:
        if arm == 'gemma4':
            for _ in range(20):
                if healthy():
                    break
                print('gemma4 block b%d waiting: the brain proxy is not healthy' % b, flush=True); time.sleep(60)
            else:
                print('ABORT SERIES: the brain proxy never became healthy', flush=True); break
        # think: 'false' for the gemma4 arm (llm.mjs sends it to the LABELLED endpoint only); 'none' for the local arm,
        # whose lone unlabelled qwen endpoint would otherwise get think and answer "does not support thinking".
        proc = subprocess.Popen([sys.executable, CL, '--arm', 'brain01-' + arm, '--model', 'qwen2.5:7b-instruct',
                                 '--think', 'false' if arm == 'gemma4' else 'none', '--server', 'sandbox4', '--bots', str(a.bots),
                                 '--minutes', str(a.minutes), '--endpoint', 'http://10.0.0.70:11502', '--pool', ARMS[arm],
                                 '--bot-tree', 'brain01', '--keep-reservation', '--res-token', 'brain01-drills', '--tag', 'b%d' % b])
        aborted = None
        t_end = time.time() + 240
        while proc.poll() is None and time.time() < t_end:
            time.sleep(10)                 # bots start 12 s apart; the first decisions need a few minutes
        while proc.poll() is None:
            rd = latest_run(arm, b)
            why = violates(arm, share(rd)) if rd else None
            if why:
                aborted = why
                print('ABORT', os.path.basename(rd), why, flush=True)
                proc.terminate(); stop_bots(rd); flag(os.path.basename(rd), why)
                break
            for _ in range(30):
                if proc.poll() is not None:
                    break
                time.sleep(10)
        proc.wait()
        if aborted:
            print('ABORT SERIES after', aborted, flush=True); break
    subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.30', 'bash /tmp/mbench-cl_world.sh sandbox4 restore'], stdin=subprocess.DEVNULL, check=False)
    print('SERIES DONE', flush=True)


if __name__ == '__main__':
    main()
