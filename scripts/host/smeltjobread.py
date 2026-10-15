#!/usr/bin/env python3
# smeltjobread.py [window_min] -- the read for canary `smeltjob-01` (stage 1 of docs/reports/townprojects-design-2026-10-14.md):
# the deterministic TOWN SMELT JOB (smelt_town), the FURNACE DRAIN (furnace_drain), the FURNACE LEASE every smelt session
# takes, and OWNER D8 (stone_bricks/smooth_stone off the junk list). Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso
# for dry runs (never emits).
#
# ROWS (bots/src/smeltjob.mjs smeltTownDetail / drainDetail; skills.mjs):
#   _smelt_town      one per job: stop= n= bag0= withdrawn= coal= smelted= prior= deposited= bag1= left= furnace= lease=
#                    verdict=ok|loss|gain|unreconciled diff= chest= t0=   (copper-family units, one boundary)
#   _furnace_drain   one per drain: stop= furnace= lease= out= in= fuel= taken= left= t0=
#   _furnace_session one per furnace window (smelt, the job's smelt, the drain): furnace= lease=<n|unleased> t0= t1= by=
#   _smelt_job_skip  why=room|town_has_none|nothing_to_drain (at most one per reason per 10 min per bot)
#   _smelt_job_tally secs= taken= issued= milestone= room= cooldown= ... (every at-town decision, per 10 min per bot)
#   NAMES ARE EXACT (Codex code r1 P1-1): lib.telemetry folds `_x` into `x`, and the runner writes its own `smelt_town`
#   result row beside the skill's `_smelt_town` event -- so every count here keys on raw skill.name.
#
#   LICENCE    kind `_smelt_town` (the base has no such skill and cannot write it).
#   GATES (REVERT, defect)
#     C1 breach_copper: canary _smelt_town rows whose copper balance is broken -- verdict=loss, or verdict=gain NOT
#        explained by the same bot's `_pickups` naming raw_copper/copper_ingot inside the job's [t0, t] -- at least 2 such
#        rows AND more than 5% of the reconciled rows (a single client-view miscount is reported, not a verdict).
#     C2 breach_overlap: two DIFFERENT bots of one canary pool with overlapping `_furnace_session` windows on one furnace,
#        neither unleased (the lease broken).
#     C3 breach_loop: a canary bot with more than 7 smelt_town or 7 furnace_drain rows in any 60 min (the 10 min
#        cooldown broken).
#     LEAK control smelt_town/furnace_drain rows post (arms; BLOCKS KEEP).
#   LIVENESS   canary _smelt_town rows >= 1.
#   CHAIN-DELIVERED (exposure) canary _smelt_town rows with status success, verdict=ok, withdrawn >= 1, smelted >= 1 AND
#              dep_i >= 1 (Codex code r1 P2-7): raw copper OUT of a town chest, ingots made and banked. KEEP needs >= 5.
#              Jobs on the bag's own copper are reported apart.
#   POSITIVE CONTROL  control `smelt` rows >= 1 (the iron rung's own smelt, the instrument that sees smelting) and control
#              `_pickups` rows >= 1 (the instrument C1 uses to explain a gain).
#   PRIMARY (reported) ingots smelted per canary bot-h; deposited copper; skips by reason; drains and items taken;
#              furnace_busy (smelt rows, canary vs control); and the HARM lines, each a DiD vs the same-length PRE:
#              the iron rung's smelt successes per bot-h (the lease touches every smelt -- Claude r3 R7), craft successes,
#              gather successes; smelt_town body seconds per bot-h.
import sys, os, re, json
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

COPPER = ('raw_copper', 'copper_ingot')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(detail):
    """PURE. 'k=v k=v ...' -> {k: v} (values are the raw strings)."""
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


def copper_picked(detail):
    """PURE. A `_pickups` summary 'name n source mode; ... | ...' -> copper-family items in it."""
    n = 0
    for part in (detail or '').split(' | ')[0].split('; '):
        m = re.match(r'^(\S+) (\d+) ', part.strip())
        if m and m.group(1) in COPPER:
            n += int(m.group(2))
    return n


def overlaps(sessions):
    """PURE. sessions: [(pool, furnace, bot, t0_ms, t1_ms, unleased)] -> overlapping pairs of DIFFERENT bots on one
    furnace in one pool, neither unleased (an unleased session ran without the lease: fail-open, reported apart)."""
    by = defaultdict(list)
    for p, f, b, a, z, u in sessions:
        if p.startswith('isolated'):
            continue            # per-bot town state: isolated bots never exclude each other (as on the base)
        by[(p, f)].append((a, z, b, u))
    pairs = []
    for key, lst in by.items():
        lst.sort()
        for i, (a, z, b, u) in enumerate(lst):
            for a2, z2, b2, u2 in lst[i + 1:]:
                if a2 >= z:
                    break
                if b2 != b and not u and not u2:
                    pairs.append((key, b, b2))
    return pairs


