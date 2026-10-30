// WALL-01: THE WALL AS THE TOWN'S FIFTH PROJECT, on real record files in a pool directory (skills.mjs shopActive, the slots, the
// footprint refresh -- every wall cell priced, no halo, saplings off its columns + 1 --, the damage test, the next project's siting
// zones, the bag rule) and the build_shop dispatch and the visit's runVisit knobs (structural anchors: comments stripped, a
// one-character mutant unmatched).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-wall-logs-'))
process.env.BOT_NAME = 'WallBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-wall-pool-'))
delete process.env.MONUMENT; delete process.env.MONUMENT_POOLS; delete process.env.HOUSE; delete process.env.PATHS; delete process.env.PATHS_POOLS
delete process.env.WALL; delete process.env.WALL_POOLS
const SK = await import('../src/skills.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')
const W = await import('../src/wall.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const HOME = { x: 0, y: 70, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const fresh = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-wall-pool-')) }
const rec = (plot, blueprint, cells, complete, extra = {}) => PJ.publishRecord(dir(), PJ.projKey(HOME, plot), () => ({ v: 1, blueprint, plot, cells, segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}), ...extra }))
const one = (at, role = 'base') => [{ at, role, seg: 'a' }]
const shop = c => rec('shop', 'workshop@1', one([25, 71, 28]), c)
const house = c => rec('house1', 'house@1', one([30, 71, 20]), c)
const mon = c => rec('monument', 'ziggurat@1', one([-30, 70, -30], 'core'), c, { box: [-40, -40, -20, -20] })
const paths = c => rec('paths', 'paths@1', [{ at: [2, 69, 8], role: 'path', seg: 'P-d-0' }], c, { zones: [{ box: [1, -64, 7, 3, 320, 9], why: 'project:paths' }] })
const WALL_CELLS = [[-12, 70, -12], [-12, 71, -12], [-12, 72, -12], [-11, 70, -11], [-11, 71, -11], [-10, 70, -10]]
const wall = c => rec('wall', W.WALL_BLUEPRINT, WALL_CELLS.map((at, i) => ({ at, role: i < 3 ? 'wall' : 'step', seg: 'W-00' })), c, { zones: W.zoneBoxes(new Set(WALL_CELLS.flatMap(([x, , z]) => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => `${x + dx},${z + dz}`))))) })
const me = { username: 'WallBot', blockAt: () => null }

