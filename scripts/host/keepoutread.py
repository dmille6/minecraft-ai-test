#!/usr/bin/env python3
# keepoutread.py [window_min] [--selftest] -- the read for canary `keepout-01` (no dig in the column above a live fire death
# site: gather and mine refuse dig candidates there whatever the body's position; `_keepout_exit` takes a body out first).
# Design: docs/reports/comms-design-2026-10-21.md 2.3, 4.6, 8 row 2, 9 C3/C12. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs
# (never emits). Judges the CANARY ARM; the primary is a difference-in-differences against CONTROL TOWNS THAT ALSO HAVE A LIVE
# FIRE SITE (the null must match the drawn stratum); DENOMINATORS FIRST.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the window's file reads, rotation-aware). The SITE HISTORY (5 days of
# `_death_site_recorded` rows, every pool) comes from Elasticsearch (scripts/lib/estelemetry.py, the sanctioned wide-window
# reader; its zero guard is on).
#
# THE SITES, AS PRODUCTION KEEPS THEM. Every `_death_site_recorded` row is one death merged into (or opening) the site whose
# CENTRE it names (`death:fire xN at x,y,z`); the replay applies worldfacts' rule to each centre: +4 per death after the
# whole 12-h halvings since its last death or halving, live while the weight is >= 1. `_keepout_dispute` rows mark a site
# disputed until its next death. Not replayed: the 120-site cap (shared with hazards). So host-side columns are an
# approximation; the DEFECT gates below use the sites the BOT knew (its rows carry them), the primary uses the replay.
#
# THE CHANGE (what only this build writes):
#   _keepout_mode     once per spawn (the licence)
#   _keepout          one-minute counters, only when nonzero: gather_skipped, gather_cooldown, mine_bearing_refused, mine_walkout,
#                     mine_refused, mine_step_refused, mine_cooldown, dig_refused, exit_out, exit_failed, yield_town_job, ...
#   _keepout_exit     one per exit: outcome=out|failed|none method=walk|dig|climb|disputed site= from= to= ms=
#   _keepout_yield    a live column covering a town's home / chests / furnaces (C12): the town named
#   _keepout_dispute  a lava read found a site's disc clear
#   _mine_plan        one per permitted descent near a site: the planned stair cells, in_column (bot-known sites)
#   _mine_dig         one per such descent: the executed stair cells, in_column
# PRIMARY (mechanism check, not a safety outcome; design 8 row 2): `_reach_probe` hit= gather candidates inside a live fire
#   column (replayed) per bot-h, canary vs fire-site control towns, pre vs post. Keep-out removes these by construction, so a
#   fall mostly shows that the code ran.
# DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#   K1 plan_in_column      a canary `_mine_plan` with in_column > 0 (a permitted stair through a column the bot knew). K1's
#                          population is the PLANNING-time decision: a descent planned with no site near writes no plan row,
#                          and a site that joins mid-descent is judged by K2 (its executed digs) and the per-dig stop
#   K2 dig_in_column       a canary `_mine_dig` with in_column > 0 (an executed stair dig in a column the bot knew)
#   K3 repeat_refusals     > 2 keepout-refused gathers of one block by one bot within 10 min (the cooldown failed)
#   K4 exit_loop           > 3 `_keepout_exit` rows by one bot within 10 min that did not get out (the order looped)
#   ARMS rows_control_post control keep-out rows after the deploy
#   LIVENESS               canary licence >= 1
#   INSTRUMENT             `_reach_probe` rows on both arms, and the site history non-empty
# EXPOSURE   canary refused candidates (gather_skipped + mine_bearing_refused + mine_refused + mine_step_refused + dig_refused)
#            >= 20, and >= 1 control town with a live fire site (else the read closes on Paper + the deterministic gates)
# REPORTED   fire deaths inside a live column per arm (tripwire; deaths gate separately), exit outcomes by method, yields by town,
#            disputes, host-side cells of `_mine_plan` / `_mine_dig` in replayed columns.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict

KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
SITE_RE = re.compile(r'^(death:[a-z_]+) x(\d+) at (-?\d+),(-?\d+),(-?\d+)')
HIT = re.compile(r'hit=(-?\d+),(-?\d+),(-?\d+)')
KEEP = ('_keepout_mode', '_keepout', '_keepout_exit', '_keepout_yield', '_keepout_dispute', '_mine_plan', '_mine_dig', '_reach_probe', '_death', 'gather')
RADIUS, HEIGHT, DECAY = 6, 12, 12 * 3600
EXPOSURE_REFUSED = 20
REFUSED_KEYS = ('gather_skipped', 'mine_bearing_refused', 'mine_refused', 'mine_step_refused', 'dig_refused')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def in_column(s, x, y, z):
    return s['y'] <= y <= s['y'] + HEIGHT and (s['x'] - x) ** 2 + (s['z'] - z) ** 2 <= RADIUS * RADIUS


class Sites:
    """Per pool: fire-site histories replayed from `_death_site_recorded` (+ PERSISTED disputes). live(pool, t) -> [site]. Pure.
    WRITE ORDER IS BRACKETED (design 2.3; Codex r2 P2-4): variant A decays the stored weight before each death (the file pruned
    by a write just before it -- resource sightings write every 20 s), variant B adds the death to the stored, undecayed count
    (pruned only by the death writes themselves: worldfacts merges before it prunes). A site is live when EITHER variant says
    so (the primary's exposure is never understated); `disagree` counts judgements where the two differ."""
    def __init__(self, events, disputes=()):
        self.ev = defaultdict(list)          # (pool, key) -> [t]
        for pool, kind, x, y, z, t in sorted(events, key=lambda e: e[5]):
            if kind == 'death:fire':
                self.ev[(pool, (x, y, z))].append(t)
        self.disp = defaultdict(list)        # (pool, key) -> [t]
        for pool, x, y, z, t in disputes:
            self.disp[(pool, (x, y, z))].append(t)

    @staticmethod
    def weight(times, t, variant='A'):
        count, ref = 0, None
        for d in times:
            if d > t:
                break
            if ref is not None and variant == 'A':
                per = int((d - ref) // DECAY) if d > ref else 0
                count //= 2 ** per
            count += 4; ref = d
        if ref is None:
            return 0
        per = int((t - ref) // DECAY) if t > ref else 0
        return count // (2 ** per)
    disagree = 0
    disagree_keys = set()

    def live(self, pool, t):
        out = []
        for (p, key), times in self.ev.items():
            if p != pool:
                continue
            a, b = self.weight(times, t, 'A') >= 1, self.weight(times, t, 'B') >= 1
            if a != b:
                Sites.disagree += 1; Sites.disagree_keys.add((p, key))
            if not (a or b):
                continue
            last_death = max([d for d in times if d <= t], default=None)
            if any(last_death is not None and last_death < q <= t for q in self.disp.get((p, key), [])):
                continue
            out.append({'x': key[0], 'y': key[1], 'z': key[2]})
        return out


def parse_disputes(rows):
    """ES `_keepout_dispute` sources -> [(pool, x, y, z, t)], PERSISTED ones only (stored=1). Pure."""
    out = []
    for r in rows:
        f = kv((r.get('skill') or {}).get('detail'))
        s = f.get('site')
        if f.get('stored') != '1' or not s or s.count(',') != 2:
            continue                       # a dispute the version check refused never cleared the site (Codex r2 P2-4)
        x, y, z = map(int, s.split(','))
        out.append((pool_of((r.get('bot') or {}).get('name')), x, y, z, dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00')).timestamp()))
    return out


def judge(rows, sites, W=180, CANS=(), pools_with_site=None, population=None):
    """rows: dicts {t (epoch), per, arm, name, status, detail, args, bot, fc, pos}. population: {(per, arm): set(bot)} -- EVERY bot
    the walk saw (Codex r2 P2-5: the primary's bot-h use the printed denominator, not only the bots with a selected row). -> fields (pure)."""
    c = Counter()
    probe = Counter(); probe_hits = Counter()
    gather_ref = defaultdict(list); exit_bad = defaultdict(list)
    ctrl_fire_towns = set(); can_fire_towns = set()
    exits = Counter(); yields = Counter(); deaths_in = Counter(); deaths_all = Counter()
    host_plan_in = 0; host_dig_in = 0
    bots = defaultdict(set)
    for k, v in (population or {}).items():
        bots[k] |= set(v)
    malformed = 0; probe_post = Counter(); probe_coord = Counter()
    Sites.disagree = 0; disagree_sites = set()   # per judge call (Claude r3 P3-4)
    for r in rows:
        a, p, n, b, t = r['arm'], r['per'], r['name'], r['bot'], r['t']
        pool = pool_of(b)
        bots[(p, a)].add(b)
        live = sites.live(pool, t)
        if live:
            (can_fire_towns if a == 'canary' else ctrl_fire_towns).add(pool) if p == 'post' else None
        if n == '_reach_probe':
            m = HIT.search(r['detail'] or '')
            if p == 'post':
                probe_post[a] += 1
                probe_coord[a] += 1 if m else 0
            if live or a == 'canary':
                probe[(p, a, pool)] += 1
            if m and live:
                x, y, z = map(int, m.groups())
                if any(in_column(s, x, y, z) for s in live):
                    probe_hits[(p, a, pool)] += 1
        elif n == '_keepout_mode':
            c[('lic', p, a)] += 1
            if kv(r['detail']).get('keepout') == 'on':
                c[('lic_on', p, a)] += 1
        elif n == '_keepout':
            f = kv(r['detail'])
            for k in REFUSED_KEYS:
                try: c[('refused', p, a)] += int(f.get(k, 0))
                except ValueError: pass
            c[('ko_rows', p, a)] += 1
        elif n == '_keepout_exit':
            f = kv(r['detail'])
            c[('exit', p, a)] += 1
            exits[(f.get('outcome', '?'), f.get('method', '?'))] += 1 if a == 'canary' and p == 'post' else 0
            if f.get('outcome') != 'out' and a == 'canary' and p == 'post':
                exit_bad[b].append(t)
        elif n == '_keepout_yield':
            c[('yield', p, a)] += 1
            if a == 'canary' and p == 'post':
                yields[kv(r['detail']).get('pool', pool) + ' ' + kv(r['detail']).get('site', '?')] += 1
        elif n == '_keepout_dispute':
            c[('dispute', p, a)] += 1
        elif n in ('_mine_plan', '_mine_dig'):
            args = r.get('args') or {}
            raw_in = args.get('in_column', kv(r['detail']).get('in_column'))
            try: inc = int(raw_in)
            except (TypeError, ValueError):
                inc = 0
                if a == 'canary' and p == 'post':
                    malformed += 1          # a gate row without its field is never a pass (Codex r2 P2-6)
                c[(n + '_bad', p, a)] += 1
            c[(n, p, a)] += 1
            if inc > 0:
                c[(n + '_in', p, a)] += 1
            cells = [tuple(map(int, q.split(','))) for q in str(args.get('cells') or '').split(';') if q.count(',') == 2]
            hin = sum(1 for (x, y, z) in cells if any(in_column(s, x, y, z) for s in live))
            if a == 'canary' and p == 'post':
                if n == '_mine_plan': host_plan_in += hin
                else: host_dig_in += hin
        elif n == 'gather' and r.get('fc') == 'keepout' and a == 'canary' and p == 'post':
            gather_ref[(b, (r.get('args') or {}).get('block'))].append(t)
        elif n == '_death':
            fc = r.get('fc') or ''
            if p == 'post' and fc == 'fire':
                deaths_all[a] += 1
                pos = r.get('pos')
                if pos and any(in_column(s, math.floor(pos[0]), math.floor(pos[1]), math.floor(pos[2])) for s in live):
                    deaths_in[a] += 1
    out = {}
    def burst(times, span, limit):
        times = sorted(times)
        return any(sum(1 for q in times[i:] if q - t0 < span) > limit for i, t0 in enumerate(times))
    out['plan_in_column'] = c[('_mine_plan_in', 'post', 'canary')]
    out['dig_in_column'] = c[('_mine_dig_in', 'post', 'canary')]
    out['repeat_refusals'] = sum(1 for v in gather_ref.values() if burst(v, 600, 2))
    out['exit_loop'] = sum(1 for v in exit_bad.values() if burst(v, 600, 3))
    out['rows_control_post'] = sum(c[(k, 'post', 'control')] for k in ('lic', 'ko_rows', 'exit', 'yield', 'dispute', '_mine_plan', '_mine_dig'))
    out['licence_canary'] = c[('lic', 'post', 'canary')]
    out['liveness'] = int(c[('lic_on', 'post', 'canary')] >= 1)
    out['mine_rows_malformed'] = malformed
    out['k1_exercised'] = int(c[('_mine_plan', 'post', 'canary')] - c[('_mine_plan_bad', 'post', 'canary')] >= 1)
    out['k2_exercised'] = int(c[('_mine_dig', 'post', 'canary')] - c[('_mine_dig_bad', 'post', 'canary')] >= 1)
    out['refused_canary'] = c[('refused', 'post', 'canary')]
    out['fire_towns_control'] = sorted(ctrl_fire_towns); out['fire_towns_canary'] = sorted(can_fire_towns)
    out['control_fire_towns_n'] = len(ctrl_fire_towns)
    out['exposure_ready'] = int(out['refused_canary'] >= EXPOSURE_REFUSED and out['liveness'] == 1)
    out['did_possible'] = int(len(ctrl_fire_towns) >= 2)
    out['instrument_control'] = int(probe_coord['control'] >= 1 and probe_coord['canary'] >= 1 and len(sites.ev) >= 1)   # coordinates on EACH arm (Codex r3 P2)
    out['replay_variant_disagreements'] = len(Sites.disagree_keys)   # distinct sites the two write orders judged differently
    Sites.disagree_keys = set()
    # PRIMARY: in-column probe hits per bot-h, canary pools vs control pools with a live fire site
    hrs = lambda per, arm, pools: sum(1 for b in bots[(per, arm)] if pool_of(b) in pools) * W / 60
    cpools = set(CANS); kpools = ctrl_fire_towns | {k[2] for k in probe_hits if k[1] == 'control'}
    rate = lambda per, arm, pools: (sum(v for k, v in probe_hits.items() if k[0] == per and k[1] == arm and k[2] in pools) / max(hrs(per, arm, pools), 1e-9)) if hrs(per, arm, pools) else None
    vals = [rate('pre', 'canary', cpools), rate('post', 'canary', cpools), rate('pre', 'control', kpools), rate('post', 'control', kpools)]
    out['probe_in_column_rates'] = vals
    out['probe_in_column_did'] = None if None in vals or not out['did_possible'] else round((vals[1] - vals[0]) - (vals[3] - vals[2]), 4)
    out['probe_hits_canary_post'] = sum(v for k, v in probe_hits.items() if k[0] == 'post' and k[1] == 'canary')
    out['fire_deaths_in_column'] = dict(deaths_in); out['fire_deaths'] = dict(deaths_all)
    out['exits'] = {f'{o}/{m}': v for (o, m), v in exits.items() if v}
    out['yields'] = dict(yields); out['disputes_canary'] = c[('dispute', 'post', 'canary')]
    out['host_plan_cells_in_column'] = host_plan_in; out['host_dig_cells_in_column'] = host_dig_in
    out['mine_plans_canary'] = c[('_mine_plan', 'post', 'canary')]; out['mine_digs_canary'] = c[('_mine_dig', 'post', 'canary')]
    return out


def selftest():
    T0 = 1_760_000_000
    S = Sites([('hive-b', 'death:fire', 336, 38, 154, T0 - 3600), ('hive-c', 'death:fire', 10, 60, 10, T0 - 3600),
               ('hive-d', 'death:fire', 50, 60, 50, T0 - 3600), ('hive-a', 'death:drowning', 0, 60, 0, T0 - 3600)])
    assert S.live('hive-b', T0) and not S.live('hive-a', T0), 'fire only'
    assert S.weight([T0], T0 + 35 * 3600) == 1 and S.weight([T0], T0 + 37 * 3600) == 0, 'one death: 36 h'
    assert S.weight([T0, T0 + 3600], T0 + 45 * 3600) >= 1 and S.weight([T0], T0 + 45 * 3600) == 0, 'two deaths last longer'
    D = Sites([('hive-b', 'death:fire', 336, 38, 154, T0 - 3600)], [('hive-b', 336, 38, 154, T0 - 60)])
    assert D.live('hive-b', T0) == [], 'disputed after its last death'
    D2 = Sites([('hive-b', 'death:fire', 336, 38, 154, T0 - 3600), ('hive-b', 'death:fire', 336, 38, 154, T0 - 30)], [('hive-b', 336, 38, 154, T0 - 60)])
    assert D2.live('hive-b', T0), 'the next death clears the dispute'
    R = lambda name, detail='', bot='hive-b-Alpha', arm='canary', per='post', t=T0, args=None, fc=None, pos=None: {
        't': t, 'per': per, 'arm': arm, 'name': name, 'status': 'success', 'detail': detail, 'args': args or {}, 'bot': bot, 'fc': fc, 'pos': pos}
    LIC = 'phase=mode keepout=on radius=6 height=12 trigger=fire_site_live search=32 cooldown_min=10 town_yield=on'
    base = []
    for per in ('pre', 'post'):
        base += [R('_reach_probe', 'dirt slate=4 status=ok hit=336,43,154', per=per)] * 5 + [R('_reach_probe', 'dirt slate=4 status=ok hit=400,64,154', per=per)] * 5
        base += [R('_reach_probe', 'dirt slate=4 status=ok hit=10,63,10', per=per, arm='control', bot='hive-c-Alpha')] * 5
        base += [R('_reach_probe', 'dirt slate=4 status=ok hit=50,63,50', per=per, arm='control', bot='hive-d-Alpha')] * 5
    live = [R('_keepout_mode', LIC), R('_keepout', 'gather_skipped=15 mine_bearing_refused=6')]
    ok = judge(base + live, S, CANS=('hive-b',))
    for k in ('plan_in_column', 'dig_in_column', 'repeat_refusals', 'exit_loop', 'rows_control_post'):
        assert ok[k] == 0, (k, ok)
    assert ok['liveness'] == 1 and ok['instrument_control'] == 1 and ok['exposure_ready'] == 1 and ok['refused_canary'] == 21, ok
    assert ok['control_fire_towns_n'] == 2 and ok['did_possible'] == 1 and ok['probe_in_column_did'] == 0, ok
    better = judge([r for r in base if not (r['per'] == 'post' and r['arm'] == 'canary' and '336,43' in r['detail'])] + live, S, CANS=('hive-b',))
    assert better['probe_in_column_did'] < 0, ('keep-out removes in-column candidates: the DiD falls', better['probe_in_column_did'])
    assert judge(base + [R('_keepout_mode', LIC), R('_keepout', 'gather_skipped=5')], S, CANS=('hive-b',))['exposure_ready'] == 0, '5 < 20'
    # K1 / K2: the bot's own in_column
    assert judge(base + live + [R('_mine_plan', 'in_column=3', args={'in_column': 3, 'cells': '336,40,154'})], S, CANS=('hive-b',))['plan_in_column'] == 1, 'K1'
    assert judge(base + live + [R('_mine_dig', 'in_column=1', args={'in_column': 1, 'cells': '336,40,154'})], S, CANS=('hive-b',))['dig_in_column'] == 1, 'K2'
    ctl = judge(base + live + [R('_mine_plan', 'in_column=0', args={'in_column': 0, 'cells': '336,40,154;400,60,154'})], S, CANS=('hive-b',))
    assert ctl['plan_in_column'] == 0 and ctl['host_plan_cells_in_column'] == 1, 'host-side cells are reported, not judged'
    # K3: the cooldown
    g = [R('gather', fc='keepout', args={'block': 'dirt'}, t=T0 + i * 60) for i in range(3)]
    assert judge(base + live + g, S, CANS=('hive-b',))['repeat_refusals'] == 1, 'K3: 3 in 10 min'
    assert judge(base + live + g[:2], S, CANS=('hive-b',))['repeat_refusals'] == 0, 'K3 control: 2 is allowed'
    assert judge(base + live + [R('gather', fc='keepout', args={'block': 'dirt'}, t=T0 + i * 700) for i in range(3)], S, CANS=('hive-b',))['repeat_refusals'] == 0, 'spread out: not a burst'
    # K4: the exit loop
    e = [R('_keepout_exit', 'outcome=failed method=none site=336,38,154', t=T0 + i * 60) for i in range(4)]
    assert judge(base + live + e, S, CANS=('hive-b',))['exit_loop'] == 1, 'K4'
    assert judge(base + live + e[:3], S, CANS=('hive-b',))['exit_loop'] == 0, 'K4 control'
    assert judge(base + live + [R('_keepout_exit', 'outcome=out method=walk', t=T0 + i * 60) for i in range(6)], S, CANS=('hive-b',))['exit_loop'] == 0, 'outs are not a loop'
    # ARMS / LIVENESS / INSTRUMENT
    assert judge(base + live + [R('_keepout_mode', LIC, arm='control', bot='hive-c-Alpha')], S, CANS=('hive-b',))['rows_control_post'] == 1, 'ARMS'
    assert judge(base, S, CANS=('hive-b',))['liveness'] == 0
    assert judge([r for r in base if r['arm'] == 'canary'] + live, S, CANS=('hive-b',))['instrument_control'] == 0, 'blind without control'
    assert judge(base + live, Sites([]), CANS=('hive-b',))['instrument_control'] == 0, 'blind without a site history'
    # deaths inside a live column (reported)
    dd = judge(base + live + [R('_death', fc='fire', pos=(336.5, 38.0, 154.5)), R('_death', fc='fire', pos=(500.5, 38.0, 154.5))], S, CANS=('hive-b',))
    assert dd['fire_deaths_in_column'] == {'canary': 1} and dd['fire_deaths'] == {'canary': 2}, dd
    # no second control fire town: no DiD
    one = judge([r for r in base if r['bot'] != 'hive-d-Alpha'] + live, S, CANS=('hive-b',))
    assert one['did_possible'] == 0 and one['probe_in_column_did'] is None, one
    # LIVENESS needs keepout=on; a gate row without in_column is malformed (never a pass); K1/K2 exercised is said
    assert judge(base + [R('_keepout_mode', LIC.replace('keepout=on', 'keepout=off'))], S, CANS=('hive-b',))['liveness'] == 0, 'a licence with keepout=off is not live'
    mal = judge(base + live + [R('_mine_plan', 'cells=3')], S, CANS=('hive-b',))
    assert mal['mine_rows_malformed'] == 1 and mal['k1_exercised'] == 0 and mal['k2_exercised'] == 0, ('malformed only: not exercised', mal)
    assert ok['k1_exercised'] == 0 and ok['k2_exercised'] == 0 and ok['mine_rows_malformed'] == 0, 'no mine row: K1/K2 NOT exercised (said, not passed)'
    po = judge(base + live + [R('_mine_plan', 'in_column=0', args={'in_column': 0, 'cells': '1,1,1'})], S, CANS=('hive-b',))
    assert po['k1_exercised'] == 1 and po['k2_exercised'] == 0, ('a plan alone exercises K1, not K2 (Codex r3 P2)', po)
    pd = judge(base + live + [R('_mine_dig', 'in_column=0', args={'in_column': 0, 'cells': '1,1,1'})], S, CANS=('hive-b',))
    assert pd['k1_exercised'] == 0 and pd['k2_exercised'] == 1, pd
    # INSTRUMENT needs POST probes on both arms with a coordinate
    pre_only = [r for r in base if not (r['name'] == '_reach_probe' and r['per'] == 'post')]
    assert judge(pre_only + live, S, CANS=('hive-b',))['instrument_control'] == 0, 'pre-only probes: blind'
    nocoord = [dict(r, detail=r['detail'].split(' hit=')[0]) if r['name'] == '_reach_probe' else r for r in base]
    assert judge(nocoord + live, S, CANS=('hive-b',))['instrument_control'] == 0, 'no hit= coordinate: blind'
    can_blind = [dict(r, detail=r['detail'].split(' hit=')[0]) if r['name'] == '_reach_probe' and r['arm'] == 'canary' else r for r in base]
    assert judge(can_blind + live, S, CANS=('hive-b',))['instrument_control'] == 0, 'coordinates missing on the canary arm only: still blind (Codex r3 P2)'
    # the denominator: a control bot with no selected row still counts in the primary's bot-h
    popd = judge(base + live, S, CANS=('hive-b',), population={('post', 'control'): {'hive-c-Alpha', 'hive-c-Bravo', 'hive-d-Alpha', 'hive-d-Bravo'}, ('pre', 'control'): {'hive-c-Alpha', 'hive-d-Alpha'}})
    assert popd['probe_in_column_rates'][3] == ok['probe_in_column_rates'][3] / 2, ('two silent control bots halve the post-control rate', popd['probe_in_column_rates'], ok['probe_in_column_rates'])
    # disputes: only persisted ones; write order bracketed
    D3 = parse_disputes([{'@timestamp': '2026-10-22T00:00:00Z', 'bot': {'name': 'hive-b-Alpha'}, 'skill': {'detail': 'site=336,38,154 read=clear stored=0 -- x'}},
                         {'@timestamp': '2026-10-22T00:00:00Z', 'bot': {'name': 'hive-b-Alpha'}, 'skill': {'detail': 'site=336,38,154 read=clear stored=1 -- x'}}])
    assert len(D3) == 1 and D3[0][:4] == ('hive-b', 336, 38, 154), D3
    assert Sites.weight([T0, T0 + 3600], T0 + 45 * 3600, 'B') >= Sites.weight([T0, T0 + 3600], T0 + 45 * 3600, 'A'), 'B never decays the stored count before adding'
    assert Sites.weight([T0, T0 + 30 * 3600], T0 + 40 * 3600, 'A') == 5 and Sites.weight([T0, T0 + 30 * 3600], T0 + 40 * 3600, 'B') == 8, 'the two write orders differ'
    assert pool_of('self-isolated-b-Comet') == 'isolated-b'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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

    # THE SITE HISTORY (ES, 5 days before the window's start to its end)
    sys.path.insert(0, os.path.expanduser('~/estel/scripts'))
    from lib.estelemetry import EsEvents
    ev = EsEvents.load(stream='skill', since=(PRE - dt.timedelta(days=5)).isoformat(), until=END.isoformat(), gaps='clip')
    events, disputes = [], []
    ts = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    for r in ev.rows(kind='_death_site_recorded', fields=['@timestamp', 'bot.name', 'skill.detail'], allow_zero=False):
        m = SITE_RE.match((r.get('skill') or {}).get('detail') or '')
        if m:
            events.append((pool_of((r.get('bot') or {}).get('name')), m.group(1), int(m.group(3)), int(m.group(4)), int(m.group(5)), ts(r['@timestamp'])))
    disputes = parse_disputes(ev.rows(kind='_keepout_dispute', fields=['@timestamp', 'bot.name', 'skill.detail'], allow_zero=True))
    SITES = Sites(events, disputes)
    print('SITE HISTORY %d `_death_site_recorded` rows (%d fire) in 5 days + the window; %d disputes; caveats: %s'
          % (len(events), sum(1 for e in events if e[1] == 'death:fire'), len(disputes), '; '.join(ev.caveats) or '-'))

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
        evw = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in evw.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw = load_window(PRE, END)
    rows, walked, offbuild = [], 0, 0
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        t = r.get('t')
        if not b or t is None:
            continue
        walked += 1
        arm = 'canary' if pool_of(b) in CANS else 'control'
        per = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        sk = ((r.get('raw') or {}).get('skill') or {})
        name = sk.get('name') or r.get('name')
        if name in KEEP:
            pos = ((r.get('raw') or {}).get('bot') or {}).get('pos')
            rows.append({'t': t.timestamp(), 'per': per, 'arm': arm, 'name': name, 'status': sk.get('status'), 'detail': r.get('detail') or '',
                         'args': sk.get('args') or {}, 'bot': b, 'fc': sk.get('fail_class'),
                         'pos': (pos.get('x'), pos.get('y'), pos.get('z')) if isinstance(pos, dict) and pos.get('x') is not None else None})
    res = judge(rows, SITES, W=W, CANS=CANS, population=bots)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0)))
    print('STRATUM      live fire sites in the window: canary towns %s | control towns %s (%d; the DiD needs >= 2, else Paper + the deterministic gates close it)'
          % (res['fire_towns_canary'] or '-', res['fire_towns_control'] or '-', res['control_fire_towns_n']))
    print('PRIMARY      `_reach_probe` hit= candidates in a live fire column per bot-h [canary pre, post, control pre, post] %s -> DiD %s (a MECHANISM check: should FALL); canary post hits %d'
          % (res['probe_in_column_rates'], res['probe_in_column_did'], res['probe_hits_canary_post']))
    print('DEFECTS      K1 permitted plan through a known column %d | K2 executed stair dig in a known column %d | K3 repeated gather refusals at a spot %d | K4 exit loops %d | malformed gate rows %d | ARMS control rows %d'
          % (res['plan_in_column'], res['dig_in_column'], res['repeat_refusals'], res['exit_loop'], res['mine_rows_malformed'], res['rows_control_post']))
    print('LIVENESS     licence %d (keepout=on: %s) | mine plans %d digs %d (K1 exercised: %s, K2: %s; malformed gate rows %d, must be 0) | exits %s | yields (C12: the town named) %s | disputes %d | replay write-order disagreements %d'
          % (res['licence_canary'], 'yes' if res['liveness'] else 'NO', res['mine_plans_canary'], res['mine_digs_canary'], 'yes' if res['k1_exercised'] else 'NOT YET', 'yes' if res['k2_exercised'] else 'NOT YET',
             res['mine_rows_malformed'], res['exits'] or '-', res['yields'] or '-', res['disputes_canary'], res['replay_variant_disagreements']))
    print('REPORTED     host-replayed column cells in canary plans %d / digs %d (the replay is approximate: not judged) | fire deaths in a live column %s of %s'
          % (res['host_plan_cells_in_column'], res['host_dig_cells_in_column'], res['fire_deaths_in_column'] or '-', res['fire_deaths'] or '-'))
    print('EXPOSURE     -> %s (canary refused candidates %d, need %d) | INSTRUMENT -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['refused_canary'], EXPOSURE_REFUSED, 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('keepoutread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
