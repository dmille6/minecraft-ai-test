// PROTECTED ZONES (protectzone-01; protectzone.mjs, its wiring in index.mjs and skills.mjs mine/bucket).
//
// BEHAVIOUR FIRST (CLAUDE.md): the file's parse, the one decision, the guard on a fake bot that mirrors mineflayer 4.37.1's
// calling conventions (dig / _genericPlace / activateBlock / openBlock / sleep / craft return promises; findBlocks calls
// `matching` with a position-less palette block, then with positioned blocks), the REAL mineflayer-pathfinder 2.4.5
// Movements for the path price, and the REAL gather and mine skills driven through the refusal CHAIN -- a gatherer whose
// nearest candidates are all in a zone, a miner standing in the middle of one. Source assertions only for the wiring
// (comments stripped, unique anchors, a mutant each).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, utimesSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const PZ = await import('../src/protectzone.mjs')
const D = await import('../src/digtown.mjs')
const SK = await import('../src/skills.mjs')
const { SKILLS } = SK
const { townDigClass } = await import('../src/townground.mjs')
const { parseZones, zoneAt, zoneDecision, zoneCost, zoneKeepOut, zoneExitColumns, exitPoint, zoneReader, attachProtectZone, ProtectedZoneError, ZONE_COST, EXIT_PAD } = PZ
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const INDEX_URL = new URL('../src/index.mjs', import.meta.url)
const PZ_URL = new URL('../src/protectzone.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const V = (x, y, z) => new Vec3(x, y, z)

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// The showcase village's own shape (docs/reports/protectzone-01-design-2026-10-20.md) and a world id
const VILLAGE = { id: 'village-taiga-6_1', kind: 'village', label: 'the taiga village', box: [49, 54, -59, 157, 98, 45] }
const FILE = { version: 1, world: 'showcase', hashed_seed: '-123456789', zones: [VILLAGE] }
const Z = parseZones(FILE, { worldId: '-123456789' }).zones

// ---- the file ---------------------------------------------------------------------------------------------------------
test('FILE: a valid zone loads; a box is inclusive on all six faces', () => {
  const r = parseZones(FILE, { worldId: '-123456789' })
  assert.equal(r.why, 'ok'); assert.equal(r.zones.length, 1); assert.deepEqual(r.bad, [])
  for (const [x, y, z] of [[49, 54, -59], [157, 98, 45], [100, 70, 0]]) assert.ok(zoneAt(Z, x, y, z), `${x},${y},${z} is inside`)
  for (const [x, y, z] of [[48, 70, 0], [158, 70, 0], [100, 53, 0], [100, 99, 0], [100, 70, -60], [100, 70, 46]]) assert.equal(zoneAt(Z, x, y, z), null, `${x},${y},${z} is outside`)
  assert.ok(zoneAt(Z, 49.9, 54.2, -58.5), 'fractional coordinates floor (a bot\'s feet)')
  assert.equal(zoneAt(Z, 48.9, 70, 0), null)
})
test('FILE: another world\'s file protects nothing; an unknown world id honours it (it is in this pool\'s own dir); no file is off', () => {
  assert.equal(parseZones(FILE, { worldId: '42' }).why, 'world_mismatch')
  assert.equal(parseZones(FILE, { worldId: '42' }).zones.length, 0)
  assert.equal(parseZones(FILE, { worldId: '' }).zones.length, 1)
  assert.equal(parseZones(FILE, { worldId: null }).zones.length, 1)
  assert.equal(parseZones({ ...FILE, hashed_seed: undefined }, { worldId: '42' }).zones.length, 1, 'no binding: honoured')
  assert.equal(parseZones(null).why, 'absent')
})
test('FILE: a malformed zone is dropped and NAMED; the valid ones still protect; a typo-sized box is refused', () => {
  const r = parseZones({ version: 1, zones: [VILLAGE, { id: 'a', box: [1, 2, 3] }, { id: 'b', box: [5, 0, 0, 1, 1, 1] }, { id: 'c', box: [0, 0, 0, 5000, 1, 1] }, { box: [0, 0, 0, 1, 1, 1] }, { id: 'f', box: [0, 0, 0, 1.5, 1, 1] }] })
  assert.equal(r.zones.length, 1)
  assert.deepEqual(r.bad, ['1:shape', 'b:order', 'c:span', '4:shape', '5:shape'])
  assert.equal(parseZones({ version: 2, zones: [VILLAGE] }).why, 'bad_version:2')
  assert.equal(parseZones([VILLAGE]).why, 'not_an_object')
})
test('READER: zones() never touches the disk; refresh() reads an install or edit; a BROKEN file keeps the last good list (stale), only a REMOVED file turns the zones off; every change is reported', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pz-'))
  const f = path.join(dir, PZ.ZONES_FILE)
  const changes = []
  let stats = 0
  const fsx = { statSync: (...a) => { stats++; return statSync(...a) }, readFileSync }
  const rd = zoneReader({ file: () => f, worldId: () => '-123456789', fsx, onChange: st => changes.push(st.why) })
  rd.refresh(); assert.equal(rd.zones().length, 0); assert.equal(rd.state().why, 'absent')
  writeFileSync(f, JSON.stringify(FILE))
  assert.equal(rd.zones().length, 0, 'not read until refresh()')
  const before = stats
  for (let i = 0; i < 1000; i++) rd.zones()
  assert.equal(stats, before, 'zones() (the A* step) never stats the file (Claude r1 P2)')
  rd.refresh(); assert.equal(rd.zones().length, 1, 'read on refresh'); assert.match(PZ.protectZoneModeDetail(rd.state(), 'w'), /zones=1 why=ok ids=village-taiga-6_1/)
  writeFileSync(f, '{ not json'); utimesSync(f, new Date(), new Date(Date.now() + 5000))
  rd.refresh(); assert.equal(rd.zones().length, 1, 'a torn / hand-broken file keeps the last good list'); assert.match(rd.state().why, /^stale:/)
  writeFileSync(f, JSON.stringify({ ...FILE, version: 9 })); utimesSync(f, new Date(), new Date(Date.now() + 9000))
  rd.refresh(); assert.equal(rd.zones().length, 1, 'a bad version keeps it too'); assert.match(rd.state().why, /^stale:bad_version/)
  unlinkSync(f); rd.refresh(); assert.equal(rd.zones().length, 0, 'removing the file is the rollback'); assert.equal(rd.state().why, 'absent')
  assert.deepEqual(changes, ['absent', 'ok', changes[2], 'stale:bad_version:9', 'absent'])
  assert.match(changes[2], /^stale:/)
  const fresh = zoneReader({ file: () => path.join(dir, 'nope', PZ.ZONES_FILE) }); fresh.refresh()
  assert.equal(fresh.state().why, 'absent', 'never a throw')
})

// ---- the one decision ------------------------------------------------------------------------------------------------
test('DECISION: inside a zone every op is refused; survival may dig, place and use, never open, sleep or craft; outside nothing is', () => {
  const cell = { x: 100, y: 70, z: 0 }, out = { x: 10, y: 70, z: 0 }
  for (const op of ['dig', 'place', 'use', 'open', 'sleep', 'craft']) {
    assert.ok(zoneDecision({ zones: Z, op, cell, purpose: 'target' }), `${op} target refused`)
    assert.ok(zoneDecision({ zones: Z, op, cell, purpose: 'transit' }), `${op} transit refused`)
    assert.equal(zoneDecision({ zones: Z, op, cell: out, purpose: 'target' }), null, `${op} outside allowed`)
  }
  for (const op of ['dig', 'place', 'use']) assert.equal(zoneDecision({ zones: Z, op, cell, purpose: 'survival' }), null, `survival ${op} allowed`)
  for (const op of ['open', 'sleep', 'craft']) assert.ok(zoneDecision({ zones: Z, op, cell, purpose: 'survival' }), `survival ${op} still refused`)
})
test('REMEDY: names the zone, the box, and a goto outside it from where the bot stands', () => {
  const r = PZ.zoneRemedy(Z[0], 'dig', { x: 100, y: 70, z: 0 }, { x: 60.5, y: 72, z: 0.5 })
  assert.match(r, /the taiga village \(x 49\.\.157, z -59\.\.45\)/)
  assert.match(r, /walk out first \(goto 45 72 0, height approximate; 4 blocks past its west side\)/, r)
  const r2 = PZ.zoneRemedy(Z[0], 'dig', { x: 100, y: 70, z: 0 }, { x: 60.5, y: 72, z: 0.5 }, { standY: (x, z) => (x === 45 && z === 0 ? 75 : null) })
  assert.match(r2, /goto 45 75 0/, 'a standable height at the exit column, not the y the bot stands at (Claude r1 P2)')
  assert.match(PZ.zoneRemedy(Z[0], 'dig', { x: 49, y: 70, z: 0 }, { x: 47, y: 70, z: 0 }), /you are beside it: step away from it \(its west side\)/)
  assert.deepEqual(exitPoint(Z[0], { x: 155, z: 0 }), { x: 157 + EXIT_PAD, z: 0, side: 'east' })
  assert.deepEqual(exitPoint(Z[0], { x: 150, z: 40 }), { x: 150, z: 45 + EXIT_PAD, side: 'south' }, 'the NEAREST side (5 to the south vs 7 to the east)')
  assert.equal(exitPoint(Z[0], { x: 0, z: 0 }), null, 'not over the zone: no exit to name')
})

