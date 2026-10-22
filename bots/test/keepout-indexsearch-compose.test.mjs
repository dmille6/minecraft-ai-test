// keepout-01 x indexsearch-01 (JIT 10-22b, indexsearch-on-<townindex x protectzone x keepout tip>): the index's first pick
// inside a live fire column.
//
// indexsearch-01 ranks FIRST the container the town index says holds the need. keepout-01 never refuses an open, but a body
// inside a fire column is sent out by `_keepout_exit` (LAST in the order chain) unless it is on a town job in a column that
// covers the town (C12). Composed, behaviour, the REAL toolkit through its REAL order in protectzone-indexsearch-compose's
// scene, with a fire site under the index's holder IX and keep-out's dig guard on the bot:
//   - the index's holder is still opened FIRST and gives the iron (keep-out leaves the search and its ranking alone); no dig
//     is asked of the guard;
//   - where the bot stood to open IX it is inside the column; the column covers IX, so the exit stands down for every skill
//     the index search serves (toolkit, withdraw_pick, withdraw, smelt_town) -- the run is never undone by the exit;
//     CONTROL: a non-town job there, or KEEPOUT_TOWN_YIELD=0 -> the exit starts.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kois-logs-'))
process.env.BOT_NAME = 'KoIsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-kois-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { KIT } = K
const S0 = await import('../src/skills.mjs')
const TI = await import('../src/townindex.mjs')
const CF = await import('../src/chestfull.mjs')
const CC = await import('../src/cobblecap.mjs')
const KO = await import('../src/keepout.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset

const HOME = { x: 0, y: 64, z: 0 }
const HK = TI.indexHomeKey(HOME)
const dir = () => process.env.POOL_STATE_DIR
const kOf = ([x, y, z]) => `${x},${y},${z}`
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
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
const fakeCraft = w => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const isKit = w => count(w.bag, 'iron_axe') === 1 && count(w.bag, 'iron_shovel') === 1

// the scene of protectzone-indexsearch-compose: nine dirt chests nearer than the index's holder IX (20 iron KNOWN to the index)
const NEAR = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const IX = [-9, 64, -6], FAR = [-13, 64, 5]
const scene = () => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000; TI.resetIndexCache()
  const w = asMineflayer(withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 200), stack('stick', 9)]) })))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.set(...IX, 'chest'); w.stock(...IX, [stack('iron_ingot', 20)])
  w.set(...FAR, 'chest'); w.stock(...FAR, [stack('iron_ingot', 20)])
  CC.recordCount(dir(), CF.townKey(HOME), null, { obs: { k: kOf(IX), n: 0, m: { dirt: 0 }, cap: Date.now() - 120_000 }, bot: 'other' })
  const at = Date.now() - 60_000
  TI.appendIndex(dir(), HK, null, { t: 'obs', id: `seed-ix-${at}`, k: kOf(IX), h: [kOf(IX)], at, size: 27, used: 1, names: { iron_ingot: [20, 1] }, bot: 'Other', by: 'test' })
  TI.resetIndexCache()
  return w
}
const fire = (x, y, z) => ({ kind: KO.FIRE_KIND, x, y, z, count: 4, deaths: 1, last: Date.now(), by: ['x'] })
const SITE = fire(-9, 60, -6)   // the column under IX: x -15..-3, z -12..0 at y 60..72 (home 0,64,0 is 10.8 away: not home)
const koGuard = (w, sites) => {
  const refused = []
  w.bot.fireSitesNow = () => sites
  w.bot.dig = KO.keepoutDigGuard(w.bot.dig ?? (async () => {}), { sitesNow: () => sites, purposeOf: () => 'target', onRefuse: () => refused.push(1) })
  return refused
}
async function oneOrder (w) {
  const o = K.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S0.townKitIronMiss(w.bot), tableNear: true, state: {} })
  assert.equal(o.order?.skill, 'toolkit', 'the order issues')
  return S0.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, o.order.args, new AbortController().signal)
}
const nameAtOf = w => (x, y, z) => w.bot.blockAt({ x, y, z })?.name ?? null

await t('the index\'s holder inside a fire column is still opened FIRST and gives the iron; the kit is made; no dig asked of the guard', async () => {
  const w = scene()
  const refused = koGuard(w, [SITE])
  assert.ok(KO.columnAt([SITE], { x: IX[0] + 0.5, y: 64, z: IX[2] + 1.5 }), 'a stand beside IX is in the column')
  const r = await oneOrder(w)
  assert.equal(r.status, 'success', r.detail); assert.ok(isKit(w))
  assert.equal(w.spy.opened[0], kOf(IX), `opened: ${w.spy.opened}`)
  assert.equal(count(w.containers.get(kOf(IX)).slots, 'iron_ingot'), 16)
  assert.deepEqual(refused, [])
})

await t('THE YIELD where it stood: inside the column, which covers IX -> no exit for any skill the index search serves; CONTROL: gather, or the yield off -> the exit', async () => {
  const w = scene()
  koGuard(w, [SITE])
  await oneOrder(w)
  const pos = w.bot.entity.position
  assert.ok(Math.hypot(pos.x - (IX[0] + 0.5), pos.z - (IX[2] + 0.5)) <= 4, `it stood by IX to open it: ${pos}`)
  assert.ok(KO.columnAt([SITE], pos), `and that is inside the column: ${pos}`)
  const cov = KO.coversTown(SITE, { home: HOME, nameAt: nameAtOf(w) })
  assert.equal(cov.yields, true); assert.equal(cov.home, false, 'the chest, not home')
  const d = skill => KO.exitDecision({ sites: [SITE], pos, home: HOME, skill, yielded: s => KO.coversTown(s, { home: HOME, nameAt: nameAtOf(w) }).yields, yieldOn: true })
  for (const skill of ['toolkit', 'withdraw_pick', 'withdraw', 'smelt_town']) {
    assert.ok(S0.SKILLS[skill], `${skill} is a skill`)
    assert.equal(d(skill).start, false, `${skill}: no exit`); assert.equal(d(skill).why, 'town_job')
  }
  assert.equal(d('gather').start, true, 'a non-town job: the exit')
  assert.equal(KO.exitDecision({ sites: [SITE], pos, home: HOME, skill: 'toolkit', yielded: () => true, yieldOn: false }).start, true, 'KEEPOUT_TOWN_YIELD=0: the exit')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
