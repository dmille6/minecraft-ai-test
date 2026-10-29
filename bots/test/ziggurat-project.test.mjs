// MONUMENT-01: THE ZIGGURAT AS THE TOWN'S THIRD PROJECT (shop.mjs PROJECTS / activeProject, skills.mjs shopActive and the readings
// cognitive.mjs's build order takes, unchanged in shape): after the workshop, ALONGSIDE the house -- a bot whose first open project
// has no free admission slot works the next; the ziggurat has three slots; mine's and gather's keep-out carries every project's
// cells and names the monument's; the house still comes first when it has room. With the monument off (any pool but the
// showcase's by default) the project list is the workshop and the house, as before. On real record files in a pool directory.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-zigproj-logs-'))
process.env.BOT_NAME = 'ZigBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-zigproj-pool-'))
delete process.env.MONUMENT; delete process.env.MONUMENT_POOLS; delete process.env.HOUSE
const SK = await import('../src/skills.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')
const Z = await import('../src/ziggurat.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const HOME = { x: 0, y: 70, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const fresh = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-zigproj-pool-')) }
const rec = (plot, blueprint, cell, complete, extra = {}) => PJ.publishRecord(dir(), PJ.projKey(HOME, plot), () => ({ v: 1, blueprint, plot, cells: [{ at: cell, role: plot === 'monument' ? 'core' : 'base', seg: 'a' }], segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}), ...extra }))
const shop = c => rec('shop', 'workshop@1', [25, 71, 28], c)
const house = c => rec('house1', 'house@1', [30, 71, 20], c)
const mon = c => rec('monument', Z.MONUMENT_BLUEPRINT, [-30, 70, -30], c, { box: [-40, -40, -20, -20] })
const holdHouse = () => { for (const n of ['X', 'Y']) assert.ok(PJ.takeSlot(dir(), PJ.projKey(HOME, 'house1'), n, S.BUILDERS_MAX).ok) }
const me = { username: 'ZigBot', blockAt: () => null }

