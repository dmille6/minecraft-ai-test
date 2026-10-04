#!/usr/bin/env python3
"""ONE-TIME TOWN CHEST JUNK CLEAR, 2026-10-04. OWNER-APPROVED (09-28 permission; 10-04 ~18:10Z "lets run it now",
eggs/flint/clay/ink/scutes "yes", decorations "yes"). Manifest: docs/reports/chest-clear-manifest-2026-10-04.md.

  cc_clear.py plan      <- /tmp/cc_census_out.json (a FRESH census) -> /tmp/cc_clear_plan.json + totals
  cc_clear.py validate  read-only: `execute if items` on planned slots (must pass) and on kept tools with the spent
                        predicate (must fail) -- proves the predicate syntax and its polarity before anything is removed
  cc_clear.py run       for each planned slot ONE command, atomic in its tick:
                        execute if items block X Y Z container.S <predicate> run item replace block X Y Z container.S with air
                        -- if a bot changed the slot since the census, the test fails and nothing is removed.

Scope = the bank: containers within 48 x/z of home and |dy| <= 12, answered by RCON (not region-file fallbacks).
Removed: spent tools (<= 10 uses left), ballast, plant litter/seeds, spoiled food, unused drops, the 22 decoration ids
seen in the 02:52Z census, and stone material (cobblestone/cobbled_deepslate/blackstone) beyond the stacks that keep
>= 256 per town (largest stacks kept). Nothing else is ever sent: every command is checked against one regex.
"""
import json, re, sys, time, threading
from collections import Counter, defaultdict
sys.path.insert(0, '/tmp')
import cc_census as C

RESERVE = 256
DECOR = {'glass', 'oak_button', 'stone_bricks', 'lead', 'white_wool', 'rail', 'brown_wool', 'orange_terracotta',
         'oak_pressure_plate', 'amethyst_block', 'red_terracotta', 'tnt', 'oak_door', 'bell', 'dark_oak_fence',
         'birch_button', 'potion', 'mossy_stone_brick_slab', 'black_wool', 'cracked_stone_bricks', 'red_bed',
         'light_gray_wool'}
STONE = {'cobblestone', 'cobbled_deepslate', 'blackstone'}
MAXDUR = {'wooden': 59, 'stone': 131, 'iron': 250, 'golden': 32, 'diamond': 1561, 'netherite': 2031}
OTHER_DUR = {'shears': 238, 'flint_and_steel': 64, 'fishing_rod': 64, 'bow': 384, 'shield': 336}
TOOL_SUFFIX = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
BALLAST = {'dirt', 'coarse_dirt', 'rooted_dirt', 'sand', 'red_sand', 'gravel', 'andesite', 'granite', 'diorite',
           'sandstone', 'moss_block', 'dripstone_block', 'pointed_dripstone', 'calcite', 'tuff', 'smooth_basalt',
           'magma_block', 'stone', 'mossy_cobblestone', 'netherrack', 'deepslate', 'mud', 'clay'}
PLANT = {'leaf_litter', 'wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'wildflowers', 'poppy',
         'dandelion', 'azure_bluet', 'rose_bush', 'peony', 'firefly_bush', 'moss_carpet', 'kelp', 'sugar_cane',
         'brown_mushroom', 'red_mushroom', 'cocoa_beans', 'short_grass', 'tall_grass', 'fern', 'vine', 'pink_petals',
         'cornflower', 'oxeye_daisy'}
BADFOOD = {'rotten_flesh', 'poisonous_potato', 'spider_eye', 'pufferfish'}
UNUSED = {'egg', 'brown_egg', 'blue_egg', 'armadillo_scute', 'ink_sac', 'glow_ink_sac', 'feather', 'bone', 'string',
          'gunpowder', 'leather', 'flint', 'clay_ball', 'amethyst_shard', 'prismarine_crystals'}
ID_OK = re.compile(r'^[a-z0-9_]+$')
CMD_OK = re.compile(r'^execute if items block -?\d+ -?\d+ -?\d+ container\.\d{1,2} minecraft:[a-z0-9_]+'
                    r'(\[minecraft:damage~\{durability:\{max:10\}\}\])?'
                    r'( run item replace block -?\d+ -?\d+ -?\d+ container\.\d{1,2} with minecraft:air)?$')


