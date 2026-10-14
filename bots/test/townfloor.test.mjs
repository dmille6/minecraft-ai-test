// townfloor-01 (10-14): the town floor's pure decisions -- which cells, the order, the stands, never sealing anything, the
// funding, the lease and the order -- tested by behaviour on synthetic towns (CLAUDE.md: extract the decision, test it).
//
// Every planned step is REPLAYED on the world it was planned for, and the invariants the design promises are asserted on
// the replay, never on the plan's own say-so: each cell rests on a solid block at its turn (bottom-up, never a bridge),
// each click is in reach from its stand with a clear sight, the stand walks back to the town after the click (the
// builder never walls itself in), no cell is protected or outside the box, and nothing is sealed.
import assert from 'node:assert/strict'

const F = await import('../src/townfloor.mjs')
const TG = await import('../src/townground.mjs')
const { COBBLE_RESERVE } = await import('../src/bankable.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n        ')}`)
  }
}

const HOME = { x: 0, y: 64, z: 0 }
const L = 62
const OPEN = new Set(['air', 'cave_air', 'short_grass', 'poppy', 'oak_sapling', 'torch', 'water', 'lava'])
const blk = name => (name == null ? null : { name, boundingBox: OPEN.has(name) ? 'empty' : 'block', shapes: OPEN.has(name) ? [] : [[0, 0, 0, 1, 1, 1]], hardness: 1.5, props: null })
/** A town: stone up to the floor level, the 13x13 platform of stone_bricks at L, grass around it, air above; loaded within
 *  40 of home. `cells` overrides ({ 'x,y,z': name }). */
function town (cells = {}, { loaded = 40 } = {}) {
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
const carve = (cells, x0, x1, y0, y1, z0, z1, n = 'air') => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells[`${x},${y},${z}`] = n; return cells }

// ---- an INDEPENDENT oracle (Claude r1 P2-5: the replay must not judge the planner only by the planner's own code) ----------
const isOpen = b => !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name)
const isSolid = b => !!b && b.boundingBox === 'block'
const stands = (r, x, y, z) => isOpen(r(x, y, z)) && isOpen(r(x, y + 1, z)) && isSolid(r(x, y - 1, z))
/** Every feet cell from which a body walks to `to` (walk, step up 1, drop 1..3; no dig), found by a FORWARD search from each
 *  cell -- slow and simple, written apart from townfloor.mjs. -> Set of 'x,y,z'. */
function homeWalkers (r, to, box) {
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
  const goal = `${to.x},${to.y},${to.z}`, good = new Set([goal]), bad = new Set()
  for (const c of all) {
    const k0 = c.join(',')
    if (good.has(k0) || bad.has(k0)) continue
    const seen = new Set([k0]), q = [c]; let found = false
    for (let i = 0; i < q.length && !found; i++) for (const n of next(...q[i])) { const k = n.join(','); if (good.has(k)) { found = true; break } if (!seen.has(k) && !bad.has(k)) { seen.add(k); q.push(n) } }
    if (found) good.add(k0)                     // only the start cell is proven: what it reaches need not reach the goal
    else for (const k of seen) bad.add(k)       // ...but nothing it reaches can, or it could too
  }
  return good
}
/** The closed air pockets of a world: 6-connected open cells that never LEAVE the box (its top is L+12, above anything a
 *  town stands; no height counts as outside -- Codex r2: the oracle must not share the planner's surface rule)
 *  -> [Set of 'x,y,z']. Written apart from townfloor.mjs. */
function closedPockets (r, box) {
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
function oracle (before, after, filled, entities = []) {
  const st = F.startNear(before, HOME), box = { ...F.floorBox(HOME), x0: F.floorBox(HOME).x0 - 3, x1: F.floorBox(HOME).x1 + 3, z0: F.floorBox(HOME).z0 - 3, z1: F.floorBox(HOME).z1 + 3, y0: F.floorBox(HOME).y0 - 2, y1: L + 3 }
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
function replay (w, plan, { entities = [], start = null } = {}) {
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
    assert.ok(F.walkDist(w.read, { x: s.s[0], y: s.s[1], z: s.s[2] }, { box: F.walkBox(HOME) }).has(F.cellKey(st.x, st.y, st.z)), `${tag}: the stand walks back to the town after the click`)
  }
  oracle(before, w.read, filled, entities)
  return w
}

// ---- the box and the zone -----------------------------------------------------------------------------------------------

await t('THE BOX IS THE ZONE\'S: every cell the floor may fill is town ground the zone protects, and every floor block is terrain (a gatherer in the zone is refused it)', () => {
  for (const home of [HOME, { x: 355, y: 73, z: 147 }, { x: -249, y: 65, z: 144 }]) {
    const b = F.floorBox(home)
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [b.y0, b.y1]) {
      assert.equal(TG.inTownBox({ x, y, z }, home), true, `corner ${x},${y},${z} of ${JSON.stringify(home)} is in the zone box`)
      for (const n of F.FLOOR_BLOCKS) assert.equal(TG.townDigClass({ x, y, z }, n, home), 'ground', `${n} placed there is ground`)
      // WITH THE ZONE IN THE BUILD (townfloor x townzone): a gatherer's or a miner's target dig of the fill is refused
      if (F.zoneLive(TG)) for (const n of F.FLOOR_BLOCKS) assert.equal(TG.townTargetPermit({ x, y, z }, n, home).ok, false, `${n} at a box corner is refused as a target`)
    }
    // positive control: one outside the box is not the floor's (and the zone's edge is where the box ends)
    assert.equal(TG.inTownBox({ x: b.x1 + 1, y: b.y1, z: b.z0 }, home), false)
  }
  assert.equal(F.FLOOR_HALF, TG.TOWN_GROUND_HALF)
  assert.equal(F.floorLevel(HOME) - F.FLOOR_DEPTH, HOME.y - TG.TOWN_GROUND_DEPTH)
})

// ---- which cells ----------------------------------------------------------------------------------------------------------

await t('floorCells: an open hole in the box is a target; above the floor level, outside the square or below the depth it is not', () => {
  const c = carve({}, 3, 3, 52, 62, 3, 3)          // a 1x1 shaft from the floor down to the box bottom
  c['17,62,0'] = 'air'; c['0,63,9'] = 'air'; c['3,51,3'] = 'air'
  const w = town(c)
  const r = F.floorCells(w.read, HOME)
  const keys = new Set(r.targets.map(q => `${q.x},${q.y},${q.z}`))
  for (let y = 52; y <= 62; y++) assert.ok(keys.has(`3,${y},3`), `3,${y},3`)
  assert.equal(keys.has('17,62,0'), false); assert.equal(keys.has('3,51,3'), false)
  assert.equal(r.targets.length, 11)
  assert.equal(r.targets.find(q => q.x === 3).tier, 0, 'inside the platform square: tier 0')
})

await t('floorCells PROTECTS: water and every cell over it, a sapling\'s growth column, the cell over farmland, furniture\'s neighbours, a keep-out; a flower is never placed into', () => {
  const c = {}
  carve(c, -8, -8, 59, 62, -8, -8); c['-8,59,-8'] = 'water'                       // a pool with air over it
  carve(c, 8, 8, 61, 62, 8, 8); c['8,60,8'] = 'dirt'; c['8,61,8'] = 'oak_sapling'  // a sapling in a pit
  carve(c, -8, -8, 61, 62, 8, 8); c['-8,61,8'] = 'farmland'                         // a cell over farmland
  c['2,63,0'] = 'chest'; c['2,62,1'] = 'air'                                        // a hole beside a chest
  c['-5,62,-5'] = 'air'                                                             // a keep-out cell
  c['10,62,-10'] = 'poppy'                                                          // a flower in a hole
  c['12,62,12'] = 'air'                                                             // positive control: a plain hole
  const r = F.floorCells(town(c).read, HOME, { keepOut: [{ x: -5, y: 62, z: -5, r: 0 }] })
  const keys = new Set(r.targets.map(q => `${q.x},${q.y},${q.z}`))
  for (const k of ['-8,60,-8', '-8,61,-8', '-8,62,-8', '8,62,8', '-8,62,8', '2,62,1', '-5,62,-5', '10,62,-10']) assert.equal(keys.has(k), false, k)
  assert.ok(keys.has('12,62,12'), 'the plain hole is a target (positive control)')
  assert.ok(r.tally.over_liquid >= 3 && r.tally.sapling >= 1 && r.tally.farmland >= 1 && r.tally.furniture >= 1 && r.tally.keepout >= 1 && r.tally.plant >= 1, JSON.stringify(r.tally))
})

await t('floorCells: a cell not loaded is counted, and planFloor plans NOTHING on a guess', () => {
  const w = town(carve({}, 3, 3, 60, 62, 3, 3), { loaded: 10 })
  assert.ok(F.floorCells(w.read, HOME).tally.unknown > 0)
  const p = F.planFloor({ read: w.read, home: HOME })
  assert.equal(p.why, 'unknown'); assert.equal(p.steps.length, 0)
})

// ---- supports and seals ---------------------------------------------------------------------------------------------------

await t('floorSupports: only over a solid block -- its top face first, then solid sides; never a bottom face, never a chest', () => {
  const c = carve({}, 3, 3, 60, 62, 3, 3); c['4,60,3'] = 'chest'
  const w = town(c)
  assert.deepEqual(F.floorSupports(w.read, { x: 3, y: 61, z: 3 }), [], 'open below: no support (no bridge)')
  const s = F.floorSupports(w.read, { x: 3, y: 60, z: 3 })
  assert.deepEqual(s[0], { ref: { x: 3, y: 59, z: 3 }, face: [0, 1, 0] })
  assert.ok(!s.some(o => o.ref.x === 4 && o.ref.y === 60), 'a chest is not a support (the click would open it)')
  assert.equal(s.length, 4, 'top + three stone sides')
  assert.ok(s.every(o => o.face[1] !== -1))
})

await t('sealRefusal: a pit open to the sky never seals; closing a small empty dead end is allowed; a pocket holding an item or a body, a big void, or a tunnel leading out of the region is never closed', () => {
  // a dead end: tunnel 5..7 at y 58 off a pit at x 4 that is open to the sky
  const c = carve({}, 4, 4, 58, 62, 4, 4); carve(c, 5, 7, 58, 58, 4, 4)
  const w = town(c)
  assert.equal(F.sealRefusal(w.read, { x: 4, y: 58, z: 4 }, { home: HOME }), null, 'the dead end (3 cells) may be closed when empty')
  assert.equal(F.sealRefusal(w.read, { x: 4, y: 58, z: 4 }, { home: HOME, entities: [{ x: 6.5, y: 58, z: 4.5 }] }), 'entity', 'an item in it: never')
  assert.equal(F.sealRefusal(w.read, { x: 4, y: 59, z: 4 }, { home: HOME }), null, 'a cell with the sky above it seals nothing')
  // a big void behind the mouth
  const c2 = carve({}, 4, 4, 58, 62, 4, 4); carve(c2, 5, 9, 56, 58, 2, 6)
  assert.equal(F.sealRefusal(town(c2).read, { x: 4, y: 58, z: 4 }, { home: HOME }), 'pocket')
  // a tunnel that leaves the region at depth (a mine): its mouth is never cut off from the surface
  const c3 = carve({}, 12, 12, 53, 62, 0, 0); carve(c3, 13, 30, 53, 54, 0, 0)
  assert.equal(F.sealRefusal(town(c3).read, { x: 12, y: 54, z: 0 }, { home: HOME }), 'unbounded')
  assert.equal(F.sealRefusal(town(c3).read, { x: 12, y: 53, z: 0 }, { home: HOME }), null, 'positive control: below the mouth the tunnel still reaches the pit')
})

// ---- the planner ----------------------------------------------------------------------------------------------------------

/** A 3x3x3 pit at 8..10 with a walkable stair cut into its east side (feet 61 at x 11, 62 at x 12, the rim at 13). */
const pitWithStair = (c = {}) => { carve(c, 8, 10, 60, 62, 8, 10); carve(c, 11, 11, 61, 62, 9, 9); carve(c, 12, 12, 62, 62, 9, 9); return c }

await t('A PIT WITH A STAIR: every cell filled bottom-up, each click re-proved on the replay; the builder never walls itself in; nothing left', () => {
  const w = town(pitWithStair())
  const before = F.floorCells(w.read, HOME).targets.length
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 100 })
  assert.equal(p.steps.length, before, `${p.why} ${JSON.stringify(p.tally)}`)
  replay(w, p)
  assert.equal(F.floorCells(w.read, HOME).targets.length, 0, 'the pit and its stair are gone')
  // bottom-up per column, observed in the order itself
  const seen = new Map()
  for (const s of p.steps) { const k = `${s.c[0]},${s.c[2]}`; assert.ok(!seen.has(k) || seen.get(k) < s.c[1]); seen.set(k, s.c[1]) }
})

await t('A DEEP PIT WITH NO WAY DOWN is not filled from its rim (a centred eye cannot see its floor past the rim: never a click through a block); a 1-deep hole is', () => {
  const c = carve({}, 8, 10, 60, 62, 8, 10)
  carve(c, -10, -8, 62, 62, -10, -8)
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 100 })
  assert.ok(!p.steps.some(s => s.c[0] >= 8), 'nothing in the deep pit')
  assert.equal(p.steps.filter(s => s.c[0] <= -8).length, 9, 'the shallow hole is filled')
  replay(w, p)
})

await t('A CAVERN UNDER THE PLATFORM reached by a stair: filled from the far end (FAR FIRST), the platform square first, the stair last; every step replays', () => {
  const c = carve({}, -3, 3, 58, 61, -3, 3)                                   // the hollow under the platform (4 high)
  // a stair from the grass at x 10 down to the cavern floor: feet 61, 60, 59, 58 at x 9, 8, 7, 6..4 (2-high head room)
  for (const [x, f] of [[9, 62], [8, 61], [7, 60], [6, 59], [5, 58], [4, 58]]) carve(c, x, x, f, Math.min(62, f + 2), 0, 0)
  const w = town(c)
  const before = F.floorCells(w.read, HOME).targets.length
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1000 })
  assert.ok(p.steps.length >= before - 12, `most of the ${before} cells filled: ${p.steps.length} (${p.why}) ${JSON.stringify(p.tally)}`)
  replay(w, p)
  const tiers = p.steps.map(s => s.tier)
  assert.equal(tiers.indexOf(1) === -1 || tiers.lastIndexOf(0) < tiers.indexOf(1), true, 'every tier-0 cell before the first tier-1 cell')
  // FAR FIRST: the first cell filled is at the cavern's far wall (x = -3), not at the stair's mouth
  assert.equal(p.steps[0].c[0], -3, `first ${p.steps[0].c}`)
})

await t('FAR FIRST closes a dead-end tunnel from its end back to its mouth (the rest stays reachable)', () => {
  const c = carve({}, 10, 10, 60, 62, 0, 0)                                    // a 3-deep shaft at x 10 (a bot drops in? no: 3 is a drop)
  carve(c, 9, 9, 61, 62, 0, 0); carve(c, 8, 8, 62, 62, 0, 0)                   // steps down into it from the west
  carve(c, 11, 15, 60, 61, 0, 0)                                               // a 2-high tunnel east from the shaft bottom
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1000 })
  replay(w, p)
  const floorRow = p.steps.filter(s => s.c[1] === 60 && s.c[0] >= 11).map(s => s.c[0])
  assert.deepEqual(floorRow, [...floorRow].sort((a, b) => b - a), `the tunnel floor is filled from x 15 back to 11: ${floorRow}`)
  assert.ok(floorRow.length >= 4, `${floorRow}`)
})

await t('NEVER INTO A PROTECTED CELL: never over water nor within 2 of it, never into a sapling\'s column; the plain holes around them are filled', () => {
  const c = carve({}, 8, 10, 62, 62, 8, 10)                                    // a plain 3x3 hole
  c['15,61,0'] = 'water'; carve(c, 13, 15, 62, 62, 0, 0)                        // a pool with open cells beside it
  c['12,62,0'] = 'air'                                                         // 3 from the water: a plain hole
  carve(c, -10, -10, 61, 62, -10, -10); c['-10,60,-10'] = 'dirt'; c['-10,61,-10'] = 'oak_sapling'
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 200 })
  const at = new Set(p.steps.map(s => s.c.join(',')))
  for (const k of ['15,62,0', '14,62,0', '13,62,0']) assert.ok(!at.has(k), `${k}: over or within 2 of the water`)
  assert.ok(!at.has('-10,62,-10'), 'the sapling column stays open')
  assert.ok(at.has('12,62,0') && at.has('8,62,8') && at.has('10,62,10'), 'positive control: the plain holes are filled')
  assert.equal(at.size, 10)
  assert.ok(F.floorCells(w.read, HOME).tally.near_liquid >= 2)
  replay(w, p)
})

await t('A GRAVITY BLOCK that a placement\'s update would drop (sand beside the cell with air under it) refuses the cell; supported sand does not', () => {
  const c = carve({}, 8, 8, 62, 62, 8, 8)                                      // a 1-deep hole
  c['9,62,8'] = 'sand'; c['9,61,8'] = 'air'; c['9,60,8'] = 'stone'             // floating sand beside it (air under)
  carve(c, -8, -8, 62, 62, 8, 8); c['-9,62,8'] = 'sand'                        // positive control: sand on stone
  const w = town(c)
  assert.equal(F.cellHazard(w.read, 8, 62, 8), 'gravity')
  assert.equal(F.cellHazard(w.read, -8, 62, 8), null)
  const at = new Set(F.planFloor({ read: w.read, home: HOME }).steps.map(s => s.c.join(',')))
  assert.ok(!at.has('8,62,8') && at.has('-8,62,8'))
})

await t('AN UNBOUNDED TUNNEL (a mine leaving the region at depth): its mouth is never closed, the column above it stays open, the rest is filled', () => {
  const c = carve({}, 12, 12, 53, 62, 0, 0); carve(c, 13, 30, 53, 54, 0, 0)
  carve(c, -12, -12, 60, 62, 0, 0)                                              // positive control: a plain pit
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 200 })
  const at = new Set(p.steps.map(s => s.c.join(',')))
  assert.ok(!at.has('12,54,0') && ![...at].some(k => /^12,(5[5-9]|6\d),0$/.test(k)), `the mine's mouth and the column above it: ${[...at].filter(k => k.startsWith('12,'))}`)
  assert.ok(at.has('-12,60,0') && at.has('-12,62,0'), 'the plain pit is filled')
})

