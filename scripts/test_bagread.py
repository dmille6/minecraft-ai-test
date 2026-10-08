#!/usr/bin/env python3
"""bagread.py (the bag-fix primary for all seven queued bag fixes, owner D1 10-08): behaviour over fixture logs, run as a
dry run end to end, plus mutants on copies (anchors asserted present and unique; an unmutated copy must pass first)."""
import os, sys, json, tempfile, shutil, subprocess, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
READ = os.path.join(HERE, 'host', 'bagread.py')
T = []


def t(name, ok, detail=''):
    T.append(bool(ok)); print(('PASS' if ok else 'FAIL') + '  ' + name + ('' if ok or not detail else '\n        -> ' + str(detail)[-600:]))


CUT = dt.datetime(2026, 10, 5, 0, tzinfo=dt.timezone.utc)
CAN = ['hive-a', 'hive-b']; CTL = ['board-a', 'board-b']


def fixture(tmp, can_post_slots=30, corrupt=0, torn_file=False, other_build=False, ctl_post_slots=30, nul_lines=0,
            can_post_picks=2, slow_deposit=False, deaths_empty=0, stale=False, pre_death=False):
    root = tempfile.mkdtemp(dir=tmp)
    for p in CAN + CTL:
        b = p + '-Alpha'; os.makedirs(os.path.join(root, b))
        lines = []
        t0 = CUT - dt.timedelta(hours=3)
        for i in range(0, 6 * 3600, 30):                   # a row every 30 s, PRE and POST 3 h each (2,880 rows)
            ts = t0 + dt.timedelta(seconds=i)
            post = ts >= CUT
            n = (can_post_slots if p in CAN else ctl_post_slots) if post else 30
            ver = 'old0000' if (other_build and p in CAN and post and i % 240 == 0) else 'abc1234'
            picks = can_post_picks if (p in CAN and post) else 2
            inv = {'cobblestone': 64 * n, 'stone_pickaxe': picks}
            sk = {'name': 'gather', 'detail': str(i), 'duration_ms': 0}
            if slow_deposit and p in CAN and i == 3 * 3600 - 120:
                # a 2-min deposit STARTING 2 min before the cut, ending 0 s after it: its bag (emptied to 10) is the END
                # snapshot, so with retiming the emptier bag counts from the cut on; without it, 2 min early
                sk = {'name': 'deposit', 'detail': 'x', 'duration_ms': 120000}
                inv = {'cobblestone': 64 * 10, 'stone_pickaxe': picks}
            bot = {'name': b, 'inventory': inv}
            if p in CAN and post and deaths_empty:
                # a death every 3 h of POST (deaths_empty of them) empties the bag to 2 slots; it refills over 40 min
                k = (i - 3 * 3600)
                if k % (3 * 3600 // deaths_empty) < 40 * 60:
                    bot['inventory'] = {'cobblestone': 64 * 2, 'stone_pickaxe': picks}
                if k % (3 * 3600 // deaths_empty) == 0:
                    lines.append(json.dumps({'@timestamp': ts.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': ver},
                                             'bot': {'name': b}, 'skill': {'name': '_death', 'detail': 'drowned; x'}}, separators=(',', ':')))
            if p in CAN and post and stale:
                # each 10-min cycle: ONE 10-slot snapshot then 5 min of bagless event rows, then 5 min of 30-slot snapshots
                ph = (i - 3 * 3600) % 600
                if ph == 0:
                    bot['inventory'] = {'cobblestone': 64 * 10}
                elif ph < 300:
                    bot = {'name': b}; sk = {'name': '_path_reset', 'detail': 'x'}
                else:
                    bot['inventory'] = {'cobblestone': 64 * 30}
            r = {'@timestamp': ts.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': ver}, 'bot': bot, 'skill': sk}
            lines.append(json.dumps(r, separators=(',', ':')))
        for k in range(corrupt if p == CAN[0] else 0):     # torn lines on ONE bot
            lines.insert(10 + k, '\x00' * 40 + '{"@timestamp":"%s","bot":' % (CUT + dt.timedelta(minutes=k)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
        if pre_death and p in CAN:     # one death 5 min before the PRE window; the PRE's first 55 min are its refill (empty bag)
            pw = t0 - dt.timedelta(minutes=5)
            lines.insert(0, json.dumps({'@timestamp': pw.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': 'abc1234'},
                                        'bot': {'name': b}, 'skill': {'name': '_death', 'detail': 'drowned; x'}}, separators=(',', ':')))
            for q, l in enumerate(lines[1:], 1):
                if q <= 55 * 2:
                    lines[q] = l.replace('"cobblestone":%d' % (64 * 30), '"cobblestone":%d' % (64 * 1))
        for k in range(nul_lines if p == CAN[0] else 0):   # complete lines with NO readable timestamp left
            lines.insert(20 + k, '\x00' * 60)
        open(os.path.join(root, b, 'skill-%s.jsonl' % b), 'w').write('\n'.join(lines) + '\n')
    if torn_file:
        open(os.path.join(root, CAN[0] + '-Alpha', 'skill-x.jsonl-20261005.gz'), 'wb').write(b'not gzip')
    return root


def run(read, root):
    env = dict(os.environ, BAGREAD_LOG_ROOT=root, CANARY_DRYRUN='%s:abc1234:%s' % (','.join(CAN), CUT.isoformat().replace('+00:00', 'Z')))
    nr = os.path.join(HERE, 'host', 'nullrun.py')
    p = subprocess.run([sys.executable, nr, read, '180'], capture_output=True, text=True, env=env, timeout=600)
    line = next((l for l in p.stdout.splitlines() if l.startswith('NULLFIELDS ')), None)
    return (json.loads(line[11:])['fields'] if line else None), p.stdout + p.stderr


def cases(read, tmp):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    f, o = run(read, fixture(tmp, can_post_slots=20))
    c('canary bags 30 -> 20 slots, control flat: slots_did = -10', f and abs(f['slots_did'] + 10) < 0.2, (f, o[-400:]))
    c('... and share >= 34 slots unchanged (0 -> 0): full_share_did = 0', f and abs(f['full_share_did']) < 1e-9, f)
    f, o = run(read, fixture(tmp, can_post_slots=40))
    c('canary bags 30 -> 40: share >= 34 DiD = +1, slots DiD = +10', f and abs(f['full_share_did'] - 1) < 0.02 and abs(f['slots_did'] - 10) < 0.2, f)
    f, o = run(read, fixture(tmp, can_post_slots=30))
    c('no change: both DiDs ~0 (positive control for the two above)', f and abs(f['slots_did']) < 0.05 and abs(f['full_share_did']) < 1e-9, f)
    f, o = run(read, fixture(tmp, can_post_slots=25, ctl_post_slots=25))
    c('both arms 30 -> 25 (a fleet-wide drift): slots_did = 0 -- the control trend is subtracted', f and abs(f['slots_did']) < 0.2, f)
    f, o = run(read, fixture(tmp, can_post_slots=20, corrupt=1))
    c('one torn line (NUL-filled) is counted, not blinding: the DiD is still emitted', f and f['corrupt_lines'] >= 1 and f['slots_did'] is not None, f)
    f, o = run(read, fixture(tmp, can_post_slots=20, corrupt=12))
    c('torn lines above 0.1% of rows blind the read: no primary emitted', f and f['slots_did'] is None, f)
    f, o = run(read, fixture(tmp, can_post_slots=20, torn_file=True))
    c('an unreadable file blinds the read: no primary emitted', f and f['slots_did'] is None and f['unreadable'] >= 1, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, nul_lines=12))
    c('NUL lines with no readable timestamp are counted and blind the read above 0.1% (round 1, Codex)',
      f and f['corrupt_lines'] >= 12 and f['slots_did'] is None, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, can_post_picks=0))
    c('the pickaxe group: canary drops 2 pickaxes in POST -> pick_slots_did = -2, total slots_did = -2', f
      and abs(f['pick_slots_did'] + 2) < 0.05 and abs(f['slots_did'] + 2) < 0.05 and abs(f['cobble_slots_did']) < 0.05, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, slow_deposit=True))
    # 10 canary bots? no: 2 canary bots; the deposit row moves the canary PRE mean only if it is NOT retimed
    c('a skill row\'s bag is its END snapshot: a 2-min deposit ending at the cut leaves the PRE untouched (retimed)',
      f and abs(f['slots_did']) < 0.02 and abs(f['cobble_slots_did']) < 0.02, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, deaths_empty=2))
    c('canary deaths that empty bags (no behaviour change) read as NO change: censored 60 min after each death (round 2, Claude)',
      f and abs(f['slots_did']) < 0.05 and abs(f['full_share_did']) < 0.01, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, pre_death=True))
    c('a canary death 5 min BEFORE the window censors the window\'s first 55 min (round 3, Codex)', f and f['rows'] > 0
      and abs(f['slots_did']) < 0.05, f)
    f, o = run(read, fixture(tmp, can_post_slots=30, stale=True))
    c('bagless rows do not renew a stale bag: a 10-slot snapshot counts 120 s, not the 5 min of event rows after it (round 2, Codex)',
      f and abs(f['cobble_slots_did'] - ((120 * 10 + 300 * 30) / 420.0 - 30)) < 0.15, f)
    f, o = run(read, fixture(tmp, can_post_slots=20, other_build=True))
    c('canary POST rows of another build accrue nothing and are counted', f and f['offbuild_canary'] > 0, f)
    return out


