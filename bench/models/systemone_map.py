#!/usr/bin/env python3
"""Brain replay item -> System One choice questions -> the fleet's {skill, args} proposal. PURE functions only
(no I/O); the engine that asks the questions is systemone_engine.py. Python 3.9, stdlib only.

Decision models (Liquid AI d1-3B, Cloudflare Clef-flash) do not write JSON: they take a state plus named questions
and return a probability for every option of every question, in one forward pass. So a brain decision becomes:

  1. `skill`  one choice over the ADMITTED skills: the item's own schema enum, minus a skill whose argument list in
              the prompt is empty (craft with no CAN CRAFT NOW, smelt with no CAN SMELT NOW, deposit/place with an
              empty bag, bucket with no bucket, goto with no known home and no player, mine with no elevation).
  2. its args, each one choice from the prompt's own lists:
              gather.block  NEARBY / BLOCK CHECKS / "<block> seen at" (the HINT's block first)
              craft.item    CAN CRAFT NOW          smelt.item  CAN SMELT NOW (the raw side)
              deposit.item  "everything" + INVENTORY            place.item / build.block  INVENTORY
              withdraw.item the TASK/HINT item + a fixed list of town stock (no prompt list names chest contents)
              goto          "home" or a player named in the prompt (goto.player)
              bucket.action fill / pour           build.plan  the schema's plan enum
              count         bucketed: 1 4 8 16 32 64          explore.blocks  bucketed: 30 60 80 120
  3. COORDINATES ARE NOT DECIDED BY THE MODEL (they cannot be options): goto home copies KNOWN PLACES home(x,y,z);
     mine.y = min(the printed mine ceiling, 16), floored at -58. Every proposal carries `decided`, naming which
     arg came from the model and which from code, so a score on a coordinate key is reported as code's, not the
     model's.

The d1 readout is ported from LiquidAI/d1-3B prompt.py (render + readout, string state, no system turn, no lead,
option_style "desc", calibration None): the prompt stops at the assistant header and each option's probability is
a softmax over the log-probabilities of its single-token code ("A" or " A", the best form).
"""
import json, math, re

COUNT_BUCKETS = (1, 4, 8, 16, 32, 64)
EXPLORE_BUCKETS = (30, 60, 80, 120)
MAX_OPTIONS = 26          # A..Z: one single-token code each (prompt.py's own first rule)
MINE_ORE_Y = 16           # "ores are below y=16" (the fleet system prompt)
WORLD_FLOOR_Y = -58
WITHDRAW_STOCK = ('wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'torch', 'oak_log', 'oak_planks', 'stick',
                  'cobblestone', 'coal', 'iron_ingot', 'raw_iron', 'bread')
TOOL_RE = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$')
NOT_PLACEABLE = {'stick', 'coal', 'charcoal', 'flint', 'apple', 'bread', 'raw_iron', 'raw_copper', 'iron_ingot',
                 'copper_ingot', 'bone_meal', 'bucket', 'water_bucket', 'wheat_seeds', 'egg', 'brown_egg', 'feather',
                 'string', 'bone', 'rotten_flesh', 'gunpowder', 'leather'}

SKILL_DESC = {
    'gather': 'collect a block that is in view',
    'goto': 'walk to home or to a player',
    'home': 'walk home to the town',
    'deposit': 'bank items in the town chest (walks home first)',
    'withdraw': 'take an item from the town chests (walks home first)',
    'status': 'report status, no movement',
    'eat': 'eat food from the inventory',
    'craft': 'craft an item listed in CAN CRAFT NOW',
    'place': 'place an inventory item next to you',
    'bucket': 'fill or pour a water bucket',
    'build': 'build a small structure from a block you carry',
    'explore': 'travel away from spawn looking for new ground',
    'mine': 'staircase DOWNWARD to a lower elevation',
    'smelt': 'cook a raw item in a furnace',
    'board': 'walk to the town board to file and read reports',
    'surface': 'climb out when stuck below ground',
}


