#!/usr/bin/env python3
"""effectcache.py -- the hourly per-(bot, hour, build) cache that effectwatch.py and the busy-time line read (effectwatch-01).

    effectcache.py build [--from ISO] [--to ISO] [--rebuild] [--root /var/log/mcai] [--out ~/effectwatch/cache]

One gzip JSON per finished UTC hour: {hour, built_at, cell_schema, bots: {bot: {build: cell}}, controls}. A cell
(lib/effectmetrics.new_cell) holds the counts every registered metric needs -- skill rows by name|status, fail classes,
DETAIL_KEYS, durations, items gained, the decision stream (calls, latency, prompt tokens, schema-valid, veto reasons,
triggers, models) -- and the busy-time seconds per class (lib/busytime.classify), so a 72-h window is a sum of
80 x 72 small cells instead of a 6-GB walk.

HOW IT READS. lib/telemetry.stream_rows, one bot at a time, both streams, rotated .gz generations included, whole files
(the prefix test only skips lines outside the window). Rows are read with a margin (30 min before, 15 min after the
chunk) so a skill that started before the hour and the rows that prove the bot was up at each edge are seen.

WHEN AN HOUR IS FINAL. Skill rows are written at their END but stamped with their START, so the newest hour is incomplete
on disk; an hour is built only when it ended at least FINAL_AFTER ago. A built hour is never rewritten without --rebuild.

POSITIVE CONTROLS (per hour, in `controls`): bot directories seen, bots with rows, skill rows, llm rows. effectwatch
refuses a window with a missing hour, and treats an hour with rows from fewer than half the bot directories as a hole.
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import busytime as BT          # noqa: E402
from lib import effectmetrics as EM     # noqa: E402
from lib import telemetry as TM         # noqa: E402

UTC = dt.timezone.utc
ROOT = '/var/log/mcai'
OUT = '~/effectwatch/cache'
FINAL_AFTER = dt.timedelta(hours=2)
MARGIN_BEFORE = dt.timedelta(minutes=30)
MARGIN_AFTER = dt.timedelta(minutes=15)


def ep(t):
    return t.timestamp()


def hour_path(out, h):
    return os.path.join(os.path.expanduser(out), h.strftime('%Y%m%dT%H') + '.json.gz')


def bots_in(root):
    return sorted(d for d in os.listdir(root) if not d.startswith('_') and os.path.isdir(os.path.join(root, d)))


def build_of(row):
    return str((row.get('code') or {}).get('version') or '-').split('+')[0]


def pool_of(row):
    return str((row.get('exp') or {}).get('pool') or '-')


def bot_cells(srows, lrows, hours):
    """PURE. srows / lrows: [(t, raw)] for one bot, any order, spanning the hours plus margins. hours: [hour start].
    -> {hour: {build: cell}}."""
    srows = sorted(srows, key=lambda x: x[0])
    lrows = sorted(lrows, key=lambda x: x[0])
    skills, pauses, deaths, stamps, marks = [], [], [], [], []
    for t, r in srows:
        sk = r.get('skill') or {}
        n = sk.get('name')
        if not n:
            continue
        e = ep(t)
        stamps.append(e)
        marks.append((e, build_of(r), pool_of(r)))
        iv = BT.skill_interval(e, n, sk.get('duration_ms'))
        if iv:
            skills.append(iv)
        if n == '_decision_skipped':
            ps = BT.pause_seconds(sk.get('detail'))
            if ps:
                pauses.append((e, ps))
        if n == '_death':
            deaths.append(e)
    llms = []
    for t, r in lrows:
        e = ep(t)
        stamps.append(e)
        marks.append((e, build_of(r), pool_of(r)))
        if not EM.is_model_call(r):       # a work-order row: the loop ticked, no model call (no llm_wait interval)
            continue
        try:
            lat = float((r.get('llm') or {}).get('latency_ms') or 0) / 1000.0
        except (TypeError, ValueError):
            lat = 0.0
        llms.append((e, lat))
    marks.sort()
    out = {}
    for h in hours:
        a, b = ep(h), ep(h + dt.timedelta(hours=1))
        cells = {}

        def cell(build, pool):
            if build not in cells:
                cells[build] = EM.new_cell(pool)
            return cells[build]
        for t, r in srows:
            if h <= t < h + dt.timedelta(hours=1):
                EM.add_skill_row(cell(build_of(r), pool_of(r)), r)
        for t, r in lrows:
            if h <= t < h + dt.timedelta(hours=1):
                EM.add_llm_row(cell(build_of(r), pool_of(r)), r)
        # busy seconds per build: the hour is cut where the bot's build changes (a restart onto a promotion); each piece
        # belongs to the build of the newest row at or before its start (the first row's build before any row)
        inside = [(e, bl, pl) for e, bl, pl in marks if a <= e < b]
        before = [(e, bl, pl) for e, bl, pl in marks if e < a]
        cur = (before[-1][1], before[-1][2]) if before else ((inside[0][1], inside[0][2]) if inside else None)
        pieces, x = [], a
        for e, bl, pl in inside:
            if cur is not None and bl != cur[0]:
                pieces.append((x, e, cur))
                x = e
            cur = (bl, pl)
        if cur is not None:
            pieces.append((x, b, cur))
        for x, y, (bl, pl) in pieces:
            sec = BT.classify(x, y, skills, llms, pauses, deaths, stamps)
            c = cell(bl, pl)
            for k, v in sec.items():
                c['busy'][k] = c['busy'].get(k, 0.0) + v
        if not pieces:                 # no row anywhere near this hour: the whole hour is unobserved, on no build
            pass
        out[h] = cells
    return out


def build_chunk(root, hours, bots=None):
    """-> {hour: {'bots': {bot: {build: cell}}, 'controls': {...}}} for consecutive hours, one bot at a time."""
    bots = bots or bots_in(root)
    lo, hi = hours[0] - MARGIN_BEFORE, hours[-1] + dt.timedelta(hours=1) + MARGIN_AFTER
    res = {h: {'bots': {}, 'controls': {'bot_dirs': len(bots), 'bots_with_rows': 0, 'skill_rows': 0, 'llm_rows': 0}}
           for h in hours}
    for bot in bots:
        s = list(TM.stream_rows(root, bot, lo, hi, 'skill'))
        l_ = list(TM.stream_rows(root, bot, lo, hi, 'llm'))
        per = bot_cells(s, l_, hours)
        for h, cells in per.items():
            if not cells:
                continue
            res[h]['bots'][bot] = cells
            n_s = sum(c['rows'] for c in cells.values())
            n_l = sum(c['llm']['n'] for c in cells.values())
            if n_s or n_l:
                res[h]['controls']['bots_with_rows'] += 1
            res[h]['controls']['skill_rows'] += n_s
            res[h]['controls']['llm_rows'] += n_l
        del s, l_
    return res


def write_hour(out, h, data, now):
    p = hour_path(out, h)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    obj = {'hour': h.strftime('%Y-%m-%dT%H:00:00Z'), 'built_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
           'cell_schema': EM.CELL_SCHEMA, 'bots': data['bots'], 'controls': data['controls']}
    with gzip.open(p + '.tmp', 'wt') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(p + '.tmp', p)


def load_hour(out, h):
    """-> the hour's object, or None when absent / unreadable / an older cell schema."""
    try:
        with gzip.open(hour_path(out, h), 'rt') as f:
            d = json.load(f)
    except (OSError, ValueError, EOFError):
        return None
    return d if d.get('cell_schema') == EM.CELL_SCHEMA else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['build'])
    ap.add_argument('--from', dest='frm')
    ap.add_argument('--to')
    ap.add_argument('--rebuild', action='store_true')
    ap.add_argument('--root', default=ROOT)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--days-back', type=float, default=2.0, help='without --from: hours this far back are filled if missing')
    a = ap.parse_args(argv)
    import fcntl
    os.makedirs(os.path.expanduser(a.out), exist_ok=True)
    lock = open(os.path.join(os.path.expanduser(a.out), '.build.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)      # the cron and a hand backfill never build the same hour
    except OSError:
        print(f'{dt.datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} effectcache BUSY: another build holds the lock; nothing done')
        return
    now = dt.datetime.now(UTC)
    last = (now - FINAL_AFTER).replace(minute=0, second=0, microsecond=0)        # hours < last are final
    to = min(last, dt.datetime.fromisoformat(a.to.replace('Z', '+00:00'))) if a.to else last
    frm = (dt.datetime.fromisoformat(a.frm.replace('Z', '+00:00')) if a.frm
           else now - dt.timedelta(days=a.days_back)).replace(minute=0, second=0, microsecond=0)
    hours, h = [], frm
    while h < to:
        if a.rebuild or load_hour(a.out, h) is None:
            hours.append(h)
        h += dt.timedelta(hours=1)
    # consecutive runs of missing hours, built a UTC day at a time (one bot-day of rows in memory at once)
    runs, cur = [], []
    for h in hours:
        if cur and (h - cur[-1] != dt.timedelta(hours=1) or h.date() != cur[-1].date()):
            runs.append(cur)
            cur = []
        cur.append(h)
    if cur:
        runs.append(cur)
    built = 0
    for r in runs:
        t0 = dt.datetime.now(UTC)
        res = build_chunk(a.root, r)
        for h in r:
            write_hour(a.out, h, res[h], dt.datetime.now(UTC))
            built += 1
        c = res[r[0]]['controls']
        print(f'{dt.datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} built {r[0]:%m-%dT%H}..{r[-1]:%H} ({len(r)} h) in '
              f'{(dt.datetime.now(UTC) - t0).total_seconds():.0f} s; first hour: {c["bots_with_rows"]}/{c["bot_dirs"]} bots, '
              f'{c["skill_rows"]:,} skill rows, {c["llm_rows"]:,} llm rows', flush=True)
    print(f'{dt.datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} effectcache OK: {built} hour(s) built, final through {to:%m-%dT%H}Z')


if __name__ == '__main__':
    main()
