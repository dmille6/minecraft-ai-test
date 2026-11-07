// BAGFULL-01 (src/bagroom.mjs has the measurement): a full bag at town was refused every build order (`_shop_skip why=room`, 5-7
// free slots) while the town's chests stood 73% empty -- the town deposit banks only its standing targets, so the bag's stairs,
// slabs, moss, planks, signs and stonecutters had no exit. The room refusal now orders a ROOM-BANK visit, then the build.
// Behaviour first (the pure steps on REAL showcase bags, the kit, the ask, the composed refusal chain through buildOrder), then
// anchored mutants of the executable lines, then the wiring (structural: the dispatch, the install, the row, the run's threading).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-bagfull-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const BR = await import('../src/bagroom.mjs')
const TD = await import('../src/towndeposit.mjs')
const S = await import('../src/shop.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }

const BAGROOM_PATH = new URL('../src/bagroom.mjs', import.meta.url)
const TD_PATH = new URL('../src/towndeposit.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// REAL BAGS (showcase `_shop_skip why=room` rows, 11-06/07): name -> count, laid out in slots by stack size
const ONE = /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/
const SIXTEEN = /_sign$|^(snowball|bucket)$/
const bagOf = inv => {
  const out = []; let slot = 9
  for (const [name, c] of Object.entries(inv)) { const st = ONE.test(name) ? 1 : SIXTEEN.test(name) ? 16 : 64; let k = c; while (k > 0) { out.push({ name, count: Math.min(k, st), slot: slot++ }); k -= st } }
  return out
}
const ALPHA = { stone_hoe: 1, spruce_sign: 2, cobblestone: 84, spruce_log: 25, chest: 18, stick: 2, sugar_cane: 17, moss_block: 6, spruce_stairs: 16, wheat: 2, spruce_slab: 11, furnace: 1, flowering_azalea: 1, bucket: 1, wooden_pickaxe: 1, iron_ingot: 3, crafting_table: 1, snowball: 3, iron_nugget: 2, shears: 1, iron_axe: 1, iron_shovel: 1, iron_pickaxe: 1, dirt: 18, spruce_sapling: 8, sand: 30, spruce_planks: 80 }
const DELTA = { cobblestone: 389, iron_ingot: 3, iron_axe: 1, iron_pickaxe: 2, spruce_sapling: 8, stone_pickaxe: 2, spruce_log: 24, snowball: 4, spruce_sign: 2, gravel: 15, moss_block: 8, spruce_planks: 108, sugar_cane: 6, cobbled_deepslate: 6, furnace: 3, bucket: 1, sand: 26, chest: 4, crafting_table: 1, iron_shovel: 1, dirt: 14 }
const LUMEN = { iron_pickaxe: 3, iron_axe: 1, spruce_log: 30, coal: 3, stone_pickaxe: 3, iron_shovel: 1, crafting_table: 1, sugar_cane: 4, moss_block: 12, spruce_sign: 3, shears: 1, spruce_sapling: 7, iron_nugget: 2, iron_ingot: 3, bucket: 1, lantern: 2, chest: 18, stone_bricks: 10, sand: 10, furnace: 1, dirt: 15, spruce_planks: 43, stone_shovel: 1, cobblestone: 88 }
const roomSteps = (items, x = {}) => TD.townDepositPlan(items, { wanted: [], room: true, ...x }).steps.filter(st => st.room)
const NEVER = /_(pickaxe|axe|shovel|hoe|sword)$|^(shears|bucket|cobblestone|cobbled_deepslate|chest|furnace|crafting_table|torch|bone_meal|spruce_sapling|iron_ingot|iron_nugget|coal|stick)$/

await t('REAL BAGS: the room plan moves whole stacks no build needs -- never a tool, cobble, a station, a sapling, the iron ladder', () => {
  for (const [who, inv] of [['Alpha', ALPHA], ['Delta', DELTA], ['Lumen', LUMEN]]) {
    const items = bagOf(inv)
    const st = roomSteps(items)
    assert.ok(st.length >= 1, `${who}: something moves`)
    for (const s of st) {
      assert.ok(!NEVER.test(s.name), `${who}: ${s.name} is the kit's or another layer's`)
      const it = items.find(i => i.slot === s.slot)
      assert.equal(it.name, s.name); assert.equal(it.count, s.count, 'a WHOLE stack (the deposit moves whole stacks only)')
    }
  }
  const a = roomSteps(bagOf(ALPHA)).map(s => s.name).sort()
  for (const n of ['moss_block', 'snowball', 'spruce_slab', 'spruce_stairs', 'spruce_sign']) assert.ok(a.includes(n), `Alpha banks ${n}: ${a}`)
})

await t('REAL BAGS: after the room bank every sampled bag has the build\'s 8 free slots (the base plan\'s cobble refused at the cap)', () => {
  for (const [who, inv] of [['Alpha', ALPHA], ['Delta', DELTA], ['Lumen', LUMEN]]) {
    const items = bagOf(inv)
    const free = 36 - (items.length - roomSteps(items).length)
    assert.ok(36 - items.length < 8, `${who} was refused: ${36 - items.length} free`)
    assert.ok(free >= BR.BUILD_ROOM_SLOTS, `${who}: ${free} free after the bank`)
  }
})

await t('THE KIT: the townKeeps floors and ROOM_KIT_KEEP stay; a stack bigger than what may go stays whole', () => {
  // 80 spruce planks (64 + 16) with the ladder means' 4 kept: the 16 goes, the 64 would leave 0 < 4 -> stays
  const items = [{ name: 'spruce_planks', count: 64, slot: 9 }, { name: 'spruce_planks', count: 16, slot: 10 }, { name: 'ladder', count: 30, slot: 11 }, { name: 'sugar_cane', count: 17, slot: 12 }, { name: 'bread', count: 5, slot: 13 }, { name: 'water_bucket', count: 1, slot: 14 }, { name: 'iron_helmet', count: 1, slot: 15 }]
  const st = roomSteps(items)
  assert.deepEqual(st.map(s => `${s.name}:${s.count}`), ['spruce_planks:16'])
  // a drawn share's names are the share bank's
  assert.deepEqual(roomSteps(bagOf({ spruce_stairs: 16, moss_block: 8 }), { roomExclude: new Set(['spruce_stairs']) }).map(s => s.name), ['moss_block'])
  // a targeted group the town never holds (target 0: dirt, gravel) is the well's, never the room bank's
  assert.deepEqual(roomSteps(bagOf({ gravel: 15, dirt: 40, moss_block: 8 })).map(s => s.name), ['moss_block'])
})

await t('THE MODES: no room flag, no room steps; a tail run never; the base plan is unchanged by the flag', () => {
  const items = bagOf(ALPHA)
  const off = TD.townDepositPlan(items, { wanted: [] })
  const on = TD.townDepositPlan(items, { wanted: [], room: true })
  assert.equal(off.steps.filter(s => s.room).length, 0)
  assert.deepEqual(on.steps.filter(s => !s.room), off.steps, 'the base plan and rows exactly as before')
  assert.equal(TD.townDepositPlan(items, { wanted: [], room: true, tail: 'only' }).steps.filter(s => s.room).length, 0)
  // the room steps come after the slot-freeing base and row steps (a short chest takes those first)
  const rank = on.steps.map(s => (s.half ? 3 : s.room ? 2 : s.allowance ? 1 : 0))
  assert.deepEqual(rank, [...rank].sort((a, b) => a - b))
})

await t('roomBankSteps: whole stacks smallest first, `taken` slots counted not re-planned, the eligibility rule throws -> not eligible', () => {
  const items = [{ name: 'moss_block', count: 64, slot: 1 }, { name: 'moss_block', count: 10, slot: 2 }, { name: 'glass', count: 5, slot: 3 }]
  assert.deepEqual(BR.roomBankSteps(items, { eligible: () => true, keep: { moss_block: 20 } }).map(s => s.slot), [3, 2], 'glass all; moss: 74-20=54 may go: the 10 fits, then 64 > 44 stays')
  assert.deepEqual(BR.roomBankSteps(items, { eligible: () => true }).map(s => s.slot).sort(), [1, 2, 3])
  assert.deepEqual(BR.roomBankSteps(items, { eligible: () => true, taken: new Set([2]) }).map(s => s.slot).sort(), [1, 3])
  assert.deepEqual(BR.roomBankSteps(items, { eligible: () => { throw new Error('x') } }), [])
  assert.deepEqual(BR.roomBankSteps([{ name: 'iron_pickaxe', count: 1, slot: 4 }, { name: 'cooked_beef', count: 9, slot: 5 }, { name: 'shield', count: 1, slot: 6 }], { eligible: () => true }), [], 'tools, food, armour: never')
})

await t('roomBankAsk: only short of the plot\'s own room, rate-limited, and only when a slot would be freed; off never', () => {
  const NOW = 1e12
  assert.equal(BR.roomBankAsk({ on: true, freeSlots: 6, need: 8, slots: 4, now: NOW }).ok, true)
  assert.equal(BR.roomBankAsk({ on: true, freeSlots: 6, need: 2, slots: 4, now: NOW }).why, 'room_ok', 'a light plot at 6 free builds')
  assert.equal(BR.roomBankAsk({ on: true, freeSlots: 6, need: 8, slots: 0, now: NOW }).why, 'nothing_bankable')
  assert.equal(BR.roomBankAsk({ on: true, freeSlots: 6, need: 8, slots: 4, now: NOW, lastAt: NOW - 60_000 }).why, 'recent')
  assert.equal(BR.roomBankAsk({ on: true, freeSlots: 6, need: 8, slots: 4, now: NOW, lastAt: NOW - BR.ROOM_BANK_EVERY_MS }).ok, true)
  assert.equal(BR.roomBankAsk({ on: false, freeSlots: 6, need: 8, slots: 4, now: NOW }).why, 'off')
})

// THE CHAIN, composed as skills.mjs roomAsk composes it (the ask reads the same plan the run banks), through shop.mjs buildOrder
const composedAsk = (items, state) => ({ now, freeSlots, plot, need }) => {
  const a = BR.roomBankAsk({ on: true, freeSlots, need, slots: roomSteps(items).length, now, lastAt: state.at ?? null })
  if (!a.ok) return null
  state.at = now
  return { order: { skill: 'build_shop', args: { roomBank: true, plot, need } } }
}
await t('THE REFUSAL CHAIN: full bag at town -> room-bank order (never the bare skip) -> after the bank the build order is the build', () => {
  const items = bagOf(ALPHA)
  const state = {}
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, record: { plot: 'hall', structure_complete: false } }
  try {
    S.setRoomAsk(composedAsk(items, state))
    const r1 = S.buildOrder({ ...base, freeSlots: 36 - items.length })
    assert.equal(r1.skip, null); assert.equal(r1.order?.args?.roomBank, true); assert.equal(r1.order.args.need, S.SHOP_BAG_SLOTS_MIN)
    // the visit banked the room steps: the bag now has the room, and the order is the build itself
    const left = 36 - (items.length - roomSteps(items).length)
    const r2 = S.buildOrder({ ...base, now: 1e12 + 11 * 60_000, freeSlots: left })
    assert.deepEqual(r2, { order: { skill: 'build_shop', args: {} }, skip: null })
    // a bag with nothing the room may move: the skip, as before (the cobble rules own the rest)
    S.setRoomAsk(composedAsk(bagOf({ cobblestone: 64 * 30, iron_pickaxe: 1 }), {}))
    assert.equal(S.buildOrder({ ...base, freeSlots: 5 }).skip, 'room')
  } finally { S.setRoomAsk(null) }
})

await t('THE KEEPER: a light plot (tidy) asks with its own room (2) -- at 6 free it builds, no bank; the forest (8) asks a bank', () => {
  const items = bagOf(ALPHA)
  try {
    let asked = null
    S.setRoomAsk(a => { asked = a; return composedAsk(items, {})(a) })
    const tidy = S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 6, record: { plot: 'tidy', structure_complete: false } })
    assert.deepEqual(tidy, { order: { skill: 'build_shop', args: {} }, skip: null }); assert.equal(asked, null)
    const forest = S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 6, record: { plot: 'forest', structure_complete: false } })
    assert.equal(forest.order?.args?.roomBank, true); assert.equal(asked.need, 8); assert.equal(asked.plot, 'forest')
  } finally { S.setRoomAsk(null) }
})

