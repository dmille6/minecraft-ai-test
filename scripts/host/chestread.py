#!/usr/bin/env python3
# chestread.py [window_min] -- the read for canary `chestfull-01` (chest-full recovery, chest-on-1918bb5 @ 6c9a8fb).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: when the town chest is full -- or cannot be opened or reached -- a deposit sweeps the town's containers (with
# a shared memory of each one), then places a CARRIED chest before ever crafting one, under a per-town budget on NEW
# chests (>= 10 min apart, <= 4 per 24 h, <= 12 recovery-made standing), on a safe site (<= 16 from home, >= 3 from the
# composter, no lids, no adjacent chest, no table standing cells), never dropping a lifted stack (verified cursor return),
# on the 180 s watchdog clock. The first walk to a chest is bounded (60 s); a refusal pauses this bot's deposits.
# MOTIVE (10-03, 24 h, 1,970 deposits): 90 blocked by a full chest, 75 of them by bots CARRYING a chest.
# Row `_deposit_new_chest`: "decision=D near_home=B containers=N unknown=N [standing=N today=N] bag=a->b <extras k=v>
# tried=[...]" (Claude r3 field list); `_deposit_cursor_rescue`: one per mineflayer `destination full` throw.
#
# EXPOSURE AFTER THE 10-04 18:07Z BANK CLEAR (measured 10-05 02:20Z, 8.1 h, 80 bots): 1 storage_full deposit fleet-wide
# (isolated-a, never drawn), 13 "first chest full, used another" successes, 62 container_open failures. So a PLACEMENT
# on a 10-bot canary is ~0 per 6 h; what the canary does exercise is the recovery entered by an open/walk failure (a
# sweep, or decision=defer) and the bounded first walk on every deposit. The placement path is proven on Paper (sandbox
# chest-ab.cjs); this read gates DEFECTS deterministically and watches the ordinary deposit.
#
#   LIVENESS     canary-build deposit rows (>= 20: the new deposit code ran); canary `_deposit_new_chest` rows REPORTED.
#   ARMS         control `_deposit_new_chest` + `_deposit_cursor_rescue` rows, and control-pool claim ledgers: 0.
#   CORRECTNESS  C1 a placement with home_d > 16 or composter_d < 3; C2 the town CLAIM LEDGER (the bots' own file, read
#                from /var/lib/mcai/_pool-<pool>): two claims < 10 min apart, > 4 in any rolling 24 h, or > 12 standing;
#                C3 unsettled-transfer EVENTS > 1 (a failed rescue and the deposit row it ends are ONE event); C4 the root
#                cause: decision=craft with more chests in the END snapshot than the decision itself explains. All REVERT.
#   INSTRUMENT   control deposits whose first chest was unusable (storage_full, container_open, container_blocked, or
#                "used another one nearby"): the population the recovery is entered from (~60 / 8 h fleet-wide).
#   PRIMARY      successful deposits per bot-hour DiD (harm watch, REPORTED); storage_full deposits per bot-hour DiD.
#   REPORTED     decision shares (refuse_cap = budget saturating), placements, closures, the old bug's instrument.
#
# MEMORY: the walk streams and keeps only the rows this read uses (deposit, _deposit_new_chest, _deposit_cursor_rescue),
# because the extension reads reach 12 h windows (24 h with the pre-period) and Events.load holds every row.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import open_log

ovr = os.environ.get('CANARY_DRYRUN')
man = {} if ovr else json.load(open('/srv/mcbots/trial-manifest.json'))
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
KV = re.compile(r'(\w+)=([^\s\[]+)')
KEEP = ('deposit', '_deposit_new_chest', '_deposit_cursor_rescue')
POOLDIR = os.environ.get('CHESTREAD_POOLDIR', '/var/lib/mcai')
LOGROOT = os.environ.get('CHESTREAD_LOGROOT', '/var/log/mcai')   # overridable for a replay of sandbox logs


