// orderroom-01: NO RUNG CRAFT ORDER WITHOUT ROOM; THE NAMED REMEDY IS THE ORDER (workorder.mjs readyFor/roomOrder/
// roomOutcome, skills.mjs craftRouteFor/craftRoomCheck/roomRemedy, admission.mjs memoryRefuses, prompt.mjs noRoomHint).
//
// Measured 10-10 (80 bots, 13.5 h): 1,124 rung craft orders failed for NO ROOM and the gate then refused 3,608 more
// (cooldown / repeat_loop), up to ~41 min in a row, while the refusal named a remedy nothing executed. Behaviour only:
// the room verdict on real recipe deltas, the remedy chain through the REAL CognitiveLoop (far from home -> home ->
// deposit X -> the craft), and mutants with anchors asserted present and unique.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-orderroom'
process.env.BOT_NAME = process.env.BOT_NAME || 'RoomBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '40'
process.env.PLANT_ENABLED = '0'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'or-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const WO = await import('../src/workorder.mjs')
const SK = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const PR = await import('../src/prompt.mjs')
const BK = await import('../src/bankable.mjs')
const CR = await import('../src/craftroom.mjs')
const BK_IRON = (await import('../src/towndeposit.mjs')).IRON_LADDER
const await_plan = b => BK.depositPlan(b.items, null, { wants: [] })

