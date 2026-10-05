#!/usr/bin/env python3
# climbfloodread.py [window_min] -- the read for canary `climbflood-01` (branch cf-on-1918bb5).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (docs/reports/underground-safety-design-2026-10-05.md 4.1): every upward escape dig asks ONE flood check
# (scaffold.mjs overheadBreakRisk: the block, the cell ABOVE it, its four sides, water in any form incl. waterlogged,
# lava in any form, unknown = refuse, falling columns read one further) immediately before it breaks a block --
# pillarOut's head dig, digStraightUp, the escape ramp's ceiling breach and step digs, and shaftAscend. A refusal is
# `flood_risk`: the entombed and marooned handlers route it to the ramp (every actual dig re-asks the same check; when
# the ceiling itself is refused the ramp first steps ONE cell sideways into a column whose ceiling the check allows),
# and if nothing moved the bot it stays DRY: one `_climb_flood_refused` row per back-off, no prerequisite, the legal
# move named; a ramp the drowning rescue preempted is not a refusal. MOTIVE: every drowning in 72 h was a sealed
# pocket; the escape climb was the largest way in (30 deaths, 28%).
#
# Rows written only by this build: `_climb_flood_guard` "caller=C cell=x,y,z submerged=0|1 y=N reason=R" (one per guard
# firing; callers pillar_out, dig_straight_up, ramp_breach, ramp_step, ramp_sidestep, shaft_ascend),
# `_climb_flood_ramp` "handler=H y=N steps=S sidestep=0|1 climbed=C flood=F yielded=0|1 -- stopped because ..." (one per
# flood chain; status success = the bot moved), `_climb_flood_refused` "handler=H at=x,y,z refusals=N backoff_s=S
# prereq=none dry=0|1 -- remedy: ...; ramp stopped: ...", `_climb_flood_breach` "caller=C cell=x,y,z before=B liquid=L
# submerged=0|1 exempt=0|1" (a COMPLETED dig by the same live body whose cell held liquid 1.6 s later).
#
#   LIVENESS     canary `_climb_flood_guard` rows from the canary build (>= 1; BLOCKS KEEP).
#   ARMS         control `_climb_flood_*` rows (must be 0; BLOCKS KEEP).
#   CORRECTNESS  canary `_climb_flood_breach` rows that are not the submerged-water exemption: an upward dig the guard
#                ALLOWED that let water or lava in (0; REVERT, evidence defect -- a reproducible fault in new code).
#   INSTRUMENT   control escape-climb rows (`_scaffold_pick` pillar_out/dig_straight_up) and control climb
#                OPPORTUNITIES (>= 1 each; BLOCKS KEEP): the population the effect metric is measured on is visible.
#   EFFECT       (design 4.1 read plan) water entry within 5 min of a climb OPPORTUNITY, the bot dry in the 60 s
#                before, per 100 opportunities, canary vs control, pre vs post. An opportunity is the start of any
#                entombed/marooned escape INCLUDING refusals (`_entombed`, `_marooned` rows, written by both builds);
#                repeated firings by one bot within 3 blocks and 15 min chain into ONE opportunity, so a refused bot
#                re-firing on its back-off does not inflate the canary denominator. A water entry is the first row of
#                a water-family episode (a4's kinds, 90 s gaps). EXPECTED = control post rate x canary post
#                opportunities; KEEP needs expected >= 8 and observed <= 2, and is taken at +24 h only.
#   HARM         stranded minutes per bot-hour (trapped-bots analysis: an episode opens on a non-success
#                `_entombed*`/`_marooned*` row, closes at >= 8 blocks 3-D from the first trapped cell or a death; it
#                counts when >= 10 min long WITH failure evidence: >= 3 `_path_noPath`/`_path_no_legal_move`,
#                `_recovery_exhausted`, any `_stranded*`, or >= 3 goto/explore/surface rows none successful), ratio DiD
#                <= +25%; mining actions (`mine` skill rows + `_ore_tunnel`) per bot-hour ratio DiD >= -20%; raw iron
#                per bot-hour DiD (reported). Deaths and the two-death floor are immobiledid's.
#   REPORTED     guard firings per 100 canary opportunities by caller and reason class; refusal-chain outcomes (out dry
#                by ramp / stayed dry / later wet within 5 min); refusals with backoff; deaths by cause per arm.
#
# MEMORY: streamed PER BOT (each bot's own live + rotated files, de-duplicated on (timestamp, kind, detail) and SORTED),
# keeping only the compact fields this read uses; a 24 h read walks 48 h of rows.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import open_log

