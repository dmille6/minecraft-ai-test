// THE BANK FIX, DRIVEN: tier limits judged against the live chest window, the capped state that closes the
// full -> deposit -> capped -> repeat loop, hold-iron, demand vs transfer, and only a valuable item opening a chest.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-banktiers'
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '28'; process.env.HOME_Y = '79'; process.env.HOME_Z = '0'
const B = await import('../src/bankable.mjs')
const { SKILLS, afterFullChest, onContainerLid } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---- pure ----
await t('tiers: metal/gems/ore valuable; endless bulk; logs/planks/sticks useful; ballast junk; a spent surplus tool is bulk', () => {
  assert.equal(B.tierOf('diamond'), 'valuable'); assert.equal(B.tierOf('raw_iron'), 'valuable'); assert.equal(B.tierOf('redstone'), 'valuable')
  assert.equal(B.tierOf('cobblestone'), 'bulk'); assert.equal(B.tierOf('dirt'), 'bulk'); assert.equal(B.tierOf('tuff'), 'bulk')
  assert.equal(B.tierOf('birch_log'), 'useful'); assert.equal(B.tierOf('oak_planks'), 'useful'); assert.equal(B.tierOf('stick'), 'useful')
  assert.equal(B.tierOf('leaf_litter'), 'junk'); assert.equal(B.tierOf('coal'), 'other'); assert.equal(B.tierOf('stone_pickaxe'), 'other')
  assert.equal(B.tierOf('stone_pickaxe', { spent: true }), 'bulk')
})
await t('allowance: useful to 128 under 75% occupied, bulk to 64 under 50%, valuable always, counted IN this container', () => {
  const w = (occupied, counts = {}) => ({ occupied, slots: 27, counts })
  assert.equal(B.tierAllowance('cobblestone', 200, 'bulk', w(5)), 64)
  assert.equal(B.tierAllowance('cobblestone', 200, 'bulk', w(5, { cobblestone: 60 })), 4)
  assert.equal(B.tierAllowance('cobblestone', 200, 'bulk', w(14)), 0, '14/27 = 52% >= 50%')
  assert.equal(B.tierAllowance('oak_log', 300, 'useful', w(14, { oak_log: 100 })), 28)
  assert.equal(B.tierAllowance('oak_log', 300, 'useful', w(21)), 0, '21/27 = 78% >= 75%')
  assert.equal(B.tierAllowance('diamond', 5, 'valuable', w(26)), 5)
  assert.equal(B.tierAllowance('apple', 5, 'junk', w(0)), 0)
})
await t('HOLD IRON: three stay in hand, ingots first; the rest bank', () => {
  assert.deepEqual(B.ironKeep({ iron_ingot: 2, raw_iron: 5 }), { iron_ingot: 2, raw_iron: 1 })
  const r = B.bankableInventory([{ name: 'raw_iron', count: 5 }, { name: 'iron_ingot', count: 1 }])
  assert.deepEqual(r.detail, { raw_iron: 3 })
})
await t('DEMAND is valuable + other only: 128 cobble and 40 logs send nobody to a chest (was 104 "worth banking")', () => {
  const inv = [{ name: 'cobblestone', count: 128 }, { name: 'oak_log', count: 40 }]
  const r = B.bankableInventory(inv)
  assert.ok(r.count > 60, `positive control: they ARE transferable (${r.count})`); assert.equal(r.demand, 0)
  assert.equal(B.bankableInventory([...inv, { name: 'iron_ore', count: 9 }, { name: 'coal', count: 5 }]).demand, 14, 'ore is always demand')
})
await t('afterFullChest: only a valuable item opens a chest, and a carried one is placed before one is crafted', () => {
  assert.equal(afterFullChest({ valuableBlocked: 2, carried: 'chest' }), 'place_carried')
  assert.equal(afterFullChest({ valuableBlocked: 2, carried: 'trapped_chest' }), 'place_carried')
  assert.equal(afterFullChest({ valuableBlocked: 2, carried: 'barrel' }), 'craft', 'never a barrel')
  assert.equal(afterFullChest({ valuableBlocked: 2 }), 'craft')
  assert.equal(afterFullChest({ blocked: 40 }), 'full', 'a full chest and nothing valuable waiting: no new chest')
  assert.equal(afterFullChest({ capped: 40 }), 'capped')
  assert.equal(afterFullChest({ capped: 40, blocked: 3 }), 'full')
  assert.equal(afterFullChest({ moved: 5, capped: 40 }), 'done')
})
await t('the capped state holds for BANK_CAPPED_MS and names why', () => {
  const bot = {}; B.setBankCapped(bot, 'cobblestone at its limit', 1000)
  assert.equal(B.bankCapped(bot, 1000 + B.BANK_CAPPED_MS - 1), 'cobblestone at its limit')
  assert.equal(B.bankCapped(bot, 1000 + B.BANK_CAPPED_MS), '')
  assert.equal(B.bankCapped({}), '')
})

