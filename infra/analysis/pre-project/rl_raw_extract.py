#!/usr/bin/env python3
"""Rejection-loop analysis, step 1 (raw sample). Read-only on ~/mcai/raw.

For a sample of day files (every 4th agents day + every showcase day) emit one row
per decision: id, bot, ts, skill, args_hash (canonical JSON of args), gate error,
and prompt features used to check whether the prompt carried the rejection reason.

Usage (on the analysis VM): nice -n 10 ~/venv/bin/python rl_raw_extract.py OUT.parquet
"""
import sys, glob, os, re, hashlib
import orjson, zstandard, pyarrow as pa, pyarrow.parquet as pq

RAW = os.path.expanduser('~/mcai/raw')
files = sorted(glob.glob(f'{RAW}/mcai-llm-agents/*.ndjson.zst'))[::4] + \
        sorted(glob.glob(f'{RAW}/mcai-llm-showcase/*.ndjson.zst'))
LA = re.compile(r'^LAST ACTION: (.*)$', re.M)
cols = {k: [] for k in ['id', 'src', 'bot', 'ts', 'skill', 'args_hash', 'err', 'ostatus',
                        'la_rejected', 'la_text', 'n_rejected_recent', 'lessons_n', 'ptext_len']}
for f in files:
    src = 'show' if 'showcase' in f else 'agents'
    with open(f, 'rb') as fh:
        rdr = zstandard.ZstdDecompressor().stream_reader(fh)
        buf = b''
        while True:
            chunk = rdr.read(1 << 24)
            if not chunk:
                break
            buf += chunk
            lines = buf.split(b'\n'); buf = lines.pop()
            for l in lines:
                if not l.strip():
                    continue
                try:
                    d = orjson.loads(l)
                except Exception:
                    continue
                tc = d.get('tool_calls') or [{}]
                tc = tc[0] if isinstance(tc, list) and tc else {}
                args = tc.get('args') if isinstance(tc, dict) else None
                t = (d.get('prompt') or {}).get('text') or ''
                m = LA.search(t)
                la = m.group(1) if m else ''
                cols['id'].append(d.get('_id')); cols['src'].append(src)
                cols['bot'].append((d.get('bot') or {}).get('name'))
                cols['ts'].append(d.get('@timestamp'))
                cols['skill'].append(tc.get('skill') if isinstance(tc, dict) else None)
                cols['args_hash'].append(hashlib.md5(orjson.dumps(args, option=orjson.OPT_SORT_KEYS)).hexdigest()[:12])
                cols['err'].append((d.get('llm') or {}).get('error'))
                cols['ostatus'].append((d.get('outcome') or {}).get('status'))
                cols['la_rejected'].append(la.startswith('rejected'))
                cols['la_text'].append(la[:160])
                cols['n_rejected_recent'].append(t.count('- rejected:'))
                cols['lessons_n'].append(t.count('has failed'))
                cols['ptext_len'].append(len(t))
    print(f, len(cols['id']), flush=True)
pq.write_table(pa.table(cols), sys.argv[1])
