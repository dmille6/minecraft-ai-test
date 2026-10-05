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
#   CORRECTNESS  (checks no pickup can fake; any breach REVERTS) G1 p1 >= p0; G2 s1 - s0 >= crafts; G3 b0 - b1 <= 2*crafts;
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


def breaches(a, st):
    """The deterministic gates on one row -> list of names. Pure, so it can be checked here."""
    g = []
    p0, p1, s0, s1, b0, b1 = (num(a, k) for k in ('p0', 'p1', 's0', 's1', 'b0', 'b1'))
    o0, o1, c, pl = num(a, 'o0'), num(a, 'o1'), num(a, 'crafts') or 0, num(a, 'planned') or 0
    if None not in (p0, p1) and p1 < p0: g.append('G1_planks')
    if None not in (s0, s1) and s1 - s0 < c: g.append('G2_sticks')
    if None not in (b0, b1) and b0 - b1 > 2 * c: g.append('G3_bamboo')
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


def gate_row(a, st, died=False, picked=False):
    """-> (counted gate names, excused [(gate, cause)]). Pure."""
    counted, excused = [], []
    for g in breaches(a, st):
        if died and g in DEATH_EXCUSES:
            excused.append((g, 'died_in_run'))
        elif picked and g == 'G7_success_grew':
            excused.append((g, 'pickup_in_run'))
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

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
live = 0; ctrl = 0; offbuild = 0; br = Counter(); ex = []; exact = Counter(); grew = Counter(); stops = Counter()
runs = defaultdict(list); freed_sum = 0; durs = []; skips = 0
cohort = set(); last = defaultdict(dict); sync_bad = []
botsets = defaultdict(set)
deaths = defaultdict(list); junkp = defaultdict(list); sump = defaultdict(list); brows = []; excused = Counter()
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); sk = (r.get('raw') or {}).get('skill') or {}
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
    if isinstance(inv, dict) and inv and not other:
        last[period][b] = inv
        if period == 'pre' and inv.get('bamboo', 0) >= 2 and occupancy(inv) >= 34:
            cohort.add(b)
    if period == 'post':
        botsets[arm].add(b)
    if k == '_craft_sync' and period == 'post' and arm == 'canary' and not other:
        a = sk.get('args') or {}
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
for b, t, a, st, dm in brows:
    t0 = t - dt.timedelta(milliseconds=dm)
    died = any(t0 - S1 <= d <= t + S10 for d in deaths[b])
    picked = any(t0 <= p <= t + S2 for p in junkp[b]) or any(t0 <= p <= t + S65 for p in sump[b])
    counted, exc = gate_row(a, st, died=died, picked=picked)
    for g in counted:
        br[g] += 1
        if len(ex) < 5: ex.append((b, g, a))
    for g, why in exc:
        excused['%s:%s' % (g, why)] += 1
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
print('CORRECTNESS  breaches %s (all must be 0) | excused (death/pickup inside a run, reported) %s' % (dict(br) or 0, dict(excused) or 0))
print('INSTRUMENT   control bots at >= 34 slots holding >= 2 bamboo: %d (>= 1)' % inst)
print('REPORTED     exact identity %s | rows that grew o1 > o0 by stop %s | stops %s' % (dict(exact), dict(grew), dict(stops)))
print('             skips/bot-h %.2f | duration p95 %.1f s | slots freed/canary bot-h %.2f | cohort occupancy DiD %+.2f (cohort %d)'
      % (skips / bh if bh == bh and bh else float('nan'), p95, freed_sum / bh if bh == bh and bh else float('nan'), did, len(cohort)))
for x in ex:
    print('  breach:', x)
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
        'g7_success_grew': br['G7_success_grew'], 'excused': sum(excused.values()),
        'freed_per_bh': None if not (bh == bh and bh) else round(freed_sum / bh, 3),
        'cohort_occupancy_did': None if did != did else round(did, 3),
        'exposure_ready': int(live >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