// ---- driven: the real deposit against a chest window shaped like prismarine-windows ----
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })
const TYPE = { cobblestone: 1, oak_log: 2, diamond: 3, raw_iron: 4, dirt: 5, coal: 6, apple: 7 }
function bank ({ carry, chest = [] }) {
  // container slots 0..26 hold [{name,count}] (one entry per slot); the bot's bag is a count per name
  const slots = Array.from({ length: 27 }, (_, i) => chest[i] ?? null)
  const bag = { ...carry }
  const window = {
    inventoryStart: 27,
    containerItems: () => slots.map((s, i) => s && { ...s, slot: i }).filter(Boolean),
    items: () => [],
    firstEmptyContainerSlot: () => { const i = slots.indexOf(null); return i < 0 ? null : i },
    async deposit (type, _m, n) {
      const name = Object.keys(TYPE).find(k => TYPE[k] === type)
      let left = n
      for (let i = 0; i < 27 && left > 0; i++) {
        if (slots[i] && slots[i].name === name && slots[i].count < 64) { const k = Math.min(64 - slots[i].count, left); slots[i].count += k; left -= k; bag[name] -= k }
      }
      for (let i = 0; i < 27 && left > 0; i++) {
        if (!slots[i]) { const k = Math.min(64, left); slots[i] = { name, count: k }; left -= k; bag[name] -= k }
      }
      if (left > 0) throw new Error('destination full')
    },
    close () {},
  }
  const chestBlock = { position: V(30, 79, 0), type: 1 }
  const bot = {
    entity: { position: V(29, 79, 0), onGround: true, velocity: V(0, 0, 0) }, health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count, type: TYPE[name] })) },
    assertNav: () => {}, findBlock: ({ matching }) => (matching(chestBlock) ? chestBlock : null),
    blockAt: p => p && p.y > 79 ? { name: 'air', boundingBox: 'empty' } : { name: 'grass_block', boundingBox: 'block' },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, goto: async () => {} },
    openContainer: async () => window,
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {}, waitForTicks: async () => {}, chat () {},
  }
  return { bot, slots, bag }
}
const run = (bot, args = {}) => SKILLS.deposit.run({ bot }, args, new AbortController().signal)
const inChest = (slots, name) => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0)

