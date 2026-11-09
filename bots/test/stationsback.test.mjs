// STATIONSBACK-01: a dug station must reach the bag. The smelt's furnace retake is driven THROUGH THE REAL smelt skill over the
// stations-01 fake world (stations.test.mjs's makeBot), with the two live failure shapes measured 11-09:
//   LATE DROP   the furnace's drop appears after the bag reads stop and comes to rest outside the pickup box
//   CANCELLED   the first dig throws mineflayer's stopDigging "Digging aborted" (a concurrent reflex), the furnace still stands
// The helpers (stationsback.mjs) are tested by what they return; the craft table wiring is asserted on comment-stripped source.
// Every mutant asserts its anchor present and unique, and is killed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stnback-'))
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-stnback-pool-'))
process.env.BOT_NAME = 'StnBackBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
for (const k of ['STATIONS', 'STN_RETAKE', 'STN_SWEEP', 'STN_REUSE', 'STN_WITHDRAW', 'STN_SURPLUS', 'STATIONSBACK']) delete process.env[k]

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const SB = await import('../src/stationsback.mjs')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------- the helpers
await t('digAbortedRetry: only mineflayer\'s "Digging aborted", once, never on our own abort, never off', () => {
  const err = new Error('Digging aborted')
  assert.equal(SB.digAbortedRetry({ err, on: true }), true)
  assert.equal(SB.digAbortedRetry({ err, on: true, tried: 1 }), false, 'once')
  assert.equal(SB.digAbortedRetry({ err, on: true, aborted: true }), false, 'the skill was aborted')
  assert.equal(SB.digAbortedRetry({ err: Object.assign(new Error('Digging aborted'), { aborted: true }), on: true }), false)
  assert.equal(SB.digAbortedRetry({ err: new Error('dig_unconfirmed: still furnace'), on: true }), false, 'a server refusal is not retried')
  assert.equal(SB.digAbortedRetry({ err, on: false }), false)
})

const ent = (id, name, x, y, z) => ({ id, name: 'item', position: new Vec3(x, y, z), getDroppedItem: () => ({ name }) })
await t('stationDrop: the station\'s own drop nearest its cell, within dropR; other items and far drops never', () => {
  const at = new Vec3(10, 64, 10)
  const bot = { entities: { 1: ent(1, 'cobblestone', 10.5, 64, 10.5), 2: ent(2, 'furnace', 13.5, 64, 10.5), 3: ent(3, 'furnace', 11.2, 64, 10.5), 4: ent(4, 'furnace', 30, 64, 10) } }
  assert.equal(SB.stationDrop(bot, at, 'furnace')?.id, 3)
  assert.equal(SB.stationDrop(bot, at, 'crafting_table'), null)
  assert.equal(SB.stationDrop({ entities: { 4: bot.entities[4] } }, at, 'furnace'), null, 'beyond dropR')
  assert.equal(SB.stationDrop({ entities: { 9: { name: 'item', position: new Vec3(10, 64, 10), getDroppedItem () { throw new Error('no meta') } } } }, at, 'furnace'), null)
})

await t('waitStationDrop: a drop that appears LATE is found; none in lookMs -> null; the bag rising stops the look', async () => {
  const at = new Vec3(0, 64, 0)
  const bot = { entities: {} }
  setTimeout(() => { bot.entities[7] = ent(7, 'furnace', 0.5, 64, 0.5) }, 250)
  const t0 = Date.now()
  const e = await SB.waitStationDrop(bot, { at, name: 'furnace', before: 0, count: () => 0, sleep })
  assert.equal(e?.id, 7); assert.ok(Date.now() - t0 >= 200)
  const none = await SB.waitStationDrop({ entities: {} }, { at, name: 'furnace', before: 0, count: () => 0, sleep, lookMs: 300 })
  assert.equal(none, null)
  let n = 0
  setTimeout(() => { n = 1 }, 100)
  const t1 = Date.now()
  assert.equal(await SB.waitStationDrop({ entities: {} }, { at, name: 'furnace', before: 0, count: () => n, sleep }), null)
  assert.ok(Date.now() - t1 < 1000, 'stopped when the bag rose')
})

