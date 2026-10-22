#!/usr/bin/env python3
# isolated2sharedtrip.py --since <ISO: when the units were stopped> --pools isolated-b[,isolated-a,...] [--pre-hours 24]
# The TRIPWIRE for the owner-direct isolated -> shared-town conversion (docs/reports/isolated-to-shared-2026-10-20.md 4.2).
# READ ONLY. Run on 10.0.0.31:   cd ~/isolated2shared && nice -n 19 python3 isolated2sharedtrip.py --since <ISO> --pools <p>
#
# Full walk of every bot's skill log (live + rotated .gz) over [since - pre, now]. Converted bots are judged; every other bot
# is a comparator: the STILL-ISOLATED pools (same seed and home, old config: a pool with ANY row whose exp.pool is not
# `self-...` in the window is converted or mixed, and leaves the comparators -- Codex r2 P2-10) and the SHARED pools (minus any
# declared canary). One pool per run, with ITS OWN --since (the T0 of its apply-done row), keeps POST free of old-env rows.
#   I1 CONFIG     (BREACH from +15 min) every converted bot has rows after the start, its newest row carries exp.pool=<pool>,
#                 exp.memory_scope=private, exp.arm=town, and it wrote its once-per-spawn licence rows _plinthfirst_mode
#                 (policy=1 shared=1) and _plinth021_mode (shared=1) after the start: the bot code took the new config.
#   I2 WELL       (BREACH) a _plinth stage=planned, or a _well_pit_dug, in a converted pool at a cap that is NOT one the town
#                 had BEFORE the switch -- the caps frozen into the migration marker (MIGRATED.json known_caps), never live
#                 records, which a new plan rewrites before it logs (Codex r2 P1-5). At a known cap it is NAMED. No marker:
#                 BLIND.
#   I3 DEATHS     (BREACH) >= 3 deaths in a converted pool after the start AND its rate > 2x its own PRE rate AND > 2x the
#                 shared pools' rate in the same POST window. Fewer are NAMED with their detail, never a verdict.
#   I4 FURNACE    (BREACH) two different bots of one converted pool inside one furnace's session at once, neither unleased,
#                 counted only from start + 5 min + 240 s (FURNACE_LEASE_TTL_MS: old-env leases cannot be seen across the
#                 switch).
#   I5 EXPOSURE   (BLIND from +120 min if missing) per converted pool: >= 1 _well_dispose success at a known cap, and >= 1
#                 _smelt_job_tally row (the job is on and was considered at town). Before +120 min: EARLY.
#   I6 COBBLE     the fail-closed recount actually closing (Codex r2 P2-9): over the TRAILING 120 min, the pool's *_unknown
#                 _stock_refused rate per bot-hour against max(its own PRE rate, the shared pools' POST rate, 0.2) -- above 3x
#                 with no counted _stock_recount in that tail is not closing: BLIND from +60, BREACH from +180. Unknown
#                 refusals with NO counted recount in the whole POST: the same.
#   I7 DiD        (REPORT ONLY) per bot-hour PRE -> POST, converted vs still-isolated vs shared: deaths, _deposit_new_chest,
#                 town_deposit ok, smelt_town ok, gather ok, and the DiD against each comparator.
# LAST LINE: `TRIPWIRE BREACH <line> <pool> <detail>` (the first breach) | `TRIPWIRE BLIND <why>` | `TRIPWIRE EARLY` (< 180 min,
# nothing wrong yet) | `TRIPWIRE OK` (>= 180 min, every line clean and exposed).
import argparse, datetime as dt, glob, gzip, json, os, re, sys
from collections import Counter, defaultdict

LOGS = '/var/log/mcai'
STATE = '/var/lib/mcai'
MANIFEST = '/srv/mcbots/trial-manifest.json'
GAP_CAP_S = 120
LEASE_TTL_S = 240
KINDS = {'_death', '_plinth', '_well_pit_dug', '_well_dispose', '_furnace_session', '_smelt_job_tally', '_smelt_town', 'smelt_town',
         '_stock_refused', '_stock_recount', '_deposit_new_chest', '_plinthfirst_mode', '_plinth021_mode', 'town_deposit', 'gather'}
