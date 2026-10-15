#!/usr/bin/env python3
# cobblecapread.py [window_min] -- the read for canary `cobblecap-1000` (OWNER 10-14 "can we up the chest limit for
# cobblestones to 1000"). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: the town cobble cap TOWN_COBBLE_CAP (bots/src/stocktarget.mjs, the one place it is written) is 1000; it was
# 256. Every rule keyed off it moves with it: the deposit's whole-stack admission, the town deposit's, the well's cobble
# switch (the town HOLDS its cap), the cobble prune (a stack spare only past the cap), the at-cap refusal sentence. The bag's
# 64 reserve is unchanged. The base writes `_cobble_bank ... cap=256`, this build `cap=1000` (the licence text).
#
# THE CAPS ARE NEVER LITERALS HERE (towncap.py): the canary's cap from the canary's own stocktarget.mjs copy
# (CANARY_ST, default ~/mcai-analysis/cobblecap1000/stocktarget.mjs); the base's from the control rows' own cap= field
# (the build that wrote them), else BASE_ST / ~/mcai-analysis/stocktarget/stocktarget.mjs.
#
#   LIVENESS     bank_above_base_cap: canary _cobble_bank rows that carry the CANARY's cap= (attribution: a restart-lag or
#                versionless row of the old build carries cap=256 and never counts -- Codex cc1000-r1 P2) and MOVED cobble
#                with town_after above the BASE cap (256) -- a bank the old cap would have refused (>= 1)
#   ARMS         rows_control_canary_cap: control _cobble_bank rows carrying the canary's cap= (must be 0), counted
#                whatever the base cap is; caps_invalid = 1 when the two modules give the same cap (no comparison)
#   BASE CAP     from the fleet's module (BASE_ST, default ~/mcai-analysis/stocktarget/stocktarget.mjs), never from the rows
#                (a contaminated control would move it -- Codex cc1000-r1 P2); the control rows' caps are reported
#   CORRECTNESS  (each REVERTS; each has a failing fixture in --selftest)
#     D1  breach_bank_past_cap: a canary _cobble_bank row that moved cobble and left town_after above the CANARY cap
#         (1000), complete or not (an incomplete count's town_after is a lower bound: above the cap is above it)
#     D2  breach_c5_journal: (stockjournal.mjs, the canary's own fold) an admitted cobble bank claim released into a town
#         total above the canary's cap -- UNTESTED while no cobble bank claim is admitted
#   REPORTED     cobble moved per bot-h DiD (_cobble_bank moved=); at-cap refusals per bot-h DiD (_cobble_bank at_cap=1); the
#                well's cobble clicks per bot-h DiD (_well_dispose cobble=; should FALL: the well takes cobble only at 1000);
#                the town deposit's cobble_cap at_cap; the max town_after seen per arm; rows whose cap= is neither cap
#   TRIPWIRE     new town chests placed (_deposit_new_chest placed=1) per bot-h DiD and chest-full deposit failures per
#                bot-h DiD: 1000 cobble is 16 chest slots, so a town fills sooner (reported, never a verdict)
#                THE BANK CLOSED BELOW THE CAP (Claude cc1000-r1 P2, composition): a town under 1000 whose containers are
#                full leaves the bag's surplus cobble nowhere -- no room to bank, cobble never opens a chest, the well takes
#                cobble only at 1000, no prune. bank_closed rows per bot-h DiD: _cobble_bank rows with no_room > 0 plus
#                deposit rows "cobble never opens a new chest". At 256 the well relieved it; at 1000 it may not.
#   INSTRUMENT   control refusals at a COUNTED cobble cap (`_stock_refused ... at_cobble=1`) (>= 1: the population the
#                change targets). Measured 10-15 03:10Z: the base wrote ZERO _cobble_bank rows in 3 h fleet-wide -- a town at
#                its 256 is refused at admission (`_stock_refused via=admission ... at_cobble=1 cobblestone:N:cobble_cap`,
#                807 rows in 12 h, 13 of 16 pools), so the deposit that writes _cobble_bank never runs. The canary's
#                _cobble_bank rows are therefore new behaviour; the refusal rows are the instrument.
#   EXPOSURE     >= 3 canary _cobble_bank rows with town_before >= the base cap (rows the old cap would have refused), and
#                the instrument
#   REPORTED     also: at-cobble-cap refusals per bot-h DiD (should FALL: towns between 256 and 1000 now take cobble)
import sys, os, json, re, glob, gzip, subprocess
import datetime as dt
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from towncap import town_cobble_cap, row_cap   # noqa: E402

