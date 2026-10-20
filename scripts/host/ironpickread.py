#!/usr/bin/env python3
# ironpickread.py [window_min] -- the read for canary `ironpick-01` (bots/src/toolkit.mjs: the kit also makes an IRON PICKAXE
# from the town's iron when the bag has none above the trip line, 40 uses; OWNER 2026-10-20 ~03:20Z "add pickaxe to toolkit").
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM; difference-in-differences against
# control for the effect; DENOMINATORS FIRST. IRONPICKREAD_SELFTEST=1 (or --selftest) runs every gate on its fixtures.
#
# WHY (measured 10-20): the town chests held 2,324 iron ingots (80-240 per town; read-only RCON census 00:15Z) while 25 of 80
# bots held a usable iron pickaxe; the kit made the axe and the shovel only, and withdraw_pick fetches stone/wooden copies.
#
# THE CHANGE (rows only this build writes):
#   _toolkit_ironpick_mode  once per spawn: phase=mode on=1|0 ... (the licence; proves the build is live, not the effect)
#   _kit_ironpick           one per kit run whose needs included the iron pickaxe, at the run's end, duration = the run (the
#                           change row): outcome= made=1|0 best=<before>-><after> drew= iron_seen= keep= slots=
#   _toolkit phase=kit      needs= / crafted= may now name iron_pickaxe (toolkitread's K1-K4 judge these rows unchanged)
#
#   ARMED      a bot is ARMED at a row when that row's bot.tools holds no iron pickaxe above TRIP (40) uses and no usable
#              (> FLOOR) diamond/netherite one -- the population the change targets (toolkit.mjs ironPickNeed)
#   METRICS
#     holder share   bots whose LAST row in the period holds a covering pickaxe (iron > 40 or a usable diamond+), per bot
#                    seen, DiD (PRIMARY, reported: should RISE)
#     armed share    the complement over the same rows (should FALL)
#     kit pickaxes   canary `_kit_ironpick` made=1 per bot-h (reported)
#   DEFECTS (each REVERTS on the canary arm; each has a failing fixture and a passing control in the selftest)
#     P1 made_unseen        a made=1 row whose best= after is not a covering pickaxe (the craft claimed, the bag does not show it)
#     P2 drawn_unserved     a run that drew the pickaxe's iron (drew >= 3, not aborted, the bot not dead in the run) after which
#                           NO later row of the bot holds a covering pickaxe (SERVE_MIN 60: the 40-min retry + 20) -- iron in hand,
#                           still no pickaxe (no later row covers); PENDING (reported, never a verdict) when the draw is inside
#                           the last SERVE_MIN of the window
#     P3 fresh_banked       a `_town_deposit` / `_deposit` row of a bot banking an iron pickaxe above TRIP within FRESH_MIN (60) of
#                           that bot's made=1 row (the kit's copy is the only one above TRIP: the worn copy is <= 40)
#     P4 pick_welled        a `_well_dispose` row whose thrown items name any pickaxe
#     P5 keep_breached      a row with iron_seen >= 0 and iron_seen - drew < keep (the container drawn from kept less than
#                           TOWN_IRON_KEEP)
#     P6 craft_loop         a bot with >= LOOP_N (4) made=1 rows inside LOOP_MIN (180) minutes (a fresh copy is 250 uses: four in
#                           3 h is a loop, not wear)
#   REPORTED   double_trip: a withdraw_pick ORDER that took a pickaxe within DOUBLE_MIN (15) minutes of the same bot's made=1
#              row (legitimate when the kit was on cooldown/backed off at that moment -- the deferral needs the kit issuable
#              NOW -- so it is a count to read, not a gate); outcomes; ingots drawn; the worn copy's uses at the craft
#   LIVENESS   canary `_kit_ironpick` rows >= 1; licence rows on=1
#   ARMS       control `_kit_ironpick` or `_toolkit_ironpick_mode` rows after the deploy (must be 0)
#   INSTRUMENT control bots ARMED at their last row >= 1 AND control rows carrying bot.tools >= 1 (the population and the
#              field are visible in control)
#   EXPOSURE   canary `_kit_ironpick` rows >= EXPOSURE_RUNS (5) AND pre-window armed bots on both arms >= 1 (the DiD has a
#              baseline). A bot with an EARLIER ironpick build's rows in the pre window leaves the pre window whole.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

