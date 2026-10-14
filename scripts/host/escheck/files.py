#!/usr/bin/env python3
"""escheck/files.py -- the FILE side of the Elasticsearch completeness check (read-only).

Walks /var/log/mcai/<bot>/{skill,llm}-<bot>.jsonl plus the rotated *.jsonl-YYYYMMDD.gz
generations ONCE, streaming, and writes everything the ES side needs to be compared against:

  counts   rows per (stream, bot.name, UTC day, hour), bucketed by the ROW'S OWN @timestamp
           (a rotated file is not a UTC day: rotation runs 23:57-00:00, so a day's rows sit
           in two files). Bot = the row's bot.name, which is what ES aggregates on; rows
           whose bot.name disagrees with their directory are counted separately.
  minutes  rows per (stream, bot, minute) inside the rotation window 23:50-00:10, where
           copytruncate can lose lines filebeat had not yet read.
  kinds    rows per (stream, day, kind) -- kind = skill.name / llm trigger -- so a strict
           mapping rejecting one event type shows up as a deficit in that type.
  census   EVERY row's key paths (not a sample) with value types and per-day counts. Arrays
           of objects are walked under the same path, as ES flattens them.
  bad      lines that are not JSON objects (they ship as message+error.* and the strict
           mapping rejects them) and partial trailing lines of live files.
  spot     a seeded reservoir of N rows per (stream, day) for field-by-field equality.
  multiset the exact (ts_ms, kind) multiset for seeded bot-days, to separate LOSS from
           DUPLICATION (a net ratio of 1.000 can hide both).

The walk never loads a file into memory. Run it under `nice -n 19 ionice -c3`; it takes
roughly 0.5 s per bot-day of skill rows on 10.0.0.31.

Usage: files.py --first 2026-10-07 --last 2026-10-14 --cutoff 2026-10-14T18:00:00Z --out DIR
  --cutoff  rows at/after it are counted as `after_cutoff` and excluded everywhere (today's
            live files keep growing; the ES side uses the same cutoff).
"""
import argparse
import collections
import datetime as dt
import glob
import gzip
import json
import os
import random
import re
import sys
import time

LOGROOT = '/var/log/mcai'
STREAMS = ('skill', 'llm')
SPOT_N = 200
MULTISET_BOTS_PER_DAY = 2
SEED = 20261014


def day_range(first, last):
    d = dt.date.fromisoformat(first)
    e = dt.date.fromisoformat(last)
    while d <= e:
        yield d.isoformat()
        d += dt.timedelta(days=1)


