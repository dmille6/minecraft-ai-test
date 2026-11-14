#!/usr/bin/env python3
"""stopwatch.py, the stopped-working alarm (11-14). The verdicts are pure functions of two windows of rows and are tested on
rows built here; one test goes through the real reader (lib/telemetry) over files in the logs' own shape. Every "no alarm"
case sits beside the same rows WITH the alarm (the positive control), and the mutants at the end prove the thresholds bind."""
import datetime as dt, json, os, re, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import stopwatch as SW  # noqa: E402
from lib import alarm as AL  # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

NOW = dt.datetime(2026, 11, 13, 20, 20, tzinfo=dt.timezone.utc)
CUR0 = NOW - dt.timedelta(hours=SW.CUR_H)
BASE0 = CUR0 - dt.timedelta(hours=SW.BASE_H)
BOTS = ['showcase-%s' % n for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno')]
WELL_FAIL = "could not reach the junk well's standing cell at 12,74,6 (the bot is at 12.48,68.00,6.50); the next town visit tries again"

def row(t, name, status='success', detail='', bot=0):
    return {'t': t, 'name': name, 'status': status, 'detail': detail, 'bot': {'name': BOTS[bot % len(BOTS)]}}
def spread(lo, hi, n, name, status='success', detail='', bots=10, start=0):
    """n rows of one kind spread evenly over [lo, hi), cycling the bots."""
    step = (hi - lo) / max(1, n)
    return [row(lo + step * i + dt.timedelta(seconds=1), name, status, detail, start + (i % bots)) for i in range(n)]
def filler():
    """a living town in both windows: every bot explores all day (so no window is blind and there is a control key)."""
    return spread(BASE0, CUR0, 2400, 'explore') + spread(CUR0, NOW, 200, 'explore')
def verdicts(rows):
    return SW.collect(rows, NOW, 'showcase')['alarms']

# ---- keys ----
check(SW.keys_of(row(NOW, 'dispose_well', 'failed')) == [('skill:dispose_well', False)], 'a skill row is a counted key')
check(SW.keys_of(row(NOW, '_work_order', 'success', 'deep_mine {"y":-40} — because')) == [('order:deep_mine', None)], 'a work order is keyed by its first word')
check(SW.keys_of(row(NOW, '_work_order', 'success', '{"odd":1} text')) == [], 'a work order with no skill word is no key')
check(SW.keys_of(row(NOW, '_place_town')) == [] and SW.keys_of(row(NOW, 'status')) == [], 'instrument rows and probes are never judged')
check(SW.norm_reason(WELL_FAIL) == SW.norm_reason(WELL_FAIL.replace('12.48', '9.60').replace('68.00', '55.75')), 'a refusal at another cell is the same reason')

# ---- stopped: nothing worked ----
base_well = spread(BASE0, CUR0, 248, 'dispose_well') + spread(BASE0, CUR0, 44, 'dispose_well', 'failed', 'a player is near')
dead = filler() + base_well + spread(CUR0, NOW, 37, 'dispose_well', 'failed', WELL_FAIL)
a = verdicts(dead)
line = a.get('stopped:skill:dispose_well', '')
check(set(a) == {'stopped:skill:dispose_well'}, f'LIVE 11-13 20:20Z shape: the well alone is named ({sorted(a)})')
check('0 ok of 37 tries by 10 bots in the last 2 h' in line and '248 ok of 292 (85%)' in line, 'the line carries both denominators: ' + line[:150])
check("commonest failure x37: could not reach the junk well's standing cell at N,N,N" in line, 'and the commonest failure, numbers folded')
check('last ok 11-13' in line, 'and when it last worked')
alive = filler() + base_well + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL) + [row(NOW - dt.timedelta(minutes=5), 'dispose_well')]
check('stopped:skill:dispose_well' not in verdicts(alive), 'POSITIVE CONTROL: one success at the end of the same window and it is not "stopped"')
check('stopped:skill:dispose_well' not in verdicts(filler() + base_well + spread(CUR0, NOW, 7, 'dispose_well', 'failed', WELL_FAIL)), 'seven tries are not enough to say so')
check('stopped:skill:dispose_well' not in verdicts(filler() + base_well + spread(CUR0, NOW, 37, 'dispose_well', 'failed', WELL_FAIL, bots=1)), 'one stuck bot is not the town')
never = filler() + spread(BASE0, CUR0, 11, 'dispose_well') + spread(BASE0, CUR0, 200, 'dispose_well', 'failed', 'x') + spread(CUR0, NOW, 37, 'dispose_well', 'failed', 'x')
check(not any(k.endswith('dispose_well') for k in verdicts(never)), 'a thing that did not work yesterday either is not news (11 ok of 211)')
check('stopped:skill:new_skill' not in verdicts(filler() + spread(CUR0, NOW, 40, 'new_skill', 'failed', 'x')), 'a skill with no yesterday is not judged')

