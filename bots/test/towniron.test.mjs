// TOWNIRON-01: THE TOWN IRON RESERVE (docs/reports/towniron-01-design-2026-10-23.md; OWNER 10-23 A "option 1", B "build it now").
// One setting, two consumers: the iron task stays open for the town (milestones.mjs gather_iron_ore_town), and the toolkit's
// shovel tier drops to stone while the town is short (toolkit.mjs kitNeeds).
//
// Behaviour, not text: the pure decisions (townIronStock, townIronLow, kitNeeds/kitDraw/toolkitOrder with lowIron, the rung's
// done and means), then THE REFUSAL CHAINS through the real components -- the real MilestoneController (the rung opens only for
// a short town, never ahead of the bot's own iron rungs, and releases by no-means and by the no-progress skip), the real town
// deposit plan (the round's carried iron is banked), and the real toolkit skill over the fake world (a stone shovel made, no
// town iron drawn; the base control draws iron) -- and anchored, unique mutants (climb-escape.test.mjs's withMutant).
//
// MEASURED 10-23 (24 h): the kit drew 710 ingots (277 iron shovels, each worn out: 289 broke), 184 of 667 kit runs failed
// no_iron, all in towns at <= 86 index-known ingots.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-towniron-logs-'))
process.env.BOT_NAME = 'TownIronBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.LOG_LEVEL = 'error'
process.env.PLINTH_FIRST = '0'
delete process.env.TOWNIRON; delete process.env.TOWN_IRON_RESERVE
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-towniron-pool-')) }
freshPool()

