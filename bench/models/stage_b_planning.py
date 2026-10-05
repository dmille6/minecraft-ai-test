#!/usr/bin/env python3
"""Stage B3: long-horizon planning (wood -> stone -> iron) with a deterministic simulator.

    python3 stage_b_planning.py make            # -> data/stage-b3.jsonl (30 scenarios from real inventories)
    python3 stage_b_planning.py control         # positive/negative controls of the simulator
    python3 stage_b_planning.py score out/*.jsonl

The model gets the fleet's own skill descriptions, a real starting inventory and surroundings, and a goal, and
returns an ORDERED PLAN of skill calls. The simulator mirrors the harness's semantics as the bots' system prompt
states them:
  * craft resolves its whole recipe tree from what is carried (logs -> planks -> sticks, a crafting table is
    crafted and placed when a 3x3 recipe needs one) -- "cannot craft X ... short 2x oak_log for the whole tree";
  * stone drops cobblestone only with a pickaxe; iron ore needs a stone pickaxe; mine needs a pickaxe, descends
    only, and yields the cobblestone of its staircase; ores sit below y=16 unless one is in view;
  * smelt needs a furnace (carried or placed) and fuel (coal/charcoal 8 items each; planks/logs 1.5 each).
A step that cannot execute ENDS the plan (that is what the harness would do to the bot). Score: goal reached;
index of the first impossible step; steps used vs the reference planner's length.
"""
import copy, glob, json, math, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

LOGS = ('oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log')
PLANKS = tuple(l.replace('_log', '_planks') for l in LOGS)
TABLE_RECIPES = {
    'wooden_pickaxe': {'planks': 3, 'stick': 2}, 'stone_pickaxe': {'cobblestone': 3, 'stick': 2},
    'iron_pickaxe': {'iron_ingot': 3, 'stick': 2}, 'furnace': {'cobblestone': 8}, 'chest': {'planks': 8},
    'stone_axe': {'cobblestone': 3, 'stick': 2}, 'wooden_axe': {'planks': 3, 'stick': 2},
    'stone_sword': {'cobblestone': 2, 'stick': 1}, 'bucket': {'iron_ingot': 3},
}
GOALS = {
    'stone_pickaxe': lambda inv: inv.get('stone_pickaxe', 0) >= 1,
    'iron_ingot': lambda inv: inv.get('iron_ingot', 0) >= 1,
    'iron_pickaxe': lambda inv: inv.get('iron_pickaxe', 0) >= 1,
}
GOAL_TEXT = {
    'stone_pickaxe': 'hold a stone_pickaxe',
    'iron_ingot': 'hold at least one iron_ingot',
    'iron_pickaxe': 'hold an iron_pickaxe',
}


class Fail(Exception):
    pass


def planks_total(inv):
    return sum(inv.get(p, 0) for p in PLANKS)


def take_planks(inv, n):
    for p in PLANKS:
        k = min(n, inv.get(p, 0))
        if k:
            inv[p] -= k; n -= k
        if not n:
            return
    raise Fail('short planks')


def logs_total(inv):
    return sum(inv.get(l, 0) for l in LOGS)


def take_log(inv):
    for l in LOGS:
        if inv.get(l, 0) > 0:
            inv[l] -= 1
            return l
    raise Fail('short logs')


def ensure_planks(inv, n):
    while planks_total(inv) < n:
        l = take_log(inv)
        inv[l.replace('_log', '_planks')] = inv.get(l.replace('_log', '_planks'), 0) + 4


def ensure_sticks(inv, n):
    while inv.get('stick', 0) < n:
        ensure_planks(inv, 2); take_planks(inv, 2); inv['stick'] = inv.get('stick', 0) + 4


def has_pick(inv, tier=0):
    order = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']
    return any(inv.get(p, 0) > 0 for p in order[tier:])


def ensure_table(st):
    if st['table_placed'] or st['inv'].get('crafting_table', 0) > 0:
        st['table_placed'] = True
        return
    ensure_planks(st['inv'], 4); take_planks(st['inv'], 4)
    st['table_placed'] = True


