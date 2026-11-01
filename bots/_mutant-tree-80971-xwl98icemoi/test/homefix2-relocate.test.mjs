// homefix-02 C2: pickRelocationTarget / dryTarget (docs/reports/homefix-02-design-2026-10-21.md §4 C2). Behaviour tests on
// hand-built worlds, each mechanism with an anchored mutant (helpers/mutant.mjs: present AND unique).
import assert from 'node:assert'
import { pickRelocationTarget, pickRelocationTargetAsync, dryTarget, wetOrIce, reasonsLabel, landingCheck, volumeWet, RELOCATE_TRIES } from '../src/relocate.mjs'
import { withMutant } from './helpers/mutant.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve().then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) })
const REL = new URL('../src/relocate.mjs', import.meta.url)

const EMPTY = /^(air|cave_air|water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass|powder_snow|short_grass)$/
const B = name => name == null ? null : { name, boundingBox: EMPTY.test(name) ? 'empty' : 'block' }
/** A world: ground (dirt) at y <= 63, air above, and `cells` overrides keyed 'x,y,z' (null = unloaded). */
function world (cells = {}, { ground = 63, unloadedX = null } = {}) {
  return (x, y, z) => {
    if (unloadedX != null && x >= unloadedX) return null
    const k = `${x},${y},${z}`
    if (k in cells) return B(cells[k])
    return B(y <= ground ? 'dirt' : 'air')
  }
}
/** A frozen river along z in [zr0, zr1]: dirt floor 60, water 61, ice 62, air above (hive-d, death 1). */
function riverCells (x0, x1, zr0, zr1) {
  const c = {}
  for (let x = x0; x <= x1; x++) for (let z = zr0; z <= zr1; z++) {
    c[`${x},61,${z}`] = 'water'; c[`${x},62,${z}`] = 'ice'; c[`${x},63,${z}`] = 'air'
  }
  return c
}
const seq = vals => { let i = 0; return () => vals[i++ % vals.length] }