def raw_name(r):
    """PURE. The row's EXACT skill.name (lib.telemetry's `name` is canon()-folded: `_smelt_town` == `smelt_town`)."""
    return (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''


def explained(gain, t0, t1, picks, slack=60_000):
    """PURE. Is a copper gain explained by the bot's own copper pickups? `_pickups` is a 60 s SUMMARY (its detail says
    'in 60s'), so a pickup during [t0, t1] can be logged up to 60 s after (Claude code r1 P3-5)."""
    return sum(c for (pt, c) in picks if t0 - slack <= pt <= t1 + slack) >= gain


def window_rate(ts, per_ms=3600_000):
    """PURE. Sorted ms timestamps -> the most rows in any per_ms window."""
    best = 0; j = 0
    for i, t in enumerate(ts):
        while ts[j] < t - per_ms + 1:
            j += 1
        best = max(best, i - j + 1)
    return best


# ---- positive controls on the bot's own row shapes (smeltjob.mjs smeltTownDetail / drainDetail) --------------------------
_r = fields('stop=done n=8 bag0=0 withdrawn=8 coal=1 smelted=8 prior=0 deposited=8 bag1=0 left=0 furnace=12,64,-3 lease=7 verdict=ok diff=0 chest=10,64,-2 t0=1760500000000')
assert _r['verdict'] == 'ok' and num(_r['smelted']) == 8 and num(_r['deposited']) == 8 and _r['furnace'] == '12,64,-3'
assert num('-') is None and fields('') == {}
assert copper_picked('raw_copper 3 gather:x passive; cobblestone 6 mine:y66 passive | 9 items') == 3
assert copper_picked('copper_ingot 2 a b; raw_copper 1 c d') == 3
assert overlaps([('hive-a', 'f', 'hive-a-A', 0, 100, False), ('hive-a', 'f', 'hive-a-B', 50, 150, False)]) == [(('hive-a', 'f'), 'hive-a-A', 'hive-a-B')]
assert overlaps([('hive-a', 'f', 'hive-a-A', 0, 100, False), ('hive-a', 'f', 'hive-a-B', 100, 150, False)]) == [], 'touching is not overlapping'
assert overlaps([('hive-a', 'f', 'hive-a-A', 0, 100, True), ('hive-a', 'f', 'hive-a-B', 50, 150, False)]) == [], 'unleased is reported apart'
assert overlaps([('hive-a', 'f', 'hive-a-A', 0, 100, False), ('hive-a', 'f', 'hive-a-A', 50, 150, False)]) == [], 'one bot'
assert overlaps([('isolated-a', 'f', 'isolated-a-A', 0, 100, False), ('isolated-a', 'f', 'isolated-a-B', 50, 150, False)]) == []
assert raw_name({'name': 'smelt_town', 'raw': {'skill': {'name': '_smelt_town'}}}) == '_smelt_town'
assert raw_name({'name': 'smelt_town', 'raw': {'skill': {'name': 'smelt_town'}}}) == 'smelt_town', 'the runner row is not the event'
assert explained(2, 1000, 5000, [(50_000, 2)]) and not explained(2, 1000, 5000, [(200_000, 2)]) and not explained(3, 0, 1, [(0, 2)])
assert window_rate([0, 10, 20]) == 3 and window_rate([0, 3600_000, 7200_000]) == 1 and window_rate([]) == 0

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
        """Rotation-aware (wellsiteread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
    bots = defaultdict(set); nrows = Counter(); offbuild = 0; noversion = 0
    n = Counter(); jobs = []; drains = []; sessions = []; skips = Counter(); tally = Counter(); leak = 0
    pick = defaultdict(list)          # bot -> [(t_ms, copper items)]
    job_ts = defaultdict(list); drain_ts = defaultdict(list)
    busy = Counter(); body_ms = 0; placed = Counter(); aborts = Counter()
    span = defaultdict(lambda: [None, None])      # (period, arm, bot) -> first/last row time ON THE RIGHT BUILD
    status_of = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('status'))
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        if arm == 'control' and b.startswith('isolated'):
            continue                # the population is SHARED towns (isolated pools: the job is off, never drawn) -- Codex code r2
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1      # a canary row with no build cannot be attributed (Codex code r1 P2-8)
                continue
            if not ver.startswith(CV):
                offbuild += 1       # restart-lag rows on another build are not canary (memory: restart-lag-rows-are-not-canary)
                continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = raw_name(r); d = r.get('detail') or ''; st = status_of(r)
        trig = str(((r.get('raw') or {}).get('trigger')) or '')
        tms = int(t.timestamp() * 1000)
        if k in ('_smelt_town', '_furnace_drain', 'smelt_town', 'furnace_drain'):
            if arm == 'control' and period == 'post':
                leak += 1
            if arm != 'canary' or period != 'post' or not k.startswith('_'):
                continue            # the runner's own result rows are not counted: one job, one row
            f = fields(d)
            if k == '_smelt_town':
                jobs.append((tms, b, st, f)); job_ts[b].append(tms); n['licence'] += 1
                t0 = num(f.get('t0'))
                if t0:
                    body_ms += max(0, tms - t0)
            else:
                drains.append((tms, b, st, f)); drain_ts[b].append(tms)
        elif k == '_furnace_session':
            if arm == 'canary' and period == 'post':
                f = fields(d)
                a0, a1 = num(f.get('t0')), num(f.get('t1'))
                if a0 and a1:
                    sessions.append((pool_of(b) if not b.startswith('isolated') else b, f.get('furnace'), b, a0, a1, f.get('lease') == 'unleased'))
        elif k == '_smelt_job_skip':
            if arm == 'canary' and period == 'post':
                skips[fields(d).get('why')] += 1
        elif k == '_smelt_job_tally':
            if arm == 'canary' and period == 'post':
                for kk, v in fields(d).items():
                    if kk != 'secs':
                        tally[kk] += num(v) or 0
        elif k == '_pickups':
            c = copper_picked(d)
            if c:
                pick[b].append((tms, c))
            n[(period, arm, 'pickups')] += 1
        elif k == 'smelt':
            n[(period, arm, 'smelt')] += 1
            if st == 'success':
                n[(period, arm, 'smelt_ok')] += 1
            if 'in use by another bot' in d:
                busy[(period, arm)] += 1
            if 'placed the furnace first' in d:
                placed[(period, arm)] += 1
            if st == 'aborted' and ('stuck' in trig or 'stagnation' in trig):
                n[(period, arm, 'smelt_cut')] += 1      # the stationary window's own effect (Claude code r1)
        elif k == 'craft' and st == 'success':
            n[(period, arm, 'craft_ok')] += 1
            if 'furnace' in d:
                placed[(period, arm, 'crafted')] += 1
        elif k == 'gather' and st == 'success':
            n[(period, arm, 'gather_ok')] += 1

    hours = W / 60.0
    # MEASURED bot-hours (Codex code r1 P2-8): each bot's first..last row on the right build, not the whole window
    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)
    def rate(period, arm, what):
        bh = bot_hours(period, arm)
        return n[(period, arm, what)] / bh if bh else float('nan')
    def did(what):
        return (rate('post', 'canary', what) - rate('pre', 'canary', what)) - (rate('post', 'control', what) - rate('pre', 'control', what))

    # C1: the copper balance, a gain explained by the job's own window of copper pickups
    verdicts = Counter(); bad = []
    for tms, b, st, f in jobs:
        v = f.get('verdict')
        if v == 'gain' and explained(num(f.get('diff')) or 0, num(f.get('t0')) or tms, tms, pick[b]):
            v = 'ok_pickup'
        verdicts[v] += 1
        if v in ('loss', 'gain'):
            bad.append((b, f.get('verdict'), f.get('diff'), f.get('stop')))
    reconciled = sum(c for v, c in verdicts.items() if v in ('ok', 'ok_pickup', 'loss', 'gain'))
    breach_copper = int(len(bad) >= 2 and reconciled and len(bad) / reconciled > 0.05)
    pairs = overlaps(sessions)
    loop_bots = sorted({b for b, ts in job_ts.items() if window_rate(sorted(ts)) > 7} | {b for b, ts in drain_ts.items() if window_rate(sorted(ts)) > 7})
    ok_job = lambda f: f.get('verdict') == 'ok' and (num(f.get('smelted')) or 0) >= 1 and (num(f.get('dep_i')) or 0) >= 1
    delivered = [j for j in jobs if j[2] == 'success' and ok_job(j[3]) and (num(j[3].get('withdrawn')) or 0) >= 1]
    carried_jobs = [j for j in jobs if j[2] == 'success' and ok_job(j[3]) and not (num(j[3].get('withdrawn')) or 0)]
    smelted = sum(num(f.get('smelted')) or 0 for _, _, _, f in jobs)
    deposited = sum(num(f.get('deposited')) or 0 for _, _, _, f in jobs)
    stops = Counter(f.get('stop') for _, _, _, f in jobs)
    dstops = Counter(f.get('stop') for _, _, _, f in drains)
    taken = sum(num(f.get('taken')) or 0 for _, _, _, f in drains)
    unleased = sum(1 for s in sessions if s[5])
    can_bots = len(bots[('post', 'canary')])
    can_bh = bot_hours('post', 'canary')
    town_dec = sum(v for k, v in tally.items() if not k.startswith('+'))      # '+' counters are extras, not decisions
    ctl_smelt = n[('post', 'control', 'smelt')]; ctl_pick = n[('post', 'control', 'pickups')]

    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h measured %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), can_bots,
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary _smelt_town rows %d (stops %s) | _furnace_drain rows %d (stops %s)' % (n['licence'], dict(stops), len(drains), dict(dstops)))
    print('CHAIN        delivered (success, verdict=ok, withdrawn>=1, smelted>=1, dep_i>=1): %d  (KEEP needs >= 5) | on the bag\'s own copper %d | ingots smelted %d, copper banked %d'
          % (len(delivered), len(carried_jobs), smelted, deposited))
    print('DENOMINATOR  at-town decisions tallied %d: %s | free share (reached the job) %s | room-blocked (copper not checked yet) %d | drains issued %d'
          % (town_dec, dict(tally.most_common(10)), '-' if not town_dec else '%.1f%%' % (100.0 * (town_dec - tally.get('taken', 0)) / town_dec), tally.get('room', 0), tally.get('+drain_issued', 0)))
    print('C1 (gate)    copper balance verdicts %s | broken rows %d of %d reconciled %s' % (dict(verdicts), len(bad), reconciled, bad[:4]))
    print('C2 (gate)    overlapping furnace sessions of different bots (leased): %d %s | unleased sessions %d of %d'
          % (len(pairs), pairs[:3], unleased, len(sessions)))
    print('C3 (gate)    bots over 7 job rows in any 60 min: %d %s' % (len(loop_bots), loop_bots[:5]))
    print('LEAK         control smelt_town/furnace_drain rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control smelt rows post %d | control _pickups rows post %d' % (ctl_smelt, ctl_pick))
    print('PRIMARY      ingots per canary bot-h %.3f | skips %s | drain items taken %d | furnace_busy smelt rows canary %d control %d'
          % (smelted / can_bh if can_bh else float('nan'), dict(skips), taken, busy[('post', 'canary')], busy[('post', 'control')]))
    print('             smelt_town body seconds per canary bot-h %.1f | furnace placements (smelt placed / crafted) canary %d/%d control %d/%d'
          % ((body_ms / 1000) / can_bh if can_bh else float('nan'), placed[('post', 'canary')], placed[('post', 'canary', 'crafted')], placed[('post', 'control')], placed[('post', 'control', 'crafted')]))
    for what, label in (('smelt_ok', 'smelt successes (the iron rung: lease + window)'), ('smelt_cut', 'smelts cut by stuck/stagnation'), ('craft_ok', 'craft successes'), ('gather_ok', 'gather successes')):
        print('HARM         %-32s per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
              % (label, rate('pre', 'canary', what), rate('post', 'canary', what), rate('pre', 'control', what), rate('post', 'control', what), did(what)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('smeltjobread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n['licence'], 'smelt_live': n['licence'], 'chain_delivered': len(delivered),
            'ingots_smelted': smelted, 'copper_banked': deposited, 'drains': len(drains), 'drain_taken': taken,
            'breach_copper': breach_copper, 'copper_broken_rows': len(bad), 'copper_reconciled_rows': reconciled,
            'unreconciled_rows': verdicts.get('unreconciled', 0),
            'breach_overlap': len(pairs), 'unleased_sessions': unleased, 'breach_loop': len(loop_bots),
            'control_job_rows': leak, 'instrument_control': int(ctl_smelt >= 1 and ctl_pick >= 1),
            'smelt_ok_did': nanless(did('smelt_ok')), 'craft_ok_did': nanless(did('craft_ok')), 'gather_ok_did': nanless(did('gather_ok')),
            'furnace_busy_canary': busy[('post', 'canary')],
            'carried_jobs': len(carried_jobs), 'town_decisions': town_dec, 'room_blocked_decisions': tally.get('room', 0),
            'canary_bot_hours': round(can_bh, 2), 'noversion_canary': noversion, 'smelt_cut_did': nanless(did('smelt_cut')),
            'exposure_ready': int(len(delivered) >= 5 and ctl_smelt >= 1 and ctl_pick >= 1),
        })
    except Exception as e:
        print('emit failed:', e)