await t('NOBODY IS SEALED IN OR PLACED INTO: an item in a dead end keeps its way out; a player in a pit is never boxed in; a cell holding a body is skipped', () => {
  // a dead end with an item; the pit beside it
  const c = carve({}, 4, 4, 58, 62, 10, 10); carve(c, 5, 7, 58, 58, 10, 10)
  const w = town(c)
  const item = { x: 6.5, y: 58, z: 10.5 }
  const p = F.planFloor({ read: w.read, home: HOME, entities: [item], maxSteps: 200 })
  replay(w, p, { entities: [item] })
  assert.ok(F.openReach(w.read, { x: 6, y: 58, z: 10 }, { region: F.sealBox(HOME), surfaceY: L + 1 }).kind === 'surface', 'the item still reaches the open air')
  // a player standing at the bottom of a pit that walks to the town by a stair
  const c2 = carve({}, 8, 10, 60, 62, -10, -8); carve(c2, 11, 11, 61, 62, -9, -9); carve(c2, 12, 12, 62, 62, -9, -9)
  const w2 = town(c2)
  const bot = { x: 9.5, y: 60, z: -8.5, player: true }
  assert.ok(F.walkBack(w2.read, F.startNear(w2.read, HOME), { box: F.walkBox(HOME) }).has(F.cellKey(9, 60, -9)), 'positive control: the player walks to the town before')
  const p2 = F.planFloor({ read: w2.read, home: HOME, entities: [bot], maxSteps: 200 })
  assert.ok(!p2.steps.some(s => s.c[0] === 9 && s.c[2] === -9 && (s.c[1] === 60 || s.c[1] === 61)), 'never into the player\'s feet or head')
  replay(w2, p2, { entities: [bot] })
  assert.ok(F.walkBack(w2.read, F.startNear(w2.read, HOME), { box: F.walkBox(HOME) }).has(F.cellKey(9, 60, -9)), 'the player still walks to the town after the whole plan')
})

