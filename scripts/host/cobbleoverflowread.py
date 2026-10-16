#!/usr/bin/env python3
# cobbleoverflowread.py [window_min] -- the read for canary `cobbleoverflow-01` (OWNER 10-16 "yes, junk can take the extra").
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). --selftest runs every gate against its fixture.
#
# THE CHANGE (built on cobblecap-1000, town cobble cap 1000): below the cap the junk well also takes whole surplus cobble /
# cobbled_deepslate stacks that NO town container can take whole -- only when the town's room is KNOWN (every town container
# read within the hour by a count that carries its room, none mid-withdraw) -- and the bot keeps its 64. Unknown room sends
# nothing. A stack some container can take stays for the deposit. Never a toss, never a chest.
#
# THE CANARY ARM IS JUDGED; the control is the DiD baseline and the arms check. Every rate is per BOT-HOUR of the arm and
# period (bots seen x window); the denominators are printed first.
#
#   EXPOSURE     a canary bot in a full-chest town with surplus cobble: rows where a bank refused for want of room while the
#                bag held a whole surplus stack -- the town deposit's "the town chests in reach are full" (town_storage_full)
#                with bot.inventory cobble >= 128 (>= 128 guarantees a stack above the 64 that may go; 65-127 may not), and the
#                deposit's "cobble never opens a new chest" (it is written only when every stack it could not place was
#                surplus cobble). Both arms write both. READY at >= EXPOSURE_MIN canary rows from >= EXPOSURE_BOTS bots.
#                Reported beside it: the canary's own exposure rows (_cobble_overflow at those refusals) whose room was KNOWN --
#                exposure the rule could act on (unknown room fails closed: no throw, by design)
#   LIVENESS     overflow throws: canary _well_dispose rows with overflow= > 0 (the cobble the well took BELOW the cap)
#   THE CLICKS   every overflow stack writes its own `_cobble_overflow phase=throw name= count= left= cap= mode= known=
#                containers= unknown= max=<cobblestone>/<cobbled_deepslate>` row AT THE CLICK, with the reading that authorised it
#                (Codex r1 P2: the visit's _well_dispose row carries only its LAST reading, and has no start time)
#   PRIMARY      stuck rows (the exposure rows) per bot-h, DiD canary vs control: should FALL (the well empties the surplus
#                the bank cannot take). Reported with the overflow cobble per canary bot-h and the well's cobble DiD.
#   CORRECTNESS  (each REVERTS; each has a failing fixture in --selftest)
#     D1  breach_reserve: an overflow click that left the bag under the 64 (left < 64), or a dispose row with overflow and
#         cobble_left < 64
#     D2  breach_switch: an overflow click outside its own rule -- not cap=below mode=overflow known=1, or its own reading
#         had a container able to take the stack whole (max of its name >= its count)
#     D3  breach_room_journal: overflow clicks the JOURNAL contradicts -- folded with the canary's own cobblecap.mjs
#         (cobbleroomaudit.mjs) up to the click row's time, OVER THE SAME CONTAINER LIST the click judged (its keys= hash; Codex
#         r2 P2: a container broken since the journal's last scan is not the bot's -- a different list is reported as
#         audit_membership_differs, never a breach), the town's room was KNOWN with a container able to take that stack (its
#         own name, its own count) whole. One is reported and named (a record appended between the bot's read and
#         its row can explain one); the gate trips at >= 2.
#   ARMS         control rows of this build's kinds (_cobbleoverflow_mode, _cobble_overflow) or control overflow throws
#                (must be 0: a contaminated control); BASE: the control must run cobblecap-1000 (its _cobblecap_mode licence
#                rows >= 1, Claude r1 P3) or the DiD mixes two changes
#   REPORTED     the canary's _cobble_overflow rows by mode (overflow / at_cap / none) and room known/unknown (the fail-closed
#                cases: a bank refused for room while the well could not judge the room); the journal audit's unknown-room
#                throws (the audit could not see a reading the bot saw: reported, never a verdict); new chests and chest-full
#                deposit failures DiD (tripwires)
import sys, os, json, re, glob, gzip, subprocess, tempfile
import datetime as dt
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = ('_cobble_overflow', '_cobbleoverflow_mode', '_cobblecap_mode', '_well_dispose', 'town_deposit', 'deposit', '_deposit_new_chest', '_cobble_bank')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
JOURNAL_FILE = re.compile(r'\.cobble\.(g\d+\.)?jsonl$')
EXPOSURE_MIN = 3
EXPOSURE_BOTS = 2   # Claude r1 P3: one bot alone never readies the read
RESERVE = 64
SURPLUS_MIN = 2 * RESERVE        # bag cobble at which a whole stack above the 64 is certain to exist
TOWN_FULL = 'the town chests in reach are full'
COBBLE_NO_CHEST = 'cobble never opens a new chest'
D3_TRIP = 2


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def bag_cobble(inv):
    if not isinstance(inv, dict):
        return None
    return sum(int(inv.get(n) or 0) for n in ('cobblestone', 'cobbled_deepslate'))


