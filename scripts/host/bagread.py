#!/usr/bin/env python3
# bagread.py [window_min] -- BAG OCCUPANCY, canary vs control, POST vs the same-length PRE: the bag metric a bag-fix
# canary is KEPT on (gate v33 `bag_fix.primary`) at its +1440 read (owner D1 10-08: "the criterion is that a change frees
# usable bag capacity"). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE ESTIMATOR (toolhygieneread's / foodskipread's, restated -- each read is a standalone file the loop copies to /tmp):
# every row of a bot carries its bag (`bot.inventory`, counts by item name); the bag holds from that row until the bot's
# next row, the interval capped at 120 s and split at the cutoff.
#   SLOTS ARE A MINIMUM-STACK PROXY (round 1, Codex): the logs carry counts by name, not slots, so slots = sum over names of
#   ceil(count / stack size) -- the fewest slots that bag could occupy. Two half stacks read as one slot. It is the proxy
#   every bag read here uses, and it is not the sole condition of a KEEP: v33's final also needs exposure, coverage and
#   the value-weighted output DiD.
#   SKILL ROWS ARE RETIMED TO COMPLETION (round 1, Codex): logger.mjs stamps a skill row at its START while runner.mjs
#   snapshots the bag at its END, so a skill row's bag is placed at @timestamp + duration_ms; events (names starting
#   with '_') are instantaneous.
#   A canary POST row written by another build (restart lag) accrues nothing and breaks the chain.
# Fields (each a DiD: (canary POST - PRE) - (control POST - PRE) of time-weighted per-bot values; NEGATIVE = emptier):
#   slots_did, full_share_did (share of bot-time at >= 34 slots), and the per-fix item slots: pick_slots_did (pickaxes),
#   sword_slots_did (swords), cobble_slots_did (cobblestone + cobbled_deepslate), bamboo_slots_did (bamboo).
# Corruption: a complete line that does not parse is counted when its timestamp is in the window OR cannot be read at all
# (round 1, Codex: a NUL-filled line may have no timestamp left); above 0.1% of the window's rows, or on any unreadable
# file, the read emits no primary (INCONCLUSIVE downstream). Memory: one bot at a time, ~40 MB.
import os, sys, re, json, glob, gzip, datetime as dt
from collections import defaultdict

FULL = 34
CAP_S = 120.0
CORRUPT_MAX = 0.001
# DEATH CENSORING (round 2, Claude): the primary is consulted only on the extension path, i.e. on canaries that died MORE;
# a death can empty a bag, and "emptier because it died" must never read as "freed by the fix". Each bot's accrual is
# dropped for CENSOR_S after each of its deaths, in both arms. MEASURED 10-05..10-07 (166 deaths): on these worlds the bag
# was back to 80% within 0.01 h at the 90th percentile and to 100% within 1.02 h at the 90th -- 60 min covers the refill
# where one happens, at ~5% of the exposure (about 1.2 deaths per bot-day).
CENSOR_S = 3600.0


def blind(unreadable, corrupt, nrows):
    """The read's validity rule, shared with the calibration (round 2, Codex): no primary on an unreadable file, on
    corrupt complete lines above CORRUPT_MAX of the window's rows, or on no rows."""
    return bool(unreadable) or not nrows or corrupt / nrows > CORRUPT_MAX
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')
# the per-fix item groups: (field name, predicate on the item name)
GROUPS = (('pick', lambda n: n.endswith('_pickaxe')), ('sword', lambda n: n.endswith('_sword')),
          ('cobble', lambda n: n in ('cobblestone', 'cobbled_deepslate')), ('bamboo', lambda n: n == 'bamboo'))
