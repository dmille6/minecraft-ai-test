// PLACEAUDIT-01: the `_place_town` instrument (placeaudit.mjs). TELEMETRY ONLY -- the tests prove it observes and never changes:
// the caller gets the ORIGINAL promise, the same arguments reach mineflayer, a rejection still reaches the caller.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const PA = await import('../src/placeaudit.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const PA_PATH = new URL('../src/placeaudit.mjs', import.meta.url)
const FEAT_PATH = new URL('../src/features.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const HOME = { x: 0, y: 70, z: 0 }

await t('placeReason: the pathfinder (its frame or isBuilding), a reflex file or a survival scope, a ladder, a lid, a skill by function, else other', async () => {
  const pf = ['    at bot.placeBlock (/x/bots/src/placeaudit.mjs:90:5)', '    at /x/node_modules/mineflayer-pathfinder/index.js:556:17']
  assert.deepStrictEqual(PA.placeReason({ frames: pf }), { reason: 'pathfinder', by: 'pathfinder' })
  assert.strictEqual(PA.placeReason({ frames: [], building: true, scope: { purpose: 'transit', by: 'goto' } }).by, 'goto')
  assert.deepStrictEqual(PA.placeReason({ frames: ['    at pillarUp (/x/bots/src/reflex.mjs:10:3)'] }), { reason: 'reflex', by: 'pillarUp' })
  assert.strictEqual(PA.placeReason({ frames: ['    at foo (/x/bots/src/skills.mjs:1:1)'], scope: { purpose: 'survival', by: 'reflex:air' } }).reason, 'reflex')
  assert.strictEqual(PA.placeReason({ frames: ['    at async ladderUp (/x/bots/src/ladder.mjs:5:1)'] }).reason, 'ladder')
  assert.strictEqual(PA.placeReason({ frames: ['    at lid (/x/bots/src/lidplace.mjs:5:1)'] }).reason, 'lid')
  assert.deepStrictEqual(PA.placeReason({ frames: ['    at bot.placeBlock (/x/bots/src/placeaudit.mjs:90:5)', '    at async placeTorch (/x/bots/src/skills.mjs:123:9)'] }), { reason: 'skill', by: 'skills:placeTorch' })
  assert.strictEqual(PA.placeReason({ frames: ['    at node:internal/process/task_queues:95:5'] }).reason, 'other')
})
await t('placeShape and placeZone: a tower under the feet, a bridge below, a step; the town is 48 from home (+16 margin), never deep below', async () => {
  assert.strictEqual(PA.placeShape([3, 69, 4], [3, 70, 4]), 'pillar')
  assert.strictEqual(PA.placeShape([4, 69, 4], [3, 70, 4]), 'bridge')
  assert.strictEqual(PA.placeShape([4, 70, 4], [3, 70, 4]), 'step')
  assert.strictEqual(PA.placeShape([4, 70, 4], null), 'unknown')
  assert.strictEqual(PA.placeZone([45, 71, -30], HOME), 'town', 'the LIVE showcase wall interior reaches 45')
  assert.strictEqual(PA.placeZone([60, 71, 0], HOME), 'margin')
  assert.strictEqual(PA.placeZone([80, 71, 0], HOME), null)
  assert.strictEqual(PA.placeZone([0, 50, 0], HOME), null, 'a mine below town is not the town')
  assert.strictEqual(PA.placeZone([0, 70, 0], null), null)
})
const fakeBot = (impl) => {
  const bot = { entity: { position: { x: 3.5, y: 70, z: 4.5 } }, heldItem: { name: 'dirt' }, pathfinder: { isBuilding: () => false }, calls: [] }
  bot.placeBlock = function (ref, face, ...rest) { bot.calls.push({ self: this, ref, face, rest }); return impl(ref, face) }
  return bot
}
const ref = (x, y, z) => ({ position: { x, y, z } })
await t('OBSERVE ONLY: the same arguments and `this` reach mineflayer, the caller gets the ORIGINAL promise, a rejection reaches the caller unchanged', async () => {
  let p0 = null
  const bot = fakeBot(() => (p0 = Promise.resolve('ok')))
  const rows = [], sums = []
  const pa = PA.attachPlaceAudit(bot, { home: HOME, emitPlace: r => rows.push(r), emitSummary: s => sums.push(s), timers: false })
  assert.ok(pa && bot.placeBlock.__placeaudit)
  const face = { x: 0, y: -1, z: 0 }
  const r1 = bot.placeBlock(ref(3, 70, 4), face, { extra: 1 })
  assert.strictEqual(r1, p0, 'the original promise, not a wrapper')
  assert.strictEqual(await r1, 'ok')
  // the argument COUNT too (Codex r1 BLOCKER): an omitted argument stays omitted
  const counts = []
  const botN = { entity: null, placeBlock: function () { counts.push(arguments.length); return Promise.resolve() } }
  PA.attachPlaceAudit(botN, { home: HOME, emitPlace: () => {}, emitSummary: () => {}, timers: false })
  await botN.placeBlock(); await botN.placeBlock(ref(1, 70, 1)); await botN.placeBlock(ref(1, 70, 1), { x: 0, y: 1, z: 0 })
  assert.deepStrictEqual(counts, [0, 1, 2])
  assert.strictEqual(bot.calls[0].self, bot); assert.strictEqual(bot.calls[0].face, face); assert.deepStrictEqual(bot.calls[0].rest, [{ extra: 1 }])
  await new Promise(resolve => setImmediate(resolve))
  assert.strictEqual(rows.length, 1)
  assert.deepStrictEqual([rows[0].args.x, rows[0].args.y, rows[0].args.z, rows[0].args.block, rows[0].args.shape, rows[0].args.zone, rows[0].args.outcome], [3, 69, 4, 'dirt', 'pillar', 'town', 'placed'])
  // a rejection: the caller's catch sees the same error; the row says failed
  const err = new Error('No block has been placed : the block is still air')
  const bot2 = fakeBot(() => Promise.reject(err))
  const rows2 = []
  PA.attachPlaceAudit(bot2, { home: HOME, emitPlace: r => rows2.push(r), emitSummary: () => {}, timers: false })
  let caught = null
  try { await bot2.placeBlock(ref(10, 70, 10), { x: 1, y: 0, z: 0 }) } catch (e) { caught = e }
  assert.strictEqual(caught, err)
  await new Promise(resolve => setImmediate(resolve))
  assert.strictEqual(rows2[0].args.outcome, 'failed')
  // a throw inside mineflayer's sync part propagates as before
  const bot3 = fakeBot(() => { throw new TypeError('boom') })
  PA.attachPlaceAudit(bot3, { home: HOME, emitPlace: () => {}, emitSummary: () => {}, timers: false })
  assert.throws(() => bot3.placeBlock(ref(1, 70, 1), { x: 0, y: 1, z: 0 }), /boom/)
  assert.strictEqual(PA.attachPlaceAudit(bot, { home: HOME, emitPlace: () => {}, emitSummary: () => {} }), null, 'never wrapped twice')
  // a visit's own wrapper on top (skills.mjs's bag tally) at a respawn: still never a second instrument, and its restore still works
  const top = bot.placeBlock, mine = function (...a) { return top.apply(this, a) }
  bot.placeBlock = mine
  assert.strictEqual(PA.attachPlaceAudit(bot, { home: HOME, emitPlace: () => {}, emitSummary: () => {} }), null, 'not under another wrapper')
  assert.strictEqual(bot.placeBlock, mine); bot.placeBlock = top
})
await t('rows only in the town or its margin; the minute summary counts every placement by zone.reason.shape.outcome; a broken emitter never reaches the caller', async () => {
  const bot = fakeBot(() => Promise.resolve())
  const rows = [], sums = []
  const pa = PA.attachPlaceAudit(bot, { home: HOME, emitPlace: r => { rows.push(r); throw new Error('logger down') }, emitSummary: s => sums.push(s), timers: false })
  await bot.placeBlock(ref(3, 70, 4), { x: 0, y: -1, z: 0 })
  await bot.placeBlock(ref(200, 70, 4), { x: 1, y: 0, z: 0 })
  await new Promise(resolve => setImmediate(resolve))
  assert.strictEqual(rows.length, 1, 'the far one is counted, not rowed')
  pa.flush()
  assert.strictEqual(sums.length, 1)
  assert.deepStrictEqual(sums[0].args.by, { 'town.other.pillar.placed': 1, 'out.other.step.placed': 1 })
  assert.strictEqual(sums[0].args.ierr, 1, 'the emitter\'s throw is counted, never thrown')
  pa.flush(); assert.strictEqual(sums.length, 1, 'an empty minute writes nothing')
})
await t('the switch and the wiring: PLACEAUDIT=off is not installed; installFeatures wraps once a spawn and writes the licence row', async () => {
  assert.strictEqual(PA.placeAuditOn({}), true); assert.strictEqual(PA.placeAuditOn({ PLACEAUDIT: 'off' }), false)
  const f = strip(readFileSync(FEAT_PATH, 'utf8'))
  assert.ok(/const on = placeAuditOn\(process\.env\)/.test(f) && /if \(on\) \{\n\s*const pa = attachPlaceAudit\(bot, \{/.test(f), 'installed by installFeatures')
  assert.ok(/kind: 'place_town',/.test(f) && /kind: 'place_town_sum',/.test(f) && /kind: 'placeaudit_mode',/.test(f))
})
await t('mutant: a wrapper that returns its own promise (not the original) is caught', async () => {
  await withMutant(PA_PATH, '    return pr\n  }\n  wrapped.__placeaudit = true', '    return pr.then(v => v)\n  }\n  wrapped.__placeaudit = true', async M => {
    let p0 = null
    const bot = fakeBot(() => (p0 = Promise.resolve()))
    M.attachPlaceAudit(bot, { home: HOME, emitPlace: () => {}, emitSummary: () => {}, timers: false })
    assert.notStrictEqual(bot.placeBlock(ref(3, 70, 4), { x: 0, y: -1, z: 0 }), p0, 'the mutant hands back another promise')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