await t('digWithRetry: a cancelled dig is dug again once the bot is still, on a fresh re-check; anything else rethrows', async () => {
  let digs = 0
  const r = await SB.digWithRetry({ bot: {}, sleep, on: true, dig: async again => { digs++; if (!again) throw new Error('Digging aborted') }, recheck: () => ({ name: 'furnace' }) })
  assert.deepEqual(r, { retried: true }); assert.equal(digs, 2)
  await assert.rejects(SB.digWithRetry({ bot: {}, sleep, on: true, dig: async () => { throw new Error('Digging aborted') }, recheck: () => null }), /Digging aborted/, 'the re-check failed: not dug again')
  await assert.rejects(SB.digWithRetry({ bot: {}, sleep, on: true, dig: async () => { throw new Error('arrived_out_of_reach') }, recheck: () => ({}) }), /out_of_reach/)
  await assert.rejects(SB.digWithRetry({ bot: {}, sleep, on: false, dig: async () => { throw new Error('Digging aborted') }, recheck: () => ({}) }), /Digging aborted/, 'off')
  let calls = 0
  await assert.rejects(SB.digWithRetry({ bot: {}, sleep, on: true, dig: async () => { calls++; throw new Error('Digging aborted') }, recheck: () => ({}) }), /Digging aborted/)
  assert.equal(calls, 2, 'one retry, not a loop')
  const moving = { pathfinder: { isMoving: () => true } }
  let d2 = 0
  await assert.rejects(SB.digWithRetry({ bot: moving, sleep, on: true, settleMs: 200, dig: async () => { d2++; throw new Error('Digging aborted') }, recheck: () => ({}) }), /Digging aborted/)
  assert.equal(d2, 1, 'a bot that never stands still is not dug at again')
})

await t('switch: STATIONSBACK=off in a fresh process', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(SRC, 'stationsback.mjs')}').then(m => console.log(JSON.stringify([m.sbOn(), m.digAbortedRetry({ err: new Error('Digging aborted') })])))`], { env: { ...process.env, STATIONSBACK: 'off' }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r.stdout), [false, false])
})

// ---------------------------------------------------------------------------------------------- the smelt, for real
const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
const item = (name, count = 1, { left = null } = {}) => {
  const d = mc.itemsByName[name]
  const it = { name, type: d.id, count, stackSize: d.stackSize, nbt: null }
  if (d.maxDurability) { it.maxDurability = d.maxDurability; it.durabilityUsed = left == null ? 0 : d.maxDurability - left }
  return it
}
// stations.test.mjs's makeBot, plus: `lateDrop` (the furnace's drop appears lateDrop ms after the dig, 1.5 blocks from the bot,
// outside its pickup box; a goto to it collects it) and `onDig` (may throw before the block breaks: the cancelled dig)
function makeBot (stacks, { onDig = null, lateDrop = null } = {}) {
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
  const setBlock = (p, name) => { const old = blockAt(p); world.set(key(p), name); bot.emit(`blockUpdate:${new Vec3(p.x, p.y, p.z)}`, old, blockAt(p)) }
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
    async putFuel (id, _m, n) {
      const nm = mc.items[id]?.name ?? 'coal'
      take(nm, n); F.fuel = null
      const k = Math.min(F.input?.count ?? 0, 8 * n)
      F.output = fitem('iron_ingot', k); F.input = fitem('raw_iron', (F.input?.count ?? 0) - k)
    },
    async takeOutput () { putAway(F.output); const o = F.output; F.output = null; return o },
    async takeInput () { putAway(F.input); F.input = null },
    async takeFuel () { putAway(F.fuel); F.fuel = null },
    close () {},
  }
  let eid = 100
  const bot = Object.assign(new EventEmitter(), {
    registry: mc, username: 'StnBackBot',
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
      onDig?.(block, { setBlock })
      digs.push({ name: block.name, at: key(block.position), with: bot.heldItem?.name ?? 'hand' })
      setBlock(block.position, 'air')
      const pick = /_pickaxe$/.test(bot.heldItem?.name ?? '')
      const drop = block.name === 'furnace' ? (pick ? 'furnace' : null) : block.name === 'stone' ? (pick ? 'cobblestone' : null) : block.name
      if (!drop) return
      if (block.name === 'furnace' && lateDrop != null) {
        const id = eid++
        const p = bot.entity.position
        setTimeout(() => { bot.entities[id] = { id, name: 'item', position: new Vec3(p.x + (block.position.x + 0.5 >= p.x ? 1.6 : -1.6), block.position.y, p.z), getDroppedItem: () => ({ name: 'furnace' }) } }, lateDrop)
        return
      }
      putAway(item(drop, 1))
    },
    async openFurnace () { return furnace },
    nearestEntity () { return null },
    pathfinder: {
      // a walk to an item drop ends with the bot on it, and the server hands it over
      async goto () {
        for (const [id, e] of Object.entries(bot.entities)) {
          if (e?.name !== 'item') continue
          bot.entity.position = e.position.clone()
          putAway(item(e.getDroppedItem().name, 1)); delete bot.entities[id]
        }
      },
      setGoal () {}, stop () {},
    },
  })
  return { bot, slots, world, digs, have, setBlock }
}
const LOG = path.join(process.env.LOG_DIR, 'skill-StnBackBot.jsonl')
const rowsSince = async (n = 0) => {
  await sleep(60)
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(n).map(l => JSON.parse(l)).map(r => ({ kind: r.skill.name, status: r.skill.status, detail: r.skill.detail }))
}
const mark = async () => (await rowsSince(0)).length
const smeltWith = (S, bot) => S.smelt.run({ bot }, { item: 'raw_iron', count: 4 }, new AbortController().signal)
const PICK = () => item('stone_pickaxe', 1, { left: 100 })
const kit = () => [item('raw_iron', 4), item('coal', 1), item('furnace', 1), PICK()]

