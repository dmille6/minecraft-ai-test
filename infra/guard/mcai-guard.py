#!/usr/bin/env python3
"""mcai experiment guard -- runs ON the ELK host, queries Elasticsearch locally.

Read-only. Restarts nothing, so it cannot perturb an experiment in flight.
Alerts go to stderr and the journal, which ships back into Elasticsearch, so an
alert is queryable rather than stranded on a host.

Every check below is a condition that WAS TRUE during a real failure on
2026-08-06, each of which was found only because a human asked a question. The
veto threshold is 45 because replaying this check against the actual freeze
showed a four-hour average of 58% -- a 60% threshold would have stayed silent
through the exact failure it exists to catch.

No SSH: "how many models should be answering" is derived from what has been seen
over a longer window, rather than read from another host we may not be able to
reach.
"""
import json, os, re, subprocess, sys, urllib.request, base64

def es(path, body):
    env = open('/opt/docker-elk/.env').read()
    pw = re.search(r'^ELASTIC_PASSWORD=(.*)$', env, re.M).group(1).strip()
    req = urllib.request.Request(
        f'http://localhost:9200{path}', json.dumps(body).encode(),
        {'Content-Type': 'application/json',
         'Authorization': 'Basic ' + base64.b64encode(f'elastic:{pw}'.encode()).decode()})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

OLLAMA = os.environ.get('OLLAMA', 'http://192.168.192.15:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:14b-instruct')

def main():
    alerts, oks = [], []
    W, LONG = 'now-15m', 'now-6h'

    llm = es('/mcai-llm-agents/_search', {
        "size": 0, "query": {"range": {"@timestamp": {"gte": W}}},
        "aggs": {"n": {"value_count": {"field": "llm.latency_ms"}},
                 "veto": {"filter": {"exists": {"field": "llm.error"}}},
                 "bots": {"terms": {"field": "bot.name", "size": 10}},
                 "models": {"terms": {"field": "llm.model", "size": 5}}}})['aggregations']
    seen_long = es('/mcai-llm-agents/_search', {
        "size": 0, "query": {"range": {"@timestamp": {"gte": LONG}}},
        "aggs": {"models": {"terms": {"field": "llm.model", "size": 5}}}})['aggregations']

    skills = es('/mcai-skill-agents/_count', {"query": {"range": {"@timestamp": {"gte": W}}}})['count']
    decisions = int(llm['n']['value'] or 0)
    vetoes = llm['veto']['doc_count']
    bots = {b['key'] for b in llm['bots']['buckets']}
    models_now = {b['key'] for b in llm['models']['buckets']}
    models_recent = {b['key'] for b in seen_long['models']['buckets']}

    (oks if skills else alerts).append(
        f'telemetry {skills} skill docs/15m' if skills
        else 'NO skill telemetry in 15m -- shipping or Elasticsearch is down')

    (oks if decisions else alerts).append(
        f'{decisions} decisions/15m' if decisions
        else 'NO LLM decisions in 15m -- the cognitive loop is not running')

    if decisions > 20:
        pct = round(100 * vetoes / decisions)
        (alerts if pct >= 45 else oks).append(
            f'admission gate vetoing {pct}% of proposals -- the fleet is freezing shut'
            if pct >= 45 else f'veto rate {pct}%')

    expected_bots = {'Scout01', 'Scout02', 'Miner01', 'Gather01', 'Gather02'}
    silent = sorted(expected_bots - bots)
    (alerts if silent else oks).append(
        f'no decisions from: {", ".join(silent)}' if silent else 'all five bots deciding')

    # A model that answered in the last 6h but not the last 15m is a dead arm.
    dropped = sorted(models_recent - models_now)
    (alerts if dropped else oks).append(
        f'model(s) stopped answering: {", ".join(dropped)}' if dropped
        else f'{len(models_now)} model(s) answering')

    try:
        g = es('/mcai-gpu-metrics/_search', {
            "size": 1, "sort": [{"@timestamp": "desc"}], "_source": ["ollama"]})['hits']['hits']
        resident = (g[0]['_source'].get('ollama') or {}).get('models', []) if g else []
        if resident and 'qwen2.5-coder:7b' not in resident:
            alerts.append(f'honeypot model NOT resident on the GPU host (has: {resident})')
        elif resident:
            oks.append('honeypot model resident')
    except Exception:
        pass

    # INFERENCE WEDGE. The scheduler in front of the model backends can lose
    # track of its own queue state and reject everything with "maximum pending
    # requests exceeded" while every backend sits idle with free slots, the host
    # at 5% load and 56% memory free. Observed: 0/6 requests succeeded over a
    # minute; the only model that answered was one already scheduled, needing no
    # decision from the broken scheduler. A plain uptime or /api/tags check says
    # healthy throughout -- tags answered 200 the whole time.
    #
    # So probe the thing that actually matters: can it GENERATE.
    try:
        import urllib.request
        req = urllib.request.Request(
            f'{OLLAMA}/api/generate',
            data=json.dumps({'model': OLLAMA_MODEL, 'prompt': 'ok',
                             'stream': False, 'options': {'num_predict': 1}}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=45) as r:
            body = json.loads(r.read())
        if 'response' in body:
            oks.append('inference responding')
        else:
            alerts.append(f'inference returned no completion: {str(body)[:90]}')
    except Exception as e:
        alerts.append(f'INFERENCE UNAVAILABLE ({str(e)[:80]}) -- the fleet cannot think')

    for m in oks:     print(f'  ok    {m}')
    for m in alerts:  print(f'  ALERT {m}', file=sys.stderr)
    if alerts:
        subprocess.run(['logger', '-t', 'mcai-guard', '-p', 'user.err',
                        'experiment-guard: ' + ' | '.join(alerts)], check=False)
        return 1
    print('  all clear')
    return 0

if __name__ == '__main__':
    sys.exit(main())
