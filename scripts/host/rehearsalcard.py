#!/usr/bin/env python3
r"""rehearsalcard.py -- the daily card of a fresh-world rehearsal (owner 2026-11-14: "Start now").

    python3 -B scripts/host/rehearsalcard.py --manifest infra/freshworld/rehearsal-0.json [--root /var/log/mcai]
                                             [--now 2026-11-16T12:00:00Z] [--json]

Runs ON THE REHEARSAL VM, over the bots' own log files (both streams, rotation-aware, through lib/telemetry.stream_rows:
never a hand-rolled walk). It prints the nine criteria of the manifest's `daily_card`, each pass / fail / unread (why),
with the denominator beside every number. A criterion with no source is `unread` and NEVER counts as a pass, and no zero
is printed without its positive control: the rows, bots and observed hours the same walk found.

The window is the run: manifest `started_at` to --now. With no `started_at` the run has not begun and every criterion
that needs rows is unread.

What it reuses, so the numbers mean what they mean elsewhere: lib/busytime (the working share), lib/effectmetrics
(which llm rows are model calls), and finishline.py's kinds_of / stuck_bots / judged_bots / crit (the M1 and M2 measures).

Not read yet, and said so on the card: the longest stuck GOAL (the showcase reads it from fleetstatus; no reader runs on
this host) and whether a completed house still stands (needs a world re-read).
"""
import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import busytime as BT            # noqa: E402
from lib import effectmetrics as EM       # noqa: E402
from lib import telemetry as T            # noqa: E402


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


FL = _load(os.path.join(HERE, 'finishline.py'), 'finishline_for_rehearsalcard')
UTC = dt.timezone.utc
MARGIN = dt.timedelta(minutes=15)       # rows just past each edge prove the bot was up at the edge (lib/busytime)
SITE_R = 64.0                           # reached_site: within this many blocks (x, z) of the home
CORE_PLOT = 'shop'                      # the first project of every town (shop.mjs PROJECTS[0]); the others wait on it
PROJECT = re.compile(r'\bproject=([A-Za-z0-9_]+)')


def ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def ep(t):
    return t.timestamp()


# ============================================================================================ pure
def completed_plots(srows):
    """[(t, row)] -> {plot: first completion time}. A completion is a `_structure_complete` row; its detail names the plot."""
    out = {}
    for t, r in srows:
        sk = r.get('skill') or {}
        if sk.get('name') != '_structure_complete':
            continue
        m = PROJECT.search(str(sk.get('detail') or ''))
        if m and (m.group(1) not in out or t < out[m.group(1)]):
            out[m.group(1)] = t
    return out


def last_positions(per_bot):
    """{bot: [(t, row)]} -> {bot: (x, z)} from each bot's newest row that carries a position."""
    out = {}
    for bot, rows in per_bot.items():
        for t, r in sorted(rows, key=lambda x: x[0], reverse=True):
            p = (r.get('bot') or {}).get('pos') or {}
            if isinstance(p.get('x'), (int, float)) and isinstance(p.get('z'), (int, float)):
                out[bot] = (p['x'], p['z'])
                break
    return out


def hour_buckets(per_bot, start, end):
    """-> finishline's buckets [(bot, hour, rows, (minx, maxx), (miny, maxy), (minz, maxz))] over WHOLE clock hours in
    [start, end)."""
    first = (start.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)) if (start.minute or start.second or start.microsecond) else start
    last = end.replace(minute=0, second=0, microsecond=0)
    acc = {}
    for bot, rows in per_bot.items():
        for t, r in rows:
            if not (first <= t < last):
                continue
            p = (r.get('bot') or {}).get('pos') or {}
            h = t.replace(minute=0, second=0, microsecond=0)
            a = acc.setdefault((bot, h), [0, [None, None], [None, None], [None, None]])
            a[0] += 1
            for i, k in enumerate('xyz'):
                v = p.get(k)
                if isinstance(v, (int, float)):
                    lo, hi = a[1 + i]
                    a[1 + i] = [v if lo is None else min(lo, v), v if hi is None else max(hi, v)]
    return [(bot, h, a[0], tuple(a[1]), tuple(a[2]), tuple(a[3])) for (bot, h), a in sorted(acc.items())]


