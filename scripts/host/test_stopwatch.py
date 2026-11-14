#!/usr/bin/env python3
"""stopwatch.py, the stopped-working alarm (11-14). The verdicts are pure functions of two windows of rows and are tested on
rows built here; the reader and the command are tested over files in the logs' own shape. Every "no alarm" case sits beside
the same rows WITH the alarm (the positive control), and the mutants at the end prove each threshold binds. The cases named
"review r1" are the four blockers of the first review (a page that cleared itself, neutral statuses, chance, memory)."""
import datetime as dt, json, os, random, re, subprocess, sys, tempfile
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

H = dt.timedelta(hours=1)
NOW = dt.datetime(2026, 11, 13, 20, 20, tzinfo=dt.timezone.utc)
CUR0 = NOW - SW.CUR_H * H
BASE0 = CUR0 - SW.BASE_H * H
BOTS = ['showcase-%s' % n for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno')]
WELL_FAIL = "could not reach the junk well's standing cell at 12,74,6 (the bot is at 12.48,68.00,6.50); the next town visit tries again"
W = 'stopped:skill:dispose_well'

def row(t, name, status='success', detail='', bot=0):
    return {'t': t, 'name': name, 'status': status, 'detail': detail, 'bot': BOTS[bot % len(BOTS)]}
def spread(lo, hi, n, name, status='success', detail='', bots=10, start=0):
    """n rows of one kind spread evenly over [lo, hi), cycling the bots."""
    step = (hi - lo) / max(1, n)
    return [row(lo + step * i + dt.timedelta(seconds=1), name, status, detail, start + (i % bots)) for i in range(n)]
def filler(now=NOW):
    """a living town in both windows: every bot explores all day (so no window is blind and there is a control key)."""
    c0 = now - SW.CUR_H * H
    return spread(c0 - SW.BASE_H * H, c0, 2400, 'explore') + spread(c0, now, 200, 'explore')
def verdicts(rows, now=NOW, latched=None):
    return SW.collect(rows, now, 'showcase', latched)['alarms']

# ---- keys and statuses ----
check(SW.keys_of(row(NOW, 'dispose_well', 'failed')) == [('skill:dispose_well', False)], 'a failed skill row is a failed try')
check(SW.keys_of(row(NOW, 'dispose_well')) == [('skill:dispose_well', True)], 'a success is a success')
for st in ('no_effect', 'aborted', 'unknown', None):
    check(SW.keys_of(row(NOW, 'town_deposit', st)) == [('skill:town_deposit', None)], f'review r1: status {st} is a run, never a try')
check(SW.keys_of(row(NOW, '_work_order', 'success', 'deep_mine {"y":-40} — because')) == [('order:deep_mine', None)], 'a work order is keyed by its first word')
check(SW.keys_of(row(NOW, '_work_order', 'success', '{"odd":1} text')) == [], 'a work order with no skill word is no key')
check(SW.keys_of(row(NOW, '_place_town')) == [] and SW.keys_of(row(NOW, 'status')) == [], 'instrument rows and probes are never judged')
check(SW.norm_reason(WELL_FAIL) == SW.norm_reason(WELL_FAIL.replace('12.48', '9.60').replace('68.00', '55.75')), 'a refusal at another cell is the same reason')

# ---- stopped: nothing worked ----
base_well = spread(BASE0, CUR0, 248, 'dispose_well') + spread(BASE0, CUR0, 12, 'dispose_well', 'failed', 'a chest was in the way') + spread(BASE0, CUR0, 32, 'dispose_well', 'no_effect', 'a player is near')
dead = filler() + base_well + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL)
a = verdicts(dead)
line = a.get(W, '')
check(set(a) == {W}, f'LIVE 11-13 20:20Z shape: the well alone is named ({sorted(a)})')
check('0 ok of 36 tries by 10 bots in the last 2 h' in line and '248 ok of 260 tries (95%)' in line, 'the line carries both denominators: ' + line[:150])
check("commonest failure x36: could not reach the junk well's standing cell at N,N,N" in line, 'and the commonest failure, numbers folded')
check('last ok 11-13' in line, 'and when it last worked')
alive = filler() + base_well + spread(CUR0, NOW - 10 * dt.timedelta(minutes=1), 36, 'dispose_well', 'failed', WELL_FAIL) + [row(NOW - dt.timedelta(minutes=5), 'dispose_well')]
check(W not in verdicts(alive), 'POSITIVE CONTROL: one success at the end of the same window and it is not "stopped"')
check(W not in verdicts(filler() + base_well + spread(CUR0, NOW, 7, 'dispose_well', 'failed', WELL_FAIL)), 'seven failures are not enough to say so')
one_bot = filler() + base_well + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL, bots=1)
check(W not in verdicts(one_bot), 'one stuck bot is not the town')
loop = filler() + base_well + spread(CUR0, NOW, 30, 'dispose_well', 'failed', WELL_FAIL, bots=1) + [row(NOW - dt.timedelta(minutes=30), 'dispose_well', 'failed', WELL_FAIL, bot=5)]
check(W not in verdicts(loop), 'review r1: one bot looping 30 failures plus one from a second bot is 5 capped failures, not 31')
never = filler() + spread(BASE0, CUR0, 11, 'dispose_well') + spread(BASE0, CUR0, 200, 'dispose_well', 'failed', 'x') + spread(CUR0, NOW, 36, 'dispose_well', 'failed', 'x')
check(not any(k.endswith('dispose_well') for k in verdicts(never)), 'a thing that did not work yesterday either is not news (11 ok of 211)')
thin_base = filler() + spread(BASE0, CUR0, 11, 'dispose_well') + [row(BASE0 + H, 'dispose_well', 'failed', 'x')] + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL)
check(W not in verdicts(thin_base), 'eleven successes yesterday are too few to call it a thing that worked')
check('stopped:skill:new_skill' not in verdicts(filler() + spread(CUR0, NOW, 40, 'new_skill', 'failed', 'x')), 'a skill with no yesterday is not judged')

