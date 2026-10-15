#!/usr/bin/env python3
# toolkitread.py [window_min] -- the read for canary `toolkit-01` (bots/src/toolkit.mjs; owner-approved 10-15 ~20:30Z).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (two parts, one switch TOOLKIT, one row kind `_toolkit` written only by this build):
#   wear  a bag with a usable iron(+) pickaxe AND a usable stone spare keeps none of its 1-use stone pickaxes for last-swing:
#         wear_out (34+ slots) destroys them by use. Row phase=wear listed= worn= before= after=.
#   kit   at town, no usable iron axe / iron shovel: draw 3 (+1) ingots (+ the short sticks) from ONE town container that
#         keeps 4, craft axe then shovel with the `craft` skill. Row phase=kit outcome= drew= used= crafted= credit= before= after=.
#   mode  once per process: phase=mode on=1|0 (the licence).
# Every gate is re-derived from the row's own before=/after= tool tags (the bag, `name@uses`), never from its claims.
#
#   LIVENESS     canary kit rows with >= 1 VERIFIED craft (a new usable copy of the claimed tool in after=) (>= 1).
#   DEFECTS      (each REVERTs) K1 a run that ended with NO usable pickaxe (> 10 uses) when it began with one;
#                K2 a clearly usable tool (> FLOOR + 20 uses in before=, slack for in-run wear) missing from after=;
#                K3 iron drawn and no tool made: a bot's kit run drew iron and made nothing (not aborted), and NO later kit run
#                   of that bot in the window verified a craft (the credit is spent by the retry; Codex r1 P2-1/P2-2);
#                K4 a craft claimed that after= does not show (claimed name: usable copies after <= before).
#                K1-K4 are EXCUSED (reported by cause) when the bot died inside the run.
#   ARMS         control `_toolkit` rows 0 (any phase).
#   INSTRUMENT   control bots whose latest bot.tools has no usable iron axe or no usable iron shovel (>= 1).
#   REPORTED     wear: slots freed (worn), listed; kit: crafts by tool, ingots drawn/used, outcomes, stops; gather seconds per
#                item for logs (axe) and soil (shovel), canary vs control, pre vs post, and the DiD of the medians; usable
#                stone copies per iron holder at the end, both arms.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

FLOOR = 10
SLACK = 20


def kv(d):
    """key=value fields of a `_toolkit` row (tried=[...] kept whole)."""
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\[[^\]]*\]|\S+)', d or ''):
        out[m.group(1)] = m.group(2)
    return out


def tags(s):
    """'iron_pickaxe@200,stone_pickaxe@1' -> {name: [uses, ...]} ('full' = undamageable = very large)."""
    out = defaultdict(list)
    if not s or s == '-':
        return out
    for part in s.split(','):
        n, _, u = part.partition('@')
        if not n:
            continue
        out[n].append(10 ** 6 if u == 'full' else int(u) if u.lstrip('-').isdigit() else 0)
    return out


def num(f, k):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return 0


PICK = re.compile(r'_pickaxe$')


def usable_picks(t):
    return sum(1 for n, us in t.items() if PICK.search(n) for u in us if u > FLOOR)


def gates(f):
    """The defect gates on one `_toolkit` row's fields -> [names]. Pure (asserted below)."""
    g = []
    b, a = tags(f.get('before')), tags(f.get('after'))
    if usable_picks(b) >= 1 and usable_picks(a) == 0:
        g.append('K1_no_pick')
    for n, us in b.items():
        clear = sum(1 for u in us if u > FLOOR + SLACK)
        if clear and sum(1 for u in a.get(n, []) if u > FLOOR) < clear:
            g.append('K2_usable_lost'); break
    if f.get('phase') == 'kit':
        crafted = [x for x in (f.get('crafted') or '-').split('+') if x and x != '-']
        for n in crafted:
            if sum(1 for u in a.get(n, []) if u > FLOOR) <= sum(1 for u in b.get(n, []) if u > FLOOR):
                g.append('K4_unverified_craft'); break
    return g


def opens_draw(f):
    """A kit run that drew iron and made nothing (not an abort): it opens a K3 until a later run verifies a craft. Pure."""
    return f.get('phase') == 'kit' and num(f, 'drew') > 0 and not verified_crafts(f) and f.get('outcome') != 'aborted'


