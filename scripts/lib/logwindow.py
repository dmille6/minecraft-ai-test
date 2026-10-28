"""logwindow.py -- a FULL walk of one window of the bot skill logs, rotation-aware, through lib.telemetry.Events.

The logs rotate daily at ~23:59Z (copytruncate): day D's rows live in skill-<bot>.jsonl-<D+1>.gz and the live file starts
at ~23:59Z. A read of the live files alone silently drops everything before the last rotation (scoreboard.py, found
10-04: a 6 h window walked 58k rows instead of ~290k). Loading the whole `skill-*.jsonl*` glob instead trips telemetry's
WalkTooWide cap on the fleet host (14 rotated generations x 80 bots). So: the live files plus exactly the rotated files
whose tag can hold the window, each through Events.load (which skips files whose mtime predates the window), de-duplicated
on (t, bot, kind, detail).
"""
import datetime as dt
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib.telemetry import Events  # noqa: E402

DEFAULT_ROOT = '/var/log/mcai'


def window_globs(root, since, until, bots='*'):
    """The globs a window needs: live files, and the rotated tag of every day from since's to until's, plus one."""
    out = [os.path.join(root, bots, 'skill-*.jsonl')]
    d = since.date()
    while d <= until.date() + dt.timedelta(days=1):
        out.append(os.path.join(root, bots, 'skill-*.jsonl-%s.gz' % d.strftime('%Y%m%d')))
        d += dt.timedelta(days=1)
    return out


def load_window(since, until, root=DEFAULT_ROOT, bots='*'):
    """-> Events over [since, until), rows sorted by time. Raises telemetry's ZeroLooksWrong only for a future window."""
    rows, seen, newest_any = [], set(), None
    for g in window_globs(root, since, until, bots):
        if not glob.glob(g):
            continue
        try:
            ev = Events.load(paths=g, since=since, until=until)
        except Exception as e:          # a window past a FILE's newest row is not past the fleet's; keep walking
            if type(e).__name__ == 'ZeroLooksWrong':
                continue
            raise
        for r in ev.rows:
            k = (r['t'], (r.get('bot') or {}).get('name'), r.get('name'), r.get('detail'))
            if k not in seen:
                seen.add(k)
                rows.append(r)
    rows.sort(key=lambda r: r['t'])
    ts = [r['t'] for r in rows]
    span = (max(ts) - min(ts)).total_seconds() / 3600 if len(ts) > 1 else 0.0
    return Events(rows, since, until, span)


def bot_hours(rows, slot_min=10, start=None):
    """ACTIVE bot-hours: distinct (bot, slot_min-minute slot) pairs holding >= 1 row, in hours. A bot that was down for
    half the window is not counted as a quiet one (fleetstatus's definition, at a finer grain for 60-minute windows).
    Slots are counted from `start` (the window's start; default the first row), so a 60-min window holds at most 6 per
    bot -- wall-clock slots would let a window that starts mid-slot count 7."""
    if not rows:
        return 0.0
    t0 = start or min(r['t'] for r in rows)
    pairs = set()
    for r in rows:
        b = (r.get('bot') or {}).get('name')
        if b:
            pairs.add((b, int((r['t'] - t0).total_seconds() // (slot_min * 60))))
    return len(pairs) * slot_min / 60.0
