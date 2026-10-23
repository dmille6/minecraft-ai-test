#!/usr/bin/env python3
# ledgerread.py [window_min] -- the read for canary `ledger-01` (cooperation tier B2; docs/reports/cooperation-tier-2026-10-23.md
# 4.2, 4.3, 6.3 B2, 6.4). ledger-01 is OBSERVE-ONLY: at every open of a town furnace (the drain, smelt, smelt_town) and at every
# load's verifying view it appends one `station` record carrying the furnace's three slots AND its outcome (entry / coalesced
# into the furnace's newest entry from any bot / drop over the per-writer refresh cap), and logs one `_ledger_station` row per
# record. Nothing reads the ledger in ledger-01, so the gate is correctness and cost, not an effect. Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# ROWS (bots/src/ledger.mjs ledgerStationDetail, ledgerModeDetail; smeltjob.mjs drainDetail; skills.mjs smelt):
#   _ledger_station  id= f= phase=open|load by= state= outcome=entry|coalesced|drop [into=] in= fuel= out= lit= fold_ms= app_ms=
#   _ledger_mode     once per spawn: phase=mode on=on|off v=1 ... (the A7 contract)
#   _furnace_drain   ... out= in= fuel= ... ledger=<id>|-     (out=- : the drain never read a window)
#   _furnace_session ... by=smelt|smelt_town [open=<id> in= fuel= out=]
#   NAMES ARE EXACT: lib.telemetry folds `_x` into `x`, so every count keys on raw skill.name.
#
#   LICENCE   kind `_ledger_station` (the base cannot write it; one per record).
#   L1 (defect, non-nullable) `l1_defects`: over the canary's window records and opening rows --
#       (a) a record whose outcome is not exactly one of entry / coalesced / drop;
#       (b) a coalesced record whose `into` is not an ENTRY row of the same pool and furnace with EQUAL slots, or is not the
#           furnace's newest entry at the time (an entry newer by > RACE_MS that the writer could have read; a closer one is
#           a concurrent append: reported as `raced`, not counted);
#       (c) a drain row that read a window (out != '-') whose `ledger=` is not a record id (`fail`, `scope`, `off`, or an id
#           with no row), or a record whose slots differ from the row's own out/in/fuel (one in-memory read: serialization);
#       (d) a smelt session whose `open=` is `fail` / `off` or an id with no row, or a record with other slots; a session
#           whose `loads=ok/attempted` shows a load that could not be recorded (`scope` and `unread` are reported, not counted);
#       (e) a `_ledger_station` row with NO PERSISTED record of that id in the town's ledger file, or one whose persisted
#           slots / outcome / into differ (Codex r1 P2-4: the rows are telemetry; the file is the ledger). A record the file
#           can no longer hold (an older generation rotated away) is unresolved: reported, not counted.
#       DENOMINATOR: opening rows that read a window (drains with out != '-', sessions carrying open=) plus coalesced records
#       plus station rows checked against the file.
#   L2 (defect) `l2_defects`: unparsed lines in the canary pools' ledger files (a dead writer's last fragment excepted),
#       dropped TRANSITIONS (a drop whose slots differ from the furnace's newest entry: a changed state must never be
#       dropped), and drops > 1% of the window records.
#   L3 (blocking, not a defect) `l3_ok`: append p95 < 5 ms, fold p95 < 50 ms, and in EVERY canary town the bytes of the
#       records WRITTEN in the window (persisted lines with `at` inside it), per day, < 2 MB (Codex r1 P2-6).
#   ARMS      control `_ledger_mode` / `_ledger_station` rows after the deploy (BLOCKS KEEP).
#   LIVENESS  canary `_ledger_mode on=on` >= 1 and canary `_ledger_station` >= 1.
#   POSITIVE CONTROL  control `_furnace_drain` rows that read a window >= 1 (the instrument that sees opens).
#   EXPOSURE  `station_exposure` = the pooled count of canary window records CONFIRMED in the ledger file if EVERY canary
#             pool has >= 10, else 0 (registered min 50; confirmed records at run time, not the projection).
#   PRIMARY (reported) records per canary bot-h by phase and outcome; coalesced share; "empty" records repeating another
#             bot's empty entry within 60 min (furnaceseen-01's opportunity); drains per bot-h DiD (no change expected).
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