ovr = os.environ.get('CANARY_DRYRUN')
man = {} if ovr else json.load(open('/srv/mcbots/trial-manifest.json'))
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
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 360)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
LOGROOT = os.environ.get('CLIMBFLOODREAD_LOGROOT', '/var/log/mcai')
EFFECT_MIN = 1440                      # the effect read: no KEEP before +24 h (design 4.1)
OPP_GAP_S, OPP_RADIUS = 15 * 60, 3.0   # opportunity chaining
ENTRY_S, DRY_S, WATER_GAP_S = 300, 60, 90
NEAR_R = 8.0                           # reported variant: the entry within 8 blocks (3-D) of the escape row

WATER = {'_oxygen_critical_state', '_air_drowning_observed', '_drowning_route', '_drowning_up', '_drowning_ceiling_no_air',
         '_drowning_rescue_yielded', '_flooded_pocket_rung', '_water_no_air_route', '_water_surface_out', '_reflex_drowning',
         '_drowning_to_air', '_drowning_breathing', '_flooded_pocket_side_exit'}      # a4.py's water-family episode kinds
OPP = {'_entombed', '_marooned'}
NEW = ('_climb_flood_guard', '_climb_flood_ramp', '_climb_flood_refused', '_climb_flood_breach')
PATHFAIL = {'_path_noPath', '_path_no_legal_move'}
MOVES = {'goto', 'explore', 'surface'}
IRON = ('raw_iron', 'iron_ore', 'deepslate_iron_ore')
KV = re.compile(r'(\w+)=([^\s]+)')
REASON_CLASS = [('lava', re.compile(r'\(\w*lava\)')), ('unknown', re.compile(r'not loaded')),
                ('falling', re.compile(r'falling')), ('above', re.compile(r'liquid above')),
                ('beside', re.compile(r'liquid beside')), ('overhead', re.compile(r'liquid overhead'))]


def death_cause(d):
    """The death row's cause, coarsely (REPORTED only; the gate is immobiledid's)."""
    head = (d or '')[:80].lower()
    for c, rx in (('drowned', r'drown'), ('lava', r'lava|fire|burn'), ('fall', r'fell|fall'),
                  ('suffocated', r'suffocat'), ('mob', r'slain|shot|blown')):
        if re.search(rx, head):
            return c
    return 'other'



def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def reason_class(d):
    for name, rx in REASON_CLASS:
        if rx.search(d or ''):
            return name
    return 'other'


# POSITIVE CONTROL for the parsers: the row formats this build writes (reflex.mjs / climbflood.mjs on cf-on-1918bb5).
_g = dict(KV.findall('caller=pillar_out cell=700,42,700 submerged=0 y=40 reason=liquid above the block overhead (water)'))
assert _g['caller'] == 'pillar_out' and _g['submerged'] == '0'
assert reason_class('liquid above the block overhead (water)') == 'above'
assert death_cause('drowned; idle at the moment of death | leading up') == 'drowned'
assert death_cause('death (fire): fell 4; path ACTIVE') == 'lava'
assert death_cause('tried to swim in lava; idle') == 'lava'
assert reason_class('flood risk: liquid over the falling block above the block overhead (water)') == 'falling'
assert reason_class('liquid above the block overhead (lava)') == 'lava'
assert reason_class('terrain not loaded beside the block overhead') == 'unknown'
_b = dict(KV.findall('caller=ramp_breach cell=1,2,3 before=stone liquid=water submerged=1 exempt=1'))
assert _b['exempt'] == '1' and _b['liquid'] == 'water'


def bot_files(bot_dir, since, until):
    """Rotation-aware (day D's rows live in skill-*.jsonl-<D+1>.gz; the live file starts ~23:59Z)."""
    files = sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl')))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl-%s.gz' % tag)))
        files += sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl-%s' % tag)))
    return files