async function lateDropRun (S) {
  const n = await mark()
  const w = makeBot(kit(), { lateDrop: 1800 })   // after retakeStation's 1.5 s of bag reads: the base has stopped looking
  const r = await smeltWith(S, w.bot)
  return { ...w, r, rows: await rowsSince(n) }
}
await t('SMELT LATE DROP: the furnace\'s drop lands late and outside the pickup box -> looked for, walked to, BACK in the bag', async () => {
  const { r, have, rows, world } = await lateDropRun(SKILLS)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('furnace'), 1, `furnace back: ${r.detail}`)
  assert.ok(![...world.values()].includes('furnace'))
  assert.ok(rows.some(x => x.kind === '_station_retaken' && x.status === 'success' && /outcome=back why=dug_and_back_in_the_bag_after_walking_into_its_pickup_box/.test(x.detail)), JSON.stringify(rows.filter(x => /station/.test(x.kind))))
})

async function cancelledRun (S, { swap = false } = {}) {
  const n = await mark()
  let k = 0
  const w = makeBot(kit(), {
    onDig: (b, { setBlock }) => {
      if (b.name !== 'furnace' || k++ > 0) return
      if (swap) setBlock(b.position, 'cobblestone')   // another hand changed the cell while the bot was knocked off its dig
      throw new Error('Digging aborted')
    },
  })
  const r = await smeltWith(S, w.bot)
  return { ...w, r, rows: await rowsSince(n) }
}
await t('SMELT CANCELLED DIG: mineflayer\'s "Digging aborted" -> dug again once, the furnace BACK, the row says (dig retried)', async () => {
  const { r, have, digs, rows } = await cancelledRun(SKILLS)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('furnace'), 1, r.detail)
  assert.equal(digs.filter(d => d.name === 'furnace').length, 1, 'one completed dig after the cancelled one')
  assert.ok(rows.some(x => x.kind === '_station_retaken' && /outcome=back why=dug_and_back_in_the_bag_\(dig_retried\)/.test(x.detail)), JSON.stringify(rows.filter(x => /station/.test(x.kind))))
})
await t('SMELT CANCELLED DIG, CELL CHANGED: no retry -- the cobblestone now there is never dug', async () => {
  const { digs, rows, world } = await cancelledRun(SKILLS, { swap: true })
  assert.equal(digs.length, 0, JSON.stringify(digs))
  assert.ok([...world.values()].includes('cobblestone'))
  assert.ok(rows.some(x => x.kind === '_station_retaken' && /outcome=failed why=dig:_Digging_aborted/.test(x.detail)))
})

