#!/usr/bin/env python3
# matsread.py [window_min] -- the read for canary `mats-01` (the building tier's materials job: docs/reports/building-tier-2026-10-23.md
# section 3, 6.1; branch mats-on-7b9db3a). ironsmeltread.py's plumbing (rotation-aware load, restart-lag rows skipped, per-pool
# world evidence from the town index). Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# ROWS (bots/src/mats.mjs matsDetail; skills.mjs makeMaterial / matsReturn):
#   _make_material   one per order: kind= verdict= made= forbidden= stone=b0>b1 note= ml=t0-t1 stock= took= reserve= stop= ...
#                    (the gate fields FIRST: the logger cuts details at 300 chars; stop= is capped at 60 chars)
#   _mats_mode       once per spawn (the licence): phase=mode v= on= kinds= reserve=k:n,... reserve_src= buffers= ...
#   _mats_return     the recovery: kind= verdict=ok|loss|forbidden|unreconciled|pending forbidden= stop=closed|open|abandoned|error
#                    tries= waits= batch= out= back= short= made= banked= drained= ... (its own balance, judged only on the attempt
#                    that ENDS the note: closed or abandoned; an open one is verdict=pending)
#   _mats_skip       why=<reason> (at most one per bot per reason per 30 min)
#   _furnace_session furnace= lease= t0= t1= by=smelt|drain|make_material|mats_return (every furnace lease's interval)
#   NAMES ARE EXACT: lib.telemetry folds `_x` into `x`, so every count keys on raw skill.name.
#
# THE WORLD (not the bot's claims): the town index (townindex-01) -- what the SERVER sent at every open of a town container, by any
# bot. Per pool, the building parts' stock change over the containers KNOWN at both ends of each period, KNOWN as the bot's own
# townindex.indexStateOf has it (r2, Codex r1 P1-8): the latest record an observation, not captured while a mutation was open
# (a pre/held mark with no post, within OP_TTL_MS), and fresh. Arms compared by per-pool MEANS of post-minus-pre, paired pools
# only. A boundary before the pool's first index record is UNAVAILABLE (None), never a zero.
#
#   LICENCE    kind `_mats_mode` (the base cannot write it).
#   THE DENOMINATOR (r2, Codex r1 P1-6, Claude r1 P1-3): a MOVED row is a non-count order that took, used from the bag or made
#              something. G2 and the unreconciled share are over MOVED rows only (a count or a no-op skip always reads ok).
#   GATES (REVERT, defect -- design 6.1)
#     G1 forbidden: a canary _make_material OR _mats_return row with verdict=forbidden (the bag held fewer of an iron-ladder name
#        or a fuel -- coal, charcoal, iron -- after it, beyond a recovery's own charcoal made into torches). ANY. A tool worn out on
#        the order's walk is tools_lost, reported, not G1.
#     G2 loss: MOVED rows verdict=loss or overburn (a family short beyond the order's own counted placements, or more planks
#        burned than the smelt needed, one more allowed on a clock cut) -- a recovery of a loaded batch is a MOVED row too, its
#        balance its own -- at least 2 AND > 5% of the reconciled MOVED rows. verdict=scaffold (a shortfall the order's own
#        placements explain: design 3.2) is reconciled and REPORTED, never G2.
#     G3 reserve_crossed: a row whose own reading of the town (stock=, index-known) less what it took of an input is below that
#        input's reserve (the licence row's reserve=) -- ANY. A row that took a reserved input with no stock= key for it (cut,
#        absent) or with no licence reserve is UNJUDGED and blocks KEEP (never a pass by default).
#     G4 stone_leak: a bricks row whose bag stone rose by FOUR OR MORE (stone=b0>b1, b1-b0 >= 4: a craft still owed) with its
#        note closed -- ANY. (A 1-3 remainder is ordinary stone with the note closed: design deviation 2, stone_left= booked.)
#     G5 overlap: two canary bots' MATERIALS LEASES (ml=, the lease held, not the runner's interval: a count or a busy refusal
#        holds none) overlapping in one pool; or two bots' furnace leases overlapping on one furnace of one pool where at least
#        one is make_material's or mats_return's and both were leased -- ANY. A pair with an unleased smelt is reported (WATCH).
#        A lease-taking row (a non-count MOVED row) with no ml= is UNJUDGED and blocks KEEP.
#     G6 loop: a canary bot with more than 7 make_material rows in any 60 min (the 10 min cooldown broken).
#     ARMS  control _mats_mode or _make_material rows after the deploy (BLOCKS KEEP).
#   NOTES (BLOCK KEEP): a note given up (_mats_return stop=abandoned), a row verdict=unreconciled above 5% of moved, or a note
#              still OPEN at the window's end (the bot's last note event an open one).
#   LIVENESS   canary licence rows >= 1 and canary _make_material rows >= 1.
#   POSITIVE CONTROL / INSTRUMENT  control rung completions (_milestone_complete) >= 1, index records in >= 1 control pool AND
#              in every canary pool, and _furnace_session rows seen in the window (any arm) -- each the instrument a gate
#              reads, shown to see something.
#   EXPOSURE   >= 20 parts made by MOVED rows with verdict=ok (design 6.1) AND the world's canary parts stock change >= 12 (one
#              batch: the index sees the parts in town) AND the instrument -- KEEP needs exposure_ready.
#   NO-HARM (WATCH, DiD) rung completions per bot-h, gather successes per bot-h, the smelt `furnace_busy` share, bag fill (mean
#              occupied slots of the snapshots).
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

