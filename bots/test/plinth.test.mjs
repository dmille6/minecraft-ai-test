// plinth-01 (10-13): the raised junk well -- a town whose ground no longer seals a well builds the seal.
//
// Measured 10-13 (townground-2026-10-13.md section 3): the bots dug out the ground within ~15 of every home; the well's
// walls or ring failed on 80-100% of candidate cells in all 16 towns and 13 of 16 could not site a well. The planner
// keeps the verified geometry exactly (the oracle is well.mjs wellSiteRefusal / containmentRefusal on the world with the
// plan applied) and supplies the missing shell with placed blocks.
//
// Behaviour only, through the exported pure functions. The fixture that matters is DUG-OUT ground: a one-block slab
// floating over air, where the well search finds nothing (positive control: on solid ground it finds a site). Mutants
// assert their anchor is present and unique (withMutant, as climb-escape.test.mjs).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const P = await import('../src/plinth.mjs')
const W = await import('../src/well.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const PBlock = require('prismarine-block')('1.21.11')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const PP = new URL('../src/plinth.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// the real registry's collision shapes (well.mjs fullCube reads them)
const shapesOf = name => { const d = REG.blocksByName[name]; return PBlock.fromStateId(d.defaultState ?? d.minStateId, 0).shapes }
const BC = {}
const B = name => (BC[name] ??= { name, boundingBox: REG.blocksByName[name].boundingBox, hardness: REG.blocksByName[name].hardness, shapes: shapesOf(name), props: null })
const AIR = B('air')
const K = (x, y, z) => `${x},${y},${z}`
const HOME = { x: 0, y: 64, z: 0 }
const SLAB_Y = 63
/** THE DUG-OUT TOWN: a one-thick grass slab at SLAB_Y over air (the "lattice of floating grass" of the region reads), a
 *  stone floor 10 below so nothing is unloaded, and `extra` cells on top. Everything within 40 is loaded. */
const slabWorld = (extra = {}) => (x, y, z) => {
  if (Math.abs(x) > 40 || Math.abs(z) > 40 || y < 40 || y > 100) return null
  const k = K(x, y, z)
  if (Object.prototype.hasOwnProperty.call(extra, k)) return extra[k]
  return y === SLAB_Y ? B('grass_block') : y === SLAB_Y - 10 ? B('stone') : AIR
}
/** SOLID GROUND (the positive control): dirt from SLAB_Y down. */
const solidWorld = (extra = {}) => (x, y, z) => {
  if (Math.abs(x) > 40 || Math.abs(z) > 40 || y < 40 || y > 100) return null
  const k = K(x, y, z)
  if (Object.prototype.hasOwnProperty.call(extra, k)) return extra[k]
  return y > SLAB_Y ? AIR : y === SLAB_Y ? B('grass_block') : B('dirt')
}
/** Apply a plan's steps to a world -> read() of the finished world. */
const applied = (read, plan, upTo = plan.steps.length) => {
  const cells = new Map()
  for (const s of plan.steps.slice(0, upTo)) cells.set(P.cellKey(...s.c), s.op === 'place' ? P.PLACED : P.AIR)
  return P.overlay(read, cells)
}
const boxOf = plan => ({ x0: Math.min(HOME.x, plan.cap.x) - 6, x1: Math.max(HOME.x, plan.cap.x) + 6, z0: Math.min(HOME.z, plan.cap.z) - 6, z1: Math.max(HOME.z, plan.cap.z) + 6, y0: Math.min(HOME.y, plan.cap.y) - 10, y1: Math.max(HOME.y, plan.cap.y) + 8 })

// =====================================================================================================================
// THE GEOMETRY AND THE ORACLE
// =====================================================================================================================
await t('plinthShell: 81 cells for a cap -- the 8 walls at g, 24 at g-1, the 25 of g-2 (floor included), 24 at g-3; roles wall/ring/floor', () => {
  const sh = P.plinthShell({ x: 10, y: 70, z: 10 })
  assert.equal(sh.length, 81)
  assert.equal(new Set(sh.map(c => K(c.x, c.y, c.z))).size, 81, 'no duplicates')
  const by = y => sh.filter(c => c.y === y).length
  assert.deepEqual([by(70), by(69), by(68), by(67)], [8, 24, 25, 24])
  assert.equal(sh.filter(c => c.role === 'floor').length, 1)
  assert.deepEqual(sh.find(c => c.role === 'floor'), { x: 10, y: 68, z: 10, role: 'floor' })
  assert.equal(sh.filter(c => c.role === 'wall').length, 16, 'the 8 neighbours at g and at g-1')
  assert.ok(!sh.some(c => c.x === 10 && c.z === 10 && (c.y === 70 || c.y === 69)), 'the cap and the shaft are never in the shell')
})

await t('THE ORACLE IS UNCHANGED: the shell placed on a dug-out slab passes wellSiteRefusal; remove any ONE shell cell and it refuses (81 of 81)', () => {
  const cap = { x: 12, y: SLAB_Y + 3, z: 0 }
  const cells = new Map(P.plinthShell(cap).filter(c => c.y > SLAB_Y).map(c => [P.cellKey(c.x, c.y, c.z), P.PLACED]))
  const read = P.overlay(slabWorld(), cells)
  assert.equal(W.wellSiteRefusal(read, cap, HOME), null, 'positive control: the full raise passes')
  let refused = 0, contained = 0
  for (const c of P.plinthShell(cap)) {
    const cs = new Map(cells); cs.set(P.cellKey(c.x, c.y, c.z), AIR)
    if (W.wellSiteRefusal(P.overlay(slabWorld(), cs), cap, HOME)) refused++
    if (W.containmentRefusal(P.overlay(slabWorld(), cs), cap)) contained++
  }
  assert.equal(refused, 81, 'every shell cell is load-bearing for the site oracle (the g-3 ring included)')
  assert.equal(contained, 80, 'the per-throw check reads all but the floor (the floor is the site check\'s, and the floor trapdoor sits on it)')
})

await t('positive control for the trigger: the well search finds NO site on the dug-out slab (exhausted), and finds one on solid ground', () => {
  const none = W.canonicalWellSite({ home: HOME, read: slabWorld() })
  assert.equal(none.site, null); assert.equal(none.exhausted, true)
  const some = W.canonicalWellSite({ home: HOME, read: solidWorld() })
  assert.ok(some.site, 'solid ground has a natural site')
})

// =====================================================================================================================
// THE PLANNER
// =====================================================================================================================
const SLAB_PLAN = P.planPlinth({ read: slabWorld(), home: HOME })
await t('planPlinth on the dug-out slab: a raised plan (k = 3 over the slab) whose applied world passes the oracle, with a walkable throwing stand', () => {
  const plan = SLAB_PLAN.plan
  assert.ok(plan, `no plan: ${SLAB_PLAN.why}`)
  assert.equal(plan.k, 3, 'g-3 sits on the slab: the cheapest raise')
  assert.equal(plan.cap.y, SLAB_Y + 3)
  assert.ok(Math.hypot(plan.cap.x - HOME.x, plan.cap.z - HOME.z) >= W.WELL_HOME_CLEARANCE)
  const fin = applied(slabWorld(), plan)
  assert.equal(W.wellSiteRefusal(fin, plan.cap, HOME), null)
  assert.equal(W.wellStage(fin, plan.cap), 'dug', 'the cap and shaft are left open: build_well floors and caps it')
  const st = W.wellStand(fin, plan.cap)
  assert.ok(st)
  assert.equal(st.facing, plan.facing)
  const reach = P.walkReach(fin, plan.start, { box: boxOf(plan), forbid: (x, y, z) => P.inColumn(plan.cap, x, y, z) })
  assert.ok(reach.has(P.cellKey(st.stand.x, st.stand.y, st.stand.z)), 'the throwing stand is walkable from the town')
  assert.equal(plan.cost, 57 + plan.stair.length, '25 + 24 + 8 shell blocks above the slab, plus the stair')
  assert.ok(plan.stair.length >= 1, 'a rise of 2 from the slab to the ledge needs a step')
})

await t('every step of the plan: support BELOW or BESIDE (never a bottom face), the target replaceable, the stand reachable at that step and still connected after it, eye within reach', () => {
  const plan = SLAB_PLAN.plan
  const cells = new Map(), w = P.overlay(slabWorld(), cells)
  const forbid = (x, y, z) => P.inColumn(plan.cap, x, y, z)
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]
    const reach = P.walkReach(w, plan.start, { box: boxOf(plan), forbid })
    assert.ok(reach.has(P.cellKey(...s.s)), `step ${i}: stand reachable`)
    assert.ok(!P.inColumn(plan.cap, ...s.s), `step ${i}: never in the well column`)
    assert.equal(s.op, 'place')
    assert.notEqual(s.f[1], -1, `step ${i}: a bottom face`)
    assert.equal(w(...s.r).boundingBox, 'block', `step ${i}: support solid`)
    assert.ok(P.PLINTH_REPLACEABLE.has(w(...s.c).name), `step ${i}: target replaceable`)
    const pt = P.faceCentre({ x: s.r[0], y: s.r[1], z: s.r[2] }, s.f)
    assert.ok(Math.hypot(s.s[0] + 0.5 - pt.x, s.s[1] + P.EYE_HEIGHT - pt.y, s.s[2] + 0.5 - pt.z) <= P.PLINTH_REACH + 1e-9, `step ${i}: reach`)
    cells.set(P.cellKey(...s.c), P.PLACED)
    assert.ok(P.walkReach(w, plan.start, { box: boxOf(plan), forbid }).has(P.cellKey(...s.s)), `step ${i}: the stand still reaches town`)
  }
})

