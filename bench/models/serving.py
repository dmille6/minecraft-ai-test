#!/usr/bin/env python3
"""Stage A5: sustained, MIXED serving load on the Studio, the way 4-8 bots plus an overseer would use it.

    python3 serving.py --worker qwen3.6:35b-a3b --worker-think false --bots 8 --minutes 10 \
        [--overseer gpt-oss:120b --overseer-think medium --overseer-every 300] [--escalate-every 180] --label X

Each simulated bot asks for a decision, waits for the answer, then "runs the skill" for a random 30-60 s
(the fleet's decision cooldown is 30 s) and asks again: arrivals are staggered and self-paced, as in the fleet.
Optionally an overseer request (a real shadow-mayor snapshot) every N s and a stuck-escalation request (a real
stuck episode) every M s, served by the overseer model, CO-RESIDENT with the worker model. Records per role:
p50/p95/p99 latency, deadline misses (worker > 45 s = the fleet's LLM_TIMEOUT_MS), errors, decisions/min, and
once a minute `ollama ps` (resident sizes) + vm_stat swap-outs. Output: out/serve-<label>.json.
"""
import argparse, json, os, random, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_bench as R  # noqa: E402


def pct(v, p):
    v = sorted(v)
    return round(v[min(len(v) - 1, int(p * len(v)))], 2) if v else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--worker', required=True); ap.add_argument('--worker-think', default='none')
    ap.add_argument('--overseer'); ap.add_argument('--overseer-think', default='none')
    ap.add_argument('--overseer-every', type=float, default=300); ap.add_argument('--escalate-every', type=float, default=0)
    ap.add_argument('--bots', type=int, default=8); ap.add_argument('--minutes', type=float, default=10)
    ap.add_argument('--deadline', type=float, default=45); ap.add_argument('--label', required=True)
    ap.add_argument('--url', default='http://127.0.0.1:11434'); ap.add_argument('--temperature', type=float, default=0.7)
    ap.add_argument('--timeout', type=float, default=600)
    a = ap.parse_args()
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))
    items = R.load_jsonl(os.path.join(HERE, 'data', 'mbench-sample-x.jsonl'))
    brain = [i for i in items if i['set'] == 'brain']
    base = R.load_jsonl(os.path.join(HERE, 'data', 'mbench-sample.jsonl'))
    stuck = [i for i in base if i['set'] == 'stuck']
    over = R.load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))
    rng = random.Random(9)
    rng.shuffle(brain)
    lock = threading.Lock()
    recs = []
    stop_at = time.time() + a.minutes * 60
    cursor = [0]

    class Args:  # what call_ollama reads from its first argument
        pass

    def call(model, think, msgs, schema, ctx, npred):
        aa = Args(); aa.model = model; aa.url = a.url; aa.temperature = a.temperature; aa.timeout = a.timeout
        return R.call_ollama(aa, msgs, schema, ctx, npred, R.think_value(think))

    def record(role, t0, r=None, err=None):
        with lock:
            recs.append({'role': role, 't': t0, 'wall_s': time.time() - t0, 'error': err,
                         'gen_tokens': (r or {}).get('gen_tokens'), 'thinking_chars': (r or {}).get('thinking_chars')})

    def bot(k):
        time.sleep(rng.uniform(0, 30))
        while time.time() < stop_at:
            with lock:
                it = brain[cursor[0] % len(brain)]; cursor[0] += 1
            msgs, schema = R.brain_messages(it, sysp)
            t0 = time.time()
            try:
                r = call(a.worker, a.worker_think, msgs, schema, 8192, 512 if a.worker_think in ('none', 'false') else 4096)
                record('worker', t0, r)
            except Exception as e:
                record('worker', t0, err=str(e)[:120])
            time.sleep(rng.uniform(30, 60))

    def periodic(role, every, pool, builder):
        time.sleep(rng.uniform(5, every))
        while time.time() < stop_at:
            it = rng.choice(pool)
            msgs, schema = builder(it)
            t0 = time.time()
            try:
                r = call(a.overseer, a.overseer_think, msgs, schema, 16384, 8192 if a.overseer_think not in ('none', 'false') else 1024)
                record(role, t0, r)
            except Exception as e:
                record(role, t0, err=str(e)[:120])
            time.sleep(every)

    mem = []

    def sampler():
        while time.time() < stop_at:
            ps = subprocess.run(['/Applications/Ollama.app/Contents/Resources/ollama', 'ps'], capture_output=True, text=True).stdout
            vm = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
            so = [l for l in vm.splitlines() if 'Swapouts' in l]
            mem.append({'t': time.time(), 'ps': ps.strip().splitlines()[1:], 'swapouts': so[0].split(':')[1].strip(' .') if so else None})
            time.sleep(60)

    th = [threading.Thread(target=bot, args=(k,), daemon=True) for k in range(a.bots)]
    th.append(threading.Thread(target=sampler, daemon=True))
    if a.overseer:
        th.append(threading.Thread(target=periodic, args=('overseer', a.overseer_every, over, R.overseer_messages), daemon=True))
        if a.escalate_every:
            th.append(threading.Thread(target=periodic, args=('escalation', a.escalate_every, stuck, lambda i: R.stuck_messages(i, sysp)), daemon=True))
    for t in th:
        t.start()
    while time.time() < stop_at + 5:
        time.sleep(5)
    time.sleep(min(a.timeout, 120))     # let in-flight requests finish (they are recorded when they do)
    out = {'label': a.label, 'args': vars(a), 'roles': {}, 'memory': mem}
    for role in ('worker', 'overseer', 'escalation'):
        rs = [r for r in recs if r['role'] == role]
        if not rs:
            continue
        ok = [r['wall_s'] for r in rs if not r['error']]
        out['roles'][role] = {'n': len(rs), 'errors': sum(1 for r in rs if r['error']),
                              'p50': pct(ok, .5), 'p95': pct(ok, .95), 'p99': pct(ok, .99), 'max': round(max(ok), 1) if ok else None,
                              'deadline_miss_pct': round(100.0 * sum(1 for r in rs if r['error'] or r['wall_s'] > a.deadline) / len(rs), 1) if role == 'worker' else None,
                              'per_min': round(len(rs) / a.minutes, 2)}
    json.dump(out, open(os.path.join(HERE, 'out', 'serve-%s.json' % a.label), 'w'), indent=1)
    print(json.dumps(out['roles']), 'swapouts', mem[0]['swapouts'] if mem else None, '->', mem[-1]['swapouts'] if mem else None)


if __name__ == '__main__':
    main()
