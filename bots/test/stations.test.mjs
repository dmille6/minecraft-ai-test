// STATIONS-01 (owner 11-06: the town's crafting tables and furnaces). The pure decisions (stations.mjs, smelting.mjs's spare fuel)
// are tested by what they return; the smelt's take-back and the spare-table fuel are driven THROUGH THE REAL smelt skill, and the
// groundskeepers' furnace sweep through the real sweepFurnace, over a fake world (stationkeep-01's harness: craft-room.test.mjs's
// dig / drop / block-event semantics, a furnace window that converts). The wiring behaviour cannot reach is asserted on
// comment-stripped source; every anchored mutant is killed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stations-'))
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stations-pool-'))
process.env.BOT_NAME = 'StationsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
for (const k of ['STATIONS', 'STN_RETAKE', 'STN_SWEEP', 'STN_REUSE', 'STN_WITHDRAW', 'STN_SURPLUS']) delete process.env[k]

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const ST = await import('../src/stations.mjs')
const SM = await import('../src/smelting.mjs')
const { SKILLS, sweepFurnace } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---------------------------------------------------------------------------------------------- the pure decisions
const HOME = { x: 0, y: 64, z: 0 }
const S = (x, z, name = 'crafting_table', extra = {}) => ({ at: [x, extra.y ?? 64, z], name, lit: false, ...extra })

await t('stnOn: every part on by default; STATIONS=0 turns all off; STN_<PART>=0 one', () => {
  for (const p of ST.STN_PARTS) assert.equal(ST.stnOn(p, {}), true)
  assert.equal(ST.stnOn('sweep', { STATIONS: '0' }), false)
  assert.equal(ST.stnOn('retake', { STATIONS: 'off' }), false)
  assert.equal(ST.stnOn('sweep', { STN_SWEEP: 'off' }), false)
  assert.equal(ST.stnOn('retake', { STN_SWEEP: 'off' }), true)
})

await t('inTownSurface: the town square at the surface only (the shaft and mines below are away)', () => {
  assert.equal(ST.inTownSurface({ x: 60.5, y: 64, z: -60.5 }, HOME, 64), true)
  assert.equal(ST.inTownSurface({ x: 65.5, y: 64, z: 0 }, HOME, 64), false, 'outside the square')
  assert.equal(ST.inTownSurface({ x: 0, y: 40, z: 0 }, HOME, 64), false, 'under the town: a mine')
  assert.equal(ST.inTownSurface({ x: 0, y: 52, z: 0 }, HOME, 64), true, 'home.y - 12 is still the surface')
  assert.equal(ST.inTownSurface({ x: 0, y: 64, z: 0 }, HOME, null), false, 'no half-width: not in town')
})

const PLAN = { plots: [{ id: 'core' }, { id: 'work', stations: [{ at: [10, 65, 10], kind: 'crafting_table', stand: [10, 65, 9] }, { at: [11, 65, 10], kind: 'furnace', stand: [11, 65, 9] }, { at: [12, 65, 10], kind: 'furnace', stand: [12, 65, 9] }] }] }
await t('townStations: the complete workshop first; else the plan\'s work-plot cells (the designated spot); else none', () => {
  const ws = ST.townStations({ tables: new Set(['1,2,3']), furnaces: new Set(['4,5,6']) }, PLAN)
  assert.equal(ws.source, 'workshop'); assert.deepEqual([...ws.tables], ['1,2,3']); assert.deepEqual([...ws.furnaces], ['4,5,6'])
  const pl = ST.townStations({ tables: new Set(), furnaces: new Set() }, PLAN)
  assert.equal(pl.source, 'plan'); assert.deepEqual([...pl.tables], ['10,65,10']); assert.deepEqual([...pl.furnaces], ['11,65,10', '12,65,10'])
  assert.equal(ST.townStations(null, { plots: [] }).source, 'none')
})

await t('designatedCell: only a plan town, the first FREE cell of the kind; a workshop town never places', () => {
  const pl = ST.townStations(null, PLAN)
  assert.deepEqual(ST.designatedCell(pl, 'furnace', at => at[0] === 12).at, [12, 65, 10])
  assert.equal(ST.designatedCell(pl, 'furnace', () => false), null, 'no free cell: none')
  assert.equal(ST.designatedCell(ST.townStations({ tables: new Set(['1,2,3']) }, PLAN), 'crafting_table', () => true), null)
  assert.equal(ST.designatedCell(pl, 'chest', () => true), null)
})