await t('the hazard step is where the column first walls in (plinthHazard), and every later state is coverable (coverRef finds a wall)', () => {
  const plan = SLAB_PLAN.plan
  let first = null
  for (let i = 1; i <= plan.steps.length; i++) {
    const hz = P.plinthHazard(applied(slabWorld(), plan, i), plan.cap)
    if (hz && first === null) first = i - 1
    if (first !== null) { assert.equal(hz, true, `state ${i} after the hazard`); assert.ok(W.coverRef(applied(slabWorld(), plan, i), plan.cap, null), `state ${i}: coverable`) }
  }
  assert.equal(first, plan.hazardStep)
  assert.ok(plan.hazardStep >= plan.steps.length - 6, 'the pit closes in only near the end (the top ring)')
})

await t('positive control for the planner: on SOLID ground the cheapest plan is the natural site (k = 0, nothing placed)', () => {
  const r = P.planPlinth({ read: solidWorld(), home: HOME })
  assert.ok(r.plan)
  assert.equal(r.plan.k, 0); assert.equal(r.plan.cost, 0); assert.equal(r.plan.hazardStep, null)
  assert.equal(W.wellStage(solidWorld(), r.plan.cap), 'fresh', 'build_well digs it as at any site')
})

await t('plinthCandidate refusals: a chest, a fence, a sapling, sand or a pane in a shell cell is "solid" (a log is ground, as the oracle says); leaves are cleared only when allowed; town furniture beside a planned cell; a keep-out; unknown never on a guess', () => {
  const cap = { x: 12, y: SLAB_Y + 3, z: 0 }
  const base = { home: HOME, x: cap.x, z: cap.z, t: SLAB_Y, k: 3 }
  assert.ok(P.plinthCandidate(slabWorld(), base).cap, 'positive control')
  for (const n of ['chest', 'oak_fence', 'oak_sapling', 'sand', 'torch', 'poppy', 'glass_pane']) {
    assert.equal(P.plinthCandidate(slabWorld({ [K(13, SLAB_Y + 2, 1)]: B(n) }), base).why, 'solid', n)
  }
  const leafy = slabWorld({ [K(13, SLAB_Y + 2, 1)]: B('oak_leaves') })
  assert.equal(P.plinthCandidate(leafy, { ...base, clearLeaves: false }).why, 'solid')
  const c = P.plinthCandidate(leafy, base)
  assert.ok(c.cap); assert.equal(c.leaves.length, 1); assert.ok(c.fills.some(f => f.x === 13 && f.y === SLAB_Y + 2 && f.z === 1), 'cleared, then filled')
  const log = P.plinthCandidate(slabWorld({ [K(13, SLAB_Y + 1, 1)]: B('oak_log') }), base)
  assert.ok(log.cap && !log.fills.some(f => f.x === 13 && f.y === SLAB_Y + 1 && f.z === 1), 'a log is kept: ground to the oracle (and the shell box is never a gather dig)')
  assert.equal(P.plinthCandidate(slabWorld({ [K(15, SLAB_Y + 1, 0)]: B('crafting_table') }), base).why, 'furniture')
  assert.equal(P.plinthCandidate(slabWorld({ [K(14, SLAB_Y + 1, 3)]: B('oak_door') }), base).why, 'furniture')
  assert.equal(P.plinthCandidate(slabWorld(), { ...base, keepOut: [{ x: 15, y: SLAB_Y + 1, z: 0, r: 1 }] }).why, 'keepout')
  assert.equal(P.plinthCandidate(slabWorld({ [K(13, SLAB_Y + 2, 1)]: null }), base).why, 'unknown')
  assert.match(P.plinthCandidate(slabWorld({ [K(12, SLAB_Y + 5, 3)]: B('water') }), base).why, /^oracle:water within 3/)
  assert.equal(P.plinthCandidate(slabWorld(), { ...base, x: 3, z: 0 }).why, 'home', 'never within WELL_HOME_CLEARANCE of home')
})