PARTS = ('stone_bricks', 'glass_pane', 'cut_copper', 'copper_door', 'torch')
LOGS = ('oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log')


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


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def kv(s):
    """PURE. 'a:1,b:2' -> {a: 1, b: 2}; '-' or junk -> {}."""
    out = {}
    for part in (s or '').split(','):
        m = re.match(r'^([a-z0-9_]+):(-?\d+(?:\.\d+)?)$', part.strip())
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


def reserve_key(name):
    """PURE. mats.mjs reserveKeyOf."""
    if name in LOGS:
        return 'logs'
    if name.endswith('_planks'):
        return 'planks'
    if name == 'stick':
        return 'sticks'
    if name in ('sand', 'red_sand'):
        return 'sand'
    if name in ('cobblestone', 'copper_ingot', 'torch'):
        return name
    return None


def judge_reserve(f, reserve):
    """PURE. The order's OWN reading of the town (stock=) less what it took, against the reserve -> (crossed [key], unjudged [key]).
    A reserved input taken with no stock= key for it (the logger's cut, or absent) or no reserve for it is UNJUDGED (r2, Codex r1
    P1-6): never a pass by default. A token cut mid-number cannot pass for a whole one: stock= now precedes stop=, and the last
    stock= token of a detail at the 300-char cut is dropped (then unjudged)."""
    d = f.get('_detail') or ''
    stock_raw = f.get('stock') or ''
    if len(d) >= 299 and stock_raw not in ('', '-') and d.rstrip().endswith('stock=' + stock_raw):
        stock_raw = ','.join(stock_raw.split(',')[:-1])
    stock = kv(stock_raw); took = kv(f.get('took'))
    by = defaultdict(float)
    for n, c in took.items():
        k = reserve_key(n)
        if k:
            by[k] += c
    out, unj = [], []
    for k, c in by.items():
        if k not in stock or k not in (reserve or {}):
            unj.append(k); continue
        if stock[k] - c < reserve[k]:
            out.append(k)
    return sorted(out), sorted(unj)


def crossed(f, reserve):
    """PURE. judge_reserve's crossings only."""
    return judge_reserve(f, reserve)[0]


def moved(f):
    """PURE. A MOVED row: a non-count order that took, used from the bag or made something (a count or a skip moves nothing)."""
    if f.get('kind') in (None, '-', 'count'):
        return False
    return bool(kv(f.get('took'))) or bool(kv(f.get('bag'))) or (num(f.get('made')) or 0) > 0 or (num(f.get('smelted')) or 0) > 0


def stone_leak(f):
    """PURE. A bricks row whose bag stone rose by FOUR or more (a craft still owed) with its note closed. A 1-3 remainder is
    ordinary stone (deviation 2): the note closes on it by design."""
    m = re.match(r'^(\d+)>(\d+)$', f.get('stone') or '')
    return bool(m) and int(m.group(2)) - int(m.group(1)) >= 4 and f.get('note') == 'closed'


def interval(s_):
    """PURE. 'a-b' (ms) -> (a, b) with a <= b, or None."""
    m = re.match(r'^(\d+)-(\d+)$', s_ or '')
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(2))
    return (a, b) if a <= b else None


def overlaps(intervals, involve=None):
    """PURE. [(t0, t1, who[, tag])] -> pairs of DIFFERENT `who` whose intervals overlap (sorted by t0); with `involve`, only the
    pairs where at least one interval's tag is in it."""
    iv = sorted(intervals)
    out = []
    for i in range(len(iv)):
        for j in range(i + 1, len(iv)):
            if iv[j][0] >= iv[i][1]:
                break
            if iv[j][2] == iv[i][2]:
                continue
            if involve is not None and not ((len(iv[i]) > 3 and iv[i][3] in involve) or (len(iv[j]) > 3 and iv[j][3] in involve)):
                continue
            out.append((iv[i][2], iv[j][2], iv[i][0], iv[j][0]))
    return out


def notes_open_at_end(events):
    """PURE. [(t_ms, bot, 'open'|'closed')] -> bots whose LAST note event is an open note."""
    last = {}
    for t, b, st in sorted(events):
        last[b] = st
    return sorted(b for b, st in last.items() if st == 'open')


def window_rate(ts, per_ms=3600_000):
    """PURE. Sorted ms timestamps -> the most rows in any per_ms window."""
    best = 0; j = 0
    for i, t in enumerate(ts):
        while ts[j] < t - per_ms + 1:
            j += 1
        best = max(best, i - j + 1)
    return best


