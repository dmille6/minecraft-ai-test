#!/usr/bin/env python3
# withdrawread.py [window_min] -- the read for canaries `withdraw-01` (wd-on-<fleet>) and `withdraw2-01` (wd2-on-<fleet>).
#
# WITHDRAW2 (owner 10-06, docs/reports/withdraw2-design.md): BEST-FIRST pickaxe withdrawal (tier first, never spent,
# never worse than a copy observed and not proven gone) and the IRON UPGRADE (a bot whose best usable pickaxe is below
# iron takes exactly 3 ingots + 2 sticks (or wood) and crafts an iron pickaxe, verified by the server). withdraw-01 is
# on the whole fleet now, so the CONTROL writes `_withdraw_pick` rows too: canary rows are told apart by their
# structured ledger (logEvent args: held, took_tier, took_uses, best_seen, best_valid, gone, craft, produced, srv, plan,
# transform, iron, complete). GATES on the canary (each REVERTS):
#   G1 unplanned loss -- args srv (cumulative server change) falls of a name not in plan nor transform (complete rows);
#   G2 spent tool taken -- args took_uses <= 10 for a taken pickaxe (or detail uses=, the withdraw-01 field);
#   G5 worse tier taken -- args took_tier below best_valid (the best observed copy not proven gone);
#   G6 iron without a server-confirmed craft -- outcome=crafted_iron without craft=server, srv iron_pickaxe +1, complete.
# A canary row without a complete ledger is UNKNOWN for G1/G6 (counted and reported; never a pass).
# REPORTED (DiD): share of withdrawn pickaxes by tier (iron or better), iron pickaxes per bot-hour (confirmed
# iron_pickaxe crafts), bots holding iron or better. INSTRUMENT: control bots at town with a usable pickaxe below iron.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: a deterministic `withdraw_pick` town order (composter.mjs townOrder) for a bot AT TOWN (<= 48 of home) whose
# bag holds NO usable pickaxe (> 10 uses): look in up to three containers for ONE pickaxe -- the best usable copy, never a
# spent one -- else take the exact ingredients of one stone pickaxe (3 cobblestone, 2 sticks, 4 planks without a table).
# Room is made only by banking a whole stack deposit would bank anyway; with a FULL chest the bag stack and the pickaxe
# trade places (3 clicks). Every transfer is verified against the SERVER's bag (craftsync recount); what was withdrawn
# is held back from deposit for 10 min. A cursor that cannot be emptied is never closed on (holdUnsettled):
# WITHDRAW_LOADED_MODE=hold (default; owner: junkswap only once a disposal exists) keeps holding with
# intervention_needed rows; a survival reflex may release (close loaded) as an emergency. craftsync's clicks are bound
# to the window they were issued for (inflight.mjs) and a stale click is refused before mineflayer runs it.
# MOTIVE (census 10-04 02:52Z): 897 usable stone pickaxes in the town banks while 45 of 80 bots carried none.
#
# ROWS (2691727): `_withdraw_pick` detail "outcome=O need=N uses=U verification=V cursor=C err=E chest_room=R plan=P
# srv=name:+d,... bag=a->b deposited=... took=... verb=withdraw_pick|withdraw tried=[...]" (withdrawpick.mjs withdrawRow,
# cut at 300 chars); `_withdraw_settled` "how=settled|released|server_closed|intervention_needed|closed_loaded|junkswapped|
# disconnected|stopped|drain_timeout after_ms=N srv=bag=N carried_local=X ..."; craftsync's `click_refused` /
# `click_dropped` / `click_drop_repair` -- WHICH 2691727 LOGS WITH `event:` NOT `kind:`, so logEvent files them as
# `_undefined` with an empty detail (Claude review 10-05, P2). Counted under both names; `_undefined` is 0 on the
# baseline (positive control below), so on the canary it can only be these rows.
#
#   LIVENESS     canary `_withdraw_pick` rows with verb=withdraw_pick from the canary build (>= 1); control `_withdraw_pick`
#                rows 0 (new kind: arms are mixed otherwise).
#   CORRECTNESS  (each REVERTS; deterministic, judged on any count)
#                G1 items lost: a server-verified row (verification=server) whose srv= shows a FALL of a name not in
#                   plan= (the only names the transfer may give up) -- a dropped or vanished stack.
#                G2 spent tool withdrawn: a row whose took= names a tool and uses= is a number <= 10.
#                G3 unconfirmed success: status=success with verification != server.
#                G4 closed loaded in hold mode: `_withdraw_settled` how=closed_loaded or junkswapped (the canary runs
#                   WITHDRAW_LOADED_MODE=hold; either means the mode switch leaked).
#   REPORTED     intervention_needed rows / bots / longest hold; loaded closes by survival release, server close or
#                disconnect while the cursor held something (owner: an accepted emergency; each named); drain_timeout;
#                click_refused/dropped (+ `_undefined`); took_pick successes whose own snapshot shows no usable pickaxe;
#                a withdrawn pickaxe gone (usable count -> 0) within 10 min outside a death; outcome mix.
#   INSTRUMENT   control bots seen AT TOWN with NO usable pickaxe in the post window (>= 1): the population exists and
#                this query sees it.
#   PRIMARY      share of bot-time with a usable pickaxe, time-weighted (gaps capped at 120 s), DiD vs the same-length
#                pre-window; the same for bot-time AT TOWN without one (the population the order acts on); secondary:
#                confirmed stone_pickaxe crafts per bot-hour DiD. REPORTED, not gated.
import sys, os, json, re, glob
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
TOWN = 48            # composter.mjs TOWN_RADIUS
FLOOR = 10           # toolfor.mjs FLOOR: usable = more than 10 uses left
GAP_CAP = 120.0      # seconds a snapshot may stand for when the next row is late
TOOL = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$')
TIERS = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']     # toolfor.mjs TOOL_TIER
tier_of = lambda name: next((i for i, t in enumerate(TIERS) if str(name or '').startswith(t + '_') or str(name or '') == t), -1)
IRON = TIERS.index('iron')
KV = re.compile(r'(\w+)=(\S*)')


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
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def homes():
    """bot -> (HOME_X, HOME_Z) from the harness env files. ONLY the HOME_ lines are read (the files hold other settings)."""
    out = {}
    for f in glob.glob('/srv/mcbots/harness/env/*.env'):
        x = z = None
        try:
            for line in open(f):
                if line.startswith('HOME_X='):
                    x = float(line.split('=', 1)[1])
                elif line.startswith('HOME_Z='):
                    z = float(line.split('=', 1)[1])
        except (OSError, ValueError):
            continue
        if x is not None and z is not None:
            out[os.path.basename(f)[:-4]] = (x, z)
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(d):
    """`_withdraw_pick` / `_withdraw_settled` detail -> {key: value}. tried=[...] may be cut at 300 chars; never needed."""
    return {k: v for k, v in KV.findall(d or '')}