const treeWorld = (h) => { const ex = {}; for (let x = 10; x <= 14; x++) for (let z = -2; z <= 2; z++) for (let y = SLAB_Y + 1; y <= SLAB_Y + h; y++) ex[K(x, y, z)] = B('oak_leaves'); return slabWorld(ex) }
await t('a BUSH on the site (leaves 3 high): the shell leaves are cleared then filled, the leaves over it cleared, and the sequenced plan passes the oracle with no leaf left in a shell or open cell', () => {
  const read = treeWorld(3)
  assert.equal(P.columnSurface(read, 12, 0, HOME.y), SLAB_Y + 3, 'the canopy top, as the well search sees it')
  assert.equal(P.columnSurface(read, 12, 0, HOME.y, { throughLeaves: true }), SLAB_Y, 'the ground under it')
  const c = P.plinthCandidate(read, { home: HOME, x: 12, z: 0, t: SLAB_Y, k: 3 })
  assert.ok(c.cap, c.why)
  assert.ok(c.leaves.length >= 57, 'every shell leaf')
  assert.equal(P.plinthCandidate(read, { home: HOME, x: 12, z: 0, t: SLAB_Y, k: 3, clearLeaves: false }).why, 'solid')
  const s = P.sequencePlinth(read, c, { home: HOME })
  assert.ok(s.plan, s.why)
  const fin = applied(read, s.plan)
  assert.equal(W.wellSiteRefusal(fin, s.plan.cap, HOME), null)
  for (const q of [...P.plinthShell(s.plan.cap), ...P.plinthAbove(s.plan.cap), ...P.plinthColumn(s.plan.cap)]) assert.ok(!/_leaves$/.test(fin(q.x, q.y, q.z).name), `leaves left at ${K(q.x, q.y, q.z)}`)
  s.plan.steps.forEach((st, i) => {
    if (st.op !== 'clear') return
    assert.ok(!s.plan.steps.slice(0, i).some(o => o.op === 'place' && o.c.join() === st.c.join()), 'a clear never comes after its own fill')
  })
})
await t('a TREE on the site (leaves 6 high): cleared from the top down first, every click from a stand that walks back out after it (Codex r2 P1-1), and the plan passes the oracle', () => {
  const read = treeWorld(6)
  const c = P.plinthCandidate(read, { home: HOME, x: 12, z: 0, t: SLAB_Y, k: 3 })
  assert.ok(c.cap, c.why)
  const s = P.sequencePlinth(read, c, { home: HOME })
  assert.ok(s.plan, s.why)
  assert.equal(W.wellSiteRefusal(applied(read, s.plan), s.plan.cap, HOME), null)
  // every clear's stand walks back to the town after the clear (the planner's own proof, checked again here)
  const cells = new Map(), w = P.overlay(read, cells), box = boxOf(s.plan), forbid = (x, y, z) => P.inColumn(s.plan.cap, x, y, z)
  for (const st of s.plan.steps) {
    cells.set(P.cellKey(...st.c), st.op === 'place' ? P.PLACED : P.AIR)
    assert.ok(P.walksBack(w, { x: st.s[0], y: st.s[1], z: st.s[2] }, s.plan.start, { box, forbid }), `${st.op} ${st.c}: its stand walks back`)
  }
})
await t('every plan places bottom-up in each column: no block above a cell still to be placed (slab, bush, tree)', () => {
  for (const [name, read] of [['slab', slabWorld()], ['bush', treeWorld(3)], ['tree', treeWorld(6)]]) {
    const c = name === 'slab' ? null : P.plinthCandidate(read, { home: HOME, x: 12, z: 0, t: SLAB_Y, k: 3 })
    const plan = name === 'slab' ? SLAB_PLAN.plan : P.sequencePlinth(read, c, { home: HOME }).plan
    const placed = new Set()
    for (const st of plan.steps.filter(x => x.op === 'place')) {
      const later = plan.steps.filter(x => x.op === 'place' && !placed.has(x.c.join()) && x.c[0] === st.c[0] && x.c[2] === st.c[2] && x.c[1] < st.c[1])
      assert.equal(later.length, 0, `${name}: ${st.c} placed over ${later.map(x => x.c).join(' ')}`)
      placed.add(st.c.join())
    }
  }
})

await t('no plan at all: every column refused -> plan null with the tally (the no-plan record\'s)', () => {
  const water = (x, y, z) => (Math.abs(x) > 40 || Math.abs(z) > 40 || y < 40 || y > 100 ? null : y <= SLAB_Y ? B('water') : AIR)
  const r = P.planPlinth({ read: water, home: HOME })
  assert.equal(r.plan, null)
  assert.ok(r.tally.cols > 0)
  assert.ok(r.why)
})

await t('an unloaded cell anywhere in the search is "unknown": never a no-plan verdict on a guess', () => {
  const r = P.planPlinth({ read: slabWorld({ [K(14, SLAB_Y, 0)]: null }), home: HOME })
  assert.equal(r.plan, null); assert.equal(r.why, 'unknown')
})

// =====================================================================================================================
// WALKING, STANDING, SEEING
// =====================================================================================================================
await t('walkReach: walk, step up with head room, drop 1..3 (not 4), never a forbidden cell, never through liquid', () => {
  const ex = { [K(1, SLAB_Y + 1, 0)]: B('stone'), [K(-1, SLAB_Y + 1, 0)]: B('stone'), [K(-1, SLAB_Y + 2, 0)]: B('stone') }
  const r = P.walkReach(slabWorld(ex), { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: -5, x1: 5, y0: 50, y1: 80, z0: -5, z1: 5 } })
  assert.ok(r.has(P.cellKey(1, SLAB_Y + 2, 0)), 'a one-block step up')
  assert.ok(!r.has(P.cellKey(-1, SLAB_Y + 3, 0)), 'never two up')
  const roof = P.walkReach(slabWorld({ ...ex, [K(0, SLAB_Y + 3, 0)]: B('stone') }), { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: -5, x1: 5, y0: 50, y1: 80, z0: 0, z1: 0 } })
  assert.ok(!roof.has(P.cellKey(1, SLAB_Y + 2, 0)), 'no jump without head room above the origin')
  // a ledge 3 and 4 high
  const ledge = (h) => (x, y, z) => (x >= 0 ? (y <= SLAB_Y + h ? B('stone') : AIR) : (y <= SLAB_Y ? B('stone') : AIR))
  assert.ok(P.walkReach(ledge(3), { x: 1, y: SLAB_Y + 4, z: 0 }, { box: { x0: -3, x1: 3, y0: 50, y1: 80, z0: -1, z1: 1 } }).has(P.cellKey(-1, SLAB_Y + 1, 0)), 'drop 3')
  assert.ok(!P.walkReach(ledge(4), { x: 1, y: SLAB_Y + 5, z: 0 }, { box: { x0: -3, x1: 3, y0: 50, y1: 80, z0: -1, z1: 1 } }).has(P.cellKey(-1, SLAB_Y + 1, 0)), 'never drop 4')
  const f = P.walkReach(slabWorld(), { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: -3, x1: 3, y0: 50, y1: 80, z0: -3, z1: 3 }, forbid: (x, y, z) => x === 1 })
  assert.ok(!f.has(P.cellKey(1, SLAB_Y + 1, 0)) && !f.has(P.cellKey(2, SLAB_Y + 1, 0)), 'a forbidden column is a wall')
  const wet = P.walkReach(slabWorld({ [K(1, SLAB_Y + 1, 0)]: B('water') }), { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: 0, x1: 2, y0: 50, y1: 80, z0: 0, z1: 0 } })
  assert.ok(!wet.has(P.cellKey(1, SLAB_Y + 1, 0)))
})