await t('smeltRetake: only the JOB\'s furnace (the one placed), drained, never designated, aborted or unread (Codex)', () => {
  const ok = { placed: '1,64,0', used: '1,64,0', input: 0, output: 0, fuel: 0, on: true }
  assert.deepEqual(ST.smeltRetake(ok), { retake: true, why: 'drained' })
  assert.equal(ST.smeltRetake({ ...ok, used: '5,64,5' }).why, 'not_the_job_furnace', 'another furnace\'s slots prove nothing')
  assert.equal(ST.smeltRetake({ ...ok, designated: true }).why, 'designated')
  assert.equal(ST.smeltRetake({ ...ok, fuel: 1 }).why, 'fuel_left')
  assert.equal(ST.smeltRetake({ ...ok, input: 3 }).why, 'input_left')
  assert.equal(ST.smeltRetake({ ...ok, output: 2 }).why, 'output_left')
  assert.equal(ST.smeltRetake({ ...ok, fuel: undefined }).why, 'unread')
  assert.equal(ST.smeltRetake({ ...ok, aborted: true }).why, 'aborted')
  assert.equal(ST.smeltRetake({ ...ok, placed: null }).why, 'not_placed')
  assert.equal(ST.smeltRetake({ ...ok, on: false }).why, 'off')
})

await t('furnaceEmpty: every slot read empty and unlit; unknown is not empty', () => {
  assert.deepEqual(ST.furnaceEmpty({ input: null, fuel: null, output: null, lit: false }), { ok: true, why: 'empty' })
  assert.equal(ST.furnaceEmpty({ input: { count: 2 }, fuel: null, output: null }).why, 'holds_input')
  assert.equal(ST.furnaceEmpty({ input: null, fuel: undefined, output: null }).why, 'unread_fuel')
  assert.equal(ST.furnaceEmpty({ input: null, fuel: null, output: null, lit: true }).why, 'lit')
  assert.equal(ST.furnaceEmpty(null).ok, false)
})

await t('strays: the town\'s stations, record cells, zones, villages, hoppers, lit/leased furnaces, deep, outside and given-up never taken', () => {
  const found = [S(1, 0), S(2, 0), S(3, 0), S(35, 35), S(5, 0), S(6, 0), S(7, 0, 'furnace', { lit: true }), S(8, 0, 'furnace'), S(9, 0, 'crafting_table', { y: 40 }), S(200, 0), S(10, 0), S(11, 0, 'chest'), S(12, 0)]
  const r = ST.strayStations(found, { home: HOME, keep: new Set(['1,64,0']), cells: new Set(['2,64,0']), zone: x => x === 3, bells: [[40, 64, 40]],
    hopper: k => k === '5,64,0', leased: k => k === '8,64,0', given: k => k === '12,64,0' })
  // 6 (nearest stray), 10; 35,35 is a village's (a bell 7 away), 9 is deep
  assert.deepEqual(r.sweep.map(c => c.at.join(',')), ['6,64,0', '10,64,0'])
  assert.deepEqual(r.skipped, { town_station: 1, record_cell: 1, zone: 1, village: 1, hopper: 1, lit: 1, leased: 1, deep: 1, outside: 1, given_up: 1 })
})

await t('strays: EVERY stray is taken, furnaces too (no nearest-two kept: the workshop is the town\'s), nearest the BOT first', () => {
  const r = ST.strayStations([S(1, 0), S(2, 0, 'furnace'), S(50, 50), S(60, 60, 'furnace')], { home: HOME, from: { x: 60, y: 64, z: 60 } })
  assert.deepEqual(r.sweep.map(c => c.at.join(',')), ['60,64,60', '50,64,50', '2,64,0', '1,64,0'])
})

await t('noteSweep / sweepGivenUp: two tries still standing -> given up for SWEEP.giveUpMs, then tried again; a dug one is forgotten', () => {
  const m = new Map()
  ST.noteSweep(m, ['1,64,0', '2,64,0'], k => k === '1,64,0', 1000)
  ST.noteSweep(m, ['1,64,0'], () => true, 2000)
  assert.equal(ST.sweepGivenUp(m, '1,64,0', 3000), true)
  assert.equal(ST.sweepGivenUp(m, '1,64,0', 2000 + ST.SWEEP.giveUpMs + 1), false, 'given up for a while, not forever')
  assert.equal(m.has('2,64,0'), false)
})