def craft_one(st, item):
    inv = st['inv']
    if item in PLANKS or item == 'planks':
        l = take_log(inv); out = l.replace('_log', '_planks') if item == 'planks' else item
        inv[out] = inv.get(out, 0) + 4; return
    if item == 'stick':
        ensure_planks(inv, 2); take_planks(inv, 2); inv['stick'] = inv.get('stick', 0) + 4; return
    if item == 'crafting_table':
        ensure_planks(inv, 4); take_planks(inv, 4); inv['crafting_table'] = inv.get('crafting_table', 0) + 1; return
    if item == 'torch':
        if inv.get('coal', 0) < 1 and inv.get('charcoal', 0) < 1:
            raise Fail('torch needs coal or charcoal')
        ensure_sticks(inv, 1)
        inv['coal' if inv.get('coal', 0) else 'charcoal'] -= 1; inv['stick'] -= 1; inv['torch'] = inv.get('torch', 0) + 4; return
    rec = TABLE_RECIPES.get(item)
    if rec is None:
        raise Fail('no known recipe for %s' % item)
    trial = copy.deepcopy(st)
    ti = trial['inv']
    ensure_table(trial)          # the table first: it competes with the recipe for planks
    # sticks before planks: making sticks consumes planks, so the plank top-up must come last
    for k, v in sorted(rec.items(), key=lambda kv: {'stick': 0, 'planks': 1}.get(kv[0], 2)):
        if k == 'planks':
            ensure_planks(ti, v)
        elif k == 'stick':
            ensure_sticks(ti, v)
        elif ti.get(k, 0) < v:
            raise Fail('short %dx %s' % (v - ti.get(k, 0), k))
    for k, v in rec.items():
        if k == 'planks':
            take_planks(ti, v)
        else:
            ti[k] -= v
    ti[item] = ti.get(item, 0) + 1
    st.clear(); st.update(trial)


def available(st, block):
    if block in st['visible']:
        return True
    if st['explored'] and block in st['explore_reveals']:
        return True
    if block in ('stone', 'cobblestone') and st['y'] < st['surface_y'] - 2:
        return True
    if block in ('coal_ore',) and st['y'] <= 50:
        return True
    if block in ('iron_ore', 'deepslate_iron_ore') and st['y'] <= 16:
        return True
    return False


def step(st, s):
    inv = st['inv']
    sk = s.get('skill'); args = s.get('args') or {}
    cnt = args.get('count') if isinstance(args.get('count'), int) and args.get('count') > 0 else 1
    cnt = min(cnt, 64)
    if sk == 'gather':
        b = args.get('block') or ''
        src = 'stone' if b == 'cobblestone' else b
        if not available(st, src):
            raise Fail('%s not available here' % b)
        if src == 'stone':
            if not has_pick(inv):
                raise Fail('stone needs a pickaxe')
            inv['cobblestone'] = inv.get('cobblestone', 0) + cnt
        elif src == 'coal_ore':
            if not has_pick(inv):
                raise Fail('coal_ore needs a pickaxe')
            inv['coal'] = inv.get('coal', 0) + cnt
        elif src in ('iron_ore', 'deepslate_iron_ore'):
            if not has_pick(inv, 1):
                raise Fail('iron ore needs a stone pickaxe')
            inv['raw_iron'] = inv.get('raw_iron', 0) + cnt
        else:
            inv[src] = inv.get(src, 0) + cnt
    elif sk == 'craft':
        it = args.get('item') or ''
        made = 0
        per = 4 if (it in PLANKS or it in ('stick', 'torch', 'planks')) else 1
        for _ in range(max(1, math.ceil(cnt / per))):
            craft_one(st, it); made += 1
    elif sk == 'smelt':
        it = args.get('item') or ''
        out = {'raw_iron': 'iron_ingot', 'sand': 'glass'}.get(it) or ('charcoal' if it in LOGS else None)
        if out is None:
            raise Fail('cannot smelt %s' % it)
        if inv.get(it, 0) < cnt:
            cnt = inv.get(it, 0)
            if cnt == 0:
                raise Fail('no %s to smelt' % it)
        if not (st['furnace_placed'] or inv.get('furnace', 0) > 0):
            raise Fail('no furnace')
        st['furnace_placed'] = True
        need = cnt
        fuel = 0.0
        for f, v in (('coal', 8), ('charcoal', 8)):
            while fuel < need and inv.get(f, 0) > 0:
                inv[f] -= 1; fuel += v
        while fuel < need and planks_total(inv) > 0:
            take_planks(inv, 1); fuel += 1.5
        while fuel < need and logs_total(inv) > 0 and logs_total(inv) > (cnt if it in LOGS else 0):
            take_log(inv); fuel += 1.5
        if fuel < need:
            raise Fail('no fuel')
        inv[it] -= cnt; inv[out] = inv.get(out, 0) + cnt
    elif sk == 'mine':
        y = args.get('y')
        if not isinstance(y, int) or y >= st['y']:
            raise Fail('mine target must be below current y')
        if not has_pick(inv):
            raise Fail('mine needs a pickaxe')
        inv['cobblestone'] = inv.get('cobblestone', 0) + min(64, st['y'] - y)
        st['y'] = y
    elif sk == 'surface':
        st['y'] = st['surface_y']
    elif sk == 'place':
        it = args.get('item')
        if it not in inv or inv[it] <= 0:
            raise Fail('place: not carried')
        if it == 'crafting_table':
            st['table_placed'] = True
        if it == 'furnace':
            st['furnace_placed'] = True
        inv[it] -= 1
    elif sk == 'explore':
        st['explored'] = True
    elif sk in ('goto', 'home', 'status', 'eat', 'deposit', 'withdraw'):
        pass
    else:
        raise Fail('unknown skill %s' % sk)


