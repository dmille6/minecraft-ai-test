// protectzone-01 x townindex-01 (JIT 10-21b, townindex-on-<protectzone tip>): count_town's extras against the zone guard.
//
// townindex-01 adds to count_town's candidates the town containers the index has never seen (indexRecountKeys over
// townCobbleScan's keys). protectzone-01's guard refuses every open inside a zone, and the scan's findBlocks never answers a
// zone cell -- but the cobble journal's counted keys re-add containers the scan cannot see. A zone container counted before
// its zone was installed is therefore index-UNKNOWN forever (no open can ever record it), and without a filter it is an
// extra on every count_town after each backoff: a walk and a refused open, again and again. Behaviour, the REAL count_town
// with the REAL guard (attachProtectZone over a fake that opens as mineflayer 4.37.1 does: openContainer -> openBlock):
//   - the zone's container is never an extra; the others are counted; the guard is never asked;
//   - either half of a double chest in a zone keeps the double out;
//   - CONTROL: no zone -> that container is an extra and is counted; the guard is live (a direct open is refused);
//   - MUTANT: the filter removed -> the zone's container is an extra and its open is refused (killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzti-logs-'))
process.env.BOT_NAME = 'PzTiBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pzti-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const S0 = await import('../src/skills.mjs')
const CC = await import('../src/cobblecap.mjs')
const CF = await import('../src/chestfull.mjs')
const B = await import('../src/bankable.mjs')
const PZ = await import('../src/protectzone.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

const HOME = { x: 0, y: 64, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const asMineflayer = w => {
  const open = w.bot.openContainer.bind(w.bot)
  w.bot.openBlock = b => open(b)
  w.bot.openContainer = function (b) { return this.openBlock(b) }
  return w
}
const guarded = (w, zones) => {
  const refused = []
  w.bot.protectZones = () => zones
  PZ.attachProtectZone(w.bot, { zones: w.bot.protectZones, onRefuse: r => refused.push(r) })
  w.bot.protectZone = PZ.protectZoneCounters()
  return refused
}
const zoneOf = (id, box) => PZ.parseZones({ version: 1, zones: [{ id, kind: 'fixture', label: `the ${id}`, box }] }).zones

// townindex.test.mjs's count world: four chests, the cap's journal reset, three of them counted again by "another bot" (known
// to the cap, never opened since the index began) -- the stock key 5,64,0 first, then the index-unknown extras
const cobbleBag = () => slotted([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 40), tool('stone_pickaxe', 10)])
const CHESTS = [[5, 64, 0], [8, 64, 3], [-4, 64, 5], [2, 64, -9]]
const countWorld = ({ double = false } = {}) => {
  freshPool(); offset += 61 * 60_000
  S0.resetCobbleReconcile(); S0.resetIndexCount?.()
  const w = asMineflayer(withServer(fakeWorld({ bag: cobbleBag() })))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 3)]) }
  if (double) {   // 8,64,3 becomes the left half of a double whose right half is 9,64,3
    w.set(8, 64, 3, 'chest', { facing: 'north', type: 'left' }); w.set(9, 64, 3, 'chest', { facing: 'north', type: 'right' })
  }
  S0.installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  const key = CF.townKey(HOME)
  for (const [x, y, z] of CHESTS) CC.recordCount(dir(), key, null, { obs: { k: `${x},${y},${z}`, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  later(5); CC.appendJournal(dir(), key, null, { t: 'reset', at: Date.now() }); later(5)
  for (const k of ['8,64,3', '-4,64,5', '2,64,-9']) CC.recordCount(dir(), key, null, { obs: { k, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  return w
}
const OVER = zoneOf('over-8-64-3', [7, 60, 2, 8, 70, 4])          // holds 8,64,3 only
const OVER_RIGHT = zoneOf('over-9-64-3', [9, 60, 3, 9, 70, 3])    // the right half of the double only
const countOnce = async (S, w) => S.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)

await t('CONTROL: no zone -> 8,64,3 is one of the index-unknown extras and is counted', async () => {
  const w = countWorld()
  try {
    const refused = guarded(w, [])
    assert.deepEqual(S0.indexRecountKeys(w.bot, ['5,64,0']).sort(), ['-4,64,5', '2,64,-9', '8,64,3'])
    const r = await countOnce(S0, w)
    assert.equal(r.status, 'success', r.detail)
    assert.ok(w.spy.opened.includes('8,64,3'), `the nearest extra was counted: ${w.spy.opened}`)
    assert.deepEqual(refused, [])
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('A ZONE OVER A COUNTED CONTAINER: never an extra; the others are counted; the guard is never asked; positive control: the guard is live', async () => {
  const w = countWorld()
  try {
    const refused = guarded(w, OVER)
    assert.deepEqual(S0.indexRecountKeys(w.bot, ['5,64,0']).sort(), ['-4,64,5', '2,64,-9'], 'the zone container is out')
    for (let i = 0; i < 2; i++) { const r = await countOnce(S0, w); assert.ok(['success', 'no_effect'].includes(r.status), r.detail); later(61 * 60_000) }
    assert.ok(!w.spy.opened.includes('8,64,3'), `opened: ${w.spy.opened}`)
    assert.ok(w.spy.opened.includes('-4,64,5') && w.spy.opened.includes('2,64,-9'), `the others counted: ${w.spy.opened}`)
    assert.deepEqual(refused, [], 'the guard was never asked')
    await assert.rejects(w.bot.openContainer(w.bot.blockAt({ x: 8, y: 64, z: 3 })), e => e instanceof PZ.ProtectedZoneError)
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('A DOUBLE CHEST with only its other half in a zone is out too (the window is both halves)', async () => {
  const w = countWorld({ double: true })
  try {
    w.bot.protectZones = () => []
    assert.ok(S0.indexRecountKeys(w.bot, ['5,64,0']).some(k => k === '8,64,3' || k === '9,64,3'), 'CONTROL: no zone -> the double is an extra')
    S0.resetCobbleReconcile()
    guarded(w, OVER_RIGHT)
    assert.ok(!S0.indexRecountKeys(w.bot, ['5,64,0']).some(k => k === '8,64,3' || k === '9,64,3'), S0.indexRecountKeys(w.bot, ['5,64,0']).join(' '))
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('MUTANT KILLED: without the filter the zone container is an extra, walked to, and its open refused by the guard', async () => {
  await withMutant(SKILLS_PATH, " && recountMissStatus(misses[k], now) === 'ok' && !zoneShut(k))", " && recountMissStatus(misses[k], now) === 'ok')", async S => {
    const w = countWorld()
    try {
      const refused = guarded(w, OVER)
      assert.ok(S.indexRecountKeys(w.bot, ['5,64,0']).includes('8,64,3'), 'the mutant lists it')
      await countOnce(S, w)
      assert.ok(refused.some(r => r.op === 'open' && r.at?.x === 8 && r.at?.z === 3), `the mutant asks the guard: ${JSON.stringify(refused)}`)
    } finally { B.setStockReaders({ town: null, well: null }) }
  })
})

await t('MUTANT KILLED: judging only the key\'s own half lists the double whose other half is in the zone', async () => {
  await withMutant(SKILLS_PATH, '        return [p, ...(q ? [q] : [])].some(c => !!blocked(zonesNow, c.x, c.y, c.z, feet))\n',
    '        return [p].some(c => !!blocked(zonesNow, c.x, c.y, c.z, feet))\n', async S => {
      const w = countWorld({ double: true })
      try {
        guarded(w, OVER_RIGHT)
        assert.ok(S.indexRecountKeys(w.bot, ['5,64,0']).some(k => k === '8,64,3' || k === '9,64,3'), 'the mutant lists the double')
      } finally { B.setStockReaders({ town: null, well: null }) }
    })
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
