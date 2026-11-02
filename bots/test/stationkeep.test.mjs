// STATIONKEEP-01 (resource-model-1102 stage 2): smelt takes back the furnace IT placed once the job is drained, and the tidy
// sweeps the plaza's stray tables and furnaces (keeping the nearest public ones). The pure decisions (stationkeep.mjs) are
// tested by what they return; the smelt half is driven THROUGH THE REAL smelt skill over a fake world whose dig, drop and
// block events behave as craft-room.test.mjs's (the table retake's harness: collectManually's walk, dig and pickup), with a
// furnace window that converts; the wiring that behaviour cannot reach is asserted on comment-stripped source; every
// anchored mutant is killed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stationkeep-'))
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stationkeep-pool-'))
process.env.BOT_NAME = 'StationKeepBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.STATIONKEEP

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const SK = await import('../src/stationkeep.mjs')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---------------------------------------------------------------------------------------------- the pure decisions
const HOME = { x: 0, y: 64, z: 0 }
const S = (x, z, name = 'crafting_table', extra = {}) => ({ at: [x, 64, z], name, lit: false, ...extra })

await t('smeltRetake: only a placed, drained furnace, never on an abort or an unread window', () => {
  assert.deepEqual(SK.smeltRetake({ placed: true, input: 0, output: 0, fuel: 0 }), { retake: true, why: 'drained' })
  assert.equal(SK.smeltRetake({ placed: true, input: 0, output: 0, fuel: 1 }).why, 'fuel_left', 'r1 BLOCKER: fuel left keeps it')
  assert.equal(SK.smeltRetake({ placed: true, input: 0, output: 0 }).why, 'unread', 'an unread fuel slot is not empty')
  assert.equal(SK.smeltRetake({ placed: false, input: 0, output: 0, fuel: 0 }).retake, false)
  assert.equal(SK.smeltRetake({ placed: true, aborted: true, input: 0, output: 0, fuel: 0 }).why, 'aborted')
  assert.equal(SK.smeltRetake({ placed: true, input: 3, output: 0, fuel: 0 }).why, 'input_left')
  assert.equal(SK.smeltRetake({ placed: true, input: 0, output: 2, fuel: 0 }).why, 'output_left')
  assert.equal(SK.smeltRetake({ placed: true, input: undefined, output: 0 }).why, 'unread')
})

await t('strays: the KEEP_PUBLIC nearest of each kind stay; the other TABLES are swept nearest first; a furnace is NEVER swept (r1 BLOCKERS)', () => {
  const found = [S(10, 0), S(2, 0), S(5, 0), S(20, 0), S(3, 3, 'furnace'), S(9, 9, 'furnace'), S(15, 15, 'furnace')]
  const r = SK.strayStations(found, { home: HOME })
  assert.deepEqual(r.kept.map(c => c.at.join(',')), ['2,64,0', '3,64,3', '5,64,0', '9,64,9'])
  assert.deepEqual(r.sweep.map(c => c.at.join(',')), ['10,64,0', '20,64,0'])
  assert.equal(r.skipped.not_swept_furnace, 1, 'the third furnace is reported, not dug')
})

await t('strays: guarded columns, record cells, lit or holding furnaces, outside, given up and other names never swept', () => {
  const found = [S(1, 0), S(2, 0), S(1, 1, 'furnace'), S(2, 2, 'furnace'),          // the public four
    S(6, 0), S(7, 0), S(8, 0, 'furnace', { lit: true }), S(9, 0, 'furnace'), S(40, 0), S(10, 0), S(11, 0, 'chest'), S(12, 0)]
  const r = SK.strayStations(found, { home: HOME, avoid: (x, z) => (x === 6 ? 'plan_cell' : null), cells: new Set(['7,64,0']),
    holds: k => k === '9,64,0', given: k => k === '12,64,0' })
  assert.deepEqual(r.sweep.map(c => c.at.join(',')), ['10,64,0'])
  assert.deepEqual(r.skipped, { guarded: 1, record_cell: 1, lit: 1, holds: 1, outside: 1, given_up: 1 })
})

await t('strays: a guarded or held station does not take a public slot (the kept ones are the nearest STRAYS)', () => {
  const r = SK.strayStations([S(1, 0), S(2, 0), S(3, 0), S(4, 0)], { home: HOME, avoid: (x) => (x <= 2 ? 'workshop' : null) })
  assert.deepEqual(r.kept.map(c => c.at[0]), [3, 4]); assert.equal(r.sweep.length, 0)
})