# ------------------------------------------------------------------ prompt facts ----------------------------------
def _uniq(xs):
    out, seen = [], set()
    for x in xs:
        if x and x not in seen:
            out.append(x); seen.add(x)
    return out


def line(text, prefix):
    m = re.search(r'^' + re.escape(prefix) + r'([^\n]*)', text, re.M)
    return m.group(1) if m else None


def parse_prompt(user, system=''):
    """The lists the questions draw from, in prompt order. -> dict"""
    f = {}
    m = re.search(r'position (-?\d+),(-?\d+),(-?\d+)', user)
    f['y'] = int(m.group(2)) if m else None
    m = re.search(r'you must pass y=(-?\d+) or lower', user)
    f['mine_cap'] = int(m.group(1)) if m else (f['y'] - 1 if f['y'] is not None else None)
    cc = line(user, 'CAN CRAFT NOW: ')
    f['craftable'] = _uniq(x.strip() for x in cc.split('(')[0].split(',')) if cc else []
    cs = line(user, 'CAN SMELT NOW: ')
    f['smeltable'] = _uniq(re.findall(r'([a-z0-9_]+) ->', cs)) if cs else []
    f['inventory'] = _uniq(re.findall(r'([a-z0-9_]+) x\d+', line(user, 'INVENTORY: ') or ''))
    blocks = re.findall(r'([a-z0-9_]+)@', line(user, 'NEARBY: ') or '')
    blocks += re.findall(r'([a-z0-9_]+) visible=', line(user, 'BLOCK CHECKS') or '')
    blocks += re.findall(r'^\s*- ([a-z0-9_]+) seen at x=', user, re.M)
    hb = re.search(r'block=([a-z0-9_]+)', line(user, 'HINT: ') or '')
    f['hint_block'] = hb.group(1) if hb else None
    f['blocks'] = _uniq(([f['hint_block']] if f['hint_block'] else []) + blocks)
    tm = re.search(r'^(?:Collect|Craft|Smelt|Get|Withdraw) \d+ ([a-z0-9_]+)', line(user, 'TASK: ') or '')
    f['task_item'] = tm.group(1) if tm else None
    km = re.search(r'home\((-?\d+),(-?\d+),(-?\d+)\)', line(user, 'KNOWN PLACES: ') or '')
    f['home'] = tuple(int(v) for v in km.groups()) if km else None
    me = re.search(r'You are ([A-Za-z0-9_-]+),', system or '')
    f['self'] = me.group(1) if me else None
    f['players'] = [n for n in _uniq(re.findall(r'\b([a-z]+-[a-z0-9]+-[A-Z][a-z]+)\b', user)) if n != f['self']]
    m = re.search(r'^saw_end: (\S+)', user, re.M)
    f['sentinel'] = m.group(1) if m else None
    return f


# ------------------------------------------------------------------ questions -------------------------------------
def _cap(xs):
    return list(xs)[:MAX_OPTIONS]


