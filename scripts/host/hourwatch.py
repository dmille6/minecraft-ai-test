#!/usr/bin/env python3
r"""hourwatch.py -- the HOURLY fleet checks (ONE PAGER, codeeval 11-06 phase 1 item 2; design
docs/reports/phase1-autopilot-design-2026-11-06.md). driftwatch is daily, so the 11-05 value drop (16.14 -> 9.90 value per
bot-h) alarmed at 11-06 01:20Z, a day late; nothing watched the idle lap (83% of bot time over 3 h on 11-06) or the towns
with no workable project (7 of 16 on 11-05). Three checks, each with its denominator and a positive control, so a zero or a
blind input is never read as health:

  value   value per active bot-h of the last CUR_H (2) closed hours against the CUR_H..CUR_H+24 h before them
          (valuescore.measure, Elasticsearch, one closed hour per call, each hour cached in ~/digest/hourwatch/; a new run
          computes only the hours it has not cached, at most BACKFILL_MAX). ALARM below (1 - VALUE_DROP) = 75 % of the
          previous 24 h, when the current window has >= MIN_CUR_BH active bot-h and the history >= MIN_PREV_HOURS readable
          hours.
  lap     the share of bot time on the idle-lap rungs (LAP_RUNGS: patrol, return, deposit_surplus) over the last hour, from
          the llm stream's messages[0].milestone: each decision owns the time until the bot's next decision (capped at
          SLICE_CAP), the same charging as the codeeval's dslice read. ALARM above LAP_MAX (40 %) with >= MIN_BOTS bots
          and >= half their bot-hours covered. A rung list that matches nothing is printed, never alarmed as 0 %.
  towns   towns with NO WORKABLE project: no open goal, or every open goal stuck (goalwatch-fleet.json, fresh <= 50 min;
          towns = the townplans under /var/lib/mcai). ALARM above TOWNS_MAX (2).

Writes ~/digest/hourwatch-fleet.json (the fleetstatus header reads it) and raises the alarms through lib/alarm (tier 1:
pushed now, re-pushed every 2 h until acked; `pager.py ack hourwatch lap:share "<why>" --for 2d` while a known fix waits).
A metric that cannot be judged is key blind:<metric> (digest tier).

    python3 -B hourwatch.py run [--no-push] [--no-state]      (cron 25 * * * * on 10.0.0.31, nice 19)
"""
import argparse
import datetime as dt
import glob
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
CUR_H = 2
PREV_H = 24
VALUE_DROP = 0.25
MIN_CUR_BH = 20.0
MIN_PREV_HOURS = 20
BACKFILL_MAX = 30
LAP_RUNGS = frozenset({'patrol', 'return', 'deposit_surplus'})
LAP_MAX = 0.40
LAP_WINDOW = dt.timedelta(hours=1)
SLICE_CAP = dt.timedelta(minutes=10)
MIN_BOTS = 40
MIN_NAMED = 0.90       # decisions that must name a milestone (Codex: unattributed time is unknown, not non-lap)
TOWNS_MAX = 2
GOAL_STALE = dt.timedelta(minutes=50)
PLAN_RE = re.compile(r'_pool-(?P<pool>[^/.]+)/townplan-')


# ------------------------------------------------------------------------------------------------ pure
def hour_floor(t):
    return t.replace(minute=0, second=0, microsecond=0)


def value_windows(now, cur_h=CUR_H, prev_h=PREV_H):
    """PURE. -> (cur hours, prev hours): lists of hour-start datetimes, newest closed hour last."""
    h = hour_floor(now)
    cur = [h - dt.timedelta(hours=i) for i in range(cur_h, 0, -1)]
    prev = [h - dt.timedelta(hours=i) for i in range(cur_h + prev_h, cur_h, -1)]
    return cur, prev


def pool_value(hours):
    """PURE. hours: [{'value', 'bot_hours'} | None] -> (value per bot-h | None, bot_hours, readable hours)."""
    ok = [x for x in hours if x and x.get('bot_hours')]
    bh = sum(x['bot_hours'] for x in ok)
    v = sum(x.get('value') or 0 for x in ok)
    return (v / bh if bh else None), bh, len(ok)


