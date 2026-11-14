#!/usr/bin/env python3
r"""stopwatch.py -- the STOPPED-WORKING ALARM (OWNER 2026-11-14: "lets make changes to clean up this test, implement, stage,
queue, fix loop we have").

WHY. LIVE showcase 11-13: the junk well went from 8-15 successful throws an hour to 0 of 124 at 18:12Z and nobody saw it for
five hours; it was found because building looked slow. Two correct rules had composed into a dead end (a tidy cut plus the
clean zone). Every one-hour read that day looked at its own piece's rows and called a KEEP. Nothing asked the one question
that would have paged in the first hour: WHAT WORKED YESTERDAY AND DOES NOT WORK NOW?

WHAT IT WATCHES. Every thing the bots do that the logs name:
  skill:<name>    a skill run (a row whose kind does not start with `_`); it WORKED when status is success
  order:<skill>   a scheduler work order (`_work_order`, its first word); it only has a count
Two windows: CUR, the last CUR_H (2) hours, and BASE, the BASE_H (24) hours before it.

THE THREE VERDICTS, each with its denominator in the line:
  stopped:<key>    BASE worked (>= BASE_OK successes at a rate >= BASE_RATE) and CUR was tried (>= CUR_TRIES runs by >=
                   CUR_BOTS bots) and NOT ONE worked -- or, sooner, BASE worked at least half the time and the LAST
                   STREAK_TRIES runs in CUR, by >= STREAK_BOTS bots, all failed (the well: 12 failures in a row by 18:55Z,
                   while the 2-h window still held its last successes until 20:11Z). PAGES. The line carries the last
                   success and the commonest failure.
  collapsed:<key>  BASE worked and CUR works at less than a third of BASE's rate over >= COLLAPSE_TRIES runs. Digest.
  vanished:<key>   BASE ran it in >= VANISH_HOURS of its hours, >= VANISH_PER_H an hour, and CUR never ran it. Digest (a
                   finished project stops being ordered; a broken scheduler looks the same, so it is said, not paged).
A HOST THAT IS NOT RUNNING IS NOT JUDGED: fewer than MIN_BOTS bots in CUR, or CUR with under a quarter of BASE's hourly
rows, is `blind:activity` (digest) -- haltwatch owns a stopped showcase, and a quiet zero must never read as "all stopped".
THE POSITIVE CONTROL is printed every run: rows walked, bots seen, keys judged, and the key with the most successes in CUR.

    python3 -B stopwatch.py --label showcase --ship /var/log/showcase/heartbeat.jsonl     (cron 20 * * * * on 10.0.0.40)
    python3 -B stopwatch.py --label showcase --no-state                                    (a dry look: prints, pushes nothing)
    python3 -B stopwatch.py --label showcase --no-state --now 2026-11-13T20:15:00Z         (what it would have said then)

Writes <state-dir>/stopwatch-<label>.json, appends NEW/STILL/CLEARED events to ~/digest/ALARMS.log and pushes the paging ones
through lib/alarm (deduplicated; re-pushed every 2 h until acked: `pager.py ack stopwatch-showcase stopped:skill:<name>
"<why>" --for 1d`). READ ONLY on the bots: the skill logs, nothing else.
"""
import argparse
import datetime as dt
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
CUR_H = 2
BASE_H = 24
BASE_OK = 12            # successes in BASE before a key counts as "worked yesterday"
BASE_RATE = 0.25        # ... at this share of its runs
CUR_TRIES = 8           # runs in CUR before "not one worked" means anything
CUR_BOTS = 2            # ... by this many different bots (one stuck bot is not the town)
STREAK_TRIES = 12       # the newest runs in CUR, all failed ...
STREAK_BOTS = 3         # ... by this many bots ...
STREAK_RATE = 0.5       # ... of a thing that worked at least this often in BASE
COLLAPSE_TRIES = 20
COLLAPSE_FACTOR = 1 / 3
VANISH_HOURS = 18       # BASE hours (of 24) the key ran in
VANISH_PER_H = 4.0
MIN_BOTS = {'showcase': 8, 'fleet': 40}
MIN_ROW_SHARE = 0.25    # CUR rows per hour against BASE's, below which the host is not judged
# never judged: a run of these is not work that can "stop working" (a chat, a probe, a pause)
SKIP = frozenset({'status', 'chat', 'wait', 'idle', 'look'})


def norm_reason(detail):
    """A failure's text with its numbers folded, so the same refusal at different cells is one reason."""
    return re.sub(r'-?\d+(\.\d+)?', 'N', str(detail or '')).strip()[:140]


def keys_of(row):
    """One log row -> [(key, ok)] it counts toward. ok is None for a key that only has a count (an order)."""
    name = str(row.get('name') or '')
    if not name:
        return []
    if name == '_work_order':
        first = str(row.get('detail') or '').split(' ', 1)[0]
        return [('order:' + first, None)] if re.fullmatch(r'[a-z_]{2,40}', first) else []
    if name.startswith('_') or name in SKIP:
        return []
    return [('skill:' + name, row.get('status') == 'success')]


