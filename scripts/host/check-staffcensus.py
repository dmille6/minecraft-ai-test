#!/usr/bin/env python3
"""StaffCensusStale -- alarm when S0 (staffcensus.py --tick) stops, errors, goes blind, or stops writing slots.

Same design as check-world-backup.py: the primary metric is the AGE OF THE NEWEST GOOD HEARTBEAT, read from the
census's own heartbeat.jsonl, so a broken check (file gone, unreadable, renamed) can only alarm, never read healthy.
Why it exists: the shadow mayor hit its own output cap on 10-13 and was believed to be recording for 5.6 days. A dead
census must read VOID, not zero (overseer-assigner design r3, section 6).

GOOD means MEASURED: a tick line with status ok that wrote at least one non-void slot row. A tick that ran but measured
nothing (idle: no new slot; void: every row void; locked; error) never refreshes it.

  1. no heartbeat file, or no line from the standing census (mode=tick)  -> StaffCensusMissing
  2. the newest tick line is older than --max-age-min (default 15)        -> StaffCensusStale
  3. the newest MEASURING tick is older than --max-age-min                -> StaffCensusStale (it runs but measures nothing)
  4. the newest tick's status is error / selftest_failed                  -> StaffCensusError
  5. the newest tick is all void, or the newest measuring tick has half
     or more of its rows void (ES gap, silent towns, a blind track)       -> StaffCensusVoid
  6. the newest recorded slot is older than --behind-min (default 35)     -> StaffCensusBehind (ticking, writing nothing)
     (a healthy census lags up to ~25 min: the 10-min tick settle + the 5-min slot + the 5-min cron period)
  7. the file cannot be read                                              -> StaffCensusMissing
  8. the newest capability positive control (B0a) is below 95%            -> StaffCensusCapability (an alarm, not a void)

Ad-hoc runs (--window / --report) write heartbeat lines too; they are NOT the standing census and never count as fresh.
Self-contained (no imports from staffcensus.py), so a broken census cannot break its own alarm. Its cases are exercised
by `staffcensus.py --selftest`. Output lines match check-world-backup.py ('... ALARM (n):' / '  !! ...').
Exit 0 healthy, 1 alarm.
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import time  # noqa: E402

BAD = ('error', 'selftest_failed')
VOID_SHARE = 0.5


def _age_min(stamp, now):
    t = dt.datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).timestamp()
    return (now - t) / 60.0


def measured(r):
    return r.get('status') == 'ok' and (r.get('slots_written') or 0) > (r.get('void_rows') or 0)


def assess(lines, now, max_age_min=15.0, behind_min=35.0):
    """heartbeat.jsonl lines -> (alarms, notes). Pure (now = epoch seconds)."""
    alarms, notes = [], []
    recs = []
    for ln in lines:
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get('mode') == 'tick' and r.get('at'):
            recs.append(r)
    if not recs:
        return ['StaffCensusMissing: no heartbeat from the standing census (mode=tick) -- it has never run, '
                'or its heartbeat file is elsewhere'], notes
    last = recs[-1]
    good = [r for r in recs if measured(r)]
    try:
        age = _age_min(last['at'], now)
        notes.append(f'newest tick {age:.1f} min ago ({last.get("status")})')
        if age > max_age_min:
            alarms.append(f'StaffCensusStale: the newest tick is {age:.1f} min old (limit {max_age_min:g} min)')
    except ValueError:
        alarms.append(f'StaffCensusStale: unparseable heartbeat time {last.get("at")!r}')
    if last.get('status') in BAD:
        alarms.append(f'StaffCensusError: the newest tick ended {last.get("status")}: {str(last.get("error"))[:200]}')
    if last.get('status') == 'void':
        alarms.append(f'StaffCensusVoid: every one of the newest tick\'s {last.get("slots_written")} rows is void -- '
                      f'the census is running blind')
    if not good:
        alarms.append('StaffCensusStale: no tick has ever measured anything (status ok with a non-void row)')
    else:
        g = good[-1]
        try:
            gage = _age_min(g['at'], now)
            if gage > max_age_min:
                later = sorted({str(r.get('status')) for r in recs[recs.index(g) + 1:]})
                alarms.append(f'StaffCensusStale: the newest MEASURING tick is {gage:.1f} min old (limit {max_age_min:g} '
                              f'min); later ticks ended {later}')
        except ValueError:
            alarms.append(f'StaffCensusStale: unparseable heartbeat time {g.get("at")!r}')
        n, v = g.get('slots_written') or 0, g.get('void_rows') or 0
        notes.append(f'newest measuring tick: {v} of {n} rows void')
        if n and v / n >= VOID_SHARE:
            alarms.append(f'StaffCensusVoid: {v} of {n} rows of the newest measuring tick are void '
                          f'(limit {100 * VOID_SHARE:.0f}%)')
    # B0a: the capability positive control (`_townindex_mode` over the bots whose build carries it) is an ALARM, never a
    # census void: a shortfall means the capability reader (or the fleet) is wrong, and every record_without_code is suspect
    # read from the newest MEASURING tick only (Claude r1 P3-9: an error tick must not fall back to an older OK control)
    cc = good[-1].get('capability_control') if good else None
    if good and cc is None:
        alarms.append('StaffCensusCapability: the newest measuring tick carries no capability control')
    if cc and cc.get('alarm') and not cc.get('eligible'):
        alarms.append(f'StaffCensusCapability: {cc.get("present")} bots present, none eligible -- the capability control '
                      f'could not be evaluated')
    elif cc and cc.get('alarm'):
        alarms.append(f'StaffCensusCapability: only {cc.get("capable")} of {cc.get("eligible")} bots whose build carries '
                      f'townindex read capable (share {cc.get("share")}, limit 0.95) -- the capability reader is suspect')
    newest = next((r.get('newest_slot') for r in reversed(recs) if r.get('newest_slot')), None)
    if newest is None:
        alarms.append('StaffCensusBehind: no tick has recorded a slot yet')
    else:
        try:
            lag = _age_min(newest, now)
            notes.append(f'newest slot {newest} ({lag:.0f} min)')
            if lag > behind_min:
                alarms.append(f'StaffCensusBehind: the newest recorded slot {newest} is {lag:.0f} min old '
                              f'(limit {behind_min:g} min) -- ticking but writing nothing')
        except ValueError:
            alarms.append(f'StaffCensusBehind: unparseable newest_slot {newest!r}')
    return alarms, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.expanduser('~/staffcensus/out'))
    ap.add_argument('--max-age-min', type=float, default=15.0)
    ap.add_argument('--behind-min', type=float, default=35.0)
    a = ap.parse_args()
    path = os.path.join(a.dir, 'heartbeat.jsonl')
    try:
        with open(path) as f:
            lines = f.readlines()[-500:]
        alarms, notes = assess(lines, time.time(), a.max_age_min, a.behind_min)
    except OSError as e:
        alarms, notes = [f'StaffCensusMissing: cannot read {path} ({type(e).__name__}: {e})'], []
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if alarms:
        print(f'{stamp} STAFFCENSUS ALARM ({len(alarms)}):')
        for x in alarms:
            print(f'  !! {x}')
        print(f'  context: {"; ".join(notes) or "none"}')
        return 1
    print(f'{stamp} staff census OK -- {"; ".join(notes)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