await t('withdrawFirst: a station, in town, holding none, the chests holding one', () => {
  assert.equal(ST.withdrawFirst({ item: 'furnace', held: 0, inTown: true, stock: 2, on: true }), true)
  assert.equal(ST.withdrawFirst({ item: 'furnace', held: 1, inTown: true, stock: 2, on: true }), false)
  assert.equal(ST.withdrawFirst({ item: 'furnace', held: 0, inTown: false, stock: 2, on: true }), false, 'away: craft')
  assert.equal(ST.withdrawFirst({ item: 'crafting_table', held: 0, inTown: true, stock: 0, on: true }), false)
  assert.equal(ST.withdrawFirst({ item: 'stick', held: 0, inTown: true, stock: 9, on: true }), false)
  assert.equal(ST.withdrawFirst({ item: 'furnace', held: 0, inTown: true, stock: 2, on: false }), false)
})

await t('SURPLUS: a spare table is fuel only when offered, before planks; the bag\'s one table never', () => {
  assert.equal(ST.spareTables(3, true), 2); assert.equal(ST.spareTables(1, true), 0); assert.equal(ST.spareTables(3, false), 0)
  assert.equal(SM.chooseFuel({ crafting_table: 2 }), null, 'not a fuel anywhere by default (the prompt, the work order)')
  assert.equal(SM.chooseFuel({ crafting_table: 2, oak_planks: 8 }, { needTicks: 200, extra: SM.SPARE_FUEL_TICKS }).name, 'crafting_table')
  assert.equal(SM.chooseFuel({ crafting_table: 2, coal: 3 }, { needTicks: 200, extra: SM.SPARE_FUEL_TICKS }).name, 'coal', 'coal still first')
  const p = SM.smeltPlan({ held: { raw_iron: 3, crafting_table: 2 }, item: 'raw_iron', count: 3, budgetMs: 3_600_000, extraFuel: SM.SPARE_FUEL_TICKS })
  assert.equal(p.ok, true); assert.equal(p.fuel.name, 'crafting_table'); assert.equal(p.fuel.count, 2)
})