def deltas(srv):
    """srv=stone:-64,stone_pickaxe:+1 -> {name: delta}; '-' or a non-server source -> {}."""
    out = {}
    for part in (srv or '').split(','):
        m = re.match(r'^([a-z0-9_]+):([+-]\d+)$', part)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def unplanned_loss(f):
    """G1: a server-verified row whose srv= shows a fall of a name the transfer did not plan to give up."""
    if f.get('verification') != 'server':
        return []
    plan = set(n for n in (f.get('plan') or '-').split(',') if n and n != '-')
    return [(n, d) for n, d in deltas(f.get('srv')).items() if d < 0 and n not in plan]


def spent_taken(f):
    """G2: took= names a tool and uses= (remaining at the decision) is a number <= FLOOR."""
    took = [p.split(':')[0] for p in (f.get('took') or '-').split(',') if ':' in p]
    u = f.get('uses')
    return any(TOOL.search(n) for n in took) and u not in (None, '', '-', 'full') and re.match(r'^\d+$', u or '') and int(u) <= FLOOR


def usable_pick(tools):
    return any(e.get('max', 0) - e.get('used', 0) > FLOOR for k, v in (tools or {}).items() if k.endswith('_pickaxe') for e in v)


def args_of(r):
    a = ((r.get('raw') or {}).get('skill') or {}).get('args')
    return a if isinstance(a, dict) and a else None


