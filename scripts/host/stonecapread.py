#!/usr/bin/env python3
# stonecapread.py [window_min] -- the read for canary `stonecap-01` (THE COBBLE RULE; branches sc-on-c6e91a8 / sc-on-92bc84f).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/bankable.mjs cobbleBankStacks; docs/reports/cobble-rule-design-2026-10-07.md): cobblestone and
# cobbled_deepslate are banked ONLY as whole stacks (each empties a bag slot), smallest first, and only while the bag keeps
# 64 of the two together. The model's deposit moves each chosen stack with mineflayer's own transfer() narrowed to its slot,
# never a stack the container cannot take whole, and after the close writes one row per name from the SERVER's bag:
#   _cobble_bank  "name=<n> planned=<count> tried=<stacks attempted, a,b|-> moved=<the window gained, capped per stack>
#                  before=<cobble+deepslate at plan time> kept=<cobble+deepslate the bag keeps, server recount>
#                  src=<server|none|unanswered...> reserve=64 no_room=<stacks not started>"
#   LIMITATION (both reviews, accepted for a monitored canary): moved is the client window's gain and tried= is intent; the
#   server-backed whole-stack check is before - (moved over the run's rows) = kept on src=server rows -- a TRIPWIRE (a pickup
#   during the window can add a few), named per bot. Rows by src are counted (on Paper the recount after transfer clicks is
#   usually src=skipped -- the client bag, which matched the server in the sandbox; C1 judges every src).
# A deposit whose only unplaced items were cobble ends no_effect "cobble never opens a new chest" (no recovery, no chest).
# The town deposit (92bc84f variant only) reads the same allowance; its rows are _town_deposit ("... banked a:n,... ...").
#
#   LIVENESS     canary _cobble_bank rows from the canary build (>= 1); control 0 (the base cannot write it).
#   CORRECTNESS  (each judged; any breach REVERTS)
#                C1 THE RESERVE: a _cobble_bank row that moved cobble and says kept < 64, WHATEVER its src: the Paper
#                   sandbox (10-07) showed craftsync's recount SKIPPED after real transfer clicks (src=skipped; the client
#                   bag, which matched the server's read-back), so a server-only gate would be blind on exactly the moves.
#                C2 WHOLE STACKS: a _cobble_bank row whose moved > planned, or whose moved is not a sum of its tried= stacks
#                   (a partial transfer: only a race with another depositor can make one -- the room is checked first).
#   C4 (TRIPWIRE, named, not gated): a canary _deposit_new_chest within 4 min after a _cobble_bank no_room with moved=0 --
#                cobble must never open a chest, but a MIXED deposit (logs unplaced too) legitimately recovers for the logs.
#                C3 THE TOWN DEPOSIT (92bc84f): a canary _town_deposit row that banked cobble whose END snapshot holds < 64
#                   cobble + deepslate while the row's own banked cobble was > 0 (the snapshot is the run's END).
#   TRIPWIRES    canary deposit runs that lowered cobble and ENDED under 64 (scaffold placed on the walk can do it;
#                compared with the control's rate, which is the behaviour this removes); no_room rows.
#   INSTRUMENT   control deposit runs that lowered the bot's cobble (>= 1; 299 in 30 h fleet-wide on 10-07).
#   EXPOSURE     >= 20 canary deposit runs by bots holding cobble (the rule is evaluated on every one; measured 10-07 20:30Z:
#                10 per 10 bots per 3 h, so ~12 h for a 5-bot pool) AND the instrument AND >= 1 canary town journal.
#   PRIMARY      cobble banked per bot-hour DiD (deposit + town deposit runs, previous snapshot vs the row's END snapshot);
#                REPORTED: share of bots at >= 34 slots DiD (a rise = the 64 reserve costs bag space), cobble slots per bot
#                DiD, deposit no_effect share DiD, runs ending under 64 per arm.
#
# THE TOWN CAP (owner 10-07 via operator + Codex; bots/src/cobblecap.mjs): 256 cobble + deepslate per town, counted from
# reconciled container counts in an append-only journal per town (/var/lib/mcai/_pool-<pool>/<townKey>.cobble.jsonl), each
# whole stack admitted by a claim the journal's fold decides. The _cobble_bank row adds town_before= town_after= complete=
# at_cap= unknown= outside= unknown_keys=; _cobble_reconcile "counted=N of T tried (max 3)"; the 92bc84f town deposit's
# _town_deposit row carries " cobble_cap a/u/o" when the cap refused a stack.
#   C5 TOWN OVERSHOOT, two independent ways (each REVERTS):
#      (row)     a canary _cobble_bank row that moved cobble with complete=1 and town_after > 256
#      (journal) a canary claim the fold ADMITTED whose release-time town total -- the latest count of every container the
#                claimant's scan named, the claimant's own post-transfer count included -- exceeds 256. Read from the journal,
#                not from the bot's row. A town already above 256 before the canary is not a breach (nothing is admitted there:
#                the fold refuses it) -- the journal's max town total is printed per pool (the INSTRUMENT: it can see a total).
#   C6 RESERVE  is C1 (deposit) and C3 (town deposit) above: unchanged.
#   C9 THE WELL AT THE CAP (only the variants built on junkwell-02, sc-on-<jw sha>: the operator's at-ceiling remedy): a canary
#      _well_dispose row that threw cobble (cobble= > 0) whose own cap reading was not at_cap (cap=), or that left the bag under
#      the 64 reserve (cobble_left= missing or < 64) -- each REVERTS. TRIPWIRE (independent of the row): the journal's town
#      total at the row's time left room for a whole stack (lb <= 192). Positive control: canary well visits (any
#      _well_dispose row) and the self-tests below; with no well in the build the gate is reported as not exercised.
#   REPORTED  refusals at_cap / unknown / outside, reconciliations (counted of tried), claims live after 1 h by bot (a removed bot: fail closed), the
#             town deposit's cobble_cap counts.
import sys, os, json, re
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
RESERVE = 64
CB = ('cobblestone', 'cobbled_deepslate')
DEPOSITS = ('deposit', '_town_deposit')
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
ST16 = re.compile(r'^(egg|brown_egg|blue_egg|snowball|ender_pearl|armor_stand|bucket|honey_bottle|.*_sign|.*_hanging_sign|.*_banner)$')