await t('standFor: only reachable cells; never the target or the column; a top face only from above; within reach; never through a solid block', () => {
  const read = slabWorld()
  const reach = P.walkReach(read, { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: -10, x1: 10, y0: 50, y1: 80, z0: -10, z1: 10 } })
  const target = { x: 3, y: SLAB_Y + 1, z: 0 }, ref = { x: 3, y: SLAB_Y, z: 0 }, pt = P.faceCentre(ref, [0, 1, 0])
  const s = P.standFor(read, { target, point: pt, topFace: true, reach })
  assert.ok(s && reach.has(P.cellKey(s.x, s.y, s.z)))
  assert.ok(!(s.x === 3 && s.z === 0))
  assert.ok(Math.hypot(s.x + 0.5 - pt.x, s.y + P.EYE_HEIGHT - pt.y, s.z + 0.5 - pt.z) <= P.PLINTH_REACH)
  assert.equal(P.standFor(read, { target, point: pt, topFace: true, reach: new Set() }), null, 'nothing reachable: no stand')
  const col = P.standFor(read, { target, point: pt, topFace: true, reach, avoid: (x) => x !== 99 }), none = col === null
  assert.ok(none, 'every cell avoided: no stand')
  // a TOP face at eye height cannot be clicked from below it
  const high = { x: 3, y: SLAB_Y + 3, z: 0 }, hp = P.faceCentre({ x: 3, y: SLAB_Y + 2, z: 0 }, [0, 1, 0])
  const hs = P.standFor(slabWorld({ [K(3, SLAB_Y + 2, 0)]: B('stone') }), { target: high, point: hp, topFace: true, reach })
  assert.equal(hs, null, 'from the slab (eye 1.62 above it) a top face 3 up is below no eye')
  // a wall between the stand and the face
  const walled = {}
  for (let z = -10; z <= 10; z++) for (let y = SLAB_Y + 1; y <= SLAB_Y + 6; y++) walled[K(2, y, z)] = B('stone')
  const wr = slabWorld(walled)
  const reachW = P.walkReach(wr, { x: 0, y: SLAB_Y + 1, z: 0 }, { box: { x0: -10, x1: 10, y0: 50, y1: 80, z0: -10, z1: 10 } })
  assert.equal(P.standFor(wr, { target, point: pt, topFace: true, reach: reachW }), null, 'no line of sight through the wall')
  assert.equal(P.sightClear(wr, { x: 0.5, y: SLAB_Y + 2.62, z: 0.5 }, pt), false)
  assert.equal(P.sightClear(read, { x: 0.5, y: SLAB_Y + 2.62, z: 0.5 }, pt, new Set([P.cellKey(3, SLAB_Y + 1, 0)])), true)
})

await t('supportsFor: the block below first, then the sides; never the block above; never a liquid, a trapdoor or a chest', () => {
  const c = { x: 5, y: SLAB_Y + 1, z: 5 }
  assert.deepEqual(P.supportsFor(slabWorld(), c).map(s => s.face), [[0, 1, 0]])
  const sides = P.supportsFor(slabWorld({ [K(5, SLAB_Y, 5)]: AIR, [K(6, SLAB_Y + 1, 5)]: B('stone'), [K(5, SLAB_Y + 2, 5)]: B('stone') }), c)
  assert.deepEqual(sides.map(s => s.face), [[-1, 0, 0]], 'the side only: never the block above')
  assert.deepEqual(P.supportsFor(slabWorld({ [K(5, SLAB_Y, 5)]: B('chest') }), c), [])
  assert.deepEqual(P.supportsFor(slabWorld({ [K(5, SLAB_Y, 5)]: { name: 'oak_trapdoor', boundingBox: 'block', shapes: [], props: { half: 'top' } } }), c), [])
})

// =====================================================================================================================
// THE HAZARD
// =====================================================================================================================
await t('plinthHazard (from the world): an open column 2+ deep that a body cannot walk or step out of; 1 deep or an exit is not; a covered cap is not; unknown is null', () => {
  const cap = { x: 0, y: SLAB_Y + 2, z: 0 }
  const box = (opts = {}) => {
    const ex = {}
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = SLAB_Y + 1; y <= SLAB_Y + 2; y++) if (dx || dz) ex[K(dx, y, dz)] = B('stone')
    return slabWorld({ ...ex, ...opts })
  }
  assert.equal(P.plinthHazard(box(), cap), true, 'walled 2 deep')
  assert.equal(P.plinthHazard(box({ [K(1, SLAB_Y + 2, 0)]: AIR }), cap), false, 'one cardinal open at the cap level: it steps out')
  assert.equal(P.plinthHazard(box({ [K(1, SLAB_Y + 1, 0)]: AIR, [K(1, SLAB_Y + 2, 0)]: AIR }), cap), false, 'it walks out')
  assert.equal(P.plinthHazard(box({ [K(1, SLAB_Y + 2, 1)]: AIR }), cap), true, 'a diagonal gap is no exit')
  assert.equal(P.plinthHazard(box({ [K(0, SLAB_Y + 1, 0)]: B('stone') }), cap), false, 'one deep: it jumps out')
  assert.equal(P.plinthHazard(box({ [K(0, SLAB_Y + 2, 0)]: B('dirt') }), cap), false, 'covered')
  assert.equal(P.plinthHazard(box({ [K(1, SLAB_Y + 2, 0)]: null }), cap), null)
})

// =====================================================================================================================
// PROGRESS, FUNDING
// =====================================================================================================================
await t('plinthProgress reads the world: done steps, places left, the next step; any ground counts; a foreign block voids; a cover is seen; unknown is said', () => {
  const plan = SLAB_PLAN.plan
  const p0 = P.plinthProgress(slabWorld(), plan)
  assert.equal(p0.done, 0); assert.equal(p0.next, 0); assert.equal(p0.placesLeft, plan.cost); assert.equal(p0.complete, false)
  const half = applied(slabWorld(), plan, 20)
  const p1 = P.plinthProgress(half, plan)
  assert.equal(p1.done, 20); assert.equal(p1.next, 20)
  const fin = P.plinthProgress(applied(slabWorld(), plan), plan)
  assert.equal(fin.complete, true); assert.equal(fin.placesLeft, 0)
  const s = plan.steps[30]
  const anyGround = P.plinthProgress(slabWorld({ [K(...s.c)]: B('andesite') }), plan)
  assert.equal(anyGround.done, 1, 'a bot may place any stone')
  const chest = P.plinthProgress(slabWorld({ [K(...s.c)]: B('chest') }), plan)
  assert.match(chest.blocked, /^chest at /)
  const covered = P.plinthProgress(P.overlay(applied(slabWorld(), plan), new Map([[P.cellKey(plan.cap.x, plan.cap.y, plan.cap.z), B('dirt')]])), plan)
  assert.equal(covered.covered, true)
  assert.equal(P.plinthProgress(slabWorld({ [K(...s.c)]: null }), plan).unknown, true)
})

await t('plinthBlockFor / plinthBudget: decorations first; never below STONE_GUARD of reserve stone; never the last cover block', () => {
  const S = (name, count) => ({ name, count })
  assert.equal(P.plinthBlockFor([S('cobblestone', 64), S('andesite', 10), S('dirt', 1)]), 'andesite')
  assert.equal(P.plinthBudget([S('cobblestone', 64), S('andesite', 10), S('dirt', 1)]), 10, '74 reserve stone - 64')
  assert.equal(P.plinthBudget([S('cobblestone', 65)]), 0, '65 cobble, no other cover: the 65th IS the cover')
  assert.equal(P.plinthBudget([S('cobblestone', 65), S('dirt', 1)]), 1)
  assert.equal(P.plinthBudget([S('cobblestone', 128), S('dirt', 3)]), 64)
  assert.equal(P.plinthBudget([S('cobblestone', 130)]), 65, 'cobble covers too: 64 kept + 1 cover')
  assert.equal(P.plinthBudget([S('stone', 300), S('dirt', 5)]), 0, 'stone is not a plinth block (the mine rung counts it)')
  assert.equal(P.plinthBudget([]), 0)
  assert.equal(P.plinthBudget([S('cobblestone', 200), S('dirt', 1)], 40), 40, 'capped')
  // after spending the budget the bag still keeps the guard and a cover
  const bag = [S('cobblestone', 100), S('andesite', 7)]
  const n = P.plinthBudget(bag)
  let left = bag.map(x => ({ ...x }))
  for (let i = 0; i < n; i++) { const nm = P.plinthBlockFor(left); left.find(x => x.name === nm).count--; left = left.filter(x => x.count > 0) }
  assert.ok(W.reserveStone(left) >= W.STONE_GUARD && W.pitCoverItem(left))
})

