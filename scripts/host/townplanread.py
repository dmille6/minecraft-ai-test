#!/usr/bin/env python3
# townplanread.py [window_min] [--selftest] -- the read for canary `townplan-01` (the per-town siting file and its planner).
# Design docs/reports/town-plan-2026-10-20.md sections 4 and 9 row 3; build spec docs/reports/townplan-found-spec-2026-10-21.md
# section 1.9 (both engines APPROVE r7). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM;
# difference-in-differences against control for the no-harm lines; DENOMINATORS FIRST.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the file reads). Two sources:
#   ROWS   /var/log/mcai/*/skill-*.jsonl* through lib.telemetry Events (rotation-aware)
#   PLANS  /var/lib/mcai/_pool-*/townplan-<hx>_<hy>_<hz>.g<N>.json -- re-walked here by a PORT of planstore.mjs's acceptance
#          rules (the walk, the schema, the transition and mark rules), so a writer bug the bots' own walk tolerated shows up
#
# THE CHANGE (what only this build writes):
#   _townplan_mode    once per spawn: the licence
#   _townplan         one per publish attempt (root, alloc, adopt, seen, observe, missing, gone, expire, extend, refit, ...)
#   _townplan_audit   every 10 min per bot in town: placed/present/missing/other/unknown/free/occupied/lid/unreachable, gens,
#                     bytes, walk_ms
#   _townplan_adopt   a NEW natural well / plinth / composter site decided under a plan: tier, plan_refused, gen
#   _townplan_place   a temporary placement whose spot search skipped plan cells
#   townplan-*.json   the generation files
#
# GATES (deterministic; each has a failing fixture and a passing control in --selftest)
#   D1 chain_invalid   an ACCEPTED generation (by the walk) that the port's transition rules reject -- impossible unless the port
#                      and the writer disagree: a writer bug or a port bug, either way a REVERT until explained
#   D2 invalid_rows    `_townplan` rows result=invalid (the writer refused its own generation: a writer-bug tripwire)
#   D3 never_hits      a recovery chest (`_deposit_new_chest` at= gen=), or a new well / plinth / composter site
#                      (`_townplan_adopt` at= gen=), on a NEVER cell of the plan generation recorded in its own row
#   D4 zone_cells      a plan cell inside a protected zone (the pool's protected-zones.json) or the plan's seed avoid box
#   D5 root_occupied   a root's own writer's first audit (within 5 min of the root) with occupied > 0: the design's "0 plan
#                      cells on structure or furniture"
#   ARMS               control `_townplan*` / `_found*` rows after the deploy, or a control plan generation written after it
#   LIVENESS           canary licence rows >= 1 and canary `_townplan` rows >= 1
#   NO HARM (WATCH: DiD of success shares; fails only below its tolerance with z < -2; null under MIN_CELL)
#     deposit_ok, town_deposit_ok  the deposit verb's and the town deposit's success shares
#     recovery_nosite_up           recovery no_site rows per bot-hour, canary ratio > 2x control's with >= 5 canary rows
#     plan_only_nosite             a recovery no_site whose row says plan_refused >= 1 (keepout=plan_only): reported, WATCH >= 1
#     bytes_alarm                  a town's plan files past 16 MB (the walk fails closed at 64 MB): WATCH
#   EXPOSURE           every canary town has an accepted plan AND the arm has >= 1 accepted generation after a root
#   INSTRUMENT         control deposit rows >= 1 (the no-harm lines can see)
# REPORTED: plans per town (mode, orientation, store, work, generations, rejected and why), the ops written, the audits'
#   totals, adopter tiers, temporary-placement skips, the walk's cost.
import sys, os, json, re, glob, math, hashlib
import datetime as dt
from collections import Counter, defaultdict

MIN_CELL = 10
DEPOSIT_TOL = -0.20
TD_TOL = -0.20
PLANT_TOL = -0.20
NOSITE_RATIO = 2.0
NOSITE_MIN = 5
BYTES_ALARM = 16 * 1024 * 1024
EXPIRE_MARGIN_MS = 60_000
OBSERVE_MS = 10 * 60_000
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
ROW_KINDS = ('_townplan_mode', '_townplan', '_townplan_audit', '_townplan_adopt', '_townplan_place', '_deposit_new_chest',
             'deposit', '_town_deposit', 'town_deposit', '_found_mode', '_found', '_well_refused', '_plinth', '_plant_spot')
FILE_RE = re.compile(r'^(townplan-(-?\d+)_(-?\d+)_(-?\d+))\.g(\d+)\.json$')
FLEX = ('annex', 'cluster', 'unplaced')
GEOM = ('kind', 'box', 'y', 'door', 'sector', 'keepout')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def pool_of_dir(d):
    name = os.path.basename(d.rstrip('/'))
    return pool_of(name[len('_pool-'):] if name.startswith('_pool-') else name)


# ---- THE PORT of planstore.mjs (planRefusal, transitionRefusal, the walk) ------------------------------------------------------

def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def xyz(a):
    return isinstance(a, list) and len(a) == 3 and all(is_int(v) for v in a)


def ck(a):
    return '%d,%d,%d' % (a[0], a[1], a[2])


def cells_of(p):
    return list(p.get('cells') or []) + list(p.get('stations') or [])


def plan_cells(plan):
    out = {}
    for p in plan.get('plots') or []:
        for c in cells_of(p):
            if c and xyz(c.get('at')):
                out[ck(c['at'])] = (p.get('id'), c)
    return out