NV = 3 + len(GROUPS)        # tw vector: [sec, sec at >= FULL, slot-sec, group slot-sec ...]


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def nslots(c, n):
    return c if stack(n) == 1 else -(-c // stack(n))


def slots(inv):
    return sum(nslots(c, n) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0)


def bag_vector(inv):
    """(total slots, group slots ...) of one bag."""
    items = [(n, c) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0]
    return (sum(nslots(c, n) for n, c in items),) + tuple(sum(nslots(c, n) for n, c in items if f(n)) for _g, f in GROUPS)


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def _pieces(a, b, spans):
    """[a, b) minus the censored spans, as a list of (start, end)."""
    out = [(a, b)]
    for c0, c1 in spans:
        nxt = []
        for x, y in out:
            if c1 <= x or c0 >= y:
                nxt.append((x, y)); continue
            if x < c0:
                nxt.append((x, c0))
            if c1 < y:
                nxt.append((c1, y))
        out = nxt
    return out


def accrue(rows, cut, arm, cv, tw, offbuild, end=None, censor=()):
    """PURE (tw/offbuild are the accumulators). rows: one bot's [(t, version, bag_vector or None)] sorted by t.
    tw[(period, arm)] = [sec, sec at >= FULL, slot-sec, group slot-sec ...]. The bag last OBSERVED at inv_t holds from
    each row to the next, never more than CAP_S past the previous row NOR past inv_t + CAP_S (round 2, Codex: bagless
    event rows must not renew a stale bag), never at or after `end`, never inside a `censor` span (a death's refill)."""
    prev_t = None; prev = None; inv_t = None
    for t, ver, bv in rows:
        if end is not None and t > end:
            t = end
        period = 'post' if t >= cut else 'pre'
        if arm == 'canary' and period == 'post' and cv and ver and not ver.startswith(cv):
            offbuild[0] += 1
            prev_t = None; prev = None; inv_t = None
            continue
        if prev_t is not None and prev is not None and t > prev_t:
            stop = min(t, prev_t + dt.timedelta(seconds=CAP_S), inv_t + dt.timedelta(seconds=CAP_S))
            for x, y in (_pieces(prev_t, stop, censor) if stop > prev_t else []):
                parts = [(x, y)] if (y <= cut or x >= cut) else [(x, cut), (cut, y)]
                for px, py in parts:
                    d = (py - px).total_seconds()
                    if d <= 0:
                        continue
                    a = tw[('pre' if px < cut else 'post', arm)]
                    a[0] += d; a[1] += d if prev[0] >= FULL else 0; a[2] += d * prev[0]
                    for i, g in enumerate(prev[1:]):
                        a[3 + i] += d * g
        prev_t = t
        if bv is not None:
            prev = bv; inv_t = t
        if end is not None and t >= end:
            break


def did_of(tw, i, canary='canary', control='control'):
    per = lambda k: tw[k][i] / tw[k][0] if tw[k][0] else float('nan')
    return (per(('post', canary)) - per(('pre', canary))) - (per(('post', control)) - per(('pre', control)))


def new_tw():
    return defaultdict(lambda: [0.0] * NV)


# ---- positive controls of the estimator, asserted at every run --------------------------------------------------------
assert slots({'cobblestone': 65, 'stone_pickaxe': 2, 'egg': 17}) == 2 + 2 + 2
assert bag_vector({'cobblestone': 65, 'stone_pickaxe': 2, 'wooden_sword': 1, 'bamboo': 70}) == (2 + 2 + 1 + 2, 2, 1, 2, 2)
_T = lambda m: dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=m)
_V = lambda n: (n,) + (0,) * len(GROUPS)
_tw = new_tw(); _ob = [0]
accrue([(_T(0), 'abc', _V(40)), (_T(1), 'abc', _V(40)), (_T(2), 'abc', _V(10)), (_T(3), 'abc', _V(10))], _T(2), 'canary', 'abc', _tw, _ob)
accrue([(_T(0), 'base', _V(20)), (_T(1), 'base', _V(20)), (_T(2), 'base', _V(20)), (_T(3), 'base', _V(20))], _T(2), 'control', 'abc', _tw, _ob)
assert abs(did_of(_tw, 2) - (10 - 40)) < 1e-9 and abs(did_of(_tw, 1) - (0 - 1)) < 1e-9, dict(_tw)
_tw2 = new_tw(); _ob2 = [0]
accrue([(_T(0), 'abc', _V(5)), (_T(5), 'abc', _V(5))], _T(9), 'control', 'abc', _tw2, _ob2)
assert _tw2[('pre', 'control')][0] == CAP_S, 'a 5-min silence counts 120 s'
_tw3 = new_tw(); _ob3 = [0]
accrue([(_T(0), 'abc', _V(5)), (_T(1), 'old', _V(50)), (_T(2), 'abc', _V(5)), (_T(3), 'abc', _V(5))], _T(0), 'canary', 'abc', _tw3, _ob3)
assert _ob3[0] == 1 and _tw3[('post', 'canary')][0] == 60.0, 'another build accrues nothing and breaks the chain'
_tw4 = new_tw(); _ob4 = [0]
accrue([(_T(0), 'abc', _V(5))] + [(_T(m), 'abc', None) for m in range(1, 11)], _T(20), 'control', 'abc', _tw4, _ob4)
assert _tw4[('pre', 'control')][0] == CAP_S, 'bagless rows do not renew a stale bag (round 2, Codex)'
_tw5 = new_tw(); _ob5 = [0]
accrue([(_T(m), 'abc', _V(5)) for m in range(0, 61)], _T(100), 'control', 'abc', _tw5, _ob5, censor=[(_T(10), _T(40))])
assert _tw5[('pre', 'control')][0] == 30 * 60, 'a censored death span accrues nothing'

_TS = re.compile(r'"@timestamp":\s*"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)')