RETRY_S = 40 * 60   # toolkit.mjs TOOLKIT_BACKOFF_MS (30 min) + TOOLKIT_COOLDOWN_MS (10 min): the earliest retry


def k3_state(seq, end=None):
    """One bot's kit rows in time order [(fields, died, t)] -> 'open' | 'pending' | None. Pure. An iron draw with no tool stays
    open until a later run of the bot verifies a craft; one opened inside the last RETRY_S of the window could not have been
    retried yet, so it is PENDING (reported), never a verdict (Claude r1 P2-2)."""
    at = None
    for f, died, t in seq:
        if verified_crafts(f):
            at = None
        elif opens_draw(f) and not died:
            at = t
    if at is None:
        return None
    return 'pending' if end is not None and (end - at).total_seconds() < RETRY_S else 'open'


def k3_open(seq, end=None):
    return int(k3_state(seq, end) == 'open')


def verified_crafts(f):
    """Crafts after= shows (a new usable copy of each claimed name). Pure."""
    b, a = tags(f.get('before')), tags(f.get('after'))
    out = []
    for n in [x for x in (f.get('crafted') or '-').split('+') if x and x != '-']:
        if sum(1 for u in a.get(n, []) if u > FLOOR) > sum(1 for u in b.get(n, []) if u > FLOOR):
            out.append(n)
    return out


# POSITIVE CONTROLS for the parser and every gate (the bot's own row strings, toolkit.mjs toolkitRow).
_ok = kv('phase=kit outcome=crafted needs=iron_axe+iron_shovel drew=4 sticks=3 used=4 crafted=iron_axe+iron_shovel credit=0->0 stop=- '
         'before=iron_pickaxe@200,stone_pickaxe@90 after=iron_axe@250,iron_pickaxe@199,iron_shovel@250,stone_pickaxe@90 tried=[5,64,0:success]')
assert _ok['phase'] == 'kit' and _ok['tried'] == '[5,64,0:success]' and gates(_ok) == [] and verified_crafts(_ok) == ['iron_axe', 'iron_shovel']
assert gates({**_ok, 'after': 'iron_axe@250,iron_shovel@250'}) == ['K1_no_pick', 'K2_usable_lost']
assert gates({**_ok, 'after': 'iron_axe@250,iron_pickaxe@199,iron_shovel@250'}) == ['K2_usable_lost'], 'the stone spare gone'
_fail = {**_ok, 'crafted': '-', 'outcome': 'craft_failed', 'after': 'iron_pickaxe@199,stone_pickaxe@90'}
assert gates(_fail) == [] and opens_draw(_fail) and not opens_draw({**_fail, 'outcome': 'aborted'}) and not opens_draw(_ok)
import datetime as _dt
_t0 = _dt.datetime(2026, 10, 15, 12, 0, tzinfo=_dt.timezone.utc); _m = lambda n: _t0 + _dt.timedelta(minutes=n)
assert k3_open([(_fail, False, _m(0)), (_ok, False, _m(45))], _m(180)) == 0, 'a later verified craft closes it'
assert k3_open([(_ok, False, _m(0)), (_fail, False, _m(10))], _m(180)) == 1 and k3_open([(_fail, True, _m(10))], _m(180)) == 0, 'open at the end; a death excuses'
assert k3_state([(_fail, False, _m(150))], _m(180)) == 'pending' and k3_state([(_fail, False, _m(140))], _m(180)) == 'open', 'the window edge: 40 min to retry'
assert gates({**_ok, 'after': 'iron_pickaxe@199,stone_pickaxe@90,iron_axe@250'}) == ['K4_unverified_craft'] and verified_crafts({**_ok, 'after': 'iron_pickaxe@199,stone_pickaxe@90,iron_axe@250'}) == ['iron_axe']
_w = kv('phase=wear outcome=done listed=3 worn=3 stop=- before=iron_pickaxe@200,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@90 after=iron_pickaxe@200,stone_pickaxe@90 tried=[]')
assert gates(_w) == [] and gates({**_w, 'after': 'iron_pickaxe@200'}) == ['K2_usable_lost']
assert gates({**_w, 'after': 'iron_pickaxe@200,stone_pickaxe@85'}) == [], 'in-run wear of the spare is not a loss'
assert usable_picks(tags('stone_pickaxe@10,iron_pickaxe@11')) == 1