# ---- review r1: a declined or interrupted skill is not a broken one ----
dep = filler() + spread(BASE0, CUR0, 200, 'town_deposit') + spread(BASE0, CUR0, 200, 'town_deposit', 'no_effect', 'nothing banked') + spread(CUR0, NOW, 20, 'town_deposit', 'no_effect', 'nothing banked: the town holds its stock target')
check(not verdicts(dep), 'town_deposit declining 20 times ("nothing banked") is not stopped, collapsed or vanished')
check('stopped:skill:town_deposit' in verdicts(filler() + spread(BASE0, CUR0, 200, 'town_deposit') + spread(CUR0, NOW, 20, 'town_deposit', 'failed', 'x')), 'POSITIVE CONTROL: the same 20 as failures page')
ab = filler() + spread(BASE0, CUR0, 300, 'gather') + spread(BASE0, CUR0, 100, 'gather', 'failed', 'x') + spread(CUR0, NOW - 15 * dt.timedelta(minutes=1), 30, 'gather') + spread(NOW - 10 * dt.timedelta(minutes=1), NOW, 14, 'gather', 'aborted', 'entombed')
check(not verdicts(ab), 'fourteen gathers aborted by a restart after thirty successes are not a streak')

# ---- review r1: more than chance ----
weak_base = spread(BASE0, CUR0, 30, 'smelt') + spread(BASE0, CUR0, 70, 'smelt', 'failed', 'x')
check('stopped:skill:smelt' not in verdicts(filler() + weak_base + spread(CUR0, NOW, 8, 'smelt', 'failed', 'x')), 'a skill that works 30% of the time failing 8 times is chance (0.7^8 = 6%)')
check('stopped:skill:smelt' in verdicts(filler() + weak_base + spread(CUR0, NOW, 28, 'smelt', 'failed', 'x')), 'POSITIVE CONTROL: failing 28 times by ten bots is not (0.7^28 < 1e-4)')
random.seed(7)
pages = 0
for day in range(20):                                           # a steady 30% skill, 6 tries an hour, judged every hour for 20 days
    t0 = NOW + day * 24 * H
    rows = filler(t0) + [row(t0 - 26 * H + dt.timedelta(minutes=10 * i + 3), 'smelt', 'success' if random.random() < 0.3 else 'failed', 'x', random.randrange(10)) for i in range(156)]
    pages += any(k.startswith('stopped:') for k in verdicts(rows, t0))
check(pages == 0, f'a skill that is simply unreliable never pages over 20 days of windows ({pages} pages)')