TS_RE = re.compile(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z')


def ts_ms(ts):
    # '2026-10-14T00:00:14.109Z' -> epoch ms. ONLY the canonical JS toISOString form is accepted:
    # offsets or sub-ms digits would need ES's own parsing to compare, so they raise instead of
    # being rounded into a key that silently differs from ES's.
    if not TS_RE.fullmatch(ts):
        raise ValueError(f'non-canonical @timestamp {ts!r}')
    t = dt.datetime.strptime(ts[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc)
    return int(t.timestamp()) * 1000 + int(ts[20:23])


def kind_of(stream, d):
    if stream == 'skill':
        s = d.get('skill')
        return s.get('name') if isinstance(s, dict) else None
    return d.get('trigger')


def type_name(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, int):
        return 'int'
    if isinstance(v, float):
        return 'float'
    if isinstance(v, str):
        return 'str'
    if isinstance(v, list):
        return 'list'
    if isinstance(v, dict):
        return 'dict'
    return type(v).__name__


def walk(obj, prefix, out):
    """Append (path, type, numeric value or None) for every node. A non-empty dict is recorded
    as 'dict' AND descended into, so a mapped keyword/number receiving an object is visible as
    a type conflict at its own path; lists record 'list' and walk dict elements under the same
    path (ES flattens arrays of objects that way)."""
    for k, v in obj.items():
        p = prefix + k
        if isinstance(v, dict):
            out.append((p, 'dict' if v else 'dict(empty)', None))
            if v:
                walk(v, p + '.', out)
        elif isinstance(v, list):
            out.append((p, 'list', None))
            for el in v:
                if isinstance(el, dict):
                    out.append((p, 'list[dict]', None))
                    walk(el, p + '.', out)
                else:
                    out.append((p, 'list[' + type_name(el) + ']', el if type_name(el) in ('int', 'float', 'str') else None))
        else:
            t = type_name(v)
            out.append((p, t, v if t in ('int', 'float') else (v if t == 'str' else None)))


def files_for(stream, botdir, days):
    """Live file + rotated generations whose date suffix lies in [first_day, last_day+2].
    -YYYYMMDD.gz holds the rows WRITTEN before the rotation on that date -- but a row is stamped
    when its skill STARTS, so a skill begun at 23:59:5x on day D and logged after the rotation
    lands in tag D+2. A [D, D+1] range missed exactly such a row (board-d-Comet 10-11) and
    reported it as an ES-only "extra"."""
    bot = os.path.basename(botdir)
    lo = days[0].replace('-', '')
    hi = (dt.date.fromisoformat(days[-1]) + dt.timedelta(days=2)).isoformat().replace('-', '')
    out = []
    for f in sorted(glob.glob(f'{botdir}/{stream}-{bot}.jsonl-*.gz')):
        m = re.search(r'-(\d{8})\.gz$', f)
        if m and lo <= m.group(1) <= hi:
            out.append(f)
    live = f'{botdir}/{stream}-{bot}.jsonl'
    if os.path.exists(live):
        out.append(live)
    return out


def open_lines(path):
    if path.endswith('.gz'):
        with gzip.open(path, 'rb') as fh:
            for line in fh:
                yield line, True
        return
    size = os.path.getsize(path)  # never read past the size at open: the file is growing
    with open(path, 'rb') as fh:
        read = 0
        for line in fh:
            read += len(line)
            if read > size:
                break
            yield line, line.endswith(b'\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--first', required=True)
    ap.add_argument('--last', required=True)
    ap.add_argument('--cutoff', required=True, help='ISO UTC, e.g. 2026-10-14T18:00:00Z')
    ap.add_argument('--out', required=True)
    ap.add_argument('--root', default=LOGROOT)
    ap.add_argument('--no-census', action='store_true')
    ap.add_argument('--no-spot', action='store_true')
    a = ap.parse_args()
    days = list(day_range(a.first, a.last))
    dayset = set(days)
    cutoff = a.cutoff.replace('+00:00', 'Z')
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', cutoff):
        raise SystemExit(f'--cutoff must be whole seconds, YYYY-MM-DDTHH:MM:SSZ (got {cutoff})')
    os.makedirs(a.out, exist_ok=True)
    rnd = random.Random(SEED)
    t0 = time.time()

    botdirs = sorted(d for d in glob.glob(f'{a.root}/*') if os.path.isdir(d)
                     and not os.path.basename(d).startswith('_'))
    # seeded multiset bot-days: drawn from bots that HAVE a live skill file today
    def _live(d):
        p = f'{d}/skill-{os.path.basename(d)}.jsonl'
        return os.path.exists(p) and os.path.getsize(p) > 0
    active = [os.path.basename(d) for d in botdirs if _live(d)]
    mset_pick = {day: sorted(rnd.sample(active, min(MULTISET_BOTS_PER_DAY, len(active))))
                 for day in days}

    counts = {s: collections.defaultdict(collections.Counter) for s in STREAMS}   # (bot,day)->hour
    minutes = {s: collections.Counter() for s in STREAMS}                         # (bot,minute)
    kinds = {s: collections.defaultdict(collections.Counter) for s in STREAMS}    # day->kind
    census = {s: collections.defaultdict(collections.Counter) for s in STREAMS}   # path->type
    census_day = {s: collections.defaultdict(collections.Counter) for s in STREAMS}  # path->day
    census_num = {s: {} for s in STREAMS}                                         # path->[min,max]
    # path -> longest string: CHARACTERS up to 8,000 (<= 32,000 bytes, under the 32,766-byte term
    # limit whatever the encoding), UTF-8 BYTES above that. A bound, not a byte count, below 8,000.
    census_strmax = {s: collections.Counter() for s in STREAMS}
    rows_day = {s: collections.Counter() for s in STREAMS}
    bad = {s: collections.Counter() for s in STREAMS}
    bad_examples = {s: [] for s in STREAMS}
    bad_by_file = {s: collections.Counter() for s in STREAMS}
    dir_mismatch = {s: collections.Counter() for s in STREAMS}
    out_of_window = {s: collections.Counter() for s in STREAMS}
    newest = {s: {} for s in STREAMS}
    spot = {s: {day: [] for day in days} for s in STREAMS}
    spot_seen = {s: collections.Counter() for s in STREAMS}
    mset = {s: collections.defaultdict(collections.Counter) for s in STREAMS}
    files_read = {s: [] for s in STREAMS}

    for botdir in botdirs:
        dirbot = os.path.basename(botdir)
        for stream in STREAMS:
            for path in files_for(stream, botdir, days):
                n_file = 0
                for line, complete in open_lines(path):
                    if not complete:
                        bad[stream]['partial_tail_live'] += 1
                        continue
                    n_file += 1
                    s = line.strip()
                    if not s:
                        bad[stream]['blank'] += 1
                        continue
                    try:
                        d = json.loads(s)
                    except Exception:
                        bad[stream]['not_json'] += 1
                        bad_by_file[stream][os.path.basename(path)] += 1
                        if len(bad_examples[stream]) < 5:
                            bad_examples[stream].append({'file': path, 'head': s[:120].decode('utf-8', 'replace')})
                        continue
                    if not isinstance(d, dict):
                        bad[stream]['not_object'] += 1
                        continue
                    ts = d.get('@timestamp')
                    if not isinstance(ts, str) or len(ts) < 20:
                        bad[stream]['no_timestamp'] += 1
                        continue
                    if not TS_RE.fullmatch(ts):
                        bad[stream]['noncanonical_timestamp'] += 1
                        continue
                    day = ts[:10]
                    if day not in dayset:
                        out_of_window[stream][day] += 1
                        continue
                    # Compare whole seconds only. A raw string compare put '18:00:00.123Z'
                    # BEFORE '18:00:00Z' ('.' < 'Z') and counted 13 rows ES correctly excluded.
                    if ts[:19] >= cutoff[:19]:
                        out_of_window[stream]['after_cutoff'] += 1
                        continue
                    b = d.get('bot') if isinstance(d.get('bot'), dict) else {}
                    bot = b.get('name')
                    if not isinstance(bot, str):
                        bot = '<missing bot.name>'
                    if bot != dirbot:
                        dir_mismatch[stream][f'{dirbot}->{bot}'] += 1
                    counts[stream][(bot, day)][ts[11:13]] += 1
                    hm = ts[11:16]
                    if hm >= '23:50' or hm < '00:10':
                        minutes[stream][(bot, ts[:16])] += 1
                    k = kind_of(stream, d)
                    kinds[stream][day][k if isinstance(k, str) else '<none>'] += 1
                    rows_day[stream][day] += 1
                    if ts > newest[stream].get(bot, ''):
                        newest[stream][bot] = ts
                    if not a.no_census:
                        leaves = []
                        walk(d, '', leaves)
                        seen = set()
                        for p, t, v in leaves:
                            census[stream][p][t] += 1
                            if isinstance(v, str):
                                # a keyword/flattened term over 32,766 BYTES is rejected; chars are a
                                # safe bound below 8,000 (<= 4 bytes each), so only encode above it
                                n = len(v) if len(v) <= 8000 else len(v.encode('utf-8'))
                                if n > census_strmax[stream][p]:
                                    census_strmax[stream][p] = n
                            elif v is not None:
                                mm = census_num[stream].get(p)
                                if mm is None:
                                    census_num[stream][p] = [v, v]
                                elif v < mm[0]:
                                    mm[0] = v
                                elif v > mm[1]:
                                    mm[1] = v
                            if p not in seen:
                                seen.add(p)
                                census_day[stream][p][day] += 1
                    if not a.no_spot:
                        spot_seen[stream][day] += 1
                        n = spot_seen[stream][day]
                        res = spot[stream][day]
                        if len(res) < SPOT_N:
                            res.append(s.decode('utf-8'))
                        else:
                            j = rnd.randrange(n)
                            if j < SPOT_N:
                                res[j] = s.decode('utf-8')
                    if bot in mset_pick.get(day, ()):
                        mset[stream][f'{bot}|{day}'][f'{ts_ms(ts)}|{k}'] += 1
                files_read[stream].append({'path': path, 'lines': n_file})
        print(f'{dirbot} done {time.time() - t0:.0f}s', file=sys.stderr, flush=True)

    out = {
        'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'days': days, 'cutoff': cutoff, 'root': a.root,
        'walk_seconds': round(time.time() - t0, 1),
        'bots_dirs': [os.path.basename(d) for d in botdirs],
        'rows_day': {s: dict(rows_day[s]) for s in STREAMS},
        'counts': {s: {f'{b}|{d}': dict(h) for (b, d), h in counts[s].items()} for s in STREAMS},
        'minutes': {s: {f'{b}|{m}': n for (b, m), n in minutes[s].items()} for s in STREAMS},
        'kinds': {s: {d: dict(c) for d, c in kinds[s].items()} for s in STREAMS},
        'census': {s: {p: dict(c) for p, c in census[s].items()} for s in STREAMS},
        'census_day': {s: {p: dict(c) for p, c in census_day[s].items()} for s in STREAMS},
        'census_num': census_num,
        'census_strmax': {s: dict(census_strmax[s]) for s in STREAMS},
        'bad': {s: dict(bad[s]) for s in STREAMS},
        'bad_examples': bad_examples,
        'bad_by_file': {s: dict(bad_by_file[s]) for s in STREAMS},
        'dir_mismatch': {s: dict(dir_mismatch[s]) for s in STREAMS},
        'out_of_window': {s: dict(out_of_window[s]) for s in STREAMS},
        'newest': newest,
        'multiset_pick': mset_pick,
        'files_read': {s: len(files_read[s]) for s in STREAMS},
        'lines_read': {s: sum(f['lines'] for f in files_read[s]) for s in STREAMS},
    }
    with open(f'{a.out}/files.json', 'w') as fh:
        json.dump(out, fh)
    with open(f'{a.out}/multiset.json', 'w') as fh:
        json.dump({s: {k: dict(v) for k, v in mset[s].items()} for s in STREAMS}, fh)
    if not a.no_spot:
        for s in STREAMS:
            with open(f'{a.out}/spot-{s}.jsonl', 'w') as fh:
                for day in days:
                    for row in spot[s][day]:
                        fh.write(json.dumps({'day': day, 'row': row}) + '\n')
    print(json.dumps({'rows_day': out['rows_day'], 'bad': out['bad'],
                      'walk_seconds': out['walk_seconds']}, indent=1))


if __name__ == '__main__':
    main()