def plan_refusal(plan):
    if not isinstance(plan, dict):
        return 'not an object'
    if plan.get('v') != 1:
        return 'v'
    if plan.get('template') != 'ring@1':
        return 'template'
    if not is_int(plan.get('gen')) or plan['gen'] < 1:
        return 'gen'
    prev = plan.get('prev')
    if prev is not None and not (is_int(prev) and 1 <= prev < plan['gen']):
        return 'prev'
    if (prev is None) != (plan.get('prevSha') is None):
        return 'prevSha'
    h = plan.get('home') or {}
    if not all(is_int(h.get(k)) for k in 'xyz'):
        return 'home'
    if plan.get('mode') not in ('greenfield', 'retrofit'):
        return 'mode'
    if not isinstance(plan.get('at'), (int, float)):
        return 'at'
    if not isinstance(plan.get('plots'), list):
        return 'plots'
    ids, seen = set(), set()
    for p in plan['plots']:
        if not isinstance(p, dict) or not isinstance(p.get('id'), str) or p['id'] in ids:
            return 'plot id'
        ids.add(p['id'])
        for c in cells_of(p):
            if not isinstance(c, dict) or not xyz(c.get('at')) or not isinstance(c.get('kind'), str):
                return 'cell'
            if c.get('state') not in ('free', 'reserved', 'placed'):
                return 'cell state'
            k = ck(c['at'])
            if k in seen:
                return 'cell twice'
            seen.add(k)
            if c['state'] == 'reserved' and (not isinstance(c.get('by'), str) or not isinstance(c.get('visit'), str) or not isinstance(c.get('until'), (int, float))):
                return 'reservation'
    if not isinstance(plan.get('groups'), dict):
        return 'groups'
    return None


def committed_cell(c):
    return c.get('state') in ('reserved', 'placed') or isinstance(c.get('seenSince'), (int, float))


def committed(p):
    return any(committed_cell(c) for c in cells_of(p))


def geom(p):
    return json.dumps([p.get(k) for k in GEOM], sort_keys=True)


def mark_refusal(c, n, nxt, k):
    for mark in ('seenSince', 'missingSince'):
        a, b = c.get(mark), n.get(mark)
        if a == b:
            continue
        if b is not None and not isinstance(b, (int, float)):
            return '%s not a time' % mark
        if a is not None and b is not None:
            return '%s changed while set' % mark
        if b is not None and b != nxt.get('at'):
            return '%s backdated' % mark
        if c.get('state') == 'reserved' and not ((nxt.get('at') or 0) > (c.get('until') or 0) + EXPIRE_MARGIN_MS) and nxt.get('by') != c.get('by'):
            return '%s on a live reservation by a non-holder' % mark
    target = n.get('state') or c.get('state')
    if n.get('seenSince') is not None and target == 'placed':
        return 'seenSince on placed'
    if n.get('missingSince') is not None and target != 'placed':
        return 'missingSince off placed'
    return None


def intent_set_refusal(c, n):
    """planstore.mjs intentSetRefusal, exactly (c None: a new cell)."""
    role = lambda x: (x or {}).get('role')
    grp = lambda x: (x or {}).get('group')
    was = (c or {}).get('state')
    if n.get('intentSet') is not None and n.get('intentSet') is not True:
        return 'intentSet not true'
    if n.get('intentSet') and n.get('state') != 'reserved':
        return 'intentSet on %s' % n.get('state')
    if n.get('state') == 'reserved' and was != 'reserved':
        sets = role(c) is None and role(n) is not None
        if bool(n.get('intentSet')) != sets:
            return 'intentSet on the reservation %s' % ('missing' if sets else 'without an intent set')
    if n.get('state') == 'reserved' and was == 'reserved' and bool(n.get('intentSet')) != bool((c or {}).get('intentSet')):
        return 'intentSet on live reservation toggled'
    if was == 'reserved' and n.get('state') == 'free':
        if (c or {}).get('intentSet') and (role(n) is not None or grp(n) is not None):
            return 'the intent the reservation set survived its end'
        if not (c or {}).get('intentSet') and (role(n) != role(c) or grp(n) != grp(c)):
            return 'the older intent lost at the reservation end'
    return None