def load_window(since, until):
    """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def kv(d):
    return {m.group(1): m.group(2) for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or '')}


def num(f, k):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return 0


def subset_sums(stacks):
    s = {0}
    for x in stacks:
        s |= {a + x for a in s}
    return s


def stacks_of(f):
    return [int(x) for x in (f.get('tried') or '-').split(',') if x.isdigit()]


def c1_breach(f):
    return num(f, 'moved') > 0 and f.get('kept', '').isdigit() and num(f, 'kept') < RESERVE


def c2_breach(f):
    m = num(f, 'moved')
    if m > num(f, 'planned'):
        return True
    return m > 0 and m not in subset_sums(stacks_of(f))


def balance_gaps(rows_):
    """THE SERVER-BACKED BALANCE (Codex r3): rows [(bot, t, fields)] grouped into deposits -- one bot's consecutive rows with
    the same before= and kept= within 10 s (one row per cobble name, written together after the close) -- and checked ONCE
    per deposit, whatever names it had: on src=server, before - sum(moved) must equal kept. -> [(bot, gap)]."""
    out, cur = [], None
    def close(g):
        if g and g['src'] == 'server' and g['before'] is not None and g['kept'] is not None:
            gap = g['before'] - g['moved'] - g['kept']
            if gap != 0:
                out.append((g['bot'], gap))
    for b, t, f in sorted(rows_, key=lambda x: (x[0], x[1])):
        bf = int(f['before']) if str(f.get('before', '')).isdigit() else None
        kp = int(f['kept']) if str(f.get('kept', '')).isdigit() else None
        if cur and cur['bot'] == b and cur['before'] == bf and cur['kept'] == kp and (t - cur['t']).total_seconds() <= 10:
            cur['moved'] += num(f, 'moved'); cur['t'] = t
            continue
        close(cur)
        cur = {'bot': b, 't': t, 'before': bf, 'kept': kp, 'moved': num(f, 'moved'), 'src': f.get('src')}
    close(cur)
    return out


CAP = 256


def c5_row_breach(f):
    """C5 (row): moved cobble on a COMPLETE count that left the town above the cap."""
    return num(f, 'moved') > 0 and f.get('complete') == '1' and f.get('town_after', '').isdigit() and int(f['town_after']) > CAP


def journal_overshoots(recs, since_ms, now_ms=None):
    """C5 (journal) -> (breaches [(claim id, bot, total)], max_total, admitted, released, stale_live {bot: n}). Folds the
    journal as cobblecap.mjs does: per container the latest capture (tie: larger); a count that releases a live claim on its
    own container, or resolves a void of it, replaces the standing count whatever the clocks; a claim's decision from the
    town view at its own place (lb + live admitted reservations + n <= 256 on a complete count; voided containers unknown).
    At each admitted claim's RELEASE (the cnt carrying its id) the town total over the claim's keys must be <= 256. Only
    claims at or after since_ms are judged. stale_live: admitted claims still live after 1 h, by bot (a removed bot's claims
    stay reserved for good: fail closed, made visible here)."""
    OBS_TTL = 6 * 3600 * 1000
    obs, claims, out = {}, {}, []
    mx = 0; adm = rel = 0
    for r in recs:
        t = r.get('t')
        if t in ('obs', 'cnt') and r.get('k') is not None and isinstance(r.get('cap'), (int, float)):
            o = obs.get(r['k']); n = max(0, int(r.get('n') or 0))
            releasing = t == 'cnt' and any(claims.get(i, {}).get('state') == 'live' and claims[i]['k'] == r['k'] for i in (r.get('ids') or []))
            resolving = any(c['state'] == 'void' and c['k'] == r['k'] and r['cap'] >= c['void_at'] for c in claims.values())
            if o is None or releasing or resolving or r['cap'] > o[1] or (r['cap'] == o[1] and n > o[0]):
                obs[r['k']] = (n, r['cap'])
            if resolving:
                for i in [i for i, c in claims.items() if c['state'] == 'void' and c['k'] == r['k'] and r['cap'] >= c['void_at']]:
                    del claims[i]
        if t in ('cnt', 'rel'):
            for i in r.get('ids') or []:
                c = claims.get(i)
                if not c or c['state'] != 'live':
                    continue
                if c['at'] >= since_ms:
                    rel += 1
                    total = sum(obs[k][0] for k in set(c['keys']) if k in obs)
                    mx = max(mx, total)
                    if total > CAP:
                        out.append((i, c['bot'], total))
                del claims[i]
        elif t == 'claim' and r.get('id') and isinstance(r.get('at'), (int, float)):
            at = r['at']; keys = r.get('keys') or []; gone = set(r.get('gone') or [])
            dirty = {c['k'] for c in claims.values() if c['state'] == 'void'}
            fresh = lambda k: k not in gone and k not in dirty and k in obs and at - obs[k][1] < OBS_TTL
            lb = sum(obs[k][0] for k in obs if fresh(k))
            allk = [k for k in set(keys) | dirty if k not in gone]
            complete = bool(r.get('coverage')) and bool(allk) and all(fresh(k) for k in allk)
            res = sum(c['n'] for c in claims.values() if c['state'] == 'live')
            n = int(r.get('n') or 0)
            if lb + res < CAP and complete and lb + res + n <= CAP:
                claims[r['id']] = {'n': n, 'k': r.get('k'), 'at': at, 'state': 'live', 'keys': keys, 'bot': r.get('bot'), 'void_at': None}
                if at >= since_ms:
                    adm += 1
        elif t == 'void':
            for i in r.get('ids') or []:
                c = claims.get(i)
                if c and c['state'] == 'live':
                    c['state'] = 'void'; c['void_at'] = r.get('at') or 0
        if t in ('obs', 'cnt'):
            mx = max(mx, sum(v[0] for v in obs.values()))
    now_ms = now_ms if now_ms is not None else max([r.get('at') or r.get('cap') or 0 for r in recs] or [0])
    stale = Counter(c['bot'] for c in claims.values() if c['state'] == 'live' and now_ms - c['at'] > 3600 * 1000)
    return out, mx, adm, rel, dict(stale)


def c9_breach(f):
    """C9: cobble thrown down the well without an at_cap reading, or leaving the bag under its 64 reserve."""
    if num(f, 'cobble') <= 0:
        return None
    if f.get('cap') != 'at_cap':
        return {'cobble': num(f, 'cobble'), 'cap': f.get('cap')}
    if not str(f.get('cobble_left', '')).isdigit() or int(f['cobble_left']) < RESERVE:
        return {'cobble': num(f, 'cobble'), 'cobble_left': f.get('cobble_left')}
    return None


def town_total_series(recs):
    """[(ms, sum of the latest counts)] after each count in the journal (latest capture per container; tie: larger)"""
    obs, out = {}, []
    for r in recs:
        if r.get('t') in ('obs', 'cnt') and r.get('k') is not None and isinstance(r.get('cap'), (int, float)):
            o = obs.get(r['k']); n = max(0, int(r.get('n') or 0))
            if o is None or r['cap'] > o[1] or (r['cap'] == o[1] and n > o[0]):
                obs[r['k']] = (n, r['cap'])
            out.append((r['cap'], sum(v[0] for v in obs.values())))
    return out


def td_cobble(d):
    m = re.search(r' banked (\S+)', d or '')
    tot = 0
    for part in (m.group(1) if m else '-').split(','):
        k, _, v = part.partition(':')
        if k in CB and v.isdigit():
            tot += int(v)
    return tot


def stack_of(n):
    return 16 if ST16.search(n) else 64


def occupancy(inv):
    return sum(c if UN.search(n) else -(-c // stack_of(n)) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


# POSITIVE CONTROLS for the gates: the build's own row shape (bots/test/cobble-rule.test.mjs asserts the same string)
_ok = kv('name=cobblestone planned=30 tried=30 moved=30 before=94 kept=64 src=server reserve=64 no_room=0')
assert int(_ok['before']) - num(_ok, 'moved') == num(_ok, 'kept')
assert not c1_breach(_ok) and not c2_breach(_ok)
assert c1_breach(kv('name=cobblestone planned=30 tried=30 moved=30 kept=40 src=server reserve=64 no_room=0'))
assert c1_breach(kv('name=cobblestone planned=30 tried=30 moved=30 kept=40 src=skipped reserve=64 no_room=0')), 'a skipped recount still judges the client bag'
assert c2_breach(kv('name=cobblestone planned=30 tried=30 moved=12 kept=82 src=server reserve=64 no_room=0')), 'a partial stack'
assert c2_breach(kv('name=cobblestone planned=30 tried=30 moved=40 kept=64 src=server reserve=64 no_room=0'))
assert not c2_breach(kv('name=cobblestone planned=40 tried=10,30 moved=40 kept=64 src=server reserve=64 no_room=0'))
assert not c2_breach(kv('name=cobblestone planned=30 tried=- moved=0 kept=94 src=server reserve=64 no_room=1'))
_T = dt.datetime(2026, 10, 7, tzinfo=dt.timezone.utc)
_r = lambda sec, txt: ('b', _T + dt.timedelta(seconds=sec), kv(txt))
# two valid deposits with identical numbers are two deposits, not one (Codex r3); a deepslate-only deposit is checked too
assert balance_gaps([_r(0, 'name=cobblestone moved=30 before=94 kept=64 src=server'), _r(600, 'name=cobblestone moved=30 before=94 kept=64 src=server')]) == []
assert balance_gaps([_r(0, 'name=cobbled_deepslate moved=40 before=104 kept=64 src=server')]) == []
assert balance_gaps([_r(0, 'name=cobbled_deepslate moved=40 before=144 kept=64 src=server'), _r(1, 'name=cobblestone moved=40 before=144 kept=64 src=server')]) == []
assert balance_gaps([_r(0, 'name=cobblestone moved=30 before=94 kept=70 src=server')]) == [('b', -6)], 'positive control: a partial the client called whole'
assert balance_gaps([_r(0, 'name=cobblestone moved=30 before=94 kept=70 src=skipped')]) == [], 'unconfirmed: not judged'
assert td_cobble('slots 36->33 stacks 3/3 clicked 3 bagdelta 0 tools - banked cobblestone:30,oak_log:10 stop done containers 5,64,0=took') == 30
# C9 POSITIVE CONTROLS: the coupled build's row shape (bots/test/well.test.mjs asserts the same fields)
assert c9_breach(kv('slots=36->35 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=30 cobble_left=64 cap=at_cap offlist_items=- unnamed=0')) is None
assert c9_breach(kv('slots=36->35 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=30 cobble_left=64 cap=below offlist_items=- unnamed=0')) == {'cobble': 30, 'cap': 'below'}
assert c9_breach(kv('slots=36->35 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=30 cobble_left=40 cap=at_cap offlist_items=- unnamed=0')) is not None
assert c9_breach(kv('slots=36->35 offlist=0 gclicked=0 swords=0 sword_lost=0 sword_kept=0 cobble=0 cap=below offlist_items=- unnamed=0')) is None
assert town_total_series([{'t': 'obs', 'k': 'a', 'n': 100, 'cap': 1}, {'t': 'cnt', 'k': 'b', 'n': 60, 'cap': 2, 'ids': []}, {'t': 'obs', 'k': 'a', 'n': 90, 'cap': 0}]) == [(1, 100), (2, 160), (0, 160)]
# C5 POSITIVE CONTROLS: the row gate fires on a complete count left above 256, not on an incomplete one or a refusal
assert c5_row_breach(kv('name=cobblestone planned=30 tried=30 moved=30 before=94 kept=64 src=server reserve=64 no_room=0 town_before=240 town_after=270 complete=1 cap=256 at_cap=0 unknown=0'))
assert not c5_row_breach(kv('name=cobblestone planned=30 tried=30 moved=30 before=94 kept=64 src=server reserve=64 no_room=0 town_before=100 town_after=130 complete=1 cap=256 at_cap=0 unknown=0'))
assert not c5_row_breach(kv('name=cobblestone planned=30 tried=- moved=0 before=94 kept=94 src=server reserve=64 no_room=0 town_before=250 town_after=250 complete=1 cap=256 at_cap=1 unknown=0'))
# the journal gate: an admitted claim released into a total of 270 fires (a fold the code would not make, written by hand);
# the code's own sequence (150 counted, two claims of 64: one admitted, one refused) does not
_J = [{'t': 'obs', 'k': 'a', 'n': 150, 'cap': 10}, {'t': 'claim', 'id': 'x', 'n': 64, 'k': 'a', 'at': 20, 'keys': ['a'], 'coverage': True, 'bot': 'p'},
      {'t': 'claim', 'id': 'y', 'n': 64, 'k': 'a', 'at': 21, 'keys': ['a'], 'coverage': True}, {'t': 'rel', 'ids': ['y']},
      {'t': 'cnt', 'k': 'a', 'n': 214, 'cap': 30, 'ids': ['x']}]
assert journal_overshoots(_J, 0)[0] == [] and journal_overshoots(_J, 0)[2] == 1 and journal_overshoots(_J, 0)[1] == 214
_J2 = _J[:4] + [{'t': 'cnt', 'k': 'a', 'n': 270, 'cap': 30, 'ids': ['x']}]
assert journal_overshoots(_J2, 0)[0] == [('x', 'p', 270)], 'positive control: a release into 270 is a breach'
assert journal_overshoots(_J[:2], 0, now_ms=20 + 3700 * 1000)[4] == {'p': 1}, 'an admitted claim live after 1 h is reported by bot'
# the read's fold agrees with cobblecap.mjs on the round-4 cases: a void makes the container unknown; its recount is the count
_V = [{'t': 'obs', 'k': 'a', 'n': 150, 'cap': 1000}, {'t': 'claim', 'id': 'A', 'n': 64, 'k': 'a', 'at': 900, 'keys': ['a'], 'coverage': True},
      {'t': 'void', 'ids': ['A'], 'at': 902}, {'t': 'claim', 'id': 'B', 'n': 10, 'k': 'a', 'at': 903, 'keys': ['a'], 'coverage': True},
      {'t': 'cnt', 'k': 'a', 'n': 214, 'cap': 904, 'ids': []}, {'t': 'claim', 'id': 'C', 'n': 64, 'k': 'a', 'at': 905, 'keys': ['a'], 'coverage': True}]
assert journal_overshoots(_V, 0)[2] == 1, 'A admitted on 150; B refused (unknown after the void); C refused (214 + 64)'

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
lic = Counter(); offbuild = 0; c1 = []; c2 = []; c3 = []; c4 = []; c5 = []; tw_room = []; tw_partial = []; tw_unconf = []
capref = Counter(); recon = Counter(); td_capref = Counter(); c9 = []; well_rows = 0; well_cobble = []
last_noroom = {}; src_rows = Counter(); bal_rows = []
prev = {}; banked = Counter(); runs = Counter(); runs_hold = Counter(); under = Counter(); lowered = Counter()
noeff = Counter(); deprows = Counter(); bots = defaultdict(set); last = defaultdict(dict); hours = Counter()
for r in rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    bots[(period, arm)].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    raw = r.get('raw') or {}
    inv = (raw.get('bot') or {}).get('inventory')
    ver = ((raw.get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    st = ((raw.get('skill') or {}).get('status')) or r.get('status')
    if isinstance(inv, dict) and inv and not other:
        last[(period, arm)][b] = inv
    if k == '_cobble_bank' and period == 'post':
        if other:
            offbuild += 1
            continue
        lic[arm] += 1
        f = kv(d)
        if arm == 'canary':
            if c1_breach(f):
                c1.append((b, d[:120]))
            if c2_breach(f):
                c2.append((b, d[:120]))
            if c5_row_breach(f):
                c5.append((b, d[:160]))
            for x in ('at_cap', 'unknown', 'outside'):
                capref[x] += num(f, x)
            src_rows[f.get('src') or '?'] += 1
            if num(f, 'moved') > 0 and f.get('src') != 'server':
                tw_unconf.append((b, d[:120]))
            bal_rows.append((b, t, f))
            if num(f, 'no_room') > 0:
                tw_room.append((b, d[:120]))
                if num(f, 'moved') == 0:
                    last_noroom[b] = t
    if k == '_well_dispose' and period == 'post' and arm == 'canary' and not other:
        well_rows += 1
        f9 = kv(d)
        w9 = c9_breach(f9)
        if w9:
            c9.append((b, w9, d[:120]))
        if num(f9, 'cobble') > 0:
            well_cobble.append((b, t, pool_of(b)))
    if k == '_cobble_reconcile' and period == 'post' and arm == 'canary' and not other:
        m_ = re.match(r'counted=(\d+) of (\d+)', d)
        if m_:
            recon['runs'] += 1; recon['counted'] += int(m_.group(1)); recon['tried'] += int(m_.group(2))
    if k == '_town_deposit' and period == 'post' and arm == 'canary' and not other:
        m_ = re.search(r' cobble_cap (\d+)/(\d+)/(\d+)', d)
        if m_:
            td_capref['at_cap'] += int(m_.group(1)); td_capref['unknown'] += int(m_.group(2)); td_capref['outside'] += int(m_.group(3))
    if k == '_deposit_new_chest' and period == 'post' and arm == 'canary' and not other:
        if b in last_noroom and (t - last_noroom[b]).total_seconds() < 240:
            c4.append((b, d[:120]))
    if k in DEPOSITS and isinstance(inv, dict) and not other:
        c_end = sum(inv.get(n, 0) for n in CB)
        c0 = prev.get(b)
        deprows[(period, arm)] += 1
        if st == 'no_effect':
            noeff[(period, arm)] += 1
        if c0 is not None and c0 > 0:
            runs_hold[(period, arm)] += 1
        if c0 is not None and c0 - c_end > 0:
            lowered[(period, arm)] += 1
            banked[(period, arm)] += c0 - c_end
            if c_end < RESERVE:
                under[(period, arm)] += 1
        if k == '_town_deposit' and arm == 'canary' and period == 'post' and td_cobble(d) > 0 and c_end < RESERVE:
            c3.append((b, c_end, d[:120]))
    if isinstance(inv, dict) and not other:
        prev[b] = sum(inv.get(n, 0) for n in CB)

tw_balance = balance_gaps(bal_rows)

# C5 (journal): every canary pool's town journal(s), read as the bots read them
import glob as _g
jr = {}
since_ms = int(CUT.timestamp() * 1000)
for pool in sorted(CANS):
    for jf in _g.glob('/var/lib/mcai/_pool-%s/*.cobble.jsonl' % pool):
        recs = []
        try:
            for line in open(jf, errors='ignore'):
                try:
                    recs.append(json.loads(line))
                except Exception:
                    pass
        except Exception as e:
            print('journal unreadable %s: %s' % (jf, e))
            continue
        jr[jf] = (len(recs),) + journal_overshoots(recs, since_ms, now_ms=int(now.timestamp() * 1000))
c5_journal = [(jf, x) for jf, v in jr.items() for x in v[1]]
# C9 TRIPWIRE: the journal's town total when cobble went down the well (room for a whole stack = lb <= 192)
series = {}
for pool in sorted(CANS):
    for jf in _g.glob('/var/lib/mcai/_pool-%s/*.cobble.jsonl' % pool):
        try:
            series.setdefault(pool, []).extend(town_total_series([json.loads(l) for l in open(jf, errors='ignore') if l.strip().startswith('{')]))
        except Exception:
            pass
c9_room = []
for b, t, pool in well_cobble:
    ms = int(t.timestamp() * 1000)
    before = [tot for at, tot in series.get(pool, []) if at <= ms]
    if before and before[-1] <= CAP - 64:
        c9_room.append((b, before[-1]))
span_h = W / 60.0


def rate(period, arm, c):
    n = len(bots[(period, arm)])
    return c[(period, arm)] / (n * span_h) if n else float('nan')


def per_bot(period, arm, fn):
    vals = [fn(inv) for inv in last[(period, arm)].values()]
    return sum(vals) / len(vals) if vals else float('nan')


did = lambda f: (f('post', 'canary') - f('pre', 'canary')) - (f('post', 'control') - f('pre', 'control'))
bank_did = did(lambda p, a: rate(p, a, banked))
full_did = did(lambda p, a: per_bot(p, a, lambda inv: float(occupancy(inv) >= 34)))
slots_did = did(lambda p, a: per_bot(p, a, lambda inv: sum(-(-inv.get(n, 0) // 64) for n in CB)))
noeff_share = lambda p, a: noeff[(p, a)] / deprows[(p, a)] if deprows[(p, a)] else float('nan')
inst = lowered[('post', 'control')]
exposure = int(runs_hold[('post', 'canary')] >= 20 and inst >= 1 and len(jr) >= 1)   # the journal gate must be able to see
print('-' * 78)
print('DENOMINATORS bots pre canary %d control %d | post canary %d control %d | deposit-like rows post canary %d control %d'
      % (len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]),
         deprows[('post', 'canary')], deprows[('post', 'control')]))
print('LIVENESS     canary _cobble_bank rows %d (>= 1) | control %d (must be 0) | other build %d' % (lic['canary'], lic['control'], offbuild))
print('CORRECTNESS  C1 reserve breached %d | C2 not whole stacks %d | C3 town deposit under the reserve %d' % (len(c1), len(c2), len(c3)))
print('             C5 TOWN OVERSHOOT (row: moved on a complete count, town_after > %d) %d %s | (journal: an admitted claim released above %d) %d %s'
      % (CAP, len(c5), c5[:2], CAP, len(c5_journal), c5_journal[:2]))
print('             journals (canary pools): %s' % ('; '.join('%s records %d, max town total %d, admitted %d, released %d, live > 1 h %d'
      % (os.path.basename(os.path.dirname(jf)) + '/' + os.path.basename(jf), v[0], v[2], v[3], v[4], sum(v[5].values())) for jf, v in jr.items()) or 'NONE FOUND (C5 journal is blind)'))
print('             claims still live after 1 h, by bot (a removed or stuck bot keeps its stack reserved: fail closed, operator-visible): %s'
      % ({b: n for jf, v in jr.items() for b, n in v[5].items()} or '-'))
print('             C9 cobble down the well without at_cap / under the 64 reserve %d %s | (tripwire) the journal had room for a stack %d %s | canary well rows %d, cobble disposals %d%s'
      % (len(c9), c9[:2], len(c9_room), c9_room[:2], well_rows, len(well_cobble), '' if well_rows else ' (no well in this build: C9 not exercised)'))
print('CAP          refusals on _cobble_bank rows: at_cap %d unknown %d outside %d | town deposit cobble_cap at_cap %d unknown %d outside %d | reconciliations %d (counted %d of %d tried)'
      % (capref['at_cap'], capref['unknown'], capref['outside'], td_capref['at_cap'], td_capref['unknown'], td_capref['outside'], recon['runs'], recon['counted'], recon['tried']))
print('TRIPWIRES    C4 a new chest within 4 min of a cobble no_room %d %s | before - moved != kept on src=server rows %d %s'
      % (len(c4), c4[:2], len(tw_balance), tw_balance[:2]))
print('             _cobble_bank rows by src (canary): %s (C1 judges every src; the balance tripwire only src=server -- on Paper src=skipped dominates, so it is mostly dark and a race partial rests on client numbers)' % (dict(src_rows) or '-'))
print('INFO         moves whose kept= is the client bag (recount skipped/unanswered) %d %s | no_room rows %d | deposit runs that lowered cobble and ended < %d: canary %d of %d, control %d of %d'
      % (len(tw_unconf), tw_unconf[:2], len(tw_room), RESERVE, under[('post', 'canary')], lowered[('post', 'canary')],
         under[('post', 'control')], lowered[('post', 'control')]))
print('INSTRUMENT   control deposit runs that lowered cobble: %d (>= 1)' % inst)
print('EXPOSURE     canary deposit runs by bots holding cobble: %d (>= 20) and >= 1 canary town journal (%d) -> %s' % (runs_hold[('post', 'canary')], len(jr), 'READY' if exposure else 'NOT YET'))
print('PRIMARY      cobble banked/bot-h canary %.1f -> %.1f control %.1f -> %.1f DiD %+.2f'
      % (rate('pre', 'canary', banked), rate('post', 'canary', banked), rate('pre', 'control', banked), rate('post', 'control', banked), bank_did))
print('             share at >= 34 slots DiD %+.3f | cobble slots/bot DiD %+.2f | deposit no_effect share canary %.2f -> %.2f control %.2f -> %.2f'
      % (full_did, slots_did, noeff_share('pre', 'canary'), noeff_share('post', 'canary'), noeff_share('pre', 'control'), noeff_share('post', 'control')))
for x in (c1[:3] + c2[:3] + c3[:3] + c5[:3] + c5_journal[:3] + c9[:3]):
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    clean = lambda v: None if v != v else round(v, 4)
    emit('stonecapread', W, {
        'rows_canary': lic['canary'], 'rows_control': lic['control'], 'offbuild_canary': offbuild,
        'breach_reserve': len(c1), 'breach_whole': len(c2), 'breach_town_reserve': len(c3), 'cobble_chest_tripwire': len(c4),
        'breach_well_cobble': len(c9), 'tripwire_well_room': len(c9_room), 'well_rows_canary': well_rows, 'well_cobble_canary': len(well_cobble),
        'breach_town_overshoot_row': len(c5), 'breach_town_overshoot_journal': len(c5_journal), 'journals_found': len(jr),
        'cap_at_cap': capref['at_cap'], 'cap_unknown': capref['unknown'], 'cap_outside': capref['outside'],
        'reconcile_runs': recon['runs'], 'reconcile_counted': recon['counted'],
        'claims_live_over_1h': sum(sum(v[5].values()) for v in jr.values()),
        'unconfirmed_moves': len(tw_unconf), 'no_room_rows': len(tw_room), 'balance_tripwire': len(tw_balance),
        'rows_src_server': src_rows.get('server', 0),
        'under_canary': under[('post', 'canary')], 'under_control': under[('post', 'control')],
        'instrument_control': inst, 'runs_holding_canary': runs_hold[('post', 'canary')],
        'cobble_banked_did': clean(bank_did), 'full_share_did': clean(full_did), 'cobble_slots_did': clean(slots_did),
        'exposure_ready': exposure,
    })
except Exception as e:
    print('emit failed:', e)
