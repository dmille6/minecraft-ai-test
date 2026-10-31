// PATHS-01: THE PATHS AS THE TOWN'S FOURTH PROJECT, on real record files in a pool directory (skills.mjs shopActive, the readings
// cognitive.mjs's build order takes, the footprint refresh, mine's keep-out, a damaged path, the next project's siting zones) and
// the build_shop dispatch (a structural anchor: comments stripped, a one-character mutant unmatched).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-paths-logs-'))
process.env.BOT_NAME = 'PathBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-paths-pool-'))
delete process.env.MONUMENT; delete process.env.MONUMENT_POOLS; delete process.env.HOUSE; delete process.env.PATHS; delete process.env.PATHS_POOLS
process.env.SHAFT = 'off'   // shaft-02's town stair (the second project) has its own order test: town-stair.test.mjs
// wall-01: the wall (fifth, after the paths) has its own wiring test (wall-wiring.test.mjs); off here, so the paths stay the last project
process.env.WALL = 'off'
const SK = await import('../src/skills.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')
const P = await import('../src/paths.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const HOME = { x: 0, y: 70, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const fresh = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-paths-pool-')) }
const rec = (plot, blueprint, cells, complete, extra = {}) => PJ.publishRecord(dir(), PJ.projKey(HOME, plot), () => ({ v: 1, blueprint, plot, cells, segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}), ...extra }))
const one = (at, role = 'base') => [{ at, role, seg: 'a' }]
const shop = c => rec('shop', 'workshop@1', one([25, 71, 28]), c)
const house = c => rec('house1', 'house@1', one([30, 71, 20]), c)
const mon = c => rec('monument', 'ziggurat@1', one([-30, 70, -30], 'core'), c, { box: [-40, -40, -20, -20] })
const PATH_CELLS = [[2, 69, 8], [3, 69, 8], [2, 69, 9], [3, 69, 9], [2, 68, 10], [2, 69, 10], [3, 69, 10]]
const paths = c => rec('paths', P.PATHS_BLUEPRINT, PATH_CELLS.map(at => ({ at, role: at[0] === 2 && at[1] === 68 ? 'fill' : 'path', seg: 'P-d-0' })), c, { zones: P.pathZones(PATH_CELLS.map(a => [a[0], a[2]])) })
const me = { username: 'PathBot', blockAt: () => null }