// ---- the guard on a fake bot -----------------------------------------------------------------------------------------
function fakeBot ({ zones = Z, ctx = {} } = {}) {
  const calls = []
  const rec = name => async (...a) => { calls.push([name, ...a]); return `${name}-ok` }
  const bot = {
    entity: { position: V(60.5, 72, 0.5) },
    dig: rec('dig'), _genericPlace: rec('place'), activateBlock: rec('use'), openBlock: rec('open'), sleep: rec('sleep'), craft: rec('craft'),
    pathfinder: { isMining: () => false, movements: {} },
    _calls: calls,
  }
  const refusals = []
  attachProtectZone(bot, { zones: () => zones, context: () => ctx, onRefuse: r => refusals.push(r) })
  return { bot, calls, refusals }
}
const blk = (x, y, z, name = 'spruce_planks') => ({ name, position: V(x, y, z) })

test('GUARD: a dig, use, open, sleep and table craft in the village are REJECTED PROMISES naming the remedy; the original is never called', async () => {
  const { bot, calls, refusals } = fakeBot()
  const inV = blk(100, 70, 0)
  for (const [op, call] of [['dig', () => bot.dig(inV, true)], ['use', () => bot.activateBlock(inV)], ['open', () => bot.openBlock(blk(124, 64, -13, 'chest'))],
    ['sleep', () => bot.sleep(blk(66, 70, -11, 'blue_bed'))], ['craft', () => bot.craft({ id: 1 }, 1, blk(64, 70, -11, 'crafting_table'))]]) {
    let p
    assert.doesNotThrow(() => { p = call() }, `${op}: never a synchronous throw (the pathfinder chains .then/.catch)`)
    await assert.rejects(p, e => e instanceof ProtectedZoneError && e.code === 'protected_zone' && e.op === op && /the taiga village/.test(e.message) && /goto 45 72 0, height approximate/.test(e.message), op)
  }
  assert.equal(calls.length, 0, 'nothing reached mineflayer')
  assert.deepEqual(refusals.map(r => r.op), ['dig', 'use', 'open', 'sleep', 'craft'])
  assert.equal(bot.protectZone.dig, 1); assert.equal(bot.protectZone.open, 1)
})
test('GUARD: outside the zone every call passes through unchanged (same arguments, the original\'s own promise value)', async () => {
  const { bot, calls } = fakeBot()
  const out = blk(10, 70, 0)
  assert.equal(await bot.dig(out, true), 'dig-ok')
  assert.equal(await bot.openBlock(out), 'open-ok')
  assert.equal(await bot.craft({ id: 1 }, 2, null), 'craft-ok', 'a craft in the hand (no table) is never judged')
  assert.deepEqual(calls.map(c => c[0]), ['dig', 'open', 'craft'])
  assert.equal(calls[0][1], out); assert.equal(calls[0][2], true)
})
test('GUARD: a PLACEMENT is judged on the cell the block would occupy AND on its reference', async () => {
  const { bot, calls } = fakeBot()
  await assert.rejects(bot._genericPlace(blk(48, 70, 0, 'dirt'), V(1, 0, 0)), ProtectedZoneError, 'a block placed INTO the zone from outside')
  await assert.rejects(bot._genericPlace(blk(49, 70, 0), V(-1, 0, 0)), ProtectedZoneError, 'placed OUT of it but AGAINST its wall: the reference is right-clicked (Codex r1 P1)')
  assert.equal(await bot._genericPlace(blk(47, 70, 0), V(1, 0, 0)), 'place-ok', 'both cells outside, the destination 1 from the edge')
  assert.equal(calls.length, 1)
})
test('GUARD: SURVIVAL keeps priority -- a reflex holding the body, or the reflex tick\'s scope, may dig and place (not open)', async () => {
  const held = fakeBot({ ctx: { skill: 'gather', holder: 'entombed' } })
  assert.equal(await held.bot.dig(blk(100, 70, 0)), 'dig-ok', 'a reflex holder digs its way out of a house wall')
  assert.equal(held.bot.protectZone.survival_allowed, 1)
  const scoped = fakeBot()
  const r = await D.digScoped({ purpose: 'survival', by: 'reflex' }, () => scoped.bot._genericPlace(blk(100, 69, 0), V(0, 1, 0)))()
  assert.equal(r, 'place-ok', 'the reflex tick\'s pillar block')
  await assert.rejects(D.digScoped({ purpose: 'survival', by: 'reflex' }, () => scoped.bot.openBlock(blk(124, 64, -13, 'chest')))(), ProtectedZoneError, 'survival never opens a village chest')
  const goto = fakeBot()
  await assert.rejects(D.withDigScope(null, { purpose: 'transit', by: 'goto' }, () => goto.bot.dig(blk(100, 70, 0))), ProtectedZoneError, 'a goto\'s own dig (float, ride-floor-down) is transit: refused')
})
test('GUARD: with no zone loaded every wrapper is a pass-through (the bench: no file)', async () => {
  const { bot, calls } = fakeBot({ zones: [] })
  for (const name of ['dig', '_genericPlace', 'activateBlock', 'openBlock', 'sleep']) assert.match(await bot[name](blk(100, 70, 0), V(0, 1, 0)), /-ok$/)
  assert.equal(calls.length, 5)
})

// findBlocks as mineflayer 4.37.1 (lib/plugins/blocks.js:122-205): `matching` first per section PALETTE with a
// Block.fromStateId (position null), then per cell with bot.blockAt(point); the nearest `count` returned
function findWorld (cells, { zones = Z, at = V(60.5, 70, 0.5) } = {}) {
  const T = mcData.blocksByName.chest.id
  const seen = []
  const bot = {
    entity: { position: at }, pathfinder: {},
    findBlocks (options) {
      seen.push(options)
      const m = options.matching
      const fn = typeof m === 'function' ? m : (b => b !== null && (Array.isArray(m) ? m : [m]).indexOf(b.type) >= 0)
      if (!fn({ type: T, position: null, name: 'chest' })) return []
      const p0 = options.point ?? bot.entity.position
      return cells.map(([x, y, z]) => ({ type: T, name: 'chest', position: V(x, y, z) }))
        .filter(b => b.position.distanceTo(p0) <= (options.maxDistance ?? 16) && fn(b))
        .sort((a, b) => a.position.distanceTo(p0) - b.position.distanceTo(p0)).slice(0, options.count ?? 1).map(b => b.position)
    },
  }
  bot.findBlock = o => { const r = bot.findBlocks(o); return r.length ? { position: r[0] } : null }
  attachProtectZone(bot, { zones: () => zones })
  return { bot, seen }
}
test('ENUMERATION: findBlocks never answers a zone cell -- the nearest chest OUTSIDE is found even when the nearest are inside', () => {
  const { bot } = findWorld([[62, 70, 0], [63, 70, 0], [64, 70, 0], [40, 70, 0]], { at: V(60.5, 70, 0.5) })
  assert.deepEqual(bot.findBlocks({ matching: mcData.blocksByName.chest.id, maxDistance: 48, count: 1 }).map(p => p.x), [40])
  assert.equal(bot.findBlock({ matching: b => b?.name === 'chest', maxDistance: 48 }).position.x, 40, 'findBlock (it calls findBlocks)')
  assert.ok(bot.protectZone.find_filtered >= 3)
  // positive control: the same world without zones answers the nearest, which is inside
  const raw = findWorld([[62, 70, 0], [40, 70, 0]], { zones: [] })
  assert.equal(raw.bot.findBlocks({ matching: mcData.blocksByName.chest.id, maxDistance: 48 })[0].x, 62)
})
test('ENUMERATION: a search whose sphere meets no zone is handed through UNTOUCHED (the very same options object)', () => {
  const { bot, seen } = findWorld([[-200, 70, 0]], { at: V(-200, 70, 0) })
  const o = { matching: mcData.blocksByName.chest.id, maxDistance: 32 }
  bot.findBlocks(o)
  assert.equal(seen.at(-1), o)
  bot.findBlocks({ ...o, point: V(60, 70, 0) })
  assert.notEqual(typeof seen.at(-1).matching, 'number', 'near a zone: wrapped')
})