await t('plinthShortfall: what a withdraw must bring for the bag to spend `need`', () => {
  const S = (name, count) => ({ name, count })
  assert.equal(P.plinthShortfall([S('cobblestone', 200), S('dirt', 1)], 40), 0)
  assert.equal(P.plinthShortfall([], 40), 64 + 1 + 40)
  assert.equal(P.plinthShortfall([S('dirt', 1)], 40), 64 + 40)
  const s = P.plinthShortfall([S('cobblestone', 70)], 40)
  assert.equal(P.plinthBudget([S('cobblestone', 70 + s)], 40), 40, 'bringing it is enough')
})

// =====================================================================================================================
// THE RECORD, THE LEASE, THE ORDER
// =====================================================================================================================
await t('plinthRecordState: a plan for this world; none / void / complete; another world or version is no record', () => {
  const rec = { v: P.PLINTH_VERSION, state: 'plan', world: 'w1', at: 1, plan: SLAB_PLAN.plan }
  assert.equal(P.plinthRecordState(rec, 'w1'), 'plan')
  assert.equal(P.plinthRecordState(rec, 'w2'), null, 'a reseed')
  assert.equal(P.plinthRecordState({ ...rec, v: 0 }, 'w1'), null)
  assert.equal(P.plinthRecordState({ ...rec, state: 'complete' }, 'w1'), 'complete')
  assert.equal(P.plinthRecordState({ v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: 1 }, 'w1'), 'none')
  assert.equal(P.plinthRecordState({ ...rec, plan: { cap: null } }, 'w1'), null)
})

await t('leaseState: free, expired, mine, held by another, from the future', () => {
  assert.equal(P.leaseState(null, 1000, 'a').free, true)
  assert.equal(P.leaseState({ by: 'b', at: 0, until: 999 }, 1000, 'a').free, true, 'expired')
  assert.deepEqual(P.leaseState({ by: 'a', at: 900, until: 2000 }, 1000, 'a'), { free: true, mine: true, holder: 'a', leftMs: 1000 })
  assert.deepEqual(P.leaseState({ by: 'b', at: 900, until: 2000 }, 1000, 'a'), { free: false, mine: false, holder: 'b', leftMs: 1000 })
  assert.equal(P.leaseState({ by: 'b', at: 1_000_000, until: 2_000_000 }, 1000, 'a').free, true, 'a clock from the future is not trusted')
})

await t('plinthWant: the no-site record starts a plan; a plan wants building; none holds 2 h; complete holds until a newer no-site; a usable well wants nothing; another world never', () => {
  const NOW = 100_000_000, ns = { at: NOW - 1000, world: 'w1' }
  const plan = { v: P.PLINTH_VERSION, state: 'plan', world: 'w1', at: 1, plan: SLAB_PLAN.plan }
  assert.equal(P.plinthWant({ noSite: ns, world: 'w1', now: NOW }).want, 'plan')
  assert.equal(P.plinthWant({ noSite: null, world: 'w1', now: NOW }).want, null, 'positive control: no trigger, no plan')
  assert.equal(P.plinthWant({ noSite: { ...ns, world: 'w0' }, world: 'w1', now: NOW }).want, null)
  assert.equal(P.plinthWant({ rec: plan, world: 'w1', now: NOW }).want, 'build')
  assert.equal(P.plinthWant({ rec: plan, world: 'w1', now: NOW, wellUsable: true }).want, null)
  const none = { v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: NOW - 1000 }
  assert.equal(P.plinthWant({ rec: none, noSite: ns, world: 'w1', now: NOW }).want, null)
  assert.equal(P.plinthWant({ rec: none, noSite: ns, world: 'w1', now: NOW + P.PLINTH_NONE_BACKOFF_MS }).want, 'plan')
  const done = { ...plan, state: 'complete', doneAt: NOW - 5000 }
  assert.equal(P.plinthWant({ rec: done, noSite: { at: NOW - 9000, world: 'w1' }, world: 'w1', now: NOW }).want, null)
  assert.equal(P.plinthWant({ rec: done, noSite: { at: NOW - 10, world: 'w1' }, world: 'w1', now: NOW }).want, 'plan', 'the raised well was lost: plan again')
  assert.equal(P.plinthWant({ rec: { ...plan, state: 'void' }, noSite: ns, world: 'w1', now: NOW }).want, 'plan')
})

await t('plinthOrder: at town, wanted, the lease free, funded (bag or chest) -> build_plinth; a planning visit needs no funds; cooldown, backoff, scan rate', () => {
  const NOW = 50_000_000
  const base = { now: NOW, distHome: 5, want: { want: 'build' }, lease: { free: true }, budget: 20, freeSlots: 0, chests: false, state: {} }
  const r = P.plinthOrder(base)
  assert.equal(r.order?.skill, 'build_plinth')
  assert.equal(P.plinthOrder({ ...base, distHome: 60 }).order, null)
  assert.equal(P.plinthOrder({ ...base, inside: true }).order, null)
  assert.equal(P.plinthOrder({ ...base, want: { want: null } }).order, null)
  assert.equal(P.plinthOrder({ ...base, lease: { free: false } }).order, null, 'one builder per town')
  assert.equal(P.plinthOrder({ ...base, budget: 3 }).order, null, 'unfunded, no chest')
  assert.equal(P.plinthOrder({ ...base, budget: 3, freeSlots: 1, chests: true }).order?.skill, 'build_plinth', 'a chest funds it')
  assert.equal(P.plinthOrder({ ...base, budget: 3, freeSlots: 0, chests: true }).order, null, 'no slot to take into')
  assert.equal(P.plinthOrder({ ...base, budget: 0, want: { want: 'plan' } }).order?.skill, 'build_plinth', 'planning costs nothing')
  assert.equal(P.plinthOrder({ ...base, state: r.state, now: NOW + 1000 }).order, null, 'cooldown')
  assert.equal(P.plinthOrder({ ...base, state: r.state, now: NOW + P.PLINTH_COOLDOWN_MS }).order?.skill, 'build_plinth')
  assert.equal(P.plinthOrder({ ...base, state: { backoffUntil: NOW + 1 } }).order, null)
  let calls = 0
  P.plinthOrder({ ...base, budget: () => { calls++; return 20 }, state: { lastAt: NOW - 1000 } })
  assert.equal(calls, 0, 'the bag is not simulated while the cooldown holds')
})

await t('plinthOrderOutcome: success clears; no plan holds 2 h; a fault 30 min; a lease or a body only the cooldown; a skip or an abort costs nothing', () => {
  const NOW = 1_000_000
  assert.equal(P.plinthOrderOutcome('success', NOW, { backoffUntil: NOW + 5 }).backoffUntil, 0)
  assert.equal(P.plinthOrderOutcome('no_effect', NOW, {}, 'plinth_none').backoffUntil, NOW + P.PLINTH_NONE_BACKOFF_MS)
  assert.equal(P.plinthOrderOutcome('failed', NOW, {}, 'plinth_unfunded').backoffUntil, NOW + P.PLINTH_BACKOFF_MS)
  assert.equal(P.plinthOrderOutcome('failed', NOW, {}, 'plinth_attended').backoffUntil, NOW + P.PLINTH_COOLDOWN_MS)
  assert.equal(P.plinthOrderOutcome('no_effect', NOW, {}, 'plinth_lease').backoffUntil, undefined)
  assert.equal(P.plinthOrderOutcome('aborted', NOW, {}).backoffUntil, undefined)
})