# ---- stopped: the streak (the page an hour sooner) ----
mid = CUR0 + dt.timedelta(minutes=64)
streak = filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=9)
line = verdicts(streak).get(W, '')
check('the last 17 tries, by 9 bots since 19:24Z, all failed (11 ok of 28 in the last 2 h)' in line, 'LIVE 11-13 19:20Z shape: 17 failures in a row page while the window still holds 11 successes: ' + line[:130])
check(W not in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 11, 'dispose_well', 'failed', WELL_FAIL, bots=9)), '11 in a row is not yet a streak')
check(W not in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=2)), 'a streak by two bots is 8 capped failures: not the town')
broken = spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=9)
broken[8] = row(broken[8]['t'], 'dispose_well', 'success')
reset_case = filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + broken
check(W not in verdicts(reset_case), 'POSITIVE CONTROL: a success in the middle breaks the streak')
skip = spread(mid, NOW, 17, 'dispose_well', 'failed', WELL_FAIL, bots=9)
skip[8] = row(skip[8]['t'], 'dispose_well', 'no_effect', 'a player is near')
check(W in verdicts(filler() + base_well + spread(CUR0, mid, 11, 'dispose_well') + skip), 'a declined run in the middle neither breaks the streak nor counts in it')
burst = filler() + base_well + spread(CUR0, NOW - 3 * dt.timedelta(minutes=1), 20, 'dispose_well') + spread(NOW - 90 * dt.timedelta(seconds=1), NOW, 12, 'dispose_well', 'failed', WELL_FAIL, bots=3)
check(W not in verdicts(burst), 'review r1: twelve failures inside ninety seconds are one event, not a streak')
shuffled = list(reversed(streak))
check(W in verdicts(shuffled), 'the streak is read in time order whatever order the rows arrive in')

# ---- review r1: THE LATCH -- a page stays up until the thing works again ----
def day_rows(now, broke_at, per_h_ok=10, per_h_bad=18, after=None):
    """a well at 10 ok + 2 failed an hour that breaks for good at broke_at; `after` failures an hour from then on."""
    out = filler(now); t = now - 26 * H
    while t < now:
        if t < broke_at:
            out += spread(t, min(t + H, broke_at), per_h_ok, 'dispose_well') + spread(t, t + H, 2, 'dispose_well', 'failed', 'a chest was in the way')
        else:
            out += spread(t, t + H, per_h_bad if after is None else after, 'dispose_well', 'failed', WELL_FAIL)
        t += H
    return out
BROKE = NOW - 1 * H
latch, seen = {}, []
for h in range(0, 30):                                          # judged every hour for 30 h after the break
    now = NOW + h * H
    rep = SW.collect(day_rows(now, BROKE), now, 'showcase', latch)
    latch = rep['latched']; seen.append(W in rep['alarms'])
check(all(seen), f'the baseline slides under BASE_RATE at +17 h and the page STAYS (up in {sum(seen)} of 30 hourly runs)')
unlatched = [W in verdicts(day_rows(NOW + h * H, BROKE), NOW + h * H) for h in range(0, 30)]
check(not all(unlatched), f'POSITIVE CONTROL: without the latch the same page drops out by itself ({sum(unlatched)} of 30)')
latch, seen = {}, []
for h in range(0, 12):
    now = NOW + h * H
    rep = SW.collect(day_rows(now, BROKE, after=(18 if h < 2 else 1)), now, 'showcase', latch)
    latch = rep['latched']; seen.append(W in rep['alarms'])
