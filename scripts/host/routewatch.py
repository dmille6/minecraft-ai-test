#!/usr/bin/env python3
r"""routewatch.py -- CAN THE BOTS STILL WALK TO IT? (OWNER 2026-11-14: "lets make changes to clean up this test, implement,
stage, queue, fix loop we have"; the third of four: walkable routes as a checked fact.)

WHY. LIVE showcase 11-13 18:12Z: a tidy visit cut ONE block, the step of the only walk up to the junk well's stand. Nothing
recorded that the walk existed, so nothing could know it was gone; the well failed 148 times in seven hours. The town's
services stand where bots happened to be able to walk -- and the walk is a fact about the world that can be checked.

WHAT IT DOES, every hour:
  1. WHERE THE TOWN'S SERVICES ARE is read from what worked: every cell a bot stood on when a town skill SUCCEEDED in the last
     24 h (the well's stand, the deposit chests, the furnaces, the composter...), inside the town box, used at least MIN_USES
     times by MIN_BOTS bots. No list to maintain: a service nobody reached yesterday is not a service.
  2. THE GROUND is read from the server's own save (regiondump.py; minutes old, read only).
  3. THE WALK is mineflayer-pathfinder's real A* over that ground (routereplay.mjs) with the live walk profile and an EMPTY
     bag: from where `home` ends, to each service, placing nothing and digging nothing.
  4. THE ROUTE FOUND IS KEPT (its cells and the blocks under, at and above each step) in the state file.

THE VERDICTS:
  lost:<skill>@x,y,z     the walk was there at an earlier run and is not now. PAGES, once, and stays until the walk is back.
                         The line names WHAT CHANGED on the kept route ("under 7,70,4: grass_block -> air"): the cut itself.
  nowalk:<skill>@x,y,z   no plain walk from the town centre, and none ever seen. Digest: bots get there some other way
                         (from outside, by the clean zone's valve) and every visit costs them; a to-do for the builders.
  blind:<what>           nothing could be judged (no services found, the save unreadable). Digest.
  routewatch:<label>     the watcher itself failed. PAGES.
THE POSITIVE CONTROL is printed every run: services found, walks found, the longest walk, how old the save is.

    python3 -B routewatch.py --label showcase --ship /var/log/showcase/heartbeat.jsonl      (cron 50 * * * * on 10.0.0.40)
    python3 -B routewatch.py --label showcase --no-state                                     (a dry look)
Reads: the skill logs, the region files. Writes: <state-dir>/routewatch-<label>.json, ALARMS.log, the heartbeat row. It asks the
server nothing and touches no bot."""
import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import tempfile
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from lib import alarm as AL  # noqa: E402
import regiondump as RD      # noqa: E402

UTC = dt.timezone.utc
LOOK_H = 24
TOWN_R = 64            # the town box around home (the clean zone's: 48 + 16)
PAD = 16               # ground read beyond it, so a walk may go round
Y_LO, Y_HI = 52, 100
MIN_Y = 55             # a service below this is a mine's, not the town's
MIN_USES, MIN_BOTS = 3, 2
MAX_DESTS = 40
STARTS = 3
SAVE_MAX_AGE = dt.timedelta(minutes=30)
# the skills whose success cell is a town service (where the bot stood when it worked)
TOWN_SKILLS = frozenset({'dispose_well', 'town_deposit', 'smelt_town', 'withdraw_pick', 'compost', 'deposit', 'make_material',
                         'furnace_drain', 'prune_town', 'count_town', 'withdraw', 'town_withdraw', 'sort_store', 'enchant'})


def feet_cell(pos):
    """A logged position -> the feet cell. y is rounded from the half block: a bot on a dirt path stands at y.9375 in the
    path block's own cell, and its feet cell is the one above."""
    try:
        return (math.floor(pos['x']), math.floor(pos['y'] + 0.5), math.floor(pos['z']))
    except (KeyError, TypeError):
        return None


