// keepout-01 x townindex-01 (JIT 10-22b, townindex-on-<protectzone x keepout tip>): count_town's index-unknown extras against
// keep-out's exit order.
//
// townindex-01 sends count_town to the town containers the index has never seen (indexRecountKeys). keepout-01 never refuses
// an open, but a body inside a live fire column is sent out by `_keepout_exit`, LAST in the order chain, overriding every
// order -- except a town job in a column that covers the town (C12, KEEPOUT_TOWN_YIELD). The trap would be an extra inside a
// column the yield does not cover: count_town walks the bot in, the exit walks it out, the next count walks it back.
// Behaviour, the REAL count_town in townindex.test.mjs's count world with a fire site under one extra (8,64,3):
//   - the extra in the column is still counted (keep-out never refuses an open), the dig guard never asked;
//   - the column covers that chest, so coversTown yields and the exit stands down for count_town where the bot stood to
//     count it; CONTROL: a non-town job there, or KEEPOUT_TOWN_YIELD=0 -> the exit starts;
//   - every container name the index counts (the town scan's CONTAINER_RE) is a town block for coversTown, so the yield can
//     never miss a container the index sends a bot to (each name placed alone in the column yields; a crafting table not).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-koti-logs-'))
process.env.BOT_NAME = 'KoTiBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-koti-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const S0 = await import('../src/skills.mjs')
const CC = await import('../src/cobblecap.mjs')
const CF = await import('../src/chestfull.mjs')
const B = await import('../src/bankable.mjs')
const KO = await import('../src/keepout.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

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
// protectzone-townindex-compose's count world: four chests, the cap's journal reset, three counted again by "another bot"
const cobbleBag = () => slotted([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 40), tool('stone_pickaxe', 10)])
const CHESTS = [[5, 64, 0], [8, 64, 3], [-4, 64, 5], [2, 64, -9]]
const countWorld = () => {
  freshPool(); offset += 61 * 60_000
  S0.resetCobbleReconcile(); S0.resetIndexCount?.()
  const w = asMineflayer(withServer(fakeWorld({ bag: cobbleBag() })))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 3)]) }
  S0.installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  const key = CF.townKey(HOME)
  for (const [x, y, z] of CHESTS) CC.recordCount(dir(), key, null, { obs: { k: `${x},${y},${z}`, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  later(5); CC.appendJournal(dir(), key, null, { t: 'reset', at: Date.now() }); later(5)
  for (const k of ['8,64,3', '-4,64,5', '2,64,-9']) CC.recordCount(dir(), key, null, { obs: { k, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  return w
}
const fire = (x, y, z) => ({ kind: KO.FIRE_KIND, x, y, z, count: 4, deaths: 1, last: Date.now(), by: ['x'] })
const SITE = fire(8, 60, 3)   // the column x 2..14, z -3..9 at y 60..72: it holds the extra 8,64,3 (and 5,64,0)
const nameAtOf = w => (x, y, z) => w.bot.blockAt({ x, y, z })?.name ?? null
// the guard as index.mjs installs it, over the fake's dig: no count_town dig may be refused (none should be made at all)
const koGuard = (w, sites) => {
  const refused = []
  w.bot.fireSitesNow = () => sites
  w.bot.dig = KO.keepoutDigGuard(w.bot.dig ?? (async () => {}), { sitesNow: () => sites, purposeOf: () => 'target', onRefuse: () => refused.push(1) })
  return refused
}

await t('the extra INSIDE a fire column is still counted (keep-out refuses no open); the dig guard is never asked', async () => {
  const w = countWorld()
  try {
    const refused = koGuard(w, [SITE])
    assert.ok(KO.columnAt([SITE], { x: 8.5, y: 64, z: 4.5 }), 'a stand beside the extra is in the column')
    assert.ok(S0.indexRecountKeys(w.bot, ['5,64,0']).includes('8,64,3'), 'the index lists it')
    const r = await S0.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
    assert.equal(r.status, 'success', r.detail)
    assert.ok(w.spy.opened.includes('8,64,3'), `counted: ${w.spy.opened}`)
    assert.deepEqual(refused, [])
  } finally { B.setStockReaders({ town: null, well: null }) }
})

await t('THE YIELD: the column covers that chest -> the exit stands down for count_town beside it; CONTROL: gather there, or the yield off -> the exit', async () => {
  const w = countWorld()
  try {
    const cov = KO.coversTown(SITE, { home: HOME, nameAt: nameAtOf(w) })
    assert.equal(cov.yields, true); assert.ok(cov.containers >= 1, JSON.stringify(cov)); assert.equal(cov.home, false, 'not by home: the chests')
    const pos = { x: 8.5, y: 64, z: 4.5 }
    const d = skill => KO.exitDecision({ sites: [SITE], pos, home: HOME, skill, yielded: s => KO.coversTown(s, { home: HOME, nameAt: nameAtOf(w) }).yields, yieldOn: true })
    assert.equal(d('count_town').start, false); assert.equal(d('count_town').why, 'town_job')
    assert.equal(d('gather').start, true, 'a non-town job in the column: the exit')
    assert.equal(KO.exitDecision({ sites: [SITE], pos, home: HOME, skill: 'count_town', yielded: () => true, yieldOn: false }).start, true, 'KEEPOUT_TOWN_YIELD=0: the exit')
  } finally { B.setStockReaders({ town: null, well: null }) }
})

await t('every container name the town scan counts is a town block for coversTown (each alone in the column yields); a crafting table does not', async () => {
  const names = ['chest', 'trapped_chest', 'barrel']   // skills.mjs CONTAINER_RE (the scan, the index, the town search)
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const re = src.match(/^const CONTAINER_RE = \/\^\(([a-z_|]+)\)\$\/$/m)
  assert.ok(re, 'CONTAINER_RE is declared as a plain alternation (the list this test walks)')
  assert.deepEqual(re[1].split('|').sort(), [...names].sort(), 'the list above is the scan\'s')
  for (const n of names) {
    const nameAt = (x, y, z) => (x === 9 && y === 64 && z === 4 ? n : 'air')
    assert.equal(KO.coversTown(SITE, { home: HOME, nameAt }).yields, true, `${n} yields`)
  }
  assert.equal(KO.coversTown(SITE, { home: HOME, nameAt: (x, y, z) => (x === 9 && y === 64 && z === 4 ? 'crafting_table' : 'air') }).yields, false, 'CONTROL: not a town block')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