def transition_refusal(prev, nxt):
    for k in ('v', 'template', 'world', 'mode'):
        if json.dumps(prev.get(k)) != json.dumps(nxt.get(k)):
            return '%s changed' % k
    if json.dumps(prev.get('home'), sort_keys=True) != json.dumps(nxt.get('home'), sort_keys=True):
        return 'home changed'
    nplots = {p.get('id'): p for p in nxt.get('plots') or []}
    if any(committed(p) for p in prev.get('plots') or []) and (prev.get('s') != nxt.get('s') or prev.get('orientation') != nxt.get('orientation')):
        return 's/orientation changed with cells committed'
    for p in prev.get('plots') or []:
        q = nplots.get(p.get('id'))
        if q is None:
            return 'plot dropped'
        if not committed(p):
            continue
        if geom(p) != geom(q):
            return 'geometry changed with cells committed'
        qc = {ck(c['at']): c for c in cells_of(q) if xyz(c.get('at'))}
        for c in cells_of(p):
            n = qc.get(ck(c['at']))
            if n is None:
                if committed_cell(c) or p.get('kind') not in FLEX:
                    return 'cell of a committed plot dropped'
                continue
            if n.get('kind') != c.get('kind') or json.dumps(n.get('stand')) != json.dumps(c.get('stand')):
                return 'cell of a committed plot changed'
    stands = {}
    for p in nxt.get('plots') or []:
        for c in cells_of(p):
            if c.get('state') in ('reserved', 'placed') or isinstance(c.get('seenSince'), (int, float)):
                if xyz(c.get('stand')):
                    stands[ck(c['stand'])] = ck(c['at'])
    for p in nxt.get('plots') or []:
        for c in cells_of(p):
            if xyz(c.get('at')) and ck(c['at']) in stands:
                return 'a cell on a committed stand'
    before, after = plan_cells(prev), plan_cells(nxt)
    trans = {}
    for t in nxt.get('transitions') or []:
        if not isinstance(t, dict) or not xyz(t.get('at')) or t.get('why') not in ('released', 'expired', 'gone'):
            return 'bad transition'
        k = ck(t['at'])
        was = before.get(k, (None, {}))[1].get('state')
        if (t['why'] == 'gone' and was != 'placed') or (t['why'] != 'gone' and was != 'reserved'):
            return 'transition on a %s cell' % was
        if k in trans:
            return 'two transitions'
        trans[k] = t
    at = (nxt.get('at') or 0)
    for k, (_, c) in before.items():
        n = after.get(k, (None, None))[1]
        if n is None:
            if c.get('state') != 'free':
                return 'a %s cell dropped' % c.get('state')
            continue
        if n.get('kind') != c.get('kind'):
            return 'kind changed'
        mw = mark_refusal(c, n, nxt, k) or intent_set_refusal(c, n)
        if mw:
            return mw
        t = trans.get(k)
        late = at > (c.get('until') or 0) + EXPIRE_MARGIN_MS if c.get('state') == 'reserved' else False

        def observed(mark):
            v = c.get(mark)
            return isinstance(v, (int, float)) and at >= v + OBSERVE_MS
        same_intent = (c.get('role') == n.get('role')) and (c.get('group') == n.get('group'))
        intent_kept = True if c.get('role') is None else same_intent
        if c.get('state') == 'placed':
            if not intent_kept:
                return 'placed role changed'
            if n.get('state') == 'placed':
                if t:
                    return 'transition on a cell that stays placed'
                continue
            if n.get('state') != 'free' or not t or t.get('why') != 'gone':
                return 'placed -> %s' % n.get('state')
            if not observed('missingSince'):
                return 'gone without two empty reads'
            if not same_intent:
                return 'gone lost its intent'
            continue
        if c.get('state') == 'reserved':
            if n.get('state') == 'reserved':
                if t:
                    return 'transition on a cell that stays reserved'
                if n.get('by') != c.get('by') or n.get('visit') != c.get('visit'):
                    return 'live reservation taken'
                if not (n.get('until') or 0) >= (c.get('until') or 0):
                    return 'reservation shortened'
                if (n.get('until') or 0) > (c.get('until') or 0) and nxt.get('by') != c.get('by'):
                    return 'renewed by a non-holder'
                if not same_intent:
                    return 'reservation intent changed'
                continue
            if n.get('state') == 'placed':
                if t:
                    return 'transition on a placed cell'
                holder = nxt.get('by') == c.get('by') and n.get('visit') == c.get('visit') and n.get('by') == c.get('by')
                if not holder and not (late and observed('seenSince')):
                    return 'placed by another before expiry and observation'
                if not same_intent:
                    return 'placement lost the intent'
                continue
            if not t or t.get('why') == 'gone':
                return 'reservation dropped without a transition'
            if t['why'] == 'released' and not (t.get('by') == c.get('by') and t.get('visit') == c.get('visit') and nxt.get('by') == c.get('by')):
                return 'release by a non-holder'
            if t['why'] == 'expired' and not late:
                return 'expiry before until + margin'
            continue
        if t:
            return 'transition on a free cell'
        if n.get('state') == 'reserved' and (n.get('by') != nxt.get('by') or not (n.get('until') or 0) > at):
            return 'reservation not by the writer'
        if n.get('state') == 'reserved' and not intent_kept:
            return 'reservation changed its intent'
        if n.get('state') == 'placed' and not observed('seenSince'):
            return 'free placed without two reads'
        if n.get('state') == 'placed' and not same_intent:
            return 'adoption changed its intent'
    for k, (_, n) in after.items():
        if k in before:
            continue
        if n.get('state') == 'reserved' and (n.get('by') != nxt.get('by') or not (n.get('until') or 0) > (nxt.get('at') or 0)):
            return 'new cell reserved by another'
        if n.get('state') == 'placed':
            return 'new cell arrives placed'
        iw = intent_set_refusal(None, n)
        if iw:
            return iw
        if n.get('seenSince') is not None or n.get('missingSince') is not None:
            return 'new cell arrives marked'
    pg, ng = prev.get('groups') or {}, nxt.get('groups') or {}
    if pg.get('v') != ng.get('v'):
        return 'groups.v changed'
    if pg.get('status') == 'allocated' and ng.get('status') != 'allocated':
        return 'groups de-allocated'
    for g, ks in (pg.get('homes') or {}).items():
        have = set((ng.get('homes') or {}).get(g) or [])
        if any(k not in have for k in ks or []):
            return 'home lost a container'
    return None


def walk(files, world):
    """files: [(gen, bytes)] -> (head, accepted [(gen, plan)], rejected [(gen, why)], absent). The JS walk, exactly."""
    head = None
    accepted, rejected, absent = [], [], []
    for gen, buf in sorted(files):
        try:
            plan = json.loads(buf.decode('utf-8'))
        except Exception:
            rejected.append((gen, 'unparseable')); continue
        if not isinstance(plan, dict):
            rejected.append((gen, 'not an object')); continue
        if json.dumps(plan.get('world')) != json.dumps(world):
            absent.append(gen); continue
        bad = plan_refusal(plan)
        if bad:
            rejected.append((gen, 'schema: ' + bad)); continue
        if plan.get('gen') != gen:
            rejected.append((gen, 'gen mismatch')); continue
        sha = hashlib.sha256(buf).hexdigest()
        if head is None:
            if plan.get('prev') is not None:
                rejected.append((gen, 'no root before it')); continue
            head = (gen, sha, plan); accepted.append((gen, plan)); continue
        if plan.get('prev') != head[0]:
            rejected.append((gen, 'prev is not the head')); continue
        if plan.get('prevSha') != head[1]:
            rejected.append((gen, 'prevSha mismatch')); continue
        why = transition_refusal(head[2], plan)
        if why:
            rejected.append((gen, why)); continue
        head = (gen, sha, plan); accepted.append((gen, plan))
    return head, accepted, rejected, absent


def never_cells(plan):
    out = set()
    for p in plan.get('plots') or []:
        for c in cells_of(p):
            out.add(ck(c['at']))
            if c.get('state') in ('reserved', 'placed') and xyz(c.get('stand')):
                s = c['stand']
                out.add(ck(s)); out.add(ck([s[0], s[1] + 1, s[2]]))
    return out


