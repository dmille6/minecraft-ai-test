#!/usr/bin/env python3
"""forceload3.py <positions.json> <query|add|remove> <state.json> [world ...] -- keeps every bank-box chunk LOADED while
the bots are stopped (runs on 10.0.0.30 as root). Claude review r1 finding 1: with nobody online a world keeps only its
spawn chunks (gamerule spawnChunkRadius 2) loaded, and 7 bank containers in 4 towns sit 2-3 chunks from home, so the
census would read them as "That position is not loaded".

  query   read-only: per world, the chunks already force-loaded and the bank-box chunks that are not
  add     `forceload add <x> <z>` for each bank-box chunk NOT already force-loaded; the exact list ADDED is written to
          <state.json> (before the command is sent) -- a chunk ticket, no block changes
  remove  `forceload remove <x> <z>` for exactly the chunks <state.json> says this tool added (never one that was
          force-loaded before), then a query confirms the pre-existing set is back
Grammar: `forceload query`, `forceload (add|remove) X Z` only. Run `add` while the bots are still online (their chunks are
loaded then) and `remove` after the re-census, before the bots start."""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rcon3

GRAMMAR = re.compile(r'^forceload (query|(add|remove) -?\d{1,7} -?\d{1,7})$')
BOX = 48


def forced(r):
    rep = r.cmd('forceload query')
    if rep.startswith('No force loaded chunks'): return set()
    m = re.search(r'at: (.*)$', rep, re.S)
    if not m: raise RuntimeError('unparsed forceload query reply %r' % rep[:120])
    got = {tuple(map(int, p)) for p in re.findall(r'\[(-?\d+), (-?\d+)\]', m.group(1))}
    n = re.match(r'(\d+) force loaded chunks? (was|were) found', rep)
    if not n or int(n.group(1)) != len(got): raise RuntimeError('forceload query count mismatch %r' % rep[:120])
    return got


def box_chunks(home):
    hx, _, hz = home
    return {(cx, cz) for cx in range((hx - BOX) >> 4, ((hx + BOX) >> 4) + 1) for cz in range((hz - BOX) >> 4, ((hz + BOX) >> 4) + 1)}


def main():
    P = json.load(open(sys.argv[1])); mode = sys.argv[2]; sp = sys.argv[3]; only = set(sys.argv[4:])
    worlds = sorted(w for w in P if not only or w in only)
    state = json.load(open(sp)) if mode == 'remove' else {'added': {}, 'before': {}}
    bad = 0
    for w in worlds:
        r = rcon3.Rcon(w, GRAMMAR)
        pre = forced(r); want = box_chunks(P[w]['home'])
        if mode == 'query':
            print('%-11s force-loaded now %3d; bank-box chunks %d, of them not force-loaded %d' % (w, len(pre), len(want), len(want - pre)))
        elif mode == 'add':
            todo = sorted(want - pre)
            state['before'][w] = sorted(pre); state['added'][w] = todo
            json.dump(state, open(sp, 'w'), indent=1)                   # recorded BEFORE anything is sent
            for cx, cz in todo:
                rep = r.cmd('forceload add %d %d' % (cx * 16, cz * 16))
                if not rep.startswith('Marked chunk'): bad += 1; print('  %s add %d,%d -> %r' % (w, cx, cz, rep[:100]))
            post = forced(r)
            ok = post == pre | want
            bad += not ok
            print('%-11s added %3d chunk tickets; force-loaded %d -> %d %s' % (w, len(todo), len(pre), len(post), 'OK' if ok else 'MISMATCH'))
        elif mode == 'remove':
            mine = {tuple(c) for c in state['added'].get(w, [])}; before = {tuple(c) for c in state['before'].get(w, [])}
            for cx, cz in sorted(mine):
                if (cx, cz) in before: continue                         # never remove a ticket that was there before
                rep = r.cmd('forceload remove %d %d' % (cx * 16, cz * 16))
                # a ticket is not reference-counted: if something else already removed it, the reply is "No chunks were
                # removed" -- reported, not a failure; the end-state check below (== the set before the clear) decides
                if rep.startswith('No chunks were removed'): print('  %s %d,%d was no longer force-loaded (removed by someone else)' % (w, cx, cz))
                elif not rep.startswith('Unmarked chunk'): bad += 1; print('  %s remove %d,%d -> %r' % (w, cx, cz, rep[:100]))
            post = forced(r)
            ok = post == before
            bad += not ok
            print('%-11s removed %3d chunk tickets; force-loaded now %d (before the clear %d) %s' % (
                w, len(mine - before), len(post), len(before), 'OK' if ok else 'MISMATCH: %s' % sorted(post ^ before)[:6]))
        r.close()
    print('FORCELOAD', mode, 'PASS' if not bad else 'FAIL (%d)' % bad)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
