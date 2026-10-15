// THE TREE FARM x THE TOWN FLOOR (treefarm-01 on townfloor-01; a TEST MERGE file -- it lands with whichever of the two lands
// second). The floor fills open cells in its band (Chebyshev 16, home.y-12..L = home.y-2); a farm's soil can sit AT L, and a
// soil cell that was dug (soil_lost) is an open cell there. Filled with stone it is soil_foreign for good. The floor's
// keep-out list carries farmKeepOut (skills.mjs floorKeepOut), so the planner never targets a farm cell.
import assert from 'node:assert/strict'
const { F, HOME, L, town, carve } = await import('./townfloor-fixtures.mjs')
const TF = await import('../src/treefarm.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`) } }

await t('FLOOR x FARM: a farm plot\'s lost soil AT the floor level is never a floor target once the farm is in the keep-out (positive control: it is without)', () => {
  const plot = { x: 10, y: L + 1, z: 10 }
  const rec = { blueprint: 'treefarm', version: 1, cells: [{ ...plot, role: 'plot' }, { x: 12, y: L + 1, z: 12, role: 'torch' }] }
  const c = carve({}, 10, 10, L, L, 10, 10)            // the plot's soil dug out: an open cell at L
  carve(c, 12, 12, L, L, 12, 12)                        // the torch's floor dug out too
  const w = town(c)
  const keyset = r => new Set(r.targets.map(q => `${q.x},${q.y},${q.z}`))
  const bare = keyset(F.floorCells(w.read, HOME))
  assert.ok(bare.has(`10,${L},10`) && bare.has(`12,${L},12`), 'positive control: without the farm the holes are floor targets')
  const ko = TF.farmKeepOut(rec).map(q => ({ ...q, up: 0, down: 0 }))
  const guarded = keyset(F.floorCells(w.read, HOME, { keepOut: ko }))
  assert.equal(guarded.has(`10,${L},10`), false); assert.equal(guarded.has(`12,${L},12`), false)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