def simulate(sc, plan):
    st = {'inv': {k: v for k, v in sc['inventory'].items()}, 'y': sc['y'], 'surface_y': sc['y'],
          'visible': set(sc['visible']), 'explore_reveals': set(sc.get('explore_reveals', [])), 'explored': False,
          'table_placed': sc.get('table_placed', False), 'furnace_placed': False}
    goal = GOALS[sc['goal']]
    if not isinstance(plan, list):
        return {'reached': False, 'first_fail': 0, 'why': 'no plan list', 'steps': 0}
    for i, s in enumerate(plan[:30]):
        if goal(st['inv']):
            return {'reached': True, 'first_fail': None, 'steps': i}
        if not isinstance(s, dict):
            return {'reached': False, 'first_fail': i, 'why': 'step not an object', 'steps': i}
        try:
            step(st, s)
        except Fail as e:
            return {'reached': False, 'first_fail': i, 'why': str(e), 'steps': i}
    return {'reached': goal(st['inv']), 'first_fail': None, 'steps': min(len(plan), 30),
            'why': None if goal(st['inv']) else 'plan ended before the goal'}


def reference_plan(sc):
    """A short correct plan, greedy, used as the length yardstick and as the POSITIVE CONTROL."""
    plan = []
    inv = dict(sc['inventory'])
    vis = set(sc['visible'])
    logs_here = [l for l in LOGS if l in vis]
    if not logs_here and sc.get('explore_reveals'):
        plan.append({'skill': 'explore', 'args': {'blocks': 60}})
        logs_here = [l for l in LOGS if l in sc['explore_reveals']]
    lg = logs_here[0] if logs_here else 'oak_log'
    need_logs = {'stone_pickaxe': 3, 'iron_ingot': 6, 'iron_pickaxe': 7}[sc['goal']]
    if logs_total(inv) + planks_total(inv) / 4 < need_logs:
        plan.append({'skill': 'gather', 'args': {'block': lg, 'count': need_logs}})
    if not has_pick(inv):
        plan.append({'skill': 'craft', 'args': {'item': 'wooden_pickaxe', 'count': 1}})
    if sc['goal'] in ('stone_pickaxe',):
        if not has_pick(inv, 1):
            plan.append({'skill': 'mine', 'args': {'y': sc['y'] - 6}})
            plan.append({'skill': 'craft', 'args': {'item': 'stone_pickaxe', 'count': 1}})
        return plan
    if not has_pick(inv, 1):
        plan.append({'skill': 'mine', 'args': {'y': sc['y'] - 12}})
        plan.append({'skill': 'craft', 'args': {'item': 'stone_pickaxe', 'count': 1}})
    plan.append({'skill': 'mine', 'args': {'y': 12}})
    plan.append({'skill': 'craft', 'args': {'item': 'furnace', 'count': 1}})
    plan.append({'skill': 'gather', 'args': {'block': 'iron_ore', 'count': 3}})
    plan.append({'skill': 'gather', 'args': {'block': 'coal_ore', 'count': 2}})
    plan.append({'skill': 'smelt', 'args': {'item': 'raw_iron', 'count': 3}})
    if sc['goal'] == 'iron_pickaxe':
        plan.append({'skill': 'craft', 'args': {'item': 'iron_pickaxe', 'count': 1}})
    return plan