await t('DRIVEN: cobble stops at 64 in the chest, logs at 128 (100 already there), the diamond goes; the rest stays', async () => {
  // One deposit moves at most 64 of an item (bankableInventory's creditCap, unchanged), so the useful limit is shown
  // with 100 logs already in the chest: 28 more fit under 128.
  const { bot, slots, bag } = bank({ carry: { cobblestone: 300, oak_log: 300, diamond: 2 }, chest: [{ name: 'oak_log', count: 64 }, { name: 'oak_log', count: 36 }] })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(inChest(slots, 'cobblestone'), 64); assert.equal(inChest(slots, 'oak_log'), 128); assert.equal(inChest(slots, 'diamond'), 2)
  assert.ok(bag.cobblestone > 200 && bag.oak_log > 100, 'kept on purpose'); assert.match(r.detail, /over the chest's limits/)
})
await t('DRIVEN POSITIVE CONTROL: an EMPTY chest takes a 60-cobble load whole (the cap is what stops it, not the fake)', async () => {
  const { bot, slots } = bank({ carry: { cobblestone: 68 } })
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(inChest(slots, 'cobblestone'), 60, '68 less the 8-block scaffold reserve')
})
await t('DRIVEN: a chest past half full takes NO bulk, and the bank is marked capped -- then admission refuses the next trip', async () => {
  const full = Array.from({ length: 14 }, () => ({ name: 'dirt', count: 64 }))   // 14/27 slots = 52%
  const { bot, slots } = bank({ carry: { cobblestone: 200 }, chest: full })
  const r = await run(bot)
  assert.equal(r.status, 'no_effect', r.detail); assert.equal(r.failClass, 'bank_capped'); assert.equal(inChest(slots, 'cobblestone'), 0)
  assert.match(B.bankCapped(bot), /cobblestone/)
  const gate = new AdmissionControl({ failCount: () => 0, bumpBlocked () {}, entryFor: () => null })
  const v = gate.check({ skill: 'deposit', args: {} }, bot)
  assert.equal(v.ok, false); assert.equal(v.reason, 'bank_capped')
})
await t('DRIVEN: the window is RE-READ before each item -- the coal that tips the chest past half full stops the cobble after it', async () => {
  const thirteen = Array.from({ length: 13 }, () => ({ name: 'dirt', count: 64 }))   // 13/27 = 48%: bulk would fit
  const { bot, slots } = bank({ carry: { coal: 64, cobblestone: 100 }, chest: thirteen })
  const r = await run(bot)
  assert.equal(inChest(slots, 'coal'), 64, 'coal (other) goes first by value and takes the 14th slot')
  assert.equal(inChest(slots, 'cobblestone'), 0, `14/27 = 52%: a stale read would have let 64 cobble in (${r.detail})`)
})
await t('DRIVEN: a stack that PARTLY fits then throws counts what moved (it read as a failure with items moved)', async () => {
  const chest = [{ name: 'coal', count: 40 }, ...Array.from({ length: 26 }, () => ({ name: 'dirt', count: 64 }))]
  const { bot, slots } = bank({ carry: { coal: 60 }, chest })
  const r = await run(bot)
  assert.equal(inChest(slots, 'coal'), 64, 'positive control: the fake moved 24 and threw')
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`); assert.match(r.detail, /deposited 24 items/)
})
await t('DRIVEN: a FULL chest with nothing valuable waiting closes the bank too -- and a valuable item reopens it', async () => {
  const full = Array.from({ length: 27 }, () => ({ name: 'dirt', count: 64 }))
  const { bot } = bank({ carry: { coal: 40 }, chest: full })
  const r = await run(bot)
  assert.equal(r.failClass, 'storage_full'); assert.match(B.bankCapped(bot), /full/)
  const gate = new AdmissionControl({ failCount: () => 0, bumpBlocked () {}, entryFor: () => null })
  assert.equal(gate.check({ skill: 'deposit', args: {} }, bot).reason, 'bank_capped', 'the loop: full -> deposit -> full')
  const withIron = { ...bot, inventory: { items: () => [{ name: 'coal', count: 40, type: 6 }, { name: 'raw_iron', count: 9, type: 4 }] } }
  assert.notEqual(gate.check({ skill: 'deposit', args: {} }, withIron).reason, 'bank_capped', 'raw_iron can open a new chest')
  assert.equal(B.bankClosed(withIron, withIron.inventory.items()), '')
})
await t('DRIVEN: an alternate that takes SOME of the valuables does not end the recovery -- it goes on to make room', async () => {
  // Chest A: full. Chest B (the alternate): one partial diamond stack of 60, the rest full. 64 diamonds banked per trip:
  // 4 fit in B, 60 are still in hand -- the recovery must go on to a new chest (here the craft fails: no recipe in the
  // fake), not return B's partial success as if the job were done (Codex review).
  const fullOf = n => Array.from({ length: 27 }, () => ({ name: n, count: 64 }))
  const A = bank({ carry: { diamond: 64 }, chest: fullOf('dirt') })
  const Bslots = [{ name: 'diamond', count: 60 }, ...fullOf('dirt').slice(1)]
  const B = bank({ carry: {}, chest: Bslots })
  const bot = A.bot
  const blockA = { position: V(30, 79, 0), type: 1 }, blockB = { position: V(33, 79, 0), type: 1 }
  const winB = await B.bot.openContainer(); const winA = await A.bot.openContainer()
  // B's window moves items out of A's bag (one bot)
  const origDeposit = winB.deposit.bind(winB)
  winB.deposit = async (type, m, n) => { const before = B.bag.diamond ?? 0; B.bag.diamond = A.bag.diamond; try { await origDeposit(type, m, n) } finally { A.bag.diamond = B.bag.diamond; B.bag.diamond = before } }
  bot.findBlock = ({ matching }) => [blockA, blockB].find(b => matching(b)) ?? null
  bot.blockAt = p => (p && p.x === 33 && p.z === 0 && p.y === 79) ? blockB : (p && p.y > 79 ? { name: 'air', boundingBox: 'empty' } : { name: 'grass_block', boundingBox: 'block' })
  bot.openContainer = async b => (b.position.x === 33 ? winB : winA)
  const r = await run(bot)
  assert.equal(inChest(B.slots, 'diamond'), 64, 'positive control: the alternate took the 4 that fit')
  assert.match(r.detail, /could not make another chest|making another one failed/, `recovery stopped at the alternate: ${r.detail}`)
  assert.equal(r.status, 'success', 'something moved, so it is still a success')
})
await t('DRIVEN: a full chest with only NON-valuable items waiting builds nothing (it used to craft a chest for cobble)', async () => {
  const full = Array.from({ length: 27 }, () => ({ name: 'coal', count: 64 }))
  const { bot } = bank({ carry: { coal: 40, chest: 1 }, chest: full })
  let placed = false; bot.placeBlock = async () => { placed = true }
  const r = await run(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'storage_full'); assert.match(r.detail, /only metal, gems or ore start a new chest/)
  assert.equal(placed, false)
})

await t('A NEW CHEST NEVER GOES ON A CONTAINER\'S LID: a cell over a chest/barrel is refused; over grass it is not', async () => {
  const under = name => ({ blockAt: p => (p.y === 63 ? { name } : { name: 'air' }) })
  assert.equal(onContainerLid(under('chest'), { x: 1, y: 64, z: 1 }), true)
  assert.equal(onContainerLid(under('barrel'), { x: 1, y: 64, z: 1 }), true)
  assert.equal(onContainerLid(under('grass_block'), { x: 1, y: 64, z: 1 }), false)
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /return !r \|\| !onContainerLid\(bot, \{ x: r\.x \+ \(c\.face\?\.x \?\? 0\)/, 'every candidate is filtered')
  assert.match(sk, /if \(onContainerLid\(bot, cellPos\)\) continue/, 'and the make-room path')
})
await t('WIRED: the loop reads the tier allowance from the LIVE window; the recovery asks afterFullChest; callers read demand', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /const allow = tierAllowance\(name, left, tier, windowState\(chest\)\)/)
  assert.match(sk, /const next = afterFullChest\(\{ moved: moved \+ altMoved, capped, blocked, valuableBlocked: valuableBlocked > 0 \? valuableLeft\(\) : 0,/)
  const pr = strip(readFileSync(new URL('../src/prompt.mjs', import.meta.url), 'utf8'))
  assert.match(pr, /depositDue\(\{ bankable: bank\.demand,/)
  const ad = strip(readFileSync(new URL('../src/admission.mjs', import.meta.url), 'utf8'))
  assert.match(ad, /bankable: bank\.demand,/)
  const ms = strip(readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8'))
  assert.match(ms, /\.demand < 4 \|\| bankClosed\(b, b\.inventory\?\.items\?\.\(\) \?\? \[\]\)\) return true/)
  assert.match(sk, /deposit\(ctx, \{ item \}, signal, \{ noRecovery: true, preferAt: put\.at, onlyValuable: true \}\)/, 'the new chest takes the valuables only')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
