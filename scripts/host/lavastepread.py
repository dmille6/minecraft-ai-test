#!/usr/bin/env python3
# lavastepread.py [window_min] [--selftest] [--rows FILE.jsonl ...] -- the read for canary `lavastep-01` (F1 of
# docs/reports/mineshaft-safety-2026-10-23.md: the danger arm makes a verified, bounded move instead of the blind 1.5 s
# sprint-jump). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM; DENOMINATORS FIRST.
#
# THE CHANGE (rows only this build writes):
#   _lavastep_mode    once per spawn (the licence): on=1 plan_steps=3 move_ms=6000 ...
#   _lava_retreat     one per danger firing (args.phase == 'firing'; ground <= 1 per 2.5 s, airborne <= 1 per 450 ms), with
#                     its INPUTS: every cell the decision read (args.cells, relative to args.origin; null = unknown, absent
#                     = never read), args.boxes, the candidates, the plan, the seal and its inputs, each aim with its own
#                     observation, the steps, every control write [name, value, ms, phase], after (+1.5 s), end. Also
#                     args.phase == 'relax_end' rows (the enclosed-floor relaxation ending).
#   _lavastep_refused the in-flight guard refusing a dig/place during a move (reported)
#   `_reflex_danger_block` is written by BOTH builds at the same cadence: it is the episode instrument.
#
# THE GATES ARE RECOMPUTED FROM THE INPUTS, NEVER FROM THE DECISION'S OWN VERDICT. This file mirrors bots/src/lavastep.mjs
# (dangerCase, evalStep, stepPlan, aimScores, aimKey) and lavaguard.mjs (cellLavaSafe, cellSupported) and replays them on
# the recorded cells. The replay's faithfulness is itself checked: REPLAY_AGREE (the replayed plan equals the bot's own
# recorded plan on >= 99% of firings) BLOCKS KEEP -- a read that cannot reproduce the bot cannot judge it.
#   G1 step_unsafe   an executed plan step whose destination body/floor or swept lateral cells (per the design: the first
#                    step's origin centre exempt, and in `in` its laterals) hold a DANGER/lava-like or unknown cell
#   G2 aim_over_plan an aimed escape ran while the DECISION's observation (args.cells) replays to a plan, or (after a
#                    witnessed seal) the re-classification observation (args.replan) does; `in_step_missed` aims are exempt
#                    only when a decision plan existed and a step was tried
#   G3 edge_sprint   a control write during an `edge` plan step with sprint on, or jump on when the step is not 1 up
#   G4 seal_bad      a seal attempted with anything but cobblestone/cobbled_deepslate in hand, into a recorded cell that is
#                    not replaceable (lava, flowing_lava, fire, soul_fire), with an item the decision did not see, claimed
#                    witnessed without a witnessing update of that item, or UNWITNESSED and still followed by a
#                    re-classification
#   G5 aim_not_best  the executed bearing (args.aim.yaw) is not a best bearing by the aim scores RECOMPUTED from the aim's
#                    recorded cell names
# Each gate has a mutant positive control (bots/test/lavastep.test.mjs H1-H5; the Paper mutant runs in the record), and
# --selftest builds rows with the mirrored decision and fails each gate on its injected defect.
#
# EXPOSURE   canary danger EPISODES post >= 3 (episodes: `_reflex_danger_block` rows of one bot <= 30 s apart, split at any
#            death; the design's definition) AND canary firings >= 1.
# REPORTED   lava deaths per episode, canary vs control, pre/post, and their DiD (the death effect is unmeasurable at this
#            power: ~4 episodes expected on 4 pools in 6 h; the two-death floor decides harm, as always); outcomes; seals
#            witnessed; aim reasons; relaxations; guard refusals; every canary death.
import sys, os, json, math, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

DANGER = {'lava', 'fire', 'campfire', 'soul_fire', 'magma_block'}
LAVA_LIKE = {'lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire'}
WET = {'water', 'flowing_water', 'bubble_column'}
REPLACEABLE = {'lava', 'flowing_lava', 'fire', 'soul_fire'}
SEAL_ITEMS = ('cobblestone', 'cobbled_deepslate')
AIM_CELLS, PLAN_MAX_STEPS = 6, 3
BEARINGS = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]
CARD = [(1, 0), (-1, 0), (0, 1), (0, -1)]
EPISODE_GAP_S, DEATH_PAD_S = 30, 20
EXPOSURE_EPISODES = 3
REPLAY_AGREE_MIN = 0.99
YAW_TOL = 0.02
KEEP = ('_lavastep_mode', '_lava_retreat', '_lavastep_refused', '_reflex_danger_block', '_death')


# ------------------------------------------------------------------------------------------------ the mirrored decision
class Obs:
    """One recorded observation: cells relative to `origin` -> name (None = unknown), boxes name -> boundingBox.
    at(x, y, z) takes ABSOLUTE coordinates, like the JS functions; a cell never read counts in .missing."""
    def __init__(self, origin, cells, boxes):
        self.o = tuple(origin)
        self.cells = cells or {}
        self.boxes = boxes or {}
        self.missing = set()

    def has(self, x, y, z):
        """Was this cell READ (recorded, even as unknown)?"""
        return ('%d,%d,%d' % (x - self.o[0], y - self.o[1], z - self.o[2])) in self.cells

    def at(self, x, y, z):
        k = '%d,%d,%d' % (x - self.o[0], y - self.o[1], z - self.o[2])
        if k not in self.cells:
            self.missing.add(k)
            return None
        n = self.cells[k]
        if n is None:
            return None
        return (n, self.boxes.get(n, 'block'))


AIR = ('air', 'empty')
is_lava = lambda b: b is not None and b[0] in LAVA_LIKE
is_danger = lambda b: b is not None and (b[0] in DANGER or b[0] in LAVA_LIKE)
solid = lambda b: b is not None and b[1] == 'block'
passable = lambda b: b is not None and b[1] != 'block' and not is_danger(b)