# ---- stopped: the streak (the page an hour sooner) ----
mid = CUR0 + dt.timedelta(minutes=50)
streak = filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=9)
line = verdicts(streak).get('stopped:skill:dispose_well', '')
check('the last 17 tries, by 9 bots, all failed (11 ok of 28 in the last 2 h)' in line, 'LIVE 11-13 19:20Z shape: 17 failures in a row page while the window still holds 11 successes: ' + line[:120])
check('stopped:skill:dispose_well' not in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 11, 'dispose_well', 'failed', WELL_FAIL, bots=9)), '11 in a row is not yet a streak')
check('stopped:skill:dispose_well' not in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=2)), 'a streak by two bots is not the town')
broken = spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=9)
broken[8] = row(broken[8]['t'], 'dispose_well', 'success')
check('stopped:skill:dispose_well' not in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + broken), 'POSITIVE CONTROL: a success in the middle breaks the streak')
half = filler() + spread(BASE0, CUR0, 40, 'gather') + spread(BASE0, CUR0, 60, 'gather', 'failed', 'x') + spread(CUR0, mid, 3, 'gather') + spread(mid, NOW, 17, 'gather', 'failed', 'x', bots=9)
check('stopped:skill:gather' not in verdicts(half), 'a skill that failed more than half the time yesterday gets no streak page (40%)')
shuffled = list(reversed(streak))
check('stopped:skill:dispose_well' in verdicts(shuffled), 'the streak is read in time order whatever order the rows arrive in')

# ---- collapsed ----
craft = filler() + spread(BASE0, CUR0, 70, 'craft') + spread(BASE0, CUR0, 14, 'craft', 'failed', 'x') + spread(CUR0, NOW, 20, 'craft', 'failed', 'No room for stick: the bag is 36/36') + \
    [row(CUR0 + dt.timedelta(minutes=m), 'craft') for m in (5, 25, 45, 65, 85, 100, 110)]
a = verdicts(craft)
check('collapsed:skill:craft' in a and '7 ok of 27 (26%)' in a['collapsed:skill:craft'] and '70 ok of 84 (83%)' in a['collapsed:skill:craft'], 'LIVE 11-14 00:40Z shape: craft at 26% against 83% is said: ' + a.get('collapsed:skill:craft', '')[:110])
ok_craft = filler() + spread(BASE0, CUR0, 70, 'craft') + spread(BASE0, CUR0, 14, 'craft', 'failed', 'x') + spread(CUR0, NOW, 18, 'craft', 'failed', 'x') + \
    [row(CUR0 + dt.timedelta(minutes=5 + 12 * i), 'craft') for i in range(9)]
check('collapsed:skill:craft' not in verdicts(ok_craft), 'POSITIVE CONTROL: 9 ok of 27 (33%) is above a third of 83%')