await t('NO WAY IS CUT (Codex r1 P1 repro): the mouth of a 2-high tunnel is never filled while a stand beyond it walks to the town -- planned or re-proved at the click, a player there or not', () => {
  const c = {}
  for (const [x, f] of [[4, 62], [5, 61], [6, 60], [7, 60]]) carve(c, x, x, f, 62, 0, 0)   // a stair down from the surface
  carve(c, 8, 14, 60, 61, 0, 0)                                                           // a 2-high tunnel east
  const w = town(c)
  const st = F.startNear(w.read, HOME)
  const box = F.walkBox(HOME)
  assert.ok(F.walkBack(w.read, st, { box }).has(F.cellKey(12, 60, 0)), 'positive control: a stand deep in the tunnel walks to the town')
  // a hand-made step at the mouth, as a stale plan would hold it: refused at the click
  const step = { c: [8, 60, 0], r: [8, 59, 0], f: [0, 1, 0], s: [7, 60, 0], tier: 1 }
  assert.equal(F.stepRefusal(w.read, step, { home: HOME, start: st, entities: [{ x: 12.5, y: 60, z: 0.5, player: true }] }), 'cut')
  assert.equal(F.stepRefusal(w.read, step, { home: HOME, start: st }), 'cut', 'nobody there now: the way is kept all the same')
  // the planner fills the tunnel from its far end, so the mouth's turn comes only when nothing is behind it
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 500 })
  const order = p.steps.map(s => s.c.join(','))
  const mouth = order.indexOf('8,60,0')
  if (mouth >= 0) for (let x = 9; x <= 14; x++) assert.ok(order.indexOf(`${x},60,0`) < mouth, `${x},60,0 before the mouth`)
  replay(w, p)
})

