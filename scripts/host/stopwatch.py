#!/usr/bin/env python3
r"""stopwatch.py -- the STOPPED-WORKING ALARM (OWNER 2026-11-14: "lets make changes to clean up this test, implement, stage,
queue, fix loop we have").

WHY. LIVE showcase 11-13: the junk well went from 8-15 successful throws an hour to 0 of 124 at 18:12Z and nobody saw it for
five hours; it was found because building looked slow. Two correct rules had composed into a dead end (a tidy cut plus the
clean zone). Every one-hour read that day looked at its own piece's rows and called a KEEP. Nothing asked the one question
that would have paged in the first hour: WHAT WORKED YESTERDAY AND DOES NOT WORK NOW?

WHAT IT WATCHES. Every thing the bots do that the logs name:
  skill:<name>    a skill run (a row whose kind does not start with `_`). It WORKED when status is success and FAILED when
                  status is failed / timeout / error / rejected. Every other status is NEITHER (Claude review r1): no_effect
                  is the code's "correctly declined to act" (nothing to bank, already full), aborted an interrupt, unknown
                  a result nobody could tell -- they are runs (the thing still happens) but never tries.
  order:<skill>   a scheduler work order (`_work_order`, its first word); it only has a count
Two windows: CUR, the last CUR_H (2) hours, and BASE, the BASE_H (24) hours before it.

THE THREE VERDICTS, each with its denominator in the line:
  stopped:<key>    BASE worked (>= BASE_OK successes at a rate >= BASE_RATE) and CUR failed >= CUR_TRIES times, by >=
                   CUR_BOTS bots, and NOT ONE try worked -- or, sooner, the NEWEST tries in CUR all failed: >= STREAK_TRIES
                   of them over >= STREAK_SPAN (the well: a streak by 18:55Z while the 2-h window still held its last
                   successes until 20:11Z). One bot counts for at most BOT_CAP failures (a looping bot is not the town),
                   and the failures must be more than chance: a thing that worked at rate r in BASE fails n times running
                   with probability (1-r)^n, which must be <= CHANCE (8 are enough at 85 %, about 26 at 30 %). PAGES.
                   The line carries the last success and the commonest failure.
                   IT STAYS UP UNTIL THE THING WORKS AGAIN (the latch, Claude review r1): as the broken hours slide
                   into BASE its rate falls, a backed-off scheduler tries less, a host goes quiet -- none of that is a
                   recovery. A latched key is released by a success NEWER than the failures it was latched on (Codex
                   review r1: the last success before the break stays inside CUR for two hours), or by hand
                   (`--release skill:<name>`). A state file that cannot be read is a watcher failure, and the keys it
                   held are taken back from the push state rather than cleared.
THE WALK MUST BE WHOLE (Codex review r1). "No success seen" is only a finding when every log file in the window was read: an
unreadable generation that held the success would otherwise page. A file that cannot be read fails the run under its own
paging key (stopwatch:<label>), and the latch is kept.
  collapsed:<key>  BASE worked and CUR works at less than a third of BASE's rate over >= COLLAPSE_TRIES runs. Digest.
  vanished:<key>   BASE ran it in >= VANISH_HOURS of its hours, >= VANISH_PER_H an hour, and CUR never ran it. Digest (a
                   finished project stops being ordered; a broken scheduler looks the same, so it is said, not paged).
A HOST THAT IS NOT RUNNING IS NOT JUDGED: fewer than MIN_BOTS bots in CUR, or CUR with under a quarter of BASE's hourly
rows, is `blind:activity` (digest) -- haltwatch owns a stopped showcase, and a quiet zero must never read as "all stopped".
THE POSITIVE CONTROL is printed every run: rows walked, bots seen, keys judged, and the key with the most successes in CUR.

    python3 -B stopwatch.py --label showcase --ship /var/log/showcase/heartbeat.jsonl     (cron 20 * * * * on 10.0.0.40)
    python3 -B stopwatch.py --label showcase --release skill:dispose_well                 (retired on purpose: drop the latch)
    python3 -B stopwatch.py --label showcase --no-state                                    (a dry look: prints, pushes nothing)
    python3 -B stopwatch.py --label showcase --no-state --now 2026-11-13T20:15:00Z         (what it would have said then)

Writes <state-dir>/stopwatch-<label>.json, appends NEW/STILL/CLEARED events to ~/digest/ALARMS.log and pushes the paging ones
through lib/alarm (deduplicated; re-pushed every 2 h until acked: `pager.py ack stopwatch-showcase stopped:skill:<name>
"<why>" --for 1d`). READ ONLY on the bots: the skill logs, nothing else.
"""
import argparse
import datetime as dt
import json
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
BASE_RATE = 0.25        # ... at this share of its tries
CUR_TRIES = 8           # failures in CUR (capped per bot) before "not one worked" means anything
CUR_BOTS = 2            # ... by this many different bots
BOT_CAP = 4             # one bot counts for at most this many failures (a looping bot is not the town)
CHANCE = 1e-4           # (1 - BASE rate) ** failures must be at most this
STREAK_TRIES = 12       # the newest tries in CUR, all failed (capped per bot: at least three bots)
STREAK_SPAN = dt.timedelta(minutes=10)   # ... over at least this long (a burst in one minute is one event)
COLLAPSE_TRIES = 20
COLLAPSE_FACTOR = 1 / 3
VANISH_HOURS = 18       # BASE hours the key ran in
VANISH_PER_H = 4.0
MIN_BOTS = {'showcase': 8, 'fleet': 40}
MIN_ROW_SHARE = 0.25    # CUR rows per hour against BASE's, below which the host is not judged
FAIL = frozenset({'failed', 'timeout', 'error', 'rejected'})
# never judged: a run of these is not work that can "stop working" (a chat, a probe, a pause)
SKIP = frozenset({'status', 'chat', 'wait', 'idle', 'look'})