await t('noteSweep / sweepGivenUp: a stray tried SWEEP_TRIES visits and still standing is given up; a dug one is not counted', () => {
  const m = new Map()
  SK.noteSweep(m, ['1,64,0', '2,64,0'], k => k === '1,64,0')
  SK.noteSweep(m, ['1,64,0'], () => true)
  assert.equal(SK.sweepGivenUp(m, '1,64,0'), true); assert.equal(SK.sweepGivenUp(m, '2,64,0'), false)
})

// ---------------------------------------------------------------------------------------------- the smelt, for real
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
const LOG = path.join(process.env.LOG_DIR, 'skill-StationKeepBot.jsonl')
const rowsSince = async (n = 0) => {
  await new Promise(r => setTimeout(r, 60))
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(n).map(l => JSON.parse(l)).map(r => ({ kind: r.skill.name, status: r.skill.status, detail: r.skill.detail }))
}
const mark = async () => (await rowsSince(0)).length
const smelt = (bot, signal = new AbortController().signal) => SKILLS.smelt.run({ bot }, { item: 'raw_iron', count: 4 }, signal)
const PICK = () => item('stone_pickaxe', 1, { left: 100 })

await t('SMELT: the furnace it placed is dug back once drained, with the pickaxe, and ARRIVES in the bag', async () => {
  const n = await mark()
  const { bot, have, world, digs } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()])
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('iron_ingot'), 4)
  assert.equal(have('furnace'), 1, `the furnace is back: ${JSON.stringify(digs)} ${r.detail}`)
  assert.ok(![...world.values()].includes('furnace'), 'nothing left standing')
  assert.equal(digs.filter(d => d.name === 'furnace')[0]?.with, 'stone_pickaxe', 'dug with the pickaxe (bare hand drops nothing)')
  assert.match(r.detail, /took the furnace back/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && x.status === 'success' && /by=smelt outcome=back/.test(x.detail)))
})

await t('SMELT: a furnace that was already standing (not placed by this call) is never dug', async () => {
  const n = await mark()
  const { bot, have, digs, setBlock } = makeBot([item('raw_iron', 4), item('coal', 1), PICK()])
  setBlock(new Vec3(1, 64, 0), 'furnace')
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(have('iron_ingot'), 4)
  assert.equal(digs.length, 0); assert.equal(have('furnace'), 0)
  assert.ok(!(await rowsSince(n)).some(x => x.kind === '_station_retaken'))
})

await t('SMELT: input left in the furnace (the job not drained) -> the furnace stays, and the row says why', async () => {
  const n = await mark()
  const { bot, digs } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()], { keepInput: true })
  await smelt(bot)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 0)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && /outcome=left why=input_left/.test(x.detail)))
})

await t('SMELT: no pickaxe in the bag -> the furnace is LEFT (a bare-hand dig drops nothing), never destroyed (r1 BLOCKER)', async () => {
  const n = await mark()
  const { bot, digs, world } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1)])
  const r = await smelt(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 0); assert.ok([...world.values()].includes('furnace'))
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && /outcome=left why=no_tool/.test(x.detail)))
})

await t('SMELT: no block events to prove it is ours -> left, never dug', async () => {
  const n = await mark()
  const { bot, digs } = makeBot([item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()], { eventless: true })
  Object.assign(bot, { on: undefined })
  await smelt(bot)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 0)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_station_retaken' && /outcome=left/.test(x.detail)))
})

await t('SMELT: STATIONKEEP=off -> the old behaviour (the furnace stays, no row)', async () => {
  const src = readFileSync(path.join(SRC, 'stationkeep.mjs'), 'utf8')
  assert.ok(/STATIONKEEP \?\? ''\)\.trim\(\)\.toLowerCase\(\) !== 'off'/.test(src))
  const env = { ...process.env, STATIONKEEP: 'off' }
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(SRC, 'stationkeep.mjs')}').then(m => console.log(JSON.stringify(m.smeltRetake({ placed: true, input: 0, output: 0 }))))`], { env, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r.stdout), { retake: false, why: 'off' })
})

