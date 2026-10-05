#!/usr/bin/env python3
# climbfloodread.py [window_min] -- the read for canary `climbflood-01` (branch cf-on-1918bb5), registered as a FIX.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Tests: scripts/host/test_climbfloodread.py.
#
# THE CHANGE (docs/reports/underground-safety-design-2026-10-05.md 4.1): every upward escape dig asks ONE flood check
# (scaffold.mjs overheadBreakRisk) immediately before it breaks a block -- pillarOut, digStraightUp, the escape ramp,
# shaftAscend. A refusal is `flood_risk`: the entombed and marooned handlers route it to the ramp (every dig re-checked;
# one sidestep when the refused cell is its own ceiling), and if nothing moved the bot it stays DRY: one
# `_climb_flood_refused` row per back-off, no prerequisite, the legal move named.
#
# Rows written only by this build: `_climb_flood_guard` "caller=C cell=x,y,z submerged=0|1 y=N reason=R";
# `_climb_flood_ramp` "handler=H y=N steps=S sidestep=0|1 climbed=C flood=F yielded=0|1 dry=0|1 -- stopped because";
# `_climb_flood_refused` "handler=H at=x,y,z refusals=N backoff_s=S prereq=none dry=0|1 -- remedy: ...";
# `_climb_flood_breach` "caller=C cell=x,y,z before=B liquid=L submerged=0|1 exempt=0|1".
#
# OWNER RULE FOR FIXES (09-29): a deterministic correctness gate only; reads +180/+360, extended until exposure; KEEP
# from +360. The benefit is proven on Paper (sandbox/craft/climbflood-ab.cjs); the fleet read gates DEFECTS:
#   CORRECTNESS  canary `_climb_flood_breach` rows outside the submerged-water exemption (0).
#   LIVENESS     canary `_climb_flood_guard` rows (>= 1).
#   CHAIN        after a `_climb_flood_refused` row: no pickaxe/blocks ask from the escape path at that place within 120 s
#                (chain_prereq 0); no refusal re-fired before its own back-off ran out (chain_spin 0); no refusal row
#                written wet (chain_wet 0, the bot's own reading).
#   ARMS         control `_climb_flood_*` rows (0).
#   INSTRUMENT   control-build dig evidence AND control opportunities on the fleet (>= 1), and the REAL Paper control
#                floods fed through this same endpoint code (paper_ctrl_detected) -- an instrument that cannot see a
#                known flood cannot certify an absent one.
#   EXPOSURE     canary escape opportunities that reached the guard (a dig attempt or a guard row in the opportunity).
#   REPORTED     the 20 s endpoint as a ratio-DiD R_E with E0 from a FIXED 48 h pre-deploy baseline; the 5-min design
#                metric; the refusal-chain 5-min follow-up; stranded minutes and mining as ratio-DiDs with a whole-pool
#                randomization p. HARM HERE MEANS "NOT DETECTED", NOT "PROVEN ACCEPTABLE" (Codex): a large p is not
#                evidence of no harm, and these lines do not gate.
#
# THE 20 s ENDPOINT (Codex, 10-05): an "escape-associated water proxy anchored on dig evidence". Neither build logs
# every upward dig, so dig evidence is the set of rows BOTH builds write when an escape breaks a block upward:
#   - `_entombed` NOT followed within 3 s by a climb refusal (`_maroon_climb_refused`, `_maroon_dig_refused`, a
#     `_climb_flood_guard` from pillar_out/dig_straight_up): pillarOut's first act on a solid ceiling is the dig, which
#     completes within its budget -- interval [t, t+45 s] (a bare-handed dig in water or mid-air is 5x a grounded one;
#     Paper control: the ceiling dig landed 8 s or 38 s after the row);
#   - `_scaffold_pick` pillar_out/dig_straight_up (a pillar step, after its head dig): [t-2 s, t];
#   - `_entombed_ramp_cut` / `_marooned_ramp_cut` with steps>0 or breached>0, and this build's `_climb_flood_ramp` with
#     steps>0 or sidestep=1 (rows stamped at the END of a <= 60 s ramp): [t-60 s, t];
#   - a `surface` skill row (shaftAscend), stamped at its start: [t, t+duration];
#   - this build's `_climb_flood_breach`: [t-2 s, t].
# The canary-only kinds make the canary arm MORE sensitive, never less. An opportunity is a run of `_entombed` /
# `_marooned` rows by one bot (<= 15 min apart, <= 3 blocks, never across the deploy); it is ELIGIBLE when the bot had
# no water-family row in the 60 s before it and its 5-min follow-up is complete inside its own period. It is a HIT
# when its FIRST water episode (a4's kinds, 90 s gaps) starts within 20 s after a dig-evidence interval inside it.
import sys, os, json, re, glob, math, itertools
import datetime as dt
from collections import Counter, defaultdict

