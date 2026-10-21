#!/usr/bin/env python3
"""learning-loop prototype: per-endpoint inference load for one UTC day, from the bots' own decision rows (read-only).

    nice -n 19 python3 endpoint_load.py 2026-10-20

Never sends a request to any endpoint (10.0.0.72 in particular is never contacted): every number is from llm rows,
read with extract_triples.files_for/read_rows (same rotation rule, same counts). Per endpoint: decisions, bots,
prompt/completion tokens, latency p50/p95/p99, per-request prefill and decode rates (measured UNDER the day's
concurrency, so they are not exclusive capacity), summed prefill / decode seconds per wall second (overlapping
requests add), mean in flight (Little's law: the observed latency; it does not predict latency under more load), and
the busiest hour and busiest 5 minutes of prompt demand. Fallback evidence: each bot's served endpoints against the
FIRST entry of OLLAMA_BASE_URLS in its env file (file mtime printed, so a mid-day config change is visible),
rows with retry_count > 0, and model rows with no endpoint (nothing served).
"""
import collections, glob, json, os, re, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_triples import read_rows, BAD

day = sys.argv[1]; d0 = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
t0 = d0.strftime('%Y-%m-%dT%H:%M:%S'); t1 = (d0 + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S')
ENV = '/srv/mcbots/harness/env'
roster = sorted(x[:-4] for x in os.listdir(ENV) if x.endswith('.env') and not x.startswith('.'))
primary, mtimes = {}, []
for b in roster:
    p = os.path.join(ENV, b + '.env'); mtimes.append(datetime.fromtimestamp(os.path.getmtime(p), timezone.utc).isoformat()[:19])
    for line in open(p, errors='replace'):
        if line.startswith('OLLAMA_BASE_URLS='):
            primary[b] = line.split('=', 1)[1].strip().split(',')[0]
E = collections.defaultdict(lambda: {'n': 0, 'bots': set(), 'pt': 0, 'ct': 0, 'lat': [], 'pre': [], 'dec': [], 'h': collections.Counter(),
                                     'm5': collections.Counter(), 'lat_s': 0.0, 'pe_s': 0.0, 'ev_s': 0.0})
off_primary = collections.Counter(); retries = 0; unserved = 0; model_rows = 0
for b in roster:
    for r in read_rows('/var/log/mcai/%s/llm-%s.jsonl' % (b, b), t0, t1):
        l = r.get('llm') or {}
        if not (l.get('latency_ms') or 0) > 0: continue
        model_rows += 1; ep = l.get('endpoint')
        if ep is None: unserved += 1
        retries += (l.get('retry_count') or 0) > 0
        if ep != primary.get(b): off_primary[(b.rsplit('-', 1)[0], ep)] += 1
        e = E[ep]; e['n'] += 1; e['bots'].add(b)
        pt = l.get('prompt_tokens') or 0; ct = l.get('completion_tokens') or 0
        e['pt'] += pt; e['ct'] += ct; e['lat'].append(l['latency_ms']); e['lat_s'] += l['latency_ms'] / 1000
        ts = r['@timestamp']; e['h'][ts[11:13]] += pt; e['m5'][ts[11:15] + str(int(ts[15]) // 5)] += pt
        pe, ev = l.get('prompt_eval_duration_ns'), l.get('eval_duration_ns')
        if pe and pt: e['pre'].append(pt / (pe / 1e9)); e['pe_s'] += pe / 1e9
        if ev and ct: e['dec'].append(ct / (ev / 1e9)); e['ev_s'] += ev / 1e9
q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))] if xs else None
print('positive control: roster %d bots, model rows %d, reader rejects %s, env files mtime range %s .. %s'
      % (len(roster), model_rows, dict(BAD), min(mtimes), max(mtimes)))
print('fallback evidence: rows served by an endpoint other than the bot\'s configured FIRST entry: %d %s; rows with retry_count>0: %d; '
      'model rows with no endpoint: %d' % (sum(off_primary.values()), dict(off_primary), retries, unserved))
out = {}
for ep, e in sorted(E.items(), key=lambda kv: -kv[1]['n']):
    o = out[ep] = {'decisions': e['n'], 'bots': len(e['bots']), 'prompt_tokens': e['pt'], 'completion_tokens': e['ct'],
                   'lat_p50_ms': q(e['lat'], .5), 'lat_p95_ms': q(e['lat'], .95), 'lat_p99_ms': q(e['lat'], .99),
                   'prefill_tok_s_p50': round(q(e['pre'], .5) or 0), 'decode_tok_s_p50': round(q(e['dec'], .5) or 0, 1),
                   'mean_in_flight': round(e['lat_s'] / 86400, 2),
                   'prefill_s_per_s': round(e['pe_s'] / 86400, 3), 'decode_s_per_s': round(e['ev_s'] / 86400, 3),
                   'avg_prompt_tok_s': round(e['pt'] / 86400), 'busiest_hour_prompt_tok_s': round(max(e['h'].values()) / 3600),
                   'busiest_5min_prompt_tok_s': round(max(e['m5'].values()) / 300), 'rows_with_durations': len(e['pre'])}
    print(ep, json.dumps(o))
a, b = out.get('http://10.0.0.72:11434'), out.get('http://10.0.0.16:11434')
if a and b:
    A, B = E['http://10.0.0.72:11434'], E['http://10.0.0.16:11434']
    pk_h = max(A['h'][h] + B['h'][h] for h in A['h']) / 3600
    pk_5 = max(A['m5'][m] + B['m5'][m] for m in A['m5']) / 300
    s = (a['decisions'] + b['decisions']) / a['decisions']
    print('\nIF ALL 80 ON THE 5080 (a hypothesis, not a measurement):')
    print('  prompt demand: day avg %.0f tok/s, busiest hour %.0f, busiest 5 min %.0f, vs the 5080 per-request prefill p50 %d '
          '(measured under its own concurrency) -> %.0f%% / %.0f%% / %.0f%%'
          % ((a['prompt_tokens'] + b['prompt_tokens']) / 86400, pk_h, pk_5, a['prefill_tok_s_p50'],
             100 * (a['prompt_tokens'] + b['prompt_tokens']) / 86400 / a['prefill_tok_s_p50'], 100 * pk_h / a['prefill_tok_s_p50'], 100 * pk_5 / a['prefill_tok_s_p50']))
    print('  decode is the larger share of GPU time: today %.3f decode-s/s vs %.3f prefill-s/s on the 5080 (60 bots); scaled x%.2f by '
          'decisions -> %.2f decode-s/s and %.2f prefill-s/s, i.e. ~%.1f requests decoding at once on average (today %.2f in flight)'
          % (a['decode_s_per_s'], a['prefill_s_per_s'], s, a['decode_s_per_s'] * s, a['prefill_s_per_s'] * s, a['decode_s_per_s'] * s, a['mean_in_flight']))
