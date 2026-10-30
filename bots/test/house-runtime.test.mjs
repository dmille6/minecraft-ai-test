// HOUSE-01 at runtime (skills.mjs): the record files decide the project the job works on, and the keep-outs and the footprint
// price cover every project's record. Real files in a temp pool dir (POOL_STATE_DIR), the real skills module.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rt-'))
process.env.POOL_STATE_DIR = dir
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rt-logs-'))
process.env.BOT_NAME = 'HouseBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
const { config } = await import('../src/config.mjs')
const P = await import('../src/buildproj.mjs')
const K = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const shopKey = P.projKey(home, 'shop'), houseKey = P.projKey(home, 'house1')
const rec = (plot, x, complete) => ({ v: 1, blueprint: plot === 'shop' ? 'workshop@1' : 'house@1', plot, box: [x, 30, x + 2, 32], sector: 'SE', structure_complete: complete, state: complete ? 'complete' : 'open',
  cells: [{ at: [x, 70, 30], role: 'base', seg: 'pad' }, { at: [x + 2, 70, 32], role: 'base', seg: 'pad' }] })
const bot = { username: 'T', blockAt: () => null }

await t('no records: the workshop is the project', () => {
  assert.strictEqual(K.shopActive(bot).plot, 'shop')
  assert.strictEqual(K.shopRecordHead().head, null)
})
await t('an open workshop: still the workshop', () => {
  assert.strictEqual(P.publishRecord(dir, shopKey, () => rec('shop', 20, false)).result, 'accepted')
  assert.strictEqual(K.shopActive(bot).plot, 'shop')
  assert.strictEqual(K.shopRecordHead().head.rec.plot, 'shop')
})
await t('the workshop completes: the house is the project, with no record yet (so the order fires and siting runs)', () => {
  assert.strictEqual(P.publishRecord(dir, shopKey, cur => ({ ...cur, structure_complete: true, state: 'complete', completeAt: 1 })).result, 'accepted')
  assert.strictEqual(K.shopActive(bot).plot, 'house1', 're-read on the record generation change, not after 60 s')
  assert.strictEqual(K.shopRecordHead().head, null)
})
await t('the house sited: the keep-out cells, the footprint and the sapling boxes cover BOTH records; the stations stay the workshop\'s', () => {
  assert.strictEqual(P.publishRecord(dir, houseKey, () => rec('house1', 40, false)).result, 'accepted')
  assert.strictEqual(K.shopRecordHead().head.rec.plot, 'house1')
  const c = K.shopCellsNow()
  assert.ok(c.cells.has('20,70,30') && c.cells.has('40,70,30'), [...c.cells].join(' '))
  K.shopFootprintRefresh(bot)
  assert.ok(bot.shopFootprint.has('21,71,31') && bot.shopFootprint.has('41,71,31'))
  assert.ok(bot.shopCells.has('22,70,32') && bot.shopCells.has('42,70,32'))
  assert.strictEqual(bot.shopSaplingBox.length, 2)
  assert.ok(bot.shopStations && typeof bot.shopStations === 'object')
  assert.strictEqual(K.shopActive(bot).plot, 'house1')
})
await t('HOUSE stays per-project: the house\'s progress clock and slots live under its own key', () => {
  assert.ok(K.shopSlotsFree(bot))
  assert.ok(!fs.readdirSync(dir).some(f => f.startsWith(`${houseKey}.slot`)), 'POSITIVE CONTROL: no slot taken by a read')
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
process.exit(0)