WATER = {'_oxygen_critical_state', '_air_drowning_observed', '_drowning_route', '_drowning_up', '_drowning_ceiling_no_air',
         '_drowning_rescue_yielded', '_flooded_pocket_rung', '_water_no_air_route', '_water_surface_out', '_reflex_drowning',
         '_drowning_to_air', '_drowning_breathing', '_flooded_pocket_side_exit'}      # a4.py's water-family episode kinds
OPP = {'_entombed', '_marooned'}
NEW = ('_climb_flood_guard', '_climb_flood_ramp', '_climb_flood_refused', '_climb_flood_breach')
CLIMB_REFUSALS = {'_maroon_climb_refused', '_maroon_dig_refused'}
ASKS = {'_entombed_needs_pickaxe', '_entombed_needs_blocks', '_entombed_unrecoverable', '_marooned_needs_pickaxe'}
PATHFAIL = {'_path_noPath', '_path_no_legal_move'}
MOVES = {'goto', 'explore', 'surface'}
IRON = ('raw_iron', 'iron_ore', 'deepslate_iron_ore')
NEVER_DRAWN = lambda p: p == 'placebo-c' or p.startswith('isolated')                # drawrec.sh elig()
OPP_GAP_S, OPP_RADIUS = 15 * 60, 3.0
FOLLOW_S, FAST_S, DRY_S, WATER_GAP_S = 300, 20, 60, 90
ENTOMB_DIG_S, RAMP_S, REFUSAL_LAG_S = 45, 60, 3
ASK_S, ASK_R, SPIN_TOL_S = 120, 3.0, 2
BASELINE_H = 48                         # the fixed pre-deploy baseline (Codex, 10-05)
KV = re.compile(r'(\w+)=([^\s]+)')
REASON_CLASS = [('lava', re.compile(r'\(\w*lava\)')), ('unknown', re.compile(r'not loaded')),
                ('falling', re.compile(r'falling')), ('above', re.compile(r'liquid above')),
                ('beside', re.compile(r'liquid beside')), ('overhead', re.compile(r'liquid overhead'))]


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def reason_class(d):
    for name, rx in REASON_CLASS:
        if rx.search(d or ''):
            return name
    return 'other'


def kv(d):
    return dict(KV.findall((d or '').split(' reason=')[0].split(' — ')[0]))


def death_cause(d):
    """The death row's cause, coarsely (REPORTED only; the gate is immobiledid's)."""
    head = (d or '')[:80].lower()
    for c, rx in (('drowned', r'drown'), ('lava', r'lava|fire|burn'), ('fall', r'fell|fall'),
                  ('suffocated', r'suffocat'), ('mob', r'slain|shot|blown')):
        if re.search(rx, head):
            return c
    return 'other'


def ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def compact(d, since=None, until=None):
    """One telemetry record -> the compact row this read uses, or None."""
    sk = d.get('skill') or {}
    n = sk.get('name')
    if not n:
        return None
    try:
        t = ts(d.get('@timestamp') or '')
    except Exception:
        return None
    if (since and t < since) or (until and t >= until):
        return None
    det = sk.get('detail') or ''
    if not isinstance(det, str):
        det = json.dumps(det)
    b = d.get('bot') or {}
    p = b.get('pos') if isinstance(b.get('pos'), dict) else {}
    iron = sum(v for k, v in (sk.get('inventory_delta') or {}).items() if k in IRON and isinstance(v, (int, float)) and v > 0)
    dur = sk.get('duration_ms')
    return {'t': t, 'n': n, 'st': sk.get('status'), 'd': det[:300], 'dur': dur if isinstance(dur, (int, float)) else 0,
            'pos': (p.get('x'), p.get('y'), p.get('z')) if p.get('y') is not None else None,
            'ver': ((d.get('code') or {}).get('version') or ''), 'iron': iron, 'key': (d.get('@timestamp'), n, det[:200])}