def arg_options(skill, f, schema=None):
    """-> [(arg_name, [option labels])] for the args the MODEL chooses. An empty option list for a needed arg means
    the skill is not admitted."""
    sch = (((schema or {}).get('properties') or {}).get('args') or {}).get('properties') or {}
    counts = [str(c) for c in COUNT_BUCKETS]
    if skill == 'gather':
        return [('block', _cap(f['blocks'])), ('count', counts)]
    if skill == 'craft':
        return [('item', _cap(f['craftable'])), ('count', counts)]
    if skill == 'smelt':
        return [('item', _cap(f['smeltable'])), ('count', counts)]
    if skill == 'deposit':
        return [('item', _cap(['everything'] + f['inventory']) if f['inventory'] else [])]
    if skill == 'place':
        return [('item', _cap(f['inventory']))]
    if skill == 'withdraw':
        return [('item', _cap(_uniq([f['task_item'], f['hint_block']] + list(WITHDRAW_STOCK)))), ('count', counts)]
    if skill == 'bucket':
        has = any(i in ('bucket', 'water_bucket') for i in f['inventory'])
        return [('action', ['fill', 'pour'] if has else [])]
    if skill == 'build':
        plans = (sch.get('plan') or {}).get('enum') or ['pillar']
        blocks = [i for i in f['inventory'] if not TOOL_RE.search(i) and i not in NOT_PLACEABLE]
        return [('plan', list(plans)), ('block', _cap(blocks))]
    if skill == 'goto':
        return [('dest', _cap((['home'] if f['home'] else []) + f['players']))]
    if skill == 'mine':
        return [] if f['mine_cap'] is not None else [('y', [])]
    if skill == 'explore':
        return [('blocks', [str(b) for b in EXPLORE_BUCKETS])]
    return []


def admitted_skills(schema, f):
    """The schema's skill enum, minus skills with no option for a needed arg. -> (admitted, excluded)"""
    enum = (((schema or {}).get('properties') or {}).get('skill') or {}).get('enum') or list(SKILL_DESC)
    ok, out = [], []
    for s in enum:
        (out if any(not opts for _, opts in arg_options(s, f, schema)) else ok).append(s)
    return ok, out


def skill_question(admitted):
    return {'type': 'choice',
            'instructions': 'Which ONE skill should run next to best advance the TASK? Follow the rules above. If an '
                            'action just failed or was rejected, do not repeat it identically.',
            'criteria': {s: '%s: %s' % (s, SKILL_DESC.get(s, s)) for s in admitted}}


ARG_INSTR = {
    'block': 'Which block should %s target?', 'item': 'Which item should %s use?',
    'count': 'How many items should %s aim for?', 'action': 'Which bucket action?',
    'plan': 'Which structure should build make?', 'dest': 'Where should goto go?',
    'blocks': 'How far should explore travel, in blocks?',
}


def arg_questions(skill, f, schema=None):
    """-> {'<skill>.<arg>': question} for the chosen skill's model-decided args, in arg order."""
    qs = {}
    for name, opts in arg_options(skill, f, schema):
        crit = {}
        for o in opts:
            if name == 'dest':
                crit[o] = 'home, the town' if o == 'home' else 'the player %s' % o
            elif name == 'item' and o == 'everything':
                crit[o] = 'everything carried'
            else:
                crit[o] = o.replace('_', ' ')
        instr = ARG_INSTR.get(name, 'Which %s?' % name)
        qs['%s.%s' % (skill, name)] = {'type': 'choice', 'instructions': instr % skill if '%s' in instr else instr,
                                       'criteria': crit}
    return qs


def mine_y(f):
    return max(WORLD_FLOOR_Y, min(f['mine_cap'], MINE_ORE_Y))


def to_proposal(skill, arg_answers, f):
    """skill + {arg_name: chosen label} -> ({reason, skill, args, saw_end}, decided)   decided: {arg: model|code}"""
    args, decided = {}, {'skill': 'model'}
    for name, val in arg_answers.items():
        if name in ('count', 'blocks'):
            args[name] = int(val); decided[name] = 'model'
        elif name == 'item' and val == 'everything':
            decided['item'] = 'model (everything: item omitted)'
        elif name == 'dest':
            if val == 'home':
                args.update(x=f['home'][0], y=f['home'][1], z=f['home'][2])
                decided.update(dest='model', x='code', y='code', z='code')
            else:
                args['player'] = val; decided['player'] = 'model'
        else:
            args[name] = val; decided[name] = 'model'
    if skill == 'mine':
        args['y'] = mine_y(f); decided['y'] = 'code'
    return {'reason': 'system one choice', 'skill': skill, 'args': args, 'saw_end': f.get('sentinel') or ''}, decided


