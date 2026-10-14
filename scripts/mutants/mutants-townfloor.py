#!/usr/bin/env python3
"""External anchored mutants for townfloor-01 (the town floor: townfloor.mjs, the fill_town skill, the floor order).

    python3 scripts/mutants/mutants-townfloor.py <export-dir> [name-filter]

<export-dir> is a `git archive` export of the branch under test with bots/node_modules linked. Each mutant asserts its
anchor is present EXACTLY ONCE (a mutant that silently fails to apply reads as killed -- CLAUDE.md), applies it, runs the
named test files with the suite runner (scripts/run-tests.mjs, its env), and is KILLED only if a file fails. The file is
restored either way. The unmutated tree must pass each file first, or the mutant cannot be judged.
"""
import os, subprocess, sys

ENV = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300',
           OLLAMA_MODEL='qwen2.5:7b-instruct', OLLAMA_BASE_URL='http://127.0.0.1:11434')
P = ['townfloor']
SK = ['townfloor-skill']
PY = ['py:scripts/host/townfloorread.py']
TF = 'bots/src/townfloor.mjs'
S = 'bots/src/skills.mjs'
C = 'bots/src/cognitive.mjs'
MUTANTS = [
    # ---- the box and the cells
    ('the box is wider than the zone', TF, 'export const FLOOR_HALF = 16', 'export const FLOOR_HALF = 17', P),
    ('the floor level one higher (fills the walking layer over the platform)', TF,
     'export const floorLevel = home => Math.floor(home.y) - 2', 'export const floorLevel = home => Math.floor(home.y) - 1', P),
    ('a cell over water is a target', TF, "        if (liquidBelow && y <= box.y1 && passable(b)) protect(x, y, z, 'over_liquid')\n", '', P),
    ('a sapling column is a target', TF, "        if (SAPLING.test(n)) for (let u = 0; u <= 7; u++) protect(x, y + u, z, 'sapling')\n", '', P),
    ('the cell over farmland is a target', TF, "        if (n === 'farmland') protect(x, y + 1, z, 'farmland')\n", '', P),
    ('furniture has no clearance', TF,
     "          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) protect(x + dx, y + dy, z + dz, 'furniture')\n", '', P),
    ('a keep-out is ignored', TF,
     "    for (let x = o.x - r; x <= o.x + r; x++) for (let z = o.z - r; z <= o.z + r; z++) for (let y = o.y - down; y <= o.y + up; y++) protect(x, y, z, 'keepout')\n", '', P),
    ('a flower is placed into', TF, "        if (!replaceable(b)) { tally.plant++; continue }", "        if (false) { tally.plant++; continue }", P),
    ('an unloaded cell is planned on a guess', TF, "  if (cls.tally.unknown) return { steps: [], tally, why: 'unknown' }\n", '', P),
    # ---- supports, stands, seals
    ('a bridge: support without a full cube below', TF, '  if (!fullFloor(below)) return []', '  if (false) return []', P),
    ('the sky is mere height (the L+1 shortcut)', TF, '    return y >= f\n  }', '    return true\n  }', P),
    ('the sky is a finite scan (L+10)', TF, '      for (let yy = WORLD_TOP; yy >= surfaceY; yy--) {', '      for (let yy = region.y1; yy >= surfaceY; yy--) {', P),
    ('the builder may stand on a slab', TF, '        if (!builderStand(read, x, y, z)) continue\n', '', P),
    ('a click is proved from the planned stand, not where the builder is', S,
     '          { const f = bot.entity.position.floored(); if (f.x !== stand.x || f.y !== stand.y || f.z !== stand.z || !centredOn(bot, stand)) {',
     '          { const f = bot.entity.position.floored(); if (false) {', SK),
    ('building is stagnation to the watchdog', 'bots/src/watchdog.mjs', '                     gained <= 0 && !built', '                     gained <= 0', ['watchdog-busy']),
    ('a chest is a support', TF, "|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|^composter$|_bed$|_sign$|^bell$|^anvil$/", "|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|^composter$|_bed$|_sign$|^bell$|^anvil$/", P),
    ('a stand need not walk back after the click', TF, '      const usable = { has: k => dist.has(k) && backB.has(k) }', '      const usable = { has: k => dist.has(k) }', P),
    ('the seal check is skipped by the planner', TF,
     "      if (sw) { tally.sealwhy[sw] = (tally.sealwhy[sw] ?? 0) + 1; fail(sw === 'entity' ? 'occupied' : 'seal'); continue }", "      if (false) { fail('seal'); continue }", P),
    ('a big void may be closed', TF, "    if (r.cells.length > POCKET_MAX) return 'pocket'\n", '', P),
    ('a pocket holding an item may be closed', TF, "        inside.has(K(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z)))))) return 'entity'", "        inside.has(K(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z)))))) {}", P),
    ('an unbounded space may be cut', TF, "    if (r.kind === 'unbounded') return 'unbounded'\n", '', P),
    ('leaving the region is not unbounded', TF, "  if (leaked) return { kind: 'unbounded', cells: null }\n", '', P),
    ('a way may be cut (planner)', TF, "      if (lostWay(backNow, back, key) != null) { fail('cut'); continue }\n", '', P),
    ('a way may be cut (at the click)', TF, "  if (lostWay(walkBack(read, start, { box }), backAfter, K(x, y, z)) != null) return 'cut'\n", '', P),
    ('the builder may wall itself in (at the click)', TF, "  if (!walkBack(after, start, { box, strict: true }).has(K(sx, sy, sz))) return 'walled_in'\n", '', P),
    ('the builder plans over beds (permissive walking for its own route)', TF, '  let dist = walkDist(world, st, { box, strict: true })', '  let dist = walkDist(world, st, { box })', P),
    ('strict walking is permissive', TF, '  if (!strict) return passable(read(x, y, z)) && passable(read(x, y + 1, z)) && solid(read(x, y - 1, z))', '  return passable(read(x, y, z)) && passable(read(x, y + 1, z)) && solid(read(x, y - 1, z))', P),
    ('a refused step is planned again in the same visit', S, '    visitSkip.add(k)\n', '', SK),
    ('protected ways judged strictly (the bed route may be cut)', TF, '    const backNow = walkBack(world, st, { box })', '    const backNow = walkBack(world, st, { box, strict: true })', P),
    ('the builder returns permissively (over beds)', TF, "      const backB = walkBack(world, st, { box, strict: true })", "      const backB = walkBack(world, st, { box })", P),
    ('walled_in judged permissively', TF, '  if (!walkBack(after, start, { box, strict: true }).has(K(sx, sy, sz))) return', '  if (!walkBack(after, start, { box }).has(K(sx, sy, sz))) return', P),
    ('strict transit is permissive (a drop through a cobweb)', TF, '  const pass = strict ? clearBody : passable                     // strict transit too', '  const pass = passable                     // strict transit too', P),
    ('a passing body holds the town an hour', S, '      const none = !stats.placed && !transientSkip && ', '      const none = !stats.placed && ', SK),
    ('a plinth plan cell is not a keep-out', S, '      if (Array.isArray(st?.c) && st.c.length === 3 && st.c.every(Number.isFinite)) out.push({ x: st.c[0], y: st.c[1], z: st.c[2], r: 0, up: 0, down: 0 })\n', '', SK),
    ('any empty pocket may be closed', TF, 'export const POCKET_MAX = 8', 'export const POCKET_MAX = 1e9', P),
    ('no cell hazards for targets', TF, '        if (hz) { tally[hz] = (tally[hz] ?? 0) + 1; continue }\n', '', P),
    ('no liquid clearance', TF, 'export const LIQUID_CLEAR_H = 2', 'export const LIQUID_CLEAR_H = 0', P),
    ('floating sand is no hazard', TF, "    if (unsupportedGravity(read, x + dx, y + dy, z + dz)) return 'gravity'\n", '', P),
    ('cold cells are not put last', TF, 'isCold(p.t) - isCold(q.t) || ', '', P),
    ('cold only after the tier (refused platform cells starve the rest)', TF, 'eligible.sort((p, q) => isCold(p.t) - isCold(q.t) || p.t.tier - q.t.tier || ', 'eligible.sort((p, q) => p.t.tier - q.t.tier || isCold(p.t) - isCold(q.t) || ', P),
    ('a body or an item makes a cell cold', TF, '!placedKeys.has(k) && !transient.has(k)', '!placedKeys.has(k)', P),
    ('a cell holding a body is placed into', TF, "      if (occ.has(key)) { fail('occupied'); continue }", '', P),
    # ---- the order
    ('lowest first (strands the layer under a roof)', TF, 'p.t.tier - q.t.tier || q.t.y - p.t.y || q.a - p.a ||', 'p.t.tier - q.t.tier || p.t.y - q.t.y || q.a - p.a ||', P),
    ('near first', TF, 'p.t.tier - q.t.tier || q.t.y - p.t.y || q.a - p.a ||', 'p.t.tier - q.t.tier || q.t.y - p.t.y || p.a - q.a ||', P),
    ('no platform tier', TF, 'isCold(p.t) - isCold(q.t) || p.t.tier - q.t.tier || ', 'isCold(p.t) - isCold(q.t) || ', P),
    # ---- the click's re-proof (pure)
    ('the re-proof misses a chest put beside', TF, "    if (b && isFurniture(b.name)) return 'furniture'\n  }\n  for (let u = 1;", "    if (false) return 'furniture'\n  }\n  for (let u = 1;", P + SK),
    ('the re-proof misses a body in the cell', TF, "    if (ex === x && ez === z && (ey === y || (e.player && ey + 1 === y))) return 'occupied'", '', P),
    # ---- funding
    ('the reserve is spent', TF, '    if (COBBLE.has(name) && cobbleOf(list) - 1 < COBBLE_RESERVE) continue\n', '', P + SK),
    ('the budget counts the reserve', TF, '  return Math.max(0, Math.min(cap, deco + Math.max(0, cobbleOf(list) - COBBLE_RESERVE)))', '  return Math.max(0, Math.min(cap, deco + cobbleOf(list)))', P + SK),
    ('cobble before the decorations', TF,
     "export const FLOOR_BLOCKS = Object.freeze(['andesite', 'diorite', 'granite', 'cobbled_deepslate', 'cobblestone'])",
     "export const FLOOR_BLOCKS = Object.freeze(['cobbled_deepslate', 'cobblestone', 'andesite', 'diorite', 'granite'])", P + SK),
    # ---- lease, record, order
    ('any token holds the lease', TF, '  if (me != null && lease.token === me) return', '  if (me != null) return', P),
    ('one drop skips a cell', TF, '    if ((Number(v?.n) || 0) >= STUCK_TRIES && now - (Number(v?.at) || 0) < STUCK_HOLD_MS) out.add(Number(k))',
     '    if ((Number(v?.n) || 0) >= 1 && now - (Number(v?.at) || 0) < STUCK_HOLD_MS) out.add(Number(k))', P),
    ('no noneAt is not held (the null bug)', TF, '  if (rec?.noneAt == null) return false\n', '', P),
    ('the order fires away from town', TF, '  if (!(distHome <= TOWN_RADIUS)) return none()\n', '', P),
    ('the order fires without the zone', TF, '  if (!zone) return none()\n', '', P),
    ('the order fires deep under the town', TF, '  if (!(Math.abs(dy) <= FLOOR_DEPTH + 6)) return none()\n', '', P),
    ('the order fires unfunded', TF, '  if (b < FLOOR_MIN_FUND) return none()\n', '', P),
    ('the order ignores another builder', TF, '  if (l && !l.free) return none()\n', '', P),
    ('the order ignores the hold', TF, '  if (lz(held)) return none()\n', '', P),
    ('nothing to do does not hold', TF, "  if (status === 'no_effect' && failClass === 'floor_none') { s.backoffUntil = Math.max(s.backoffUntil ?? 0, now + FLOOR_NONE_BACKOFF_MS); return s }\n", '', P),
    # ---- the skill
    ('no lease is taken', S, "  if (!lease.ok) return skip('lease', `${lease.holder ?? 'another bot'} is filling the town floor`, 'floor_lease')", '', SK),
    ('the skill runs away from town', S, "  if (!p0 || Math.hypot(p0.x - home.x, p0.z - home.z) > TOWN_RADIUS || Math.abs(p0.y - home.y) > FLOOR_DEPTH + 6) return skip(", "  if (false) return skip(", SK),
    ('the skill runs unfunded', S, '  if (budget0 < FLOOR_MIN_FUND) {', '  if (false) {', SK),
    ('the click is not re-proved after the pacing', S,
     '          const why = stepRefusal(readWellCell(bot), s, { home, start, entities: floorEntities(bot), keepOut })', '          const why = null', SK),
    ('a dropped click counts as placed', S, '        const ok = solidAt()', '        const ok = true', SK),
    ('a drop is not remembered', S, '        stuck = stuckAfter(stuck, String(cellKey(target.x, target.y, target.z)), ok, Date.now())\n', '', SK),
    ('the lease is not released', S, '    try { releaseFloorLease(token, lease.n) } catch { /* expires on its own */ }\n', '', SK),
    ('nothing to do is not recorded', S, '...(none ? { noneAt: Date.now() } : stats.placed ? { noneAt: null } : {})', '...(stats.placed ? { noneAt: null } : {})', SK),
    ('the hold is not read by the skill', S, "  if (floorHeld(readTownFloor(bot), Date.now())) return skip('held',", "  if (false) return skip('held',", SK),
    # ---- the wiring
    ('the loop never issues the floor', C, '        const r = floorOrder({ now: Date.now(), distHome:', '        const r = { order: null, state: {} } || floorOrder({ now: Date.now(), distHome:', SK),
    ('the floor preempts the milestone', C, '    if (!order) {\n      try {\n        const bot = this.bot\n        const p = bot.entity?.position\n        const home = { x: config.world.homeX, z: config.world.homeZ }\n        let fs = null',
     '    if (true) {\n      try {\n        const bot = this.bot\n        const p = bot.entity?.position\n        const home = { x: config.world.homeX, z: config.world.homeZ }\n        let fs = null', SK),
    ('fill_town is not housekeeping', 'bots/src/hygiene.mjs', "'prune_town', 'count_town', 'fill_town'])", "'prune_town', 'count_town'])", SK),
]


def run(root, files):
    bad = []
    for f in files:
        if f.startswith('py:'):
            r = subprocess.run(['python3', f[3:], '--selftest'], cwd=root, env=dict(ENV, TF_SELFTEST='1'), capture_output=True, text=True, timeout=600)
        else:
            r = subprocess.run(['node', 'scripts/run-tests.mjs', f'{f}.test.mjs'], cwd=os.path.join(root, 'bots'), env=ENV, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            bad.append(f)
    return bad


def main():
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
                baseline[f] = not run(root, [f])
            assert baseline[f], f'baseline already fails {f}: the mutant cannot be judged'
        try:
            open(path, 'w').write(src.replace(old, new, 1))
            bad = run(root, files)
        finally:
            open(path, 'w').write(src)
        if bad:
            killed += 1; print(f'KILLED    {name}  ({", ".join(bad)})', flush=True)
        else:
            survived += 1; print(f'SURVIVED  {name}', flush=True)
    print(f'townfloor: {killed} killed, {survived} survived')
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()