def busy_seconds(srows, lrows, start, end):
    """One bot's seconds per lib/busytime class in [start, end). The feed is effectcache.bot_cells' (11-03), unchanged."""
    skills, pauses, deaths, stamps, llms = [], [], [], [], []
    for t, r in sorted(srows, key=lambda x: x[0]):
        sk = r.get('skill') or {}
        n = sk.get('name')
        if not n:
            continue
        e = ep(t)
        stamps.append(e)
        iv = BT.skill_interval(e, n, sk.get('duration_ms'))
        if iv:
            skills.append(iv)
        if n == '_decision_skipped':
            ps = BT.pause_seconds(sk.get('detail'))
            if ps:
                pauses.append((e, ps))
        if n == '_death':
            deaths.append(e)
    for t, r in sorted(lrows, key=lambda x: x[0]):
        e = ep(t)
        stamps.append(e)
        if not EM.is_model_call(r):
            continue
        try:
            lat = float((r.get('llm') or {}).get('latency_ms') or 0) / 1000.0
        except (TypeError, ValueError):
            lat = 0.0
        llms.append((e, lat))
    return BT.classify(ep(start), ep(end), skills, llms, pauses, deaths, stamps)


def card(manifest, per_skill, per_llm, now, errors=()):
    """PURE. manifest (dict), {bot: [(t, row)]} for each stream (rows may spill past the window by the margin), now.
    -> {'run', 'window', 'control', 'criteria': [finishline.crit ...]}."""
    started = manifest.get('started_at')
    site = (manifest.get('world') or {}).get('site') or {}
    home = site.get('home_xz') or site.get('centre_xz')
    roster = (manifest.get('bots') or {}).get('roster') or []
    want_bots = len(roster) or (manifest.get('bots') or {}).get('count') or 0
    assist = manifest.get('assistance_log') or []
    out = {'run': manifest.get('run'), 'criteria': []}
    add = out['criteria'].append
    if not started:
        why = 'the run has not started (no started_at in the manifest)'
        out['window'] = None
        out['control'] = why
        for c in ('reached_site', 'town_core', 'roofed_houses', 'storage', 'working_share', 'longest_stuck_goal',
                  'deaths', 'stuck_bots'):
            add(FL.crit(c, None, False, unread=why))
        add(FL.crit('admin_edits', f'{len(assist)} entries in the assistance log', len(assist) == 0))
        return out
    start = ts(started)
    hours = (now - start).total_seconds() / 3600.0
    win = lambda rows: [(t, r) for t, r in rows if start <= t < now]
    skill = {b: win(rows) for b, rows in per_skill.items()}
    nrows = sum(len(v) for v in skill.values())
    seen = sorted(b for b, v in skill.items() if v)
    sec = {}
    for b in sorted(set(per_skill) | set(per_llm)):
        for k, v in busy_seconds(per_skill.get(b, []), per_llm.get(b, []), start, now).items():
            sec[k] = sec.get(k, 0.0) + v
    sh = BT.shares(sec)
    obs_h = sh['observed_h'] if sh else 0.0
    out['window'] = {'start': started, 'now': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'hours': round(hours, 2)}
    out['control'] = (f'{nrows:,} skill rows from {len(seen)} of {want_bots} bots, {obs_h:,.1f} bot-hours observed'
                      + (f'; UNREAD FILES: {", ".join(errors)}' if errors else ''))
    blind = None if nrows and not errors else ('a log file could not be read' if errors else 'no rows in the window')

    # 1. reached_site
    pos = last_positions(skill)
    if blind or not home or not pos:
        add(FL.crit('reached_site', None, False, unread=blind or ('no home in the manifest' if not home else 'no row carries a position')))
    else:
        near = sorted(b for b, (x, z) in pos.items() if math.hypot(x - home[0], z - home[1]) <= SITE_R)
        add(FL.crit('reached_site', f'{len(near)} of {want_bots} bots within {SITE_R:.0f} blocks of the home '
                                    f'({len(pos)} with a position)', len(near) >= want_bots > 0))

    # 2-4. completions
    done = completed_plots([x for rows in skill.values() for x in rows])
    kinds = FL.kinds_of(done)
    listing = ', '.join(sorted(done)) or 'none'
    if blind:
        for c in ('town_core', 'roofed_houses', 'storage'):
            add(FL.crit(c, None, False, unread=blind))
    else:
        core_t = done.get(CORE_PLOT)
        add(FL.crit('town_core', (f'{CORE_PLOT} completed {(core_t - start).total_seconds() / 3600:.1f} h in' if core_t
                                  else f'{CORE_PLOT} not completed after {hours:.1f} h') + f' (completed: {listing})',
                    core_t is not None and (core_t - start).total_seconds() <= 12 * 3600))
        need = 2 if hours >= 48 else 1
        add(FL.crit('roofed_houses', f'{len(kinds["houses"])} completed ({", ".join(kinds["houses"]) or "none"}); '
                                     f'needs {need} at {hours:.0f} h; still standing: not re-read',
                    len(kinds['houses']) >= need if hours >= 24 else len(kinds['houses']) >= 1))
        add(FL.crit('storage', f'{len(kinds["storage"])} completed ({", ".join(kinds["storage"]) or "none"})',
                    len(kinds['storage']) >= 1))

    # 5. working share
    if blind or not sh:
        add(FL.crit('working_share', None, False, unread=blind or 'nothing observed'))
    else:
        add(FL.crit('working_share', f'{100 * sh["productive"]:.1f}% productive (walking {100 * sh["walking"]:.1f}%, '
                                     f'decision {100 * sh["decision"]:.1f}%, idle {100 * sh["idle"]:.1f}%) of '
                                     f'{obs_h:,.1f} observed bot-hours', sh['productive'] > 0.5))

    # 6. longest stuck goal: no reader on this host
    add(FL.crit('longest_stuck_goal', None, False, unread='no stuck-goal reader runs on the rehearsal host yet'))

    # 7. deaths
    deaths = sum(1 for rows in skill.values() for _, r in rows if (r.get('skill') or {}).get('name') == '_death')
    if blind or obs_h <= 0:
        add(FL.crit('deaths', None, False, unread=blind or 'nothing observed'))
    else:
        rate = deaths * 100.0 / obs_h
        add(FL.crit('deaths', f'{deaths} deaths in {obs_h:,.1f} bot-hours = {rate:.2f} per 100 (from {nrows:,} rows)', rate < 1.0))

    # 8. stuck bots
    buckets = hour_buckets(skill, start, now)
    judged = FL.judged_bots(buckets)
    if blind or not judged:
        add(FL.crit('stuck_bots', None, False, unread=blind or 'no bot has a whole clock hour with enough positioned rows yet'))
    else:
        stuck = FL.stuck_bots(buckets)
        names = ', '.join(f'{b} {h} h' for b, h in sorted(stuck.items(), key=lambda x: -x[1])[:4])
        add(FL.crit('stuck_bots', f'{len(stuck)} of {len(judged)} judged bots stuck for a whole hour' + (f' ({names})' if names else ''),
                    len(stuck) == 0))

    # 9. admin edits
    add(FL.crit('admin_edits', f'{len(assist)} entries in the assistance log', len(assist) == 0))
    return out


