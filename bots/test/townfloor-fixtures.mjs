// townfloor-01 test fixtures (not a test file: run-tests.mjs runs *.test.mjs only). Synthetic towns, the replay and the
// INDEPENDENT oracle, shared by townfloor.test.mjs and the two heavy replay files (each file stays well inside the runner's
// 120 s limit under load).
import assert from 'node:assert/strict'
const F = await import('../src/townfloor.mjs')
export { F }
export const HOME = { x: 0, y: 64, z: 0 }
export const L = 62
export const OPEN = new Set(['air', 'cave_air', 'short_grass', 'poppy', 'oak_sapling', 'torch', 'water', 'lava', 'cobweb'])
export const HALF = /(_slab|_bed)$/
export const blk = name => (name == null ? null : { name, boundingBox: OPEN.has(name) ? 'empty' : 'block', shapes: OPEN.has(name) ? [] : HALF.test(name) ? [[0, 0, 0, 1, 0.5, 1]] : [[0, 0, 0, 1, 1, 1]], hardness: 1.5, props: null })
/** A town: stone up to the floor level, the 13x13 platform of stone_bricks at L, grass around it, air above; loaded within
 *  40 of home. `cells` overrides ({ 'x,y,z': name }). */
export function town (cells = {}, { loaded = 40 } = {}) {
  const m = new Map(Object.entries(cells))
  const name = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (m.has(k)) return m.get(k)
    if (Math.abs(x) > loaded || Math.abs(z) > loaded) return null
    if (y > L) return 'air'
    if (y === L) return Math.max(Math.abs(x), Math.abs(z)) <= 6 ? 'stone_bricks' : 'grass_block'
    return 'stone'
  }
  const cache = new Map()
  const read = (x, y, z) => { const k = `${x},${y},${z}`; if (!cache.has(k)) cache.set(k, blk(name(x, y, z))); return cache.get(k) }
  return { m, read, set: (x, y, z, n) => { m.set(`${x},${y},${z}`, n); cache.delete(`${x},${y},${z}`) } }
}
export const carve = (cells, x0, x1, y0, y1, z0, z1, n = 'air') => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells[`${x},${y},${z}`] = n; return cells }

// ---- an INDEPENDENT oracle (Claude r1 P2-5: the replay must not judge the planner only by the planner's own code) ----------
export const isOpen = b => !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name)
export const isSolid = b => !!b && b.boundingBox === 'block'
export const stands = (r, x, y, z) => isOpen(r(x, y, z)) && isOpen(r(x, y + 1, z)) && isSolid(r(x, y - 1, z))
/** Every feet cell from which a body walks to `to` (walk, step up 1, drop 1..3; no dig), found by a FORWARD search from each
 *  cell -- slow and simple, written apart from townfloor.mjs. -> Set of 'x,y,z'. */
export function homeWalkers (r, goals, box) {
  const ok = (x, y, z) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && y >= box.y0 && y <= box.y1 && stands(r, x, y, z)
  const next = (x, y, z) => {
    const out = []
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (ok(nx, y, nz)) { out.push([nx, y, nz]); continue }
      if (isSolid(r(nx, y, nz)) && isOpen(r(x, y + 2, z)) && ok(nx, y + 1, nz)) { out.push([nx, y + 1, nz]); continue }
      if (!isOpen(r(nx, y, nz)) || !isOpen(r(nx, y + 1, nz))) continue
      for (let d = 1; d <= 3; d++) { if (!isOpen(r(nx, y - d, nz))) break; if (isSolid(r(nx, y - d - 1, nz))) { if (ok(nx, y - d, nz)) out.push([nx, y - d, nz]); break } }
    }
    return out
  }
  const all = []
  for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = box.y0; y <= box.y1; y++) if (ok(x, y, z)) all.push([x, y, z])
  const good = new Set((Array.isArray(goals) ? goals : [goals]).map(g => `${g.x},${g.y},${g.z}`)), bad = new Set()
  for (const c of all) {
    const k0 = c.join(',')
    if (good.has(k0) || bad.has(k0)) continue
    const seen = new Set([k0]), q = [c], parent = new Map(); let found = null
    for (let i = 0; i < q.length && !found; i++) {
      const pk = q[i].join(',')
      for (const n of next(...q[i])) { const k = n.join(','); if (good.has(k)) { found = pk; break } if (!seen.has(k) && !bad.has(k)) { seen.add(k); parent.set(k, pk); q.push(n) } }
    }
    // the cells ON the found path reach the goal (each walks the rest of it); the others it merely reached are not proven
    if (found) for (let k = found; k != null; k = parent.get(k)) good.add(k)
    else for (const k of seen) bad.add(k)       // ...and nothing it reaches can, or it could too
  }
  return good
}
/** The closed air pockets of a world: 6-connected open cells that never LEAVE the box (its top is L+12, above anything a
 *  town stands; no height counts as outside -- Codex r2: the oracle must not share the planner's surface rule)
 *  -> [Set of 'x,y,z']. Written apart from townfloor.mjs. */
