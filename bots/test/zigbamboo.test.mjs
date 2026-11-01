// ZIGBAMBOO (fleetbuild-01, 11-01): bamboo grown into open ziggurat foundation cells after siting. Measured on the fleet's region
// copies: hive-b F-E 3 of 3 open cells bamboo (`blocked: F-E: 3 open, 0 placeable now` for 24 h, 545/4498), placebo-c F-E 9 of 9
// (848/7340), hive-a F-E 2 of 6, isolated-a/c/d F-E and F-S; every upper tier waits on the foundation. ZIG_FOREIGN had no bamboo,
// so the visit neither dug nor placed there. The fix: ziggurat.mjs ZIG_FOREIGN_GROWN (+ bamboo, sugar cane), the monument visit's
// foreign class unless ZIGBAMBOO=off. Behaviour on the fake server (runVisit), the control with the old class, and the wiring.
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const Z = await import('../src/ziggurat.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
// a 3x3 skin course at G+1 (one segment); its east-edge middle cell holds a bamboo stalk 4 tall (the stalk above is no record
// cell; its east face open, as the live cells' sides are: air, grass)
function scene (plant = 'bamboo') {
  const cells = [], srv = server()
  for (let x = 10; x <= 12; x++) for (let z = 9; z <= 11; z++) {
    cells.push({ at: [x, G + 1, z], role: 'skin', seg: 'F-E' })
    if (x === 12 && z === 10) { for (let y = G + 1; y <= G + 4; y++) srv.set([x, y, z], plant) } else srv.set([x, G + 1, z], 'cobblestone')
  }
  return { srv, rec: { v: 1, plot: 'monument', blueprint: 'ziggurat@1', cells, clear: [], replant: [], segments: [{ seg: 'F-E', deps: [] }] } }
}
function project (record, foreign) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/zigbamboo-`)
  const key = PJ.projKey(HOME, 'monument')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const sl = PJ.takeSlot(dir, key, 'A', 2)
  return { dir, key, me: 'A', home: HOME, stood: [], record, recordGen: pub.gen, palette: Z.ZIG_PALETTE, slot: sl.slot, slotGen: sl.gen,
    domain: () => true, walkR: 40, foreign, blockLayer: false, stands: { pending: null, bans: {} } }
}
const done = (srv, rec) => rec.cells.every(c => R.cellDone(srv.read(...c.at), Z.ZIG_PALETTE, c.role))
const run = async (foreign, plant) => {
  const { srv, rec } = scene(plant), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  const p = project(rec, foreign)
  const stops = []
  for (let v = 0; v < 3 && !done(srv, rec); v++) stops.push((await R.runVisit(p, e, { maxSteps: 400 })).stop)
  return { srv, rec, e, stops }
}

console.log('THE CLASS')
await t('ZIG_FOREIGN_GROWN = ZIG_FOREIGN + bamboo, sugar cane (never cactus); ZIG_FOREIGN unchanged', () => {
  for (const n of ['bamboo', 'sugar_cane', 'cobblestone', 'oak_sapling', 'dirt']) assert.ok(Z.ZIG_FOREIGN_GROWN.test(n), n)
  assert.ok(!Z.ZIG_FOREIGN_GROWN.test('cactus') && !Z.ZIG_FOREIGN_GROWN.test('bamboo_block') && !Z.ZIG_FOREIGN_GROWN.test('stone_bricks'))
  assert.ok(!Z.ZIG_FOREIGN.test('bamboo'), 'the old class (the rollback) has no bamboo')
  assert.strictEqual(Z.zigBambooOn({}), true)
  for (const v of ['off', '0', 'false', 'no']) assert.strictEqual(Z.zigBambooOn({ ZIGBAMBOO: v }), false)
})
console.log('THE VISIT (runVisit on the fake server)')
await t('CONTROL (ZIG_FOREIGN, the fleet today): the bamboo cell is never dug -- `blocked` every visit, the course open', async () => {
  const { srv, rec, stops } = await run(Z.ZIG_FOREIGN)
  assert.ok(!done(srv, rec))
  assert.strictEqual(srv.read(12, G + 1, 10).name, 'bamboo')
  assert.deepStrictEqual(stops, ['blocked', 'blocked', 'blocked'])
})
await t('ZIG_FOREIGN_GROWN: the bamboo is dug and the cell built -- the course complete (sugar cane the same)', async () => {
  for (const plant of ['bamboo', 'sugar_cane']) {
    const { srv, rec, stops, e } = await run(Z.ZIG_FOREIGN_GROWN, plant)
    assert.ok(done(srv, rec), `${plant}: ${stops}`)
    assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'place' && d.cell?.join(',') === [12, G + 1, 10].join(',')) || R.cellDone(srv.read(12, G + 1, 10), Z.ZIG_PALETTE, 'skin'))
  }
})
console.log('THE WIRING (structural: skills.mjs, comments stripped)')
await t('the monument visit takes ZIG_FOREIGN_GROWN unless ZIGBAMBOO=off', () => {
  const code = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  assert.match(code, /foreign: zigBambooOn\(\) \? ZIG_FOREIGN_GROWN : ZIG_FOREIGN, blockLayer: false, feetIn: zigFeetIn/)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