STALE_MS = 6 * 3600 * 1000        # townindex.mjs INDEX_STALE_MS
OP_TTL_MS = 10 * 60 * 1000        # townindex.mjs OP_TTL_MS


def _supersedes(b, a):
    """PURE (townindex.mjs supersedes): later capture first; a tie: dirty over obs, then the larger id."""
    if a is None:
        return True
    if b[0] != a[0]:
        return b[0] > a[0]
    if b[1] != a[1]:
        return b[1] > a[1]
    return b[2] > a[2]


def known_at(records, at_ms, stale_ms=STALE_MS):
    """PURE. Index records (obs, dirty with op/phase marks, and `mark`: a checkpoint's op marks, which touch no `last`) ->
    {(world, container): names} KNOWN at at_ms, as townindex.mjs foldIndex + indexStateOf have it (r2, Codex r1 P1-8): the
    latest record (supersedes) an observation; that observation not captured while a mutation was OPEN (a pre or held mark
    with no post, from its pre mark to OP_TTL_MS past its pre or latest held); and fresh."""
    ent = {}
    for r in records:
        at = r.get('at')
        if not isinstance(at, (int, float)) or at > at_ms or r.get('k') is None or r.get('t') not in ('obs', 'dirty', 'mark'):
            continue
        e = ent.setdefault((str(r.get('w')), r['k']), {'last': None, 'obs': None, 'ops': {}})
        t = r.get('t')
        if t in ('obs', 'dirty'):
            rk = (at, 1 if t == 'dirty' else 0, str(r.get('id') or ''), t)
            if _supersedes(rk, e['last']):
                e['last'] = rk
        if t in ('dirty', 'mark') and r.get('op') is not None and r.get('phase') in ('pre', 'post', 'held'):
            o = e['ops'].setdefault(r['op'], {'pre': None, 'held': None, 'post': None})
            ph = r['phase']
            o[ph] = at if o[ph] is None else (min(o[ph], at) if ph == 'pre' else max(o[ph], at))
        if t == 'obs':
            ok = (at, 0, str(r.get('id') or ''))
            if e['obs'] is None or _supersedes(ok, (e['obs']['at'], 0, str(e['obs'].get('id') or ''))):
                e['obs'] = r

    def open_at(ops, at):
        for o in ops.values():
            if o['post'] is not None or (o['pre'] is None and o['held'] is None):
                continue
            start = o['pre'] if o['pre'] is not None else float('-inf')
            until = max(o['pre'] if o['pre'] is not None else float('-inf'), o['held'] if o['held'] is not None else float('-inf')) + OP_TTL_MS
            if start <= at < until:
                return True
        return False

    out = {}
    for key, e in ent.items():
        if e['last'] is None or e['last'][3] == 'dirty' or e['obs'] is None:
            continue
        if open_at(e['ops'], e['obs']['at']):
            continue
        if at_ms - e['obs']['at'] < stale_ms:
            out[key] = e['obs'].get('names') or {}
    return out


def stock_change(records, a_ms, b_ms, names=PARTS, first_ms=None):
    """PURE (ironsmeltread's). Stock change over containers KNOWN at both ends -> ({name: delta}, n) or (None, 0)."""
    if first_ms is None or a_ms < first_ms:
        return None, 0
    ka, kb = known_at(records, a_ms), known_at(records, b_ms)
    both = set(ka) & set(kb)
    if not both:
        return None, 0
    cnt = lambda m, n: int((m.get(n) or [0])[0] or 0)
    return {n: sum(cnt(kb[k], n) - cnt(ka[k], n) for k in both) for n in names}, len(both)


def licence_reserve(detail):
    """PURE. The _mats_mode row's reserve=k:n,... -> {k: n}."""
    return {k: int(v) for k, v in kv(fields(detail).get('reserve')).items()}