def render(c):
    lines = [f"REHEARSAL CARD {c['run']}"]
    w = c.get('window')
    lines.append(f"  window: {w['start']} to {w['now']} ({w['hours']} h)" if w else '  window: not started')
    lines.append(f"  control: {c['control']}")
    n = {'pass': 0, 'fail': 0, 'unread': 0}
    for x in c['criteria']:
        n[x['state']] += 1
        lines.append(f"  {x['state'].upper():6} {x['name']}: {x['measured']}")
    lines.append(f"  {n['pass']} pass, {n['fail']} fail, {n['unread']} unread (unread never counts as a pass)")
    return '\n'.join(lines)


# ============================================================================================ impure
def read(root, start, now):
    """-> ({bot: [(t, row)]} skill, same for llm, [unread files]) over [start - margin, now + margin)."""
    errors, sk, ll = [], {}, {}
    if not os.path.isdir(root):
        return sk, ll, [f'{root} (missing)']
    for bot in sorted(d for d in os.listdir(root) if not d.startswith('_') and os.path.isdir(os.path.join(root, d))):
        sk[bot] = list(T.stream_rows(root, bot, start - MARGIN, now + MARGIN, 'skill', errors=errors))
        ll[bot] = list(T.stream_rows(root, bot, start - MARGIN, now + MARGIN, 'llm', errors=errors))
    return sk, ll, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--root', default='/var/log/mcai')
    ap.add_argument('--now')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    manifest = json.load(open(a.manifest))
    now = ts(a.now) if a.now else dt.datetime.now(UTC)
    sk, ll, errors = ({}, {}, [])
    if manifest.get('started_at'):
        sk, ll, errors = read(a.root, ts(manifest['started_at']), now)
    c = card(manifest, sk, ll, now, errors)
    print(json.dumps(c, indent=1) if a.json else render(c))
    return 0


if __name__ == '__main__':
    sys.exit(main())
