#!/usr/bin/env python3
"""Stage C orchestrator (runs on the Mac mini: it only sleeps and issues ssh). One closed-loop RUN:

    python3 cl_run.py --arm q36-35b --model qwen3.6:35b-a3b --think false --server sandbox4 --bots 4 --minutes 120

1. Preflight: refuses if a Stage A/B benchmark is running on the Studio (arms must not share the GPU) unless
   --allow-contention; warms the model with the same think setting.
2. Resets the sandbox world to the pristine fleet-seed snapshot (cl_world.sh reset, on 10.0.0.30).
3. Starts N bots on the bots host (10.0.0.31) from the bench tree, staggered 12 s, each with its own fresh log and
   state dir under ~/mbench-cl/runs/<run_id>/, brain = the Studio's Ollama, the fleet's own LLM settings.
4. Waits, checking every 5 min that the bots are alive.
5. Stops the bots, runs cl_metrics.py over the run window, and appends the result to results/runs.jsonl.
"""
import argparse, json, os, shlex, subprocess, sys, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BOTS_HOST, WORLDS_HOST, STUDIO = 'mike@10.0.0.31', 'mike@10.0.0.30', 'mike@ai.ticrcorp.com'
PORTS = {'sandbox': 25599, 'sandbox2': 25600, 'sandbox3': 25601, 'sandbox4': 25602}
NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Fox', 'Golf', 'Hotel']   # Minecraft names <= 16 chars: 'mbench-s4-Charlie' (17) was kicked