def find_home(rows):
    """-> the cells `home` most often ends on, best first (the walk's starts)."""
    c = Counter(feet_cell(r['pos']) for r in rows if r['name'] == 'home' and r['status'] == 'success' and feet_cell(r['pos']))
    return [k for k, _ in c.most_common(STARTS)]


def services(rows, home):
    """PURE. -> [{key, cell, uses, bots, skill}] the cells town skills succeeded on, most used first."""
    if not home:
        return []
    hx, _, hz = home
    use, who = Counter(), {}
    for r in rows:
        if r['name'] not in TOWN_SKILLS or r['status'] != 'success':
            continue
        c = feet_cell(r['pos'])
        if not c or c[1] < MIN_Y or max(abs(c[0] - hx), abs(c[2] - hz)) > TOWN_R:
            continue
        k = (r['name'], c)
        use[k] += 1
        who.setdefault(k, set()).add(r['bot'])
    out = [{'key': f'{s}@{c[0]},{c[1]},{c[2]}', 'skill': s, 'cell': list(c), 'uses': n, 'bots': len(who[(s, c)])}
           for (s, c), n in use.most_common() if n >= MIN_USES and len(who[(s, c)]) >= MIN_BOTS]
    return out[:MAX_DESTS]


def world_of(dump):
    pal = dump['palette']
    return {(x, y, z): pal[i]['name'] for x, y, z, i in dump['cells']}


def footprint(path, world):
    """The kept route: for each step, the block under the feet, at the feet and at the head (by name; '' is air)."""
    return [[x, y, z, world.get((x, y - 1, z), ''), world.get((x, y, z), ''), world.get((x, y + 1, z), '')] for x, y, z in path]


def what_changed(kept, world, limit=4):
    """PURE. The kept route against the ground now -> ['under 7,70,4: grass_block -> air', ...] (the first `limit`)."""
    out = []
    for x, y, z, under, feet, head in kept or []:
        for label, yy, was in (('under', y - 1, under), ('at', y, feet), ('above', y + 1, head)):
            now = world.get((x, yy, z), '')
            if now != was:
                out.append(f"{label} {x},{y},{z}: {was or 'air'} -> {now or 'air'}")
                if len(out) >= limit:
                    return out
    return out


def judge(dests, results, prev, world, now):
    """PURE. (services, the replay's results by key, the state before, the ground) -> (alarms {key: line}, state {key: ...}).
    state[key]: {status: walk|lost|nowalk, since, route (the kept footprint, the last one that worked), uses}."""
    alarms, state = {}, {}
    for d in dests:
        k, r, p = d['key'], results.get(d['key']) or {}, prev.get(d['key']) or {}
        used = f"{d['uses']} uses by {d['bots']} bots in the last {LOOK_H} h"
        if r.get('status') == 'success':
            state[k] = {'status': 'walk', 'since': p.get('since') if p.get('status') == 'walk' else AL._iso(now),
                        'route': footprint(r['path'], world), 'steps': len(r['path']), 'uses': d['uses']}
            continue
        had = p.get('route')
        if had:      # a walk was kept at an earlier run: it is LOST until it is back
            since = p.get('since') if p.get('status') == 'lost' else AL._iso(now)
            ch = what_changed(had, world)
            state[k] = {'status': 'lost', 'since': since, 'route': had, 'steps': p.get('steps'), 'uses': d['uses']}
            alarms['lost:' + k] = (f"the walk to {k} is GONE (since {since}; {used}; the search ended {r.get('status', '?')}): "
                                   + ('; '.join(ch) if ch else 'no block of the kept route changed -- the ground beside it did')
                                   + f". The kept route had {p.get('steps')} steps from the town centre.")
        else:
            state[k] = {'status': 'nowalk', 'since': p.get('since') if p.get('status') == 'nowalk' else AL._iso(now), 'uses': d['uses']}
            alarms['nowalk:' + k] = (f"no plain walk from the town centre to {k} ({used}; the search ended {r.get('status', '?')}"
                                     f"{', the cell is not standable in the save' if r.get('status') == 'bad_cell' else ''}): bots reach it "
                                     f"another way, and each visit costs them")
    # a service nobody used in the window keeps its kept route for a week (a quiet day is not a forgotten walk)
    for k, p in prev.items():
        if k not in state and p.get('route') and (AL._ts_or_none(p.get('seen')) or now) > now - dt.timedelta(days=7):
            state[k] = dict(p, quiet=True)
    for k in state:
        if not state[k].get('quiet'):
            state[k]['seen'] = AL._iso(now)
    return alarms, state


