#!/usr/bin/env python3
"""FrontierStale -- alarm when E0 (frontiercensus.py --tick) stops, errors, goes blind, falls behind, or stops publishing.

The staffcensus pattern: the primary metric is the AGE OF THE NEWEST GOOD HEARTBEAT, read from the census's own
heartbeat.jsonl, so a broken check (file gone, unreadable, renamed) can only alarm, never read healthy. A dead or blind
census reads VOID, never zero (expansion plan section 4).

The census folds whole UTC hours 10 min after they end, so a healthy census's newest MEASURED hour (one ES held
positioned rows for) ended at most ~75 min ago.

  1. no heartbeat file, or no line from the standing census (mode=tick)       -> FrontierMissing
  2. the newest tick line is older than --max-age-min (default 15)             -> FrontierStale
  3. the newest tick ended error / selftest_failed                             -> FrontierError
  4. the newest tick is void (ES holds no positioned row for the newest hour)  -> FrontierVoid
  5. the newest tick failed an instrument check (a sampled region the fold
     lacks)                                                                    -> FrontierInstrument
  6. the newest measured hour ended more than --behind-min (default 135) ago   -> FrontierBehind
  6b. the newest tick left a town out (home conflict) or read fewer towns than
      within the last 24 h                                                     -> FrontierTownMissing
  6c. a town's world-facts file is unreadable (its ranking is withheld)        -> FrontierHazardUnread
  6d. warm-up complete (the heartbeat's own) and nothing staged for 30 min     -> FrontierNotStaging
  6e. warm-up complete and the publisher's newest result (publish.log, carried
      in the heartbeat) is missing, older than 15 min, or not `ok`             -> FrontierPublisher
  7. warm-up complete and a bundle entry is not the newest published
     generation 15 min after that CONTENT was first staged (digest_since), or
     a town's newest published generation is older than 135 min, or the
     bundle itself is missing                                                   -> FrontierPublishStale
  8. the file cannot be read                                                   -> FrontierMissing

A town that disappears (its `_pool-<pool>` dir gone, or swapped for another of the same count) is named by the tick
itself in home_problems ("gone: ...", from out/expected-towns.json) -> FrontierTownMissing.

Self-contained (no imports from frontiercensus.py), so a broken census cannot break its own alarm. Its cases are
exercised by `frontiercensus.py --selftest`. Exit 0 healthy, 1 alarm.
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402

BAD = ('error', 'selftest_failed')
NOT_STAGING_MIN = 30.0
PUBLISHER_MAX_AGE_MIN = 15.0
PUBLISHED_MAX_AGE_MIN = 135.0


def _t(stamp):
    return dt.datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).timestamp()


def assess(lines, now, max_age_min=15.0, behind_min=135.0):
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
        return ['FrontierMissing: no heartbeat from the standing census (mode=tick) -- it has never run, or its '
                'heartbeat file is elsewhere'], notes
    locked = 0
    while recs and recs[-1].get('status') == 'locked':      # a tick that found the lock held never ran: judge the
        recs.pop()                                          # newest tick that did (Claude r3 P2-1)
        locked += 1
    if locked:
        notes.append(f'{locked} newest ticks found the lock held')
    if not recs:
        return ['FrontierStale: every recent tick found the lock held -- a tick is hung'], notes
    last = recs[-1]
    try:
        age = (now - _t(last['at'])) / 60
        notes.append(f'newest tick {age:.1f} min ago ({last.get("status")})')
        if age > max_age_min:
            alarms.append(f'FrontierStale: the newest tick is {age:.1f} min old (limit {max_age_min:g} min)')
    except ValueError:
        alarms.append(f'FrontierStale: unparseable heartbeat time {last.get("at")!r}')
    st = last.get('status')
    if st in BAD:
        alarms.append(f'FrontierError: the newest tick ended {st}: {str(last.get("error"))[:200]}')
    if st == 'void':
        alarms.append(f'FrontierVoid: ES holds no positioned row for the newest settled hour (blind since '
                      f'{last.get("es_blind_since")}) -- the census reads VOID, not zero')
    if st == 'instrument':
        alarms.append(f'FrontierInstrument: {"; ".join(last.get("instrument") or [])[:300]}')
    newest = next((r.get('newest_measured_hour_end') for r in reversed(recs) if r.get('newest_measured_hour_end')), None)
    if newest is None:
        alarms.append('FrontierBehind: no tick has measured an hour yet')
    else:
        try:
            lag = (now - _t(newest)) / 60
            notes.append(f'newest measured hour ended {newest} ({lag:.0f} min)')
            if lag > behind_min:
                alarms.append(f'FrontierBehind: the newest measured hour ended {newest}, {lag:.0f} min ago (limit '
                              f'{behind_min:g} min)')
        except ValueError:
            alarms.append(f'FrontierBehind: unparseable newest_measured_hour_end {newest!r}')
    if last.get('backlog_hours'):
        notes.append(f'backlog {last["backlog_hours"]} hours (catching up)')
    if last.get('home_problems'):
        alarms.append(f'FrontierTownMissing: towns left out: {last["home_problems"]}')
    most = max((r.get('towns') or 0 for r in recs[-288:]), default=0)
    if last.get('towns') is not None and last['towns'] < most:
        alarms.append(f'FrontierTownMissing: the newest tick read {last["towns"]} towns, {most} within the last 24 h')
    if last.get('site_errors'):
        alarms.append(f'FrontierHazardUnread: world-facts unreadable, ranking withheld: {last["site_errors"]}')
    wu = last.get('warmup') if isinstance(last.get('warmup'), dict) else {}
    lp0 = last.get('last_publish') if isinstance(last.get('last_publish'), dict) else {}
    if lp0.get('unusable'):                 # the publisher's rehearsal, during warm-up too (Claude r3 P2-3)
        alarms.append(f'FrontierPublisher: pool dirs the publisher cannot write: {json.dumps(lp0["unusable"])[:240]}')
    if wu.get('complete'):
        ls = last.get('last_staged_at')
        try:
            lag = (now - _t(ls)) / 60 if ls else None
        except ValueError:
            lag = None
        if lag is None or lag > NOT_STAGING_MIN:
            alarms.append(f'FrontierNotStaging: warm-up complete but nothing staged since {ls} (withheld: '
                          f'{str(last.get("withheld"))[:160]})')
        lp = last.get('last_publish') if isinstance(last.get('last_publish'), dict) else None
        try:
            page = (now - _t(lp['at'])) / 60 if lp and lp.get('at') else None
        except ValueError:
            page = None
        if lp is None or page is None or page > PUBLISHER_MAX_AGE_MIN or lp.get('status') != 'ok':
            alarms.append(f'FrontierPublisher: warm-up complete but the publisher\'s newest result is '
                          f'{json.dumps(lp)[:240] if lp else "missing"}'
                          + (f' ({page:.0f} min old)' if page is not None else ''))
        notes.append('warm-up complete')
    elif wu.get('complete_at'):
        notes.append(f'warm-up ends {wu["complete_at"]}')
    return alarms, notes


def assess_publish(out_dir, state_dir, now, warm, grace_min=15.0):
    """The bundle's entries must be the newest published generations once the census is warm (warm comes from the
    HEARTBEAT, never from the staged docs: Claude r2 P2-3). -> (alarms, notes)."""
    alarms, notes = [], []
    if not warm:
        return alarms, ['warm-up not complete: nothing published yet (by design)']
    path = os.path.join(out_dir, 'publish', 'bundle.json')
    try:
        with open(path) as fh:
            b = json.load(fh)
        entries = b['entries']
    except (OSError, ValueError, KeyError, TypeError) as e:
        return [f'FrontierPublishStale: warm, but the bundle {path} is unreadable ({type(e).__name__})'], notes
    pub = 0
    for e in entries:
        pool, key, doc = e.get('pool'), e.get('key'), e.get('doc') or {}
        d = os.path.join(state_dir, f'_pool-{pool}')
        rx = re.compile(rf'^{re.escape(str(key))}\.g(\d+)\.json$')
        try:
            gens = sorted(int(m.group(1)) for m in (rx.match(x) for x in os.listdir(d)) if m)
        except OSError as ex:
            alarms.append(f'FrontierPublishStale: {pool}: cannot list {d} ({type(ex).__name__})')
            continue
        cur = None
        if gens:
            try:
                with open(os.path.join(d, f'{key}.g{gens[-1]}.json')) as fh:
                    cur = json.load(fh)
            except (OSError, ValueError):
                cur = None
        try:                    # the publisher's own clock: a generation this old means it has stopped
            cage = (now - _t(cur['generated_at'])) / 60 if cur else None
        except (KeyError, TypeError, ValueError):
            cage = None
        if cur is None or cage is None or cage > PUBLISHED_MAX_AGE_MIN:
            alarms.append(f'FrontierPublishStale: {pool}: the newest published generation '
                          f'g{gens[-1] if gens else 0} is ' + (f'{cage:.0f} min old' if cage is not None else 'missing'))
            continue
        if cur.get('digest') == doc.get('digest'):
            pub += 1
            continue
        try:                    # since this CONTENT was first staged (re-stamping every tick does not reset it)
            age = (now - _t(doc.get('digest_since') or doc['generated_at'])) / 60
        except (KeyError, ValueError, TypeError):
            age = 1e9
        if age > grace_min:
            alarms.append(f'FrontierPublishStale: {pool}: the frontier staged {age:.0f} min ago (data to '
                          f'{doc.get("data_until")}) is not published (newest generation g{gens[-1]})')
    notes.append(f'published current {pub} of {len(entries)} staged towns'
                 + (f' (bundle withheld: {str(b.get("withheld"))[:120]})' if b.get('withheld') else ''))
    return alarms, notes


def warm_of(lines):
    """Is the standing census warm, by its NEWEST tick line's own warm-up? Pure."""
    for ln in reversed(lines):
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get('mode') == 'tick' and r.get('status') != 'locked':
            return bool((r.get('warmup') or {}).get('complete')) if isinstance(r.get('warmup'), dict) else False
    return False