def bot_rows(bot, since, until, root='/var/log/mcai'):
    """One bot's [(t_effective, version, bag_vector or None)] in [since, until), sorted; unreadable files; corrupt lines;
    and its deaths from since - CENSOR_S (round 3, Codex: a death just before the window still censors its first minutes)."""
    lo, hi = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    lo_d = (since - dt.timedelta(seconds=CENSOR_S)).strftime('%Y-%m-%dT%H:%M:%S')
    seen = set(); out = []; bad = 0; corrupt = 0; deaths = set()
    for f in sorted(glob.glob(os.path.join(root, bot, 'skill-*.jsonl*'))):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since - dt.timedelta(seconds=CENSOR_S):
                continue
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            bad += 1
            continue
        try:
            with fh:
                for line in fh:
                    m = _TS.search(line[:200])
                    if m and not (lo_d <= m.group(1) < hi):
                        continue
                    try:
                        r = json.loads(line)
                        t = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
                    except Exception:
                        # a COMPLETE line that does not parse, in the window or with no readable timestamp at all
                        # (torn/NUL-filled writes around a crash: 35 lines in 10-06..10-07, the 10-07 outage)
                        if line.endswith('\n') and not (m and m.group(1) < lo):
                            corrupt += 1
                        continue
                    ts19 = r['@timestamp'][:19]
                    if not (lo_d <= ts19 < hi):
                        continue
                    if ts19 < lo:     # before the window: only its deaths matter (they censor into it)
                        if ((r.get('skill') or {}).get('name') or '') == '_death':
                            deaths.add(t)
                        continue
                    sk = r.get('skill') or {}
                    k = (t, sk.get('name'), sk.get('detail'))
                    if k in seen:
                        continue
                    seen.add(k)
                    name = sk.get('name') or ''
                    if name == '_death':
                        deaths.add(t)
                    dur = sk.get('duration_ms')
                    if not name.startswith('_') and isinstance(dur, (int, float)) and 0 < dur < 6 * 3600 * 1000:
                        t = t + dt.timedelta(milliseconds=dur)        # the bag is the skill's END snapshot
                    inv = (r.get('bot') or {}).get('inventory')
                    out.append((t, (r.get('code') or {}).get('version') or '', bag_vector(inv) if isinstance(inv, dict) else None))
        except (OSError, EOFError, ValueError) as e:
            bad += 1
            print('unreadable', f, type(e).__name__)
    out.sort(key=lambda x: x[0])
    return out, bad, corrupt, sorted(deaths)


def censor_spans(deaths):
    return [(d, d + dt.timedelta(seconds=CENSOR_S)) for d in deaths]


FIELDS = (('slots_did', 2), ('full_share_did', 1)) + tuple(('%s_slots_did' % g, 3 + i) for i, (g, _f) in enumerate(GROUPS))

if __name__ == '__main__':
    if '--selftest' in sys.argv:
        print('bagread self-test: the estimator controls above passed'); sys.exit(0)
    LOGROOT = os.environ.get('BAGREAD_LOG_ROOT') or '/var/log/mcai'      # tests only
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
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=W)
    tw = new_tw(); offbuild = [0]; unreadable = 0; corrupt = 0; nrows = 0; nbots = defaultdict(int)
    bots = sorted(d for d in os.listdir(LOGROOT) if not d.startswith('_') and os.path.isdir(os.path.join(LOGROOT, d)))
    for b in bots:
        rows, bad, cor, dts = bot_rows(b, PRE, END, LOGROOT)
        unreadable += bad; corrupt += cor; nrows += len(rows)
        if not rows:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        nbots[arm] += 1
        accrue(rows, CUT, arm, CV, tw, offbuild, END, censor_spans(dts))
    is_blind = blind(unreadable, corrupt, nrows)
    bh = {'%s/%s' % k: round(v[0] / 3600, 1) for k, v in tw.items()}
    per = lambda k, i: tw[k][i] / tw[k][0] if tw[k][0] else float('nan')
    nan = lambda x: None if x != x else round(x, 4)
    print('bagread: canary %s sha %s cutoff %s window +%d min | bots %s | bot-h %s | unreadable files %d | corrupt lines %d of %d rows%s | other-build canary rows %d' % (
        sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W, dict(nbots), bh, unreadable, corrupt, nrows,
        ' (BLIND: no primary emitted)' if is_blind else '', offbuild[0]))
    for f, i in FIELDS:
        print('%-18s canary %.3f -> %.3f control %.3f -> %.3f DiD %+.4f' % (
            f, per(('pre', 'canary'), i), per(('post', 'canary'), i), per(('pre', 'control'), i), per(('post', 'control'), i), did_of(tw, i)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        fields = {f: (None if is_blind else nan(did_of(tw, i))) for f, i in FIELDS}
        fields.update({'canary_bot_h_post': round(tw[('post', 'canary')][0] / 3600, 2), 'control_bot_h_post': round(tw[('post', 'control')][0] / 3600, 2),
                       'offbuild_canary': offbuild[0], 'unreadable': unreadable, 'corrupt_lines': corrupt, 'rows': nrows})
        emit('bagread', W, fields)
    except Exception as e:
        print('emit failed:', e)