check(all(seen), 'a scheduler that backs off to one try an hour does not clear it')
rep = SW.collect(spread(BASE0, CUR0, 2400, 'explore') + base_well, NOW, 'showcase', {'skill:dispose_well': {'since': '2026-11-13T19:20:00Z', 'line': 'x'}})
check(set(rep['alarms']) == {'blind:activity', W} and 'STILL STOPPED (said 2026-11-13T19:20:00Z)' in rep['alarms'][W], 'a host gone quiet keeps the page beside its blind line')
rep = SW.collect(alive, NOW, 'showcase', {'skill:dispose_well': {'since': '2026-11-13T19:20:00Z', 'line': 'x'}})
check(W not in rep['alarms'] and rep['released'] == ['skill:dispose_well'] and rep['latched'] == {} and 'works again: skill:dispose_well' in rep['summary'], 'ONE SUCCESS releases it, and the summary says it works again')
rep = SW.collect(dead, NOW, 'showcase', {'skill:dispose_well': {'since': '2026-11-13T19:20:00Z', 'line': 'x'}})
check(rep['latched']['skill:dispose_well']['since'] == '2026-11-13T19:20:00Z', 'a key still judged stopped keeps the time it was first said')
# Codex review r1: the last success BEFORE the break is still inside CUR for two hours -- it is not a recovery
pre = NOW - dt.timedelta(minutes=50)
st_rows = filler() + base_well + [row(pre, 'dispose_well')] + spread(pre + dt.timedelta(minutes=2), NOW - dt.timedelta(minutes=1), 13, 'dispose_well', 'failed', WELL_FAIL, bots=5)
rep = SW.collect(st_rows, NOW, 'showcase')
la = rep['latched'].get('skill:dispose_well') or {}
check(W in rep['alarms'] and AL._ts_or_none(la.get('after')) and AL._ts_or_none(la['after']) > pre, f"a streak page latches with the time of its newest failure ({la.get('after')})")
nxt = NOW + H                                                   # an hour on: three bots up, the 19:30 success still in the window
quiet_next = spread(nxt - 26 * H, nxt - 2 * H, 2400, 'explore') + [row(pre, 'dispose_well')] + spread(nxt - 2 * H, nxt, 200, 'explore', bots=3)
rep2 = SW.collect(quiet_next, nxt, 'showcase', rep['latched'])
check(W in rep2['alarms'] and rep2['released'] == [], 'the success from before the break does not release the latch an hour later')
rep3 = SW.collect(quiet_next + [row(nxt - dt.timedelta(minutes=4), 'dispose_well')], nxt, 'showcase', rep['latched'])
check(W not in rep3['alarms'] and rep3['released'] == ['skill:dispose_well'], 'POSITIVE CONTROL: a success after its newest failure does')
# Codex r2: a second break moves `after` forward -- a success between the two breaks is not a recovery from the second
old_latch = {'skill:dispose_well': {'since': '2026-11-13T15:00:00Z', 'after': '2026-11-13T15:00:00Z', 'line': 'x'}}
rep4 = SW.collect(st_rows, NOW, 'showcase', old_latch)
check(rep4['latched']['skill:dispose_well']['after'] == la['after'] and rep4['latched']['skill:dispose_well']['since'] == '2026-11-13T15:00:00Z', 'a verdict raised again moves `after` to its own newest failure and keeps `since`')
check(W in SW.collect(quiet_next, nxt, 'showcase', rep4['latched'])['alarms'], 'so the success between the two breaks does not release it')
# Codex r2: a latch with no `after` is judged against `since`; with neither it is kept
check(W in SW.collect(quiet_next, nxt, 'showcase', {'skill:dispose_well': {'since': NOW.isoformat(), 'line': 'x'}})['alarms'], 'no `after`: a success older than `since` does not release')
check(W not in SW.collect(quiet_next, nxt, 'showcase', {'skill:dispose_well': {'since': (pre - H).isoformat(), 'line': 'x'}})['alarms'], 'POSITIVE CONTROL: a success newer than `since` does')
check(W in SW.collect(quiet_next + [row(nxt - dt.timedelta(minutes=4), 'dispose_well')], nxt, 'showcase', {'skill:dispose_well': {'line': 'x'}})['alarms'], 'neither time readable: kept (released by hand)')

# ---- collapsed ----
craft = filler() + spread(BASE0, CUR0, 70, 'craft') + spread(BASE0, CUR0, 14, 'craft', 'failed', 'x') + spread(CUR0, NOW, 20, 'craft', 'failed', 'No room for stick: the bag is 36/36') + \
    [row(CUR0 + dt.timedelta(minutes=m), 'craft') for m in (5, 25, 45, 65, 85, 100, 110)]
a = verdicts(craft)
check('collapsed:skill:craft' in a and '7 ok of 27 (26%)' in a['collapsed:skill:craft'] and '70 ok of 84 tries (83%)' in a['collapsed:skill:craft'], 'craft at 26% against 83% is said: ' + a.get('collapsed:skill:craft', '')[:110])
ok_craft = filler() + spread(BASE0, CUR0, 70, 'craft') + spread(BASE0, CUR0, 14, 'craft', 'failed', 'x') + spread(CUR0, NOW, 18, 'craft', 'failed', 'x') + \
    [row(CUR0 + dt.timedelta(minutes=5 + 12 * i), 'craft') for i in range(9)]