def read_plans(root='/var/lib/mcai'):
    """-> { pool: { key: { world: { 'files': [(gen, bytes)], 'bytes': n } } } } for every town's plan files (every world)."""
    out = defaultdict(dict)
    for d in glob.glob(os.path.join(root, '_pool-*')):
        pool = pool_of_dir(d)
        try:
            names = os.listdir(d)
        except OSError:
            continue
        by_key = defaultdict(list)
        for f in names:
            m = FILE_RE.match(f)
            if not m:
                continue
            try:
                buf = open(os.path.join(d, f), 'rb').read()
            except OSError:
                continue
            by_key[m.group(1)].append((int(m.group(5)), buf))
        for key, files in by_key.items():
            worlds = defaultdict(list)
            for gen, buf in files:
                try:
                    w = json.loads(buf.decode('utf-8')).get('world')
                except Exception:
                    w = '__unparseable__'
                worlds[json.dumps(w)].append((gen, buf))
            out[pool][key] = {'files': files, 'worlds': {w: fs for w, fs in worlds.items()}, 'bytes': sum(len(b) for _, b in files), 'dir': d}
    return out


def zones_of(d, world):
    try:
        z = json.load(open(os.path.join(d, 'protected-zones.json')))
    except Exception:
        return []
    if z.get('hashed_seed') is not None and world is not None and str(z.get('hashed_seed')) != str(world):
        return []
    return [q['box'] for q in z.get('zones') or [] if isinstance(q.get('box'), list) and len(q['box']) == 6]


def in_box(b, a):
    return b[0] <= a[0] <= b[3] and b[1] <= a[1] <= b[4] and b[2] <= a[2] <= b[5]


def judge_plans(plans, cans, cut_ms):
    """The plan files -> the D1/D4/exposure/arms fields and per-town summaries."""
    res = {'chain_invalid': 0, 'zone_cells': 0, 'plan_towns_canary': 0, 'towns_canary': 0, 'gens_after_root_canary': 0,
           'control_gens_post': 0, 'bytes_alarm': 0, '_towns': {}, '_lists': defaultdict(list), '_gen_index': {}, '_rejected': {}}
    for pool, keys in plans.items():
        arm = 'canary' if pool in cans else 'control'
        if arm == 'canary':
            res['towns_canary'] += 1
        for key, info in keys.items():
            if info['bytes'] > BYTES_ALARM:
                res['bytes_alarm'] += 1; res['_lists']['bytes'].append('%s:%d' % (pool, info['bytes']))
            for wkey, files in info['worlds'].items():
                world = json.loads(wkey) if wkey != '"__unparseable__"' else None
                head, acc, rej, _ = walk(files, world)
                for gen, plan in acc:
                    res['_gen_index'][(pool, gen)] = plan
                    if arm == 'control' and plan.get('at', 0) >= cut_ms:
                        res['control_gens_post'] += 1
                for gen, why in rej:
                    res['_rejected'][(pool, gen)] = why
                if head is None:
                    continue
                if arm == 'canary':
                    res['plan_towns_canary'] += 1
                    res['gens_after_root_canary'] += max(0, len(acc) - 1)
                zs = zones_of(info['dir'], world) + [a['box'] for a in ((head[2].get('seed') or {}).get('avoid') or []) if isinstance(a, dict)]
                for k in never_cells(head[2]):
                    a = [int(v) for v in k.split(',')]
                    if any(in_box(b, a) for b in zs):
                        res['zone_cells'] += 1; res['_lists']['zone'].append('%s %s' % (pool, k))
                p = head[2]
                st = next((x for x in p.get('plots') or [] if x.get('id') == 'store'), {})
                wk = next((x for x in p.get('plots') or [] if x.get('id') == 'work'), {})
                res['_towns']['%s %s' % (pool, key)] = 'gen %d (%d accepted, %d rejected%s) mode %s orient %s store %s:%d work %s:%d placed %d' % (
                    head[0], len(acc), len(rej), (' ' + ';'.join('g%d %s' % r for r in rej[:3])) if rej else '', p.get('mode'), p.get('orientation'),
                    st.get('kind'), len(st.get('cells') or []), wk.get('size'), len(wk.get('stations') or []),
                    sum(1 for x in p.get('plots') or [] for c in cells_of(x) if c.get('state') == 'placed'))
    return res


def share(n, d):
    return n / d if d else None


def did(a, b, c, d):
    return None if None in (a, b, c, d) else (b - a) - (d - c)


def did_z(cells):
    """cells [(ok, n)] x4 (canary pre/post, control pre/post) -> z of the DiD of shares (normal approx.)."""
    ps = [share(o, n) for o, n in cells]
    if any(p is None for p in ps) or any(n < MIN_CELL for _, n in cells):
        return None, None
    d = (ps[1] - ps[0]) - (ps[3] - ps[2])
    var = sum(p * (1 - p) / n for p, (_, n) in zip(ps, cells))
    return d, (d / math.sqrt(var) if var > 0 else None)