def g1_args(a):
    """G1 on the withdraw2 ledger: a fall of a name not in plan nor transform -> [(name, delta)]; None = unknown."""
    if not a.get('complete') or not isinstance(a.get('srv'), dict):
        return None
    ok = set(a.get('plan') or []) | set(a.get('transform') or [])
    return [(n, d) for n, d in a['srv'].items() if isinstance(d, (int, float)) and d < 0 and n not in ok]


def g2_args(a):
    u = a.get('took_uses')
    return a.get('took_tier') not in (None, '-', 'none') and isinstance(u, (int, float)) and u <= FLOOR


def g5_args(a):
    return a.get('took_tier') not in (None, '-', 'none') and tier_of(a.get('took_tier')) < tier_of(a.get('best_valid'))


def g6_args(a, outcome):
    """True = a breach; None = unknown (incomplete ledger)."""
    if outcome != 'crafted_iron':
        return False
    if not a.get('complete'):
        return None
    return not (a.get('craft') == 'server' and (a.get('srv') or {}).get('iron_pickaxe', 0) >= 1)


def best_pick_tier(tools):
    return max([tier_of(k) for k, v in (tools or {}).items() if k.endswith('_pickaxe') for e in v if e.get('max', 0) - e.get('used', 0) > FLOOR] or [-1])


_A1 = {'held': 'stone', 'took_tier': 'iron', 'took_uses': 50, 'best_valid': 'iron', 'craft': 'none', 'srv': {'iron_pickaxe': 1}, 'plan': [], 'transform': [], 'complete': True}
assert g1_args(_A1) == [] and not g2_args(_A1) and not g5_args(_A1) and g6_args(_A1, 'took_pick') is False
assert g5_args(dict(_A1, took_tier='stone')) and g2_args(dict(_A1, took_uses=6)) and g1_args(dict(_A1, complete=False)) is None
_A2 = {'craft': 'server', 'srv': {'iron_ingot': -3, 'stick': -2, 'iron_pickaxe': 1}, 'plan': [], 'transform': ['iron_ingot', 'stick'], 'complete': True, 'took_tier': 'iron', 'best_valid': 'none'}
assert g1_args(_A2) == [] and g6_args(_A2, 'crafted_iron') is False and g1_args(dict(_A2, transform=[])) == [('iron_ingot', -3), ('stick', -2)]
assert g6_args(dict(_A2, craft='unverified'), 'crafted_iron') and g6_args(dict(_A2, srv={}), 'crafted_iron') and g6_args(dict(_A2, complete=False), 'crafted_iron') is None
assert tier_of('iron_pickaxe') == IRON and best_pick_tier({'stone_pickaxe': [{'used': 0, 'max': 131}], 'iron_pickaxe': [{'used': 245, 'max': 250}]}) == 2

# POSITIVE CONTROL for the parsers: rows exactly as withdrawpick.mjs withdrawRow writes them (node, 2691727).
_R1 = ('outcome=took_pick need=pickaxe uses=111 verification=server cursor=empty err=- chest_room=0 plan=stone '
       'srv=stone:-64,stone_pickaxe:+1 bag=1280->1217 deposited=stone:64 took=stone_pickaxe:1 verb=withdraw_pick tried=[702,120,700:acted]')
_R2 = ('outcome=took_ingredients need=cobblestone:3,stick:2,planks:4 uses=- verification=server cursor=empty err=- chest_room=24 '
       'plan=- srv=cobblestone:+3,oak_planks:+4,stick:+2 bag=1280->1289 deposited=- took=cobblestone:3,stick:2,oak_planks:4 verb=withdraw_pick tried=[x]')