FLOOR = 10            # toolfor.mjs FLOOR
TRIP = 40             # toolkit.mjs IRONPICK_TRIP_USES = withdrawpick PREFER_USES
PICK_INGOTS = 3       # toolkit.mjs KIT.iron_pickaxe.ingots
SERVE_MIN = 60        # TOOLKIT_BACKOFF_MS 30 + TOOLKIT_COOLDOWN_MS 10 = the earliest retry of a failed craft, + 20 min for it to run
FRESH_MIN = 60
LOOP_N, LOOP_MIN = 4, 180
DOUBLE_MIN = 15
EXPOSURE_RUNS = 5
TIER = {'wooden': 0, 'golden': 1, 'stone': 2, 'iron': 3, 'diamond': 4, 'netherite': 5}
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def tag_uses(tag):
    """'iron_pickaxe@250' -> ('iron_pickaxe', 250); 'full' -> 10**6; '-' -> (None, None). Pure."""
    if not tag or tag == '-' or '@' not in tag:
        return None, None
    n, _, u = tag.partition('@')
    return n, (10 ** 6 if u == 'full' else int(u) if u.lstrip('-').isdigit() else 0)


def covers(name, uses):
    """Does one pickaxe copy cover the need (toolkit.mjs ironPickNeed's complement)? Pure."""
    m = re.match(r'^([a-z]+)_pickaxe$', name or '')
    if not m or uses is None:
        return False
    t = TIER.get(m.group(1), -1)
    return (t == 3 and uses > TRIP) or (t > 3 and uses > FLOOR)


def tools_cover(tools):
    """bot.tools ({name: [{used, max}]}) -> True / False / None (None: no tools field on the row). Pure."""
    if not isinstance(tools, dict):
        return None
    for n, cs in tools.items():
        for c in cs or []:
            mx, us = c.get('max'), c.get('used')
            left = 10 ** 6 if not mx else mx - (us or 0)
            if covers(n, left):
                return True
    return False


def best_after(f):
    b = (f.get('best') or '-').split('->')
    return tag_uses(b[1] if len(b) > 1 else '-')


def deposit_picks(detail):
    """`tools a@u,b@v` of a town_deposit row -> [(name, uses)] (pickaxes only). Pure."""
    m = re.search(r'(?:^| )tools (\S+)', detail or '')
    if not m or m.group(1) == '-':
        return []
    out = []
    for part in m.group(1).split(','):
        n, u = tag_uses(part)
        if n and n.endswith('_pickaxe'):
            out.append((n, u))
    return out


def welled_pick(detail):
    f = kv(detail)
    return any(re.search(r'_pickaxe(?::|$|,)', f.get(k) or '') for k in ('items', 'offlist_items'))


