#!/usr/bin/env python3
"""Stage C1 series: arms x matched starts in a randomized (blocked) order, one run at a time, GPU held throughout.

    nohup python3 cl_series.py --arms arms.json --starts 3 --bots 8 --minutes 90 > results/series.log 2>&1 &

arms.json: [{"arm": "q25-7b", "model": "qwen2.5:7b-instruct", "think": "none"},
            {"arm": "gemma4-mlx8", "model": "gemma4:26b", "think": "false", "lms_key": "gemma-4-26b-a4b-it@8bit"}, ...]
An arm with "lms_key" runs through LM Studio: the Studio's LM Studio server loads the key (--parallel = bots), the
translating proxy (ollama2openai.py) runs on the Studio, and an ssh tunnel on this Mac mini exposes it to the bots
host at 10.0.0.70:11501. Each block = every arm once, order shuffled per block (seeded). The GPU reservation is
kept between runs and released at the end; LM Studio and the proxy are torn down after each LM Studio run.
"""
import argparse, json, os, random, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIO = 'mike@ai.ticrcorp.com'


def ssh(cmd, check=False):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', STUDIO, cmd], stdin=subprocess.DEVNULL, capture_output=True, text=True, check=check).stdout


def lms_up(key, bots):
    ssh('echo cl-series > ~/mbench/out/GPU_RESERVED')
    while ssh("pgrep -f '[r]un_bench.py|[t]hroughput.py|[s]erving.py|[l]ms_factor.sh' || true").strip():
        time.sleep(60)          # the Stage A queue finishes its current model first
    ssh('for m in $(cat ~/mbench/out/.loaded 2>/dev/null); do '
        '/Applications/Ollama.app/Contents/Resources/ollama stop "$m"; done; L=~/.lmstudio/bin/lms; $L server start --port 1234; '
        '$L unload --all; $L load "%s" -y --context-length 16384 --parallel %d --identifier bench; '
        'cd ~/mbench && (nohup python3 ollama2openai.py --listen 127.0.0.1:11501 > out/proxy.log 2>&1 &)' % (key, bots))
    subprocess.run(['scp', '-q', os.path.join(HERE, 'ollama2openai.py'), STUDIO + ':mbench/'], check=False)
    time.sleep(5)       # 10.0.0.70:11501 is carried by the supervised launchd tunnel (com.mbench.tunnel)
    return None


def lms_down(tun):
    if tun:
        tun.terminate()
    ssh('pkill -f ollama2openai.py; L=~/.lmstudio/bin/lms; $L unload --all; $L server stop')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--arms', required=True); ap.add_argument('--starts', type=int, default=3)
    ap.add_argument('--bots', type=int, default=8); ap.add_argument('--minutes', type=float, default=90)
    ap.add_argument('--server', default='sandbox4'); ap.add_argument('--seed', type=int, default=1006)
    ap.add_argument('--wait-pause', action='store_true')
    ap.add_argument('--pause-tag', default='c1', help='the queue line is "pause <tag>"')
    ap.add_argument('--block-offset', type=int, default=0, help='number blocks from here (blocks are run tags b<N>)')
    ap.add_argument('--order', default='', help='explicit arm order for ONE block, e.g. "a,b,c" (resume a broken block)')
    ap.add_argument('--block', type=int, default=0, help='block number for --order')
    ap.add_argument('--ollama-endpoint', default='http://ai.ticrcorp.com:11434',
                    help='http://10.0.0.70:11502 = the Studio Ollama via an ssh tunnel on this mini (started here)')
    a = ap.parse_args()
    arms = json.load(open(a.arms))
    if a.wait_pause:            # start only when the Stage A queue reaches its "pause" line (GPU held for us)
        while not ssh('cat ~/mbench/out/GPU_RESERVED 2>/dev/null').startswith('pause-' + a.pause_tag):
            time.sleep(120)
        print('queue paused; starting', flush=True)
    rng = random.Random(a.seed)
    order = []
    for b in range(a.starts):
        blk = list(arms); rng.shuffle(blk)
        order += [(a.block_offset + b, x) for x in blk]
    if a.order:
        byname = {x['arm']: x for x in arms}
        order = [(a.block, byname[n]) for n in a.order.split(',')]
    otun = None         # 10.0.0.70:11502 is the supervised launchd tunnel (com.mbench.tunnel); nothing to start
    print('ORDER', [(b, x['arm']) for b, x in order], flush=True)
    for i, (b, arm) in enumerate(order):
        tun = None
        endpoint = a.ollama_endpoint
        if arm.get('lms_key'):
            tun = lms_up(arm['lms_key'], a.bots)
            endpoint = 'http://10.0.0.70:11501'
        try:
            subprocess.run([sys.executable, os.path.join(HERE, 'cl_run.py'), '--arm', arm['arm'], '--model', arm['model'],
                            '--think', arm.get('think', 'none'), '--server', a.server, '--bots', str(a.bots),
                            '--minutes', str(a.minutes), '--endpoint', endpoint, '--tag', 'b%d' % b, '--keep-reservation']
                           + (['--c2-arm', arm['c2_arm'], '--ov-model', arm.get('ov_model', 'gpt-oss:120b'),
                               '--ov-think', arm.get('ov_think', 'medium'), '--esc-model', arm.get('esc_model', 'gpt-oss:120b'),
                               '--esc-think', arm.get('esc_think', 'medium')] if arm.get('c2_arm') else []),
                           check=False)
        finally:
            if tun:
                lms_down(tun)
    if otun:
        otun.terminate()
    # put the sandbox back to its own world (its owners' fixtures live there)
    subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.30', 'bash /tmp/mbench-cl_world.sh %s restore' % a.server],
                   stdin=subprocess.DEVNULL, check=False)
    ssh('rm -f ~/mbench/out/GPU_RESERVED')
    print('SERIES DONE', flush=True)


if __name__ == '__main__':
    main()