const COGNITIVE_PATH = new URL('../src/cognitive.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const WORKORDER_PATH = new URL('../src/workorder.mjs', import.meta.url)

/** climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the mutant is never written. */
async function withMutant (url, old, neu, fn) {
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

// ---- fixtures ------------------------------------------------------------------------------------------------------
const id = n => mcData.itemsByName[n].id
function item (name, count, slot, extra = {}) {
  const def = mcData.itemsByName[name]
  const it = { name, count, slot, type: def.id, stackSize: def.stackSize, ...extra }
  if (def.maxDurability) { it.maxDurability = def.maxDurability; it.durabilityUsed = extra.durabilityUsed ?? 0 }
  return it
}
const filler = (n, start) => Array.from({ length: n }, (_, i) => item('white_wool', 1 + (i % 3), start + i))
/** The real stone_pickaxe recipe as mineflayer's delta: 3 cobblestone, 2 sticks -> 1 pickaxe (needs a table). */
const PICK = { delta: [{ id: id('cobblestone'), count: -3 }, { id: id('stick'), count: -2 }, { id: id('stone_pickaxe'), count: 1 }], result: { id: id('stone_pickaxe'), count: 1 }, requiresTable: true }

/**
 * A bot with a full bag. `sticks` sets the stick stack: 2 sticks EMPTY their stack when crafted (room), 10 do not.
 * `table`: a crafting_table standing beside the bot (route B). `at`: where it stands. `home`: the town chest at home.
 */
function bagBot ({ sticks = 10, table = true, at = new Vec3(400, 70, 0), spentAxe = false, pickup = false, food = 20, extra = [] } = {}) {
  const items = [
    item('cobblestone', 64, 8), item('cobblestone', 20, 9), item('stick', sticks, 10), item('crafting_table', 1, 7), item('oak_log', 64, 11), item('oak_log', 64, 12), item('oak_log', 40, 13),
    item('dirt', 16, 14), item('wooden_pickaxe', 1, 15, { durabilityUsed: 9 }), item('furnace', 1, 16), item('sand', 8, 17),
    ...(spentAxe ? [item('stone_axe', 1, 18, { durabilityUsed: mcData.itemsByName.stone_axe.maxDurability - 1 })] : [item('raw_copper', 5, 18)]),
    ...extra,
  ]
  items.push(...filler(36 - items.length, 9 + items.length))
  assert.equal(items.length, 36)
  // A table stands beside the bot WHEREVER it is (one in town as well as at the work site): route B both places.
  const tableBlock = { name: 'crafting_table', type: mcData.blocksByName.crafting_table.id, get position () { const p = bot.entity.position; return new Vec3(Math.floor(p.x) + 1, Math.floor(p.y), Math.floor(p.z)) } }
  const bot = {
    entity: { position: at, velocity: { x: 0, y: 0, z: 0 }, isInWater: false },
    registry: mcData, controlState: {}, currentWindow: null, heldItem: null, food,
    inventory: { inventoryStart: 9, items: () => items, slots: [] },
    health: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: (rid, _m, _c, tbl) => (rid === id('stone_pickaxe') && tbl ? [PICK] : []),
    recipesAll: () => [],
    findBlock: ({ matching, maxDistance }) => {
      if (typeof matching !== 'function') return null
      if (table && matching({ type: tableBlock.type, position: tableBlock.position }) && bot.entity.position.distanceTo(tableBlock.position) <= maxDistance) return tableBlock
      return null
    },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    clearControlStates: () => {}, setControlState: () => {}, players: {}, experience: { level: 0 }, username: 'RoomBot',
    entities: pickup ? { 7: { id: 7, name: 'item', type: 'object', position: at.offset(0.3, 0, 0), metadata: [], getDroppedItem: () => ({ name: 'dirt', count: 1 }) } } : {},
    chat: () => {}, on: () => {}, once: () => {}, removeListener: () => {},
  }
  return { bot, items }
}

// ---- 1. the room verdict: the craft's own route and simulation ---------------------------------------------------------
test('ROOM: a full bag whose craft empties no stack has no room; one whose craft empties the stick stack has room', () => {
  const full = SK.craftRoomCheck(bagBot({ sticks: 10 }).bot, 'stone_pickaxe')
  assert.equal(full.ok, false, JSON.stringify(full))
  assert.equal(full.short, 1); assert.equal(full.route, 'B', 'a standing table within 32: the craft walks to it, nothing placed')
  const fits = SK.craftRoomCheck(bagBot({ sticks: 2 }).bot, 'stone_pickaxe')
  assert.equal(fits.ok, true, 'positive control: the same bag whose sticks empty fits the pickaxe')
  assert.equal(fits.via, 'room')
})

test('ROOM: a shortage that is ONLY the pickup slot is the craft\'s own to settle (null); otherwise the pickup slot adds to it', () => {
  assert.equal(SK.craftRoomCheck(bagBot({ sticks: 2 }).bot, 'stone_pickaxe').ok, true)
  const only = SK.craftRoomCheck(bagBot({ sticks: 2, pickup: true }).bot, 'stone_pickaxe')
  assert.equal(only.ok, null, 'craftExecutions settles a pending pickup before anything else: as today'); assert.equal(only.why, 'pickup_only')
  const both = SK.craftRoomCheck(bagBot({ sticks: 10, pickup: true }).bot, 'stone_pickaxe')
  assert.equal(both.ok, false); assert.equal(both.short, 2, 'one slot for the output, one held for the item on the ground')
})

test('ROOM: two tries are not two tools -- one spent tool covers a one-slot shortage, not a two-slot one', () => {
  assert.equal(SK.wearableSlots(bagBot({ spentAxe: true }).items, 'stone_pickaxe'), 1)
  assert.equal(SK.wearableSlots(bagBot({}).items, 'stone_pickaxe'), 0)
  assert.equal(SK.craftRoomCheck(bagBot({ sticks: 10, spentAxe: true }).bot, 'stone_pickaxe').via, 'wear')
  assert.equal(SK.craftRoomCheck(bagBot({ sticks: 10, spentAxe: true, pickup: true }).bot, 'stone_pickaxe').ok, false, 'short 2, one tool')
})

test('ROUTE: a carried table with the standing one out of reach -- both outcomes simulated; unknown only when they disagree', () => {
  const { bot } = bagBot({ sticks: 10 })
  const far = new Vec3(410, 70, 0)
  bot.findBlock = ({ matching, maxDistance }) => (typeof matching === 'function' && bot.entity.position.distanceTo(far) <= maxDistance
    ? { name: 'crafting_table', type: mcData.blocksByName.crafting_table.id, position: far } : null)
  const r = SK.craftRoomCheck(bot, 'stone_pickaxe')
  assert.equal(r.ok, null, 'the walk does not fit, putting the single carried table down would'); assert.match(r.why, /ambiguous route B/)
  // ...but where both outcomes agree there is nothing ambiguous: two carried tables (placing one frees no slot)
  const two = bagBot({ sticks: 10 }); two.items[two.items.findIndex(i => i.name === 'crafting_table')].count = 2
  two.bot.findBlock = bot.findBlock.bind(two.bot); two.bot.entity = bot.entity
  assert.equal(SK.craftRoomCheck(two.bot, 'stone_pickaxe').ok, false, 'both outcomes lack room: no room')
})

test('ROUTE C: the table goes down IMMEDIATELY BEFORE the first step that needs it, never before a 2x2 step', () => {
  // no table anywhere, one carried: planks (2x2, no table) then the pickaxe (table). The placement must come second.
  const { bot } = bagBot({ sticks: 10, table: false })
  const PLANKS = { delta: [{ id: id('oak_log'), count: -1 }, { id: id('oak_planks'), count: 4 }], result: { id: id('oak_planks'), count: 4 }, requiresTable: false, inShape: [[1]] }
  const WOODPICK = { delta: [{ id: id('oak_planks'), count: -3 }, { id: id('stick'), count: -2 }, { id: id('wooden_pickaxe'), count: 1 }], result: { id: id('wooden_pickaxe'), count: 1 }, requiresTable: true }
  bot.recipesFor = () => []
  bot.recipesAll = rid => (rid === id('oak_planks') ? [PLANKS] : rid === id('wooden_pickaxe') ? [WOODPICK] : [])
  const r = SK.craftRouteFor(bot, 'wooden_pickaxe')
  assert.ok(r && r.route === 'C', JSON.stringify(r))
  const names = r.steps.map(st => st.recipe.outputs.length ? st.recipe.outputs[0].name : `put:${st.recipe.consumes[0].name}`)
  assert.deepEqual(names, ['oak_planks', 'put:crafting_table', 'wooden_pickaxe'])
})

test('ROOM: the craft\'s own make-room (a spent tool to wear out) counts -- unless that craft was just refused for room', () => {
  const b = bagBot({ sticks: 10, spentAxe: true }).bot
  const r = SK.craftRoomCheck(b, 'stone_pickaxe')
  assert.equal(r.ok, true); assert.equal(r.via, 'wear')
  assert.equal(SK.craftRoomCheck(b, 'stone_pickaxe', 1, { wearFailedRecently: true }).ok, false)
})

test('ROOM: cannot say -> null, and readyFor then issues the order exactly as before', () => {
  const { bot } = bagBot({ sticks: 10 })
  bot.recipesFor = () => []                                   // no route
  assert.equal(SK.craftRoomCheck(bot, 'stone_pickaxe').ok, null)
  const r = WO.readyFor(bagBot({ sticks: 10 }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' }, { roomCheck: () => ({ ok: null }) })
  assert.equal(r.craftReady, true); assert.equal(r.noRoom, null)
})

test('READY: no room -> no craft order, and noRoom names the item, the shortfall and the craft\'s ingredients', () => {
  const r = WO.readyFor(bagBot({ sticks: 10 }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' })
  assert.equal(r.craftReady, false); assert.equal(WO.orderFor(r), null)
  assert.equal(r.noRoom.item, 'stone_pickaxe'); assert.equal(r.noRoom.short, 1)
  assert.deepEqual(r.noRoom.keep.map(k => k.name).sort(), ['cobblestone', 'stick'])
  const ok = WO.readyFor(bagBot({ sticks: 2 }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' })
  assert.equal(ok.craftReady, true); assert.equal(WO.orderFor(ok)?.skill, 'craft', 'positive control: with room the order is issued')
})

// ---- 2. the remedy: only what runs from here ----------------------------------------------------------------------------
test('REMEDY: far from the bank -> home (naming the X it will bank); at home -> deposit X; X frees a stack and is no ingredient', () => {
  const far = bagBot({ sticks: 10, at: new Vec3(400, 70, 0) })
  const keep = [{ name: 'cobblestone', count: 1 }, { name: 'stick', count: 1 }]
  const r = SK.roomRemedy(far.bot, far.items, keep)
  assert.equal(r.kind, 'home', JSON.stringify(r))
  assert.ok(r.item && !['cobblestone', 'stick'].includes(r.item))
  const near = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
  const d = SK.roomRemedy(near.bot, near.items, keep)
  assert.equal(d.kind, 'deposit'); assert.equal(d.item, r.item, 'the item named far away is the one banked at home')
  assert.ok(!['cobblestone', 'stick'].includes(d.item))
})

test('REMEDY: the iron ladder is not the price of a stone pickaxe -- another stack goes first; iron only when nothing else frees one', () => {
  const keep = [{ name: 'cobblestone', count: 1 }, { name: 'stick', count: 1 }]
  const b = bagBot({ sticks: 10, at: new Vec3(3, 70, 0), extra: [] })
  b.items[b.items.length - 1] = item('iron_ingot', 9, 44)
  assert.equal(SK.roomRemedy(b.bot, b.items, keep).item, 'oak_log', 'oak_log frees a stack: it goes, the ingots stay')
  assert.equal(CR.depositTarget(b.items, await_plan(b), keep), 'iron_ingot', 'positive control: the plain advice would name the ingots')
  // matset-01: sand is always banked now (DEPOSIT_ALWAYS), so a bag whose other stacks are wool frees the SAND's slot first,
  // never the ingots'
  const sandy = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
  for (const it of sandy.items) if (it.name === 'oak_log' || it.name === 'raw_copper') it.name = 'white_wool'
  sandy.items[sandy.items.length - 1] = item('iron_ingot', 9, 44)
  assert.equal(SK.roomRemedy(sandy.bot, sandy.items, keep).item, 'sand', 'sand goes before the iron ladder')
  // only ingots can free a stack -> they are named (the slot must still come free)
  const only = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
  for (const it of only.items) if (it.name === 'oak_log' || it.name === 'raw_copper' || it.name === 'sand') it.name = 'white_wool'
  only.items[only.items.length - 1] = item('iron_ingot', 9, 44)
  assert.equal(SK.roomRemedy(only.bot, only.items, keep).item, 'iron_ingot')
  // ...and of the ladder, the cheapest rung first -- but NEVER THE FUEL RESERVE (Claude st-r1 1b): banking all 20 coal would
  // leave 0 < ROOM_FUEL_RESERVE, so the ingots go; with the reserve at 0 (positive control) the coal goes first
  only.items.push(item('coal', 20, 45)); only.items.splice(only.items.findIndex(i => i.name === 'white_wool'), 1)
  assert.equal(only.items.length, 36)
  assert.equal(SK.ROOM_FUEL_RESERVE, 16)
  assert.equal(SK.roomRemedy(only.bot, only.items, keep).item, 'iron_ingot', 'the fuel stays')
  assert.deepEqual([...SK.LADDER_CHEAPEST_FIRST].sort(), [...BK_IRON].sort(), 'the cheapest-first list is exactly the town deposit\'s ladder')
})

test('REMEDY (stocktarget tips): the walk to the junk well -- only toward a RECORDED well; the well\'s rule; never for an ingredient', () => {
  const keep = [{ name: 'cobblestone', count: 1 }, { name: 'stick', count: 1 }]
  const far = bagBot({ sticks: 10, at: new Vec3(400, 70, 0) })
  far.items[far.items.length - 1] = item('flint', 12, 44)
  const site = () => ({ x: 5, y: 70, z: 5, gen: 1 })
  const w = SK.townWellTakes(far.bot, far.items, keep, { wellSite: site })
  assert.ok(w, 'positive control: with a recorded well the well\'s own rule takes a stack of this bag (flint, wool)')
  assert.equal(SK.townWellTakes(far.bot, far.items, keep, { wellSite: () => null }), null, 'no recorded well: no walk for it')
  const all = far.items.map(i => ({ name: i.name, count: 1 }))
  assert.equal(SK.townWellTakes(far.bot, far.items, all, { wellSite: site }), null, 'never a craft ingredient')
  // roomRemedy uses the pool's real record: none in this test pool -> no well walk; deposit excluded -> none
  const r = SK.roomRemedy(far.bot, far.items, keep, { exclude: new Set(['deposit', 'home_deposit']) })
  assert.equal(r.kind, 'none', JSON.stringify(r))
  assert.equal(SK.roomRemedy(far.bot, far.items, keep, { exclude: new Set(['deposit', 'home_deposit', 'home_well']) }).kind, 'none')
})

test('OUTCOME: a well walk that arrives backs further well walks off for 30 min, whatever the well then did', () => {
  const out = WO.roomOutcome({ status: 'success', slotsAfter: 36, stillFar: false, now: 1000, state: { pending: { kind: 'home', item: null, via: 'well', slots: 36 } } })
  assert.equal(out.verdict, 'ok'); assert.equal(out.state.backoff.home_well, 1000 + WO.ROOM_WELL_WALK_BACKOFF_MS)
  assert.ok(WO.roomBackedOff(out.state, 2000).has('home_well'))
  const dep = WO.roomOutcome({ status: 'success', slotsAfter: 36, stillFar: false, now: 1000, state: { pending: { kind: 'home', item: 'oak_log', slots: 36 } } })
  assert.equal(dep.state.backoff.home_well, undefined, 'a deposit walk does not')
  const o = WO.roomOrder({ noRoom: { item: 'stone_pickaxe', short: 1 }, remedy: { kind: 'home', item: null, via: 'well', text: 't' }, now: 0, slots: 36 })
  assert.equal(o.state.pending.via, 'well')
})

test('MUTANT KILLED: without the fuel reserve the coal is banked to make a pickaxe', async () => {
  await withMutant(SKILLS_PATH, 'export const ROOM_FUEL_RESERVE = 16', 'export const ROOM_FUEL_RESERVE = 0', async mod => {
    const keep = [{ name: 'cobblestone', count: 1 }, { name: 'stick', count: 1 }]
    const only = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
    for (const it of only.items) if (it.name === 'oak_log' || it.name === 'raw_copper' || it.name === 'sand') it.name = 'white_wool'
    only.items[only.items.length - 1] = item('iron_ingot', 9, 44)
    only.items.push(item('coal', 20, 45)); only.items.splice(only.items.findIndex(i => i.name === 'white_wool'), 1)
    assert.equal(mod.roomRemedy(only.bot, only.items, keep).item, 'coal', 'the mutant takes the fuel')
  })
})

test('REMEDY: never a placement; never `home` where the bot already is; a closed bank is no order', () => {
  const near = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
  const keep = [{ name: 'cobblestone', count: 1 }, { name: 'stick', count: 1 }]
  assert.equal(SK.roomRemedy(near.bot, near.items, keep, { exclude: new Set(['deposit']) }).kind, 'none', 'deposit backed off at home: nothing, not a home walk')
  const one = bagBot({ sticks: 10, at: new Vec3(3, 70, 0), extra: [] })
  one.items[one.items.length - 1] = item('andesite', 1, 44)   // a single placeable block: the advice would say place
  assert.notEqual(SK.roomRemedy(one.bot, one.items, keep).kind, 'place')
  near.bot.bankClosed = { until: Date.now() + 600_000, at: Date.now(), why: 'the town chests are full', kind: 'full' }
  assert.equal(SK.roomRemedy(near.bot, near.items, keep).kind, 'closed')
})

test('REMEDY: a single food with hunger < 20 is eaten (eat frees its slot); full hunger never', () => {
  const keep = [{ name: 'cobblestone', count: 1 }]
  const h = bagBot({ sticks: 10, at: new Vec3(400, 70, 0), food: 12, extra: [] })
  h.items[h.items.length - 1] = item('bread', 1, 44)
  assert.equal(SK.roomRemedy(h.bot, h.items, keep).kind, 'eat')
  h.bot.food = 20
  assert.notEqual(SK.roomRemedy(h.bot, h.items, keep).kind, 'eat')
})

// ---- 3. the order and its measured outcome (pure) -------------------------------------------------------------------
test('ORDER: one per kind at a time; closed/none are no order; a backed-off kind is not reissued', () => {
  const noRoom = { item: 'stone_pickaxe', short: 1 }
  const d = WO.roomOrder({ noRoom, remedy: { kind: 'deposit', item: 'oak_log', text: 't' }, now: 1000, slots: 36 })
  assert.deepEqual([d.order.skill, d.order.args], ['deposit', { item: 'oak_log' }])
  assert.equal(d.state.pending.slots, 36)
  for (const kind of ['closed', 'none', 'place']) assert.equal(WO.roomOrder({ noRoom, remedy: { kind, item: 'x' }, now: 1000 }).order, null, kind)
  const backed = { backoff: { deposit: 5000 } }
  assert.equal(WO.roomOrder({ noRoom, remedy: { kind: 'deposit', item: 'oak_log' }, now: 1000, state: backed }).order, null)
  assert.equal(WO.roomOrder({ noRoom, remedy: { kind: 'deposit', item: 'oak_log' }, now: 6000, state: backed }).order?.skill, 'deposit')
})

test('OUTCOME: FREED IS MEASURED -- a deposit that freed nothing backs off; one that freed a slot does not; home walking continues', () => {
  const st = slots => ({ pending: { kind: 'deposit', item: 'oak_log', craft: 'stone_pickaxe', slots } })
  const freed = WO.roomOutcome({ status: 'success', slotsAfter: 34, now: 0, state: st(36) })
  assert.equal(freed.verdict, 'ok'); assert.equal(freed.freed, 2); assert.equal(freed.state.backoff.deposit, 0)
  const nothing = WO.roomOutcome({ status: 'success', slotsAfter: 36, now: 0, state: st(36) })
  assert.equal(nothing.verdict, 'backoff', 'a "success" that freed no slot is not a remedy'); assert.equal(nothing.state.backoff.deposit, WO.ROOM_BACKOFF_MS)
  const refused = WO.roomOutcome({ refused: true, slotsAfter: 36, now: 0, state: st(36) })
  assert.equal(refused.state.backoff.deposit, WO.ROOM_REFUSED_BACKOFF_MS)
  const walk = WO.roomOutcome({ status: 'failed', failClass: 'travel_incomplete', slotsAfter: 36, now: 0, state: { pending: { kind: 'home', slots: 36 } } })
  assert.equal(walk.verdict, 'walking'); assert.equal(walk.state.backoff.home, undefined)
  assert.equal(WO.roomOutcome({ status: 'success', slotsAfter: 36, now: 0, state: { pending: { kind: 'home', slots: 36 } } }).verdict, 'ok')
  assert.equal(WO.roomOutcome({ state: {} }).verdict, 'none')
})

// ---- 4. the gate's memory, read without mutating --------------------------------------------------------------------------
test('GATE MEMORY: memoryRefuses names cooldown / learned / repeat, and changes nothing check() keeps', () => {
  const L = new Lessons(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'or-l-')), 'l.json')); L.data.avoid = {}
  const a = new AdmissionControl(L)
  assert.equal(a.memoryRefuses('deposit', {}), null)
  a.noteFailure('deposit', { item: 'oak_log' })
  assert.equal(a.memoryRefuses('deposit', {}), 'cooldown', 'deposit declares no args: every deposit shares one key')
  const b = new AdmissionControl({ failCount: () => 4 })
  assert.equal(b.memoryRefuses('deposit', {}), 'learned_avoid')
  const c = new AdmissionControl(null)
  c.recent = ['eat:{}', 'eat:{}', 'eat:{}', 'eat:{}']
  const before = JSON.stringify({ recent: c.recent, streak: c.vetoStreak, blocked: c.blockedCount })
  assert.equal(c.memoryRefuses('eat', {}), 'repeat_loop')
  assert.equal(JSON.stringify({ recent: c.recent, streak: c.vetoStreak, blocked: c.blockedCount }), before, 'a read')
})

// ---- 5. the prompt ---------------------------------------------------------------------------------------------------------
test('PROMPT: the HINT names the shortfall and the remedy instead of "craft with item=X"', () => {
  const ms = { wants: 'stone_pickaxe', hint: 'craft with item=stone_pickaxe.' }
  assert.equal(PR.noRoomHint(ms, null), null)
  assert.equal(PR.noRoomHint(ms, { item: 'iron_pickaxe', short: 1 }), null, 'only the rung\'s own craft')
  assert.match(PR.noRoomHint(ms, { item: 'stone_pickaxe', short: 1, text: 'home -- then deposit oak_log' }),
    /^HINT: no room in the bag to craft stone_pickaxe \(1 slot\(s\) short\): home -- then deposit oak_log/)
})

// ---- 6. the CHAIN, through the REAL CognitiveLoop --------------------------------------------------------------------------
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-or-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }

/**
 * Real decisions. The runner is the world: `home` moves the bot to town; `deposit X` removes X's whole stacks (as the
 * deposit plan does for oak_log beyond the reserve -- here the 40 stack); `craft` fails for no room at 36 slots and
 * otherwise adds the pickaxe; anything the model proposes (`explore`) succeeds and changes nothing.
 */
async function chain (Loop, { n = 4, maxDecisions = 10, at = new Vec3(400, 70, 0) } = {}) {
  const { bot, items } = bagBot({ sticks: 10, at })
  const ran = []; const rows = []; let asked = 0
  const untap = tapRecords(rec => rows.push(rec))
  const runner = { isBusy: () => false, run: async (skill, args) => {
    ran.push(args?.item ? `${skill}:${args.item}` : skill)
    if (skill === 'home') { bot.entity.position = new Vec3(2, 70, 0); return { status: 'success', detail: 'home', delta: {}, contractEvidence: ['home: position'] } }
    if (skill === 'deposit') {
      const i = items.findIndex(x => x.name === args.item && x.count < 64)
      const j = i >= 0 ? i : items.findIndex(x => x.name === args.item)
      if (j >= 0) items.splice(j, 1)
      return { status: 'success', detail: 'deposited', delta: {}, contractEvidence: ['deposit: inventory_loss'] }
    }
    if (skill === 'craft') {
      if (items.length >= 36) return { status: 'failed', failClass: 'inventory_full', detail: 'home -- then deposit oak_log: banking is refused out here. No room for stone_pickaxe' }
      items.push(item('stone_pickaxe', 1, 44))
      return { status: 'success', detail: 'crafted 1x stone_pickaxe', delta: {}, contractEvidence: ['crafted: stone_pickaxe +1'] }
    }
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new Loop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => { asked++; return { schemaValid: true, latencyMs: 5, proposal: { skill: 'explore', args: { blocks: 16 }, reason: 'probe' } } } }
  loop.milestones.cycle = 540
  loop.start()
  // until n skills ran, or a craft ran (the chain's end), or the decision budget is spent
  for (let i = 0; i < 400 && ran.length < n && !ran.some(x => x.startsWith('craft')) && loop.decisions < maxDecisions; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop()
  untap()
  const kind = k => rows.filter(r => r?.skill?.name === k)
  return { ran, rows, asked, loop, items, noroom: kind('_craft_noroom'), roomRows: kind('_room_order') }
}

const { CognitiveLoop } = await import('../src/cognitive.mjs')

test('CHAIN: far from home with a full bag -> home -> deposit X -> the craft, which succeeds; no craft attempted without room', async () => {
  const { ran, loop, noroom, roomRows, items } = await chain(CognitiveLoop, { n: 8, maxDecisions: 14 })
  assert.equal(loop.milestones.current()?.id?.includes('stone_pickaxe') || items.some(i => i.name === 'stone_pickaxe'), true, `positive control: the rung is the pickaxe (${loop.milestones.current()?.id}; ran ${JSON.stringify(ran)})`)
  // Orders that already free slots at town (the town deposit, the junk well's, the composter's) run before the room
  // order and may interleave; the CHAIN is the room orders and the craft, in that order, with no craft before the room.
  assert.deepEqual(ran.filter(x => /^(home|deposit|craft)/.test(x)), ['home', 'deposit:oak_log', 'craft:stone_pickaxe'], JSON.stringify(ran))
  assert.ok(items.some(i => i.name === 'stone_pickaxe'), 'the pickaxe was crafted')
  assert.ok(noroom.length >= 1); assert.match(noroom[0].skill.detail, /^item=stone_pickaxe short=1 slots=36 route=B remedy=home target=oak_log/)
  assert.equal(roomRows.length, 2, JSON.stringify(roomRows.map(r => r.skill.detail)))
  assert.match(roomRows[0].skill.detail, /^kind=home item=oak_log craft=stone_pickaxe short=1 slots=36->36 freed=0 verdict=ok run=success/)
  assert.match(roomRows[1].skill.detail, /^kind=deposit item=oak_log craft=stone_pickaxe short=1 slots=36->35 freed=1 verdict=ok run=success lost=oak_log:40$/)
})

test('CHAIN CONTROL: the base readyFor (no room check) issues the craft into a full bag, which fails, and the order comes back', async () => {
  await withMutant(WORKORDER_PATH, 'if (craftReady && roomCheck) {', 'if (false && craftReady && roomCheck) {', async wo => {
    assert.equal(wo.readyFor(bagBot({ sticks: 10 }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' }).craftReady, true,
      'MUTANT KILLED at the unit: without the check a full bag reads craft-ready')
  })
  // ...and through the loop (cognitive imports the real workorder, so the base is a readyFor that cannot say):
  await withMutant(COGNITIVE_PATH, "const ready = readyFor(this.bot, milestone, { wearFailedRecently: Date.now() - (this.roomWearFailAt?.[milestone?.wants] ?? -Infinity) < ROOM_WEAR_TRUST_MS })",
    'const ready = readyFor(this.bot, milestone, { roomCheck: () => ({ ok: null }) })', async mod => {
      const { ran } = await chain(mod.CognitiveLoop, { n: 1, maxDecisions: 4 })
      assert.equal(ran[0], 'craft:stone_pickaxe', `the base: the craft goes straight into the full bag: ${JSON.stringify(ran)}`)
      assert.ok(!ran.includes('home'))
    })
})

test('MUTANT KILLED: `home` without the far-from-bank test walks a bot that is already home', async () => {
  await withMutant(SKILLS_PATH, "if (!exclude.has('home') && farFromBank(bot)) {", "if (!exclude.has('home')) {", async mod => {
    const near = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
    const r = mod.roomRemedy(near.bot, near.items, [{ name: 'cobblestone', count: 1 }], { exclude: new Set(['deposit']) })
    assert.equal(r.kind, 'home', 'the mutant names a home walk at home')
  })
})

test('MUTANT KILLED: without the gate-memory exclusion a cooling-down deposit is issued and refused', async () => {
  await withMutant(COGNITIVE_PATH, "for (const kind of ['eat', 'deposit', 'home']) memory[kind] = this.admission.memoryRefuses(kind, {}, now)", "for (const kind of ['eat', 'deposit', 'home']) memory[kind] = null", async mod => {
    const { bot } = bagBot({ sticks: 10, at: new Vec3(3, 70, 0) })
    const runner = { isBusy: () => false, run: async () => ({ status: 'success', detail: 'ok', delta: {}, contractEvidence: ['x'] }) }
    const loop = new mod.CognitiveLoop(bot, runner, freshLessons(), null)
    loop.admission.noteFailure('deposit', {})
    // the private remedy is reached through the prompt's HINT: the base excludes deposit and names none
    const real = new CognitiveLoop(bot, runner, freshLessons(), null)
    real.admission.noteFailure('deposit', {})
    const hint = async L => {
      const rows = []; const untap = tapRecords(r => rows.push(r))
      L.llm = { decide: async () => ({ schemaValid: true, latencyMs: 5, proposal: { skill: 'explore', args: {}, reason: 'p' } }) }
      L.milestones.cycle = 540; L.start()
      for (let i = 0; i < 100 && !rows.some(r => r?.skill?.name === '_craft_noroom'); i++) await new Promise(r => setTimeout(r, 20))
      L.stop(); untap()
      return rows.find(r => r?.skill?.name === '_craft_noroom')?.skill?.detail ?? ''
    }
    assert.match(await hint(real), /remedy=none/, 'positive control: the base leaves the cooling deposit out')
    assert.match(await hint(loop), /remedy=deposit/, 'the mutant names the deposit the gate will refuse')
  })
})

test('MUTANT KILLED: dropping the pickup slot from the shortage lets one spent tool "cover" two missing slots', async () => {
  await withMutant(SKILLS_PATH, 'const short = bare + (bare > 0 ? pickup : 0)', 'const short = bare', async mod => {
    assert.equal(mod.craftRoomCheck(bagBot({ sticks: 10, spentAxe: true, pickup: true }).bot, 'stone_pickaxe').ok, true, 'the mutant says room')
  })
})

test('MUTANT KILLED: counting tries instead of tools promises two slots from one spent tool', async () => {
  await withMutant(SKILLS_PATH, '    bag = bag.filter(x => x !== pick.tool)\n', '\n', async mod => {
    assert.equal(mod.wearableSlots(bagBot({ spentAxe: true }).items, 'stone_pickaxe'), 2, 'the mutant counts the same axe twice')
  })
})

test('MUTANT KILLED: placing the carried table before EVERY plan step invents room for the 2x2 step', async () => {
  await withMutant(SKILLS_PATH, '    if (st.recipe.table && !placed) { steps.push(PUT_TABLE); placed = true }\n', '    if (!placed) { steps.push(PUT_TABLE); placed = true }\n', async mod => {
    const { bot } = bagBot({ sticks: 10, table: false })
    const PLANKS = { delta: [{ id: id('oak_log'), count: -1 }, { id: id('oak_planks'), count: 4 }], result: { id: id('oak_planks'), count: 4 }, requiresTable: false, inShape: [[1]] }
    const WOODPICK = { delta: [{ id: id('oak_planks'), count: -3 }, { id: id('stick'), count: -2 }, { id: id('wooden_pickaxe'), count: 1 }], result: { id: id('wooden_pickaxe'), count: 1 }, requiresTable: true }
    bot.recipesFor = () => []
    bot.recipesAll = rid => (rid === id('oak_planks') ? [PLANKS] : rid === id('wooden_pickaxe') ? [WOODPICK] : [])
    const names = mod.craftRouteFor(bot, 'wooden_pickaxe').steps.map(st => st.recipe.outputs.length ? st.recipe.outputs[0].name : 'put')
    assert.equal(names[0], 'put', 'the mutant puts the table down first')
  })
})

// ---- home only toward a deposit that can run -----------------------------------------------------------------------------
test('EXCLUSIONS: a deposit blocked by something a walk will not clear also rules out the walk home; a cooldown does not', () => {
  assert.deepEqual([...WO.roomExclusions({ memory: { deposit: 'learned_avoid' } })].sort(), ['deposit', 'home_deposit'])
  assert.deepEqual([...WO.roomExclusions({ memory: { deposit: 'repeat_loop' } })].sort(), ['deposit', 'home_deposit'])
  assert.deepEqual([...WO.roomExclusions({ backedOff: new Set(['deposit']) })].sort(), ['deposit', 'home_deposit'])
  assert.deepEqual([...WO.roomExclusions({ memory: { deposit: 'cooldown' } })], ['deposit'], 'a 45 s cooldown is over before the walk is')
  assert.deepEqual([...WO.roomExclusions({ memory: { eat: null, deposit: null, home: null } })], [])
})

test('CHAIN: far from home with the deposit learned-blocked -> no walk home FOR A DEPOSIT (a walk for the well names no X)', async () => {
  const { bot } = bagBot({ sticks: 10, at: new Vec3(400, 70, 0) })
  const ran = []; let asked = 0
  const runner = { isBusy: () => false, run: async (skill) => { ran.push(skill); return { status: 'success', detail: 'ok', delta: {}, contractEvidence: ['x'] } } }
  const L = freshLessons()
  L.failCount = (skill) => (skill === 'deposit' ? 9 : 0)
  const loop = new CognitiveLoop(bot, runner, L, null)
  loop.llm = { decide: async () => { asked++; return { schemaValid: true, latencyMs: 5, proposal: { skill: 'explore', args: { blocks: 16 }, reason: 'p' } } } }
  const rows = []; const untap = tapRecords(r => rows.push(r))
  loop.milestones.cycle = 540; loop.start()
  for (let i = 0; i < 200 && ran.length < 1; i++) await new Promise(r => setTimeout(r, 20))
  loop.stop(); untap()
  assert.ok(!ran.includes('craft'), JSON.stringify(ran))
  const nr = rows.find(r => r?.skill?.name === '_craft_noroom')?.skill?.detail ?? ''
  assert.match(nr, /remedy=(home|none) target=-/, `no deposit is named: ${nr}`)
  if (ran[0] !== 'home') { assert.equal(ran[0], 'explore'); assert.ok(asked >= 1) }
  else assert.match(nr, /remedy=home target=-/, 'a home walk here is the well\'s, never a deposit\'s')
})

test('LOST: every fallen name, capped by CHARACTERS so the 300-char row cap never cuts the +more marker', () => {
  assert.equal(WO.lostLine({ oak_log: 104, dirt: 3 }, { oak_log: 64, dirt: 3 }), 'oak_log:40')
  assert.equal(WO.lostLine({ a: 1 }, { a: 1 }), '-')
  const before = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`polished_blackstone_brick_${i}`, 64]))
  const line = WO.lostLine(before, {})
  assert.ok(line.endsWith(',+more') && line.length <= 110 + 6, line)
  // the longest row the build can write stays under the cap with the marker intact
  const row = `kind=deposit item=polished_blackstone_bricks craft=stone_pickaxe short=2 slots=36->36 freed=0 verdict=backoff run=refused:learned_avoid lost=${line}`
  assert.ok(row.length <= 300, String(row.length))
})

test('OUTCOME: a home walk that arrives but is STILL far from a usable chest backs off; an interruption is free', () => {
  const home = { pending: { kind: 'home', slots: 36 } }
  assert.equal(WO.roomOutcome({ status: 'success', slotsAfter: 36, stillFar: true, now: 0, state: home }).verdict, 'backoff')
  const cut = WO.roomOutcome({ status: 'aborted', slotsAfter: 36, now: 0, state: { pending: { kind: 'deposit', slots: 36 } } })
  assert.equal(cut.verdict, 'interrupted'); assert.equal(cut.state.backoff.deposit, undefined)
})

test('READY: the craft\'s own wear route is reported (roomVia), so the order can say so', () => {
  const r = WO.readyFor(bagBot({ sticks: 10, spentAxe: true }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' })
  assert.equal(r.craftReady, true); assert.equal(r.roomVia, 'wear')
  assert.equal(WO.readyFor(bagBot({ sticks: 2 }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' }).roomVia, 'room')
  assert.equal(WO.readyFor(bagBot({ sticks: 2, pickup: true }).bot, { id: 'craft_stone_pickaxe_1#3', wants: 'stone_pickaxe' }).roomVia, 'unknown', 'pickup-only: issued, tagged unknown')
})

test('MUTANT KILLED: crediting any home arrival re-issues home every tick while the bot is still far from a chest', async () => {
  await withMutant(WORKORDER_PATH, "(p.kind === 'home' && status === 'success' && !stillFar)", "(p.kind === 'home' && status === 'success')", async mod => {
    assert.equal(mod.roomOutcome({ status: 'success', slotsAfter: 36, stillFar: true, now: 0, state: { pending: { kind: 'home', slots: 36 } } }).verdict, 'ok', 'the mutant credits it')
  })
})

test('OUTCOME: a walk the skill reports as interrupted (a reflex stopped the path) is free too', () => {
  for (const fc of ['path_interrupted', 'interrupted', 'hazard_interrupt']) {
    const r = WO.roomOutcome({ status: 'failed', failClass: fc, slotsAfter: 36, now: 0, state: { pending: { kind: 'deposit', slots: 36 } } })
    assert.equal(r.verdict, 'interrupted', fc); assert.equal(r.state.backoff.deposit, undefined)
  }
  assert.equal(WO.roomOutcome({ status: 'failed', failClass: 'no_path', slotsAfter: 36, now: 0, state: { pending: { kind: 'deposit', slots: 36 } } }).verdict, 'backoff', 'positive control')
})

test('MUTANT KILLED: an interruption charged as a failure costs the remedy ten minutes', async () => {
  await withMutant(WORKORDER_PATH, "  else if (status === 'aborted' || ROOM_INTERRUPTED.has(failClass)) verdict = 'interrupted'\n", '\n', async mod => {
    const r = mod.roomOutcome({ status: 'aborted', slotsAfter: 36, now: 0, state: { pending: { kind: 'deposit', slots: 36 } } })
    assert.equal(r.state.backoff.deposit, mod.ROOM_BACKOFF_MS)
  })
})