def load_rows(root, lo, hi):
    """The skill logs, one bot at a time, five small fields a row (as stopwatch.py). A file that cannot be read fails the run."""
    from lib import telemetry as TM
    out, unread = [], []
    for bot in sorted(d for d in os.listdir(root) if not d.startswith('_') and 'FIXTURE' not in d and os.path.isdir(os.path.join(root, d))):
        for t, d in TM.stream_rows(root, bot, lo, hi, 'skill', errors=unread):
            sk = d.get('skill') or {}
            if sk.get('name') not in TOWN_SKILLS and sk.get('name') != 'home':
                continue
            b = d.get('bot') or {}
            out.append({'t': t, 'name': sk['name'], 'status': sk.get('status'), 'pos': b.get('pos'), 'bot': b.get('name') or bot})
    if unread:
        raise RuntimeError(f'{len(unread)} log file(s) could not be read: ' + ', '.join(unread[:4]))
    return out


def replay(dump, starts, dests, node, script, modules, timeout_ms=3000, version='1.21.8'):
    """Run routereplay.mjs -> {key: result}. Raises when node fails (the caller's crash path)."""
    job = dict(dump, version=version, timeout_ms=timeout_ms, starts=[list(s) for s in starts],
               dests=[{'key': d['key'], 'cell': d['cell']} for d in dests])
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(job, f)
        path = f.name
    try:
        budget = 60 + len(dests) * len(starts) * timeout_ms / 1000 * 1.5
        p = subprocess.run([node, script, path, '--modules', modules], capture_output=True, text=True, timeout=budget)
        if p.returncode != 0:
            raise RuntimeError(f'routereplay.mjs rc={p.returncode}: {(p.stderr or p.stdout)[-300:]}')
        out = json.loads(p.stdout)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return {r['key']: r for r in out.get('results') or []}, out.get('unknown') or []