KIND_BYTES = [('"name":"%s"' % k).encode() for k in KINDS]
TS_RE = re.compile(rb'"@timestamp":"([^"]+)"')


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_0-9]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def at_of(d):
    """PURE. The `at=x,y,z` of a detail, only when the token is COMPLETE (followed by a space): details are cut at 300 chars,
    and a cut `at=357,74,16` must never read as a cap."""
    m = re.search(r'(?:^| )at=(-?\d+),(-?\d+),(-?\d+) ', d or '')
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def pool_of(bot):
    return (bot or '').rsplit('-', 1)[0]


def ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def overlaps(sessions):
    """PURE. sessions: [(pool, furnace, bot, t0_ms, t1_ms, unleased)] -> overlapping pairs of DIFFERENT bots on one furnace in
    one pool, neither unleased. (smelt jobread's rule WITHOUT its isolated exclusion: converted pools are towns.)"""
    by = defaultdict(list)
    for p, f, b, a, z, u in sessions:
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


def death_breach(n_post, rate_post, rate_pre, rate_ref):
    """PURE. I3: >= 3 deaths AND > 2x own PRE AND > 2x the shared pools' POST (an unmeasured rate never trips: None)."""
    if n_post < 3 or rate_post is None:
        return False
    return (rate_pre is not None and rate_post > 2 * rate_pre) and (rate_ref is not None and rate_post > 2 * rate_ref)


COBBLE_FLOOR = 0.2      # unknown refusals per bot-hour that are never "excess" (isolated-b ran ~0.6/bh before the switch)


def cobble_state(minutes, post_unknown, post_counted, tail_rate, tail_counted, ref_rate):
    """PURE. I6 -> 'ok' | 'watch' | 'breach'. NOT CLOSING = unknown refusals with no counted recount in the whole POST, or a
    trailing-120-min unknown-refusal rate above 3x max(ref_rate, COBBLE_FLOOR) with no counted recount in that tail. A rate
    the instrument could not measure (None) is never 'ok' by default: it is judged on the counts alone."""
    stuck = (post_unknown > 0 and post_counted == 0) or \
        (tail_rate is not None and tail_rate > 3 * max(ref_rate or 0.0, COBBLE_FLOOR) and tail_counted == 0)
    if not stuck:
        return 'ok'
    return 'breach' if minutes >= 180 else 'watch' if minutes >= 60 else 'ok'


def known_caps(pool, state=STATE):
    """The caps the town had BEFORE the switch, as the migration froze them (MIGRATED.json known_caps, 'x,y,z'). None when
    the marker is missing or unreadable: I2 is then BLIND, never judged against live records (a new plan writes its record
    BEFORE it logs stage=planned, skills.mjs, so a live record would let a second well authorize itself)."""
    try:
        caps = json.load(open(os.path.join(state, '_pool-%s' % pool, 'MIGRATED.json'))).get('known_caps')
        return {tuple(int(v) for v in c.split(',')) for c in caps} if isinstance(caps, list) and caps else None
    except Exception:
        return None


def files_since(since):
    day = since.strftime('%Y%m%d')
    for f in sorted(glob.glob('%s/*/skill-*.jsonl*' % LOGS)):
        m = re.search(r'-(\d{8})\.gz$', f)
        if m and m.group(1) < day:
            continue
        yield f


def era_of(t, lo, since, post0, now):
    """PURE. 'pre' = [lo, since), 'post' = [post0, now); the 5 min after the stop (the restart itself) is neither."""
    return 'pre' if lo <= t < since else 'post' if post0 <= t < now else None