# ---- positive controls on the shapes (mats.mjs matsDetail / matsModeDetail) ------------------------------------------------
_d = fields('kind=bricks verdict=ok made=12 forbidden=- stone=0>0 note=closed ml=1000-2000 stock=cobblestone:800,logs:1300,stone_bricks:0 took=oak_log:2,cobblestone:12 reserve=default stop=done part=stone_bricks')
_res = licence_reserve('phase=mode v=1 on=1 kinds=bricks reserve=cobblestone:256,logs:512,planks:71,sticks:40,copper_ingot:512,sand:16,torch:32 reserve_src=default')
assert _res == {'cobblestone': 256, 'logs': 512, 'planks': 71, 'sticks': 40, 'copper_ingot': 512, 'sand': 16, 'torch': 32}, _res
assert crossed(_d, _res) == [], 'a normal order crosses nothing'
assert crossed(dict(_d, stock='cobblestone:265,logs:1300'), _res) == ['cobblestone'], '265 - 12 < 256'
assert crossed(dict(_d, stock='cobblestone:268,logs:514'), _res) == [], 'exactly one batch above: lands on the reserve'
assert crossed(dict(_d, stock='logs:513'), _res) == ['logs']
# UNJUDGED, never a pass (Codex r1 P1-6): a cut or absent stock= key, or no licence reserve
assert judge_reserve({'took': 'oak_log:2'}, _res) == ([], ['logs']), 'no stock= key: unjudged'
assert judge_reserve(dict(_d, stock='cobblestone:800'), _res) == ([], ['logs']), 'logs absent from stock=: unjudged'
assert judge_reserve(_d, {}) == ([], ['cobblestone', 'logs']), 'no licence reserve: unjudged'
assert judge_reserve(_d, _res) == ([], []), 'positive control: a whole row is judged, and passes'
_head = 'kind=bricks verdict=ok made=12 forbidden=- stone=0>0 note=closed ml=1-2 took=oak_log:2 pad='
_tail = ' stock=cobblestone:900,logs:13'
_cut300 = _head + 'y' * (300 - len(_head) - len(_tail)) + _tail
assert len(_cut300) == 300 and judge_reserve(dict(fields(_cut300), _detail=_cut300), _res) == ([], ['logs']), 'the token at the 300-char cut is not trusted'
_short = _head + 'y' + _tail
assert judge_reserve(dict(fields(_short), _detail=_short), _res) == (['logs'], []), 'positive control: the same token in a short detail is judged (and crosses)'
# MOVED: counts and skips are not the denominator (Claude r1 P1-3)
assert moved(_d) and not moved(fields('kind=count verdict=ok made=0 took=-')) and not moved(fields('kind=bricks verdict=ok made=0 took=- stop=no_furnace'))
# G4: a 1-3 remainder with the note closed is the design (deviation 2); four or more is a craft owed
assert not stone_leak(_d) and not stone_leak(dict(_d, stone='0>3')) and stone_leak(dict(_d, stone='0>4')) and not stone_leak(dict(_d, stone='0>4', note='open'))
assert overlaps([(0, 10, 'a'), (5, 15, 'b'), (20, 30, 'a')]) == [('a', 'b', 0, 5)] and overlaps([(0, 10, 'a'), (5, 15, 'a')]) == []
assert overlaps([(0, 10, 'a', 'smelt'), (5, 15, 'b', 'smelt')], involve={'make_material', 'mats_return'}) == [], 'two smelts are not this canary\'s'
assert overlaps([(0, 10, 'a', 'smelt'), (5, 15, 'b', 'mats_return')], involve={'make_material', 'mats_return'}) == [('a', 'b', 0, 5)]
assert interval('1000-2000') == (1000, 2000) and interval('-') is None and interval('5-1') is None
assert notes_open_at_end([(1, 'a', 'open'), (2, 'a', 'closed'), (3, 'b', 'open')]) == ['b']
assert window_rate([0, 10, 20]) == 3 and window_rate([]) == 0
_R = [{'t': 'obs', 'k': 'a', 'at': 10, 'names': {'stone_bricks': [0, 0]}, 'w': 'W'}, {'t': 'obs', 'k': 'a', 'at': 20, 'names': {'stone_bricks': [12, 1]}, 'w': 'W'}]
assert stock_change(_R, 15, 25, first_ms=10) == ({'stone_bricks': 12, 'glass_pane': 0, 'cut_copper': 0, 'copper_door': 0, 'torch': 0}, 1)
assert stock_change(_R, 5, 25, first_ms=10) == (None, 0), 'before the index began: unavailable'
# THE INDEX'S OWN "KNOWN" (Codex r1 P1-8): an observation inside an unfinished mutation is not known; with its post mark it is;
# an open mark past OP_TTL_MS no longer protects; a dirty record after the observation makes it not known
_O = [{'t': 'obs', 'w': 'W', 'k': 'c', 'at': 10, 'names': {'stone_bricks': [0, 0]}}, {'t': 'dirty', 'w': 'W', 'k': 'c', 'at': 15, 'op': 'x', 'phase': 'pre'},
      {'t': 'obs', 'w': 'W', 'k': 'c', 'at': 20, 'names': {'stone_bricks': [12, 1]}}]
