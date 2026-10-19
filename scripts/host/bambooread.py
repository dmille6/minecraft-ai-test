#!/usr/bin/env python3
# bambooread.py [window_min] -- the read for canary `bamboo-01` (bamboo -> sticks housekeeping).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: a deterministic order after wear_out: at >= 34 occupied slots with >= 2 bamboo, fold bamboo into sticks
# with the bamboo-only recipe (never planks) through craftroom's executor + craftsync, ONLY when the fold frees a slot
# (simulated in the real slot order); stick cap 64 unless no new stick slot is needed. Live census 10-04: 19 of 29 full
# bamboo holders eligible. Row `_bamboo_sticks`, args {b0,b1,s0,s1,p0,p1,o0,o1,crafts,planned,freed,stop} (Claude r2).
#
#   LIVENESS     canary success rows with crafts > 0 and freed >= 1 (>= 1); control rows 0.
#   CORRECTNESS  (checks no pickup can fake; any breach REVERTS) G1 p1 >= p0; G2 s1 - s0 >= crafts; G3 b0 - b1 <= 2*crafts'
#                (crafts' = crafts + the ONE craft in flight at a stop when the bag shows it made on both sides -- inflight());
#                G4 crafts <= planned; G5 s0 + planned <= 64 or o1 <= o0; G6 no unconfirmed stick _craft_sync inside a
#                bamboo run whose resyncs the server did not answer; G7 no SUCCESS row with o1 > o0. G1-G3 and G7 are
#                EXCUSED (reported by cause, not counted) when the bot died inside the run, G7 also on a pickup inside it.
#                Emitted per gate (g1_planks .. g7_success_grew) for the registration's own_lines.
#   INSTRUMENT   control bots at >= 34 est. slots holding >= 2 bamboo (>= 1) -- the population exists.
#   REPORTED     exact-identity share, o1 > o0 rows by stop, skips per bot-hour, duration p95, freed per canary bot-hour,
#                estimated occupancy DiD on a cohort fixed in the pre-window.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
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
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')

