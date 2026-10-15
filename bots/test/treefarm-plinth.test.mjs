// THE TREE FARM x THE RAISED WELL (treefarm-01 on plinth-01; a TEST MERGE file -- it lands with whichever of the two lands
// second). The plinth planner is given what skills.mjs gives it: the well's avoid list (wellAvoid, which carries
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
  const res = P.planPlinth({ read, home: HOME, avoid: TF.farmWellAvoid(fit.record), keepOut: ko })
  assert.ok(res.plan, `the planner still finds a plan: ${res.why}`)
  assert.equal(touches(res.plan), false, `cap ${JSON.stringify(res.plan.cap)}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