await t('the showcase pool lists the wall fifth, after the paths; a fleet pool does not; WALL=off and PATHS=off are rollbacks', async () => {
  assert.deepStrictEqual(S.projectsOn().map(p => p.plot), ['shop', 'house1', 'monument', 'paths', 'wall'])
  const w = S.PROJECTS.find(p => p.plot === 'wall')
  assert.ok(w.after === 'paths' && S.buildersOf(w) === W.WALL_BUILDERS && w.blueprint === W.WALL_BLUEPRINT)
  assert.ok(S.LIGHT_PLOTS.has('wall'), 'an unsited wall needs 2 free bag slots: it builds from the bags\' cobblestone')
  const run = env => execFileSync(process.execPath, ['--input-type=module', '-e', "const S = await import('./src/shop.mjs'); console.log(S.projectsOn().map(p => p.plot).join(','))"], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
  assert.strictEqual(run({ MEMORY_POOL: 'hive-a' }), 'shop,house1')
  assert.strictEqual(run({ MEMORY_POOL: 'showcase', WALL: 'off' }), 'shop,house1,monument,paths')
  assert.strictEqual(run({ MEMORY_POOL: 'showcase', PATHS: 'off' }), 'shop,house1,monument', 'never without the paths it follows')
})
await t('ON FILES: the paths laid -> the wall, with no record yet (the order sites it); before that the paths; four slots', async () => {
  fresh(); shop(true); house(true); mon(true); paths(false)
  assert.strictEqual(SK.shopActive(me).plot, 'paths')
  fresh(); shop(true); house(true); mon(true); paths(true)
  assert.strictEqual(SK.shopActive(me).plot, 'wall')
  const h = SK.shopRecordHead()
  assert.ok(h.ok); assert.strictEqual(h.head, null)
  wall(false)
  const key = PJ.projKey(HOME, 'wall')
  for (const n of ['A', 'B', 'C', 'D']) assert.ok(PJ.takeSlot(dir(), key, n, W.WALL_BUILDERS).ok)
  assert.strictEqual(SK.shopSlotsFree({ username: 'E' }), false, 'all four held')
})
await t('UPKEEP WAITS (LIVE 10-30): a finished ziggurat only DUE a tidy comes after the open wall; a damaged one is repaired first', async () => {
  const L = S.projectsOn(true, true, true, true)
  const st = (mon, wallDone = false) => [{ plot: 'shop', exists: true, complete: true }, { plot: 'house1', exists: true, complete: true }, { plot: 'monument', exists: true, complete: true, ...mon }, { plot: 'paths', exists: true, complete: true }, { plot: 'wall', exists: true, complete: wallDone }]
  assert.strictEqual(S.activeProject(st({ due: true }), L).plot, 'wall', 'a tidy due waits behind the wall')
  assert.strictEqual(S.activeProject(st({ damaged: true }), L).plot, 'monument', 'a broken cell is repaired first')
  assert.strictEqual(S.activeProject(st({ due: true }, true), L).plot, 'monument', 'with the wall standing, the tidy gets its visit')
  assert.strictEqual(S.activeProject(st({}, true), L).plot, 'wall', 'everything stands: the last project, quiet')
})
await t('THE FOOTPRINT REFRESH: every wall cell priced, no halo; the cells in the place keep-out; saplings off its columns + 1, not a box', async () => {
  fresh(); shop(true); house(true); mon(true); paths(true); wall(false)
  const bot = { blockAt: () => null }
  SK.shopFootprintRefresh(bot)
  assert.ok(bot.shopFootprint.has('-12,72,-12') && bot.shopFootprint.has('-10,70,-10'))
  assert.ok(!bot.shopFootprint.has('-12,73,-12') && !bot.shopFootprint.has('-13,70,-12'), 'no halo')
  assert.ok(bot.shopCells.has('-11,71,-11'))
  assert.ok(!S.saplingAllowedAt(bot.shopSaplingBox, -13, -12) && !S.saplingAllowedAt(bot.shopSaplingBox, -9, -9))
  assert.ok(S.saplingAllowedAt(bot.shopSaplingBox, 0, 0), 'the town inside the wall is not a sapling keep-out')
})
await t('A DAMAGED WALL wants a visit (a loaded cell no longer cobblestone); an intact one does not', async () => {
  fresh(); shop(true); house(true); mon(true); paths(true); wall(true)
  const r = PJ.recordHead(dir(), PJ.projKey(HOME, 'wall')).head.rec
  const built = { blockAt: p => ({ name: 'cobblestone', boundingBox: 'block', position: p }) }
  assert.strictEqual(SK.shopDamaged(built, r), false)
  const broken = { blockAt: p => ({ name: p.x === -12 && p.y === 71 ? 'air' : 'cobblestone', boundingBox: p.x === -12 && p.y === 71 ? 'empty' : 'block', position: p }) }
  assert.strictEqual(SK.shopDamaged(broken, r), true)
})
await t('THE NEXT PROJECT\'S SITING ZONES carry the wall columns (+1), never a box over the town', async () => {
  fresh(); wall(false)
  const r = PJ.recordHead(dir(), PJ.projKey(HOME, 'wall')).head.rec
  const zs = S.recordZones([r])
  const inZ = (x, z) => zs.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
  assert.ok(inZ(-12, -12) && inZ(-13, -13) && inZ(-9, -9) && !inZ(0, 0) && !inZ(-20, -20))
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const SRC = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
for (const [name, re] of [
  ['build_shop dispatches the wall to its own visit', /if \(proj\.plot === WALL_PLOT\) return buildWall\(ctx, args, signal\)/],
  ['the wall\'s visit runs with its own palette, foreign set, walk radius and clear bound', /walkR: wallWalkR\(rec, home\), foreign: WALL_FOREIGN, blockLayer: false, clearMax: WALL_CLEAR_MAX \}, effects/],
  ['the wall bills its open cells from town above the floor a project draw meets (the bag\'s spare first)', /const bill = billOf\(rec, palette, read, \{ done: buildCellDone, inTown: zigBillInTown\(bot, town\) \}\)\n {4}const need = needFromTown\(bill, spare0\)/],
  ['the wall is sited ONCE (published only when there is no record)', /const pub = publishRecord\(dir, key, cur => \(cur \? null : \{ \.\.\.record, state: 'open' \}\), \{ by: me \}\)\n[^\n]*\n {4}if \(pub\.result === 'accepted'\) \{ try \{ logEvent\(\{ kind: 'build', status: 'success', snapshot: snapshot\(bot\), detail: buildRowDetail\(\{ project: WALL_PLOT, op: 'sited'/],
  ['the wall\'s sapling keep-out is its columns', /r\.blueprint === WALL_BLUEPRINT \? wallSaplingCols\(r\)/],
  ['shopActive reads a tidy as upkeep (due), never as damage', /const damaged = complete && b \? recordDamaged\(b, rec, \{ tidy: false \}\) : false\n {8}return \{ plot: p\.plot, exists: !!rec, complete, damaged, due: complete && b && !damaged \? recordDamaged\(b, rec\) : false \}/],
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