// ---------------------------------------------------------------------------------------------- wiring (structural)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const CODE = strip(readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))
const fnBody = name => { const i = CODE.indexOf(`async function ${name}`); assert.ok(i >= 0, name); const j = CODE.indexOf('\nasync function ', i + 10); return CODE.slice(i, j < 0 ? undefined : j) }
await t('wiring: craft\'s table retake looks for its drop over time and retries a cancelled dig, as the furnace\'s does', () => {
  const tw = fnBody('retakeWatched')
  assert.match(tw, /sbOn\(\) \? await waitStationDrop\(bot, \{ at, name: 'crafting_table'/)
  assert.match(tw, /await digWithRetry\(\{ bot, sleep, signal, dig: again => retryDig\(bot, again, block, signal, beforeDig, at, 'crafting_table'\)/)
  const rs = fnBody('retakeStation')
  assert.match(rs, /if \(!back && sbOn\(\)\) \{/)
  assert.match(rs, /await chaseStationDrop\(bot, \{ at, name, before, signal, Goal: pickupGoalClass\(goals\)/)
  assert.match(rs, /await digWithRetry\(\{ bot, sleep, signal, dig: again => retryDig\(bot, again, block, signal, beforeDig, at, name\)/)
})

// ---------------------------------------------------------------------------------------------- mutants
async function withSkillsMutant (old, neu, fn) {
  const p = path.join(SRC, 'skills.mjs')
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in skills.mjs: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_skills.mjs`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn((await import(`${tmp}?${Date.now()}`)).SKILLS) } finally { unlinkSync(tmp) }
}
async function withSbMutant (old, neu, fn) {
  const p = path.join(SRC, 'stationsback.mjs')
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in stationsback.mjs: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_stationsback.mjs`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn(await import(`${tmp}?${Date.now()}`)) } finally { unlinkSync(tmp) }
}
await t('MUTANT KILLED: without the chase (the base: bag reads only) the late furnace stays on the floor', async () => {
  await withSkillsMutant('    if (!back && sbOn()) {\n      try {\n        const c = await chaseStationDrop(', '    if (false) {\n      try {\n        const c = await chaseStationDrop(', async S => {
    const { have, rows } = await lateDropRun(S)
    assert.equal(have('furnace'), 0, 'the mutant took it back anyway: the late-drop test proves nothing')
    assert.ok(rows.some(x => x.kind === '_station_retaken' && /outcome=failed why=dug_but_it_did_not_arrive/.test(x.detail)))
  })
})
await t('MUTANT KILLED: without the retry (the base) a cancelled dig leaves the furnace standing', async () => {
  await withSkillsMutant("      const r = await digWithRetry({ bot, sleep, signal, dig: again => retryDig(bot, again, block, signal, beforeDig, at, name), recheck: () => stationStill(bot, at, name) })",
    "      const r = (await collectManually(bot, block, signal, { beforeDig }), { retried: false })", async S => {
      const { have, world } = await cancelledRun(S)
      assert.equal(have('furnace'), 0, 'the mutant took it back anyway')
      assert.ok([...world.values()].includes('furnace'))
    })
})
await t('MUTANT KILLED: a look that reads the world ONCE (the base\'s nearestEntity) misses a late drop', async () => {
  await withSbMutant('    if (t >= lookMs) return null\n', '    return null\n', async M => {
    const bot = { entities: {} }
    setTimeout(() => { bot.entities[7] = ent(7, 'furnace', 0.5, 64, 0.5) }, 250)
    assert.equal(await M.waitStationDrop(bot, { at: new Vec3(0, 64, 0), name: 'furnace', before: 0, count: () => 0, sleep }), null)
  })
})
await t('MUTANT KILLED: a retry that skips the re-check digs whatever now stands there', async () => {
  await withSbMutant('    const again = recheck()\n    if (!again) throw e\n', '    const again = recheck() ?? {}\n', async M => {
    let digs = 0
    await M.digWithRetry({ bot: {}, sleep, on: true, dig: async again => { digs++; if (!again) throw new Error('Digging aborted') }, recheck: () => null })
    assert.equal(digs, 2, 'the mutant dug the changed cell')
  })
})

console.log(`\nstationsback: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