_f1, _f2 = fields(_R1), fields(_R2)
assert _f1['outcome'] == 'took_pick' and _f1['verb'] == 'withdraw_pick' and _f1['uses'] == '111' and _f1['plan'] == 'stone'
assert deltas(_f1['srv']) == {'stone': -64, 'stone_pickaxe': 1} and unplanned_loss(_f1) == []
assert unplanned_loss(dict(_f1, plan='-')) == [('stone', -64)]                       # the same fall, unplanned: caught
assert unplanned_loss(dict(_f1, verification='after:unanswered', plan='-')) == []    # no server word, no judgement
assert not spent_taken(_f1) and spent_taken(dict(_f1, uses='6')) and not spent_taken(dict(_f2, uses='6'))
assert not spent_taken(dict(_f1, uses='full')) and unplanned_loss(_f2) == []
assert fields('how=intervention_needed after_ms=61234 srv=- carried_local=stone_pickaxe:1 why=x')['how'] == 'intervention_needed'
assert usable_pick({'stone_pickaxe': [{'used': 120, 'max': 131}]}) and not usable_pick({'stone_pickaxe': [{'used': 121, 'max': 131}]})

HOME = homes()
rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  homes %d  |  canary %s  sha %s  cutoff %s  window +%d min'
      % (len(rows), len(HOME), CAN, CV, CUT.strftime('%H:%MZ'), W))
assert len(HOME) >= 40, 'home table not read (%d bots): the at-town split would be blind' % len(HOME)