def value_check(cur, prev, drop=VALUE_DROP, min_cur_bh=MIN_CUR_BH, min_prev_hours=MIN_PREV_HOURS):
    """PURE. cur/prev: lists of cached hour dicts. -> (alarm line | None, summary, judged)."""
    cv, cbh, cn = pool_value(cur)
    pv, pbh, pn = pool_value(prev)
    if cv is None or cbh < min_cur_bh:
        return None, f'value: NOT JUDGED (current window {cbh:.1f} active bot-h over {cn} hour(s), need {min_cur_bh:.0f})', False
    if pv is None or pn < min_prev_hours:
        return None, f'value: NOT JUDGED (history {pn} readable hours of {len(prev)}, need {min_prev_hours})', False
    ch = cv / pv - 1 if pv else 0.0
    s = (f'value {cv:.2f}/bot-h over the last {len(cur)} h ({cbh:.0f} bot-h) vs {pv:.2f} over the {pn} h before '
         f'({pbh:.0f} bot-h): {ch:+.0%}')
    if pv > 0 and cv < (1 - drop) * pv:
        return (f'VALUE DROP {ch:+.0%}: {cv:.2f} value/bot-h over the last {len(cur)} h ({cbh:.0f} active bot-h) against '
                f'{pv:.2f} over the previous {pn} h ({pbh:.0f} bot-h) -- what changed? (the last promotion, a model rollout, '
                f'a world event); `canary-sched.py status`, STATE.md'), s, True
    return None, s, True


def milestone_base(row):
    m = ((row.get('messages') or [{}])[0] or {}).get('milestone') if isinstance(row.get('messages'), list) else None
    return re.split(r'[#+]', str(m))[0] if m else None


def lap_share(decisions, lo, hi, cap=SLICE_CAP, rungs=LAP_RUNGS):
    """PURE. decisions: {bot: [(t, milestone | None)] sorted}. Each decision owns [t, min(next t, t + cap)] clipped to
    [lo, hi]. -> {'share', 'lap_s', 'total_s', 'bots', 'rows', 'named_rows', 'by': {milestone: seconds}}."""
    lap_s = tot_s = 0.0
    rows = named = 0
    by = {}
    bots = 0
    for bot, ds in decisions.items():
        if not ds:
            continue
        seen = False
        for i, (t, ms) in enumerate(ds):
            end = min(ds[i + 1][0] if i + 1 < len(ds) else hi, t + cap, hi)
            a = max(t, lo)
            if end <= a:
                continue
            sec = (end - a).total_seconds()
            seen = True
            rows += 1
            tot_s += sec
            if ms:
                named += 1
                by[ms] = by.get(ms, 0.0) + sec
                if ms in rungs:
                    lap_s += sec
        bots += seen
    return {'share': (lap_s / tot_s) if tot_s else None, 'lap_s': lap_s, 'total_s': tot_s, 'bots': bots, 'rows': rows,
            'named_rows': named, 'by': by}


