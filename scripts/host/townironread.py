#!/usr/bin/env python3
# townironread.py [window_min] -- the read for canary `towniron-01` (docs/reports/towniron-01-design-2026-10-23.md): the town iron
# reserve. ONE setting (TOWN_IRON_RESERVE, index-known iron_ingot + raw_iron per town), two consumers: the iron task stays open
# for a short town (the rung gather_iron_ore_town + the deliver_iron town order), and the toolkit's shovel is stone while the
# town is short. Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# ROWS (bots/src/towniron.mjs; skills.mjs; toolkit.mjs):
#   _towniron_mode  once per spawn (the licence): phase=mode on= mode= reserve= carry= self= min_ctrs= obs_h= consumers=
#   _town_iron      when a bot's view of its town flips: state=low|ok|unknown units= ingots= raw= ctrs= seen= reserve=
#   _deliver_iron   one per delivery: stop= bag=<ingot0>/<raw0>><ingot1>/<raw1> dep=<ingots>/<raw> keep=<ingots>/<raw>
#   toolkit         the RUNNER's kit row: skill.args = the order's args (credit, n | only, low=1 when the order read the town
#                   short) and the run's result detail ("made <tools> ..."); `_toolkit` phase=kit the kit's own row (crafted=,
#                   before=<tool>@<uses>,...)
#   _pickups        raw_iron picked up (a 60 s summary)
#   NAMES ARE EXACT (lib.telemetry folds `_x` into `x`): every count keys on raw skill.name.
#
#   LICENCE    kind `_towniron_mode`.
#   GATES (REVERT, defect)
#     G1 tier_broken: a canary runner `toolkit` row whose order said low=1 and whose result made an iron_shovel (any).
#     G2 stone_over_shovel: a canary `_toolkit` kit row that crafted stone_shovel while its before= held a shovel with > 1 use
#        left (any).
#     G3 own_iron_delivered: >= 2 canary `_deliver_iron` rows that ended normally (stop done|not_banked) with the bag's closing
#        ingots or raw iron below the keep the row names.
#     G4 deliver_loop: a canary bot with > 7 `_deliver_iron` rows in any 60 min.
#     ARMS  control `_towniron_mode`, `_town_iron` or `_deliver_iron` rows after the deploy (BLOCKS KEEP).
#   LIVENESS   canary licence rows >= 1.
#   POSITIVE CONTROL  control runner `toolkit` rows >= 1 and control `_pickups` rows >= 1.
#   EXPOSURE   canary bots whose latest `_town_iron` said low at least once >= 2 AND (stone shovels made + delivery rows with
#              dep > 0) >= 3. (A town at or above the reserve is not exposed: both consumers then do the base.)
#   PRIMARY (reported) iron delivered to town by the canary (ingots, raw) and per canary bot-h; iron shovels per kit run and
#              stone shovels made, canary vs control DiD; the WORLD: the index-known town iron (containers KNOWN at both ends of
#              each period, per pool, paired pools only), canary vs control DiD.
#   NO-HARM (WATCH) kit no_iron per kit run DiD; raw iron picked up per bot-h DiD (the task's own effect is UP).
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

