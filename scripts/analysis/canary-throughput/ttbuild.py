#!/usr/bin/env python3
"""ttbuild.py <until ISO> <from ISO> <out_dir> -- a TIME-TRAVEL copy of /var/log/mcai for backtests.

Every bot's skill-*/llm-* logs (rotated .gz and live), keeping only rows with from <= @timestamp <= until, written under
the SAME file names (so the readers' rotation globs `skill-*.jsonl-<YYYYMMDD>.gz` still find them). A reader run against
this copy with its clock frozen at `until` sees exactly what it would have seen at that instant -- no row from after the
read can leak in (Events.load(since_minutes=...) has no `until`, so truncation, not filtering, is what makes it honest).
Idempotent: a finished copy carries out_dir/.done and is reused. Read-only on /var/log/mcai.
"""
import gzip, os, sys, json, datetime as dt
U = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
F = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
OUT = sys.argv[3]
SRC = '/var/log/mcai'
if os.path.exists(os.path.join(OUT, '.done')):
    print('cached', OUT); sys.exit(0)
days = {(F.date() + dt.timedelta(days=k)).strftime('%Y%m%d') for k in range(0, (U.date() - F.date()).days + 2)}
kept = rows = files = 0
for b in sorted(os.listdir(SRC)):
    d = os.path.join(SRC, b)
    if not os.path.isdir(d) or b.startswith('_'):
        continue
    od = os.path.join(OUT, b); os.makedirs(od, exist_ok=True)
    for fn in sorted(os.listdir(d)):
        if not (fn.startswith('skill-') or fn.startswith('llm-')):
            continue
        p = os.path.join(d, fn)
        gz = fn.endswith('.gz')
        if gz and fn[-11:-3] not in days:
            continue
        files += 1
        op = gzip.open if gz else open
        wp = gzip.open if gz else open
        with op(p, 'rt', errors='replace') as fh, wp(os.path.join(od, fn), 'wt') as w:
            for line in fh:
                rows += 1
                i = line.find('"@timestamp":"')
                if i < 0:
                    i = line.find('"ts":"'); j = i + 6
                else:
                    j = i + 14
                if i < 0:
                    continue
                try:
                    t = dt.datetime.fromisoformat(line[j:j + 24].replace('Z', '+00:00'))
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=dt.timezone.utc)
                except Exception:
                    continue
                if F <= t <= U:
                    w.write(line); kept += 1
open(os.path.join(OUT, '.done'), 'w').write(json.dumps({'until': sys.argv[1], 'from': sys.argv[2], 'files': files,
                                                        'rows_read': rows, 'rows_kept': kept}))
print('built', OUT, 'files', files, 'rows read', rows, 'kept', kept)