def rows_from_lines(lines, since=None, until=None):
    seen, out = set(), []
    for line in lines:
        try:
            r = compact(json.loads(line), since, until)
        except Exception:
            continue
        if r is None or r['key'] in seen:
            continue
        seen.add(r['key'])
        out.append(r)
    out.sort(key=lambda r: r['t'])
    return out


def dist(a, b):
    if not a or not b:
        return None
    return math.sqrt(sum(((x or 0) - (y or 0)) ** 2 for x, y in zip(a, b)))


def secs(a, b):
    return (b - a).total_seconds()


def water_starts(rows):
    """[(t, pos)] of each water-family episode's first row."""
    starts, last = [], None
    for r in rows:
        if r['n'] in WATER:
            if last is None or secs(last, r['t']) >= WATER_GAP_S:
                starts.append((r['t'], r['pos']))
            last = r['t']
    return starts


def dig_intervals(rows):
    """[(a, b, source, row_t)]: when an upward escape dig happened, from rows both builds write (see the header).
    row_t is the SOURCE row's own time: evidence is attributed to the period of the row that wrote it."""
    out = []
    td = dt.timedelta
    for i, r in enumerate(rows):
        n, t, d = r['n'], r['t'], r['d']
        if n == '_entombed':
            refused = False
            for q in rows[i + 1:]:
                if secs(t, q['t']) > REFUSAL_LAG_S:
                    break
                if q['n'] in CLIMB_REFUSALS or (q['n'] == '_climb_flood_guard' and re.search(r'caller=(pillar_out|dig_straight_up)', q['d'])):
                    refused = True
                    break
            if not refused:
                out.append((t, t + td(seconds=ENTOMB_DIG_S), 'entombed_dig', t))
        elif n == '_scaffold_pick' and d.startswith(('pillar_out', 'dig_straight_up')):
            out.append((t - td(seconds=2), t, 'pillar_step', t))
        elif n in ('_entombed_ramp_cut', '_marooned_ramp_cut'):
            k = kv(d)
            if int(k.get('steps', '0') or 0) > 0 or int(k.get('breached', '0') or 0) > 0:
                out.append((t - td(seconds=RAMP_S), t, 'ramp', t))
        elif n == '_climb_flood_ramp':
            k = kv(d)
            if int(k.get('steps', '0') or 0) > 0 or k.get('sidestep') == '1':
                out.append((t - td(seconds=RAMP_S), t, 'flood_ramp', t))
        elif n == 'surface':
            out.append((t, t + td(milliseconds=r['dur'] or 0), 'shaft', t))
        elif n == '_climb_flood_breach':
            out.append((t - td(seconds=2), t, 'breach', t))
    return out