// ---------------------------------------------------------------------------------------------- the smelt, for real
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
const item = (name, count = 1, { left = null } = {}) => {
  const d = mc.itemsByName[name]
  const it = { name, type: d.id, count, stackSize: d.stackSize, nbt: null }
  if (d.maxDurability) { it.maxDurability = d.maxDurability; it.durabilityUsed = left == null ? 0 : d.maxDurability - left }
  return it
}
function makeBot (stacks, { onDig = null, eventless = false, keepInput = false, furnaceHolds = null } = {}) {
  const slots = Array(36).fill(null)
  stacks.forEach((s, i) => { slots[i] = { ...s } })
  const world = new Map()
  const digs = []
  const nameAt = p => world.get(key(p)) ?? (p.y < 64 ? 'stone' : 'air')
  const blockAt = p => {
    if (!p) return null
    const name = nameAt(p); const d = mc.blocksByName[name]
    return { name, type: d.id, stateId: d.defaultState, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), boundingBox: d.boundingBox,
             hardness: d.hardness, diggable: true, drops: d.drops, material: d.material, harvestTools: d.harvestTools, getProperties: () => ({ lit: false }) }
  }
  const setBlock = (p, name) => { const old = blockAt(p); world.set(key(p), name); if (!eventless) bot.emit(`blockUpdate:${new Vec3(p.x, p.y, p.z)}`, old, blockAt(p)) }
  const putAway = it => {
    let left = it.count
    for (const s of slots) { if (left <= 0) break; if (s && s.name === it.name && s.count < s.stackSize && !it.maxDurability) { const n = Math.min(left, s.stackSize - s.count); s.count += n; left -= n } }
    while (left > 0) { const i = slots.indexOf(null); if (i < 0) return false; const n = Math.min(left, it.stackSize); slots[i] = { ...it, count: n }; left -= n }
    return true
  }
  const take = (name, n) => {
    for (let i = 0; i < slots.length && n > 0; i++) { const s = slots[i]; if (!s || s.name !== name) continue; const k = Math.min(n, s.count); s.count -= k; n -= k; if (s.count === 0) slots[i] = null }
    if (n > 0) throw new Error('not enough')
  }
  const have = name => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0)
  const F = { input: null, fuel: null, output: null, ...(furnaceHolds ?? {}) }
  const fitem = (name, count) => (count > 0 ? item(name, count) : null)
  const burned = {}
  const furnace = {
    inputItem: () => F.input, fuelItem: () => F.fuel, outputItem: () => F.output, fuel: 0,
    items: () => slots.filter(Boolean), emptySlotCount: () => slots.filter(s => !s).length, selectedItem: null,
    async putInput (_id, _m, n) { take('raw_iron', n); F.input = fitem('raw_iron', n) },
    async putFuel (id, _m, n) {
      const nm = mc.items[id]?.name ?? 'coal'
      take(nm, n); burned[nm] = (burned[nm] ?? 0) + n; F.fuel = null
      const k = Math.min(F.input?.count ?? 0, 8 * n) - (keepInput ? 1 : 0)
      F.output = fitem('iron_ingot', k); F.input = fitem('raw_iron', (F.input?.count ?? 0) - k)
    },
    async takeOutput () { assert.ok(F.output); putAway(F.output); const o = F.output; F.output = null; return o },
    async takeInput () { assert.ok(F.input); if (!keepInput) { putAway(F.input); F.input = null } else throw new Error('bag full') },
    async takeFuel () { assert.ok(F.fuel); putAway(F.fuel); F.fuel = null },
    close () {},
  }
  const bot = Object.assign(new EventEmitter(), {
    registry: mc, username: 'StationsBot',
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) },
    entities: {}, heldItem: null, health: 20, food: 20,
    inventory: { items: () => slots.map((s, i) => (s ? Object.assign(s, { slot: 9 + i }) : null)).filter(Boolean), emptySlotCount: () => slots.filter(s => !s).length },
    findBlock ({ matching, maxDistance = 32 }) {
      const hits = [...world.keys()].map(k => blockAt(new Vec3(...k.split(',').map(Number)))).filter(b => matching(b) && b.position.distanceTo(bot.entity.position) <= maxDistance)
      return hits[0] ?? null
    },
    findBlocks ({ matching, maxDistance = 32, count = 1, point = null }) {
      const from = point ?? bot.entity.position
      return [...world.keys()].map(k => blockAt(new Vec3(...k.split(',').map(Number)))).filter(b => b.name !== 'air' && matching(b) && b.position.distanceTo(from) <= maxDistance).slice(0, count).map(b => b.position)
    },
    blockAt,
    canDigBlock: b => !!b && b.position.distanceTo(bot.entity.position) < 5.1,
    async equip (it) { bot.heldItem = slots.find(s => s && s.slot === it.slot) ?? null },
    async unequip () { bot.heldItem = null },
    async lookAt () {}, async waitForTicks () {},
    async placeBlock (ref, face) { const at = ref.position.offset(face.x, face.y, face.z); const name = bot.heldItem?.name ?? 'furnace'; setBlock(at, name); take(name, 1) },
    async dig (block) {
      onDig?.(block)
      digs.push({ name: block.name, at: key(block.position), with: bot.heldItem?.name ?? 'hand' })
      setBlock(block.position, 'air')
      const pick = /_pickaxe$/.test(bot.heldItem?.name ?? '')
      const drop = block.name === 'furnace' ? (pick ? 'furnace' : null) : block.name === 'stone' ? (pick ? 'cobblestone' : null) : block.name
      if (drop) putAway(item(drop, 1))
    },
    async openFurnace () { return furnace },
    nearestEntity () { return null },
    pathfinder: { async goto () {}, setGoal () {}, stop () {} },
  })
  return { bot, slots, world, digs, have, F, setBlock, burned }
}
const LOG = path.join(process.env.LOG_DIR, 'skill-StationsBot.jsonl')
const rowsSince = async (n = 0) => {
  await new Promise(r => setTimeout(r, 60))
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(n).map(l => JSON.parse(l)).map(r => ({ kind: r.skill.name, status: r.skill.status, detail: r.skill.detail }))
}
const mark = async () => (await rowsSince(0)).length
const smelt = (bot, count = 4) => SKILLS.smelt.run({ bot }, { item: 'raw_iron', count }, new AbortController().signal)
const PICK = () => item('stone_pickaxe', 1, { left: 100 })

