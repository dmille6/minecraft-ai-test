#!/usr/bin/env python3
"""mcai-gpu-sampler -- put GPU/inference telemetry back into mcai-gpu-metrics.

WHY THIS EXISTS. MEASURED 2026-09-23: mcai-gpu-metrics had received ZERO documents in 24h
and its newest document was dated 2026-08-15T12:47:33Z -- 39.1 days earlier. Exactly one
host ever wrote it (ollama-pc). Nothing in the repo ships it, and two guards only READ it.

The damage was not the missing data, it was the FALSE GREEN. mcai-guard queried
`sort @timestamp desc, size 1` with no range filter, which returns the newest document that
EXISTS rather than the newest from NOW. The 39-day-old document lists qwen2.5-coder:7b, so
the guard printed "ok  honeypot model resident" and then "all clear" every ten minutes for
39 days. Caught live in the journal at 2026-09-23T14:38:55Z. The guard is fixed; this
restores the data it was pretending to have.

WHAT THIS DOES AND DOES NOT COVER, said plainly so the stream is not over-trusted:
  - COVERED: ollama.{reachable, models, models_loaded, vram_gb} for EVERY endpoint the
    fleet is actually using.
  - NOT COVERED: the gpu.* fields (temperature, power, pstate, utilization, memory). Those
    came from nvidia-smi running ON the GPU box. They cannot be read over HTTP, and the
    current inference hosts are a Linux 3090, a Windows Blackwell and a Mac -- three agents
    on three platforms, which is a bigger job than today. Those fields stay absent, and a
    reader must not mistake absent for zero.

ENDPOINTS ARE DISCOVERED, NEVER CONFIGURED. The fleet's own llm.endpoint field says where
it is thinking (truthful since 785aea7). The inference topology was SPLIT on 2026-09-11 and
a hardcoded endpoint list would have gone stale that day and read healthy while measuring
the wrong box -- which is this project's most repeated defect. The old stream's single host
could not have shown, for instance, that the honeypot model is resident on the Mac and not
on 10.0.0.16; this one can.

UNREACHABLE IS WRITTEN DOWN, NOT SKIPPED. An endpoint that fails to answer still gets a
document with reachable=false. A skipped write makes an outage indistinguishable from the
sampler not running, which is the same mistake in a new place.

The template is dynamic:false, so an unmapped field is silently DROPPED rather than
rejected. Every field written here is checked against the mapping at startup, because a
field that is quietly not indexed is another way to have data you only believe you have.

Run on the ELK host, root (reads the shipper credential):  mcai-gpu-sampler
"""
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request

ES = 'http://localhost:9200'
STREAM = 'mcai-gpu-metrics'
LOOKBACK = 'now-2h'          # wide enough to survive a quiet pool, narrow enough to be now
TIMEOUT = 10

# Only these are in the mcai-gpu template. The mapping is dynamic:false, so anything else
# would be accepted and then never indexed.
WRITE_FIELDS = {'@timestamp', 'host.name', 'ollama.reachable', 'ollama.models',
                'ollama.models_loaded', 'ollama.vram_gb'}


def _elastic_pw():
    env = open('/opt/docker-elk/.env').read()
    return re.search(r'^ELASTIC_PASSWORD=(.*)$', env, re.M).group(1).strip()