await t('FILLED TO EXHAUSTION AROUND TOWN FURNITURE: a chest and a sapling at the bottom of stair pits -- their cells and lids stay open, and the stand beside the chest still walks to the town (Claude r1 regression)', () => {
  const c = {}
  carve(c, 8, 12, 58, 62, 8, 12); for (const [x, f] of [[13, 59], [14, 60], [15, 61], [16, 62]]) carve(c, x, x, f, 62, 10, 10)   // a 5-deep pit, a stair east
  c['10,58,10'] = 'chest'
  carve(c, -12, -8, 59, 62, 8, 12); for (const [x, f] of [[-13, 60], [-14, 61], [-15, 62]]) carve(c, x, x, f, 62, 10, 10)    // a 4-deep pit, a stair west
  c['-10,59,10'] = 'oak_sapling'; c['-10,58,10'] = 'dirt'
  const w = town(c)
  const chestWay = r => [[9, 58, 10], [11, 58, 10], [10, 58, 9], [10, 58, 11]].some(([x, y, z]) => F.walkBack(r, F.startNear(r, HOME), { box: F.walkBox(HOME) }).has(F.cellKey(x, y, z)))
  assert.ok(chestWay(w.read), 'positive control: before the fill a bot walks to the chest and back')
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 5000 })
  replay(w, p)
  const at = new Set(p.steps.map(s => s.c.join(',')))
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) assert.ok(!at.has(`${10 + dx},${58 + dy},${10 + dz}`), 'nothing beside the chest')
  for (let y = 60; y <= 62; y++) assert.ok(!at.has(`-10,${y},10`), 'the sapling column stays open')
  assert.ok(chestWay(w.read), 'after it, too')
  assert.ok(p.steps.length >= 40, `positive control: the pits were mostly filled (${p.steps.length})`)
})