def collect(a, now, prev):
    rows = load_rows(a.logs, now - dt.timedelta(hours=LOOK_H), now)
    homes = find_home(rows)
    rep = {'generated_at': AL._iso(now), 'label': a.label, 'rows': len(rows), 'home': homes[:1], 'alarms': {}, 'state': prev}
    if not homes:
        rep['alarms']['blind:home'] = f'{a.label} routes not judged: no successful `home` in the last {LOOK_H} h ({len(rows)} rows read)'
        return rep
    dests = services(rows, homes[0])
    if not dests:
        rep['alarms']['blind:services'] = (f'{a.label} routes not judged: no town skill succeeded {MIN_USES}+ times by {MIN_BOTS}+ bots at '
                                           f'one cell in the last {LOOK_H} h ({len(rows)} rows read)')
        return rep
    hx, _, hz = homes[0]
    r = TOWN_R + PAD
    dump = RD.dump(a.region, hx - r, hx + r, hz - r, hz + r, Y_LO, Y_HI)
    saved = AL._ts_or_none(dump.get('saved'))
    rep['save'] = {'saved': dump.get('saved'), 'chunks': dump['chunks'], 'missing_chunks': dump['missing_chunks'], 'blocks': len(dump['cells'])}
    if not dump['cells'] or dump['missing_chunks'] or saved is None or now - saved > a.save_max_age:
        rep['alarms']['blind:save'] = (f"{a.label} routes not judged: the save could not be read whole or is old (saved {dump.get('saved')}, "
                                       f"{dump['chunks']} chunks, {dump['missing_chunks']} missing, {len(dump['cells'])} blocks)")
        return rep
    results, unknown = replay(dump, homes, dests, a.node, a.replay, a.modules, a.timeout_ms)
    world = world_of(dump)
    rep['alarms'], rep['state'] = judge(dests, results, prev, world, now)
    walks = [s for s in rep['state'].values() if s.get('status') == 'walk' and not s.get('quiet')]
    n = Counter(k.split(':', 1)[0] for k in rep['alarms'])
    rep['unknown_blocks'] = unknown
    rep['summary'] = (f"{a.label} routes: {len(dests)} services, {len(walks)} walked, {n['lost']} LOST, {n['nowalk']} with no plain walk; "
                      f"longest walk {max((s.get('steps') or 0) for s in walks) if walks else 0} steps; the save is "
                      f"{int((now - saved).total_seconds() // 60)} min old, {len(dump['cells'])} blocks; {len(rows)} rows read"
                      + (f"; {len(unknown)} block kinds the registry does not know (read as stone)" if unknown else ''))
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True)
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--region', default='/srv/showcase/server/world/region')
    ap.add_argument('--modules', default='/srv/showcase/harness', help='a directory with node_modules (mineflayer-pathfinder)')
    ap.add_argument('--node', default='node')
    ap.add_argument('--replay', default=os.path.join(HERE, 'routereplay.mjs'))
    ap.add_argument('--timeout-ms', type=int, default=3000)
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true', help='print only: no state read or written, no ALARMS.log, no push')
    ap.add_argument('--now')
    a = ap.parse_args(argv)
    a.save_max_age = SAVE_MAX_AGE
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    sd = os.path.expanduser(a.state_dir)
    state_path = os.path.join(sd, f'routewatch-{a.label}.json')
    prev, lost_state = {}, None
    if not a.no_state and os.path.exists(state_path):
        try:
            prev = json.load(open(state_path)).get('state')
            if not isinstance(prev, dict):
                raise ValueError('no state in it')
        except (OSError, ValueError, AttributeError) as e:
            prev, lost_state = {}, f'state file {os.path.basename(state_path)} unreadable ({type(e).__name__}): every kept route is forgotten'
    try:
        rep = collect(a, now, prev)
        if 'summary' not in rep:
            rep['summary'] = f"{a.label} routes: NOT JUDGED ({'; '.join(sorted(rep['alarms']))})"
            # nothing was judged: what was lost before is still lost
            rep['alarms'].update({'lost:' + k: f"the walk to {k} is GONE (since {v.get('since')}); this run could not judge" for k, v in prev.items() if v.get('status') == 'lost'})
        if lost_state:
            rep['alarms'][f'routewatch:{a.label}'] = f'routewatch {a.label}: {lost_state}'
    except Exception as e:      # a watcher that crashes must alarm, not go quiet -- and must not clear what it had said
        rep = {'generated_at': AL._iso(now), 'label': a.label, 'error': f'{type(e).__name__}: {str(e)[:300]}', 'state': prev,
               'alarms': {f'routewatch:{a.label}': f'routewatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}',
                          **{'lost:' + k: f"the walk to {k} is GONE (since {v.get('since')}); this run could not judge" for k, v in prev.items() if v.get('status') == 'lost'}}}
        rep['summary'] = f'{a.label} routes: CHECK FAILED ({rep["error"][:120]})'
    print(rep['summary'])
    for line in rep['alarms'].values():
        print('  !! ' + line)
    if a.no_state:
        return 0
    AL.write_json_atomic(state_path, rep)
    AL.raise_alarms(f'routewatch-{a.label}', rep['alarms'], now, os.path.join(sd, f'routewatch-{a.label}.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_routewatch', 't': AL._iso(now), 'ok': not any(k.startswith(('lost:', 'routewatch:')) for k in rep['alarms']),
                             'event': 'route_lost' if any(k.startswith('lost:') for k in rep['alarms']) else 'routes_ok',
                             'why': rep['summary'], 'alarms': sorted(rep['alarms'].values())})
    return 0


if __name__ == '__main__':
    sys.exit(main())