def walk(lo, since, post0, now, judged, tail0=None):
    """Every bot's rows from `lo`. -> (sel, exp_h, walked): sel = (bot, t, kind, status, detail, exp) for the selected kinds
    and for every row of a JUDGED bot after `since` (its newest exp is I1's evidence); exp_h = {bot: {era: bot-hours}} by the
    capped-gap estimator (consecutive rows of one file, gaps capped at GAP_CAP_S, a gap counted in the era of both ends)."""
    sel, exp_h, walked = [], defaultdict(Counter), 0
    los = lo.strftime('%Y-%m-%dT%H:%M:%S').encode()
    for f in files_since(lo):
        bot = os.path.basename(os.path.dirname(f))
        try:
            fh = gzip.open(f, 'rb') if f.endswith('.gz') else open(f, 'rb')
        except Exception:
            continue
        prev = None
        with fh:
            for raw in fh:
                walked += 1
                m = TS_RE.search(raw, 0, 80)
                if not m or m.group(1)[:19] < los:
                    continue
                try:
                    t = ts(m.group(1).decode())
                except ValueError:
                    continue
                e = era_of(t, lo, since, post0, now)
                if prev is not None and e is not None and prev[1] == e and t >= prev[0]:
                    g = min((t - prev[0]).total_seconds(), GAP_CAP_S) / 3600.0
                    exp_h[bot][e] += g
                    if e == 'post' and tail0 is not None and prev[0] >= tail0:
                        exp_h[bot]['tail'] += g          # MEASURED trailing exposure (Codex r3 P2-5), never scaled
                prev = (t, e)
                mine = bot in judged and t >= since
                if mine or any(k in raw for k in KIND_BYTES):
                    try:
                        r = json.loads(raw)
                    except Exception:
                        continue
                    sk = r.get('skill') or {}
                    if sk.get('name') in KINDS or mine:
                        sel.append((bot, t, sk.get('name'), sk.get('status'), sk.get('detail') or '', r.get('exp') or {}))
    return sel, exp_h, walked


def exposure(times, a, z):
    """PURE. Summed gaps between consecutive rows inside [a, z), each capped at GAP_CAP_S, in hours."""
    tt = sorted(t for t in times if a <= t < z)
    return sum(min((y - x).total_seconds(), GAP_CAP_S) for x, y in zip(tt, tt[1:])) / 3600.0


# ---- self-tests on the bots' own row strings and on the pure rules ----
assert at_of('slots=36->35 cap_end=closed at=357,74,160 stop=done items=p') == (357, 74, 160)
assert at_of('slots=36->35 cap_end=closed at=357,74,16') is None, 'a detail cut inside at= is not a cap'
assert kv('furnace=399,12,164 lease=1 t0=1792457595767 t1=1792457633636 by=smelt')['t1'] == '1792457633636'
assert kv('phase=mode v=1 policy=1 shared=1 minraise=2 lost=evidence dy=12 w=x')['policy'] == '1'
assert kv('trigger=order refused=4 keys=4 counted=2 tried=3 unknown_after=4')['counted'] == '2'
assert overlaps([('isolated-b', 'f', 'isolated-b-Alpha', 0, 100, False), ('isolated-b', 'f', 'isolated-b-Bravo', 50, 150, False)]) == \
    [(('isolated-b', 'f'), 'isolated-b-Alpha', 'isolated-b-Bravo')], 'POSITIVE CONTROL: an overlapping isolated-b pair is SEEN (smeltjobread skips it)'