await t('THE REFUSAL CHAIN: an unfunded build backs the plinth off, and the town deposit is then free to run (the plinth order no longer pre-empts it)', () => {
  const NOW = 70_000_000
  const s1 = P.plinthOrderOutcome('failed', NOW, {}, 'plinth_unfunded')
  const r = P.plinthOrder({ now: NOW + 60_000, distHome: 5, want: { want: 'build' }, lease: { free: true }, budget: 30, state: s1 })
  assert.equal(r.order, null, 'backed off: the deposit and every other order get the decision')
  assert.equal(P.plinthOrder({ now: NOW + P.PLINTH_BACKOFF_MS, distHome: 5, want: { want: 'build' }, lease: { free: true }, budget: 30, state: s1 }).order?.skill, 'build_plinth', 'and it comes back')
})

await t('plinthBreakCost: a stair cell is never dug (100); anything else is free', () => {
  const st = [[1, 2, 3], [4, 5, 6]]
  assert.equal(P.plinthBreakCost(st, { position: { x: 4, y: 5, z: 6 } }), 100)
  assert.equal(P.plinthBreakCost(st, { position: { x: 4, y: 6, z: 6 } }), 0)
  assert.equal(P.plinthBreakCost([], { position: { x: 4, y: 5, z: 6 } }), 0)
})

await t('plinthDetail: stage first, key=value, cut at 300', () => {
  const d = P.plinthDetail({ stage: 'build', at: { x: 1, y: 2, z: 3 }, k: 3, placed: 5, done: 5, total: 60, why: 'a b c'.repeat(200) })
  assert.match(d, /^stage=build at=1,2,3 k=3 placed=5 cleared=0 alt=0 retries=0 done=5\/60 took=0 why=a_b_c/)
  assert.ok(d.length <= 300)
})

// =====================================================================================================================
// REVIEW r1: the click re-proved at its turn; carried columns; stalls; leases with tokens; the chest route's room
// =====================================================================================================================
await t('standOk: the planner\'s checks asked again -- standable, not the column, not the target, reach, top face, sight, and never walled in by its own click (Codex r1 P1-1)', () => {
  const read = slabWorld()
  const start = { x: 0, y: SLAB_Y + 1, z: 0 }, box = { x0: -10, x1: 20, y0: 50, y1: 80, z0: -10, z1: 10 }
  const target = { x: 5, y: SLAB_Y + 1, z: 0 }, pt = P.faceCentre({ x: 5, y: SLAB_Y, z: 0 }, [0, 1, 0])
  const base = { target, point: pt, topFace: true, op: 'place', start, box }
  assert.equal(P.standOk(read, { ...base, stand: { x: 4, y: SLAB_Y + 1, z: 0 } }), null, 'positive control')
  assert.equal(P.standOk(read, { ...base, stand: { x: 5, y: SLAB_Y + 1, z: 0 } }), 'in the target cell')
  assert.equal(P.standOk(read, { ...base, stand: { x: 4, y: SLAB_Y + 1, z: 0 }, forbid: (x, y, z) => x === 4 }), 'in a well column')
  assert.equal(P.standOk(read, { ...base, stand: { x: 12, y: SLAB_Y + 1, z: 0 } }), 'out of reach')
  assert.equal(P.standOk(read, { ...base, stand: { x: 4, y: SLAB_Y + 2, z: 0 } }), 'not standable')
  const wall = slabWorld({ [K(5, SLAB_Y + 2, 0)]: B('stone'), [K(4, SLAB_Y + 3, 0)]: B('stone') })
  assert.equal(P.standOk(wall, { ...base, stand: { x: 5, y: SLAB_Y + 1, z: 1 }, point: P.faceCentre({ x: 5, y: SLAB_Y + 2, z: 0 }, [0, -1, 0]), topFace: false }), 'no line of sight', 'a face whose only view is through stone')
  // AN ALCOVE: a 1-wide dead end whose only way out is the cell the click fills
  const alcove = {}
  for (let x = 3; x <= 7; x++) for (let y = SLAB_Y + 1; y <= SLAB_Y + 3; y++) { alcove[K(x, y, 1)] = B('stone'); alcove[K(x, y, -1)] = B('stone') }
  for (let y = SLAB_Y + 1; y <= SLAB_Y + 3; y++) alcove[K(8, y, 0)] = B('stone')
  for (let x = 3; x <= 7; x++) alcove[K(x, SLAB_Y + 3, 0)] = B('stone')   // the alcove's roof: no stepping up onto the new block
  const ar = slabWorld(alcove)
  const t2 = { x: 6, y: SLAB_Y + 1, z: 0 }, p2 = P.faceCentre({ x: 6, y: SLAB_Y, z: 0 }, [0, 1, 0])
  assert.equal(P.standOk(ar, { target: t2, point: p2, topFace: true, op: 'place', start, box, stand: { x: 7, y: SLAB_Y + 1, z: 0 } }), 'walled in after the click', 'the stand behind the cell it fills')
  assert.equal(P.standOk(ar, { target: t2, point: p2, topFace: true, op: 'place', start, box, stand: { x: 5, y: SLAB_Y + 1, z: 0 } }), null, 'the stand on the town side')
})
await t('refUsable: a recorded support read again -- a chest, a barrel, a door, a trapdoor or a crafting table put there is no support (the click would use it)', () => {
  assert.equal(P.refUsable(B('cobblestone')), true)
  for (const n of ['chest', 'barrel', 'oak_door', 'crafting_table', 'furnace', 'water']) assert.equal(P.refUsable(B(n)), false, n)
  assert.equal(P.refUsable({ name: 'oak_trapdoor', boundingBox: 'block', shapes: [] }), false)
  assert.equal(P.refUsable(AIR), false)
})
await t('carryPrev: a replan or a failed search keeps every column that may still trap a body (true or unknown) and lets go only of the safe ones (Codex r1 P1-3)', () => {
  const c1 = { x: 1, y: 70, z: 1 }, c2 = { x: 9, y: 70, z: 9 }, c3 = { x: 20, y: 70, z: 20 }
  const rec = { plan: { cap: c1, stair: [[4, 66, 1]] }, prev: [c2, c3, c2] }
  const hz = c => (c.x === 1 ? true : c.x === 9 ? null : false)
  const S_ = (c, stair = []) => ({ ...c, stair })
  assert.deepEqual(P.carryPrev(rec, hz), [S_(c1, [[4, 66, 1]]), S_(c2)], 'hazard and unknown kept with their stairs, the safe one dropped, no duplicates')
  assert.deepEqual(P.carryPrev(rec, hz, c1), [S_(c2)], 'the new plan\'s own cap is not carried')
  assert.deepEqual(P.carryPrev({ state: 'none', prev: [c1] }, () => true), [S_(c1)], 'a no-plan record still carries')
  assert.deepEqual(P.carryPrev(null, () => true), [])
  const many = { prev: Array.from({ length: 50 }, (_, i) => ({ x: i, y: 70, z: 0 })) }
  assert.equal(P.carryPrev(many, () => true).length, 50, 'never evicted to fit a limit (Codex r2 P2-4)')
})
await t('stuckNext: progress clears it; no progress on the same step counts up; another step starts again', () => {
  assert.equal(P.stuckNext({ step: 3, n: 2 }, { step: 3, progressed: true }), null)
  assert.deepEqual(P.stuckNext(null, { step: 3, progressed: false }), { step: 3, n: 1 })
  assert.deepEqual(P.stuckNext({ step: 3, n: 2 }, { step: 3, progressed: false }), { step: 3, n: 3 })
  assert.deepEqual(P.stuckNext({ step: 3, n: 2 }, { step: 4, progressed: false }), { step: 4, n: 1 })
})
await t('coverableAfter: a walled-in column can be covered from a stand that walks to town; not when nothing walls the cap level', () => {
  const plan = SLAB_PLAN.plan, cap = plan.cap
  const forbid = (x, y, z) => P.inColumn(cap, x, y, z)
  const walled = applied(slabWorld(), plan, plan.hazardStep + 1)
  assert.equal(P.plinthHazard(walled, cap), true)
  assert.equal(P.coverableAfter(walled, cap, { start: plan.start, box: boxOf(plan), forbid }), true, 'the plan\'s walled-in state')
  assert.equal(P.coverableAfter(slabWorld(), cap, { start: plan.start, box: boxOf(plan), forbid }), false, 'no wall at the cap level: no cover reference')
  assert.equal(P.coverableAfter(walled, cap, { start: plan.start, box: boxOf(plan), forbid: () => true }), false, 'no stand that walks to town')
})
await t('leaseState with tokens: the same username on a new connection is not the holder (Codex r1 P1-2)', () => {
  const L = { by: 'a', token: 'a-1', at: 900, until: 2000 }
  assert.equal(P.leaseState(L, 1000, 'a-1').mine, true)
  assert.equal(P.leaseState(L, 1000, 'a-2').free, false, 'a new token waits out the old lease')
  assert.equal(P.leaseState(L, 1000, null).free, false)
  assert.equal(P.leaseState(L, 2000, 'a-2').free, true, 'expired')
})
await t('plinthOrder: the chest route needs room for what makes the bag spendable (Claude r1 P3-5); a hand-off-only plan needs no funds', () => {
  const NOW = 90_000_000
  const base = { now: NOW, distHome: 5, want: { want: 'build', left: 20 }, lease: { free: true }, budget: 0, freeSlots: 1, chests: true, state: {} }
  assert.equal(P.plinthOrder({ ...base, chestSlots: 2 }).order, null, 'one slot where two are needed')
  assert.equal(P.plinthOrder({ ...base, freeSlots: 2, chestSlots: 2 }).order?.skill, 'build_plinth')
  assert.equal(P.plinthOrder({ ...base, chests: false, want: { want: 'build', left: 0 } }).order?.skill, 'build_plinth', 'only the hand-off is owed')
})
await t('otherColumns: a plan keeps its stands and stair out of every other column the town started (Claude r1 P3-4)', () => {
  const plan = SLAB_PLAN.plan
  // an old column right where the slab plan stands: the plan around it must not stand in it
  const s0 = plan.steps[0].s
  const other = { x: s0[0], y: s0[1] + 1, z: s0[2] }
  const r = P.planPlinth({ read: slabWorld(), home: HOME, otherColumns: [other] })
  assert.ok(r.plan)
  for (const s of r.plan.steps) assert.ok(!P.inColumn(other, ...s.s) && !P.inColumn(other, s.s[0], s.s[1] + 1, s.s[2]), `stand ${s.s} in the other column`)
})