await t('THE ROW: one `_room_bank` detail names the plot, the need, the plan, the slots and what went', () => {
  assert.equal(BR.roomBankDetail({ plot: 'forest', need: 8, planned: 5, slotsBefore: 31, slotsAfter: 26, banked: { moss_block: 6, x: 0 }, status: 'success', then: 'build' }),
    'plot=forest need=8 planned=5 slots=31->26 deposit=success then=build banked=moss_block:6')
})

// ---- mutants: each executable line, anchored and unique ----
await t('MUTANT KILLED: the room steps never added (the deposit\'s standing targets only)', async () => {
  await withMutant(TD_PATH, '  if (room && baseOn) {', '  if (false) {', async m => {
    assert.equal(m.townDepositPlan(bagOf(ALPHA), { wanted: [], room: true }).steps.filter(s => s.room).length, 0, 'the mutant moves nothing (killed)')
  })
})
await t('MUTANT KILLED: the kit rule loses its tools', async () => {
  await withMutant(BAGROOM_PATH, "export const roomKitAlways = name => typeof name !== 'string' || TOOLISH_RE.test(name) || ", "export const roomKitAlways = name => typeof name !== 'string' || ", async m => {
    assert.ok(m.roomBankSteps([{ name: 'shears', count: 1, slot: 4 }], { eligible: () => true }).length === 1, 'the mutant banks the shears (killed)')
    assert.equal(BR.roomBankSteps([{ name: 'shears', count: 1, slot: 4 }], { eligible: () => true }).length, 0)
  })
})
await t('the drawn-share exclusion holds in two layers (the room eligibility; the batch22 fold\'s plan-wide filter): either alone keeps the share', async () => {
  await withMutant(TD_PATH, ' && !(roomExclude?.has?.(n)) &&', ' &&', async m => {
    const n = m.townDepositPlan(bagOf({ spruce_stairs: 16 }), { wanted: [], room: true, roomExclude: new Set(['spruce_stairs']) }).steps.filter(s => s.room).length
    assert.equal(n, 0, 'without the eligibility clause the plan-wide filter still keeps it')
  })
  await withMutant(TD_PATH, '  if (room && roomExclude?.size) {', '  if (false) {', async m => {
    const n = m.townDepositPlan(bagOf({ spruce_stairs: 16 }), { wanted: [], room: true, roomExclude: new Set(['spruce_stairs']) }).steps.filter(s => s.room).length
    assert.equal(n, 0, 'without the filter the eligibility clause still keeps it')
  })
})
await t('MUTANT KILLED: the target-0 groups admitted (dirt banked against its town target)', async () => {
  await withMutant(TD_PATH, '      !(groupOf(n) && !(targetOf(groupOf(n)) > 0))', '      true', async m => {
    assert.ok(m.townDepositPlan(bagOf({ dirt: 100 }), { wanted: [], room: true }).steps.some(s => s.room && s.name === 'dirt'), 'killed')
  })
})
await t('MUTANT KILLED: the ask ignores the rate limit', async () => {
  await withMutant(BAGROOM_PATH, 'if (Number.isFinite(lastAt) && lastAt + every > now)', 'if (false)', async m => {
    assert.equal(m.roomBankAsk({ on: true, freeSlots: 6, need: 8, slots: 4, now: 1e12, lastAt: 1e12 - 1 }).ok, true, 'killed')
  })
})
await t('MUTANT KILLED: buildOrder asks with the heavy room for every plot (the keeper\'s tidy would bank at 6 free)', async () => {
  await withMutant(SHOP_PATH, '      try { ra = roomAskOf({ now, freeSlots, plot, need }) }', '      try { ra = roomAskOf({ now, freeSlots, plot, need: 8 }) }', async m => {
    let asked = null
    try {
      m.setRoomAsk(a => { asked = a; return null })
      m.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 1, record: { plot: 'tidy', structure_complete: false } })
      assert.equal(asked.need, 8, 'the mutant passes 8 for the light plot (killed: the real passes 2)')
    } finally { m.setRoomAsk(null) }
  })
})