def tail_lines(path, n=600, tail_bytes=1 << 20):
    """The newest n lines, read from the end (the file grows by a line every 5 min; never read it whole)."""
    with open(path, 'rb') as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - tail_bytes))
        data = f.read().decode('utf-8', 'replace').split('\n')
    if size > tail_bytes:
        data = data[1:]
    return [ln for ln in data if ln][-n:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.expanduser('~/frontiercensus/out'))
    ap.add_argument('--state-dir', default='/var/lib/mcai')
    ap.add_argument('--max-age-min', type=float, default=15.0)
    ap.add_argument('--behind-min', type=float, default=135.0)
    a = ap.parse_args()
    path = os.path.join(a.dir, 'heartbeat.jsonl')
    now = time.time()
    warm = False
    try:
        lines = tail_lines(path)
        alarms, notes = assess(lines, now, a.max_age_min, a.behind_min)
        warm = warm_of(lines)
    except OSError as e:
        alarms, notes = [f'FrontierMissing: cannot read {path} ({type(e).__name__}: {e})'], []
    pa, pn = assess_publish(a.dir, a.state_dir, now, warm)
    alarms += pa
    notes += pn
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if alarms:
        print(f'{stamp} FRONTIERCENSUS ALARM ({len(alarms)}):')
        for x in alarms:
            print(f'  !! {x}')
        print(f'  context: {"; ".join(notes) or "none"}')
        return 1
    print(f'{stamp} frontier census OK -- {"; ".join(notes)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
