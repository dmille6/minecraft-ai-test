#!/usr/bin/env python3
# cobblekeepread.py [window_min] -- the read for canary `cobblekeep-01` (why bots keep their cobble: dirt/grass lids are
# cleared, a never-conductor lid (leaves, glass) is no lid, and the well takes a cobble stack the bank's own admission
# refuses at the cap on counted stock). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY
# ARM; difference-in-differences against control for every effect; DENOMINATORS FIRST.
#
# WHY (docs/reports/cobblekeep-01-cause-2026-10-19.md, ES 24 h to 10-19 ~12:15Z): 609 of 613 town deposits refused the
# bag's cobble -- 446 `cobble_unknown` (a town container never counted: lid=dirt 3,774 / oak_leaves 422 of 4,200
# `_lid_clear` refusals in 60 h) and 163 `cobble_cap` -- while the well threw cobble on 33 of 232 visits (9,738 cobble),
# all on `cap=at_cap` from the 1 h floor. Bags 91% full, cobble 534 of 2,880 slots, ~420 cobble per bot.
#
# MEMORY: STREAMED (lidclearread's pattern): only the kinds below are held, plus a per-bot running sum of bag cobble.
#
# THE CHANGE (rows only this build writes, or fields it changes):
#   _cobblekeep_mode  once per spawn: the licence (proves the build is live, not the effect)
#   _lid_clear        lid=dirt|grass_block outcome=dug: the new breakable blocks (the base refuses them)
#   _well_dispose     cobble=N>0 cap=at_cap: now also on the bank's own at-cap refusal, not only the 1 h floor
#
#   LIVENESS   licence_canary >= 1; mechanism rows reported: canary dirt/grass lids dug, canary well cobble thrown
#   ARMS       rows_control: control _cobblekeep_mode or dirt/grass `dug` rows (must be 0)
#   DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#     D1 breach_lid_protected: a canary lid dig (dug/failed/unconfirmed) of a block outside cobblestone, cobbled_deepslate,
#        dirt, grass_block -- lidrule.mjs LID_BREAKABLE must have refused it
#     D2 breach_reserve: a canary well throw of cobble whose row says cobble_left < 64 (the bag's escape reserve,
#        well.mjs COBBLE_WELL_RESERVE = STONE_GUARD: the exit contract's iron-depth descent needs 59)
#   (NOT a gate, Codex r1 P2: the row's cap= is the LAST reading of the visit -- a valid visit throws a 30 at the cap and
#    then keeps a 64 after a withdrawal and says cap=below; every executed throw is re-judged at its click in skills.mjs)
#     reported last_cap_not_at_cap: canary visits that threw cobble and ended on another reading
#   REPORTED (DiD, never a verdict)
#     PRIMARY  bag cobble per bot (mean over bots of each bot's mean held, from every row's bot.inventory) -- should FALL;
#              refused cobble at a town deposit per bot-h (cobble_unknown, cobble_cap) -- should FALL;
#              well cobble thrown per bot-h -- should RISE; bots at >= 34 slots (share of bots' last snapshot, slots estimated from the name->count snapshot)
#     count_town lid_blocked per bot-h (should FALL); _lid_clear refused blocks by name (a new blocker shows here first)
#   TRIPWIRES  (never a verdict) the escape: canary snapshots with < 64 RESERVE_STONE within 10 min after a canary well
#              cobble throw by that bot (names them); deaths are the gate's linkage (change_rows: _well_dispose, _lid_clear)
#   INSTRUMENT control _stock_refused via=town_deposit cobble rows >= 1 AND control _well_dispose rows >= 1
#   EXPOSURE   FROZEN BEFORE THE DEPLOY: >= 3 canary `_stock_refused via=town_deposit` cobble rows (unknown or cap) in the
#              fixed 12 h before declared_at -- a drawn canary town refused its bots' cobble
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('count_town', '_stock_refused', '_lid_clear', '_cobblekeep_mode', '_well_dispose', 'town_deposit', 'dispose_well')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
BREAKABLE = re.compile(r'^(cobblestone|cobbled_deepslate|dirt|grass_block)$')
NEW_LIDS = ('dirt', 'grass_block')
DUG = ('dug', 'failed', 'unconfirmed')
COBBLE = ('cobblestone', 'cobbled_deepslate')
RESERVE_STONE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')
RESERVE = 64
FULL_SLOTS = 34
EXPOSURE_PRE_H = 12
ESCAPE_WINDOW_S = 600
COBBLE_REF = re.compile(r'(?:^| )(cobblestone|cobbled_deepslate):(\d+):(cobble_unknown|cobble_cap)')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def cobble_refusal(r):
    """a town deposit's `_stock_refused` row that refused cobble -> 'cobble_unknown' | 'cobble_cap' | None"""
    if r['name'] != '_stock_refused' or not r['detail'].startswith('via=town_deposit'):
        return None
    m = COBBLE_REF.search(r['detail'])
    return m.group(3) if m else None