await t('SMELT: the furnace it placed (in a mine: no town plan) is dug back once drained, with the pickaxe, and ARRIVES in the bag', async () => {
  const n = await mark()
  const { bot, have, world, digs } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()])
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('iron_ingot'), 4)
  assert.equal(have('furnace'), 1, `the furnace is back: ${JSON.stringify(digs)} ${r.detail}`)
  assert.ok(![...world.values()].includes('furnace'), 'nothing left standing')
  assert.equal(digs.filter(d => d.name === 'furnace')[0]?.with, 'stone_pickaxe')
  assert.match(r.detail, /took the furnace back/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && x.status === 'success' && /by=smelt outcome=back/.test(x.detail)))
})

await t('SMELT: a furnace already standing (not placed by this call) is never dug', async () => {
  const n = await mark()
  const { bot, have, digs, setBlock } = makeBot([item('raw_iron', 4), item('coal', 1), PICK()])
  setBlock(new Vec3(1, 64, 0), 'furnace')
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(have('iron_ingot'), 4)
  assert.equal(digs.length, 0); assert.equal(have('furnace'), 0)
  assert.ok(!(await rowsSince(n)).some(x => x.kind === '_station_retaken'))
})

// (input left in the furnace -> it stays: smeltRetake's input_left, tested above and by its mutant; driving it through the real
// smelt waits out the whole SMELT_DEADLINE_MS -- 138 s -- so it is not repeated here)
await t('SMELT: no pickaxe -> the furnace is LEFT (a bare-hand dig drops nothing), never destroyed', async () => {
  const n = await mark()
  const { bot, digs, world } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1)])
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 0); assert.ok([...world.values()].includes('furnace'))
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && /outcome=left why=no_tool/.test(x.detail)))
})

await t('SMELT: no block events to prove it is ours -> left, never dug', async () => {
  const { bot, digs } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()], { eventless: true })
  Object.assign(bot, { on: undefined })
  await smelt(bot)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 0)
})

await t('SMELT SURPLUS: with only tables for fuel the spare ones burn and the bag keeps ONE', async () => {
  const { bot, have, burned } = makeBot([item('raw_iron', 2), item('crafting_table', 3), item('furnace', 1), PICK()])
  const r = await smelt(bot, 2)
  assert.equal(r.status, 'success', r.detail)
  assert.ok((burned.crafting_table ?? 0) >= 1, `a spare table burned: ${JSON.stringify(burned)}`)
  assert.ok(have('crafting_table') >= 1, 'the bag keeps its table')
})

await t('SMELT SURPLUS: a bot with ONE table and no other fuel does not burn it (the refusal names fuel)', async () => {
  const { bot, have } = makeBot([item('raw_iron', 2), item('crafting_table', 1), item('furnace', 1), PICK()])
  const r = await smelt(bot, 2)
  assert.notEqual(r.status, 'success'); assert.equal(have('crafting_table'), 1)
  assert.match(r.detail ?? '', /fuel|burn/)
})

await t('switches: STN_RETAKE=0 / STATIONS=0 / STN_SURPLUS=0 in a fresh process', () => {
  const run = (env, code) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(SRC, 'stations.mjs')}').then(m => console.log(JSON.stringify(${code})))`], { env: { ...process.env, ...env }, encoding: 'utf8' })
    return JSON.parse(r.stdout)
  }
  assert.deepEqual(run({ STN_RETAKE: '0' }, "m.smeltRetake({ placed: '1,2,3', used: '1,2,3', input: 0, output: 0, fuel: 0 })"), { retake: false, why: 'off' })
  assert.equal(run({ STATIONS: '0' }, "m.withdrawFirst({ item: 'furnace', held: 0, inTown: true, stock: 3 })"), false)
  assert.equal(run({ STN_SURPLUS: '0' }, 'm.spareTables(5)'), 0)
})

// ---------------------------------------------------------------------------------------------- the sweep's furnace, for real
await t('SWEEP: a stray furnace proven EMPTY by its window is dug under the lease and arrives in the bag', async () => {
  const n = await mark()
  const { bot, have, digs, setBlock } = makeBot([PICK()])
  setBlock(new Vec3(2, 64, 0), 'furnace')
  const said = await sweepFurnace({ bot }, { at: [2, 64, 0], name: 'furnace' }, new AbortController().signal)
  assert.match(said, /took the furnace back/)
  assert.equal(have('furnace'), 1); assert.equal(digs.length, 1)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_swept' && /by=tidy outcome=back/.test(x.detail)))
})

