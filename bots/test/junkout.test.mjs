// junkout-01 (docs/reports/junkout-01-design-2026-10-21.md): junk out at every town visit, and the slim bag allowance.
//
// Behaviour only: every decision is a pure export -- the visit latch, the three visit orders, the rows, row P, the wear-out
// spares cap, the row details -- driven with bags and states, and each guard has an anchored, unique mutant that must fail
// for the reason it exists (withMutant: the anchor is asserted present and unique, so a mutant that never applied cannot
// read as killed). The chains through the REAL CognitiveLoop are in well.test.mjs (the well visit) and towndeposit.test.mjs
// (the tail), next to the fakes they need.
process.env.LOG_DIR = process.env.LOG_DIR || `/tmp/mcbot-test-logs-junkout-${process.pid}`
process.env.BOT_NAME = process.env.BOT_NAME || 'JunkBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const BA = await import('../src/bagallowance.mjs')
const W = await import('../src/well.mjs')
const C = await import('../src/composter.mjs')
const TD = await import('../src/towndeposit.mjs')
const H = await import('../src/hygiene.mjs')
const { FLOOR } = await import('../src/toolfor.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const BA_P = new URL('../src/bagallowance.mjs', import.meta.url)
const W_P = new URL('../src/well.mjs', import.meta.url)
const C_P = new URL('../src/composter.mjs', import.meta.url)
const TD_P = new URL('../src/towndeposit.mjs', import.meta.url)
const H_P = new URL('../src/hygiene.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- fixtures ---------------------------------------------------------------------------------------------------------
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
let slotN = 9
function it (name, count = 1, extra = {}) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const x = { name, count, slot: extra.slot ?? slotN++, type: def.id, stackSize: def.stackSize, ...extra }
  if (TOOL.test(name)) { x.maxDurability = def.maxDurability; x.durabilityUsed = extra.durabilityUsed ?? 0 }
  return x
}
/** A tool with `uses` left. */
const tool = (name, uses, extra = {}) => it(name, 1, { durabilityUsed: mcData.itemsByName[name].maxDurability - uses, ...extra })
/** A bag from items, slots renumbered 9.., padded with `pad` ladder stacks (on no row, never junk, never banked). */
const bagOf = (items, pad = 0) => { slotN = 9; const out = items.map(x => ({ ...x, slot: slotN++ })); for (let i = 0; i < pad; i++) out.push({ ...it('ladder', 1 + (i % 3)), slot: slotN++ }); return out }
const NOW = 10_000_000

// ===================================================================================================================
// THE SWITCHES AND THE LICENCE ROW
// ===================================================================================================================
await t('switches: BAG_ALLOWANCE and JUNK_VISIT default on; off is off; anything else reads on and says so', () => {
  for (const [f, k] of [[BA.bagAllowanceMode, 'BAG_ALLOWANCE'], [BA.junkVisitMode, 'JUNK_VISIT']]) {
    assert.deepEqual(f({}), { on: true, mode: 'on', note: null })
    assert.equal(f({ [k]: 'off' }).on, false); assert.equal(f({ [k]: ' OFF ' }).on, false)
    assert.equal(f({ [k]: 'on' }).on, true)
    const odd = f({ [k]: 'maybe' }); assert.equal(odd.on, true); assert.match(odd.note, new RegExp(`^${k}=maybe unreadable`))
  }
  const d = BA.junkoutModeDetail({ on: false, note: null }, { on: true, note: null })
  assert.match(d, /^phase=mode visit=1 allowance=0 rows=station:1,torch:0,bone_meal:0,stone_spares:2$/)
})

// ===================================================================================================================
// THE VISIT LATCH (ticked on every decision)
// ===================================================================================================================
await t('latch: issue latches; 60 s OUTSIDE re-arms (armed=out:<first>-<last>); a shorter trip does not; the stay window re-arms (armed=stay)', () => {
  let s = BA.visitLatchIssue({}, NOW)
  assert.equal(s.latched, true); assert.equal(s.armedUsed, 'first', 'nothing was issued before: first')
  s = BA.visitLatchTick(s, { now: NOW + 10_000, atTown: false })
  s = BA.visitLatchTick(s, { now: NOW + 40_000, atTown: false })
  assert.equal(s.latched, true, '30 s outside is not a new visit')
  s = BA.visitLatchTick(s, { now: NOW + 45_000, atTown: true })
  assert.equal(s.outsideSince, null, 'back in town: the outside clock restarts')
  s = BA.visitLatchTick(s, { now: NOW + 50_000, atTown: false })
  s = BA.visitLatchTick(s, { now: NOW + 110_000, atTown: false })
  assert.equal(s.latched, false, '60 s outside: the next visit')
  assert.equal(s.armed, `out:${(NOW + 50_000).toString(36)}-${(NOW + 110_000).toString(36)}`)
  assert.equal(BA.visitArmed(s), s.armed)
  // the stay window
  let u = BA.visitLatchIssue({}, NOW)
  u = BA.visitLatchTick(u, { now: NOW + BA.VISIT_STAY_MS - 1, atTown: true }); assert.equal(u.latched, true)
  u = BA.visitLatchTick(u, { now: NOW + BA.VISIT_STAY_MS, atTown: true }); assert.equal(u.latched, false); assert.equal(u.armed, 'stay')
  // nothing issued: the latch was never shut, so nothing re-arms (armed stays 'first')
  const v = BA.visitLatchTick(BA.visitLatchTick({}, { now: NOW, atTown: false }), { now: NOW + 120_000, atTown: false })
  assert.equal(BA.visitArmed(v), 'first')
})
await t('latch: a DECLINED order un-latches and restores the reason that armed it (the read pairs runs, not declines)', () => {
  let s = BA.visitLatchTick(BA.visitLatchTick(BA.visitLatchIssue({}, NOW), { now: NOW + 1, atTown: false }), { now: NOW + 70_000, atTown: false })
  const why = s.armed
  s = BA.visitLatchIssue(BA.visitLatchTick(s, { now: NOW + 80_000, atTown: true }), NOW + 80_000)
  assert.equal(s.latched, true); assert.equal(s.armed, null); assert.equal(s.armedUsed, why)
  s = BA.visitLatchDeclined(s)
  assert.equal(s.latched, false); assert.equal(s.armed, why, 'the retry carries the same reason')
  assert.match(BA.visitId('hive-a Alpha', NOW), /^hive-a_Alpha\.[0-9a-z]+$/); assert.equal(parseInt(BA.visitId('x', NOW).split('.')[1], 36), NOW)
})
await t('MUTANT (bagallowance): the outside re-arm without its 60 s -> a step outside re-arms the visit (killed)', async () => {
  await withMutant(BA_P, '    if (s.latched && now - s.outsideSince >= outsideMs) {', '    if (s.latched) {', async m => {
    const s = m.visitLatchTick(m.visitLatchIssue({}, NOW), { now: NOW + 1000, atTown: false })
    assert.equal(s.latched, false, 'mutant inert')
  })
})

// ===================================================================================================================
// A. THE WELL AT EVERY VISIT (well.mjs wellVisitOrder)
// ===================================================================================================================
const junkBag = (pad = 10) => bagOf([it('egg', 16), it('flint', 30), it('cobblestone', 64), it('torch', 5)], pad)
const visitArgs = (over = {}) => ({ now: NOW, slots: 14, visitJunkStacks: 2, inZone: true, distHome: 5, dy: 0, distWell: 8,
  well: { open: false, attended: false, breached: false }, inside: false, depth: () => null, state: {}, wellState: {}, on: true, myName: 'b-Alpha', ...over })
await t('well visit: in the zone, below 34, >= 1 listed stack, a usable well within 20 -> dispose_well {visit, armed, dh, dy, dw, vid}; latched', () => {
  const r = W.wellVisitOrder(visitArgs())
  assert.equal(r.order?.skill, 'dispose_well')
  assert.deepEqual(Object.keys(r.order.args).sort(), ['armed', 'dh', 'dw', 'dy', 'vid', 'visit'])
  assert.equal(r.order.args.visit, true); assert.equal(r.order.args.armed, 'first'); assert.equal(r.order.args.dh, 5); assert.equal(r.order.args.dw, 8)
  assert.equal(r.state.latched, true); assert.equal(r.state.issuedAt, NOW)
  assert.equal(W.wellVisitOrder(visitArgs({ now: NOW + 3_600_000, state: r.state })).order, null, 'latched: no second order in the visit')
})
await t('well visit: every gate refuses alone (and charges nothing it should not)', () => {
  const none = (why, over) => assert.equal(W.wellVisitOrder(visitArgs(over)).order, null, why)
  none('switched off', { on: false })
  none('out of the zone', { inZone: false })
  none('beyond TOWN_RADIUS', { distHome: 49 })
  none('34 slots: the full-bag order', { slots: 34 })
  none('no listed stack', { visitJunkStacks: 0 })
  none('the well\'s cooldown', { wellState: { lastDisposeAt: NOW - W.DISPOSE_COOLDOWN_MS + 1 } })
  none('the well\'s backoff', { wellState: { disposeBackoffUntil: NOW + 1 } })
  none('scanned 10 s ago', { state: { lastScanAt: NOW - 10_000 } })
  none('inside a well', { inside: true })
  none('no well', { well: null })
  none('a breached well', { well: { breached: true } })
  none('an open well is close_well\'s', { well: { open: true } })
  none('21 from the well: never a walk across town', { distWell: 21 })
  none('the well\'s distance unknown', { distWell: null })
  assert.ok(W.wellVisitOrder(visitArgs({ distWell: 20 })).order, '20 is in reach')
  assert.ok(W.wellVisitOrder(visitArgs({ slots: 33, wellState: { lastDisposeAt: NOW - W.DISPOSE_COOLDOWN_MS } })).order, '33 slots, the cooldown just passed')
  const held = W.wellVisitOrder(visitArgs({ depth: () => ({ below: 20 }) }))
  assert.equal(held.order, null); assert.equal(held.held.skill, 'dispose_well'); assert.notEqual(held.state.latched, true, 'HELD: no latch')
})
await t('well visit: the goal\'s wanted names travel as `keep` (only names on the list), and disposePlan never plans them', () => {
  // matset-01 x junkout-01 (re-stack 10-25): plain glass is a BUILDING PART now (off the junk list); stained glass stays junk
  const r = W.wellVisitOrder(visitArgs({ keep: ['white_stained_glass', 'oak_log', 'flint'] }))
  assert.deepEqual(r.order.args.keep, ['white_stained_glass', 'flint'], 'oak_log is not the well\'s: not carried')
  assert.deepEqual(W.wellVisitOrder(visitArgs({ keep: ['glass', 'flint'] })).order.args.keep, ['flint'], 'plain glass is not the well\'s either (matset-01)')
  const items = bagOf([it('white_stained_glass', 12), it('flint', 30), it('egg', 16)], 5)
  assert.deepEqual(W.disposePlan(items, { keep: ['white_stained_glass'] }).stacks.map(s => s.name).sort(), ['egg', 'flint'])
  assert.equal(W.disposePlan(items, { keep: ['white_stained_glass'] }).slots, items.length, 'slots count the whole bag')
  assert.deepEqual(W.disposePlan(items).stacks.map(s => s.name).sort(), ['egg', 'flint', 'white_stained_glass'], 'positive control: without keep it goes')
  // and plain glass never goes, keep or not (matset-01: a building part)
  assert.deepEqual(W.disposePlan(bagOf([it('glass', 12), it('egg', 16)], 5)).stacks.map(s => s.name), ['egg'])
})
await t('well visit: the visit counts LISTED stacks only (disposePlan, no options): no sword, no cobble at the cap, no at-target stock', () => {
  const items = bagOf([it('stone_sword', 1), ...Array.from({ length: 4 }, () => it('cobblestone', 64)), it('egg', 16)], 3)
  assert.equal(W.disposePlan(items).junkStacks, 1, 'the egg only')
  assert.ok(W.disposePlan(items, { swords: true, cobbleAtCap: true }).junkStacks > 1, 'positive control: the full-bag options take more')
})
await t('MUTANT (well): the visit order without its 34-slot bound -> a full bag gets a visit order too (killed)', async () => {
  await withMutant(W_P, "  if (!(slots < TRIGGER_SLOTS)) return none()   // a full bag is the 34-slot order's\n  if (now - (wellState", '  if (now - (wellState', async m => {
    assert.ok(m.wellVisitOrder(visitArgs({ slots: 36 })).order, 'mutant inert')
  })
})
await t('MUTANT (well): the visit latch ignored -> a second order in the same visit (killed)', async () => {
  await withMutant(W_P, "  if (!on || !inZone || !(distHome <= TOWN_RADIUS) || s.latched) return none()", "  if (!on || !inZone || !(distHome <= TOWN_RADIUS)) return none()", async m => {
    const r = m.wellVisitOrder(visitArgs())
    assert.ok(m.wellVisitOrder(visitArgs({ now: NOW + 600_000, state: r.state })).order, 'mutant inert')
  })
})
await t('MUTANT (well): the well reach dropped -> a bot 40 from the well is sent across town (killed)', async () => {
  await withMutant(W_P, '  if (!(Number.isFinite(dw) && dw <= VISIT_WELL_REACH)) return none()', '', async m => {
    assert.ok(m.wellVisitOrder(visitArgs({ distWell: 40 })).order, 'mutant inert')
  })
})

// ===================================================================================================================
// B. THE COMPOSTER AT EVERY VISIT (composter.mjs compostVisitOrder / compostVisitStacks)
// ===================================================================================================================
await t('compost visit stacks: whole stacks the fill empties; NEVER a sapling; the peaceful plants only under the switch; apples above 4, whole', () => {
  const items = bagOf([it('leaf_litter', 20), it('wheat_seeds', 7), it('oak_sapling', 40), it('spruce_sapling', 5), it('brown_mushroom', 6), it('apple', 10), it('apple', 3)])
  assert.equal(C.compostVisitStacks(items), 2, 'leaf litter + seeds (no switch: no mushroom, no apple)')
  assert.equal(C.compostVisitStacks(items, { apples: true, plants: true }), 4, '+ the mushroom + the 3-apple stack (10+3-4 = 9 >= 3, then the 10 does not fit)')
  assert.equal(C.compostPlan(items, { apples: true, plants: true }).take.some(x => /_sapling$/.test(x.name)), true, 'positive control: the 34-slot plan takes sapling surplus')
  assert.equal(C.compostPlan(items, { apples: true, plants: true, saplings: false }).take.some(x => /_sapling$/.test(x.name)), false, 'the visit\'s plan never')
  assert.equal(C.nextInsert(bagOf([it('oak_sapling', 40)]), { saplings: false }), null)
  assert.ok(C.nextInsert(bagOf([it('oak_sapling', 40)])), 'positive control')
})
const cArgs = (over = {}) => ({ now: NOW, slots: 14, visitStacks: 1, inZone: true, distHome: 5, dy: -1, storageNear: true, distComposter: 6, state: {}, townState: {}, on: true, myName: 'b-Alpha', ...over })
await t('compost visit: in the zone, below 34, a whole stack, storage near, the composter within 20 -> compost {visit, armed, dh, dy, dc, vid}; every gate alone', () => {
  const r = C.compostVisitOrder(cArgs())
  assert.equal(r.order?.skill, 'compost'); assert.equal(r.order.args.visit, true); assert.equal(r.order.args.dc, 6); assert.equal(r.order.args.dy, -1)
  assert.equal(r.state.latched, true)
  assert.equal(C.compostVisitOrder(cArgs({ state: r.state, now: NOW + 600_000 })).order, null, 'latched')
  const none = (why, over) => assert.equal(C.compostVisitOrder(cArgs(over)).order, null, why)
  none('off', { on: false }); none('out of the zone', { inZone: false }); none('34', { slots: 34 }); none('nothing whole', { visitStacks: 0 })
  none('cooldown', { townState: { lastCompostAt: NOW - 1000 } }); none('backoff', { townState: { compostBackoffUntil: NOW + 1 } })
  none('no storage near', { storageNear: false }); none('no composter', { distComposter: null }); none('21 from the composter', { distComposter: 21 })
})
await t('MUTANT (composter): the visit counts saplings -> a bag of only surplus saplings starts a visit fill (killed)', async () => {
  await withMutant(C_P, "  const allow = compostAllowance(list, { apples, plants, saplings: false })   // never a sapling at a visit", "  const allow = compostAllowance(list, { apples, plants })", async m => {
    assert.equal(m.compostVisitStacks(bagOf([it('spruce_sapling', 5)]), { apples: true, plants: true }), 1, 'mutant inert')
  })
  assert.equal(C.compostVisitStacks(bagOf([it('spruce_sapling', 5)]), { apples: true, plants: true }), 0)
})

// ===================================================================================================================
// C. THE SLIM BAG ALLOWANCE (bagallowance.mjs rows, towndeposit.mjs townDepositPlan / stonePickSteps / tailOrder)
// ===================================================================================================================
await t('rows: stations 1 each, torch 0, bone meal 0; every other name has no row (kept whole)', () => {
  for (const n of BA.STATIONS) { assert.equal(BA.allowanceRow(n), 'station'); assert.equal(BA.rowKeep(n), 1) }
  assert.equal(BA.rowKeep('torch'), 0); assert.equal(BA.rowKeep('bone_meal'), 0)
  for (const n of ['ladder', 'apple', 'stone_bricks', 'magma_block', 'dirt', 'oak_slab', 'white_bed']) { assert.equal(BA.allowanceRow(n), null, n); assert.equal(BA.rowKeep(n), Infinity, n) }
})
await t('allowanceSteps: WHOLE stacks, smallest first, while what remains >= max(row, floor); room caps a name', () => {
  const items = bagOf([it('chest', 8), it('chest', 64), it('torch', 30), it('torch', 5), it('bone_meal', 40), it('crafting_table', 3)])
  const s = BA.allowanceSteps(items)
  assert.deepEqual(s.map(x => `${x.name}:${x.count}`).sort(), ['bone_meal:40', 'chest:8', 'torch:30', 'torch:5'].sort(), 'one chest stack stays (64), the 8 goes; the 3 tables are one stack: nothing')
  assert.deepEqual(BA.allowanceSteps(items, { keeps: { torch: 20 } }).filter(x => x.name === 'torch').map(x => x.count), [5], 'a floor of 20: the 5 goes, the 30 stays')
  assert.deepEqual(BA.allowanceSteps(items, { room: n => (n === 'torch' ? 10 : Infinity) }).filter(x => x.name === 'torch').map(x => x.count), [5], 'room 10: the 5 only')
  assert.deepEqual(BA.allowanceSteps(items, { owned: n => n === 'bone_meal' }).filter(x => x.name === 'bone_meal'), [], 'owned: never')
})
const pk = (uses, name = 'stone_pickaxe') => tool(name, uses)
await t('row P: the best working pickaxe (any tier) + the 2 stone copies with most uses stay; only USABLE copies beyond go; room and holds', () => {
  const b1 = bagOf([pk(250, 'iron_pickaxe'), pk(120), pk(100), pk(80), pk(50), pk(5), pk(1)])
  const r1 = TD.stonePickSteps(b1)
  assert.equal(r1.keepPicks, 2, 'iron is the best: two stone spares')
  assert.deepEqual(r1.steps.map(s => 131 - b1.find(x => x.slot === s.slot).durabilityUsed).sort((a, b) => b - a), [80, 50], 'the 80 and 50 go; 5 (worn) and 1 (spent) never')
  const b2 = bagOf([pk(120), pk(100), pk(80), pk(50)])
  assert.equal(TD.stonePickSteps(b2).keepPicks, 3, 'a stone best + 2 spares'); assert.equal(TD.stonePickSteps(b2).steps.length, 1)
  assert.equal(TD.stonePickSteps(b2, { room: 0 }).steps.length, 0, 'the town at its target'); assert.equal(TD.stonePickSteps(b2, { holds: { stone_pickaxe: 1 } }).steps.length, 0, 'a withdraw hold')
  // Claude design r3 P3-3: a LOW-durability iron pickaxe (11 uses: working, > FLOOR) is still the best; the spares are the stone
  const b3 = bagOf([pk(FLOOR + 1, 'iron_pickaxe'), pk(120), pk(110), pk(100)])
  assert.equal(TD.stonePickSteps(b3).keepPicks, 2); assert.equal(TD.stonePickSteps(b3).steps.length, 1, 'the 100 goes: iron + 120 + 110 stay')
  assert.equal(TD.stonePickSteps(bagOf([pk(FLOOR, 'iron_pickaxe'), pk(120), pk(110), pk(100)])).steps.length, 0, `an iron at ${FLOOR} is not working: the 120 is the best, 110 + 100 its spares`)
  assert.deepEqual(TD.stonePickSteps(bagOf([pk(1), pk(1), pk(1), pk(1)])).steps, [], 'all spent: nothing (never a chest\'s)')
})
const tailBag = () => bagOf([it('chest', 8), it('crafting_table', 3), it('furnace', 1), pk(120), pk(110), pk(100), pk(90), it('torch', 11), it('bone_meal', 30),
  it('egg', 16), it('flint', 20), it('oak_sapling', 20), it('leaf_litter', 30), it('cobblestone', 64), it('cobblestone', 20), it('oak_log', 64), it('oak_log', 10), it('water_bucket', 1), it('water_bucket', 1)], 0)
await t('the tail plan (`tail: only`): the rows ONLY -- torch, bone meal, the 2nd filled bucket, the usable spare beyond best + 2; no base step, no junk, no sapling', () => {
  const items = tailBag()
  const p = TD.townDepositPlan(items, { tail: 'only' })
  const names = p.steps.map(s => `${s.name}:${s.allowance}`)
  assert.deepEqual(names.filter(n => !n.startsWith('stone_pickaxe')).sort(), ['bone_meal:bone_meal', 'torch:torch', 'water_bucket:station'].sort(), JSON.stringify(names))
  assert.equal(p.steps.filter(s => s.name === 'stone_pickaxe').length, 1, 'four usable stone copies: the 90 goes (best 120 + 110, 100)')
  assert.ok(p.steps.every(s => s.allowance), 'no base step (the cobble 20, the 10 logs stay)')
  for (const n of ['egg', 'flint', 'oak_sapling', 'leaf_litter', 'chest', 'crafting_table', 'furnace', 'cobblestone', 'oak_log']) assert.ok(!p.steps.some(s => s.name === n), `${n} stays`)
  assert.equal(p.keepPicks, 3)
  assert.equal(TD.townDepositPlan(items, { tail: 'only', bagAllowance: false }).steps.length, 0, 'BAG_ALLOWANCE=off: nothing')
  assert.ok(TD.townDepositPlan(items, { tail: false }).steps.every(s => !s.allowance), 'tail:false = the base plan exactly')
})
await t('the full-bag plan (append): base steps FIRST, then the rows; a name the base moves is never a row\'s; the goal\'s wants win', () => {
  const items = bagOf([...tailBag(), ...Array.from({ length: 17 }, (_, i) => it('ladder', 1 + (i % 3)))])
  assert.equal(items.length, 36)
  const p = TD.townDepositPlan(items)
  const first = p.steps.findIndex(s => s.allowance)
  assert.ok(first > 0 && p.steps.slice(first).every(s => s.allowance), `base first: ${JSON.stringify(p.steps.map(s => s.name))}`)
  assert.ok(p.steps.slice(0, first).some(s => s.name === 'stone_pickaxe'), 'the base tool rule banks the spares (a ceiling, design 3 C)')
  assert.ok(!p.steps.slice(first).some(s => s.name === 'stone_pickaxe'), 'row P never doubles a name the base moved')
  const wanted = TD.townDepositPlan(items, { wanted: ['torch'] })
  assert.ok(!wanted.steps.some(s => s.name === 'torch'), 'a wanted torch is kept up to a stack (WANTED_KEEP)')
})
await t('PROPERTY: over 500 random bags, no row step is ever a junk name, a sapling, bamboo, a compost input or a name another layer owns; no station below 1', () => {
  const pool = ['egg', 'flint', 'glass', 'white_wool', 'leaf_litter', 'wheat_seeds', 'poppy', 'brown_mushroom', 'kelp', 'apple', 'oak_sapling', 'birch_sapling', 'bamboo',
    'torch', 'bone_meal', 'chest', 'crafting_table', 'furnace', 'bucket', 'water_bucket', 'cobblestone', 'oak_log', 'stick', 'dirt', 'iron_ingot', 'coal', 'ladder', 'rail', 'pointed_dripstone']
  let seed = 7
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  let rows = 0
  for (let i = 0; i < 500; i++) {
    const items = bagOf(Array.from({ length: 4 + rnd(32) }, () => { const n = pool[rnd(pool.length)]; const sz = mcData.itemsByName[n].stackSize; return it(n, 1 + rnd(sz)) }))
    for (const peaceful of [false, true]) {
      const p = TD.townDepositPlan(items, { tail: 'only', peaceful, noSwords: peaceful })
      for (const s of p.steps) {
        rows++
        assert.ok(!TD.notForChest(s.name, { peaceful }) && !TD.bankOwned(s.name), `${s.name} is never a row's`)
        assert.ok(!W.WELL_JUNK.has(s.name) && !C.isCompostJunk(s.name) && !/_sapling$/.test(s.name), s.name)
      }
      const held = n => items.filter(x => x.name === n).reduce((a, x) => a + x.count, 0)
      for (const n of BA.STATIONS) {
        const out = p.steps.filter(s => s.name === n).reduce((a, s) => a + s.count, 0)
        if (held(n) >= 1) assert.ok(held(n) - out >= 1, `${n}: one stays`)
      }
    }
  }
  assert.ok(rows > 100, `positive control: the property saw ${rows} row steps`)
})
await t('notForChest / bankOwned: junk, compost inputs, saplings, bamboo, the peaceful plants (switch on) are never a chest\'s; tools, targets, iron are owned', () => {
  for (const n of ['egg', 'flint', 'leaf_litter', 'oak_sapling', 'mangrove_propagule', 'bamboo', 'rail', 'white_stained_glass']) assert.equal(TD.notForChest(n), true, n)
  // matset-01 x junkout-01: plain glass and glass_pane are building parts -- a chest's, always banked
  for (const n of ['glass', 'glass_pane', 'stone_bricks']) assert.equal(TD.notForChest(n), false, n)
  assert.equal(TD.notForChest('brown_mushroom'), false); assert.equal(TD.notForChest('brown_mushroom', { peaceful: true }), true)
  assert.equal(TD.notForChest('apple', { peaceful: true }), true)
  for (const n of ['torch', 'bone_meal', 'chest']) { assert.equal(TD.notForChest(n), false, n); assert.equal(TD.bankOwned(n), false, n) }
  for (const n of ['stone_pickaxe', 'iron_pickaxe', 'cobblestone', 'oak_log', 'stick', 'coal', 'iron_ingot', 'raw_iron', 'diamond']) assert.equal(TD.bankOwned(n), true, n)
})
await t('MUTANT (towndeposit): the rows without notForChest -> a row name the owner later puts on the junk list would bank (killed)', async () => {
  // No row name is junk today, so the guard is defence in depth: it holds when a list grows. The scenario is driven for real --
  // bone meal put on the well's list for this test (Object.freeze does not freeze a Set's contents) -- and the mutant, without
  // the guard, must plan it into a chest while the real plan refuses it.
  await withMutant(TD_P, '    const owned = n => planned.has(n) || bankOwned(n) || notForChest(n, { peaceful }) || (holds[n] ?? 0) > 0',
    '    const owned = n => planned.has(n) || bankOwned(n) || (holds[n] ?? 0) > 0', async m => {
      const W2 = await import('../src/well.mjs')
      W2.WELL_JUNK.add('bone_meal')
      try {
        assert.equal(TD.notForChest('bone_meal'), true, 'the stand-in is junk now')
        assert.ok(m.townDepositPlan(bagOf([it('bone_meal', 9)]), { tail: 'only' }).steps.some(s => s.name === 'bone_meal'), 'mutant inert')
        assert.ok(!TD.townDepositPlan(bagOf([it('bone_meal', 9)]), { tail: 'only' }).steps.some(s => s.name === 'bone_meal'), 'the real plan refuses it')
      } finally { W2.WELL_JUNK.delete('bone_meal') }
    })
})
const tArgs = (over = {}) => ({ now: NOW, slots: 14, pos: { x: 4, y: 70, z: 3 }, home: { x: 0, y: 70, z: 0 }, plan: { freed: 2, steps: [{ allowance: 'torch' }, { allowance: 'bone_meal' }] },
  container: true, state: {}, on: true, myName: 'b-Alpha', ...over })
await t('tail order: in the zone, below 34, freed >= 1, a container -> town_deposit {tail, armed, dh, dy, vid}; once per stay; every gate alone', () => {
  const r = TD.tailOrder(tArgs())
  assert.equal(r.order?.skill, 'town_deposit'); assert.equal(r.order.args.tail, true); assert.equal(r.order.args.dh, 5); assert.equal(r.order.args.dy, 0)
  assert.equal(r.state.latched, true); assert.equal(r.state.lastIssuedAt, NOW)
  assert.equal(TD.tailOrder(tArgs({ state: r.state, now: NOW + 600_000 })).order, null, 'latched for the stay')
  const none = (why, over) => assert.equal(TD.tailOrder(tArgs(over)).order, null, why)
  none('off', { on: false }); none('out of the zone (17 h)', { pos: { x: 17, y: 70, z: 0 } }); none('13 below', { pos: { x: 0, y: 57, z: 0 } })
  none('34: the full-bag deposit appends the rows itself', { slots: 34 }); none('nothing to free', { plan: { freed: 0, steps: [] } })
  none('no container', { container: false }); none('cooldown', { state: { lastIssuedAt: NOW - 1000 } }); none('backoff', { state: { backoffUntil: NOW + 1 } })
  none('scanned 10 s ago', { state: { lastScanAt: NOW - 10_000 } })
  // the outcome is the town deposit's own rule, in the TAIL's state: a full chest backs the tail off, a decline un-latches
  const failed = TD.townDepositOutcome('failed', 'town_storage_full', NOW, r.state)
  assert.equal(failed.backoffUntil, NOW + TD.TD_BACKOFF_MS); assert.equal(TD.townDepositOutcome('failed', 'runner_busy', NOW, r.state).latched, false)
})
await t('the full-bag order: a ROWS-ONLY plan still takes the count step (recount, count=allowance_only) when the town must be counted', () => {
  const plan = { freed: 1, steps: [{ allowance: 'torch' }] }
  const base = { now: NOW, slots: 35, pos: { x: 1, y: 70, z: 0 }, home: { x: 0, y: 70, z: 0 }, plan, container: true, state: {} }
  assert.deepEqual(TD.townDepositOrder({ ...base, count: true }).order.args, { recount: true, count: 'allowance_only' })
  assert.deepEqual(TD.townDepositOrder({ ...base, count: false }).order.args, {})
  assert.deepEqual(TD.townDepositOrder({ ...base, count: true, plan: { freed: 1, steps: [{}] } }).order.args, {}, 'a base step: no count first (today)')
})
await t('MUTANT (towndeposit): the tail order without its 34-slot bound -> a full bag gets a second deposit order (killed)', async () => {
  await withMutant(TD_P, '  if (!(slots < TD_TRIGGER_SLOTS)) return none()\n  if (now - (s.lastIssuedAt ?? -Infinity) < TD_COOLDOWN_MS', '  if (now - (s.lastIssuedAt ?? -Infinity) < TD_COOLDOWN_MS', async m => {
    assert.ok(m.tailOrder(tArgs({ slots: 36 })).order, 'mutant inert')
  })
})

await t('CHAIN (composed, design 4 chain 4): a 34-slot bag with junk + torch -> the full-bag deposit banks base + rows -> 33 slots -> the full-bag well order is off, the VISIT order takes the junk in the same visit', () => {
  const items = bagOf([it('egg', 16), it('flint', 30), it('torch', 9), it('cobblestone', 64), it('cobblestone', 64)], 29)
  assert.equal(items.length, 34)
  const p = TD.townDepositPlan(items)
  assert.ok(p.steps.some(s => s.name === 'torch') && !p.steps.some(s => ['egg', 'flint'].includes(s.name)), JSON.stringify(p.steps))
  const after = items.filter(x => !p.steps.some(s => s.slot === x.slot))
  assert.ok(after.length < 34, `the bank took the bag under the trigger: ${after.length}`)
  const full = W.wellOrder({ now: NOW, slots: after.length, freeSlots: 36 - after.length, junkStacks: W.disposePlan(after).junkStacks, distHome: 3, well: { open: false, attended: false } })
  assert.equal(full.order, null, 'the 34-slot order is off at 33')
  const v = W.wellVisitOrder(visitArgs({ slots: after.length, visitJunkStacks: W.disposePlan(after).junkStacks }))
  assert.equal(v.order?.skill, 'dispose_well'); assert.equal(v.order.args.visit, true)
})

// ===================================================================================================================
// D. THE WEAR-OUT SPARES CAP (hygiene.mjs wearOutPlan / spentKeptUnderSpares)
// ===================================================================================================================
const full = items => bagOf(items, 36 - items.length)
await t('D: with a working pickaxe, last-swing keeps only what the two spares leave; WITHOUT one, the three stay (the recovery\'s material)', () => {
  assert.equal(H.spentKeptUnderSpares(bagOf([pk(120), pk(1), pk(1), pk(1)])), 2, 'a stone best, no spare: two spent kept')
  assert.equal(H.spentKeptUnderSpares(bagOf([pk(120), pk(60), pk(1), pk(1), pk(1)])), 1, 'one spare: one spent')
  assert.equal(H.spentKeptUnderSpares(bagOf([pk(120), pk(60), pk(5), pk(1)])), 0, 'two spares (a worn 5 counts: >= 2 uses): none')
  assert.equal(H.spentKeptUnderSpares(bagOf([pk(1), pk(1), pk(1), pk(1)])), H.SPENT_PICKAXES_KEPT, 'no working pickaxe: three')
  assert.equal(H.spentKeptUnderSpares(bagOf([pk(FLOOR), pk(1), pk(1), pk(1)])), H.SPENT_PICKAXES_KEPT, `a ${FLOOR}-use copy is not working`)
  // the plan: a 36-slot bag, a stone best, four spent -> two listed (one more than the deployed rule)
  const b = full([pk(120), pk(1), pk(1), pk(1), pk(1)])
  const on = H.wearOutPlan(b), off = H.wearOutPlan(b, { allowance: false })
  assert.equal(off.tools.length, 1); assert.equal(on.tools.length, 2); assert.equal(on.junkout, 1, 'the one listed only because of the spares cap')
  // CHAIN SHAPE (Claude design r2 P2-2): 34+ slots, three spent stone copies, NO cobble, no other pickaxe -> the three stay
  const lone = full([pk(1), pk(1), pk(1)])
  assert.equal(H.wearOutPlan(lone).tools.filter(x => x.name.endsWith('_pickaxe')).length, 0, 'the last swings are all it has')
  assert.equal(H.wearOutPlan(bagOf([pk(120), pk(1), pk(1), pk(1), pk(1)], 20)).tools.length, 0, 'below 34: nothing, as today')
})
await t('MUTANT (hygiene): the working-pickaxe condition dropped -> a bag of only spent copies loses its third last swing (killed)', async () => {
  await withMutant(H_P, '  if (!best) return SPENT_PICKAXES_KEPT\n', '', async m => {
    assert.ok(m.wearOutPlan(full([pk(1), pk(1), pk(1)])).tools.length > 0, 'mutant inert')
  })
})

// ===================================================================================================================
// E. THE ROWS (what the read parses)
// ===================================================================================================================
await t('rows: the visit row leads with vid, armed, dh, dy, dw and the throw classes; the bank row is complete in parts, each <= 300', () => {
  const v = BA.junkoutVisitDetail({ phase: 'well', vid: 'b.x1', armed: 'out:a-b', dh: 5, dy: -1, dw: 8, offlist: 0, swords: 0, cobble: 0, stock: 0, slotsBefore: 20, slotsAfter: 17, listed: 3, n: 46, status: 'success' })
  assert.equal(v, 'phase=well vid=b.x1 armed=out:a-b dh=5 dy=-1 dw=8 offlist=0 swords=0 cobble=0 stock=0 slots=20->17 listed=3 n=46 status=success')
  const planned = Array.from({ length: 30 }, (_, i) => ({ name: `name_${String(i).padStart(2, '0')}_padding_padding`, row: 'station' }))
  const banked = Object.fromEntries(planned.map(p => [p.name, 3])); banked.other_thing = 4
  const parts = BA.junkoutBankDetails({ planned, heldBefore: banked, banked, slotsBefore: 30, slotsAfter: 10, peaceful: true, visit: 'b.x2', mode: 'tail', keepPicks: 3, dh: 4, dy: 0, armed: 'first' })
  assert.ok(parts.length > 1 && parts.every(p => p.length <= 300), `${parts.length} parts`)
  parts.forEach((p, i) => assert.match(p, new RegExp(`^phase=bank v=b\\.x2 mode=tail armed=first dh=4 dy=0 peaceful=1 stacks=30 banked=90 slots=30->10 keep_picks=3 rows=station:30 part=${i + 1}/${parts.length} `)))
  const toks = parts.flatMap(p => p.split(' ').filter(x => /^(allow|other)=/.test(x)))
  assert.equal(toks.length, 31, 'every planned name and every other banked name is on some part')
  const ab = BA.junkoutBankDetails({ planned: [{ name: 'torch', row: 'torch' }], heldBefore: { torch: 11 }, banked: {}, attempted: { torch: 11, egg: 4 }, visit: 'b.x3' })
  assert.match(ab[0], / allow=torch=11:0 try=egg:4 try=torch:11$/, 'an aborted run names what it clicked and the server did not verify')
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