def gates(ev):
    """The canary arm's post rows, by bot, in time order -> {gate: [examples]}. Pure over row dicts
    {t, name, detail, status, cover (True/False/None), died_in (bool: a death inside this run)}."""
    out = {g: [] for g in ('P1_made_unseen', 'P2_drawn_unserved', 'P3_fresh_banked', 'P4_pick_welled', 'P5_keep_breached', 'P6_craft_loop')}
    pending = []
    for b, rs in ev['by_bot'].items():
        made_at = []
        for i, r in enumerate(rs):
            n, d = r['name'], r['detail']
            if n == '_kit_ironpick':
                f = kv(d)
                if f.get('made') == '1':
                    made_at.append(r['t'])
                    bn, bu = best_after(f)
                    if not covers(bn, bu):
                        out['P1_made_unseen'].append((b, str(r['t']), f.get('best')))
                seen, drew, keep = num(f, 'iron_seen', -1), num(f, 'drew', 0), num(f, 'keep', 4)
                if seen >= 0 and seen - drew < keep:
                    out['P5_keep_breached'].append((b, str(r['t']), seen, drew, keep))
                if drew >= PICK_INGOTS and f.get('made') != '1' and r['status'] != 'aborted' and not r.get('died_in'):
                    # served: any LATER row of the bot holds a covering pickaxe (the credited iron's retry, or any other way)
                    if not any(x.get('cover') for x in rs[i + 1:]):
                        horizon = r['t'] + dt.timedelta(minutes=SERVE_MIN)
                        (pending if ev['end'] < horizon else out['P2_drawn_unserved']).append((b, str(r['t']), f.get('outcome')))
            elif n in ('_town_deposit', '_deposit'):
                for pn, pu in deposit_picks(d):
                    if pn == 'iron_pickaxe' and pu is not None and pu > TRIP and any(0 <= (r['t'] - m).total_seconds() <= FRESH_MIN * 60 for m in made_at):
                        out['P3_fresh_banked'].append((b, str(r['t']), '%s@%s' % (pn, pu)))
            elif n == '_well_dispose' and welled_pick(d):
                out['P4_pick_welled'].append((b, str(r['t']), d[:80]))
        made_at.sort()
        for k in range(len(made_at)):
            j = k + LOOP_N - 1
            if j < len(made_at) and (made_at[j] - made_at[k]).total_seconds() <= LOOP_MIN * 60:
                out['P6_craft_loop'].append((b, LOOP_N, str(made_at[k]))); break
    return out, pending


def double_trips(by_bot):
    n = []
    for b, rs in by_bot.items():
        made = [r['t'] for r in rs if r['name'] == '_kit_ironpick' and kv(r['detail']).get('made') == '1']
        for r in rs:
            if r['name'] == '_withdraw_pick' and ' verb=withdraw_pick ' in ' %s ' % r['detail'] and re.search(r'took=[a-z_]*_pickaxe', r['detail']):
                if any(abs((r['t'] - m).total_seconds()) <= DOUBLE_MIN * 60 for m in made):
                    n.append((b, str(r['t'])))
    return n