if os.environ.get('TOOLKITREAD_SELFTEST'):
    print('toolkitread self-tests passed')
    sys.exit(0)

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
    """Rotation-aware (bambooread's): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z copytruncate."""
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


LOG = re.compile(r'_log$')
SOIL = {'dirt', 'sand', 'gravel', 'grass_block', 'coarse_dirt', 'red_sand'}


def rem(c):
    return (c.get('max') or 0) - (c.get('used') or 0)


rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
mode_rows = Counter(); ctrl = 0; offbuild = 0; kit = []; wear = []; deaths = defaultdict(list)
last_tools = {}; gather = defaultdict(list); botsets = defaultdict(set)
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); raw = r.get('raw') or {}; sk = raw.get('skill') or {}
    ver = ((raw.get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    tools = (raw.get('bot') or {}).get('tools')
    if isinstance(tools, dict) and not other and period == 'post':
        last_tools[b] = tools
    if period == 'post':
        botsets[arm].add(b)
    if k == '_death' and arm == 'canary' and period == 'post':
        deaths[b].append(t)
    # GATHER SECONDS PER ITEM by the tool the bag held at the row (logs: an axe; soil: a shovel), both arms and periods
    if k == 'gather' and sk.get('status') == 'success' and not other:
        blk = (sk.get('args') or {}).get('block') or ''
        fam = 'log' if LOG.search(blk) else ('soil' if blk in SOIL else None)
        d = sk.get('inventory_delta') or {}
        got = sum(v for n, v in d.items() if isinstance(v, (int, float)) and v > 0 and ((fam == 'log' and LOG.search(n)) or (fam == 'soil' and n in SOIL)))
        if fam and got > 0 and isinstance(sk.get('duration_ms'), (int, float)):
            kind = 'axe' if fam == 'log' else 'shovel'
            ironk = any(rem(c) > 0 for c in ((tools or {}).get('iron_' + kind) or []))
            gather[(fam, arm, period, 'iron' if ironk else 'other')].append(sk['duration_ms'] / 1000 / got)
    if k != '_toolkit' or period != 'post':
        continue
    if other:
        offbuild += 1; continue
    if arm == 'control':
        ctrl += 1; continue
    # THE ARGS FIRST (toolkit.mjs toolkitArgs: never cut); the 300-char detail only when a row has none
    a = sk.get('args') or {}
    f = {k: (str(v) if v is not None else None) for k, v in a.items()} if a.get('phase') else kv(sk.get('detail') or r.get('detail') or '')
    dm = sk.get('duration_ms') or 0
    ph = f.get('phase')
    if ph == 'mode':
        mode_rows[f.get('on', '?')] += 1
    elif ph in ('kit', 'wear'):
        (kit if ph == 'kit' else wear).append((b, t, f, sk.get('status'), dm))

S1, S10 = dt.timedelta(seconds=1), dt.timedelta(seconds=10)
br = Counter(); excused = Counter(); ex = []; perbot = defaultdict(list)
live = 0; crafts = Counter(); outcomes = Counter(); stops = Counter(); drew = 0; used = 0; worn = 0; listed = 0
for (b, t, f, st, dm) in sorted(kit + wear, key=lambda x: x[1]):
    died = any(t - dt.timedelta(milliseconds=dm or 0) - S1 <= d <= t + S10 for d in deaths[b])
    for g in gates(f):
        if died:
            excused[g + ':died_in_run'] += 1
        else:
            br[g] += 1
            if len(ex) < 5: ex.append((b, g, {k: f.get(k) for k in ('phase', 'outcome', 'drew', 'crafted', 'before', 'after')}))
    if f.get('phase') == 'kit':
        perbot[b].append((f, died, t))
        v = verified_crafts(f)
        live += 1 if v else 0
        for n in v: crafts[n] += 1
        outcomes[f.get('outcome')] += 1; stops[(f.get('stop') or '-')[:40]] += 1
        drew += num(f, 'drew'); used += num(f, 'used')
    else:
        worn += num(f, 'worn'); listed += num(f, 'listed')

k3_pending = 0
for b, seq in perbot.items():
    st3 = k3_state(seq, END)
    if st3 == 'pending':
        k3_pending += 1
    elif st3 == 'open':
        br['K3_drawn_no_tool'] += 1
        if len(ex) < 5: ex.append((b, 'K3_drawn_no_tool', {k: seq[-1][0].get(k) for k in ('outcome', 'drew', 'crafted', 'stop')}))
inst = sum(1 for b, tl in last_tools.items() if pool_of(b) not in CANS and
           (not any(rem(c) > FLOOR for c in tl.get('iron_axe') or []) or not any(rem(c) > FLOOR for c in tl.get('iron_shovel') or [])))
def spares(arm):
    vals = []
    for b, tl in last_tools.items():
        if (pool_of(b) in CANS) != (arm == 'canary') or not any(rem(c) > FLOOR for c in tl.get('iron_pickaxe') or []):
            continue
        vals.append((sum(1 for c in tl.get('stone_pickaxe') or [] if rem(c) > FLOOR), sum(1 for c in tl.get('stone_pickaxe') or [] if rem(c) <= FLOOR)))
    n = len(vals)
    return (sum(v[0] for v in vals) / n if n else float('nan')), (sum(v[1] for v in vals) / n if n else float('nan')), n
def med(xs):
    xs = sorted(xs); return xs[len(xs) // 2] if xs else float('nan')
def did(fam):
    allc = lambda arm, per: gather[(fam, arm, per, 'iron')] + gather[(fam, arm, per, 'other')]
    return (med(allc('canary', 'post')) - med(allc('canary', 'pre'))) - (med(allc('control', 'post')) - med(allc('control', 'pre')))

bh = len(botsets['canary']) * W / 60 if botsets['canary'] else float('nan')
print('-' * 78)
print('LIVENESS     canary kit runs with a verified craft %d (>= 1) | crafts %s | mode rows %s' % (live, dict(crafts), dict(mode_rows)))
print('ARMS         control _toolkit rows %d (must be 0) | other build %d' % (ctrl, offbuild))
print('DEFECTS      %s (all must be 0) | excused (died in the run, reported) %s | K3 pending (drawn < 40 min before the end) %d' % (dict(br) or 0, dict(excused) or 0, k3_pending))
print('INSTRUMENT   control bots without a usable iron axe or shovel: %d (>= 1)' % inst)
print('REPORTED     kit outcomes %s | ingots drawn %d used %d | wear listed %d worn (slots freed) %d | freed/canary bot-h %.2f'
      % (dict(outcomes), drew, used, listed, worn, worn / bh if bh == bh and bh else float('nan')))
print('             stops %s' % dict(stops.most_common(6)))
for fam in ('log', 'soil'):
    cells = ' '.join('%s/%s/%s n=%d med=%.1f' % (arm, per, ir, len(gather[(fam, arm, per, ir)]), med(gather[(fam, arm, per, ir)]))
                     for arm in ('canary', 'control') for per in ('pre', 'post') for ir in ('iron', 'other'))
    print('             gather %s s/item: %s | DiD of medians %+.2f' % (fam, cells, did(fam)))
cs, csp, cn = spares('canary'); ks, ksp, kn = spares('control')
print('             per usable-iron holder at the end -- USABLE stone pickaxes: canary %.2f control %.2f | SPENT stone copies: canary %.2f control %.2f (n %d / %d)'
      % (cs, ks, csp, ksp, cn, kn))
for x in ex:
    print('  defect:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    ld, sd = did('log'), did('soil')
    emit('toolkitread', W, {
        'kit_crafted_canary': live, 'rows_control': ctrl, 'offbuild_canary': offbuild, 'instrument_control': inst,
        'k1_no_pick': br['K1_no_pick'], 'k2_usable_lost': br['K2_usable_lost'], 'k3_drawn_no_tool': br['K3_drawn_no_tool'],
        'k4_unverified_craft': br['K4_unverified_craft'], 'defects': sum(br.values()), 'excused': sum(excused.values()), 'k3_pending': k3_pending,
        'ingots_drawn': drew, 'ingots_used': used, 'wear_worn': worn, 'wear_listed': listed,
        'log_did': None if ld != ld else round(ld, 2), 'soil_did': None if sd != sd else round(sd, 2),
        'usable_stone_per_iron_holder_canary': None if cs != cs else round(cs, 2), 'spent_stone_per_iron_holder_canary': None if csp != csp else round(csp, 2),
        'exposure_ready': int(live >= 1 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