await t('the showcase pool lists three projects; the ziggurat comes after the workshop, with three builders', async () => {
  assert.deepStrictEqual(S.projectsOn().map(p => p.plot), ['shop', 'house1', 'monument'])
  const m = S.PROJECTS.find(p => p.plot === 'monument')
  assert.strictEqual(m.after, 'shop'); assert.strictEqual(S.buildersOf(m), 3); assert.strictEqual(S.buildersOf(S.PROJECTS[0]), 2)
})
await t('a FLEET pool (monument off by default): the workshop and the house only -- the old order, unchanged', async () => {
  const run = env => execFileSync(process.execPath, ['--input-type=module', '-e', "const S = await import('./src/shop.mjs'); console.log(S.projectsOn().map(p => p.plot).join(','))"], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
  assert.strictEqual(run({ MEMORY_POOL: 'hive-a' }), 'shop,house1')
  assert.strictEqual(run({ MEMORY_POOL: 'showcase', MONUMENT: 'off' }), 'shop,house1', 'MONUMENT=off is the rollback')
  assert.strictEqual(run({ MEMORY_POOL: 'hive-a', MONUMENT: 'on' }), 'shop,house1,monument')
})
await t('the pure order: the house first while it has a slot for this bot; the ziggurat when the house is full; repairs first', async () => {
  const P = S.projectsOn()
  const st = (plot, exists, complete = false, damaged = false, free) => ({ plot, exists, complete, damaged, ...(free === undefined ? {} : { free }) })
  assert.strictEqual(S.activeProject([st('shop', true)], P).plot, 'shop', 'an open workshop: nothing else')
  assert.strictEqual(S.activeProject([st('shop', true, true)], P).plot, 'house1')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, false, false, false)], P).plot, 'monument', 'the house full: the ziggurat')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, false, false, false), st('monument', true, false, false, false)], P).plot, 'house1', 'both full: the first (the order skips slots_full)')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, true)], P).plot, 'monument')
  assert.strictEqual(S.activeProject([st('shop', true, true), st('house1', true, true), st('monument', true, true)], P).plot, 'monument', 'all stand: the last')
  assert.strictEqual(S.activeProject([st('shop', true, true, true), st('house1', true), st('monument', true)], P).plot, 'shop', 'a damaged workshop first')
})
await t('ON FILES: the workshop open -> the workshop; complete -> the house; the house\'s two slots held by others -> the ziggurat', async () => {
  fresh(); shop(false)
  assert.strictEqual(SK.shopActive(me).plot, 'shop')
  fresh(); shop(true)
  assert.strictEqual(SK.shopActive(me).plot, 'house1')
  house(false); holdHouse()
  assert.strictEqual(SK.shopActive(me).plot, 'monument', 'the leases are read fresh, past the 60-s record cache')
  const h = SK.shopRecordHead()
  assert.ok(h.ok); assert.strictEqual(h.head, null, 'no ziggurat record yet: the order sites it')
})
await t('ON FILES: the ziggurat open -> three admission slots; a fourth bot is refused; a holder may come back', async () => {
  fresh(); shop(true); house(true); mon(false)
  assert.strictEqual(SK.shopActive(me).plot, 'monument')
  const key = PJ.projKey(HOME, 'monument')
  for (const n of ['A', 'B']) assert.ok(PJ.takeSlot(dir(), key, n, 3).ok)
  assert.strictEqual(SK.shopSlotsFree({ username: 'C' }), true, 'the third slot')
  assert.ok(PJ.takeSlot(dir(), key, 'C', 3).ok)
  assert.strictEqual(SK.shopSlotsFree({ username: 'D' }), false, 'all three held')
  assert.strictEqual(SK.shopSlotsFree({ username: 'A' }), true)
})
await t('KEEP-OUT: gather\'s and mine\'s record cells are EVERY project\'s cells; mine names the monument\'s', async () => {
  fresh(); shop(true); house(false); mon(false)
  const s = SK.shopCellsNow()
  assert.ok(s.cells.has('25,71,28') && s.cells.has('30,71,20') && s.cells.has('-30,70,-30'))
  const ko = SK.shopKeepOut()
  assert.strictEqual(ko.forbid({ x: -30, y: 70, z: -30 }), 'monument')
  assert.strictEqual(ko.forbid({ x: 25, y: 71, z: 28 }), 'workshop')
  assert.strictEqual(ko.forbid({ x: 0, y: 70, z: 0 }), null)
})
await t('THE FOOTPRINT REFRESH: the walks\' price, the place keep-out and the sapling guard cover the ziggurat too', async () => {
  fresh(); shop(true); mon(false)
  // the ziggurat's cell BUILT: priced; open (air): not (zigFootprint) -- the workshop's +1 halo as before
  const built = { blockAt: p => (p.x === -30 && p.y === 70 && p.z === -30 ? { name: 'cobblestone', boundingBox: 'block' } : null) }
  SK.shopFootprintRefresh(built)
  assert.ok(built.shopFootprint.has('-30,70,-30') && built.shopFootprint.has('25,71,28') && built.shopFootprint.has('25,72,28'))
  assert.ok(!built.shopFootprint.has('-30,71,-30'), 'no halo on the ziggurat')
  const bot = { blockAt: p => (p.x === -30 && p.y === 70 && p.z === -30 ? { name: 'air', boundingBox: 'empty' } : null) }   // the rest unloaded
  SK.shopFootprintRefresh(bot)
  assert.ok(!bot.shopFootprint.has('-30,70,-30'), 'an open ziggurat cell takes the pathfinder\'s scaffold')
  assert.ok(bot.shopCells.has('-30,70,-30'))
  assert.ok(Array.isArray(bot.shopSaplingBox) && bot.shopSaplingBox.length === 2)
})
await t('a COMPLETE ziggurat is judged by its own palette (ZIG_PALETTE: dirt in the core is done, a hole is damage)', async () => {
  fresh(); shop(true); house(true); mon(true)
  const at = (n) => ({ blockAt: () => ({ name: n, boundingBox: n === 'air' ? 'empty' : 'block' }) })
  const r = SK.shopRecordHead().head.rec
  assert.strictEqual(r.plot, 'monument')
  assert.strictEqual(SK.shopDamaged(at('dirt'), r), false)
  assert.strictEqual(SK.shopDamaged(at('air'), r), true)
})

await t('THE SPLIT FOUNDATION\'S TOMBSTONE (Codex r3/r4): a live old-build seg-F holder makes the split visit wait; then the tombstone holds seg-F and an old build can never take it', async () => {
  fresh()
  const key = PJ.projKey(HOME, 'monument')
  const now = Date.now()
  assert.ok(PJ.takeLease(dir(), key, 'seg-F', 'OldBot', { now }).ok, 'an old build takes the single F lease')
  assert.deepStrictEqual(SK.monumentSplitGate(dir(), key, now + 1000), { ok: false, holder: 'OldBot' }, 'the split visit waits')
  PJ.releaseLease(dir(), key, 'seg-F', 'OldBot', PJ.leaseState(dir(), key, 'seg-F').gen)
  assert.strictEqual(SK.monumentSplitGate(dir(), key, now + 2000).ok, true, 'released: the tombstone is taken')
  const g = PJ.leaseState(dir(), key, 'seg-F').gen
  assert.strictEqual(PJ.takeLease(dir(), key, 'seg-F', 'OldBot2', { now: now + 3000 }).ok, false, 'an old build can no longer take seg-F')
  assert.strictEqual(SK.monumentSplitGate(dir(), key, now + 4000).ok, true, 'the next split visit passes')
  assert.strictEqual(PJ.leaseState(dir(), key, 'seg-F').gen, g, 'without writing another generation')
  assert.strictEqual(PJ.takeLease(dir(), key, 'seg-F', 'OldBot3', { now: now + 20 * 24 * 3600_000 }).ok, false, 'still held 20 days on')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