def summarize(rows, lo, hi):
    """rows (dicts with t, name, status, detail, bot) in [lo, hi) -> {key: stats}, and the window's bots and row count."""
    out, bots, n = {}, set(), 0
    for r in rows:
        t = r.get('t')
        if t is None or not (lo <= t < hi):
            continue
        n += 1
        bot = (r.get('bot') or {}).get('name') if isinstance(r.get('bot'), dict) else r.get('bot')
        if bot:
            bots.add(bot)
        for key, ok in keys_of(r):
            s = out.setdefault(key, {'tries': 0, 'ok': 0, 'bots': set(), 'hours': set(), 'last_ok': None, 'last_ok_bot': None,
                                     'fails': Counter(), 'streak': 0, 'streak_bots': set()})
            s['tries'] += 1
            s['hours'].add(t.replace(minute=0, second=0, microsecond=0))
            if bot:
                s['bots'].add(bot)
            if ok:
                s['ok'] += 1
                s['streak'], s['streak_bots'] = 0, set()
                if s['last_ok'] is None or t > s['last_ok']:
                    s['last_ok'], s['last_ok_bot'] = t, bot
            elif ok is False:
                s['fails'][norm_reason(r.get('detail'))] += 1
                s['streak'] += 1                # rows arrive in time order (collect sorts them): the run of failures at the END
                if bot:
                    s['streak_bots'].add(bot)
    return out, bots, n


def _hm(t):
    return t.strftime('%m-%d %H:%MZ') if t else 'none in the window'


def judge(cur, base, cur_h=CUR_H, base_h=BASE_H):
    """PURE. (cur stats, base stats) -> {alarm key: line}. See the module text for the three verdicts."""
    alarms = {}
    for key in sorted(set(cur) | set(base)):
        c = cur.get(key) or {'tries': 0, 'ok': 0, 'bots': set(), 'hours': set(), 'fails': Counter(), 'streak': 0, 'streak_bots': set()}
        b = base.get(key)
        if not b:
            continue                      # new today: nothing to compare with
        counted = key.startswith('skill:')
        b_rate = b['ok'] / b['tries'] if b['tries'] else 0.0
        worked = counted and b['ok'] >= BASE_OK and b_rate >= BASE_RATE
        was = f"the {base_h} h before: {b['ok']} ok of {b['tries']} ({b_rate:.0%}), last ok {_hm(b['last_ok'])}" + \
              (f" by {b['last_ok_bot']}" if b.get('last_ok_bot') else '')
        if worked and c['ok'] == 0 and c['tries'] >= CUR_TRIES and len(c['bots']) >= CUR_BOTS:
            top = c['fails'].most_common(1)
            alarms['stopped:' + key] = (f"{key} STOPPED WORKING: 0 ok of {c['tries']} tries by {len(c['bots'])} bots in the last "
                                        f"{cur_h} h; {was}" + (f"; commonest failure x{top[0][1]}: {top[0][0]}" if top else ''))
            continue
        if worked and b_rate >= STREAK_RATE and c.get('streak', 0) >= STREAK_TRIES and len(c.get('streak_bots', ())) >= STREAK_BOTS:
            top = c['fails'].most_common(1)
            alarms['stopped:' + key] = (f"{key} STOPPED WORKING: the last {c['streak']} tries, by {len(c['streak_bots'])} bots, all failed "
                                        f"({c['ok']} ok of {c['tries']} in the last {cur_h} h); {was}"
                                        + (f"; commonest failure x{top[0][1]}: {top[0][0]}" if top else ''))
            continue
        if worked and c['tries'] >= COLLAPSE_TRIES and c['ok'] > 0 and (c['ok'] / c['tries']) < b_rate * COLLAPSE_FACTOR:
            top = c['fails'].most_common(1)
            alarms['collapsed:' + key] = (f"{key} works a third as often: {c['ok']} ok of {c['tries']} ({c['ok'] / c['tries']:.0%}) in the "
                                          f"last {cur_h} h; {was}" + (f"; commonest failure x{top[0][1]}: {top[0][0]}" if top else ''))
            continue
        # a skill the scheduler orders is said once, as its order (order:<name> is judged in this same loop)
        if counted and ('order:' + key[6:]) in base and ('order:' + key[6:]) not in cur:
            continue
        if c['tries'] == 0 and len(b['hours']) >= VANISH_HOURS and b['tries'] / base_h >= VANISH_PER_H:
            alarms['vanished:' + key] = (f"{key} no longer happens: 0 in the last {cur_h} h; the {base_h} h before: {b['tries']} "
                                         f"({b['tries'] / base_h:.1f} an hour, in {len(b['hours'])} of its hours)")
    return alarms