await t('SWEEP: a stray furnace HOLDING anything is left (furnace_drain\'s), never dug', async () => {
  for (const holds of [{ output: item('iron_ingot', 3) }, { fuel: item('coal', 2) }, { input: item('raw_iron', 1) }]) {
    const { bot, digs, setBlock, world } = makeBot([PICK()], { furnaceHolds: holds })
    setBlock(new Vec3(2, 64, 0), 'furnace')
    const said = await sweepFurnace({ bot }, { at: [2, 64, 0], name: 'furnace' }, new AbortController().signal)
    assert.match(said, /left the furnace: holds_/, JSON.stringify(holds))
    assert.equal(digs.length, 0); assert.equal(world.get('2,64,0'), 'furnace')
  }
})

await t('SWEEP: a furnace whose window throws on a slot (unknown) is left', async () => {
  const { bot, digs, setBlock } = makeBot([PICK()])
  setBlock(new Vec3(2, 64, 0), 'furnace')
  const real = bot.openFurnace
  bot.openFurnace = async (...a) => { const w = await real(...a); return { ...w, fuelItem: () => { throw new Error('no slot') } } }
  const said = await sweepFurnace({ bot }, { at: [2, 64, 0], name: 'furnace' }, new AbortController().signal)
  assert.match(said, /unread_fuel/); assert.equal(digs.length, 0)
})