KEEP = ('_cobble_bank', '_well_dispose', '_town_deposit', '_deposit_new_chest', 'deposit', 'town_deposit', '_stock_refused')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
JOURNAL_FILE = re.compile(r'\.cobble\.(g\d+\.)?jsonl$')
EXPOSURE_MIN = 3


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def stream(since, until, cut, cans, cv, logroot='/var/log/mcai'):
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
                b = (d.get('bot') or {}).get('name')
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
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad, offbuild, dict(noversion)


def control_caps(rows):
    """{cap: rows} of the control _cobble_bank rows' own cap= field -- REPORTED only (never the base cap: Codex cc1000-r1 P2)."""
    caps = Counter(row_cap(kv(r['detail']), None) for r in rows if r['arm'] == 'control' and r['name'] == '_cobble_bank')
    caps.pop(None, None)
    return dict(caps)


def judge(rows, cap, base_cap):
    out = {'cap': cap, 'base_cap': base_cap, 'caps_invalid': int(cap == base_cap)}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    post_k = [r for r in rows if r['per'] == 'post' and r['arm'] == 'control']
    banks_c = [(r, kv(r['detail'])) for r in post_c if r['name'] == '_cobble_bank']
    mine = [(r, f) for r, f in banks_c if row_cap(f, None) == cap]   # positive evidence: rows that carry the canary's cap
    moved = lambda f: num(f, 'moved') > 0
    ta = lambda f: num(f, 'town_after', None)
    out['bank_rows_canary'] = len(banks_c)
    out['bank_above_base_cap'] = sum(1 for r, f in mine if moved(f) and ta(f) is not None and ta(f) > base_cap)
    d1 = [(r['bot'], ta(f), str(r['t'])) for r, f in banks_c if moved(f) and ta(f) is not None and ta(f) > cap]
    out['breach_bank_past_cap'] = len(d1)
    out['rows_control_canary_cap'] = sum(1 for r in post_k if r['name'] == '_cobble_bank' and row_cap(kv(r['detail']), None) == cap)
    out['cap_field_other'] = sum(1 for r, f in banks_c if row_cap(f, cap) != cap)
    out['max_town_after_canary'] = max([ta(f) for r, f in banks_c if ta(f) is not None] or [0])
    out['max_town_after_control'] = max([num(kv(r['detail']), 'town_after', 0) for r in post_k if r['name'] == '_cobble_bank'] or [0])
    out['exposure_rows'] = sum(1 for r, f in mine if num(f, 'town_before', -1) >= base_cap)
    out['no_room_share_canary'] = round(sum(1 for r, f in mine if num(f, 'no_room') > 0) / len(mine), 4) if mine else None
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            rs = [r for r in rows if r['per'] == per and r['arm'] == arm]
            fs = [kv(r['detail']) for r in rs if r['name'] == '_cobble_bank']
            out['moved_%s_%s' % (per, arm)] = sum(num(f, 'moved') for f in fs)
            out['at_cap_%s_%s' % (per, arm)] = sum(1 for f in fs if num(f, 'at_cap') > 0)
            out['well_cobble_%s_%s' % (per, arm)] = sum(num(kv(r['detail']), 'cobble') for r in rs if r['name'] == '_well_dispose')
            out['new_chests_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] == '_deposit_new_chest' and r['status'] == 'success' and 'placed=1' in r['detail'])
            out['fullfail_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] in ('deposit', 'town_deposit') and r['status'] == 'failed' and 'full' in r['detail'])
            out['refused_cobble_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] == '_stock_refused' and num(kv(r['detail']), 'at_cobble') > 0)
            out['bank_closed_%s_%s' % (per, arm)] = sum(1 for r in rs if (r['name'] == '_cobble_bank' and num(kv(r['detail']), 'no_room') > 0)
                                                        or (r['name'] in ('deposit', 'town_deposit') and 'cobble never opens a new chest' in r['detail']))
            # Claude cc1000-r2 P3-b: the base writes ~no _cobble_bank rows, so a raw no_room rate is biased up by exposure;
            # the deposit sentence both arms write leads, and no_room is also reported as a share of the canary's own rows
            out['cobble_no_chest_%s_%s' % (per, arm)] = sum(1 for r in rs if r['name'] in ('deposit', 'town_deposit') and 'cobble never opens a new chest' in r['detail'])
    td = Counter()
    for r in post_c:
        if r['name'] == '_town_deposit':
            m = re.search(r' cobble_cap (\d+)/(\d+)/(\d+)', r['detail'])
            if m:
                td['at_cap'] += int(m.group(1)); td['unknown'] += int(m.group(2)); td['outside'] += int(m.group(3))
    out['td_cobble_cap'] = dict(td)
    out['instrument_control'] = out['refused_cobble_post_control']
    out['exposure_ready'] = int(out['exposure_rows'] >= EXPOSURE_MIN and out['instrument_control'] >= 1 and not out['caps_invalid'])
    out['_lists'] = {'d1': d1[:5]}
    return out


def journal_coverage(pools, root='/var/lib/mcai'):
    """Codex cc1000-r2 P2: every DECLARED canary pool must be audited -> (dirs to fold, [pools not covered, with why]). A pool
    whose state dir is missing, cannot be listed, or holds no town journal is not covered (stockjournal.mjs skips such a dir
    silently, and glob drops a missing one)."""
    dirs, missing = [], []
    for p in sorted(pools):
        d = os.path.join(root, '_pool-%s' % p)
        try:
            names = os.listdir(d)
        except OSError as e:
            missing.append('%s:%s' % (p, type(e).__name__)); continue
        # any generation (stockjournal.mjs's own key regex): two rotations delete generation 0 (Codex r3 P2, Claude r3 P3)
        if not any(JOURNAL_FILE.search(n) for n in names):
            missing.append('%s:no_journal' % p); continue
        dirs.append(d)
    return dirs, missing


def journal(cc, since_ms, until_ms, dirs):
    """D2 through stockjournal.mjs with the CANARY's cobblecap.mjs (its targetOf('cobble') is the canary's cap)."""
    r = subprocess.run(['node', os.path.join(HERE, 'stockjournal.mjs'), cc, str(since_ms), str(until_ms), *dirs], capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(r.stderr[-300:])
    j = json.loads(r.stdout)
    return {'breach_c5_journal': sum(1 for g in j.get('g3', []) if g.get('g') == 'cobble'), 'admitted_cobble_bank': j.get('admitted_cobble_bank', 0),
            '_g3': [g for g in j.get('g3', []) if g.get('g') == 'cobble'][:3], 'towns': len(j.get('towns', [])), 'unreadable': j.get('unreadable', []),
            'dirs': len(dirs)}


def selftest():
    T0 = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', status='success': {'t': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'bot': bot}
    B = lambda moved, before, after, cap=1000, at_cap=0, complete=1, **k: R('_cobble_bank', 'name=cobblestone planned=30 tried=%s moved=%d before=94 kept=64 src=server reserve=64 no_room=0 town_before=%d town_after=%d complete=%d cap=%d at_cap=%d unknown=0 outside=0 unknown_keys=0'
                                                                    % ('30' if moved else '-', moved, before, after, complete, cap, at_cap), **k)
    CTL = dict(arm='control', bot='board-a-Alpha')
    RF = lambda **k: R('_stock_refused', 'via=admission n=1 cobble=1 stock=0 at_cobble=1 at_stock=0 cobblestone:384:cobble_cap', **k)
    ok = judge([B(30, 800, 830), B(0, 256, 256, cap=256, at_cap=1, **CTL), RF(**CTL)], 1000, 256)
    assert ok['bank_above_base_cap'] == 1 and ok['breach_bank_past_cap'] == 0 and ok['rows_control_canary_cap'] == 0 and ok['instrument_control'] == 1, ok
    assert judge([B(30, 200, 230)], 1000, 256)['bank_above_base_cap'] == 0, 'a bank under the old cap is not the change seen'
    assert judge([B(0, 900, 900, at_cap=1)], 1000, 256)['bank_above_base_cap'] == 0, 'a refusal is not a bank'
    assert judge([B(30, 970, 1000)], 1000, 256)['breach_bank_past_cap'] == 0, 'exactly 1000 is allowed'
    assert judge([B(30, 971, 1001)], 1000, 256)['breach_bank_past_cap'] == 1, 'positive control: 1001 is past the cap'
    assert judge([B(30, 990, 1020, complete=0)], 1000, 256)['breach_bank_past_cap'] == 1, 'an incomplete count above the cap is above it'
    assert judge([B(0, 1200, 1200, at_cap=1)], 1000, 256)['breach_bank_past_cap'] == 0, 'a town already past the cap that banks nothing is no breach'
    assert judge([B(30, 971, 1001, cap=256, **CTL)], 1000, 256)['breach_bank_past_cap'] == 0, 'the control is not judged by the canary cap'
    assert judge([B(30, 100, 130, **CTL)], 1000, 256)['rows_control_canary_cap'] == 1, 'a control row with the canary cap: an arms breach'
    assert judge([B(30, 100, 130, cap=256)], 1000, 256)['cap_field_other'] == 1, 'a canary-build row carrying another cap is reported'
    assert control_caps([B(0, 256, 256, cap=256, at_cap=1, **CTL), B(30, 100, 130, **CTL)]) == {256: 1, 1000: 1}, 'the control rows\' caps, reported'
    # Codex cc1000-r1 P2: a contaminated control still trips arms; equal caps are no comparison
    con = judge([B(30, 100, 130, **CTL), B(30, 200, 230, **CTL)], 1000, 1000)
    assert con['rows_control_canary_cap'] == 2 and con['caps_invalid'] == 1, con
    # Codex cc1000-r1 P2: a versionless restart-lag row of the old build (cap=256) is no liveness and no exposure; D1 still judges it
    lag = judge([B(30, 250, 280, cap=256, complete=0), B(30, 256, 286, cap=256)], 1000, 256)
    assert lag['bank_above_base_cap'] == 0 and lag['exposure_rows'] == 0 and lag['cap_field_other'] == 2, lag
    assert judge([B(30, 990, 1020, cap=256)], 1000, 256)['breach_bank_past_cap'] == 1, 'D1 judges every canary row, whatever cap it carries'
    try:
        town_cobble_cap('/nonexistent/cobblecap1000/stocktarget.mjs'); raise AssertionError('an explicit missing module fell back to another build')
    except FileNotFoundError:
        pass
    bc = judge([B(0, 400, 400) | {'detail': B(0, 400, 400)['detail'].replace('no_room=0', 'no_room=1')}, R('deposit', 'cobble never opens a new chest', status='no_effect'),
                B(30, 400, 430)], 1000, 256)
    assert bc['bank_closed_post_canary'] == 2, ('the bank closed below the cap', bc['bank_closed_post_canary'])
    # THE STREAM'S BUILD FILTER (Claude cc1000-r1 P3): a canary post row of another build is dropped and counted; a versionless
    # one is kept and counted apart; a control row of any build is kept
    import tempfile
    lr = tempfile.mkdtemp(prefix='cobblecap-logs-')
    os.makedirs(os.path.join(lr, 'hive-a-Alpha')); os.makedirs(os.path.join(lr, 'board-a-Alpha'))
    line = lambda ts, bot, ver, det: json.dumps({'@timestamp': ts, 'code': {'version': ver} if ver else {}, 'bot': {'name': bot},
                                                 'skill': {'name': '_cobble_bank', 'status': 'success', 'detail': det}}, separators=(',', ':')) + '\n'
    D = 'name=cobblestone moved=30 town_before=300 town_after=330 complete=1 cap=1000 at_cap=0'
    with open(os.path.join(lr, 'hive-a-Alpha', 'skill-hive-a-Alpha.jsonl'), 'w') as fh:
        fh.write(line('2026-10-14T12:01:00.000Z', 'hive-a-Alpha', 'abc1234+x', D) + line('2026-10-14T12:02:00.000Z', 'hive-a-Alpha', '5e66386+y', D)
                 + line('2026-10-14T12:03:00.000Z', 'hive-a-Alpha', '', D))
    with open(os.path.join(lr, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'), 'w') as fh:
        fh.write(line('2026-10-14T12:01:00.000Z', 'board-a-Alpha', '5e66386+y', D.replace('cap=1000', 'cap=256')))
    jroot = tempfile.mkdtemp(prefix='cobblecap-pools-')
    os.makedirs(os.path.join(jroot, '_pool-hive-a')); open(os.path.join(jroot, '_pool-hive-a', 'town-x.cobble.jsonl'), 'w').close()
    os.makedirs(os.path.join(jroot, '_pool-hive-b'))
    os.makedirs(os.path.join(jroot, '_pool-hive-d')); open(os.path.join(jroot, '_pool-hive-d', 'town-y.cobble.g2.jsonl'), 'w').close()   # rotated twice
    jd, jm = journal_coverage({'hive-a', 'hive-b', 'hive-c', 'hive-d'}, root=jroot)
    assert jd == [os.path.join(jroot, '_pool-hive-a'), os.path.join(jroot, '_pool-hive-d')] and jm == ['hive-b:no_journal', 'hive-c:FileNotFoundError'], (jd, jm)
    kept, walked, bots, bad, off, nov = stream(T0 - dt.timedelta(hours=1), T0 + dt.timedelta(hours=1), T0, {'hive-a'}, 'abc1234', logroot=lr)
    assert walked == 4 and off == 1 and len(kept) == 3 and nov == {'_cobble_bank': 1}, (walked, off, len(kept), nov)
    ready = judge([B(30, 256, 286), B(30, 300, 330, mins=1), B(0, 990, 990, mins=2, at_cap=1), RF(**CTL)], 1000, 256)
    assert ready['exposure_ready'] == 1 and ready['exposure_rows'] == 3, ready
    # (Claude cc1000-r2 P2: the rows must count as exposure under equal caps, so only caps_invalid keeps it not ready)
    eq_rows = [B(0, 1000, 1000, at_cap=1), B(0, 1000, 1000, mins=1, at_cap=1), B(0, 1000, 1000, mins=2, at_cap=1), RF(**CTL)]
    eq = judge(eq_rows, 1000, 1000)
    assert eq['exposure_rows'] == 3 and eq['instrument_control'] == 1 and eq['caps_invalid'] == 1 and eq['exposure_ready'] == 0, ('equal caps: never ready', eq)
    assert judge(eq_rows, 1000, 256)['exposure_ready'] == 1, 'positive control: the same rows against the base 256 are ready'
    two = judge([R('_stock_refused', 'via=admission n=2 cobble=2 stock=0 at_cobble=2 at_stock=0 cobblestone:200:cobble_cap cobbled_deepslate:64:cobble_cap', **CTL)], 1000, 256)
    assert two['instrument_control'] == 1, 'at_cobble=2 (cobblestone and deepslate) is a refusal at the cap (Claude cc1000-r2 P3-a)'
    nr = judge([B(30, 300, 330), B(0, 400, 400) | {'detail': B(0, 400, 400)['detail'].replace('no_room=0', 'no_room=1')}, R('deposit', 'cobble never opens a new chest', status='no_effect')], 1000, 256)
    assert nr['no_room_share_canary'] == 0.5 and nr['cobble_no_chest_post_canary'] == 1, nr
    assert judge([B(30, 256, 286), B(30, 300, 330, mins=1), B(0, 990, 990, mins=2, at_cap=1), B(0, 256, 256, cap=256, at_cap=1, **CTL)], 1000, 256)['exposure_ready'] == 0, 'no refusal row: no instrument, not ready'
    unk = judge([R('_stock_refused', 'via=admission n=1 cobble=1 stock=0 at_cobble=0 at_stock=0 cobblestone:95:cobble_unknown', **CTL)], 1000, 256)
    assert unk['instrument_control'] == 0, 'a not-yet-counted refusal is not a town at its cap'
    rc = judge([RF(), RF(mins=1), RF(per='pre', mins=-5)], 1000, 256)
    assert rc['refused_cobble_post_canary'] == 2 and rc['refused_cobble_pre_canary'] == 1, rc
    w = judge([R('_well_dispose', 'slots=36->35 offlist=0 cobble=30 cobble_left=64 cap=at_cap'), R('_well_dispose', 'slots=36->35 offlist=0 cobble=64 cobble_left=64 cap=at_cap', **CTL)], 1000, 256)
    assert w['well_cobble_post_canary'] == 30 and w['well_cobble_post_control'] == 64, w
    nc = judge([R('_deposit_new_chest', 'decision=place_carried aid=x placed=1'), R('deposit', 'chest is full', status='failed')], 1000, 256)
    assert nc['new_chests_post_canary'] == 1 and nc['fullfail_post_canary'] == 1, nc
    # D2 through the real stockjournal.mjs with a cobblecap.mjs whose cap is the module's (the repo's, or STOCK_CC's)
    cands = [os.environ.get('STOCK_CC'), os.path.join(HERE, '..', '..', 'bots', 'src', 'cobblecap.mjs')]
    cc = next((c for c in cands if c and os.path.exists(c)), None)
    if not cc:
        print('JOURNAL SELFTEST SKIPPED: no cobblecap.mjs'); return
    import tempfile
    cap = town_cobble_cap(os.path.join(os.path.dirname(cc), 'stocktarget.mjs'))
    T = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) - 60000

    def jrun(after):
        d = tempfile.mkdtemp(prefix='cobblecap-fx-')
        recs = [{'t': 'cnt', 'k': 'a', 'n': cap - 64, 'cap': T, 'at': T, 'v': 2, 'm': {'cobble': cap - 64}, 'ids': [], 'scan': {'keys': ['a'], 'at': T}, 'w': None},
                {'t': 'claim', 'id': 'c1', 'n': 64, 'k': 'a', 'at': T + 1, 'bot': 'b1', 'keys': ['a'], 'coverage': True, 'gone': [], 'w': None},
                {'t': 'cnt', 'k': 'a', 'n': after, 'cap': T + 5, 'at': T + 5, 'v': 2, 'm': {'cobble': after}, 'ids': ['c1'], 'w': None}]
        with open(os.path.join(d, 'town.cobble.jsonl'), 'w') as fh:
            fh.write(''.join(json.dumps(x) + '\n' for x in recs))
        return journal(cc, 0, T + 600000, [d])
    good = jrun(cap)
    assert good['admitted_cobble_bank'] == 1 and good['breach_c5_journal'] == 0, ('a bank into exactly the cap', good)
    over = jrun(cap + 1)
    assert over['breach_c5_journal'] == 1, ('positive control: released into cap + 1', over)
    print('SELFTEST ok: every gate fails on its fixture and passes its control (journal cap %d from %s)' % (cap, cc))


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
    CANARY_ST = os.environ.get('CANARY_ST') or os.path.expanduser('~/mcai-analysis/cobblecap1000/stocktarget.mjs')
    CAP = town_cobble_cap(CANARY_ST)
    rows, walked, bots, bad, offbuild, noversion = stream(PRE, END, CUT, CANS, CV)
    BASE_ST = os.environ.get('BASE_ST') or os.path.expanduser('~/mcai-analysis/stocktarget/stocktarget.mjs')
    BASE = town_cobble_cap(BASE_ST)
    CTL_CAPS = control_caps([r for r in rows if r['per'] == 'post'])
    res = judge(rows, CAP, BASE)
    try:
        JDIRS, JMISSING = journal_coverage(CANS)
        jr = journal(os.path.join(os.path.dirname(CANARY_ST), 'cobblecap.mjs'), int(CUT.timestamp() * 1000), int(END.timestamp() * 1000), JDIRS)
        jr['missing'] = JMISSING
    except Exception as e:
        print('journal audit failed:', e); jr = None
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('moved', 'at_cap', 'well_cobble', 'new_chests', 'fullfail', 'refused_cobble', 'bank_closed', 'cobble_no_chest')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | other-build canary rows %d'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W, offbuild))
    print('CAPS         canary %d (%s) | base %d (%s) | control rows by cap= %s | versionless canary rows %s%s' % (CAP, CANARY_ST, BASE, BASE_ST, CTL_CAPS, noversion or '-',
          ' | CAPS EQUAL: NO COMPARISON' if res['caps_invalid'] else ''))
    print('LIVENESS     canary banks that moved cobble with town_after above the base cap %d (of %d _cobble_bank rows) | control rows carrying the canary cap %d (must be 0)'
          % (res['bank_above_base_cap'], res['bank_rows_canary'], res['rows_control_canary_cap']))
    d2 = ('%d %s (admitted cobble bank claims %d, towns %d, unreadable %s, pools not covered %s)%s' % (jr['breach_c5_journal'], jr['_g3'], jr['admitted_cobble_bank'], jr['towns'], jr['unreadable'], jr['missing'] or '-',
          '' if jr['admitted_cobble_bank'] else ' UNTESTED') if jr is not None else 'UNREADABLE (blind this read)')
    print('CORRECTNESS  D1 banks past the canary cap %d %s | D2 journal %s' % (res['breach_bank_past_cap'], res['_lists']['d1'], d2))
    print('REPORTED     cobble moved canary %d -> %d control %d -> %d (DiD %+.2f/bot-h) | at-cap refusals DiD %+.3f | well cobble DiD %+.2f | max town_after canary %d control %d | town deposit cobble_cap %s | rows with another cap %d'
          % (res['moved_pre_canary'], res['moved_post_canary'], res['moved_pre_control'], res['moved_post_control'], dids['moved'], dids['at_cap'], dids['well_cobble'],
             res['max_town_after_canary'], res['max_town_after_control'], res['td_cobble_cap'], res['cap_field_other']))
    print('TRIPWIRE     new town chests DiD %+.4f/bot-h (canary %d control %d) | chest-full deposit failures DiD %+.4f/bot-h (canary %d control %d)'
          % (dids['new_chests'], res['new_chests_post_canary'], res['new_chests_post_control'], dids['fullfail'], res['fullfail_post_canary'], res['fullfail_post_control']))
    print('BANK CLOSED  below the cap (tripwire, Claude cc1000-r1 P2): deposits "cobble never opens a new chest" (both arms write it) canary %d -> %d control %d -> %d DiD %+.4f/bot-h | no_room share of the canary\'s own _cobble_bank rows %s | all bank-closed rows DiD %+.4f/bot-h (biased up: only the canary writes _cobble_bank)'
          % (res['cobble_no_chest_pre_canary'], res['cobble_no_chest_post_canary'], res['cobble_no_chest_pre_control'], res['cobble_no_chest_post_control'], dids['cobble_no_chest'],
             res['no_room_share_canary'], dids['bank_closed']))
    print('REFUSALS     at a counted cobble cap: canary %d -> %d control %d -> %d (DiD %+.3f/bot-h; should fall)' % (res['refused_cobble_pre_canary'], res['refused_cobble_post_canary'],
          res['refused_cobble_pre_control'], res['refused_cobble_post_control'], didof('refused_cobble')))
    print('EXPOSURE     canary rows at or above the base cap %d (>= %d) | instrument (control refusals at a counted cobble cap) %d -> %s'
          % (res['exposure_rows'], EXPOSURE_MIN, res['instrument_control'], 'READY' if res['exposure_ready'] else 'NOT YET'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        fields = {k: v for k, v in res.items() if not k.startswith('_') and not isinstance(v, dict)}
        fields.update({'moved_did': clean(dids['moved']), 'at_cap_did': clean(dids['at_cap']), 'well_cobble_did': clean(dids['well_cobble']),
                       'new_chest_did': clean(dids['new_chests']), 'fullfail_did': clean(dids['fullfail']), 'refused_cobble_did': clean(dids['refused_cobble']), 'bank_closed_did': clean(dids['bank_closed']), 'cobble_no_chest_did': clean(dids['cobble_no_chest']), 'other_build_rows': offbuild,
                       'journal_audit_ran': int(jr is not None), 'breach_c5_journal': jr['breach_c5_journal'] if jr is not None else 0,
                       # Codex cc1000-r1 P2: a partial audit is visible in the record, not only on the console
                       'journal_unreadable': len(jr['unreadable']) if jr is not None else None, 'journal_dirs': jr['dirs'] if jr is not None else 0,
                       'journal_pools_missing': len(jr['missing']) if jr is not None else None,
                       'journal_audit_complete': int(jr is not None and not jr['unreadable'] and not jr['missing'] and jr['dirs'] > 0),
                       'versionless_canary_rows': sum(noversion.values()),
                       'admitted_cobble_bank': jr['admitted_cobble_bank'] if jr is not None else 0})
        emit('cobblecapread', W, fields)
    except Exception as e:
        print('emit failed:', e)
