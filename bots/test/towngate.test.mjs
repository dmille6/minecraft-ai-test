// TOWNGATE-01 (resource-model-1102 stage 4, TIER 3: its inputs are wired in the protected cognitive.mjs and admission.mjs).
//   (a) THE METERED OVERFLOW: on every town visit, whole cobble stacks above the bag's keep go down the well only when the town
//       is proven at HIGH, the yard has no room (none on the fleet) and no open project bill a lease could serve now.
//   (b) THE STATION GATE: a crafting_table craft with a stray table in reach is redirected, in the same decision, to
//       take_station -- the same item; the redirect refused admits the craft; a failed take gives the table up.
// Behaviour of the pure gates; the refusal CHAIN through the real AdmissionControl; take_station through the real skill over a
// fake world (stationkeep.test.mjs's harness); the protected wiring asserted on comment-stripped source; anchored mutants.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-towngate-'))
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-towngate-pool-'))
process.env.BOT_NAME = 'TownGateBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.STATIONKEEP; delete process.env.OVERFLOW

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')
const W = await import('../src/well.mjs')
const SK = await import('../src/stationkeep.mjs')
const ST = await import('../src/stocktarget.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { Lessons } = await import('../src/lessons.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ------------------------------------------------------------------------------------------------ (a) the overflow gate
await t('overflow: open only when proven at HIGH, no yard room and no open bill; unknown is shut', () => {
  assert.deepEqual(W.overflowGate({ cap: 'at_cap', yardRoom: 0, bill: 0 }), { ok: true, why: 'proven_high' })
  assert.equal(W.overflowGate({ cap: 'below_cap', bill: 0 }).ok, false)
  assert.equal(W.overflowGate({ cap: 'unknown', bill: 0 }).why, 'town_unknown')
  assert.equal(W.overflowGate({ cap: 'at_cap', bill: 12 }).why, 'project_bill')
  assert.equal(W.overflowGate({ cap: 'at_cap', bill: null }).why, 'bill_unknown')
  assert.equal(W.overflowGate({ cap: 'at_cap', bill: 0, yardRoom: 304 }).why, 'yard_room', 'a yard with room is never bypassed')
  assert.equal(W.overflowGate({ cap: 'at_cap', bill: 0, yardRoom: 304, yardFull: true }).ok, true)
  assert.equal(W.overflowGate({ cap: 'at_cap', bill: 0, on: false }).why, 'off')
})
await t('overflow: PROVEN at HIGH is the counted floor -- 981 counted + a 64 stack is NOT at HIGH (r1 BLOCKER)', async () => {
  const { wellCobbleSwitch } = await import('../src/cobblecap.mjs')
  const view = { avail: 981, lbLo: 981, taking: 0, complete: true }
  assert.equal(wellCobbleSwitch(view, 64, { cap: 1000 }), 'at_cap', 'positive control: the bank\'s admission fallback says at_cap here')
  assert.equal(wellCobbleSwitch(view, 64, { cap: 1000, floorOnly: true }), 'below', 'the overflow\'s proof (floorOnly) does not')
  assert.equal(wellCobbleSwitch({ avail: 1000, complete: true }, 64, { cap: 1000, floorOnly: true }), 'at_cap')
})
await t('overflow: the fleet HIGH is the cap (no yard) -- the gate asks the table, not a literal', () => {
  assert.equal(ST.MARKS.cobble.high, ST.TOWN_COBBLE_CAP + ST.YARD_ROOM.cobble)
})
await t('overflow plan: whole cobble stacks above 64 (the bag keep), never a protected or listed-kept name, never the keep', () => {
  const items = [{ name: 'cobblestone', count: 64, slot: 10 }, { name: 'cobblestone', count: 64, slot: 11 }, { name: 'cobblestone', count: 40, slot: 12 },
    { name: 'iron_ingot', count: 5, slot: 13 }, { name: 'cobbled_deepslate', count: 64, slot: 14 }]
  const p = W.disposePlan(items, { keep: [], cobbleAtCap: true })
  const thrown = p.stacks.filter(s => /cobble/.test(s.name)).reduce((a, s) => a + s.count, 0)
  const total = 64 + 64 + 40 + 64
  assert.ok(total - thrown >= 64, `the bag keeps ${total - thrown}`)
  assert.ok(!p.stacks.some(s => s.name === 'iron_ingot'))
  assert.equal(W.disposePlan(items, { keep: [] }).stacks.filter(s => /cobble/.test(s.name)).length, 0, 'positive control: without the gate the visit throws no cobble')
  assert.equal(W.disposePlan(items, { keep: ['cobblestone', 'cobbled_deepslate'], cobbleAtCap: true }).stacks.filter(s => /cobble/.test(s.name)).length, 0, 'a goal that wants cobble keeps it')
})
await t('overflow row: item, n, town, target, high, pressure', () => {
  assert.equal(W.overflowRowDetail({ name: 'cobblestone', n: 128, town: 1003, target: 1000, high: 1000, why: 'proven_high' }), 'item=cobblestone n=128 town=1003 target=1000 high=1000 pressure=max why=proven_high')
  assert.match(W.overflowRowDetail({ name: 'cobblestone', n: 64, town: 1152, target: 1000, high: 1304 }), /pressure=0\.50/)
})

// ------------------------------------------------------------------------------------------------ (b) the station gate
const NEAR = { at: [3, 64, 0], name: 'crafting_table', d: 3 }
await t('gate: a crafting_table craft, none in the bag, a stray table in reach -> refused with the take_station redirect', () => {
  const g = SK.stationGate({ item: 'crafting_table', items: [{ name: 'oak_planks', count: 8 }], near: NEAR })
  assert.equal(g.reason, 'station_in_reach'); assert.deepEqual(g.redirect, { skill: 'take_station', args: { x: 3, y: 64, z: 0, name: 'crafting_table' } })
  assert.match(g.detail, /3,64,0/)
  assert.equal(SK.stationGate({ item: 'crafting_table', items: [{ name: 'crafting_table', count: 1 }], near: NEAR }), null, 'one in the bag: toolhygiene\'s rule')
  assert.equal(SK.stationGate({ item: 'crafting_table', items: [], near: null }), null, 'no stray in reach: admitted')
  assert.equal(SK.stationGate({ item: 'furnace', items: [], near: NEAR }), null, 'a furnace is never taken')
  assert.equal(SK.stationGate({ item: 'crafting_table', items: [], near: NEAR, on: false }), null)
})
await t('nearestTakeable: strays first by distance, then the public ones; tables only; within TAKE_R', () => {
  const s = { sweep: [{ at: [30, 64, 0], name: 'crafting_table' }], kept: [{ at: [2, 64, 0], name: 'crafting_table' }, { at: [1, 64, 0], name: 'furnace' }] }
  assert.deepEqual(SK.nearestTakeable(s, { x: 0.5, y: 64, z: 0.5 }).at, [2, 64, 0])
  assert.equal(SK.nearestTakeable({ sweep: [{ at: [40, 64, 0], name: 'crafting_table' }], kept: [] }, { x: 0, y: 64, z: 0 }), null)
  assert.deepEqual(SK.nearestTakeable(s, { x: 0.5, y: 64, z: 0.5 }, SK.TAKE_R, k => k === '2,64,0'), null, 'a given-up PUBLIC table is not offered (30 is beyond reach)')
})

// the refusal CHAIN through the real AdmissionControl (toolhygiene.test.mjs's harness)
function gateBot (inv, stray = NEAR) {
  const items = inv.map((x, slot) => ({ ...x, slot, type: mc.itemsByName[x.name]?.id }))
  const held = id => items.filter(i => i.type === Number(id)).reduce((s, i) => s + i.count, 0)
  return {
    entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20, players: {}, inventory: { items: () => items }, registry: mc,
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => { if (r.requiresTable && !table) return false; const need = {}; for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count; return Object.entries(need).every(([rid, n]) => held(rid) >= n) }),
    recipesAll: () => [], findBlock: () => null, findBlocks: () => [], blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    strayTableCache: { at: Date.now(), v: stray, pos: { x: 0, z: 0 } },
  }
}
let seq = 0
const gate = () => { const L = new Lessons(`/tmp/mcai-towngate-${process.pid}-${seq++}.json`); L.data.avoid = {}; L.data.worked = {}; return new AdmissionControl(L) }
const RUNG = new Set(['crafting_table', 'oak_planks', 'oak_log'])
await t('THE CHAIN: the rung wants a table, a stray stands in reach -> craft refused, the redirect (take_station) is ADMITTED', () => {
  const g = gate(), bot = gateBot([{ name: 'oak_planks', count: 8 }])
  const r = g.check({ skill: 'craft', args: { item: 'crafting_table' }, reason: 'x' }, bot, RUNG)
  assert.equal(r.ok, false); assert.equal(r.reason, 'station_in_reach')
  const r2 = g.check(r.redirect, bot, RUNG)
  assert.equal(r2.ok, true, r2.detail); assert.equal(r2.skill, 'take_station')
})
await t('THE CHAIN: the redirect refused -> the original craft is admitted with the gate off (never a dead end)', () => {
  const g = gate(), bot = gateBot([{ name: 'oak_planks', count: 8 }])
  g.stationGateOff = true
  assert.equal(g.check({ skill: 'craft', args: { item: 'crafting_table' }, reason: 'x' }, bot, RUNG).ok, true)
})
await t('THE CHAIN: no stray in reach (or given up) -> the craft is admitted as today', () => {
  const g = gate()
  assert.equal(g.check({ skill: 'craft', args: { item: 'crafting_table' }, reason: 'x' }, gateBot([{ name: 'oak_planks', count: 8 }], null), RUNG).ok, true)
})