def cell_lava_safe(at, x, y, z):
    for dx, dz in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        b = at(x + dx, y, z + dz)
        if b is None or is_lava(b):
            return False
    for dy in (1, 2, 3):
        b = at(x, y - dy, z)
        if b is None or is_lava(b):
            return False
        if solid(b):
            break
    return True


def cell_supported(at, x, y, z):
    for dy in (1, 2, 3):
        b = at(x, y - dy, z)
        if b is None or is_lava(b):
            return False
        if solid(b):
            return True
    return False


def danger_case(feet, below, on_ground):
    fd, bd = feet in DANGER, below in DANGER
    if not fd and not bd:
        return None
    if fd or feet in WET:
        return 'in'
    return 'edge' if on_ground else 'airborne'


def lateral_of(dx):
    return ((0, -1), (0, 0), (0, 1)) if dx else ((-1, 0), (0, 0), (1, 0))


def eval_step(at, frm, dx, dz, first, kase, origin):
    """Mirror of lavastep.mjs evalStep -> (ok, to, dy, goal)."""
    fx, fy, fz = frm
    x, z = fx + dx, fz + dz
    pick = None
    for dy in (0, 1, -1):
        y = fy + dy
        feet, head, floor = at(x, y, z), at(x, y + 1, z), at(x, y - 1, z)
        bad = False
        if feet is None or head is None or floor is None:
            bad = True
        elif is_danger(feet) or is_danger(head):
            bad = True
        elif not passable(feet) or not passable(head):
            bad = True
        elif is_danger(floor):
            bad = True
        elif not solid(floor):
            bad = True
        elif dy == 1:
            over = at(fx, fy + 2, fz)
            bad = over is None or not passable(over)
        elif dy == -1:
            over = at(x, y + 2, z)
            bad = over is None or not passable(over)
        if not bad:
            pick = (y, dy)
            break
    if pick is None:
        return (False, (x, fy, z), 0, False)
    to = (x, pick[0], z)
    for lx, lz in lateral_of(dx):
        centre = lx == 0 and lz == 0
        exempt = first and (centre or kase == 'in')
        if not exempt:
            o = at(fx + lx, fy, fz + lz)
            if o is None or is_danger(o) or not cell_supported(at, fx + lx, fy, fz + lz):
                return (False, to, pick[1], False)
        d = at(to[0] + lx, to[1], to[2] + lz)
        if d is None or is_danger(d) or not cell_supported(at, to[0] + lx, to[1], to[2] + lz):
            return (False, to, pick[1], False)
    if cell_lava_safe(at, *to):
        return (True, to, pick[1], True)
    ox, oy, oz = origin
    ex = lambda a, b, c: AIR if (a, b, c) == (ox, oy, oz) else at(a, b, c)
    if not cell_lava_safe(ex, *to):
        return (False, to, pick[1], False)
    return (True, to, pick[1], False)


def step_plan(at, origin, kase, max_steps=PLAN_MAX_STEPS):
    """Mirror of lavastep.mjs stepPlan -> [(to, dy), ...] or None."""
    origin = tuple(origin)
    seen = {origin}
    queue = [(origin, 0, [])]
    while queue:
        cell, depth, path = queue.pop(0)
        if depth >= max_steps:
            continue
        for dx, dz in CARD:
            ok, to, dy, goal = eval_step(at, cell, dx, dz, depth == 0, kase, origin)
            if to in seen:
                continue
            if not ok:
                continue
            seen.add(to)
            p2 = path + [(to, dy)]
            if goal:
                return p2
            queue.append((to, depth + 1, p2))
    return None


def aim_scores(at, origin):
    out = []
    for dx, dz in BEARINGS:
        support = collision = danger = 0
        for k in range(1, AIM_CELLS + 1):
            x, y, z = origin[0] + dx * k, origin[1], origin[2] + dz * k
            feet, head, floor = at(x, y, z), at(x, y + 1, z), at(x, y - 1, z)
            if solid(floor) and not is_danger(floor):
                support += 1
            if not (feet is not None and feet[1] != 'block' and head is not None and head[1] != 'block'):
                collision += 1
            danger += sum(1 for b in (feet, head, floor) if is_danger(b))
        out.append((support, collision, danger))
    return out


def aim_key(s):
    support, collision, danger = s
    if support == AIM_CELLS and collision == 0:
        return (0, 0, danger, 0)
    return (1, 0 if collision == 0 else 1, -support * 100 + danger, collision)


def yaw_of(b):
    return math.atan2(-b[0], -b[1])


def ang_diff(a, b):
    """|a - b| on the circle: JavaScript's atan2(-0, -1) is -pi where Python's atan2(0, -1) is +pi (the same heading)."""
    return abs(math.atan2(math.sin(a - b), math.cos(a - b)))


# ------------------------------------------------------------------------------------------------ the gates, per row
def obs_of(a, which):
    """The observation a part of the row was decided on: 'row' (the decision), 'replan', or an aim's own."""
    if which == 'row':
        return Obs(a.get('origin'), a.get('cells'), a.get('boxes')) if a.get('cells') is not None else None
    if which == 'replan':
        r = a.get('replan')
        return Obs(r['origin'], r.get('cells'), r.get('boxes')) if r and r.get('cells') is not None else None
    aim = a.get('aim') or {}
    return Obs(aim['origin'], aim.get('cells'), aim.get('boxes')) if aim.get('cells') is not None else None


def seal_target(dec, cell):
    """The seal target in the decision observation -> 'ok' | 'unverifiable' (never read) | the bad name. Presence by KEY: an
    earlier replay may already have missed the cell, so the missing-set size proves nothing (Codex code r5 P2-2)."""
    if not dec.has(*cell):
        return 'unverifiable'
    tgt = dec.at(*cell)
    return 'ok' if (tgt is not None and tgt[0] in REPLACEABLE) else str(None if tgt is None else tgt[0])