SYSTEM = """You are the PLANNER for one Minecraft bot. Its controller will run your plan one skill call at a time.
Write the shortest ORDERED PLAN of skill calls that reaches the goal from exactly the state given. Each step must
be executable at the moment it runs, given everything earlier steps produced. A step that cannot run ends the plan.

Skills (exactly these semantics):
  gather  {"block": "<block id>", "count": n}  -- collects n of a block that is AVAILABLE (in view, or revealed).
          Logs need no tool. stone (gives cobblestone) and coal_ore (gives coal) need a pickaxe; iron_ore (gives
          raw_iron) needs a stone_pickaxe or better.
  craft   {"item": "<item id>", "count": n}    -- resolves its WHOLE recipe tree from what you carry: logs ->
          planks -> sticks, and it crafts and places a crafting_table itself if the recipe needs one.
          1 log -> 4 planks; 2 planks -> 4 sticks; 4 planks -> crafting_table; 3 planks + 2 sticks ->
          wooden_pickaxe; 3 cobblestone + 2 sticks -> stone_pickaxe; 8 cobblestone -> furnace;
          3 iron_ingot + 2 sticks -> iron_pickaxe.
  smelt   {"item": "<raw item>", "count": n}   -- raw_iron -> iron_ingot. Needs a furnace (carried or placed;
          it places a carried one) and fuel you carry: coal or charcoal (8 items each), planks or logs (1.5 each).
  mine    {"y": <absolute elevation BELOW your current y>}  -- needs a pickaxe; staircases down and yields the
          cobblestone it digs (about 1 per block descended). Stone is reached a few blocks down; coal at y<=50;
          iron ore only at y<=16 unless one is already in view.
  explore {"blocks": 60} -- travels to new ground; reveals what the state lists under "found by exploring".
  surface {} -- climbs back up.   place {"item": "<carried item>"}.
Answer with JSON only: {"plan": [{"skill": ..., "args": {...}}, ...], "why": "<one sentence>"}. At most 20 steps."""

PLAN_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['plan', 'why'],
    'properties': {
        'plan': {'type': 'array', 'maxItems': 20, 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['skill', 'args'],
            'properties': {
                'skill': {'type': 'string', 'enum': ['gather', 'craft', 'smelt', 'mine', 'explore', 'surface', 'place',
                                                     'goto', 'home', 'status', 'eat', 'deposit', 'withdraw']},
                'args': {'type': 'object', 'additionalProperties': False, 'properties': {
                    'block': {'type': 'string', 'maxLength': 32, 'pattern': '^[a-z0-9_]{1,32}$'},
                    'item': {'type': 'string', 'maxLength': 32, 'pattern': '^[a-z0-9_]{1,32}$'},
                    'count': {'type': 'integer'}, 'y': {'type': 'integer'}, 'blocks': {'type': 'integer'},
                    'x': {'type': 'integer'}, 'z': {'type': 'integer'}}}}}},
        'why': {'type': 'string', 'maxLength': 300},
    },
}


def scenario_text(sc):
    inv = ', '.join('%s x%d' % (k, v) for k, v in sorted(sc['inventory'].items()) if v > 0) or 'nothing'
    lines = ['GOAL: %s.' % GOAL_TEXT[sc['goal']],
             'ELEVATION: you are at y=%d on the surface.' % sc['y'],
             'INVENTORY: %s' % inv,
             'IN VIEW (available to gather now): %s' % (', '.join(sorted(sc['visible'])) or 'nothing useful'),
             'A crafting_table is %s.' % ('already placed next to you' if sc.get('table_placed') else 'not placed nearby')]
    if sc.get('explore_reveals'):
        lines.append('FOUND BY EXPLORING (only after an explore step): %s' % ', '.join(sorted(sc['explore_reveals'])))
    return '\n'.join(lines)


TOOLS_DROP = ('wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'crafting_table', 'furnace', 'iron_ingot',
              'raw_iron', 'cobblestone', 'coal', 'charcoal', 'stick') + PLANKS + LOGS