def lap_check(res, window=LAP_WINDOW, lap_max=LAP_MAX, min_bots=MIN_BOTS, rungs=LAP_RUNGS):
    """PURE. -> (alarm | None, summary, judged)."""
    hours = window.total_seconds() / 3600
    cov_bh = res['total_s'] / 3600
    if res['bots'] < min_bots or cov_bh < 0.5 * res['bots'] * hours:
        return None, (f'lap: NOT JUDGED ({res["bots"]} bots with decisions, {cov_bh:.1f} bot-h covered; need {min_bots} '
                      f'bots and half their hours)'), False
    if res['named_rows'] < MIN_NAMED * res['rows']:
        return None, (f'lap: NOT JUDGED (only {res["named_rows"]} of {res["rows"]} decisions name a milestone, need '
                      f'{MIN_NAMED:.0%}: the field moved?)'), False
    if not any(m in rungs for m in res['by']) and res['named_rows']:
        top = ', '.join(f'{m} {s / 3600:.1f}' for m, s in sorted(res['by'].items(), key=lambda x: -x[1])[:4])
        return None, f'lap: 0 of {cov_bh:.1f} bot-h on {"/".join(sorted(rungs))} (no rung seen; top: {top})', True
    sh = res['share']
    top = ', '.join(f'{m} {s / 3600:.1f}' for m, s in sorted(res['by'].items(), key=lambda x: -x[1])[:4])
    s = f'lap {sh:.0%} of {cov_bh:.1f} bot-h ({res["bots"]} bots, {res["rows"]:,} decisions; top bot-h: {top})'
    if sh > lap_max:
        return (f'IDLE LAP {sh:.0%} of bot time over the last {hours:.0f} h ({res["lap_s"] / 3600:.1f} of {cov_bh:.1f} '
                f'bot-h on {"/".join(sorted(rungs))}; {res["bots"]} bots) > {lap_max:.0%} -- the bots are lapping instead '
                f'of working: the fix in flight is idlework-01 (queue)'), s, True
    return None, s, True


def town_check(goal_rep, towns, now, towns_max=TOWNS_MAX, stale=GOAL_STALE):
    """PURE. goal_rep: goalwatch-fleet.json; towns: set of pools with a townplan. -> (alarm | None, summary, judged,
    {town: reason})."""
    gen = AL._ts_or_none((goal_rep or {}).get('generated_at'))
    if gen is None or now - gen > stale:
        return None, f'towns: NOT JUDGED (goalwatch-fleet.json {"absent" if gen is None else "stale " + AL._iso(gen)})', False, {}
    if not towns or not (goal_rep.get('records_scanned') or 0):
        return None, f'towns: NOT JUDGED ({len(towns)} townplans, {goal_rep.get("records_scanned")} records scanned)', False, {}
    by = {t: [] for t in towns}
    for g in goal_rep.get('goals') or []:
        k = str(g.get('key') or '')
        if k.startswith('goal:') and '/' in k:
            by.setdefault(k[5:].split('/', 1)[0], []).append(g)
    bad = {}
    for t, gs in sorted(by.items()):
        if not gs:
            bad[t] = 'no open project'
        elif all(g.get('stuck') for g in gs):
            bad[t] = f'all {len(gs)} open project(s) stuck'
    s = f'towns: {len(bad)} of {len(by)} with no workable project' + (f' ({", ".join(f"{t}: {w}" for t, w in bad.items())})' if bad else '')
    if len(bad) > towns_max:
        return (f'TOWNS WITHOUT WORK: {len(bad)} of {len(by)} towns have no workable project (> {towns_max}): '
                f'{"; ".join(f"{t} {w}" for t, w in bad.items())} -- their bots fall back to the lap'), s, True, bad
    return None, s, True, bad