def norm_reason(detail):
    """A failure's text with its numbers folded, so the same refusal at different cells is one reason."""
    return re.sub(r'-?\d+(\.\d+)?', 'N', str(detail or '')).strip()[:140]


def keys_of(row):
    """One log row -> [(key, ok)]. ok: True worked, False failed, None neither (a run, never a try)."""
    name = str(row.get('name') or '')
    if not name:
        return []
    if name == '_work_order':
        first = str(row.get('detail') or '').split(' ', 1)[0]
        return [('order:' + first, None)] if re.fullmatch(r'[a-z_]{2,40}', first) else []
    if name.startswith('_') or name in SKIP:
        return []
    st = row.get('status')
    return [('skill:' + name, True if st == 'success' else False if st in FAIL else None)]


def _blank():
    return {'runs': 0, 'ok': 0, 'fail': 0, 'hours': set(), 'last_ok': None, 'last_ok_bot': None, 'fails': Counter(),
            'fail_by_bot': Counter(), 'streak_by_bot': Counter(), 'streak_from': None, 'streak_to': None}


def capped(by_bot):
    """Failures with one bot counted for at most BOT_CAP."""
    return sum(min(n, BOT_CAP) for n in by_bot.values())


def summarize(rows, lo, hi):
    """rows IN TIME ORDER (dicts with t, name, status, detail, bot) in [lo, hi) -> ({key: stats}, bots seen, rows seen)."""
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
            s = out.setdefault(key, _blank())
            s['runs'] += 1
            s['hours'].add(t.replace(minute=0, second=0, microsecond=0))
            if ok is True:
                s['ok'] += 1
                s['streak_by_bot'], s['streak_from'], s['streak_to'] = Counter(), None, None
                if s['last_ok'] is None or t > s['last_ok']:
                    s['last_ok'], s['last_ok_bot'] = t, bot
            elif ok is False:
                s['fail'] += 1
                s['fails'][norm_reason(r.get('detail'))] += 1
                s['fail_by_bot'][bot or '?'] += 1
                s['streak_by_bot'][bot or '?'] += 1          # the run of failures at the END of the window
                s['streak_from'] = s['streak_from'] or t
                s['streak_to'] = t
    return out, bots, n