def cmd_make():
    rng = random.Random(33)
    items = [json.loads(l) for f in sorted(glob.glob(os.path.join(HERE, 'data', 'mbench-sample*.jsonl'))) for l in open(f)]
    from score import facts
    pool = [it for it in items if it['set'] == 'brain']
    rng.shuffle(pool)
    out = []
    kinds = ['plain', 'plain', 'no_logs_in_view', 'stripped', 'some_progress']
    goals = ['stone_pickaxe', 'iron_ingot', 'iron_pickaxe']
    for it in pool:
        if len(out) >= 30:
            break
        f = facts(it['prompt_text'])
        if f['y'] is None or not (58 <= f['y'] <= 100):
            continue
        k = kinds[len(out) % len(kinds)]
        goal = goals[(len(out) // len(kinds)) % 3]
        inv = {a: b for a, b in f['inv'].items() if a in TOOLS_DROP or a in ('dirt', 'sand', 'apple')}
        vis = set(b for b in f['seen'] if b in LOGS + ('stone', 'coal_ore', 'iron_ore', 'sand', 'dirt', 'grass_block'))
        sc = {'goal': goal, 'y': f['y'], 'inventory': inv, 'visible': sorted(vis), 'kind': k, 'from': it['id']}
        if k == 'stripped':          # nothing useful carried
            sc['inventory'] = {a: b for a, b in inv.items() if a in ('dirt', 'apple')}
        if k == 'no_logs_in_view':   # trees only after exploring
            sc['visible'] = sorted(v for v in vis if v not in LOGS)
            sc['explore_reveals'] = ['oak_log', 'birch_log']
            sc['inventory'] = {a: b for a, b in inv.items() if a not in LOGS + PLANKS}
        if k == 'some_progress':     # holds a wooden pickaxe and a few logs
            sc['inventory'] = {'wooden_pickaxe': 1, 'oak_log': 2, 'stick': 1}
        if not any(l in sc['visible'] for l in LOGS) and not sc.get('explore_reveals'):
            sc['visible'] = sorted(set(sc['visible']) | {'oak_log'})
        if GOALS[goal](sc['inventory']):
            continue
        sc['id'] = 'b3-%03d' % len(out)
        sc['set'] = 'b3'
        sc['role'] = 'slow'
        sc['num_ctx'] = 8192
        sc['messages'] = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': scenario_text(sc)}]
        sc['schema'] = PLAN_SCHEMA
        out.append(sc)
    with open(os.path.join(HERE, 'data', 'stage-b3.jsonl'), 'w') as fh:
        for sc in out:
            fh.write(json.dumps(sc) + '\n')
    print('wrote', len(out), {g: sum(1 for s in out if s['goal'] == g) for g in goals})


def cmd_control():
    scs = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b3.jsonl'))]
    ok = sum(simulate(sc, reference_plan(sc))['reached'] for sc in scs)
    print('POSITIVE CONTROL: reference planner reaches the goal in %d/%d scenarios' % (ok, len(scs)))
    for sc in scs:
        r = simulate(sc, reference_plan(sc))
        if not r['reached']:
            print('  ref FAILS', sc['id'], sc['goal'], sc['kind'], r, sc['inventory'], sc['visible'])
    # NEGATIVE CONTROLS: skipping the pickaxe, or smelting before any furnace, must fail.
    bad = 0
    for sc in scs:
        p = [s for s in reference_plan(sc) if not (s['skill'] == 'craft' and s['args']['item'].endswith('pickaxe'))]
        if not has_pick(sc['inventory']) and not simulate(sc, p)['reached']:
            bad += 1
    print('NEGATIVE CONTROL: plan with the pickaxe crafts removed fails in %d of the scenarios that start without one' % bad)


def cmd_score(paths):
    from score import parse_answer
    scs = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b3.jsonl'))}
    res = {}
    for p in paths:
        recs = {}
        for l in open(p):
            r = json.loads(l)
            if r['id'] in scs:
                recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        n = reached = valid = 0
        extra = []
        whys = {}
        for i, sc in scs.items():
            r = recs.get(i)
            if r is None:
                continue
            n += 1
            a = None if r.get('error') else parse_answer(r.get('content'))
            plan = a.get('plan') if isinstance(a, dict) else None
            if isinstance(plan, list):
                valid += 1
            sim = simulate(sc, plan)
            reached += sim['reached']
            if sim['reached']:
                extra.append(sim['steps'])     # steps used (the reference plan is a yardstick, not a minimum)
            else:
                k = re.sub(r'\d+', 'N', str(sim.get('why')))
                whys[k] = whys.get(k, 0) + 1
        res[lab] = {'n': n, 'valid': valid, 'reached': reached,
                    'reached_pct': round(100.0 * reached / n, 1) if n else None,
                    'mean_steps': round(sum(extra) / len(extra), 2) if extra else None,
                    'fail_reasons': dict(sorted(whys.items(), key=lambda kv: -kv[1])[:6])}
        print('%-22s n=%2d valid=%2d reached=%2d (%s%%) mean_steps=%s  %s' % (lab, n, valid, reached, res[lab]['reached_pct'],
              res[lab]['mean_steps'], res[lab]['fail_reasons']))
    return res


if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'make':
        cmd_make()
    elif c == 'control':
        cmd_control()
    elif c == 'score':
        cmd_score(sys.argv[2:])
