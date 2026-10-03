#!/usr/bin/env python3
"""Summarise craftroom-ab.cjs results: one line per trial, then a per-scene table per arm.

usage: summarize.py <results-cand.jsonl> <results-ctrl.jsonl> [...]   (any number of results files)
       summarize.py --rows <results.jsonl> <scene>                    (every bot row of every trial of a scene)

Server truth only: the product's gain is read from the server's slots, a toss from the item entities on the ground.
  CRAFTED  the product is in the bag (+1 for a pickaxe), nothing of it on the ground
  TOSSED   the product (or any pickaxe) lies on the ground after the trial
  REFUSED  no product made, nothing on the ground, and the craft row is a failure
  LIED     the craft row says success but the server's bag has no new product
"""
import json, sys
from collections import defaultdict

PRODUCT = {'logs': 'wooden_pickaxe'}


def load(paths):
    out = []
    for p in paths:
        for l in open(p):
            if l.strip():
                out.append(json.loads(l))
    return out


def verdict(r):
    prod = PRODUCT.get(r['scene'], 'stone_pickaxe')
    b, a = r['before']['totals'], r['after']['totals']
    gain = a.get(prod, 0) - b.get(prod, 0)
    ground = r['after']['ground']
    on_ground_prod = sum(g['count'] for g in ground if g['id'] == prod)
    on_ground_pick = sum(g['count'] for g in ground if g['id'].endswith('_pickaxe'))
    craft = [x for x in r['rows'] if x['name'] == 'craft']
    status = craft[-1]['status'] if craft else ('rejected' if 'rejected' in r['row'] else 'none')
    if on_ground_prod or on_ground_pick:
        v = 'TOSSED'
    elif gain >= 1:
        v = 'CRAFTED'
    elif status == 'success':
        v = 'LIED'
    elif status in ('failed', 'unknown'):
        v = 'REFUSED'
    else:
        v = status.upper()
    # what the bag lost that the recipe does not explain
    lost = {k: a.get(k, 0) - b.get(k, 0) for k in set(a) | set(b) if a.get(k, 0) - b.get(k, 0) < 0}
    picks_b = [s for s in r['before']['slots'].values() if s['id'].endswith('_pickaxe')]
    picks_a = [s for s in r['after']['slots'].values() if s['id'].endswith('_pickaxe')]
    tools_b = sorted(f"{s['id']}@{s.get('damage', 0)}" for s in r['before']['slots'].values() if s['id'].endswith(('_pickaxe', '_axe', '_hoe', '_shovel')))
    tools_a = sorted(f"{s['id']}@{s.get('damage', 0)}" for s in r['after']['slots'].values() if s['id'].endswith(('_pickaxe', '_axe', '_hoe', '_shovel')))
    ms = craft[-1]['ms'] if craft else None
    return dict(v=v, status=status, gain=gain, ground=[f"{g['id']}x{g['count']}" for g in ground], lost=lost, tools_b=tools_b, tools_a=tools_a,
                slots=f"{r['before']['used']}->{r['after']['used']}", tables=r['after']['tables'], ms=ms,
                detail=(craft[-1]['detail'] if craft else r['row'])[:400])


def main(argv):
    if argv and argv[0] == '--rows':
        for r in load([argv[1]]):
            if r['scene'] != argv[2]:
                continue
            print('==', r['id'], r['session'], 'served', r['served'], 'drops', r['drops'], 'trace', r['trace'])
            for x in r['rows']:
                print('  ', x['name'], x['status'], x.get('ms'), x['detail'])
            for x in r['rejections']:
                print('   REJ', x)
        return
    rs = load(argv)
    by = defaultdict(list)
    for r in rs:
        by[(r['scene'], r['arm'])].append((r, verdict(r)))
    scenes = []
    for r in rs:
        if r['scene'] not in scenes:
            scenes.append(r['scene'])
    for sc in scenes:
        for arm in ('cand', 'ctrl'):
            for r, v in by.get((sc, arm), []):
                t = r['trace']
                print(f"{r['id']:<22} {r['sha']} {v['v']:<8} {v['status']:<8} gain={v['gain']:+d} slots {v['slots']} ground={','.join(v['ground']) or '-'} tables={v['tables']} "
                      f"ms={v['ms']} tools {' '.join(v['tools_b']) or '-'} -> {' '.join(v['tools_a']) or '-'} | clicks={t['clicks']} real {t.get('firstReal')}..{t.get('lastReal')} "
                      f"spawn={[s['t'] for s in t['spawns']]} pickup={[p['t'] for p in t['pickups']]} att={r.get('attempts')} | {v['detail'][:220]}")
    print()
    print(f"{'scene':<12} {'arm':<5} {'n':>2}  outcomes")
    for sc in scenes:
        for arm in ('cand', 'ctrl'):
            vs = [v['v'] for _, v in by.get((sc, arm), [])]
            if not vs:
                continue
            c = defaultdict(int)
            for x in vs:
                c[x] += 1
            ms = [v['ms'] for _, v in by[(sc, arm)] if v['ms'] is not None]
            print(f"{sc:<12} {arm:<5} {len(vs):>2}  {dict(c)}  craft ms {min(ms) if ms else '-'}..{max(ms) if ms else '-'}")


if __name__ == '__main__':
    main(sys.argv[1:])