def load_bot(bot_dir, since, until):
    """One bot's rows in [since, until): compact dicts, de-duplicated, sorted by t. Returns (rows, walked)."""
    seen, rows, walked = set(), [], 0
    for f in bot_files(bot_dir, since, until):
        try:
            fh = open_log(f)
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                if not n:
                    continue
                ts = d.get('@timestamp') or ''
                try:
                    t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except Exception:
                    continue
                if t < since or t >= until:
                    continue
                det = sk.get('detail') or ''
                if not isinstance(det, str):
                    det = json.dumps(det)
                key = hash((ts, n, det[:200]))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                b = d.get('bot') or {}
                p = b.get('pos') if isinstance(b.get('pos'), dict) else {}
                iron = 0
                for k, v in (sk.get('inventory_delta') or {}).items():
                    if k in IRON and isinstance(v, (int, float)) and v > 0:
                        iron += v
                rows.append({'t': t, 'n': n, 'st': sk.get('status'), 'd': det[:300],
                             'pos': (p.get('x'), p.get('y'), p.get('z')) if p.get('y') is not None else None,
                             'ver': ((d.get('code') or {}).get('version') or ''), 'iron': iron})
    rows.sort(key=lambda r: r['t'])
    return rows, walked


def dist(a, b):
    if not a or not b:
        return None
    return math.sqrt(sum(((x or 0) - (y or 0)) ** 2 for x, y in zip(a, b)))


def bot_hours(rows):
    s = 0.0
    for a, b in zip(rows, rows[1:]):
        s += min((b['t'] - a['t']).total_seconds(), 120)
    return (s + 5) / 3600 if rows else 0.0


def water_starts(rows):
    """[(t, pos)] of each water-family episode's first row (a4.py: 90 s gaps)."""
    starts, last = [], None
    for r in rows:
        if r['n'] in WATER:
            if last is None or (r['t'] - last).total_seconds() >= WATER_GAP_S:
                starts.append((r['t'], r['pos']))
            last = r['t']
    return starts


def wet_at(rows_w, t, back_s):
    """any water-family row in [t - back_s, t)"""
    return any(0 < (t - x).total_seconds() <= back_s for x in rows_w)


def opportunities(rows, wtimes, wstarts):
    """Chained opportunity clusters; each -> (t0, breached)."""
    clusters = []
    for r in rows:
        if r['n'] not in OPP:
            continue
        c = clusters[-1] if clusters else None
        if c and (r['t'] - c['last']).total_seconds() <= OPP_GAP_S and (
                r['pos'] is None or c['pos'] is None or dist(r['pos'], c['pos']) <= OPP_RADIUS):
            c['rows'].append(r); c['last'] = r['t']
            if r['pos']:
                c['pos'] = r['pos']
        else:
            clusters.append({'t0': r['t'], 'last': r['t'], 'pos': r['pos'], 'rows': [r]})
    out = []
    for c in clusters:
        hit = {'design': False, 'near': False, 'fast': False}
        for r in c['rows']:
            if wet_at(wtimes, r['t'], DRY_S):
                continue
            for s, sp in wstarts:
                dt_s = (s - r['t']).total_seconds()
                if not 0 < dt_s <= ENTRY_S:
                    continue
                hit['design'] = True                                  # THE DESIGN METRIC (4.1): any entry within 5 min
                d = dist(sp, r['pos'])
                if d is not None and d <= NEAR_R:
                    hit['near'] = True                                # REPORTED: the entry where the escape was
                if dt_s <= 20:
                    hit['fast'] = True                                # REPORTED: the 72 h analysis's 20 s climb window
        out.append((c['t0'], hit))
    return out


def stranded_minutes(rows, upto):
    """Trapped-bots definition: >= 10 min episodes with failure evidence; minutes returned per period (pre/post)."""
    mins = Counter()
    cur = None

    def close(t1):
        dur = (t1 - cur['t0']).total_seconds()
        ev = (cur['pf'] >= 3 or cur['rec'] or cur['str'] or (cur['mv'] >= 3 and cur['mvok'] == 0))
        if dur >= 600 and ev:
            # split at CUT so a straddling episode is attributed to the time it spent in each period
            a, b = cur['t0'], t1
            if b <= CUT:
                mins['pre'] += dur / 60
            elif a >= CUT:
                mins['post'] += dur / 60
            else:
                mins['pre'] += (CUT - a).total_seconds() / 60
                mins['post'] += (b - CUT).total_seconds() / 60
    for r in rows:
        n = r['n']
        opener = (n.startswith('_entombed') or n.startswith('_marooned')) and r['st'] != 'success'
        if cur is not None:
            if n == '_death':
                close(r['t']); cur = None
            elif r['pos'] and cur['anchor'] and dist(r['pos'], cur['anchor']) >= 8 and not opener:
                close(r['t']); cur = None
            else:
                cur['pf'] += n in PATHFAIL
                cur['rec'] = cur['rec'] or n == '_recovery_exhausted'
                cur['str'] = cur['str'] or n.startswith('_stranded')
                if n in MOVES:
                    cur['mv'] += 1; cur['mvok'] += r['st'] == 'success'
        if cur is None and opener and r['pos']:
            cur = {'t0': r['t'], 'anchor': r['pos'], 'pf': 0, 'rec': False, 'str': False, 'mv': 0, 'mvok': 0}
    if cur is not None:
        close(upto)
    return mins