await t('COLD CELLS GO LAST (Claude r1 P2-2): a visit whose budget of tries ran out does not make the next visit try the same cells first', () => {
  const w = town(carve({}, 8, 10, 62, 62, 8, 10))
  const first = F.planFloor({ read: w.read, home: HOME, maxSteps: 1 }).steps[0].c
  const k = F.cellKey(...first)
  const next = F.planFloor({ read: w.read, home: HOME, maxSteps: 1, cold: new Set([k]) }).steps[0].c
  assert.notDeepEqual(next, first)
  const r = F.planFloor({ read: w.read, home: HOME, maxSteps: 2, maxTries: 0 })
  assert.equal(r.why, 'search_budget', 'a search that ran out of tries says so (no hold)')
  let cold = F.coldAfter({}, [k, 5], [], 1000)
  assert.ok(F.coldKeys({ cold }, 1000).has(k))
  cold = F.coldAfter(cold, [], [k], 2000)
  assert.ok(!F.coldKeys({ cold }, 2000).has(k) && F.coldKeys({ cold }, 2000).has(5), 'a placed cell is no longer cold')
  assert.equal(F.coldKeys({ cold }, 1000 + F.STUCK_HOLD_MS).size, 0, 'cold ages out')
})

await t('A ROOFED POCKET ABOVE THE FLOOR LEVEL is not "outside" (Codex r2 P1 repro): its one-high entrance is never closed on an item in it; empty, the 2-cell dead end may be', () => {
  const c = {}
  c['7,62,0'] = 'air'                                                          // a 1-deep hole, open to the sky
  c['8,62,0'] = 'air'; c['8,63,0'] = 'stone'                                   // the entrance: one high, roofed
  c['9,62,0'] = 'air'; c['9,63,0'] = 'air'                                     // the pocket, one cell above the floor level
  for (const k of ['10,63,0', '9,63,1', '9,63,-1', '9,64,0']) c[k] = 'stone'
  const w = town(c)
  const item = { x: 9.5, y: 63.1, z: 0.5 }
  assert.equal(F.sealRefusal(w.read, { x: 8, y: 62, z: 0 }, { home: HOME, entities: [item] }), 'entity')
  assert.equal(F.sealRefusal(w.read, { x: 8, y: 62, z: 0 }, { home: HOME }), null, 'positive control: empty, a 2-cell dead end may close')
  const p = F.planFloor({ read: w.read, home: HOME, entities: [item], maxSteps: 50 })
  assert.ok(!p.steps.some(s => s.c.join(',') === '8,62,0'), 'never closed on the item')
  replay(w, p, { entities: [item] })
})

await t('A CHAMBER ROOFED ABOVE ANY SCAN LIMIT is not sky (Codex r3 P1 repro): an 11-high shaft roofed at L+11 with an item at its foot is never closed; its roof at L+10 also refuses (positive control)', () => {
  for (const roof of [73, 72]) {
    const c = {}
    c['7,62,0'] = 'air'; c['8,62,0'] = 'air'; c['8,63,0'] = 'stone'
    for (let y = 62; y < roof; y++) { c[`9,${y},0`] = 'air'; if (y > 62) for (const k of [`10,${y},0`, `9,${y},1`, `9,${y},-1`, `8,${y},0`]) c[k] = 'stone' }
    c[`9,${roof},0`] = 'stone'
    const w = town(c)
    const item = { x: 9.5, y: 62.1, z: 0.5 }
    assert.equal(F.sealRefusal(w.read, { x: 8, y: 62, z: 0 }, { home: HOME, entities: [item] }), 'entity', `roof at ${roof}`)
    const p = F.planFloor({ read: w.read, home: HOME, entities: [item], maxSteps: 50 })
    assert.ok(!p.steps.some(s => s.c.join(',') === '8,62,0'), `never closed (roof ${roof})`)
    replay(w, p, { entities: [item] })
  }
})