def _hm(t):
    return t.strftime('%m-%d %H:%MZ') if t else 'none in the window'


def _habit(b, base_h):
    return bool(b) and len(b['hours']) >= VANISH_HOURS and b['runs'] / base_h >= VANISH_PER_H


def judge(cur, base, cur_h=CUR_H, base_h=BASE_H):
    """PURE. (cur stats, base stats) -> {alarm key: line}. See the module text for the three verdicts."""
    alarms = {}
    for key in sorted(set(cur) | set(base)):
        c = cur.get(key) or _blank()
        b = base.get(key)
        if not b:
            continue                      # new today: nothing to compare with
        counted = key.startswith('skill:')
        b_tries = b['ok'] + b['fail']
        b_rate = b['ok'] / b_tries if b_tries else 0.0
        worked = counted and b['ok'] >= BASE_OK and b_rate >= BASE_RATE
        was = f"the {base_h} h before: {b['ok']} ok of {b_tries} tries ({b_rate:.0%}), last ok {_hm(b['last_ok'])}" + \
              (f" by {b['last_ok_bot']}" if b.get('last_ok_bot') else '')
        top = c['fails'].most_common(1)
        why = f"; commonest failure x{top[0][1]}: {top[0][0]}" if top else ''
        n_all = capped(c['fail_by_bot'])
        if worked and c['ok'] == 0 and n_all >= CUR_TRIES and len(c['fail_by_bot']) >= CUR_BOTS and (1 - b_rate) ** n_all <= CHANCE:
            alarms['stopped:' + key] = (f"{key} STOPPED WORKING: 0 ok of {c['fail']} tries by {len(c['fail_by_bot'])} bots in the last "
                                        f"{cur_h} h; {was}{why}")
            continue
        n_run = capped(c['streak_by_bot'])
        span = (c['streak_to'] - c['streak_from']) if c['streak_from'] else dt.timedelta(0)
        if worked and n_run >= STREAK_TRIES and span >= STREAK_SPAN and (1 - b_rate) ** n_run <= CHANCE:
            alarms['stopped:' + key] = (f"{key} STOPPED WORKING: the last {sum(c['streak_by_bot'].values())} tries, by "
                                        f"{len(c['streak_by_bot'])} bots since {c['streak_from'].strftime('%H:%MZ')}, all failed "
                                        f"({c['ok']} ok of {c['ok'] + c['fail']} in the last {cur_h} h); {was}{why}")
            continue
        c_tries = c['ok'] + c['fail']
        if worked and c_tries >= COLLAPSE_TRIES and c['ok'] > 0 and (c['ok'] / c_tries) < b_rate * COLLAPSE_FACTOR:
            alarms['collapsed:' + key] = (f"{key} works a third as often: {c['ok']} ok of {c_tries} ({c['ok'] / c_tries:.0%}) in the "
                                          f"last {cur_h} h; {was}{why}")
            continue
        # a skill the scheduler ordered all day is said once, as its order (order:<name> is judged in this same loop)
        ok_ = 'order:' + key[6:]
        if counted and _habit(base.get(ok_), base_h) and ok_ not in cur:
            continue
        if c['runs'] == 0 and _habit(b, base_h):
            alarms['vanished:' + key] = (f"{key} no longer happens: 0 in the last {cur_h} h; the {base_h} h before: {b['runs']} "
                                         f"({b['runs'] / base_h:.1f} an hour, in {len(b['hours'])} of its hours)")
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