const TIM = await import('../src/towniron.mjs')
const K = await import('../src/toolkit.mjs')
const S0 = await import('../src/skills.mjs')
const MS = await import('../src/milestones.mjs')
const TD = await import('../src/towndeposit.mjs')
const TI = await import('../src/townindex.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const SRC = p => new URL(`../src/${p}`, import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function withMutants (p, pairs, fn) {
  let src = readFileSync(p, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const NOW = 1_800_000_000_000
const obs = (k, names, at = NOW - 60_000) => ({ obs: { at, names, h: [k] }, last: { t: 'obs', at } })
const town = (units, n = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${i},64,0`, obs(`${i},64,0`, i === 0 ? { iron_ingot: [units, 1] } : { dirt: [5, 1] })]))
/** the reader, set to a fixed reading: a stock { units } or null (unknown) */
const readerSays = (stock, M = TIM) => { M.setTownIronReader(() => stock); M.resetTownIronMemo() }

// ---- the reading -----------------------------------------------------------------------------------------------------------
await t('townIronStock: fresh observations count iron_ingot + raw_iron; stale / future-dated do not; fewer than 3 fresh -> unknown; unreadable -> unknown', () => {
  const e = { a: obs('a', { iron_ingot: [10, 1], raw_iron: [5, 1] }), b: obs('b', { raw_iron: [7, 1] }), c: obs('c', { dirt: [3, 1] }),
              d: obs('d', { iron_ingot: [99, 2] }, NOW - TIM.TOWN_IRON_OBS_MS - 1), f: obs('f', { iron_ingot: [99, 2] }, NOW + 120_000) }
  assert.deepEqual(TIM.townIronStock(e, NOW), { units: 22, ingots: 10, raw: 12, containers: 3, seen: 5 })
  assert.equal(TIM.townIronStock({ a: e.a, b: e.b }, NOW), null, 'two fresh containers: unknown')
  assert.equal(TIM.townIronStock(null, NOW), null); assert.equal(TIM.townIronStock({}, NOW), null)
  // A MUTATION SINCE THE OBSERVATION (a withdrawal, a deposit) drops it: never counted after it may have left (Codex r1 P2)
  const dirty = { ...e, g: obs('g', { dirt: [1, 1] }), a: { ...e.a, last: { t: 'dirty', at: NOW - 1000 } } }
  assert.deepEqual(TIM.townIronStock(dirty, NOW), { units: 7, ingots: 0, raw: 7, containers: 3, seen: 6 })
})
await t('townIronLow: true below the reserve, false at or above, null when unknown or switched off; the reserve defaults to 64; the mode row names it', () => {
  assert.equal(TIM.TOWN_IRON_RESERVE, 64)
  assert.equal(TIM.townIronLow({ units: 63 }), true); assert.equal(TIM.townIronLow({ units: 64 }), false)
  assert.equal(TIM.townIronLow(null), null); assert.equal(TIM.townIronLow({ units: 0 }, { on: false }), null)
  assert.equal(TIM.townIronLow({ units: 70 }, { reserve: 80 }), true)
  for (const v of ['off', '0', 'false', 'no']) assert.equal(TIM.townIronMode({ TOWNIRON: v }).on, false)
  assert.equal(TIM.townIronMode({}).on, true)
  assert.match(TIM.townIronModeDetail(), /^phase=mode on=1 mode=on reserve=64 carry=16 self=3 min_ctrs=3 obs_h=6 consumers=iron_task,shovel_tier/)
})
await t('the reader: unknown with no reader; memoised; townIronLowNow true only when KNOWN short', () => {
  TIM.setTownIronReader(null)
  assert.equal(TIM.townIronNow(), null); assert.equal(TIM.townIronLowNow(), false)
  let calls = 0
  TIM.setTownIronReader(() => { calls++; return { units: 10 } })
  assert.equal(TIM.townIronLowNow(NOW), true); assert.equal(TIM.townIronLowNow(NOW + 1000), true)
  assert.equal(calls, 1, 'one read per memo window')
  TIM.townIronNow(NOW + TIM.TOWN_IRON_MEMO_MS + 1); assert.equal(calls, 2)
  readerSays(null); assert.equal(TIM.townIronLowNow(), false, 'unknown is not short')
  TIM.setTownIronReader(null)
})

await t('ironOwnKeep restates the town deposit\'s ironUnitsNeeded (3 per iron craft not made, at least 3); deliverPlan keeps ingots first, banks the rest per name', () => {
  for (const c of [{}, { bucket: 1 }, { iron_pickaxe: 1 }, { bucket: 1, iron_pickaxe: 1 }]) assert.equal(TIM.ironOwnKeep(c), TD.ironUnitsNeeded(c), JSON.stringify(c))
  const own = { bucket: 1, iron_pickaxe: 1 }
  assert.deepEqual(TIM.deliverPlan({ ...own, raw_iron: 19 }), { iron_ingot: { deposit: 0, own: 0 }, raw_iron: { deposit: 16, own: 3 }, surplus: 16 })
  assert.deepEqual(TIM.deliverPlan({ ...own, iron_ingot: 2, raw_iron: 17 }), { iron_ingot: { deposit: 0, own: 2 }, raw_iron: { deposit: 16, own: 1 }, surplus: 16 })
  assert.deepEqual(TIM.deliverPlan({ raw_iron: 19 }), { iron_ingot: { deposit: 0, own: 0 }, raw_iron: { deposit: 13, own: 6 }, surplus: 13 }, 'no bucket, no pickaxe: 6 kept')
})
const own = { bucket: 1, iron_pickaxe: 1 }
await t('deliverOrder: only a RECORDED round is town cargo; at town any surplus above the own keep -> deliver_iron; no round, away, off, cooldown -> none; a failure backs off', () => {
  const R = { round: true }
  assert.equal(TIM.deliverOrder({ now: 1e12, atTown: true, counts: { ...own, raw_iron: 19 } }).skip, 'no_round', 'the bag\'s own surplus, never mined for the town: not delivered')
  const o = TIM.deliverOrder({ now: 1e12, atTown: true, counts: { ...own, raw_iron: 19 }, state: R })
  assert.equal(o.order?.skill, 'deliver_iron'); assert.equal(o.state.lastIssuedAt, 1e12)
  assert.equal(TIM.deliverOrder({ now: 1e12, atTown: true, counts: { ...own, raw_iron: 4 }, state: R }).order?.skill, 'deliver_iron', 'a remainder of 1 is retried (Codex r2 P1)')
  const none = TIM.deliverOrder({ now: 1e12, atTown: true, counts: { ...own, raw_iron: 3 }, state: R })
  assert.equal(none.skip, 'none'); assert.equal(none.state.round, undefined, 'nothing above the keep: the round is over')
  assert.equal(TIM.deliverOrder({ now: 1e12, atTown: false, counts: { ...own, raw_iron: 19 }, state: R }).skip, 'away')
  assert.equal(TIM.deliverOrder({ now: 1e12, on: false, atTown: true, counts: { ...own, raw_iron: 19 }, state: R }).skip, 'off')
  assert.equal(TIM.deliverOrder({ now: 1e12 + 1000, atTown: true, counts: { ...own, raw_iron: 19 }, state: o.state }).skip, 'cooldown')
  const b = TIM.deliverOutcome('failed', 1e12, R); assert.equal(b.backoffUntil, 1e12 + TIM.DELIVER_BACKOFF_MS); assert.equal(b.round, true)
  assert.equal(TIM.deliverOutcome('success', 1e12, R, { surplusLeft: 0 }).round, undefined, 'all banked: the round ends')
  assert.equal(TIM.deliverOutcome('success', 1e12, R, { surplusLeft: 15 }).round, true, 'a partial delivery keeps it')
  assert.deepEqual(TIM.noteTownRound({}, 'gather_iron_ore_town#4'), { round: true }); assert.deepEqual(TIM.noteTownRound({}, 'gather_iron_ore_town+prereq'), { round: true })
  assert.deepEqual(TIM.noteTownRound({}, 'gather_iron_ore_3'), {})
})
await t('the round ends where the delivery has a round to bank (Codex r2 P2): townTaskCarried = 16 above the OWN keep, whatever the keep', () => {
  const items = c => Object.entries(c).map(([name, count]) => ({ name, count }))
  assert.equal(TIM.townTaskCarried(items({ ...own, raw_iron: 19 })), true)
  assert.equal(TIM.townTaskCarried(items({ ...own, raw_iron: 18 })), false)
  assert.equal(TIM.townTaskCarried(items({ raw_iron: 19 })), false, 'no bucket, no pickaxe: 6 own, 13 above: not yet')
  assert.equal(TIM.townTaskCarried(items({ raw_iron: 22 })), true)
})

// ---- consumer 2: the shovel tier (pure) ------------------------------------------------------------------------------------
const PICK = () => tool('iron_pickaxe', 0), AXE = () => tool('iron_axe', 0)
await t('kitNeeds: town SHORT -> no iron shovel; a stone_shovel for a bag with no usable shovel and a cobblestone-family block; none with any usable shovel or no stone', () => {
  const lo = { lowIron: true }
  assert.deepEqual(K.kitNeeds([PICK(), AXE(), stack('cobblestone', 3)], lo), ['stone_shovel'])
  assert.deepEqual(K.kitNeeds([PICK(), AXE(), stack('cobbled_deepslate', 1)], lo), ['stone_shovel'])
  assert.deepEqual(K.kitNeeds([PICK(), AXE()], lo), [], 'no stone to make one: nothing (never an iron one)')
  assert.deepEqual(K.kitNeeds([PICK(), AXE(), stack('cobblestone', 3), tool('stone_shovel', 0)], lo), [], 'a usable stone shovel covers it')
  assert.deepEqual(K.kitNeeds([PICK(), AXE(), stack('cobblestone', 3), tool('iron_shovel', 249)], lo), ['stone_shovel'], 'a SPENT iron shovel is no shovel')
  assert.deepEqual(K.kitNeeds([stack('cobblestone', 3)], lo), ['iron_pickaxe', 'iron_axe', 'stone_shovel'], 'the pickaxe and axe are unchanged')
  // CONTROL: not short (or unknown) -> the base exactly
  assert.deepEqual(K.kitNeeds([PICK(), AXE(), stack('cobblestone', 3), tool('stone_shovel', 0)], { lowIron: false }), ['iron_shovel'])
  assert.deepEqual(K.kitNeeds([stack('cobblestone', 3)], { lowIron: false }), ['iron_pickaxe', 'iron_axe', 'iron_shovel'])
})
await t('kitDraw: a stone shovel draws 0 ingots and its 2 sticks; with the pickaxe the ingots are the pickaxe\'s alone', () => {
  assert.deepEqual(K.kitDraw([PICK(), AXE(), stack('cobblestone', 3), stack('stick', 4)], { lowIron: true }), { needs: ['stone_shovel'], ingots: 0, sticks: 0 })
  assert.deepEqual(K.kitDraw([PICK(), AXE(), stack('cobblestone', 3)], { lowIron: true }), { needs: ['stone_shovel'], ingots: 0, sticks: 4 })
  assert.equal(K.kitDraw([stack('cobblestone', 3), stack('stick', 9)], { lowIron: true }).ingots, 6)
  assert.equal(K.kitDraw([stack('cobblestone', 3), stack('stick', 9)], { lowIron: false }).ingots, 7, 'CONTROL: the base kit is 3 + 3 + 1')
})
const orderOf = (items, o = {}) => K.toolkitOrder({ now: 1e12, atTown: true, items, container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, ...o })
const shovelOrder = KK => {
  // the town has NO kit iron (townMiss true for every iron draw): short -> a stone shovel order anyway (it draws no iron)
  const items = [PICK(), AXE(), stack('cobblestone', 3), stack('stick', 4), stack('oak_planks', 8)]
  const r = KK.toolkitOrder({ now: 1e12, atTown: true, items, container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, lowIron: true })
  assert.equal(r.order?.skill, 'toolkit', JSON.stringify(r))
  assert.equal(r.order.args.low, 1, 'the order carries its reading')
  assert.match(r.order.why, /stone/)
  // CONTROL: not short -> the iron shovel order, which the iron-less town refuses (no order)
  assert.equal(KK.toolkitOrder({ now: 1e12, atTown: true, items, container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, lowIron: false }).order, null)
}
await t('toolkitOrder: town short and NO kit iron in it -> a stone-shovel order (args.low=1); CONTROL: not short -> no order (the iron shovel cannot be drawn)', () => {
  shovelOrder(K)
})
const stoneBehindAxe = KK => {
  // an unfundable IRON AXE ahead of the stone shovel (Codex r1 P2): the stone shovel alone is still ordered (args.only)
  const items = [PICK(), stack('cobblestone', 3), stack('stick', 4), stack('oak_planks', 8)]
  const r = KK.toolkitOrder({ now: 1e12, atTown: true, items, container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, lowIron: true })
  assert.equal(r.order?.args?.only, 'stone_shovel', JSON.stringify(r))
  // ...but the iron axe first when the town CAN fund it (no townMiss): the kit, not the stone-only run
  const r2 = KK.toolkitOrder({ now: 1e12, atTown: true, items, container: true, townMiss: () => false, room: () => true, tableNear: true, state: {}, lowIron: true })
  assert.deepEqual(r2.order?.args, { credit: 0, low: 1 })
}
await t('toolkitOrder: an unfundable iron axe ahead of the stone shovel -> the stone shovel alone (args.only); a fundable one -> the whole kit', () => {
  stoneBehindAxe(K)
})
await t('toolkitOrder: a stone-only run on a FULL bag (no empty slot for the shovel) -> no order; one empty slot (sticks carried) -> the order', () => {
  const full = [PICK(), AXE(), stack('cobblestone', 3), stack('stick', 4), ...Array.from({ length: 32 }, () => stack('dirt', 64))]
  assert.equal(K.toolkitOrder({ now: 1e12, atTown: true, items: full, container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, lowIron: true }).order, null)
  assert.ok(K.toolkitOrder({ now: 1e12, atTown: true, items: full.slice(0, 35), container: true, townMiss: () => true, room: () => true, tableNear: true, state: {}, lowIron: true }).order)
})

// ---- consumer 2: the real toolkit skill over the fake world ---------------------------------------------------------------
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5]]
function kitTown (bag) {
  freshPool(); clearWithdrawHolds()
  const w = withServer(fakeWorld({ bag: slotted(bag) }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('iron_ingot', 20), stack('stick', 16)]) }
  w.set(1, 64, 1, 'crafting_table')
  return w
}
const fakeCraft = (w, spec) => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  const sp = spec(item)
  take('iron_ingot', sp.ingots); take('stick', sp.sticks); if (item === 'stone_shovel') take('cobblestone', 1)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const townIron = w => CHESTS.reduce((n, c) => n + w.containers.get(c.join(',')).slots.filter(Boolean).reduce((m, it) => m + (it.name === 'iron_ingot' ? it.count : 0), 0), 0)
const kitRun = async (S, KK, low) => {
  const w = kitTown([PICK(), AXE(), stack('cobblestone', 5), stack('stick', 6)])
  const r = await S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w, KK.kitSpec ?? (n => KK.KIT[n])) }, low ? { low: 1 } : {}, new AbortController().signal)
  return { w, r }
}
const skillStone = async (S, KK) => {
  const { w, r } = await kitRun(S, KK, true)
  assert.equal(r.status, 'success', `${r.status} ${r.detail}`)
  assert.ok(w.bag.some(it => it.name === 'stone_shovel'), 'a stone shovel made')
  assert.ok(!w.bag.some(it => it.name === 'iron_shovel'), 'no iron shovel')
  assert.equal(townIron(w), 60, 'not one ingot drawn from town')
}
await t('THE TOOLKIT SKILL (fake world): args.low=1 -> a stone shovel, no town iron drawn; CONTROL: no low -> an iron shovel from the town\'s iron', async () => {
  await skillStone(S0, K)
  const { w, r } = await kitRun(S0, K, false)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.bag.some(it => it.name === 'iron_shovel'), 'CONTROL: the base makes the iron shovel')
  assert.equal(townIron(w), 59, 'CONTROL: one ingot drawn')
})

// ---- consumer 1: the iron task for the town ----------------------------------------------------------------------------------
const rung = (M = MS) => M.SUSTAINING.find(m => m.id === 'gather_iron_ore_town')
const ore = true
const ladderBot = ({ inv = {}, oreInReach = ore, items = null } = {}) => ({
  role: 'gatherer', entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 3 } },
  registry: { blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } }, itemsByName: {} },
  findBlock: () => (oreInReach ? { position: { x: 0, y: 30, z: 0 } } : null),
  inventory: { items: () => items ?? Object.entries(inv).map(([name, count]) => ({ name, count })) },
})
// a bag past every rung before the town one: wood, table, pickaxes, furnace, own iron 3 ingots, bucket, iron pickaxe
const DONE_BAG = { oak_log: 20, crafting_table: 1, wooden_pickaxe: 1, stone_pickaxe: 1, furnace: 1, iron_ingot: 3, bucket: 1, iron_pickaxe: 1, cobblestone: 80, coal: 4 }
await t('THE RUNG: after the bot\'s own iron rungs; town SHORT + ore + trip pickaxe -> open until 3 + 16 carried; town ok / unknown / no ore -> no means (stepped over)', () => {
  const ids = MS.SUSTAINING.map(m => m.id)
  assert.ok(ids.indexOf('gather_iron_ore_town') > ids.indexOf('craft_iron_pickaxe_1') && ids.indexOf('craft_iron_pickaxe_1') > ids.indexOf('gather_iron_ore_3'), ids.join(','))
  const r = rung()
  assert.equal(r.wants, 'iron_ore')
  readerSays({ units: 20 })
  assert.equal(r.done(ladderBot({ inv: DONE_BAG })), false, 'open: the town is short')
  assert.equal(r.done(ladderBot({ inv: { ...DONE_BAG, raw_iron: 15 } })), false, '15 above the own 3: not yet')
  assert.equal(r.done(ladderBot({ inv: { ...DONE_BAG, raw_iron: 16 } })), true, '16 above: the round is done')
  assert.equal(r.fulfilled(ladderBot({ inv: { ...DONE_BAG, raw_iron: 16 } })), true, 'a genuine completion')
  assert.equal(r.done(ladderBot({ inv: DONE_BAG, oreInReach: false })), true, 'no ore in reach: no means')
  assert.equal(r.done(ladderBot({ inv: { ...DONE_BAG, iron_pickaxe: 0, stone_pickaxe: 0 } })), true, 'no trip pickaxe: no means')
  assert.equal(r.fulfilled(ladderBot({ inv: DONE_BAG, oreInReach: false })), false, 'a bypass is not a completion')
  readerSays({ units: 64 }); assert.equal(r.done(ladderBot({ inv: DONE_BAG })), true, 'at the reserve: no means')
  readerSays(null); assert.equal(r.done(ladderBot({ inv: DONE_BAG })), true, 'unknown: no means (the base)')
  assert.match((readerSays({ units: 20 }), r.progress(ladderBot({ inv: DONE_BAG }))), /^0\/16 iron above your own carried \(3 in all\); the town holds 20 of 64/)
  TIM.setTownIronReader(null)
})

// ---- THE REFUSAL CHAINS: the real MilestoneController ----------------------------------------------------------------------
let CLOCK = NOW
const realNow = Date.now
const controller = (bot, M = MS) => {
  const progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy, co, pa) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, progressAt: pa }), save () {} }
  const c = new M.MilestoneController(bot, 'gatherer', lessons)
  c.chain = [...M.SUSTAINING]; c.index = 0
  return c
}
const chainScene = M => {
  Date.now = () => CLOCK
  try {
    // 1. a short town, ore in reach: the bot past its own iron rungs lands on the town rung
    readerSays({ units: 20 }, TIM)
    const b = ladderBot({ inv: DONE_BAG })
    const c = controller(b, M); c.refresh()
    assert.equal(c.current()?.id, 'gather_iron_ore_town', `the town task is current: ${c.current()?.id}`)
    // 2. NEVER AHEAD OF THE BOT'S OWN IRON: the same short town, a bag with no bucket -> the bucket rung first
    const nb = controller(ladderBot({ inv: { ...DONE_BAG, bucket: 0 } }), M); nb.refresh()
    assert.equal(nb.current()?.id, 'craft_bucket_1', `own iron first: ${nb.current()?.id}`)
    // 3. RELEASE BY NO MEANS: the ore goes out of reach -> the ladder moves past it (never stuck on it)
    const far = controller(ladderBot({ inv: DONE_BAG, oreInReach: false }), M); far.refresh()
    assert.notEqual(far.current()?.id, 'gather_iron_ore_town')
    // 4. RELEASE BY THE NO-PROGRESS SKIP: the ore is in sight but every serving gather fails -> skipped at NO_PROGRESS_MS
    const stuck = controller(ladderBot({ inv: DONE_BAG }), M); stuck.refresh()
    assert.equal(stuck.current()?.id, 'gather_iron_ore_town')
    stuck.noteAttempt({ failed: true, executed: true, serving: true })
    CLOCK += M.NO_PROGRESS_MS
    assert.equal(stuck.noteAttempt({ failed: true, executed: false, serving: false }), true, 'given up')
    assert.equal(stuck.lastSkip.id, 'gather_iron_ore_town'); assert.equal(stuck.lastSkip.reason, 'no_progress')
    stuck.refresh(); assert.notEqual(stuck.current()?.id, 'gather_iron_ore_town', 'and the ladder moves on')
    // 5. THE CAP: a round carried -> done; the town recovers -> the rung is gone
    const full = controller(ladderBot({ inv: { ...DONE_BAG, raw_iron: 16 } }), M); full.refresh()
    assert.notEqual(full.current()?.id, 'gather_iron_ore_town')
    readerSays({ units: 90 }, TIM)
    const ok = controller(ladderBot({ inv: DONE_BAG }), M); ok.refresh()
    assert.notEqual(ok.current()?.id, 'gather_iron_ore_town', 'the town at its reserve: no town task')
  } finally { Date.now = realNow; TIM.setTownIronReader(null) }
}
await t('THE REFUSAL CHAIN (real MilestoneController): short town -> the town task; never ahead of the bot\'s own bucket; released by no means and by the no-progress skip; the carry cap and a recovered town end it', () => {
  chainScene(MS)
})
const deliverWorld = (bag) => {
  freshPool(); clearWithdrawHolds()
  const w = withServer(fakeWorld({ bag: slotted(bag) }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  return w
}
const inTownOf = (w, name) => CHESTS.reduce((n, c) => n + w.containers.get(c.join(',')).slots.filter(Boolean).reduce((m, it) => m + (it.name === name ? it.count : 0), 0), 0)
const deliverScene = async S => {
  // THE CONTINUOUS CHAIN (Codex r2 P2): the real controller makes the town task current -> the round is recorded -> the bag
  // fills (19 raw iron, one stack) -> the controller leaves the rung -> the bot is home -> the delivery order -> the real
  // deliver_iron banks 16 -> the outcome ends the round
  Date.now = () => CLOCK
  try {
    readerSays({ units: 20 }, TIM)
    const inv = { ...DONE_BAG }
    const lb = ladderBot({ items: null, inv })
    const c = controller(lb); c.refresh()
    assert.equal(c.current()?.id, 'gather_iron_ore_town')
    let st = TIM.noteTownRound({}, c.current()?.id)
    assert.equal(st.round, true, 'the round is recorded while the task is active')
    inv.iron_ingot = 0; inv.raw_iron = 19                                // mined, and the ingots went into its bucket/pickaxe long ago
    c.refresh(); assert.notEqual(c.current()?.id, 'gather_iron_ore_town', 'the round carried: the ladder moves on (to the lap home)')
    st = TIM.noteTownRound(st, c.current()?.id)
    const w = deliverWorld([PICK(), tool('bucket', 0), stack('raw_iron', 19), stack('cobblestone', 4)])
    const counts = {}; for (const it of w.bag.filter(Boolean)) counts[it.name] = (counts[it.name] ?? 0) + it.count
    const o = TIM.deliverOrder({ now: CLOCK, atTown: true, counts, state: st })
    assert.equal(o.order?.skill, 'deliver_iron', JSON.stringify(o))
    const n0 = RECS.length
    const r = await S.SKILLS.deliver_iron.run({ bot: w.bot }, {}, new AbortController().signal)
    const row = RECS.slice(n0).filter(x => x?.skill?.name === '_deliver_iron').at(-1)?.skill?.detail ?? ''
    assert.equal(r.status, 'success', `${r.status} ${r.detail} | ${row}`)
    assert.equal(inTownOf(w, 'raw_iron'), 16, `16 raw iron in the town chests: ${row}`)
    assert.equal(w.bag.filter(Boolean).reduce((n, it) => n + (it.name === 'raw_iron' ? it.count : 0), 0), 3, 'the bag keeps its own 3')
    assert.match(row, /^stop=done bag=0\/19>0\/3 dep=0\/16 keep=0\/3$/, row)
    assert.equal(r.surplusLeft, 0)
    assert.equal(TIM.deliverOutcome(r.status, CLOCK, o.state, { surplusLeft: r.surplusLeft }).round, undefined, 'all banked: the round ends')
  } finally { Date.now = realNow; TIM.setTownIronReader(null) }
}
await t('THE CONTINUOUS DELIVERY CHAIN: the real controller\'s town task -> the round recorded -> 19 raw iron in one stack -> the ladder moves on -> at town the real deliver_iron banks 16, keeps the own 3 -> the round ends', async () => {
  await deliverScene(S0)
})
const interruptedDelivery = async S => {
  // INTERRUPTED BETWEEN THE TWO DEPOSITS (Codex r2 P1): 4 ingots + 15 raw, the raw deposit aborted after the ingot one -> the
  // round stays, and the next order retries the remainder (any positive surplus), which then banks it
  const w = deliverWorld([PICK(), tool('bucket', 0), stack('iron_ingot', 4), stack('raw_iron', 15), stack('cobblestone', 4)])
  // the second deposit (the raw iron's) cannot open a chest: the chests went out of reach after the ingots landed
  const open0 = w.bot.openContainer.bind(w.bot)
  let opens = 0
  w.bot.openContainer = async (...a) => { if (++opens > 1) throw new Error('the chest did not open'); return open0(...a) }
  let threw = null, r1 = null
  try { r1 = await S.SKILLS.deliver_iron.run({ bot: w.bot }, {}, new AbortController().signal) } catch (e) { threw = e }
  w.bot.openContainer = open0
  assert.ok(r1?.surplusLeft > 0, `the first delivery left a remainder: ${JSON.stringify(r1)} ${threw}`)
  const counts = {}; for (const it of w.bag.filter(Boolean)) counts[it.name] = (counts[it.name] ?? 0) + it.count
  const left = TIM.deliverPlan(counts).surplus
  assert.ok(left > 0, `a remainder is left: ${left} (threw ${!!threw})`)
  const st = TIM.deliverOutcome(r1.status, 1e12, { round: true }, { surplusLeft: r1.surplusLeft })
  assert.equal(st.round, true, 'a partial delivery keeps the round')
  const o = TIM.deliverOrder({ now: 1e12 + TIM.DELIVER_COOLDOWN_MS + 1, atTown: true, counts, state: st })
  assert.equal(o.order?.skill, 'deliver_iron', 'the remainder is retried')
  const r2 = await S.SKILLS.deliver_iron.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(inTownOf(w, 'iron_ingot') + inTownOf(w, 'raw_iron'), 16, 'in the end all 16 above the own 3 are in town')
  assert.equal(r2.surplusLeft, 0)
}
await t('A FAILED SECOND DEPOSIT (the raw iron\'s): the round survives, the remainder is retried and banked (Codex r2 P1)', async () => {
  await interruptedDelivery(S0)
})
await t('THE DEPOSIT\'S OWN RULE IS NOT THE DELIVERY (the CONTROL, real townDepositPlan): the same bag keeps the whole raw stack -- why deliver_iron exists', () => {
  const items = [{ ...PICK(), slot: 9 }, { name: 'bucket', count: 1, slot: 10 }, { name: 'raw_iron', count: 19, slot: 11 }]
  assert.equal(TD.townDepositPlan(items, { wanted: ['iron_ore'] }).banked?.raw_iron ?? 0, 0)
})
await t('THE READER (installTownIron over the bot\'s real town index): a town of fresh observations -> its units; a flip of the state writes one _town_iron row', async () => {
  freshPool(); TI.resetIndexCache(); TIM.resetTownIronMemo()
  const dir = process.env.POOL_STATE_DIR, hk = TI.indexHomeKey({ x: 0, y: 64, z: 0 })
  const now = realNow()
  for (let i = 0; i < 4; i++) TI.appendIndex(dir, hk, null, { t: 'obs', id: `o${i}`, k: `${i},64,0`, h: [`${i},64,0`], at: now - 60_000, bot: 'x', by: 'test', names: { iron_ingot: [5, 1], raw_iron: [2, 1] }, used: 2, size: 27 })
  const bot = { worldId: null, entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [] } }
  const n0 = RECS.length
  S0.installTownIron(bot)
  assert.deepEqual(TIM.townIronNow(), { units: 28, ingots: 20, raw: 8, containers: 4, seen: 4 })
  assert.equal(TIM.townIronLowNow(), true)
  const rows = RECS.slice(n0).filter(r => r?.skill?.name === '_town_iron')
  assert.equal(rows.length, 1); assert.match(rows[0].skill.detail, /^state=low units=28 ingots=20 raw=8 ctrs=4 seen=4 reserve=64$/)
  TIM.setTownIronReader(null)
})

// ---- mutants -------------------------------------------------------------------------------------------------------------------
await t('MUTANTS: each removes one part of the change and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.noTierSwap = await withMutant(SRC('toolkit.mjs'), "    if (n === 'iron_shovel' && lowIron) return stoneShovelNeed(items) ? ['stone_shovel'] : []\n", '', KK => killedBy(() => shovelOrder(KK)))
  kills.anyShovelIgnored = await withMutant(SRC('toolkit.mjs'), "  !list(items).some(it => SHOVEL_RE.test(it.name) && usable(it)) && list(items)", '  list(items)', KK => killedBy(() => {
    assert.deepEqual(KK.kitNeeds([PICK(), AXE(), stack('cobblestone', 3), tool('stone_shovel', 0)], { lowIron: true }), [])
  }))
  kills.skillIgnoresLow = await withMutant(SRC('skills.mjs'), '  const lowIron = !!args?.low', '  const lowIron = false', S => killedBy(() => skillStone(S, K)))
  kills.rungIgnoresTown = await withMutant(SRC('milestones.mjs'), '  }, b => townIronLow(townIronNow()) === true && ironInReach(b)', '  }, b => ironInReach(b)', M => killedBy(() => {
    readerSays({ units: 90 }); try { assert.equal(M.SUSTAINING.find(m => m.id === 'gather_iron_ore_town').done(ladderBot({ inv: DONE_BAG })), true) } finally { TIM.setTownIronReader(null) }
  }))
  kills.noCarryCap = await withMutant(SRC('towniron.mjs'), '  return deliverPlan(counts).surplus >= TOWN_IRON_CARRY\n}', '  return false\n}', M => killedBy(() => {
    assert.equal(M.townTaskCarried([{ name: 'raw_iron', count: 19 }]), true)
  }))
  kills.noMinContainers = await withMutant(SRC('towniron.mjs'), '  if (containers < min) return null\n', '', M => killedBy(() => {
    assert.equal(M.townIronStock({ a: obs('a', { iron_ingot: [1, 1] }) }, NOW), null)
  }))
  kills.unknownIsLow = await withMutant(SRC('towniron.mjs'), '  (!on || !stock ? null : stock.units < reserve)', '  (!on ? null : !stock ? true : stock.units < reserve)', M => killedBy(() => {
    assert.equal(M.townIronLow(null), null)
  }))
  kills.deliverNoHold = await withMutant(SRC('skills.mjs'), "      const restore = swapWithdrawHold(name, plan.own, Date.now() + 10 * 60_000)\n      try { await deposit(ctx, { item: name }, signal, { noRecovery: true }) } finally { restore() }",
    "      const restore = () => {}\n      try { await deposit(ctx, { item: name }, signal, { noRecovery: true }) } finally { restore() }", S => killedBy(() => deliverScene(S)))
  kills.noStoneOnly = await withMutant(SRC('toolkit.mjs'), "  const stoneOnly = lowIron && full.needs.includes('stone_shovel') && full.needs.length > 1 ? [{ only: 'stone_shovel' }] : []",
    '  const stoneOnly = []', KK => killedBy(() => stoneBehindAxe(KK)))
  kills.dirtyCounts = await withMutant(SRC('towniron.mjs'), "    if (indexStateOf(e, now, obsMs) !== 'known' || !Number.isFinite(at) || at > now + 60_000) continue",
    "    if (!o || !Number.isFinite(at) || at > now + 60_000) continue", M => killedBy(() => {
      const e = { a: obs('a', { raw_iron: [7, 1] }), b: obs('b', { dirt: [1, 1] }), c: obs('c', { dirt: [1, 1] }), d: { ...obs('d', { iron_ingot: [50, 1] }), last: { t: 'dirty', at: NOW - 10 } } }
      assert.equal(M.townIronStock(e, NOW).units, 7)
    }))
  // THE ORDER (Codex r2 P2): the town rung moved AHEAD of the bot's own crafts -> the chain scene's "own bucket first" fails
  kills.townRungFirst = await withMutants(SRC('milestones.mjs'), [['  TOWN_IRON_RUNG,\n]', ']'], ['const TECH_LADDER = [\n', 'const TECH_LADDER = [\n  TOWN_IRON_RUNG,\n']], M => killedBy(() => chainScene(M)))
  kills.noRoundGate = await withMutant(SRC('towniron.mjs'), "  if (!s.round) return { order: null, state: s, skip: 'no_round' }\n", '', M => killedBy(() => {
    assert.equal(M.deliverOrder({ now: 1e12, atTown: true, counts: { ...own, raw_iron: 19 } }).skip, 'no_round')
  }))
  kills.retryOnlyRound = await withMutant(SRC('towniron.mjs'), '  if (surplusLeft === 0) delete s.round', '  delete s.round', M => killedBy(() => {
    assert.equal(M.deliverOutcome('aborted', 1e12, { round: true }, { surplusLeft: null }).round, true)
  }))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