wp = defaultdict(Counter)            # arm -> outcome counts (canary build only for the canary)
wp_verbs = Counter(); offbuild = 0
g1, g2, g3, g4 = [], [], [], []
g5, g6, unknown = [], [], Counter()   # withdraw2's gates; unknown = canary rows whose ledger is incomplete
canary_args_rows = 0; canary_noargs_rows = 0; ctrl_ledger = 0
tiers_taken = defaultdict(Counter)    # (period, arm) -> tier name of withdrawn pickaxes
iron_crafts = defaultdict(Counter)    # period -> arm -> confirmed iron_pickaxe crafts
crafted_iron = Counter()              # arm -> withdraw2 crafted_iron rows (canary only in practice)
latest_iron = defaultdict(dict)       # period -> bot -> holds iron or better
inst_below = set()
unsettled_unanswered = []
settled = Counter(); interventions = Counter(); hold_max = 0; loaded_closes = []; drains = 0
clicks = defaultdict(Counter)        # arm -> kind -> n
nopick_after_take = []; took_pick_at = defaultdict(list); deaths = defaultdict(list)
time_ = defaultdict(lambda: defaultdict(float))   # (period, arm) -> bucket -> seconds
last_state = {}                      # bot -> (t, period, arm, usable, at_town)
latest = defaultdict(dict)           # period -> bot -> usable (latest snapshot)
inst_bots = set(); expo_bots = set()
crafts = defaultdict(Counter)        # (period) -> arm -> confirmed stone_pickaxe crafts
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); d = r.get('detail') or ''
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if k == '_death':
        deaths[b].append(t)
    # ---- the bot-time accounting (every row with a snapshot; restart-lag rows of another build skipped)
    bt = r.get('bot') or {}
    tools = bt.get('tools'); pos = bt.get('pos')
    if tools is not None and pos and not other:
        u = usable_pick(tools)
        h = HOME.get(b)
        at_town = bool(h) and ((pos.get('x', 0) - h[0]) ** 2 + (pos.get('z', 0) - h[1]) ** 2) ** 0.5 <= TOWN
        p = last_state.get(b)
        if p and p[1] == period:
            gap = min(GAP_CAP, (t - p[0]).total_seconds())
            bucket = time_[(p[1], p[2])]
            bucket['all'] += gap
            bucket['nopick'] += gap * (not p[3])
            bucket['town_nopick'] += gap * (p[4] and not p[3])
        last_state[b] = (t, period, arm, u, at_town)
        latest[period][b] = u
        latest_iron[period][b] = best_pick_tier(tools) >= IRON
        if period == 'post' and arm == 'control' and at_town and 0 <= best_pick_tier(tools) < IRON:
            inst_below.add(b)
        if period == 'post' and at_town and not u:
            (inst_bots if arm == 'control' else expo_bots).add(b)
    if k == '_craft_sync' and not other:
        a = ((r.get('raw') or {}).get('skill') or {}).get('args') or {}
        if a.get('item') == 'stone_pickaxe' and str(a.get('confirmed')) == 'yes':
            crafts[period][arm] += 1
        if a.get('item') == 'iron_pickaxe' and str(a.get('confirmed')) == 'yes':
            iron_crafts[period][arm] += 1
    if k == '_withdraw_pick' and not other:
        f0 = fields(d)
        if f0.get('outcome') == 'took_pick':
            for part in (f0.get('took') or '-').split(','):
                n0 = part.split(':')[0]
                if n0.endswith('_pickaxe'):
                    tiers_taken[(period, arm)][TIERS[tier_of(n0)] if tier_of(n0) >= 0 else '?'] += 1
    if period != 'post':
        continue
    if k in ('_click_refused', '_click_dropped', '_click_drop_repair', '_undefined'):
        clicks[arm][k] += 1
        continue
    if k not in ('_withdraw_pick', '_withdraw_settled'):
        continue
    if other:
        offbuild += 1
        continue
    f = fields(d)
    st = r.get('status') or ((r.get('raw') or {}).get('skill') or {}).get('status')
    if k == '_withdraw_pick':
        wp[arm][f.get('outcome', '?')] += 1
        if arm == 'control' and args_of(r) and 'complete' in args_of(r):
            ctrl_ledger += 1          # ARMS: only the withdraw2 build writes the ledger
        if arm == 'control':
            continue
        wp_verbs[f.get('verb', '?')] += 1
        A = args_of(r) if f.get('verb') == 'withdraw_pick' else None
        if f.get('verb') == 'withdraw_pick':
            if A: canary_args_rows += 1
            elif f.get('outcome') not in ('aborted', 'error'): canary_noargs_rows += 1   # a thrown order's row has no ledger
        if A:
            loss = g1_args(A)
            if loss is None:
                unknown['g1'] += 1
            elif loss:
                g1.append((b, t, loss, d[:120]))
            if g2_args(A) or spent_taken(f):
                g2.append((b, t.strftime('%H:%M:%S'), d[:120]))
            if g5_args(A):
                g5.append((b, t.strftime('%H:%M:%S'), A.get('took_tier'), A.get('best_valid'), d[:100]))
            b6 = g6_args(A, f.get('outcome'))
            if b6 is None:
                unknown['g6'] += 1
            elif b6:
                g6.append((b, t.strftime('%H:%M:%S'), A.get('craft'), (A.get('srv') or {}).get('iron_pickaxe'), d[:100]))
            if f.get('outcome') == 'crafted_iron':
                crafted_iron[arm] += 1
        else:
            loss = unplanned_loss(f)
            if loss:
                g1.append((b, t, loss, d[:120]))
            if spent_taken(f):
                g2.append((b, t.strftime('%H:%M:%S'), d[:120]))
        if f.get('outcome') == 'transfer_unsettled' and 'no_server_evidence' in (f.get('cursor') or ''):
            # SANDBOX 10-05 (kick mid-swap, 2/2): a disconnect while a stack is on the cursor DROPS it on Paper whatever
            # the room (AbstractContainerMenu.removed -> drop when hasDisconnected); the row then reads this, srv=-, and
            # G1 cannot see the loss. Reported (unanswered = possibly a dead connection), with the bag snapshot drop.
            unsettled_unanswered.append((b, t.strftime('%H:%M:%S'), f.get('plan')))
        if st == 'success' and f.get('verification') != 'server':
            g3.append((b, t.strftime('%H:%M:%S'), d[:120]))
        if st == 'success' and f.get('outcome') == 'took_pick':
            took_pick_at[b].append(t)
            if tools is not None and not usable_pick(tools):
                nopick_after_take.append((b, t.strftime('%H:%M:%S')))
    else:
        if arm == 'control':
            wp['control']['settled:' + f.get('how', '?')] += 1
            continue
        how = f.get('how', '?')
        settled[how] += 1
        if how in ('closed_loaded', 'junkswapped'):
            g4.append((b, t.strftime('%H:%M:%S'), d[:120]))
        if how == 'intervention_needed':
            interventions[b] += 1
        if how == 'drain_timeout':
            drains += 1
        if how in ('released', 'server_closed', 'disconnected') and f.get('carried_local', '-') not in ('-', ''):
            loaded_closes.append((b, t.strftime('%H:%M:%S'), how, f.get('carried_local'), f.get('srv'), f.get('why', '')[:40]))
        try:
            hold_max = max(hold_max, int(f.get('after_ms', 0)))
        except ValueError:
            pass

