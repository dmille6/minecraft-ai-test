// HOUSE-01: the town's second project (shop.mjs PROJECTS / activeProject / recordZones, buildsite.mjs projectSectors, the
// house@1 blueprint). Behaviour: which project the job works on, that a house sites clear of the workshop, beside it, with the
// doorway toward home, and that the order the workshop's completion used to silence now fires for the house.
import assert from 'node:assert'
import { createRequire } from 'node:module'

const S = await import('../src/shop.mjs')
const B = await import('../src/buildsite.mjs')
const T = await import('../src/townplan.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

const G = 69
const HOME = { x: 0, y: G + 1, z: 0 }
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
function world (cells = {}) {
  return (x, y, z) => {
    if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 40) return null
    const n = cells[`${x},${y},${z}`] ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: box(n) }
  }
}
const SECTORS = { gate: 'S', shaft: 'SW', monument: 'NW', well: 'W', farm: 'N' }
function plan ({ pavilion = 'E', taken = SECTORS } = {}) {
  return {
    v: 1, template: 'ring@1', gen: 3, prev: 2, home: HOME, s: G, mode: 'retrofit', at: 1, world: 'w',
    plots: [
      { id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G, state: 'existing', keepout: false },
      ...Object.entries(taken).map(([id, sector]) => ({ id, kind: id, sector, state: 'planned' })),
      { id: 'pavilion', kind: 'pavilion', sector: pavilion, state: pavilion ? 'planned' : 'unsited' },
    ],
    paths: [], groups: {}, transitions: [],
  }
}

// the workshop and the house (monument-01's ziggurat, the third project, has its own order test: ziggurat-project.test.mjs; the
// paths, the fourth: paths.test.mjs)
const P = S.PROJECTS.filter(p => p.plot !== 'monument' && p.plot !== 'paths' && p.plot !== 'wall' && p.plot !== 'shaft' && p.plot !== 'treefarm')   // shaft-02: town-stair.test.mjs; treefarm-04: treefarm.test.mjs
const st = (plot, exists, complete = false, damaged = false) => ({ plot, exists, complete, damaged })

await t('the project order: the workshop until it stands, then the house; repairs first; HOUSE=off is the workshop alone', () => {
  assert.strictEqual(S.activeProject([], P).plot, 'shop', 'nothing yet: the workshop')
  assert.strictEqual(S.activeProject([st('shop', true)], P).plot, 'shop', 'an open workshop')
  assert.strictEqual(S.activeProject([st('shop', true, true)], P).plot, 'house1', 'the workshop stands: the house (no record yet)')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true)], P).plot, 'house1')
  assert.strictEqual(S.activeProject([st('shop', true, true, true), st('house1', true)], P).plot, 'shop', 'a damaged workshop is repaired first')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, true, true)], P).plot, 'house1', 'a damaged house is repaired')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, true)], P).plot, 'house1', 'all stand: the last (the order reads it complete)')
  // zigfleet-01: the ziggurat is on in every pool by default, so HOUSE=off alone leaves the workshop and the ziggurat;
  // with MONUMENT off too it is the workshop alone, as before
  // shaft-02: the town stair has its own switch (SHAFT) and its own order test (town-stair.test.mjs); off here
  assert.strictEqual(S.activeProject([st('shop', true, true)], S.projectsOn(false, false, undefined, undefined, false)).plot, 'shop', 'HOUSE=off')
  assert.strictEqual(S.projectsOn(false, false, undefined, undefined, false).length, 1)
  assert.deepStrictEqual(S.projectsOn(false, true, undefined, undefined, false).map(p => p.plot), ['shop', 'monument'], 'HOUSE=off with the ziggurat on')
  assert.deepStrictEqual(S.projectsOn(false, false, undefined, undefined, true).map(p => p.plot), ['shop', 'shaft'], 'the stair is its own switch, HOUSE off or not')
})

await t('the order the completed workshop silenced fires again for the house (no record = no completion)', () => {
  const base = { on: true, shared: true, atTown: true, now: 10 ** 12, planned: true }
  assert.strictEqual(S.buildOrder({ ...base, record: { structure_complete: true }, complete: true }).skip, 'complete', 'POSITIVE CONTROL: the workshop alone')
  assert.deepStrictEqual(S.buildOrder({ ...base, record: null, complete: false }).order, { skill: 'build_shop', args: {} })
})