def judge_rows(rows, cut, gen_index, rejected=None):
    rejected = rejected or {}
    out = Counter()
    lists = defaultdict(list)
    first_audit = {}
    roots = {}
    for r in sorted(rows, key=lambda x: x['t']):
        f = kv(r['detail'])
        arm, per, name = r['arm'], r['per'], r['name']
        if name in ('_townplan_mode', '_townplan', '_townplan_audit', '_townplan_adopt', '_townplan_place', '_found_mode', '_found'):
            if arm == 'control' and per == 'post':
                out['arms_rows_control_post'] += 1
            if arm == 'canary' and per == 'post':
                out['rows_%s_canary' % name.strip('_')] += 1
        if arm != 'canary' or per != 'post':
            pass
        if name == '_townplan' and arm == 'canary' and per == 'post':
            out['op_%s_%s' % (f.get('op', '?'), f.get('result', '?'))] += 1
            if f.get('result') == 'invalid':
                out['invalid_rows'] += 1; lists['invalid_rows'].append('%s %s' % (r['bot'], r['detail'][:100]))
            # D1: the writer says a generation was accepted (its own walk) and the port's walk of the same files rejects it
            if f.get('result') == 'accepted' and (pool_of(r['bot']), int(f['gen']) if (f.get('gen') or '').isdigit() else None) in rejected:
                g_ = int(f['gen'])
                out['chain_invalid'] += 1; lists['invalid'].append('%s g%d %s' % (r['bot'], g_, rejected[(pool_of(r['bot']), g_)]))
            if f.get('op') == 'root' and f.get('result') == 'accepted':
                roots[(pool_of(r['bot']), r['bot'])] = r['t']
        if name == '_townplan_audit' and arm == 'canary' and per == 'post':
            for k in ('placed', 'present', 'missing', 'other', 'unknown', 'free', 'occupied', 'lid', 'unreachable'):
                try:
                    out['audit_%s' % k] += int(f.get(k, 0))
                except ValueError:
                    pass
            key = (pool_of(r['bot']), r['bot'])
            if key in roots and key not in first_audit and (r['t'] - roots[key]).total_seconds() <= 300:
                first_audit[key] = r
                if int(f.get('occupied', 0) or 0) > 0:
                    out['root_occupied'] += 1; lists['root_occupied'].append('%s %s' % (r['bot'], r['detail'][:120]))
            try:
                out['walk_ms_max'] = max(out['walk_ms_max'], int(f.get('walk_ms', 0)))
            except ValueError:
                pass
        # D3: an adopter's placement on a NEVER cell of the generation recorded in its row
        # tier=section is the greenfield recovery's OWN reservation-backed placement into a plan cell (found-01, placeIntoPlan):
        # by construction a plan cell, judged by foundread (G2), never a NEVER-cell breach (Claude/Codex code r1 P2)
        if name in ('_deposit_new_chest', '_townplan_adopt') and arm == 'canary' and per == 'post' and f.get('gen') not in (None, '-') and f.get('tier') != 'section':
            at = f.get('at')
            try:
                gen = int(f['gen']); a = [int(v) for v in at.split(',')]
            except (ValueError, AttributeError, KeyError):
                gen = a = None
            if a is not None:
                plan = gen_index.get((pool_of(r['bot']), gen))
                out['adopt_rows_canary'] += 1
                out['tier_%s' % f.get('tier', '?')] += 1
                if plan is None:
                    out['adopt_gen_unknown'] += 1
                elif (ck(a) in never_cells(plan) or (f.get('never') or '0') not in ('0', '-')) and f.get('placed', '1') != '0':
                    out['never_hits'] += 1; lists['never_hits'].append('%s %s g%d %s' % (r['bot'], name, gen, at))
        if name == '_deposit_new_chest' and f.get('site') == 'none':
            out['nosite_%s_%s' % (per, arm)] += 1
            if arm == 'canary' and per == 'post' and int(f.get('plan_refused', '0') or 0) >= 1:
                out['plan_only_nosite'] += 1; lists['plan_only'].append('%s %s' % (r['bot'], r['detail'][:120]))
        if name == '_well_refused' and ' reason=no_site ' in ' %s ' % r['detail']:
            out['wellns_%s_%s' % (per, arm)] += 1
            if arm == 'canary' and per == 'post' and int(f.get('plan_refused', '0') or 0) >= 1:
                out['plan_only_nosite'] += 1; lists['plan_only'].append('%s %s' % (r['bot'], r['detail'][:120]))
        if name == '_plinth' and r['status'] == 'refused' and f.get('stage') == 'none':
            out['plinthnone_%s_%s' % (per, arm)] += 1
        if name == '_plant_spot':
            out['plant_%s_%s' % (per, arm)] += 1
            if r['detail'].startswith('found'):
                out['plant_ok_%s_%s' % (per, arm)] += 1
        if name == '_townplan_place' and arm == 'canary' and per == 'post':
            out['place_skips_canary'] += 1
        if name == 'deposit':
            out['dep_%s_%s' % (per, arm)] += 1
            if r['status'] == 'success':
                out['dep_ok_%s_%s' % (per, arm)] += 1
        if name in ('_town_deposit', 'town_deposit'):
            out['td_%s_%s' % (per, arm)] += 1
            if r['status'] == 'success':
                out['td_ok_%s_%s' % (per, arm)] += 1
        if name == '_townplan_mode' and arm == 'canary' and per == 'post':
            out['licence_canary'] += 1
    return out, lists


