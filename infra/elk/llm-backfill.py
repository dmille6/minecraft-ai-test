#!/usr/bin/env python3
"""Backfill the 8-day hole in mcai-llm-agents from the rotated JSONL still on disk.

WHY THERE IS A HOLE, established 2026-09-23 from git and the cluster:
  2026-09-07 08:24  d121f63 adds llm.args_cleaned to bots/src/logger.mjs
  the mcai-llm index template is `dynamic: strict`, so a document carrying an undeclared
  field is REJECTED WHOLE -- not trimmed, not partially indexed
  2026-09-07 23:30  the last LLM document reaches Elasticsearch
  2026-09-16        0e4bd05 declares args_cleaned (flattened) and bot.tools in the template
  2026-09-16 23:46  shipping resumes; backing index ...09.16-000007 created 23:49:44Z
Eight days, ~1.4M decisions, absent from the archive. Confirmed absent CLUSTER-WIDE, not
misrouted: no index holds a document with llm.latency_ms in that window, while the same query
returns 177,421 for 09-17..18. mcai-skill-agents has zero empty days throughout, so the fleet
was running the whole time -- only this stream was dark.

The cause of the ORIGINAL stop is established. Why it took nine days to notice is not: the
filebeat journal no longer reaches back that far (its oldest entry is 2026-09-12T12:32), so
"no filebeat errors during the stop" is a blind negative and must not be reported as evidence.

WHY THIS IS POSSIBLE NOW AND WAS NOT BEFORE: the mapping now declares the field, so the same
documents that were rejected in September are accepted today.

WHAT IT DOES NOT DO: 2026-09-08 is UNRECOVERABLE. logrotate keeps 14 generations and the rows
of day D live in the file tagged D+1, so the file holding 09-08 (tag 20260909) is already
deleted. Recoverable: 09-09 through 09-15, seven of the eight days, and they age out at one
per day -- this had a closing window.

Run ON the bots host (the files are local):  sudo python3 llmbackfill.py --dry-run
                                             sudo python3 llmbackfill.py --go
"""
import argparse, base64, glob, gzip, json, os, re, sys, urllib.request, collections

ES = 'http://10.0.0.186:9200'
STREAM = 'mcai-llm-agents'
# tag D+1 holds the rows of day D, so these tags cover 09-09..09-15.
TAGS = (os.environ.get('BACKFILL_TAGS') or ','.join('2026091%d' % d for d in range(0, 7))).split(',')
# A CLOSED window, overridable, because a second hole turned up after the first run: ES held
# only 1,313 documents for 2026-09-16 (all from 23:46 onward, when the live shipper resumed on
# the rollover day) against 175,940 in the files. The default covers the original 09-09..09-15
# hole; BACKFILL_LO/HI recover any other, and the closed upper bound is what keeps a re-run from
# duplicating documents the live shipper has already delivered.
LO = os.environ.get('BACKFILL_LO') or '2026-09-09T00:00:00'
HI = os.environ.get('BACKFILL_HI') or '2026-09-16T00:00:00'


def creds():
    """The shipper account filebeat actually uses. Read locally, never printed, never copied
    off the host. /root/.mcai_ship_password on the ELK host is STALE and returns 401."""
    txt = open('/etc/filebeat/filebeat.yml').read()
    u = re.search(r'^\s*username:\s*"([^"]+)"', txt, re.M).group(1)
    p = re.search(r'^\s*password:\s*"([^"]+)"', txt, re.M).group(1)
    return u, p


def post(path, body, u, p, ndjson=False):
    req = urllib.request.Request(
        f'{ES}/{path}', data=body.encode() if isinstance(body, str) else json.dumps(body).encode(),
        method='POST',
        headers={'Content-Type': 'application/x-ndjson' if ndjson else 'application/json'})
    req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{u}:{p}'.encode()).decode())
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--go', action='store_true')
    ap.add_argument('--batch', type=int, default=1000)
    ap.add_argument('--limit-files', type=int, default=0, help='pilot on N files')
    ap.add_argument('--skip', type=int, default=0, help='skip the first N files (already sent)')
    a = ap.parse_args()
    u, p = creds()

    files = sorted(f for t in TAGS for f in glob.glob(f'/var/log/mcai/*/llm-*.jsonl-{t}.gz'))
    if a.skip:
        files = files[a.skip:]
    if a.limit_files:
        files = files[:a.limit_files]
    print(f'{len(files)} rotated llm files for tags {TAGS[0]}..{TAGS[-1]}'
          f' (skip={a.skip}, limit={a.limit_files or "none"})')
    assert files, 'NotAnInstrument: no rotated llm files matched -- wrong host or wrong tags'

    perday = collections.Counter()
    sent = ok = 0
    rejected = collections.Counter()
    batch = []

    def flush():
        nonlocal sent, ok, batch
        if not batch:
            return
        body = ''.join(batch)
        res = post(f'{STREAM}/_bulk', body, u, p, ndjson=True)
        for it in res.get('items', []):
            c = it.get('create', {})
            if c.get('error'):
                # `dynamic: strict` rejects a WHOLE document for one unknown field, so these
                # must be counted and their reasons kept -- a silent drop is the bug we are
                # repairing, and repeating it here would be absurd.
                rejected[str(c['error'].get('reason'))[:150]] += 1
            else:
                ok_local = True
        ok += sum(1 for it in res.get('items', []) if not it.get('create', {}).get('error'))
        sent += len(batch) // 2
        batch = []

    for fn in files:
        try:
            with gzip.open(fn, 'rt', errors='replace') as fh:
                for line in fh:
                    if '"@timestamp"' not in line:
                        continue
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    ts = d.get('@timestamp') or ''
                    if not (LO <= ts[:19] < HI):
                        continue
                    perday[ts[:10]] += 1
                    if a.go:
                        batch.append('{"create":{}}\n')
                        batch.append(json.dumps(d) + '\n')
                        if len(batch) >= a.batch * 2:
                            flush()
        except Exception as e:
            print(f'  !! {fn}: {type(e).__name__}: {e}')
    if a.go:
        flush()

    print('\nrows found per day, from the files:')
    for d in sorted(perday):
        print(f'  {d}  {perday[d]:>9,}')
    print(f'  TOTAL {sum(perday.values()):,}')

    if not a.go:
        print('\nDRY RUN -- nothing was written. Re-run with --go.')
        return 0

    print(f'\nsent {sent:,}  accepted {ok:,}  rejected {sum(rejected.values()):,}')
    if rejected:
        print('rejection reasons (a strict mapping rejects the WHOLE document):')
        for r, n in rejected.most_common(6):
            print(f'  {n:>8,}  {r}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
