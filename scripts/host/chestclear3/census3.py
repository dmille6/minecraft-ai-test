#!/usr/bin/env python3
"""census3.py <positions.json> <census-out.json> [world ...] -- READ-ONLY town container census (run on 10.0.0.30 as
root; each world's RCON password is read from its own server.properties and never leaves the host).

Commands sent (checked by GRAMMAR before sending): `list`, `data get block X Y Z id`, `data get block X Y Z Items[k]`.
Only positions inside the bank box (|dx|,|dz| <= 48, |dy| <= 12 from home) are read; the rest are counted as
outside_box (the 10-04 census list also holds deep containers, which the clears never touch). Per position: the block
entity id; if it is a chest, trapped_chest or barrel, every element of Items one index at a time
(list reads are abbreviated), until "Found no elements". A container whose read ends any other way is recorded as
INCOMPLETE (the planner skips it; the executor refuses to plan on a census with any). Worlds run in parallel, one
connection each. Output per world: positions queried, containers, slots, incomplete, the `list` reply (who is online),
seconds. chestclear2/census2.py did the same sequentially and could not see a truncated or failed read.
"""
import json, re, sys, threading, time
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import rcon3

GRAMMAR = re.compile(r'^(list|data get block -?\d+ -?\d+ -?\d+ (id|Items\[\d{1,2}\]))$')
KINDS = ('chest', 'trapped_chest', 'barrel')
IT = re.compile(r'has the following block data: (\{.*)$', re.S)
BOX = (48, 12)          # the bank: |dx|, |dz| <= 48 and |dy| <= 12 from home (the 10-04 and 10-10 scope)


def parse_item(e):
    """Paper abbreviates deep NBT even for one element ('{"minecraft:stored_enchantments": {"minecraft:lure"...'):
    Slot, id and count come first and are read; anything after the cut is unknown, so an abbreviated element is
    flagged and its damage is NOT trusted (None) -- the planner never acts on an abbreviated element."""
    abbreviated = not e.rstrip().endswith('}')
    idm = re.search(r'\bid: "minecraft:([a-z0-9_]+)"', e); cm = re.search(r'\bcount: (\d+)', e)
    sm = re.search(r'\bSlot: (\d+)b', e); dm = re.search(r'"minecraft:damage": (\d+)', e)
    mdm = re.search(r'"minecraft:max_damage": (\d+)', e)
    comps = sorted(set(re.findall(r'"minecraft:([a-z_]+)":', e)))
    if not idm or not sm: return None
    if not cm: return None
    return {'id': idm.group(1), 'count': int(cm.group(1)), 'slot': int(sm.group(1)),
            'damage': None if abbreviated else (int(dm.group(1)) if dm else 0),
            'max_damage': None if abbreviated else (int(mdm.group(1)) if mdm else None),
            'components': comps, 'abbreviated': abbreviated}


def read_container(r, x, y, z):
    """-> (items, problem or None). Reads Items[0..] until the list ends."""
    it = []
    for k in range(55):
        rep = r.cmd('data get block %d %d %d Items[%d]' % (x, y, z, k))
        if rep.startswith('Found no elements matching'):
            return it, None
        m = IT.search(rep)
        if not m: return it, 'index %d: unexpected reply %r' % (k, rep[:120])
        e = parse_item(m.group(1))
        if not e: return it, 'index %d: unparsed element %r' % (k, m.group(1)[:120])
        it.append(e)
    return it, 'more than 54 elements'


def census_world(w, v, out):
    t0 = time.time(); rec = {'home': v['home'], 'containers': [], 'incomplete': [], 'positions': len(v['pos']),
                             'not_container': 0, 'outside_box': 0, 'kinds': {}}
    hx, hy, hz = v['home']
    try:
        r = rcon3.Rcon(w, GRAMMAR)
        rec['list'] = r.cmd('list')
        for (x, y, z) in v['pos']:
            if abs(x - hx) > BOX[0] or abs(z - hz) > BOX[0] or abs(y - hy) > BOX[1]:
                rec['outside_box'] += 1; continue
            rep = r.cmd('data get block %d %d %d id' % (x, y, z))
            m = re.search(r'has the following block data: "minecraft:([a-z_]+)"', rep)
            if not m or m.group(1) not in KINDS:
                rec['not_container'] += 1; continue
            items, prob = read_container(r, x, y, z)
            c = {'kind': m.group(1), 'pos': [x, y, z], 'items': items}
            if prob:
                c['incomplete'] = prob; rec['incomplete'].append([x, y, z, prob])
            slots = [i['slot'] for i in items]
            if len(set(slots)) != len(slots):
                c['incomplete'] = 'duplicate Slot'; rec['incomplete'].append([x, y, z, 'duplicate Slot'])
            rec['containers'].append(c); rec['kinds'][m.group(1)] = rec['kinds'].get(m.group(1), 0) + 1
        rec['list_after'] = r.cmd('list')
        rec['queries'] = r.n; r.close()
    except Exception as e:
        rec['error'] = '%s: %s' % (type(e).__name__, e)
    rec['seconds'] = round(time.time() - t0, 1)
    out[w] = rec


def main():
    P = json.load(open(sys.argv[1])); only = set(sys.argv[3:])
    res = {'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'positions_file': sys.argv[1], 'worlds': {}}
    out = {}
    th = [threading.Thread(target=census_world, args=(w, v, out)) for w, v in sorted(P.items()) if not only or w in only]
    for t in th: t.start()
    for t in th: t.join()
    res['finished_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    res['worlds'] = {w: out[w] for w in sorted(out)}
    json.dump(res, open(sys.argv[2], 'w'))
    bad = 0
    for w, rec in res['worlds'].items():
        n = len(rec['containers']); sl = sum(len(c['items']) for c in rec['containers'])
        full = sum(1 for c in rec['containers'] if len(c['items']) >= 27)
        bad += bool(rec.get('error') or rec['incomplete'])
        print('%-11s positions %4d (outside box %4d) containers %3d %s slots %5d full %3d incomplete %d err %s %.0fs | %s' % (
            w, rec['positions'], rec.get('outside_box', 0), n, rec['kinds'], sl, full, len(rec['incomplete']), rec.get('error'), rec['seconds'],
            (rec.get('list') or '')[:60]), flush=True)
    print('census', res['started_utc'], '->', res['finished_utc'], 'worlds', len(res['worlds']), 'with problems', bad)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
