#!/usr/bin/env python3
"""External anchored mutants for cobbleoverflow-01 (the junk well takes surplus cobble the town has NO ROOM for, below the cap).

    python3 scripts/mutants/mutants-cobbleoverflow.py <export-dir> [name filter]

The runner is mutants-stocktarget.py's (each anchor present EXACTLY ONCE, the unmutated file must pass first, KILLED only
if a named test file fails; the file is restored either way). Every mutant breaks one guard of the "no room" rule -- the
room an open window shows, the fold that keeps it, the town's room view, the switch, the per-stack rule, the click's re-read,
the plan the order is given from, the rows the read judges -- or blinds a gate of the read.
"""
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutants_stocktarget', os.path.join(HERE, 'mutants-stocktarget.py'))
MS = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MS)

CO = ['cobbleoverflow']
WE = ['well']
TD = ['towndeposit']
PY = ['py:scripts/host/cobbleoverflowread.py']
MUTANTS = [
    # ---- the room an open window shows (cobblecap.mjs roomOf)
    ('roomOf: a partial stack of the same name adds no room', 'bots/src/cobblecap.mjs',
     '    if (it.name in room) room[it.name] += Math.max(0, (Number(it.stackSize) || 64) - (Number(it.count) || 0))\n', '', CO),
    ('roomOf: an empty slot adds no room (every chest reads full)', 'bots/src/cobblecap.mjs',
     '  for (const n of ROOM_NAMES) room[n] += (size - used.size) * 64\n', '', CO),
    ('roomOf: an item outside the container is ignored (a guess, not null)', 'bots/src/cobblecap.mjs',
     '    if (!it || !Number.isInteger(it.slot) || it.slot < 0 || it.slot >= size) return null\n', '    if (!it) continue\n', CO),
    # ---- the fold keeps it
    ('the fold drops the room reading', 'bots/src/cobblecap.mjs',
     '      const next = { ...(m ? { n, at: r.cap, seq, v: 2, m } : { n, at: r.cap, seq }), ...(room ? { r: room, ...(Number.isInteger(r.z) ? { z: r.z } : {}) } : {}) }',
     '      const next = { ...(m ? { n, at: r.cap, seq, v: 2, m } : { n, at: r.cap, seq }) }', CO + WE),
    ('an equal capture keeps the SMALLER room (the town looks fuller)', 'bots/src/cobblecap.mjs',
     'Math.max(ro[x], rn[x])', 'Math.min(ro[x], rn[x])', CO),
    ('recordCount never writes the room', 'bots/src/cobblecap.mjs',
     '    if (room) rec.r = room   // cobbleoverflow-01: the cobble room the same window showed\n', '', CO),
    # ---- the town's room view (cobblecap.mjs townRoom)
    ('townRoom: a stale reading still counts', 'bots/src/cobblecap.mjs',
     ' || !(now - o.at < ttl)) { unknown.push(k); continue }', ') { unknown.push(k); continue }', CO + WE),
    ('townRoom: a container mid-withdraw keeps its old reading', 'bots/src/cobblecap.mjs',
     "    if (c.state === 'live' && (c.decision === 'take' || c.decision === 'draw')) bad.add(c.k)\n", "    if (false) bad.add(c.k)\n", CO),
    ('townRoom: an unresolved void keeps its old reading', 'bots/src/cobblecap.mjs',
     '    else if (c.state === \'void\' && !(obs[c.k] && obs[c.k].seq > c.voidSeq && obs[c.k].at >= c.voidAt)) bad.add(c.k)\n', '', CO),
    ('townRoom: a scan that did not cover the town is enough', 'bots/src/cobblecap.mjs',
     '  return { known: !!coverage && all.length > 0 && unknown.length === 0,', '  return { known: all.length > 0 && unknown.length === 0,', CO),
    ('townRoom: a town with no container is "no room"', 'bots/src/cobblecap.mjs',
     '  return { known: !!coverage && all.length > 0 && unknown.length === 0,', '  return { known: !!coverage && unknown.length === 0,', CO),
    ('townRoom: max is the SUM over containers (a stack split across two)', 'bots/src/cobblecap.mjs',
     '    for (const n of ROOM_NAMES) max[n] = Math.max(max[n], r[n])\n', '    for (const n of ROOM_NAMES) max[n] += r[n]\n', CO),
    # ---- the switch and the per-stack rule (well.mjs)
    ('the switch: overflow on UNKNOWN room', 'bots/src/well.mjs',
     "  if (cap === 'below' && room?.known === true) return 'overflow'\n", "  if (cap === 'below') return 'overflow'\n", CO + WE),
    ('the switch: overflow on an incomplete count', 'bots/src/well.mjs',
     "  if (cap === 'below' && room?.known === true) return 'overflow'\n", "  if (cap !== 'at_cap' && room?.known === true) return 'overflow'\n", CO),
    ('stackFits: unknown room does not fit (fails open)', 'bots/src/well.mjs',
     '  if (!room?.known || !stack) return true\n', '  if (!stack) return true\n', CO),
    ('stackFits: a stack that fits exactly is taken', 'bots/src/well.mjs',
     '  return !Number.isFinite(m) || m >= (Number(stack.count) || 0)\n', '  return !Number.isFinite(m) || m > (Number(stack.count) || 0)\n', CO + WE),
    ('stackFits: a name the reading lacks does not fit', 'bots/src/well.mjs',
     '  return !Number.isFinite(m) || m >= (Number(stack.count) || 0)\n', '  return Number.isFinite(m) && m >= (Number(stack.count) || 0)\n', CO),
    ('cobbleStackGoes: an overflow stack goes whatever the room', 'bots/src/well.mjs',
     "  if (mode === 'overflow') return !stackFits(room, stack)\n", "  if (mode === 'overflow') return true\n", CO),
    ('disposePlan never plans the overflow', 'bots/src/well.mjs',
     '  const cobble = cobbleAtCap ? cobbleWellStacks(list) : cobbleOverflowStacks(list, cobbleRoom)', '  const cobble = cobbleAtCap ? cobbleWellStacks(list) : []', CO + WE),
    ('the dispose row never says overflow=', 'bots/src/well.mjs',
     "${overflow ? ` overflow=${overflow}` : ''}", '', WE),
    # ---- skills.mjs: the reading written, the options, the click, the order's plan, the exposure rows
    ('cobbleObserve records no room', 'bots/src/skills.mjs',
     '{ obs: inside ? { k: containerKey(bot, pos), n, m, cap, ...(r ? { r, z: win.inventoryStart } : {}) } : null,', '{ obs: inside ? { k: containerKey(bot, pos), n, m, cap } : null,', CO),
    ('cobbleWellOpts never passes the room', 'bots/src/skills.mjs',
     "    return { cobbleAtCap: mode === 'at_cap', cobbleRoom: mode === 'overflow' ? room : null, mode, cap, room }",
     "    return { cobbleAtCap: mode === 'at_cap', cobbleRoom: null, mode, cap, room }", CO + WE),
    ('a known room is never re-judged on a fresh scan (Codex r1 P1: the cached container list)', 'bots/src/skills.mjs',
     '  if (!v.known || !fresh) return v\n', '  return v\n', CO + WE),
    ('the click judges on the cached list (Claude r2 P2-1)', 'bots/src/skills.mjs',
     '        const co = cobbleWellOpts(bot, undefined, { fresh: true })\n        acc.capLast = co.cap', '        const co = cobbleWellOpts(bot)\n        acc.capLast = co.cap', WE),
    ('away from town the room is judged anyway (Codex r2 P3)', 'bots/src/skills.mjs',
     "  if (!p || !(Math.hypot(p.x - h.x, p.z - h.z) <= TOWN_RADIUS)) return none('away')\n", '', CO),
    ('townRoom ignores the container\'s size (Codex r2 P1: a chest joined into a double)', 'bots/src/cobblecap.mjs',
     '    if (sizes && sizes[k] != null && o.z !== sizes[k]) { unknown.push(k); continue }\n', '', CO),
    ('the scan records no sizes', 'bots/src/skills.mjs',
     '{ const k = containerKey(bot, p); keys.add(k); sizes[k] = sizeAt(p) }', '{ const k = containerKey(bot, p); keys.add(k) }', CO),
    ('the withdraw\'s open writes the room (Claude r2 P2-2)', 'bots/src/skills.mjs',
     '  await cobbleObserve(bot, cp, chest, { room: false })', '  await cobbleObserve(bot, cp, chest)', CO),
    ('a withdraw that took nothing writes no end count', 'bots/src/skills.mjs',
     '    else { try { await cobbleObserve(bot, cp, win) } catch { /* unknown room: fail closed */ } }\n', '', CO),
    ('the click writes no evidence row', 'bots/src/skills.mjs',
     "          cobbleOverflowNote(bot, 'throw', bot.inventory?.items?.() ?? [], { stack: it, left: leftC, co })\n", '', WE),
    ('the no-room refusal never names the well', 'bots/src/skills.mjs',
     "${wellOk ? '; once every town container is seen without room for it, the junk well takes the surplus whole stacks at a full bag' : ''}", '', CO),
    ('an aborted withdraw writes no count (Claude r1 P1)', 'bots/src/skills.mjs',
     '    if (moved || stockIds.length || entered) { try { await cobbleObserve(bot, cp, win,', '    if (moved || stockIds.length) { try { await cobbleObserve(bot, cp, win,', CO),
    ('the room trusts a reading for only an hour again (the canary goes inert)', 'bots/src/cobblecap.mjs',
     'export const ROOM_TTL_MS = OBS_TTL_MS', 'export const ROOM_TTL_MS = FLOOR_TTL_MS', CO),
    ('the click ignores the room (any overflow-mode stack goes)', 'bots/src/skills.mjs',
     '        if (!cobbleStackGoes(it, co)) continue\n', '        if (co.mode == null) continue\n', WE),
    ('the order\'s plan without the cobble switch', 'bots/src/skills.mjs',
     '  return disposePlan(items, { swords: wellSwordsNow(bot), cobbleAtCap: !!co?.cobbleAtCap, cobbleRoom: co?.cobbleRoom ?? null, stock: atTown ? stockWellOpts(bot, items) : null })',
     '  return disposePlan(items, { swords: wellSwordsNow(bot), cobbleAtCap: !!co?.cobbleAtCap, stock: atTown ? stockWellOpts(bot, items) : null })', WE),
    ('cognitive plans the well order without wellOrderPlan', 'bots/src/cognitive.mjs',
     '        const plan = wellOrderPlan(bot, items, atTown)\n', '        const plan = disposePlan(items, {})\n', CO),
    ('no exposure row at the cobble-only no-room deposit', 'bots/src/skills.mjs',
     "    cobbleOverflowNote(bot, 'deposit_no_room')", '    void 0', CO),
    ('no exposure row at town_storage_full', 'bots/src/skills.mjs',
     "    cobbleOverflowNote(bot, 'town_storage_full')", '    void 0', TD),
    ('the licence row is never written', 'bots/src/index.mjs',
     "    try { logEvent({ kind: 'cobbleoverflow_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleOverflowModeDetail() }) } catch {}",
     "    try { void ({ kind: 'cobbleoverflow_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleOverflowModeDetail() }) } catch {}", CO),
    # ---- the read
    ('the read: D1 never fires on a visit', 'scripts/host/cobbleoverflowread.py',
     "for r, f in throws if num(f, 'cobble_left', -1) < RESERVE]", "for r, f in throws if False]", PY),
    ('the read: D1 never fires on a click (Claude r2 P2-3)', 'scripts/host/cobbleoverflowread.py',
     "for r, f in clicks if num(f, 'left', -1) < RESERVE]", "for r, f in clicks if False]", PY),
    ('the read: D2 never fires (Claude r2 P2-3, Codex r2 P3: re-anchored on the per-click predicate)', 'scripts/host/cobbleoverflowread.py',
     "for r, f in clicks if not click_ok(f)]", "for r, f in clicks if False]", PY),
    ('the read: D3 ignores the container list (Codex r2 P2)', 'scripts/host/cobbleoverflowread.py',
     "    same = lambda e, c: bool(e) and bool(c.get('keys')) and e.get('hash') == c['keys']", "    same = lambda e, c: bool(e)", PY),
    ('the read: D3 never fires', 'scripts/host/cobbleoverflowread.py',
     "    bad = [c['id'] for c in clicks if same(by.get(c['id']), c) and roomy(by.get(c['id']), c)]", "    bad = []", PY),
    ('the read: D3 trips on unknown room', 'scripts/host/cobbleoverflowread.py',
     "    roomy = lambda e, c: bool(e) and e.get('known') is True and int((e.get('max') or {}).get(c['name']) or 0) >= c['count']",
     "    roomy = lambda e, c: bool(e) and int((e.get('max') or {}).get(c['name']) or 0) >= c['count']", PY),
    ('the read: D3 judges cobblestone room for every name (Codex r1 P2)', 'scripts/host/cobbleoverflowread.py',
     "    roomy = lambda e, c: bool(e) and e.get('known') is True and int((e.get('max') or {}).get(c['name']) or 0) >= c['count']",
     "    roomy = lambda e, c: bool(e) and e.get('known') is True and int((e.get('max') or {}).get('cobblestone') or 0) >= c['count']", PY),
    ("the read: D2 ignores the click's own reading", 'scripts/host/cobbleoverflowread.py',
     "    return f.get('cap') == 'below' and f.get('mode') == 'overflow' and f.get('known') == '1' and mx is not None and mx < num(f, 'count')",
     "    return f.get('cap') == 'below' and f.get('mode') == 'overflow' and f.get('known') == '1'", PY),
    ("the read: D2 judges the visit's last reading (Codex r1 P2)", 'scripts/host/cobbleoverflowread.py',
     "    d2 = [(r['bot'], f.get('name'), f.get('count'), f.get('cap'), f.get('max'), str(r['t'])) for r, f in clicks if not click_ok(f)]",
     "    d2 = [(r['bot'], f.get('name'), f.get('count'), f.get('cap'), f.get('max'), str(r['t'])) for r, f in clicks if not click_ok(f)] + [(r['bot'],) for r, f in throws if f.get('cap') != 'below']", PY),
    ('the read: the arms gate never fires', 'scripts/host/cobbleoverflowread.py',
     "    out['arms_control_rows'] = sum(1 for r in post_k if r['name'] in ('_cobbleoverflow_mode', '_cobble_overflow') or overflow_of(r) > 0)",
     "    out['arms_control_rows'] = 0", PY),
    ('the read: exposure counts any bag', 'scripts/host/cobbleoverflowread.py',
     "        return r['cobble'] is not None and r['cobble'] >= SURPLUS_MIN", "        return True", PY),
    ('the read: an at-cap throw counts as liveness', 'scripts/host/cobbleoverflowread.py',
     "    return num(kv(r['detail']), 'overflow') if r['name'] == '_well_dispose' else 0",
     "    return num(kv(r['detail']), 'cobble') if r['name'] == '_well_dispose' else 0", PY),
    ('the read: a canary row of another build is kept', 'scripts/host/cobbleoverflowread.py',
     "                    if arm == 'canary' and per == 'post' and cv and ver and not ver.startswith(cv):", "                    if False:", PY),
    ('the audit: folds records appended AFTER the event', 'scripts/host/cobbleroomaudit.mjs',
     '        while (i < rs.length && !(Number(rs[i].at) > e.at)) {', '        while (i < rs.length) {', PY),
]


def main():
    MS.MUTANTS[:] = MUTANTS
    root = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    killed = survived = 0
    baseline = {}
    for name, rel, old, new, files in MUTANTS:
        if only and only not in name:
            continue
        path = os.path.join(root, rel)
        src = open(path).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n}: {name}'
        for f in files:
            if f not in baseline:
                baseline[f] = not MS.run(root, [f])
            assert baseline[f], f'baseline already fails {f}: the mutant cannot be judged'
        try:
            open(path, 'w').write(src.replace(old, new, 1))
            bad = MS.run(root, files)
        finally:
            open(path, 'w').write(src)
        if bad:
            killed += 1; print(f'KILLED    {name}  ({", ".join(bad)})', flush=True)
        else:
            survived += 1; print(f'SURVIVED  {name}', flush=True)
    print(f'cobbleoverflow-01: {killed} killed, {survived} survived')
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