def tool_max(i):
    if i in OTHER_DUR: return OTHER_DUR[i]
    if i.endswith(TOOL_SUFFIX): return MAXDUR.get(i.split('_')[0])
    return None


def category(s):
    i = s['id']; mx = tool_max(i)
    if mx:
        rem = (s.get('max_damage') or mx) - (s.get('damage') or 0)
        return 'spent_tool' if rem <= 10 else None
    if i in STONE: return 'stone'
    if i in BALLAST: return 'ballast'
    if i in PLANT: return 'plant_litter'
    if i in BADFOOD: return 'bad_food'
    if i in UNUSED: return 'unused_drops'
    if i in DECOR: return 'decorations'
    return None


def predicate(s, cat):
    assert ID_OK.match(s['id']), s
    return 'minecraft:%s%s' % (s['id'], '[minecraft:damage~{durability:{max:10}}]' if cat == 'spent_tool' else '')


def in_bank(c):
    return c.get('source') == 'rcon' and abs(c['dy']) <= 12 and c['dist'] <= 48


def plan():
    d = json.load(open('/tmp/cc_census_out.json'))
    out = {'census_started_utc': d['started_utc'], 'worlds': {}}
    tot = Counter(); slots = Counter(); kept_tools = []
    for w, x in sorted(d['worlds'].items()):
        if x.get('rcon_error') or x.get('aborted'):
            print('SKIP world', w, x.get('rcon_error'), x.get('aborted')); continue
        acts = []; stone = []
        for c in x['containers']:
            if not in_bank(c): continue
            for sl, s in c['slots'].items():
                if s.get('truncated_reply') or not s.get('id'): continue
                cat = category(s)
                if cat == 'stone':
                    stone.append((c['pos'], int(sl), s)); continue
                if cat:
                    acts.append({'pos': c['pos'], 'slot': int(sl), 'id': s['id'], 'count': s['count'], 'cat': cat})
                elif tool_max(s['id']) and len(kept_tools) < 40:
                    kept_tools.append({'world': w, 'pos': c['pos'], 'slot': int(sl), 'id': s['id']})
        stone.sort(key=lambda t: -t[2]['count'])
        kept = 0
        for pos, sl, s in stone:
            if kept < RESERVE:
                kept += s['count']; continue
            acts.append({'pos': pos, 'slot': sl, 'id': s['id'], 'count': s['count'], 'cat': 'stone_above_256'})
        for a in acts:
            a['pred'] = predicate(a, a['cat'])
            tot[a['cat']] += a['count']; slots[a['cat']] += 1
        out['worlds'][w] = {'home': x['home'], 'rcon_port': None, 'stone_kept': kept, 'actions': acts}
    out['kept_tools_sample'] = kept_tools
    json.dump(out, open('/tmp/cc_clear_plan.json', 'w'))
    print('census', d['started_utc'])
    for k in sorted(tot): print('  %-16s items %7d  slots %5d' % (k, tot[k], slots[k]))
    print('  TOTAL            items %7d  slots %5d' % (sum(tot.values()), sum(slots.values())))


class W(C.Rcon):
    def _cmd(s, c):
        assert CMD_OK.match(c), 'refusing command outside the clear grammar: %r' % c
        gap = 1.0 / C.RATE - (time.time() - s.t_last)
        if gap > 0: time.sleep(gap)
        t0 = time.time()
        s.i += 1; s._x(s.i, 2, c); s.i += 1; sent = s.i; s._x(sent, 2, "")
        body = ""
        while True:
            rid, p = s._rp()
            if rid == sent: break
            body += p
        s.t_last = time.time(); s.lat.append(s.t_last - t0); s.n += 1
        return body.strip()


def conn(w):
    t = json.load(open('%s/%s/TOWN-PLACED.json' % (C.ROOT, w)))
    return W(t['rcon_port'], C.pw(w))


def test_cmd(pos, slot, pred):
    return 'execute if items block %d %d %d container.%d %s' % (pos[0], pos[1], pos[2], slot, pred)