export function closedPockets (r, box) {
  const seen = new Set(), out = []
  for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = box.y0; y <= box.y1; y++) {
    const k0 = `${x},${y},${z}`
    if (seen.has(k0) || !isOpen(r(x, y, z))) continue
    const comp = new Set([k0]), q = [[x, y, z]]; seen.add(k0); let open = false
    for (let i = 0; i < q.length; i++) {
      const [a, b, c] = q[i]
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = [a + dx, b + dy, c + dz], k = n.join(',')
        if (n[0] < box.x0 || n[0] > box.x1 || n[2] < box.z0 || n[2] > box.z1 || n[1] < box.y0 || n[1] > box.y1) { if (isOpen(r(...n))) open = true; continue }
        if (comp.has(k) || !isOpen(r(...n))) continue
        comp.add(k); seen.add(k); q.push(n)
      }
    }
    if (!open) out.push(comp)
  }
  return out
}
/** THE ORACLE on a whole replay: nobody who walked home before (and was not filled over) cannot after; no new closed pocket
 *  bigger than POCKET_MAX; no closed pocket holds an entity that was not in one before. */
export function oracle (before, after, filled, entities = []) {
  // THE ORACLE'S OWN TOWN (Claude r5: not the planner's anchor): standable cells ON the floor (feet L+1) within 4 of home
  const st = []
  for (let x = HOME.x - 4; x <= HOME.x + 4; x++) for (let z = HOME.z - 4; z <= HOME.z + 4; z++) if (stands(before, x, L + 1, z)) st.push({ x, y: L + 1, z })
  const box = { ...F.floorBox(HOME), x0: F.floorBox(HOME).x0 - 3, x1: F.floorBox(HOME).x1 + 3, z0: F.floorBox(HOME).z0 - 3, z1: F.floorBox(HOME).z1 + 3, y0: F.floorBox(HOME).y0 - 2, y1: L + 3 }
  const pbox = { ...box, y1: L + 12 }
  const w0 = homeWalkers(before, st, box), w1 = homeWalkers(after, st, box)
  const lost = [...w0].filter(k => !w1.has(k) && !filled.has(k))
  assert.deepEqual(lost, [], 'ORACLE: stands that walked home before and do not now')
  const p0 = closedPockets(before, pbox)
  for (const pk of closedPockets(after, pbox)) {
    const old = p0.some(o => [...pk].every(k => o.has(k)))
    if (!old) assert.ok(pk.size <= F.POCKET_MAX, `ORACLE: a new closed pocket of ${pk.size} cells at ${[...pk][0]}`)
    for (const e of entities) assert.ok(!pk.has(`${Math.floor(e.x)},${Math.floor(e.y)},${Math.floor(e.z)}`) || old, `ORACLE: an entity sealed in at ${e.x},${e.y},${e.z}`)
  }
}

/** Replay a plan on a world; assert every promise at each step's turn; -> the final world. */
export function replay (w, plan, { entities = [], start = null } = {}) {
  const st = start ?? plan.start
  assert.ok(st, 'a start')
  const snap = new Map(); const before = (x, y, z) => { const k = `${x},${y},${z}`; return snap.has(k) ? snap.get(k) : w.read(x, y, z) }
  const filled = new Set()
  const box = F.floorBox(HOME)
  for (const [i, s] of plan.steps.entries()) {
    const [x, y, z] = s.c
    const tag = `step ${i} at ${s.c}`
    assert.ok(x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && y >= box.y0 && y <= box.y1, `${tag}: inside the box`)
    // the click is re-proved by the skill's own judge, on the world as it is at its turn
    assert.equal(F.stepRefusal(w.read, s, { home: HOME, start: st, entities }), null, `${tag}: stepRefusal`)
    assert.equal(w.read(x, y - 1, z).boundingBox, 'block', `${tag}: rests on a solid block (never a bridge)`)
    assert.notEqual(s.f[1], -1, `${tag}: never a bottom face`)
    if (!snap.has(`${x},${y},${z}`)) snap.set(`${x},${y},${z}`, w.read(x, y, z))
    filled.add(`${x},${y},${z}`)
    w.set(x, y, z, 'cobblestone')
    assert.ok(F.walkBack(w.read, st, { box: F.walkBox(HOME), strict: true }).has(F.cellKey(s.s[0], s.s[1], s.s[2])), `${tag}: the stand walks back to the town after the click`)
  }
  oracle(before, w.read, filled, entities)
  return w
}