def opportunities(rows, cut, end):
    """Opportunity records for one bot's sorted rows. `cut` splits pre/post (a run never chains across it); `end` is
    the end of the post period. Follow-up is truncated at the period boundary, and an opportunity whose 5-min
    follow-up does not fit inside its own period is not eligible (complete outcome follow-up, Codex 10-05)."""
    wt = [r['t'] for r in rows if r['n'] in WATER]
    ws = water_starts(rows)
    digs = dig_intervals(rows)
    guards = [r['t'] for r in rows if r['n'] == '_climb_flood_guard']
    clusters = []
    for r in rows:
        if r['n'] not in OPP:
            continue
        period = 'post' if (cut is None or r['t'] >= cut) else 'pre'
        c = clusters[-1] if clusters else None
        if c and c['period'] == period and secs(c['last'], r['t']) <= OPP_GAP_S and (
                r['pos'] is None or c['pos'] is None or dist(r['pos'], c['pos']) <= OPP_RADIUS):
            c['last'] = r['t']
            c['pos'] = r['pos'] or c['pos']
        else:
            clusters.append({'t0': r['t'], 'last': r['t'], 'pos': r['pos'], 'period': period})
    out = []
    for c in clusters:
        t0 = c['t0']
        bound = (cut if c['period'] == 'pre' else end) if cut is not None else end
        # THE OBSERVATION WINDOW RUNS TO THE RUN'S LAST ESCAPE + 5 min, and it must fit inside the period (Codex r6)
        horizon = min(c['last'] + dt.timedelta(seconds=FOLLOW_S), bound) if bound else c['last'] + dt.timedelta(seconds=FOLLOW_S)
        complete = bound is None or c['last'] + dt.timedelta(seconds=FOLLOW_S) <= bound
        dry = not any(0 < secs(x, t0) <= DRY_S for x in wt) and not any(x == t0 for x in wt)
        first = next((s for s, _ in ws if t0 < s <= horizon), None)
        # DIG EVIDENCE BELONGS TO THE PERIOD OF THE ROW THAT WROTE IT, and its interval is clipped to that period
        # (Codex r6/r7): neither a pre-deploy dig nor a post-deploy ramp row can anchor the other period's opportunity.
        own = []
        for a, b, src, rt in digs:
            if cut is not None:
                if (rt >= cut) != (c['period'] == 'post'):
                    continue
                a, b = (max(a, cut), b) if c['period'] == 'post' else (a, min(b, cut))
            if a <= horizon and b >= t0:
                own.append((a, b, src))
        fast = bool(first) and any(a <= first <= b + dt.timedelta(seconds=FAST_S) for a, b, _ in own)
        guarded = bool(own) or any(t0 <= g <= horizon for g in guards)
        out.append({'t0': t0, 'period': c['period'], 'eligible': dry and complete, 'dry': dry, 'complete': complete,
                    'fast': fast, 'design': bool(first) and secs(t0, first) <= FOLLOW_S, 'guarded': guarded,
                    'sources': sorted({s for _, _, s in own})})
    return out


def chain(rows, ws, end=None):
    """The refusal chain of THIS build, per bot: gates (asks, spin, wet) and the 5-min follow-up (reported). A row
    whose 5-min follow-up does not fit before `end` is CENSORED, never classified dry (Codex r6)."""
    def censored(r):
        return end is not None and r['t'] + dt.timedelta(seconds=FOLLOW_S) > end
    g = Counter()
    out = Counter()
    refused = [r for r in rows if r['n'] == '_climb_flood_refused']
    asks = [r for r in rows if r['n'] in ASKS or (r['n'] == '_prereq_adopted' and 'escape reflex' in r['d']
                                                   and re.search(r'pickaxe|dirt|cobblestone|blocks', r['d']))]
    prev = None
    for r in refused:
        k = kv(r['d'])
        if k.get('dry') == '0':
            g['wet'] += 1
        if any(0 <= secs(r['t'], a['t']) <= ASK_S and (a['pos'] is None or r['pos'] is None or dist(a['pos'], r['pos']) <= ASK_R)
               for a in asks):
            g['prereq'] += 1
        if prev is not None and kv(prev['d']).get('handler') == k.get('handler') and (
                prev['pos'] is None or r['pos'] is None or dist(prev['pos'], r['pos']) <= ASK_R):
            back = float(kv(prev['d']).get('backoff_s', '0') or 0)
            if secs(prev['t'], r['t']) + SPIN_TOL_S < back:
                g['spin'] += 1
        prev = r
        later = any(0 < secs(r['t'], s) <= FOLLOW_S for s, _ in ws)
        out['refused_later_wet' if later else ('refused_censored' if censored(r) else 'refused_stayed_dry')] += 1
    for r in rows:
        if r['n'] != '_climb_flood_ramp':
            continue
        k = kv(r['d'])
        if k.get('yielded') == '1':
            out['preempted'] += 1
            continue
        moved = int(k.get('steps', '0') or 0) > 0 or k.get('sidestep') == '1'
        later = any(0 < secs(r['t'], s) <= FOLLOW_S for s, _ in ws)
        if moved:
            out['wet_after_ramp' if later else ('ramp_censored' if censored(r) else 'out_dry_by_ramp')] += 1
            # A RAMP DIG GETS ITS OWN 20 s WINDOW (the row is stamped at the ramp's end; its digs are in the 60 s before)
            if any(-RAMP_S <= secs(r['t'], s) <= FAST_S for s, _ in ws):
                out['ramp_dig_then_wet_20s'] += 1
        else:
            out['ramp_refused_later_wet' if later else ('ramp_censored' if censored(r) else 'ramp_refused_stayed_dry')] += 1
    return g, out


