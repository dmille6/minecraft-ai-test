#!/usr/bin/env python3
"""Concurrency sweep on real brain prompts: how long does ONE bot wait for a decision when 1, 4 or 8
bots ask at the same moment, and how many decisions per minute can the box serve? Runs ON the Studio.

    python3 throughput.py --engine ollama --model qwen3.6:35b-a3b --label q36-35b --think false

A warm-up request first (load time excluded). Each level fires `n` requests in waves of exactly
`c` simultaneous requests (a wave starts when the previous one has fully finished), so `c` is the
number of bots asking at once. Items are distinct prompts (no response caching); the system prompt is
shared, as in the fleet. Output: out/tput-<label>.json.
"""
import argparse, concurrent.futures as cf, json, os, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_bench as R  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', choices=('ollama', 'openai'), default='ollama')
    ap.add_argument('--url', default=None)
    ap.add_argument('--model', required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--think', default='none')
    ap.add_argument('--levels', default='1,4,8')
    ap.add_argument('--per-level', type=int, default=32)
    ap.add_argument('--temperature', type=float, default=0.7)
    ap.add_argument('--timeout', type=float, default=900)
    a = ap.parse_args()
    a.url = a.url or ('http://127.0.0.1:11434' if a.engine == 'ollama' else 'http://127.0.0.1:1234')
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))
    items = [i for i in R.load_jsonl(os.path.join(HERE, 'data', 'mbench-sample.jsonl')) if i['set'] == 'brain']
    items.sort(key=lambda i: i['id'])
    pool = items[::max(1, len(items) // 90)][:90]          # a fixed spread of distinct prompts
    fn = R.call_ollama if a.engine == 'ollama' else R.call_openai
    think = R.think_value(a.think)
    npred = 512 if think in (None, False) else 4096

    def one(it):
        msgs, schema = R.brain_messages(it, sysp)
        t0 = time.time()
        try:
            r = fn(a, msgs, schema, 8192, npred, think)
            r['error'] = None
        except Exception as e:
            r = {'error': str(e)[:200]}
        r['wall_s'] = time.time() - t0
        return r

    one(items[-1])                                          # warm-up / load
    res = {'label': a.label, 'model': a.model, 'engine': a.engine, 'think': a.think, 'levels': {}}
    k = 0
    for c in [int(x) for x in a.levels.split(',')]:
        n = a.per_level if c > 1 else max(4, a.per_level // 2)
        n = (n // c) * c or c
        walls, gen, ptok, errs = [], [], [], 0
        t0 = time.time()
        busy = 0.0
        for w in range(n // c):
            wave = [pool[(k + j) % len(pool)] for j in range(c)]
            k += c
            tw = time.time()
            with cf.ThreadPoolExecutor(max_workers=c) as ex:
                out = list(ex.map(one, wave))
            busy += time.time() - tw
            for r in out:
                if r.get('error'):
                    errs += 1
                    continue
                walls.append(r['wall_s']); gen.append(r.get('gen_tokens') or 0); ptok.append(r.get('prompt_tokens') or 0)
        walls.sort()
        res['levels'][c] = {'n': len(walls), 'errors': errs,
                            'p50_s': round(statistics.median(walls), 2) if walls else None,
                            'p90_s': round(walls[min(len(walls) - 1, int(0.9 * len(walls)))], 2) if walls else None,
                            'max_s': round(walls[-1], 2) if walls else None,
                            'decisions_per_min': round(60.0 * len(walls) / busy, 1) if busy else None,
                            'gen_tokens_med': statistics.median(gen) if gen else None,
                            'prompt_tokens_med': statistics.median(ptok) if ptok else None}
        print(a.label, 'c=%d' % c, res['levels'][c], flush=True)
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    json.dump(res, open(os.path.join(HERE, 'out', 'tput-%s.json' % a.label), 'w'), indent=1)


if __name__ == '__main__':
    main()