def combine(pl, rw, lists, hrs):
    res = {k: v for k, v in pl.items() if not k.startswith('_')}
    res.update({k: v for k, v in rw.items()})
    g = lambda k: rw.get(k, 0)
    res['chain_invalid'] = g('chain_invalid'); res['invalid_rows'] = g('invalid_rows'); res['never_hits'] = g('never_hits'); res['root_occupied'] = g('root_occupied')
    res['licence_canary'] = g('licence_canary')
    res['liveness'] = int(g('licence_canary') >= 1 and g('rows_townplan_canary') >= 1)
    res['arms_breach'] = g('arms_rows_control_post') + pl.get('control_gens_post', 0)
    res['exposure_ready'] = int(pl.get('towns_canary', 0) >= 1 and pl.get('plan_towns_canary', 0) >= pl.get('towns_canary', 0) and pl.get('gens_after_root_canary', 0) >= 1)
    res['instrument_control'] = int(g('dep_post_control') >= 1)
    for name, key, tol in (('deposit_ok', 'dep', DEPOSIT_TOL), ('town_deposit_ok', 'td', TD_TOL), ('plant_spot_ok', 'plant', PLANT_TOL)):
        cells = [(g('%s_ok_pre_canary' % key), g('%s_pre_canary' % key)), (g('%s_ok_post_canary' % key), g('%s_post_canary' % key)),
                 (g('%s_ok_pre_control' % key), g('%s_pre_control' % key)), (g('%s_ok_post_control' % key), g('%s_post_control' % key))]
        d, z = did_z(cells)
        res['%s_did' % name] = d; res['%s_z' % name] = z
        res[name] = 1 if d is None or z is None or not (d < tol and z < -2) else 0
    def up_of(key):
        def rate(per, arm):
            h = hrs.get((per, arm), 0)
            return g('%s_%s_%s' % (key, per, arm)) / h if h else None
        rc = [rate('pre', 'canary'), rate('post', 'canary'), rate('pre', 'control'), rate('post', 'control')]
        if None in rc or g('%s_post_canary' % key) < NOSITE_MIN:
            return 0
        if rc[0] > 0 and rc[2] > 0 and rc[3] > 0:
            return int((rc[1] / rc[0]) > NOSITE_RATIO * (rc[3] / rc[2]))
        return int(rc[0] == 0)
    res['recovery_nosite_up'] = up_of('nosite')
    res['well_nosite_up'] = up_of('wellns')
    res['plinth_none_up'] = up_of('plinthnone')
    res['plan_only_nosite'] = g('plan_only_nosite')
    res['_lists'] = dict(pl.get('_lists', {}))
    res['_lists'].update(lists)
    return res


def verdict_of(res, name):
    if res.get('%s_did' % name) is None or res.get('%s_z' % name) is None:
        return 'UNEXPOSED'
    return 'ok' if res[name] else 'DOWN'