def stranded_minutes(rows, cut, end):
    """Trapped-bots definition: >= 10 min episodes with failure evidence; minutes split at the deploy."""
    mins = Counter()
    cur = None

    def close(t1):
        dur = secs(cur['t0'], t1)
        ev = cur['pf'] >= 3 or cur['rec'] or cur['str'] or (cur['mv'] >= 3 and cur['mvok'] == 0)
        if dur >= 600 and ev:
            a, b = cur['t0'], t1
            if cut is None or a >= cut:
                mins['post'] += dur / 60
            elif b <= cut:
                mins['pre'] += dur / 60
            else:
                mins['pre'] += secs(a, cut) / 60
                mins['post'] += secs(cut, b) / 60
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
        close(end)
    return mins


def ratio_did(tp, tq, cp, cq):
    """(tp / tq) / (cp / cq) for rates; None when any rate is zero or undefined (never a pseudocount)."""
    try:
        if None in (tp, tq, cp, cq) or min(tp, tq, cp, cq) <= 0:
            return None
        return (tp / tq) / (cp / cq)
    except (TypeError, ZeroDivisionError):
        return None


def arm_rates(per_pool, pools, num, den):
    """Pooled rate num/den per period over a set of pools; None when the denominator is zero (undefined, Codex r6)."""
    out = {}
    for period in ('pre', 'post'):
        n = sum(per_pool[p][num][period] for p in pools)
        d = sum(per_pool[p][den][period] for p in pools)
        out[period] = n / d if d else None
    return out


def e0(n_post, rT, rC):
    """E0 = N_T,post * r_T,pre * r_C,post / r_C,pre; None whenever a required rate is undefined or r_C,pre is 0."""
    if rT['pre'] is None or rC['post'] is None or not rC['pre']:
        return None
    return n_post * rT['pre'] * rC['post'] / rC['pre']


def rdid_for(per_pool, treat, control, num, den):
    t = arm_rates(per_pool, treat, num, den)
    c = arm_rates(per_pool, control, num, den)
    return ratio_did(t['post'], t['pre'], c['post'], c['pre'])


def randomization(per_pool, cans, num, den, adverse):
    """Whole-pool randomization: every assignment of len(cans) pools among the drawable pools present (drawrec never
    draws isolated-* or placebo-c), the observed one included. One-sided p in the `adverse` direction ('high'/'low').
    NOT reproduced: the draw's band and exposure filters -- an approximation, and the read says so."""
    pools = sorted(p for p in per_pool if not NEVER_DRAWN(p))
    k = len(cans)
    obs = rdid_for(per_pool, cans, [p for p in per_pool if p not in cans], num, den)
    if obs is None or k == 0 or not set(cans) <= set(pools):
        return {'R': obs, 'p': None, 'n_assign': 0, 'min_p': None}
    stats = []
    for combo in itertools.combinations(pools, k):
        rest = [p for p in per_pool if p not in combo]
        r = rdid_for(per_pool, list(combo), rest, num, den)
        if r is not None:
            stats.append(r)
    if not stats:
        return {'R': obs, 'p': None, 'n_assign': 0, 'min_p': None}
    tail = sum(1 for r in stats if (r >= obs - 1e-12 if adverse == 'high' else r <= obs + 1e-12))
    return {'R': obs, 'p': tail / len(stats), 'n_assign': len(stats), 'min_p': 1 / len(stats)}