// ---- the wiring (structural: behaviour cannot reach a spawn's install, the dispatch or a live deposit run without a bot) ----
await t('WIRED: the dispatch reaches the room visit, the run threads `room` into every plan, the row is written, the build follows', () => {
  const sk = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const one = (src, s) => assert.equal(src.split(s).length, 2, `exactly one: ${s}`)
  one(sk, '  if (args?.roomBank === true) return roomBankVisit(ctx, args, signal)')
  one(sk, "  const room = _args?.room === true && !tail && BAGROOM.bank ? { room: true, roomExclude: roomShareNames(bot) } : null")
  one(sk, "logEvent({ kind: 'room_bank'")
  one(sk, "    r = await townDeposit(ctx, { room: true }, signal)")
  one(sk, "  if (then === 'build') return buildShop(ctx, {}, sig")
  // every plan of the deposit run reads the room flag (the start plan, the sorted homes' filter, each container's, the end check)
  const fn = sk.slice(sk.indexOf('async function townDeposit (ctx, _args, signal)'), sk.indexOf('async function townDeposit (ctx, _args, signal)') + 20_000)
  const body = fn.slice(0, fn.indexOf('\nasync function ') > 0 ? fn.indexOf('\nasync function ') : fn.length)
  const plans = body.split('\n').filter(l => l.includes('townDepositPlan('))
  assert.equal(plans.length, 4, `the run's plans found: ${plans.length}`)
  one(sk, '  const plan0 = explicit ? { steps: explicit(bag) } : townDepositPlan(bag, { wanted, already, noSwords: foodSkipNow(bot).active, valve, tail, ...(room ?? {}) })')
  const roomless = plans.filter(l => !l.includes('...(room ?? {})') && !l.includes('townDepositPlan(before, { wanted, noSwords: foodSkipNow(bot).active }).steps.some(st => !st.half)'))
  assert.deepEqual(roomless, [], 'a plan of the run without the room flag')
  assert.ok(body.includes("townIndexDirty(bot, c.position, 'town_deposit', 'pre', ixOp) }, tail, accept, room })"), 'each container\'s plan gets the room flag')
  // the valve (one spare tool) never rides a room run
  one(sk, '  const valve = !tail && !room && ')
})
await t('MUTANT KILLED (wiring): the dispatch without the room visit', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  const old = '  if (args?.roomBank === true) return roomBankVisit(ctx, args, signal)'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const mut = strip(src.replace(old, '  if (false) return roomBankVisit(ctx, args, signal)'))
  assert.equal(mut.split(old).length, 1, 'the structural check fails on the mutant (killed)')
})

