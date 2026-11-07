// market-01 (market.mjs; docs/reports/market-design-2026-11-06.md): the market's pure decisions and its window driver.
// Behaviour: the wants, the spare goods, the merchants a run may visit (never one inside a protected zone), the goods to carry,
// the sale and the purchase on windows shaped as mineflayer 4.37.1 parses Paper 1.21.8's trade list (sandbox4 11-06), the run's
// admission, the merchant opener (a wandering trader through openVillager), the trade driver against a fake window that moves
// items as the server did, the job block choice, the FREE-jobless test (6_1's penned villagers never qualify), the market cell
// outside a zone box, and buildOrder's idle branch. Structural (behaviour cannot reach it): the skills are registered and
// features.mjs calls the install. Mutants assert their anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-market-logs-'))
process.env.BOT_NAME = 'MarketBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-market-pool-'))

const M = await import('../src/market.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const SRC = new URL('../src/market.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-market-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// a trade as mineflayer 4.37.1 builds it (villager.js gotTrades): inputItem1 / outputItem items, realPrice, uses
const T = (inName, n, outName, outN, { left = 12, price = n, in2 = null, disabled = false } = {}) => ({
  inputItem1: { name: inName, count: n }, outputItem: { name: outName, count: outN }, hasItem2: !!in2, inputItem2: in2 ? { name: in2[0], count: in2[1] } : undefined,
  realPrice: price, nbTradeUses: 0, maximumNbTradeUses: left, tradeDisabled: disabled })
// an entity as the client tracks it: villager metadata 18 = villager_data, 16 = baby (merchantscout / trade.mjs)
const PROF = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']
const VIL = (id, x, z, prof = 'toolsmith', { level = 1, baby = false, y = 64 } = {}) => ({ id, uuid: `u${id}`, name: 'villager', position: { x, y, z }, metadata: { 18: { villagerType: 0, villagerProfession: PROF.indexOf(prof), level }, ...(baby ? { 16: true } : {}) } })
const WT = (id, x, z) => ({ id, uuid: `u${id}`, name: 'wandering_trader', position: { x, y: 64, z }, metadata: {} })
const HOME = { x: 0, y: 70, z: 0 }
const ZONE = { id: 'village-taiga-6_1', box: [49, -64, -59, 157, 320, 45] }

await t('townWants: the owner\'s list first; need = target - town - bag; any colour of wool; nothing wanted at target', () => {
  const w = M.townWants({ lapis_lazuli: 168, redstone: 26, white_wool: 10 }, { gray_wool: 2, lantern: 16 })
  const by = Object.fromEntries(w.map(x => [x.key, x]))
  assert.equal(by.wool.need, 20, '32 - 10 white - 2 gray')
  assert.equal(by.redstone.need, 38)
  assert.equal(by.lapis_lazuli, undefined, 'POSITIVE: 168 lapis >= 64 is no want')
  assert.equal(by.lantern, undefined, 'the bag\'s 16 lanterns count')
  assert.equal(w[0].key, 'wool', 'the owner\'s wants rank first')
  assert.ok(w.findIndex(x => x.key === 'brick') > w.findIndex(x => x.key === 'redstone'))
})

await t('spareGoods: only above the town keep, at most carry; the bag\'s own count; diamonds / lapis are never goods', () => {
  const s = M.spareGoods({ iron_ingot: 225, coal: 83, stone: 2, diamond: 42, lapis_lazuli: 168, glass_pane: 48 }, { coal: 5 })
  assert.deepEqual(s, { iron_ingot: 48, coal: 24, glass_pane: 16 })
})

await t('runCandidates: employed adults and wandering traders near home, outside every zone (+3); jobless/nitwit/baby/far/in-zone never', () => {
  const ents = {
    1: VIL(1, 20, 10, 'toolsmith'), 2: VIL(2, 80, -3, 'none'), 3: VIL(3, 25, 5, 'nitwit'), 4: VIL(4, 22, 8, 'mason', { baby: true }),
    5: VIL(5, 300, 0, 'fletcher'), 6: VIL(6, 60, 0, 'fletcher'), 7: VIL(7, 47, 0, 'fletcher'), 8: WT(8, -28, 9), 9: VIL(9, 44, 0, 'cleric'),
  }
  const c = M.runCandidates(ents, HOME, [ZONE])
  assert.deepEqual(c.map(m => m.uuid), ['u1', 'u8', 'u9'], 'the toolsmith, the trader, and the cleric 5 b outside the box')
  assert.equal(M.runCandidates(ents, HOME, []).some(m => m.uuid === 'u6'), true, 'POSITIVE: with no zone the fletcher at 60,0 is a candidate')
})

await t('goodsFor: known offers -> only goods they buy with uses left, in whole trades; unread -> the profession\'s catalogue', () => {
  const spare = { iron_ingot: 48, coal: 24, stick: 100 }
  const known = [{ in: 'coal', n: 15, out: 'emerald', left: 16 }, { in: 'iron_ingot', n: 4, out: 'emerald', left: 3 }, { in: 'emerald', n: 1, out: 'bell', left: 12 }]
  assert.deepEqual(M.goodsFor({ profession: 'toolsmith', level: 2 }, { known, spare }), { coal: 15, iron_ingot: 12 })
  assert.deepEqual(M.goodsFor({ profession: 'fletcher', level: 1 }, { spare }), { stick: 96 }, 'unread fletcher: sticks in trades of 32')
  assert.deepEqual(M.goodsFor({ profession: 'toolsmith', level: 1 }, { spare }), { coal: 15 }, 'a novice toolsmith: coal only (iron is level 2)')
  assert.deepEqual(M.goodsFor({ profession: 'wandering_trader' }, { spare: { water_bucket: 2 } }), { water_bucket: 2 })
})

await t('sellOffers: goods -> emerald with uses left, from what was drawn only, never a second input or a non-good', () => {
  const trades = [T('coal', 15, 'emerald', 1, { left: 1 }), T('diamond', 1, 'emerald', 1), T('iron_ingot', 4, 'emerald', 1, { left: 12 }), T('emerald', 1, 'bell', 1, { price: 36 }), T('stick', 32, 'emerald', 1, { in2: ['string', 1] })]
  const plan = M.sellOffers(trades, { coal: 40, iron_ingot: 10, diamond: 5, stick: 64 })
  assert.deepEqual(plan.map(p => [p.item, p.times]), [['iron_ingot', 2], ['coal', 1]], 'iron (4 an emerald) before coal (15); diamonds never; coal capped at its 1 use left')
  assert.deepEqual(M.sellOffers([T('water_bucket', 1, 'emerald', 2, { left: 2 })], { water_bucket: 1 }).map(p => p.times), [1], 'only the drawn bucket')
  assert.deepEqual(M.sellOffers([T('coal', 15, 'emerald', 1, { disabled: true })], { coal: 60 }), [])
})

await t('buyOffers: wanted outputs only, at or under the ceiling, capped by need and by the emeralds; the owner\'s first', () => {
  const wants = M.townWants({}, {})
  const trades = [T('emerald', 1, 'brick', 10, { left: 16 }), T('emerald', 1, 'redstone', 2, { left: 12 }), T('emerald', 36, 'bell', 1, { left: 12 }), T('emerald', 9, 'iron_chestplate', 1), T('emerald', 3, 'lantern', 1)]
  const plan = M.buyOffers(trades, { emeralds: 8, wants })
  assert.deepEqual(plan.map(p => [p.what, p.times]), [['redstone', 8]], 'redstone (owner) takes all 8: 64 wanted = 32 trades; lantern at 3 > ceiling 2; brick after')
  const plan2 = M.buyOffers(trades, { emeralds: 40, wants: wants.filter(w => w.key !== 'redstone') })
  assert.deepEqual(plan2.map(p => [p.what, p.times]), [['brick', 16], ['bell', 0]].filter(p => p[1]), 'bricks to their 16 uses; the bell (36) not affordable after')
  assert.deepEqual(M.buyOffers([T('emerald', 1, 'brick', 10)], { emeralds: 5, wants: [] }), [], 'no want, no purchase')
})

await t('marketRunAdmit: each refusal names its reason; an unread merchant is worth one look; known offers with goods trade', () => {
  const now = 1e12
  const c = [{ uuid: 'u1', profession: 'toolsmith', level: 2, x: 10, z: 0 }]
  const base = { on: true, atTown: true, now, timeOfDay: 2000, candidates: c, spare: { iron_ingot: 48 } }
  assert.equal(M.marketRunAdmit({ ...base, on: false }).why, 'off')
  assert.equal(M.marketRunAdmit({ ...base, atTown: false }).why, 'away')
  assert.equal(M.marketRunAdmit({ ...base, timeOfDay: 13000 }).why, 'night')
  assert.equal(M.marketRunAdmit({ ...base, state: { lastRunAt: now - 60_000 } }).why, 'cooldown')
  assert.equal(M.marketRunAdmit({ ...base, candidates: [] }).why, 'no_merchant')
  assert.equal(M.marketRunAdmit({ ...base, restOf: () => now + 1 }).why, 'nothing_to_trade', 'a resting merchant')
  const look = M.marketRunAdmit({ ...base, spare: {} })
  assert.equal(look.ok && look.why, 'look', 'unread: one look even with nothing to sell')
  const known = { at: now - 1000, offers: [{ in: 'iron_ingot', n: 4, price: 4, out: 'emerald', out_n: 1, left: 12 }] }
  const go = M.marketRunAdmit({ ...base, offersOf: () => known })
  assert.deepEqual([go.ok, go.why, go.goods], [true, 'trade', { iron_ingot: 48 }])
  assert.equal(M.marketRunAdmit({ ...base, offersOf: () => known, spare: {} }).why, 'nothing_to_trade', 'known offers, nothing to sell or buy')
  assert.equal(M.marketRunAdmit({ ...base, leased: true }).why, 'leased')
})

await t('openMerchant: a wandering trader is opened as a villager view (same entity id); a villager passes through', async () => {
  const seen = []
  const bot = { registry: { entitiesByName: { villager: { id: 147 } } }, openVillager: async e => { seen.push([e.id, e.entityType]); return 'win' } }
  await M.openMerchant(bot, { id: 9, entityType: 148, name: 'wandering_trader' })
  await M.openMerchant(bot, { id: 3, entityType: 147, name: 'villager' })
  assert.deepEqual(seen, [[9, 147], [3, 147]])
})

// a fake window: the server takes the inputs and gives the output on trade(i, n), as Paper did (sandbox4: coal 40 -> 25)
function fakeWindow (bag, trades, { throwAt = null } = {}) {
  const inv = { ...bag }
  return {
    trades,
    items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
    trade: async (i, n) => {
      if (throwAt === i) throw new Error('Not enough item 1 to trade')
      const t = trades[i]
      inv[t.inputItem1.name] -= t.realPrice * n
      inv[t.outputItem.name] = (inv[t.outputItem.name] ?? 0) + t.outputItem.count * n
    },
    inv,
  }
}
await t('runTrades: counts what the window moved; buys after sells; the first throw halts the window', async () => {
  const trades = [T('iron_ingot', 4, 'emerald', 1), T('emerald', 1, 'brick', 10)]
  const v = fakeWindow({ iron_ingot: 12, emerald: 0 }, trades)
  const r = await M.runTrades(v, { sells: [{ i: 0, times: 3, item: 'iron_ingot' }], buys: [{ i: 1, times: 2, what: 'brick' }] }, { sleep: async () => {} })
  assert.deepEqual([r.sold, r.earned, r.spent, r.bought, r.halt], [{ iron_ingot: 12 }, 3, 2, { brick: 20 }, false])
  const v2 = fakeWindow({ iron_ingot: 12 }, trades, { throwAt: 0 })
  const r2 = await M.runTrades(v2, { sells: [{ i: 0, times: 3, item: 'iron_ingot' }], buys: [{ i: 1, times: 2, what: 'brick' }] }, { sleep: async () => {} })
  assert.equal(r2.halt, true); assert.deepEqual(r2.bought, {}, 'no purchase after a failed sale')
})

await t('runTrades: never trades into a full bag (putAway would DROP the output); a purchase capped by the room it has', async () => {
  const trades = [T('iron_ingot', 4, 'emerald', 1), T('emerald', 1, 'cherry_log', 8, { left: 4 })]
  const full = fakeWindow({ iron_ingot: 12, emerald: 2 }, trades)
  full.inventoryStart = 3; full.inventoryEnd = 39; full.slots = Array.from({ length: 39 }, (_, i) => (i >= 3 && i < 38 ? { name: 'dirt' } : null))
  assert.equal(M.freeSlotsIn(full), 1)
  const r = await M.runTrades(full, { sells: [{ i: 0, times: 3, item: 'iron_ingot' }] }, { sleep: async () => {} })
  assert.deepEqual([r.halt, r.why, r.sold], [true, 'bag_full', {}], 'one free slot < MIN_FREE: no trade')
  const roomy = fakeWindow({ emerald: 4 }, trades)
  roomy.inventoryStart = 3; roomy.inventoryEnd = 39; roomy.slots = Array.from({ length: 39 }, (_, i) => (i >= 3 && i < 36 ? { name: 'dirt' } : null))
  assert.equal(M.freeSlotsIn(roomy), 3, 'POSITIVE: three free')
  const r2 = await M.runTrades(roomy, { buys: [{ i: 1, times: 4, what: 'cherry_log', per: 8 }] }, { sleep: async () => {} })
  assert.deepEqual([r2.halt, r2.bought], [false, { cherry_log: 32 }], '32 logs fit one slot past the two kept free')
  assert.equal(M.freeSlotsIn({}), 36, 'a window with no slots reads as room (the fake windows above)')
})

await t('nextJobBlock: one of each profession, the town\'s surplus first; present / placed skipped; unmakeable never', () => {
  const stock = { iron_ingot: 225, spruce_log: 125, coal: 83, stone: 2 }
  assert.deepEqual(M.nextJobBlock({ stock }), { block: 'smithing_table', profession: 'toolsmith' })
  assert.deepEqual(M.nextJobBlock({ stock, present: ['toolsmith'] }), { block: 'composter', profession: 'farmer' }, 'market-02 D2: the farmer second')
  assert.deepEqual(M.nextJobBlock({ stock, present: ['toolsmith', 'farmer'] }), { block: 'barrel', profession: 'fisherman' })
  assert.equal(M.nextJobBlock({ stock, placed: ['smithing_table', 'composter', 'barrel'] }), null, 'no flint, no stone, no paper: nothing else')
  assert.deepEqual(M.nextJobBlock({ stock: { ...stock, flint: 4 }, placed: ['smithing_table', 'composter', 'barrel'] }).block, 'fletching_table')
  assert.equal(M.nextJobBlock({ stock: { iron_ingot: 60, spruce_log: 3 } })?.block, 'composter', 'iron at its keep: no smithing table')
  assert.ok(!Object.values(M.JOB_RECIPES).length || !('lectern' in M.JOB_RECIPES || 'loom' in M.JOB_RECIPES || 'brewing_stand' in M.JOB_RECIPES))
})

await t('freeJobless: a villager seen 6+ b away 5+ min later is free; 6_1\'s penned villagers (<= 3 b) never', () => {
  const now = 1e12
  let seen = {}
  seen = M.noteJobless(seen, [{ uuid: 'p', x: 80.3, z: -3.7, profession: 'none' }, { uuid: 'f', x: 60, z: 0, profession: 'none' }, { uuid: 'e', x: 0, z: 0, profession: 'mason' }], now - 10 * 60_000)
  seen = M.noteJobless(seen, [{ uuid: 'p', x: 82.7, z: -3.3, profession: 'none' }, { uuid: 'f', x: 52, z: 3, profession: 'none' }], now)
  assert.deepEqual(M.freeJobless(seen, now), ['f'])
  assert.equal(seen.e, undefined, 'an employed villager is not tracked')
  assert.deepEqual(M.freeJobless(seen, now + 60 * 60_000), [], 'old sightings expire')
})

// a flat grass world at y 63 (feet 64)
const world = (over = {}) => (x, y, z) => { const k = `${x},${y},${z}`; if (k in over) return { name: over[k] }; return { name: y < 64 ? 'grass_block' : 'air' } }
await t('marketCell: a free cluster inside the zone -> an open cell just OUTSIDE the box (+pad), within the claim reach', () => {
  const cl = M.unemployedClusters([{ uuid: 'a', x: 60.5, y: 64, z: 0.5, profession: 'none' }, { uuid: 'b', x: 62.5, y: 64, z: 2.5, profession: 'none' }])[0]
  const r = M.marketCell(world(), cl, { zones: [ZONE] })
  assert.ok(r.cell, r.why)
  assert.ok(r.cell.x < 49 - 3, `outside the box + pad: x=${r.cell.x}`)
  assert.ok(r.d <= M.MARKET.claimReach)
  assert.equal(r.cell.y, 64)
  const deep = M.unemployedClusters([{ uuid: 'c', x: 100.5, y: 64, z: 0.5, profession: 'none' }])[0]
  assert.equal(M.marketCell(world(), deep, { zones: [ZONE] }).why, 'zone_too_deep', 'a cluster 51 b inside: no market within reach')
  // the nearest side (west) is open water: the next side within reach (south, z 45 + 5) takes the market
  const wet = {}
  for (let x = 30; x <= 48; x++) for (let z = -40; z <= 70; z++) wet[`${x},63,${z}`] = 'water'
  const cl2 = M.unemployedClusters([{ uuid: 'w', x: 55.5, y: 64, z: 30.5, profession: 'none' }])[0]
  const r2 = M.marketCell(world(wet), cl2, { zones: [ZONE] })
  assert.ok(r2.cell && r2.cell.z > 45 + 3, `another side: ${JSON.stringify(r2)}`)
  const second = M.marketCell(world(), cl, { zones: [ZONE], existing: [r.cell] })
  assert.ok(second.cell && Math.hypot(second.cell.x - r.cell.x, second.cell.z - r.cell.z) >= M.MARKET.slotSpacing, 'the next block a slot apart')
})

// ---- market-02: walk-in trips, beds, the decor tier -----------------------------------------------------------------
const Z23 = { id: 'village-taiga-23_-20', box: [301, -64, -404, 447, 86, -265] }
const TRIAL = { id: 'trial-chambers-home-se', box: [-20, -64, 65, 88, 31, 164] }
await t('walkinTargets: village zones only, beyond 96 b and within 600 b of home, nearest first; a resting village skipped', () => {
  const far = { id: 'village-snowy-1_54', box: [-56, -64, 782, 86, 91, 942] }
  assert.deepEqual(M.walkinTargets([ZONE, Z23, far, TRIAL], HOME).map(z => [z.id, z.dist]), [['village-taiga-6_1', 103], ['village-taiga-23_-20', 502]])
  assert.deepEqual(M.walkinTargets([Z23], HOME, { now: 10, rest: { [Z23.id]: 11 } }), [], 'resting')
})
await t('walkinAdmit / walkinLeave: morning starts only; inside a zone at most 8 min and never still 4 min (Z1 needs 15)', () => {
  const base = { on: true, atTown: true, now: 1e12, timeOfDay: 1000, targets: [{ id: 'v' }] }
  assert.equal(M.walkinAdmit(base).ok, true)
  for (const [k, v, why] of [['timeOfDay', 6000, 'not_morning'], ['atTown', false, 'away'], ['targets', [], 'no_village'], ['leased', true, 'leased'], ['health', 14, 'health']]) assert.equal(M.walkinAdmit({ ...base, [k]: v }).why, why)
  assert.equal(M.walkinLeave({ dwell: 7 * 60_000, still: 3 * 60_000, timeOfDay: 5000 }), null, 'POSITIVE: a short visit stays')
  assert.equal(M.walkinLeave({ dwell: 8 * 60_000 }), 'dwell')
  assert.equal(M.walkinLeave({ still: 4 * 60_000 }), 'still')
  assert.equal(M.walkinLeave({ timeOfDay: 11600 }), 'dusk')
  assert.ok(M.WALKIN.dwellMs < 15 * 60_000 && M.WALKIN.stillMs < 15 * 60_000, 'both under the showcase tripwire Z1 15-min still-in-a-zone rule')
})
await t('walkinCandidates: employed adults INSIDE the village box only; legsTo / edgeOf walk to just outside it', () => {
  const ents = { 1: VIL(1, 370, -330, 'librarian'), 2: VIL(2, 372, -332, 'none'), 3: VIL(3, 200, -330, 'cleric'), 4: VIL(4, 380, -300, 'shepherd', { baby: true }) }
  assert.deepEqual(M.walkinCandidates(ents, { x: 300, z: -260 }, Z23).map(m => m.uuid), ['u1'])
  const e = M.edgeOf(Z23.box, HOME)
  assert.deepEqual(e, { x: 296, z: -260 }, 'the corner nearest home, 5 b out')
  const legs = M.legsTo(HOME, e)
  assert.ok(legs.length === Math.ceil(Math.hypot(296, 260) / 48) && legs.at(-1).x === 296 && legs.at(-1).z === -260)
})
await t('bedCells: foot and head outside the zone + pad, the stand behind the foot (the head goes where the placer faces)', () => {
  const cl = M.unemployedClusters([{ uuid: 'a', x: 60.5, y: 64, z: 0.5, profession: 'none' }])[0]
  const b = M.bedCells(world(), cl, { zones: [ZONE] })
  assert.ok(b.foot && b.head && b.stand, b.why)
  for (const c of [b.foot, b.head]) assert.equal(M.zoneNear([ZONE], c.x, c.z, M.MARKET.zonePad), null, `outside the pad: ${JSON.stringify(c)}`)
  assert.deepEqual([b.stand.x - b.foot.x, b.stand.z - b.foot.z], [-2 * b.dir[0], -2 * b.dir[1]])
})
await t('the decor tier is LAST: an owner want before a cheaper decoration, and a build block before decor (OWNER 11-07 D3)', () => {
  const wants = M.townWants({}, {})
  const plan = M.buyOffers([T('emerald', 1, 'poppy', 1), T('emerald', 1, 'brick', 10), T('emerald', 1, 'lantern', 1)], { emeralds: 13, wants })
  assert.deepEqual(plan.map(p => [p.what, p.times]), [['lantern', 12], ['brick', 1]], 'lanterns (owner) to their 12 uses, then bricks (build); the poppy gets nothing')
  assert.deepEqual([M.tierOf({ why: 'owner' }), M.tierOf({ why: 'breeding' }), M.tierOf({ why: 'build' }), M.tierOf({ why: 'palette' }), M.tierOf({ why: 'decor' })], [0, 0, 1, 2, 2])
})
await t('MUTANT KILLED: without the dwell cap a trip could stand in a village past the tripwire\'s 15 min', async () => {
  await withMutant(SRC, "  if (dwell >= WALKIN.dwellMs) return 'dwell'\n", '', async X => {
    assert.equal(X.walkinLeave({ dwell: 16 * 60_000 }), null)
  })
})
await t('MUTANT KILLED: a walk-in that trades with merchants OUTSIDE the target box', async () => {
  await withMutant(SRC, '    if (!(b && m.x >= b[0] && m.x <= b[3] + 1 && m.z >= b[2] && m.z <= b[5] + 1)) continue\n', '', async X => {
    assert.equal(X.walkinCandidates({ 3: VIL(3, 200, -330, 'cleric') }, { x: 300, z: -260 }, Z23).length, 1)
  })
})
await t('MUTANT KILLED: the decor tier ignored (table order only)', async () => {
  await withMutant(SRC, '  rows.sort((a, b) => tierOf(a.w) - tierOf(b.w) || a.rank - b.rank || a.price - b.price)', '  rows.sort((a, b) => b.rank - a.rank || a.price - b.price)', async X => {
    const plan = X.buyOffers([T('emerald', 1, 'poppy', 1), T('emerald', 1, 'lantern', 1)], { emeralds: 1, wants: X.townWants({}, {}) })
    assert.deepEqual(plan.map(p => p.what), ['poppy'])
  })
})

// ---- buildOrder's idle branch ----------------------------------------------------------------------------------------
const S = await import('../src/shop.mjs')
await t('buildOrder: the market ask in the idle branch (projects complete), not while the projects have work', () => {
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {} }
  const busy = S.buildOrder(base)
  S.setMarketAsk(() => ({ order: { skill: 'market_run', args: { uuid: 'u1' } } }))
  try {
    assert.deepEqual(S.buildOrder({ ...base, complete: true }), { order: { skill: 'market_run', args: { uuid: 'u1' } }, skip: null })
    assert.deepEqual(S.buildOrder(base), busy, 'a bot the projects can use is not sent to market')
    assert.deepEqual(S.buildOrder({ ...base, complete: true, atTown: false }), { order: null, skip: null })
  } finally { S.setMarketAsk(null) }
})

