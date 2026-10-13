#!/usr/bin/env python3
# plinth-evidence.py <results.jsonl> <run_id> -- the Paper sandbox evidence for plinth-01 as markdown tables, from the
# driver's own results (sandbox/well/plinth-e2e.mjs). Every count in them is an RCON read of the world (execute if block,
# entity census) or the bot's own rows, as each column says. Prints to stdout.
import json, sys

path, run = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(path) if l.strip()]
rows = [r for r in rows if r.get('run') == run]
if not rows:
    sys.exit(f'no results for run {run}')
by = {}
for r in rows:
    by.setdefault(r.get('scene'), []).append(r)


def pct(a, b):
    return f'{a}/{b}'


print(f'### Run {run}\n')
b = by.get('build', [])
if b:
    print('**S1 build** (a plan from the no-site record to complete; the server read after every visit)\n')
    print('| fixture | rep | kills | k | plan steps (place+clear+stair) | server: placed / planned | cleared | outside the plan (server) | block_place packets | retries | alt stands | visits | complete (s) | pit rows | cap open at end | same plan as offline |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in b:
        kills = ', '.join(f"{k['at']} placed{' (walled in)' if k.get('hazard') else ''}" for k in r.get('kills', [])) or '-'
        pits = '; '.join(p.split(' ')[0].lstrip('_') + (' ' + p.split('from=')[1].split(' ')[0] if 'from=' in p else ' ' + p.split('by=')[1].split(' ')[0] if 'by=' in p else '') for p in r.get('pitRows', []))
        print(f"| {r['fx']} | {r['rep']} | {kills} | {r.get('k')} | {r.get('steps')} ({r.get('places')}+{r.get('clears')}, stair {r.get('stair')}) | "
              f"{pct(r.get('serverPlaced'), r.get('places'))} | {r.get('serverCleared')}/{r.get('clears')} | {r.get('outsideN')} | {r.get('blockPlacePackets')} | {r.get('retries')} | "
              f"{r.get('alt')} | {r.get('visits')} | {round((r.get('completeMs') or 0) / 1000)} | {pits} | {r.get('capOpenAtEnd')} | {r.get('samePlanAsOffline')} |")
    ok = sum(1 for r in b if r.get('ok'))
    print(f'\nBuilds complete with every planned cell on the server and nothing outside the plan: **{ok} of {len(b)}**.\n')
w = by.get('well-build', [])
if w:
    print('**S2 the well on the plinth** (build_well on the finished plinth: the cover dug out, the floor trapdoor, the cap)\n')
    for r in w:
        print(f"- {r['fx']}: built={r.get('built')} facing={r.get('facing')} cap+floor read on the server: {r.get('wellOk')} ({r.get('row', '')[:120]})")
    print()
d = by.get('dispose', [])
if d:
    print('| fixture | raise k | items in the shaft (+1.5 s) | outside | at +30 s in / out | bot row |')
    print('|---|---|---|---|---|---|')
    for r in d:
        c, c30 = r.get('census') or {}, r.get('censusAt30s') or {}
        print(f"| {r['fx']} | {r.get('k')} | {c.get('inItems')} | {c.get('outItems')} | {c30.get('inItems')} / {c30.get('outItems')} | {(r.get('row') or '')[:90]} |")
    print()
iso = by.get('isolation', [])
if iso:
    print('| fixture | raise k | positive control (egg on the top, collected) | 60 passes beside the shaft: items in/out after, walker bag | the LEDGE (4 cells, feet g, 10 s each): walker bag | shaft after |')
    print('|---|---|---|---|---|---|')
    for r in iso:
        print(f"| {r['fx']} | {r.get('k')} | {r.get('control')} | {r['afterPasses']['inItems']}/{r['afterPasses']['outItems']}, {r.get('walkerAfterPasses') or '{}'} | "
              f"{[l['bag'] for l in r.get('ledge', [])]} | {r['afterLedge']['inItems']}/{r['afterLedge']['outItems']} |")
    print()
p = by.get('path', [])
if p:
    print('**S3 pathing** (mineflayer-pathfinder with the fleet\'s well step cost; a bare walker, 50 round trips town <-> throwing stand)\n')
    print('| fixture | to the stand ok | home ok | path nodes in the well column | body samples in the column (100 ms) | p50 ms to the stand | fails |')
    print('|---|---|---|---|---|---|---|')
    for r in p:
        print(f"| {r['fx']} | {r.get('toStandOk')}/{r.get('toStand')} | {r.get('homeOk')}/50 | {r.get('pathNodesInColumn')} | {r.get('bodySamplesInColumn')} | {r.get('standMsP50')} | {len(r.get('fails') or [])} |")
    print()
for kind in ('tomb', 'pit', 'tomb-control', 'pit-control'):
    for r in by.get(kind, []):
        print(f"**S4 {kind}** ({r['fx']}): out={r.get('out')} plinth cells lost (server)={len(r.get('plinthLost') or [])}; rows: {'; '.join(x[:110] for x in (r.get('rows') or [])[:4])}\n")
errs = [r for r in rows if r.get('error')]
for r in errs:
    print(f"- scene {r.get('scene')} {r.get('fx')} ERROR: {r.get('error')}")