def stream(since, until, cut, cans, cv, logroot='/var/log/mcai'):
    """Every skill row in [since, until): live files and the rotated .gz of each day touched (logs rotate ~23:59Z)."""
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad, offbuild = set(), [], 0, 0, 0
    noversion = Counter()
    bots = defaultdict(set)
    s_iso, u_iso = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    for f in files:
        try:
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                ts = line[15:34] if line.startswith('{"@timestamp":"') else None
                if ts is None or ts < s_iso or ts >= u_iso:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                bd = d.get('bot') or {}
                b = bd.get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if b:
                    bots[(per, arm)].add(b)
                if n in KEEP:
                    ver = ((d.get('code') or {}).get('version') or '')
                    # a canary POST row from another build (restart lag) is not the canary's (memory: restart-lag rows)
                    if arm == 'canary' and per == 'post' and cv and ver and not ver.startswith(cv):
                        offbuild += 1
                        continue
                    if arm == 'canary' and per == 'post' and not ver:
                        noversion[n] += 1
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'detail': sk.get('detail') or '', 'bot': b,
                                 'cobble': bag_cobble(bd.get('inventory')), 'ms': int(sk.get('duration_ms') or 0)})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad, offbuild, dict(noversion)


def stuck(r):
    """An EXPOSURE row: a bank refused for want of room while the bag held a whole surplus stack."""
    if r['name'] == 'town_deposit' and r['status'] == 'failed' and r['detail'].startswith(TOWN_FULL):
        return r['cobble'] is not None and r['cobble'] >= SURPLUS_MIN
    return r['name'] == 'deposit' and COBBLE_NO_CHEST in r['detail']


def max_of(f, name):
    """The click row's own reading: the most ONE container could take of `name` (max=<cobblestone>/<cobbled_deepslate>)."""
    m = (f.get('max') or '').split('/')
    i = {'cobblestone': 0, 'cobbled_deepslate': 1}.get(name)
    try:
        return int(m[i]) if i is not None and len(m) == 2 else None
    except ValueError:
        return None


def click_ok(f):
    """An overflow click inside its own rule: below the cap, mode overflow, the room known, and no ONE container able to take
    the stack whole by the click's own reading."""
    mx = max_of(f, f.get('name'))
    return f.get('cap') == 'below' and f.get('mode') == 'overflow' and f.get('known') == '1' and mx is not None and mx < num(f, 'count')


def overflow_of(r):
    return num(kv(r['detail']), 'overflow') if r['name'] == '_well_dispose' else 0