// ---- structural -----------------------------------------------------------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const FEATURES = new URL('../src/features.mjs', import.meta.url)
const INSTALL_LINE = "try { marketInstall(bot) } catch (e) { log('warn', 'market not installed', { error: e.message }) }"
await t('STRUCTURAL: installFeatures calls marketInstall; market_run / market_job are registered chatOnly with contracts', async () => {
  assert.equal(strip(readFileSync(FEATURES, 'utf8')).split(INSTALL_LINE).length, 2)
  const K = await import('../src/skills.mjs')
  for (const k of ['market_run', 'market_job', 'market_trip']) {
    assert.equal(typeof K.SKILLS[k]?.run, 'function', k)
    assert.equal(K.SKILLS[k].chatOnly, true, k)
    assert.ok(K.SKILL_CONTRACTS[k]?.maxMs > 0, k)
  }
})

// ---- mutants ---------------------------------------------------------------------------------------------------------
await t('MUTANT KILLED: without the zone check a run would walk to a merchant inside the village', async () => {
  await withMutant(SRC, '    if (zoneNear(zones, Math.floor(m.x), Math.floor(m.z))) continue\n', '', async X => {
    const c = X.runCandidates({ 6: VIL(6, 60, 0, 'fletcher') }, HOME, [ZONE])
    assert.equal(c.length, 1, 'the mutant offers the fletcher inside the zone')
  })
})
await t('MUTANT KILLED: without the uses-left cap the sale overruns the villager\'s stock', async () => {
  await withMutant(SRC, '    const times = Math.min(usesLeft(t), Math.floor((left[item] ?? 0) / price))', '    const times = Math.floor((left[item] ?? 0) / price)', async X => {
    assert.equal(X.sellOffers([T('coal', 15, 'emerald', 1, { left: 1 })], { coal: 60 })[0].times, 4)
  })
})
await t('MUTANT KILLED: without the ceiling the purchase pays any price', async () => {
  await withMutant(SRC, '    if (!(price > 0) || price > w.ceiling) continue', '    if (!(price > 0)) continue', async X => {
    assert.equal(X.buyOffers([T('emerald', 3, 'lantern', 1)], { emeralds: 8, wants: X.townWants({}, {}) }).length, 1)
  })
})
await t('MUTANT KILLED: a free test that accepts any sighting places job blocks for penned villagers', async () => {
  await withMutant(SRC, 'Math.hypot(p[j].x - p[i].x, p[j].z - p[i].z) >= MARKET.freeMoveB', 'true', async X => {
    const now = 1e12
    let seen = X.noteJobless({}, [{ uuid: 'p', x: 80.3, z: -3.7, profession: 'none' }], now - 10 * 60_000)
    seen = X.noteJobless(seen, [{ uuid: 'p', x: 82.7, z: -3.3, profession: 'none' }], now)
    assert.deepEqual(X.freeJobless(seen, now), ['p'])
  })
})
await t('MUTANT KILLED: without the zone fence the market cell may fall inside the box', async () => {
  await withMutant(SRC, "  const fenced = (x, y, z) => (zoneNear(zones, x, z, MARKET.zonePad + 1) ? { name: 'bedrock' } : blockAt(x, y, z))", '  const fenced = blockAt', async X => {
    // the ground west of the pad is leaf canopy (no floor a job block may stand on): only cells in the pad (x 46..48) are open
    const over = {}
    for (let x = 30; x <= 45; x++) for (let z = -14; z <= 14; z++) over[`${x},64,${z}`] = 'oak_leaves'
    const cl = M.unemployedClusters([{ uuid: 'a', x: 60.5, y: 64, z: 0.5, profession: 'none' }])[0]
    assert.equal(M.marketCell(world(over), cl, { zones: [ZONE] }).cell, null, 'POSITIVE: the real fence finds no cell')
    const r = X.marketCell(world(over), cl, { zones: [ZONE] })
    assert.ok(r.cell && r.cell.x >= 49 - 3, `the mutant picks x=${r.cell?.x}, inside the pad`)
  })
})
await t('MUTANT KILLED: dropping the market ask from buildOrder', async () => {
  await withMutant(new URL('../src/shop.mjs', import.meta.url), '    try { mk = marketAskOf({ now, health, freeSlots }) } catch { mk = null }', '    mk = null', async X => {
    X.setMarketAsk(() => ({ order: { skill: 'market_run', args: {} } }))
    assert.notEqual(X.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, complete: true }).order?.skill, 'market_run')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