// ---- the showcase batch22 fold (Codex BLOCKERS 1 + 2) ---------------------------------------------------------------------
await t('fold BLOCKER 1: a room bank never moves a bed (the sleep kit)', () => {
  const items = bagOf({ red_bed: 1, spruce_planks: 128, cobblestone: 64 })
  const st = roomSteps(items)
  assert.ok(st.some(x => x.name === 'spruce_planks'), `POSITIVE: planks are room-banked (${JSON.stringify(st)})`)
  assert.ok(!st.some(x => x.name === 'red_bed'), 'the bed stays')
  assert.strictEqual(BR.roomKitAlways('white_bed'), true)
})
await t('fold BLOCKER 2: a ROOM visit banks no drawn share name through any part, the base plan included', async () => {
  const B = await import('../src/bankable.mjs')
  try {
    B.setDepositExtra(n => n === 'glass' || n === 'oak_sign')   // the market's wants hook (glass, a sign) as installed live
    const items = bagOf({ glass: 20, oak_sign: 1, spruce_planks: 128 })
    const all = TD.townDepositPlan(items, { wanted: [], room: true }).steps.map(x => x.name)
    assert.ok(all.includes('glass'), `POSITIVE: without the share, the base plan banks the glass (${all})`)
    const held = TD.townDepositPlan(items, { wanted: [], room: true, roomExclude: new Set(['glass']) }).steps.map(x => x.name)
    assert.ok(!held.includes('glass'), `the held share's glass stays (${held})`)
    assert.ok(held.includes('spruce_planks'), 'the rest of the room bank goes on')
    const plain = TD.townDepositPlan(items, { wanted: [], roomExclude: new Set(['glass']) }).steps.map(x => x.name)
    assert.ok(plain.includes('glass'), 'an ordinary (non-room) deposit is unchanged')
  } finally { B.setDepositExtra(null) }
})
await t('MUTANTS KILLED: the bed rule and the share filter', async () => {
  await withMutant(BAGROOM_PATH, " || /bucket$/.test(name) || /_bed$/.test(name)", " || /bucket$/.test(name)", async X => {
    assert.strictEqual(X.roomKitAlways('red_bed'), false)
  })
  await withMutant(TD_PATH, '  if (room && roomExclude?.size) {', '  if (false) {', async X => {
    const B = await import('../src/bankable.mjs')
    try {
      B.setDepositExtra(n => n === 'glass')
      const held = X.townDepositPlan(bagOf({ glass: 20, spruce_planks: 128 }), { wanted: [], room: true, roomExclude: new Set(['glass']) }).steps.map(x => x.name)
      assert.ok(held.includes('glass'), 'the mutant banks the share')
    } finally { B.setDepositExtra(null) }
  })
})

if (failed) { console.log(`# ${failed} failed`); process.exit(1) }
console.log('# bagfull: all passed')