# ---------------------------------------------------------------------------------------------------- the walk
bot_dirs = sorted(d for d in glob.glob(os.path.join(LOGROOT, '*')) if os.path.isdir(d) and not os.path.basename(d).startswith('_'))
assert bot_dirs, 'no bot log directories'
walked_total = 0
bh = Counter()                          # (arm, period) -> bot-hours
bots_seen = defaultdict(set)
opp = Counter(); brc = Counter()        # (arm, period) -> opportunities / breached (the design metric)
brc_near = Counter(); brc_fast = Counter()
new_rows = Counter(); offbuild = 0
guard_callers = Counter(); guard_reasons = Counter(); guard_sub = 0
breach_rows = []; exempt_breaches = 0
chain = Counter(); refused_rows = 0; backoffs = []
control_climbs = Counter()
strand = Counter(); mining = Counter(); iron = Counter()
deaths = Counter()

for bd in bot_dirs:
    bot = os.path.basename(bd)
    arm = 'canary' if pool_of(bot) in CANS else 'control'
    rows, walked = load_bot(bd, PRE, END)
    walked_total += walked
    if not rows:
        continue
    if arm == 'canary' and CV:
        # RESTART-LAG ROWS ARE NOT CANARY (memory 10-01): a post row from another build is excluded everywhere.
        kept = []
        for r in rows:
            if r['t'] >= CUT and r['ver'] and not r['ver'].startswith(CV):
                offbuild += 1
                continue
            kept.append(r)
        rows = kept
    for period, sel in (('pre', [r for r in rows if r['t'] < CUT]), ('post', [r for r in rows if r['t'] >= CUT])):
        if sel:
            bh[(arm, period)] += bot_hours(sel)
            bots_seen[(arm, period)].add(bot)
    wtimes = [r['t'] for r in rows if r['n'] in WATER]
    wstarts = water_starts(rows)
    for t0, hit in opportunities(rows, wtimes, wstarts):
        period = 'post' if t0 >= CUT else 'pre'
        opp[(arm, period)] += 1
        brc[(arm, period)] += hit['design']
        brc_near[(arm, period)] += hit['near']
        brc_fast[(arm, period)] += hit['fast']
    sm = stranded_minutes(rows, END)
    for period in ('pre', 'post'):
        strand[(arm, period)] += sm[period]
    for r in rows:
        period = 'post' if r['t'] >= CUT else 'pre'
        n = r['n']
        if n == 'mine' or n == '_ore_tunnel':
            mining[(arm, period)] += 1
        iron[(arm, period)] += r['iron']
        if n == '_death':
            deaths[(arm, period, death_cause(r['d']))] += 1
        if period != 'post':
            continue
        if arm == 'control' and n == '_scaffold_pick' and r['d'].startswith(('pillar_out', 'dig_straight_up')):
            control_climbs[r['d'].split(':')[0]] += 1
        if n in NEW:
            new_rows[(arm, n)] += 1
            if arm != 'canary':
                continue
            kv = dict(KV.findall(r['d'].split(' reason=')[0]))
            if n == '_climb_flood_guard':
                guard_callers[kv.get('caller', '?')] += 1
                guard_reasons[reason_class(r['d'])] += 1
                guard_sub += kv.get('submerged') == '1'
            elif n == '_climb_flood_breach':
                if kv.get('exempt') == '1':
                    exempt_breaches += 1
                else:
                    breach_rows.append((bot, r['t'].strftime('%H:%M:%S'), r['d'][:120]))
            elif n == '_climb_flood_ramp':
                if r['st'] == 'success':
                    chain['out_dry_by_ramp' + ('_after_sidestep' if 'sidestep=1' in r['d'] else '')] += 1
                elif 'yielded=1' in r['d']:
                    chain['preempted'] += 1
                else:
                    later = any(0 < (s - r['t']).total_seconds() <= ENTRY_S for s, _ in wstarts)
                    chain['later_wet' if later else 'stayed_dry'] += 1
            elif n == '_climb_flood_refused':
                refused_rows += 1
                m = re.search(r'backoff_s=(\d+)', r['d'])
                if m:
                    backoffs.append(int(m.group(1)))