def valid_choice(q, ans):
    """A backend's answer names one of the question's own options."""
    return isinstance(ans, dict) and ans.get('choice') in (q.get('criteria') or {})


def representable(skill, args, f, schema=None):
    """Can this mapping produce an action with the same score.key_of as (skill, args)? A failed action it cannot
    produce (craft of an item not in CAN CRAFT NOW, a block not in view, ...) cannot be repeated, so counting it as
    'not repeated' credits the adapter, not the model. Coordinate keys count as representable (code sets them)."""
    args = args or {}
    admitted, _ = admitted_skills(schema, f)
    if skill not in admitted:
        return False
    opts = dict(arg_options(skill, f, schema))
    key_arg = {'gather': 'block', 'craft': 'item', 'smelt': 'item', 'place': 'item', 'withdraw': 'item',
               'deposit': 'item', 'bucket': 'action', 'build': 'plan'}.get(skill)
    if key_arg is None:
        if skill == 'goto' and args.get('player'):
            return args['player'] in opts.get('dest', [])
        return True
    v = args.get(key_arg)
    if skill == 'deposit' and not v:
        return True
    return v in opts.get(key_arg, [])


def coordinate_key(skill, args):
    """True when score.key_of keys this action on a coordinate (goto x,y,z; mine y), which code sets here."""
    return skill == 'mine' or (skill == 'goto' and not (args or {}).get('player'))


# ------------------------------------------------------------------ d1 render + readout (prompt.py port) ----------
BOS, IM_START, IM_END = '<|startoftext|>', '<|im_start|>', '<|im_end|>'


def option_codes(labels):
    labs = [str(x).strip() for x in labels]
    if labs and all(len(k) == 1 and k.isalpha() for k in labs):
        return labs
    if len(labs) <= 26:
        return [chr(ord('A') + i) for i in range(len(labs))]
    return ['%02d' % i for i in range(len(labs))]


def render_d1(state, q, bos=BOS):
    """prompt.render for a string state and a choice question (system 'none', lead '', option_style 'desc')."""
    labels = list(q['criteria'])
    lines = '\n'.join('%s %s' % (c, q['criteria'][l] or l.replace('_', ' ')) for c, l in zip(option_codes(labels), labels))
    return ('%s%suser\n%s\n\n\nQUESTION:\n%s\n\nOptions:\n%s\n\nReply with the option code only.%s\n%sassistant\n'
            % (bos, IM_START, state, q['instructions'], lines, IM_END, IM_START))


def readout(top, labels):
    """top: {token: logprob} at the answer slot (top-k only). Each option scores its best form ('A' or ' A'); an
    option absent from the top-k gets the smallest top-k logprob (an upper bound). -> (probs, n_missing)"""
    floor = min(top.values()) if top else 0.0
    scores, missing = [], 0
    for c in option_codes(labels):
        v = [top[t] for t in (c, ' ' + c) if t in top]
        missing += not v
        scores.append(max(v) if v else floor)
    m = max(scores)
    e = [math.exp(s - m) for s in scores]
    return [x / sum(e) for x in e], missing


def answer(labels, probs):
    best = max(range(len(probs)), key=probs.__getitem__)
    return {'type': 'choice', 'choice': labels[best], 'confidence': probs[best],
            'probabilities': dict(zip(labels, probs))}


def state_text(system, user):
    """The state a decision model sees: the fleet's system prompt (rules, skills) then the observation, without the
    saw_end sentinel line (a JSON-echo check with no meaning here)."""
    u = re.sub(r'^saw_end: \S+[ \t]*\n?', '', user, flags=re.M)
    return (system or '').rstrip() + '\n\n' + u.rstrip()


if __name__ == '__main__':
    import sys
    it = json.loads(sys.stdin.readline())
    f = parse_prompt(it['user'], it['system'])
    print(json.dumps({'facts': f, 'admitted': admitted_skills(it['schema'], f)}, indent=1, default=list))
