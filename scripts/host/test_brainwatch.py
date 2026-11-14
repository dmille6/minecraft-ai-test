#!/usr/bin/env python3
"""brainwatch.py, the model-dark alarm (11-14). The verdict is a pure function of journal lines and a unit count, tested on
lines in the journal's own shape (copied from the showcase's 11-14 08:27-08:31Z break). Every "no alarm" case sits beside the
same lines WITH the alarm, and the mutants at the end prove each threshold binds."""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import brainwatch as BW  # noqa: E402
from lib import alarm as AL  # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

def R(unit, msg, sec=0):
    return {'unit': unit, 'msg': msg, 't': str(1794644826000000 + sec * 1000000)}
def dec(unit, ms=2665, skill='explore', sec=6):
    return R(unit, f'[2026-11-14T08:27:{sec:02d}.964Z] INFO  LLM -> {skill} args={{"blocks":30}} reason=I am stuck and need to move to a new area. ms={ms}', sec)
def rej(unit, sec=13):
    return R(unit, f'[2026-11-14T08:31:{sec:02d}.775Z] WARN  decision rejected why=all 1 llm endpoint(s) failed; last: fetch failed raw=', 240 + sec)
def epl(unit):
    return R(unit, '[2026-11-14T08:31:13.771Z] WARN  llm endpoint failing (no alternative, will keep trying) endpoint=http://127.0.0.1:11612 fails=2 err=fetch failed', 247)
def J(rows):
    """rows -> `journalctl -o json` text (the command's input)."""
    return '\n'.join(json.dumps({'MESSAGE': r['msg'], '_SYSTEMD_UNIT': r['unit'], '__REALTIME_TIMESTAMP': r['t'], '_PID': '1'}) for r in rows)
