#!/usr/bin/env python3
"""Stage B2: overseer allocation problems with a KNOWN OPTIMUM.

    python3 stage_b_allocation.py make       # -> data/stage-b2.jsonl (60 problems: 30 x 4 bots, 30 x 8 bots)
    python3 stage_b_allocation.py control
    python3 stage_b_allocation.py score out/*.jsonl

Bots are real: position, best pickaxe, free bag slots, trapped flag and carried wood come from the shadow mayor's
snapshots (8-bot problems join two worlds' rosters). Tasks are placed on real resource sightings. The objective
is stated in the prompt, so the best answer is computable: maximise the sum over assignments of
  value(task) - 0.05 * distance(bot, task)
subject to the stated eligibility rules, task capacities and one task per bot (idle is allowed, worth 0). The
optimum comes from an exact assignment solver (Hungarian on bots x task slots + idle columns).

Score per answer: any rule violation (ineligible bot, over capacity, a bot twice, unknown id); utility achieved by
the VALID assignments / the optimum; exact optimum (equal utility, within 1e-6); correct abstention on problems
where nobody is eligible. Baselines: nearest-eligible greedy and random-eligible.
"""
import glob, json, math, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
COST = 0.05
VALUES = {'free_bag': 10.0, 'craft_pickaxe': 12.0, 'mine_iron': 8.0, 'chop_wood': 5.0}
CAPS = {'free_bag': 1, 'craft_pickaxe': 1, 'mine_iron': 2, 'chop_wood': 2}

SYSTEM = """You are the overseer of a Minecraft town. You assign bots to tasks for the next 10 minutes.
Maximise the TOTAL SCORE = sum over your assignments of (task value - 0.05 x distance in blocks from the bot to the
task). Leaving a bot idle scores 0, so never make an assignment whose score would be negative.

Eligibility rules (an assignment that breaks one is invalid and is thrown away):
- A trapped bot can do nothing.
- mine_iron: the bot needs a stone or iron pickaxe ("best_pick" stone/iron with uses_left >= 32) and free_slots >= 2.
- chop_wood: the bot needs free_slots >= 3.
- free_bag: only the bot named in the task ("for"), and only if that bot is not trapped.
- craft_pickaxe: only the bot named in the task, and only if it carries wood_eq >= 3 (logs, planks/4).
- Each task has a capacity (how many bots it takes). One task per bot. Use only the bot and task ids given.
Distances: straight-line in 3-D between the bot's pos and the task's pos (x, y, z).
Answer with JSON only: {"assignments": [{"bot": "<bot id>", "task": "<task id>"}], "why": "<one sentence>"}."""

SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['assignments', 'why'],
          'properties': {'assignments': {'type': 'array', 'maxItems': 8, 'items': {
              'type': 'object', 'additionalProperties': False, 'required': ['bot', 'task'],
              'properties': {'bot': {'type': 'string', 'maxLength': 8}, 'task': {'type': 'string', 'maxLength': 8}}}},
              'why': {'type': 'string', 'maxLength': 300}}}


def dist(a, b):
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in 'xyz'))


def eligible(bot, task):
    if bot['trapped']:
        return False
    k = task['kind']
    if k == 'mine_iron':
        return bot['best_pick'] in ('stone', 'iron') and bot['uses_left'] >= 32 and bot['free_slots'] >= 2
    if k == 'chop_wood':
        return bot['free_slots'] >= 3
    if k == 'free_bag':
        return task['for'] == bot['id']
    if k == 'craft_pickaxe':
        return task['for'] == bot['id'] and bot['wood_eq'] >= 3
    return False


def util(bot, task):
    return task['value'] - COST * dist(bot['pos'], task['pos'])