def selftest():
    W_ = 'w'
    home = {'x': 0, 'y': 64, 'z': 0}
    base = lambda **k: dict({'v': 1, 'template': 'ring@1', 'home': home, 's': 63, 'mode': 'greenfield', 'orientation': 'E', 'world': W_, 'by': 'A', 'code': None,
                             'plots': [{'id': 'store', 'kind': 'storehouse', 'box': [7, -4, 15, 4], 'keepout': True,
                                        'cells': [{'at': [9, 64, -2], 'kind': 'chest', 'stand': [10, 64, -1], 'role': 'overflow', 'group': None, 'state': 'free'}]}],
                             'groups': {'v': 1, 'status': 'greenfield', 'homes': {}}, 'transitions': []}, **k)
    def gfile(plan):
        return json.dumps(plan, separators=(',', ':')).encode()
    g1 = base(gen=1, prev=None, prevSha=None, at=1000)
    b1 = gfile(g1)
    g2 = base(gen=2, prev=1, prevSha=hashlib.sha256(b1).hexdigest(), at=2000)
    g2['plots'][0]['cells'][0].update(state='reserved', by='A', visit='va', until=900000)
    b2 = gfile(g2)
    # a stale writer from g1 at 3 (prev 1): rejected; an accepted g4 placing by the holder
    g3 = base(gen=3, prev=1, prevSha=hashlib.sha256(b1).hexdigest(), at=2500)
    g4 = json.loads(b2); g4.update(gen=4, prev=2, prevSha=hashlib.sha256(b2).hexdigest(), at=3000)
    g4['plots'][0]['cells'][0].update(state='placed'); g4['plots'][0]['cells'][0].pop('until', None)
    head, acc, rej, _ = walk([(1, b1), (2, b2), (3, gfile(g3)), (4, gfile(g4))], W_)
    assert head[0] == 4 and [a for a, _ in acc] == [1, 2, 4] and rej[0][0] == 3, (head and head[0], acc, rej)
    # the port rejects a one-read adoption, a backdated mark, a non-holder placement before expiry
    g5 = json.loads(b1); g5.update(gen=2, prev=1, prevSha='x', at=5000); g5['plots'][0]['cells'][0]['state'] = 'placed'
    assert transition_refusal(g1, g5) == 'free placed without two reads'
    g6 = json.loads(b1); g6.update(gen=2, prev=1, at=5000); g6['plots'][0]['cells'][0]['seenSince'] = 1
    assert transition_refusal(g1, g6) == 'seenSince backdated'
    g7 = json.loads(b2); g7.update(gen=3, prev=2, at=3000, by='B'); g7['plots'][0]['cells'][0].update(state='placed', by='B', visit='vb')
    assert transition_refusal(g2, g7) == 'placed by another before expiry and observation'
    # the port refuses an adoption that changes the cell's intent (JS parity, code r1), and accepts the same with it kept
    g8 = json.loads(b1); g8['plots'][0]['cells'][0]['seenSince'] = 1000
    g9 = json.loads(json.dumps(g8)); g9.update(gen=2, prev=1, at=1000 + 11 * 60_000); c9 = g9['plots'][0]['cells'][0]
    c9.update(state='placed', role='home', group='metal'); c9.pop('seenSince')
    assert transition_refusal(g8, g9) == 'adoption changed its intent', transition_refusal(g8, g9)
    c9.update(role='overflow', group=None)
    assert transition_refusal(g8, g9) is None, transition_refusal(g8, g9)
    # the port's MARKER rules (JS parity, code r4): a reservation setting an intent carries intentSet; its release clears it; an
    # older intent survives a release; a toggle is refused
    r0 = json.loads(b1); r0.update(gen=1)
    r1n = json.loads(b1); r1n.update(gen=2, prev=1, at=5000); c1n = r1n['plots'][0]['cells'][0]
    c1n.update(state='reserved', by='A', visit='va', until=900000)          # the overflow cell already HAS an intent: no marker
    assert transition_refusal(r0, r1n) is None, transition_refusal(r0, r1n)
    c1n['intentSet'] = True
    assert transition_refusal(r0, r1n) == 'intentSet on the reservation without an intent set'
    q0 = json.loads(b1); q0['plots'][0]['cells'][0].update(role=None)
    q1 = json.loads(json.dumps(q0)); q1.update(gen=2, prev=1, at=5000); qc = q1['plots'][0]['cells'][0]
    qc.update(state='reserved', by='A', visit='va', until=900000, role='home', group='metal')
    assert transition_refusal(q0, q1) == 'intentSet on the reservation missing'
    qc['intentSet'] = True
    assert transition_refusal(q0, q1) is None
    q2 = json.loads(json.dumps(q1)); q2.update(gen=3, prev=2, at=6000, by='A'); q2c = q2['plots'][0]['cells'][0]
    for k in ('by', 'visit', 'until', 'intentSet'):
        q2c.pop(k, None)
    q2c['state'] = 'free'; q2['transitions'] = [{'at': q2c['at'], 'why': 'released', 'by': 'A', 'visit': 'va'}]
    assert transition_refusal(q1, q2) == 'the intent the reservation set survived its end'
    q2c.update(role=None, group=None)
    assert transition_refusal(q1, q2) is None
    q3 = json.loads(json.dumps(q1)); q3.update(gen=3, prev=2, at=6000, by='A'); q3['plots'][0]['cells'][0].pop('intentSet')
    assert transition_refusal(q1, q3) == 'intentSet on live reservation toggled'
    # judge_plans: D1 zero on a clean chain; a zone over the cell -> D4
    tmp = '/tmp/_tpread_selftest_%d' % os.getpid()
    d = os.path.join(tmp, '_pool-board-a'); os.makedirs(d, exist_ok=True)
    for gen, buf in ((1, b1), (2, b2), (3, gfile(g3)), (4, gfile(g4))):
        open(os.path.join(d, 'townplan-0_64_0.g%d.json' % gen), 'wb').write(buf)
    plans = read_plans(tmp)
    pl = judge_plans(plans, {'board-a'}, 0)
    assert pl['chain_invalid'] == 0 and pl['plan_towns_canary'] == 1 and pl['gens_after_root_canary'] == 2 and pl['zone_cells'] == 0, pl
    json.dump({'version': 1, 'hashed_seed': W_, 'zones': [{'id': 'z', 'box': [9, -64, -2, 9, 90, -2]}]}, open(os.path.join(d, 'protected-zones.json'), 'w'))
    assert judge_plans(read_plans(tmp), {'board-a'}, 0)['zone_cells'] == 1
    os.remove(os.path.join(d, 'protected-zones.json'))
    # the plan's own seed avoid box (recorded by the writer since code r1) over the same cell -> D4 too
    d2 = os.path.join(tmp, '_pool-hive-a'); os.makedirs(d2, exist_ok=True)
    open(os.path.join(d2, 'townplan-0_64_0.g1.json'), 'wb').write(gfile(base(gen=1, prev=None, prevSha=None, at=1000, seed={'why': 'ok', 'avoid': [{'id': 'tc', 'box': [9, -64, -2, 9, 90, -2]}]})))
    assert judge_plans(read_plans(tmp), {'hive-a'}, 0)['zone_cells'] == 1
    import shutil as _sh
    _sh.rmtree(d2)
    # a control pool writing after the deploy -> arms
    dc = os.path.join(tmp, '_pool-hive-b'); os.makedirs(dc, exist_ok=True)
    open(os.path.join(dc, 'townplan-0_64_0.g1.json'), 'wb').write(gfile(base(gen=1, prev=None, prevSha=None, at=10_000)))
    assert judge_plans(read_plans(tmp), {'board-a'}, 5000)['control_gens_post'] == 1
    # rows: D2 invalid, D3 never hit pinned by gen, D5 root occupied, plan_only no_site, arms
    t0 = dt.datetime(2026, 10, 22, tzinfo=dt.timezone.utc)
    R = lambda name, detail, arm='canary', per='post', s=0, status='success', bot='board-a-Alpha': {'t': t0 + dt.timedelta(seconds=s), 'per': per, 'arm': arm, 'name': name, 'detail': detail, 'status': status, 'bot': bot}
    gi = judge_plans(read_plans(tmp), {'board-a'}, 0)['_gen_index']
    rows = [R('_townplan_mode', 'phase=mode plan=on'), R('_townplan', 'op=root result=accepted gen=1', s=1), R('_townplan', 'op=placed result=invalid why=x', s=2),
            R('_townplan_audit', 'gen=1 placed=0 occupied=2 walk_ms=40', s=60),
            R('_deposit_new_chest', 'decision=craft at=10,64,-1 tier=box plan_refused=0 gen=4 placed=1', s=100),
            R('_deposit_new_chest', 'decision=craft site=none plan_refused=2 gen=4', s=120),
            R('_townplan', 'op=root result=accepted', arm='control', s=130, bot='hive-b-Alpha'),
            R('deposit', '', arm='control', s=140, bot='hive-b-Alpha')]
    rw, lists = judge_rows(rows, t0, gi)
    assert rw['invalid_rows'] == 1 and rw['root_occupied'] == 1 and rw['never_hits'] == 1 and rw['plan_only_nosite'] == 1 and rw['arms_rows_control_post'] == 1, (rw, lists)
    res = combine(judge_plans(read_plans(tmp), {'board-a'}, 0), rw, lists, {('post', 'canary'): 1, ('pre', 'canary'): 1, ('post', 'control'): 1, ('pre', 'control'): 1})
    assert res['liveness'] == 1 and res['arms_breach'] == 2 and res['exposure_ready'] == 1 and res['instrument_control'] == 1, res
    # D1: the writer logged g3 accepted, the port rejected g3 (stale prev) -> 1; its g4 accepted -> no hit
    pj = judge_plans(read_plans(tmp), {'board-a'}, 0)
    rw3, _ = judge_rows([R('_townplan', 'op=alloc result=accepted gen=3'), R('_townplan', 'op=placed result=accepted gen=4')], t0, gi, pj['_rejected'])
    assert rw3['chain_invalid'] == 1, rw3
    rw5, _ = judge_rows([R('_well_refused', 'order=build reason=no_site tally=cols:3 rec=ok plan_refused=2 gen=4 w=x')], t0, gi)
    assert rw5['plan_only_nosite'] == 1 and rw5['wellns_post_canary'] == 1, rw5
    rw6, _ = judge_rows([R('_deposit_new_chest', 'decision=craft at=10,64,-1 tier=section plan_refused=0 gen=4 placed=1')], t0, gi)
    assert rw6['never_hits'] == 0, rw6
    # positive control for D3: the same row on a cell that is NOT a NEVER cell -> 0
    rw2, _ = judge_rows([R('_deposit_new_chest', 'decision=craft at=30,64,30 tier=outside plan_refused=0 gen=4 placed=1')], t0, gi)
    assert rw2['never_hits'] == 0 and rw2['adopt_rows_canary'] == 1
    # a plinth decision whose own cells hit a NEVER cell (the bot's never= count) though its cap is clear -> 1
    rw4, _ = judge_rows([R('_townplan_adopt', 'what=plinth at=30,64,30 tier=box plan_refused=0 gen=4 never=2')], t0, gi)
    assert rw4['never_hits'] == 1, rw4
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    print('townplanread selftest: ok')


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

    def load_window(since, until):
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
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
        name = (((r.get('raw') or {}).get('skill') or {}).get('name')) or r.get('name')
        if name in ROW_KINDS:
            rows.append({'t': t, 'per': per, 'arm': arm, 'name': name, 'status': ((r.get('raw') or {}).get('skill') or {}).get('status'), 'detail': r.get('detail') or '', 'bot': b})
    ms = lambda d: int(d.timestamp() * 1000)
    plans = read_plans()
    pl = judge_plans(plans, CANS, ms(CUT))
    rw, lists = judge_rows(rows, CUT, pl['_gen_index'], pl['_rejected'])
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    res = combine(pl, rw, lists, hrs)
    L = res['_lists']
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | plan files in %d pools'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0), len(plans)))
    print('LIVENESS     licence rows canary %d | _townplan rows canary %d | ops %s' % (res['licence_canary'], rw.get('rows_townplan_canary', 0),
          {k[3:]: v for k, v in sorted(rw.items()) if k.startswith('op_')}))
    print('PLANS        %s' % ('\n             '.join('%s: %s' % kv_ for kv_ in sorted(pl['_towns'].items())) or 'none'))
    print('ARMS         control _townplan/_found rows after the deploy %d, control plan generations after it %d (must be 0)' % (rw.get('arms_rows_control_post', 0), pl['control_gens_post']))
    print('DEFECTS      D1 accepted generations the port rejects %d %s | D2 result=invalid rows %d %s' % (res['chain_invalid'], L.get('invalid', [])[:3], res['invalid_rows'], L.get('invalid_rows', [])[:3]))
    print('             D3 adopter placements on a NEVER cell of their own generation %d of %d adopter rows %s | D4 plan cells in a zone/avoid box %d %s | D5 a root\'s first audit occupied %d %s'
          % (res['never_hits'], rw.get('adopt_rows_canary', 0), L.get('never_hits', [])[:3], res['zone_cells'], L.get('zone', [])[:3], res['root_occupied'], L.get('root_occupied', [])[:3]))
    print('NO HARM      deposit verb DiD %s -> %s | town_deposit DiD %s -> %s | recovery no_site canary %d -> %d control %d -> %d -> %s | plan-induced no_site %d %s | bytes alarm %d %s'
          % ('null' if res['deposit_ok_did'] is None else '%+.3f' % res['deposit_ok_did'], verdict_of(res, 'deposit_ok'),
             'null' if res['town_deposit_ok_did'] is None else '%+.3f' % res['town_deposit_ok_did'], verdict_of(res, 'town_deposit_ok'),
             rw.get('nosite_pre_canary', 0), rw.get('nosite_post_canary', 0), rw.get('nosite_pre_control', 0), rw.get('nosite_post_control', 0),
             'UP' if res['recovery_nosite_up'] else 'ok', res['plan_only_nosite'], L.get('plan_only', [])[:2], res['bytes_alarm'], L.get('bytes', [])))
    print('             plant_spot found share DiD %s -> %s | well no_site canary %d -> %d control %d -> %d -> %s | plinth none canary %d -> %d control %d -> %d -> %s'
          % ('null' if res['plant_spot_ok_did'] is None else '%+.3f' % res['plant_spot_ok_did'], verdict_of(res, 'plant_spot_ok'),
             rw.get('wellns_pre_canary', 0), rw.get('wellns_post_canary', 0), rw.get('wellns_pre_control', 0), rw.get('wellns_post_control', 0), 'UP' if res['well_nosite_up'] else 'ok',
             rw.get('plinthnone_pre_canary', 0), rw.get('plinthnone_post_canary', 0), rw.get('plinthnone_pre_control', 0), rw.get('plinthnone_post_control', 0), 'UP' if res['plinth_none_up'] else 'ok'))
    print('             (null = a cell under %d rows: UNEXPOSED, not ok; UP needs >= %d canary rows and > %.1fx control\'s change; deaths: the default gate)' % (MIN_CELL, NOSITE_MIN, NOSITE_RATIO))
    print('REPORTED     audits canary %s | adopter tiers %s | temporary-placement skips %d | walk_ms max %d'
          % ({k[6:]: v for k, v in sorted(rw.items()) if k.startswith('audit_')}, {k[5:]: v for k, v in sorted(rw.items()) if k.startswith('tier_')},
             rw.get('place_skips_canary', 0), rw.get('walk_ms_max', 0)))
    print('EXPOSURE     -> %s (canary towns %d with a plan %d; generations after a root %d) | INSTRUMENT control deposit rows %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', pl['towns_canary'], pl['plan_towns_canary'], pl['gens_after_root_canary'],
             rw.get('dep_post_control', 0), 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('townplanread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