def paper_detect(root):
    """The REAL Paper floods (sandbox/craft/climbflood-ab.cjs skill logs) through this endpoint: per arm, the flood
    scenes' trials whose eligible opportunity is a 20 s hit. root/<arm>/<arm>-<scene>-<k>-<hhmmss>.jsonl."""
    res = {}
    for arm in ('ctrl', 'cand'):
        files = sorted(glob.glob(os.path.join(root, arm, '*.jsonl')))
        tot = elig = hit = 0
        for f in files:
            scene = os.path.basename(f).split('-')[1]
            if scene not in ('A', 'B', 'C', 'G'):
                continue
            rows = rows_from_lines(open(f))
            if not rows:
                continue
            tot += 1
            opps = opportunities(rows, None, rows[-1]['t'] + dt.timedelta(seconds=FOLLOW_S))
            e = [o for o in opps if o['dry']]
            elig += bool(e)
            hit += any(o['fast'] for o in e)
        res[arm] = {'trials': tot, 'eligible': elig, 'detected': hit}
    return res


# POSITIVE CONTROL for the parsers: the row formats this build writes.
assert kv('caller=pillar_out cell=700,42,700 submerged=0 y=40 reason=liquid above the block overhead (water)')['caller'] == 'pillar_out'
assert kv('handler=entombed at=1,2,3 refusals=2 backoff_s=30 prereq=none dry=1 — remedy: x')['backoff_s'] == '30'
assert reason_class('flood risk: liquid over the falling block above the block overhead (water)') == 'falling'
assert death_cause('death (fire): fell 4; path ACTIVE') == 'lava'