await t('A SLAB IS NO FOUNDATION and no builder floor (Codex r2 P2): a hole over a slab is not filled; a stand on a slab is not used', () => {
  const OPENB = blk('air')
  const slab = { name: 'stone_slab', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1]], hardness: 2, props: null }
  const base = town(carve({}, 8, 8, 62, 62, 8, 8))
  const read = (x, y, z) => (x === 8 && y === 61 && z === 8 ? slab : base.read(x, y, z))
  assert.deepEqual(F.floorSupports(read, { x: 8, y: 62, z: 8 }), [])
  assert.ok(!F.planFloor({ read, home: HOME }).steps.some(s => s.c.join(',') === '8,62,8'))
  assert.equal(F.builderStand(read, 8, 62, 8), false, 'on a slab: no builder stand')
  assert.equal(F.standable(read, 8, 62, 8), true, '...but still a walk node (lostWay protects routes over slabs)')
  // standFor never offers a stand on a slab, even when it is the only reachable one (positive control: on stone it does)
  const target = { x: 9, y: 62, z: 8 }, point = { x: 9.5, y: 62, z: 8.5 }
  const slabRead = (x, y, z) => (x === 8 && y === 61 && z === 8 ? slab : x === 9 && y === 62 && z === 8 ? blk('air') : base.read(x, y, z))
  const only = new Set([F.cellKey(8, 62, 8)])
  assert.equal(F.standFor(slabRead, { target, point, topFace: true, reach: only }), null)
  const stoneRead = (x, y, z) => (x === 9 && y === 62 && z === 8 ? blk('air') : base.read(x, y, z))
  assert.deepEqual(F.standFor(stoneRead, { target, point, topFace: true, reach: only }), { x: 8, y: 62, z: 8 })
  void OPENB
})

await t('COLD CELLS NEVER STARVE THE REST (Codex r4 P2 repro): an unreachable platform cell refused on every visit does not keep a reachable hole beyond the platform waiting, visit after visit', () => {
  const c = {}
  c['0,61,0'] = 'air'; c['0,60,0'] = 'stone'                                  // a sealed cell under the platform (no stand reaches it)
  c['8,62,0'] = 'air'                                                          // a plain hole beyond the platform
  const w = town(c)
  let cold = {}, placed = null
  for (let visit = 0; visit < 3 && !placed; visit++) {
    const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1, maxTries: 1, cold: F.coldKeys({ cold }, 1000) })
    if (p.steps.length) placed = p.steps[0].c.join(',')
    cold = F.coldAfter(cold, p.refusedKeys, [], 1000)
  }
  assert.equal(placed, '8,62,0', 'the reachable hole is filled within three one-try visits')
})

await t('THE PLATFORM FIRST among untried cells: a hole in the platform goes before an equally high, farther hole outside it', () => {
  const c = {}
  c['3,62,3'] = 'air'                                                          // a platform hole (tier 0)
  c['12,62,0'] = 'air'                                                         // a hole outside the platform (tier 1), farther
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1 })
  assert.equal(p.steps[0].c.join(','), '3,62,3')
  assert.equal(F.planFloor({ read: w.read, home: HOME, maxSteps: 2 }).steps.length, 2, 'positive control: both are fillable')
})

await t('A BODY OR AN ITEM NEVER MAKES A CELL COLD: refused for an item in it, the cell is not in refusedKeys (a transient refusal)', () => {
  const c = {}
  c['3,62,3'] = 'air'
  c['0,61,0'] = 'air'; c['0,60,0'] = 'stone'                                  // sealed under the platform: no stand reaches it
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, entities: [{ x: 3.5, y: 62.1, z: 3.5 }], maxSteps: 5 })
  assert.ok(!p.refusedKeys.includes(F.cellKey(3, 62, 3)), 'the item\'s cell is not cold')
  assert.ok(p.tally.occupied >= 1, 'positive control: it was refused for the item')
})

await t('a skipped (stuck) cell is never planned; maxSteps bounds the plan and says budget', () => {
  const w = town(carve({}, 8, 10, 62, 62, 8, 10))
  const p = F.planFloor({ read: w.read, home: HOME, skip: new Set([F.cellKey(9, 62, 9)]), maxSteps: 3 })
  assert.equal(p.steps.length, 3); assert.equal(p.why, 'budget')
  assert.ok(!p.steps.some(s => s.c.join(',') === '9,62,9'))
  const all = F.planFloor({ read: w.read, home: HOME, skip: new Set([F.cellKey(9, 62, 9)]), maxSteps: 100 })
  assert.equal(all.steps.length, 8, 'the other eight of the 3x3')
})

await t('A FLAT TOWN has nothing to fill (positive control for the stop reason): none_reachable, no step', () => {
  const p = F.planFloor({ read: town().read, home: HOME })
  assert.equal(p.steps.length, 0); assert.equal(p.why, 'none_reachable')
})

// ---- the click's re-proof ------------------------------------------------------------------------------------------------

await t('stepRefusal re-judges a recorded step against the world NOW: filled by another hand, a chest put beside it, a body in it, the stand gone, the floor gone', () => {
  const c = carve({}, 8, 10, 62, 62, 8, 10)
  const w = town(c)
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1 })
  const s = p.steps[0], [x, y, z] = s.c
  const ctx = { home: HOME, start: p.start }
  assert.equal(F.stepRefusal(w.read, s, ctx), null, 'positive control: the step is good now')
  const w1 = town({ ...c, [`${x},${y},${z}`]: 'cobblestone' }); assert.equal(F.stepRefusal(w1.read, s, ctx), 'filled')
  const w2 = town({ ...c, [`${x + 1},${y + 1},${z}`]: 'chest' }); assert.equal(F.stepRefusal(w2.read, s, ctx), 'furniture')
  assert.equal(F.stepRefusal(w.read, s, { ...ctx, entities: [{ x: x + 0.5, y, z: z + 0.5 }] }), 'occupied')
  const w3 = town({ ...c, [`${s.s[0]},${s.s[1] + 1},${s.s[2]}`]: 'stone' }); assert.equal(F.stepRefusal(w3.read, s, ctx), 'stand')
  const w4 = town({ ...c, [`${x},${y - 1},${z}`]: 'air' }); assert.equal(F.stepRefusal(w4.read, s, ctx), 'no_floor')
})

// ---- the walk probe -----------------------------------------------------------------------------------------------------