def last_cover(rows):
    """{bot: cover at its LAST row carrying bot.tools}. Pure."""
    out = {}
    for r in rows:
        if r.get('cover') is not None:
            out[r['bot']] = r['cover']
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 20, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, m=0, status='success', cover=None, died=False: {'t': T0 + dt.timedelta(minutes=m), 'name': name, 'detail': detail, 'status': status, 'cover': cover, 'died_in': died, 'bot': 'hive-a-Alpha'}
    OK = 'outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=20 keep=4 slots=20'
    ev = lambda rows, end=600: {'by_bot': {'hive-a-Alpha': rows}, 'end': T0 + dt.timedelta(minutes=end)}
    g, _ = gates(ev([R('_kit_ironpick', OK, cover=True)]))
    assert all(not v for v in g.values()), g
    g, _ = gates(ev([R('_kit_ironpick', OK.replace('->iron_pickaxe@250', '->iron_pickaxe@30'))]))
    assert g['P1_made_unseen'], 'P1: claimed, the bag shows the worn copy only'
    assert covers('iron_pickaxe', 41) and not covers('iron_pickaxe', 40) and covers('diamond_pickaxe', 11) and not covers('diamond_pickaxe', 10) and not covers('stone_pickaxe', 131)
    FAIL = 'outcome=craft_failed made=0 best=iron_pickaxe@30->iron_pickaxe@30 drew=3 iron_seen=20 keep=4 slots=36'
    g, p = gates(ev([R('_kit_ironpick', FAIL, cover=False), R('status', '', m=100, cover=False)]))
    assert g['P2_drawn_unserved'] and not p, 'P2: drew the iron, never served'
    g, _ = gates(ev([R('_kit_ironpick', FAIL, cover=False), R('_kit_ironpick', OK, m=45, cover=True)]))
    assert not g['P2_drawn_unserved'], 'P2 control: the retry made it'
    g, p = gates(ev([R('_kit_ironpick', FAIL, m=550, cover=False)]))
    assert not g['P2_drawn_unserved'] and p, 'P2: inside the last 60 min it is pending'
    g, _ = gates(ev([R('_kit_ironpick', FAIL, status='aborted', cover=False)]))
    assert not g['P2_drawn_unserved'], 'P2: an abort keeps its credit; not a verdict'
    g, _ = gates(ev([R('_kit_ironpick', FAIL, cover=False, died=True)]))
    assert not g['P2_drawn_unserved'], 'P2: a death in the run excuses'
    NOI = 'outcome=no_iron made=0 best=iron_pickaxe@30->iron_pickaxe@30 drew=0 iron_seen=-1 keep=4 slots=20'
    g, _ = gates(ev([R('_kit_ironpick', NOI, cover=False)]))
    assert all(not v for v in g.values()), 'no iron drawn: no gate'
    DEP = 'slots 36->33 stacks 3/3 clicked 3 bagdelta 129 tools iron_pickaxe@250 banked cobblestone:128,iron_pickaxe:1 stop done containers 1,2,3=ok'
    g, _ = gates(ev([R('_kit_ironpick', OK, cover=True), R('_town_deposit', DEP, m=20)]))
    assert g['P3_fresh_banked'], 'P3: the fresh copy banked straight back'
    g, _ = gates(ev([R('_kit_ironpick', OK, cover=True), R('_town_deposit', DEP.replace('iron_pickaxe@250', 'iron_pickaxe@30'), m=20)]))
    assert not g['P3_fresh_banked'], 'P3 control: the worn copy banked as a spare'
    g, _ = gates(ev([R('_kit_ironpick', OK, cover=True), R('_town_deposit', DEP, m=90)]))
    assert not g['P3_fresh_banked'], 'P3 control: outside FRESH_MIN'
    assert deposit_picks(DEP) == [('iron_pickaxe', 250)] and deposit_picks('slots 1->1 tools - banked -') == []
    WD = 'slots=36->34 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=0 offlist_items=- unnamed=0 freed=2 tossed=2 n=2 stop=done items=iron_pickaxe:1,egg:16'
    g, _ = gates(ev([R('_well_dispose', WD)]))
    assert g['P4_pick_welled'], 'P4'
    g, _ = gates(ev([R('_well_dispose', WD.replace('iron_pickaxe:1,', ''))]))
    assert not g['P4_pick_welled'], 'P4 control'
    g, _ = gates(ev([R('_kit_ironpick', OK.replace('iron_seen=20', 'iron_seen=6'), cover=True)]))
    assert g['P5_keep_breached'], 'P5: 6 - 3 < 4'
    g, _ = gates(ev([R('_kit_ironpick', OK.replace('iron_seen=20', 'iron_seen=7'), cover=True)]))
    assert not g['P5_keep_breached'], 'P5 control: 7 - 3 = 4'
    g, _ = gates(ev([R('_kit_ironpick', OK, m=m, cover=True) for m in (0, 50, 100, 150)]))
    assert g['P6_craft_loop'], 'P6'
    g, _ = gates(ev([R('_kit_ironpick', OK, m=m, cover=True) for m in (0, 50, 100, 200)]))
    assert not g['P6_craft_loop'], 'P6 control: four over 200 min'
    WP = 'outcome=took_pick need=trippick uses=120 verification=server verb=withdraw_pick line=40 town=3 cand=1,- visits=1 maxrep=1 vfail=0 cursor=- err=- chest_room=- plan=- srv=stone_pickaxe:+1 bag=20->21 deposited=- took=stone_pickaxe:1 tried=[1,2,3:success]'
    assert len(double_trips({'b': [dict(R('_kit_ironpick', OK), bot='b'), dict(R('_withdraw_pick', WP, m=5), bot='b')]})) == 1
    assert len(double_trips({'b': [dict(R('_kit_ironpick', OK), bot='b'), dict(R('_withdraw_pick', WP, m=30), bot='b')]})) == 0
    assert tools_cover({'iron_pickaxe': [{'used': 200, 'max': 250}]}) is True and tools_cover({'iron_pickaxe': [{'used': 220, 'max': 250}]}) is False
    assert tools_cover({}) is False and tools_cover(None) is None and tools_cover({'iron_pickaxe': [{'used': None, 'max': None}]}) is True
    assert last_cover([{'bot': 'a', 'cover': False}, {'bot': 'a', 'cover': None}, {'bot': 'a', 'cover': True}]) == {'a': True}
    assert pool_of('self-isolated-b-Comet') == 'isolated-b' and pool_of('hive-d-Alpha') == 'hive-d'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv or os.environ.get('IRONPICKREAD_SELFTEST'):
        selftest(); sys.exit(0)
    from lib.telemetry import Events
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

    def load_window(since, until):
        """Rotation-aware (toolkitread's): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z copytruncate."""
        import glob as _glob
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                e2 = Events.load(paths=g, since=since, until=until)
                for r in e2.rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw = sorted(load_window(PRE, END), key=lambda r: r['t'])
    rows, tools_rows = [], Counter()
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        if not b:
            continue
        d = r.get('raw') or {}
        sk = d.get('skill') or {}
        tl = (d.get('bot') or {}).get('tools')
        arm = 'canary' if pool_of(b) in CANS else 'control'
        per = 'post' if r['t'] >= CUT else 'pre'
        bots[(per, arm)].add(b)
        cv = tools_cover(tl)
        if cv is not None:
            tools_rows[(per, arm)] += 1
        rows.append({'t': r['t'], 'bot': b, 'arm': arm, 'per': per, 'name': r['name'], 'detail': r.get('detail') or '', 'status': sk.get('status'),
                     'dur': sk.get('duration_ms') or 0, 'cover': cv})
    # an EARLIER ironpick build's rows in the PRE window: that bot's whole pre window leaves the read (kitsearchread's rule)
    dirty = {r['bot'] for r in rows if r['per'] == 'pre' and r['name'] in ('_kit_ironpick', '_toolkit_ironpick_mode')}
    rows = [r for r in rows if not (r['per'] == 'pre' and r['bot'] in dirty)]
    for arm in ('canary', 'control'):
        bots[('pre', arm)] -= dirty
    deaths = defaultdict(list)
    for r in rows:
        if r['name'] == '_death' and r['per'] == 'post':
            deaths[r['bot']].append(r['t'])
    for r in rows:
        if r['name'] == '_kit_ironpick':
            st = r['t'] - dt.timedelta(milliseconds=r['dur'] or 0) - dt.timedelta(seconds=1)
            r['died_in'] = any(st <= x <= r['t'] + dt.timedelta(seconds=10) for x in deaths[r['bot']])
    by_bot = defaultdict(list)
    for r in rows:
        if r['arm'] == 'canary' and r['per'] == 'post':
            by_bot[r['bot']].append(r)
    g, pending = gates({'by_bot': by_bot, 'end': END})
    post_c = [r for r in rows if r['arm'] == 'canary' and r['per'] == 'post']
    kit_c = [r for r in post_c if r['name'] == '_kit_ironpick']
    made_c = [r for r in kit_c if kv(r['detail']).get('made') == '1']
    licence = Counter(kv(r['detail']).get('on', '?') for r in post_c if r['name'] == '_toolkit_ironpick_mode')
    ctrl_rows = sum(1 for r in rows if r['arm'] == 'control' and r['per'] == 'post' and r['name'] in ('_kit_ironpick', '_toolkit_ironpick_mode'))
    share = {}
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            lc = last_cover([r for r in rows if r['per'] == per and r['arm'] == arm])
            share[(per, arm)] = (sum(1 for v in lc.values() if v), len(lc))
    frac = lambda k: share[k][0] / share[k][1] if share[k][1] else float('nan')
    did = (frac(('post', 'canary')) - frac(('pre', 'canary'))) - (frac(('post', 'control')) - frac(('pre', 'control')))
    armed_pre = {arm: share[('pre', arm)][1] - share[('pre', arm)][0] for arm in ('canary', 'control')}
    armed_ctl_last = share[('post', 'control')][1] - share[('post', 'control')][0]
    instrument = int(armed_ctl_last >= 1 and tools_rows[('post', 'control')] >= 1)
    exposure = int(len(kit_c) >= EXPOSURE_RUNS and armed_pre['canary'] >= 1 and armed_pre['control'] >= 1)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    dbl = double_trips(by_bot)
    worn_at = Counter((kv(r['detail']).get('best') or '-').split('->')[0] for r in made_c)
    print('DENOMINATORS rows walked %d | bots pre canary %d control %d | post canary %d control %d | rows with bot.tools post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (len(raw), len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]),
             tools_rows[('post', 'canary')], tools_rows[('post', 'control')], W, hrs('post', 'canary'), hrs('post', 'control')))
    print('PRIMARY      bots whose last row holds a covering pickaxe (iron > %d or a usable diamond+): canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %+.3f (should RISE)'
          % (TRIP, *share[('pre', 'canary')], *share[('post', 'canary')], *share[('pre', 'control')], *share[('post', 'control')], did))
    print('KIT PICKAXE  canary _kit_ironpick runs %d, made %d (%.3f per canary bot-h) | outcomes %s | ingots drawn %d | worn copy at the craft %s'
          % (len(kit_c), len(made_c), len(made_c) / hrs('post', 'canary') if hrs('post', 'canary') else float('nan'),
             dict(Counter(kv(r['detail']).get('outcome') for r in kit_c)), sum(num(kv(r['detail']), 'drew') for r in kit_c), dict(worn_at.most_common(6))))
    print('LIVENESS     canary _kit_ironpick rows %d (>= 1) | licence rows %s | control rows of either kind after the deploy %d (must be 0)' % (len(kit_c), dict(licence), ctrl_rows))
    print('DEFECTS      %s (all must be 0) | P2 pending (drawn < %d min before the end) %d %s'
          % ({k: len(v) for k, v in g.items()}, SERVE_MIN, len(pending), pending[:3]))
    for k, v in g.items():
        for x in v[:3]:
            print('  defect %s: %s' % (k, x))
    # THE PARSERS' POSITIVE CONTROLS (CLAUDE.md: a zero needs an instrument that could have seen a presence): both arms, both periods
    dep_all = [r for r in rows if r['name'] in ('_town_deposit', '_deposit')]
    print('CONTROLS     deposit rows walked %d (banking a pickaxe, parsed: %d) | well_dispose rows walked %d (naming a pickaxe: %d) | kit rows walked %d'
          % (len(dep_all), sum(1 for r in dep_all if deposit_picks(r['detail'])), sum(1 for r in rows if r['name'] == '_well_dispose'),
             sum(1 for r in rows if r['name'] == '_well_dispose' and welled_pick(r['detail'])),
             sum(1 for r in rows if r['name'] == '_toolkit' and r['detail'].startswith('phase=kit '))))
    print('REPORTED     double trips (a withdraw_pick order took a pickaxe within %d min of a made=1 row) %d %s' % (DOUBLE_MIN, len(dbl), dbl[:3]))
    print('INSTRUMENT   control bots ARMED at their last row %d, control rows with bot.tools %d -> %s' % (armed_ctl_last, tools_rows[('post', 'control')], 'ok' if instrument else 'BLIND'))
    print('EXPOSURE     -> %s (canary _kit_ironpick rows %d, need %d; pre-window armed bots canary %d control %d)'
          % ('READY' if exposure else 'NOT YET', len(kit_c), EXPOSURE_RUNS, armed_pre['canary'], armed_pre['control']))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('ironpickread', W, {
            'kit_runs_canary': len(kit_c), 'made_canary': len(made_c), 'licence_canary': licence.get('1', 0), 'rows_control': ctrl_rows,
            'p1_made_unseen': len(g['P1_made_unseen']), 'p2_drawn_unserved': len(g['P2_drawn_unserved']), 'p3_fresh_banked': len(g['P3_fresh_banked']),
            'p4_pick_welled': len(g['P4_pick_welled']), 'p5_keep_breached': len(g['P5_keep_breached']), 'p6_craft_loop': len(g['P6_craft_loop']),
            'p2_pending': len(pending), 'double_trips': len(dbl), 'instrument_control': instrument, 'exposure_ready': exposure,
            'holder_share_did': clean(did), 'holder_canary_post': share[('post', 'canary')][0], 'seen_canary_post': share[('post', 'canary')][1],
        })
    except Exception as e:
        print('emit failed:', e)