STALE_MS = 6 * 3600 * 1000


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(detail):
    """PURE. 'k=v k=v ...' -> {k: v}."""
    out = {}
    for tok in (detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out[k] = v
    return out


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def pair(v):
    """PURE. 'a/b' -> (a, b) or None."""
    m = re.match(r'^(\d+)/(\d+)$', v or '')
    return (int(m.group(1)), int(m.group(2))) if m else None


def deliver_fields(detail):
    """PURE. A _deliver_iron detail -> { stop, i0, r0, i1, r1, depI, depR, keepI, keepR } or None."""
    f = fields(detail)
    m = re.match(r'^(\d+)/(\d+)>(\d+)/(\d+)$', f.get('bag', ''))
    dep, keep = pair(f.get('dep')), pair(f.get('keep'))
    if not m or not dep or not keep:
        return None
    i0, r0, i1, r1 = (int(x) for x in m.groups())
    return {'stop': f.get('stop'), 'i0': i0, 'r0': r0, 'i1': i1, 'r1': r1, 'depI': dep[0], 'depR': dep[1], 'keepI': keep[0], 'keepR': keep[1]}


def own_delivered(d):
    """PURE. A normally-ended delivery whose closing bag is below the keep it names (per name)."""
    return bool(d) and d['stop'] in ('done', 'not_banked') and (d['i1'] < d['keepI'] or d['r1'] < d['keepR'])


def shovel_left(before):
    """PURE. A kit row's before= 'tool@uses,...' -> the most uses left on any shovel (or -1: none)."""
    best = -1
    for t in (before or '').split(','):
        if '_shovel@' in t:
            u = num(t.split('@')[1])
            if u is not None and u > best:
                best = u
    return best


def window_rate(ts, per_ms=3600_000):
    best = 0; j = 0
    for i, t in enumerate(ts):
        while ts[j] < t - per_ms + 1:
            j += 1
        best = max(best, i - j + 1)
    return best


def known_at(records, at_ms, stale_ms=STALE_MS):
    """PURE. {(world, k): names} of the containers KNOWN at at_ms (latest record an observation, < stale_ms old)."""
    last = {}
    for r in records:
        at = r.get('at')
        if r.get('t') not in ('obs', 'dirty') or not isinstance(at, (int, float)) or at > at_ms or r.get('k') is None:
            continue
        key = (str(r.get('w')), r['k'])
        cur = last.get(key)
        if cur is None or at > cur['at'] or (at == cur['at'] and r.get('t') == 'dirty'):
            last[key] = r
    return {key: (r.get('names') or {}) for key, r in last.items() if r.get('t') == 'obs' and at_ms - r['at'] < stale_ms}


def stock_change(records, a_ms, b_ms, first_ms=None):
    """PURE. The iron (ingots + raw) change over containers KNOWN at both ends -> (delta, n) or (None, 0) when unavailable."""
    if first_ms is None or a_ms < first_ms:
        return None, 0
    ka, kb = known_at(records, a_ms), known_at(records, b_ms)
    both = set(ka) & set(kb)
    if not both:
        return None, 0
    u = lambda m: sum(int((m.get(n) or [0])[0] or 0) for n in ('iron_ingot', 'raw_iron'))
    return sum(u(kb[k]) - u(ka[k]) for k in both), len(both)


# ---- positive controls on the row shapes ----------------------------------------------------------------------------------
_d = deliver_fields('stop=done bag=0/19>0/3 dep=0/16 keep=0/3')
assert _d == {'stop': 'done', 'i0': 0, 'r0': 19, 'i1': 0, 'r1': 3, 'depI': 0, 'depR': 16, 'keepI': 0, 'keepR': 3}, _d
assert not own_delivered(_d) and own_delivered(dict(_d, r1=1)) and not own_delivered(dict(_d, r1=1, stop='interrupted'))
assert deliver_fields('stop=none bag=0/3>0/3 dep=0/0 keep=0/3')['stop'] == 'none' and deliver_fields('junk') is None
assert shovel_left('iron_axe@200,stone_shovel@120,iron_shovel@1') == 120 and shovel_left('iron_axe@3') == -1
assert window_rate([0, 10, 20]) == 3 and window_rate([]) == 0
_R = [{'t': 'obs', 'k': 'a', 'at': 10, 'w': 'W', 'names': {'raw_iron': [5, 1]}}, {'t': 'obs', 'k': 'a', 'at': 20, 'w': 'W', 'names': {'iron_ingot': [9, 1]}},
      {'t': 'obs', 'k': 'b', 'at': 12, 'w': 'W', 'names': {'iron_ingot': [4, 1]}}, {'t': 'dirty', 'k': 'b', 'at': 18, 'w': 'W'}]
assert stock_change(_R, 15, 25, first_ms=10) == (4, 1), stock_change(_R, 15, 25, first_ms=10)
assert stock_change(_R, 5, 25, first_ms=10) == (None, 0)

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
    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    span = defaultdict(lambda: [None, None]); bots = defaultdict(set)
    n = Counter(); leak = 0; offbuild = 0; noversion = 0
    g1 = []; g2 = []; deliv = []; deliv_ts = defaultdict(list); low_bots = set(); stone = Counter(); iron_sh = Counter()
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
                offbuild += 1; continue
        bots[(period, arm)].add(b)
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        sk = raw(r); k = sk.get('name') or ''; d = sk.get('detail') or r.get('detail') or ''; st = sk.get('status')
        tms = int(t.timestamp() * 1000)
        if k in ('_towniron_mode', '_town_iron', '_deliver_iron') and arm == 'control' and period == 'post':
            leak += 1
        if k == '_towniron_mode' and period == 'post' and arm == 'canary':
            n['licence'] += 1
        elif k == '_town_iron' and period == 'post' and arm == 'canary':
            if fields(d).get('state') == 'low':
                low_bots.add(b)
        elif k == '_deliver_iron' and period == 'post' and arm == 'canary':
            f = deliver_fields(d)
            if f:
                deliv.append((tms, b, f)); deliv_ts[b].append(tms)
        elif k == 'toolkit':
            n[(period, arm, 'kit_runs')] += 1
            args = sk.get('args') or {}
            if 'iron_shovel' in d and str(args.get('low')) == '1' and arm == 'canary' and period == 'post':
                g1.append((b, d[:120]))
            if 'iron_shovel' in d:
                iron_sh[(period, arm)] += 1
        elif k == '_toolkit':
            f = fields(d)
            if f.get('phase') == 'kit':
                n[(period, arm, 'kit')] += 1
                if f.get('outcome') == 'no_iron':
                    n[(period, arm, 'kit_no_iron')] += 1
                crafted = f.get('crafted') or ''
                if 'stone_shovel' in crafted:
                    stone[(period, arm)] += 1
                    if arm == 'canary' and period == 'post' and shovel_left(f.get('before')) > 1:
                        g2.append((b, f.get('before')))
        elif k == '_pickups':
            n[(period, arm, 'pickups')] += 1
            for part in d.split(' | ')[0].split('; '):
                m = re.match(r'^raw_iron (\d+) ', part.strip())
                if m:
                    n[(period, arm, 'raw_iron_up')] += int(m.group(1))

    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)
    def per_bh(v, period, arm):
        bh = bot_hours(period, arm); return v / bh if bh else float('nan')
    def share(period, arm, a, b_):
        d_ = n[(period, arm, b_)]; return n[(period, arm, a)] / d_ if d_ else float('nan')
    def did(f):
        return (f('post', 'canary') - f('pre', 'canary')) - (f('post', 'control') - f('pre', 'control'))

    g3_rows = [(b, f) for _, b, f in deliv if own_delivered(f)]
    g3 = int(len(g3_rows) >= 2)
    loop_bots = sorted(b for b, ts in deliv_ts.items() if window_rate(sorted(ts)) > 7)
    dep_i = sum(f['depI'] for _, _, f in deliv); dep_r = sum(f['depR'] for _, _, f in deliv)
    delivered = sum(1 for _, _, f in deliv if f['depI'] + f['depR'] > 0)
    stones = stone[('post', 'canary')]
    exposure = int(len(low_bots) >= 2 and (stones + delivered) >= 3)
    can_bh = bot_hours('post', 'canary')
    ctl_kit = n[('post', 'control', 'kit_runs')]; ctl_pick = n[('post', 'control', 'pickups')]

    # THE WORLD: per pool, the iron over containers KNOWN at both ends of each period; paired pools only
    ms = lambda x: int(x.timestamp() * 1000)
    census = {}
    for d_ in sorted(glob.glob('/var/lib/mcai/_pool-*')):
        p = d_.split('/_pool-')[1]
        if '.pre-' in p:
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
        if not recs:
            continue
        first = min(r['at'] for r in recs if isinstance(r.get('at'), (int, float)))
        census[p] = {'pre': stock_change(recs, ms(PRE), ms(CUT), first), 'post': stock_change(recs, ms(CUT), ms(END), first)}
    paired = {p for p, c in census.items() if c['pre'][0] is not None and c['post'][0] is not None}
    def arm_mean(arm, per):
        v = [census[p][per][0] for p in paired if (p in CANS) == (arm == 'canary')]
        return (sum(v) / len(v) if v else None), len(v)
    wm = {a: {per: arm_mean(a, per) for per in ('pre', 'post')} for a in ('canary', 'control')}
    world_did = None if any(wm[a][per][0] is None for a in wm for per in wm[a]) else \
        (wm['canary']['post'][0] - wm['canary']['pre'][0]) - (wm['control']['post'][0] - wm['control']['pre'][0])

    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary licence rows %d | canary bots that read their town LOW %d %s' % (n['licence'], len(low_bots), sorted(low_bots)[:6]))
    print('EXPOSURE     low-reading bots %d (need 2) | stone shovels made %d + deliveries that banked %d (need 3) -> %s' % (len(low_bots), stones, delivered, 'READY' if exposure else 'NOT YET'))
    print('PRIMARY      iron delivered to town: %d ingots + %d raw (%.2f per canary bot-h) in %d delivery rows' % (dep_i, dep_r, per_bh(dep_i + dep_r, 'post', 'canary'), len(deliv)))
    print('             iron shovels per kit run canary %.3f -> %.3f control %.3f -> %.3f | stone shovels canary %d control %d'
          % (iron_sh[('pre', 'canary')] / max(1, n[('pre', 'canary', 'kit_runs')]), iron_sh[('post', 'canary')] / max(1, n[('post', 'canary', 'kit_runs')]),
             iron_sh[('pre', 'control')] / max(1, n[('pre', 'control', 'kit_runs')]), iron_sh[('post', 'control')] / max(1, n[('post', 'control', 'kit_runs')]), stones, stone[('post', 'control')]))
    print('WORLD        index-known town iron change per pool (paired pools %d): canary %s -> %s, control %s -> %s, DiD %s'
          % (len(paired), wm['canary']['pre'][0], wm['canary']['post'][0], wm['control']['pre'][0], wm['control']['post'][0], world_did))
    print('G1 (gate)    low=1 orders that made an iron shovel: %d %s' % (len(g1), g1[:3]))
    print('G2 (gate)    stone shovels made over a usable shovel: %d %s' % (len(g2), g2[:3]))
    print('G3 (gate)    deliveries that took the bag below its own keep: %d %s' % (len(g3_rows), g3_rows[:3]))
    print('G4 (gate)    canary bots over 7 deliveries in any 60 min: %d %s' % (len(loop_bots), loop_bots[:5]))
    print('ARMS         control towniron rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control runner toolkit rows post %d | control _pickups rows post %d' % (ctl_kit, ctl_pick))
    print('NO-HARM      kit no_iron per kit run DiD %+.3f | raw iron picked up per bot-h DiD %+.3f'
          % (did(lambda p, a: share(p, a, 'kit_no_iron', 'kit')), did(lambda p, a: per_bh(n[(p, a, 'raw_iron_up')], p, a))))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        nanless = lambda v: None if v is None or v != v else round(v, 4)
        emit('townironread', W, {
            'licence_rows': n['licence'], 'liveness': int(n['licence'] >= 1), 'low_bots': len(low_bots),
            'stone_shovels': stones, 'deliveries_banked': delivered, 'exposure_ready': int(exposure and ctl_kit >= 1 and ctl_pick >= 1),
            'iron_delivered': dep_i + dep_r, 'iron_delivered_per_bh': nanless(per_bh(dep_i + dep_r, 'post', 'canary')),
            'g1_tier_broken': len(g1), 'g2_stone_over_shovel': len(g2), 'g3_own_iron_delivered': g3, 'own_iron_rows': len(g3_rows),
            'g4_deliver_loop': len(loop_bots), 'rows_control_post': leak, 'instrument_control': int(ctl_kit >= 1 and ctl_pick >= 1),
            'world_iron_did': nanless(world_did), 'paired_pools': len(paired),
            'kit_no_iron_did': nanless(did(lambda p, a: share(p, a, 'kit_no_iron', 'kit'))),
            'raw_iron_up_did': nanless(did(lambda p, a: per_bh(n[(p, a, 'raw_iron_up')], p, a))),
            'canary_bot_hours': round(can_bh, 2), 'offbuild_canary': offbuild, 'noversion_canary': noversion,
        })
    except Exception as e:
        print('emit failed:', e)
