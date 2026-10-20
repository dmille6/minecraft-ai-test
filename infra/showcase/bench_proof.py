#!/usr/bin/env python3
"""The exclusion proof, run ON 10.0.0.31 from the ES tools checkout (~/estel), READ-ONLY. Design section 10.

    python3 bench_proof.py --since 2026-10-20T10:00:00Z --until 2026-10-20T10:30:00Z --out before.json
    ... ship the showcase fixtures (real bench rows of that window, relabelled showcase-FIXTURE) ...
    python3 bench_proof.py --since ... --until ... --out after.json --compare before.json

For a FIXED past window W it records what the bench sees in its own streams -- totals, the bot set, by-pool and
by-bot counts for both streams, the served-model terms -- plus how many docs in the BENCH streams carry a showcase
bot name (must be 0) and how many docs the SHOWCASE streams hold in W (the positive control: > 0 after the fixtures).
--compare exits 1 unless every bench figure is identical and the positive control is present.
"""
import argparse, hashlib, json, os, sys

sys.path.insert(0, os.path.join(os.path.expanduser('~/estel'), 'scripts', 'lib'))
from estelemetry import EsEvents, http  # noqa: E402


def snapshot(since, until):
    out = {'window': [since, until]}
    for st in ('skill', 'llm'):
        ev = EsEvents.load(st, since=since, until=until, gaps='allow')
        bots = sorted(ev.bots_present())
        out[st] = {'total': ev.total(), 'bots': len(bots),
                   'bots_sha': hashlib.sha256('\n'.join(bots).encode()).hexdigest()[:16],
                   'by_pool': ev.by_pool(allow_zero=True), 'by_bot': ev.by_bot(allow_zero=True)}
        if st == 'llm':
            out[st]['models'] = ev.terms('llm.model', allow_zero=True)
        q = {'query': {'bool': {'filter': [{'range': {'@timestamp': {'gte': since, 'lt': until}}},
                                           {'prefix': {'bot.name': 'showcase-'}}]}}}
        out[st]['showcase_named_docs_in_bench_stream'] = http('POST', f"{ev.cfg['index']}/_count", q)['count']
        sc = 'mcai-skill-showcase' if st == 'skill' else 'mcai-llm-showcase'
        r = http('POST', f'{sc}/_count?ignore_unavailable=true&allow_no_indices=true',
                 {'query': {'range': {'@timestamp': {'gte': since, 'lt': until}}}})
        out[st]['showcase_stream_docs_in_window'] = r['count']
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True)
    ap.add_argument('--until', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--compare')
    a = ap.parse_args()
    s = snapshot(a.since, a.until)
    json.dump(s, open(a.out, 'w'), indent=1, sort_keys=True)
    for st in ('skill', 'llm'):
        x = s[st]
        print(f"{st}: bench total {x['total']:,} docs, {x['bots']} bots ({x['bots_sha']}), pools {len(x['by_pool'])}; "
              f"showcase-named docs in the bench stream {x['showcase_named_docs_in_bench_stream']}; "
              f"showcase stream docs in W {x['showcase_stream_docs_in_window']}")
    if not a.compare:
        return 0
    b = json.load(open(a.compare))
    bad = []
    for st in ('skill', 'llm'):
        for k in ('total', 'bots', 'bots_sha', 'by_pool', 'by_bot') + (('models',) if st == 'llm' else ()):
            if b[st][k] != s[st][k]:
                bad.append(f'{st}.{k} changed')
        if s[st]['showcase_named_docs_in_bench_stream'] != 0:
            bad.append(f'{st}: {s[st]["showcase_named_docs_in_bench_stream"]} showcase docs in the BENCH stream')
        if s[st]['showcase_stream_docs_in_window'] <= b[st]['showcase_stream_docs_in_window']:
            bad.append(f'{st}: positive control missing (showcase stream did not gain the fixtures)')
        if s[st]['total'] <= 0:
            bad.append(f'{st}: bench window empty (the instrument saw nothing)')
    print('COMPARE: ' + ('IDENTICAL bench figures; fixtures present only in the showcase streams' if not bad
                         else 'FAIL: ' + '; '.join(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
