#!/usr/bin/env python3
"""Summarise composter-ab.cjs results: one line per trial with the checks the design implies, then a per-scene table.

usage: summarize-composter.py <results-cand.jsonl> [<results-ctrl.jsonl> ...]
       summarize-composter.py --rows <results.jsonl> <scene>      (every bot row of every trial of a scene)

Server truth: slots (per-slot RCON), item entities on the ground, composter/crafting_table blocks in the arena.
Checks (PASS/FAIL per trial):
  build30/build34      one composter, at the canonical site 697 120 699; oak_log -3, oak_planks +2, oak_slab +5; nothing
                       on the ground; the table is wherever the design puts it (reported, not judged)
  build35/build36      no composter, and either no build_composter order or a refusal before any craft click
  compost36*           slots freed, oak_sapling >= 16 kept, birch_sapling 10 kept, apple/bread/cooked_beef untouched,
                       bone meal > 0, nothing on the ground
  stand-blocked        composter_unreachable and no crafting_table block put down
"""
import json, sys
from collections import defaultdict

SITE = '697 120 699'


def load(paths):
    return [json.loads(l) for p in paths for l in open(p) if l.strip()]


def delta(r):
    b, a = r['before']['totals'], r['after']['totals']
    return {k: a.get(k, 0) - b.get(k, 0) for k in set(a) | set(b) if a.get(k, 0) != b.get(k, 0)}


def check(r):
    sc, w, a, d = r['scene'], r.get('watched') or {}, r['after'], delta(r)
    ground = [f"{g['id']}x{g['count']}" for g in a['ground']]
    crafts = [x for x in r['rows'] if x['name'] == '_craft_sync']
    why = []
    if sc in ('build30', 'build34', 'stand-blocked-off'):
        ok = a['composters'] == 1 and a['composterAt'] == [SITE] and d.get('oak_log') == -3 and d.get('oak_planks') == 2 and d.get('oak_slab') == 5 and not ground
        if a['composters'] != 1 or a['composterAt'] != [SITE]: why.append(f"composters={a['composters']}@{a['composterAt']}")
        if (d.get('oak_log'), d.get('oak_planks'), d.get('oak_slab')) != (-3, 2, 5): why.append(f"counts log{d.get('oak_log')} planks{d.get('oak_planks')} slab{d.get('oak_slab')}")
        if ground: why.append(f'ground {ground}')
    elif sc in ('build35', 'build36'):
        started = bool(w)
        ok = a['composters'] == 0 and not ground and (not started or not crafts)
        if a['composters']: why.append('composter built')
        if started: why.append(f"order ran: {w.get('status')} {w.get('detail', '')[:160]}")
        if started and crafts: why.append(f'{len(crafts)} craft(s) clicked')
    elif sc.startswith('compost36'):
        t = a['totals']; b = r['before']['totals']
        keep = all(t.get(k, 0) == b.get(k, 0) for k in ('apple', 'bread', 'cooked_beef'))
        ok = a['used'] < r['before']['used'] and t.get('oak_sapling', 0) >= 16 and t.get('birch_sapling', 0) == b.get('birch_sapling', 0) and keep and t.get('bone_meal', 0) > 0 and not ground
        if not a['used'] < r['before']['used']: why.append(f"slots {r['before']['used']}->{a['used']}")
        if t.get('oak_sapling', 0) < 16: why.append('oak saplings below reserve')
        if not keep: why.append('food changed')
        if not t.get('bone_meal'): why.append('no bone meal')
        if ground: why.append(f'ground {ground}')
    elif sc == 'stand-blocked':
        ok = w.get('fail') == 'composter_unreachable' and a['tables'] == 0
        if w.get('fail') != 'composter_unreachable': why.append(f"fail={w.get('fail')}")
        if a['tables']: why.append(f"table put down at {a['tableAt']}")
    else:
        ok = None
    return ok, why, ground, d


def main(argv):
    if argv and argv[0] == '--rows':
        for r in load([argv[1]]):
            if r['scene'] != argv[2]:
                continue
            print('==', r['id'], r['tag'], 'trace', r['trace'])
            for x in r['rows']:
                if x['name'] != 'status':
                    print('  ', x['name'], x['status'], x.get('trigger'), x.get('ms'), x.get('fail'), x['detail'][:400])
        return
    rs = load(argv)
    agg = defaultdict(list)
    for r in rs:
        ok, why, ground, d = check(r)
        w = r.get('watched') or {}
        dd = ' '.join(f"{k}{v:+d}" for k, v in sorted(d.items()))
        verdict = 'n/a' if ok is None else ('PASS' if ok else 'FAIL')
        if r['arm'] == 'ctrl':
            verdict = 'ctrl'
        agg[(r['scene'], r['arm'])].append((verdict, w.get('status') or 'no-order', w.get('ms')))
        print(f"{r['id']:<26} {r['sha']} {verdict:<5} {str(w.get('status') or 'no-order'):<9} {w.get('fail') or '':<22} ms={w.get('ms')} slots {r['before']['used']}->{r['after']['used']} "
              f"composters={r['after']['composters']}@{r['after']['composterAt']} tables={r['after']['tables']}@{r['after']['tableAt']} level {r['before']['level']}->{r['after']['level']} "
              f"ground={ground or '-'} d{{{dd}}} {'; '.join(why)} | {(w.get('detail') or '')[:200]}")
    print()
    for (sc, arm), v in sorted(agg.items()):
        c = defaultdict(int)
        for x in v:
            c[f'{x[0]}/{x[1]}'] += 1
        ms = [x[2] for x in v if x[2] is not None]
        print(f"{sc:<18} {arm:<5} n={len(v)} {dict(c)} ms {min(ms) if ms else '-'}..{max(ms) if ms else '-'}")


if __name__ == '__main__':
    main(sys.argv[1:])
