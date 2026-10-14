#!/usr/bin/env python3
"""escheck/fbjournal.py -- what FILEBEAT says it dropped (read-only; needs `sudo -n`).

Two independent sources on 10.0.0.31:
  1. the 30 s "Non-zero metrics" snapshots in `journalctl -u filebeat`: per UTC day, the
     output's acked / dropped / failed counters and per-input lines read. `dropped` is the
     non-retryable (e.g. HTTP 400 mapping) loss counter.
  2. /var/log/filebeat/filebeat-events-data-*.ndjson: filebeat writes the BODY of every
     event Elasticsearch refused there (the journal only says "see the events log"), so this
     is where a strict-mapping rejection names its field. Tabulated per day x stream x reason.

Usage: fbjournal.py --since 2026-10-06 --out DIR   (writes DIR/filebeat.json)
"""
import argparse
import collections
import json
import re
import subprocess


def metrics(since):
    p = subprocess.run(['sudo', '-n', 'journalctl', '-u', 'filebeat', '--since', since,
                        '--no-pager', '-o', 'cat'], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f'journalctl failed: {p.stderr[:200]}')
    S = collections.defaultdict(collections.Counter)
    for line in p.stdout.splitlines():
        if 'Non-zero metrics' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            S['<unparseable metrics lines>']['n'] += 1  # counted, never silently skipped
            continue
        day = d['@timestamp'][:10]
        m = d.get('monitoring', {})
        ev = m.get('metrics', {}).get('libbeat', {}).get('output', {}).get('events', {})
        for k, v in ev.items():
            if isinstance(v, (int, float)):
                S[day]['output.' + k] += v
        for name in ('agent-skill-jsonl', 'agent-llm-jsonl'):
            x = m.get('dataset', {}).get(name, {})
            S[day][name + '.messages_read'] += x.get('messages_read_total', 0)
            S[day][name + '.published'] += x.get('events_pipeline_published_total', 0)
        S[day]['snapshots(2880=full day)'] += 1
    return {d: dict(c) for d, c in sorted(S.items())}


def rejections():
    c = collections.Counter()
    files = []
    # /var/log/filebeat is drwx------ root: a plain glob() as mike silently finds NOTHING and
    # reports "no rejections" (it did, on the first run). List it through sudo, and refuse an
    # empty listing rather than read it as zero.
    ls = subprocess.run(['sudo', '-n', 'find', '/var/log/filebeat', '-maxdepth', '1', '-name',
                         'filebeat-events-data-*.ndjson'], capture_output=True, text=True)
    if ls.returncode != 0:
        raise SystemExit(f'cannot list /var/log/filebeat: {ls.stderr[:200]}')
    names = sorted(ls.stdout.split())
    if not names:
        raise SystemExit('no filebeat-events-data files found: cannot distinguish "no rejections" from "not logging"')
    for f in names:
        p = subprocess.run(['sudo', '-n', 'cat', f], capture_output=True, text=True, errors='replace')
        if p.returncode != 0:
            raise SystemExit(f'cannot read {f}: {p.stderr[:200]}')
        files.append(f)
        for line in p.stdout.splitlines():
            try:
                d = json.loads(line)
            except Exception:
                c[('?', '?', 'unparseable log line')] += 1
                continue
            m = d.get('message', '')
            day = d.get('@timestamp', '')[:10]
            i = m.rfind('(status=')
            tail = m[i:] if i >= 0 else m[-300:]
            r = re.search(r'"reason":"([^"]*)', tail)
            reason = r.group(1) if r else tail[:170]
            reason = re.sub(r"\[\d+:\d+\]|with id \S+|Preview of field.s value: .*", '', reason).strip()
            stream = 'llm' if '\\"prompt\\"' in m or '"prompt"' in m else 'skill/other'
            c[(day, stream, reason[:160])] += 1
    return files, [{'day': k[0], 'stream': k[1], 'reason': k[2], 'n': v} for k, v in sorted(c.items())]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    files, rej = rejections()
    out = {'metrics_by_day': metrics(a.since), 'events_data_files': files, 'rejections': rej}
    with open(f'{a.out}/filebeat.json', 'w') as fh:
        json.dump(out, fh, indent=1)
    for d, v in out['metrics_by_day'].items():
        print(d, {k: v.get(k, 0) for k in ('output.acked', 'output.dropped', 'output.failed',
                                             'agent-skill-jsonl.messages_read', 'agent-llm-jsonl.messages_read',
                                             'snapshots(2880=full day)')})
    for r in rej:
        print(r)


if __name__ == '__main__':
    main()