def gates(a):
    """One `_lava_retreat` firing row's args -> {g1..g5: [reasons], replay: 'agree'|'disagree'|None, missing: n}. Pure."""
    v = {'g1': [], 'g2': [], 'g3': [], 'g4': [], 'g5': [], 'replay': None, 'missing': 0}
    if a.get('phase') != 'firing' or a.get('case') == 'airborne':
        return v
    kase = a.get('case')
    dec = obs_of(a, 'row')

    def replay(ob, k, recorded):
        # the plan replayed on the observation's own cells must equal the plan the bot recorded, with NO never-read cell
        # consulted: a missing read makes the replay say "unknown, no plan", which would "agree" with a null plan while
        # proving nothing (Codex code r3 P1-3)
        before = len(ob.missing)
        rp = step_plan(ob.at, ob.o, k)
        if len(ob.missing) > before:
            return 'unverifiable'
        mine = [tuple(x[:3]) for x in (recorded or [])]
        rel = [tuple(t[i] - ob.o[i] for i in range(3)) for t, _ in rp] if rp else []
        return 'agree' if mine == rel else 'disagree'
    # THE REPLAY'S FAITHFULNESS: every ground firing must carry its decision observation, and it must reproduce the plan
    if dec is None:
        # preempted during its own setup (air, death, no entity) decided nothing: not a comparison (Claude code r4 P3-4)
        v['replay'] = None if (a.get('ended') in ('air', 'dead', 'no entity') and not a.get('error') and not a.get('steps')) else 'unverifiable'
    else:
        v['replay'] = replay(dec, kase, a.get('plan'))
    rpl = a.get('replan')
    if rpl and rpl.get('case') in ('in', 'edge') and v['replay'] == 'agree':
        rob = obs_of(a, 'replan')
        v['replay'] = 'unverifiable' if rob is None else replay(rob, rpl['case'], rpl.get('plan'))
    # G1: every executed step
    steps = a.get('steps') or []
    for i, st in enumerate(steps):
        ob = obs_of(a, 'row' if st.get('plan') == 'decision' else 'replan')
        if ob is None:
            v['g1'].append('step %d: no observation recorded' % i)
            continue
        to = tuple(st['to'])
        prev = [p for p in steps[:i] if p.get('plan') == st.get('plan') and p.get('i') == st.get('i', 0) - 1]
        frm = tuple(prev[-1]['to']) if prev else tuple(st.get('origin') or ob.o)
        dx, dz = (1 if to[0] > frm[0] else -1 if to[0] < frm[0] else 0), (1 if to[2] > frm[2] else -1 if to[2] < frm[2] else 0)
        first = st.get('i', 0) == 0
        porg = tuple(st.get('origin') or ob.o)
        pkase = st.get('case')
        if abs(to[0] - frm[0]) + abs(to[2] - frm[2]) != 1:
            v['g1'].append('step %d %s: not one cardinal step from %s to %s' % (i, st.get('plan'), frm, to))
        else:
            m0 = len(ob.missing)
            ok, eto, edy, egoal = eval_step(ob.at, frm, dx, dz, first, pkase, porg)
            if len(ob.missing) > m0:
                # the contract needed a cell the bot never recorded: the COMPARISON is unverifiable (Claude code r4 P3-2), but
                # the recorded cells below are still inspected -- a missing head never hides a recorded lava floor (Codex r5 P2-1)
                if v['replay'] in ('agree', None):
                    v['replay'] = 'unverifiable'
            else:
                if not ok or tuple(eto) != to or edy != st.get('dy'):
                    v['g1'].append('step %d %s: the step contract refuses %s -> %s (replay ok=%s to=%s dy=%s)' % (i, st.get('plan'), frm, to, ok, eto, edy))
                plan_len = len(a.get('plan') or []) if st.get('plan') == 'decision' else len((a.get('replan') or {}).get('plan') or [])
                if ok and st.get('i', 0) == plan_len - 1 and not egoal:
                    v['g1'].append('step %d %s: the last step of the plan is not lava-safe (not a goal)' % (i, st.get('plan')))
        cells = [to, (to[0], to[1] + 1, to[2]), (to[0], to[1] - 1, to[2])]
        for lx, lz in lateral_of(dx):
            if not (first and (st.get('case') == 'in' or (lx == 0 and lz == 0))):
                cells.append((frm[0] + lx, frm[1], frm[2] + lz))
            cells.append((to[0] + lx, to[1], to[2] + lz))
        for c in cells:
            if not ob.has(*c):            # never read: this cell cannot be judged (a RECORDED unknown can, below)
                if v['replay'] in ('agree', None):
                    v['replay'] = 'unverifiable'
                continue
            b = ob.at(*c)
            if b is None or is_danger(b):
                v['g1'].append('step %d %s: %s at %s' % (i, st.get('plan'), 'unknown' if b is None else b[0], c))
    # a missed step that claimed SAFE ground (no aim) must show it in its recorded observation (G2's family: the aim it skipped)
    if str(a.get('outcome', '')).endswith('plan_missed_safe'):
        mo = a.get('missObs')
        if not mo or mo.get('cells') is None:
            v['g2'].append('plan_missed_safe with no recorded observation')
        else:
            ob3 = Obs(mo['origin'], mo['cells'], mo.get('boxes'))
            o3 = tuple(mo['origin'])
            # each of the two cells on its own: a present one is judged, a missing one is unverifiable (Codex code r6 P2)
            for c3 in (o3, (o3[0], o3[1] - 1, o3[2])):
                if not ob3.has(*c3):
                    if v['replay'] in ('agree', None):
                        v['replay'] = 'unverifiable'
                    continue
                b3 = ob3.at(*c3)
                rl = mo.get('relax') or {}
                if rl.get('cell') and tuple(rl['cell']) == c3 and b3 is not None and b3[0] == rl.get('name'):
                    continue                      # the relaxed (cell, name): non-DANGER to the bot by design
                if b3 is not None and b3[0] in DANGER:
                    v['g2'].append('plan_missed_safe while its own observation shows %s at %s (the skipped aim was owed)' % (b3[0], c3))
    # G2: an aim while a plan existed
    aim = a.get('aim')
    if aim:
        reason = aim.get('reason')
        if reason == 'in_step_missed':
            # exempt only after a TRIED plan: the decision's, or (after a witnessed seal) the re-classification's
            tried = (a.get('plan') and any(s.get('plan') == 'decision' for s in steps)) or \
                    ((a.get('replan') or {}).get('plan') and any(s.get('plan') == 'replan' for s in steps))
            if not tried:
                v['g2'].append('in_step_missed with no plan tried')
        else:
            if dec is not None and step_plan(dec.at, dec.o, kase):
                v['g2'].append('aim (%s) while the decision observation has a plan' % reason)
            if reason == 'sealed':
                rpo = obs_of(a, 'replan')
                rk = (a.get('replan') or {}).get('case')
                if rpo is not None and rk in ('in', 'edge') and step_plan(rpo.at, rpo.o, rk):
                    v['g2'].append('aim after a witnessed seal while the re-classification has a plan')
    # G3: edge plan steps never sprint; jump only on a 1-up step
    for c in a.get('controls') or []:
        if len(c) < 4 or not str(c[3]).startswith('step:'):
            continue
        try:
            st = steps[int(str(c[3]).split(':')[1])]
        except (ValueError, IndexError):
            v['g3'].append('control in an unknown step %s' % c[3])
            continue
        if st.get('case') != 'edge':
            continue
        if c[0] == 'sprint' and c[1]:
            v['g3'].append('sprint on edge step %s' % c[3])
        if c[0] == 'jump' and c[1] and st.get('dy') != 1:
            v['g3'].append('jump on edge step %s (dy %s)' % (c[3], st.get('dy')))
    # G4: the seal, from its inputs
    s = a.get('seal')
    if s and s.get('ref') is not None:
        item = s.get('placeHeld') or s.get('held') or s.get('item')
        attempted = s.get('placeHeld') is not None or s.get('witnessed') is not None and s.get('ok', True)
        if attempted and item not in SEAL_ITEMS:
            v['g4'].append('seal with %s' % item)
        if s.get('item') not in (a.get('items') or []):
            v['g4'].append('seal item %s not among the items the decision saw %s' % (s.get('item'), a.get('items')))
        if dec is not None:
            st4 = seal_target(dec, s['cell'])
            if st4 == 'unverifiable':
                if v['replay'] in ('agree', None):
                    v['replay'] = 'unverifiable'
            elif st4 != 'ok':
                v['g4'].append('seal aimed at %s' % st4)
        if s.get('witnessed') and (s.get('update') or {}).get('name') != s.get('item'):
            v['g4'].append('claimed witnessed without an update of %s' % s.get('item'))
        if s.get('witnessed') is False and (a.get('replan') is not None or a.get('reclass') is not None
                                             or str(a.get('outcome', '')).startswith('sealed')):
            v['g4'].append('unwitnessed seal followed by a re-classification')
    # G5: the executed bearing is a best one by recomputed scores
    if aim:
        ref = aim.get('cellsRef')
        ob = obs_of(a, 'row' if ref == 'row' else 'replan' if ref == 'replan' else 'aim')
        if ob is None:
            v['g5'].append('aim with no observation')
        else:
            before = len(ob.missing)
            sc = aim_scores(ob.at, ob.o)
            complete = len(ob.missing) == before
            ch = aim.get('chosen')
            # OPTIMALITY IS GRADED ONLY ON A COMPLETE OBSERVATION (Codex code r4 P2): a never-read aim cell makes the replay
            # unverifiable (below), never a G5 defect -- missing telemetry must not REVERT a canary
            if ch is None:
                v['g5'].append('aim with no chosen bearing')
            elif complete and aim_key(sc[ch]) != min(aim_key(x) for x in sc):
                v['g5'].append('chosen %s key %s, best %s' % (ch, aim_key(sc[ch]), min(aim_key(x) for x in sc)))
            # the executed heading versus the chosen bearing is the executor's steering, independent of the observation
            if ch is not None and ang_diff(float(aim.get('yaw', 99)), yaw_of(BEARINGS[ch])) > YAW_TOL:
                v['g5'].append('executed yaw %s is not bearing %d (%.2f)' % (aim.get('yaw'), ch, yaw_of(BEARINGS[ch])))
            # A MIRROR DISAGREEMENT IS THE READ'S, NOT THE BOT'S (Claude code r3 P2-2): recomputed scores that differ from the
            # recorded ones, or an aim observation with a never-read cell, mark the firing's replay -- never a G5 defect
            if v['replay'] == 'agree':     # only an agreeing replay is downgraded; an unverifiable one stays so
                if ob.missing:
                    v['replay'] = 'unverifiable'
                elif [tuple(x) for x in (aim.get('scores') or [])] != sc:
                    v['replay'] = 'disagree'
            v['missing'] += len(ob.missing)
    if dec is not None:
        v['missing'] += len(dec.missing)
    return v