def blind(label, cur_bots, cur_n, base_n, cur_h=CUR_H, base_h=BASE_H):
    """PURE. Is the host too quiet to judge? -> a line, or None."""
    need = MIN_BOTS.get(label, 8)
    if len(cur_bots) < need:
        return f'{label} not judged: {len(cur_bots)} bots wrote rows in the last {cur_h} h (need {need}); haltwatch owns a stopped host'
    if base_n and (cur_n / cur_h) < MIN_ROW_SHARE * (base_n / base_h):
        return (f'{label} not judged: {cur_n / cur_h:.0f} rows an hour in the last {cur_h} h against {base_n / base_h:.0f} an hour '
                f'in the {base_h} h before')
    return None


def collect(rows, now, label):
    """rows -> the report (verdicts, denominators, the positive control)."""
    lo_cur = now - dt.timedelta(hours=CUR_H)
    lo_base = lo_cur - dt.timedelta(hours=BASE_H)
    rows = sorted(rows, key=lambda r: r['t'])
    cur, cur_bots, cur_n = summarize(rows, lo_cur, now)
    base, base_bots, base_n = summarize(rows, lo_base, lo_cur)
    rep = {'generated_at': AL._iso(now), 'label': label, 'cur': [AL._iso(lo_cur), AL._iso(now)], 'base': [AL._iso(lo_base), AL._iso(lo_cur)],
           'rows': {'cur': cur_n, 'base': base_n}, 'bots': {'cur': len(cur_bots), 'base': len(base_bots)},
           'keys': {'cur': len(cur), 'base': len(base)}, 'alarms': {}}
    b = blind(label, cur_bots, cur_n, base_n)
    if b:
        rep['alarms']['blind:activity'] = b
    else:
        rep['alarms'].update(judge(cur, base))
    best = max(((k, s['ok']) for k, s in cur.items() if k.startswith('skill:')), key=lambda kv: kv[1], default=(None, 0))
    rep['control'] = {'key': best[0], 'ok': best[1]}
    n = Counter(k.split(':', 1)[0] for k in rep['alarms'])
    rep['summary'] = (f"{label} stopwatch: {n['stopped']} stopped, {n['collapsed']} collapsed, {n['vanished']} vanished"
                      f"{' (NOT JUDGED)' if b else ''}; {cur_n} rows by {len(cur_bots)} bots in the last {CUR_H} h, {base_n} in the "
                      f"{BASE_H} h before; {len(cur)} keys now, {len(base)} before; most successes now: {best[0]} ({best[1]})")
    return rep


def load_rows(paths, lo, hi):
    """The skill logs through lib/telemetry (the project's one reader: rotation, binary files, the memory cap)."""
    from lib.telemetry import Events
    ev = Events.load(paths=paths, since=lo, until=hi) if paths else Events.load(since=lo, until=hi)
    return [{'t': r['t'], 'name': r['name'], 'status': r.get('status'), 'detail': r.get('detail'), 'bot': r.get('bot')}
            for r in ev.rows if 'FIXTURE' not in str((r.get('bot') or {}).get('name') or '')]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, help='showcase | fleet (names the state file and the alarm source)')
    ap.add_argument('--paths', help='skill log glob (default: lib/telemetry\'s, /var/log/mcai/*/skill-*.jsonl*)')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship', help='append a kind=<label>_stopwatch row to this filebeat-shipped file')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true', help='print only: no state file, no ALARMS.log, no push')
    ap.add_argument('--now')
    a = ap.parse_args(argv)
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    try:
        rows = load_rows(a.paths, now - dt.timedelta(hours=CUR_H + BASE_H), now)
        rep = collect(rows, now, a.label)
    except Exception as e:      # a watcher that crashes must alarm, not go quiet
        rep = {'generated_at': AL._iso(now), 'label': a.label, 'error': f'{type(e).__name__}: {str(e)[:300]}',
               'alarms': {f'stopwatch:{a.label}': f'stopwatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}'}}
        rep['summary'] = f'{a.label} stopwatch: CHECK FAILED ({rep["error"][:120]})'
    print(rep['summary'])
    for line in rep['alarms'].values():
        print('  !! ' + line)
    if a.no_state:
        return 0
    sd = os.path.expanduser(a.state_dir)
    AL.write_json_atomic(os.path.join(sd, f'stopwatch-{a.label}.json'), rep)
    AL.raise_alarms(f'stopwatch-{a.label}', rep['alarms'], now, os.path.join(sd, f'stopwatch-{a.label}.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_stopwatch', 't': AL._iso(now), 'ok': not rep['alarms'],
                             'event': 'stopped_working' if any(k.startswith('stopped:') for k in rep['alarms']) else 'stopwatch_ok',
                             'why': rep['summary'], 'alarms': sorted(rep['alarms'].values())})
    return 0


if __name__ == '__main__':
    sys.exit(main())