def hungarian(cost):
    """Min-cost assignment for a rectangular matrix (rows <= cols). Returns col index per row."""
    n, m = len(cost), len(cost[0])
    INF = float('inf')
    u = [0.0] * (n + 1); v = [0.0] * (m + 1); p = [0] * (m + 1); way = [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i; j0 = 0
        minv = [INF] * (m + 1); used = [False] * (m + 1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur; way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]; j1 = j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta; v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
            if j0 == 0:
                break
    ans = [None] * n
    for j in range(1, m + 1):
        if p[j]:
            ans[p[j] - 1] = j - 1
    return ans


def optimum(pr):
    bots, tasks = pr['bots'], pr['tasks']
    cols = [(t, s) for t in tasks for s in range(t['cap'])] + [(None, i) for i in range(len(bots))]
    big = 1e6
    cost = []
    for b in bots:
        row = []
        for t, _ in cols:
            if t is None:
                row.append(0.0)
            elif eligible(b, t) and util(b, t) > 0:
                row.append(-util(b, t))
            else:
                row.append(big)
        cost.append(row)
    a = hungarian(cost)
    tot = 0.0; asg = []
    for bi, cj in enumerate(a):
        t = cols[cj][0]
        if t is not None and cost[bi][cj] < big:
            tot += util(bots[bi], t); asg.append((bots[bi]['id'], t['id']))
    return tot, asg


def evaluate(pr, answer):
    bots = {b['id']: b for b in pr['bots']}
    tasks = {t['id']: t for t in pr['tasks']}
    used_b, load, tot, viol = set(), {}, 0.0, []
    for a in (answer or {}).get('assignments') or []:
        if not isinstance(a, dict):
            viol.append('not_object'); continue
        b, t = bots.get(a.get('bot')), tasks.get(a.get('task'))
        if b is None or t is None:
            viol.append('unknown_id'); continue
        if b['id'] in used_b:
            viol.append('bot_twice'); continue
        if not eligible(b, t):
            viol.append('ineligible:' + t['kind']); continue
        if load.get(t['id'], 0) >= t['cap']:
            viol.append('over_capacity'); continue
        used_b.add(b['id']); load[t['id']] = load.get(t['id'], 0) + 1
        tot += util(b, t)
    return tot, viol


def greedy(pr, rng=None):
    pairs = [(b, t) for b in pr['bots'] for t in pr['tasks'] if eligible(b, t) and util(b, t) > 0]
    if rng:
        rng.shuffle(pairs)
    else:
        pairs.sort(key=lambda bt: dist(bt[0]['pos'], bt[1]['pos']))
    used, load, out = set(), {}, []
    for b, t in pairs:
        if b['id'] in used or load.get(t['id'], 0) >= t['cap']:
            continue
        used.add(b['id']); load[t['id']] = load.get(t['id'], 0) + 1; out.append({'bot': b['id'], 'task': t['id']})
    return {'assignments': out}


def roster(snap):
    out = []
    for b in snap['bots']:
        if not b.get('pos'):
            continue
        bp = b.get('best_pick') or {}
        tier = str(bp.get('name') or 'none_').split('_')[0] if bp else 'none'
        out.append({'name': b['name'], 'pos': {k: round(b['pos'][k]) for k in 'xyz'}, 'best_pick': tier,
                    'uses_left': int(bp.get('uses_left') or 0) if bp else 0,
                    'free_slots': int(b.get('free_slots_est') or 0), 'trapped': bool(b.get('trapped')),
                    'wood_eq': round(float(b.get('log_eq') or 0), 2), 'slots_used': int(b.get('slots_est') or 0)})
    return out


def cmd_make():
    rng = random.Random(77)
    snaps = [json.loads(l)['snap'] for l in open(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))]
    out = []
    while len(out) < 60:
        nb = 4 if len(out) < 30 else 8
        s1 = rng.choice(snaps)
        bots = roster(s1)
        if nb == 8:
            s2 = rng.choice(snaps)
            off = rng.choice([-60, 60])
            for b in roster(s2):
                b = dict(b); b['pos'] = dict(b['pos']); b['pos']['x'] += off; b['name'] += '*'
                bots.append(b)
        if len(bots) < nb:
            continue
        rng.shuffle(bots)
        bots = bots[:nb]
        # perturb a little so the same snapshot never yields the same problem
        for b in bots:
            if rng.random() < 0.25:
                b['free_slots'] = rng.choice([0, 1, 2, 5, 9])
            if rng.random() < 0.15:
                b['trapped'] = not b['trapped']
        if len(out) % 10 == 9:          # nobody can do anything: abstention is the right answer
            for b in bots:
                b['trapped'] = True
        for i, b in enumerate(bots):
            b['id'] = 'B%d' % (i + 1)
        res = [r for r in s1['resources'] if r['kind'].endswith('_log') or 'iron' in r['kind']]
        rng.shuffle(res)
        tasks = []
        for r in res[:rng.randint(2, 4)]:
            kind = 'mine_iron' if 'iron' in r['kind'] else 'chop_wood'
            tasks.append({'kind': kind, 'pos': {'x': r['x'], 'y': r['y'], 'z': r['z']}, 'resource': r['kind']})
        full = [b for b in bots if b['free_slots'] <= 2]
        for b in full[:2]:
            tasks.append({'kind': 'free_bag', 'for': b['id'], 'pos': dict(b['pos'])})
        nopick = [b for b in bots if b['best_pick'] in ('none', 'wooden') or b['uses_left'] < 5]
        for b in nopick[:2]:
            tasks.append({'kind': 'craft_pickaxe', 'for': b['id'], 'pos': dict(b['pos'])})
        if not tasks:
            continue
        for i, t in enumerate(tasks):
            t['id'] = 'T%d' % (i + 1); t['value'] = VALUES[t['kind']]; t['cap'] = CAPS[t['kind']]
        pr = {'id': 'b2-%03d' % len(out), 'set': 'b2', 'role': 'slow', 'num_ctx': 8192, 'n_bots': nb,
              'bots': [{k: b[k] for k in ('id', 'pos', 'best_pick', 'uses_left', 'free_slots', 'trapped', 'wood_eq')} for b in bots],
              'tasks': tasks}
        opt, asg = optimum(pr)
        pr['optimum'] = round(opt, 6); pr['optimal_assignment'] = asg
        view = {'bots': pr['bots'], 'tasks': [{k: t[k] for k in ('id', 'kind', 'pos', 'value', 'cap') + (('for',) if 'for' in t else ())} for t in tasks]}
        pr['messages'] = [{'role': 'system', 'content': SYSTEM},
                          {'role': 'user', 'content': 'PROBLEM\n' + json.dumps(view, separators=(',', ':'))}]
        pr['schema'] = SCHEMA
        out.append(pr)
    with open(os.path.join(HERE, 'data', 'stage-b2.jsonl'), 'w') as fh:
        for pr in out:
            fh.write(json.dumps(pr) + '\n')
    print('wrote', len(out), 'abstain-correct problems:', sum(1 for p in out if not p['optimal_assignment']))