// ---------------------------------------------------------------------------------------------- wiring (structural)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const CODE = strip(readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))
await t('wiring: a complete tidy with strays is a repair (strayDue); both tidy branches sweep', () => {
  assert.match(CODE, /if \(r\?\.blueprint === TIDY_BLUEPRINT\) return tidy && \(tidyDue\(r\) \|\| strayDue\(bot\)\)/)
  assert.match(CODE, /if \(rec\.structure_complete\) \{\s*if \(stnOn\('sweep'\)\) \{\s*const sw = await sweepStrays\(/)
  assert.match(CODE, /swept = await sweepStrays\(ctx, signal/)
})
await t('wiring: a stray table is dug through retakeStation (collectManually), a furnace through sweepFurnace', () => {
  assert.match(CODE, /c\.name === 'furnace' \? await sweepFurnace\(ctx, c, signal\) : await retakeStation\(ctx, \{ at: new Vec3\(\.\.\.c\.at\), name: c\.name, stray: true/)
  assert.match(CODE, /await collectManually\(bot, block, signal, \{ beforeDig \}\)/)
  assert.match(CODE, /if \(!zv\.known\) throw new Error\('zones unknown'\)/, 'unknown zones: no sweep (fail closed)')
})
await t('wiring: in town craft and smelt look up the town\'s stations; the first station of a plan town goes to the designated cell', () => {
  assert.match(CODE, /const prefT = ctx\.preferWorkshop \? bot\.shopStations\?\.tables : stT\?\.inTown \? stT\.ts\?\.tables : null/)
  assert.match(CODE, /const townPrefer = stT\?\.inTown && stT\.ts\?\.furnaces\?\.size \? preferredNow\(stT\.ts\.furnaces/)
  assert.match(CODE, /const desig = await placeDesignated\(ctx, 'crafting_table', signal/)
  assert.match(CODE, /const put = await placeDesignated\(ctx, 'furnace', signal, stT\)/)
  assert.match(CODE, /if \(put\.status === 'success' && put\.at && !desig\) placedHere\.push\(watchPlaced\(bot, put\.at\)\)/, 'a designated table is not taken back')
})
await t('wiring: a station craft asks the town chests first; the smelt offers spare tables as fuel', () => {
  assert.match(CODE, /const wd = await stationFromTown\(ctx, args, signal\)\s*if \(wd\?\.done\) return wd\.result/)
  assert.match(CODE, /const extraFuel = stnOn\('surplus'\) \? SPARE_FUEL_TICKS : null/)
  assert.match(CODE, /if \(h\.crafting_table != null\) \{ const sp = spareTables\(h\.crafting_table\)/)
})

// ---------------------------------------------------------------------------------------------- mutants
async function withMutant (file, old, neu, fn) {
  const p = path.join(SRC, file)
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_${file}`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn(await import(`${tmp}?${Date.now()}_${Math.random()}`)) } finally { unlinkSync(tmp) }
}
const killed = []
const mut = async (file, old, neu, probe) => {
  const died = await withMutant(file, old, neu, async M => { try { probe(M); return false } catch { return true } })
  killed.push(died)
  if (!died) console.log(`  SURVIVED  ${old.slice(0, 70)}`)
}
const ON = { on: true }
await t('mutants: every decision line is load-bearing (anchors asserted present and unique)', async () => {
  await mut('stations.mjs', "  if (used == null || keyOf(used) !== keyOf(placed)) return { retake: false, why: 'not_the_job_furnace' }", '',
    M => assert.equal(M.smeltRetake({ ...ON, placed: '1,1,1', used: '2,2,2', input: 0, output: 0, fuel: 0 }).retake, false))
  await mut('stations.mjs', "  if (designated) return { retake: false, why: 'designated' }", '',
    M => assert.equal(M.smeltRetake({ ...ON, placed: '1,1,1', used: '1,1,1', designated: true, input: 0, output: 0, fuel: 0 }).retake, false))
  await mut('stations.mjs', "  if ((Number(fuel) || 0) > 0) return { retake: false, why: 'fuel_left' }", '',
    M => assert.equal(M.smeltRetake({ ...ON, placed: '1,1,1', used: '1,1,1', input: 0, output: 0, fuel: 2 }).retake, false))
  await mut('stations.mjs', "    if (seen[k] === undefined) return { ok: false, why: `unread_${k}` }", '',
    M => assert.equal(M.furnaceEmpty({ input: null, fuel: undefined, output: null }).ok, false))
  await mut('stations.mjs', "    if (seen[k] && (Number(seen[k].count) || 0) > 0) return { ok: false, why: `holds_${k}` }", '',
    M => assert.equal(M.furnaceEmpty({ input: null, fuel: { count: 1 }, output: null }).ok, false))
  await mut('stations.mjs', "    if (keep.has(k)) { skip('town_station'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0)], { home: HOME, keep: new Set(['1,64,0']) }).sweep.length, 0))
  await mut('stations.mjs', "    if (cells.has(k)) { skip('record_cell'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0)], { home: HOME, cells: new Set(['1,64,0']) }).sweep.length, 0))
  await mut('stations.mjs', "    if (zone(x, y, z)) { skip('zone'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0)], { home: HOME, zone: () => true }).sweep.length, 0))
  await mut('stations.mjs', "    if ((bells ?? []).some(b => Array.isArray(b) && Math.hypot(b[0] - x, b[1] - y, b[2] - z) <= bellR)) { skip('village'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0)], { home: HOME, bells: [[1, 64, 5]] }).sweep.length, 0))
  await mut('stations.mjs', "    if (s.name === 'furnace' && leased(k)) { skip('leased'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0, 'furnace')], { home: HOME, leased: () => true }).sweep.length, 0))
  await mut('stations.mjs', "    if (y < home.y - down) { skip('deep'); continue }", '',
    M => assert.equal(M.strayStations([S(1, 0, 'crafting_table', { y: 30 })], { home: HOME }).sweep.length, 0))
  await mut('stations.mjs', "  return !!on && isStation(item) && !!inTown && (Number(held) || 0) < 1 && (Number(stock) || 0) >= 1",
    "  return !!on && isStation(item) && (Number(held) || 0) < 1 && (Number(stock) || 0) >= 1",
    M => assert.equal(M.withdrawFirst({ item: 'furnace', held: 0, inTown: false, stock: 2, on: true }), false))
  await mut('stations.mjs', "export const spareTables = (held, on = stnOn('surplus')) => (on ? Math.max(0, (Number(held) || 0) - 1) : 0)",
    "export const spareTables = (held, on = stnOn('surplus')) => (on ? Math.max(0, (Number(held) || 0)) : 0)",
    M => assert.equal(M.spareTables(1, true), 0))
  await mut('stations.mjs', "  if (!ts || ts.source !== 'plan' || !isStation(kind)) return null", "  if (!ts || !isStation(kind)) return null",
    M => assert.equal(M.designatedCell({ ...M.townStations({ tables: new Set(['1,2,3']) }, PLAN) }, 'crafting_table', () => true), null))
  await mut('smelting.mjs', "    const ticks = fuelTicks(name) || (Object.hasOwn(extra ?? {}, name) ? Number(extra[name]) || 0 : 0)",
    "    const ticks = fuelTicks(name) || 300",
    M => assert.equal(M.chooseFuel({ crafting_table: 2 }), null))
  assert.ok(killed.length === 15 && killed.every(Boolean), `killed ${killed.filter(Boolean).length}/${killed.length}`)
  console.log(`  mutants killed ${killed.filter(Boolean).length}/${killed.length}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