await t('A STAND THAT CANNOT WALK HOME ALREADY is refused at the click (walled_in): lostWay alone would not see it, since it was never on a way home', () => {
  const c = carve({}, 8, 10, 60, 62, 8, 10)                                    // a 3-deep pit, no stair: its floor is a dead end
  const w = town(c)
  const st = F.startNear(w.read, HOME)
  assert.ok(!F.walkBack(w.read, st, { box: F.walkBox(HOME) }).has(F.cellKey(9, 60, 9)), 'positive control: the pit floor does not walk home')
  const step = { c: [10, 60, 9], r: [10, 59, 9], f: [0, 1, 0], s: [9, 60, 9], tier: 1 }
  assert.equal(F.stepRefusal(w.read, step, { home: HOME, start: st }), 'walled_in')
})

await t('walkBack(r, t).has(c) iff walkDist(r, c).has(t), on 30 random rough towns (the reverse search is exact)', () => {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let n = 0; n < 30; n++) {
    const c = {}
    for (let i = 0; i < 60; i++) { const x = Math.floor(rnd() * 13) - 6, z = Math.floor(rnd() * 13) - 6, y = 58 + Math.floor(rnd() * 5); c[`${x},${y},${z}`] = 'air'; if (rnd() < 0.4) c[`${x},${y + 1},${z}`] = 'air' }
    for (let i = 0; i < 10; i++) { const x = Math.floor(rnd() * 13) - 6, z = Math.floor(rnd() * 13) - 6; c[`${x},63,${z}`] = 'stone' }
    const w = town(c)
    const box = { x0: -7, x1: 7, z0: -7, z1: 7, y0: 55, y1: 66 }
    const target = F.startNear(w.read, HOME)
    if (!target) continue
    const back = F.walkBack(w.read, target, { box })
    for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) for (let y = 56; y <= 65; y++) {
      if (!F.standable(w.read, x, y, z)) continue
      assert.equal(back.has(F.cellKey(x, y, z)), F.walkDist(w.read, { x, y, z }, { box }).has(F.cellKey(target.x, target.y, target.z)), `town ${n} cell ${x},${y},${z}`)
    }
  }
})

await t('accessIndex equals the brute-force nearest reach cell within ACCESS_R, ACCESS_BELOW below to ACCESS_ABOVE above', () => {
  let seed = 3
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const dist = new Map()
  for (let i = 0; i < 300; i++) dist.set(F.cellKey(Math.floor(rnd() * 41) - 20, 52 + Math.floor(rnd() * 15), Math.floor(rnd() * 41) - 20), Math.floor(rnd() * 90))
  const acc = F.accessIndex(dist, HOME)
  const cells = [...dist].map(([k, d]) => ({ ...F.keyCell(k), d }))
  for (let i = 0; i < 400; i++) {
    const tg = { x: Math.floor(rnd() * 33) - 16, y: 52 + Math.floor(rnd() * 11), z: Math.floor(rnd() * 33) - 16 }
    let best = Infinity
    for (const c of cells) if (Math.abs(c.x - tg.x) <= F.ACCESS_R && Math.abs(c.z - tg.z) <= F.ACCESS_R && c.y >= tg.y - F.ACCESS_BELOW && c.y <= tg.y + F.ACCESS_ABOVE && c.d < best) best = c.d
    assert.equal(acc(tg), best, JSON.stringify(tg))
  }
})

// ---- funding --------------------------------------------------------------------------------------------------------------

await t('FUNDING: decorations first; cobble only above the 64 reserve; the reserve is never spent', () => {
  const bag = (...p) => p.map(([name, count]) => ({ name, count }))
  assert.equal(COBBLE_RESERVE, 64)
  assert.equal(F.floorBudget(bag(['cobblestone', 70])), 6)
  assert.equal(F.floorBudget(bag(['cobblestone', 40], ['cobbled_deepslate', 30], ['andesite', 5])), 11)
  assert.equal(F.floorBudget(bag(['cobblestone', 64], ['dirt', 64])), 0)
  assert.equal(F.floorBlockFor(bag(['cobblestone', 64])), null, 'exactly the reserve: nothing')
  assert.equal(F.floorBlockFor(bag(['cobblestone', 65])), 'cobblestone')
  assert.equal(F.floorBlockFor(bag(['cobblestone', 200], ['granite', 1])), 'granite', 'the well\'s junk goes first')
  assert.equal(F.floorBlockFor(bag(['cobblestone', 30], ['diorite', 2])), 'diorite', 'decorations do not need the reserve')
  // spending the whole budget one block at a time never takes the cobble below the reserve
  let b = bag(['cobblestone', 64], ['cobblestone', 30], ['cobbled_deepslate', 10], ['andesite', 3])
  const n = F.floorBudget(b)
  for (let i = 0; i < n; i++) { const name = F.floorBlockFor(b); assert.ok(name); const it = b.find(x => x.name === name && x.count > 0); it.count-- ; b = b.filter(x => x.count > 0) }
  assert.equal(F.floorBlockFor(b), null)
  assert.equal(b.filter(x => x.name === 'cobblestone' || x.name === 'cobbled_deepslate').reduce((s, x) => s + x.count, 0), 64)
})

// ---- the lease, the record and the order --------------------------------------------------------------------------------

await t('leaseState: expired or future-stamped is free; the holder\'s token is mine; anyone else waits', () => {
  assert.deepEqual(F.leaseState(null, 1000), { free: true, mine: false, holder: null, leftMs: 0 })
  assert.equal(F.leaseState({ by: 'a', token: 'x', at: 0, until: 999 }, 1000).free, true)
  assert.equal(F.leaseState({ by: 'a', token: 'x', at: 500_000, until: 900_000 }, 1000).free, true, 'stamped in the future')
  assert.deepEqual(F.leaseState({ by: 'a', token: 'x', at: 0, until: 5000 }, 1000, 'x'), { free: true, mine: true, holder: 'a', leftMs: 4000 })
  assert.deepEqual(F.leaseState({ by: 'a', token: 'x', at: 0, until: 5000 }, 1000, 'y'), { free: false, mine: false, holder: 'a', leftMs: 4000 })
})