def hold(alarms, cur, latched, now):
    """PURE. THE LATCH. (this run's alarms, CUR stats, the keys latched before {key: {since, line}}) ->
    (alarms with every still-stopped key in them, the new latch, the keys released by a success)."""
    out, keep, released = dict(alarms), {}, []
    for ak, line in alarms.items():
        if ak.startswith('stopped:'):
            key = ak[len('stopped:'):]
            was = latched.get(key) or {}
            c = cur.get(key) or _blank()
            # `after`: the newest failure it was latched on -- only a success later than that is a recovery
            keep[key] = {'since': was.get('since') or AL._iso(now), 'after': was.get('after') or AL._iso(c['streak_to'] or now), 'line': line}
    for key, was in (latched or {}).items():
        if key in keep:
            continue
        c = cur.get(key) or _blank()
        after = AL._ts_or_none(was.get('after')) if isinstance(was, dict) else None
        if c['last_ok'] is not None and (after is None or c['last_ok'] > after):
            released.append(key)
            continue
        keep[key] = was
        out.pop('vanished:' + key, None); out.pop('collapsed:' + key, None)     # said once, as what it is: still stopped
        out['stopped:' + key] = (f"{key} STILL STOPPED (said {was.get('since')}): no success since; {c['fail']} failed of {c['runs']} runs in "
                                 f"the last {CUR_H} h. First said: {str(was.get('line'))[:400]}")
    return out, keep, sorted(released)


def collect(rows, now, label, latched=None):
    """rows -> the report (verdicts, denominators, the positive control, the latch)."""
    rows = sorted(rows, key=lambda r: r['t'])
    lo_cur = now - dt.timedelta(hours=CUR_H)
    lo_base = lo_cur - dt.timedelta(hours=BASE_H)
    cur, cur_bots, cur_n = summarize(rows, lo_cur, now)
    base, base_bots, base_n = summarize(rows, lo_base, lo_cur)
    rep = {'generated_at': AL._iso(now), 'label': label, 'cur': [AL._iso(lo_cur), AL._iso(now)], 'base': [AL._iso(lo_base), AL._iso(lo_cur)],
           'rows': {'cur': cur_n, 'base': base_n}, 'bots': {'cur': len(cur_bots), 'base': len(base_bots)},
           'keys': {'cur': len(cur), 'base': len(base)}}
    b = blind(label, cur_bots, cur_n, base_n)
    found = {'blind:activity': b} if b else judge(cur, base)
    rep['alarms'], rep['latched'], rep['released'] = hold(found, cur, latched or {}, now)
    best = max(((k, s['ok']) for k, s in cur.items() if k.startswith('skill:')), key=lambda kv: kv[1], default=(None, 0))
    rep['control'] = {'key': best[0], 'ok': best[1]}
    n = Counter(k.split(':', 1)[0] for k in rep['alarms'])
    rep['summary'] = (f"{label} stopwatch: {n['stopped']} stopped, {n['collapsed']} collapsed, {n['vanished']} vanished"
                      f"{' (NOT JUDGED)' if b else ''}{'; works again: ' + ', '.join(rep['released']) if rep['released'] else ''}; "
                      f"{cur_n} rows by {len(cur_bots)} bots in the last {CUR_H} h, {base_n} in the "
                      f"{BASE_H} h before; {len(cur)} keys now, {len(base)} before; most successes now: {best[0]} ({best[1]})")
    return rep


def load_rows(root, lo, hi):
    """The skill logs, one bot at a time through lib/telemetry's rotation-aware stream, keeping five small fields a row
    (Claude review r1: Events.load holds every raw row -- about 2 GB for the showcase's 26 h; this is about 190 MB)."""
    from lib import telemetry as TM
    out, unread = [], []
    for bot in sorted(d for d in os.listdir(root) if not d.startswith('_') and 'FIXTURE' not in d and os.path.isdir(os.path.join(root, d))):
        for t, d in TM.stream_rows(root, bot, lo, hi, 'skill', errors=unread):
            sk = d.get('skill') or {}
            if not sk.get('name'):
                continue
            name = (d.get('bot') or {}).get('name') or bot
            if 'FIXTURE' in str(name):
                continue
            out.append({'t': t, 'name': sk['name'], 'status': sk.get('status'), 'detail': str(sk.get('detail') or '')[:240], 'bot': name})
    if unread:
        raise IncompleteWalk(f'{len(unread)} log file(s) could not be read: ' + ', '.join(unread[:4]))
    return out


