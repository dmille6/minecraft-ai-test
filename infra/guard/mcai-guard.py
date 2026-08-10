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

# Overrides only. The DEFAULTS are derived from telemetry at run time -- see the
# inference wedge check. These were hardcoded to http://192.168.192.15:11434 and
# qwen2.5:14b-instruct, and by 2026-08-10 both were wrong: that host is the
# retired AI server, unreachable from the ELK host, and the fleet had long since
# moved to a 7b model. So the one check that asks "can the fleet think at all"
# was probing a machine the fleet does not use, with a model it does not run.
# A guard pointed at the wrong host does not fail loudly -- it fails as an alert
# that is always firing, which is the same as no alert.
OLLAMA = os.environ.get('OLLAMA')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL')

def main():
    alerts, oks = [], []
    # ROSTER is deliberately much longer than LONG. See the bot check below: a
    # 6h baseline forgets a bot that died overnight, which is the exact failure
    # this guard missed.
    W, LONG, ROSTER = 'now-15m', 'now-6h', 'now-7d'

    llm = es('/mcai-llm-agents/_search', {
        "size": 0, "query": {"range": {"@timestamp": {"gte": W}}},
        "aggs": {"n": {"value_count": {"field": "llm.latency_ms"}},
                 "veto": {"filter": {"exists": {"field": "llm.error"}}},
                 # size 10 with a ten-bot fleet sat exactly on the limit: an
                 # eleventh bot would have pushed one out of the bucket list and
                 # been reported as silent. Terms aggs truncate quietly.
                 "bots": {"terms": {"field": "bot.name", "size": 100}},
                 # Where the fleet is ACTUALLY thinking, for the wedge probe below.
                 "endpoints": {"terms": {"field": "llm.endpoint", "size": 10}},
                 "models": {"terms": {"field": "llm.model", "size": 5}}}})['aggregations']
    seen_long = es('/mcai-llm-agents/_search', {
        "size": 0, "query": {"range": {"@timestamp": {"gte": LONG}}},
        "aggs": {"models": {"terms": {"field": "llm.model", "size": 5}}}})['aggregations']

    skills = es('/mcai-skill-agents/_count', {"query": {"range": {"@timestamp": {"gte": W}}}})['count']
    decisions = int(llm['n']['value'] or 0)
    vetoes = llm['veto']['doc_count']
    bots = {b['key'] for b in llm['bots']['buckets']}
    models_now = {b['key'] for b in llm['models']['buckets']}
    endpoints_now = {b['key'] for b in llm['endpoints']['buckets']}
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

    # WHO SHOULD BE DECIDING.
    #
    # This was a hardcoded set of five names, written when the fleet was five
    # bots. The fleet is ten, and the five it omitted -- Hive01/02/03 and
    # Solo01/02 -- are the shared and isolated arms: precisely the bots the
    # experiment exists to compare. The hive arm was dark from 2026-08-08 and
    # this guard, whose entire job is to notice that, could not have said so.
    # It reported "all five bots deciding" the whole time, which was even true.
    #
    # Derived rather than declared, per the no-SSH rule in the docstring: anyone
    # who decided in the last WEEK is expected to be deciding now. The 6h window
    # used for models is wrong here -- a bot that died overnight would fall out
    # of its own baseline and become un-missable, which is how the hive arm
    # stayed dark. Seven days also means a deliberately retired bot ages out on
    # its own instead of needing an edit here, so this cannot drift again.
    roster = es('/mcai-llm-agents/_search', {
        "size": 0, "query": {"range": {"@timestamp": {"gte": ROSTER}}},
        "aggs": {"bots": {"terms": {"field": "bot.name", "size": 100}}}})['aggregations']
    expected_bots = {b['key'] for b in roster['bots']['buckets']}
    silent = sorted(expected_bots - bots)
    (alerts if silent else oks).append(
        f'no decisions from: {", ".join(silent)}' if silent
        # Never name a count this check did not verify. "all five" was a literal.
        else f'all {len(bots)} bots deciding')

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
    #
    # ASK THE FLEET WHERE IT IS THINKING, rather than being told at install time.
    # llm.endpoint became truthful in 785aea7 -- before that it echoed a static
    # env var and could not have answered this. Deriving it means the guard
    # follows an endpoint migration on its own, which the hardcoded value did
    # not: it spent this whole run probing a decommissioned host.
    probe_url = OLLAMA or (sorted(endpoints_now)[0] if endpoints_now else None)
    probe_model = OLLAMA_MODEL or (sorted(models_now)[0] if models_now else None)
    if not probe_url or not probe_model:
        # A check that could not run must never print as `ok`. This duplicates
        # the "NO LLM decisions" alert above when the fleet is fully dead, and
        # that redundancy is the correct trade: silence here would read as health.
        alerts.append('inference probe SKIPPED -- no endpoint/model in 15m of telemetry, '
                      'so "can the fleet think" is unknown, not fine')
    else:
        try:
            import urllib.request
            req = urllib.request.Request(
                f'{probe_url}/api/generate',
                data=json.dumps({'model': probe_model, 'prompt': 'ok',
                                 'stream': False, 'options': {'num_predict': 1}}).encode(),
                headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=45) as r:
                body = json.loads(r.read())
            if 'response' in body:
                oks.append(f'inference responding ({probe_url})')
            else:
                alerts.append(f'inference returned no completion: {str(body)[:90]}')
        except Exception as e:
            alerts.append(f'INFERENCE UNAVAILABLE at {probe_url} '
                          f'({str(e)[:70]}) -- the fleet cannot think')

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