# ------------------------------------------------------------------------------------------------ episodes and the judge
def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def episodes(rows):
    """`_reflex_danger_block` rows per bot -> [(bot, t0, t1)], <= 30 s apart, split at ANY death of that bot. Pure."""
    by = defaultdict(list)
    deaths = defaultdict(list)
    for r in rows:
        if r['name'] == '_reflex_danger_block':
            by[r['bot']].append(r['t'])
        elif r['name'] == '_death':
            deaths[r['bot']].append(r['t'])
    out = []
    for bot, ts in by.items():
        ts.sort()
        ds = sorted(deaths.get(bot, []))
        cur = None
        for t in ts:
            if cur and t - cur[1] <= EPISODE_GAP_S and not any(cur[1] < d <= t for d in ds):
                cur[1] = t
            else:
                if cur:
                    out.append((bot, cur[0], cur[1]))
                cur = [t, t]
        if cur:
            out.append((bot, cur[0], cur[1]))
    return out


def lava_death_in(ep, deaths_by):
    bot, t0, t1 = ep
    return any(t0 <= t <= t1 + DEATH_PAD_S and fc == 'fire' for t, fc in deaths_by.get(bot, []))


def judge(rows, *, cut, cans):
    """rows: dicts t, bot, name, detail, fc, arm, per, args. Pure."""
    res = {}
    deaths_by = defaultdict(list)
    for r in rows:
        if r['name'] == '_death':
            deaths_by[r['bot']].append((r['t'], r.get('fc')))
    eps = episodes(rows)
    arm = lambda b: 'canary' if pool_of(b) in cans else 'control'
    cnt = Counter(); dth = Counter()
    for ep in eps:
        k = ('post' if ep[1] >= cut else 'pre', arm(ep[0]))
        cnt[k] += 1
        if lava_death_in(ep, deaths_by):
            dth[k] += 1
    rate = {k: (dth[k] / cnt[k]) if cnt[k] else None for k in cnt}
    res['episodes'] = {'%s_%s' % k: cnt[k] for k in sorted(cnt)}
    res['lava_deaths_in_episodes'] = {'%s_%s' % k: dth[k] for k in sorted(dth)}
    rp = lambda p, a: rate.get((p, a))
    if None not in (rp('post', 'canary'), rp('pre', 'canary'), rp('post', 'control'), rp('pre', 'control')):
        res['lava_death_rate_did'] = round((rp('post', 'canary') - rp('pre', 'canary')) - (rp('post', 'control') - rp('pre', 'control')), 4)
    else:
        res['lava_death_rate_did'] = None
    can = [r for r in rows if r['arm'] == 'canary' and r['per'] == 'post']
    fir = [r for r in can if r['name'] == '_lava_retreat' and (r.get('args') or {}).get('phase') == 'firing']
    res['licence_canary'] = sum(1 for r in can if r['name'] == '_lavastep_mode' and 'on=1' in (r.get('detail') or ''))
    res['firings_canary'] = len(fir)
    # ground firings whose decision the read could replay (airborne firings decide nothing: Claude code r3 P2-3)
    res['ground_replayed_canary'] = sum(1 for r in fir if gates(r['args'])['replay'] in ('agree', 'disagree'))
    res['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and r['per'] == 'post' and r['name'] in ('_lava_retreat', '_lavastep_mode', '_lavastep_refused'))
    g = {k: 0 for k in ('g1', 'g2', 'g3', 'g4', 'g5')}
    examples = defaultdict(list)
    agree = disagree = unver = missing = 0
    for r in fir:
        v = gates(r['args'])
        for k in g:
            if v[k]:
                g[k] += 1
                if len(examples[k]) < 3:
                    examples[k].append('%s %s: %s' % (r['bot'], dt.datetime.fromtimestamp(r['t'], dt.timezone.utc).strftime('%H:%M:%S'), v[k][0]))
        agree += v['replay'] == 'agree'; disagree += v['replay'] == 'disagree'; unver += v['replay'] == 'unverifiable'; missing += v['missing']
    res.update({'%s_%s' % (k, n): g[k] for k, n in (('g1', 'step_unsafe'), ('g2', 'aim_over_plan'), ('g3', 'edge_sprint'), ('g4', 'seal_bad'), ('g5', 'aim_not_best'))})
    res['_examples'] = dict(examples)
    ground = agree + disagree + unver
    res['replay_agree'] = round(agree / ground, 4) if ground else None
    res['replay_unverifiable'] = unver
    # no ground firing: nothing to vouch for (the exposure gate already holds the read); any ground firing: >= 99% of them
    # must replay to the bot's own plan with every consulted cell recorded
    res['replay_ok'] = 1 if (ground == 0 or agree / ground >= REPLAY_AGREE_MIN) else 0
    res['missing_reads'] = missing
    args = [r['args'] for r in fir]
    res['cases'] = dict(Counter(x.get('case') for x in args))
    res['outcomes'] = dict(Counter(x.get('outcome') for x in args))
    res['ended'] = dict(Counter(x.get('ended') for x in args))
    res['aim_reasons'] = dict(Counter((x.get('aim') or {}).get('reason') for x in args if x.get('aim')))
    seals = [x['seal'] for x in args if (x.get('seal') or {}).get('ref') is not None]
    res['seals'] = {'attempted': len(seals), 'witnessed': sum(1 for s in seals if s.get('witnessed'))}
    res['relaxations'] = sum(1 for x in args if x.get('relax'))
    res['guard_refused'] = sum(1 for r in can if r['name'] == '_lavastep_refused')
    res['deaths_canary'] = [(r['bot'], r.get('fc'), round(r['t'])) for r in can if r['name'] == '_death']
    res['episodes_canary_post'] = cnt[('post', 'canary')]
    res['instrument_control'] = 1 if any(r['name'] == '_reflex_danger_block' for r in rows) else 0
    # EXPOSED = >= 3 canary episodes AND >= 1 GROUND firing whose decision replayed (an airborne-only canary tested nothing)
    res['exposure_ready'] = 1 if (cnt[('post', 'canary')] >= EXPOSURE_EPISODES and res['ground_replayed_canary'] >= 1) else 0
    return res


# ------------------------------------------------------------------------------------------------ the self-test
def selftest():
    """Rows built WITH THE MIRRORED DECISION on small worlds; each gate passes its clean row and fails its injected defect."""
    def world(cells):
        def at(x, y, z):
            n = cells.get((x, y, z), 'stone' if y < 64 else 'air')
            return None if n is None else (n, 'empty' if n in ('air', 'water', 'lava', 'fire', 'soul_fire', 'cave_air') else 'block')
        return at

    def recorder(at, origin):
        cells, boxes = {}, {}
        def f(x, y, z):
            b = at(x, y, z)
            k = '%d,%d,%d' % (x - origin[0], y - origin[1], z - origin[2])
            if k not in cells:
                cells[k] = b[0] if b else None
                if b:
                    boxes.setdefault(b[0], b[1])
            return b
        return f, cells, boxes

    def firing(wcells, origin, kase, items=()):
        at = world(wcells)
        rec, cells, boxes = recorder(at, origin)
        plan = step_plan(rec, origin, kase)
        row = {'phase': 'firing', 'case': kase, 'origin': list(origin), 'cells': cells, 'boxes': boxes, 'items': list(items),
               'plan': [[t[0] - origin[0], t[1] - origin[1], t[2] - origin[2], dy] for t, dy in plan] if plan else None,
               'steps': [], 'controls': [], 'path': []}
        if plan:
            prev = origin
            for i, (t, dy) in enumerate(plan):
                row['steps'].append({'plan': 'decision', 'origin': list(origin), 'i': i, 'to': list(t), 'dy': dy, 'case': kase,
                                     'sprint': kase == 'in' and i == 0, 'jump': (kase == 'in' and i == 0) or dy == 1})
                row['controls'] += [['sprint', kase == 'in' and i == 0, 0, 'step:%d' % i], ['forward', True, 0, 'step:%d' % i]]
                prev = t
            row['path'] = ['plan']; row['outcome'] = 'plan'
        else:
            sc = aim_scores(rec, origin)
            best = min(range(8), key=lambda j: (aim_key(sc[j]), j))
            row['aim'] = {'reason': 'no_plan', 'cellsRef': 'row', 'origin': list(origin), 'case': kase, 'scores': [list(x) for x in sc],
                          'chosen': best, 'yaw': round(yaw_of(BEARINGS[best]), 2)}
            row['path'] = ['aim']; row['outcome'] = 'aim'
        return row

    import copy
    MAGMA = {(0, 63, 0): 'magma_block'}
    POOL = {(x, y, z): 'lava' for x in range(1, 7) for y in (62, 63) for z in range(-4, 5)}
    DEEP = {(x, 64, z): 'lava' for x in range(1, 5) for z in range(-4, 5)}
    m = firing(MAGMA, (0, 64, 0), 'edge')
    p = firing(POOL, (1, 64, 0), 'edge')
    d = firing(DEEP, (1, 64, 0), 'in')
    assert m['plan'] and len(m['plan']) == 1 and p['plan'] is None and d['plan'] and len(d['plan']) == 2, (m['plan'], p['plan'], d['plan'])
    for row in (m, p, d):
        v = gates(row)
        assert not any(v[k] for k in ('g1', 'g2', 'g3', 'g4', 'g5')) and v['replay'] == 'agree', (row['case'], v)
    assert p['aim']['chosen'] in (5, 6, 7), p['aim']   # away from the pool (west-ish)
    # G1: a recorded lava cell beside an executed step's destination (the sweep would have refused it)
    g1 = copy.deepcopy(m); g1['cells']['1,0,1'] = 'lava'
    assert gates(g1)['g1'], 'G1'
    g1u = copy.deepcopy(m); g1u['cells']['1,0,-1'] = None     # a RECORDED unknown beside an executed step: a defect
    assert gates(g1u)['g1'], 'G1 recorded unknown'
    # G2: an aim while the decision observation replays to a plan (the "skip the plan" mutant)
    g2 = copy.deepcopy(m); g2['steps'] = []; g2['controls'] = []; g2['plan'] = None
    sc = aim_scores(Obs(g2['origin'], g2['cells'], g2['boxes']).at, tuple(g2['origin']))
    g2['aim'] = {'reason': 'no_plan', 'cellsRef': 'row', 'origin': g2['origin'], 'case': 'edge', 'scores': [list(x) for x in sc], 'chosen': 0, 'yaw': round(yaw_of(BEARINGS[0]), 2)}
    v2 = gates(g2); assert v2['g2'] and v2['replay'] == 'disagree', ('G2', v2)
    g2b = copy.deepcopy(d); g2b['aim'] = {'reason': 'in_step_missed', 'origin': d['origin'], 'case': 'in', 'cells': d['cells'], 'boxes': d['boxes'],
                                          'scores': [list(x) for x in aim_scores(Obs(d['origin'], d['cells'], d['boxes']).at, tuple(d['origin']))], 'chosen': 6, 'yaw': round(yaw_of(BEARINGS[6]), 2)}
    assert not gates(g2b)['g2'], 'G2 exempts a missed in step after a tried plan'
    # G3: sprint on an edge step; jump on a level edge step
    g3 = copy.deepcopy(m); g3['controls'].append(['sprint', True, 10, 'step:0'])
    assert gates(g3)['g3'], 'G3 sprint'
    g3j = copy.deepcopy(m); g3j['controls'].append(['jump', True, 10, 'step:0'])
    assert gates(g3j)['g3'], 'G3 jump'
    assert not gates(d)['g3'], 'in steps may sprint'
    # G4: a seal row, clean, then each defect
    s = copy.deepcopy(p); s['items'] = ['cobblestone']
    s['seal'] = {'ok': True, 'cell': [1, 63, 0], 'ref': [1, 62, 0], 'face': [0, 1, 0], 'item': 'cobblestone', 'held': 'cobblestone', 'placeHeld': 'cobblestone',
                 'witnessed': True, 'update': {'name': 'cobblestone', 'ms': 60}, 'next': 'reclassify'}
    s['cells']['0,-1,0'] = 'lava'
    s['replan'] = {'origin': [1, 64, 0], 'case': None, 'cells': {}, 'boxes': {}, 'plan': None}; s['reclass'] = None; s['outcome'] = 'sealed'; del s['aim']
    assert not gates(s)['g4'], ('G4 clean', gates(s)['g4'])
    for mut, why in ((lambda x: x['seal'].update(placeHeld='dirt'), 'item'), (lambda x: x['cells'].update({'0,-1,0': 'magma_block'}), 'target'),
                     (lambda x: x.update(items=[]), 'unseen item'), (lambda x: x['seal'].update(update={'name': 'lava'}), 'false witness'),
                     (lambda x: x['seal'].update(witnessed=False, update=None), 'unwitnessed then re-classified')):
        g4 = copy.deepcopy(s); mut(g4)
        assert gates(g4)['g4'], 'G4 ' + why
    # G1: lava or an unknown cell UNDER a swept lateral cell (the step contract's support reads)
    g1s = copy.deepcopy(m); g1s['cells']['1,-1,1'] = 'lava'
    assert gates(g1s)['g1'], 'G1 lava under the sweep'
    g1n = copy.deepcopy(m); g1n['cells']['1,-1,1'] = None
    assert gates(g1n)['g1'], 'G1 unknown under the sweep'
    # REPLAY: an observation with every cell missing never counts as agreement
    blank = copy.deepcopy(p); blank['cells'] = {}
    assert gates(blank)['replay'] == 'unverifiable', gates(blank)['replay']
    # G5: due south recorded as JavaScript writes it (-pi) is the same heading as +pi
    SOUTH = {(x, 63, z): 'lava' for x in range(-7, 8) for z in range(-7, 8) if not (x == 0 and z >= 1)}
    south = firing(SOUTH, (0, 64, 0), 'edge')
    assert south['plan'] is None and south['aim']['chosen'] == 4, south.get('aim')
    south['aim']['yaw'] = -3.14                       # what JavaScript's atan2(-0, -1) records
    assert not gates(south)['g5'], ('G5 wrap', gates(south)['g5'])
    assert ang_diff(-3.14, math.pi) < YAW_TOL and ang_diff(-3.14, 0) > 3
    # an aim observation missing ONE cell: unverifiable, never a G5 defect (Codex code r4 P2)
    hole = copy.deepcopy(south); del hole['cells']['0,1,6']
    vh = gates(hole)
    assert vh['replay'] == 'unverifiable' and not vh['g5'], ('missing aim cell', vh['replay'], vh['g5'])
    # ...while the executed heading is still checked on an incomplete observation
    hole2 = copy.deepcopy(hole); hole2['aim']['yaw'] = 0.0
    assert gates(hole2)['g5'], 'the steering check stands without a complete observation'
    # G1 / G4 on a never-read cell: unverifiable, not a defect; a recorded UNKNOWN is still a G1 defect (Claude code r4 P3-2)
    g1m = copy.deepcopy(m); del g1m['cells']['1,0,1']
    vm = gates(g1m); assert vm['replay'] == 'unverifiable' and not vm['g1'], ('G1 missing', vm['replay'], vm['g1'])
    g4m = copy.deepcopy(s); del g4m['cells']['0,-1,0']
    v4 = gates(g4m); assert not v4['g4'] and v4['replay'] == 'unverifiable', ('G4 missing', v4['g4'], v4['replay'])
    # COMBINATIONS (Codex code r5 P2): a missing head never hides a recorded lava floor; a recorded unknown floor likewise
    lf = copy.deepcopy(m); lf['cells']['1,-1,0'] = 'lava'; del lf['cells']['1,1,0']
    vlf = gates(lf); assert vlf['g1'] and vlf['replay'] == 'unverifiable', ('lava floor + missing head', vlf['g1'], vlf['replay'])
    nf = copy.deepcopy(m); nf['cells']['1,-1,0'] = None; del nf['cells']['1,1,0']
    assert gates(nf)['g1'], 'a recorded unknown floor + missing head'
    # ...and a missing seal target is unverifiable even when the decision replay already missed it
    g4k = copy.deepcopy(s); del g4k['cells']['0,-1,0']; g4k['plan'] = None
    v4k = gates(g4k); assert not v4k['g4'] and v4k['replay'] == 'unverifiable', ('G4 key', v4k['g4'], v4k['replay'])
    # the case a size test gets wrong: the observation's replay has ALREADY missed the target before G4 asks
    pre_missed = Obs(g4k['origin'], g4k['cells'], g4k['boxes']); pre_missed.at(1, 63, 0)
    assert seal_target(pre_missed, [1, 63, 0]) == 'unverifiable', 'presence by key, whatever the replay read before'
    assert seal_target(Obs(s['origin'], s['cells'], s['boxes']), [1, 63, 0]) == 'ok'
    pre = {'phase': 'firing', 'case': 'edge', 'ended': 'air', 'origin': [0, 64, 0], 'steps': [], 'controls': []}
    assert gates(pre)['replay'] is None, 'a firing preempted during setup is not a replay comparison'
    assert gates(dict(pre, error='boom'))['replay'] == 'unverifiable', 'a decision that threw stays in the denominator'
    # a `plan_missed_safe` claim is audited against its own observation
    ms = copy.deepcopy(d); ms['outcome'] = 'plan_missed_safe'
    ms['missObs'] = {'origin': [-1, 64, 0], 'case': None, 'cells': {'0,0,0': 'air', '0,-1,0': 'stone'}, 'boxes': {'air': 'empty', 'stone': 'block'}}
    assert not gates(ms)['g2'], gates(ms)['g2']
    ms2 = copy.deepcopy(ms); ms2['missObs']['cells']['0,-1,0'] = 'lava'
    assert gates(ms2)['g2'], 'a false safe claim is caught'
    ms3 = copy.deepcopy(ms2); del ms3['missObs']['cells']['0,0,0']
    v3 = gates(ms3); assert v3['g2'] and v3['replay'] == 'unverifiable', ('a missing feet cell never hides recorded lava below', v3)
    # a relaxed magma cell under a `plan_missed_safe` verdict is the bot's design, not a defect (Claude code r6 P3-3)
    rx = copy.deepcopy(ms); rx['missObs']['cells']['0,-1,0'] = 'magma_block'; rx['missObs']['relax'] = {'cell': [-1, 63, 0], 'name': 'magma_block'}
    assert not gates(rx)['g2'], gates(rx)['g2']
    # G5: the facing bearing (east, into the pool) executed
    g5 = copy.deepcopy(p); g5['aim']['yaw'] = round(yaw_of(BEARINGS[2]), 2)
    assert gates(g5)['g5'], 'G5 yaw'
    g5c = copy.deepcopy(p); g5c['aim']['chosen'] = 2; g5c['aim']['yaw'] = round(yaw_of(BEARINGS[2]), 2)
    assert gates(g5c)['g5'], 'G5 chosen'
    # episodes split at deaths; lava deaths attributed within +20 s
    rows = [{'t': t, 'bot': 'a-b-C', 'name': '_reflex_danger_block'} for t in (0, 10, 25, 100)] + [{'t': 30, 'bot': 'a-b-C', 'name': '_death', 'fc': 'fire'}]
    eps = episodes(rows)
    assert len(eps) == 2 and lava_death_in(eps[0], {'a-b-C': [(30, 'fire')]}), eps
    # the judge, end to end on two arms
    def R(bot, t, name, args=None, detail='', fc=None, cut=1000):
        return {'t': t, 'bot': bot, 'name': name, 'args': args, 'detail': detail, 'fc': fc, 'per': 'post' if t >= cut else 'pre',
                'arm': 'canary' if pool_of(bot) == 'hive-a' else 'control'}
    rs = [R('hive-a-Alpha', 1001, '_lavastep_mode', detail='on=1'), R('hive-a-Alpha', 1100, '_lava_retreat', m), R('hive-a-Alpha', 1200, '_lava_retreat', p)]
    rs += [R('hive-a-Alpha', t, '_reflex_danger_block') for t in (1100, 1300, 1500, 1700)] + [R('board-c-Bravo', 1100, '_reflex_danger_block')]
    j = judge(rs, cut=1000, cans={'hive-a'})
    air_only = [x for x in rs if x['name'] != '_lava_retreat'] + [R('hive-a-Alpha', 1100, '_lava_retreat', {'phase': 'firing', 'case': 'airborne'})]
    assert judge(air_only, cut=1000, cans={'hive-a'})['exposure_ready'] == 0, 'airborne firings alone never expose'
    sm = copy.deepcopy(p); sm['aim']['scores'][0][0] += 1
    assert gates(sm)['replay'] == 'disagree' and not gates(sm)['g5'], 'a score mismatch is the replay\'s, not G5'
    assert j['exposure_ready'] == 1 and j['licence_canary'] == 1 and j['rows_control'] == 0 and j['g1_step_unsafe'] == 0 and j['replay_ok'] == 1, j
    jb = judge(rs + [R('hive-a-Alpha', 1250, '_lava_retreat', g3)], cut=1000, cans={'hive-a'})
    assert jb['g3_edge_sprint'] == 1, jb
    jc = judge(rs + [R('board-c-Bravo', 1300, '_lava_retreat', m)], cut=1000, cans={'hive-a'})
    assert jc['rows_control'] == 1, jc
    print('SELFTEST ok: every gate fails on its injected defect and passes its clean row; the replay agrees with the mirrored decision')


def rows_from_files(paths, cans):
    """--rows: the gates on recorded log files (a Paper run, a mutant run). Every row is canary/post."""
    out = []
    for pth in paths:
        with open(pth, errors='replace') as fh:
            for l in fh:
                try:
                    r = json.loads(l)
                except ValueError:
                    continue
                sk = r.get('skill') or {}
                t = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00')).timestamp()
                out.append({'t': t, 'bot': (r.get('bot') or {}).get('name', '?'), 'name': sk.get('name'), 'detail': sk.get('detail'),
                            'fc': sk.get('fail_class'), 'args': sk.get('args'), 'arm': 'canary', 'per': 'post'})
    return out


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    if '--rows' in sys.argv:
        files = sys.argv[sys.argv.index('--rows') + 1:]
        rows = rows_from_files(files, set())
        res = judge(rows, cut=0, cans=set())
        print(json.dumps({k: v for k, v in res.items() if k not in ('episodes', 'lava_deaths_in_episodes', 'lava_death_rate_did', 'rows_control')}, indent=1, default=str))
        sys.exit(0)
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
    kinds = Counter()
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
        name = r.get('name')
        kinds[name] += 1
        if name in KEEP:
            sk = ((r.get('raw') or {}).get('skill') or {})
            rows.append({'t': t.timestamp(), 'per': per, 'arm': arm, 'name': name, 'detail': r.get('detail') or '', 'bot': b,
                         'fc': sk.get('fail_class'), 'args': sk.get('args') if name == '_lava_retreat' else None})
    res = judge(rows, cut=CUT.timestamp(), cans=CANS)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | distinct kinds %d | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, offbuild, len(kinds), len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0)))
    print('POSITIVE CONTROL _reflex_danger_block %d rows, _death %d, _lava_retreat %d, _lavastep_mode %d (all arms, whole window)'
          % (kinds['_reflex_danger_block'], kinds['_death'], kinds['_lava_retreat'], kinds['_lavastep_mode']))
    print('EPISODES     %s | lava deaths in them %s | DiD of the per-episode lava-death rate %s (REPORTED ONLY: the two-death floor decides harm)'
          % (json.dumps(res['episodes']), json.dumps(res['lava_deaths_in_episodes']), res['lava_death_rate_did']))
    print('DEFECTS      G1 step_unsafe %d | G2 aim_over_plan %d | G3 edge_sprint %d | G4 seal_bad %d | G5 aim_not_best %d | examples %s'
          % (res['g1_step_unsafe'], res['g2_aim_over_plan'], res['g3_edge_sprint'], res['g4_seal_bad'], res['g5_aim_not_best'], json.dumps(res['_examples'])))
    print('REPLAY       the mirrored search reproduces the bot\'s own plan on %s of ground firings (need >= %.2f: %s) | unverifiable (a never-read cell consulted) %d | missing reads %d'
          % (res['replay_agree'], REPLAY_AGREE_MIN, 'ok' if res['replay_ok'] else 'NOT MET (BLOCKS KEEP)', res['replay_unverifiable'], res['missing_reads']))
    print('LIVENESS     licence %d | firings %d | cases %s | outcomes %s | ended %s | aims %s | seals %s | relaxations %d | guard refusals %d | ARMS control rows %d'
          % (res['licence_canary'], res['firings_canary'], res['cases'], res['outcomes'], res['ended'], res['aim_reasons'], res['seals'], res['relaxations'], res['guard_refused'], res['rows_control']))
    print('REPORTED     canary deaths %s' % (res['deaths_canary'] or '-'))
    print('EXPOSURE     -> %s (canary episodes post %d, need %d; firings %d, ground firings replayed %d, need 1) | INSTRUMENT -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['episodes_canary_post'], EXPOSURE_EPISODES, res['firings_canary'], res['ground_replayed_canary'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('lavastepread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