await t('R1 a dry meadow: the first candidate is taken, at the SURFACE y (feet on the ground), not the bot y', () => {
  const r = pickRelocationTarget({ p: { x: 0, y: 66, z: 0 }, read: world(), rand: seq([0, 0]) })
  assert.equal(r.ok, true); assert.equal(r.tries, 1)
  assert.deepEqual([r.x, r.y, r.z], [45, 64, 0])
})
await t('R2 the death-1 sheet: a target ON the frozen river is refused (floor ice); one 6 off the bank is taken', () => {
  const read = world(riverCells(30, 60, -3, 3), { ground: 63 })
  // ice floor at y 62: columnSurface finds the open cell 63 over the solid ice
  const onIce = dryTarget(read, 45, 0, 64)
  assert.equal(onIce.ok, false); assert.equal(onIce.why, 'floor')
  const nearBank = dryTarget(read, 45, 7, 64)          // 4 from the river's edge z=3: inside the arrival region
  assert.equal(nearBank.ok, false); assert.equal(nearBank.why, 'wet_near')
  const off = dryTarget(read, 45, 9, 64)               // 6 off: outside Chebyshev 5
  assert.equal(off.ok, true); assert.equal(off.y, 64)
})
await t('R3 the volume is Chebyshev 5, dy -8..+7 (goto accepts <= 3 h, |dy| <= 6): edges in and out', () => {
  assert.equal(dryTarget(world({ '5,63,0': 'water' }), 0, 0, 64).why, 'wet_near')
  assert.equal(dryTarget(world({ '6,63,0': 'water' }), 0, 0, 64).ok, true)
  assert.equal(dryTarget(world({ '0,61,5': 'water' }), 0, 0, 64).why, 'wet_near')    // dy -3
  assert.equal(dryTarget(world({ '0,56,5': 'water' }), 0, 0, 64).why, 'wet_far')     // dy -8: inside
  assert.equal(dryTarget(world({ '0,55,5': 'water' }), 0, 0, 64).ok, true)           // dy -9: outside
  assert.equal(dryTarget(world({ '0,71,5': 'water' }), 0, 0, 64).why, 'wet_far')     // dy +7
})
await t('R3b CAPPED water is not exempt (Codex r3 P1-3): a 1-high layer under stone 6 below a dry ledge refuses', () => {
  assert.equal(dryTarget(world({ '2,58,0': 'water', '2,59,0': 'stone' }), 0, 0, 64).why, 'wet_far')
})
await t('R4 an unloaded cell refuses the candidate; it is never read as dry', () => {
  const r = dryTarget(world({}, { unloadedX: 3 }), 0, 0, 64)
  assert.equal(r.ok, false); assert.equal(r.why, 'unknown')
})
await t('R5 floors that are not ground: leaves (a canopy), magma, packed ice refuse; powder snow and lava are wet', () => {
  assert.equal(dryTarget(world({ '0,63,0': 'oak_leaves' }), 0, 0, 64).why, 'floor')
  assert.equal(dryTarget(world({ '0,63,0': 'magma_block' }), 0, 0, 64).why, 'floor')
  assert.equal(dryTarget(world({ '0,63,0': 'packed_ice' }), 0, 0, 64).why, 'floor')
  assert.equal(wetOrIce(B('powder_snow')), true); assert.equal(wetOrIce(B('lava')), true)
  assert.equal(wetOrIce({ name: 'oak_stairs', boundingBox: 'block', getProperties: () => ({ waterlogged: true }) }), true)
  assert.equal(wetOrIce(B('dirt')), false)
})
await t('R6 a wet world: no_dry_target after exactly 16 tries, reasons counted', () => {
  const ocean = (x, y, z) => B(y <= 50 ? 'sand' : y <= 62 ? 'water' : 'air')
  const r = pickRelocationTarget({ p: { x: 0, y: 63, z: 0 }, read: ocean, rand: seq([0.1, 0.5, 0.3, 0.9]) })
  assert.equal(r.ok, false); assert.equal(r.why, 'no_dry_target'); assert.equal(r.tries, RELOCATE_TRIES)
  assert.equal(Object.values(r.reasons).reduce((a, b) => a + b, 0), 16)
  assert.match(reasonsLabel(r.reasons), /:16$|,/)
})
await t('R7 deterministic draws: two rand() per try, the bearing/distance of the old rule (45-70 blocks)', () => {
  let n = 0
  const rand = () => { n++; return 0.25 }
  const r = pickRelocationTarget({ p: { x: 0, y: 66, z: 0 }, read: world(), rand })
  assert.equal(n, 2); assert.equal(r.ok, true)
  const d = Math.hypot(r.x, r.z); assert.ok(d >= 44.5 && d <= 70.5, `d=${d}`)
})
await t('R8 liquid over the head refuses (the cell above the head is in the near band)', () => {
  assert.equal(dryTarget(world({ '0,66,0': 'water' }), 0, 0, 64).why, 'wet_near')
})
await t('R9 the async picker gives the same answer as the sync one, and yields between tries', async () => {
  const read = world(riverCells(-80, 80, -80, 80))       // every candidate within the sheet: all refuse
  let pauses = 0
  const a = pickRelocationTarget({ p: { x: 0, y: 64, z: 0 }, read, rand: seq([0.1, 0.2, 0.7, 0.4]) })
  const b = await pickRelocationTargetAsync({ p: { x: 0, y: 64, z: 0 }, read, rand: seq([0.1, 0.2, 0.7, 0.4]), pause: async () => { pauses++ } })
  assert.deepEqual(a, b); assert.equal(a.ok, false); assert.equal(pauses, RELOCATE_TRIES - 1)
})
await t('R10 cost bound (Claude r3 P2): 16 worst-case full-volume scans (dry until the last cell) finish in < 400 ms', () => {
  const read = (x, y, z) => B(y <= 63 ? 'stone' : 'air')        // all dry: every scan reads all 1,936 cells
  const t0 = Date.now()
  for (let i = 0; i < 16; i++) volumeWet(read, i * 20, 64, 0)
  const ms = Date.now() - t0
  assert.ok(ms < 400, `16 full scans took ${ms} ms`)
})
await t('R11 landingCheck uses the SAME volume: inside + wet + region still dry = the G5f case; outside is not', () => {
  const tgt = { x: 0, y: 64, z: 0 }
  const dry = landingCheck(world(), { x: 1.5, y: 64, z: 0.5 }, tgt)
  assert.deepEqual([dry.in_region, dry.wet, dry.region_dry_now], [1, 0, 1])
  const wetFeet = landingCheck(world({ '1,64,0': 'water' }), { x: 1.5, y: 64, z: 0.5 }, tgt)
  assert.equal(wetFeet.wet, 1); assert.equal(wetFeet.region_dry_now, 0)      // the world changed: the volume reads wet now
  const out = landingCheck(world({ '20,64,0': 'water' }), { x: 20.5, y: 64, z: 0.5 }, tgt)
  assert.deepEqual([out.in_region, out.wet], [0, 1])
})
// ---- mutants: each must make a test above fail for its own reason
await t('M1 mutant: region shrunk to 2 -> R2/R3 would pass a 4-off bank (killed)', async () => {
  await withMutant(REL, 'export const RELOCATE_REGION = 5', 'export const RELOCATE_REGION = 2', async m => {
    assert.equal(m.dryTarget(world({ '5,63,0': 'water' }), 0, 0, 64).ok, true)
  })
})
await t('M2 mutant: unknown cells read as dry -> R4 (killed)', async () => {
  await withMutant(REL, "if (b == null) return 'unknown'", 'if (b == null) continue', async m => {
    assert.equal(m.dryTarget(world({}, { unloadedX: 3 }), 0, 0, 64).ok, true)
  })
})
await t('M4 mutant: the far band dropped (dy0 = -3) -> R3/R3b (killed)', async () => {
  await withMutant(REL, 'export const RELOCATE_DY0 = -8', 'export const RELOCATE_DY0 = -3', async m => {
    assert.equal(m.dryTarget(world({ '2,58,0': 'water', '2,59,0': 'stone' }), 0, 0, 64).ok, true)
  })
})
await t('M3 mutant: ice dropped from the floor rule -> R2 (killed)', async () => {
  await withMutant(REL, "const BAD_FLOOR = /^(ice|packed_ice|blue_ice|frosted_ice|magma_block)$|_leaves$/", "const BAD_FLOOR = /^(magma_block)$|_leaves$/", async m => {
    const read = world(riverCells(30, 60, -3, 3)); const r = m.dryTarget(read, 45, 0, 64)
    assert.notEqual(r.why, 'floor')
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