check('collapsed:skill:craft' not in verdicts(ok_craft), 'POSITIVE CONTROL: 9 ok of 27 (33%) is above a third of 83%')
few = filler() + spread(BASE0, CUR0, 70, 'craft') + spread(BASE0, CUR0, 14, 'craft', 'failed', 'x') + spread(CUR0, NOW, 15, 'craft', 'failed', 'x', bots=1) + [row(CUR0 + dt.timedelta(minutes=5), 'craft')]
check('collapsed:skill:craft' not in verdicts(few), 'sixteen tries are too few to call a collapse')

# ---- vanished ----
dm = filler() + spread(BASE0, CUR0, 1271, '_work_order', 'success', 'deep_mine {} — the town wants iron') + spread(BASE0, CUR0, 1271, 'deep_mine')
a = verdicts(dm)
check('vanished:order:deep_mine' in a and re.search(r'1271 \(53\.0 an hour, in 2[45] of its hours\)', a['vanished:order:deep_mine']), 'LIVE 11-14 shape: an order that no longer comes is said: ' + a.get('vanished:order:deep_mine', '')[:110])
check('vanished:skill:deep_mine' not in a, 'and said once: the skill it orders is not a second line')
check('vanished:skill:patrol' in verdicts(filler() + spread(BASE0, CUR0, 300, 'patrol')), 'a skill nobody orders is said under its own name')
check('vanished:skill:patrol' in verdicts(filler() + spread(BASE0, CUR0, 300, 'patrol') + [row(BASE0 + H, '_work_order', 'success', 'patrol {} — once')]), 'review r1: one stray order yesterday does not hide a vanished skill')
check(not verdicts(filler() + spread(BASE0, CUR0, 1271, '_work_order', 'success', 'deep_mine {} — x') + [row(NOW - dt.timedelta(minutes=3), '_work_order', 'success', 'deep_mine {} — x')]), 'POSITIVE CONTROL: one order in the window and nothing vanished')
check('vanished:skill:build_shop' not in verdicts(filler() + spread(CUR0 - 5 * H, CUR0 - 3 * H, 400, 'build_shop')), 'a two-hour burst yesterday is not a habit (2 of 24 hours)')
check('vanished:skill:rare' not in verdicts(filler() + spread(BASE0, CUR0, 80, 'rare')), 'a skill run 3 times an hour is too rare to miss in two hours')
for k in ('stopped:skill:x', 'stopwatch:showcase'):
    check(AL.tier_of('stopwatch-showcase', k) == AL.TIER_PAGE, f'{k} pages')
for k in ('collapsed:skill:x', 'vanished:order:x', 'blind:activity'):
    check(AL.tier_of('stopwatch-showcase', k) == AL.TIER_DIGEST, f'{k} goes to the digest')

# ---- blind: a host that is not running is not judged ----
quiet = spread(BASE0, CUR0, 2400, 'explore') + base_well + spread(CUR0, NOW, 200, 'explore', bots=3) + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL, bots=3)
a = verdicts(quiet)
check(set(a) == {'blind:activity'} and '3 bots wrote rows' in a['blind:activity'], 'three bots up: not judged, and it says why: ' + a.get('blind:activity', '')[:90])
seven = spread(BASE0, CUR0, 2400, 'explore') + base_well + spread(CUR0, NOW, 200, 'explore', bots=7) + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL, bots=7)
check(set(verdicts(seven)) == {'blind:activity'}, 'seven bots are still under the showcase floor of eight')
thin = spread(BASE0, CUR0, 24000, 'explore') + base_well + spread(CUR0, NOW, 300, 'explore') + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL)
a = verdicts(thin)
check(set(a) == {'blind:activity'} and 'rows an hour' in a['blind:activity'], 'a sixth of the usual rows: not judged')
rep = SW.collect(dead, NOW, 'showcase')
check(rep['control'] == {'key': 'skill:explore', 'ok': 200} and 'most successes now: skill:explore (200)' in rep['summary'], 'the positive control is in every report: ' + rep['summary'][-60:])
check(rep['rows'] == {'cur': 236, 'base': 2692} and rep['bots'] == {'cur': 10, 'base': 10}, f"and the denominators ({rep['rows']}, {rep['bots']})")

