#!/usr/bin/env python3
"""ministral eval 11-02 (owner "sure"): the round-3 replay + the 3090 ladder for extra models, through the loop's own
door (llgpu.sh via the restricted key), its own client (batchload.mjs) and its own scorers (eval_offline, weekly.py).
Evaluation only: never touches the registry, the round dir, the queue or any bot.

  mineval.py replay <alias> <model_key>      600 items, closed conc 2, T=0, api oai (exactly ph_replay)
  mineval.py ladder <alias> <model_key>      ladder rungs until the first failure (exactly ph_latency_ladder)
  mineval.py score <alias>...                scores + significance vs the 4B and qwen2.5
"""
import json, os, subprocess, sys, time
APP = os.path.expanduser('~/learnloop/r3/app/scripts/learnloop/weekly')
sys.path.insert(0, APP)
import weekly as W  # noqa: E402

HOLDER = 'ministral-eval'
OUT = os.path.expanduser('~/learnloop/evals/ministral-1102')
CFG = json.load(open(os.path.expanduser('~/learnloop/rounds/20261101/config.json')))
R3 = os.path.expanduser('~/learnloop/rounds/20261101/replay')
os.makedirs(OUT + '/replay', exist_ok=True); os.makedirs(OUT + '/latency', exist_ok=True)


def log(m):
    line = '%s %s' % (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), m)
    print(line, flush=True); open(OUT + '/eval.log', 'a').write(line + '\n')


def gpu(*a, check=True, timeout=900):
    r = subprocess.run(['ssh', '-i', W.GPU_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', W.GPU_HOST] + list(a),
                       capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise SystemExit('llgpu %s failed %d: %s %s' % (a, r.returncode, r.stdout[-600:], r.stderr[-300:]))
    return r.stdout.strip()


def bl(alias, items, out, mode, param, n, temp, api, bots, off=0):
    env = dict(os.environ, LLM_TEMPERATURE=str(temp))
    cmd = ['nice', '-n', '10', 'node', os.path.join(W.scripts_root(), 'host', 'batchload.mjs'), W.ex(bots), items, out,
           W.GPU_URL, alias, mode, str(param), str(n), str(off), api]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=7200)
    open(out + '.log', 'w').write(r.stdout + r.stderr)
    if r.returncode != 0:
        raise SystemExit('batchload %s: %s' % (alias, r.stderr[-600:]))


def claim():
    log('claim: ' + gpu('claim', HOLDER, 'eval'))


def release():
    log('release: ' + gpu('release', HOLDER, check=False))


def replay(alias, key):
    items = W.ex(CFG['eval_items']); out = '%s/replay/%s.jsonl' % (OUT, alias)
    claim()
    try:
        log('serve: ' + gpu('serve', HOLDER, key, alias))
        bl(alias, items, out, 'closed', CFG['replay']['conc'], 600, 0, 'oai', CFG['bots_dir'])
        log('replay %s done: %s' % (alias, open(out + '.log').read().strip().splitlines()[-1]))
    finally:
        gpu('unserve', HOLDER, check=False); release()


def ladder(alias, key):
    lc = CFG['latency']; L = lc['ladder']; res = {}
    p = '%s/latency/%s.ladder.json' % (OUT, alias)
    claim(); off = 0
    try:
        for r in sorted(L):
            out = '%s/latency/%s-L%d.jsonl' % (OUT, alias, r)
            log('serve: ' + gpu('serve', HOLDER, key, alias))           # cold cache before every rung
            n = r * lc['minutes']
            bl(alias, W.ex(lc['ladder_items']), out, 'open', r, n, 0.7, 'native', lc['ladder_bots_dir'], off)
            off = (off + n) % 800
            sm = W.latency_summary(W.lines(out), lc['minutes'], r); res[str(r)] = sm
            json.dump(res, open(p, 'w'), indent=1)
            log('ladder %s @%d/min: p50 %s p95 %s valid %d/%d done/min %s -> %s' % (alias, r, sm['p50_ms'], sm['p95_ms'], sm['valid'], sm['n'],
                sm['done_per_min'], 'pass' if sm['gates_p50_2500_p95_5000'] else 'FAIL'))
            if not sm['gates_p50_2500_p95_5000']:
                break
    finally:
        gpu('unserve', HOLDER, check=False); release()
    log('ladder %s within-gate %s/min' % (alias, W.within_gate_rate({int(k): v for k, v in res.items()}, L)))


def path(alias):
    p = '%s/replay/%s.jsonl' % (OUT, alias)
    return p if os.path.exists(p) else '%s/%s.jsonl' % (R3, alias)


def score(aliases):
    import eval_offline as E, bar_c2 as B
    items = E.load(W.ex(CFG['eval_items']))
    sc, recs = {}, {}
    for a in aliases:
        sc[a] = E.table(E.score_one(items, E.load(path(a)))); recs[a] = B.last_by_id(path(a))
    out = {'scores': sc, 'files': {a: path(a) for a in aliases}, 'vs': {}}
    for a in aliases:
        for ref in ('20261101-qwen35-4b', 'qwen2.5-7b-instruct'):
            if a != ref and ref in recs:
                out['vs']['%s|%s' % (a, ref)] = W.significantly_worse(W.disc_counts(items, recs[a], recs[ref], E.S), 0.05)
    json.dump(out, open(OUT + '/scores.json', 'w'), indent=1)
    print(json.dumps(out, indent=1))


def fixed(alias, key, rates):
    """Same method as a ladder rung, at fixed rates for every model (no stop on failure): the curve past the gate."""
    lc = CFG['latency']; res = {}
    p = '%s/latency/%s.fixed.json' % (OUT, alias)
    claim()
    try:
        for r in rates:
            out = '%s/latency/%s-F%d.jsonl' % (OUT, alias, r)
            log('serve: ' + gpu('serve', HOLDER, key, alias))
            bl(alias, W.ex(lc['ladder_items']), out, 'open', r, r * lc['minutes'], 0.7, 'native', lc['ladder_bots_dir'], 0)
            sm = W.latency_summary(W.lines(out), lc['minutes'], r); res[str(r)] = sm
            json.dump(res, open(p, 'w'), indent=1)
            log('fixed %s @%d/min: p50 %s p95 %s valid %d/%d done/min %s -> %s' % (alias, r, sm['p50_ms'], sm['p95_ms'], sm['valid'], sm['n'],
                sm['done_per_min'], 'pass' if sm['gates_p50_2500_p95_5000'] else 'FAIL'))
    finally:
        gpu('unserve', HOLDER, check=False); release()


if __name__ == '__main__':
    v = sys.argv[1]
    if v == 'fixed':
        fixed(sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4].split(',')])
    if v == 'replay':
        replay(sys.argv[2], sys.argv[3])
    elif v == 'ladder':
        ladder(sys.argv[2], sys.argv[3])
    elif v == 'score':
        score(sys.argv[2:])