assert known_at(_O, 25) == {}, 'captured while the op was open: dirty'
assert known_at(_O + [{'t': 'dirty', 'w': 'W', 'k': 'c', 'at': 22, 'op': 'x', 'phase': 'post'}], 25) == {}, 'the post mark is the latest record: dirty until re-observed'
assert known_at(_O + [{'t': 'dirty', 'w': 'W', 'k': 'c', 'at': 18, 'op': 'x', 'phase': 'post'}], 25) == {('W', 'c'): {'stone_bricks': [12, 1]}}, 'closed before the capture: known'
assert known_at([_O[0], dict(_O[1], at=10 - OP_TTL_MS - 5), _O[2]], 25) == {('W', 'c'): {'stone_bricks': [12, 1]}}, 'an open mark past its TTL: known'
assert known_at([dict(_O[1], t='mark'), _O[2]], 25) == {}, 'a checkpoint\'s open mark protects too'
assert known_at([_O[0]], 10 + STALE_MS) == {} and known_at([_O[0]], 11) == {('W', 'c'): {'stone_bricks': [0, 0]}}, 'stale vs fresh'
# THE SAME-MS TIE (Codex r2 P2-9): the larger id wins, whichever record comes first -- a checkpoint's observation keeps its id
_z = {'t': 'obs', 'w': 'W', 'k': 'c', 'at': 30, 'id': 'z', 'names': {'stone_bricks': [12, 1]}}
_a = {'t': 'obs', 'w': 'W', 'k': 'c', 'at': 30, 'id': 'a', 'names': {'stone_bricks': [0, 0]}}
assert known_at([_z, _a], 31) == known_at([_a, _z], 31) == {('W', 'c'): {'stone_bricks': [12, 1]}}, 'the larger id wins either way'
assert known_at([dict(_z, id=None), _a], 31) == {('W', 'c'): {'stone_bricks': [0, 0]}}, 'positive control: an id dropped loses the tie'

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

    raw = lambda r: ((r.get('raw') or {}).get('skill') or {})
    raw_name = lambda r: raw(r).get('name') or ''
    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    # THE POPULATION: shared towns (the job is off in isolated pools); every pool with rung rows, isolated-* excluded unless canary
    POOLS = {pool_of((r.get('bot') or {}).get('name')) for r in rows if raw_name(r) == '_milestone_complete'}
    POOLS = {p for p in POOLS if not p.startswith('isolated-') and not p.startswith('self-')} | set(CANS)
    bots = defaultdict(set); nrows = Counter(); offbuild = 0; noversion = 0
    n = Counter(); jobs = []; job_ts = defaultdict(list); leak = 0; reserve = {}
    runs = defaultdict(list); fsess = defaultdict(list); slots = defaultdict(list)
    note_ev = []; returns = Counter(); fsess_seen = Counter(); ret_rows = []
    span = defaultdict(lambda: [None, None])
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b or pool_of(b) not in POOLS:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1; continue
            if not ver.startswith(CV):
                offbuild += 1; continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = raw_name(r); d = r.get('detail') or ''; st = raw(r).get('status')
        tms = int(t.timestamp() * 1000)
        inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
        if isinstance(inv, dict) and len(slots[(period, arm)]) < 200000:
            slots[(period, arm)].append(len(inv))
        if k == '_mats_mode':
            if period == 'post':
                n[(arm, 'licence')] += 1
                if arm == 'control':
                    leak += 1
                else:
                    reserve = licence_reserve(d) or reserve
        elif k == '_make_material':
            if period == 'post':
                if arm == 'control':
                    leak += 1
                else:
                    f = dict(fields(d), _detail=d)
                    jobs.append((tms, b, st, f))
                    job_ts[b].append(tms)
                    # THE MATERIALS LEASE HELD (ml=): G5's interval (r2: never the runner's, which a count or a busy refusal has)
                    iv = interval(f.get('ml'))
                    if iv:
                        runs[pool_of(b)].append((iv[0], iv[1], b))
                    note_ev.append((tms, b, 'open' if f.get('note') == 'open' else 'closed'))
        elif k == '_mats_return':
            if period == 'post' and arm == 'canary':
                f = fields(d)
                returns[f.get('stop') or '-'] += 1
                ret_rows.append((tms, b, st, f))
                if f.get('stop') in ('closed', 'abandoned'):
                    note_ev.append((tms, b, 'closed'))
                elif f.get('stop') == 'open':
                    note_ev.append((tms, b, 'open'))
        elif k == '_furnace_session':
            f = fields(d)
            fsess_seen[(period, arm)] += 1
            if period == 'post' and arm == 'canary':
                # EVERY session type, keyed by POOL and furnace (r2, Codex r1 P1-7): pools are separate worlds that reuse coordinates
                a0, a1 = num(f.get('t0')), num(f.get('t1'))
                if a0 is not None and a1 is not None and a0 <= a1:
                    fsess[(pool_of(b), f.get('furnace'))].append((a0, a1, b, f.get('by') or '-', f.get('lease') == 'unleased'))
        elif k == '_milestone_complete':
            n[(period, arm, 'rungs')] += 1
        elif k == 'gather':
            if st == 'success':
                n[(period, arm, 'gather')] += 1
        elif k == 'smelt':
            n[(period, arm, 'smelt')] += 1
            if 'in use by another bot' in d:
                n[(period, arm, 'furnace_busy')] += 1

    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)

    def per_bh(v, period, arm):
        bh = bot_hours(period, arm)
        return v / bh if bh else float('nan')

    def did_rate(key):
        return (per_bh(n[('post', 'canary', key)], 'post', 'canary') - per_bh(n[('pre', 'canary', key)], 'pre', 'canary')) - \
               (per_bh(n[('post', 'control', key)], 'post', 'control') - per_bh(n[('pre', 'control', key)], 'pre', 'control'))

    def share(period, arm, a, b):
        d_ = n[(period, arm, b)]
        return n[(period, arm, a)] / d_ if d_ else float('nan')

    def did_share(a, b):
        return (share('post', 'canary', a, b) - share('pre', 'canary', a, b)) - (share('post', 'control', a, b) - share('pre', 'control', a, b))

    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    fill_did = (mean(slots[('post', 'canary')]) - mean(slots[('pre', 'canary')])) - (mean(slots[('post', 'control')]) - mean(slots[('pre', 'control')]))

    mv = [(t_, b, st, f) for t_, b, st, f in jobs if moved(f)]        # THE DENOMINATOR: orders that moved something
    # a recovery of a LOADED batch carries its own balance (r3): it is a moved row for G2, and every recovery is judged for G1
    # judged ONLY where the note ENDED (r4, Codex r3 P1-1 / Claude r3 P1-1): an open attempt writes verdict=pending -- its furnace
    # may still hold the batch -- and is never a loss
    mv_ret = [(t_, b, st, f) for t_, b, st, f in ret_rows if (num(f.get('batch')) or 0) > 0 and f.get('stop') in ('closed', 'abandoned') and f.get('verdict') in ('ok', 'loss')]
    mv_all = mv + mv_ret
    verdicts = Counter(f.get('verdict') for _, _, _, f in mv_all)
    reconciled = sum(c for v, c in verdicts.items() if v in ('ok', 'loss', 'gain', 'overburn', 'scaffold'))
    g1_rows = [(b, f.get('kind'), f.get('forbidden')) for _, b, _, f in jobs + ret_rows if f.get('verdict') == 'forbidden']
    loss_rows = [(b, f.get('kind'), f.get('verdict'), f.get('stop')) for _, b, st, f in mv_all if f.get('verdict') in ('loss', 'overburn') and st != 'aborted']
    scaffold_rows = verdicts.get('scaffold', 0)
    taken_rows = None   # computed with ret_end below (Claude r7 P3-2: ended recoveries only, like the share it is a part of)
    g2 = int(len(loss_rows) >= 2 and reconciled > 0 and len(loss_rows) / reconciled > 0.05)
    # the unreconciled share counts order rows AND the recoveries that ended unreconciled (r6: the batch nowhere after an empty
    # furnace -- another bot's drain, or a loss; Codex r5 P2-2)
    ret_end = [(t_, b, st, f) for t_, b, st, f in ret_rows if f.get('stop') in ('closed', 'abandoned') and (num(f.get('batch')) or 0) > 0]
    unrec = Counter(f.get('verdict') for _, _, _, f in mv + ret_end).get('unreconciled', 0)
    taken_rows = sum(1 for _, _, _, f in ret_end if f.get('verdict') == 'unreconciled' and f.get('drained') == 'empty')
    judged = [(b, f.get('kind')) + judge_reserve(f, reserve) for _, b, _, f in jobs]
    g3_rows = [(b, k_, c_) for b, k_, c_, _ in judged if c_]
    g3_unjudged = [(b, k_, u_) for b, k_, _, u_ in judged if u_]
    g4_rows = [(b, f.get('stone')) for _, b, _, f in jobs if f.get('kind') == 'bricks' and stone_leak(f)]
    g5_runs = [o for p, iv in runs.items() for o in overlaps(iv)]
    g5_unjudged = [(b, f.get('kind')) for _, b, _, f in mv if not interval(f.get('ml'))]
    MATS_BY = {'make_material', 'mats_return'}
    g5_furn = [o for key_, iv in fsess.items() for o in overlaps([x[:4] for x in iv if not x[4]], involve=MATS_BY)]
    g5_furn_unleased = [o for key_, iv in fsess.items() for o in overlaps([x[:4] for x in iv], involve=MATS_BY)]
    g5_furn_unleased = [o for o in g5_furn_unleased if o not in g5_furn]
    mats_fsess = sum(1 for iv in fsess.values() for x in iv if x[3] in MATS_BY)
    open_end = notes_open_at_end(note_ev)
    loop_bots = sorted(b for b, ts in job_ts.items() if window_rate(sorted(ts)) > 7)
    made_ok = sum(num(f.get('made')) or 0 for _, _, st, f in mv if f.get('verdict') == 'ok')
    # the smelt instrument by KIND (Codex r2 P2-7: a cut smelted= read as 0 waived it): moved rows of a smelt kind
    # orders that SMELTED something (Claude r3 P3-4: a short withdraw never reached a furnace) -- smelted= is a gate field now
    smelt_made = sum(1 for _, _, _, f in mv if f.get('kind') in ('bricks', 'panes', 'torch') and (num(f.get('smelted')) or 0) > 0)
    made_by_kind = Counter()
    for _, _, _, f in mv:
        if f.get('verdict') == 'ok':
            made_by_kind[f.get('kind')] += num(f.get('made')) or 0
    tools_lost = Counter()
    for _, _, _, f in jobs:
        for n_, c_ in kv(f.get('tools_lost')).items():
            tools_lost[n_] += c_
    stops = Counter((f.get('kind'), (f.get('stop') or '').split('(')[0]) for _, _, _, f in jobs)
    can_bh = bot_hours('post', 'canary')

    # THE WORLD: the parts' stock change over containers KNOWN at both ends, per pool; arms by per-pool means, paired pools only
    ms = lambda x: int(x.timestamp() * 1000)
    census = {}; ncensus_recs = {}
    for d_ in sorted(glob.glob('/var/lib/mcai/_pool-*')):
        p = d_.split('/_pool-')[1]
        if '.pre-' in p or p not in POOLS:
            continue
        recs = []
        for f_ in sorted(glob.glob(d_ + '/town-index-*.g*.jsonl')):
            for line in open(f_, 'rb'):
                try:
                    rr = json.loads(line)
                except Exception:
                    continue
                if rr.get('t') in ('obs', 'dirty'):
                    recs.append(rr)
                elif rr.get('t') == 'ckpt':
                    for w_, ents in (rr.get('worlds') or {}).items():
                        for k_, e_ in (ents or {}).items():
                            o_ = (e_ or {}).get('obs'); l_ = (e_ or {}).get('last') or {}
                            # the IDS travel with them (Codex r2 P2-9): supersedes breaks a same-ms tie by id, as the bot's fold does
                            if o_ and isinstance(o_.get('at'), (int, float)):
                                recs.append({'t': 'obs', 'k': k_, 'w': json.loads(w_) if w_ not in ('null', '') else None, 'at': o_['at'], 'names': o_.get('names') or {}, 'id': o_.get('id')})
                            if l_.get('t') == 'dirty' and isinstance(l_.get('at'), (int, float)):
                                recs.append({'t': 'dirty', 'k': k_, 'w': json.loads(w_) if w_ not in ('null', '') else None, 'at': l_['at'], 'id': l_.get('id')})
                            for op_, o_m in ((e_ or {}).get('ops') or {}).items():
                                for ph_ in ('pre', 'held', 'post'):
                                    if isinstance((o_m or {}).get(ph_), (int, float)):
                                        recs.append({'t': 'mark', 'k': k_, 'w': json.loads(w_) if w_ not in ('null', '') else None, 'at': o_m[ph_], 'op': op_, 'phase': ph_})
        if not recs:
            continue
        first = min(r['at'] for r in recs if isinstance(r.get('at'), (int, float)))
        census[p] = {'pre': stock_change(recs, ms(PRE), ms(CUT), first_ms=first), 'post': stock_change(recs, ms(CUT), ms(END), first_ms=first)}
        ncensus_recs[p] = len(recs)
    paired = {p for p, c in census.items() if c['pre'][0] is not None and c['post'][0] is not None}
    excluded = sorted(set(census) - paired)
    def parts(c):
        return sum(c[0].values()) - (c[0].get('torch') or 0)   # torches move for many reasons: the world's parts sum excludes them
    def arm_mean(arm, period):
        vals = [parts(census[p][period]) for p in paired if (p in CANS) == (arm == 'canary')]
        return (sum(vals) / len(vals) if vals else None), len(vals)
    world = {arm: {per: arm_mean(arm, per) for per in ('pre', 'post')} for arm in ('canary', 'control')}
    wvals = [world['canary']['pre'][0], world['canary']['post'][0], world['control']['pre'][0], world['control']['post'][0]]
    world_did = None if any(x is None for x in wvals) else (wvals[1] - wvals[0]) - (wvals[3] - wvals[2])
    canary_post = sum(parts(census[p]['post']) for p in paired if p in CANS) if any(p in CANS for p in paired) else None
    # THE INSTRUMENT, gate by gate (r2, Codex r1 P1-6): the rungs (no-harm), the index in a control pool AND every canary pool
    # (the world exposure), and furnace sessions seen at all (G5's furnace half; and when the canary smelted, its own sessions)
    idx_canary = all(ncensus_recs.get(p, 0) > 0 for p in CANS)
    fs_seen = sum(fsess_seen.values())
    instrument = int(n[('post', 'control', 'rungs')] >= 1 and any(p not in CANS for p in census) and idx_canary and fs_seen >= 1
                     and (smelt_made == 0 or mats_fsess >= 1))
    fmt = lambda v: '-' if v is None else '%+.1f' % v

    print('population pools %d: %s' % (len(POOLS), ','.join(sorted(POOLS))))
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary licence rows %d | canary _make_material rows %d | stops %s' % (n[('canary', 'licence')], len(jobs), dict(stops.most_common(12))))
    print('EXPOSURE     parts made by MOVED verdict=ok rows %d (KEEP needs >= 20) by kind %s | the world: canary parts stock change %s over paired pools (KEEP needs >= 12)' % (made_ok, dict(made_by_kind), fmt(canary_post)))
    print('WORLD        per-pool mean parts stock change (containers KNOWN at both ends; torches excluded): canary %s -> %s (pools %d) | control %s -> %s (pools %d) | DiD %s | excluded pools %s'
          % (fmt(world['canary']['pre'][0]), fmt(world['canary']['post'][0]), world['canary']['post'][1],
             fmt(world['control']['pre'][0]), fmt(world['control']['post'][0]), world['control']['post'][1], fmt(world_did), excluded or '-'))
    print('G1 (gate)    forbidden: %d %s' % (len(g1_rows), g1_rows[:4]))
    print('G2 (gate)    loss/overburn rows %d of %d reconciled MOVED rows (of %d order rows + %d loaded recoveries) %s | verdicts (moved) %s | scaffold (reported) %d'
          % (len(loss_rows), reconciled, len(jobs), len(mv_ret), loss_rows[:4], dict(verdicts), scaffold_rows))
    print('G3 (gate)    reserve crossed by the job\'s own reading: %d %s | UNJUDGED (blocks KEEP) %d %s | reserve %s' % (len(g3_rows), g3_rows[:4], len(g3_unjudged), g3_unjudged[:4], reserve or '(no licence row)'))
    print('G4 (gate)    stone rose by >= 4 with the note closed: %d %s' % (len(g4_rows), g4_rows[:4]))
    print('G5 (gate)    overlapping materials leases in a pool %d %s (of %d leases) | UNJUDGED moved rows with no ml= (blocks KEEP) %d | overlapping leased furnace sessions with a mats session %d %s (mats sessions %d) | with an unleased session (WATCH) %d %s'
          % (len(g5_runs), g5_runs[:3], sum(len(v) for v in runs.values()), len(g5_unjudged), len(g5_furn), g5_furn[:3], mats_fsess, len(g5_furn_unleased), g5_furn_unleased[:3]))
    print('NOTES        mats_return stops %s | notes OPEN at the window end %d %s | unreconciled %d of %d (moved orders + ended recoveries; %d of the unreconciled: the batch nowhere after an empty furnace) | tools lost on orders %s (reported)'
          % (dict(returns), len(open_end), open_end[:5], unrec, len(mv) + len(ret_end), taken_rows, dict(tools_lost) or '-'))
    print('G6 (gate)    canary bots over 7 make_material rows in any 60 min: %d %s' % (len(loop_bots), loop_bots[:5]))
    print('ARMS         control licence / _make_material rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control rung rows post %d | control pools with index records %d | every canary pool has index records %s | furnace session rows %d (canary mats sessions %d, canary smelted %d)'
          % (n[('post', 'control', 'rungs')], sum(1 for p in census if p not in CANS), idx_canary, fs_seen, mats_fsess, smelt_made))
    print('NO-HARM      rungs per bot-h DiD %+.3f | gather successes per bot-h DiD %+.3f | smelt furnace_busy share DiD %+.3f | bag fill (slots) DiD %+.2f'
          % (did_rate('rungs'), did_rate('gather'), did_share('furnace_busy', 'smelt'), fill_did))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('matsread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild, 'noversion_canary': noversion,
            'licence_rows': n[('canary', 'licence')], 'jobs_canary': len(jobs),
            'liveness': int(n[('canary', 'licence')] >= 1 and len(jobs) >= 1),
            'parts_made_ok': made_ok, 'world_parts_canary': canary_post, 'world_parts_did': None if world_did is None else round(world_did, 2),
            'exposure_ready': int(made_ok >= 20 and (canary_post or 0) >= 12 and instrument == 1),
            'g1_forbidden': len(g1_rows), 'g2_loss': g2, 'loss_rows': len(loss_rows), 'reconciled_rows': reconciled, 'moved_rows': len(mv_all),
            'scaffold_rows': scaffold_rows, 'return_rows': len(ret_rows), 'taken_rows': taken_rows,
            'g3_reserve_crossed': len(g3_rows), 'g3_unjudged': len(g3_unjudged), 'g4_stone_leak': len(g4_rows),
            'g5_overlap': len(g5_runs) + len(g5_furn), 'g5_unjudged': len(g5_unjudged), 'g5_unleased_watch': len(g5_furn_unleased), 'g6_loop': len(loop_bots),
            'notes_abandoned': returns.get('abandoned', 0), 'notes_open_end': len(open_end),
            'unreconciled_high': int(len(mv) + len(ret_end) > 0 and unrec / (len(mv) + len(ret_end)) > 0.05), 'tools_lost': int(sum(tools_lost.values())),
            'rows_control_post': leak, 'instrument_control': instrument,
            'rungs_per_bh_did': nanless(did_rate('rungs')), 'gather_per_bh_did': nanless(did_rate('gather')),
            'furnace_busy_share_did': nanless(did_share('furnace_busy', 'smelt')), 'bag_fill_did': nanless(fill_did),
            'canary_bot_hours': round(can_bh, 2),
        })
    except Exception as e:
        print('emit failed:', e)