def rate(arm, period, c=None):
    c = brc if c is None else c
    return 100.0 * c[(arm, period)] / opp[(arm, period)] if opp[(arm, period)] else float('nan')


def expect(c):
    r = rate('control', 'post', c)
    return (r / 100.0) * opp[('canary', 'post')] if r == r else 0.0


def per_bh(c, arm, period):
    return c[(arm, period)] / bh[(arm, period)] if bh[(arm, period)] else float('nan')


def ratio_did(c):
    try:
        return 100.0 * ((per_bh(c, 'canary', 'post') / per_bh(c, 'canary', 'pre')) /
                        (per_bh(c, 'control', 'post') / per_bh(c, 'control', 'pre')) - 1)
    except ZeroDivisionError:
        return float('nan')


def fin(x):
    return x == x and x not in (float('inf'), float('-inf'))


ctrl_rate = rate('control', 'post')
expected = (ctrl_rate / 100.0) * opp[('canary', 'post')] if fin(ctrl_rate) else 0.0
observed = brc[('canary', 'post')]
did_rate = (rate('canary', 'post') - rate('canary', 'pre')) - (rate('control', 'post') - rate('control', 'pre'))
reduction = (1 - observed / expected) if expected > 0 else float('nan')
strand_did = ratio_did(strand)
mining_did = ratio_did(mining)
iron_did = per_bh(iron, 'canary', 'post') - per_bh(iron, 'canary', 'pre') - (per_bh(iron, 'control', 'post') - per_bh(iron, 'control', 'pre'))
guards = sum(guard_callers.values())
instrument = sum(control_climbs.values())
correctness = len(breach_rows)
control_new = sum(v for (a, n), v in new_rows.items() if a == 'control')
exposure_ready = int(W >= EFFECT_MIN and expected >= 8 and instrument >= 1 and opp[('control', 'post')] >= 1)
effect_ok = int(observed <= 2)
strand_ok = int(fin(strand_did) and strand_did <= 25.0)
mining_ok = int(fin(mining_did) and mining_did >= -20.0)
flat = int(exposure_ready and (not fin(reduction) or reduction < 0.5))

print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots canary %d/%d control %d/%d (pre/post)'
      % (walked_total, CAN, CV, CUT.strftime('%m-%d %H:%MZ'), W, len(bots_seen[('canary', 'pre')]), len(bots_seen[('canary', 'post')]),
         len(bots_seen[('control', 'pre')]), len(bots_seen[('control', 'post')])))
print('bot-hours  canary %.1f -> %.1f  control %.1f -> %.1f  |  canary rows from another build (restart lag): %d'
      % (bh[('canary', 'pre')], bh[('canary', 'post')], bh[('control', 'pre')], bh[('control', 'post')], offbuild))
print('-' * 100)
print('LIVENESS     canary _climb_flood_guard rows %d (>= 1) by caller %s | reasons %s | submerged %d'
      % (guards, dict(guard_callers), dict(guard_reasons), guard_sub))
print('             per 100 canary opportunities: %.1f   |  chain: %s  refused rows %d  backoff_s max %s'
      % (100.0 * guards / opp[('canary', 'post')] if opp[('canary', 'post')] else float('nan'), dict(chain), refused_rows,
         max(backoffs) if backoffs else '-'))
print('ARMS         control _climb_flood_* rows %d (must be 0)  canary %s'
      % (control_new, {n: v for (a, n), v in new_rows.items() if a == 'canary'}))
print('CORRECTNESS  canary upward digs that let water/lava in (not the submerged exemption) %d (must be 0) | exempt %d'
      % (correctness, exempt_breaches))
print('INSTRUMENT   control escape-climb rows %d %s | control opportunities post %d (both >= 1)'
      % (instrument, dict(control_climbs), opp[('control', 'post')]))
print('EFFECT       opportunities (breached): canary %d (%d) -> %d (%d)   control %d (%d) -> %d (%d)'
      % (opp[('canary', 'pre')], brc[('canary', 'pre')], opp[('canary', 'post')], brc[('canary', 'post')],
         opp[('control', 'pre')], brc[('control', 'pre')], opp[('control', 'post')], brc[('control', 'post')]))