# ---- the reader and the command, over files in the logs' own shape ----
def write_logs(root, rows, extra=()):
    by = {}
    for r in rows:
        by.setdefault(r['bot'], []).append(r)
    for bot, rs in by.items():
        os.makedirs(os.path.join(root, bot), exist_ok=True)
        with open(os.path.join(root, bot, f'skill-{bot}.jsonl'), 'w') as f:
            for r in sorted(rs, key=lambda r: r['t']):
                f.write('{"@timestamp":"%sZ",' % r['t'].strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + json.dumps({'bot': {'name': bot, 'inventory': {'cobblestone': 695}},
                        'skill': {'name': r['name'], 'status': r['status'], 'detail': r['detail']}})[1:] + '\n')
            for line in extra:
                f.write(line + '\n')
with tempfile.TemporaryDirectory() as logs, tempfile.TemporaryDirectory() as sd:
    write_logs(logs, dead, extra=['{"@timestamp":"%sZ","bot":{"name":"x"},"llm":{"x":1}}' % NOW.strftime('%Y-%m-%dT%H:%M:%S.000'), 'not json at all'])
    os.makedirs(os.path.join(logs, 'showcase-FIXTURE')); os.makedirs(os.path.join(logs, '_pool-showcase'))
    open(os.path.join(logs, 'showcase-FIXTURE', 'skill-showcase-FIXTURE.jsonl'), 'w').write('{"@timestamp":"%sZ","bot":{"name":"showcase-FIXTURE"},"skill":{"name":"dispose_well","status":"success"}}\n' % (NOW - dt.timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M:%S.000'))
    rows = SW.load_rows(logs, BASE0, NOW)
    check(len(rows) == len(dead), f'the reader returns every skill row and drops the fixture bot, the non-skill line and the torn line ({len(rows)} of {len(dead)})')
    check(set(rows[0]) == {'t', 'name', 'status', 'detail', 'bot'}, 'review r1: five small fields a row, never the raw row')
    check(set(SW.collect(rows, NOW, 'showcase')['alarms']) == {W}, 'and the verdict is the same from files')
    cmd = [sys.executable, '-B', os.path.join(HERE, 'stopwatch.py'), '--label', 'showcase', '--logs', logs, '--state-dir', sd, '--no-push']
    out = subprocess.run(cmd + ['--now', NOW.isoformat(), '--ship', os.path.join(sd, 'hb.jsonl')], capture_output=True, text=True)
    check(out.returncode == 0 and '!! skill:dispose_well STOPPED WORKING' in out.stdout, 'the command prints the alarm')
    st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
    check(list(st['alarms']) == [W] and list(st['latched']) == ['skill:dispose_well'], 'writes its state file, the latch in it')
    check('NEW' in open(os.path.join(sd, 'ALARMS.log')).read(), 'logs the NEW event')
    hb = json.loads(open(os.path.join(sd, 'hb.jsonl')).read().splitlines()[-1])
    check(hb['kind'] == 'showcase_stopwatch' and hb['ok'] is False and hb['event'] == 'stopped_working', 'ships its heartbeat row')
    # the next hour the logs are gone quiet (three bots): the page is held from the state file
    with tempfile.TemporaryDirectory() as logs2:
        write_logs(logs2, quiet)
        out = subprocess.run(cmd[:6] + [logs2] + cmd[7:] + ['--now', NOW.isoformat()], capture_output=True, text=True)
        st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
        check(set(st['alarms']) == {'blind:activity', W}, f"the command holds the latch across runs ({sorted(st['alarms'])})")
        log = open(os.path.join(sd, 'ALARMS.log')).read()
        check('CLEARED' not in log, 'and no CLEARED was written for the well')
        out = subprocess.run(cmd[:6] + [logs2] + cmd[7:] + ['--now', NOW.isoformat(), '--release', 'skill:dispose_well'], capture_output=True, text=True)
        st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
        check(set(st['alarms']) == {'blind:activity'} and st['latched'] == {}, '--release drops a latch by hand')
    # a crash pages under its own key and keeps what was latched
    json.dump({'latched': {'skill:dispose_well': {'since': '2026-11-13T19:20:00Z', 'line': 'x'}}}, open(os.path.join(sd, 'stopwatch-showcase.json'), 'w'))
    notdir = os.path.join(sd, 'a-file'); open(notdir, 'w').write('x')
    out = subprocess.run(cmd[:6] + [notdir] + cmd[7:] + ['--now', NOW.isoformat()], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
    check(out.returncode == 0 and set(st['alarms']) == {'stopwatch:showcase', W} and 'CHECK FAILED' in out.stdout, f"a run that cannot read pages as stopwatch:showcase and keeps the latch ({sorted(st['alarms'])})")
    # Codex review r1: a state file that cannot be read loses no latch, and says so
    open(os.path.join(sd, 'stopwatch-showcase.json'), 'w').write('{"latched": {"skill:dispose')
    json.dump({W: {'since': 's', 'last_push': NOW.isoformat(), 'line': 'x'}, 'vanished:order:x': {'since': 's', 'last_push': NOW.isoformat(), 'line': 'y'}}, open(os.path.join(sd, 'stopwatch-showcase.pushstate.json'), 'w'))
    open(os.path.join(sd, 'ALARMS.log'), 'w').close()
    with tempfile.TemporaryDirectory() as logs3:
        write_logs(logs3, filler() + base_well)                 # the well is simply not tried in CUR: nothing would re-raise it
        out = subprocess.run(cmd[:6] + [logs3] + cmd[7:] + ['--now', NOW.isoformat()], capture_output=True, text=True)
        st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
        check(set(st['alarms']) == {'stopwatch:showcase', W} and 'unreadable' in st['alarms']['stopwatch:showcase'], f"a torn state file: the stopped key is taken back from the push state and the loss pages ({sorted(st['alarms'])})")
        check('CLEARED' not in ''.join(l for l in open(os.path.join(sd, 'ALARMS.log')) if 'stopped:' in l), 'and the well is not CLEARED')
        # Codex review r1: a log file that cannot be read fails the run instead of paging "no success seen"
        os.remove(os.path.join(sd, 'stopwatch-showcase.json')); os.remove(os.path.join(sd, 'stopwatch-showcase.pushstate.json'))
        gen = os.path.join(logs3, BOTS[0], f'skill-{BOTS[0]}.jsonl-20261113')
        open(gen, 'w').write('{"@timestamp":"%sZ","bot":{"name":"%s"},"skill":{"name":"dispose_well","status":"success"}}\n' % ((NOW - dt.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%S.000'), BOTS[0]))
        os.chmod(gen, 0)
        try:
            errs = []
            from lib import telemetry as TM
            n_quiet = sum(1 for _ in TM.stream_rows(logs3, BOTS[0], BASE0, NOW, 'skill'))
            n_said = sum(1 for _ in TM.stream_rows(logs3, BOTS[0], BASE0, NOW, 'skill', errors=errs))
            check(n_quiet == n_said and len(errs) == 1 and 'PermissionError' in errs[0], f'stream_rows passes an unreadable file over as before, and names it when asked ({errs})')
            out = subprocess.run(cmd[:6] + [logs3] + cmd[7:] + ['--now', NOW.isoformat()], capture_output=True, text=True)
            st = json.load(open(os.path.join(sd, 'stopwatch-showcase.json')))
            check(set(st['alarms']) == {'stopwatch:showcase'} and 'could not be read' in st['alarms']['stopwatch:showcase'], f"an unreadable log file is a failed run, never a verdict ({sorted(st['alarms'])})")
        finally:
            os.chmod(gen, 0o644)
    empty = os.path.join(sd, 'empty'); os.makedirs(empty)
    out = subprocess.run(cmd[:6] + [empty] + cmd[7:] + ['--now', NOW.isoformat(), '--no-state'], capture_output=True, text=True)
    check('NOT JUDGED' in out.stdout and '0 bots wrote rows' in out.stdout, 'no logs at all is said as not judged, never as health')
    out = subprocess.run(cmd + ['--now', '2026-11-13T20:20:00', '--no-state'], capture_output=True, text=True)
    check(out.returncode == 0 and ('CHECK FAILED' in out.stdout or 'stopped' in out.stdout), 'a --now without a zone does not crash the run')

# ---- mutants: each rule binds (the anchor must be present and unique) ----
SRC = open(os.path.join(HERE, 'stopwatch.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'stopwatch_mutant', '__file__': os.path.join(HERE, 'stopwatch.py')}
    exec(compile(SRC.replace(old, new), 'stopwatch_mutant', 'exec'), ns)
    return lambda rows, latched=None: ns['collect'](rows, NOW, 'showcase', latched)['alarms']
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
killed('without the bot count one stuck bot pages', W in mutant("and len(c['fail_by_bot']) >= CUR_BOTS and", 'and')(filler() + base_well + spread(CUR0, NOW, 36, 'dispose_well', 'failed', WELL_FAIL, bots=1) + []) or W in mutant("    return sum(min(n, BOT_CAP) for n in by_bot.values())", "    return sum(by_bot.values())")(one_bot))
killed('without the per-bot cap a looping bot pages', W in mutant("    return sum(min(n, BOT_CAP) for n in by_bot.values())", "    return sum(by_bot.values())")(loop))
killed('without the BASE_OK floor eleven successes are a baseline', W in mutant("worked = counted and b['ok'] >= BASE_OK and b_rate >= BASE_RATE", 'worked = counted and b_rate >= BASE_RATE')(thin_base))
killed('with no_effect counted as a failure, a declining town_deposit pages', 'stopped:skill:town_deposit' in mutant("True if st == 'success' else False if st in FAIL else None", "st == 'success'")(dep))
killed('without the chance guard an unreliable skill pages on 8 failures', 'stopped:skill:smelt' in mutant("len(c['fail_by_bot']) >= CUR_BOTS and (1 - b_rate) ** n_all <= CHANCE:", "len(c['fail_by_bot']) >= CUR_BOTS:")(filler() + weak_base + spread(CUR0, NOW, 8, 'smelt', 'failed', 'x')))
killed('without the span a ninety-second burst pages', W in mutant('n_run >= STREAK_TRIES and span >= STREAK_SPAN and', 'n_run >= STREAK_TRIES and')(burst))
killed('a streak that a success does not reset pages on a working well', W in mutant("s['streak_by_bot'], s['streak_from'], s['streak_to'] = Counter(), None, None", 'pass')(reset_case))
killed('without the sort, rows that arrive newest-first hide the streak', W not in mutant("rows = sorted(rows, key=lambda r: r['t'])", 'rows = list(rows)')(shuffled))
killed('without the latch a held page is dropped', W not in mutant("        keep[key] = was\n", "        continue\n")(spread(BASE0, CUR0, 2400, 'explore') + base_well, {'skill:dispose_well': {'since': 's', 'line': 'x'}}))
ns2_ = {'__name__': 'stopwatch_mutant', '__file__': os.path.join(HERE, 'stopwatch.py')}
old2_ = "'after': AL._iso(c['streak_to'] or now), 'line': line}"
assert SRC.count(old2_) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old2_
exec(compile(SRC.replace(old2_, "'after': was.get('after') or AL._iso(c['streak_to'] or now), 'line': line}"), 'stopwatch_mutant', 'exec'), ns2_)
stale = ns2_['collect'](st_rows, NOW, 'showcase', old_latch)['latched']
killed('an `after` that never moves lets a success between two breaks release', W not in ns2_['collect'](quiet_next, nxt, 'showcase', stale)['alarms'])
killed('a latch that a success does not release never clears', W in mutant("        if c['last_ok'] is not None and after is not None and c['last_ok'] > after:\n            released.append(key)\n            continue\n", '')(alive, {'skill:dispose_well': {'since': '2026-11-13T19:20:00Z', 'line': 'x'}}))
ns_ = {'__name__': 'stopwatch_mutant', '__file__': os.path.join(HERE, 'stopwatch.py')}
old_ = "if c['last_ok'] is not None and after is not None and c['last_ok'] > after:"
assert SRC.count(old_) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old_
exec(compile(SRC.replace(old_, "if c['ok'] > 0:"), 'stopwatch_mutant', 'exec'), ns_)
killed('a latch released by any success in the window is released by the one before the break', W not in ns_['collect'](quiet_next, nxt, 'showcase', rep['latched'])['alarms'])
killed('without the bot floor a stopped host is judged', set(mutant("    if len(cur_bots) < need:", "    if False:")(quiet)) != {'blind:activity'})
killed('without the row floor a thin host is judged', set(mutant("if base_n and (cur_n / cur_h) < MIN_ROW_SHARE * (base_n / base_h):", "if False:")(thin)) != {'blind:activity'})
killed('without the habit rule a rare skill is called vanished', 'vanished:skill:rare' in mutant("return bool(b) and len(b['hours']) >= VANISH_HOURS and b['runs'] / base_h >= VANISH_PER_H", "return bool(b)")(filler() + spread(BASE0, CUR0, 80, 'rare')))
killed('without the collapse floor sixteen tries are a collapse', 'collapsed:skill:craft' in mutant("worked and c_tries >= COLLAPSE_TRIES and c['ok'] > 0", "worked and c['ok'] > 0")(few))
sys.exit(1 if fails else 0)