// ---- REVIEW r2 (Codex REJECT) ----
/** A 2-deep pit the town drops into, whose only way out is a one-block step: clicking a block onto the step's feet cell
 *  leaves the town reaching the pit and the pit reaching nothing (Codex r2 P1-1's one-way drop). */
const PIT = (() => {
  const ex = {}
  for (let x = 4; x <= 7; x++) for (let z = -1; z <= 1; z++) ex[K(x, SLAB_Y - 1, z)] = B('stone')
  for (const x of [5, 6]) { ex[K(x, SLAB_Y, 0)] = AIR; ex[K(x, SLAB_Y - 1, 0)] = AIR; ex[K(x, SLAB_Y - 2, 0)] = B('stone') }
  ex[K(6, SLAB_Y - 1, 0)] = B('dirt')                                       // the step
  return slabWorld(ex)
})()
await t('walksBack is directional: the town drops into the pit, the pit climbs out by its step; after a block on the step the town still reaches it and it reaches nothing', () => {
  const start = { x: 0, y: SLAB_Y + 1, z: 0 }, box = { x0: -6, x1: 12, y0: 50, y1: 80, z0: -4, z1: 4 }, S0 = { x: 5, y: SLAB_Y - 1, z: 0 }
  assert.ok(P.walkReach(PIT, start, { box }).has(P.cellKey(S0.x, S0.y, S0.z)), 'the town drops in')
  assert.equal(P.walksBack(PIT, S0, start, { box }), true, 'positive control: up the step and out')
  const after = P.overlay(PIT, new Map([[P.cellKey(6, SLAB_Y, 0), P.PLACED]]))
  assert.ok(P.walkReach(after, start, { box }).has(P.cellKey(S0.x, S0.y, S0.z)), 'still: the town reaches the pit')
  assert.equal(P.walksBack(after, S0, start, { box }), false, 'but the pit no longer reaches the town')
})
await t('standOk refuses the one-way stand (Codex r2 P1-1): the click that tops the step from inside the pit', () => {
  const start = { x: 0, y: SLAB_Y + 1, z: 0 }, box = { x0: -6, x1: 12, y0: 50, y1: 80, z0: -4, z1: 4 }
  const args = { target: { x: 6, y: SLAB_Y, z: 0 }, point: P.faceCentre({ x: 6, y: SLAB_Y - 1, z: 0 }, [0, 1, 0]), topFace: true, op: 'place', start, box, stand: { x: 5, y: SLAB_Y - 1, z: 0 } }
  assert.equal(P.standOk(PIT, args), 'walled in after the click')
  assert.equal(P.standOk(PIT, { ...args, stand: { x: 4, y: SLAB_Y + 1, z: 0 } }), null, 'from the rim it is fine')
  assert.equal(P.standOk(PIT, { ...args, op: 'clear', target: { x: 6, y: SLAB_Y - 1, z: 0 }, stand: { x: 6, y: SLAB_Y, z: 0 }, point: { x: 6.5, y: SLAB_Y - 0.5, z: 0.5 }, topFace: false }), 'standing on the target', 'never dig the block under its own feet')
})
await t('plinthWant: a voided structure is its own trigger, even after a partial hand-off lifted the no-site hold (Codex r2 P2-6)', () => {
  const v = { v: P.PLINTH_VERSION, state: 'void', world: 'w1', at: 1, plan: SLAB_PLAN.plan }
  assert.equal(P.plinthWant({ rec: v, noSite: null, world: 'w1', now: 5 }).want, 'plan')
  assert.equal(P.plinthWant({ rec: v, noSite: null, world: 'w1', now: 5, wellUsable: true }).want, null)
})
await t('walkReachBack is walkReach run backwards: for every standable cell c, back(t).has(c) iff walkReach(c).has(t) (pit, bush, tree, the slab plan half built)', () => {
  const worlds = [['pit', PIT], ['bush', treeWorld(3)], ['tree', treeWorld(6)], ['half', applied(slabWorld(), SLAB_PLAN.plan, 40)]]
  const t0 = { x: 0, y: SLAB_Y + 1, z: 0 }, box = { x0: -4, x1: 16, y0: SLAB_Y - 3, y1: SLAB_Y + 8, z0: -4, z1: 4 }
  let cells = 0
  for (const [name, read] of worlds) {
    const back = P.walkReachBack(read, t0, { box })
    for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = box.y0; y <= box.y1; y++) {
      if (!P.standable(read, x, y, z)) continue
      cells++
      assert.equal(back.has(P.cellKey(x, y, z)), P.walkReach(read, { x, y, z }, { box }).has(P.cellKey(t0.x, t0.y, t0.z)), `${name} ${x},${y},${z}`)
    }
  }
  assert.ok(cells > 500, `positive control: ${cells} standable cells compared`)
})
await t('walkReach until: a probe for one cell stops as soon as it is found (and still finds it)', () => {
  const start = { x: 0, y: SLAB_Y + 1, z: 0 }, box = { x0: -40, x1: 40, y0: 50, y1: 80, z0: -40, z1: 40 }
  const full = P.walkReach(slabWorld(), start, { box })
  const early = P.walkReach(slabWorld(), start, { box, until: P.cellKey(1, SLAB_Y + 1, 0) })
  assert.ok(early.has(P.cellKey(1, SLAB_Y + 1, 0)) && early.size < full.size / 10)
})