print('             per 100: canary %.2f -> %.2f  control %.2f -> %.2f  DiD %+.2f  |  EXPECTED at control rate %.1f  OBSERVED %d  '
      'reduction %s  | exposure_ready %d (needs +%d min, expected >= 8)'
      % (rate('canary', 'pre'), rate('canary', 'post'), rate('control', 'pre'), ctrl_rate, did_rate, expected, observed,
         ('%.0f%%' % (100 * reduction)) if fin(reduction) else 'n/a', exposure_ready, EFFECT_MIN))
for lab, c in (('near (<= 8 blocks)', brc_near), ('fast (<= 20 s)', brc_fast)):
    print('  variant %-18s canary %d -> %d  control %d -> %d  per 100 canary %.2f -> %.2f control %.2f -> %.2f  expected %.1f observed %d (REPORTED)'
          % (lab, c[('canary', 'pre')], c[('canary', 'post')], c[('control', 'pre')], c[('control', 'post')],
             rate('canary', 'pre', c), rate('canary', 'post', c), rate('control', 'pre', c), rate('control', 'post', c), expect(c), c[('canary', 'post')]))
print('HARM         stranded min/bot-h canary %.2f -> %.2f control %.2f -> %.2f  ratio DiD %s (<= +25%%)'
      % (per_bh(strand, 'canary', 'pre'), per_bh(strand, 'canary', 'post'), per_bh(strand, 'control', 'pre'),
         per_bh(strand, 'control', 'post'), ('%+.0f%%' % strand_did) if fin(strand_did) else 'n/a'))
print('             mining actions/bot-h canary %.2f -> %.2f control %.2f -> %.2f  ratio DiD %s (>= -20%%) | raw iron/bot-h DiD %+.2f'
      % (per_bh(mining, 'canary', 'pre'), per_bh(mining, 'canary', 'post'), per_bh(mining, 'control', 'pre'),
         per_bh(mining, 'control', 'post'), ('%+.0f%%' % mining_did) if fin(mining_did) else 'n/a', iron_did if fin(iron_did) else float('nan')))
print('             deaths by cause %s' % dict(sorted(((f'{a}/{p}/{c}', v) for (a, p, c), v in deaths.items()))))
print('KEEP LINES   effect_ok %d  stranded_ok %d  mining_ok %d  effect_flat %d   (KEEP only at +%d with exposure)'
      % (effect_ok, strand_ok, mining_ok, flat, EFFECT_MIN))
for x in breach_rows[:6]:
    print('  breach:', x)
assert walked_total > 1000 and len(bots_seen[('control', 'post')]) >= 10, \
    'POSITIVE CONTROL FAILED: %d rows walked, %d control bots post -- the instrument cannot see the fleet' % (walked_total, len(bots_seen[('control', 'post')]))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    r2 = lambda x: round(x, 3) if fin(x) else None
    emit('climbfloodread', W, {
        'guard_rows_canary': guards, 'new_rows_control': control_new, 'offbuild_canary': offbuild,
        'flood_digs_canary': correctness, 'flood_digs_exempt': exempt_breaches,
        'instrument_control': int(instrument >= 1 and opp[('control', 'post')] >= 1),
        'control_climb_rows': instrument, 'opp_canary_post': opp[('canary', 'post')], 'opp_control_post': opp[('control', 'post')],
        'breach_canary_post': observed, 'breach_control_post': brc[('control', 'post')],
        'breach_rate_did': r2(did_rate), 'expected_breaches': round(expected, 2), 'breach_reduction': r2(reduction),
        'effect_ok': effect_ok, 'effect_flat': flat,
        'near_expected': round(expect(brc_near), 2), 'near_observed': brc_near[('canary', 'post')],
        'fast_expected': round(expect(brc_fast), 2), 'fast_observed': brc_fast[('canary', 'post')],
        'stranded_did_pct': r2(strand_did), 'stranded_ok': strand_ok,
        'mining_did_pct': r2(mining_did), 'mining_ok': mining_ok, 'iron_did': r2(iron_did),
        'guards_by_caller': dict(guard_callers), 'guards_by_reason': dict(guard_reasons), 'chain': dict(chain),
        'refused_rows': refused_rows,
        'exposure_ready': exposure_ready,
    })
except Exception as e:
    print('emit failed:', e)