def brute(pr):
    """Exhaustive check of the solver on small problems (positive control)."""
    bots, tasks = pr['bots'], pr['tasks']
    best = 0.0
    def rec(i, load, tot):
        nonlocal best
        if i == len(bots):
            best = max(best, tot); return
        rec(i + 1, load, tot)
        for t in tasks:
            if eligible(bots[i], t) and load.get(t['id'], 0) < t['cap'] and util(bots[i], t) > 0:
                load[t['id']] = load.get(t['id'], 0) + 1
                rec(i + 1, load, tot + util(bots[i], t))
                load[t['id']] -= 1
    rec(0, {}, 0.0)
    return best


def cmd_control():
    prs = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b2.jsonl'))]
    agree = sum(abs(brute(p) - p['optimum']) < 1e-6 for p in prs)
    print('POSITIVE CONTROL: Hungarian optimum == exhaustive search on %d/%d problems' % (agree, len(prs)))
    rng = random.Random(5)
    for name, f in (('nearest', lambda p: greedy(p)), ('random', lambda p: greedy(p, rng))):
        ex = sum(abs(evaluate(p, f(p))[0] - p['optimum']) < 1e-6 for p in prs)
        ratio = sum(evaluate(p, f(p))[0] / p['optimum'] for p in prs if p['optimum'] > 0) / sum(1 for p in prs if p['optimum'] > 0)
        print('BASELINE %-8s exact optimum %d/%d, mean utility/optimum %.3f' % (name, ex, len(prs), ratio))
    bad = {'assignments': [{'bot': p['bots'][0]['id'], 'task': p['tasks'][0]['id']} for p in prs[:1]]}
    print('NEGATIVE CONTROL: an all-trapped problem with an assignment ->',
          [evaluate(p, {'assignments': [{'bot': p['bots'][0]['id'], 'task': p['tasks'][0]['id']}]})[1] for p in prs if not p['optimal_assignment']][:3])


def cmd_score(paths):
    from score import parse_answer
    prs = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b2.jsonl'))}
    res = {}
    for p in paths:
        recs = {}
        for l in open(p):
            r = json.loads(l)
            if r['id'] in prs:
                recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        n = exact = viol = absn = abs_ok = 0
        ratios = []
        vk = {}
        for i, pr in prs.items():
            r = recs.get(i)
            if r is None:
                continue
            n += 1
            a = None if r.get('error') else parse_answer(r.get('content'))
            tot, v = evaluate(pr, a if isinstance(a, dict) else {})
            if a is None:
                v = v + ['no_json']
            viol += bool(v)
            for x in v:
                k = x.split(':')[0]; vk[k] = vk.get(k, 0) + 1
            exact += (abs(tot - pr['optimum']) < 1e-6 and not v)
            if pr['optimum'] > 0:
                ratios.append(tot / pr['optimum'])
            else:
                absn += 1
                abs_ok += (not (a or {}).get('assignments')) if isinstance(a, dict) else 0
        res[lab] = {'n': n, 'exact_optimum': exact, 'any_violation': viol,
                    'utility_ratio': round(sum(ratios) / len(ratios), 3) if ratios else None,
                    'abstain_ok': '%d/%d' % (abs_ok, absn), 'violations': vk}
        print('%-22s n=%2d exact=%2d viol=%2d util/opt=%s abstain=%s %s' % (lab, n, exact, viol, res[lab]['utility_ratio'],
              res[lab]['abstain_ok'], vk))
    return res


if __name__ == '__main__':
    {'make': lambda: cmd_make(), 'control': lambda: cmd_control(), 'score': lambda: cmd_score(sys.argv[2:])}[sys.argv[1]]()