PIDS = ['mcshow@showcase-%s.service' % n for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno', 'Kite', 'Lumen', 'Maple', 'Onyx')]
ORDERS = [dec(p, 0, 'town_deposit') for p in PIDS[:5]]
DARK = [rej(p, 10 + i) for i in range(18) for p in PIDS] + [epl(p) for p in PIDS] + ORDERS          # 252 failures, 0 decisions
FINE = [dec(p, 2000 + i, sec=i) for i in range(8) for p in PIDS] + ORDERS                           # 112 decisions
def verdict(lines, up=14, label='showcase', **kw):
    return BW.judge(BW.tally(lines), up, label, **kw)

# ---- the tally ----
t = BW.tally(DARK)
check((t['failed'], t['decided'], t['ordered'], len(t['units_failed'])) == (252, 0, 5, 14), f"the break: 252 failures by 14 bots, 0 decisions, 5 work orders ({t['failed']}, {t['decided']}, {t['ordered']}, {len(t['units_failed'])})")
check(dict(t['endpoints']) == {'http://127.0.0.1:11612': 14} and dict(t['errors']) == {'fetch failed': 252}, 'the endpoint and the error are read from the lines')
t = BW.tally(FINE)
check((t['decided'], t['ordered'], t['failed'], len(t['units_decided'])) == (112, 5, 0, 14), 'POSITIVE CONTROL: the same reader counts 112 decisions by 14 bots before the break')
check(t['last_decided'] == str(1794644826000000 + 7 * 1000000), 'and the newest decision time')
check(BW.rows_of('-- No entries --\n\n   \n') == [] and BW.tally([])['lines'] == 0, "journalctl's own empty answer is no row")
check(BW.tally([R('u', 'something else')])['other'] == 1, 'a row that is neither is counted as other, never as a decision')
check(BW.tally([dec('u', 0)])['decided'] == 0 and BW.tally([dec('u', 0)])['ordered'] == 1, 'ms=0 is a work order: no model was asked')
rt = BW.rows_of(J(DARK[:3]) + '\nnot json\n' + json.dumps({'MESSAGE': list(DARK[0]['msg'].encode()), '_SYSTEMD_UNIT': PIDS[0]}))
check(len(rt) == 4 and rt[0] == {'unit': PIDS[0], 'msg': DARK[0]['msg'], 't': DARK[0]['t']} and rt[3]['msg'] == DARK[0]['msg'], 'the journal JSON is read: unit, message (a byte-list message too), time; a broken line is skipped')
check(BW.tally([rej('mcshow@showcase-FIXTURE-1.service', i) for i in range(30)])['failed'] == 0, 'a FIXTURE unit is never counted')
check(len(BW.tally([rej(PIDS[0], i) for i in range(40)])['units_failed']) == 1, 'review r1: one bot is one UNIT however often it restarts (the journal names the unit, not the PID)')

# ---- the verdict ----
a, s = verdict(DARK, hint='systemctl status showcase-studio-tunnel', since='2026-11-14T08:31:13Z')
line = a.get('dark:model', '')
check(set(a) == {'dark:model'}, f'LIVE 11-14 shape: the model is dark ({sorted(a)})')
check('0 model decisions and 252 endpoint failures by 14 of 14 bots in the last 10 min' in line, 'the line carries the denominators: ' + line[:140])
check('http://127.0.0.1:11612: fetch failed' in line and 'since 2026-11-14T08:31:13Z' in line and line.endswith('-- systemctl status showcase-studio-tunnel'), 'and the endpoint, the error, since when, and where to look')
a, s = verdict(FINE)
check(a == {} and 'the model answers' in s and '112 model decisions by 14 bots' in s, 'POSITIVE CONTROL: decisions and no failures is no alarm, and the summary says the count: ' + s[:90])
flap = FINE + [rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:8]]                   # 22 failures against 112 decisions
check(verdict(flap)[0] == {}, 'a flap (22 failures beside 112 decisions, 16 %) is not dark')
mostly = [rej(p, 10 + i) for i in range(6) for p in PIDS] + [dec(p) for p in PIDS]      # 84 failures, 14 decisions: 86 %
check('dark:model' in verdict(mostly)[0], 'mostly dark (84 failures beside 14 decisions, 86 %) is dark')
check(verdict([rej(PIDS[0], i) for i in range(40)])[0] == {}, 'forty failures by ONE bot are that bot, not the town')
check('dark:model' in verdict([rej(PIDS[i % 2], i) for i in range(40)])[0], 'POSITIVE CONTROL: the same forty by two bots are dark')
check(verdict([rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:5]])[0] == {}, 'nineteen failures are under the floor')
check('dark:model' in verdict([rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:6]])[0], 'POSITIVE CONTROL: twenty are not')
a, s = verdict(DARK, up=3)
check(a == {} and 'not judged' in s and 'need 8' in s, 'three running units: a stopped host is haltwatch\'s page, not this one\'s')
check(verdict(DARK, up=20, label='fleet')[0] == {} and 'dark:model' in verdict(DARK, up=60, label='fleet')[0], 'the fleet needs 40 units to be judged')
a, s = verdict(ORDERS)
check(set(a) == {'blind:journal'} and 'NOT JUDGED' in s, 'bots running, no decision and no failure: said as blind, never as "the model answers"')
check(AL.tier_of('brainwatch-showcase', 'dark:model') == AL.TIER_PAGE and AL.tier_of('brainwatch-showcase', 'brainwatch:showcase') == AL.TIER_PAGE, 'dark and the watcher\'s own failure PAGE')
check(AL.tier_of('brainwatch-showcase', 'blind:journal') == AL.TIER_DIGEST, 'blind is for the digest')

# ---- the latch (review r1) ----
T0 = '2026-11-14T08:35:00Z'
few = BW.tally([rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:5]])
check('dark:model' in BW.hold({}, 's', few, T0, 'showcase')[0] and BW.hold({}, 's', few, T0, 'showcase')[2] == T0, 'latched, a window under the floor keeps the page and its since')
check(BW.hold({}, 's', few, None, 'showcase') == ({}, 's', None), 'POSITIVE CONTROL: not latched, the same window is no page')
check(BW.hold({}, 's', BW.tally(FINE), T0, 'showcase') == ({}, 's', None), 'a window of decisions releases it')
one = BW.tally([rej(p, 10 + i) for i in range(1) for p in PIDS] + [dec(PIDS[0])])            # 14 failures, 1 decision: 93 % failing
check('dark:model' in BW.hold({}, 's', one, T0, 'showcase')[0], 'one decision among fourteen failures is not a recovery')
check(BW.recovered(BW.tally([dec(PIDS[0])])) and not BW.recovered(BW.tally(ORDERS)), 'recovered needs a model decision; work orders are not one')
check('could not read the journal' in BW.hold({}, '', None, T0, 'showcase')[0]['dark:model'], 'a run with no tally keeps the page and says why')