# ---- vanished ----
dm = filler() + spread(BASE0, CUR0, 1271, '_work_order', 'success', 'deep_mine {} — the town wants iron') + spread(BASE0, CUR0, 1271, 'deep_mine')
a = verdicts(dm)
check('vanished:order:deep_mine' in a and re.search(r'1271 \(53\.0 an hour, in 2[45] of its hours\)', a['vanished:order:deep_mine']), 'LIVE 11-14 00:40Z shape: an order that no longer comes is said: ' + a.get('vanished:order:deep_mine', '')[:110])
check('vanished:skill:deep_mine' not in a, 'and said once: the skill it orders is not a second line')
check('vanished:skill:patrol' in verdicts(filler() + spread(BASE0, CUR0, 300, 'patrol')), 'a skill nobody orders is said under its own name')
check(not verdicts(filler() + spread(BASE0, CUR0, 1271, '_work_order', 'success', 'deep_mine {} — x') + [row(NOW - dt.timedelta(minutes=3), '_work_order', 'success', 'deep_mine {} — x')]), 'POSITIVE CONTROL: one order in the window and nothing vanished')
burst = filler() + spread(CUR0 - dt.timedelta(hours=5), CUR0 - dt.timedelta(hours=3), 400, 'build_shop')
check('vanished:skill:build_shop' not in verdicts(burst), 'a two-hour burst yesterday is not a habit (2 of 24 hours)')
for k in ('stopped:skill:x', 'stopwatch:showcase'):
    check(AL.tier_of('stopwatch-showcase', k) == AL.TIER_PAGE, f'{k} pages')
for k in ('collapsed:skill:x', 'vanished:order:x', 'blind:activity'):
    check(AL.tier_of('stopwatch-showcase', k) == AL.TIER_DIGEST, f'{k} goes to the digest')

# ---- blind: a host that is not running is not judged ----
quiet = spread(BASE0, CUR0, 2400, 'explore') + base_well + spread(CUR0, NOW, 200, 'explore', bots=3) + spread(CUR0, NOW, 37, 'dispose_well', 'failed', WELL_FAIL, bots=3)
a = verdicts(quiet)
check(set(a) == {'blind:activity'} and '3 bots wrote rows' in a['blind:activity'], 'three bots up: not judged, and it says why: ' + a.get('blind:activity', '')[:90])
thin = spread(BASE0, CUR0, 24000, 'explore') + base_well + spread(CUR0, NOW, 37, 'dispose_well', 'failed', WELL_FAIL)
a = verdicts(thin)
check(set(a) == {'blind:activity'} and 'rows an hour' in a['blind:activity'], 'a tenth of the usual rows: not judged')
rep = SW.collect(dead, NOW, 'showcase')
check(rep['control'] == {'key': 'skill:explore', 'ok': 200} and 'most successes now: skill:explore (200)' in rep['summary'], 'the positive control is in every report: ' + rep['summary'][-60:])
check(rep['rows'] == {'cur': 237, 'base': 2692} and rep['bots'] == {'cur': 10, 'base': 10}, f"and the denominators ({rep['rows']}, {rep['bots']})")