assert overlaps([('isolated-b', 'f', 'isolated-b-Alpha', 0, 100, False), ('isolated-b', 'f', 'isolated-b-Bravo', 100, 150, False)]) == [], 'touching'
assert overlaps([('isolated-b', 'f', 'isolated-b-Alpha', 0, 100, True), ('isolated-b', 'f', 'isolated-b-Bravo', 50, 150, False)]) == [], 'unleased'
assert death_breach(3, 0.30, 0.10, 0.10) and not death_breach(2, 0.9, 0.1, 0.1) and not death_breach(3, 0.30, 0.20, 0.10)
assert not death_breach(3, 0.30, None, 0.1), 'an unmeasured PRE never trips'
assert cobble_state(200, 5, 0, 0.1, 0, 0.6) == 'breach' and cobble_state(90, 5, 0, 0.1, 0, 0.6) == 'watch' and cobble_state(30, 5, 0, 0.1, 0, 0.6) == 'ok'
assert cobble_state(200, 0, 0, 0.0, 0, 0.6) == 'ok', 'nothing refused'
assert cobble_state(200, 100, 1, 5.0, 0, 0.6) == 'breach', 'Codex r2 probe: 100 refusals, one early recount, still refusing hard: NOT ok'
assert cobble_state(200, 100, 9, 5.0, 2, 0.6) == 'ok', 'recounting in the tail: closing'
assert cobble_state(200, 100, 9, 1.0, 0, 0.6) == 'ok', 'tail rate within 3x the reference: the pool\'s normal level'
_t0 = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
assert era_of(_t0, _t0, _t0 + dt.timedelta(hours=1), _t0 + dt.timedelta(hours=1, minutes=5), _t0 + dt.timedelta(hours=2)) == 'pre'
assert era_of(_t0 + dt.timedelta(hours=1, minutes=2), _t0, _t0 + dt.timedelta(hours=1), _t0 + dt.timedelta(hours=1, minutes=5), _t0 + dt.timedelta(hours=2)) is None
assert abs(exposure([_t0, _t0 + dt.timedelta(seconds=60), _t0 + dt.timedelta(seconds=600)], _t0, _t0 + dt.timedelta(hours=1)) - 180 / 3600) < 1e-9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True, help='ISO time the units were stopped for the conversion')
    ap.add_argument('--pools', required=True)
    ap.add_argument('--pre-hours', type=float, default=24.0)
    a = ap.parse_args()
    pools = [p.strip() for p in a.pools.split(',') if p.strip()]
    for p in pools:
        if not re.fullmatch(r'isolated-[a-d]', p):
            sys.exit('not a converted pool name: %s' % p)
    since = ts(a.since)
    now = dt.datetime.now(dt.timezone.utc)
    minutes = (now - since).total_seconds() / 60
    post0 = since + dt.timedelta(minutes=5)
    lo = since - dt.timedelta(hours=a.pre_hours)
    try:
        cp = json.load(open(MANIFEST)).get('canary_pool') or ''
    except Exception:
        cp = ''
    canary = {x.strip() for x in str(cp).split(',') if x.strip()}
    judged = set()
    for f in glob.glob('%s/*/' % LOGS):
        b = os.path.basename(f.rstrip('/'))
        if pool_of(b) in pools:
            judged.add(b)
    tail0 = now - dt.timedelta(minutes=120)
    sel, exp_h, walked = walk(lo, since, post0, now, judged, tail0)
    bots = sorted(exp_h)
    conv = {p: [b for b in bots if pool_of(b) == p] for p in pools}
    mixed = {pool_of(b) for b, _t, _k, _s, _d, e in sel if pool_of(b).startswith('isolated') and e.get('pool') and not str(e.get('pool')).startswith('self-')}
    still = sorted({pool_of(b) for b in bots if pool_of(b).startswith('isolated') and pool_of(b) not in pools and pool_of(b) not in mixed})
    shared = sorted({pool_of(b) for b in bots if not pool_of(b).startswith('isolated') and pool_of(b) not in canary and pool_of(b) != 'sandbox'})
    groups = dict({p: [p] for p in pools}, **{'still-isolated': still, 'shared': shared})
    breaches, blind, named = [], [], []

    def breach(line, pool, detail):
        breaches.append('TRIPWIRE BREACH %s %s %s' % (line, pool, detail))

    # exposure per group and era
    EXP = {g: {e: sum(exp_h[b][e] for b in bots if pool_of(b) in pls) for e in ('pre', 'post')} for g, pls in groups.items()}
    cnt = defaultdict(Counter)        # (group, era) -> kind/outcome counts
    newest, lic, sessions = {}, defaultdict(set), []
    planned, pitdug, dispose_ok, tally, unknown_ref, counted_rc, deaths = defaultdict(list), defaultdict(list), Counter(), Counter(), Counter(), Counter(), defaultdict(list)
    caps = {p: known_caps(p) for p in pools}
    unk_t, rc_t = defaultdict(list), defaultdict(list)
    lease_from = since + dt.timedelta(minutes=5, seconds=LEASE_TTL_S)
    for bot, t, k, st, d, exp in sel:
        p = pool_of(bot)
        g = p if p in pools else 'still-isolated' if p in still else 'shared' if p in shared else None
        era = era_of(t, lo, since, post0, now)
        if g and era and k == '_stock_refused' and re.search(r':(cobble|stock)_unknown\b', d):
            cnt[(g, era)]['unknown_refusals'] += 1
        if g and era and k in KINDS:
            if k == '_death':
                cnt[(g, era)]['deaths'] += 1
            elif k == '_deposit_new_chest':
                cnt[(g, era)]['new_chests'] += 1
            elif k in ('town_deposit', 'gather', 'smelt_town') and st == 'success':
                cnt[(g, era)]['%s_ok' % k] += 1
        if p not in pools or t < since:
            continue
        if bot not in newest or t >= newest[bot][0]:
            newest[bot] = (t, exp)
        f = kv(d)
        if k == '_plinthfirst_mode' and f.get('policy') == '1' and f.get('shared') == '1':
            lic[bot].add('plinthfirst')
        elif k == '_plinth021_mode' and f.get('shared') == '1':
            lic[bot].add('plinth021')
        elif k == '_plinth' and f.get('stage') == 'planned':
            planned[p].append((bot, t, at_of(d), f.get('why')))
        elif k == '_well_pit_dug':
            pitdug[p].append((bot, t, at_of(d), f.get('from')))
        elif k == '_well_dispose' and st == 'success' and caps[p] and at_of(d) in caps[p]:
            dispose_ok[p] += 1
        elif k == '_smelt_job_tally':
            tally[p] += 1
        elif k == '_stock_refused' and re.search(r':(cobble|stock)_unknown\b', d):
            if t >= post0:
                unknown_ref[p] += 1; unk_t[p].append(t)
        elif k == '_stock_recount' and (int(f.get('counted', '0') or 0) > 0):
            if t >= post0:
                counted_rc[p] += 1; rc_t[p].append(t)
        elif k == '_death' and t >= post0:
            deaths[p].append((bot, t.strftime('%H:%M'), d[:90]))
        elif k == '_furnace_session' and t >= lease_from:
            try:
                sessions.append((p, f.get('furnace'), bot, int(f['t0']), int(f['t1']), f.get('lease') == 'unleased'))
            except (KeyError, ValueError):
                pass

    print('DENOMINATORS since %s (%.0f min) pre %.0f h | lines walked %d | selected rows %d | bots %d (converted %s; still-isolated %s; shared %d pools%s)' % (
        a.since, minutes, a.pre_hours, walked, len(sel), len(bots), {p: len(v) for p, v in conv.items()}, still, len(shared),
        ', canary %s excluded' % sorted(canary) if canary else ''))
    seen = Counter(k for _, _, k, _, _, _ in sel if k in KINDS)
    print('INSTRUMENT   selected kinds seen fleet-wide in the window (the parsers\' positive control): %s' % dict(sorted(seen.items())))
    if not sel or not bots:
        print('TRIPWIRE BLIND no rows walked (positive control failed)')
        return
    for p in pools:
        # I1
        for b in conv[p]:
            n = newest.get(b)
            e = (n[1] if n else {})
            ok = n and e.get('pool') == p and e.get('memory_scope') == 'private' and e.get('arm') == 'town' and lic[b] >= {'plinthfirst', 'plinth021'}
            print('I1 CONFIG    %-18s newest %s pool=%s scope=%s arm=%s licence=%s' % (b, n[0].strftime('%H:%M:%S') if n else '-', e.get('pool'), e.get('memory_scope'), e.get('arm'), sorted(lic[b]) or '-'))
            if minutes >= 15 and not ok:
                breach('I1', p, '%s did not take the shared config (newest %s, licence %s)' % (b, e or 'none', sorted(lic[b])))
        if len(conv[p]) != 5:
            breach('I1', p, '%d bots on disk, expected 5' % len(conv[p]))
        # I2
        print('I2 WELL      %s known caps (frozen at the switch) %s | planned %d | pit digs %d' % (p, sorted(caps[p]) if caps[p] else 'NONE: no migration marker', len(planned[p]), len(pitdug[p])))
        if not caps[p]:
            blind.append('%s has no migration marker with known_caps: I2 cannot judge a well' % p)
        for bot, t, c, why in (planned[p] + pitdug[p]) if caps[p] else []:
            if c is None or c not in caps[p]:
                breach('I2', p, 'a new well at %s (%s %s %s)' % (c, bot, t.strftime('%H:%M'), why))
            else:
                named.append('NAMED        I2 %s %s at the known cap %s (%s)' % (p, bot, c, why))
        # I3
        ex = EXP[p]
        rp = len(deaths[p]) / ex['post'] if ex['post'] > 0 else None
        rpre = cnt[(p, 'pre')]['deaths'] / ex['pre'] if ex['pre'] > 0 else None
        rref = cnt[('shared', 'post')]['deaths'] / EXP['shared']['post'] if EXP['shared']['post'] > 0 else None
        fmt = lambda x: '-' if x is None else '%.3f' % x
        print('I3 DEATHS    %s post %d in %.1f bot-h (%s/bh) | own pre %d in %.1f (%s) | shared post %s/bh' % (
            p, len(deaths[p]), ex['post'], fmt(rp), cnt[(p, 'pre')]['deaths'], ex['pre'], fmt(rpre), fmt(rref)))
        for bot, hm, d in deaths[p]:
            named.append('NAMED        I3 %s death %s %s %s' % (p, bot, hm, d))
        if death_breach(len(deaths[p]), rp, rpre, rref):
            breach('I3', p, '%d deaths at %s/bh vs own pre %s and shared %s' % (len(deaths[p]), fmt(rp), fmt(rpre), fmt(rref)))
        # I4
        ps = [s for s in sessions if s[0] == p]
        ov = overlaps(ps)
        print('I4 FURNACE   %s sessions parsed %d (unleased %d) from %s | overlapping pairs %d' % (p, len(ps), sum(1 for s in ps if s[5]), lease_from.strftime('%H:%M'), len(ov)))
        for key, b1, b2 in ov:
            breach('I4', p, 'furnace %s held by %s and %s at once' % (key[1], b1, b2))
        # I5
        print('I5 EXPOSURE  %s well disposals at a known cap %d | _smelt_job_tally rows %d' % (p, dispose_ok[p], tally[p]))
        if minutes >= 120 and (dispose_ok[p] == 0 or tally[p] == 0):
            blind.append('%s unexposed (disposals %d, smelt tallies %d)' % (p, dispose_ok[p], tally[p]))
        # I6
        tail_h = sum(exp_h[b]['tail'] for b in conv[p])
        tail_rate = sum(1 for x in unk_t[p] if x >= tail0) / tail_h if tail_h > 0 else None
        refs = [cnt[(p, 'pre')]['unknown_refusals'] / EXP[p]['pre'] if EXP[p]['pre'] > 0 else None,
                cnt[('shared', 'post')]['unknown_refusals'] / EXP['shared']['post'] if EXP['shared']['post'] > 0 else None]
        ref = max([r for r in refs if r is not None], default=None)
        tail_rc = sum(1 for x in rc_t[p] if x >= tail0)
        cs = cobble_state(minutes, unknown_ref[p], counted_rc[p], tail_rate, tail_rc, ref)
        print('I6 COBBLE    %s POST unknown refusals %d, counted recounts %d | trailing 120 min: %s/bh (ref %s/bh = max(own pre, shared post)), counted recounts %d | %s' % (
            p, unknown_ref[p], counted_rc[p], fmt(tail_rate), fmt(ref), tail_rc, cs))
        if cs == 'breach':
            breach('I6', p, '%d unknown refusals and no recount counted anything in %.0f min: the fail-closed start did not close' % (unknown_ref[p], minutes))
        elif cs == 'watch':
            blind.append('%s cobble recount not closed yet (%d unknown refusals, 0 counted recounts)' % (p, unknown_ref[p]))
    # I7
    print('I7 DiD       per bot-hour, PRE -> POST (report only; DiD vs still-isolated | vs shared)')
    for metric in ('deaths', 'new_chests', 'town_deposit_ok', 'smelt_town_ok', 'gather_ok'):
        def r(g, era):
            e = EXP[g][era]
            return cnt[(g, era)][metric] / e if e > 0 else None
        line = []
        for g in groups:
            x, y = r(g, 'pre'), r(g, 'post')
            line.append('%s %s->%s' % (g, '-' if x is None else '%.3f' % x, '-' if y is None else '%.3f' % y))
        dd = []
        for p in pools:
            for ref in ('still-isolated', 'shared'):
                vals = [r(p, 'pre'), r(p, 'post'), r(ref, 'pre'), r(ref, 'post')]
                dd.append('%s-%s %s' % (p, ref, '-' if None in vals else '%+.3f' % ((vals[1] - vals[0]) - (vals[3] - vals[2]))))
        print('  %-16s %s | DiD %s' % (metric, '; '.join(line), ', '.join(dd)))
    print('EXPOSURE     bot-h %s' % {g: {e: round(v, 1) for e, v in x.items()} for g, x in EXP.items()})
    for n in named:
        print(n)
    for b in breaches:
        print(b)
    if breaches:
        print(breaches[0])
    elif blind:
        print('TRIPWIRE BLIND %s' % '; '.join(blind))
    elif minutes < 180:
        print('TRIPWIRE EARLY (%.0f min: nothing wrong yet; OK needs >= 180 min)' % minutes)
    else:
        print('TRIPWIRE OK')


if __name__ == '__main__':
    main()