def sh(host, cmd, check=True, timeout=600):
    r = subprocess.run(['ssh', '-o', 'BatchMode=yes', host, cmd], stdin=subprocess.DEVNULL,
                       capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise SystemExit('%s failed (%d): %s\n%s' % (host, r.returncode, cmd[:200], r.stderr[-800:]))
    return r.stdout


class sandbox_lock:
    """The agents' shared convention: mkdir /tmp/mcai-sandbox.lock + an owner file. Held only for the short
    server-state change (a world reset), never for a whole run: the bot processes run on 10.0.0.31, not the mini."""
    D = '/tmp/mcai-sandbox.lock'

    def __init__(self, who, wait_s=900):
        self.who, self.wait_s = who, wait_s

    def __enter__(self):
        t = time.time()
        while True:
            try:
                os.mkdir(self.D)
                open(os.path.join(self.D, 'owner'), 'w').write('%s since %s\n' % (self.who, now()))
                return self
            except FileExistsError:
                if time.time() - t > self.wait_s:
                    raise SystemExit('sandbox lock held for %ds by: %s' % (self.wait_s, open(os.path.join(self.D, 'owner')).read() if os.path.exists(os.path.join(self.D, 'owner')) else '?'))
                time.sleep(15)

    def __exit__(self, *e):
        try:
            os.remove(os.path.join(self.D, 'owner')); os.rmdir(self.D)
        except OSError:
            pass


def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def env_for(a, run_id, i):
    name = 'mbench-%s-%s' % (a.server.replace('sandbox', 's') or 's1', NAMES[i])
    base = '$HOME/mbench-cl/runs/%s' % run_id
    e = {
        'BOT_NAME': name, 'BOT_ROLE': 'gatherer', 'EXP_INSTANCE': 'mbench', 'EXP_BLOCK': 'mbench', 'EXP_ARM': a.arm,
        'MEMORY_SCOPE': 'isolated', 'MEMORY_POOL': 'mbench-' + run_id,
        'MINECRAFT_HOST': '10.0.0.30', 'MINECRAFT_PORT': str(PORTS[a.server]), 'MINECRAFT_VERSION': '1.21.8',
        'MINECRAFT_AUTH': 'offline', 'WORLD_BORDER_RADIUS': '1950', 'BOARD_RADIUS': '8', 'REFLEX_TICK_MS': '500',
        'SKILL_TIMEOUT_MS': '180000', 'MAX_CONSECUTIVE_FAILURES': '3', 'EAT_BELOW_FOOD': '16', 'FLEE_BELOW_HEALTH': '8',
        'STUCK_SECONDS': '35', 'LLM_ENABLED': 'true', 'OLLAMA_MODEL': a.model, 'OLLAMA_NUM_CTX': '8192',
        'LLM_TEMPERATURE': '0.7', 'LLM_TIMEOUT_MS': str(a.timeout_ms), 'LLM_DECISION_COOLDOWN_MS': '30000',
        'LLM_MAX_TOKENS': '512', 'LLM_PROMPT_TOKEN_BUDGET': '3000',
        'RECONNECT_DELAY_MS': '8000', 'RECONNECT_MAX_DELAY_MS': '120000', 'ENABLE_AGENT_CODE_EXECUTION': 'false',
        'VIEWER_ENABLED': 'false', 'VIEWER_FIRST_PERSON': 'false', 'VIEWER_PORT': '0', 'LOG_LEVEL': 'info',
        'CODE_VERSION': 'bench-closedloop', 'RUN_ID': run_id,
        'HOME_X': '355', 'HOME_Y': '73', 'HOME_Z': '147', 'BOARD_X': '358', 'BOARD_Y': '72', 'BOARD_Z': '147',
        'OLLAMA_BASE_URL': a.endpoint, 'OLLAMA_BASE_URLS': a.endpoint,
        'LOG_DIR': '%s/%s' % (base, name), 'STATE_DIR': '%s/%s-state' % (base, name),
    }
    if a.think not in ('none', ''):
        e['OLLAMA_THINK'] = a.think
    return name, e


def parse_census(text):
    """`data get entity <bot> Inventory` lines -> {bot: {item: count}} (1.21 SNBT: {count: 12, id: "minecraft:oak_log"})."""
    import re
    out = {}
    for line in text.splitlines():
        m = re.match(r'data get entity (\S+) Inventory -> (.*)', line)
        if not m:
            continue
        inv = {}
        for c, i in re.findall(r'count:\s*(\d+)[^}]*?id:\s*"minecraft:([a-z0-9_]+)"', m.group(2)):
            inv[i] = inv.get(i, 0) + int(c)
        for i, c in re.findall(r'id:\s*"minecraft:([a-z0-9_]+)"[^}]*?count:\s*(\d+)', m.group(2)):
            inv.setdefault(i, int(c))
        out[m.group(1)] = inv
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--arm', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--think', default='none')
    ap.add_argument('--server', default='sandbox4', choices=sorted(PORTS))
    ap.add_argument('--bots', type=int, default=4)
    ap.add_argument('--minutes', type=float, default=120)
    ap.add_argument('--timeout-ms', type=int, default=45000)
    ap.add_argument('--allow-contention', action='store_true')
    ap.add_argument('--keep-reservation', action='store_true', help='leave the GPU reserved for the next run (a series)')
    ap.add_argument('--tag', default='')
    ap.add_argument('--endpoint', default='http://ai.ticrcorp.com:11434',
                    help='or http://10.0.0.70:11501 = LM Studio via the translating proxy (start it first)')
    a = ap.parse_args()
    run_id = 'cl-%s-%s-%s%s' % (a.arm, a.server, datetime.now(timezone.utc).strftime('%m%dT%H%M'), ('-' + a.tag) if a.tag else '')
    log = lambda m: print('[%s] %s' % (now(), m), flush=True)
    if not a.allow_contention:
        # Reserve the GPU: the Stage A/B queue checks this marker before starting its next model; then wait
        # for the model it is running now to finish (arms must never share the GPU with a benchmark).
        sh(STUDIO, 'echo %s > ~/mbench/out/GPU_RESERVED' % run_id)
        while sh(STUDIO, "pgrep -f '[r]un_bench.py|[t]hroughput.py|[s]erving.py|[l]ms_factor.sh' || true", check=False).strip():
            log('waiting for the Studio benchmark queue to finish its current model')
            time.sleep(60)
    log('run %s: %d bots, %s (think=%s) on %s for %.0f min' % (run_id, a.bots, a.model, a.think, a.server, a.minutes))
    # ENDPOINT PREFLIGHT from the bots host: pause (never burn a run) while the model endpoint is unreachable
    waited = 0
    while True:
        ok = sh(BOTS_HOST, 'curl -s -m 8 %s/api/version >/dev/null && echo OK || echo DOWN' % a.endpoint, check=False).strip()
        if ok == 'OK':
            break
        if waited % 300 == 0:
            log('endpoint %s unreachable from the bots host; waiting (run not started)' % a.endpoint)
        time.sleep(30); waited += 30
        if waited > 4 * 3600:
            raise SystemExit('endpoint down for 4 h; giving up before starting %s' % run_id)
    warm = {'model': a.model, 'messages': [{'role': 'user', 'content': 'ok'}], 'stream': False, 'keep_alive': '30m',
            'options': {'num_ctx': 8192, 'num_predict': 4}}
    if a.think not in ('none', ''):
        warm['think'] = {'true': True, 'false': False}.get(a.think, a.think)
    if 'ticrcorp' in a.endpoint or ':11502' in a.endpoint:
        sh(STUDIO, "curl -s -m 600 localhost:11434/api/chat -d %s >/dev/null" % shlex.quote(json.dumps(warm)), check=False, timeout=700)
    subprocess.run(['scp', '-q', os.path.join(HERE, 'cl_world.sh'), WORLDS_HOST + ':/tmp/mbench-cl_world.sh'], check=True)
    with sandbox_lock('model-selection agent: %s world reset for %s' % (a.server, run_id)):
        log(sh(WORLDS_HOST, 'bash /tmp/mbench-cl_world.sh %s reset' % a.server, timeout=900).strip()[-300:])
    for f in ('run-bot-cl.sh', 'cl_metrics.py'):
        subprocess.run(['scp', '-q', os.path.join(HERE, f), BOTS_HOST + ':mbench-cl/' + f], check=True)
    sh(BOTS_HOST, 'mkdir -p ~/mbench-cl/runs/%s && chmod +x ~/mbench-cl/run-bot-cl.sh' % run_id)
    names = []
    t_start = now()
    for i in range(a.bots):
        name, e = env_for(a, run_id, i)
        names.append(name)
        body = '\n'.join('%s=%s' % (k, shlex.quote(v) if not v.startswith('$HOME') else '"%s"' % v) for k, v in e.items())
        envf = '~/mbench-cl/runs/%s/%s.env' % (run_id, name)
        sh(BOTS_HOST, 'cat > %s <<"ENVEOF"\n%s\nENVEOF\nsetsid nohup ~/mbench-cl/run-bot-cl.sh %s > ~/mbench-cl/runs/%s/%s.out 2>&1 < /dev/null & echo $! > ~/mbench-cl/runs/%s/%s.pid'
           % (envf, body, envf, run_id, name, run_id, name))
        log('started %s' % name)
        time.sleep(12)
    digest = sh(STUDIO, "/Applications/Ollama.app/Contents/Resources/ollama list | awk '$1==\"%s\"{print $2}'" % a.model, check=False).strip()
    meta = {'run_id': run_id, 'arm': a.arm, 'model': a.model, 'model_digest': digest, 'bot_code': 'bench-closedloop@8e80080',
            'think': a.think, 'server': a.server, 'bots': a.bots,
            'minutes': a.minutes, 'timeout_ms': a.timeout_ms, 'start': t_start, 'names': names}
    sh(BOTS_HOST, 'cat > ~/mbench-cl/runs/%s/meta.json <<"EOF"\n%s\nEOF' % (run_id, json.dumps(meta)))
    endpoint_down_checks = []
    end_at = time.time() + a.minutes * 60
    while time.time() < end_at:
        time.sleep(min(300, max(1, end_at - time.time())))
        alive = sh(BOTS_HOST, 'for p in ~/mbench-cl/runs/%s/*.pid; do kill -0 $(cat $p) 2>/dev/null && echo up || echo DOWN; done | sort | uniq -c' % run_id, check=False)
        log('bots: ' + ' '.join(alive.split()))
        ep = sh(BOTS_HOST, 'curl -s -m 8 %s/api/version >/dev/null && echo OK || echo DOWN' % a.endpoint, check=False).strip()
        if ep != 'OK':
            endpoint_down_checks.append(now()); log('ENDPOINT DOWN during the run (%s)' % a.endpoint)
    t_end = now()
    census = sh(WORLDS_HOST, 'bash /tmp/mbench-cl_world.sh %s census %s' % (a.server, ' '.join(names)), check=False, timeout=300)
    meta['census'] = parse_census(census)
    sh(BOTS_HOST, 'for p in ~/mbench-cl/runs/%s/*.pid; do kill -- -$(cat $p) 2>/dev/null || kill $(cat $p) 2>/dev/null; done; sleep 3; pkill -f "mbench-cl/runs/%s/" || true' % (run_id, run_id), check=False)
    log('stopped; computing metrics')
    out = sh(BOTS_HOST, 'python3 ~/mbench-cl/cl_metrics.py ~/mbench-cl/runs/%s --start %s --end %s' % (run_id, t_start, t_end), timeout=900)
    m = json.loads(out)
    # TUNNEL DROPS inside the run window (the mini's supervised tunnel log): flagged, never silently pooled
    drops = []
    tl = os.path.expanduser('~/Library/Logs/mbench-tunnel.log')
    if os.path.exists(tl):
        drops = [l.split()[0] for l in open(tl) if 'DROP' in l and t_start <= l.split()[0] <= t_end]
    meta.update(end=t_end, metrics=m, tunnel_drops=drops, endpoint_down_checks=endpoint_down_checks,
                flag=('TUNNEL/ENDPOINT INTERRUPTION' if (drops or endpoint_down_checks) else None))
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    with open(os.path.join(HERE, 'results', 'runs.jsonl'), 'a') as fh:
        fh.write(json.dumps(meta) + '\n')
    s = {k: m.get(k) for k in ('team_output_per_h', 'mean_output_per_bot_h', 'milestone_bots', 'pickless_share',
                               'stuck_min_per_bot', 'loops_per_bot_h', 'deaths', 'decisions_per_bot_h', 'latency_p50_med')}
    log('RESULT %s %s' % (run_id, json.dumps(s)))
    if not a.allow_contention and not a.keep_reservation:
        sh(STUDIO, 'rm -f ~/mbench/out/GPU_RESERVED', check=False)


if __name__ == '__main__':
    main()