# ---- through the real reader, in the logs' own shape ----
with tempfile.TemporaryDirectory() as logs:
    by = {}
    for r in dead:
        by.setdefault(r['bot']['name'], []).append(r)
    for bot, rs in by.items():
        os.makedirs(os.path.join(logs, bot))
        with open(os.path.join(logs, bot, 'skill-2026-11-13.jsonl'), 'w') as f:
            for r in sorted(rs, key=lambda r: r['t']):
                f.write(json.dumps({'@timestamp': r['t'].isoformat().replace('+00:00', 'Z'), 'bot': {'name': bot},
                                    'skill': {'name': r['name'], 'status': r['status'], 'detail': r['detail']}}) + '\n')
            f.write(json.dumps({'@timestamp': (NOW - dt.timedelta(minutes=1)).isoformat(), 'bot': {'name': 'FIXTURE-x'}, 'skill': {'name': 'dispose_well', 'status': 'success'}}) + '\n')
    rows = SW.load_rows(os.path.join(logs, '*', 'skill-*.jsonl*'), BASE0, NOW)
    check(len(rows) == len(dead), f'the reader returns every row and drops the fixture bot ({len(rows)} of {len(dead)})')
    check(set(SW.collect(rows, NOW, 'showcase')['alarms']) == {'stopped:skill:dispose_well'}, 'and the verdict is the same from files')
    with tempfile.TemporaryDirectory() as sd:
        cmd = [sys.executable, '-B', os.path.join(HERE, 'stopwatch.py'), '--label', 'showcase', '--paths', os.path.join(logs, '*', 'skill-*.jsonl*'),
               '--now', NOW.isoformat(), '--state-dir', sd, '--no-push', '--ship', os.path.join(sd, 'hb.jsonl')]
        out = subprocess.run(cmd, capture_output=True, text=True)
        check(out.returncode == 0 and '!! skill:dispose_well STOPPED WORKING' in out.stdout, 'the command prints the alarm')
        st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
        check(list(st['alarms']) == ['stopped:skill:dispose_well'], 'writes its state file')
        check('NEW' in open(os.path.join(sd, 'ALARMS.log')).read(), 'logs the NEW event')
        hb = json.loads(open(os.path.join(sd, 'hb.jsonl')).read().splitlines()[-1])
        check(hb['kind'] == 'showcase_stopwatch' and hb['ok'] is False and hb['event'] == 'stopped_working', 'ships its heartbeat row')
        bad = subprocess.run([sys.executable, '-B', os.path.join(HERE, 'stopwatch.py'), '--label', 'showcase', '--paths', os.path.join(sd, 'nothing-here', '*.jsonl'),
                              '--now', NOW.isoformat(), '--state-dir', sd, '--no-push'], capture_output=True, text=True)
        st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
        check(bad.returncode == 0 and set(st['alarms']) <= {'blind:activity', 'stopwatch:showcase'} and st['alarms'], f"no logs at all is said, never silent health ({sorted(st['alarms'])})")

# ---- mutants: each threshold binds (the anchor must be present and unique) ----
SRC = open(os.path.join(HERE, 'stopwatch.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'stopwatch_mutant', '__file__': os.path.join(HERE, 'stopwatch.py')}
    exec(compile(SRC.replace(old, new), 'stopwatch_mutant', 'exec'), ns)
    return lambda rows: ns['collect'](rows, NOW, 'showcase')['alarms']
one_bot = filler() + base_well + spread(CUR0, NOW, 37, 'dispose_well', 'failed', WELL_FAIL, bots=1)
check('stopped:skill:dispose_well' in mutant("and len(c['bots']) >= CUR_BOTS:", 'and True:')(one_bot), 'MUTANT KILLED: without the bot count one stuck bot pages')
check(any(k.endswith('dispose_well') for k in mutant('worked = counted and b[\'ok\'] >= BASE_OK and b_rate >= BASE_RATE', 'worked = counted')(never)), 'MUTANT KILLED: without "worked yesterday" an always-failing skill pages')
check(set(mutant("    if len(cur_bots) < need:", "    if False:")(quiet)) != {'blind:activity'}, 'MUTANT KILLED: without the bot floor a stopped host is judged')
check('stopped:skill:dispose_well' not in mutant("rows = sorted(rows, key=lambda r: r['t'])", 'rows = list(rows)')(shuffled), 'MUTANT KILLED: without the sort, rows that arrive newest-first hide the streak')
check('stopped:skill:dispose_well' in mutant("s['streak'], s['streak_bots'] = 0, set()", 'pass')(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + broken), 'MUTANT KILLED: a streak that a success does not reset pages on a working well')
sys.exit(1 if fails else 0)