def well_cobble(r):
    return num(kv(r['detail']), 'cobble') if r['name'] == '_well_dispose' else 0


TOOL = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$|^(bucket|water_bucket|lava_bucket|shears|flint_and_steel|bow|fishing_rod)$')


def est_slots(inv):
    """bot.inventory is {name: count}: slots ESTIMATED as one per tool copy, else ceil(count / 64) (16-stackers read low)"""
    return sum(int(c or 0) if TOOL.search(n) else -(-int(c or 0) // 64) for n, c in inv.items())


def mine(r):
    f = kv(r['detail'])
    return r['name'] == '_cobblekeep_mode' or (r['name'] == '_lid_clear' and f.get('outcome') == 'dug' and f.get('lid') in NEW_LIDS)


def stream(since, until, cut, cans, logroot='/var/log/mcai', cv=''):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    lag = [0]
    bots = defaultdict(set)
    bag = defaultdict(lambda: [0, 0])     # (per, arm, bot) -> [sum cobble, n snapshots]
    last = {}                             # (per, arm, bot) -> (t, slots)
    snaps = defaultdict(list)             # canary post bot -> [(t, reserve stone)]
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
                bo = d.get('bot') or {}
                b = bo.get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                # RESTART LAG (memory: restart-lag rows are not canary): a canary post row from another build is skipped
                if cv and arm == 'canary' and per == 'post' and not str((d.get('code') or {}).get('version') or '').startswith(cv[:12]):
                    lag[0] += 1
                    continue
                if b:
                    bots[(per, arm)].add(b)
                    inv = bo.get('inventory')
                    if isinstance(inv, dict):
                        acc = bag[(per, arm, b)]
                        acc[0] += sum(int(inv.get(x) or 0) for x in COBBLE); acc[1] += 1
                        prev = last.get((per, arm, b))
                        if prev is None or t >= prev[0]:
                            last[(per, arm, b)] = (t, est_slots(inv))
                        if per == 'post' and arm == 'canary':
                            snaps[b].append((t, sum(int(inv.get(x) or 0) for x in RESERVE_STONE)))
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'),
                                 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    stream.lag = lag[0]
    return kept, walked, bots, bad, bag, last, snaps


def judge(rows, bag=None, last=None, snaps=None, exposure_pre=None):
    """bag: {(per, arm, bot): [sum, n]}; last: {(per, arm, bot): (t, slots)}; snaps: {bot: [(t, reserve stone)]} (canary post).
    exposure_pre: canary town-deposit cobble refusals in the fixed EXPOSURE_PRE_H before the deploy (None: the rows' pre)."""
    out = {}
    bag, last, snaps = bag or {}, last or {}, snaps or {}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    lc = [r for r in post_c if r['name'] == '_lid_clear']
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_cobblekeep_mode')
    out['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and mine(r))
    out['lid_new_dug'] = sum(1 for r in lc if kv(r['detail']).get('outcome') == 'dug' and kv(r['detail']).get('lid') in NEW_LIDS)
    out['lid_outcomes'] = dict(Counter('%s:%s' % (kv(r['detail']).get('lid') or '?', kv(r['detail']).get('outcome') or '?') for r in lc))
    out['lid_refused_blocks'] = dict(Counter(kv(r['detail']).get('lid') or '?' for r in lc if kv(r['detail']).get('outcome') == 'refused'))
    prot, low, notcap, throws = [], [], [], []
    for r in lc:
        f = kv(r['detail'])
        if f.get('outcome') in DUG and not BREAKABLE.match(f.get('lid') or ''):
            prot.append((r['bot'], f.get('at'), f.get('lid'), str(r['t'])))
    for r in post_c:
        c = well_cobble(r)
        if c <= 0:
            continue
        f = kv(r['detail'])
        throws.append((r['bot'], r['t']))
        if 'cobble_left' in f and num(f, 'cobble_left', RESERVE) < RESERVE:
            low.append((r['bot'], c, f.get('cobble_left'), str(r['t'])))
        if f.get('cap') != 'at_cap':
            notcap.append((r['bot'], c, f.get('cap'), str(r['t'])))
    out['breach_lid_protected'] = len(prot)
    out['breach_reserve'] = len(low)
    out['last_cap_not_at_cap'] = len(notcap)
    esc = []
    for b, t in throws:
        for (st, stone) in snaps.get(b, []):
            if 0 <= (st - t).total_seconds() <= ESCAPE_WINDOW_S and stone < RESERVE:
                esc.append((b, stone, str(st))); break
    out['escape_low_after_throw'] = len(esc)
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['refused_unknown_%s_%s' % (per, arm)] = sum(1 for r in sel if cobble_refusal(r) == 'cobble_unknown')
            out['refused_cap_%s_%s' % (per, arm)] = sum(1 for r in sel if cobble_refusal(r) == 'cobble_cap')
            out['well_cobble_%s_%s' % (per, arm)] = sum(well_cobble(r) for r in sel)
            out['well_rows_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_well_dispose')
            out['town_deposit_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'town_deposit')
            out['lid_blocked_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'count_town' and 'lid_blocked' in (kv(r['detail']).get('fails') or ''))
            means = [s / n for (p, a, _b), (s, n) in bag.items() if p == per and a == arm and n]
            out['bag_cobble_%s_%s' % (per, arm)] = round(sum(means) / len(means), 1) if means else float('nan')
            out['bag_bots_%s_%s' % (per, arm)] = len(means)
            fulls = [sl for (p, a, _b), (_t, sl) in last.items() if p == per and a == arm]
            out['full_share_%s_%s' % (per, arm)] = round(sum(1 for sl in fulls if sl >= FULL_SLOTS) / len(fulls), 3) if fulls else float('nan')
    out['instrument_control'] = int((out['refused_unknown_post_control'] + out['refused_cap_post_control']) >= 1 and out['well_rows_post_control'] >= 1)
    out['exposure_pre_rows'] = (out['refused_unknown_pre_canary'] + out['refused_cap_pre_canary']) if exposure_pre is None else exposure_pre
    out['exposure_ready'] = int(out['exposure_pre_rows'] >= 3)
    out['_lists'] = {'protected': prot[:5], 'reserve': low[:5], 'not_at_cap': notcap[:5], 'escape': esc[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 19, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='placebo-b-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': None, 'detail': detail, 'bot': bot}
    LC = lambda outcome, lid='dirt', **k: R('_lid_clear', 'outcome=%s by=count_town at=1,2,3 key=1,2,3 lid=%s above=air tool=hand dig_ms=750 budget=3250' % (outcome, lid), **k)
    WD = lambda cobble, left=64, cap='at_cap', **k: R('_well_dispose', 'slots=36->27 offlist=0 gclicked=0 stone=2206 cobble=%d cobble_left=%d cap=%s n=%d' % (cobble, left, cap, cobble), **k)
    SR = lambda why='cobble_cap', **k: R('_stock_refused', 'via=town_deposit n=1 cobble=1 stock=0 at_cobble=1 at_stock=0 cobblestone:900:%s' % why, **k)
    ctl = [SR(arm='control', bot='hive-b-Alpha'), WD(0, cap='below', arm='control', bot='hive-b-Alpha')]
    PRE = [SR(per='pre')] * 3
    ok = judge([R('_cobblekeep_mode', 'phase=mode'), LC('dug'), WD(576, 1630)] + ctl + PRE)
    assert ok['licence_canary'] == 1 and ok['lid_new_dug'] == 1 and ok['breach_lid_protected'] == 0 and ok['breach_reserve'] == 0 and ok['last_cap_not_at_cap'] == 0, ok
    assert ok['exposure_ready'] == 1 and ok['instrument_control'] == 1 and ok['well_cobble_post_canary'] == 576 and ok['rows_control'] == 0, ok
    assert judge([LC('dug', lid='chest')] + ctl)['breach_lid_protected'] == 1, 'D1: a dug chest'
    assert judge([LC('failed', lid='oak_planks')] + ctl)['breach_lid_protected'] == 1, 'D1: a dig tried on planks'
    assert judge([LC('refused', lid='oak_planks')] + ctl)['breach_lid_protected'] == 0, 'D1 control: a refusal is the rule working'
    assert judge([LC('dug', lid='grass_block'), LC('dug', lid='cobblestone')] + ctl)['breach_lid_protected'] == 0, 'D1 control: the breakable set'
    assert judge([WD(64, 40)] + ctl)['breach_reserve'] == 1, 'D2: the bag left under 64'
    assert judge([WD(64, 64)] + ctl)['breach_reserve'] == 0, 'D2 control: exactly the reserve'
    assert judge([WD(0, 10)] + ctl)['breach_reserve'] == 0, 'D2 control: no cobble thrown'
    # Codex r1 P2: a 30 thrown at the cap, then a 64 kept after a withdrawal -> cobble=30 cap=below. REPORTED, never a revert
    mixed = judge([WD(30, 2176, cap='below')] + ctl)
    assert mixed['last_cap_not_at_cap'] == 1 and mixed['breach_reserve'] == 0 and mixed['breach_lid_protected'] == 0, mixed
    assert judge([WD(64, 100, cap='at_cap')] + ctl)['last_cap_not_at_cap'] == 0
    assert judge([SR(per='pre')] * 2 + ctl)['exposure_ready'] == 0, 'two are not exposure'
    assert judge([SR(why='cobble_unknown', per='pre')] * 3 + ctl)['exposure_ready'] == 1, 'unknown refusals are exposure too'
    assert judge([SR()] * 5 + ctl)['exposure_ready'] == 0, 'post-deploy refusals are not eligibility'
    assert judge(ctl, exposure_pre=3)['exposure_ready'] == 1 and judge(PRE + ctl, exposure_pre=0)['exposure_ready'] == 0, 'the fixed 12 h count decides'
    assert judge([SR(arm='control', bot='hive-b-Alpha')])['instrument_control'] == 0, 'no control well rows: BLIND'
    assert judge([R('_stock_refused', 'via=deposit n=1 cobble=1 stock=0 at_cobble=1 at_stock=0 cobblestone:900:cobble_cap', arm='control', bot='hive-b-A'),
                  WD(0, arm='control', bot='hive-b-A')])['instrument_control'] == 0, 'a model deposit refusal is not the town deposit'
    c = judge([R('_cobblekeep_mode', 'phase=mode', arm='control', bot='hive-b-A'), LC('dug', arm='control', bot='hive-b-A'), LC('dug', lid='cobblestone', arm='control', bot='hive-b-A')])
    assert c['rows_control'] == 2, c
    bag = {('pre', 'canary', 'a'): [800, 2], ('post', 'canary', 'a'): [200, 2], ('pre', 'control', 'b'): [500, 1], ('post', 'control', 'b'): [500, 1]}
    last = {('post', 'canary', 'a'): (T0, 27), ('post', 'control', 'b'): (T0, 36)}
    bg = judge(ctl, bag, last)
    assert bg['bag_cobble_pre_canary'] == 400 and bg['bag_cobble_post_canary'] == 100 and bg['full_share_post_canary'] == 0 and bg['full_share_post_control'] == 1, bg
    esc = judge([WD(576, 64)] + ctl, snaps={'placebo-b-Alpha': [(T0 + dt.timedelta(minutes=3), 20)]})
    assert esc['escape_low_after_throw'] == 1, esc
    assert judge([WD(576, 64)] + ctl, snaps={'placebo-b-Alpha': [(T0 + dt.timedelta(minutes=30), 20)]})['escape_low_after_throw'] == 0, 'outside the 10 min'
    assert judge([WD(576, 64)] + ctl, snaps={'placebo-b-Alpha': [(T0 + dt.timedelta(minutes=3), 64)]})['escape_low_after_throw'] == 0, 'the reserve kept'
    assert est_slots({'cobblestone': 2206, 'stone_pickaxe': 2, 'dirt': 6}) == 35 + 2 + 1
    assert cobble_refusal(SR(why='cobble_unknown')) == 'cobble_unknown' and cobble_refusal(R('_stock_refused', 'via=town_deposit n=1 cobble=0 stock=1 oak_log:90:stock_unknown')) is None
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


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
    rows, walked, bots, bad, bag, last, snaps = stream(PRE, END, CUT, CANS, cv=CV if CV and CV != 'x' else '')
    lagged = stream.lag
    xrows, xwalked, _, _, _, _, _ = stream(CUT - dt.timedelta(hours=EXPOSURE_PRE_H), CUT, CUT, CANS)
    xpre = sum(1 for r in xrows if r['arm'] == 'canary' and cobble_refusal(r))
    res = judge(rows, bag, last, snaps, exposure_pre=xpre)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('refused_unknown', 'refused_cap', 'well_cobble', 'lid_blocked', 'town_deposit')}
    lvl = lambda k: (res[k + '_post_canary'] - res[k + '_pre_canary']) - (res[k + '_post_control'] - res[k + '_pre_control'])
    dids['bag_cobble'] = lvl('bag_cobble'); dids['full_share'] = lvl('full_share')
    print('RESTART LAG  canary post rows from another build skipped: %d (canary build %s)' % (lagged, CV or '-'))
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | bag snapshots: bots pre/post canary %d/%d control %d/%d'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control'), res['bag_bots_pre_canary'], res['bag_bots_post_canary'], res['bag_bots_pre_control'], res['bag_bots_post_control']))
    print('PRIMARY      bag cobble per bot canary %.1f -> %.1f control %.1f -> %.1f | DiD %+.1f (should FALL) | bots >= %d slots (est.) canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
          % (res['bag_cobble_pre_canary'], res['bag_cobble_post_canary'], res['bag_cobble_pre_control'], res['bag_cobble_post_control'], dids['bag_cobble'], FULL_SLOTS,
             res['full_share_pre_canary'], res['full_share_post_canary'], res['full_share_pre_control'], res['full_share_post_control'], dids['full_share']))
    print('             town-deposit cobble refused: unknown canary %d -> %d control %d -> %d DiD %+.3f /bot-h | at cap canary %d -> %d control %d -> %d DiD %+.3f /bot-h (town_deposit rows canary %d -> %d control %d -> %d)'
          % (res['refused_unknown_pre_canary'], res['refused_unknown_post_canary'], res['refused_unknown_pre_control'], res['refused_unknown_post_control'], dids['refused_unknown'],
             res['refused_cap_pre_canary'], res['refused_cap_post_canary'], res['refused_cap_pre_control'], res['refused_cap_post_control'], dids['refused_cap'],
             res['town_deposit_pre_canary'], res['town_deposit_post_canary'], res['town_deposit_pre_control'], res['town_deposit_post_control']))
    print('             well cobble thrown canary %d -> %d control %d -> %d | DiD %+.2f /bot-h (should RISE) | well rows canary %d -> %d control %d -> %d'
          % (res['well_cobble_pre_canary'], res['well_cobble_post_canary'], res['well_cobble_pre_control'], res['well_cobble_post_control'], dids['well_cobble'],
             res['well_rows_pre_canary'], res['well_rows_post_canary'], res['well_rows_pre_control'], res['well_rows_post_control']))
    print('LIVENESS     licence rows %d | dirt/grass lids dug %d | lid outcomes %s | refused blocks %s | control rows %d (must be 0) | count_town lid_blocked canary %d -> %d control %d -> %d DiD %+.3f'
          % (res['licence_canary'], res['lid_new_dug'], res['lid_outcomes'], res['lid_refused_blocks'], res['rows_control'],
             res['lid_blocked_pre_canary'], res['lid_blocked_post_canary'], res['lid_blocked_pre_control'], res['lid_blocked_post_control'], dids['lid_blocked']))
    print('DEFECTS      D1 lid outside the breakable set dug %d %s | D2 well cobble below the %d reserve %d %s | (reported) visits that threw cobble and ended on another cap reading %d %s'
          % (res['breach_lid_protected'], res['_lists']['protected'], RESERVE, res['breach_reserve'], res['_lists']['reserve'], res['last_cap_not_at_cap'], res['_lists']['not_at_cap']))
    print('TRIPWIRES    reserve stone < %d within %d s after a canary well cobble throw %d %s'
          % (RESERVE, ESCAPE_WINDOW_S, res['escape_low_after_throw'], res['_lists']['escape']))
    print('EXPOSURE     -> %s (frozen: canary town-deposit cobble refusals in the %d h before declared_at %d of %d rows walked, need 3) | INSTRUMENT control refusals %d, control well rows %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', EXPOSURE_PRE_H, res['exposure_pre_rows'], xwalked,
             res['refused_unknown_post_control'] + res['refused_cap_post_control'], res['well_rows_post_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('cobblekeepread', W, {k: (clean(v) if isinstance(v, float) else v) for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