OUTCOMES = ('entry', 'coalesced', 'drop')
MISSES = ('off', 'scope', 'unread', 'fail')     # skills.mjs ledgerObserve's `miss`: the row's marker when nothing was written
RACE_MS = 5000
APPEND_P95_MS, FOLD_P95_MS, BYTES_PER_TOWN_DAY = 5.0, 50.0, 2 * 1024 * 1024
EXPOSURE_PER_POOL = 10


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(detail):
    """PURE. 'k=v k=v ...' -> {k: v} (raw strings)."""
    out = {}
    for tok in (detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out[k] = v
    return out


def slots_of(f):
    """PURE. A station or row field dict -> (in, fuel, out) as row strings ('0' = empty)."""
    return (f.get('in', '?'), f.get('fuel', '?'), f.get('out', '?'))


def p95(xs):
    """PURE. The 95th percentile (nearest rank) or None."""
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, max(0, int(-(-0.95 * len(xs) // 1)) - 1))]


def l1_check(stations, drains, sessions, race_ms=RACE_MS):
    """PURE. stations [(t_ms, pool, bot, f-dict)] (the `_ledger_station` rows), drains / sessions [(t_ms, pool, bot, f-dict)]
    -> {defects: [(why, ...)], raced, denominator}. Every list may hold rows of several pools; ids are global."""
    defects, raced, den = [], 0, 0
    by_id = {}
    for t, p, b, f in stations:
        by_id.setdefault(f.get('id'), (t, p, b, f))
    entries = defaultdict(list)                    # (pool, furnace) -> [(t, id)]
    for t, p, b, f in stations:
        if f.get('outcome') == 'entry':
            entries[(p, f.get('f'))].append((t, f.get('id')))
    for k in entries:
        entries[k].sort()
    for t, p, b, f in stations:
        o = f.get('outcome')
        if o not in OUTCOMES:
            defects.append(('outcome', f.get('id'), o))
            continue
        if o != 'coalesced':
            continue
        den += 1
        into = by_id.get(f.get('into'))
        if not into or into[3].get('outcome') != 'entry' or into[1] != p or into[3].get('f') != f.get('f'):
            defects.append(('coalesced_into_not_an_entry', f.get('id'), f.get('into')))
            continue
        if slots_of(into[3]) + (into[3].get('lit'),) != slots_of(f) + (f.get('lit'),):
            defects.append(('coalesced_slots_differ', f.get('id'), f.get('into')))
            continue
        newer = [(te, i) for te, i in entries[(p, f.get('f'))] if into[0] < te <= t and i != into[3].get('id')]
        if newer:
            if any(t - te > race_ms for te, _ in newer):
                defects.append(('coalesced_not_newest', f.get('id'), f.get('into'), newer[-1][1]))
            else:
                raced += 1
    unread = 0
    for t, p, b, f in drains:
        if f.get('out', '-') == '-':
            continue
        if f.get('out') == '?' or f.get('ledger') == 'unread':
            unread += 1; continue                 # the window itself could not be read: no evidence either way (reported)
        den += 1
        rid = f.get('ledger')
        rec = by_id.get(rid) if rid not in (None, '-') + MISSES else None
        if rec is None:
            defects.append(('drain_without_record', b, f.get('furnace'), rid))
        elif slots_of(rec[3]) != (f.get('in'), f.get('fuel'), f.get('out')):
            defects.append(('drain_row_differs', rid))
    for t, p, b, f in sessions:
        rid = f.get('open')
        if not rid or rid == 'scope':
            continue                              # not a town furnace (the bot's own, far away): not the ledger's
        if rid == 'unread':
            unread += 1; continue
        den += 1
        rec = by_id.get(rid) if rid not in MISSES else None
        if rec is None:
            defects.append(('session_without_record', b, f.get('furnace'), rid))
        elif slots_of(rec[3]) != slots_of(f):
            defects.append(('session_row_differs', rid))
        lo = f.get('loads', '')
        if '/' in lo:
            ok_, att = (num(x) for x in lo.split('/', 1))
            if ok_ is not None and att is not None and att > ok_:
                defects.append(('load_not_recorded', b, f.get('furnace'), lo))
    return {'defects': defects, 'raced': raced, 'denominator': den, 'unread': unread}


def persisted_check(stations, files_by_pool):
    """PURE. stations [(t, pool, bot, f)] + {pool: {'records': {id: rec}, 'boundary': ms|None}} -> {defects,
    confirmed_by_pool, unresolved, checked}. Every station row must have its record in the pool's ledger file with the same
    slots, outcome and into. `boundary` is the start of the OLDEST RETAINED generation (its rotation checkpoint's time; None
    when generation 1 is still there): only a row older than it may have lost its record to a rotation (unresolved); a
    missing record written after it is a defect (Codex r2 P2-2)."""
    defects, unresolved, checked = [], 0, 0
    confirmed = Counter()
    for t, p, b, f in stations:
        fp = files_by_pool.get(p)
        if fp is None:
            unresolved += 1; continue
        rec = fp['records'].get(f.get('id'))
        if rec is None:
            b_ = fp.get('boundary')
            if b_ is not None and t < b_ - 5000:
                unresolved += 1
            else:
                checked += 1; defects.append(('not_persisted', f.get('id')))
            continue
        checked += 1
        sl = rec.get('slots') or {}
        row = lambda x: ':'.join(str(v) for v in x) if x else '0'
        same = (row(sl.get('in')), row(sl.get('fuel')), row(sl.get('out'))) == slots_of(f) and str(int(bool(sl.get('lit')))) == f.get('lit') \
            and rec.get('outcome') == f.get('outcome') and (rec.get('into') or None) == (f.get('into') or None) and rec.get('f') == f.get('f')
        if not same:
            defects.append(('persisted_differs', f.get('id')))
        else:
            confirmed[p] += 1
    return {'defects': defects, 'confirmed_by_pool': dict(confirmed), 'unresolved': unresolved, 'checked': checked}


def window_complete(boundary, cut_ms):
    """PURE. Do the retained generations hold every byte written since cut_ms? Yes when generation 1 is retained (boundary
    None) or the oldest retained generation began at or before the cut."""
    return boundary is None or boundary <= cut_ms


def bytes_written(records_with_len, t0_ms, t1_ms):
    """PURE. [(at_ms, line_bytes)] of one town's persisted records -> bytes of those written inside [t0, t1)."""
    return sum(n for at, n in records_with_len if isinstance(at, (int, float)) and t0_ms <= at < t1_ms)


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def l2_check(stations, unparsed, window_records):
    """PURE. -> {dropped_transitions, drops, drop_share, unparsed, defects}. A drop must repeat the furnace's newest entry."""
    newest = {}
    dropped_transitions = 0
    drops = 0
    for t, p, b, f in sorted(stations, key=lambda x: x[0]):
        o = f.get('outcome')
        key = (p, f.get('f'))
        if o == 'entry':
            newest[key] = f
        elif o == 'drop':
            drops += 1
            e = newest.get(key)
            if e is not None and slots_of(e) + (e.get('lit'),) != slots_of(f) + (f.get('lit'),):
                dropped_transitions += 1
    share = drops / window_records if window_records else 0.0
    defects = unparsed + dropped_transitions + (1 if share > 0.01 else 0)
    return {'dropped_transitions': dropped_transitions, 'drops': drops, 'drop_share': share, 'unparsed': unparsed, 'defects': defects}


def unparsed_lines(path):
    """The ledger file's lines that are not JSON -> (unparsed, lines, bytes). Only an UNTERMINATED LAST line is excepted (a
    writer mid-append, or a dead one's fragment not yet closed); a fragment that a later newline-first append closed off is
    counted (it is a write that died: L2 reports it)."""
    try:
        raw = open(path, 'rb').read()
    except OSError:
        return None
    lines = raw.split(b'\n')
    bad = 0
    n = 0
    for i, ln in enumerate(lines):
        if not ln.strip():
            continue
        n += 1
        try:
            json.loads(ln)
        except Exception:
            if i != len(lines) - 1:            # an unterminated last line is a writer mid-append or dead: not counted
                bad += 1
    return bad, n, len(raw)


def exposure(window_by_pool, pools):
    """PURE. The pooled count of window records if every canary pool has >= EXPOSURE_PER_POOL, else 0."""
    if not pools or any(window_by_pool.get(p, 0) < EXPOSURE_PER_POOL for p in pools):
        return 0
    return sum(window_by_pool.get(p, 0) for p in pools)


# ---- positive controls on the shapes -----------------------------------------------------------------------------------------
_S = lambda i, out='entry', into=None, ins='0', fuel='0', outv='0', f='1,64,1', lit='0': fields(
    f'id={i} f={f} phase=open by=drain state=empty outcome={out}' + (f' into={into}' if into else '') + f' in={ins} fuel={fuel} out={outv} lit={lit} fold_ms=1 app_ms=0')
_st = [(1000, 'P', 'A', _S('a')), (2000, 'P', 'B', _S('b', 'coalesced', 'a'))]
assert l1_check(_st, [], [])['defects'] == [] and l1_check(_st, [], [])['denominator'] == 1
assert l1_check(_st + [(1500, 'P', 'C', _S('x', 'weird'))], [], [])['defects'][0][0] == 'outcome'
# a coalesce into an entry with OTHER slots, or into a non-entry, or into an entry another bot superseded long before
assert l1_check([(1000, 'P', 'A', _S('a', ins='raw_iron:3')), (2000, 'P', 'B', _S('b', 'coalesced', 'a'))], [], [])['defects'][0][0] == 'coalesced_slots_differ'
assert l1_check([(1000, 'P', 'A', _S('a')), (2000, 'P', 'B', _S('b', 'coalesced', 'zz'))], [], [])['defects'][0][0] == 'coalesced_into_not_an_entry'
_late = [(1000, 'P', 'A', _S('a')), (2000, 'P', 'C', _S('c', ins='raw_iron:3')), (60_000, 'P', 'B', _S('b', 'coalesced', 'a'))]
assert l1_check(_late, [], [])['defects'][0][0] == 'coalesced_not_newest'
_race = [(1000, 'P', 'A', _S('a')), (59_000, 'P', 'C', _S('c', ins='raw_iron:3')), (60_000, 'P', 'B', _S('b', 'coalesced', 'a'))]
assert l1_check(_race, [], [])['defects'] == [] and l1_check(_race, [], [])['raced'] == 1
assert l1_check([(1000, 'P', 'A', _S('a')), (2000, 'Q', 'B', _S('b', 'coalesced', 'a'))], [], [])['defects'][0][0] == 'coalesced_into_not_an_entry', 'another pool'
# drains: a window read with no record; a row whose fields differ; a drain that never read a window is not in the denominator
_d = lambda rid, out='0', ins='0', fuel='0': fields(f'stop=empty furnace=1,64,1 lease=3 out={out} in={ins} fuel={fuel} taken=0 left=- t0=1 ledger={rid}')
assert l1_check(_st, [(1000, 'P', 'A', _d('a'))], [])['defects'] == []
assert l1_check(_st, [(1000, 'P', 'A', _d('-'))], [])['defects'][0][0] == 'drain_without_record'
assert l1_check(_st, [(1000, 'P', 'A', _d('a', out='iron_ingot:2'))], [])['defects'][0][0] == 'drain_row_differs'
assert l1_check(_st, [(1000, 'P', 'A', _d('-', out='-', ins='-', fuel='-'))], [])['denominator'] == 1
_ss = lambda rid, ins='0': fields(f'furnace=1,64,1 lease=4 t0=1 t1=2 by=smelt_town open={rid} in={ins} fuel=0 out=0')
assert l1_check(_st, [], [(1000, 'P', 'A', _ss('a'))])['defects'] == []
assert l1_check(_st, [], [(1000, 'P', 'A', _ss('a', ins='raw_copper:8'))])['defects'][0][0] == 'session_row_differs'
assert l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=1,64,1 lease=4 t0=1 t1=2 by=smelt'))])['denominator'] == 1, 'a session without open= is not counted'
# the INDEPENDENT markers (Codex r1 P2-3): a drain or session whose writer failed is a defect; scope/unread are not counted
assert l1_check(_st, [(1000, 'P', 'A', _d('fail'))], [])['defects'][0][0] == 'drain_without_record'
assert l1_check(_st, [(1000, 'P', 'A', _d('scope'))], [])['defects'][0][0] == 'drain_without_record', 'a drain furnace is always in scope'
assert l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=9,9,9 lease=4 t0=1 t1=2 by=smelt open=fail loads=0/0'))])['defects'][0][0] == 'session_without_record'
assert l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=9,9,9 lease=4 t0=1 t1=2 by=smelt open=scope loads=0/0'))])['denominator'] == 1
_u = l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=9,9,9 lease=4 t0=1 t1=2 by=smelt open=unread loads=0/0'))])
assert _u['defects'] == [] and _u['unread'] == 1
assert l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=1,64,1 lease=4 t0=1 t1=2 by=smelt open=a in=0 fuel=0 out=0 loads=1/2'))])['defects'][0][0] == 'load_not_recorded'
assert l1_check(_st, [], [(1000, 'P', 'A', fields('furnace=1,64,1 lease=4 t0=1 t1=2 by=smelt open=a in=0 fuel=0 out=0 loads=2/2'))])['defects'] == []
# PERSISTED (Codex r1 P2-4): a row without its record in the file, or with different persisted fields, is a defect
_rec = {'a': {'id': 'a', 'f': '1,64,1', 'slots': {'in': None, 'fuel': None, 'out': None, 'lit': False}, 'outcome': 'entry'},
        'b': {'id': 'b', 'f': '1,64,1', 'slots': {'in': None, 'fuel': None, 'out': None, 'lit': False}, 'outcome': 'coalesced', 'into': 'a'}}
assert persisted_check(_st, {'P': {'records': _rec, 'rotated': False}})['defects'] == [] and persisted_check(_st, {'P': {'records': _rec, 'rotated': False}})['confirmed_by_pool'] == {'P': 2}
assert persisted_check(_st, {'P': {'records': {'a': _rec['a']}, 'rotated': False}})['defects'] == [('not_persisted', 'b')]
assert persisted_check(_st, {'P': {'records': {'a': _rec['a']}, 'boundary': 10_000}})['unresolved'] == 1, 'a row before the oldest retained generation'
assert persisted_check(_st, {'P': {'records': {'a': _rec['a']}, 'boundary': 1500}})['defects'] == [('not_persisted', 'b')], 'a row AFTER it must be in the file'
assert window_complete(None, 100) and window_complete(50, 100) and not window_complete(150, 100)
assert persisted_check(_st, {'P': {'records': dict(_rec, a=dict(_rec['a'], slots={'in': ['raw_iron', 1], 'fuel': None, 'out': None, 'lit': False})), 'rotated': False}})['defects'] == [('persisted_differs', 'a')]
assert bytes_written([(5, 100), (15, 200), (25, 50)], 10, 25) == 200
# L2: a dropped TRANSITION is a defect; a dropped repeat is not; the 1% share
_l2 = [(1000, 'P', 'A', _S('a')), (2000, 'P', 'A', _S('d', 'drop'))]
assert l2_check(_l2, 0, 200)['dropped_transitions'] == 0 and l2_check(_l2, 0, 200)['defects'] == 0
assert l2_check([(1000, 'P', 'A', _S('a')), (2000, 'P', 'A', _S('d', 'drop', ins='raw_iron:1'))], 0, 200)['dropped_transitions'] == 1
assert l2_check(_l2, 0, 50)['defects'] == 1, 'one drop in 50 records is 2% > 1%'
assert l2_check(_l2, 3, 200)['defects'] == 3
assert p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100]) == 19 and p95([]) is None
assert exposure({'a': 12, 'b': 30}, ['a', 'b']) == 42 and exposure({'a': 9, 'b': 300}, ['a', 'b']) == 0 and exposure({}, []) == 0
assert slots_of(fields('in=raw_iron:3 fuel=0 out=iron_ingot:1')) == ('raw_iron:3', '0', 'iron_ingot:1')


if __name__ == '__main__' and sys.argv[1:2] == ['--selftest']:
    print('SELFTEST OK')                      # the module-level fixtures above ran on import
    sys.exit(0)

if __name__ == '__main__':
    from lib.telemetry import Events
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware (smeltjobread's): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw_name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); span = defaultdict(lambda: [None, None]); nrows = Counter()
    n = Counter(); leak = 0; offbuild = 0; noversion = 0
    stations, drains, sessions = [], [], []
    by_pool = Counter()
    fold_ms, app_ms = [], []
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1; continue
            if not ver.startswith(CV):
                offbuild += 1; continue        # restart-lag rows on another build are not canary
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = raw_name(r); d = r.get('detail') or ''
        tms = int(t.timestamp() * 1000)
        if k in ('_ledger_mode', '_ledger_station') and period == 'post' and arm == 'control':
            leak += 1
        if k == '_ledger_mode' and period == 'post' and arm == 'canary' and ' on=on ' in f' {d} ':
            n['licence_mode'] += 1
        elif k == '_ledger_station' and period == 'post' and arm == 'canary':
            f = fields(d)
            stations.append((tms, pool_of(b), b, f))
            by_pool[pool_of(b)] += 1
            n[('phase', f.get('phase'))] += 1; n[('outcome', f.get('outcome'))] += 1
            try:
                fold_ms.append(float(f.get('fold_ms'))); app_ms.append(float(f.get('app_ms')))
            except (TypeError, ValueError):
                pass
        elif k == '_furnace_drain':
            f = fields(d)
            if f.get('out', '-') != '-':
                n[(period, arm, 'drain_open')] += 1
            n[(period, arm, 'drain')] += 1
            if period == 'post' and arm == 'canary':
                drains.append((tms, pool_of(b), b, f))
        elif k == '_furnace_session' and period == 'post' and arm == 'canary':
            sessions.append((tms, pool_of(b), b, fields(d)))

    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)

    window_records = len(stations)
    l1 = l1_check(stations, drains, sessions)
    # THE LEDGER FILES of the canary pools (beside the town index): unparsed lines, the persisted records, bytes written
    unparsed, files, unreadable_files = 0, 0, 0
    files_by_pool, written = {}, {}
    CUT_MS, END_MS = int(CUT.timestamp() * 1000), int(END.timestamp() * 1000)
    for p in sorted(CANS):
        recs, lens, gens, ckpt_at = {}, [], [], {}
        for f_ in sorted(glob.glob('/var/lib/mcai/_pool-%s/ledger-*.g*.jsonl' % p)):
            u = unparsed_lines(f_)
            if u is None:
                unreadable_files += 1; continue
            unparsed += u[0]; files += 1
            m_ = re.search(r'\.g(\d+)\.jsonl$', f_)
            if m_:
                gens.append(int(m_.group(1)))
            for ln in open(f_, 'rb').read().split(b'\n'):
                try:
                    rr = json.loads(ln)
                except Exception:
                    continue
                if rr.get('t') == 'station' and rr.get('id'):
                    recs[rr['id']] = rr; lens.append((rr.get('at'), len(ln) + 1))
                elif rr.get('t') == 'ckpt':
                    lens.append((rr.get('at'), len(ln) + 1))          # a checkpoint is written bytes too (Codex r2 P2-1)
                    if m_:
                        g_ = int(m_.group(1))
                        ckpt_at[g_] = min(ckpt_at.get(g_, rr.get('at') or 0), rr.get('at') or 0)
        boundary = None if not gens or min(gens) == 1 else ckpt_at.get(min(gens))
        if gens and min(gens) > 1 and boundary is None:
            boundary = END_MS                         # an oldest generation with no checkpoint: nothing older is provable
        files_by_pool[p] = {'records': recs, 'boundary': boundary, 'files': len(gens)}
        # L3's bytes are only countable when the retained generations hold the whole window (rotation deletes): else undefined
        written[p] = bytes_written(lens, CUT_MS, END_MS) if window_complete(boundary, CUT_MS) else None
    # A POOL WITH ROWS AND NO LEDGER FILE (Claude r1 P2-2): L2 and L3 cannot be read there -- undefined, never "0 unparsed"
    no_file = sorted(p for p in CANS if by_pool.get(p, 0) > 0 and not files_by_pool.get(p, {}).get('files'))
    pc = persisted_check(stations, files_by_pool)
    l1['defects'] += pc['defects']; l1['denominator'] += pc['checked']
    l2 = l2_check(stations, unparsed, window_records)
    days = max(W / 1440.0, 1e-9)
    incomplete = sorted(p for p, v in written.items() if v is None)
    per_town_day = max([v / days for v in written.values() if v is not None] or [0])          # the WORST town, not the mean
    a95, f95 = p95(app_ms), p95(fold_ms)
    l3_ok = int(a95 is not None and f95 is not None and a95 < APPEND_P95_MS and f95 < FOLD_P95_MS and per_town_day < BYTES_PER_TOWN_DAY and not unreadable_files)
    expo = exposure(pc['confirmed_by_pool'], sorted(CANS))
    # furnaceseen-01's opportunity: an 'empty' open record by one bot repeating ANOTHER bot's empty entry < 60 min old
    last = {}
    repeat_empty = 0
    for t, p, b, f in sorted(stations, key=lambda x: x[0]):
        key = (p, f.get('f'))
        e = last.get(key)
        if f.get('phase') == 'open' and f.get('state') == 'empty' and e and e[2] == 'empty' and e[1] != b and t - e[0] < 3600_000:
            repeat_empty += 1
        last[key] = (t, b, f.get('state'))
    can_bh = bot_hours('post', 'canary')
    ctl_drain_open = n[('post', 'control', 'drain_open')]
    rate = lambda per, arm: (n[(per, arm, 'drain')] / bot_hours(per, arm)) if bot_hours(per, arm) else float('nan')
    drain_did = (rate('post', 'canary') - rate('pre', 'canary')) - (rate('post', 'control') - rate('pre', 'control'))

    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary _ledger_mode on=on %d | canary _ledger_station %d' % (n['licence_mode'], window_records))
    print('EXPOSURE     window records by canary pool %s, CONFIRMED in the file %s -> station_exposure %d (every pool >= %d; registered min 50)' % (dict(by_pool), pc['confirmed_by_pool'], expo, EXPOSURE_PER_POOL))
    print('PRIMARY      records: open %d load %d | entry %d coalesced %d drop %d (coalesced share %.3f) | per canary bot-h %.2f | empty repeating another bot\'s empty < 60 min: %d'
          % (n[('phase', 'open')], n[('phase', 'load')], n[('outcome', 'entry')], n[('outcome', 'coalesced')], n[('outcome', 'drop')],
             n[('outcome', 'coalesced')] / window_records if window_records else float('nan'), window_records / can_bh if can_bh else float('nan'), repeat_empty))
    print('L1 (defect)  %d defects over %d (opening rows that read a window + coalesced records + rows checked against the file) | raced (concurrent appends, reported) %d | unread windows %d | unresolved (rotated away) %d | %s'
          % (len(l1['defects']), l1['denominator'], l1['raced'], l1['unread'], pc['unresolved'], l1['defects'][:4]))
    print('             pools with rows but NO ledger file (L2/L3 undefined there): %s' % (no_file or '-'))
    print('L2 (defect)  unparsed lines %d in %d files | dropped transitions %d | drops %d (%.4f of records) -> %d'
          % (unparsed, files, l2['dropped_transitions'], l2['drops'], l2['drop_share'], l2['defects']))
    print('L3 (block)   append p95 %s ms (< %g) | fold p95 %s ms (< %g) | worst town %.0f bytes written per day (< %d) %s | unreadable files %d | window rotated away (L3 undefined) %s -> %s'
          % (a95, APPEND_P95_MS, f95, FOLD_P95_MS, per_town_day, BYTES_PER_TOWN_DAY, written, unreadable_files, incomplete or '-',
             'UNDEFINED' if (no_file or incomplete) else 'ok' if l3_ok else 'NOT OK'))
    print('ARMS         control _ledger_mode / _ledger_station rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control drains that read a window post %d (the positive control) | drains per bot-h DiD %+.3f (no change expected)' % (ctl_drain_open, drain_did))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('ledgerread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild, 'noversion_canary': noversion,
            'licence_rows': window_records, 'mode_rows': n['licence_mode'],
            'liveness': int(n['licence_mode'] >= 1 and window_records >= 1),
            'station_exposure': expo, 'window_records': window_records,
            # no canary version: the off-build filter cannot run, so L1 is undefined
            'l1_defects': len(l1['defects']) if CV else None,
            'l1_denominator': l1['denominator'], 'l1_raced': l1['raced'], 'l1_unread': l1['unread'],
            'l1_unresolved': pc['unresolved'], 'confirmed_records': sum(pc['confirmed_by_pool'].values()), 'unreadable_files': unreadable_files,
            'l2_defects': None if no_file else l2['defects'], 'unparsed_lines': unparsed, 'dropped_transitions': l2['dropped_transitions'], 'drops': l2['drops'],
            'l3_ok': None if (no_file or incomplete) else l3_ok, 'pools_window_rotated': incomplete, 'pools_without_ledger_file': no_file, 'append_p95_ms': a95, 'fold_p95_ms': f95, 'bytes_per_town_day': round(per_town_day),
            'rows_control_post': leak, 'instrument_control': int(ctl_drain_open >= 1),
            'coalesced': n[('outcome', 'coalesced')], 'repeat_empty_other_bot': repeat_empty,
            'drains_per_bh_did': nanless(drain_did), 'canary_bot_hours': round(can_bh, 2),
        })
    except Exception as e:
        print('emit failed:', e)