await t('the house blueprint: 7x7 pad, 5x5 shell, an open 1x2 doorway at the front, a torch inside, the workshop\'s segments', () => {
  const bp = B.loadBlueprint('house@1')
  assert.strictEqual(bp.id, 'house@1')
  const by = {}
  for (const c of bp.cells) by[c.seg] = (by[c.seg] ?? 0) + 1
  assert.deepStrictEqual(by, { pad: 49, ring: 23, 'wall-F': 8, 'wall-B': 10, 'wall-L': 6, 'wall-R': 6, 'roof-edge': 16, 'roof-inner': 9, 'fit-out': 1 })
  const at = new Set(bp.cells.map(c => `${c.u},${c.v},${c.y}`))
  for (const [u, v, y] of bp.doorway) assert.ok(!at.has(`${u},${v},${y}`), `the doorway cell ${u},${v},${y} stays open`)
  assert.ok(!at.has('3,0,1'), 'the step in front of the doorway stays open')
  assert.ok(bp.cells.every(c => bp.palette[c.role]), 'every role has a palette')
  assert.ok(!bp.cells.some(c => /door/.test(c.role)), 'no door block in v1: nothing seals the interior')
  const segs = new Set(bp.segments.map(s => s.seg))
  for (const c of bp.cells) assert.ok(segs.has(c.seg), `${c.seg} is a segment`)
})

await t('recordZones: each other record\'s box + PROJECT_GAP, at every height', () => {
  const z = S.recordZones([{ plot: 'shop', box: [20, 26, 28, 32] }, { plot: 'x', box: null }])
  assert.strictEqual(z.length, 1)
  assert.deepStrictEqual(z[0].box, [17, -64, 23, 31, 320, 35])
  assert.ok(T.boxMeetsZones([30, 70, 34, 30, 70, 34], z), 'inside the gap')
  assert.ok(!T.boxMeetsZones([32, 70, 34, 32, 70, 34], z), 'past the gap')
})

await t('projectSectors: the workshop\'s first, then the pavilion\'s, then the free ones, once each', () => {
  const s = B.projectSectors(plan(), 'SE').map(r => r.sector)
  assert.deepStrictEqual(s.slice(0, 2), ['SE', 'E'])
  assert.ok(!s.some(x => Object.values(SECTORS).includes(x)), 'never a sector another plot holds')
  assert.strictEqual(new Set(s).size, s.length)
})

await t('saplingAllowedAt takes a list of boxes (one per project record)', () => {
  const boxes = [S.saplingBox({ cells: [{ at: [0, 70, 0] }] }), S.saplingBox({ cells: [{ at: [20, 70, 20] }] })]
  assert.ok(!S.saplingAllowedAt(boxes, 1, 1))
  assert.ok(!S.saplingAllowedAt(boxes, 21, 19))
  assert.ok(S.saplingAllowedAt(boxes, 10, 10))
  assert.ok(S.saplingAllowedAt(null, 1, 1) && S.saplingAllowedAt([], 1, 1))
})

await t('COMPOSED: on flat ground the house sites beside the sited workshop, clear of it by the gap, doorway toward home', () => {
  const read = world()
  const ws = B.siteBlueprint(read, plan(), B.loadBlueprint('workshop@1'), { tries: 3 })
  assert.ok(ws.ok, `POSITIVE CONTROL: the workshop sites (${ws.why})`)
  const hb = B.loadBlueprint('house@1')
  const r = B.siteBlueprint(read, plan(), hb, { tries: 3, zones: S.recordZones([ws.record]), sectors: B.projectSectors(plan(), ws.record.sector), plot: 'house1' })
  assert.ok(r.ok, `the house sites (${r.why}: ${JSON.stringify(r.sectors)})`)
  assert.strictEqual(r.record.plot, 'house1')
  assert.strictEqual(r.record.blueprint, 'house@1')
  assert.strictEqual(r.record.sector, ws.record.sector, 'beside the workshop')
  const [a0, b0, a1, b1] = ws.record.box, [c0, d0, c1, d1] = r.record.box
  const gapX = Math.max(c0 - a1, a0 - c1), gapZ = Math.max(d0 - b1, b0 - d1)
  assert.ok(Math.max(gapX, gapZ) > S.PROJECT_GAP + 1, `the pads stand apart (gap ${gapX},${gapZ})`)
  assert.ok(B.facesHome(hb, HOME, { x: r.record.anchor[0], z: r.record.anchor[1] }, r.record.orient), 'the doorway faces home')
  // without the zones the house would take the workshop's own best site: the zones are what keep it clear
  const bare = B.siteBlueprint(read, plan(), hb, { tries: 3, sectors: B.projectSectors(plan(), ws.record.sector), plot: 'house1' })
  const [e0, f0, e1, f1] = bare.record.box
  assert.ok(Math.max(e0 - a1, a0 - e1, f0 - b1, b0 - f1) <= S.PROJECT_GAP + 1, 'POSITIVE CONTROL: unzoned, the house would crowd the workshop')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
