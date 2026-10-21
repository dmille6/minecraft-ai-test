#!/usr/bin/env python3
"""learning-loop prototype: per-endpoint inference load for one UTC day, from the bots' own decision rows (read-only).

    nice -n 19 python3 endpoint_load.py 2026-10-20

Never sends a request to any endpoint (10.0.0.72 in particular is never contacted): every number is from llm rows.
Per endpoint: decisions, bots, prompt/completion tokens, latency p50/p95, per-request prefill rate
(prompt_tokens / prompt_eval_duration) and decode rate (completion_tokens / eval_duration), mean in-flight requests
(Little's law: sum of latency / wall time), and the busiest hour's prompt-token demand. The replay at the end asks
what the 5080 would carry with the 3090's bots added: demand tokens/s against the 5080's own measured prefill rate.
"""
import collections, glob, gzip, json, sys, statistics as st
day = sys.argv[1]; suf = day.replace('-', '')
nxt = '%s%02d' % (suf[:6], int(suf[6:]) + 1)          # a generation -YYYYMMDD holds the day before (no month wrap needed here)
E = collections.defaultdict(lambda: {'n': 0, 'bots': set(), 'pt': 0, 'ct': 0, 'lat': [], 'pre': [], 'dec': [], 'hour_pt': collections.Counter(),
                                     'hour_n': collections.Counter(), 'lat_sum': 0.0, 'pe_s': 0.0, 'ev_s': 0.0})
for f in glob.glob('/var/log/mcai/*/llm-*.jsonl-%s.gz' % nxt) + glob.glob('/var/log/mcai/*/llm-*.jsonl'):
    op = gzip.open if f.endswith('.gz') else open
    with op(f, 'rt', errors='replace') as fh:
        for line in fh:
            if not line.startswith('{"@timestamp":"' + day):
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            l = r.get('llm') or {}
            if not (l.get('latency_ms') or 0) > 0:
                continue
            e = E[l.get('endpoint')]; e['n'] += 1; e['bots'].add(r['bot']['name'])
            pt = l.get('prompt_tokens') or 0; ct = l.get('completion_tokens') or 0
            e['pt'] += pt; e['ct'] += ct; e['lat'].append(l['latency_ms']); e['lat_sum'] += l['latency_ms'] / 1000
            h = r['@timestamp'][11:13]; e['hour_pt'][h] += pt; e['hour_n'][h] += 1
            pe = l.get('prompt_eval_duration_ns'); ev = l.get('eval_duration_ns')
            if pe and pt: e['pre'].append(pt / (pe / 1e9)); e['pe_s'] += pe / 1e9
            if ev and ct: e['dec'].append(ct / (ev / 1e9)); e['ev_s'] += ev / 1e9
q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))] if xs else None
out = {}
for ep, e in sorted(E.items(), key=lambda kv: -kv[1]['n']):
    hp = max(e['hour_pt'].items(), key=lambda kv: kv[1]) if e['hour_pt'] else ('-', 0)
    out[ep] = o = {'decisions': e['n'], 'bots': len(e['bots']), 'prompt_tokens': e['pt'], 'completion_tokens': e['ct'],
                   'lat_p50_ms': q(e['lat'], .5), 'lat_p95_ms': q(e['lat'], .95),
                   'prefill_tok_s_p50': round(q(e['pre'], .5) or 0), 'decode_tok_s_p50': round(q(e['dec'], .5) or 0, 1),
                   'mean_in_flight': round(e['lat_sum'] / 86400, 2),
                   'prefill_busy_s_per_s': round(e['pe_s'] / 86400, 3), 'decode_busy_s_per_s': round(e['ev_s'] / 86400, 3),
                   'busiest_hour': hp[0], 'busiest_hour_prompt_tok_s': round(hp[1] / 3600), 'avg_prompt_tok_s': round(e['pt'] / 86400),
                   'rows_with_durations': len(e['pre'])}
    print(ep, json.dumps(o))
a, b = out.get('http://10.0.0.72:11434'), out.get('http://10.0.0.16:11434')
if a and b:
    dem = (a['prompt_tokens'] + b['prompt_tokens']) / 86400
    peak = max(E['http://10.0.0.72:11434']['hour_pt'][h] + E['http://10.0.0.16:11434']['hour_pt'][h] for h in E['http://10.0.0.72:11434']['hour_pt']) / 3600
    print('\nREPLAY: 80-bot prompt demand avg %.0f tok/s, busiest hour %.0f tok/s, against the 5080 prefill p50 %d tok/s -> %.0f%% / %.0f%% of '
          'prefill capacity if requests did not overlap; decode demand %.0f tok/s at %.1f tok/s per stream'
          % (dem, peak, a['prefill_tok_s_p50'], 100 * dem / a['prefill_tok_s_p50'], 100 * peak / a['prefill_tok_s_p50'],
             (a['completion_tokens'] + b['completion_tokens']) / 86400, a['decode_tok_s_p50']))
    print('5080 today: prefill busy %.3f s/s + decode busy %.3f s/s (per-request sums; overlapping requests count twice) for %d bots'
          % (a['prefill_busy_s_per_s'], a['decode_busy_s_per_s'], a['bots']))
    s = (a['decisions'] + b['decisions']) / a['decisions']
    print('scale x%.2f in decisions -> naive busy %.2f + %.2f s/s' % (s, a['prefill_busy_s_per_s'] * s, a['decode_busy_s_per_s'] * s))