// ---------------------------------------------------------------------------------------------- wiring (structural)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const CODE = strip(readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))
await t('wiring: a complete tidy with strays is a repair (strayDue) and its visit sweeps', () => {
  assert.match(CODE, /if \(r\?\.blueprint === TIDY_BLUEPRINT\) return tidy && \(tidyDue\(r\) \|\| strayDue\(bot\)\)/)
  assert.match(CODE, /if \(rec\.structure_complete\) \{\s*if \(STATIONKEEP\.on\) \{\s*const sw = await sweepStrays\(/)
  assert.match(CODE, /swept = await sweepStrays\(ctx, signal/)
})
await t('wiring: the sweep digs through retakeStation (collectManually: walk, best tool, pickup), marked stray', () => {
  assert.match(CODE, /retakeStation\(ctx, \{ at: new Vec3\(\.\.\.c\.at\), name: c\.name, stray: true/)
  assert.match(CODE, /await collectManually\(bot, block, signal, \{ beforeDig \}\)/)
})
await t('wiring: the stray survey fails closed on furnaces when the ledger cannot be read', () => {
  assert.match(CODE, /const holds = k => \(view \? !!view\.furnaces\?\.\[k\] && view\.furnaces\[k\]\.state !== 'empty' : true\)/)
})

// ---------------------------------------------------------------------------------------------- mutants
async function withMutant (file, old, neu, fn) {
  const p = path.join(SRC, file)
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${file}`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn(await import(`${tmp}?${Date.now()}`)) } finally { (await import('node:fs')).unlinkSync(tmp) }
}
const killed = []
const mut = async (old, neu, probe) => {
  const died = await withMutant('stationkeep.mjs', old, neu, async M => { try { probe(M); return false } catch { return true } })
  killed.push(died)
  if (!died) console.log(`  SURVIVED  ${old.slice(0, 70)}`)
}
const probeKeep = M => { const r = M.strayStations([S(1, 0), S(2, 0), S(3, 0)], { home: HOME }); assert.deepEqual(r.sweep.map(c => c.at[0]), [3]) }
const probeGuard = M => { assert.equal(M.strayStations([S(1, 0), S(2, 0), S(3, 0)], { home: HOME, avoid: x => (x === 3 ? 'z' : null) }).sweep.length, 0) }
const probeHolds = M => { assert.equal(M.strayStations([S(1, 0, 'furnace'), S(2, 0, 'furnace'), S(3, 0, 'furnace')], { home: HOME, holds: () => true }).skipped.holds, 3) }
const probeFuel = M => { assert.equal(M.smeltRetake({ placed: true, input: 0, output: 0, fuel: 2 }).retake, false) }
const probeNoFurnaceSweep = M => { assert.equal(M.strayStations([S(1, 0, 'furnace'), S(2, 0, 'furnace'), S(3, 0, 'furnace')], { home: HOME }).sweep.length, 0) }
const probeInput = M => { assert.equal(M.smeltRetake({ placed: true, input: 2, output: 0, fuel: 0 }).retake, false) }
const probeAbort = M => { assert.equal(M.smeltRetake({ placed: true, aborted: true, input: 0, output: 0, fuel: 0 }).retake, false) }
const probeGiven = M => { assert.equal(M.strayStations([S(1, 0), S(2, 0), S(3, 0)], { home: HOME, given: () => true }).sweep.length, 0) }
await t('mutants: every decision line is load-bearing (anchors asserted present and unique)', async () => {
  await mut("    if (n[c.name] <= (keep[c.name] ?? 0)) { kept.push(c); continue }", "    if (false) { kept.push(c); continue }", probeKeep)
  await mut("    if (a) { skip(`guarded`); continue }", "    if (false) { skip(`guarded`); continue }", probeGuard)
  await mut("    if (s.name === 'furnace' && holds(k)) { skip('holds'); continue }", "", probeHolds)
  await mut("  if ((Number(input) || 0) > 0) return { retake: false, why: 'input_left' }", "", probeInput)
  await mut("  if (aborted) return { retake: false, why: 'aborted' }", "", probeAbort)
  await mut("    if (given(c.k)) { skip('given_up'); continue }", "", probeGiven)
  await mut("  if ((Number(fuel) || 0) > 0) return { retake: false, why: 'fuel_left' }", "", probeFuel)
  await mut("    if (!SWEEP_NAMES.includes(c.name)) { skip(`not_swept_${c.name}`); continue }", "", probeNoFurnaceSweep)
  assert.ok(killed.length === 8 && killed.every(Boolean), `killed ${killed.filter(Boolean).length}/${killed.length}`)
  console.log(`  mutants killed ${killed.filter(Boolean).length}/${killed.length}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