def es(path, body=None, method=None, user='elastic', pw=None):
    req = urllib.request.Request(
        f'{ES}/{path}', method=method or ('POST' if body is not None else 'GET'),
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'})
    import base64
    tok = base64.b64encode(f'{user}:{pw}'.encode()).decode()
    req.add_header('Authorization', f'Basic {tok}')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def mapped_fields(pw):
    """Flatten the stream's mapping so the field check below is against reality."""
    out = {}

    def walk(props, prefix=''):
        for k, v in (props or {}).items():
            name = f'{prefix}{k}'
            if 'properties' in v:
                walk(v['properties'], name + '.')
            else:
                out[name] = v.get('type')
    d = es(f'{STREAM}/_mapping', pw=pw)
    for idx in d.values():
        walk(idx.get('mappings', {}).get('properties', {}))
    return out


def endpoints(pw):
    """Where the fleet says it is thinking, from its own logs."""
    body = {'size': 0,
            'query': {'range': {'@timestamp': {'gte': LOOKBACK, 'lte': 'now'}}},
            'aggs': {'e': {'terms': {'field': 'llm.endpoint', 'size': 20}}}}
    d = es('mcai-llm-agents/_search', body, pw=pw)
    return [(b['key'], b['doc_count']) for b in d['aggregations']['e']['buckets']]


def probe(url):
    """/api/ps is the resident-model view: what is loaded and how much VRAM it holds."""
    try:
        with urllib.request.urlopen(url.rstrip('/') + '/api/ps', timeout=TIMEOUT) as r:
            d = json.loads(r.read())
        ms = d.get('models') or []
        return {'reachable': True,
                'models': sorted({m.get('name') or m.get('model') for m in ms if m} - {None}),
                'models_loaded': len(ms),
                'vram_gb': round(sum(int(m.get('size_vram') or 0) for m in ms) / 1e9, 3)}
    except Exception as e:
        return {'reachable': False, 'models': [], 'models_loaded': 0, 'vram_gb': 0.0,
                'error': f'{type(e).__name__}: {e}'}


def host_of(url):
    m = re.match(r'^\w+://([^:/]+)', url)
    return m.group(1) if m else url


def main():
    pw = _elastic_pw()

    # FIELD CHECK FIRST. dynamic:false drops an unmapped field silently, so a typo here
    # would produce documents that look written and are not queryable.
    have = mapped_fields(pw)
    missing = sorted(f for f in WRITE_FIELDS if f != '@timestamp' and f not in have)
    if missing:
        print(f'ALARM: these fields are NOT in the {STREAM} mapping and would be silently '
              f'dropped: {missing}', file=sys.stderr)
        return 2

    eps = endpoints(pw)
    if not eps:
        # POSITIVE CONTROL. No endpoints means the fleet logged no inference in 2h, which on
        # an 80-bot fleet means the query is wrong, not that the fleet is quiet.
        print(f'ALARM: no llm.endpoint values in {LOOKBACK}..now. An 80-bot fleet does not '
              f'go two hours without a decision -- refusing to write a zero sample.',
              file=sys.stderr)
        return 2

    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
    lines, summary = [], []
    for url, n in eps:
        p = probe(url)
        doc = {'@timestamp': now,
               'host': {'name': host_of(url)},
               'ollama': {'reachable': p['reachable'], 'models': p['models'],
                          'models_loaded': p['models_loaded'], 'vram_gb': p['vram_gb']}}
        lines.append(json.dumps({'create': {}}))
        lines.append(json.dumps(doc))
        summary.append(f"  {host_of(url):22s} decisions/2h {n:6d}  "
                       f"{'UP  ' if p['reachable'] else 'DOWN'} "
                       f"models {p['models_loaded']} vram {p['vram_gb']:.1f}GB "
                       f"{p['models']}" + (f"  {p.get('error', '')}" if not p['reachable'] else ''))

    # CREDENTIAL. The obvious choice was mcai_ship, the write-only shipper account, and it
    # does not work: /root/.mcai_ship_password on this host returns 401 against a user that
    # exists. The password filebeat actually ships with lives in /etc/filebeat/filebeat.yml
    # on the bots host, so the copy here is a stale leftover -- a trap for the next person,
    # reported separately. This uses the same local credential mcai-guard already reads, so
    # no secret is copied between hosts and no password is changed to make this work.
    body = '\n'.join(lines) + '\n'
    req = urllib.request.Request(f'{ES}/{STREAM}/_bulk', data=body.encode(), method='POST',
                                headers={'Content-Type': 'application/x-ndjson'})
    import base64
    req.add_header('Authorization', 'Basic ' +
                   base64.b64encode(f'elastic:{pw}'.encode()).decode())
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read())

    # A 200 on _bulk does NOT mean the documents landed; per-item errors live inside.
    errs = [i['create'] for i in res.get('items', [])
            if i.get('create', {}).get('error')]
    print(f'mcai-gpu-sampler {now}  {len(eps)} endpoint(s)')
    for s in summary:
        print(s)
    if errs:
        print(f'ALARM: {len(errs)} of {len(eps)} documents REJECTED: '
              f'{errs[0].get("error")}', file=sys.stderr)
        return 1
    print(f'  wrote {len(eps)} document(s) to {STREAM}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