# ---- the command: state, since, cleared, a failed read ----
with tempfile.TemporaryDirectory() as td:
    sd = os.path.join(td, 'digest'); os.makedirs(sd)
    jf = os.path.join(td, 'j.txt')
    cmd = [sys.executable, '-B', os.path.join(HERE, 'brainwatch.py'), '--label', 'showcase', '--state-dir', sd, '--no-push', '--units', '14',
           '--journal-file', jf, '--ship', os.path.join(sd, 'hb.jsonl')]
    open(jf, 'w').write(J(DARK))
    out = subprocess.run(cmd + ['--now', '2026-11-14T08:35:00Z'], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    check(out.returncode == 0 and '!! SHOWCASE MODEL DARK since 2026-11-14T08:35:00Z' in out.stdout, 'the command prints the page: ' + out.stdout.strip()[-150:] + out.stderr[-200:])
    check(st['dark_since'] == '2026-11-14T08:35:00Z' and st['counts']['failed'] == 252 and st['counts']['units_failed'] == 14, 'the state file holds since when and the counts')
    log = open(os.path.join(sd, 'ALARMS.log')).read()
    check('NEW' in log and 'brainwatch-showcase' in log and 'dark:model' in log, 'ALARMS.log has the NEW event')
    out = subprocess.run(cmd + ['--now', '2026-11-14T08:40:00Z'], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    check(st['dark_since'] == '2026-11-14T08:35:00Z' and 'since 2026-11-14T08:35:00Z' in out.stdout, 'five minutes on it is the same outage: since does not move')
    check(open(os.path.join(sd, 'ALARMS.log')).read().count('NEW') == 1, 'and it is not a second NEW')
    os.rename(jf, jf + '.gone')
    out = subprocess.run(cmd + ['--now', '2026-11-14T08:45:00Z'], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    check('CHECK FAILED' in out.stdout and set(st['alarms']) == {'brainwatch:showcase', 'dark:model'} and st['dark_since'] == '2026-11-14T08:35:00Z', 'a read that fails pages under its own key and keeps the dark page up')
    # review r1 blocker 1: THE LATCH. A window that proves nothing is not a recovery.
    for name, rows, units in (('nineteen failures and no decision', [rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:5]], '14'),
                              ('a silent journal', ORDERS, '14'), ('three running units', DARK[:30], '3')):
        open(jf, 'w').write(J(rows))
        out = subprocess.run(cmd[:9] + [units] + cmd[10:] + ['--now', '2026-11-14T08:50:00Z'], capture_output=True, text=True)
        st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
        check('dark:model' in st['alarms'] and st['dark_since'] == '2026-11-14T08:35:00Z' and 'STILL DARK since 2026-11-14T08:35:00Z' in out.stdout, f'review r1: {name} keeps the page up')
    ev = lambda kind: [l for l in open(os.path.join(sd, 'ALARMS.log')).read().splitlines() if kind in l and 'dark:model' in l]
    check(ev('CLEARED') == [] and len(ev('NEW')) == 1, f"and the dark page was never CLEARED or said NEW again on the way ({len(ev('CLEARED'))}, {len(ev('NEW'))})")
    # review r1 blocker 3: a state file that cannot be read
    good = open(os.path.join(sd, 'brainwatch-showcase.json')).read()
    open(os.path.join(sd, 'brainwatch-showcase.json'), 'w').write('{broken')
    out = subprocess.run(cmd + ['--now', '2026-11-14T08:55:00Z'], capture_output=True, text=True)       # jf: three units' worth, 14 units -> under the floor
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    check(set(st['alarms']) == {'dark:model', 'brainwatch:showcase'} and st['dark_since'] == 'before a lost state file' and 'taken back from the push state' in out.stdout, 'review r1: a broken state file is said, and the dark page is taken back from the push state: ' + out.stdout.strip()[-120:])
    open(os.path.join(sd, 'brainwatch-showcase.json'), 'w').write('{broken')
    os.rename(jf, jf + '.gone2')
    out = subprocess.run(cmd + ['--now', '2026-11-14T08:56:00Z'], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    check(set(st['alarms']) == {'dark:model', 'brainwatch:showcase'} and ev('CLEARED') == [] and len(ev('NEW')) == 1, 'review r1: a broken state file AND a failed read still keep the dark page')
    open(os.path.join(sd, 'brainwatch-showcase.json'), 'w').write(good)
    open(jf, 'w').write(J(FINE))
    out = subprocess.run(cmd + ['--now', '2026-11-14T09:50:00Z'], capture_output=True, text=True)
    st = json.load(open(os.path.join(sd, 'brainwatch-showcase.json')))
    alog = open(os.path.join(sd, 'ALARMS.log')).read()
    check(st['alarms'] == {} and st['dark_since'] is None and len(ev('CLEARED')) == 1, 'the model answers again: cleared once, and since is dropped')
    hb = [json.loads(l) for l in open(os.path.join(sd, 'hb.jsonl'))]
    check([r['event'] for r in hb] == ['model_dark'] * 8 + ['model_ok'] and hb[0]['kind'] == 'showcase_brainwatch', 'one heartbeat row a run')
    n = len(open(os.path.join(sd, 'ALARMS.log')).read())
    subprocess.run(cmd[:-2] + ['--no-state', '--now', '2026-11-14T09:55:00Z'], capture_output=True, text=True)
    check(len(open(os.path.join(sd, 'ALARMS.log')).read()) == n and len(open(os.path.join(sd, 'hb.jsonl')).readlines()) == 9, '--no-state writes nothing')
    with tempfile.TemporaryDirectory() as td2:        # no state file at all is a first run, not a lost one
        open(jf, 'w').write(J(FINE))
        out = subprocess.run(cmd[:6] + [td2] + cmd[7:-2] + ['--now', '2026-11-14T09:55:00Z'], capture_output=True, text=True)
        check(json.load(open(os.path.join(td2, 'brainwatch-showcase.json')))['alarms'] == {}, 'POSITIVE CONTROL: a first run with no state file says nothing about a lost one')


# ---- mutants: each rule binds (the anchor must be present and unique) ----
SRC = open(os.path.join(HERE, 'brainwatch.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'brainwatch_mutant', '__file__': os.path.join(HERE, 'brainwatch.py')}
    exec(compile(SRC.replace(old, new), 'brainwatch_mutant', 'exec'), ns)
    return lambda lines, up=14, label='showcase': ns['judge'](ns['tally'](lines), up, label)[0]
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
RULE = "if t['failed'] >= FAIL_MIN and len(t['units_failed']) >= FAIL_UNITS and t['failed'] >= DARK_SHARE * tries:"
killed('without the unit count one bot with a bad config pages', 'dark:model' in mutant(RULE, "if t['failed'] >= FAIL_MIN and t['failed'] >= DARK_SHARE * tries:")([rej(PIDS[0], i) for i in range(40)]))
killed('without the floor nineteen failures page', 'dark:model' in mutant(RULE, "if len(t['units_failed']) >= FAIL_UNITS and t['failed'] >= DARK_SHARE * tries:")([rej(p) for p in PIDS] + [rej(p, 20) for p in PIDS[:5]]))
killed('without the share a flap pages', 'dark:model' in mutant(RULE, "if t['failed'] >= FAIL_MIN and len(t['units_failed']) >= FAIL_UNITS:")(flap))
killed('with work orders counted as decisions, orders hide a dark model', 'dark:model' not in mutant("            if int(m.group(1)) > 0:", "            if True:")([rej(p, 10 + i) for i in range(2) for p in PIDS] + [dec(p, 0, 'town_deposit', sec=i) for i in range(2) for p in PIDS]))
killed('without the running-units floor a stopped host is judged', 'dark:model' in mutant("    if units_up < need:", "    if False:")(DARK, 3))
killed('without the blind rule a silent journal reads as fine', mutant("    if tries == 0:", "    if False:")(ORDERS) == {})
def mut_ns(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'brainwatch_mutant', '__file__': os.path.join(HERE, 'brainwatch.py')}
    exec(compile(SRC.replace(old, new), 'brainwatch_mutant', 'exec'), ns)
    return ns
killed('without the latch a thin window clears the page', 'dark:model' not in mut_ns("    if not was or (t is not None and recovered(t)):", "    if True:")['hold']({}, 's', few, T0, 'showcase')[0])
killed('a latch that any decision releases is released by one among fourteen failures', 'dark:model' not in mut_ns("    return t['decided'] >= 1 and t['failed'] < DARK_SHARE * tries", "    return t['decided'] >= 1")['hold']({}, 's', one, T0, 'showcase')[0])
ns_ = mut_ns("        held = any(str(k) == 'dark:model' for k in json.load(open(push_path)))", "        held = False")
with tempfile.TemporaryDirectory() as td3:
    sp, pp = os.path.join(td3, 's.json'), os.path.join(td3, 'p.json')
    open(sp, 'w').write('{broken'); open(pp, 'w').write(json.dumps({'dark:model': {'line': 'x'}}))
    check(BW.read_since(sp, pp)[0] == 'before a lost state file', 'POSITIVE CONTROL: the real reader takes the page back from the push state')
    killed('without the push-state fallback a broken state file drops the page', ns_['read_since'](sp, pp)[0] is None)
    for name, body in (('an empty object', '{}'), ('a list', '[]'), ('a number for since', '{"dark_since": 5}'), ('null while the push state holds the page', '{"dark_since": null}')):
        open(sp, 'w').write(body)
        check(BW.read_since(sp, pp)[0] == 'before a lost state file' and BW.read_since(sp, pp)[1], f'review r2: a state file that is {name} takes the page back from the push state')
    os.remove(sp)
    check(BW.read_since(sp, pp)[0] == 'before a lost state file' and 'missing' in BW.read_since(sp, pp)[1], 'review r2: a MISSING state file with the page in the push state takes it back too')
    open(sp, 'w').write('{"dark_since": "2026-11-14T08:35:00Z"}')
    check(BW.read_since(sp, pp) == ('2026-11-14T08:35:00Z', None), 'POSITIVE CONTROL: a good state file is believed as it is')
    open(pp, 'w').write('{}')
    open(sp, 'w').write('{"dark_since": null}')
    check(BW.read_since(sp, pp) == (None, None), 'POSITIVE CONTROL: nothing dark in either file is nothing dark')
    open(sp, 'w').write('{broken')
    check(BW.read_since(sp, pp)[0] is None and 'not up in the push state' in BW.read_since(sp, pp)[1], 'a broken state file with no page in the push state: nothing latched, the problem still said')
    os.remove(sp)
    check(BW.read_since(sp, pp) == (None, None), 'a first run (no state file, no page) says nothing')
# review r2 blocker 2: a state file that cannot be WRITTEN must not stop the page
with tempfile.TemporaryDirectory() as td4:
    sd4 = os.path.join(td4, 'digest'); os.makedirs(os.path.join(sd4, 'brainwatch-showcase.json'))      # the state path is a directory
    jf4 = os.path.join(td4, 'j.txt'); open(jf4, 'w').write(J(DARK))
    out = subprocess.run([sys.executable, '-B', os.path.join(HERE, 'brainwatch.py'), '--label', 'showcase', '--state-dir', sd4, '--no-push', '--units', '14',
                          '--journal-file', jf4, '--now', '2026-11-14T08:35:00Z'], capture_output=True, text=True)
    alog = open(os.path.join(sd4, 'ALARMS.log')).read() if os.path.exists(os.path.join(sd4, 'ALARMS.log')) else ''
    check(out.returncode == 0 and 'dark:model' in alog and 'brainwatch:showcase' in alog and 'state file not written' in out.stdout, 'review r2: the state file cannot be written -- the dark page and the watcher\'s own page still go out: ' + (out.stderr.strip()[-160:] or out.stdout.strip()[-100:]))
sys.exit(1 if fails else 0)