// ---- the pathfinder (REAL mineflayer-pathfinder 2.4.5 Movements) -----------------------------------------------------
function realMoves (zones = Z) {
  const { Movements } = require_('mineflayer-pathfinder')
  const registry = require_('prismarine-registry')('1.21.8')
  const Block = require_('prismarine-block')(registry)
  const blockAt = p => {
    const name = p.y <= 69 ? 'stone' : (p.x === 101 && (p.y === 70 || p.y === 71) && p.z === 0) ? 'spruce_planks' : 'air'
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = V(p.x, p.y, p.z); return b
  }
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: V(100.5, 70, 0.5), effects: {} }, entities: {}, inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = true; m.allowParkour = false; m.allowSprinting = false
  const price = zoneCost(() => zones)
  m.exclusionAreasBreak = [...m.exclusionAreasBreak, price]; m.exclusionAreasPlace = [...m.exclusionAreasPlace, price]
  return { m, blockAt }
}
test('PATH: in a zone the pathfinder may not break (safeToBreak false) -- outside it may; WALKING through a zone is untouched', () => {
  const { m, blockAt } = realMoves()
  assert.equal(m.safeToBreak(blockAt(V(101, 70, 0))), false, 'a house wall')
  assert.equal(m.safeToBreak(blockAt(V(30, 69, 0))), true, 'stone outside')
  assert.equal(zoneCost(() => Z)({ position: V(101, 70, 0) }), ZONE_COST)
  const walk = m.getNeighbors({ x: 100, y: 70, z: 5, remainingBlocks: 0 }).find(n => n.x === 101 && n.y === 70 && n.z === 5)
  assert.ok(walk, 'a step along the village path exists')
  const { m: m0 } = realMoves([])
  const walk0 = m0.getNeighbors({ x: 100, y: 70, z: 5, remainingBlocks: 0 }).find(n => n.x === 101 && n.y === 70 && n.z === 5)
  assert.equal(walk.cost, walk0.cost, 'and costs exactly what it costs with no zone')
  const through = m.getNeighbors({ x: 100, y: 70, z: 0, remainingBlocks: 0 }).find(n => n.x === 101 && n.y === 70 && n.z === 0)
  assert.equal(through, undefined, 'no move through the wall in the zone')
  const through0 = m0.getNeighbors({ x: 100, y: 70, z: 0, remainingBlocks: 0 }).find(n => n.x === 101 && n.y === 70 && n.z === 0)
  assert.ok(through0, 'positive control: with no zone the same wall is a (dig) move')
})
test('PATH: no scaffold placed in a zone (a 1x1 tower inside is dropped; outside it exists)', () => {
  const { m } = realMoves()
  m.allow1by1towers = true
  const up = (x) => m.getNeighbors({ x, y: 70, z: 5, remainingBlocks: 64 }).find(n => n.x === x && n.y === 71 && n.z === 5)
  assert.equal(up(100), undefined, 'no tower in the village')
  assert.ok(up(20), 'positive control: a tower outside')
})