def validate():
    p = json.load(open('/tmp/cc_clear_plan.json'))
    res = Counter(); bad = []
    for w, x in p['worlds'].items():
        r = conn(w)
        for a in x['actions'][:6]:
            rep = r.cmd(test_cmd(a['pos'], a['slot'], a['pred']))
            ok = 'passed' in rep
            res['planned_pass' if ok else 'planned_fail'] += 1
            if not ok: bad.append((w, a['cat'], a['id'], rep[:100]))
        sp = [a for a in x['actions'] if a['cat'] == 'spent_tool'][:2]
        for a in sp:
            rep = r.cmd(test_cmd(a['pos'], a['slot'], a['pred']))
            res['spent_pass' if 'passed' in rep else 'spent_fail'] += 1
        r.s.close()
    for k in p['kept_tools_sample'][:20]:
        r = conn(k['world'])
        rep = r.cmd(test_cmd(k['pos'], k['slot'], 'minecraft:%s[minecraft:damage~{durability:{max:10}}]' % k['id']))
        res['usable_tool_spentpred_pass(must be 0)' if 'passed' in rep else 'usable_tool_spentpred_fail'] += 1
        rep2 = r.cmd(test_cmd(k['pos'], k['slot'], 'minecraft:%s' % k['id']))
        res['usable_tool_idpred_pass' if 'passed' in rep2 else 'usable_tool_idpred_fail'] += 1
        r.s.close()
    print(dict(res)); print('planned slots that failed the test:', bad[:10])


def run_world(w, x, out):
    rec = {'removed': Counter(), 'removed_slots': Counter(), 'changed_since_census': 0, 'other': [], 'replies': Counter()}
    try:
        r = conn(w)
    except Exception as e:
        rec['error'] = str(e); out[w] = rec; return
    for a in x['actions']:
        c = test_cmd(a['pos'], a['slot'], a['pred']) + ' run item replace block %d %d %d container.%d with minecraft:air' % (
            a['pos'][0], a['pos'][1], a['pos'][2], a['slot'])
        rep = r.cmd(c)
        key = re.sub(r'-?\d+', 'N', rep)[:70]
        rec['replies'][key] += 1
        if 'eplaced' in rep or 'Changed' in rep:
            rec['removed'][a['cat']] += a['count']; rec['removed_slots'][a['cat']] += 1
        elif 'failed' in rep or rep == '':
            rec['changed_since_census'] += 1
        else:
            rec['other'].append(rep[:120])
        lat = r.lat[-20:]
        if lat and sum(lat) / len(lat) > 0.5:
            rec['aborted'] = 'mean latency > 0.5 s'; break
    r.s.close(); out[w] = rec


def run():
    p = json.load(open('/tmp/cc_clear_plan.json'))
    out = {}; t0 = time.time()
    th = [threading.Thread(target=run_world, args=(w, x, out)) for w, x in p['worlds'].items()]
    for t in th: t.start()
    for t in th: t.join()
    res = {'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t0)), 'wall_s': round(time.time() - t0, 1),
           'census_started_utc': p['census_started_utc'],
           'worlds': {w: {k: (dict(v) if isinstance(v, Counter) else v) for k, v in rec.items()} for w, rec in out.items()}}
    json.dump(res, open('/tmp/cc_clear_result.json', 'w'))
    tot = Counter(); sl = Counter(); ch = 0
    for w, rec in sorted(out.items()):
        tot.update(rec.get('removed', {})); sl.update(rec.get('removed_slots', {})); ch += rec.get('changed_since_census', 0)
        print(w, 'removed', sum(rec.get('removed', {}).values()), 'changed', rec.get('changed_since_census'),
              'err', rec.get('error'), 'abort', rec.get('aborted'), 'other', rec.get('other', [])[:2])
        print('   replies', dict(rec.get('replies', {})))
    for k in sorted(tot): print('  %-16s items %7d  slots %5d' % (k, tot[k], sl[k]))
    print('TOTAL removed items', sum(tot.values()), 'slots', sum(sl.values()), '| slots skipped (changed since census)', ch,
          '| wall', res['wall_s'])


if __name__ == '__main__':
    {'plan': plan, 'validate': validate, 'run': run}[sys.argv[1]]()
