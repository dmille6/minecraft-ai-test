#!/usr/bin/env python3
"""Behaviour tests for the DiskLow check in infra/backup/check-backup.py.

No network, no ES, no root. Run: python3 infra/backup/test_check_backup.py   (exit 1 on failure)

Each firing fixture has a twin that must NOT fire, and the real 09-23..10-20 series from
/var/log/mcai-monitor/backup-alarm.log is replayed to show when DiskLow would have spoken.
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('check_backup', os.path.join(HERE, 'check-backup.py'))
CB = importlib.util.module_from_spec(spec)
spec.loader.exec_module(CB)

GB = 1e9
DAY = 86400
PASS = FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print(f'  ok   {name}')
    except Exception as e:
        FAIL += 1
        print(f'  FAIL {name}: {type(e).__name__}: {e}')


def series(now, days, total, used_now, gb_per_day, step_h=1):
    """Hourly samples ending at `now`, used bytes growing linearly."""
    h, t = [], now - days * DAY
    while t <= now:
        h = CB.update_history(h, t, used_now - (now - t) / DAY * gb_per_day * GB, total)
        t += step_h * 3600
    return h


def evaluate(hist, now, total, **kw):
    used = hist[-1][1]
    rate, why, span = CB.growth_per_day(hist, now)
    return CB.disk_low('/', 100 * used / total, used, total, rate, why, span, **kw)


NOW = 1_800_000_000


def t_level_fires_above_75():
    h = series(NOW, 7, 500 * GB, 380 * GB, 0.0)          # 76%, flat
    alarms, note, s = evaluate(h, NOW, 500 * GB)
    assert len(alarms) == 1 and alarms[0].startswith('DiskLow: / is 76.0% used'), alarms
    assert s['days_to_proj_pct'] is None                 # flat: no projection


def t_level_quiet_at_74():
    h = series(NOW, 7, 500 * GB, 370 * GB, 0.0)          # 74%
    alarms, _, _ = evaluate(h, NOW, 500 * GB)
    assert alarms == [], alarms


def t_projection_fires_inside_14_days():
    # 60% of 500 GB, +10 GB/day: 85% (425 GB) is 125 GB away = 12.5 days
    h = series(NOW, 7, 500 * GB, 300 * GB, 10.0)
    alarms, _, s = evaluate(h, NOW, 500 * GB)
    assert len(alarms) == 1 and 'projected to cross 85% in 12.5 days' in alarms[0], alarms
    assert abs(s['growth_gb_per_day'] - 10.0) < 0.01 and abs(s['days_to_proj_pct'] - 12.5) < 0.05, s


def t_projection_quiet_beyond_14_days():
    # the same disk at +8 GB/day: 15.6 days -- outside the horizon
    h = series(NOW, 7, 500 * GB, 300 * GB, 8.0)
    alarms, note, s = evaluate(h, NOW, 500 * GB)
    assert alarms == [] and 15.5 < s['days_to_proj_pct'] < 15.7, (alarms, s)
    assert '85% in 16 d' in note, note


def t_todays_disk_is_quiet():
    # 10-20 after the grow: ~27% of 526 GB at ~1.5 GB/day -> ~200 days
    h = series(NOW, 7, 526 * GB, 143 * GB, 1.5)
    alarms, note, s = evaluate(h, NOW, 526 * GB)
    assert alarms == [] and s['days_to_proj_pct'] > 150, (alarms, s)


def t_too_little_history_says_so():
    h = series(NOW, 0.5, 500 * GB, 300 * GB, 50.0)        # 12 h of a fast fill
    alarms, note, s = evaluate(h, NOW, 500 * GB)
    assert alarms == [] and s['growth_gb_per_day'] is None, (alarms, s)
    assert 'growth rate not yet known' in note and 'need 24 h' in note, note


def t_regrow_is_not_a_negative_rate():
    # used bytes keep growing 2 GB/day while total jumps 100 GB -> 500 GB mid-window:
    # a percent-based rate would read about -16 %/day; the byte fit reads +2 GB/day
    h = []
    for i in range(7 * 24 + 1):
        t = NOW - 7 * DAY + i * 3600
        total = 100 * GB if i < 100 else 500 * GB
        h = CB.update_history(h, t, 80 * GB + (i / 24) * 2 * GB, total)
    rate, why, span = CB.growth_per_day(h, NOW)
    assert why is None and abs(rate / GB - 2.0) < 0.01, (rate, why)


def t_one_spike_does_not_set_the_rate():
    # flat disk with a single +20 GB sample at the end (a snapshot in flight)
    h = series(NOW - 3600, 7, 500 * GB, 200 * GB, 0.0)
    h = CB.update_history(h, NOW, 220 * GB, 500 * GB)
    rate, _, _ = CB.growth_per_day(h, NOW)
    assert rate / GB < 0.5, rate / GB                     # two endpoints would say +2.9 GB/day


def t_history_is_pruned_to_8_days():
    h = series(NOW, 12, 500 * GB, 300 * GB, 1.0)
    assert NOW - h[0][0] <= 8 * DAY and len(h) <= 8 * 24 + 1, (NOW - h[0][0], len(h))


def t_replay_of_the_real_series():
    """The hourly 'repo disk N%' readings 09-23..10-20 from backup-alarm.log (same filesystem as /,
    integer percent by shutil, so ~4 pp UNDER what ES counted). Replayed through the same code,
    DiskLow speaks well before the 10-19 23:16Z flood stage: the projection first, then the level."""
    rows = [x.split('\t') for x in open(os.path.join(HERE, 'fixtures', 'elk-disk-pct-2026-09-23_10-20.tsv'))]
    total = 100 * GB
    h, first_proj, first_level, on_since, prev = [], None, None, None, False
    for ts, pct in rows:
        t = dt.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp()
        used = int(pct) / 100 * total
        h = CB.update_history(h, t, used, total)
        rate, why, span = CB.growth_per_day(h, t)
        alarms, _, _ = CB.disk_low('/', int(pct), used, total, rate, why, span)
        if any('projected' in a for a in alarms) and not first_proj:
            first_proj = ts
        if any('% used' in a for a in alarms) and not first_level:
            first_level = ts
        if alarms and not prev:
            on_since = ts
        prev = bool(alarms)
    assert len(rows) > 600, len(rows)
    assert first_level and first_level < '2026-10-10', first_level      # 76% on ~10-09
    assert first_proj and first_proj < '2026-10-08', first_proj
    assert prev and on_since < '2026-10-06', on_since          # and never went quiet again
    print(f'       replay: projection first fires {first_proj}, continuously from {on_since}, '
          f'level from {first_level} (flood was 2026-10-19T23:16Z)')


def run_main(args, pct_used, hist):
    """main() end to end with ES, statvfs and the publisher stubbed. Returns (rc, stdout, published)."""
    total = 500 * GB
    published = []
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, 'state', 'disk.json')
        os.makedirs(os.path.dirname(state))
        json.dump(hist, open(state, 'w'))
        snaps = {'snapshots': [{'state': 'SUCCESS', 'end_time_in_millis': (CB.time.time() - 3600) * 1000}]}
        pol = {CB.POLICY: {'stats': {}, 'invocations_since_last_success': 0}}
        real = (CB.es, CB.es_used_pct, CB.publish_status)
        CB.es = lambda path, **k: (snaps, None) if 'snapshot' in path else (pol, None)
        CB.es_used_pct = lambda path: (pct_used, pct_used / 100 * total, total)
        CB.publish_status = lambda s: published.append(s) or None
        out = io.StringIO()
        try:
            sys.argv = ['check-backup', '--repo-dir', d, '--disk-state', state] + args
            with contextlib.redirect_stdout(out):
                rc = CB.main()
        finally:
            CB.es, CB.es_used_pct, CB.publish_status = real
        saved = json.load(open(state))
    return rc, out.getvalue(), published, saved


def t_main_prints_disklow_and_publishes():
    now = CB.time.time()
    hist = series(now - 3600, 7, 500 * GB, 375 * GB, 0.0)
    rc, out, pub, saved = run_main([], 76.0, hist)
    assert rc == 1 and '!! DiskLow: / is 76.0% used' in out, out
    assert len(pub) == 1 and pub[0]['alarms'] and pub[0]['host'] and pub[0]['@timestamp'], pub
    assert len(saved) == len(hist) + 1, (len(saved), len(hist))


def t_main_quiet_disk_is_ok_with_a_rate():
    now = CB.time.time()
    hist = series(now - 3600, 7, 500 * GB, 135 * GB, 1.5)
    rc, out, pub, _ = run_main([], 27.0, hist)
    assert rc == 0 and 'backups OK' in out and 'DiskLow' not in out, out
    assert 'GB/day' in out and pub[0]['alarms'] == [], (out, pub)


def t_main_no_publish_flag():
    rc, out, pub, _ = run_main(['--no-publish'], 27.0, [])
    assert pub == [] and 'growth rate not yet known' in out, (pub, out)


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print(f'{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