// take_station through the real skill
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`   // prismarine-world floors
const item = (name, count = 1, { left = null } = {}) => {
  const d = mc.itemsByName[name]
  const it = { name, type: d.id, count, stackSize: d.stackSize, nbt: null }
  if (d.maxDurability) { it.maxDurability = d.maxDurability; it.durabilityUsed = left == null ? 0 : d.maxDurability - left }
  return it
}
/** craft-room.test.mjs's fake (world map, prismarine-world block events, collectManually's dig and the server's pickup rule)
 *  plus findBlocks and a furnace window that converts raw_iron instantly with coal. `furnaceDrop`: a dug furnace drops its
 *  item only to a pickaxe (vanilla's harvest rule). */
function makeBot (stacks, { onDig = null, eventless = false, keepInput = false } = {}) {
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
  const F = { input: null, fuel: null, output: null }
  const fitem = (name, count) => (count > 0 ? item(name, count) : null)
  const furnace = {
    inputItem: () => F.input, fuelItem: () => F.fuel, outputItem: () => F.output, fuel: 0,
    items: () => slots.filter(Boolean), emptySlotCount: () => slots.filter(s => !s).length, selectedItem: null,
    async putInput (_id, _m, n) { take('raw_iron', n); F.input = fitem('raw_iron', n) },
    async putFuel (_id, _m, n) {
      take('coal', n); F.fuel = fitem('coal', n)
      // instant: every input cooks (one coal does 8); keepInput leaves one raw_iron in the slot (an unfinished job)
      const k = Math.min(F.input?.count ?? 0, 8 * n) - (keepInput ? 1 : 0)
      F.output = fitem('iron_ingot', k); F.input = fitem('raw_iron', (F.input?.count ?? 0) - k); F.fuel = null
    },
    async takeOutput () { assert.ok(F.output); putAway(F.output); const o = F.output; F.output = null; return o },
    async takeInput () { assert.ok(F.input); if (!keepInput) { putAway(F.input); F.input = null } else throw new Error('bag full') },
    async takeFuel () { assert.ok(F.fuel); putAway(F.fuel); F.fuel = null },
    close () {},
  }
  const bot = Object.assign(new EventEmitter(), {
    registry: mc, username: 'StationKeepBot',
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
    async dig (block, forceLook) {
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
  return { bot, slots, world, digs, have, F, setBlock }
}

const LOG = path.join(process.env.LOG_DIR, 'skill-TownGateBot.jsonl')
const rowsSince = async (n = 0) => { await new Promise(r => setTimeout(r, 60)); if (!existsSync(LOG)) return []; return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(n).map(l => JSON.parse(l)).map(r => ({ kind: r.skill.name, status: r.skill.status, detail: r.skill.detail })) }
const take = (bot, args) => SKILLS.take_station.run({ bot }, args, new AbortController().signal)
await t('take_station: a stray table is dug into the bag (the same item the craft would have made)', async () => {
  const { bot, have, setBlock, world } = makeBot([item('oak_planks', 8)])
  setBlock(new Vec3(2, 64, 0), 'crafting_table')
  bot.strayNowOverride = () => ({ sweep: [{ at: [2, 64, 0], name: 'crafting_table' }], kept: [], skipped: {} })
  const r = await take(bot, { x: 2, y: 64, z: 0, name: 'crafting_table' })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('crafting_table'), 1); assert.ok(![...world.values()].includes('crafting_table'))
  assert.ok(SKILL_CONTRACTS.take_station && SKILLS.take_station.chatOnly)
})
await t('take_station: a table that is NOT a stray now (plan/workshop/project) is never dug, and is given up -> the next craft is admitted', async () => {
  const { bot, digs, setBlock } = makeBot([item('oak_planks', 8)])
  setBlock(new Vec3(2, 64, 0), 'crafting_table')
  bot.strayNowOverride = () => ({ sweep: [], kept: [], skipped: { guarded: 1 } })
  const r = await take(bot, { x: 2, y: 64, z: 0, name: 'crafting_table' })
  assert.equal(r.status, 'no_effect'); assert.equal(digs.length, 0)
  assert.equal(SK.sweepGivenUp(bot.sweepGiven, '2,64,0'), true)
})
await t('take_station: refuses anything but one crafting_table at x,y,z', async () => {
  const { bot } = makeBot([])
  assert.equal((await take(bot, { x: 1, y: 2, z: 3, name: 'furnace' })).failClass, 'bad_args')
})

// ------------------------------------------------------------------------------------------------ wiring (protected files)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const COG = strip(readFileSync(path.join(SRC, 'cognitive.mjs'), 'utf8'))
const ADM = strip(readFileSync(path.join(SRC, 'admission.mjs'), 'utf8'))
const SKS = strip(readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))
await t('wiring (a): the visit order plans cobble only through the overflow gate and flags the order; the skill re-judges', () => {
  assert.match(COG, /visitJunkStacks: \(\) => disposePlan\(items, \{ keep: wantedNow\(\), cobbleAtCap: overflowOk\(\) \}\)\.junkStacks/)
  assert.match(COG, /if \(rw\.order && ov\?\.ok\) rw\.order = \{ \.\.\.rw\.order, args: \{ \.\.\.rw\.order\.args, overflow: true, keep: \[\.\.\.new Set\(\[\.\.\.\(rw\.order\.args\?\.keep \?\? \[\]\), \.\.\.wantedNow\(\)\]\)\] \}/, 'r1 BLOCKER: every wanted name rides with the overflow')
  assert.match(SKS, /if \(!pit && listedOnly && overflow\) \{ out\.overflow = overflowNow\(bot\); if \(out\.overflow\.ok\) out\.cap = 'at_cap' \}/)
  assert.match(SKS, /kind: 'overflow', status: 'success'/)
  assert.match(SKS, /wellCobbleSwitch\(cobbleTownViewFor\(bot\), stacks\[0\]\.count, \{ cap: MARKS\.cobble\.high, held: \(h\.cobblestone \?\? 0\) \+ \(h\.cobbled_deepslate \?\? 0\), floorOnly: true \}\)/, 'r1 BLOCKER: the counted floor at HIGH, never the admission fallback; a withdraw hold keeps it shut')
  assert.match(SKS, /if \(!roles\.has\(cell\.role\) && cell\.role !== 'fill'\) continue/, 'r1 BLOCKER: foundation fill cells are cobble bill')
})
await t('wiring (b): admission refuses through stationGate; cognitive runs the redirect and falls back to the craft', () => {
  assert.match(ADM, /if \(!this\.stationGateOff && args\.item === 'crafting_table'\) \{\s*const gate = stationGate\(/)
  assert.match(COG, /if \(rejection\?\.reason === 'station_in_reach' && rejection\.redirect\) \{\s*let c2 = this\.admission\.check\(rejection\.redirect, this\.bot, wantedNow\)/)
  assert.match(COG, /this\.admission\.stationGateOff = true\s*try \{ c2 = this\.admission\.check\(res\.proposal, this\.bot, wantedNow\) \} finally \{ this\.admission\.stationGateOff = false \}/)
})

// ------------------------------------------------------------------------------------------------ mutants
async function withMutant (file, old, neu, probe) {
  const p = path.join(SRC, file)
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${file}`)
  writeFileSync(tmp, src.replace(old, neu))
  try { const M = await import(`${tmp}?${Date.now()}`); try { probe(M); return false } catch { return true } } finally { unlinkSync(tmp) }
}
await t('mutants killed (anchors present and unique)', async () => {
  const R = [
    await withMutant('well.mjs', "  if (cap !== 'at_cap') return { ok: false, why: `town_${cap}` }", '', M => assert.equal(M.overflowGate({ cap: 'below_cap', bill: 0 }).ok, false)),
    await withMutant('well.mjs', "  if (Number(bill) > 0) return { ok: false, why: 'project_bill' }", '', M => assert.equal(M.overflowGate({ cap: 'at_cap', bill: 5 }).ok, false)),
    await withMutant('well.mjs', "  if (bill == null || !Number.isFinite(Number(bill))) return { ok: false, why: 'bill_unknown' }", '', M => assert.equal(M.overflowGate({ cap: 'at_cap', bill: null }).ok, false)),
    await withMutant('well.mjs', "  if ((Number(yardRoom) || 0) > 0 && yardFull !== true) return { ok: false, why: 'yard_room' }", '', M => assert.equal(M.overflowGate({ cap: 'at_cap', bill: 0, yardRoom: 9 }).ok, false)),
    await withMutant('stationkeep.mjs', "  if ((Array.isArray(items) ? items : []).some(it => it?.name === 'crafting_table' && (it.count ?? 1) > 0)) return null", '', M => assert.equal(M.stationGate({ item: 'crafting_table', items: [{ name: 'crafting_table', count: 1 }], near: NEAR }), null)),
    await withMutant('stationkeep.mjs', "  if (!on || item !== 'crafting_table' || !near) return null", "  if (!on || !near) return null", M => assert.equal(M.stationGate({ item: 'furnace', items: [], near: NEAR }), null)),
  ]
  assert.ok(R.every(Boolean), `killed ${R.filter(Boolean).length}/${R.length}`)
  console.log(`  mutants killed ${R.filter(Boolean).length}/${R.length}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