# G1 EXCUSAL: a death within 60 s of the row (a death empties the bag; the gate is about the transfer). Reported.
g1_excused = [x for x in g1 if any(abs((x[1] - dt_).total_seconds()) <= 60 for dt_ in deaths[x[0]])]
g1 = [(b, t.strftime('%H:%M:%S'), loss, d) for (b, t, loss, d) in g1 if (b, t, loss, d) not in g1_excused]

# A withdrawn pickaxe gone within 10 min (usable count -> 0) outside a death: the hold failed, or it was lost.
gone_after_take = []
if took_pick_at:
    for r in rows:
        b = (r.get('bot') or {}).get('name')
        if b not in took_pick_at or r['t'] < CUT:
            continue
        tools = (r.get('bot') or {}).get('tools')
        if tools is None or usable_pick(tools):
            continue
        for tk in took_pick_at[b]:
            dtt = (r['t'] - tk).total_seconds()
            if 5 < dtt <= 600 and not any(0 <= (r['t'] - x).total_seconds() <= 600 and x >= tk for x in deaths[b]):
                gone_after_take.append((b, tk.strftime('%H:%M:%S'), r['t'].strftime('%H:%M:%S')))
                took_pick_at[b] = [x for x in took_pick_at[b] if x != tk]
                break


def share(period, arm, what):
    a = time_[(period, arm)]
    return a[what] / a['all'] if a['all'] else float('nan')


def did(what):
    return (share('post', 'canary', what) - share('pre', 'canary', what)) - (share('post', 'control', what) - share('pre', 'control', what))