# ------------------------------------------------------------------------------------------------ impure
def _valuescore():
    spec = importlib.util.spec_from_file_location('hourwatch_valuescore', os.path.join(HERE, 'valuescore.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def cached_hours(hours, cache_dir, now, backfill_max=BACKFILL_MAX):
    """Each closed hour: from the cache, else valuescore.measure (at most backfill_max new ones per run). -> [dict|None]."""
    os.makedirs(cache_dir, exist_ok=True)
    out, vs, new = [], None, 0
    for h in hours:
        p = os.path.join(cache_dir, f'value-{h:%Y%m%dT%H}.json')
        try:
            out.append(json.load(open(p)))
            continue
        except (OSError, ValueError):
            pass
        if new >= backfill_max or h + dt.timedelta(hours=1) > now - dt.timedelta(minutes=10):
            out.append(None)
            continue
        new += 1
        try:
            vs = vs or _valuescore()
            r = vs.measure(AL._iso(h), AL._iso(h + dt.timedelta(hours=1)))
            row = {'hour': AL._iso(h), 'value': r.get('value'), 'bot_hours': r.get('bot_hours'), 'units': r.get('units'),
                   'docs': r.get('docs')}
        except Exception as e:      # noqa: BLE001  (ValueBlind and ES errors: the hour is blind, cached as such)
            row = {'hour': AL._iso(h), 'value': None, 'bot_hours': None, 'blind': f'{type(e).__name__}: {str(e)[:160]}'}
        AL.write_json_atomic(p, row)
        out.append(row)
    for f in glob.glob(os.path.join(cache_dir, 'value-*.json')):     # keep 3 days
        try:
            if now - dt.datetime.strptime(os.path.basename(f)[6:17], '%Y%m%dT%H').replace(tzinfo=UTC) > dt.timedelta(days=3):
                os.remove(f)
        except (ValueError, OSError):
            pass
    return out


def load_decisions(root, lo, hi):
    from lib import telemetry as TM
    bots = sorted(d for d in os.listdir(root) if not d.startswith('_') and os.path.isdir(os.path.join(root, d)))
    out = {}
    for b in bots:
        ds = []
        for t, r in TM.stream_rows(root, b, lo - SLICE_CAP, hi, 'llm'):
            ds.append((t, milestone_base(r)))
        out[b] = sorted(ds, key=lambda x: x[0])
    return out


def towns_with_plans(root):
    return {m.group('pool') for f in glob.glob(os.path.join(root, '_pool-*', 'townplan-*.json'))
            for m in [PLAN_RE.search(f)] if m}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--root', default='/var/lib/mcai')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true')
    a = ap.parse_args(argv)
    now = dt.datetime.now(UTC).replace(microsecond=0)
    sd = os.path.expanduser(a.state_dir)
    alarms, parts, rep = {}, [], {'generated_at': AL._iso(now)}
    try:
        cur_h, prev_h = value_windows(now)
        hrs = cached_hours(prev_h + cur_h, os.path.join(sd, 'hourwatch'), now)
        line, s, ok = value_check(hrs[len(prev_h):], hrs[:len(prev_h)])
        rep['value'] = {'summary': s, 'judged': ok, 'blind_hours': [x['hour'] for x in hrs if x and x.get('blind')]}
    except Exception as e:      # noqa: BLE001
        line, s, ok = None, f'value: FAILED {type(e).__name__}: {str(e)[:160]}', False
    parts.append(s)
    if line:
        alarms['value:drop'] = line
    elif not ok:
        alarms['blind:value'] = s
    try:
        res = lap_share(load_decisions(a.logs, now - LAP_WINDOW, now), now - LAP_WINDOW, now)
        line, s, ok = lap_check(res)
        rep['lap'] = dict(res, summary=s, judged=ok)
    except Exception as e:      # noqa: BLE001
        line, s, ok = None, f'lap: FAILED {type(e).__name__}: {str(e)[:160]}', False
    parts.append(s)
    if line:
        alarms['lap:share'] = line
    elif not ok:
        alarms['blind:lap'] = s
    try:
        try:
            gr = json.load(open(os.path.join(sd, 'goalwatch-fleet.json')))
        except (OSError, ValueError):
            gr = None
        line, s, ok, bad = town_check(gr, towns_with_plans(a.root), now)
        rep['towns'] = {'summary': s, 'judged': ok, 'unworkable': bad}
    except Exception as e:      # noqa: BLE001
        line, s, ok = None, f'towns: FAILED {type(e).__name__}: {str(e)[:160]}', False
    parts.append(s)
    if line:
        alarms['towns:unworkable'] = line
    elif not ok:
        alarms['blind:towns'] = s
    rep['summary'] = 'hourly: ' + ' | '.join(parts)
    rep['alarms'] = {k: v for k, v in alarms.items() if not k.startswith('blind:')}
    rep['blind'] = {k: v for k, v in alarms.items() if k.startswith('blind:')}
    print(f'{AL._iso(now)} {rep["summary"]}')
    for k, v in alarms.items():
        print(f'  !! {k}: {v}')
    if a.no_state:
        return 0
    AL.write_json_atomic(os.path.join(sd, 'hourwatch-fleet.json'), rep)
    AL.raise_alarms('hourwatch', alarms, now, os.path.join(sd, 'hourwatch.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    return 0


if __name__ == '__main__':
    sys.exit(main())