def judge(rows):
    out = {}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    post_k = [r for r in rows if r['per'] == 'post' and r['arm'] == 'control']
    throws = [(r, kv(r['detail'])) for r in post_c if overflow_of(r) > 0]
    out['overflow_throws_canary'] = len(throws)
    out['overflow_cobble_canary'] = sum(num(f, 'overflow') for r, f in throws)
    clicks = [(r, kv(r['detail'])) for r in post_c if r['name'] == '_cobble_overflow' and kv(r['detail']).get('phase') == 'throw']
    out['overflow_clicks_canary'] = len(clicks)
    d1 = [(r['bot'], num(f, 'cobble_left', None), str(r['t'])) for r, f in throws if num(f, 'cobble_left', -1) < RESERVE] \
        + [(r['bot'], num(f, 'left', None), str(r['t'])) for r, f in clicks if num(f, 'left', -1) < RESERVE]
    out['breach_reserve'] = len(d1)
    d2 = [(r['bot'], f.get('name'), f.get('count'), f.get('cap'), f.get('max'), str(r['t'])) for r, f in clicks if not click_ok(f)]
    out['breach_switch'] = len(d2)
    # ARMS: the control must not carry this build's kinds or its throws
    out['arms_control_rows'] = sum(1 for r in post_k if r['name'] in ('_cobbleoverflow_mode', '_cobble_overflow') or overflow_of(r) > 0)
    out['mode_rows_canary'] = sum(1 for r in post_c if r['name'] == '_cobbleoverflow_mode')
    notes = [kv(r['detail']) for r in post_c if r['name'] == '_cobble_overflow' and kv(r['detail']).get('phase') != 'throw']
    out['notes_canary'] = len(notes)
    out['notes_by_mode'] = dict(Counter(f.get('mode', '?') for f in notes))
    out['notes_room_unknown'] = sum(1 for f in notes if f.get('mode') == '-' and f.get('known') == '0' and f.get('cap') in ('below', 'unknown'))
    out['notes_goes'] = sum(1 for f in notes if num(f, 'goes') > 0)
    out['exposure_known'] = sum(1 for f in notes if f.get('known') == '1')
    out['base_licence_control'] = sum(1 for r in post_k if r['name'] == '_cobblecap_mode')
    exp = [r for r in post_c if stuck(r)]
    out['exposure_rows'] = len(exp)
    out['exposed_bots'] = len({r['bot'] for r in exp})
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            rs = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['stuck_%s_%s' % (per, arm)] = sum(1 for r in rs if stuck(r))
            out['well_cobble_%s_%s' % (per, arm)] = sum(num(kv(r['detail']), 'cobble') for r in rs if r['name'] == '_well_dispose')
            out['new_chests_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] == '_deposit_new_chest' and r['status'] == 'success' and 'placed=1' in r['detail'])
            out['fullfail_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] in ('deposit', 'town_deposit') and r['status'] == 'failed' and 'full' in r['detail'])
    out['exposure_ready'] = int(out['exposure_rows'] >= EXPOSURE_MIN and out['exposed_bots'] >= EXPOSURE_BOTS)
    out['_lists'] = {'d1': d1[:5], 'd2': d2[:5]}
    out['_clicks'] = [{'id': '%s@%s#%d' % (r['bot'], r['t'].isoformat(), i), 'pool': pool_of(r['bot']), 'at': int(r['t'].timestamp() * 1000),
                       'name': f.get('name'), 'count': num(f, 'count'), 'keys': f.get('keys')} for i, (r, f) in enumerate(clicks)]
    return out


def journal_coverage(pools, root='/var/lib/mcai'):
    """Every DECLARED canary pool must be audited -> (dirs, [pools not covered, with why]) (cobblecapread's rule)."""
    dirs, missing = [], []
    for p in sorted(pools):
        d = os.path.join(root, '_pool-%s' % p)
        try:
            names = os.listdir(d)
        except OSError as e:
            missing.append('%s:%s' % (p, type(e).__name__)); continue
        if not any(JOURNAL_FILE.search(n) for n in names):
            missing.append('%s:no_journal' % p); continue
        dirs.append(d)
    return dirs, missing


def audit(cc, clicks, dirs):
    """D3: each overflow CLICK judged by the journal folded up to the click row's time (cobbleroomaudit.mjs, the canary's
    cobblecap.mjs). A contradiction = KNOWN room with a container able to take THAT stack (its name, its count) whole."""
    events = [{'id': c['id'], 'pool': c['pool'], 'at': c['at']} for c in clicks]
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as fh:
        json.dump(events, fh); ev = fh.name
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'cobbleroomaudit.mjs'), cc, ev, *dirs], capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(ev)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(r.stderr[-300:])
    j = json.loads(r.stdout)
    by = {e['id']: e for e in j.get('events', [])}
    same = lambda e, c: bool(e) and bool(c.get('keys')) and e.get('hash') == c['keys']
    roomy = lambda e, c: bool(e) and e.get('known') is True and int((e.get('max') or {}).get(c['name']) or 0) >= c['count']
    bad = [c['id'] for c in clicks if same(by.get(c['id']), c) and roomy(by.get(c['id']), c)]
    differs = sum(1 for c in clicks if by.get(c['id']) and not same(by.get(c['id']), c))
    unk = sum(1 for c in clicks if not (by.get(c['id']) or {}).get('known'))
    return {'breach_room_journal': len(bad), '_bad': bad[:5], 'audit_unknown_room': unk, 'audited': len(clicks), 'audit_membership_differs': differs,
            'unreadable': j.get('unreadable', []), 'towns': j.get('towns', 0), 'dirs': len(dirs)}