def holders(period, arm):
    v = [u for b, u in latest[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return (sum(v) / len(v) if v else float('nan')), len(v)


def craft_rate(period, arm):
    hrs = time_[(period, arm)]['all'] / 3600.0
    return crafts[period][arm] / hrs if hrs else float('nan')


canary_orders = wp_verbs.get('withdraw_pick', 0)
ctrl_new = sum(n for o, n in wp['control'].items())
took = wp['canary'].get('took_pick', 0) + wp['canary'].get('took_ingredients', 0)
nan = lambda x: x != x
print('-' * 78)
print('LIVENESS     canary withdraw_pick orders %d (>= 1; with the withdraw2 ledger %d, WITHOUT %d -- must be 0) | model-verb rows %d | control rows %d (withdraw-01 on the fleet) | other build %d'
      % (canary_orders, canary_args_rows, canary_noargs_rows, wp_verbs.get('withdraw', 0), ctrl_new, offbuild))
print('             canary outcomes %s' % dict(wp['canary']))
print('CORRECTNESS  G1 unplanned server-counted loss %d (excused by a death within 60 s: %d) | G2 spent tool withdrawn %d | G3 success without the server %d | G4 closed loaded in hold mode %d'
      % (len(g1), len(g1_excused), len(g2), len(g3), len(g4)))
print('WITHDRAW2    G5 worse tier taken %d | G6 crafted_iron without a server-confirmed craft %d | ledger UNKNOWN (incomplete) g1 %d g6 %d | crafted_iron rows %d'
      % (len(g5), len(g6), unknown['g1'], unknown['g6'], crafted_iron['canary']))


def tier_share(period, arm):
    c = tiers_taken[(period, arm)]; n = sum(c.values())
    return (sum(v for k2, v in c.items() if tier_of(k2) >= IRON) / n if n else float('nan')), n


def iron_rate(period, arm):
    hrs = time_[(period, arm)]['all'] / 3600.0
    return iron_crafts[period][arm] / hrs if hrs else float('nan')


def iron_holders(period, arm):
    v = [u for b, u in latest_iron[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(v) / len(v) if v else float('nan')


ts = {(p_, a_): tier_share(p_, a_) for p_ in ('pre', 'post') for a_ in ('canary', 'control')}
tier_did = (ts[('post', 'canary')][0] - ts[('pre', 'canary')][0]) - (ts[('post', 'control')][0] - ts[('pre', 'control')][0])
iron_did = (iron_rate('post', 'canary') - iron_rate('pre', 'canary')) - (iron_rate('post', 'control') - iron_rate('pre', 'control'))
ironh_did = (iron_holders('post', 'canary') - iron_holders('pre', 'canary')) - (iron_holders('post', 'control') - iron_holders('pre', 'control'))
print('             withdrawn pickaxes by tier: canary pre %s post %s | control pre %s post %s'
      % (dict(tiers_taken[('pre', 'canary')]), dict(tiers_taken[('post', 'canary')]), dict(tiers_taken[('pre', 'control')]), dict(tiers_taken[('post', 'control')])))
print('             share iron+ of withdrawn: canary %.2f (n %d) -> %.2f (n %d) control %.2f (n %d) -> %.2f (n %d) DiD %+.3f'
      % (ts[('pre', 'canary')][0], ts[('pre', 'canary')][1], ts[('post', 'canary')][0], ts[('post', 'canary')][1],
         ts[('pre', 'control')][0], ts[('pre', 'control')][1], ts[('post', 'control')][0], ts[('post', 'control')][1], tier_did))
print('             confirmed iron_pickaxe crafts/bot-h: canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | bots holding iron+: DiD %+.3f'
      % (iron_rate('pre', 'canary'), iron_rate('post', 'canary'), iron_rate('pre', 'control'), iron_rate('post', 'control'), iron_did, ironh_did))
print('INSTRUMENT2  control bots at town with a usable pickaxe below iron (post) %d (>= 1) | control rows with the withdraw2 ledger %d (must be 0)' % (len(inst_below), ctrl_ledger))
print('REPORTED     _withdraw_settled %s | intervention_needed %d rows on %d bots, longest hold %.0f s | drain_timeout %d'
      % (dict(settled), sum(interventions.values()), len(interventions), hold_max / 1000.0, drains))
print('             loaded closes (survival release / server close / disconnect with a stack on the cursor) %d %s'
      % (len(loaded_closes), loaded_closes[:3]))
print('             transfer_unsettled with an UNANSWERED probe (a disconnect mid-transfer looks like this; the stack may be on the ground) %d %s'
      % (len(unsettled_unanswered), unsettled_unanswered[:3]))
print('             craftsync click rows canary %s control %s (`_undefined` = the event-keyed rows of 2691727)'
      % (dict(clicks['canary']), dict(clicks['control'])))
print('             took_pick success, own snapshot without a usable pickaxe %d | withdrawn pickaxe gone within 10 min outside a death %d %s'
      % (len(nopick_after_take), len(gone_after_take), gone_after_take[:3]))
print('INSTRUMENT   control bots at town with no usable pickaxe (post) %d (>= 1) | canary %d'
      % (len(inst_bots), len(expo_bots)))
print('PRIMARY      bot-time WITHOUT a usable pickaxe: canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
      % (share('pre', 'canary', 'nopick'), share('post', 'canary', 'nopick'), share('pre', 'control', 'nopick'), share('post', 'control', 'nopick'), did('nopick')))
print('             bot-time AT TOWN without one: canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
      % (share('pre', 'canary', 'town_nopick'), share('post', 'canary', 'town_nopick'), share('pre', 'control', 'town_nopick'), share('post', 'control', 'town_nopick'), did('town_nopick')))
hc0, nc0 = holders('pre', 'canary'); hc1, nc1 = holders('post', 'canary'); hk0, nk0 = holders('pre', 'control'); hk1, nk1 = holders('post', 'control')
print('             bots holding a usable pickaxe (latest snapshot): canary %.2f -> %.2f (n %d) control %.2f -> %.2f (n %d) DiD %+.3f'
      % (hc0, hc1, nc1, hk0, hk1, nk1, (hc1 - hc0) - (hk1 - hk0)))
print('             confirmed stone_pickaxe crafts/bot-h: canary %.3f -> %.3f control %.3f -> %.3f'
      % (craft_rate('pre', 'canary'), craft_rate('post', 'canary'), craft_rate('pre', 'control'), craft_rate('post', 'control')))
print('             canary bot-hours %.1f control %.1f (post)' % (time_[('post', 'canary')]['all'] / 3600, time_[('post', 'control')]['all'] / 3600))
for x in (g1 + g2 + g3 + g4 + g5 + g6)[:6]:
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    r3 = lambda x: None if nan(x) else round(x, 4)
    emit('withdrawread', W, {
        'orders_canary': canary_orders, 'verb_rows_canary': wp_verbs.get('withdraw', 0), 'new_rows_control': ctrl_new,
        'offbuild_canary': offbuild, 'took_canary': took,
        'g1_unplanned_loss': len(g1), 'g1_excused_death': len(g1_excused), 'g2_spent_taken': len(g2), 'g3_unconfirmed_success': len(g3), 'g4_closed_loaded': len(g4),
        'intervention_rows': sum(interventions.values()), 'intervention_bots': len(interventions), 'hold_max_s': round(hold_max / 1000.0, 1),
        'loaded_closes': len(loaded_closes), 'unsettled_unanswered': len(unsettled_unanswered), 'drain_timeouts': drains,
        'click_rows_canary': sum(clicks['canary'].values()), 'click_rows_control': sum(clicks['control'].values()),
        'took_pick_no_usable_snapshot': len(nopick_after_take), 'withdrawn_pick_gone': len(gone_after_take),
        'instrument_control': len(inst_bots), 'exposed_canary_bots': len(expo_bots),
        'nopick_time_did': r3(did('nopick')), 'town_nopick_time_did': r3(did('town_nopick')),
        'holders_did': r3((hc1 - hc0) - (hk1 - hk0)),
        'exposure_ready': int(canary_orders >= 5 and len(inst_bots) >= 1),
        'g5_worse_tier': len(g5), 'g6_iron_unconfirmed': len(g6), 'ledger_unknown_g1': unknown['g1'], 'ledger_unknown_g6': unknown['g6'],
        'canary_rows_without_ledger': canary_noargs_rows, 'control_rows_with_ledger': ctrl_ledger, 'crafted_iron_canary': crafted_iron['canary'],
        'iron_share_did': r3(tier_did), 'iron_crafts_per_bot_h_did': r3(iron_did), 'iron_holders_did': r3(ironh_did),
        'instrument_below_iron_control': len(inst_below),
        'exposure2_ready': int(canary_orders >= 5 and len(inst_below) >= 1),
    })
except Exception as e:
    print('emit failed:', e)
