// THE TREE FARM x THE RAISED WELL (treefarm-02 on plinth-02, fleet 0fe92258). The plinth planner is given what skills.mjs gives it: the well's search avoid list (wellSearchAvoid, which carries
// farmWellAvoid) and the keep-out list (plinthKeepOut, which carries farmKeepOut). The plan it makes keeps its cap
// FARM_WELL_DISTANCE from every plot and never plans a cell into a plot's soil or column or a torch cell; and the
// planner still finds a plan (the refusal leaves the town a well).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const P = await import('../src/plinth.mjs')
const TF = await import('../src/treefarm.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const PBlock = require('prismarine-block')('1.21.11')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) } }
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

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const plotsOf = rec => rec.cells.filter(c => c.role === 'plot')
const read = slabWorld()
const bare = P.planPlinth({ read, home: HOME }).plan
const farmRead = (x, y, z) => { const b = read(x, y, z); return b ? { name: b.name, boundingBox: b.boundingBox } : null }

await t('PLINTH x FARM: with the farm in its avoid and keep-out lists the plinth plan stays off every farm cell, its cap FARM_WELL_DISTANCE from every plot -- and a plan is still found', () => {
  assert.ok(bare, 'positive control: the slab town has a plinth plan')
  // a farm whose corner plot sits on the bare plan's cap
  const away = v => (v >= 0 ? 4 : -4)
  const fit = TF.fitFarm({ read: farmRead, anchor: { x: bare.cap.x + away(bare.cap.x), y: SLAB_Y + 1, z: bare.cap.z + away(bare.cap.z) }, home: HOME })
  assert.ok(fit.record, fit.why)
  const ko = TF.farmKeepOut(fit.record), koSet = new Set(ko.map(c => K(c.x, c.y, c.z)))
  const touches = plan => plan.steps.some(s => koSet.has(K(...s.c))) || plotsOf(fit.record).some(p => flat(p, plan.cap) < TF.FARM_WELL_DISTANCE)
  assert.ok(touches(bare), 'positive control: the bare plan collides with this farm')
  const res = P.planPlinth({ read, home: HOME, avoid: TF.farmWellAvoid(fit.record), keepOut: TF.farmPlannerKeepOut(fit.record), noStand: TF.farmCellTest(fit.record) })
  assert.ok(res.plan, `the planner still finds a plan: ${res.why}`)
  assert.equal(touches(res.plan), false, `cap ${JSON.stringify(res.plan.cap)}`)
})

// Claude r14 P2-1 / P3-1: the TRUNK CLEARANCE (the 3x3 above a sapling must be free for oak and birch to grow) and the
// builder's STANDS. The anchors are the reviewer's reproduction: with the exact keep-out alone the planner put cobble one
// block above a sapling, diagonal to its column.
const ringOf = rec => { const out = new Set(); for (const p of plotsOf(rec)) for (let y = p.y + 1; y <= p.y + TF.CLEAR_ABOVE + 1; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) out.add(K(p.x + dx, y, p.z + dz)); return out }
const fitAt = (x, z) => TF.fitFarm({ read: farmRead, anchor: { x, y: SLAB_Y + 1, z }, home: HOME })
const plinthEntries = plan => [{ x: plan.cap.x, z: plan.cap.z, r: TF.FARM_WELL_DISTANCE, what: 'plinth' },
  ...plan.steps.flatMap(st => [st.c, st.s].filter(Boolean).map(q => ({ x: q[0], y: q[1], z: q[2], r: TF.FARM_TORCH_WELL_DISTANCE, what: 'plinth_cell' })))]
await t('TRUNK CLEARANCE (Claude r14 P2-1): with the exact keep-out alone the planner fills a plot\'s trunk ring (the reproduction); with farmPlannerKeepOut no planned cell is in any ring, no stand is on a farm cell, and the farm would not yield to the plan', () => {
  let reproduced = 0
  for (const [ax, az] of [[-12, 0], [-8, 0]]) {
    const fit = fitAt(ax, az)
    assert.ok(fit.record, fit.why)
    const ring = ringOf(fit.record)
    const old = P.planPlinth({ read, home: HOME, avoid: TF.farmWellAvoid(fit.record), keepOut: TF.farmKeepOut(fit.record) }).plan
    if (old && old.steps.some(st => ring.has(K(...st.c)))) reproduced++
    const res = P.planPlinth({ read, home: HOME, avoid: TF.farmWellAvoid(fit.record), keepOut: TF.farmPlannerKeepOut(fit.record), noStand: TF.farmCellTest(fit.record) })
    assert.ok(res.plan, `a plan is still found: ${res.why}`)
    assert.deepEqual(res.plan.steps.filter(st => ring.has(K(...st.c))).map(st => st.c), [], `anchor ${ax},${az}: no cell in a trunk ring`)
    const cell = TF.farmCellTest(fit.record)
    assert.deepEqual(res.plan.steps.filter(st => st.s && (cell(...st.s) || cell(st.s[0], st.s[1] + 1, st.s[2]))).map(st => st.s), [], 'no stand on a farm cell')
    assert.equal(TF.farmYields(fit.record, plinthEntries(res.plan)), null, 'the composed verdict: the farm keeps its record')
  }
  assert.ok(reproduced > 0, 'positive control: the exact keep-out alone fills a trunk ring here')
})

await t('NO STAND ON THE FARM (Claude r14 P3-1): the planner\'s noStand keeps every builder stand (feet and head) off the given cells; without it a stand lands there (positive control)', () => {
  const plan = bare
  const stands = plan.steps.map(st => st.s).filter(Boolean)
  assert.ok(stands.length > 0)
  const s0 = stands[0], banned = new Set([K(...s0)])
  const res = P.planPlinth({ read, home: HOME, noStand: (x, y, z) => banned.has(K(x, y, z)) })
  assert.ok(res.plan, res.why)
  assert.equal(res.plan.steps.some(st => st.s && K(...st.s) === K(...s0)), false, 'the banned stand is never used')
  assert.equal(res.plan.steps.some(st => st.s && K(st.s[0], st.s[1] + 1, st.s[2]) === K(...s0)), false, 'nor with its head there')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
