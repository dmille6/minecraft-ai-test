// CIVIC-01: THE TOWN'S LANDMARKS (bots/src/civic.mjs; owner 11-09 "a catalogue (clock tower, fountain, lighthouse, statue, park or plaza,
// well house, market square) ... seeded variety ... prove every style on Paper"). Pure: the looks and their codes; every look's
// blueprint PROVEN BUILDABLE by the bots' own siting proof (buildsite.mjs proveSite) on a flat field in all four orientations; the
// interior walked to; the pad's rim first; enclosed and high cells by reach; the spiral climbable; the bills; the stock check; the
// anchors; loadBlueprint generating the ids; the project plots (shop.mjs) and the siting branch (skills.mjs, anchored).
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const C = await import('../src/civic.mjs')
const B = await import('../src/buildsite.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const ALL = C.CIVIC_ORDER.flatMap(k => C.civicLooks(k))

await t('THE CATALOGUE: seven kinds, every look a valid id, its code read back; a bad code is no look', () => {
  assert.deepStrictEqual([...C.CIVIC_ORDER].sort(), ['B', 'F', 'H', 'L', 'M', 'P', 'S'])
  assert.ok(ALL.length >= 14, `${ALL.length} looks`)
  for (const id of ALL) { assert.ok(C.isCivicBlueprint(id), id); assert.ok(C.civicLookOf(id), id) }
  assert.strictEqual(C.civicLookOf('civic@1-Fxb'), null); assert.strictEqual(C.civicLookOf('civic@1-F'), null); assert.strictEqual(C.civicLookOf('cottage@2-Csg0c'), null)
  for (const k of C.CIVIC_ORDER) assert.ok(C.CIVIC_KINDS[k].metric, `${k} declares its effect metric (owner 11-06)`)
})
await t('SEEDED VARIETY: a town\'s look is fixed by its key; different towns get different looks', () => {
  assert.strictEqual(C.civicLookFor('B', 'showcase/civicB'), C.civicLookFor('B', 'showcase/civicB'))
  const seen = new Set(Array.from({ length: 40 }, (_, i) => C.civicLookFor('B', `town${i}/civicB`)))
  assert.ok(seen.size >= 3, `${seen.size} belfry looks over 40 towns`)
})
await t('THE LOOK THE STOCK COVERS: the seeded look when it can be built, else the next of the kind that can (11-09: no stone-brick stairs yet)', () => {
  const seeded = C.civicLookFor('F', 'showcase/civicF')
  assert.strictEqual(C.civicLookForStock('F', 'showcase/civicF', () => true), seeded)
  const noStairs = id => !Object.keys(C.civicBill(B.loadBlueprint(id))).includes('stone_brick_stairs')
  const got = C.civicLookForStock('F', 'showcase/civicF', noStairs)
  assert.ok(noStairs(got), got)
  assert.strictEqual(C.civicLookForStock('F', 'showcase/civicF', () => false), seeded, 'none buildable: the seeded one (its siting waits)')
})
await t('loadBlueprint GENERATES a civic id (never a file); the blueprint has the build machinery\'s shape', () => {
  for (const id of ALL) {
    const bp = B.loadBlueprint(id)
    assert.strictEqual(bp.id, id)
    assert.ok(bp.footprint.u > 0 && bp.segments.length && bp.cells.length && bp.interior.length, `${id} shape`)
    for (const c of bp.cells) assert.ok(bp.palette[c.role]?.length, `${id} ${c.role} has a palette`)
    for (const s of bp.segments) for (const d of s.deps) assert.ok(bp.segments.some(q => q.seg === d), `${id} dep ${d}`)
    assert.strictEqual(new Set(bp.cells.map(c => `${c.u},${c.v},${c.y}`)).size, bp.cells.length, `${id} no two cells in one place`)
  }
})
await t('THE PAD\'S RIM FIRST (Paper 11-09: a pad laid from the middle out walled its builder off its outside stands)', () => {
  for (const id of ALL) {
    const bp = B.loadBlueprint(id)
    const rim = bp.cells.filter(c => c.y === 0 && (c.u === 0 || c.v === 0 || c.u === bp.footprint.u - 1 || c.v === bp.footprint.v - 1))
    assert.ok(rim.length && rim.every(c => c.seg === 'rim0'), id)
    assert.strictEqual(bp.segments[0].seg, 'rim0')
    assert.ok(bp.segments[1].deps.includes('rim0'))
  }
})
await t('BY REACH: every cell 3+ over the pad and every ENCLOSED cell (Paper 11-09: the statue\'s top in its ring of steps) is blind', () => {
  for (const id of ALL) {
    const bp = B.loadBlueprint(id)
    const occ = new Set(bp.cells.map(c => `${c.u},${c.v},${c.y}`))
    for (const c of bp.cells) {
      const enclosed = c.y >= 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => occ.has(`${c.u + a},${c.v + b},${c.y}`))
      if (c.y >= 3 || enclosed) assert.ok(c.blind, `${id} ${c.role}@${c.u},${c.v},${c.y}`)
    }
  }
})
await t('THE SPIRAL: from the doorway\'s inside cell round the newel, one up a step, each the next one\'s neighbour, head room over every step', () => {
  const st = C.spiralSteps(10)
  assert.deepStrictEqual(st[0], [1, 1, 1])
  for (let i = 1; i < st.length; i++) { const [a, b] = [st[i - 1], st[i]]; assert.strictEqual(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1); assert.strictEqual(b[2], a[2] + 1) }
  // eight to a turn: the step above a step is 8 higher (head room 7)
  for (const s of st) for (const q of st) if (q !== s && q[0] === s[0] && q[1] === s[1]) assert.ok(Math.abs(q[2] - s[2]) >= 8)
})
await t('PROVEN BUILDABLE (buildsite.mjs proveSite, the bots\' own order, stands, faces, aims and reach) on a flat field, every look, four orientations', () => {
  const G = 69
  const read = (x, y, z) => (y > G ? { name: 'air', boundingBox: 'empty' } : { name: y === G ? 'grass_block' : 'dirt', boundingBox: 'block' })
  const home = { x: 0, y: G + 1, z: 0 }
  const bad = []
  for (const id of ALL) {
    const bp = B.loadBlueprint(id)
    for (const orient of ['N', 'E', 'S', 'W']) {
      const r = B.proveSite(read, home, bp, { anchor: { x: 12, z: -2 }, s: G + 1, orient, clear: [], fill: [] }, { stood: [[0, G + 1, 0]], domain: () => true, walkR: 48 })
      if (!r.ok) bad.push(`${id}/${orient}: ${r.why} ${r.detail ?? ''}`)
    }
  }
  assert.deepStrictEqual(bad, [])
})
await t('THE BILL AND THE STOCK: each role\'s first name; a later name of the role covers a shortfall; short names the first name', () => {
  const bp = B.loadBlueprint('civic@1-Fcb')
  const bill = C.civicBill(bp)
  assert.ok(bill.deepslate_bricks > 30 && bill.lantern === 5, JSON.stringify(bill))
  assert.strictEqual(C.civicStockOk(bp, { stone_bricks: 1e4, deepslate_bricks: 1e4, polished_andesite: 1e3, stone_brick_wall: 100, chiseled_stone_bricks: 10, lantern: 10 }).ok, true)
  const r = C.civicStockOk(bp, { stone_bricks: 1e4, cobblestone_wall: 100, torch: 10 })
  assert.strictEqual(r.ok, true, 'every role has a stone-brick, cobble-wall or torch fallback: ' + JSON.stringify(r.short))
  assert.deepStrictEqual(C.civicStockOk(bp, {}).ok, false)
})
await t('THE ANCHORS: the plaza at home, the cross by the storehouse, the belfry by the town hall (else the extension), the pavilion in the park, the lighthouse at the road\'s end or none', () => {
  const home = { x: 0, z: 0 }
  assert.deepStrictEqual(C.civicNear('F', { home }), [0, 0])
  assert.deepStrictEqual(C.civicNear('M', { home, recs: { storehouse: { box: [-15, -4, -8, 3] } } }), [-12, -1])
  assert.deepStrictEqual(C.civicNear('B', { home, recs: { wallext: { interior: [-34, -83, 29, -26] } } }), [-3, -55])
  assert.deepStrictEqual(C.civicNear('B', { home, recs: { townhall: { box: [-16, -63, -4, -45] }, wallext: { interior: [0, 0, 2, 2] } } }), [-10, -54])
  assert.deepStrictEqual(C.civicNear('P', { home, park: [-41, 24, -34, 32] }), [-38, 28])
  assert.deepStrictEqual(C.civicNear('H', { home, well: [12, 73, 7] }), [12, 7])
  assert.strictEqual(C.civicNear('L', { home }), null)
  assert.deepStrictEqual(C.civicNear('L', { home, recs: { road: { instances: [{ box: [-1, -86, 1, -81] }] } } }), [0, -84])
})
await t('THE SWITCH AND THE PLOTS: on in the showcase, off on the fleet unless named; one plot per kind in the build order', () => {
  assert.strictEqual(C.civicOn({}, 'showcase'), true); assert.strictEqual(C.civicOn({}, 'hive-a'), false)
  assert.strictEqual(C.civicOn({ CIVIC_POOLS: 'hive-a' }, 'hive-a'), true); assert.strictEqual(C.civicOn({ CIVIC: 'off' }, 'showcase'), false)
  assert.deepStrictEqual([...C.CIVIC_PLOTS], C.CIVIC_ORDER.map(k => `civic${k}`))
  assert.strictEqual(C.civicKindOf('civicB'), 'B'); assert.strictEqual(C.civicKindOf('wall'), null)
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
const BS = strip(readFileSync(new URL('../src/buildsite.mjs', import.meta.url), 'utf8'))
await t('WIRED: the plots in PROJECTS each after the last (shop.mjs), the siting branch and its wait (skills.mjs), the generated blueprint (buildsite.mjs)', () => {
  assert.ok(/\.\.\.CIVIC_PLOTS\.map\(\(plot, i\) => Object\.freeze\(\{ plot, blueprint: civicLooks\(CIVIC_ORDER\[i\]\)\[0\], after: i \? CIVIC_PLOTS\[i - 1\] : PATHS_PLOT, builders: 2 \}\)\)/.test(SH))
  assert.ok(/isCivicPlot\(p\.plot\) \? civic && wall && paths && on/.test(SH))
  assert.ok(/\} else if \(isCivicPlot\(plot\)\) \{\s*\n\s*const ss = await civicSiteFor\(bot/.test(SK))
  assert.ok(/const SITED_APART = new Set\(\[COTTAGE_PLOT, TOWNHALL_PLOT, \.\.\.CIVIC_PLOTS\]\)/.test(SK) && /if \(!SITED_APART\.has\(plot\) && plot !== STORE_PLOT/.test(SK), 'never the generic siting')
  assert.ok(/isCivicBlueprint\(id\) \? civicBlueprint\(id\) :/.test(BS))
})

console.log(`\ncivic: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