MUTANTS = [
    ('a corrupt line counts as an unreadable file', "                        if line.endswith('\\n') and not (m and m.group(1) < lo):\n                            corrupt += 1",
     "                        if line.endswith('\\n') and not (m and m.group(1) < lo):\n                            bad += 1"),
    ('corrupt lines never blind', "    return bool(unreadable) or not nrows or corrupt / nrows > CORRUPT_MAX",
     "    return bool(unreadable) or not nrows"),
    ('an unreadable file does not blind', "    return bool(unreadable) or not nrows or corrupt / nrows > CORRUPT_MAX",
     "    return not nrows or corrupt / nrows > CORRUPT_MAX"),
    ('the share is weighted by row count, not time', "a[0] += d; a[1] += d if prev[0] >= FULL else 0; a[2] += d * prev[0]",
     "a[0] += 1; a[1] += 1 if prev[0] >= FULL else 0; a[2] += prev[0]"),
    ('deaths before the window not collected', "                        if ((r.get('skill') or {}).get('name') or '') == '_death':\n                            deaths.add(t)\n                        continue",
     "                        continue"),
    ('death censoring dropped', "        accrue(rows, CUT, arm, CV, tw, offbuild, END, censor_spans(dts))", "        accrue(rows, CUT, arm, CV, tw, offbuild, END)"),
    ('a stale bag renewed by bagless rows', "            stop = min(t, prev_t + dt.timedelta(seconds=CAP_S), inv_t + dt.timedelta(seconds=CAP_S))",
     "            stop = min(t, prev_t + dt.timedelta(seconds=CAP_S))"),
    ('skill rows not retimed to completion', "                        t = t + dt.timedelta(milliseconds=dur)        # the bag is the skill's END snapshot",
     "                        pass"),
    ('timestamp-less corrupt lines skipped', "                    m = _TS.search(line[:200])\n                    if m and not",
     "                    m = _TS.search(line[:200])\n                    if not m: continue\n                    if m and not"),
    ('the pickaxe group reads another group', "GROUPS = (('pick', lambda n: n.endswith('_pickaxe')),", "GROUPS = (('pick', lambda n: n.endswith('_sword')),"),
    ('the control trend is not subtracted', "    return (per(('post', canary)) - per(('pre', canary))) - (per(('post', control)) - per(('pre', control)))",
     "    return (per(('post', canary)) - per(('pre', canary)))"),
]

if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='bagreadtest-')
    for n, ok, d in cases(READ, tmp):
        t(n, ok, d)
    src = open(READ).read()
    cd = tempfile.mkdtemp(dir=tmp); shutil.copy(READ, cd)
    ctl = cases(os.path.join(cd, 'bagread.py'), tmp)
    CONTROL = all(ok for _n, ok, _d in ctl)
    t('mutant runner control: an unmutated copy passes every case (%d)' % len(ctl), CONTROL)
    for name, old, new in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR %s: %d' % (name, src.count(old))
        if not CONTROL:
            t('mutant NOT SCORED: ' + name, False); continue
        md = tempfile.mkdtemp(dir=tmp)
        open(os.path.join(md, 'bagread.py'), 'w').write(src.replace(old, new, 1))
        try:
            res = cases(os.path.join(md, 'bagread.py'), tmp)
            killed = not all(ok for _n, ok, _d in res)
        except Exception:
            killed = True
        t('mutant killed: ' + name, killed, 'SURVIVED')
    print('\n%d/%d pass' % (sum(T), len(T)))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(0 if all(T) else 1)