class IncompleteWalk(RuntimeError):
    """A log file in the window could not be read: "no success seen" would not be a finding."""


def read_latch(path, push_path, now):
    """-> (latched, problem). No state file yet: ({}, None). A state file that cannot be read or is not ours: the stopped keys
    are taken back from the push state (lib/alarm's own file, {alarm key: ...}) and the problem is said -- never an empty
    latch in silence (Codex review r1: the next run would overwrite it and push CLEARED)."""
    if not os.path.exists(path):
        return {}, None
    try:
        v = json.load(open(path)).get('latched')
        if isinstance(v, dict) and all(isinstance(x, dict) for x in v.values()):
            return v, None
        problem = 'no latch in it'
    except (OSError, ValueError, AttributeError) as e:
        problem = type(e).__name__
    back = {}
    try:
        for k in json.load(open(push_path)):
            if str(k).startswith('stopped:'):
                back[str(k)[len('stopped:'):]] = {'since': 'before a lost state file', 'after': AL._iso(now), 'line': 'taken back from the push state'}
    except (OSError, ValueError, TypeError):
        pass
    return back, f'state file {os.path.basename(path)} unreadable ({problem}); {len(back)} stopped key(s) taken back from the push state'


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, help='showcase | fleet (names the state file and the alarm source)')
    ap.add_argument('--logs', default='/var/log/mcai', help='the skill log root (one directory a bot)')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship', help='append a kind=<label>_stopwatch row to this filebeat-shipped file')
    ap.add_argument('--release', action='append', default=[], metavar='KEY',
                    help='drop the latch of a key retired on purpose (skill:<name>); repeatable')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true', help='print only: no state file read or written, no ALARMS.log, no push')
    ap.add_argument('--now')
    a = ap.parse_args(argv)
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    sd = os.path.expanduser(a.state_dir)
    state = os.path.join(sd, f'stopwatch-{a.label}.json')
    push_state = os.path.join(sd, f'stopwatch-{a.label}.pushstate.json')
    latched, lost = ({}, None) if a.no_state else read_latch(state, push_state, now)
    latched = {k: v for k, v in latched.items() if k not in set(a.release)}
    try:
        rows = load_rows(a.logs, now - dt.timedelta(hours=CUR_H + BASE_H), now)
        rep = collect(rows, now, a.label, latched)
        if lost:
            rep['alarms'][f'stopwatch:{a.label}'] = f'stopwatch {a.label}: {lost}'
    except Exception as e:      # a watcher that crashes must alarm, not go quiet -- and must not clear what it had said
        rep = {'generated_at': AL._iso(now), 'label': a.label, 'error': f'{type(e).__name__}: {str(e)[:300]}', 'latched': latched, 'released': [],
               'alarms': {f'stopwatch:{a.label}': f'stopwatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}',
                          **{'stopped:' + k: f"{k} STILL STOPPED (said {v.get('since')}); this run could not judge" for k, v in latched.items()}}}
        rep['summary'] = f'{a.label} stopwatch: CHECK FAILED ({rep["error"][:120]})'
    print(rep['summary'])
    for line in rep['alarms'].values():
        print('  !! ' + line)
    if a.no_state:
        return 0
    AL.write_json_atomic(state, rep)
    AL.raise_alarms(f'stopwatch-{a.label}', rep['alarms'], now, push_state,
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_stopwatch', 't': AL._iso(now), 'ok': not rep['alarms'],
                             'event': 'stopped_working' if any(k.startswith('stopped:') for k in rep['alarms']) else 'stopwatch_ok',
                             'why': rep['summary'], 'alarms': sorted(rep['alarms'].values())})
    return 0


if __name__ == '__main__':
    sys.exit(main())