def load_window(since, until):
    """Rotation-aware (oretunnelread's pattern): skill logs rotate daily at ~23:59Z (copytruncate), so day D's rows live
    in skill-*.jsonl-<D+1>.gz and the live file starts at ~23:59Z. Reading only the live files silently drops every row
    before the last rotation -- found 10-04 01:08Z when a 6 h window walked 58k rows instead of ~290k."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    out, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            out.append(r); seen.add(key(r))
    import glob as _glob
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def occupancy(inv):
    return sum(c if UN.search(n) else -(-c // 64) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


def num(a, k):
    try:
        return int(float(a.get(k)))
    except (TypeError, ValueError):
        return None


def inflight(a, st):
    """THE SHAPE OF ONE CRAFT IN FLIGHT AT A STOP -> 0 | 1. Pure; the same rule as bamboo.mjs foldTally (bamboo-03).
    bamboo-02 REVERTED 10-19 05:11Z on G3 = 3: all three were stagnation aborts exactly ONE craft short of the server
    (bamboo gone = 2 x sticks gained = 2 x (crafts + 1); each next fold's resync-verified run started at that very bag).
    The abort reached craftsync after the server made the execution in flight but before craftsync attributed it, so
    the row's tally missed it -- no bamboo was lost (14 of 14 canary rows: bamboo gone == 2 x sticks gained). The shape:
    a stop short of success whose bag shows the craft on BOTH sides (two more bamboo gone AND one more stick than the
    base tally), base < planned. ONE at most. Whether it is CREDITED depends on the evidence (credit_evidence, below).
    A bamboo-03 row carries the bot's own credit (args.inflight = 1, inside crafts): base_crafts takes it back out, so
    the read never trusts the bot's word."""
    if st == 'success':
        return 0
    s0, s1, b0, b1 = (num(a, k) for k in ('s0', 's1', 'b0', 'b1'))
    c, pl = base_crafts(a), num(a, 'planned') or 0
    if None in (s0, s1, b0, b1):
        return 0
    return 1 if min((b0 - b1) // 2, s1 - s0) > c and c < pl else 0


# THE EVIDENCE FOR AN IN-FLIGHT CREDIT (Codex + Claude review rounds 1-3, 10-19). The bag alone cannot tell a made
# craft from a stranded one when a stick may have come from elsewhere: 2 bamboo left in the grid + 1 picked-up stick is
# the same bag. So the in-flight shape is judged by the stopped craft's own _craft_sync row (the LAST stick row in the
# run), i.e. by what the SERVER said after the stop:
#   'server'     grid_clear yes: the server's window after the stop showed the 2x2 grid AND the cursor empty --
#                nothing stranded, by the server's word (Alpha, Comet)                                      -> CREDIT
#   'stranded'   grid_clear no: the server saw residue in the grid or on the cursor                          -> COUNTED
#   'unverified' anything else (Bravo: the after-resync was skipped, grid_clear unverified_skipped; no row) -> EXCUSED
# EXCUSED = reported by name and cause, not counted, and ONLY when the credit is all that separates the row from a
# pass: at most 2 bamboo per row ride on it; anything more, a stranded shape (no stick), past-plan or a success is G3.
# Pickup summaries are deliberately NOT evidence for a credit: pickuplog's window can be lost without a trace (Codex r3).
CREDITED = ('server',)
EXCUSABLE = ('unverified',)


def base_crafts(a):
    """The row's tally WITHOUT the bot's own in-flight credit (bamboo-03 args.inflight). Pure."""
    return max(0, (num(a, 'crafts') or 0) - (1 if num(a, 'inflight') == 1 else 0))


def breaches(a, st, evidence='unverified'):
    """The deterministic gates on one row -> list of names. Pure, so it can be checked here. `evidence` decides whether
    the in-flight shape is credited to G3 (CREDITED); the default credits nothing."""
    g = []
    p0, p1, s0, s1, b0, b1 = (num(a, k) for k in ('p0', 'p1', 's0', 's1', 'b0', 'b1'))
    o0, o1, c, pl = num(a, 'o0'), num(a, 'o1'), num(a, 'crafts') or 0, num(a, 'planned') or 0
    if None not in (p0, p1) and p1 < p0: g.append('G1_planks')
    if None not in (s0, s1) and s1 - s0 < c: g.append('G2_sticks')
    credit = inflight(a, st) if evidence in CREDITED else 0
    if None not in (b0, b1) and b0 - b1 > 2 * (base_crafts(a) + credit): g.append('G3_bamboo')
    if c > pl: g.append('G4_overcraft')
    if s0 is not None and None not in (o0, o1) and s0 + pl > 64 and o1 > o0: g.append('G5_cap')
    if st == 'success' and None not in (o0, o1) and o1 > o0: g.append('G7_success_grew')
    return g


# A DEATH OR A PICKUP IS NOT A DEFECT OF THE FOLD (registration review 10-05). A bot that dies inside a run respawns
# with an empty bag, so the row's after-reading fakes G1/G2/G3 (planks, sticks and bamboo all "gone") and G7 cannot
# grow; an item the server auto-picks up while the fold stands still (leaf decay, another bot's drop) can add a slot
# and fake G7. Those breaches are EXCUSED and reported by cause, never counted. G4 (overcraft) and G5 (cap) do not
# depend on the after-bag and are always counted.
DEATH_EXCUSES = {'G1_planks', 'G2_sticks', 'G3_bamboo', 'G7_success_grew'}


def gate_row(a, st, died=False, picked=False, evidence='unverified'):
    """-> (counted gate names, excused [(gate, cause)]). Pure."""
    counted, excused = [], []
    # the in-flight shape that would pass with its credit, when the evidence cannot credit it: reported, not counted
    shy = evidence in EXCUSABLE and inflight(a, st) == 1 and 'G3_bamboo' not in breaches(a, st, 'server')
    for g in breaches(a, st, evidence):
        if died and g in DEATH_EXCUSES:
            excused.append((g, 'died_in_run'))
        elif picked and g == 'G7_success_grew':
            excused.append((g, 'pickup_in_run'))
        elif g == 'G3_bamboo' and shy:
            excused.append((g, 'inflight_%s' % evidence))
        else:
            counted.append(g)
    return counted, excused


# POSITIVE CONTROL for the gate function.
assert breaches({'p0': 10, 'p1': 10, 's0': 32, 's1': 64, 'b0': 64, 'b1': 0, 'o0': 36, 'o1': 35, 'crafts': 32, 'planned': 32}, 'success') == []
assert breaches({'p0': 10, 'p1': 6, 's0': 32, 's1': 64, 'b0': 64, 'b1': 0, 'o0': 36, 'o1': 35, 'crafts': 32, 'planned': 32}, 'success') == ['G1_planks']
assert breaches({'p0': 0, 'p1': 0, 's0': 0, 's1': 1, 'b0': 4, 'b1': 2, 'o0': 35, 'o1': 36, 'crafts': 1, 'planned': 2}, 'success') == ['G7_success_grew']
_dead = {'p0': 10, 'p1': 0, 's0': 32, 's1': 0, 'b0': 64, 'b1': 0, 'o0': 36, 'o1': 0, 'crafts': 15, 'planned': 32}
assert gate_row(_dead, 'aborted') == (['G1_planks', 'G2_sticks', 'G3_bamboo'], [])
assert gate_row(_dead, 'aborted', died=True) == ([], [('G1_planks', 'died_in_run'), ('G2_sticks', 'died_in_run'), ('G3_bamboo', 'died_in_run')])
_grew = {'p0': 0, 'p1': 0, 's0': 0, 's1': 1, 'b0': 4, 'b1': 2, 'o0': 35, 'o1': 36, 'crafts': 1, 'planned': 2}
assert gate_row(_grew, 'success', picked=True) == ([], [('G7_success_grew', 'pickup_in_run')])
assert gate_row({**_grew, 'crafts': 3}, 'success', picked=True, died=True)[0] == ['G4_overcraft']
# THE IN-FLIGHT CRAFT (bamboo-02's REVERT, 10-19): the three fleet rows exactly as logged are NOT G3 ...
_fleet = [{'b0': 128, 'b1': 126, 's0': 11, 's1': 12, 'p0': 2, 'p1': 2, 'o0': 34, 'o1': 34, 'crafts': 0, 'planned': 32},
          {'b0': 64, 'b1': 50, 's0': 25, 's1': 32, 'p0': 3, 'p1': 3, 'o0': 34, 'o1': 34, 'crafts': 6, 'planned': 32},
          {'b0': 263, 'b1': 247, 's0': 0, 's1': 8, 'p0': 2, 'p1': 2, 'o0': 35, 'o1': 35, 'crafts': 7, 'planned': 36}]
for _r in _fleet:
    assert inflight(_r, 'aborted') == 1, _r
    for _e in CREDITED:
        assert breaches(_r, 'aborted', _e) == [] and gate_row(_r, 'aborted', evidence=_e) == ([], []), (_r, _e)
    assert breaches(_r, 'aborted') == ['G3_bamboo'], 'POSITIVE CONTROL: uncredited, the fleet row is G3'
    for _e in EXCUSABLE:   # uncredited for want of the server's word: reported, not counted
        assert gate_row(_r, 'aborted', evidence=_e) == ([], [('G3_bamboo', 'inflight_%s' % _e)]), (_r, _e)
# ... a bamboo-03 row (the credit inside crafts, args.inflight 1) is judged the same, never on the bot's own word ...
assert breaches({**_fleet[1], 'crafts': 7, 'inflight': 1}, 'aborted', 'server') == []
assert gate_row({**_fleet[1], 'crafts': 7, 'inflight': 1}, 'aborted', evidence='unverified') == ([], [('G3_bamboo', 'inflight_unverified')])
assert breaches({**_fleet[1], 'crafts': 7, 'inflight': 1, 's1': 31}, 'aborted', 'server') == ['G2_sticks', 'G3_bamboo']
# ... while a STRANDED grid/cursor or any loss beyond the one craft is COUNTED whatever the evidence:
for _e in ('server', 'unverified', 'stranded'):
    for _bad in ({'b1': 48, 's1': 31}, {'s1': 31}, {'b1': 46, 's1': 34}, {'b1': 51, 's1': 32}, {'b1': 48, 's1': 32}):
        assert gate_row({**_fleet[1], **_bad}, 'aborted', evidence=_e)[0] == ['G3_bamboo'], (_e, _bad)
    assert gate_row({**_fleet[1], 'planned': 6}, 'aborted', evidence=_e)[0] == ['G3_bamboo'], 'past the plan'
    assert gate_row(_fleet[1], 'success', evidence=_e)[0] == ['G3_bamboo'], 'a success is never credited'
assert breaches({**_fleet[1], 'crafts': 7, 'planned': 32}, 'success') == []
# ... and a death still excuses (died_in_run comes first)
assert gate_row({**_fleet[1], 'b1': 0, 's1': 0}, 'aborted', died=True, evidence='unverified')[0] == []

# EVIDENCE PAST END (Codex review 10-19): a fold just before END has its death and pickup rows after it (the death and
# G7 pickup excusals look up to 10 s / 65 s past the run). Rows past END are read for evidence only and never scored.
TAIL_END = min(now, END + dt.timedelta(minutes=3))
rows = sorted(load_window(PRE, TAIL_END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
live = 0; ctrl = 0; offbuild = 0; br = Counter(); credited = 0; ex = []; exact = Counter(); grew = Counter(); stops = Counter()
runs = defaultdict(list); freed_sum = 0; durs = []; skips = 0
cohort = set(); last = defaultdict(dict); sync_bad = []
botsets = defaultdict(set)
deaths = defaultdict(list); junkp = defaultdict(list); sump = defaultdict(list); brows = []; excused = Counter()
syncs = defaultdict(list)
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); sk = (r.get('raw') or {}).get('skill') or {}
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if t > END:   # evidence only
        if arm == 'canary' and not other:
            if k == '_death':
                deaths[b].append(t)
            elif k == '_junk_pickup':
                junkp[b].append(t)
            elif k == '_pickups':
                sump[b].append(t)
            elif k == '_craft_sync' and (sk.get('args') or {}).get('item') == 'stick':
                syncs[b].append((t, str((sk.get('args') or {}).get('grid_clear'))))
        continue
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
    if isinstance(inv, dict) and inv and not other:
        last[period][b] = inv
        if period == 'pre' and inv.get('bamboo', 0) >= 2 and occupancy(inv) >= 34:
            cohort.add(b)
    if period == 'post':
        botsets[arm].add(b)
    if k == '_craft_sync' and period == 'post' and arm == 'canary' and not other:
        a = sk.get('args') or {}
        if a.get('item') == 'stick':
            syncs[b].append((t, str(a.get('grid_clear'))))
        # UNKNOWN, not denied (Codex 10-05): a craft the server answered both resyncs for (verify_source 'resync') is a
        # KNOWN outcome -- a denial craftExecutions retries -- not an unconfirmed craft. Only an unanswered one counts.
        if (a.get('item') == 'stick' and str(a.get('confirmed')) == 'no' and a.get('outcome') == 'unconfirmed'
                and str(a.get('verify_source')) != 'resync'):
            sync_bad.append((b, t))
    if arm == 'canary' and period == 'post':
        if k == '_death':
            deaths[b].append(t)
        elif k == '_junk_pickup':
            junkp[b].append(t)
        elif k == '_pickups':
            sump[b].append(t)
    if k != '_bamboo_sticks' or period != 'post':
        continue
    if other:
        offbuild += 1; continue
    if arm == 'control':
        ctrl += 1; continue
    a = sk.get('args') or {}; st = sk.get('status') or r.get('status')
    stop = str(a.get('stop')); stops[stop] += 1
    c = num(a, 'crafts') or 0; fr = num(a, 'freed') or 0
    dm = sk.get('durationMs') or sk.get('duration_ms') or a.get('duration_ms')
    if isinstance(dm, (int, float)):
        durs.append(dm); runs[b].append((t - dt.timedelta(milliseconds=dm), t))
    if st == 'no_effect':
        skips += 1
    if st == 'success' and c > 0 and fr >= 1:
        live += 1; freed_sum += fr
    brows.append((b, t, a, st, dm if isinstance(dm, (int, float)) else 0))
    if st == 'success' and c > 0:
        s0, s1, b0, b1 = (num(a, x) for x in ('s0', 's1', 'b0', 'b1'))
        exact['exact' if (s1 - s0 == c and b0 - b1 == 2 * c) else 'off'] += 1
    o0, o1 = num(a, 'o0'), num(a, 'o1')
    if None not in (o0, o1) and o1 > o0:
        grew[stop] += 1
# THE GATES, once every death and pickup in the window is known (rows stamp the END of a run; start = end - duration).
S1, S2, S10, S65 = (dt.timedelta(seconds=x) for x in (1, 2, 10, 65))
ev_count = Counter(); named = []


def credit_evidence(t0, t, syncs_b=()):
    """-> 'server' | 'stranded' | 'unverified' for one bot's run [t0, t] (see CREDITED). Pure.
    syncs_b  [(stamp, grid_clear)] of its stick _craft_sync rows; the LAST one inside [t0 - 1 s, t + 1 s] is the
    stopped craft (craftsync writes its row on every exit, before the fold's own row)."""
    inrun = [g for (s_, g) in syncs_b if t0 - S1 <= s_ <= t + S1]
    if inrun and inrun[-1] == 'yes':
        return 'server'
    if inrun and inrun[-1] == 'no':     # the server's window still held items in the 2x2 grid or on the cursor
        return 'stranded'
    return 'unverified'


_T = dt.datetime(2026, 10, 19, 4, 25, 1, tzinfo=dt.timezone.utc); _T0 = _T - dt.timedelta(seconds=8)
_sec = lambda x: _T + dt.timedelta(seconds=x)
assert credit_evidence(_T0, _T, [(_sec(-1), 'na_clean'), (_sec(0), 'yes')]) == 'server'
assert credit_evidence(_T0, _T, [(_sec(0), 'unverified_skipped')]) == 'unverified'
assert credit_evidence(_T0, _T, [(_sec(-1), 'yes'), (_sec(0), 'unverified_skipped')]) == 'unverified', 'the LAST craft decides'
assert credit_evidence(_T0, _T, [(_sec(-1), 'yes'), (_sec(0), 'no')]) == 'stranded', 'the LAST craft decides'
assert credit_evidence(_T0, _T, [(_sec(-30), 'yes')]) == 'unverified', 'a craft before the run is not its evidence'
assert credit_evidence(_T0, _T, [(_sec(3), 'yes')]) == 'unverified', 'nor one after it'
assert credit_evidence(_T0, _T, []) == 'unverified'
assert credit_evidence(_T0, _T, [(_sec(0), 'no')]) == 'stranded'
for _r in _fleet:   # a server 'no' is COUNTED, never credited or excused (Claude r2)
    assert gate_row(_r, 'aborted', evidence='stranded') == (['G3_bamboo'], []), _r


for b, t, a, st, dm in brows:
    t0 = t - dt.timedelta(milliseconds=dm)
    died = any(t0 - S1 <= d <= t + S10 for d in deaths[b])
    picked = any(t0 <= p <= t + S2 for p in junkp[b]) or any(t0 <= p <= t + S65 for p in sump[b])
    evidence = credit_evidence(t0, t, syncs[b])
    counted, exc = gate_row(a, st, died=died, picked=picked, evidence=evidence)
    if inflight(a, st) == 1:
        ev_count[evidence] += 1
        credited += evidence in CREDITED
    for g in counted:
        br[g] += 1
        if len(ex) < 5: ex.append((b, g, a))
    for g, why in exc:
        excused['%s:%s' % (g, why)] += 1
        if why.startswith('inflight_'):
            named.append((b, t.strftime('%H:%M:%SZ'), why, {k: a.get(k) for k in ('b0', 'b1', 's0', 's1', 'crafts', 'planned', 'stop')}))
g6 = sum(1 for (b, t) in sync_bad if any(s <= t <= e for (s, e) in runs[b]))
if g6:
    br['G6_unconfirmed_stick_in_run'] = g6
inst = sum(1 for b, inv in last['post'].items() if pool_of(b) not in CANS and inv.get('bamboo', 0) >= 2 and occupancy(inv) >= 34)


def cohort_occ(period, arm):
    vals = [occupancy(last[period][b]) for b in cohort if b in last[period] and (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(vals) / len(vals) if vals else float('nan')


did = (cohort_occ('post', 'canary') - cohort_occ('pre', 'canary')) - (cohort_occ('post', 'control') - cohort_occ('pre', 'control'))
bh = len(botsets['canary']) * W / 60 if botsets['canary'] else float('nan')
p95 = (sorted(durs)[int(.95 * (len(durs) - 1))] / 1000) if durs else float('nan')
print('-' * 78)
print('LIVENESS     canary folds that freed a slot %d (>= 1) | control rows %d (must be 0) | other build %d' % (live, ctrl, offbuild))
print('CORRECTNESS  breaches %s (all must be 0) | excused (death/pickup inside a run, in-flight unverified; reported, named) %s' % (dict(br) or 0, dict(excused) or 0))
print('INSTRUMENT   control bots at >= 34 slots holding >= 2 bamboo: %d (>= 1)' % inst)
print('REPORTED     exact identity %s | rows that grew o1 > o0 by stop %s | stops %s' % (dict(exact), dict(grew), dict(stops)))
print('             in-flight crafts at a stop (G3): credited %d | by evidence %s (server credit; unverified excused; stranded counted)'
      % (credited, dict(ev_count) or 0))
print('             skips/bot-h %.2f | duration p95 %.1f s | slots freed/canary bot-h %.2f | cohort occupancy DiD %+.2f (cohort %d)'
      % (skips / bh if bh == bh and bh else float('nan'), p95, freed_sum / bh if bh == bh and bh else float('nan'), did, len(cohort)))
for x in ex:
    print('  breach:', x)
for x in named:   # every excused in-flight row, by name: an operator reads these (never a verdict on their own)
    print('  excused in-flight:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('bambooread', W, {
        'folds_freed_canary': live, 'rows_control': ctrl, 'offbuild_canary': offbuild,
        'breaches': sum(br.values()), 'instrument_control': inst,
        # ONE FIELD PER GATE, so the registration's own_lines name each defect (bamboo-01 registration, 10-05)
        'g1_planks': br['G1_planks'], 'g2_sticks': br['G2_sticks'], 'g3_bamboo': br['G3_bamboo'],
        'g4_overcraft': br['G4_overcraft'], 'g5_cap': br['G5_cap'], 'g6_unconfirmed': br['G6_unconfirmed_stick_in_run'],
        'g7_success_grew': br['G7_success_grew'], 'excused': sum(excused.values()), 'inflight_credited': credited, 'inflight_evidence': dict(ev_count),
        'inflight_excused_rows': [list(x[:3]) + [x[3]] for x in named],   # by name, for the operator (Claude r4)
        'freed_per_bh': None if not (bh == bh and bh) else round(freed_sum / bh, 3),
        'cohort_occupancy_did': None if did != did else round(did, 3),
        'exposure_ready': int(live >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