def stream_window(since, until):
    """Rotation-aware (oretunnelread's pattern: day D's rows live in skill-*.jsonl-<D+1>.gz, the live file starts at
    ~23:59Z) and STREAMED: every row in the window is counted (rows, bots per period and arm -- the bot-hour
    denominators and the positive control), but only the KEEP kinds are held. Rows are de-duplicated on
    (timestamp, bot, kind, detail) across the live file and the rotated copy, then SORTED by time."""
    files = sorted(glob.glob(LOGROOT + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        files += sorted(glob.glob(LOGROOT + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked = set(), [], 0
    bots = defaultdict(set)
    for f in files:
        try:
            fh = open_log(f)
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                if not n:
                    continue
                try:
                    t = dt.datetime.fromisoformat(d.get('@timestamp', '').replace('Z', '+00:00'))
                except Exception:
                    continue
                if t < since or t >= until:
                    continue
                b = (d.get('bot') or {}).get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                if b:
                    bots[('post' if t >= CUT else 'pre', 'canary' if pool_of(b) in CANS else 'control')].add(b)
                if n in KEEP:
                    kept.append({'t': t, 'name': n, 'detail': sk.get('detail') or '', 'bot': d.get('bot') or {}, 'raw': d})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(d):
    """key=value tokens before tried=[...] (which may be cut at 300 chars)."""
    return dict(KV.findall((d or '').split(' tried=[')[0]))


def chests_held(inv):
    return (inv.get('chest', 0) or 0) + (inv.get('trapped_chest', 0) or 0)


def c4_breach(f, inv):
    """decision=craft is taken only when NO chest is carried (fullChestNext). The row's snapshot is the END: a chest
    crafted and then not placed (refused on arrival, no time, claim refused, placement failed) is still in the bag, so
    one is explained; with placed=1 none is. More than that means a chest was carried while the recovery crafted one."""
    if f.get('decision') != 'craft':
        return False
    allowed = 1 if ('source' in f and f.get('placed') != '1') else 0
    return chests_held(inv) > allowed


OBS = re.compile(r'^(?P<key>.+)\.c(?P<n>\d+)\.o(?P<at>\d+)-(?P<state>placed|not_placed|gone)-')
CLAIM = re.compile(r'^(?P<key>.+)\.c(?P<n>\d+)\.json$')
RANK = {'placed': 3, 'gone': 2, 'not_placed': 1}


def ledgers(pool):
    """The town CLAIM LEDGER the bots of `pool` write (chestfull.mjs readClaims): key -> [{n, at, state}]."""
    d = os.path.join(POOLDIR, '_pool-%s' % pool)
    try:
        names = os.listdir(d)
    except OSError:
        return {}
    obs = {}
    for f in names:
        m = OBS.match(f)
        if m and f.startswith('town-chest-'):
            k = (m['key'], int(m['n'])); cur = obs.get(k); new = (int(m['at']), RANK[m['state']], m['state'])
            if cur is None or new[:2] > cur[:2]:
                obs[k] = new
    out = defaultdict(list)
    for f in names:
        m = CLAIM.match(f)
        if not (m and f.startswith('town-chest-')):
            continue
        try:
            rec = json.load(open(os.path.join(d, f)))
            at = dt.datetime.fromisoformat(str(rec['at']).replace('Z', '+00:00'))
        except Exception:
            at = None   # malformed: counted, as made now (readClaims fails closed the same way)
        st = obs.get((m['key'], int(m['n'])))
        out[m['key']].append({'n': int(m['n']), 'at': at or now, 'state': st[2] if st else 'unresolved', 'malformed': at is None})
    return out


def c2_breaches(pool):
    """Interval (< 10 min between consecutive claims), day (> 4 in any rolling 24 h) and standing (> 12 placed or
    unresolved) -- each judged only where a claim made after the cutoff is involved. A MALFORMED claim (no readable
    time) is named on its own: the bots count it as made now, which refuses, so it cannot be a second chest."""
    out = []
    for key, cl in ledgers(pool).items():
        bad = [c['n'] for c in cl if c['malformed']]
        if bad:
            print('  note: %s/%s has malformed claim(s) %s (counted as made now by the bots; not judged here)' % (pool, key, bad))
        ts = sorted(c['at'] for c in cl if not c['malformed'])
        for a, b in zip(ts, ts[1:]):
            if b >= CUT and (b - a).total_seconds() < 600:
                out.append('%s: claims %s and %s are %.0f s apart' % (key, a.strftime('%H:%M:%S'), b.strftime('%H:%M:%S'), (b - a).total_seconds()))
        for i, b in enumerate(ts):
            if b < CUT:
                continue
            n = sum(1 for a in ts[:i + 1] if (b - a).total_seconds() < 86400)
            if n > 4:
                out.append('%s: %d claims in the 24 h ending %s' % (key, n, b.strftime('%m-%d %H:%M')))
        standing = sum(1 for c in cl if c['state'] in ('placed', 'unresolved'))
        if standing > 12 and any(c['at'] >= CUT for c in cl):
            out.append('%s: %d standing' % (key, standing))
    return out


def c3_events(failed_rescues, unsettled_rows):
    """C3 counts EVENTS. A failed rescue sets cursorLost and the deposit returns transfer_unsettled, so one stranded
    stack writes a failed `_deposit_cursor_rescue` (logEvent: stamped when it happens) AND a transfer_unsettled `deposit`
    row (logSkill: stamped at the skill's START, duration_ms long). A failed rescue by the same bot inside that deposit's
    span (+-5 s) is the same event; every other failed rescue or unsettled deposit is its own."""
    used = set()
    n = len(failed_rescues)
    for b, t, dur in unsettled_rows:
        m = next((i for i, (b2, t2) in enumerate(failed_rescues)
                  if i not in used and b2 == b and -5 <= (t2 - t).total_seconds() <= dur + 5), None)
        if m is None:
            n += 1
        else:
            used.add(m)
    return n


# POSITIVE CONTROLS for the parsers.
_t0 = dt.datetime(2026, 10, 5, tzinfo=dt.timezone.utc); _s = lambda x: _t0 + dt.timedelta(seconds=x)
assert c3_events([('a', _s(40))], [('a', _s(10), 60.0)]) == 1            # one stranded stack = one event
assert c3_events([('a', _s(40))], [('b', _s(10), 60.0)]) == 2            # another bot's unsettled deposit is its own
assert c3_events([('a', _s(40)), ('a', _s(900))], [('a', _s(10), 60.0)]) == 2
assert c3_events([], [('a', _s(10), 60.0), ('a', _s(500), 60.0)]) == 2
_f = fields('decision=place_carried near_home=true containers=9 unknown=0 standing=1 today=1 bag=500->430 placed=1 at=1,64,2 home_d=7 composter_d=5 tried=[1,64,0:full]')
assert _f['decision'] == 'place_carried' and _f['placed'] == '1' and _f['home_d'] == '7' and _f['bag'] == '500->430'
assert not c4_breach(fields('decision=craft near_home=true containers=2 unknown=0 bag=1->1 source=crafted site=refused_on_arrival tried=[]'), {'chest': 1})
assert c4_breach(fields('decision=craft near_home=true containers=2 unknown=0 bag=1->1 at=1,2,3 placed=1 source=crafted moved=5 tried=[]'), {'chest': 1})
assert c4_breach(fields('decision=craft near_home=true containers=2 unknown=0 bag=1->1 source=crafted site=refused_on_arrival tried=[]'), {'chest': 1, 'trapped_chest': 1})
assert not c4_breach(fields('decision=craft near_home=true containers=2 unknown=0 bag=1->1 site=none tried=[]'), {})
assert c4_breach(fields('decision=craft near_home=true containers=2 unknown=0 bag=1->1 site=none tried=[]'), {'chest': 2})

rows, walked, botsets = stream_window(PRE, END)
print('rows walked %d (kept %d)  |  canary %s  sha %s  cutoff %s  window +%d min' % (walked, len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
print('bots: pre canary %d / control %d, post canary %d / control %d' % tuple(len(botsets[(p, a)]) for p in ('pre', 'post') for a in ('canary', 'control')))
nc = Counter(); resc = Counter(); offbuild = 0; dec = Counter(); c1 = []; placed = defaultdict(int); c4 = []; inst = 0; old_bug = 0
dep = defaultdict(Counter); budget = {}; can_build_deps = 0; unsettled_rows = []; failed_rescues = []
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); d = r.get('detail') or ''
    sk = (r.get('raw') or {}).get('skill') or {}
    st = sk.get('status'); fc = sk.get('fail_class')
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory') or {}
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if other:   # restart lag: a canary bot still on the old build (memory: restart-lag-rows-are-not-canary)
        if k in ('_deposit_new_chest', '_deposit_cursor_rescue', 'deposit'):
            offbuild += 1
        continue
    if k == 'deposit':
        dep[(period, arm)]['all'] += 1
        dep[(period, arm)]['success'] += st == 'success'
        dep[(period, arm)]['storage_full'] += fc == 'storage_full'
        if period == 'post' and arm == 'canary':
            can_build_deps += 1
            if fc == 'transfer_unsettled':
                unsettled_rows.append((b, t, (sk.get('duration_ms') or 0) / 1000))
        if period == 'post' and arm == 'control':
            if fc in ('storage_full', 'container_open', 'container_blocked') or (st == 'success' and 'used another one' in d):
                inst += 1
            if 'could not make another chest' in d and chests_held(inv) > 0:
                old_bug += 1
        continue
    if period != 'post':
        continue
    if k == '_deposit_cursor_rescue':
        resc[(arm, st)] += 1
        if arm == 'canary' and st == 'failed':
            failed_rescues.append((b, t))
        continue
    nc[arm] += 1
    if arm != 'canary':
        continue
    f = fields(d); dec[f.get('decision', '?')] += 1
    if 'standing' in f:
        budget[pool_of(b)] = (f.get('standing'), f.get('today'))
    if f.get('placed') == '1':
        placed[pool_of(b)] += 1
        try:
            if float(f.get('home_d', 0)) > 16 or float(f.get('composter_d', 99)) < 3:
                c1.append((b, d[:140]))
        except ValueError:
            pass
    if c4_breach(f, inv):
        c4.append((b, d[:140], {x: inv.get(x) for x in ('chest', 'trapped_chest') if inv.get(x)}))

c3 = c3_events(failed_rescues, unsettled_rows)

c2 = {p: c2_breaches(p) for p in sorted(CANS)}
c2 = {p: v for p, v in c2.items() if v}
ctrl_ledgers = sorted(p for p in {os.path.basename(x)[6:] for x in glob.glob(os.path.join(POOLDIR, '_pool-*'))}
                      if p not in CANS and any(c['at'] >= CUT for cl in ledgers(p).values() for c in cl))


def per_bh(period, arm, key):
    n = len(botsets[(period, arm)])
    return dep[(period, arm)][key] / (n * W / 60) if n else float('nan')


did = lambda key: (per_bh('post', 'canary', key) - per_bh('pre', 'canary', key)) - (per_bh('post', 'control', key) - per_bh('pre', 'control', key))
tot = sum(dec.values())
arms_bad = nc['control'] + resc[('control', 'success')] + resc[('control', 'failed')] + resc[('control', 'no_effect')] + len(ctrl_ledgers)
print('-' * 78)
print('LIVENESS     canary-build deposit rows %d (>= 20) | canary _deposit_new_chest rows %d | rescues %s | other build %d'
      % (can_build_deps, nc['canary'], dict((s, n) for (a, s), n in resc.items() if a == 'canary') or 0, offbuild))
print('ARMS         control new-chest rows %d, rescue rows %d, control pools with a new claim %s (all must be 0)'
      % (nc['control'], sum(n for (a, s), n in resc.items() if a == 'control'), ctrl_ledgers or 0))
print('CORRECTNESS  C1 placements off-site %d | C2 ledger breaches %s | C3 unsettled-transfer events %d (<= 1) | C4 crafted while carrying a chest %d'
      % (len(c1), c2 or 0, c3, len(c4)))
print('INSTRUMENT   control deposits whose first chest was unusable (full/open/lid/used another): %d (>= 1)' % inst)
print('PRIMARY      successful deposits/bot-h DiD %+.3f (harm watch) | storage_full deposits/bot-h DiD %+.3f'
      % (did('success'), did('storage_full')))
print('             deposits pre/post canary %s / %s, control %s / %s' % tuple(dict(dep[(p, a)]) for a in ('canary', 'control') for p in ('pre', 'post')))
print('REPORTED     decisions %s | refuse_cap share %s | placements by pool %s | budget (standing, today) by pool %s'
      % (dict(dec), ('%.0f%%' % (100 * dec['refuse_cap'] / tot)) if tot else '-', dict(placed) or 0, budget))
print('             the old bug on control ("could not make another chest" while holding one): %d' % old_bug)
for x in (c1 + c4)[:5]:
    print('  breach:', x)
for p, v in c2.items():
    print('  C2 %s: %s' % (p, '; '.join(v[:3])))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    nanless = lambda v: None if v != v else round(v, 3)
    emit('chestread', W, {
        'deposits_canary_build': can_build_deps, 'rows_canary': nc['canary'], 'rows_control': nc['control'], 'offbuild_canary': offbuild,
        'arms_control': arms_bad,
        'c1_offsite': len(c1), 'c2_over_budget': len(c2), 'c3_over_1': int(c3 > 1), 'c3_events': c3, 'c4_craft_while_carrying': len(c4),
        'instrument_control': inst, 'old_bug_control': old_bug,
        'success_did': nanless(did('success')), 'storage_full_did': nanless(did('storage_full')),
        'placements': sum(placed.values()), 'refuse_cap': dec['refuse_cap'], 'defer': dec['defer'], 'decisions': tot,
        'exposure_ready': int(can_build_deps >= 20 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