// =====================================================================================================================
// MUTANTS: each anchor present and unique; each must change an outcome above
// =====================================================================================================================
await t('MUTANT: support from the block ABOVE allowed -> a bottom-face click appears in some plan, and the step test catches it', async () => {
  await withMutant(PP, 'const FACES = Object.freeze([[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])', 'const FACES = Object.freeze([[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])', async M => {
    const c = { x: 5, y: SLAB_Y + 1, z: 5 }
    const s = M.supportsFor(slabWorld({ [K(5, SLAB_Y, 5)]: AIR, [K(5, SLAB_Y + 2, 5)]: B('stone') }), c)
    assert.ok(s.some(x => x.face[1] === -1), 'the mutant clicks a bottom face')
  })
})
await t('MUTANT: the oracle skipped -> a candidate with water within 3 of the rim is accepted (only the oracle says no)', async () => {
  await withMutant(PP, "  const why = wellSiteRefusal(overlay(read, cells), cap, home, { avoid })\n", "  const why = null\n", async M => {
    const base = { home: HOME, x: 12, z: 0, t: SLAB_Y, k: 3 }
    const wet = slabWorld({ [K(12, SLAB_Y + 5, 3)]: B('water') })
    assert.ok(M.plinthCandidate(wet, base).cap, 'the mutant accepts it')
    assert.match(P.plinthCandidate(wet, base).why, /^oracle:water within 3/, 'the real one refuses')
  })
})
await t('MUTANT: hazard ignores the step-up exit -> a half-built ring reads as a trap (the hazard table catches it)', async () => {
  await withMutant(PP, '    if (solid(a) && passable(h) && passable(h2) && passable(up)) return false\n', '', async M => {
    const cap = { x: 0, y: SLAB_Y + 2, z: 0 }
    const ex = {}
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) ex[K(dx, SLAB_Y + 1, dz)] = B('stone')
    assert.equal(M.plinthHazard(slabWorld(ex), cap), true, 'the mutant')
    assert.equal(P.plinthHazard(slabWorld(ex), cap), false, 'the real one: it steps out')
  })
})
await t('MUTANT: the budget keeps no cover -> the last cobble is spent and pitCoverItem is null after the visit', async () => {
  await withMutant(PP, '    if (reserveStone(after) >= STONE_GUARD && pitCoverItem(after)) return name\n', '    if (reserveStone(after) >= STONE_GUARD) return name\n', async M => {
    assert.equal(M.plinthBudget([{ name: 'cobblestone', count: 65 }]), 1)
    assert.equal(P.plinthBudget([{ name: 'cobblestone', count: 65 }]), 0)
  })
})
await t('MUTANT: the lease ignores its holder -> two builders at once', async () => {
  await withMutant(PP, "  return { free: false, mine: false, holder: lease.by ?? '?', leftMs: until - now }\n", "  return { free: true, mine: false, holder: lease.by ?? '?', leftMs: until - now }\n", async M => {
    assert.equal(M.leaseState({ by: 'b', at: 900, until: 2000 }, 1000, 'a').free, true)
    assert.equal(P.leaseState({ by: 'b', at: 900, until: 2000 }, 1000, 'a').free, false)
  })
})

await t('MUTANT: the hazard never recorded -> hazardStep stays null on a raised plan (the hazard-step test asserts it)', async () => {
  await withMutant(PP, "          if (hazardStep === null) hazardStep = steps.length\n", '', async M => {
    const r = M.planPlinth({ read: slabWorld(), home: HOME })
    assert.equal(r.plan.hazardStep, null)
    assert.notEqual(SLAB_PLAN.plan.hazardStep, null)
  })
})

await t('MUTANT: standOk without the after-click walk -> the alcove stand behind the cell it fills is accepted', async () => {
  await withMutant(PP, "  if (!walksBack(after, stand, start, { box, forbid })) return 'walled in after the click'\n", '', async M => {
    const alcove = {}
    for (let x = 3; x <= 7; x++) for (let y = SLAB_Y + 1; y <= SLAB_Y + 3; y++) { alcove[K(x, y, 1)] = B('stone'); alcove[K(x, y, -1)] = B('stone') }
    for (let y = SLAB_Y + 1; y <= SLAB_Y + 3; y++) alcove[K(8, y, 0)] = B('stone')
    for (let x = 3; x <= 7; x++) alcove[K(x, SLAB_Y + 3, 0)] = B('stone')
    const args = { target: { x: 6, y: SLAB_Y + 1, z: 0 }, point: P.faceCentre({ x: 6, y: SLAB_Y, z: 0 }, [0, 1, 0]), topFace: true, op: 'place', start: { x: 0, y: SLAB_Y + 1, z: 0 }, box: { x0: -10, x1: 20, y0: 50, y1: 80, z0: -10, z1: 10 }, stand: { x: 7, y: SLAB_Y + 1, z: 0 } }
    assert.equal(M.standOk(slabWorld(alcove), args), null, 'the mutant accepts it')
    assert.equal(P.standOk(slabWorld(alcove), args), 'walled in after the click')
  })
})
await t('MUTANT: carryPrev drops the unknown columns -> an unreadable pit is forgotten', async () => {
  await withMutant(PP, "    if (hazardOf(c) === false) continue\n", "    if (hazardOf(c) !== true) continue\n", async M => {
    assert.deepEqual(M.carryPrev({ prev: [{ x: 9, y: 70, z: 9 }] }, () => null), [])
    assert.deepEqual(P.carryPrev({ prev: [{ x: 9, y: 70, z: 9 }] }, () => null), [{ x: 9, y: 70, z: 9, stair: [] }])
  })
})

await t('MUTANT: the escape proof in the town\'s direction (r1) -> the one-way stand in the pit is accepted', async () => {
  await withMutant(PP, "  if (!walksBack(after, stand, start, { box, forbid })) return 'walled in after the click'\n", "  if (!walkReach(after, start, { box, forbid }).has(K(x, y, z))) return 'walled in after the click'\n", async M => {
    const args = { target: { x: 6, y: SLAB_Y, z: 0 }, point: P.faceCentre({ x: 6, y: SLAB_Y - 1, z: 0 }, [0, 1, 0]), topFace: true, op: 'place', start: { x: 0, y: SLAB_Y + 1, z: 0 }, box: { x0: -6, x1: 12, y0: 50, y1: 80, z0: -4, z1: 4 }, stand: { x: 5, y: SLAB_Y - 1, z: 0 } }
    assert.equal(M.standOk(PIT, args), null, 'the mutant accepts it')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '))
process.exit(fail ? 1 : 0)
