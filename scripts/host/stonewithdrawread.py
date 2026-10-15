#!/usr/bin/env python3
# stonewithdrawread.py [window_min] -- the read for canary `stonewithdraw-01` (WITHDRAW BEFORE DIG + goto's dig-retry
# evidence; docs/reports/ziggurat-mineshaft-2026-10-15.md 5.1 and 5.2 step 1). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: an admitted `gather stone|cobblestone|cobbled_deepslate|deepslate` near town (Chebyshev <= 48 of home), at
#   the surface (y >= home.y - 8) or with a zero-edit walk probe to home, not on a stuck trigger, with the town's fresh cobble
#   floor >= count + 64 and no cooling withdraw, is REWRITTEN to `withdraw cobblestone <count>` (cognitive.mjs; pure decision
#   stonesource.mjs). Every decision on a stone gather writes one `_stone_withdraw` row (args: source, reason, count, block,
#   trigger) with the bot's snapshot. `goto_dig_retry` rows gain args (walk_status, walk_visited, walk_len, bag_cobble,
#   retry_digs). The stockpile rung credits a cobble withdrawal.
#
#   LICENCE   kind `_stone_withdraw` (the base cannot write it).
#   GATES     (canary arm, post, only -- the wellread lesson: never a control event)
#             W1 breach_far        a rewrite whose snapshot is > 48 (Chebyshev) from its pool's home
#             W2 breach_stuck      a rewrite on a stuck trigger (entomb|stuck|strand|marooned|drown|low_health|trapped|pit|livelock)
#             W3 breach_deep       a rewrite below home.y - 8 whose reason is not deep_walk_ok
#             W4 breach_fail_share >= 10 rewrites and > 50% of the withdraws they started failed (rewriting into failure)
#             LEAK control `_stone_withdraw` rows post (blocks KEEP; no evidence key)
#   EXPOSURE  >= 10 rewrites in a window >= 150 min.
#   PRIMARY   REPORTED: stone-gather cobble per bot-h within 48 of home, DiD (expected to fall); withdraws of cobble per
#             bot-h DiD; mine cobble per bot-h DiD (neutrality); the decision mix by reason; goto retries by walk_status.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

HOMES = {'board-a': (355, 73, 147), 'board-b': (-249, 65, 144), 'board-c': (355, 73, 147), 'board-d': (355, 73, 147),
         'hive-a': (355, 73, 147), 'hive-b': (355, 73, 147), 'hive-c': (-68, 68, -68), 'hive-d': (68, 65, 68),
         'placebo-a': (249, 75, -144), 'placebo-b': (282, 65, -388), 'placebo-c': (355, 73, 147), 'placebo-d': (177, 75, 73),
         'isolated-a': (355, 73, 147), 'isolated-b': (355, 73, 147), 'isolated-c': (355, 73, 147), 'isolated-d': (355, 73, 147)}
STONE = {'stone', 'cobblestone', 'cobbled_deepslate', 'deepslate'}
COB = ('cobblestone', 'cobbled_deepslate')
STUCK = re.compile(r'entomb|stuck|strand|marooned|drown|low_health|trapped|pit|livelock')
NEAR, SURF = 48, -8


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def args_of(r):
    return (((r.get('raw') or {}).get('skill') or {}).get('args')) or {}


def pos_of(r):
    return ((r.get('raw') or {}).get('bot') or {}).get('pos') or (r.get('bot') or {}).get('pos')


def judge_rewrite(pool, pos, a):
    """PURE. One `_stone_withdraw` row that REWROTE (source=withdraw) -> the list of gates it breaches."""
    out = []
    h = HOMES.get(pool)
    if h is None or not pos:
        return ['unjudgeable']
    if max(abs(pos['x'] - h[0]), abs(pos['z'] - h[2])) > NEAR:
        out.append('far')
    if STUCK.search(str(a.get('trigger') or '')):
        out.append('stuck')
    if pos['y'] - h[1] < SURF and a.get('reason') != 'deep_walk_ok':
        out.append('deep')
    return out


def cobble_delta(r):
    d = (((r.get('raw') or {}).get('skill') or {}).get('inventory_delta')) or {}
    return sum(v for k, v in d.items() if k in COB and isinstance(v, (int, float))) if isinstance(d, dict) else 0