def main():
    sys.path.insert(0, '/srv/mcb-analysis-lib')
    sys.path.insert(0, '/opt/minecraft-ai/scripts')
    from lib.telemetry import open_log
    ovr = os.environ.get('CANARY_DRYRUN')
    man = {} if ovr else json.load(open('/srv/mcbots/trial-manifest.json'))
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = ts(ISO)
    else:
        CUT = ts(man['declared_at'])
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = sorted({x.strip() for x in str(CAN).split(',') if x.strip()})
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = secs(CUT, now) / 60
    assert elapsed > 0 and CANS, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 360)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(hours=BASELINE_H)
    LOGROOT = os.environ.get('CLIMBFLOODREAD_LOGROOT', '/var/log/mcai')
    PAPER = os.environ.get('CLIMBFLOODREAD_PAPER', os.path.expanduser('~/mcai-analysis/climbflood-paper'))   # = sandbox/fixtures/climbflood-paper

    def bot_files(bot_dir):
        files = sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl')))
        for k in range(0, (END.date() - PRE.date()).days + 2):
            tag = (PRE.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
            files += sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl-%s.gz' % tag)))
            files += sorted(glob.glob(os.path.join(bot_dir, 'skill-*.jsonl-%s' % tag)))
        return files

    def lines_of(bot_dir):
        for f in bot_files(bot_dir):
            try:
                fh = open_log(f)
            except OSError:
                continue
            with fh:
                for line in fh:
                    yield line

    per_pool = defaultdict(lambda: defaultdict(Counter))       # pool -> metric -> period -> value
    walked = 0; offbuild = 0
    bots_seen = defaultdict(set)
    new_rows = Counter(); gates = Counter(); chain_out = Counter()
    guard_callers = Counter(); guard_reasons = Counter()
    breach_rows = []; exempt = 0
    opp_sources = Counter()
    ctrl_dig_evidence = Counter()
    deaths = Counter()
    for bd in sorted(d for d in glob.glob(os.path.join(LOGROOT, '*')) if os.path.isdir(d) and not os.path.basename(d).startswith('_')):
        bot = os.path.basename(bd)
        pool = pool_of(bot)
        arm = 'canary' if pool in CANS else 'control'
        rows = rows_from_lines(lines_of(bd), PRE, END)
        walked += len(rows)
        if arm == 'canary' and CV:
            kept = []
            for r in rows:
                if r['t'] >= CUT and r['ver'] and not r['ver'].startswith(CV):
                    offbuild += 1          # RESTART-LAG ROWS ARE NOT CANARY (memory 10-01)
                    continue
                kept.append(r)
            rows = kept
        if not rows:
            continue
        M = per_pool[pool]
        for period, sel in (('pre', [r for r in rows if r['t'] < CUT]), ('post', [r for r in rows if r['t'] >= CUT])):
            if sel:
                M['bh'][period] += sum(min(secs(a['t'], b['t']), 120) for a, b in zip(sel, sel[1:])) / 3600 + 5 / 3600
                bots_seen[(arm, period)].add(bot)
        for o in opportunities(rows, CUT, END):
            p = o['period']
            M['opp_all'][p] += 1
            if o['eligible']:
                M['opp'][p] += 1
                M['fast'][p] += o['fast']
                M['design'][p] += o['design']
                if arm == 'canary' and p == 'post':
                    M['guarded'][p] += o['guarded']
                    for s in o['sources']:
                        opp_sources[s] += 1
        sm = stranded_minutes(rows, CUT, END)
        for p in ('pre', 'post'):
            M['strand'][p] += sm[p]
        ws = water_starts(rows)
        for r in rows:
            p = 'post' if r['t'] >= CUT else 'pre'
            if r['n'] in ('mine', '_ore_tunnel'):
                M['mine'][p] += 1
            M['iron'][p] += r['iron']
            if r['n'] == '_death':
                deaths[(arm, p, death_cause(r['d']))] += 1
            if p != 'post':
                continue
            if arm == 'control':
                if r['n'] in NEW:
                    new_rows[('control', r['n'])] += 1
                continue
            if r['n'] in NEW:
                new_rows[('canary', r['n'])] += 1
            k = kv(r['d'])
            if r['n'] == '_climb_flood_guard':
                guard_callers[k.get('caller', '?')] += 1
                guard_reasons[reason_class(r['d'])] += 1
            elif r['n'] == '_climb_flood_breach':
                if k.get('exempt') == '1':
                    exempt += 1
                else:
                    breach_rows.append((bot, r['t'].strftime('%H:%M:%S'), r['d'][:120]))
        if arm == 'control':
            for a, b, src, _ in dig_intervals([r for r in rows if r['t'] >= CUT]):
                ctrl_dig_evidence[src] += 1
        else:
            g, co = chain([r for r in rows if r['t'] >= CUT], [w for w in ws if w[0] >= CUT], END)
            gates.update(g); chain_out.update(co)

    T = [p for p in CANS if p in per_pool]
    C = [p for p in per_pool if p not in CANS]

    def rates(pools, num, den):
        return arm_rates(per_pool, pools, num, den)

    rT, rC = rates(T, 'fast', 'opp'), rates(C, 'fast', 'opp')
    R_E = ratio_did(rT['post'], rT['pre'], rC['post'], rC['pre'])
    nTpost = sum(per_pool[p]['opp']['post'] for p in T)
    E0 = e0(nTpost, rT, rC)
    obs_fast = sum(per_pool[p]['fast']['post'] for p in T)
    eff = randomization(per_pool, T, 'fast', 'opp', 'low')
    rTd, rCd = rates(T, 'design', 'opp'), rates(C, 'design', 'opp')
    R_D = ratio_did(rTd['post'], rTd['pre'], rCd['post'], rCd['pre'])
    strand = randomization(per_pool, T, 'strand', 'bh', 'high')
    mining = randomization(per_pool, T, 'mine', 'bh', 'low')
    paper = paper_detect(PAPER)
    guarded = sum(per_pool[p]['guarded']['post'] for p in T)
    guards = sum(guard_callers.values())
    ctrl_opp = sum(per_pool[p]['opp_all']['post'] for p in C)
    instrument = int(sum(ctrl_dig_evidence.values()) >= 1 and ctrl_opp >= 1)
    control_new = sum(v for (a, n), v in new_rows.items() if a == 'control')
    EXPOSURE_N = int(os.environ.get('CLIMBFLOODREAD_EXPOSURE_N', '100'))
    f3 = lambda x: None if x is None else round(x, 3)

    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min, baseline %d h  |  bots canary %d/%d control %d/%d (pre/post)'
          % (walked, ','.join(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W, BASELINE_H, len(bots_seen[('canary', 'pre')]),
             len(bots_seen[('canary', 'post')]), len(bots_seen[('control', 'pre')]), len(bots_seen[('control', 'post')])))
    print('canary rows from another build (restart lag): %d' % offbuild)
    print('-' * 100)
    print('CORRECTNESS  canary upward digs into water/lava (not the submerged exemption) %d (must be 0) | exempt %d' % (len(breach_rows), exempt))
    print('LIVENESS     canary _climb_flood_guard rows %d (>= 1) by caller %s | reasons %s' % (guards, dict(guard_callers), dict(guard_reasons)))
    print('CHAIN        asks after a refusal %d | refusal before its back-off %d | refusal written wet %d   (all must be 0)'
          % (gates['prereq'], gates['spin'], gates['wet']))
    print('ARMS         control _climb_flood_* rows %d (must be 0)  canary %s' % (control_new, {n: v for (a, n), v in new_rows.items() if a == 'canary'}))
    print('INSTRUMENT   control dig evidence %s | control opportunities post %d | PAPER floods through this endpoint: %s'
          % (dict(ctrl_dig_evidence), ctrl_opp, paper))
    print('EXPOSURE     canary eligible opportunities that reached the guard %d (>= %d) | dig-evidence sources %s'
          % (guarded, EXPOSURE_N, dict(opp_sources)))
    pc = lambda x: 'n/a' if x is None else '%.2f%%' % (100 * x)
    print('REPORTED     20 s endpoint per eligible opportunity: canary %s -> %s  control %s -> %s  R_E %s  '
          'E0 %s  observed %d  p(one-sided, favourable) %s over %d assignments (min %s)'
          % (pc(rT['pre']), pc(rT['post']), pc(rC['pre']), pc(rC['post']), f3(R_E), f3(E0), obs_fast,
             f3(eff['p']), eff['n_assign'], f3(eff['min_p'])))
    print('             5-min design metric R_D %s | refusal chain (5 min) %s' % (f3(R_D), dict(chain_out)))
    print('             stranded min/bot-h R_S %s p(adverse) %s | mining/bot-h R_M %s p(adverse) %s | over %d assignments '
          '-- HARM "NOT DETECTED", NOT "PROVEN ACCEPTABLE"' % (f3(strand['R']), f3(strand['p']), f3(mining['R']), f3(mining['p']), strand['n_assign']))
    print('             deaths by cause %s' % dict(sorted(((f'{a}/{p}/{c}', v) for (a, p, c), v in deaths.items()))))
    for x in breach_rows[:6]:
        print('  breach:', x)
    assert walked > 1000 and len(bots_seen[('control', 'post')]) >= 10, \
        'POSITIVE CONTROL FAILED: %d rows walked, %d control bots post' % (walked, len(bots_seen[('control', 'post')]))
    fields = {
        'flood_digs_canary': len(breach_rows), 'flood_digs_exempt': exempt,
        'guard_rows_canary': guards, 'chain_prereq': gates['prereq'], 'chain_spin': gates['spin'], 'chain_wet': gates['wet'],
        'new_rows_control': control_new, 'offbuild_canary': offbuild,
        'instrument_control': instrument, 'paper_ctrl_detected': paper['ctrl']['detected'],
        'paper_ctrl_trials': paper['ctrl']['trials'], 'paper_ctrl_eligible': paper['ctrl']['eligible'],
        'paper_cand_detected': paper['cand']['detected'], 'paper_cand_trials': paper['cand']['trials'],
        'paper_cand_eligible': paper['cand']['eligible'],
        'guarded_opp_canary': guarded, 'exposure_ready': int(guarded >= EXPOSURE_N),
        'fast_R_E': f3(R_E), 'fast_E0': f3(E0), 'fast_observed': obs_fast, 'fast_p': f3(eff['p']),
        'design_R_D': f3(R_D), 'chain_followup': dict(chain_out),
        'stranded_R_S': f3(strand['R']), 'stranded_p': f3(strand['p']), 'mining_R_M': f3(mining['R']), 'mining_p': f3(mining['p']),
        'assignments': strand['n_assign'],
    }
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('climbfloodread', W, fields)
    except Exception as e:
        print('emit failed:', e)


if __name__ == '__main__':
    main()