def selftest():
    T0 = dt.datetime(2026, 10, 16, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', status='success', cobble=None, ms=0: {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'bot': bot, 'cobble': cobble, 'ms': ms}
    WD = lambda overflow, left=64, cap='below', cobble=None, **k: R('_well_dispose', 'slots=36->34 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=%d cobble_left=%d cap=%s%s offlist_items=- unnamed=0'
                                                                    % (overflow if cobble is None else cobble, left, cap, (' overflow=%d' % overflow) if overflow else ''), **k)
    TF = lambda cobble, **k: R('town_deposit', TOWN_FULL + '; deposit (no item) tries other chests and can build a new one', status='failed', cobble=cobble, **k)
    NC = lambda **k: R('deposit', 'the cobble stays: no container here has room for a whole stack, and ' + COBBLE_NO_CHEST + ' (cobble reserve)', status='no_effect', **k)
    CTL = dict(arm='control', bot='board-a-Alpha')
    # a click row exactly as skills.mjs cobbleOverflowNote writes it (phase=throw)
    CK = lambda name='cobblestone', count=64, left=94, cap='below', mode='overflow', known=1, mx='0/0', **k: R('_cobble_overflow',
        'phase=throw name=%s count=%d left=%d cap=%s mode=%s known=%d containers=1 unknown=0 max=%s' % (name, count, left, cap, mode, known, mx), **k)
    ok = judge([CK(count=30, left=128), CK(count=64, left=64), WD(94), TF(300), NC(mins=1), TF(300, mins=2), R('_cobbleoverflow_mode', 'phase=mode rule=no_room ttl_min=60')])
    assert ok['overflow_throws_canary'] == 1 and ok['overflow_cobble_canary'] == 94 and ok['overflow_clicks_canary'] == 2 and ok['breach_reserve'] == 0 and ok['breach_switch'] == 0, ok
    assert ok['exposure_rows'] == 3 and ok['exposure_ready'] == 0 and ok['exposed_bots'] == 1 and ok['arms_control_rows'] == 0 and ok['mode_rows_canary'] == 1 and ok['notes_canary'] == 0, ok
    two = judge([TF(300), NC(mins=1), TF(300, mins=2, bot='hive-a-Bravo')])
    assert two['exposure_ready'] == 1 and two['exposed_bots'] == 2, ('three rows from two bots: ready', two)
    assert judge([R('_cobblecap_mode', 'phase=mode cap=1000', **CTL)])['base_licence_control'] == 1 and judge([R('_cobblecap_mode', 'phase=mode cap=1000')])['base_licence_control'] == 0, 'the base licence is counted on the control only'
    ek = judge([R('_cobble_overflow', 'phase=town_storage_full surplus=94 stacks=2 cap=below mode=overflow known=1 containers=3 unknown=0 max=0/0 goes=2'), R('_cobble_overflow', 'phase=town_storage_full surplus=94 stacks=2 cap=below mode=- known=0 containers=3 unknown=1 max=0/0 goes=0'), CK()])
    assert ek['exposure_known'] == 1 and ek['notes_canary'] == 2, ('known-room exposure, the click rows apart', ek)
    # D1 / D2 fail on their fixtures
    assert judge([WD(94, left=63)])['breach_reserve'] == 1, 'positive control: a visit under the 64'
    assert judge([CK(left=63)])['breach_reserve'] == 1, 'positive control: a click under the 64'
    assert judge([CK(cap='unknown')])['breach_switch'] == 1, 'a click outside the switch'
    assert judge([CK(mode='at_cap')])['breach_switch'] == 1
    assert judge([CK(known=0)])['breach_switch'] == 1, 'a click on unknown room'
    assert judge([CK(mx='64/0')])['breach_switch'] == 1, 'its own reading had a container for the whole 64'
    assert judge([CK(mx='63/0')])['breach_switch'] == 0, 'positive control: 63 is not 64'
    # per NAME (Codex r1 P2): cobblestone room does not license or forbid a deepslate click
    assert judge([CK(name='cobbled_deepslate', count=30, mx='64/0')])['breach_switch'] == 0, 'room for cobblestone only: the deepslate may go'
    assert judge([CK(name='cobbled_deepslate', count=30, mx='0/30')])['breach_switch'] == 1, 'deepslate room for the whole 30: it may not'
    assert judge([CK(mx='-/-')])['breach_switch'] == 1, 'no reading at all'
    # Codex r1 P2: the VISIT's last reading is not a verdict -- a visit that stopped correctly when the count became unknown
    assert judge([CK(), WD(64, cap='unknown')])['breach_switch'] == 0, 'the visit row says cap=unknown after a valid click: no breach'
    assert judge([WD(0, cap='at_cap', cobble=94)])['breach_switch'] == 0, 'an AT-CAP throw is not an overflow throw'
    assert judge([WD(0, cap='at_cap', cobble=94)])['overflow_throws_canary'] == 0, 'and no liveness'
    # ARMS: the control writing this build's kinds, or throwing overflow cobble
    assert judge([WD(94, **CTL)])['arms_control_rows'] == 1
    assert judge([R('_cobbleoverflow_mode', 'phase=mode rule=no_room ttl_min=60', **CTL)])['arms_control_rows'] == 1
    assert judge([R('_cobble_overflow', 'phase=town_storage_full surplus=94 stacks=2 cap=below mode=overflow known=1 containers=3 unknown=0 max=0/0 goes=2', **CTL)])['arms_control_rows'] == 1
    assert judge([R('_well_dispose', 'cobble=94 cobble_left=64 cap=at_cap', **CTL)])['arms_control_rows'] == 0, 'positive control: an at-cap throw is the base\'s'
    # EXPOSURE: a full town with a whole surplus stack in the bag; under 128 bag cobble it is not certain, and other failures are not
    assert judge([TF(127)])['exposure_rows'] == 0 and judge([TF(128)])['exposure_rows'] == 1, 'the 128 floor'
    assert judge([TF(None)])['exposure_rows'] == 0, 'no inventory: not counted'
    assert judge([R('town_deposit', 'banked nothing at the town chests (none tried)', status='failed', cobble=500)])['exposure_rows'] == 0
    assert judge([NC(), NC(mins=1)])['exposure_rows'] == 2 and judge([NC(), NC(mins=1)])['exposure_ready'] == 0, 'two rows: not yet'
    assert judge([TF(300, **CTL), NC(**CTL), TF(300, **CTL)])['exposure_rows'] == 0, 'control rows never ready the canary'
    st = judge([TF(300, per='pre', mins=-5), TF(300), NC(mins=1), TF(300, **CTL), TF(300, per='pre', mins=-5, **CTL)])
    assert st['stuck_pre_canary'] == 1 and st['stuck_post_canary'] == 2 and st['stuck_post_control'] == 1 and st['stuck_pre_control'] == 1, st
    nt = judge([R('_cobble_overflow', 'phase=deposit_no_room surplus=94 stacks=2 cap=below mode=- known=0 containers=3 unknown=1 max=0/0 goes=0'),
                R('_cobble_overflow', 'phase=town_storage_full surplus=94 stacks=2 cap=below mode=overflow known=1 containers=3 unknown=0 max=0/0 goes=2')])
    assert nt['notes_room_unknown'] == 1 and nt['notes_goes'] == 1 and nt['notes_by_mode'] == {'-': 1, 'overflow': 1}, nt
    # THE STREAM: another build's canary post row is dropped and counted; bot.inventory's cobble is read
    lr = tempfile.mkdtemp(prefix='overflow-logs-')
    os.makedirs(os.path.join(lr, 'hive-a-Alpha')); os.makedirs(os.path.join(lr, 'board-a-Alpha'))
    line = lambda ts, bot, ver, name, det, inv=None: json.dumps({'@timestamp': ts, 'code': {'version': ver} if ver else {}, 'bot': {'name': bot, 'inventory': inv or {}},
                                                                 'skill': {'name': name, 'status': 'failed', 'detail': det}}, separators=(',', ':')) + '\n'
    with open(os.path.join(lr, 'hive-a-Alpha', 'skill-hive-a-Alpha.jsonl'), 'w') as fh:
        fh.write(line('2026-10-16T12:01:00.000Z', 'hive-a-Alpha', 'abc1234+x', 'town_deposit', TOWN_FULL, {'cobblestone': 200, 'cobbled_deepslate': 10})
                 + line('2026-10-16T12:02:00.000Z', 'hive-a-Alpha', '9e79c17+y', 'town_deposit', TOWN_FULL, {'cobblestone': 200}))
    with open(os.path.join(lr, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'), 'w') as fh:
        fh.write(line('2026-10-16T12:01:00.000Z', 'board-a-Alpha', '9e79c17+y', 'town_deposit', TOWN_FULL, {'cobblestone': 64}))
    kept, walked, bots, bad, off, nov = stream(T0 - dt.timedelta(hours=1), T0 + dt.timedelta(hours=1), T0, {'hive-a'}, 'abc1234', logroot=lr)
    assert walked == 3 and off == 1 and len(kept) == 2 and [r['cobble'] for r in kept if r['arm'] == 'canary'] == [210], (walked, off, len(kept), kept)
    jroot = tempfile.mkdtemp(prefix='overflow-pools-')
    os.makedirs(os.path.join(jroot, '_pool-hive-a')); open(os.path.join(jroot, '_pool-hive-a', 'town-x.cobble.jsonl'), 'w').close()
    os.makedirs(os.path.join(jroot, '_pool-hive-b'))
    jd, jm = journal_coverage({'hive-a', 'hive-b', 'hive-c'}, root=jroot)
    assert jd == [os.path.join(jroot, '_pool-hive-a')] and jm == ['hive-b:no_journal', 'hive-c:FileNotFoundError'], (jd, jm)
    # D3 through the REAL cobbleroomaudit.mjs and a cobblecap.mjs that has townRoom (the repo's, or STOCK_CC's)
    cands = [os.environ.get('STOCK_CC'), os.path.join(HERE, '..', '..', 'bots', 'src', 'cobblecap.mjs')]
    cc = next((c for c in cands if c and os.path.exists(c)), None)
    if not cc:
        print('JOURNAL SELFTEST SKIPPED: no cobblecap.mjs'); return
    T = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) - 600000

    def town(room_a, room_b=None, later=None):
        root = tempfile.mkdtemp(prefix='overflow-fx-')
        d = os.path.join(root, '_pool-hive-a'); os.makedirs(d)
        cnt = lambda k, r, at: {'t': 'cnt', 'k': k, 'n': 0, 'cap': at, 'at': at, 'v': 2, 'm': {}, 'ids': [], 'bot': 'x', 'inst': 'i', 'w': None, **({'r': r} if r is not None else {})}
        recs = [dict(cnt('a', room_a, T), scan={'keys': ['a', 'b'], 'at': T}), cnt('b', room_b if room_b is not None else {'cobblestone': 0, 'cobbled_deepslate': 0}, T + 1)]
        if later:
            recs.append(cnt('a', later, T + 30000))
        with open(os.path.join(d, 'town.cobble.jsonl'), 'w') as fh:
            fh.write(''.join(json.dumps(x) + '\n' for x in recs))
        return [d]
    hab = subprocess.run(['node', '-e', "import(process.argv[1]).then(m => console.log(m.keysHash(['a', 'b'])))", cc], capture_output=True, text=True).stdout.strip()
    assert len(hab) == 8, ('keysHash from the module', hab)
    th = lambda name='cobblestone', count=64, keys=None: [{'id': 'hive-a-Alpha@x#0', 'pool': 'hive-a', 'at': T + 20000, 'name': name, 'count': count, 'keys': keys or hab}]
    full = audit(cc, th(), town({'cobblestone': 0, 'cobbled_deepslate': 0}))
    assert full['breach_room_journal'] == 0 and full['audit_unknown_room'] == 0 and full['audited'] == 1, ('a full town: the click is right', full)
    roomy = audit(cc, th(), town({'cobblestone': 64, 'cobbled_deepslate': 0}))
    assert roomy['breach_room_journal'] == 1, ('positive control: a container with room for the whole stack', roomy)
    assert audit(cc, th(count=30), town({'cobblestone': 29, 'cobbled_deepslate': 0}))['breach_room_journal'] == 0, '29 room: a 30 fits nowhere'
    assert audit(cc, th(count=30), town({'cobblestone': 30, 'cobbled_deepslate': 0}))['breach_room_journal'] == 1, '30 room: the 30 fitted'
    # per NAME (Codex r1 P2)
    assert audit(cc, th('cobbled_deepslate', 64), town({'cobblestone': 64, 'cobbled_deepslate': 0}))['breach_room_journal'] == 0, 'cobblestone room is not deepslate room'
    assert audit(cc, th('cobbled_deepslate', 64), town({'cobblestone': 0, 'cobbled_deepslate': 64}))['breach_room_journal'] == 1, 'deepslate room: the deepslate fitted'
    unread = audit(cc, th(), town(None))
    assert unread['breach_room_journal'] == 0 and unread['audit_unknown_room'] == 1, ('a container without a reading: unknown, never a breach', unread)
    other = audit(cc, th(keys='0badc0de'), town({'cobblestone': 64, 'cobbled_deepslate': 0}))
    assert other['breach_room_journal'] == 0 and other['audit_membership_differs'] == 1, ('the click judged ANOTHER container list (Codex r2 P2): uncertainty, not a breach', other)
    after = audit(cc, th(), town({'cobblestone': 0, 'cobbled_deepslate': 0}, later={'cobblestone': 64, 'cobbled_deepslate': 64}))
    assert after['breach_room_journal'] == 0, ('room that appeared AFTER the click is not the click\'s', after)
    print('SELFTEST ok: every gate fails on its fixture and passes its control (journal audit with %s)' % cc)


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        man = json.load(open('/srv/mcbots/trial-manifest.json'))
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)
    rows, walked, bots, bad, offbuild, noversion = stream(PRE, END, CUT, CANS, CV)
    res = judge(rows)
    CANARY_CC = os.environ.get('CANARY_CC') or os.path.expanduser('~/mcai-analysis/cobbleoverflow01/cobblecap.mjs')
    try:
        JDIRS, JMISSING = journal_coverage(CANS)
        jr = audit(CANARY_CC, res['_clicks'], JDIRS) if res['_clicks'] else {'breach_room_journal': 0, '_bad': [], 'audit_unknown_room': 0, 'audited': 0, 'audit_membership_differs': 0, 'unreadable': [], 'towns': 0, 'dirs': len(JDIRS)}
        jr['missing'] = JMISSING
    except Exception as e:
        print('journal audit failed:', e); jr = None
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('stuck', 'well_cobble', 'new_chests', 'fullfail')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | bot-h post canary %.1f control %.1f | window %d min | other-build canary rows %d | versionless canary rows %s'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]),
             hrs('post', 'canary'), hrs('post', 'control'), W, offbuild, noversion or '-'))
    print('EXPOSURE     canary stuck rows (a bank refused for room, bag cobble >= %d or a cobble-only no-room deposit) %d from %d bot(s) (>= %d from >= %d) -> %s | of the canary\'s own exposure rows, room KNOWN %d of %d | control %d'
          % (SURPLUS_MIN, res['exposure_rows'], res['exposed_bots'], EXPOSURE_MIN, EXPOSURE_BOTS, 'READY' if res['exposure_ready'] else 'NOT YET', res['exposure_known'], res['notes_canary'], res['stuck_post_control']))
    print('BASE         control _cobblecap_mode licence rows %d (>= 1: the control runs cobblecap-1000)' % res['base_licence_control'])
    print('LIVENESS     canary overflow visits %d, clicks %d (%d cobble, %.2f per canary bot-h) | licence rows _cobbleoverflow_mode %d | control rows of this build %d (must be 0)'
          % (res['overflow_throws_canary'], res['overflow_clicks_canary'], res['overflow_cobble_canary'], rate(res['overflow_cobble_canary'], 'post', 'canary'), res['mode_rows_canary'], res['arms_control_rows']))
    d3 = ('%d %s (clicks audited %d, another container list %d, unknown room at the click %d, towns %d, unreadable %s, pools not covered %s)' % (jr['breach_room_journal'], jr['_bad'], jr['audited'], jr['audit_membership_differs'], jr['audit_unknown_room'], jr['towns'], jr['unreadable'] or '-', jr['missing'] or '-')
          if jr is not None else 'UNREADABLE (blind this read)')
    print('CORRECTNESS  D1 throws under the 64 %d %s | D2 clicks outside their own rule %d %s | D3 journal-contradicted clicks %s (trips at >= %d)'
          % (res['breach_reserve'], res['_lists']['d1'], res['breach_switch'], res['_lists']['d2'], d3, D3_TRIP))
    print('PRIMARY      stuck rows canary %d -> %d control %d -> %d DiD %+.4f/bot-h (should FALL)'
          % (res['stuck_pre_canary'], res['stuck_post_canary'], res['stuck_pre_control'], res['stuck_post_control'], dids['stuck']))
    print('REPORTED     the well\'s cobble DiD %+.2f/bot-h (should RISE) | _cobble_overflow rows %d by mode %s, room unknown (fail closed) %d, goes %d'
          % (dids['well_cobble'], res['notes_canary'], res['notes_by_mode'], res['notes_room_unknown'], res['notes_goes']))
    print('TRIPWIRE     new town chests DiD %+.4f/bot-h | chest-full deposit failures DiD %+.4f/bot-h' % (dids['new_chests'], dids['fullfail']))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        fields = {k: v for k, v in res.items() if not k.startswith('_') and not isinstance(v, dict)}
        fields.update({'stuck_did': clean(dids['stuck']), 'well_cobble_did': clean(dids['well_cobble']), 'new_chest_did': clean(dids['new_chests']),
                       'fullfail_did': clean(dids['fullfail']), 'other_build_rows': offbuild, 'versionless_canary_rows': sum(noversion.values()),
                       'overflow_per_bot_h': clean(rate(res['overflow_cobble_canary'], 'post', 'canary')),
                       'journal_audit_ran': int(jr is not None), 'breach_room_journal': jr['breach_room_journal'] if jr is not None else 0,
                       'breach_room_journal_trip': int(jr is not None and jr['breach_room_journal'] >= D3_TRIP),
                       'audit_unknown_room': jr['audit_unknown_room'] if jr is not None else None,
                       'audit_membership_differs': jr['audit_membership_differs'] if jr is not None else None,
                       'journal_unreadable': len(jr['unreadable']) if jr is not None else None, 'journal_dirs': jr['dirs'] if jr is not None else 0,
                       'journal_pools_missing': len(jr['missing']) if jr is not None else None,
                       'journal_audit_complete': int(jr is not None and not jr['unreadable'] and not jr['missing'] and jr['dirs'] > 0)})
        emit('cobbleoverflowread', W, fields)
    except Exception as e:
        print('emit failed:', e)