# self-tests (pure)
assert judge_rewrite('board-a', {'x': 360, 'y': 73, 'z': 150}, {'trigger': 'idle', 'reason': 'surface'}) == []
assert judge_rewrite('board-a', {'x': 420, 'y': 73, 'z': 150}, {'trigger': 'idle', 'reason': 'surface'}) == ['far']
assert judge_rewrite('board-a', {'x': 360, 'y': 50, 'z': 150}, {'trigger': 'entombed', 'reason': 'surface'}) == ['stuck', 'deep']
assert judge_rewrite('board-a', {'x': 360, 'y': 50, 'z': 150}, {'trigger': 'idle', 'reason': 'deep_walk_ok'}) == []
assert judge_rewrite('nope', {'x': 0, 'y': 0, 'z': 0}, {}) == ['unjudgeable']

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
    for c in CANS:
        assert c in HOMES, 'canary pool %s has no home in this read' % c
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); nrows = Counter(); offbuild = 0
    n = Counter(); reasons = Counter(); breaches = Counter(); leak = 0
    pending = defaultdict(list)   # bot -> rewrite times awaiting their withdraw row
    wd = Counter(); retry_walk = Counter(); retry_digs = []
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); a = args_of(r)
        if k == 'stone_withdraw':
            if arm == 'control' and period == 'post':
                leak += 1
            if arm != 'canary' or period != 'post':
                continue
            n['licence'] += 1; reasons[(a.get('source'), a.get('reason'))] += 1
            if a.get('source') == 'withdraw':
                n['rewrites'] += 1
                for g in judge_rewrite(pool_of(b), pos_of(r), a):
                    breaches[g] += 1
                pending[b].append(t)
        elif k == 'withdraw':
            item = str(a.get('item') or '')
            if item in COB:
                n[(period, arm, 'withdraw_cobble')] += 1
            if arm == 'canary' and period == 'post' and pending[b]:
                t0 = pending[b][0]
                if t >= t0 and t - t0 <= dt.timedelta(minutes=5) and item in COB:
                    pending[b].pop(0)
                    wd[(((r.get('raw') or {}).get('skill') or {}).get('status')) or '?'] += 1
        elif k == 'gather':
            if str(a.get('block') or '') in STONE:
                h = HOMES.get(pool_of(b)); p = pos_of(r)
                if h and p and max(abs(p['x'] - h[0]), abs(p['z'] - h[2])) <= NEAR:
                    n[(period, arm, 'stone_cobble_near')] += max(0, cobble_delta(r))
                n[(period, arm, 'stone_gathers')] += 1
        elif k == 'mine':
            n[(period, arm, 'mine_cobble')] += max(0, cobble_delta(r))
        elif k == 'goto_dig_retry' and arm == 'canary' and period == 'post':
            retry_walk[str(a.get('walk_status') or 'no_args')] += 1
            if isinstance(a.get('retry_digs'), (int, float)):
                retry_digs.append(a['retry_digs'])

    hours = W / 60.0
    def rate(period, arm, what):
        nb = len(bots[(period, arm)])
        return n[(period, arm, what)] / (nb * hours) if nb and hours else float('nan')
    def did(what):
        return (rate('post', 'canary', what) - rate('pre', 'canary', what)) - (rate('post', 'control', what) - rate('pre', 'control', what))
    started = sum(wd.values())
    fail_share = (wd.get('failed', 0) / started) if started else 0.0
    W4 = int(n['rewrites'] >= 10 and fail_share > 0.5)
    can_bots = len(bots[('post', 'canary')])
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), can_bots,
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     canary _stone_withdraw rows %d (rewrites %d) | decision mix %s' % (n['licence'], n['rewrites'], dict(reasons.most_common(10))))
    print('W1-W3 (gate) rewrites far %d | on a stuck trigger %d | deep without a walk %d | unjudgeable %d'
          % (breaches['far'], breaches['stuck'], breaches['deep'], breaches['unjudgeable']))
    print('W4 (gate)    withdraws started by a rewrite: %d, by status %s (fail share %.0f%%; gate > 50%% with >= 10 rewrites)' % (started, dict(wd), 100 * fail_share))
    print('LEAK         control _stone_withdraw rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   canary goto dig retries by walk_status %s | retry digs median %s' % (dict(retry_walk), sorted(retry_digs)[len(retry_digs) // 2] if retry_digs else '-'))
    for what, label in (('stone_cobble_near', 'stone-gather cobble <=48'), ('withdraw_cobble', 'cobble withdrawals'), ('stone_gathers', 'stone gathers (any)'), ('mine_cobble', 'mine cobble')):
        print('PRIMARY      %-26s per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
              % (label, rate('pre', 'canary', what), rate('post', 'canary', what), rate('pre', 'control', what), rate('post', 'control', what), did(what)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('stonewithdrawread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n['licence'], 'rewrites': n['rewrites'],
            'breach_far': breaches['far'], 'breach_stuck': breaches['stuck'], 'breach_deep': breaches['deep'], 'unjudgeable': breaches['unjudgeable'],
            'breach_fail_share': W4, 'withdraws_started': started, 'withdraws_failed': wd.get('failed', 0),
            'control_stone_rows': leak,
            'stone_cobble_near_did': nanless(did('stone_cobble_near')), 'withdraw_cobble_did': nanless(did('withdraw_cobble')),
            'stone_gathers_did': nanless(did('stone_gathers')), 'mine_cobble_did': nanless(did('mine_cobble')),
            'retry_walk_status': dict(retry_walk),
            'exposure_ready': int(n['rewrites'] >= 10 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