await t('the showcase pool lists the paths fourth; a fleet pool does not', async () => {
  assert.deepStrictEqual(S.projectsOn().map(p => p.plot), ['shop', 'house1', 'monument', 'paths'])
  assert.strictEqual(S.PATHS.on, true)
  assert.strictEqual(P.pathsOn({}, 'hive-a'), false)
})
await t('ON FILES: the house and the ziggurat standing -> the paths, with no record yet (the order sites them); four slots', async () => {
  fresh(); shop(true); house(false)
  assert.strictEqual(SK.shopActive(me).plot, 'house1', 'the house first')
  fresh(); shop(true); house(true); mon(true)
  assert.strictEqual(SK.shopActive(me).plot, 'paths')
  const h = SK.shopRecordHead()
  assert.ok(h.ok); assert.strictEqual(h.head, null)
  paths(false)
  const key = PJ.projKey(HOME, 'paths')
  for (const n of ['A', 'B', 'C']) assert.ok(PJ.takeSlot(dir(), key, n, P.PATHS_BUILDERS).ok)
  assert.strictEqual(SK.shopSlotsFree({ username: 'D' }), true, 'the fourth slot')
  assert.ok(PJ.takeSlot(dir(), key, 'D', P.PATHS_BUILDERS).ok)
  assert.strictEqual(SK.shopSlotsFree({ username: 'E' }), false, 'all four held')
})
await t('THE FOOTPRINT REFRESH: each path cell and the cell above it priced (no halo), in the place keep-out; saplings off its columns + 1', async () => {
  fresh(); shop(true); house(true); mon(true); paths(false)
  const bot = { blockAt: () => null }
  SK.shopFootprintRefresh(bot)
  assert.ok(bot.shopFootprint.has('2,69,8') && bot.shopFootprint.has('2,70,8'), 'the cell and the cell above')
  assert.ok(!bot.shopFootprint.has('1,69,8') && !bot.shopFootprint.has('2,68,8'), 'no halo')
  assert.ok(bot.shopCells.has('2,70,9') && bot.shopCells.has('2,68,10'), 'above a path cell and a fill cell: the place keep-out')
  const cols = bot.shopSaplingBox.find(b => b?.cols)
  assert.ok(cols, 'the paths\' sapling guard is by column')
  assert.strictEqual(S.saplingAllowedAt(bot.shopSaplingBox, 4, 9), false, 'beside the path (+1)')
  assert.strictEqual(S.saplingAllowedAt(bot.shopSaplingBox, 10, -10), true, 'away from every record (a box would have covered the town)')
})
await t('KEEP-OUT: mine never digs a path cell', async () => {
  fresh(); shop(true); paths(false)
  assert.ok(SK.shopKeepOut().forbid({ x: 2, y: 69, z: 8 }))
  assert.strictEqual(SK.shopKeepOut().forbid({ x: 2, y: 70, z: 8 }), null)
})
await t('A COMPLETE PATH IS DAMAGED when a cell no longer reads dirt_path or stone (a block set on it turned it to dirt); dirt_path is done', async () => {
  fresh(); shop(true); house(true); mon(true); paths(true)
  const at = n => ({ blockAt: () => ({ name: n, boundingBox: n === 'air' ? 'empty' : 'block' }) })
  const r = SK.shopRecordHead().head.rec
  assert.strictEqual(r.plot, 'paths')
  assert.strictEqual(SK.shopDamaged(at('dirt_path'), r), false)
  assert.strictEqual(SK.shopDamaged(at('dirt'), r), true)
})
await t('pathsclose-01: a WAIVED path cell is no damage (the complete record closes) -- and a cell not waived still is', async () => {
  fresh(); shop(true); house(true); mon(true)
  rec('paths', P.PATHS_BLUEPRINT, PATH_CELLS.map(at => ({ at, role: at[0] === 2 && at[1] === 68 ? 'fill' : 'path', seg: 'P-d-0' })), true, { zones: P.pathZones(PATH_CELLS.map(a => [a[0], a[2]])), waived: { '3,69,9': { why: 'kept chest 3,70,9', at: 1, by: 'A' } } })
  const r = SK.shopRecordHead().head.rec
  const reads = (open, n = 'dirt') => ({ blockAt: v => ({ name: `${v.x},${v.y},${v.z}` === open ? n : 'dirt_path', boundingBox: 'block' }) })
  assert.strictEqual(SK.shopDamaged(reads('3,69,9'), r), false, 'the waived cell reads dirt: no damage')
  assert.strictEqual(SK.shopDamaged(reads('2,69,9'), r), true, 'positive control: a cell NOT waived reading dirt is damage')
  assert.strictEqual(SK.shopActive(reads('3,69,9')).plot, 'paths', 'nothing open: the last project, as before')
})
await t('THE NEXT PROJECT\'S SITING ZONES carry the path columns (+1), never a box over the town', async () => {
  fresh(); paths(false)
  const r = PJ.recordHead(dir(), PJ.projKey(HOME, 'paths')).head.rec
  const zs = S.recordZones([r])
  assert.ok(zs.length >= 1)
  const inZ = (x, z) => zs.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
  assert.ok(inZ(2, 8) && inZ(4, 10) && !inZ(10, 10) && !inZ(-20, -20))
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const SRC = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
for (const [name, re] of [
  ['build_shop dispatches the paths to their own visit', /if \(proj\.plot === PATHS_PLOT\) return buildPaths\(ctx, args, signal\)/],
  ['the paths\' visit passes the shovel\'s use to runVisit', /foreign: PATH_FOREIGN, blockLayer: false, use, overburden: pathOverburdenOf\(c\),/],
  // pathsclose-01: the visit counts a waived cell done, and the waiver is computed from the visit's refusals and the stuck map
  ['the paths\' visit counts a waived cell done', /alsoDone: q => pathWaived\(rec, q\) \}, effects/],
  ['the waiver reads the visit\'s refusals and the summed stuck map', /const due = pathWaiveDue\(rec, r\.blocked \?\? \[\], vfStuckRead\(dir, key, \{ since: Date\.now\(\) - BUILD_STUCK_FORGET_MS \+ 1 \}\)\)/],
  ['the shovel is held only through equip, never an unequip', /if \(bot\.heldItem\?\.name !== it\.name\) \{ try \{ await bot\.equip\(it, 'hand'\) \}/],
  ['a laid network with a new destination is due a visit (recordDamaged)', /if \(r\.blueprint === PATHS_BLUEPRINT && pathsExtendDue\(bot, r\)\) return true/],
  ['the visit extends the record before its completion check', /const x = extendPaths\(planReader\(bot\), base, inputs\(\)\)/],
]) {
  await t(`${name} (and a mutant of it fails)`, async () => {
    assert.ok(re.test(SRC), 'wired')
    const m = SRC.match(re)[0]
    assert.strictEqual(SRC.split(m).length, 2, 'the anchor is unique')
    assert.ok(!re.test(SRC.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant is not matched')
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