await t('the record is this world\'s and this version\'s; stuck cells: two drops hold a day, a success forgets', () => {
  assert.equal(F.floorRecordFor({ v: F.FLOOR_VERSION, world: 'w1' }, 'w2'), null)
  assert.equal(F.floorRecordFor({ v: 0, world: 'w1' }, 'w1'), null)
  assert.ok(F.floorRecordFor({ v: F.FLOOR_VERSION, world: 'w1' }, 'w1'))
  let s = F.stuckAfter({}, '7', false, 1000)
  assert.equal(F.stuckSkips({ stuck: s }, 1000).size, 0, 'one drop: tried again')
  s = F.stuckAfter(s, '7', false, 2000)
  assert.ok(F.stuckSkips({ stuck: s }, 2000).has(7))
  assert.equal(F.stuckSkips({ stuck: s }, 2000 + F.STUCK_HOLD_MS).size, 0, 'a day later: tried again')
  assert.deepEqual(F.stuckAfter(s, '7', true, 3000), {}, 'a success forgets it')
  assert.equal(F.floorHeld({ noneAt: 1000 }, 1000 + F.FLOOR_NONE_BACKOFF_MS - 1), true)
  assert.equal(F.floorHeld({ noneAt: 1000 }, 1000 + F.FLOOR_NONE_BACKOFF_MS), false)
  assert.equal(F.floorHeld({ noneAt: null }, 1000), false)
})

await t('floorOrder: at town, funded, nobody else building, not held -> fill_town; each missing condition refuses; nothing is read away from town', () => {
  const base = { now: 1e9, distHome: 5, budget: 40, lease: { free: true }, held: false }
  const r = F.floorOrder(base)
  assert.equal(r.order?.skill, 'fill_town'); assert.equal(r.state.lastAt, 1e9)
  assert.equal(F.floorOrder({ ...base, distHome: F.TOWN_RADIUS + 1 }).order, null)
  assert.equal(F.floorOrder({ ...base, zone: false }).order, null, 'no town-ground zone in the build: never')
  assert.equal(F.floorOrder({ ...base, dy: -(F.FLOOR_DEPTH + 7) }).order, null, 'deep under the town is not at town')
  assert.equal(F.zoneLive({ townTargetPermit () {} }), true); assert.equal(F.zoneLive({}), false)
  assert.equal(F.floorOrder({ ...base, budget: F.FLOOR_MIN_FUND - 1 }).order, null)
  assert.equal(F.floorOrder({ ...base, lease: { free: false, holder: 'x' } }).order, null)
  assert.equal(F.floorOrder({ ...base, held: true }).order, null)
  assert.equal(F.floorOrder({ ...base, inside: true }).order, null)
  assert.equal(F.floorOrder({ ...base, state: { lastAt: 1e9 - F.FLOOR_COOLDOWN_MS + 1 } }).order, null, 'cooldown')
  assert.equal(F.floorOrder({ ...base, state: { backoffUntil: 1e9 + 1 } }).order, null, 'backoff')
  let read = 0
  const lazy = () => { read++; return { free: true } }
  F.floorOrder({ ...base, distHome: 100, lease: lazy, held: () => { read++; return false }, budget: () => { read++; return 40 } })
  assert.equal(read, 0, 'away from town nothing is read')
  F.floorOrder({ ...base, budget: () => 2, lease: lazy, held: () => { read++; return false } })
  assert.equal(read, 0, 'an unfunded bag reads no record')
})

await t('floorOrderOutcome: success clears; nothing to do holds an hour; a fault backs off; a lost lease waits a cooldown; an abort costs nothing', () => {
  assert.equal(F.floorOrderOutcome('success', 1, { backoffUntil: 99 }).backoffUntil, 0)
  assert.equal(F.floorOrderOutcome('no_effect', 1, {}, 'floor_none').backoffUntil, 1 + F.FLOOR_NONE_BACKOFF_MS)
  assert.equal(F.floorOrderOutcome('failed', 1, {}, 'floor_stuck').backoffUntil, 1 + F.FLOOR_BACKOFF_MS)
  assert.equal(F.floorOrderOutcome('failed', 1, {}, 'floor_lease').backoffUntil, 1 + F.FLOOR_COOLDOWN_MS)
  assert.deepEqual(F.floorOrderOutcome('aborted', 1, { lastAt: 5 }), { lastAt: 5 })
})

await t('floorDetail: stage first, key=value, at most 300 characters', () => {
  const d = F.floorDetail({ stage: 'visit', placed: 3, planned: 4, budget: 20, left: 100, why: 'x '.repeat(400), tally: 'a:1' })
  assert.match(d, /^stage=visit placed=3 planned=4 refused=0 dropped=0 spent=0 tier0=0 budget=20 left=100 /)
  assert.ok(d.length <= 300)
})

await t('WIRING (a structural invariant, comments stripped): in the decision loop the floor order comes after the town deposit, the recount, the composter\'s orders, the junk well\'s, chest pruning and the room order, and before planting', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const at = name => { const n = src.split(name).length - 1; assert.equal(n, 1, `${name} once (found ${n})`); return src.indexOf(name) }
  const floor = at('floorOrder({')
  for (const before of ['this.#townDepositOrder(milestone)', 'this.#recountOrder()', 'townOrder({', 'wellOrder({', 'pruneOrder({', 'roomOrder({']) assert.ok(at(before) < floor, `${before} before the floor`)
  assert.ok(floor < at('plantingOrder({'), 'the floor before planting')
  assert.match(src.slice(floor - 400, floor), /if \(!order\) \{/, 'the floor runs only when nothing above gave an order')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