// ---- the refusal chain: gather (the real skill) ----------------------------------------------------------------------
function gatherWorld ({ dirt }) {
  const DT = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  const digs = []
  const b0 = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const t = isDirt ? DT : AIRT
    return { name: t.name, type: t.id, position: V(x, y, z), boundingBox: isDirt ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  const bot = {
    entity: { position: V(200.5, 64, 200.5), velocity: V(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => b0(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      if (!fn({ type: DT.id, name: 'dirt', position: null })) return []
      return dirt.map(([x, y, z]) => b0(x, y, z)).filter(b => set.has(`${b.position.x},${b.position.y},${b.position.z}`) && b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); set.delete(`${b.position.x},${b.position.y},${b.position.z}`) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  return { bot, digs }
}
// a zone just beyond the town's square, east: 40 dirt cells inside it are the nearest outside town; 3 more lie past it
const GZ = parseZones({ version: 1, zones: [{ id: 'g', label: 'the test village', box: [217, 55, 190, 226, 90, 210] }] }).zones
const zoneDirt = []
for (let i = 0; i < 40; i++) zoneDirt.push([217 + (i % 8), 63, 196 + Math.floor(i / 8)])
const pastIt = [[229, 63, 200], [230, 63, 200], [231, 63, 200]]
const inG = p => !!zoneAt(GZ, p.x, p.y, p.z)
test('CHAIN gather: the nearest candidates are all in a zone and three lie past it -- the search reaches past them, nothing in the zone is dug', async () => {
  const { bot, digs } = gatherWorld({ dirt: [...zoneDirt, ...pastIt] })
  attachProtectZone(bot, { zones: () => GZ })
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  assert.equal(digs.filter(inG).length, 0, `dug in the zone: ${JSON.stringify(digs)}`)
  assert.ok(digs.some(p => p.x >= 229), `the dirt past the zone was taken (digs ${JSON.stringify(digs)}, ${JSON.stringify(r).slice(0, 200)})`)
})
test('CHAIN gather: only zone dirt anywhere -> a refusal (nothing dug); positive control: without the guard the same world IS dug', async () => {
  const g = gatherWorld({ dirt: zoneDirt })
  attachProtectZone(g.bot, { zones: () => GZ })
  const r = await SKILLS.gather.run({ bot: g.bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  assert.equal(g.digs.length, 0); assert.notEqual(r.status, 'success')
  const raw = gatherWorld({ dirt: zoneDirt })
  await SKILLS.gather.run({ bot: raw.bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
  assert.ok(raw.digs.filter(inG).length > 0, 'the harness can see a zone dig')
})

// ---- the refusal chain: mine (the real skill) ------------------------------------------------------------------------
const AIR = { name: 'air', boundingBox: 'empty', type: 0 }, STONE = { name: 'stone', boundingBox: 'block', type: 1 }, WATER = { name: 'water', boundingBox: 'empty', type: 2 }
function stairWorld ({ at = [200, 65, 200], wet = () => false, yaw = 0, zones = MZ, guard = true, walkable = () => true, open = () => false } = {}) {
  const carved = new Set(), digs = [], walks = []
  const k = (x, y, z) => `${x},${y},${z}`
  const base = p => carved.has(k(p.x, p.y, p.z)) ? AIR : wet(p.x, p.y, p.z) ? WATER : open(p.x, p.y, p.z) ? AIR : p.y < 65 ? STONE : AIR
  const bot = {
    entity: { position: V(...at), yaw, velocity: V(0, 0, 0), onGround: true },
    health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...base(p), position: V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 50, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push(V(b.position.x, b.position.y, b.position.z)); carved.add(k(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, isMoving: () => false,
      goto: async goal => {
        const gy = goal.y ?? bot.entity.position.y
        const to = V(goal.x, Math.floor(gy), goal.z)
        walks.push(to)
        if (!walkable(to) || base(to).boundingBox === 'block' || base(to.offset(0, 1, 0)).boundingBox === 'block') return
        bot.entity.position = to; bot.entity.yaw += 0.9
      },
    },
    setControlState () {}, clearControlStates () {}, lookAt: async () => {}, registry: { blocksByName: {}, itemsByName: {} }, players: {}, entities: {},
    _digs: digs, _walks: walks,
  }
  bot.protectZones = () => zones
  bot._refused = []
  if (guard) attachProtectZone(bot, { zones: () => zones, onRefuse: r => bot._refused.push(r) })
  return bot
}
const runMine = (mod, bot, y = 40) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
// a village-sized zone east of town (town: home 200,65,200, square +-16): x 240..300, z 170..230, y 50..95
const MZ = parseZones({ version: 1, zones: [{ id: 'v', kind: 'village', label: 'the test village', box: [240, 50, 170, 300, 95, 230] }] }).zones
const inM = p => !!zoneAt(MZ, p.x, p.y, p.z)

test('CHAIN mine: standing in the MIDDLE of a zone (30 from every side) it walks out past the nearest side, then cuts a stair that never touches the zone or town ground', async () => {
  const bot = stairWorld({ at: [270, 65, 200] })
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(inM).length, 0, `zone cells dug: ${JSON.stringify(bot._digs.filter(inM).slice(0, 3))}`)
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', { x: 200, y: 65, z: 200 }) === 'ground').length, 0)
  assert.ok(bot._walks.some(w => !inM(w) && !zoneAt(MZ, w.x, 70, w.z)), `walked to a start outside the zone's footprint: ${JSON.stringify(bot._walks.slice(0, 4))}`)
  assert.equal(r.status, 'success', `${r.status} ${String(r.detail).slice(0, 200)}`)
  assert.ok(bot._digs.length > 0)
  assert.equal(bot._refused.length, 0, 'the planner kept the stair out: the chokepoint never had to refuse')
  assert.ok(bot.protectZone.mine_walkout >= 1)
})
test('LAYERS: the zone left out of mine\'s keep-out -> the chokepoint still refuses every zone dig; remove the guard too and the zone IS dug (positive control)', async () => {
  await withMutant(SKILLS_URL, '  const farmTown = () => composeKeepOut(townNow(), zoneKeepOut(liveZones(), bot.entity?.position ?? null))\n', '  const farmTown = () => townNow()\n', async mod => {
    const guarded = stairWorld({ at: [270, 65, 200] })
    await runMine(mod, guarded)
    assert.equal(guarded._digs.filter(inM).length, 0, 'the chokepoint holds on its own')
    assert.ok(guarded._refused.length > 0, 'and it is the one that refused')
    const bare = stairWorld({ at: [270, 65, 200], guard: false })
    await runMine(mod, bare)
    assert.ok(bare._digs.filter(inM).length > 0, 'with both layers gone the fake world IS dug in the zone (the harness can see it)')
  })
})
test('MUTANT KILLED: no zone far starts -- from the middle of a zone the real code walks out, the mutant cannot start (or digs nothing)', async () => {
  await withMutant(SKILLS_URL, "                  ...(kinds.includes('protected') ? zoneExitColumns(liveZones(), bot.entity.position) : [])]\n", '                  ]\n', async mod => {
    const bot = stairWorld({ at: [270, 65, 200] })
    const m = await runMine(mod, bot)
    assert.notEqual(m.status, 'success', `the mutant cannot start from the middle: ${m.status} ${String(m.detail).slice(0, 140)}`)
    assert.equal(bot._digs.filter(inM).length, 0)
  })
})
test('CHAIN mine: EVERY walk-out obstructed -> a protected_zone refusal naming no exit at all, nothing dug', async () => {
  const bot = stairWorld({ at: [270, 65, 200], walkable: () => false })
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.length, 0, 'nothing dug')
  assert.equal(r.failClass, 'protected_zone', `${r.status} ${r.detail}`)
  assert.match(r.detail, /^reason=protected_zone /)
})
test('CHAIN mine (ONE world, Codex r1 P1): the zone\'s WEST side is unwalkable -- the walk-offs there fail, the refusal names an exit on ANOTHER side, and in the SAME world that goto and the next mine succeed', async () => {
  // the bot 5 inside the west edge; every SURFACE cell west of the zone (x < 240, y >= 65) refuses a walk (a ravine along
  // that side): only a walk INTO such a cell fails, the world is otherwise the same (a stair's own steps below are fine)
  const bot = stairWorld({ at: [245, 65, 200], walkable: to => to.x >= 240 || to.y < 65 })
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(inM).length, 0, 'no zone cell dug')
  assert.equal(r.failClass, 'protected_zone', `${r.status} ${String(r.detail).slice(0, 300)}`)
  assert.ok(bot._walks.some(w => w.x < 240), `a west walk-off was tried and failed: ${JSON.stringify(bot._walks.slice(0, 4))}`)
  const m = String(r.detail).match(/goto (-?\d+) (-?\d+) (-?\d+)/)
  assert.ok(m, r.detail)
  const to = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
  assert.ok(to.x >= 240, `the named exit is not on the failed west side: ${JSON.stringify(to)}`)
  assert.ok(!zoneAt(MZ, to.x, to.y, to.z) && !zoneAt(MZ, to.x, 70, to.z), `the named cell is outside the zone: ${JSON.stringify(to)}`)
  // THE REMEDY, PERFORMED IN THE SAME WORLD (still unwalkable west): the goto succeeds, and mine descends outside the zone
  await bot.pathfinder.goto({ x: to.x, y: to.y, z: to.z })
  assert.deepEqual([bot.entity.position.x, bot.entity.position.z], [to.x, to.z], 'the bot reached the named exit')
  bot._digs.length = 0
  const again = await runMine(SK, bot)
  assert.equal(again.status, 'success', `${again.status} ${String(again.detail).slice(0, 200)}`)
  assert.equal(bot._digs.filter(inM).length, 0)
  assert.ok(bot._digs.length > 0)
})
test('CHAIN mine: a bearing from just OUTSIDE runs into the zone -> it turns to a clear one (no refusal, no zone cell)', async () => {
  const MW = await import('../src/minewell.mjs')
  const k = zoneKeepOut(MZ)
  assert.equal(MW.stairClear([], { x: 237, y: 65, z: 200 }, { x: 1, z: 0 }, { forbid: k.forbid, forbidBottom: k.bottom }).clear, false, 'positive control: the east stair from here runs into the zone')
  const bot = stairWorld({ at: [237, 65, 200], yaw: -Math.PI / 2 })   // facing east, into the zone 3 blocks away
  const r = await runMine(SK, bot)
  assert.equal(r.status, 'success', `${r.status} ${String(r.detail).slice(0, 160)}`)
  assert.equal(bot._digs.filter(inM).length, 0)
})
test('KEEP-OUT: every cell of a zone (air too) is forbidden; its exit columns lie EXIT_PAD outside; off the footprint none are offered', () => {
  const k = zoneKeepOut(MZ)
  assert.equal(k.forbid({ x: 250, y: 80, z: 200 }), 'protected')
  assert.equal(k.forbid({ x: 239, y: 80, z: 200 }), null)
  assert.equal(k.bottom, 50)
  const cols = zoneExitColumns(MZ, { x: 245, z: 200 })
  assert.deepEqual(cols[0], { x: 240 - EXIT_PAD, z: 200 })
  assert.ok(cols.every(c => !zoneAt(MZ, c.x, 70, c.z)))
  assert.deepEqual(zoneExitColumns(MZ, { x: 200, z: 200 }), [])
  assert.deepEqual(zoneKeepOut([]), { forbid: null, bottom: null })
})

// ---- the bucket (the model's own tool) -------------------------------------------------------------------------------
test('BUCKET: no pour into, and no scoop from, a zone; the refusal names the zone', async () => {
  const W = mcData.blocksByName.water
  const blocks = (p) => ({ name: p.y === 69 ? 'stone' : 'air', type: p.y === 69 ? 1 : 0, boundingBox: p.y === 69 ? 'block' : 'empty', position: p })
  const bot = { entity: { position: V(100.5, 70, 0.5) }, inventory: { items: () => [{ name: 'water_bucket', count: 1, type: 1 }] }, blockAt: p => blocks(V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))),
                protectZones: () => Z, equip: async () => { throw new Error('should not equip') }, lookAt: async () => {}, activateItem () { throw new Error('should not use') }, pathfinder: { setGoal () {} } }
  const r = await SKILLS.bucket.run({ bot }, { action: 'pour' }, new AbortController().signal)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /protected zone: the taiga village/)
  void W
})

// ---- the wiring (structural; comments stripped; a mutant each) -------------------------------------------------------
const IDX = strip(readFileSync(INDEX_URL, 'utf8'))
const once = (s, needle) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `expected exactly one ${JSON.stringify(needle)}, found ${n}`); return s.indexOf(needle) }
const idxWired = s => {
  const reader = once(s, 'const zoneRd = zoneReader({ file: () => zonesFileIn(poolStateDir(config.memory.pool)), worldId: () => bot.worldId ?? null,')
  once(s, 'zoneRd.refresh()\n')
  once(s, 'const zoneTimer = setInterval(() => zoneRd.refresh(), ZONE_RELOAD_MS)')
  once(s, "bot.protectZones = () => (/overworld$/.test(String(bot.game?.dimension ?? 'overworld')) ? zoneRd.zones() : [])")
  const brk = once(s, 'moves.exclusionAreasBreak = moves.exclusionAreasBreak.concat(zonePrice)')
  const plc = once(s, 'moves.exclusionAreasPlace = [...(moves.exclusionAreasPlace ?? []), zonePlacePrice]')
  const well = s.indexOf('moves.exclusionAreasBreak = [(block) => wellBreakCost')
  const clone = s.indexOf('Object.assign(gatherMoves, moves)')
  assert.ok(well > 0 && well < brk, 'the zone price is appended after the well\'s array is made (not overwritten by it)')
  assert.ok(brk < clone && plc < clone, 'both prices are on the shared arrays before any clone copies them')
  assert.ok(reader < brk, 'the reader exists before the profile reads it')
  const guard = once(s, 'attachProtectZone(bot, {')
  const dig = s.indexOf('attachDigTown(bot, {')
  assert.ok(dig > 0 && guard > dig, 'the guard wraps bot.dig AFTER the instrument (a refused dig is never counted as a dig)')
}
test('WIRING index.mjs: the reader (pool dir), the path prices on the shared arrays before the clones, the guard after the dig instrument', () => idxWired(IDX))
test('MUTANT (index): the place price moved after the clones, or the guard installed before the instrument, is detected', () => {
  const line = 'moves.exclusionAreasPlace = [...(moves.exclusionAreasPlace ?? []), zonePlacePrice]'
  const m1 = IDX.replace(line, '').replace('Object.assign(gatherMoves, moves)', 'Object.assign(gatherMoves, moves)\n' + line)
  assert.notEqual(m1, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m1), /before any clone/)
  const m2 = IDX.replace('attachProtectZone(bot, {', 'attachProtectZoneX(bot, {').replace('const dt = attachDigTown(bot, {', 'attachProtectZone(bot, {})\n      const dt = attachDigTown(bot, {')
  assert.notEqual(m2, IDX, 'MUTATION DID NOT APPLY'); assert.throws(() => idxWired(m2), /AFTER the instrument/)
})
test('MUTANT KILLED (protectzone.mjs): findBlocks wrapper judging the palette block (position null) as a cell would starve every search', async () => {
  await withMutant(PZ_URL, '        if (p && blocked(list, p.x, p.y, p.z, feet)) { filtered++; return false }\n', '        if (!p || blocked(list, p.x, p.y, p.z, feet)) { filtered++; return false }\n', async mod => {
    const T = mcData.blocksByName.chest.id
    const bot = { entity: { position: V(60.5, 70, 0.5) }, findBlocks (o) { const fn = o.matching; if (!fn({ type: T, position: null })) return []; return [V(40, 70, 0)].filter(p => fn({ type: T, position: p })) } }
    mod.attachProtectZone(bot, { zones: () => Z })
    assert.equal(bot.findBlocks({ matching: T, maxDistance: 48 }).length, 0, 'the mutant finds nothing at all')
    const real = { entity: { position: V(60.5, 70, 0.5) }, findBlocks: bot.findBlocks.__protectZone }
    attachProtectZone(real, { zones: () => Z })
    assert.equal(real.findBlocks({ matching: T, maxDistance: 48 }).length, 1, 'the real wrapper finds the chest outside')
  })
})
test('MUTANT KILLED (protectzone.mjs): survival exempted for OPEN would let a reflex-held bot loot a village chest', async () => {
  await withMutant(PZ_URL, "export const SURVIVAL_OPS = new Set(['dig', 'place', 'use'])\n", "export const SURVIVAL_OPS = new Set(['dig', 'place', 'use', 'open'])\n", async mod => {
    const calls = []
    const bot = { entity: { position: V(60, 70, 0) }, openBlock: async b => { calls.push(b); return 'open-ok' }, pathfinder: {} }
    mod.attachProtectZone(bot, { zones: () => Z, context: () => ({ holder: 'entombed', skill: null }) })
    assert.equal(await bot.openBlock(blk(124, 64, -13, 'chest')), 'open-ok', 'the mutant opens it')
    const { bot: real } = fakeBot({ ctx: { holder: 'entombed', skill: null } })
    await assert.rejects(real.openBlock(blk(124, 64, -13, 'chest')), ProtectedZoneError, 'the real guard refuses')
  })
})

// ---- review round 1 (Codex r1) --------------------------------------------------------------------------------------
test('PLACE (Codex r1 P1): a placement whose REFERENCE is in the zone is refused (mineflayer right-clicks the reference: a village chest would open)', async () => {
  const { bot, calls } = fakeBot()
  await assert.rejects(bot._genericPlace(blk(49, 70, 0, 'chest'), V(-1, 0, 0)), ProtectedZoneError, 'reference in, destination out')
  await assert.rejects(bot._genericPlace(blk(100, 52, 0, 'stone'), V(0, 1, 0)), ProtectedZoneError, 'a tall block whose upper half enters the zone bottom (y 54)')
  assert.equal(await bot._genericPlace(blk(100, 51, 0, 'stone'), V(0, 1, 0)), 'place-ok', 'one lower: all three cells below the bottom')
  assert.equal(calls.length, 1)
})
test('INNER USE (Codex r1 P2): an approved open/craft/sleep reaches activateBlock UNAWAITED; a zone re-read in between does not refuse it, and no refusal is ever an unhandled rejection', async () => {
  let zones = []
  const used = []
  const bot = { entity: { position: V(60, 70, 0) }, pathfinder: {},
                activateBlock: async b => { used.push(b.position.x); return 'use-ok' },
                // mineflayer inventory.js:385: openBlock calls bot.activateBlock WITHOUT awaiting, then waits for the window
                openBlock: async function (b) { await new Promise(r => setTimeout(r, 5)); zones = Z; bot.activateBlock(b); return 'window' } }
  attachProtectZone(bot, { zones: () => zones })
  const unhandled = []
  const onU = e => unhandled.push(e)
  process.on('unhandledRejection', onU)
  try {
    assert.equal(await bot.openBlock(blk(124, 64, -13, 'chest')), 'window', 'judged when the zone was off; the file arrived mid-call')
    assert.deepEqual(used, [124], 'its own activation passed')
    bot.activateBlock(blk(124, 64, -13, 'chest'))   // a direct, unawaited, refused use: must not surface as unhandled
    await new Promise(r => setTimeout(r, 20))
    assert.equal(used.length, 1, 'the direct use was refused')
    assert.equal(unhandled.length, 0, `no unhandled rejection: ${unhandled.map(String)}`)
  } finally { process.off('unhandledRejection', onU) }
})
test('ENUMERATION (Codex r1 P2): maxDistance 0 or omitted is mineflayer\'s 16 -- a zone within 16 is filtered, not passed through', () => {
  const seen = []
  const b2 = { entity: { position: V(60.5, 70, 0.5) }, findBlocks (o) { seen.push(o); return [] } }
  attachProtectZone(b2, { zones: () => Z })
  const o = { matching: 1, maxDistance: 0 }
  b2.findBlocks(o)
  assert.notEqual(seen[0], o, 'wrapped (the zone is within mineflayer\'s default 16)')
  const far = { entity: { position: V(-500, 70, 0) }, findBlocks (q) { seen.push(q); return [] } }
  attachProtectZone(far, { zones: () => Z })
  const o2 = { matching: 1 }
  far.findBlocks(o2)
  assert.equal(seen.at(-1), o2, 'a far search with the default distance is still handed through')
})
test('BUCKET (Codex r1 P1): no fill or pour within 6 of a zone (the server ray, not the aimed cell, decides); 7+ away it proceeds to the normal checks', async () => {
  const mk = x => ({ entity: { position: V(x, 70, 0.5) }, inventory: { items: () => [] }, blockAt: p => ({ name: 'air', boundingBox: 'empty', position: p }), protectZones: () => Z, pathfinder: { setGoal () {} } })
  for (const action of ['fill', 'pour']) {
    const near = await SKILLS.bucket.run({ bot: mk(43.5) }, { action }, new AbortController().signal)
    assert.equal(near.failClass, 'protected_zone', `${action} 6 from the zone: ${near.detail}`)
    const far = await SKILLS.bucket.run({ bot: mk(41.5) }, { action }, new AbortController().signal)
    assert.notEqual(far.failClass, 'protected_zone', `${action} 8 from the zone reaches the bucket's own checks: ${far.detail}`)
  }
})
// THE SHAPE RULE for the showcase zones file, as a pure function (CLAUDE.md: extract the decision, test its behaviour).
//   A VILLAGE is a WHOLE COLUMN (Claude r1 P1: no tunnel under a footprint) with its deep floor under the village (r2 P2).
//   ONE reviewed exemption (owner 10-21 #18; shape OWNER 10-25): the TRIAL CHAMBERS are an UNDERGROUND structure. Their zone
//   runs from the world's bottom like a village (y0 -64: nobody tunnels in UNDER them -- the "tunnel under a footprint" trap,
//   Claude r1 P1) with floor_y -47, the old bottom: the owner's surveyed box (x -16..84, y -43..27, z 69..160) padded by 4.
//   Below the floor a bot already there digs its way out sideways (protectzone's deep exemption); the chambers above it are
//   closed to everyone. Unlike a village it is NOT open to the sky: its top stays >= 30 below the town's ground, so ring@1's SE
//   sector and the farm/pavilion plots stay buildable. Any OTHER kind, or a second underground zone, is a problem until it gets
//   its own reviewed exemption here.
const TRIAL_SURVEY = [-16, -43, 69, 84, 27, 160], TRIAL_PAD = 4, TOWN_GROUND_Y = 69
function zoneShapeProblems (zones) {
  const out = []
  for (const z of zones) {
    if (z.kind === 'village') {
      if (z.y0 !== -64) out.push(`${z.id}: a village must run from the world's bottom (y0 ${z.y0})`)
      if (!(z.floorY >= 50 && z.floorY <= 60)) out.push(`${z.id}: a village needs its deep floor under it (${z.floorY})`)
    } else if (z.kind === 'trial_chambers') {
      const pad = TRIAL_SURVEY.map((v, i) => (i < 3 ? v - TRIAL_PAD : v + TRIAL_PAD))
      const want = [pad[0], -64, pad[2], pad[3], pad[4], pad[5]]
      if ([z.x0, z.y0, z.z0, z.x1, z.y1, z.z1].join() !== want.join()) out.push(`${z.id}: not the owner's survey padded ${TRIAL_PAD}, to bedrock (${want})`)
      if (z.floorY !== pad[1]) out.push(`${z.id}: its floor_y must be the chambers' padded bottom ${pad[1]} (${z.floorY})`)
      if (z.y1 > TOWN_GROUND_Y - 30) out.push(`${z.id}: its top ${z.y1} is within 30 of the town's ground`)
    } else out.push(`${z.id}: kind ${z.kind} has no reviewed shape rule`)
  }
  if (zones.filter(z => z.kind === 'trial_chambers').length > 1) out.push('more than one trial_chambers zone')
  return out
}
test('DATA: the showcase file parses, binds to the showcase world; villages are WHOLE COLUMNS and the trial chambers are the ONE reviewed underground exemption', () => {
  const doc = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const r = parseZones(doc, { worldId: '1292467317:1056448044' })
  assert.equal(r.why, 'ok'); assert.deepEqual(r.bad, [])
  assert.equal(parseZones(doc, { worldId: '-1909043226:-504800724' }).why, 'world_mismatch', 'the sandbox world (another seed) is refused')
  assert.deepEqual(zoneShapeProblems(r.zones), [])
  assert.equal(r.zones.filter(z => z.kind === 'village').length, 7, 'positive control: the rule judged the seven villages')
  const tc = r.zones.find(z => z.kind === 'trial_chambers')
  assert.ok(tc && tc.id === 'trial-chambers-home-se', 'the owner\'s trial chambers (#18) are in the deployable file')
  for (const [x, y, z, what] of [[30, 0, 110, 'the chambers\' middle'], [-20, -47, 65, 'the padded corner'], [88, 31, 164, 'the far padded corner']]) assert.equal(zoneAt(r.zones, x, y, z)?.id, tc.id, `${what} at ${x},${y},${z} is protected`)
  for (const [x, y, z, what] of [[30, 69, 110, 'the town ground over the chambers'], [30, 32, 110, 'one above the box'], [-1, 71, 9, 'the planned composter']]) assert.equal(zoneAt(r.zones, x, y, z), null, `${what} at ${x},${y},${z} is not`)
  // OWNER 10-25, POSITIVE CONTROL: a cell BELOW y -47 under the chambers is now inside the zone (it was outside, r1)...
  for (const [x, y, z] of [[30, -48, 110], [30, -60, 110], [-20, -64, 65]]) assert.equal(zoneAt(r.zones, x, y, z)?.id, tc.id, `${x},${y},${z} under the chambers is in the zone`)
  // ...closed to a bot digging in from OUTSIDE the footprint (no tunnel under the chambers)...
  assert.equal(PZ.blocked(r.zones, 30, -55, 110, V(-25.5, -55, 110.5))?.id, tc.id, 'a bot west of the footprint at y -55 cannot dig in under the chambers')
  assert.equal(PZ.blocked(r.zones, 30, -55, 110, V(30.5, 70, 110.5))?.id, tc.id, 'nor a bot on the surface above them')
  // ...open to a bot ALREADY below the floor inside the footprint (it digs its way out sideways: the deep exemption)...
  assert.equal(PZ.blocked(r.zones, 31, -55, 110, V(30.5, -55, 110.5)), null, 'a bot below the floor digs sideways')
  // ...and the chambers themselves (at or above the floor) stay closed to that bot too
  assert.equal(PZ.blocked(r.zones, 30, -47, 110, V(30.5, -55, 110.5))?.id, tc.id, 'the floor cell -47 stays closed to a bot below it')
  assert.equal(PZ.blocked(r.zones, 30, 0, 110, V(30.5, -55, 110.5))?.id, tc.id, 'the chambers stay closed to it')
})
test('DATA RULE (positive controls): each shape the exemption refuses is refused', () => {
  const v = { id: 'v', kind: 'village', x0: 0, y0: -64, z0: 0, x1: 9, y1: 90, z1: 9, floorY: 54 }
  const tc = { id: 't', kind: 'trial_chambers', x0: -20, y0: -64, z0: 65, x1: 88, y1: 31, z1: 164, floorY: -47 }
  assert.deepEqual(zoneShapeProblems([v, tc]), [], 'the two legal shapes')
  assert.match(zoneShapeProblems([{ ...v, y0: 40 }]).join(), /world's bottom/, 'a village that is not a whole column')
  assert.match(zoneShapeProblems([{ ...v, floorY: null }]).join(), /deep floor/, 'a village with no floor')
  assert.match(zoneShapeProblems([{ ...tc, floorY: null }]).join(), /floor_y/, 'chambers to bedrock with no floor (a bot under them could never dig out)')
  assert.match(zoneShapeProblems([{ ...tc, floorY: -48 }]).join(), /floor_y/, 'a floor that is not the padded bottom')
  assert.match(zoneShapeProblems([{ ...tc, y0: -47 }]).join(), /bedrock/, 'the r1 shape (not to bedrock) is refused now')
  assert.match(zoneShapeProblems([{ ...tc, y1: 60 }]).join(), /survey|town's ground/, 'chambers reaching up to the town')
  assert.match(zoneShapeProblems([{ ...tc, x0: -30 }]).join(), /survey/, 'a box that is not the survey')
  assert.match(zoneShapeProblems([{ ...tc, kind: 'structure' }]).join(), /no reviewed shape rule/, 'an unreviewed underground kind')
  assert.match(zoneShapeProblems([tc, { ...tc, id: 't2' }]).join(), /more than one/, 'a second underground zone')
})
test('DATA (continued): the near village is protected where it stands', () => {
  const doc = JSON.parse(readFileSync(new URL('../../infra/showcase/protected-zones.showcase.json', import.meta.url), 'utf8'))
  const r = parseZones(doc, { worldId: '1292467317:1056448044' })
  const v = r.zones.find(z => z.id === 'village-taiga-6_1')
  assert.ok(v, 'the near taiga village')
  for (const [x, y, z, what] of [[124, 64, -13, 'a chest'], [93, 77, 25, 'the bell'], [64, 70, -11, 'the crafting table'], [66, 70, -11, 'a bed'], [100, 12, 0, 'rock under it']]) assert.ok(zoneAt(r.zones, x, y, z), `${what} at ${x},${y},${z} is protected`)
  for (const [x, y, z, what] of [[0, 69, 0, 'home'], [44, 69, 0, 'ring@1\'s outer edge (d 44)'], [48, 69, 0, 'one short of the zone']]) assert.equal(zoneAt(r.zones, x, y, z), null, `${what} is not`)
})

// ---- review round 1 (Claude r1) -------------------------------------------------------------------------------------
// mineflayer 4.37.1's OWN findBlocks (lib/plugins/blocks.js) over a real prismarine-world with paletted sections
function realFindBot (zones, at = V(60.5, 70, 0.5)) {
  const { EventEmitter } = require_('node:events')
  const registry = require_('prismarine-registry')('1.21.8')
  const inject = require_('mineflayer/lib/plugins/blocks.js')
  const Chunk = require_('prismarine-chunk')(registry)
  const World = require_('prismarine-world')(registry)
  const bot = new EventEmitter()
  bot._client = new EventEmitter(); bot.registry = registry; bot.version = '1.21.8'; bot.supportFeature = () => false
  bot.game = { minY: -64, height: 384 }
  inject(bot, { version: '1.21.8' })
  bot.world = new World(null).sync
  bot.entity = { position: at }
  for (const cx of [1, 2, 3, 4]) for (const cz of [-1, 0]) bot.world.setColumn(cx, cz, new Chunk({ minY: -64, worldHeight: 384 }))
  for (const [x, y, z] of [[62, 70, 0], [63, 70, 0], [40, 70, 0], [30, 70, 0]]) bot.world.setBlockStateId(V(x, y, z), registry.blocksByName.chest.defaultState)
  attachProtectZone(bot, { zones: () => zones })
  return { bot, id: registry.blocksByName.chest.id }
}
test('ENUMERATION through mineflayer\'s REAL findBlocks (Claude r1 P3): id matching, function matching, findBlock, useExtraInfo, count -- never a zone cell; positive control without zones', () => {
  const { bot, id } = realFindBot(Z)
  assert.deepEqual(bot.findBlocks({ matching: id, maxDistance: 48, count: 2 }).map(p => p.x), [40, 30], 'the two OUTSIDE, though two inside are nearer')
  assert.deepEqual(bot.findBlocks({ matching: b => b?.name === 'chest', maxDistance: 48, count: 5 }).map(p => p.x), [40, 30])
  assert.equal(bot.findBlock({ matching: id, maxDistance: 48 }).position.x, 40)
  assert.deepEqual(bot.findBlocks({ matching: id, maxDistance: 48, count: 5, useExtraInfo: true }).map(p => p.x), [40, 30], 'useExtraInfo: every section scanned, still judged')
  const raw = realFindBot([])
  assert.deepEqual(raw.bot.findBlocks({ matching: raw.id, maxDistance: 48, count: 2 }).map(p => p.x), [62, 63], 'without zones the nearest (inside) come first')
})
test('CHAIN mine (R6, Claude r1 P3): a zone that appears MID-STAIR (a file installed while the stair runs) stops it at the next zone cell -- protected_zone_step, nothing in the zone dug', async () => {
  let zones = []
  const bot = stairWorld({ at: [237, 65, 200], yaw: -Math.PI / 2, zones: [] })
  bot.protectZones = () => zones
  const dig0 = bot.dig
  let n = 0
  bot.dig = async b => { if (++n === 1) zones = MZ; return dig0(b) }   // the file lands after the first cut
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(inM).length, 0, `zone cells dug: ${JSON.stringify(bot._digs.filter(inM).slice(0, 3))}`)
  assert.equal(r.failClass, 'protected_zone', `${r.status} ${String(r.detail).slice(0, 160)}`)
  assert.match(r.detail, /^reason=protected_zone_step .*240,64,200 is in the test village/)
  assert.ok(bot._digs.length > 0, 'positive control: the stair was cutting east before the file landed')
})
test('MUTANT KILLED (R6): the per-step zone branch removed -> the stop names the TREE FARM (the fallback words), not the zone', async () => {
  await withMutant(SKILLS_URL, "        if (kind === 'protected') {\n", "        if (kind === 'protected-x') {\n", async mod => {
    let zones = []
    const bot = stairWorld({ at: [237, 65, 200], yaw: -Math.PI / 2, zones: [] })
    bot.protectZones = () => zones
    const dig0 = bot.dig
    let n = 0
    bot.dig = async b => { if (++n === 1) zones = MZ; return dig0(b) }
    const r = await runMine(mod, bot)
    assert.notEqual(r.failClass, 'protected_zone', `${r.failClass} ${String(r.detail).slice(0, 120)}`)
    assert.match(String(r.detail), /tree farm/)
  })
})

// ---- review round 2 ----------------------------------------------------------------------------------------------------
test('READER (Codex r2 P2, Claude r2 P3): a file holding JSON null, or one whose every zone is malformed, keeps the last good list', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pz2-'))
  const f = path.join(dir, PZ.ZONES_FILE)
  const rd = zoneReader({ file: () => f })
  writeFileSync(f, JSON.stringify(FILE)); rd.refresh(); assert.equal(rd.zones().length, 1)
  writeFileSync(f, 'null'); utimesSync(f, new Date(), new Date(Date.now() + 3000)); rd.refresh()
  assert.equal(rd.zones().length, 1); assert.equal(rd.state().why, 'stale:null')
  writeFileSync(f, JSON.stringify({ version: 1, zones: [{ id: 'x', box: [1, 2] }] })); utimesSync(f, new Date(), new Date(Date.now() + 6000)); rd.refresh()
  assert.equal(rd.zones().length, 1); assert.match(rd.state().why, /^stale:all_malformed:/)
  writeFileSync(f, JSON.stringify({ version: 1, zones: [] })); utimesSync(f, new Date(), new Date(Date.now() + 9000)); rd.refresh()
  assert.equal(rd.zones().length, 0, 'an EMPTY list on purpose (no bad entries) is honoured'); assert.equal(rd.state().why, 'empty')
})
test('DEEP (Claude r2 P2): a bot ALREADY under a village\'s floor may dig/place below it to get out; nobody outside may tunnel in; the village stays closed to it', async () => {
  const zs = parseZones({ version: 1, zones: [{ ...VILLAGE, box: [49, -64, -59, 157, 90, 45], floor_y: 54 }] }).zones
  const deep = { x: 100.5, y: 30, z: 0.5 }, out = { x: 40.5, y: 30, z: 0.5 }, top = { x: 100.5, y: 70, z: 0.5 }
  assert.equal(PZ.blocked(zs, 101, 30, 0, deep), null, 'deep bot, deep cell: open')
  assert.ok(PZ.blocked(zs, 49, 30, 0, out), 'a bot outside the column cannot dig into it')
  assert.ok(PZ.blocked(zs, 100, 54, 0, deep), 'the floor itself and the village above stay closed to the deep bot')
  assert.ok(PZ.blocked(zs, 101, 30, 0, top), 'a bot in the village cannot dig down into the deep part')
  assert.ok(PZ.blocked(zs, 101, 30, 0, null), 'no feet: no exemption')
  // the guard and the path price use it
  const calls = []
  const bot = { entity: { position: V(deep.x, deep.y, deep.z) }, pathfinder: {}, dig: async b => { calls.push(b.position.x); return 'dig-ok' } }
  attachProtectZone(bot, { zones: () => zs })
  assert.equal(await bot.dig(blk(101, 30, 0)), 'dig-ok')
  await assert.rejects(bot.dig(blk(100, 60, 0)), ProtectedZoneError)
  const price = zoneCost(() => zs, { feet: () => bot.entity.position })
  assert.equal(price({ position: V(101, 30, 0) }), 0); assert.equal(price({ position: V(100, 60, 0) }), ZONE_COST)
  bot.entity.position = V(out.x, out.y, out.z)
  assert.equal(price({ position: V(49, 30, 0) }), ZONE_COST, 'from outside the column: closed')
  assert.deepEqual(parseZones({ version: 1, zones: [{ ...VILLAGE, floor_y: 200 }] }).bad, ['village-taiga-6_1:floor_y'], 'a floor outside the box is refused')
})
test('PATH (Claude r2 P2): a bot on the zone\'s edge column cannot plan a bridge whose REFERENCE is in the zone (no plan the guard refuses); positive control without zones', () => {
  const { Movements } = require_('mineflayer-pathfinder')
  const registry = require_('prismarine-registry')('1.21.8')
  const Block = require_('prismarine-block')(registry)
  // stone floor at y 69 except a one-wide gap at x 48 (just west of the zone, x0 49)
  const blockAt = p => { const name = p.y <= 69 && !(p.x === 48 && p.y >= 60) ? 'stone' : 'air'; const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = V(p.x, p.y, p.z); return b }
  const mk = zones => {
    const bot = { registry, version: '1.21.8', blockAt, entity: { position: V(49.5, 70, 5.5), effects: {} }, entities: {}, inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
    const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allowSprinting = false
    m.exclusionAreasPlace = [zoneCost(() => zones, { grow: 1 })]
    return m
  }
  const west = m => m.getNeighbors({ x: 49, y: 70, z: 5, remainingBlocks: 64 }).find(n => n.x === 48 && n.y === 70 && n.z === 5)
  assert.ok(west(mk([])), 'positive control: with no zone the bridge over the gap is a move')
  assert.equal(west(mk(Z)), undefined, 'with the zone the bridge is never planned')
  const price = zoneCost(() => Z, { grow: 1 })
  assert.equal(price({ position: V(48, 69, 5) }), ZONE_COST, 'one west of the zone: priced'); assert.equal(price({ position: V(47, 69, 5) }), 0, 'two west: free')
})
test('BUCKET REMEDY (Codex r2 P2, Claude r2 P3): the walk named clears the bucket\'s own 6 (plus goto\'s range): from there the bucket is not refused for the zone', async () => {
  const mk = x => ({ entity: { position: V(x, 70, 0.5) }, inventory: { items: () => [] }, blockAt: p => ({ name: p.y < 69 ? 'stone' : 'air', boundingBox: p.y < 69 ? 'block' : 'empty', position: p }), protectZones: () => Z, pathfinder: { setGoal () {} } })
  for (const x of [60.5, 45.5]) {   // inside the zone; beside it
    const r = await SKILLS.bucket.run({ bot: mk(x) }, { action: 'fill' }, new AbortController().signal)
    assert.equal(r.failClass, 'protected_zone')
    const m = String(r.detail).match(/goto (-?\d+) (-?\d+) (-?\d+)/)
    assert.ok(m, r.detail)
    for (const dx of [-2, 0, 2]) {   // wherever goto's range-2 arrival leaves it
      const again = await SKILLS.bucket.run({ bot: mk(Number(m[1]) + dx + 0.5) }, { action: 'fill' }, new AbortController().signal)
      assert.notEqual(again.failClass, 'protected_zone', `from ${Number(m[1]) + dx} the bucket still refuses: ${again.detail}`)
    }
  }
})
test('SIDES (Claude r2 P3): a corner cell belongs to the axis it overhangs more', () => {
  assert.equal(PZ.sideOf(Z[0], { x: 45, z: -70 }), 'north', 'overhangs north by 11, west by 4')
  assert.equal(PZ.sideOf(Z[0], { x: 30, z: -61 }), 'west')
  assert.equal(PZ.sideOf(Z[0], { x: 100, z: 0 }), null)
})

// ---- review round 3 ----------------------------------------------------------------------------------------------------
test('OVERLAP (Codex r3 P2): one zone\'s deep exemption never opens a cell another zone closes', () => {
  const zs = parseZones({ version: 1, zones: [{ id: 'a', box: [0, -64, 0, 100, 90, 100], floor_y: 54 }, { id: 'b', box: [50, -64, 50, 150, 90, 150], floor_y: 40 }] }).zones
  const feet = { x: 60.5, y: 30, z: 60.5 }   // deep in both columns
  assert.equal(PZ.blocked(zs, 60, 30, 60, feet), null, 'below both floors: open')
  assert.equal(PZ.blocked(zs, 60, 45, 60, feet)?.id, 'b', 'below a\'s floor but at/above b\'s: b closes it')
  assert.equal(PZ.blocked(zs, 120, 30, 120, { x: 20.5, y: 30, z: 20.5 })?.id, 'b', 'deep in a only: b\'s column stays closed (no tunnel in)')
})
test('PLACE PRICE = THE GUARD (Codex r3 P2, Claude r3 P3): just under a deep floor the price sees the cell above; a placement touching nothing closed is free', async () => {
  const zs = parseZones({ version: 1, zones: [{ ...VILLAGE, box: [49, -64, -59, 157, 90, 45], floor_y: 54 }] }).zones
  const feet = { x: 100.5, y: 40, z: 0.5 }
  const price = zoneCost(() => zs, { feet: () => feet, grow: 1 })
  assert.equal(price({ position: V(100, 53, 0) }), ZONE_COST, 'y 53: its upper cell is the floor (closed): priced, as the guard refuses it')
  assert.equal(price({ position: V(100, 45, 0) }), 0, 'deep and touching nothing closed: free')
  assert.equal(price({ position: V(46, 69, 0) }), 0, 'outside, not touching the zone: free (no blanket diagonal growth)')
  assert.equal(price({ position: V(48, 69, 0) }), ZONE_COST, 'outside but its face neighbour is the zone (a possible reference): priced')
  // and the guard agrees on the deep placement
  const calls = []
  const bot = { entity: { position: V(feet.x, feet.y, feet.z) }, pathfinder: {}, _genericPlace: async () => { calls.push(1); return 'place-ok' } }
  attachProtectZone(bot, { zones: () => zs })
  assert.equal(await bot._genericPlace(blk(100, 44, 0, 'stone'), V(0, 1, 0)), 'place-ok')
  await assert.rejects(bot._genericPlace(blk(100, 52, 0, 'stone'), V(0, 1, 0)), ProtectedZoneError)
})
test('CHAIN mine DEEP (Claude r3 P3): a bot in a cave pocket UNDER a village cuts its stair out below the floor -- nothing at or above floor_y dug; mutant: the keep-out without the bot\'s feet traps it', async () => {
  const MZD = parseZones({ version: 1, zones: [{ id: 'vd', label: 'the deep test village', box: [240, -64, 170, 300, 95, 230], floor_y: 50 }] }).zones
  const pocket = (x, y, z) => x >= 268 && x <= 272 && z >= 198 && z <= 202 && (y === 30 || y === 31)
  const make = () => stairWorld({ at: [270, 30, 200], zones: MZD, open: pocket })
  const bot = make()
  const r = await runMine(SK, bot, 10)
  assert.equal(r.status, 'success', `${r.status} ${String(r.detail).slice(0, 200)}`)
  assert.ok(bot._digs.length > 0)
  assert.equal(bot._digs.filter(p => zoneAt(MZD, p.x, p.y, p.z) && p.y >= 50).length, 0, 'nothing at or above the floor')
  assert.equal(bot._refused.length, 0, 'the guard agreed with the plan')
  await withMutant(SKILLS_URL, '  const farmTown = () => composeKeepOut(townNow(), zoneKeepOut(liveZones(), bot.entity?.position ?? null))\n', '  const farmTown = () => composeKeepOut(townNow(), zoneKeepOut(liveZones()))\n', async mod => {
    const b2 = make()
    const m = await runMine(mod, b2, 10)
    assert.notEqual(m.status, 'success', `without the feet the deep bot cannot plan a stair: ${m.status} ${String(m.detail).slice(0, 120)}`)
  })
})
